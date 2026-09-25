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
  effectiveState,
  forceLabel,
  type EffectiveForce,
} from "./nkp-graph";
import { appendZoomableSvg, createTooltip, placeTooltip, renderEmpty, renderLegend } from "./landscape-dom";

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
  fissionCandidate: boolean;
  focused: boolean;
}

export interface SeriationCell {
  /** Indices into `components` (display order). Both halves of the symmetric matrix are emitted. */
  row: number;
  col: number;
  count: number;
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
    const perAttractor = new Map<string, number>();
    for (const force of attached) perAttractor.set(force.attractorId, (perAttractor.get(force.attractorId) ?? 0) + 1);
    let dominantAttractorId: string | undefined;
    let dominantCount = 0;
    for (const [id, count] of [...perAttractor].sort(([a], [b]) => a.localeCompare(b))) {
      if (count > dominantCount) {
        dominantAttractorId = id;
        dominantCount = count;
      }
    }
    const allAttached = allForcesByComponent.get(component.name) ?? [];
    return {
      name: component.name,
      status: component.status,
      description: component.description,
      k: attached.length,
      ...(dominantAttractorId ? { dominantAttractorId } : {}),
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

export interface SeriationRenderOptions extends SeriationOptions {
  /** Print the shared-force count inside each cell. */
  showCounts?: boolean;
}

/** Renders the seriated matrix into `host` (replacing its contents), fitted to the viewport. */
export function renderNkpSeriation(host: HTMLElement, state: PendingState, options: SeriationRenderOptions, d3: any): void {
  host.replaceChildren();
  const model = buildSeriationModel(state, options);
  const showCounts = options.showCounts ?? true;
  if (model.components.length === 0) {
    renderEmpty(host, "No coupled components to show. Loosen the filters or lower the minimum coupling strength.");
    return;
  }

  const fissionKey = document.createElement("span");
  fissionKey.className = "landscape-legend-item landscape-legend-warn";
  fissionKey.textContent = "▲ fission candidate";
  renderLegend(
    host,
    "Stripe = main attractor",
    model.attractors.map((attractor) => ({ id: attractor.id, label: `${attractor.name} (${attractor.componentCount})`, color: attractor.color })),
    [fissionKey],
  );

  const n = model.components.length;
  const colorFor = new Map(model.attractors.map((attractor) => [attractor.id, attractor.color]));
  const width = LABEL_WIDTH + STRIPE + n * CELL + 8;
  const height = HEADER_HEIGHT + STRIPE + n * CELL + 8;
  const gridX = LABEL_WIDTH + STRIPE;
  const gridY = HEADER_HEIGHT + STRIPE;

  const { content: svg } = appendZoomableSvg(
    host,
    d3,
    { x: 0, y: 0, width, height },
    "nkp-seriation-svg",
    "Component coupling heatmap, rows ordered so tightly coupled components sit together",
  );
  const tooltip = createTooltip(host);

  const grid = svg.append("g").attr("transform", `translate(${gridX},${gridY})`);
  grid.append("rect").attr("class", "nkp-seriation-frame")
    .attr("width", n * CELL).attr("height", n * CELL);

  const intensity = (value: number, max: number): number => (max <= 0 ? 0 : 0.18 + 0.82 * (value / max));

  const diagonal = grid.append("g").selectAll("g").data(model.components).join("g")
    .attr("transform", (_: SeriationComponent, index: number) => `translate(${index * CELL},${index * CELL})`);
  diagonal.append("rect").attr("class", "nkp-seriation-diag")
    .attr("width", CELL - 1).attr("height", CELL - 1)
    .attr("fill-opacity", (item: SeriationComponent) => intensity(item.k, model.maxK) * (item.focused ? 1 : 0.4));
  if (showCounts) diagonal.append("text").attr("class", "nkp-seriation-count nkp-seriation-count-strong")
    .attr("x", CELL / 2).attr("y", CELL / 2).text((item: SeriationComponent) => item.k);

  const cell = grid.append("g").selectAll("g").data(model.cells).join("g")
    .attr("class", "nkp-seriation-cell")
    .attr("transform", (item: SeriationCell) => `translate(${item.col * CELL},${item.row * CELL})`);
  cell.append("rect")
    .attr("class", (item: SeriationCell) => `nkp-seriation-heat${item.focused ? "" : " is-faded"}`)
    .attr("width", CELL - 1).attr("height", CELL - 1)
    .attr("fill-opacity", (item: SeriationCell) => intensity(item.count, model.maxCount));
  if (showCounts) cell.append("text")
    .attr("class", (item: SeriationCell) =>
      `nkp-seriation-count${intensity(item.count, model.maxCount) > 0.6 ? " nkp-seriation-count-strong" : ""}`)
    .attr("x", CELL / 2).attr("y", CELL / 2).text((item: SeriationCell) => item.count);

  const rowBand = grid.append("rect").attr("class", "nkp-seriation-band").attr("width", n * CELL).attr("height", CELL).attr("visibility", "hidden");
  const colBand = grid.append("rect").attr("class", "nkp-seriation-band").attr("width", CELL).attr("height", n * CELL).attr("visibility", "hidden");

  const rowHeaders = svg.append("g").selectAll("g").data(model.components).join("g")
    .attr("class", "nkp-seriation-header")
    .attr("transform", (_: SeriationComponent, index: number) => `translate(0,${gridY + index * CELL})`);
  rowHeaders.append("rect").attr("class", "nkp-seriation-hit").attr("width", LABEL_WIDTH + STRIPE).attr("height", CELL);
  rowHeaders.append("rect").attr("x", LABEL_WIDTH).attr("width", STRIPE - 1).attr("height", CELL - 1)
    .attr("fill", (item: SeriationComponent) => colorFor.get(item.dominantAttractorId ?? "") ?? "var(--line)");
  rowHeaders.append("text")
    .attr("class", (item: SeriationComponent) => headerClass(item))
    .attr("x", LABEL_WIDTH - 4).attr("y", CELL / 2).attr("text-anchor", "end")
    .text((item: SeriationComponent) => headerLabel(item));

  const colHeaders = svg.append("g").selectAll("g").data(model.components).join("g")
    .attr("class", "nkp-seriation-header")
    .attr("transform", (_: SeriationComponent, index: number) => `translate(${gridX + index * CELL},0)`);
  colHeaders.append("rect").attr("class", "nkp-seriation-hit").attr("width", CELL).attr("height", HEADER_HEIGHT + STRIPE);
  colHeaders.append("rect").attr("y", HEADER_HEIGHT).attr("width", CELL - 1).attr("height", STRIPE - 1)
    .attr("fill", (item: SeriationComponent) => colorFor.get(item.dominantAttractorId ?? "") ?? "var(--line)");
  colHeaders.append("text")
    .attr("class", (item: SeriationComponent) => headerClass(item))
    .attr("transform", `translate(${CELL / 2},${HEADER_HEIGHT - 4}) rotate(-60)`)
    .text((item: SeriationComponent) => headerLabel(item));

  let pinned: number | undefined;
  const highlight = (row: number | undefined, col: number | undefined): void => {
    const effectiveRow = row ?? pinned;
    const effectiveCol = col ?? pinned;
    rowBand.attr("visibility", effectiveRow === undefined ? "hidden" : "visible").attr("y", (effectiveRow ?? 0) * CELL);
    colBand.attr("visibility", effectiveCol === undefined ? "hidden" : "visible").attr("x", (effectiveCol ?? 0) * CELL);
    rowHeaders.classed("is-active", (_: SeriationComponent, index: number) => index === effectiveRow);
    colHeaders.classed("is-active", (_: SeriationComponent, index: number) => index === effectiveCol);
  };
  const showTooltip = (event: MouseEvent, lines: string[]): void => {
    tooltip.replaceChildren(...lines.map((line, index) => {
      const element = document.createElement(index === 0 ? "strong" : "div");
      element.textContent = line;
      return element;
    }));
    placeTooltip(host, tooltip, event);
  };
  const hideTooltip = (): void => {
    tooltip.hidden = true;
    highlight(undefined, undefined);
  };
  const componentLines = (item: SeriationComponent): string[] => [
    item.name,
    `K = ${item.k} force${item.k === 1 ? "" : "s"}${item.fissionCandidate ? " (fission candidate)" : ""}`,
    `Status: ${item.status}`,
    `Dominant attractor: ${model.attractors.find((a) => a.id === item.dominantAttractorId)?.name ?? "none"}`,
  ];

  cell.on("mousemove", (event: MouseEvent, item: SeriationCell) => {
    highlight(item.row, item.col);
    const rowName = model.components[item.row]?.name ?? "";
    const colName = model.components[item.col]?.name ?? "";
    showTooltip(event, [`${rowName} × ${colName}: ${item.count} shared`, ...item.forces]);
  }).on("mouseleave", hideTooltip);
  diagonal.on("mousemove", (event: MouseEvent, item: SeriationComponent) => {
    const index = model.components.indexOf(item);
    highlight(index, index);
    showTooltip(event, componentLines(item));
  }).on("mouseleave", hideTooltip);
  const headerHandlers = (selection: any): void => {
    selection.on("mousemove", (event: MouseEvent, item: SeriationComponent) => {
      const index = model.components.indexOf(item);
      highlight(index, index);
      showTooltip(event, componentLines(item));
    }).on("mouseleave", hideTooltip)
      .on("click", (_event: MouseEvent, item: SeriationComponent) => {
        const index = model.components.indexOf(item);
        pinned = pinned === index ? undefined : index;
        highlight(undefined, undefined);
      });
  };
  headerHandlers(rowHeaders);
  headerHandlers(colHeaders);
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
