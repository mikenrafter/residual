import { describe, expect, test } from "bun:test";
import {
  assignForcesToSubShapes,
  attractorGroupPickOrder,
  axialDistance,
  axialHopStep,
  axialKey,
  decomposeAttractorSize,
  LATTICE_HOP_THRESHOLD,
  layoutAttractorForceShapes,
  nearestFreeAxialPoint,
  placeCompositeShapes,
  previewNearestFreeAxialPoint,
  shapePatternForSize,
  type ForceShapeGroup,
  type SimilarityForce,
} from "./landscape-triangular-lattice";

describe("shapePatternForSize", () => {
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

  test("dice-5: center is adjacent to all 4 ring points", () => {
    const pattern = shapePatternForSize(5);
    expect(pattern).toHaveLength(5);
    const center = pattern[0]!;
    for (const point of pattern.slice(1)) {
      expect(axialDistance(center, point)).toBe(1);
    }
  });

  test("hexagon (6): every point is adjacent to exactly two other ring points", () => {
    const pattern = shapePatternForSize(6);
    expect(pattern).toHaveLength(6);
    for (let i = 0; i < pattern.length; i += 1) {
      const adjacentCount = pattern.filter((_, j) => j !== i && axialDistance(pattern[i]!, pattern[j]!) === 1).length;
      expect(adjacentCount).toBe(2);
    }
  });

  test("hexagon+dot (7): center is adjacent to all 6 ring points", () => {
    const pattern = shapePatternForSize(7);
    expect(pattern).toHaveLength(7);
    const center = pattern[0]!;
    for (const point of pattern.slice(1)) {
      expect(axialDistance(center, point)).toBe(1);
    }
  });

  test("throws for sizes outside the fixed 2-7 range", () => {
    expect(() => shapePatternForSize(1)).toThrow();
    expect(() => shapePatternForSize(8)).toThrow();
  });
});

describe("decomposeAttractorSize", () => {
  test.each([
    [8, [3, 5]],
    [9, [4, 5]],
    [10, [4, 6]],
    [11, [5, 6]],
    [12, [5, 7]],
    [13, [6, 7]],
    [14, [7, 7]],
    [18, [5, 6, 7]],
    [19, [6, 6, 7]],
    [21, [7, 7, 7]],
    [22, [4, 5, 6, 7]],
  ])("decomposeAttractorSize(%i) === %j", (n, expected) => {
    expect(decomposeAttractorSize(n)).toEqual(expected);
  });

  test("parts always sum back to n and each part is in [3,7]", () => {
    for (const n of [8, 9, 10, 11, 15, 17, 20, 25, 30]) {
      const parts = decomposeAttractorSize(n);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(n);
      for (const part of parts) {
        expect(part).toBeGreaterThanOrEqual(3);
        expect(part).toBeLessThanOrEqual(7);
      }
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

  test("a composite (8+) group's own sub-shapes touch (min distance exactly 1) without overlapping", () => {
    const groups: ForceShapeGroup[] = [
      { attractorId: "A1", forces: makeForces("A1", 14), anchor: { q: 0, r: 0 } },
    ];
    const { targets, subShapesByAttractor } = layoutAttractorForceShapes(groups);
    const subShapeSizes = decomposeAttractorSize(14); // [7,7]
    expect(subShapeSizes).toEqual([7, 7]);
    const bins = subShapesByAttractor.get("A1");
    expect(bins).toHaveLength(2);
    expect(bins?.map((bin) => bin.length).sort()).toEqual([7, 7]);
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
