---
name: go-htmx-web
description: >
  How to build, test and maintain a Go + htmx web application in this user's preferred
  style: stdlib-shaped net/http and html/template, SQLite (STRICT) or Postgres via
  pgx + sqlc + goose, a deliberately tiny dependency surface, embedded assets, plain
  modern CSS, a strict CSP, and a container-first local stack. Load this whenever you
  touch such a project -- founding one, adding a feature to one, reviewing one, or
  debugging one. It carries the layout conventions, admin-area patterns, security
  baseline, testing gate and tool discipline; setup.md carries the founding decisions
  (stack, dependency rule, embedding, CSS theme, local stack), sqlite.md the SQLite
  data layer, review-traps.md the bugs this stack actually produces, scaffold.md the
  starting files. Triggers: "new web project", "new Go project", "start a web app",
  "should I use <framework/library>", "sqlite or postgres", "set up migrations",
  "add a dependency", "scaffold", htmx, sqlc, goose, STRICT tables, "admin area",
  "admin page", CSP, "review this", "why is this broken", "look and feel",
  "default theme".
---

# Go + htmx web applications

The house style. It is stdlib-shaped, small, and container-first. Distilled from real
projects built end to end this way; every rule below exists because a specific alternative
was considered and rejected.

This file is what applies **whenever you touch such a project** — founding one, adding to
one, or debugging one. The founding decisions live in `setup.md`, because you make them
once.

| File | Read it when |
|---|---|
| `setup.md` | Founding a project: the stack, the dependency rule, embedding, CSS, the local stack |
| `scaffold.md` | Starting a project — concrete working files, Postgres and SQLite variants |
| `sqlite.md` | The database is SQLite: STRICT, DSN, atomic writes, seed/export |
| `review-traps.md` | Reviewing, debugging, or about to ship a phase |

The single most important rule is at the bottom: **never decide a dependency by default.**

## Tools: use these, they are not optional


Stated first because burying them at the bottom demonstrably does not work — this section
exists because both were mentioned in passing and both were still skipped.

**gopls, via the LSP tool — not grep — for anything about Go symbols.** Load the `go-lsp`
skill for the full workflow. Reach for it *before*:

- renaming or changing the signature of anything exported;
- deleting a function or type — `findReferences` first, so "unused" is a fact;
- exploring an unfamiliar package's API (`documentSymbol`, `hover`);
- asking "where is this used" or "did that break anything".

ripgrep is for non-Go text. The Edit tool is for file text. Neither is a substitute for
the LSP when the question is about a *symbol*.

**The Chrome DevTools MCP server for every UI change.** Not a screenshot as an
afterthought — navigate, click the thing you changed, submit the form, and read the
console. A handler test never runs JavaScript and never enforces a CSP, so the browser is
the only place a whole class of bug is visible (see `review-traps.md`, which opens with two
of them). Headless `--screenshot` is the fallback when the MCP server is unavailable, not
the default.

## Adding a dependency mid-flight

The full rule and the list of libraries that have earned their place are in `setup.md`.
The part that matters *after* setup:

> The objection is to **frameworks**, not libraries — and "I'll just add X while I'm here"
> is the same mistake as a bad architectural pick, made faster.

Raise the choice, name the candidates and the trade-off, get an explicit answer. Prefer a
small, widely-reviewed library over hand-rolling anything security-sensitive; prefer a few
dozen lines of your own over a thin wrapper around what the stdlib already does. Record a
deferred choice in the README's "Decisions still open" table so it is decided deliberately
rather than by lapsing.

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

## Server-rendered admin areas


A staff UI inside a fragment-serving app is a second kind of response — whole documents
with a layout — and the two must not be allowed to blur.

- **Path-split the security headers.** The public routes keep their tight policy
  (`default-src 'none'`) plus whatever CORS the frontend origin needs; `/admin` gets
  `'self'` for style/script/img/form-action, `X-Robots-Tag: noindex`, and **no CORS headers
  at all** — echoing credentials there would let the frontend origin read authenticated
  admin responses. Key the split on the request path so it applies to a 404 under `/admin`
  too, and **pin the public policy with a test** so admin work cannot loosen it.
- **Parse one template set per page**, not one flat set. If every page defines `content`,
  a flat set silently lets the last file parsed win and pages render as each other. A page
  defining no `content` is a startup failure.
