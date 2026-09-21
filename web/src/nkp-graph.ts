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
  tooltip: string;
  width: number;
  distance: number;
  strength: number;
  lineStyle: "solid" | "dotted";
  focused: boolean;
  opacity: number;
}

export interface NkpGraphModel {
  nodes: NkpGraphNode[];
  edges: NkpGraphEdge[];
  simulation: { enabled: boolean; forces: string[] };
}

export interface NkpGraphOptions {
  visibleForceIds?: ReadonlySet<string>;
  visibleComponentNames?: ReadonlySet<string>;
  fissionThreshold?: number;
  /** When true, drop filtered-out components and edges instead of fading them. */
  hideFiltered?: boolean;
}

type EffectiveForce = SnapshotForce & { key: string };

function effectiveState(state: PendingState): {
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

function edgeMetrics(count: number): Pick<NkpGraphEdge, "width" | "distance" | "strength"> {
  return {
    width: 1 + count * 0.5,
    distance: Math.max(90, 200 - count * 14),
    strength: Math.min(0.28, 0.03 + count * 0.025),
  };
}

const LATTICE_SPACING = 78;
const LATTICE_ROW_HEIGHT = LATTICE_SPACING * (Math.sqrt(3) / 2);

function nearestHexLatticePoint(x: number, y: number, centerX: number, centerY: number): { x: number; y: number } {
  const localX = x - centerX;
  const localY = y - centerY;
  const row = Math.round(localY / LATTICE_ROW_HEIGHT);
  const offset = row % 2 === 0 ? 0 : LATTICE_SPACING / 2;
  const col = Math.round((localX - offset) / LATTICE_SPACING);
  return {
    x: centerX + col * LATTICE_SPACING + offset,
    y: centerY + row * LATTICE_ROW_HEIGHT,
  };
}

function createHexLatticeForce(centerX: number, centerY: number, strength = 0.24) {
  let nodes: SimulationNode[] = [];
  const force = (alpha: number): void => {
    for (const node of nodes) {
      if (node.fx != null || node.fy != null) continue;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const target = nearestHexLatticePoint(x, y, centerX, centerY);
      const pull = strength * alpha;
      node.vx = (node.vx ?? 0) + (target.x - x) * pull;
      node.vy = (node.vy ?? 0) + (target.y - y) * pull;
    }
  };
  force.initialize = (next: SimulationNode[]): void => {
    nodes = next;
  };
  return force;
}

function forceLabel(force: EffectiveForce): string {
  return force.shortname || force.description || force.key;
}

/** Builds the DOM-independent data consumed by the live NKP graph renderer. */
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
          isVisibleComponent(names[left]) &&
          isVisibleComponent(names[right]);
        edges.push({
          id: `fusion:${pairKey(source, target)}`,
          source,
          target,
          type: "fusion",
          count,
          stressors,
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
        tooltip: `${attractor.name} forces: ${stressors.join(", ")}`,
        ...edgeMetrics(shared.length),
        lineStyle: "solid",
        focused,
        opacity: focused ? 0.6 : 0.5,
      });
    }
  }

  if (options.hideFiltered) {
    const visibleNodeIds = new Set(
      nodes.filter((item) => item.type === "attractor" || item.focused).map((item) => item.id),
    );
    return {
      nodes: nodes.filter((item) => visibleNodeIds.has(item.id)),
      edges: edges.filter((item) => item.focused),
      simulation: { enabled: true, forces: ["link", "charge", "center", "collision", "lattice"] },
    };
  }

  return {
    nodes,
    edges,
    simulation: { enabled: true, forces: ["link", "charge", "center", "collision", "lattice"] },
  };
}

