import type { Point } from "./landscape-geometry";
import {
  convexHullPoints,
  pointAtDistanceFrom,
  rayConvexPolygonIntersection,
} from "./landscape-geometry";

export interface AxialPoint {
  q: number;
  r: number;
}

/** Shared with requirement 3's REGIONS_TRI_LATTICE_SPACING. */
export const TRI_LATTICE_SPACING = 60;

/** The 6 unit offsets to a pointy-top hex's neighbors, in ring-walk order. */
export const AXIAL_NEIGHBORS: readonly AxialPoint[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function axialToPixel(
  point: AxialPoint,
  spacing = TRI_LATTICE_SPACING,
  origin: Point = { x: 0, y: 0 },
): Point {
  // Pointy-top triangular lattice; `spacing` is the centre-to-centre distance
  // between adjacent points (not the hex "size"/centre-to-vertex).
  return {
    x: origin.x + spacing * (point.q + point.r / 2),
    y: origin.y + spacing * ((Math.sqrt(3) / 2) * point.r),
  };
}

function axialRound(frac: { q: number; r: number }): AxialPoint {
  const x = frac.q;
  const z = frac.r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

export function pixelToAxial(
  point: Point,
  spacing = TRI_LATTICE_SPACING,
  origin: Point = { x: 0, y: 0 },
): AxialPoint {
  return axialRound(pixelToFractionalAxial(point, spacing, origin));
}

/** Unrounded axial coordinates — used for hop-threshold comparisons. */
export function pixelToFractionalAxial(
  point: Point,
  spacing = TRI_LATTICE_SPACING,
  origin: Point = { x: 0, y: 0 },
): AxialPoint {
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  const r = ((2 / Math.sqrt(3)) * y) / spacing;
  const q = x / spacing - r / 2;
  return { q, r };
}

/**
 * Cube Chebyshev distance that accepts fractional axial coords (same formula
 * as axialDistance; exported separately so hop callers stay explicit).
 */
export function axialFracDistance(a: AxialPoint, b: AxialPoint): number {
  return axialDistance(a, b);
}

/** Fraction of a cell a node must drift before it hops (0.5 = halfway). */
export const LATTICE_HOP_THRESHOLD = 0.55;

/**
 * Unit axial step from integer cell `from` toward fractional `toward`.
 * Picks the neighbor of `from` closest to `toward`, or null when `toward`
 * is already nearest to `from` (no productive hop).
 */
export function axialHopStep(from: AxialPoint, toward: AxialPoint): AxialPoint | null {
  const stayDist = axialFracDistance(from, toward);
  let best: AxialPoint | null = null;
  let bestDist = stayDist;
  for (const neighbor of AXIAL_NEIGHBORS) {
    const candidate = { q: from.q + neighbor.q, r: from.r + neighbor.r };
    const distance = axialFracDistance(candidate, toward);
    if (distance + 1e-9 < bestDist) {
      bestDist = distance;
      best = { ...neighbor };
    }
  }
  return best;
}

/** Cube-coordinate Chebyshev distance between two axial points. */
export function axialDistance(a: AxialPoint, b: AxialPoint): number {
  const aq = a.q;
  const ar = a.r;
  const as = -aq - ar;
  const bq = b.q;
  const br = b.r;
  const bs = -bq - br;
  return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
}

export function axialKey(point: AxialPoint): string {
  return `${point.q}:${point.r}`;
}

/** Cells of `cells` plus every axial neighbor — one lattice layer out. */
export function dilateAxialOneLayer(cells: readonly AxialPoint[]): AxialPoint[] {
  const seen = new Set<string>();
  const out: AxialPoint[] = [];
  const add = (cell: AxialPoint): void => {
    const key = axialKey(cell);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ q: cell.q, r: cell.r });
  };
  for (const cell of cells) {
    add(cell);
    for (const neighbor of AXIAL_NEIGHBORS) {
      add({ q: cell.q + neighbor.q, r: cell.r + neighbor.r });
    }
  }
  return out;
}

/**
 * Split point for the final nested-bundle fan: intersection of the ray from
 * `fromOutside` toward the sub-shape centroid with the convex hull of the
 * sub-shape dilated by one lattice layer. Falls back to one spacing hop from
 * the centroid when the ray misses (degenerate/coincident cases).
 */
export function dilatedSubshapeApproach(
  forces: readonly Point[],
  fromOutside: Point,
  spacing = TRI_LATTICE_SPACING,
  origin: Point = { x: 0, y: 0 },
): Point {
  const finite = forces.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finite.length === 0) return { x: fromOutside.x, y: fromOutside.y };
  const hub = {
    x: finite.reduce((sum, point) => sum + point.x, 0) / finite.length,
    y: finite.reduce((sum, point) => sum + point.y, 0) / finite.length,
  };
  const cellKeys = new Set<string>();
  const cells: AxialPoint[] = [];
  for (const point of finite) {
    const cell = pixelToAxial(point, spacing, origin);
    const key = axialKey(cell);
    if (cellKeys.has(key)) continue;
    cellKeys.add(key);
    cells.push(cell);
  }
  const dilated = dilateAxialOneLayer(cells);
  const hull = convexHullPoints(dilated.map((cell) => axialToPixel(cell, spacing, origin)));
  const hit = rayConvexPolygonIntersection(fromOutside, hub, hull);
  if (hit) return hit;
  return pointAtDistanceFrom(hub, fromOutside, spacing);
}

