---
name: web-factory
description: >-
  Run a change in the current Go + htmx repo through the user's swamp web
  factory (stagecraft: web-plan plans and reviews it, one go-web work item per
  phase implements, verifies and reviews it, web-release ships it to staging),
  from a session started in the app repo itself. Covers starting a work item
  from a goal or from a plan the user already has, driving it, and checking on
  it. Triggers: "run this through the factory", "use the factory", "factory
  this plan", "start a factory work item", "web factory", "factory status",
  "what's the factory doing", "drive web-<n>".
---

# Web factory

The factory lives in the swamp workspace `~/.swamp/workspaces/claude-skills`
(factories `web-plan` and `go-web`, tracker `web`, workflows `go-verify` and
`web-release`). This skill drives it from the app repo you are in.

## Running swamp from here

- Run every swamp command as `factory ...` (same arguments). Bare `swamp`
  finds no repo here. `factory` points swamp at the workspace and loads its
  mise environment; relative paths in arguments still resolve from here.
- Load the `stagecraft` skill and follow it for everything: its rules (status
  first, one write at a time, pass the expectation back, never decide for the
  person) and its loop. Read each `swamp` in it as `factory`.
- Dispatch prompts: send each subagent its prompt unchanged, with one line
  before it: "Run every `swamp` command in this prompt as `factory` (same
  arguments)." Reviewer skills (`go-lens-*`, `go-htmx-web`) are user-level, so
  subagents started here have them.
- The studio (read-only web view of work items):
  `factory model method run studio serve` in the background, then
  http://127.0.0.1:45841/.

## Before starting: does this repo fit?

The factory builds for the `go-htmx-web` stack. Check, and tell the person
about any misfit before starting:

- Go + htmx in the go-htmx-web style; the repo root is its own git repo.
- Release image (`release/Dockerfile.go-web` in the workspace): `main` package
  at the module root, listens on :8080, builds with `CGO_ENABLED=0`, runs as a
  read-only distroless container with no data volume.
- Staging: web-release copies a compose file from the workspace's `release/`
  folder that is still fixed to factory-scratch. A new repo needs its own
  staging compose file and that step made per repo before its first release;
  say so at the start, and stop before release if it is still missing.

## Starting a work item

1. The repo is `git rev-parse --show-toplevel`; the work branch is the work
   item's key, made from the repo's main branch.
2. File and claim the ticket, then start (the claim prints the start command):
   `factory workflow run @swamp/stagecraft/create --input tracker=web --input 'title=<title>' --input 'body=<goal and repo path>' --input type=feature`
   then
   `factory workflow run @swamp/stagecraft/claim --input tracker=web --input issue=<id> --input factory=web-plan`.
3. Drive it with the stagecraft loop.

### When the person already has a plan

The `plan` stage (interactive) then shapes their plan into the plan artifact
rather than writing a new one:

- Keep their phases, order and decisions as written; record their decisions
  under `decisions` so reviewers treat them as settled.
- Fill the repo, branch and anything else the schema needs from the repo;
  ask for what is missing (the `release` settings: image, source, stagingDir,
  url, the first time a repo is released). Add no phase or decision of your
  own without asking.
- Show the shaped plan to the person before recording it. Plan review still
  runs on it, then their plan approval.

## Human stops

Plan approval, each phase approval, release approval, abandon, duplicate:
lay out the options as the stagecraft skill says and wait for the person's
word. Merging the branch to main stays theirs, outside the factory.
