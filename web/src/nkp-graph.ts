import type {
  AddedForce,
  PendingState,
  SnapshotAttractor,
  SnapshotComponent,
  SnapshotForce,
} from "./model";

export interface NkpGraphNode {
  id: string;
  type: "component" | "attractor";
  label: string;
  status?: "actual" | "proposed";
  tooltip: string;
  focused: boolean;
  opacity: number;
  labelVisible: boolean;
  revealLabelOnHover: boolean;
  fissionCandidate?: boolean;
  ringStyle?: "dotted";
}

export interface NkpGraphEdge {
  id: string;
  source: string;
  target: string;
  type: "coupling" | "fusion" | "attractor";
  count: number;
  stressors: string[];
  /** EffectiveForce.key for every force this edge represents, in the same order as `stressors`. */
  forceKeys: string[];
  tooltip: string;
  width: number;
  lineStyle: "solid" | "dotted";
  focused: boolean;
  opacity: number;
}

export interface NkpGraphModel {
  nodes: NkpGraphNode[];
  edges: NkpGraphEdge[];
}

export const DEFAULT_MIN_COUPLING_STRENGTH = 2;

export interface NkpGraphOptions {
  visibleForceIds?: ReadonlySet<string>;
  visibleComponentNames?: ReadonlySet<string>;
  fissionThreshold?: number;
  /** When true, drop filtered-out components and edges instead of fading them. */
  hideFiltered?: boolean;
  /** Minimum shared-force count for coupling/fusion edges; attractor edges are exempt. */
  minCouplingStrength?: number;
  /**
   * Number of coupling-strength tiers to keep, ranked by shared-residue count.
   * Ties within the cutoff tier are all kept ("friendly tie"). Applies atop
   * minCouplingStrength and focus filtering, not instead of them. Attractors
   * are pruned to those still reachable through a kept coupling edge.
   */
  topNCouplings?: number;
  /** Which end of the strength ranking topNCouplings keeps. Defaults to "strongest". */
  topNDirection?: "strongest" | "weakest";
}

export type EffectiveForce = SnapshotForce & { key: string };

/** Pending state flattened to its effective components, attractors and forces (shared by every landscape view). */
export function effectiveState(state: PendingState): {
  components: SnapshotComponent[];
  attractors: SnapshotAttractor[];
  forces: EffectiveForce[];
} {
  const components = [...state.baseComponents, ...state.addedComponents].map((component) => ({
    ...component,
    ...state.updatedComponents[component.name],
  }));
  const attractors = [...state.baseAttractors, ...state.addedAttractors].map((attractor) => ({
    ...attractor,
    ...state.updatedAttractors[attractor.id],
  }));
  const baseForces = state.baseForces
    .filter((force) => state.removedForces?.[force.id] === undefined)
    .map((force): EffectiveForce => ({ ...force, ...state.updatedForces[force.id], key: force.id }));
  const addedForces = state.addedForces.map((force: AddedForce): EffectiveForce => ({
    ...force,
    ...state.updatedForces[force.tempId],
    key: force.tempId,
  }));
  return { components, attractors, forces: [...baseForces, ...addedForces] };
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("\u0000");
}

function edgeMetrics(count: number): Pick<NkpGraphEdge, "width"> {
  return { width: 1 + count * 0.5 };
}

export function forceLabel(force: EffectiveForce): string {
  return force.shortname || force.description || force.key;
}

function applyMinCouplingStrength(edges: NkpGraphEdge[], minCouplingStrength: number): NkpGraphEdge[] {
  return edges.filter((edge) => edge.type === "attractor" || edge.count >= minCouplingStrength);
}

/**
 * Keeps only coupling edges within the top (or bottom) `topN` distinct
 * shared-residue-count tiers. Tied counts share a tier, so a tie at the
 * cutoff keeps every edge in that tier ("friendly tie"). Fusion and
 * attractor edges are untouched here.
 */
function applyTopNCouplings(
  edges: NkpGraphEdge[],
  topN: number | undefined,
  direction: "strongest" | "weakest",
): NkpGraphEdge[] {
  if (topN === undefined) return edges;
  const tiers = [...new Set(edges.filter((edge) => edge.type === "coupling").map((edge) => edge.count))];
  tiers.sort((left, right) => (direction === "weakest" ? left - right : right - left));
  const keptTiers = new Set(tiers.slice(0, Math.max(0, topN)));
  return edges.filter((edge) => edge.type !== "coupling" || keptTiers.has(edge.count));
}

/**
 * Prunes attractor nodes/edges to those still reachable through a surviving
 * coupling edge, once topNCouplings is active. A no-op when topNCouplings is
 * unset, so it never changes behavior for the existing filters.
 */
