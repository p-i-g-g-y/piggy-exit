import { describe, expect, it } from "vitest"
import { readExitFile } from "../src/exitfile"
import { isSeedPhrase, normalizeWords, OpenError, openLockedSeed } from "../src/unlock"
import { APP_TEST_WORDS, TEST_WORDS, fixture } from "./fixtures"

const problemOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error instanceof OpenError ? error.problem : "other"
  }
  return null
}

describe("opening the locked seed phrase", () => {
  it("opens what the age CLI wrote (the iOS interop fixture)", async () => {
    expect(await openLockedSeed(fixture("ios-age-cli.age"), "piggy-test-pass-1")).toBe(APP_TEST_WORDS)
  })

  it("opens the Android app's lock", async () => {
    const file = readExitFile(fixture("android-exit-file.json"))
    if (file.seed?.kind !== "locked") throw new Error("expected a locked seed phrase")
    expect(await openLockedSeed(file.seed.armored, "piggy-android-pass-1")).toBe(APP_TEST_WORDS)
  })

  it("refuses a wrong password", async () => {
    expect(await problemOf(openLockedSeed(fixture("age-cli-valid-seed.age"), "piggy-exit-test-2"))).toBe("wrongPassword")
  })

  it("refuses a damaged lock the same way", async () => {
    expect(await problemOf(openLockedSeed("-----BEGIN AGE ENCRYPTED FILE-----\nnope\n", "x"))).toBe("wrongPassword")
  })
})

describe("seed phrase words", () => {
  it("normalizes spacing and case", () => {
    expect(normalizeWords("  Abandon\n abandon\tABOUT ")).toBe("abandon abandon about")
  })

  it("checks real BIP-39 words and their checksum", () => {
    expect(isSeedPhrase(TEST_WORDS)).toBe(true)
    expect(isSeedPhrase(Array(12).fill("abandon").join(" "))).toBe(false)
    expect(isSeedPhrase("piggy piggy piggy piggy piggy piggy piggy piggy piggy piggy piggy piggy")).toBe(false)
    expect(isSeedPhrase("")).toBe(false)
  })
})
