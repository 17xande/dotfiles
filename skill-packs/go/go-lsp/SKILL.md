---
name: go-lsp
description: >
  Use gopls from the command line when working in a Go codebase — the correct workflow
  for navigating, understanding and refactoring Go code. Load this BEFORE renaming a Go
  symbol, finding where something is used, changing a function signature or exported
  type, exploring an unfamiliar package or dependency's API, or checking Go code for
  errors after editing. Triggers: "where is X used", "rename", "find references",
  "find the symbol", "what does this package expose", "did that break anything",
  refactoring Go, changing a Go signature, adding or updating a Go dependency.
  Also covers which tool to reach for: gopls vs ripgrep vs the file-edit tool.
---

# Working in Go with gopls (command line)

Run `gopls <command>` from a shell, from inside the module you are working on. Each call
is a fresh process that loads the module containing the file, so the workspace is always
the right one: ~0.15 s per call on a small module, ~0.4 s on a 170-file one. The gopls MCP
server is no longer used: it was rooted at the session directory rather than the module,
so it resolved no workspace for the repos and worktrees agents actually work in.

Every command below was run against a real module with gopls v0.24.0. Re-check
`gopls help <command>` after an upgrade.

## Positions

Most commands take a position: `path/file.go:LINE:COL` (1-based line, column counted in
**bytes**) or `path/file.go:#OFFSET` (0-based byte offset). It must land on the
identifier (anywhere inside it); on the `func` keyword gopls says `no identifier found`.

Find the column cheaply, without opening the file:

```sh
LC_ALL=C awk '/func NewServer\(/{print FILENAME":"NR":"index($0,"NewServer")}' internal/app/server.go
# internal/app/server.go:42:6
```

`LC_ALL=C` makes awk count bytes; in a UTF-8 locale it counts characters and is off by
one per multi-byte character before the name. `gopls symbols file.go` also lists every
declaration with `line:col`, but its columns count characters too, so on a line with
non-ASCII text before the name its column will not resolve. Use it to find the line, and
the awk recipe for the column.

## Pick the command by the question

| Question | Command | Not |
|---|---|---|
| Where is X used? | `gopls references file.go:L:C` (`-d` adds the declaration) | `grep` — it can't tell `errors.New` from your `New` |
| Where is X defined, what does its doc say? | `gopls definition file.go:L:C` (line 1 is location + signature; the doc follows) | opening files to hunt |
| What are this call's parameters? | `gopls signature file.go:L:C` (on the name or inside the parentheses) | reading the callee |
| Who calls X, and what does X call? | `gopls call_hierarchy file.go:L:C` | grepping for the name |
| What implements this interface / method? Which interface does this type satisfy? | `gopls implementation file.go:L:C` | guessing from method names |
| Where is a symbol whose path I don't know? | `gopls workspace_symbol Name` (substring, case-insensitive; `-matcher fuzzy` for misspellings) | guessing at paths |
| What is declared in this file? | `gopls symbols file.go` | reading the whole file |
| What does a package expose? | `go doc ./internal/pkg`, `go doc ./internal/pkg Type.Method`, `go doc -all` | reading its source |
| Rename a symbol everywhere | `gopls rename -l`, then `-d`, then `-w` (below) | sed, python, manual edits |
| Did my edit break anything? | `gopls check file.go [more.go ...]`, then `go vet ./...` | a full build per edit |
| Fix imports / formatting | `gopls imports -w file.go`, `gopls format -w file.go` (or `gofmt -w`) | hand-editing import blocks |
| Change text in a file | **your file-edit tool** | python/sed heredocs |
| Search text in non-Go files | ripgrep | — |

Measured on a real module: `gopls references` on a middleware constructor `New` returned
**5** exact references where `grep -rn 'New('` returned **105** lines.

Output is one `path:line:col-endcol` per line, absolute paths, sorted as text (so line
27 sorts after line 191). `references` without `-d` omits the declaration.

## Which directory

- **Position commands** (`references`, `definition`, `rename`, `check`, ...) find the
  module from the file's own path, so they work from the module root, a subdirectory, or
  anywhere given an absolute path.
