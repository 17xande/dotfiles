---
name: omarchy-plugin-dev
description: >
  Build, debug and publish an Omarchy shell plugin (bar widget, panel, overlay, menu,
  service, or full bar replacement) written in QML/Quickshell. Use when creating a new
  plugin, editing files under ~/.config/omarchy/plugins/, cloning a built-in widget,
  wiring a plugin to a backend process, choosing nerd-font glyphs for a widget, or
  submitting to the plugin marketplace. Triggers: "omarchy plugin", "bar widget",
  manifest.json, BarWidget.qml, Panel.qml, Model.js, quickshell, qs.Ui, IpcHandler,
  "omarchy plugin clone/validate/enable", omarchy-shell, plugins.omarchy.org,
  omarchyplugins.com, plugin marketplace submission or update (a "[Verify]:" issue,
  publishing a new version of a listed plugin), security review of a plugin, taking
  dummy-data screenshots or a preview.png. NOT for end-user desktop customization — that is the
  `omarchy` skill.
---

# Omarchy Plugin Development

Plugins are QML loaded into the long-running `omarchy-shell` (Quickshell) process,
unsandboxed, with the user's permissions. `~/.config/omarchy/plugins/<id>/`.

Read the first-party plugins before writing anything — they are the real spec:
`/usr/share/omarchy/shell/plugins/` (see its `README.md` for the id → file map).
`panels/dropbox/` is the best full example of a widget with a backend process;
`panels/network/` is the biggest.

## The dev loop (read this first — it will cost you an hour otherwise)

**The automatic reload is not a reliable reload.** The shell runs `inotifywait` over
`~/.config/omarchy/plugins/` and, 150 ms after any save, runs the same path as
`omarchy-shell shell rescanPlugins`: unload, `Qt.clearComponentCache()`, rescan. The
official docs call that a hot reload. In practice (Omarchy 4.0.x):

- `.js` imported by QML (`import "Model.js" as Model`) is **never** reloaded by it,
  nor by `omarchy plugin disable` + `enable`. The QML engine caches JS imports for
  the life of the shell process.
- Simple `.qml` property edits usually hot-reload. **Structural** `.qml` changes —
  new ids, added/reordered child items, inline `component` definitions — have been
  observed not to.
- A plugin whose manifest sets `keepLoaded: true` is deliberately *not* replaced on
  reload, so changes to it only take effect on a shell restart.

Use **`omarchy-restart-shell`** for anything beyond a trivial tweak. Never
`omarchy-refresh-shell`, which also resets `~/.config/omarchy/shell.json` to defaults
and wipes the user's bar layout.

The failure mode is nasty: the panel renders your *new* QML while `Model.js` still
returns *old* values, which reads exactly like a logic bug. When a visual change
doesn't appear, suspect the cache before you suspect your code — and verify with a
screenshot (below), not by assuming the reload happened.

## Verifying, honestly

`qmllint` (`/usr/lib/qt6/bin/qmllint`, not on `PATH`) is a **syntax check only**.
Checked on Omarchy 4.0.0 (2026-11-11): `-I /usr/share/omarchy/shell`, the form the
develop guide recommends, changes nothing — the output is identical with and without
it. A first-party panel exits 0 with dozens of `unqualified` and
`pragma ComponentBehavior` warnings, so those are noise. Exit 255 means a parse error;
exit 0 proves nothing else. Don't treat a clean exit as a gate; grep the output for
the names you just added.

What actually works:

```bash
omarchy plugin validate ~/.config/omarchy/plugins/<id>     # manifest + file mapping
omarchy plugin list --json | jq '.[] | select(.id=="<id>")'
omarchy-shell <ipcTarget> <method>                         # your IpcHandler
omarchy-shell shell summon <id> '{}'                       # open via the bar route
omarchy-shell shell hide <id>                              # ...and close it
qs log -p /usr/share/omarchy/shell --tail 100 | grep <id>  # QML errors
grim /tmp/shot.png && magick /tmp/shot.png -gravity northeast \
  -crop 700x560+0+20 +repage /tmp/crop.png                 # then look at it
```

Screenshot-and-look is the only way to confirm a visual change landed. Crop tightly
and zoom (`-resize 300%`) when checking a glyph — a wrong icon at 16px looks like a
right one.

Before sharing, walk the develop guide's lifecycle list by hand: click, Escape, shell
summon and hide, `omarchy plugin disable` + `enable`, a shell restart, and
`omarchy plugin remove`. Never start a second Quickshell process for a plugin (the
guide says so outright); everything runs inside `omarchy-shell`. Moving a widget's
slot is `omarchy bar move <id> --section <s>` (`left`, `centerBegin`, `center`,
`centerEnd`, `tray`, `right`; also `--index N`, `--before/--after <id>`; `enable` takes
the same placement flags). A `bar`-kind plugin takes no placement: `omarchy bar use <id>`
(or `omarchy plugin enable <id>` with no flags; with flags it refuses).
If it validates but is not listed, `omarchy-shell shell rescanPlugins`; if listed but
absent, check it is enabled and read `qs log`. Dot-prefixed folders in the plugins dir
(add/clone staging, `remove` backups `.<id>.bak.*`) are never scanned, and the
watcher ignores their changes.

