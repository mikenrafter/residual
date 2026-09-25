import { describe, expect, test } from "bun:test";
import type { PendingState, SnapshotAttractor, SnapshotComponent, SnapshotForce } from "./model";
import {
  buildNkpHypergraphModel,
  centroid,
  convexHull,
  regionCorePath,
} from "./nkp-hypergraph";

const attractors: SnapshotAttractor[] = [
  { id: "A-01", name: "resilience", description: "stays useful", positiveState: "degrades", negativeState: "cascades" },
  { id: "A-02", name: "adaptability", description: "absorbs change", positiveState: "handles", negativeState: "brittle" },
];

const component = (name: string, status: "actual" | "proposed" = "actual"): SnapshotComponent => ({
  name,
  description: `${name} component`,
  status,
  architectureSet: "runtime",
});

const force = (id: string, attractorId: string, components: string[], kind: "stressor" | "purpose" = "stressor"): SnapshotForce => ({
  id,
  kind,
  shortname: `${id.toLowerCase()}-name`,
  description: `${id} description`,
  attractorId,
  naiveChangeOrFeature: "",
  outcomes: "",
  components,
});

function state(overrides: Partial<PendingState> = {}): PendingState {
  return {
    baseAttractors: attractors,
    baseComponents: ["auth", "cache", "database", "queue", "orphan"].map((name) => component(name)),
    baseForces: [
      force("S-01", "A-01", ["auth", "cache", "database", "queue"]),
      force("S-02", "A-01", ["auth"]),
      force("P-01", "A-02", ["cache", "database"], "purpose"),
    ],
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
    ...overrides,
  };
}

describe("buildNkpHypergraphModel", () => {
  test("one membership edge per force-component pair instead of a clique", () => {
    const model = buildNkpHypergraphModel(state());
    // S-01 on 4 components would be 6 clique edges; here it's 4 memberships.
    expect(model.edges.filter((edge) => edge.source === "force:S-01")).toHaveLength(4);
    expect(model.edges).toHaveLength(4 + 1 + 2);
    expect(model.edges.every((edge) => edge.source.startsWith("force:") && edge.target.startsWith("component:"))).toBe(true);
  });

  test("forces are nodes carrying their attractor; no attractor nodes exist", () => {
    const model = buildNkpHypergraphModel(state());
    const forceNodes = model.nodes.filter((item) => item.type === "force");
    expect(forceNodes.map((item) => item.id).sort()).toEqual(["force:P-01", "force:S-01", "force:S-02"]);
    expect(forceNodes.find((item) => item.id === "force:P-01")).toMatchObject({ attractorId: "A-02", kind: "purpose" });
    expect(model.nodes.some((item) => (item.type as string) === "attractor")).toBe(false);
    expect(forceNodes.find((item) => item.id === "force:S-01")?.tooltip).toContain("Attractor: resilience");
  });

  test("drops components no force touches", () => {
    const model = buildNkpHypergraphModel(state());
    expect(model.nodes.some((item) => item.id === "component:orphan")).toBe(false);
  });

  test("groups forces and touched components per attractor with distinct colours", () => {
    const model = buildNkpHypergraphModel(state());
    expect(model.groups.map((group) => group.attractorId)).toEqual(["A-01", "A-02"]);
    const resilience = model.groups[0];
    expect(resilience.forceNodeIds.sort()).toEqual(["force:S-01", "force:S-02"]);
    expect(resilience.componentNodeIds).toEqual([
      "component:auth", "component:cache", "component:database", "component:queue",
    ]);
    expect(model.groups[0].color).not.toBe(model.groups[1].color);
  });

  test("omits attractors with no forces from groups", () => {
    const extra: SnapshotAttractor = { ...attractors[0], id: "A-03", name: "empty" };
    const model = buildNkpHypergraphModel(state({ baseAttractors: [...attractors, extra] }));
    expect(model.groups.map((group) => group.attractorId)).not.toContain("A-03");
  });

  test("includes staged added forces and skips removed ones", () => {
    const model = buildNkpHypergraphModel(state({
      removedForces: { "S-02": "stressor" },
      addedForces: [{ ...force("tmp-1", "A-02", ["queue"]), tempId: "tmp-1" } as never],
    }));
    const ids = model.nodes.filter((item) => item.type === "force").map((item) => item.id).sort();
    expect(ids).toEqual(["force:P-01", "force:S-01", "force:tmp-1"]);
  });

  test("fades filtered forces and components when hideFiltered is off", () => {
    const model = buildNkpHypergraphModel(state(), {
      visibleForceIds: new Set(["P-01"]),
      visibleComponentNames: new Set(["cache", "database", "auth"]),
    });
    expect(model.nodes.find((item) => item.id === "force:S-01")?.focused).toBe(false);
    expect(model.nodes.find((item) => item.id === "force:P-01")?.focused).toBe(true);
    expect(model.nodes.find((item) => item.id === "component:queue")?.focused).toBe(false);
    // auth is visible but only touched by hidden forces.
    expect(model.nodes.find((item) => item.id === "component:auth")?.focused).toBe(false);
    expect(model.groups.find((group) => group.attractorId === "A-01")?.focused).toBe(false);
  });

  test("hideFiltered drops unfocused edges and the nodes they orphan", () => {
    const model = buildNkpHypergraphModel(state(), { visibleForceIds: new Set(["P-01"]), hideFiltered: true });
    expect(model.nodes.map((item) => item.id).sort()).toEqual([
      "component:cache", "component:database", "force:P-01",
    ]);
    expect(model.edges).toHaveLength(2);
    expect(model.groups.map((group) => group.attractorId)).toEqual(["A-02"]);
  });

  test("marks fission candidates above the threshold", () => {
    const model = buildNkpHypergraphModel(state(), { fissionThreshold: 1 });
    const candidates = model.nodes
      .filter((item) => item.type === "component" && item.fissionCandidate)
      .map((item) => item.id)
      .sort();
    expect(candidates).toEqual(["component:auth", "component:cache", "component:database"]);
  });
});

