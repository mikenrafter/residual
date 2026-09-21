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
      setState(updateForceField(getState(), forceKey, field, el.value));
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
  function insertComponentColumn(name) {
    const table = container.querySelector("table.matrix");
    if (table === null)
      return;
    const headerRow = table.querySelector("thead tr");
    if (headerRow !== null) {
      const th = document.createElement("th");
      th.className = "sticky-row";
      th.setAttribute("data-component", name);
      th.textContent = name;
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
        insertComponentColumn(name);
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

// src/nkp-graph.ts
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
  return {
    width: 1 + count * 0.5,
    distance: Math.max(90, 200 - count * 14),
    strength: Math.min(0.28, 0.03 + count * 0.025)
  };
}
var LATTICE_SPACING = 78;
var LATTICE_ROW_HEIGHT = LATTICE_SPACING * (Math.sqrt(3) / 2);
function nearestHexLatticePoint(x, y, centerX, centerY) {
  const localX = x - centerX;
  const localY = y - centerY;
  const row = Math.round(localY / LATTICE_ROW_HEIGHT);
  const offset = row % 2 === 0 ? 0 : LATTICE_SPACING / 2;
  const col = Math.round((localX - offset) / LATTICE_SPACING);
  return {
    x: centerX + col * LATTICE_SPACING + offset,
    y: centerY + row * LATTICE_ROW_HEIGHT
  };
}
function createHexLatticeForce(centerX, centerY, strength = 0.24) {
  let nodes = [];
  const force = (alpha) => {
    for (const node of nodes) {
      if (node.fx != null || node.fy != null)
        continue;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const target = nearestHexLatticePoint(x, y, centerX, centerY);
      const pull = strength * alpha;
      node.vx = (node.vx ?? 0) + (target.x - x) * pull;
      node.vy = (node.vy ?? 0) + (target.y - y) * pull;
    }
  };
  force.initialize = (next) => {
    nodes = next;
  };
  return force;
}
function forceLabel(force) {
  return force.shortname || force.description || force.key;
}
function buildNkpGraphModel(state, options = {}) {
  const { components, attractors, forces } = effectiveState(state);
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
        const focused = vectorForces.some(isVisibleForce) && isVisibleComponent(names[left]) && isVisibleComponent(names[right]);
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
        tooltip: `${attractor.name} forces: ${stressors.join(", ")}`,
        ...edgeMetrics(shared.length),
        lineStyle: "solid",
        focused,
        opacity: focused ? 0.6 : 0.5
      });
    }
  }
  if (options.hideFiltered) {
    const visibleNodeIds = new Set(nodes.filter((item) => item.type === "attractor" || item.focused).map((item) => item.id));
    return {
      nodes: nodes.filter((item) => visibleNodeIds.has(item.id)),
      edges: edges.filter((item) => item.focused),
      simulation: { enabled: true, forces: ["link", "charge", "center", "collision", "lattice"] }
    };
  }
  return {
    nodes,
    edges,
    simulation: { enabled: true, forces: ["link", "charge", "center", "collision", "lattice"] }
  };
}
function visibleMatrixState(container) {
  const forceIds = new Set(Array.from(container.querySelectorAll("table.matrix tbody tr.force-row")).filter((row) => !row.hidden).map((row) => row.getAttribute("data-force-id")).filter((id) => id !== null));
  const componentNames = new Set(Array.from(container.querySelectorAll("table.matrix thead [data-component]")).filter((element) => !element.hidden).map((element) => element.getAttribute("data-component")).filter((name) => name !== null));
  const threshold = container.querySelector("[data-threshold-input]");
  const hideFilteredToggle = container.querySelector("[data-hide-filtered-graph-toggle]");
  return {
    forceIds,
    componentNames,
    fissionThreshold: Number(threshold?.value ?? 1),
    hideFiltered: hideFilteredToggle?.checked ?? true
  };
}
function mountNkpGraph(container, getState, d3) {
  const host = container.querySelector("[data-nkp-graph]");
  let simulation;
  const sync = () => {
    if (!host)
      return;
    simulation?.stop();
    host.replaceChildren();
    const { forceIds, componentNames, fissionThreshold, hideFiltered } = visibleMatrixState(container);
    const model = buildNkpGraphModel(getState(), {
      visibleForceIds: forceIds,
      visibleComponentNames: componentNames,
      fissionThreshold,
      hideFiltered
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
    const svg = d3.select(host).append("svg").attr("class", "nkp-graph-svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "Live NKP component coupling graph");
    const nodes = model.nodes.map((node2) => ({ ...node2 }));
    const links = model.edges.map((edge) => ({ ...edge }));
    const link = svg.append("g").attr("class", "nkp-graph-edges").selectAll("line").data(links).join("line").attr("class", (edge) => `nkp-edge nkp-edge-${edge.type}`).attr("stroke-width", (edge) => edge.width).attr("stroke-opacity", (edge) => edge.opacity).attr("stroke-dasharray", (edge) => edge.lineStyle === "dotted" ? "3 5" : null);
    link.append("title").text((edge) => edge.tooltip);
    const node = svg.append("g").attr("class", "nkp-graph-nodes").selectAll("g").data(nodes).join("g").attr("class", (item) => `nkp-node nkp-node-${item.type}`).attr("opacity", (item) => item.opacity);
    node.filter((item) => Boolean(item.fissionCandidate)).append("circle").attr("class", "nkp-fission-ring").attr("r", 18).attr("fill", "none").attr("stroke-dasharray", "3 4");
    node.append("circle").attr("class", (item) => `nkp-node-dot ${item.status ? `status-${item.status}` : ""}`).attr("r", (item) => item.type === "attractor" ? 7 : 10);
    node.append("text").attr("class", "nkp-node-label").attr("x", 0).attr("y", (item) => item.fissionCandidate ? -22 : -15).attr("text-anchor", "middle").attr("opacity", (item) => item.labelVisible ? 1 : 0).text((item) => item.label);
    node.append("title").text((item) => item.tooltip);
    node.on("mouseenter", function(_event, item) {
      if (item.revealLabelOnHover)
        d3.select(this).select(".nkp-node-label").attr("opacity", 1);
    }).on("mouseleave", function(_event, item) {
      if (item.revealLabelOnHover)
        d3.select(this).select(".nkp-node-label").attr("opacity", 0);
    });
    const centerX = width / 2;
    const centerY = height / 2;
    const sim = d3.forceSimulation(nodes).force("link", d3.forceLink(links).id((item) => item.id).distance((edge) => edge.distance).strength((edge) => edge.strength)).force("charge", d3.forceManyBody().strength(-360)).force("center", d3.forceCenter(centerX, centerY)).force("collision", d3.forceCollide().radius((item) => item.type === "attractor" ? 34 : 46)).force("lattice", createHexLatticeForce(centerX, centerY));
    simulation = sim;
    node.call(d3.drag().on("start", (event, item) => {
      if (!event.active)
        sim.alphaTarget(0.3).restart();
      item.fx = item.x;
      item.fy = item.y;
    }).on("drag", (event, item) => {
      item.fx = event.x;
      item.fy = event.y;
    }).on("end", (event, item) => {
      if (!event.active)
        sim.alphaTarget(0);
      item.fx = null;
      item.fy = null;
    }));
    sim.on("tick", () => {
      link.attr("x1", (edge) => edge.source.x ?? 0).attr("y1", (edge) => edge.source.y ?? 0).attr("x2", (edge) => edge.target.x ?? 0).attr("y2", (edge) => edge.target.y ?? 0);
      node.attr("transform", (item) => `translate(${item.x ?? 0},${item.y ?? 0})`);
    });
  };
  const syncAfterControl = (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-force-filter], [data-show-proposed-toggle], [data-show-unrelated-toggle], [data-threshold-input], [data-fusion-fission-filter], [data-hide-filtered-graph-toggle]"))
      queueMicrotask(sync);
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
    }
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
var table = container.querySelector("table.matrix");
if (table) {
  const matrixView = mountMatrixView(container);
  const nkpGraph = mountNkpGraph(container, getState, d3);
  const onChange = () => {
    regenerateStagedCommands(container, getState);
    matrixMount.syncNewRows();
    matrixView.recomputeFusionFission();
    nkpGraph.sync();
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
