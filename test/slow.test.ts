import { secp256k1 } from "@noble/curves/secp256k1.js"
import { bytesToHex, hexToBytes } from "@noble/curves/utils.js"
import { HDKey } from "@scure/bip32"
import { mnemonicToSeedSync } from "@scure/bip39"
import { NETWORK as BITCOIN, p2tr, Transaction } from "@scure/btc-signer"
import { describe, expect, it, vi } from "vitest"
import type { EsploraUtxo, LeafPackage } from "../src/engine/types.ts"
import {
  abortableSleep,
  calendarFile,
  currentFeeRate,
  feeKeyOf,
  feeMoneyBack,
  feeMoneyDone,
  fundingNeed,
  isBitcoinAddress,
  paymentLink,
  pickFeeRate,
  prepareSweep,
  progressOf,
  readySats,
  refundsOf,
  sendSweep,
  splitFeeSats,
  splitTransaction,
  survey,
  totalsOf,
  waitingUntil,
  type Chain,
  type Piece,
  type Refund,
  type Survey,
} from "../src/slow.ts"

const WORDS = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
/** BIP-84 m/84'/0'/0'/0/0 for WORDS: a real mainnet address that isn't the fee key. */
const DESTINATION = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"

const txid = (n: number) => n.toString(16).padStart(64, "0")
const coin = (value: number, confirmed = true, n = value): EsploraUtxo => ({
  txid: txid(n),
  vout: 0,
  value,
  status: confirmed ? { confirmed: true, block_height: 900_000 } : { confirmed: false },
})

const piece = (overrides: Partial<Piece>): Piece => ({
  leafId: "leaf",
  valueSats: 50_000,
  feeSats: 2_000,
  sweepFeeSats: 222,
  worthIt: true,
  stage: "push",
  ...overrides,
})

describe("fee rate", () => {
  it("takes about an hour's estimate, rounded up", () => {
    expect(pickFeeRate({ "1": 30, "6": 4.2, "12": 2 })).toBe(5)
    expect(pickFeeRate({ "5": 3, "12": 2 })).toBe(3)
    expect(pickFeeRate({ "6": 0.4 })).toBe(1)
  })

  it("falls back when Esplora says nothing useful", () => {
    expect(pickFeeRate(null)).toBe(2)
    expect(pickFeeRate({})).toBe(2)
    expect(pickFeeRate({ "6": "fast" })).toBe(2)
  })

  it("asks blockstream.info and survives it being down", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ "6": 7.5 }) })
    expect(await currentFeeRate({ fetch: fetcher })).toBe(8)
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://blockstream.info/api/fee-estimates")
    expect(await currentFeeRate({ fetch: vi.fn().mockResolvedValue({ ok: false }) })).toBe(2)
    expect(await currentFeeRate({ fetch: vi.fn().mockRejectedValue(new TypeError("offline")) })).toBe(2)
  })
})

