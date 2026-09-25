// Radial hierarchical edge bundling (Holten 2006) for the live NKP graph.
//
// Hierarchy: root -> attractor -> component. Each component sits under its
// dominant attractor (the one contributing most of its forces), components
// are laid out on a circle grouped into per-attractor arcs, and the
// component-component coupling edges from buildNkpGraphModel are routed
// through that hierarchy with d3.curveBundle so related couplings share a
// path instead of forming a hairball.
//
// The pure model (buildNkpBundleModel and helpers) is DOM-free and unit
// tested in nkp-bundle.test.ts; renderNkpBundle draws it with the d3 module
// the page passes in (mounted by nkp-landscape.ts).

import { attractorColors, buildNkpGraphModel, type NkpGraphEdge, type NkpGraphOptions } from "./nkp-graph";
import type { PendingState } from "./model";
import { appendZoomableSvg, createTooltip, escapeHtml, placeTooltip, renderEmpty } from "./landscape-dom";

export const UNASSIGNED_GROUP_ID = "unassigned";
/** Attractors that would own fewer components than this fold into their members' next-best attractor. */
export const DEFAULT_MIN_GROUP_SIZE = 2;
export const DEFAULT_BUNDLE_TENSION = 0.85;

export interface NkpBundleOptions extends NkpGraphOptions {
  minGroupSize?: number;
}

export interface BundleLeaf {
  /** Graph node id, e.g. `component:auth`. */
  id: string;
  label: string;
  groupId: string;
  status?: "actual" | "proposed";
  tooltip: string;
  focused: boolean;
  fissionCandidate: boolean;
  /** Name of the attractor contributing most of this leaf's forces, even when it sits in another group. */
  dominantLabel: string;
}

export interface BundleGroup {
  /** Graph node id of the attractor (`attractor:A-01`) or UNASSIGNED_GROUP_ID. */
  id: string;
  label: string;
  tooltip: string;
  color: string;
  /** Leaves in placement order around the circle. */
  leaves: BundleLeaf[];
}

export interface BundleEdge {
  id: string;
  source: string;
  target: string;
  count: number;
  stressors: string[];
  tooltip: string;
  focused: boolean;
  /** Also a fusion candidate pair (identical coupling vectors). */
  fusion: boolean;
}

export interface NkpBundleModel {
  /** Groups in placement order around the circle. */
  groups: BundleGroup[];
  edges: BundleEdge[];
  maxCount: number;
}

/**
 * Picks each component's dominant attractor from attractor->component edges:
 * highest shared-force count wins, ties go to the lexically smallest
 * attractor id so the layout is deterministic.
 */
export function dominantAttractors(edges: readonly NkpGraphEdge[]): Map<string, string> {
  const best = new Map<string, { attractor: string; count: number }>();
  for (const edge of edges) {
    if (edge.type !== "attractor") continue;
    const current = best.get(edge.target);
    if (
      !current ||
      edge.count > current.count ||
      (edge.count === current.count && edge.source < current.attractor)
    ) {
      best.set(edge.target, { attractor: edge.source, count: edge.count });
    }
  }
  return new Map([...best].map(([component, { attractor }]) => [component, attractor]));
}

/**
 * Places each component under an attractor group. Starts from the dominant
 * attractor; any attractor left owning fewer than `minGroupSize` components
 * is dissolved, and its members move to the attractor, among those big
 * enough, that they share the most forces with (ties to the smallest id).
 * Members with no such attractor go to the unassigned group. When no
 * attractor is big enough, the dominant assignment stands.
 */
export function assignGroups(edges: readonly NkpGraphEdge[], minGroupSize: number): Map<string, string> {
  const dominant = dominantAttractors(edges);
  const sizes = new Map<string, number>();
  for (const attractor of dominant.values()) sizes.set(attractor, (sizes.get(attractor) ?? 0) + 1);
  const bigEnough = (attractor: string): boolean => (sizes.get(attractor) ?? 0) >= minGroupSize;
  if (minGroupSize <= 1 || ![...sizes.keys()].some(bigEnough)) return dominant;

  const assigned = new Map<string, string>();
  for (const [componentId, attractor] of dominant) {
    if (bigEnough(attractor)) {
      assigned.set(componentId, attractor);
      continue;
    }
    let best: { attractor: string; count: number } | undefined;
    for (const edge of edges) {
      if (edge.type !== "attractor" || edge.target !== componentId || !bigEnough(edge.source)) continue;
      if (!best || edge.count > best.count || (edge.count === best.count && edge.source < best.attractor)) {
        best = { attractor: edge.source, count: edge.count };
      }
    }
    assigned.set(componentId, best?.attractor ?? UNASSIGNED_GROUP_ID);
  }
  return assigned;
}