Give the plugin an `IpcHandler` early. `omarchy-shell <target> status` returning your
state string is the cheapest possible test harness, and it doubles as the user's
keybinding surface.

## Structure that pays off

Keep three layers, and keep the bottom one free of QML:

- **`Model.js`** — pure functions only: parsing, formatting, state mapping, glyph
  choice. No `Qt.*`, no QML objects. That restriction is what lets you run it under
  plain `node` in a test file, which is worth far more than it costs:
  ```js
  const src = require("fs").readFileSync(require("path").join(__dirname,"..","Model.js"),"utf8");
  const M = {}; new Function("exports", src + "\nObject.assign(exports,{fnA,fnB});")(M);
  ```
- **`Service.qml`** — `Item` holding state properties and `Process` objects.
- **`Panel.qml`** / `BarWidget.qml` — view only, no business logic.

A bar widget's entry point may be `Panel.qml` directly (8 of 12 first-party widgets,
the ones that are mostly a popout), or a small `BarWidget.qml` extending `BarWidget`
from `qs.Ui` that loads `Panel.qml` itself (clock, media, menu, weather, and the
official develop guide's example). `BarWidget` gives you `bar`, `moduleName`,
`settings`, `setting(name, fallback)`, and `broadcast(method)`, which relays a call to
every monitor's copy of the widget, since an IPC target reaches only one of them.
`moduleName` and `ipcTarget` must equal the plugin id.

With the `BarWidget.qml` + `Loader` shape (develop guide, Aug 2026), the loader's
`onLoaded` injects `bar`, `anchorItem` (the bar button) and `hostWidget` (the
`BarWidget`) into the panel — once immediately and again via `Qt.callLater`, and on
every `onBarChanged`. The panel then passes `owner: root.hostWidget || root` to
`KeyboardPanel` and calls `bar.switchPanelFrom(root.hostWidget || root, direction)`
for Tab. The widget forwards `opened`, `popoutSwitchClosing`, `open()`, `close()`,
`toggle()` and `closeForPopoutSwitch()` to `panelLoader.item`; a panel that "opens
once but never again" is a widget that forgot to forward `opened`. In this shape the
panel sets `manageIpc: false` (the widget owns the entry point).

A bar widget must expose `open()`, `close()`, `toggle()`, `closeForPopoutSwitch()` and
the `opened` / `popoutSwitchClosing` properties. Inheriting `Panel` from `qs.Ui`
(`/usr/share/omarchy/shell/Ui/Panel.qml`) gives you all six plus a `controller` alias
and an optional built-in `IpcHandler` (`manageIpc`). If you override `close()`, still
call `controller.hide()` — `closeForPopoutSwitch()` is implemented in terms of it.

Find your own `bin/` the way third-party plugins do:

```qml
readonly property string pluginDir: Qt.resolvedUrl(".").toString()
    .replace("file://", "").replace(/\/+$/, "")
```

**What the host injects.** Entry points may declare `omarchyPath`, `shell`,
`manifest`, `pluginRegistry` and `barWidgetRegistry` properties. A third-party plugin
gets capability-scoped facades, not the host objects: it can look up and control its
own service and lifecycle, read detached bar state, and nothing else. Authentication
services (lock, polkit) are unreachable. Don't design around reaching another
plugin's live service. The facades are not a sandbox, though: visual widgets share the
host QML scene and can walk parent items (see `$OMARCHY_PATH/shell/README.md`).

What the facades actually offer a third-party widget (`Ui/PluginBarApi.qml`,
`services/PluginShellApi.qml`): `bar.moduleWidgets(ownId)` — every monitor's copy of
*your* widget, nothing else (no `findPanelWidget`) — and, if you declare
`property var shell: null`, `shell.summon/toggle(ownId, "")` and `shell.hide(ownId)`,
which route through the bar to the copy on the **focused monitor**, plus
`shell.isPluginOpen(ownId)`. Every copy has its own `Service`, so
every side effect (auto-open, notifications, option writes, pausing media) happens once
per monitor unless you gate it. Pattern:

```qml
readonly property bool isLeader: {             // one copy acts
  if (!bar || typeof bar.moduleWidgets !== "function") return true
  var items = bar.moduleWidgets(moduleName)
  return items.length === 0 || items[0] === root
}
function summonHere() {                        // open where the user is looking
  if (shell && typeof shell.summon === "function" && shell.summon(moduleName, "")) return
  root.open()
}
```

Route your own IPC `open`/`toggle` through `summonHere`, and document keybindings as
`omarchy-shell shell toggle <id> ""`: a plugin's own IPC target reaches only one copy.

## Quickshell facts that constrain design

Check `/usr/lib/qt6/qml/Quickshell/**/*.qmltypes` before assuming an API exists.

- **`Socket` is `QLocalSocket` — unix sockets only** (`path` property). There is no
  TCP client in QML. A backend on a TCP port needs a helper subprocess.
- **`SplitParser` splits on one fixed `splitMarker`** (default `\n`). It cannot frame
  length-prefixed or binary protocols, and it has **no byte ceiling** — an unterminated
  stream grows its buffer inside the shell process without limit. Make your helper emit
  **newline-delimited JSON** and have the *helper* enforce the size cap; never point a
  `SplitParser` at anything you do not produce yourself (see the security section).
- `Process` has `stdinEnabled` + `write(string)`. Write a secret, then set
  `stdinEnabled = false` to close the pipe. Make the *reader* robust to a pipe that
  never closes, or a bad caller hangs your UI.
- `StdioCollector { waitForEnd: true }` for one-shot commands; `SplitParser` for
  streams; `Quickshell.execDetached([...])` for fire-and-forget (e.g. `notify-send`).

**The notification server is the Omarchy shell itself** (`plugins/notifications/`).
Facts that change design:

- It advertises `actions`, but only ever runs the **`default`** action, on a click;
  named action buttons are never drawn. Make the default action useful ("open the
  panel"); keep named actions only for other servers.
- It advertises **`body-markup`**: escape `& < >` in anything caller-supplied you put in
  a body (`html.escape(..., quote=False)`), flatten newlines, clip.
- It is replaced on every shell restart, and the new one reuses the same small ids —
  a remembered id may now be *another app's* notification. Track the server's unique
  name (`NameOwnerChanged`, the sender of your `Notify` reply) and forget your ids when
  it changes.
- Critical urgency persists until dismissed: close or replace what is no longer true.
- Silence it for a scripted run with `omarchy-shell notifications setDnd on|off`
  (`isDnd` to read it first, and restore it).

**Bar tooltips**: `BarIconButton`/`WidgetButton` take `tooltipText`, read at hover
*enter* (not live). The bar sizes the tooltip window to the unwrapped text, so clip
every line you show there, especially network-supplied ones.

**Dependencies.** Tell the user `omarchy pkg add <packages...>` — the first-party
wrapper (`sudo pacman -S --noconfirm --needed`, skipped when already present), not
raw `pacman`. `omarchy pkg aur add` for AUR, `omarchy pkg drop` to remove. There is
no manifest field for dependencies and no install hook, so this is documentation
only; the plugin must degrade with a clear message when a dependency is absent
rather than traceback. Do not phrase it to dodge the marketplace capability scanner
— it greps the README, and a laundered instruction reads worse than an honest one.

Helper-process language: bash is the tree's convention (many `omarchy-*` scripts, plus
in-plugin `capture.sh`/`list.sh`), with exactly one Python helper
(`panels/dropbox/status.py`) and **zero compiled binaries**. There is no build hook and
no post-install hook — `omarchy plugin add` is a git clone — so a compiled helper would
have to be committed to the repo. Ship source.

## UI kit

`import qs.Ui` / `import qs.Commons`. Inventory: `/usr/share/omarchy/shell/Ui/`.
`omarchy dev ui preview [section]` opens the shell's gallery of these components (it summons a panel, so warn the user).
Key pieces: `BarIconButton`, `KeyboardPanel`, `PanelKeyCatcher`, `PanelHero`,
`PanelSectionHeader`, `PanelSeparator`, `PanelActionButton`, `CursorSurface`,
`TextField`, `Dropdown`, `ToggleSwitch`, `PanelToolTip`.
Style tokens: `Style.space(n)`, `Style.font.*`, `Style.spacing.*`, `Color.*`,
`bar.foreground` / `bar.urgent` / `barForeground`.

Keyboard is expected, not optional: `PanelKeyCatcher` gives `onMoveRequested`,
`onActivateRequested`, `onCloseRequested`, `onTabRequested`, `onTextKey`. Drive rows
from one array of action objects and one `cursorIndex`; if you render rows in several
sections, stamp each object with its global index rather than using the `Repeater`
index.

- **`h j k l` and `x` never reach `onTextKey`** — the catcher takes them for
  navigation and `deleteRequested`. Don't bind shortcuts to them.
- Set `blocked` from **field focus** (`field.activeFocus || …`), not field visibility,
  so Down can move from a field into the rows below it while the field stays on screen.
  When the last field leaves the screen, hand focus back to the catcher explicitly
  (`Qt.callLater(keyCatcher.forceActiveFocus)`) — nothing else will.
- **`KeyboardPanel` takes the keyboard exclusively on open** (`WlrKeyboardFocus.Exclusive`
  prime), and a plugin cannot open it without that. A panel that opens *by itself* —
  an incoming call, a clicked link, a notification — therefore receives whatever the
  user was typing into another app, and a stray letter fires your shortcut. Guard
  self-opened panels: ignore keys, Enter, row clicks and bar-icon clicks until the
  keyboard has been quiet ~1.5 s, restarting the window on every key. The catcher
  stands aside while a field has focus, so a field needs its own `Keys.onPressed`
  swallow and a guarded `onAccepted`; Qt runs `Keys.onEscapePressed` before
  `onPressed`, so Escape still closes.

## Colour: use the theme's roles, not a palette

The shell exposes four semantic colours — `Color.foreground`, `Color.accent`,
`Color.urgent`, `Color.muted` (plus `bar.foreground`/`bar.urgent` inside a bar widget) —
and **no green/success role**. The terminal palette (`color0–15` in
`~/.local/state/omarchy/current/theme/colors.toml`) is not wired into `Color`, and its
"green" slot is not green in every theme (it is a brown in the amber theme). So map
states onto roles: good/active → `Color.accent`, bad/busy → urgent, inactive → a dimmed
foreground (`Qt.darker(foreground, 1.55)`). Never let colour carry the meaning alone:
keep a glyph shape and a word. Verify with `grim` + crop, as for glyphs.

## Don't port the helper to a compiled language for this plugin system

`omarchy plugin add` is a git clone with no build or post-install hook. A compiled
helper must either be committed (the scanner flags `bundled-executable-binary` and a
human cannot read it) or built on the user's machine (installer / remote-build
capabilities, a toolchain dependency, crates fetched at install; vendoring them breaks
the scanner's 1,000-file limit). Source-only Python (`#!/usr/bin/python3 -I`, one file,
stdlib + `python-jeepney`) is the clean position. Revisit only for a real need (memory,
latency, distribution outside the marketplace as a separately packaged daemon).

