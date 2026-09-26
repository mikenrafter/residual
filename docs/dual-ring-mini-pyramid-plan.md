# Dual-ring mini-pyramid landscape plan

Referentiable plan for the purpose/stressor dual-ring redesign on `view-landscape`
(baseline `a6bb1fc`). Implement without subagents; red contracts live in:

- `web/src/landscape-triangular-lattice.test.ts` (dual-ring describes)
- `web/src/landscape-geometry.test.ts` (annulus spiral helpers)
- `web/src/nkp-hypergraph.test.ts` (integration; dual-ring zone/bundling contracts)

## Status

Implemented (lattice + geometry + hypergraph wiring + `web/generated/app.js`).

## Radial stack (center → out)

1. **Purpose ring** — mini-pyramids, apex inward, base facing components
2. **Inner annulus**
3. **Component band** — fixed **3-hop** thickness; grow only if components won’t fit or outer ring needs room
4. **Outer annulus** — minimize
5. **Stressor ring** — mini-pyramids, apex outward, base facing components

## Per attractor

- Split into purpose + stressor mini-pyramids (same color)
- One convex hull over all forces; paint **below** components
- No per-subshape hulls
- Shared center ray through both tops (virtual OK); snap each top to nearest / ≤1 lattice step off
- Gap **0** between neighbors on a ring
- Missing purpose → **2-wide** empty placeholder on purpose ring; missing stressor → same on stressor ring

## Mini-pyramid growth (`miniPyramidLayersForCount`)

Tall-before-wide / minimal base:

`1 → 2 → 2:1 → 3:1 → 3:2 → 3:2:1 → 4:2:1 → 4:3:1 → 4:3:2 → 4:3:2:1 → …`

Complete when layers equal `[h, h-1, …, 1]`. Otherwise fill lowest underfull row (`base - i`); if all full and not complete, push apex `1`; if complete, expand base.

Subshapes = **one per layer** (never triangles). Assign forces to layers by similarity.

## Components

- Seed on **dominant attractor** ray, middle of 3-hop band (2nd from outer edge)
- Component charge/collision at **25%** of prior (`-1400` → `-350`)
- Force→component link / attractor pressures also **25%**

## Bundling

- Purpose: `component → inner-annulus mid → layer approach → force`
- Stressor: `component → outer-annulus mid → layer approach → force`
- **Long arc** iff a more direct route would enter the **wrong** annulus
- Long arc: depart along tangent to correct annulus **±10°** (CW/CCW), enter that annulus, spiral, then split
- Short hops: near-radial into the correct mid

## Primary files

- `web/src/landscape-triangular-lattice.ts` — mini growth, layer partition, dual-ring packer, ray snap, radial stack
- `web/src/landscape-geometry.ts` — `shouldUseLongAnnulusArc`, `dualRingMembershipGeometry`, `longAnnulusArcPath`
- `web/src/nkp-hypergraph.ts` — zones, hull z-order, pressures, seeding, bundling
- `scripts/gen-view-bundle.sh` — regenerate `web/generated/app.js`

## Lock / lattice toggle

Keep current lock-default and lattice-toggle behavior unless packing conflicts.
