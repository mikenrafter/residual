// src/snapshot-bridge.ts
function mapForce(raw, kind, residues) {
  return {
    id: raw.id,
    kind,
    description: raw.description,
    attractorId: raw.attractor_id,
    naiveChangeOrFeature: raw.naive_change,
    outcomes: raw.outcomes,
    shortname: raw.shortname,
    components: residues.filter((r) => r.force_id === raw.id && r.coupled === true).map((r) => r.component_id)
  };
}
function snapshotToPendingState(raw) {
  const baseAttractors = raw.attractors.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    positiveState: a.positive_state,
    negativeState: a.negative_state
  }));
  const baseComponents = raw.components.map((c) => ({
    name: c.name,
    description: c.description,
    status: c.status,
    architectureSet: c.architecture_set
  }));
  const mappedStressors = raw.stressors.map((s) => mapForce(s, "stressor", raw.residues));
  const mappedPurposes = raw.purposes.map((p) => mapForce(p, "purpose", raw.residues));
  return {
    baseAttractors,
    baseComponents,
    baseForces: [...mappedStressors, ...mappedPurposes],
    basePersonas: [],
    baseTerms: [],
    addedAttractors: [],
    addedComponents: [],
    addedForces: [],
    addedPersonas: [],
    addedTerms: [],
    updatedAttractors: {},
    updatedComponents: {},
    updatedForces: {},
    updatedPersonas: {},
    updatedTerms: {}
  };
}

// src/actions.ts
function sameElements(a, b) {
  if (a.length !== b.length)
    return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}
function toggled(components, name) {
  return components.includes(name) ? components.filter((c) => c !== name) : [...components, name];
}
function toggleComponent(state, forceKey, componentName) {
  const addedIndex = state.addedForces.findIndex((f) => f.tempId === forceKey);
  if (addedIndex !== -1) {
    const target = state.addedForces[addedIndex];
    const nextForce = { ...target, components: toggled(target.components, componentName) };
    const nextAddedForces = [...state.addedForces];
    nextAddedForces[addedIndex] = nextForce;
    return { ...state, addedForces: nextAddedForces };
  }
  const base = state.baseForces.find((f) => f.id === forceKey);
  if (base === undefined) {
    return state;
  }
  const existingUpdate = state.updatedForces[forceKey];
  const effective = existingUpdate?.components ?? base.components;
  const nextComponents = toggled(effective, componentName);
  const nextUpdatedForces = { ...state.updatedForces };
  if (sameElements(nextComponents, base.components)) {
    if (existingUpdate === undefined) {
      return state;
    }
    const { components: _components, ...rest } = existingUpdate;
    if (Object.keys(rest).length === 0) {
      delete nextUpdatedForces[forceKey];
    } else {
      nextUpdatedForces[forceKey] = rest;
    }
  } else {
    nextUpdatedForces[forceKey] = { ...existingUpdate, components: nextComponents };
  }
  return { ...state, updatedForces: nextUpdatedForces };
}
function addForceRow(state, kind) {
  let maxN = 0;
  for (const f of state.addedForces) {
    const match = /^NEW-(\d+)$/.exec(f.tempId);
    if (match) {
      const n = Number(match[1]);
      if (n > maxN)
        maxN = n;
    }
  }
  const tempId = `NEW-${maxN + 1}`;
  const newForce = {
    tempId,
    kind,
    description: "",
    attractorId: "",
    naiveChangeOrFeature: "",
    outcomes: "",
    shortname: "",
    components: []
  };
  return { state: { ...state, addedForces: [...state.addedForces, newForce] }, tempId };
}
function updateForceField(state, forceKey, field, value) {
  const addedIndex = state.addedForces.findIndex((f) => f.tempId === forceKey);
  if (addedIndex !== -1) {
    const target = state.addedForces[addedIndex];
    const nextForce = { ...target, [field]: value };
    const nextAddedForces = [...state.addedForces];
    nextAddedForces[addedIndex] = nextForce;
    return { ...state, addedForces: nextAddedForces };
  }
  const existingUpdate = state.updatedForces[forceKey];
  return {
    ...state,
    updatedForces: {
      ...state.updatedForces,
      [forceKey]: { ...existingUpdate, [field]: value }
    }
  };
}
function removeForce(state, forceKey) {
  const addedForces = state.addedForces.filter((force) => force.tempId !== forceKey);
  const updatedForces = { ...state.updatedForces };
  delete updatedForces[forceKey];
  if (addedForces.length !== state.addedForces.length) {
    return { ...state, addedForces, updatedForces };
  }
  const base = state.baseForces.find((force) => force.id === forceKey);
  if (base === undefined)
    return state;
  return {
    ...state,
    updatedForces,
    removedForces: { ...state.removedForces, [forceKey]: base.kind }
  };
}
function setAddedForceKind(state, tempId, kind) {
  const addedIndex = state.addedForces.findIndex((f) => f.tempId === tempId);
  if (addedIndex === -1)
    return state;
  const nextForce = { ...state.addedForces[addedIndex], kind };
  const nextAddedForces = [...state.addedForces];
  nextAddedForces[addedIndex] = nextForce;
  return { ...state, addedForces: nextAddedForces };
}
function addComponentColumn(state, component) {
  const exists = state.baseComponents.some((c) => c.name === component.name) || state.addedComponents.some((c) => c.name === component.name);
  if (exists) {
    throw new Error(`component "${component.name}" already exists`);
  }
  return { ...state, addedComponents: [...state.addedComponents, component] };
}
function addAttractorOption(state, attractor) {
  const exists = state.baseAttractors.some((a) => a.id === attractor.id) || state.addedAttractors.some((a) => a.id === attractor.id);
  if (exists) {
    throw new Error(`attractor "${attractor.id}" already exists`);
  }
  return { ...state, addedAttractors: [...state.addedAttractors, attractor] };
}

// src/model.ts
var REQUIRED_FORCE_FIELDS = [
  "description",
  "attractorId",
  "naiveChangeOrFeature",
  "shortname"
];
function computeStateValidity(state) {
  const invalidForceIds = new Set;
  const invalidReasonsByForce = {};
  const evaluate = (id, merged) => {
    const reasons = [];
    for (const field of REQUIRED_FORCE_FIELDS) {
      if (merged[field] === "")
        reasons.push(field);
    }
    if (merged.components.length === 0)
      reasons.push("components");
    if (reasons.length > 0) {
      invalidForceIds.add(id);
      invalidReasonsByForce[id] = reasons;
    }
  };
  for (const base of state.baseForces) {
    if (state.removedForces?.[base.id] !== undefined)
      continue;
    const update = state.updatedForces[base.id];
    evaluate(base.id, {
      description: update?.description ?? base.description,
      attractorId: update?.attractorId ?? base.attractorId,
      naiveChangeOrFeature: update?.naiveChangeOrFeature ?? base.naiveChangeOrFeature,
      shortname: update?.shortname ?? base.shortname,
      components: update?.components ?? base.components
    });
  }
  for (const added of state.addedForces) {
    const update = state.updatedForces[added.tempId];
    evaluate(added.tempId, {
      description: update?.description ?? added.description,
      attractorId: update?.attractorId ?? added.attractorId,
      naiveChangeOrFeature: update?.naiveChangeOrFeature ?? added.naiveChangeOrFeature,
      shortname: update?.shortname ?? added.shortname,
      components: update?.components ?? added.components
    });
  }
  return { invalidForceIds, invalidReasonsByForce };
}
function orderedEntries(state) {
  const addedForceTempIds = new Set(state.addedForces.map((f) => f.tempId));
  const adds = [
    ...state.addedComponents.map((c) => ({ bucket: "component", action: "add", key: c.name })),
    ...state.addedAttractors.map((a) => ({ bucket: "attractor", action: "add", key: a.name })),
    ...state.addedPersonas.map((p) => ({ bucket: "persona", action: "add", key: p.name })),
    ...state.addedTerms.map((t) => ({ bucket: "term", action: "add", key: t.term })),
    ...state.addedForces.map((f) => ({ bucket: "force", action: "add", key: f.tempId }))
  ];
  const updates = [
    ...Object.keys(state.updatedComponents).map((k) => ({ bucket: "component", action: "update", key: k })),
    ...Object.keys(state.updatedAttractors).map((k) => ({ bucket: "attractor", action: "update", key: k })),
    ...Object.keys(state.updatedPersonas).map((k) => ({ bucket: "persona", action: "update", key: k })),
    ...Object.keys(state.updatedTerms).map((k) => ({ bucket: "term", action: "update", key: k })),
    ...state.addedForces.filter((f) => f.components.length > 0).map((f) => ({ bucket: "force", action: "update", key: f.tempId })),
    ...Object.keys(state.updatedForces).filter((k) => state.removedForces?.[k] === undefined).filter((k) => !addedForceTempIds.has(k)).map((k) => ({ bucket: "force", action: "update", key: k }))
  ];
  return [...adds, ...updates];
}
function quoteValue(value) {
  return `"${value.replace(/"/g, "\\\"")}"`;
}
function flagText(name, value) {
  return `--${name} ${quoteValue(value)}`;
}
function toCommandLines(state) {
  const validity = computeStateValidity(state);
  const entries = orderedEntries(state);
  const addedComponentByName = new Map(state.addedComponents.map((c) => [c.name, c]));
  const addedAttractorByName = new Map(state.addedAttractors.map((a) => [a.name, a]));
  const addedPersonaByName = new Map(state.addedPersonas.map((p) => [p.name, p]));
  const addedTermByTerm = new Map(state.addedTerms.map((t) => [t.term, t]));
  const addedForceByTempId = new Map(state.addedForces.map((f) => [f.tempId, f]));
  const baseForceById = new Map(state.baseForces.map((f) => [f.id, f]));
  const attractorShortname = (id) => [...state.baseAttractors, ...state.addedAttractors].find((attractor) => attractor.id === id)?.name ?? id;
  const forceIsValid = (key) => !validity.invalidForceIds.has(key);
  const renderComponentAdd = (name) => {
    const c = addedComponentByName.get(name);
    const line = [
      "residual add component",
      flagText("architecture-set", c.architectureSet),
      flagText("description", c.description),
      flagText("name", c.name),
      flagText("status", c.status)
    ].join(" ");
    return { line, valid: true };
  };
  const renderComponentUpdate = (name) => {
    const update = state.updatedComponents[name];
    const parts = ["residual update component", flagText("name", name)];
    if (update.architectureSet !== undefined)
      parts.push(flagText("architecture-set", update.architectureSet));
    if (update.description !== undefined)
      parts.push(flagText("description", update.description));
    if (update.status !== undefined)
      parts.push(flagText("status", update.status));
    return { line: parts.join(" "), valid: true };
  };
  const renderAttractorAdd = (name) => {
    const a = addedAttractorByName.get(name);
    const line = [
      "residual add attractor",
      flagText("description", a.description),
      flagText("name", a.name),
      flagText("negative-state", a.negativeState),
      flagText("positive-state", a.positiveState)
    ].join(" ");
    return { line, valid: true };
  };
  const renderAttractorUpdate = (id) => {
    const update = state.updatedAttractors[id];
    const parts = ["residual update attractor", flagText("id", id)];
    if (update.description !== undefined)
      parts.push(flagText("description", update.description));
    if (update.name !== undefined)
      parts.push(flagText("name", update.name));
    if (update.negativeState !== undefined)
      parts.push(flagText("negative-state", update.negativeState));
    if (update.positiveState !== undefined)
      parts.push(flagText("positive-state", update.positiveState));
    return { line: parts.join(" "), valid: true };
  };
  const renderPersonaAdd = (name) => {
    const p = addedPersonaByName.get(name);
    const parts = ["residual add persona"];
    if (p.concerns !== undefined)
      parts.push(flagText("concerns", p.concerns));
    if (p.desires !== undefined)
      parts.push(flagText("desires", p.desires));
    parts.push(flagText("name", p.name));
    parts.push(flagText("role", p.role));
    return { line: parts.join(" "), valid: true };
  };
  const renderPersonaUpdate = (name) => {
    const update = state.updatedPersonas[name];
    const parts = ["residual update persona"];
    if (update.concerns !== undefined)
      parts.push(flagText("concerns", update.concerns));
    if (update.desires !== undefined)
      parts.push(flagText("desires", update.desires));
    parts.push(flagText("name", name));
    if (update.role !== undefined)
      parts.push(flagText("role", update.role));
    return { line: parts.join(" "), valid: true };
  };
  const renderTermAdd = (term) => {
    const t = addedTermByTerm.get(term);
    const parts = ["residual add term", flagText("definition", t.definition)];
    if (t.domain !== undefined)
      parts.push(flagText("domain", t.domain));
    if (t.related !== undefined)
      parts.push(flagText("related", t.related));
    parts.push(flagText("term", t.term));
    return { line: parts.join(" "), valid: true };
  };
  const renderTermUpdate = (term) => {
    const update = state.updatedTerms[term];
    const parts = ["residual update term"];
    if (update.definition !== undefined)
      parts.push(flagText("definition", update.definition));
    if (update.domain !== undefined)
      parts.push(flagText("domain", update.domain));
    if (update.related !== undefined)
      parts.push(flagText("related", update.related));
    parts.push(flagText("term", term));
    return { line: parts.join(" "), valid: true };
  };
  const renderForceAdd = (tempId) => {
    const f = addedForceByTempId.get(tempId);
    const valid = forceIsValid(tempId);
    const flags = [
      flagText("attractor-shortname", attractorShortname(f.attractorId)),
      flagText("description", f.description),
      flagText("naive-change", f.naiveChangeOrFeature),
      flagText("shortname", f.shortname)
    ];
    if (f.outcomes !== "")
      flags.push(flagText("outcomes", f.outcomes));
    return { line: ["residual add", f.kind, ...flags].join(" "), valid };
  };
  const renderForceUpdateSynthetic = (tempId) => {
    const f = addedForceByTempId.get(tempId);
    const valid = forceIsValid(tempId);
    const parts = [`residual update ${f.kind}`, flagText("shortname", f.shortname)];
    for (const component of f.components) {
      parts.push(flagText("add-component", component));
    }
    return { line: parts.join(" "), valid };
  };
  const renderForceUpdateReal = (id) => {
    const base = baseForceById.get(id);
    const update = state.updatedForces[id];
    const valid = forceIsValid(id);
    const parts = [`residual update ${base.kind}`, flagText("shortname", base.shortname)];
    if (update.description !== undefined)
      parts.push(flagText("description", update.description));
    if (update.attractorId !== undefined) {
      parts.push(flagText("attractor-shortname", attractorShortname(update.attractorId)));
    }
    if (update.naiveChangeOrFeature !== undefined)
      parts.push(flagText("naive-change", update.naiveChangeOrFeature));
    if (update.outcomes !== undefined)
      parts.push(flagText("outcomes", update.outcomes));
    if (update.shortname !== undefined)
      parts.push(flagText("rename", update.shortname));
    if (update.components !== undefined) {
      const before = new Set(base.components);
      const after = new Set(update.components);
      const added = update.components.filter((c) => !before.has(c));
      const removed = base.components.filter((c) => !after.has(c));
      for (const c of added)
        parts.push(flagText("add-component", c));
      for (const c of removed)
        parts.push(flagText("remove-component", c));
    }
    return { line: parts.join(" "), valid };
  };
  const lines = entries.map((entry) => {
    if (entry.bucket === "component") {
      return entry.action === "add" ? renderComponentAdd(entry.key) : renderComponentUpdate(entry.key);
    }
    if (entry.bucket === "attractor") {
      return entry.action === "add" ? renderAttractorAdd(entry.key) : renderAttractorUpdate(entry.key);
    }
    if (entry.bucket === "persona") {
      return entry.action === "add" ? renderPersonaAdd(entry.key) : renderPersonaUpdate(entry.key);
    }
    if (entry.bucket === "term") {
      return entry.action === "add" ? renderTermAdd(entry.key) : renderTermUpdate(entry.key);
    }
    if (entry.action === "add")
      return renderForceAdd(entry.key);
    return addedForceByTempId.has(entry.key) ? renderForceUpdateSynthetic(entry.key) : renderForceUpdateReal(entry.key);
  });
  for (const [id, kind] of Object.entries(state.removedForces ?? {})) {
    const force = baseForceById.get(id);
    if (force !== undefined) {
      lines.push({ line: `residual ${kind} remove ${flagText("shortname", force.shortname)}`, valid: true });
    }
  }
  return lines;
}

// src/render-decisions.ts
function computeInvalidMarks(state) {
  const { invalidForceIds } = computeStateValidity(state);
  return {
    invalidForceKeys: new Set(invalidForceIds),
    invalidComponentColumns: new Set
  };
}
function visibleComponents(state, options) {
  const all = [...state.baseComponents, ...state.addedComponents];
  const filtered = options.showProposed ? all : all.filter((c) => c.status !== "proposed");
  if (options.showUnrelated) {
    return filtered.map((c) => c.name);
  }
  const relevantBaseForces = state.baseForces.filter((f) => options.filteredForceIds === null || options.filteredForceIds.includes(f.id));
  const relevantAddedForces = state.addedForces.filter((f) => options.filteredForceIds === null || options.filteredForceIds.includes(f.tempId));
  const relatedComponentNames = new Set;
  for (const base of relevantBaseForces) {
    const update = state.updatedForces[base.id];
    const components = update?.components ?? base.components;
    for (const name of components)
      relatedComponentNames.add(name);
  }
  for (const added of relevantAddedForces) {
    for (const name of added.components)
      relatedComponentNames.add(name);
  }
  return filtered.filter((c) => relatedComponentNames.has(c.name)).map((c) => c.name);
}
function attractorOptions(state) {
  const all = [...state.baseAttractors, ...state.addedAttractors];
  return all.map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name));
}

