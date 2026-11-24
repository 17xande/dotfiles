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
  "default theme", "update dependencies", S3, object storage, rate limit, CSRF,
  sessions, cookies, websec.
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
| `setup.md` | Choosing the stack or a shared module: the module index, pinned READMEs, embedding, CSS, the local stack |
| `scaffold.md` | Starting a project — concrete working files, Postgres and SQLite variants |
| `sqlite.md` | The database is SQLite: STRICT, DSN, atomic writes, seed/export |
| `review-traps.md` | Reviewing, debugging, or about to ship a phase |

The single most important rule is at the bottom: **never decide a dependency by default.**

## Tools: use these, they are not optional


Stated first because burying them at the bottom demonstrably does not work — this section
exists because both were mentioned in passing and both were still skipped.

**gopls — not grep — for anything about Go symbols.** Load the `go-lsp` skill for the
full workflow: `gopls` run from the command line, inside the module. Reach for it *before*:

- renaming or changing the signature of anything exported (`gopls rename -l`/`-d`/`-w`);
- deleting a function or type — `gopls references` first, so "unused" is a fact;
- exploring an unfamiliar package's API (`go doc ./pkg`, `gopls symbols file.go`);
- asking "where is this used" or "did that break anything" (`gopls references`,
  `gopls check file.go`, then `go vet ./...`).

ripgrep is for non-Go text. The file-edit tool is for file text. Neither is a substitute for
gopls when the question is about a *symbol*.

**A real browser for every UI change — always headless.** Not a screenshot as an
afterthought — navigate, click the thing you changed, submit the form, and read the
console. A handler test never runs JavaScript and never enforces a CSP, so the browser is
the only place a whole class of bug is visible (see `review-traps.md`, which opens with two
of them). **Never open a visible window on the user's desktop** unless you need the user's
input in it, and say so first; this rule controls everything below. The Chrome DevTools MCP
is fine **only if it was launched with `--headless`**: check first with
`pgrep -af chrome-devtools-mcp` and look for the flag. On this machine it has been launched
`--isolated` *without* `--headless`, which pops a visible Chromium; if the flag is missing,
do not use the MCP for checks — use headless Chromium directly (recipe below). Tell the user
they can add `--headless` to the server's args to make it safe; never edit that config
yourself.

Headless loses nothing: since Chrome 112 headless is the full browser, so CSP
enforcement, console errors, layout and screenshots behave the same. DevTools is just a
protocol (CDP); a headless instance exposes it via `--remote-debugging-port`, and a person
can attach their own DevTools through `chrome://inspect`.

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

**What does *not* need asking:** a module that appears only as `// indirect` because an
already-approved dependency requires it (e.g. `golang.org/x/sys` under `golang.org/x/crypto`),
and your own shared modules under `github.com/17xande-dev/` once their extraction has been
agreed. The rule is about what the code *imports directly*; just mention the indirect
addition in the commit message. A transitive module that is new to the consuming app *and*
large (tens of modules, cgo) is still worth raising.

## Reviewing or returning: update every dependency

When reviewing a codebase, or coming back to one after a while, **updating all
dependencies is part of the work**, unasked: Go modules including indirect ones
(`go get -u ./... && go mod tidy`), the Go toolchain in `go.mod`, the Dockerfile and CI,
pinned CI actions, base images, and pinned build tools (sqlc, govulncheck). Pick each
version by the rule in `setup.md` (newest tag at least two weeks old). Each kind gets its
own commit, the gate passes after each, and `govulncheck` is clean. A major that needs a
data migration (Postgres 17 -> 18) is included too, with the dump-and-restore documented;
skipping it as "too big" is the lapse. Stale dependencies are how a known CVE ships, and
a big catch-up later is harder to review.

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
- **Use the shared modules, don't re-implement them** (table in `setup.md`): password
  hashing, rate limits and client IP, CSRF, session cookies and lifetimes, redirects and
  CSV exports, SQLite setup, mail and payment gateways each live in a
  `github.com/17xande-dev/` module that was extracted because the per-app copies had
  drifted into real bugs. Each module's README, at the version the app pins, is the
  usage guide. If a module lacks something, change the module and tag it; never fork
  its code into an app.
- **argon2id** password hashing via `github.com/17xande-dev/password`: `Hash` / `Check`
  (PHC strings; bcrypt still verifies; `rehash` says when to upgrade with a
  compare-and-swap on login), `Validate` at write time. **Cap concurrent hashes**:
  `password.SetConcurrency(n)` at startup, sized against the container memory limit —
  each hash costs ~64 MiB, so a burst of logins is an OOM kill. Password *policy* stays
  in the app.
