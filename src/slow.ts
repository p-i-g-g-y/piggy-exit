import { hexToBytes } from "@noble/curves/utils.js"
import { NETWORK as BITCOIN_MAINNET, Transaction } from "@scure/btc-signer"
import { autoExit, relativeHeightLock, type AutoExitResult, type LeafExitState } from "./engine/auto-exit.ts"
import { parseRecoveryBundle } from "./engine/bundle.ts"
import { buildFanOutTransaction, deriveCpfpFundingKey, estimateCpfpFunding, watchCpfpFunding, type CpfpFundingKey } from "./engine/cpfp-funding.ts"
import { broadcastTransaction, esploraBaseUrl, getAddressUtxos, getOutspend, getTipHeight, getTransaction } from "./engine/esplora.ts"
import { constructSparkPackages } from "./engine/spark-packages.ts"
import { constructSweepTransactions } from "./engine/sweep.ts"
import type { BundleLeaf, CpfpUtxo, EsploraOutspend, EsploraTransaction, EsploraUtxo, RecoveryBundle } from "./engine/types.ts"

/**
 * The slow way: the unilateral exit, through Bitcoin itself, when Spark doesn't answer.
 *
 * blink's engine (src/engine, MIT) does the Bitcoin work: the pre-signed exit chains, their fee
 * bumps (CPFP, paid from a fee key on the same seed, m/8797556'/<account>/0), one package per
 * chain per block (TRUC), and the final sweep. This file decides what the page shows and asks for:
 *
 * 1. survey: every piece (Spark leaf) and where it stands on the chain right now.
 * 2. fundingNeed: whether the fee address can pay the steps left, one coin per piece. If not, how
 *    much to send; once it's there, split it into one coin per piece so every chain moves each block.
 * 3. push: autoExit, until every piece waits out its timelock or its refund is on chain.
 * 4. refunds + prepareSweep: send every refund, and what's left at the fee address once nothing
 *    needs it, to the person's address.
 *
 * Stateless: every visit rebuilds from the file and the chain, so closing the page loses nothing.
 */

export const NETWORK = "MAINNET"
export const ESPLORA = esploraBaseUrl(NETWORK)

/** Kept on top of each piece's fees so a slightly bigger fee bump never strands it (blink's per-leaf buffer). */
const PER_PIECE_BUFFER = 1_000
/** A coin must keep at least this much change after paying its piece's fees. */
const MIN_CHANGE = 600
/** Crumbs smaller than this at the fee address can't pay any fee bump (blink's MIN_USABLE_UTXO_SATS). */
const MIN_USABLE = 600
const DUST = 546
/** Never ask for less than this: wallets refuse dust, and a few sats more costs nothing. */
const MIN_ASK = 1_000
const FALLBACK_FEE_RATE = 2
/** Stands in for the real fee coin when building packages only to read them (never broadcast). */
const PLACEHOLDER_TXID = "11".repeat(32)
const PLACEHOLDER_VALUE = 1_000_000_000n

/** Everything that touches the network, injectable for tests. */
export interface Chain {
  fetchUtxos: (address: string, base: string) => Promise<EsploraUtxo[]>
  fetchTip: (base: string) => Promise<number>
  fetchTx: (txid: string, base: string) => Promise<EsploraTransaction | null>
  fetchOutspend: (txid: string, vout: number, base: string) => Promise<EsploraOutspend | null>
  broadcast: (txHex: string, base: string) => Promise<string>
  constructPackages: typeof constructSparkPackages
  fetch: (url: string, init?: RequestInit) => Promise<Response>
}

export const CHAIN: Chain = {
  fetchUtxos: getAddressUtxos,
  fetchTip: getTipHeight,
  fetchTx: getTransaction,
  fetchOutspend: getOutspend,
  broadcast: broadcastTransaction,
  constructPackages: constructSparkPackages,
  // Bound: browsers throw "Illegal invocation" for a fetch called off its window.
  fetch: (url, init) => fetch(url, init),
}

/**
 * - push: its next step can go out now (it needs its fee money at the fee address)
 * - waiting: its next step is timelocked until `maturityHeight`
 * - out: its refund is on chain; `refundHex` is what the sweep spends
 * - unknown: the file doesn't say how to move it
 */
export type Stage = "push" | "waiting" | "out" | "unknown"

export interface Piece {
  leafId: string
  valueSats: number
  /** Fee bumps still to pay for this piece, the refund's included. */
  feeSats: number
  /** About what sending it to the person's wallet at the end costs. */
  sweepFeeSats: number
  /** Worth more than its fees. Pieces that aren't stay where they are. */
  worthIt: boolean
  stage: Stage
  maturityHeight?: number
  refundHex?: string
}

