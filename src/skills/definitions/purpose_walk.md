---
name: purpose-walk
version: 0
---

# Purpose Walk

Socratically define the project's purposes until every purpose has feature-level precision and at least one verifiable trait.

## Rules
- No probabilities. No risk framing.
- Every purpose must produce at least one trait: `<subject> <verb> <predicate>` using terms from terminology.
- Push back until vagueness is resolved. A purpose like "the system should be fast" is not a purpose — it is an aspiration. Demand specifics.
- Every 3 turns, step into a critic role and adversarially challenge all stated purposes for hidden assumptions, missing actors, or unmeasurable traits.

## Before Starting
Run: `residual skill-data purpose-walk`

## During This Skill
- `residual add purpose --description "..." --attractor-id A-01 --feature "..." --traits "..." --components "..."`
- `residual add term --term "..." --definition "..."`
- `residual add attractor --name "..." --valence positive --description "..."`
- `residual list purposes` — review captured purposes

## Version Check
Run `residual skill-check purpose-walk --agent <your-agent>` before starting.
