// Alternative "hypergraph" rendering of the live NKP graph. Instead of
// expanding each force into a component-component clique, every force is its
// own small node joined to each component it touches (bipartite force <->
// component graph, one edge per membership). Attractors are no longer pinned
// nodes: each is drawn as a soft translucent region around its force nodes,
// recomputed every tick, so attractor groups float freely and overlapping
// regions show components sitting between attractors.

import type { PendingState } from "./model";
import { attractorColors, effectiveState, forceLabel, type EffectiveForce } from "./nkp-graph";
import { appendZoomableSvg, renderEmpty } from "./landscape-dom";
import type { EntityKey } from "./landscape-selection";
import { branchGeometry, nudgeLabels } from "./landscape-geometry";

export interface HyperComponentNode {
  id: string;
  type: "component";
  label: string;
  status: "actual" | "proposed";
  tooltip: string;
  focused: boolean;
  forceCount: number;
  fissionCandidate: boolean;
}

export interface HyperForceNode {
  id: string;
  type: "force";
  label: string;
  kind: "stressor" | "purpose";
  attractorId: string;
  tooltip: string;
  focused: boolean;
}

export type HyperNode = HyperComponentNode | HyperForceNode;

export interface HyperEdge {
  id: string;
  /** Force node id. */
  source: string;
  /** Component node id. */
  target: string;
  attractorId: string;
  focused: boolean;
}

export interface AttractorGroup {
  attractorId: string;
  name: string;
  tooltip: string;
  color: string;
  forceNodeIds: string[];
  componentNodeIds: string[];
  focused: boolean;
}

export interface NkpHypergraphModel {
  nodes: HyperNode[];
  edges: HyperEdge[];
  groups: AttractorGroup[];
  branchBundles: BranchBundle[];
  /**
   * Visible components whose force vectors (the set of forces touching them)
   * are identical, grouped when 2+ components share a vector — fusion
   * candidates. Rendered by createRegionsView as a dashed hull; the pure
   * grouping lives here so it stays testable without the DOM.
   */
  fusionGroups: string[][];
}

export interface BranchBundle {
  id: string;
  componentId: string;
  attractorId: string;
  forceIds: string[];
  focused: boolean;
}

export interface NkpHypergraphOptions {
  visibleForceIds?: ReadonlySet<string>;
  visibleComponentNames?: ReadonlySet<string>;
  fissionThreshold?: number;
  /** When true, drop filtered-out forces/components instead of fading them. */
  hideFiltered?: boolean;
  /**
   * Component name to centre on: keep only the forces touching it and the
   * other components those forces touch.
   */
  focusComponent?: string;
}

export function forceNodeId(force: EffectiveForce): string {
  return `force:${force.key}`;
}