describe("fee money", () => {
  it("asks for fees, the buffer and the split when there's one piece and nothing sent", () => {
    const need = fundingNeed([piece({ feeSats: 3_000 })], [], 2)
    expect(need).toEqual({ kind: "send", askSats: 3_000 + 1_000 + splitFeeSats(1, 1, 2), seenSats: 0 })
  })

  it("is ready once a single piece's coin confirms, without splitting", () => {
    const pieces = [piece({ feeSats: 3_000 })]
    const ask = (fundingNeed(pieces, [], 2) as { askSats: number }).askSats
    expect(fundingNeed(pieces, [coin(ask, false)], 2)).toEqual({ kind: "confirming", seenSats: ask })
    expect(fundingNeed(pieces, [coin(ask)], 2)).toEqual({ kind: "ready" })
  })

  it("walks several pieces from nothing to one coin each", () => {
    const pieces = [piece({ leafId: "a", feeSats: 5_200 }), piece({ leafId: "b", feeSats: 1_900 }), piece({ leafId: "c", feeSats: 3_100 })]
    const rate = 3

    const first = fundingNeed(pieces, [], rate)
    if (first.kind !== "send") throw new Error(first.kind)
    expect(first.askSats).toBe(5_200 + 1_900 + 3_100 + 3 * 1_000 + splitFeeSats(1, 3, rate))

    // Paid exactly what was asked: no second ask, it waits to confirm, then splits.
    expect(fundingNeed(pieces, [coin(first.askSats, false)], rate).kind).toBe("confirming")
    const split = fundingNeed(pieces, [coin(first.askSats)], rate)
    if (split.kind !== "split") throw new Error(split.kind)
    expect(split.amounts).toEqual([6_200n, 4_100n, 2_900n])

    // The real split builder can pay for it out of exactly that payment.
    const s = surveyWith(pieces, [coin(first.askSats)], rate)
    const built = Transaction.fromRaw(hexToBytes(splitTransaction(s, split.amounts).txHex))
    expect(built.inputsLength).toBe(1)
    const outputs = Array.from({ length: built.outputsLength }, (_, i) => Number(built.getOutput(i).amount))
    expect(outputs.slice(0, 2)).toEqual([6_200, 4_100])
    expect(outputs[2]).toBeGreaterThanOrEqual(2_900)
    expect(first.askSats - outputs.reduce((a, b) => a + b, 0)).toBe(splitFeeSats(1, 3, rate))

    // The split's coins: waiting for a block, then every piece has its own.
    const splitCoins = outputs.map((value, i) => coin(value, false, 100 + i))
    expect(fundingNeed(pieces, splitCoins, rate).kind).toBe("confirming")
    expect(fundingNeed(pieces, splitCoins.map((c) => ({ ...c, status: { confirmed: true } })), rate)).toEqual({ kind: "ready" })
  })

  it("asks for more when fees went up between visits, then splits everything", () => {
    // Visit two: each piece kept its refund fee plus the buffer as change.
    const change = [coin(2_400, true, 1), coin(2_300, true, 2), coin(2_000, true, 3)]
    const same = [piece({ stage: "push", feeSats: 1_400 }), piece({ stage: "push", feeSats: 1_300 }), piece({ stage: "push", feeSats: 1_000 })]
    expect(fundingNeed(same, change, 2)).toEqual({ kind: "ready" })

    const dearer = same.map((p) => ({ ...p, feeSats: p.feeSats * 2 }))
    const more = fundingNeed(dearer, change, 4)
    if (more.kind !== "send") throw new Error(more.kind)
    expect(more.seenSats).toBe(6_700)
    const topUp = coin(more.askSats, true, 9)
    const split = fundingNeed(dearer, [...change, topUp], 4)
    expect(split.kind).toBe("split")
    if (split.kind !== "split") return
    expect(() => splitTransaction(surveyWith(dearer, [...change, topUp], 4), split.amounts)).not.toThrow()
  })

  it("never asks for dust", () => {
    const need = fundingNeed([piece({ feeSats: 1_000 })], [coin(1_550)], 1)
    expect(need).toEqual({ kind: "send", askSats: 1_000, seenSats: 1_550 })
  })

  it("counts pieces waiting out a timelock, not pieces that are out or not worth it", () => {
    const pieces = [
      piece({ stage: "waiting", feeSats: 1_000, maturityHeight: 902_000 }),
      piece({ stage: "out", feeSats: 0 }),
      piece({ worthIt: false, feeSats: 9_000 }),
    ]
    expect(fundingNeed(pieces, [], 2)).toMatchObject({ kind: "send", askSats: 1_000 + 1_000 + splitFeeSats(1, 1, 2) })
    expect(fundingNeed([piece({ stage: "out", feeSats: 0 })], [], 2)).toEqual({ kind: "ready" })
  })

  it("prices the split like blink's fan-out builder", () => {
    expect(splitFeeSats(1, 1, 1)).toBe(110)
    expect(splitFeeSats(2, 3, 2.5)).toBe(Math.ceil((11 + 136 + 93) * 2.5))
  })

  it("only spends confirmed coins in the split", () => {
    const s = surveyWith([piece({ feeSats: 1_000 }), piece({ feeSats: 1_000 })], [coin(10_000, true, 1), coin(5_000, false, 2)], 1)
    const built = Transaction.fromRaw(hexToBytes(splitTransaction(s, [2_000n, 2_000n]).txHex))
    expect(built.inputsLength).toBe(1)
    expect(bytesToHex(built.getInput(0).txid!)).toBe(txid(1))
    for (let i = 0; i < built.outputsLength; i += 1) expect(bytesToHex(built.getOutput(i).script!)).toBe(s.key.script)
  })
})

