import { beforeAll, describe, expect, test } from "bun:test";

/**
 * Contract tests for the pure geometry helpers behind the regions view's
 * branched membership edges and label de-overlap (landscape-geometry.ts, not
 * yet written — Phase 5). Guarded dynamic import: see nkp-graph.test.ts.
 */
interface Point {
  x: number;
  y: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type GeometryModule = {
  branchGeometry?: (
    from: Point,
    to: Point[],
    splitFraction?: number,
    tension?: number,
    splitAt?: Point,
  ) => { trunk: string; branches: string[]; width: number };
  nestedBranchGeometry?: (
    from: Point,
    subShapes: { forces: Point[]; approach?: Point }[],
    midSplit: Point,
    approachDistance: number,
    minTangential?: number,
  ) => {
    trunk: string;
    midBranches: string[];
    forceBranches: string[][];
    approachPoints: Point[];
    width: number;
  };
  pointAtDistanceFrom?: (target: Point, fromDirection: Point, distance: number) => Point;
  rayCircleIntersection?: (
    from: Point,
    toward: Point,
    center: Point,
    radius: number,
  ) => Point | undefined;
  rayConvexPolygonIntersection?: (
    from: Point,
    toward: Point,
    polygon: readonly Point[],
  ) => Point | undefined;
  convexHullPoints?: (points: readonly Point[]) => Point[];
  ensureForwardSplitSeparation?: (
    origin: Point,
    target: Point,
    toward: Point,
    minSeparation: number,
  ) => Point;
  nudgeLabels?: (boxes: Box[], maxShift?: number) => number[];
  projectLabelAnchor?: (
    point: Point,
    bounds: Box,
    preferredRegion?: readonly Point[],
  ) => Point;
  // --- dual-ring annulus-aware membership bundling (redesign) ---
  shouldUseLongAnnulusArc?: (
    from: Point,
    to: Point,
    center: Point,
    correctAnnulus: { inner: number; outer: number },
    wrongAnnulus: { inner: number; outer: number },
  ) => boolean;
  dualRingMembershipGeometry?: (input: {
    from: Point;
    force: Point;
    forceKind: "purpose" | "stressor";
    center: Point;
    innerAnnulusMid: number;
    outerAnnulusMid: number;
    approach?: Point;
    tangentDegrees?: number;
  }) => {
    trunk: string;
    midBranch: string;
    forceBranch: string;
    route: "short" | "long-arc";
    midSplit: Point;
  };
  longAnnulusArcPath?: (
    from: Point,
    enter: Point,
    center: Point,
    annulus: { inner: number; outer: number },
    options?: { tangentDegrees?: number; direction?: "cw" | "ccw" },
  ) => string;
};

let mod: GeometryModule = {};

beforeAll(async () => {
  mod = (await import("./landscape-geometry").catch(() => ({}))) as GeometryModule;
});

describe("branchGeometry", () => {
  test("a single target draws one curve with no trunk/branch split", () => {
    const result = mod.branchGeometry?.({ x: 0, y: 0 }, [{ x: 100, y: 0 }]);
    expect(result).toBeDefined();
    expect(result?.branches).toHaveLength(1);
    // Single-force bundles are one curve: the trunk and the lone branch should
    // trace the same path (no separate visible trunk segment).
    expect(result?.trunk).toBe(result?.branches[0]);
  });

  test("every path is a cubic bezier ('C'), never a polyline ('L')", () => {
    const result = mod.branchGeometry?.({ x: 0, y: 0 }, [{ x: 50, y: 50 }, { x: 100, y: -50 }, { x: 20, y: 80 }]);
    expect(result?.trunk).toContain("C");
    expect(result?.trunk).not.toContain("L");
    for (const branch of result?.branches ?? []) {
      expect(branch).toContain("C");
      expect(branch).not.toContain("L");
    }
  });

  test("N targets produce a trunk plus N branches", () => {
    const targets = [{ x: 10, y: 0 }, { x: 20, y: 30 }, { x: -10, y: 40 }, { x: 5, y: -20 }];
    const result = mod.branchGeometry?.({ x: 0, y: 0 }, targets);
    expect(result?.branches).toHaveLength(targets.length);
  });

  test("trunk width grows with the number of targets", () => {
    const from = { x: 0, y: 0 };
    const one = mod.branchGeometry?.(from, [{ x: 10, y: 10 }]);
    const three = mod.branchGeometry?.(from, [{ x: 10, y: 10 }, { x: -10, y: 10 }, { x: 0, y: -10 }]);
    const six = mod.branchGeometry?.(from, [
      { x: 10, y: 10 }, { x: -10, y: 10 }, { x: 0, y: -10 },
      { x: 20, y: -5 }, { x: -20, y: -5 }, { x: 0, y: 20 },
    ]);
    expect(three?.width).toBeGreaterThan(one?.width ?? 0);
    expect(six?.width).toBeGreaterThan(three?.width ?? 0);
  });

  test("branches start at the trunk's end point (the split point), not at the origin", () => {
    const from = { x: 0, y: 0 };
    const targets = [{ x: 100, y: 0 }, { x: 100, y: 100 }];
    const result = mod.branchGeometry?.(from, targets, 0.6);
    // Every branch path should start with an M command at a point strictly
    // between `from` and each target, i.e. not at (0,0) and not at a target.
    for (const branch of result?.branches ?? []) {
      const match = /^M\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/.exec(branch.trim());
      expect(match).not.toBeNull();
      const startX = Number(match?.[1]);
      const startY = Number(match?.[2]);
      expect(startX === 0 && startY === 0).toBe(false);
    }
  });

  test("splitFraction closer to 0 moves the split point closer to the origin", () => {
    const from = { x: 0, y: 0 };
    const targets = [{ x: 100, y: 0 }, { x: 0, y: 100 }];
    const early = mod.branchGeometry?.(from, targets, 0.1);
    const late = mod.branchGeometry?.(from, targets, 0.9);
    const splitPointOf = (path: string | undefined): Point | undefined => {
      const match = path ? /^M\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/.exec(path.trim()) : null;
      return match ? { x: Number(match[1]), y: Number(match[2]) } : undefined;
    };
    const earlySplit = splitPointOf(early?.branches[0]);
    const lateSplit = splitPointOf(late?.branches[0]);
    const distance = (p: Point | undefined): number => (p ? Math.hypot(p.x, p.y) : 0);
    expect(distance(earlySplit)).toBeLessThan(distance(lateSplit));
  });

  test("control points stay near the segment they shape, so curves never shoot off-screen", () => {
    const from = { x: 0, y: 0 };
    const to = [{ x: 300, y: 40 }, { x: 320, y: -60 }, { x: 260, y: 120 }];
    const { trunk, branches } = mod.branchGeometry!(from, to);
    const numbers = [trunk, ...branches].flatMap((path) => (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number));
    for (const value of numbers) expect(Math.abs(value)).toBeLessThanOrEqual(400);
  });

  test("tension defaults to 1 and reproduces the exact previous (fully bundled) geometry", () => {
    const from = { x: 0, y: 0 };
    const targets = [{ x: 50, y: 50 }, { x: 100, y: -50 }, { x: 20, y: 80 }];
    const implicit = mod.branchGeometry?.(from, targets, 0.6);
    const explicit = mod.branchGeometry?.(from, targets, 0.6, 1);
    expect(explicit).toEqual(implicit);
  });

  test("tension 0 collapses the trunk to a zero-length stub at the source, loosening the branches", () => {
    const from = { x: 0, y: 0 };
    const targets = [{ x: 50, y: 50 }, { x: 100, y: -50 }, { x: 20, y: 80 }];
    const bundled = mod.branchGeometry?.(from, targets, 0.6, 1);
    const loose = mod.branchGeometry?.(from, targets, 0.6, 0);
    expect(loose?.trunk).not.toBe(bundled?.trunk);
    expect(loose?.trunk).toContain("M 0,0"); // trunk starts and ends at `from` when the split point collapses onto it
  });

  test("tension interpolates continuously between 0 and 1", () => {
    const from = { x: 0, y: 0 };
    const targets = [{ x: 50, y: 50 }, { x: 100, y: -50 }];
    const low = mod.branchGeometry?.(from, targets, 0.6, 0.25);
    const mid = mod.branchGeometry?.(from, targets, 0.6, 0.5);
    const high = mod.branchGeometry?.(from, targets, 0.6, 0.75);
    expect(low?.trunk).not.toBe(mid?.trunk);
    expect(mid?.trunk).not.toBe(high?.trunk);
  });

  test("tension has no effect on a single-target bundle (no shared split point to loosen)", () => {
    const from = { x: 0, y: 0 };
    const target = [{ x: 10, y: 10 }];
    expect(mod.branchGeometry?.(from, target, 0.6, 0)).toEqual(mod.branchGeometry?.(from, target, 0.6, 1));
  });

  test("splitAt pins the trunk end to an explicit point (ergodic boundary)", () => {
    const from = { x: 0, y: 0 };
    const targets = [{ x: 100, y: 50 }, { x: 100, y: -50 }];
    const pinned = { x: 40, y: 0 };
    const result = mod.branchGeometry?.(from, targets, 0.6, 1, pinned);
    expect(result?.trunk).toContain("40,0");
    // Without splitAt the fraction/tension point differs from the pin.
    const unpinned = mod.branchGeometry?.(from, targets, 0.6, 1);
    expect(result?.trunk).not.toBe(unpinned?.trunk);
  });
});

describe("rayCircleIntersection", () => {
  test("hits the nearer forward intersection of a ray with a circle", () => {
    const hit = mod.rayCircleIntersection?.(
      { x: -100, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
      50,
    );
    expect(hit).toEqual({ x: -50, y: 0 });
  });

  test("returns undefined when the ray misses the circle", () => {
    expect(mod.rayCircleIntersection?.(
      { x: -100, y: 100 },
      { x: 100, y: 100 },
      { x: 0, y: 0 },
      50,
    )).toBeUndefined();
  });

  test("returns undefined when the ray points away from the circle", () => {
    expect(mod.rayCircleIntersection?.(
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 0, y: 0 },
      50,
    )).toBeUndefined();
  });
});

describe("nestedBranchGeometry", () => {
  test("trunk ends at midSplit; mid branches reach approach points; leaves reach forces", () => {
    const from = { x: 0, y: 0 };
    const midSplit = { x: 50, y: 0 };
    const result = mod.nestedBranchGeometry?.(
      from,
      [
        { forces: [{ x: 100, y: 10 }, { x: 100, y: -10 }] },
        { forces: [{ x: 120, y: 40 }] },
      ],
      midSplit,
      20,
    );
    expect(result?.trunk).toContain("50,0");
    expect(result?.midBranches).toHaveLength(2);
    expect(result?.forceBranches).toHaveLength(2);
    expect(result?.forceBranches[0]).toHaveLength(2);
    expect(result?.forceBranches[1]).toHaveLength(1);
    expect(result?.approachPoints[0]).toBeDefined();
    const approach0 = result!.approachPoints[0]!;
    // Approach sits 20 away from the sub-shape force centroid (100,0).
    expect(Math.hypot(approach0.x - 100, approach0.y - 0)).toBeCloseTo(20, 5);
  });

  test("explicit approach points override approachDistance", () => {
    const from = { x: 0, y: 0 };
    const midSplit = { x: 40, y: 0 };
    const result = mod.nestedBranchGeometry?.(
      from,
      [{ forces: [{ x: 100, y: 0 }], approach: { x: 70, y: 5 } }],
      midSplit,
      20,
    );
    expect(result?.approachPoints[0]).toEqual({ x: 70, y: 5 });
  });

  test("minTangential spreads clustered approach points apart around the mid split", () => {
    const from = { x: 0, y: 0 };
    const midSplit = { x: 40, y: 0 };
    const tight = mod.nestedBranchGeometry?.(
      from,
      [
        { forces: [{ x: 100, y: 1 }] },
        { forces: [{ x: 100, y: -1 }] },
      ],
      midSplit,
      20,
      0,
    );
    const spread = mod.nestedBranchGeometry?.(
      from,
      [
        { forces: [{ x: 100, y: 1 }] },
        { forces: [{ x: 100, y: -1 }] },
      ],
      midSplit,
      20,
      30,
    );
    expect(tight?.approachPoints).toHaveLength(2);
    expect(spread?.approachPoints).toHaveLength(2);
    const tightSep = Math.hypot(
      (tight!.approachPoints[0]!.x - tight!.approachPoints[1]!.x),
      (tight!.approachPoints[0]!.y - tight!.approachPoints[1]!.y),
    );
    const spreadSep = Math.hypot(
      (spread!.approachPoints[0]!.x - spread!.approachPoints[1]!.x),
      (spread!.approachPoints[0]!.y - spread!.approachPoints[1]!.y),
    );
    expect(spreadSep).toBeGreaterThan(tightSep);
    expect(spreadSep).toBeGreaterThanOrEqual(30 - 1e-6);
  });
});

describe("rayConvexPolygonIntersection", () => {
  test("hits the near edge of a square on the way to its center", () => {
    const hit = mod.rayConvexPolygonIntersection?.(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      [
        { x: 8, y: -4 },
        { x: 12, y: -4 },
        { x: 12, y: 4 },
        { x: 8, y: 4 },
      ],
    );
    expect(hit?.x).toBeCloseTo(8, 5);
    expect(hit?.y).toBeCloseTo(0, 5);
  });
});

describe("ensureForwardSplitSeparation", () => {
  test("pushes a coincident target forward along the ray by minSeparation", () => {
    const out = mod.ensureForwardSplitSeparation?.(
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      30,
    );
    expect(out?.x).toBeCloseTo(30, 5);
    expect(out?.y).toBeCloseTo(0, 5);
  });

  test("keeps a target already past minSeparation", () => {
    const out = mod.ensureForwardSplitSeparation?.(
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      30,
    );
    expect(out?.x).toBeCloseTo(50, 5);
  });
});

describe("nudgeLabels", () => {
  test("non-overlapping boxes get zero shift", () => {
    const boxes: Box[] = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 100, y: 100, width: 10, height: 10 },
      { x: 200, y: 0, width: 10, height: 10 },
    ];
    expect(mod.nudgeLabels?.(boxes)).toEqual([0, 0, 0]);
  });

