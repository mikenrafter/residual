// Alternative "hypergraph" rendering of the live NKP graph. Instead of
// expanding each force into a component-component clique, every force is its
// own small node joined to each component it touches (bipartite force <->
// component graph, one edge per membership). Attractors are no longer pinned
// nodes: each is drawn as a soft translucent region around its force nodes,
// recomputed every tick, so attractor groups float freely and overlapping
// regions show components sitting between attractors.

import type { PendingState } from "./model";
import { attractorColors, buildNkpGraphModel, effectiveState, forceLabel, type EffectiveForce } from "./nkp-graph";
import { appendZoomableSvg, createTooltip, placeTooltip, renderEmpty } from "./landscape-dom";
import type { EntityKey } from "./landscape-selection";
import { branchGeometry, nudgeLabels, projectLabelAnchor, tessellateNodes } from "./landscape-geometry";

export interface HyperComponentNode {
  id: string;
  type: "component";
  label: string;
  status: "actual" | "proposed";
  shape: "circle" | "square";
  color: string;
  dominantAttractorId?: string;
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
  componentIds: string[];
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
  const sharedComponents = new Map(buildNkpGraphModel(state, { minCouplingStrength: 1 }).nodes
    .filter((node) => node.type === "component")
    .map((node) => [node.id, node]));
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
    const shared = sharedComponents.get(`component:${component.name}`);
    return {
      id: `component:${component.name}`,
      type: "component",
      label: component.name,
      status: component.status,
      shape: shared?.shape ?? (component.status === "actual" ? "circle" : "square"),
      color: shared?.color ?? "var(--muted)",
      ...(shared?.dominantAttractorId ? { dominantAttractorId: shared.dominantAttractorId } : {}),
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
    componentIds: [...new Set(force.components)].map((name) => `component:${name}`),
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

  let nodes: HyperNode[] = [...forceNodes, ...componentNodes];
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

/** A padded convex hull that has paintable area even for one or two points. */
export function paddedRegionPath(points: readonly Point[], padding: number): string {
  const radius = Math.max(0, padding);
  if (points.length === 0) return "";
  const expanded = points.flatMap((point) => [
    { x: point.x - radius, y: point.y - radius },
    { x: point.x + radius, y: point.y - radius },
    { x: point.x + radius, y: point.y + radius },
    { x: point.x - radius, y: point.y + radius },
  ]);
  return regionCorePath(expanded);
}

export function centroid(points: readonly Point[]): Point | undefined {
  if (points.length === 0) return undefined;
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Core zone geometry: components live in a soft central "core" region that
 * grows sub-linearly with the number of components (sqrt), so a landscape
 * with many components doesn't blow up the core radius proportionally.
 */
export const CORE_ZONE_BASE_RADIUS = 60;
export const CORE_ZONE_RADIUS_PER_COMPONENT = 8;

export function coreZoneRadius(componentCount: number): number {
  const count = Math.max(0, componentCount);
  return CORE_ZONE_BASE_RADIUS + CORE_ZONE_RADIUS_PER_COMPONENT * Math.sqrt(count);
}

/**
 * Projects `point` onto the boundary of the circle of `radius` around
 * `center` when it lies outside it; points already inside are unchanged.
 */
export function clampToCore(point: Point, center: Point, radius: number): Point {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius) return point;
  if (distance === 0) return { x: center.x + radius, y: center.y };
  const scale = radius / distance;
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/**
 * Distance from `center` to the closest force-type node belonging to
 * `attractorId` (component-type nodes never count, even when closer).
 * Infinity when the attractor has no force members.
 */
export function attractorCoreDistance(
  nodes: readonly { type: string; attractorId?: string; x?: number; y?: number }[],
  attractorId: string,
  center: Point,
): number {
  let min = Infinity;
  for (const node of nodes) {
    if (node.type !== "force" || node.attractorId !== attractorId) continue;
    const dx = (node.x ?? 0) - center.x;
    const dy = (node.y ?? 0) - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance < min) min = distance;
  }
  return min;
}

export interface GroupCircle {
  attractorId: string;
  center: Point;
  radius: number;
}

/**
 * Summarizes each attractor's force nodes (component nodes never contribute)
 * as a padded bounding circle: centroid of the force-node positions, radius
 * the farthest force node from that centroid plus `padding`.
 */
export function attractorGroupCircles(
  nodes: readonly { type: string; attractorId?: string; x?: number; y?: number }[],
  padding: number,
): GroupCircle[] {
  const byAttractor = new Map<string, Point[]>();
  for (const node of nodes) {
    if (node.type !== "force" || node.attractorId === undefined) continue;
    const points = byAttractor.get(node.attractorId) ?? [];
    points.push({ x: node.x ?? 0, y: node.y ?? 0 });
    byAttractor.set(node.attractorId, points);
  }
  const circles: GroupCircle[] = [];
  for (const [attractorId, points] of byAttractor) {
    const center = centroid(points) ?? { x: 0, y: 0 };
    const farthest = points.reduce(
      (max, point) => Math.max(max, Math.hypot(point.x - center.x, point.y - center.y)),
      0,
    );
    circles.push({ attractorId, center, radius: farthest + padding });
  }
  return circles;
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
const FUSION_REGION_PADDING = 18;
const DEFAULT_CANVAS_WIDTH = 800;
const DEFAULT_CANVAS_HEIGHT = 600;

export const REGIONS_LATTICE_CELL_SIZE = 48;
export const REGIONS_MIN_NODE_DISTANCE = 32;
export const REGIONS_COMPONENT_COLLISION_RADIUS = 30;
/**
 * Half of REGIONS_MIN_NODE_DISTANCE: forceCollide resolves overlaps every
 * tick (unlike the lattice force, which only relaxes toward a snapshot taken
 * at sparse events), so it is what actually keeps two force nodes apart
 * against sustained intra-attractor attraction. It has to match the
 * tessellation's minimum distance or that minimum is only nominal.
 */
export const REGIONS_FORCE_COLLISION_RADIUS = REGIONS_MIN_NODE_DISTANCE / 2;

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
  id?: string;
  type?: string;
  attractorId?: string;
  x?: number;
  y?: number;
}

export interface ForceInteractionSource extends ForceInteractionNode {
  kind: "stressor" | "purpose";
  componentIds?: string[];
}

/**
 * Pure effect of `source` on `target`. Stressors attract force peers in the
 * same attractor and their direct component targets. Purposes repel force
 * peers outside their attractor and components they do not directly touch.
 */
export function forceInteractionDelta(
  source: ForceInteractionSource,
  target: ForceInteractionNode,
  params: { distanceMax: number },
): { vx: number; vy: number } {
  const zero = { vx: 0, vy: 0 };
  const targetIsComponent = target.type === "component" || target.id?.startsWith("component:") === true;
  const targetIsForce = target.type === "force" || target.id?.startsWith("force:") === true;
  const directlyConnected = target.id !== undefined && (source.componentIds ?? []).includes(target.id);
  const interacts = source.kind === "stressor"
    ? (targetIsForce && source.attractorId !== undefined && target.attractorId === source.attractorId)
      || (targetIsComponent && directlyConnected)
    : (targetIsForce && source.attractorId !== undefined && target.attractorId !== undefined
        && target.attractorId !== source.attractorId)
      || (targetIsComponent && !directlyConnected);
  if (!interacts) return zero;
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

/** d3 force applying every force source to eligible force and component targets. */
function createForceInteractionForce(distanceMax = FORCE_INTERACTION_DISTANCE_MAX) {
  let interactionNodes: SimNode[] = [];
  const force = (alpha: number): void => {
    for (const target of interactionNodes) {
      if (target.fx != null) continue;
      let dvx = 0;
      let dvy = 0;
      for (const source of interactionNodes) {
        if (source.type !== "force") continue;
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
    interactionNodes = nodes;
  };
  return force;
}

/**
 * Pushes apart any two attractor group circles (see attractorGroupCircles)
 * whose bounding circles overlap: every force node of both groups is nudged
 * along the inter-centroid axis, scaled by the overlap amount and alpha.
 */
function createRegionCollisionForce(padding = REGION_PADDING) {
  let collideNodes: SimNode[] = [];
  const force = (alpha: number): void => {
    const circles = attractorGroupCircles(collideNodes, padding);
    for (let i = 0; i < circles.length; i += 1) {
      for (let j = i + 1; j < circles.length; j += 1) {
        const a = circles[i]!;
        const b = circles[j]!;
        const dx = b.center.x - a.center.x;
        const dy = b.center.y - a.center.y;
        const distance = Math.hypot(dx, dy);
        const minDistance = a.radius + b.radius;
        if (distance >= minDistance) continue;
        const overlap = minDistance - distance;
        const safeDistance = distance || 0.01;
        const ux = dx / safeDistance;
        const uy = dy / safeDistance;
        const push = overlap * 0.5 * alpha;
        for (const node of collideNodes) {
          if (node.type !== "force" || node.fx != null) continue;
          if (node.attractorId === a.attractorId) {
            node.vx = (node.vx ?? 0) - ux * push;
            node.vy = (node.vy ?? 0) - uy * push;
          } else if (node.attractorId === b.attractorId) {
            node.vx = (node.vx ?? 0) + ux * push;
            node.vy = (node.vy ?? 0) + uy * push;
          }
        }
      }
    }
  };
  force.initialize = (nextNodes: SimNode[]): void => {
    collideNodes = nextNodes;
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

export interface RegionLock {
  attractorId: string;
  anchor: Point;
  offsets: Map<string, Point>;
}

export interface RegionsLockState {
  enabled: boolean;
  locks: Map<string, RegionLock>;
}

export interface RegionLockNode {
  id: string;
  type: string;
  attractorId?: string;
  x?: number;
  y?: number;
}

/** Captures force positions relative to their attractor centroid. */
export function captureRegionLock(
  nodes: readonly RegionLockNode[],
  attractorId: string,
): RegionLock | undefined {
  const members = nodes.filter((node) => node.type === "force" && node.attractorId === attractorId);
  const points = members.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0 }));
  const anchor = centroid(points);
  if (anchor === undefined) return undefined;
  return {
    attractorId,
    anchor,
    offsets: new Map(members.map((node) => [node.id, {
      x: (node.x ?? 0) - anchor.x,
      y: (node.y ?? 0) - anchor.y,
    }])),
  };
}

/** Applies saved offsets to members present in the current filtered node set. */
export function applyRegionLock(lock: RegionLock, nodes: RegionLockNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const [id, offset] of lock.offsets) {
    const node = byId.get(id);
    if (node === undefined || node.type !== "force") continue;
    node.x = lock.anchor.x + offset.x;
    node.y = lock.anchor.y + offset.y;
  }
}

/** Returns a translated lock while preserving all saved member offsets. */
export function moveRegionLock(lock: RegionLock, anchor: Point): RegionLock {
  return { ...lock, anchor: { ...anchor }, offsets: new Map(lock.offsets) };
}

/** Updates one force's saved offset from an absolute dragged position. */
export function editRegionForceOffset(lock: RegionLock, forceId: string, point: Point): RegionLock {
  if (!lock.offsets.has(forceId)) return { ...lock, offsets: new Map(lock.offsets) };
  const offsets = new Map(lock.offsets);
  offsets.set(forceId, { x: point.x - lock.anchor.x, y: point.y - lock.anchor.y });
  return { ...lock, offsets };
}

export interface RegionsRenderOptions extends NkpHypergraphOptions {
  /** Draw attractor names above their regions. */
  showNames?: boolean;
  /** Pin each attractor's force nodes as a movable region. */
  lockRegions?: boolean;
  /** Shared with the bundle view: how tightly branch trunks converge (0 loose, 1 tight). */
  tension?: number;
}

export interface RegionsViewCtx {
  host: HTMLElement;
  d3: any;
  onToggle: (key: EntityKey) => void;
  onClear: () => void;
  /** Controller-owned state keeps locks through filters and view switches. */
  lockState?: RegionsLockState;
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
 * centroid, else the focus component, else the canvas centre; nodes that fall out
 * of the filtered model are simply dropped from the next simulation.nodes()
 * call. Edge drawing is one small function (positionEdges) so Phase 5 can
 * swap the straight membership lines for curved branch bundles without
 * touching the rest of the tick handler.
 */
export function createRegionsView(ctx: RegionsViewCtx): RegionsViewHandle {
  const { host, d3 } = ctx;
  const lockState: RegionsLockState = ctx.lockState ?? { enabled: false, locks: new Map() };

  let built:
    | {
        svg: any;
        zoom: any;
        regionsG: any;
        fusionG: any;
        edgesG: any;
        nodesG: any;
        labelsGroup: any;
        coreBoundary: any;
        sim: any;
        width: number;
        height: number;
        didFit: boolean;
        tip: HTMLElement;
      }
    | undefined;

  let nodes: SimNode[] = [];
  let byId = new Map<string, SimNode>();
  let links: SimLink[] = [];
  let bundles: RenderBundle[] = [];
  /** Current pan/zoom, kept in sync so label bounds can be projected into the
   * viewport actually on screen instead of the pre-zoom/pre-pan viewport. */
  let currentTransform: { invertX: (x: number) => number; invertY: (y: number) => number } = d3.zoomIdentity;
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
  let latticeTargets = new Map<string, Point>();
  const regionPinnedIds = new Set<string>();
  const draggingNodeIds = new Set<string>();
  const draggingRegionIds = new Set<string>();
  /** Force nodes pinned by the core-exclusion force specifically, tracked
   * separately from regionPinnedIds (the manual lock-toggle mechanism) so
   * releasing one never clobbers the other. */
  const coreExclusionPinnedIds = new Set<string>();
  /** Canvas centre and current bundle tension, recomputed once per update()
   * and read every tick by the core-zone forces and positionEdges(). */
  let coreCenter: Point = { x: DEFAULT_CANVAS_WIDTH / 2, y: DEFAULT_CANVAS_HEIGHT / 2 };
  let currentTension = 1;

  const latticeForce = (alpha: number): void => {
    const strength = Math.min(0.35, 0.18 + alpha * 0.2);
    for (const node of nodes) {
      if (node.fx != null || node.fy != null) continue;
      const target = latticeTargets.get(node.id);
      if (!target) continue;
      node.vx = (node.vx ?? 0) + (target.x - (node.x ?? 0)) * strength * alpha;
      node.vy = (node.vy ?? 0) + (target.y - (node.y ?? 0)) * strength * alpha;
    }
  };
  latticeForce.initialize = (): void => {};

  /**
   * Keeps every component node inside the core zone: any component found
   * outside the circle is clamped straight back to the boundary. Component
   * nodes are never pinned by drag/lock the way force nodes are, but an
   * active drag sets fx/fy on any node type, so that is still respected.
   */
  const coreContainmentForce = (): void => {
    const componentCount = nodes.filter((node) => node.type === "component").length;
    const radius = coreZoneRadius(componentCount);
    for (const node of nodes) {
      if (node.type !== "component" || node.fx != null) continue;
      const clamped = clampToCore({ x: node.x ?? 0, y: node.y ?? 0 }, coreCenter, radius);
      node.x = clamped.x;
      node.y = clamped.y;
      // Earlier forces this same tick (charge/x/y/collision/...) may have
      // accumulated a large velocity while the node was still far outside
      // the zone; d3-force's own position integration runs *after* every
      // registered force and always applies node.vx on top of whatever x we
      // just set, so that stale velocity has to be zeroed here or it would
      // immediately carry the node back out again.
      node.vx = 0;
      node.vy = 0;
    }
  };
  coreContainmentForce.initialize = (): void => {};

  /**
   * Pins an attractor's whole force-node group in place the instant it
   * touches the core zone (rather than letting cohesion/interaction pull it
   * deeper toward the component-only centre), and releases that pin once the
   * group is back outside. Only manages fx/fy it set itself, and only while
   * the manual lock toggle is off and no drag is in progress for that
   * attractor/node, so it never fights those pre-existing mechanisms.
   */
  const coreExclusionForce = (): void => {
    if (lockState.enabled) return;
    const componentCount = nodes.filter((node) => node.type === "component").length;
    const radius = coreZoneRadius(componentCount);
    const attractorIds = [...new Set(
      nodes.filter((node): node is SimForceNode => node.type === "force").map((node) => node.attractorId),
    )];
    const distanceByAttractor = new Map(attractorIds.map((id) => [id, attractorCoreDistance(nodes, id, coreCenter)]));
    const touchingCount = [...distanceByAttractor.values()].filter((distance) => distance < radius).length;
    for (const attractorId of attractorIds) {
      if (draggingRegionIds.has(attractorId)) continue;
      const distance = distanceByAttractor.get(attractorId) ?? Infinity;
      // When two or more attractor groups are simultaneously touching the
      // core zone (e.g. they collided right at the centre), back off instead
      // of freezing every member of every group exactly where they
      // collided — regionCollision needs room to push them apart first.
      const touching = distance < radius && touchingCount <= 1;
      for (const node of nodes) {
        if (node.type !== "force" || node.attractorId !== attractorId) continue;
        if (draggingNodeIds.has(node.id)) continue;
        if (touching) {
          node.fx = node.x;
          node.fy = node.y;
          coreExclusionPinnedIds.add(node.id);
        } else if (coreExclusionPinnedIds.has(node.id)) {
          node.fx = null;
          node.fy = null;
          coreExclusionPinnedIds.delete(node.id);
        }
      }
    }
  };
  coreExclusionForce.initialize = (): void => {};

  function deterministicOffset(id: string): Point {
    let hash = 2166136261;
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const angle = ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
    const radius = 8 + ((hash >>> 8) & 15);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }

  /**
   * Rebuilds exclusive lattice targets. Nodes outside `snapIds` reserve their
   * current cells, which prevents filter updates from moving survivors.
   */
  function refreshLatticeTargets(snapIds: ReadonlySet<string> = new Set()): void {
    const placed = tessellateNodes(nodes.map((node) => ({
      id: node.id,
      x: node.x ?? 0,
      y: node.y ?? 0,
      ...(snapIds.has(node.id) ? {} : { fx: node.x ?? 0, fy: node.y ?? 0 }),
    })), {
      cellSize: REGIONS_LATTICE_CELL_SIZE,
      minDistance: REGIONS_MIN_NODE_DISTANCE,
    });
    latticeTargets = new Map(placed.map((item) => [item.id, { x: item.x, y: item.y }]));
    for (const node of nodes) {
      if (!snapIds.has(node.id)) continue;
      const point = latticeTargets.get(node.id);
      if (!point) continue;
      node.x = point.x;
      node.y = point.y;
      node.vx = 0;
      node.vy = 0;
    }
  }

  function pinLockedMembers(lock: RegionLock): void {
    applyRegionLock(lock, nodes);
    for (const node of nodes) {
      if (node.type !== "force" || node.attractorId !== lock.attractorId || !lock.offsets.has(node.id)) continue;
      node.fx = node.x;
      node.fy = node.y;
      regionPinnedIds.add(node.id);
    }
  }

  /** Adds newly visible forces to an existing lock at the nearest free cell. */
  function includeNewLockMembers(lock: RegionLock): RegionLock {
    let next = lock;
    const additions = nodes
      .filter((node): node is SimForceNode => node.type === "force"
        && node.attractorId === lock.attractorId
        && !lock.offsets.has(node.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const node of additions) {
      const offset = deterministicOffset(node.id);
      node.x = next.anchor.x + offset.x;
      node.y = next.anchor.y + offset.y;
      refreshLatticeTargets(new Set([node.id]));
      next = {
        ...next,
        offsets: new Map(next.offsets).set(node.id, {
          x: (node.x ?? 0) - next.anchor.x,
          y: (node.y ?? 0) - next.anchor.y,
        }),
      };
    }
    return next;
  }

  function syncRegionLocks(groups: readonly AttractorGroup[], enabled: boolean): void {
    const wasEnabled = lockState.enabled;
    lockState.enabled = enabled;
    if (!enabled) {
      for (const id of regionPinnedIds) {
        if (draggingNodeIds.has(id)) continue;
        const node = byId.get(id);
        if (node?.type === "force" && draggingRegionIds.has(node.attractorId)) continue;
        if (node) { node.fx = null; node.fy = null; }
      }
      regionPinnedIds.clear();
      if (wasEnabled) lockState.locks.clear();
      return;
    }

    for (const group of groups) {
      let lock = lockState.locks.get(group.attractorId)
        ?? captureRegionLock(nodes, group.attractorId);
      if (!lock) continue;
      applyRegionLock(lock, nodes);
      lock = includeNewLockMembers(lock);
      lockState.locks.set(group.attractorId, lock);
      pinLockedMembers(lock);
    }
    refreshLatticeTargets();
  }

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
      paddedRegionPath(item.ids.map((id) => {
        const node = byId.get(id);
        return { x: node?.x ?? 0, y: node?.y ?? 0 };
      }), FUSION_REGION_PADDING));
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
        undefined,
        currentTension,
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
    if (!built) return;
    // Node/label coordinates live in model space; the screen viewport moves
    // under them as the user pans/zooms. Invert the on-screen padded box
    // through the live transform so "visible" tracks the actual viewport
    // instead of the viewport at load time (identity transform).
    const screenLeft = 8;
    const screenTop = 8;
    const screenRight = Math.max(screenLeft, built.width - 8);
    const screenBottom = Math.max(screenTop, built.height - 8);
    const left = currentTransform.invertX(screenLeft);
    const top = currentTransform.invertY(screenTop);
    const right = currentTransform.invertX(screenRight);
    const bottom = currentTransform.invertY(screenBottom);
    const bounds = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    componentLabelSel
      ?.attr("x", (node: SimNode) => projectLabelAnchor({ x: node.x ?? 0, y: (node.y ?? 0) + (node.type === "component" && node.fissionCandidate ? -19 : -13) }, bounds).x)
      .attr("y", (node: SimNode) => projectLabelAnchor({ x: node.x ?? 0, y: (node.y ?? 0) + (node.type === "component" && node.fissionCandidate ? -19 : -13) }, bounds).y);
    forceLabelSel
      ?.attr("x", (node: SimNode) => projectLabelAnchor({ x: node.x ?? 0, y: (node.y ?? 0) - 9 }, bounds).x)
      .attr("y", (node: SimNode) => projectLabelAnchor({ x: node.x ?? 0, y: (node.y ?? 0) - 9 }, bounds).y);
    regionLabelSel?.each(function (this: SVGTextElement, group: AttractorGroup) {
      const points = pointsOfGroup(group);
      const center = centroid(points);
      if (!center) return;
      const top = Math.min(...points.map((point) => point.y));
      const preferredRegion = convexHull(points);
      const anchor = projectLabelAnchor(
        { x: center.x, y: top - REGION_PADDING - 4 },
        bounds,
        preferredRegion.length >= 3 ? preferredRegion : [],
      );
      d3.select(this).attr("x", anchor.x).attr("y", anchor.y);
    });

    tickCount += 1;
    recomputeLabelNudges(false);

    componentLabelSel?.attr("y", (node: SimNode) => {
      const base = projectLabelAnchor({ x: node.x ?? 0, y: (node.y ?? 0) + (node.type === "component" && node.fissionCandidate ? -19 : -13) }, bounds);
      return projectLabelAnchor({ x: base.x, y: base.y + (labelShiftByKey.get(node.id) ?? 0) }, bounds).y;
    });
    forceLabelSel?.attr("y", (node: SimNode) => {
      const base = projectLabelAnchor({ x: node.x ?? 0, y: (node.y ?? 0) - 9 }, bounds);
      return projectLabelAnchor({ x: base.x, y: base.y + (labelShiftByKey.get(node.id) ?? 0) }, bounds).y;
    });
    regionLabelSel?.attr("y", (group: AttractorGroup) => {
      const points = pointsOfGroup(group);
      const center = centroid(points);
      if (!center) return -9999;
      const top = Math.min(...points.map((point) => point.y));
      const preferredRegion = convexHull(points);
      const anchor = projectLabelAnchor(
        { x: center.x, y: top - REGION_PADDING - 4 + (labelShiftByKey.get(`attractor:${group.attractorId}`) ?? 0) },
        bounds,
        preferredRegion.length >= 3 ? preferredRegion : [],
      );
      return anchor.y;
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
    const coreG = content.append("g").attr("class", "nkp-hyper-core");
    const coreBoundary = coreG.append("circle")
      .attr("class", "nkp-hyper-core-boundary")
      .attr("data-core-boundary", "true")
      .attr("fill", "none")
      .attr("stroke-dasharray", "4 4");
    const regionsG = content.append("g").attr("class", "nkp-hyper-regions");
    const fusionG = content.append("g").attr("class", "nkp-hyper-fusion");
    const edgesG = content.append("g").attr("class", "nkp-hyper-edges");
    const nodesG = content.append("g").attr("class", "nkp-hyper-nodes");
    const labelsGroup = svg.append("g").attr("class", "landscape-labels");
    zoom.on("zoom.labels", (event: { transform: typeof currentTransform }) => {
      currentTransform = event.transform;
      labelsGroup.attr("transform", event.transform);
    });
    svg.on("dblclick", () => ctx.onClear());

    const sim = d3.forceSimulation([])
      .force("link", d3.forceLink([]).id((item: SimNode) => item.id).distance(60).strength(0.18))
      .force("charge", d3.forceManyBody().strength((item: SimNode) => item.type === "component" ? -650 : -130))
      .force("x", d3.forceX(width / 2).strength(0.05))
      .force("y", d3.forceY(height / 2).strength(0.05))
      .force("collision", d3.forceCollide().radius((item: SimNode) => item.type === "component"
        ? REGIONS_COMPONENT_COLLISION_RADIUS
        : REGIONS_FORCE_COLLISION_RADIUS))
      .force("lattice", latticeForce)
      .force("cohesion", createAttractorCohesionForce())
      .force("interaction", createForceInteractionForce())
      .force("coreContainment", coreContainmentForce)
      .force("coreExclusion", coreExclusionForce)
      .force("regionCollision", createRegionCollisionForce())
      .on("tick", tick)
      .on("end", () => {
        recomputeLabelNudges(true);
        positionLabels();
      })
      .stop();

    built = { svg, zoom, regionsG, fusionG, edgesG, nodesG, labelsGroup, coreBoundary, sim, width, height, didFit: false, tip: createTooltip(host) };
    return built;
  }

  /**
   * Pushes `point` to just outside the core zone along its own direction from
   * `center` (falling back to `offset`'s direction, then a fixed axis, when
   * `point` lands exactly on `center`).
   */
  function pushOutsideCore(point: Point, center: Point, radius: number, offset: Point): Point {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= radius) return point;
    let dirX = dx;
    let dirY = dy;
    if (distance === 0) {
      dirX = offset.x !== 0 || offset.y !== 0 ? offset.x : 1;
      dirY = offset.x !== 0 || offset.y !== 0 ? offset.y : 0;
    }
    const dirDistance = Math.hypot(dirX, dirY) || 1;
    const margin = 1;
    const scale = (radius + margin) / dirDistance;
    return { x: center.x + dirX * scale, y: center.y + dirY * scale };
  }

  /**
   * New force nodes seed near their attractor's current centroid, else the
   * focus component, else the canvas centre — then get pushed just outside
   * the core zone if that seed would otherwise land inside it. New component
   * nodes seed near the canvas centre/focus and get clamped inside the core
   * zone if that seed would otherwise land outside it.
   */
  function seedPosition(
    item: HyperNode,
    placed: ReadonlyMap<string, SimNode>,
    focusComponentId: string | undefined,
    componentCount: number,
  ): { x: number; y: number } {
    const offset = deterministicOffset(item.id);
    const { width, height } = canvasSize();
    const center = { x: width / 2, y: height / 2 };
    const radius = coreZoneRadius(componentCount);
    if (item.type === "force") {
      const siblings = [...placed.values()].filter(
        (node): node is SimForceNode => node.type === "force" && node.attractorId === item.attractorId && node.x !== undefined,
      );
      const siblingCenter = centroid(siblings.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0 })));
      const base = siblingCenter
        ? { x: siblingCenter.x + offset.x, y: siblingCenter.y + offset.y }
        : { x: center.x + offset.x, y: center.y + offset.y };
      return pushOutsideCore(base, center, radius, offset);
    }
    const focus = focusComponentId ? placed.get(focusComponentId) : undefined;
    const base = focus?.x !== undefined
      ? { x: focus.x + offset.x, y: (focus.y ?? 0) + offset.y }
      : { x: center.x + offset.x, y: center.y + offset.y };
    // Only component nodes reach here (the force branch above always
    // returns); clamp so a newly seeded component always lands in the core.
    return clampToCore(base, center, radius);
  }

  function applySelectionClasses(): void {
    if (!built) return;
    const hasSelection = lastSelected.size > 0;
    built.svg.classed("nkp-hyper-selecting", hasSelection);
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
    componentLabelSel?.attr("opacity", (node: SimNode) => dim(node.id) ? 0 : 1);
    forceLabelSel?.attr("opacity", (node: SimNode) => hasSelection && !dim(node.id) ? 1 : 0);

    const bundleDim = (bundle: RenderBundle): boolean => {
      if (!hasSelection) return false;
      const keys = [bundle.componentId, ...bundle.forceIds.map((forceId) => `force:${forceId}`)];
      return keys.every((key) => !isSelected(key) && !isConnected(key));
    };
    bundleTrunkSel?.classed("is-lit", (bundle: RenderBundle) => !bundleDim(bundle));
    const bundleById = new Map(bundles.map((bundle) => [bundle.id, bundle]));
    bundleBranchSel?.classed("is-lit", (branch: RenderBranch) => {
      const bundle = bundleById.get(branch.bundleId);
      return bundle ? !bundleDim(bundle) : !hasSelection;
    });
    const regionDim = (group: AttractorGroup): boolean => {
      const key = `attractor:${group.attractorId}`;
      return hasSelection && !(isSelected(key) || isConnected(key));
    };
    regionSel?.classed("is-lit", (group: AttractorGroup) => !regionDim(group));
    regionLabelSel?.classed("is-lit", (group: AttractorGroup) => !regionDim(group))
      .attr("opacity", (group: AttractorGroup) => regionDim(group) ? 0 : (group.focused ? 0.9 : 0.4));
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
      { const { width, height } = canvasSize(); coreCenter = { x: width / 2, y: height / 2 }; }
      b.coreBoundary.attr("cx", coreCenter.x).attr("cy", coreCenter.y).attr("r", coreZoneRadius(0));
      b.sim.nodes([]);
      (b.sim.force("link") as any).links([]);
      syncRegionLocks([], options.lockRegions === true);
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

    coreCenter = { x: width / 2, y: height / 2 };
    currentTension = options.tension ?? 1;
    const componentCount = model.nodes.filter((item) => item.type === "component").length;
    const coreRadius = coreZoneRadius(componentCount);
    b.coreBoundary
      .attr("cx", coreCenter.x)
      .attr("cy", coreCenter.y)
      .attr("r", coreRadius);

    // --- merge nodes by id: survivors keep x/y/vx/vy/fx/fy, newcomers seed, exits just don't reappear ---
    const prevById = byId;
    const nextById = new Map<string, SimNode>();
    const newcomerIds = new Set<string>();
    nodes = model.nodes.map((item) => {
      const existing = prevById.get(item.id);
      if (!existing) newcomerIds.add(item.id);
      const merged: SimNode = existing
        ? { ...item, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy, fx: existing.fx ?? null, fy: existing.fy ?? null }
        : { ...item, ...seedPosition(item, nextById, focusComponentId, componentCount), vx: 0, vy: 0 };
      nextById.set(item.id, merged);
      return merged;
    });
    byId = nextById;
    links = model.edges.map((edge) => ({ ...edge }));
    bundles = model.branchBundles.map((bundle) => ({ ...bundle }));

    refreshLatticeTargets(newcomerIds);

    b.sim.nodes(nodes);
    (b.sim.force("link") as any).links(links);
    syncRegionLocks(model.groups, options.lockRegions === true);
    b.sim.alpha(0.3).restart();

    // --- regions: filled + wide-stroked core (inflates into a blob), draggable to move their forces ---
    regionSel = b.regionsG.selectAll("g.nkp-hyper-region")
      .data(model.groups, (group: AttractorGroup) => group.attractorId)
      .join((enter: any) => {
        const g = enter.append("g").attr("class", "nkp-hyper-region");
        g.append("path");
        return g;
      });
    regionSel
      .attr("opacity", (group: AttractorGroup) => group.focused ? 0.16 : 0.07)
      .attr("aria-label", (group: AttractorGroup) => group.tooltip)
      .attr("tabindex", 0);
    regionSel.select("path")
      .attr("fill", (group: AttractorGroup) => group.color)
      .attr("stroke", (group: AttractorGroup) => group.color)
      .attr("stroke-width", REGION_PADDING * 2)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round");
    regionSel.on("click", (_event: MouseEvent, group: AttractorGroup) => ctx.onToggle(`attractor:${group.attractorId}` as EntityKey));
    regionSel.call(d3.drag()
      .on("start", (event: { active: boolean }, group: AttractorGroup) => {
        if (!event.active) b.sim.alphaTarget(0.15).restart();
        draggingRegionIds.add(group.attractorId);
        if (lockState.enabled) {
          let lock = lockState.locks.get(group.attractorId) ?? captureRegionLock(nodes, group.attractorId);
          if (lock) {
            lock = includeNewLockMembers(lock);
            lockState.locks.set(group.attractorId, lock);
            pinLockedMembers(lock);
          }
          return;
        }
        for (const node of nodes) {
          if (node.type === "force" && node.attractorId === group.attractorId) { node.fx = node.x; node.fy = node.y; }
        }
      })
      .on("drag", (event: { dx: number; dy: number }, group: AttractorGroup) => {
        if (lockState.enabled) {
          const lock = lockState.locks.get(group.attractorId);
          if (!lock) return;
          const moved = moveRegionLock(lock, {
            x: lock.anchor.x + event.dx,
            y: lock.anchor.y + event.dy,
          });
          lockState.locks.set(group.attractorId, moved);
          pinLockedMembers(moved);
          refreshLatticeTargets();
          tick();
          return;
        }
        translateGroup(nodes, group.attractorId, event.dx, event.dy);
        for (const node of nodes) {
          if (node.type === "force" && node.attractorId === group.attractorId) { node.fx = node.x; node.fy = node.y; }
        }
        tick();
      })
      .on("end", (event: { active: boolean }, group: AttractorGroup) => {
        if (!event.active) b.sim.alphaTarget(0);
        draggingRegionIds.delete(group.attractorId);
        const memberIds = new Set(nodes
          .filter((node) => node.type === "force" && node.attractorId === group.attractorId)
          .map((node) => node.id));
        if (lockState.enabled) {
          refreshLatticeTargets();
          return;
        }
        refreshLatticeTargets(memberIds);
        for (const node of nodes) {
          if (node.type === "force" && node.attractorId === group.attractorId) { node.fx = null; node.fy = null; }
        }
      }));

    // --- fusion regions: neutral padded hulls behind edges and nodes ---
    const fusionData = model.fusionGroups.map((ids) => ({ id: [...ids].sort().join("\u0000"), ids }));
    fusionSel = b.fusionG.selectAll("path.nkp-hyper-fusion-hull")
      .data(fusionData, (item: { id: string }) => item.id)
      .join("path")
      .attr("class", "nkp-hyper-fusion-hull")
      .attr("data-fusion-region", "true")
      .attr("role", "img")
      .attr("aria-label", (item: { ids: string[] }) => `Fusion candidate region for ${item.ids.join(", ")}`)
      .attr("fill", "#808080")
      .attr("fill-opacity", 0.14)
      .attr("stroke", "var(--warn)")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "3 4")
      .attr("stroke-linejoin", "round");

    // --- edges: one branch bundle per (component, attractor) ---
    bundleTrunkSel = b.edgesG.selectAll("path.nkp-hyper-bundle-trunk")
      .data(bundles, (bundle: RenderBundle) => bundle.id)
      .join("path")
      .attr("class", "nkp-hyper-bundle-trunk")
      .attr("fill", "none")
      .attr("stroke", (bundle: RenderBundle) => colorFor(bundle.attractorId))
      .attr("aria-label", (bundle: RenderBundle) => `${bundle.componentId} linked to attractor ${bundle.attractorId}`)
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
      .attr("aria-label", (branch: RenderBranch) => `${branch.componentId} linked to ${branch.forceId}`)
      .attr("stroke-opacity", (branch: RenderBranch) => branch.focused ? 0.45 : 0.15);

    // --- nodes: component (ring + dot) and force (diamond/circle glyph) share one <g> shape ---
    const nodeJoin = b.nodesG.selectAll("g.nkp-node")
      .data(nodes, (node: SimNode) => node.id)
      .join((enter: any) => {
        const g = enter.append("g");
        g.append("circle").attr("class", "nkp-fission-ring").attr("r", 15).attr("fill", "none").attr("stroke-dasharray", "3 4");
        g.append("circle").attr("class", "nkp-node-dot nkp-component-status-glyph").attr("r", 9);
        g.append("rect").attr("class", "nkp-node-dot nkp-component-status-glyph").attr("x", -9).attr("y", -9).attr("width", 18).attr("height", 18);
        g.append("path").attr("class", "nkp-hyper-force-dot");
        return g;
      });
    nodeSel = nodeJoin
      .attr("class", (node: SimNode) => `nkp-node nkp-hyper-node nkp-hyper-${node.type}`)
      .attr("opacity", (node: SimNode) => node.focused ? 1 : 0.45)
      .attr("aria-label", (node: SimNode) => node.tooltip)
      .attr("tabindex", 0);
    nodeSel.select(".nkp-fission-ring")
      .attr("display", (node: SimNode) => node.type === "component" && node.fissionCandidate ? null : "none");
    nodeSel.select("circle.nkp-node-dot")
      .attr("data-component-status-shape", (node: SimNode) => node.type === "component" && node.shape === "circle" ? "actual" : null)
      .attr("display", (node: SimNode) => node.type === "component" && node.shape === "circle" ? null : "none")
      .attr("fill", (node: SimNode) => node.type === "component" ? node.color : null);
    nodeSel.select("rect.nkp-node-dot")
      .attr("data-component-status-shape", (node: SimNode) => node.type === "component" && node.shape === "square" ? "proposed" : null)
      .attr("display", (node: SimNode) => node.type === "component" && node.shape === "square" ? null : "none")
      .attr("fill", (node: SimNode) => node.type === "component" ? node.color : null);
    nodeSel.select(".nkp-hyper-force-dot")
      .attr("d", (node: SimNode) => node.type === "force" ? forceGlyphPath(node.kind) : null)
      .attr("fill", (node: SimNode) => node.type === "force" ? colorFor(node.attractorId) : null)
      .attr("fill-opacity", (node: SimNode) => node.type === "force" ? forceNodeOpacity(node.kind) : null)
      .attr("data-force-kind-glyph", (node: SimNode) => node.type === "force" ? node.kind : null)
      .attr("display", (node: SimNode) => node.type === "force" ? null : "none");
    nodeSel.on("click", (_event: MouseEvent, node: SimNode) => ctx.onToggle(node.id as EntityKey));
    nodeSel.call(d3.drag()
      .on("start", (event: { active: boolean }, node: SimNode) => {
        if (!event.active) b.sim.alphaTarget(0.3).restart();
        draggingNodeIds.add(node.id);
        node.fx = node.x; node.fy = node.y;
      })
      .on("drag", (event: { x: number; y: number }, node: SimNode) => {
        node.fx = event.x; node.fy = event.y;
        node.x = event.x; node.y = event.y;
        tick();
      })
      .on("end", (event: { active: boolean }, node: SimNode) => {
        if (!event.active) b.sim.alphaTarget(0);
        draggingNodeIds.delete(node.id);
        refreshLatticeTargets(new Set([node.id]));
        if (lockState.enabled && node.type === "force") {
          const lock = lockState.locks.get(node.attractorId);
          if (lock) {
            const edited = editRegionForceOffset(lock, node.id, { x: node.x ?? 0, y: node.y ?? 0 });
            lockState.locks.set(node.attractorId, edited);
            node.fx = node.x;
            node.fy = node.y;
            regionPinnedIds.add(node.id);
            return;
          }
        }
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
      b.tip.hidden = true;
      applySelectionClasses();
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
      componentLabelSel.attr("opacity", (other: SimNode) => lit.has(other.id) ? 1 : 0);
      forceLabelSel.attr("opacity", (other: SimNode) => lit.has(other.id) ? 1 : 0);
    };
    const showNode = (event: MouseEvent, item: SimNode): void => {
      highlight(item);
      b.tip.textContent = item.tooltip;
      placeTooltip(host, b.tip, event);
    };
    nodeSel.on("mouseenter", showNode)
      .on("focus", showNode)
      .on("mouseleave", clearHighlight)
      .on("blur", clearHighlight);
    const showRegion = (event: MouseEvent, group: AttractorGroup): void => {
      const lit = new Set([...group.forceNodeIds, ...group.componentNodeIds]);
      b.svg.classed("nkp-hyper-hovering", true);
      nodeSel.classed("is-lit", (node: SimNode) => lit.has(node.id));
      componentLabelSel.attr("opacity", (node: SimNode) => lit.has(node.id) ? 1 : 0);
      forceLabelSel.attr("opacity", (node: SimNode) => lit.has(node.id) ? 1 : 0);
      regionSel.classed("is-lit", (other: AttractorGroup) => other.attractorId === group.attractorId);
      regionLabelSel.classed("is-lit", (other: AttractorGroup) => other.attractorId === group.attractorId);
      b.tip.textContent = group.tooltip;
      placeTooltip(host, b.tip, event);
    };
    regionSel.on("mouseenter.tooltip", showRegion)
      .on("focus.tooltip", showRegion)
      .on("mouseleave.tooltip", clearHighlight)
      .on("blur.tooltip", clearHighlight);

    tick();
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