describe("focus component", () => {
  test("keeps only forces touching the focus component and the components those forces reach", () => {
    const full = buildNkpHypergraphModel(state(), {});
    const focusName = full.nodes.find((item) => item.type === "component")!.label;
    const focused = buildNkpHypergraphModel(state(), { focusComponent: focusName });
    const focusId = `component:${focusName}`;
    const forceIds = new Set(focused.nodes.filter((item) => item.type === "force").map((item) => item.id));
    for (const id of forceIds) {
      expect(focused.edges.some((edge) => edge.source === id && edge.target === focusId)).toBe(true);
    }
    const reached = new Set(focused.edges.map((edge) => edge.target));
    expect(focused.nodes.filter((item) => item.type === "component").map((item) => item.id).sort()).toEqual([...reached].sort());
    expect(focused.nodes.length).toBeLessThanOrEqual(full.nodes.length);
  });

  test("an unknown focus component leaves nothing to draw", () => {
    expect(buildNkpHypergraphModel(state(), { focusComponent: "no-such-component" }).nodes).toEqual([]);
  });
});

describe("region geometry", () => {
  test("convex hull drops interior points", () => {
    const hull = convexHull([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 },
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual({ x: 5, y: 5 });
  });

  test("collinear and duplicate points collapse to their extremes", () => {
    expect(convexHull([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }, { x: 10, y: 10 }])).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 10 },
    ]);
  });

  test("region path handles empty, 1, 2 and 3+ point groups", () => {
    expect(regionCorePath([])).toBe("");
    expect(regionCorePath([{ x: 4, y: 4 }])).toBe("M3.5,4.0L4.5,4.0Z");
    expect(regionCorePath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe("M0.0,0.0L10.0,0.0Z");
    expect(regionCorePath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }]).split("L")).toHaveLength(3);
  });

  test("centroid averages points", () => {
    expect(centroid([])).toBeUndefined();
    expect(centroid([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toEqual({ x: 5, y: 10 });
  });
});
