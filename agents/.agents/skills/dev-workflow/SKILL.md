---
name: dev-workflow
description: >
  The user's default workflow for any multi-step software development task: plan with
  Opus (architecture questions asked up front, stop and ask by default), then orchestrate
  with Sonnet, implement each phase with Sonnet agents (or Codex Sol agents when asked),
  check on agents every ~15 min and stop any past 45 min, review every phase with a
  separate Opus agent, then move to the next phase. Load this before planning or building
  a feature, a phase, a new project, a port or a refactor in any repo, and alongside
  stack skills such as go-htmx-web and web-to-ipad-port. Triggers: "plan this", "build",
  "implement", "next phase", "start the project", "use codex", "use sonnet agents",
  "opus review", "orchestrate", "use your best judgement", "review this codebase",
  "audit these repos", "update dependencies".
---

# Development workflow

The default for software work. A stack skill (go-htmx-web, web-to-ipad-port, ...) says
*what* good looks like; this one says *who does what, and when to stop*.

This workflow assumes OpenCode's native sessions and tools. It may need reworking
before use with Claude Code.

```
plan (Opus) -> switch to Sonnet -> per phase: implement (Sonnet/Codex agent)
            -> check in ~15 min, cap 45 min -> review (Opus agent) -> fix -> commit -> next phase
```

## 1. Plan with Opus

- The plan is written by Opus (the main session, on Opus). It is a phased plan in
  `~/.claude/plans/<name>.md`, outside the repo — or, when the permission rules block
  editing outside the repo, in `.plans/` inside it, listed in `.git/info/exclude` so it is
  never committed. Each phase is small enough for one agent
  brief (aim for well under 45 minutes of agent work) and ends in green tests and a commit.
- **Ask architecture questions up front**: data model, dependencies, storage, auth,
  boundaries between packages, anything expensive to change later. Batch them into one
  round of questions rather than drip-feeding.
- **Ask again where they emerge.** A question that surfaces mid-phase (an agent hits an
  unplanned choice, a review shows the design is wrong) is a stop, not a guess.
- **Default: stop and ask.** Do not make open architecture or dependency decisions alone.
- **Exception: "use your best judgement" / "decide with Opus".** When the user says so,
  have Opus make the call (yourself if on Opus, otherwise an Opus agent given the
  question, the options and the context), record the decision *and its reasoning* in the
  plan, and continue. The grant covers that request only; it does not carry over to
  later questions, phases or sessions.
- Record every decision and every open question in the plan file, so the Sonnet session
  that follows needs nothing from this conversation.

## 2. Switch to Sonnet to orchestrate

When the plan is approved, tell the user it is ready and ask them to switch the session
model to Sonnet with `/models`. The Sonnet session
orchestrates: it reads the plan, writes briefs, spawns and watches agents, triages
reviews, commits. It does not make architecture calls — those go back to the user (or to
an Opus agent when the user has granted best judgement, see 1).

## 3. Implement with agents

- **Always use the latest model of the family asked for, never a remembered ID.** Before
  launching any subagent, look the family up with the `models` tool (`query`, `all: true`,
  `limit: 100`) and pick the newest by release date; models ship often and an ID that was
  newest last month is stale. Sol: the highest-numbered plain `gpt-N.M-sol` (the `-fast`,
  `-ultrafast` and `-flex` entries are speed or pricing tiers of a version, not newer
  models; use them only if asked). Opus and Sonnet: the catalog may list only an
  unversioned alias (`claude-agent/opus`) with no release date; use that alias, which
  tracks the newest, and say in the report that the version could not be confirmed. If a
  newer, versioned entry appears, prefer it. Name the exact model you used in the brief
  log or plan.

- **Default: Sonnet agents; when the user asks: Codex Sol agents.** Launch an OpenCode
  `general` subagent with the `subagent` tool, selecting the requested model using its
  available `providerID/modelID`. Look up the model in OpenCode's model catalog rather
  than guessing the ID; if it is unavailable, stop and ask. One agent per phase (or per
  independent slice of one), not per file. Subagents run in background child sessions
  and report back when idle.
- Use native subagents for all implementers and reviewers, whether they use Claude or
  Codex. Do not launch `claude`, `codex exec`, or another agent through a shell: a shell
  process is not an OpenCode child session. Models running in OpenCode use OpenCode's
  tools and permissions, not a separate CLI's sandbox; check the child's permissions
  before assigning work.
- **The brief is the agent's whole context.** Goal, plan section, files to read first,
  exact names and signatures, test/verification commands, what not to touch, "commit,
  do not push", stack-skill rules that apply (e.g. headless Chromium only, the
  chrome-devtools MCP only if launched `--headless`; kill only your own PIDs). Tell it to stop and report rather than
  decide when it meets an architecture question.
