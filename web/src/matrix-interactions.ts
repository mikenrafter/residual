// DOM-wiring layer for the live-editing NKP matrix (Phase 5 of
// residual/iterations/view-live-editing-plan.md). Attaches event listeners to
// an already-server-rendered `<table class="matrix">` (see
// src/view/components/matrix.rs for the exact markup contract this module
// binds to) and drives state transitions through the pure reducers in
// ./actions and the pure decision helpers in ./render-decisions /./model.
//
// This module owns DOM mutation only — it never invents business rules.
// Every state transition is delegated to toggleComponent / addForceRow /
// updateForceField (./actions); every "should this be marked invalid?"
// decision is delegated to computeInvalidMarks (./render-decisions).
//
// Design decisions (documented per repo instructions, pinned by
// matrix-interactions.test.ts):
//
// - `mount`'s third parameter is a plain `setState` callback (not a store);
//   an optional 4th-parameter `MountOptions.onChange` fires after every
//   state-mutating interaction, *after* `setState` has already been called,
//   so a later phase can hang command-textbox regeneration off it without
//   this module knowing anything about that textbox.
// - Double-click on a residue cell re-renders only that `<td>` in place
//   (updates `data-coupled` and text content) rather than the whole table —
//   cheaper, and the task spec explicitly allows either strategy.
// - Right-click on a `tr.force-row` (event delegated from the table, since
//   rows are added/removed dynamically) opens a minimal context menu
//   (`<ul role="menu">` with two `<li role="menuitem" data-action="...">`
//   entries: "Add row above" / "Add row below") appended to `document.body`
//   at the cursor position. Choosing an entry calls `addForceRow` with the
//   SAME kind (stressor/purpose) as the row that was right-clicked (reading
//   `data-force-kind`) — right-clicking a specific row is the only kind
//   signal available at that point, so inheriting it is the least surprising
//   default. The new row is inserted as a sibling `<tr class="force-row"
//   data-force-id="<tempId>">` immediately before/after the anchor row, and
//   rendered already in "edit mode": its `.force-detail` div starts visible
//   (not `hidden`) and shows `<input>`/`<select>` fields directly (no
//   read-only `<dl>`, no separate Edit button click needed) since a brand
//   new row has nothing meaningful to display in read-only form yet.
// - An existing row's non-NKP fields are only ever edited via an explicit
//   "Edit" `<button>` appended into `.force-detail` (after the `<dl>`) —
//   never via double-click (double-click is reserved for NKP cells).
//   Clicking "Edit" swaps `description` / `naive change` / `outcomes` `<dd>`s
//   for pre-filled `<input type="text">` elements and the `attractor` `<dd>`
//   for a `<select>` populated from `attractorOptions(state)` (current
//   attractor id pre-selected), and shows "OK"/"Cancel" buttons while hiding
//   "Edit".
// - "OK" calls `updateForceField` only for editable fields (description,
//   attractorId, naiveChangeOrFeature, outcomes) whose input/select value
//   differs from the value captured when "Edit" was clicked — NOT
//   unconditionally for all four. This deviates from an earlier draft of
//   this comment: `updateForceField` sets the field explicitly in
//   `updatedForces`/`addedForces` even when the new value equals the old
//   one, so an unconditional call is NOT a no-op for state-equality checks
//   (see matrix-interactions.test.ts's "clicking OK calls updateForceField
//   for the edited fields" test, which asserts `getState()` equals a state
//   produced by a single `updateForceField` call for only the one field the
//   test actually edited). After OK, the fields swap back to a read-only
//   `<dl>` showing the newly-saved values and "Edit" reappears.
// - "Cancel" discards the `<input>`/`<select>` values without calling
//   `updateForceField` at all, and swaps back to the read-only `<dl>` showing
//   the values that were current before "Edit" was clicked (which, since no
//   reducer ran, are simply the still-current `getState()` values).
// - Invalid-row marking: any force whose key is in
//   `computeInvalidMarks(state).invalidForceKeys` gets the CSS class
//   `"row-invalid"` applied to both its `th.sticky-col[data-force-id]`
//   sticky label cell AND its `tr.force-row` element, so a stylesheet can key
//   off either. `invalidComponentColumns` is walked generically (applying
//   `"row-invalid"`-equivalent marking to matching `th[data-component]`
//   header cells, were that set ever non-empty) even though it is always
//   empty today per render-decisions.ts's documented scoping — this module
//   does not special-case that emptiness, it just naturally does nothing
//   when the set is empty.