// src/nkp-graph.ts
var DEFAULT_MIN_COUPLING_STRENGTH = 2;
function effectiveState(state) {
  const components = [...state.baseComponents, ...state.addedComponents].map((component) => ({
    ...component,
    ...state.updatedComponents[component.name]
  }));
  const attractors = [...state.baseAttractors, ...state.addedAttractors].map((attractor) => ({
    ...attractor,
    ...state.updatedAttractors[attractor.id]
  }));
  const baseForces = state.baseForces.filter((force) => state.removedForces?.[force.id] === undefined).map((force) => ({ ...force, ...state.updatedForces[force.id], key: force.id }));
  const addedForces = state.addedForces.map((force) => ({
    ...force,
    ...state.updatedForces[force.tempId],
    key: force.tempId
  }));
  return { components, attractors, forces: [...baseForces, ...addedForces] };
}
function pairKey(left, right) {
  return [left, right].sort().join("\x00");
}
function edgeMetrics(count) {
  return { width: 1 + count * 0.5 };
}
function forceLabel(force) {
  return force.shortname || force.description || force.key;
}
function dominantAttractor(forces, componentName) {
  const counts = new Map;
  for (const force of forces) {
    if (!force.components.includes(componentName))
      continue;
    counts.set(force.attractorId, (counts.get(force.attractorId) ?? 0) + 1);
  }
  return [...counts].sort(([leftId, leftCount], [rightId, rightCount]) => rightCount - leftCount || leftId.localeCompare(rightId))[0]?.[0];
}
function applyMinCouplingStrength(edges, minCouplingStrength) {
  return edges.filter((edge) => edge.type === "attractor" || edge.count >= minCouplingStrength);
}
function applyTopNCouplings(edges, topN, direction) {
  if (topN === undefined)
    return edges;
  const tiers = [...new Set(edges.filter((edge) => edge.type === "coupling").map((edge) => edge.count))];
  tiers.sort((left, right) => direction === "weakest" ? left - right : right - left);
  const keptTiers = new Set(tiers.slice(0, Math.max(0, topN)));
  return edges.filter((edge) => edge.type !== "coupling" || keptTiers.has(edge.count));
}
function applyAttractorRelevance(nodes, edges, topNCouplings) {
  if (topNCouplings === undefined)
    return { nodes, edges };
  const couplingComponentIds = new Set;
  for (const edge of edges) {
    if (edge.type !== "coupling")
      continue;
    couplingComponentIds.add(edge.source);
    couplingComponentIds.add(edge.target);
  }
  const relevantEdges = edges.filter((edge) => edge.type !== "attractor" || couplingComponentIds.has(edge.target));
  const relevantAttractorIds = new Set(relevantEdges.filter((edge) => edge.type === "attractor").map((edge) => edge.source));
  return {
    nodes: nodes.filter((item) => item.type !== "attractor" || relevantAttractorIds.has(item.id)),
    edges: relevantEdges
  };
}
function dropUnlinkedComponents(nodes, edges) {
  const linkedIds = new Set;
  for (const edge of edges) {
    linkedIds.add(edge.source);
    linkedIds.add(edge.target);
  }
  return nodes.filter((item) => item.type !== "component" || linkedIds.has(item.id));
}
function buildNkpGraphModel(state, options = {}) {
  const { components, attractors, forces } = effectiveState(state);
  const colors = attractorColors(state);
  const visible = options.visibleForceIds;
  const hasFocusFilter = visible !== undefined;
  const isVisibleForce = (force) => !hasFocusFilter || visible.has(force.key);
  const isVisibleComponent = (name) => options.visibleComponentNames === undefined || options.visibleComponentNames.has(name);
  const componentForces = new Map(components.map((component) => [component.name, []]));
  for (const force of forces) {
    for (const name of new Set(force.components))
      componentForces.get(name)?.push(force);
  }
  const nodes = components.map((component) => {
    const attached = componentForces.get(component.name) ?? [];
    const focused = (attached.some(isVisibleForce) || !hasFocusFilter) && isVisibleComponent(component.name);
    const fissionCandidate = attached.length > (options.fissionThreshold ?? Number.POSITIVE_INFINITY);
    const dominantAttractorId = dominantAttractor(forces, component.name);
    return {
      id: `component:${component.name}`,
      type: "component",
      label: component.name,
      status: component.status,
      tooltip: [component.name, component.description, `Status: ${component.status}`, `Architecture set: ${component.architectureSet}`].join(`
`),
      focused,
      opacity: focused ? 1 : 0.5,
      labelVisible: focused,
      revealLabelOnHover: !focused,
      shape: component.status === "actual" ? "circle" : "square",
      color: dominantAttractorId === undefined ? "var(--muted)" : mutedAttractorColor(colors.get(dominantAttractorId) ?? "var(--muted)"),
      ...dominantAttractorId ? { dominantAttractorId } : {},
      fissionCandidate,
      ...fissionCandidate ? { ringStyle: "dotted" } : {}
    };
  });
  for (const attractor of attractors) {
    const attached = forces.filter((force) => force.attractorId === attractor.id);
    const focused = attached.some(isVisibleForce) || !hasFocusFilter;
    nodes.push({
      id: `attractor:${attractor.id}`,
      type: "attractor",
      label: attractor.name,
      tooltip: [attractor.name, attractor.description, `Positive: ${attractor.positiveState}`, `Negative: ${attractor.negativeState}`].join(`
`),
      focused,
      opacity: focused ? 0.7 : 0.5,
      labelVisible: focused,
      revealLabelOnHover: !focused
    });
  }
  const edges = [];
  const couplingGroups = new Map;
  for (const force of forces) {
    const names = [...new Set(force.components)].filter((name) => componentForces.has(name)).sort();
    for (let left = 0;left < names.length; left += 1) {
      for (let right = left + 1;right < names.length; right += 1) {
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
    const focused = group.forces.some(isVisibleForce) && isVisibleComponent(group.source.slice("component:".length)) && isVisibleComponent(group.target.slice("component:".length));
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
      opacity: focused ? 1 : 0.5
    });
  }
  const vectorGroups = new Map;
  for (const component of components) {
    const vector = (componentForces.get(component.name) ?? []).map((force) => force.key).sort();
    if (vector.length === 0)
      continue;
    const key = vector.join("\x00");
    vectorGroups.set(key, [...vectorGroups.get(key) ?? [], component.name]);
  }
  for (const [vectorKey, names] of vectorGroups) {
    const vectorForces = forces.filter((force) => vectorKey.split("\x00").includes(force.key));
    for (let left = 0;left < names.length; left += 1) {
      for (let right = left + 1;right < names.length; right += 1) {
        const source = `component:${names[left]}`;
        const target = `component:${names[right]}`;
        const count = vectorForces.length;
        const stressors = vectorForces.map(forceLabel);
        const focused = vectorForces.some(isVisibleForce) && isVisibleComponent(names[left] ?? "") && isVisibleComponent(names[right] ?? "");
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
          opacity: focused ? 0.8 : 0.5
        });
      }
    }
  }
  for (const attractor of attractors) {
    const relevant = forces.filter((force) => force.attractorId === attractor.id);
    for (const component of components) {
      const shared = relevant.filter((force) => force.components.includes(component.name));
      if (shared.length === 0)
        continue;
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
        opacity: focused ? 0.6 : 0.5
      });
    }
  }
  const minCouplingStrength = options.minCouplingStrength ?? DEFAULT_MIN_COUPLING_STRENGTH;
  const strengthFiltered = applyMinCouplingStrength(edges, minCouplingStrength);
  const topNFiltered = applyTopNCouplings(strengthFiltered, options.topNCouplings, options.topNDirection ?? "strongest");
  const { nodes: relevantNodes, edges: visibleEdges } = applyAttractorRelevance(nodes, topNFiltered, options.topNCouplings);
  if (options.hideFiltered) {
    const visibleNodeIds = new Set(relevantNodes.filter((item) => item.type === "attractor" || item.focused).map((item) => item.id));
    const finalNodes = relevantNodes.filter((item) => visibleNodeIds.has(item.id));
    const finalEdges = visibleEdges.filter((item) => item.focused);
    return {
      nodes: dropUnlinkedComponents(finalNodes, finalEdges),
      edges: finalEdges
    };
  }
  return {
    nodes: dropUnlinkedComponents(relevantNodes, visibleEdges),
    edges: visibleEdges
  };
}
function attractorColorForId(id) {
  let hash = 2166136261;
  for (let index = 0;index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  const hue = unsigned % 360;
  const saturation = 55 + (unsigned >>> 9) % 31;
  const lightness = 42 + (unsigned >>> 16) % 31;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}
function mutedAttractorColor(color) {
  return `color-mix(in srgb, ${color} 58%, var(--surface))`;
}
function attractorColors(state) {
  const { attractors, forces } = effectiveState(state);
  const ids = [...new Set([...attractors.map((attractor) => attractor.id), ...forces.map((force) => force.attractorId)])].sort();
  return new Map(ids.map((id) => [id, attractorColorForId(id)]));
}

// src/matrix-visuals.ts
function decorateForceRow(row, kind, attractorId) {
  row.classList.add("force-attractor-tint");
  row.setAttribute("data-force-kind", kind);
  row.setAttribute("data-force-kind-glyph", kind);
  row.setAttribute("data-attractor-id", attractorId);
  row.setAttribute("data-force-attractor-tint", "true");
  row.style.setProperty("--force-attractor-color", attractorColorForId(attractorId));
  const label = row.querySelector(".force-accordion-toggle") ?? row.querySelector("th.sticky-col");
  if (label === null)
    return;
  label.setAttribute("data-force-kind-glyph", kind);
  let glyph = label.querySelector(".force-kind-glyph");
  if (glyph === null) {
    glyph = document.createElement("span");
    glyph.className = "force-kind-glyph";
    glyph.setAttribute("aria-hidden", "true");
    const detail = label.querySelector(".force-detail");
    label.insertBefore(glyph, detail);
  }
  glyph.className = `force-kind-glyph force-kind-${kind}`;
}
function decorateComponentHeader(header, status) {
  const shape = status === "actual" ? "circle" : status === "proposed" ? "square" : "other";
  header.setAttribute("data-status", status);
  header.setAttribute("data-component-status-shape", status);
  let glyph = header.querySelector(".component-status-glyph");
  if (glyph === null) {
    glyph = document.createElement("span");
    glyph.setAttribute("aria-hidden", "true");
    header.prepend(glyph);
  }
  glyph.className = `component-status-glyph status-shape-${shape}`;
}

// src/matrix-interactions.ts
function getEffectiveForceValues(state, forceKey) {
  const update = state.updatedForces[forceKey];
  const added = state.addedForces.find((f) => f.tempId === forceKey);
  const base = added ?? state.baseForces.find((f) => f.id === forceKey);
  return {
    description: update?.description ?? base?.description ?? "",
    attractorId: update?.attractorId ?? base?.attractorId ?? "",
    naiveChangeOrFeature: update?.naiveChangeOrFeature ?? base?.naiveChangeOrFeature ?? "",
    outcomes: update?.outcomes ?? base?.outcomes ?? "",
    shortname: update?.shortname ?? base?.shortname ?? ""
  };
}
function effectiveComponents(state, forceKey) {
  const added = state.addedForces.find((f) => f.tempId === forceKey);
  if (added !== undefined)
    return added.components;
  const base = state.baseForces.find((f) => f.id === forceKey);
  if (base === undefined)
    return [];
  return state.updatedForces[forceKey]?.components ?? base.components;
}
function getAttractorLabel(state, attractorId) {
  const attractor = [...state.baseAttractors, ...state.addedAttractors].find((a) => a.id === attractorId);
  return attractor ? `${attractor.id} · ${attractor.name}` : attractorId;
}
function createTextInput(name, value, multiline = false) {
  if (multiline) {
    const input2 = document.createElement("textarea");
    input2.name = name;
    input2.value = value;
    input2.rows = 3;
    input2.wrap = "soft";
    return input2;
  }
  const input = document.createElement("input");
  input.type = "text";
  input.name = name;
  input.value = value;
  return input;
}
function labeledField(labelText, field) {
  const label = document.createElement("label");
  label.className = "force-detail-field";
  label.textContent = labelText;
  label.appendChild(field);
  return label;
}
function createKindSelect(selected) {
  const select = document.createElement("select");
  for (const kind of ["stressor", "purpose"]) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    select.appendChild(option);
  }
  select.value = selected;
  return select;
}
function createAttractorSelect(state, selectedId) {
  const select = document.createElement("select");
  for (const option of attractorOptions(state)) {
    const optionEl = document.createElement("option");
    optionEl.value = option.id;
    optionEl.textContent = option.name;
    select.appendChild(optionEl);
  }
  select.value = selectedId;
  return select;
}
function createResidueCell(forceKey, componentName) {
  const td = document.createElement("td");
  td.setAttribute("data-residue-cell", "true");
  td.setAttribute("data-force-id", forceKey);
  td.setAttribute("data-component", componentName);
  td.setAttribute("data-coupled", "0");
  return td;
}
function mount(table, getState, setState, options) {
  function applyInvalidMarks() {
    const { invalidForceKeys } = computeInvalidMarks(getState());
    const rows = table.querySelectorAll("tr.force-row[data-force-id]");
    for (const row of Array.from(rows)) {
      const forceKey = row.getAttribute("data-force-id");
      if (forceKey === null)
        continue;
      const invalid = invalidForceKeys.has(forceKey);
      row.classList.toggle("row-invalid", invalid);
      row.querySelector("th.sticky-col[data-force-id]")?.classList.toggle("row-invalid", invalid);
    }
  }
  function appendEditButton(detail, forceKey) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Edit";
    button.addEventListener("click", () => enterEditMode(detail, forceKey));
    detail.appendChild(button);
  }
  function appendRemoveButton(detail, forceKey) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Remove";
    button.addEventListener("click", () => {
      const next = removeForce(getState(), forceKey);
      setState(next);
      const row = detail.closest("tr.force-row");
      if (row instanceof HTMLTableRowElement)
        row.hidden = true;
      applyInvalidMarks();
      options?.onChange?.();
    });
    detail.appendChild(button);
  }
  function renderReadOnly(detail, forceKey) {
    detail.innerHTML = "";
    const values = getEffectiveForceValues(getState(), forceKey);
    const dl = document.createElement("dl");
    const addPair = (term, value) => {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      dl.append(dt, dd);
    };
    addPair("id", forceKey);
    addPair("shortname", values.shortname);
    addPair("attractor", getAttractorLabel(getState(), values.attractorId));
    addPair("description", values.description);
    addPair("naive change", values.naiveChangeOrFeature);
    addPair("outcomes", values.outcomes);
    detail.appendChild(dl);
    appendEditButton(detail, forceKey);
  }
  function enterEditMode(detail, forceKey) {
    detail.innerHTML = "";
    const state = getState();
    const values = getEffectiveForceValues(state, forceKey);
    const shortnameInput = createTextInput("shortname", values.shortname);
    const descriptionInput = createTextInput("description", values.description, true);
    const naiveChangeInput = createTextInput("naiveChangeOrFeature", values.naiveChangeOrFeature, true);
    const outcomesInput = createTextInput("outcomes", values.outcomes, true);
    const attractorSelect = createAttractorSelect(state, values.attractorId);
    const okButton = document.createElement("button");
    okButton.type = "button";
    okButton.textContent = "OK";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    okButton.addEventListener("click", () => {
      let next = getState();
      const edited = [
        ["shortname", shortnameInput.value],
        ["description", descriptionInput.value],
        ["attractorId", attractorSelect.value],
        ["naiveChangeOrFeature", naiveChangeInput.value],
        ["outcomes", outcomesInput.value]
      ];
      for (const [field, value] of edited) {
        if (value !== values[field]) {
          next = updateForceField(next, forceKey, field, value);
        }
      }
      setState(next);
      const row = detail.closest("tr.force-row");
      if (row instanceof HTMLTableRowElement) {
        const kind = row.getAttribute("data-force-kind") === "purpose" ? "purpose" : "stressor";
        decorateForceRow(row, kind, getEffectiveForceValues(next, forceKey).attractorId);
      }
      renderReadOnly(detail, forceKey);
      applyInvalidMarks();
      options?.onChange?.();
    });
    cancelButton.addEventListener("click", () => {
      renderReadOnly(detail, forceKey);
    });
    const editor = document.createElement("div");
    editor.className = "force-detail-editor";
    const actions = document.createElement("div");
    actions.className = "force-detail-actions";
    actions.append(okButton, cancelButton);
    editor.append(labeledField("shortname", shortnameInput), labeledField("description", descriptionInput), labeledField("naive change", naiveChangeInput), labeledField("outcomes", outcomesInput), labeledField("attractor", attractorSelect), actions);
    appendRemoveButton(actions, forceKey);
    detail.appendChild(editor);
  }
  function wireLiveField(el, eventName, forceKey, field) {
    el.addEventListener(eventName, () => {
      const next = updateForceField(getState(), forceKey, field, el.value);
      setState(next);
      if (field === "attractorId") {
        const row = table.querySelector(`tr.force-row[data-force-id="${CSS.escape(forceKey)}"]`);
        if (row !== null) {
          const kind = row.getAttribute("data-force-kind") === "purpose" ? "purpose" : "stressor";
          decorateForceRow(row, kind, el.value);
        }
      }
      applyInvalidMarks();
      options?.onChange?.();
    });
  }
  function buildNewForceRow(tempId, kind) {
    const state = getState();
    const components = [...state.baseComponents, ...state.addedComponents];
    const values = getEffectiveForceValues(state, tempId);
    const tr = document.createElement("tr");
    tr.className = "force-row";
    tr.setAttribute("data-force-id", tempId);
    tr.setAttribute("data-force-kind", kind);
    tr.setAttribute("data-row-total", "0");
    const th = document.createElement("th");
    th.className = "sticky-col";
    th.setAttribute("data-force-id", tempId);
    const detail = document.createElement("div");
    detail.className = "force-detail";
    const kindSelect = createKindSelect(kind);
    const shortnameInput = createTextInput("shortname", values.shortname);
    const descriptionInput = createTextInput("description", values.description, true);
    const naiveChangeInput = createTextInput("naiveChangeOrFeature", values.naiveChangeOrFeature, true);
    const outcomesInput = createTextInput("outcomes", values.outcomes, true);
    const attractorSelect = createAttractorSelect(state, values.attractorId);
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Save";
    kindSelect.addEventListener("change", () => {
      const nextKind = kindSelect.value === "purpose" ? "purpose" : "stressor";
      setState(setAddedForceKind(getState(), tempId, nextKind));
      tr.setAttribute("data-force-kind", nextKind);
      decorateForceRow(tr, nextKind, getEffectiveForceValues(getState(), tempId).attractorId);
      applyInvalidMarks();
      options?.onChange?.();
    });
    wireLiveField(shortnameInput, "input", tempId, "shortname");
    wireLiveField(descriptionInput, "input", tempId, "description");
    wireLiveField(naiveChangeInput, "input", tempId, "naiveChangeOrFeature");
    wireLiveField(outcomesInput, "input", tempId, "outcomes");
    wireLiveField(attractorSelect, "change", tempId, "attractorId");
    saveButton.addEventListener("click", () => {
      renderReadOnly(detail, tempId);
      applyInvalidMarks();
      options?.onChange?.();
    });
    const editor = document.createElement("div");
    editor.className = "force-detail-editor";
    const actions = document.createElement("div");
    actions.className = "force-detail-actions";
    actions.append(saveButton);
    editor.append(labeledField("kind", kindSelect), labeledField("shortname", shortnameInput), labeledField("description", descriptionInput), labeledField("naive change", naiveChangeInput), labeledField("outcomes", outcomesInput), labeledField("attractor", attractorSelect), actions);
    appendRemoveButton(actions, tempId);
    detail.appendChild(editor);
    th.appendChild(detail);
    tr.appendChild(th);
    decorateForceRow(tr, kind, values.attractorId);
    for (const component of components) {
      tr.appendChild(createResidueCell(tempId, component.name));
    }
    const totalTd = document.createElement("td");
    totalTd.className = "sticky-col-right";
    totalTd.setAttribute("data-row-total", "0");
    totalTd.textContent = "0";
    tr.appendChild(totalTd);
    return tr;
  }
  function recomputeTotals(forceKey, component) {
    const row = table.querySelector(`tr.force-row[data-force-id="${CSS.escape(forceKey)}"]`);
    if (row !== null) {
      const rowTotal = row.querySelectorAll('td[data-residue-cell][data-coupled="1"]').length;
      row.setAttribute("data-row-total", String(rowTotal));
      const rowTotalCell = row.querySelector(".sticky-col-right[data-row-total]");
      if (rowTotalCell !== null) {
        rowTotalCell.setAttribute("data-row-total", String(rowTotal));
        rowTotalCell.textContent = String(rowTotal);
      }
    }
    const colTotalCell = table.querySelector(`tfoot td[data-col-total][data-component="${CSS.escape(component)}"]`);
    if (colTotalCell !== null) {
      const colTotal = table.querySelectorAll(`tbody td[data-residue-cell][data-component="${CSS.escape(component)}"][data-coupled="1"]`).length;
      colTotalCell.setAttribute("data-col-total", String(colTotal));
      colTotalCell.textContent = String(colTotal);
    }
    const grandTotalCell = table.querySelector("tfoot [data-grand-total]");
    if (grandTotalCell !== null) {
      const grandTotal = table.querySelectorAll('tbody td[data-residue-cell][data-coupled="1"]').length;
      grandTotalCell.setAttribute("data-grand-total", String(grandTotal));
      grandTotalCell.textContent = String(grandTotal);
    }
  }
  function closeContextMenu() {
    for (const el of Array.from(document.querySelectorAll('[role="menu"]'))) {
      el.remove();
    }
  }
  function handleAddRow(anchorRow, action) {
    const kind = anchorRow.getAttribute("data-force-kind") === "purpose" ? "purpose" : "stressor";
    const { state: nextState, tempId } = addForceRow(getState(), kind);
    setState(nextState);
    const newRow = buildNewForceRow(tempId, kind);
    const parent = anchorRow.parentElement;
    if (parent !== null) {
      parent.insertBefore(newRow, action === "add-above" ? anchorRow : anchorRow.nextSibling);
    }
    applyInvalidMarks();
    options?.onChange?.();
  }
  function openContextMenu(event, anchorRow) {
    closeContextMenu();
    const menu = document.createElement("ul");
    menu.setAttribute("role", "menu");
    menu.style.position = "absolute";
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    const entries = [
      { action: "add-above", label: "Add row above" },
      { action: "add-below", label: "Add row below" }
    ];
    for (const { action, label } of entries) {
      const item = document.createElement("li");
      item.setAttribute("role", "menuitem");
      item.setAttribute("data-action", action);
      item.textContent = label;
      item.addEventListener("click", () => {
        handleAddRow(anchorRow, action);
        closeContextMenu();
      });
      menu.appendChild(item);
    }
    document.body.appendChild(menu);
  }
  table.addEventListener("dblclick", (event) => {
    const target = event.target;
    if (!(target instanceof Element))
      return;
    const cell = target.closest("td[data-residue-cell]");
    if (!(cell instanceof HTMLTableCellElement))
      return;
    const forceKey = cell.getAttribute("data-force-id");
    const component = cell.getAttribute("data-component");
    if (forceKey === null || component === null)
      return;
    const next = toggleComponent(getState(), forceKey, component);
    setState(next);
    const coupled = effectiveComponents(next, forceKey).includes(component);
    cell.setAttribute("data-coupled", coupled ? "1" : "0");
    cell.textContent = coupled ? "1" : "";
    recomputeTotals(forceKey, component);
    applyInvalidMarks();
    options?.onChange?.();
  });
  table.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (!(target instanceof Element))
      return;
    const row = target.closest("tr.force-row");
    if (!(row instanceof HTMLTableRowElement))
      return;
    event.preventDefault();
    openContextMenu(event, row);
  });
  for (const detail of Array.from(table.querySelectorAll(".force-detail"))) {
    if (detail.querySelector("dl") === null)
      continue;
    const forceKey = detail.closest("th[data-force-id]")?.getAttribute("data-force-id");
    if (forceKey === null || forceKey === undefined)
      continue;
    appendEditButton(detail, forceKey);
  }
  function syncNewRows() {
    const tbody = table.querySelector("tbody");
    if (tbody === null)
      return;
    for (const force of getState().addedForces) {
      const selector = `tr.force-row[data-force-id="${CSS.escape(force.tempId)}"]`;
      if (table.querySelector(selector) !== null)
        continue;
      tbody.appendChild(buildNewForceRow(force.tempId, force.kind));
    }
    applyInvalidMarks();
  }
  function resetDom() {
    const state = getState();
    const baseIds = new Set(state.baseForces.map((force) => force.id));
    for (const row of Array.from(table.querySelectorAll("tbody tr.force-row"))) {
      const key = row.getAttribute("data-force-id");
      if (key === null)
        continue;
      if (!baseIds.has(key)) {
        row.remove();
        continue;
      }
      row.hidden = false;
      const base = state.baseForces.find((force) => force.id === key);
      if (base !== undefined) {
        for (const cell of Array.from(row.querySelectorAll("td[data-residue-cell]"))) {
          const component = cell.getAttribute("data-component");
          const coupled = component !== null && base.components.includes(component);
          cell.setAttribute("data-coupled", coupled ? "1" : "0");
          cell.textContent = coupled ? "1" : "";
        }
      }
      const detail = row.querySelector(".force-detail");
      if (detail !== null) {
        detail.hidden = true;
        renderReadOnly(detail, key);
      }
    }
    const baseComponents = new Set(state.baseComponents.map((component) => component.name));
    for (const element of Array.from(table.querySelectorAll("[data-component]"))) {
      const name = element.getAttribute("data-component");
      if (name !== null && !baseComponents.has(name))
        element.remove();
    }
    applyInvalidMarks();
  }
  applyInvalidMarks();
  return { syncNewRows, resetDom };
}

// src/forms.ts
function regenerateStagedCommands(container, getState) {
  const textarea = container.querySelector("#staged-commands");
  if (!(textarea instanceof HTMLTextAreaElement))
    return;
  const lines = toCommandLines(getState()).map((cl) => cl.valid ? cl.line : `# ${cl.line}`);
  textarea.value = lines.join(`
`);
}
function emptyPendingState(base) {
  return {
    baseAttractors: base.baseAttractors,
    baseComponents: base.baseComponents,
    baseForces: base.baseForces,
    basePersonas: base.basePersonas,
    baseTerms: base.baseTerms,
    addedAttractors: [],
    addedComponents: [],
    addedForces: [],
    addedPersonas: [],
    addedTerms: [],
    updatedAttractors: {},
    updatedComponents: {},
    updatedForces: {},
    updatedPersonas: {},
    updatedTerms: {},
    removedForces: {}
  };
}
function readInput(form, name) {
  const input = form.querySelector(`[name="${name}"]`);
  return input?.value ?? "";
}
function mountForms(container, getState, setState, options) {
  function regenerate() {
    regenerateStagedCommands(container, getState);
  }
  function wireForceForm(kind) {
    const form = container.querySelector(`form[data-command-generator="${kind}"]`);
    if (form === null)
      return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const { state: withRow, tempId } = addForceRow(getState(), kind);
      let next = withRow;
      const fieldMap = [
        ["description", "description"],
        ["attractor_shortname", "attractorId"],
        ["naive_change", "naiveChangeOrFeature"],
        ["shortname", "shortname"],
        ["outcomes", "outcomes"]
      ];
      for (const [formName, field] of fieldMap) {
        const value = readInput(form, formName);
        if (value !== "") {
          next = updateForceField(next, tempId, field, value);
        }
      }
      setState(next);
      form.reset();
      regenerate();
      options?.onChange?.();
    });
  }
  function maxExistingAttractorSuffix(state) {
    let max = 0;
    for (const a of state.addedAttractors) {
      const match = /^NEW-ATTR-(\d+)$/.exec(a.id);
      if (match) {
        const n = Number(match[1]);
        if (n > max)
          max = n;
      }
    }
    return max;
  }
  function wireAttractorForm() {
    const form = container.querySelector('form[data-command-generator="attractor"]');
    if (form === null)
      return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const state = getState();
      const id = `NEW-ATTR-${maxExistingAttractorSuffix(state) + 1}`;
      const next = addAttractorOption(state, {
        id,
        name: readInput(form, "name"),
        description: readInput(form, "description"),
        positiveState: readInput(form, "positive_state"),
        negativeState: readInput(form, "negative_state")
      });
      setState(next);
      form.reset();
      regenerate();
      options?.onChange?.();
    });
  }
  function setComponentFormError(form, message) {
    const errorEl = container.querySelector("[data-component-form-error]");
    if (errorEl)
      errorEl.textContent = message;
    form.querySelector('[name="name"]')?.setAttribute("aria-invalid", "true");
  }
  function clearComponentFormError(form) {
    const errorEl = container.querySelector("[data-component-form-error]");
    if (errorEl)
      errorEl.textContent = "";
    form.querySelector('[name="name"]')?.removeAttribute("aria-invalid");
  }
  function insertComponentColumn(name, status) {
    const table = container.querySelector("table.matrix");
    if (table === null)
      return;
    const headerRow = table.querySelector("thead tr");
    if (headerRow !== null) {
      const th = document.createElement("th");
      th.className = "sticky-row";
      th.setAttribute("data-component", name);
      th.textContent = name;
      decorateComponentHeader(th, status);
      const cornerRight = headerRow.querySelector("th.sticky-col-right");
      if (cornerRight !== null) {
        headerRow.insertBefore(th, cornerRight);
      } else {
        headerRow.appendChild(th);
      }
    }
    for (const row of Array.from(table.querySelectorAll("tbody tr.force-row"))) {
      const forceId = row.getAttribute("data-force-id") ?? "";
      const td = document.createElement("td");
      td.setAttribute("data-residue-cell", "true");
      td.setAttribute("data-force-id", forceId);
      td.setAttribute("data-component", name);
      td.setAttribute("data-coupled", "0");
      const cornerRight = row.querySelector("td.sticky-col-right");
      if (cornerRight !== null) {
        row.insertBefore(td, cornerRight);
      } else {
        row.appendChild(td);
      }
    }
    const footerRow = table.querySelector("tfoot tr");
    if (footerRow !== null) {
      const td = document.createElement("td");
      td.setAttribute("data-col-total", "0");
      td.setAttribute("data-component", name);
      td.textContent = "0";
      const cornerRight = footerRow.querySelector("td.sticky-col-right");
      if (cornerRight !== null) {
        footerRow.insertBefore(td, cornerRight);
      } else {
        footerRow.appendChild(td);
      }
    }
  }
  function wireComponentForm() {
    const form = container.querySelector('form[data-command-generator="component"]');
    if (form === null)
      return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = readInput(form, "name");
      try {
        const next = addComponentColumn(getState(), {
          name,
          description: readInput(form, "description"),
          status: readInput(form, "status") === "proposed" ? "proposed" : "actual",
          architectureSet: readInput(form, "architecture_set")
        });
        setState(next);
        insertComponentColumn(name, readInput(form, "status") === "proposed" ? "proposed" : "actual");
        clearComponentFormError(form);
        form.reset();
        regenerate();
        options?.onChange?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setComponentFormError(form, message);
      }
    });
  }
  function applyVisibility() {
    const table = container.querySelector("table.matrix");
    if (table === null)
      return;
    const proposedToggle = container.querySelector("[data-show-proposed-toggle]");
    const unrelatedToggle = container.querySelector("[data-show-unrelated-toggle]");
    const showProposed = proposedToggle?.checked ?? true;
    const showUnrelated = unrelatedToggle?.checked ?? true;
    const filteredForceIds = Array.from(table.querySelectorAll("tbody tr.force-row")).filter((row) => !row.hidden).map((row) => row.getAttribute("data-force-id")).filter((id) => id !== null);
    const visible = new Set(visibleComponents(getState(), {
      showProposed,
      showUnrelated,
      filteredForceIds
    }));
    for (const el of Array.from(table.querySelectorAll("[data-component]"))) {
      const name = el.getAttribute("data-component");
      if (name === null)
        continue;
      const shouldHide = !visible.has(name);
      if (shouldHide) {
        el.setAttribute("hidden", "");
      } else {
        el.removeAttribute("hidden");
      }
    }
  }
  function wireVisibilityToggles() {
    const proposedToggle = container.querySelector("[data-show-proposed-toggle]");
    const unrelatedToggle = container.querySelector("[data-show-unrelated-toggle]");
    proposedToggle?.addEventListener("change", applyVisibility);
    unrelatedToggle?.addEventListener("change", applyVisibility);
    container.querySelector("[data-force-filter]")?.addEventListener("input", applyVisibility);
  }
  function wireClearButton() {
    const clearButton = container.querySelector("#clear-staged");
    clearButton?.addEventListener("click", () => {
      setState(emptyPendingState(getState()));
      regenerate();
      options?.onClear?.();
      options?.onChange?.();
    });
  }
  function wireCopyButton() {
    const copyButton = container.querySelector("#copy-staged");
    copyButton?.addEventListener("click", () => {
      const textarea = container.querySelector("#staged-commands");
      const value = textarea instanceof HTMLTextAreaElement ? textarea.value : "";
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (clipboard?.writeText) {
        clipboard.writeText(value);
      }
    });
  }
  wireForceForm("stressor");
  wireForceForm("purpose");
  wireAttractorForm();
  wireComponentForm();
  wireVisibilityToggles();
  wireClearButton();
  wireCopyButton();
  regenerate();
}

// src/import-merge.ts
var FORCE_FIELD_MAP = {
  description: "description",
  "attractor-shortname": "attractorId",
  "naive-change": "naiveChangeOrFeature",
  outcomes: "outcomes",
  shortname: "shortname"
};
function nextAttractorId(state) {
  let max = 0;
  for (const a of state.addedAttractors) {
    const match = /^NEW-ATTR-(\d+)$/.exec(a.id);
    if (match) {
      const n = Number(match[1]);
      if (n > max)
        max = n;
    }
  }
  return `NEW-ATTR-${max + 1}`;
}
function currentComponentsFor(state, forceKey) {
  const added = state.addedForces.find((f) => f.tempId === forceKey);
  if (added !== undefined)
    return added.components;
  const base = state.baseForces.find((f) => f.id === forceKey);
  if (base === undefined)
    return [];
  const update = state.updatedForces[forceKey];
  return update?.components ?? base.components;
}
function applyComponentToggles(state, forceKey, item) {
  let next = state;
  for (const name of item.multipleFields["add-component"] ?? []) {
    if (!currentComponentsFor(next, forceKey).includes(name)) {
      next = toggleComponent(next, forceKey, name);
    }
  }
  for (const name of item.multipleFields["remove-component"] ?? []) {
    if (currentComponentsFor(next, forceKey).includes(name)) {
      next = toggleComponent(next, forceKey, name);
    }
  }
  return next;
}
function applyAddForce(state, kind, item) {
  const { state: withRow, tempId } = addForceRow(state, kind);
  let next = withRow;
  for (const [flagName, rawValue] of Object.entries(item.fields)) {
    const field = FORCE_FIELD_MAP[flagName];
    if (field === undefined)
      continue;
    const value = flagName === "attractor-shortname" ? [...next.baseAttractors, ...next.addedAttractors].find((attractor) => attractor.name === rawValue)?.id ?? rawValue : rawValue;
    next = updateForceField(next, tempId, field, value);
  }
  next = applyComponentToggles(next, tempId, item);
  return next;
}
function applyAddComponent(state, item) {
  return addComponentColumn(state, {
    name: item.fields.name ?? "",
    description: item.fields.description ?? "",
    status: item.fields.status ?? "proposed",
    architectureSet: item.fields["architecture-set"] ?? ""
  });
}
function applyAddAttractor(state, item) {
  const id = nextAttractorId(state);
  return addAttractorOption(state, {
    id,
    name: item.fields.name ?? "",
    description: item.fields.description ?? "",
    positiveState: item.fields["positive-state"] ?? "",
    negativeState: item.fields["negative-state"] ?? ""
  });
}
function applyUpdateForce(state, item) {
  const forceKey = item.fields["force-id"];
  if (forceKey === undefined)
    return state;
  let next = state;
  for (const [flagName, rawValue] of Object.entries(item.fields)) {
    if (flagName === "force-id")
      continue;
    const field = FORCE_FIELD_MAP[flagName];
    if (field === undefined)
      continue;
    const value = flagName === "attractor-shortname" ? [...next.baseAttractors, ...next.addedAttractors].find((attractor) => attractor.name === rawValue)?.id ?? rawValue : rawValue;
    next = updateForceField(next, forceKey, field, value);
  }
  next = applyComponentToggles(next, forceKey, item);
  return next;
}
function applyRemoveForce(state, item) {
  const shortname = item.fields.shortname;
  if (shortname === undefined)
    return state;
  const force = state.baseForces.find((candidate) => candidate.kind === item.type && candidate.shortname === shortname);
  return force === undefined ? state : removeForce(state, force.id);
}
function isMergeable(item) {
  if (item.kind === "add") {
    return item.type === "stressor" || item.type === "purpose" || item.type === "component" || item.type === "attractor";
  }
  return item.type === "stressor" || item.type === "purpose";
}
function applyItem(state, item) {
  if (item.kind === "add") {
    if (item.type === "stressor" || item.type === "purpose")
      return applyAddForce(state, item.type, item);
    if (item.type === "component")
      return applyAddComponent(state, item);
    if (item.type === "attractor")
      return applyAddAttractor(state, item);
  }
  if (item.kind === "remove" && (item.type === "stressor" || item.type === "purpose")) {
    return applyRemoveForce(state, item);
  }
  return applyUpdateForce(state, item);
}
function mergeImportedItems(state, items) {
  let next = state;
  const unmergeable = [];
  for (const item of items) {
    if (!isMergeable(item)) {
      unmergeable.push(item);
      continue;
    }
    next = applyItem(next, item);
  }
  return { state: next, unmergeable };
}

