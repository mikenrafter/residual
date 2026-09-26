export interface Point {
  x: number;
  y: number;
}

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CubicCurve {
  c1: Point;
  c2: Point;
  end: Point;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalize(dx: number, dy: number): Point {
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

function centroid(points: readonly Point[]): Point | undefined {
  if (points.length === 0) return undefined;
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function fmt(value: number): string {
  const rounded = Number(value.toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function curveToPath(from: Point, curve: CubicCurve): string {
  return `M ${fmt(from.x)},${fmt(from.y)} C ${fmt(curve.c1.x)},${fmt(curve.c1.y)} ${fmt(curve.c2.x)},${fmt(curve.c2.y)} ${fmt(curve.end.x)},${fmt(curve.end.y)}`;
}

function cubicBetween(from: Point, to: Point, direction: Point): CubicCurve {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  // c1 leaves along `direction` for a third of the distance; c2 sits 32% of
  // the way back from `to` toward `from`.
  const lead = distance * 0.34;
  return {
    c1: { x: from.x + direction.x * lead, y: from.y + direction.y * lead },
    c2: { x: to.x - dx * 0.32, y: to.y - dy * 0.32 },
    end: to,
  };
}

/**
 * First intersection of the ray `from → toward` with the circle
 * (`center`, `radius`), or undefined when the ray misses.
 */
export function rayCircleIntersection(
  from: Point,
  toward: Point,
  center: Point,
  radius: number,
): Point | undefined {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9 || radius <= 0) return undefined;
  const ux = dx / length;
  const uy = dy / length;
  const fx = from.x - center.x;
  const fy = from.y - center.y;
  // |f + t·u|² = r²  →  t² + 2(f·u)t + (|f|² − r²) = 0
  const b = 2 * (fx * ux + fy * uy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * c;
  if (discriminant < 0) return undefined;
  const root = Math.sqrt(discriminant);
  const t1 = (-b - root) / 2;
  const t2 = (-b + root) / 2;
  let t: number | undefined;
  for (const candidate of [t1, t2].sort((left, right) => left - right)) {
    if (candidate > 1e-6) {
      t = candidate;
      break;
    }
  }
  if (t === undefined) return undefined;
  return { x: from.x + ux * t, y: from.y + uy * t };
}

function cross2(origin: Point, a: Point, b: Point): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

/** Andrew's monotone-chain convex hull; collinear points collapse to their extremes. */
export function convexHullPoints(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = sorted.filter((point, index) => {
    const previous = sorted[index - 1];
    return previous === undefined || point.x !== previous.x || point.y !== previous.y;
  });
  if (unique.length <= 2) return unique;
  const turnsWrong = (chain: Point[], point: Point): boolean => {
    const a = chain[chain.length - 2];
    const b = chain[chain.length - 1];
    return a !== undefined && b !== undefined && cross2(a, b, point) <= 0;
  };
  const lower: Point[] = [];
  for (const point of unique) {
    while (turnsWrong(lower, point)) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (const point of [...unique].reverse()) {
    while (turnsWrong(upper, point)) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * First intersection of the ray `from → toward` with the boundary of a convex
 * `polygon` (ordered vertices), or undefined when the ray misses.
 */
export function rayConvexPolygonIntersection(
  from: Point,
  toward: Point,
  polygon: readonly Point[],
): Point | undefined {
  if (polygon.length === 0) return undefined;
  if (polygon.length === 1) {
    const only = polygon[0]!;
    const dx = toward.x - from.x;
    const dy = toward.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return undefined;
    const ux = dx / length;
    const uy = dy / length;
    const tx = only.x - from.x;
    const ty = only.y - from.y;
    const t = tx * ux + ty * uy;
    if (t <= 1e-6) return undefined;
    const closest = { x: from.x + ux * t, y: from.y + uy * t };
    if (Math.hypot(closest.x - only.x, closest.y - only.y) > 1e-6) return undefined;
    return { ...only };
  }
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return undefined;
  const ux = dx / length;
  const uy = dy / length;
  let bestT: number | undefined;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = ux * ey - uy * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const fx = a.x - from.x;
    const fy = a.y - from.y;
    const t = (fx * ey - fy * ex) / denom;
    const s = (fx * uy - fy * ux) / denom;
    if (t > 1e-6 && s >= -1e-9 && s <= 1 + 1e-9) {
      if (bestT === undefined || t < bestT) bestT = t;
    }
  }
  if (bestT === undefined) return undefined;
  return { x: from.x + ux * bestT, y: from.y + uy * bestT };
}

export function branchGeometry(
  from: Point,
  to: Point[],
  splitFraction = 0.6,
  tension = 1,
  /** When set, the trunk ends here instead of at the fraction/tension point. */
  splitAt?: Point,
): { trunk: string; branches: string[]; width: number } {
  const targets = to.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const count = targets.length;
  if (count === 0) return { trunk: "", branches: [], width: 1 };

  const width = 1 + Math.sqrt(Math.max(0, count - 1)) * 0.9;
  if (count === 1) {
    const target = targets[0]!;
    const direction = normalize(target.x - from.x, target.y - from.y);
    const curve = cubicBetween(from, target, direction);
    const path = curveToPath(from, curve);
    return { trunk: path, branches: [path], width };
  }

  const center = centroid(targets) ?? from;
  let splitPoint: Point;
  if (splitAt && Number.isFinite(splitAt.x) && Number.isFinite(splitAt.y)) {
    splitPoint = splitAt;
  } else {
    const split = clamp(splitFraction, 0.05, 0.95);
    const rawSplitPoint: Point = {
      x: from.x + (center.x - from.x) * split,
      y: from.y + (center.y - from.y) * split,
    };
    // tension blends the raw (fully bundled) split point back toward `from`:
    // tension=1 reproduces the raw split point exactly; tension=0 collapses
    // the trunk to a zero-length stub at the source.
    splitPoint = {
      x: from.x + (rawSplitPoint.x - from.x) * tension,
      y: from.y + (rawSplitPoint.y - from.y) * tension,
    };
  }
  const trunkDirection = normalize(splitPoint.x - from.x, splitPoint.y - from.y);
  const trunk = curveToPath(from, cubicBetween(from, splitPoint, trunkDirection));

  const branches = targets.map((target) => {
    const targetDx = target.x - splitPoint.x;
    const targetDy = target.y - splitPoint.y;
    const targetDistance = Math.hypot(targetDx, targetDy);
    // cp1 continues the trunk's direction (tangent continuity at the split);
    // cp2 sits 30% of the way back from the target toward the split.
    const cp1Distance = Math.min(Math.max(10, targetDistance * 0.35), 32);
    const cp1: Point = {
      x: splitPoint.x + trunkDirection.x * cp1Distance,
      y: splitPoint.y + trunkDirection.y * cp1Distance,
    };
    const cp2: Point = {
      x: target.x - targetDx * 0.3,
      y: target.y - targetDy * 0.3,
    };
    return curveToPath(splitPoint, { c1: cp1, c2: cp2, end: target });
  });

  return { trunk, branches, width };
}

/**
 * Point on the segment `fromDirection → target` that sits `distance` away
 * from `target` (clamped when the segment is shorter).
 */
export function pointAtDistanceFrom(
  target: Point,
  fromDirection: Point,
  distance: number,
): Point {
  const dx = fromDirection.x - target.x;
  const dy = fromDirection.y - target.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { x: target.x, y: target.y };
  const scale = Math.min(Math.max(0, distance), length) / length;
  return { x: target.x + dx * scale, y: target.y + dy * scale };
}

/**
 * Push `points` apart around `origin` so consecutive angular neighbors have
 * at least `minTangential` separation measured along the average radius.
 * Returns a new array; single/empty inputs are unchanged.
 */
export function ensureMinTangentialSeparation(
  origin: Point,
  points: readonly Point[],
  minTangential: number,
): Point[] {
  if (points.length <= 1 || minTangential <= 0) return points.map((point) => ({ ...point }));
  const items = points.map((point, index) => {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return {
      index,
      radius: Math.hypot(dx, dy),
      angle: Math.atan2(dy, dx),
      point: { ...point },
    };
  });
  items.sort((a, b) => a.angle - b.angle);
  const meanRadius = items.reduce((sum, item) => sum + item.radius, 0) / items.length;
  const radius = Math.max(meanRadius, minTangential);
  // Chord length c at radius r needs central angle 2·asin(c/(2r)).
  const minAngle = 2 * Math.asin(Math.min(1, minTangential / (2 * radius)));
  // Expand gaps iteratively so consecutive (and wrap-around) pairs clear minAngle.
  for (let pass = 0; pass < items.length * 2; pass += 1) {
    for (let i = 0; i < items.length; i += 1) {
      const current = items[i]!;
      const next = items[(i + 1) % items.length]!;
      let delta = next.angle - current.angle;
      if (delta <= 0) delta += Math.PI * 2;
      if (delta >= minAngle) continue;
      const deficit = (minAngle - delta) / 2;
      current.angle -= deficit;
      next.angle += deficit;
    }
  }
  const result = points.map((point) => ({ ...point }));
  for (const item of items) {
    result[item.index] = {
      x: origin.x + Math.cos(item.angle) * item.radius,
      y: origin.y + Math.sin(item.angle) * item.radius,
    };
  }
  return result;
}

/**
 * Slide `target` along the ray `origin → toward` so it sits at least
 * `minSeparation` past `origin` toward `toward` (and still before `toward`).
 * Keeps nested bundle splits from collapsing onto the same point.
 */
export function ensureForwardSplitSeparation(
  origin: Point,
  target: Point,
  toward: Point,
  minSeparation: number,
): Point {
  const hx = toward.x - origin.x;
  const hy = toward.y - origin.y;
  const hLen = Math.hypot(hx, hy);
  if (hLen < 1e-9) return { x: target.x, y: target.y };
  const ux = hx / hLen;
  const uy = hy / hLen;
  const proj = (target.x - origin.x) * ux + (target.y - origin.y) * uy;
  const minPlace = Math.min(Math.max(0, minSeparation), hLen * 0.92);
  const place = Math.min(hLen * 0.92, Math.max(minPlace, proj));
  return { x: origin.x + ux * place, y: origin.y + uy * place };
}

export interface NestedSubShapeTargets {
  /** Leaf force positions this sub-shape branch ends at. */
  forces: readonly Point[];
  /**
   * When set, the mid→force fan splits here (e.g. intersection with a one-layer
   * dilated hull around the sub-shape). Otherwise falls back to
   * `approachDistance` from the force centroid toward `midSplit`.
   */
  approach?: Point;
}

/**
 * Two-level nested fan: `from` → `midSplit` trunk, then mid→approach branches
 * (one per sub-shape), then approach→force leaves. Prefer per-sub-shape
 * `approach` points (dilated outer edge); `approachDistance` is the fallback
 * hop from each centroid. `minTangential` keeps sibling branches apart.
 */
export function nestedBranchGeometry(
  from: Point,
  subShapes: readonly NestedSubShapeTargets[],
  midSplit: Point,
  approachDistance: number,
  minTangential = 0,
): {
  trunk: string;
  midBranches: string[];
  forceBranches: string[][];
  approachPoints: Point[];
  width: number;
} {
  const leafCount = subShapes.reduce((sum, sub) => sum + sub.forces.length, 0);
  if (leafCount === 0) {
    return { trunk: "", midBranches: [], forceBranches: [], approachPoints: [], width: 1 };
  }
  const width = 1 + Math.sqrt(Math.max(0, leafCount - 1)) * 0.9;
  const trunkDirection = normalize(midSplit.x - from.x, midSplit.y - from.y);
  const trunk = curveToPath(from, cubicBetween(from, midSplit, trunkDirection));

  let approachPoints = subShapes.map((sub) => {
    if (
      sub.approach
      && Number.isFinite(sub.approach.x)
      && Number.isFinite(sub.approach.y)
    ) {
      return { x: sub.approach.x, y: sub.approach.y };
    }
    const hub = centroid(sub.forces.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) ?? midSplit;
    return pointAtDistanceFrom(hub, midSplit, approachDistance);
  });
  approachPoints = ensureMinTangentialSeparation(midSplit, approachPoints, minTangential);

  const midBranches = approachPoints.map((approach) => {
    const dx = approach.x - midSplit.x;
    const dy = approach.y - midSplit.y;
    const distance = Math.hypot(dx, dy);
    const cp1Distance = Math.min(Math.max(10, distance * 0.35), 32);
    return curveToPath(midSplit, {
      c1: {
        x: midSplit.x + trunkDirection.x * cp1Distance,
        y: midSplit.y + trunkDirection.y * cp1Distance,
      },
      c2: { x: approach.x - dx * 0.3, y: approach.y - dy * 0.3 },
      end: approach,
    });
  });

  const forceBranches = subShapes.map((sub, index) => {
    const approach = approachPoints[index]!;
    const forces = sub.forces.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    // Fan leaf departure angles around the approach so close forces still
    // split with a readable tangential gap; endpoints stay on the forces.
    const spreadTargets = ensureMinTangentialSeparation(approach, forces, minTangential);
    return forces.map((force, forceIndex) => {
      const spread = spreadTargets[forceIndex] ?? force;
      const leave = {
        x: approach.x + (spread.x - approach.x) * 0.35,
        y: approach.y + (spread.y - approach.y) * 0.35,
      };
      const dx = force.x - approach.x;
      const dy = force.y - approach.y;
      return curveToPath(approach, {
        c1: leave,
        c2: { x: force.x - dx * 0.3, y: force.y - dy * 0.3 },
        end: force,
      });
    });
  });

  return { trunk, midBranches, forceBranches, approachPoints, width };
}

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

function xOverlaps(a: LabelBox, b: LabelBox): boolean {
  return overlap1d(a.x, a.x + a.width, b.x, b.x + b.width) > 0;
}

export function nudgeLabels(boxes: LabelBox[], maxShift = 12): number[] {
  const limit = Math.max(0, maxShift);
  const shifts = boxes.map(() => 0);
  if (boxes.length < 2 || limit === 0) return shifts;

  const pairs: [number, number][] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (xOverlaps(boxes[i]!, boxes[j]!)) pairs.push([i, j]);
    }
  }
  if (pairs.length === 0) return shifts;

  for (let pass = 0; pass < 10; pass += 1) {
    let changed = false;
    for (const [i, j] of pairs) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const topA = a.y + shifts[i]!;
      const botA = topA + a.height;
      const topB = b.y + shifts[j]!;
      const botB = topB + b.height;
      const overlap = Math.max(0, Math.min(botA, botB) - Math.max(topA, topB));
      if (overlap <= 0) continue;

      const targetStep = overlap / 2 + 0.5;
      const canUp = shifts[i]! + limit;
      const canDown = limit - shifts[j]!;
      const paired = Math.min(targetStep, canUp, canDown);
      if (paired > 0) {
        shifts[i] = shifts[i]! - paired;
        shifts[j] = shifts[j]! + paired;
        changed = true;
        continue;
      }

      // If one side is saturated, move the other side as much as possible.
      if (canUp > 0) {
        const applied = Math.min(overlap + 0.5, canUp);
        shifts[i] = shifts[i]! - applied;
        changed = changed || applied > 0;
      } else if (canDown > 0) {
        const applied = Math.min(overlap + 0.5, canDown);
        shifts[j] = shifts[j]! + applied;
        changed = changed || applied > 0;
      }
    }
    if (!changed) break;
  }

  return shifts.map((value) => clamp(value, -limit, limit));
}

function insideBounds(point: Point, bounds: LabelBox): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function clipPolygonToBounds(points: readonly Point[], bounds: LabelBox): Point[] {
  if (points.length < 3) return points.filter((point) => insideBounds(point, bounds));
  const edges: { inside: (point: Point) => boolean; intersect: (from: Point, to: Point) => Point }[] = [
    {
      inside: (point) => point.x >= bounds.x,
      intersect: (from, to) => {
        const ratio = (bounds.x - from.x) / (to.x - from.x);
        return { x: bounds.x, y: from.y + (to.y - from.y) * ratio };
      },
    },
    {
      inside: (point) => point.x <= bounds.x + bounds.width,
      intersect: (from, to) => {
        const x = bounds.x + bounds.width;
        const ratio = (x - from.x) / (to.x - from.x);
        return { x, y: from.y + (to.y - from.y) * ratio };
      },
    },
    {
      inside: (point) => point.y >= bounds.y,
      intersect: (from, to) => {
        const ratio = (bounds.y - from.y) / (to.y - from.y);
        return { x: from.x + (to.x - from.x) * ratio, y: bounds.y };
      },
    },
    {
      inside: (point) => point.y <= bounds.y + bounds.height,
      intersect: (from, to) => {
        const y = bounds.y + bounds.height;
        const ratio = (y - from.y) / (to.y - from.y);
        return { x: from.x + (to.x - from.x) * ratio, y };
      },
    },
  ];
  let clipped = [...points];
  for (const edge of edges) {
    const input = clipped;
    clipped = [];
    for (let index = 0; index < input.length; index += 1) {
      const from = input[index]!;
      const to = input[(index + 1) % input.length]!;
      const fromInside = edge.inside(from);
      const toInside = edge.inside(to);
      if (fromInside && toInside) clipped.push(to);
      else if (fromInside) clipped.push(edge.intersect(from, to));
      else if (toInside) clipped.push(edge.intersect(from, to), to);
    }
    if (clipped.length === 0) break;
  }
  return clipped;
}

/** Keeps a label anchor visible, preferring a visible part of its region. */
export function projectLabelAnchor(
  point: Point,
  bounds: LabelBox,
  preferredRegion: readonly Point[] = [],
): Point {
  if (insideBounds(point, bounds)) return { ...point };
  const visibleRegion = clipPolygonToBounds(preferredRegion, bounds);
  if (visibleRegion.length > 0) {
    return centroid(visibleRegion) ?? { ...visibleRegion[0]! };
  }
  return {
    x: clamp(point.x, bounds.x, bounds.x + bounds.width),
    y: clamp(point.y, bounds.y, bounds.y + bounds.height),
  };
}

function radiusFromCenter(point: Point, center: Point): number {
  return Math.hypot(point.x - center.x, point.y - center.y);
}

function pointInAnnulus(
  point: Point,
  center: Point,
  annulus: { inner: number; outer: number },
): boolean {
  const radius = radiusFromCenter(point, center);
  return radius >= annulus.inner - 1e-6 && radius <= annulus.outer + 1e-6;
}

/** True when the straight segment `from→to` enters `wrongAnnulus`. */
export function shouldUseLongAnnulusArc(
  from: Point,
  to: Point,
  center: Point,
  correctAnnulus: { inner: number; outer: number },
  wrongAnnulus: { inner: number; outer: number },
): boolean {
  void correctAnnulus;
  const samples = 24;
  for (let i = 1; i < samples; i += 1) {
    const t = i / samples;
    const point = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
    if (pointInAnnulus(point, center, wrongAnnulus)) return true;
  }
  return false;
}

/**
 * Cubic path that leaves `from` along a ±tangentDegrees tangent toward the
 * correct annulus, then curves onto `enter` at the annulus mid-radius.
 */
export function longAnnulusArcPath(
  from: Point,
  enter: Point,
  center: Point,
  annulus: { inner: number; outer: number },
  options: { tangentDegrees?: number; direction?: "cw" | "ccw" } = {},
): string {
  const tangentDegrees = options.tangentDegrees ?? 10;
  const midRadius = (annulus.inner + annulus.outer) / 2;
  const fromAngle = Math.atan2(from.y - center.y, from.x - center.x);
  const enterAngle = Math.atan2(enter.y - center.y, enter.x - center.x);
  let delta = enterAngle - fromAngle;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const direction = options.direction
    ?? (delta >= 0 ? "ccw" : "cw");
  const sign = direction === "ccw" ? 1 : -1;
  const tangent = (tangentDegrees * Math.PI) / 180;
  const leaveAngle = fromAngle + sign * tangent;
  const fromRadius = Math.max(1e-6, radiusFromCenter(from, center));
  const leaveDir = {
    x: Math.cos(leaveAngle + sign * Math.PI / 2),
    y: Math.sin(leaveAngle + sign * Math.PI / 2),
  };
  // Control point 1: along the tangent from `from`.
  const lead = Math.max(20, fromRadius * 0.35);
  const c1 = { x: from.x + leaveDir.x * lead, y: from.y + leaveDir.y * lead };
  // Control point 2: on the annulus mid circle, approached tangentially.
  const approachAngle = enterAngle - sign * tangent * 0.5;
  const c2 = {
    x: center.x + Math.cos(approachAngle) * midRadius,
    y: center.y + Math.sin(approachAngle) * midRadius,
  };
  const end = {
    x: center.x + Math.cos(enterAngle) * midRadius,
    y: center.y + Math.sin(enterAngle) * midRadius,
  };
  return curveToPath(from, { c1, c2, end });
}

function annulusBandAroundMid(mid: number, halfWidth: number): { inner: number; outer: number } {
  return {
    inner: Math.max(0, mid - halfWidth),
    outer: mid + halfWidth,
  };
}

/**
 * Component → correct-annulus mid → approach → force. Uses a long ±10° arc
 * when the short hop would cross the wrong annulus.
 */
export function dualRingMembershipGeometry(input: {
  from: Point;
  force: Point;
  forceKind: "purpose" | "stressor";
  center: Point;
  innerAnnulusMid: number;
  outerAnnulusMid: number;
  approach?: Point;
  tangentDegrees?: number;
}): {
  trunk: string;
  midBranch: string;
  forceBranch: string;
  route: "short" | "long-arc";
  midSplit: Point;
} {
  const half = Math.max(
    8,
    Math.abs(input.outerAnnulusMid - input.innerAnnulusMid) * 0.25,
  );
  const correctMid = input.forceKind === "purpose" ? input.innerAnnulusMid : input.outerAnnulusMid;
  const wrongMid = input.forceKind === "purpose" ? input.outerAnnulusMid : input.innerAnnulusMid;
  const correctAnnulus = annulusBandAroundMid(correctMid, half);
  const wrongAnnulus = annulusBandAroundMid(wrongMid, half);

  const forceAngle = Math.atan2(input.force.y - input.center.y, input.force.x - input.center.x);
  const radialMid: Point = {
    x: input.center.x + Math.cos(forceAngle) * correctMid,
    y: input.center.y + Math.sin(forceAngle) * correctMid,
  };
  const hit = rayCircleIntersection(input.from, input.force, input.center, correctMid);
  const shortMid = hit ?? radialMid;

  const useLong = shouldUseLongAnnulusArc(
    input.from,
    shortMid,
    input.center,
    correctAnnulus,
    wrongAnnulus,
  );

  let midSplit = shortMid;
  let trunk: string;
  if (useLong) {
    const fromAngle = Math.atan2(input.from.y - input.center.y, input.from.x - input.center.x);
    let delta = forceAngle - fromAngle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const direction = delta >= 0 ? "ccw" : "cw";
    midSplit = radialMid;
    trunk = longAnnulusArcPath(input.from, midSplit, input.center, correctAnnulus, {
      tangentDegrees: input.tangentDegrees ?? 10,
      direction,
    });
  } else {
    const dir = normalize(shortMid.x - input.from.x, shortMid.y - input.from.y);
    trunk = curveToPath(input.from, cubicBetween(input.from, shortMid, dir));
  }

  const approach = input.approach ?? pointAtDistanceFrom(input.force, midSplit, 24);
  const midDir = normalize(approach.x - midSplit.x, approach.y - midSplit.y);
  const midBranch = curveToPath(midSplit, cubicBetween(midSplit, approach, midDir));
  const forceDir = normalize(input.force.x - approach.x, input.force.y - approach.y);
  const forceBranch = curveToPath(approach, cubicBetween(approach, input.force, forceDir));

  return {
    trunk,
    midBranch,
    forceBranch,
    route: useLong ? "long-arc" : "short",
    midSplit,
  };
}
