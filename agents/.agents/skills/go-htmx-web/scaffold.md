# Scaffold

Concrete starting files. Replace `myapp` throughout. These are working shapes, not
templates to follow blindly — drop what a given project has no use for (mailpit if it sends
no mail, rustfs if it stores no files). Versions here are a snapshot: re-pick each by the
two-weeks rule in `setup.md`.

Most of this file assumes Postgres. **On SQLite, skip the sqlc/goose/compose-Postgres
parts and use "The SQLite variant" at the end instead**; the Dockerfile, styles, layout
and htmx sections apply either way.

## Dockerfile

Multi-stage → distroless. Everything the runtime needs is `go:embed`ed, so the final image
has no assets, no shell, and runs as non-root.

```dockerfile
# Build a static binary, then ship it alone. Templates and migrations are
# go:embed'ed, so the runtime image has no assets and needs no shell.
FROM golang:1.27-alpine AS build
WORKDIR /src

# go.* rather than go.mod go.sum: a dependency-free module has no go.sum, and
# naming it would fail the build.
COPY go.* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/myapp .

FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /out/myapp /myapp
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/myapp"]
```

Copying `go.mod`/`go.sum` and running `go mod download` before the source keeps the
dependency layer cached across source edits.

## Makefile

```makefile
SHELL := bash
COMPOSE ?= docker compose
TEST_DATABASE_URL ?= postgres://myapp:myapp@localhost:5432/myapp?sslmode=disable

# Development-only credentials for the host-side targets, matching compose.yaml.
# Override in the environment for anything that is not a local sandbox.
SESSION_SECRET ?= ZGV2ZWxvcG1lbnQtb25seS1zZXNzaW9uLXNlY3JldC0wMDA=
# Recipes using DEV_ENV are prefixed with @ so an overridden, real secret is not
# echoed into a terminal or a CI log.
DEV_ENV = DATABASE_URL="$(TEST_DATABASE_URL)" SESSION_SECRET="$(SESSION_SECRET)"

# sqlc is pinned here rather than as a `go tool` directive in go.mod, so that
# go.mod keeps stating the dependencies of the *binary* — sqlc adds ~40 indirect
# modules and never links into it.
SQLC_VERSION ?= v1.31.1
SQLC ?= sqlc
# Same reasoning; v1.1.x crashes on Go 1.27.
GOVULNCHECK_VERSION ?= v1.9.0

.PHONY: up down logs run build test vet fmt fmt-check tidy psql migrate migrate-status \
	sqlc sqlc-check sqlc-install vulncheck vulncheck-install

## up: build and start the whole local stack
up:
	$(COMPOSE) up --build -d
	@echo "server   http://localhost:8080/healthz"

## down: stop the stack (add ARGS=-v to also delete data volumes)
down:
	$(COMPOSE) down $(ARGS)

logs:
	$(COMPOSE) logs -f server

## run: run the server on the host against the compose Postgres
run:
	$(COMPOSE) up -d postgres
	@$(DEV_ENV) go run .

## migrate: apply pending migrations without starting the server
migrate:
	$(COMPOSE) up -d postgres
	@$(DEV_ENV) go run . -migrate

## migrate-status: show which migrations have been applied
migrate-status:
	@$(DEV_ENV) go run . -migrate-status

## sqlc: regenerate internal/db/gen from the queries and the migrations
sqlc:
	$(SQLC) generate

## sqlc-check: fail if the checked-in generated code is stale. What CI runs.
sqlc-check:
	$(SQLC) diff

## sqlc-install: install the pinned sqlc
sqlc-install:
	go install github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION)

build:
	go build ./...

## vulncheck-install: install the pinned govulncheck
vulncheck-install:
	go install golang.org/x/vuln/cmd/govulncheck@$(GOVULNCHECK_VERSION)

## vulncheck: fail on a reachable known vulnerability. CI runs it after the tests.
vulncheck:
	govulncheck ./...

## test: run every test, including the database-backed ones
test:
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" go test -race ./...

vet:
	go vet ./...

fmt:
	go fmt ./...

## fmt-check: fail if a tracked Go file is not gofmt-clean *or does not parse*.
# `gofmt -l` exits 0 while listing files, and prints a syntax error to stderr.
fmt-check:
	@bad="$$(gofmt -l $$(git ls-files '*.go') 2>&1)"; rc=$$?; \
	if [ $$rc -ne 0 ] || [ -n "$$bad" ]; then echo "not gofmt-clean (or not parseable):"; echo "$$bad"; exit 1; fi

tidy:
	go mod tidy

psql:
	$(COMPOSE) exec postgres psql -U myapp -d myapp
```

