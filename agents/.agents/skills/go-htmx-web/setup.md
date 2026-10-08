# Founding a project

The decisions you make once, at the start. `SKILL.md` covers everything that applies for
the rest of the project's life; this is the part you can stop re-reading after week one.

Concrete files to start from are in `scaffold.md`.

## The stack


| Layer | Choice | Not |
|---|---|---|
| HTTP | `net/http` `ServeMux` — it does method + wildcard patterns (`GET /products/{slug}`) | chi, gin, echo, fiber |
| HTML | `html/template`, server-rendered | a JSON API + SPA |
| Interactivity | htmx, **vendored into the binary** | React/Vue/Svelte; an htmx CDN link |
| CSS | plain modern CSS: custom properties, native nesting, `clamp()` | Tailwind, Bootstrap, any framework |
| DB | **SQLite** (single instance) or **Postgres** via `jackc/pgx/v5` — see below, and `sqlite.md` | an ORM; `lib/pq` |
| Queries | **sqlc** on Postgres; `database/sql` + typed store methods on SQLite | GORM, ent |
| Migrations | **goose** on Postgres; **none** on greenfield SQLite — drop and recreate | a hand-rolled migration runner, or startup `ALTER`s |
| Config | env vars only, parsed into one struct in `internal/config` | viper, config files |
| Money | integer cents (`PriceCents int64`) | float, a decimal library |
| Container | multi-stage build → `distroless/static-debian12:nonroot` | alpine + a shell in production |

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
| `mattn/go-sqlite3` | SQLite driver. **Needs cgo**, so it forfeits the static binary; `modernc.org/sqlite` is the pure-Go alternative. Decide explicitly. |
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
- **No web fonts** — a system font stack keeps the CSP tight and adds no third-party
  request to the payment path.
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
