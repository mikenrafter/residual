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
import { highlightConnectedKeys, highlightSemiConnectedKeys, type EntityKey } from "./landscape-selection";
import { ensureForwardSplitSeparation, dualRingMembershipGeometry, nestedBranchGeometry, nudgeLabels, projectLabelAnchor, rayCircleIntersection } from "./landscape-geometry";
import {
  axialFracDistance,
  axialHopStep,
  axialKey,
  axialRing,
  axialToPixel,
  axialToRadialPixel,
  dilatedSubshapeApproach,
  dualRingRadialStack,
  isInAnnulus,
  LATTICE_HOP_THRESHOLD,
  layoutAttractorDualRingMiniPyramids,
  layoutAttractorPyramidsOnRing,
  miniPyramidLayersForCount,
  nearestFreeAxialPoint,
  outerRingAxialRadiusForSlots,
  outerRingSlotsForPyramids,
  pixelToAxial,
  pixelToFractionalAxial,
  pixelToRadialAxial,
  previewNearestFreeAxialPoint,
  pyramidLayersForCount,
  TRI_LATTICE_SPACING,
  type AxialPoint,
  type DualRingRadialStack,
  type ForceShapeGroup,
  type RadialProjection,
} from "./landscape-triangular-lattice";

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
  /** The reverse direction of branchBundles: one bundle per force, branching out to its components. */
  forceBranchBundles: ForceBranchBundle[];
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

export interface ForceBranchBundle {
  id: string;
  /** Representative force id (first member); used for lit/aria when forceIds is absent. */
  forceId: string;
  /** All forces in this bundle's sub-shape. Defaults to [forceId] when omitted. */
  forceIds?: string[];
  attractorId: string;
  componentIds: string[];
  focused: boolean;
}

/**
 * Membership rendering: components do not bundle. Force→component strokes are
 * grouped later per sub-shape in the regions view. This helper keeps leftover
 * 1:1 force bundles for callers that still pass per-force fans, and drops all
 * component→force fans.
 */
