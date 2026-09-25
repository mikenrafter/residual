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
/** Selection focus is 60% as strong as hover focus. */
export const SELECTION_DIM_OPACITY = 1 - 0.6 * (1 - HOVER_DIM_OPACITY);

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

/**
 * Everything that lights up alongside `selected`, per the locked contract:
 * component -> its forces, their attractors, and components sharing any of
 * those forces; force -> its attractor and its components (not sibling
 * forces); attractor -> its forces and the components they touch. A
 * multi-select unions each entity's own connections, and every selected
 * entity is always part of its own connection set.
 */
export function connectedKeys(state: PendingState, selected: Iterable<EntityKey>): Set<EntityKey> {
  const { forces } = effectiveState(state);
  const forceByKey = new Map(forces.map((force) => [force.key, force]));
  const result = new Set<EntityKey>();

  for (const key of selected) {
    result.add(key);
    const kind = keyKind(key);
    const id = keyId(key);

    if (kind === "component") {
      for (const force of forces.filter((candidate) => candidate.components.includes(id))) {
        result.add(`force:${force.key}`);
        result.add(`attractor:${force.attractorId}`);
        for (const name of force.components) result.add(`component:${name}`);
      }
    } else if (kind === "force") {
      const force = forceByKey.get(id);
      if (force) {
        result.add(`attractor:${force.attractorId}`);
        for (const name of force.components) result.add(`component:${name}`);
      }
    } else if (kind === "attractor") {
      for (const force of forces.filter((candidate) => candidate.attractorId === id)) {
        result.add(`force:${force.key}`);
        for (const name of force.components) result.add(`component:${name}`);
      }
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
