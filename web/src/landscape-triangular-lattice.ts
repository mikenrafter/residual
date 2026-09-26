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
 * Lays out every attractor group's member forces onto one shared global
 * triangular lattice: each group becomes a shape (or set of edge-adjacent
 * sub-shapes for 5+ forces) anchored near its current force centroid,
 * ring-searched outward only far enough to avoid colliding with an
 * already-placed group. Groups are processed in attractorGroupPickOrder so
 * placement alternates large/small rather than packing biggest-first.
 */
export function layoutAttractorForceShapes(groups: readonly ForceShapeGroup[]): AttractorForceShapeLayout {
  const targets = new Map<string, AxialPoint>();
  const subShapesByAttractor = new Map<string, string[][]>();
  const occupied = new Set<string>();
  for (const group of orderGroupsByPickOrder(groups)) {
    const size = group.forces.length;
    if (size === 0) continue;
    if (size === 1) {
      const point = findFreeTranslation([{ q: 0, r: 0 }], group.anchor, occupied);
      targets.set(group.forces[0]!.id, point);
      occupied.add(axialKey(point));
      subShapesByAttractor.set(group.attractorId, [[group.forces[0]!.id]]);
      continue;
    }
    const rawSubShapeSizes = size <= 4 ? [size] : decomposeAttractorSize(size);
    // placeCompositeShapes places largest-first internally; sort here so our
    // indexing into its result lines up with subShapeSizes/binIds by index.
    const subShapeSizes = [...rawSubShapeSizes].sort((a, b) => b - a);
    const localShapes = subShapeSizes.length === 1
      ? [shapePatternForSize(size)]
      : placeCompositeShapes(subShapeSizes);
    const offset = findFreeTranslation(localShapes.flat(), group.anchor, occupied);
    const forceById = new Map(group.forces.map((force) => [force.id, force]));
    const binIds = subShapeSizes.length === 1
      ? [group.forces.map((force) => force.id)]
      : assignForcesToSubShapes(group.forces, subShapeSizes);
    subShapesByAttractor.set(group.attractorId, binIds);

    localShapes.forEach((shapePoints, index) => {
      const subSize = subShapeSizes[index]!;
      const localPattern = shapePatternForSize(subSize);
      const translation = {
        q: shapePoints[0]!.q - localPattern[0]!.q,
        r: shapePoints[0]!.r - localPattern[0]!.r,
      };
      const binForces = (binIds[index] ?? [])
        .map((id) => forceById.get(id))
        .filter((force): force is SimilarityForce => force !== undefined);
      const localAssignment = assignShapePoints(binForces, subSize);
      for (const force of binForces) {
        const local = localAssignment.get(force.id);
        if (!local) continue;
        const absolute = {
          q: local.q + translation.q + offset.q,
          r: local.r + translation.r + offset.r,
        };
        targets.set(force.id, absolute);
        occupied.add(axialKey(absolute));
      }
    });
  }
  return { targets, subShapesByAttractor };
}
