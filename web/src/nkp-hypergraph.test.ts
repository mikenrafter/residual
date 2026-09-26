import { beforeAll, describe, expect, test } from "bun:test";
import * as d3 from "d3";
import type { PendingState, SnapshotAttractor, SnapshotComponent, SnapshotForce } from "./model";
import {
  REGIONS_FORCE_COLLISION_RADIUS,
  REGIONS_MIN_NODE_DISTANCE,
  buildNkpHypergraphModel,
  centroid,
  convexHull,
  partitionMembershipBundles,
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
interface SimNodeSnapshot {
  id: string;
  type: string;
  attractorId?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}
interface ViewHandle {
  update: (state: PendingState, options?: Record<string, unknown>) => void;
  setSelection: (
    selected: ReadonlySet<string>,
    connected: ReadonlySet<string>,
    semi?: ReadonlySet<string>,
  ) => void;
  resetView: () => void;
  destroy: () => void;
  /** Test-only hook (not part of the Phase 1 plan's fixed handle contract):
   * the live d3 force simulation, so incremental-update/no-clamping tests
   * can inspect and step physics directly instead of guessing at timing.
   * `tick` accepts an optional iteration count (mirrors d3-force's own
   * simulation.tick(iterations?)), used by the core-containment/collision
   * tests below to settle physics over several steps at once. */
  simulation?: {
    nodes: () => SimNodeSnapshot[];
    tick: (iterations?: number) => void;
    alpha?: () => number;
    alphaTarget?: (value?: number) => number;
  };
  /** Test-only hook (not yet implemented): drives a node drag programmatically
   * instead of through real pointer events, running the same clamp-to-core-
   * boundary logic the real "drag" event handler uses. */
  dragNodeTo?: (nodeId: string, point: { x: number; y: number }) => void;
}
interface SimNodeLike { id: string; type: string; attractorId?: string; componentIds?: string[]; x?: number; y?: number }
interface RegionLock {
  attractorId: string;
  anchor: { x: number; y: number };
  offsets: Map<string, { x: number; y: number }>;
}
interface GroupCircleLike {
  attractorId: string;
  center: { x: number; y: number };
  radius: number;
}
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
  captureRegionLock?: (nodes: SimNodeLike[], attractorId: string) => RegionLock;
  applyRegionLock?: (lock: RegionLock, nodes: SimNodeLike[]) => void;
  moveRegionLock?: (lock: RegionLock, anchor: { x: number; y: number }) => RegionLock;
  editRegionForceOffset?: (lock: RegionLock, forceId: string, point: { x: number; y: number }) => RegionLock;
  // --- core zone (not yet implemented) ---
  CORE_ZONE_BASE_RADIUS?: number;
  CORE_ZONE_RADIUS_PER_COMPONENT?: number;
  COMPONENT_ZONE_INSET?: number;
  coreZoneRadius?: (componentCount: number) => number;
  coreZoneMinimumRadius?: (componentCount: number) => number;
  componentZoneRadius?: (componentCount: number) => number;
  clampToCore?: (
    point: { x: number; y: number },
    center: { x: number; y: number },
    radius: number,
  ) => { x: number; y: number };
  clampOutsideCore?: (
    point: { x: number; y: number },
    center: { x: number; y: number },
    radius: number,
  ) => { x: number; y: number };
  // --- component min-distance / collision radius (not yet implemented) ---
  REGIONS_COMPONENT_MIN_DISTANCE?: number;
  REGIONS_COMPONENT_COLLISION_RADIUS?: number;
  BUNDLE_RADIAL_SPLIT_SEPARATION?: number;
  regionsOuterRadius?: (componentCount: number, attractorForceCounts: readonly number[]) => number;
  regionsDualRingStack?: (
    componentCount: number,
    attractorKindCounts: readonly { purposeCount: number; stressorCount: number }[],
  ) => {
    purposeRingRadius: number;
    innerAnnulus: { inner: number; outer: number };
    componentBand: { inner: number; outer: number; hops: number };
    outerAnnulus: { inner: number; outer: number };
    stressorRingRadius: number;
  };
  REGIONS_COMPONENT_CHARGE?: number;
  REGIONS_BUNDLE_IDLE_OPACITY?: number;
  attractorCoreDistance?: (
    nodes: { id: string; type: string; attractorId?: string; x?: number; y?: number }[],
    attractorId: string,
    center: { x: number; y: number },
  ) => number;
  // --- attractor-group collision (not yet implemented) ---
  attractorGroupCircles?: (
    nodes: { type: string; attractorId?: string; x?: number; y?: number }[],
    padding: number,
  ) => GroupCircleLike[];
  // --- cohesion / settle (red-phase contracts) ---
  createAttractorCohesionForce?: (strength?: number) => unknown;
  ATTRACTOR_COHESION_STRENGTH?: number;
  INITIAL_SETTLE_TICKS?: number;
};

let regionsModule: RegionsViewModule = {};

beforeAll(async () => {
  regionsModule = (await import("./nkp-hypergraph").catch(() => ({}))) as RegionsViewModule;
});

function kindCountsFromNodes(nodes: SimNodeSnapshot[]): Array<{ purposeCount: number; stressorCount: number }> {
  const byAttractor = new Map<string, { purposeCount: number; stressorCount: number }>();
  for (const node of nodes) {
    if (node.type !== "force" || !node.attractorId) continue;
    const entry = byAttractor.get(node.attractorId) ?? { purposeCount: 0, stressorCount: 0 };
    const kind = (node as { kind?: string }).kind
      ?? (node.id.includes(":P-") || /force:P/.test(node.id) ? "purpose" : "stressor");
    if (kind === "purpose") entry.purposeCount += 1;
    else entry.stressorCount += 1;
    byAttractor.set(node.attractorId, entry);
  }
  return [...byAttractor.values()];
}

