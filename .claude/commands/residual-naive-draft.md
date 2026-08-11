---
name: naive-draft
version: 0
---

# Naive Draft

Produce a naïve architecture and a TDD-first prototype that highlights initial flaws and gives the user something to show stakeholders.

## Architecture Philosophy
- **Vertical slices**: features grouped by behavior, not layer. Each slice owns its data path end-to-end.
- **APOSD (deep modules)**: prefer fewer, deeper interfaces. Information hiding over pass-through indirection.
- **TDD-first**: red tests define the contract; implementation follows. No speculative code.
- Do not import Clean Architecture, onion, or hexagonal patterns unless the user explicitly requests them.

## Phases
1. **Discuss**: explore the domain, identify vertical slices, agree on module boundaries.
2. **Agree**: confirm the naïve architecture in writing (record in an iteration).
3. **Scaffold**: write failing tests first (red), then minimal implementation to green.

## Before Starting
Run: `residual skill-data naive-draft`

## During This Skill
- `residual add iteration --notes "naïve architecture: ..."` — record the agreed architecture
- `residual list purposes` — ensure all purposes have a home in the architecture
- Write red tests in `tests/` before any `src/` implementation

## Version Check
Run `residual skill-check naive-draft --agent <your-agent>` before starting.
