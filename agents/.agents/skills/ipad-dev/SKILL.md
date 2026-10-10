---
name: ipad-dev
description: Build, test, deploy, screenshot and drive the Music Practice iPadOS app from Linux (xtool + pymobiledevice3 + the app's debug HTTP hooks). Load before building or deploying the app, running MusicCore tests, checking something on the iPad, reading device logs, taking a screenshot, or adding a debug command. Triggers: build, deploy, run on iPad, device, screenshot, "check it on the iPad", logs, syslog, debug hook, xtool, swift test.
---

# Music Practice iPad dev loop (Linux host)

Toolchain: `~/dev/omarchy-apple-dev` (xtool + Swift 6.4 + iPhoneOS 27 SDK). Its
README/GETTING-STARTED/FINDINGS.md are the authority on toolchain problems.

Device: "iPad Xande", iPad15,3, iPadOS 27.0.1, UDID `00008122-001259DE26E8401C`.
USB only (wireless deploy doesn't work from Linux on iOS 26+). Developer Mode is on.
xtool is already signed in (credentials aren't in `~/.local/share/xtool`; don't run
`xtool auth` again). Free Apple ID: the install expires after 7 days, so redeploy.

## Layout
- `Package.swift`: the app (one `.library` product `MusicPractice`, SwiftUI).
  Depends on `MusicCore/` by path.
- `MusicCore/`: a platform-free package holding theory, grading engines, models and
  song scoring/import. It depends on `../../ScoreKit` (which uses ZIPFoundation), so
  it is no longer Foundation-only. Its tests run **on Linux**.
- `xtool.yml`, `Info.plist` (partial, merged over xtool defaults), `Icon.png`.
- `.gitignore` uses `.build/` (not `/.build`) so `MusicCore/.build` stays out.

## Commands
All scripts live in the app repo (`scripts/`) and need no sudo, no tunneld and no human at the iPad.
```sh
# Logic tests (fast, Linux host)
cd MusicCore && swift test

# Build + sign + install + relaunch + wait for the debug server (10-25 s incremental). Run from the repo root.
scripts/deploy.sh              # add --log to stream the app's syslog to ~/tmp/app.log
                               # --no-build reinstalls the signed xtool/*.app; --streaming uses the streaming installer
scripts/shot.sh NAME [25%]     # screenshot -> ~/tmp/shots/NAME.png (+ NAME-s.png resized); Read it
scripts/tap.sh PX PY           # real touch at screenshot pixels, any orientation (see "Touch")
scripts/container.sh ...       # read/write the app's sandbox files (see "App files")
scripts/crashes.sh             # newest crash report -> ~/tmp/crashes/, symbolicated summary (see "Crash reports")
```
- `deploy.sh` writes details to `~/tmp/deploy.log`. It builds with `xtool dev build --sign` (the unsigned `.app` that a plain `xtool dev build` leaves in `xtool/` can't be installed), then: mounts the DDI (`mounter auto-mount --userspace`, a no-op when mounted), stops the app (`/quit` if the debug server answers, else `dvt pkill --bundle`), installs with `pymobiledevice3 apps install --developer`, launches with `core-device launch-application`, starts the `usbmux forward` if nothing listens on 8765, and polls `/ping` (prints `ready in Ns: page=...`). Verified end to end 2026-10-08 on all three paths (app running → `/quit`; app not running → `dvt pkill`; `--no-build`).
- If the build fails, deploy.sh prints up to the first 5 `error:` lines from the log (none if the failure has no `error:` line; see `~/tmp/deploy.log`) and then `FAILED: build`. A build broken by someone else's in-progress `MusicCore` edit is not yours to fix; report it.
- The old "swipe out of the app during Installing" stall is gone with this path: `apps install` replaces the foreground app without help. (`xtool install` and `xtool dev run` still stall that way; `device-run.sh` uses them.)
- xtool prefixes the bundle id: the installed id is `XTL-2CWY6D3Y7M.dev.alexf.MusicPractice`.
- If you hit `Too many open files`, run `ulimit -n 65536` first (the script does).
- After a toolchain change, delete `.build`.
- Don't run `xtool` with output sent to `/dev/null` (xtool #268/#304); redirect to a file under `~/tmp`.

## Seeing the iPad
P=`~/pymobile3-venv/bin/pymobiledevice3` (11.26.0), U=`00008122-001259DE26E8401C`.

**No tunneld and no root.** With pymobiledevice3 >= 11.26, developer commands fall back to an in-process userspace tunnel on their own (a warning says so; pass `--userspace` to skip the first failed attempt). The DDI mount is once per boot and idempotent: `$P mounter auto-mount --udid $U --userspace` (verified rootless when already mounted; a fresh post-reboot mount is not yet verified rootless. The DDI can't be unmounted to test it: `umount-personalized` fails with "Failed to unload launchd jobs").
- `--udid U` is accepted by `dvt`, `accessibility`, `mounter`, `apps`, `syslog`, `usbmux forward`.
- `developer core-device ...` subcommands do **not** take `--udid`. Use `export PYMOBILEDEVICE3_UDID=$U` (or rely on there being only one device).
- Each command in the Bash tool is a fresh shell, so set the variable in the same command.

**Screenshots:** `scripts/shot.sh NAME`, or `$P developer dvt screenshot ~/tmp/shots/NAME.png --udid $U --userspace`, then Read the PNG (~2 s).
- PNGs are 1908×2746 in portrait and 2746×1908 in landscape (they follow the device orientation).
- The debug server's `/tree` reports points; screenshot pixels = points × 2.

**Orientation:** `$P developer core-device get-display-info` shows `currentOrientation` (rot0 / rot90 / rot180 / rot270). `core-device rotate left|right` rotates the device without touching it.

**Other ways to look:**
- Logs: `deploy.sh --log` (writes `~/tmp/app.log`), or `$P syslog live -pn MusicPractice`. Debug commands log under category `debug`.
- UI tree as text: prefer the app's `/tree` (frames, ids). `$P developer accessibility list-items` (with `PYMOBILEDEVICE3_UDID` set) works unprivileged but returns only captions and ids, with no frames.
- LLDB (rootless, attach verified 2026-10-09): needs `~/dev/omarchy-apple-dev` on `main` (upstream has `--lldb`/`--attach` since PR #10; its FINDINGS 67 now holds these recipes; the fork's `lldb-userspace` is redundant). Run from the app repo root:
  - `~/dev/omarchy-apple-dev/device-run.sh --lldb` builds, installs, launches the app suspended and attaches (33 s total). `--attach` skips build/stop/reinstall and attaches to the installed app, running or not (35 s).
  - `LLDB_CMDS=$'bt\nprocess detach'` runs commands after the attach, in synchronous mode. End with `process detach`.
  - Mechanism: the userspace debugserver forwarder plus an async `process connect` (a sync connect hangs). `LLDB_LOAD_LEVEL=minimal` (default) keeps the attach to about 30 s; `complete` gives full system symbols in minutes. `--sudo` is the old kernel-tunnel path with full symbols, and it needs the user.
  - Verified: stopped process, `bt`, `thread list`, `process detach`, app symbols with file:line (`image lookup -r -n DebugServer`). System frames show only the library name.
  - Verified 2026-10-09 (2 sessions, usbmuxd stayed active, NRestarts 0): `breakpoint set -f AppModel.swift -l 185`, `continue`, hit with source, `frame variable` (locals and args, `v self` too), `thread step-over/step-in/step-out`, `po self` (prints `(MusicPractice.AppModel) 0x... {}`), `process detach` (app keeps running, `/ping` ok). NOT verified: `--attach --sudo`.
  - **Swift `expr` does not work** (`expr 1+1` -> "cannot load underlying module for 'AVFAudio'"; `po` warns and falls back to `p`). `expr -l c -- 1+1` and `-l objc` work but print a long burst of "Error while searching for Xcode SDK: HostInfoError" (about 2 min; harmless). Use `frame variable` / `v`. `bt` prints only the app frames plus "HostInfoError" noise; system frames are hidden by `minimal` load level.
  - **A failing command aborts the rest of LLDB_CMDS** (batch mode). Put risky ones (Swift `expr`) last, or wrap them as `script lldb.debugger.HandleCommand('expr 1+1')`.
  - **Route-triggered breakpoint recipe:** LLDB_CMDS is synchronous, so `continue` blocks until the stop, then the next lines run. Fire the request from a background job that starts before the attach finishes (the attach takes about 35 s, so sleep ~55 s), with a long `-m`: `(sleep 55; curl -s -m 100 'localhost:8765/note?midi=60&on=1' > ~/tmp/t.out 2>&1) &` then `LLDB_CMDS=$'breakpoint set -f AppModel.swift -l 185\ncontinue\nbt\nframe variable\nthread step-over\nframe variable\nthread step-in\nthread step-out\nprocess detach' device-run.sh --attach`. The curl blocks while stopped (the debug server's handler is paused), and fails with rc 28 if the session outlasts `-m`. Always end with `process detach`.
  - **usbmuxd crash:** 3 of the first 5 rootless sessions ended with usbmuxd aborting ("free(): invalid pointer") after the detach or as the next session started. Since 2026-10-09 a drop-in (`/etc/systemd/system/usbmuxd.service.d/override.conf`: `Restart=on-failure`, `RestartSec=1`, `StartLimitIntervalSec=0`) restarts it on its own. If a device command fails with "Failed to connect to usbmuxd socket", wait a few seconds, check `systemctl show usbmuxd -p ActiveState -p NRestarts`, then run a full `scripts/deploy.sh`, which starts a fresh forwarder. Ask the user for `sudo systemctl restart usbmuxd` only if it stays down. Don't `pkill -f "usbmux forward"` from a Bash tool call: the pattern matches the tool's own shell and kills it. Use `pgrep -f "[u]sbmux forward"`.
  - After `device-run.sh`, `deploy.sh --no-build` fails with "not signed" (`xtool dev build` leaves the app unsigned). Use a full `deploy.sh`.

## Crash reports
`scripts/crashes.sh` (`-n N` for the newest N, `--all` lists the device's MusicPractice reports, `--watch` streams new ones, `FILE.ips` re-reads a local one). It runs `crash flush`, `crash pull -m 'MusicPractice-.*\.ips'` into `~/tmp/crashes/`, then prints exception, termination, the crashed thread's backtrace, and file:line plus the source line for MusicPractice frames (marked `>`). Verified 2026-10-08 with `crash?kind=fatal`.
- Reports are `MusicPractice-<date>.ips` (JSON) on the device under `/` (`pymobiledevice3 crash ls`). They appear within a few seconds of the crash.
- Symbolication: the xtool binary has no DWARF of its own, only a debug map to `.build/**.o`. The script runs `dsymutil` on it into `~/tmp/dsym/<uuid>.dSYM` and feeds `llvm-symbolizer` (frame > 0 uses addr-1).
- It matches the report's image UUID against `xtool/MusicPractice.app/MusicPractice`. Every rebuild changes the UUID, so a crash from an older build gets a UUID-mismatch warning and device function names only. Read a crash before redeploying.
- The report does not carry the `fatalError` message (no `asi`); the printed source line at the crash site does. For more, use `deploy.sh --log`.
- `pymobiledevice3 crash watch --format json` is broken in 11.26.0 (TypeError); the script parses the text output.
- A backgrounded `--watch` ignores SIGINT; stop it with a plain `kill` on the script and the `crash watch` child (idle, so usbmuxd survived in testing). From a terminal, Ctrl-C works.

## App files (container) from Linux
`scripts/container.sh` reads/writes the app's sandbox (verified 2026-10-08/09, rootless, dev-signed app):
```sh
scripts/container.sh ls ["Library/Application Support/store"]   # no arg: Library, Documents, tmp
scripts/container.sh pull "Library/Application Support/store" [local]   # default ~/tmp/container/<name>
scripts/container.sh [--restart] push LOCAL "Library/Application Support/store/mp.v1.sessions.json"
scripts/container.sh [--restart] rm REMOTE                      # recursive for dirs
scripts/container.sh snapshot                                   # -> ~/tmp/container/snap-<ts>/Library/Application Support/...
scripts/container.sh [--restart] restore ~/tmp/container/snap-<ts>
```
- Paths are relative to the container root. Data is in `Library/Application Support/store/mp.v1.*.json` (one JSON array/object per key: `sessions`, `songSessions`, `learn`, `settings`); songs will be in `Library/Application Support/songs/` + `songs-index.json`.
- **Stop the app before writing**, or it overwrites your file on its next save and holds old data in memory. `--restart` does `curl :8765/quit`, the write, then `deploy.sh --no-build` (~10 s). Reads are safe while it runs. After a push, `/page?name=progress` then `/history` shows the new counts.
- Works: `apps pull/push/rm` (house_arrest VendContainer): whole container, including Library/Application Support. `core-device list-directory/stat/read-file/write-file` (domain `appDataContainer --identifier BUNDLE`): only Library, Documents, tmp (root refused), and neither `write-file` nor `create-directory` makes parents. `create-directory` makes dirs with permissions 0 that AFC cannot enter; don't use it. Plain `pymobiledevice3 afc` is /var/mobile/Media only.
- `apps pull DIR dest` puts the dir *inside* dest; `apps push FILE` fails on a missing parent, but `apps push DIR` creates directories (the script uses that trick). The script handles both.
- Seeding recipe: pull `mp.v1.sessions.json`, append objects in the same shape (copy one, new `id`, marker `durationMs`), `push --restart`. Verified: 39 -> 40 sessions on the Progress page, then `restore` brought back a byte-identical file.

## Touch
`scripts/tap.sh PX PY` sends a real touch (`core-device universal-hid-service tap`) at screenshot pixel coordinates. HID coordinates are 0..65535 in a frame that rotates with the orientation; tap.sh reads `currentOrientation` and converts. All four orientations were verified on the iPad. `scripts/tap.sh --frac FX FY` takes fractions of the upright screen (the `fx=`/`fy=` columns in `/tree`). Use `/tap?id=` first (no coordinates needed); use tap.sh for things accessibility can't activate (e.g. UIKit menu items, keyboard keys).

## Driving the app: debug hooks
Besides real touches (`scripts/tap.sh`), DEBUG builds run an HTTP command server on the device's loopback, port 8765 (`Sources/MusicPractice/Debug/DebugServer.swift`):

```sh
($P usbmux forward 8765 8765 > ~/tmp/fwd.log 2>&1 &)   # deploy.sh starts it; dies if the iPad unplugs
curl -s localhost:8765/help                            # list commands
curl -s 'localhost:8765/page?name=progress'            # scales | progress | about
curl -s localhost:8765/state
```
The forwarder survives redeploys; deploy.sh relaunches the app and waits for `/ping`.

**Adding a command:**
- From any `@MainActor` code (often a view's `.task` inside `#if DEBUG`), register it with `DebugServer.shared.register("name") { query in ...; return "text" }`.
- `query` is `[String: String]` built from the query string.
- Return a short, greppable text or JSON body.
- Keep all of this inside `#if DEBUG`.
- Add the new command to the table below.

| Command | Effect |
|---|---|
| `ping` | `ok` |
| `help` | list of commands |
| `page?name=` | switch sidebar page |
| `state` | `page=...` |
| `note?midi=60&on=1&vel=80` | inject a note event through the MIDI path (`on=0` releases); stamped now |
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
| `autoplay?wrong=0.15&gap=120&jitter=15&offset=25` | play the exercise through the MIDI path. `wrong` is the share of steps preceded by a wrong note (notes modes); `gap` is ms between steps; `jitter`/`offset` are ms of timing error vs the click (tempo mode, which it starts itself) |

**Song routes** (Songs page; `Sources/MusicPractice/Songs/SongsDebug.swift`; all errors start `error:`, no song open replies `no song open`):

| Command | Effect |
|---|---|
| `songs` | library, one line per song: `id<TAB>title<TAB>composer<TAB>format<TAB>size`. Starter ids are `starter:<slug>` |
| `song?id=ID` / `song?starter=SLUG` | open a song; replies the `songstate` line (unknown id -> error) |
| `songstate` | one line: id, title, view mode, zoom, fingering, hands, sheet, step, entries, measures, phase |
| `songview?mode=page\|line&zoom=0.6-2&fingering=0\|1&hands=both\|rh\|lh&sheet=auto\|light\|dark` | view settings (any subset) |
| `songmode?mode=listen\|learn\|notes\|tempo\|rubato` | set the practice mode; replies the practice state |
| `songsel?mode=&hands=&from=&to=&whole=1&tempo=&metronome=&other=&repeat=&flow=flow\|jump&latency=&leeway=&guide=` | selection and options (from/to are measures; 0 or `whole=1` clears the range) |
| `songpractice` | practice state: mode, phase, step/steps, measure, range, tempo, plan, marks, results |
| `songseek?step=N` / `?measure=N\|back\|forward` | move the play position (N = written measure inside the selection) |
| `songplay[?step=K]` / `songstop[?pause=1]` | start/resume, stop/pause |
| `songsimulate?offsetMs=&missEvery=&scale=&swing=&from=&wait=1` | play the run through the MIDI path; `wait=1` blocks until done and appends the result line. Tempo starts itself |
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

Practice commands live in `Sources/MusicPractice/Practice/PracticeDebug.swift`.
UI commands (`quit`, `crash`, `tree`, `tap`, `scroll`) live in `Sources/MusicPractice/Debug/DebugUI.swift`; `DebugUI.actions["id"]` is a registry for controls that accessibility can't activate. Sidebar rows have identifiers `nav-scales|progress|about` (RootView); `/tree` shows them and `tap?id=nav-progress` selects the row (verified).
App-wide debug commands live in `Sources/MusicPractice/App/AppModel.swift` (`registerDebugCommands`).

## Verify loop for UI work
1. `swift test` in `MusicCore`.
2. `scripts/deploy.sh`.
3. Drive the app to the state you need with `curl` (`/page`, `/tap?id=`, `/exercise`, ...).
4. Take a screenshot (`scripts/shot.sh`) and Read it.
5. Look at the screenshot before claiming the change works.

## Audio and MIDI facts (measured on this iPad)
- AVAudioEngine runs at 48 kHz, with an output latency of 10.0 ms and an IO buffer of 5.3 ms (5 ms preferred).
- Everything uses one clock: host time in ms (`HostClock`). CoreMIDI packet stamps and render `mHostTime` are both host time.
- Clicks are scheduled in "heard" time: the synth adds `outputLatency`.
- I can't hear the device. Ask the user to listen when audio quality or timing matters by ear.
- DEBUG builds enable a `MIDINetworkSession` (policy: anyone), which shows up as source "Network Session 1". From Linux, an RTP-MIDI client (e.g. `rtpmidid`) can connect to the iPad and play real MIDI into it. This is untested so far.

- the iPad auto-locks after 10 min; DEBUG builds disable the idle timer while the app is foreground (`/awake?on=0|1`, `/state` shows `awake=`); it does not help if another app is in front. If the device is locked, ask the user to unlock.

## When the device stops responding
- **Symptoms:** `device-run.sh` says "Pairing needed", or hangs at step 3 (`xtool devices`); `pymobiledevice3 usbmux list` is empty; `lsusb` still shows the iPad.
- **Check:** `systemctl is-active usbmuxd`. If it says `failed`, see why with `journalctl -u usbmuxd`.
- **Known crash:** usbmuxd 1.1.1 logs "Sending to client fd N failed: Broken pipe" and then "free(): invalid pointer", and dumps core. It happens when a client is killed mid-request, e.g. a stopped agent or a `timeout` around a device command.
- **Fix:** the user runs `sudo systemctl restart usbmuxd`; never run sudo yourself. Hung xtool calls continue afterwards. If the daemon restarted, restart the usbmux forwarder too: find the stale one with `pgrep -f "usbmux forward"` and `kill` it (safe: it is idle, unlike a streaming client such as `syslog live`), then rerun `scripts/deploy.sh`, which starts a fresh one.
- **Prevention:** don't kill device commands mid-flight. Give them generous timeouts rather than short `timeout` wrappers.
- If the iPad gets unplugged (e.g. moved to a MIDI keyboard), usbmuxd exits cleanly. Plugging back in starts it again; rerun `scripts/deploy.sh` (or just restart the forwarder).
- `xtool install` / `xtool dev run` stall at `[Installing] 100%` while the app is in the foreground, until someone swipes home. Don't use them; `scripts/deploy.sh` uses `apps install`, which doesn't. Don't kill a stalled xtool: killing a client mid-request can crash usbmuxd.
- On-device history is disposable test data for now (greenfield). Seeding and clearing are fine; mention it in passing. `/unseed` removes seeded runs.
- Page-level debug commands (e.g. Progress: `history`, `seed`, `unseed`, `reload`) only exist once that page has appeared. Run `/page?name=progress` first.

## Gotchas learned
- If `deploy.sh` fails because the venv python is missing, `~/pymobile3-venv/bin/python3` must point at a mise python 3.14.x install: mise `latest` moves (it went to 3.15), which breaks the symlink.
- `pkill -f 'device-run.sh'` (or any pattern on the command line) matches your own bash call and kills it (exit 144). Use `pgrep -f`, then `kill <pid>` in a separate call.
- A finished `device-run.sh` sometimes stays alive after `Verifying 100%`. It's harmless; leave it rather than killing it.
- `magick` (ImageMagick) is available for cropping screenshots; PIL is not.
- Verified grading loop: `/exercise` → `/autoplay` → `sleep` → `/practice` → screenshot.
- In Swift 6, statics read from `nonisolated` code (such as CoreMIDI callbacks) inside a `@MainActor` class must be marked `nonisolated` themselves.
- For press-and-hold controls (piano keys), use `DragGesture(minimumDistance: 0)` with `onChanged` (track a held set) and `onEnded`. `onLongPressGesture(minimumDuration: 0, pressing:)` reports the release immediately, so notes were silent.
- Swift LSP: `~/.local/bin/sourcekit-lsp` points at `/usr/lib/swift/usr/bin/sourcekit-lsp`. The old docker wrapper was `~/dev/tools/xtool-docker/bin/sourcekit-lsp`. The project's `.bsp/xtool.json` gives it iOS SDK context via `xtool dev build-server`. Claude Code uses it through the `swift-lsp` plugin.
- `MIDIUniqueID` needs `import CoreMIDI` in every file that names it.
- Binding the debug server to IPv4 loopback is enough for `usbmux forward`.
- A background agent editing `MusicCore` at the same time as a build can break the app build. Run builds when no one is mid-edit.