## compose.yaml

Run the real dependencies, nothing stubbed. `depends_on: condition: service_healthy` so the
server does not race the database on a cold start.

```yaml
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: myapp
      POSTGRES_DB: myapp
    ports: ["127.0.0.1:5432:5432"]
    # Not .../data: Postgres 18 keeps a versioned subdirectory, and the old mount
    # silently leaves the data on an anonymous volume.
    volumes: [pgdata:/var/lib/postgresql]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myapp -d myapp"]
      interval: 2s
      timeout: 3s
      retries: 20

  # Captures outgoing mail instead of sending it. http://localhost:8025
  mailpit:
    image: axllent/mailpit
    ports: ["8025:8025"]

  # S3-compatible object storage, off by default:
  # `docker compose --profile s3 up -d rustfs`, then create a bucket with
  # curl --aws-sigv4 aws:amz:auto:s3 --user rustfsadmin:rustfsadmin -X PUT http://127.0.0.1:9000/<bucket>
  rustfs:
    image: rustfs/rustfs:1.0.1
    profiles: ["s3"]
    environment:
      RUSTFS_ACCESS_KEY: rustfsadmin
      RUSTFS_SECRET_KEY: rustfsadmin
      RUSTFS_VOLUMES: /data
    ports: ["127.0.0.1:9000:9000"]
    volumes: [rustfsdata:/data]

  server:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://myapp:myapp@postgres:5432/myapp?sslmode=disable
      # A published development-only secret. Replace before anyone else can
      # reach the deployment.
      SESSION_SECRET: ZGV2ZWxvcG1lbnQtb25seS1zZXNzaW9uLXNlY3JldC0wMDA=
      BASE_URL: http://localhost:8080
      SMTP_HOST: mailpit
      SMTP_PORT: "1025"
    ports: ["8080:8080"]

volumes:
  pgdata:
  rustfsdata:
```

## .github/workflows/ci.yaml

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_USER: myapp
          POSTGRES_PASSWORD: myapp
          POSTGRES_DB: myapp
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U myapp -d myapp"
          --health-interval 2s
          --health-timeout 3s
          --health-retries 20

    env:
      TEST_DATABASE_URL: postgres://myapp:myapp@localhost:5432/myapp?sslmode=disable

    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-go@v7
        with:
          go-version: "1.27"
          cache: true

      # The generated stores must match the SQL they came from. A query edited
      # without regenerating would otherwise reach main as code that compiles
      # and runs the old statement.
      - run: make sqlc-install
      - run: make sqlc-check
      - run: make fmt-check

      - run: go vet ./...
      - run: go build ./...
      # The database-backed tests run here, so a PR cannot break migrations
      # silently.
      - run: go test -race ./...

      # Last on purpose: a newly published CVE must not hide the test results.
      - run: make vulncheck-install
      - run: make vulncheck

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: docker build -t myapp:ci .
```

## sqlc.yaml

Point sqlc at the migrations for the schema, so there is one source of truth.

```yaml
version: "2"
sql:
  - engine: postgresql
    schema: internal/db/migrations
    queries: internal/db/queries
    gen:
      go:
        package: gen
        out: internal/db/gen
        sql_package: pgx/v5
        emit_json_tags: false
        emit_prepared_queries: false
        emit_pointers_for_null_types: true
