/**
 * Piggy's own servers. When they answer (and Spark does too), the Piggy app is the way out.
 * `GET /v1/exit/status` carries no data and is open to any origin, since this page also runs from
 * GitHub Pages and from a saved copy.
 */
export const PIGGY_STATUS_URL = "https://api.pig.gy/v1/exit/status"

export async function piggyAnswers(fetcher: typeof fetch = fetch, timeoutMs = 8_000): Promise<boolean> {
  try {
    const response = await fetcher(PIGGY_STATUS_URL, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      credentials: "omit",
    })
    if (!response.ok) return false
    const body = (await response.json()) as { piggy?: unknown }
    return body.piggy === "up"
  } catch {
    return false
  }
}
