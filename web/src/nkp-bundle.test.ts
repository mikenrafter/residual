import { beforeAll, describe, expect, test } from "bun:test";
import * as d3 from "d3";
import type { PendingState, SnapshotAttractor, SnapshotComponent, SnapshotForce } from "./model";
import type { NkpGraphEdge } from "./nkp-graph";
import {
  UNASSIGNED_GROUP_ID,
  assignGroups,
  buildNkpBundleModel,
  bundleEdgeStyle,
  bundleHierarchyData,
  dominantAttractors,
  groupSimilarity,
  layoutGroupLabels,
  leafNeighbourSummary,
  orderGroups,
  radialLabelTransform,
} from "./nkp-bundle";

/**
 * createBundleView does not exist yet (Phase 3). It is read off the module's
 * namespace object via a dynamic import instead of a static named import:
 * Bun's static `import { name } from "./real-module"` throws a SyntaxError
 * (not `undefined`) when `name` isn't actually exported yet, which would
 * abort this whole file's test discovery — verified empirically while
 * writing this suite. See nkp-graph.test.ts for the same guarded pattern
 * applied to a module that doesn't exist at all.
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
}
type BundleViewModule = { createBundleView?: (ctx: ViewCtx) => ViewHandle };

let bundleViewModule: BundleViewModule = {};

beforeAll(async () => {
  bundleViewModule = (await import("./nkp-bundle").catch(() => ({}))) as BundleViewModule;
});

const attractor = (id: string, name: string): SnapshotAttractor => ({
  id,
  name,
  description: `${name} description`,
  positiveState: "good",
  negativeState: "bad",
});

const component = (name: string, status: "actual" | "proposed" = "actual"): SnapshotComponent => ({
  name,
  description: `${name} description`,
  status,
  architectureSet: "runtime",
});

let forceSeq = 0;
const force = (attractorId: string, components: string[], shortname = `f-${++forceSeq}`): SnapshotForce => ({
  id: `S-${shortname}`,
  kind: "stressor",
  shortname,
  description: shortname,
  attractorId,
  naiveChangeOrFeature: "naive",
  outcomes: "outcome",
  components,
});

function state(forces: SnapshotForce[], components: SnapshotComponent[], attractors: SnapshotAttractor[]): PendingState {
  return {
    baseAttractors: attractors,
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

const attractorEdge = (source: string, target: string, count: number): NkpGraphEdge => ({
  id: `${source}:${target}`,
  source,
  target,
  type: "attractor",
  count,
  stressors: [],
  tooltip: "",
  width: 1,
  lineStyle: "solid",
  focused: true,
  opacity: 1,
});

describe("dominantAttractors", () => {
  test("assigns each component to the attractor with the most shared forces", () => {
    const result = dominantAttractors([
      attractorEdge("attractor:A-01", "component:auth", 1),
      attractorEdge("attractor:A-02", "component:auth", 3),
      attractorEdge("attractor:A-01", "component:db", 2),
    ]);
    expect(result.get("component:auth")).toBe("attractor:A-02");
    expect(result.get("component:db")).toBe("attractor:A-01");
  });

  test("breaks ties deterministically by smallest attractor id regardless of edge order", () => {
    const edges = [attractorEdge("attractor:A-09", "component:x", 2), attractorEdge("attractor:A-03", "component:x", 2)];
    expect(dominantAttractors(edges).get("component:x")).toBe("attractor:A-03");
    expect(dominantAttractors([...edges].reverse()).get("component:x")).toBe("attractor:A-03");
  });
});

describe("assignGroups", () => {
  const edges = [
    attractorEdge("attractor:A-01", "component:a", 3),
    attractorEdge("attractor:A-01", "component:b", 2),
    attractorEdge("attractor:A-02", "component:c", 4),
    attractorEdge("attractor:A-01", "component:c", 1),
    attractorEdge("attractor:A-03", "component:d", 2),
  ];

  test("moves members of a too-small attractor to their best attractor that is big enough", () => {
    const groups = assignGroups(edges, 2);
    expect(groups.get("component:a")).toBe("attractor:A-01");
    expect(groups.get("component:b")).toBe("attractor:A-01");
    // c's own attractor (A-02) holds only c; its next-best is A-01.
    expect(groups.get("component:c")).toBe("attractor:A-01");
  });

  test("sends members with no big-enough alternative to the unassigned group", () => {
    expect(assignGroups(edges, 2).get("component:d")).toBe(UNASSIGNED_GROUP_ID);
  });

  test("keeps the dominant assignment when the minimum is 1 or no attractor qualifies", () => {
    expect(assignGroups(edges, 1).get("component:c")).toBe("attractor:A-02");
    expect(assignGroups(edges, 9).get("component:c")).toBe("attractor:A-02");
  });
});

describe("orderGroups", () => {
  test("places strongly coupled groups next to each other and unassigned last", () => {
    const groupOf = new Map([
      ["component:a", "A"],
      ["component:b", "B"],
      ["component:c", "C"],
      ["component:d", "D"],
    ]);
    const coupling = (source: string, target: string, count: number) => ({ source, target, count, type: "coupling" as const });
    const similarity = groupSimilarity(
      [
        coupling("component:a", "component:c", 5),
        coupling("component:b", "component:d", 4),
        coupling("component:c", "component:b", 1),
      ],
      groupOf,
    );
    const order = orderGroups(["A", "B", "C", "D", UNASSIGNED_GROUP_ID], similarity);
    expect(order[order.length - 1]).toBe(UNASSIGNED_GROUP_ID);
    const position = (id: string) => order.indexOf(id);
    expect(Math.abs(position("A") - position("C"))).toBe(1);
    expect(Math.abs(position("B") - position("D"))).toBe(1);
  });

  test("returns every group exactly once", () => {
    const order = orderGroups(["Z", "Y", "X"], new Map());
    expect([...order].sort()).toEqual(["X", "Y", "Z"]);
  });
});

describe("buildNkpBundleModel", () => {
  const attractors = [attractor("A-01", "resilience"), attractor("A-02", "adaptability")];
  const components = [component("auth"), component("cache", "proposed"), component("db"), component("orphan")];
  const forces = [
    force("A-01", ["auth", "cache"], "storm"),
    force("A-01", ["auth", "cache"], "outage"),
    force("A-02", ["cache", "db"], "drift"),
    force("A-02", ["db", "cache"], "migration"),
    force("A-02", ["db"], "schema"),
  ];

  test("groups components under their dominant attractor with attractor names", () => {
    const model = buildNkpBundleModel(state(forces, components, attractors), { minCouplingStrength: 1, hideFiltered: false, minGroupSize: 1 });
    const groupFor = (name: string) => model.groups.find((group) => group.leaves.some((leaf) => leaf.label === name));
    expect(groupFor("auth")?.label).toBe("resilience");
    expect(groupFor("db")?.label).toBe("adaptability");
    // cache: 2 forces from each attractor -> tie goes to A-01.
    expect(groupFor("cache")?.id).toBe("attractor:A-01");
  });

  test("folds single-component attractors into a neighbour by default and keeps the real attractor for the tooltip", () => {
    const model = buildNkpBundleModel(state(forces, components, attractors), { minCouplingStrength: 1, hideFiltered: false });
    const db = model.groups.flatMap((group) => group.leaves).find((leaf) => leaf.label === "db");
    // db's own attractor (adaptability) would hold only db, and db shares no force with resilience.
    expect(db?.groupId).toBe(UNASSIGNED_GROUP_ID);
    expect(db?.dominantLabel).toBe("adaptability");
    expect(model.groups.find((group) => group.id === UNASSIGNED_GROUP_ID)?.label).toBe("other");
  });

  test("colours each group with the shared attractor palette", () => {
    const model = buildNkpBundleModel(state(forces, components, attractors), { minCouplingStrength: 1, hideFiltered: false });
    const resilience = model.groups.find((group) => group.id === "attractor:A-01");
    expect(resilience?.color).toMatch(/^hsl\(/);
  });

  test("exposes only coupling edges, with counts and fusion flags from the graph model", () => {
    const model = buildNkpBundleModel(state(forces, components, attractors), { minCouplingStrength: 1, hideFiltered: false });
    expect(model.edges.map((edge) => [edge.source, edge.target, edge.count])).toEqual(
      expect.arrayContaining([
        ["component:auth", "component:cache", 2],
        ["component:cache", "component:db", 2],
      ]),
    );
    expect(model.edges).toHaveLength(2);
    expect(model.maxCount).toBe(2);
    expect(model.edges.every((edge) => edge.fusion === false)).toBe(true);
  });

  test("respects min coupling strength and hide-filtered like the graph", () => {
    const pending = state(forces, components, attractors);
    const strict = buildNkpBundleModel(pending, { minCouplingStrength: 3, hideFiltered: true });
    expect(strict.edges).toHaveLength(0);

    const focused = buildNkpBundleModel(pending, {
      minCouplingStrength: 1,
      hideFiltered: true,
      visibleForceIds: new Set(["S-storm"]),
    });
    const labels = focused.groups.flatMap((group) => group.leaves.map((leaf) => leaf.label)).sort();
    expect(labels).toEqual(["auth", "cache"]);
  });

  test("keeps attractor assignment stable while filters change", () => {
    const pending = state(forces, components, attractors);
    const all = buildNkpBundleModel(pending, { minCouplingStrength: 1, hideFiltered: false });
    const narrowed = buildNkpBundleModel(pending, {
      minCouplingStrength: 1,
      hideFiltered: true,
      visibleForceIds: new Set(["S-drift"]),
    });
    const groupOf = (model: typeof all, name: string) =>
      model.groups.find((group) => group.leaves.some((leaf) => leaf.label === name))?.id;
    expect(groupOf(narrowed, "db")).toBe(groupOf(all, "db"));
    expect(groupOf(narrowed, "cache")).toBe(groupOf(all, "cache"));
  });

  test("marks fission candidates using the graph's fission threshold", () => {
    const model = buildNkpBundleModel(state(forces, components, attractors), {
      minCouplingStrength: 1,
      hideFiltered: false,
      fissionThreshold: 3,
    });
    const leaves = model.groups.flatMap((group) => group.leaves);
    expect(leaves.find((leaf) => leaf.label === "cache")?.fissionCandidate).toBe(true);
    expect(leaves.find((leaf) => leaf.label === "auth")?.fissionCandidate).toBe(false);
  });

  test("flags coupling edges whose pair is also a fusion candidate", () => {
    const fused = [force("A-01", ["auth", "cache"], "one"), force("A-01", ["auth", "cache"], "two")];
    const model = buildNkpBundleModel(state(fused, [component("auth"), component("cache")], attractors), {
      minCouplingStrength: 1,
      hideFiltered: false,
    });
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0]?.fusion).toBe(true);
  });

  test("keeps fusion pairs as edges when top-N cut their coupling edge", () => {
    // x and y have identical vectors {p1, p2}: coupling 2 and a fusion pair.
    // cache-db couple 3 times, so top-1 keeps only that coupling tier; the
    // x-y fusion edge is exempt from top-N and must still be drawn.
    const mixed = [
      force("A-01", ["x", "y"], "p1"),
      force("A-01", ["x", "y"], "p2"),
      force("A-02", ["db", "cache"], "q1"),
      force("A-02", ["db", "cache"], "q2"),
      force("A-02", ["db", "cache"], "q3"),
      force("A-02", ["db"], "q4"),
    ];
    const model = buildNkpBundleModel(
      state(mixed, [component("x"), component("y"), component("cache"), component("db")], attractors),
      { minCouplingStrength: 1, hideFiltered: false, topNCouplings: 1 },
    );
    const summary = model.edges.map((edge) => [edge.source, edge.target, edge.count, edge.fusion]);
    expect(summary).toContainEqual(["component:cache", "component:db", 3, false]);
    expect(summary).toContainEqual(["component:x", "component:y", 2, true]);
    expect(model.edges).toHaveLength(2);
  });

  test("hierarchy data nests root -> group -> leaf in placement order", () => {
    const model = buildNkpBundleModel(state(forces, components, attractors), { minCouplingStrength: 1, hideFiltered: false });
    const data = bundleHierarchyData(model);
    expect(data.id).toBe("root");
    expect(data.children?.map((child) => child.id)).toEqual(model.groups.map((group) => group.id));
    expect(data.children?.[0]?.children?.every((child) => child.leaf !== undefined)).toBe(true);
  });

  test("neighbour summary lists shared forces per coupled component, strongest first", () => {
    const model = buildNkpBundleModel(state(forces, components, attractors), { minCouplingStrength: 1, hideFiltered: false });
    const summary = leafNeighbourSummary(model, "component:cache");
    expect(summary.map((item) => item.label).sort()).toEqual(["auth", "db"]);
    expect(summary.find((item) => item.label === "auth")?.stressors.sort()).toEqual(["outage", "storm"]);
  });
});

describe("rendering helpers", () => {
  test("radial labels flip on the left half so they read left-to-right", () => {
    expect(radialLabelTransform(45, 100)).toEqual({ transform: "rotate(-45) translate(100,0)", anchor: "start" });
    expect(radialLabelTransform(270, 100)).toEqual({ transform: "rotate(180) translate(100,0) rotate(180)", anchor: "end" });
  });

  test("group labels spill into free neighbouring space but never overlap each other", () => {
    // Two short bands, far apart: each gets its full label.
    const roomy = layoutGroupLabels(
      [{ start: 0, end: 2, label: "Agent Fluency" }, { start: 180, end: 182, label: "Naive Change" }],
      300,
      6,
    );
    expect(roomy[0]?.maxChars).toBeGreaterThanOrEqual("Agent Fluency".length);
    expect(roomy[1]?.maxChars).toBeGreaterThanOrEqual("Naive Change".length);

    // Adjacent short bands with long names: spans meet but do not cross.
    const tight = layoutGroupLabels(
      [{ start: 10, end: 12, label: "a very long attractor name" }, { start: 14, end: 16, label: "another long name here" }],
      300,
      6,
    );
    expect(tight[0]!.end).toBeLessThanOrEqual(tight[1]!.start + 1e-9);
    expect(tight[0]!.end).toBeGreaterThanOrEqual(12);
    expect(tight[1]!.start).toBeLessThanOrEqual(14);
  });

  test("group label overlap check wraps around 360 degrees", () => {
    const spans = layoutGroupLabels(
      [{ start: 1, end: 3, label: "first long attractor" }, { start: 355, end: 358, label: "last long attractor" }],
      300,
      6,
    );
    expect(spans[1]!.end - 360).toBeLessThanOrEqual(spans[0]!.start + 1e-9);
  });

  test("edge style grows with count and fades when unfocused", () => {
    const weak = bundleEdgeStyle(1, 5, true);
    const strong = bundleEdgeStyle(5, 5, true);
    expect(strong.width).toBeGreaterThan(weak.width);
    expect(strong.opacity).toBeGreaterThan(weak.opacity);
    expect(bundleEdgeStyle(5, 5, false).opacity).toBeLessThan(strong.opacity);
  });
});

describe("createBundleView (persistent view handle, Phase 3)", () => {
  // auth<->cache and auth<->db each get 2 shared forces so both coupling
  // edges clear the default minCouplingStrength (2); all three components
  // dominate the same attractor so they land in one bundle group.
  const a1 = attractor("A-01", "resilience");
  const authCache1 = force("A-01", ["auth", "cache"], "ac1");
  const authCache2 = force("A-01", ["auth", "cache"], "ac2");
  const authDb1 = force("A-01", ["auth", "db"], "ad1");
  const authDb2 = force("A-01", ["auth", "db"], "ad2");
  const fixtureState = state(
    [authCache1, authCache2, authDb1, authDb2],
    [component("auth"), component("cache"), component("db")],
    [a1],
  );

  function makeCtx(): { ctx: ViewCtx; host: HTMLElement; toggled: string[]; clearCount: () => number } {
    document.body.innerHTML = `<div data-host></div>`;
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

  const leafFor = (host: HTMLElement, name: string): SVGGElement | undefined =>
    [...host.querySelectorAll<SVGGElement>(".nkp-bundle-leaf")].find((g) => g.textContent?.includes(name));

  test("exists and returns the {update, setSelection, resetView, destroy} handle shape", () => {
    const { ctx } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    expect(handle).toBeDefined();
    expect(typeof handle?.update).toBe("function");
    expect(typeof handle?.setSelection).toBe("function");
    expect(typeof handle?.resetView).toBe("function");
    expect(typeof handle?.destroy).toBe("function");
  });

  test("update draws one <svg> into the host", () => {
    const { ctx, host } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    handle?.update(fixtureState, {});
    expect(host.querySelectorAll("svg")).toHaveLength(1);
  });

  test("a narrower filter keeps the same <svg>, keeps a keyed element for a surviving entity, and removes filtered ones", () => {
    const { ctx, host } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    handle?.update(fixtureState, { hideFiltered: true });
    const svgBefore = host.querySelector("svg");
    const authBefore = leafFor(host, "auth");
    expect(svgBefore).not.toBeNull();
    expect(authBefore).toBeDefined();
    expect(leafFor(host, "db")).toBeDefined();

    // Narrow to only the forces coupling auth<->cache: db loses its only
    // edge and should be dropped, auth/cache should survive with the same
    // elements (keyed join), and the svg itself should not be recreated.
    handle?.update(fixtureState, {
      hideFiltered: true,
      visibleForceIds: new Set([authCache1.id, authCache2.id]),
    });
    expect(host.querySelector("svg")).toBe(svgBefore);
    expect(leafFor(host, "auth")).toBe(authBefore);
    expect(leafFor(host, "db")).toBeUndefined();
  });

  test("clicking a component leaf calls ctx.onToggle with its component key", () => {
    const { ctx, host, toggled } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    handle?.update(fixtureState, {});
    leafFor(host, "auth")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggled).toEqual(["component:auth"]);
  });

  test("clicking an attractor band calls ctx.onToggle with its attractor key", () => {
    const { ctx, host, toggled } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    handle?.update(fixtureState, {});
    const band = host.querySelector<SVGGElement>(".nkp-bundle-group");
    band?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggled).toEqual(["attractor:A-01"]);
  });

  test("clicking an edge toggles every force it represents", () => {
    const { ctx, host, toggled } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    handle?.update(fixtureState, {});
    const edgePath = host.querySelector<SVGPathElement>(".nkp-bundle-edges path");
    edgePath?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggled).toHaveLength(2);
    expect(toggled.every((key) => key.startsWith("force:"))).toBe(true);
    const expectedPairs = [
      [`force:${authCache1.id}`, `force:${authCache2.id}`].sort(),
      [`force:${authDb1.id}`, `force:${authDb2.id}`].sort(),
    ];
    expect(expectedPairs).toContainEqual([...toggled].sort());
  });

  test("double-clicking the background calls ctx.onClear", () => {
    const { ctx, host, clearCount } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    handle?.update(fixtureState, {});
    host.querySelector("svg")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(clearCount()).toBeGreaterThan(0);
  });

  test("setSelection marks selected/connected leaves and leaves everyone else unmarked", () => {
    const { ctx, host } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    handle?.update(fixtureState, {});
    handle?.setSelection(new Set(["component:auth"]), new Set(["component:auth", "component:cache"]));
    const auth = leafFor(host, "auth");
    const cache = leafFor(host, "cache");
    const db = leafFor(host, "db");
    expect(auth?.classList.contains("selected") || auth?.closest(".selected") !== null).toBe(true);
    expect(cache?.classList.contains("connected") || cache?.closest(".connected") !== null).toBe(true);
    expect(db?.classList.contains("selected") || db?.closest(".selected") !== null).toBe(false);
    expect(db?.classList.contains("connected") || db?.closest(".connected") !== null).toBe(false);
  });

  test("setSelection dims a bundle edge whose components are both outside selection/connection", () => {
    const { ctx, host } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    // Extend the base fixture with a fourth component ("queue") coupled only
    // to "db", so a db<->queue edge exists that never touches the auth/cache
    // pair used for selection below.
    const dbQueue1 = force("A-01", ["db", "queue"], "dq1");
    const dbQueue2 = force("A-01", ["db", "queue"], "dq2");
    const dimFixture = state(
      [authCache1, authCache2, authDb1, authDb2, dbQueue1, dbQueue2],
      [component("auth"), component("cache"), component("db"), component("queue")],
      [a1],
    );
    handle?.update(dimFixture, {});
    handle?.setSelection(new Set(["component:auth"]), new Set(["component:auth", "component:cache"]));

    const edgeDatum = (el: SVGPathElement): { edge: { source: string; target: string } } =>
      d3.select(el).datum() as { edge: { source: string; target: string } };
    const edges = [...host.querySelectorAll<SVGPathElement>("path.nkp-bundle-edge")];
    const touches = (el: SVGPathElement, a: string, b: string): boolean => {
      const { edge } = edgeDatum(el);
      return (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a);
    };

    // db<->queue: neither endpoint is selected ("auth") or connected ("cache").
    const dbQueueEdge = edges.find((el) => touches(el, "component:db", "component:queue"));
    expect(dbQueueEdge).toBeDefined();
    expect(dbQueueEdge?.classList.contains("dim")).toBe(true);

    // auth<->cache: both endpoints are selected/connected.
    const authCacheEdge = edges.find((el) => touches(el, "component:auth", "component:cache"));
    expect(authCacheEdge).toBeDefined();
    expect(authCacheEdge?.classList.contains("dim")).toBe(false);

    // auth<->db: only one endpoint is in the highlight set — must dim (not
    // light +1 degree of coupling past the partial-transitive contract).
    const authDbEdge = edges.find((el) => touches(el, "component:auth", "component:db"));
    expect(authDbEdge).toBeDefined();
    expect(authDbEdge?.classList.contains("dim")).toBe(true);
  });

  test("setSelection with a force and its partial-transitive connected set lights peer leaves and the coupling edge", () => {
    // When landscape passes highlightConnectedKeys for a selected force, the
    // force's own components land in `connected` and the edge between them
    // must get positive lit/connected treatment — not merely escape dimming
    // because one leaf happened to be selected.
    const { ctx, host } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    handle?.update(fixtureState, {});
    const forceKey = `force:${authCache1.id}`;
    handle?.setSelection(
      new Set([forceKey]),
      new Set([forceKey, "attractor:A-01", "component:auth", "component:cache"]),
    );

    const auth = leafFor(host, "auth");
    const cache = leafFor(host, "cache");
    const db = leafFor(host, "db");
    expect(auth?.classList.contains("connected") || auth?.closest(".connected") !== null).toBe(true);
    expect(cache?.classList.contains("connected") || cache?.closest(".connected") !== null).toBe(true);
    expect(auth?.classList.contains("dim")).toBe(false);
    expect(cache?.classList.contains("dim")).toBe(false);
    expect(db?.classList.contains("dim")).toBe(true);

    const edgeDatum = (el: SVGPathElement): { edge: { source: string; target: string } } =>
      d3.select(el).datum() as { edge: { source: string; target: string } };
    const edges = [...host.querySelectorAll<SVGPathElement>("path.nkp-bundle-edge")];
    const authCacheEdge = edges.find((el) => {
      const { edge } = edgeDatum(el);
      return (edge.source === "component:auth" && edge.target === "component:cache")
        || (edge.source === "component:cache" && edge.target === "component:auth");
    });
    expect(authCacheEdge).toBeDefined();
    expect(authCacheEdge?.classList.contains("dim")).toBe(false);
    // Positive connected/lit marking on the coupling itself (regions uses is-lit;
    // bundle should mark the edge connected or is-lit so focus is visible).
    expect(
      authCacheEdge?.classList.contains("connected") || authCacheEdge?.classList.contains("is-lit"),
    ).toBe(true);
  });

  test("focus leaves labels persistently visible only for selected and connected entities", () => {
    const { ctx, host } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    handle?.update(fixtureState, {});
    handle?.setSelection(new Set(["component:auth"]), new Set(["component:auth", "component:cache", "attractor:A-01"]));
    const label = (name: string) => [...host.querySelectorAll<SVGTextElement>(".nkp-bundle-label")]
      .find((item) => item.textContent?.includes(name));
    expect(label("auth")?.getAttribute("opacity")).not.toBe("0");
    expect(label("cache")?.getAttribute("opacity")).not.toBe("0");
    expect(label("db")?.getAttribute("opacity")).toBe("0");
    label("cache")?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(label("cache")?.getAttribute("opacity")).not.toBe("0");
  });

  test("uses accessible labels instead of native SVG title tooltips", () => {
    const { ctx, host } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    handle?.update(fixtureState, {});
    expect(host.querySelector("svg title")).toBeNull();
    expect([...host.querySelectorAll<SVGElement>(".nkp-bundle-leaf, .nkp-bundle-group, .nkp-bundle-edge")]
      .filter((item) => item.tagName.toLowerCase() !== "text")
      .every((item) => Boolean(item.getAttribute("aria-label")))).toBe(true);
  });

  test("renders actual components as circles and proposed components as squares", () => {
    const { ctx, host } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    const pending = state(
      [authCache1, authCache2],
      [component("auth", "actual"), component("cache", "proposed")],
      [a1],
    );
    handle?.update(pending, {});
    expect(host.querySelector('[data-component-id="component:auth"] [data-component-status-shape="actual"]')?.tagName.toLowerCase()).toBe("circle");
    expect(host.querySelector('[data-component-id="component:cache"] [data-component-status-shape="proposed"]')?.tagName.toLowerCase()).toBe("rect");
  });

  test("all text lives in a last-child g.landscape-labels group", () => {
    const { ctx, host } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    handle?.update(fixtureState, {});
    const svg = host.querySelector("svg");
    const labelGroup = svg?.querySelector("g.landscape-labels");
    expect(labelGroup).not.toBeNull();
    expect(svg?.lastElementChild).toBe(labelGroup ?? null);
    const allText = svg?.querySelectorAll("text") ?? [];
    const labelText = labelGroup?.querySelectorAll("text") ?? [];
    expect(allText.length).toBeGreaterThan(0);
    expect(allText.length).toBe(labelText.length);
  });

  test("destroy removes the drawing from the host", () => {
    const { ctx, host } = makeCtx();
    const handle = bundleViewModule.createBundleView?.(ctx);
    handle?.update(fixtureState, {});
    handle?.destroy();
    expect(host.querySelector("svg")).toBeNull();
  });
});
