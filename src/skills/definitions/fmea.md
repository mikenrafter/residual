---
name: fmea
version: 1
---

# FMEA — Failure Mode and Effects Analysis

**Analytical lens (optional / a-la-carte).** Walk failure modes once architecture is stable — not a mandatory gate.

Walk each component through its failure modes once the architecture is stable. Catch technical issues before they become production incidents.

## Interaction Pattern
This skill is Socratic.
- **Gather freely**: read commands (`skill-data`, `matrix show`, etc.) run without asking.
- **Act only with approval**: any modification — recording findings to an iteration, `residual add stressor` — requires explicit user sign-off before executing.

## Process
For each component in the residual architecture:
1. **Failure mode**: how can this component fail?
2. **Effect**: what is the impact on the system and on each attractor?
3. **Severity**: qualitative — catastrophic / major / minor / negligible
4. **Detection**: how would this failure be detected?
5. **Mitigation**: what design or operational change reduces severity?

## Rules
- No probabilities. Severity is qualitative, not numeric.
- An inability to describe the failure mode of a component indicates a poorly defined component.
- FMEA is a test of architecture clarity, not a risk register.
- Examine **whole-system-residue** before defaulting to a software-only patch (hardware, process, organization, or policy zig).

## Before Starting
Run: `residual skill-data fmea`
This provides the current component list from the NKP matrix and the latest iteration.

## During This Skill
- Record findings by appending to the current iteration markdown
- If a failure mode reveals a new residue, add it: `residual add stressor ...`
- Prefer `residual add stressor ... --whole-system --notes "policy zig: ..."` when the surviving change leaves the software boundary
- `residual matrix show` — confirm components under analysis

## Version Check
Run `residual skill-check fmea --agent <your-agent>` before starting.