/** Builds the DOM-independent bipartite force <-> component model. */
export function buildNkpHypergraphModel(
  state: PendingState,
  options: NkpHypergraphOptions = {},
): NkpHypergraphModel {
  const { components, attractors, forces } = effectiveState(state);
  const visible = options.visibleForceIds;
  const isVisibleForce = (force: EffectiveForce): boolean => visible === undefined || visible.has(force.key);
  const isVisibleComponent = (name: string): boolean =>
    options.visibleComponentNames === undefined || options.visibleComponentNames.has(name);
  const componentNames = new Set(components.map((component) => component.name));
  const attractorIds = new Set(attractors.map((attractor) => attractor.id));

  const componentForces = new Map<string, EffectiveForce[]>();
  for (const force of forces) {
    for (const name of new Set(force.components)) {
      if (!componentNames.has(name)) continue;
      componentForces.set(name, [...(componentForces.get(name) ?? []), force]);
    }
  }

  const componentNodes: HyperComponentNode[] = components.map((component) => {
    const attached = componentForces.get(component.name) ?? [];
    const focused = (visible === undefined || attached.some(isVisibleForce)) && isVisibleComponent(component.name);
    return {
      id: `component:${component.name}`,
      type: "component",
      label: component.name,
      status: component.status,
      tooltip: [component.name, component.description, `Status: ${component.status}`, `Forces: ${attached.length}`].join("\n"),
      focused,
      forceCount: attached.length,
      fissionCandidate: attached.length > (options.fissionThreshold ?? Number.POSITIVE_INFINITY),
    };
  });
  const componentFocus = new Map(componentNodes.map((item) => [item.label, item.focused]));

  const attractorNames = new Map(attractors.map((attractor) => [attractor.id, attractor.name]));
  const forceNodes: HyperForceNode[] = forces.map((force) => ({
    id: forceNodeId(force),
    type: "force",
    label: forceLabel(force),
    kind: force.kind,
    attractorId: force.attractorId,
    tooltip: [
      `${force.key} ${force.shortname}`.trim(),
      force.description,
      `Attractor: ${attractorNames.get(force.attractorId) ?? force.attractorId}`,
      `Components: ${[...new Set(force.components)].join(", ")}`,
    ].join("\n"),
    focused: isVisibleForce(force),
  }));
  const forceFocus = new Map(forceNodes.map((item) => [item.id, item.focused]));

  const edges: HyperEdge[] = [];
  for (const force of forces) {
    for (const name of new Set(force.components)) {
      if (!componentNames.has(name)) continue;
      const source = forceNodeId(force);
      edges.push({
        id: `membership:${force.key}:${name}`,
        source,
        target: `component:${name}`,
        attractorId: force.attractorId,
        focused: (forceFocus.get(source) ?? false) && (componentFocus.get(name) ?? false),
      });
    }
  }

  let nodes: HyperNode[] = [...componentNodes, ...forceNodes];
  let keptEdges = edges;
  if (options.focusComponent !== undefined) {
    const focusId = `component:${options.focusComponent}`;
    const focusForces = new Set(edges.filter((edge) => edge.target === focusId).map((edge) => edge.source));
    keptEdges = keptEdges.filter((edge) => focusForces.has(edge.source));
  }
  if (options.hideFiltered) {
    keptEdges = keptEdges.filter((edge) => edge.focused);
  }
  // A node with no membership edge carries no coupling information in this
  // view (an orphan force, or a component nothing touches), so drop it.
  const linked = new Set(keptEdges.flatMap((edge) => [edge.source, edge.target]));
  nodes = nodes.filter((item) => linked.has(item.id));

  const keptForceNodes = nodes.filter((item): item is HyperForceNode => item.type === "force");
  const groups: AttractorGroup[] = [];
  const colors = attractorColors(state);
  const orderedAttractorIds = [
    ...attractors.map((attractor) => attractor.id),
    // Forces may reference an attractor that isn't in the landscape; still group them.
    ...[...new Set(forces.map((force) => force.attractorId))].filter((id) => !attractorIds.has(id)).sort(),
  ];
  orderedAttractorIds.forEach((attractorId) => {
    const members = keptForceNodes.filter((item) => item.attractorId === attractorId);
    if (members.length === 0) return;
    const memberIds = new Set(members.map((item) => item.id));
    const componentNodeIds = [
      ...new Set(keptEdges.filter((edge) => memberIds.has(edge.source)).map((edge) => edge.target)),
    ].sort();
    const attractor = attractors.find((item) => item.id === attractorId);
    groups.push({
      attractorId,
      name: attractor?.name ?? attractorId,
      tooltip: attractor
        ? [attractor.name, attractor.description, `Positive: ${attractor.positiveState}`, `Negative: ${attractor.negativeState}`, `Forces: ${members.length}`].join("\n")
        : `${attractorId} (unknown attractor)`,
      color: colors.get(attractorId) ?? "var(--muted)",
      forceNodeIds: members.map((item) => item.id),
      componentNodeIds,
      focused: members.some((item) => item.focused),
    });
  });

  // Fusion candidates: visible components carrying the exact same set of
  // forces (by node id, since a component may share a force key with an
  // identically-named added/removed variant only through the same key).
  const componentVectors = new Map<string, string[]>();
  for (const edge of keptEdges) {
    componentVectors.set(edge.target, [...(componentVectors.get(edge.target) ?? []), edge.source]);
  }
  const vectorGroups = new Map<string, string[]>();
  for (const [componentId, forceIds] of componentVectors) {
    const vectorKey = [...forceIds].sort().join("\u0000");
    vectorGroups.set(vectorKey, [...(vectorGroups.get(vectorKey) ?? []), componentId]);
  }
  const fusionGroups = [...vectorGroups.values()].filter((group) => group.length >= 2);

  const bundleMap = new Map<string, BranchBundle>();
  for (const edge of keptEdges) {
    const forceKey = edge.source.startsWith("force:") ? edge.source.slice("force:".length) : edge.source;
    const bundleId = `bundle:${edge.target}:${edge.attractorId}`;
    const existing = bundleMap.get(bundleId);
    if (existing) {
      existing.forceIds.push(forceKey);
      if (forceFocus.get(edge.source)) existing.focused = true;
      continue;
    }
    bundleMap.set(bundleId, {
      id: bundleId,
      componentId: edge.target,
      attractorId: edge.attractorId,
      forceIds: [forceKey],
      focused: !!forceFocus.get(edge.source),
    });
  }
  const branchBundles = [...bundleMap.values()];

  return { nodes, edges: keptEdges, groups, branchBundles, fusionGroups };
}

export interface Point {
  x: number;
  y: number;
}

function cross(origin: Point, a: Point, b: Point): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

/** Andrew's monotone-chain convex hull; collinear points collapse to their two extremes. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = sorted.filter((point, index) => {
    const previous = sorted[index - 1];
    return previous === undefined || point.x !== previous.x || point.y !== previous.y;
  });
  if (unique.length <= 2) return unique;
  // True while the last two points of `chain` and `point` fail to turn counter-clockwise.
  const turnsWrong = (chain: Point[], point: Point): boolean => {
    const a = chain[chain.length - 2];
    const b = chain[chain.length - 1];
    return a !== undefined && b !== undefined && cross(a, b, point) <= 0;
  };
  const lower: Point[] = [];
  for (const point of unique) {
    while (turnsWrong(lower, point)) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (const point of [...unique].reverse()) {
    while (turnsWrong(upper, point)) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * SVG path for an attractor region's core. It is meant to be both filled and
 * stroked with a wide, round-joined stroke (see renderer), which inflates the
 * core into a rounded blob: a single point becomes a circle, two points (or a
 * collinear group) a capsule, three or more a padded convex hull.
 */
export function regionCorePath(points: readonly Point[]): string {
  const hull = convexHull(points);
  const first = hull[0];
  if (first === undefined) return "";
  const fmt = (value: number): string => value.toFixed(1);
  if (hull.length === 1) {
    // Zero-length subpaths aren't reliably painted; nudge to a tiny segment.
    return `M${fmt(first.x - 0.5)},${fmt(first.y)}L${fmt(first.x + 0.5)},${fmt(first.y)}Z`;
  }
  return `M${hull.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join("L")}Z`;
}

