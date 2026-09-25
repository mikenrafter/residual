import { beforeAll, describe, expect, test } from "bun:test";
import type { PendingState, SnapshotAttractor, SnapshotComponent, SnapshotForce } from "./model";

/**
 * Contract tests for the cross-view selection model (landscape-selection.ts,
 * not yet written — Phase 2). The guarded dynamic import keeps this file
 * runnable before the module exists: failures point at the missing exports
 * instead of aborting test discovery with a module-resolution error. See
 * nkp-graph.test.ts for the same pattern.
 */
export type EntityKey = `component:${string}` | `force:${string}` | `attractor:${string}`;

export interface EntityDetail {
  key: EntityKey;
  kind: "component" | "stressor" | "purpose" | "attractor";
  title: string;
  color?: string;
  fields: { label: string; value: string }[];
}

type SelectionModule = {
  entityDetail?: (state: PendingState, key: EntityKey) => EntityDetail | undefined;
  connectedKeys?: (state: PendingState, selected: Iterable<EntityKey>) => Set<EntityKey>;
  toggleSelection?: (current: ReadonlySet<EntityKey>, key: EntityKey) => Set<EntityKey>;
  HOVER_DIM_OPACITY?: number;
  SELECTION_DIM_OPACITY?: number;
};

let mod: SelectionModule = {};

beforeAll(async () => {
  mod = (await import("./landscape-selection").catch(() => ({}))) as SelectionModule;
});

const attractors: SnapshotAttractor[] = [
  { id: "A-01", name: "resilience", description: "service remains useful during failures", positiveState: "degrades gracefully", negativeState: "cascades" },
  { id: "A-02", name: "adaptability", description: "system absorbs new operating conditions", positiveState: "handles new load", negativeState: "stays brittle" },
];

const components: SnapshotComponent[] = [
  { name: "auth", description: "authenticates requests", status: "actual", architectureSet: "runtime" },
  { name: "cache", description: "caches session data", status: "proposed", architectureSet: "runtime" },
  { name: "db", description: "stores durable records", status: "actual", architectureSet: "data" },
];

const forces: SnapshotForce[] = [
  {
    id: "S-01", kind: "stressor", shortname: "sn1", description: "desc S-01", attractorId: "A-01",
    naiveChangeOrFeature: "naive1", outcomes: "outcome1", components: ["auth", "cache"],
  },
  {
    id: "S-02", kind: "stressor", shortname: "sn2", description: "desc S-02", attractorId: "A-01",
    naiveChangeOrFeature: "naive2", outcomes: "outcome2", components: ["auth"],
  },
  {
    id: "P-01", kind: "purpose", shortname: "pn1", description: "desc P-01", attractorId: "A-02",
    naiveChangeOrFeature: "feature1", outcomes: "outcome3", components: ["cache", "db"],
  },
];

function state(overrides: Partial<PendingState> = {}): PendingState {
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
    ...overrides,
  };
}

function field(detail: EntityDetail | undefined, label: string): string | undefined {
  return detail?.fields.find((entry) => entry.label === label)?.value;
}

describe("entityDetail", () => {
  test("component fields include name, description, status, architecture set and force count", () => {
    const detail = mod.entityDetail?.(state(), "component:auth");
    expect(detail).toBeDefined();
    expect(detail?.kind).toBe("component");
    expect(detail?.title).toContain("auth");
    expect(field(detail, "name")).toBe("auth");
    expect(field(detail, "description")).toBe("authenticates requests");
    expect(field(detail, "status")).toBe("actual");
    expect(field(detail, "architecture set")).toBe("runtime");
    expect(field(detail, "force count")).toBe("2"); // S-01, S-02
  });

  test("a second component's force count reflects only forces touching it", () => {
    const detail = mod.entityDetail?.(state(), "component:cache");
    expect(field(detail, "force count")).toBe("2"); // S-01, P-01
  });

  test("stressor fields include id, shortname, kind, description, attractor, components, naive change and outcomes", () => {
    const detail = mod.entityDetail?.(state(), "force:S-01");
    expect(detail).toBeDefined();
    expect(detail?.kind).toBe("stressor");
    expect(detail?.title).toContain("sn1");
    expect(field(detail, "id")).toBe("S-01");
    expect(field(detail, "shortname")).toBe("sn1");
    expect(field(detail, "kind")).toBe("stressor");
    expect(field(detail, "description")).toBe("desc S-01");
    expect(field(detail, "attractor")).toBe("resilience");
    expect(field(detail, "components")).toContain("auth");
    expect(field(detail, "components")).toContain("cache");
    expect(field(detail, "naive change")).toBe("naive1");
    expect(field(detail, "outcomes")).toBe("outcome1");
  });

  test("purpose fields use 'feature' instead of 'naive change'", () => {
    const detail = mod.entityDetail?.(state(), "force:P-01");
    expect(detail).toBeDefined();
    expect(detail?.kind).toBe("purpose");
    expect(field(detail, "feature")).toBe("feature1");
    expect(field(detail, "outcomes")).toBe("outcome3");
    expect(field(detail, "attractor")).toBe("adaptability");
  });

  test("attractor fields include name, description, positive, negative and force count", () => {
    const detail = mod.entityDetail?.(state(), "attractor:A-01");
    expect(detail).toBeDefined();
    expect(detail?.kind).toBe("attractor");
    expect(detail?.title).toContain("resilience");
    expect(field(detail, "name")).toBe("resilience");
    expect(field(detail, "description")).toBe("service remains useful during failures");
    expect(field(detail, "positive")).toBe("degrades gracefully");
    expect(field(detail, "negative")).toBe("cascades");
    expect(field(detail, "force count")).toBe("2"); // S-01, S-02
  });

  test("returns undefined for an entity that does not exist in the state", () => {
    expect(mod.entityDetail?.(state(), "component:no-such-component")).toBeUndefined();
    expect(mod.entityDetail?.(state(), "force:no-such-force")).toBeUndefined();
    expect(mod.entityDetail?.(state(), "attractor:no-such-attractor")).toBeUndefined();
  });
});

