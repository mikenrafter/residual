// The landscape card: one fixed-size viewport that shows the pending
// landscape as one of three views, picked with a segmented control.
//
//   bundle   radial edge bundling, components grouped by attractor (nkp-bundle)
//   heatmap  seriated component x component coupling matrix (nkp-seriation)
//   regions  force <-> component hypergraph with attractor regions (nkp-hypergraph)
//
// Every view reads the same page-wide filters (the matrix rows/columns the
// toolbar left visible, and the fission threshold). Controls that only mean
// something for some views carry `data-landscape-for="<view ids>"` and are
// hidden for the others. The card is a collapsed <details> by default, and a
// hidden viewport has no size, so rendering waits until the card is open.

import { effectiveState, buildNkpGraphModel, DEFAULT_MIN_COUPLING_STRENGTH } from "./nkp-graph";
import type { PendingState } from "./model";
import { createBundleView, DEFAULT_BUNDLE_TENSION, type BundleViewHandle } from "./nkp-bundle";
import { createHeatmapView } from "./nkp-seriation";
import { createRegionsView, type RegionsLockState } from "./nkp-hypergraph";
import { entityDetail, highlightConnectedKeys, toggleSelection, type EntityDetail, type EntityKey } from "./landscape-selection";
import { renderSidebar } from "./landscape-sidebar";

export type LandscapeView = "bundle" | "heatmap" | "regions";
export const LANDSCAPE_VIEWS: readonly LandscapeView[] = ["bundle", "heatmap", "regions"];
export const DEFAULT_LANDSCAPE_VIEW: LandscapeView = "bundle";

export interface LandscapeHandle {
  sync: () => void;
  destroy: () => void;
}

export interface LandscapeFilters {
  visibleForceIds: Set<string>;
  visibleComponentNames: Set<string>;
  fissionThreshold: number;
}

/** Which views a `data-landscape-for` control belongs to. */
export function controlAppliesTo(forAttribute: string | null, view: LandscapeView): boolean {
  if (!forAttribute) return true;
  return forAttribute.split(/\s+/).includes(view);
}

export function parseLandscapeView(value: string | null | undefined): LandscapeView {
  return LANDSCAPE_VIEWS.find((view) => view === value) ?? DEFAULT_LANDSCAPE_VIEW;
}

/** Page-wide filters: whatever the residue matrix currently shows. */
function readFilters(container: HTMLElement): LandscapeFilters {
  const visibleForceIds = new Set(
    Array.from(container.querySelectorAll<HTMLTableRowElement>("table.matrix tbody tr.force-row"))
      .filter((row) => !row.hidden)
      .map((row) => row.getAttribute("data-force-id"))
      .filter((id): id is string => id !== null),
  );
  const visibleComponentNames = new Set(
    Array.from(container.querySelectorAll<HTMLElement>("table.matrix thead [data-component]"))
      .filter((element) => !element.hidden)
      .map((element) => element.getAttribute("data-component"))
      .filter((name): name is string => name !== null),
  );
  const threshold = container.querySelector<HTMLInputElement>("[data-threshold-input]");
  return { visibleForceIds, visibleComponentNames, fissionThreshold: Number(threshold?.value ?? 1) };
}

function syncMinCouplingStrength(container: HTMLElement, state: PendingState, filters: LandscapeFilters): number {
  const input = container.querySelector<HTMLInputElement>("[data-min-coupling-strength-input]");
  const output = container.querySelector<HTMLOutputElement>("[data-min-coupling-strength-value]");
  if (!input) return DEFAULT_MIN_COUPLING_STRENGTH;
  const maxCount = buildNkpGraphModel(state, { ...filters, minCouplingStrength: 1 }).edges
    .reduce((max, edge) => (edge.type === "attractor" ? max : Math.max(max, edge.count)), 1);
  input.min = "1";
  input.max = String(maxCount);
  if (!input.value || Number(input.value) > maxCount) {
    input.value = String(Math.min(DEFAULT_MIN_COUPLING_STRENGTH, maxCount));
  }
  if (output) output.textContent = input.value;
  return Number(input.value);
}

/**
 * Keeps the top-N tier slider's range in step with the data. Until the
 * viewer moves it, it sits at the maximum so every tier shows.
 */
