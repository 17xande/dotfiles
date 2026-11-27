# Music Practice (`~/dev/music-practice-app`)
Bundle `dev.alexf.MusicPractice` (installed as `XTL-2CWY6D3Y7M.dev.alexf.MusicPractice`), debug port **8765**, Core package `MusicCore`
(`cd MusicCore && swift test`, on Linux). Web counterpart: `~/dev/music-practice` (`music.17xande.dev`). Shared loop and rules: `../SKILL.md`.

## Layout
- `Package.swift`: the app (one `.library` product `MusicPractice`, SwiftUI).
  Depends on `MusicCore/` by path.
- `MusicCore/`: a platform-free package holding theory, grading engines, models and
  song scoring/import. It depends on `../../ScoreKit` (which uses ZIPFoundation), so
  it is no longer Foundation-only. Its tests run **on Linux**.
- `xtool.yml`, `Info.plist` (partial, merged over xtool defaults), `Icon.png`.
- `.gitignore` uses `.build/` (not `/.build`) so `MusicCore/.build` stays out.
- `MusicCore` tests: `cd MusicCore && swift test`. A build broken by someone else's in-progress `MusicCore` edit is not yours to fix.
- `scripts/song-smoke.sh [-v]` is in the repo too (see below).

## App data (container)
- Data is in `Library/Application Support/store/mp.v1.*.json` (one JSON array/object per key: `sessions`, `songSessions`, `learn`, `settings`); songs are in `Library/Application Support/songs/` + `songs-index.json`. With profiles, keys are prefixed `p-<id>.`.
- After a container push, `/page?name=progress` then `/history` shows the new counts.
- Seeding recipe: pull `mp.v1.sessions.json`, append objects in the same shape (copy one, new `id`, marker `durationMs`), `push --restart`. `restore` brings back a byte-identical file.

## Debug routes (port 8765)
Source: `Sources/MusicPractice/Debug/DebugServer.swift`.

