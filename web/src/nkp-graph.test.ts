import { beforeAll, describe, expect, test } from "bun:test";
import type { PendingState, SnapshotAttractor, SnapshotComponent, SnapshotForce } from "./model";

/**
 * Contract tests for the live NKP graph. The guarded dynamic import keeps the
 * red suite runnable before nkp-graph.ts exists: failures point at the missing
 * graph API instead of aborting test discovery with a module-resolution error.
 */
type GraphModule = {
  buildNkpGraphModel?: (
    state: PendingState,
    options?: {
      visibleForceIds?: ReadonlySet<string>;
      visibleComponentNames?: ReadonlySet<string>;
      fissionThreshold?: number;
      hideFiltered?: boolean;
      minCouplingStrength?: number;
      topNCouplings?: number;
      topNDirection?: "strongest" | "weakest";
    },
  ) => GraphModel;
  attractorColorForId?: (id: string) => string;
  attractorColors?: (state: PendingState) => Map<string, string>;
  dominantAttractorForComponent?: (state: PendingState, componentName: string) => string | undefined;
  mutedAttractorColor?: (color: string) => string;
};

interface GraphNode {
  id: string;
  type: "component" | "attractor";
  label: string;
  status?: "actual" | "proposed";
  tooltip: string;
  focused: boolean;
  opacity: number;
  labelVisible: boolean;
  revealLabelOnHover: boolean;
  shape?: "circle" | "square";
  color?: string;
  dominantAttractorId?: string;
  fissionCandidate?: boolean;
  ringStyle?: "dotted";
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: "coupling" | "fusion" | "attractor";
  count: number;
  stressors: string[];
  tooltip: string;
  width: number;
  lineStyle: "solid" | "dotted";
  focused: boolean;
  opacity: number;
}

interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

let graphModule: GraphModule = {};

beforeAll(async () => {
  graphModule = (await import("./nkp-graph").catch(() => ({}))) as GraphModule;
});

const resilience: SnapshotAttractor = {
  id: "A-01",
  name: "resilience",
  description: "service remains useful during failures",
  positiveState: "requests degrade gracefully",
  negativeState: "failure cascades",
};

const adaptability: SnapshotAttractor = {
  id: "A-02",
  name: "adaptability",
  description: "system absorbs new operating conditions",
  positiveState: "new load shapes are handled",
  negativeState: "the system stays brittle",
};

const auth: SnapshotComponent = {
  name: "auth",
  description: "validates caller identity",
  status: "actual",
  architectureSet: "runtime",
};

const cache: SnapshotComponent = {
  name: "cache",
  description: "keeps reusable authorization decisions",
  status: "proposed",
  architectureSet: "runtime",
};

const database: SnapshotComponent = {
  name: "database",
  description: "stores durable account data",
  status: "actual",
  architectureSet: "data",
};

const forces: SnapshotForce[] = [
  {
    id: "S-01",
    kind: "stressor",
    shortname: "credential-storm",
    description: "credential checks arrive in a burst",
    attractorId: "A-01",
    naiveChangeOrFeature: "add workers",
    outcomes: "bounded authentication latency",
    components: ["auth", "cache"],
  },
  {
    id: "S-02",
    kind: "stressor",
    shortname: "identity-provider-outage",
    description: "the external identity provider is unavailable",
    attractorId: "A-01",
    naiveChangeOrFeature: "retry requests",
    outcomes: "local decisions remain available",
    components: ["auth", "cache"],
  },
  {
    id: "S-03",
    kind: "stressor",
    shortname: "schema-drift",
    description: "stored account shape changes",
    attractorId: "A-02",
    naiveChangeOrFeature: "patch readers",
    outcomes: "old and new records remain readable",
    components: ["database"],
  },
];

function state(overrides: Partial<PendingState> = {}): PendingState {
  return {
    baseAttractors: [resilience, adaptability],
    baseComponents: [auth, cache, database],
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
    ...overrides,
  };
}

function build(
  pending: PendingState = state(),
  options?: {
    visibleForceIds?: ReadonlySet<string>;
    visibleComponentNames?: ReadonlySet<string>;
    fissionThreshold?: number;
    hideFiltered?: boolean;
    minCouplingStrength?: number;
    topNCouplings?: number;
    topNDirection?: "strongest" | "weakest";
  },
): GraphModel {
  expect(graphModule.buildNkpGraphModel).toBeFunction();
  return graphModule.buildNkpGraphModel!(pending, options);
}

function node(model: GraphModel, id: string): GraphNode {
  const found = model.nodes.find((candidate) => candidate.id === id);
  expect(found, `missing graph node ${id}`).toBeDefined();
  return found!;
}

