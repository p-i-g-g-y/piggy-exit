import { readFileSync } from "node:fs"

/**
 * Test files, none made by this page's own code:
 * - android-exit-file.json: written by the Android app's exit-file store in its tests, locked
 *   by the app's own age code with "piggy-android-pass-1".
 * - ios-age-cli.age: the iOS app's age interop fixture, written by the age 1.3.2 CLI with
 *   "piggy-test-pass-1" (work factor 18).
 * - age-cli-valid-seed.age: the standard test mnemonic, written by the age 1.3.2 CLI with
 *   "piggy-exit-test-1" (work factor 18).
 * - exit-file-account-13.json: an exit file for account 13 of the test mnemonic, carrying the
 *   lock above, whose recorded account (1) is stale on purpose. Its identity key comes from a
 *   pure-Python derivation that reproduces the Spark SDKs' own account-0 vector.
 */
export const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")

/** BIP-39's standard test mnemonic. */
export const TEST_WORDS = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
/** The (not BIP-39-valid) phrase the app tests lock. */
export const APP_TEST_WORDS = "abandon ability able about above absent absorb abstract absurd abuse access accident"

/**
 * Identity keys of TEST_WORDS at m/8797555'/<account>'/0'. Account 0 is asserted by the key
 * derivation tests of Piggy's Swift and Kotlin Spark SDKs (taken from @scure/bip32 in the TS SDK).
 */
export const IDENTITY = {
  0: "02698b27ac308b275671b3ca25436346469d04a5bba578ae39feba1d65897a6abc",
  1: "0281363910b0dc0015a4a25e758da30f0e28388ea5252c0e3713936f2d4ef7d3d5",
  13: "023ed9859c8b13f3797179bbe450587301d478c8259f6bec146ae6502318cc940a",
  100: "0294418c359ffe4ddf08d6f5a122547d41892adfe79595c16105285c81dbbeb657",
} as const