/** Symmetric group-to-group coupling weight (sum of coupling counts between their members). */
export function groupSimilarity(
  edges: readonly Pick<NkpGraphEdge, "source" | "target" | "count" | "type">[],
  groupOf: ReadonlyMap<string, string>,
): Map<string, Map<string, number>> {
  const weights = new Map<string, Map<string, number>>();
  const add = (left: string, right: string, count: number): void => {
    const row = weights.get(left) ?? new Map<string, number>();
    row.set(right, (row.get(right) ?? 0) + count);
    weights.set(left, row);
  };
  for (const edge of edges) {
    if (edge.type !== "coupling") continue;
    const left = groupOf.get(edge.source);
    const right = groupOf.get(edge.target);
    if (!left || !right || left === right) continue;
    add(left, right, edge.count);
    add(right, left, edge.count);
  }
  return weights;
}

/**
 * Greedy nearest-neighbour ordering: start from the group with the most
 * cross-group coupling, then repeatedly append the unplaced group most
 * coupled to the last placed one. Strongly coupled attractors end up
 * adjacent on the circle, which shortens bundles and reduces crossings.
 * The unassigned group, if present, always goes last.
 */
export function orderGroups(groupIds: readonly string[], similarity: ReadonlyMap<string, ReadonlyMap<string, number>>): string[] {
  const total = (id: string): number => [...(similarity.get(id)?.values() ?? [])].reduce((sum, value) => sum + value, 0);
  const remaining = groupIds.filter((id) => id !== UNASSIGNED_GROUP_ID).sort();
  const ordered: string[] = [];
  const pickBest = (score: (id: string) => number): string => {
    let bestId = remaining[0] as string;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const id of remaining) {
      const value = score(id);
      if (value > bestScore) {
        bestId = id;
        bestScore = value;
      }
    }
    return bestId;
  };
  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    // Tie-break on overall connectivity so isolated groups drift to the end.
    const next = last === undefined
      ? pickBest(total)
      : pickBest((id) => (similarity.get(last)?.get(id) ?? 0) * 1e6 + total(id));
    ordered.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  if (groupIds.includes(UNASSIGNED_GROUP_ID)) ordered.push(UNASSIGNED_GROUP_ID);
  return ordered;
}

/**
 * Orders leaves inside a group by the average position of the groups they
 * couple to, so members that couple "backwards" sit at the start of the arc
 * and members that couple "forwards" sit at the end. Ties by label.
 */
export function orderLeaves(
  leaves: readonly BundleLeaf[],
  groupIndex: number,
  groupPosition: ReadonlyMap<string, number>,
  groupOf: ReadonlyMap<string, string>,
  edges: readonly Pick<NkpGraphEdge, "source" | "target" | "count" | "type">[],
): BundleLeaf[] {
  const groupCount = Math.max(1, groupPosition.size);
  const pull = new Map<string, { weighted: number; total: number }>();
  for (const edge of edges) {
    if (edge.type !== "coupling") continue;
    for (const [self, other] of [[edge.source, edge.target], [edge.target, edge.source]] as const) {
      const otherGroup = groupOf.get(other);
      const otherIndex = otherGroup === undefined ? undefined : groupPosition.get(otherGroup);
      if (otherIndex === undefined || otherIndex === groupIndex) continue;
      // Shortest signed distance around the circle.
      let delta = otherIndex - groupIndex;
      if (delta > groupCount / 2) delta -= groupCount;
      if (delta < -groupCount / 2) delta += groupCount;
      const entry = pull.get(self) ?? { weighted: 0, total: 0 };
      entry.weighted += delta * edge.count;
      entry.total += edge.count;
      pull.set(self, entry);
    }
  }
  const score = (leaf: BundleLeaf): number => {
    const entry = pull.get(leaf.id);
    return entry && entry.total > 0 ? entry.weighted / entry.total : 0;
  };
  return [...leaves].sort((left, right) => score(left) - score(right) || left.label.localeCompare(right.label));
}

