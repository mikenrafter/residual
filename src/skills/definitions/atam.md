---
name: atam
version: 1
---

# ATAM — Architecture Trade-off Analysis

**Analytical lens (optional / a-la-carte).** Invoke when stakeholder trade-offs matter — not a mandatory gate in the skill sequence.

Surface political, cost, and business stakeholder concerns against the candidate architecture before it is built.

## Interaction Pattern
This skill is Socratic.
- **Gather freely**: read commands (`skill-data`, `list attractors`, `list personas`, etc.) run without asking.
- **Act only with approval**: any modification — recording findings to an iteration, `residual add persona` — requires explicit user sign-off before executing.

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