- **`workspace_symbol` uses the working directory.** Run it inside the module (root or a
  subdirectory). From a directory that is not in a module it prints nothing and exits 0
  — an empty answer that looks like "no such symbol".
- **Worktrees:** each worktree is its own copy; gopls reads whatever is on disk at the
  path you pass. Run from, and pass paths inside, the worktree you are editing — a path
  into the main checkout answers for the main checkout.
- **`go.work`:** with a `go.work` above the module, references and `workspace_symbol` span
  every module it lists, from any of them. `GOWORK=off` confines it to one module.
- **No daemon.** `-remote=auto` failed to start its daemon here (`dial unix ...: no such
  file or directory`, 4 s per call); a manually started `gopls serve -listen` daemon saved
  under 0.1 s per call on a 170-file module. Not worth it — call gopls plainly.

## Read workflow — answering a question about the code

1. `go doc ./path/to/pkg` for what a package offers; `gopls symbols file.go` for what a
   file declares. Both are shorter than reading source.
2. `gopls workspace_symbol Name` (from inside the module) to locate a symbol by name.
3. `gopls definition` / `gopls references` at a use or declaration for "where is X
   defined/used"; `call_hierarchy` for callers; `implementation` for interfaces.

## Edit workflow — changing the code

1. **Read first**, per above.
2. **`gopls references` before changing any symbol's definition** — a signature change,
   a deletion, a type change. This is the step that gets skipped and the one that
   matters: it lists every call site exactly, so no caller is left behind, and "unused"
   becomes a fact.
3. **Renames go through `gopls rename`:**
   ```sh
   gopls rename -l internal/app/server.go:42:6 NewHandler   # files it would touch
   gopls rename -d internal/app/server.go:42:6 NewHandler   # the diff
   gopls rename -w internal/app/server.go:42:6 NewHandler   # write it
   ```
   With no flag it prints every edited file **in full** to stdout — unreadable; always
   pass one of the three. Check the `-l` list is entirely inside the repo first (see
   pitfalls). It updates doc comments and `[Name]` doc links; it refuses a name that
   collides (`conflicts with func in same block`, exit 2).
4. **Other edits with your file-edit tool**, including every reference found in step 2.
5. **`gopls check` on the files you touched.** Cheap and per file; it reports type errors
   and the vet-style analyzers (printf mismatches, ...). It exits 0 even when it finds
   errors, so read the output: empty means clean. `-severity=hint` adds unused functions
   and parameters — useful before deleting code.
6. **`go vet ./...` and the tests** before committing: `check` only reports the files
   named, not the rest of the package or its importers. When `go.mod` changed, also run
   the project's vulnerability check (`govulncheck`).

## Pitfalls

- **`rename` and `prepare_rename` do not refuse symbols outside your module.** Pointed at
  `fmt.Printf` or a dependency's identifier, `prepare_rename` succeeds and `rename` plans
  edits in the Go installation or the module cache. Run `rename -l` and check every path.
- **Build-tagged files are invisible.** A file behind `//go:build integration` (or another
  OS) is not searched or renamed. Add the tags: `GOFLAGS=-tags=integration gopls references ...`.
- **gopls only knows Go code.** Not templates, SQL, Makefiles, docs, string literals or
  test names: renaming `NeedsTouch` left `TestNeedsTouch` and `"NeedsTouch() = %t"`
  unchanged. Sweep with ripgrep afterwards. Generated Go is seen, but the next
  `go generate` overwrites edits to it — change the source it is generated from.
- **Silent empty answers:** `workspace_symbol` outside a module and `symbols` on a
  directory print nothing and exit 0. A position past the end of the file fails loudly
  (`line number 999 out of range`).
- **A broken build doesn't stop it.** `references` and `rename` still ran with a type error
  and with a syntax error in another file of the package — so a clean result is not
  proof the package compiles. `check` and `go vet` are.
- **`imports` and `format` are separate:** `imports` adds and removes imports without
  reformatting; `format` reformats without fixing imports.
