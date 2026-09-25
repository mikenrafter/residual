import { beforeAll, describe, expect, test } from "bun:test";
import * as d3 from "d3";
import type { PendingState, SnapshotAttractor, SnapshotComponent, SnapshotForce } from "./model";
import {
  buildNkpHypergraphModel,
  centroid,
  convexHull,
  regionCorePath,
} from "./nkp-hypergraph";

/**
 * createRegionsView, FORCE_NODE_SCALE, forceNodeOpacity, forceInteractionDelta
 * and translateGroup don't exist yet (Phase 4/5). Read off the module's
 * namespace object via a dynamic import instead of naming them in a static
 * import — Bun's static `import { name } from "./real-module"` throws a
 * SyntaxError (not `undefined`) when `name` isn't actually exported yet,
 * which would abort this whole file's test discovery. See nkp-graph.test.ts
 * for the guarded pattern applied to a module that doesn't exist at all.
 *
 * `model.fusionGroups` and `model.branchBundles` are new fields on the
 * result of the already-existing `buildNkpHypergraphModel`, so those are
 * read directly off its return value with no special import handling —
 * accessing a not-yet-implemented field on a plain object is just
 * `undefined`, not a crash.
 */
interface ViewCtx {
  host: HTMLElement;
  d3: unknown;
  onToggle: (key: string) => void;
  onClear: () => void;
}
interface ViewHandle {
  update: (state: PendingState, options?: Record<string, unknown>) => void;
  setSelection: (selected: ReadonlySet<string>, connected: ReadonlySet<string>) => void;
  resetView: () => void;
  destroy: () => void;
  /** Test-only hook (not part of the Phase 1 plan's fixed handle contract):
   * the live d3 force simulation, so incremental-update/no-clamping tests
   * can inspect and step physics directly instead of guessing at timing. */
  simulation?: { nodes: () => { id: string; x?: number; y?: number }[]; tick: () => void };
}
interface SimNodeLike { id: string; type: string; attractorId?: string; x?: number; y?: number }
type RegionsViewModule = {
  createRegionsView?: (ctx: ViewCtx) => ViewHandle;
  FORCE_NODE_SCALE?: number;
  forceNodeOpacity?: (kind: "stressor" | "purpose") => number;
  forceInteractionDelta?: (
    source: SimNodeLike & { kind: "stressor" | "purpose" },
    target: SimNodeLike,
    params: { distanceMax: number },
  ) => { vx: number; vy: number };
  translateGroup?: (nodes: SimNodeLike[], attractorId: string, dx: number, dy: number) => void;
};

let regionsModule: RegionsViewModule = {};

beforeAll(async () => {
  regionsModule = (await import("./nkp-hypergraph").catch(() => ({}))) as RegionsViewModule;
});

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

describe("model.fusionGroups (Phase 4)", () => {
  test("lists visible components with identical force vectors, groups of 2+", () => {
    const model = buildNkpHypergraphModel(state());
    const groups = (model as unknown as { fusionGroups?: string[][] }).fusionGroups;
    expect(groups).toBeDefined();
    const sorted = (groups ?? []).map((g) => [...g].sort());
    // cache and database both carry exactly {S-01, P-01}.
    expect(sorted).toContainEqual(["component:cache", "component:database"]);
    // auth {S-01,S-02} and queue {S-01} are unique vectors: no singleton groups.
    expect((groups ?? []).some((g) => g.includes("component:auth"))).toBe(false);
    expect((groups ?? []).some((g) => g.includes("component:queue"))).toBe(false);
    expect((groups ?? []).every((g) => g.length >= 2)).toBe(true);
  });
});