function applyAttractorRelevance(
  nodes: NkpGraphNode[],
  edges: NkpGraphEdge[],
  topNCouplings: number | undefined,
): { nodes: NkpGraphNode[]; edges: NkpGraphEdge[] } {
  if (topNCouplings === undefined) return { nodes, edges };
  const couplingComponentIds = new Set<string>();
  for (const edge of edges) {
    if (edge.type !== "coupling") continue;
    couplingComponentIds.add(edge.source);
    couplingComponentIds.add(edge.target);
  }
  const relevantEdges = edges.filter((edge) => edge.type !== "attractor" || couplingComponentIds.has(edge.target));
  const relevantAttractorIds = new Set(
    relevantEdges.filter((edge) => edge.type === "attractor").map((edge) => edge.source),
  );
  return {
    nodes: nodes.filter((item) => item.type !== "attractor" || relevantAttractorIds.has(item.id)),
    edges: relevantEdges,
  };
}

/** Drops component nodes with no surviving edge of any kind — nothing links them, so they'd just float. */
function dropUnlinkedComponents(nodes: NkpGraphNode[], edges: NkpGraphEdge[]): NkpGraphNode[] {
  const linkedIds = new Set<string>();
  for (const edge of edges) {
    linkedIds.add(edge.source);
    linkedIds.add(edge.target);
  }
  return nodes.filter((item) => item.type !== "component" || linkedIds.has(item.id));
}

