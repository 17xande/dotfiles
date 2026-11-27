# Handwriting Practice (`~/dev/handwriting-practice-app`)
iPad port of the web app `~/dev/handwriting-practice` (`handwriting.17xande.dev`). Bundle `dev.alexf.HandwritingPractice`
(installed as `XTL-2CWY6D3Y7M.dev.alexf.HandwritingPractice`), debug port **8766**, Core package `HandwritingCore` (Foundation-only,
Swift Testing, on Linux). Shared loop and rules: `../SKILL.md`. The repo's README and `docs/` (metrics, pens, strokes) are the spec; for
keeping it in step with the web, load the repo's `handwriting-parity` skill.

## Build and test
- `cd HandwritingCore && swift test` (add `--filter Name` for one suite). `LiveServerTests` skip unless `HP_SYNC_URL`, `HP_SYNC_EMAIL`, `HP_SYNC_PASSWORD` are set.
- `scripts/deploy.sh` (as in SKILL.md). It writes the git short hash to the git-ignored `Sources/HandwritingPractice/Resources/build.txt` (About shows it, `-dirty` if uncommitted).
- **`-O` in debug:** `xtool dev build` compiles every package at `-Onone` (FINDINGS 74). `HandwritingCore/Package.swift` keeps `swiftSettings: [.unsafeFlags(["-O"], .when(configuration: .debug))]` on the core target; without it a one-line check took 258 ms instead of 12 ms (300-800 ms on the iPad). Don't remove it; the app's `#if DEBUG` hooks still work.
- Fonts are registered at launch by `FontRegistry.registerBundledFonts()` (UIAppFonts does nothing in an xtool build; FINDINGS 70, 71).
- App data: `Library/Application Support/store/` (one JSON file per key; per person `p-<id>.` prefix; sync state `ip.v1.sync`).
- Sync server in DEBUG: `syncserver?url=` or Settings > Sync server (signed out only). Local server over plain HTTP works (`NSAllowsLocalNetworking`, IP literals and `.local`). Use a throwaway account, never echo its password.

## Debug routes (port 8766, DEBUG only; `curl localhost:8766/help` lists them)
Sources: `Sources/HandwritingPractice/Debug/*.swift` (`AppDebug`, `CheckDebug`, `DebugServer`, `DebugUI`, `FavDebug`, `InkDebug`, `ProgressDebug`, `SheetsDebug`, `StrokesDebug`, `SyncDebug`).

| Route | Purpose |
|---|---|
| `ping`, `help`, `state`, `quit`, `crash?kind=fatal`, `awake` | liveness, command list, app state; cold-restart; exercise `crashes.sh`; keep the screen on |
| `tree[?all=1\|views=1]`, `tap?id=`, `scroll?dy=` | accessibility tree (ids, labels, frames in points), activate an element, scroll. Check every control has a label |
| `page?name=sheets\|progress\|strokes\|settings\|about` | switch page (sidebar rows `nav-<page>`, Cmd-1..5) |
| `appearance?mode=light\|dark\|system` | window theme override (not persisted) |
| `sheet?slug=\|custom&text=\|index=1`, `back` | open a worksheet / custom text / the index; leave it |
| `font?model=&size=&slant=&name=`, `fonts[?favs]`, `settings`, `pencil`, `xheights` | model font and size for the open sheet; font list; settings dump; pencil/pairing info; x-height probe |
| `fav?add=&remove=&move=KEY:INDEX[&reset=1]` | favourite fonts (the `prefs` record) |
| `raster?row=N[&rle=1]` | the model-line raster the check compares against |
| `write?row=N&text=zigzag\|wave\|loop`, `undo`, `redo`, `clear?row=`, `erase?row=&u1=&v1=&u2=&v2=`, `flush` | synthetic ink, history, stroke eraser, force a save |
| `tool?pen=edged&nibs=5&angle=45&eraser=0&finger=1&follow=&haptics=&hover=&pressure=` | pen settings; `palette?show=1\|0` the radial palette; `livebench` times a live redraw |
| `ink`, `ink?record=last` | pen/row state; the ink record of the last check |
| `check?row=N`, `checkall`, `results`, `records?n=5`, `metrics?row=N` | run the check, last results, stored check records, the metric breakdown |
| `writemodel?row=N&wobble=0.06&seed=1[&source=strokes\|skeleton&synth=1&jitter=1&pauses=0&follow=1]` | write the model line as ink (see note) |
| `replay?row=N&speed=2&mode=ink\|speed\|pressure[&t=6&hold=1\|stop=1]` | attempt replay |
| `aids?show=&trace=&speed=`, `demo?row=&letter=` | stroke aids, animated letter demo |
| `strokes[?font=ID][&show=1]`, `suggest?font=`, `definestroke?font=&glyph=&pts=...` | stroke model coverage per font, suggestions from similar fonts, define a glyph's strokes |
| `progress[?range=30\|90\|all]`, `seedprogress?n=500&days=90[&ink=3]`, `seedprogress?clear=1` | Progress page state; synthetic records `seed-N` (real history; `clear=1` removes exactly those) |
| `attempt?id=\|n=0[&replay=1&mode=&speed=&t=&hold=1\|stop=1\|back=1]`, `backupcheck` | open a stored attempt (with replay); round-trip the backup file |
| `sync`, `syncstate`, `signin?email=&password=[&upload=1]`, `signout`, `syncserver[?url=]` | sync now; sync state JSON; sign in (upload=1 queues every local record, then call `sync`); sign out; server URL |
| `profiles`, `profile?add=\|switch=\|delete=\|rename=&name=` | local people |

Notes:
- **`writemodel` default is `source=strokes`** for fonts that have stroke models (the person's definitions, then the built-in): a perfect line gives Order 100 with no flags, like the web's `__italic.definedStrokes()`. `source=skeleton` traces the model's skeleton, which gives fake -stroke/+lift flags.
- `synth=1` gives traced strokes a pen's timing, pressure and angles; finger drawing (`tool?finger=1` + `scripts/drag.sh`) gives real timing with no pressure.
- `check`, `metrics`, `replay`, `writemodel` need a sheet open (`/sheet?slug=warm-up`); replies say so otherwise.
- `seedprogress` and checks write real history, which syncs while signed in. `checks`/`ink` are per person; switch profile before `signin`/`sync`.
- Typical loop: `sheet?slug=warm-up` -> `writemodel?row=0&wobble=0.06` -> `check?row=0` -> `metrics?row=0` -> `scripts/shot.sh`.
