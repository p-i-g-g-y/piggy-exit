// After `vite build`: lock dist/index.html down and stamp the release files.
//
// 1. Nothing external: the page must be one self-contained file (no script src, no stylesheet
//    or preload links, no url() outside data:).
// 2. A Content-Security-Policy meta tag that allows exactly the inlined script and style (by
//    SHA-256) and no connections at all. pig.gy/exit adds frame-ancestors and the other headers a
//    meta tag can't carry.
// 3. dist/piggy-exit-<version>.html (byte-identical) and dist/SHA256SUMS.
import { createHash } from "node:crypto"
import { copyFileSync, readFileSync, writeFileSync } from "node:fs"

const fail = (message) => {
  console.error(`finalize: ${message}`)
  process.exit(1)
}

const { version } = JSON.parse(readFileSync("package.json", "utf8"))
const page = "dist/index.html"
let html = readFileSync(page, "utf8")

const external = [
  [/<script\b[^>]*\bsrc\s*=/i, "a script loaded from elsewhere"],
  [/<link\b[^>]*\brel\s*=\s*["']?(?:stylesheet|modulepreload|preload|prefetch)/i, "a linked resource"],
  [/url\(\s*["']?(?!data:)[^)'"\s]/i, "a url() that isn't data:"],
  [/<(?:img|iframe|object|embed|video|audio|source)\b/i, "an embedded element"],
]
for (const [pattern, what] of external) {
  if (pattern.test(html)) fail(`${what} in ${page}`)
}

const inline = (tag) => {
  const opened = (html.match(new RegExp(`<${tag}\\b`, "gi")) ?? []).length
  const bodies = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => m[1])
  if (bodies.length !== opened) fail(`unbalanced <${tag}> tags`)
  return bodies.map((body) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`)
}
const scripts = inline("script")
const styles = inline("style")
if (scripts.length !== 1 || styles.length !== 1) fail(`expected one inline script and one style, got ${scripts.length} and ${styles.length}`)
if (/\sstyle\s*=/i.test(html)) fail("an inline style attribute (the CSP allows none)")

const csp = [
  "default-src 'none'",
  `script-src ${scripts.join(" ")}`,
  `style-src ${styles.join(" ")}`,
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ")

const charset = /<meta charset="utf-8"\s*\/?>/i
if (!charset.test(html)) fail("no <meta charset> to anchor the CSP after")
html = html.replace(charset, (tag) => `${tag}\n<meta http-equiv="Content-Security-Policy" content="${csp}">`)
writeFileSync(page, html)

const name = `piggy-exit-${version}.html`
copyFileSync(page, `dist/${name}`)
const sha256 = createHash("sha256").update(html, "utf8").digest("hex")
writeFileSync("dist/SHA256SUMS", `${sha256}  ${name}\n`)
console.log(`${name}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB  sha256 ${sha256}`)
