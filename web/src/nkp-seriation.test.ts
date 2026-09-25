import { beforeAll, describe, expect, test } from "bun:test";
import * as d3 from "d3";
import type { PendingState, SnapshotComponent, SnapshotForce } from "./model";
import { attractorColors } from "./nkp-graph";
import { buildSeriationModel, seriate } from "./nkp-seriation";

/**
 * createHeatmapView, cellHalf and MIRROR_DIM_OPACITY don't exist yet (Phase
 * 3). Read off the module's namespace object via a dynamic import instead of
 * naming them in a static import — Bun's static `import { name } from
 * "./real-module"` throws a SyntaxError (not `undefined`) when `name` isn't
 * actually exported yet, which would abort this whole file's test discovery.
 * See nkp-graph.test.ts for the guarded pattern applied to a module that
 * doesn't exist at all.
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
type HeatmapViewModule = {
  createHeatmapView?: (ctx: ViewCtx) => ViewHandle;
  cellHalf?: (row: number, col: number) => "upper" | "lower" | "diagonal";
  MIRROR_DIM_OPACITY?: number;
};

let heatmapModule: HeatmapViewModule = {};

beforeAll(async () => {
  heatmapModule = (await import("./nkp-seriation").catch(() => ({}))) as HeatmapViewModule;
});

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

describe("cellHalf", () => {
  test("col > row is the upper-right triangle", () => {
    expect(heatmapModule.cellHalf?.(0, 1)).toBe("upper");
    expect(heatmapModule.cellHalf?.(2, 4)).toBe("upper");
  });

  test("col < row is the lower-left triangle", () => {
    expect(heatmapModule.cellHalf?.(1, 0)).toBe("lower");
    expect(heatmapModule.cellHalf?.(4, 2)).toBe("lower");
  });

  test("col === row is the diagonal", () => {
    expect(heatmapModule.cellHalf?.(3, 3)).toBe("diagonal");
  });
});

describe("MIRROR_DIM_OPACITY", () => {
  test("is 0.5", () => {
    expect(heatmapModule.MIRROR_DIM_OPACITY).toBe(0.5);
  });
});

describe("createHeatmapView (persistent view handle, Phase 3)", () => {
  // Assumed DOM contract for Phase 3 (documented in the Phase 1 report):
  //   cells:      [data-cell-row="R"][data-cell-col="C"]
  //   diagonal:   [data-diagonal-index="N"]
  //   headers:    [data-header-axis="row"|"col"][data-header-index="N"]
  //   legend:     [data-legend-id="<attractorId>"]  (matches landscape-dom's
  //               existing renderLegend convention)
  //   hover uses "mousemove"/"mouseleave" (matches today's renderNkpSeriation)
  const options = { minCouplingStrength: 1 };
  const model = buildSeriationModel(blocks, options);
  const indexOf = (name: string): number => model.components.findIndex((item) => item.name === name);

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

  const cellEl = (host: HTMLElement, rowName: string, colName: string): Element | null =>
    host.querySelector(`[data-cell-row="${indexOf(rowName)}"][data-cell-col="${indexOf(colName)}"]`);

  test("exists and returns the {update, setSelection, resetView, destroy} handle shape", () => {
    const { ctx } = makeCtx();
    const handle = heatmapModule.createHeatmapView?.(ctx);
    expect(handle).toBeDefined();
    expect(typeof handle?.update).toBe("function");
    expect(typeof handle?.setSelection).toBe("function");
    expect(typeof handle?.resetView).toBe("function");
    expect(typeof handle?.destroy).toBe("function");
  });

  test("a narrower filter keeps the same <svg>, keeps a keyed header for a surviving component, and removes filtered ones", () => {
    const { ctx, host } = makeCtx();
    const handle = heatmapModule.createHeatmapView?.(ctx);
    handle?.update(blocks, { ...options, hideFiltered: true });
    const svgBefore = host.querySelector("svg");
    const aHeaderBefore = host.querySelector(`[data-header-axis="row"][data-header-index="${indexOf("a")}"]`);
    expect(svgBefore).not.toBeNull();
    expect(aHeaderBefore).not.toBeNull();

    handle?.update(blocks, {
      ...options,
      hideFiltered: true,
      visibleForceIds: new Set(["S-01", "S-02"]),
      visibleComponentNames: new Set(["a", "c"]),
    });
    expect(host.querySelector("svg")).toBe(svgBefore);
    expect(host.querySelector(`[data-header-axis="row"][data-header-index="${indexOf("a")}"]`)).toBe(aHeaderBefore);
    expect(host.querySelector(`[data-header-axis="row"]`)?.textContent).not.toBeNull();
  });

  test("clicking a row header calls ctx.onToggle with its component key", () => {
    const { ctx, host, toggled } = makeCtx();
    const handle = heatmapModule.createHeatmapView?.(ctx);
    handle?.update(blocks, options);
    host.querySelector(`[data-header-axis="row"][data-header-index="${indexOf("a")}"]`)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggled).toEqual(["component:a"]);
  });

  test("clicking a cell toggles every shared force between its row and column", () => {
    const { ctx, host, toggled } = makeCtx();
    const handle = heatmapModule.createHeatmapView?.(ctx);
    handle?.update(blocks, options);
    cellEl(host, "b", "d")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect([...toggled].sort()).toEqual(["force:S-03", "force:S-04", "force:S-05"]);
  });

  test("clicking a legend item calls ctx.onToggle with its attractor key", () => {
    const { ctx, host, toggled } = makeCtx();
    const handle = heatmapModule.createHeatmapView?.(ctx);
    handle?.update(blocks, options);
    host.querySelector(`[data-legend-id="A-01"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggled).toEqual(["attractor:A-01"]);
  });

  test("setSelection marks selected/connected headers and dims everyone else", () => {
    const { ctx, host } = makeCtx();
    const handle = heatmapModule.createHeatmapView?.(ctx);
    handle?.update(blocks, options);
    handle?.setSelection(new Set(["component:a"]), new Set(["component:a", "component:c"]));
    const aHeader = host.querySelector(`[data-header-axis="row"][data-header-index="${indexOf("a")}"]`);
    const cHeader = host.querySelector(`[data-header-axis="row"][data-header-index="${indexOf("c")}"]`);
    const bHeader = host.querySelector(`[data-header-axis="row"][data-header-index="${indexOf("b")}"]`);
    expect(aHeader?.classList.contains("selected")).toBe(true);
    expect(cHeader?.classList.contains("connected")).toBe(true);
    expect(bHeader?.classList.contains("selected") || bHeader?.classList.contains("connected")).toBe(false);
  });

  test("focus leaves labels visible only for selected and connected entities", () => {
    const { ctx, host } = makeCtx();
    const handle = heatmapModule.createHeatmapView?.(ctx);
    handle?.update(blocks, options);
    handle?.setSelection(new Set(["component:a"]), new Set(["component:a", "component:c", "attractor:A-01"]));
    const headerLabel = (name: string) => {
      const index = indexOf(name);
      return host.querySelector<SVGTextElement>(`[data-header-axis="row"][data-header-index="${index}"] .nkp-seriation-label`);
    };
    expect(headerLabel("a")?.getAttribute("opacity")).not.toBe("0");
    expect(headerLabel("c")?.getAttribute("opacity")).not.toBe("0");
    expect(headerLabel("b")?.getAttribute("opacity")).toBe("0");
  });

  test("row and column headers show circle/square implementation-status glyphs", () => {
    const pending = state([component("actual", "actual"), component("proposed", "proposed")], [
      force("S-10", "A-01", ["actual", "proposed"]),
    ]);
    const { ctx, host } = makeCtx();
    const handle = heatmapModule.createHeatmapView?.(ctx);
    handle?.update(pending, { minCouplingStrength: 1 });
    for (const axis of ["row", "col"]) {
      expect(host.querySelector(`[data-header-axis="${axis}"] [data-component-status-shape="actual"]`)?.tagName.toLowerCase()).toBe("circle");
      expect(host.querySelector(`[data-header-axis="${axis}"] [data-component-status-shape="proposed"]`)?.tagName.toLowerCase()).toBe("rect");
    }
  });

  test("uses accessible labels instead of native SVG title tooltips", () => {
    const { ctx, host } = makeCtx();
    const handle = heatmapModule.createHeatmapView?.(ctx);
    handle?.update(blocks, options);
    expect(host.querySelector("svg title")).toBeNull();
    expect([...host.querySelectorAll<SVGElement>("[data-header-axis], [data-cell-row], [data-legend-id]")]
      .every((item) => Boolean(item.getAttribute("aria-label")))).toBe(true);
  });

  test("all text lives in a last-child g.landscape-labels group", () => {
    const { ctx, host } = makeCtx();
    const handle = heatmapModule.createHeatmapView?.(ctx);
    handle?.update(blocks, options);
    const svg = host.querySelector("svg");
    const labelGroup = svg?.querySelector("g.landscape-labels");
    expect(labelGroup).not.toBeNull();
    expect(svg?.lastElementChild).toBe(labelGroup ?? null);
    const allText = svg?.querySelectorAll("text") ?? [];
    const labelText = labelGroup?.querySelectorAll("text") ?? [];
    expect(allText.length).toBeGreaterThan(0);
    expect(allText.length).toBe(labelText.length);
  });

  test("diagonal fill-opacity fades to 0.3x (not the old 0.4x) once its component is unfocused", () => {
    const { ctx, host } = makeCtx();
    const handle = heatmapModule.createHeatmapView?.(ctx);
    // Only S-01/S-02 (A-01, touching a/c) stay visible; b/d (A-02) are
    // unfocused but still rendered since hideFiltered is left off.
    handle?.update(blocks, { ...options, visibleForceIds: new Set(["S-01", "S-02"]) });

    const intensity = (value: number, max: number): number => (max <= 0 ? 0 : 0.18 + 0.82 * (value / max));
    // b's k is unaffected by the filter (hideFiltered off counts every base
    // force): S-03, S-04, S-05 => k=3, which also happens to be maxK.
    const bRect = host.querySelector(`[data-diagonal-index="${indexOf("b")}"] rect`);
    expect(bRect).not.toBeNull();
    expect(Number(bRect?.getAttribute("fill-opacity"))).toBeCloseTo(intensity(3, 3) * 0.3, 5);

    // a stays focused (S-01 touches it) at k=2, multiplier 1.
    const aRect = host.querySelector(`[data-diagonal-index="${indexOf("a")}"] rect`);
    expect(aRect).not.toBeNull();
    expect(Number(aRect?.getAttribute("fill-opacity"))).toBeCloseTo(intensity(2, 3) * 1, 5);
  });

  describe("heatmap mirror half", () => {
    test("hovering an upper-triangle cell dims every lower-triangle cell, never the diagonal", () => {
      const { ctx, host } = makeCtx();
      const handle = heatmapModule.createHeatmapView?.(ctx);
      handle?.update(blocks, options);
      const upperCell = [...host.querySelectorAll<HTMLElement>("[data-cell-row][data-cell-col]")]
        .find((el) => Number(el.dataset.cellCol) > Number(el.dataset.cellRow));
      expect(upperCell).toBeDefined();
      upperCell?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

      const cells = [...host.querySelectorAll<HTMLElement>("[data-cell-row][data-cell-col]")];
      const lower = cells.filter((el) => Number(el.dataset.cellCol) < Number(el.dataset.cellRow));
      const upper = cells.filter((el) => Number(el.dataset.cellCol) > Number(el.dataset.cellRow));
      expect(lower.length).toBeGreaterThan(0);
      expect(lower.every((el) => el.classList.contains("mirror-dim"))).toBe(true);
      expect(upper.some((el) => el.classList.contains("mirror-dim"))).toBe(false);

      const diagonal = [...host.querySelectorAll<HTMLElement>("[data-diagonal-index]")];
      expect(diagonal.every((el) => !el.classList.contains("mirror-dim"))).toBe(true);
    });

    test("mouseleave clears a hover-driven mirror-dim", () => {
      const { ctx, host } = makeCtx();
      const handle = heatmapModule.createHeatmapView?.(ctx);
      handle?.update(blocks, options);
      const upperCell = [...host.querySelectorAll<HTMLElement>("[data-cell-row][data-cell-col]")]
        .find((el) => Number(el.dataset.cellCol) > Number(el.dataset.cellRow));
      upperCell?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      upperCell?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
      const anyDimmed = [...host.querySelectorAll<HTMLElement>("[data-cell-row][data-cell-col]")]
        .some((el) => el.classList.contains("mirror-dim"));
      expect(anyDimmed).toBe(false);
    });

    test("clicking a lower-triangle cell pins mirror-dim on the upper triangle until the selection is cleared", () => {
      const { ctx, host } = makeCtx();
      const handle = heatmapModule.createHeatmapView?.(ctx);
      handle?.update(blocks, options);
      const lowerCell = [...host.querySelectorAll<HTMLElement>("[data-cell-row][data-cell-col]")]
        .find((el) => Number(el.dataset.cellCol) < Number(el.dataset.cellRow));
      expect(lowerCell).toBeDefined();
      lowerCell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // A click pins the half: a mouseleave (unlike plain hover) must not clear it.
      lowerCell?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));

      const cells = [...host.querySelectorAll<HTMLElement>("[data-cell-row][data-cell-col]")];
      const upper = cells.filter((el) => Number(el.dataset.cellCol) > Number(el.dataset.cellRow));
      expect(upper.length).toBeGreaterThan(0);
      expect(upper.every((el) => el.classList.contains("mirror-dim"))).toBe(true);

      handle?.setSelection(new Set(), new Set());
      const stillDimmed = [...host.querySelectorAll<HTMLElement>("[data-cell-row][data-cell-col]")]
        .some((el) => el.classList.contains("mirror-dim"));
      expect(stillDimmed).toBe(false);
    });
  });

  test("destroy removes the drawing from the host", () => {
    const { ctx, host } = makeCtx();
    const handle = heatmapModule.createHeatmapView?.(ctx);
    handle?.update(blocks, options);
    handle?.destroy();
    expect(host.querySelector("svg")).toBeNull();
  });
});