/** Rotate `point` by `steps` × 60° clockwise around the axial origin. */
export function rotateAxial(point: AxialPoint, steps: number): AxialPoint {
  let q = point.q;
  let r = point.r;
  const turns = ((steps % 6) + 6) % 6;
  for (let i = 0; i < turns; i += 1) {
    const nextQ = -r;
    const nextR = q + r;
    q = nextQ;
    r = nextR;
  }
  return { q, r };
}

/**
 * Rotate every offset around the integer centroid of the offset set by
 * `steps` × 60°, then re-base so the lexicographically least cell is at
 * (0,0) relative to a new translation corner. Returns the corner delta
 * relative to the old offset space (add to the old translation).
 */
export function rotateAxialOffsets(
  offsets: ReadonlyMap<string, AxialPoint>,
  steps: number,
): { corner: AxialPoint; offsets: Map<string, AxialPoint> } {
  if (offsets.size === 0) {
    return { corner: { q: 0, r: 0 }, offsets: new Map() };
  }
  const entries = [...offsets.entries()];
  const sum = entries.reduce(
    (acc, [, point]) => ({ q: acc.q + point.q, r: acc.r + point.r }),
    { q: 0, r: 0 },
  );
  const centroid = {
    q: Math.round(sum.q / entries.length),
    r: Math.round(sum.r / entries.length),
  };
  const rotatedAbs = entries.map(([id, point]) => {
    const relative = { q: point.q - centroid.q, r: point.r - centroid.r };
    const spun = rotateAxial(relative, steps);
    return { id, axial: { q: spun.q + centroid.q, r: spun.r + centroid.r } };
  });
  const corner = [...rotatedAbs.map((item) => item.axial)]
    .sort((a, b) => a.q - b.q || a.r - b.r)[0]!;
  const next = new Map<string, AxialPoint>();
  for (const item of rotatedAbs) {
    next.set(item.id, { q: item.axial.q - corner.q, r: item.axial.r - corner.r });
  }
  return { corner, offsets: next };
}

/** All axial points at exactly `radius` hex-steps from `center` (empty for radius 0 excluded — returns [center]). */
export function axialRing(center: AxialPoint, radius: number): AxialPoint[] {
  if (radius === 0) return [center];
  const results: AxialPoint[] = [];
  let hex: AxialPoint = {
    q: center.q + AXIAL_NEIGHBORS[4]!.q * radius,
    r: center.r + AXIAL_NEIGHBORS[4]!.r * radius,
  };
  for (let side = 0; side < 6; side += 1) {
    for (let step = 0; step < radius; step += 1) {
      results.push(hex);
      const dir = AXIAL_NEIGHBORS[side]!;
      hex = { q: hex.q + dir.q, r: hex.r + dir.r };
    }
  }
  return results;
}

/**
 * True when `layers` is a complete mini frustum `[h, h-1, …, 1]`.
 */
export function isCompleteMiniPyramidStage(layers: readonly number[]): boolean {
  const h = layers[0];
  if (h === undefined || layers.length !== h) return false;
  for (let i = 0; i < h; i += 1) {
    if (layers[i] !== h - i) return false;
  }
  return true;
}

/**
 * Shortest strictly-descending frustum for dual-ring packing. The base is
 * the smallest b with b·(b+1)/2 >= n; within that base, use the fewest
 * layers whose widths sum to n.
 */
export function miniPyramidLayersForCount(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.ceil((Math.sqrt(8 * n + 1) - 1) / 2);

  const find = (height: number, index: number, previous: number, remaining: number): number[] | undefined => {
    if (index === height) return remaining === 0 ? [] : undefined;
    const slotsLeft = height - index - 1;
    const minimumTail = (slotsLeft * (slotsLeft + 1)) / 2;
    for (let width = Math.min(previous - 1, remaining); width >= 1; width -= 1) {
      const after = remaining - width;
      if (after < minimumTail) continue;
      const tail = find(height, index + 1, width, after);
      if (tail) return [width, ...tail];
    }
    return undefined;
  };

  for (let height = 1; height <= base; height += 1) {
    const tail = find(height, 1, base, n - base);
    if (tail) return [base, ...tail];
  }
  return [base];
}

/** The smallest even number of horizontal spaces that can hold `width` cells. */
export function evenHorizontalWidth(width: number): number {
  const nonNegativeWidth = Math.max(0, width);
  return nonNegativeWidth + (nonNegativeWidth % 2);
}

/**
 * Local cells for a mini-pyramid frustum. `q` is the horizontal cell position
 * within a vertical layer, and `r` is the vertical layer position. A caller
 * later re-bases these positions at a ring slot and radial layer.
 *
 * The horizontal footprint is always even. The default fill is right-aligned;
 * callers can mirror a pyramid into the same even-width footprint with
 * `horizontalFill: "right-to-left"`.
 *   horizontal q →  0 1 2 3
 *   vertical r = 0  . A A A   (width 3, footprint 4)
 *   vertical r = 1  . . A A   (width 2, footprint 4)
 *   vertical r = 2  . . . A   (width 1, footprint 4)
 */
export function miniPyramidCellsForLayers(
  layers: readonly number[],
  orientation: {
    apexToward: "center" | "outward";
    horizontalFill?: "left-to-right" | "right-to-left";
  } = { apexToward: "outward" },
): AxialPoint[] {
  const cells: AxialPoint[] = [];
  if (layers.length === 0) return cells;
  const last = layers.length - 1;
  const horizontalFootprint = evenHorizontalWidth(layers[0]!);
  for (let i = 0; i < layers.length; i += 1) {
    const width = layers[i]!;
    const r = orientation.apexToward === "outward" ? i : last - i;
    const fillDirection = orientation.horizontalFill ?? "left-to-right";
    const qOffset = fillDirection === "right-to-left" ? 0 : horizontalFootprint - width;
    if (fillDirection === "right-to-left") {
      for (let q = width - 1; q >= 0; q -= 1) {
        cells.push({ q: qOffset + q, r });
      }
    } else {
      for (let q = 0; q < width; q += 1) {
        cells.push({ q: qOffset + q, r });
      }
    }
  }
  return cells;
}

