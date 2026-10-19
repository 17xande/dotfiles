---
name: ipad-dev
description: Build, test, deploy, screenshot and drive an xtool iPadOS app from Linux (xtool + pymobiledevice3 + the app's debug HTTP hooks). Covers the Music Practice and Handwriting Practice iPad apps and any other iPad app in ~/dev, plus starting a new one from HelloOmarchy. Load before building or deploying an iPad app, running its Core package tests, checking something on the iPad, reading device logs, taking a screenshot, tapping or dragging on the device, pulling app files, reading a crash, adding a debug command or route. Triggers: iPad app, iPad, build, deploy, run on iPad, device, screenshot, "check it on the iPad", logs, syslog, debug hook, xtool, swift test, crash, LLDB, usbmuxd, "new iPad app", "without the cable", tailnet, Tailscale, wireless.
---

# iPad dev loop (Linux host, xtool apps)

Toolchain: `~/dev/omarchy-apple-dev` (xtool + Swift 6.4 + iPhoneOS 27 SDK). Its
README/GETTING-STARTED/FINDINGS.md are the authority on toolchain problems; CHANGELOG.md lists what
changed per release (synced with upstream `joshuaswarren/omarchy-apple-dev` at v0.4.0+, 2026-10-18).
`git -C ~/dev/omarchy-apple-dev pull upstream main` (fast-forward) picks up new device-run.sh/tools work.

## Apps (read the per-app file after this one)
| App (repo in ~/dev) | Bundle | Debug port | Core package | Per-app file |
|---|---|---|---|---|
| Music Practice (`music-practice-app`) | `dev.alexf.MusicPractice` | 8765 | `MusicCore` | `apps/music-practice.md` |
| Handwriting Practice (`handwriting-practice-app`) | `dev.alexf.HandwritingPractice` | 8766 | `HandwritingCore` | `apps/handwriting-practice.md` |
| A new app | start from `~/dev/HelloOmarchy` | pick the next free port | | "New app recipe" in `apps/new-app.md` |

Below, `<App>` is the app's name, `<PORT>` its debug port, `<Core>` its Core package. Each app repo carries its own copy of
`scripts/` with its bundle and port baked in, so run scripts from that repo's root. Different ports let two apps' forwarders coexist.

## Rules
- **One agent on the iPad at a time.** Deploy, screenshot, tap and the debug server share one device and one foreground app; two agents
  clobber each other (and a killed client can crash usbmuxd). If another agent or session is using it, wait or ask.
- Never `sudo` yourself; if something needs it, ask the user to run it with `! sudo ...`.
- Never wrap a device command in `timeout`; killing a client mid-request can crash usbmuxd. Give generous waits instead.
- Don't kill a stalled xtool, and don't run `xtool` with output to `/dev/null` (xtool #268/#304); redirect to a file under `~/tmp`.
- Look at a screenshot before claiming a UI change works. If the device is locked (auto-lock 10 min), ask the user to unlock.
- A background agent editing the Core package during a build can break the app build; build when no one is mid-edit.
- On-device data is disposable (greenfield) unless told otherwise; seeding and clearing are fine.

Device: "iPad Xande", iPad15,3, iPadOS 27.0.1, UDID `00008122-001259DE26E8401C`.
USB is the working path for everything below. Wi-Fi via mDNS (`device-run.sh --network`) is blocked for
Linux hosts, but iOS 27 allows a cable-free route over Tailscale (see "Without the cable"; not set up yet
for this iPad). Developer Mode is on.
xtool is already signed in (credentials aren't in `~/.local/share/xtool`; don't run
`xtool auth` again). Free Apple ID: the install expires after 7 days, so redeploy.

## Commands
All scripts live in the app repo (`scripts/`) and need no sudo, no tunneld and no human at the iPad.
```sh
cd <Core> && swift test        # logic tests (fast, Linux host)
scripts/deploy.sh              # build+sign+install+relaunch+wait for the debug server (10-25 s incremental). Repo root.
                               # --log streams the app's syslog to ~/tmp/app.log; --no-build reinstalls the signed xtool/*.app
scripts/shot.sh NAME [25%]     # screenshot -> ~/tmp/shots/NAME.png (+ NAME-s.png resized); Read it
scripts/tap.sh PX PY           # real touch at screenshot pixels, any orientation (see "Touch")
scripts/drag.sh PX1 PY1 PX2 PY2 [SECS]   # real drag, same pixel coordinates
scripts/container.sh ...       # read/write the app's sandbox files (see "App files")
scripts/crashes.sh             # newest crash report -> ~/tmp/crashes/, symbolicated summary (see "Crash reports")
```
- `deploy.sh` writes details to `~/tmp/deploy.log`. It builds with `xtool dev build --sign` (the unsigned `.app` a plain `xtool dev build` leaves in `xtool/` can't be installed), then: mounts the DDI (`mounter auto-mount --userspace`, a no-op when mounted), stops the app (`/quit` if the debug server answers, else `dvt pkill --bundle`), installs with `pymobiledevice3 apps install --developer`, launches with `core-device launch-application`, starts the `usbmux forward` if nothing listens on <PORT>, and polls `/ping` (prints `ready in Ns: ...`).
- If the build fails, deploy.sh prints up to the first 5 `error:` lines and then `FAILED: build` (details in `~/tmp/deploy.log`). A build broken by someone else's in-progress Core edit is not yours to fix; report it.
- xtool prefixes the bundle id: the installed id is `XTL-2CWY6D3Y7M.<bundle>`.
- If you hit `Too many open files`, run `ulimit -n 65536` first (the script does). After a toolchain change, delete `.build`.
- `xtool install` / `xtool dev run` stall at `[Installing] 100%` while the app is foreground; `deploy.sh` uses `apps install`, which doesn't.
- `.gitignore` should use `.build/` (not `/.build`) so the Core package's `.build` stays out.

## Verify loop for UI work
1. `swift test` in the Core package.
2. `scripts/deploy.sh`.
3. Drive the app to the state you need with `curl localhost:<PORT>/...` (`/page`, `/tap?id=`, app routes).
4. `scripts/shot.sh NAME` and Read the PNG.
5. Only then say the change works.

## Seeing the iPad
P=`~/pymobile3-venv/bin/pymobiledevice3` (11.26.0), U=`00008122-001259DE26E8401C`.

**No tunneld and no root.** With pymobiledevice3 >= 11.26, developer commands fall back to an in-process userspace tunnel on their own (a warning says so; pass `--userspace` to skip the first failed attempt). The DDI mount is once per boot and idempotent: `$P mounter auto-mount --udid $U --userspace`.
- `--udid U` is accepted by `dvt`, `accessibility`, `mounter`, `apps`, `syslog`, `usbmux forward`.
- `developer core-device ...` subcommands do **not** take `--udid`. Use `export PYMOBILEDEVICE3_UDID=$U`. Each Bash call is a fresh shell, so set it in the same command.

**Screenshots:** `scripts/shot.sh NAME`, or `$P developer dvt screenshot ~/tmp/shots/NAME.png --udid $U --userspace`, then Read the PNG (~2 s).
- **Coordinate rules:** PNGs are 1908x2746 in portrait and 2746x1908 in landscape (they follow the device orientation). The debug server's `/tree` reports points; screenshot pixels = points x 2. `tap.sh`/`drag.sh` take screenshot pixels, so measure from the PNG you just took (re-shoot after rotating).
- Orientation: `$P developer core-device get-display-info` shows `currentOrientation` (rot0/rot90/rot180/rot270); `core-device rotate left|right` rotates without touching.

**Other ways to look:**
- Logs: `deploy.sh --log` (writes `~/tmp/app.log`), or `$P syslog live -pn <App>`. Debug commands log under category `debug`.
- UI tree as text: prefer the app's `/tree` (frames, ids). `$P developer accessibility list-items` works unprivileged but gives only captions and ids.
- LLDB (rootless, attach verified 2026-10-09): needs `~/dev/omarchy-apple-dev` on `main` (upstream has `--lldb`/`--attach` since PR #10; its FINDINGS 67 now holds these recipes; the fork's `lldb-userspace` is redundant). Run from the app repo root:
  - `~/dev/omarchy-apple-dev/device-run.sh --lldb` builds, installs, launches the app suspended and attaches (33 s total). `--attach` skips build/stop/reinstall and attaches to the installed app, running or not (35 s).
  - `LLDB_CMDS=$'bt\nprocess detach'` runs commands after the attach, in synchronous mode. End with `process detach`.
  - Mechanism: the userspace debugserver forwarder plus an async `process connect` (a sync connect hangs). `LLDB_LOAD_LEVEL=minimal` (default) keeps the attach to about 30 s; `complete` gives full system symbols in minutes. `--sudo` is the old kernel-tunnel path with full symbols, and it needs the user.
  - Verified: stopped process, `bt`, `thread list`, `process detach`, app symbols with file:line (`image lookup -r -n DebugServer`). System frames show only the library name.
  - Verified 2026-10-09 (2 sessions, usbmuxd stayed active, NRestarts 0): `breakpoint set -f SomeFile.swift -l 185`, `continue`, hit with source, `frame variable` (locals and args, `v self` too), `thread step-over/step-in/step-out`, `po self` , `process detach` (app keeps running, `/ping` ok). NOT verified: `--attach --sudo`.
  - **Swift `expr` does not work** (`expr 1+1` -> "cannot load underlying module for 'AVFAudio'"; `po` warns and falls back to `p`). `expr -l c -- 1+1` and `-l objc` work but print a long burst of "Error while searching for Xcode SDK: HostInfoError" (about 2 min; harmless). Use `frame variable` / `v`. `bt` prints only the app frames plus "HostInfoError" noise; system frames are hidden by `minimal` load level.
  - **A failing command aborts the rest of LLDB_CMDS** (batch mode). Put risky ones (Swift `expr`) last, or wrap them as `script lldb.debugger.HandleCommand('expr 1+1')`.
  - **Route-triggered breakpoint recipe:** LLDB_CMDS is synchronous, so `continue` blocks until the stop, then the next lines run. Fire the request from a background job that starts before the attach finishes (the attach takes about 35 s, so sleep ~55 s), with a long `-m`: `(sleep 55; curl -s -m 100 'localhost:<PORT>/ROUTE' > ~/tmp/t.out 2>&1) &` then `LLDB_CMDS=$'breakpoint set -f SomeFile.swift -l 185\ncontinue\nbt\nframe variable\nthread step-over\nframe variable\nthread step-in\nthread step-out\nprocess detach' device-run.sh --attach`. The curl blocks while stopped (the debug server's handler is paused), and fails with rc 28 if the session outlasts `-m`. Always end with `process detach`.
  - **usbmuxd crash:** 3 of the first 5 rootless sessions ended with usbmuxd aborting ("free(): invalid pointer") after the detach or as the next session started. Since 2026-10-09 a drop-in (`/etc/systemd/system/usbmuxd.service.d/override.conf`: `Restart=on-failure`, `RestartSec=1`, `StartLimitIntervalSec=0`) restarts it on its own. If a device command fails with "Failed to connect to usbmuxd socket", wait a few seconds, check `systemctl show usbmuxd -p ActiveState -p NRestarts`, then run a full `scripts/deploy.sh`, which starts a fresh forwarder. Ask the user for `sudo systemctl restart usbmuxd` only if it stays down. Don't `pkill -f "usbmux forward"` from a Bash tool call: the pattern matches the tool's own shell and kills it. Use `pgrep -f "[u]sbmux forward"`.
  - After `device-run.sh`, `deploy.sh --no-build` fails with "not signed" (`xtool dev build` leaves the app unsigned). Use a full `deploy.sh`.

## Touch
`scripts/tap.sh PX PY` sends a real touch (`core-device universal-hid-service tap`) at screenshot pixel coordinates. HID coordinates are 0..65535 in a frame that rotates with the orientation; tap.sh reads `currentOrientation` and converts (all four orientations verified). `scripts/tap.sh --frac FX FY` takes fractions of the upright screen (the `fx=`/`fy=` columns in `/tree`). `scripts/drag.sh` does the same for drags. Use the app's `/tap?id=` first (no coordinates needed); use tap.sh for what accessibility can't activate (UIKit menu items, alert buttons, keyboard keys).

## Driving the app: debug hooks
DEBUG builds run an HTTP command server on the device's loopback, at the app's `<PORT>` (`Sources/<App>/Debug/DebugServer.swift`):
```sh
($P usbmux forward <PORT> <PORT> > ~/tmp/fwd.log 2>&1 &)   # deploy.sh starts it; dies if the iPad unplugs
curl -s localhost:<PORT>/help                              # list commands
```
The forwarder survives redeploys; deploy.sh relaunches the app and waits for `/ping`. Common routes in every app: `ping help tree tap scroll quit crash awake state page appearance`. The per-app file has the full route table.

**Adding a command:**
- From any `@MainActor` code (often a view's `.task` inside `#if DEBUG`), register it with `DebugServer.shared.register("name") { query in ...; return "text" }`.
- `query` is `[String: String]` built from the query string. Return a short, greppable text or JSON body.
- Keep it all inside `#if DEBUG`, and add the route to the app's file under `apps/`.
- Page-level commands exist only once their page has appeared; switch with `/page?name=` first.

## App files (container) from Linux
`scripts/container.sh` reads/writes the app's sandbox (verified 2026-10-08/09, rootless, dev-signed app):
```sh
scripts/container.sh ls ["Library/Application Support/store"]   # no arg: Library, Documents, tmp
scripts/container.sh pull "Library/Application Support/store" [local]   # default ~/tmp/container/<name>
scripts/container.sh [--restart] push LOCAL "Library/Application Support/store/<prefix>.v1.sessions.json"
scripts/container.sh [--restart] rm REMOTE                      # recursive for dirs
scripts/container.sh snapshot                                   # -> ~/tmp/container/snap-<ts>/Library/Application Support/...
scripts/container.sh [--restart] restore ~/tmp/container/snap-<ts>
```
- Paths are relative to the container root. App data is under `Library/Application Support/` (the per-app file names the keys).
- **Stop the app before writing**, or it overwrites your file on its next save. `--restart` does `curl :<PORT>/quit`, the write, then `deploy.sh --no-build` (~10 s). Reads are safe while it runs.
- Works: `apps pull/push/rm` (house_arrest VendContainer): whole container, including Library/Application Support. `core-device list-directory/stat/read-file/write-file` (domain `appDataContainer --identifier BUNDLE`): only Library, Documents, tmp, and neither `write-file` nor `create-directory` makes parents. `create-directory` makes dirs with permissions 0 that AFC cannot enter; don't use it. Plain `pymobiledevice3 afc` is /var/mobile/Media only.
- `apps pull DIR dest` puts the dir *inside* dest; `apps push FILE` fails on a missing parent, but `apps push DIR` creates directories (the script uses that trick).

## Without the cable (Tailscale, iOS 27; NOT set up for this iPad yet)
Upstream (`docs/OVER-TAILNET.md`, measured on an iPhone with iOS 27.0.1, not on this iPad) drives a phone over Tailscale with no
cable and no Mac: install, launch, screenshot, syslog, LLDB. The iPad is on the tailnet as `ipadm3`
(`tailscale status`, the `iOS` line; 100.103.72.35 when last checked). mDNS is not used: you pass the IP.
- One-time, iPad on USB and unlocked, Tailscale app connected: `~/pymobile3-venv/bin/python ~/dev/omarchy-apple-dev/tools/tailnet-tunnel.py pair`
  (no tap needed). It writes `~/.local/share/pymobiledevice3/remote_<udid>.plist`, which is a credential (mode 600; don't copy it around casually).
  Needs Python >= 3.13 with TLS-PSK ciphers; the venv's mise 3.14.8 has them (`ssl.SSLContext.set_psk_client_callback` present).
- The tunnel needs a TUN device: the tool uses `sudo -n`, so ask the user to run `sudo -v` first (never sudo yourself). Then
  `~/pymobile3-venv/bin/python ~/dev/omarchy-apple-dev/tools/tailnet-tunnel.py 100.x.y.z --hold 600` prints `RSD fd..::1 PORT`;
  every pymobiledevice3 command takes `--rsd fd..::1 PORT` instead of `--udid`/USB.
- `~/dev/omarchy-apple-dev/device-run.sh --over-tailnet 100.x.y.z xtool/<App>.app` installs and launches a signed build
  (after `scripts/deploy.sh` or `xtool dev build --sign`; a plain `xtool dev build` leaves it unsigned). Add `--console [SECS]`
  for the app's stdout/stderr plus `running after N s` / `fatal text seen`, and `--symbolicate [DIR]` to pull and print crash
  reports afterwards. Both flags also work on `--rsd`, not on the USB mode.
- `scripts/deploy.sh`, `shot.sh`, `tap.sh`, `container.sh`, `crashes.sh` and the <PORT> `usbmux forward` are USB-only today;
  they would need `--rsd` variants (and a different port forward for the debug server) to work this way.
- Limits: the iPad needs Wi-Fi (cellular-only closes the port) and the Tailscale VPN on. Screen off and idle for hours: screenshots
  are black and launches fail (code 10002), so wake it to the lock screen first. Screenshots show whatever is on screen.
  LLDB over the tunnel needs a sysroot from the IPSW (`~/.cache/omarchy-apple-dev/DeviceSupport/...`) and about 220 s to reach
  `main` (see the doc). The USB `--lldb`/`--attach` path below is much faster.

## Crash reports
`scripts/crashes.sh` (`-n N` for the newest N, `--all` lists the device's <App> reports, `--watch` streams new ones, `FILE.ips` re-reads a local one). It runs `crash flush`, `crash pull -m '<App>-.*\.ips'` into `~/tmp/crashes/`, then prints exception, termination, the crashed thread's backtrace, and file:line plus the source line for <App> frames (marked `>`). Verified 2026-10-08 with `crash?kind=fatal`.
- Reports are `<App>-<date>.ips` (JSON) on the device under `/` (`pymobiledevice3 crash ls`). They appear within a few seconds of the crash.
- Symbolication: the xtool binary has no DWARF of its own, only a debug map to `.build/**.o`. The script runs `dsymutil` on it into `~/tmp/dsym/<uuid>.dSYM` and feeds `llvm-symbolizer` (frame > 0 uses addr-1).
- It matches the report's image UUID against `xtool/<App>.app/<App>`. Every rebuild changes the UUID, so a crash from an older build gets a UUID-mismatch warning and device function names only. Read a crash before redeploying.
- The report does not carry the `fatalError` message (no `asi`); the printed source line at the crash site does. For more, use `deploy.sh --log`.
- `pymobiledevice3 crash watch --format json` is broken in 11.26.0 (TypeError); the script parses the text output.
- A backgrounded `--watch` ignores SIGINT; stop it with a plain `kill` on the script and the `crash watch` child (idle, so usbmuxd survived in testing). From a terminal, Ctrl-C works.
- Upstream also has `~/dev/omarchy-apple-dev/tools/ips-symbolicate.py REPORT.ips --binary PATH [--binary ...]` (UUID match, symbol table only, no file:line).
  `crashes.sh` is better for the app's own frames; use the tool for a report whose UUID no longer matches a dSYM-able build, or for
  framework binaries. It prints mangled Swift names unless `swift-demangle` is on PATH.

## When the device stops responding
- **Symptoms:** `device-run.sh` says "Pairing needed", or hangs at step 3 (`xtool devices`); `pymobiledevice3 usbmux list` is empty; `lsusb` still shows the iPad.
- **Check:** `systemctl is-active usbmuxd`. If it says `failed`, see why with `journalctl -u usbmuxd`.
- **Known crash:** usbmuxd 1.1.1 logs "Sending to client fd N failed: Broken pipe" and then "free(): invalid pointer", and dumps core. It happens when a client is killed mid-request, e.g. a stopped agent or a `timeout` around a device command.
- **Fix:** if `pymobiledevice3 usbmux list` is empty but `lsusb` shows the iPad, tell the user to run `! sudo systemctl restart usbmuxd`; never run sudo yourself. Hung xtool calls continue afterwards. If the daemon restarted, restart the usbmux forwarder too: find the stale one with `pgrep -f "usbmux forward"` and `kill` it (safe: it is idle, unlike a streaming client such as `syslog live`), then rerun `scripts/deploy.sh`, which starts a fresh one.
- **Prevention:** don't kill device commands mid-flight. Give them generous timeouts rather than short `timeout` wrappers.
- If the iPad gets unplugged (e.g. moved to another device), usbmuxd exits cleanly. Plugging back in starts it again; rerun `scripts/deploy.sh` (or just restart the forwarder).
- `xtool install` / `xtool dev run` stall at `[Installing] 100%` while the app is in the foreground, until someone swipes home. Don't use them; `scripts/deploy.sh` uses `apps install`, which doesn't. Don't kill a stalled xtool: killing a client mid-request can crash usbmuxd.
## Gotchas learned
- If `deploy.sh` fails because the venv python is missing or pymobiledevice3 no longer imports (for example after mise moved or removed a python), run `~/dev/omarchy-apple-dev/install-toolchain.sh --repair`. Don't `mise uninstall` that python.
- `pkill -f 'device-run.sh'` (or any pattern on the command line) matches your own bash call and kills it (exit 144). Use `pgrep -f "[u]sbmux forward"`, then `kill <pid>` in a separate call.
- A finished `device-run.sh` sometimes stays alive after `Verifying 100%`. It's harmless; leave it.
- `magick` (ImageMagick) is available for cropping screenshots; PIL is not.
- In Swift 6, statics read from `nonisolated` code inside a `@MainActor` class must be marked `nonisolated` themselves.
- Swift LSP: `~/.local/bin/sourcekit-lsp` points at `/usr/lib/swift/usr/bin/sourcekit-lsp`; the project's `.bsp/xtool.json` gives it iOS SDK context via `xtool dev build-server`.
- Binding the debug server to IPv4 loopback is enough for `usbmux forward`.
- `xtool dev build` compiles every package at `-Onone`, even local path dependencies (FINDINGS 74); put `swiftSettings: [.unsafeFlags(["-O"], .when(configuration: .debug))]` on a heavy Core target.
