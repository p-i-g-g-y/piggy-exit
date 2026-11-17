import { describe, expect, it } from "vitest"
import { ExitFileError, readExitFile, SCHEMA } from "../src/exitfile"
import { IDENTITY, fixture } from "./fixtures"

const minimal = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: SCHEMA,
    network: "MAINNET",
    walletIdentityPublicKey: IDENTITY[0],
    leaves: [{ id: "a", status: "AVAILABLE", treeNodeHex: "00", valueSats: 1000 }],
    nodes: [],
    ...overrides,
  })

const problem = (text: string) => {
  try {
    readExitFile(text)
  } catch (error) {
    return error instanceof ExitFileError ? error.problem : "other"
  }
  return null
}

describe("reading an exit file", () => {
  it("reads the iOS-shaped file with a recorded password entry", () => {
    const file = readExitFile(fixture("exit-file-account-13.json"))
    expect(file.identity).toBe(IDENTITY[13])
    expect(file.accountIndex).toBe(1)
    expect(file.leafCount).toBe(2)
    expect(file.totalSats).toBe(69_632)
    expect(file.createdAt?.toISOString()).toBe("2026-11-17T12:00:00.000Z")
    expect(file.seed).toMatchObject({ kind: "locked", passwordUser: "Archi exit file" })
  })

  it("reads the file the Android app wrote", () => {
    const file = readExitFile(fixture("android-exit-file.json"))
    expect(file.totalSats).toBe(4_608)
    expect(file.leafCount).toBe(2)
    expect(file.accountIndex).toBe(1)
    expect(file.seed?.kind).toBe("locked")
    expect(file.seed?.kind === "locked" && file.seed.passwordUser).toBeNull()
  })

  it("refuses what isn't an exit file", () => {
    expect(problem("not json")).toBe("notExitFile")
    expect(problem("[]")).toBe("notExitFile")
    expect(problem(JSON.stringify({ hello: "world" }))).toBe("notExitFile")
    expect(problem(minimal({ schema: "spark.unilateral-exit-bundle.v2" }))).toBe("notExitFile")
    expect(problem(minimal({ walletIdentityPublicKey: "02abc" }))).toBe("notExitFile")
    expect(problem(minimal({ leaves: "none" }))).toBe("notExitFile")
    expect(problem(minimal({ leaves: [{ valueSats: -1 }] }))).toBe("notExitFile")
    expect(problem(minimal({ leaves: [{ valueSats: "1000" }] }))).toBe("notExitFile")
  })

  it("names a test-network file", () => {
    expect(problem(minimal({ network: "REGTEST" }))).toBe("testNetwork")
  })

  it("treats odd optional fields as missing", () => {
    const file = readExitFile(minimal({ createdAt: "yesterday", accountIndex: -3, seedPhrase: { format: "rot13" } }))
    expect(file.createdAt).toBeNull()
    expect(file.accountIndex).toBeNull()
    expect(file.seed).toBeNull()
  })

  it("reads readable words from a download made without a password", () => {
    const file = readExitFile(minimal({ seedPhrase: { format: "words", words: "a b c", howToOpen: "x" } }))
    expect(file.seed).toEqual({ kind: "words", words: "a b c" })
  })

  it("never trusts an empty or huge entry name", () => {
    const lock = (passwordUser: unknown) =>
      readExitFile(minimal({ seedPhrase: { format: "age", age: "-----BEGIN AGE ENCRYPTED FILE-----", passwordUser } })).seed
    expect(lock("  ")).toMatchObject({ passwordUser: null })
    expect(lock("x".repeat(201))).toMatchObject({ passwordUser: null })
    expect(lock(42)).toMatchObject({ passwordUser: null })
  })
})