export interface MiniPyramidLayerSubshape {
  kind: "pill" | "layer";
  cells: AxialPoint[];
  layerIndex: number;
}

/** One subshape per layer — never triangles. */
export function partitionMiniPyramidLayers(layers: readonly number[]): MiniPyramidLayerSubshape[] {
  const cells = miniPyramidCellsForLayers(layers, { apexToward: "outward" });
  const byR = new Map<number, AxialPoint[]>();
  for (const cell of cells) {
    const row = byR.get(cell.r) ?? [];
    row.push(cell);
    byR.set(cell.r, row);
  }
  return layers.map((width, layerIndex) => {
    const row = (byR.get(layerIndex) ?? []).sort((a, b) => a.q - b.q);
    return {
      kind: "layer" as const,
      cells: row.slice(0, width),
      layerIndex,
    };
  });
}

/** Assign forces into layer bins by similarity (same heuristic as assignForcesToSubShapes). */
export function assignForcesToMiniPyramidLayers(
  forces: readonly SimilarityForce[],
  layers: readonly number[],
): string[][] {
  return assignForcesToSubShapes(forces, layers);
}

/** Circumference slots: sum of bases + optional empty placeholders (gapNodes default 0). */
export function dualRingSlotsForMiniPyramids(
  baseWidths: readonly number[],
  options: { gapNodes?: number; emptyPlaceholderSlots?: number } = {},
): number {
  const gapNodes = options.gapNodes ?? 0;
  const emptyPlaceholderSlots = options.emptyPlaceholderSlots ?? 0;
  const bases = baseWidths.reduce((sum, width) => sum + evenHorizontalWidth(width), 0);
  return bases + gapNodes * Math.max(0, baseWidths.length) + emptyPlaceholderSlots;
}

export interface DualRingMiniPyramidLayout {
  targets: Map<string, AxialPoint>;
  purposeSubShapesByAttractor: Map<string, string[][]>;
  stressorSubShapesByAttractor: Map<string, string[][]>;
  purposeSlotOccupancy: boolean[];
  stressorSlotOccupancy: boolean[];
}

/**
 * Places each attractor's purpose forces on `purposeRing` and stressor forces
 * on `stressorRing`, evenly spaced, gap 0. Missing kinds reserve 2 free slots.
 */
export function layoutAttractorDualRingMiniPyramids(
  groups: readonly ForceShapeGroup[],
  rings: {
    purposeRing: number;
    stressorRing: number;
    /** Angular slot count for the purpose ring — that zone's own pyramidal needs, not `6 × ring`. */
    purposeCellCount: number;
    /** Angular slot count for the stressor ring — that zone's own pyramidal needs, not `6 × ring`. */
    stressorCellCount: number;
  },
): DualRingMiniPyramidLayout {
  const targets = new Map<string, AxialPoint>();
  const purposeSubShapesByAttractor = new Map<string, string[][]>();
  const stressorSubShapesByAttractor = new Map<string, string[][]>();
  const purposeCount = Math.max(1, rings.purposeCellCount);
  const stressorCount = Math.max(1, rings.stressorCellCount);
  const purposeOcc = Array.from({ length: purposeCount }, () => false);
  const stressorOcc = Array.from({ length: stressorCount }, () => false);
  const n = Math.max(1, groups.length);
  const occupiedKeys = new Set<string>();

  groups.forEach((group, groupIndex) => {
    const purposes = group.forces.filter((f) => f.kind === "purpose");
    const stressors = group.forces.filter((f) => f.kind === "stressor");
    const purposeSlot = Math.round((groupIndex * purposeCount) / n) % purposeCount;
    const stressorSlot = Math.round((groupIndex * stressorCount) / n) % stressorCount;

    const placeOnRing = (
      kindForces: SimilarityForce[],
      ring: number,
      slotCount: number,
      startSlot: number,
      apexToward: "center" | "outward",
      occupancy: boolean[],
    ): string[][] => {
      if (kindForces.length === 0) {
        // 2-wide placeholder: leave consecutive slots unmarked (free).
        return [];
      }
      const layers = miniPyramidLayersForCount(kindForces.length);
      const localCells = miniPyramidCellsForLayers(layers, {
        apexToward,
        horizontalFill: apexToward === "center" ? "right-to-left" : "left-to-right",
      });
      const layerWidths = [...layers];
      const baseWidth = evenHorizontalWidth(layerWidths[0] ?? 1);
      const last = Math.max(0, layers.length - 1);
      let cursor = startSlot;

      // The base is anchored at the zone's fixed radial ring. The apex
      // recedes toward the far side by this pyramid's own vertical height.
      // A local horizontal q position is a direct angular slot offset.
      const absoluteFor = (local: AxialPoint, cursorSlot: number): AxialPoint => {
        const ringIndex = apexToward === "outward"
          ? ring + local.r
          : Math.max(1, ring - (last - local.r));
        const slot = ((cursorSlot + local.q) % slotCount + slotCount) % slotCount;
        return { q: slot, r: ringIndex };
      };

      const baseFootprintFor = (cursorSlot: number): AxialPoint[] =>
        Array.from({ length: baseWidth }, (_, i) => ({
          q: ((cursorSlot + i) % slotCount + slotCount) % slotCount,
          r: ring,
        }));

      let placed: AxialPoint[] | undefined;
      for (let attempt = 0; attempt < slotCount; attempt += 1) {
        const abs = localCells.map((local) => absoluteFor(local, cursor));
        const footprint = baseFootprintFor(cursor);
        if ([...abs, ...footprint].every((cell) => !occupiedKeys.has(axialKey(cell)))) {
          placed = abs;
          break;
        }
        cursor = (cursor + 1) % slotCount;
      }
      if (!placed) placed = localCells.map((local) => absoluteFor(local, cursor));

      for (let i = 0; i < baseWidth; i += 1) occupancy[(cursor + i) % slotCount] = true;
      for (const cell of placed) occupiedKeys.add(axialKey(cell));
      for (const cell of baseFootprintFor(cursor)) occupiedKeys.add(axialKey(cell));

      // Keep the stable base-to-apex bin order for grouping/dragging; map
      // those bins onto the corresponding wide-to-short row positions below.
      const bins = assignForcesToMiniPyramidLayers(kindForces, layers);
      const localsByLayer = layerWidths.map((_, i) => {
        const expectedR = apexToward === "outward" ? i : last - i;
        return localCells.filter((c) => c.r === expectedR);
      });
      bins.forEach((forceIds, layerIndex) => {
        const layerLocals = localsByLayer[layerIndex] ?? [];
        forceIds.forEach((id, fi) => {
          const local = layerLocals[Math.min(fi, Math.max(0, layerLocals.length - 1))];
          if (!local) return;
          const absIndex = localCells.findIndex((c) => c.q === local.q && c.r === local.r);
          targets.set(id, placed![absIndex] ?? placed![0]!);
        });
      });
      return bins;
    };

    purposeSubShapesByAttractor.set(
      group.attractorId,
      placeOnRing(purposes, rings.purposeRing, purposeCount, purposeSlot, "center", purposeOcc),
    );
    stressorSubShapesByAttractor.set(
      group.attractorId,
      placeOnRing(stressors, rings.stressorRing, stressorCount, stressorSlot, "outward", stressorOcc),
    );
  });

  return {
    targets,
    purposeSubShapesByAttractor,
    stressorSubShapesByAttractor,
    purposeSlotOccupancy: purposeOcc,
    stressorSlotOccupancy: stressorOcc,
  };
}

