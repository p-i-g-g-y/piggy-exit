# piggy-exit

Opens a [Piggy](https://pig.gy) emergency exit file in the browser. Piggy's iPhone and Android
apps keep this file fresh after every feed: it holds the pre-signed transactions that take a
piggy's bitcoin back onto Bitcoin without Piggy or Spark. Newer files also carry the seed phrase,
locked with the person's password; for older ones the page asks for the 12 words.

It opens the file with its password, confirms that the seed phrase inside belongs to the file's
wallet, then takes the bitcoin out the way that works right now:

- **Spark and Piggy answer**: it sends people to the Piggy app, where breaking the piggy open
  takes everything out (or, if they can't use the app, the next way).
- **Piggy doesn't, Spark does**: a cooperative exit through Spark, in the page, to any Bitcoin
  address. Minutes.
- **Spark doesn't**: the unilateral exit through Bitcoin itself, using the file's pre-signed
  transactions. The person sends a little fee money to an address from the same seed; the page
  pushes each piece's exit chain (one block per step, the page open), waits out the refund
  timelock (up to about two weeks; it offers a calendar reminder), then sends every piece and the
  leftover fee money to their address. Every visit starts again from the chain, so closing the
  page loses nothing.

## Where it lives

The same file, with the same SHA-256, in three places:

- **pig.gy/exit**: serves the GitHub Pages copy, so the password Piggy saved under `pig.gy` fills in.
- **GitHub Pages**: `https://p-i-g-g-y.github.io/piggy-exit/`, published by `.github/workflows/release.yml`.
  It works even if Piggy and pig.gy are gone.
- **Each release**: `piggy-exit-<version>.html` and `SHA256SUMS`. Save it on a computer and open it
  from disk; it needs nothing else.

## What it does with your file

- Everything happens in the browser. There is no server of its own, no analytics and nothing
  stored: the words live in memory until the bitcoin has gone out or the person starts over.
- The page is one HTML file with every script and style inside. Its Content-Security-Policy
  allows exactly those (by SHA-256), WebAssembly (Spark's signing) and connections to these hosts
  only:
  - `api.pig.gy`: whether Piggy answers (`GET /v1/exit/status`, nothing sent).
  - Spark's three mainnet signing operators and `api.lightspark.com`: the cooperative exit.
  - `blockstream.info` (Esplora) and `mempool.space`: the unilateral exit's coins, fees and
    broadcasts, and the Spark SDK's check of which exit transactions are already out.
- The seed phrase is never shown.
- The lock is age (age-encryption.org/v1, scrypt), opened with
  [typage](https://github.com/FiloSottile/typage). The account is found by deriving Spark's
  identity key, `m/8797555'/<account>'/0'` from the BIP-39 seed, and matching it to the file's
  `walletIdentityPublicKey`. The file's recorded account is tried first, then accounts 0 to 63.

## Check a copy

```sh
shasum -a 256 piggy-exit-0.2.0.html                              # a saved copy
curl -s https://p-i-g-g-y.github.io/piggy-exit/ | shasum -a 256  # the hosted page
```

Both must print the hash in the release's `SHA256SUMS`. Builds are reproducible: anyone can build
a tag and get the same bytes.

## Build

Node 26 (`.nvmrc`). Dependencies are pinned exactly in `package-lock.json`.

```sh
npm ci
npm test       # the lock, the account search, the ways out, the exit engine, the copy rules
npm run build  # dist/index.html, dist/piggy-exit-<version>.html, dist/SHA256SUMS
```

The tests use files written by Piggy's apps and by the age CLI, and Spark identity keys from the
Spark SDKs' own test vectors. None of them come from this page's own code (`test/fixtures.ts`).
The unilateral exit's tests run blink's engine and the real Spark SDK on synthetic trees; only the
chain is faked (`test/slow-sdk.test.ts`).

## The unilateral exit engine

`src/engine/` is blink's [spark-unilateral-exit](https://github.com/blinkbitcoin/spark-unilateral-exit)
at `1132b77f5e42` (MIT, `src/engine/LICENSE`), with its tests in `test/engine/`. Each file's header
lists Piggy's changes: import paths for noble/scure v2, `text/plain` package submits (browsers
can't preflight Esplora), and an `onRound` progress callback. The fee key is blink's,
`m/8797556'/<account>/0` (P2WPKH); `src/slow.ts` decides what the page asks for and shows.

## The file

blink's [`spark.unilateral-exit-bundle.v1`](https://github.com/blinkbitcoin/spark-unilateral-exit),
plus Piggy's `accountIndex` and `seedPhrase` (`format: "age"`, `age`, `howToOpen`,
`passwordUser`). Files from the shipped apps (iOS and Android up to 2.2.x) have no `seedPhrase`:
the page asks for the 12 words instead. For developers, blink's CLI runs the same exit; pass it
the account this page finds.

## License

MIT
