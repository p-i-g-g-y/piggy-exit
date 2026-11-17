import { secp256k1 } from "@noble/curves/secp256k1.js"
import { bytesToHex, hexToBytes } from "@noble/curves/utils.js"
import { TreeNode } from "@buildonspark/spark-sdk/proto/spark"
import { HDKey } from "@scure/bip32"
import { mnemonicToSeedSync } from "@scure/bip39"
import { NETWORK as BITCOIN, p2tr, Transaction } from "@scure/btc-signer"
import { describe, expect, it, vi } from "vitest"
import { constructSparkPackages } from "../src/engine/spark-packages.ts"
import type { EsploraTxStatus } from "../src/engine/types.ts"
import { fundingNeed, prepareSweep, refundsOf, survey, type Chain } from "../src/slow.ts"

// The slow way against the real Spark SDK and blink's package builder, on a synthetic one-leaf
// tree: only the chain is fake. The SDK binds fetch when it loads (it asks mempool.space whether
// each transaction is out), so the fake goes in before anything imports it.
const chainState = vi.hoisted(() => {
  const seen = new Map<string, { confirmed: boolean; block_height?: number }>()
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    const id = /^https:\/\/mempool\.space\/api\/tx\/([0-9a-f]{64})$/.exec(url)?.[1]
    const status = id ? seen.get(id) : undefined
    if (status) return new Response(JSON.stringify({ txid: id, status }), { headers: { "content-type": "application/json" } })
    return new Response("Transaction not found", { status: 404 })
  }) as typeof fetch
  return { seen, tip: 900_000 }
})

const WORDS = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
const DESTINATION = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"
const ANCHOR = { script: hexToBytes("51024e73"), amount: 0n }
const LOCK = 2_000

/** Spark's node and refund transactions come signed: a dummy witness stands in for the signature. */
function signedLooking(build: (tx: Transaction) => void): Uint8Array {
  const tx = new Transaction({ version: 3, allowUnknownOutputs: true })
  build(tx)
  tx.updateInput(0, { finalScriptWitness: [new Uint8Array(64)] })
  return tx.toBytes(true, true)
}

const root = HDKey.fromMasterSeed(mnemonicToSeedSync(WORDS))
const identityXonly = secp256k1.getPublicKey(root.derive("m/8797555'/0'/0'").privateKey!, true).slice(1)
const operatorsXonly = secp256k1.getPublicKey(root.derive("m/1'/2'/3'").privateKey!, true).slice(1)

const nodeTx = signedLooking((tx) => {
  tx.addInput({ txid: hexToBytes("42".repeat(32)), index: 0 })
  tx.addOutput({ script: p2tr(operatorsXonly, undefined, BITCOIN).script, amount: 50_000n })
  tx.addOutput(ANCHOR)
})
const nodeTxid = Transaction.fromRaw(nodeTx, { allowUnknownOutputs: true }).id
const refundTx = signedLooking((tx) => {
  tx.addInput({ txid: hexToBytes(nodeTxid), index: 0, sequence: LOCK })
  tx.addOutput({ script: p2tr(identityXonly, undefined, BITCOIN).script, amount: 50_000n })
  tx.addOutput(ANCHOR)
})
const refundTxid = Transaction.fromRaw(refundTx, { allowUnknownOutputs: true }).id

const treeNodeHex = bytesToHex(
  TreeNode.encode(TreeNode.fromPartial({ id: "leaf-1", treeId: "tree-1", value: 50_000, nodeTx, refundTx, vout: 0, status: "AVAILABLE" })).finish(),
)
const exitFile = JSON.stringify({
  schema: "spark.unilateral-exit-bundle.v1",
  createdAt: "2026-11-17T09:00:00.000Z",
  network: "MAINNET",
  leaves: [{ id: "leaf-1", status: "AVAILABLE", treeNodeHex, valueSats: 50_000 }],
})

const chain: Chain = {
  fetchUtxos: async () => [],
  fetchTip: async () => chainState.tip,
  fetchTx: async (id) => {
    const status: EsploraTxStatus | undefined = chainState.seen.get(id)
    return status ? { txid: id, status } : null
  },
  fetchOutspend: async () => ({ spent: false }),
  broadcast: async () => {
    throw new Error("nothing broadcasts in this test")
  },
  constructPackages: constructSparkPackages,
  fetch: async () => new Response(JSON.stringify({ "6": 2 })),
}

describe("the slow way with the real Spark SDK", () => {
  it("walks one piece from Spark to the person's wallet", async () => {
    // Nothing on chain: the node step can go, and its fees (node and refund) need fee money.
    let s = await survey(exitFile, WORDS, 0, chain)
    expect(s.pieces).toHaveLength(1)
    const [fresh] = s.pieces
    expect(fresh).toMatchObject({ leafId: "leaf-1", stage: "push", worthIt: true, valueSats: 50_000 })
    expect(fresh!.feeSats).toBeGreaterThan(0)
    expect(fundingNeed(s.pieces, s.utxos, s.feeRate)).toMatchObject({ kind: "send" })

    // The node confirmed at 899,000: the refund waits out its 2,000-block lock.
    chainState.seen.set(nodeTxid, { confirmed: true, block_height: 899_000 })
    s = await survey(exitFile, WORDS, 0, chain)
    expect(s.pieces[0]).toMatchObject({ stage: "waiting", maturityHeight: 901_000 })
    expect(s.pieces[0]!.feeSats).toBeGreaterThan(0)
    expect(s.pieces[0]!.feeSats).toBeLessThan(fresh!.feeSats)

    // The lock opened: the refund can go.
    chainState.tip = 901_000
    s = await survey(exitFile, WORDS, 0, chain)
    expect(s.pieces[0]).toMatchObject({ stage: "push" })

    // The refund confirmed: the piece is out, and the seed signs it home.
    chainState.seen.set(refundTxid, { confirmed: true, block_height: 901_001 })
    chainState.tip = 901_002
    s = await survey(exitFile, WORDS, 0, chain)
    expect(s.pieces[0]).toMatchObject({ stage: "out", feeSats: 0 })
    const refunds = await refundsOf(s.pieces, chain)
    expect(refunds).toMatchObject([{ txid: refundTxid, valueSats: 50_000, state: "ready" }])
    const sweep = prepareSweep(s, refunds, WORDS, 0, DESTINATION, true)
    expect(sweep.transactions).toHaveLength(1)
    expect(sweep.arrivesSats + sweep.feeSats).toBe(50_000)
    const home = Transaction.fromRaw(hexToBytes(sweep.transactions[0]!))
    expect(bytesToHex(home.getInput(0).txid!)).toBe(refundTxid)
  })
})