/**
 * Builds the bundle model. Visible leaves/edges come from buildNkpGraphModel
 * with the caller's filters; attractor assignment and ordering come from the
 * unfiltered landscape so the circle stays put while filters change.
 */
export function buildNkpBundleModel(state: PendingState, options: NkpBundleOptions = {}): NkpBundleModel {
  const filtered = buildNkpGraphModel(state, options);
  const full = buildNkpGraphModel(state, { minCouplingStrength: 1 });
  const colors = attractorColors(state);

  const dominant = dominantAttractors(full.edges);
  const assigned = assignGroups(full.edges, options.minGroupSize ?? DEFAULT_MIN_GROUP_SIZE);
  const groupOf = new Map<string, string>();
  for (const node of full.nodes) {
    if (node.type === "component") groupOf.set(node.id, assigned.get(node.id) ?? UNASSIGNED_GROUP_ID);
  }
  const attractorNodes = new Map(full.nodes.filter((node) => node.type === "attractor").map((node) => [node.id, node]));

  const leavesByGroup = new Map<string, BundleLeaf[]>();
  for (const node of filtered.nodes) {
    if (node.type !== "component") continue;
    const groupId = groupOf.get(node.id) ?? UNASSIGNED_GROUP_ID;
    const leaf: BundleLeaf = {
      id: node.id,
      label: node.label,
      groupId,
      ...(node.status ? { status: node.status } : {}),
      tooltip: node.tooltip,
      focused: node.focused,
      fissionCandidate: Boolean(node.fissionCandidate),
      dominantLabel: attractorNodes.get(dominant.get(node.id) ?? "")?.label ?? "no attractor",
    };
    leavesByGroup.set(groupId, [...(leavesByGroup.get(groupId) ?? []), leaf]);
  }

  const similarity = groupSimilarity(full.edges, groupOf);
  const allGroupIds = [...new Set(groupOf.values())];
  const globalOrder = orderGroups(allGroupIds, similarity);
  const groupPosition = new Map(globalOrder.map((id, index) => [id, index]));

  const groups: BundleGroup[] = [];
  for (const id of globalOrder) {
    const leaves = leavesByGroup.get(id);
    if (!leaves || leaves.length === 0) continue;
    const attractor = attractorNodes.get(id);
    groups.push({
      id,
      label: attractor?.label ?? "other",
      tooltip: attractor?.tooltip ?? "Components whose own attractor covers no other component, or that have no attractor-linked forces",
      color: colors.get(id.slice("attractor:".length)) ?? "var(--muted)",
      leaves: orderLeaves(leaves, groupPosition.get(id) ?? 0, groupPosition, groupOf, full.edges),
    });
  }

  const placed = new Set(groups.flatMap((group) => group.leaves.map((leaf) => leaf.id)));
  const fusionPairs = new Set(
    filtered.edges.filter((edge) => edge.type === "fusion").map((edge) => [edge.source, edge.target].sort().join("\u0000")),
  );
  // Coupling edges, plus fusion pairs whose coupling edge was cut by the
  // top-N filter (fusion edges are exempt from it) so no leaf floats.
  const couplingPairs = new Set(
    filtered.edges.filter((edge) => edge.type === "coupling").map((edge) => [edge.source, edge.target].sort().join("\u0000")),
  );
  const edges: BundleEdge[] = filtered.edges
    .filter((edge) => placed.has(edge.source) && placed.has(edge.target))
    .filter((edge) =>
      edge.type === "coupling" ||
      (edge.type === "fusion" && !couplingPairs.has([edge.source, edge.target].sort().join("\u0000"))))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      count: edge.count,
      stressors: edge.stressors,
      tooltip: edge.tooltip,
      focused: edge.focused,
      fusion: fusionPairs.has([edge.source, edge.target].sort().join("\u0000")),
    }));

  return { groups, edges, maxCount: edges.reduce((max, edge) => Math.max(max, edge.count), 1) };
}