import { addForceRow, removeForce, setAddedForceKind, toggleComponent, updateForceField } from "./actions";
import type { PendingState } from "./model";
import { attractorOptions, computeInvalidMarks } from "./render-decisions";
import { decorateForceRow } from "./matrix-visuals";

/** Options controlling side effects mount() triggers beyond the DOM/state update itself. */
export interface MountOptions {
  /**
   * Called after every state-mutating interaction, once `setState` has
   * already been invoked with the new state. Lets a later phase (e.g. the
   * command-textbox regenerator) react to changes without this module
   * knowing about it.
   */
  onChange?: () => void;
}

type EditableField = "description" | "attractorId" | "naiveChangeOrFeature" | "outcomes" | "shortname";

interface EffectiveForceValues {
  description: string;
  attractorId: string;
  naiveChangeOrFeature: string;
  outcomes: string;
  shortname: string;
}

/** Resolves the currently-effective (base/added merged with any pending update) text field values for a force key. */
function getEffectiveForceValues(state: PendingState, forceKey: string): EffectiveForceValues {
  const update = state.updatedForces[forceKey];
  const added = state.addedForces.find((f) => f.tempId === forceKey);
  const base = added ?? state.baseForces.find((f) => f.id === forceKey);
  return {
    description: update?.description ?? base?.description ?? "",
    attractorId: update?.attractorId ?? base?.attractorId ?? "",
    naiveChangeOrFeature: update?.naiveChangeOrFeature ?? base?.naiveChangeOrFeature ?? "",
    outcomes: update?.outcomes ?? base?.outcomes ?? "",
    shortname: update?.shortname ?? base?.shortname ?? "",
  };
}

/** Resolves the currently-effective coupled-components list for a force key. */
function effectiveComponents(state: PendingState, forceKey: string): string[] {
  const added = state.addedForces.find((f) => f.tempId === forceKey);
  if (added !== undefined) return added.components;
  const base = state.baseForces.find((f) => f.id === forceKey);
  if (base === undefined) return [];
  return state.updatedForces[forceKey]?.components ?? base.components;
}

/** Renders the "<id> · <name>" label used in the read-only attractor <dd>, matching src/view/components/matrix.rs's fixture shape. */
function getAttractorLabel(state: PendingState, attractorId: string): string {
  const attractor = [...state.baseAttractors, ...state.addedAttractors].find((a) => a.id === attractorId);
  return attractor ? `${attractor.id} · ${attractor.name}` : attractorId;
}

function createTextInput(name: string, value: string, multiline = false): HTMLInputElement | HTMLTextAreaElement {
  if (multiline) {
    const input = document.createElement("textarea");
    input.name = name;
    input.value = value;
    input.rows = 3;
    input.wrap = "soft";
    return input;
  }
  const input = document.createElement("input");
  input.type = "text";
  input.name = name;
  input.value = value;
  return input;
}

/**
 * Wraps a field element in a `<label>` carrying its visible text, matching
 * the labeled-field pattern already used by the below-table "Stage adds"
 * forms (src/view/shell.html). The editor's flex container wraps these
 * labeled fields across lines instead of making the sticky column overflow.
 */
function labeledField(labelText: string, field: HTMLElement): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "force-detail-field";
  label.textContent = labelText;
  label.appendChild(field);
  return label;
}

function createKindSelect(selected: "stressor" | "purpose"): HTMLSelectElement {
  const select = document.createElement("select");
  for (const kind of ["stressor", "purpose"] as const) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    select.appendChild(option);
  }
  select.value = selected;
  return select;
}