export function partitionMembershipBundles(
  _branchBundles: readonly BranchBundle[],
  forceBranchBundles: readonly ForceBranchBundle[],
): { branchBundles: BranchBundle[]; forceBranchBundles: ForceBranchBundle[] } {
  // Components do not bundle for now — every membership is drawn from the
  // force/sub-shape side only.
  const outForce: ForceBranchBundle[] = forceBranchBundles.map((bundle) => ({
    ...bundle,
    componentIds: [...new Set(bundle.componentIds)].sort(),
    forceIds: bundle.forceIds ?? [bundle.forceId],
  }));
  return { branchBundles: [], forceBranchBundles: outForce };
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

  const forceBundleMap = new Map<string, ForceBranchBundle>();
  for (const edge of keptEdges) {
    const existing = forceBundleMap.get(edge.source);
    if (existing) {
      existing.componentIds.push(edge.target);
      continue;
    }
    forceBundleMap.set(edge.source, {
      id: `force-bundle:${edge.source}`,
      forceId: edge.source,
      attractorId: edge.attractorId,
      componentIds: [edge.target],
      focused: !!forceFocus.get(edge.source),
    });
  }
  const forceBranchBundles = [...forceBundleMap.values()];

  return { nodes, edges: keptEdges, groups, branchBundles, forceBranchBundles, fusionGroups };
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
 * Minimum center-to-center separation enforced between component nodes in
 * the regions view (both by the lattice tessellation and the collision
 * force). Declared here, ahead of its use in the core zone formulas below;
 * REGIONS_COMPONENT_COLLISION_RADIUS (declared further down alongside the
 * other regions layout constants) derives from this same value.
 */
export const REGIONS_COMPONENT_MIN_DISTANCE = 60;

/**
 * Core zone geometry (two concentric dashed rings):
 * - Outer (`coreZoneRadius`): attractor/force exclusion — forces stay outside.
 * - Inner (`componentZoneRadius`): component containment — ~2 tessellation hops
 *   inset from the outer ring so components and attractors keep a buffer.
 */
export const CORE_ZONE_BASE_RADIUS = REGIONS_COMPONENT_MIN_DISTANCE; // 60
export const CORE_ZONE_RADIUS_PER_COMPONENT = REGIONS_COMPONENT_MIN_DISTANCE / 3; // 20
/** Two tessellation hops between the component ring and the attractor ring. */
export const COMPONENT_ZONE_INSET = REGIONS_COMPONENT_MIN_DISTANCE * 2;

export function coreZoneRadius(componentCount: number): number {
  const count = Math.max(1, componentCount);
  return CORE_ZONE_BASE_RADIUS + CORE_ZONE_RADIUS_PER_COMPONENT * Math.sqrt(12 * count - 3);
}

/**
 * Bare-minimum radius for radially hex-tessellating `componentCount`
 * components at REGIONS_COMPONENT_MIN_DISTANCE spacing (centered-hexagonal
 * lattice rings: ring k holds ~6k slots, cumulative capacity 1+3k(k+1)).
 * coreZoneRadius() is exactly double this, for comfortable breathing room.
 */
export function coreZoneMinimumRadius(componentCount: number): number {
  return coreZoneRadius(componentCount) / 2;
}

/** Inner dashed ring — components are clamped inside this radius. */
export function componentZoneRadius(componentCount: number): number {
  const outer = coreZoneRadius(componentCount);
  // Keep a positive inner radius even when the outer ring is still small.
  return Math.max(CORE_ZONE_BASE_RADIUS * 0.5, outer - COMPONENT_ZONE_INSET);
}

/**
 * Outer ergodic radius: at least the component-driven core zone, grown until
 * the outer axial ring has enough slots for every pyramid base plus gap nodes.
 * @deprecated Prefer `regionsDualRingStack` for the dual-ring layout.
 */
export function regionsOuterRadius(
  componentCount: number,
  attractorForceCounts: readonly number[],
): number {
  const stack = regionsDualRingStack(componentCount, attractorForceCounts.map((count) => ({
    purposeCount: Math.ceil(count / 2),
    stressorCount: Math.floor(count / 2),
  })));
  return stack.stressorRingRadius;
}

/**
 * Dual-ring zone stack (purpose → inner annulus → components → outer annulus → stressors).
 * Missing-kind attractors contribute a 2-wide placeholder base.
 */
export function regionsDualRingStack(
  componentCount: number,
  attractorKindCounts: readonly { purposeCount: number; stressorCount: number }[],
  spacing = REGIONS_TRI_LATTICE_SPACING,
): DualRingRadialStack {
  const purposeBaseWidths = attractorKindCounts.map(({ purposeCount }) =>
    purposeCount <= 0 ? 2 : (miniPyramidLayersForCount(purposeCount)[0] ?? 1));
  const stressorBaseWidths = attractorKindCounts.map(({ stressorCount }) =>
    stressorCount <= 0 ? 2 : (miniPyramidLayersForCount(stressorCount)[0] ?? 1));
  return dualRingRadialStack({
    purposeBaseWidths: purposeBaseWidths.length > 0 ? purposeBaseWidths : [2],
    stressorBaseWidths: stressorBaseWidths.length > 0 ? stressorBaseWidths : [2],
    componentCount,
    spacing,
    minComponentHops: 3,
  });
}

/** Axial ring index of the outer ergodic barrier under the current radii. */
export function outerBarrierAxialRing(innerRadius: number, outerRadius: number, spacing = REGIONS_TRI_LATTICE_SPACING): number {
  const innerHops = Math.max(1, Math.round(innerRadius / spacing));
  const annulusHops = Math.max(1, Math.round((outerRadius - innerRadius) / spacing));
  return innerHops + annulusHops;
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
 * The outside-the-core counterpart to clampToCore: pulls a point that's
 * inside the circle out onto its boundary along the same direction from
 * center; points already outside are unchanged. Used to keep force nodes
 * out of the core zone (mirrors clampToCore keeping component nodes in).
 */
export function clampOutsideCore(point: Point, center: Point, radius: number): Point {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius) return point;
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
/** Component-sourced nested membership bundle (component → mid → sub-shape → forces). */
type RenderNestedBundle = {
  id: string;
  componentId: string;
  attractorId: string;
  focused: boolean;
  subShapes: Array<{ key: string; forceIds: string[] }>;
};
type RenderMidBranch = {
  id: string;
  bundleId: string;
  componentId: string;
  attractorId: string;
  subShapeKey: string;
  forceIds: string[];
  focused: boolean;
};
type RenderForceLeaf = {
  id: string;
  bundleId: string;
  componentId: string;
  attractorId: string;
  subShapeKey: string;
  forceId: string;
  focused: boolean;
};

/** Pull strength for createAttractorCohesionForce (was 0.3; ~1/3 keeps groups looser). */
export const ATTRACTOR_COHESION_STRENGTH = 0.1;

/** Synchronous simulation ticks after each update so the layout spreads before cool-down fit. */
export const INITIAL_SETTLE_TICKS = 50;

/** alphaTarget while keepSimulating is on — small but >0 so the sim stays warm. */
const KEEP_SIMULATING_ALPHA_TARGET = 0.05;

/**
 * Pulls each force node toward the current centroid of its attractor's force
 * nodes, recomputed every tick, so attractor groups cohere without being
 * pinned anywhere.
 */
function createAttractorCohesionForce(strength = ATTRACTOR_COHESION_STRENGTH) {
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
/**
 * How far beyond the core zone boundary a brand-new attractor's first force
 * member spawns. Large enough that the initial attractor blob has room to
 * breathe instead of hugging the ergodic boundary.
 */
const SPAWN_CORE_CLEARANCE = REGIONS_COMPONENT_MIN_DISTANCE * 2.5;
const FUSION_REGION_PADDING = 18;
const DEFAULT_CANVAS_WIDTH = 800;
const DEFAULT_CANVAS_HEIGHT = 600;

/**
 * Sole point-to-point spacing on the shared triangular lattice — every node
 * (component or force) and every attractor shape point sits on this one grid,
 * replacing the old mismatched REGIONS_LATTICE_CELL_SIZE/REGIONS_MIN_NODE_DISTANCE pair.
 */
export const REGIONS_TRI_LATTICE_SPACING = REGIONS_COMPONENT_MIN_DISTANCE;
/** Minimum tangential separation between sibling nested-bundle branches. */
export const BUNDLE_MIN_TANGENTIAL_DISTANCE = REGIONS_TRI_LATTICE_SPACING * 0.75;
/**
 * Minimum radial gap between the mid-ring split and the dilated-subshape split.
 * The annulus is two lattice hops, so the geometric mid sits one hop inside the
 * outer ring — the same radius as a one-layer dilation of a force on that ring.
 * This gap keeps the two splits from collapsing onto each other.
 */
export const BUNDLE_RADIAL_SPLIT_SEPARATION = REGIONS_TRI_LATTICE_SPACING * 0.5;
/**
 * Shared tessellation minimum for components and forces — both species sit on
 * the same lattice pitch so attractor clusters match component spacing.
 */
export const REGIONS_MIN_NODE_DISTANCE = REGIONS_COMPONENT_MIN_DISTANCE;
export const REGIONS_COMPONENT_COLLISION_RADIUS = REGIONS_COMPONENT_MIN_DISTANCE / 2;
/**
 * Same collision radius as components so forceCollide and the lattice agree
 * on one pitch for every node type.
 */
export const REGIONS_FORCE_COLLISION_RADIUS = REGIONS_COMPONENT_COLLISION_RADIUS;

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
/** Dual-ring redesign: attractor pressures at 25% of the prior baseline (28 → 7). */
export const FORCE_INTERACTION_STRENGTH = 7;
/** Component many-body charge at 25% of the prior −1400 baseline. */
export const REGIONS_COMPONENT_CHARGE = -350;
/** Force↔component link strength at 25% of the prior 0.45 baseline. */
export const REGIONS_LINK_STRENGTH = 0.1125;

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
 * Pure effect of `source` on `target`, independent of stressor/purpose kind:
 * every force attracts same-attractor force peers and its own directly
 * connected components, and repels everything else within range.
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
  const attracts = (targetIsForce && source.attractorId !== undefined && target.attractorId === source.attractorId)
    || (targetIsComponent && directlyConnected);
  const dx = (target.x ?? 0) - (source.x ?? 0);
  const dy = (target.y ?? 0) - (source.y ?? 0);
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || distance >= params.distanceMax) return zero;
  const falloff = 1 - distance / params.distanceMax;
  const strength = FORCE_INTERACTION_STRENGTH * falloff;
  const sign = attracts ? -1 : 1;
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
        // Floor alpha so a cooled simulation can still resolve overlaps (manual
        // repositioning / settle cool-down otherwise leaves groups stuck).
        const push = overlap * 0.5 * Math.max(alpha, 0.15);
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
  /**
   * When true (default), forces stay on the canonical static pyramid layout;
   * dragging a subshape snaps it back home. When false, drag commits a new
   * home until the next full re-layout or re-lock.
   */
  lockRegions?: boolean;
  /**
   * When true, pin component nodes in place (still snap to tessellation after
   * drag). Default false: components move under link/charge/collision so
   * dragging an attractor pulls its attached components.
   */
  lockComponents?: boolean;
  /** Draw the triangular lattice faintly below everything (annulus excluded). */
  showLattice?: boolean;
  /** When true, hold alphaTarget above zero so the simulation stays warm. */
  keepSimulating?: boolean;
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
  setSelection: (
    selected: ReadonlySet<EntityKey>,
    connected: ReadonlySet<EntityKey>,
    semi?: ReadonlySet<EntityKey>,
  ) => void;
  resetView: () => void;
  destroy: () => void;
  /** Test-only hook (not part of the fixed handle contract): the live d3
   * force simulation, so incremental-update/no-clamping tests can inspect
   * and step physics directly instead of guessing at timing. */
  readonly simulation: { nodes: () => SimNode[]; tick: (iterations?: number) => void } | undefined;
  /** Test-only hook (not part of the fixed handle contract): drives a node
   * drag programmatically instead of through real pointer events (d3-drag's
   * internal pointer-transform calls aren't reliably testable in this
   * environment) — runs the exact same clamp-to-core-boundary logic the real
   * "drag" event handler uses. */
  dragNodeTo: (nodeId: string, point: { x: number; y: number }) => void;
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
  const lockState: RegionsLockState = ctx.lockState ?? { enabled: true, locks: new Map() };

  let built:
    | {
        svg: any;
        zoom: any;
        latticeG: any;
        regionsG: any;
        fusionG: any;
        edgesG: any;
        forceEdgesG: any;
        nodesG: any;
        labelsGroup: any;
        coreBoundary: any;
        componentBoundary: any;
        coreBoundaryDivider: any;
        snapPreview: any;
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
  let nestedBundles: RenderNestedBundle[] = [];
  /** Current pan/zoom, kept in sync so label bounds can be projected into the
   * viewport actually on screen instead of the pre-zoom/pre-pan viewport. */
  let currentTransform: { invertX: (x: number) => number; invertY: (y: number) => number } = d3.zoomIdentity;
  let regionSel: any;
  let fusionSel: any;
  let bundleGroupSel: any;
  let bundleTrunkSel: any;
  let bundleMidBranchSel: any;
  let bundleForceLeafSel: any;
  let nodeSel: any;
  let componentLabelSel: any;
  let forceLabelSel: any;
  let regionLabelSel: any;
  let lastSelected: ReadonlySet<EntityKey> = new Set();
  let lastConnected: ReadonlySet<EntityKey> = new Set();
  let lastSemi: ReadonlySet<EntityKey> = new Set();
  let lastState: PendingState | undefined;
  let keepSimulating = false;
  let lockComponents = false;
  let showLattice = false;
  let regionsLocked = true;
  let hoveredNode: SimNode | undefined;
  let hoveredAttractorId: string | undefined;
  /** Snapshot of other components' occupied lattice cells, captured at drag
   * start so the live snap-preview search during "drag" doesn't reshuffle
   * every frame as the dragged node's own cell membership changes. */
  let dragComponentOccupied: Set<string> | undefined;
  let tickCount = 0;
  let labelShiftByKey = new Map<string, number>();
  let groupColorById = new Map<string, string>();
  let latticeTargets = new Map<string, Point>();
  /** Component nodes' current lattice cells (hop-to-hop). */
  let componentCells = new Map<string, AxialPoint>();
  /**
   * Per-sub-shape rigid bodies within an attractor. Forces inside one sub-shape
   * keep fixed relative offsets; sub-shapes hop independently so composites
   * can flex while each pill/triangle/… stays rigid.
   */
  let rigidAttractors = new Map<string, {
    subShapes: Array<{
      forceIds: string[];
      offsets: Map<string, AxialPoint>;
      translation: AxialPoint;
    }>;
  }>();
  /** Each attractor's member forces, partitioned by sub-shape (composite 5+ groups have 2+ entries), recomputed by refreshLatticeTargets. */
  let subShapesByAttractor = new Map<string, string[][]>();
  const regionPinnedIds = new Set<string>();
  const draggingNodeIds = new Set<string>();
  const draggingRegionIds = new Set<string>();
  /** Force nodes pinned by the core-exclusion force specifically, tracked
   * separately from regionPinnedIds (the manual lock-toggle mechanism) so
   * releasing one never clobbers the other. */
  const coreExclusionPinnedIds = new Set<string>();
  /** Canvas centre, recomputed once per update() and read every tick by the
   * core-zone forces and positionEdges(). */
  let coreCenter: Point = { x: DEFAULT_CANVAS_WIDTH / 2, y: DEFAULT_CANVAS_HEIGHT / 2 };

  /**
   * Soft lattice pull removed: nodes hop cell-to-cell. Kept as a named no-op
   * force so the simulation graph still has a "lattice" slot if anything
   * rotates forces by name.
   */
  const latticeForce = (_alpha: number): void => {};
  latticeForce.initialize = (): void => {};

  function absoluteCellsForSubShape(
    subShape: { offsets: Map<string, AxialPoint>; translation: AxialPoint },
    translation: AxialPoint = subShape.translation,
  ): AxialPoint[] {
    return [...subShape.offsets.values()].map((offset) => ({
      q: offset.q + translation.q,
      r: offset.r + translation.r,
    }));
  }

  function occupiedKeysExcluding(opts: {
    attractorId?: string;
    subShapeIndex?: number;
    componentId?: string;
  } = {}): Set<string> {
    const keys = new Set<string>();
    for (const [id, cell] of componentCells) {
      if (id === opts.componentId) continue;
      keys.add(axialKey(cell));
    }
    for (const [id, shape] of rigidAttractors) {
      shape.subShapes.forEach((subShape, index) => {
        if (id === opts.attractorId && index === opts.subShapeIndex) return;
        for (const cell of absoluteCellsForSubShape(subShape)) keys.add(axialKey(cell));
      });
    }
    return keys;
  }

  function translationClear(
    subShape: { offsets: Map<string, AxialPoint> },
    translation: AxialPoint,
    occupied: ReadonlySet<string>,
  ): boolean {
    return [...subShape.offsets.values()].every((offset) =>
      !occupied.has(axialKey({ q: offset.q + translation.q, r: offset.r + translation.r })));
  }

  function currentForceCounts(): number[] {
    return [...nodes.reduce((map, node) => {
      if (node.type !== "force") return map;
      map.set(node.attractorId, (map.get(node.attractorId) ?? 0) + 1);
      return map;
    }, new Map<string, number>()).values()];
  }

  function currentAttractorKindCounts(): Array<{ purposeCount: number; stressorCount: number }> {
    const byAttractor = new Map<string, { purposeCount: number; stressorCount: number }>();
    for (const node of nodes) {
      if (node.type !== "force") continue;
      const entry = byAttractor.get(node.attractorId) ?? { purposeCount: 0, stressorCount: 0 };
      if (node.kind === "purpose") entry.purposeCount += 1;
      else entry.stressorCount += 1;
      byAttractor.set(node.attractorId, entry);
    }
    return [...byAttractor.values()];
  }

  function currentDualRingStack(): DualRingRadialStack {
    const componentCount = nodes.filter((node) => node.type === "component").length;
    return regionsDualRingStack(componentCount, currentAttractorKindCounts());
  }

  function currentZoneRadii(): { outerRadius: number; innerRadius: number } {
    const stack = currentDualRingStack();
    return {
      outerRadius: stack.stressorRingRadius,
      innerRadius: stack.componentBand.outer,
    };
  }

  /**
   * After physics integration, hop components whose continuous position drifted
   * past LATTICE_HOP_THRESHOLD, then hard-snap free forces onto their lattice
   * homes. Components stay in the component band; forces stay on their rings.
   */
  function applyLatticeHops(): void {
    const stack = currentDualRingStack();
    const bandInner = stack.componentBand.inner;
    const bandOuter = stack.componentBand.outer;
    const cellInComponentZone = (cell: AxialPoint): boolean => {
      const point = axialToPixel(cell, REGIONS_TRI_LATTICE_SPACING, coreCenter);
      const radius = Math.hypot(point.x - coreCenter.x, point.y - coreCenter.y);
      return radius >= bandInner - 0.5 && radius <= bandOuter + 0.5;
    };

    // --- components ---
    for (const node of nodes) {
      if (node.type !== "component") continue;
      if (node.fx != null || draggingNodeIds.has(node.id)) continue;
      let cell = componentCells.get(node.id);
      if (!cell) {
        cell = pixelToAxial({ x: node.x ?? 0, y: node.y ?? 0 }, REGIONS_TRI_LATTICE_SPACING, coreCenter);
        componentCells.set(node.id, cell);
      }
      const frac = pixelToFractionalAxial({ x: node.x ?? 0, y: node.y ?? 0 }, REGIONS_TRI_LATTICE_SPACING, coreCenter);
      if (axialFracDistance(frac, cell) >= LATTICE_HOP_THRESHOLD) {
        const step = axialHopStep(cell, frac);
        if (step) {
          const candidate = { q: cell.q + step.q, r: cell.r + step.r };
          const occupied = occupiedKeysExcluding({ componentId: node.id });
          if (!occupied.has(axialKey(candidate)) && cellInComponentZone(candidate)) {
            cell = candidate;
            componentCells.set(node.id, cell);
          }
        }
      }
      if (!cellInComponentZone(cell)) {
        const occupied = occupiedKeysExcluding({ componentId: node.id });
        const base = pixelToAxial(coreCenter, REGIONS_TRI_LATTICE_SPACING, coreCenter);
        let found: AxialPoint | undefined;
        for (let radius = 0; !found && radius <= 40; radius += 1) {
          for (const candidate of radius === 0 ? [base] : axialRing(base, radius)) {
            if (!occupied.has(axialKey(candidate)) && cellInComponentZone(candidate)) {
              found = candidate;
              break;
            }
          }
        }
        if (found) {
          cell = found;
          componentCells.set(node.id, cell);
        }
      }
      const point = axialToPixel(cell, REGIONS_TRI_LATTICE_SPACING, coreCenter);
      node.x = point.x;
      node.y = point.y;
      latticeTargets.set(node.id, point);
    }

    // --- forces: stay on lattice homes (canonical when locked, sticky when unlocked).
    // No auto-reorient — pyramids only move via drag or full re-layout.
    for (const node of nodes) {
      if (node.type !== "force") continue;
      if (draggingNodeIds.has(node.id) || draggingRegionIds.has(node.attractorId)) continue;
      const point = latticeTargets.get(node.id);
      if (!point) continue;
      node.x = point.x;
      node.y = point.y;
      if (regionPinnedIds.has(node.id)) {
        node.fx = point.x;
        node.fy = point.y;
      }
    }
  }

  function normalizeVec(dx: number, dy: number): Point {
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return { x: 1, y: 0 };
    return { x: dx / length, y: dy / length };
  }

  /**
   * Keeps every component node inside the core zone: any component found
   * outside the circle is clamped straight back to the boundary. Only zeroes
   * velocity when a clamp actually moved the node — otherwise link/charge
   * forces must be free to pull components around.
   */
  const coreContainmentForce = (): void => {
    const stack = currentDualRingStack();
    const bandOuter = stack.componentBand.outer;
    const bandInner = stack.componentBand.inner;
    for (const node of nodes) {
      if (node.type !== "component" || node.fx != null) continue;
      const beforeX = node.x ?? 0;
      const beforeY = node.y ?? 0;
      const radius = Math.hypot(beforeX - coreCenter.x, beforeY - coreCenter.y);
      let clamped = { x: beforeX, y: beforeY };
      if (radius > bandOuter) clamped = clampToCore(clamped, coreCenter, bandOuter);
      else if (radius < bandInner && radius > 1e-6) {
        const scale = bandInner / radius;
        clamped = {
          x: coreCenter.x + (beforeX - coreCenter.x) * scale,
          y: coreCenter.y + (beforeY - coreCenter.y) * scale,
        };
      }
      if (clamped.x === beforeX && clamped.y === beforeY) continue;
      node.x = clamped.x;
      node.y = clamped.y;
      node.vx = 0;
      node.vy = 0;
    }
  };
  coreContainmentForce.initialize = (): void => {};

  /** Pin or release component fx/fy according to lockComponents (skip active drags). */
  const syncComponentLocks = (): void => {
    for (const node of nodes) {
      if (node.type !== "component") continue;
      if (draggingNodeIds.has(node.id)) continue;
      if (lockComponents) {
        node.fx = node.x;
        node.fy = node.y;
      } else {
        node.fx = null;
        node.fy = null;
      }
    }
  };

  /**
   * Dual-ring ring guards: purposes stay inside the inner annulus; stressors
   * stay outside the outer annulus. Lattice homes remain the source of truth.
   */
  const coreExclusionForce = (): void => {
    if (lockState.enabled) return;
    const stack = currentDualRingStack();
    for (const node of nodes) {
      if (node.type !== "force") continue;
      if (draggingNodeIds.has(node.id)) continue;
      if (draggingRegionIds.has(node.attractorId)) continue;
      if (regionPinnedIds.has(node.id)) continue;
      const beforeX = node.x ?? 0;
      const beforeY = node.y ?? 0;
      const radius = Math.hypot(beforeX - coreCenter.x, beforeY - coreCenter.y);
      let clamped = { x: beforeX, y: beforeY };
      if (node.kind === "purpose") {
        const maxR = stack.innerAnnulus.inner;
        if (radius > maxR) clamped = clampToCore(clamped, coreCenter, maxR);
      } else {
        const minR = stack.outerAnnulus.outer;
        if (radius < minR) clamped = clampOutsideCore(clamped, coreCenter, minR);
      }
      if (clamped.x === beforeX && clamped.y === beforeY) continue;
      node.x = clamped.x;
      node.y = clamped.y;
      const radial = normalizeVec(clamped.x - coreCenter.x, clamped.y - coreCenter.y);
      const vn = (node.vx ?? 0) * radial.x + (node.vy ?? 0) * radial.y;
      if (node.kind === "purpose" && vn > 0) {
        node.vx = (node.vx ?? 0) - vn * radial.x;
        node.vy = (node.vy ?? 0) - vn * radial.y;
      } else if (node.kind === "stressor" && vn < 0) {
        node.vx = (node.vx ?? 0) - vn * radial.x;
        node.vy = (node.vy ?? 0) - vn * radial.y;
      }
    }
    coreExclusionPinnedIds.clear();
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
    const stack = currentDualRingStack();
    const bandInner = stack.componentBand.inner;
    const bandOuter = stack.componentBand.outer;
    // Mid of 3-hop band: 2nd hop in from the outer edge.
    const seedRadius = bandOuter - 2 * REGIONS_TRI_LATTICE_SPACING;

    // Dominant-attractor ray for each component (fallback: attractor spawn angle).
    const attractorAngle = new Map<string, number>();
    {
      const byAttractor = new Map<string, Point[]>();
      for (const node of nodes) {
        if (node.type !== "force") continue;
        const list = byAttractor.get(node.attractorId) ?? [];
        list.push({ x: node.x ?? coreCenter.x, y: node.y ?? coreCenter.y });
        byAttractor.set(node.attractorId, list);
      }
      for (const [attractorId, points] of byAttractor) {
        const c = centroid(points) ?? coreCenter;
        attractorAngle.set(attractorId, Math.atan2(c.y - coreCenter.y, c.x - coreCenter.x));
      }
    }

    // --- components: pack into the component band, seeded on the dominant ray. ---
    const componentOccupied = new Set<string>();
    const componentAxialById = new Map<string, AxialPoint>();
    const orderedComponents = nodes
      .filter((node) => node.type === "component")
      .sort((left, right) => {
        const leftStable = snapIds.has(left.id) ? 0 : 1;
        const rightStable = snapIds.has(right.id) ? 0 : 1;
        return rightStable - leftStable || left.id.localeCompare(right.id);
      });
    for (const node of orderedComponents) {
      const dominantId = node.type === "component" ? node.dominantAttractorId : undefined;
      const angle = (dominantId ? attractorAngle.get(dominantId) : undefined) ?? 0;
      const seedPoint = {
        x: coreCenter.x + Math.cos(angle) * seedRadius,
        y: coreCenter.y + Math.sin(angle) * seedRadius,
      };
      let preferred = snapIds.has(node.id)
        ? seedPoint
        : { x: node.x ?? seedPoint.x, y: node.y ?? seedPoint.y };
      let radius = Math.hypot(preferred.x - coreCenter.x, preferred.y - coreCenter.y);
      if (radius < bandInner || radius > bandOuter) preferred = seedPoint;
      let axial = nearestFreeAxialPoint(preferred, componentOccupied, REGIONS_TRI_LATTICE_SPACING, coreCenter);
      // Reject cells outside the component band.
      const inBand = (cell: AxialPoint): boolean => {
        const p = axialToPixel(cell, REGIONS_TRI_LATTICE_SPACING, coreCenter);
        const r = Math.hypot(p.x - coreCenter.x, p.y - coreCenter.y);
        return r >= bandInner - 0.5 && r <= bandOuter + 0.5;
      };
      if (!inBand(axial) || componentOccupied.has(axialKey(axial))) {
        let found: AxialPoint | undefined;
        const base = pixelToAxial(seedPoint, REGIONS_TRI_LATTICE_SPACING, coreCenter);
        for (let ring = 0; !found && ring <= 40; ring += 1) {
          for (const candidate of ring === 0 ? [base] : axialRing(base, ring)) {
            if (!componentOccupied.has(axialKey(candidate)) && inBand(candidate)) {
              found = candidate;
              break;
            }
          }
        }
        axial = found ?? axial;
      }
      componentOccupied.add(axialKey(axial));
      componentAxialById.set(node.id, axial);
    }
    componentCells = componentAxialById;

    // --- forces: dual-ring mini-pyramids (purposes inner, stressors outer). ---
    const forceNodesByAttractor = new Map<string, SimForceNode[]>();
    for (const node of nodes) {
      if (node.type !== "force") continue;
      const list = forceNodesByAttractor.get(node.attractorId) ?? [];
      list.push(node);
      forceNodesByAttractor.set(node.attractorId, list);
    }
    const shapeGroups: ForceShapeGroup[] = [...forceNodesByAttractor.entries()].map(([attractorId, members]) => {
      const anchorPixel = centroid(members.map((member) => ({ x: member.x ?? 0, y: member.y ?? 0 }))) ?? coreCenter;
      return {
        attractorId,
        forces: members.map((member) => ({ id: member.id, components: member.componentIds, kind: member.kind })),
        anchor: pixelToAxial(anchorPixel, REGIONS_TRI_LATTICE_SPACING, coreCenter),
      };
    });
    const layout = layoutAttractorDualRingMiniPyramids(shapeGroups, {
      purposeRing: stack.purposeRingAxial,
      stressorRing: stack.stressorRingAxial,
    });
    const forceAxialById = layout.targets;
    // Merge purpose + stressor layer bins for bundling / rigid drag.
    const nextSubShapes = new Map<string, string[][]>();
    for (const attractorId of forceNodesByAttractor.keys()) {
      const purposeBins = layout.purposeSubShapesByAttractor.get(attractorId) ?? [];
      const stressorBins = layout.stressorSubShapesByAttractor.get(attractorId) ?? [];
      nextSubShapes.set(attractorId, [...purposeBins, ...stressorBins]);
    }
    subShapesByAttractor = nextSubShapes;

    // Capture per-sub-shape rigid offsets + translation from the absolute layout.
    const nextRigid = new Map<string, {
      subShapes: Array<{
        forceIds: string[];
        offsets: Map<string, AxialPoint>;
        translation: AxialPoint;
      }>;
    }>();
    for (const [attractorId, members] of forceNodesByAttractor) {
      const bins = subShapesByAttractor.get(attractorId)
        ?? [members.map((member) => member.id)];
      const subShapes = bins.map((forceIds) => {
        const absolutes = forceIds
          .map((id) => {
            const axial = forceAxialById.get(id);
            return axial ? { id, axial } : undefined;
          })
          .filter((item): item is { id: string; axial: AxialPoint } => item !== undefined);
        if (absolutes.length === 0) {
          return {
            forceIds: [...forceIds],
            offsets: new Map<string, AxialPoint>(),
            translation: { q: 0, r: 0 },
          };
        }
        const translation = [...absolutes]
          .map((item) => item.axial)
          .sort((a, b) => a.q - b.q || a.r - b.r)[0]!;
        const offsets = new Map<string, AxialPoint>();
        for (const item of absolutes) {
          offsets.set(item.id, {
            q: item.axial.q - translation.q,
            r: item.axial.r - translation.r,
          });
        }
        return { forceIds: [...forceIds], offsets, translation };
      });
      nextRigid.set(attractorId, { subShapes });
    }
    rigidAttractors = nextRigid;

    const nextTargets = new Map<string, Point>();
    for (const [id, axial] of componentAxialById) {
      nextTargets.set(id, axialToPixel(axial, REGIONS_TRI_LATTICE_SPACING, coreCenter));
    }
    for (const [id, axial] of forceAxialById) {
      nextTargets.set(id, axialToPixel(axial, REGIONS_TRI_LATTICE_SPACING, coreCenter));
    }
    latticeTargets = nextTargets;

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

  /** Slight saturation shifts so each pyramid subshape hull reads as its own section. */
  function subshapeHullColor(attractorId: string, index: number, total: number): string {
    const base = colorFor(attractorId);
    const match = base.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/i);
    if (!match || total <= 1) return base;
    const hue = Number(match[1]);
    const sat = Number(match[2]);
    const light = Number(match[3]);
    const shift = (index - (total - 1) / 2) * 7;
    const nextSat = Math.max(28, Math.min(88, sat + shift));
    return `hsl(${hue} ${nextSat}% ${light}%)`;
  }

  function subshapeBinsForAttractor(attractorId: string): string[][] {
    const bins = subShapesByAttractor.get(attractorId);
    if (bins && bins.length > 0) return bins;
    const forceIds = nodes
      .filter((node): node is SimForceNode => node.type === "force" && node.attractorId === attractorId)
      .map((node) => node.id);
    return forceIds.length > 0 ? [forceIds] : [];
  }

  function pointsOfForceIds(forceIds: readonly string[]): Point[] {
    return forceIds
      .map((id) => {
        const node = byId.get(id);
        return node ? { x: node.x ?? 0, y: node.y ?? 0 } : undefined;
      })
      .filter((point): point is Point => point !== undefined);
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
    regionSel?.each(function (this: SVGGElement, group: AttractorGroup) {
      // Dual-ring: one convex hull over all forces, painted below components.
      const forceIds = group.forceNodeIds;
      d3.select(this).selectAll("path.nkp-hyper-region-blob")
        .data([{ forceIds, index: 0, total: 1 }])
        .join("path")
        .attr("class", "nkp-hyper-region-blob")
        .attr("fill", colorFor(group.attractorId))
        .attr("stroke", colorFor(group.attractorId))
        .attr("stroke-width", REGION_PADDING * 2)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round")
        .attr("d", (item: { forceIds: string[] }) => regionCorePath(pointsOfForceIds(item.forceIds)));
    });
  }

  function positionFusionHulls(): void {
    fusionSel?.attr("d", (item: { ids: string[] }) =>
      paddedRegionPath(item.ids.map((id) => {
        const node = byId.get(id);
        return { x: node?.x ?? 0, y: node?.y ?? 0 };
      }), FUSION_REGION_PADDING));
  }

  /**
   * Nested unidirectional membership fans: component → correct annulus mid →
   * layer approach → forces. Long ±10° arcs when a short hop would enter the
   * wrong annulus. Force→component fans are not drawn.
   */
  function positionEdges(): void {
    const stack = currentDualRingStack();
    const innerAnnulusMid = (stack.innerAnnulus.inner + stack.innerAnnulus.outer) / 2;
    const outerAnnulusMid = (stack.outerAnnulus.inner + stack.outerAnnulus.outer) / 2;

    const geometryByBundle = new Map<string, {
      trunk: string;
      width: number;
      midByKey: Map<string, string>;
      forceById: Map<string, string>;
    }>();

    for (const bundle of nestedBundles) {
      const component = byId.get(bundle.componentId);
      if (!component) continue;
      const from = { x: component.x ?? 0, y: component.y ?? 0 };
      const midByKey = new Map<string, string>();
      const forceById = new Map<string, string>();
      let trunk = "";
      let width = 1;
      let forceCount = 0;

      for (const sub of bundle.subShapes) {
        const forceNodes = sub.forceIds
          .map((id) => {
            const node = byId.get(id);
            return node && node.type === "force"
              ? { id, point: { x: node.x ?? 0, y: node.y ?? 0 }, kind: node.kind }
              : undefined;
          })
          .filter((item): item is { id: string; point: Point; kind: "purpose" | "stressor" } => item !== undefined);
        if (forceNodes.length === 0) continue;
        const kind = forceNodes[0]!.kind;
        const hub = centroid(forceNodes.map((item) => item.point)) ?? from;
        const approach = ensureForwardSplitSeparation(
          from,
          dilatedSubshapeApproach(
            forceNodes.map((item) => item.point),
            from,
            REGIONS_TRI_LATTICE_SPACING,
            coreCenter,
          ),
          hub,
          BUNDLE_RADIAL_SPLIT_SEPARATION,
        );
        const paths: string[] = [];
        for (const force of forceNodes) {
          const geometry = dualRingMembershipGeometry({
            from,
            force: force.point,
            forceKind: force.kind,
            center: coreCenter,
            innerAnnulusMid,
            outerAnnulusMid,
            approach,
            tangentDegrees: 10,
          });
          if (!trunk) trunk = geometry.trunk;
          paths.push(geometry.midBranch);
          forceById.set(force.id, geometry.forceBranch);
          forceCount += 1;
        }
        midByKey.set(sub.key, paths[0] ?? "");
        // If multiple forces share a sub-shape, keep mid branch to the approach hub.
        if (paths.length > 1) {
          const dir = {
            x: approach.x - (geometryByBundle.get(bundle.id)?.midByKey ? approach.x : from.x),
            y: approach.y - from.y,
          };
          void dir;
          midByKey.set(sub.key, paths[0]!);
        }
        void kind;
      }
      width = 1 + Math.sqrt(Math.max(0, forceCount - 1)) * 0.9;
      geometryByBundle.set(bundle.id, { trunk, width, midByKey, forceById });
    }

    bundleTrunkSel
      ?.attr("d", (bundle: RenderNestedBundle) => geometryByBundle.get(bundle.id)?.trunk ?? "")
      .attr("stroke-width", (bundle: RenderNestedBundle) => geometryByBundle.get(bundle.id)?.width ?? 1);
    bundleMidBranchSel
      ?.attr("d", (branch: RenderMidBranch) => geometryByBundle.get(branch.bundleId)?.midByKey.get(branch.subShapeKey) ?? "")
      .attr("stroke-width", (branch: RenderMidBranch) => Math.max(1, (geometryByBundle.get(branch.bundleId)?.width ?? 1) * 0.72));
    bundleForceLeafSel
      ?.attr("d", (leaf: RenderForceLeaf) => geometryByBundle.get(leaf.bundleId)?.forceById.get(leaf.forceId) ?? "")
      .attr("stroke-width", (leaf: RenderForceLeaf) => Math.max(1, (geometryByBundle.get(leaf.bundleId)?.width ?? 1) * 0.5));
  }

  /**
   * One nested bundle per (component, attractor): sub-shapes of that attractor
   * that share a membership with the component become the mid-level fan.
   */
  function buildNestedComponentBundles(): RenderNestedBundle[] {
    const out: RenderNestedBundle[] = [];
    const componentIds = [...new Set(links.map((link) =>
      typeof link.target === "string" ? link.target : link.target.id))];
    for (const componentId of componentIds.sort()) {
      const linkedForceIds = new Set(
        links
          .filter((link) => (typeof link.target === "string" ? link.target : link.target.id) === componentId)
          .map((link) => (typeof link.source === "string" ? link.source : link.source.id)),
      );
      for (const [attractorId, bins] of subShapesByAttractor) {
        const subShapes: Array<{ key: string; forceIds: string[] }> = [];
        let focused = false;
        bins.forEach((forceIds, index) => {
          const touching = forceIds.filter((id) => linkedForceIds.has(id)).sort();
          if (touching.length === 0) return;
          for (const forceId of touching) {
            const link = links.find((item) =>
              (typeof item.source === "string" ? item.source : item.source.id) === forceId
              && (typeof item.target === "string" ? item.target : item.target.id) === componentId);
            if (link?.focused) focused = true;
          }
          subShapes.push({ key: `${attractorId}:${index}`, forceIds: touching });
        });
        if (subShapes.length === 0) continue;
        out.push({
          id: `nested:${componentId}:${attractorId}`,
          componentId,
          attractorId,
          focused,
          subShapes,
        });
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
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

  function paintLattice(innerRadius: number, outerRadius: number): void {
    const b = built;
    if (!b) return;
    b.latticeG.style("display", showLattice ? null : "none");
    if (!showLattice) {
      b.latticeG.selectAll("*").remove();
      return;
    }
    const stack = currentDualRingStack();
    const proj: RadialProjection = {
      origin: coreCenter,
      spacing: REGIONS_TRI_LATTICE_SPACING,
      innerRadius: stack.componentBand.inner,
      outerRadius: stack.stressorRingRadius,
    };
    const spacing = REGIONS_TRI_LATTICE_SPACING;
    const maxRing = Math.max(1, Math.round(stack.stressorRingRadius / spacing)) + 8;
    const inSkippedAnnulus = (radius: number): boolean =>
      (radius > stack.innerAnnulus.inner && radius < stack.innerAnnulus.outer)
      || (radius > stack.outerAnnulus.inner && radius < stack.outerAnnulus.outer);
    const points: Point[] = [];
    const edges: Array<[Point, Point]> = [];
    const pointByKey = new Map<string, Point>();
    for (let ring = 0; ring <= maxRing; ring += 1) {
      const cells = ring === 0 ? [{ q: 0, r: 0 }] : axialRing({ q: 0, r: 0 }, ring);
      for (const cell of cells) {
        const pixel = axialToRadialPixel(cell, proj);
        const radius = Math.hypot(pixel.x - coreCenter.x, pixel.y - coreCenter.y);
        if (inSkippedAnnulus(radius)) continue;
        if (radius < innerRadius * 0.25 && ring > 0) {
          // keep a light core lattice; dual-ring still draws purpose ring cells
        }
        void outerRadius;
        const key = axialKey(cell);
        pointByKey.set(key, pixel);
        points.push(pixel);
        for (const neighbor of [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }]) {
          const other = { q: cell.q + neighbor.q, r: cell.r + neighbor.r };
          const otherRing = Math.max(
            Math.abs(other.q),
            Math.abs(other.r),
            Math.abs(-other.q - other.r),
          );
          if (otherRing > maxRing) continue;
          const otherPixel = pointByKey.get(axialKey(other)) ?? axialToRadialPixel(other, proj);
          const otherRadius = Math.hypot(otherPixel.x - coreCenter.x, otherPixel.y - coreCenter.y);
          if (inSkippedAnnulus(otherRadius)) continue;
          edges.push([pixel, otherPixel]);
        }
      }
    }
    b.latticeG.selectAll("line.nkp-hyper-lattice-edge")
      .data(edges.map((pair, index) => ({ id: index, pair })))
      .join("line")
      .attr("class", "nkp-hyper-lattice-edge")
      .attr("x1", (d: { pair: [Point, Point] }) => d.pair[0].x)
      .attr("y1", (d: { pair: [Point, Point] }) => d.pair[0].y)
      .attr("x2", (d: { pair: [Point, Point] }) => d.pair[1].x)
      .attr("y2", (d: { pair: [Point, Point] }) => d.pair[1].y);
    b.latticeG.selectAll("circle.nkp-hyper-lattice-point")
      .data(points.map((point, index) => ({ id: index, point })))
      .join("circle")
      .attr("class", "nkp-hyper-lattice-point")
      .attr("r", 1.25)
      .attr("cx", (d: { point: Point }) => d.point.x)
      .attr("cy", (d: { point: Point }) => d.point.y);
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

  function simTick(): void {
    applyLatticeHops();
    tick();
  }

  function clampAllNodesToCoreZones(): void {
    const stack = currentDualRingStack();
    for (const node of nodes) {
      if (node.type === "component") {
        const before = { x: node.x ?? 0, y: node.y ?? 0 };
        const radius = Math.hypot(before.x - coreCenter.x, before.y - coreCenter.y);
        let clamped = before;
        if (radius > stack.componentBand.outer) clamped = clampToCore(before, coreCenter, stack.componentBand.outer);
        else if (radius < stack.componentBand.inner && radius > 1e-6) {
          const scale = stack.componentBand.inner / radius;
          clamped = {
            x: coreCenter.x + (before.x - coreCenter.x) * scale,
            y: coreCenter.y + (before.y - coreCenter.y) * scale,
          };
        }
        node.x = clamped.x;
        node.y = clamped.y;
      }
      // Forces keep lattice homes; no single-ring clamp.
      node.vx = 0;
      node.vy = 0;
    }
  }

  function applyKeepSimulatingTarget(sim: { alphaTarget: (t?: number) => number; restart: () => unknown }): void {
    if (keepSimulating) {
      sim.alphaTarget(KEEP_SIMULATING_ALPHA_TARGET).restart();
    } else {
      sim.alphaTarget(0);
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
    const latticeG = content.append("g")
      .attr("class", "nkp-hyper-lattice")
      .attr("data-regions-lattice", "true")
      .style("display", "none");
    const coreG = content.append("g").attr("class", "nkp-hyper-core");
    const coreBoundary = coreG.append("circle")
      .attr("class", "nkp-hyper-core-boundary")
      .attr("data-core-boundary", "true")
      .attr("fill", "none")
      .attr("stroke", "var(--muted)")
      .attr("stroke-dasharray", "4 4");
    const componentBoundary = coreG.append("circle")
      .attr("class", "nkp-hyper-component-boundary")
      .attr("data-component-boundary", "true")
      .attr("fill", "none")
      .attr("stroke", "var(--muted)")
      .attr("stroke-dasharray", "4 4");
    const coreBoundaryDivider = coreG.append("line")
      .attr("class", "nkp-hyper-core-boundary-divider")
      .attr("data-core-boundary-divider", "true")
      .attr("stroke", "var(--muted)")
      .attr("stroke-dasharray", "4 4");
    const regionsG = content.append("g").attr("class", "nkp-hyper-regions");
    const fusionG = content.append("g").attr("class", "nkp-hyper-fusion");
    const edgesG = content.append("g").attr("class", "nkp-hyper-edges");
    const forceEdgesG = content.append("g").attr("class", "nkp-hyper-force-edges");
    const nodesG = content.append("g").attr("class", "nkp-hyper-nodes");
    const snapPreview = content.append("circle")
      .attr("class", "nkp-hyper-snap-preview")
      .attr("r", REGIONS_TRI_LATTICE_SPACING / 2)
      .attr("fill", "none")
      .style("display", "none");
    const labelsGroup = svg.append("g").attr("class", "landscape-labels");
    zoom.on("zoom.labels", (event: { transform: typeof currentTransform }) => {
      currentTransform = event.transform;
      labelsGroup.attr("transform", event.transform);
    });
    svg.on("dblclick", () => ctx.onClear());

    const sim = d3.forceSimulation([])
      .force("link", d3.forceLink([]).id((item: SimNode) => item.id).distance(80).strength(REGIONS_LINK_STRENGTH))
      .force("charge", d3.forceManyBody().strength((item: SimNode) => item.type === "component" ? REGIONS_COMPONENT_CHARGE : 0))
      .force("x", d3.forceX(width / 2).strength(0.03))
      .force("y", d3.forceY(height / 2).strength(0.03))
      .force("collision", d3.forceCollide().radius((item: SimNode) => item.type === "component"
        ? REGIONS_COMPONENT_COLLISION_RADIUS
        : 0).strength(0.9))
      .force("lattice", latticeForce)
      .force("cohesion", (_alpha: number) => {})
      .force("interaction", (_alpha: number) => {})
      .force("coreContainment", coreContainmentForce)
      .force("coreExclusion", coreExclusionForce)
      .force("regionCollision", (_alpha: number) => {})
      .on("tick", simTick)
      .on("end", () => {
        recomputeLabelNudges(true);
        positionLabels();
      })
      .stop();

    built = { svg, zoom, latticeG, regionsG, fusionG, edgesG, forceEdgesG, nodesG, labelsGroup, coreBoundary, componentBoundary, coreBoundaryDivider, snapPreview, sim, width, height, didFit: false, tip: createTooltip(host) };
    return built;
  }

  /**
   * Evenly spaced spawn angles for distinct attractors (sorted ids → 2π·i/N).
   * Replaces hash-based angles that could clump several attractors in one wedge.
   */
  function attractorSpawnAngles(attractorIds: Iterable<string>): Map<string, number> {
    const sorted = [...new Set(attractorIds)].sort();
    const count = sorted.length;
    const angles = new Map<string, number>();
    for (let index = 0; index < count; index += 1) {
      angles.set(sorted[index]!, (Math.PI * 2 * index) / count);
    }
    return angles;
  }

  /**
   * New force nodes: first member of an attractor seeds on that attractor's
   * dedicated spawn ray (outer radius + SPAWN_CORE_CLEARANCE); later members seed
   * near siblings' centroid with a small per-id jitter. Either way the
   * result is clamped outside the outer ring. New component nodes seed near the
   * canvas centre/focus and get clamped inside the inner (component) ring.
   */
  function seedPosition(
    item: HyperNode,
    placed: ReadonlyMap<string, SimNode>,
    focusComponentId: string | undefined,
    componentCount: number,
    spawnAngles: ReadonlyMap<string, number>,
  ): { x: number; y: number } {
    const offset = deterministicOffset(item.id);
    const stack = regionsDualRingStack(componentCount, currentAttractorKindCounts().length > 0
      ? currentAttractorKindCounts()
      : [{ purposeCount: 1, stressorCount: 1 }]);
    if (item.type === "force") {
      const siblings = [...placed.values()].filter(
        (node): node is SimForceNode => node.type === "force" && node.attractorId === item.attractorId && node.x !== undefined,
      );
      const siblingCenter = centroid(siblings.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0 })));
      let base: Point;
      if (siblingCenter) {
        base = { x: siblingCenter.x + offset.x, y: siblingCenter.y + offset.y };
      } else {
        const angle = spawnAngles.get(item.attractorId) ?? 0;
        const spawnR = item.kind === "purpose"
          ? stack.purposeRingRadius
          : stack.stressorRingRadius + SPAWN_CORE_CLEARANCE;
        base = { x: coreCenter.x + spawnR * Math.cos(angle), y: coreCenter.y + spawnR * Math.sin(angle) };
      }
      return base;
    }
    const focus = focusComponentId ? placed.get(focusComponentId) : undefined;
    const seedR = stack.componentBand.outer - 2 * REGIONS_TRI_LATTICE_SPACING;
    const base = focus?.x !== undefined
      ? { x: focus.x + offset.x, y: (focus.y ?? 0) + offset.y }
      : { x: coreCenter.x + seedR + offset.x, y: coreCenter.y + offset.y };
    const radius = Math.hypot(base.x - coreCenter.x, base.y - coreCenter.y);
    if (radius > stack.componentBand.outer) return clampToCore(base, coreCenter, stack.componentBand.outer);
    if (radius < stack.componentBand.inner && radius > 1e-6) {
      const scale = stack.componentBand.inner / radius;
      return {
        x: coreCenter.x + (base.x - coreCenter.x) * scale,
        y: coreCenter.y + (base.y - coreCenter.y) * scale,
      };
    }
    return base;
  }

  /**
   * Shared clamp used by both the real d3-drag handler and the test-only
   * `dragNodeTo` hook: components stay inside the inner ring, forces stay
   * outside the outer ring. Force nodes drag their whole sub-shape rigidly.
   */
  function subShapeForceIds(forceId: string): string[] {
    for (const shape of rigidAttractors.values()) {
      for (const subShape of shape.subShapes) {
        if (subShape.forceIds.includes(forceId)) return [...subShape.forceIds];
      }
    }
    return [forceId];
  }

  function applyNodeDrag(node: SimNode, point: { x: number; y: number }): void {
    const stack = currentDualRingStack();
    if (node.type === "force") {
      const peerIds = subShapeForceIds(node.id);
      const from = { x: node.x ?? 0, y: node.y ?? 0 };
      const clampForce = (p: Point, kind: "purpose" | "stressor"): Point => {
        const radius = Math.hypot(p.x - coreCenter.x, p.y - coreCenter.y);
        if (kind === "purpose") {
          const maxR = stack.innerAnnulus.inner;
          return radius > maxR ? clampToCore(p, coreCenter, maxR) : p;
        }
        const minR = stack.outerAnnulus.outer;
        return radius < minR ? clampOutsideCore(p, coreCenter, minR) : p;
      };
      const primary = clampForce(point, node.kind);
      const dx = primary.x - from.x;
      const dy = primary.y - from.y;
      for (const peerId of peerIds) {
        const peer = byId.get(peerId);
        if (!peer || peer.type !== "force") continue;
        // Apply a pure translation so rigid sub-shape offsets are preserved;
        // only the dragged node is ring-clamped.
        const next = peerId === node.id
          ? primary
          : { x: (peer.x ?? 0) + dx, y: (peer.y ?? 0) + dy };
        peer.fx = next.x;
        peer.fy = next.y;
        peer.x = next.x;
        peer.y = next.y;
      }
    } else {
      let clamped = point;
      const radius = Math.hypot(point.x - coreCenter.x, point.y - coreCenter.y);
      if (radius > stack.componentBand.outer) clamped = clampToCore(point, coreCenter, stack.componentBand.outer);
      else if (radius < stack.componentBand.inner && radius > 1e-6) {
        const scale = stack.componentBand.inner / radius;
        clamped = {
          x: coreCenter.x + (point.x - coreCenter.x) * scale,
          y: coreCenter.y + (point.y - coreCenter.y) * scale,
        };
      }
      node.fx = clamped.x;
      node.fy = clamped.y;
      node.x = clamped.x;
      node.y = clamped.y;
    }
    tick();

    // Live tessellation snap-point preview: forces already know their
    // shape-assigned target (recomputed only on update(), not per drag
    // frame); components get a fresh nearest-free-cell search against the
    // snapshot of other components' cells captured at drag start.
    if (built) {
      const previewPoint = node.type === "component"
        ? axialToPixel(
          previewNearestFreeAxialPoint({ x: node.x ?? 0, y: node.y ?? 0 }, dragComponentOccupied ?? new Set(), REGIONS_TRI_LATTICE_SPACING, coreCenter),
          REGIONS_TRI_LATTICE_SPACING,
          coreCenter,
        )
        : latticeTargets.get(node.id);
      if (previewPoint) {
        built.snapPreview.attr("cx", previewPoint.x).attr("cy", previewPoint.y).style("display", null);
      }
    }
  }

  function dragNodeTo(nodeId: string, point: { x: number; y: number }): void {
    const node = byId.get(nodeId);
    if (!node) return;
    const peerIds = node.type === "force" ? subShapeForceIds(node.id) : [node.id];
    for (const id of peerIds) draggingNodeIds.add(id);
    if (node.type === "component") {
      dragComponentOccupied = new Set(
        nodes
          .filter((other) => other.type === "component" && other.id !== node.id)
          .map((other) => axialKey(pixelToAxial({ x: other.x ?? 0, y: other.y ?? 0 }, REGIONS_TRI_LATTICE_SPACING, coreCenter))),
      );
    }
    applyNodeDrag(node, point);
    for (const id of peerIds) draggingNodeIds.delete(id);
    dragComponentOccupied = undefined;
  }

  function applySelectionClasses(): void {
    if (!built) return;
    const hasSelection = lastSelected.size > 0;
    built.svg.classed("nkp-hyper-selecting", hasSelection);
    const isSelected = (key: string): boolean => lastSelected.has(key as EntityKey);
    const isConnected = (key: string): boolean => !isSelected(key) && lastConnected.has(key as EntityKey);
    const isSemi = (key: string): boolean =>
      !isSelected(key) && !isConnected(key) && lastSemi.has(key as EntityKey);
    const dim = (key: string): boolean =>
      hasSelection && !isSelected(key) && !isConnected(key) && !isSemi(key);
    const applyToKeyed = (selection: any): void => {
      selection
        ?.classed("selected", (node: SimNode) => isSelected(node.id))
        .classed("connected", (node: SimNode) => isConnected(node.id))
        .classed("semi", (node: SimNode) => isSemi(node.id))
        .classed("dim", (node: SimNode) => dim(node.id));
    };
    applyToKeyed(nodeSel);
    applyToKeyed(componentLabelSel);
    applyToKeyed(forceLabelSel);
    // Focused/connected/semi labels may be forced visible; unfocused labels
    // keep their default visibility (component names stay as-is; force names
    // stay hidden at opacity 0).
    componentLabelSel?.attr("opacity", (node: SimNode) => {
      if (isSelected(node.id) || isConnected(node.id) || isSemi(node.id)) return 1;
      return null;
    });
    forceLabelSel?.attr("opacity", (node: SimNode) => {
      if (isSelected(node.id) || isConnected(node.id)) return 1;
      return 0;
    });

    const inNet = (key: string): boolean => isSelected(key) || isConnected(key);
    const trunkLit = (bundle: RenderNestedBundle): boolean => {
      if (!hasSelection) return true;
      if (!inNet(bundle.componentId)) return false;
      return bundle.subShapes.some((sub) => sub.forceIds.some((id) => inNet(id)));
    };
    const midLit = (branch: RenderMidBranch): boolean => {
      if (!hasSelection) return true;
      if (!inNet(branch.componentId)) return false;
      return branch.forceIds.some((id) => inNet(id));
    };
    const leafLit = (leaf: RenderForceLeaf): boolean => {
      if (!hasSelection) return true;
      return inNet(leaf.componentId) && inNet(leaf.forceId);
    };
    // Path-level is-lit: only segments on a selected↔connected membership light.
    bundleTrunkSel?.classed("is-lit", (bundle: RenderNestedBundle) => trunkLit(bundle));
    bundleMidBranchSel?.classed("is-lit", (branch: RenderMidBranch) => midLit(branch));
    bundleForceLeafSel?.classed("is-lit", (leaf: RenderForceLeaf) => leafLit(leaf));
    bundleGroupSel?.classed("is-lit", (bundle: RenderNestedBundle) => trunkLit(bundle));
    const regionLit = (group: AttractorGroup): boolean => {
      const key = `attractor:${group.attractorId}`;
      return !hasSelection || isSelected(key) || isConnected(key);
    };
    const regionSemi = (group: AttractorGroup): boolean => {
      const key = `attractor:${group.attractorId}`;
      return hasSelection && isSemi(key);
    };
    regionSel
      ?.classed("is-lit", (group: AttractorGroup) => regionLit(group))
      .classed("is-semi", (group: AttractorGroup) => regionSemi(group));
    regionLabelSel
      ?.classed("is-lit", (group: AttractorGroup) => regionLit(group))
      .classed("is-semi", (group: AttractorGroup) => regionSemi(group))
      .attr("opacity", (group: AttractorGroup) => {
        if (regionLit(group)) return group.focused ? 0.9 : 0.4;
        if (regionSemi(group)) return 0.24;
        return hasSelection ? 0 : (group.focused ? 0.9 : 0.4);
      });
  }

  function update(state: PendingState, rawOptions: Record<string, unknown> = {}): void {
    lastState = state;
    const options = rawOptions as RegionsRenderOptions;
    keepSimulating = options.keepSimulating === true;
    lockComponents = options.lockComponents === true;
    showLattice = options.showLattice === true;
    regionsLocked = options.lockRegions ?? true;
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
      nestedBundles = [];
      subShapesByAttractor = new Map();
      componentCells = new Map();
      rigidAttractors = new Map();
      { const { width, height } = canvasSize(); coreCenter = { x: width / 2, y: height / 2 }; }
      {
        const emptyOuter = coreZoneRadius(0);
        const emptyInner = componentZoneRadius(0);
        b.coreBoundary.attr("cx", coreCenter.x).attr("cy", coreCenter.y).attr("r", emptyOuter);
        b.componentBoundary.attr("cx", coreCenter.x).attr("cy", coreCenter.y).attr("r", emptyInner);
        b.coreBoundaryDivider
          .attr("x1", coreCenter.x - emptyOuter)
          .attr("x2", coreCenter.x + emptyOuter)
          .attr("y1", coreCenter.y)
          .attr("y2", coreCenter.y);
      }
      b.sim.nodes([]);
      (b.sim.force("link") as any).links([]);
      syncRegionLocks([], regionsLocked);
      paintLattice(emptyInner, emptyOuter);
      regionSel = b.regionsG.selectAll("g.nkp-hyper-region").data([]).join("g");
      fusionSel = b.fusionG.selectAll("path.nkp-hyper-fusion-hull").data([]).join("path");
      bundleGroupSel = b.edgesG.selectAll("g.nkp-hyper-bundle").data([]).join("g");
      bundleTrunkSel = bundleGroupSel.selectAll("path.nkp-hyper-bundle-trunk");
      bundleMidBranchSel = bundleGroupSel.selectAll("path.nkp-hyper-bundle-mid-branch");
      bundleForceLeafSel = bundleGroupSel.selectAll("path.nkp-hyper-bundle-force-branch");
      b.forceEdgesG.selectAll("*").remove();
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
    const componentCount = model.nodes.filter((item) => item.type === "component").length;
    const kindCounts = model.groups.map((group) => {
      const members = model.nodes.filter((n): n is HyperForceNode => n.type === "force" && n.attractorId === group.attractorId);
      return {
        purposeCount: members.filter((m) => m.kind === "purpose").length,
        stressorCount: members.filter((m) => m.kind === "stressor").length,
      };
    });
    const stack = regionsDualRingStack(componentCount, kindCounts);
    const coreRadius = stack.stressorRingRadius;
    const componentRadius = stack.componentBand.outer;
    b.coreBoundary
      .attr("cx", coreCenter.x)
      .attr("cy", coreCenter.y)
      .attr("r", coreRadius);
    b.componentBoundary
      .attr("cx", coreCenter.x)
      .attr("cy", coreCenter.y)
      .attr("r", componentRadius);
    b.coreBoundaryDivider
      .attr("x1", coreCenter.x - coreRadius)
      .attr("x2", coreCenter.x + coreRadius)
      .attr("y1", coreCenter.y)
      .attr("y2", coreCenter.y);
    paintLattice(stack.componentBand.inner, stack.stressorRingRadius);

    // --- merge nodes by id: survivors keep x/y/vx/vy/fx/fy, newcomers seed, exits just don't reappear ---
    const prevById = byId;
    const nextById = new Map<string, SimNode>();
    const newcomerIds = new Set<string>();
    const spawnAngles = attractorSpawnAngles(
      model.nodes.flatMap((item) => (item.type === "force" ? [item.attractorId] : [])),
    );
    nodes = model.nodes.map((item) => {
      const existing = prevById.get(item.id);
      if (!existing) newcomerIds.add(item.id);
      const merged: SimNode = existing
        ? { ...item, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy, fx: existing.fx ?? null, fy: existing.fy ?? null }
        : { ...item, ...seedPosition(item, nextById, focusComponentId, componentCount, spawnAngles), vx: 0, vy: 0 };
      nextById.set(item.id, merged);
      return merged;
    });
    byId = nextById;
    links = model.edges.map((edge) => ({ ...edge }));
    refreshLatticeTargets(newcomerIds);
    nestedBundles = buildNestedComponentBundles();

    b.sim.nodes(nodes);
    (b.sim.force("link") as any).links(links);
    syncRegionLocks(model.groups, regionsLocked);
    syncComponentLocks();
    b.sim.alpha(0.3).restart();

    // --- regions: one convex hull over all forces of an attractor (below components). ---
    regionSel = b.regionsG.selectAll("g.nkp-hyper-region")
      .data(model.groups, (group: AttractorGroup) => group.attractorId)
      .join((enter: any) => enter.append("g").attr("class", "nkp-hyper-region"));
    regionSel
      .attr("opacity", (group: AttractorGroup) => group.focused ? 0.16 : 0.07)
      .attr("aria-label", (group: AttractorGroup) => group.tooltip)
      .attr("tabindex", 0);
    regionSel.each(function (this: SVGGElement, group: AttractorGroup) {
      d3.select(this).selectAll("path.nkp-hyper-region-blob")
        .data([{ forceIds: group.forceNodeIds }])
        .join("path")
        .attr("class", "nkp-hyper-region-blob")
        .attr("fill", colorFor(group.attractorId))
        .attr("stroke", colorFor(group.attractorId))
        .attr("stroke-width", REGION_PADDING * 2)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round");
    });
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
        {
          const { outerRadius: radius } = currentZoneRadii();
          for (const node of nodes) {
            if (node.type !== "force" || node.attractorId !== group.attractorId) continue;
            const clamped = clampOutsideCore({ x: node.x ?? 0, y: node.y ?? 0 }, coreCenter, radius);
            node.x = clamped.x;
            node.y = clamped.y;
            node.fx = clamped.x;
            node.fy = clamped.y;
          }
        }
        tick();
      })
      .on("end", (event: { active: boolean }, group: AttractorGroup) => {
        if (!event.active) applyKeepSimulatingTarget(b.sim);
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

    // --- edges: nested component→mid→sub-shape→force fans (unidirectional). ---
    bundleGroupSel = b.edgesG.selectAll("g.nkp-hyper-bundle")
      .data(nestedBundles, (bundle: RenderNestedBundle) => bundle.id)
      .join("g")
      .attr("class", "nkp-hyper-bundle")
      .attr("opacity", (bundle: RenderNestedBundle) => bundle.focused ? 0.45 : 0.15);
    bundleTrunkSel = bundleGroupSel.selectAll("path.nkp-hyper-bundle-trunk")
      .data((bundle: RenderNestedBundle) => [bundle])
      .join("path")
      .attr("class", "nkp-hyper-bundle-trunk")
      .attr("fill", "none")
      .attr("stroke", (bundle: RenderNestedBundle) => colorFor(bundle.attractorId))
      .attr("aria-label", (bundle: RenderNestedBundle) => `${bundle.componentId} linked to attractor ${bundle.attractorId}`);
    bundleMidBranchSel = bundleGroupSel.selectAll("path.nkp-hyper-bundle-mid-branch")
      .data((bundle: RenderNestedBundle) => bundle.subShapes.map((sub) => ({
        id: `${bundle.id}:mid:${sub.key}`,
        bundleId: bundle.id,
        componentId: bundle.componentId,
        attractorId: bundle.attractorId,
        subShapeKey: sub.key,
        forceIds: sub.forceIds,
        focused: bundle.focused,
      } satisfies RenderMidBranch)))
      .join("path")
      .attr("class", "nkp-hyper-bundle-mid-branch")
      .attr("fill", "none")
      .attr("stroke", (branch: RenderMidBranch) => colorFor(branch.attractorId))
      .attr("aria-label", (branch: RenderMidBranch) => `${branch.componentId} linked to sub-shape ${branch.subShapeKey}`);
    bundleForceLeafSel = bundleGroupSel.selectAll("path.nkp-hyper-bundle-force-branch")
      .data((bundle: RenderNestedBundle) => bundle.subShapes.flatMap((sub) =>
        sub.forceIds.map((forceId) => ({
          id: `${bundle.id}:force:${forceId}`,
          bundleId: bundle.id,
          componentId: bundle.componentId,
          attractorId: bundle.attractorId,
          subShapeKey: sub.key,
          forceId,
          focused: bundle.focused,
        } satisfies RenderForceLeaf))))
      .join("path")
      .attr("class", "nkp-hyper-bundle-force-branch")
      .attr("fill", "none")
      .attr("stroke", (leaf: RenderForceLeaf) => colorFor(leaf.attractorId))
      .attr("aria-label", (leaf: RenderForceLeaf) => `${leaf.componentId} linked to ${leaf.forceId}`);
    b.forceEdgesG.selectAll("*").remove();

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
        const peerIds = node.type === "force" ? subShapeForceIds(node.id) : [node.id];
        for (const id of peerIds) {
          draggingNodeIds.add(id);
          const peer = byId.get(id);
          if (peer) { peer.fx = peer.x; peer.fy = peer.y; }
        }
        if (node.type === "component") {
          dragComponentOccupied = new Set(
            nodes
              .filter((other) => other.type === "component" && other.id !== node.id)
              .map((other) => axialKey(pixelToAxial({ x: other.x ?? 0, y: other.y ?? 0 }, REGIONS_TRI_LATTICE_SPACING, coreCenter))),
          );
        }
      })
      .on("drag", (event: { x: number; y: number }, node: SimNode) => {
        applyNodeDrag(node, { x: event.x, y: event.y });
      })
      .on("end", (event: { active: boolean }, node: SimNode) => {
        if (!event.active) applyKeepSimulatingTarget(b.sim);
        const peerIds = node.type === "force" ? subShapeForceIds(node.id) : [node.id];
        for (const id of peerIds) draggingNodeIds.delete(id);
        dragComponentOccupied = undefined;
        built?.snapPreview.style("display", "none");
        if (regionsLocked && node.type === "force") {
          // Locked: drag is ephemeral — snap subshape back to canonical homes.
          for (const id of peerIds) {
            const peer = byId.get(id);
            const home = latticeTargets.get(id);
            if (!peer || !home) continue;
            peer.x = home.x;
            peer.y = home.y;
            peer.fx = home.x;
            peer.fy = home.y;
            regionPinnedIds.add(id);
          }
          tick();
          return;
        }
        if (!regionsLocked && node.type === "force") {
          // Unlocked: commit sticky homes, reversing along the drag arc if occupied.
          const occupied = occupiedKeysExcluding({});
          for (const id of peerIds) occupied.delete(axialKey(pixelToAxial({
            x: byId.get(id)?.x ?? 0,
            y: byId.get(id)?.y ?? 0,
          }, REGIONS_TRI_LATTICE_SPACING, coreCenter)));
          const primary = byId.get(node.id);
          const home = latticeTargets.get(node.id);
          if (primary && home) {
            const from = home;
            const to = { x: primary.x ?? 0, y: primary.y ?? 0 };
            const dx = from.x - to.x;
            const dy = from.y - to.y;
            let accepted = { ...to };
            for (let step = 0; step <= 12; step += 1) {
              const t = step / 12;
              const candidate = { x: to.x + dx * t, y: to.y + dy * t };
              const cell = nearestFreeAxialPoint(candidate, occupied, REGIONS_TRI_LATTICE_SPACING, coreCenter);
              if (!occupied.has(axialKey(cell))) {
                accepted = axialToPixel(cell, REGIONS_TRI_LATTICE_SPACING, coreCenter);
                break;
              }
            }
            const shiftX = accepted.x - to.x;
            const shiftY = accepted.y - to.y;
            for (const id of peerIds) {
              const peer = byId.get(id);
              if (!peer) continue;
              peer.x = (peer.x ?? 0) + shiftX;
              peer.y = (peer.y ?? 0) + shiftY;
              latticeTargets.set(id, { x: peer.x, y: peer.y });
              peer.fx = null;
              peer.fy = null;
            }
          }
          tick();
          return;
        }
        refreshLatticeTargets(new Set(peerIds));
        if (lockComponents && node.type === "component") {
          node.fx = node.x;
          node.fy = node.y;
          return;
        }
        for (const id of peerIds) {
          const peer = byId.get(id);
          if (peer) { peer.fx = null; peer.fy = null; }
        }
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

    // --- hover: highlight via the same partial-transitive set as selection ---
    const clearHighlight = (): void => {
      hoveredNode = undefined;
      hoveredAttractorId = undefined;
      b.svg.classed("nkp-hyper-hovering", false);
      nodeSel.classed("is-lit", false).classed("is-semi", false);
      bundleGroupSel.classed("is-lit", false);
      bundleTrunkSel?.classed("is-lit", false);
      bundleMidBranchSel?.classed("is-lit", false);
      bundleForceLeafSel?.classed("is-lit", false);
      regionSel.classed("is-lit", false).classed("is-semi", false);
      regionLabelSel.classed("is-lit", false).classed("is-semi", false);
      b.tip.hidden = true;
      applySelectionClasses();
    };
    const litAttractorsFrom = (lit: ReadonlySet<EntityKey>): Set<string> => {
      const ids = new Set<string>();
      for (const key of lit) {
        if (key.startsWith("attractor:")) ids.add(key.slice("attractor:".length));
      }
      return ids;
    };
    const applyBundleSegmentLit = (lit: ReadonlySet<EntityKey>): void => {
      const inLit = (key: string): boolean => lit.has(key as EntityKey);
      bundleTrunkSel?.classed("is-lit", (bundle: RenderNestedBundle) =>
        inLit(bundle.componentId) && bundle.subShapes.some((sub) => sub.forceIds.some((id) => inLit(id))));
      bundleMidBranchSel?.classed("is-lit", (branch: RenderMidBranch) =>
        inLit(branch.componentId) && branch.forceIds.some((id) => inLit(id)));
      bundleForceLeafSel?.classed("is-lit", (leaf: RenderForceLeaf) =>
        inLit(leaf.componentId) && inLit(leaf.forceId));
      bundleGroupSel?.classed("is-lit", (bundle: RenderNestedBundle) =>
        inLit(bundle.componentId) && bundle.subShapes.some((sub) => sub.forceIds.some((id) => inLit(id))));
    };
    const applyHoverLit = (lit: ReadonlySet<EntityKey>, semi: ReadonlySet<EntityKey>): void => {
      const litAttractors = litAttractorsFrom(lit);
      const semiAttractors = litAttractorsFrom(semi);
      b.svg.classed("nkp-hyper-hovering", true);
      nodeSel
        .classed("is-lit", (other: SimNode) => lit.has(other.id as EntityKey))
        .classed("is-semi", (other: SimNode) => semi.has(other.id as EntityKey));
      applyBundleSegmentLit(lit);
      regionSel
        .classed("is-lit", (group: AttractorGroup) => litAttractors.has(group.attractorId))
        .classed("is-semi", (group: AttractorGroup) => semiAttractors.has(group.attractorId));
      regionLabelSel
        .classed("is-lit", (group: AttractorGroup) => litAttractors.has(group.attractorId))
        .classed("is-semi", (group: AttractorGroup) => semiAttractors.has(group.attractorId));
      // Elevate names for focused/semi only — do not hide unfocused names.
      componentLabelSel.attr("opacity", (other: SimNode) => {
        if (lit.has(other.id as EntityKey) || semi.has(other.id as EntityKey)) return 1;
        return null;
      });
      forceLabelSel.attr("opacity", (other: SimNode) => {
        if (lit.has(other.id as EntityKey)) return 1;
        return 0;
      });
    };
    const highlightNode = (item: SimNode): void => {
      hoveredNode = item;
      hoveredAttractorId = undefined;
      const lit = lastState
        ? highlightConnectedKeys(lastState, [item.id as EntityKey])
        : new Set<EntityKey>([item.id as EntityKey]);
      const semi = lastState
        ? highlightSemiConnectedKeys(lastState, [item.id as EntityKey])
        : new Set<EntityKey>();
      applyHoverLit(lit, semi);
    };
    const showNode = (event: MouseEvent, item: SimNode): void => {
      highlightNode(item);
      b.tip.textContent = item.tooltip;
      placeTooltip(host, b.tip, event);
    };
    nodeSel.on("mouseenter", showNode)
      .on("focus", showNode)
      .on("mouseleave", clearHighlight)
      .on("blur", clearHighlight);
    const highlightRegion = (group: AttractorGroup): void => {
      hoveredNode = undefined;
      hoveredAttractorId = group.attractorId;
      const attractorKey = `attractor:${group.attractorId}` as EntityKey;
      const lit = lastState
        ? highlightConnectedKeys(lastState, [attractorKey])
        : new Set<EntityKey>([...group.forceNodeIds, ...group.componentNodeIds] as EntityKey[]);
      const semi = lastState
        ? highlightSemiConnectedKeys(lastState, [attractorKey])
        : new Set<EntityKey>();
      applyHoverLit(lit, semi);
    };
    const showRegion = (event: MouseEvent, group: AttractorGroup): void => {
      highlightRegion(group);
      b.tip.textContent = group.tooltip;
      placeTooltip(host, b.tip, event);
    };
    regionSel.on("mouseenter.tooltip", showRegion)
      .on("focus.tooltip", showRegion)
      .on("mouseleave.tooltip", clearHighlight)
      .on("blur.tooltip", clearHighlight);

    // Settle when the layout is new or gained nodes so radial seeds can spread
    // before cool-down fit. Skip when every node is a survivor so incremental
    // updates keep exact x/y (and so a second sync does not yank locked layout).
    const needsSettle = !b.didFit || newcomerIds.size > 0;
    if (needsSettle) {
      // Hop after each integrate step so settle stays on-lattice (sim.tick does
      // not fire the "tick" event that normally runs applyLatticeHops).
      for (let i = 0; i < INITIAL_SETTLE_TICKS; i += 1) {
        b.sim.tick(1);
        applyLatticeHops();
      }
      clampAllNodesToCoreZones();
      applyLatticeHops();
    }
    tick();
    if (!b.didFit) {
      b.didFit = true;
      fitToContent();
    }
    applyKeepSimulatingTarget(b.sim);
    applySelectionClasses();
  }

  function setSelection(
    selected: ReadonlySet<EntityKey>,
    connected: ReadonlySet<EntityKey>,
    semi: ReadonlySet<EntityKey> = new Set(),
  ): void {
    lastSelected = selected;
    lastConnected = connected;
    lastSemi = semi;
    applySelectionClasses();
    // If the pointer is still over a node/region after deselect, rebuild hover
    // lit from the current selection-independent highlight set — otherwise
    // applySelectionClasses leaves the previous selection-era classes visible.
    if (hoveredNode) {
      const seed = [hoveredNode.id as EntityKey];
      const lit = lastState ? highlightConnectedKeys(lastState, seed) : new Set<EntityKey>(seed);
      const hoverSemi = lastState ? highlightSemiConnectedKeys(lastState, seed) : new Set<EntityKey>();
      if (!built) return;
      built.svg.classed("nkp-hyper-hovering", true);
      nodeSel
        ?.classed("is-lit", (other: SimNode) => lit.has(other.id as EntityKey))
        .classed("is-semi", (other: SimNode) => hoverSemi.has(other.id as EntityKey));
      const inLit = (key: string): boolean => lit.has(key as EntityKey);
      bundleTrunkSel?.classed("is-lit", (bundle: RenderNestedBundle) =>
        inLit(bundle.componentId) && bundle.subShapes.some((sub) => sub.forceIds.some((id) => inLit(id))));
      bundleMidBranchSel?.classed("is-lit", (branch: RenderMidBranch) =>
        inLit(branch.componentId) && branch.forceIds.some((id) => inLit(id)));
      bundleForceLeafSel?.classed("is-lit", (leaf: RenderForceLeaf) =>
        inLit(leaf.componentId) && inLit(leaf.forceId));
      bundleGroupSel?.classed("is-lit", (bundle: RenderNestedBundle) =>
        inLit(bundle.componentId) && bundle.subShapes.some((sub) => sub.forceIds.some((id) => inLit(id))));
      const litAttractors = new Set<string>();
      const semiAttractors = new Set<string>();
      for (const key of lit) {
        if (key.startsWith("attractor:")) litAttractors.add(key.slice("attractor:".length));
      }
      for (const key of hoverSemi) {
        if (key.startsWith("attractor:")) semiAttractors.add(key.slice("attractor:".length));
      }
      regionSel
        ?.classed("is-lit", (group: AttractorGroup) => litAttractors.has(group.attractorId))
        .classed("is-semi", (group: AttractorGroup) => semiAttractors.has(group.attractorId));
      regionLabelSel
        ?.classed("is-lit", (group: AttractorGroup) => litAttractors.has(group.attractorId))
        .classed("is-semi", (group: AttractorGroup) => semiAttractors.has(group.attractorId));
      componentLabelSel?.attr("opacity", (other: SimNode) => {
        if (lit.has(other.id as EntityKey) || hoverSemi.has(other.id as EntityKey)) return 1;
        return null;
      });
      forceLabelSel?.attr("opacity", (other: SimNode) => {
        if (lit.has(other.id as EntityKey)) return 1;
        return 0;
      });
    } else if (hoveredAttractorId) {
      const attractorKey = `attractor:${hoveredAttractorId}` as EntityKey;
      const lit = lastState
        ? highlightConnectedKeys(lastState, [attractorKey])
        : new Set<EntityKey>([attractorKey]);
      const hoverSemi = lastState
        ? highlightSemiConnectedKeys(lastState, [attractorKey])
        : new Set<EntityKey>();
      if (!built) return;
      built.svg.classed("nkp-hyper-hovering", true);
      nodeSel
        ?.classed("is-lit", (other: SimNode) => lit.has(other.id as EntityKey))
        .classed("is-semi", (other: SimNode) => hoverSemi.has(other.id as EntityKey));
      const inLit = (key: string): boolean => lit.has(key as EntityKey);
      bundleTrunkSel?.classed("is-lit", (bundle: RenderNestedBundle) =>
        inLit(bundle.componentId) && bundle.subShapes.some((sub) => sub.forceIds.some((id) => inLit(id))));
      bundleMidBranchSel?.classed("is-lit", (branch: RenderMidBranch) =>
        inLit(branch.componentId) && branch.forceIds.some((id) => inLit(id)));
      bundleForceLeafSel?.classed("is-lit", (leaf: RenderForceLeaf) =>
        inLit(leaf.componentId) && inLit(leaf.forceId));
      bundleGroupSel?.classed("is-lit", (bundle: RenderNestedBundle) =>
        inLit(bundle.componentId) && bundle.subShapes.some((sub) => sub.forceIds.some((id) => inLit(id))));
      const litAttractors = new Set<string>();
      const semiAttractors = new Set<string>();
      for (const key of lit) {
        if (key.startsWith("attractor:")) litAttractors.add(key.slice("attractor:".length));
      }
      for (const key of hoverSemi) {
        if (key.startsWith("attractor:")) semiAttractors.add(key.slice("attractor:".length));
      }
      regionSel
        ?.classed("is-lit", (group: AttractorGroup) => litAttractors.has(group.attractorId))
        .classed("is-semi", (group: AttractorGroup) => semiAttractors.has(group.attractorId));
      regionLabelSel
        ?.classed("is-lit", (group: AttractorGroup) => litAttractors.has(group.attractorId))
        .classed("is-semi", (group: AttractorGroup) => semiAttractors.has(group.attractorId));
      componentLabelSel?.attr("opacity", (other: SimNode) => {
        if (lit.has(other.id as EntityKey) || hoverSemi.has(other.id as EntityKey)) return 1;
        return null;
      });
      forceLabelSel?.attr("opacity", (other: SimNode) => {
        if (lit.has(other.id as EntityKey)) return 1;
        return 0;
      });
    }
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
    dragNodeTo,
    get simulation() {
      return built?.sim;
    },
  };
}
