import type { Point } from "./landscape-geometry";

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

export function axialToPixel(point: AxialPoint, spacing = TRI_LATTICE_SPACING): Point {
  const x = spacing * (Math.sqrt(3) * point.q + (Math.sqrt(3) / 2) * point.r);
  const y = spacing * ((3 / 2) * point.r);
  return { x, y };
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

export function pixelToAxial(point: Point, spacing = TRI_LATTICE_SPACING): AxialPoint {
  const q = ((Math.sqrt(3) / 3) * point.x - point.y / 3) / spacing;
  const r = ((2 / 3) * point.y) / spacing;
  return axialRound({ q, r });
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
 * Fixed point-patterns for single-shape attractors (2-7 member forces).
 * Every pattern has a max pairwise axialDistance of ≤2 (relied on by composite placement).
 */
export function shapePatternForSize(size: number): AxialPoint[] {
  switch (size) {
    case 2: // pill
      return [{ q: 0, r: 0 }, { q: 1, r: 0 }];
    case 3: // triangle
      return [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }];
    case 4: // parallelogram (two glued unit triangles)
      return [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: 1 }];
    case 5: // dice-5: center + 4 of 6 ring points (opposite diagonal pairs, vertical pair dropped)
      return [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 1, r: -1 },
        { q: -1, r: 0 },
        { q: -1, r: 1 },
      ];
    case 6: // hexagon: full ring, no center
      return AXIAL_NEIGHBORS.map((offset) => ({ ...offset }));
    case 7: // hexagon + center dot
      return [{ q: 0, r: 0 }, ...AXIAL_NEIGHBORS.map((offset) => ({ ...offset }))];
    default:
      throw new Error(`shapePatternForSize: no fixed pattern for size ${size} (expected 2-7)`);
  }
}

function repeatsCount(multiset: readonly number[]): number {
  return multiset.length - new Set(multiset).size;
}

function spreadOf(multiset: readonly number[]): number {
  return Math.max(...multiset) - Math.min(...multiset);
}

const SHAPE_SIZE_VALUES = [3, 4, 5, 6, 7] as const;

/** All non-decreasing k-length sequences over [3..7] summing to `sum`. */
function multisetsOfSize(k: number, sum: number): number[][] {
  const results: number[][] = [];
  const current: number[] = [];
  const rec = (startIdx: number, remaining: number, remainingSum: number): void => {
    if (remaining === 0) {
      if (remainingSum === 0) results.push([...current]);
      return;
    }
    for (let i = startIdx; i < SHAPE_SIZE_VALUES.length; i += 1) {
      const value = SHAPE_SIZE_VALUES[i]!;
      if (value * remaining > remainingSum) break; // values ascending: no smaller value left to try
      if (7 * remaining < remainingSum) continue;
      current.push(value);
      rec(i, remaining - 1, remainingSum - value);
      current.pop();
    }
  };
  rec(0, k, sum);
  return results;
}

/**
 * Decomposes an attractor's force count (8+) into 2 or more sub-shape sizes,
 * each in [3,7] (the composite-eligible single-shape range). Picks the
 * smallest feasible sub-shape count, then within that count prefers all-distinct
 * sizes, then the most balanced (smallest spread) combination.
 */
export function decomposeAttractorSize(n: number): number[] {
  if (n <= 7) return n > 0 ? [n] : [];
  for (let k = 2; k <= n; k += 1) {
    const minSum = 3 * k;
    const maxSum = 7 * k;
    if (n < minSum) continue;
    if (n > maxSum) continue;
    const candidates = multisetsOfSize(k, n);
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => repeatsCount(a) - repeatsCount(b) || spreadOf(a) - spreadOf(b));
    return candidates[0]!;
  }
  throw new Error(`decomposeAttractorSize: no valid decomposition for n=${n}`);
}

function isValidPlacement(placed: readonly AxialPoint[], occupied: readonly AxialPoint[]): boolean {
  for (const point of placed) {
    for (const other of occupied) {
      if (axialDistance(point, other) < 2) return false;
    }
  }
  return true;
}

/**
 * Places each sub-shape's pattern on the shared lattice, largest first at the
 * origin, each subsequent shape ring-searched outward until every cross-shape
 * point pair is at least 2 axial steps apart (adjacent-but-one — "1 extra
 * snap away").
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
        if (isValidPlacement(attempt, occupied)) {
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
): AxialPoint {
  const base = pixelToAxial(point, spacing);
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
): AxialPoint {
  return nearestFreeAxialPoint(point, occupiedKeys, spacing);
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
 * triangular lattice: each group becomes a shape (or set of non-adjacent
 * sub-shapes for 8+ forces) anchored near its current force centroid,
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
    const rawSubShapeSizes = size <= 7 ? [size] : decomposeAttractorSize(size);
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
