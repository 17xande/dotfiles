# New app recipe (start from `~/dev/HelloOmarchy`)
HelloOmarchy is the minimal xtool app (`Package.swift` with one `.library` product, `xtool.yml` with `bundleID: com.example.HelloOmarchy`, `Sources/HelloOmarchy/`). The toolchain docs are `~/dev/omarchy-apple-dev/GETTING-STARTED.md`.

1. `cp -r ~/dev/HelloOmarchy ~/dev/<name>-app`, drop `.build`/`xtool`, rename the target, product and `Sources/` folder, `git init`, private remote. `.gitignore`: `.build/`, `/xtool`, `.swiftpm/`, `/.claude/worktrees/`.
2. `xtool.yml`: `bundleID: dev.alexf.<AppName>`, `infoPath: Info.plist`, `iconPath: Icon.png` (partial Info.plist is merged over xtool's defaults). iOS 18 minimum is fine with Pencil Pro APIs (FINDINGS 73).
3. Put logic in a platform-free `<Name>Core/` package (Foundation only, testable on Linux with `swift test`), depended on by path. Add `swiftSettings: [.unsafeFlags(["-O"], .when(configuration: .debug))]` to its target for heavy code (FINDINGS 74: xtool builds everything at `-Onone`).
4. Copy the scripts and debug server from a sibling app (`~/dev/handwriting-practice-app` is the newer one): `scripts/{deploy,shot,tap,drag,container,crashes}.sh`, `hold_drag.py`, and `Sources/<App>/Debug/{DebugServer,DebugUI}.swift`. Then replace three things:
   - the bundle id and app name: `sed -i 's/HandwritingPractice/<AppName>/g' scripts/*.sh` (deploy.sh syslog name, container.sh `BUNDLE=XTL-2CWY6D3Y7M.dev.alexf.<AppName>`, crashes.sh report/binary names; deploy.sh reads the real id from the signed app's plist);
   - the port: `sed -i 's/8766/<PORT>/g' scripts/*.sh Sources/<App>/Debug/DebugServer.swift` (`static let port`). Pick a port no other app uses (8765 music, 8766 handwriting; next 8767);
   - paths such as `build.txt` in deploy.sh if the app has no such file (remove that step).
5. Fonts: `UIAppFonts` registers nothing in an xtool build because resources land in `<App>.app/<App>_<Target>.bundle/Resources/` (FINDINGS 70). Register at launch with `CTFontManagerRegisterFontsForURL(url, .process, &err)` (see `App/FontRegistry.swift`, called from the `@main` init). Build the URL with `Bundle.module.bundleURL.appendingPathComponent("Resources/Fonts")`, not `resourceURL` (already ends in `/Resources`, FINDINGS 71). Google variable TTFs register as named instances (`PlaywriteGBS-Regular_Thin`; FINDINGS 72); drop the `[wght]` brackets from file names.
6. Resources: `resources: [.copy("Resources")]` on the app target.
7. Add the app to the table in `../SKILL.md`, write `apps/<name>.md` (bundle, port, routes), run `scripts/deploy.sh`, check `/ping` and a screenshot.
8. For a port of a web app, load the `web-to-ipad-port` skill.