export interface DualRingRadialStack {
  purposeRingRadius: number;
  purposeRingAxial: number;
  purposeAngularSteps: number;
  innerAnnulus: { inner: number; outer: number; hops: number };
  /** First axial ring of the component band (inclusive). */
  componentInnerAxial: number;
  /** Last axial ring of the component band (inclusive). */
  componentOuterAxial: number;
  componentBand: { inner: number; outer: number; hops: number };
  componentAngularSteps: number;
  outerAnnulus: { inner: number; outer: number; hops: number };
  /** Inner edge of the stressor ring — the shared boundary with the outer annulus. */
  stressorRingRadius: number;
  /** First (innermost) axial ring of the stressor band. */
  stressorRingAxial: number;
  /** Last (outermost) axial ring of the stressor band — reaches the tallest stressor pyramid + 3 hops. */
  stressorRingOuterAxial: number;
  /** Outer edge of the stressor ring — the outer edge of the whole graph. */
  stressorRingOuterRadius: number;
  stressorAngularSteps: number;
}

/**
 * Pixel radii + axial ring indices for the dual-ring stack. Every zone's
 * radial reach follows the shared lattice scale, with half-height purpose
 * layers in the inner area. Angular step counts are tracked separately per
 * zone and never grow a zone's radius. Boundaries are shared between adjacent
 * zones (no gaps):
 * purpose | inner annulus (2 hops) | components (3 hops) | outer annulus
 * (≥2 hops) | stressors (tallest stressor pyramid + 3 hops).
 */