export interface Survey {
  bundle: RecoveryBundle
  feeRate: number
  tip: number
  /** The fee key. Memory only, like the words. */
  key: CpfpFundingKey
  feeAddress: string
  pieces: Piece[]
  /** Usable coins at the fee address, confirmed or not. */
  utxos: EsploraUtxo[]
}

/** Esplora's estimate for about an hour (6 blocks), in whole sat/vB; a safe default without it. */
export function pickFeeRate(estimates: unknown): number {
  if (!estimates || typeof estimates !== "object") return FALLBACK_FEE_RATE
  const table = estimates as Record<string, unknown>
  for (const target of ["6", "5", "4", "3", "8", "10", "12"]) {
    const rate = table[target]
    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) return Math.max(1, Math.ceil(rate))
  }
  return FALLBACK_FEE_RATE
}

export async function currentFeeRate(chain: Pick<Chain, "fetch"> = CHAIN): Promise<number> {
  try {
    const response = await chain.fetch(`${ESPLORA}/fee-estimates`, { signal: AbortSignal.timeout(15_000) })
    return pickFeeRate(response.ok ? await response.json() : null)
  } catch {
    return FALLBACK_FEE_RATE
  }
}

export function feeKeyOf(words: string, account: number): CpfpFundingKey & { address: string } {
  const key = deriveCpfpFundingKey({ seed: words, network: NETWORK, accountNumber: account })
  if (!key.address) throw new Error("the fee key has no address")
  return key as CpfpFundingKey & { address: string }
}

/** The coins at the fee address big enough to pay a fee bump, confirmed or not. */
export async function usableUtxos(address: string, chain: Chain = CHAIN): Promise<EsploraUtxo[]> {
  return (await chain.fetchUtxos(address, ESPLORA)).filter((utxo) => utxo.value >= MIN_USABLE)
}

const placeholder = (key: CpfpFundingKey): CpfpUtxo => ({
  txid: PLACEHOLDER_TXID,
  vout: 0,
  value: PLACEHOLDER_VALUE,
  script: key.script,
  publicKey: key.publicKey,
})

/** Where every piece in the file stands on the chain now, and what the slow way costs from here. */
export async function survey(rawFile: string, words: string, account: number, chain: Chain = CHAIN): Promise<Survey> {
  const bundle = parseRecoveryBundle(rawFile)
  const key = feeKeyOf(words, account)
  const [feeRate, tip, utxos] = await Promise.all([currentFeeRate(chain), chain.fetchTip(ESPLORA), usableUtxos(key.address, chain)])
  const estimate = await estimateCpfpFunding({
    bundle,
    feeRate,
    fundingScript: key.script,
    fundingPublicKey: key.publicKey,
    constructPackages: chain.constructPackages,
  })
  const leaves = new Map(bundle.leaves.map((leaf) => [leaf.id, leaf]))
  const pieces: Piece[] = []
  for (const economics of estimate.perLeaf) {
    const leaf = economics.leafId ? leaves.get(economics.leafId) : undefined
    if (!leaf) continue
    const piece: Piece = {
      leafId: leaf.id,
      valueSats: Number(economics.valueSats ?? 0),
      feeSats: Number(economics.feeSats),
      sweepFeeSats: Number(economics.sweepFeeSats),
      worthIt: economics.economical,
      stage: "unknown",
    }
    if (piece.worthIt) Object.assign(piece, await stageOf(bundle, leaf, key, feeRate, tip, chain))
    pieces.push(piece)
  }
  return { bundle, feeRate, tip, key, feeAddress: key.address, pieces, utxos }
}

/** The same reading autoExit does each round, without spending anything. */
async function stageOf(
  bundle: RecoveryBundle,
  leaf: BundleLeaf,
  key: CpfpFundingKey,
  feeRate: number,
  tip: number,
  chain: Chain,
): Promise<Pick<Piece, "stage" | "maturityHeight" | "refundHex">> {
  const [leafPackage] = await chain.constructPackages({ bundle: { ...bundle, leaves: [leaf] }, cpfpUtxos: [placeholder(key)], feeRate })
  if (leafPackage?.sweepTx) return { stage: "out", refundHex: leafPackage.sweepTx }
  const head = leafPackage?.txPackages?.[0]
  if (!head?.tx) return { stage: "unknown" }
  const lock = relativeHeightLock(head.tx)
  if (!lock) return { stage: "push" }
  const maturity = await maturityOfLock(lock, chain)
  // An unconfirmed parent means a step is on its way: still pushing.
  if (maturity !== null && tip + 1 < maturity) return { stage: "waiting", maturityHeight: maturity }
  return { stage: "push" }
}

