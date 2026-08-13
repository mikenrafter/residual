---
name: stressor-walk
version: 1
---

# Stressor Walk

**Analytical lens (optional / a-la-carte).** Record stressors mid-session without phase ceremony — personas welcome, not a hard gate.

Socratically discover stressors and attractors by simulating the business environment — no probabilities, no consensus required.

## Interaction Pattern
This skill is Socratic.
- **Gather freely**: read commands (`skill-data`, `list`, `matrix show`, etc.) run without asking.
- **Act only with approval**: any modification — `residual add stressor`, `add attractor`, `add term`, `add persona` — requires explicit user sign-off before executing.

## Rules
- A stressor does not need to be likely. It only needs a coherent narrative describing how the system moves to a different attractor.
- Attractors are recurring states — positive (desired) or negative (survived).
- Trace information flows, not use cases or happy paths.
- For each persona loaded, voice their concerns as that persona before returning to architect mode.
- Watch for hyperliminal coupling: when a stressor affects two components that were not expected to be related.
- Examine **whole-system-residue** before defaulting to a software-only patch (hardware, process, organization, or policy zig).

## Before Starting
Run: `residual skill-data stressor-walk`
This provides current personas, attractors, and the naïve architecture.

## During This Skill
- `residual add stressor --description "..." --attractor-id A-01 --naive-change "..." --components "C1,C2"`
- Prefer `--whole-system --notes "policy zig: ..."` when the surviving change leaves the software boundary
- `residual add attractor --name "..." --positive-state "..." --negative-state "..." --description "..."`
- `residual add term --term "..." --definition "..."`
- `residual add persona --name "..." --role "..." --concerns "..."`
- `residual matrix show` — periodically check for emerging coupling patterns

## Version Check
Run `residual skill-check stressor-walk --agent <your-agent>` before starting.
