import { describe, expect, test } from "bun:test";
import * as d3 from "d3";
import type { PendingState, SnapshotAttractor, SnapshotComponent, SnapshotForce } from "./model";
import { controlAppliesTo, fitViewportHeight, mountLandscape, parseLandscapeView } from "./nkp-landscape";

function emptyState(): PendingState {
  return {
    baseAttractors: [],
    baseComponents: [],
    baseForces: [],
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

/** A d3 stand-in that fails the test if anything tries to draw. */
const noDrawing = new Proxy({}, {
  get: () => {
    throw new Error("rendered while it should not have");
  },
});

function fixture(open: boolean): void {
  document.body.innerHTML = `
    <details class="card" data-view="landscape"${open ? " open" : ""}>
      <summary><h2>Landscape</h2></summary>
      <div class="landscape-controls">
        <input type="radio" name="landscape-view" value="bundle" data-landscape-view-input checked />
        <input type="radio" name="landscape-view" value="heatmap" data-landscape-view-input />
        <input type="radio" name="landscape-view" value="regions" data-landscape-view-input />
        <label data-test="shared"><input type="checkbox" data-hide-filtered-graph-toggle checked /></label>
        <label data-landscape-for="bundle heatmap" data-test="strength"></label>
        <label data-landscape-for="bundle regions" data-test="tension"><input type="range" data-bundle-tension-input min="0" max="100" value="85" /></label>
        <label data-landscape-for="heatmap" data-test="counts"></label>
        <label data-landscape-for="regions" data-test="focus"></label>
        <label data-landscape-for="regions" data-test="lock"><input type="checkbox" data-regions-lock-toggle /></label>
        <label data-landscape-for="regions" data-test="lock-components"><input type="checkbox" data-regions-lock-components-toggle /></label>
        <label data-landscape-for="regions" data-test="keep-sim"><input type="checkbox" data-regions-keep-simulating-toggle /></label>
        <button type="button" data-landscape-reset-view>reset view</button>
        <button type="button" data-landscape-deselect-all>deselect all</button>
      </div>
      <div data-landscape></div>
      <aside data-landscape-sidebar></aside>
    </details>`;
}

/**
 * Fixture with real coupled data (unlike `fixture`/`emptyState`, which draw
 * nothing) and "hide filtered" unchecked, so the bundle view still draws its
 * leaves even though there is no matrix table in this fixture to populate
 * `visibleForceIds`/`visibleComponentNames` (readFilters always returns an
 * empty-but-defined Set when there is no matrix table, which would mark
 * everything unfocused and, under hideFiltered, filter it all away).
 */
function selectionFixture(): { state: PendingState } {
  fixture(true);
  const toggle = document.querySelector<HTMLInputElement>("[data-hide-filtered-graph-toggle]")!;
  toggle.checked = false;
  const attractors: SnapshotAttractor[] = [
    { id: "A-01", name: "resilience", description: "stays useful", positiveState: "degrades", negativeState: "cascades" },
  ];
  const components: SnapshotComponent[] = [
    { name: "auth", description: "authenticates requests", status: "actual", architectureSet: "runtime" },
    { name: "cache", description: "caches sessions", status: "actual", architectureSet: "runtime" },
  ];
  const forces: SnapshotForce[] = [
    {
      id: "S-01", kind: "stressor", shortname: "sn1", description: "desc S-01", attractorId: "A-01",
      naiveChangeOrFeature: "naive1", outcomes: "outcome1", components: ["auth", "cache"],
    },
    {
      id: "S-02", kind: "stressor", shortname: "sn2", description: "desc S-02", attractorId: "A-01",
      naiveChangeOrFeature: "naive2", outcomes: "outcome2", components: ["auth", "cache"],
    },
  ];
  const state: PendingState = {
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
  return { state };
}

function authLeaf(): SVGGElement | undefined {
  const host = document.querySelector<HTMLElement>("[data-landscape]")!;
  return [...host.querySelectorAll<SVGGElement>(".nkp-bundle-leaf")].find((g) => g.textContent?.includes("auth"));
}

function bundleLeaf(name: string): SVGGElement | undefined {
  const host = document.querySelector<HTMLElement>("[data-landscape]")!;
  return [...host.querySelectorAll<SVGGElement>(".nkp-bundle-leaf")].find((g) => g.textContent?.includes(name));
}

function sidebarText(): string {
  return document.querySelector<HTMLElement>("[data-landscape-sidebar]")?.textContent ?? "";
}

const hidden = (name: string): boolean =>
  document.querySelector<HTMLElement>(`[data-test="${name}"]`)?.hidden === true;

async function pickView(view: string): Promise<void> {
  // happy-dom does not uncheck the rest of a radio group, so do it here.
  for (const radio of Array.from(document.querySelectorAll<HTMLInputElement>("[data-landscape-view-input]"))) {
    radio.checked = radio.value === view;
  }
  const input = document.querySelector<HTMLInputElement>(`[data-landscape-view-input][value="${view}"]`)!;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await Promise.resolve();
}

describe("landscape controls", () => {
  test("a control without data-landscape-for applies to every view", () => {
    expect(controlAppliesTo(null, "regions")).toBe(true);
    expect(controlAppliesTo("bundle heatmap", "heatmap")).toBe(true);
    expect(controlAppliesTo("bundle heatmap", "regions")).toBe(false);
  });

  test("the viewport takes the screen height left after the toolbar and card chrome, never below 320px", () => {
    expect(fitViewportHeight(1000, 56, 120, 32)).toBe(792);
    expect(fitViewportHeight(500, 56, 200, 32)).toBe(320);
  });

  test("unknown or missing view ids fall back to the bundle view", () => {
    expect(parseLandscapeView("heatmap")).toBe("heatmap");
    expect(parseLandscapeView("graph")).toBe("bundle");
    expect(parseLandscapeView(undefined)).toBe("bundle");
  });

  test("shows only the controls that mean something for the selected view", async () => {
    fixture(false);
    const handle = mountLandscape(document.body, emptyState, noDrawing);
    expect([hidden("shared"), hidden("strength"), hidden("tension"), hidden("counts"), hidden("focus")])
      .toEqual([false, false, false, true, true]);

    await pickView("heatmap");
    expect([hidden("strength"), hidden("tension"), hidden("counts"), hidden("focus")]).toEqual([false, true, false, true]);

    await pickView("regions");
    expect([hidden("shared"), hidden("strength"), hidden("tension"), hidden("counts"), hidden("focus")])
      .toEqual([false, true, false, true, false]);
    handle.destroy();
  });

  test("the bundling slider actually affects the regions view's bundle geometry", async () => {
    const { state } = selectionFixture();
    const handle = mountLandscape(document.body, () => state, d3);
    await pickView("regions");
    handle.sync();
    const host = document.querySelector("[data-landscape]")!;
    const trunkPath = () => host.querySelector("path.nkp-hyper-bundle-trunk")?.getAttribute("d");
    const tensionInput = document.querySelector<HTMLInputElement>("[data-bundle-tension-input]");
    expect(tensionInput).not.toBeNull();
    if (tensionInput) tensionInput.value = "100";
    handle.sync();
    const tight = trunkPath();
    if (tensionInput) tensionInput.value = "0";
    handle.sync();
    const loose = trunkPath();
    expect(tight).toBeTruthy();
    expect(loose).toBeTruthy();
    expect(tight).not.toBe(loose);
    handle.destroy();
  });

  test("does not draw while the card is collapsed, then draws when it opens", () => {
    fixture(false);
    const handle = mountLandscape(document.body, emptyState, noDrawing);
    handle.sync();
    const host = document.querySelector<HTMLElement>("[data-landscape]")!;
    expect(host.childElementCount).toBe(0);
    handle.destroy();

    // With no components the bundle view shows its empty message without touching d3.
    fixture(true);
    const opened = mountLandscape(document.body, emptyState, noDrawing);
    expect(document.querySelector("[data-landscape] .landscape-empty")?.textContent).toContain("No components");
    opened.destroy();
  });

  test("treats an open landscape inside a hidden panel as stale until it becomes visible", () => {
    fixture(true);
    const card = document.querySelector<HTMLDetailsElement>('details[data-view="landscape"]')!;
    card.hidden = true;
    const host = document.querySelector<HTMLElement>("[data-landscape]")!;
    const handle = mountLandscape(document.body, emptyState, noDrawing);
    expect(host.childElementCount).toBe(0);

    card.hidden = false;
    document.body.dispatchEvent(new CustomEvent("landscape-panel-visible", { bubbles: true }));
    expect(host.querySelector(".landscape-empty")?.textContent).toContain("No components");
    handle.destroy();
  });
});

describe("rendered-page integration", () => {
  test("the page has three collapsed cards and a three-way landscape switch wired to shared state", async () => {
    const [shell, main] = await Promise.all([
      Bun.file("../src/view/shell.html").text(),
      Bun.file("src/main.ts").text(),
    ]);
    const cards = [...shell.matchAll(/<details class="card" data-view="([a-z]+)"([^>]*)>/g)];
    expect(cards.map((match) => match[1])).toEqual(["matrix", "landscape", "modify"]);
    expect(cards.every((match) => !/\bopen\b/.test(match[2] ?? ""))).toBe(true);

    for (const view of ["bundle", "heatmap", "regions"]) {
      expect(shell).toContain(`value="${view}" data-landscape-view-input`);
    }
    expect(shell).toContain("data-landscape>");
    expect(shell).not.toContain("data-nkp-graph");
    expect(main).toContain("mountLandscape");
    expect(main).toMatch(/onChange[\s\S]*landscape\.sync\(/);
    expect(main).not.toMatch(/fetch\([^)]*(?:add|update|remove|ledger)/i);
  });

  test("the landscape card carries a sidebar, a deselect-all button and a reset-view button", async () => {
    const shell = await Bun.file("../src/view/shell.html").text();
    expect(shell).toContain("data-landscape-sidebar");
    expect(shell).toContain("data-landscape-deselect-all");
    expect(shell).toContain("data-landscape-reset-view");
  });

  test("the regions toolbar exposes attractor-region locking", async () => {
    const shell = await Bun.file("../src/view/shell.html").text();
    expect(shell).toContain("data-regions-lock-toggle");
    expect(shell).toContain("data-regions-lock-components-toggle");
    expect(shell).toContain("lock components");
  });

  test("the landscape fixture exposes a regions keep-simulating checkbox", () => {
    fixture(true);
    const toggle = document.querySelector<HTMLInputElement>("[data-regions-keep-simulating-toggle]");
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);
    const label = toggle?.closest<HTMLElement>("[data-landscape-for]");
    expect(label?.getAttribute("data-landscape-for")).toBe("regions");
  });

  test("defines connected and directly connected in the visible in-app help", async () => {
    const shell = await Bun.file("../src/view/shell.html").text();
    expect(shell).toMatch(/directly connected[\s\S]{0,500}force[^<]*component|force[^<]*component[\s\S]{0,500}directly connected/i);
    expect(shell).toMatch(/connected[\s\S]{0,500}(?:transitive|reachable|path)/i);
  });

  test("in-app help describes the partial-transitive highlight set used by landscape views", async () => {
    const shell = await Bun.file("../src/view/shell.html").text();
    expect(shell).toMatch(/partial[\s-]?transitive|highlightConnected|sibling forces|own components/i);
  });

  test("the focused detail card is fixed bottom-right on desktop and returns to document flow on mobile", async () => {
    const shell = await Bun.file("../src/view/shell.html").text();
    expect(shell).toMatch(/\.landscape-sidebar\s*\{[^}]*position:\s*fixed[^}]*right:[^}]*bottom:/s);
    expect(shell).toMatch(/@media[^\{]*max-width[^\{]*\{[\s\S]*?\.landscape-sidebar\s*\{[^}]*position:\s*(?:static|relative)/s);
  });
});

describe("cross-view selection (Phase 2)", () => {
  test("clicking a bundle leaf shows it in the sidebar", async () => {
    const { state } = selectionFixture();
    const handle = mountLandscape(document.body, () => state, d3);
    authLeaf()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(sidebarText()).toContain("auth");
    handle.destroy();
  });

  test("clicking the same leaf twice toggles it back off (mobile-friendly: no modifier keys)", async () => {
    const { state } = selectionFixture();
    const handle = mountLandscape(document.body, () => state, d3);
    authLeaf()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(sidebarText()).toContain("auth");
    authLeaf()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(sidebarText()).not.toContain("auth");
    handle.destroy();
  });

  test("new selections become active while the detail UI keeps exactly one card", async () => {
    const { state } = selectionFixture();
    const handle = mountLandscape(document.body, () => state, d3);
    bundleLeaf("auth")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    bundleLeaf("cache")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(document.querySelectorAll("[data-sidebar-card]")).toHaveLength(1);
    expect(document.querySelector<HTMLElement>("[data-sidebar-card]")?.dataset.key).toBe("component:cache");
    document.querySelector<HTMLButtonElement>("[data-detail-prev]")?.click();
    expect(document.querySelector<HTMLElement>("[data-sidebar-card]")?.dataset.key).toBe("component:auth");
    handle.destroy();
  });

  test("removing the active selection chooses a deterministic remaining card", async () => {
    const { state } = selectionFixture();
    const handle = mountLandscape(document.body, () => state, d3);
    bundleLeaf("auth")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    bundleLeaf("cache")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.querySelector<SVGGElement>(".nkp-bundle-group")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(document.querySelector<HTMLElement>("[data-sidebar-card]")?.dataset.key).toBe("attractor:A-01");
    document.querySelector<SVGGElement>(".nkp-bundle-group")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(document.querySelectorAll("[data-sidebar-card]")).toHaveLength(1);
    expect(document.querySelector<HTMLElement>("[data-sidebar-card]")?.dataset.key).toBe("component:cache");
    handle.destroy();
  });

  test("the detail card is hidden with no focus and while the landscape card is collapsed", async () => {
    const { state } = selectionFixture();
    const card = document.querySelector<HTMLDetailsElement>('details[data-view="landscape"]')!;
    const sidebar = document.querySelector<HTMLElement>("[data-landscape-sidebar]")!;
    const handle = mountLandscape(document.body, () => state, d3);
    expect(sidebar.hidden).toBe(true);
    bundleLeaf("auth")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(sidebar.hidden).toBe(false);
    card.open = false;
    card.dispatchEvent(new Event("toggle"));
    expect(sidebar.hidden).toBe(true);
    handle.destroy();
  });

  test("selection survives a view switch", async () => {
    const { state } = selectionFixture();
    const handle = mountLandscape(document.body, () => state, d3);
    authLeaf()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(sidebarText()).toContain("auth");

    await pickView("heatmap");
    expect(sidebarText()).toContain("auth");

    await pickView("regions");
    expect(sidebarText()).toContain("auth");
    handle.destroy();
  });

  test("selection survives a filter change", async () => {
    const { state } = selectionFixture();
    const handle = mountLandscape(document.body, () => state, d3);
    authLeaf()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(sidebarText()).toContain("auth");

    const toggle = document.querySelector<HTMLInputElement>("[data-hide-filtered-graph-toggle]")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    expect(sidebarText()).toContain("auth");
    handle.destroy();
  });

  test("double-clicking the viewport clears the selection", async () => {
    const { state } = selectionFixture();
    const handle = mountLandscape(document.body, () => state, d3);
    authLeaf()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(sidebarText()).toContain("auth");

    document.querySelector<HTMLElement>("[data-landscape]")!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await Promise.resolve();
    expect(sidebarText()).not.toContain("auth");
    handle.destroy();
  });

  test("the deselect-all button clears the selection", async () => {
    const { state } = selectionFixture();
    const handle = mountLandscape(document.body, () => state, d3);
    authLeaf()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(sidebarText()).toContain("auth");

    document.querySelector<HTMLElement>("[data-landscape-deselect-all]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(sidebarText()).not.toContain("auth");
    handle.destroy();
  });

  test("a filter change updates the active view handle instead of recreating the <svg>", async () => {
    const { state } = selectionFixture();
    const handle = mountLandscape(document.body, () => state, d3);
    const host = document.querySelector<HTMLElement>("[data-landscape]")!;
    const svgBefore = host.querySelector("svg");
    expect(svgBefore).not.toBeNull();

    const toggle = document.querySelector<HTMLInputElement>("[data-hide-filtered-graph-toggle]")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();

    expect(host.querySelector("svg")).toBe(svgBefore);
    handle.destroy();
  });
});