export function dualRingRadialStack(input: {
  purposeBaseWidths: readonly number[];
  /** Per-attractor purpose frustum heights (`miniPyramidLayersForCount(count).length`). */
  purposeHeights: readonly number[];
  stressorBaseWidths: readonly number[];
  /** Per-attractor stressor frustum heights (`miniPyramidLayersForCount(count).length`). */
  stressorHeights: readonly number[];
  spacing?: number;
}): DualRingRadialStack {
  const spacing = input.spacing ?? TRI_LATTICE_SPACING;
  const purposeSlotsNeeded = Math.max(1, dualRingSlotsForMiniPyramids(input.purposeBaseWidths, { gapNodes: 0 }));
  const stressorSlotsNeeded = Math.max(1, dualRingSlotsForMiniPyramids(input.stressorBaseWidths, { gapNodes: 0 }));

  // The purpose disc reaches out exactly as far as its own pyramidal needs.
  // Purpose cells are half-height, so double only the radial layer count.
  // Pyramid layer generation and angular slot counts remain unchanged.
  const purposeHeight = Math.max(1, ...input.purposeHeights);
  const purposeRingAxial = purposeHeight * PURPOSE_VERTICAL_LAYER_SCALE;
  const innerAnnulusHops = 2;
  const componentHops = 3;
  const outerAnnulusHops = 2;
  // Tallest stressor pyramid (base to apex) plus 3 more hops of outward reach.
  const stressorHopsTall = Math.max(1, ...input.stressorHeights) + 3;

  const componentInnerAxial = purposeRingAxial + innerAnnulusHops;
  const componentOuterAxial = componentInnerAxial + componentHops - 1;
  const stressorRingAxial = componentOuterAxial + outerAnnulusHops;
  const stressorRingOuterAxial = stressorRingAxial + stressorHopsTall - 1;

  // Purpose radial layers advance at half spacing. The doubled layer count
  // keeps the purpose ring at the same physical radius as the other zones.
  const purposeRingRadius = purposeRingAxial * spacing * PURPOSE_LATTICE_HEIGHT_SCALE;
  const innerAnnulusInner = purposeRingRadius;
  const innerAnnulusOuter = innerAnnulusInner + innerAnnulusHops * spacing;
  const componentInner = innerAnnulusOuter;
  const componentOuter = componentInner + componentHops * spacing;
  const outerAnnulusInner = componentOuter;
  const outerAnnulusOuter = outerAnnulusInner + outerAnnulusHops * spacing;
  const stressorRingRadius = outerAnnulusOuter;
  const stressorRingOuterRadius = stressorRingRadius + stressorHopsTall * spacing;

  // A zone's angular count is its own pyramidal need, floored so that
  // adjacent slots never sit farther apart than one lattice spacing around
  // that zone's tightest (innermost) edge — otherwise a sparse zone at a
  // large hop-radius would scatter its own mini-pyramid columns.
  const minSlotsForCircumference = (radius: number): number =>
    Math.max(1, Math.ceil((2 * Math.PI * radius) / spacing));
  const purposeAngularSteps = Math.max(purposeSlotsNeeded, minSlotsForCircumference(purposeRingRadius));
  const componentAngularSteps = Math.max(purposeAngularSteps + 2, minSlotsForCircumference(componentInner));
  const stressorAngularSteps = Math.max(stressorSlotsNeeded, minSlotsForCircumference(stressorRingRadius));

  return {
    purposeRingRadius,
    purposeRingAxial,
    purposeAngularSteps,
    innerAnnulus: { inner: innerAnnulusInner, outer: innerAnnulusOuter, hops: innerAnnulusHops },
    componentInnerAxial,
    componentOuterAxial,
    componentBand: { inner: componentInner, outer: componentOuter, hops: componentHops },
    componentAngularSteps,
    outerAnnulus: { inner: outerAnnulusInner, outer: outerAnnulusOuter, hops: outerAnnulusHops },
    stressorRingRadius,
    stressorRingAxial,
    stressorRingOuterAxial,
    stressorRingOuterRadius,
    stressorAngularSteps,
  };
}

/**
 * Angular slot count (cellCount) for a global ring index: fixed per zone,
 * driven by that zone's own pyramidal needs — never `6 × ring`. Annulus
 * rings hold no cells; any positive fallback is fine since nothing snaps
 * there.
 */
export function angularStepsForRing(stack: DualRingRadialStack, ring: number): number {
  if (ring <= stack.purposeRingAxial) return stack.purposeAngularSteps;
  if (ring >= stack.componentInnerAxial && ring <= stack.componentOuterAxial) return stack.componentAngularSteps;
  if (ring >= stack.stressorRingAxial) return stack.stressorAngularSteps;
  return 1;
}

/** True when an axial ring lies in either empty annulus (no tessellation / no nodes). */
export function isDualRingAnnulusRing(ring: number, stack: DualRingRadialStack): boolean {
  if (ring <= 0) return false;
  return (ring > stack.purposeRingAxial && ring < stack.componentInnerAxial)
    || (ring > stack.componentOuterAxial && ring < stack.stressorRingAxial);
}

/** True when an edge between two zone rings would paint through an annulus gap. */
export function crossesDualRingAnnulus(
  ringA: number,
  ringB: number,
  stack: DualRingRadialStack,
): boolean {
  const lo = Math.min(ringA, ringB);
  const hi = Math.max(ringA, ringB);
  if (lo <= stack.purposeRingAxial && hi >= stack.componentInnerAxial) return true;
  if (lo <= stack.componentOuterAxial && hi >= stack.stressorRingAxial) return true;
  return false;
}

/** Pixel radius of an axial ring under the dual-ring radial projection. */
export function radiusForDualRingAxial(ring: number, stack: DualRingRadialStack, spacing = TRI_LATTICE_SPACING): number {
  if (ring <= 0) return 0;
  const p = stack.purposeRingAxial;
  const c0 = stack.componentInnerAxial;
  const c1 = stack.componentOuterAxial;
  const s = stack.stressorRingAxial;
  if (ring <= p) return (ring / p) * stack.purposeRingRadius;
  if (ring < c0) {
    const t = (ring - p) / Math.max(1, c0 - p);
    return stack.purposeRingRadius + t * (stack.componentBand.inner - stack.purposeRingRadius);
  }
  if (ring <= c1) {
    const hops = Math.max(1, c1 - c0);
    return stack.componentBand.inner + ((ring - c0) / hops) * (stack.componentBand.outer - stack.componentBand.inner);
  }
  if (ring < s) {
    const t = (ring - c1) / Math.max(1, s - c1);
    return stack.componentBand.outer + t * (stack.stressorRingRadius - stack.componentBand.outer);
  }
  return stack.stressorRingRadius + (ring - s) * spacing;
}

export interface DualRingProjection {
  origin: Point;
  spacing: number;
  stack: DualRingRadialStack;
}

/** The purpose lattice is drawn at half its normal radial height. */
export const PURPOSE_LATTICE_HEIGHT_SCALE = 0.5;

/** Purpose cells are half-height, so the inner area uses twice as many radial layers. */
export const PURPOSE_VERTICAL_LAYER_SCALE = 1 / PURPOSE_LATTICE_HEIGHT_SCALE;

