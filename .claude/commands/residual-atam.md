---
name: atam
version: 0
---

# ATAM — Architecture Trade-off Analysis

Surface political, cost, and business stakeholder concerns against the candidate architecture before it is built.

## Process
1. Load all personas. Voice each persona's concerns about the current architecture.
2. Identify quality attribute scenarios (performance, security, modifiability, availability) relevant to each persona.
3. For each scenario: which architectural decisions support it? Which trade against it?
4. Identify sensitivity points (decisions that strongly affect one quality attribute) and trade-off points (decisions that affect multiple quality attributes in opposing directions).
5. Document risks: architectural decisions that may fail to satisfy a quality attribute in some attractor.

## Rules
- No probabilities. Risks are architectural decisions that may not survive an attractor — not likelihood estimates.
- A trade-off is not a problem to solve; it is a decision to make consciously.
- Personas define the political boundary. Technical decisions that ignore persona concerns will fail in deployment.

## Before Starting
Run: `residual skill-data atam`
This provides personas, attractors, and the current architecture iteration.

## During This Skill
- Record trade-off findings in the current iteration markdown
- `residual list attractors` — use attractors as the context for each quality attribute scenario
- `residual add persona ...` — add any stakeholder voices not yet captured

## Version Check
Run `residual skill-check atam --agent <your-agent>` before starting.