- **Per-IP rate limits** via `github.com/17xande-dev/ratelimit`: `ratelimit.New(Config{Rate,
  Burst})` then `Middleware(source, HTTPOptions{RetryAfter})`. It already keys IPv6 by
  its /64, hard-caps the map and fails closed when full (`FailOpenWhenFull` only by
  deliberate choice). Use a separate account limiter with
  `Allow(ratelimit.AccountKey(account))` only after the IP check passes. Rates,
  bursts, input validation and the 429 body are per-app decisions.
- **Client IP** via `ratelimit/clientip`: a `Source` with **either** `TrustedProxies`
  (CIDRs whose hops append to `X-Forwarded-For`) **or** one `TrustedHeader`, never both;
  the zero `Source` is the socket peer. `CF-Connecting-IP` as the trusted header is
  correct only when Cloudflare is the *only* way in (a tunnel) — behind any other proxy
  that passes it through, it is client-chosen. Set
  `http.Server{ReadHeaderTimeout, MaxHeaderBytes: 64 << 10}`.
- **CSRF via `websec/csrf`** (nosurf underneath): the exact public `Origin` is required,
  and `Renew` runs at sign-in, sign-out and password change. Wrap the mux with it and
  parse no body ahead of it: nosurf reads the form to find the token before any auth,
  so the cap must sit in front, and a `MaxBytesReader` in a handler comes too late. More
  in [Kit adoption traps](review-traps.md#kit-adoption-traps).
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
- **Make a failed login cost the same as a missing account**: `password.CheckDummy` when
  the email is unknown, check `disabled` *after* the password, one message for every
  cause.
- **Sessions: a database table, timed by `websec/session`.** Named accounts, per-user
  disable and "a password change ends sessions" each need a per-request lookup anyway,
  so store the `sha256` of an opaque `crypto/rand` token and join it to the user. Use
  both an idle and the mandatory absolute limit, with the `last_seen` write throttled by
  `NeedsTouch`: a sliding expiry written on every request is a smell. Run
  `websec/session/sessiontest` against the real store. `gorilla/securecookie` only when
  the cookie must carry claims and nothing needs revoking.
- **Session cookies via `websec/cookie`:** Lax and HttpOnly are fixed, never following a
  cross-site knob a public embed needs (an admin credential at `SameSite=None` lets any
  site send it). Pass a bare name: the builder derives `__Host-` at `/` or `__Secure-` on
  a narrower path, so adopting it **signs everyone out once**; say so in the deploy
  note. Scope cart and admin cookies to their paths so public pages stay cacheable.
- **Parse a state change strictly.** `value == "1"` makes every other value — including an
  absent field — mean the *other* thing. Require an explicit `"0"`/`"1"` and 400 otherwise,
  or a POST with an empty body silently performs the unguarded direction.
- **Buffer a download or export before writing headers.** Streaming commits a 200 before
  the work can fail, handing the operator a truncated file that looks like a good backup.
- **⚠️ Escape user-supplied text in CSV exports.** Excel and Sheets evaluate a cell
  beginning `=`, `+`, `-` or `@`, so a public form submission becomes a live formula on a
  staff machine. Route every text cell through one helper — `websec.CSVRow` /
  `websec.CSVCell` from `github.com/17xande-dev/websec`, which also catches a formula
  hidden behind a leading space, control or BOM (a first-byte check misses `" =cmd"`).
  `+27…` phone numbers are the common trigger. Not for files a machine imports: the
  apostrophe becomes part of the value.
- **A `?next=` after sign-in goes through `websec.SafeRedirect(next,
  RedirectOptions{Prefix, Deny, Fallback})`**, never `strings.HasPrefix(next, "/")`: a
  browser strips tabs and newlines and reads `\` as `/`, so `"/\t/evil.example"` passes
  the naive check and lands on another host. `Deny` the sign-in page itself so nobody is
  bounced back to it.
- Never echo secrets in Makefile recipes (prefix with `@`).

## Testing and verification


- **Tests ship with the code that adds them**, in the same commit — not a later pass.
  `_test.go` next to the file it covers.
- Test against a **real database** — `TEST_DATABASE_URL` + an `internal/dbtest` helper on
  Postgres; a temp-file database per test on SQLite. Not mocks. Fakes are for the
  storage/mail boundary, where the real thing is a network service — plus a contract test
  against a real S3 server (RustFS), gated by an env var such as `BLOB_TEST_ENDPOINT`.
- **A DB test that skips without its env var is not a pass.** Run the gate with the
  database up, and report how many tests skipped (`go test -v … | grep -c -- '--- SKIP'`);
  CI must run the DB and S3 tests for real.
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
make fmt-check && go vet ./... && make sqlc-check && \
  TEST_DATABASE_URL="…" go test -race -count=1 ./... && make vulncheck
```

(`sqlc-check` only on Postgres. Use `-count=1`: a cached pass after an environment change
is not a pass. `gofmt -l . ;` is not a check — it exits 0 with files listed and ignores
syntax errors; `fmt-check` fails on both, see `scaffold.md`. `vulncheck` runs last so a
new CVE cannot hide the test results.)

**Then drive it in a browser, headless.** Not optional, and not satisfied by a screenshot
of the happy path. Steps hold whether driven by a headless DevTools MCP or by headless
Chromium over CDP (see "Tools" for the headless rule and when the MCP is allowed):

1. Start the server on a **fresh, confirmed-free port** (`pgrep -af <binary>` first — a
   stale `go run` answering on the old port has produced confident false readings).
2. Navigate to the page you changed.
3. Inspect the DOM / a11y tree — it names every control, which is what you click by.
4. **Interact**: click the button, change the select, submit the form. Assert on where it
   navigated and what changed, not just that the page rendered.
5. Read the console — a CSP violation appears here (`Log.entryAdded`) and nowhere else.
6. Re-check at 390×844: does the layout hold, and does the *body* scroll sideways
   (`document.documentElement.scrollWidth` must not exceed `clientWidth`; wide content
   scrolls inside its own container)?

Headless recipe without the MCP (flags verified against Chromium 156):

```sh
# screenshots: desktop, then phone
chromium --headless --disable-gpu --hide-scrollbars --window-size=1280,900 --screenshot=out.png URL
chromium --headless --disable-gpu --hide-scrollbars --window-size=390,844  --screenshot=out-m.png URL
# rendered DOM
chromium --headless --disable-gpu --dump-dom URL
# console / CSP errors, sideways scroll, clicks: a CDP session on a throwaway profile
D=$(mktemp -d); chromium --headless --remote-debugging-port=9333 --user-data-dir=$D about:blank &
CH=$!    # pick a port that is free; kill only $CH when done, then rm -rf $D
```

Screenshots and `--dump-dom` run once and exit; they cannot click or read the console. For
those, drive the CDP port from a short Node 22 script (built-in `WebSocket`, no deps):

```js
const [port, url] = process.argv.slice(2);
const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), on = {};
ws.onmessage = e => { const m = JSON.parse(e.data); m.id ? pend.get(m.id)(m.result) : on[m.method]?.(m.params); };
const send = (method, params = {}, sessionId) => new Promise(r => { pend.set(++id, r);
  ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
on['Runtime.consoleAPICalled'] = p => console.log('console.' + p.type, p.args.map(a => a.value ?? a.description).join(' '));
on['Log.entryAdded'] = p => console.log('log.' + p.entry.level, p.entry.text, p.entry.url ?? '');
await send('Runtime.enable', {}, sessionId); await send('Log.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url }, sessionId); await new Promise(r => setTimeout(r, 2000));
const r = await send('Runtime.evaluate', { returnByValue: true, expression:
  '[document.documentElement.scrollWidth, document.documentElement.clientWidth]' }, sessionId);
const [sw, cw] = r.result.value; console.log(`scrollWidth=${sw} clientWidth=${cw}`, sw > cw ? 'BODY SCROLLS SIDEWAYS' : 'ok');
await send('Target.closeTarget', { targetId }); ws.close();
```

Extend it with `Runtime.evaluate` (`document.querySelector(...).click()`) for step 4. If the
user has restarted the MCP with `--browserUrl http://127.0.0.1:<port>` against such an
instance, the MCP tools work against it headlessly too.

Two real bugs of this exact shape, both HTTP 200 with correct markup and a green suite:
the CSP `img-src` bug above showed a page of broken images, and an `onchange` filter
handler was refused by `script-src 'self'` so two list pages' filters silently did
nothing for weeks. **Interact with what you changed** — click the button, submit the
form — at desktop *and* phone widths, and check for a horizontally scrolling body.

## Working style

**Who does what is in the `dev-workflow` skill — load it too.** Opus plans and asks the
architecture questions, Sonnet orchestrates, Sonnet (or Codex Sol) agents implement each
phase under a 45-minute cap, a separate Opus agent reviews every phase.

- **A phased plan, in a file outside the repo** (`~/.claude/plans/<name>.md` —
  the same place whichever agent you are, so the trail survives switching). Build one
  phase at a time, each ending in a working, tested, committed state. Keep the plan out of
  the codebase (if permissions block writing outside the repo, `.plans/` listed in
  `.git/info/exclude` — see `dev-workflow`). **Record each phase's outcome back into the plan** — what shipped, what the
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
- Tooling is not a preference — see "Tools" at the top of this file. gopls on the command
  line (the `go-lsp` skill) for Go symbols, a headless browser for every UI change.

## The rule that overrides convenience


**Never decide a dependency, tool, or library by default — including by letting a due
decision lapse.** Raise the choice, name the candidates and the trade-off, and get an
explicit answer. That applies as much to "I'll just add X while I'm here" as to a big
architectural pick. A decision deferred should be *recorded* as open, not silently made.
