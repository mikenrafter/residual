import { describe, expect, test } from "bun:test";
import type { PendingState } from "./model";
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
        <label data-landscape-for="bundle" data-test="tension"></label>
        <label data-landscape-for="heatmap" data-test="counts"></label>
        <label data-landscape-for="regions" data-test="focus"></label>
      </div>
      <div data-landscape></div>
    </details>`;
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
      .toEqual([false, true, true, true, false]);
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
});
