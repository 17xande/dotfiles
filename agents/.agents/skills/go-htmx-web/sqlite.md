# SQLite as the database

Everything specific to the SQLite variant of this stack. Distilled from a real
project shipped this way.

This replaces the Postgres rows in `setup.md`'s stack table and its whole
"sqlc + goose workflow" section. Everything in `SKILL.md` still applies unchanged.

## Choosing SQLite or Postgres

**The forcing function is instance count, not volume.** Get this the right way round:
capacity almost never decides it.

SQLite does thousands of writes/sec with WAL, and reads are an in-process function
call — no network hop, no connection handshake, no serialisation. For a
read-heavy server-rendered app it is *faster* than Postgres, not a compromise. A
form-submission workload peaking at ~1 write/sec is using ~0.1% of the write
capacity, and a decade of submissions is still under a million rows.

Pick **Postgres** when one of these is true — none of them is about row counts:

| Trigger | Why SQLite cannot |
|---|---|
| Two or more app instances | It is a local file. Two containers cannot share it, and a network filesystem makes it worse, not better. |
| Blue/green or rolling deploys with overlap | Same reason: two processes, one file. |
| Anything else reads the database | A reporting tool, a dashboard, another service. |
| Managed point-in-time recovery is a requirement | File-level backup is what you get. |
| Multi-region | No. |

Otherwise **SQLite**, and say so in the README with the trigger that would change it
(the "Decisions still open" table in `setup.md`).

**The cgo cost.** `mattn/go-sqlite3` needs cgo, which forfeits the static-binary
property `pgx` gives you — the distroless image still works, but `CGO_ENABLED=0`
does not. `modernc.org/sqlite` is pure Go and keeps the static build, at the cost
of a much larger, machine-translated dependency. Decide it explicitly; do not let
it lapse.

## Connection setup

```go
// _foreign_keys=on because SQLite enforces no foreign key at all by default --
// the constraint is in the schema and silently does nothing without it.
dsn := fmt.Sprintf("file:%s?_foreign_keys=on", path)
db, err := sql.Open("sqlite3", dsn)
```

- **`_foreign_keys=on` is not optional.** Foreign keys are off by default. Every
  `REFERENCES` in the schema is decoration until you set it, so the delete you
  thought was refused silently orphans rows.
- **`busy_timeout` already defaults to 5000ms** in `mattn/go-sqlite3` — check the
  driver you use rather than assuming, and do not add a redundant DSN parameter.
  Without a busy timeout a contended lock is an immediate `SQLITE_BUSY` error
  instead of a wait, which matters enormously when the failing write is the one
  that persists a visitor's submission.
- **WAL is optional and has a documentation cost.** `_journal_mode=WAL` lets
  readers run concurrently with the writer instead of blocking. Worth it under
  real concurrency; at a handful of requests/sec it changes nothing. Three
  caveats if you take it: it needs the *directory* writable (it creates `-wal` and
  `-shm` sidecars), it is unsafe on network filesystems, and it changes the
  correct backup command — a naive `cp` of a WAL database can capture a torn
  state, so backups become `VACUUM INTO` or the backup API. Raise it as a
  decision, do not enable it silently.

## STRICT tables: on, always

SQLite's default "type affinity" will store the string `"banana"` in an `INTEGER`
column without complaint. `STRICT` refuses it.

```sql
CREATE TABLE IF NOT EXISTS enquiries (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	group_id   TEXT NOT NULL REFERENCES groups(id),
	email_sent INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
) STRICT;
```

- Every column must be `INT`, `INTEGER`, `REAL`, `TEXT`, `BLOB` or `ANY`. A column
  typed `BOOLEAN`, `VARCHAR(255)` or `DATETIME` is a startup failure — which is
  the point. In practice a schema like this needs only `TEXT` and `INTEGER`.
- **⚠️ `STRICT` cannot be retrofitted.** `CREATE TABLE IF NOT EXISTS … STRICT`
  does nothing to a table that already exists **and reports success**. Add it to
  an existing database and you get strict tables in every test (fresh files) and a
  permissive production database for ever — a silent test/prod divergence, the
  worst available outcome. Converting needs a per-table rebuild: create, copy,
  drop, rename, inside a transaction with `foreign_keys=off`.
- **Assert it against `sqlite_master`, not the DDL**, precisely because the DDL can
  lie:

```go
rows, _ := db.Query(`SELECT name, sql FROM sqlite_master
                     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
