import { describe, expect, test } from "bun:test";
import type { PendingState, SnapshotComponent, SnapshotForce } from "./model";
import { attractorColors } from "./nkp-graph";
import { buildSeriationModel, seriate } from "./nkp-seriation";

function component(name: string, status: "actual" | "proposed" = "actual"): SnapshotComponent {
  return { name, description: `${name} component`, status, architectureSet: "runtime" };
}

function force(id: string, attractorId: string, components: string[]): SnapshotForce {
  return {
    id,
    kind: "stressor",
    shortname: `force-${id}`,
    description: id,
    attractorId,
    naiveChangeOrFeature: "change",
    outcomes: "outcome",
    components,
  };
}

function state(components: SnapshotComponent[], forces: SnapshotForce[]): PendingState {
  return {
    baseAttractors: [
      { id: "A-01", name: "resilience", description: "", positiveState: "", negativeState: "" },
      { id: "A-02", name: "adaptability", description: "", positiveState: "", negativeState: "" },
    ],
    baseComponents: components,
    baseForces: forces,
    basePersonas: [],
    baseTerms: [],
    addedAttractors: [],
    addedComponents: [],
    addedForces: [],
    addedPersonas: [],
    addedTerms: [],
    updatedAttractors: {},
    updatedComponents: {},
    updatedForces: {},
    updatedPersonas: {},
    updatedTerms: {},
  };
}

// Two blocks {a, c} and {b, d}, interleaved in declaration order so seriation has work to do.
const blocks = state(
  ["a", "b", "c", "d", "lonely"].map((name) => component(name)),
  [
    force("S-01", "A-01", ["a", "c"]),
    force("S-02", "A-01", ["a", "c"]),
    force("S-03", "A-02", ["b", "d"]),
    force("S-04", "A-02", ["b", "d"]),
    force("S-05", "A-02", ["b", "d", "c"]),
  ],
);

function names(model: ReturnType<typeof buildSeriationModel>): string[] {
  return model.components.map((item) => item.name);
}

describe("seriate", () => {
  test("places mutually similar items adjacent and is deterministic", () => {
    const similarity = [
      [0, 0, 1, 0],
      [0, 0, 0, 1],
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ];
    const order = seriate(similarity);
    expect(order).toHaveLength(4);
    expect(Math.abs(order.indexOf(0) - order.indexOf(2))).toBe(1);
    expect(Math.abs(order.indexOf(1) - order.indexOf(3))).toBe(1);
    expect(seriate(similarity)).toEqual(order);
  });

  test("orients merged clusters so the most similar ends touch", () => {
    // Chain 0-1-2-3 scrambled: a correct leaf order is a path.
    const similarity = [
      [0, 3, 0, 0],
      [3, 0, 2, 0],
      [0, 2, 0, 3],
      [0, 0, 3, 0],
    ];
    const order = seriate(similarity);
    expect([order, [...order].reverse()]).toContainEqual([0, 1, 2, 3]);
  });

  test("handles empty and single inputs", () => {
    expect(seriate([])).toEqual([]);
    expect(seriate([[0]])).toEqual([0]);
  });
});