/** Nested data for d3.hierarchy: root -> group -> leaf. */
export interface BundleHierarchyDatum {
  id: string;
  group?: BundleGroup;
  leaf?: BundleLeaf;
  children?: BundleHierarchyDatum[];
}

export function bundleHierarchyData(model: NkpBundleModel): BundleHierarchyDatum {
  return {
    id: "root",
    children: model.groups.map((group) => ({
      id: group.id,
      group,
      children: group.leaves.map((leaf) => ({ id: leaf.id, leaf })),
    })),
  };
}

/** Stroke width and opacity for an edge, scaled by its shared-force count. */
export function bundleEdgeStyle(count: number, maxCount: number, focused: boolean): { width: number; opacity: number } {
  const ratio = maxCount <= 1 ? 1 : (count - 1) / (maxCount - 1);
  const opacity = (0.18 + 0.5 * ratio) * (focused ? 1 : 0.35);
  return { width: 0.8 + 2.4 * ratio, opacity: Math.round(opacity * 1000) / 1000 };
}

/**
 * Radial label placement: rotate to the leaf angle (degrees, 0 = 12 o'clock,
 * clockwise) and flip labels on the left half so they never read upside down.
 */
export function radialLabelTransform(angleDegrees: number, radius: number): { transform: string; anchor: "start" | "end" } {
  const flip = angleDegrees % 360 >= 180;
  return {
    transform: `rotate(${angleDegrees - 90}) translate(${radius},0)${flip ? " rotate(180)" : ""}`,
    anchor: flip ? "end" : "start",
  };
}

