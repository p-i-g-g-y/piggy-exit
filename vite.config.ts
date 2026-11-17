/// <reference types="vitest/config" />
import { readFileSync } from "node:fs"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }

// One self-contained HTML file: every script and style inlined, nothing fetched at load
// (scripts/finalize.mjs then pins them with CSP hashes and writes SHA256SUMS).
export default defineConfig({
  define: { __VERSION__: JSON.stringify(version) },
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: "es2023",
    modulePreload: false,
    sourcemap: false,
    reportCompressedSize: false,
  },
  test: {
    // Opening a real exit file runs scrypt at work factor 18 (256 MiB), a few seconds each.
    testTimeout: 60_000,
  },
})