/** Returns the shared projection used by purpose drawing, snapping, and placement. */
export function purposeLatticeProjection(proj: DualRingProjection): DualRingProjection {
  return proj;
}

/** Counter-clockwise bow applied to every dual-sprocket column. */
export const DUAL_RING_COLUMN_CURVATURE = -0.18;

function dualRingColumnAngleOffset(ring: number, stack: DualRingRadialStack): number {
  let min = 0;
  let max = Math.max(1, stack.purposeRingAxial);
  if (ring >= stack.componentInnerAxial && ring <= stack.componentOuterAxial) {
    min = stack.componentInnerAxial;
    max = Math.max(min + 1, stack.componentOuterAxial);
  } else if (ring >= stack.stressorRingAxial) {
    min = stack.stressorRingAxial;
    max = Math.max(min + 1, stack.stressorRingOuterAxial);
  }
  const progress = Math.max(0, Math.min(1, (ring - min) / (max - min)));
  return DUAL_RING_COLUMN_CURVATURE * progress;
}

export interface CurvedLatticePathOptions {
  /** Amount of angular bow, in radians, at the middle of the path. */
  curvature?: number;
  /** Number of straight segments used to approximate the smooth path. */
  samples?: number;
}

export function curvedSprocketSlotPoint(
  origin: Point,
  radius: number,
  count: number,
  slot: number,
  angleOffset = 0,
): Point {
  const safeCount = Math.max(1, Math.round(count));
  const normalizedSlot = ((slot % safeCount) + safeCount) % safeCount;
  const angle = -Math.PI / 2 + (normalizedSlot / safeCount) * Math.PI * 2 + angleOffset;
  return {
    x: origin.x + radius * Math.cos(angle),
    y: origin.y + radius * Math.sin(angle),
  };
}

/**
 * Sample a curved edge in polar space. A straight SVG segment between two
 * circularly-warped cells still looks like a chord; this keeps the edge on
 * the same circular Cartesian warp as the lattice itself.
 */
export function curvedLatticePathPoints(
  from: Point,
  to: Point,
  origin: Point,
  options: CurvedLatticePathOptions = {},
): Point[] {
  const samples = Math.max(2, Math.round(options.samples ?? 12));
  const fromDx = from.x - origin.x;
  const fromDy = from.y - origin.y;
  const toDx = to.x - origin.x;
  const toDy = to.y - origin.y;
  const fromRadius = Math.hypot(fromDx, fromDy);
  const toRadius = Math.hypot(toDx, toDy);
  if (fromRadius < 1e-9 || toRadius < 1e-9) {
    return [from, to];
  }
  const fromAngle = Math.atan2(fromDy, fromDx);
  let angleDelta = Math.atan2(toDy, toDx) - fromAngle;
  while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
  while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
  const curvature = options.curvature ?? 0.16;
  const points: Point[] = [];
  for (let i = 0; i <= samples; i += 1) {
    if (i === 0) {
      points.push({ ...from });
      continue;
    }
    if (i === samples) {
      points.push({ ...to });
      continue;
    }
    const t = i / samples;
    const radius = fromRadius + (toRadius - fromRadius) * t;
    const angle = fromAngle + angleDelta * t + curvature * Math.sign(angleDelta || 1) * Math.sin(Math.PI * t);
    points.push({
      x: origin.x + radius * Math.cos(angle),
      y: origin.y + radius * Math.sin(angle),
    });
  }
  return points;
}

/**
 * Cell → pixel for the dual-ring lattice. `cell.r` is a *global* ring index
 * (matching `DualRingRadialStack`'s zone boundaries directly — no hex cube
 * distance involved) and `cell.q` is a slot index in `[0, angularStepsForRing(ring))`,
 * wrapping. This is the one function every consumer (node placement, drag
 * search, and mesh rendering) calls for "where does this cell sit" — so a
 * rendered vertex and a real snap point are the same computation, not two
 * that happen to agree on radius.
 */
export function axialToDualRingPixel(cell: AxialPoint, proj: DualRingProjection): Point {
  const ring = cell.r;
  if (ring <= 0) return { ...proj.origin };
  const radius = radiusForDualRingAxial(ring, proj.stack, proj.spacing);
  const cellCount = angularStepsForRing(proj.stack, ring);
  return curvedSprocketSlotPoint(proj.origin, radius, cellCount, cell.q, dualRingColumnAngleOffset(ring, proj.stack));
}

/** Fractional cell → pixel: same as `axialToDualRingPixel` but `ring`/`slot` may be non-integer, for sampling a smooth curve between two real cells. */
function fractionalDualRingPixel(ring: number, slot: number, proj: DualRingProjection): Point {
  if (ring <= 0) return { ...proj.origin };
  const radius = radiusForDualRingAxial(ring, proj.stack, proj.spacing);
  const cellCount = angularStepsForRing(proj.stack, Math.round(ring));
  return curvedSprocketSlotPoint(proj.origin, radius, cellCount, slot, dualRingColumnAngleOffset(ring, proj.stack));
}

