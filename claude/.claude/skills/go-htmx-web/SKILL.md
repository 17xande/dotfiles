---
name: go-htmx-web
description: >
  How to build a Go + htmx web application in this user's preferred style: stdlib-shaped
  net/http and html/template, Postgres via pgx + sqlc + goose, a deliberately tiny
  dependency surface, embedded assets with directory overrides, plain modern CSS, and a
  container-first local stack. Load this BEFORE scaffolding a new web project, choosing a
  web framework/router/ORM/CSS framework, adding a dependency, setting up migrations or
  a database layer, writing templates or CSS for a Go server, or planning the phases of a
  new Go web app. Triggers: "new web project", "new Go project", "start a web app",
  "should I use <framework/library>", "set up migrations", "add a dependency", "scaffold",
  htmx, sqlc, goose, "look and feel", "default theme".
---

# Go + htmx web applications

The house style. It is stdlib-shaped, small, and container-first. Distilled from a real
project built end to end this way; every rule below exists because a specific alternative
was considered and rejected.

The single most important rule is at the bottom: **never decide a dependency by default.**

## The stack

| Layer | Choice | Not |
|---|---|---|
| HTTP | `net/http` `ServeMux` — it does method + wildcard patterns (`GET /products/{slug}`) | chi, gin, echo, fiber |
| HTML | `html/template`, server-rendered | a JSON API + SPA |
| Interactivity | htmx, **vendored into the binary** | React/Vue/Svelte; an htmx CDN link |
| CSS | plain modern CSS: custom properties, native nesting, `clamp()` | Tailwind, Bootstrap, any framework |
| DB | Postgres via `jackc/pgx/v5` (no cgo → static binary) | an ORM; `database/sql` + `lib/pq` |
| Queries | **sqlc** — generated row structs and scan code from real SQL | GORM, ent, hand-written `rows.Scan` |
| Migrations | **goose** as a *library*, `.sql` files `go:embed`ed | hand-rolled migration runner |
| Config | env vars only, parsed into one struct in `internal/config` | viper, config files |
| Money | integer cents (`PriceCents int64`) | float, a decimal library |
| Container | multi-stage build → `distroless/static-debian12:nonroot` | alpine + a shell in production |

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
| `pressly/goose/v3` | Migrations: advisory locking, `NO TRANSACTION`, and a CLI for hand-holding |
| `justinas/nosurf` | CSRF tokens and origin checks |
| `gorilla/securecookie` | Signing session cookies, incl. key rotation |
| `golang.org/x/crypto` | `argon2` for passwords (`bcrypt` to keep old hashes verifying) |
| `golang.org/x/time/rate` | Token bucket behind rate limits |
| `wneessen/go-mail` | MIME, RFC 2047 subjects, quoted-printable, STARTTLS |
| `minio/minio-go/v7` | Object storage over the S3 API (R2, GCS interop, MinIO) |

Deliberately **not** taken: a router, a validation library (struct tags fight the
per-field messages real forms need), a decimal type, a UUID library (the database
generates ids).

**Build-time tools stay out of `go.mod`.** sqlc is pinned in the *Makefile*
(`SQLC_VERSION ?= v1.31.1` + a `sqlc-install` target), not via a `go tool` directive: it
never links into the binary, and a `go tool` directive would put ~40 indirect modules
into the file that documents what the *server* depends on. Keep `go.mod` a truthful
statement of the binary's dependencies.

Record decisions you deliberately defer in a **"Decisions still open"** table in the
README (candidate + the trigger that would force it), so they get decided deliberately
rather than by lapsing.

## Object storage preference

Images and uploads are **held by the store**, never a pasted external URL — the row
records a *key*, and the storage backend resolves it to a URL. Put a `Storage` interface
(`Put`/`Delete`/`URL`) in front of it with implementations for S3-compatible, local disk,
unconfigured (refuses), and a fake for tests. Local disk + a volume mount is the dev
story; a bucket is the production one, and the same code serves both.

Provider preference: **Cloudflare R2 > GCS > local/OSS > Amazon.**

