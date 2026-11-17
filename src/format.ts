// Piggy writes amounts as ₿ and a whole number (BIP-177), en-US grouping: ₿72,965.
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })

export const bitcoin = (sats: number): string => `₿${whole.format(sats)}`
export const savedOn = (date: Date): string => day.format(date)
