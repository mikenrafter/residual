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
        const focused = vectorForces.some(isVisibleForce) && isVisibleComponent(names[left] ?? "") && isVisibleComponent(names[right] ?? "");
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
var GOLDEN_ANGLE = 137.508;
function attractorColor(index) {
  const hue = Math.round((index * GOLDEN_ANGLE + 20) % 360);
  const lightness = index % 2 === 0 ? 60 : 70;
  return `hsl(${hue} 62% ${lightness}%)`;
}
function attractorColors(state) {
  const { attractors, forces } = effectiveState(state);
  const ids = [...new Set([...attractors.map((attractor) => attractor.id), ...forces.map((force) => force.attractorId)])].sort();
  return new Map(ids.map((id, index) => [id, attractorColor(index)]));
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
function renderEmpty(host, message) {
  const empty = document.createElement("p");
  empty.className = "landscape-empty";
  empty.textContent = message;
  host.appendChild(empty);
}
function appendZoomableSvg(host, d3, viewBox, className, label) {
  const svg = d3.select(host).append("svg").attr("class", `landscape-svg ${className}`).attr("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`).attr("preserveAspectRatio", "xMidYMid meet").attr("role", "img").attr("aria-label", label);
  const content = svg.append("g").attr("class", "landscape-zoom");
  const zoom = d3.zoom().scaleExtent([0.5, 8]).filter((event) => event.type === "wheel" ? event.ctrlKey || event.metaKey : !event.button).on("zoom", (event) => content.attr("transform", event.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  svg.on("dblclick", () => svg.transition().duration(200).call(zoom.transform, d3.zoomIdentity));
  return { svg, content };
}
function placeTooltip(host, tip, event) {
  tip.hidden = false;
  const bounds = host.getBoundingClientRect();
  const x = event.clientX - bounds.left + 14;
  const y = event.clientY - bounds.top + 14;
  const maxX = host.clientWidth - tip.offsetWidth - 6;
  const maxY = host.clientHeight - tip.offsetHeight - 6;
  tip.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
  tip.style.top = `${Math.max(4, y > maxY ? y - tip.offsetHeight - 24 : y)}px`;
}
function createTooltip(host) {
  const tip = document.createElement("div");
  tip.className = "landscape-tip";
  tip.hidden = true;
  host.appendChild(tip);
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
function renderNkpBundle(host, state, options, d3) {
  host.replaceChildren();
  const model = buildNkpBundleModel(state, options);
  const leafCount = model.groups.reduce((sum, group) => sum + group.leaves.length, 0);
  if (leafCount === 0) {
    renderEmpty(host, "No components to bundle. Loosen the filters or lower the minimum coupling strength.");
    return;
  }
  const longestLabel = Math.min(MAX_LABEL_CHARS, Math.max(...model.groups.flatMap((group) => group.leaves.map((leaf) => leaf.label.length + (leaf.fissionCandidate ? 2 : 0)))));
  const innerRadius = Math.max(150, (leafCount + model.groups.length * GROUP_GAP) * 14 / (2 * Math.PI));
  const bandInner = innerRadius + BAND_GAP;
  const bandOuter = bandInner + BAND_WIDTH;
  const labelRadius = bandOuter + LABEL_GAP;
  const nameRadius = labelRadius + longestLabel * CHAR_WIDTH + 16;
  const half = nameRadius + 18;
  const { svg, content } = appendZoomableSvg(host, d3, { x: -half, y: -half, width: half * 2, height: half * 2 }, "nkp-bundle-svg", "Component couplings bundled by attractor");
  const root = d3.hierarchy(bundleHierarchyData(model));
  d3.cluster().size([360, innerRadius]).separation((a, b) => a.parent === b.parent ? 1 : GROUP_GAP)(root);
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
  const edgePaths = content.append("g").attr("class", "nkp-bundle-edges").selectAll("path").data(edgeData).join("path").attr("class", (item) => `nkp-bundle-edge${item.edge.fusion ? " fusion" : ""}`).attr("d", (item) => line(item.from.path(item.to))).each(function(item) {
    const style = bundleEdgeStyle(item.edge.count, model.maxCount, item.edge.focused);
    this.style.strokeWidth = `${style.width}px`;
    this.style.strokeOpacity = String(style.opacity);
  });
  const bands = content.append("g").attr("class", "nkp-bundle-groups").selectAll("g").data(groupArcs).join("g").attr("class", "nkp-bundle-group");
  bands.append("path").attr("class", "nkp-bundle-band").attr("fill", (d) => d.group.color).attr("d", (d) => band({ startAngle: toRadians(d.start), endAngle: toRadians(d.end) }));
  bands.append("path").attr("class", "nkp-bundle-guide").attr("fill", (d) => d.group.color).attr("d", (d) => guide({ startAngle: toRadians(d.start), endAngle: toRadians(d.end) }));
  bands.append("path").attr("class", "nkp-bundle-hit").attr("d", (d) => d3.arc().innerRadius(bandInner).outerRadius(nameRadius + 8)({ startAngle: toRadians(d.start), endAngle: toRadians(d.end) })).lower();
  bands.append("path").attr("id", (_d, index) => `nkp-bundle-name-${index}`).attr("fill", "none").attr("d", (d) => {
    const point = (deg) => {
      const rad = toRadians(deg - 90);
      return `${nameRadius * Math.cos(rad)},${nameRadius * Math.sin(rad)}`;
    };
    const large = d.name.end - d.name.start > 180 ? 1 : 0;
    return isBottom(d) ? `M${point(d.name.end)} A${nameRadius},${nameRadius} 0 ${large} 0 ${point(d.name.start)}` : `M${point(d.name.start)} A${nameRadius},${nameRadius} 0 ${large} 1 ${point(d.name.end)}`;
  });
  bands.append("text").attr("class", "nkp-bundle-group-label").attr("fill", (d) => d.group.color).attr("dy", (d) => isBottom(d) ? "0.8em" : "0").append("textPath").attr("href", (_d, index) => `#nkp-bundle-name-${index}`).attr("startOffset", "50%").attr("text-anchor", "middle").text((d) => truncate(d.group.label, d.name.maxChars));
  const leaves = content.append("g").attr("class", "nkp-bundle-leaves").selectAll("g").data(root.leaves()).join("g").attr("class", (node) => {
    const leaf = node.data.leaf;
    return `nkp-bundle-leaf${leaf.fissionCandidate ? " fission" : ""}${leaf.focused ? "" : " unfocused"}`;
  });
  leaves.append("circle").attr("class", (node) => `nkp-bundle-dot status-${node.data.leaf.status ?? "actual"}`).attr("r", 3.2).attr("transform", (node) => `rotate(${node.x - 90}) translate(${node.y},0)`);
  leaves.append("text").attr("class", "nkp-bundle-label").attr("dy", "0.32em").each(function(node) {
    const placement = radialLabelTransform(node.x, labelRadius);
    this.setAttribute("transform", placement.transform);
    this.setAttribute("text-anchor", placement.anchor);
    const leaf = node.data.leaf;
    const text = truncate(leaf.label, MAX_LABEL_CHARS);
    this.textContent = leaf.fissionCandidate ? placement.anchor === "start" ? `${text} ▲` : `▲ ${text}` : text;
  });
  const tip = createTooltip(host);
  const clear = () => {
    svg.classed("hovering", false);
    edgePaths.classed("hl-a", false).classed("hl-b", false);
    leaves.classed("hl", false);
    bands.classed("hl", false);
    tip.hidden = true;
  };
  leaves.on("mouseenter", (event, node) => {
    const leaf = node.data.leaf;
    svg.classed("hovering", true);
    const neighbours = new Set([leaf.id]);
    edgePaths.classed("hl-a", (item) => {
      const hit = item.edge.source === leaf.id || item.edge.target === leaf.id;
      if (hit) {
        neighbours.add(item.edge.source);
        neighbours.add(item.edge.target);
      }
      return hit;
    });
    edgePaths.filter(".hl-a").raise();
    leaves.classed("hl", (other) => neighbours.has(other.data.id));
    bands.classed("hl", (d) => d.group.id === leaf.groupId);
    const summary = leafNeighbourSummary(model, leaf.id);
    const group = model.groups.find((candidate) => candidate.id === leaf.groupId);
    const placement = group && group.label !== leaf.dominantLabel ? `${escapeHtml(group.label)} (own attractor: ${escapeHtml(leaf.dominantLabel)})` : escapeHtml(group?.label ?? "");
    const rows = summary.slice(0, 12).map((item) => `<li><b>${escapeHtml(item.label)}</b> (${item.count}): ${escapeHtml(item.stressors.join(", "))}</li>`).join("");
    tip.innerHTML = `<strong>${escapeHtml(leaf.label)}</strong>` + `<div class="muted">${placement}${leaf.fissionCandidate ? " · fission candidate" : ""}</div>` + (rows ? `<ul>${rows}</ul>${summary.length > 12 ? `<div class="muted">+${summary.length - 12} more</div>` : ""}` : `<div class="muted">No visible couplings</div>`);
    placeTooltip(host, tip, event);
  }).on("mouseleave", clear);
  bands.on("mouseenter", (event, d) => {
    const members = new Set(d.group.leaves.map((leaf) => leaf.id));
    svg.classed("hovering", true);
    bands.classed("hl", (other) => other === d);
    const touched = new Set;
    let internal = 0;
    let external = 0;
    edgePaths.classed("hl-a", (item) => {
      const hit = members.has(item.edge.source) && members.has(item.edge.target);
      if (hit)
        internal += 1;
      return hit;
    }).classed("hl-b", (item) => {
      const hit = members.has(item.edge.source) !== members.has(item.edge.target);
      if (hit) {
        external += 1;
        touched.add(item.edge.source);
        touched.add(item.edge.target);
      }
      return hit;
    });
    edgePaths.filter(".hl-a, .hl-b").raise();
    leaves.classed("hl", (node) => members.has(node.data.id) || touched.has(node.data.id));
    tip.innerHTML = `<strong>${escapeHtml(d.group.label)}</strong>` + `<div class="muted">${d.group.leaves.length} component(s) · ${internal} internal, ${external} cross-attractor couplings</div>`;
    placeTooltip(host, tip, event);
  }).on("mouseleave", clear);
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
    const perAttractor = new Map;
    for (const force of attached)
      perAttractor.set(force.attractorId, (perAttractor.get(force.attractorId) ?? 0) + 1);
    let dominantAttractorId;
    let dominantCount = 0;
    for (const [id, count] of [...perAttractor].sort(([a], [b]) => a.localeCompare(b))) {
      if (count > dominantCount) {
        dominantAttractorId = id;
        dominantCount = count;
      }
    }
    const allAttached = allForcesByComponent.get(component.name) ?? [];
    return {
      name: component.name,
      status: component.status,
      description: component.description,
      k: attached.length,
      ...dominantAttractorId ? { dominantAttractorId } : {},
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
function renderNkpSeriation(host, state, options, d3) {
  host.replaceChildren();
  const model = buildSeriationModel(state, options);
  const showCounts = options.showCounts ?? true;
  if (model.components.length === 0) {
    renderEmpty(host, "No coupled components to show. Loosen the filters or lower the minimum coupling strength.");
    return;
  }
  const fissionKey = document.createElement("span");
  fissionKey.className = "landscape-legend-item landscape-legend-warn";
  fissionKey.textContent = "▲ fission candidate";
  renderLegend(host, "Stripe = main attractor", model.attractors.map((attractor) => ({ id: attractor.id, label: `${attractor.name} (${attractor.componentCount})`, color: attractor.color })), [fissionKey]);
  const n = model.components.length;
  const colorFor = new Map(model.attractors.map((attractor) => [attractor.id, attractor.color]));
  const width = LABEL_WIDTH + STRIPE + n * CELL + 8;
  const height = HEADER_HEIGHT + STRIPE + n * CELL + 8;
  const gridX = LABEL_WIDTH + STRIPE;
  const gridY = HEADER_HEIGHT + STRIPE;
  const { content: svg } = appendZoomableSvg(host, d3, { x: 0, y: 0, width, height }, "nkp-seriation-svg", "Component coupling heatmap, rows ordered so tightly coupled components sit together");
  const tooltip = createTooltip(host);
  const grid = svg.append("g").attr("transform", `translate(${gridX},${gridY})`);
  grid.append("rect").attr("class", "nkp-seriation-frame").attr("width", n * CELL).attr("height", n * CELL);
  const intensity = (value, max) => max <= 0 ? 0 : 0.18 + 0.82 * (value / max);
  const diagonal = grid.append("g").selectAll("g").data(model.components).join("g").attr("transform", (_, index) => `translate(${index * CELL},${index * CELL})`);
  diagonal.append("rect").attr("class", "nkp-seriation-diag").attr("width", CELL - 1).attr("height", CELL - 1).attr("fill-opacity", (item) => intensity(item.k, model.maxK) * (item.focused ? 1 : 0.4));
  if (showCounts)
    diagonal.append("text").attr("class", "nkp-seriation-count nkp-seriation-count-strong").attr("x", CELL / 2).attr("y", CELL / 2).text((item) => item.k);
  const cell = grid.append("g").selectAll("g").data(model.cells).join("g").attr("class", "nkp-seriation-cell").attr("transform", (item) => `translate(${item.col * CELL},${item.row * CELL})`);
  cell.append("rect").attr("class", (item) => `nkp-seriation-heat${item.focused ? "" : " is-faded"}`).attr("width", CELL - 1).attr("height", CELL - 1).attr("fill-opacity", (item) => intensity(item.count, model.maxCount));
  if (showCounts)
    cell.append("text").attr("class", (item) => `nkp-seriation-count${intensity(item.count, model.maxCount) > 0.6 ? " nkp-seriation-count-strong" : ""}`).attr("x", CELL / 2).attr("y", CELL / 2).text((item) => item.count);
  const rowBand = grid.append("rect").attr("class", "nkp-seriation-band").attr("width", n * CELL).attr("height", CELL).attr("visibility", "hidden");
  const colBand = grid.append("rect").attr("class", "nkp-seriation-band").attr("width", CELL).attr("height", n * CELL).attr("visibility", "hidden");
  const rowHeaders = svg.append("g").selectAll("g").data(model.components).join("g").attr("class", "nkp-seriation-header").attr("transform", (_, index) => `translate(0,${gridY + index * CELL})`);
  rowHeaders.append("rect").attr("class", "nkp-seriation-hit").attr("width", LABEL_WIDTH + STRIPE).attr("height", CELL);
  rowHeaders.append("rect").attr("x", LABEL_WIDTH).attr("width", STRIPE - 1).attr("height", CELL - 1).attr("fill", (item) => colorFor.get(item.dominantAttractorId ?? "") ?? "var(--line)");
  rowHeaders.append("text").attr("class", (item) => headerClass(item)).attr("x", LABEL_WIDTH - 4).attr("y", CELL / 2).attr("text-anchor", "end").text((item) => headerLabel(item));
  const colHeaders = svg.append("g").selectAll("g").data(model.components).join("g").attr("class", "nkp-seriation-header").attr("transform", (_, index) => `translate(${gridX + index * CELL},0)`);
  colHeaders.append("rect").attr("class", "nkp-seriation-hit").attr("width", CELL).attr("height", HEADER_HEIGHT + STRIPE);
  colHeaders.append("rect").attr("y", HEADER_HEIGHT).attr("width", CELL - 1).attr("height", STRIPE - 1).attr("fill", (item) => colorFor.get(item.dominantAttractorId ?? "") ?? "var(--line)");
  colHeaders.append("text").attr("class", (item) => headerClass(item)).attr("transform", `translate(${CELL / 2},${HEADER_HEIGHT - 4}) rotate(-60)`).text((item) => headerLabel(item));
  let pinned;
  const highlight = (row, col) => {
    const effectiveRow = row ?? pinned;
    const effectiveCol = col ?? pinned;
    rowBand.attr("visibility", effectiveRow === undefined ? "hidden" : "visible").attr("y", (effectiveRow ?? 0) * CELL);
    colBand.attr("visibility", effectiveCol === undefined ? "hidden" : "visible").attr("x", (effectiveCol ?? 0) * CELL);
    rowHeaders.classed("is-active", (_, index) => index === effectiveRow);
    colHeaders.classed("is-active", (_, index) => index === effectiveCol);
  };
  const showTooltip = (event, lines) => {
    tooltip.replaceChildren(...lines.map((line, index) => {
      const element = document.createElement(index === 0 ? "strong" : "div");
      element.textContent = line;
      return element;
    }));
    placeTooltip(host, tooltip, event);
  };
  const hideTooltip = () => {
    tooltip.hidden = true;
    highlight(undefined, undefined);
  };
  const componentLines = (item) => [
    item.name,
    `K = ${item.k} force${item.k === 1 ? "" : "s"}${item.fissionCandidate ? " (fission candidate)" : ""}`,
    `Status: ${item.status}`,
    `Dominant attractor: ${model.attractors.find((a) => a.id === item.dominantAttractorId)?.name ?? "none"}`
  ];
  cell.on("mousemove", (event, item) => {
    highlight(item.row, item.col);
    const rowName = model.components[item.row]?.name ?? "";
    const colName = model.components[item.col]?.name ?? "";
    showTooltip(event, [`${rowName} × ${colName}: ${item.count} shared`, ...item.forces]);
  }).on("mouseleave", hideTooltip);
  diagonal.on("mousemove", (event, item) => {
    const index = model.components.indexOf(item);
    highlight(index, index);
    showTooltip(event, componentLines(item));
  }).on("mouseleave", hideTooltip);
  const headerHandlers = (selection) => {
    selection.on("mousemove", (event, item) => {
      const index = model.components.indexOf(item);
      highlight(index, index);
      showTooltip(event, componentLines(item));
    }).on("mouseleave", hideTooltip).on("click", (_event, item) => {
      const index = model.components.indexOf(item);
      pinned = pinned === index ? undefined : index;
      highlight(undefined, undefined);
    });
  };
  headerHandlers(rowHeaders);
  headerHandlers(colHeaders);
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

// src/nkp-hypergraph.ts
function forceNodeId(force) {
  return `force:${force.key}`;
}
function buildNkpHypergraphModel(state, options = {}) {
  const { components, attractors, forces } = effectiveState(state);
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
    return {
      id: `component:${component.name}`,
      type: "component",
      label: component.name,
      status: component.status,
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
  let nodes = [...componentNodes, ...forceNodes];
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
  return { nodes, edges: keptEdges, groups };
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
  const fmt = (value) => value.toFixed(1);
  if (hull.length === 1) {
    return `M${fmt(first.x - 0.5)},${fmt(first.y)}L${fmt(first.x + 0.5)},${fmt(first.y)}Z`;
  }
  return `M${hull.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join("L")}Z`;
}
function centroid(points) {
  if (points.length === 0)
    return;
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}
function createAttractorCohesionForce(strength = 0.3) {
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
function renderNkpHypergraph(host, model, d3, options = {}) {
  if (model.nodes.length === 0) {
    renderEmpty(host, "No forces or components to draw. Loosen the filters or pick another focus component.");
    return;
  }
  const side = Math.max(480, Math.round(Math.sqrt(model.nodes.length) * 105));
  const aspect = host.clientWidth > 0 && host.clientHeight > 0 ? host.clientWidth / host.clientHeight : 1.4;
  const width = Math.round(side * Math.sqrt(aspect));
  const height = Math.round(side / Math.sqrt(aspect));
  const { svg: root, content: svg } = appendZoomableSvg(host, d3, { x: 0, y: 0, width, height }, "nkp-hyper", "Forces linked to the components they touch, grouped into attractor regions");
  root.classed("names-hidden", options.showNames === false);
  const nodes = model.nodes.map((item) => ({ ...item }));
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const links = model.edges.map((edge) => ({ ...edge }));
  const groupColor = new Map(model.groups.map((group) => [group.attractorId, group.color]));
  const colorOf = (attractorId) => groupColor.get(attractorId) ?? "var(--muted)";
  const cx = width / 2;
  const cy = height / 2;
  model.groups.forEach((group, index) => {
    const angle = index / Math.max(1, model.groups.length) * Math.PI * 2;
    const seed = { x: cx + Math.cos(angle) * side * 0.35, y: cy + Math.sin(angle) * side * 0.35 };
    for (const id of group.forceNodeIds) {
      const item = byId.get(id);
      if (!item)
        continue;
      item.x = seed.x + (Math.random() - 0.5) * 40;
      item.y = seed.y + (Math.random() - 0.5) * 40;
    }
  });
  const regionLayer = svg.append("g").attr("class", "nkp-hyper-regions");
  const region = regionLayer.selectAll("g").data(model.groups).join("g").attr("class", "nkp-hyper-region").attr("opacity", (group) => group.focused ? 0.16 : 0.07);
  const regionPath = region.append("path").attr("fill", (group) => group.color).attr("stroke", (group) => group.color).attr("stroke-width", REGION_PADDING * 2).attr("stroke-linejoin", "round").attr("stroke-linecap", "round");
  region.append("title").text((group) => group.tooltip);
  const link = svg.append("g").attr("class", "nkp-hyper-edges").selectAll("line").data(links).join("line").attr("class", "nkp-hyper-edge").attr("stroke", (edge) => colorOf(edge.attractorId)).attr("stroke-opacity", (edge) => edge.focused ? 0.45 : 0.15);
  const regionLabel = svg.append("g").attr("class", "nkp-hyper-region-labels").selectAll("text").data(model.groups).join("text").attr("class", "nkp-hyper-region-label").attr("text-anchor", "middle").attr("fill", (group) => group.color).attr("opacity", (group) => group.focused ? 0.9 : 0.4).text((group) => group.name);
  const node = svg.append("g").attr("class", "nkp-hyper-nodes").selectAll("g").data(nodes).join("g").attr("class", (item) => `nkp-node nkp-hyper-node nkp-hyper-${item.type}`).attr("opacity", (item) => item.focused ? 1 : 0.45);
  const components = node.filter((item) => item.type === "component");
  components.filter((item) => item.type === "component" && item.fissionCandidate).append("circle").attr("class", "nkp-fission-ring").attr("r", 15).attr("fill", "none").attr("stroke-dasharray", "3 4");
  components.append("circle").attr("class", (item) => `nkp-node-dot ${item.type === "component" ? `status-${item.status}` : ""}`).attr("r", 9);
  components.append("text").attr("class", "nkp-node-label").attr("y", (item) => item.type === "component" && item.fissionCandidate ? -19 : -13).attr("text-anchor", "middle").text((item) => item.label);
  const forces = node.filter((item) => item.type === "force");
  forces.append("path").attr("class", "nkp-hyper-force-dot").attr("d", (item) => item.type === "force" && item.kind === "stressor" ? "M0,-5L5,0L0,5L-5,0Z" : "M-4,0a4,4 0 1,0 8,0a4,4 0 1,0 -8,0").attr("fill", (item) => item.type === "force" ? colorOf(item.attractorId) : null);
  forces.append("text").attr("class", "nkp-node-label nkp-hyper-force-label").attr("y", -9).attr("text-anchor", "middle").attr("opacity", 0).text((item) => item.label);
  node.append("title").text((item) => item.tooltip);
  const neighbours = new Map;
  for (const edge of model.edges) {
    neighbours.set(edge.source, (neighbours.get(edge.source) ?? new Set).add(edge.target));
    neighbours.set(edge.target, (neighbours.get(edge.target) ?? new Set).add(edge.source));
  }
  const attractorOfForce = (id) => {
    const item = byId.get(id);
    return item?.type === "force" ? item.attractorId : undefined;
  };
  const highlight = (item) => {
    if (!item) {
      root.classed("nkp-hyper-hovering", false);
      node.classed("is-lit", false);
      link.classed("is-lit", false);
      region.classed("is-lit", false);
      regionLabel.classed("is-lit", false);
      forces.select(".nkp-hyper-force-label").attr("opacity", 0);
      return;
    }
    const lit = new Set([item.id, ...neighbours.get(item.id) ?? []]);
    const forceIds = item.type === "force" ? [item.id] : [...neighbours.get(item.id) ?? []];
    const litAttractors = new Set(forceIds.map(attractorOfForce).filter((id) => id !== undefined));
    root.classed("nkp-hyper-hovering", true);
    node.classed("is-lit", (other) => lit.has(other.id));
    link.classed("is-lit", (edge) => {
      const source = typeof edge.source === "string" ? edge.source : edge.source.id;
      const target = typeof edge.target === "string" ? edge.target : edge.target.id;
      return source === item.id || target === item.id;
    });
    region.classed("is-lit", (group) => litAttractors.has(group.attractorId));
    regionLabel.classed("is-lit", (group) => litAttractors.has(group.attractorId));
    forces.select(".nkp-hyper-force-label").attr("opacity", (other) => other.id === item.id ? 1 : 0);
  };
  node.on("mouseenter", (_event, item) => highlight(item)).on("mouseleave", () => highlight(undefined));
  const degree = new Map;
  for (const edge of model.edges)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  const sim = d3.forceSimulation(nodes).force("link", d3.forceLink(links).id((item) => item.id).distance((edge) => 45 + Math.sqrt(degree.get(typeof edge.target === "string" ? edge.target : edge.target.id) ?? 1) * 14).strength(0.18)).force("charge", d3.forceManyBody().strength((item) => item.type === "component" ? -650 : -130).distanceMax(side)).force("x", d3.forceX(cx).strength(0.05)).force("y", d3.forceY(cy).strength(0.05)).force("collision", d3.forceCollide().radius((item) => item.type === "component" ? 30 : 9)).force("cohesion", createAttractorCohesionForce());
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
  const pointsOf = (group) => group.forceNodeIds.map((id) => byId.get(id)).filter((item) => item !== undefined).map((item) => ({ x: item.x ?? 0, y: item.y ?? 0 }));
  const margin = REGION_PADDING + 30;
  sim.on("tick", () => {
    for (const item of nodes) {
      item.x = Math.min(width - margin, Math.max(margin, item.x ?? cx));
      item.y = Math.min(height - margin, Math.max(margin, item.y ?? cy));
    }
    regionPath.attr("d", (group) => regionCorePath(pointsOf(group)));
    regionLabel.each(function(group) {
      const points = pointsOf(group);
      const center = centroid(points);
      if (!center)
        return;
      const top = Math.min(...points.map((point) => point.y));
      d3.select(this).attr("x", center.x).attr("y", top - REGION_PADDING - 4);
    });
    link.attr("x1", (edge) => edge.source.x ?? 0).attr("y1", (edge) => edge.source.y ?? 0).attr("x2", (edge) => edge.target.x ?? 0).attr("y2", (edge) => edge.target.y ?? 0);
    node.attr("transform", (item) => `translate(${item.x ?? 0},${item.y ?? 0})`);
  });
  return sim;
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
  "[data-regions-names-toggle]"
].join(", ");
function fitViewportHeight(windowHeight, toolbarHeight, chrome, bottomPadding) {
  return Math.max(320, Math.floor(windowHeight - toolbarHeight - chrome - bottomPadding));
}
function mountLandscape(container, getState, d3) {
  const host = container.querySelector("[data-landscape]");
  const card = host?.closest("details") ?? null;
  let simulation;
  let stale = true;
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
  const sync = () => {
    if (!host)
      return;
    const view = currentView();
    host.dataset.view = view;
    for (const control of Array.from(container.querySelectorAll("[data-landscape-for]"))) {
      control.hidden = !controlAppliesTo(control.getAttribute("data-landscape-for"), view);
    }
    if (card && !card.open) {
      stale = true;
      return;
    }
    stale = false;
    fitViewport();
    simulation?.stop();
    simulation = undefined;
    host.replaceChildren();
    const state = getState();
    const filters = readFilters(container);
    const hideFiltered = container.querySelector("[data-hide-filtered-graph-toggle]")?.checked ?? true;
    if (view === "regions") {
      const focusComponent = syncFocusOptions(container.querySelector("[data-regions-focus]"), state);
      const showNames = container.querySelector("[data-regions-names-toggle]")?.checked ?? true;
      const model = buildNkpHypergraphModel(state, { ...filters, hideFiltered, ...focusComponent ? { focusComponent } : {} });
      simulation = renderNkpHypergraph(host, model, d3, { showNames });
      return;
    }
    const minCouplingStrength = syncMinCouplingStrength(container, state, filters);
    if (view === "heatmap") {
      const showCounts = container.querySelector("[data-heatmap-counts-toggle]")?.checked ?? true;
      renderNkpSeriation(host, state, { ...filters, hideFiltered, minCouplingStrength, showCounts }, d3);
      return;
    }
    const { topNCouplings, topNDirection } = syncTopN(container, state, filters, minCouplingStrength);
    const tensionInput = container.querySelector("[data-bundle-tension-input]");
    const tension = tensionInput ? Number(tensionInput.value) / 100 : DEFAULT_BUNDLE_TENSION;
    renderNkpBundle(host, state, {
      ...filters,
      hideFiltered,
      minCouplingStrength,
      ...topNCouplings === undefined ? {} : { topNCouplings },
      topNDirection,
      tension
    }, d3);
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
  const onToggle = () => {
    if (!card?.open)
      return;
    if (stale)
      sync();
    card.scrollIntoView({ block: "start", behavior: "smooth" });
  };
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
  card?.addEventListener("toggle", onToggle);
  window.addEventListener("resize", onResize);
  sync();
  return {
    sync,
    destroy: () => {
      simulation?.stop();
      clearTimeout(resizeTimer);
      container.removeEventListener("input", onControl);
      container.removeEventListener("change", onControl);
      card?.removeEventListener("toggle", onToggle);
      window.removeEventListener("resize", onResize);
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
