import { beforeAll, describe, expect, test } from "bun:test";
import {
  assignForcesToSubShapes,
  axialDistance,
  axialHopStep,
  axialKey,
  axialToPixel,
  dilateAxialOneLayer,
  dilatedSubshapeApproach,
  LATTICE_HOP_THRESHOLD,
  nearestFreeAxialPoint,
  previewNearestFreeAxialPoint,
  axialRing,
  rotateAxial,
  rotateAxialOffsets,
  TRI_LATTICE_SPACING,
  type ForceShapeGroup,
  type SimilarityForce,
} from "./landscape-triangular-lattice";

describe("rotateAxial / rotateAxialOffsets", () => {
  test("six 60° steps return to the start", () => {
    const start = { q: 2, r: -1 };
    let point = start;
    for (let i = 0; i < 6; i += 1) point = rotateAxial(point, 1);
    expect(point).toEqual(start);
  });

  test("rotateAxialOffsets preserves pairwise distances", () => {
    const offsets = new Map([
      ["a", { q: 0, r: 0 }],
      ["b", { q: 1, r: 0 }],
      ["c", { q: 0, r: 1 }],
    ]);
    const { offsets: rotated } = rotateAxialOffsets(offsets, 2);
    expect(axialDistance(rotated.get("a")!, rotated.get("b")!)).toBe(1);
    expect(axialDistance(rotated.get("a")!, rotated.get("c")!)).toBe(1);
    expect(axialDistance(rotated.get("b")!, rotated.get("c")!)).toBe(1);
  });
});

describe("dilateAxialOneLayer / dilatedSubshapeApproach", () => {
  test("singleton dilates to itself plus six neighbors", () => {
    const dilated = dilateAxialOneLayer([{ q: 0, r: 0 }]);
    expect(dilated).toHaveLength(7);
    expect(dilated).toContainEqual({ q: 0, r: 0 });
    expect(dilated).toContainEqual({ q: 1, r: 0 });
  });

  test("approach sits on the dilated hull, one lattice layer outside a singleton", () => {
    const origin = { x: 0, y: 0 };
    const force = axialToPixel({ q: 3, r: 0 }, TRI_LATTICE_SPACING, origin);
    const fromOutside = { x: 0, y: 0 };
    const approach = dilatedSubshapeApproach([force], fromOutside, TRI_LATTICE_SPACING, origin);
    // Neighbor ring around the force is at spacing from the hub.
    expect(Math.hypot(approach.x - force.x, approach.y - force.y)).toBeCloseTo(TRI_LATTICE_SPACING, 5);
    // And it lies on the ray from outside through the force.
    const cross = approach.x * force.y - approach.y * force.x;
    expect(Math.abs(cross)).toBeLessThan(1e-6);
    expect(Math.hypot(approach.x, approach.y)).toBeLessThan(Math.hypot(force.x, force.y));
  });

  test("pill approach is farther from the near tip than a centroid hop would be", () => {
    const origin = { x: 0, y: 0 };
    const a = axialToPixel({ q: 4, r: 0 }, TRI_LATTICE_SPACING, origin);
    const b = axialToPixel({ q: 5, r: 0 }, TRI_LATTICE_SPACING, origin);
    const fromOutside = { x: 0, y: 0 };
    const approach = dilatedSubshapeApproach([a, b], fromOutside, TRI_LATTICE_SPACING, origin);
    const hub = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Dilated outer edge is outside the nearer force cell, not merely one hop from hub.
    expect(Math.hypot(approach.x - hub.x, approach.y - hub.y)).toBeGreaterThan(TRI_LATTICE_SPACING * 0.5);
    expect(Math.hypot(approach.x, approach.y)).toBeLessThan(Math.hypot(a.x, a.y) + 1e-6);
  });
});

