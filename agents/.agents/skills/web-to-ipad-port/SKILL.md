---
name: web-to-ipad-port
description: Playbook for porting one of the user's web apps to a native iPad app built with xtool from Linux, as done for music-practice -> music-practice-app and handwriting-practice -> handwriting-practice-app. Covers the plan (pure-Swift Core + SwiftUI app), Sonnet-implements/Opus-reviews agent workflow, exact JS/Swift parity fixtures, accounts and sync design, web-first bug fixes, and device verification. Use whenever the user wants to port a web app to the iPad, start a new iPad app from a web app, add sync or accounts to an iPad app, keep an iPad app in step with its web twin, or asks "how did we do music/handwriting". Triggers: port to iPad, iPad version of, web to iPad, native app from the web app, parity, fixtures, sync design, Opus review, milestone review.
---

# Web app -> iPad app port playbook

Worked examples (read their READMEs and docs when you need detail): `~/dev/music-practice` -> `~/dev/music-practice-app`,
`~/dev/handwriting-practice` -> `~/dev/handwriting-practice-app`. Device work is the `ipad-dev` skill (and `apps/new-app.md` there to scaffold).
Default stance: greenfield, data disposable (recreate DBs, wipe the iPad) unless the user says otherwise.

## 1. Plan
- Two targets: a **Core package** (`<Name>Core/`, Foundation only, no UIKit, `swift test` on Linux in seconds) holding algorithms, models, stores, sync client; and the **app** (SwiftUI + UIKit where needed, e.g. a UIKit canvas for Pencil) that only renders and wires. Anything testable goes in Core.
- Write the plan as numbered milestones (M1..Mn), each small enough for one agent brief, each ending in green tests, a commit and a push. Order: Core types and fixtures -> algorithms with parity tests -> storage -> app shell and one real screen -> remaining screens -> accounts/sync -> polish (accessibility, empty states, icon, README).
- Put specs the two sides share in the iPad repo's `docs/` (metrics, pens, strokes) or the web's `docs/` (sync-api, handoff). A spec is the contract; code follows it on both sides.

## 2. Agents
- The general workflow (Opus plans, Sonnet orchestrates, 15-minute check-ins and a 45-minute cap per agent, Codex Sol when asked) is the `dev-workflow` skill; load it too. Below is what is specific to a port.
- **Sonnet agents implement**, each with a precise brief: goal, files to read first, the spec sections, exact function names and signatures, test commands, what not to touch, "commit but do not push" or "commit and push", and the one-agent-on-the-iPad rule. Vague briefs produce drift.
- **Opus agents review each milestone, read-only**, against the spec and the web code. Findings must be verified (a failing test, a quoted line, a reproduced behaviour), not speculation.
- Then a **fix round** (Sonnet) for the verified findings, a re-run of all suites, then a **device check** (deploy, drive with debug routes, screenshot).
- Rate limits: a stopped agent resumes via SendMessage with its ID; do not respawn and lose its context. Do not `pkill -f` a pattern (it matches your own shell; use `pgrep -f "[x]yz"` then `kill`).
- One agent on the iPad at a time; agents editing Core while another builds can break the build.

## 3. Parity with the web (exact equality)
- Export fixtures from the web through a **debug hook in the page plus headless Chromium** (`tools/export-fixtures.ts`, `make fixtures`), commit them in the web's `testdata/`, copy them into the Core tests' `Fixtures/` (a `.copy("Fixtures")` test resource). Swift tests load them and assert **exact** equality, not tolerances.
- For metrics the Swift side generates golden vectors (`WRITE_GOLDEN=1 swift test --filter ...`) which the web's tests read, so both sides assert the same numbers.
- JS numeric traps, each needs an explicit helper:
  - `Math.round` rounds half toward +infinity (`jsRound`); Swift `.rounded()` rounds half away from zero. They differ on negative .5.
  - `Math.hypot` vs glibc `hypot` differ in the last bit; use a `jsHypot` that reproduces V8's algorithm.
  - `Float32Array` stores round every write to float32: round-trip through `Float` where the web does.
  - `toFixed(1)` works on the decimal expansion of the double; write `oneDecimal` over the same rounding rule.
  - `/\s/` is ECMAScript WhiteSpace plus LineTerminator (U+FEFF yes, U+0085 no), not Unicode White_Space.
  - Hashes iterate UTF-16 code units; server id limits count UTF-8 bytes; `Number` is a double (ids/timestamps above 2^53).
  - JSON key order and `-0`.
- Any algorithm change lands in Swift and TS together with regenerated fixtures.

