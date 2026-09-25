import { beforeAll, describe, expect, test } from "bun:test";
import type { EntityDetail, EntityKey } from "./landscape-selection.test";

/**
 * Contract tests for the landscape sidebar renderer (landscape-sidebar.ts,
 * not yet written — Phase 2). Assumed signature, documented in the Phase 1
 * report for Phase 2 to implement exactly:
 *
 *   renderSidebar(el: HTMLElement, details: EntityDetail[], handlers: {
 *     activeKey?: EntityKey;
 *     onActivate: (key: EntityKey) => void;
 *     onDeselect: (key: EntityKey) => void;
 *     onClearAll: () => void;
 *   }): void
 *
 * Markup contract this file assumes (also for Phase 2 to match):
 *   - a "deselect all" button matching `[data-landscape-deselect-all]`
 *     (the same attribute name the plan gives the sidebar's header button)
 *   - a count somewhere in the header text
 *   - when `details` is empty: an empty-state hint element
 *     `[data-sidebar-empty]` and no cards
 *   - otherwise: exactly one `[data-sidebar-card]` for the active detail,
 *     `data-key` set to the detail's key, showing its title and every field, with
 *     a per-card deselect control `[data-sidebar-deselect]` inside the card
 *   - previous/next controls cycle through all selected details
 *
 * The guarded dynamic import keeps this file runnable before the module
 * exists (see nkp-graph.test.ts for the same pattern).
 */
type SidebarHandlers = {
  activeKey?: EntityKey;
  onActivate: (key: EntityKey) => void;
  onDeselect: (key: EntityKey) => void;
  onClearAll: () => void;
};
type SidebarModule = {
  renderSidebar?: (el: HTMLElement, details: EntityDetail[], handlers: SidebarHandlers) => void;
};

let mod: SidebarModule = {};

beforeAll(async () => {
  mod = (await import("./landscape-sidebar").catch(() => ({}))) as SidebarModule;
});

function host(): HTMLElement {
  document.body.innerHTML = `<aside data-landscape-sidebar></aside>`;
  return document.querySelector<HTMLElement>("[data-landscape-sidebar]")!;
}

const componentDetail: EntityDetail = {
  key: "component:auth",
  kind: "component",
  title: "auth",
  fields: [
    { label: "name", value: "auth" },
    { label: "description", value: "authenticates requests" },
    { label: "status", value: "actual" },
    { label: "architecture set", value: "runtime" },
    { label: "force count", value: "2" },
  ],
};

const attractorDetail: EntityDetail = {
  key: "attractor:A-01",
  kind: "attractor",
  title: "resilience",
  color: "hsl(20 62% 60%)",
  fields: [
    { label: "name", value: "resilience" },
    { label: "description", value: "stays useful" },
    { label: "positive", value: "degrades" },
    { label: "negative", value: "cascades" },
    { label: "force count", value: "3" },
  ],
};

const noopHandlers = (overrides: Partial<SidebarHandlers> = {}): SidebarHandlers => ({
  onActivate: () => {},
  onDeselect: () => {},
  onClearAll: () => {},
  ...overrides,
});

describe("renderSidebar empty state", () => {
  test("shows an empty-state hint and no cards when nothing is selected", () => {
    const el = host();
    mod.renderSidebar?.(el, [], noopHandlers());
    expect(el.querySelector("[data-sidebar-empty]")).not.toBeNull();
    expect(el.querySelectorAll("[data-sidebar-card]")).toHaveLength(0);
  });
});

describe("renderSidebar with a focused entity", () => {
  test("renders exactly one detail card with every field", () => {
    const el = host();
    mod.renderSidebar?.(el, [componentDetail], noopHandlers({ activeKey: componentDetail.key }));
    const cards = el.querySelectorAll<HTMLElement>("[data-sidebar-card]");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute("data-key")).toBe("component:auth");

    const authCard = [...cards].find((card) => card.getAttribute("data-key") === "component:auth")!;
    expect(authCard.textContent).toContain("auth");
    for (const f of componentDetail.fields) {
      expect(authCard.textContent).toContain(f.value);
    }
  });

  test("no empty-state hint once at least one entity is selected", () => {
    const el = host();
    mod.renderSidebar?.(el, [componentDetail], noopHandlers({ activeKey: componentDetail.key }));
    expect(el.querySelector("[data-sidebar-empty]")).toBeNull();
  });

  test("describes the single focused entity instead of showing a selection count", () => {
    const el = host();
    mod.renderSidebar?.(el, [attractorDetail], noopHandlers({ activeKey: attractorDetail.key }));
    expect(el.textContent).toContain("resilience");
    expect(el.textContent).not.toMatch(/2 selected/i);
  });

  test("each card's deselect control calls onDeselect with that entity's key", () => {
    const el = host();
    const deselected: EntityKey[] = [];
    mod.renderSidebar?.(el, [componentDetail, attractorDetail], {
      activeKey: componentDetail.key,
      onActivate: () => {},
      onDeselect: (key) => deselected.push(key),
      onClearAll: () => {},
    });
    const authCard = [...el.querySelectorAll<HTMLElement>("[data-sidebar-card]")]
      .find((card) => card.getAttribute("data-key") === "component:auth");
    authCard?.querySelector<HTMLElement>("[data-sidebar-deselect]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(deselected).toEqual(["component:auth"]);
  });

  test("the deselect-all button calls onClearAll", () => {
    const el = host();
    let cleared = false;
    mod.renderSidebar?.(el, [componentDetail], noopHandlers({ activeKey: componentDetail.key, onClearAll: () => { cleared = true; } }));
    el.querySelector<HTMLElement>("[data-landscape-deselect-all]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cleared).toBe(true);
  });

  test("re-rendering with a new list replaces the previous cards", () => {
    const el = host();
    mod.renderSidebar?.(el, [attractorDetail], noopHandlers({ activeKey: attractorDetail.key }));
    mod.renderSidebar?.(el, [componentDetail], noopHandlers({ activeKey: componentDetail.key }));
    const cards = el.querySelectorAll<HTMLElement>("[data-sidebar-card]");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute("data-key")).toBe("component:auth");
  });

  test("multiple selected entities still render exactly one active card", () => {
    const el = host();
    mod.renderSidebar?.(el, [componentDetail, attractorDetail], noopHandlers({ activeKey: attractorDetail.key }));
    const cards = el.querySelectorAll<HTMLElement>("[data-sidebar-card]");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.dataset.key).toBe(attractorDetail.key);
    expect(el.textContent).toContain("2 selected");
  });

  test("previous and next arrows cycle selected details and wrap", () => {
    const el = host();
    const activated: EntityKey[] = [];
    mod.renderSidebar?.(el, [componentDetail, attractorDetail], noopHandlers({
      activeKey: componentDetail.key,
      onActivate: (key) => activated.push(key),
    }));
    el.querySelector<HTMLButtonElement>("[data-detail-prev]")?.click();
    el.querySelector<HTMLButtonElement>("[data-detail-next]")?.click();
    expect(activated).toEqual([attractorDetail.key, attractorDetail.key]);
  });

  test("both arrows are disabled for one selection and hidden for zero", () => {
    const el = host();
    mod.renderSidebar?.(el, [componentDetail], noopHandlers({ activeKey: componentDetail.key }));
    expect(el.querySelector<HTMLButtonElement>("[data-detail-prev]")?.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>("[data-detail-next]")?.disabled).toBe(true);
    mod.renderSidebar?.(el, [], noopHandlers());
    expect(el.querySelector("[data-detail-prev]")).toBeNull();
    expect(el.querySelector("[data-detail-next]")).toBeNull();
  });
});
