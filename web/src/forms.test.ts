import { beforeEach, describe, expect, test } from "bun:test";
import { addAttractorOption, addComponentColumn, addForceRow, updateForceField } from "./actions";
import { emptyPendingState, mountForms, regenerateStagedCommands } from "./forms";
import { toCommandLines, type PendingState, type SnapshotAttractor, type SnapshotComponent, type SnapshotForce } from "./model";

// ---------------------------------------------------------------------------
// Fixtures — a minimal PendingState plus a hand-built HTML fixture string
// mirroring the relevant slice of src/view/shell.html: the four
// `form[data-command-generator]` elements, the toolbar's two NEW visibility
// checkboxes (`data-show-proposed-toggle` / `data-show-unrelated-toggle`,
// not yet in shell.html itself — see the task's fixture design note), the
// live `<table class="matrix">` (mirroring matrix-interactions.test.ts's
// fixture shape so column-insertion assertions have real thead/tbody/tfoot
// structure to act on), `#staged-commands`, `#copy-staged`, `#clear-staged`.
//
// Design decisions pinned by these tests (documented per repo instructions):
//
// - Synthetic attractor id scheme (cli-schema.json's "add attractor" has NO
//   id flag — confirmed by reading web/generated/cli-schema.json directly):
//   `NEW-ATTR-<n>`, where n is one more than the max N found in existing
//   `state.addedAttractors` ids matching `/^NEW-ATTR-(\d+)$/` (max + 1, not
//   count + 1) — mirrors actions.ts's `addForceRow` tempId scheme exactly,
//   for the same collision-after-removal-proofing rationale.
// - Duplicate-component-name error UX: the component form gains a sibling
//   `<p data-component-form-error></p>` (present but empty in the fixture);
//   on a duplicate `addComponentColumn` throw, mountForms catches it, sets
//   that element's `.textContent` to a non-empty message, and adds
//   `aria-invalid="true"` to the form's `name` input — WITHOUT calling
//   `setState`, touching the table, or letting the exception escape the
//   submit handler. A subsequent successful (non-duplicate) submit clears
//   both the error text and the `aria-invalid` attribute.
// ---------------------------------------------------------------------------

