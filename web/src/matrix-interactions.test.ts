import { beforeEach, describe, expect, test } from "bun:test";
import { addForceRow, toggleComponent, updateForceField } from "./actions";
import type { PendingState, SnapshotAttractor, SnapshotComponent, SnapshotForce } from "./model";
import { mount } from "./matrix-interactions";
import { attractorOptions, computeInvalidMarks } from "./render-decisions";
import { attractorColorForId } from "./nkp-graph";

// ---------------------------------------------------------------------------
// Fixtures — fully implemented (not under test): a minimal PendingState and a
// hand-built HTML fixture string matching the markup contract rendered by
// src/view/components/matrix.rs (see that file's `render_matrix`). Exact
// whitespace/attribute order doesn't matter — only the elements/classes/data
// attributes matrix-interactions.ts's mount() must bind to.
// ---------------------------------------------------------------------------

const attractorResilience: SnapshotAttractor = {
  id: "A-01",
  name: "resilience",
  description: "system tolerates partial failure",
  positiveState: "graceful degradation",
  negativeState: "cascading failure",
};

const attractorAdaptability: SnapshotAttractor = {
  id: "A-02",
  name: "adaptability",
  description: "system absorbs novel stressors",
  positiveState: "flexible response",
  negativeState: "brittle failure",
};

const componentCli: SnapshotComponent = {
  name: "cli",
  description: "command-line interface",
  status: "actual",
  architectureSet: "iter1",
};

const componentStorage: SnapshotComponent = {
  name: "storage",
  description: "persistence layer",
  status: "actual",
  architectureSet: "iter1",
};

const forceS01: SnapshotForce = {
  id: "S-01",
  kind: "stressor",
  description: "queue backs up under load",
  attractorId: "A-01",
  naiveChangeOrFeature: "add retry",
  outcomes: "requests drain",
  shortname: "queue-overload",
  components: ["cli"],
};

const forceS02: SnapshotForce = {
  id: "S-02",
  kind: "stressor",
  description: "disk fills under sustained writes",
  attractorId: "A-01",
  naiveChangeOrFeature: "add cleanup job",
  outcomes: "disk freed",
  shortname: "disk-full",
  components: ["storage"],
};

function baseState(overrides: Partial<PendingState> = {}): PendingState {
  return {
    baseAttractors: [attractorResilience, attractorAdaptability],
    baseComponents: [componentCli, componentStorage],
    baseForces: [forceS01, forceS02],
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
    updatedTerms: {},
    ...overrides,
  };
}

interface FixtureForceSpec {
  force: SnapshotForce;
  attractorLabel: string;
}

function forceRowHtml(spec: FixtureForceSpec, components: SnapshotComponent[]): string {
  const { force, attractorLabel } = spec;
  const total = force.components.length;
  const prefix = force.kind === "stressor" ? "S" : "P";
  const cells = components
    .map((c) => {
      const coupled = force.components.includes(c.name);
      return `<td data-residue-cell="true" data-force-id="${force.id}" data-component="${c.name}" data-coupled="${
        coupled ? "1" : "0"
      }">${coupled ? "1" : ""}</td>`;
    })
    .join("");

  return `
    <tr class="force-row" data-force-id="${force.id}" data-force-kind="${force.kind}" data-architecture-set="iter1" data-attractor-shortname="${force.attractorId}" data-search="${force.id}" data-row-total="${total}">
      <th class="sticky-col" data-force-id="${force.id}">
        <button type="button" class="force-accordion-toggle" data-accordion-toggle="true" aria-expanded="false">${prefix}-${force.shortname}</button>
        <div class="force-detail" hidden="true">
          <dl>
            <dt>id</dt><dd>${force.id}</dd>
            <dt>attractor</dt><dd>${attractorLabel}</dd>
            <dt>description</dt><dd>${force.description}</dd>
            <dt>naive change</dt><dd>${force.naiveChangeOrFeature}</dd>
            <dt>outcomes</dt><dd>${force.outcomes}</dd>
          </dl>
        </div>
      </th>
      ${cells}
      <td class="sticky-col-right" data-row-total="${total}">${total}</td>
    </tr>`;
}