async function maturityOfLock(lock: { blocks: number; prevTxidCandidates: string[] }, chain: Chain): Promise<number | null> {
  for (const txid of lock.prevTxidCandidates) {
    let tx: EsploraTransaction | null
    try {
      tx = await chain.fetchTx(txid, ESPLORA)
    } catch {
      continue
    }
    const height = tx?.status?.block_height
    if (tx?.status?.confirmed && typeof height === "number" && Number.isInteger(height)) return height + lock.blocks
    if (tx) return null
  }
  return null
}

export interface Totals {
  /** What reaches the person's wallet from the pieces worth taking out, less their sweep fees. */
  backSats: number
  /** Bitcoin in pieces that cost more to take out than they hold. */
  strandedSats: number
  pieces: number
}

export function totalsOf(pieces: Piece[]): Totals {
  let backSats = 0
  let strandedSats = 0
  let count = 0
  for (const piece of pieces) {
    if (piece.worthIt) {
      count += 1
      backSats += Math.max(0, piece.valueSats - piece.sweepFeeSats)
    } else {
      strandedSats += piece.valueSats
    }
  }
  return { backSats, strandedSats, pieces: count }
}

/** Pieces that still need fee money: their next step can go now, or later once a timelock opens. */
const needsOf = (pieces: Piece[]): number[] =>
  pieces
    .filter((piece) => piece.worthIt && (piece.stage === "push" || piece.stage === "waiting") && piece.feeSats > 0)
    .map((piece) => piece.feeSats)
    .sort((a, b) => b - a)

/** buildFanOutTransaction's size for P2WPKH coins in and out, priced the same way. */
export function splitFeeSats(inputs: number, outputs: number, feeRate: number): number {
  const vsize = 11 + 68 * inputs + 31 * outputs
  return Math.ceil((vsize * Math.ceil(feeRate * 1000)) / 1000)
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0)

export type Funding =
  /** Every piece has a coin that pays its fees (and one has confirmed): push. */
  | { kind: "ready" }
  /** Enough has confirmed but not one coin per piece: split it first. */
  | { kind: "split"; amounts: bigint[] }
  /** Enough has arrived, not confirmed yet. */
  | { kind: "confirming"; seenSats: number }
  /** The person sends this much (more) to the fee address. */
  | { kind: "send"; askSats: number; seenSats: number }

/**
 * Whether the coins at the fee address can pay every piece's remaining fees, one coin per piece:
 * largest coin to the largest fees, as autoExit assigns them. Unconfirmed coins count (a step on
 * its way leaves its change unconfirmed) but pushing waits for one to confirm.
 */
export function fundingNeed(pieces: Piece[], utxos: EsploraUtxo[], feeRate: number): Funding {
  const needs = needsOf(pieces)
  const coins = utxos.map((utxo) => utxo.value).sort((a, b) => b - a)
  const confirmed = utxos.filter((utxo) => utxo.status?.confirmed).map((utxo) => utxo.value)
  const seenSats = sum(coins)
  if (needs.every((need, index) => (coins[index] ?? 0) >= need + MIN_CHANGE)) {
    return confirmed.length > 0 || needs.length === 0 ? { kind: "ready" } : { kind: "confirming", seenSats }
  }
  // One coin per piece, each its fees plus the buffer, made by splitting every coin there.
  const total = (inputs: number) => sum(needs) + needs.length * PER_PIECE_BUFFER + splitFeeSats(inputs, needs.length, feeRate)
  if (seenSats < total(coins.length)) {
    // Asking assumes one more payment, which the split then also spends.
    return { kind: "send", askSats: Math.max(total(coins.length + 1) - seenSats, MIN_ASK), seenSats }
  }
  if (sum(confirmed) >= total(confirmed.length)) {
    return { kind: "split", amounts: needs.map((need) => BigInt(need + PER_PIECE_BUFFER)) }
  }
  return { kind: "confirming", seenSats }
}

const coinOf = (utxo: EsploraUtxo, key: CpfpFundingKey): CpfpUtxo => ({
  txid: utxo.txid,
  vout: utxo.vout,
  value: BigInt(utxo.value),
  script: key.script,
  publicKey: key.publicKey,
})