  test("overlapping boxes are separated or their overlap is reduced", () => {
    const boxes: Box[] = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 0, y: 5, width: 20, height: 20 },
    ];
    const shifts = mod.nudgeLabels?.(boxes) ?? [];
    expect(shifts).toHaveLength(2);
    // After applying the shifts vertically, the boxes should overlap less
    // (in y-extent) than before, or not at all.
    const overlapBefore = Math.min(boxes[0]!.y + boxes[0]!.height, boxes[1]!.y + boxes[1]!.height)
      - Math.max(boxes[0]!.y, boxes[1]!.y);
    const shifted = boxes.map((box, index) => ({ ...box, y: box.y + (shifts[index] ?? 0) }));
    const overlapAfter = Math.max(0, Math.min(shifted[0]!.y + shifted[0]!.height, shifted[1]!.y + shifted[1]!.height)
      - Math.max(shifted[0]!.y, shifted[1]!.y));
    expect(overlapAfter).toBeLessThan(overlapBefore);
  });

  test("no shift ever exceeds maxShift", () => {
    const boxes: Box[] = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 0, y: 1, width: 20, height: 20 },
      { x: 0, y: 2, width: 20, height: 20 },
      { x: 0, y: 3, width: 20, height: 20 },
    ];
    const shifts = mod.nudgeLabels?.(boxes, 12) ?? [];
    for (const shift of shifts) {
      expect(Math.abs(shift)).toBeLessThanOrEqual(12);
    }
  });

  test("is deterministic: the same input always yields the same output", () => {
    const boxes: Box[] = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 5, y: 8, width: 20, height: 20 },
      { x: -3, y: 12, width: 20, height: 20 },
    ];
    const first = mod.nudgeLabels?.(boxes);
    const second = mod.nudgeLabels?.(boxes);
    expect(first).toEqual(second);
  });

  test("defaults maxShift to 12 when omitted", () => {
    const boxes: Box[] = Array.from({ length: 5 }, (_, i) => ({ x: 0, y: i, width: 20, height: 20 }));
    const withDefault = mod.nudgeLabels?.(boxes) ?? [];
    const withExplicit = mod.nudgeLabels?.(boxes, 12) ?? [];
    expect(withDefault).toEqual(withExplicit);
  });
});

