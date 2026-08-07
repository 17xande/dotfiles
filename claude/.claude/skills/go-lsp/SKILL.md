---
name: go-lsp
description: >
  Use the gopls MCP server when working in a Go codebase — the correct workflow for
  navigating, understanding and refactoring Go code. Load this BEFORE renaming a Go
  symbol, finding where something is used, changing a function signature or exported
  type, exploring an unfamiliar package or dependency's API, or checking Go code for
  errors after editing. Triggers: "where is X used", "rename", "find references",
  "find the symbol", "what does this package expose", "did that break anything",
  refactoring Go, changing a Go signature, adding or updating a Go dependency.
  Also covers which tool to reach for: gopls vs ripgrep vs Edit.
---

# Working in Go with gopls

The gopls MCP server is connected, but **its workflow instructions are not published at
initialisation** — only the per-tool parameter docs are. Without them the default
behaviour is to fall back on grep and full rebuilds, which is slower, costlier and less
accurate. This skill is that missing guidance.

Distilled from `gopls mcp -instructions` (gopls v0.23.0). Re-run that command after a
gopls upgrade to check nothing has changed.

## Pick the tool by the task

| Task | Tool | Not |
|---|---|---|
| Rename a symbol and every reference | `go_rename_symbol` | sed, python, manual edits |
| Find where a symbol is used | `go_symbol_references` | `grep` — it can't tell `errors.New` from your `New` |
| Find a type/func when unsure of the name | `go_search` (fuzzy) | guessing at paths |
| Understand a file's package-mates | `go_file_context` | reading every file in the package |
| Understand a package's public API | `go_package_api` | reading its source |
| Errors after an edit | `go_diagnostics` | a full `go build` |
| Change text in a file | **Edit** | python/sed heredocs |
| Search text in non-Go files | ripgrep | — |

Measured on a real repo: `go_symbol_references` on `handler.New` returned **4** exact
references where `grep -rn 'New('` returned **55**, nearly all of them `errors.New`,
`httptest.NewRecorder` and similar.

## Read workflow — answering a question about the code

1. `go_workspace` first in an unfamiliar Go repo, to learn whether it's a module, a
   workspace or GOPATH.
2. `go_search` to locate a symbol by fuzzy name.
3. `go_file_context` immediately after reading a Go file for the first time — it
   summarises the declarations *from other files in the same package* that this file
   uses, which is the context reading one file always lacks.
4. `go_package_api` for what a package offers external callers. Faster and shorter than
   reading a dependency's source.

## Edit workflow — changing the code

1. **Read first**, per above.
2. **`go_symbol_references` before changing any symbol's definition.** This is the step
   that gets skipped and the one that matters: it tells you every call site exactly, so a
   signature change doesn't leave a caller behind.
3. **Make the edits** with Edit, including every reference found in step 2.
4. **`go_diagnostics` on the files you touched.** Cheaper than a build, and it may return
   suggested fixes as diffs — review them, apply if correct, re-run. `hint` and `info`
   diagnostics can be ignored when unrelated to the task.
5. **`go_vulncheck`** when `go.mod` changed — after the build errors are gone. Adding a
   dependency without this is how a known CVE arrives unnoticed.
6. **Run tests** only once diagnostics are clean. Iterate narrowly (`go test ./internal/x/`)
   and gate broadly before committing (the project's own `make test` or `go vet ./...`).

## Two limits worth knowing

- **`go_rename_symbol` needs the package to typecheck.** Mid-refactor with a broken build
  it will refuse — and that is exactly when text-replacement feels tempting. Sequence the
  work so it compiles at each step: rename while it builds, *then* change signatures.
- **gopls only knows Go.** A renamed symbol that also appears in a template name, a SQL
  file, a Makefile or docs needs a ripgrep sweep afterwards for the leftovers.