describe("model.branchBundles (Phase 5)", () => {
  test("groups memberships per (component, attractor) with their forceIds", () => {
    const model = buildNkpHypergraphModel(state());
    const bundles = (model as unknown as {
      branchBundles?: { id: string; componentId: string; attractorId: string; forceIds: string[]; focused: boolean }[];
    }).branchBundles;
    expect(bundles).toBeDefined();
    expect(bundles).toHaveLength(6);
    const byKey = new Map((bundles ?? []).map((b) => [`${b.componentId}|${b.attractorId}`, b]));
    expect(byKey.get("component:auth|A-01")?.forceIds.slice().sort()).toEqual(["S-01", "S-02"]);
    expect(byKey.get("component:cache|A-01")?.forceIds).toEqual(["S-01"]);
    expect(byKey.get("component:cache|A-02")?.forceIds).toEqual(["P-01"]);
    expect(byKey.get("component:database|A-01")?.forceIds).toEqual(["S-01"]);
    expect(byKey.get("component:database|A-02")?.forceIds).toEqual(["P-01"]);
    expect(byKey.get("component:queue|A-01")?.forceIds).toEqual(["S-01"]);
    expect((bundles ?? []).every((b) => typeof b.id === "string" && b.id.length > 0)).toBe(true);
    expect((bundles ?? []).every((b) => b.focused === true)).toBe(true);
  });

  test("a bundle is unfocused once every one of its forces is filtered out", () => {
    const model = buildNkpHypergraphModel(state(), { visibleForceIds: new Set(["P-01"]) });
    const bundles = (model as unknown as {
      branchBundles?: { componentId: string; attractorId: string; focused: boolean }[];
    }).branchBundles;
    const authBundle = (bundles ?? []).find((b) => b.componentId === "component:auth" && b.attractorId === "A-01");
    expect(authBundle?.focused).toBe(false);
    const cacheBundle = (bundles ?? []).find((b) => b.componentId === "component:cache" && b.attractorId === "A-02");
    expect(cacheBundle?.focused).toBe(true);
  });
});

describe("regions constants (Phase 4)", () => {
  test("FORCE_NODE_SCALE is 1.3", () => {
    expect(regionsModule.FORCE_NODE_SCALE).toBe(1.3);
  });

  test("forceNodeOpacity: purpose 0.75, stressor 1", () => {
    expect(regionsModule.forceNodeOpacity?.("purpose")).toBe(0.75);
    expect(regionsModule.forceNodeOpacity?.("stressor")).toBe(1);
  });
});

describe("forceInteractionDelta (Phase 4)", () => {
  const paramsFor = (distanceMax: number) => ({ distanceMax });

  test("a purpose pushes a force from another attractor away", () => {
    const source = { id: "force:P-01", type: "force", kind: "purpose" as const, attractorId: "A-01", x: 0, y: 0 };
    const target = { id: "force:S-01", type: "force", attractorId: "A-02", x: 100, y: 0 };
    const delta = regionsModule.forceInteractionDelta?.(source, target, paramsFor(300));
    expect(delta).toBeDefined();
    expect(delta?.vx).toBeGreaterThan(0); // target pushed further along +x, away from source
    expect(delta?.vy ?? NaN).toBeCloseTo(0, 5);
  });

  test("a stressor pulls a force from another attractor toward it, weaker than a purpose's push at equal distance", () => {
    const stressorSource = { id: "force:S-02", type: "force", kind: "stressor" as const, attractorId: "A-01", x: 0, y: 0 };
    const purposeSource = { id: "force:P-01", type: "force", kind: "purpose" as const, attractorId: "A-01", x: 0, y: 0 };
    const target = { id: "force:S-01", type: "force", attractorId: "A-02", x: 100, y: 0 };
    const pull = regionsModule.forceInteractionDelta?.(stressorSource, target, paramsFor(300));
    const push = regionsModule.forceInteractionDelta?.(purposeSource, target, paramsFor(300));
    expect(pull).toBeDefined();
    expect(pull?.vx).toBeLessThan(0); // target pulled back toward the stressor, i.e. -x
    const pullMagnitude = Math.hypot(pull?.vx ?? 0, pull?.vy ?? 0);
    const pushMagnitude = Math.hypot(push?.vx ?? 0, push?.vy ?? 0);
    expect(pullMagnitude).toBeLessThan(pushMagnitude);
  });

  test("same-attractor pairs are untouched regardless of kind", () => {
    const purposeSource = { id: "force:P-01", type: "force", kind: "purpose" as const, attractorId: "A-01", x: 0, y: 0 };
    const stressorSource = { id: "force:S-02", type: "force", kind: "stressor" as const, attractorId: "A-01", x: 0, y: 0 };
    const sameAttractorTarget = { id: "force:S-01", type: "force", attractorId: "A-01", x: 100, y: 0 };
    expect(regionsModule.forceInteractionDelta?.(purposeSource, sameAttractorTarget, paramsFor(300))).toEqual({ vx: 0, vy: 0 });
    expect(regionsModule.forceInteractionDelta?.(stressorSource, sameAttractorTarget, paramsFor(300))).toEqual({ vx: 0, vy: 0 });
  });

  test("pairs beyond distanceMax have no effect", () => {
    const source = { id: "force:P-01", type: "force", kind: "purpose" as const, attractorId: "A-01", x: 0, y: 0 };
    const farTarget = { id: "force:S-01", type: "force", attractorId: "A-02", x: 1000, y: 0 };
    expect(regionsModule.forceInteractionDelta?.(source, farTarget, paramsFor(300))).toEqual({ vx: 0, vy: 0 });
  });

  test("the push falls off with distance", () => {
    const source = { id: "force:P-01", type: "force", kind: "purpose" as const, attractorId: "A-01", x: 0, y: 0 };
    const near = { id: "force:S-01", type: "force", attractorId: "A-02", x: 20, y: 0 };
    const far = { id: "force:S-02", type: "force", attractorId: "A-02", x: 150, y: 0 };
    const nearDelta = regionsModule.forceInteractionDelta?.(source, near, paramsFor(300));
    const farDelta = regionsModule.forceInteractionDelta?.(source, far, paramsFor(300));
    const nearMagnitude = Math.hypot(nearDelta?.vx ?? 0, nearDelta?.vy ?? 0);
    const farMagnitude = Math.hypot(farDelta?.vx ?? 0, farDelta?.vy ?? 0);
    expect(nearMagnitude).toBeGreaterThan(farMagnitude);
  });
});

