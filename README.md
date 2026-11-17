# piggy-exit

Opens a [Piggy](https://pig.gy) emergency exit file in the browser. Piggy's iPhone and Android
apps keep this file fresh after every feed: it holds the pre-signed transactions that take a
piggy's bitcoin back onto Bitcoin without Piggy or Spark, plus the seed phrase, locked with the
person's password.

**This version checks a file.** It opens the file with its password and confirms that the seed
phrase inside belongs to the file's wallet. It also shows what the file holds. Taking the
bitcoin out comes next: a cooperative exit while Spark answers, and the unilateral exit when it
doesn't.

## Where it lives

The same file, with the same SHA-256, in three places:

- **pig.gy/exit**: serves the GitHub Pages copy, so the password Piggy saved under `pig.gy` fills in.
- **GitHub Pages**: `https://p-i-g-g-y.github.io/piggy-exit/`, published by `.github/workflows/release.yml`.
  It works even if Piggy and pig.gy are gone.
- **Each release**: `piggy-exit-<version>.html` and `SHA256SUMS`. Save it on a computer and open it
  from disk; it needs nothing else.

## What it does with your file

- Everything happens in the browser. There is no server, no analytics and nothing stored: the
  words exist in memory for one check, and the fields are cleared after it.
- The page is one HTML file with every script and style inside. Its Content-Security-Policy
  allows exactly those (by SHA-256) and **no connections at all** in this version.
- The seed phrase is never shown.
- The lock is age (age-encryption.org/v1, scrypt), opened with
  [typage](https://github.com/FiloSottile/typage). The account is found by deriving Spark's
  identity key, `m/8797555'/<account>'/0'` from the BIP-39 seed, and matching it to the file's
  `walletIdentityPublicKey`. The file's recorded account is tried first, then accounts 0 to 63.

## Check a copy

```sh
shasum -a 256 piggy-exit-0.1.0.html                              # a saved copy
curl -s https://p-i-g-g-y.github.io/piggy-exit/ | shasum -a 256  # the hosted page
```

Both must print the hash in the release's `SHA256SUMS`. Builds are reproducible: anyone can build
a tag and get the same bytes.

## Build

Node 26 (`.nvmrc`). Dependencies are pinned exactly in `package-lock.json`.

```sh
npm ci
npm test       # the lock, the account search, the copy rules
npm run build  # dist/index.html, dist/piggy-exit-<version>.html, dist/SHA256SUMS
```

The tests use files written by Piggy's apps and by the age CLI, and Spark identity keys from the
Spark SDKs' own test vectors. None of them come from this page's own code (`test/fixtures.ts`).

## The file

blink's [`spark.unilateral-exit-bundle.v1`](https://github.com/blinkbitcoin/spark-unilateral-exit),
plus Piggy's `accountIndex` and `seedPhrase` (`format`, `age` or `words`, `howToOpen`,
`passwordUser`). For developers, blink's CLI runs the same exit; pass it the account this page
finds.

## License

MIT
