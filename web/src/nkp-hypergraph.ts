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

  return { nodes, edges: keptEdges, groups };
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

export interface HypergraphRenderOptions {
  /** Draw attractor names above their regions. */
  showNames?: boolean;
}

/**
 * Renders the hypergraph into `host` (already emptied by the caller) and
 * returns the running simulation so the caller can stop it on re-sync. The
 * layout canvas takes the viewport's aspect ratio and is scaled to fit it.
 */
export function renderNkpHypergraph(
  host: HTMLElement,
  model: NkpHypergraphModel,
  d3: any,
  options: HypergraphRenderOptions = {},
): { stop: () => void } | undefined {
  if (model.nodes.length === 0) {
    renderEmpty(host, "No forces or components to draw. Loosen the filters or pick another focus component.");
    return undefined;
  }

  const side = Math.max(480, Math.round(Math.sqrt(model.nodes.length) * 105));
  const aspect = host.clientWidth > 0 && host.clientHeight > 0 ? host.clientWidth / host.clientHeight : 1.4;
  const width = Math.round(side * Math.sqrt(aspect));
  const height = Math.round(side / Math.sqrt(aspect));
  const { svg: root, content: svg } = appendZoomableSvg(
    host,
    d3,
    { x: 0, y: 0, width, height },
    "nkp-hyper",
    "Forces linked to the components they touch, grouped into attractor regions",
  );
  // With names off, a region's name still appears while it is highlighted.
  root.classed("names-hidden", options.showNames === false);

  const nodes: SimNode[] = model.nodes.map((item) => ({ ...item }));
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const links: SimLink[] = model.edges.map((edge) => ({ ...edge }));
  const groupColor = new Map(model.groups.map((group) => [group.attractorId, group.color]));
  const colorOf = (attractorId: string): string => groupColor.get(attractorId) ?? "var(--muted)";

  // Seed each attractor's forces around its own spot on a wide ring, so the
  // simulation starts untangled; after that nothing is pinned.
  const cx = width / 2;
  const cy = height / 2;
  model.groups.forEach((group, index) => {
    const angle = (index / Math.max(1, model.groups.length)) * Math.PI * 2;
    const seed = { x: cx + Math.cos(angle) * side * 0.35, y: cy + Math.sin(angle) * side * 0.35 };
    for (const id of group.forceNodeIds) {
      const item = byId.get(id);
      if (!item) continue;
      item.x = seed.x + (Math.random() - 0.5) * 40;
      item.y = seed.y + (Math.random() - 0.5) * 40;
    }
  });

  const regionLayer = svg.append("g").attr("class", "nkp-hyper-regions");
  const region = regionLayer.selectAll("g").data(model.groups).join("g")
    .attr("class", "nkp-hyper-region")
    .attr("opacity", (group: AttractorGroup) => group.focused ? 0.16 : 0.07);
  const regionPath = region.append("path")
    .attr("fill", (group: AttractorGroup) => group.color)
    .attr("stroke", (group: AttractorGroup) => group.color)
    .attr("stroke-width", REGION_PADDING * 2)
    .attr("stroke-linejoin", "round")
    .attr("stroke-linecap", "round");
  region.append("title").text((group: AttractorGroup) => group.tooltip);

  const link = svg.append("g").attr("class", "nkp-hyper-edges")
    .selectAll("line").data(links).join("line")
    .attr("class", "nkp-hyper-edge")
    .attr("stroke", (edge: SimLink) => colorOf(edge.attractorId))
    .attr("stroke-opacity", (edge: SimLink) => edge.focused ? 0.45 : 0.15);

  const regionLabel = svg.append("g").attr("class", "nkp-hyper-region-labels")
    .selectAll("text").data(model.groups).join("text")
    .attr("class", "nkp-hyper-region-label")
    .attr("text-anchor", "middle")
    .attr("fill", (group: AttractorGroup) => group.color)
    .attr("opacity", (group: AttractorGroup) => group.focused ? 0.9 : 0.4)
    .text((group: AttractorGroup) => group.name);

  const node = svg.append("g").attr("class", "nkp-hyper-nodes")
    .selectAll("g").data(nodes).join("g")
    .attr("class", (item: SimNode) => `nkp-node nkp-hyper-node nkp-hyper-${item.type}`)
    .attr("opacity", (item: SimNode) => item.focused ? 1 : 0.45);

  const components = node.filter((item: SimNode) => item.type === "component");
  components.filter((item: SimNode) => item.type === "component" && item.fissionCandidate).append("circle")
    .attr("class", "nkp-fission-ring").attr("r", 15).attr("fill", "none")
    .attr("stroke-dasharray", "3 4");
  components.append("circle")
    .attr("class", (item: SimNode) => `nkp-node-dot ${item.type === "component" ? `status-${item.status}` : ""}`)
    .attr("r", 9);
  components.append("text")
    .attr("class", "nkp-node-label").attr("y", (item: SimNode) => item.type === "component" && item.fissionCandidate ? -19 : -13)
    .attr("text-anchor", "middle")
    .text((item: SimNode) => item.label);

  const forces = node.filter((item: SimNode) => item.type === "force");
  forces.append("path")
    .attr("class", "nkp-hyper-force-dot")
    // Stressors as diamonds, purposes as circles: both small, coloured by attractor.
    .attr("d", (item: SimNode) => item.type === "force" && item.kind === "stressor"
      ? "M0,-5L5,0L0,5L-5,0Z"
      : "M-4,0a4,4 0 1,0 8,0a4,4 0 1,0 -8,0")
    .attr("fill", (item: SimNode) => item.type === "force" ? colorOf(item.attractorId) : null);
  forces.append("text")
    .attr("class", "nkp-node-label nkp-hyper-force-label").attr("y", -9)
    .attr("text-anchor", "middle").attr("opacity", 0)
    .text((item: SimNode) => item.label);
  node.append("title").text((item: SimNode) => item.tooltip);

  // Hover: highlight the hovered node's neighbourhood and attractor regions.
  const neighbours = new Map<string, Set<string>>();
  for (const edge of model.edges) {
    neighbours.set(edge.source, (neighbours.get(edge.source) ?? new Set()).add(edge.target));
    neighbours.set(edge.target, (neighbours.get(edge.target) ?? new Set()).add(edge.source));
  }
  const attractorOfForce = (id: string): string | undefined => {
    const item = byId.get(id);
    return item?.type === "force" ? item.attractorId : undefined;
  };
  const highlight = (item: SimNode | undefined): void => {
    if (!item) {
      root.classed("nkp-hyper-hovering", false);
      node.classed("is-lit", false);
      link.classed("is-lit", false);
      region.classed("is-lit", false);
      regionLabel.classed("is-lit", false);
      forces.select(".nkp-hyper-force-label").attr("opacity", 0);
      return;
    }
    const lit = new Set([item.id, ...(neighbours.get(item.id) ?? [])]);
    const forceIds = item.type === "force" ? [item.id] : [...(neighbours.get(item.id) ?? [])];
    const litAttractors = new Set(forceIds.map(attractorOfForce).filter((id): id is string => id !== undefined));
    root.classed("nkp-hyper-hovering", true);
    node.classed("is-lit", (other: SimNode) => lit.has(other.id));
    link.classed("is-lit", (edge: SimLink) => {
      const source = typeof edge.source === "string" ? edge.source : edge.source.id;
      const target = typeof edge.target === "string" ? edge.target : edge.target.id;
      return source === item.id || target === item.id;
    });
    region.classed("is-lit", (group: AttractorGroup) => litAttractors.has(group.attractorId));
    regionLabel.classed("is-lit", (group: AttractorGroup) => litAttractors.has(group.attractorId));
    forces.select(".nkp-hyper-force-label")
      .attr("opacity", (other: SimNode) => other.id === item.id ? 1 : 0);
  };
  node.on("mouseenter", (_event: unknown, item: SimNode) => highlight(item))
    .on("mouseleave", () => highlight(undefined));

  // Hub components (touched by many forces) get longer spokes so their
  // forces fan out instead of piling onto the hub.
  const degree = new Map<string, number>();
  for (const edge of model.edges) degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((item: SimNode) => item.id)
      .distance((edge: SimLink) => 45 + Math.sqrt(degree.get(typeof edge.target === "string" ? edge.target : edge.target.id) ?? 1) * 14)
      .strength(0.18))
    .force("charge", d3.forceManyBody().strength((item: SimNode) => item.type === "component" ? -650 : -130).distanceMax(side))
    .force("x", d3.forceX(cx).strength(0.05))
    .force("y", d3.forceY(cy).strength(0.05))
    .force("collision", d3.forceCollide().radius((item: SimNode) => item.type === "component" ? 30 : 9))
    .force("cohesion", createAttractorCohesionForce());

  node.call(d3.drag()
    .on("start", (event: { active: boolean }, item: SimNode) => {
      if (!event.active) sim.alphaTarget(0.3).restart();
      item.fx = item.x; item.fy = item.y;
    })
    .on("drag", (event: { x: number; y: number }, item: SimNode) => {
      item.fx = event.x; item.fy = event.y;
    })
    .on("end", (event: { active: boolean }, item: SimNode) => {
      if (!event.active) sim.alphaTarget(0);
      item.fx = null; item.fy = null;
    }));

  const pointsOf = (group: AttractorGroup): Point[] => group.forceNodeIds
    .map((id) => byId.get(id))
    .filter((item): item is SimNode => item !== undefined)
    .map((item) => ({ x: item.x ?? 0, y: item.y ?? 0 }));

  const margin = REGION_PADDING + 30;
  sim.on("tick", () => {
    // Keep everything (including region padding and labels) on the canvas.
    for (const item of nodes) {
      item.x = Math.min(width - margin, Math.max(margin, item.x ?? cx));
      item.y = Math.min(height - margin, Math.max(margin, item.y ?? cy));
    }
    regionPath.attr("d", (group: AttractorGroup) => regionCorePath(pointsOf(group)));
    regionLabel.each(function (this: SVGTextElement, group: AttractorGroup) {
      const points = pointsOf(group);
      const center = centroid(points);
      if (!center) return;
      const top = Math.min(...points.map((point) => point.y));
      d3.select(this).attr("x", center.x).attr("y", top - REGION_PADDING - 4);
    });
    link.attr("x1", (edge: { source: SimNode }) => edge.source.x ?? 0)
      .attr("y1", (edge: { source: SimNode }) => edge.source.y ?? 0)
      .attr("x2", (edge: { target: SimNode }) => edge.target.x ?? 0)
      .attr("y2", (edge: { target: SimNode }) => edge.target.y ?? 0);
    node.attr("transform", (item: SimNode) => `translate(${item.x ?? 0},${item.y ?? 0})`);
  });
  return sim;
}