interface SimulationNode extends NkpGraphNode {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface NkpGraphHandle {
  sync: () => void;
  destroy: () => void;
}

function visibleMatrixState(container: HTMLElement): {
  forceIds: Set<string>;
  componentNames: Set<string>;
  fissionThreshold: number;
  hideFiltered: boolean;
} {
  const forceIds = new Set(
    Array.from(container.querySelectorAll<HTMLTableRowElement>("table.matrix tbody tr.force-row"))
      .filter((row) => !row.hidden)
      .map((row) => row.getAttribute("data-force-id"))
      .filter((id): id is string => id !== null),
  );
  const componentNames = new Set(
    Array.from(container.querySelectorAll<HTMLElement>("table.matrix thead [data-component]"))
      .filter((element) => !element.hidden)
      .map((element) => element.getAttribute("data-component"))
      .filter((name): name is string => name !== null),
  );
  const threshold = container.querySelector<HTMLInputElement>("[data-threshold-input]");
  const hideFilteredToggle = container.querySelector<HTMLInputElement>("[data-hide-filtered-graph-toggle]");
  return {
    forceIds,
    componentNames,
    fissionThreshold: Number(threshold?.value ?? 1),
    hideFiltered: hideFilteredToggle?.checked ?? true,
  };
}

/** Mounts the read-only, force-directed view of the current pending landscape. */
export function mountNkpGraph(
  container: HTMLElement,
  getState: () => PendingState,
  d3: any,
): NkpGraphHandle {
  const host = container.querySelector<HTMLElement>("[data-nkp-graph]");
  let simulation: { stop: () => void } | undefined;

  const sync = (): void => {
    if (!host) return;
    simulation?.stop();
    host.replaceChildren();

    const { forceIds, componentNames, fissionThreshold, hideFiltered } = visibleMatrixState(container);
    const model = buildNkpGraphModel(getState(), {
      visibleForceIds: forceIds,
      visibleComponentNames: componentNames,
      fissionThreshold,
      hideFiltered,
    });
    if (model.nodes.length === 0) {
      const empty = document.createElement("p");
      empty.className = "nkp-graph-empty";
      empty.textContent = "No components or attractors to graph.";
      host.appendChild(empty);
      return;
    }

    const width = Math.max(host.clientWidth || 0, 640);
    const height = Math.max(360, Math.min(620, Math.round(width * 0.58)));
    const svg = d3.select(host).append("svg")
      .attr("class", "nkp-graph-svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", "Live NKP component coupling graph");

    const nodes: SimulationNode[] = model.nodes.map((node) => ({ ...node }));
    const links = model.edges.map((edge) => ({ ...edge }));
    const link = svg.append("g").attr("class", "nkp-graph-edges")
      .selectAll("line").data(links).join("line")
      .attr("class", (edge: NkpGraphEdge) => `nkp-edge nkp-edge-${edge.type}`)
      .attr("stroke-width", (edge: NkpGraphEdge) => edge.width)
      .attr("stroke-opacity", (edge: NkpGraphEdge) => edge.opacity)
      .attr("stroke-dasharray", (edge: NkpGraphEdge) => edge.lineStyle === "dotted" ? "3 5" : null);
    link.append("title").text((edge: NkpGraphEdge) => edge.tooltip);

    const node = svg.append("g").attr("class", "nkp-graph-nodes")
      .selectAll("g").data(nodes).join("g")
      .attr("class", (item: SimulationNode) => `nkp-node nkp-node-${item.type}`)
      .attr("opacity", (item: SimulationNode) => item.opacity);

    node.filter((item: SimulationNode) => Boolean(item.fissionCandidate)).append("circle")
      .attr("class", "nkp-fission-ring").attr("r", 18).attr("fill", "none")
      .attr("stroke-dasharray", "3 4");
    node.append("circle")
      .attr("class", (item: SimulationNode) => `nkp-node-dot ${item.status ? `status-${item.status}` : ""}`)
      .attr("r", (item: SimulationNode) => item.type === "attractor" ? 7 : 10);
    node.append("text")
      .attr("class", "nkp-node-label").attr("x", 0)
      .attr("y", (item: SimulationNode) => item.fissionCandidate ? -22 : -15)
      .attr("text-anchor", "middle")
      .attr("opacity", (item: SimulationNode) => item.labelVisible ? 1 : 0)
      .text((item: SimulationNode) => item.label);
    node.append("title").text((item: SimulationNode) => item.tooltip);
    node.on("mouseenter", function (this: SVGGElement, _event: unknown, item: SimulationNode) {
      if (item.revealLabelOnHover) d3.select(this).select(".nkp-node-label").attr("opacity", 1);
    }).on("mouseleave", function (this: SVGGElement, _event: unknown, item: SimulationNode) {
      if (item.revealLabelOnHover) d3.select(this).select(".nkp-node-label").attr("opacity", 0);
    });

    const centerX = width / 2;
    const centerY = height / 2;
    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((item: SimulationNode) => item.id)
        .distance((edge: NkpGraphEdge) => edge.distance)
        .strength((edge: NkpGraphEdge) => edge.strength))
      .force("charge", d3.forceManyBody().strength(-360))
      .force("center", d3.forceCenter(centerX, centerY))
      .force("collision", d3.forceCollide().radius((item: SimulationNode) => item.type === "attractor" ? 34 : 46))
      .force("lattice", createHexLatticeForce(centerX, centerY));
    simulation = sim;
    node.call(d3.drag()
      .on("start", (event: { active: boolean }, item: SimulationNode) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        item.fx = item.x; item.fy = item.y;
      })
      .on("drag", (event: { x: number; y: number }, item: SimulationNode) => {
        item.fx = event.x; item.fy = event.y;
      })
      .on("end", (event: { active: boolean }, item: SimulationNode) => {
        if (!event.active) sim.alphaTarget(0);
        item.fx = null; item.fy = null;
      }));
    sim.on("tick", () => {
      link.attr("x1", (edge: { source: SimulationNode }) => edge.source.x ?? 0)
        .attr("y1", (edge: { source: SimulationNode }) => edge.source.y ?? 0)
        .attr("x2", (edge: { target: SimulationNode }) => edge.target.x ?? 0)
        .attr("y2", (edge: { target: SimulationNode }) => edge.target.y ?? 0);
      node.attr("transform", (item: SimulationNode) => `translate(${item.x ?? 0},${item.y ?? 0})`);
    });
  };

  const syncAfterControl = (event: Event): void => {
    const target = event.target;
    if (target instanceof Element && target.closest(
      "[data-force-filter], [data-show-proposed-toggle], [data-show-unrelated-toggle], [data-threshold-input], [data-fusion-fission-filter], [data-hide-filtered-graph-toggle]",
    )) queueMicrotask(sync);
  };
  container.addEventListener("input", syncAfterControl);
  container.addEventListener("change", syncAfterControl);
  sync();
  return {
    sync,
    destroy: () => {
      simulation?.stop();
      container.removeEventListener("input", syncAfterControl);
      container.removeEventListener("change", syncAfterControl);
      host?.replaceChildren();
    },
  };
}
