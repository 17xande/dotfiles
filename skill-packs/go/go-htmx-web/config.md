# Configuration: one loader on `env`

Environment variables only, read by one `config.Load` in `internal/config` through
`github.com/17xande-dev/env`. The per-app getters this replaces disagreed on what an
empty value, a boolean or a secret file meant; do not write another. The module
README at the pinned version is the manual, and the gowebkit template's
`internal/config` is the reference loader.

## The rules `env` enforces

| Rule | Behaviour |
|---|---|
| Unset or empty | The default. `Required` records a problem instead. |
| Booleans | Exactly `true` or `false`. `1`, `yes`, `TRUE` are errors. |
| Exact input | No trimming or case folding (a `List` trims its items). |
| Errors | Getters record problems and return the default; `r.Err()` joins them all as `KEY: problem`, never echoing the value. |
| Secrets | `r.Secret("KEY")` reads `KEY` **or** `KEY_FILE` (both set is an error); trailing CR/LF stripped from the file. A `Secret` formats as `[redacted]`; call `Reveal()` only where the credential is used. |

The loader shape: `Load()` calls `load(os.LookupEnv)`, which reads **every key
unconditionally**, then validates the combinations with `r.Fail(key, fixed text)`
and returns `r.Err()`. Policy checks stay in the app (`csrf.ValidateOrigin` on
`BASE_URL`, `clientip.ParseSource`, the cookie builder, mail settings), so
`-check-config` and the server refuse the same things, and a deploy never migrates
and then fails to start. Keep credentials as `env.Secret` fields (exported, so `fmt`
redacts them) until the point of use.

## Tests every loader has

- **Docs parity.** `envtest.NewRecorder` records the keys the loader reads;
  `envtest.Documented` compares them with `.env.example` (`EnvExample`) and the
  README's configuration table (`MarkdownTable` under the exact heading). A key
  read only on one branch is invisible to the recorder, which is why every key is
  read unconditionally.
- **Production values.** `TestProductionValues` feeds the loader the
  `env.clear` block of `config/deploy.yml` **copied literally** (strings exactly as
  spelled there, plus any image defaults), with fixture values standing in for the
  secrets, and asserts it loads and yields the production settings (Secure cookies,
  the real ingress policy). A loader test written from the Go side passes while the
  deploy file says something the loader refuses. Update the test in the same commit
  as `deploy.yml`.
- Strict booleans, empty-means-default, all problems reported together, and no
  value or secret path in an error message: the template's `config_test.go` has
  the cases to port.

## Moving an app onto a strict loader

- **⚠️ Fix the deploy config first.** An old loader that read `"1"` as true lets
  `deploy.yml` say `COOKIE_SECURE: "1"`; the strict loader refuses it and the new
  release fails to start. Change every
  boolean in `deploy.yml`, `.env.production` and the secrets references to
  `"true"`/`"false"` and ship that **before** (or with) the strict loader, and let
  `TestProductionValues` prove it.
- **Empty is the default now.** A setting someone blanked to turn a feature off is
  now its default. Check every empty value in the deploy files.
- **Retiring a variable: ignore a leftover value**, do not fail on it; deploy
  configs keep it for a while.
- Port `internal/config` and its tests from the template at the version you
  follow (`scaffold.md`), keeping the app's own settings and checks.
