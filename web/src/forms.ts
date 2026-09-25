// DOM-wiring layer for the four "Stage adds" generator forms, the two
// visibility-toggle checkboxes, and the staged-commands textarea/copy/clear
// controls (Phase 5 sibling of matrix-interactions.ts, per
// residual/iterations/view-live-editing-plan.md). Attaches to an
// already-server-rendered fixture matching src/view/shell.html's markup
// contract (forms with `data-command-generator`, the toolbar's two new
// `data-show-proposed-toggle` / `data-show-unrelated-toggle` checkboxes, the
// live `<table class="matrix">`, `#staged-commands`, `#copy-staged`,
// `#clear-staged`).
//
// This module owns DOM mutation only — every state transition is delegated
// to addComponentColumn / addAttractorOption / addForceRow / updateForceField
// (./actions); command-line rendering is delegated to toCommandLines
// (./model); visibility decisions are delegated to visibleComponents
// (./render-decisions).

import { addAttractorOption, addComponentColumn, addForceRow, updateForceField } from "./actions";
import { toCommandLines, type PendingState } from "./model";
import { visibleComponents } from "./render-decisions";
import { decorateComponentHeader } from "./matrix-visuals";

/** Options controlling side effects mountForms() triggers beyond the DOM/state update itself. */
export interface MountFormsOptions {
  /**
   * Called after every state-mutating interaction, once `setState` has
   * already been invoked with the new state — mirrors matrix-interactions.ts's
   * MountOptions.onChange.
   */
  onChange?: () => void;
  onClear?: () => void;
}

/**
 * Regenerates `#staged-commands`'s textarea content from `getState()` via
 * `toCommandLines` (./model): one line per entry, in `toCommandLines`'s
 * order, `#`-prefixed when `valid` is `false`. Exported so it's directly
 * testable without going through a form submission.
 */
export function regenerateStagedCommands(container: HTMLElement, getState: () => PendingState): void {
  const textarea = container.querySelector("#staged-commands");
  if (!(textarea instanceof HTMLTextAreaElement)) return;
  const lines = toCommandLines(getState()).map((cl) => (cl.valid ? cl.line : `# ${cl.line}`));
  textarea.value = lines.join("\n");
}

/**
 * Returns a copy of `base` with every `added*`/`updated*` collection reset to
 * empty, keeping all `base*` snapshot arrays untouched. Mirrors the shape of
 * model.test.ts's `emptyState` helper, but is its own implementation since
 * that helper is private to that test file.
 */
export function emptyPendingState(base: PendingState): PendingState {
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
    removedForces: {},
  };
}

/** Reads a named text input's trimmed-nothing raw value from `form`, defaulting to "" if absent. */
function readInput(form: HTMLFormElement, name: string): string {
  const input = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
  return input?.value ?? "";
}

/**
 * Attaches all live-editing interactions for the below-matrix "Stage adds"
 * forms, the two visibility toggles, and the staged-commands textarea/copy/
 * clear controls to `container` (an already-present element containing the
 * four `form[data-command-generator]` elements, the toolbar checkboxes, the
 * `table.matrix`, `#staged-commands`, `#copy-staged`, and `#clear-staged`).
 *
 * `getState`/`setState` give this module read/write access to the
 * caller-owned `PendingState` without owning it directly, mirroring
 * matrix-interactions.ts's `mount` signature.
 */
