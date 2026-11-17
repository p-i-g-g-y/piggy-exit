import { Decrypter, armor } from "age-encryption"
import { validateMnemonic } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"

/**
 * Opening the seed phrase inside an exit file. The apps lock it with age (age-encryption.org/v1,
 * one scrypt recipient, work factor 18 = 256 MiB of memory), so this needs the person's password
 * and a few seconds. typage (`age-encryption`, by age's author) runs scrypt synchronously.
 */

export type OpenProblem = "wrongPassword" | "outOfMemory"

export class OpenError extends Error {
  constructor(readonly problem: OpenProblem) {
    super(problem)
  }
}

export async function openLockedSeed(armored: string, password: string): Promise<string> {
  const decrypter = new Decrypter()
  decrypter.addPassphrase(password)
  try {
    return normalizeWords(await decrypter.decrypt(armor.decode(armored), "text"))
  } catch (error) {
    // A wrong password and a damaged lock look the same from here: neither opens.
    throw new OpenError(isOutOfMemory(error) ? "outOfMemory" : "wrongPassword")
  }
}

/** scrypt's 256 MiB table can fail to allocate on phones with little memory. */
function isOutOfMemory(error: unknown): boolean {
  return error instanceof RangeError || (error instanceof Error && /out of memory|allocation failed/i.test(error.message))
}

/** One lowercase word per space, the form BIP-39 checks and derives from. */
export function normalizeWords(text: string): string {
  return text.normalize("NFKD").toLowerCase().trim().split(/\s+/).join(" ")
}

/** Real BIP-39 words in a valid order (the last word carries a checksum). */
export function isSeedPhrase(words: string): boolean {
  return validateMnemonic(words, wordlist)
}