## Glyphs: verify, never guess

Nerd-font codepoint names are easy to get wrong (`phone_hangup` renders as a `%`-like
mark; `phone_bluetooth` is not an in-call icon). Two steps, always:

1. Confirm the codepoint exists in the *bar's actual font* by scanning the cmap of
   `$(fc-match -f '%{file}' monospace)` (format-12 subtable → set of codepoints).
2. Render candidates at the real size and **look**:
   ```bash
   magick -font "$FONT" -pointsize 15 -background '#111' -fill '#ddd' \
     label:"$(printf '')" -gravity center -extent 30x30 -resize 500% /tmp/g.png
   ```

At 16px, bold FontAwesome glyphs (`` phone, `` ✕, `` cog) stay
legible where thinner Material variants turn to mush. Plain arrows (`↗` `↙`) beat
icon fonts for direction. Don't let meaning rest on colour alone.

## Traps

**Cloning.** `omarchy plugin clone omarchy.network [--edit]` creates
`<username>.network` (named "My Network"; `--edit` opens it in `$EDITOR`), **disables the original** and puts the clone in its bar slot.
Shortcuts and IPC calls to the built-in id are routed to the enabled clone, and
removing an active clone switches back to the built-in. If you then change the clone's `id` (or rename its
directory), the bar still references the old id — leaving a dead slot *and* a disabled
built-in widget, which looks exactly like "my network widget disappeared". Renaming a
plugin id means updating, together: the directory name, `manifest.json` `id`,
`moduleName` + `ipcTarget`, the bar layout entry, any docs, and any absolute path
baked into a systemd unit. Back up `~/.config/omarchy/shell.json` first; fix a dead
entry with `omarchy plugin disable <stale-id>`, then
`omarchy plugin enable <real-id> --section right --before <neighbour>`.

