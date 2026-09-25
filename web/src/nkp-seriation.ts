// Seriated coupling matrix: an alternative to the force-directed NKP graph.
//
// Component x component heatmap where each off-diagonal cell counts the
// forces the two components share (the same coupling count that
// buildNkpGraphModel turns into edges) and the diagonal carries each
// component's K (its total force count). Rows/cols are reordered by
// average-linkage agglomerative clustering on cosine-normalised coupling, with
// a cheap leaf-orientation step at each merge, so tightly coupled components
// end up adjacent and show up as blocks along the diagonal.

import type { PendingState } from "./model";
import {
  DEFAULT_MIN_COUPLING_STRENGTH,
  attractorColors,
  buildNkpGraphModel,
  effectiveState,
  forceLabel,
  mutedAttractorColor,
  type EffectiveForce,
} from "./nkp-graph";
import type { EntityKey } from "./landscape-selection";
import { appendZoomableSvg, createTooltip, placeTooltip, renderEmpty, renderLegend, resetZoom } from "./landscape-dom";

export interface SeriationOptions {
  visibleForceIds?: ReadonlySet<string>;
  visibleComponentNames?: ReadonlySet<string>;
  fissionThreshold?: number;
  /** Drop filtered-out components and count only visible forces, instead of fading. */
  hideFiltered?: boolean;
  /** Cells below this shared-force count are left blank (ordering ignores this). */
  minCouplingStrength?: number;
  topNCouplings?: number;
  topNDirection?: "strongest" | "weakest";
}

export interface SeriationComponent {
  name: string;
  status: "actual" | "proposed";
  description: string;
  /** Total forces touching this component (K per node); drawn on the diagonal. */
  k: number;
  dominantAttractorId?: string;
  color: string;
  fissionCandidate: boolean;
  focused: boolean;
}

export interface SeriationCell {
  /** Indices into `components` (display order). Both halves of the symmetric matrix are emitted. */
  row: number;
  col: number;
  count: number;
  forceKeys: string[];
  forces: string[];
  focused: boolean;
}

export interface SeriationAttractor {
  id: string;
  name: string;
  /** Same colour the other landscape views use for this attractor. */
  color: string;
  componentCount: number;
}

export interface SeriationModel {
  components: SeriationComponent[];
  cells: SeriationCell[];
  maxCount: number;
  maxK: number;
  /** Only attractors that are dominant for at least one shown component. */
  attractors: SeriationAttractor[];
}

/**
 * Orders items so that similar ones sit next to each other. `similarity` is
 * a symmetric n x n matrix (diagonal ignored). Average-linkage agglomerative
 * clustering; when merging two clusters, the four end-to-end orientations are
 * tried and the one with the most similar junction wins. Zero-similarity
 * clusters are merged last, largest first, so singletons trail at the end.
 * Deterministic: ties break on the lower original index.
 */
export function seriate(similarity: number[][]): number[] {
  const n = similarity.length;
  const sim = (a: number, b: number): number => similarity[a]?.[b] ?? 0;
  let clusters: number[][] = Array.from({ length: n }, (_, index) => [index]);
  const linkage = (left: number[], right: number[]): number => {
    let total = 0;
    for (const a of left) for (const b of right) total += sim(a, b);
    return total / (left.length * right.length);
  };

  while (clusters.length > 1) {
    let best = { i: -1, j: -1, score: 0 };
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const score = linkage(clusters[i] ?? [], clusters[j] ?? []);
        if (score > best.score) best = { i, j, score };
      }
    }
    if (best.i < 0) {
      // Nothing left is coupled: append the remaining clusters, biggest first.
      clusters.sort((left, right) => right.length - left.length || (left[0] ?? 0) - (right[0] ?? 0));
      return clusters.flat();
    }
    const left = clusters[best.i] ?? [];
    const right = clusters[best.j] ?? [];
    const candidates = [
      [...left, ...right],
      [...left, ...[...right].reverse()],
      [...[...left].reverse(), ...right],
      [...[...left].reverse(), ...[...right].reverse()],
    ];
    let merged = candidates[0] ?? [];
    let bestJunction = -1;
    for (const candidate of candidates) {
      const junction = sim(candidate[left.length - 1] ?? 0, candidate[left.length] ?? 0);
      if (junction > bestJunction) {
        bestJunction = junction;
        merged = candidate;
      }
    }
    clusters = clusters.filter((_, index) => index !== best.i && index !== best.j);
    clusters.splice(best.i, 0, merged);
  }
  return clusters[0] ?? [];
}