function fixtureTableHtml(state: PendingState): string {
  const components = [...state.baseComponents, ...state.addedComponents];
  const forces = [...state.baseForces, ...state.addedForces];

  const headerCells = components
    .map(
      (c) => `
      <th class="sticky-row" data-component="${c.name}" data-status="${c.status}" data-architecture-set="${c.architectureSet}" data-sort-key="component:${c.name}">
        <span class="status-dot status-${c.status}"></span>${c.name}
      </th>`,
    )
    .join("");

  const rows = forces
    .map((force) => {
      const attractor = [...state.baseAttractors, ...state.addedAttractors].find((a) => a.id === force.attractorId);
      const attractorLabel = attractor ? `${attractor.id} · ${attractor.name}` : force.attractorId;
      return forceRowHtml({ force: force as SnapshotForce, attractorLabel }, components);
    })
    .join("");

  const footerCells = components.map((c) => `<td data-col-total="0" data-component="${c.name}">0</td>`).join("");

  return `
    <table class="matrix">
      <thead><tr>
        <th class="sticky-col sticky-row corner" data-sort-key="force">force</th>
        ${headerCells}
        <th class="sticky-row sticky-col-right corner" data-sort-key="total">total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <th class="sticky-col corner">totals</th>
        ${footerCells}
        <td class="sticky-col-right corner" data-grand-total="0">0</td>
      </tr></tfoot>
    </table>`;
}

/** Mounts a fresh fixture table for `state` into `document.body` and returns it plus a mutable state box. */
function mountFixture(state: PendingState): {
  table: HTMLTableElement;
  getState: () => PendingState;
  setState: (next: PendingState) => void;
  changeCount: () => number;
  syncNewRows: () => void;
} {
  document.body.innerHTML = fixtureTableHtml(state);
  const table = document.querySelector("table.matrix");
  if (!(table instanceof HTMLTableElement)) {
    throw new Error("fixture setup failed: table.matrix not found");
  }

  let current = state;
  let changes = 0;
  const getState = (): PendingState => current;
  const setState = (next: PendingState): void => {
    current = next;
  };

  const { syncNewRows } = mount(table, getState, setState, {
    onChange: () => {
      changes += 1;
    },
  });

  return { table, getState, setState, changeCount: () => changes, syncNewRows };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mount — double-click toggles an NKP cell", () => {
  test("double-clicking an uncoupled cell (0) toggles it on (1) via toggleComponent, updating state and the cell's DOM", () => {
    const state = baseState();
    const { table, getState } = mountFixture(state);

    const cell = table.querySelector('td[data-force-id="S-01"][data-component="storage"]');
    if (!(cell instanceof HTMLTableCellElement)) throw new Error("cell not found");
    expect(cell.getAttribute("data-coupled")).toBe("0");

    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    const expected = toggleComponent(state, "S-01", "storage");
    expect(getState()).toEqual(expected);
    expect(cell.getAttribute("data-coupled")).toBe("1");
    expect(cell.textContent).toBe("1");
  });

  test("double-clicking a coupled cell (1) toggles it off (0) via toggleComponent, updating state and the cell's DOM", () => {
    const state = baseState();
    const { table, getState } = mountFixture(state);

    const cell = table.querySelector('td[data-force-id="S-01"][data-component="cli"]');
    if (!(cell instanceof HTMLTableCellElement)) throw new Error("cell not found");
    expect(cell.getAttribute("data-coupled")).toBe("1");

    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    const expected = toggleComponent(state, "S-01", "cli");
    expect(getState()).toEqual(expected);
    expect(cell.getAttribute("data-coupled")).toBe("0");
    expect(cell.textContent).toBe("");
  });

  test("double-clicking a cell fires the onChange callback exactly once", () => {
    const state = baseState();
    const { table, changeCount } = mountFixture(state);
    const cell = table.querySelector('td[data-force-id="S-01"][data-component="storage"]');
    if (!(cell instanceof HTMLTableCellElement)) throw new Error("cell not found");

    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(changeCount()).toBe(1);
  });
});