**Keybindings cannot ship.** No manifest field, no install hook. Document a suggested
binding for `~/.config/hypr/bindings.conf` instead — and check it's free first:
`SUPER+SHIFT+P` is Google Photos in a default install. `H I J K L Q R S T U V Z` were
unbound (verify at the time).

**`pkill -f "<pattern>"`** matches your own shell when the pattern appears in its
command line. It will kill the tool running it. Use `pkill -x <name>` or exclude `$$`.
And `pkill -x <name>` still kills the *plugin's* copy of that process, not just the
throwaway one you started to test with — if the plugin supervises a backend daemon,
kill your test child by PID and leave the user's running service alone.

**Re-triggering marketplace validation** (for an *open* submission or verification
issue). `route-issue-automation.yml` fires on `issues: [opened, edited, reopened,
labeled, unlabeled]` and there is **no** `issue_comment` trigger anywhere in the repo.
So after pushing a fix you must *edit the issue body* to re-run validation against the
new HEAD; a comment notifies the maintainer but revalidates nothing. Do both — edit the
body (bump the commit; on an update issue that is the **Target commit** field) and comment to explain the change. Once a plugin is listed, its
submission issue is closed and editing it does nothing: updates go through a **new**
verification issue (see Publishing).

**Never inject keystrokes to test a panel.** `wtype`/`ydotool` type into whatever has
focus — the user's terminal, not your panel, which only has the keyboard while it
holds the exclusive grab. And opening the panel over IPC for a screenshot *takes the
user's keyboard*: whatever they type lands in your panel. Warn them, keep it short,
or use a scripted stand-in (see "Screenshots with dummy data").

**Counting processes and monitors.** `pgrep -af pat | grep -c x` counts the shell
running the pipeline (its command line contains the pattern); `hyprctl monitors -j |
grep -c '"name"'` counts workspace names too. Use `pgrep -x`/PIDs and `jq length`.

**Test with the plugin's interpreter.** `python3` on `PATH` may be a version manager's
build without the system's `python-*` packages; a suite run under it silently skips
whatever needs them. Run Python tests with `/usr/bin/python3`, as `#!/usr/bin/python3 -I`
does.

**Session lock.** `omarchy-hyprland-session-locked` exits 0 locked, 1 unlocked, **2
undetermined**. Anything that restarts the shell must proceed only on exactly 1 —
restarting a live locker kills the lock screen.

## Manifest and settings

The shell and `omarchy plugin validate` require `schemaVersion` (the JSON number `1`),
`id`, `name`, `version`, `kinds` (non-empty array) and `entryPoints`. Marketplace
validation (`build-catalog.mjs`) also rejects a missing `author` or `description` —
`omarchy plugin validate` checks neither — and caps lengths: `version` 64, `name`/
`author`/`license` 120, `description` 500. Add `license` too. The validator
also enforces:

