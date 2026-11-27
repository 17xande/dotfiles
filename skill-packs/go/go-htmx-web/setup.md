# Founding a project

The decisions you make once, at the start. `SKILL.md` covers everything that applies for
the rest of the project's life; this is the part you can stop re-reading after week one.

A new project starts from the gowebkit template (`scaffold.md`), which already embodies
these decisions; this file is why, and what to weigh when a project needs more.

## The stack


| Layer | Choice | Not |
|---|---|---|
| HTTP | `net/http` `ServeMux` — it does method + wildcard patterns (`GET /products/{slug}`) | chi, gin, echo, fiber |
| HTML | `html/template`, server-rendered | a JSON API + SPA |
| Interactivity | htmx, **always the newest release** (currently 4.x), **vendored into the binary** | React/Vue/Svelte; an htmx CDN link; an older major because npm tags it `latest` |
| Richer UI | **Web components** when a page needs more than htmx + CSS: Web Awesome (`@awesome.me/webawesome`, newest release) or small hand-written custom elements, vendored like htmx, no build step | React, Vue, Svelte, Astro, Next, or any framework/bundler pipeline that owns the page |
| CSS | plain modern CSS: custom properties, native nesting, `clamp()` | Tailwind, Bootstrap, any framework |
| DB | **SQLite** (single instance) or **Postgres** via `jackc/pgx/v5` — see below, and `sqlite.md` | an ORM; `lib/pq` |
| Queries | **sqlc** on Postgres; `database/sql` + typed store methods on SQLite | GORM, ent |
| Migrations | **goose** on both, from the first commit: on SQLite through `sqlitekit/goosestrict` inside `MigrationLock`; on Postgres under a session advisory lock | a hand-rolled migration runner, or startup `ALTER`s |
| Config | env vars only, parsed into one struct in `internal/config` | viper, config files |
| Money | integer cents (`PriceCents int64`) | float, a decimal library |
| Container | multi-stage build → `distroless/static-debian13:nonroot` | alpine + a shell in production |

## Choosing the database


**The forcing function is instance count, not volume.** SQLite does thousands of writes/sec,
and a read is an in-process call with no network hop — for a server-rendered app it is
*faster* than Postgres, not a compromise. Reach for Postgres when something structural
demands it: two or more app instances (it is a local file), overlapping deploys, another
process reading the database, managed point-in-time recovery, or multi-region.

Record the choice in the README with the trigger that would change it. Full detail,
including the STRICT-tables rule that is not optional, is in `sqlite.md`.

## The dependency rule


> The objection is to **frameworks**, not libraries.

Something that owns the shape of the application, dictates its architecture and ages on
someone else's schedule defeats the point of a stdlib-shaped design. A small,
single-purpose, widely-reviewed library that does one thing is a different proposition —
and is **preferred over hand-rolling anything security-sensitive or fiddly**. Password
hashing, CSRF tokens, session signing and migrations are solved problems; a local
reimplementation read by one person is not an improvement on one read by thousands.

The counterweight: where a package is a thin wrapper over something the stdlib already
does, write or copy those few dozen lines instead of inheriting a release cadence and a
transitive graph. **The deciding question is the depth of the problem, not the size of the
dependency.**

Libraries that have earned their place in this style:

| Dependency | For |
|---|---|
| `jackc/pgx/v5` | Postgres driver + pool |
| `modernc.org/sqlite` | SQLite driver, pure Go (decided; see `sqlite.md`). `mattn/go-sqlite3` was rejected for its cgo cost. |
| `pressly/goose/v3` | Migrations: advisory locking, `NO TRANSACTION`, and a CLI for hand-holding |
| `justinas/nosurf` | CSRF tokens and origin checks; arrives through `websec/csrf` |
| `gorilla/securecookie` | Signed claims with key rotation, only when server-side revocation is not needed |
| `golang.org/x/crypto` | `argon2` for passwords (`bcrypt` to keep old hashes verifying); arrives through the `password` module |
| `golang.org/x/time/rate` | Token bucket behind rate limits; arrives through the `ratelimit` module |
| `wneessen/go-mail` | MIME, RFC 2047 subjects, quoted-printable, STARTTLS; arrives through the `mailer` module |
| `aws/aws-sdk-go-v2` (`service/s3`, `feature/s3/manager`, `credentials`) | Object storage over the S3 API (R2, GCS interop, RustFS). Replaced `minio-go`: MinIO's community edition is in maintenance mode |