## 4. Web fixes and mirroring
- A web bug found while porting is **fixed in the web repo** (own commit, own tests), never copied as a bug into Swift and never patched only on one side. The Swift port is then written against the fixed web.
- Improvements found on the iPad go back to the web (feature or spec first, then both implementations).
- Mirrored commits say so: `... (mirrors web <short-hash>)`, in the iPad repo, referencing the web commit.
- Record deliberate differences in `docs/ipad-divergences.md` in the web repo.

## 5. Accounts and sync design (from music-practice; docs: `~/dev/music-practice/docs/sync-api.md`, `ipad-sync-handoff.md`, `ipad-divergences.md`; handwriting: `~/dev/handwriting-practice/docs/sync-api.md`, `ipad-sync-handoff.md`)
- **Accounts:** admin-created users only (no sign-up; admin page generates and shows a password once), **argon2id** hashes, **bearer device tokens** from `POST /api/token` (label = device name, revocable, listed on /account), `DELETE /api/token` signs out. Token in the iPad Keychain, one item per local person.
- **`POST /api/sync`**: push and pull in one round trip. Server assigns an increasing **seq**; the client keeps a **cursor** (highest seq seen) and asks for changes after it. Deletions are **tombstones** (a tombstoned id stays deleted even if pushed again). Unknown kinds land in `rejected`.
- **Account field and 409:** each push names the account; a mismatch (different user than the store was synced with) is a 409, and the client must not merge across accounts.
- **Batching:** by bytes and counts (handwriting: 500 records / 4 MB / 1000 deletions per push); a **413 halves** the batch and retries; a **stall guard** stops when a round makes no progress (cursor unchanged, nothing accepted) so it cannot loop. Also handle 401 (token revoked: sign out), 503/Retry-After.
- **Kinds:** immutable (`check`, `ink`, music runs: union by `(kind,id)`) vs mutable (`strokes`, `prefs`: greater `ts` wins; equal or older ignored; tombstone wins). Edits to a mutable record bump `ts` strictly above the old one.
- **Legacy id rule:** an old record without `id` gets a deterministic id derived only from its own fields (handwriting: `"legacy-"+base36(at)+"-"+hex(cyrb53(...))`), identical on every device, with published test vectors checked before anything else. `ts == at`, never upload time. Server id rule is bytes of UTF-8.
- Never rewrite a store from a filtered view: undecodable records from a newer client stay in the file; stores refuse to write after a failed read. An edit during an in-flight sync must still upload (generation counter).
- Inject the transport (`send(URLRequest)`) so the whole client is unit-tested without a network; a `LiveServerTests` suite runs against a throwaway local server when env vars are set.

## 6. Device verification
- DEBUG-only HTTP command server on loopback (port per app), forwarded with `pymobiledevice3 usbmux forward`. Add a route for every state you need to reach, drive it with curl, screenshot, Read the image. See `ipad-dev`.
- Verify a feature end to end on the device before calling a milestone done; reviews alone do not catch layout, Pencil or timing problems.

## 7. Pitfalls learned
- xtool builds all packages at `-Onone` (omarchy-apple-dev FINDINGS 74): add `-O` unsafeFlags for the Core target in debug (`.when(configuration: .debug)`). Pixel-level code ran 20x slower otherwise.
- `UIAppFonts` registers nothing in an xtool build (FINDINGS 70); register with `CTFontManagerRegisterFontsForURL(.process)`; use `Bundle.module.bundleURL`, not `resourceURL` (71).
- `pkill -f <pattern>` kills your own shell: `pgrep -f "[p]attern"` then `kill`.
- Deploy host IP clashes: if `ssh` to the deploy host warns about a changed host key, stop and verify the host (it may be another machine on a reused IP). Never bypass strict host checking; ask the user.
- The iPad dropping off USB / `usbmux list` empty while `lsusb` shows it: the user must run `! sudo systemctl restart usbmuxd`; never sudo yourself, never wrap device commands in `timeout`.
- Free-account installs expire after 7 days: redeploy.

## Checklist
- [ ] Plan with milestones; Core package + app target created (scaffold: `ipad-dev` apps/new-app.md)
- [ ] Specs written where both sides can read them
- [ ] Web fixture export + Swift exact-parity tests (JS traps handled)
- [ ] Each milestone: Sonnet brief -> tests green -> commit + push -> Opus read-only review -> fix round -> device check
- [ ] Web bugs fixed in the web, commits mirrored; improvements ported back
- [ ] Accounts/sync per section 5, with live-server test
- [ ] Debug routes cover every screen; screenshots checked
- [ ] README, accessibility, icon, empty states; both repos pushed
