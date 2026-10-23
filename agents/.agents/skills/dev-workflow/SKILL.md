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
  "opus review", "orchestrate", "use your best judgement".
---

# Development workflow

The default for software work. A stack skill (go-htmx-web, web-to-ipad-port, ...) says
*what* good looks like; this one says *who does what, and when to stop*.

```
plan (Opus) -> switch to Sonnet -> per phase: implement (Sonnet/Codex agent)
            -> check in ~15 min, cap 45 min -> review (Opus agent) -> fix -> commit -> next phase
```

## 1. Plan with Opus

- The plan is written by Opus (the main session, on Opus). It is a phased plan in
  `~/.claude/plans/<name>.md`, outside the repo. Each phase is small enough for one agent
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
model with `/model sonnet` (Claude cannot switch its own model). The Sonnet session
orchestrates: it reads the plan, writes briefs, spawns and watches agents, triages
reviews, commits. It does not make architecture calls — those go back to the user (or to
an Opus agent when the user has granted best judgement, see 1).

## 3. Implement with agents

- **Default: Sonnet agents** — `Agent` with `model: "sonnet"`, run in the background.
  One agent per phase (or per independent slice of one), not per file.
- **When the user asks: Codex Sol agents** — run Codex non-interactively in the
  background:
  ```sh
  codex exec -m gpt-6.1-sol -s workspace-write -C <repo> \
    -o <scratchpad>/<phase>-result.md - < <scratchpad>/<phase>-brief.md
  ```
  (`gpt-6.1-sol` is the default in `~/.codex/config.toml`; check it there if it errors.)
  Run it with Bash `run_in_background`; read `-o` for its final report.
- **The brief is the agent's whole context.** Goal, plan section, files to read first,
  exact names and signatures, test/verification commands, what not to touch, "commit,
  do not push", stack-skill rules that apply (e.g. headless Chromium only, never the
  chrome-devtools MCP; kill only your own PIDs). Tell it to stop and report rather than
  decide when it meets an architecture question.
- Small one-line fixes the orchestrator may make inline.

## 4. Watch the clock: check in ~15 min, stop at 45

- Note each agent's start time. Check in roughly every 15 minutes (a `Monitor`/timer
  wake-up, not tight polling): look at `git diff --stat`, its output, whether tests run.
  A Sonnet agent can be asked for status with `SendMessage`.
- Signs to intervene early: looping on the same failure, editing outside its scope,
  rewriting tests to pass, no progress between two check-ins.
- **Hard cap 45 minutes.** Stop it (`TaskStop`, or kill the Codex PID you started), then:
  1. capture what it did (diff, its notes, what is failing);
  2. break the remaining work into smaller pieces;
  3. hand them to an **Opus** agent (`model: "opus"`) with that state in the brief —
     the overrun usually means the task was harder than planned.
  Record the overrun and the split in the plan.

## 5. Review with an Opus agent

- After each phase, a **separate** Opus agent (`model: "opus"`) reviews read-only: the
  diff against the plan and the stack skill's review checklist (go-htmx-web's
  `review-traps.md`, etc.). Give it the code and the plan, not your conclusions.
- Findings must be verified (a failing test, a quoted line, a reproduced behaviour).
- Triage: send verified fixes back to the implementer (`SendMessage` to keep its
  context) or a fresh agent; re-run the full verification gate; commit.
- Reviewing it yourself is not a substitute for the Opus reviewer.

## 6. Next phase, repeat

- Write the phase outcome back into the plan: what shipped, what review found, what the
  next phase must not repeat.
- Commit at each logical unit; never push without explicit confirmation.
- **Confirm with the user before crossing a phase boundary** unless they have explicitly
  said to run through several phases; then go back to 3.
