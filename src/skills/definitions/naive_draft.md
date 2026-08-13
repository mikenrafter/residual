---
name: naive-draft
version: 1
---

# Naive Draft

**Analytical lens (optional / a-la-carte).** Use when drafting a naïve architecture — not a mandatory gate.

Produce a naïve architecture and a TDD-first prototype that highlights initial flaws and gives the user something to show stakeholders.

## Interaction Pattern
This skill is Socratic.
- **Gather freely**: read commands (`skill-data`, `list`, `matrix show`, etc.) run without asking.
- **Act only with approval**: any modification — `residual add ...`, writing files, recording an iteration — requires explicit user sign-off before executing.

## Architecture Philosophy
- **Vertical slices**: features grouped by behavior, not layer. Each slice owns its data path end-to-end.
- **APOSD (deep modules)**: prefer fewer, deeper interfaces. Information hiding over pass-through indirection.
- **TDD-first**: red tests define the contract; implementation follows. No speculative code.
- Do not import Clean Architecture, onion, or hexagonal patterns unless the user explicitly requests them.

## Phases
1. **Discuss**: Explore the domain with the user. Surface candidate vertical slices and module boundaries. Present your analysis and invite correction. Do not proceed until the user confirms the slice boundaries.
2. **Agree**: Draft the iteration notes and show them to the user. Wait for explicit approval before running `residual add iteration`.
3. **Scaffold**: Propose each failing test before writing it. After the user agrees on the test suite shape, write tests first, then minimal implementation to green.

## Before Starting
Run: `residual skill-data naive-draft`

## During This Skill
- `residual list purposes` — share the list with the user; confirm every purpose has a home in the agreed architecture
- `residual add iteration --notes "naïve architecture: ..."` — only after user approves the draft notes
- Write red tests in `tests/` before any `src/` implementation

## Version Check
Run `residual skill-check naive-draft --agent <your-agent>` before starting.