export function centroid(points: readonly Point[]): Point | undefined {
  if (points.length === 0) return undefined;
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

type SimNode = HyperNode & { x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null };
type SimLink = Omit<HyperEdge, "source" | "target"> & { source: SimNode | string; target: SimNode | string };
type RenderBundle = BranchBundle;
type RenderBranch = {
  id: string;
  bundleId: string;
  componentId: string;
  forceId: string;
  attractorId: string;
  focused: boolean;
};

/**
 * Pulls each force node toward the current centroid of its attractor's force
 * nodes, recomputed every tick, so attractor groups cohere without being
 * pinned anywhere.
 */
function createAttractorCohesionForce(strength = 0.3) {
  let nodes: SimNode[] = [];
  const force = (alpha: number): void => {
    const sums = new Map<string, { x: number; y: number; n: number }>();
    for (const node of nodes) {
      if (node.type !== "force") continue;
      const sum = sums.get(node.attractorId) ?? { x: 0, y: 0, n: 0 };
      sum.x += node.x ?? 0;
      sum.y += node.y ?? 0;
      sum.n += 1;
      sums.set(node.attractorId, sum);
    }
    for (const node of nodes) {
      if (node.type !== "force" || node.fx != null) continue;
      const sum = sums.get(node.attractorId);
      if (!sum || sum.n < 2) continue;
      const pull = strength * alpha;
      node.vx = (node.vx ?? 0) + (sum.x / sum.n - (node.x ?? 0)) * pull;
      node.vy = (node.vy ?? 0) + (sum.y / sum.n - (node.y ?? 0)) * pull;
    }
  };
  force.initialize = (next: SimNode[]): void => {
    nodes = next;
  };
  return force;
}

const REGION_PADDING = 22;
const DEFAULT_CANVAS_WIDTH = 800;
const DEFAULT_CANVAS_HEIGHT = 600;

/** 1.3x the original glyph sizes (diamond half-diagonal 5 -> 6.5, circle r 4 -> 5.2). */
export const FORCE_NODE_SCALE = 1.3;
const FORCE_DIAMOND_HALF_DIAGONAL = 5 * FORCE_NODE_SCALE;
const FORCE_CIRCLE_RADIUS = 4 * FORCE_NODE_SCALE;

/** Fill-opacity of a force glyph: stressors are solid, purposes read a touch lighter. */
export function forceNodeOpacity(kind: "stressor" | "purpose"): number {
  return kind === "purpose" ? 0.75 : 1;
}

/** Stressors as diamonds, purposes as circles: both small, coloured by attractor. */
function forceGlyphPath(kind: "stressor" | "purpose"): string {
  if (kind === "stressor") {
    const h = FORCE_DIAMOND_HALF_DIAGONAL;
    return `M0,-${h}L${h},0L0,${h}L-${h},0Z`;
  }
  const r = FORCE_CIRCLE_RADIUS;
  return `M-${r},0a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 -${r * 2},0`;
}

type SimForceNode = HyperForceNode & { x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null };

/** Sensible defaults for forceInteractionDelta; exported so createRegionsView and tests share one source of truth. */
export const FORCE_INTERACTION_DISTANCE_MAX = 220;
export const FORCE_INTERACTION_PURPOSE_STRENGTH = 42;
export const FORCE_INTERACTION_STRESSOR_STRENGTH = 16;

export interface ForceInteractionNode {
  attractorId?: string;
  x?: number;
  y?: number;
}

export interface ForceInteractionSource extends ForceInteractionNode {
  kind: "stressor" | "purpose";
}

/**
 * Pure effect of `source` on `target`: a purpose pushes forces belonging to
 * *other* attractors away (stronger, falls off linearly with distance); a
 * stressor pulls them in instead (weaker, at equal distance, than a
 * purpose's push). Same-attractor pairs and pairs beyond `distanceMax` are
 * untouched. Returns the velocity delta `target` receives.
 */
export function forceInteractionDelta(
  source: ForceInteractionSource,
  target: ForceInteractionNode,
  params: { distanceMax: number },
): { vx: number; vy: number } {
  const zero = { vx: 0, vy: 0 };
  if (source.attractorId === undefined || target.attractorId === undefined || source.attractorId === target.attractorId) {
    return zero;
  }
  const dx = (target.x ?? 0) - (source.x ?? 0);
  const dy = (target.y ?? 0) - (source.y ?? 0);
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || distance >= params.distanceMax) return zero;
  const falloff = 1 - distance / params.distanceMax;
  const isPurpose = source.kind === "purpose";
  const strength = (isPurpose ? FORCE_INTERACTION_PURPOSE_STRENGTH : FORCE_INTERACTION_STRESSOR_STRENGTH) * falloff;
  const sign = isPurpose ? 1 : -1;
  return { vx: (dx / distance) * strength * sign, vy: (dy / distance) * strength * sign };
}

/** d3 force wrapping forceInteractionDelta over every pair of force nodes. */
function createForceInteractionForce(distanceMax = FORCE_INTERACTION_DISTANCE_MAX) {
  let forceNodes: SimForceNode[] = [];
  const force = (alpha: number): void => {
    for (const target of forceNodes) {
      if (target.fx != null) continue;
      let dvx = 0;
      let dvy = 0;
      for (const source of forceNodes) {
        if (source === target) continue;
        const delta = forceInteractionDelta(source, target, { distanceMax });
        dvx += delta.vx;
        dvy += delta.vy;
      }
      target.vx = (target.vx ?? 0) + dvx * alpha;
      target.vy = (target.vy ?? 0) + dvy * alpha;
    }
  };
  force.initialize = (nodes: SimNode[]): void => {
    forceNodes = nodes.filter((node): node is SimForceNode => node.type === "force");
  };
  return force;
}

/** Translates every force node belonging to `attractorId` by (dx, dy); everything else is untouched. */
export function translateGroup(
  nodes: readonly { attractorId?: string; x?: number; y?: number }[],
  attractorId: string,
  dx: number,
  dy: number,
): void {
  for (const node of nodes) {
    if (node.attractorId !== attractorId) continue;
    node.x = (node.x ?? 0) + dx;
    node.y = (node.y ?? 0) + dy;
  }
}

export interface RegionsRenderOptions extends NkpHypergraphOptions {
  /** Draw attractor names above their regions. */
  showNames?: boolean;
}

export interface RegionsViewCtx {
  host: HTMLElement;
  d3: any;
  onToggle: (key: EntityKey) => void;
  onClear: () => void;
}