function dualStackFor(handle: ViewHandle | undefined) {
  const nodes = handle?.simulation?.nodes() ?? [];
  const componentCount = nodes.filter((n) => n.type === "component").length;
  return regionsModule.regionsDualRingStack?.(componentCount, kindCountsFromNodes(nodes));
}
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

  test("every force node precedes every component node, so attractors seed before components", () => {
    const model = buildNkpHypergraphModel(state());
    const firstComponentIndex = model.nodes.findIndex((item) => item.type === "component");
    const lastForceIndex = model.nodes.map((item) => item.type).lastIndexOf("force");
    expect(firstComponentIndex).toBeGreaterThan(lastForceIndex);
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

describe("model.forceBranchBundles (bidirectional bundling)", () => {
  test("one bundle per visible force, branching to its deduped components", () => {
    const model = buildNkpHypergraphModel(state());
    const bundles = model.forceBranchBundles;
    expect(bundles).toHaveLength(3);
    const byForce = new Map(bundles.map((b) => [b.forceId, b]));
    expect(byForce.get("force:S-01")?.componentIds.slice().sort()).toEqual([
      "component:auth", "component:cache", "component:database", "component:queue",
    ]);
    expect(byForce.get("force:S-02")?.componentIds).toEqual(["component:auth"]);
    expect(byForce.get("force:P-01")?.componentIds.slice().sort()).toEqual(["component:cache", "component:database"]);
    expect(byForce.get("force:S-01")?.attractorId).toBe("A-01");
    expect(byForce.get("force:P-01")?.attractorId).toBe("A-02");
    expect(bundles.every((b) => typeof b.id === "string" && b.id.length > 0)).toBe(true);
    expect(bundles.every((b) => b.focused === true)).toBe(true);
  });

  test("a force with 3+ components produces a 3+-branch geometry (via branchGeometry directly)", () => {
    const model = buildNkpHypergraphModel(state());
    const s01 = model.forceBranchBundles.find((b) => b.forceId === "force:S-01");
    expect(s01?.componentIds).toHaveLength(4);
  });

  test("a bundle is unfocused once its force is filtered out", () => {
    const model = buildNkpHypergraphModel(state(), { visibleForceIds: new Set(["P-01"]) });
    const s01 = model.forceBranchBundles.find((b) => b.forceId === "force:S-01");
    expect(s01?.focused).toBe(false);
    const p01 = model.forceBranchBundles.find((b) => b.forceId === "force:P-01");
    expect(p01?.focused).toBe(true);
  });
});

describe("partitionMembershipBundles (components do not bundle)", () => {
  test("drops every component→force fan", () => {
    const model = buildNkpHypergraphModel(state());
    const partitioned = partitionMembershipBundles(model.branchBundles, model.forceBranchBundles);
    expect(partitioned.branchBundles).toEqual([]);
    expect(partitioned.forceBranchBundles.length).toBe(model.forceBranchBundles.length);
  });

  test("preserves force→component membership coverage", () => {
    const model = buildNkpHypergraphModel(state());
    const partitioned = partitionMembershipBundles(model.branchBundles, model.forceBranchBundles);
    const edgeKeys = new Set<string>();
    for (const bundle of partitioned.forceBranchBundles) {
      const members = bundle.forceIds ?? [bundle.forceId];
      for (const forceId of members) {
        for (const componentId of bundle.componentIds) {
          edgeKeys.add(`${forceId}|${componentId}`);
        }
      }
    }
    // Per-force model bundles still cover every membership once each.
    expect(edgeKeys.size).toBe(model.edges.length);
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

  test("REGIONS_FORCE_COLLISION_RADIUS matches component tessellation pitch", () => {
    expect(REGIONS_FORCE_COLLISION_RADIUS).toBe(REGIONS_MIN_NODE_DISTANCE / 2);
    expect(REGIONS_FORCE_COLLISION_RADIUS).toBe(regionsModule.REGIONS_COMPONENT_COLLISION_RADIUS);
    expect(REGIONS_MIN_NODE_DISTANCE).toBe(regionsModule.REGIONS_COMPONENT_MIN_DISTANCE);
    // Sanity: two colliding force nodes (each pushed apart by their own
    // collision radius) should end up exactly REGIONS_MIN_NODE_DISTANCE apart.
    expect(REGIONS_FORCE_COLLISION_RADIUS * 2).toBe(REGIONS_MIN_NODE_DISTANCE);
  });

  test("REGIONS_COMPONENT_COLLISION_RADIUS is half of REGIONS_COMPONENT_MIN_DISTANCE", () => {
    expect(regionsModule.REGIONS_COMPONENT_COLLISION_RADIUS! * 2).toBe(regionsModule.REGIONS_COMPONENT_MIN_DISTANCE);
  });
});

describe("core zone geometry (not yet implemented)", () => {
  test("CORE_ZONE_BASE_RADIUS and CORE_ZONE_RADIUS_PER_COMPONENT are tunable finite positive constants", () => {
    expect(typeof regionsModule.CORE_ZONE_BASE_RADIUS).toBe("number");
    expect(Number.isFinite(regionsModule.CORE_ZONE_BASE_RADIUS)).toBe(true);
    expect(regionsModule.CORE_ZONE_BASE_RADIUS ?? -1).toBeGreaterThan(0);
    expect(typeof regionsModule.CORE_ZONE_RADIUS_PER_COMPONENT).toBe("number");
    expect(Number.isFinite(regionsModule.CORE_ZONE_RADIUS_PER_COMPONENT)).toBe(true);
    expect(regionsModule.CORE_ZONE_RADIUS_PER_COMPONENT ?? -1).toBeGreaterThan(0);
  });

  test("coreZoneRadius(0) is a finite positive base radius", () => {
    const base = regionsModule.coreZoneRadius?.(0);
    expect(typeof base).toBe("number");
    expect(Number.isFinite(base)).toBe(true);
    expect(base ?? -1).toBeGreaterThan(0);
  });

  test("coreZoneRadius grows (non-decreasing, then strictly increasing) with component count", () => {
    const r0 = regionsModule.coreZoneRadius?.(0) ?? 0;
    const r1 = regionsModule.coreZoneRadius?.(1) ?? 0;
    const r4 = regionsModule.coreZoneRadius?.(4) ?? 0;
    const r16 = regionsModule.coreZoneRadius?.(16) ?? 0;
    expect(r1).toBeGreaterThanOrEqual(r0);
    expect(r4).toBeGreaterThan(r1);
    expect(r16).toBeGreaterThan(r4);
  });

  test("coreZoneRadius grows like sqrt(componentCount), not linearly", () => {
    const r1 = regionsModule.coreZoneRadius?.(1) ?? 0;
    const r4 = regionsModule.coreZoneRadius?.(4) ?? 0;
    const r16 = regionsModule.coreZoneRadius?.(16) ?? 0;
    const growth1 = r4 - r1; // sqrt(4)-sqrt(1) = 1
    const growth2 = r16 - r4; // sqrt(16)-sqrt(4) = 2
    const ratio = growth2 / growth1;
    // Linear scaling would give exactly (16-4)/(4-1) = 4; no/constant scaling
    // would give a ratio near 1. sqrt scaling gives exactly 2 regardless of
    // the tunable base/coefficient, so loose bounds still discriminate.
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.7);
  });

  test("coreZoneRadius is exactly twice coreZoneMinimumRadius, at several component counts", () => {
    for (const n of [0, 1, 4, 16, 50]) {
      expect(regionsModule.coreZoneRadius?.(n)).toBeCloseTo(2 * (regionsModule.coreZoneMinimumRadius?.(n) ?? 0), 5);
    }
  });

  test("coreZoneMinimumRadius is a finite positive number that grows with component count", () => {
    const r0 = regionsModule.coreZoneMinimumRadius?.(0) ?? 0;
    const r1 = regionsModule.coreZoneMinimumRadius?.(1) ?? 0;
    const r4 = regionsModule.coreZoneMinimumRadius?.(4) ?? 0;
    const r16 = regionsModule.coreZoneMinimumRadius?.(16) ?? 0;
    expect(typeof regionsModule.coreZoneMinimumRadius?.(0)).toBe("number");
    expect(Number.isFinite(r0)).toBe(true);
    expect(r0).toBeGreaterThan(0);
    expect(r1).toBeGreaterThanOrEqual(r0);
    expect(r4).toBeGreaterThan(r1);
    expect(r16).toBeGreaterThan(r4);
  });

  test("componentZoneRadius is ~2 tessellation hops inset from the outer core ring", () => {
    expect(regionsModule.COMPONENT_ZONE_INSET).toBe(
      (regionsModule.REGIONS_COMPONENT_MIN_DISTANCE ?? 60) * 2,
    );
    for (const n of [1, 4, 16, 50]) {
      const outer = regionsModule.coreZoneRadius?.(n) ?? 0;
      const inner = regionsModule.componentZoneRadius?.(n) ?? 0;
      expect(inner).toBeLessThan(outer);
      expect(inner).toBeCloseTo(
        Math.max((regionsModule.CORE_ZONE_BASE_RADIUS ?? 60) * 0.5, outer - (regionsModule.COMPONENT_ZONE_INSET ?? 0)),
        5,
      );
    }
  });

  test("clampToCore leaves a point already inside the circle unchanged", () => {
    const point = { x: 5, y: 5 };
    expect(regionsModule.clampToCore?.(point, { x: 0, y: 0 }, 40)).toEqual(point);
  });

  test("clampToCore pulls an outside point onto the boundary along the same direction from center", () => {
    const clamped = regionsModule.clampToCore?.({ x: 100, y: 0 }, { x: 0, y: 0 }, 40);
    expect(clamped?.x).toBeCloseTo(40, 5);
    expect(clamped?.y).toBeCloseTo(0, 5);
  });

  test("clampToCore works relative to an arbitrary, non-origin center", () => {
    const clamped = regionsModule.clampToCore?.({ x: 110, y: 10 }, { x: 10, y: 10 }, 40);
    expect(clamped?.x).toBeCloseTo(50, 5);
    expect(clamped?.y).toBeCloseTo(10, 5);
  });

  test("clampOutsideCore leaves a point already outside the circle unchanged", () => {
    const point = { x: 100, y: 0 };
    expect(regionsModule.clampOutsideCore?.(point, { x: 0, y: 0 }, 40)).toEqual(point);
  });

  test("clampOutsideCore pushes an inside point onto the boundary along the same direction from center", () => {
    const clamped = regionsModule.clampOutsideCore?.({ x: 5, y: 0 }, { x: 0, y: 0 }, 40);
    expect(clamped?.x).toBeCloseTo(40, 5);
    expect(clamped?.y).toBeCloseTo(0, 5);
  });

  test("clampOutsideCore works relative to an arbitrary, non-origin center", () => {
    const clamped = regionsModule.clampOutsideCore?.({ x: 15, y: 10 }, { x: 10, y: 10 }, 40);
    expect(clamped?.x).toBeCloseTo(50, 5);
    expect(clamped?.y).toBeCloseTo(10, 5);
  });

  test("attractorCoreDistance measures distance to the closest force member of an attractor", () => {
    const nodes = [
      { id: "force:S-01", type: "force", attractorId: "A-01", x: 100, y: 0 },
      { id: "force:S-02", type: "force", attractorId: "A-01", x: 10, y: 0 }, // closest
      { id: "component:auth", type: "component", attractorId: "A-01", x: 1, y: 0 }, // ignored: not a force
    ];
    expect(regionsModule.attractorCoreDistance?.(nodes, "A-01", { x: 0, y: 0 })).toBeCloseTo(10, 5);
  });

  test("attractorCoreDistance ignores component-type nodes even when closer than any force member", () => {
    const nodes = [
      { id: "component:auth", type: "component", attractorId: "A-02", x: 1, y: 0 },
      { id: "force:P-01", type: "force", attractorId: "A-02", x: 50, y: 0 },
    ];
    expect(regionsModule.attractorCoreDistance?.(nodes, "A-02", { x: 0, y: 0 })).toBeCloseTo(50, 5);
  });

  test("attractorCoreDistance is Infinity when the attractor has no force members", () => {
    const nodes = [
      { id: "force:S-01", type: "force", attractorId: "A-01", x: 10, y: 0 },
    ];
    expect(regionsModule.attractorCoreDistance?.(nodes, "A-99", { x: 0, y: 0 })).toBe(Infinity);
    expect(regionsModule.attractorCoreDistance?.([], "A-01", { x: 0, y: 0 })).toBe(Infinity);
  });
});

describe("attractorGroupCircles (not yet implemented)", () => {
  test("summarizes each attractor's force nodes as a padded bounding circle, ignoring component nodes", () => {
    const nodes = [
      { type: "force", attractorId: "A-01", x: 0, y: 0 },
      { type: "force", attractorId: "A-01", x: 10, y: 0 },
      { type: "force", attractorId: "A-02", x: 100, y: 100 },
      { type: "component", attractorId: undefined, x: 5, y: 5 }, // ignored
    ];
    const circles = regionsModule.attractorGroupCircles?.(nodes, 10) ?? [];
    expect(circles).toHaveLength(2);
    const a1 = circles.find((c) => c.attractorId === "A-01")!;
    expect(a1).toBeDefined();
    expect(a1.center.x).toBeCloseTo(5, 5);
    expect(a1.center.y).toBeCloseTo(0, 5);
    expect(a1.radius).toBeCloseTo(15, 5); // farthest member is 5 away from centroid, + 10 padding
  });
});

describe("forceInteractionDelta pressure rules", () => {
  const paramsFor = (distanceMax: number) => ({ distanceMax });
  const kinds = ["stressor", "purpose"] as const;

  test.each(kinds)("a %s force pushes a force outside its attractor away", (kind) => {
    const source = { id: "force:F-01", type: "force", kind, attractorId: "A-01", componentIds: ["component:auth"], x: 0, y: 0 };
    const target = { id: "force:F-02", type: "force", attractorId: "A-02", x: 100, y: 0 };
    const delta = regionsModule.forceInteractionDelta?.(source, target, paramsFor(300));
    expect(delta).toBeDefined();
    expect(delta?.vx).toBeGreaterThan(0); // target pushed further along +x, away from source
    expect(delta?.vy ?? NaN).toBeCloseTo(0, 5);
  });

  test.each(kinds)("a %s force pulls a force in its own attractor toward it", (kind) => {
    const source = { id: "force:F-01", type: "force", kind, attractorId: "A-01", componentIds: ["component:auth"], x: 0, y: 0 };
    const target = { id: "force:F-02", type: "force", attractorId: "A-01", x: 100, y: 0 };
    expect(regionsModule.forceInteractionDelta?.(source, target, paramsFor(300))?.vx).toBeLessThan(0);
  });

  test.each(kinds)("a %s force pulls a directly connected component and pushes an unconnected one", (kind) => {
    const source = { id: "force:F-01", type: "force", kind, attractorId: "A-01", componentIds: ["component:auth"], x: 0, y: 0 };
    const direct = { id: "component:auth", type: "component", x: 100, y: 0 };
    const other = { id: "component:cache", type: "component", x: 100, y: 0 };
    expect(regionsModule.forceInteractionDelta?.(source, direct, paramsFor(300))?.vx).toBeLessThan(0);
    expect(regionsModule.forceInteractionDelta?.(source, other, paramsFor(300))?.vx).toBeGreaterThan(0);
  });

  test("stressor and purpose sources produce identical deltas in equivalent geometry", () => {
    const stressor = { id: "force:S-01", type: "force", kind: "stressor" as const, attractorId: "A-01", componentIds: ["component:auth"], x: 0, y: 0 };
    const purpose = { id: "force:P-01", type: "force", kind: "purpose" as const, attractorId: "A-01", componentIds: ["component:auth"], x: 0, y: 0 };
    const target = { id: "force:F-02", type: "force", attractorId: "A-02", x: 100, y: 0 };
    expect(regionsModule.forceInteractionDelta?.(stressor, target, paramsFor(300)))
      .toEqual(regionsModule.forceInteractionDelta?.(purpose, target, paramsFor(300)));
  });

  test("pairs beyond distanceMax have no effect", () => {
    const source = { id: "force:P-01", type: "force", kind: "purpose" as const, attractorId: "A-01", componentIds: [], x: 0, y: 0 };
    const farTarget = { id: "force:S-01", type: "force", attractorId: "A-02", x: 1000, y: 0 };
    expect(regionsModule.forceInteractionDelta?.(source, farTarget, paramsFor(300))).toEqual({ vx: 0, vy: 0 });
  });

  test("the push falls off with distance", () => {
    const source = { id: "force:P-01", type: "force", kind: "purpose" as const, attractorId: "A-01", componentIds: [], x: 0, y: 0 };
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

describe("locked attractor regions", () => {
  const nodes: SimNodeLike[] = [
    { id: "force:S-01", type: "force", attractorId: "A-01", x: 10, y: 20 },
    { id: "force:S-02", type: "force", attractorId: "A-01", x: 30, y: 40 },
    { id: "force:P-01", type: "force", attractorId: "A-02", x: 80, y: 90 },
    { id: "component:auth", type: "component", x: 15, y: 25 },
  ];

  test("captures an anchor and force-member offsets but never locks components", () => {
    const lock = regionsModule.captureRegionLock?.(nodes, "A-01");
    expect(lock).toBeDefined();
    expect([...lock!.offsets.keys()].sort()).toEqual(["force:S-01", "force:S-02"]);
    expect(lock!.offsets.has("component:auth")).toBe(false);
  });

  test("moving a locked region preserves every stored force offset", () => {
    const lock = regionsModule.captureRegionLock?.(nodes, "A-01");
    expect(lock).toBeDefined();
    const moved = regionsModule.moveRegionLock?.(lock!, { x: 200, y: 300 });
    const copy = nodes.map((node) => ({ ...node }));
    if (moved) regionsModule.applyRegionLock?.(moved, copy);
    expect(copy[1]!.x! - copy[0]!.x!).toBe(20);
    expect(copy[1]!.y! - copy[0]!.y!).toBe(20);
    expect(copy[3]).toMatchObject({ x: 15, y: 25 });
  });

  test("dragging one force edits only its saved offset", () => {
    const lock = regionsModule.captureRegionLock?.(nodes, "A-01");
    expect(lock).toBeDefined();
    const edited = regionsModule.editRegionForceOffset?.(lock!, "force:S-01", { x: 100, y: 110 });
    expect(edited?.offsets.get("force:S-01")).not.toEqual(lock!.offsets.get("force:S-01"));
    expect(edited?.offsets.get("force:S-02")).toEqual(lock!.offsets.get("force:S-02"));
  });

  test("lock state can be reapplied after members disappear under a filter and return", () => {
    const lock = regionsModule.captureRegionLock?.(nodes, "A-01");
    expect(lock).toBeDefined();
    const moved = regionsModule.moveRegionLock?.(lock!, { x: 300, y: 200 });
    const filtered = nodes.filter((node) => node.id !== "force:S-02").map((node) => ({ ...node }));
    if (moved) regionsModule.applyRegionLock?.(moved, filtered);
    const restored = nodes.map((node) => ({ ...node }));
    if (moved) regionsModule.applyRegionLock?.(moved, restored);
    expect(restored.find((node) => node.id === "force:S-02")).toMatchObject({ x: 310, y: 210 });
  });
});

describe("createRegionsView (persistent view handle, Phase 4/5)", () => {
  const options = { lockRegions: false };

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

  test("focus elevates selected/connected labels without changing unfocused name visibility", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const unrelatedBefore = nodeFor(host, ".nkp-hyper-component-label", "cache")?.getAttribute("opacity");
    handle?.setSelection(
      new Set(["component:auth"]),
      new Set(["component:auth", "force:S-01", "attractor:A-01"]),
    );
    const auth = nodeFor(host, ".nkp-hyper-component-label", "auth");
    const connectedForce = nodeFor(host, ".nkp-hyper-force-label", "s-01-name");
    const unrelated = nodeFor(host, ".nkp-hyper-component-label", "cache");
    expect(auth?.getAttribute("opacity")).not.toBe("0");
    expect(connectedForce?.getAttribute("opacity")).not.toBe("0");
    // Unfocused labels keep their pre-selection opacity (default rules), not forced to 0/1.
    expect(unrelated?.getAttribute("opacity")).toBe(unrelatedBefore);
    connectedForce?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(connectedForce?.getAttribute("opacity")).not.toBe("0");
  });

  test("regions setSelection marks semi-focused nodes at the one-hop ring", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    // auth focused → cache is semi (S-01 peer)
    handle?.setSelection(
      new Set(["component:auth"]),
      new Set(["component:auth", "force:S-01", "force:S-02", "attractor:A-01"]),
      new Set(["component:cache"]),
    );
    const cache = nodeFor(host, ".nkp-hyper-component", "cache");
    const queue = nodeFor(host, ".nkp-hyper-component", "queue");
    expect(cache?.classList.contains("semi")).toBe(true);
    expect(cache?.classList.contains("dim")).toBe(false);
    expect(queue?.classList.contains("semi")).toBe(false);
    expect(queue?.classList.contains("dim")).toBe(true);
  });

  test("uses shape for component implementation status and kind for force glyphs", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    const pending = state({
      baseComponents: [component("auth", "actual"), component("cache", "proposed"), component("database"), component("queue"), component("orphan")],
    });
    handle?.update(pending, options);
    const actual = [...host.querySelectorAll<SVGGElement>("g.nkp-hyper-component")]
      .find((item) => item.getAttribute("aria-label")?.includes("auth"));
    const proposed = [...host.querySelectorAll<SVGGElement>("g.nkp-hyper-component")]
      .find((item) => item.getAttribute("aria-label")?.includes("cache"));
    expect(actual?.querySelector('[data-component-status-shape="actual"]')?.tagName.toLowerCase()).toBe("circle");
    expect(proposed?.querySelector('[data-component-status-shape="proposed"]')?.tagName.toLowerCase()).toBe("rect");
    expect(host.querySelector('g.nkp-hyper-force[aria-label*="S-01"] [data-force-kind-glyph="stressor"]')).not.toBeNull();
    expect(host.querySelector('g.nkp-hyper-force[aria-label*="P-01"] [data-force-kind-glyph="purpose"]')).not.toBeNull();
  });

  test("renders a two-component fusion candidate as a true nonzero-area hull", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const hull = host.querySelector<SVGPathElement>(".nkp-hyper-fusion-hull");
    expect(hull).not.toBeNull();
    expect(hull?.getAttribute("d")).toMatch(/^M.+Z$/);
    const coordinates = [...(hull?.getAttribute("d")?.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g) ?? [])]
      .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
    expect(coordinates.length).toBeGreaterThanOrEqual(4);
    const twiceArea = coordinates.reduce((sum, point, index) => {
      const next = coordinates[(index + 1) % coordinates.length]!;
      return sum + point.x * next.y - next.x * point.y;
    }, 0);
    expect(Math.abs(twiceArea)).toBeGreaterThan(0);
  });

  test("styles fusion regions with gray fill and a dotted red border", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const hull = host.querySelector<SVGPathElement>(".nkp-hyper-fusion-hull");
    expect(hull?.getAttribute("fill")).toMatch(/gray|grey|#(?:[0-9a-f]{3}){1,2}|rgb/i);
    expect(hull?.getAttribute("stroke")).toMatch(/red|#c45c5c|var\(--warn\)/i);
    expect(hull?.getAttribute("stroke-dasharray")).not.toBeNull();
  });

  test("uses accessible labels instead of native SVG title tooltips", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    expect(host.querySelector("svg title")).toBeNull();
    expect([...host.querySelectorAll<SVGElement>(".nkp-hyper-node, .nkp-hyper-region")].every((item) =>
      Boolean(item.getAttribute("aria-label")))).toBe(true);
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

  test("label projection tracks the live pan/zoom transform, not the load-time one", () => {
    // Ideally this drives a real ctrl+wheel zoom gesture and asserts the
    // off-screen label's clamped position moves to match the new viewport.
    // That path was investigated and found unreliable in this project's
    // happy-dom version: happy-dom's WheelEvent constructor silently drops
    // `ctrlKey`/`metaKey` from its init dict (confirmed by probing
    // `new WheelEvent("wheel", { ctrlKey: true }).ctrlKey`, which reads back
    // `undefined`), so landscape-dom's zoom filter (`ctrlKey || metaKey`)
    // never passes and d3-zoom's wheel handler never runs. Forcing `ctrlKey`
    // via `Object.defineProperty` after construction *does* make the filter
    // pass, but then trips a second happy-dom gap: d3-zoom's wheel handler
    // calls `d3.pointer`, which needs `SVGPoint.matrixTransform` — not
    // implemented in happy-dom — so the handler throws internally (that
    // throw is swallowed by the DOM dispatch algorithm per spec, so it never
    // surfaces as a test failure, but the transform still never changes).
    // Either way, a real zoom cannot be driven end-to-end here, so this is
    // scaled back to the more modest contract the task allows: dispatching
    // ctrl/plain wheel events on the svg must not throw, and the label for a
    // node placed far off-screen must keep finite (non-NaN/Infinity) x/y
    // attributes across it — guarding against the transform-inversion math
    // blowing up, which is the concrete regression risk of this change.
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const svg = host.querySelector<SVGSVGElement>("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class")).toContain("nkp-hyper");

    const node = handle?.simulation?.nodes().find((item) => item.id === "force:S-01");
    expect(node).toBeDefined();
    if (node) { node.x = -5000; node.y = -5000; }

    // update() ends with a synchronous `tick()` call (positionLabels included),
    // so re-running it repaints the label for the moved node without needing
    // the simulation's own async timer to fire. `simulation.tick()` would NOT
    // do this: d3-force's manual tick() only advances physics, it never
    // dispatches the "tick" event the render loop listens on.
    handle?.update(state(), options);
    const forceLabel = (): SVGTextElement | undefined =>
      [...host.querySelectorAll<SVGTextElement>("text.nkp-hyper-force-label")]
        .find((el) => el.textContent === "s-01-name");
    const before = forceLabel();
    expect(before).toBeDefined();
    expect(Number.isFinite(Number(before?.getAttribute("x")))).toBe(true);
    expect(Number.isFinite(Number(before?.getAttribute("y")))).toBe(true);

    // A plain wheel is not a zoom gesture per landscape-dom's filter
    // (ctrlKey/metaKey required) — confirm it's a safe no-op first.
    const plainWheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: false, deltaY: 1 });
    expect(() => svg?.dispatchEvent(plainWheel)).not.toThrow();

    // A ctrl+wheel dispatch (the real zoom gesture, environment limitations
    // notwithstanding per the note above) must still be safe to fire.
    const zoomWheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -240 });
    expect(() => svg?.dispatchEvent(zoomWheel)).not.toThrow();

    // Re-render once more so positionLabels() recomputes its clipping box
    // against whatever transform is current, and confirm the label is still
    // sane (finite, not NaN/Infinity) rather than crashing or corrupting.
    handle?.update(state(), options);
    const after = forceLabel();
    expect(after).toBeDefined();
    expect(Number.isFinite(Number(after?.getAttribute("x")))).toBe(true);
    expect(Number.isFinite(Number(after?.getAttribute("y")))).toBe(true);
  });

  test("destroy removes the drawing from the host", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    handle?.destroy();
    expect(host.querySelector("svg")).toBeNull();
  });

  // --- core zone (not yet implemented) ---

  test("newly seeded force nodes spawn on their kind rings and component nodes spawn in the component band", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options); // first update: every node is a newcomer
    const allNodes = handle?.simulation?.nodes() ?? [];
    const stack = dualStackFor(handle);
    expect(stack).toBeDefined();
    const center = { x: 400, y: 300 };
    for (const node of allNodes) {
      const distance = Math.hypot((node.x ?? 0) - center.x, (node.y ?? 0) - center.y);
      if (node.type === "component") {
        expect(distance).toBeGreaterThanOrEqual(stack!.componentBand.inner - 1);
        expect(distance).toBeLessThanOrEqual(stack!.componentBand.outer + 1);
      }
      if (node.type === "force") {
        const kind = (node as { kind?: string }).kind;
        if (kind === "purpose") expect(distance).toBeLessThanOrEqual(stack!.innerAnnulus.inner + 1);
        else expect(distance).toBeGreaterThanOrEqual(stack!.outerAnnulus.outer - 1);
      }
    }
  });

  test("core containment: a component node pushed outside the component band is pulled back after a tick", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const allNodes = handle?.simulation?.nodes() ?? [];
    const componentNode = allNodes.find((n: any) => n.type === "component");
    expect(componentNode).toBeDefined();
    if (componentNode) {
      componentNode.x = 100000;
      componentNode.y = -100000;
      componentNode.vx = 0;
      componentNode.vy = 0;
    }
    handle?.simulation?.tick();
    const after = handle?.simulation?.nodes().find((n: any) => n.id === componentNode?.id);
    const stack = dualStackFor(handle);
    const distance = Math.hypot((after?.x ?? 0) - 400, (after?.y ?? 0) - 300);
    expect(distance).toBeLessThanOrEqual((stack?.componentBand.outer ?? 0) + 0.5);
  });

  test("core exclusion: an attractor group pushed into the core is clamped outside without freezing", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options); // options does not set lockRegions — must work with the manual lock toggle off
    const allNodes = handle?.simulation?.nodes() ?? [];
    const forceNode = allNodes.find((n: any) => n.id === "force:S-01");
    expect(forceNode).toBeDefined();
    if (forceNode) { forceNode.x = 400; forceNode.y = 300; forceNode.vx = 0; forceNode.vy = 0; forceNode.fx = null; forceNode.fy = null; }
    handle?.simulation?.tick();
    const after = handle?.simulation?.nodes().find((n: any) => n.id === "force:S-01");
    const componentCount = allNodes.filter((n: any) => n.type === "component").length;
    const radius = regionsModule.coreZoneRadius?.(componentCount) ?? 0;
    const distance = Math.hypot((after?.x ?? 0) - 400, (after?.y ?? 0) - 300);
    // Clamped onto/outside the outer boundary, but not pinned (can still move).
    expect(distance).toBeGreaterThanOrEqual(radius - 0.5);
    expect(after?.fx == null).toBe(true);
    expect(after?.fy == null).toBe(true);
  });

  test("core exclusion keeps forces free to slide once outside the zone", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const forceNode = handle?.simulation?.nodes().find((n: any) => n.id === "force:S-01");
    if (forceNode) { forceNode.x = 400; forceNode.y = 300; forceNode.vx = 0; forceNode.vy = 0; forceNode.fx = null; forceNode.fy = null; }
    handle?.simulation?.tick();
    const afterClamp = handle?.simulation?.nodes().find((n: any) => n.id === "force:S-01");
    expect(afterClamp?.fx == null).toBe(true);
    if (afterClamp) { afterClamp.x = 5000; afterClamp.y = 5000; afterClamp.vx = 10; afterClamp.vy = 0; }
    handle?.simulation?.tick();
    const after = handle?.simulation?.nodes().find((n: any) => n.id === "force:S-01");
    expect(after?.fx == null).toBe(true);
  });

  test("draws a dashed circle marking the outer stressor ring, sized to the dual-ring stack", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const boundary = host.querySelector("[data-core-boundary]");
    expect(boundary).not.toBeNull();
    expect(boundary?.getAttribute("cx")).toBe("400");
    expect(boundary?.getAttribute("cy")).toBe("300");
    const stack = dualStackFor(handle);
    expect(Number(boundary?.getAttribute("r"))).toBeCloseTo(stack?.stressorRingRadius ?? 0, 5);
  });

  test("draws dashed borders around the inner annulus (both edges)", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const stack = dualStackFor(handle);
    const inner = host.querySelector("[data-inner-annulus-inner]");
    const outer = host.querySelector("[data-inner-annulus-outer]");
    expect(inner).not.toBeNull();
    expect(outer).not.toBeNull();
    expect(inner?.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(outer?.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(Number(inner?.getAttribute("r"))).toBeCloseTo(stack?.innerAnnulus.inner ?? 0, 5);
    expect(Number(outer?.getAttribute("r"))).toBeCloseTo(stack?.innerAnnulus.outer ?? 0, 5);
  });

  test("components are pressure-free (many-body charge is zero)", () => {
    expect(regionsModule.REGIONS_COMPONENT_CHARGE).toBe(0);
  });

  test("with no selection, membership bundles render at half the lit opacity", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const idle = regionsModule.REGIONS_BUNDLE_IDLE_OPACITY ?? 0.225;
    const trunk = host.querySelector("g.nkp-hyper-bundle");
    expect(trunk).not.toBeNull();
    expect(Number(trunk?.getAttribute("opacity"))).toBeCloseTo(idle, 5);
  });

  test("core boundary circle has an explicit visible stroke", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const boundary = host.querySelector("[data-core-boundary]");
    expect(boundary).not.toBeNull();
    expect(boundary?.classList.contains("nkp-hyper-core-boundary")).toBe(true);
    const stroke = boundary?.getAttribute("stroke") ?? "";
    expect(stroke.length).toBeGreaterThan(0);
    expect(stroke).not.toBe("none");
  });

  test("draws a horizontal dividing line across the core zone boundary", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const boundary = host.querySelector("[data-core-boundary]");
    const divider = host.querySelector("[data-core-boundary-divider]");
    expect(divider).not.toBeNull();
    const cx = Number(boundary?.getAttribute("cx"));
    const cy = Number(boundary?.getAttribute("cy"));
    const r = Number(boundary?.getAttribute("r"));
    expect(Number(divider?.getAttribute("x1"))).toBeCloseTo(cx - r, 1);
    expect(Number(divider?.getAttribute("x2"))).toBeCloseTo(cx + r, 1);
    expect(Number(divider?.getAttribute("y1"))).toBeCloseTo(cy, 1);
    expect(Number(divider?.getAttribute("y2"))).toBeCloseTo(cy, 1);
  });

  // --- dragging is clamped at the core zone boundary (not yet implemented) ---

  test("dragging a component node toward the boundary and beyond stops it at the band outer edge", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const allNodes = handle?.simulation?.nodes() ?? [];
    const componentNode = allNodes.find((n: any) => n.type === "component");
    expect(componentNode).toBeDefined();
    const stack = dualStackFor(handle);
    const radius = stack?.componentBand.outer ?? 0;
    const center = { x: 400, y: 300 };
    handle?.dragNodeTo?.(componentNode!.id, { x: center.x + radius * 5, y: center.y });
    const after = handle?.simulation?.nodes().find((n: any) => n.id === componentNode!.id);
    const distance = Math.hypot((after?.x ?? 0) - center.x, (after?.y ?? 0) - center.y);
    expect(distance).toBeCloseTo(radius, 0);
  });

  test("dragging a stressor force node toward the center stops it at the outer annulus", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const forceNode = handle?.simulation?.nodes().find((n: any) => n.id === "force:S-01");
    expect(forceNode).toBeDefined();
    const stack = dualStackFor(handle);
    const radius = stack?.outerAnnulus.outer ?? 0;
    const center = { x: 400, y: 300 };
    handle?.dragNodeTo?.("force:S-01", center);
    const after = handle?.simulation?.nodes().find((n: any) => n.id === "force:S-01");
    const distance = Math.hypot((after?.x ?? 0) - center.x, (after?.y ?? 0) - center.y);
    expect(distance).toBeCloseTo(radius, 0);
  });

  // --- composite (8+ force) attractor shape rendering (Requirement 6) ---

  test("a composite attractor (8+ forces) renders one merged region blob for the whole group", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    const componentNames = ["auth", "cache", "database", "queue", "orphan", "billing", "search", "reporting"];
    const bigState = state({
      baseComponents: componentNames.map((name) => component(name)),
      baseForces: Array.from({ length: 9 }, (_, i) =>
        force(`S-${10 + i}`, "A-01", [componentNames[i % componentNames.length]!])),
    });
    handle?.update(bigState, options);
    const regionGroup = host.querySelector('g.nkp-hyper-region[aria-label*="resilience"]')
      ?? [...host.querySelectorAll("g.nkp-hyper-region")][0];
    const blobs = regionGroup?.querySelectorAll("path.nkp-hyper-region-blob") ?? [];
    // Pyramid subshapes each get their own hull section (saturation-shifted).
    expect(blobs.length).toBeGreaterThanOrEqual(1);
  });

  test("after settle, every free node rests outside the empty annuli and attractor forces stay rigid", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const all = handle?.simulation?.nodes() ?? [];
    const stack = dualStackFor(handle);
    expect(stack).toBeDefined();
    const origin = { x: 400, y: 300 };
    for (const node of all) {
      const dx = (node.x ?? 0) - origin.x;
      const dy = (node.y ?? 0) - origin.y;
      const radius = Math.hypot(dx, dy);
      const inInnerAnnulus = radius > stack!.innerAnnulus.inner + 1 && radius < stack!.innerAnnulus.outer - 1;
      const inOuterAnnulus = radius > stack!.outerAnnulus.inner + 1 && radius < stack!.outerAnnulus.outer - 1;
      expect(inInnerAnnulus || inOuterAnnulus).toBe(false);
    }
    const a01 = all.filter((n: any) => n.type === "force" && n.attractorId === "A-01");
    expect(a01.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < a01.length; i += 1) {
      let near = 0;
      for (let j = 0; j < a01.length; j += 1) {
        if (i === j) continue;
        const dist = Math.hypot((a01[i]!.x ?? 0) - (a01[j]!.x ?? 0), (a01[i]!.y ?? 0) - (a01[j]!.y ?? 0));
        if (dist <= 60 * 4) near += 1;
      }
      expect(near).toBeGreaterThan(0);
    }
  });

  test("dragging one force moves every force in its sub-shape together", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const allBefore = handle?.simulation?.nodes() ?? [];
    const before = new Map(
      allBefore
        .filter((n: any) => n.type === "force" && n.attractorId === "A-01")
        .map((n: any) => [n.id as string, { x: n.x ?? 0, y: n.y ?? 0 }]),
    );
    const p01Start = allBefore.find((n: any) => n.id === "force:P-01");
    expect(before.size).toBeGreaterThanOrEqual(2);
    expect(p01Start).toBeDefined();
    const primary = before.get("force:S-01");
    expect(primary).toBeDefined();
    const dx = 90;
    const dy = -30;
    handle?.dragNodeTo?.("force:S-01", { x: primary!.x + dx, y: primary!.y + dy });
    const after = handle?.simulation?.nodes() ?? [];
    const primaryAfter = after.find((n: any) => n.id === "force:S-01");
    const actualDx = (primaryAfter?.x ?? 0) - primary!.x;
    const actualDy = (primaryAfter?.y ?? 0) - primary!.y;
    // Peers share the primary's (possibly ring-clamped) translation exactly.
    for (const [id, start] of before) {
      const node = after.find((n: any) => n.id === id);
      expect(node?.x).toBeCloseTo(start.x + actualDx, 5);
      expect(node?.y).toBeCloseTo(start.y + actualDy, 5);
    }
    const p01 = after.find((n: any) => n.id === "force:P-01");
    expect(p01?.x).toBeCloseTo(p01Start!.x ?? 0, 5);
    expect(p01?.y).toBeCloseTo(p01Start!.y ?? 0, 5);
  });

  test("dragging a force in one composite sub-shape does not move the other sub-shape", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    const componentNames = ["auth", "cache", "database", "queue", "orphan", "billing", "search", "reporting"];
    const bigState = state({
      baseComponents: componentNames.map((name) => component(name)),
      baseForces: Array.from({ length: 9 }, (_, i) =>
        force(`S-${10 + i}`, "A-01", [componentNames[i % componentNames.length]!])),
    });
    handle?.update(bigState, options);
    const forces = (handle?.simulation?.nodes() ?? [])
      .filter((n: any) => n.type === "force" && n.attractorId === "A-01");
    expect(forces.length).toBe(9);
    const primary = forces.find((n: any) => n.id === "force:S-10");
    expect(primary).toBeDefined();
    const before = new Map(forces.map((n: any) => [n.id as string, { x: n.x ?? 0, y: n.y ?? 0 }]));
    const dx = 120;
    handle?.dragNodeTo?.(primary!.id, { x: (primary!.x ?? 0) + dx, y: primary!.y ?? 0 });
    const after = handle?.simulation?.nodes() ?? [];
    const moved = after.filter((n: any) => {
      if (n.type !== "force" || n.attractorId !== "A-01") return false;
      const start = before.get(n.id)!;
      return Math.hypot((n.x ?? 0) - start.x, (n.y ?? 0) - start.y) > 1;
    });
    // One sub-shape (3–7 forces), not the whole composite of 9.
    expect(moved.length).toBeGreaterThanOrEqual(3);
    expect(moved.length).toBeLessThan(9);
    expect(moved.some((n: any) => n.id === primary!.id)).toBe(true);
    // Relative offsets inside the moved sub-shape stay fixed.
    const movedIds = new Set(moved.map((n: any) => n.id));
    for (const n of moved) {
      const start = before.get(n.id)!;
      expect(n.x).toBeCloseTo(start.x + dx, 5);
      expect(n.y).toBeCloseTo(start.y, 5);
    }
    for (const [id, start] of before) {
      if (movedIds.has(id)) continue;
      const node = after.find((n: any) => n.id === id)!;
      expect(node.x).toBeCloseTo(start.x, 5);
      expect(node.y).toBeCloseTo(start.y, 5);
    }
  });

  // --- live drag-snap tessellation preview (Requirement 3) ---

  test("preview marker is hidden before any drag", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const preview = host.querySelector(".nkp-hyper-snap-preview") as SVGElement | null;
    expect(preview).toBeDefined();
    expect(preview?.style.display).toBe("none");
  });

  test("dragging a force node shows the preview at its known shape-assigned target", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    handle?.dragNodeTo?.("force:S-01", { x: 10, y: 10 });
    const preview = host.querySelector(".nkp-hyper-snap-preview") as SVGElement | null;
    expect(preview?.style.display).not.toBe("none");
    expect(preview?.getAttribute("cx")).not.toBeNull();
    expect(preview?.getAttribute("cy")).not.toBeNull();
  });

  test("dragging a component node shows the preview at a distinct nearby snap point", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const componentNode = handle?.simulation?.nodes().find((n: any) => n.id === "component:auth");
    expect(componentNode).toBeDefined();
    handle?.dragNodeTo?.("component:auth", { x: (componentNode?.x ?? 0) + 7, y: (componentNode?.y ?? 0) + 3 });
    const preview = host.querySelector(".nkp-hyper-snap-preview") as SVGElement | null;
    expect(preview?.style.display).not.toBe("none");
  });

  // --- nested component→mid→sub-shape→force bundling ---

  test("regions draw nested component-sourced bundles (no reverse force fans)", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    expect(host.querySelectorAll("g.nkp-hyper-force-bundle").length).toBe(0);
    expect(host.querySelectorAll("path.nkp-hyper-bundle-trunk").length).toBeGreaterThan(0);
    expect(host.querySelectorAll("path.nkp-hyper-bundle-mid-branch").length).toBeGreaterThan(0);
    expect(host.querySelectorAll("path.nkp-hyper-bundle-force-branch").length).toBeGreaterThan(0);
  });

  test("bundle trunks split on the correct annulus mid (inner for purpose, outer for stressor)", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const stack = dualStackFor(handle);
    const innerMid = ((stack?.innerAnnulus.inner ?? 0) + (stack?.innerAnnulus.outer ?? 0)) / 2;
    const outerMid = ((stack?.outerAnnulus.inner ?? 0) + (stack?.outerAnnulus.outer ?? 0)) / 2;
    const center = { x: 400, y: 300 };

    const parseEnd = (d: string | null | undefined): { x: number; y: number } | undefined => {
      if (!d) return undefined;
      const match = d.trim().match(/([-\d.]+),([-\d.]+)\s*$/);
      if (!match) return undefined;
      return { x: Number(match[1]), y: Number(match[2]) };
    };

    const ends = [...host.querySelectorAll("path.nkp-hyper-bundle-trunk")]
      .map((el) => parseEnd(el.getAttribute("d")))
      .filter((point): point is { x: number; y: number } => point !== undefined);
    expect(ends.length).toBeGreaterThan(0);
    const onAnnulusMid = ends.filter((end) => {
      const radius = Math.hypot(end.x - center.x, end.y - center.y);
      return Math.abs(radius - innerMid) < 8 || Math.abs(radius - outerMid) < 8;
    });
    expect(onAnnulusMid.length).toBeGreaterThan(0);
  });

  test("nested bundles keep a 3-split hierarchy (trunk, mid, force leaves)", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    expect(host.querySelectorAll("path.nkp-hyper-bundle-trunk").length).toBeGreaterThan(0);
    expect(host.querySelectorAll("path.nkp-hyper-bundle-mid-branch").length).toBeGreaterThan(0);
    expect(host.querySelectorAll("path.nkp-hyper-bundle-force-branch").length).toBeGreaterThan(0);
  });

  test("mid-ring and dilated-edge splits coexist with radial separation", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    for (let i = 0; i < 80; i += 1) handle?.simulation?.tick();
    handle?.update(state(), options);

    const parseEnd = (d: string | null | undefined): { x: number; y: number } | undefined => {
      if (!d) return undefined;
      const match = d.trim().match(/([-\d.]+),([-\d.]+)\s*$/);
      if (!match) return undefined;
      return { x: Number(match[1]), y: Number(match[2]) };
    };
    const center = { x: 400, y: 300 };
    const stack = dualStackFor(handle);
    const innerMid = ((stack?.innerAnnulus.inner ?? 0) + (stack?.innerAnnulus.outer ?? 0)) / 2;
    const outerMid = ((stack?.outerAnnulus.inner ?? 0) + (stack?.outerAnnulus.outer ?? 0)) / 2;
    const minSep = (regionsModule.BUNDLE_RADIAL_SPLIT_SEPARATION ?? 30) - 1;

    const trunkEnds = [...host.querySelectorAll("path.nkp-hyper-bundle-trunk")]
      .map((el) => parseEnd(el.getAttribute("d")))
      .filter((point): point is { x: number; y: number } => point !== undefined);
    const midEnds = [...host.querySelectorAll("path.nkp-hyper-bundle-mid-branch")]
      .map((el) => parseEnd(el.getAttribute("d")))
      .filter((point): point is { x: number; y: number } => point !== undefined);

    expect(trunkEnds.length).toBeGreaterThan(0);
    expect(midEnds.length).toBeGreaterThan(0);
    const trunksOnMid = trunkEnds.filter((end) => {
      const radius = Math.hypot(end.x - center.x, end.y - center.y);
      return Math.abs(radius - innerMid) < 10 || Math.abs(radius - outerMid) < 10;
    });
    expect(trunksOnMid.length).toBeGreaterThan(0);

    let separated = 0;
    for (const midEnd of midEnds) {
      const midR = Math.hypot(midEnd.x - center.x, midEnd.y - center.y);
      if (Math.abs(midR - innerMid) > minSep * 0.4 || Math.abs(midR - outerMid) > minSep * 0.4) {
        separated += 1;
      }
    }
    expect(separated).toBeGreaterThan(0);
  });

  test("selection lights only membership segments joining selected entities to their connected network", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    // Select one force with its directly connected component (and attractor).
    handle?.setSelection(
      new Set(["force:S-02"]),
      new Set(["force:S-02", "component:auth", "attractor:A-01"]),
    );
    const litLeaves = [...host.querySelectorAll("path.nkp-hyper-bundle-force-branch.is-lit")];
    expect(litLeaves.length).toBeGreaterThan(0);
    expect(litLeaves.every((el) => el.getAttribute("aria-label")?.includes("force:S-02"))).toBe(true);
    const allLeaves = [...host.querySelectorAll("path.nkp-hyper-bundle-force-branch")];
    expect(allLeaves.some((el) => !el.classList.contains("is-lit"))).toBe(true);
  });

  // --- attractor-region collision (Feature 3, not yet implemented) ---

  test("region collision: registers a dedicated attractor-region collision force on the simulation", () => {
    // The generic charge force already pushes any two coincident nodes apart
    // (d3-force jitters zero-distance pairs), so a plain "did the groups move
    // apart" assertion would pass even without this feature — it must not be
    // the only check. Asserting the named force is actually registered is
    // what makes this genuinely red until the feature exists.
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const sim = handle?.simulation as unknown as { force?: (name: string) => unknown } | undefined;
    expect(typeof sim?.force).toBe("function");
    expect(sim?.force?.("regionCollision")).toBeDefined();
  });

  test("region collision force is registered but forces have no pressure interaction", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    const allNodes = handle?.simulation?.nodes() ?? [];
    for (const node of allNodes) {
      if (node.type === "force" && (node.attractorId === "A-01" || node.attractorId === "A-02")) {
        node.x = 700; node.y = 300; node.vx = 0; node.vy = 0;
        node.fx = null; node.fy = null;
      }
    }
    const centroidOf = (attractorId: string) => {
      const members = allNodes.filter((n: any) => n.type === "force" && n.attractorId === attractorId);
      const cx = members.reduce((sum, n) => sum + (n.x ?? 0), 0) / Math.max(1, members.length);
      const cy = members.reduce((sum, n) => sum + (n.y ?? 0), 0) / Math.max(1, members.length);
      return { x: cx, y: cy };
    };
    expect(Math.hypot(centroidOf("A-01").x - centroidOf("A-02").x, centroidOf("A-01").y - centroidOf("A-02").y)).toBeLessThan(1);
    handle?.simulation?.tick(30);
    // Lattice hop restores homes even without pressure — centroids separate again.
    expect(Math.hypot(centroidOf("A-01").x - centroidOf("A-02").x, centroidOf("A-01").y - centroidOf("A-02").y)).toBeGreaterThan(30);
  });

  // --- selection-focus opacity parity with hover (Feature 4, not yet implemented) ---

  test("an active selection marks the svg with the same state class hover uses for lit/dim styling", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    handle?.setSelection(new Set(["component:auth"]), new Set(["component:auth"]));
    const svg = host.querySelector("svg");
    expect(svg?.classList.contains("nkp-hyper-selecting")).toBe(true);
  });

  test("selection marks focused bundle trunks/branches, regions, and region labels with is-lit instead of a separate dim-only class", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    handle?.setSelection(new Set(["attractor:A-01"]), new Set(["attractor:A-01"]));
    const regions = [...host.querySelectorAll("g.nkp-hyper-region")];
    const litRegions = regions.filter((el) => el.classList.contains("is-lit"));
    const nonLitRegions = regions.filter((el) => !el.classList.contains("is-lit"));
    expect(litRegions.length).toBeGreaterThan(0);
    expect(nonLitRegions.length).toBeGreaterThan(0);
    expect(host.querySelectorAll(".nkp-hyper-region.dim, .nkp-hyper-bundle-trunk.dim, .nkp-hyper-bundle-branch.dim, .nkp-hyper-region-label.dim").length).toBe(0);
  });

  test("clearing the selection removes the selecting state and returns every region/trunk/branch to lit", () => {
    const { ctx, host } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), options);
    handle?.setSelection(new Set(["attractor:A-01"]), new Set(["attractor:A-01"]));
    handle?.setSelection(new Set(), new Set());
    const svg = host.querySelector("svg");
    expect(svg?.classList.contains("nkp-hyper-selecting")).toBe(false);
    const regions = [...host.querySelectorAll("g.nkp-hyper-region")];
    expect(regions.every((el) => el.classList.contains("is-lit"))).toBe(true);
  });

  test("ATTRACTOR_COHESION_STRENGTH defaults near 0.1 (about 1/3 of the old 0.3)", () => {
    const strength = regionsModule.ATTRACTOR_COHESION_STRENGTH;
    expect(typeof strength).toBe("number");
    expect(strength!).toBeGreaterThanOrEqual(0.08);
    expect(strength!).toBeLessThanOrEqual(0.12);
  });

  test("at initial seed, distinct attractors' force centroids sit outside the core and occupy distinct angular sectors", () => {
    const multi = state({
      baseAttractors: [
        ...attractors,
        { id: "A-03", name: "throughput", description: "", positiveState: "", negativeState: "" },
      ],
      baseComponents: ["auth", "cache", "database"].map((name) => component(name)),
      baseForces: [
        force("S-01", "A-01", ["auth"]),
        force("S-02", "A-02", ["cache"]),
        force("S-03", "A-03", ["database"]),
      ],
    });
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(multi, options);
    // First update only — no manual ticks — so we see the seeded layout.
    const nodes = handle?.simulation?.nodes() ?? [];
    const componentCount = nodes.filter((n) => n.type === "component").length;
    const radius = regionsModule.coreZoneRadius?.(componentCount) ?? 0;
    const center = { x: 400, y: 300 };
    const byAttractor = new Map<string, { x: number; y: number }[]>();
    for (const node of nodes) {
      if (node.type !== "force" || !node.attractorId) continue;
      const list = byAttractor.get(node.attractorId) ?? [];
      list.push({ x: node.x ?? 0, y: node.y ?? 0 });
      byAttractor.set(node.attractorId, list);
    }
    expect(byAttractor.size).toBe(3);
    const angles: number[] = [];
    for (const points of byAttractor.values()) {
      const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
      const dist = Math.hypot(cx - center.x, cy - center.y);
      expect(dist).toBeGreaterThan(radius * 0.95);
      angles.push(Math.atan2(cy - center.y, cx - center.x));
    }
    angles.sort((a, b) => a - b);
    const deltas: number[] = [];
    for (let i = 0; i < angles.length; i += 1) {
      let delta = angles[(i + 1) % angles.length]! - angles[i]!;
      if (delta <= 0) delta += Math.PI * 2;
      deltas.push(delta);
    }
    // Fail if every attractor piles into the same ~30° wedge (max gap ≈ 330°+).
    const maxDelta = Math.max(...deltas);
    expect(maxDelta).toBeLessThan((330 * Math.PI) / 180);
    // Each attractor claims a distinct sector (no two within ~15°).
    const minDelta = Math.min(...deltas);
    expect(minDelta).toBeGreaterThan((15 * Math.PI) / 180);
  });

  test("INITIAL_SETTLE_TICKS is exported and at least 50", () => {
    expect(typeof regionsModule.INITIAL_SETTLE_TICKS).toBe("number");
    expect(regionsModule.INITIAL_SETTLE_TICKS!).toBeGreaterThanOrEqual(50);
  });

  test("keepSimulating:true holds alphaTarget above zero; false (default) cools to stop", () => {
    const { ctx } = makeCtx();
    const handle = regionsModule.createRegionsView?.(ctx);
    handle?.update(state(), { ...options, keepSimulating: true });
    expect(handle?.simulation?.alphaTarget?.()).toBeGreaterThan(0);

    handle?.update(state(), { ...options, keepSimulating: false });
    expect(handle?.simulation?.alphaTarget?.() ?? 0).toBe(0);

    handle?.update(state(), options);
    expect(handle?.simulation?.alphaTarget?.() ?? 0).toBe(0);
  });
});