| Command | Effect |
|---|---|
| `ping` | `ok` |
| `help` | list of commands |
| `page?name=` | switch sidebar page |
| `state` | `page=...` |
| `note?midi=60&on=1&vel=80[&src=screen]` | inject a note event through the MIDI path (`on=0` releases); stamped now. `src=midi` (default) or `screen` (acts as the drawn keyboard; sets the run's `input`) |
| `play?midi=60&ms=400` | sound a synth note (no grading) |
| `metronome?bpm=100&steps=8&npb=1` / `metronome?stop=1` | schedule a count-in + clicks; replies ms until step 0 |
| `midi` | MIDI state, selected source, devices, recent events |
| `history` | counts of sessions, song sessions and learn sessions |
| `seed?n=30` | add made-up scale runs (marker values: durationMs 9000, velocityStd 8, unevenness 0.1). This writes to REAL history |
| `unseed` | remove exactly the seeded runs |
| `reload` | reload the Progress page |
| `appearance?theme=light\|dark\|system` | theme override |
| `audio` | engine running, sample rate, output latency, IO buffer |
| `quit` | replies `bye`, then `exit(0)` 200 ms later (cold start next launch) |
| `crash?kind=fatal` | `fatalError` on the main actor 200 ms after replying (exercise `scripts/crashes.sh`; the app dies, redeploy with `deploy.sh --no-build`) |
| `corrupt?key=sessions\|songSessions\|learn\|settings\|songRanges\|library&kind=json\|record` | plant bad data on disk (`json`: the file becomes `{not json`; `record`: one bad record/field/entry is added, `library` also adds an entry with no file). Then `/quit` straight away and `deploy.sh --no-build`: the "Some saved data couldn't be read" alert shows. "Not now" leaves the files alone (alert returns next launch); "Delete it" cleans them. Tap its buttons with `tap.sh --frac` (`/tap?id=` can't activate alert buttons) |
| `tree[?all=1\|views=1]` | accessibility tree with ids, labels, traits, frames in points and `fx`/`fy` centre fractions. Includes UIKit chrome (nav bar) and open menus |
| `tap?id=` | activate the element whose accessibilityIdentifier, label (exact, then substring) matches: `accessibilityActivate()`, else a UIControl `touchUpInside`, else selects the list row. UIKit menu items don't respond: use `scripts/tap.sh` |
| `scroll?dy=400[&dx=][&id=]` | scroll the largest scrollable view (or the one containing element `id`) by dy points, clamped; replies the new offset |
| `exercise?tonic=Eb&type=major&hands=both&octaves=2&dir=updown&mode=notes\|tempo\|learn&bpm=90&npb=2&fingers=1` | set the exercise; replies with the practice state |
| `practice` | state: title, mode, phase, focus, status, targets, marks, results, best, calibration |
| `toggle` | Start/Stop in tempo mode, Restart otherwise (the Space key) |
| `calibrate` | start latency measuring |
| `autoplay?wrong=0.15&gap=120&jitter=15&offset=25[&src=screen]` | (`src` defaults to midi) play the exercise through the MIDI path. `wrong` is the share of steps preceded by a wrong note (notes modes); `gap` is ms between steps; `jitter`/`offset` are ms of timing error vs the click (tempo mode, which it starts itself) |

**Song routes** (Songs page; `Sources/MusicPractice/Songs/SongsDebug.swift`; all errors start `error:`, no song open replies `no song open`):

| Command | Effect |
|---|---|
| `songs` | library, one line per song: `id<TAB>title<TAB>composer<TAB>format<TAB>size`. Starter ids are `starter:<slug>` |
| `song?id=ID` / `song?starter=SLUG` | open a song; replies the `songstate` line (unknown id -> error) |
| `songstate` | one line: id, title, view mode, zoom, fingering, hands, sheet, step, entries, measures, phase |
| `keyboard?height=N\|hide=1\|show=1\|hints=0\|1` | the keyboard drawer (Songs and Scales share it; registered once a drawer is on screen). Height 90..half the screen, in points; persists in UserDefaults `keyboardHeight`/`keyboardHidden`. `hints=0` draws a plain keyboard (no targets, next keys, scale tint or fingers); it is the per-profile `Settings.keyboardHints` (default on), the same as the Scales/Songs options toggle. Replies `keyboard hints= height= hidden= min= max= container=`; no args just reports |
| `songview?mode=page\|line&zoom=0.6-2&fingering=0\|1&hands=both\|rh\|lh&sheet=auto\|light\|dark` | view settings (any subset) |
| `songmode?mode=listen\|learn\|notes\|tempo\|rubato` | set the practice mode; replies the practice state |
| `songsel?mode=&hands=&from=&to=&whole=1&tempo=&metronome=&other=&repeat=&flow=flow\|jump&latency=&leeway=&guide=` | selection and options (from/to are measures; 0 or `whole=1` clears the range) |
| `songpractice` | practice state: mode, phase, step/steps, measure, range, tempo, plan, marks, results |
| `songseek?step=N` / `?measure=N\|back\|forward` | move the play position (N = written measure inside the selection) |
| `songplay[?step=K]` / `songstop[?pause=1]` | start/resume, stop/pause |
| `songsimulate?offsetMs=&missEvery=&scale=&swing=&from=&wait=1[&src=screen]` (`src` defaults to midi) | play the run through the MIDI path; `wait=1` blocks until done and appends the result line. Tempo starts itself |
| `songresult` | last finished run line + per-step `timing:` |
| `songcalibrate[?tap=1&offsetMs=]` | start latency calibration, optionally tapping along |
| `songimport?path=` / `songdelete?id=` | import a container-relative file / delete a song |
| `tap?id=loop-weakest` | on the results card: practise the weakest 2-measure stretch (sets the range) |
| `exportfile` / `importfile?name=` | export to `tmp/export.json` (pull with container.sh) / import `tmp/<name>`. Progress-page routes |

`scripts/song-smoke.sh [-v]` drives the whole flow (list, open starter, view/mode/range, seek, Listen play/stop, simulated Notes and Tempo runs, result, loop weakest, export) and exits non-zero on the first failure (~40 s, 33 calls; writes disposable history).

Song gotchas:
- `songsimulate` and the `song*` routes only act while a song is open on the Songs page; they reply `no song open` otherwise. `/page?name=scales` (or progress) closes the song; reopen with `song?...`.
- `exportfile`, `history`, `seed` exist only after `/page?name=progress`.
- Simulated runs save real song sessions (`saved=true`); fine, history is disposable.
- Songs opens by view switch (not a NavigationStack push) since 2026-10-09, so opening right after a page switch is safe. The back button is `tap?id=song-back`. `openurl?path=<container path>` drives the "Open in" import-and-open path.
- Right after a reboot, `scripts/tap.sh` works again (verified 2026-10-09: `--frac` taps switched sidebar pages).

**Sync routes** (accounts and history sync, A7; `AppModel.registerSyncCommands`; the web server is `https://music.17xande.dev`, override in DEBUG with the `syncBaseURL` user default):

| Command | Effect |
|---|---|
| `sync` | runs a sync now; replies `ok(changed: ...)`, `off`, `signedOut`, `offline` or `error(...)`, plus cursor and pending counts |
| `syncstate` | `mp.v1.sync` as JSON plus `token` (`absent` or `<redacted>`, never the value) and the last message |
| `signin?email=&password=[&upload=1]` | sign in (URL-encode the password; the debug log redacts it). `upload=1` queues every local run, as the "Add this iPad's N runs?" prompt's Yes. It does not sync: call `sync` next |
| `signout` | `DELETE /api/token`, then forget the token and `mp.v1.sync`; history stays |

Gotchas: `seed`/`unseed`/`songsimulate` write real history, which syncs while signed in (`unseed` removes only the seeded runs and queues just those as deletions). Test only with the throwaway account in `~/tmp/mp-test-account`; never echo its password.

**Profile routes** (multiple local accounts, A8; `AppModel.registerProfileCommands`). Each profile has its own history, settings, song ranges, last song/page, sync state and Keychain token (account attribute = profile id); the song library is shared. Storage keys are prefixed `p-<id>.` (files `store/p-<id>.mp.v1.*.json`; the index is `store/mp.ipad.profiles.json`). `corrupt` plants into the active profile.

| Command | Effect |
|---|---|
| `profiles` | one line per profile: `*` marks the active one, then id, name, `local` or the signed-in email |
| `profile?add=NAME` | add a profile (does not switch); replies the new id and the list |
| `profile?switch=ID` | switch: stops runs, reloads every model, syncs the new profile if signed in |
| `profile?delete=ID` | delete a profile and its data (active one: switches to another first; the last one is refused); revokes its token best effort |
| `profile?rename=ID&name=NAME` | rename |

UI: the picker is the first row of the sidebar (`profile-menu`; UIKit menu, open it with `scripts/tap.sh`), "Manage accounts..." opens the sheet. Gotcha: `signin`/`sync`/`syncstate` act on the active profile, so switch first.

Practice commands live in `Sources/MusicPractice/Practice/PracticeDebug.swift`.
UI commands (`quit`, `crash`, `tree`, `tap`, `scroll`) live in `Sources/MusicPractice/Debug/DebugUI.swift`; `DebugUI.actions["id"]` is a registry for controls that accessibility can't activate. Sidebar rows have identifiers `nav-scales|progress|about` (RootView); `/tree` shows them and `tap?id=nav-progress` selects the row (verified).
App-wide debug commands live in `Sources/MusicPractice/App/AppModel.swift` (`registerDebugCommands`).

## Audio and MIDI facts (measured on this iPad)
- AVAudioEngine runs at 48 kHz, with an output latency of 10.0 ms and an IO buffer of 5.3 ms (5 ms preferred).
- Everything uses one clock: host time in ms (`HostClock`). CoreMIDI packet stamps and render `mHostTime` are both host time.
- Clicks are scheduled in "heard" time: the synth adds `outputLatency`.
- I can't hear the device. Ask the user to listen when audio quality or timing matters by ear.
- DEBUG builds enable a `MIDINetworkSession` (policy: anyone), which shows up as source "Network Session 1". From Linux, an RTP-MIDI client (e.g. `rtpmidid`) can connect to the iPad and play real MIDI into it. This is untested so far.

- the iPad auto-locks after 10 min; DEBUG builds disable the idle timer while the app is foreground (`/awake?on=0|1`, `/state` shows `awake=`); it does not help if another app is in front. If the device is locked, ask the user to unlock.
- Page-level debug commands (Progress: `history`, `seed`, `unseed`, `reload`) only exist once that page has appeared; run `/page?name=progress` first.
- `MIDIUniqueID` needs `import CoreMIDI` in every file that names it.
- For press-and-hold controls (piano keys), use `DragGesture(minimumDistance: 0)` with `onChanged` (track a held set) and `onEnded`. `onLongPressGesture(minimumDuration: 0, pressing:)` reports the release immediately, so notes were silent.
- Verified grading loop: `/exercise` -> `/autoplay` -> `sleep` -> `/practice` -> screenshot.
- If the iPad gets unplugged (e.g. moved to a MIDI keyboard), usbmuxd exits cleanly; replug and rerun `scripts/deploy.sh`.
