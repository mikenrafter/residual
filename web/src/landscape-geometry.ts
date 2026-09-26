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

export function branchGeometry(
  from: Point,
  to: Point[],
  splitFraction = 0.6,
  tension = 1,
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
  const split = clamp(splitFraction, 0.05, 0.95);
  const rawSplitPoint: Point = {
    x: from.x + (center.x - from.x) * split,
    y: from.y + (center.y - from.y) * split,
  };
  // tension blends the raw (fully bundled) split point back toward `from`:
  // tension=1 reproduces the raw split point exactly; tension=0 collapses
  // the trunk to a zero-length stub at the source.
  const splitPoint: Point = {
    x: from.x + (rawSplitPoint.x - from.x) * tension,
    y: from.y + (rawSplitPoint.y - from.y) * tension,
  };
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