describe("mount — toggling a cell recomputes row/column/grand totals", () => {
  // baseState() starts with S-01 coupled to "cli" and S-02 coupled to
  // "storage" — 2 coupled cells total, 1 per row, 1 per column. The fixture's
  // tfoot data-col-total/data-grand-total placeholders are seeded "0" (they
  // aren't computed by the test fixture), so assertions below check the
  // real post-toggle counts recomputeTotals must produce, not a "before + 1"
  // delta off the stale placeholder.
  test("toggling a cell ON updates the row's sticky-right total, the column's tfoot total, and the grand total", () => {
    const state = baseState();
    const { table } = mountFixture(state);

    const row = table.querySelector('tr.force-row[data-force-id="S-01"]');
    if (!(row instanceof HTMLTableRowElement)) throw new Error("row not found");
    const rowTotalCell = row.querySelector(".sticky-col-right[data-row-total]");
    const colTotalCell = table.querySelector('tfoot td[data-col-total][data-component="storage"]');
    const grandTotalCell = table.querySelector("tfoot [data-grand-total]");

    const cell = table.querySelector('td[data-force-id="S-01"][data-component="storage"]');
    if (!(cell instanceof HTMLTableCellElement)) throw new Error("cell not found");
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    // S-01 now carries cli + storage.
    expect(row.getAttribute("data-row-total")).toBe("2");
    expect(rowTotalCell?.getAttribute("data-row-total")).toBe("2");
    expect(rowTotalCell?.textContent).toBe("2");
    // "storage" is now coupled to both S-01 and S-02.
    expect(colTotalCell?.getAttribute("data-col-total")).toBe("2");
    expect(colTotalCell?.textContent).toBe("2");
    // S-01/cli, S-01/storage, S-02/storage.
    expect(grandTotalCell?.getAttribute("data-grand-total")).toBe("3");
    expect(grandTotalCell?.textContent).toBe("3");
  });

  test("toggling a cell back OFF restores the row/column/grand totals", () => {
    const state = baseState();
    const { table } = mountFixture(state);

    const cell = table.querySelector('td[data-force-id="S-01"][data-component="cli"]');
    if (!(cell instanceof HTMLTableCellElement)) throw new Error("cell not found");
    const row = table.querySelector('tr.force-row[data-force-id="S-01"]');
    const cliColTotalCell = table.querySelector('tfoot td[data-col-total][data-component="cli"]');
    const grandTotalCell = table.querySelector("tfoot [data-grand-total]");

    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); // off
    expect(row?.getAttribute("data-row-total")).toBe("0");
    expect(cliColTotalCell?.getAttribute("data-col-total")).toBe("0");
    expect(grandTotalCell?.getAttribute("data-grand-total")).toBe("1"); // only S-02/storage remains

    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); // back on
    expect(row?.getAttribute("data-row-total")).toBe("1");
    expect(cliColTotalCell?.getAttribute("data-col-total")).toBe("1");
    expect(grandTotalCell?.getAttribute("data-grand-total")).toBe("2");
  });
});

