import { SparkWallet } from "@buildonspark/spark-sdk"
import { satsOf } from "./route"

// The SDK's ExitSpeed is a string enum it doesn't export from its entry point.
type WithdrawParams = Parameters<SparkWallet["withdraw"]>[0]
const MEDIUM = "MEDIUM" as WithdrawParams["exitSpeed"]

/**
 * Spark, through its own SDK (the browser build, whose signing runs in WebAssembly). Opening the
 * wallet signs in to the operators, so it doubles as "does Spark answer". The way out is one
 * cooperative exit of everything: the service provider sends the bitcoin to an address on chain
 * and takes its fee out of the amount.
 */

export interface SparkSession {
  wallet: SparkWallet
  /** Spendable now. */
  availableSats: number
  /** On its way in, not claimed yet: it can move once it lands. */
  incomingSats: number
}

type FeeQuote = NonNullable<Awaited<ReturnType<SparkWallet["getWithdrawalFeeQuote"]>>>

export interface Quote {
  feeQuote: FeeQuote
  feeSats: number
  arrivesSats: number
}

const timeout = <T>(work: Promise<T>, ms: number): Promise<T> =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Spark took too long")), ms))])

/** The wallet at this account, or null when Spark doesn't answer. */
export async function openSpark(words: string, account: number, timeoutMs = 45_000): Promise<SparkSession | null> {
  try {
    const { wallet } = await timeout(
      SparkWallet.initialize({
        mnemonicOrSeed: words,
        accountNumber: account,
        // No background swaps: this page only ever takes everything out.
        options: { network: "MAINNET", optimizationOptions: { auto: false } },
      }),
      timeoutMs,
    )
    const balance = await timeout(wallet.getBalance(), timeoutMs)
    return {
      wallet,
      availableSats: Number(balance.satsBalance.available),
      incomingSats: Number(balance.satsBalance.incoming),
    }
  } catch {
    return null
  }
}

/** What taking everything to `address` costs at medium speed (Spark's fee plus the network's). */
export async function quoteAll(session: SparkSession, address: string): Promise<Quote> {
  const feeQuote = await session.wallet.getWithdrawalFeeQuote({
    amountSats: session.availableSats,
    withdrawalAddress: address,
  })
  if (!feeQuote) throw new Error("no quote")
  const feeSats = satsOf(feeQuote.userFeeMedium) + satsOf(feeQuote.l1BroadcastFeeMedium)
  return { feeQuote, feeSats, arrivesSats: session.availableSats - feeSats }
}

/** Sends everything; returns the Bitcoin transaction id. */
export async function sendAll(session: SparkSession, address: string, quote: Quote): Promise<string> {
  const request = await session.wallet.withdraw({
    onchainAddress: address,
    exitSpeed: MEDIUM,
    feeQuote: quote.feeQuote,
    deductFeeFromWithdrawalAmount: true,
  })
  if (!request?.coopExitTxid) throw new Error("no transaction")
  return request.coopExitTxid
}

export async function closeSpark(session: SparkSession | null): Promise<void> {
  try {
    await session?.wallet.cleanupConnections()
  } catch {
    // Closing is best effort; the tab going away closes everything anyway.
  }
}