- every kind has its entry point: `bar-widget` → `entryPoints.barWidget`, and `panel`,
  `overlay`, `menu`, `service`, `bar` → the key of the same name;
- **no symlinks anywhere in the plugin folder**;
- an id matching `^[A-Za-z0-9][A-Za-z0-9._-]*$`, outside `omarchy.*`.

For a bar widget add `barWidget` with `displayName`, `description`, `category`,
`aliases`, `allowMultiple`, `defaultSection` (one of `left`, `centerBegin`, `center`,
`centerEnd`, `tray`, `right`, validated; the shell places a `center` default — or
none — in `centerEnd`, beside the clock, so pass `--section center` to land in the
box), plus `defaults` + `schema`, which render as
user-visible settings. `schema` is an array of `{key, type, label, defaultValue,
description}`. Types: `boolean`, `integer` (`min`/`max`/`step`), `enum` (`options`),
`string`, `path` (first-party manifests also use `multiselect`). Every
setting you read in QML must be declared in both `defaults` and `schema`. Read them
defensively:

```qml
function intSetting(name, fallback, min, max) { /* clamp; never trust the value */ }
```

## Screenshots with dummy data

A published screenshot of your own panel publishes your account, numbers and history,
and a blur is not redaction. Better: never have real data on screen. If the plugin
talks to a helper over a socket, write a **stand-in** that serves scripted scenes on
the same socket and protocol, and point the panel's CLI at a throwaway config dir:

- Relaunch the shell with the env var the way `omarchy-restart-shell` does, from
  Hyprland: `quickshell kill -p "$OMARCHY_PATH/shell" --any-display`, then
  `hyprctl dispatch 'hl.dsp.exec_cmd("/usr/bin/env MY_CONF=<dir> <OMARCHY_PATH>/bin/omarchy-launch-shell")'`
  (only `[A-Za-z0-9/._-]` in that string — it is Lua, then `sh -c`). Restore with
  `omarchy-restart-shell`, and check `/proc/*/environ` that no shell still carries the
  variable.
- Stop the real backend unit first (always — `activating` is not `active`), and only
  ever remove a socket inode you bound yourself.
- The panel's layer surface is **full-screen** (`hyprctl layers` gives 0,0,W,H), so
  it can't be cropped by geometry. Diff a shot before and after opening, threshold,
  and take the largest white `-connected-components` box: the panel's border is one
  connected outline. Refuse a box that doesn't hang from the bar at panel width.
  `grim -o <focused output>`; silence notifications for the run.
- Restore must survive SIGINT, SIGTERM and SIGHUP: resolve every binary and make every
  refusal before changing anything, ignore signals during restore, run restore
  commands with `start_new_session=True`, and exit non-zero saying what is not
  restored.

## Publishing

Docs (re-read when the user asks to publish — they change; last checked 2026-11-03,
publish guide dated 20 Aug 2026, develop guide 13 Aug 2026, structure unchanged):
`https://plugins.omarchy.org/develop.html` and `.../publish.html`, and in the
marketplace repo `omacom/omarchy-plugin-marketplace` the files **`SUBMISSION.md`**
(exact issue-body format for CLI/agent submissions), **`VERIFICATION.md`** (statuses,
update and verify flows), **`SECURITY.md`** (scanner policy) and
`.github/ISSUE_TEMPLATE/{submit-plugin,verify-plugin}.yml`. Fetch them with
`gh api repos/omacom/omarchy-plugin-marketplace/contents/<path> --jq .content | base64 -d`
and `registry.json` (`sources[].repo`, `listingValidatedCommit`,
`automatedSecurityBaseline`) to see what is listed and which commit. The site is also
at `omarchyplugins.com`.

First check whether the plugin is **already listed**: grep `registry.json` for its id,
and `gh issue list -R omacom/omarchy-plugin-marketplace --search "<name>" --state all`.
Listed → it is an *update*, not a new submission.

Checklist: public GitHub repo, valid `manifest.json` at the root, README with install
*and* removal instructions, LICENSE, documented external dependencies, safe
install/removal, and an optional root preview (`preview.png`/`.jpg`/`.jpeg`/`.webp`/
`.avif`, ≤ 50 MB and 40 megapixels, optimized automatically). Id must be namespaced, outside `omarchy.*`,
and globally unique. `io.github.<user>.<name>` is the convention. **Ids are permanent**:
retired or renamed ids can never be reused, so settle it before submitting. Drop
`omarchy.clonedFrom` before publishing.

Test the install path as a user gets it: `omarchy plugin add <repo-url> --enable --yes`.
`omarchy plugin update` only fast-forwards `origin HEAD`, validates, and rolls back on
failure. `remove` deletes a git checkout outright, moves a non-git folder to a
dot-backup, and just unlinks a symlinked plugin folder (the shell loads a symlinked
folder, but `validate` rejects that path unless you add a trailing `/`; links inside
are always refused).
Without `--yes`, add/update/remove refuse when there is no terminal. Plugins land
disabled unless `--enable` is passed, and `add` clones mutable `HEAD`, not the commit
the marketplace verified.

