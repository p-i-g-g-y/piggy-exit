/**
 * Every line the page shows, in one place, in Piggy's voice: no em dashes, ₿ amounts (never
 * "sats"), "bitcoin" for the money, no banking words. test/copy.test.ts holds the rules.
 */
export const copy = {
  pageTitle: "Take your bitcoin back",
  lead: "Open your Piggy emergency exit file here to check it. Everything happens on this device: nothing you open or type on this page leaves it.",
  noScript: "This page needs JavaScript to open your file.",
  choose: "Choose your exit file",
  whereIsIt: "On iPhone it's in Files › iCloud Drive › Piggy. On Android it's wherever you saved it.",
  notExitFile: "This isn't a Piggy exit file.",
  testNetwork: "This file is for a test network, not real bitcoin.",
  summary: (amount: string, date: string | null): string => (date ? `Saved ${date} · ${amount}` : amount),
  savedAs: "Saved as",
  password: "Password",
  typePassword: "Type the password for this file.",
  open: "Open",
  opening: "Opening… This takes a few seconds.",
  wrongPassword: "That password doesn't open this file.",
  outOfMemory: "This device ran out of memory opening the file. Try a computer.",
  noSeedInside: "This file doesn't carry your seed phrase. If you have your 12 words, type them here.",
  wordsLabel: "Your 12 words",
  check: "Check",
  checking: "Checking…",
  notASeedPhrase: "Those words aren't a seed phrase. Check each word and their order.",
  anotherPiggy: "These words belong to another piggy.",
  insideDamaged: "The seed phrase inside this file is damaged.",
  insideMismatch: "The seed phrase inside belongs to another piggy, not this file's.",
  opensWithPassword: "This file opens with your password.",
  wordsMatch: "Your seed phrase matches this file.",
  notLocked: "This file isn't locked with a password. Anyone who reads it can take your bitcoin.",
  holds: (amount: string | null, date: string | null): string => {
    const what = amount ? `It holds ${amount}` : "It holds no bitcoin"
    return date ? `${what}, saved ${date}.` : `${what}.`
  },
  details: (pieces: number, account: number): string =>
    `${pieces} ${pieces === 1 ? "piece" : "pieces"} · account ${account}`,
  keepIt: "Keep this file and your password safe. If Piggy ever goes away, bring them back to this page.",
  notYet: "For now this page checks your file. Taking your bitcoin out from here comes next.",
  checkAnother: "Check another file",
  framed: "Open this page on its own, not inside another site.",
  footer: (version: string): string => `Piggy exit ${version}`,
  source: "open source",
}

/** Every fixed line, plus samples of the built ones, for the voice test. */
export const allLines = (): string[] => [
  ...Object.values(copy).filter((value): value is string => typeof value === "string"),
  copy.summary("₿72,965", "Nov 17, 2026"),
  copy.holds("₿72,965", "Nov 17, 2026"),
  copy.holds(null, null),
  copy.details(1, 0),
  copy.details(6, 13),
  copy.footer("0.1.0"),
]