function keepTopNTiers(counts: number[], topN: number | undefined, direction: "strongest" | "weakest"): Set<number> {
  const tiers = [...new Set(counts)].sort((a, b) => (direction === "weakest" ? a - b : b - a));
  return new Set(topN === undefined ? tiers : tiers.slice(0, Math.max(0, topN)));
}

/** Builds the DOM-independent seriated matrix model from the pending state. */
export function buildSeriationModel(state: PendingState, options: SeriationOptions = {}): SeriationModel {
  const { components, attractors, forces } = effectiveState(state);
  const sharedComponents = new Map(buildNkpGraphModel(state, { minCouplingStrength: 1 }).nodes
    .filter((node) => node.type === "component")
    .map((node) => [node.id, node]));
  const visibleForces = options.visibleForceIds;
  const isVisibleForce = (force: EffectiveForce): boolean => visibleForces === undefined || visibleForces.has(force.key);
  const isVisibleComponent = (name: string): boolean =>
    options.visibleComponentNames === undefined || options.visibleComponentNames.has(name);
  const hide = options.hideFiltered ?? false;

  const allForcesByComponent = new Map(components.map((component) => [component.name, [] as EffectiveForce[]]));
  for (const force of forces) {
    for (const name of new Set(force.components)) allForcesByComponent.get(name)?.push(force);
  }

  const countedForces = hide ? forces.filter(isVisibleForce) : forces;
  const forcesByComponent = new Map(components.map((component) => [component.name, [] as EffectiveForce[]]));
  for (const force of countedForces) {
    for (const name of new Set(force.components)) forcesByComponent.get(name)?.push(force);
  }

  const summaries = components.map((component) => {
    const attached = forcesByComponent.get(component.name) ?? [];
    const focused = (visibleForces === undefined || attached.some(isVisibleForce)) && isVisibleComponent(component.name);
    const shared = sharedComponents.get(`component:${component.name}`);
    const dominantAttractorId = shared?.dominantAttractorId;
    const allAttached = allForcesByComponent.get(component.name) ?? [];
    return {
      name: component.name,
      status: component.status,
      description: component.description,
      k: attached.length,
      ...(dominantAttractorId ? { dominantAttractorId } : {}),
      color: shared?.color ?? mutedAttractorColor("var(--muted)"),
      fissionCandidate: allAttached.length > (options.fissionThreshold ?? Number.POSITIVE_INFINITY),
      focused,
    } satisfies SeriationComponent;
  });

  // Only components that carry at least one counted force are worth a row;
  // hideFiltered also drops unfocused ones.
  const shown = summaries.filter((item) => item.k > 0 && (!hide || item.focused));
  const indexByName = new Map(shown.map((item, index) => [item.name, index]));

  const shared: EffectiveForce[][][] = shown.map(() => shown.map(() => []));
  for (const force of countedForces) {
    const indices = [...new Set(force.components)]
      .map((name) => indexByName.get(name))
      .filter((index): index is number => index !== undefined);
    for (const a of indices) for (const b of indices) if (a !== b) shared[a]?.[b]?.push(force);
  }

  const similarity = shown.map((left, a) =>
    shown.map((right, b) => {
      const count = shared[a]?.[b]?.length ?? 0;
      return a === b || count === 0 ? 0 : count / Math.sqrt(left.k * right.k);
    }),
  );
  const order = seriate(similarity);
  const ordered = order.map((index) => shown[index]).filter((item): item is (typeof shown)[number] => item !== undefined);

  const minStrength = options.minCouplingStrength ?? DEFAULT_MIN_COUPLING_STRENGTH;
  const rawCells: SeriationCell[] = [];
  order.forEach((originalRow, row) => {
    order.forEach((originalCol, col) => {
      if (row === col) return;
      const cellForces = shared[originalRow]?.[originalCol] ?? [];
      if (cellForces.length === 0 || cellForces.length < minStrength) return;
      const rowItem = ordered[row];
      const colItem = ordered[col];
      rawCells.push({
        row,
        col,
        count: cellForces.length,
        forceKeys: cellForces.map((force) => force.key),
        forces: cellForces.map(forceLabel),
        focused:
          cellForces.some(isVisibleForce) &&
          isVisibleComponent(rowItem?.name ?? "") &&
          isVisibleComponent(colItem?.name ?? ""),
      });
    });
  });
  const tiers = keepTopNTiers(rawCells.map((cell) => cell.count), options.topNCouplings, options.topNDirection ?? "strongest");
  const cells = rawCells.filter((cell) => tiers.has(cell.count) && (!hide || cell.focused));

  const attractorNames = new Map(attractors.map((attractor) => [attractor.id, attractor.name]));
  const colors = attractorColors(state);
  const legend = new Map<string, SeriationAttractor>();
  for (const item of ordered) {
    if (!item.dominantAttractorId) continue;
    const entry = legend.get(item.dominantAttractorId) ?? {
      id: item.dominantAttractorId,
      name: attractorNames.get(item.dominantAttractorId) ?? item.dominantAttractorId,
      color: colors.get(item.dominantAttractorId) ?? "var(--muted)",
      componentCount: 0,
    };
    entry.componentCount += 1;
    legend.set(entry.id, entry);
  }

  return {
    components: ordered,
    cells,
    maxCount: cells.reduce((max, cell) => Math.max(max, cell.count), 0),
    maxK: ordered.reduce((max, item) => Math.max(max, item.k), 0),
    attractors: [...legend.values()],
  };
}