export interface RegionsViewHandle {
  update: (state: PendingState, options?: Record<string, unknown>) => void;
  setSelection: (selected: ReadonlySet<EntityKey>, connected: ReadonlySet<EntityKey>) => void;
  resetView: () => void;
  destroy: () => void;
  /** Test-only hook (not part of the fixed handle contract): the live d3
   * force simulation, so incremental-update/no-clamping tests can inspect
   * and step physics directly instead of guessing at timing. */
  readonly simulation: { nodes: () => SimNode[]; tick: (iterations?: number) => void } | undefined;
}

/**
 * Persistent regions view handle: the bipartite force<->component hypergraph
 * with attractor regions, following the bundle/heatmap handle pattern (one
 * persistent <svg>, keyed joins, all text in a last g.landscape-labels
 * layer synced by a second namespaced zoom listener). Unlike the other two
 * views the canvas is infinite: nothing clamps node position and there is no
 * translateExtent, so the simulation is free to spread out. The first time
 * it cools below alpha 0.05 the view animates a fit-to-content zoom;
 * resetView() repeats that fit on demand.
 *
 * One d3-force simulation lives for the handle's whole lifetime. update()
 * rebuilds the model and re-joins nodes by id: survivors keep their x/y/vx/vy
 * (and fx/fy, mid-drag), newcomers seed near their attractor's current
 * centroid, else the focus component, else the origin; nodes that fall out
 * of the filtered model are simply dropped from the next simulation.nodes()
 * call. Edge drawing is one small function (positionEdges) so Phase 5 can
 * swap the straight membership lines for curved branch bundles without
 * touching the rest of the tick handler.
 */