- **Choose the layout by directory, not a flag.** The login page renders for someone with
  no session, so it needs a layout with no sign-out button *in scope*.
- **Derive the protected-route list** from the closure that registers the routes, and have
  a test assert each one refuses an anonymous request. Record the method — a POST route
  answers a GET with 405 before any middleware runs, so a GET-only sweep proves nothing.
  Pin the handful of deliberately-public lines by source text so a new mounting path fails
  the test.
- **Notices come from a fixed code map** (`?notice=saved`), never echoed query text.
- **Reach for htmx sparingly**, and only on an element that also carries a real
  `href`/`action`. Plain POST-redirect-GET forms are the default.
- **The zero-inline-style rule binds the admin, not necessarily the public fragments.**
  Admin pages are policed by the admin CSP, so they must carry none. A public fragment
  swapped into someone else's page (a honeypot input positioned off-screen, say) is
  governed by *that* page's policy, not ours — so an inline style there is fine. Keep the
  asymmetry deliberate and documented, or someone will "fix" one side of it.

## Security baseline


Set this up early; retrofitting is worse.

- **Zero `style="…"` attributes in served templates**, and drop presentational HTML
  attributes (`border`, `cellpadding`). This is what lets the CSP keep
  `style-src 'self'` with no `'unsafe-inline'` — enforce it with a test that walks every
  served page. Email templates are exempt: no CSP has ever applied to them.
- **⚠️ Zero inline event handlers, for the same reason.** `script-src 'self'` refuses
  `onchange=`, `onclick=` and friends just as firmly. A filter wired
  `onchange="this.form.submit()"` renders fine, returns 200, passes every handler test —
  and silently does nothing in a real browser. Use a real submit button; it needs no
  JavaScript at all. Assert no served page contains `on*=`. This is the single most
  expensive trap in this stack; see `review-traps.md`.
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
  command-line argument, so it stays out of shell history and `ps`. **Enforce the same
  password policy there as in the web forms** — it creates the first and most privileged
  account.
- **Password policy is length only** (12 chars). Composition rules push people towards
  short mangled words; argon2id already makes offline guessing expensive.
- **Rate-limit every endpoint that verifies a password, not just login.** A
  "change my password" form requiring the current one is a guessing oracle with a
  distinct wrong-password response, and an unmetered argon2 call is a memory lever
  (~64 MiB each). The login limiter's tight tier must not be keyed on a cookie — an
  attacker discards that for free — so key it on something undroppable with a looser
  per-IP ceiling behind it.
- **Make a failed login cost the same as a missing account**: verify against a dummy hash
  when the email is unknown, check `disabled` *after* the password, one message for every
  cause.
- **Sessions: prefer a database table over a signed cookie** whenever you need named
  accounts, per-user disable, or "changing a password ends existing sessions" — each of
  those is a per-request lookup anyway, so the table is the mechanism, not the cost. An
  opaque `crypto/rand` token stored as its `sha256` is then the whole design. Reach for
  `gorilla/securecookie` only when the cookie must genuinely carry claims and nothing
  needs revoking.
- **An admin credential ignores the public `SameSite` setting.** A `COOKIE_SAMESITE` knob
  exists so a public embedded form can be cross-site; letting an admin cookie follow it to
  `None` lets any site make the browser send it. Hard-code `Lax` and comment why.
- **Parse a state change strictly.** `value == "1"` makes every other value — including an
  absent field — mean the *other* thing. Require an explicit `"0"`/`"1"` and 400 otherwise,
  or a POST with an empty body silently performs the unguarded direction.
- **Buffer a download or export before writing headers.** Streaming commits a 200 before
  the work can fail, handing the operator a truncated file that looks like a good backup.
- **⚠️ Escape user-supplied text in CSV exports.** Excel and Sheets evaluate a cell
  beginning `=`, `+`, `-` or `@`, so a public form submission becomes a live formula on a
  staff machine. Route every text cell through one helper. `+27…` phone numbers are the
  common trigger.
- Never echo secrets in Makefile recipes (prefix with `@`).

## Testing and verification


- **Tests ship with the code that adds them**, in the same commit — not a later pass.
  `_test.go` next to the file it covers.
