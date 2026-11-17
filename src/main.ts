import "./style.css"
import { findAccount } from "./account"
import { copy } from "./copy"
import { byId, say } from "./dom"
import { ExitFileError, readExitFile, type ExitFile } from "./exitfile"
import { bitcoin, savedOn } from "./format"
import { piggyAnswers } from "./piggy"
import { chooseWay, looksLikeBitcoinAddress } from "./route"
import { slowScreen } from "./slow-screen"
import { closeSpark, openSpark, quoteAll, sendAll, type Quote, type SparkSession } from "./spark"
import { isSeedPhrase, normalizeWords, OpenError, openLockedSeed } from "./unlock"

declare const __VERSION__: string

/**
 * Open the exit file, then take the bitcoin out the way that works right now (route.ts):
 * the Piggy app when Piggy and Spark both answer, Spark itself when Piggy doesn't, Bitcoin itself
 * when Spark doesn't. Nothing is stored: the words live in memory until the bitcoin has gone out
 * or the person starts over.
 */

function start(): void {
  // GitHub Pages and saved copies can't send frame-ancestors: never run inside another site.
  if (window.top !== window.self) {
    const note = document.createElement("p")
    note.textContent = copy.framed
    document.body.replaceChildren(note)
    return
  }

  const ui = {
    pick: byId("pick"),
    choose: byId<HTMLButtonElement>("choose"),
    file: byId<HTMLInputElement>("file"),
    pickProblem: byId("pick-problem"),
    opened: byId("opened"),
    summaryAmount: byId("summary-amount"),
    summaryDate: byId("summary-date"),
    unlock: byId<HTMLFormElement>("unlock"),
    whoRow: byId("who-row"),
    who: byId<HTMLInputElement>("who"),
    password: byId<HTMLInputElement>("password"),
    open: byId<HTMLButtonElement>("open"),
    words: byId<HTMLFormElement>("words"),
    wordsNote: byId("words-note"),
    phrase: byId<HTMLTextAreaElement>("phrase"),
    check: byId<HTMLButtonElement>("check"),
    status: byId("status"),
    problem: byId("problem"),
    app: byId("app"),
    appTitle: byId("app-title"),
    appCant: byId<HTMLButtonElement>("app-cant"),
    spark: byId("spark"),
    sparkTitle: byId("spark-title"),
    sparkReady: byId("spark-ready"),
    sparkIncoming: byId("spark-incoming"),
    sparkKill: byId("spark-kill"),
    addressForm: byId<HTMLFormElement>("address-form"),
    address: byId<HTMLInputElement>("address"),
    getFee: byId<HTMLButtonElement>("get-fee"),
    quote: byId("quote"),
    quoteLine: byId("quote-line"),
    send: byId<HTMLButtonElement>("send"),
    otherAddress: byId<HTMLButtonElement>("other-address"),
    sparkStatus: byId("spark-status"),
    sparkProblem: byId("spark-problem"),
    sent: byId("sent"),
    sentTitle: byId("sent-title"),
    sentBody: byId("sent-body"),
    sentWatch: byId("sent-watch"),
    sentList: byId("sent-list"),
    bitcoin: byId("bitcoin"),
    bitcoinTitle: byId("bitcoin-title"),
    askAgain: byId<HTMLButtonElement>("ask-again"),
    startOver: byId<HTMLButtonElement>("start-over"),
  }

  const text: Record<string, string> = {
    eyebrow: copy.eyebrow,
    title: copy.pageTitle,
    lead: copy.lead,
    choose: copy.choose,
    where: copy.whereIsIt,
    "who-label": copy.savedAs,
    "password-label": copy.password,
    open: copy.open,
    "phrase-label": copy.wordsLabel,
    check: copy.check,
    "app-title": copy.appTitle,
    "app-body": copy.appBody,
    "app-get": copy.appGet,
    "app-cant": copy.appCantUse,
    "spark-title": copy.sparkTitle,
    "address-label": copy.addressLabel,
    "address-hint": copy.addressHint,
    "get-fee": copy.getFee,
    "other-address": copy.otherAddress,
    "sent-title": copy.sentTitle,
    "bitcoin-title": copy.bitcoinTitle,
    "bitcoin-body": copy.bitcoinBody,
    "ask-again": copy.askAgain,
    "start-over": copy.startOver,
    tagline: copy.tagline,
    version: copy.footer(__VERSION__),
    source: copy.source,
  }
  for (const [id, line] of Object.entries(text)) byId(id).textContent = line
  document.title = "Piggy exit"

  // The open file and, once it opens, what it takes to move the bitcoin. Memory only.
  let raw: string | null = null
  let file: ExitFile | null = null
  let words: string | null = null
  let account: number | null = null
  let session: SparkSession | null = null
  let quote: Quote | null = null

  const busy = (on: boolean, line: string | null = null) => {
    for (const control of [ui.password, ui.open, ui.phrase, ui.check]) control.disabled = on
    ui.status.textContent = line ?? ""
  }

  const sparkBusy = (on: boolean, line: string | null = null) => {
    for (const control of [ui.address, ui.getFee, ui.send, ui.otherAddress, ui.startOver]) control.disabled = on
    ui.sparkStatus.textContent = line ?? ""
  }

  // Let the browser paint the status line before scrypt holds the main thread for a few seconds.
  const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

  const hideWays = () => {
    for (const section of [ui.app, ui.spark, ui.sent, ui.bitcoin]) section.hidden = true
  }

  const show = (section: HTMLElement, heading: HTMLElement) => {
    hideWays()
    ui.opened.hidden = true
    section.hidden = false
    ui.startOver.hidden = section === ui.sent
    heading.focus()
  }

  /** The bitcoin went out (either way): show where, and forget the words. */
  const showSent = (amountSats: number, txids: string[]) => {
    ui.sentBody.textContent = copy.sentBody(bitcoin(amountSats), txids.length)
    ui.sentWatch.textContent = copy.sentWatch(txids.length)
    ui.sentList.replaceChildren(
      ...txids.map((txid) => {
        const item = document.createElement("li")
        const link = document.createElement("a")
        link.className = "txid"
        link.href = `https://mempool.space/tx/${encodeURIComponent(txid)}`
        link.rel = "noopener noreferrer"
        link.textContent = txid
        item.append(link)
        return item
      }),
    )
    words = null
    show(ui.sent, ui.sentTitle)
  }

  const slow = slowScreen({
    sent: showSent,
    lock: (on) => {
      ui.startOver.disabled = on
    },
  })

  const reset = async () => {
    slow.stop()
    const closing = session
    session = null
    quote = null
    raw = null
    file = null
    words = null
    account = null
    ui.file.value = ""
    ui.password.value = ""
    ui.phrase.value = ""
    ui.who.value = ""
    ui.address.value = ""
    busy(false)
    sparkBusy(false)
    say(ui.pickProblem, null)
    say(ui.problem, null)
    say(ui.sparkProblem, null)
    hideWays()
    ui.opened.hidden = true
    ui.startOver.hidden = true
    ui.pick.hidden = false
    await closeSpark(closing)
  }

  const showFile = (opened: ExitFile, text: string) => {
    raw = text
    file = opened
    ui.summaryAmount.textContent = bitcoin(opened.totalSats)
    say(ui.summaryDate, opened.createdAt ? copy.savedOn(savedOn(opened.createdAt)) : null)
    ui.pick.hidden = true
    ui.opened.hidden = false
    ui.unlock.hidden = true
    ui.words.hidden = true
    say(ui.problem, null)

    const seed = opened.seed
    if (seed?.kind === "locked") {
      ui.who.value = seed.passwordUser ?? ""
      ui.whoRow.hidden = seed.passwordUser === null
      ui.unlock.hidden = false
      ui.password.focus()
    } else {
      // The old format: every file the shipped apps wrote (up to 2.2.x), and a newer app's file
      // before the person locks the seed phrase into it. The person types their 12 words.
      ui.wordsNote.textContent = copy.noSeedInside
      ui.words.hidden = false
      ui.phrase.focus()
    }
  }

  /** The words must be a real seed phrase AND derive this file's identity key; then find the way out. */
  const verify = async (candidate: string, from: "file" | "typed") => {
    const opened = file
    if (!opened) return
    if (!isSeedPhrase(candidate)) {
      say(ui.problem, from === "typed" ? copy.notASeedPhrase : copy.insideDamaged)
      return
    }
    const found = await findAccount(candidate, opened.identity, opened.accountIndex)
    if (file !== opened) return
    if (found === null) {
      say(ui.problem, from === "typed" ? copy.anotherPiggy : copy.insideMismatch)
      return
    }
    ui.password.value = ""
    ui.phrase.value = ""
    words = candidate
    account = found
    await findWay()
  }

  /** Ask Spark and Piggy at once, then show the way that works (route.ts). */
  const findWay = async () => {
    const opened = file
    if (!opened || words === null || account === null) return
    slow.stop()
    ui.opened.hidden = false
    ui.unlock.hidden = true
    ui.words.hidden = true
    hideWays()
    busy(true, copy.asking)
    await closeSpark(session)
    session = null
    const [spark, piggy] = await Promise.all([openSpark(words, account), piggyAnswers()])
    busy(false)
    if (file !== opened) return
    session = spark
    switch (chooseWay(spark !== null, piggy)) {
      case "app":
        show(ui.app, ui.appTitle)
        break
      case "spark":
        showSpark()
        break
      case "bitcoin":
        show(ui.bitcoin, ui.bitcoinTitle)
        if (raw !== null) slow.start({ raw, words, account, totalSats: opened.totalSats })
        break
    }
  }

  const showSpark = () => {
    const current = session
    if (!current) return
    quote = null
    ui.quote.hidden = true
    say(ui.sparkProblem, null)
    const hasBitcoin = current.availableSats > 0
    ui.sparkReady.textContent = hasBitcoin ? copy.sparkReady(bitcoin(current.availableSats)) : copy.sparkEmpty
    say(ui.sparkIncoming, current.incomingSats > 0 ? copy.sparkIncoming(bitcoin(current.incomingSats)) : null)
    say(ui.sparkKill, hasBitcoin ? copy.killsPiggy : null)
    ui.addressForm.hidden = !hasBitcoin
    show(ui.spark, ui.sparkTitle)
    if (hasBitcoin) ui.address.focus()
  }

  ui.choose.addEventListener("click", () => ui.file.click())

  ui.file.addEventListener("change", async () => {
    const picked = ui.file.files?.[0]
    if (!picked) return
    say(ui.pickProblem, null)
    try {
      const text = await picked.text()
      showFile(readExitFile(text), text)
    } catch (error) {
      ui.file.value = ""
      const problem = error instanceof ExitFileError ? error.problem : "notExitFile"
      say(ui.pickProblem, problem === "testNetwork" ? copy.testNetwork : copy.notExitFile)
    }
  })

  ui.unlock.addEventListener("submit", async (event) => {
    event.preventDefault()
    const opened = file
    if (opened?.seed?.kind !== "locked") return
    const password = ui.password.value
    if (password.length === 0) {
      say(ui.problem, copy.typePassword)
      ui.password.focus()
      return
    }
    say(ui.problem, null)
    busy(true, copy.opening)
    await nextPaint()
    let opened_words: string
    try {
      opened_words = await openLockedSeed(opened.seed.armored, password)
    } catch (error) {
      busy(false)
      const problem = error instanceof OpenError ? error.problem : "wrongPassword"
      say(ui.problem, problem === "outOfMemory" ? copy.outOfMemory : copy.wrongPassword)
      ui.password.select()
      return
    }
    busy(false)
    await verify(opened_words, "file")
  })

  ui.words.addEventListener("submit", async (event) => {
    event.preventDefault()
    say(ui.problem, null)
    await verify(normalizeWords(ui.phrase.value), "typed")
  })

  ui.appCant.addEventListener("click", () => showSpark())

  ui.addressForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    const current = session
    if (!current) return
    const address = ui.address.value.trim()
    if (!looksLikeBitcoinAddress(address)) {
      say(ui.sparkProblem, copy.notAnAddress)
      ui.address.focus()
      return
    }
    say(ui.sparkProblem, null)
    sparkBusy(true, copy.pricing)
    try {
      const priced = await quoteAll(current, address)
      if (priced.arrivesSats <= 0) {
        say(ui.sparkProblem, copy.tooSmall)
        return
      }
      quote = priced
      ui.quoteLine.textContent = copy.quoteLine(bitcoin(priced.arrivesSats), bitcoin(priced.feeSats))
      ui.send.textContent = copy.send(bitcoin(priced.arrivesSats))
      ui.addressForm.hidden = true
      ui.quote.hidden = false
      ui.send.focus()
    } catch {
      say(ui.sparkProblem, copy.noQuote)
    } finally {
      sparkBusy(false)
    }
  })

  ui.otherAddress.addEventListener("click", () => {
    quote = null
    ui.quote.hidden = true
    ui.addressForm.hidden = false
    say(ui.sparkProblem, null)
    ui.address.select()
  })

  ui.send.addEventListener("click", async () => {
    const current = session
    const priced = quote
    if (!current || !priced) return
    const address = ui.address.value.trim()
    say(ui.sparkProblem, null)
    sparkBusy(true, copy.sending)
    try {
      const txid = await sendAll(current, address, priced)
      session = null
      showSent(priced.arrivesSats, [txid])
      await closeSpark(current)
    } catch {
      // Show what is still there before anyone tries again.
      try {
        const balance = await current.wallet.getBalance()
        current.availableSats = Number(balance.satsBalance.available)
        current.incomingSats = Number(balance.satsBalance.incoming)
      } catch {
        // Keep the last known numbers.
      }
      showSpark()
      say(ui.sparkProblem, copy.sendFailed)
    } finally {
      sparkBusy(false)
    }
  })

  ui.askAgain.addEventListener("click", () => void findWay())

  ui.startOver.addEventListener("click", async () => {
    await reset()
    ui.choose.focus()
  })

  void reset()
}

start()