describe("assignForcesToSubShapes", () => {
  function force(id: string, components: string[], kind: "stressor" | "purpose"): SimilarityForce {
    return { id, components, kind };
  }

  test("tightly clustered forces are spread across different bins", () => {
    const forces: SimilarityForce[] = [
      force("f1", ["c1", "c2", "c3"], "stressor"),
      force("f2", ["c1", "c2", "c3"], "stressor"),
      force("f3", ["c1", "c2"], "stressor"),
      force("f4", ["c9"], "purpose"),
      force("f5", ["c10"], "purpose"),
    ];
    const bins = assignForcesToSubShapes(forces, [3, 2]);
    const binOf = (id: string): number => bins.findIndex((bin) => bin.includes(id));
    // f1, f2, f3 share nearly all components; at least two of them must land apart.
    const clusterBins = new Set([binOf("f1"), binOf("f2"), binOf("f3")]);
    expect(clusterBins.size).toBeGreaterThan(1);
  });

  test("respects sub-shape capacities exactly", () => {
    const forces: SimilarityForce[] = Array.from({ length: 7 }, (_, i) =>
      force(`f${i}`, [`c${i % 3}`], i % 2 === 0 ? "stressor" : "purpose"));
    const bins = assignForcesToSubShapes(forces, [3, 4]);
    expect(bins[0]).toHaveLength(3);
    expect(bins[1]).toHaveLength(4);
  });

  test("stressor/purpose imbalance across bins stays within 1", () => {
    const forces: SimilarityForce[] = [
      ...Array.from({ length: 6 }, (_, i) => force(`s${i}`, [`c${i}`], "stressor" as const)),
      ...Array.from({ length: 2 }, (_, i) => force(`p${i}`, [`d${i}`], "purpose" as const)),
    ];
    const bins = assignForcesToSubShapes(forces, [4, 4]);
    const forceById = new Map(forces.map((f) => [f.id, f]));
    const stressorCounts = bins.map((bin) => bin.filter((id) => forceById.get(id)!.kind === "stressor").length);
    expect(Math.abs(stressorCounts[0]! - stressorCounts[1]!)).toBeLessThanOrEqual(1);
  });
});

describe("previewNearestFreeAxialPoint", () => {
  test("returns the same point the real commit function would pick for identical input", () => {
    const occupied = new Set(["0:0", "1:0", "0:1"]);
    const point = { x: 37, y: -12 };
    expect(previewNearestFreeAxialPoint(point, occupied)).toEqual(nearestFreeAxialPoint(point, occupied));
  });

  test("does not mutate the occupied set", () => {
    const occupied = new Set(["0:0"]);
    previewNearestFreeAxialPoint({ x: 0, y: 0 }, occupied);
    expect(occupied).toEqual(new Set(["0:0"]));
  });
});

describe("axialHopStep / hop threshold helpers", () => {
  test("returns null when the fractional target is nearest to the current cell", () => {
    expect(axialHopStep({ q: 0, r: 0 }, { q: 0.2, r: -0.1 })).toBeNull();
  });

  test("steps toward a far fractional target", () => {
    expect(axialHopStep({ q: 0, r: 0 }, { q: 2.4, r: 0 })).toEqual({ q: 1, r: 0 });
  });

  test("LATTICE_HOP_THRESHOLD is past halfway", () => {
    expect(LATTICE_HOP_THRESHOLD).toBeGreaterThan(0.5);
    expect(LATTICE_HOP_THRESHOLD).toBeLessThan(1);
  });
});

/**
 * Dual-ring mini-pyramid redesign (tall-before-wide). New exports are loaded
 * dynamically so missing names fail as undefined assertions, not import errors.
 */
