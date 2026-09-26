import { describe, expect, test } from "bun:test";
import {
  assignForcesToSubShapes,
  attractorGroupPickOrder,
  axialDistance,
  axialHopStep,
  axialKey,
  axialToPixel,
  decomposeAttractorSize,
  dilateAxialOneLayer,
  dilatedSubshapeApproach,
  LATTICE_HOP_THRESHOLD,
  layoutAttractorForceShapes,
  nearestFreeAxialPoint,
  placeCompositeShapes,
  previewNearestFreeAxialPoint,
  rotateAxial,
  rotateAxialOffsets,
  shapePatternForSize,
  TRI_LATTICE_SPACING,
  type ForceShapeGroup,
  type SimilarityForce,
} from "./landscape-triangular-lattice";

describe("shapePatternForSize", () => {
  test("singleton (1): a single lattice cell", () => {
    expect(shapePatternForSize(1)).toEqual([{ q: 0, r: 0 }]);
  });

  test("pill (2): its two points are adjacent", () => {
    const pattern = shapePatternForSize(2);
    expect(pattern).toHaveLength(2);
    expect(axialDistance(pattern[0]!, pattern[1]!)).toBe(1);
  });

  test("triangle (3): all three points are mutually adjacent", () => {
    const pattern = shapePatternForSize(3);
    expect(pattern).toHaveLength(3);
    for (let i = 0; i < pattern.length; i += 1) {
      for (let j = i + 1; j < pattern.length; j += 1) {
        expect(axialDistance(pattern[i]!, pattern[j]!)).toBe(1);
      }
    }
  });

  test("parallelogram (4): every point has at least two adjacent neighbors within the shape", () => {
    const pattern = shapePatternForSize(4);
    expect(pattern).toHaveLength(4);
    for (let i = 0; i < pattern.length; i += 1) {
      const adjacentCount = pattern.filter((_, j) => j !== i && axialDistance(pattern[i]!, pattern[j]!) === 1).length;
      expect(adjacentCount).toBeGreaterThanOrEqual(2);
    }
  });

  test("throws for sizes outside the fixed 1-4 range (5/6/7 are decomposed)", () => {
    expect(() => shapePatternForSize(0)).toThrow();
    expect(() => shapePatternForSize(5)).toThrow();
    expect(() => shapePatternForSize(6)).toThrow();
    expect(() => shapePatternForSize(7)).toThrow();
    expect(() => shapePatternForSize(8)).toThrow();
  });
});

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

describe("decomposeAttractorSize", () => {
  test.each([
    [5, [3, 2]],
    [6, [4, 2]],
    [7, [4, 3]],
    [8, [4, 3, 1]],
    [9, [4, 3, 2]],
    [10, [4, 3, 2, 1]],
    [11, [4, 3, 3, 1]],
    [12, [4, 3, 3, 2]],
    [13, [4, 3, 3, 3]],
    [14, [4, 3, 3, 3, 1]],
  ])("decomposeAttractorSize(%i) === %j", (n, expected) => {
    expect(decomposeAttractorSize(n)).toEqual(expected);
  });

  test("parts always sum back to n and each part is in [1,4]", () => {
    for (const n of [5, 6, 7, 8, 9, 10, 11, 15, 17, 20, 25, 30]) {
      const parts = decomposeAttractorSize(n);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(n);
      for (const part of parts) {
        expect(part).toBeGreaterThanOrEqual(1);
        expect(part).toBeLessThanOrEqual(4);
      }
    }
  });

  test("until 10, all part sizes are unique", () => {
    for (const n of [5, 6, 7, 8, 9, 10]) {
      const parts = decomposeAttractorSize(n);
      expect(new Set(parts).size).toBe(parts.length);
    }
  });
});

