---
name: fmea
version: 1
---

# FMEA — Failure Mode and Effects Analysis

**Analytical lens (optional).** Walk failure modes once architecture is stable.

## Rules
- Examine **whole-system-residue** before defaulting to a software-only patch.

## During This Skill
- `residual add stressor ... --whole-system --notes "policy zig: ..."` when the surviving change leaves the software boundary
- Record findings in the current iteration markdown

## Before Starting
Run: `residual skill-data fmea`