## Layout

```
main.go                     wiring, graceful shutdown, -migrate / -migrate-status flags
cleanup.go                  background sweeps
compose.yaml Dockerfile Makefile .env.example README.md
.github/workflows/ci.yaml
cmd/seed/  cmd/hashpw/       small operator commands, each with a test
internal/config/            all env parsing, one Config struct
internal/db/                pool, goose runner
internal/db/migrations/     0001_init.sql, 0002_… (goose Up/Down)
internal/db/queries/        hand-written .sql, the input to sqlc
internal/db/gen/            sqlc output — generated, checked in, never edited
internal/dbtest/            test database helper
internal/<domain>/          model.go + store.go per domain (catalog, cart, orders)
internal/handler/           HTTP: one file per area + _test.go alongside
internal/handler/templates/ go:embed'ed .html and .txt
internal/handler/static/    go:embed'ed css, htmx, logo.svg, placeholder.svg
internal/middleware/        security headers, CSRF, rate limits, logging
internal/auth/ email/ blob/ validate/
```

Domain packages hold the model and the store; `internal/handler` holds HTTP and rendering.
Handlers depend on domain packages, never the reverse.

## Embed everything, override by directory

`go:embed` templates, static assets and migrations, so the runtime image ships a single
binary with no assets and needs no shell. Then make both overridable so adopters restyle
without forking:

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
- **No web fonts** — a system font stack keeps the CSP tight and adds no third-party
  request to the payment path.
- Responsive without breakpoints where possible:
  `grid-template-columns: repeat(auto-fill, minmax(clamp(9rem, 30vw, 15rem), 1fr))`
  gives 2-up on a phone and 4-up on a desktop with zero media queries. A flat `minmax()`
  minimum collapses to one giant card on mobile — the `clamp()` is the fix.
- Fixed-ratio image frames (`aspect-ratio` + `overflow: hidden` + `object-fit: cover`) so
  portrait and landscape source photos both sit tidily in a card grid. **Test this with
  images of genuinely different aspect ratios** — generate them with ImageMagick.
- **Zero `style="…"` attributes in served templates**, and drop presentational HTML
  attributes (`border`, `cellpadding`). This is what lets the CSP keep
  `style-src 'self'` with no `'unsafe-inline'` — enforce it with a test that walks every
  served page. Email templates are exempt: no CSP has ever applied to them.

## Security baseline

Set this up early; retrofitting is worse.

- **CSP** built from a `Policy` struct in middleware: `default-src 'self'`,
  `script-src 'self'` (htmx is bundled, so no CDN needs allowing), `object-src 'none'`,
  `base-uri 'none'`, `style-src 'self'`, plus `img-src`/`form-action`/`frame-ancestors`
  driven by config.
- **⚠️ CSP source paths are exact matches, not prefixes.** A source that does not end in
  `/` matches only that literal path. Listing a bucket's full base URL
  (`https://host/bucket`) in `img-src` therefore refuses *every* object beneath it. This
  is invisible to `curl` and to the rendered markup — only a real browser enforces it.
  Strip to scheme+host for CSP purposes (a `PublicOrigin()` helper) and regression-test it.
- **argon2id** password hashing in PHC string format, dispatching on prefix so bcrypt
  hashes keep verifying.
- **Per-IP rate limits**: `x/time/rate` token bucket in a keyed map with a lazy eviction
  sweep.
- **CSRF** via nosurf, incl. origin checks. Cookies `SameSite=Lax`; scope the cart/session
  cookie to its path so catalog pages stay cacheable and embeddable.
- **HSTS off by default** — a browser ignores it over plain HTTP, and sending it from
  localhost pins a rule that breaks the next project on that port. No `preload`: that is
  the operator's decision, with a slow exit.
- A `hashpw` command that reads the password with `read -rs` — never echoed, never a
  command-line argument, so it stays out of shell history and `ps`.
- Never echo secrets in Makefile recipes (prefix with `@`).

## The sqlc + goose workflow