describe("buildSeriationModel", () => {
  test("groups coupled components into adjacent blocks and drops uncoupled ones", () => {
    const model = buildSeriationModel(blocks, { minCouplingStrength: 1 });
    const order = names(model);
    expect(order).not.toContain("lonely");
    expect(Math.abs(order.indexOf("a") - order.indexOf("c"))).toBe(1);
    expect(Math.abs(order.indexOf("b") - order.indexOf("d"))).toBe(1);
  });

  test("cells count shared forces symmetrically and list their shortnames", () => {
    const model = buildSeriationModel(blocks, { minCouplingStrength: 1 });
    const index = (name: string): number => names(model).indexOf(name);
    const cell = (row: string, col: string) =>
      model.cells.find((item) => item.row === index(row) && item.col === index(col));
    expect(cell("b", "d")).toMatchObject({ count: 3, forces: ["force-S-03", "force-S-04", "force-S-05"] });
    expect(cell("d", "b")?.count).toBe(3);
    expect(cell("a", "c")?.count).toBe(2);
    expect(cell("c", "d")?.count).toBe(1);
    expect(cell("a", "b")).toBeUndefined();
    expect(model.maxCount).toBe(3);
  });

  test("diagonal K is the component's total force count", () => {
    const model = buildSeriationModel(blocks);
    expect(model.components.find((item) => item.name === "c")?.k).toBe(3);
    expect(model.maxK).toBe(3);
  });

  test("min coupling strength blanks weak cells without changing order", () => {
    const loose = buildSeriationModel(blocks, { minCouplingStrength: 1 });
    const strict = buildSeriationModel(blocks, { minCouplingStrength: 2 });
    expect(names(strict)).toEqual(names(loose));
    expect(strict.cells.every((item) => item.count >= 2)).toBe(true);
    expect(strict.cells.length).toBeLessThan(loose.cells.length);
  });

  test("top-N keeps only the strongest count tiers", () => {
    const model = buildSeriationModel(blocks, { minCouplingStrength: 1, topNCouplings: 1 });
    expect(new Set(model.cells.map((item) => item.count))).toEqual(new Set([3]));
  });

  test("dominant attractor is the one with most of a component's forces; legend lists only dominant ones", () => {
    const model = buildSeriationModel(blocks);
    const byName = new Map(model.components.map((item) => [item.name, item]));
    expect(byName.get("a")?.dominantAttractorId).toBe("A-01");
    expect(byName.get("c")?.dominantAttractorId).toBe("A-01");
    expect(byName.get("d")?.dominantAttractorId).toBe("A-02");
    expect(model.attractors.map((item) => item.name).sort()).toEqual(["adaptability", "resilience"]);
    const shared = attractorColors(blocks);
    for (const item of model.attractors) expect(item.color).toBe(shared.get(item.id)!);
  });

  test("flags fission candidates by the existing threshold", () => {
    const model = buildSeriationModel(blocks, { fissionThreshold: 2 });
    const flagged = model.components.filter((item) => item.fissionCandidate).map((item) => item.name).sort();
    expect(flagged).toEqual(["b", "c", "d"]);
  });

  test("fades filtered items by default and removes them under hideFiltered", () => {
    const visibleForceIds = new Set(["S-01", "S-02"]);
    const faded = buildSeriationModel(blocks, { visibleForceIds, minCouplingStrength: 1 });
    expect(names(faded).sort()).toEqual(["a", "b", "c", "d"]);
    expect(faded.components.find((item) => item.name === "b")?.focused).toBe(false);
    expect(faded.cells.some((item) => !item.focused)).toBe(true);

    const hidden = buildSeriationModel(blocks, { visibleForceIds, minCouplingStrength: 1, hideFiltered: true });
    expect(names(hidden).sort()).toEqual(["a", "c"]);
    expect(hidden.components.find((item) => item.name === "c")?.k).toBe(2);
    expect(hidden.cells.every((item) => item.focused)).toBe(true);
  });

  test("respects the visible component filter", () => {
    const model = buildSeriationModel(blocks, {
      visibleComponentNames: new Set(["a", "c"]),
      hideFiltered: true,
      minCouplingStrength: 1,
    });
    expect(names(model).sort()).toEqual(["a", "c"]);
  });

  test("includes staged added forces and skips staged removals", () => {
    const base = blocks;
    const next: PendingState = {
      ...base,
      removedForces: { "S-05": "stressor" },
      addedForces: [{ ...force("", "A-01", ["a", "lonely"]), tempId: "tmp-1", shortname: "new-force" }],
    };
    const model = buildSeriationModel(next, { minCouplingStrength: 1 });
    expect(names(model)).toContain("lonely");
    expect(model.components.find((item) => item.name === "c")?.k).toBe(2);
  });
});