const attractorResilience: SnapshotAttractor = {
  id: "A-01",
  name: "resilience",
  description: "system tolerates partial failure",
  positiveState: "graceful degradation",
  negativeState: "cascading failure",
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
  status: "proposed",
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

function baseState(overrides: Partial<PendingState> = {}): PendingState {
  return {
    baseAttractors: [attractorResilience],
    baseComponents: [componentCli, componentStorage],
    baseForces: [forceS01],
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

function forceRowHtml(force: SnapshotForce, components: SnapshotComponent[]): string {
  const total = force.components.length;
  const cells = components
    .map((c) => {
      const coupled = force.components.includes(c.name);
      return `<td data-residue-cell="true" data-force-id="${force.id}" data-component="${c.name}" data-coupled="${
        coupled ? "1" : "0"
      }">${coupled ? "1" : ""}</td>`;
    })
    .join("");
  return `<tr class="force-row" data-force-id="${force.id}" data-force-kind="${force.kind}">
      <th class="sticky-col" data-force-id="${force.id}"></th>
      ${cells}
      <td class="sticky-col-right" data-row-total="${total}">${total}</td>
    </tr>`;
}

function fixtureTableHtml(state: PendingState): string {
  const components = [...state.baseComponents, ...state.addedComponents];
  const forces = [...state.baseForces, ...state.addedForces];

  const headerCells = components
    .map((c) => `<th class="sticky-row" data-component="${c.name}">${c.name}</th>`)
    .join("");
  const rows = forces.map((f) => forceRowHtml(f as SnapshotForce, components)).join("");
  const footerCells = components.map((c) => `<td data-col-total="0" data-component="${c.name}">0</td>`).join("");

  return `<table class="matrix">
      <thead><tr>
        <th class="sticky-col sticky-row corner">force</th>
        ${headerCells}
        <th class="sticky-row sticky-col-right corner">total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <th class="sticky-col corner">totals</th>
        ${footerCells}
        <td class="sticky-col-right corner" data-grand-total="0">0</td>
      </tr></tfoot>
    </table>`;
}

function forceFormHtml(kind: "stressor" | "purpose"): string {
  return `<form data-command-generator="${kind}">
      <fieldset>
        <legend>${kind}</legend>
        <input name="description" type="text" />
        <input name="attractor_shortname" type="text" />
        <input name="naive_change" type="text" />
        <input name="shortname" type="text" />
        <input name="outcomes" type="text" />
        <button type="submit">stage</button>
      </fieldset>
    </form>`;
}

function fixtureHtml(state: PendingState): string {
  return `
    <div class="view-toolbar" data-view-toolbar>
      <input type="search" data-force-filter />
      <label><input type="checkbox" data-fusion-fission-filter /></label>
      <label><input type="checkbox" data-show-proposed-toggle checked /> show proposed</label>
      <label><input type="checkbox" data-show-unrelated-toggle checked /> show unrelated</label>
    </div>
    ${fixtureTableHtml(state)}
    ${forceFormHtml("stressor")}
    ${forceFormHtml("purpose")}
    <form data-command-generator="attractor">
      <fieldset>
        <legend>attractor</legend>
        <input name="name" type="text" />
        <input name="description" type="text" />
        <input name="positive_state" type="text" />
        <input name="negative_state" type="text" />
        <button type="submit">stage</button>
      </fieldset>
    </form>
    <form data-command-generator="component">
      <fieldset>
        <legend>component</legend>
        <input name="name" type="text" />
        <input name="description" type="text" />
        <input name="status" type="text" />
        <input name="architecture_set" type="text" />
        <button type="submit">stage</button>
      </fieldset>
      <p data-component-form-error></p>
    </form>
    <textarea id="staged-commands" readonly></textarea>
    <button type="button" id="copy-staged">copy</button>
    <button type="button" id="clear-staged">clear</button>
  `;
}

function mountFixture(state: PendingState): {
  container: HTMLElement;
  getState: () => PendingState;
  setState: (next: PendingState) => void;
  changeCount: () => number;
} {
  document.body.innerHTML = fixtureHtml(state);
  const container = document.body;

  let current = state;
  let changes = 0;
  const getState = (): PendingState => current;
  const setState = (next: PendingState): void => {
    current = next;
  };

  mountForms(container, getState, setState, {
    onChange: () => {
      changes += 1;
    },
  });

  return { container, getState, setState, changeCount: () => changes };
}

function setInput(form: Element, name: string, value: string): void {
  const input = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!input) throw new Error(`fixture setup failed: input "${name}" not found`);
  input.value = value;
}

function submit(form: Element): Event {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("emptyPendingState", () => {
  test("keeps base* snapshot arrays, empties every added*/updated* collection", () => {
    const state = baseState({
      addedComponents: [{ name: "new-thing", description: "d", status: "proposed", architectureSet: "iter1" }],
      updatedForces: { "S-01": { description: "changed" } },
    });

    const result = emptyPendingState(state);

    expect(result.baseAttractors).toEqual(state.baseAttractors);
    expect(result.baseComponents).toEqual(state.baseComponents);
    expect(result.baseForces).toEqual(state.baseForces);
    expect(result.basePersonas).toEqual(state.basePersonas);
    expect(result.baseTerms).toEqual(state.baseTerms);

    expect(result.addedAttractors).toEqual([]);
    expect(result.addedComponents).toEqual([]);
    expect(result.addedForces).toEqual([]);
    expect(result.addedPersonas).toEqual([]);
    expect(result.addedTerms).toEqual([]);

    expect(result.updatedAttractors).toEqual({});
    expect(result.updatedComponents).toEqual({});
    expect(result.updatedForces).toEqual({});
    expect(result.updatedPersonas).toEqual({});
    expect(result.updatedTerms).toEqual({});
  });
});

describe("regenerateStagedCommands", () => {
  test("sets #staged-commands' value to toCommandLines output, joined, invalid lines '# '-prefixed", () => {
    const state = baseState({
      addedComponents: [{ name: "queue", description: "d", status: "actual", architectureSet: "iter1" }],
      addedForces: [
        {
          tempId: "NEW-1",
          kind: "stressor",
          description: "",
          attractorId: "",
          naiveChangeOrFeature: "",
          outcomes: "",
          shortname: "",
          components: [],
        },
      ],
    });
    document.body.innerHTML = `<textarea id="staged-commands"></textarea>`;

    regenerateStagedCommands(document.body, () => state);

    const textarea = document.getElementById("staged-commands");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("fixture setup failed");

    const expectedLines = toCommandLines(state).map((cl) => (cl.valid ? cl.line : `# ${cl.line}`));
    expect(textarea.value).toBe(expectedLines.join("\n"));
    // Sanity: this state has both a valid (component add) and invalid (empty
    // force) line, so the assertion above isn't vacuously true.
    expect(toCommandLines(state).some((cl) => cl.valid)).toBe(true);
    expect(toCommandLines(state).some((cl) => !cl.valid)).toBe(true);
  });
});

describe("mountForms — stressor/purpose form submit", () => {
  test("submitting the stressor form calls addForceRow + updateForceField per non-empty field, setState's the result", () => {
    const state = baseState();
    const { container, getState, changeCount } = mountFixture(state);

    const form = container.querySelector('form[data-command-generator="stressor"]');
    if (!form) throw new Error("fixture setup failed");
    setInput(form, "description", "disk fills under sustained writes");
    setInput(form, "attractor_shortname", "A-01");
    setInput(form, "naive_change", "add cleanup job");
    setInput(form, "shortname", "disk-full");
    // outcomes left empty on purpose.

    const event = submit(form);

    expect(event.defaultPrevented).toBe(true);
    expect(getState().addedForces).toHaveLength(1);
    const added = getState().addedForces[0]!;
    expect(added.kind).toBe("stressor");
    expect(added.description).toBe("disk fills under sustained writes");
    expect(added.attractorId).toBe("A-01");
    expect(added.naiveChangeOrFeature).toBe("add cleanup job");
    expect(added.shortname).toBe("disk-full");
    expect(added.outcomes).toBe("");
    expect(changeCount()).toBeGreaterThan(0);
  });

  test("submitting the purpose form adds a 'purpose'-kind force", () => {
    const state = baseState();
    const { container, getState } = mountFixture(state);

    const form = container.querySelector('form[data-command-generator="purpose"]');
    if (!form) throw new Error("fixture setup failed");
    setInput(form, "description", "users need audit trail");
    setInput(form, "attractor_shortname", "A-01");
    setInput(form, "naive_change", "add logging");

    submit(form);

    expect(getState().addedForces).toHaveLength(1);
    expect(getState().addedForces[0]!.kind).toBe("purpose");
  });

  test("resets the form's inputs after a successful submit", () => {
    const state = baseState();
    const { container } = mountFixture(state);
    const form = container.querySelector('form[data-command-generator="stressor"]');
    if (!(form instanceof HTMLFormElement)) throw new Error("fixture setup failed");
    setInput(form, "description", "x");
    setInput(form, "attractor_shortname", "A-01");
    setInput(form, "naive_change", "y");

    submit(form);

    expect(form.querySelector<HTMLInputElement>('[name="description"]')!.value).toBe("");
    expect(form.querySelector<HTMLInputElement>('[name="attractor_shortname"]')!.value).toBe("");
    expect(form.querySelector<HTMLInputElement>('[name="naive_change"]')!.value).toBe("");
  });

  test("regenerates #staged-commands after a successful submit", () => {
    const state = baseState();
    const { container, getState } = mountFixture(state);
    const form = container.querySelector('form[data-command-generator="stressor"]');
    if (!form) throw new Error("fixture setup failed");
    setInput(form, "description", "x");
    setInput(form, "attractor_shortname", "A-01");
    setInput(form, "naive_change", "y");

    submit(form);

    const textarea = document.getElementById("staged-commands");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("fixture setup failed");
    const expectedLines = toCommandLines(getState()).map((cl) => (cl.valid ? cl.line : `# ${cl.line}`));
    expect(textarea.value).toBe(expectedLines.join("\n"));
    expect(textarea.value.length).toBeGreaterThan(0);
  });
});

describe("mountForms — attractor form submit", () => {
  test("assigns a synthetic id NEW-ATTR-1 for the first added attractor and calls addAttractorOption", () => {
    const state = baseState();
    const { container, getState } = mountFixture(state);

    const form = container.querySelector('form[data-command-generator="attractor"]');
    if (!form) throw new Error("fixture setup failed");
    setInput(form, "name", "adaptability");
    setInput(form, "description", "system absorbs novel stressors");
    setInput(form, "positive_state", "flexible response");
    setInput(form, "negative_state", "brittle failure");

    submit(form);

    expect(getState().addedAttractors).toHaveLength(1);
    const added = getState().addedAttractors[0]!;
    expect(added.id).toBe("NEW-ATTR-1");
    expect(added.name).toBe("adaptability");
    expect(added.description).toBe("system absorbs novel stressors");
    expect(added.positiveState).toBe("flexible response");
    expect(added.negativeState).toBe("brittle failure");

    // Cross-check against the pure reducer directly, to pin the exact shape.
    const expected = addAttractorOption(state, {
      id: "NEW-ATTR-1",
      name: "adaptability",
      description: "system absorbs novel stressors",
      positiveState: "flexible response",
      negativeState: "brittle failure",
    });
    expect(getState()).toEqual(expected);
  });

  test("assigns NEW-ATTR-2 for a second added attractor in the same session", () => {
    const state = baseState({
      addedAttractors: [
        {
          id: "NEW-ATTR-1",
          name: "adaptability",
          description: "d",
          positiveState: "p",
          negativeState: "n",
        },
      ],
    });
    const { container, getState } = mountFixture(state);

    const form = container.querySelector('form[data-command-generator="attractor"]');
    if (!form) throw new Error("fixture setup failed");
    setInput(form, "name", "resilience-2");
    setInput(form, "description", "d2");
    setInput(form, "positive_state", "p2");
    setInput(form, "negative_state", "n2");

    submit(form);

    expect(getState().addedAttractors).toHaveLength(2);
    expect(getState().addedAttractors[1]!.id).toBe("NEW-ATTR-2");
  });
});

describe("mountForms — component form submit", () => {
  test("adds a component via addComponentColumn, setState's, and inserts a column into thead/tbody/tfoot", () => {
    const state = baseState();
    const { container, getState } = mountFixture(state);
    const table = container.querySelector("table.matrix");
    if (!table) throw new Error("fixture setup failed");

    const theadRowBefore = table.querySelectorAll("thead th").length;
    const bodyRowsBefore = table.querySelectorAll("tbody tr.force-row").length;
    const tfootCellsBefore = table.querySelectorAll("tfoot td[data-component]").length;

    const form = container.querySelector('form[data-command-generator="component"]');
    if (!form) throw new Error("fixture setup failed");
    setInput(form, "name", "queue");
    setInput(form, "description", "message queue");
    setInput(form, "status", "proposed");
    setInput(form, "architecture_set", "iter2");

    submit(form);

    expect(getState().addedComponents).toHaveLength(1);
    expect(getState().addedComponents[0]).toEqual({
      name: "queue",
      description: "message queue",
      status: "proposed",
      architectureSet: "iter2",
    });

    expect(table.querySelectorAll("thead th").length).toBe(theadRowBefore + 1);
    const newHeader = table.querySelector('thead th[data-component="queue"]');
    expect(newHeader).not.toBeNull();
    expect(newHeader?.getAttribute("data-component-status-shape")).toBe("proposed");
    expect(newHeader?.querySelector(".component-status-glyph")?.classList.contains("status-shape-square")).toBe(true);

    const bodyRowsAfter = table.querySelectorAll("tbody tr.force-row");
    expect(bodyRowsAfter.length).toBe(bodyRowsBefore); // no new rows, only a new column
    for (const row of Array.from(bodyRowsAfter)) {
      const cell = row.querySelector('td[data-residue-cell][data-component="queue"]');
      expect(cell).not.toBeNull();
      expect(cell!.getAttribute("data-coupled")).toBe("0");
      expect(cell!.getAttribute("data-force-id")).toBe(row.getAttribute("data-force-id"));
    }

    expect(table.querySelectorAll("tfoot td[data-component]").length).toBe(tfootCellsBefore + 1);
    const footerCell = table.querySelector('tfoot td[data-component="queue"]');
    expect(footerCell).not.toBeNull();
    expect(footerCell!.getAttribute("data-col-total")).toBe("0");
  });

  test("submitting a duplicate name (already in baseComponents) shows an error and does not mutate state or the table", () => {
    const state = baseState();
    const { container, getState } = mountFixture(state);
    const table = container.querySelector("table.matrix");
    if (!table) throw new Error("fixture setup failed");
    const theadCountBefore = table.querySelectorAll("thead th").length;

    const form = container.querySelector('form[data-command-generator="component"]');
    if (!form) throw new Error("fixture setup failed");
    setInput(form, "name", "cli"); // already in baseComponents
    setInput(form, "description", "duplicate");
    setInput(form, "status", "actual");
    setInput(form, "architecture_set", "iter1");

    expect(() => submit(form)).not.toThrow();

    expect(getState().addedComponents).toHaveLength(0);
    expect(table.querySelectorAll("thead th").length).toBe(theadCountBefore);

    const errorEl = container.querySelector('[data-component-form-error]');
    expect(errorEl).not.toBeNull();
    expect(errorEl!.textContent).not.toBe("");
    const nameInput = form.querySelector<HTMLInputElement>('[name="name"]');
    expect(nameInput!.getAttribute("aria-invalid")).toBe("true");
  });

  test("a subsequent successful submit clears a prior duplicate-name error", () => {
    const state = baseState();
    const { container, getState } = mountFixture(state);
    const form = container.querySelector('form[data-command-generator="component"]');
    if (!form) throw new Error("fixture setup failed");

    setInput(form, "name", "cli");
    setInput(form, "description", "duplicate");
    setInput(form, "status", "actual");
    setInput(form, "architecture_set", "iter1");
    submit(form);

    setInput(form, "name", "queue");
    setInput(form, "description", "message queue");
    setInput(form, "status", "proposed");
    setInput(form, "architecture_set", "iter2");
    submit(form);

    expect(getState().addedComponents).toHaveLength(1);
    const errorEl = container.querySelector('[data-component-form-error]');
    expect(errorEl!.textContent).toBe("");
    const nameInput = form.querySelector<HTMLInputElement>('[name="name"]');
    expect(nameInput!.hasAttribute("aria-invalid")).toBe(false);
  });
});

describe("mountForms — visibility toggles", () => {
  function hiddenComponents(table: Element): Set<string> {
    const hidden = new Set<string>();
    for (const el of Array.from(table.querySelectorAll("[data-component]"))) {
      const name = el.getAttribute("data-component");
      if (name === null) continue;
      const isHidden = el.hasAttribute("hidden") || (el as HTMLElement).hidden === true;
      if (isHidden) hidden.add(name);
    }
    return hidden;
  }

  test("unchecking show-proposed hides every th/td for 'storage' (status: proposed) across thead/tbody/tfoot", () => {
    const state = baseState();
    const { container } = mountFixture(state);
    const table = container.querySelector("table.matrix");
    if (!table) throw new Error("fixture setup failed");

    const toggle = container.querySelector<HTMLInputElement>("[data-show-proposed-toggle]");
    if (!toggle) throw new Error("fixture setup failed");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    const hidden = hiddenComponents(table);
    expect(hidden.has("storage")).toBe(true);
    expect(hidden.has("cli")).toBe(false);

    // thead, tbody, and tfoot elements for "storage" must all be hidden.
    expect(table.querySelector('thead th[data-component="storage"]')).toSatisfy(
      (el: Element | null) => el !== null && (el.hasAttribute("hidden") || (el as HTMLElement).hidden),
    );
    expect(table.querySelector('tbody td[data-component="storage"]')).toSatisfy(
      (el: Element | null) => el !== null && (el.hasAttribute("hidden") || (el as HTMLElement).hidden),
    );
    expect(table.querySelector('tfoot td[data-component="storage"]')).toSatisfy(
      (el: Element | null) => el !== null && (el.hasAttribute("hidden") || (el as HTMLElement).hidden),
    );
  });

  test("re-checking show-proposed un-hides 'storage' again", () => {
    const state = baseState();
    const { container } = mountFixture(state);
    const table = container.querySelector("table.matrix");
    if (!table) throw new Error("fixture setup failed");
    const toggle = container.querySelector<HTMLInputElement>("[data-show-proposed-toggle]");
    if (!toggle) throw new Error("fixture setup failed");

    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(hiddenComponents(table).has("storage")).toBe(false);
  });

  test("unchecking show-unrelated hides every component not coupled to any force (filteredForceIds: null)", () => {
    // "storage" is not coupled to any force in baseState (only "cli" is, via
    // forceS01), so with showUnrelated: false it must be hidden regardless
    // of the showProposed toggle's state.
    const state = baseState();
    const { container } = mountFixture(state);
    const table = container.querySelector("table.matrix");
    if (!table) throw new Error("fixture setup failed");
    const toggle = container.querySelector<HTMLInputElement>("[data-show-unrelated-toggle]");
    if (!toggle) throw new Error("fixture setup failed");

    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    const hidden = hiddenComponents(table);
    expect(hidden.has("storage")).toBe(true);
    expect(hidden.has("cli")).toBe(false);
  });

  test("both toggles off combines the two filters (visibleComponents intersection)", () => {
    const state = baseState({
      baseComponents: [componentCli, componentStorage, { name: "extra", description: "d", status: "actual", architectureSet: "iter1" }],
    });
    const { container } = mountFixture(state);
    const table = container.querySelector("table.matrix");
    if (!table) throw new Error("fixture setup failed");
    const proposedToggle = container.querySelector<HTMLInputElement>("[data-show-proposed-toggle]");
    const unrelatedToggle = container.querySelector<HTMLInputElement>("[data-show-unrelated-toggle]");
    if (!proposedToggle || !unrelatedToggle) throw new Error("fixture setup failed");

    proposedToggle.checked = false;
    proposedToggle.dispatchEvent(new Event("change", { bubbles: true }));
    unrelatedToggle.checked = false;
    unrelatedToggle.dispatchEvent(new Event("change", { bubbles: true }));

    const hidden = hiddenComponents(table);
    // "cli" is coupled (forceS01) and not proposed -> stays visible.
    expect(hidden.has("cli")).toBe(false);
    // "storage" is proposed AND unrelated -> hidden under either filter.
    expect(hidden.has("storage")).toBe(true);
    // "extra" is actual (not proposed) but unrelated -> hidden by showUnrelated alone.
    expect(hidden.has("extra")).toBe(true);
  });
});

describe("mountForms — clear/copy staged buttons", () => {
  test("#clear-staged resets added*/updated* collections to empty and clears the textarea", () => {
    const state = baseState({
      addedComponents: [{ name: "queue", description: "d", status: "actual", architectureSet: "iter1" }],
      updatedForces: { "S-01": { description: "changed" } },
    });
    const { container, getState } = mountFixture(state);
    regenerateStagedCommandsOrSkip(container, getState);

    const clearButton = container.querySelector("#clear-staged");
    if (!clearButton) throw new Error("fixture setup failed");
    clearButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const expected = emptyPendingState(state);
    expect(getState()).toEqual(expected);

    const textarea = document.getElementById("staged-commands");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("fixture setup failed");
    expect(textarea.value).toBe("");
  });

  test("#copy-staged click does not throw even without navigator.clipboard support", () => {
    const state = baseState();
    const { container } = mountFixture(state);
    const copyButton = container.querySelector("#copy-staged");
    if (!copyButton) throw new Error("fixture setup failed");

    expect(() => copyButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))).not.toThrow();
  });
});

// Small helper used only by the clear-staged test above so it doesn't
// hard-fail on regenerateStagedCommands's own not-yet-implemented throw
// while still exercising #clear-staged's independent behavior once green.
function regenerateStagedCommandsOrSkip(container: HTMLElement, getState: () => PendingState): void {
  try {
    regenerateStagedCommands(container, getState);
  } catch {
    // ignored — regenerateStagedCommands is covered by its own describe block.
  }
}

// Sanity check that the pure reducers this module is expected to delegate to
// are indeed importable/usable the way the design above assumes (guards
// against a fixture/API drift going unnoticed if forms.ts's implementation
// takes a very different internal shape later).
describe("delegation sanity", () => {
  test("addForceRow/updateForceField/addComponentColumn/addAttractorOption behave as forms.ts's design assumes", () => {
    const state = baseState();
    const { state: withForce, tempId } = addForceRow(state, "stressor");
    const withField = updateForceField(withForce, tempId, "description", "x");
    expect(withField.addedForces[0]!.description).toBe("x");

    const withComponent = addComponentColumn(state, {
      name: "queue",
      description: "d",
      status: "actual",
      architectureSet: "iter1",
    });
    expect(withComponent.addedComponents).toHaveLength(1);

    const withAttractor = addAttractorOption(state, {
      id: "NEW-ATTR-1",
      name: "n",
      description: "d",
      positiveState: "p",
      negativeState: "neg",
    });
    expect(withAttractor.addedAttractors).toHaveLength(1);
  });
});