const CELL = 18;
const STRIPE = 6;
const LABEL_WIDTH = 170;
const HEADER_HEIGHT = 150;
export const MIRROR_DIM_OPACITY = 0.5;

export function cellHalf(row: number, col: number): "upper" | "lower" | "diagonal" {
  if (col > row) return "upper";
  if (col < row) return "lower";
  return "diagonal";
}

export interface SeriationRenderOptions extends SeriationOptions {
  /** Print the shared-force count inside each cell. */
  showCounts?: boolean;
}

export interface HeatmapViewCtx {
  host: HTMLElement;
  d3: any;
  onToggle: (key: EntityKey) => void;
  onClear: () => void;
}

export interface HeatmapViewHandle {
  update: (state: PendingState, options?: Record<string, unknown>) => void;
  setSelection: (selected: ReadonlySet<EntityKey>, connected: ReadonlySet<EntityKey>) => void;
  resetView: () => void;
  destroy: () => void;
}

export function createHeatmapView(ctx: HeatmapViewCtx): HeatmapViewHandle {
  const { host, d3 } = ctx;
  let built:
    | {
        svg: any;
        zoom: any;
        root: any;
        labelsGroup: any;
        tip: HTMLElement;
        frame: any;
        rowBand: any;
        colBand: any;
        cellLayer: any;
        diagonalLayer: any;
        rowHeadersLayer: any;
        colHeadersLayer: any;
        legend?: HTMLElement;
        rowHeaders?: any;
        colHeaders?: any;
        diagonal?: any;
        cells?: any;
      }
    | undefined;
  let indexByName = new Map<string, number>();
  let componentByIndex = new Map<number, SeriationComponent>();
  let lastModel: SeriationModel | undefined;
  let pinnedMirrorHalf: "upper" | "lower" | undefined;
  let hoverMirrorHalf: "upper" | "lower" | undefined;
  let lastSelected: ReadonlySet<EntityKey> = new Set();
  let lastConnected: ReadonlySet<EntityKey> = new Set();

  function destroy(): void {
    built = undefined;
    host.replaceChildren();
  }

  function ensureBuilt(): NonNullable<typeof built> {
    if (built) return built;
    const { svg, content, zoom } = appendZoomableSvg(
      host,
      d3,
      { x: 0, y: 0, width: 2, height: 2 },
      "nkp-seriation-svg",
      "Component coupling heatmap, rows ordered so tightly coupled components sit together",
    );
    const root = content.append("g");
    const frame = root.append("rect").attr("class", "nkp-seriation-frame");
    const rowBand = root.append("rect").attr("class", "nkp-seriation-band").attr("visibility", "hidden");
    const colBand = root.append("rect").attr("class", "nkp-seriation-band").attr("visibility", "hidden");
    const cellLayer = root.append("g");
    const diagonalLayer = root.append("g");
    const rowHeadersLayer = root.append("g");
    const colHeadersLayer = root.append("g");
    const labelsGroup = svg.append("g").attr("class", "landscape-labels");
    zoom.on("zoom.labels", (event: { transform: unknown }) => labelsGroup.attr("transform", event.transform));
    svg.on("dblclick", () => ctx.onClear());
    built = { svg, zoom, root, labelsGroup, tip: createTooltip(host), frame, rowBand, colBand, cellLayer, diagonalLayer, rowHeadersLayer, colHeadersLayer };
    return built;
  }

  const intensity = (value: number, max: number): number => (max <= 0 ? 0 : 0.18 + 0.82 * (value / max));

  function showTooltip(event: MouseEvent, lines: string[]): void {
    const b = built;
    if (!b) return;
    b.tip.replaceChildren(...lines.map((line, index) => {
      const element = document.createElement(index === 0 ? "strong" : "div");
      element.textContent = line;
      return element;
    }));
    placeTooltip(host, b.tip, event);
  }

  function hideTooltip(): void {
    if (!built) return;
    built.tip.hidden = true;
  }

  function clearHover(): void {
    hideTooltip();
    hoverMirrorHalf = undefined;
    applyMirrorClasses();
    applyHeaderBands(undefined, undefined);
  }

  function applyHeaderBands(row: number | undefined, col: number | undefined): void {
    if (!built) return;
    const activeRow = row;
    const activeCol = col;
    const n = lastModel?.components.length ?? 0;
    built.rowBand
      .attr("visibility", activeRow === undefined ? "hidden" : "visible")
      .attr("y", (activeRow ?? 0) * CELL)
      .attr("width", n * CELL)
      .attr("height", CELL);
    built.colBand
      .attr("visibility", activeCol === undefined ? "hidden" : "visible")
      .attr("x", (activeCol ?? 0) * CELL)
      .attr("width", CELL)
      .attr("height", n * CELL);
    built.rowHeaders?.classed("is-active", (item: SeriationComponent) => indexByName.get(item.name) === activeRow);
    built.colHeaders?.classed("is-active", (item: SeriationComponent) => indexByName.get(item.name) === activeCol);
  }

  function applyMirrorClasses(): void {
    const b = built;
    if (!b) return;
    const active = hoverMirrorHalf ?? pinnedMirrorHalf;
    b.cells?.classed("mirror-dim", (item: SeriationCell) => {
      if (!active) return false;
      const half = cellHalf(item.row, item.col);
      if (half === "diagonal") return false;
      return active === "upper" ? half === "lower" : half === "upper";
    });
  }

  function applySelectionClasses(): void {
    const b = built;
    if (!b) return;
    const hasSelection = lastSelected.size > 0;
    const keyState = (keys: readonly EntityKey[]): "selected" | "connected" | "dim" | "none" => {
      const isSelected = keys.some((key) => lastSelected.has(key));
      if (isSelected) return "selected";
      const isConnected = keys.some((key) => lastConnected.has(key));
      if (isConnected) return "connected";
      return hasSelection ? "dim" : "none";
    };
    const setState = (selection: any, keysFor: (item: any) => readonly EntityKey[]): void => {
      if (!selection) return;
      selection
        .classed("selected", (item: any) => keyState(keysFor(item)) === "selected")
        .classed("connected", (item: any) => keyState(keysFor(item)) === "connected")
        .classed("dim", (item: any) => keyState(keysFor(item)) === "dim");
    };
    setState(b.rowHeaders, (item: SeriationComponent) => [`component:${item.name}` as EntityKey]);
    setState(b.colHeaders, (item: SeriationComponent) => [`component:${item.name}` as EntityKey]);
    setState(b.diagonal, (item: SeriationComponent) => [`component:${item.name}` as EntityKey]);
    setState(b.cells, (item: SeriationCell) => item.forceKeys.map((key) => `force:${key}` as EntityKey));
    if (b.legend) {
      for (const item of Array.from(b.legend.querySelectorAll<HTMLElement>("[data-legend-id]"))) {
        const key = `attractor:${item.dataset.legendId ?? ""}` as EntityKey;
        const state = keyState([key]);
        item.classList.toggle("selected", state === "selected");
        item.classList.toggle("connected", state === "connected");
        item.classList.toggle("dim", state === "dim");
        item.style.opacity = state === "dim" ? "0" : "";
      }
    }
    b.labelsGroup.selectAll("text.nkp-seriation-label")
      .attr("opacity", (item: { entityKey?: EntityKey }) =>
        item.entityKey && keyState([item.entityKey]) === "dim" ? 0 : 1);
  }

  function componentLines(item: SeriationComponent): string[] {
    return [
      item.name,
      `K = ${item.k} force${item.k === 1 ? "" : "s"}${item.fissionCandidate ? " (fission candidate)" : ""}`,
      `Status: ${item.status}`,
      `Dominant attractor: ${lastModel?.attractors.find((attractor) => attractor.id === item.dominantAttractorId)?.name ?? "none"}`,
    ];
  }

  function renderLegendForModel(model: SeriationModel): void {
    const b = ensureBuilt();
    b.legend?.remove();
    const fissionKey = document.createElement("span");
    fissionKey.className = "landscape-legend-item landscape-legend-warn";
    fissionKey.textContent = "▲ fission candidate";
    const legend = renderLegend(
      host,
      "Stripe = main attractor",
      model.attractors.map((attractor) => ({ id: attractor.id, label: `${attractor.name} (${attractor.componentCount})`, color: attractor.color })),
      [fissionKey],
    );
    host.insertBefore(legend, b.svg.node());
    b.legend = legend;
    for (const item of Array.from(legend.querySelectorAll<HTMLElement>("[data-legend-id]"))) {
      const id = item.dataset.legendId ?? "";
      item.setAttribute("aria-label", `Attractor ${model.attractors.find((attractor) => attractor.id === id)?.name ?? id}`);
      item.tabIndex = 0;
      const reveal = (event: Event): void => {
        const attractor = model.attractors.find((candidate) => candidate.id === id);
        showTooltip(event as MouseEvent, [attractor?.name ?? id, `${attractor?.componentCount ?? 0} components`]);
      };
      item.addEventListener("mouseenter", reveal);
      item.addEventListener("focus", reveal);
      item.addEventListener("mouseleave", hideTooltip);
      item.addEventListener("blur", hideTooltip);
      item.addEventListener("click", () => {
        const selectedId = item.dataset.legendId;
        if (selectedId) ctx.onToggle(`attractor:${selectedId}` as EntityKey);
      });
    }
  }

  function update(state: PendingState, rawOptions: Record<string, unknown> = {}): void {
    const options = rawOptions as SeriationRenderOptions;
    const model = buildSeriationModel(state, options);
    const showCounts = options.showCounts ?? true;
    if (model.components.length === 0) {
      if (!built) {
        renderEmpty(host, "No coupled components to show. Loosen the filters or lower the minimum coupling strength.");
        return;
      }
      const b = ensureBuilt();
      b.legend?.remove();
      b.legend = undefined;
      b.cellLayer.selectAll("g.nkp-seriation-cell").data([]).join("g");
      b.diagonalLayer.selectAll("g.nkp-seriation-diagonal").data([]).join("g");
      b.rowHeadersLayer.selectAll("g.nkp-seriation-header.row").data([]).join("g");
      b.colHeadersLayer.selectAll("g.nkp-seriation-header.col").data([]).join("g");
      b.labelsGroup.selectAll("text").data([]).join("text");
      b.labelsGroup.selectAll("g.nkp-seriation-label-anchor").remove();
      hideTooltip();
      return;
    }
    if (host.querySelector(".landscape-empty")) host.replaceChildren();
    const b = ensureBuilt();
    renderLegendForModel(model);
    lastModel = model;
    indexByName = new Map(model.components.map((item, index) => [item.name, index]));
    componentByIndex = new Map(model.components.map((item, index) => [index, item]));

    const n = model.components.length;
    const width = LABEL_WIDTH + STRIPE + n * CELL + 8;
    const height = HEADER_HEIGHT + STRIPE + n * CELL + 8;
    const gridX = LABEL_WIDTH + STRIPE;
    const gridY = HEADER_HEIGHT + STRIPE;
    b.svg.attr("viewBox", `0 0 ${width} ${height}`);
    b.root.attr("transform", `translate(${gridX},${gridY})`);
    b.frame.attr("width", n * CELL).attr("height", n * CELL);

    const cellSelection = b.cellLayer
      .selectAll("g.nkp-seriation-cell")
      .data(model.cells, (item: SeriationCell) => `${item.row}:${item.col}`)
      .join((enter: any) => {
        const g = enter.append("g").attr("class", "nkp-seriation-cell");
        g.append("rect");
        return g;
      })
      .attr("transform", (item: SeriationCell) => `translate(${item.col * CELL},${item.row * CELL})`)
      .attr("data-cell-row", (item: SeriationCell) => String(item.row))
      .attr("data-cell-col", (item: SeriationCell) => String(item.col));
    cellSelection.attr("aria-label", (item: SeriationCell) => {
      const rowName = model.components[item.row]?.name ?? "unknown";
      const colName = model.components[item.col]?.name ?? "unknown";
      return `${rowName} and ${colName}: ${item.count} shared forces`;
    }).attr("tabindex", 0);
    cellSelection.select("rect")
      .attr("class", (item: SeriationCell) => `nkp-seriation-heat${item.focused ? "" : " is-faded"}`)
      .attr("width", CELL - 1)
      .attr("height", CELL - 1)
      .attr("fill-opacity", (item: SeriationCell) => intensity(item.count, model.maxCount));
    b.cells = cellSelection;

    const diagonalSelection = b.diagonalLayer
      .selectAll("g.nkp-seriation-diagonal")
      .data(model.components, (item: SeriationComponent) => item.name)
      .join((enter: any) => {
        const g = enter.append("g").attr("class", "nkp-seriation-diagonal");
        g.append("rect").attr("class", "nkp-seriation-diag");
        return g;
      })
      .attr("transform", (item: SeriationComponent) => `translate(${(indexByName.get(item.name) ?? 0) * CELL},${(indexByName.get(item.name) ?? 0) * CELL})`)
      .attr("data-diagonal-index", (item: SeriationComponent) => String(indexByName.get(item.name) ?? 0));
    diagonalSelection.attr("aria-label", (item: SeriationComponent) => componentLines(item).join(". ")).attr("tabindex", 0);
    diagonalSelection.select("rect")
      .attr("width", CELL - 1)
      .attr("height", CELL - 1)
      .attr("fill-opacity", (item: SeriationComponent) => intensity(item.k, model.maxK) * (item.focused ? 1 : 0.3));
    b.diagonal = diagonalSelection;

    const rowHeaders = b.rowHeadersLayer
      .selectAll("g.nkp-seriation-header.row")
      .data(model.components, (item: SeriationComponent) => item.name)
      .join((enter: any) => {
        const g = enter.append("g").attr("class", "nkp-seriation-header row");
        g.append("rect").attr("class", "nkp-seriation-hit");
        g.append("rect").attr("class", "nkp-seriation-stripe");
        g.append("circle").attr("class", "nkp-component-status-glyph").attr("r", 4);
        g.append("rect").attr("class", "nkp-component-status-glyph").attr("width", 8).attr("height", 8);
        return g;
      })
      .attr("transform", (item: SeriationComponent) => `translate(${-gridX},${(indexByName.get(item.name) ?? 0) * CELL})`)
      .attr("data-header-axis", "row")
      .attr("data-header-index", (item: SeriationComponent) => String(indexByName.get(item.name) ?? 0))
      .attr("aria-label", (item: SeriationComponent) => componentLines(item).join(". "))
      .attr("tabindex", 0);
    rowHeaders.select(".nkp-seriation-hit")
      .attr("width", LABEL_WIDTH + STRIPE)
      .attr("height", CELL);
    rowHeaders.select(".nkp-seriation-stripe")
      .attr("x", LABEL_WIDTH)
      .attr("width", STRIPE - 1)
      .attr("height", CELL - 1)
      .attr("fill", (item: SeriationComponent) => item.color);
    rowHeaders.select("circle")
      .attr("cx", 8).attr("cy", CELL / 2)
      .attr("data-component-status-shape", (item: SeriationComponent) => item.status === "actual" ? "actual" : null)
      .attr("display", (item: SeriationComponent) => item.status === "actual" ? null : "none")
      .attr("fill", (item: SeriationComponent) => item.color);
    rowHeaders.select("rect.nkp-component-status-glyph")
      .attr("x", 4).attr("y", CELL / 2 - 4)
      .attr("data-component-status-shape", (item: SeriationComponent) => item.status === "proposed" ? "proposed" : null)
      .attr("display", (item: SeriationComponent) => item.status === "proposed" ? null : "none")
      .attr("fill", (item: SeriationComponent) => item.color);
    b.rowHeaders = rowHeaders;

    const colHeaders = b.colHeadersLayer
      .selectAll("g.nkp-seriation-header.col")
      .data(model.components, (item: SeriationComponent) => item.name)
      .join((enter: any) => {
        const g = enter.append("g").attr("class", "nkp-seriation-header col");
        g.append("rect").attr("class", "nkp-seriation-hit");
        g.append("rect").attr("class", "nkp-seriation-stripe");
        g.append("circle").attr("class", "nkp-component-status-glyph").attr("r", 4);
        g.append("rect").attr("class", "nkp-component-status-glyph").attr("width", 8).attr("height", 8);
        return g;
      })
      .attr("transform", (item: SeriationComponent) => `translate(${(indexByName.get(item.name) ?? 0) * CELL},${-gridY})`)
      .attr("data-header-axis", "col")
      .attr("data-header-index", (item: SeriationComponent) => String(indexByName.get(item.name) ?? 0))
      .attr("aria-label", (item: SeriationComponent) => componentLines(item).join(". "))
      .attr("tabindex", 0);
    colHeaders.select(".nkp-seriation-hit")
      .attr("width", CELL)
      .attr("height", HEADER_HEIGHT + STRIPE);
    colHeaders.select(".nkp-seriation-stripe")
      .attr("y", HEADER_HEIGHT)
      .attr("width", CELL - 1)
      .attr("height", STRIPE - 1)
      .attr("fill", (item: SeriationComponent) => item.color);
    colHeaders.select("circle")
      .attr("cx", CELL / 2).attr("cy", HEADER_HEIGHT - 8)
      .attr("data-component-status-shape", (item: SeriationComponent) => item.status === "actual" ? "actual" : null)
      .attr("display", (item: SeriationComponent) => item.status === "actual" ? null : "none")
      .attr("fill", (item: SeriationComponent) => item.color);
    colHeaders.select("rect.nkp-component-status-glyph")
      .attr("x", CELL / 2 - 4).attr("y", HEADER_HEIGHT - 12)
      .attr("data-component-status-shape", (item: SeriationComponent) => item.status === "proposed" ? "proposed" : null)
      .attr("display", (item: SeriationComponent) => item.status === "proposed" ? null : "none")
      .attr("fill", (item: SeriationComponent) => item.color);
    b.colHeaders = colHeaders;

    const countClass = (count: number): string =>
      `nkp-seriation-count${intensity(count, model.maxCount) > 0.6 ? " nkp-seriation-count-strong" : ""}`;
    const textData: Array<{ id: string; className: string; x: number; y: number; transform?: string; text: string; entityKey?: EntityKey }> = [];
    if (showCounts) {
      for (const item of model.components) {
        const index = indexByName.get(item.name) ?? 0;
        textData.push({
          id: `diag:${item.name}`,
          className: "nkp-seriation-count nkp-seriation-count-strong",
          x: gridX + index * CELL + CELL / 2,
          y: gridY + index * CELL + CELL / 2,
          text: String(item.k),
        });
      }
      for (const item of model.cells) {
        textData.push({
          id: `cell:${item.row}:${item.col}`,
          className: countClass(item.count),
          x: gridX + item.col * CELL + CELL / 2,
          y: gridY + item.row * CELL + CELL / 2,
          text: String(item.count),
        });
      }
    }
    for (const item of model.components) {
      const index = indexByName.get(item.name) ?? 0;
      textData.push({
        id: `row:${item.name}`,
        className: headerClass(item),
        x: LABEL_WIDTH - 4,
        y: gridY + index * CELL + CELL / 2,
        text: headerLabel(item),
        entityKey: `component:${item.name}` as EntityKey,
      });
      textData.push({
        id: `col:${item.name}`,
        className: headerClass(item),
        x: gridX + index * CELL + CELL / 2,
        y: HEADER_HEIGHT - 4,
        transform: `rotate(-60 ${gridX + index * CELL + CELL / 2} ${HEADER_HEIGHT - 4})`,
        text: headerLabel(item),
        entityKey: `component:${item.name}` as EntityKey,
      });
    }
    b.labelsGroup.selectAll("text")
      .data(textData, (item: any) => item.id)
      .join("text")
      .attr("class", (item: any) => item.className)
      .attr("x", (item: any) => item.x)
      .attr("y", (item: any) => item.y)
      .attr("transform", (item: any) => item.transform ?? null)
      .attr("text-anchor", (item: any) => (item.id.startsWith("row:") ? "end" : "middle"))
      .text((item: any) => item.text)
      .each(function (this: SVGTextElement, item: { id: string }) {
        if (!item.id.startsWith("row:") && !item.id.startsWith("col:")) return;
        const axis = item.id.startsWith("row:") ? "row" : "col";
        const name = item.id.slice(4);
        let wrapper = this.parentElement;
        if (!wrapper?.classList.contains("nkp-seriation-label-anchor")) {
          wrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
          wrapper.classList.add("nkp-seriation-label-anchor");
          this.parentNode?.insertBefore(wrapper, this);
          wrapper.appendChild(this);
        }
        wrapper.setAttribute("data-header-axis", axis);
        wrapper.setAttribute("data-header-index", String(indexByName.get(name) ?? 0));
        wrapper.setAttribute("aria-label", `${axis === "row" ? "Row" : "Column"} label ${name}`);
      });
    b.labelsGroup.selectAll("g.nkp-seriation-label-anchor")
      .filter(function (this: SVGGElement) { return this.querySelector("text") === null; })
      .remove();

    cellSelection
      .on("mousemove", (event: MouseEvent, item: SeriationCell) => {
        const half = cellHalf(item.row, item.col);
        hoverMirrorHalf = half === "diagonal" ? undefined : half;
        applyMirrorClasses();
        applyHeaderBands(item.row, item.col);
        const rowName = componentByIndex.get(item.row)?.name ?? "";
        const colName = componentByIndex.get(item.col)?.name ?? "";
        showTooltip(event, [`${rowName} × ${colName}: ${item.count} shared`, ...item.forces]);
      })
      .on("focus", (event: MouseEvent, item: SeriationCell) => {
        const rowName = componentByIndex.get(item.row)?.name ?? "";
        const colName = componentByIndex.get(item.col)?.name ?? "";
        showTooltip(event, [`${rowName} × ${colName}: ${item.count} shared`, ...item.forces]);
      })
      .on("mouseleave blur", clearHover)
      .on("click", (_event: MouseEvent, item: SeriationCell) => {
        for (const key of item.forceKeys) ctx.onToggle(`force:${key}` as EntityKey);
        const half = cellHalf(item.row, item.col);
        if (half !== "diagonal") pinnedMirrorHalf = half;
        applyMirrorClasses();
      });

    diagonalSelection
      .on("mousemove", (event: MouseEvent, item: SeriationComponent) => {
        const index = indexByName.get(item.name);
        applyHeaderBands(index, index);
        showTooltip(event, componentLines(item));
      })
      .on("focus", (event: MouseEvent, item: SeriationComponent) => showTooltip(event, componentLines(item)))
      .on("mouseleave blur", clearHover)
      .on("click", (_event: MouseEvent, item: SeriationComponent) => ctx.onToggle(`component:${item.name}` as EntityKey));

    const headerHandlers = (selection: any): void => {
      selection
        .on("mousemove", (event: MouseEvent, item: SeriationComponent) => {
          const index = indexByName.get(item.name);
          applyHeaderBands(index, index);
          showTooltip(event, componentLines(item));
        })
        .on("focus", (event: MouseEvent, item: SeriationComponent) => showTooltip(event, componentLines(item)))
        .on("mouseleave blur", clearHover)
        .on("click", (_event: MouseEvent, item: SeriationComponent) => ctx.onToggle(`component:${item.name}` as EntityKey));
    };
    headerHandlers(rowHeaders);
    headerHandlers(colHeaders);

    applyHeaderBands(undefined, undefined);
    applyMirrorClasses();
    applySelectionClasses();
  }

  function setSelection(selected: ReadonlySet<EntityKey>, connected: ReadonlySet<EntityKey>): void {
    lastSelected = selected;
    lastConnected = connected;
    if (selected.size === 0) {
      pinnedMirrorHalf = undefined;
      hoverMirrorHalf = undefined;
    }
    applySelectionClasses();
    applyMirrorClasses();
  }

  function resetView(): void {
    if (!built) return;
    resetZoom(built.svg, built.zoom, d3);
  }

  return { update, setSelection, resetView, destroy };
}

function headerLabel(item: SeriationComponent): string {
  const name = item.name.length > 24 ? `${item.name.slice(0, 23)}…` : item.name;
  return item.fissionCandidate ? `▲ ${name}` : name;
}

function headerClass(item: SeriationComponent): string {
  return [
    "nkp-seriation-label",
    item.fissionCandidate ? "is-fission" : "",
    item.status === "proposed" ? "is-proposed" : "",
    item.focused ? "" : "is-faded",
  ].filter(Boolean).join(" ");
}
