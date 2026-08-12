---
name: integrate
version: 1
---

# Integrate Analysis

**Analytical lens (optional).** Derive residual architecture from the NKP matrix.

## Rules
- Examine **whole-system-residue** before defaulting to a software-only patch when recording new stressors.

## During This Skill
- `residual add stressor ... --whole-system --notes "hardware zig: ..."` when the surviving change leaves the software boundary
- `residual add stressor ...` for newly discovered stressors

## Before Starting
Run: `residual skill-data integrate`