/** Per-component summary for the hover tooltip: neighbours and the forces shared with each. */
export function leafNeighbourSummary(model: NkpBundleModel, leafId: string): { label: string; count: number; stressors: string[] }[] {
  const labels = new Map(model.groups.flatMap((group) => group.leaves.map((leaf) => [leaf.id, leaf.label] as const)));
  return model.edges
    .filter((edge) => edge.source === leafId || edge.target === leafId)
    .map((edge) => {
      const other = edge.source === leafId ? edge.target : edge.source;
      return { label: labels.get(other) ?? other, count: edge.count, stressors: edge.stressors };
    })
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

/** Angular extent (degrees) of an attractor band and the text it wants to show. */
export interface GroupLabelArc {
  start: number;
  end: number;
  label: string;
}

/**
 * Lets each attractor name spill past its own band into free space, so a
 * one-component attractor still shows a readable name. Each label is centred
 * on its band; where two neighbours' desired spans overlap (circularly), the
 * boundary is set halfway through the overlap, but never inside a band.
 * Returns the span to draw the text path along and the characters that fit.
 */
export function layoutGroupLabels(
  arcs: readonly GroupLabelArc[],
  radius: number,
  charWidth: number,
): { start: number; end: number; maxChars: number }[] {
  const degPerChar = (charWidth / radius) * (180 / Math.PI);
  const wanted = arcs.map((arc) => {
    const mid = (arc.start + arc.end) / 2;
    const half = Math.max((arc.end - arc.start) / 2, ((arc.label.length + 1) * degPerChar) / 2);
    return { lo: mid - half, hi: mid + half };
  });
  const result = wanted.map((item) => ({ ...item }));
  if (arcs.length > 1) {
    for (let index = 0; index < arcs.length; index += 1) {
      const nextIndex = (index + 1) % arcs.length;
      const wrap = nextIndex === 0 ? 360 : 0;
      const current = wanted[index]!;
      const nextLo = wanted[nextIndex]!.lo + wrap;
      if (current.hi <= nextLo) continue;
      // Meet halfway through the overlap, clamped to the gap between the bands.
      const boundary = Math.min(
        Math.max((current.hi + nextLo) / 2, arcs[index]!.end),
        arcs[nextIndex]!.start + wrap,
      );
      // Leave about one character of air between the two names.
      result[index]!.hi = Math.min(result[index]!.hi, Math.max(boundary - degPerChar / 2, arcs[index]!.end));
      result[nextIndex]!.lo = Math.max(result[nextIndex]!.lo, Math.min(boundary + degPerChar / 2, arcs[nextIndex]!.start + wrap) - wrap);
    }
  }
  return result.map((span) => ({
    start: span.lo,
    end: span.hi,
    maxChars: Math.max(0, Math.floor((span.hi - span.lo) / degPerChar) - 1),
  }));
}

// ---------------------------------------------------------------------------
// Rendering

const CHAR_WIDTH = 6.8; // ~11px mono
const MAX_LABEL_CHARS = 26;
const GROUP_GAP = 2.2;
const GROUP_CHAR_WIDTH = 6.4; // ~10.5px mono
const BAND_GAP = 5;
const BAND_WIDTH = 6;
const LABEL_GAP = 5;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface BundleRenderOptions extends NkpBundleOptions {
  /** d3.curveBundle beta: 0 draws straight chords, 1 follows the hierarchy fully. */
  tension?: number;
}

/**
 * Draws the bundle view into `host` (cleared first). The drawing is a square
 * viewBox fitted into the viewport, so it never scrolls; zoom for detail.
 *
 * Rings from the centre out: bundled edges, component dots, a coloured band
 * per attractor hugging the dots, radial component labels, then attractor
 * names in the attractor's colour along a guide arc.
 */
export function renderNkpBundle(host: HTMLElement, state: PendingState, options: BundleRenderOptions, d3: any): void {
  host.replaceChildren();
  const model = buildNkpBundleModel(state, options);
  const leafCount = model.groups.reduce((sum, group) => sum + group.leaves.length, 0);
  if (leafCount === 0) {
    renderEmpty(host, "No components to bundle. Loosen the filters or lower the minimum coupling strength.");
    return;
  }

  const longestLabel = Math.min(
    MAX_LABEL_CHARS,
    Math.max(...model.groups.flatMap((group) => group.leaves.map((leaf) => leaf.label.length + (leaf.fissionCandidate ? 2 : 0)))),
  );
  // ~14 units of arc per leaf keeps 11px labels from overlapping.
  const innerRadius = Math.max(150, ((leafCount + model.groups.length * GROUP_GAP) * 14) / (2 * Math.PI));
  const bandInner = innerRadius + BAND_GAP;
  const bandOuter = bandInner + BAND_WIDTH;
  const labelRadius = bandOuter + LABEL_GAP;
  const nameRadius = labelRadius + longestLabel * CHAR_WIDTH + 16;
  const half = nameRadius + 18;

  const { svg, content } = appendZoomableSvg(
    host,
    d3,
    { x: -half, y: -half, width: half * 2, height: half * 2 },
    "nkp-bundle-svg",
    "Component couplings bundled by attractor",
  );

  const root = d3.hierarchy(bundleHierarchyData(model));
  d3.cluster()
    .size([360, innerRadius])
    .separation((a: any, b: any) => (a.parent === b.parent ? 1 : GROUP_GAP))(root);

  const leafNodes = new Map<string, any>(root.leaves().map((node: any) => [node.data.id, node]));
  const line = d3.lineRadial()
    .curve(d3.curveBundle.beta(options.tension ?? DEFAULT_BUNDLE_TENSION))
    .radius((node: any) => node.y)
    .angle((node: any) => (node.x * Math.PI) / 180);

  // d3.cluster spreads (leaves - groups) unit gaps plus one GROUP_GAP per
  // group boundary (including the wrap-around) over 360 degrees.
  const halfStep = 360 / (leafCount - model.groups.length + model.groups.length * GROUP_GAP) / 2;
  const groupArcs = (root.children ?? []).map((groupNode: any) => {
    const xs = groupNode.leaves().map((leaf: any) => leaf.x);
    return {
      group: groupNode.data.group as BundleGroup,
      start: Math.min(...xs) - halfStep * 0.85,
      end: Math.max(...xs) + halfStep * 0.85,
      name: { start: 0, end: 0, maxChars: 0 },
    };
  });
  const nameSpans = layoutGroupLabels(
    groupArcs.map((d: any) => ({ start: d.start, end: d.end, label: d.group.label })),
    nameRadius,
    GROUP_CHAR_WIDTH,
  );
  groupArcs.forEach((d: any, index: number) => {
    d.name = nameSpans[index];
  });

  const toRadians = (deg: number): number => (deg * Math.PI) / 180;
  const band = d3.arc().innerRadius(bandInner).outerRadius(bandOuter);
  const guide = d3.arc().innerRadius(nameRadius - 9).outerRadius(nameRadius - 8);
  const isBottom = (d: any): boolean => {
    const mid = (d.start + d.end) / 2;
    return mid > 90 && mid < 270;
  };

  // Edges first so labels and bands paint over them.
  const edgeData = model.edges
    .map((edge) => ({ edge, from: leafNodes.get(edge.source), to: leafNodes.get(edge.target) }))
    .filter((item) => item.from && item.to)
    .sort((left, right) => left.edge.count - right.edge.count);
  const edgePaths = content.append("g").attr("class", "nkp-bundle-edges")
    .selectAll("path").data(edgeData).join("path")
    .attr("class", (item: any) => `nkp-bundle-edge${item.edge.fusion ? " fusion" : ""}`)
    .attr("d", (item: any) => line(item.from.path(item.to)))
    .each(function (this: SVGPathElement, item: any) {
      const style = bundleEdgeStyle(item.edge.count, model.maxCount, item.edge.focused);
      this.style.strokeWidth = `${style.width}px`;
      this.style.strokeOpacity = String(style.opacity);
    });

  const bands = content.append("g").attr("class", "nkp-bundle-groups")
    .selectAll("g").data(groupArcs).join("g")
    .attr("class", "nkp-bundle-group");
  bands.append("path")
    .attr("class", "nkp-bundle-band")
    .attr("fill", (d: any) => d.group.color)
    .attr("d", (d: any) => band({ startAngle: toRadians(d.start), endAngle: toRadians(d.end) }));
  bands.append("path")
    .attr("class", "nkp-bundle-guide")
    .attr("fill", (d: any) => d.group.color)
    .attr("d", (d: any) => guide({ startAngle: toRadians(d.start), endAngle: toRadians(d.end) }));
  // Invisible wedge covering band-to-name so the whole group is one hover target.
  bands.append("path")
    .attr("class", "nkp-bundle-hit")
    .attr("d", (d: any) => d3.arc().innerRadius(bandInner).outerRadius(nameRadius + 8)({ startAngle: toRadians(d.start), endAngle: toRadians(d.end) }))
    .lower();
  bands.append("path")
    .attr("id", (_d: unknown, index: number) => `nkp-bundle-name-${index}`)
    .attr("fill", "none")
    .attr("d", (d: any) => {
      const point = (deg: number): string => {
        const rad = toRadians(deg - 90);
        return `${nameRadius * Math.cos(rad)},${nameRadius * Math.sin(rad)}`;
      };
      const large = d.name.end - d.name.start > 180 ? 1 : 0;
      return isBottom(d)
        ? `M${point(d.name.end)} A${nameRadius},${nameRadius} 0 ${large} 0 ${point(d.name.start)}`
        : `M${point(d.name.start)} A${nameRadius},${nameRadius} 0 ${large} 1 ${point(d.name.end)}`;
    });
  bands.append("text")
    .attr("class", "nkp-bundle-group-label")
    .attr("fill", (d: any) => d.group.color)
    .attr("dy", (d: any) => (isBottom(d) ? "0.8em" : "0"))
    .append("textPath")
    .attr("href", (_d: unknown, index: number) => `#nkp-bundle-name-${index}`)
    .attr("startOffset", "50%")
    .attr("text-anchor", "middle")
    .text((d: any) => truncate(d.group.label, d.name.maxChars));

  const leaves = content.append("g").attr("class", "nkp-bundle-leaves")
    .selectAll("g").data(root.leaves()).join("g")
    .attr("class", (node: any) => {
      const leaf = node.data.leaf as BundleLeaf;
      return `nkp-bundle-leaf${leaf.fissionCandidate ? " fission" : ""}${leaf.focused ? "" : " unfocused"}`;
    });
  leaves.append("circle")
    .attr("class", (node: any) => `nkp-bundle-dot status-${node.data.leaf.status ?? "actual"}`)
    .attr("r", 3.2)
    .attr("transform", (node: any) => `rotate(${node.x - 90}) translate(${node.y},0)`);
  leaves.append("text")
    .attr("class", "nkp-bundle-label")
    .attr("dy", "0.32em")
    .each(function (this: SVGTextElement, node: any) {
      const placement = radialLabelTransform(node.x, labelRadius);
      this.setAttribute("transform", placement.transform);
      this.setAttribute("text-anchor", placement.anchor);
      const leaf = node.data.leaf as BundleLeaf;
      const text = truncate(leaf.label, MAX_LABEL_CHARS);
      this.textContent = leaf.fissionCandidate
        ? (placement.anchor === "start" ? `${text} ▲` : `▲ ${text}`)
        : text;
    });

  const tip = createTooltip(host);
  const clear = (): void => {
    svg.classed("hovering", false);
    edgePaths.classed("hl-a", false).classed("hl-b", false);
    leaves.classed("hl", false);
    bands.classed("hl", false);
    tip.hidden = true;
  };

  leaves
    .on("mouseenter", (event: MouseEvent, node: any) => {
      const leaf = node.data.leaf as BundleLeaf;
      svg.classed("hovering", true);
      const neighbours = new Set<string>([leaf.id]);
      edgePaths.classed("hl-a", (item: any) => {
        const hit = item.edge.source === leaf.id || item.edge.target === leaf.id;
        if (hit) {
          neighbours.add(item.edge.source);
          neighbours.add(item.edge.target);
        }
        return hit;
      });
      edgePaths.filter(".hl-a").raise();
      leaves.classed("hl", (other: any) => neighbours.has(other.data.id));
      bands.classed("hl", (d: any) => d.group.id === leaf.groupId);
      const summary = leafNeighbourSummary(model, leaf.id);
      const group = model.groups.find((candidate) => candidate.id === leaf.groupId);
      const placement = group && group.label !== leaf.dominantLabel
        ? `${escapeHtml(group.label)} (own attractor: ${escapeHtml(leaf.dominantLabel)})`
        : escapeHtml(group?.label ?? "");
      const rows = summary.slice(0, 12).map((item) =>
        `<li><b>${escapeHtml(item.label)}</b> (${item.count}): ${escapeHtml(item.stressors.join(", "))}</li>`).join("");
      tip.innerHTML = `<strong>${escapeHtml(leaf.label)}</strong>`
        + `<div class="muted">${placement}${leaf.fissionCandidate ? " · fission candidate" : ""}</div>`
        + (rows ? `<ul>${rows}</ul>${summary.length > 12 ? `<div class="muted">+${summary.length - 12} more</div>` : ""}` : `<div class="muted">No visible couplings</div>`);
      placeTooltip(host, tip, event);
    })
    .on("mouseleave", clear);

  bands
    .on("mouseenter", (event: MouseEvent, d: any) => {
      const members = new Set(d.group.leaves.map((leaf: BundleLeaf) => leaf.id));
      svg.classed("hovering", true);
      bands.classed("hl", (other: any) => other === d);
      const touched = new Set<string>();
      let internal = 0;
      let external = 0;
      edgePaths
        .classed("hl-a", (item: any) => {
          const hit = members.has(item.edge.source) && members.has(item.edge.target);
          if (hit) internal += 1;
          return hit;
        })
        .classed("hl-b", (item: any) => {
          const hit = members.has(item.edge.source) !== members.has(item.edge.target);
          if (hit) {
            external += 1;
            touched.add(item.edge.source);
            touched.add(item.edge.target);
          }
          return hit;
        });
      edgePaths.filter(".hl-a, .hl-b").raise();
      leaves.classed("hl", (node: any) => members.has(node.data.id) || touched.has(node.data.id));
      tip.innerHTML = `<strong>${escapeHtml(d.group.label)}</strong>`
        + `<div class="muted">${d.group.leaves.length} component(s) · ${internal} internal, ${external} cross-attractor couplings</div>`;
      placeTooltip(host, tip, event);
    })
    .on("mouseleave", clear);
}
