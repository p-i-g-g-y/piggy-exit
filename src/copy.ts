/**
 * Every line the page shows, in one place, in Piggy's voice: no em dashes, ₿ amounts (never
 * "sats"), "bitcoin" for the money, no banking words. test/copy.test.ts holds the rules.
 */
export const copy = {
  eyebrow: "Piggy emergency exit",
  pageTitle: "Take your bitcoin back",
  lead: "Open your Piggy emergency exit file to take your bitcoin back, even if Piggy is gone. Your file and your password never leave this device.",
  noScript: "This page needs JavaScript to open your file.",
  choose: "Choose your exit file",
  whereIsIt: "On iPhone it's in Files › iCloud Drive › Piggy. On Android it's wherever you saved it.",
  notExitFile: "This isn't a Piggy exit file.",
  testNetwork: "This file is for a test network, not real bitcoin.",
  savedOn: (date: string): string => `Saved ${date}`,
  savedAs: "Saved as",
  password: "Password",
  typePassword: "Type the password for this file.",
  open: "Open",
  opening: "Opening… This takes a few seconds.",
  wrongPassword: "That password doesn't open this file.",
  outOfMemory: "This device ran out of memory opening the file. Try a computer.",
  noSeedInside: "This file doesn't carry your seed phrase. Type your 12 words to open it.",
  wordsLabel: "Your 12 words",
  check: "Continue",
  notASeedPhrase: "Those words aren't a seed phrase. Check each word and their order.",
  anotherPiggy: "These words belong to another piggy.",
  insideDamaged: "The seed phrase inside this file is damaged.",
  insideMismatch: "The seed phrase inside belongs to another piggy, not this file's.",
  asking: "Checking whether Spark and Piggy answer…",

  // Spark and Piggy both answer: the app.
  appTitle: "Piggy is working",
  appBody: "The easiest way to take your bitcoin back is the Piggy app: open your piggy and break it open. On a new phone, install Piggy and sign in with your passkey.",
  appGet: "Get Piggy",
  appCantUse: "I can't use the app",

  // Piggy doesn't, Spark does: the quick way.
  sparkTitle: "Take your bitcoin out",
  sparkReady: (amount: string): string => `${amount} is ready to go. It goes to any Bitcoin address you choose, in one payment.`,
  sparkIncoming: (amount: string): string => `${amount} more is still arriving. Check again in a minute to take it too.`,
  sparkEmpty: "There's no bitcoin on Spark for this piggy.",
  addressLabel: "Bitcoin address",
  addressHint: "From any wallet or exchange that holds bitcoin.",
  notAnAddress: "That isn't a Bitcoin address.",
  getFee: "Check the fee",
  pricing: "Asking Spark for the fee…",
  noQuote: "Spark couldn't price this. Check the address and try again.",
  quoteLine: (arrives: string, fee: string): string => `${arrives} arrives at this address. Spark and the Bitcoin network take ${fee}.`,
  tooSmall: "That's less than the fee, so there's nothing left to send.",
  send: (amount: string): string => `Send ${amount}`,
  otherAddress: "Use another address",
  sending: "Sending… Keep this page open.",
  sendFailed: "That didn't go through. The amount above is what's still there; try again in a minute.",
  sentTitle: "Your bitcoin is on its way",
  sentBody: (amount: string, transactions: number): string =>
    transactions === 1
      ? `${amount} goes to your address in one Bitcoin transaction. It usually confirms within the hour.`
      : `${amount} goes to your address in ${transactions} Bitcoin transactions. They usually confirm within the hour.`,
  sentWatch: (transactions: number): string =>
    transactions === 1 ? "Watch it confirm on mempool.space:" : "Watch them confirm on mempool.space:",

  // Spark doesn't answer: the slow way, through Bitcoin itself.
  bitcoinTitle: "Spark isn't answering",
  bitcoinBody: "Without Spark, your bitcoin comes out through Bitcoin itself, using the transactions saved in this file. It can take up to two weeks.",
  slowLooking: "Looking up your bitcoin on the Bitcoin network…",
  slowNoNetwork: "This page can't reach the Bitcoin network right now. Check your connection, then check again.",
  slowUnreadable: "This page can't read the Bitcoin transactions saved in this file. If you have a newer exit file, open that one.",
  slowBack: (amount: string): string => `${amount} can come back to you this way.`,
  slowStranded: (amount: string): string => `${amount} is in pieces too small to be worth taking out this way.`,
  slowNotWorth: (amount: string): string => `Bitcoin network fees would cost more than the ${amount} in this file. Check again when fees are lower.`,
  slowFund: (amount: string): string =>
    `To start, send ${amount} to this address from any Bitcoin wallet. It pays the network fees along the way, and what's left comes back to you at the end.`,
  slowFundMore: (amount: string): string => `Send ${amount} more to this address to keep going. It pays the network fees, and what's left comes back to you at the end.`,
  slowCopy: "Copy address",
  slowCopied: "Copied",
  slowOpenWallet: "Open in a wallet",
  slowWatching: "Waiting for your payment…",
  slowSeen: (amount: string): string => `${amount} has arrived. Waiting for the Bitcoin network to confirm it, usually 10 to 60 minutes.`,
  slowResume: "You can close this page. Open your file here again to pick up where you left off.",
  slowSplitting: "Getting the fee money ready…",
  slowPushing: (there: number, total: number): string =>
    `Moving your bitcoin onto the Bitcoin network: ${there} of ${total} ${total === 1 ? "piece" : "pieces"} so far. Each step waits for a block, about 10 minutes.`,
  slowKeepOpen: "Keep this page open while it works. If it closes, open your file here again to pick up where you left off.",
  slowWait: (date: string): string =>
    `Your bitcoin is on its way out. Bitcoin holds it until about ${date}, then this page can send it to your wallet. Come back then with this file and its password. That visit takes about half an hour.`,
  slowCalendar: "Add a reminder",
  slowAlmost: (amount: string): string => `${amount} is almost out. It needs one more Bitcoin block, about 10 minutes.`,
  slowReady: (amount: string): string => `${amount} is ready to go to your wallet.`,
  slowQuote: (arrives: string, fee: string): string => `${arrives} arrives at this address. The Bitcoin network takes ${fee}.`,
  slowSendFailed: "That didn't all go through. Check again in a minute to send the rest.",
  slowStuck: (pieces: number): string =>
    pieces === 1
      ? "1 piece couldn't be moved this time. Check again to retry it."
      : `${pieces} pieces couldn't be moved this time. Check again to retry them.`,
  slowAlreadySent: "Your bitcoin already went out to your wallet.",
  slowTrouble: "Something went wrong moving your bitcoin. Check again to pick up where it left off.",
  askAgain: "Check again",

  startOver: "Start over",
  framed: "Open this page on its own, not inside another site.",
  tagline: "Yours, even without Piggy.",
  footer: (version: string): string => `Piggy exit ${version}`,
  source: "open source",
}

/** Every fixed line, plus samples of the built ones, for the voice test. */
export const allLines = (): string[] => [
  ...Object.values(copy).filter((value): value is string => typeof value === "string"),
  copy.savedOn("Nov 17, 2026"),
  copy.sparkReady("₿72,965"),
  copy.sparkIncoming("₿2,100"),
  copy.quoteLine("₿71,800", "₿1,165"),
  copy.send("₿71,800"),
  copy.sentBody("₿71,800", 1),
  copy.sentBody("₿71,800", 3),
  copy.sentWatch(1),
  copy.sentWatch(3),
  copy.slowBack("₿70,100"),
  copy.slowStranded("₿512"),
  copy.slowNotWorth("₿4,608"),
  copy.slowFund("₿9,400"),
  copy.slowFundMore("₿1,200"),
  copy.slowSeen("₿9,400"),
  copy.slowPushing(1, 1),
  copy.slowPushing(2, 5),
  copy.slowWait("Dec 1, 2026"),
  copy.slowAlmost("₿70,100"),
  copy.slowReady("₿70,100"),
  copy.slowQuote("₿69,900", "₿1,400"),
  copy.slowStuck(1),
  copy.slowStuck(2),
  copy.footer("0.2.1"),
]