describe("placeCompositeShapes", () => {
  test.each([8, 14, 22])("minimum cross-shape axial distance is exactly 1 for N=%i", (n) => {
    const sizes = decomposeAttractorSize(n);
    const shapes = placeCompositeShapes(sizes);
    expect(shapes).toHaveLength(sizes.length);
    let minCrossDistance = Infinity;
    for (let i = 0; i < shapes.length; i += 1) {
      for (let j = i + 1; j < shapes.length; j += 1) {
        for (const a of shapes[i]!) {
          for (const b of shapes[j]!) {
            minCrossDistance = Math.min(minCrossDistance, axialDistance(a, b));
          }
        }
      }
    }
    expect(minCrossDistance).toBe(1);
  });

  test("no two placed points (even within the same shape) collide", () => {
    const shapes = placeCompositeShapes(decomposeAttractorSize(14));
    const allPoints = shapes.flat();
    const seen = new Set<string>();
    for (const point of allPoints) {
      const key = `${point.q}:${point.r}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
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

describe("attractorGroupPickOrder", () => {
  test("12,10,9,7,5,3 -> 12,7,10,5,9,3", () => {
    expect(attractorGroupPickOrder([12, 10, 9, 7, 5, 3])).toEqual([12, 7, 10, 5, 9, 3]);
  });

  test("20,18,16,14,12,10,8,6,4,2,1 -> 20,8,14,4,12,2,16,6,18,1,10", () => {
    expect(attractorGroupPickOrder([20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 1]))
      .toEqual([20, 8, 14, 4, 12, 2, 16, 6, 18, 1, 10]);
  });

  test("returns every input value exactly once", () => {
    const sizes = [20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 1];
    const order = attractorGroupPickOrder(sizes);
    expect([...order].sort((a, b) => a - b)).toEqual([...sizes].sort((a, b) => a - b));
  });

  test("empty and single-element inputs", () => {
    expect(attractorGroupPickOrder([])).toEqual([]);
    expect(attractorGroupPickOrder([5])).toEqual([5]);
  });
});

describe("layoutAttractorForceShapes", () => {
  function makeForces(attractorId: string, count: number): SimilarityForce[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `${attractorId}-f${i}`,
      components: [`${attractorId}-c${i % 3}`],
      kind: i % 2 === 0 ? "stressor" : "purpose",
    }));
  }

  test("places every force from every group with no two forces sharing a cell", () => {
    const groups: ForceShapeGroup[] = [
      { attractorId: "A1", forces: makeForces("A1", 3), anchor: { q: 0, r: 0 } },
      { attractorId: "A2", forces: makeForces("A2", 9), anchor: { q: 0, r: 0 } },
      { attractorId: "A3", forces: makeForces("A3", 1), anchor: { q: 0, r: 0 } },
    ];
    const { targets } = layoutAttractorForceShapes(groups);
    const allForceIds = groups.flatMap((g) => g.forces.map((f) => f.id));
    expect(targets.size).toBe(allForceIds.length);
    for (const id of allForceIds) expect(targets.has(id)).toBe(true);
    const keys = [...targets.values()].map(axialKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("a composite (5+) group's own sub-shapes touch (min distance exactly 1) without overlapping", () => {
    const groups: ForceShapeGroup[] = [
      { attractorId: "A1", forces: makeForces("A1", 14), anchor: { q: 0, r: 0 } },
    ];
    const { targets, subShapesByAttractor } = layoutAttractorForceShapes(groups);
    const subShapeSizes = decomposeAttractorSize(14);
    expect(subShapeSizes).toEqual([4, 3, 3, 3, 1]);
    const bins = subShapesByAttractor.get("A1");
    expect(bins).toHaveLength(5);
    expect(bins?.map((bin) => bin.length).sort((a, b) => a - b)).toEqual([1, 3, 3, 3, 4]);
    let minCross = Infinity;
    for (let i = 0; i < bins!.length; i += 1) {
      for (let j = i + 1; j < bins!.length; j += 1) {
        for (const idA of bins![i]!) {
          for (const idB of bins![j]!) {
            const distance = axialDistance(targets.get(idA)!, targets.get(idB)!);
            expect(distance).toBeGreaterThan(0);
            minCross = Math.min(minCross, distance);
          }
        }
      }
    }
    expect(minCross).toBe(1);
  });

  test("groups with different anchors far apart do not collide", () => {
    const groups: ForceShapeGroup[] = [
      { attractorId: "A1", forces: makeForces("A1", 6), anchor: { q: 0, r: 0 } },
      { attractorId: "A2", forces: makeForces("A2", 6), anchor: { q: 20, r: 20 } },
    ];
    const { targets } = layoutAttractorForceShapes(groups);
    const keys = [...targets.values()].map(axialKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("groups anchored at the same point still avoid colliding with each other", () => {
    const groups: ForceShapeGroup[] = [
      { attractorId: "A1", forces: makeForces("A1", 6), anchor: { q: 0, r: 0 } },
      { attractorId: "A2", forces: makeForces("A2", 6), anchor: { q: 0, r: 0 } },
    ];
    const { targets } = layoutAttractorForceShapes(groups);
    const keys = [...targets.values()].map(axialKey);
    expect(new Set(keys).size).toBe(keys.length);
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