describe("reading the pieces", () => {
  it("knows what comes back and what's stranded", () => {
    const totals = totalsOf([
      piece({ valueSats: 40_000, sweepFeeSats: 300 }),
      piece({ valueSats: 20_000, sweepFeeSats: 300 }),
      piece({ valueSats: 512, worthIt: false }),
    ])
    expect(totals).toEqual({ backSats: 59_400, strandedSats: 512, pieces: 2 })
  })

  it("dates the wait by the last piece to open", () => {
    const now = Date.UTC(2026, 10, 17)
    const until = waitingUntil(
      [piece({ stage: "waiting", maturityHeight: 900_144 }), piece({ stage: "waiting", maturityHeight: 902_016 }), piece({ stage: "out" })],
      900_000,
      now,
    )
    expect(until?.height).toBe(902_016)
    expect(until?.date.toISOString()).toBe(new Date(now + 2_016 * 600_000).toISOString())
    expect(waitingUntil([piece({ stage: "push" })], 900_000)).toBeNull()
  })

  it("counts progress over the pieces worth moving", () => {
    const leaf = (status: string) => ({ leafId: status, status, valueSats: "1", feeSats: "1", netSats: "1" }) as never
    expect(progressOf([leaf("pending"), leaf("waiting-timelock"), leaf("exit-broadcast"), leaf("failed"), leaf("skipped-uneconomical")])).toEqual({
      total: 4,
      there: 2,
      failed: 1,
    })
  })

  it("surveys each piece's stage from its next step", async () => {
    const chain = fakeChain()
    const s = await survey(bundleText(), WORDS, 0, chain)
    const byId = Object.fromEntries(s.pieces.map((p) => [p.leafId, p]))
    expect(s.feeRate).toBe(2)
    expect(s.tip).toBe(900_000)
    expect(s.feeAddress).toBe(feeKeyOf(WORDS, 0).address)
    expect(byId.pushing).toMatchObject({ stage: "push", feeSats: 2_400, worthIt: true, valueSats: 65_536 })
    expect(byId.waiting).toMatchObject({ stage: "waiting", maturityHeight: 899_100 + 2_000, feeSats: 600 })
    expect(byId.matured).toMatchObject({ stage: "push" })
    expect(byId.inflight).toMatchObject({ stage: "push" })
    expect(byId.out).toMatchObject({ stage: "out", feeSats: 0, refundHex: REFUND_HEX })
    expect(byId.unreadable).toMatchObject({ stage: "unknown" })
    expect(byId.crumb).toMatchObject({ worthIt: false, stage: "unknown" })
    expect(s.utxos.map((u) => u.value)).toEqual([5_000])
  })
})

