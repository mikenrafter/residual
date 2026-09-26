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
  isCompleteOddPyramidStage,
  LATTICE_HOP_THRESHOLD,
  layoutAttractorForceShapes,
  nearestFreeAxialPoint,
  outerRadiusForPyramidPacking,
  outerRadiusForRingSlots,
  outerRingSlotsForPyramids,
  partitionPyramidSubshapes,
  placeCompositeShapes,
  previewNearestFreeAxialPoint,
  pyramidCellsForLayers,
  pyramidLayersForCount,
  axialRing,
  axialToRadialPixel,
  layoutAttractorPyramidsOnRing,
  rotateAxial,
  rotateAxialOffsets,
  shapePatternForSize,
  TRI_LATTICE_SPACING,
  type ForceShapeGroup,
  type SimilarityForce,
} from "./landscape-triangular-lattice";

describe("pyramidLayersForCount", () => {
  test.each([
    [1, [1]],
    [2, [2]],
    [3, [3]],
    [4, [3, 1]],
    [5, [3, 2]],
    [6, [4, 2]],
    [7, [4, 3]],
    [8, [5, 3]],
    [9, [5, 4]],
    [10, [5, 4, 1]],
    [11, [5, 4, 2]],
    [12, [5, 4, 3]],
    [13, [6, 4, 3]],
    [14, [6, 5, 3]],
    [15, [6, 5, 4]],
    [16, [7, 5, 4]],
    [17, [7, 6, 4]],
    [18, [7, 6, 5]],
    [19, [7, 6, 5, 1]],
    [22, [7, 6, 5, 4]],
    [23, [8, 6, 5, 4]],
  ] as const)("n=%i → %j", (n, expected) => {
    expect(pyramidLayersForCount(n)).toEqual([...expected]);
  });

  test("layer widths always sum to n", () => {
    for (let n = 1; n <= 40; n += 1) {
      expect(pyramidLayersForCount(n).reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  test("complete odd stages match [2h+1 … h+1]", () => {
    expect(isCompleteOddPyramidStage([3])).toBe(true);
    expect(isCompleteOddPyramidStage([5, 4])).toBe(true);
    expect(isCompleteOddPyramidStage([7, 6, 5])).toBe(true);
    expect(isCompleteOddPyramidStage([3, 2])).toBe(false);
    expect(isCompleteOddPyramidStage([5, 4, 3])).toBe(false);
  });
});

describe("pyramidCellsForLayers / partitionPyramidSubshapes", () => {
  test("cells are centred on the base, base at r=0, apex toward −r", () => {
    const cells = pyramidCellsForLayers([3, 2]);
    expect(cells).toEqual([
      { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 },
      { q: 1, r: -1 }, { q: 2, r: -1 },
    ]);
  });

  test("every cell belongs to exactly one subshape", () => {
    for (const n of [1, 2, 3, 5, 9, 12, 15, 22]) {
      const layers = pyramidLayersForCount(n);
      const cells = pyramidCellsForLayers(layers);
      const parts = partitionPyramidSubshapes(layers);
      const seen = new Set<string>();
      for (const part of parts) {
        expect(part.kind === "triangle" || part.kind === "pill").toBe(true);
        if (part.kind === "triangle") expect(part.cells).toHaveLength(3);
        for (const cell of part.cells) {
          const key = axialKey(cell);
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
      expect(seen.size).toBe(cells.length);
    }
  });

  test("a flat 3-base (no height) is a pill — unit triangles need an apex", () => {
    const parts = partitionPyramidSubshapes([3]);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.kind).toBe("pill");
    expect(parts[0]!.cells).toHaveLength(3);
  });

  test("3:2 yields one triangle plus a pill of the remaining pair", () => {
    const parts = partitionPyramidSubshapes([3, 2]);
    const triangles = parts.filter((p) => p.kind === "triangle");
    const pills = parts.filter((p) => p.kind === "pill");
    expect(triangles).toHaveLength(1);
    expect(pills).toHaveLength(1);
    expect(pills[0]!.cells).toHaveLength(2);
  });
});

describe("outerRingSlotsForPyramids", () => {
  test("sums bases and intercalates one gap per attractor", () => {
    expect(outerRingSlotsForPyramids([3, 5, 3], 1)).toBe(3 + 5 + 3 + 3);
    expect(outerRadiusForRingSlots(12, 60)).toBeCloseTo((12 * 60) / (2 * Math.PI), 5);
  });
});

describe("axialToRadialPixel", () => {
  const proj = {
    origin: { x: 0, y: 0 },
    spacing: TRI_LATTICE_SPACING,
    innerRadius: 120,
    outerRadius: 240,
  };

  test("same-ring points are equidistant from the origin", () => {
    const ring = axialRing({ q: 0, r: 0 }, 2);
    const radii = ring.map((cell) => {
      const p = axialToRadialPixel(cell, proj);
      return Math.hypot(p.x, p.y);
    });
    for (const radius of radii) {
      expect(radius).toBeCloseTo(radii[0]!, 5);
    }
  });

  test("angular spacing on a ring is uniform", () => {
    const ring = axialRing({ q: 0, r: 0 }, 2);
    const angles = ring.map((cell) => {
      const p = axialToRadialPixel(cell, proj);
      return Math.atan2(p.y, p.x);
    }).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 0; i < angles.length; i += 1) {
      const next = angles[(i + 1) % angles.length]!;
      let gap = next - angles[i]!;
      if (gap < 0) gap += 2 * Math.PI;
      gaps.push(gap);
    }
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(gaps[0]!, 5);
    }
  });

  test("outerRadiusForPyramidPacking grows with attractor bases", () => {
    const small = outerRadiusForPyramidPacking([3], TRI_LATTICE_SPACING, 1);
    const large = outerRadiusForPyramidPacking([3, 5, 7, 5], TRI_LATTICE_SPACING, 1);
    expect(large.outerRadius).toBeGreaterThan(small.outerRadius);
    expect(large.slotCount).toBe(outerRingSlotsForPyramids([3, 5, 7, 5], 1));
  });
});

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

  test("a pyramid group's sub-shapes are vertex-disjoint and cover every force", () => {
    const groups: ForceShapeGroup[] = [
      { attractorId: "A1", forces: makeForces("A1", 14), anchor: { q: 0, r: 0 } },
    ];
    const { targets, subShapesByAttractor } = layoutAttractorForceShapes(groups);
    expect(pyramidLayersForCount(14)).toEqual([6, 5, 3]);
    const bins = subShapesByAttractor.get("A1");
    expect(bins).toBeDefined();
    const covered = bins!.flat();
    expect(covered).toHaveLength(14);
    expect(new Set(covered).size).toBe(14);
    for (let i = 0; i < bins!.length; i += 1) {
      for (let j = i + 1; j < bins!.length; j += 1) {
        for (const idA of bins![i]!) {
          for (const idB of bins![j]!) {
            expect(axialDistance(targets.get(idA)!, targets.get(idB)!)).toBeGreaterThan(0);
          }
        }
      }
    }
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

describe("layoutAttractorPyramidsOnRing", () => {
  function makeForces(attractorId: string, count: number): SimilarityForce[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `${attractorId}-f${i}`,
      components: [`${attractorId}-c${i % 3}`],
      kind: i % 2 === 0 ? "stressor" as const : "purpose" as const,
    }));
  }

  test("places distinct attractors on the outer ring without shared cells", () => {
    const groups: ForceShapeGroup[] = [
      { attractorId: "A", forces: makeForces("A", 3), anchor: { q: 0, r: 0 } },
      { attractorId: "B", forces: makeForces("B", 5), anchor: { q: 0, r: 0 } },
      { attractorId: "C", forces: makeForces("C", 2), anchor: { q: 0, r: 0 } },
    ];
    const pack = outerRadiusForPyramidPacking(
      groups.map((g) => pyramidLayersForCount(g.forces.length)[0] ?? 1),
    );
    const { targets, subShapesByAttractor } = layoutAttractorPyramidsOnRing(groups, pack.ringAxialRadius);
    expect(targets.size).toBe(3 + 5 + 2);
    const keys = [...targets.values()].map(axialKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(subShapesByAttractor.get("A")?.length).toBeGreaterThanOrEqual(1);
    expect(subShapesByAttractor.get("B")?.length).toBeGreaterThanOrEqual(1);
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