/** Builds the DOM-independent coupling graph that the landscape views draw from. */
export function buildNkpGraphModel(state: PendingState, options: NkpGraphOptions = {}): NkpGraphModel {
  const { components, attractors, forces } = effectiveState(state);
  const visible = options.visibleForceIds;
  const hasFocusFilter = visible !== undefined;
  const isVisibleForce = (force: EffectiveForce): boolean => !hasFocusFilter || visible.has(force.key);
  const isVisibleComponent = (name: string): boolean =>
    options.visibleComponentNames === undefined || options.visibleComponentNames.has(name);
  const componentForces = new Map(components.map((component) => [component.name, [] as EffectiveForce[]]));

  for (const force of forces) {
    for (const name of new Set(force.components)) componentForces.get(name)?.push(force);
  }

  const nodes: NkpGraphNode[] = components.map((component) => {
    const attached = componentForces.get(component.name) ?? [];
    const focused =
      (attached.some(isVisibleForce) || !hasFocusFilter) &&
      isVisibleComponent(component.name);
    const fissionCandidate = attached.length > (options.fissionThreshold ?? Number.POSITIVE_INFINITY);
    return {
      id: `component:${component.name}`,
      type: "component",
      label: component.name,
      status: component.status,
      tooltip: [component.name, component.description, `Status: ${component.status}`, `Architecture set: ${component.architectureSet}`].join("\n"),
      focused,
      opacity: focused ? 1 : 0.5,
      labelVisible: focused,
      revealLabelOnHover: !focused,
      fissionCandidate,
      ...(fissionCandidate ? { ringStyle: "dotted" as const } : {}),
    };
  });

  for (const attractor of attractors) {
    const attached = forces.filter((force) => force.attractorId === attractor.id);
    const focused = attached.some(isVisibleForce) || !hasFocusFilter;
    nodes.push({
      id: `attractor:${attractor.id}`,
      type: "attractor",
      label: attractor.name,
      tooltip: [attractor.name, attractor.description, `Positive: ${attractor.positiveState}`, `Negative: ${attractor.negativeState}`].join("\n"),
      focused,
      opacity: focused ? 0.7 : 0.5,
      labelVisible: focused,
      revealLabelOnHover: !focused,
    });
  }

  const edges: NkpGraphEdge[] = [];
  const couplingGroups = new Map<string, { source: string; target: string; forces: EffectiveForce[] }>();
  for (const force of forces) {
    const names = [...new Set(force.components)].filter((name) => componentForces.has(name)).sort();
    for (let left = 0; left < names.length; left += 1) {
      for (let right = left + 1; right < names.length; right += 1) {
        const source = `component:${names[left]}`;
        const target = `component:${names[right]}`;
        const key = pairKey(source, target);
        const group = couplingGroups.get(key) ?? { source, target, forces: [] };
        group.forces.push(force);
        couplingGroups.set(key, group);
      }
    }
  }

  for (const [key, group] of couplingGroups) {
    const count = group.forces.length;
    const stressors = group.forces.map(forceLabel);
    const focused =
      group.forces.some(isVisibleForce) &&
      isVisibleComponent(group.source.slice("component:".length)) &&
      isVisibleComponent(group.target.slice("component:".length));
    edges.push({
      id: `coupling:${key}`,
      source: group.source,
      target: group.target,
      type: "coupling",
      count,
      stressors,
      forceKeys: group.forces.map((force) => force.key),
      tooltip: `Shared residual forces (${count}): ${stressors.join(", ")}`,
      ...edgeMetrics(count),
      lineStyle: "solid",
      focused,
      opacity: focused ? 1 : 0.5,
    });
  }

  const vectorGroups = new Map<string, string[]>();
  for (const component of components) {
    const vector = (componentForces.get(component.name) ?? []).map((force) => force.key).sort();
    if (vector.length === 0) continue;
    const key = vector.join("\u0000");
    vectorGroups.set(key, [...(vectorGroups.get(key) ?? []), component.name]);
  }
  for (const [vectorKey, names] of vectorGroups) {
    const vectorForces = forces.filter((force) => vectorKey.split("\u0000").includes(force.key));
    for (let left = 0; left < names.length; left += 1) {
      for (let right = left + 1; right < names.length; right += 1) {
        const source = `component:${names[left]}`;
        const target = `component:${names[right]}`;
        const count = vectorForces.length;
        const stressors = vectorForces.map(forceLabel);
        const focused =
          vectorForces.some(isVisibleForce) &&
          isVisibleComponent(names[left] ?? "") &&
          isVisibleComponent(names[right] ?? "");
        edges.push({
          id: `fusion:${pairKey(source, target)}`,
          source,
          target,
          type: "fusion",
          count,
          stressors,
          forceKeys: vectorForces.map((force) => force.key),
          tooltip: `Fusion candidate: identical coupling vector (${stressors.join(", ")})`,
          ...edgeMetrics(count),
          lineStyle: "dotted",
          focused,
          opacity: focused ? 0.8 : 0.5,
        });
      }
    }
  }

  for (const attractor of attractors) {
    const relevant = forces.filter((force) => force.attractorId === attractor.id);
    for (const component of components) {
      const shared = relevant.filter((force) => force.components.includes(component.name));
      if (shared.length === 0) continue;
      const stressors = shared.map(forceLabel);
      const focused = shared.some(isVisibleForce) && isVisibleComponent(component.name);
      edges.push({
        id: `attractor:${attractor.id}:${component.name}`,
        source: `attractor:${attractor.id}`,
        target: `component:${component.name}`,
        type: "attractor",
        count: shared.length,
        stressors,
        forceKeys: shared.map((force) => force.key),
        tooltip: `${attractor.name} forces: ${stressors.join(", ")}`,
        ...edgeMetrics(shared.length),
        lineStyle: "solid",
        focused,
        opacity: focused ? 0.6 : 0.5,
      });
    }
  }

  const minCouplingStrength = options.minCouplingStrength ?? DEFAULT_MIN_COUPLING_STRENGTH;
  const strengthFiltered = applyMinCouplingStrength(edges, minCouplingStrength);
  const topNFiltered = applyTopNCouplings(strengthFiltered, options.topNCouplings, options.topNDirection ?? "strongest");
  const { nodes: relevantNodes, edges: visibleEdges } = applyAttractorRelevance(
    nodes,
    topNFiltered,
    options.topNCouplings,
  );

  if (options.hideFiltered) {
    const visibleNodeIds = new Set(
      relevantNodes.filter((item) => item.type === "attractor" || item.focused).map((item) => item.id),
    );
    const finalNodes = relevantNodes.filter((item) => visibleNodeIds.has(item.id));
    const finalEdges = visibleEdges.filter((item) => item.focused);
    return {
      nodes: dropUnlinkedComponents(finalNodes, finalEdges),
      edges: finalEdges,
    };
  }

  return {
    nodes: dropUnlinkedComponents(relevantNodes, visibleEdges),
    edges: visibleEdges,
  };
}

const GOLDEN_ANGLE = 137.508;

/**
 * Categorical colour for the attractor at `index`. Hues step by the golden
 * angle so any count stays spread around the wheel; lightness alternates so
 * neighbouring slots differ in value as well as hue.
 */
export function attractorColor(index: number): string {
  const hue = Math.round((index * GOLDEN_ANGLE + 20) % 360);
  const lightness = index % 2 === 0 ? 60 : 70;
  return `hsl(${hue} 62% ${lightness}%)`;
}

/**
 * One colour per attractor, keyed by attractor id and assigned in id order,
 * so every landscape view paints the same attractor the same colour.
 */
export function attractorColors(state: PendingState): Map<string, string> {
  const { attractors, forces } = effectiveState(state);
  const ids = [...new Set([...attractors.map((attractor) => attractor.id), ...forces.map((force) => force.attractorId)])].sort();
  return new Map(ids.map((id, index) => [id, attractorColor(index)]));
}