// generated/cli-schema.json
var cli_schema_default = [
  {
    subcommand: "add attractor",
    flags: [
      {
        name: "description",
        required: true,
        multiple: false
      },
      {
        name: "name",
        required: true,
        multiple: false
      },
      {
        name: "negative-state",
        required: true,
        multiple: false
      },
      {
        name: "positive-state",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add component",
    flags: [
      {
        name: "architecture-set",
        required: true,
        multiple: false
      },
      {
        name: "description",
        required: true,
        multiple: false
      },
      {
        name: "name",
        required: true,
        multiple: false
      },
      {
        name: "status",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add defense-persona",
    flags: [
      {
        name: "body",
        required: true,
        multiple: false
      },
      {
        name: "name",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add defense-pitch",
    flags: [
      {
        name: "body",
        required: true,
        multiple: false
      },
      {
        name: "name",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add defense-progress",
    flags: [
      {
        name: "body",
        required: true,
        multiple: false
      },
      {
        name: "name",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add defense-strategy",
    flags: [
      {
        name: "body",
        required: true,
        multiple: false
      },
      {
        name: "name",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add iteration",
    flags: [
      {
        name: "notes",
        required: false,
        multiple: false
      },
      {
        name: "ri-score",
        required: false,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add meta-attractor",
    flags: [
      {
        name: "description",
        required: true,
        multiple: false
      },
      {
        name: "name",
        required: true,
        multiple: false
      },
      {
        name: "negative-state",
        required: true,
        multiple: false
      },
      {
        name: "positive-state",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add meta-purpose",
    flags: [
      {
        name: "attractor-id",
        required: true,
        multiple: false
      },
      {
        name: "description",
        required: true,
        multiple: false
      },
      {
        name: "naive-change",
        required: true,
        multiple: false
      },
      {
        name: "outcomes",
        required: false,
        multiple: false
      },
      {
        name: "shortname",
        required: false,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add meta-stressor",
    flags: [
      {
        name: "description",
        required: true,
        multiple: false
      },
      {
        name: "shortname",
        required: false,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add persona",
    flags: [
      {
        name: "concerns",
        required: false,
        multiple: false
      },
      {
        name: "desires",
        required: false,
        multiple: false
      },
      {
        name: "name",
        required: true,
        multiple: false
      },
      {
        name: "role",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add purpose",
    flags: [
      {
        name: "attractor-shortname",
        required: true,
        multiple: false
      },
      {
        name: "description",
        required: true,
        multiple: false
      },
      {
        name: "naive-change",
        required: true,
        multiple: false
      },
      {
        name: "outcomes",
        required: false,
        multiple: false
      },
      {
        name: "shortname",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add residue",
    flags: [
      {
        name: "component-shortname",
        required: false,
        multiple: false
      },
      {
        name: "move-to",
        required: false,
        multiple: false
      },
      {
        name: "notes",
        required: false,
        multiple: false
      },
      {
        name: "shortname",
        required: true,
        multiple: false
      },
      {
        name: "whole-system",
        required: false,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add stressor",
    flags: [
      {
        name: "attractor-shortname",
        required: true,
        multiple: false
      },
      {
        name: "description",
        required: true,
        multiple: false
      },
      {
        name: "naive-change",
        required: true,
        multiple: false
      },
      {
        name: "notes",
        required: false,
        multiple: false
      },
      {
        name: "outcomes",
        required: false,
        multiple: false
      },
      {
        name: "shortname",
        required: true,
        multiple: false
      },
      {
        name: "whole-system",
        required: false,
        multiple: false
      }
    ]
  },
  {
    subcommand: "add term",
    flags: [
      {
        name: "definition",
        required: true,
        multiple: false
      },
      {
        name: "domain",
        required: false,
        multiple: false
      },
      {
        name: "related",
        required: false,
        multiple: false
      },
      {
        name: "term",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "remove purpose",
    flags: [
      {
        name: "shortname",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "remove residue",
    flags: [
      {
        name: "component-shortname",
        required: true,
        multiple: false
      },
      {
        name: "shortname",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "remove stressor",
    flags: [
      {
        name: "shortname",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "remove term",
    flags: [
      {
        name: "term",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "update attractor",
    flags: [
      {
        name: "description",
        required: false,
        multiple: false
      },
      {
        name: "id",
        required: true,
        multiple: false
      },
      {
        name: "name",
        required: false,
        multiple: false
      },
      {
        name: "negative-state",
        required: false,
        multiple: false
      },
      {
        name: "positive-state",
        required: false,
        multiple: false
      }
    ]
  },
  {
    subcommand: "update component",
    flags: [
      {
        name: "architecture-set",
        required: false,
        multiple: false
      },
      {
        name: "description",
        required: false,
        multiple: false
      },
      {
        name: "name",
        required: true,
        multiple: false
      },
      {
        name: "status",
        required: false,
        multiple: false
      }
    ]
  },
  {
    subcommand: "update persona",
    flags: [
      {
        name: "concerns",
        required: false,
        multiple: false
      },
      {
        name: "desires",
        required: false,
        multiple: false
      },
      {
        name: "name",
        required: true,
        multiple: false
      },
      {
        name: "role",
        required: false,
        multiple: false
      }
    ]
  },
  {
    subcommand: "update purpose",
    flags: [
      {
        name: "add-component",
        required: false,
        multiple: true
      },
      {
        name: "attractor-shortname",
        required: false,
        multiple: false
      },
      {
        name: "description",
        required: false,
        multiple: false
      },
      {
        name: "naive-change",
        required: false,
        multiple: false
      },
      {
        name: "outcomes",
        required: false,
        multiple: false
      },
      {
        name: "remove-component",
        required: false,
        multiple: true
      },
      {
        name: "rename",
        required: false,
        multiple: false
      },
      {
        name: "shortname",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "update stressor",
    flags: [
      {
        name: "add-component",
        required: false,
        multiple: true
      },
      {
        name: "attractor-shortname",
        required: false,
        multiple: false
      },
      {
        name: "description",
        required: false,
        multiple: false
      },
      {
        name: "naive-change",
        required: false,
        multiple: false
      },
      {
        name: "outcomes",
        required: false,
        multiple: false
      },
      {
        name: "remove-component",
        required: false,
        multiple: true
      },
      {
        name: "rename",
        required: false,
        multiple: false
      },
      {
        name: "shortname",
        required: true,
        multiple: false
      }
    ]
  },
  {
    subcommand: "update term",
    flags: [
      {
        name: "definition",
        required: false,
        multiple: false
      },
      {
        name: "domain",
        required: false,
        multiple: false
      },
      {
        name: "related",
        required: false,
        multiple: false
      },
      {
        name: "term",
        required: true,
        multiple: false
      }
    ]
  }
];

// src/import-parser.ts
var schema = cli_schema_default;
var knownFlagsBySubcommand = new Map(schema.map((entry) => [
  entry.subcommand,
  entry.flags.map((flag) => ({
    name: flag.name,
    required: flag.required,
    multiple: flag.multiple
  }))
]));
function getKnownFlags(subcommand) {
  return knownFlagsBySubcommand.get(subcommand);
}
function tokenizeCommandLine(line) {
  const tokens = [];
  let current = "";
  let inQuotes = false;
  let hasToken = false;
  for (let i = 0;i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === "\\" && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      hasToken = true;
      continue;
    }
    if (char === " " || char === "\t") {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (hasToken) {
    tokens.push(current);
  }
  return tokens;
}
function parseImportText(text) {
  const items = [];
  const errors = [];
  for (const line of text.split(`
`)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const result = parseLine(trimmed);
    if ("item" in result) {
      items.push(result.item);
    } else {
      errors.push({ line: trimmed, message: result.message });
    }
  }
  return { items, errors };
}
function parseLine(line) {
  const tokens = tokenizeCommandLine(line);
  if (tokens[0] !== "residual") {
    return { message: "not a residual add/update command" };
  }
  const typeFirst = tokens[1] === "stressor" || tokens[1] === "purpose";
  const verb = typeFirst ? tokens[2] : tokens[1];
  if (verb !== "add" && verb !== "update" && verb !== "remove") {
    return { message: "not a residual add/update command" };
  }
  const type = typeFirst ? tokens[1] : tokens[2];
  if (type === undefined) {
    return { message: "not a residual add/update command" };
  }
  const subcommand = `${verb} ${type}`;
  const knownFlags = getKnownFlags(subcommand);
  if (knownFlags === undefined) {
    return { message: `unrecognized subcommand "${subcommand}"` };
  }
  const knownFlagsByName = new Map(knownFlags.map((f) => [f.name, f]));
  const fields = {};
  const multipleFields = {};
  let i = typeFirst ? 3 : 3;
  while (i < tokens.length) {
    const flagToken = tokens[i];
    if (!flagToken.startsWith("--")) {
      return { message: `unexpected token "${flagToken}"` };
    }
    const flagName = flagToken.slice(2);
    const known = knownFlagsByName.get(flagName);
    if (known === undefined) {
      return { message: `unrecognized flag "--${flagName}"` };
    }
    const value = tokens[i + 1];
    if (value === undefined) {
      return { message: `missing value for flag "--${flagName}"` };
    }
    if (known.multiple) {
      const existing = multipleFields[flagName];
      if (existing) {
        existing.push(value);
      } else {
        multipleFields[flagName] = [value];
      }
    } else {
      fields[flagName] = value;
    }
    i += 2;
  }
  const missing = knownFlags.filter((flag) => {
    if (!flag.required)
      return false;
    if (flag.multiple) {
      return (multipleFields[flag.name]?.length ?? 0) === 0;
    }
    return fields[flag.name] === undefined;
  });
  if (missing.length > 0) {
    const names = missing.map((f) => `--${f.name}`).join(", ");
    return { message: `missing required flag(s): ${names}` };
  }
  return {
    item: {
      kind: verb,
      type,
      fields,
      multipleFields,
      raw: line
    }
  };
}

// src/import-modal.ts
function requireElement(container, selector) {
  const el = container.querySelector(selector);
  if (el === null)
    throw new Error(`mountImportModal: missing required element ${selector}`);
  return el;
}
function mountImportModal(container, getState, setState, options) {
  const trigger = requireElement(container, "[data-import-trigger]");
  const modal = requireElement(container, "[data-import-modal]");
  const primary = requireElement(container, "[data-import-primary]");
  const errorsBox = requireElement(container, "[data-import-errors]");
  const errorList = requireElement(container, "[data-import-error-list]");
  const runButton = requireElement(container, "[data-import-run]");
  const retryButton = requireElement(container, "[data-import-retry]");
  const renderErrors = (entries) => {
    errorsBox.value = entries.map((e) => e.line).join(`
`);
    while (errorList.firstChild)
      errorList.removeChild(errorList.firstChild);
    for (const entry of entries) {
      const li = document.createElement("li");
      li.textContent = `${entry.line}: ${entry.message}`;
      errorList.appendChild(li);
    }
  };
  const processImportText = (text) => {
    const parsed = parseImportText(text);
    const mergeResult = mergeImportedItems(getState(), parsed.items);
    setState(mergeResult.state);
    const entries = [
      ...parsed.errors.map((e) => ({ line: e.line, message: e.message })),
      ...mergeResult.unmergeable.map((item) => ({
        line: item.raw,
        message: `no support yet for "${item.kind} ${item.type}" updates`
      }))
    ];
    return entries;
  };
  trigger.addEventListener("click", () => {
    modal.removeAttribute("hidden");
  });
  runButton.addEventListener("click", () => {
    const entries = processImportText(primary.value);
    renderErrors(entries);
    primary.value = "";
    options?.onChange?.();
  });
  retryButton.addEventListener("click", () => {
    const combined = `${primary.value}
${errorsBox.value}`;
    const entries = processImportText(combined);
    renderErrors(entries);
    primary.value = "";
    options?.onChange?.();
  });
}

// src/export-script.ts
var EXPORT_SCRIPT_FILENAME = "residual-import.sh";
function buildBashScript(state) {
  const commandLines = toCommandLines(state).map((cl) => cl.valid ? cl.line : `# ${cl.line}`);
  const commandSection = commandLines.length > 0 ? `${commandLines.join(`
`)}
` : "";
  return `#!/bin/env bash

residual write authorize

${commandSection}`;
}
function defaultTriggerDownload(filename, content) {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function")
    return;
  const blob = new Blob([content], { type: "application/x-sh" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
function mountExportScript(container, getState, options) {
  const button = container.querySelector("[data-generate-script]");
  if (!button)
    return;
  const triggerDownload = options?.triggerDownload ?? defaultTriggerDownload;
  button.addEventListener("click", () => {
    const script = buildBashScript(getState());
    triggerDownload(EXPORT_SCRIPT_FILENAME, script);
    options?.onChange?.();
  });
}

// src/matrix-view.ts
function sortMatrixBy(container, key, dir) {
  const table = container.querySelector("table.matrix");
  const tbody = table?.querySelector("tbody");
  if (!tbody)
    return;
  const rows = Array.from(tbody.querySelectorAll("tr.force-row"));
  const mult = dir === "desc" ? -1 : 1;
  rows.sort((ra, rb) => {
    if (key === "force") {
      return (ra.getAttribute("data-force-id") ?? "").localeCompare(rb.getAttribute("data-force-id") ?? "") * mult;
    }
    if (key === "total") {
      return (Number(ra.getAttribute("data-row-total") ?? 0) - Number(rb.getAttribute("data-row-total") ?? 0)) * mult;
    }
    if (key.indexOf("component:") === 0) {
      const comp = key.slice("component:".length);
      const ca = ra.querySelector(`td[data-component="${CSS.escape(comp)}"]`);
      const cb = rb.querySelector(`td[data-component="${CSS.escape(comp)}"]`);
      const va = ca?.getAttribute("data-coupled") === "1" ? 1 : 0;
      const vb = cb?.getAttribute("data-coupled") === "1" ? 1 : 0;
      return (va - vb) * mult;
    }
    return 0;
  });
  for (const row of rows)
    tbody.appendChild(row);
}
function computeMatrixCandidates(container) {
  const table = container.querySelector("table.matrix");
  const fusion = new Set;
  const fission = new Set;
  if (!table)
    return { fusion, fission };
  const componentNames = Array.from(table.querySelectorAll("thead th[data-component]")).map((th) => th.getAttribute("data-component") ?? "");
  const vectors = {};
  for (const name of componentNames)
    vectors[name] = {};
  for (const td of Array.from(table.querySelectorAll("tbody td[data-residue-cell]"))) {
    const comp = td.getAttribute("data-component") ?? "";
    const force = td.getAttribute("data-force-id") ?? "";
    if (vectors[comp])
      vectors[comp][force] = td.getAttribute("data-coupled") === "1";
  }
  for (let i = 0;i < componentNames.length; i++) {
    for (let j = i + 1;j < componentNames.length; j++) {
      const a = vectors[componentNames[i]];
      const b = vectors[componentNames[j]];
      const forceIds = Object.keys(a);
      const identical = forceIds.length > 0 && forceIds.every((fid) => a[fid] === b[fid]);
      if (identical) {
        fusion.add(componentNames[i]);
        fusion.add(componentNames[j]);
      }
    }
  }
  const thresholdInput = container.querySelector("[data-threshold-input]");
  const threshold = thresholdInput instanceof HTMLInputElement ? Number(thresholdInput.value) : 1;
  for (const td of Array.from(table.querySelectorAll("tfoot td[data-col-total]"))) {
    const total = Number(td.getAttribute("data-col-total"));
    if (total > threshold)
      fission.add(td.getAttribute("data-component") ?? "");
  }
  return { fusion, fission };
}
function applyFusionFissionHighlighting(container) {
  const table = container.querySelector("table.matrix");
  if (!table)
    return;
  const { fusion, fission } = computeMatrixCandidates(container);
  const componentNames = Array.from(table.querySelectorAll("thead th[data-component]")).map((th) => th.getAttribute("data-component") ?? "");
  const onlyToggle = container.querySelector("[data-fusion-fission-filter]");
  const only = onlyToggle instanceof HTMLInputElement && onlyToggle.checked;
  for (const name of componentNames) {
    const isFusion = fusion.has(name);
    const isFission = fission.has(name);
    const show = !only || isFusion || isFission;
    for (const el of Array.from(container.querySelectorAll(`[data-component="${CSS.escape(name)}"]`))) {
      el.setAttribute("data-fusion", isFusion ? "1" : "0");
      el.setAttribute("data-fission", isFission ? "1" : "0");
      if (el instanceof HTMLElement)
        el.hidden = !show;
    }
  }
}
function mountMatrixView(container, _options) {
  container.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof Element))
      return;
    const filterInput = target.closest("[data-force-filter]");
    if (filterInput instanceof HTMLInputElement) {
      const q = filterInput.value.trim().toLowerCase();
      for (const row of Array.from(container.querySelectorAll("table.matrix tbody tr.force-row"))) {
        const hay = (row.getAttribute("data-search") || row.textContent || "").toLowerCase();
        row.hidden = q !== "" && hay.indexOf(q) === -1;
      }
      return;
    }
    const thresholdInput2 = target.closest("[data-threshold-input]");
    if (thresholdInput2 instanceof HTMLInputElement) {
      const thresholdValue2 = container.querySelector("[data-threshold-value]");
      if (thresholdValue2)
        thresholdValue2.textContent = thresholdInput2.value;
      applyFusionFissionHighlighting(container);
    }
  });
  container.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element))
      return;
    const toggle = target.closest("[data-accordion-toggle]");
    if (toggle instanceof HTMLElement) {
      const detail = toggle.nextElementSibling;
      if (!(detail instanceof HTMLElement))
        return;
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      detail.hidden = expanded;
      return;
    }
    const th = target.closest("table.matrix thead th[data-sort-key]");
    if (th instanceof HTMLElement) {
      activateSort(container, th);
    }
  });
  container.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent))
      return;
    if (event.key !== "Enter" && event.key !== " ")
      return;
    const target = event.target;
    if (!(target instanceof Element))
      return;
    const th = target.closest("table.matrix thead th[data-sort-key]");
    if (th instanceof HTMLElement) {
      event.preventDefault();
      activateSort(container, th);
    }
  });
  container.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof Element))
      return;
    const filterToggle = target.closest("[data-fusion-fission-filter]");
    if (filterToggle instanceof HTMLInputElement) {
      applyFusionFissionHighlighting(container);
    }
  });
  const thresholdInput = container.querySelector("[data-threshold-input]");
  const thresholdValue = container.querySelector("[data-threshold-value]");
  const numForces = container.querySelectorAll("table.matrix tbody tr.force-row").length;
  if (thresholdInput instanceof HTMLInputElement) {
    const max = Math.max(1, numForces);
    const value = Math.max(1, Math.floor(numForces / 2));
    thresholdInput.min = "1";
    thresholdInput.max = String(max);
    thresholdInput.value = String(value);
    if (thresholdValue)
      thresholdValue.textContent = String(value);
  }
  return {
    recomputeFusionFission: () => applyFusionFissionHighlighting(container)
  };
}
function activateSort(container, th) {
  const key = th.getAttribute("data-sort-key");
  if (!key)
    return;
  const current = th.classList.contains("sort-asc") ? "asc" : th.classList.contains("sort-desc") ? "desc" : null;
  const next = current === "asc" ? "desc" : "asc";
  for (const other of Array.from(container.querySelectorAll("table.matrix thead th[data-sort-key]"))) {
    other.classList.remove("sort-asc", "sort-desc");
  }
  th.classList.add(next === "asc" ? "sort-asc" : "sort-desc");
  sortMatrixBy(container, key, next);
}

// src/landscape-selection.ts
function keyKind(key) {
  if (key.startsWith("component:"))
    return "component";
  if (key.startsWith("force:"))
    return "force";
  if (key.startsWith("attractor:"))
    return "attractor";
  return;
}
function keyId(key) {
  return key.slice(key.indexOf(":") + 1);
}
function entityDetail(state, key) {
  const { components, attractors, forces } = effectiveState(state);
  const kind = keyKind(key);
  const id = keyId(key);
  if (kind === "component") {
    const component = components.find((candidate) => candidate.name === id);
    if (!component)
      return;
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
        { label: "force count", value: String(forceCount) }
      ]
    };
  }
  if (kind === "force") {
    const force = forces.find((candidate) => candidate.key === id);
    if (!force)
      return;
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
        { label: "outcomes", value: force.outcomes }
      ]
    };
  }
  if (kind === "attractor") {
    const attractor = attractors.find((candidate) => candidate.id === id);
    if (!attractor)
      return;
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
        { label: "force count", value: String(forceCount) }
      ]
    };
  }
  return;
}
function highlightConnectedKeys(state, selected) {
  const { forces } = effectiveState(state);
  const result = new Set;
  for (const key of selected) {
    const kind = keyKind(key);
    const id = keyId(key);
    if (kind === "force") {
      const force = forces.find((candidate) => candidate.key === id);
      result.add(key);
      if (!force)
        continue;
      result.add(`attractor:${force.attractorId}`);
      for (const component of force.components) {
        result.add(`component:${component}`);
      }
      for (const sibling of forces) {
        if (sibling.attractorId === force.attractorId) {
          result.add(`force:${sibling.key}`);
        }
      }
      continue;
    }
    if (kind === "attractor") {
      result.add(key);
      for (const force of forces) {
        if (force.attractorId !== id)
          continue;
        result.add(`force:${force.key}`);
        for (const component of force.components) {
          result.add(`component:${component}`);
        }
      }
      continue;
    }
    if (kind === "component") {
      result.add(key);
      const attractorIds = new Set;
      for (const force of forces) {
        if (!force.components.includes(id))
          continue;
        attractorIds.add(force.attractorId);
      }
      for (const attractorId of attractorIds) {
        result.add(`attractor:${attractorId}`);
        for (const force of forces) {
          if (force.attractorId === attractorId) {
            result.add(`force:${force.key}`);
          }
        }
      }
    }
  }
  return result;
}
function bundleHighlightConnectedKeys(state, selected) {
  const { forces } = effectiveState(state);
  const result = new Set;
  const addForcesTouching = (componentName, into) => {
    for (const force of forces) {
      if (force.components.includes(componentName))
        into.add(force.key);
    }
  };
  const addComponentsOfForces = (forceKeys) => {
    for (const force of forces) {
      if (!forceKeys.has(force.key))
        continue;
      for (const component of force.components) {
        result.add(`component:${component}`);
      }
    }
  };
  for (const key of selected) {
    const kind = keyKind(key);
    const id = keyId(key);
    if (kind === "attractor") {
      result.add(key);
      const seedComponents = new Set;
      for (const force of forces) {
        if (force.attractorId !== id)
          continue;
        for (const component of force.components)
          seedComponents.add(component);
      }
      for (const component of seedComponents) {
        result.add(`component:${component}`);
      }
      const forceKeys = new Set;
      for (const component of seedComponents)
        addForcesTouching(component, forceKeys);
      for (const forceKey of forceKeys)
        result.add(`force:${forceKey}`);
      addComponentsOfForces(forceKeys);
      continue;
    }
    if (kind === "component") {
      result.add(key);
      const forceKeys = new Set;
      addForcesTouching(id, forceKeys);
      for (const forceKey of forceKeys)
        result.add(`force:${forceKey}`);
      addComponentsOfForces(forceKeys);
    }
  }
  return result;
}
function toggleSelection(current, key) {
  const next = new Set(current);
  if (next.has(key))
    next.delete(key);
  else
    next.add(key);
  return next;
}

// src/landscape-dom.ts
function renderLegend(host, title, entries, extras = []) {
  const legend = document.createElement("div");
  legend.className = "landscape-legend";
  const heading = document.createElement("span");
  heading.className = "landscape-legend-title";
  heading.textContent = title;
  legend.appendChild(heading);
  for (const entry of entries) {
    const item = document.createElement("span");
    item.className = "landscape-legend-item";
    item.dataset.legendId = entry.id;
    const swatch = document.createElement("i");
    swatch.style.background = entry.color;
    item.append(swatch, entry.label);
    legend.appendChild(item);
  }
  legend.append(...extras);
  host.appendChild(legend);
  return legend;
}
var ZOOM_SPEED = 0.6;
function zoomWheelDelta(event) {
  return ZOOM_SPEED * -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002) * (event.ctrlKey ? 10 : 1);
}
function renderEmpty(host, message) {
  const empty = document.createElement("p");
  empty.className = "landscape-empty";
  empty.textContent = message;
  host.appendChild(empty);
}
function appendZoomableSvg(host, d3, viewBox, className, label) {
  const svg = d3.select(host).append("svg").attr("class", `landscape-svg ${className}`).attr("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`).attr("preserveAspectRatio", "xMidYMid meet").attr("role", "img").attr("aria-label", label);
  const content = svg.append("g").attr("class", "landscape-zoom");
  const zoom = d3.zoom().scaleExtent([0.5, 8]).wheelDelta(zoomWheelDelta).filter((event) => event.type === "wheel" ? event.ctrlKey || event.metaKey : !event.button).on("zoom", (event) => content.attr("transform", event.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  return { svg, content, zoom };
}
function resetZoom(svg, zoom, d3) {
  svg.transition().duration(200).call(zoom.transform, d3.zoomIdentity);
}
function placeTooltip(_host, tip, _event) {
  tip.hidden = false;
  tip.style.removeProperty("left");
  tip.style.removeProperty("top");
}
function createTooltip(host) {
  const doc = host.ownerDocument;
  const existing = doc.querySelector("body > .landscape-tip");
  if (existing)
    return existing;
  const tip = doc.createElement("div");
  tip.className = "landscape-tip";
  tip.setAttribute("role", "tooltip");
  tip.setAttribute("aria-live", "polite");
  tip.setAttribute("aria-atomic", "true");
  tip.hidden = true;
  doc.body.appendChild(tip);
  return tip;
}
function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

// src/nkp-bundle.ts
var UNASSIGNED_GROUP_ID = "unassigned";
var DEFAULT_MIN_GROUP_SIZE = 2;
var DEFAULT_BUNDLE_TENSION = 0.85;
function dominantAttractors(edges) {
  const best = new Map;
  for (const edge of edges) {
    if (edge.type !== "attractor")
      continue;
    const current = best.get(edge.target);
    if (!current || edge.count > current.count || edge.count === current.count && edge.source < current.attractor) {
      best.set(edge.target, { attractor: edge.source, count: edge.count });
    }
  }
  return new Map([...best].map(([component, { attractor }]) => [component, attractor]));
}
function assignGroups(edges, minGroupSize) {
  const dominant = dominantAttractors(edges);
  const sizes = new Map;
  for (const attractor of dominant.values())
    sizes.set(attractor, (sizes.get(attractor) ?? 0) + 1);
  const bigEnough = (attractor) => (sizes.get(attractor) ?? 0) >= minGroupSize;
  if (minGroupSize <= 1 || ![...sizes.keys()].some(bigEnough))
    return dominant;
  const assigned = new Map;
  for (const [componentId, attractor] of dominant) {
    if (bigEnough(attractor)) {
      assigned.set(componentId, attractor);
      continue;
    }
    let best;
    for (const edge of edges) {
      if (edge.type !== "attractor" || edge.target !== componentId || !bigEnough(edge.source))
        continue;
      if (!best || edge.count > best.count || edge.count === best.count && edge.source < best.attractor) {
        best = { attractor: edge.source, count: edge.count };
      }
    }
    assigned.set(componentId, best?.attractor ?? UNASSIGNED_GROUP_ID);
  }
  return assigned;
}
function groupSimilarity(edges, groupOf) {
  const weights = new Map;
  const add = (left, right, count) => {
    const row = weights.get(left) ?? new Map;
    row.set(right, (row.get(right) ?? 0) + count);
    weights.set(left, row);
  };
  for (const edge of edges) {
    if (edge.type !== "coupling")
      continue;
    const left = groupOf.get(edge.source);
    const right = groupOf.get(edge.target);
    if (!left || !right || left === right)
      continue;
    add(left, right, edge.count);
    add(right, left, edge.count);
  }
  return weights;
}
function orderGroups(groupIds, similarity) {
  const total = (id) => [...similarity.get(id)?.values() ?? []].reduce((sum, value) => sum + value, 0);
  const remaining = groupIds.filter((id) => id !== UNASSIGNED_GROUP_ID).sort();
  const ordered = [];
  const pickBest = (score) => {
    let bestId = remaining[0];
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
    const next = last === undefined ? pickBest(total) : pickBest((id) => (similarity.get(last)?.get(id) ?? 0) * 1e6 + total(id));
    ordered.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  if (groupIds.includes(UNASSIGNED_GROUP_ID))
    ordered.push(UNASSIGNED_GROUP_ID);
  return ordered;
}
function orderLeaves(leaves, groupIndex, groupPosition, groupOf, edges) {
  const groupCount = Math.max(1, groupPosition.size);
  const pull = new Map;
  for (const edge of edges) {
    if (edge.type !== "coupling")
      continue;
    for (const [self, other] of [[edge.source, edge.target], [edge.target, edge.source]]) {
      const otherGroup = groupOf.get(other);
      const otherIndex = otherGroup === undefined ? undefined : groupPosition.get(otherGroup);
      if (otherIndex === undefined || otherIndex === groupIndex)
        continue;
      let delta = otherIndex - groupIndex;
      if (delta > groupCount / 2)
        delta -= groupCount;
      if (delta < -groupCount / 2)
        delta += groupCount;
      const entry = pull.get(self) ?? { weighted: 0, total: 0 };
      entry.weighted += delta * edge.count;
      entry.total += edge.count;
      pull.set(self, entry);
    }
  }
  const score = (leaf) => {
    const entry = pull.get(leaf.id);
    return entry && entry.total > 0 ? entry.weighted / entry.total : 0;
  };
  return [...leaves].sort((left, right) => score(left) - score(right) || left.label.localeCompare(right.label));
}
function buildNkpBundleModel(state, options = {}) {
  const filtered = buildNkpGraphModel(state, options);
  const full = buildNkpGraphModel(state, { minCouplingStrength: 1 });
  const colors = attractorColors(state);
  const dominant = dominantAttractors(full.edges);
  const assigned = assignGroups(full.edges, options.minGroupSize ?? DEFAULT_MIN_GROUP_SIZE);
  const groupOf = new Map;
  for (const node of full.nodes) {
    if (node.type === "component")
      groupOf.set(node.id, assigned.get(node.id) ?? UNASSIGNED_GROUP_ID);
  }
  const attractorNodes = new Map(full.nodes.filter((node) => node.type === "attractor").map((node) => [node.id, node]));
  const leavesByGroup = new Map;
  for (const node of filtered.nodes) {
    if (node.type !== "component")
      continue;
    const groupId = groupOf.get(node.id) ?? UNASSIGNED_GROUP_ID;
    const leaf = {
      id: node.id,
      label: node.label,
      groupId,
      ...node.status ? { status: node.status } : {},
      color: node.color ?? "var(--muted)",
      tooltip: node.tooltip,
      focused: node.focused,
      fissionCandidate: Boolean(node.fissionCandidate),
      dominantLabel: attractorNodes.get(dominant.get(node.id) ?? "")?.label ?? "no attractor"
    };
    leavesByGroup.set(groupId, [...leavesByGroup.get(groupId) ?? [], leaf]);
  }
  const similarity = groupSimilarity(full.edges, groupOf);
  const allGroupIds = [...new Set(groupOf.values())];
  const globalOrder = orderGroups(allGroupIds, similarity);
  const groupPosition = new Map(globalOrder.map((id, index) => [id, index]));
  const groups = [];
  for (const id of globalOrder) {
    const leaves = leavesByGroup.get(id);
    if (!leaves || leaves.length === 0)
      continue;
    const attractor = attractorNodes.get(id);
    groups.push({
      id,
      label: attractor?.label ?? "other",
      tooltip: attractor?.tooltip ?? "Components whose own attractor covers no other component, or that have no attractor-linked forces",
      color: colors.get(id.slice("attractor:".length)) ?? "var(--muted)",
      leaves: orderLeaves(leaves, groupPosition.get(id) ?? 0, groupPosition, groupOf, full.edges)
    });
  }
  const placed = new Set(groups.flatMap((group) => group.leaves.map((leaf) => leaf.id)));
  const fusionPairs = new Set(filtered.edges.filter((edge) => edge.type === "fusion").map((edge) => [edge.source, edge.target].sort().join("\x00")));
  const couplingPairs = new Set(filtered.edges.filter((edge) => edge.type === "coupling").map((edge) => [edge.source, edge.target].sort().join("\x00")));
  const edges = filtered.edges.filter((edge) => placed.has(edge.source) && placed.has(edge.target)).filter((edge) => edge.type === "coupling" || edge.type === "fusion" && !couplingPairs.has([edge.source, edge.target].sort().join("\x00"))).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    count: edge.count,
    stressors: edge.stressors,
    forceKeys: edge.forceKeys,
    tooltip: edge.tooltip,
    focused: edge.focused,
    fusion: fusionPairs.has([edge.source, edge.target].sort().join("\x00"))
  }));
  return { groups, edges, maxCount: edges.reduce((max, edge) => Math.max(max, edge.count), 1) };
}
function bundleHierarchyData(model) {
  return {
    id: "root",
    children: model.groups.map((group) => ({
      id: group.id,
      group,
      children: group.leaves.map((leaf) => ({ id: leaf.id, leaf }))
    }))
  };
}
function bundleEdgeStyle(count, maxCount, focused) {
  const ratio = maxCount <= 1 ? 1 : (count - 1) / (maxCount - 1);
  const opacity = (0.18 + 0.5 * ratio) * (focused ? 1 : 0.35);
  return { width: 0.8 + 2.4 * ratio, opacity: Math.round(opacity * 1000) / 1000 };
}
function radialLabelTransform(angleDegrees, radius) {
  const flip = angleDegrees % 360 >= 180;
  return {
    transform: `rotate(${angleDegrees - 90}) translate(${radius},0)${flip ? " rotate(180)" : ""}`,
    anchor: flip ? "end" : "start"
  };
}
function leafNeighbourSummary(model, leafId) {
  const labels = new Map(model.groups.flatMap((group) => group.leaves.map((leaf) => [leaf.id, leaf.label])));
  return model.edges.filter((edge) => edge.source === leafId || edge.target === leafId).map((edge) => {
    const other = edge.source === leafId ? edge.target : edge.source;
    return { label: labels.get(other) ?? other, count: edge.count, stressors: edge.stressors };
  }).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}
function layoutGroupLabels(arcs, radius, charWidth) {
  const degPerChar = charWidth / radius * (180 / Math.PI);
  const wanted = arcs.map((arc) => {
    const mid = (arc.start + arc.end) / 2;
    const half = Math.max((arc.end - arc.start) / 2, (arc.label.length + 1) * degPerChar / 2);
    return { lo: mid - half, hi: mid + half };
  });
  const result = wanted.map((item) => ({ ...item }));
  if (arcs.length > 1) {
    for (let index = 0;index < arcs.length; index += 1) {
      const nextIndex = (index + 1) % arcs.length;
      const wrap = nextIndex === 0 ? 360 : 0;
      const current = wanted[index];
      const nextLo = wanted[nextIndex].lo + wrap;
      if (current.hi <= nextLo)
        continue;
      const boundary = Math.min(Math.max((current.hi + nextLo) / 2, arcs[index].end), arcs[nextIndex].start + wrap);
      result[index].hi = Math.min(result[index].hi, Math.max(boundary - degPerChar / 2, arcs[index].end));
      result[nextIndex].lo = Math.max(result[nextIndex].lo, Math.min(boundary + degPerChar / 2, arcs[nextIndex].start + wrap) - wrap);
    }
  }
  return result.map((span) => ({
    start: span.lo,
    end: span.hi,
    maxChars: Math.max(0, Math.floor((span.hi - span.lo) / degPerChar) - 1)
  }));
}
var CHAR_WIDTH = 6.8;
var MAX_LABEL_CHARS = 26;
var GROUP_GAP = 2.2;
var GROUP_CHAR_WIDTH = 6.4;
var BAND_GAP = 5;
var BAND_WIDTH = 6;
var LABEL_GAP = 5;
function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
function slugify(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "-");
}
function createBundleView(ctx) {
  const { host, d3 } = ctx;
  let built;
  let lastSelected = new Set;
  let lastConnected = new Set;
  let lastState;
  function teardown() {
    built = undefined;
    host.replaceChildren();
  }
  function ensureBuilt() {
    if (built)
      return built;
    const { svg, content, zoom } = appendZoomableSvg(host, d3, { x: -1, y: -1, width: 2, height: 2 }, "nkp-bundle-svg", "Component couplings bundled by attractor");
    const edgesG = content.append("g").attr("class", "nkp-bundle-edges");
    const groupsG = content.append("g").attr("class", "nkp-bundle-groups");
    const leavesG = content.append("g").attr("class", "nkp-bundle-leaves");
    const labelsGroup = svg.append("g").attr("class", "landscape-labels");
    zoom.on("zoom.labels", (event) => labelsGroup.attr("transform", event.transform));
    svg.on("dblclick", () => ctx.onClear());
    const tip = createTooltip(host);
    built = { svg, zoom, edgesG, groupsG, leavesG, labelsGroup, tip };
    return built;
  }
  function applySelectionClasses() {
    if (!built)
      return;
    const hasSelection = lastSelected.size > 0;
    const isSelected = (id) => lastSelected.has(id);
    const isConnected = (id) => !isSelected(id) && lastConnected.has(id);
    const dim = (id) => hasSelection && !isSelected(id) && !isConnected(id);
    built.leavesG.selectAll(".nkp-bundle-leaf").classed("selected", (node) => isSelected(node.data.id)).classed("connected", (node) => isConnected(node.data.id)).classed("dim", (node) => dim(node.data.id));
    built.labelsGroup.selectAll(".nkp-bundle-leaf").classed("selected", (node) => isSelected(node.data.id)).classed("connected", (node) => isConnected(node.data.id)).classed("dim", (node) => dim(node.data.id)).attr("opacity", (node) => dim(node.data.id) ? 0 : 1);
    built.groupsG.selectAll(".nkp-bundle-group").classed("selected", (d) => isSelected(d.group.id)).classed("connected", (d) => isConnected(d.group.id)).classed("dim", (d) => dim(d.group.id));
    built.labelsGroup.selectAll(".nkp-bundle-group-label").attr("opacity", (d) => dim(d.group.id) ? 0 : 1);
    built.edgesG.selectAll("path.nkp-bundle-edge").classed("dim", (item) => dim(item.edge.source) || dim(item.edge.target)).classed("connected", (item) => {
      if (!hasSelection)
        return false;
      const sourceIn = isSelected(item.edge.source) || isConnected(item.edge.source);
      const targetIn = isSelected(item.edge.target) || isConnected(item.edge.target);
      return sourceIn && targetIn;
    });
  }
  function update(state, rawOptions = {}) {
    lastState = state;
    const options = rawOptions;
    const model = buildNkpBundleModel(state, options);
    const leafCount = model.groups.reduce((sum, group) => sum + group.leaves.length, 0);
    if (leafCount === 0) {
      if (!built) {
        renderEmpty(host, "No components to bundle. Loosen the filters or lower the minimum coupling strength.");
        return;
      }
      const b2 = ensureBuilt();
      b2.edgesG.selectAll("path.nkp-bundle-edge").data([]).join("path");
      b2.groupsG.selectAll("g.nkp-bundle-group").data([]).join("g");
      b2.leavesG.selectAll("g.nkp-bundle-leaf").data([]).join("g");
      b2.labelsGroup.selectAll("text.nkp-bundle-label").data([]).join("text");
      b2.labelsGroup.selectAll("text.nkp-bundle-group-label").data([]).join("text");
      return;
    }
    if (host.querySelector(".landscape-empty"))
      host.replaceChildren();
    const b = ensureBuilt();
    const longestLabel = Math.min(MAX_LABEL_CHARS, Math.max(...model.groups.flatMap((group) => group.leaves.map((leaf) => leaf.label.length + (leaf.fissionCandidate ? 2 : 0)))));
    const innerRadius = Math.max(150, (leafCount + model.groups.length * GROUP_GAP) * 14 / (2 * Math.PI));
    const bandInner = innerRadius + BAND_GAP;
    const bandOuter = bandInner + BAND_WIDTH;
    const labelRadius = bandOuter + LABEL_GAP;
    const nameRadius = labelRadius + longestLabel * CHAR_WIDTH + 16;
    const half = nameRadius + 18;
    b.svg.attr("viewBox", `${-half} ${-half} ${half * 2} ${half * 2}`);
    const root = d3.hierarchy(bundleHierarchyData(model));
    d3.cluster().size([360, innerRadius]).separation((a, other) => a.parent === other.parent ? 1 : GROUP_GAP)(root);
    const leafNodes = new Map(root.leaves().map((node) => [node.data.id, node]));
    const line = d3.lineRadial().curve(d3.curveBundle.beta(options.tension ?? DEFAULT_BUNDLE_TENSION)).radius((node) => node.y).angle((node) => node.x * Math.PI / 180);
    const halfStep = 360 / (leafCount - model.groups.length + model.groups.length * GROUP_GAP) / 2;
    const groupArcs = (root.children ?? []).map((groupNode) => {
      const xs = groupNode.leaves().map((leaf) => leaf.x);
      return {
        group: groupNode.data.group,
        start: Math.min(...xs) - halfStep * 0.85,
        end: Math.max(...xs) + halfStep * 0.85,
        name: { start: 0, end: 0, maxChars: 0 }
      };
    });
    const nameSpans = layoutGroupLabels(groupArcs.map((d) => ({ start: d.start, end: d.end, label: d.group.label })), nameRadius, GROUP_CHAR_WIDTH);
    groupArcs.forEach((d, index) => {
      d.name = nameSpans[index];
    });
    const toRadians = (deg) => deg * Math.PI / 180;
    const band = d3.arc().innerRadius(bandInner).outerRadius(bandOuter);
    const guide = d3.arc().innerRadius(nameRadius - 9).outerRadius(nameRadius - 8);
    const isBottom = (d) => {
      const mid = (d.start + d.end) / 2;
      return mid > 90 && mid < 270;
    };
    const edgeData = model.edges.map((edge) => ({ edge, from: leafNodes.get(edge.source), to: leafNodes.get(edge.target) })).filter((item) => item.from && item.to).sort((left, right) => left.edge.count - right.edge.count);
    const edgePaths = b.edgesG.selectAll("path.nkp-bundle-edge").data(edgeData, (item) => item.edge.id).join("path").attr("class", (item) => `nkp-bundle-edge${item.edge.fusion ? " fusion" : ""}`).attr("aria-label", (item) => item.edge.tooltip).attr("tabindex", 0).attr("d", (item) => line(item.from.path(item.to))).each(function(item) {
      const style = bundleEdgeStyle(item.edge.count, model.maxCount, item.edge.focused);
      this.style.strokeWidth = `${style.width}px`;
      this.style.strokeOpacity = String(style.opacity);
    });
    edgePaths.on("click", (_event, item) => {
      for (const key of item.edge.forceKeys)
        ctx.onToggle(`force:${key}`);
    }).on("mouseenter focus", (event, item) => {
      b.tip.textContent = item.edge.tooltip;
      placeTooltip(host, b.tip, event);
    }).on("mouseleave blur", () => {
      b.tip.hidden = true;
    });
    const groupSel = b.groupsG.selectAll("g.nkp-bundle-group").data(groupArcs, (d) => d.group.id).join((enter) => {
      const g = enter.append("g").attr("class", "nkp-bundle-group");
      g.append("path").attr("class", "nkp-bundle-band");
      g.append("path").attr("class", "nkp-bundle-guide");
      g.append("path").attr("class", "nkp-bundle-hit").lower();
      g.append("path").attr("class", "nkp-bundle-name-path").attr("fill", "none");
      return g;
    });
    groupSel.attr("aria-label", (d) => d.group.tooltip).attr("tabindex", 0);
    groupSel.select(".nkp-bundle-band").attr("fill", (d) => d.group.color).attr("d", (d) => band({ startAngle: toRadians(d.start), endAngle: toRadians(d.end) }));
    groupSel.select(".nkp-bundle-guide").attr("fill", (d) => d.group.color).attr("d", (d) => guide({ startAngle: toRadians(d.start), endAngle: toRadians(d.end) }));
    groupSel.select(".nkp-bundle-hit").attr("d", (d) => d3.arc().innerRadius(bandInner).outerRadius(nameRadius + 8)({ startAngle: toRadians(d.start), endAngle: toRadians(d.end) }));
    groupSel.select(".nkp-bundle-name-path").attr("id", (d) => `nkp-bundle-name-${slugify(d.group.id)}`).attr("d", (d) => {
      const point = (deg) => {
        const rad = toRadians(deg - 90);
        return `${nameRadius * Math.cos(rad)},${nameRadius * Math.sin(rad)}`;
      };
      const large = d.name.end - d.name.start > 180 ? 1 : 0;
      return isBottom(d) ? `M${point(d.name.end)} A${nameRadius},${nameRadius} 0 ${large} 0 ${point(d.name.start)}` : `M${point(d.name.start)} A${nameRadius},${nameRadius} 0 ${large} 1 ${point(d.name.end)}`;
    });
    groupSel.on("click", (_event, d) => {
      if (d.group.id.startsWith("attractor:"))
        ctx.onToggle(d.group.id);
    });
    const leafSel = b.leavesG.selectAll("g.nkp-bundle-leaf").data(root.leaves(), (node) => node.data.id).join((enter) => {
      const g = enter.append("g");
      g.append("circle").attr("class", "nkp-bundle-dot nkp-component-status-glyph").attr("r", 3.2);
      g.append("rect").attr("class", "nkp-bundle-dot nkp-component-status-glyph").attr("x", -3.2).attr("y", -3.2).attr("width", 6.4).attr("height", 6.4);
      return g;
    });
    leafSel.attr("class", (node) => {
      const leaf = node.data.leaf;
      return `nkp-bundle-leaf${leaf.fissionCandidate ? " fission" : ""}${leaf.focused ? "" : " unfocused"}`;
    }).attr("data-component-id", (node) => node.data.id).attr("aria-label", (node) => node.data.leaf.tooltip).attr("tabindex", 0).attr("transform", (node) => `rotate(${node.x - 90}) translate(${node.y},0)`);
    leafSel.select("circle").attr("data-component-status-shape", (node) => node.data.leaf.status === "proposed" ? null : "actual").attr("display", (node) => node.data.leaf.status === "proposed" ? "none" : null).attr("fill", (node) => node.data.leaf.color);
    leafSel.select("rect").attr("data-component-status-shape", (node) => node.data.leaf.status === "proposed" ? "proposed" : null).attr("display", (node) => node.data.leaf.status === "proposed" ? null : "none").attr("fill", (node) => node.data.leaf.color);
    leafSel.on("click", (_event, node) => ctx.onToggle(node.data.id));
    const leafLabelSel = b.labelsGroup.selectAll("text.nkp-bundle-label").data(root.leaves(), (node) => node.data.id).join("text").attr("dy", "0.32em");
    leafLabelSel.attr("class", (node) => {
      const leaf = node.data.leaf;
      return `nkp-bundle-leaf nkp-bundle-label${leaf.fissionCandidate ? " fission" : ""}${leaf.focused ? "" : " unfocused"}`;
    }).each(function(node) {
      const placement = radialLabelTransform(node.x, labelRadius);
      this.setAttribute("transform", placement.transform);
      this.setAttribute("text-anchor", placement.anchor);
      const leaf = node.data.leaf;
      const text = truncate(leaf.label, MAX_LABEL_CHARS);
      this.textContent = leaf.fissionCandidate ? placement.anchor === "start" ? `${text} ▲` : `▲ ${text}` : text;
    });
    leafLabelSel.on("click", (_event, node) => ctx.onToggle(node.data.id));
    const groupLabelSel = b.labelsGroup.selectAll("text.nkp-bundle-group-label").data(groupArcs, (d) => d.group.id).join((enter) => {
      const t = enter.append("text").attr("class", "nkp-bundle-group-label");
      t.append("textPath");
      return t;
    });
    groupLabelSel.attr("fill", (d) => d.group.color).attr("dy", (d) => isBottom(d) ? "0.8em" : "0").select("textPath").attr("href", (d) => `#nkp-bundle-name-${slugify(d.group.id)}`).attr("startOffset", "50%").attr("text-anchor", "middle").text((d) => truncate(d.group.label, d.name.maxChars));
    const clearHover = () => {
      b.svg.classed("hovering", false);
      edgePaths.classed("hl-a", false).classed("hl-b", false).classed("hl", false);
      leafSel.classed("hl", false);
      leafLabelSel.classed("hl", false);
      groupSel.classed("hl", false);
      b.labelsGroup.selectAll(".nkp-bundle-group-label").classed("hl", false);
      b.tip.hidden = true;
      applySelectionClasses();
    };
    const showLeaf = (event, node) => {
      const leaf = node.data.leaf;
      b.svg.classed("hovering", true);
      const lit = lastState ? bundleHighlightConnectedKeys(lastState, [leaf.id]) : new Set([leaf.id]);
      edgePaths.classed("hl-a", false).classed("hl-b", false).classed("hl", (item) => lit.has(item.edge.source) && lit.has(item.edge.target));
      edgePaths.filter(".hl").raise();
      leafSel.classed("hl", (other) => lit.has(other.data.id));
      leafLabelSel.classed("hl", (other) => lit.has(other.data.id));
      groupSel.classed("hl", (d) => lit.has(d.group.id));
      b.labelsGroup.selectAll(".nkp-bundle-group-label").classed("hl", (d) => lit.has(d.group.id));
      const summary = leafNeighbourSummary(model, leaf.id);
      const group = model.groups.find((candidate) => candidate.id === leaf.groupId);
      const placement = group && group.label !== leaf.dominantLabel ? `${escapeHtml(group.label)} (own attractor: ${escapeHtml(leaf.dominantLabel)})` : escapeHtml(group?.label ?? "");
      const rows = summary.slice(0, 12).map((item) => `<li><b>${escapeHtml(item.label)}</b> (${item.count}): ${escapeHtml(item.stressors.join(", "))}</li>`).join("");
      b.tip.innerHTML = `<strong>${escapeHtml(leaf.label)}</strong>` + `<div class="muted">${placement}${leaf.fissionCandidate ? " · fission candidate" : ""}</div>` + (rows ? `<ul>${rows}</ul>${summary.length > 12 ? `<div class="muted">+${summary.length - 12} more</div>` : ""}` : `<div class="muted">No visible couplings</div>`);
      placeTooltip(host, b.tip, event);
    };
    leafSel.on("mouseenter", showLeaf).on("focus", showLeaf).on("mouseleave", clearHover).on("blur", clearHover);
    const showGroup = (event, d) => {
      const attractorKey = d.group.id;
      const lit = lastState ? bundleHighlightConnectedKeys(lastState, [attractorKey]) : new Set([attractorKey, ...d.group.leaves.map((leaf) => leaf.id)]);
      b.svg.classed("hovering", true);
      groupSel.classed("hl", (other) => lit.has(other.group.id));
      b.labelsGroup.selectAll(".nkp-bundle-group-label").classed("hl", (other) => lit.has(other.group.id));
      leafSel.classed("hl", (other) => lit.has(other.data.id));
      leafLabelSel.classed("hl", (other) => lit.has(other.data.id));
      edgePaths.classed("hl-a", false).classed("hl-b", false).classed("hl", (item) => lit.has(item.edge.source) && lit.has(item.edge.target));
      edgePaths.filter(".hl").raise();
      const members = new Set(d.group.leaves.map((leaf) => leaf.id));
      let internal = 0;
      let external = 0;
      for (const edge of model.edges) {
        const a = members.has(edge.source);
        const b2 = members.has(edge.target);
        if (a && b2)
          internal += 1;
        else if (a !== b2)
          external += 1;
      }
      b.tip.innerHTML = `<strong>${escapeHtml(d.group.label)}</strong>` + `<div class="muted">${d.group.leaves.length} component(s) · ${internal} internal, ${external} cross-attractor couplings</div>`;
      placeTooltip(host, b.tip, event);
    };
    groupSel.on("mouseenter", showGroup).on("focus", showGroup).on("mouseleave", clearHover).on("blur", clearHover);
    applySelectionClasses();
  }
  function setSelection(selected, connected) {
    lastSelected = selected;
    lastConnected = connected;
    applySelectionClasses();
  }
  function resetView() {
    if (!built)
      return;
    resetZoom(built.svg, built.zoom, d3);
  }
  return { update, setSelection, resetView, destroy: teardown };
}

// src/nkp-seriation.ts
function seriate(similarity) {
  const n = similarity.length;
  const sim = (a, b) => similarity[a]?.[b] ?? 0;
  let clusters = Array.from({ length: n }, (_, index) => [index]);
  const linkage = (left, right) => {
    let total = 0;
    for (const a of left)
      for (const b of right)
        total += sim(a, b);
    return total / (left.length * right.length);
  };
  while (clusters.length > 1) {
    let best = { i: -1, j: -1, score: 0 };
    for (let i = 0;i < clusters.length; i += 1) {
      for (let j = i + 1;j < clusters.length; j += 1) {
        const score = linkage(clusters[i] ?? [], clusters[j] ?? []);
        if (score > best.score)
          best = { i, j, score };
      }
    }
    if (best.i < 0) {
      clusters.sort((left2, right2) => right2.length - left2.length || (left2[0] ?? 0) - (right2[0] ?? 0));
      return clusters.flat();
    }
    const left = clusters[best.i] ?? [];
    const right = clusters[best.j] ?? [];
    const candidates = [
      [...left, ...right],
      [...left, ...[...right].reverse()],
      [...[...left].reverse(), ...right],
      [...[...left].reverse(), ...[...right].reverse()]
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
function keepTopNTiers(counts, topN, direction) {
  const tiers = [...new Set(counts)].sort((a, b) => direction === "weakest" ? a - b : b - a);
  return new Set(topN === undefined ? tiers : tiers.slice(0, Math.max(0, topN)));
}
function buildSeriationModel(state, options = {}) {
  const { components, attractors, forces } = effectiveState(state);
  const sharedComponents = new Map(buildNkpGraphModel(state, { minCouplingStrength: 1 }).nodes.filter((node) => node.type === "component").map((node) => [node.id, node]));
  const visibleForces = options.visibleForceIds;
  const isVisibleForce = (force) => visibleForces === undefined || visibleForces.has(force.key);
  const isVisibleComponent = (name) => options.visibleComponentNames === undefined || options.visibleComponentNames.has(name);
  const hide = options.hideFiltered ?? false;
  const allForcesByComponent = new Map(components.map((component) => [component.name, []]));
  for (const force of forces) {
    for (const name of new Set(force.components))
      allForcesByComponent.get(name)?.push(force);
  }
  const countedForces = hide ? forces.filter(isVisibleForce) : forces;
  const forcesByComponent = new Map(components.map((component) => [component.name, []]));
  for (const force of countedForces) {
    for (const name of new Set(force.components))
      forcesByComponent.get(name)?.push(force);
  }
  const summaries = components.map((component) => {
    const attached = forcesByComponent.get(component.name) ?? [];
    const focused = (visibleForces === undefined || attached.some(isVisibleForce)) && isVisibleComponent(component.name);
    const shared2 = sharedComponents.get(`component:${component.name}`);
    const dominantAttractorId = shared2?.dominantAttractorId;
    const allAttached = allForcesByComponent.get(component.name) ?? [];
    return {
      name: component.name,
      status: component.status,
      description: component.description,
      k: attached.length,
      ...dominantAttractorId ? { dominantAttractorId } : {},
      color: shared2?.color ?? mutedAttractorColor("var(--muted)"),
      fissionCandidate: allAttached.length > (options.fissionThreshold ?? Number.POSITIVE_INFINITY),
      focused
    };
  });
  const shown = summaries.filter((item) => item.k > 0 && (!hide || item.focused));
  const indexByName = new Map(shown.map((item, index) => [item.name, index]));
  const shared = shown.map(() => shown.map(() => []));
  for (const force of countedForces) {
    const indices = [...new Set(force.components)].map((name) => indexByName.get(name)).filter((index) => index !== undefined);
    for (const a of indices)
      for (const b of indices)
        if (a !== b)
          shared[a]?.[b]?.push(force);
  }
  const similarity = shown.map((left, a) => shown.map((right, b) => {
    const count = shared[a]?.[b]?.length ?? 0;
    return a === b || count === 0 ? 0 : count / Math.sqrt(left.k * right.k);
  }));
  const order = seriate(similarity);
  const ordered = order.map((index) => shown[index]).filter((item) => item !== undefined);
  const minStrength = options.minCouplingStrength ?? DEFAULT_MIN_COUPLING_STRENGTH;
  const rawCells = [];
  order.forEach((originalRow, row) => {
    order.forEach((originalCol, col) => {
      if (row === col)
        return;
      const cellForces = shared[originalRow]?.[originalCol] ?? [];
      if (cellForces.length === 0 || cellForces.length < minStrength)
        return;
      const rowItem = ordered[row];
      const colItem = ordered[col];
      rawCells.push({
        row,
        col,
        count: cellForces.length,
        forceKeys: cellForces.map((force) => force.key),
        forces: cellForces.map(forceLabel),
        focused: cellForces.some(isVisibleForce) && isVisibleComponent(rowItem?.name ?? "") && isVisibleComponent(colItem?.name ?? "")
      });
    });
  });
  const tiers = keepTopNTiers(rawCells.map((cell) => cell.count), options.topNCouplings, options.topNDirection ?? "strongest");
  const cells = rawCells.filter((cell) => tiers.has(cell.count) && (!hide || cell.focused));
  const attractorNames = new Map(attractors.map((attractor) => [attractor.id, attractor.name]));
  const colors = attractorColors(state);
  const legend = new Map;
  for (const item of ordered) {
    if (!item.dominantAttractorId)
      continue;
    const entry = legend.get(item.dominantAttractorId) ?? {
      id: item.dominantAttractorId,
      name: attractorNames.get(item.dominantAttractorId) ?? item.dominantAttractorId,
      color: colors.get(item.dominantAttractorId) ?? "var(--muted)",
      componentCount: 0
    };
    entry.componentCount += 1;
    legend.set(entry.id, entry);
  }
  return {
    components: ordered,
    cells,
    maxCount: cells.reduce((max, cell) => Math.max(max, cell.count), 0),
    maxK: ordered.reduce((max, item) => Math.max(max, item.k), 0),
    attractors: [...legend.values()]
  };
}
var CELL = 18;
var STRIPE = 6;
var LABEL_WIDTH = 170;
var HEADER_HEIGHT = 150;
function cellHalf(row, col) {
  if (col > row)
    return "upper";
  if (col < row)
    return "lower";
  return "diagonal";
}
function createHeatmapView(ctx) {
  const { host, d3 } = ctx;
  let built;
  let indexByName = new Map;
  let componentByIndex = new Map;
  let lastModel;
  let pinnedMirrorHalf;
  let hoverMirrorHalf;
  let lastSelected = new Set;
  let lastConnected = new Set;
  function destroy() {
    built = undefined;
    host.replaceChildren();
  }
  function ensureBuilt() {
    if (built)
      return built;
    const { svg, content, zoom } = appendZoomableSvg(host, d3, { x: 0, y: 0, width: 2, height: 2 }, "nkp-seriation-svg", "Component coupling heatmap, rows ordered so tightly coupled components sit together");
    const root = content.append("g");
    const frame = root.append("rect").attr("class", "nkp-seriation-frame");
    const rowBand = root.append("rect").attr("class", "nkp-seriation-band").attr("visibility", "hidden");
    const colBand = root.append("rect").attr("class", "nkp-seriation-band").attr("visibility", "hidden");
    const cellLayer = root.append("g");
    const diagonalLayer = root.append("g");
    const rowHeadersLayer = root.append("g");
    const colHeadersLayer = root.append("g");
    const labelsGroup = svg.append("g").attr("class", "landscape-labels");
    zoom.on("zoom.labels", (event) => labelsGroup.attr("transform", event.transform));
    svg.on("dblclick", () => ctx.onClear());
    built = { svg, zoom, root, labelsGroup, tip: createTooltip(host), frame, rowBand, colBand, cellLayer, diagonalLayer, rowHeadersLayer, colHeadersLayer };
    return built;
  }
  const intensity = (value, max) => max <= 0 ? 0 : 0.18 + 0.82 * (value / max);
  function showTooltip(event, lines) {
    const b = built;
    if (!b)
      return;
    b.tip.replaceChildren(...lines.map((line, index) => {
      const element = document.createElement(index === 0 ? "strong" : "div");
      element.textContent = line;
      return element;
    }));
    placeTooltip(host, b.tip, event);
  }
  function hideTooltip() {
    if (!built)
      return;
    built.tip.hidden = true;
  }
  function clearHover() {
    hideTooltip();
    hoverMirrorHalf = undefined;
    applyMirrorClasses();
    applyHeaderBands(undefined, undefined);
  }
  function applyHeaderBands(row, col) {
    if (!built)
      return;
    const activeRow = row;
    const activeCol = col;
    const n = lastModel?.components.length ?? 0;
    built.rowBand.attr("visibility", activeRow === undefined ? "hidden" : "visible").attr("y", (activeRow ?? 0) * CELL).attr("width", n * CELL).attr("height", CELL);
    built.colBand.attr("visibility", activeCol === undefined ? "hidden" : "visible").attr("x", (activeCol ?? 0) * CELL).attr("width", CELL).attr("height", n * CELL);
    built.rowHeaders?.classed("is-active", (item) => indexByName.get(item.name) === activeRow);
    built.colHeaders?.classed("is-active", (item) => indexByName.get(item.name) === activeCol);
  }
  function applyMirrorClasses() {
    const b = built;
    if (!b)
      return;
    const active = hoverMirrorHalf ?? pinnedMirrorHalf;
    b.cells?.classed("mirror-dim", (item) => {
      if (!active)
        return false;
      const half = cellHalf(item.row, item.col);
      if (half === "diagonal")
        return false;
      return active === "upper" ? half === "lower" : half === "upper";
    });
  }
  function focusedCounterpart(item) {
    const half = cellHalf(item.row, item.col);
    if (!pinnedMirrorHalf || half === "diagonal" || half === pinnedMirrorHalf)
      return item;
    return lastModel?.cells.find((cell) => cell.row === item.col && cell.col === item.row) ?? {
      ...item,
      row: item.col,
      col: item.row
    };
  }
  function applySelectionClasses() {
    const b = built;
    if (!b)
      return;
    const hasSelection = lastSelected.size > 0;
    b.svg?.classed("nkp-seriation-selecting", hasSelection);
    const keyState = (keys) => {
      const isSelected = keys.some((key) => lastSelected.has(key));
      if (isSelected)
        return "selected";
      const isConnected = keys.some((key) => lastConnected.has(key));
      if (isConnected)
        return "connected";
      return hasSelection ? "dim" : "none";
    };
    const setState = (selection, keysFor) => {
      if (!selection)
        return;
      selection.classed("selected", (item) => keyState(keysFor(item)) === "selected").classed("connected", (item) => keyState(keysFor(item)) === "connected").classed("dim", (item) => keyState(keysFor(item)) === "dim");
    };
    setState(b.rowHeaders, (item) => [`component:${item.name}`]);
    setState(b.colHeaders, (item) => [`component:${item.name}`]);
    setState(b.diagonal, (item) => [`component:${item.name}`]);
    setState(b.cells, (item) => item.forceKeys.map((key) => `force:${key}`));
    if (b.legend) {
      for (const item of Array.from(b.legend.querySelectorAll("[data-legend-id]"))) {
        const key = `attractor:${item.dataset.legendId ?? ""}`;
        const state = keyState([key]);
        item.classList.toggle("selected", state === "selected");
        item.classList.toggle("connected", state === "connected");
        item.classList.toggle("dim", state === "dim");
        item.style.opacity = state === "dim" ? "0" : "";
      }
    }
    b.labelsGroup.selectAll("text.nkp-seriation-label").attr("opacity", (item) => item.entityKey && keyState([item.entityKey]) === "dim" ? 0 : 1);
  }
  function componentLines(item) {
    return [
      item.name,
      `K = ${item.k} force${item.k === 1 ? "" : "s"}${item.fissionCandidate ? " (fission candidate)" : ""}`,
      `Status: ${item.status}`,
      `Dominant attractor: ${lastModel?.attractors.find((attractor) => attractor.id === item.dominantAttractorId)?.name ?? "none"}`
    ];
  }
  function renderLegendForModel(model) {
    const b = ensureBuilt();
    b.legend?.remove();
    const fissionKey = document.createElement("span");
    fissionKey.className = "landscape-legend-item landscape-legend-warn";
    fissionKey.textContent = "▲ fission candidate";
    const legend = renderLegend(host, "Stripe = main attractor", model.attractors.map((attractor) => ({ id: attractor.id, label: `${attractor.name} (${attractor.componentCount})`, color: attractor.color })), [fissionKey]);
    host.insertBefore(legend, b.svg.node());
    b.legend = legend;
    for (const item of Array.from(legend.querySelectorAll("[data-legend-id]"))) {
      const id = item.dataset.legendId ?? "";
      item.setAttribute("aria-label", `Attractor ${model.attractors.find((attractor) => attractor.id === id)?.name ?? id}`);
      item.tabIndex = 0;
      const reveal = (event) => {
        const attractor = model.attractors.find((candidate) => candidate.id === id);
        showTooltip(event, [attractor?.name ?? id, `${attractor?.componentCount ?? 0} components`]);
      };
      item.addEventListener("mouseenter", reveal);
      item.addEventListener("focus", reveal);
      item.addEventListener("mouseleave", hideTooltip);
      item.addEventListener("blur", hideTooltip);
      item.addEventListener("click", () => {
        const selectedId = item.dataset.legendId;
        if (selectedId)
          ctx.onToggle(`attractor:${selectedId}`);
      });
    }
  }
  function update(state, rawOptions = {}) {
    const options = rawOptions;
    const model = buildSeriationModel(state, options);
    const showCounts = options.showCounts ?? true;
    if (model.components.length === 0) {
      if (!built) {
        renderEmpty(host, "No coupled components to show. Loosen the filters or lower the minimum coupling strength.");
        return;
      }
      const b2 = ensureBuilt();
      b2.legend?.remove();
      b2.legend = undefined;
      b2.cellLayer.selectAll("g.nkp-seriation-cell").data([]).join("g");
      b2.diagonalLayer.selectAll("g.nkp-seriation-diagonal").data([]).join("g");
      b2.rowHeadersLayer.selectAll("g.nkp-seriation-header.row").data([]).join("g");
      b2.colHeadersLayer.selectAll("g.nkp-seriation-header.col").data([]).join("g");
      b2.labelsGroup.selectAll("text").data([]).join("text");
      b2.labelsGroup.selectAll("g.nkp-seriation-label-anchor").remove();
      hideTooltip();
      return;
    }
    if (host.querySelector(".landscape-empty"))
      host.replaceChildren();
    const b = ensureBuilt();
    renderLegendForModel(model);
    lastModel = model;
    indexByName = new Map(model.components.map((item, index) => [item.name, index]));
    componentByIndex = new Map(model.components.map((item, index) => [index, item]));
    const n = model.components.length;
    const width = LABEL_WIDTH + STRIPE + n * CELL + 8;
    const height = HEADER_HEIGHT + STRIPE + n * CELL + 8;
    const gridX = LABEL_WIDTH + STRIPE;
    const gridY = HEADER_HEIGHT + STRIPE;
    b.svg.attr("viewBox", `0 0 ${width} ${height}`);
    b.root.attr("transform", `translate(${gridX},${gridY})`);
    b.frame.attr("width", n * CELL).attr("height", n * CELL);
    const cellSelection = b.cellLayer.selectAll("g.nkp-seriation-cell").data(model.cells, (item) => `${item.row}:${item.col}`).join((enter) => {
      const g = enter.append("g").attr("class", "nkp-seriation-cell");
      g.append("rect");
      return g;
    }).attr("transform", (item) => `translate(${item.col * CELL},${item.row * CELL})`).attr("data-cell-row", (item) => String(item.row)).attr("data-cell-col", (item) => String(item.col));
    cellSelection.attr("aria-label", (item) => {
      const rowName = model.components[item.row]?.name ?? "unknown";
      const colName = model.components[item.col]?.name ?? "unknown";
      return `${rowName} and ${colName}: ${item.count} shared forces`;
    }).attr("tabindex", 0);
    cellSelection.select("rect").attr("class", (item) => `nkp-seriation-heat${item.focused ? "" : " is-faded"}`).attr("width", CELL - 1).attr("height", CELL - 1).attr("fill-opacity", (item) => intensity(item.count, model.maxCount));
    b.cells = cellSelection;
    const diagonalSelection = b.diagonalLayer.selectAll("g.nkp-seriation-diagonal").data(model.components, (item) => item.name).join((enter) => {
      const g = enter.append("g").attr("class", "nkp-seriation-diagonal");
      g.append("rect").attr("class", "nkp-seriation-diag");
      return g;
    }).attr("transform", (item) => `translate(${(indexByName.get(item.name) ?? 0) * CELL},${(indexByName.get(item.name) ?? 0) * CELL})`).attr("data-diagonal-index", (item) => String(indexByName.get(item.name) ?? 0));
    diagonalSelection.attr("aria-label", (item) => componentLines(item).join(". ")).attr("tabindex", 0);
    diagonalSelection.select("rect").attr("width", CELL - 1).attr("height", CELL - 1).attr("fill-opacity", (item) => intensity(item.k, model.maxK) * (item.focused ? 1 : 0.3));
    b.diagonal = diagonalSelection;
    const rowHeaders = b.rowHeadersLayer.selectAll("g.nkp-seriation-header.row").data(model.components, (item) => item.name).join((enter) => {
      const g = enter.append("g").attr("class", "nkp-seriation-header row");
      g.append("rect").attr("class", "nkp-seriation-hit");
      g.append("rect").attr("class", "nkp-seriation-stripe");
      g.append("circle").attr("class", "nkp-component-status-glyph").attr("r", 4);
      g.append("rect").attr("class", "nkp-component-status-glyph").attr("width", 8).attr("height", 8);
      return g;
    }).attr("transform", (item) => `translate(${-gridX},${(indexByName.get(item.name) ?? 0) * CELL})`).attr("data-header-axis", "row").attr("data-header-index", (item) => String(indexByName.get(item.name) ?? 0)).attr("aria-label", (item) => componentLines(item).join(". ")).attr("tabindex", 0);
    rowHeaders.select(".nkp-seriation-hit").attr("width", LABEL_WIDTH + STRIPE).attr("height", CELL);
    rowHeaders.select(".nkp-seriation-stripe").attr("x", LABEL_WIDTH).attr("width", STRIPE - 1).attr("height", CELL - 1).attr("fill", (item) => item.color);
    rowHeaders.select("circle").attr("cx", 8).attr("cy", CELL / 2).attr("data-component-status-shape", (item) => item.status === "actual" ? "actual" : null).attr("display", (item) => item.status === "actual" ? null : "none").attr("fill", (item) => item.color);
    rowHeaders.select("rect.nkp-component-status-glyph").attr("x", 4).attr("y", CELL / 2 - 4).attr("data-component-status-shape", (item) => item.status === "proposed" ? "proposed" : null).attr("display", (item) => item.status === "proposed" ? null : "none").attr("fill", (item) => item.color);
    b.rowHeaders = rowHeaders;
    const colHeaders = b.colHeadersLayer.selectAll("g.nkp-seriation-header.col").data(model.components, (item) => item.name).join((enter) => {
      const g = enter.append("g").attr("class", "nkp-seriation-header col");
      g.append("rect").attr("class", "nkp-seriation-hit");
      g.append("rect").attr("class", "nkp-seriation-stripe");
      g.append("circle").attr("class", "nkp-component-status-glyph").attr("r", 4);
      g.append("rect").attr("class", "nkp-component-status-glyph").attr("width", 8).attr("height", 8);
      return g;
    }).attr("transform", (item) => `translate(${(indexByName.get(item.name) ?? 0) * CELL},${-gridY})`).attr("data-header-axis", "col").attr("data-header-index", (item) => String(indexByName.get(item.name) ?? 0)).attr("aria-label", (item) => componentLines(item).join(". ")).attr("tabindex", 0);
    colHeaders.select(".nkp-seriation-hit").attr("width", CELL).attr("height", HEADER_HEIGHT + STRIPE);
    colHeaders.select(".nkp-seriation-stripe").attr("y", HEADER_HEIGHT).attr("width", CELL - 1).attr("height", STRIPE - 1).attr("fill", (item) => item.color);
    colHeaders.select("circle").attr("cx", CELL / 2).attr("cy", HEADER_HEIGHT - 8).attr("data-component-status-shape", (item) => item.status === "actual" ? "actual" : null).attr("display", (item) => item.status === "actual" ? null : "none").attr("fill", (item) => item.color);
    colHeaders.select("rect.nkp-component-status-glyph").attr("x", CELL / 2 - 4).attr("y", HEADER_HEIGHT - 12).attr("data-component-status-shape", (item) => item.status === "proposed" ? "proposed" : null).attr("display", (item) => item.status === "proposed" ? null : "none").attr("fill", (item) => item.color);
    b.colHeaders = colHeaders;
    const countClass = (count) => `nkp-seriation-count${intensity(count, model.maxCount) > 0.6 ? " nkp-seriation-count-strong" : ""}`;
    const textData = [];
    if (showCounts) {
      for (const item of model.components) {
        const index = indexByName.get(item.name) ?? 0;
        textData.push({
          id: `diag:${item.name}`,
          className: "nkp-seriation-count nkp-seriation-count-strong",
          x: gridX + index * CELL + CELL / 2,
          y: gridY + index * CELL + CELL / 2,
          text: String(item.k)
        });
      }
      for (const item of model.cells) {
        textData.push({
          id: `cell:${item.row}:${item.col}`,
          className: countClass(item.count),
          x: gridX + item.col * CELL + CELL / 2,
          y: gridY + item.row * CELL + CELL / 2,
          text: String(item.count)
        });
      }
    }
    for (const item of model.components) {
      const index = indexByName.get(item.name) ?? 0;
      textData.push({
        id: `row:${item.name}`,
        className: headerClass(item),
        x: LABEL_WIDTH - 4,
        y: gridY + index * CELL + CELL / 2,
        text: headerLabel(item),
        entityKey: `component:${item.name}`
      });
      textData.push({
        id: `col:${item.name}`,
        className: headerClass(item),
        x: gridX + index * CELL + CELL / 2,
        y: HEADER_HEIGHT - 4,
        transform: `rotate(-60 ${gridX + index * CELL + CELL / 2} ${HEADER_HEIGHT - 4})`,
        text: headerLabel(item),
        entityKey: `component:${item.name}`
      });
    }
    b.labelsGroup.selectAll("text").data(textData, (item) => item.id).join("text").attr("class", (item) => item.className).attr("x", (item) => item.x).attr("y", (item) => item.y).attr("transform", (item) => item.transform ?? null).attr("text-anchor", (item) => item.id.startsWith("row:") ? "end" : "middle").text((item) => item.text).each(function(item) {
      if (!item.id.startsWith("row:") && !item.id.startsWith("col:"))
        return;
      const axis = item.id.startsWith("row:") ? "row" : "col";
      const name = item.id.slice(4);
      let wrapper = this.parentElement;
      if (!wrapper?.classList.contains("nkp-seriation-label-anchor")) {
        wrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
        wrapper.classList.add("nkp-seriation-label-anchor");
        this.parentNode?.insertBefore(wrapper, this);
        wrapper.appendChild(this);
      }
      wrapper.setAttribute("data-header-axis", axis);
      wrapper.setAttribute("data-header-index", String(indexByName.get(name) ?? 0));
      wrapper.setAttribute("aria-label", `${axis === "row" ? "Row" : "Column"} label ${name}`);
    });
    b.labelsGroup.selectAll("g.nkp-seriation-label-anchor").filter(function() {
      return this.querySelector("text") === null;
    }).remove();
    cellSelection.on("mousemove", (event, item) => {
      const half = cellHalf(item.row, item.col);
      const focused = focusedCounterpart(item);
      if (pinnedMirrorHalf && half !== "diagonal" && half !== pinnedMirrorHalf) {
        hoverMirrorHalf = undefined;
      } else {
        hoverMirrorHalf = half === "diagonal" ? undefined : half;
      }
      applyMirrorClasses();
      applyHeaderBands(focused.row, focused.col);
      const rowName = componentByIndex.get(focused.row)?.name ?? "";
      const colName = componentByIndex.get(focused.col)?.name ?? "";
      showTooltip(event, [`${rowName} × ${colName}: ${focused.count} shared`, ...focused.forces]);
    }).on("focus", (event, item) => {
      const focused = focusedCounterpart(item);
      const rowName = componentByIndex.get(focused.row)?.name ?? "";
      const colName = componentByIndex.get(focused.col)?.name ?? "";
      showTooltip(event, [`${rowName} × ${colName}: ${focused.count} shared`, ...focused.forces]);
    }).on("mouseleave blur", clearHover).on("click", (_event, item) => {
      const half = cellHalf(item.row, item.col);
      const focused = focusedCounterpart(item);
      for (const key of focused.forceKeys)
        ctx.onToggle(`force:${key}`);
      if (half !== "diagonal" && (!pinnedMirrorHalf || half === pinnedMirrorHalf)) {
        pinnedMirrorHalf = half;
      }
      applyMirrorClasses();
    });
    diagonalSelection.on("mousemove", (event, item) => {
      const index = indexByName.get(item.name);
      applyHeaderBands(index, index);
      showTooltip(event, componentLines(item));
    }).on("focus", (event, item) => showTooltip(event, componentLines(item))).on("mouseleave blur", clearHover).on("click", (_event, item) => ctx.onToggle(`component:${item.name}`));
    const headerHandlers = (selection) => {
      selection.on("mousemove", (event, item) => {
        const index = indexByName.get(item.name);
        applyHeaderBands(index, index);
        showTooltip(event, componentLines(item));
      }).on("focus", (event, item) => showTooltip(event, componentLines(item))).on("mouseleave blur", clearHover).on("click", (_event, item) => ctx.onToggle(`component:${item.name}`));
    };
    headerHandlers(rowHeaders);
    headerHandlers(colHeaders);
    applyHeaderBands(undefined, undefined);
    applyMirrorClasses();
    applySelectionClasses();
  }
  function setSelection(selected, connected) {
    lastSelected = selected;
    lastConnected = connected;
    if (selected.size === 0) {
      pinnedMirrorHalf = undefined;
      hoverMirrorHalf = undefined;
    }
    applySelectionClasses();
    applyMirrorClasses();
  }
  function resetView() {
    if (!built)
      return;
    resetZoom(built.svg, built.zoom, d3);
  }
  return { update, setSelection, resetView, destroy };
}
function headerLabel(item) {
  const name = item.name.length > 24 ? `${item.name.slice(0, 23)}…` : item.name;
  return item.fissionCandidate ? `▲ ${name}` : name;
}
function headerClass(item) {
  return [
    "nkp-seriation-label",
    item.fissionCandidate ? "is-fission" : "",
    item.status === "proposed" ? "is-proposed" : "",
    item.focused ? "" : "is-faded"
  ].filter(Boolean).join(" ");
}

// src/landscape-geometry.ts
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function normalize(dx, dy) {
  const length = Math.hypot(dx, dy);
  if (length === 0)
    return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}
function centroid(points) {
  if (points.length === 0)
    return;
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}
function fmt(value) {
  const rounded = Number(value.toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
function curveToPath(from, curve) {
  return `M ${fmt(from.x)},${fmt(from.y)} C ${fmt(curve.c1.x)},${fmt(curve.c1.y)} ${fmt(curve.c2.x)},${fmt(curve.c2.y)} ${fmt(curve.end.x)},${fmt(curve.end.y)}`;
}
function cubicBetween(from, to, direction) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const lead = distance * 0.34;
  return {
    c1: { x: from.x + direction.x * lead, y: from.y + direction.y * lead },
    c2: { x: to.x - dx * 0.32, y: to.y - dy * 0.32 },
    end: to
  };
}
function branchGeometry(from, to, splitFraction = 0.6, tension = 1) {
  const targets = to.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const count = targets.length;
  if (count === 0)
    return { trunk: "", branches: [], width: 1 };
  const width = 1 + Math.sqrt(Math.max(0, count - 1)) * 0.9;
  if (count === 1) {
    const target = targets[0];
    const direction = normalize(target.x - from.x, target.y - from.y);
    const curve = cubicBetween(from, target, direction);
    const path = curveToPath(from, curve);
    return { trunk: path, branches: [path], width };
  }
  const center = centroid(targets) ?? from;
  const split = clamp(splitFraction, 0.05, 0.95);
  const rawSplitPoint = {
    x: from.x + (center.x - from.x) * split,
    y: from.y + (center.y - from.y) * split
  };
  const splitPoint = {
    x: from.x + (rawSplitPoint.x - from.x) * tension,
    y: from.y + (rawSplitPoint.y - from.y) * tension
  };
  const trunkDirection = normalize(splitPoint.x - from.x, splitPoint.y - from.y);
  const trunk = curveToPath(from, cubicBetween(from, splitPoint, trunkDirection));
  const branches = targets.map((target) => {
    const targetDx = target.x - splitPoint.x;
    const targetDy = target.y - splitPoint.y;
    const targetDistance = Math.hypot(targetDx, targetDy);
    const cp1Distance = Math.min(Math.max(10, targetDistance * 0.35), 32);
    const cp1 = {
      x: splitPoint.x + trunkDirection.x * cp1Distance,
      y: splitPoint.y + trunkDirection.y * cp1Distance
    };
    const cp2 = {
      x: target.x - targetDx * 0.3,
      y: target.y - targetDy * 0.3
    };
    return curveToPath(splitPoint, { c1: cp1, c2: cp2, end: target });
  });
  return { trunk, branches, width };
}
function overlap1d(a0, a1, b0, b1) {
  return Math.min(a1, b1) - Math.max(a0, b0);
}
function xOverlaps(a, b) {
  return overlap1d(a.x, a.x + a.width, b.x, b.x + b.width) > 0;
}
function nudgeLabels(boxes, maxShift = 12) {
  const limit = Math.max(0, maxShift);
  const shifts = boxes.map(() => 0);
  if (boxes.length < 2 || limit === 0)
    return shifts;
  const pairs = [];
  for (let i = 0;i < boxes.length; i += 1) {
    for (let j = i + 1;j < boxes.length; j += 1) {
      if (xOverlaps(boxes[i], boxes[j]))
        pairs.push([i, j]);
    }
  }
  if (pairs.length === 0)
    return shifts;
  for (let pass = 0;pass < 10; pass += 1) {
    let changed = false;
    for (const [i, j] of pairs) {
      const a = boxes[i];
      const b = boxes[j];
      const topA = a.y + shifts[i];
      const botA = topA + a.height;
      const topB = b.y + shifts[j];
      const botB = topB + b.height;
      const overlap = Math.max(0, Math.min(botA, botB) - Math.max(topA, topB));
      if (overlap <= 0)
        continue;
      const targetStep = overlap / 2 + 0.5;
      const canUp = shifts[i] + limit;
      const canDown = limit - shifts[j];
      const paired = Math.min(targetStep, canUp, canDown);
      if (paired > 0) {
        shifts[i] = shifts[i] - paired;
        shifts[j] = shifts[j] + paired;
        changed = true;
        continue;
      }
      if (canUp > 0) {
        const applied = Math.min(overlap + 0.5, canUp);
        shifts[i] = shifts[i] - applied;
        changed = changed || applied > 0;
      } else if (canDown > 0) {
        const applied = Math.min(overlap + 0.5, canDown);
        shifts[j] = shifts[j] + applied;
        changed = changed || applied > 0;
      }
    }
    if (!changed)
      break;
  }
  return shifts.map((value) => clamp(value, -limit, limit));
}
function latticePoint(column, row, cellSize) {
  return { x: column * cellSize, y: row * cellSize };
}
function tessellateNodes(nodes, options) {
  const cellSize = Math.max(Number.EPSILON, options.cellSize);
  const minDistance = Math.max(0, options.minDistance);
  const placed = [];
  const occupied = new Set;
  const key = (column, row) => `${column}:${row}`;
  const nearestAvailableCell = (baseColumn, baseRow) => {
    for (let radius = 0;; radius += 1) {
      for (let column = baseColumn - radius;column <= baseColumn + radius; column += 1) {
        for (let row = baseRow - radius;row <= baseRow + radius; row += 1) {
          if (Math.max(Math.abs(column - baseColumn), Math.abs(row - baseRow)) !== radius)
            continue;
          const cell = key(column, row);
          if (!occupied.has(cell))
            return cell;
        }
      }
    }
  };
  const radiusById = new Map(nodes.map((node) => [node.id, node.radius]));
  const radiusOf = (id) => radiusById.get(id) ?? minDistance / 2;
  const isClear = (point, id) => placed.every((other) => Math.hypot(point.x - other.x, point.y - other.y) + Number.EPSILON >= radiusOf(id) + radiusOf(other.id));
  const ordered = [...nodes].sort((left, right) => {
    const leftPinned = left.fx !== undefined && left.fy !== undefined;
    const rightPinned = right.fx !== undefined && right.fy !== undefined;
    return Number(rightPinned) - Number(leftPinned) || left.id.localeCompare(right.id);
  });
  for (const node of ordered) {
    const pinned = node.fx !== undefined && node.fy !== undefined;
    const anchor = pinned ? { x: node.fx, y: node.fy } : node;
    const baseColumn = Math.round(anchor.x / cellSize);
    const baseRow = Math.round(anchor.y / cellSize);
    if (pinned) {
      const cell = nearestAvailableCell(baseColumn, baseRow);
      occupied.add(cell);
      placed.push({ id: node.id, x: anchor.x, y: anchor.y, cell });
      continue;
    }
    let chosen;
    for (let radius = 0;chosen === undefined; radius += 1) {
      const candidates = [];
      for (let column = baseColumn - radius;column <= baseColumn + radius; column += 1) {
        for (let row = baseRow - radius;row <= baseRow + radius; row += 1) {
          if (Math.max(Math.abs(column - baseColumn), Math.abs(row - baseRow)) !== radius)
            continue;
          const point = latticePoint(column, row, cellSize);
          candidates.push({ column, row, point, cell: key(column, row) });
        }
      }
      candidates.sort((left, right) => Math.hypot(left.point.x - node.x, left.point.y - node.y) - Math.hypot(right.point.x - node.x, right.point.y - node.y) || left.column - right.column || left.row - right.row);
      const available = candidates.find((candidate) => !occupied.has(candidate.cell) && isClear(candidate.point, node.id));
      if (available)
        chosen = available;
    }
    occupied.add(chosen.cell);
    placed.push({ id: node.id, ...chosen.point, cell: chosen.cell });
  }
  return placed;
}
function insideBounds(point, bounds) {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}
function clipPolygonToBounds(points, bounds) {
  if (points.length < 3)
    return points.filter((point) => insideBounds(point, bounds));
  const edges = [
    {
      inside: (point) => point.x >= bounds.x,
      intersect: (from, to) => {
        const ratio = (bounds.x - from.x) / (to.x - from.x);
        return { x: bounds.x, y: from.y + (to.y - from.y) * ratio };
      }
    },
    {
      inside: (point) => point.x <= bounds.x + bounds.width,
      intersect: (from, to) => {
        const x = bounds.x + bounds.width;
        const ratio = (x - from.x) / (to.x - from.x);
        return { x, y: from.y + (to.y - from.y) * ratio };
      }
    },
    {
      inside: (point) => point.y >= bounds.y,
      intersect: (from, to) => {
        const ratio = (bounds.y - from.y) / (to.y - from.y);
        return { x: from.x + (to.x - from.x) * ratio, y: bounds.y };
      }
    },
    {
      inside: (point) => point.y <= bounds.y + bounds.height,
      intersect: (from, to) => {
        const y = bounds.y + bounds.height;
        const ratio = (y - from.y) / (to.y - from.y);
        return { x: from.x + (to.x - from.x) * ratio, y };
      }
    }
  ];
  let clipped = [...points];
  for (const edge of edges) {
    const input = clipped;
    clipped = [];
    for (let index = 0;index < input.length; index += 1) {
      const from = input[index];
      const to = input[(index + 1) % input.length];
      const fromInside = edge.inside(from);
      const toInside = edge.inside(to);
      if (fromInside && toInside)
        clipped.push(to);
      else if (fromInside)
        clipped.push(edge.intersect(from, to));
      else if (toInside)
        clipped.push(edge.intersect(from, to), to);
    }
    if (clipped.length === 0)
      break;
  }
  return clipped;
}
function projectLabelAnchor(point, bounds, preferredRegion = []) {
  if (insideBounds(point, bounds))
    return { ...point };
  const visibleRegion = clipPolygonToBounds(preferredRegion, bounds);
  if (visibleRegion.length > 0) {
    return centroid(visibleRegion) ?? { ...visibleRegion[0] };
  }
  return {
    x: clamp(point.x, bounds.x, bounds.x + bounds.width),
    y: clamp(point.y, bounds.y, bounds.y + bounds.height)
  };
}

// src/nkp-hypergraph.ts
function forceNodeId(force) {
  return `force:${force.key}`;
}
function buildNkpHypergraphModel(state, options = {}) {
  const { components, attractors, forces } = effectiveState(state);
  const sharedComponents = new Map(buildNkpGraphModel(state, { minCouplingStrength: 1 }).nodes.filter((node) => node.type === "component").map((node) => [node.id, node]));
  const visible = options.visibleForceIds;
  const isVisibleForce = (force) => visible === undefined || visible.has(force.key);
  const isVisibleComponent = (name) => options.visibleComponentNames === undefined || options.visibleComponentNames.has(name);
  const componentNames = new Set(components.map((component) => component.name));
  const attractorIds = new Set(attractors.map((attractor) => attractor.id));
  const componentForces = new Map;
  for (const force of forces) {
    for (const name of new Set(force.components)) {
      if (!componentNames.has(name))
        continue;
      componentForces.set(name, [...componentForces.get(name) ?? [], force]);
    }
  }
  const componentNodes = components.map((component) => {
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
      ...shared?.dominantAttractorId ? { dominantAttractorId: shared.dominantAttractorId } : {},
      tooltip: [component.name, component.description, `Status: ${component.status}`, `Forces: ${attached.length}`].join(`
`),
      focused,
      forceCount: attached.length,
      fissionCandidate: attached.length > (options.fissionThreshold ?? Number.POSITIVE_INFINITY)
    };
  });
  const componentFocus = new Map(componentNodes.map((item) => [item.label, item.focused]));
  const attractorNames = new Map(attractors.map((attractor) => [attractor.id, attractor.name]));
  const forceNodes = forces.map((force) => ({
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
      `Components: ${[...new Set(force.components)].join(", ")}`
    ].join(`
`),
    focused: isVisibleForce(force)
  }));
  const forceFocus = new Map(forceNodes.map((item) => [item.id, item.focused]));
  const edges = [];
  for (const force of forces) {
    for (const name of new Set(force.components)) {
      if (!componentNames.has(name))
        continue;
      const source = forceNodeId(force);
      edges.push({
        id: `membership:${force.key}:${name}`,
        source,
        target: `component:${name}`,
        attractorId: force.attractorId,
        focused: (forceFocus.get(source) ?? false) && (componentFocus.get(name) ?? false)
      });
    }
  }
  let nodes = [...forceNodes, ...componentNodes];
  let keptEdges = edges;
  if (options.focusComponent !== undefined) {
    const focusId = `component:${options.focusComponent}`;
    const focusForces = new Set(edges.filter((edge) => edge.target === focusId).map((edge) => edge.source));
    keptEdges = keptEdges.filter((edge) => focusForces.has(edge.source));
  }
  if (options.hideFiltered) {
    keptEdges = keptEdges.filter((edge) => edge.focused);
  }
  const linked = new Set(keptEdges.flatMap((edge) => [edge.source, edge.target]));
  nodes = nodes.filter((item) => linked.has(item.id));
  const keptForceNodes = nodes.filter((item) => item.type === "force");
  const groups = [];
  const colors = attractorColors(state);
  const orderedAttractorIds = [
    ...attractors.map((attractor) => attractor.id),
    ...[...new Set(forces.map((force) => force.attractorId))].filter((id) => !attractorIds.has(id)).sort()
  ];
  orderedAttractorIds.forEach((attractorId) => {
    const members = keptForceNodes.filter((item) => item.attractorId === attractorId);
    if (members.length === 0)
      return;
    const memberIds = new Set(members.map((item) => item.id));
    const componentNodeIds = [
      ...new Set(keptEdges.filter((edge) => memberIds.has(edge.source)).map((edge) => edge.target))
    ].sort();
    const attractor = attractors.find((item) => item.id === attractorId);
    groups.push({
      attractorId,
      name: attractor?.name ?? attractorId,
      tooltip: attractor ? [attractor.name, attractor.description, `Positive: ${attractor.positiveState}`, `Negative: ${attractor.negativeState}`, `Forces: ${members.length}`].join(`
`) : `${attractorId} (unknown attractor)`,
      color: colors.get(attractorId) ?? "var(--muted)",
      forceNodeIds: members.map((item) => item.id),
      componentNodeIds,
      focused: members.some((item) => item.focused)
    });
  });
  const componentVectors = new Map;
  for (const edge of keptEdges) {
    componentVectors.set(edge.target, [...componentVectors.get(edge.target) ?? [], edge.source]);
  }
  const vectorGroups = new Map;
  for (const [componentId, forceIds] of componentVectors) {
    const vectorKey = [...forceIds].sort().join("\x00");
    vectorGroups.set(vectorKey, [...vectorGroups.get(vectorKey) ?? [], componentId]);
  }
  const fusionGroups = [...vectorGroups.values()].filter((group) => group.length >= 2);
  const bundleMap = new Map;
  for (const edge of keptEdges) {
    const forceKey = edge.source.startsWith("force:") ? edge.source.slice("force:".length) : edge.source;
    const bundleId = `bundle:${edge.target}:${edge.attractorId}`;
    const existing = bundleMap.get(bundleId);
    if (existing) {
      existing.forceIds.push(forceKey);
      if (forceFocus.get(edge.source))
        existing.focused = true;
      continue;
    }
    bundleMap.set(bundleId, {
      id: bundleId,
      componentId: edge.target,
      attractorId: edge.attractorId,
      forceIds: [forceKey],
      focused: !!forceFocus.get(edge.source)
    });
  }
  const branchBundles = [...bundleMap.values()];
  return { nodes, edges: keptEdges, groups, branchBundles, fusionGroups };
}
function cross(origin, a, b) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}
function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = sorted.filter((point, index) => {
    const previous = sorted[index - 1];
    return previous === undefined || point.x !== previous.x || point.y !== previous.y;
  });
  if (unique.length <= 2)
    return unique;
  const turnsWrong = (chain, point) => {
    const a = chain[chain.length - 2];
    const b = chain[chain.length - 1];
    return a !== undefined && b !== undefined && cross(a, b, point) <= 0;
  };
  const lower = [];
  for (const point of unique) {
    while (turnsWrong(lower, point))
      lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of [...unique].reverse()) {
    while (turnsWrong(upper, point))
      upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function regionCorePath(points) {
  const hull = convexHull(points);
  const first = hull[0];
  if (first === undefined)
    return "";
  const fmt2 = (value) => value.toFixed(1);
  if (hull.length === 1) {
    return `M${fmt2(first.x - 0.5)},${fmt2(first.y)}L${fmt2(first.x + 0.5)},${fmt2(first.y)}Z`;
  }
  return `M${hull.map((point) => `${fmt2(point.x)},${fmt2(point.y)}`).join("L")}Z`;
}
function paddedRegionPath(points, padding) {
  const radius = Math.max(0, padding);
  if (points.length === 0)
    return "";
  const expanded = points.flatMap((point) => [
    { x: point.x - radius, y: point.y - radius },
    { x: point.x + radius, y: point.y - radius },
    { x: point.x + radius, y: point.y + radius },
    { x: point.x - radius, y: point.y + radius }
  ]);
  return regionCorePath(expanded);
}
function centroid2(points) {
  if (points.length === 0)
    return;
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}
var REGIONS_COMPONENT_MIN_DISTANCE = 60;
var CORE_ZONE_BASE_RADIUS = REGIONS_COMPONENT_MIN_DISTANCE;
var CORE_ZONE_RADIUS_PER_COMPONENT = REGIONS_COMPONENT_MIN_DISTANCE / 3;
function coreZoneRadius(componentCount) {
  const count = Math.max(1, componentCount);
  return CORE_ZONE_BASE_RADIUS + CORE_ZONE_RADIUS_PER_COMPONENT * Math.sqrt(12 * count - 3);
}
function clampToCore(point, center, radius) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius)
    return point;
  if (distance === 0)
    return { x: center.x + radius, y: center.y };
  const scale = radius / distance;
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}
function clampOutsideCore(point, center, radius) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius)
    return point;
  if (distance === 0)
    return { x: center.x + radius, y: center.y };
  const scale = radius / distance;
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}
function attractorCoreDistance(nodes, attractorId, center) {
  let min = Infinity;
  for (const node of nodes) {
    if (node.type !== "force" || node.attractorId !== attractorId)
      continue;
    const dx = (node.x ?? 0) - center.x;
    const dy = (node.y ?? 0) - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance < min)
      min = distance;
  }
  return min;
}
function attractorGroupCircles(nodes, padding) {
  const byAttractor = new Map;
  for (const node of nodes) {
    if (node.type !== "force" || node.attractorId === undefined)
      continue;
    const points = byAttractor.get(node.attractorId) ?? [];
    points.push({ x: node.x ?? 0, y: node.y ?? 0 });
    byAttractor.set(node.attractorId, points);
  }
  const circles = [];
  for (const [attractorId, points] of byAttractor) {
    const center = centroid2(points) ?? { x: 0, y: 0 };
    const farthest = points.reduce((max, point) => Math.max(max, Math.hypot(point.x - center.x, point.y - center.y)), 0);
    circles.push({ attractorId, center, radius: farthest + padding });
  }
  return circles;
}
var ATTRACTOR_COHESION_STRENGTH = 0.1;
var INITIAL_SETTLE_TICKS = 50;
var KEEP_SIMULATING_ALPHA_TARGET = 0.05;
function createAttractorCohesionForce(strength = ATTRACTOR_COHESION_STRENGTH) {
  let nodes = [];
  const force = (alpha) => {
    const sums = new Map;
    for (const node of nodes) {
      if (node.type !== "force")
        continue;
      const sum = sums.get(node.attractorId) ?? { x: 0, y: 0, n: 0 };
      sum.x += node.x ?? 0;
      sum.y += node.y ?? 0;
      sum.n += 1;
      sums.set(node.attractorId, sum);
    }
    for (const node of nodes) {
      if (node.type !== "force" || node.fx != null)
        continue;
      const sum = sums.get(node.attractorId);
      if (!sum || sum.n < 2)
        continue;
      const pull = strength * alpha;
      node.vx = (node.vx ?? 0) + (sum.x / sum.n - (node.x ?? 0)) * pull;
      node.vy = (node.vy ?? 0) + (sum.y / sum.n - (node.y ?? 0)) * pull;
    }
  };
  force.initialize = (next) => {
    nodes = next;
  };
  return force;
}
var REGION_PADDING = 22;
var SPAWN_CORE_CLEARANCE = REGIONS_COMPONENT_MIN_DISTANCE * 2.5;
var FUSION_REGION_PADDING = 18;
var DEFAULT_CANVAS_WIDTH = 800;
var DEFAULT_CANVAS_HEIGHT = 600;
var REGIONS_LATTICE_CELL_SIZE = 48;
var REGIONS_MIN_NODE_DISTANCE = REGIONS_COMPONENT_MIN_DISTANCE;
var REGIONS_COMPONENT_COLLISION_RADIUS = REGIONS_COMPONENT_MIN_DISTANCE / 2;
var REGIONS_FORCE_COLLISION_RADIUS = REGIONS_COMPONENT_COLLISION_RADIUS;
var FORCE_NODE_SCALE = 1.3;
var FORCE_DIAMOND_HALF_DIAGONAL = 5 * FORCE_NODE_SCALE;
var FORCE_CIRCLE_RADIUS = 4 * FORCE_NODE_SCALE;
function forceNodeOpacity(kind) {
  return kind === "purpose" ? 0.75 : 1;
}
function forceGlyphPath(kind) {
  if (kind === "stressor") {
    const h = FORCE_DIAMOND_HALF_DIAGONAL;
    return `M0,-${h}L${h},0L0,${h}L-${h},0Z`;
  }
  const r = FORCE_CIRCLE_RADIUS;
  return `M-${r},0a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 -${r * 2},0`;
}
var FORCE_INTERACTION_DISTANCE_MAX = 220;
var FORCE_INTERACTION_PURPOSE_STRENGTH = 42;
var FORCE_INTERACTION_STRESSOR_STRENGTH = 16;
function forceInteractionDelta(source, target, params) {
  const zero = { vx: 0, vy: 0 };
  const targetIsComponent = target.type === "component" || target.id?.startsWith("component:") === true;
  const targetIsForce = target.type === "force" || target.id?.startsWith("force:") === true;
  const directlyConnected = target.id !== undefined && (source.componentIds ?? []).includes(target.id);
  const interacts = source.kind === "stressor" ? targetIsForce && source.attractorId !== undefined && target.attractorId === source.attractorId || targetIsComponent && directlyConnected : targetIsForce && source.attractorId !== undefined && target.attractorId !== undefined && target.attractorId !== source.attractorId || targetIsComponent && !directlyConnected;
  if (!interacts)
    return zero;
  const dx = (target.x ?? 0) - (source.x ?? 0);
  const dy = (target.y ?? 0) - (source.y ?? 0);
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || distance >= params.distanceMax)
    return zero;
  const falloff = 1 - distance / params.distanceMax;
  const isPurpose = source.kind === "purpose";
  const strength = (isPurpose ? FORCE_INTERACTION_PURPOSE_STRENGTH : FORCE_INTERACTION_STRESSOR_STRENGTH) * falloff;
  const sign = isPurpose ? 1 : -1;
  return { vx: dx / distance * strength * sign, vy: dy / distance * strength * sign };
}
function createForceInteractionForce(distanceMax = FORCE_INTERACTION_DISTANCE_MAX) {
  let interactionNodes = [];
  const force = (alpha) => {
    for (const target of interactionNodes) {
      if (target.fx != null)
        continue;
      let dvx = 0;
      let dvy = 0;
      for (const source of interactionNodes) {
        if (source.type !== "force")
          continue;
        if (source === target)
          continue;
        const delta = forceInteractionDelta(source, target, { distanceMax });
        dvx += delta.vx;
        dvy += delta.vy;
      }
      target.vx = (target.vx ?? 0) + dvx * alpha;
      target.vy = (target.vy ?? 0) + dvy * alpha;
    }
  };
  force.initialize = (nodes) => {
    interactionNodes = nodes;
  };
  return force;
}
function createRegionCollisionForce(padding = REGION_PADDING) {
  let collideNodes = [];
  const force = (alpha) => {
    const circles = attractorGroupCircles(collideNodes, padding);
    for (let i = 0;i < circles.length; i += 1) {
      for (let j = i + 1;j < circles.length; j += 1) {
        const a = circles[i];
        const b = circles[j];
        const dx = b.center.x - a.center.x;
        const dy = b.center.y - a.center.y;
        const distance = Math.hypot(dx, dy);
        const minDistance = a.radius + b.radius;
        if (distance >= minDistance)
          continue;
        const overlap = minDistance - distance;
        const safeDistance = distance || 0.01;
        const ux = dx / safeDistance;
        const uy = dy / safeDistance;
        const push = overlap * 0.5 * alpha;
        for (const node of collideNodes) {
          if (node.type !== "force" || node.fx != null)
            continue;
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
  force.initialize = (nextNodes) => {
    collideNodes = nextNodes;
  };
  return force;
}
function translateGroup(nodes, attractorId, dx, dy) {
  for (const node of nodes) {
    if (node.attractorId !== attractorId)
      continue;
    node.x = (node.x ?? 0) + dx;
    node.y = (node.y ?? 0) + dy;
  }
}
function captureRegionLock(nodes, attractorId) {
  const members = nodes.filter((node) => node.type === "force" && node.attractorId === attractorId);
  const points = members.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0 }));
  const anchor = centroid2(points);
  if (anchor === undefined)
    return;
  return {
    attractorId,
    anchor,
    offsets: new Map(members.map((node) => [node.id, {
      x: (node.x ?? 0) - anchor.x,
      y: (node.y ?? 0) - anchor.y
    }]))
  };
}
function applyRegionLock(lock, nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const [id, offset] of lock.offsets) {
    const node = byId.get(id);
    if (node === undefined || node.type !== "force")
      continue;
    node.x = lock.anchor.x + offset.x;
    node.y = lock.anchor.y + offset.y;
  }
}
function moveRegionLock(lock, anchor) {
  return { ...lock, anchor: { ...anchor }, offsets: new Map(lock.offsets) };
}
function editRegionForceOffset(lock, forceId, point) {
  if (!lock.offsets.has(forceId))
    return { ...lock, offsets: new Map(lock.offsets) };
  const offsets = new Map(lock.offsets);
  offsets.set(forceId, { x: point.x - lock.anchor.x, y: point.y - lock.anchor.y });
  return { ...lock, offsets };
}
function createRegionsView(ctx) {
  const { host, d3 } = ctx;
  const lockState = ctx.lockState ?? { enabled: false, locks: new Map };
  let built;
  let nodes = [];
  let byId = new Map;
  let links = [];
  let bundles = [];
  let currentTransform = d3.zoomIdentity;
  let regionSel;
  let fusionSel;
  let bundleGroupSel;
  let bundleTrunkSel;
  let bundleBranchSel;
  let nodeSel;
  let componentLabelSel;
  let forceLabelSel;
  let regionLabelSel;
  let lastSelected = new Set;
  let lastConnected = new Set;
  let lastState;
  let keepSimulating = false;
  let lockComponents = false;
  let hoveredNode;
  let hoveredAttractorId;
  let tickCount = 0;
  let labelShiftByKey = new Map;
  let groupColorById = new Map;
  let latticeTargets = new Map;
  const regionPinnedIds = new Set;
  const draggingNodeIds = new Set;
  const draggingRegionIds = new Set;
  const coreExclusionPinnedIds = new Set;
  let coreCenter = { x: DEFAULT_CANVAS_WIDTH / 2, y: DEFAULT_CANVAS_HEIGHT / 2 };
  let currentTension = 1;
  const latticeForce = (alpha) => {
    for (const node of nodes) {
      if (node.fx != null || node.fy != null)
        continue;
      const target = latticeTargets.get(node.id);
      if (!target)
        continue;
      const strength = node.type === "component" ? Math.min(0.08, 0.04 + alpha * 0.05) : Math.min(0.35, 0.18 + alpha * 0.2);
      node.vx = (node.vx ?? 0) + (target.x - (node.x ?? 0)) * strength * alpha;
      node.vy = (node.vy ?? 0) + (target.y - (node.y ?? 0)) * strength * alpha;
    }
  };
  latticeForce.initialize = () => {};
  const coreContainmentForce = () => {
    const componentCount = nodes.filter((node) => node.type === "component").length;
    const radius = coreZoneRadius(componentCount);
    for (const node of nodes) {
      if (node.type !== "component" || node.fx != null)
        continue;
      const beforeX = node.x ?? 0;
      const beforeY = node.y ?? 0;
      const clamped = clampToCore({ x: beforeX, y: beforeY }, coreCenter, radius);
      if (clamped.x === beforeX && clamped.y === beforeY)
        continue;
      node.x = clamped.x;
      node.y = clamped.y;
      node.vx = 0;
      node.vy = 0;
    }
  };
  coreContainmentForce.initialize = () => {};
  const syncComponentLocks = () => {
    for (const node of nodes) {
      if (node.type !== "component")
        continue;
      if (draggingNodeIds.has(node.id))
        continue;
      if (lockComponents) {
        node.fx = node.x;
        node.fy = node.y;
      } else {
        node.fx = null;
        node.fy = null;
      }
    }
  };
  const coreExclusionForce = () => {
    if (lockState.enabled)
      return;
    const componentCount = nodes.filter((node) => node.type === "component").length;
    const radius = coreZoneRadius(componentCount);
    const attractorIds = [...new Set(nodes.filter((node) => node.type === "force").map((node) => node.attractorId))];
    const distanceByAttractor = new Map(attractorIds.map((id) => [id, attractorCoreDistance(nodes, id, coreCenter)]));
    for (const attractorId of attractorIds) {
      if (draggingRegionIds.has(attractorId))
        continue;
      const distance = distanceByAttractor.get(attractorId) ?? Infinity;
      const inContact = distance <= radius + 0.5;
      const freeze = inContact;
      for (const node of nodes) {
        if (node.type !== "force" || node.attractorId !== attractorId)
          continue;
        if (draggingNodeIds.has(node.id))
          continue;
        if (inContact) {
          const clamped = clampOutsideCore({ x: node.x ?? 0, y: node.y ?? 0 }, coreCenter, radius);
          node.x = clamped.x;
          node.y = clamped.y;
          if (freeze) {
            node.fx = clamped.x;
            node.fy = clamped.y;
            node.vx = 0;
            node.vy = 0;
            coreExclusionPinnedIds.add(node.id);
          }
        } else if (coreExclusionPinnedIds.has(node.id)) {
          node.fx = null;
          node.fy = null;
          coreExclusionPinnedIds.delete(node.id);
        }
      }
    }
  };
  coreExclusionForce.initialize = () => {};
  function deterministicOffset(id) {
    let hash = 2166136261;
    for (let index = 0;index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const angle = (hash >>> 0) / 4294967295 * Math.PI * 2;
    const radius = 8 + (hash >>> 8 & 15);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }
  function refreshLatticeTargets(snapIds = new Set) {
    const componentCount = nodes.filter((node) => node.type === "component").length;
    const radius = coreZoneRadius(componentCount);
    const placed = tessellateNodes(nodes.map((node) => ({
      id: node.id,
      x: node.x ?? 0,
      y: node.y ?? 0,
      radius: node.type === "component" ? REGIONS_COMPONENT_COLLISION_RADIUS : REGIONS_FORCE_COLLISION_RADIUS,
      ...snapIds.has(node.id) ? {} : { fx: node.x ?? 0, fy: node.y ?? 0 }
    })), {
      cellSize: REGIONS_LATTICE_CELL_SIZE,
      minDistance: REGIONS_MIN_NODE_DISTANCE
    });
    latticeTargets = new Map(placed.map((item) => [item.id, { x: item.x, y: item.y }]));
    for (const node of nodes) {
      if (!snapIds.has(node.id))
        continue;
      const point = latticeTargets.get(node.id);
      if (!point)
        continue;
      node.x = point.x;
      node.y = point.y;
      if (node.type === "component") {
        const clamped = clampToCore({ x: node.x, y: node.y }, coreCenter, radius);
        node.x = clamped.x;
        node.y = clamped.y;
      } else if (node.type === "force") {
        const clamped = clampOutsideCore({ x: node.x, y: node.y }, coreCenter, radius);
        node.x = clamped.x;
        node.y = clamped.y;
      }
      node.vx = 0;
      node.vy = 0;
    }
  }
  function pinLockedMembers(lock) {
    applyRegionLock(lock, nodes);
    for (const node of nodes) {
      if (node.type !== "force" || node.attractorId !== lock.attractorId || !lock.offsets.has(node.id))
        continue;
      node.fx = node.x;
      node.fy = node.y;
      regionPinnedIds.add(node.id);
    }
  }
  function includeNewLockMembers(lock) {
    let next = lock;
    const additions = nodes.filter((node) => node.type === "force" && node.attractorId === lock.attractorId && !lock.offsets.has(node.id)).sort((left, right) => left.id.localeCompare(right.id));
    for (const node of additions) {
      const offset = deterministicOffset(node.id);
      node.x = next.anchor.x + offset.x;
      node.y = next.anchor.y + offset.y;
      refreshLatticeTargets(new Set([node.id]));
      next = {
        ...next,
        offsets: new Map(next.offsets).set(node.id, {
          x: (node.x ?? 0) - next.anchor.x,
          y: (node.y ?? 0) - next.anchor.y
        })
      };
    }
    return next;
  }
  function syncRegionLocks(groups, enabled) {
    const wasEnabled = lockState.enabled;
    lockState.enabled = enabled;
    if (!enabled) {
      for (const id of regionPinnedIds) {
        if (draggingNodeIds.has(id))
          continue;
        const node = byId.get(id);
        if (node?.type === "force" && draggingRegionIds.has(node.attractorId))
          continue;
        if (node) {
          node.fx = null;
          node.fy = null;
        }
      }
      regionPinnedIds.clear();
      if (wasEnabled)
        lockState.locks.clear();
      return;
    }
    for (const group of groups) {
      let lock = lockState.locks.get(group.attractorId) ?? captureRegionLock(nodes, group.attractorId);
      if (!lock)
        continue;
      applyRegionLock(lock, nodes);
      lock = includeNewLockMembers(lock);
      lockState.locks.set(group.attractorId, lock);
      pinLockedMembers(lock);
    }
    refreshLatticeTargets();
  }
  function colorFor(attractorId) {
    return groupColorById.get(attractorId) ?? "var(--muted)";
  }
  function canvasSize() {
    return {
      width: host.clientWidth > 0 ? host.clientWidth : DEFAULT_CANVAS_WIDTH,
      height: host.clientHeight > 0 ? host.clientHeight : DEFAULT_CANVAS_HEIGHT
    };
  }
  function pointsOfGroup(group) {
    return group.forceNodeIds.map((id) => byId.get(id)).filter((item) => item !== undefined).map((item) => ({ x: item.x ?? 0, y: item.y ?? 0 }));
  }
  function fitToContent() {
    if (!built || nodes.length === 0)
      return;
    const margin = 80;
    const xs = nodes.map((node) => node.x ?? 0);
    const ys = nodes.map((node) => node.y ?? 0);
    const minX = Math.min(...xs) - margin;
    const maxX = Math.max(...xs) + margin;
    const minY = Math.min(...ys) - margin;
    const maxY = Math.max(...ys) + margin;
    const scale = Math.min(8, Math.max(0.5, Math.min(built.width / Math.max(1, maxX - minX), built.height / Math.max(1, maxY - minY))));
    const transform = d3.zoomIdentity.translate(built.width / 2 - scale * ((minX + maxX) / 2), built.height / 2 - scale * ((minY + maxY) / 2)).scale(scale);
    built.svg.transition().duration(400).call(built.zoom.transform, transform);
  }
  function positionRegions() {
    regionSel?.select("path").attr("d", (group) => regionCorePath(pointsOfGroup(group)));
  }
  function positionFusionHulls() {
    fusionSel?.attr("d", (item) => paddedRegionPath(item.ids.map((id) => {
      const node = byId.get(id);
      return { x: node?.x ?? 0, y: node?.y ?? 0 };
    }), FUSION_REGION_PADDING));
  }
  function positionEdges() {
    const geometryByBundle = new Map;
    for (const bundle of bundles) {
      const component = byId.get(bundle.componentId);
      if (!component)
        continue;
      const placed = bundle.forceIds.map((forceId) => ({ forceId, node: byId.get(`force:${forceId}`) })).filter((item) => item.node !== undefined);
      const geometry = branchGeometry({ x: component.x ?? 0, y: component.y ?? 0 }, placed.map(({ node }) => ({ x: node.x ?? 0, y: node.y ?? 0 })), undefined, currentTension);
      geometryByBundle.set(bundle.id, {
        trunk: geometry.trunk,
        width: geometry.width,
        branchByForce: new Map(placed.map(({ forceId }, index) => [`force:${forceId}`, geometry.branches[index] ?? ""]))
      });
    }
    bundleTrunkSel?.attr("d", (bundle) => geometryByBundle.get(bundle.id)?.trunk ?? "").attr("stroke-width", (bundle) => geometryByBundle.get(bundle.id)?.width ?? 1);
    bundleBranchSel?.attr("d", (branch) => geometryByBundle.get(branch.bundleId)?.branchByForce.get(branch.forceId) ?? "").attr("stroke-width", (branch) => Math.max(1, (geometryByBundle.get(branch.bundleId)?.width ?? 1) * 0.62));
  }
  function positionNodes() {
    nodeSel?.attr("transform", (node) => `translate(${node.x ?? 0},${node.y ?? 0})`);
  }
  function measureLabelBox(element, x, y, text) {
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
      height: fallbackHeight
    };
  }
  function recomputeLabelNudges(force) {
    if (!force && tickCount % 5 !== 0)
      return;
    const keyed = [];
    componentLabelSel?.each(function(node) {
      keyed.push({
        key: node.id,
        x: node.x ?? 0,
        y: (node.y ?? 0) + (node.type === "component" && node.fissionCandidate ? -19 : -13),
        text: node.label ?? "",
        element: this
      });
    });
    forceLabelSel?.each(function(node) {
      keyed.push({
        key: node.id,
        x: node.x ?? 0,
        y: (node.y ?? 0) - 9,
        text: node.label ?? "",
        element: this
      });
    });
    regionLabelSel?.each(function(group) {
      const points = pointsOfGroup(group);
      const center = centroid2(points);
      if (!center)
        return;
      const top = Math.min(...points.map((point) => point.y));
      keyed.push({
        key: `attractor:${group.attractorId}`,
        x: center.x,
        y: top - REGION_PADDING - 4,
        text: group.name,
        element: this
      });
    });
    const boxes = keyed.map((item) => measureLabelBox(item.element, item.x, item.y, item.text));
    const shifts = nudgeLabels(boxes);
    labelShiftByKey = new Map(keyed.map((item, index) => [item.key, shifts[index] ?? 0]));
  }
  function positionLabels() {
    if (!built)
      return;
    const screenLeft = 8;
    const screenTop = 8;
    const screenRight = Math.max(screenLeft, built.width - 8);
    const screenBottom = Math.max(screenTop, built.height - 8);
    const left = currentTransform.invertX(screenLeft);
    const top = currentTransform.invertY(screenTop);
    const right = currentTransform.invertX(screenRight);
    const bottom = currentTransform.invertY(screenBottom);
    const bounds = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    componentLabelSel?.attr("x", (node) => projectLabelAnchor({ x: node.x ?? 0, y: (node.y ?? 0) + (node.type === "component" && node.fissionCandidate ? -19 : -13) }, bounds).x).attr("y", (node) => projectLabelAnchor({ x: node.x ?? 0, y: (node.y ?? 0) + (node.type === "component" && node.fissionCandidate ? -19 : -13) }, bounds).y);
    forceLabelSel?.attr("x", (node) => projectLabelAnchor({ x: node.x ?? 0, y: (node.y ?? 0) - 9 }, bounds).x).attr("y", (node) => projectLabelAnchor({ x: node.x ?? 0, y: (node.y ?? 0) - 9 }, bounds).y);
    regionLabelSel?.each(function(group) {
      const points = pointsOfGroup(group);
      const center = centroid2(points);
      if (!center)
        return;
      const top2 = Math.min(...points.map((point) => point.y));
      const preferredRegion = convexHull(points);
      const anchor = projectLabelAnchor({ x: center.x, y: top2 - REGION_PADDING - 4 }, bounds, preferredRegion.length >= 3 ? preferredRegion : []);
      d3.select(this).attr("x", anchor.x).attr("y", anchor.y);
    });
    tickCount += 1;
    recomputeLabelNudges(false);
    componentLabelSel?.attr("y", (node) => {
      const base = projectLabelAnchor({ x: node.x ?? 0, y: (node.y ?? 0) + (node.type === "component" && node.fissionCandidate ? -19 : -13) }, bounds);
      return projectLabelAnchor({ x: base.x, y: base.y + (labelShiftByKey.get(node.id) ?? 0) }, bounds).y;
    });
    forceLabelSel?.attr("y", (node) => {
      const base = projectLabelAnchor({ x: node.x ?? 0, y: (node.y ?? 0) - 9 }, bounds);
      return projectLabelAnchor({ x: base.x, y: base.y + (labelShiftByKey.get(node.id) ?? 0) }, bounds).y;
    });
    regionLabelSel?.attr("y", (group) => {
      const points = pointsOfGroup(group);
      const center = centroid2(points);
      if (!center)
        return -9999;
      const top2 = Math.min(...points.map((point) => point.y));
      const preferredRegion = convexHull(points);
      const anchor = projectLabelAnchor({ x: center.x, y: top2 - REGION_PADDING - 4 + (labelShiftByKey.get(`attractor:${group.attractorId}`) ?? 0) }, bounds, preferredRegion.length >= 3 ? preferredRegion : []);
      return anchor.y;
    });
  }
  function tick() {
    if (!built)
      return;
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
  function clampAllNodesToCoreZones() {
    const componentCount = nodes.filter((node) => node.type === "component").length;
    const radius = coreZoneRadius(componentCount);
    for (const node of nodes) {
      if (node.type === "component") {
        const clamped = clampToCore({ x: node.x ?? 0, y: node.y ?? 0 }, coreCenter, radius);
        node.x = clamped.x;
        node.y = clamped.y;
      } else if (node.type === "force") {
        const clamped = clampOutsideCore({ x: node.x ?? 0, y: node.y ?? 0 }, coreCenter, radius);
        node.x = clamped.x;
        node.y = clamped.y;
      }
      node.vx = 0;
      node.vy = 0;
    }
  }
  function applyKeepSimulatingTarget(sim) {
    if (keepSimulating) {
      sim.alphaTarget(KEEP_SIMULATING_ALPHA_TARGET).restart();
    } else {
      sim.alphaTarget(0);
    }
  }
  function ensureBuilt() {
    if (built)
      return built;
    const { width, height } = canvasSize();
    const { svg, content, zoom } = appendZoomableSvg(host, d3, { x: 0, y: 0, width, height }, "nkp-hyper", "Forces linked to the components they touch, grouped into attractor regions");
    const coreG = content.append("g").attr("class", "nkp-hyper-core");
    const coreBoundary = coreG.append("circle").attr("class", "nkp-hyper-core-boundary").attr("data-core-boundary", "true").attr("fill", "none").attr("stroke", "var(--muted)").attr("stroke-dasharray", "4 4");
    const coreBoundaryDivider = coreG.append("line").attr("class", "nkp-hyper-core-boundary-divider").attr("data-core-boundary-divider", "true").attr("stroke", "var(--muted)").attr("stroke-dasharray", "4 4");
    const regionsG = content.append("g").attr("class", "nkp-hyper-regions");
    const fusionG = content.append("g").attr("class", "nkp-hyper-fusion");
    const edgesG = content.append("g").attr("class", "nkp-hyper-edges");
    const nodesG = content.append("g").attr("class", "nkp-hyper-nodes");
    const labelsGroup = svg.append("g").attr("class", "landscape-labels");
    zoom.on("zoom.labels", (event) => {
      currentTransform = event.transform;
      labelsGroup.attr("transform", event.transform);
    });
    svg.on("dblclick", () => ctx.onClear());
    const sim = d3.forceSimulation([]).force("link", d3.forceLink([]).id((item) => item.id).distance(80).strength(0.45)).force("charge", d3.forceManyBody().strength((item) => item.type === "component" ? -1400 : -180)).force("x", d3.forceX(width / 2).strength(0.03)).force("y", d3.forceY(height / 2).strength(0.03)).force("collision", d3.forceCollide().radius((item) => item.type === "component" ? REGIONS_COMPONENT_COLLISION_RADIUS : REGIONS_FORCE_COLLISION_RADIUS).strength(0.9)).force("lattice", latticeForce).force("cohesion", createAttractorCohesionForce(ATTRACTOR_COHESION_STRENGTH)).force("interaction", createForceInteractionForce()).force("coreContainment", coreContainmentForce).force("coreExclusion", coreExclusionForce).force("regionCollision", createRegionCollisionForce()).on("tick", tick).on("end", () => {
      recomputeLabelNudges(true);
      positionLabels();
    }).stop();
    built = { svg, zoom, regionsG, fusionG, edgesG, nodesG, labelsGroup, coreBoundary, coreBoundaryDivider, sim, width, height, didFit: false, tip: createTooltip(host) };
    return built;
  }
  function attractorSpawnAngles(attractorIds) {
    const sorted = [...new Set(attractorIds)].sort();
    const count = sorted.length;
    const angles = new Map;
    for (let index = 0;index < count; index += 1) {
      angles.set(sorted[index], Math.PI * 2 * index / count);
    }
    return angles;
  }
  function seedPosition(item, placed, focusComponentId, componentCount, spawnAngles) {
    const offset = deterministicOffset(item.id);
    const radius = coreZoneRadius(componentCount);
    if (item.type === "force") {
      const siblings = [...placed.values()].filter((node) => node.type === "force" && node.attractorId === item.attractorId && node.x !== undefined);
      const siblingCenter = centroid2(siblings.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0 })));
      let base2;
      if (siblingCenter) {
        base2 = { x: siblingCenter.x + offset.x, y: siblingCenter.y + offset.y };
      } else {
        const angle = spawnAngles.get(item.attractorId) ?? 0;
        const spawnR = radius + SPAWN_CORE_CLEARANCE;
        base2 = { x: coreCenter.x + spawnR * Math.cos(angle), y: coreCenter.y + spawnR * Math.sin(angle) };
      }
      return clampOutsideCore(base2, coreCenter, radius);
    }
    const focus = focusComponentId ? placed.get(focusComponentId) : undefined;
    const base = focus?.x !== undefined ? { x: focus.x + offset.x, y: (focus.y ?? 0) + offset.y } : { x: coreCenter.x + offset.x, y: coreCenter.y + offset.y };
    return clampToCore(base, coreCenter, radius);
  }
  function applyNodeDrag(node, point) {
    const componentCount = nodes.filter((n) => n.type === "component").length;
    const radius = coreZoneRadius(componentCount);
    const clamped = node.type === "component" ? clampToCore(point, coreCenter, radius) : clampOutsideCore(point, coreCenter, radius);
    node.fx = clamped.x;
    node.fy = clamped.y;
    node.x = clamped.x;
    node.y = clamped.y;
    tick();
  }
  function dragNodeTo(nodeId, point) {
    const node = byId.get(nodeId);
    if (!node)
      return;
    applyNodeDrag(node, point);
  }
  function applySelectionClasses() {
    if (!built)
      return;
    const hasSelection = lastSelected.size > 0;
    built.svg.classed("nkp-hyper-selecting", hasSelection);
    const isSelected = (key) => lastSelected.has(key);
    const isConnected = (key) => !isSelected(key) && lastConnected.has(key);
    const dim = (key) => hasSelection && !isSelected(key) && !isConnected(key);
    const applyToKeyed = (selection) => {
      selection?.classed("selected", (node) => isSelected(node.id)).classed("connected", (node) => isConnected(node.id)).classed("dim", (node) => dim(node.id));
    };
    applyToKeyed(nodeSel);
    applyToKeyed(componentLabelSel);
    applyToKeyed(forceLabelSel);
    componentLabelSel?.attr("opacity", (node) => dim(node.id) ? 0 : 1);
    forceLabelSel?.attr("opacity", (node) => hasSelection && !dim(node.id) ? 1 : 0);
    const bundleLit = (bundle) => {
      if (!hasSelection)
        return true;
      const attractorKey = `attractor:${bundle.attractorId}`;
      const componentIn = isSelected(bundle.componentId) || isConnected(bundle.componentId);
      const attractorIn = isSelected(attractorKey) || isConnected(attractorKey);
      return componentIn && attractorIn;
    };
    bundleGroupSel?.classed("is-lit", (bundle) => bundleLit(bundle));
    const regionDim = (group) => {
      const key = `attractor:${group.attractorId}`;
      return hasSelection && !(isSelected(key) || isConnected(key));
    };
    regionSel?.classed("is-lit", (group) => !regionDim(group));
    regionLabelSel?.classed("is-lit", (group) => !regionDim(group)).attr("opacity", (group) => regionDim(group) ? 0 : group.focused ? 0.9 : 0.4);
  }
  function update(state, rawOptions = {}) {
    lastState = state;
    const options = rawOptions;
    keepSimulating = options.keepSimulating === true;
    lockComponents = options.lockComponents === true;
    const model = buildNkpHypergraphModel(state, options);
    if (model.nodes.length === 0) {
      if (!built) {
        renderEmpty(host, "No forces or components to draw. Loosen the filters or pick another focus component.");
        return;
      }
      const b2 = ensureBuilt();
      nodes = [];
      byId = new Map;
      links = [];
      bundles = [];
      {
        const { width: width2, height: height2 } = canvasSize();
        coreCenter = { x: width2 / 2, y: height2 / 2 };
      }
      {
        const emptyRadius = coreZoneRadius(0);
        b2.coreBoundary.attr("cx", coreCenter.x).attr("cy", coreCenter.y).attr("r", emptyRadius);
        b2.coreBoundaryDivider.attr("x1", coreCenter.x - emptyRadius).attr("x2", coreCenter.x + emptyRadius).attr("y1", coreCenter.y).attr("y2", coreCenter.y);
      }
      b2.sim.nodes([]);
      b2.sim.force("link").links([]);
      syncRegionLocks([], options.lockRegions === true);
      regionSel = b2.regionsG.selectAll("g.nkp-hyper-region").data([]).join("g");
      fusionSel = b2.fusionG.selectAll("path.nkp-hyper-fusion-hull").data([]).join("path");
      bundleGroupSel = b2.edgesG.selectAll("g.nkp-hyper-bundle").data([]).join("g");
      bundleTrunkSel = bundleGroupSel.selectAll("path.nkp-hyper-bundle-trunk");
      bundleBranchSel = bundleGroupSel.selectAll("path.nkp-hyper-bundle-branch");
      nodeSel = b2.nodesG.selectAll("g.nkp-node").data([]).join("g");
      componentLabelSel = b2.labelsGroup.selectAll("text.nkp-hyper-component-label").data([]).join("text");
      forceLabelSel = b2.labelsGroup.selectAll("text.nkp-hyper-force-label").data([]).join("text");
      regionLabelSel = b2.labelsGroup.selectAll("text.nkp-hyper-region-label").data([]).join("text");
      return;
    }
    if (host.querySelector(".landscape-empty"))
      host.replaceChildren();
    const b = ensureBuilt();
    const { width, height } = canvasSize();
    b.width = width;
    b.height = height;
    b.svg.attr("viewBox", `0 0 ${width} ${height}`);
    b.svg.classed("names-hidden", options.showNames === false);
    b.sim.force("x").x(width / 2);
    b.sim.force("y").y(height / 2);
    groupColorById = new Map(model.groups.map((group) => [group.attractorId, group.color]));
    const focusComponentId = options.focusComponent ? `component:${options.focusComponent}` : undefined;
    coreCenter = { x: width / 2, y: height / 2 };
    currentTension = options.tension ?? 1;
    const componentCount = model.nodes.filter((item) => item.type === "component").length;
    const coreRadius = coreZoneRadius(componentCount);
    b.coreBoundary.attr("cx", coreCenter.x).attr("cy", coreCenter.y).attr("r", coreRadius);
    b.coreBoundaryDivider.attr("x1", coreCenter.x - coreRadius).attr("x2", coreCenter.x + coreRadius).attr("y1", coreCenter.y).attr("y2", coreCenter.y);
    const prevById = byId;
    const nextById = new Map;
    const newcomerIds = new Set;
    const spawnAngles = attractorSpawnAngles(model.nodes.flatMap((item) => item.type === "force" ? [item.attractorId] : []));
    nodes = model.nodes.map((item) => {
      const existing = prevById.get(item.id);
      if (!existing)
        newcomerIds.add(item.id);
      const merged = existing ? { ...item, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy, fx: existing.fx ?? null, fy: existing.fy ?? null } : { ...item, ...seedPosition(item, nextById, focusComponentId, componentCount, spawnAngles), vx: 0, vy: 0 };
      nextById.set(item.id, merged);
      return merged;
    });
    byId = nextById;
    links = model.edges.map((edge) => ({ ...edge }));
    bundles = model.branchBundles.map((bundle) => ({ ...bundle }));
    refreshLatticeTargets(newcomerIds);
    b.sim.nodes(nodes);
    b.sim.force("link").links(links);
    syncRegionLocks(model.groups, options.lockRegions === true);
    syncComponentLocks();
    b.sim.alpha(0.3).restart();
    regionSel = b.regionsG.selectAll("g.nkp-hyper-region").data(model.groups, (group) => group.attractorId).join((enter) => {
      const g = enter.append("g").attr("class", "nkp-hyper-region");
      g.append("path");
      return g;
    });
    regionSel.attr("opacity", (group) => group.focused ? 0.16 : 0.07).attr("aria-label", (group) => group.tooltip).attr("tabindex", 0);
    regionSel.select("path").attr("fill", (group) => group.color).attr("stroke", (group) => group.color).attr("stroke-width", REGION_PADDING * 2).attr("stroke-linejoin", "round").attr("stroke-linecap", "round");
    regionSel.on("click", (_event, group) => ctx.onToggle(`attractor:${group.attractorId}`));
    regionSel.call(d3.drag().on("start", (event, group) => {
      if (!event.active)
        b.sim.alphaTarget(0.15).restart();
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
        if (node.type === "force" && node.attractorId === group.attractorId) {
          node.fx = node.x;
          node.fy = node.y;
        }
      }
    }).on("drag", (event, group) => {
      if (lockState.enabled) {
        const lock = lockState.locks.get(group.attractorId);
        if (!lock)
          return;
        const moved = moveRegionLock(lock, {
          x: lock.anchor.x + event.dx,
          y: lock.anchor.y + event.dy
        });
        lockState.locks.set(group.attractorId, moved);
        pinLockedMembers(moved);
        refreshLatticeTargets();
        tick();
        return;
      }
      translateGroup(nodes, group.attractorId, event.dx, event.dy);
      {
        const componentCount2 = nodes.filter((n) => n.type === "component").length;
        const radius = coreZoneRadius(componentCount2);
        for (const node of nodes) {
          if (node.type !== "force" || node.attractorId !== group.attractorId)
            continue;
          const clamped = clampOutsideCore({ x: node.x ?? 0, y: node.y ?? 0 }, coreCenter, radius);
          node.x = clamped.x;
          node.y = clamped.y;
          node.fx = clamped.x;
          node.fy = clamped.y;
        }
      }
      tick();
    }).on("end", (event, group) => {
      if (!event.active)
        applyKeepSimulatingTarget(b.sim);
      draggingRegionIds.delete(group.attractorId);
      const memberIds = new Set(nodes.filter((node) => node.type === "force" && node.attractorId === group.attractorId).map((node) => node.id));
      if (lockState.enabled) {
        refreshLatticeTargets();
        return;
      }
      refreshLatticeTargets(memberIds);
      for (const node of nodes) {
        if (node.type === "force" && node.attractorId === group.attractorId) {
          node.fx = null;
          node.fy = null;
        }
      }
    }));
    const fusionData = model.fusionGroups.map((ids) => ({ id: [...ids].sort().join("\x00"), ids }));
    fusionSel = b.fusionG.selectAll("path.nkp-hyper-fusion-hull").data(fusionData, (item) => item.id).join("path").attr("class", "nkp-hyper-fusion-hull").attr("data-fusion-region", "true").attr("role", "img").attr("aria-label", (item) => `Fusion candidate region for ${item.ids.join(", ")}`).attr("fill", "#808080").attr("fill-opacity", 0.14).attr("stroke", "var(--warn)").attr("stroke-width", 2).attr("stroke-dasharray", "3 4").attr("stroke-linejoin", "round");
    bundleGroupSel = b.edgesG.selectAll("g.nkp-hyper-bundle").data(bundles, (bundle) => bundle.id).join("g").attr("class", "nkp-hyper-bundle").attr("opacity", (bundle) => bundle.focused ? 0.45 : 0.15);
    bundleTrunkSel = bundleGroupSel.selectAll("path.nkp-hyper-bundle-trunk").data((bundle) => [bundle]).join("path").attr("class", "nkp-hyper-bundle-trunk").attr("fill", "none").attr("stroke", (bundle) => colorFor(bundle.attractorId)).attr("aria-label", (bundle) => `${bundle.componentId} linked to attractor ${bundle.attractorId}`);
    bundleBranchSel = bundleGroupSel.selectAll("path.nkp-hyper-bundle-branch").data((bundle) => bundle.forceIds.length > 1 ? bundle.forceIds.map((forceId) => ({
      id: `${bundle.id}:${forceId}`,
      bundleId: bundle.id,
      componentId: bundle.componentId,
      forceId: `force:${forceId}`,
      attractorId: bundle.attractorId,
      focused: bundle.focused
    })) : []).join("path").attr("class", "nkp-hyper-bundle-branch").attr("fill", "none").attr("stroke", (branch) => colorFor(branch.attractorId)).attr("aria-label", (branch) => `${branch.componentId} linked to ${branch.forceId}`);
    const nodeJoin = b.nodesG.selectAll("g.nkp-node").data(nodes, (node) => node.id).join((enter) => {
      const g = enter.append("g");
      g.append("circle").attr("class", "nkp-fission-ring").attr("r", 15).attr("fill", "none").attr("stroke-dasharray", "3 4");
      g.append("circle").attr("class", "nkp-node-dot nkp-component-status-glyph").attr("r", 9);
      g.append("rect").attr("class", "nkp-node-dot nkp-component-status-glyph").attr("x", -9).attr("y", -9).attr("width", 18).attr("height", 18);
      g.append("path").attr("class", "nkp-hyper-force-dot");
      return g;
    });
    nodeSel = nodeJoin.attr("class", (node) => `nkp-node nkp-hyper-node nkp-hyper-${node.type}`).attr("opacity", (node) => node.focused ? 1 : 0.45).attr("aria-label", (node) => node.tooltip).attr("tabindex", 0);
    nodeSel.select(".nkp-fission-ring").attr("display", (node) => node.type === "component" && node.fissionCandidate ? null : "none");
    nodeSel.select("circle.nkp-node-dot").attr("data-component-status-shape", (node) => node.type === "component" && node.shape === "circle" ? "actual" : null).attr("display", (node) => node.type === "component" && node.shape === "circle" ? null : "none").attr("fill", (node) => node.type === "component" ? node.color : null);
    nodeSel.select("rect.nkp-node-dot").attr("data-component-status-shape", (node) => node.type === "component" && node.shape === "square" ? "proposed" : null).attr("display", (node) => node.type === "component" && node.shape === "square" ? null : "none").attr("fill", (node) => node.type === "component" ? node.color : null);
    nodeSel.select(".nkp-hyper-force-dot").attr("d", (node) => node.type === "force" ? forceGlyphPath(node.kind) : null).attr("fill", (node) => node.type === "force" ? colorFor(node.attractorId) : null).attr("fill-opacity", (node) => node.type === "force" ? forceNodeOpacity(node.kind) : null).attr("data-force-kind-glyph", (node) => node.type === "force" ? node.kind : null).attr("display", (node) => node.type === "force" ? null : "none");
    nodeSel.on("click", (_event, node) => ctx.onToggle(node.id));
    nodeSel.call(d3.drag().on("start", (event, node) => {
      if (!event.active)
        b.sim.alphaTarget(0.3).restart();
      draggingNodeIds.add(node.id);
      node.fx = node.x;
      node.fy = node.y;
    }).on("drag", (event, node) => {
      applyNodeDrag(node, { x: event.x, y: event.y });
    }).on("end", (event, node) => {
      if (!event.active)
        applyKeepSimulatingTarget(b.sim);
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
      if (lockComponents && node.type === "component") {
        node.fx = node.x;
        node.fy = node.y;
        return;
      }
      node.fx = null;
      node.fy = null;
    }));
    const componentNodes = nodes.filter((node) => node.type === "component");
    componentLabelSel = b.labelsGroup.selectAll("text.nkp-hyper-component-label").data(componentNodes, (node) => node.id).join("text").attr("class", (node) => `nkp-hyper-component nkp-node-label nkp-hyper-component-label${node.type === "component" && node.fissionCandidate ? " fission" : ""}`).attr("text-anchor", "middle").text((node) => node.label);
    componentLabelSel.on("click", (_event, node) => ctx.onToggle(node.id));
    const forceNodes = nodes.filter((node) => node.type === "force");
    forceLabelSel = b.labelsGroup.selectAll("text.nkp-hyper-force-label").data(forceNodes, (node) => node.id).join("text").attr("class", "nkp-hyper-force nkp-node-label nkp-hyper-force-label").attr("text-anchor", "middle").attr("opacity", 0).text((node) => node.label);
    forceLabelSel.on("click", (_event, node) => ctx.onToggle(node.id));
    regionLabelSel = b.labelsGroup.selectAll("text.nkp-hyper-region-label").data(model.groups, (group) => group.attractorId).join("text").attr("class", "nkp-hyper-region-label").attr("text-anchor", "middle").attr("fill", (group) => group.color).attr("opacity", (group) => group.focused ? 0.9 : 0.4).text((group) => group.name);
    const clearHighlight = () => {
      hoveredNode = undefined;
      hoveredAttractorId = undefined;
      b.svg.classed("nkp-hyper-hovering", false);
      nodeSel.classed("is-lit", false);
      bundleGroupSel.classed("is-lit", false);
      regionSel.classed("is-lit", false);
      regionLabelSel.classed("is-lit", false);
      b.tip.hidden = true;
      applySelectionClasses();
    };
    const litAttractorsFrom = (lit) => {
      const ids = new Set;
      for (const key of lit) {
        if (key.startsWith("attractor:"))
          ids.add(key.slice("attractor:".length));
      }
      return ids;
    };
    const applyHoverLit = (lit) => {
      const litAttractors = litAttractorsFrom(lit);
      b.svg.classed("nkp-hyper-hovering", true);
      nodeSel.classed("is-lit", (other) => lit.has(other.id));
      bundleGroupSel.classed("is-lit", (bundle) => {
        const attractorKey = `attractor:${bundle.attractorId}`;
        return lit.has(bundle.componentId) && lit.has(attractorKey);
      });
      regionSel.classed("is-lit", (group) => litAttractors.has(group.attractorId));
      regionLabelSel.classed("is-lit", (group) => litAttractors.has(group.attractorId));
      componentLabelSel.attr("opacity", (other) => lit.has(other.id) ? 1 : 0);
      forceLabelSel.attr("opacity", (other) => lit.has(other.id) ? 1 : 0);
    };
    const highlightNode = (item) => {
      hoveredNode = item;
      hoveredAttractorId = undefined;
      const lit = lastState ? highlightConnectedKeys(lastState, [item.id]) : new Set([item.id]);
      applyHoverLit(lit);
    };
    const showNode = (event, item) => {
      highlightNode(item);
      b.tip.textContent = item.tooltip;
      placeTooltip(host, b.tip, event);
    };
    nodeSel.on("mouseenter", showNode).on("focus", showNode).on("mouseleave", clearHighlight).on("blur", clearHighlight);
    const highlightRegion = (group) => {
      hoveredNode = undefined;
      hoveredAttractorId = group.attractorId;
      const attractorKey = `attractor:${group.attractorId}`;
      const lit = lastState ? highlightConnectedKeys(lastState, [attractorKey]) : new Set([...group.forceNodeIds, ...group.componentNodeIds]);
      applyHoverLit(lit);
    };
    const showRegion = (event, group) => {
      highlightRegion(group);
      b.tip.textContent = group.tooltip;
      placeTooltip(host, b.tip, event);
    };
    regionSel.on("mouseenter.tooltip", showRegion).on("focus.tooltip", showRegion).on("mouseleave.tooltip", clearHighlight).on("blur.tooltip", clearHighlight);
    const needsSettle = !b.didFit || newcomerIds.size > 0;
    if (needsSettle) {
      b.sim.tick(INITIAL_SETTLE_TICKS);
      clampAllNodesToCoreZones();
    }
    tick();
    if (!b.didFit) {
      b.didFit = true;
      fitToContent();
    }
    applyKeepSimulatingTarget(b.sim);
    applySelectionClasses();
  }
  function setSelection(selected, connected) {
    lastSelected = selected;
    lastConnected = connected;
    applySelectionClasses();
    if (hoveredNode) {
      const lit = lastState ? highlightConnectedKeys(lastState, [hoveredNode.id]) : new Set([hoveredNode.id]);
      const litAttractors = new Set;
      for (const key of lit) {
        if (key.startsWith("attractor:"))
          litAttractors.add(key.slice("attractor:".length));
      }
      if (!built)
        return;
      built.svg.classed("nkp-hyper-hovering", true);
      nodeSel?.classed("is-lit", (other) => lit.has(other.id));
      bundleGroupSel?.classed("is-lit", (bundle) => {
        const attractorKey = `attractor:${bundle.attractorId}`;
        return lit.has(bundle.componentId) && lit.has(attractorKey);
      });
      regionSel?.classed("is-lit", (group) => litAttractors.has(group.attractorId));
      regionLabelSel?.classed("is-lit", (group) => litAttractors.has(group.attractorId));
      componentLabelSel?.attr("opacity", (other) => lit.has(other.id) ? 1 : 0);
      forceLabelSel?.attr("opacity", (other) => lit.has(other.id) ? 1 : 0);
    } else if (hoveredAttractorId) {
      const attractorKey = `attractor:${hoveredAttractorId}`;
      const lit = lastState ? highlightConnectedKeys(lastState, [attractorKey]) : new Set([attractorKey]);
      const litAttractors = new Set;
      for (const key of lit) {
        if (key.startsWith("attractor:"))
          litAttractors.add(key.slice("attractor:".length));
      }
      if (!built)
        return;
      built.svg.classed("nkp-hyper-hovering", true);
      nodeSel?.classed("is-lit", (other) => lit.has(other.id));
      bundleGroupSel?.classed("is-lit", (bundle) => {
        const key = `attractor:${bundle.attractorId}`;
        return lit.has(bundle.componentId) && lit.has(key);
      });
      regionSel?.classed("is-lit", (group) => litAttractors.has(group.attractorId));
      regionLabelSel?.classed("is-lit", (group) => litAttractors.has(group.attractorId));
      componentLabelSel?.attr("opacity", (other) => lit.has(other.id) ? 1 : 0);
      forceLabelSel?.attr("opacity", (other) => lit.has(other.id) ? 1 : 0);
    }
  }
  function resetView() {
    fitToContent();
  }
  function destroy() {
    built?.sim.stop();
    built = undefined;
    nodes = [];
    byId = new Map;
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
    }
  };
}

// src/landscape-sidebar.ts
function renderSidebar(el, details, handlers) {
  el.replaceChildren();
  const header = document.createElement("div");
  header.className = "landscape-sidebar-header";
  const count = document.createElement("span");
  count.className = "landscape-sidebar-count";
  count.textContent = `${details.length} selected`;
  const clearAll = document.createElement("button");
  clearAll.type = "button";
  clearAll.className = "landscape-sidebar-clear";
  clearAll.dataset.landscapeDeselectAll = "";
  clearAll.textContent = "deselect all";
  clearAll.addEventListener("click", () => handlers.onClearAll());
  header.append(count, clearAll);
  el.appendChild(header);
  if (details.length === 0) {
    const empty = document.createElement("p");
    empty.className = "landscape-sidebar-empty";
    empty.dataset.sidebarEmpty = "";
    empty.textContent = "Click a component, force or attractor in the landscape to see its details here.";
    el.appendChild(empty);
    return;
  }
  const activeIndex = Math.max(0, details.findIndex((detail2) => detail2.key === handlers.activeKey));
  const detail = details[activeIndex];
  const navigation = document.createElement("div");
  navigation.className = "landscape-sidebar-navigation";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.dataset.detailPrev = "";
  previous.setAttribute("aria-label", "Previous selected detail");
  previous.textContent = "←";
  previous.disabled = details.length === 1;
  previous.addEventListener("click", () => {
    handlers.onActivate(details[(activeIndex - 1 + details.length) % details.length].key);
  });
  const next = document.createElement("button");
  next.type = "button";
  next.dataset.detailNext = "";
  next.setAttribute("aria-label", "Next selected detail");
  next.textContent = "→";
  next.disabled = details.length === 1;
  next.addEventListener("click", () => {
    handlers.onActivate(details[(activeIndex + 1) % details.length].key);
  });
  navigation.append(previous, next);
  el.appendChild(navigation);
  const card = document.createElement("article");
  card.className = "landscape-sidebar-card";
  card.dataset.sidebarCard = "";
  card.dataset.key = detail.key;
  const cardHeader = document.createElement("div");
  cardHeader.className = "landscape-sidebar-card-header";
  if (detail.color) {
    const chip = document.createElement("i");
    chip.className = "landscape-sidebar-chip";
    chip.style.background = detail.color;
    cardHeader.appendChild(chip);
  }
  const kind = document.createElement("span");
  kind.className = "landscape-sidebar-kind";
  kind.textContent = detail.kind;
  const title = document.createElement("strong");
  title.className = "landscape-sidebar-title";
  title.textContent = detail.title;
  const deselect = document.createElement("button");
  deselect.type = "button";
  deselect.className = "landscape-sidebar-deselect";
  deselect.dataset.sidebarDeselect = "";
  deselect.setAttribute("aria-label", `Deselect ${detail.title}`);
  deselect.textContent = "×";
  deselect.addEventListener("click", () => handlers.onDeselect(detail.key));
  cardHeader.append(kind, title, deselect);
  card.appendChild(cardHeader);
  const fields = document.createElement("dl");
  fields.className = "landscape-sidebar-fields";
  for (const field of detail.fields) {
    const dt = document.createElement("dt");
    dt.textContent = field.label;
    const dd = document.createElement("dd");
    dd.textContent = field.value;
    fields.append(dt, dd);
  }
  card.appendChild(fields);
  el.appendChild(card);
}

// src/nkp-landscape.ts
var LANDSCAPE_VIEWS = ["bundle", "heatmap", "regions"];
var DEFAULT_LANDSCAPE_VIEW = "bundle";
function controlAppliesTo(forAttribute, view) {
  if (!forAttribute)
    return true;
  return forAttribute.split(/\s+/).includes(view);
}
function parseLandscapeView(value) {
  return LANDSCAPE_VIEWS.find((view) => view === value) ?? DEFAULT_LANDSCAPE_VIEW;
}
function readFilters(container) {
  const visibleForceIds = new Set(Array.from(container.querySelectorAll("table.matrix tbody tr.force-row")).filter((row) => !row.hidden).map((row) => row.getAttribute("data-force-id")).filter((id) => id !== null));
  const visibleComponentNames = new Set(Array.from(container.querySelectorAll("table.matrix thead [data-component]")).filter((element) => !element.hidden).map((element) => element.getAttribute("data-component")).filter((name) => name !== null));
  const threshold = container.querySelector("[data-threshold-input]");
  return { visibleForceIds, visibleComponentNames, fissionThreshold: Number(threshold?.value ?? 1) };
}
function syncMinCouplingStrength(container, state, filters) {
  const input = container.querySelector("[data-min-coupling-strength-input]");
  const output = container.querySelector("[data-min-coupling-strength-value]");
  if (!input)
    return DEFAULT_MIN_COUPLING_STRENGTH;
  const maxCount = buildNkpGraphModel(state, { ...filters, minCouplingStrength: 1 }).edges.reduce((max, edge) => edge.type === "attractor" ? max : Math.max(max, edge.count), 1);
  input.min = "1";
  input.max = String(maxCount);
  if (!input.value || Number(input.value) > maxCount) {
    input.value = String(Math.min(DEFAULT_MIN_COUPLING_STRENGTH, maxCount));
  }
  if (output)
    output.textContent = input.value;
  return Number(input.value);
}
function syncTopN(container, state, filters, minCouplingStrength) {
  const input = container.querySelector("[data-top-n-couplings-input]");
  const output = container.querySelector("[data-top-n-couplings-value]");
  const label = container.querySelector("[data-top-n-direction-label]");
  const weakest = container.querySelector("[data-top-n-weakest-toggle]");
  const topNDirection = weakest?.checked ? "weakest" : "strongest";
  if (label)
    label.textContent = topNDirection;
  if (!input)
    return { topNCouplings: undefined, topNDirection };
  const tiers = new Set(buildNkpGraphModel(state, { ...filters, minCouplingStrength }).edges.filter((edge) => edge.type === "coupling").map((edge) => edge.count)).size;
  const maxTiers = Math.max(1, tiers);
  input.min = "1";
  input.max = String(maxTiers);
  if (input.dataset.userSet !== "true" || Number(input.value) > maxTiers)
    input.value = String(maxTiers);
  if (output)
    output.textContent = input.value === String(maxTiers) ? "all" : input.value;
  const value = Number(input.value);
  return { topNCouplings: value >= maxTiers ? undefined : value, topNDirection };
}
function syncFocusOptions(select, state) {
  if (!select)
    return;
  const names = effectiveState(state).components.map((component) => component.name).sort();
  const current = select.value;
  const wanted = ["", ...names];
  const existing = Array.from(select.options).map((option) => option.value);
  if (existing.join("\x00") !== wanted.join("\x00")) {
    select.replaceChildren(...wanted.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name || "all components";
      return option;
    }));
  }
  select.value = names.includes(current) ? current : "";
  return select.value || undefined;
}
var CONTROL_SELECTOR = [
  "[data-force-filter]",
  "[data-show-proposed-toggle]",
  "[data-show-unrelated-toggle]",
  "[data-threshold-input]",
  "[data-fusion-fission-filter]",
  "[data-landscape-view-input]",
  "[data-hide-filtered-graph-toggle]",
  "[data-min-coupling-strength-input]",
  "[data-top-n-couplings-input]",
  "[data-top-n-weakest-toggle]",
  "[data-bundle-tension-input]",
  "[data-heatmap-counts-toggle]",
  "[data-regions-focus]",
  "[data-regions-names-toggle]",
  "[data-regions-lock-toggle]",
  "[data-regions-keep-simulating-toggle]"
].join(", ");
function fitViewportHeight(windowHeight, toolbarHeight, chrome, bottomPadding) {
  return Math.max(320, Math.floor(windowHeight - toolbarHeight - chrome - bottomPadding));
}
function mountLandscape(container, getState, d3) {
  const host = container.querySelector("[data-landscape]");
  const card = host?.closest("details") ?? null;
  const sidebarEl = container.querySelector("[data-landscape-sidebar]");
  const deselectAllButton = container.querySelector("[data-landscape-deselect-all]");
  const resetViewButton = container.querySelector("[data-landscape-reset-view]");
  let stale = true;
  let activeView;
  let viewHandle;
  let selected = new Set;
  let activeKey;
  const regionsLockState = { enabled: false, locks: new Map };
  const panelIsHidden = () => Boolean(card?.closest("[hidden]"));
  const currentView = () => parseLandscapeView(container.querySelector("[data-landscape-view-input]:checked")?.value);
  const toolbar = container.querySelector("[data-view-toolbar]");
  const fitViewport = () => {
    if (!host || !card?.open)
      return;
    const toolbarHeight = toolbar?.offsetHeight ?? 0;
    const chrome = host.getBoundingClientRect().top - card.getBoundingClientRect().top;
    card.style.scrollMarginTop = `${toolbarHeight + 8}px`;
    host.style.height = `${fitViewportHeight(window.innerHeight, toolbarHeight, chrome, 32)}px`;
  };
  const renderSidebarNow = () => {
    if (!sidebarEl)
      return;
    const state = getState();
    const details = [];
    for (const key of selected) {
      const detail = entityDetail(state, key);
      if (detail)
        details.push(detail);
    }
    sidebarEl.hidden = details.length === 0 || !card?.open || panelIsHidden();
    renderSidebar(sidebarEl, details, {
      activeKey,
      onActivate: (key) => {
        if (!selected.has(key))
          return;
        activeKey = key;
        renderSidebarNow();
      },
      onDeselect: (key) => applySelection(toggleSelection(selected, key)),
      onClearAll: clearSelection
    });
  };
  const applySelection = (next, activate) => {
    selected = next;
    if (activate && selected.has(activate))
      activeKey = activate;
    if (!activeKey || !selected.has(activeKey))
      activeKey = [...selected].at(-1);
    const state = getState();
    const connected = currentView() === "bundle" ? bundleHighlightConnectedKeys(state, selected) : highlightConnectedKeys(state, selected);
    viewHandle?.setSelection(selected, connected);
    renderSidebarNow();
  };
  const onEntityToggle = (key) => {
    const wasSelected = selected.has(key);
    applySelection(toggleSelection(selected, key), wasSelected ? undefined : key);
  };
  function clearSelection() {
    if (selected.size === 0)
      return;
    activeKey = undefined;
    applySelection(new Set);
  }
  const ensureViewHandle = (view, viewportHost) => {
    if (viewHandle && activeView === view)
      return viewHandle;
    viewHandle?.destroy();
    viewHandle = view === "bundle" ? createBundleView({ host: viewportHost, d3, onToggle: onEntityToggle, onClear: clearSelection }) : view === "heatmap" ? createHeatmapView({ host: viewportHost, d3, onToggle: onEntityToggle, onClear: clearSelection }) : createRegionsView({
      host: viewportHost,
      d3,
      onToggle: onEntityToggle,
      onClear: clearSelection,
      lockState: regionsLockState
    });
    activeView = view;
    return viewHandle;
  };
  const sync = () => {
    if (!host)
      return;
    const view = currentView();
    host.dataset.view = view;
    for (const control of Array.from(container.querySelectorAll("[data-landscape-for]"))) {
      control.hidden = !controlAppliesTo(control.getAttribute("data-landscape-for"), view);
    }
    if (card && (!card.open || panelIsHidden())) {
      stale = true;
      if (sidebarEl)
        sidebarEl.hidden = true;
      return;
    }
    stale = false;
    fitViewport();
    const state = getState();
    const filters = readFilters(container);
    const hideFiltered = container.querySelector("[data-hide-filtered-graph-toggle]")?.checked ?? true;
    const handle = ensureViewHandle(view, host);
    if (view === "regions") {
      const focusComponent = syncFocusOptions(container.querySelector("[data-regions-focus]"), state);
      const showNames = container.querySelector("[data-regions-names-toggle]")?.checked ?? true;
      const lockRegions = container.querySelector("[data-regions-lock-toggle]")?.checked ?? false;
      const lockComponents = container.querySelector("[data-regions-lock-components-toggle]")?.checked ?? false;
      const keepSimulating = container.querySelector("[data-regions-keep-simulating-toggle]")?.checked ?? false;
      const tensionInput = container.querySelector("[data-bundle-tension-input]");
      const tension = tensionInput ? Number(tensionInput.value) / 100 : DEFAULT_BUNDLE_TENSION;
      handle.update(state, { ...filters, hideFiltered, showNames, lockRegions, lockComponents, keepSimulating, tension, ...focusComponent ? { focusComponent } : {} });
    } else {
      const minCouplingStrength = syncMinCouplingStrength(container, state, filters);
      if (view === "heatmap") {
        const showCounts = container.querySelector("[data-heatmap-counts-toggle]")?.checked ?? true;
        handle.update(state, { ...filters, hideFiltered, minCouplingStrength, showCounts });
      } else {
        const { topNCouplings, topNDirection } = syncTopN(container, state, filters, minCouplingStrength);
        const tensionInput = container.querySelector("[data-bundle-tension-input]");
        const tension = tensionInput ? Number(tensionInput.value) / 100 : DEFAULT_BUNDLE_TENSION;
        handle.update(state, {
          ...filters,
          hideFiltered,
          minCouplingStrength,
          ...topNCouplings === undefined ? {} : { topNCouplings },
          topNDirection,
          tension
        });
      }
    }
    const connected = view === "bundle" ? bundleHighlightConnectedKeys(state, selected) : highlightConnectedKeys(state, selected);
    handle.setSelection(selected, connected);
    renderSidebarNow();
  };
  const onControl = (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(CONTROL_SELECTOR))
      return;
    if (target instanceof HTMLInputElement) {
      if (target.matches("[data-top-n-couplings-input]") && event.type === "input")
        target.dataset.userSet = "true";
      if (target.matches("[data-min-coupling-strength-input]")) {
        const output = container.querySelector("[data-min-coupling-strength-value]");
        if (output)
          output.textContent = target.value;
      }
    }
    queueMicrotask(sync);
  };
  const onCardToggle = () => {
    if (!card?.open || panelIsHidden()) {
      stale = true;
      if (sidebarEl)
        sidebarEl.hidden = true;
      return;
    }
    if (stale)
      sync();
    card.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const onPanelVisible = () => sync();
  const onHostDblClick = () => clearSelection();
  const onDeselectAllClick = () => clearSelection();
  const onResetViewClick = () => viewHandle?.resetView();
  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (currentView() === "regions")
        sync();
      else
        fitViewport();
    }, 200);
  };
  container.addEventListener("input", onControl);
  container.addEventListener("change", onControl);
  card?.addEventListener("toggle", onCardToggle);
  container.addEventListener("landscape-panel-visible", onPanelVisible);
  host?.addEventListener("dblclick", onHostDblClick);
  deselectAllButton?.addEventListener("click", onDeselectAllClick);
  resetViewButton?.addEventListener("click", onResetViewClick);
  window.addEventListener("resize", onResize);
  sync();
  return {
    sync,
    destroy: () => {
      viewHandle?.destroy();
      clearTimeout(resizeTimer);
      container.removeEventListener("input", onControl);
      container.removeEventListener("change", onControl);
      card?.removeEventListener("toggle", onCardToggle);
      container.removeEventListener("landscape-panel-visible", onPanelVisible);
      host?.removeEventListener("dblclick", onHostDblClick);
      deselectAllButton?.removeEventListener("click", onDeselectAllClick);
      resetViewButton?.removeEventListener("click", onResetViewClick);
      window.removeEventListener("resize", onResize);
      host?.replaceChildren();
    }
  };
}

// src/ledger-panels.ts
var NOOP_HANDLE = { destroy: () => {} };
function mountLedgerPanels(container) {
  const pageTabs = Array.from(container.querySelectorAll("[data-page-ledger-tab]"));
  const modifyTabs = Array.from(container.querySelectorAll("[data-modify-ledger-switch]"));
  const ledgerPanels = Array.from(container.querySelectorAll("[data-ledger-panel]"));
  const modifyPanels = Array.from(container.querySelectorAll("[data-modify-panel]"));
  if (pageTabs.length === 0 && modifyTabs.length === 0 && ledgerPanels.length === 0 && modifyPanels.length === 0) {
    return NOOP_HANDLE;
  }
  const initiallySelected = pageTabs.find((tab) => tab.getAttribute("aria-selected") === "true")?.dataset.pageLedgerTab;
  let active = initiallySelected === "defense" ? "defense" : "implementation";
  const update = (next) => {
    if (next !== "implementation" && next !== "defense")
      return;
    const changed = next !== active;
    active = next;
    for (const tab of pageTabs) {
      const selected = tab.dataset.pageLedgerTab === active;
      tab.setAttribute("aria-selected", String(selected));
      tab.classList.toggle("is-active", selected);
    }
    for (const tab of modifyTabs) {
      const selected = tab.dataset.modifyLedgerSwitch === active;
      tab.setAttribute("aria-selected", String(selected));
      tab.setAttribute("aria-pressed", String(selected));
      tab.classList.toggle("is-active", selected);
    }
    for (const panel of ledgerPanels) {
      panel.hidden = panel.dataset.ledgerPanel !== active;
    }
    for (const panel of modifyPanels) {
      panel.hidden = panel.dataset.modifyPanel !== active;
    }
    if (changed && active === "implementation") {
      const eventTarget = container.querySelector('[data-ledger-panel="implementation"]') ?? container;
      eventTarget.dispatchEvent(new CustomEvent("landscape-panel-visible", { bubbles: true }));
    }
  };
  const onClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element))
      return;
    const pageTab = target.closest("[data-page-ledger-tab]");
    if (pageTab && container.contains(pageTab)) {
      update(pageTab.dataset.pageLedgerTab);
      return;
    }
    const modifyTab = target.closest("[data-modify-ledger-switch]");
    if (modifyTab && container.contains(modifyTab)) {
      update(modifyTab.dataset.modifyLedgerSwitch);
    }
  };
  container.addEventListener("click", onClick);
  update(active);
  return {
    destroy: () => container.removeEventListener("click", onClick)
  };
}

// src/main.ts
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
var snapshotElement = document.getElementById("residual-snapshot");
var rawSnapshot = snapshotElement ? JSON.parse(snapshotElement.textContent ?? "{}") : { attractors: [], stressors: [], purposes: [], components: [], residues: [] };
var state = snapshotToPendingState(rawSnapshot);
var getState = () => state;
var setState = (next) => {
  state = next;
};
var container = document.body;
mountLedgerPanels(container);
var table = container.querySelector("table.matrix");
if (table) {
  const matrixView = mountMatrixView(container);
  const landscape = mountLandscape(container, getState, d3);
  const onChange = () => {
    regenerateStagedCommands(container, getState);
    matrixMount.syncNewRows();
    matrixView.recomputeFusionFission();
    landscape.sync();
  };
  const matrixMount = mount(table, getState, setState, { onChange });
  mountForms(container, getState, setState, {
    onChange,
    onClear: () => {
      matrixMount.resetDom();
      for (const form of Array.from(container.querySelectorAll("form")))
        form.reset();
      for (const toggle of Array.from(container.querySelectorAll("[data-show-proposed-toggle], [data-show-unrelated-toggle]"))) {
        toggle.checked = true;
      }
    }
  });
  mountImportModal(container, getState, setState, { onChange });
  mountExportScript(container, getState, { onChange });
  matrixView.recomputeFusionFission();
}
regenerateStagedCommands(container, getState);
