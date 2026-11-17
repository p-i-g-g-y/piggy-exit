import "./style.css"
import { findAccount } from "./account"
import { copy } from "./copy"
import { ExitFileError, readExitFile, type ExitFile } from "./exitfile"
import { bitcoin, savedOn } from "./format"
import { isSeedPhrase, normalizeWords, OpenError, openLockedSeed } from "./unlock"

declare const __VERSION__: string

/**
 * The Check: open an exit file, unlock its seed phrase, confirm the words
 * belong to the file's wallet, show what it holds. Nothing is sent anywhere (the CSP allows no
 * connections at all) and nothing is stored: the words live in local variables for one check.
 */

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`#${id} is missing`)
  return element as T
}

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
    summary: byId("summary"),
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
    result: byId("result"),
    verdict: byId("verdict"),
    holds: byId("holds"),
    details: byId("details"),
    warning: byId("warning"),
    again: byId<HTMLButtonElement>("again"),
  }

  const text: Record<string, string> = {
    title: copy.pageTitle,
    lead: copy.lead,
    choose: copy.choose,
    where: copy.whereIsIt,
    "who-label": copy.savedAs,
    "password-label": copy.password,
    open: copy.open,
    "phrase-label": copy.wordsLabel,
    check: copy.check,
    keep: copy.keepIt,
    "not-yet": copy.notYet,
    again: copy.checkAnother,
    version: copy.footer(__VERSION__),
    source: copy.source,
  }
  for (const [id, line] of Object.entries(text)) byId(id).textContent = line
  document.title = "Piggy exit"

  let file: ExitFile | null = null

  const say = (element: HTMLElement, line: string | null) => {
    element.textContent = line ?? ""
    element.hidden = line === null
  }

  const busy = (on: boolean, line: string | null = null) => {
    for (const control of [ui.password, ui.open, ui.phrase, ui.check]) control.disabled = on
    ui.status.textContent = line ?? ""
  }

  // Let the browser paint "Opening…" before scrypt holds the main thread for a few seconds.
  const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

  const reset = () => {
    file = null
    ui.file.value = ""
    ui.password.value = ""
    ui.phrase.value = ""
    ui.who.value = ""
    busy(false)
    say(ui.pickProblem, null)
    say(ui.problem, null)
    ui.opened.hidden = true
    ui.result.hidden = true
    ui.pick.hidden = false
  }

  const showFile = (opened: ExitFile) => {
    file = opened
    const amount = bitcoin(opened.totalSats)
    ui.summary.textContent = copy.summary(amount, opened.createdAt ? savedOn(opened.createdAt) : null)
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
    } else if (seed?.kind === "words") {
      void verify(normalizeWords(seed.words), "unlocked file")
    } else {
      ui.wordsNote.textContent = copy.noSeedInside
      ui.words.hidden = false
      ui.phrase.focus()
    }
  }

  const showResult = (opened: ExitFile, account: number, how: "password" | "unlocked file" | "typed") => {
    ui.password.value = ""
    ui.phrase.value = ""
    ui.verdict.textContent = how === "password" ? copy.opensWithPassword : copy.wordsMatch
    ui.holds.textContent = copy.holds(
      opened.totalSats > 0 ? bitcoin(opened.totalSats) : null,
      opened.createdAt ? savedOn(opened.createdAt) : null,
    )
    ui.details.textContent = copy.details(opened.leafCount, account)
    say(ui.warning, how === "unlocked file" ? copy.notLocked : null)
    ui.opened.hidden = true
    ui.result.hidden = false
    ui.verdict.focus()
  }

  /** The words must be a real seed phrase AND derive this file's identity key. */
  const verify = async (words: string, how: "password" | "unlocked file" | "typed") => {
    const opened = file
    if (!opened) return
    if (!isSeedPhrase(words)) {
      say(ui.problem, how === "typed" ? copy.notASeedPhrase : copy.insideDamaged)
      return
    }
    busy(true, copy.checking)
    try {
      const account = await findAccount(words, opened.identity, opened.accountIndex)
      if (file !== opened) return
      if (account === null) {
        say(ui.problem, how === "typed" ? copy.anotherPiggy : copy.insideMismatch)
        return
      }
      showResult(opened, account, how)
    } finally {
      busy(false)
    }
  }

  ui.choose.addEventListener("click", () => ui.file.click())

  ui.file.addEventListener("change", async () => {
    const picked = ui.file.files?.[0]
    if (!picked) return
    say(ui.pickProblem, null)
    try {
      showFile(readExitFile(await picked.text()))
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
    let words: string
    try {
      words = await openLockedSeed(opened.seed.armored, password)
    } catch (error) {
      busy(false)
      const problem = error instanceof OpenError ? error.problem : "wrongPassword"
      say(ui.problem, problem === "outOfMemory" ? copy.outOfMemory : copy.wrongPassword)
      ui.password.select()
      return
    }
    busy(false)
    await verify(words, "password")
  })

  ui.words.addEventListener("submit", async (event) => {
    event.preventDefault()
    say(ui.problem, null)
    await verify(normalizeWords(ui.phrase.value), "typed")
  })

  ui.again.addEventListener("click", () => {
    reset()
    ui.choose.focus()
  })

  reset()
}

start()