/** Inverse of `axialToDualRingPixel`; picks the nearest lattice cell to a pixel, clamped to a ring range if given. */
export function pixelToDualRingAxial(
  point: Point,
  proj: DualRingProjection,
  ringBounds?: { min: number; max: number },
): AxialPoint {
  const dx = point.x - proj.origin.x;
  const dy = point.y - proj.origin.y;
  const minRing = Math.max(1, ringBounds?.min ?? 1);
  const maxRing = ringBounds?.max ?? proj.stack.stressorRingOuterAxial + 12;
  if (Math.hypot(dx, dy) < 1e-9) return { q: 0, r: minRing };
  const targetRadius = Math.hypot(dx, dy);
  let nearestRing = minRing;
  let nearestRingDistance = Infinity;
  // Ring radii are monotone increasing; scan the radial bands directly.
  for (let ring = minRing; ring <= maxRing; ring += 1) {
    const distance = Math.abs(radiusForDualRingAxial(ring, proj.stack, proj.spacing) - targetRadius);
    if (distance < nearestRingDistance) {
      nearestRingDistance = distance;
      nearestRing = ring;
    }
  }
  const cellCount = angularStepsForRing(proj.stack, nearestRing);
  let angle = Math.atan2(dy, dx) + Math.PI / 2 - dualRingColumnAngleOffset(nearestRing, proj.stack);
  while (angle < 0) angle += 2 * Math.PI;
  while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
  const slot = Math.round((angle / (2 * Math.PI)) * cellCount) % cellCount;
  return { q: slot, r: nearestRing };
}

/**
 * Curved mesh lines for one zone band (`minRing..maxRing`, both inclusive
 * ring vertices), built from exactly the same `axialToDualRingPixel`
 * formula used for node placement — every rhombus vertex drawn here is a
 * real, snappable lattice cell.
 */
export function dualRingZoneMeshPaths(
  proj: DualRingProjection,
  zone: { minRing: number; maxRing: number },
  samples = 6,
): Point[][] {
  const paths: Point[][] = [];
  const curvedSegment = (fromRing: number, fromSlot: number, toRing: number, toSlot: number): Point[] => {
    const points: Point[] = [];
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      points.push(fractionalDualRingPixel(
        fromRing + (toRing - fromRing) * t,
        fromSlot + (toSlot - fromSlot) * t,
        proj,
      ));
    }
    return points;
  };
  for (let ring = zone.minRing; ring < zone.maxRing; ring += 1) {
    const cellCount = angularStepsForRing(proj.stack, ring);
    for (let slot = 0; slot < cellCount; slot += 1) {
      paths.push(curvedSegment(ring, slot, ring + 1, slot));
      paths.push(curvedSegment(ring, slot, ring + 1, slot + 1));
    }
  }
  return paths;
}

/**
 * Nearest free lattice cell to `point`, searched directly in (ring, slot)
 * space and clamped to `ringBounds` (a zone's own valid ring range) so a
 * result can never land in an annulus or a neighboring zone. Candidates are
 * ranked by real pixel distance to `preferredFrom` (falling back to `point`),
 * matching the old "prefer the drag direction" behavior. Used for both live
 * drag preview and commit, and for de-conflicting sub-shape re-homing.
 */