describe("visible label anchors", () => {
  const bounds = { x: 0, y: 0, width: 200, height: 100 };

  test("keeps an onscreen anchor unchanged", () => {
    expect(mod.projectLabelAnchor?.({ x: 80, y: 40 }, bounds)).toEqual({ x: 80, y: 40 });
  });

  test("projects an offscreen anchor onto the visible graph", () => {
    const projected = mod.projectLabelAnchor?.({ x: 500, y: -300 }, bounds);
    expect(projected).toBeDefined();
    expect(projected!.x).toBeGreaterThanOrEqual(bounds.x);
    expect(projected!.x).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(projected!.y).toBeGreaterThanOrEqual(bounds.y);
    expect(projected!.y).toBeLessThanOrEqual(bounds.y + bounds.height);
  });

  test("prefers a visible point in an attractor region before projecting to graph bounds", () => {
    const region = [{ x: 160, y: 20 }, { x: 195, y: 20 }, { x: 180, y: 70 }];
    const projected = mod.projectLabelAnchor?.({ x: 500, y: 500 }, bounds, region);
    expect(projected).toBeDefined();
    expect(projected!.x).toBeGreaterThanOrEqual(160);
    expect(projected!.x).toBeLessThanOrEqual(195);
    expect(projected!.y).toBeGreaterThanOrEqual(20);
    expect(projected!.y).toBeLessThanOrEqual(70);
  });
});

