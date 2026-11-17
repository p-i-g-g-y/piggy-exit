// After `vite build`: lock dist/index.html down and stamp the release files.
//
// 1. Nothing external: the page must be one self-contained file (no script src, no stylesheet
//    or preload links, no embedded elements, no CSS url() outside data:).
// 2. A Content-Security-Policy meta tag that allows exactly the inlined script and style (by
//    SHA-256), WebAssembly (Spark's signing), and connections to the few hosts the way out needs.
//    pig.gy/exit adds frame-ancestors and the other headers a meta tag can't carry.
// 3. dist/piggy-exit-<version>.html (byte-identical) and dist/SHA256SUMS.
import { createHash } from "node:crypto"
import { copyFileSync, readFileSync, writeFileSync } from "node:fs"

/**
 * Everything the page may talk to: Piggy's status endpoint, Spark's three signing operators and
 * its service provider (the cooperative exit), and two public Bitcoin explorers for the slow way:
 * blockstream.info (Esplora: coins, fees, broadcasts) and mempool.space (the Spark SDK checks
 * there whether each exit transaction is already out). The operator list follows the Spark SDK's
 * mainnet config; when Spark changes operators, a new release must follow.
 */
const CONNECT = [
  "https://api.pig.gy",
  "https://0.spark.lightspark.com",
  "https://spark-operator.breez.technology",
  "https://2.spark.flashnet.xyz",
  "https://api.lightspark.com",
  "https://blockstream.info",
  "https://mempool.space",
]

const fail = (message) => {
  console.error(`finalize: ${message}`)
  process.exit(1)
}

const { version } = JSON.parse(readFileSync("package.json", "utf8"))
const page = "dist/index.html"
let html = readFileSync(page, "utf8")

const sha256 = (body) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`
const element = (tag) => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi")

const scripts = [...html.matchAll(element("script"))].map((m) => m[1])
const styles = [...html.matchAll(element("style"))].map((m) => m[1])
if (scripts.length !== 1 || styles.length !== 1) fail(`expected one inline script and one style, got ${scripts.length} and ${styles.length}`)

// The markup with the script and style bodies taken out: what's left must hold no other script,
// no linked or embedded resource and no inline style.
const markup = html.replace(element("script"), "<script></script>").replace(element("style"), "<style></style>")
const external = [
  [/<script\b[^>]*\bsrc\s*=/i, "a script loaded from elsewhere"],
  [/<link\b[^>]*\brel\s*=\s*["']?(?:stylesheet|modulepreload|preload|prefetch)/i, "a linked resource"],
  [/<(?:img|iframe|object|embed|video|audio|source)\b/i, "an embedded element"],
  [/\sstyle\s*=/i, "an inline style attribute (the CSP allows none)"],
]
for (const [pattern, what] of external) {
  if (pattern.test(markup)) fail(`${what} in ${page}`)
}
if ((markup.match(/<script\b/gi) ?? []).length !== 1) fail("a second <script> in the markup")
if (/url\(\s*["']?(?!data:)[^)'"\s]/i.test(styles[0])) fail("a CSS url() that isn't data:")

const csp = [
  "default-src 'none'",
  `script-src ${sha256(scripts[0])} 'wasm-unsafe-eval'`,
  `style-src ${sha256(styles[0])}`,
  // The page's two fonts ride inside its style as data: URLs (Piggy Speech, Space Mono; OFL).
  "font-src data:",
  `connect-src ${CONNECT.join(" ")}`,
  "form-action 'none'",
  "base-uri 'none'",
].join("; ")

const charset = /<meta charset="utf-8"\s*\/?>/i
if (!charset.test(html)) fail("no <meta charset> to anchor the CSP after")
html = html.replace(charset, (tag) => `${tag}\n<meta http-equiv="Content-Security-Policy" content="${csp}">`)
writeFileSync(page, html)

const name = `piggy-exit-${version}.html`
copyFileSync(page, `dist/${name}`)
const digest = createHash("sha256").update(html, "utf8").digest("hex")
writeFileSync("dist/SHA256SUMS", `${digest}  ${name}\n`)
console.log(`${name}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB  sha256 ${digest}`)