function createAttractorSelect(state: PendingState, selectedId: string): HTMLSelectElement {
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

function createResidueCell(forceKey: string, componentName: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.setAttribute("data-residue-cell", "true");
  td.setAttribute("data-force-id", forceKey);
  td.setAttribute("data-component", componentName);
  td.setAttribute("data-coupled", "0");
  return td;
}

/**
 * Attaches all live-editing interactions (cell toggle, row context menu,
 * field edit, invalid-row marking) to `table`, an already-present
 * `<table class="matrix">` server-rendered per src/view/components/matrix.rs.
 *
 * `getState`/`setState` give this module read/write access to the
 * caller-owned `PendingState` without owning it directly, mirroring the
 * reducer signatures in ./actions.
 */
/** Returned by `mount()` so callers driving state changes from outside this
 * module (e.g. the below-table stage-stressor/purpose forms in forms.ts) can
 * ask it to catch up: insert a `<tr>` for any `addedForces` entry that
 * doesn't have one yet, so every pending force stays reachable for NKP
 * toggling regardless of which UI surface created it. */
export interface MountResult {
  syncNewRows: () => void;
  resetDom: () => void;
}

export function mount(
  table: HTMLTableElement,
  getState: () => PendingState,
  setState: (next: PendingState) => void,
  options?: MountOptions,
): MountResult {
  function applyInvalidMarks(): void {
    const { invalidForceKeys } = computeInvalidMarks(getState());
    const rows = table.querySelectorAll<HTMLTableRowElement>("tr.force-row[data-force-id]");
    for (const row of Array.from(rows)) {
      const forceKey = row.getAttribute("data-force-id");
      if (forceKey === null) continue;
      const invalid = invalidForceKeys.has(forceKey);
      row.classList.toggle("row-invalid", invalid);
      row.querySelector("th.sticky-col[data-force-id]")?.classList.toggle("row-invalid", invalid);
    }
  }

  function appendEditButton(detail: HTMLElement, forceKey: string): void {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Edit";
    button.addEventListener("click", () => enterEditMode(detail, forceKey));
    detail.appendChild(button);
  }

  function appendRemoveButton(detail: HTMLElement, forceKey: string): void {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Remove";
    button.addEventListener("click", () => {
      const next = removeForce(getState(), forceKey);
      setState(next);
      const row = detail.closest("tr.force-row");
      if (row instanceof HTMLTableRowElement) row.hidden = true;
      applyInvalidMarks();
      options?.onChange?.();
    });
    detail.appendChild(button);
  }

  function renderReadOnly(detail: HTMLElement, forceKey: string): void {
    detail.innerHTML = "";
    const values = getEffectiveForceValues(getState(), forceKey);
    const dl = document.createElement("dl");
    const addPair = (term: string, value: string): void => {
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

  function enterEditMode(detail: HTMLElement, forceKey: string): void {
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
      const edited: Array<[EditableField, string]> = [
        ["shortname", shortnameInput.value],
        ["description", descriptionInput.value],
        ["attractorId", attractorSelect.value],
        ["naiveChangeOrFeature", naiveChangeInput.value],
        ["outcomes", outcomesInput.value],
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
    editor.append(
      labeledField("shortname", shortnameInput),
      labeledField("description", descriptionInput),
      labeledField("naive change", naiveChangeInput),
      labeledField("outcomes", outcomesInput),
      labeledField("attractor", attractorSelect),
      actions,
    );
    appendRemoveButton(actions, forceKey);
    detail.appendChild(editor);
  }

  function wireLiveField(
    el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    eventName: "input" | "change",
    forceKey: string,
    field: EditableField,
  ): void {
    el.addEventListener(eventName, () => {
      const next = updateForceField(getState(), forceKey, field, el.value);
      setState(next);
      if (field === "attractorId") {
        const row = table.querySelector<HTMLTableRowElement>(`tr.force-row[data-force-id="${CSS.escape(forceKey)}"]`);
        if (row !== null) {
          const kind = row.getAttribute("data-force-kind") === "purpose" ? "purpose" : "stressor";
          decorateForceRow(row, kind, el.value);
        }
      }
      applyInvalidMarks();
      options?.onChange?.();
    });
  }

  function buildNewForceRow(tempId: string, kind: "stressor" | "purpose"): HTMLTableRowElement {
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
    editor.append(
      labeledField("kind", kindSelect),
      labeledField("shortname", shortnameInput),
      labeledField("description", descriptionInput),
      labeledField("naive change", naiveChangeInput),
      labeledField("outcomes", outcomesInput),
      labeledField("attractor", attractorSelect),
      actions,
    );
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

  /**
   * Recomputes the row total for `forceKey`, the column total for
   * `component`, and the grand total, from the current `data-coupled`
   * attributes in the DOM — mirrors src/view/components/matrix.rs's
   * row_total/col_total/grand_total, which only ever run at initial
   * server-render time. Without this, toggling a cell leaves every total
   * (sticky-right row total, tfoot column total, tfoot grand total) stale.
   */
  function recomputeTotals(forceKey: string, component: string): void {
    const row = table.querySelector<HTMLTableRowElement>(`tr.force-row[data-force-id="${CSS.escape(forceKey)}"]`);
    if (row !== null) {
      const rowTotal = row.querySelectorAll('td[data-residue-cell][data-coupled="1"]').length;
      row.setAttribute("data-row-total", String(rowTotal));
      const rowTotalCell = row.querySelector(".sticky-col-right[data-row-total]");
      if (rowTotalCell !== null) {
        rowTotalCell.setAttribute("data-row-total", String(rowTotal));
        rowTotalCell.textContent = String(rowTotal);
      }
    }

    const colTotalCell = table.querySelector(
      `tfoot td[data-col-total][data-component="${CSS.escape(component)}"]`,
    );
    if (colTotalCell !== null) {
      const colTotal = table.querySelectorAll(
        `tbody td[data-residue-cell][data-component="${CSS.escape(component)}"][data-coupled="1"]`,
      ).length;
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

  function closeContextMenu(): void {
    for (const el of Array.from(document.querySelectorAll('[role="menu"]'))) {
      el.remove();
    }
  }

  function handleAddRow(anchorRow: HTMLTableRowElement, action: "add-above" | "add-below"): void {
    const kind: "stressor" | "purpose" = anchorRow.getAttribute("data-force-kind") === "purpose" ? "purpose" : "stressor";
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

  function openContextMenu(event: MouseEvent, anchorRow: HTMLTableRowElement): void {
    closeContextMenu();
    const menu = document.createElement("ul");
    menu.setAttribute("role", "menu");
    menu.style.position = "absolute";
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    const entries: Array<{ action: "add-above" | "add-below"; label: string }> = [
      { action: "add-above", label: "Add row above" },
      { action: "add-below", label: "Add row below" },
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
    if (!(target instanceof Element)) return;
    const cell = target.closest('td[data-residue-cell]');
    if (!(cell instanceof HTMLTableCellElement)) return;
    const forceKey = cell.getAttribute("data-force-id");
    const component = cell.getAttribute("data-component");
    if (forceKey === null || component === null) return;

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
    if (!(target instanceof Element)) return;
    const row = target.closest("tr.force-row");
    if (!(row instanceof HTMLTableRowElement)) return;
    event.preventDefault();
    openContextMenu(event, row);
  });

  for (const detail of Array.from(table.querySelectorAll<HTMLElement>(".force-detail"))) {
    if (detail.querySelector("dl") === null) continue;
    const forceKey = detail.closest("th[data-force-id]")?.getAttribute("data-force-id");
    if (forceKey === null || forceKey === undefined) continue;
    appendEditButton(detail, forceKey);
  }

  function syncNewRows(): void {
    const tbody = table.querySelector("tbody");
    if (tbody === null) return;
    for (const force of getState().addedForces) {
      const selector = `tr.force-row[data-force-id="${CSS.escape(force.tempId)}"]`;
      if (table.querySelector(selector) !== null) continue;
      tbody.appendChild(buildNewForceRow(force.tempId, force.kind));
    }
    applyInvalidMarks();
  }

  function resetDom(): void {
    const state = getState();
    const baseIds = new Set(state.baseForces.map((force) => force.id));
    for (const row of Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr.force-row"))) {
      const key = row.getAttribute("data-force-id");
      if (key === null) continue;
      if (!baseIds.has(key)) {
        row.remove();
        continue;
      }
      row.hidden = false;
      const base = state.baseForces.find((force) => force.id === key);
      if (base !== undefined) {
        for (const cell of Array.from(row.querySelectorAll<HTMLTableCellElement>("td[data-residue-cell]"))) {
          const component = cell.getAttribute("data-component");
          const coupled = component !== null && base.components.includes(component);
          cell.setAttribute("data-coupled", coupled ? "1" : "0");
          cell.textContent = coupled ? "1" : "";
        }
      }
      const detail = row.querySelector<HTMLElement>(".force-detail");
      if (detail !== null) {
        detail.hidden = true;
        renderReadOnly(detail, key);
      }
    }
    const baseComponents = new Set(state.baseComponents.map((component) => component.name));
    for (const element of Array.from(table.querySelectorAll<HTMLElement>("[data-component]"))) {
      const name = element.getAttribute("data-component");
      if (name !== null && !baseComponents.has(name)) element.remove();
    }
    applyInvalidMarks();
  }

  applyInvalidMarks();

  return { syncNewRows, resetDom };
}
