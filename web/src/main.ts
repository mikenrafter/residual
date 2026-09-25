// Page entry point for `residual view`'s live-editing UI (Phase 8 of
// residual/iterations/view-live-editing-plan.md — "Cleanup + wiring +
// integration"). Pure orchestration glue over already-tested modules: reads
// the embedded snapshot, holds the single `PendingState` in a module-level
// closure, and wires every mount*/regenerate* function together via a
// shared `onChange` callback so any interaction from any module keeps the
// matrix rows and staged-commands textarea in sync.
//
// No business logic lives here — see model.ts/actions.ts/render-decisions.ts
// for state transitions and validation, and each mount*'s own header comment
// for its DOM contract. Not unit-tested on its own (see the task's explicit
// note that this file is an accepted exception to the repo's normal TDD
// requirement — there is no meaningful unit to red/green here beyond what
// the modules it wires already cover).
//
// Placed as a `<script type="module">` at the very end of `<body>` in
// src/view/shell.html, after `<main>` and after the embedded snapshot
// `<script>` block — every element this file queries already exists in the
// DOM by the time this module executes, so no `DOMContentLoaded` wrapper is
// needed (mirrors the previous inline `<script>` this replaces).

import { snapshotToPendingState, type RawLandscapeSnapshot } from "./snapshot-bridge";
import { mount as mountMatrix } from "./matrix-interactions";
import { mountForms, regenerateStagedCommands } from "./forms";
import { mountImportModal } from "./import-modal";
import { mountExportScript } from "./export-script";
import { mountMatrixView } from "./matrix-view";
import { mountLandscape } from "./nkp-landscape";
import { mountLedgerPanels } from "./ledger-panels";
import type { PendingState } from "./model";
// @ts-ignore The browser loads D3 directly from the same ESM endpoint as slaughter.pro.
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const snapshotElement = document.getElementById("residual-snapshot");
const rawSnapshot: RawLandscapeSnapshot = snapshotElement
  ? (JSON.parse(snapshotElement.textContent ?? "{}") as RawLandscapeSnapshot)
  : { attractors: [], stressors: [], purposes: [], components: [], residues: [] };

let state: PendingState = snapshotToPendingState(rawSnapshot);
const getState = (): PendingState => state;
const setState = (next: PendingState): void => {
  state = next;
};

// document.body, not <main> — the toolbar (search filter, fusion/fission-only
// checkbox, show-proposed/show-unrelated toggles, fission threshold slider)
// is a sibling of <main> in shell.html, not a descendant. Scoping every
// mount*() call's querySelector root to <main> silently broke all of that
// toolbar's interactivity (most visibly: the threshold slider stuck at its
// static min="1" max="1" markup, since mountMatrixView's dynamic min/max/
// value init — see matrix-view.ts — could never find `[data-threshold-input]`
// to update it).
const container = document.body;
mountLedgerPanels(container as HTMLElement);
const table = container.querySelector<HTMLTableElement>("table.matrix");

if (table) {
  const matrixView = mountMatrixView(container as HTMLElement);
  const landscape = mountLandscape(container as HTMLElement, getState, d3);

  const onChange = (): void => {
    regenerateStagedCommands(container as HTMLElement, getState);
    matrixMount.syncNewRows();
    matrixView.recomputeFusionFission();
    landscape.sync();
  };

  const matrixMount = mountMatrix(table, getState, setState, { onChange });

  mountForms(container as HTMLElement, getState, setState, {
    onChange,
    onClear: () => {
      matrixMount.resetDom();
      for (const form of Array.from(container.querySelectorAll<HTMLFormElement>("form"))) form.reset();
      for (const toggle of Array.from(container.querySelectorAll<HTMLInputElement>("[data-show-proposed-toggle], [data-show-unrelated-toggle]"))) {
        toggle.checked = true;
      }
    },
  });
  mountImportModal(container as HTMLElement, getState, setState, { onChange });
  mountExportScript(container as HTMLElement, getState, { onChange });

  matrixView.recomputeFusionFission();
}

regenerateStagedCommands(container as HTMLElement, getState);