// ... fail if !strings.Contains(strings.ToUpper(ddl), ") STRICT")
// Also assert a minimum table count, or the test passes vacuously when the
// schema stops applying at all.
```

- **`STRICT` bounds the type class only.** It will not stop `email_sent` being `7`
  or `created_at` being `"banana"`. `CHECK (email_sent IN (0,1))` is the
  complement — worth adding, and subject to the same no-retrofit rule, so decide
  it at the same time.

## No datetime type

SQLite has none. Store timestamps as RFC3339 `TEXT`, in UTC:

```go
now.UTC().Format(time.RFC3339)
```

Reading them back needs an adapter, because "never happened" is naturally the
empty string rather than `NULL`:

```go
// timeScan adapts a TEXT column into a time.Time, treating "" as the zero time --
// which is what last_login_at holds for someone who has never signed in.
func timeScan(dst *time.Time) sql.Scanner { return timeScanner{dst} }
```

**Label the timezone wherever a timestamp is displayed** (`When (UTC)`) or convert
it deliberately. Rendering UTC unlabelled means every operator in a non-UTC
timezone misreads every timestamp by their offset, silently.

## Go types that work under STRICT

Verified, so do not re-litigate them:

| Go | Column | Note |
|---|---|---|
| `bool` | `INTEGER` | Driver binds 1/0; scans back into `bool` |
| `*string` (nil) | nullable `TEXT` | Becomes `NULL`; scan via `sql.NullString` |
| `int` | `INTEGER` | |
| `time.Time` | `TEXT` | Format yourself; see above |

## Atomic writes: the single-statement rule

SQLite gives you no advisory locks and this stack exposes no transaction to
handlers, so **any check-then-write across two statements is a race**. Every guard
becomes one statement.

**Create-if-absent** — the primitive for "refuse a duplicate rather than
overwriting":

```go
res, err := s.db.Exec(`INSERT INTO groups (...) VALUES (...)
                       ON CONFLICT(id) DO NOTHING`, ...)
n, _ := res.RowsAffected()   // 0 means it already existed
```

Never `FindByID` then `Upsert` on a create path: losing that race silently
overwrites the row that won it, which is exactly what the doc comment promised it
refused.

**A guard that counts** — e.g. refusing to disable the last enabled admin. Put the
count in the `WHERE`, not in a preceding query:

```sql
UPDATE admin_users SET disabled = 1
WHERE id = ?
  AND (disabled = 1                                               -- already disabled: a no-op, allow it
       OR (SELECT count(*) FROM admin_users WHERE disabled = 0) > 1)
```

`RowsAffected() == 0` is the refusal. Two admins disabling each other concurrently
would otherwise each read "2 enabled", each pass a separate check, and between
them leave nobody able to sign in. Keep a count-based check in the handler too,
but only for *rendering* the button — the store decides.

**Match how the read path matches.** If the read filters `COLLATE NOCASE`, the
duplicate check must too. `"sandton"`, `"Sandton"` and `"Sandton "` are three
different primary keys and one location to the user, so an exact-match guard lets
all three through and the listing shows three copies of one row. Trim identity
fields and add a `FindByLocationSlug`-style lookup that collates the same way.

## Migrations: don't, while it is greenfield

With no deployment and reproducible seed data, a schema change is
`rm database && seed`. Provide `make recreate-db` and use it.

- **No ad-hoc `ALTER`s on startup.** A `PRAGMA table_info` + `ALTER TABLE ADD
  COLUMN` helper looks harmless and is worse than nothing once tables are
  `STRICT`: the column arrives, the old non-strict table definition stays, and the
  database silently diverges from the schema file. Say so in a comment next to
  `Open` so it is not re-added by reflex.
- Adopt a real versioned tool (goose) **when there is production data worth
  preserving** — and note that goose's advisory-lock story assumes Postgres, so a
  scaled-out SQLite deployment was never on the table anyway.
- Keep config reproducible from JSON so drop-and-recreate stays cheap: a
  `SeedFromFile(path, force)` that is insert-only unless forced, plus an
  `ExportJSON` that writes the database's current state back out in the shape the
  seeder reads. That pair is what makes the database the source of record without
  making it the only copy.

## Seed and export

- **`SeedFromFile` is insert-only by default**, upserting only with `-force`. Once
  an admin has edited a row, a redeploy running the seeder must not discard the
  edit. Report `inserted`/`skipped` counts so the operator sees which happened.
- **Export is the other half.** Same shape the seeder reads, sorted for a stable
  diff — and sort by the *same* key the importer writes, or the first export after
  an import is a whole-file reshuffle rather than a content diff.
- **Encode an empty table as `[]`, not `null`.** A backup file reading `null` is
  an unhelpful artefact and makes an empty export hard to tell from a broken one.
- **⚠️ Never write an export with `os.Create`.** It truncates *before* the export
  runs, and `sql.Open` on SQLite **creates an empty database** when the path does
  not exist. So `make export` with `DB_PATH` unset, wrong, or simply run before
  the seed overwrites a real data file with `null` and reports success. Render to
  a buffer, refuse an empty export over an existing file, and `os.Rename` a temp
  file into place.
- Round-trip test: seed → edit → export → fresh database → seed from the export →
  compare every row. That test is what makes the export trustworthy as a backup.