export function createRegionsView(ctx: RegionsViewCtx): RegionsViewHandle {
  const { host, d3 } = ctx;

  let built:
    | {
        svg: any;
        zoom: any;
        regionsG: any;
        fusionG: any;
        edgesG: any;
        nodesG: any;
        labelsGroup: any;
        sim: any;
        width: number;
        height: number;
        didFit: boolean;
      }
    | undefined;

  let nodes: SimNode[] = [];
  let byId = new Map<string, SimNode>();
  let links: SimLink[] = [];
  let bundles: RenderBundle[] = [];
  let regionSel: any;
  let fusionSel: any;
  let bundleTrunkSel: any;
  let bundleBranchSel: any;
  let nodeSel: any;
  let componentLabelSel: any;
  let forceLabelSel: any;
  let regionLabelSel: any;
  let lastSelected: ReadonlySet<EntityKey> = new Set();
  let lastConnected: ReadonlySet<EntityKey> = new Set();
  let tickCount = 0;
  let labelShiftByKey = new Map<string, number>();
  let groupColorById = new Map<string, string>();

  function colorFor(attractorId: string): string {
    return groupColorById.get(attractorId) ?? "var(--muted)";
  }

  function canvasSize(): { width: number; height: number } {
    return {
      width: host.clientWidth > 0 ? host.clientWidth : DEFAULT_CANVAS_WIDTH,
      height: host.clientHeight > 0 ? host.clientHeight : DEFAULT_CANVAS_HEIGHT,
    };
  }

  function pointsOfGroup(group: AttractorGroup): Point[] {
    return group.forceNodeIds
      .map((id) => byId.get(id))
      .filter((item): item is SimNode => item !== undefined)
      .map((item) => ({ x: item.x ?? 0, y: item.y ?? 0 }));
  }

  function fitToContent(): void {
    if (!built || nodes.length === 0) return;
    const margin = 80;
    const xs = nodes.map((node) => node.x ?? 0);
    const ys = nodes.map((node) => node.y ?? 0);
    const minX = Math.min(...xs) - margin;
    const maxX = Math.max(...xs) + margin;
    const minY = Math.min(...ys) - margin;
    const maxY = Math.max(...ys) + margin;
    const scale = Math.min(
      8,
      Math.max(0.5, Math.min(built.width / Math.max(1, maxX - minX), built.height / Math.max(1, maxY - minY))),
    );
    const transform = d3.zoomIdentity
      .translate(built.width / 2 - scale * ((minX + maxX) / 2), built.height / 2 - scale * ((minY + maxY) / 2))
      .scale(scale);
    built.svg.transition().duration(400).call(built.zoom.transform, transform);
  }

  // --- per-tick drawing, split out so Phase 5 can swap edges/labels cleanly ---

  function positionRegions(): void {
    regionSel?.select("path").attr("d", (group: AttractorGroup) => regionCorePath(pointsOfGroup(group)));
  }

  function positionFusionHulls(): void {
    fusionSel?.attr("d", (item: { ids: string[] }) =>
      regionCorePath(item.ids.map((id) => {
        const node = byId.get(id);
        return { x: node?.x ?? 0, y: node?.y ?? 0 };
      })));
  }

  /**
   * One branchGeometry per bundle per tick: the trunk path goes on the trunk,
   * each force's branch path on its keyed branch element. Single-force
   * bundles are just the trunk (branchGeometry returns the same curve for both).
   */
  function positionEdges(): void {
    const geometryByBundle = new Map<string, { trunk: string; width: number; branchByForce: Map<string, string> }>();
    for (const bundle of bundles) {
      const component = byId.get(bundle.componentId);
      if (!component) continue;
      const placed = bundle.forceIds
        .map((forceId) => ({ forceId, node: byId.get(`force:${forceId}`) }))
        .filter((item): item is { forceId: string; node: SimNode } => item.node !== undefined);
      const geometry = branchGeometry(
        { x: component.x ?? 0, y: component.y ?? 0 },
        placed.map(({ node }) => ({ x: node.x ?? 0, y: node.y ?? 0 })),
      );
      geometryByBundle.set(bundle.id, {
        trunk: geometry.trunk,
        width: geometry.width,
        branchByForce: new Map(placed.map(({ forceId }, index) => [`force:${forceId}`, geometry.branches[index] ?? ""])),
      });
    }
    bundleTrunkSel
      ?.attr("d", (bundle: RenderBundle) => geometryByBundle.get(bundle.id)?.trunk ?? "")
      .attr("stroke-width", (bundle: RenderBundle) => geometryByBundle.get(bundle.id)?.width ?? 1);
    bundleBranchSel
      ?.attr("d", (branch: RenderBranch) => geometryByBundle.get(branch.bundleId)?.branchByForce.get(branch.forceId) ?? "")
      .attr("stroke-width", (branch: RenderBranch) => Math.max(1, (geometryByBundle.get(branch.bundleId)?.width ?? 1) * 0.62));
  }

  function positionNodes(): void {
    nodeSel?.attr("transform", (node: SimNode) => `translate(${node.x ?? 0},${node.y ?? 0})`);
  }

  /**
   * All text lives outside the node/region groups in g.landscape-labels, so
   * it has to be positioned every tick too. Phase 5 runs nudgeLabels here to
   * de-overlap component/force/region labels.
   */
  function measureLabelBox(element: SVGTextElement, x: number, y: number, text: string): { x: number; y: number; width: number; height: number } {
    const fallbackWidth = Math.max(1, text.length * 6.6);
    const fallbackHeight = 11;
    const box = typeof element.getBBox === "function" ? element.getBBox() : undefined;
    if (box && box.width > 0 && box.height > 0) {
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }
    return {
      x: x - fallbackWidth / 2,
      y: y - fallbackHeight * 0.82,
      width: fallbackWidth,
      height: fallbackHeight,
    };
  }

  function recomputeLabelNudges(force: boolean): void {
    if (!force && tickCount % 5 !== 0) return;
    const keyed: { key: string; x: number; y: number; text: string; element: SVGTextElement }[] = [];
    componentLabelSel?.each(function (this: SVGTextElement, node: SimNode) {
      keyed.push({
        key: node.id,
        x: node.x ?? 0,
        y: (node.y ?? 0) + (node.type === "component" && node.fissionCandidate ? -19 : -13),
        text: node.label ?? "",
        element: this,
      });
    });
    forceLabelSel?.each(function (this: SVGTextElement, node: SimNode) {
      keyed.push({
        key: node.id,
        x: node.x ?? 0,
        y: (node.y ?? 0) - 9,
        text: node.label ?? "",
        element: this,
      });
    });
    regionLabelSel?.each(function (this: SVGTextElement, group: AttractorGroup) {
      const points = pointsOfGroup(group);
      const center = centroid(points);
      if (!center) return;
      const top = Math.min(...points.map((point) => point.y));
      keyed.push({
        key: `attractor:${group.attractorId}`,
        x: center.x,
        y: top - REGION_PADDING - 4,
        text: group.name,
        element: this,
      });
    });
    const boxes = keyed.map((item) => measureLabelBox(item.element, item.x, item.y, item.text));
    const shifts = nudgeLabels(boxes);
    labelShiftByKey = new Map(keyed.map((item, index) => [item.key, shifts[index] ?? 0]));
  }

  function positionLabels(): void {
    componentLabelSel
      ?.attr("x", (node: SimNode) => node.x ?? 0)
      .attr("y", (node: SimNode) => (node.y ?? 0) + (node.type === "component" && node.fissionCandidate ? -19 : -13));
    forceLabelSel
      ?.attr("x", (node: SimNode) => node.x ?? 0)
      .attr("y", (node: SimNode) => (node.y ?? 0) - 9);
    regionLabelSel?.each(function (this: SVGTextElement, group: AttractorGroup) {
      const points = pointsOfGroup(group);
      const center = centroid(points);
      if (!center) return;
      const top = Math.min(...points.map((point) => point.y));
      d3.select(this).attr("x", center.x).attr("y", top - REGION_PADDING - 4);
    });

    tickCount += 1;
    recomputeLabelNudges(false);

    componentLabelSel?.attr("y", (node: SimNode) =>
      (node.y ?? 0) + (node.type === "component" && node.fissionCandidate ? -19 : -13) + (labelShiftByKey.get(node.id) ?? 0));
    forceLabelSel?.attr("y", (node: SimNode) =>
      (node.y ?? 0) - 9 + (labelShiftByKey.get(node.id) ?? 0));
    regionLabelSel?.attr("y", (group: AttractorGroup) => {
      const points = pointsOfGroup(group);
      const center = centroid(points);
      if (!center) return -9999;
      const top = Math.min(...points.map((point) => point.y));
      return top - REGION_PADDING - 4 + (labelShiftByKey.get(`attractor:${group.attractorId}`) ?? 0);
    });
  }

  function tick(): void {
    if (!built) return;
    positionRegions();
    positionFusionHulls();
    positionEdges();
    positionNodes();
    positionLabels();
    if (!built.didFit && built.sim.alpha() < 0.05) {
      built.didFit = true;
      fitToContent();
    }
  }

  function ensureBuilt(): NonNullable<typeof built> {
    if (built) return built;
    const { width, height } = canvasSize();
    const { svg, content, zoom } = appendZoomableSvg(
      host,
      d3,
      { x: 0, y: 0, width, height },
      "nkp-hyper",
      "Forces linked to the components they touch, grouped into attractor regions",
    );
    const regionsG = content.append("g").attr("class", "nkp-hyper-regions");
    const fusionG = content.append("g").attr("class", "nkp-hyper-fusion");
    const edgesG = content.append("g").attr("class", "nkp-hyper-edges");
    const nodesG = content.append("g").attr("class", "nkp-hyper-nodes");
    const labelsGroup = svg.append("g").attr("class", "landscape-labels");
    zoom.on("zoom.labels", (event: { transform: unknown }) => labelsGroup.attr("transform", event.transform));
    svg.on("dblclick", () => ctx.onClear());

    const sim = d3.forceSimulation([])
      .force("link", d3.forceLink([]).id((item: SimNode) => item.id).distance(60).strength(0.18))
      .force("charge", d3.forceManyBody().strength((item: SimNode) => item.type === "component" ? -650 : -130))
      .force("x", d3.forceX(width / 2).strength(0.05))
      .force("y", d3.forceY(height / 2).strength(0.05))
      .force("collision", d3.forceCollide().radius((item: SimNode) => item.type === "component" ? 30 : 9))
      .force("cohesion", createAttractorCohesionForce())
      .force("interaction", createForceInteractionForce())
      .on("tick", tick)
      .on("end", () => {
        recomputeLabelNudges(true);
        positionLabels();
      })
      .stop();

    built = { svg, zoom, regionsG, fusionG, edgesG, nodesG, labelsGroup, sim, width, height, didFit: false };
    return built;
  }

  /** New force nodes seed near their attractor's current centroid, else the focus component, else the origin. */
  function seedPosition(
    item: HyperNode,
    placed: ReadonlyMap<string, SimNode>,
    focusComponentId: string | undefined,
  ): { x: number; y: number } {
    const jitter = (): number => (Math.random() - 0.5) * 30;
    if (item.type === "force") {
      const siblings = [...placed.values()].filter(
        (node): node is SimForceNode => node.type === "force" && node.attractorId === item.attractorId && node.x !== undefined,
      );
      const center = centroid(siblings.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0 })));
      if (center) return { x: center.x + jitter(), y: center.y + jitter() };
    }
    const focus = focusComponentId ? placed.get(focusComponentId) : undefined;
    if (focus?.x !== undefined) return { x: focus.x + jitter(), y: (focus.y ?? 0) + jitter() };
    return { x: jitter(), y: jitter() };
  }

  function applySelectionClasses(): void {
    if (!built) return;
    const hasSelection = lastSelected.size > 0;
    const isSelected = (key: string): boolean => lastSelected.has(key as EntityKey);
    const isConnected = (key: string): boolean => !isSelected(key) && lastConnected.has(key as EntityKey);
    const dim = (key: string): boolean => hasSelection && !isSelected(key) && !isConnected(key);
    const applyToKeyed = (selection: any): void => {
      selection
        ?.classed("selected", (node: SimNode) => isSelected(node.id))
        .classed("connected", (node: SimNode) => isConnected(node.id))
        .classed("dim", (node: SimNode) => dim(node.id));
    };
    applyToKeyed(nodeSel);
    applyToKeyed(componentLabelSel);
    applyToKeyed(forceLabelSel);

    const bundleDim = (bundle: RenderBundle): boolean => {
      if (!hasSelection) return false;
      const keys = [bundle.componentId, ...bundle.forceIds.map((forceId) => `force:${forceId}`)];
      return keys.every((key) => !isSelected(key) && !isConnected(key));
    };
    bundleTrunkSel?.classed("dim", bundleDim);
    const bundleById = new Map(bundles.map((bundle) => [bundle.id, bundle]));
    bundleBranchSel?.classed("dim", (branch: RenderBranch) => {
      const bundle = bundleById.get(branch.bundleId);
      return bundle ? bundleDim(bundle) : hasSelection;
    });
    const regionDim = (group: AttractorGroup): boolean => {
      const key = `attractor:${group.attractorId}`;
      return hasSelection && !(isSelected(key) || isConnected(key));
    };
    regionSel?.classed("dim", regionDim);
    regionLabelSel?.classed("dim", regionDim);
  }

  function update(state: PendingState, rawOptions: Record<string, unknown> = {}): void {
    const options = rawOptions as RegionsRenderOptions;
    const model = buildNkpHypergraphModel(state, options);

    if (model.nodes.length === 0) {
      if (!built) {
        renderEmpty(host, "No forces or components to draw. Loosen the filters or pick another focus component.");
        return;
      }
      const b = ensureBuilt();
      nodes = [];
      byId = new Map();
      links = [];
      bundles = [];
      b.sim.nodes([]);
      (b.sim.force("link") as any).links([]);
      regionSel = b.regionsG.selectAll("g.nkp-hyper-region").data([]).join("g");
      fusionSel = b.fusionG.selectAll("path.nkp-hyper-fusion-hull").data([]).join("path");
      bundleTrunkSel = b.edgesG.selectAll("path.nkp-hyper-bundle-trunk").data([]).join("path");
      bundleBranchSel = b.edgesG.selectAll("path.nkp-hyper-bundle-branch").data([]).join("path");
      nodeSel = b.nodesG.selectAll("g.nkp-node").data([]).join("g");
      componentLabelSel = b.labelsGroup.selectAll("text.nkp-hyper-component-label").data([]).join("text");
      forceLabelSel = b.labelsGroup.selectAll("text.nkp-hyper-force-label").data([]).join("text");
      regionLabelSel = b.labelsGroup.selectAll("text.nkp-hyper-region-label").data([]).join("text");
      return;
    }
    if (host.querySelector(".landscape-empty")) host.replaceChildren();
    const b = ensureBuilt();

    const { width, height } = canvasSize();
    b.width = width;
    b.height = height;
    b.svg.attr("viewBox", `0 0 ${width} ${height}`);
    b.svg.classed("names-hidden", options.showNames === false);
    (b.sim.force("x") as any).x(width / 2);
    (b.sim.force("y") as any).y(height / 2);

    groupColorById = new Map(model.groups.map((group) => [group.attractorId, group.color]));
    const focusComponentId = options.focusComponent ? `component:${options.focusComponent}` : undefined;

    // --- merge nodes by id: survivors keep x/y/vx/vy/fx/fy, newcomers seed, exits just don't reappear ---
    const prevById = byId;
    const nextById = new Map<string, SimNode>();
    nodes = model.nodes.map((item) => {
      const existing = prevById.get(item.id);
      const merged: SimNode = existing
        ? { ...item, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy, fx: existing.fx ?? null, fy: existing.fy ?? null }
        : { ...item, ...seedPosition(item, nextById, focusComponentId), vx: 0, vy: 0 };
      nextById.set(item.id, merged);
      return merged;
    });
    byId = nextById;
    links = model.edges.map((edge) => ({ ...edge }));
    bundles = model.branchBundles.map((bundle) => ({ ...bundle }));

    b.sim.nodes(nodes);
    (b.sim.force("link") as any).links(links);
    b.sim.alpha(0.3).restart();

    // --- regions: filled + wide-stroked core (inflates into a blob), draggable to move their forces ---
    regionSel = b.regionsG.selectAll("g.nkp-hyper-region")
      .data(model.groups, (group: AttractorGroup) => group.attractorId)
      .join((enter: any) => {
        const g = enter.append("g").attr("class", "nkp-hyper-region");
        g.append("path");
        g.append("title");
        return g;
      });
    regionSel.attr("opacity", (group: AttractorGroup) => group.focused ? 0.16 : 0.07);
    regionSel.select("path")
      .attr("fill", (group: AttractorGroup) => group.color)
      .attr("stroke", (group: AttractorGroup) => group.color)
      .attr("stroke-width", REGION_PADDING * 2)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round");
    regionSel.select("title").text((group: AttractorGroup) => group.tooltip);
    regionSel.on("click", (_event: MouseEvent, group: AttractorGroup) => ctx.onToggle(`attractor:${group.attractorId}` as EntityKey));
    regionSel.call(d3.drag()
      .on("start", (event: { active: boolean }, group: AttractorGroup) => {
        if (!event.active) b.sim.alphaTarget(0.15).restart();
        for (const node of nodes) {
          if (node.type === "force" && node.attractorId === group.attractorId) { node.fx = node.x; node.fy = node.y; }
        }
      })
      .on("drag", (event: { dx: number; dy: number }, group: AttractorGroup) => {
        translateGroup(nodes, group.attractorId, event.dx, event.dy);
        for (const node of nodes) {
          if (node.type === "force" && node.attractorId === group.attractorId) { node.fx = node.x; node.fy = node.y; }
        }
      })
      .on("end", (event: { active: boolean }, group: AttractorGroup) => {
        if (!event.active) b.sim.alphaTarget(0);
        for (const node of nodes) {
          if (node.type === "force" && node.attractorId === group.attractorId) { node.fx = null; node.fy = null; }
        }
      }));

    // --- fusion regions: unfilled dashed hull around fusion-candidate components ---
    const fusionData = model.fusionGroups.map((ids) => ({ id: [...ids].sort().join("\u0000"), ids }));
    fusionSel = b.fusionG.selectAll("path.nkp-hyper-fusion-hull")
      .data(fusionData, (item: { id: string }) => item.id)
      .join("path")
      .attr("class", "nkp-hyper-fusion-hull");

    // --- edges: one branch bundle per (component, attractor) ---
    bundleTrunkSel = b.edgesG.selectAll("path.nkp-hyper-bundle-trunk")
      .data(bundles, (bundle: RenderBundle) => bundle.id)
      .join("path")
      .attr("class", "nkp-hyper-bundle-trunk")
      .attr("fill", "none")
      .attr("stroke", (bundle: RenderBundle) => colorFor(bundle.attractorId))
      .attr("stroke-opacity", (bundle: RenderBundle) => bundle.focused ? 0.45 : 0.15);
    const branchData: RenderBranch[] = bundles
      .filter((bundle) => bundle.forceIds.length > 1)
      .flatMap((bundle) => bundle.forceIds.map((forceId) => ({
        id: `${bundle.id}:${forceId}`,
        bundleId: bundle.id,
        componentId: bundle.componentId,
        forceId: `force:${forceId}`,
        attractorId: bundle.attractorId,
        focused: bundle.focused,
      })));
    bundleBranchSel = b.edgesG.selectAll("path.nkp-hyper-bundle-branch")
      .data(branchData, (branch: RenderBranch) => branch.id)
      .join("path")
      .attr("class", "nkp-hyper-bundle-branch")
      .attr("fill", "none")
      .attr("stroke", (branch: RenderBranch) => colorFor(branch.attractorId))
      .attr("stroke-opacity", (branch: RenderBranch) => branch.focused ? 0.45 : 0.15);

    // --- nodes: component (ring + dot) and force (diamond/circle glyph) share one <g> shape ---
    const nodeJoin = b.nodesG.selectAll("g.nkp-node")
      .data(nodes, (node: SimNode) => node.id)
      .join((enter: any) => {
        const g = enter.append("g");
        g.append("circle").attr("class", "nkp-fission-ring").attr("r", 15).attr("fill", "none").attr("stroke-dasharray", "3 4");
        g.append("circle").attr("class", "nkp-node-dot").attr("r", 9);
        g.append("path").attr("class", "nkp-hyper-force-dot");
        g.append("title");
        return g;
      });
    nodeSel = nodeJoin
      .attr("class", (node: SimNode) => `nkp-node nkp-hyper-node nkp-hyper-${node.type}`)
      .attr("opacity", (node: SimNode) => node.focused ? 1 : 0.45);
    nodeSel.select(".nkp-fission-ring")
      .attr("display", (node: SimNode) => node.type === "component" && node.fissionCandidate ? null : "none");
    nodeSel.select(".nkp-node-dot")
      .attr("class", (node: SimNode) => node.type === "component" ? `nkp-node-dot status-${node.status}` : "nkp-node-dot")
      .attr("display", (node: SimNode) => node.type === "component" ? null : "none");
    nodeSel.select(".nkp-hyper-force-dot")
      .attr("d", (node: SimNode) => node.type === "force" ? forceGlyphPath(node.kind) : null)
      .attr("fill", (node: SimNode) => node.type === "force" ? colorFor(node.attractorId) : null)
      .attr("fill-opacity", (node: SimNode) => node.type === "force" ? forceNodeOpacity(node.kind) : null)
      .attr("display", (node: SimNode) => node.type === "force" ? null : "none");
    nodeSel.select("title").text((node: SimNode) => node.tooltip);
    nodeSel.on("click", (_event: MouseEvent, node: SimNode) => ctx.onToggle(node.id as EntityKey));
    nodeSel.call(d3.drag()
      .on("start", (event: { active: boolean }, node: SimNode) => {
        if (!event.active) b.sim.alphaTarget(0.3).restart();
        node.fx = node.x; node.fy = node.y;
      })
      .on("drag", (event: { x: number; y: number }, node: SimNode) => {
        node.fx = event.x; node.fy = event.y;
      })
      .on("end", (event: { active: boolean }, node: SimNode) => {
        if (!event.active) b.sim.alphaTarget(0);
        node.fx = null; node.fy = null;
      }));

    // --- labels: every text element lives here so it always paints on top ---
    const componentNodes = nodes.filter((node) => node.type === "component");
    componentLabelSel = b.labelsGroup.selectAll("text.nkp-hyper-component-label")
      .data(componentNodes, (node: SimNode) => node.id)
      .join("text")
      .attr("class", (node: SimNode) => `nkp-hyper-component nkp-node-label nkp-hyper-component-label${node.type === "component" && node.fissionCandidate ? " fission" : ""}`)
      .attr("text-anchor", "middle")
      .text((node: SimNode) => node.label);
    componentLabelSel.on("click", (_event: MouseEvent, node: SimNode) => ctx.onToggle(node.id as EntityKey));

    const forceNodes = nodes.filter((node): node is SimForceNode => node.type === "force");
    forceLabelSel = b.labelsGroup.selectAll("text.nkp-hyper-force-label")
      .data(forceNodes, (node: SimNode) => node.id)
      .join("text")
      .attr("class", "nkp-hyper-force nkp-node-label nkp-hyper-force-label")
      .attr("text-anchor", "middle")
      .attr("opacity", 0)
      .text((node: SimNode) => node.label);
    forceLabelSel.on("click", (_event: MouseEvent, node: SimNode) => ctx.onToggle(node.id as EntityKey));

    regionLabelSel = b.labelsGroup.selectAll("text.nkp-hyper-region-label")
      .data(model.groups, (group: AttractorGroup) => group.attractorId)
      .join("text")
      .attr("class", "nkp-hyper-region-label")
      .attr("text-anchor", "middle")
      .attr("fill", (group: AttractorGroup) => group.color)
      .attr("opacity", (group: AttractorGroup) => group.focused ? 0.9 : 0.4)
      .text((group: AttractorGroup) => group.name);

    // --- hover: highlight the hovered node's neighbourhood and attractor regions ---
    const neighbours = new Map<string, Set<string>>();
    for (const edge of model.edges) {
      neighbours.set(edge.source, (neighbours.get(edge.source) ?? new Set()).add(edge.target));
      neighbours.set(edge.target, (neighbours.get(edge.target) ?? new Set()).add(edge.source));
    }
    const attractorOfForce = (id: string): string | undefined => {
      const item = byId.get(id);
      return item?.type === "force" ? item.attractorId : undefined;
    };
    const clearHighlight = (): void => {
      b.svg.classed("nkp-hyper-hovering", false);
      nodeSel.classed("is-lit", false);
      bundleTrunkSel.classed("is-lit", false);
      bundleBranchSel.classed("is-lit", false);
      regionSel.classed("is-lit", false);
      regionLabelSel.classed("is-lit", false);
      forceLabelSel.attr("opacity", 0);
    };
    const highlight = (item: SimNode): void => {
      const lit = new Set([item.id, ...(neighbours.get(item.id) ?? [])]);
      const forceIds = item.type === "force" ? [item.id] : [...(neighbours.get(item.id) ?? [])];
      const litAttractors = new Set(forceIds.map(attractorOfForce).filter((id): id is string => id !== undefined));
      b.svg.classed("nkp-hyper-hovering", true);
      nodeSel.classed("is-lit", (other: SimNode) => lit.has(other.id));
      const branchLit = (bundle: RenderBundle): boolean => {
        if (item.id === bundle.componentId) return true;
        return bundle.forceIds.some((forceId) => `force:${forceId}` === item.id);
      };
      bundleTrunkSel.classed("is-lit", branchLit);
      bundleBranchSel.classed("is-lit", (branch: RenderBranch) => {
        const bundle = bundles.find((candidate) => candidate.id === branch.bundleId);
        return bundle ? branchLit(bundle) : false;
      });
      regionSel.classed("is-lit", (group: AttractorGroup) => litAttractors.has(group.attractorId));
      regionLabelSel.classed("is-lit", (group: AttractorGroup) => litAttractors.has(group.attractorId));
      forceLabelSel.attr("opacity", (other: SimNode) => other.id === item.id ? 1 : 0);
    };
    nodeSel.on("mouseenter", (_event: unknown, item: SimNode) => highlight(item))
      .on("mouseleave", clearHighlight);

    applySelectionClasses();
  }

  function setSelection(selected: ReadonlySet<EntityKey>, connected: ReadonlySet<EntityKey>): void {
    lastSelected = selected;
    lastConnected = connected;
    applySelectionClasses();
  }

  function resetView(): void {
    fitToContent();
  }

  function destroy(): void {
    built?.sim.stop();
    built = undefined;
    nodes = [];
    byId = new Map();
    links = [];
    host.replaceChildren();
  }

  return {
    update,
    setSelection,
    resetView,
    destroy,
    get simulation() {
      return built?.sim;
    },
  };
}
