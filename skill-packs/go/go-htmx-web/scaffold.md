# Scaffold: start from the gowebkit template

A new project is generated from the published template, not assembled from snippets. The
template is a complete, runnable app (setup token, sign-in with the focus convention in
`SKILL.md`, sessions, CSRF, admin users page, an `env` config loader with its docs-parity
test, optional mail delivered through the `outbox` queue with an `/admin/jobs` page,
Dockerfile, Compose, Kamal, `make gate`, its own tests) built on the kit modules in
`setup.md`. Generated apps are forks from day one; they do not track the template.

| Variant | Module | Use it |
|---|---|---|
| SQLite (the default) | `github.com/17xande-dev/gowebkit/template/sqlite` | unless a trigger in `sqlite.md` applies |
| Postgres | `github.com/17xande-dev/gowebkit/template/postgres` | only when one does |

Tags are per variant and released in pairs: `template/sqlite/vX.Y.Z` and
`template/postgres/vX.Y.Z` (v0.3.2 at the time of writing). Name the version you used in
the first commit.

## Generate and first run

Needs Go 1.27+, Docker with Compose v2, Bash and make.

```sh
go install golang.org/x/tools/cmd/gonew@latest
gonew github.com/17xande-dev/gowebkit/template/sqlite@v0.3.2 example.com/myapp
cd myapp
git init -q && git add -A && git commit -qm "Generate from gowebkit template/sqlite v0.3.2"
make gate   # fmt-check, vet, race tests (prints the skip count), govulncheck; installs its tools
make up     # app + Mailpit; http://localhost:8080/healthz answers ok
make logs   # the one-time setup token; open /setup to create the first admin
```

Commit before `make gate`: `fmt-check` lists files with `git ls-files`. The Postgres
variant's `make gate` starts its Compose database first and fails rather than skips
without it (`TEST_REQUIRE_DB=1`).

`gonew` rewrites only the module path and Go imports. Every non-Go file keeps the
placeholder `myapp` (plus `OWNER`, `server.example`, `example.com` in the deploy config),
and gonew drops executable bits, which is why the template has Makefile targets, not
scripts.

## Before the first deploy, in this order

1. `make rename NAME=appname`, **before** starting the app under Compose or creating
   any volume: it renames the non-Go defaults, volume names included.
2. Fill in `config/deploy.yml` and the gitignored `.env.production` (mode 0600).
   `.kamal/secrets` holds references only.
3. Commit, export the secrets (`set -a; . ./.env.production; set +a`), then
   `make deploy-check`: it refuses any placeholder left in `config/deploy.yml` and
   uncommitted tracked changes (Kamal builds HEAD), then runs `make gate`.
4. First deploy with `kamal setup`; after that `make deploy` (`deploy-check`, then
   `kamal deploy`). Postgres: boot the accessory and wait until it reports healthy
   before deploying the app (`review-traps.md`, "Deploys").

The generated `docs/deploy.md` has the rest: proxy and `CLIENT_IP_SOURCE`, smoke tests,
migrations, rollback with `-migrate-down`, removal.

## Read the template at a version

Through the module proxy, like a kit module's README; no clone, no local path:

```sh
GOWORK=off go mod download -json github.com/17xande-dev/gowebkit/template/sqlite@v0.3.2
```

Open the `Dir` field. It works outside any module. Inside: `README.md` (configuration
table, every environment variable), `docs/database.md`, `docs/deploy.md`,
`docs/operations.md`, and the code itself, which is the reference implementation of
most rules in `SKILL.md`. The repository's own `docs/` (choosing a database, upgrading
an app, releasing) and `CHANGELOG.md` are not in the module zip; read them in the
gowebkit repository.

To bring an existing app closer to the template, follow the repository's
`docs/upgrading-an-app.md` one item per commit, reading the template code at the version
you port from. Never copy code from another app instead. Each `CHANGELOG.md` entry
says how to port that release (v0.2.0 the `env` loader, v0.3.0 the queue, v0.3.1 the
sign-in focus, v0.3.2 the queue's `MigrationStatus`); port them in order.

## Working on the template repository

Change both variants together. A shared file is written in `template/sqlite` and
copied to Postgres by `tools/variantsync`; never edit a shared file under
`template/postgres`. `template/variants.txt` lists the paths each variant owns (add a
new one there first); change the other variant's equivalent too. Commit before
checking, since generation reads `HEAD`.

- `make check-all-fast` every time: tools, hygiene, variant sync, both source gates,
  and `make gate` in apps generated from `HEAD`.
- `make check-all` before a release: adds both image builds and the headless
  first-run check (`tools/e2e`: setup, sign-in, forced password change, mail test;
  zero console errors and CSP violations, no overflow at 390x844).
- **Hygiene**: `make hygiene` scans files, history, messages and identities. The
  public tool holds only generic rules; the project-specific list lives in a private
  file **outside the repository** (never paste its contents anywhere public, including
  commit messages and skills). Run `HYGIENE_REQUIRE_PRIVATE=1 make hygiene` before
  every push so a missing list fails instead of silently scanning generic rules
  only. Accept an intentional match only through `tools/hygiene/allowlist.txt`, one
  exact record with a comment saying why.
- Changelog entry with porting steps, then tags (`template/sqlite/vX.Y.Z` and
  `template/postgres/vX.Y.Z` together) on the user's word; the proxy rule in
  `setup.md` applies.

## What the template leaves out

No object storage, no `TEMPLATE_DIR`/`STATIC_DIR` overrides (one deployment you control),
no seed/export commands, no hosted CI workflow, and only one job kind (`mail-test`):
an app's own side effects are new kinds in `internal/jobs` (`queue.md`). Add what a project needs by the rules
in `setup.md`; each addition is a dependency question like any other.