function edge(model: GraphModel, type: GraphEdge["type"], source: string, target: string): GraphEdge {
  const pair = new Set([source, target]);
  const found = model.edges.find(
    (candidate) => candidate.type === type && pair.has(candidate.source) && pair.has(candidate.target),
  );
  expect(found, `missing ${type} edge ${source} <-> ${target}`).toBeDefined();
  return found!;
}

describe("buildNkpGraphModel", () => {
  test("creates named component nodes with distinct actual/proposed styling data and full tooltips", () => {
    const model = build();
    const actual = node(model, "component:auth");
    const proposed = node(model, "component:cache");

    expect(actual).toMatchObject({ type: "component", label: "auth", status: "actual", labelVisible: true });
    expect(proposed).toMatchObject({ type: "component", label: "cache", status: "proposed", labelVisible: true });
    expect(actual.tooltip).toContain("validates caller identity");
    expect(actual.tooltip).toContain("runtime");
    expect(actual.tooltip).toContain("actual");
    expect(proposed.tooltip).toContain("proposed");
  });

  test("encodes implementation status by shape, not component color", () => {
    const model = build();
    const actual = node(model, "component:auth");
    const proposed = node(model, "component:cache");
    expect(actual.shape).toBe("circle");
    expect(proposed.shape).toBe("square");
    expect(actual.color).toBe(proposed.color);
  });

  test("colors components with a muted shade of their dominant attractor", () => {
    const model = build();
    const authNode = node(model, "component:auth");
    const colors = graphModule.attractorColors?.(state());
    expect(authNode.dominantAttractorId).toBe("A-01");
    expect(authNode.color).toBe(graphModule.mutedAttractorColor?.(colors?.get("A-01") ?? ""));
  });

  test("aggregates residual rows into one component edge with stressor names and a width based on count", () => {
    const coupling = edge(build(), "coupling", "component:auth", "component:cache");

    expect(coupling.count).toBe(2);
    expect(coupling.stressors).toEqual(["credential-storm", "identity-provider-outage"]);
    expect(coupling.tooltip).toContain("credential-storm");
    expect(coupling.tooltip).toContain("identity-provider-outage");
    expect(coupling.lineStyle).toBe("solid");
    expect(coupling.width).toBeGreaterThan(1);
  });

  test("makes a two-row coupling thicker than a one-row coupling", () => {
    const extra: SnapshotForce = {
      ...forces[2]!,
      id: "S-04",
      shortname: "account-write-load",
      components: ["auth", "database"],
    };
    const model = build(state({ baseForces: [...forces, extra] }), { minCouplingStrength: 1 });
    const twice = edge(model, "coupling", "component:auth", "component:cache");
    const once = edge(model, "coupling", "component:auth", "component:database");

    expect(twice.width).toBeGreaterThan(once.width);
  });

  test("renders identical coupling vectors as separate dotted fusion-candidate edges", () => {
    const fusion = edge(build(), "fusion", "component:auth", "component:cache");
    expect(fusion).toMatchObject({ lineStyle: "dotted", count: 2 });
    expect(fusion.tooltip.toLowerCase()).toContain("fusion");
  });

  test("marks over-threshold components with a dotted fission-candidate ring", () => {
    const model = build(state(), { fissionThreshold: 1 });
    expect(node(model, "component:auth")).toMatchObject({ fissionCandidate: true, ringStyle: "dotted" });
    expect(node(model, "component:cache")).toMatchObject({ fissionCandidate: true, ringStyle: "dotted" });
    expect(node(model, "component:database").fissionCandidate).toBe(false);
  });

  test("adds faded, named attractor nodes and links them to components through their residual forces", () => {
    const model = build();
    const attractor = node(model, "attractor:A-01");
    expect(attractor).toMatchObject({ type: "attractor", label: "resilience", labelVisible: true });
    expect(attractor.opacity).toBeLessThan(1);
    expect(attractor.tooltip).toContain("service remains useful during failures");
    expect(edge(model, "attractor", "attractor:A-01", "component:auth").count).toBe(2);
    expect(edge(model, "attractor", "attractor:A-01", "component:cache").count).toBe(2);
  });

  test("drops component nodes with no surviving edge of any kind", () => {
    const isolated: SnapshotComponent = {
      name: "isolated-ledger",
      description: "not touched by any residual force",
      status: "actual",
      architectureSet: "runtime",
    };
    const model = build(state({ baseComponents: [auth, cache, database, isolated] }));

    expect(model.nodes.find((item) => item.id === "component:isolated-ledger")).toBeUndefined();
    expect(node(model, "component:auth")).toBeDefined();
    expect(node(model, "component:database")).toBeDefined();
  });

  test("uses effective pending state, including added records and updates to existing couplings", () => {
    const added: SnapshotComponent = {
      name: "rate-limiter",
      description: "bounds admission rate",
      status: "proposed",
      architectureSet: "edge",
    };
    const model = build(
      state({
        addedComponents: [added],
        updatedForces: { "S-01": { components: ["auth", "rate-limiter"] } },
      }),
      { minCouplingStrength: 1 },
    );

    expect(node(model, "component:rate-limiter").status).toBe("proposed");
    expect(edge(model, "coupling", "component:auth", "component:rate-limiter").stressors).toEqual([
      "credential-storm",
    ]);
  });

  test("focuses only visible table rows while retaining hidden nodes for hover discovery", () => {
    const model = build(state(), { visibleForceIds: new Set(["S-01"]), hideFiltered: false });
    const hidden = node(model, "component:database");
    const focused = node(model, "component:auth");

    expect(model.nodes).toHaveLength(5);
    expect(focused).toMatchObject({ focused: true, opacity: 1, labelVisible: true });
    expect(hidden).toMatchObject({ focused: false, opacity: 0.5, labelVisible: false, revealLabelOnHover: true });
    expect(edge(model, "attractor", "attractor:A-02", "component:database")).toMatchObject({
      focused: false,
      opacity: 0.5,
    });
  });

  test("omits coupling and fusion edges below minCouplingStrength but keeps attractor links", () => {
    const extra: SnapshotForce = {
      ...forces[2]!,
      id: "S-04",
      shortname: "account-write-load",
      components: ["auth", "database"],
    };
    const withWeakCoupling = build(state({ baseForces: [...forces, extra] }), { minCouplingStrength: 2 });
    expect(
      withWeakCoupling.edges.find((candidate) => candidate.type === "coupling" && candidate.count === 1),
    ).toBeUndefined();
    expect(edge(withWeakCoupling, "coupling", "component:auth", "component:cache").count).toBe(2);

    const baseline = build(state(), { minCouplingStrength: 2 });
    expect(edge(baseline, "attractor", "attractor:A-02", "component:database").count).toBe(1);
  });

  test("removes filtered components and edges when hideFiltered is enabled but always keeps attractors", () => {
    const model = build(state(), { visibleForceIds: new Set(["S-01"]), hideFiltered: true });

    expect(model.nodes.map((item) => item.id)).toEqual([
      "component:auth",
      "component:cache",
      "attractor:A-01",
      "attractor:A-02",
    ]);
    expect(model.edges.every((item) => item.focused)).toBe(true);
    expect(model.edges.some((item) => item.source === "attractor:A-02")).toBe(false);
    expect(node(model, "attractor:A-02").type).toBe("attractor");
  });

  test("keeps only the strongest coupling tier and prunes attractors that no longer reach a surviving pair", () => {
    const extra: SnapshotForce = {
      ...forces[2]!,
      id: "S-04",
      shortname: "account-write-load",
      attractorId: "A-01",
      components: ["auth", "database"],
    };
    const model = build(state({ baseForces: [...forces, extra] }), {
      minCouplingStrength: 1,
      topNCouplings: 1,
      topNDirection: "strongest",
    });

    expect(edge(model, "coupling", "component:auth", "component:cache").count).toBe(2);
    expect(
      model.edges.find((candidate) => candidate.type === "coupling" && candidate.count === 1),
    ).toBeUndefined();
    expect(model.nodes.find((item) => item.id === "attractor:A-02")).toBeUndefined();
    expect(node(model, "attractor:A-01")).toBeDefined();
    expect(
      model.edges.some((item) => item.type === "attractor" && item.target === "component:database"),
    ).toBe(false);
  });

  test("switches to the weakest coupling tier when topNDirection is weakest", () => {
    const extra: SnapshotForce = {
      ...forces[2]!,
      id: "S-04",
      shortname: "account-write-load",
      attractorId: "A-01",
      components: ["auth", "database"],
    };
    const model = build(state({ baseForces: [...forces, extra] }), {
      minCouplingStrength: 1,
      topNCouplings: 1,
      topNDirection: "weakest",
    });

    expect(edge(model, "coupling", "component:auth", "component:database").count).toBe(1);
    expect(
      model.edges.find((candidate) => candidate.type === "coupling" && candidate.count === 2),
    ).toBeUndefined();
  });

  test("keeps every edge in a tied top tier (friendly tie)", () => {
    const tiedA: SnapshotForce = {
      ...forces[2]!,
      id: "S-04",
      shortname: "account-write-load",
      attractorId: "A-01",
      components: ["auth", "database"],
    };
    const tiedB: SnapshotForce = {
      ...forces[2]!,
      id: "S-05",
      shortname: "cache-invalidation-storm",
      attractorId: "A-01",
      components: ["cache", "database"],
    };
    const model = build(state({ baseForces: [...forces, tiedA, tiedB] }), {
      minCouplingStrength: 1,
      topNCouplings: 1,
      topNDirection: "weakest",
    });

    expect(edge(model, "coupling", "component:auth", "component:database").count).toBe(1);
    expect(edge(model, "coupling", "component:cache", "component:database").count).toBe(1);
    expect(
      model.edges.find((candidate) => candidate.type === "coupling" && candidate.count === 2),
    ).toBeUndefined();
  });

  test("dims edges whose table column endpoint is hidden", () => {
    const model = build(state(), {
      visibleForceIds: new Set(["S-01", "S-02", "S-03"]),
      visibleComponentNames: new Set(["auth", "database"]),
    });

    expect(node(model, "component:cache")).toMatchObject({ focused: false, opacity: 0.5 });
    expect(edge(model, "coupling", "component:auth", "component:cache")).toMatchObject({
      focused: false,
      opacity: 0.5,
    });
    expect(edge(model, "attractor", "attractor:A-01", "component:cache")).toMatchObject({
      focused: false,
      opacity: 0.5,
    });
  });
});

