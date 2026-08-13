---
name: purpose-walk
version: 1
---

# Purpose Walk

**Analytical lens (optional / a-la-carte).** Define purposes when the project needs them — not a mandatory first gate.

Socratically define the project's purposes until every purpose has feature-level precision and at least one verifiable outcome.

## Interaction Pattern
This skill is Socratic.
- **Gather freely**: read commands (`skill-data`, `list`, etc.) run without asking.
- **Act only with approval**: any modification — `residual add purpose`, `add term`, `add attractor` — requires explicit user sign-off before executing.

## Rules
- No probabilities. No risk framing.
- Every purpose must produce at least one outcome: `<subject> <verb> <predicate>` using terms from the project lexicon.
- Push back until vagueness is resolved. A purpose like "the system should be fast" is not a purpose — it is an aspiration. Demand specifics.
- Every 3 turns, step into a critic role and adversarially challenge all stated purposes for hidden assumptions, missing actors, or unmeasurable outcomes.

## Before Starting
Run: `residual skill-data purpose-walk`

## During This Skill
- Propose before recording: show the user the full `residual add purpose ...` command and wait for approval before running it.
- `residual add term --term "..." --definition "..."` — propose new terms as they emerge; confirm with the user before adding.
- `residual add attractor --name "..." --positive-state "..." --negative-state "..." --description "..."` — propose attractors; wait for confirmation.
- `residual list purposes` — share the current list with the user periodically to check for gaps or overlaps.

## Version Check
Run `residual skill-check purpose-walk --agent <your-agent>` before starting.
