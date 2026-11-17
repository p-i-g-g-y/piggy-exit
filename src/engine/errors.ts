// Vendored from github.com/blinkbitcoin/spark-unilateral-exit @ 1132b77f5e42, errors.ts
// (MIT, Copyright (c) 2026 Blink Technologies LLC; see ./LICENSE). Piggy changes: v2 import paths only.

// Extract a human-readable message from an unknown thrown value. Shared so the
// several catch sites that surface an error's text render it the same way.
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