```

## Migration file shape

`internal/db/migrations/0001_init.sql`:

```sql
-- +goose Up
CREATE TABLE products (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        text NOT NULL UNIQUE,
    title       text NOT NULL,
    price_cents bigint NOT NULL CHECK (price_cents >= 0),
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE products;
```

Numbered, `Up` and `Down` both present, one concern per migration. Money is `bigint` cents.
Use `gen_random_uuid()` so the database mints ids and no UUID library is needed.

## Query file shape

`internal/db/queries/catalog.sql`:

```sql
-- name: GetProductBySlug :one
SELECT * FROM products WHERE slug = $1;

-- name: ListProducts :many
SELECT * FROM products ORDER BY created_at DESC;
```

## styles.css skeleton

Every knob in one `:root` block, so rebranding is overriding variables.

```css
:root {
  /* Colour: ink on paper, one accent. */
  --paper: #fff;
  --paper-sunk: #f6f6f4;
  --ink: #16181a;
  --ink-soft: #4a4f55;
  --ink-faint: #7c848c;
  --rule: #e3e3df;
  --accent: #1f4d3f;
  --accent-ink: #fff;

  /* No web fonts: keeps the CSP tight and adds no third-party request. */
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Fluid type: no breakpoints needed. */
  --text: clamp(0.95rem, 0.9rem + 0.2vw, 1.05rem);
  --title: clamp(1.4rem, 1.2rem + 1vw, 2rem);
  --title-page: clamp(1.9rem, 1.5rem + 2vw, 3rem);

  --gap-xs: 0.35rem;
  --gap-sm: 0.7rem;
  --gap-md: 1.2rem;
  --gap-lg: 2rem;
  --gap-xl: 3.5rem;

  --radius: 6px;
  --measure: 68ch;  /* readable line length */
  --page: 1120px;   /* content width */
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;   /* header / main / footer, footer pinned down */
  font: var(--text)/1.55 var(--font);
  color: var(--ink);
  background: var(--paper);
}

main { flex: 1; padding-block: var(--gap-lg); }

/* One container class, reused everywhere. */
.inner {
  max-width: var(--page);
  margin-inline: auto;
  padding-inline: var(--gap-md);
}

p { max-width: var(--measure); }
h1, h2, h3 { text-wrap: balance; line-height: 1.15; }

/* Responsive with no media query: clamp() in the minmax() minimum gives 2-up on
   a phone and 4-up on a desktop. A flat minimum collapses to one giant card. */
.cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--gap-md);
  grid-template-columns: repeat(auto-fill, minmax(clamp(9rem, 30vw, 15rem), 1fr));
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
  text-decoration: none;
  color: inherit;

  /* A fixed-ratio well, so portrait and landscape photos both sit tidily. */
  > .frame {
    aspect-ratio: 4 / 5;
    overflow: hidden;
    background: var(--paper-sunk);
    border-radius: var(--radius);

    > img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.3s ease;
    }
  }

  &:hover > .frame > img { transform: scale(1.03); }
  &:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
}

button, .button {
  padding: var(--gap-sm) var(--gap-md);
  border: 0;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--accent-ink);
  font: inherit;
  cursor: pointer;

  &:hover { background: color-mix(in oklab, var(--accent), black 12%); }
  &:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Layout template shape

`{{asset "…"}}` resolves to a content-hashed URL, so an override takes effect immediately.

```html
{{define "head"}}<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}} — {{.SiteName}}</title>
<link rel="stylesheet" href="{{asset "styles.css"}}">
<script src="{{asset "htmx.min.js"}}" defer></script>
</head>
<body>
<header class="site-header">
  <div class="inner">
    <a class="brand" href="/">
      <img src="{{asset "logo.svg"}}" alt="" width="28" height="28">
      {{.SiteName}}
    </a>
    <nav><a href="/">Home</a></nav>
  </div>
</header>
<main>
<div class="inner">
{{end}}

{{define "foot"}}
</div>
</main>
<footer class="site-footer">
  <div class="inner">
    <strong>{{.SiteName}}</strong>
  </div>
</footer>
</body>
</html>
{{end}}
```

## htmx, vendored

**Always use the newest htmx release** — currently 4.x — pinned explicitly. Look it up
when founding a project and whenever you touch the vendored copy: `npm view htmx.org
versions --json` and take the highest stable version, **not** `npm view htmx.org version`,
because npm's `latest` dist-tag lagged on 2.x for months after 4.0.0 shipped (it was tagged
`next`). When a new major appears, read its upgrade notes and `review-traps.md` before
switching. Take `dist/htmx.min.js` (the classic build, for `<script defer>`;
not `htmx.esm.min.js`) from the npm tarball after checking the tarball's sha512 against
the registry's `.dist.integrity`. Put it in `internal/handler/static/htmx.min.js`
alongside `htmx.LICENSE`, and record the version, the tarball URL and its
`dist.integrity` (so the bytes trace to the release) in
`internal/handler/static/README.md`, with the file's SHA-256 on one fixed line,
`sha256: <hex>`, that a test parses and checks against the embedded file. No `htmx-config` meta is needed under the strict
CSP; see the htmx 4 entries in `review-traps.md` before adding preview forms. That note is embedded with everything else but its
`.md` extension is not in the content-type map, so it is never served.

