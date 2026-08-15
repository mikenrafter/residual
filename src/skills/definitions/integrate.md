---
name: integrate
version: 2
---

# Integrate Analysis

**Analytical lens (optional / a-la-carte).** Derive residual architecture from the NKP matrix — not a mandatory gate.

Use the NKP matrix to derive the residual architecture. Apply fusion, fission, and criticality analysis. Prototype competing architectures if needed.

## Interaction Pattern
This skill is Socratic.
- **Gather freely**: read commands (`skill data`, `matrix show`, `matrix fusion`, `matrix fission`, `matrix criticality`) run without asking.
- **Act only with approval**: any modification — `residual add stressor`, `add iteration`, `matrix ri` — requires explicit user sign-off before executing.

## Bootstrap Guard
Check `residual skill data integrate` for a **Bootstrap Required** section. If present, **halt** — the NKP matrix is computed from stressors and components; an empty or underspecified ledger produces a degenerate matrix with nothing to fuse, fission, or compare. Follow the bootstrapping steps in the skill data output before running any matrix commands.

## Process
1. Run `residual matrix show` — identify high-coupling components and hyperliminal pairs.
2. Run `residual matrix fusion` — find components safe to merge (identical stress patterns).
3. Run `residual matrix fission` — find components under excessive stress (candidates to split).
4. Run `residual matrix criticality` — assess N/K balance.
5. Propose a residual architecture. Record each change as a residue with its attractor reference.
6. If multiple viable architectures exist, offer to prototype each in a git worktree.
7. Run `residual matrix ri` after prototyping to compare survival rates.

## Rules
- Component decisions are driven by stress-response patterns, not functional similarity.
- A residue is not an implementation plan — it describes what must change for the architecture to survive a particular attractor.
- Criticality is the goal, not correctness.
- Examine **whole-system-residue** before defaulting to a software-only patch when recording new stressors.

## Before Starting
Run: `residual skill data integrate`

## During This Skill
- `residual add stressor ...` — add any newly discovered stressors
- Prefer `residual add stressor ... --whole-system --notes "hardware zig: ..."` when the surviving change leaves the software boundary
- `residual add iteration --notes "residual architecture: ..."` — record the integrated architecture
- `residual matrix ri --stressors N --naive-survived X --residual-survived Y`

## Version Check
Run `residual skill check-install integrate --agent <your-agent>` before starting.