- Test against a **real database** — `TEST_DATABASE_URL` + an `internal/dbtest` helper on
  Postgres; a temp-file database per test on SQLite. Not mocks. Fakes are for the
  storage/mail boundary, where the real thing is a network service.
- **Test the code that talks to the network, not just the helper beside it.** A real
  SMTP-sending bug survived because only the header-sanitising function had a test. An
  in-process fake SMTP server is ~80 lines and worth it.
- Test comments should say *why the behaviour matters*, not restate the assertion.
- No frontend test framework. Assert on rendered HTML from real handler requests — while
  remembering that a handler test never runs JavaScript and never enforces a CSP, which is
  precisely the gap the browser step below closes.
- **Assert a minimum count in any "every X must Y" test**, or it passes vacuously the day
  the fixture stops loading.

**Review every phase before moving on.** Across seven phases of a real build, every single
review pass found something, and two found a shipped feature that did not work at all. A
phase is done when someone has looked for the class of bug the tests structurally cannot
see — not when the suite goes green. `review-traps.md` is the checklist.

**The verification gate before any commit:**

```sh
gofmt -l . ; go vet ./... && make sqlc-check && \
  TEST_DATABASE_URL="…" go test -count=1 ./...
```

(`sqlc-check` only on Postgres. Use `-count=1`: a cached pass after an environment change
is not a pass.)

**Then drive it in a browser.** Not optional, and not satisfied by a screenshot of the
happy path. Use the Chrome DevTools MCP server:

1. Start the server on a **fresh, confirmed-free port** (`pgrep -af <binary>` first — a
   stale `go run` answering on the old port has produced confident false readings).
2. `navigate_page` to the page you changed.
3. `take_snapshot` — the a11y tree names every control, which is what you click by.
4. **Interact**: click the button, change the select, submit the form. Assert on where it
   navigated and what changed, not just that the page rendered.
5. `list_console_messages` — a CSP violation appears here and nowhere else.
6. `resize_page` to 390×844 and look again: does the layout hold, and does the *body*
   scroll sideways (it must not — wide content scrolls inside its own container)?

Fallback when the MCP server is unavailable:

```sh
docker compose up -d --build server
chromium --headless --disable-gpu --hide-scrollbars --window-size=1280,900 \
  --screenshot=out.png http://localhost:8080/products
```

Two real bugs of this exact shape, both HTTP 200 with correct markup and a green suite:
the CSP `img-src` bug above showed a page of broken images, and an `onchange` filter
handler was refused by `script-src 'self'` so two list pages' filters silently did
nothing for weeks. **Interact with what you changed** — click the button, submit the
form — at desktop *and* phone widths, and check for a horizontally scrolling body.

## Working style


- **A phased plan, in a file outside the repo** (`~/.claude/plans/<name>.md`). Build one
  phase at a time, each ending in a working, tested, committed state. Keep the plan out of
  the codebase. **Record each phase's outcome back into the plan** — what shipped, what the
  review found, and what the next phase must not repeat. That written trail is what stops
  the same class of bug recurring three phases later (it recurred anyway twice; without the
  trail it would have been more).
- **Confirm before crossing a phase boundary** in a new session, rather than rolling on.
- **End the plan with a whole-system verification checklist** and actually run it. The one
  written for a real project found a bug no test covered: an end-to-end path (edit config
  in the admin → submit the public form → assert the mail went to the *new* recipients)
  that no unit test joined up.
- **Commit at every logical unit, unasked. Never push without explicit confirmation.**
- Commit messages: what changed and *why*, including bugs found along the way and the
  reasoning behind a trade-off. Bodies are prose, not bullet dumps.
- Comments explain *why* — the trade-off, the rejected alternative, the non-obvious
  constraint. The README carries the dependency rationale, not just a list.
- Tooling is not a preference — see "Tools" at the top of this file. gopls via the LSP
  tool for Go symbols, Chrome DevTools MCP for every UI change.

## The rule that overrides convenience


**Never decide a dependency, tool, or library by default — including by letting a due
decision lapse.** Raise the choice, name the candidates and the trade-off, and get an
explicit answer. That applies as much to "I'll just add X while I'm here" as to a big
architectural pick. A decision deferred should be *recorded* as open, not silently made.
