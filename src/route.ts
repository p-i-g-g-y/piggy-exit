/**
 * Which way out, once the file is open (bü.b's order):
 * - Spark and Piggy both answer: the Piggy app, where breaking the piggy open takes everything out.
 * - Piggy doesn't, Spark does: the quick way, a cooperative exit through Spark, in this page.
 * - Spark doesn't (whatever Piggy does, since the money sits on Spark): the slow way, the
 *   unilateral exit through Bitcoin itself.
 */
export type Way = "app" | "spark" | "bitcoin"

export function chooseWay(sparkUp: boolean, piggyUp: boolean): Way {
  if (!sparkUp) return "bitcoin"
  return piggyUp ? "app" : "spark"
}

/** A Spark amount in sats, whatever unit the service provider quoted it in. */
export function satsOf(amount: { originalValue: number; originalUnit: string }): number {
  switch (amount.originalUnit) {
    case "SATOSHI":
      return Math.ceil(amount.originalValue)
    case "MILLISATOSHI":
      return Math.ceil(amount.originalValue / 1000)
    case "BITCOIN":
      return Math.ceil(amount.originalValue * 100_000_000)
    default:
      throw new Error(`unknown unit ${amount.originalUnit}`)
  }
}

/**
 * A first look at a mainnet Bitcoin address (bech32 bc1…, or base58 1… / 3…). Spark checks it
 * properly before quoting; this only catches what's plainly not an address.
 */
export function looksLikeBitcoinAddress(text: string): boolean {
  const address = text.trim()
  const lower = address.toLowerCase()
  // bech32 is all lowercase or all uppercase, never mixed.
  const bech32 = /^bc1[02-9ac-hj-np-z]{8,87}$/.test(lower) && (address === lower || address === address.toUpperCase())
  const base58 = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(address)
  return bech32 || base58
}
