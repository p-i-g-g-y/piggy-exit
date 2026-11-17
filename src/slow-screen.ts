import { copy } from "./copy"
import { byId, say } from "./dom"
import { EsploraError } from "./engine/esplora.ts"
import { bitcoin, savedOn } from "./format"
import {
  abortableSleep,
  calendarFile,
  CHAIN,
  ESPLORA,
  feeMoneyDone,
  fundingNeed,
  isBitcoinAddress,
  paymentLink,
  prepareSweep,
  progressOf,
  push,
  readySats,
  refundsOf,
  sendSweep,
  splitTransaction,
  survey,
  totalsOf,
  usableUtxos,
  waitingUntil,
  type Refund,
  type Survey,
  type Sweep,
} from "./slow"

/**
 * The slow way on the page (slow.ts does the work): look the pieces up on the chain, ask for the
 * fee money when a step can move, push while the page stays open, say when the timelock opens,
 * then send everything to the person's address. Every visit starts over from the chain.
 */

export interface SlowWay {
  raw: string
  words: string
  account: number
  /** The file's total, for when nothing is worth taking out. */
  totalSats: number
}

export interface SlowScreen {
  start(way: SlowWay): void
  stop(): void
}

const FUNDING_POLL_MS = 30_000
const CONFIRMING_POLL_MS = 60_000
/** Pushes per visit before the page stops and says what it couldn't move. */
const MAX_PUSHES = 10
const DAY_MS = 24 * 60 * 60 * 1000
/** Where a saved copy of the page sends people back to, in the reminder. */
const HOSTED_PAGE = "https://p-i-g-g-y.github.io/piggy-exit/"