/** Spends every confirmed coin at the fee address into one coin per piece, back to the fee address. */
export function splitTransaction(s: Survey, amounts: bigint[]): { txHex: string; txid: string } {
  const confirmed = s.utxos.filter((utxo) => utxo.status?.confirmed)
  const split = buildFanOutTransaction({
    utxos: confirmed.map((utxo) => coinOf(utxo, s.key)),
    amounts,
    privateKey: s.key.privateKey,
    feeRate: s.feeRate,
  })
  return { txHex: split.txHex, txid: split.txid }
}

/** A sleep that stops the loop when the person leaves (Start over, Check again). */
export function abortableSleep(signal: AbortSignal): (ms: number) => Promise<void> {
  return (ms) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason)
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          reject(signal.reason)
        },
        { once: true },
      )
    })
}

/**
 * Pushes the exit chains until each piece waits out its timelock or its refund is on chain. Call
 * only when fundingNeed says "ready".
 */
export function push(
  s: Survey,
  words: string,
  account: number,
  onProgress: (leaves: LeafExitState[]) => void,
  sleep: (ms: number) => Promise<void>,
): Promise<AutoExitResult> {
  return autoExit({
    bundle: s.bundle,
    seed: words,
    network: NETWORK,
    feeRate: s.feeRate,
    accountNumber: account,
    // The page splits the fee money itself (fundingNeed), so autoExit never has to.
    fanOut: false,
    onRound: onProgress,
    deps: { sleep, watchFunding: (options) => watchCpfpFunding({ ...options, sleep }) },
  })
}

export interface Progress {
  total: number
  /** On the chain: waiting out the timelock, or the refund is there. */
  there: number
  failed: number
}

export function progressOf(leaves: LeafExitState[]): Progress {
  const worth = leaves.filter((leaf) => leaf.status !== "skipped-uneconomical")
  return {
    total: worth.length,
    there: worth.filter((leaf) => leaf.status === "waiting-timelock" || leaf.status === "exit-broadcast").length,
    failed: worth.filter((leaf) => leaf.status === "failed").length,
  }
}

/** The height everything still waiting can move, as a rough date (10 minutes a block). */
export function waitingUntil(pieces: Piece[], tip: number, now = Date.now()): { height: number; date: Date } | null {
  const heights = pieces.filter((piece) => piece.worthIt && piece.stage === "waiting" && piece.maturityHeight).map((piece) => piece.maturityHeight!)
  if (heights.length === 0) return null
  const height = Math.max(...heights)
  return { height, date: new Date(now + Math.max(0, height - tip) * 10 * 60 * 1000) }
}

export interface Refund {
  leafId: string
  refundHex: string
  txid: string
  /** The refund's output 0: the piece's bitcoin, before the sweep's fee. */
  valueSats: number
  /** ready: confirmed, unspent. confirming: needs a block. sent: already swept. */
  state: "ready" | "confirming" | "sent"
}

/** The refunds on chain and whether each can be swept now. */
export async function refundsOf(pieces: Piece[], chain: Chain = CHAIN): Promise<Refund[]> {
  const refunds: Refund[] = []
  for (const piece of pieces) {
    if (!piece.worthIt || piece.stage !== "out" || !piece.refundHex) continue
    const refund = Transaction.fromRaw(hexToBytes(piece.refundHex), { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true })
    const txid = refund.id
    const [tx, spend] = await Promise.all([chain.fetchTx(txid, ESPLORA), chain.fetchOutspend(txid, 0, ESPLORA)])
    const state = spend?.spent ? "sent" : tx?.status?.confirmed ? "ready" : "confirming"
    refunds.push({ leafId: piece.leafId, refundHex: piece.refundHex, txid, valueSats: Number(refund.getOutput(0)?.amount ?? 0n), state })
  }
  return refunds
}

/** What's ready to go to the person's wallet now, before the last fee. */
export function readySats(s: Survey, refunds: Refund[], includeFeeMoney: boolean): number {
  const fromRefunds = sum(refunds.filter((refund) => refund.state === "ready").map((refund) => refund.valueSats))
  const feeMoney = includeFeeMoney ? sum(s.utxos.filter((utxo) => utxo.status?.confirmed).map((utxo) => utxo.value)) : 0
  return fromRefunds + feeMoney
}

/** Nothing left that the fee money still has to pay for. */
export function feeMoneyDone(pieces: Piece[], refunds: Refund[]): boolean {
  const moving = pieces.some((piece) => piece.worthIt && piece.stage !== "out")
  return !moving && refunds.every((refund) => refund.state !== "confirming")
}

export interface Sweep {
  transactions: string[]
  /** What each transaction delivers, in the same order. */
  amounts: number[]
  arrivesSats: number
  feeSats: number
  /** Refunds that couldn't be signed (none expected; a seed that doesn't match them). */
  unsigned: number
}

