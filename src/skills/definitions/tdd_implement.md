---
name: tdd-implement
version: 0
description: >-
  Commit first, then orchestrate R/G TDD with subagents: first subagent writes all
  failing (red) tests, parent verifies, subsequent subagents implement phase-by-phase
  with prior-phase context, parent verifies between phases and passes pointers, final
  verification before handoff. Use when implementing features, refactors, or bug fixes
  with tests; when the user says r/g-tdd, red/green TDD, rg-implement, or multi-phase
  implementation with subagents.
---

# tdd-implement

Commit first. r/g-tdd with subagents — the first subagent makes all red, you verify, the 2..nth use r/g-tdd per phase and receive context about what the prior agents have done in order to keep on track, you verify between each phase and pass pointers as you see fit to subagents, then you do one final verification at the end before handoff.

## Workflow

```
Progress:
- [ ] 0. Commit first (baseline before any test or implementation work)
- [ ] 1. Subagent 1 — all red tests
- [ ] 2. Parent verify — tests fail for the right reasons
- [ ] 3. Subagent 2..n — R/G TDD per phase (with prior-phase context)
- [ ] 4. Parent verify between each phase; pass pointers to next subagent
- [ ] 5. Final verification before handoff
```

### 0. Commit first

Before spawning subagents or writing tests, commit the current working state so red
tests and implementation land on a clean baseline.

### 1. Subagent 1 — all red

Launch one subagent whose **only** job is to write failing tests for the full scope.
No implementation. Tests must fail for the intended missing behavior, not import/syntax errors.

### 2. Parent verify (red gate)

Run the test suite. Confirm:
- Tests fail (red)
- Failures match the intended contract gaps
- No spurious greens or broken harness

Only then proceed to implementation phases.

### 3. Subagent 2..n — R/G per phase

For each implementation phase:
1. Launch a subagent with **context from prior phases** (what was done, what remains, file pointers)
2. Subagent follows R/G TDD for **that phase only**: minimal code to go green, no scope creep
3. Parent verifies between phases before launching the next

### 4. Passing pointers

Between phases, give the next subagent:
- Summary of completed work
- Relevant file paths and function names
- Remaining phases / open failures
- Constraints or decisions made in earlier phases

### 5. Final verification

Before handoff:
- Full test suite green
- No unrelated regressions
- Scope matches original request
- Lints clean on touched files

## Subagent launch template

```
Task: Phase N of tdd-implement for [feature/bug].

Prior context:
- [what subagents 1..N-1 did]
- Files: [paths]
- Decisions: [constraints]

This phase:
- [specific R/G scope]
- Run: [test command]
- Stop when: [phase pass criteria]
```

## Anti-patterns

- Skipping commit-first — red tests mixed with unrelated WIP
- Subagent 1 implementing code — defeats the all-red gate
- Launching phase N without parent verify on phase N-1
- Passing subagents the full chat instead of distilled pointers
- Declaring done without final full-suite verification