type DualRingLatticeModule = {
  curvedLatticePathPoints?: (
    from: { x: number; y: number },
    to: { x: number; y: number },
    origin: { x: number; y: number },
    options?: { curvature?: number; samples?: number },
  ) => Array<{ x: number; y: number }>;
  angularStepsForRing?: (stack: unknown, ring: number) => number;
  axialToDualRingPixel?: (
    cell: { q: number; r: number },
    proj: { origin: { x: number; y: number }; spacing: number; stack: unknown },
  ) => { x: number; y: number };
  pixelToDualRingAxial?: (
    point: { x: number; y: number },
    proj: { origin: { x: number; y: number }; spacing: number; stack: unknown },
    ringBounds?: { min: number; max: number },
  ) => { q: number; r: number };
  dualRingZoneMeshPaths?: (
    proj: { origin: { x: number; y: number }; spacing: number; stack: unknown },
    zone: { minRing: number; maxRing: number },
    samples?: number,
  ) => Array<Array<{ x: number; y: number }>>;
  purposeLatticeProjection?: (proj: {
    origin: { x: number; y: number };
    spacing: number;
    stack: any;
  }) => { origin: { x: number; y: number }; spacing: number; stack: any };
  nearestFreeDualRingCell?: (
    point: { x: number; y: number },
    occupiedKeys: ReadonlySet<string>,
    proj: { origin: { x: number; y: number }; spacing: number; stack: unknown },
    ringBounds: { min: number; max: number },
    preferredFrom?: { x: number; y: number },
  ) => { q: number; r: number };
  miniPyramidLayersForCount?: (n: number) => number[];
  partitionMiniPyramidLayers?: (layers: readonly number[]) => Array<{
    kind: string;
    cells: Array<{ q: number; r: number }>;
    layerIndex?: number;
  }>;
  miniPyramidCellsForLayers?: (
    layers: readonly number[],
    orientation?: { apexToward: "center" | "outward" },
  ) => Array<{ q: number; r: number }>;
  dualRingSlotsForMiniPyramids?: (
    baseWidths: readonly number[],
    options?: { gapNodes?: number; emptyPlaceholderSlots?: number },
  ) => number;
  layoutAttractorDualRingMiniPyramids?: (
    groups: Array<{
      attractorId: string;
      forces: SimilarityForce[];
      anchor: { q: number; r: number };
    }>,
    rings: { purposeRing: number; stressorRing: number; purposeCellCount: number; stressorCellCount: number },
  ) => {
    targets: Map<string, { q: number; r: number }>;
    purposeSubShapesByAttractor: Map<string, string[][]>;
    stressorSubShapesByAttractor: Map<string, string[][]>;
    purposeSlotOccupancy?: boolean[];
    stressorSlotOccupancy?: boolean[];
  };
  dualRingRadialStack?: (input: {
    purposeBaseWidths: readonly number[];
    purposeHeights: readonly number[];
    stressorBaseWidths: readonly number[];
    stressorHeights: readonly number[];
    spacing?: number;
  }) => {
    purposeRingRadius: number;
    innerAnnulus: { inner: number; outer: number; hops: number };
    componentBand: { inner: number; outer: number; hops: number };
    outerAnnulus: { inner: number; outer: number; hops: number };
    stressorRingRadius: number;
    stressorRingOuterRadius: number;
  };
  snapPyramidTopsToSharedRay?: (
    purposeTop: { q: number; r: number } | { x: number; y: number },
    stressorTop: { q: number; r: number } | { x: number; y: number },
    center: { x: number; y: number },
    spacing?: number,
  ) => {
    purpose: { q: number; r: number };
    stressor: { q: number; r: number };
    rayAngle: number;
    purposeOffSteps: number;
    stressorOffSteps: number;
  };
  assignForcesToMiniPyramidLayers?: (
    forces: SimilarityForce[],
    layers: readonly number[],
  ) => string[][];
};

let dualRing: DualRingLatticeModule = {};