1. Write/edit the migration in `internal/db/migrations/NNNN_name.sql` with
   `-- +goose Up` / `-- +goose Down`.
2. Write/edit the query in `internal/db/queries/*.sql` with a sqlc annotation
   (`-- name: GetProduct :one`).
3. Run **`make sqlc`** to regenerate `internal/db/gen`. Never hand-edit generated code.
4. **`make sqlc-check`** (`sqlc diff`) fails if the checked-in output is stale — CI runs it
   first, so a query edited without regenerating is caught on the PR rather than by a
   reviewer noticing the SQL and the Go disagree.

Migrations are applied on boot (goose holds a session-level advisory lock, so concurrent
boots of a scaled-out deployment are safe), and also on demand via `-migrate` /
`-migrate-status` flags. Because they are ordinary goose files, the `goose` CLI works
against the directory unchanged on the day something needs hand-holding.

Greenfield means greenfield: with no live deployments, **drop and reshape columns properly**
rather than carrying a field nobody wants. Adding `0005_drop_product_image_url.sql` beats
keeping a dead column forever.

## Local stack and Makefile

`compose.yaml` runs the real dependencies — Postgres, plus `mailpit` for outgoing mail and
`minio` for S3 — so `make up` gives a working system with nothing stubbed. Publish
development-only credentials in it (and say loudly in the README that they are published)
so the quickstart actually works.

Essential targets: `up down logs run migrate migrate-status seed hashpw psql sqlc
sqlc-check sqlc-install build test vet fmt tidy`. `seed` depends on `migrate`, so seeding
an unmigrated database reports a missing migration rather than a missing table.

CI: `sqlc-check` → `go vet` → `go build` → `go test -race ./...` against a real Postgres
service container, plus a `docker build` job. Database-backed tests run in CI, so a PR
cannot break migrations silently.

See `scaffold.md` in this skill directory for the concrete starting files.

## Testing and verification

- **Tests ship with the code that adds them**, in the same commit — not a later pass.
  `_test.go` next to the file it covers.
- Test against a **real Postgres** (`TEST_DATABASE_URL` + an `internal/dbtest` helper),
  not mocks. Fakes are for the storage/mail boundary, where the real thing is a network
  service.
- Test comments should say *why the behaviour matters*, not restate the assertion.
- No frontend test framework. Assert on rendered HTML from real handler requests.

**The verification gate before any commit:**

```sh
gofmt -l . ; go vet ./... && make sqlc-check && \
  TEST_DATABASE_URL="…" go test -count=1 ./...
```

**Then look at it in a browser.** This is not optional and it catches things the suite
cannot:

```sh
docker compose up -d --build server
chromium --headless --disable-gpu --hide-scrollbars --window-size=1280,900 \
  --screenshot=out.png http://localhost:8080/products
```

…then read the PNG. The CSP `img-src` bug above returned HTTP 200 to `curl`, emitted
correct markup, and passed every test — while showing a page of broken images to every
real user. Check the pages you changed at desktop *and* phone widths.

## Working style

- **A phased plan, in a file outside the repo** (`~/.claude/plans/<name>.md`). Build one
  phase at a time, each ending in a working, tested, committed state. Keep the plan out of
  the codebase.
- **Commit at every logical unit, unasked. Never push without explicit confirmation.**
- Commit messages: what changed and *why*, including bugs found along the way and the
  reasoning behind a trade-off. Bodies are prose, not bullet dumps.
- Comments explain *why* — the trade-off, the rejected alternative, the non-obvious
  constraint. The README carries the dependency rationale, not just a list.
- **Use gopls (the MCP server) for Go navigation and refactoring**, not grep. Edit tool
  for file text, ripgrep for non-Go text. See the `go-lsp` skill.

## The rule that overrides convenience

**Never decide a dependency, tool, or library by default — including by letting a due
decision lapse.** Raise the choice, name the candidates and the trade-off, and get an
explicit answer. That applies as much to "I'll just add X while I'm here" as to a big
architectural pick. A decision deferred should be *recorded* as open, not silently made.