describe("attractor palette", () => {
  test("gives 20 neighbouring slots distinct colours", async () => {
    const { attractorColor } = (await import("./nkp-graph")) as { attractorColor: (index: number) => string };
    const colours = Array.from({ length: 20 }, (_, index) => attractorColor(index));
    expect(new Set(colours).size).toBe(20);
  });

  test("keys colours by attractor id so every view paints an attractor the same", async () => {
    const { attractorColors } = (await import("./nkp-graph")) as { attractorColors: (state: PendingState) => Map<string, string> };
    const colours = attractorColors(state());
    expect([...colours.keys()]).toEqual([...colours.keys()].sort());
    expect(new Set(colours.values()).size).toBe(colours.size);
  });

  test("an attractor color is a pure function of its id", () => {
    expect(graphModule.attractorColorForId).toBeFunction();
    const before = graphModule.attractorColors?.(state()).get("A-01");
    const inserted = state({
      baseAttractors: [
        { id: "A-00", name: "new first", description: "", positiveState: "", negativeState: "" },
        resilience,
        adaptability,
      ],
    });
    const after = graphModule.attractorColors?.(inserted).get("A-01");
    expect(before).toBe(after);
    expect(before).toBe(graphModule.attractorColorForId?.("A-01"));
    expect(graphModule.attractorColors?.(state({ baseAttractors: [adaptability, resilience] })).get("A-01")).toBe(before);
  });

  test("30 distinct ids get 30 distinct colours (hue-only collisions would fail this)", () => {
    const ids = Array.from({ length: 30 }, (_, index) => `A-${index}`);
    const colours = ids.map((id) => graphModule.attractorColorForId?.(id));
    expect(new Set(colours).size).toBe(30);
  });

  test("saturation and lightness vary across ids, not just hue", () => {
    // Regression guard: the old implementation hard-coded saturation to a
    // constant 62% and lightness to only 3 discrete values, so many ids
    // ended up visually near-identical even with different hues.
    const ids = Array.from({ length: 10 }, (_, index) => `A-${index}`);
    const parsed = ids.map((id) => {
      const colour = graphModule.attractorColorForId?.(id) ?? "";
      const match = /^hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)$/.exec(colour);
      expect(match).not.toBeNull();
      return { saturation: Number(match?.[2]), lightness: Number(match?.[3]) };
    });
    expect(new Set(parsed.map((item) => item.saturation)).size).toBeGreaterThan(1);
    expect(new Set(parsed.map((item) => item.lightness)).size).toBeGreaterThan(1);
  });

  test("shared dominant-attractor logic uses the full state and is filter-stable", () => {
    expect(graphModule.dominantAttractorForComponent).toBeFunction();
    expect(graphModule.dominantAttractorForComponent?.(state(), "cache")).toBe("A-01");
    const filteredGraph = build(state(), { visibleForceIds: new Set(["P-01"]), hideFiltered: false });
    expect(node(filteredGraph, "component:cache").dominantAttractorId).toBe("A-01");
  });
});

describe("rendered-page integration", () => {
  test("includes the same D3 v7 ESM library used by slaughter.pro", async () => {
    const [shell, main] = await Promise.all([
      Bun.file("../src/view/shell.html").text(),
      Bun.file("src/main.ts").text(),
    ]);
    expect(`${shell}\n${main}`).toContain("https://cdn.jsdelivr.net/npm/d3@7/+esm");
  });

  test("component implementation status does not change graph or matrix glyph color", async () => {
    const shell = await Bun.file("../src/view/shell.html").text();
    expect(shell).not.toMatch(/nkp-(?:bundle-dot|node-dot)\.status-proposed\s*\{[^}]*fill/s);
    expect(shell).not.toMatch(/\.status-dot\.status-(?:actual|proposed)\s*\{[^}]*background/s);
  });
});
