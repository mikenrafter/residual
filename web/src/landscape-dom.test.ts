import { beforeAll, describe, expect, test } from "bun:test";

/**
 * zoomWheelDelta and ZOOM_SPEED don't exist yet (Phase 2). landscape-dom.ts
 * itself already exists, but Bun's static `import { name } from "./mod"`
 * throws a SyntaxError at module-load time when `name` isn't actually
 * exported (verified: it does NOT quietly resolve to `undefined`) — that
 * would abort this whole file's test discovery. So, same as a brand-new
 * module, go through a dynamic import and read the property off the
 * resulting namespace object instead of naming it in a static import.
 */
type DomModule = {
  ZOOM_SPEED?: number;
  zoomWheelDelta?: (event: { deltaY: number; deltaMode: number; ctrlKey: boolean }) => number;
  createTooltip?: (host: HTMLElement) => HTMLElement;
};

let mod: DomModule = {};

beforeAll(async () => {
  mod = (await import("./landscape-dom").catch(() => ({}))) as DomModule;
});

/**
 * d3's own default wheelDelta (see d3-zoom's `defaultWheelDelta`):
 *   -deltaY * (deltaMode === 1 ? 0.05 : deltaMode ? 1 : 0.002) * (ctrlKey ? 10 : 1)
 * The landscape views want gentler zooming: 0.6x that value, same formula
 * otherwise, so the same gesture filter (ctrl/meta+wheel, pinch, drag) still
 * decides whether zoom fires at all — only the magnitude changes.
 */
function d3DefaultWheelDelta(event: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002) * (event.ctrlKey ? 10 : 1);
}

describe("ZOOM_SPEED", () => {
  test("is 0.6", () => {
    expect(mod.ZOOM_SPEED).toBe(0.6);
  });
});

describe("zoomWheelDelta", () => {
  test("pixel mode (deltaMode 0) is 0.6x d3's default", () => {
    const event = { deltaY: 100, deltaMode: 0, ctrlKey: false };
    expect(mod.zoomWheelDelta?.(event)).toBeCloseTo(0.6 * d3DefaultWheelDelta(event), 10);
    expect(mod.zoomWheelDelta?.(event)).toBeCloseTo(-0.12, 10);
  });

  test("line mode (deltaMode 1) is 0.6x d3's default", () => {
    const event = { deltaY: 3, deltaMode: 1, ctrlKey: false };
    expect(mod.zoomWheelDelta?.(event)).toBeCloseTo(0.6 * d3DefaultWheelDelta(event), 10);
    expect(mod.zoomWheelDelta?.(event)).toBeCloseTo(-0.09, 10);
  });

  test("page mode (deltaMode 2) is 0.6x d3's default", () => {
    const event = { deltaY: 1, deltaMode: 2, ctrlKey: false };
    expect(mod.zoomWheelDelta?.(event)).toBeCloseTo(0.6 * d3DefaultWheelDelta(event), 10);
    expect(mod.zoomWheelDelta?.(event)).toBeCloseTo(-0.6, 10);
  });

  test("ctrlKey multiplies the pixel-mode delta by 10, still scaled by 0.6", () => {
    const event = { deltaY: 100, deltaMode: 0, ctrlKey: true };
    expect(mod.zoomWheelDelta?.(event)).toBeCloseTo(0.6 * d3DefaultWheelDelta(event), 10);
    expect(mod.zoomWheelDelta?.(event)).toBeCloseTo(-1.2, 10);
  });

  test("sign follows -deltaY (scrolling down zooms out, i.e. positive delta shrinks)", () => {
    expect(mod.zoomWheelDelta?.({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeGreaterThan(0);
    expect(mod.zoomWheelDelta?.({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeLessThan(0);
  });
});

describe("shared landscape tooltip", () => {
  test("all views reuse one document-level tooltip", () => {
    document.body.innerHTML = `<div data-view-a></div><div data-view-b></div>`;
    const a = document.querySelector<HTMLElement>("[data-view-a]")!;
    const b = document.querySelector<HTMLElement>("[data-view-b]")!;
    const first = mod.createTooltip?.(a);
    const second = mod.createTooltip?.(b);
    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(document.querySelectorAll(".landscape-tip")).toHaveLength(1);
    expect(first?.parentElement).toBe(document.body);
  });

  test("the tooltip is fixed at the top right and announced accessibly", async () => {
    const shell = await Bun.file("../src/view/shell.html").text();
    expect(shell).toMatch(/\.landscape-tip\s*\{[^}]*position:\s*fixed/s);
    expect(shell).toMatch(/\.landscape-tip\s*\{[^}]*top:/s);
    expect(shell).toMatch(/\.landscape-tip\s*\{[^}]*right:/s);
    document.body.innerHTML = `<div data-view></div>`;
    const tip = mod.createTooltip?.(document.querySelector<HTMLElement>("[data-view]")!);
    expect(tip?.getAttribute("role")).toBe("tooltip");
  });
});