function syncTopN(
  container: HTMLElement,
  state: PendingState,
  filters: LandscapeFilters,
  minCouplingStrength: number,
): { topNCouplings: number | undefined; topNDirection: "strongest" | "weakest" } {
  const input = container.querySelector<HTMLInputElement>("[data-top-n-couplings-input]");
  const output = container.querySelector<HTMLOutputElement>("[data-top-n-couplings-value]");
  const label = container.querySelector<HTMLElement>("[data-top-n-direction-label]");
  const weakest = container.querySelector<HTMLInputElement>("[data-top-n-weakest-toggle]");
  const topNDirection: "strongest" | "weakest" = weakest?.checked ? "weakest" : "strongest";
  if (label) label.textContent = topNDirection;
  if (!input) return { topNCouplings: undefined, topNDirection };
  const tiers = new Set(
    buildNkpGraphModel(state, { ...filters, minCouplingStrength }).edges
      .filter((edge) => edge.type === "coupling")
      .map((edge) => edge.count),
  ).size;
  const maxTiers = Math.max(1, tiers);
  input.min = "1";
  input.max = String(maxTiers);
  if (input.dataset.userSet !== "true" || Number(input.value) > maxTiers) input.value = String(maxTiers);
  if (output) output.textContent = input.value === String(maxTiers) ? "all" : input.value;
  const value = Number(input.value);
  return { topNCouplings: value >= maxTiers ? undefined : value, topNDirection };
}

function syncFocusOptions(select: HTMLSelectElement | null, state: PendingState): string | undefined {
  if (!select) return undefined;
  const names = effectiveState(state).components.map((component) => component.name).sort();
  const current = select.value;
  const wanted = ["", ...names];
  const existing = Array.from(select.options).map((option) => option.value);
  if (existing.join("\u0000") !== wanted.join("\u0000")) {
    select.replaceChildren(...wanted.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name || "all components";
      return option;
    }));
  }
  select.value = names.includes(current) ? current : "";
  return select.value || undefined;
}

const CONTROL_SELECTOR = [
  "[data-force-filter]",
  "[data-show-proposed-toggle]",
  "[data-show-unrelated-toggle]",
  "[data-threshold-input]",
  "[data-fusion-fission-filter]",
  "[data-landscape-view-input]",
  "[data-hide-filtered-graph-toggle]",
  "[data-min-coupling-strength-input]",
  "[data-top-n-couplings-input]",
  "[data-top-n-weakest-toggle]",
  "[data-bundle-tension-input]",
  "[data-heatmap-counts-toggle]",
  "[data-regions-focus]",
  "[data-regions-names-toggle]",
  "[data-regions-lock-toggle]",
  "[data-regions-keep-simulating-toggle]",
].join(", ");

/**
 * Height that lets the whole open card (summary, controls, viewport) fit on
 * screen below the sticky toolbar, so the viewer never scrolls to see the
 * drawing. `chrome` is everything in the card above the viewport.
 */
export function fitViewportHeight(windowHeight: number, toolbarHeight: number, chrome: number, bottomPadding: number): number {
  return Math.max(320, Math.floor(windowHeight - toolbarHeight - chrome - bottomPadding));
}

/**
 * Mounts the landscape card's view switcher, controls, viewport and sidebar.
 * Owns the cross-view selection (`Set<EntityKey>`): it survives view
 * switches and filter changes, and drives both the active view's
 * `setSelection` and the sidebar on every change. Each view is a persistent
 * handle (`{update, setSelection, resetView, destroy}`); a filter/setting
 * change calls the active handle's `update` (never recreates its `<svg>`),
 * and only a view switch destroys the old handle and creates the new one.
 */
