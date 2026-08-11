---
name: integrate
version: 0
---

# Integrate Analysis

Use the NKP matrix to derive the residual architecture. Apply fusion, fission, and criticality analysis. Prototype competing architectures if needed.

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

## Before Starting
Run: `residual skill-data integrate`

## During This Skill
- `residual add stressor ...` — add any newly discovered stressors
- `residual add iteration --notes "residual architecture: ..."` — record the integrated architecture
- `residual matrix ri --stressors N --naive-survived X --residual-survived Y`

## Version Check
Run `residual skill-check integrate --agent <your-agent>` before starting.