describe("translateGroup (Phase 4)", () => {
  test("moves only the given attractor's force nodes", () => {
    const nodes: SimNodeLike[] = [
      { id: "force:S-01", type: "force", attractorId: "A-01", x: 10, y: 10 },
      { id: "force:S-02", type: "force", attractorId: "A-01", x: 20, y: 20 },
      { id: "force:P-01", type: "force", attractorId: "A-02", x: 30, y: 30 },
      { id: "component:auth", type: "component", x: 5, y: 5 },
    ];
    regionsModule.translateGroup?.(nodes, "A-01", 100, -50);
    expect(nodes[0]).toMatchObject({ x: 110, y: -40 });
    expect(nodes[1]).toMatchObject({ x: 120, y: -30 });
    expect(nodes[2]).toMatchObject({ x: 30, y: 30 }); // other attractor untouched
    expect(nodes[3]).toMatchObject({ x: 5, y: 5 }); // components untouched
  });
});

describe("createRegionsView (persistent view handle, Phase 4/5)", () => {
  const options = {};

  function makeCtx(): { ctx: ViewCtx; host: HTMLElement; toggled: string[]; clearCount: () => number } {
    document.body.innerHTML = `<div data-host style="width:800px;height:600px"></div>`;
    const host = document.querySelector<HTMLElement>("[data-host]")!;
    const record = { toggled: [] as string[], cleared: 0 };
    const ctx: ViewCtx = {
      host,
      d3,
      onToggle: (key) => record.toggled.push(key),
      onClear: () => { record.cleared += 1; },
    };
    return { ctx, host, toggled: record.toggled, clearCount: () => record.cleared };
  }

  const nodeFor = (host: HTMLElement, selector: string, text: string): SVGGElement | undefined =>
    [...host.querySelectorAll<SVGGElement>(selector)].find((g) => g.textContent?.includes(text));

  test("exists and returns the {update, setSelection, resetView, destroy} handle shape", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    expect(handle).toBeDefined();
    expect(typeof handle?.update).toBe("function");
    expect(typeof handle?.setSelection).toBe("function");
    expect(typeof handle?.resetView).toBe("function");
    expect(typeof handle?.destroy).toBe("function");
  });

  test("a narrower filter keeps the same <svg> and the same element for a surviving node, and removes a filtered-out one", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const svgBefore = host.querySelector("svg");
    const authBefore = nodeFor(host, ".nkp-hyper-component", "auth");
    const queueBefore = nodeFor(host, ".nkp-hyper-component", "queue");
    expect(svgBefore).not.toBeNull();
    expect(authBefore).toBeDefined();
    expect(queueBefore).toBeDefined();

    handle?.update(state(), { hideFiltered: true, visibleComponentNames: new Set(["auth", "cache", "database"]) });
    expect(host.querySelector("svg")).toBe(svgBefore);
    expect(nodeFor(host, ".nkp-hyper-component", "auth")).toBe(authBefore);
    expect(nodeFor(host, ".nkp-hyper-component", "queue")).toBeUndefined();
  });

  test("clicking a component node calls ctx.onToggle with its component key", () => {
    const { ctx, host, toggled } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    nodeFor(host, ".nkp-hyper-component", "auth")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggled).toEqual(["component:auth"]);
  });

  test("clicking a force node calls ctx.onToggle with its force key", () => {
    const { ctx, host, toggled } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    nodeFor(host, ".nkp-hyper-force", "s-01-name")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggled).toEqual(["force:S-01"]);
  });

  test("clicking an attractor region (without dragging) calls ctx.onToggle with its attractor key", () => {
    const { ctx, host, toggled } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const region = host.querySelector<SVGGElement>(".nkp-hyper-region");
    region?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggled).toEqual(["attractor:A-01"]);
  });

  test("double-clicking the background calls ctx.onClear", () => {
    const { ctx, host, clearCount } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    host.querySelector("svg")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(clearCount()).toBeGreaterThan(0);
  });

  test("setSelection marks selected/connected nodes and leaves everyone else unmarked", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    handle?.setSelection(new Set(["component:auth"]), new Set(["component:auth", "force:S-01"]));
    const auth = nodeFor(host, ".nkp-hyper-component", "auth");
    const forceNode = nodeFor(host, ".nkp-hyper-force", "s-01-name");
    const queue = nodeFor(host, ".nkp-hyper-component", "queue");
    expect(auth?.classList.contains("selected")).toBe(true);
    expect(forceNode?.classList.contains("connected")).toBe(true);
    expect(queue?.classList.contains("selected") || queue?.classList.contains("connected")).toBe(false);
  });

  test("all text lives in a last-child g.landscape-labels group", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const svg = host.querySelector("svg");
    const labelGroup = svg?.querySelector("g.landscape-labels");
    expect(labelGroup).not.toBeNull();
    expect(svg?.lastElementChild).toBe(labelGroup ?? null);
    const allText = svg?.querySelectorAll("text") ?? [];
    const labelText = labelGroup?.querySelectorAll("text") ?? [];
    expect(allText.length).toBeGreaterThan(0);
    expect(allText.length).toBe(labelText.length);
  });

  test("incremental update keeps an existing node's x/y instead of reseeding it", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const node = handle?.simulation?.nodes().find((item) => item.id === "force:S-01");
    expect(node).toBeDefined();
    if (node) {
      node.x = 12345;
      node.y = -6789;
    }
    handle?.update(state(), options);
    const after = handle?.simulation?.nodes().find((item) => item.id === "force:S-01");
    expect(after?.x).toBe(12345);
    expect(after?.y).toBe(-6789);
  });

  test("does not clamp node position: a node placed far outside the canvas stays there after a tick", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const node = handle?.simulation?.nodes().find((item) => item.id === "force:S-01");
    expect(node).toBeDefined();
    if (node) {
      node.x = 100000;
      node.y = -100000;
    }
    handle?.simulation?.tick();
    const after = handle?.simulation?.nodes().find((item) => item.id === "force:S-01");
    expect(Math.abs(after?.x ?? 0)).toBeGreaterThan(5000);
    expect(Math.abs(after?.y ?? 0)).toBeGreaterThan(5000);
  });

  test("destroy removes the drawing from the host", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    handle?.destroy();
    expect(host.querySelector("svg")).toBeNull();
  });
});
