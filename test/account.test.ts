import { describe, expect, it } from "vitest"
import { findAccount, SEARCH_LIMIT } from "../src/account"
import { readExitFile } from "../src/exitfile"
import { openLockedSeed } from "../src/unlock"
import { IDENTITY, TEST_WORDS, fixture } from "./fixtures"

describe("finding the account a seed phrase opens", () => {
  it("matches the Spark SDKs' account-0 identity key", async () => {
    expect(await findAccount(TEST_WORDS, IDENTITY[0], null)).toBe(0)
  })

  it("trusts the identity key, not a stale recorded account", async () => {
    expect(await findAccount(TEST_WORDS, IDENTITY[13], 1)).toBe(13)
    expect(await findAccount(TEST_WORDS, IDENTITY[13], 13)).toBe(13)
    expect(await findAccount(TEST_WORDS, IDENTITY[1], null)).toBe(1)
  })

  it("reaches a recorded account past the search", async () => {
    expect(SEARCH_LIMIT).toBe(64)
    expect(await findAccount(TEST_WORDS, IDENTITY[100], 100)).toBe(100)
    expect(await findAccount(TEST_WORDS, IDENTITY[100], null)).toBeNull()
  })

  it("refuses another seed phrase", async () => {
    const other = "legal winner thank year wave sausage worth useful legal winner thank yellow"
    expect(await findAccount(other, IDENTITY[0], 0)).toBeNull()
  })
})

describe("the whole check", () => {
  it("opens the file, then finds its piggy at account 13", async () => {
    const file = readExitFile(fixture("exit-file-account-13.json"))
    if (file.seed?.kind !== "locked") throw new Error("expected a locked seed phrase")
    const words = await openLockedSeed(file.seed.armored, "piggy-exit-test-1")
    expect(words).toBe(TEST_WORDS)
    expect(await findAccount(words, file.identity, file.accountIndex)).toBe(13)
  })
})
