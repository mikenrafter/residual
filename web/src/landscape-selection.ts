// Cross-view selection model shared by every landscape view (bundle,
// heatmap, regions) and the sidebar. One key space spans all three views —
// `component:<name>`, `force:<EffectiveForce.key>`, `attractor:<id>` —
// matching the ids nkp-graph/nkp-bundle/nkp-hypergraph already use, so a
// click anywhere resolves to a key any other view can highlight.
//
// mountLandscape (nkp-landscape.ts) owns the actual `Set<EntityKey>`; this
// module only provides the pure, DOM-free pieces: turning a key into the
// detail card the sidebar shows, computing what else lights up when a key is
// selected, and the toggle-only (no modifier keys) selection update.

import { attractorColors, effectiveState } from "./nkp-graph";
import type { PendingState } from "./model";

export type EntityKey = `component:${string}` | `force:${string}` | `attractor:${string}`;

export interface EntityDetail {
  key: EntityKey;
  kind: "component" | "stressor" | "purpose" | "attractor";
  title: string;
  color?: string;
  fields: { label: string; value: string }[];
}

/** Hover focus dims non-lit items to this opacity (matches the existing bundle/regions hover behaviour). */
export const HOVER_DIM_OPACITY = 0.12;
/** Selection and hover use the same dimming strength. */
export const SELECTION_DIM_OPACITY = HOVER_DIM_OPACITY;

function keyKind(key: EntityKey): "component" | "force" | "attractor" | undefined {
  if (key.startsWith("component:")) return "component";
  if (key.startsWith("force:")) return "force";
  if (key.startsWith("attractor:")) return "attractor";
  return undefined;
}

function keyId(key: EntityKey): string {
  return key.slice(key.indexOf(":") + 1);
}

/** Every field the tooltips already show for `key`, or undefined when it no longer exists in `state`. */
export function entityDetail(state: PendingState, key: EntityKey): EntityDetail | undefined {
  const { components, attractors, forces } = effectiveState(state);
  const kind = keyKind(key);
  const id = keyId(key);

  if (kind === "component") {
    const component = components.find((candidate) => candidate.name === id);
    if (!component) return undefined;
    const forceCount = forces.filter((force) => force.components.includes(component.name)).length;
    return {
      key,
      kind: "component",
      title: component.name,
      fields: [
        { label: "name", value: component.name },
        { label: "description", value: component.description },
        { label: "status", value: component.status },
        { label: "architecture set", value: component.architectureSet },
        { label: "force count", value: String(forceCount) },
      ],
    };
  }

  if (kind === "force") {
    const force = forces.find((candidate) => candidate.key === id);
    if (!force) return undefined;
    const attractor = attractors.find((candidate) => candidate.id === force.attractorId);
    const changeLabel = force.kind === "stressor" ? "naive change" : "feature";
    return {
      key,
      kind: force.kind,
      title: force.shortname || force.id,
      fields: [
        { label: "id", value: force.id },
        { label: "shortname", value: force.shortname },
        { label: "kind", value: force.kind },
        { label: "description", value: force.description },
        { label: "attractor", value: attractor?.name ?? force.attractorId },
        { label: "components", value: force.components.join(", ") },
        { label: changeLabel, value: force.naiveChangeOrFeature },
        { label: "outcomes", value: force.outcomes },
      ],
    };
  }

  if (kind === "attractor") {
    const attractor = attractors.find((candidate) => candidate.id === id);
    if (!attractor) return undefined;
    const forceCount = forces.filter((force) => force.attractorId === attractor.id).length;
    return {
      key,
      kind: "attractor",
      title: attractor.name,
      color: attractorColors(state).get(attractor.id),
      fields: [
        { label: "name", value: attractor.name },
        { label: "description", value: attractor.description },
        { label: "positive", value: attractor.positiveState },
        { label: "negative", value: attractor.negativeState },
        { label: "force count", value: String(forceCount) },
      ],
    };
  }

  return undefined;
}

/** Full transitive closure over force-component and force-attractor edges. */
export function connectedKeys(state: PendingState, selected: Iterable<EntityKey>): Set<EntityKey> {
  const { forces } = effectiveState(state);
  const adjacency = new Map<EntityKey, EntityKey[]>();
  const connect = (left: EntityKey, right: EntityKey): void => {
    adjacency.set(left, [...(adjacency.get(left) ?? []), right]);
    adjacency.set(right, [...(adjacency.get(right) ?? []), left]);
  };
  for (const force of forces) {
    const forceKey: EntityKey = `force:${force.key}`;
    connect(forceKey, `attractor:${force.attractorId}`);
    for (const component of new Set(force.components)) {
      connect(forceKey, `component:${component}`);
    }
  }

  const result = new Set<EntityKey>();
  const queue = [...selected];
  for (const key of queue) {
    if (result.has(key)) continue;
    result.add(key);
    for (const neighbor of adjacency.get(key) ?? []) {
      if (!result.has(neighbor)) queue.push(neighbor);
    }
  }

  return result;
}

/** Mobile-friendly, no-modifier toggle: adds `key` if absent, removes it if present. Does not mutate `current`. */
export function toggleSelection(current: ReadonlySet<EntityKey>, key: EntityKey): Set<EntityKey> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
