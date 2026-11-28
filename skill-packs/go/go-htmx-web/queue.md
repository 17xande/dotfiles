# Background jobs: the `outbox` queue

Mail, webhooks and anything else a request triggers but must not wait for go
through `github.com/17xande-dev/outbox`: a transactional queue that owns its own
tables. Not a goroutine fired from the handler (lost on restart), not a hand-rolled
`jobs` table (every app that had one drifted), not a separate queue service. The
module README at the pinned version is the manual; the gowebkit template's
`internal/jobs`, `main.go`, `cleanup.go` and `/admin/jobs` are the reference wiring.

## What the module gives you

- **Stores:** `outbox/sqlitestore` (needs `sqlitekit` v0.3.0+) and `outbox/pgxstore`.
  Each owns `outbox_jobs` and its own goose history table, `outbox_goose_version`;
  it never touches the app's history.
- **At-least-once delivery.** Handlers must be safe to repeat. Retries back off
  (six attempts by default), `outbox.Permanent(err)` dead-letters at once,
  `RetryAfter` waits longer. A worker claims only the kinds it registers.
- **Hooks in the transition's transaction:** `Kind.OnDone` / `OnDead` get the tx
  that records the outcome, to flip a flag in the app's own tables atomically. A
  failing `OnDone` re-runs the handler, so hooks are repeat-safe too.
- **`Sealer`** (`outbox.AESGCM`) for payloads that cannot be re-derived; prefer an
  id in the payload and load the data when the job runs.
- **Admin API, no HTML:** `List` (100 by default, `Filter.All` for one subject's full
  history), `Get`, `Stats`, `Retry`, `RetrySubject`, `Discard`, `DeleteSubject`,
  `Purge`. Every admin action records an actor.
- **`StopContext(ctx)`** bounds the join by the shutdown deadline; **`Wake` is safe on
  a nil queue**, so a handler built without one in tests can call it unconditionally.
- **`MigrationStatus`** (both stores) reads the queue's history without creating
  anything, for `-migrate-status`.
- **`outboxtest`:** a fake clock, `Enqueued`, `Drain` (runs what is due, no sleeps)
  and a log probe.

## Adoption patterns

- **Enqueue in the app's transaction**, beside the write that needs the job, then
  `Wake()` after the commit. `EnqueueNow` only when there is no related write (an
  admin's "send a test message" button).
- **Migrations: the app's first, then the queue's, under the same lock.** On SQLite
  hold one `sqlitekit.MigrationLock` around `goosestrict` `Up` and then
  `sqlitestore.Migrate`: on a fresh database the app's strict provider refuses a file
  that already has (queue) tables but no app history. On Postgres `pgxstore.Migrate`
  takes its own advisory lock and two pool connections, so hold the app's lock on a
  connection outside the pool. `-migrate-down` rolls back app migrations only.
- **Start the worker after migrations; stop and join it before the database
  closes.** `queue.Start(ctx)` once the schema is current. On shutdown, `Stop` (or
  `StopContext`) and, if it returns an error, keep the pool open and stop again: a
  worker still running against a closed database turns a clean shutdown into
  failed jobs. Give the process manager a stop timeout longer than the drain.
- **Log the class, never the content.** The module logs ids, kinds, attempts and the
  error's Go type. Pass an `Options.Describe` that maps errors to fixed texts
  (`last_error` is shown on the admin page; SMTP errors carry addresses and
  sometimes credentials). Payloads, subjects and error text never reach a log line.
- **Admin dead-jobs page:** counts by state and the dead jobs, each with a **Retry
  button that is a CSRF-protected POST**, behind the protected-route closure so the
  anonymous sweep covers it. The actor is the admin's id (`"user:7"`), never an
  email. A lost race (already retried) is a fixed notice, not an error.
- **Purge from the cleanup loop** (`JOB_KEEP_DONE` in the template); dead jobs stay
  until someone handles them.
- **Retiring a kind:** keep it registered with a `Run` that returns `Permanent`,
  deploy, wait until none is pending, `Discard` the dead ones, then remove it.
  Removing the registration first strands its jobs as pending for good.

## Replacing an app's legacy queue

An app with its own older `jobs` table moves over in one stop-first release:

- **Import at startup**, idempotently by id, preserving ids, attempts, results and
  retry history; a running row becomes pending at the later of its run time and
  lease expiry. Keep the legacy table for a release, and **disable every delete from
  the new queue (`Purge`, `DeleteSubject`) while it exists**, or the next startup
  re-imports what was purged. Pin that rule with a test. A later migration drops the
  legacy table and the import together.
- **Write the undo SQL before the deploy** (outbox rows back into the legacy table,
  state mapping, timestamps in the old format), check it into `testdata/`, run it
  in a test against a migrated fixture, and guard it (`review-traps.md`, "Undo
  SQL"). Without it the old binary finds its table frozen at cutover and re-sends
  everything the new worker already delivered.
- **Stop-first deploy.** The old and new workers read different tables and would
  both deliver the same job. Full sequence in `review-traps.md`, "Deploys".

## Testing

- **Deterministic drains:** `outboxtest.NewClock` as `Options.Now`, enqueue through
  the real handler, `outboxtest.Drain(t, q)`, `clock.Advance` past a backoff, drain
  again. No sleeps, no real ticker, no `Start` in a unit test.
- Assert the hooks' effect on the app's tables, the dead reason text (fixed, from
  `Describe`), and that a planted secret never reaches the log.
- **⚠️ One SQLite connection means hooks use only their tx.** With
  `SetMaxOpenConns(1)`, an `OnDone` that queries through the `*sql.DB` instead of the
  tx it was given waits forever for the connection its own transaction holds. Pass
  the tx down; a test with the production pool size proves it.
- A queue-table change in a release: read the module's changelog for migrations and
  plan it as a stop-first deploy.
