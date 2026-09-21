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
    },
  ) => GraphModel;
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
  distance: number;
  strength: number;
  lineStyle: "solid" | "dotted";
  focused: boolean;
  opacity: number;
}

interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  simulation: {
    enabled: boolean;
    forces: string[];
  };
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

  test("aggregates residual rows into one component edge with stressor names, width, and force tension based on count", () => {
    const coupling = edge(build(), "coupling", "component:auth", "component:cache");

    expect(coupling.count).toBe(2);
    expect(coupling.stressors).toEqual(["credential-storm", "identity-provider-outage"]);
    expect(coupling.tooltip).toContain("credential-storm");
    expect(coupling.tooltip).toContain("identity-provider-outage");
    expect(coupling.lineStyle).toBe("solid");
    expect(coupling.width).toBeGreaterThan(1);
    expect(coupling.strength).toBeGreaterThan(0);
    expect(coupling.distance).toBeGreaterThan(0);
  });

  test("makes a two-row coupling thicker and tighter than a one-row coupling", () => {
    const extra: SnapshotForce = {
      ...forces[2]!,
      id: "S-04",
      shortname: "account-write-load",
      components: ["auth", "database"],
    };
    const model = build(state({ baseForces: [...forces, extra] }));
    const twice = edge(model, "coupling", "component:auth", "component:cache");
    const once = edge(model, "coupling", "component:auth", "component:database");

    expect(twice.width).toBeGreaterThan(once.width);
    expect(twice.strength).toBeGreaterThan(once.strength);
    expect(twice.distance).toBeLessThan(once.distance);
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

  test("keeps D3 force mechanics active with link, charge, center, collision, and lattice forces", () => {
    expect(build().simulation).toEqual({
      enabled: true,
      forces: expect.arrayContaining(["link", "charge", "center", "collision", "lattice"]),
    });
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

describe("rendered-page integration", () => {
  test("includes the same D3 v7 ESM library used by slaughter.pro", async () => {
    const [shell, main] = await Promise.all([
      Bun.file("../src/view/shell.html").text(),
      Bun.file("src/main.ts").text(),
    ]);
    expect(`${shell}\n${main}`).toContain("https://cdn.jsdelivr.net/npm/d3@7/+esm");
  });

  test("adds a graph component beside the ledger matrix and wires it to shared state changes without ledger writes", async () => {
    const [shell, main] = await Promise.all([
      Bun.file("../src/view/shell.html").text(),
      Bun.file("src/main.ts").text(),
    ]);

    expect(shell).toContain('data-view="nkp-graph"');
    expect(shell).toContain("data-nkp-graph");
    expect(shell).toContain("data-hide-filtered-graph-toggle");
    expect(main).toContain("mountNkpGraph");
    expect(main).toMatch(/onChange[\s\S]*\.sync\(/);
    expect(main).not.toMatch(/fetch\([^)]*(?:add|update|remove|ledger)/i);
  });
});
