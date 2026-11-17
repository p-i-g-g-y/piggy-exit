import { describe, expect, it } from "vitest"
import { piggyAnswers, PIGGY_STATUS_URL } from "../src/piggy"
import { chooseWay, looksLikeBitcoinAddress, satsOf } from "../src/route"

describe("the way out (bü.b's order)", () => {
  it("sends people to the app when Spark and Piggy both answer", () => {
    expect(chooseWay(true, true)).toBe("app")
  })

  it("goes through Spark when Piggy doesn't answer", () => {
    expect(chooseWay(true, false)).toBe("spark")
  })

  it("goes through Bitcoin itself whenever Spark doesn't answer", () => {
    expect(chooseWay(false, false)).toBe("bitcoin")
    expect(chooseWay(false, true)).toBe("bitcoin")
  })
})

describe("Spark amounts", () => {
  it("reads every unit the service provider quotes in, rounding fees up", () => {
    expect(satsOf({ originalValue: 1165, originalUnit: "SATOSHI" })).toBe(1165)
    expect(satsOf({ originalValue: 1_165_001, originalUnit: "MILLISATOSHI" })).toBe(1166)
    expect(satsOf({ originalValue: 0.00001165, originalUnit: "BITCOIN" })).toBe(1165)
    expect(() => satsOf({ originalValue: 1, originalUnit: "USD" })).toThrow()
  })
})

describe("Bitcoin addresses", () => {
  it("takes mainnet addresses", () => {
    expect(looksLikeBitcoinAddress("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe(true)
    expect(looksLikeBitcoinAddress("BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ")).toBe(true)
    expect(looksLikeBitcoinAddress("bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297")).toBe(true)
    expect(looksLikeBitcoinAddress(" 1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2 ")).toBe(true)
    expect(looksLikeBitcoinAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe(true)
  })

  it("refuses what plainly isn't one", () => {
    expect(looksLikeBitcoinAddress("")).toBe(false)
    expect(looksLikeBitcoinAddress("tb1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe(false)
    expect(looksLikeBitcoinAddress("bc1Qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe(false)
    expect(looksLikeBitcoinAddress("archi@pig.gy")).toBe(false)
    expect(looksLikeBitcoinAddress("0BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).toBe(false)
  })
})

describe("does Piggy answer", () => {
  const answering = (status: number, body: unknown): typeof fetch =>
    (async (url: string | URL | Request) => {
      expect(String(url)).toBe(PIGGY_STATUS_URL)
      return new Response(JSON.stringify(body), { status })
    }) as typeof fetch

  it("is up only when the status endpoint says so", async () => {
    expect(await piggyAnswers(answering(200, { piggy: "up" }))).toBe(true)
    expect(await piggyAnswers(answering(200, { piggy: "down" }))).toBe(false)
    expect(await piggyAnswers(answering(404, {}))).toBe(false)
    expect(await piggyAnswers(answering(503, { piggy: "up" }))).toBe(false)
  })

  it("is down when nothing answers", async () => {
    const unreachable = (async () => {
      throw new TypeError("Failed to fetch")
    }) as typeof fetch
    expect(await piggyAnswers(unreachable)).toBe(false)
  })
})
