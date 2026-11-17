import { describe, expect, it } from "vitest"
import { allLines } from "../src/copy"
import { bitcoin, savedOn } from "../src/format"

// Piggy's voice for everything people see (the apps' copy rules).
describe("the page's words", () => {
  const lines = allLines()

  it.each(lines)("%s", (line) => {
    expect(line).not.toMatch(/[—–]/)
    expect(line).not.toMatch(/\bsats?\b/i)
    expect(line).not.toMatch(/withdraw|deposit/i)
    expect(line).not.toMatch(/write (it|them) down/i)
    expect(line).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})

describe("amounts and dates", () => {
  it("writes ₿ amounts with en-US grouping", () => {
    expect(bitcoin(72_965)).toBe("₿72,965")
    expect(bitcoin(0)).toBe("₿0")
    expect(bitcoin(2_100_000_000_000_000)).toBe("₿2,100,000,000,000,000")
  })

  it("writes short dates", () => {
    expect(savedOn(new Date("2026-11-17T12:00:00Z"))).toBe("Nov 17, 2026")
  })
})