describe("miniPyramidLayersForCount (dual-ring redesign)", () => {
  beforeAll(async () => {
    dualRing = (await import("./landscape-triangular-lattice").catch(() => ({}))) as DualRingLatticeModule;
  });

  test.each([
    [1, [1]],
    [2, [2]],
    [3, [2, 1]],
    [4, [3, 1]],
    [5, [3, 2]],
    [6, [3, 2, 1]],
    [7, [4, 3]],
    [8, [4, 3, 1]],
    [9, [4, 3, 2]],
    [10, [4, 3, 2, 1]],
    [11, [5, 4, 2]],
    [12, [5, 4, 3]],
    [13, [5, 4, 3, 1]],
    [14, [5, 4, 3, 2]],
    [15, [5, 4, 3, 2, 1]],
    [16, [6, 5, 4, 1]],
  ] as const)("n=%i → %j (tall-before-wide)", (n, expected) => {
    expect(dualRing.miniPyramidLayersForCount?.(n)).toEqual([...expected]);
  });

  test("layer widths always sum to n", () => {
    for (let n = 1; n <= 40; n += 1) {
      const layers = dualRing.miniPyramidLayersForCount?.(n) ?? [];
      expect(layers.reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

});

describe("partitionMiniPyramidLayers (layers only, no triangles)", () => {
  beforeAll(async () => {
    dualRing = (await import("./landscape-triangular-lattice").catch(() => ({}))) as DualRingLatticeModule;
  });

  test("one subshape per layer for 3:2:1", () => {
    const parts = dualRing.partitionMiniPyramidLayers?.([3, 2, 1]) ?? [];
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.cells.length)).toEqual([3, 2, 1]);
    expect(parts.every((p) => p.kind !== "triangle")).toBe(true);
  });

  test("never emits triangle subshapes across common sizes", () => {
    for (const n of [1, 2, 3, 5, 6, 9, 10, 15]) {
      const layers = dualRing.miniPyramidLayersForCount?.(n) ?? [];
      const parts = dualRing.partitionMiniPyramidLayers?.(layers) ?? [];
      expect(parts).toHaveLength(layers.length);
      expect(parts.every((p) => p.kind !== "triangle")).toBe(true);
      expect(parts.reduce((sum, p) => sum + p.cells.length, 0)).toBe(n);
    }
  });

  test("assignForcesToMiniPyramidLayers respects layer capacities", () => {
    const forces: SimilarityForce[] = Array.from({ length: 6 }, (_, i) => ({
      id: `f${i}`,
      components: [`c${i % 3}`],
      kind: i % 2 === 0 ? "stressor" : "purpose",
    }));
    const layers = dualRing.miniPyramidLayersForCount?.(6) ?? [3, 2, 1];
    const bins = dualRing.assignForcesToMiniPyramidLayers?.(forces, layers) ?? [];
    expect(bins).toHaveLength(layers.length);
    expect(bins.map((b) => b.length)).toEqual(layers);
    expect(new Set(bins.flat()).size).toBe(6);
  });
});

describe("miniPyramidCellsForLayers orientation", () => {
  beforeAll(async () => {
    dualRing = (await import("./landscape-triangular-lattice").catch(() => ({}))) as DualRingLatticeModule;
  });

  test("purpose orientation: apex toward center (smaller |r| / inward), base faces components", () => {
    const cells = dualRing.miniPyramidCellsForLayers?.([3, 2], { apexToward: "center" }) ?? [];
    expect(cells).toHaveLength(5);
    const byR = new Map<number, number>();
    for (const cell of cells) byR.set(cell.r, (byR.get(cell.r) ?? 0) + 1);
    const rs = [...byR.keys()].sort((a, b) => a - b);
    expect(byR.get(rs[rs.length - 1]!)).toBe(3);
    expect(byR.get(rs[0]!)).toBe(2);
  });

  test("stressor orientation: apex outward, base faces components (inward)", () => {
    const cells = dualRing.miniPyramidCellsForLayers?.([3, 2], { apexToward: "outward" }) ?? [];
    expect(cells).toHaveLength(5);
    const byR = new Map<number, number>();
    for (const cell of cells) byR.set(cell.r, (byR.get(cell.r) ?? 0) + 1);
    const rs = [...byR.keys()].sort((a, b) => a - b);
    expect(byR.get(rs[0]!)).toBe(3);
    expect(byR.get(rs[rs.length - 1]!)).toBe(2);
  });

  test("every layer shares the same right-aligned edge", () => {
    const cells = dualRing.miniPyramidCellsForLayers?.([4, 3, 2, 1], { apexToward: "outward" }) ?? [];
    const byLayer = new Map<number, number[]>();
    for (const cell of cells) byLayer.set(cell.r, [...(byLayer.get(cell.r) ?? []), cell.q]);
    for (const [, cols] of byLayer) {
      expect(Math.max(...cols)).toBe(3);
    }
  });

  test("uses an even horizontal footprint for every vertical layer", () => {
    const single = dualRing.miniPyramidCellsForLayers?.([1], { apexToward: "outward" }) ?? [];
    expect(single).toEqual([{ q: 1, r: 0 }]);

    const cells = dualRing.miniPyramidCellsForLayers?.([3, 2, 1], { apexToward: "outward" }) ?? [];
    const byLayer = new Map<number, number[]>();
    for (const cell of cells) byLayer.set(cell.r, [...(byLayer.get(cell.r) ?? []), cell.q]);
    expect(byLayer.get(0)?.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(byLayer.get(1)?.sort((a, b) => a - b)).toEqual([2, 3]);
    expect(byLayer.get(2)?.sort((a, b) => a - b)).toEqual([3]);
  });
});

describe("dualRingSlotsForMiniPyramids (gap 0 + empty placeholders)", () => {
  beforeAll(async () => {
    dualRing = (await import("./landscape-triangular-lattice").catch(() => ({}))) as DualRingLatticeModule;
  });

  test("gap 0: slot count uses each base's even horizontal footprint", () => {
    expect(dualRing.dualRingSlotsForMiniPyramids?.([3, 5, 2], { gapNodes: 0 })).toBe(4 + 6 + 2);
  });

  test("empty kind uses a 2-wide placeholder instead of a zero-width hole", () => {
    // One attractor present (base 4) plus one attractor missing this kind → +2 placeholder.
    expect(dualRing.dualRingSlotsForMiniPyramids?.([4], { gapNodes: 0, emptyPlaceholderSlots: 2 })).toBe(4 + 2);
  });
});

describe("layoutAttractorDualRingMiniPyramids", () => {
  beforeAll(async () => {
    dualRing = (await import("./landscape-triangular-lattice").catch(() => ({}))) as DualRingLatticeModule;
  });

  function makeForces(
    attractorId: string,
    purposes: number,
    stressors: number,
  ): SimilarityForce[] {
    return [
      ...Array.from({ length: purposes }, (_, i) => ({
        id: `${attractorId}-p${i}`,
        components: [`${attractorId}-c${i % 2}`],
        kind: "purpose" as const,
      })),
      ...Array.from({ length: stressors }, (_, i) => ({
        id: `${attractorId}-s${i}`,
        components: [`${attractorId}-c${i % 2}`],
        kind: "stressor" as const,
      })),
    ];
  }

  test("places purposes on the inner ring and stressors on the outer ring", () => {
    const groups = [
      { attractorId: "A", forces: makeForces("A", 3, 4), anchor: { q: 0, r: 0 } },
      { attractorId: "B", forces: makeForces("B", 2, 2), anchor: { q: 0, r: 0 } },
    ];
    const layout = dualRing.layoutAttractorDualRingMiniPyramids?.(groups, {
      purposeRing: 4,
      stressorRing: 8,
      purposeCellCount: 24,
      stressorCellCount: 48,
    });
    expect(layout).toBeDefined();
    expect(layout!.targets.size).toBe(3 + 4 + 2 + 2);
    for (const force of groups.flatMap((g) => g.forces)) {
      const cell = layout!.targets.get(force.id)!;
      // `cell.r` is the global ring index directly now (no hex cube distance):
      // purpose bases sit at ring 4 and recede inward; stressor bases sit at
      // ring 8 and recede outward.
      if (force.kind === "purpose") expect(cell.r).toBeLessThanOrEqual(4);
      else expect(cell.r).toBeGreaterThanOrEqual(8);
    }
  });

  test("missing purposes leave a 2-wide empty gap on the purpose ring", () => {
    const groups = [
      { attractorId: "A", forces: makeForces("A", 0, 3), anchor: { q: 0, r: 0 } },
      { attractorId: "B", forces: makeForces("B", 2, 2), anchor: { q: 0, r: 0 } },
    ];
    const layout = dualRing.layoutAttractorDualRingMiniPyramids?.(groups, {
      purposeRing: 5,
      stressorRing: 9,
      purposeCellCount: 24,
      stressorCellCount: 48,
    });
    expect(layout).toBeDefined();
    expect(layout!.purposeSubShapesByAttractor.get("A") ?? []).toEqual([]);
    const occupancy = layout!.purposeSlotOccupancy;
    expect(occupancy).toBeDefined();
    // At least one run of two consecutive free slots for the empty-purpose attractor.
    const freeRuns: number[] = [];
    let run = 0;
    for (const filled of occupancy ?? []) {
      if (!filled) run += 1;
      else {
        if (run > 0) freeRuns.push(run);
        run = 0;
      }
    }
    if (run > 0) freeRuns.push(run);
    expect(freeRuns.some((r) => r >= 2)).toBe(true);
  });

  test("missing stressors leave a 2-wide empty gap on the stressor ring", () => {
    const groups = [
      { attractorId: "A", forces: makeForces("A", 3, 0), anchor: { q: 0, r: 0 } },
      { attractorId: "B", forces: makeForces("B", 1, 2), anchor: { q: 0, r: 0 } },
    ];
    const layout = dualRing.layoutAttractorDualRingMiniPyramids?.(groups, {
      purposeRing: 5,
      stressorRing: 9,
      purposeCellCount: 24,
      stressorCellCount: 48,
    });
    expect(layout!.stressorSubShapesByAttractor.get("A") ?? []).toEqual([]);
    const occupancy = layout!.stressorSlotOccupancy;
    expect(occupancy).toBeDefined();
    let maxFree = 0;
    let run = 0;
    for (const filled of occupancy ?? []) {
      if (!filled) {
        run += 1;
        maxFree = Math.max(maxFree, run);
      } else run = 0;
    }
    expect(maxFree).toBeGreaterThanOrEqual(2);
  });

  test("stressor placement reserves the padded slot of a single-cell pyramid", () => {
    const groups = [
      { attractorId: "A", forces: makeForces("A", 0, 1), anchor: { q: 0, r: 0 } },
      { attractorId: "B", forces: makeForces("B", 0, 0), anchor: { q: 0, r: 0 } },
      { attractorId: "C", forces: makeForces("C", 0, 1), anchor: { q: 0, r: 0 } },
    ];
    const layout = dualRing.layoutAttractorDualRingMiniPyramids?.(groups, {
      purposeRing: 2,
      stressorRing: 4,
      purposeCellCount: 4,
      stressorCellCount: 4,
    });
    const first = layout!.targets.get("A-s0")!;
    const second = layout!.targets.get("C-s0")!;
    expect(first.q).toBe(1);
    expect(second.q).toBe(3);
  });

  test("subshapes are layer partitions (one bin per layer), not triangles", () => {
    const groups = [
      { attractorId: "A", forces: makeForces("A", 6, 6), anchor: { q: 0, r: 0 } },
    ];
    const layout = dualRing.layoutAttractorDualRingMiniPyramids?.(groups, {
      purposeRing: 5,
      stressorRing: 10,
      purposeCellCount: 30,
      stressorCellCount: 60,
    });
    const purposeLayers = dualRing.miniPyramidLayersForCount?.(6) ?? [];
    const stressorLayers = dualRing.miniPyramidLayersForCount?.(6) ?? [];
    expect(layout!.purposeSubShapesByAttractor.get("A")).toHaveLength(purposeLayers.length);
    expect(layout!.stressorSubShapesByAttractor.get("A")).toHaveLength(stressorLayers.length);
    expect(layout!.purposeSubShapesByAttractor.get("A")!.map((b) => b.length)).toEqual(purposeLayers);
    expect(layout!.stressorSubShapesByAttractor.get("A")!.map((b) => b.length)).toEqual(stressorLayers);
  });
});

describe("dualRingRadialStack (center→out)", () => {
  beforeAll(async () => {
    dualRing = (await import("./landscape-triangular-lattice").catch(() => ({}))) as DualRingLatticeModule;
  });

  test("orders radii: purpose < inner annulus < components < outer annulus < stressors", () => {
    const stack = dualRing.dualRingRadialStack?.({
      purposeBaseWidths: [3, 2],
      purposeHeights: [2, 1],
      stressorBaseWidths: [4, 3],
      stressorHeights: [2, 1],
    });
    expect(stack).toBeDefined();
    expect(stack!.purposeRingRadius).toBeLessThanOrEqual(stack!.innerAnnulus.inner);
    expect(stack!.innerAnnulus.outer).toBeLessThanOrEqual(stack!.componentBand.inner + 1e-6);
    expect(stack!.componentBand.outer).toBeLessThanOrEqual(stack!.outerAnnulus.inner + 1e-6);
    expect(stack!.outerAnnulus.outer).toBeLessThanOrEqual(stack!.stressorRingRadius + 1e-6);
    expect(stack!.stressorRingRadius).toBeLessThan(stack!.stressorRingOuterRadius);
  });

  test("component band is exactly 3 hops and reaches out with the tallest stressor pyramid plus 3 hops", () => {
    const stack = dualRing.dualRingRadialStack?.({
      purposeBaseWidths: [2],
      purposeHeights: [1],
      stressorBaseWidths: [2],
      stressorHeights: [4],
      spacing: TRI_LATTICE_SPACING,
    });
    expect(stack!.componentBand.hops).toBe(3);
    const stressorHops = (stack!.stressorRingOuterRadius - stack!.stressorRingRadius) / TRI_LATTICE_SPACING;
    expect(stressorHops).toBeCloseTo(4 + 3, 5);
  });
});

describe("polar dual-ring lattice (radial ring, angular slot; no hex axial anywhere)", () => {
  beforeAll(async () => {
    dualRing = (await import("./landscape-triangular-lattice").catch(() => ({}))) as DualRingLatticeModule;
  });

  function makeStack() {
    return dualRing.dualRingRadialStack?.({
      purposeBaseWidths: [3],
      purposeHeights: [2],
      stressorBaseWidths: [3],
      stressorHeights: [3],
      spacing: TRI_LATTICE_SPACING,
    })!;
  }

  test("angularStepsForRing returns each zone's own fixed angular count, not 6×ring", () => {
    const stack = makeStack();
    expect(dualRing.angularStepsForRing?.(stack, 1)).toBe((stack as any).purposeAngularSteps);
    expect(dualRing.angularStepsForRing?.(stack, stack.componentBand ? (stack as any).componentInnerAxial : 0))
      .toBe((stack as any).componentAngularSteps);
    expect(dualRing.angularStepsForRing?.(stack, (stack as any).stressorRingAxial))
      .toBe((stack as any).stressorAngularSteps);
  });

  test("purpose area doubles vertical lattice layers while keeping its radial height", () => {
    const stack = makeStack();
    const proj = { origin: { x: 0, y: 0 }, spacing: TRI_LATTICE_SPACING, stack };
    const purposeProj = dualRing.purposeLatticeProjection?.(proj);
    expect(purposeProj).toBeDefined();
    const full = dualRing.axialToDualRingPixel?.({ q: 0, r: stack.purposeRingAxial }, proj)!;
    expect(stack.purposeRingAxial).toBe(4);
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(stack.purposeRingRadius, 5);
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(
      (stack.purposeRingAxial / 2) * TRI_LATTICE_SPACING,
      5,
    );
    expect(stack.purposeAngularSteps).toBe(13);
    expect(purposeProj).toBe(proj);
  });

  test("a mesh vertex from dualRingZoneMeshPaths is exactly axialToDualRingPixel for that cell", () => {
    const stack = makeStack();
    const proj = { origin: { x: 0, y: 0 }, spacing: TRI_LATTICE_SPACING, stack };
    const componentInner = (stack as any).componentInnerAxial as number;
    const componentOuter = (stack as any).componentOuterAxial as number;
    const paths = dualRing.dualRingZoneMeshPaths?.(proj, { minRing: componentInner, maxRing: componentOuter }) ?? [];
    expect(paths.length).toBeGreaterThan(0);
    // Every path's first point is a real vertex: ring=componentInner, some slot.
    const cellCount = dualRing.angularStepsForRing?.(stack, componentInner) ?? 1;
    for (const path of paths.slice(0, cellCount)) {
      const first = path[0]!;
      // Its radius must match the real cell radius for ring=componentInner exactly.
      const cell0 = dualRing.axialToDualRingPixel?.({ q: 0, r: componentInner }, proj)!;
      const radius0 = Math.hypot(cell0.x - proj.origin.x, cell0.y - proj.origin.y);
      const radiusFirst = Math.hypot(first.x - proj.origin.x, first.y - proj.origin.y);
      expect(radiusFirst).toBeCloseTo(radius0, 5);
    }
  });

  test("pixelToDualRingAxial inverts axialToDualRingPixel for a real cell, clamped to a zone's ring bounds", () => {
    const stack = makeStack();
    const proj = { origin: { x: 400, y: 300 }, spacing: TRI_LATTICE_SPACING, stack };
    const componentInner = (stack as any).componentInnerAxial as number;
    const componentOuter = (stack as any).componentOuterAxial as number;
    const cell = { q: 2, r: componentInner + 1 };
    const point = dualRing.axialToDualRingPixel?.(cell, proj)!;
    const recovered = dualRing.pixelToDualRingAxial?.(point, proj, { min: componentInner, max: componentOuter });
    expect(recovered).toEqual(cell);
  });

  test("dual-sprocket columns bow counter-clockwise as they move through a zone", () => {
    const stack = makeStack();
    const proj = { origin: { x: 0, y: 0 }, spacing: TRI_LATTICE_SPACING, stack };
    const inner = (stack as any).componentInnerAxial as number;
    const outer = (stack as any).componentOuterAxial as number;
    const start = dualRing.axialToDualRingPixel?.({ q: 0, r: inner }, proj)!;
    const end = dualRing.axialToDualRingPixel?.({ q: 0, r: outer }, proj)!;
    const startAngle = Math.atan2(start.y, start.x);
    const endAngle = Math.atan2(end.y, end.x);
    expect(endAngle).toBeLessThan(startAngle);
  });

  test("the two lattice line families curve equally in opposite directions", () => {
    const stack = makeStack();
    const proj = { origin: { x: 0, y: 0 }, spacing: TRI_LATTICE_SPACING, stack };
    const inner = (stack as any).componentInnerAxial as number;
    const outer = (stack as any).componentOuterAxial as number;
    const paths = dualRing.dualRingZoneMeshPaths?.(proj, { minRing: inner, maxRing: outer }, 6) ?? [];
    const bend = (path: Array<{ x: number; y: number }>): number => {
      const start = Math.atan2(path[0]!.y, path[0]!.x);
      const end = Math.atan2(path[path.length - 1]!.y, path[path.length - 1]!.x);
      const middle = Math.atan2(path[Math.floor(path.length / 2)]!.y, path[Math.floor(path.length / 2)]!.x);
      let expected = start + (end - start) / 2;
      let delta = middle - expected;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      return delta;
    };
    const clockwise = bend(paths[0]!);
    const counterClockwise = bend(paths[1]!);
    expect(clockwise).toBeLessThan(0);
    expect(counterClockwise).toBeGreaterThan(0);
    expect(Math.abs(clockwise)).toBeCloseTo(Math.abs(counterClockwise), 5);
  });

  test("nearestFreeDualRingCell never returns a cell outside the given ring bounds", () => {
    const stack = makeStack();
    const proj = { origin: { x: 0, y: 0 }, spacing: TRI_LATTICE_SPACING, stack };
    const componentInner = (stack as any).componentInnerAxial as number;
    const componentOuter = (stack as any).componentOuterAxial as number;
    // A point far outside the component band (near the true center).
    const cell = dualRing.nearestFreeDualRingCell?.(
      { x: 0.001, y: 0.001 },
      new Set(),
      proj,
      { min: componentInner, max: componentOuter },
    );
    expect(cell).toBeDefined();
    expect(cell!.r).toBeGreaterThanOrEqual(componentInner);
    expect(cell!.r).toBeLessThanOrEqual(componentOuter);
  });

  test("nearestFreeDualRingCell finds a different free cell when the nearest one is occupied", () => {
    const stack = makeStack();
    const proj = { origin: { x: 0, y: 0 }, spacing: TRI_LATTICE_SPACING, stack };
    const componentInner = (stack as any).componentInnerAxial as number;
    const componentOuter = (stack as any).componentOuterAxial as number;
    const point = dualRing.axialToDualRingPixel?.({ q: 0, r: componentInner }, proj)!;
    const occupied = new Set([`0:${componentInner}`]);
    const cell = dualRing.nearestFreeDualRingCell?.(point, occupied, proj, { min: componentInner, max: componentOuter });
    expect(cell).toBeDefined();
    expect(occupied.has(`${cell!.q}:${cell!.r}`)).toBe(false);
  });
});

describe("snapPyramidTopsToSharedRay", () => {
  beforeAll(async () => {
    dualRing = (await import("./landscape-triangular-lattice").catch(() => ({}))) as DualRingLatticeModule;
  });

  test("snaps both tops onto one center ray within ≤1 lattice step", () => {
    const snapped = dualRing.snapPyramidTopsToSharedRay?.(
      { q: 3, r: 0 },
      { q: 7, r: 1 },
      { x: 0, y: 0 },
      TRI_LATTICE_SPACING,
    );
    expect(snapped).toBeDefined();
    expect(snapped!.purposeOffSteps).toBeLessThanOrEqual(1);
    expect(snapped!.stressorOffSteps).toBeLessThanOrEqual(1);
    // Shared ray: angular difference of snapped tops from center is ~0 or π-aligned.
    const p = axialToPixel(snapped!.purpose, TRI_LATTICE_SPACING);
    const s = axialToPixel(snapped!.stressor, TRI_LATTICE_SPACING);
    const cross = p.x * s.y - p.y * s.x;
    const scale = Math.hypot(p.x, p.y) * Math.hypot(s.x, s.y);
    expect(Math.abs(cross) / Math.max(scale, 1e-9)).toBeLessThan(0.35);
  });

  test("curved lattice paths preserve endpoints while bowing between circular cells", () => {
    const from = { x: 100, y: 0 };
    const to = { x: 0, y: 100 };
    const points = dualRing.curvedLatticePathPoints?.(from, to, { x: 0, y: 0 }, {
      curvature: 0.2,
      samples: 8,
    });
    expect(points).toHaveLength(9);
    expect(points?.[0]).toEqual(from);
    expect(points?.at(-1)).toEqual(to);
    expect(points?.some((point) => point.x < 65 && point.y > 75)).toBe(true);
  });

});