describe("sending it home", () => {
  const ACCOUNT = 13
  const refundFor = (amount: bigint) => {
    // A refund paying the account's identity key, as Spark's refunds do for this test.
    const identity = HDKey.fromMasterSeed(mnemonicToSeedSync(WORDS)).derive(`m/8797555'/${ACCOUNT}'/0'`)
    const xonly = secp256k1.getPublicKey(identity.privateKey!, true).slice(1)
    const tx = new Transaction({ version: 3, allowUnknownOutputs: true })
    tx.addInput({ txid: hexToBytes(txid(77)), index: 0 })
    tx.addOutput({ script: p2tr(xonly, undefined, BITCOIN).script, amount })
    // Spark's refunds come signed; btc-signer only gives a finalized transaction an id.
    tx.updateInput(0, { finalScriptWitness: [new Uint8Array(64)] })
    return bytesToHex(tx.toBytes(true, true))
  }

  it("reads which refunds are ready, waiting a block, or already sent", async () => {
    const hexes = [refundFor(40_000n), refundFor(30_000n), refundFor(20_000n)]
    const ids = hexes.map((hex) => Transaction.fromRaw(hexToBytes(hex), { allowUnknownOutputs: true }).id)
    const chain = {
      ...fakeChain(),
      fetchTx: async (id: string) => ({ status: { confirmed: id !== ids[1] } }),
      fetchOutspend: async (id: string) => (id === ids[2] ? { spent: true, txid: "f".repeat(64) } : { spent: false }),
    }
    const refunds = await refundsOf(
      hexes.map((refundHex, i) => piece({ leafId: `l${i}`, stage: "out", refundHex })),
      chain,
    )
    expect(refunds.map((r) => [r.state, r.valueSats])).toEqual([
      ["ready", 40_000],
      ["confirming", 30_000],
      ["sent", 20_000],
    ])
  })

  it("signs each ready refund to the person's address with the account's key", () => {
    const s = surveyWith([], [], 2, ACCOUNT)
    const refunds: Refund[] = [
      { leafId: "a", refundHex: refundFor(40_000n), txid: "", valueSats: 40_000, state: "ready" },
      { leafId: "b", refundHex: refundFor(30_000n), txid: "", valueSats: 30_000, state: "sent" },
    ]
    const sweep = prepareSweep(s, refunds, WORDS, ACCOUNT, DESTINATION, false)
    expect(sweep.transactions).toHaveLength(1)
    expect(sweep.unsigned).toBe(0)
    const tx = Transaction.fromRaw(hexToBytes(sweep.transactions[0]!))
    expect(Number(tx.getOutput(0).amount)).toBe(sweep.arrivesSats)
    expect(sweep.arrivesSats + sweep.feeSats).toBe(40_000)
    expect(sweep.amounts).toEqual([sweep.arrivesSats])
  })

  it("counts a refund the seed can't sign instead of failing them all", () => {
    const s = surveyWith([], [], 2, ACCOUNT)
    const refunds: Refund[] = [
      { leafId: "a", refundHex: refundFor(40_000n), txid: "", valueSats: 40_000, state: "ready" },
      { leafId: "b", refundHex: refundFor(30_000n), txid: "", valueSats: 30_000, state: "ready" },
    ]
    // Account 12 can't sign account 13's refunds.
    const sweep = prepareSweep(s, refunds, WORDS, 12, DESTINATION, false)
    expect(sweep.transactions).toHaveLength(0)
    expect(sweep.unsigned).toBe(2)
  })

  it("brings the leftover fee money home only once nothing needs it", () => {
    const pieces = [piece({ stage: "out" })]
    expect(feeMoneyDone(pieces, [{ leafId: "a", refundHex: "", txid: "", valueSats: 1, state: "ready" }])).toBe(true)
    expect(feeMoneyDone(pieces, [{ leafId: "a", refundHex: "", txid: "", valueSats: 1, state: "confirming" }])).toBe(false)
    expect(feeMoneyDone([...pieces, piece({ stage: "waiting" })], [])).toBe(false)

    const s = surveyWith([], [coin(3_000, true, 1), coin(2_500, true, 2), coin(9_000, false, 3)], 2)
    expect(readySats(s, [], true)).toBe(5_500)
    expect(readySats(s, [], false)).toBe(0)
    const back = feeMoneyBack(s.utxos, s.key, DESTINATION, 2)
    if (!back) throw new Error("nothing came back")
    const tx = Transaction.fromRaw(hexToBytes(back.txHex))
    expect(tx.inputsLength).toBe(2)
    expect(tx.outputsLength).toBe(1)
    expect(back.arrivesSats + back.feeSats).toBe(5_500)
    // Priced from a first signing pass; a signature can come out a byte shorter or longer.
    expect(Math.abs(back.feeSats - tx.vsize * 2)).toBeLessThanOrEqual(2)
    expect(feeMoneyBack([coin(700)], s.key, DESTINATION, 2)).toBeNull()
  })

  it("sends every transaction it can and reports the rest", async () => {
    const broadcast = vi.fn().mockResolvedValueOnce("a1").mockRejectedValueOnce(new Error("rejected")).mockResolvedValueOnce("c3")
    const result = await sendSweep(
      { transactions: ["aa", "bb", "cc"], amounts: [10, 20, 30], arrivesSats: 60, feeSats: 3, unsigned: 0 },
      { ...fakeChain(), broadcast },
    )
    expect(result).toEqual({ txids: ["a1", "c3"], sentSats: 40, failed: 1 })
  })
})

describe("small parts", () => {
  it("checks addresses the way signing does", () => {
    expect(isBitcoinAddress(DESTINATION)).toBe(true)
    expect(isBitcoinAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv")).toBe(false)
    expect(isBitcoinAddress("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")).toBe(false)
  })

  it("links a wallet with the amount in bitcoin", () => {
    expect(paymentLink("bc1qxyz", 9_400)).toBe("bitcoin:bc1qxyz?amount=0.000094")
    expect(paymentLink("bc1qxyz", 100_000_000)).toBe("bitcoin:bc1qxyz?amount=1")
  })

  it("writes an all-day reminder", () => {
    const ics = calendarFile(new Date("2026-12-01T15:00:00Z"), "https://pig.gy/exit", new Date("2026-11-17T09:30:00.123Z"))
    expect(ics).toContain("DTSTART;VALUE=DATE:20261201\r\n")
    expect(ics).toContain("DTSTAMP:20261117T093000Z\r\n")
    expect(ics).toContain("DESCRIPTION:Open https://pig.gy/exit with your Piggy exit file")
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true)
  })

  it("stops sleeping when the person leaves", async () => {
    const leaving = new AbortController()
    const sleep = abortableSleep(leaving.signal)
    const nap = sleep(60_000)
    leaving.abort(new Error("left"))
    await expect(nap).rejects.toThrow("left")
    await expect(sleep(1)).rejects.toThrow("left")
  })
})