describe("mount — right-click context menu adds a row above/below", () => {
  test("right-clicking a force-row shows a context menu with 'Add row above' and 'Add row below' menu items", () => {
    const state = baseState();
    const { table } = mountFixture(state);
    const row = table.querySelector('tr.force-row[data-force-id="S-01"]');
    if (!(row instanceof HTMLTableRowElement)) throw new Error("row not found");

    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

    const menu = document.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent?.trim());
    expect(items).toEqual(["Add row above", "Add row below"]);
  });

  test("choosing 'Add row above' calls addForceRow and inserts the new row immediately before the anchor row", () => {
    const state = baseState();
    const { table, getState } = mountFixture(state);
    const anchor = table.querySelector('tr.force-row[data-force-id="S-01"]');
    if (!(anchor instanceof HTMLTableRowElement)) throw new Error("row not found");

    anchor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const addAboveItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === "Add row above",
    );
    if (!(addAboveItem instanceof HTMLElement)) throw new Error("menu item not found");
    addAboveItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getState().addedForces).toHaveLength(1);
    const tempId = getState().addedForces[0]?.tempId;
    expect(tempId).toBeDefined();

    const newRow = anchor.previousElementSibling;
    expect(newRow?.classList.contains("force-row")).toBe(true);
    expect(newRow?.getAttribute("data-force-id")).toBe(tempId);
  });

  test("choosing 'Add row below' calls addForceRow and inserts the new row immediately after the anchor row", () => {
    const state = baseState();
    const { table, getState } = mountFixture(state);
    const anchor = table.querySelector('tr.force-row[data-force-id="S-01"]');
    if (!(anchor instanceof HTMLTableRowElement)) throw new Error("row not found");

    anchor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const addBelowItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === "Add row below",
    );
    if (!(addBelowItem instanceof HTMLElement)) throw new Error("menu item not found");
    addBelowItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getState().addedForces).toHaveLength(1);
    const tempId = getState().addedForces[0]?.tempId;

    const newRow = anchor.nextElementSibling;
    expect(newRow?.classList.contains("force-row")).toBe(true);
    expect(newRow?.getAttribute("data-force-id")).toBe(tempId);
  });

  test("the newly-inserted row's kind matches the anchor row's kind", () => {
    const state = baseState();
    const { table, getState } = mountFixture(state);
    const anchor = table.querySelector('tr.force-row[data-force-id="S-01"]'); // kind: stressor
    if (!(anchor instanceof HTMLTableRowElement)) throw new Error("row not found");

    anchor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const addBelowItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === "Add row below",
    );
    if (!(addBelowItem instanceof HTMLElement)) throw new Error("menu item not found");
    addBelowItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getState().addedForces[0]?.kind).toBe("stressor");
    const newRow = anchor.nextElementSibling;
    expect(newRow?.getAttribute("data-force-kind")).toBe("stressor");
    expect(newRow?.getAttribute("data-force-kind-glyph")).toBe("stressor");
    expect(newRow?.querySelector(".force-kind-glyph")?.classList.contains("force-kind-stressor")).toBe(true);
    expect(newRow?.classList.contains("force-attractor-tint")).toBe(true);
    const attractorId = newRow?.getAttribute("data-attractor-id") ?? "";
    expect((newRow as HTMLElement | null)?.style.getPropertyValue("--force-attractor-color")).toBe(
      attractorColorForId(attractorId),
    );
    expect(newRow?.querySelector("td[data-residue-cell] .force-kind-glyph")).toBeNull();
  });

  test("the newly-inserted row starts open in edit mode: force-detail is not hidden and shows input/select fields, not read-only text", () => {
    const state = baseState();
    const { table } = mountFixture(state);
    const anchor = table.querySelector('tr.force-row[data-force-id="S-01"]');
    if (!(anchor instanceof HTMLTableRowElement)) throw new Error("row not found");

    anchor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const addAboveItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === "Add row above",
    );
    if (!(addAboveItem instanceof HTMLElement)) throw new Error("menu item not found");
    addAboveItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const newRow = anchor.previousElementSibling;
    const detail = newRow?.querySelector(".force-detail");
    expect(detail).not.toBeNull();
    expect(detail?.hasAttribute("hidden")).toBe(false);
    expect(detail?.querySelectorAll("input").length).toBeGreaterThan(0);
    expect(detail?.querySelector("select")).not.toBeNull();
    // No read-only <dl> in the initial edit-mode render for a brand new row.
    expect(detail?.querySelector("dl")).toBeNull();
  });
});

