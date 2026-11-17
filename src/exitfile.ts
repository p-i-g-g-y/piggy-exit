/**
 * Reads a Piggy emergency exit file: blink's `spark.unilateral-exit-bundle.v1` JSON plus Piggy's
 * own fields (`accountIndex`, `seedPhrase`; the README lists them). Only what the page needs is
 * read; unknown fields are ignored.
 */

export const SCHEMA = "spark.unilateral-exit-bundle.v1"

export interface ExitFile {
  /** When the app saved this file; null when the field is missing or unreadable. */
  createdAt: Date | null
  network: string
  /** The wallet's identity key (compressed secp256k1, lowercase hex). */
  identity: string
  /** The account the app recorded. A first guess only: the identity key decides (see account.ts). */
  accountIndex: number | null
  leafCount: number
  /** Total bitcoin in the file's leaves, in sats (the format's unit; the page shows ₿ amounts). */
  totalSats: number
  /**
   * Null for the old format, which the person opens by typing their 12 words: every file the
   * shipped apps wrote (up to 2.2.x), and a newer app's file before the seed phrase is locked
   * into it. The no-password `"words"` download never shipped, so it reads as null too.
   */
  seed: SeedBlock | null
}

/** The seed phrase, locked with the person's password (age, scrypt). */
export type SeedBlock = { kind: "locked"; armored: string; passwordUser: string | null }

export type ExitFileProblem = "notExitFile" | "testNetwork"

export class ExitFileError extends Error {
  constructor(readonly problem: ExitFileProblem) {
    super(problem)
  }
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function readExitFile(text: string): ExitFile {
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    throw new ExitFileError("notExitFile")
  }
  if (!isObject(root) || root.schema !== SCHEMA) throw new ExitFileError("notExitFile")

  const identity = root.walletIdentityPublicKey
  if (typeof identity !== "string" || !/^[0-9a-f]{66}$/i.test(identity)) throw new ExitFileError("notExitFile")
  if (!Array.isArray(root.leaves)) throw new ExitFileError("notExitFile")
  if (root.network !== "MAINNET") throw new ExitFileError("testNetwork")

  let totalSats = 0
  for (const leaf of root.leaves) {
    const value = isObject(leaf) ? leaf.valueSats : undefined
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ExitFileError("notExitFile")
    totalSats += value
  }

  const created = typeof root.createdAt === "string" ? new Date(root.createdAt) : null
  const index = root.accountIndex
  return {
    createdAt: created && !Number.isNaN(created.getTime()) ? created : null,
    network: root.network,
    identity: identity.toLowerCase(),
    accountIndex: typeof index === "number" && Number.isInteger(index) && index >= 0 && index < 2 ** 31 ? index : null,
    leafCount: root.leaves.length,
    totalSats,
    seed: readSeed(root.seedPhrase),
  }
}

function readSeed(block: unknown): SeedBlock | null {
  if (!isObject(block)) return null
  if (block.format === "age" && typeof block.age === "string" && block.age.includes("BEGIN AGE ENCRYPTED FILE")) {
    const user = typeof block.passwordUser === "string" ? block.passwordUser.trim() : ""
    return { kind: "locked", armored: block.age, passwordUser: user.length > 0 && user.length <= 200 ? user : null }
  }
  return null
}