describe("connectedKeys", () => {
  test("a component connects to its forces, their attractors, and components sharing any of those forces", () => {
    const result = mod.connectedKeys?.(state(), ["component:auth"]);
    expect(result).toBeDefined();
    expect([...(result ?? [])].sort()).toEqual(
      ["attractor:A-01", "component:auth", "component:cache", "force:S-01", "force:S-02"].sort(),
    );
  });

  test("a force connects to its attractor and its components (not to sibling forces)", () => {
    const result = mod.connectedKeys?.(state(), ["force:S-01"]);
    expect([...(result ?? [])].sort()).toEqual(
      ["attractor:A-01", "component:auth", "component:cache", "force:S-01"].sort(),
    );
    expect(result?.has("force:S-02")).toBe(false);
  });

  test("an attractor connects to its forces and the components they touch", () => {
    const result = mod.connectedKeys?.(state(), ["attractor:A-02"]);
    expect([...(result ?? [])].sort()).toEqual(
      ["attractor:A-02", "component:cache", "component:db", "force:P-01"].sort(),
    );
  });

  test("multi-select unions each entity's connections", () => {
    const result = mod.connectedKeys?.(state(), ["component:auth", "component:db"]);
    expect([...(result ?? [])].sort()).toEqual(
      [
        "attractor:A-01", "attractor:A-02",
        "component:auth", "component:cache", "component:db",
        "force:S-01", "force:S-02", "force:P-01",
      ].sort(),
    );
  });

  test("selected entities are always part of their own connection set", () => {
    const result = mod.connectedKeys?.(state(), ["component:auth"]);
    expect(result?.has("component:auth")).toBe(true);
  });

  test("an empty selection connects to nothing", () => {
    expect(mod.connectedKeys?.(state(), [])).toEqual(new Set());
  });
});

describe("toggleSelection", () => {
  test("adds a key that is not yet selected", () => {
    const result = mod.toggleSelection?.(new Set(), "component:auth");
    expect(result).toEqual(new Set(["component:auth"]));
  });

  test("removes a key that is already selected", () => {
    const result = mod.toggleSelection?.(new Set(["component:auth"]), "component:auth");
    expect(result).toEqual(new Set());
  });

  test("toggling is always additive: an unrelated key already selected stays selected", () => {
    const result = mod.toggleSelection?.(new Set(["component:auth"]), "force:S-01");
    expect(result).toEqual(new Set(["component:auth", "force:S-01"]));
  });

  test("does not mutate the input set", () => {
    const current = new Set<EntityKey>(["component:auth"]);
    mod.toggleSelection?.(current, "force:S-01");
    expect(current).toEqual(new Set(["component:auth"]));
  });
});

describe("dim opacity constants", () => {
  test("HOVER_DIM_OPACITY is 0.12", () => {
    expect(mod.HOVER_DIM_OPACITY).toBe(0.12);
  });

  test("SELECTION_DIM_OPACITY is 60% as strong as hover dimming: 1 - 0.6 * (1 - 0.12)", () => {
    expect(mod.SELECTION_DIM_OPACITY).toBeCloseTo(0.472, 10);
    expect(mod.SELECTION_DIM_OPACITY).toBeCloseTo(1 - 0.6 * (1 - (mod.HOVER_DIM_OPACITY ?? 0.12)), 10);
  });
});