// A survey without the network: the fee key for `account`, and the given pieces and coins.
function surveyWith(pieces: Piece[], utxos: EsploraUtxo[], feeRate: number, account = 0): Survey {
  const key = feeKeyOf(WORDS, account)
  return { bundle: {} as never, feeRate, tip: 900_000, key, feeAddress: key.address, pieces, utxos }
}

const FEE_SCRIPT = feeKeyOf(WORDS, 0).script

function feeBumpPsbt(feeSats: number): string {
  const tx = new Transaction({ version: 3 })
  tx.addInput({ txid: hexToBytes("cc".repeat(32)), index: 0, witnessUtxo: { script: hexToBytes(FEE_SCRIPT), amount: 100_000n } })
  tx.addOutput({ script: hexToBytes(FEE_SCRIPT), amount: 100_000n - BigInt(feeSats) })
  return bytesToHex(tx.toPSBT())
}

/** A transaction spending `parent`:0, with a relative lock of `blocks` (0 for none). */
function step(parent: string, blocks: number): string {
  const tx = new Transaction({ version: 3, allowUnknownOutputs: true })
  tx.addInput({ txid: hexToBytes(parent), index: 0, sequence: blocks === 0 ? 0xffffffff : blocks })
  tx.addOutput({ script: hexToBytes(FEE_SCRIPT), amount: 1_000n })
  return bytesToHex(tx.unsignedTx)
}

const REFUND_HEX = step(txid(5), 2_000)

const LEAVES: Record<string, { value: number; packages: LeafPackage }> = {
  pushing: { value: 65_536, packages: { txPackages: [{ tx: step(txid(1), 0), feeBumpPsbt: feeBumpPsbt(1_800) }, { tx: step(txid(2), 2_000), feeBumpPsbt: feeBumpPsbt(600) }] } },
  // Parent confirmed at 899,100; locked 2,000 blocks; tip 900,000.
  waiting: { value: 32_768, packages: { txPackages: [{ tx: step(txid(3), 2_000), feeBumpPsbt: feeBumpPsbt(600) }] } },
  // Parent confirmed at 897,000: its lock opened at 899,000.
  matured: { value: 16_384, packages: { txPackages: [{ tx: step(txid(4), 2_000), feeBumpPsbt: feeBumpPsbt(600) }] } },
  // Parent seen but not confirmed: a step is on its way.
  inflight: { value: 8_192, packages: { txPackages: [{ tx: step(txid(6), 100), feeBumpPsbt: feeBumpPsbt(600) }] } },
  out: { value: 4_096, packages: { txPackages: [], sweepTx: REFUND_HEX } },
  unreadable: { value: 2_048, packages: { txPackages: [] } },
  crumb: { value: 512, packages: { txPackages: [{ tx: step(txid(7), 0), feeBumpPsbt: feeBumpPsbt(900) }] } },
}

function bundleText(): string {
  return JSON.stringify({
    schema: "spark.unilateral-exit-bundle.v1",
    createdAt: "2026-11-17T09:00:00.000Z",
    network: "MAINNET",
    leaves: Object.entries(LEAVES).map(([id, { value }]) => ({ id, treeNodeHex: "00", valueSats: value })),
  })
}

function fakeChain(): Chain {
  const parents: Record<string, { confirmed: boolean; block_height?: number }> = {
    [txid(3)]: { confirmed: true, block_height: 899_100 },
    [txid(4)]: { confirmed: true, block_height: 897_000 },
    [txid(6)]: { confirmed: false },
  }
  const reversed = (hex: string) => bytesToHex(hexToBytes(hex).reverse())
  return {
    fetchUtxos: async () => [coin(5_000), coin(300, true, 2)],
    fetchTip: async () => 900_000,
    fetchTx: async (id) => {
      const status = parents[id] ?? parents[reversed(id)]
      return status ? { txid: id, status } : null
    },
    fetchOutspend: async () => ({ spent: false }),
    broadcast: async () => "",
    constructPackages: (async ({ bundle }: { bundle: { leaves: Array<{ id: string }> } }) =>
      bundle.leaves.map((leaf) => ({ leafId: leaf.id, ...structuredClone(LEAVES[leaf.id]!.packages) }))) as unknown as Chain["constructPackages"],
    fetch: async () => ({ ok: true, json: async () => ({ "6": 1.2 }) }) as Response,
  }
}