Submit at **`omacom/omarchy-plugin-marketplace`**, either with the issue form
(`submit-plugin.yml`) or from the CLI with `gh issue create`. Its `SUBMISSION.md` is
the authority: exact title (`[Plugin]: <name>`), six headings in order, and the
five-item checklist verbatim. It also lists the current categories (one, exact
spelling) and tags (one to three). Read them there, since both lists change. The checklist
also promises the plugin does not overwrite user configuration without explicit consent.
The bot applies the `submission` label itself when the format matches. `SUBMISSION.md` tells
agents to show the finished title and body to the owner and create the issue only
after explicit approval. Do that. The checklist is the owner's to attest: never tick it on
their behalf. Non-collaborators cannot set other labels; maintainers triage.

Before submitting, clone the pushed repo to a temp dir, run `omarchy plugin validate`
on *that* copy, and grep it for anything personal — including **tests**: fixtures
copied from a real contacts file or call log carry real extensions, names and
hostnames (replace them with neutral values). A screenshot of your own panel will
happily publish your account name, SIP address, or hostname. Redact by mosaic
(`-scale 6%` then back up) plus blur, not by a light blur alone. A test that needs
`cc` or another tool must **skip with a message** when it is missing, since the
reviewer runs `tests/run` on a different machine; never commit a compiled harness
(`bundled-executable-binary`) — compile into a temp dir at test time.

### Publishing an update to a listed plugin