describe("mount — editing an existing row's fields via the Edit button", () => {
  test("the force-detail dl has an Edit button appended, and clicking it swaps dd values for pre-filled inputs/select", () => {
    const state = baseState();
    const { table } = mountFixture(state);
    const editButton = Array.from(table.querySelectorAll('th[data-force-id="S-01"] button')).find(
      (b) => b.textContent?.trim() === "Edit",
    );
    expect(editButton).toBeDefined();
    if (!(editButton instanceof HTMLElement)) throw new Error("edit button not found");

    editButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const th = table.querySelector('th[data-force-id="S-01"]');
    const descriptionInput = th?.querySelector('textarea[name="description"]');
    const naiveChangeInput = th?.querySelector('textarea[name="naiveChangeOrFeature"]');
    const outcomesInput = th?.querySelector('textarea[name="outcomes"]');
    const attractorSelect = th?.querySelector("select");

    expect(descriptionInput).toBeInstanceOf(HTMLTextAreaElement);
    expect((descriptionInput as HTMLTextAreaElement | undefined)?.value).toBe(forceS01.description);
    expect((naiveChangeInput as HTMLTextAreaElement | undefined)?.value).toBe(forceS01.naiveChangeOrFeature);
    expect((outcomesInput as HTMLTextAreaElement | undefined)?.value).toBe(forceS01.outcomes);
    expect(attractorSelect).toBeInstanceOf(HTMLSelectElement);
    expect((attractorSelect as HTMLSelectElement).value).toBe("A-01");

    const options = attractorOptions(state);
    const optionEls = Array.from((attractorSelect as HTMLSelectElement).options);
    expect(optionEls.map((o) => o.value)).toEqual(options.map((o) => o.id));

    const buttons = Array.from(th?.querySelectorAll("button") ?? []).map((b) => b.textContent?.trim());
    expect(buttons).toContain("OK");
    expect(buttons).toContain("Cancel");
    expect(buttons).not.toContain("Edit");
  });

  test("clicking OK calls updateForceField for the edited fields and swaps back to a read-only dl showing the new values", () => {
    const state = baseState();
    const { table, getState } = mountFixture(state);
    const th = table.querySelector('th[data-force-id="S-01"]');
    if (!th) throw new Error("th not found");
    const editButton = Array.from(th.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Edit");
    if (!(editButton instanceof HTMLElement)) throw new Error("edit button not found");
    editButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const descriptionInput = th.querySelector('textarea[name="description"]');
    if (!(descriptionInput instanceof HTMLTextAreaElement)) throw new Error("description input not found");
    descriptionInput.value = "queue backs up even under moderate load";
    descriptionInput.dispatchEvent(new Event("input", { bubbles: true }));

    const okButton = Array.from(th.querySelectorAll("button")).find((b) => b.textContent?.trim() === "OK");
    if (!(okButton instanceof HTMLElement)) throw new Error("OK button not found");
    okButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const expected = updateForceField(state, "S-01", "description", "queue backs up even under moderate load");
    expect(getState().updatedForces["S-01"]?.description).toBe("queue backs up even under moderate load");
    expect(getState()).toEqual(expected);

    const dl = th.querySelector("dl");
    expect(dl).not.toBeNull();
    const buttons = Array.from(th.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(buttons).toContain("Edit");
    expect(buttons).not.toContain("OK");
    expect(dl?.textContent).toContain("queue backs up even under moderate load");
  });

  test("changing an existing force's attractor updates its tint", () => {
    const state = baseState();
    const { table } = mountFixture(state);
    const row = table.querySelector<HTMLTableRowElement>('tr.force-row[data-force-id="S-01"]');
    const th = row?.querySelector("th.sticky-col");
    if (!row || !th) throw new Error("force row not found");
    const editButton = Array.from(th.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Edit");
    if (!(editButton instanceof HTMLElement)) throw new Error("edit button not found");
    editButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const select = th.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) throw new Error("attractor select not found");
    select.value = "A-02";
    const okButton = Array.from(th.querySelectorAll("button")).find((button) => button.textContent?.trim() === "OK");
    if (!(okButton instanceof HTMLElement)) throw new Error("OK button not found");
    okButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(row.getAttribute("data-attractor-id")).toBe("A-02");
    expect(row.style.getPropertyValue("--force-attractor-color")).toBe(attractorColorForId("A-02"));
  });

  test("clicking Cancel discards input changes, restores the original dl values, and does not mutate state", () => {
    const state = baseState();
    const { table, getState } = mountFixture(state);
    const th = table.querySelector('th[data-force-id="S-01"]');
    if (!th) throw new Error("th not found");
    const editButton = Array.from(th.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Edit");
    if (!(editButton instanceof HTMLElement)) throw new Error("edit button not found");
    editButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const descriptionInput = th.querySelector('textarea[name="description"]');
    if (!(descriptionInput instanceof HTMLTextAreaElement)) throw new Error("description input not found");
    descriptionInput.value = "this edit should be discarded";
    descriptionInput.dispatchEvent(new Event("input", { bubbles: true }));

    const cancelButton = Array.from(th.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Cancel");
    if (!(cancelButton instanceof HTMLElement)) throw new Error("Cancel button not found");
    cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getState()).toEqual(state);
    const dl = th.querySelector("dl");
    expect(dl?.textContent).toContain(forceS01.description);
    expect(dl?.textContent).not.toContain("this edit should be discarded");
    const buttons = Array.from(th.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(buttons).toContain("Edit");
    expect(buttons).not.toContain("OK");
  });
});

describe("mount — invalid-row marking", () => {
  test("a force whose key is in computeInvalidMarks(state).invalidForceKeys gets the row-invalid class on its sticky label th and its tr, while a valid force does not", () => {
    // S-02's description is blanked via a pending update, making it invalid
    // per model.ts's isForceValid (required field empty) — see
    // computeStateValidity in model.ts and computeInvalidMarks in
    // render-decisions.ts, which this test relies on rather than
    // reimplementing.
    const state = baseState({
      updatedForces: { "S-02": { description: "" } },
    });
    expect(computeInvalidMarks(state).invalidForceKeys.has("S-02")).toBe(true);
    expect(computeInvalidMarks(state).invalidForceKeys.has("S-01")).toBe(false);

    const { table } = mountFixture(state);

    const invalidTh = table.querySelector('th.sticky-col[data-force-id="S-02"]');
    const invalidTr = table.querySelector('tr.force-row[data-force-id="S-02"]');
    const validTh = table.querySelector('th.sticky-col[data-force-id="S-01"]');
    const validTr = table.querySelector('tr.force-row[data-force-id="S-01"]');

    expect(invalidTh?.classList.contains("row-invalid")).toBe(true);
    expect(invalidTr?.classList.contains("row-invalid")).toBe(true);
    expect(validTh?.classList.contains("row-invalid")).toBe(false);
    expect(validTr?.classList.contains("row-invalid")).toBe(false);
  });

  test("toggling off a force's only component makes it invalid, and mount reflects that with row-invalid after the interaction", () => {
    // S-02 starts with exactly one component ("storage"); toggling it off
    // leaves zero components, which isForceValid (model.ts) treats as
    // invalid regardless of the text fields.
    const state = baseState();
    const { table, getState } = mountFixture(state);

    const cell = table.querySelector('td[data-force-id="S-02"][data-component="storage"]');
    if (!(cell instanceof HTMLTableCellElement)) throw new Error("cell not found");
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(computeInvalidMarks(getState()).invalidForceKeys.has("S-02")).toBe(true);

    const th = table.querySelector('th.sticky-col[data-force-id="S-02"]');
    const tr = table.querySelector('tr.force-row[data-force-id="S-02"]');
    expect(th?.classList.contains("row-invalid")).toBe(true);
    expect(tr?.classList.contains("row-invalid")).toBe(true);
  });
});

describe("mount — sanity: addForceRow reducer stays untouched by this module", () => {
  test("addForceRow itself (imported directly, not via mount) still behaves as documented in actions.test.ts", () => {
    const state = baseState();
    const { state: next, tempId } = addForceRow(state, "purpose");
    expect(next.addedForces).toHaveLength(1);
    expect(next.addedForces[0]?.tempId).toBe(tempId);
    expect(next.addedForces[0]?.kind).toBe("purpose");
  });
});

describe("mount — syncNewRows (rows added by external callers, e.g. below-table forms)", () => {
  test("inserts a tr for an addedForces entry that has no row yet, so it becomes toggleable", () => {
    const state = baseState();
    const { table, getState, setState, syncNewRows } = mountFixture(state);

    // Simulate an external caller (forms.ts) adding a force directly via the
    // reducer, bypassing mount()'s own context-menu row-insertion path.
    const { state: next, tempId } = addForceRow(getState(), "stressor");
    setState(next);
    expect(table.querySelector(`tr.force-row[data-force-id="${tempId}"]`)).toBeNull();

    syncNewRows();

    const row = table.querySelector(`tr.force-row[data-force-id="${tempId}"]`);
    expect(row).not.toBeNull();
    const cell = row?.querySelector(`td[data-residue-cell][data-component="cli"]`);
    expect(cell).not.toBeNull();
  });

  test("is idempotent — calling it again does not insert a duplicate row", () => {
    const state = baseState();
    const { table, getState, setState, syncNewRows } = mountFixture(state);
    const { state: next, tempId } = addForceRow(getState(), "stressor");
    setState(next);

    syncNewRows();
    syncNewRows();

    expect(table.querySelectorAll(`tr.force-row[data-force-id="${tempId}"]`)).toHaveLength(1);
  });
});