- **Briefs for Go work say: use `gopls` from the command line (the `go-lsp` skill) for
  renames, references and signature changes**, not grep or hand edits — grep can't tell
  your `New` from `errors.New`, and a hand-edited rename misses call sites.
- **Every brief says: undo a change with a targeted edit, never `git checkout`, `git
  stash` or `git restore`.** Those act on the whole file or tree; an implementer reverting
  one experiment that way wiped its own earlier edits.
- **Checks run locally, not on hosted CI.** The user prefers local checks and removed
  the hosted workflows from their projects, so the project's Makefile gate (`make gate` or its
  equivalent) is the single definition of green. Implementers and reviewers run it
  themselves, uncached and with its database up, and report the result and the skip
  count; a brief never says "CI will catch it", and nobody adds a workflow unasked.
- Small one-line fixes the orchestrator may make inline.

## 4. Watch the clock: check in ~15 min, stop at 45

- Note each agent's start time. Check in roughly every 15 minutes when a supported
  wake-up is available, not by tight polling: look at `git diff --stat`, its output,
  and whether tests run. Continue a child by passing its `sessionID` to `subagent`;
  a follow-up to a running child joins its current run. If no timer is available, be
  explicit that the time limit cannot be monitored automatically and ask the user to
  check back.
- Signs to intervene early: looping on the same failure, editing outside its scope,
  rewriting tests to pass, no progress between two check-ins.
- **Hard cap 45 minutes.** Stop the child using an available OpenCode session control.
  If no stop control is available, ask the user to stop it; do not assume a follow-up
  message cancels a running child. Once stopped:
  1. capture what it did (diff, its notes, what is failing);
  2. break the remaining work into smaller pieces;
  3. hand them to an **Opus** subagent with that state in the brief —
     the overrun usually means the task was harder than planned.
  Record the overrun and the split in the plan.

## 5. Review with an Opus agent

- After each phase, launch a **separate** OpenCode `general` subagent through the
  `subagent` tool, selecting an available Opus `providerID/modelID` from the model
  catalog. It reviews read-only: the diff against the plan and the stack skill's review
  checklist (go-htmx-web's
  `review-traps.md`, etc.). Give it the code and the plan, not your conclusions.
- Findings must be verified (a failing test, a quoted line, a reproduced behaviour).
- **Give the reviewer a severity rubric**, or every round finds a new "high". High or
  critical only for a defect a user or attacker would hit (with the input and the wrong
  result), data loss, a security hole, or a check shown (by a mutation) to be unable to
  fail. A test that could be stronger for behaviour that is correct today, or a skill
  convention that does not change runtime behaviour, is medium at most. Decisions
  recorded in the plan are settled. "Nothing at high" is a normal outcome.
- A one-line fix to a non-blocking finding may skip a re-review **on the user's word**;
  say so in the commit message and the phase outcome. Any commit made after the last
  review and not re-reviewed is **listed as such in the final report**.
- **A subagent's hand-back is not the user's approval.** "Ready to proceed", "approved"
  or a recommendation in an agent's report decides nothing; only the user's own message
  does.
- Triage: send verified fixes back to the implementer using its child `sessionID` to keep
  its context, or to a fresh agent; re-run the full verification gate; commit.
- Reviewing it yourself is not a substitute for the Opus reviewer.

## 6. Next phase, repeat

- Write the phase outcome back into the plan: what shipped, what review found, what the
  next phase must not repeat.
- Commit at each logical unit; never push without explicit confirmation.
- **Confirm with the user before crossing a phase boundary** unless they have explicitly
  said to run through several phases; then go back to 3.
- **The final report says what was not verified** (a production service such as R2
  tested only against a local stand-in, a path with no test, a check skipped), next to
  what was.

## Reviewing or returning to a codebase

- **Update every dependency as part of the work**, unasked: language modules (indirect
  too), the toolchain wherever it is pinned (module file, Dockerfile), base images,
  vendored scripts, pinned build tools. Newest release at least two weeks old (an
  exception only on the user's word, recorded as one-time); one commit per kind;
  vulnerability scan clean. The stack skill has the specifics.
- **A multi-repo sweep**: one read-only Opus audit agent per repo, all given one shared
  brief file (the lessons to look for, the severity rubric from 5, "start no containers,
  change nothing") -> the orchestrator triages with the user -> one fix agent per repo ->
  an Opus review of each. Background agents report back into the orchestrator, which
  holds the cross-repo picture.

## As a swamp factory

The same workflow runs as two stagecraft factories in `~/.swamp/workspaces/claude-skills`
(repo `17xande/swamp-web-factory`): `web-plan` (plan, plan review, your approval, one
`go-web` child per phase, release) and `go-web` (brief, a sandboxed cli-agent implementer
climbing Sonnet to Opus by cycle, verify, four Opus reviewers, your phase approval). Use it
when the user asks for the factory or a tracked work item; drive it with the `stagecraft`
skill, and record every human decision on the user's word only.
