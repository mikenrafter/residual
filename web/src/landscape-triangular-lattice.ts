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
 * True when `layers` is a complete odd-base frustum of height h:
 * `[2h+1, 2h, …, h+1]` (e.g. `[3]`, `[5,4]`, `[7,6,5]`). The next apex
 * layer may only start after one of these stages.
 */
export function isCompleteOddPyramidStage(layers: readonly number[]): boolean {
  const h = layers.length;
  if (h === 0) return false;
  for (let i = 0; i < h; i += 1) {
    if (layers[i] !== 2 * h + 1 - i) return false;
  }
  return true;
}

/**
 * Frustum layer widths (base → apex) for an attractor with `n` force nodes.
 * Fills the lowest under-full row (relative to current base) first; when every
 * row is full, either starts a new apex layer after a complete odd stage or
 * expands the base by one.
 *
 * Sequence: 1 · 2 · 3 · 3:1 · 3:2 · 4:2 · 4:3 · 5:3 · 5:4 · 5:4:1 · …
 */
export function pyramidLayersForCount(n: number): number[] {
  if (n <= 0) return [];
  const layers: number[] = [];
  for (let placed = 0; placed < n; placed += 1) {
    if (layers.length === 0) {
      layers.push(1);
      continue;
    }
    const base = layers[0]!;
    let filled = false;
    for (let i = 0; i < layers.length; i += 1) {
      const max = base - i;
      if (layers[i]! < max) {
        layers[i] = layers[i]! + 1;
        filled = true;
        break;
      }
    }
    if (filled) continue;
    if (isCompleteOddPyramidStage(layers)) {
      layers.push(1);
      continue;
    }
    layers[0] = base + 1;
  }
  return layers;
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
 * Tall-before-wide / minimal-base frustum for dual-ring packing.
 * Sequence: 1 · 2 · 2:1 · 3:1 · 3:2 · 3:2:1 · 4:2:1 · 4:3:1 · 4:3:2 · 4:3:2:1 · …
 */
export function miniPyramidLayersForCount(n: number): number[] {
  if (n <= 0) return [];
  const layers: number[] = [];
  for (let placed = 0; placed < n; placed += 1) {
    if (layers.length === 0) {
      layers.push(1);
      continue;
    }
    const base = layers[0]!;
    let filled = false;
    for (let i = 0; i < layers.length; i += 1) {
      const max = base - i;
      if (layers[i]! < max) {
        layers[i] = layers[i]! + 1;
        filled = true;
        break;
      }
    }
    if (filled) continue;
    if (isCompleteMiniPyramidStage(layers)) {
      layers[0] = base + 1;
      continue;
    }
    layers.push(1);
  }
  return layers;
}

/**
 * Local axial cells for a mini-pyramid (+r = toward components / outward in world).
 * - apexToward "outward" (stressors): base at r=0, apex at +(h-1)
 * - apexToward "center" (purposes): apex at r=0, base at +(h-1)
 */
export function miniPyramidCellsForLayers(
  layers: readonly number[],
  orientation: { apexToward: "center" | "outward" } = { apexToward: "outward" },
): AxialPoint[] {
  const cells: AxialPoint[] = [];
  if (layers.length === 0) return cells;
  const baseWidth = layers[0]!;
  const last = layers.length - 1;
  for (let i = 0; i < layers.length; i += 1) {
    const width = layers[i]!;
    const qStart = Math.round((baseWidth - width) / 2);
    const r = orientation.apexToward === "outward" ? i : last - i;
    for (let q = qStart; q < qStart + width; q += 1) {
      cells.push({ q, r });
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
  // outward: layers[0] base at r=0, layers[i] at r=+i
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
  const bases = baseWidths.reduce((sum, width) => sum + Math.max(0, width), 0);
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
  rings: { purposeRing: number; stressorRing: number },
): DualRingMiniPyramidLayout {
  const targets = new Map<string, AxialPoint>();
  const purposeSubShapesByAttractor = new Map<string, string[][]>();
  const stressorSubShapesByAttractor = new Map<string, string[][]>();
  const purposeCount = Math.max(1, 6 * rings.purposeRing);
  const stressorCount = Math.max(1, 6 * rings.stressorRing);
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
      const localCells = miniPyramidCellsForLayers(layers, { apexToward });
      const baseWidth = layers[0] ?? 1;
      const last = Math.max(0, layers.length - 1);
      const baseR = apexToward === "outward" ? 0 : last;
      const baseMinQ = Math.min(...localCells.filter((c) => c.r === baseR).map((c) => c.q), 0);
      let cursor = startSlot;

      const absoluteFor = (local: AxialPoint, cursorSlot: number): AxialPoint => {
        // outward: base at local.r=0 on `ring`, apex at +r → ring+r
        // center:  base at local.r=last on `ring`, apex at 0 → ring-(last-r)
        const ringIndex = apexToward === "outward"
          ? ring + local.r
          : Math.max(1, ring - (last - local.r));
        const slotOffset = local.q - baseMinQ;
        const angle = -Math.PI / 2
          + ((((cursorSlot + slotOffset) % slotCount) + slotCount) % slotCount / slotCount) * 2 * Math.PI;
        return axialCellOnRingAtAngle(ringIndex, angle);
      };

      let placed: AxialPoint[] | undefined;
      for (let attempt = 0; attempt < slotCount; attempt += 1) {
        const abs = localCells.map((local) => absoluteFor(local, cursor));
        if (abs.every((cell) => !occupiedKeys.has(axialKey(cell)))) {
          placed = abs;
          break;
        }
        cursor = (cursor + 1) % slotCount;
      }
      if (!placed) placed = localCells.map((local) => absoluteFor(local, cursor));

      for (let i = 0; i < baseWidth; i += 1) occupancy[(cursor + i) % slotCount] = true;
      for (const cell of placed) occupiedKeys.add(axialKey(cell));

      const bins = assignForcesToMiniPyramidLayers(kindForces, layers);
      const localsByLayer = layers.map((_, i) => {
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
  innerAnnulus: { inner: number; outer: number };
  componentBand: { inner: number; outer: number; hops: number };
  outerAnnulus: { inner: number; outer: number };
  stressorRingRadius: number;
  stressorRingAxial: number;
}

/**
 * Pixel radii for the dual-ring stack. Component band ≥ minComponentHops;
 * outer annulus minimized (1 hop); purpose/stressor rings sized for bases.
 */
export function dualRingRadialStack(input: {
  purposeBaseWidths: readonly number[];
  stressorBaseWidths: readonly number[];
  componentCount: number;
  spacing?: number;
  minComponentHops?: number;
}): DualRingRadialStack {
  const spacing = input.spacing ?? TRI_LATTICE_SPACING;
  const minCompHops = input.minComponentHops ?? 3;
  const purposeSlots = dualRingSlotsForMiniPyramids(input.purposeBaseWidths, { gapNodes: 0 });
  const stressorSlots = dualRingSlotsForMiniPyramids(input.stressorBaseWidths, { gapNodes: 0 });
  const purposeRingAxial = Math.max(2, outerRingAxialRadiusForSlots(Math.max(1, purposeSlots)));
  const stressorRingAxial = Math.max(
    purposeRingAxial + minCompHops + 4,
    outerRingAxialRadiusForSlots(Math.max(1, stressorSlots)),
  );

  // Build pixel radii from axial rings via equal-arc formula.
  const purposeRingRadius = (spacing * 6 * purposeRingAxial) / (2 * Math.PI);
  // Purpose bases face the inner annulus; annulus starts one hop outside the ring.
  const innerAnnulusInner = purposeRingRadius + spacing;
  const innerAnnulusOuter = innerAnnulusInner + spacing;
  const componentInner = innerAnnulusOuter;
  let componentHops = minCompHops;
  // Grow component band if centered-hex capacity is insufficient.
  const capacityForHops = (hops: number): number => {
    // rings 0..hops-1 around a center ≈ 1 + 3*k*(k+1) for k=hops-1 roughly
    let cap = 1;
    for (let k = 1; k < hops; k += 1) cap += 6 * k;
    return cap;
  };
  while (capacityForHops(componentHops) < Math.max(1, input.componentCount)) {
    componentHops += 1;
  }
  const componentOuter = componentInner + spacing * componentHops;
  const outerAnnulusInner = componentOuter;
  const outerAnnulusOuter = componentOuter + spacing; // minimize: 1 hop
  const stressorRingRadius = Math.max(
    outerAnnulusOuter,
    (spacing * 6 * stressorRingAxial) / (2 * Math.PI),
  );

  return {
    purposeRingRadius,
    purposeRingAxial,
    innerAnnulus: { inner: innerAnnulusInner, outer: innerAnnulusOuter },
    componentBand: { inner: componentInner, outer: componentOuter, hops: componentHops },
    outerAnnulus: { inner: outerAnnulusInner, outer: Math.min(outerAnnulusOuter, stressorRingRadius) },
    stressorRingRadius,
    stressorRingAxial,
  };
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

/**
 * Local axial cells for a pyramid frustum: base along +q at r=0 (ergodic
 * boundary), successive layers at r=-1,-2,… (facing away). Upper layers are
 * centred on the base so unit triangles tessellate; the topmost layer may be
 * underfilled.
 */
export function pyramidCellsForLayers(layers: readonly number[]): AxialPoint[] {
  const cells: AxialPoint[] = [];
  if (layers.length === 0) return cells;
  const baseWidth = layers[0]!;
  for (let i = 0; i < layers.length; i += 1) {
    const width = layers[i]!;
    const qStart = Math.round((baseWidth - width) / 2);
    const r = 0 - i; // avoid -0
    for (let q = qStart; q < qStart + width; q += 1) {
      cells.push({ q, r });
    }
  }
  return cells;
}

export type PyramidSubshapeKind = "triangle" | "pill";

export interface PyramidSubshape {
  kind: PyramidSubshapeKind;
  cells: AxialPoint[];
}

function cellsKeySet(cells: readonly AxialPoint[]): Set<string> {
  return new Set(cells.map(axialKey));
}

/** Unit triangles whose three cells are all present in `available`. */
function candidateUnitTriangles(available: ReadonlySet<string>): AxialPoint[][] {
  const cells: AxialPoint[] = [];
  for (const key of available) {
    const [qStr, rStr] = key.split(":");
    cells.push({ q: Number(qStr), r: Number(rStr) });
  }
  const triangles: AxialPoint[][] = [];
  const seen = new Set<string>();
  for (const a of cells) {
    for (const n1 of AXIAL_NEIGHBORS) {
      const b = { q: a.q + n1.q, r: a.r + n1.r };
      if (!available.has(axialKey(b))) continue;
      for (const n2 of AXIAL_NEIGHBORS) {
        const c = { q: a.q + n2.q, r: a.r + n2.r };
        if (!available.has(axialKey(c))) continue;
        if (axialDistance(b, c) !== 1) continue;
        const tri = [a, b, c].sort((left, right) => left.q - right.q || left.r - right.r);
        const key = tri.map(axialKey).join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        triangles.push(tri);
      }
    }
  }
  return triangles;
}

/** Prefer base-facing (flat edge toward r=0) over inverted; then lower r-sum. */
function triangleBaseFacingScore(tri: readonly AxialPoint[]): number {
  const rs = tri.map((cell) => cell.r);
  const minR = Math.min(...rs);
  const maxR = Math.max(...rs);
  const onMax = tri.filter((cell) => cell.r === maxR).length;
  // Base-facing: two points on the boundary-ward side (higher r), one toward apex.
  const baseFacing = onMax === 2 && maxR === minR + 1;
  return (baseFacing ? 0 : 1) * 1000 + (tri.reduce((sum, cell) => sum + cell.r, 0));
}

/**
 * Partition pyramid cells into vertex-disjoint sub-shapes: prefer unit
 * triangles (base-facing first, then inverted), leftover runs become n-pills.
 */
export function partitionPyramidSubshapes(layers: readonly number[]): PyramidSubshape[] {
  const all = pyramidCellsForLayers(layers);
  const available = cellsKeySet(all);
  const subshapes: PyramidSubshape[] = [];

  const takeTriangle = (): boolean => {
    const candidates = candidateUnitTriangles(available)
      .map((tri) => ({ tri, score: triangleBaseFacingScore(tri) }))
      .sort((a, b) => a.score - b.score || axialKey(a.tri[0]!).localeCompare(axialKey(b.tri[0]!)));
    const best = candidates[0];
    if (!best) return false;
    for (const cell of best.tri) available.delete(axialKey(cell));
    subshapes.push({ kind: "triangle", cells: best.tri });
    return true;
  };
  while (takeTriangle()) { /* pack triangles */ }

  // Remaining cells → connected-component pills (edge-adjacent axial runs).
  const remaining = all.filter((cell) => available.has(axialKey(cell)));
  const unused = new Set(remaining.map(axialKey));
  const cellByKey = new Map(remaining.map((cell) => [axialKey(cell), cell]));

  while (unused.size > 0) {
    const startKey = [...unused].sort()[0]!;
    const pill: AxialPoint[] = [];
    const queue = [startKey];
    unused.delete(startKey);
    while (queue.length > 0) {
      const key = queue.shift()!;
      const cell = cellByKey.get(key)!;
      pill.push(cell);
      for (const neighbor of AXIAL_NEIGHBORS) {
        const next = { q: cell.q + neighbor.q, r: cell.r + neighbor.r };
        const nextKey = axialKey(next);
        if (!unused.has(nextKey)) continue;
        unused.delete(nextKey);
        queue.push(nextKey);
      }
    }
    pill.sort((a, b) => a.r - b.r || a.q - b.q);
    subshapes.push({ kind: "pill", cells: pill });
    for (const cell of pill) available.delete(axialKey(cell));
  }

  return subshapes;
}

/** Circumference slots needed on the outer ring: sum of bases + one gap per attractor. */
export function outerRingSlotsForPyramids(baseWidths: readonly number[], gapNodes = 1): number {
  if (baseWidths.length === 0) return 0;
  return baseWidths.reduce((sum, width) => sum + Math.max(0, width), 0)
    + gapNodes * baseWidths.length;
}

/**
 * Outer ergodic radius large enough for `slotCount` equidistant lattice points
 * at `spacing` along the circle (arc length ≈ spacing).
 */
export function outerRadiusForRingSlots(slotCount: number, spacing = TRI_LATTICE_SPACING): number {
  const slots = Math.max(1, slotCount);
  return (slots * spacing) / (2 * Math.PI);
}

/**
 * Polar projection of the triangular lattice: axial topology unchanged, rings
 * become true circles with equidistant angular spacing. The annulus between
 * `innerRadius` and `outerRadius` is a barrier gap (no snap targets).
 */
export interface RadialProjection {
  origin: Point;
  spacing: number;
  innerRadius: number;
  outerRadius: number;
}

/** Index of `cell` along its axial ring around `center` (0 .. 6*ring-1). */
export function axialRingSlotIndex(cell: AxialPoint, center: AxialPoint = { q: 0, r: 0 }): number {
  const ring = axialDistance(center, cell);
  if (ring === 0) return 0;
  const ringCells = axialRing(center, ring);
  const key = axialKey(cell);
  const index = ringCells.findIndex((candidate) => axialKey(candidate) === key);
  return index < 0 ? 0 : index;
}

/**
 * Axial ring index of the outer ergodic barrier large enough for `slotCount`
 * equidistant points (hex rings hold 6R slots).
 */
export function outerRingAxialRadiusForSlots(slotCount: number): number {
  return Math.max(1, Math.ceil(Math.max(1, slotCount) / 6));
}

/** Pixel radius of axial ring `ring` under a radial projection (annulus compressed). */
export function radiusForAxialRing(ring: number, proj: RadialProjection): number {
  if (ring <= 0) return 0;
  const spacing = proj.spacing;
  const innerHops = Math.max(1, Math.round(proj.innerRadius / spacing));
  const annulusHops = Math.max(1, Math.round((proj.outerRadius - proj.innerRadius) / spacing));
  const outerHops = innerHops + annulusHops;
  if (ring <= innerHops) {
    return (ring / innerHops) * proj.innerRadius;
  }
  if (ring < outerHops) {
    // Annulus: geometrically between barriers; callers should not snap here.
    const t = (ring - innerHops) / (outerHops - innerHops);
    return proj.innerRadius + t * (proj.outerRadius - proj.innerRadius);
  }
  return proj.outerRadius + (ring - outerHops) * spacing;
}

/** True when a pixel radius falls strictly inside the annulus gap. */
export function isInAnnulus(radius: number, innerRadius: number, outerRadius: number, epsilon = 1e-6): boolean {
  return radius > innerRadius + epsilon && radius < outerRadius - epsilon;
}

/**
 * Warp axial → pixel: ring centres lie on true circles, slots equidistant in angle.
 */
export function axialToRadialPixel(cell: AxialPoint, proj: RadialProjection): Point {
  const ring = axialDistance({ q: 0, r: 0 }, cell);
  if (ring === 0) return { x: proj.origin.x, y: proj.origin.y };
  const slot = axialRingSlotIndex(cell);
  const count = 6 * ring;
  const angle = -Math.PI / 2 + (slot / count) * 2 * Math.PI;
  const radius = radiusForAxialRing(ring, proj);
  return {
    x: proj.origin.x + radius * Math.cos(angle),
    y: proj.origin.y + radius * Math.sin(angle),
  };
}

/**
 * Inverse of axialToRadialPixel (nearest axial cell). Used for hop/drag.
 */
export function pixelToRadialAxial(point: Point, proj: RadialProjection): AxialPoint {
  const dx = point.x - proj.origin.x;
  const dy = point.y - proj.origin.y;
  const radius = Math.hypot(dx, dy);
  if (radius < 1e-9) return { q: 0, r: 0 };
  const spacing = proj.spacing;
  const innerHops = Math.max(1, Math.round(proj.innerRadius / spacing));
  const annulusHops = Math.max(1, Math.round((proj.outerRadius - proj.innerRadius) / spacing));
  const outerHops = innerHops + annulusHops;
  let ring: number;
  if (radius <= proj.innerRadius) {
    ring = Math.max(0, Math.round((radius / proj.innerRadius) * innerHops));
  } else if (radius < proj.outerRadius) {
    // Snap to nearer barrier ring — never rest in the annulus.
    const mid = (proj.innerRadius + proj.outerRadius) / 2;
    ring = radius < mid ? innerHops : outerHops;
  } else {
    ring = outerHops + Math.round((radius - proj.outerRadius) / spacing);
  }
  if (ring <= 0) return { q: 0, r: 0 };
  let angle = Math.atan2(dy, dx) + Math.PI / 2;
  if (angle < 0) angle += 2 * Math.PI;
  const count = 6 * ring;
  const slot = ((Math.round((angle / (2 * Math.PI)) * count) % count) + count) % count;
  return axialRing({ q: 0, r: 0 }, ring)[slot]!;
}

/**
 * Outer ergodic pixel radius so a hex ring holds at least the pyramid pack
 * (bases + gap nodes) at ~`spacing` arc separation.
 */
export function outerRadiusForPyramidPacking(
  baseWidths: readonly number[],
  spacing = TRI_LATTICE_SPACING,
  gapNodes = 1,
): { outerRadius: number; ringAxialRadius: number; slotCount: number } {
  const slotCount = outerRingSlotsForPyramids(baseWidths, gapNodes);
  const ringAxialRadius = outerRingAxialRadiusForSlots(slotCount);
  const outerRadius = (spacing * 6 * ringAxialRadius) / (2 * Math.PI);
  return { outerRadius, ringAxialRadius, slotCount };
}

/** Axial cell on `ring` nearest to the given polar angle (atan2 space). */
export function axialCellOnRingAtAngle(ring: number, angle: number): AxialPoint {
  if (ring <= 0) return { q: 0, r: 0 };
  const cells = axialRing({ q: 0, r: 0 }, ring);
  const count = cells.length;
  // Match axialToRadialPixel: slot 0 at -π/2.
  let normalized = angle + Math.PI / 2;
  while (normalized < 0) normalized += 2 * Math.PI;
  while (normalized >= 2 * Math.PI) normalized -= 2 * Math.PI;
  const slot = ((Math.round((normalized / (2 * Math.PI)) * count) % count) + count) % count;
  return cells[slot]!;
}

/**
 * Places attractor pyramids around the outer axial ring with one gap slot
 * between bases. Apex layers sit on larger rings (facing away from the core).
 */
export function layoutAttractorPyramidsOnRing(
  groups: readonly ForceShapeGroup[],
  ringAxialRadius: number,
): AttractorForceShapeLayout {
  const targets = new Map<string, AxialPoint>();
  const subShapesByAttractor = new Map<string, string[][]>();
  const occupied = new Set<string>();
  const baseCount = Math.max(1, 6 * ringAxialRadius);
  const ordered = orderGroupsByPickOrder(groups);
  let slotCursor = 0;

  ordered.forEach((group, groupIndex) => {
    const size = group.forces.length;
    if (size === 0) return;
    const layers = pyramidLayersForCount(size);
    const localCells = pyramidCellsForLayers(layers);
    const baseWidth = layers[0] ?? 1;
    // Evenly space attractors around the ring rather than packing from slot 0.
    slotCursor = Math.round((groupIndex * baseCount) / Math.max(1, ordered.length)) % baseCount;
    const minQ = Math.min(...localCells.filter((cell) => cell.r === 0).map((cell) => cell.q), 0);

    const absoluteForLocal = (local: AxialPoint): AxialPoint => {
      const ring = ringAxialRadius - local.r;
      const slotOffset = local.q - minQ;
      const baseSlot = (slotCursor + slotOffset) % baseCount;
      const angle = -Math.PI / 2 + (baseSlot / baseCount) * 2 * Math.PI;
      return axialCellOnRingAtAngle(Math.max(1, ring), angle);
    };

    // If any cell collides, advance the cursor until the whole pyramid clears.
    let placed: AxialPoint[] | undefined;
    for (let attempt = 0; attempt < baseCount; attempt += 1) {
      const absCells = localCells.map(absoluteForLocal);
      if (absCells.every((cell) => !occupied.has(axialKey(cell)))) {
        placed = absCells;
        break;
      }
      slotCursor = (slotCursor + 1) % baseCount;
    }
    if (!placed) {
      // Fallback: ring-search from first local mapping.
      placed = localCells.map((local, index) => {
        const preferred = absoluteForLocal(local);
        if (!occupied.has(axialKey(preferred))) return preferred;
        return nearestFreeAxialPoint(
          axialToPixel(preferred),
          occupied,
        );
      });
    }

    const cellAssignment = assignForcesToPyramidCells(group.forces, localCells);
    const partitions = partitionPyramidSubshapes(layers);
    const idByLocalKey = new Map<string, string>();
    for (const [forceId, local] of cellAssignment) {
      idByLocalKey.set(axialKey(local), forceId);
    }
    const bins: string[][] = partitions.map((part) =>
      part.cells
        .map((cell) => idByLocalKey.get(axialKey(cell)))
        .filter((id): id is string => id !== undefined));
    const covered = new Set(bins.flat());
    for (const force of group.forces) {
      if (!covered.has(force.id)) bins.push([force.id]);
    }
    subShapesByAttractor.set(group.attractorId, bins.filter((bin) => bin.length > 0));

    localCells.forEach((local, index) => {
      const forceId = idByLocalKey.get(axialKey(local));
      if (!forceId) return;
      const absolute = placed![index]!;
      targets.set(forceId, absolute);
      occupied.add(axialKey(absolute));
    });

    slotCursor = (slotCursor + baseWidth + 1) % baseCount;
  });

  return { targets, subShapesByAttractor };
}

/**
 * Fixed point-patterns for atomic sub-shapes (1-4 member forces).
 * Sizes 5+ always decompose; every multi-point pattern has max pairwise
 * axialDistance ≤2 (relied on by composite placement).
 */
export function shapePatternForSize(size: number): AxialPoint[] {
  switch (size) {
    case 1: // singleton
      return [{ q: 0, r: 0 }];
    case 2: // pill
      return [{ q: 0, r: 0 }, { q: 1, r: 0 }];
    case 3: // triangle
      return [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }];
    case 4: // parallelogram (two glued unit triangles)
      return [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: 1 }];
    default:
      throw new Error(`shapePatternForSize: no fixed pattern for size ${size} (expected 1-4)`);
  }
}

/**
 * Unique-size decomposition for remainders of at most 10.
 * Atomic parts are 1/2/3/4 — 5→2+3, 6→4+2, 8→1+3+4, 9→2+3+4, 10→1+2+3+4.
 */
function uniqueDecomposeAtMost10(n: number): number[] {
  switch (n) {
    case 0: return [];
    case 1: return [1];
    case 2: return [2];
    case 3: return [3];
    case 4: return [4];
    case 5: return [2, 3];
    case 6: return [4, 2];
    case 7: return [4, 3];
    case 8: return [4, 3, 1];
    case 9: return [4, 3, 2];
    case 10: return [4, 3, 2, 1];
    default:
      throw new Error(`uniqueDecomposeAtMost10: expected 0..10, got ${n}`);
  }
}

/**
 * Decomposes an attractor's force count into atomic sub-shape sizes in [1,4].
 * Counts ≤4 stay whole; 5–10 use the unique-size rule; past 10, peel 3s until
 * the remainder is ≤9, then apply the unique rule.
 */
export function decomposeAttractorSize(n: number): number[] {
  if (n <= 0) return [];
  if (n <= 4) return [n];
  let remaining = n;
  const peeled: number[] = [];
  if (n > 10) {
    while (remaining > 9) {
      peeled.push(3);
      remaining -= 3;
    }
  }
  return [...peeled, ...uniqueDecomposeAtMost10(remaining)].sort((a, b) => b - a);
}

/** True when `attempt` shares no cells with `occupied` and at least one pair is edge-adjacent. */
function isTouchingNonOverlappingPlacement(
  attempt: readonly AxialPoint[],
  occupied: readonly AxialPoint[],
): boolean {
  let touches = false;
  for (const point of attempt) {
    for (const other of occupied) {
      const distance = axialDistance(point, other);
      if (distance === 0) return false;
      if (distance === 1) touches = true;
    }
  }
  return touches;
}

/**
 * Places each sub-shape's pattern on the shared lattice, largest first at the
 * origin, each subsequent shape ring-searched outward until it touches the
 * already-placed set (min cross-shape axial distance exactly 1) without
 * overlapping any cell.
 */
export function placeCompositeShapes(sizes: readonly number[]): AxialPoint[][] {
  const order = [...sizes].sort((a, b) => b - a);
  const shapes: AxialPoint[][] = [];
  const occupied: AxialPoint[] = [];
  for (const size of order) {
    const pattern = shapePatternForSize(size);
    if (shapes.length === 0) {
      shapes.push(pattern);
      occupied.push(...pattern);
      continue;
    }
    let placed: AxialPoint[] | undefined;
    for (let radius = 1; placed === undefined; radius += 1) {
      for (const candidate of axialRing({ q: 0, r: 0 }, radius)) {
        const attempt = pattern.map((point) => ({ q: point.q + candidate.q, r: point.r + candidate.r }));
        if (isTouchingNonOverlappingPlacement(attempt, occupied)) {
          placed = attempt;
          break;
        }
      }
    }
    shapes.push(placed);
    occupied.push(...placed);
  }
  return shapes;
}

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

/**
 * Assigns each force in a single (non-composite) shape to one of its axial
 * points: the most mutually-similar force pairs are placed at the
 * geometrically farthest-apart points ("opposing sides").
 */
export function assignShapePoints(
  forces: readonly SimilarityForce[],
  shapeSize: number,
): Map<string, AxialPoint> {
  const pattern = shapePatternForSize(shapeSize);
  const assignment = new Map<string, AxialPoint>();
  const remainingForces = [...forces];
  const remainingPoints = [...pattern];

  while (remainingForces.length > 0 && remainingPoints.length > 0) {
    if (remainingForces.length === 1 || remainingPoints.length === 1) {
      assignment.set(remainingForces.shift()!.id, remainingPoints.shift()!);
      continue;
    }
    let bestForcePair: [number, number] = [0, 1];
    let bestSim = -Infinity;
    for (let i = 0; i < remainingForces.length; i += 1) {
      for (let j = i + 1; j < remainingForces.length; j += 1) {
        const sim = jaccard(remainingForces[i]!.components, remainingForces[j]!.components);
        if (sim > bestSim) {
          bestSim = sim;
          bestForcePair = [i, j];
        }
      }
    }
    let bestPointPair: [number, number] = [0, 1];
    let bestDist = -Infinity;
    for (let i = 0; i < remainingPoints.length; i += 1) {
      for (let j = i + 1; j < remainingPoints.length; j += 1) {
        const dist = axialDistance(remainingPoints[i]!, remainingPoints[j]!);
        if (dist > bestDist) {
          bestDist = dist;
          bestPointPair = [i, j];
        }
      }
    }
    const [fi, fj] = bestForcePair;
    const [pi, pj] = bestPointPair;
    assignment.set(remainingForces[fi]!.id, remainingPoints[pi]!);
    assignment.set(remainingForces[fj]!.id, remainingPoints[pj]!);
    for (const idx of [fi, fj].sort((a, b) => b - a)) remainingForces.splice(idx, 1);
    for (const idx of [pi, pj].sort((a, b) => b - a)) remainingPoints.splice(idx, 1);
  }
  return assignment;
}

/**
 * Order to place attractor groups so large/small groups alternate.
 *
 * A sliding window relative to the most recent pick over one flat sorted
 * list: pick the max first (direction = down, the only option from the top);
 * each round, the window is every not-yet-picked value strictly on the
 * current-direction side of the last pick; pick that window's median
 * (unambiguous when odd; the candidate further in `direction` of the two
 * middle values when even); flip direction; repeat.
 */
export function attractorGroupPickOrder(sizes: readonly number[]): number[] {
  if (sizes.length === 0) return [];
  const remaining = [...sizes].sort((a, b) => a - b);
  const result: number[] = [];
  let last = remaining.pop()!;
  result.push(last);
  let direction: "down" | "up" = "down";

  const windowFor = (dir: "down" | "up"): number[] =>
    dir === "down" ? remaining.filter((v) => v < last) : remaining.filter((v) => v > last);

  while (remaining.length > 0) {
    let window = windowFor(direction);
    if (window.length === 0) {
      direction = direction === "down" ? "up" : "down";
      window = windowFor(direction);
    }
    const sorted = [...window].sort((a, b) => a - b);
    const n = sorted.length;
    const pick = n % 2 === 1
      ? sorted[(n - 1) / 2]!
      : (direction === "down" ? sorted[n / 2 - 1]! : sorted[n / 2]!);
    result.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
    last = pick;
    direction = direction === "down" ? "up" : "down";
  }
  return result;
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

function orderGroupsByPickOrder(groups: readonly ForceShapeGroup[]): ForceShapeGroup[] {
  const order = attractorGroupPickOrder(groups.map((group) => group.forces.length));
  const pool = [...groups];
  const result: ForceShapeGroup[] = [];
  for (const size of order) {
    const idx = pool.findIndex((group) => group.forces.length === size);
    if (idx === -1) continue;
    result.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return result;
}

/** First candidate translation of `localPoints` (tried at `anchor` itself, then ring-searched outward) that avoids every cell in `occupied`. */
function findFreeTranslation(
  localPoints: readonly AxialPoint[],
  anchor: AxialPoint,
  occupied: ReadonlySet<string>,
): AxialPoint {
  const clear = (offset: AxialPoint): boolean =>
    localPoints.every((point) => !occupied.has(axialKey({ q: point.q + offset.q, r: point.r + offset.r })));
  if (clear(anchor)) return anchor;
  for (let radius = 1; ; radius += 1) {
    for (const candidate of axialRing(anchor, radius)) {
      if (clear(candidate)) return candidate;
    }
  }
}

export interface AttractorForceShapeLayout {
  targets: Map<string, AxialPoint>;
  /** Each attractor's member forces, partitioned by which sub-shape they landed in (one entry for non-composite groups). */
  subShapesByAttractor: Map<string, string[][]>;
}

/**
 * Assign forces onto pyramid cells: most similar pairs go to geometrically
 * farthest cell pairs (same opposing-sides heuristic as assignShapePoints).
 */
function assignForcesToPyramidCells(
  forces: readonly SimilarityForce[],
  cells: readonly AxialPoint[],
): Map<string, AxialPoint> {
  const assignment = new Map<string, AxialPoint>();
  const remainingForces = [...forces];
  const remainingCells = [...cells];
  while (remainingForces.length > 0 && remainingCells.length > 0) {
    if (remainingForces.length === 1 || remainingCells.length === 1) {
      assignment.set(remainingForces.shift()!.id, remainingCells.shift()!);
      continue;
    }
    let bestForcePair: [number, number] = [0, 1];
    let bestSim = -Infinity;
    for (let i = 0; i < remainingForces.length; i += 1) {
      for (let j = i + 1; j < remainingForces.length; j += 1) {
        const sim = jaccard(remainingForces[i]!.components, remainingForces[j]!.components);
        if (sim > bestSim) {
          bestSim = sim;
          bestForcePair = [i, j];
        }
      }
    }
    let bestCellPair: [number, number] = [0, 1];
    let bestDist = -Infinity;
    for (let i = 0; i < remainingCells.length; i += 1) {
      for (let j = i + 1; j < remainingCells.length; j += 1) {
        const dist = axialDistance(remainingCells[i]!, remainingCells[j]!);
        if (dist > bestDist) {
          bestDist = dist;
          bestCellPair = [i, j];
        }
      }
    }
    const [fi, fj] = bestForcePair;
    const [ci, cj] = bestCellPair;
    assignment.set(remainingForces[fi]!.id, remainingCells[ci]!);
    assignment.set(remainingForces[fj]!.id, remainingCells[cj]!);
    for (const idx of [fi, fj].sort((a, b) => b - a)) remainingForces.splice(idx, 1);
    for (const idx of [ci, cj].sort((a, b) => b - a)) remainingCells.splice(idx, 1);
  }
  return assignment;
}

/**
 * Lays out every attractor group's forces as a wide-before-tall pyramid
 * frustum on the shared triangular lattice. Sub-shapes are vertex-disjoint
 * triangles (preferred) or pills from `partitionPyramidSubshapes`. Groups
 * are processed in attractorGroupPickOrder and ring-searched to avoid
 * collisions; callers that pack on the outer ring should pass anchors that
 * already include inter-pyramid gap slots.
 */
export function layoutAttractorForceShapes(groups: readonly ForceShapeGroup[]): AttractorForceShapeLayout {
  const targets = new Map<string, AxialPoint>();
  const subShapesByAttractor = new Map<string, string[][]>();
  const occupied = new Set<string>();
  for (const group of orderGroupsByPickOrder(groups)) {
    const size = group.forces.length;
    if (size === 0) continue;
    const layers = pyramidLayersForCount(size);
    const localCells = pyramidCellsForLayers(layers);
    const offset = findFreeTranslation(localCells, group.anchor, occupied);
    const cellAssignment = assignForcesToPyramidCells(group.forces, localCells);
    const partitions = partitionPyramidSubshapes(layers);
    const idByLocalKey = new Map<string, string>();
    for (const [forceId, local] of cellAssignment) {
      idByLocalKey.set(axialKey(local), forceId);
    }
    const bins: string[][] = partitions.map((part) =>
      part.cells
        .map((cell) => idByLocalKey.get(axialKey(cell)))
        .filter((id): id is string => id !== undefined));
    // Drop empty bins (shouldn't happen) and ensure every force appears once.
    const covered = new Set(bins.flat());
    for (const force of group.forces) {
      if (!covered.has(force.id)) bins.push([force.id]);
    }
    subShapesByAttractor.set(group.attractorId, bins.filter((bin) => bin.length > 0));

    for (const [forceId, local] of cellAssignment) {
      const absolute = { q: local.q + offset.q, r: local.r + offset.r };
      targets.set(forceId, absolute);
      occupied.add(axialKey(absolute));
    }
  }
  return { targets, subShapesByAttractor };
}