### Your own shared modules: use these instead of writing the code

Each was extracted from code that every app had copied, after the copies drifted into
real bugs (an uncapped argon2 pool that could OOM a container, IPv6 limiter bypasses, a
payment notification check that refused the gateway's own servers). New projects import
them from the start; agreed extraction means they need no per-project dependency
question (see `SKILL.md`). Take **the latest tag** — they are your own and are reviewed
before tagging, so the two-week rule below is for third-party code. Policy stays in the
app; the module holds only the mechanism.

| Module | For | The app keeps |
|---|---|---|
| `github.com/17xande-dev/gowebkit/template/sqlite` (or `/postgres`) | not imported: the starting app, generated once with `gonew` and read at a tag (`scaffold.md`); the reference for how the modules below fit together | everything after generation: the app is a fork |
| `github.com/17xande-dev/password` | argon2id `Hash` / `Check` (`rehash` flag, bcrypt still verifies), `CheckDummy` for unknown accounts, `Validate` at write time, `SetConcurrency` (call it at startup), `SetParamsForTesting` (in `TestMain`: the params are global, so not per test with `t.Parallel`) | the password policy and its messages; the `-reset-password` flag; the compare-and-swap that saves a rehash |
| `github.com/17xande-dev/ratelimit` | keyed token buckets: IPv6 by /64, a hard cap that fails closed, `Middleware` with `RetryAfter` or a custom `Exceeded` 429, `Allow(key)` for second-tier keys, an `OnFull` hook, an injectable clock; `AccountKey` trims and lower-cases, then hashes results over 200 bytes | rates, bursts, the 429 body, identifier validation and checking the IP tier first |
| `github.com/17xande-dev/ratelimit/clientip` | `Source` from `TrustedProxies` CIDRs **or** one `TrustedHeader` (`New`, or `ParseSource` for a `remote`/`forwarded`/`cloudflare` env value); bare, unmapped, zone-free addresses | which policy matches the real ingress (document it next to the deploy config) |
| `github.com/17xande-dev/mailer` (+ `/msauth`) | one `Sender` interface: SMTP (go-mail), Microsoft Graph, `Discard`, `Fake` for tests; XOAUTH2 tokens for Exchange Online | the templates and what gets sent when |
| `github.com/17xande-dev/sqlitekit` (+ `/goosestrict`) | SQLite on `modernc.org/sqlite`: `DSN` + `Check` (foreign keys, WAL, `_txlock=immediate`, busy timeout, optional secure_delete, verified at startup), `Backups` (daily `VACUUM INTO`, 0600, retention), `MigrationLock` (cross-process, hold it around every migration), goose on STRICT tables with `NewProvider` and `Adopt` | the migrations, the backup folder/prefix/retention, whether it needs `SecureDelete`, and running `Backups.Run` from its cleanup loop |
| `github.com/17xande-dev/websec` | **Root:** `SafeRedirect` for `?next=` and other request-supplied redirects; `CSVCell` / `CSVRow` for spreadsheet-bound exports.<br>**`cookie`:** the session cookie builder: Lax and HttpOnly fixed, `__Host-` (at `/`) or `__Secure-` (narrower path) derived from a bare name, `Insecure` for plain-HTTP dev only.<br>**`csrf`:** the nosurf policy: a mandatory body cap applied before the token is parsed, multipart refused unless a route's `Limit` opts in, a required exact `Origin` (`ValidateOrigin` checks it early), `Renew`, logged failures, `OnBodyError` and `LogPath`.<br>**`session`:** `Lifetime`: idle plus a mandatory absolute limit, `NeedsTouch` to throttle the `last_seen` write (a future value is rewritten), `ExpiresAt` / `AbsoluteExpiry` for the cookie.<br>**`session/sessiontest`:** the conformance suite every app runs against its own store.<br>**`webtest`** (tests only): a browser-like client (`New` in-process, `NewServer` over a connection; jar, `Origin`, no redirect following), `Page`/`Form`/`SignIn`, a strict anonymous-route `Sweep` over `Routes` with a `Min` floor, `WantCookie`, `CookieAt`, `NewCountingReader`/`Filler`, `NoTempFiles`, `Logger` + `NoSecrets`, `Raw`, `HostileRedirects`. | **Root:** the fallback page, which paths to `Deny`, and which exports are for spreadsheets (not machine imports).<br>**`cookie`:** the bare name, the path, and persistent vs `BrowserSession`.<br>**`csrf`:** the origins, per-route caps, authenticating large uploads before the wrapper, the `Renew` calls (sign-in, sign-out, password change), the log label.<br>**`session`:** the store and its schema, token hashing, the lifetimes, the clock, revocation and the sweep.<br>**`session/sessiontest`:** a small adapter from the suite's callbacks to the real store.<br>**`webtest`:** the route lists, exact floors, `Public` reasons, the refusal check, and expected values written out by hand. |
| `github.com/17xande-dev/payment` (+ `/payfast`, `/snapscan`) | gateways, `Registry`, the signed handover form, ITN/webhook verification, `CSPOrigins` for `form-action`/`img-src`, a `Fake` gateway, `?ref=` return URLs | orders/gifts, amount checks against the stored record, the read cap on callback bodies |

**This table is the index; each module's README is the manual**, and the one that
matters is at the version the app pins. From the app's directory:
`$(GOWORK=off go list -m -f '{{.Dir}}' github.com/17xande-dev/<name>)/README.md`
(`go mod download` it first if the path is empty), or `go doc github.com/17xande-dev/<pkg>`.
`GOWORK=off` matters: under a `go.work` you would read the local checkout instead.
During development point an app at a local checkout with an **uncommitted** `go.work`,
and commit only against a real tag.

Deliberately **not** taken: a router, a validation library (struct tags fight the
per-field messages real forms need), a decimal type, a UUID library (the database
generates ids).

**Build-time tools stay out of `go.mod`.** sqlc is pinned in the *Makefile*
(`SQLC_VERSION ?= v1.31.1` + a `sqlc-install` target), not via a `go tool` directive: it
never links into the binary, and a `go tool` directive would put ~40 indirect modules
into the file that documents what the *server* depends on. Keep `go.mod` a truthful
statement of the binary's dependencies. govulncheck likewise
(`GOVULNCHECK_VERSION ?= v1.9.0`, installed with `go install`; v1.1.x crashes on Go 1.27).

**Which version: the newest tag at least two weeks old** — for third-party modules,
tools, images and vendored scripts (htmx) alike. A fresh release has had no time to be
yanked or patched. Example: on 2026-10-30 that gave `service/s3` v1.114.3,
`feature/s3/manager` v1.23.14, `credentials` v1.20.9, not the releases of that week.
Check the date (`go list -m -json <mod>@<v>` → `Time`; `npm view <pkg> time --json`),
and again just before a release. **An exception needs the user's explicit word**, and is
recorded where the pin is explained (changelog or commit message) as a one-time
exception with the reason; the rule stands for the next bump. Updating is a standing
part of any review (see `SKILL.md`).

Record decisions you deliberately defer in a **"Decisions still open"** table in the
README (candidate + the trigger that would force it), so they get decided deliberately
rather than by lapsing.

## Object storage preference


Images and uploads are **held by the store**, never a pasted external URL — the row
records a *key*, and the storage backend resolves it to a URL. Put a `Storage` interface
(`Put`/`Delete`/`URL`) in front of it with implementations for S3-compatible, local disk,
unconfigured (refuses), and a fake for tests. Local disk + a volume mount is the dev
story; a bucket is the production one, and the same code serves both.

Provider preference: **Cloudflare R2 > GCS > local/OSS > Amazon.** The self-hosted and
test server is **RustFS** (`rustfs/rustfs`), not MinIO (community edition in maintenance
mode).

The S3 client is the AWS SDK for Go v2, configured for non-AWS stores:

- `UsePathStyle: true`, and `RequestChecksumCalculation` / `ResponseChecksumValidation`
  set to `WhenRequired` — the SDK's default checksums are refused by some S3-compatible
  servers.
- Uploads through `manager.Uploader` with `PartSize = 16 MiB`, `Concurrency = 1`, so
  memory stays constant whatever the file size; downloads via `s3.PresignClient`.
- A contract test against a real server, gated by `BLOB_TEST_ENDPOINT`. **Run it after
  every SDK update** — the fakes cannot see a changed wire default. It does not prove R2
  itself; say so when reporting.

## Embed everything, override by directory


`go:embed` templates, static assets and migrations, so the runtime image ships a single
binary with no assets and needs no shell.

**Override directories are for adopters, and only for adopters.** `TEMPLATE_DIR` /
`STATIC_DIR` let someone restyle without forking — genuinely valuable for a project meant
to be adopted, and a set of extra failure modes for nobody's benefit on a project serving
one organisation. Decide which you are building; if the answer is "one deployment we
control", omit them and say so in the README. When you do want them:

- **`TEMPLATE_DIR`** — same-named files re-parsed *over* the embedded set (a later
  definition of a template name replaces an earlier one).
- **`STATIC_DIR`** — a file shadows the bundled one of the same name, *and* new names are
  served too (an overridden template referencing `hero.jpg` needs somewhere to put it).

Both read at **startup**: a change needs a restart, never a rebuild. Validate at boot
(`CheckAssets()`) so a missing directory is a startup failure, not a page of broken links.

Two hard rules for the static route:
1. **An explicit extension → content-type map**, not `mime.TypeByExtension`. An extension
   not in the map is not served *at all*, so dropping a `.php`/`.html`/`.env` into
   `STATIC_DIR` cannot publish it. The gate applies to bundled and override files alike.
2. **Content-hashed URLs** via an `{{asset "styles.css"}}` template func →
   `/static/styles.css?v=<hash>`, served `immutable`. Replacing a file changes its URL, so
   an override takes effect without waiting for a cache to expire.

Keep bundled assets and user uploads in separate systems — then a cleanup sweep over
uploaded objects can never mistake the logo for an orphan.

Never put organisation-specific content in the codebase: no real branding, colours,
contact details or copy. Ship neutral defaults; real branding arrives via `STATIC_DIR`.

## CSS: the default must be genuinely decent


Raw browser styling is not an acceptable default, and "here's an override example to start
from" is not a substitute for a good bundled theme. Ship a real one.

- One `styles.css`, `go:embed`ed, overridable via `STATIC_DIR`.
- All knobs as custom properties in one `:root` block — colours, a fluid type scale, a
  spacing scale, radii, `--measure`, `--page`. Rebranding = overriding variables.
- **Native nesting** (`&:hover`, `> .child`), `clamp()` for fluid type *and* fluid grid
  minimums, `aspect-ratio` for image wells, `color-mix(in oklab, …)` for derived hovers,
  `text-wrap: balance`, and a `@media (prefers-reduced-motion: reduce)` block.
- **Fonts: a system font stack by default; a brand font when the brand has one.** Prefer
  self-hosting it (an embedded `woff2`, `font-src 'self'`) when that is easy, which it
  usually is for OFL fonts. External embeds from reputable sources (Google Fonts,
  Font Awesome) are acceptable when self-hosting is not practical. Widen `font-src` and
  `style-src` deliberately for exactly that origin, and keep them off any payment path.
- Responsive without breakpoints where possible:
  `grid-template-columns: repeat(auto-fill, minmax(clamp(9rem, 30vw, 15rem), 1fr))`
  gives 2-up on a phone and 4-up on a desktop with zero media queries. A flat `minmax()`
  minimum collapses to one giant card on mobile — the `clamp()` is the fix.
- Fixed-ratio image frames (`aspect-ratio` + `overflow: hidden` + `object-fit: cover`) so
  portrait and landscape source photos both sit tidily in a card grid. **Test this with
  images of genuinely different aspect ratios** — generate them with ImageMagick.
- **No inline `style=` and no inline `on*=` handlers in served templates.** Both are what
  keep the CSP free of `'unsafe-inline'`; the rules and the test that enforces them are in
  `SKILL.md` under "Security baseline", because they bind every template you write, not
  just the first ones.

## The sqlc + goose workflow (Postgres)


On SQLite this whole section is replaced by hand-written typed store methods and
drop-and-recreate — see `sqlite.md`.

1. Write/edit the migration in `internal/db/migrations/NNNN_name.sql` with
   `-- +goose Up` / `-- +goose Down`.
2. Write/edit the query in `internal/db/queries/*.sql` with a sqlc annotation
   (`-- name: GetProduct :one`).
3. Run **`make sqlc`** to regenerate `internal/db/gen`. Never hand-edit generated code.
4. **`make sqlc-check`** (`sqlc diff`) fails if the checked-in output is stale — the
   gate runs it first (`fmt-check` depends on it), so a query edited without
   regenerating fails locally rather than by a reviewer noticing the SQL and the Go
   disagree.

Migrations are applied on boot (goose holds a session-level advisory lock, so concurrent
boots of a scaled-out deployment are safe), and also on demand via `-migrate` /
`-migrate-status` flags. Because they are ordinary goose files, the `goose` CLI works
against the directory unchanged on the day something needs hand-holding.

Greenfield means greenfield: with no live deployments, **drop and reshape columns properly**
rather than carrying a field nobody wants. Adding `0005_drop_product_image_url.sql` beats
keeping a dead column forever.

## Local stack and Makefile


The template's `compose.yaml`, `Makefile` and `db.mk` are the reference (`make help`
lists the targets). `compose.yaml` runs the real dependencies — `mailpit` for mail, plus
Postgres on that variant — so `make up` gives a working system with nothing stubbed,
with development-only credentials published in it and said so in the README. A project
that stores files adds `rustfs` behind a `profiles: ["s3"]` gate (so it does not bind
9000 by default); create a bucket with
`curl --aws-sigv4 aws:amz:auto:s3 --user rustfsadmin:rustfsadmin -X PUT http://127.0.0.1:9000/<bucket>`.