describe("shouldUseLongAnnulusArc (dual-ring)", () => {
  const center = { x: 0, y: 0 };
  const inner = { inner: 80, outer: 120 };
  const outer = { inner: 200, outer: 240 };

  test("short radial hop into the correct annulus stays short", () => {
    // Component in the band between annuli → purpose on the inner mid ray.
    expect(mod.shouldUseLongAnnulusArc?.(
      { x: 150, y: 0 },
      { x: 100, y: 0 },
      center,
      inner,
      outer,
    )).toBe(false);
  });

  test("a chord that crosses the wrong annulus requests a long arc", () => {
    // From outer-side component, targeting an inner-annulus mid across the outer band.
    expect(mod.shouldUseLongAnnulusArc?.(
      { x: 300, y: 0 },
      { x: 100, y: 80 },
      center,
      inner,
      outer,
    )).toBe(true);
  });

  test("a chord that enters the correct annulus twice also requests a long arc", () => {
    // Vertical chord through the inner annulus, the hole, then the annulus again.
    expect(mod.shouldUseLongAnnulusArc?.(
      { x: 0, y: 200 },
      { x: 0, y: -200 },
      center,
      inner,
      outer,
    )).toBe(true);
  });
});

describe("dualRingMembershipGeometry (dual-ring)", () => {
  const center = { x: 0, y: 0 };

  test("purpose uses the inner annulus mid on a short route when clear", () => {
    const result = mod.dualRingMembershipGeometry?.({
      from: { x: 160, y: 0 },
      force: { x: 60, y: 0 },
      forceKind: "purpose",
      center,
      innerAnnulusMid: 100,
      outerAnnulusMid: 220,
    });
    expect(result).toBeDefined();
    expect(result!.route).toBe("short");
    expect(result!.trunk).toContain("C");
    expect(result!.midBranch).toContain("C");
    expect(result!.forceBranch).toContain("C");
    expect(Math.hypot(result!.midSplit.x, result!.midSplit.y)).toBeCloseTo(100, 0);
  });

  test("stressor long-arc route is selected when the short hop would hit the inner annulus", () => {
    const result = mod.dualRingMembershipGeometry?.({
      from: { x: 40, y: 0 },
      force: { x: 240, y: 40 },
      forceKind: "stressor",
      center,
      innerAnnulusMid: 100,
      outerAnnulusMid: 220,
      tangentDegrees: 10,
    });
    expect(result).toBeDefined();
    expect(result!.route).toBe("long-arc");
    expect(result!.trunk).toContain("C");
  });
});

describe("longAnnulusArcPath (dual-ring)", () => {
  test("emits a cubic that ends near the annulus mid radius", () => {
    const path = mod.longAnnulusArcPath?.(
      { x: 160, y: 0 },
      { x: 0, y: 220 },
      { x: 0, y: 0 },
      { inner: 200, outer: 240 },
      { tangentDegrees: 10, direction: "ccw" },
    );
    expect(path).toBeDefined();
    expect(path).toContain("C");
    const match = /C[\s\d.,\-]+?\s(-?[\d.]+),(-?[\d.]+)\s*$/.exec(path ?? "");
    // End point of the cubic is the last pair after C's six numbers — parse via matchAll.
    const nums = [...(path ?? "").matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const endX = nums[nums.length - 2]!;
    const endY = nums[nums.length - 1]!;
    expect(Math.hypot(endX, endY)).toBeCloseTo(220, 0);
    void match;
  });
});