export function nearestFreeDualRingCell(
  point: Point,
  occupiedKeys: ReadonlySet<string>,
  proj: DualRingProjection,
  ringBounds: { min: number; max: number },
  preferredFrom?: Point,
): AxialPoint {
  const start = pixelToDualRingAxial(point, proj, ringBounds);
  if (!occupiedKeys.has(axialKey(start))) return start;
  const preferred = preferredFrom ?? point;
  const zoneSpan = Math.max(1, ringBounds.max - ringBounds.min + 1);
  const maxCellCount = Math.max(
    ...Array.from({ length: zoneSpan }, (_, i) => angularStepsForRing(proj.stack, ringBounds.min + i)),
  );
  const maxAttempts = zoneSpan * maxCellCount + 8;
  for (let radius = 1; radius <= maxAttempts; radius += 1) {
    const candidates: AxialPoint[] = [];
    for (let dr = -radius; dr <= radius; dr += 1) {
      const ring = start.r + dr;
      if (ring < ringBounds.min || ring > ringBounds.max) continue;
      const cellCount = angularStepsForRing(proj.stack, ring);
      for (let ds = -radius; ds <= radius; ds += 1) {
        if (Math.max(Math.abs(dr), Math.abs(ds)) !== radius) continue;
        const slot = ((start.q + ds) % cellCount + cellCount) % cellCount;
        candidates.push({ q: slot, r: ring });
      }
    }
    if (candidates.length === 0) continue;
    const seen = new Set<string>();
    const unique = candidates.filter((candidate) => {
      const key = axialKey(candidate);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    unique.sort((a, b) => {
      const pa = axialToDualRingPixel(a, proj);
      const pb = axialToDualRingPixel(b, proj);
      return Math.hypot(pa.x - preferred.x, pa.y - preferred.y) - Math.hypot(pb.x - preferred.x, pb.y - preferred.y);
    });
    const free = unique.find((candidate) => !occupiedKeys.has(axialKey(candidate)));
    if (free) return free;
  }
  return start;
}

/**
 * Snap purpose/stressor tops onto a shared center ray within ≤1 lattice step.
 */
export function snapPyramidTopsToSharedRay(
  purposeTop: AxialPoint | Point,
  stressorTop: AxialPoint | Point,
  center: Point,
  spacing = TRI_LATTICE_SPACING,
): {
  purpose: AxialPoint;
  stressor: AxialPoint;
  rayAngle: number;
  purposeOffSteps: number;
  stressorOffSteps: number;
} {
  const toAxial = (value: AxialPoint | Point): AxialPoint =>
    "q" in value ? value : pixelToAxial(value, spacing, center);
  const purposeOrig = toAxial(purposeTop);
  const stressorOrig = toAxial(stressorTop);

  const neighborhood = (original: AxialPoint): AxialPoint[] => [
    original,
    ...AXIAL_NEIGHBORS.map((n) => ({ q: original.q + n.q, r: original.r + n.r })),
  ];

  const purposeCands = neighborhood(purposeOrig);
  const stressorCands = neighborhood(stressorOrig);

  let bestPurpose = purposeOrig;
  let bestStressor = stressorOrig;
  let bestSin = Infinity;
  let bestOffSum = Infinity;

  for (const purpose of purposeCands) {
    const p = axialToPixel(purpose, spacing, center);
    const pLen = Math.hypot(p.x - center.x, p.y - center.y);
    if (pLen < 1e-9) continue;
    for (const stressor of stressorCands) {
      const s = axialToPixel(stressor, spacing, center);
      const sLen = Math.hypot(s.x - center.x, s.y - center.y);
      if (sLen < 1e-9) continue;
      const cross = (p.x - center.x) * (s.y - center.y) - (p.y - center.y) * (s.x - center.x);
      const sin = Math.abs(cross) / (pLen * sLen);
      const offSum = axialDistance(purposeOrig, purpose) + axialDistance(stressorOrig, stressor);
      if (sin + 1e-12 < bestSin || (Math.abs(sin - bestSin) < 1e-12 && offSum < bestOffSum)) {
        bestSin = sin;
        bestOffSum = offSum;
        bestPurpose = purpose;
        bestStressor = stressor;
      }
    }
  }

  const purposePx = axialToPixel(bestPurpose, spacing, center);
  const stressorPx = axialToPixel(bestStressor, spacing, center);
  const purposeAngle = Math.atan2(purposePx.y - center.y, purposePx.x - center.x);
  const stressorAngle = Math.atan2(stressorPx.y - center.y, stressorPx.x - center.x);
  let delta = stressorAngle - purposeAngle;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const rayAngle = purposeAngle + delta / 2;

  return {
    purpose: bestPurpose,
    stressor: bestStressor,
    rayAngle,
    purposeOffSteps: axialDistance(purposeOrig, bestPurpose),
    stressorOffSteps: axialDistance(stressorOrig, bestStressor),
  };
}

/** Index of `cell` along its axial ring around `center` (0 .. 6*ring-1). */
export interface SimilarityForce {
  id: string;
  components: readonly string[];
  kind: "stressor" | "purpose";
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const value of setA) if (setB.has(value)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Distributes forces across sub-shapes, spreading similar (shared-component)
 * forces into different sub-shapes and balancing each sub-shape's stressor/
 * purpose ratio toward the attractor-wide ratio.
 */
export function assignForcesToSubShapes(
  forces: readonly SimilarityForce[],
  subShapeSizes: readonly number[],
): string[][] {
  const bins: SimilarityForce[][] = subShapeSizes.map(() => []);
  const degree = new Map<string, number>();
  for (const force of forces) {
    let total = 0;
    for (const other of forces) {
      if (other.id !== force.id) total += jaccard(force.components, other.components);
    }
    degree.set(force.id, total);
  }
  const overallStressorRatio = forces.length === 0
    ? 0.5
    : forces.filter((force) => force.kind === "stressor").length / forces.length;
  const ordered = [...forces].sort((a, b) =>
    (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id));

  for (const force of ordered) {
    let bestIndex = -1;
    let bestSim = Infinity;
    let bestRatioDelta = Infinity;
    let bestBinLength = Infinity;
    for (let i = 0; i < bins.length; i += 1) {
      const bin = bins[i]!;
      if (bin.length >= (subShapeSizes[i] ?? 0)) continue;
      const simScore = bin.reduce((sum, other) => sum + jaccard(force.components, other.components), 0);
      const stressorCount = bin.filter((x) => x.kind === "stressor").length;
      const newStressorCount = stressorCount + (force.kind === "stressor" ? 1 : 0);
      const newRatio = newStressorCount / (bin.length + 1);
      const ratioDelta = Math.abs(newRatio - overallStressorRatio);
      const better = simScore < bestSim
        || (simScore === bestSim && ratioDelta < bestRatioDelta)
        || (simScore === bestSim && ratioDelta === bestRatioDelta && bin.length < bestBinLength);
      if (better) {
        bestSim = simScore;
        bestRatioDelta = ratioDelta;
        bestBinLength = bin.length;
        bestIndex = i;
      }
    }
    if (bestIndex === -1) throw new Error("assignForcesToSubShapes: no bin has capacity for remaining forces");
    bins[bestIndex]!.push(force);
  }
  return bins.map((bin) => bin.map((force) => force.id));
}

/** Ring-searches outward from `point`'s nearest axial cell for the first unoccupied one. */
export function nearestFreeAxialPoint(
  point: Point,
  occupiedKeys: ReadonlySet<string>,
  spacing = TRI_LATTICE_SPACING,
  origin: Point = { x: 0, y: 0 },
): AxialPoint {
  const base = pixelToAxial(point, spacing, origin);
  if (!occupiedKeys.has(axialKey(base))) return base;
  for (let radius = 1; ; radius += 1) {
    for (const candidate of axialRing(base, radius)) {
      if (!occupiedKeys.has(axialKey(candidate))) return candidate;
    }
  }
}

/** Non-mutating preview of the point a live drag would commit to — same search as nearestFreeAxialPoint by construction. */
export function previewNearestFreeAxialPoint(
  point: Point,
  occupiedKeys: ReadonlySet<string>,
  spacing = TRI_LATTICE_SPACING,
  origin: Point = { x: 0, y: 0 },
): AxialPoint {
  return nearestFreeAxialPoint(point, occupiedKeys, spacing, origin);
}

export interface ForceShapeGroup {
  attractorId: string;
  forces: readonly SimilarityForce[];
  /** Desired axial anchor for this group's shape (its current force centroid, converted to axial space). */
  anchor: AxialPoint;
}