export function mountLandscape(container: HTMLElement, getState: () => PendingState, d3: any): LandscapeHandle {
  const host = container.querySelector<HTMLElement>("[data-landscape]");
  const card = host?.closest("details") ?? null;
  const sidebarEl = container.querySelector<HTMLElement>("[data-landscape-sidebar]");
  const deselectAllButton = container.querySelector<HTMLElement>("[data-landscape-deselect-all]");
  const resetViewButton = container.querySelector<HTMLElement>("[data-landscape-reset-view]");
  let stale = true;
  let activeView: LandscapeView | undefined;
  let viewHandle: BundleViewHandle | undefined;
  let selected = new Set<EntityKey>();
  let activeKey: EntityKey | undefined;
  const regionsLockState: RegionsLockState = { enabled: false, locks: new Map() };

  const panelIsHidden = (): boolean => Boolean(card?.closest("[hidden]"));

  const currentView = (): LandscapeView =>
    parseLandscapeView(container.querySelector<HTMLInputElement>("[data-landscape-view-input]:checked")?.value);

  const toolbar = container.querySelector<HTMLElement>("[data-view-toolbar]");
  const fitViewport = (): void => {
    if (!host || !card?.open) return;
    const toolbarHeight = toolbar?.offsetHeight ?? 0;
    const chrome = host.getBoundingClientRect().top - card.getBoundingClientRect().top;
    card.style.scrollMarginTop = `${toolbarHeight + 8}px`;
    host.style.height = `${fitViewportHeight(window.innerHeight, toolbarHeight, chrome, 32)}px`;
  };

  const renderSidebarNow = (): void => {
    if (!sidebarEl) return;
    const state = getState();
    const details: EntityDetail[] = [];
    for (const key of selected) {
      const detail = entityDetail(state, key);
      if (detail) details.push(detail);
    }
    sidebarEl.hidden = details.length === 0 || !card?.open || panelIsHidden();
    renderSidebar(sidebarEl, details, {
      activeKey,
      onActivate: (key) => {
        if (!selected.has(key)) return;
        activeKey = key;
        renderSidebarNow();
      },
      onDeselect: (key) => applySelection(toggleSelection(selected, key)),
      onClearAll: clearSelection,
    });
  };

  /** Re-applies `next` as the selection: pushes it to the active view and re-renders the sidebar. */
  const applySelection = (next: Set<EntityKey>, activate?: EntityKey): void => {
    selected = next;
    if (activate && selected.has(activate)) activeKey = activate;
    if (!activeKey || !selected.has(activeKey)) activeKey = [...selected].at(-1);
    const connected = highlightConnectedKeys(getState(), selected);
    viewHandle?.setSelection(selected, connected);
    renderSidebarNow();
  };

  const onEntityToggle = (key: EntityKey): void => {
    const wasSelected = selected.has(key);
    applySelection(toggleSelection(selected, key), wasSelected ? undefined : key);
  };
  function clearSelection(): void {
    if (selected.size === 0) return;
    activeKey = undefined;
    applySelection(new Set());
  }

  /** Builds the view's persistent handle on first use or on a view switch; reuses it otherwise. */
  const ensureViewHandle = (view: LandscapeView, viewportHost: HTMLElement): BundleViewHandle => {
    if (viewHandle && activeView === view) return viewHandle;
    viewHandle?.destroy();
    viewHandle = view === "bundle"
      ? createBundleView({ host: viewportHost, d3, onToggle: onEntityToggle, onClear: clearSelection })
      : view === "heatmap"
        ? createHeatmapView({ host: viewportHost, d3, onToggle: onEntityToggle, onClear: clearSelection })
        : createRegionsView({
            host: viewportHost,
            d3,
            onToggle: onEntityToggle,
            onClear: clearSelection,
            lockState: regionsLockState,
          });
    activeView = view;
    return viewHandle;
  };

  const sync = (): void => {
    if (!host) return;
    const view = currentView();
    host.dataset.view = view;
    for (const control of Array.from(container.querySelectorAll<HTMLElement>("[data-landscape-for]"))) {
      control.hidden = !controlAppliesTo(control.getAttribute("data-landscape-for"), view);
    }
    if (card && (!card.open || panelIsHidden())) {
      stale = true;
      if (sidebarEl) sidebarEl.hidden = true;
      return;
    }
    stale = false;
    fitViewport();

    const state = getState();
    const filters = readFilters(container);
    const hideFiltered = container.querySelector<HTMLInputElement>("[data-hide-filtered-graph-toggle]")?.checked ?? true;
    const handle = ensureViewHandle(view, host);

    if (view === "regions") {
      const focusComponent = syncFocusOptions(container.querySelector<HTMLSelectElement>("[data-regions-focus]"), state);
      const showNames = container.querySelector<HTMLInputElement>("[data-regions-names-toggle]")?.checked ?? true;
      const lockRegions = container.querySelector<HTMLInputElement>("[data-regions-lock-toggle]")?.checked ?? false;
      const keepSimulating = container.querySelector<HTMLInputElement>("[data-regions-keep-simulating-toggle]")?.checked ?? false;
      const tensionInput = container.querySelector<HTMLInputElement>("[data-bundle-tension-input]");
      const tension = tensionInput ? Number(tensionInput.value) / 100 : DEFAULT_BUNDLE_TENSION;
      handle.update(state, { ...filters, hideFiltered, showNames, lockRegions, keepSimulating, tension, ...(focusComponent ? { focusComponent } : {}) });
    } else {
      const minCouplingStrength = syncMinCouplingStrength(container, state, filters);
      if (view === "heatmap") {
        const showCounts = container.querySelector<HTMLInputElement>("[data-heatmap-counts-toggle]")?.checked ?? true;
        handle.update(state, { ...filters, hideFiltered, minCouplingStrength, showCounts });
      } else {
        const { topNCouplings, topNDirection } = syncTopN(container, state, filters, minCouplingStrength);
        const tensionInput = container.querySelector<HTMLInputElement>("[data-bundle-tension-input]");
        const tension = tensionInput ? Number(tensionInput.value) / 100 : DEFAULT_BUNDLE_TENSION;
        handle.update(state, {
          ...filters,
          hideFiltered,
          minCouplingStrength,
          ...(topNCouplings === undefined ? {} : { topNCouplings }),
          topNDirection,
          tension,
        });
      }
    }

    const connected = highlightConnectedKeys(state, selected);
    handle.setSelection(selected, connected);
    renderSidebarNow();
  };

  const onControl = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(CONTROL_SELECTOR)) return;
    if (target instanceof HTMLInputElement) {
      if (target.matches("[data-top-n-couplings-input]") && event.type === "input") target.dataset.userSet = "true";
      if (target.matches("[data-min-coupling-strength-input]")) {
        const output = container.querySelector("[data-min-coupling-strength-value]");
        if (output) output.textContent = target.value;
      }
    }
    queueMicrotask(sync);
  };
  const onCardToggle = (): void => {
    if (!card?.open || panelIsHidden()) {
      stale = true;
      if (sidebarEl) sidebarEl.hidden = true;
      return;
    }
    if (stale) sync();
    card.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const onPanelVisible = (): void => sync();
  const onHostDblClick = (): void => clearSelection();
  const onDeselectAllClick = (): void => clearSelection();
  const onResetViewClick = (): void => viewHandle?.resetView();
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = (): void => {
    clearTimeout(resizeTimer);
    // Only the force layout depends on the viewport's aspect ratio; the
    // other views rescale through their viewBox once the height is refit.
    resizeTimer = setTimeout(() => {
      if (currentView() === "regions") sync();
      else fitViewport();
    }, 200);
  };

  container.addEventListener("input", onControl);
  container.addEventListener("change", onControl);
  card?.addEventListener("toggle", onCardToggle);
  container.addEventListener("landscape-panel-visible", onPanelVisible);
  host?.addEventListener("dblclick", onHostDblClick);
  deselectAllButton?.addEventListener("click", onDeselectAllClick);
  resetViewButton?.addEventListener("click", onResetViewClick);
  window.addEventListener("resize", onResize);
  sync();

  return {
    sync,
    destroy: () => {
      viewHandle?.destroy();
      clearTimeout(resizeTimer);
      container.removeEventListener("input", onControl);
      container.removeEventListener("change", onControl);
      card?.removeEventListener("toggle", onCardToggle);
      container.removeEventListener("landscape-panel-visible", onPanelVisible);
      host?.removeEventListener("dblclick", onHostDblClick);
      deselectAllButton?.removeEventListener("click", onDeselectAllClick);
      resetViewButton?.removeEventListener("click", onResetViewClick);
      window.removeEventListener("resize", onResize);
      host?.replaceChildren();
    },
  };
}