export function mountForms(
  container: HTMLElement,
  getState: () => PendingState,
  setState: (next: PendingState) => void,
  options?: MountFormsOptions,
): void {
  function regenerate(): void {
    regenerateStagedCommands(container, getState);
  }

  function wireForceForm(kind: "stressor" | "purpose"): void {
    const form = container.querySelector<HTMLFormElement>(`form[data-command-generator="${kind}"]`);
    if (form === null) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const { state: withRow, tempId } = addForceRow(getState(), kind);
      let next = withRow;

      const fieldMap: Array<[string, "description" | "attractorId" | "naiveChangeOrFeature" | "shortname" | "outcomes"]> = [
        ["description", "description"],
        ["attractor_shortname", "attractorId"],
        ["naive_change", "naiveChangeOrFeature"],
        ["shortname", "shortname"],
        ["outcomes", "outcomes"],
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

  function maxExistingAttractorSuffix(state: PendingState): number {
    let max = 0;
    for (const a of state.addedAttractors) {
      const match = /^NEW-ATTR-(\d+)$/.exec(a.id);
      if (match) {
        const n = Number(match[1]);
        if (n > max) max = n;
      }
    }
    return max;
  }

  function wireAttractorForm(): void {
    const form = container.querySelector<HTMLFormElement>('form[data-command-generator="attractor"]');
    if (form === null) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const state = getState();
      const id = `NEW-ATTR-${maxExistingAttractorSuffix(state) + 1}`;
      const next = addAttractorOption(state, {
        id,
        name: readInput(form, "name"),
        description: readInput(form, "description"),
        positiveState: readInput(form, "positive_state"),
        negativeState: readInput(form, "negative_state"),
      });
      setState(next);
      form.reset();
      regenerate();
      options?.onChange?.();
    });
  }

  function setComponentFormError(form: HTMLFormElement, message: string): void {
    const errorEl = container.querySelector("[data-component-form-error]");
    if (errorEl) errorEl.textContent = message;
    form.querySelector<HTMLInputElement>('[name="name"]')?.setAttribute("aria-invalid", "true");
  }

  function clearComponentFormError(form: HTMLFormElement): void {
    const errorEl = container.querySelector("[data-component-form-error]");
    if (errorEl) errorEl.textContent = "";
    form.querySelector<HTMLInputElement>('[name="name"]')?.removeAttribute("aria-invalid");
  }

  function insertComponentColumn(name: string, status: string): void {
    const table = container.querySelector("table.matrix");
    if (table === null) return;

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

  function wireComponentForm(): void {
    const form = container.querySelector<HTMLFormElement>('form[data-command-generator="component"]');
    if (form === null) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = readInput(form, "name");
      try {
        const next = addComponentColumn(getState(), {
          name,
          description: readInput(form, "description"),
          status: readInput(form, "status") === "proposed" ? "proposed" : "actual",
          architectureSet: readInput(form, "architecture_set"),
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

  function applyVisibility(): void {
    const table = container.querySelector("table.matrix");
    if (table === null) return;
    const proposedToggle = container.querySelector<HTMLInputElement>("[data-show-proposed-toggle]");
    const unrelatedToggle = container.querySelector<HTMLInputElement>("[data-show-unrelated-toggle]");
    const showProposed = proposedToggle?.checked ?? true;
    const showUnrelated = unrelatedToggle?.checked ?? true;
    const filteredForceIds = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr.force-row"))
      .filter((row) => !row.hidden)
      .map((row) => row.getAttribute("data-force-id"))
      .filter((id): id is string => id !== null);

    const visible = new Set(
      visibleComponents(getState(), {
        showProposed,
        showUnrelated,
        filteredForceIds,
      }),
    );

    for (const el of Array.from(table.querySelectorAll<HTMLElement>("[data-component]"))) {
      const name = el.getAttribute("data-component");
      if (name === null) continue;
      const shouldHide = !visible.has(name);
      if (shouldHide) {
        el.setAttribute("hidden", "");
      } else {
        el.removeAttribute("hidden");
      }
    }
  }

  function wireVisibilityToggles(): void {
    const proposedToggle = container.querySelector<HTMLInputElement>("[data-show-proposed-toggle]");
    const unrelatedToggle = container.querySelector<HTMLInputElement>("[data-show-unrelated-toggle]");
    proposedToggle?.addEventListener("change", applyVisibility);
    unrelatedToggle?.addEventListener("change", applyVisibility);
    container.querySelector("[data-force-filter]")?.addEventListener("input", applyVisibility);
  }

  function wireClearButton(): void {
    const clearButton = container.querySelector("#clear-staged");
    clearButton?.addEventListener("click", () => {
      setState(emptyPendingState(getState()));
      regenerate();
      options?.onClear?.();
      options?.onChange?.();
    });
  }

  function wireCopyButton(): void {
    const copyButton = container.querySelector("#copy-staged");
    copyButton?.addEventListener("click", () => {
      const textarea = container.querySelector("#staged-commands");
      const value = textarea instanceof HTMLTextAreaElement ? textarea.value : "";
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (clipboard?.writeText) {
        void clipboard.writeText(value);
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