**Postgres 18** (`postgres:18-alpine`): mount the volume at **`/var/lib/postgresql`**,
not `/var/lib/postgresql/data` — 18 keeps a versioned subdirectory, and the old mount
silently puts the data on an anonymous volume that `down` loses. An existing 17 volume
needs dump and restore; document it in the backups doc. **Passwords interpolated into
`DATABASE_URL` must be URL-safe** (`openssl rand -hex 32`) or percent-encoded: pgx 5.11
splits userinfo at the first `@`.

Pinned build tools install themselves on first use (`$(GOVULNCHECK):` and `$(SQLC):`
file targets), so a clean machine needs no setup step. A `seed` target, if a project adds
one, depends on `migrate`, so seeding an unmigrated database reports a missing migration
rather than a missing table. `SHELL := bash` if any recipe uses bash features.

**Checks run locally, not on hosted CI.** The user prefers local checks and removed the
hosted workflows; the template ships none. The project's Makefile gate (`make gate` in
the template) is the single definition of "green": `fmt-check` (with `sqlc-check` first on Postgres) → `vet` → `go test -race
-count=1 -v ./...` printing the skip count, with the database tests required → `vulncheck`
(last, so a new CVE cannot hide the test results). Run it before every commit and report
the result; never write "CI will catch it". Run the S3 contract test by hand after an
SDK update and say so.