export function slowScreen(hooks: {
  /** The bitcoin went out: show the sent screen (main forgets the words there). */
  sent: (amountSats: number, txids: string[]) => void
  /** Keep the person from leaving mid-send. */
  lock: (on: boolean) => void
}): SlowScreen {
  const ui = {
    back: byId("slow-back"),
    stranded: byId("slow-stranded"),
    fund: byId("slow-fund"),
    fundLine: byId("slow-fund-line"),
    feeAddress: byId("slow-fee-address"),
    copyAddress: byId<HTMLButtonElement>("slow-copy"),
    openWallet: byId<HTMLAnchorElement>("slow-open-wallet"),
    wait: byId("slow-wait"),
    waitLine: byId("slow-wait-line"),
    calendar: byId<HTMLAnchorElement>("slow-calendar"),
    sweep: byId<HTMLFormElement>("slow-sweep"),
    ready: byId("slow-ready"),
    address: byId<HTMLInputElement>("slow-address"),
    getFee: byId<HTMLButtonElement>("slow-get-fee"),
    quote: byId("slow-quote"),
    quoteLine: byId("slow-quote-line"),
    send: byId<HTMLButtonElement>("slow-send"),
    other: byId<HTMLButtonElement>("slow-other"),
    status: byId("slow-status"),
    note: byId("slow-note"),
    problem: byId("slow-problem"),
    askAgain: byId<HTMLButtonElement>("ask-again"),
  }

  const text: Array<[HTMLElement, string]> = [
    [ui.copyAddress, copy.slowCopy],
    [ui.openWallet, copy.slowOpenWallet],
    [ui.calendar, copy.slowCalendar],
    [byId("slow-address-label"), copy.addressLabel],
    [byId("slow-address-hint"), copy.addressHint],
    [ui.getFee, copy.getFee],
    [ui.other, copy.otherAddress],
  ]
  for (const [element, line] of text) element.textContent = line

  let way: SlowWay | null = null
  let run: AbortController | null = null
  /** What the sweep form signs from: the last survey and its refunds. */
  let current: { s: Survey; refunds: Refund[]; includeFeeMoney: boolean } | null = null
  let signed: Sweep | null = null
  let calendarUrl: string | null = null
  let shownAsk: number | null = null

  // The screen stays on while the page pushes or waits for money; phones pause hidden pages.
  let wake: WakeLockSentinel | null = null
  let wantAwake = false
  const keepAwake = async (on: boolean) => {
    wantAwake = on
    if (!on) {
      const held = wake
      wake = null
      await held?.release().catch(() => undefined)
      return
    }
    if (wake || !("wakeLock" in navigator) || document.visibilityState !== "visible") return
    try {
      wake = await navigator.wakeLock.request("screen")
      wake.addEventListener("release", () => {
        wake = null
      })
    } catch {
      // Low battery mode or no permission: the page still works while it's in front.
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (wantAwake && document.visibilityState === "visible") void keepAwake(true)
  })

  const status = (line: string | null) => {
    ui.status.textContent = line ?? ""
  }

  const clear = () => {
    for (const element of [ui.back, ui.stranded, ui.fund, ui.wait, ui.sweep, ui.quote, ui.note, ui.problem]) element.hidden = true
    status(null)
    if (calendarUrl) URL.revokeObjectURL(calendarUrl)
    calendarUrl = null
    current = null
    signed = null
    shownAsk = null
  }

  const showFund = (address: string, askSats: number, more: boolean) => {
    if (shownAsk !== askSats) {
      ui.fundLine.textContent = more ? copy.slowFundMore(bitcoin(askSats)) : copy.slowFund(bitcoin(askSats))
      ui.feeAddress.textContent = address
      ui.openWallet.href = paymentLink(address, askSats)
      shownAsk = askSats
    }
    ui.fund.hidden = false
  }

  const showWait = (date: Date) => {
    ui.waitLine.textContent = copy.slowWait(savedOn(date))
    const page = location.protocol === "https:" ? `${location.origin}${location.pathname}` : HOSTED_PAGE
    // The reminder lands a day after the estimate: blocks don't keep exact time.
    const file = calendarFile(new Date(date.getTime() + DAY_MS), page)
    calendarUrl = URL.createObjectURL(new Blob([file], { type: "text/calendar" }))
    ui.calendar.href = calendarUrl
    ui.wait.hidden = false
  }

  /** Waits for the fee money, splits it into one coin per piece, then pushes. */
  const fundAndPush = async (w: SlowWay, s: Survey, signal: AbortSignal): Promise<"aborted" | "trouble" | { failed: number }> => {
    const sleep = abortableSleep(signal)
    let splitting = false
    let lastSplit: string | null = null
    try {
      for (;;) {
        const need = fundingNeed(s.pieces, s.utxos, s.feeRate)
        if (need.kind === "ready") break
        if (need.kind === "send") {
          showFund(s.feeAddress, need.askSats, need.seenSats > 0)
          status(copy.slowWatching)
          say(ui.note, copy.slowResume)
          void keepAwake(true)
        } else if (need.kind === "split") {
          ui.fund.hidden = true
          status(copy.slowSplitting)
          const split = splitTransaction(s, need.amounts)
          // Esplora can list a coin a moment after it's spent: the same split twice is one split.
          if (split.txid !== lastSplit) {
            await CHAIN.broadcast(split.txHex, ESPLORA)
            lastSplit = split.txid
          }
          splitting = true
        } else {
          ui.fund.hidden = true
          status(splitting ? copy.slowSplitting : copy.slowSeen(bitcoin(need.seenSats)))
          say(ui.note, copy.slowResume)
        }
        await sleep(FUNDING_POLL_MS)
        try {
          s.utxos = await usableUtxos(s.feeAddress)
        } catch {
          // Esplora hiccup: look again next time round.
        }
      }
      ui.fund.hidden = true
      say(ui.note, copy.slowKeepOpen)
      void keepAwake(true)
      const total = s.pieces.filter((piece) => piece.worthIt).length
      status(copy.slowPushing(0, total))
      const result = await push(
        s,
        w.words,
        w.account,
        (leaves) => {
          const progress = progressOf(leaves)
          status(copy.slowPushing(progress.there, progress.total))
        },
        sleep,
      )
      return { failed: progressOf(result.leaves).failed }
    } catch {
      return signal.aborted ? "aborted" : "trouble"
    } finally {
      void keepAwake(false)
    }
  }

  const flow = async (w: SlowWay, signal: AbortSignal) => {
    const sleep = abortableSleep(signal)
    // A push that ended with pieces it couldn't move doesn't run again until "Check again".
    let stuck = 0
    let pushes = 0
    for (;;) {
      clear()
      status(copy.slowLooking)
      let s: Survey
      let refunds: Refund[]
      try {
        s = await survey(w.raw, w.words, w.account)
        refunds = await refundsOf(s.pieces)
      } catch (error) {
        if (signal.aborted) return
        clear()
        // Esplora's errors are the network's; anything else is the file's tree the SDK can't read.
        say(ui.problem, error instanceof EsploraError ? copy.slowNoNetwork : copy.slowUnreadable)
        return
      }
      if (signal.aborted) return
      status(null)

      const totals = totalsOf(s.pieces)
      if (totals.pieces === 0) {
        say(ui.back, copy.slowNotWorth(bitcoin(w.totalSats)))
        return
      }
      say(ui.back, copy.slowBack(bitcoin(totals.backSats)))
      if (totals.strandedSats > 0) say(ui.stranded, copy.slowStranded(bitcoin(totals.strandedSats)))

      const pushable = s.pieces.filter((piece) => piece.worthIt && piece.stage === "push").length
      if (pushable > 0 && pushes >= MAX_PUSHES) stuck = pushable
      if (stuck === 0 && pushable > 0) {
        // autoExit returns once nothing can move; a piece that still looks movable gets a pause first.
        if (pushes > 0) {
          try {
            await sleep(FUNDING_POLL_MS)
          } catch {
            return
          }
        }
        pushes += 1
        const outcome = await fundAndPush(w, s, signal)
        if (outcome === "aborted") return
        if (outcome === "trouble") {
          status(null)
          ui.note.hidden = true
          say(ui.problem, copy.slowTrouble)
          return
        }
        stuck = outcome.failed
        continue
      }

      // Nothing moves on its own now: send what's out, say when the rest opens.
      const unknown = s.pieces.filter((piece) => piece.worthIt && piece.stage === "unknown").length
      if (unknown + stuck > 0) say(ui.problem, copy.slowStuck(unknown + stuck))
      const until = waitingUntil(s.pieces, s.tip)
      if (until) showWait(until.date)

      const confirming = refunds.filter((refund) => refund.state === "confirming")
      if (confirming.length > 0) {
        // One block from ready: wait for it, so everything goes in one visit.
        say(ui.note, copy.slowAlmost(bitcoin(confirming.reduce((all, refund) => all + refund.valueSats, 0))))
        try {
          await sleep(CONFIRMING_POLL_MS)
        } catch {
          return
        }
        continue
      }

      const includeFeeMoney = feeMoneyDone(s.pieces, refunds)
      const readyNow = readySats(s, refunds, includeFeeMoney)
      const refundsReady = refunds.some((refund) => refund.state === "ready")
      if (refundsReady || (includeFeeMoney && readyNow >= 1_000)) {
        current = { s, refunds, includeFeeMoney }
        say(ui.ready, copy.slowReady(bitcoin(readyNow)))
        ui.sweep.hidden = false
        ui.address.focus()
        return
      }
      if (!until && unknown + stuck === 0 && refunds.length > 0 && refunds.every((refund) => refund.state === "sent")) {
        say(ui.back, copy.slowAlreadySent)
      }
      return
    }
  }

  ui.copyAddress.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ui.feeAddress.textContent ?? "")
      ui.copyAddress.textContent = copy.slowCopied
      setTimeout(() => {
        ui.copyAddress.textContent = copy.slowCopy
      }, 2_000)
    } catch {
      // No clipboard (an old browser, a saved copy): select it for a manual copy.
      const range = document.createRange()
      range.selectNodeContents(ui.feeAddress)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
  })

  ui.sweep.addEventListener("submit", (event) => {
    event.preventDefault()
    const at = current
    const w = way
    if (!at || !w) return
    const address = ui.address.value.trim()
    if (!isBitcoinAddress(address)) {
      say(ui.problem, copy.notAnAddress)
      ui.address.focus()
      return
    }
    say(ui.problem, null)
    const sweep = prepareSweep(at.s, at.refunds, w.words, w.account, address, at.includeFeeMoney)
    if (sweep.transactions.length === 0) {
      say(ui.problem, copy.slowTrouble)
      return
    }
    signed = sweep
    ui.quoteLine.textContent = copy.slowQuote(bitcoin(sweep.arrivesSats), bitcoin(sweep.feeSats))
    ui.send.textContent = copy.send(bitcoin(sweep.arrivesSats))
    ui.sweep.hidden = true
    ui.quote.hidden = false
    ui.send.focus()
  })

  ui.other.addEventListener("click", () => {
    signed = null
    ui.quote.hidden = true
    ui.sweep.hidden = false
    say(ui.problem, null)
    ui.address.select()
  })

  const sending = (on: boolean) => {
    for (const control of [ui.address, ui.getFee, ui.send, ui.other, ui.askAgain]) control.disabled = on
    hooks.lock(on)
    status(on ? copy.sending : null)
  }

  ui.send.addEventListener("click", async () => {
    const sweep = signed
    if (!sweep) return
    say(ui.problem, null)
    sending(true)
    const result = await sendSweep(sweep)
    sending(false)
    if (result.failed === 0) {
      stop()
      hooks.sent(result.sentSats, result.txids)
      return
    }
    // What went is on its way; "Check again" finds it spent and offers the rest.
    signed = null
    ui.quote.hidden = true
    say(ui.problem, copy.slowSendFailed)
  })

  const stop = () => {
    run?.abort()
    run = null
    way = null
    void keepAwake(false)
    clear()
  }

  return {
    start(next: SlowWay) {
      stop()
      way = next
      run = new AbortController()
      void flow(next, run.signal)
    },
    stop,
  }
}