/**
 * Signs, without sending, every ready refund to `destination`, plus what's left at the fee address
 * once nothing needs it.
 */
export function prepareSweep(
  s: Survey,
  refunds: Refund[],
  words: string,
  account: number,
  destination: string,
  includeFeeMoney: boolean,
): Sweep {
  const sweep: Sweep = { transactions: [], amounts: [], arrivesSats: 0, feeSats: 0, unsigned: 0 }
  const add = (txHex: string, arrives: number, fee: number) => {
    sweep.transactions.push(txHex)
    sweep.amounts.push(arrives)
    sweep.arrivesSats += arrives
    sweep.feeSats += fee
  }
  for (const refund of refunds) {
    if (refund.state !== "ready") continue
    try {
      const signed = constructSweepTransactions({
        seed: words,
        network: NETWORK,
        packages: { packages: [{ leafId: refund.leafId, txPackages: [{ tx: refund.refundHex }] }] },
        destination,
        feeRate: s.feeRate,
        accountNumber: account,
      })
      for (const leaf of signed.sweeps) add(leaf.sweepTx, Number(leaf.refundValueSats) - Number(leaf.feeSats), Number(leaf.feeSats))
    } catch {
      sweep.unsigned += 1
    }
  }
  if (includeFeeMoney) {
    const back = feeMoneyBack(s.utxos, s.key, destination, s.feeRate)
    if (back) add(back.txHex, back.arrivesSats, back.feeSats)
  }
  return sweep
}

/** Every confirmed coin at the fee address to `destination`, or null when it wouldn't cover its fee. */
export function feeMoneyBack(
  utxos: EsploraUtxo[],
  key: CpfpFundingKey,
  destination: string,
  feeRate: number,
): { txHex: string; arrivesSats: number; feeSats: number } | null {
  const coins = utxos.filter((utxo) => utxo.status?.confirmed)
  if (coins.length === 0) return null
  const total = coins.reduce((all, utxo) => all + BigInt(utxo.value), 0n)
  const script = hexToBytes(key.script)
  const build = (fee: bigint) => {
    const tx = new Transaction()
    for (const coin of coins) {
      tx.addInput({ txid: coin.txid, index: coin.vout, sequence: 0xfffffffd, witnessUtxo: { script, amount: BigInt(coin.value) } })
    }
    tx.addOutputAddress(destination, total - fee, BITCOIN_MAINNET)
    tx.sign(key.privateKey)
    tx.finalize()
    return tx
  }
  const fee = BigInt(Math.ceil(build(1n).vsize * feeRate))
  if (total - fee < BigInt(DUST)) return null
  const tx = build(fee)
  return { txHex: tx.hex, arrivesSats: Number(total - fee), feeSats: Number(fee) }
}

/** Broadcasts every signed transaction (each stands alone); returns what went out and what didn't. */
export async function sendSweep(sweep: Sweep, chain: Chain = CHAIN): Promise<{ txids: string[]; sentSats: number; failed: number }> {
  const txids: string[] = []
  let sentSats = 0
  let failed = 0
  for (const [index, transaction] of sweep.transactions.entries()) {
    try {
      txids.push(await chain.broadcast(transaction, ESPLORA))
      sentSats += sweep.amounts[index] ?? 0
    } catch {
      failed += 1
    }
  }
  return { txids, sentSats, failed }
}

/** A mainnet address the sweep can pay (btc-signer's own check, the one signing uses). */
export function isBitcoinAddress(address: string): boolean {
  try {
    new Transaction().addOutputAddress(address, 1_000n, BITCOIN_MAINNET)
    return true
  } catch {
    return false
  }
}

/** A BIP-21 link so a wallet on the same phone opens with the address and amount filled in. */
export function paymentLink(address: string, sats: number): string {
  const amount = (sats / 100_000_000).toFixed(8).replace(/\.?0+$/, "")
  return `bitcoin:${address}?amount=${amount}`
}

/** A calendar file for the day the timelock opens, made on the device. */
export function calendarFile(date: Date, url: string, now = new Date()): string {
  const day = date.toISOString().slice(0, 10).replaceAll("-", "")
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Piggy//Exit//EN",
    "BEGIN:VEVENT",
    `UID:piggy-exit-${day}@pig.gy`,
    `DTSTAMP:${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
    `DTSTART;VALUE=DATE:${day}`,
    "SUMMARY:Take your bitcoin back",
    `DESCRIPTION:Open ${url} with your Piggy exit file and its password to send your bitcoin to your wallet.`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n")
}