Since late 2026 an update is **a new issue from `verify-plugin.yml`** ("Verify or
update a listed plugin", title `[Verify]: <Name> <version>`), not an edit of the old
submission. Fields: *Verification action* = "Verify and publish a newer upstream
commit"; *Plugin ID* (exact); *Repository URL* (root, no trailing slash); *Target
commit* = the **full 40-character SHA of the repo's current HEAD on GitHub** — so push
first, and re-check `gh api repos/<owner>/<repo>/commits/main --jq .sha` matches;
the acknowledgment box ticked (owner's). Other actions on the same form: verify the
currently listed snapshot, and enable standard installation (needs the extra
acknowledgment; for a plugin with `installation.mode: manual` in the registry, which
is any plugin that needs `omarchy pkg add` dependencies).

```bash
gh issue create -R omacom/omarchy-plugin-marketplace --title "[Verify]: <Name> <ver>" --body-file body.md
```
with body headings `### Verification action`, `### Plugin ID`, `### Repository URL`,
`### Target commit`, `### Verification acknowledgment` (`- [X] I understand…`),
`### Standard installation acknowledgment` (`- [ ] …` left unticked for a manual-setup
plugin). Copy the previous update issue's body (`gh issue view <n> -R … --json body`)
rather than retyping the checkbox text. Then, as the author, **post a comment
describing the new attack surface** — the previous accepted update did, and the
maintainer's review cited it: what is new, which new commands/files/modules, the
bounds, what is allowlisted, where the tests are, and what the scanner will flag.
Flow: bot posts "Plugin update validation" and "Automated security baseline" comments
→ a maintainer reads the exact commit, comments, and applies `approved-and-verified`
(only a maintainer can; `approved-for-listing` is a legacy label that does nothing)
→ a bot publishes and closes the issue (the 0.3.0 update took ~4 h end to end). The
listed snapshot does not change until then. After a fix push, edit **Target commit**
and comment. The registry stores a baseline per exact commit, so a later push is
"Update unverified" until its own update issue is approved.

**Installation boundary**: `omarchy plugin add/update` clones mutable HEAD, not the
verified SHA. Do not leave half-finished work on the default branch between
approval and the next release; develop on a branch/worktree.

The other two actions on the form act only on the already-listed commit and cannot
promote a new one. Leave *standard installation* unticked if the plugin still needs a
package or a backend set up — that keeps its `manual-setup` listing. The marketplace's
`VERIFICATION.md` is the authority (read it; it changes), and its `AGENTS.md` says never
to open an issue without the owner's explicit approval: draft title, body and comment,
show them, then file.

### What review actually looks like

Two bots comment on the issue, then a human decides.

1. **Marketplace validation** — repo reachable, manifests unique and valid, README +
   licence present, "Quattro compatibility", optional preview.
2. **Automated security baseline** — a deterministic pattern scan that tags
   *capabilities*: `privilege` (`sudo`/`pkexec`), `package-manager`,
   `service-management` (`systemctl`), and others. It **greps the README too**, so
   documenting `sudo pacman -S <dep>` as a user instruction is enough to earn a
   `security-review-required` label. That is fine — it is not a failure — but expect
   to justify each flag in a comment and in the README.

Outcomes are `passed`, `review-required` (capabilities only) or `needs-fixes` (a
finding). Only `sudoers-dangerous-passwordless-command` and
`privileged-process-control-from-shared-temp` block outright (`security-needs-fixes`,
fix in a new commit); the remote-execution findings get `security-review-required` and
a maintainer may accept them. A listing is published only when a
maintainer applies `approved-and-verified` to the exact validated commit. If
`omarchy plugin add … --enable` alone can't produce a working plugin (a backend
service, a package to install), expect a `manual-setup` label, and the catalog then
shows manual install instead of the one-liner.

**After listing, every push goes stale.** The catalog refresh shows `Update
unverified` for any new upstream commit; the old snapshot stays the verified one until
an update issue for the new commit is approved (see "Publishing an update to a listed
plugin").

Both bots pin an **exact commit SHA**. After you push a fix you must say so *in a new
comment*: editing the issue body is invisible to the maintainer, and validation stays
attached to the old SHA until it re-runs. Ending a round without a reply comment is
the most common way a submission stalls.

### What the automated baseline actually checks

The scanner is open source — read it rather than guessing:
`omacom/omarchy-plugin-marketplace/scripts/security-baseline-*.mjs`, with the policy
documented in `SECURITY.md`. It is a **deterministic static pattern match over
selected files at an exact commit SHA**. It does not execute code, does no data-flow
analysis, and its own docs say it does not "attempt to stop a motivated attacker."

Findings: `curl-pipe-shell` (including download-to-file-then-execute),
`cargo-git-unpinned`, `remote-git-execution-unpinned`,
`sudoers-dangerous-passwordless-command` (`ALL`, a shell or interpreter, or broad
wildcards over `kill`/`systemctl`/file tools), and
`privileged-process-control-from-shared-temp` (a `/tmp` PID file fed to
`sudo`/`pkexec`; keep PID state in `$XDG_RUNTIME_DIR`).

Capabilities (flagged for a human, not failures): `installer`, `package-manager`,
`privilege`, `remote-build` (building only from your own repo lands here, not in
findings), **`bundled-executable-binary`**, `service-management` (unit files,
`systemctl`, `systemd-run`), and `sudoers-modification` (which is where a narrow
passwordless rule for a root-owned, fixed-surface helper lands).

Its limits: 1,000 files, 8 MiB total, 512 KiB per file. Test and fixture directories
are not scanned unless a manifest entry point selects a file, and a complete
ELF/PE/Mach-O is flagged `bundled-executable-binary`.

It greps prose. A clearly negated sentence ("No sudo or pkexec is required") is
excluded from `privilege`, but anything else that names sudo trips it. Don't reword to
dodge it — a laundered capability reads far worse than a flagged one that you explain.

### The real bar is a human, and it is much higher

There is no secret tool behind the deep findings. A maintainer reads the helper line
by line. Across one real submission the automated baseline found nothing in the code
at any round; a human produced five rounds of blocking findings. Audit yourself
against these **before** submitting — each one is a category that actually blocked a
listing:

**1. Path resolution.** Pin directories, do not validate names. `lstat`ing a directory
and later `open()`ing under it re-resolves the whole mutable parent chain; a same-UID
process swaps an intermediate component in between and a final-component `O_NOFOLLOW`
never notices. Walk from `/` one component at a time with
`O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC`, each `dir_fd=` the previous, hold the leaf fd for
the process lifetime, and do every later op through it (`os.open(…, dir_fd=)`,
`os.unlink(…, dir_fd=)`, `os.rename(…, src_dir_fd=, dst_dir_fd=)`, `os.fchmod(fd)`).
Hand children `/proc/self/fd/N` + `pass_fds`, never a pathname. This includes
directories you only write into (`~/.config/systemd/user`) — but only ever *tighten* a
directory **you own**; re-moding someone else's is its own finding.

**2. Descriptor validation.** `fstat` the fd you will actually read, for type and
owner — never the name. `O_NONBLOCK` at open so a substituted FIFO cannot park you
inside `open()`.

**3. Writes replace, never truncate.** `O_NOFOLLOW` refuses a symlink but not a
same-owner *hard link*; `O_TRUNC` on a secrets file writes straight through one.
Create an `O_CREAT|O_EXCL` temp with an unpredictable name under the pinned fd, write,
fsync, re-`fstat` the write fd, `renameat` into place.

**4. Bound every read, in bytes.** Per file, per record, per field, per record count,
and the buffer of any incremental parser. Drop-and-resync an oversized record rather
than buffering it. **A time limit is not a memory bound** — a five-second deadline on
a pipe read still lets a writer allocate for five seconds at pipe speed. Cap bytes
*and* time.

**5. Bound every process and every log.** One-shot calls need whole-process deadlines.
Anything whose full text you don't need should feed a clipped `SplitParser`, not a
`StdioCollector`. A long-lived child's stdout redirected to a file grows forever —
rotate it in place (`ftruncate`+`lseek` on the held fd; `Popen(stdout=fd)` dup2s that
exact fd so parent and child share one offset and the child's next write lands at 0).

**6. IPC must be authenticated or peer-credential isolated.** This one is
non-negotiable and it will not be accepted as "documented." An unauthenticated
localhost TCP control port is reachable by *every other user on the machine*, not just
you. Prefer the session bus (its socket is in `$XDG_RUNTIME_DIR`, 0700, and
`dbus-daemon` does `SO_PEERCRED` EXTERNAL auth) or a unix socket where you check
`SO_PEERCRED` on `accept()` yourself and refuse any uid but your own.

**7. Never forward a caller's string into another program's command grammar.**
Allowlist the exact commands you issue and give each one a parameter regex. Watch the
character class: `[!-~]` (all printable ASCII) *includes* `;` — that mistake shipped in
a fix whose own docstring explained why `;` was dangerous. Reject CR/LF/`;`/`"` in any
value serialised into a `;`-delimited, quote-using config grammar; cap every field.

**8. Execution trust — the one everybody forgets.** Everything you spawn inherits the
shell's environment, which you do not control. Use absolute distro paths
(`/usr/bin/systemctl`, not `systemctl`). Make the shebang `#!/usr/bin/python3 -I` —
absolute *and* isolated, so `PYTHONPATH`/`PYTHONHOME`/user-site cannot redirect it (a
single shebang arg is fine on Linux). Give QML producers `clearEnvironment: true` plus
only the keys genuinely needed (`HOME`, `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`,
a fixed `PATH`) — `Quickshell.execDetached` takes a `processContext` with the same two
fields. Give long-lived children an explicit allowlist env. In the systemd unit:
`ExecStart=/usr/bin/python3 -I …`, `Environment=PATH=…`, and
`UnsetEnvironment=PYTHONPATH PYTHONHOME PYTHONSTARTUP PYTHONUSERBASE LD_PRELOAD
LD_LIBRARY_PATH LD_AUDIT` — a `--user` unit inherits the user manager's environment,
which the user can add to.

**9. Rich-text injection in QML.** `Text` defaults to `Text.AutoText`, which promotes
a string that looks like markup into rich text. Set `textFormat: Text.PlainText` on
**every** dynamic `Text` fed by network or config data. The first-party `qs.Ui`
components already do; your own inline `Text {}` blocks do not.

**10. Report lifecycle truthfully.** Don't print "installed and started" when
`systemctl enable --now` returned nonzero. Propagate the failure. The same for any
fire-and-forget command whose success you print: make it a round trip.

Later review rounds on the same plugin added these:

**11. An authenticated bus is not an authenticated signal.** Any session-bus client
can emit a signal with your peer's interface and path. Resolve the peer's unique name
(`GetNameOwner`), put `sender=` in the `MatchRule`, and check `HeaderFields.sender` in
your pump too; check the signature before reading fields. A message the parser rejects
(jeepney raises on an unknown header-field code — anyone can send one to your unique
name, before any sender check) must replace the connection, not end the daemon: rate-
limit reconnects instead of exiting.

**12. Caller-chosen strings meet `argparse` too.** A value that starts with `-` is an
option to argparse. Pass options as `--opt=value` and put caller-chosen positionals
after `--`. Match every grammar with `fullmatch` (`$` also matches before a trailing
newline).

**13. Never delegate a write to a script.** `xdg-mime default` rewrites
`~/.config/mimeapps.list` by pathname, follows links and truncates in place — every
rule above, broken by a helper you ran. Do the edit yourself through the pinned
directory, or print the lines for the user to add. The helper's list of spawned
programs is something a reviewer reads; keep it short and say it in the README.

**14. Rewriting a file you don't own the format of must be lossless.** Regenerating
someone else's config from the fields you parsed drops what you don't model — in one
case a `;access=block` caller block and a `mediaenc=srtp-mand` option vanished on the
next save. Edit the one line/field you mean to change and keep every other byte;
match keys the way the consuming program does (case, whitespace, first-wins); refuse
a file you could only read part of, or that is not valid UTF-8, rather than write it
back. Keep timestamps finite (`NaN`/`Infinity` print as invalid JSON).

**15. The remote party is an attacker too.** Anything in a protocol message — caller
ID, a call/transaction id, a server-announced address — is chosen by whoever sent it.
Don't let it pick a number to dial (constrain to the account's own domain and show the
target), borrow a saved contact's name by partial match, or become an argument without
a strict character class. Enforce "one at a time" in the engine, not just the UI, and
act on the item by id, never on "the current one". Check what the engine does on its
own on the peer's say-so (a remote transfer request that makes it dial).

### Bounding things QML cannot bound

`SplitParser` has **no byte ceiling** (check `quickshell-io.qmltypes` — it has exactly
one property, `splitMarker`), and `Socket` takes a `path` string, so it re-resolves on
connect and cannot use a pinned descriptor. A peer that never sends a newline grows
that buffer inside the long-lived shell process without limit.

Neither is fixable from QML. The fix is to route through your own helper as a
subprocess — it can enforce a byte ceiling while receiving *and* resolve the socket
through a pinned directory descriptor — and let `SplitParser` read that helper's
stdout, which is now bounded by construction. Quickshell's `Process` also exposes no
process-group kill, so a QML watchdog kills your CLI's pid but not its descendants:
every subprocess your CLI spawns needs its own internal timeout.

The cost is one always-running child process. Pay it.

### Prove it with tests, and prove the tests work

Ship regression tests for each claim — the reviewer asks for them by name: same-UID
intermediate-component swap, leaf-dir swap, planted hard link, planted symlink, FIFO
substitution, oversized record, command-allowlist bypass, hostile
`PATH`/`PYTHONPATH`/`LD_PRELOAD`.

Before submitting, get the code reviewed against these categories by more than one
reader: split it by surface (helper, QML, any side tools) with a tight brief each — one
reviewer asked to cover everything stalls — then run a **second round on the fixes**.
In practice round two found a regression the fixes introduced and three gaps they
left.

Then **verify each test fails against the unfixed code.** Reintroduce the bug, confirm
the assertion goes red, restore. A test that passes both ways proves nothing — and an
end-to-end "hostile PATH" test is vacuous unless the subcommand it runs actually
shells out to the binary you shadowed.
