import { HDKey } from "@scure/bip32"
import { mnemonicToSeed } from "@scure/bip39"

/**
 * Which account of a seed phrase an exit file belongs to. Spark derives a wallet's identity key at
 * m/8797555'/<account>'/0' from the BIP-39 seed (no passphrase). Piggy moves to a new account on
 * every kill and fresh start, and the file's `accountIndex` can be missing or stale, so the
 * identity key decides: the recorded account first, then accounts 0 to 63, the same search
 * Piggy's apps run before they lock the seed phrase.
 */

const PURPOSE = 8797555
const HARDENED = 0x80000000
export const SEARCH_LIMIT = 64

export async function findAccount(words: string, identity: string, recorded: number | null): Promise<number | null> {
  const purpose = HDKey.fromMasterSeed(await mnemonicToSeed(words)).deriveChild(PURPOSE + HARDENED)
  const wanted = identity.toLowerCase()
  const opens = (account: number) => identityKey(purpose, account) === wanted
  if (recorded !== null && opens(recorded)) return recorded
  for (let account = 0; account < SEARCH_LIMIT; account++) {
    if (account !== recorded && opens(account)) return account
  }
  return null
}

function identityKey(purpose: HDKey, account: number): string {
  const key = purpose.deriveChild(account + HARDENED).deriveChild(0 + HARDENED).publicKey
  if (!key) throw new Error("no public key")
  return Array.from(key, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