No CDN link: it would mean widening `script-src` and putting a request to someone else's
server on every page, including the ones in a payment path.


## The SQLite variant

Replaces `sqlc.yaml`, the migration/query files, and the Postgres service in
`compose.yaml`. Reasoning is in `sqlite.md`; this is the shape.

### internal/db/db.go

```go
// Every table is STRICT: SQLite otherwise applies type affinity and will happily
// store "banana" in an INTEGER column. Every column is therefore TEXT or INTEGER
// -- a column typed BOOLEAN, VARCHAR(n) or DATETIME is a startup failure, which
// is the point. Timestamps are RFC3339 TEXT; SQLite has no datetime type.
//
// STRICT cannot be retrofitted: CREATE TABLE IF NOT EXISTS ... STRICT silently
// does nothing to a table that already exists and reports success. A database
// predating it must be recreated, not migrated.
const schema = `
CREATE TABLE IF NOT EXISTS submissions (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL,
	email      TEXT NOT NULL,
	email_sent INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at);
`

// Open opens the database at path (creating it if needed), enables foreign key
// enforcement, and applies the schema. IF NOT EXISTS throughout, so it is safe on
// every startup.
//
// There is deliberately no migration machinery: a schema change means dropping the
// database and re-seeding (`make recreate-db`). Config is reproducible from
// data/*.json, and a startup ALTER against a STRICT table can only half-migrate --
// new column, old table definition.
func Open(path string) (*sql.DB, error) {
	// _foreign_keys=on because SQLite enforces no foreign key without it: every
	// REFERENCES in the schema above is decoration until this is set.
	// _txlock=immediate so a read-then-write transaction takes the write lock at
	// BEGIN; deferred, the upgrade fails with "database is locked".
	dsn := fmt.Sprintf("file:%s?_foreign_keys=on&_txlock=immediate", path)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return db, nil
}
```

### internal/db/db_test.go

The DDL can lie, so assert against `sqlite_master`:

```go
func TestEveryTableIsStrict(t *testing.T) {
	d := openTemp(t)
	rows, err := d.Query(`SELECT name, sql FROM sqlite_master
	                      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
	// ... fail any ddl without ") STRICT"
	// Guard against passing vacuously if the schema stops applying:
	if seen < wantTables {
		t.Errorf("found %d tables, want at least %d", seen, wantTables)
	}
}
```

Pair it with one test that a wrong type is actually refused, and one that the Go
types the stores bind (`bool` → INTEGER, nil `*string` → NULL) still round-trip.

### Store shape

No sqlc. Hand-written typed methods on a `Store` holding `*sql.DB`, with the
create/guard statements atomic:

```go
// Create inserts s only if its id is free, reporting whether it did. Unlike
// Upsert it can never overwrite, and the check and the write are one statement --
// which a FindByID-then-Upsert pair is not.
func (s *Store) Create(row Row) (bool, error) {
	res, err := s.db.Exec(`INSERT INTO t (...) VALUES (...)
	                       ON CONFLICT(id) DO NOTHING`, ...)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}
```

### Makefile targets

```make
## seed: insert-only load from data/*.json -- an edited row is left alone
seed:
	go run ./cmd/seed

## seed-force: reload from JSON, overwriting existing rows
seed-force:
	go run ./cmd/seed -force

## export: write the DB's current config back out in the shape seed reads
export:
	go run ./cmd/export

## recreate-db: drop and re-seed. DESTROYS submissions -- the schema-change path.
recreate-db:
	rm -f data/app.db data/app.db-wal data/app.db-shm
	go run ./cmd/seed
```

`compose.yaml` keeps `mailpit` (and `rustfs` if used) and drops the `db` service; the
database is a file on a mounted volume.
