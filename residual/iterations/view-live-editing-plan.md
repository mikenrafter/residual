---
date: "2026-09-12"
branch: tdd-implement/defense-ledger-proposed-components
status: in-progress
notes: "R/G TDD — residual-view live editing: update CLI, CLI-schema/parity metadata, client-side in-memory matrix editing, bidirectional import/export."
---

# TDD Implement — Residual View Live Editing

Orchestration skill: `tdd-implement`. Builds on milestone (a) from the prior
`view-and-serve` plan (static Dioxus-SSR render, merged in 9ad1ff3). Supersedes
that plan's milestones (b)-(f) (axum + dioxus-liveview server) — a live backend
is unnecessary for "purely visual, in-memory" edits; a client-side TS engine
regenerating the existing static DOM satisfies the requirement with far less
surface area, and keeps `residual view`'s output a single dependency-free HTML
file (per the existing `html_command_generator_does_not_mutate_the_ledger` /
no-fetch/no-WS invariant).

## Locked decisions

| Item | Decision |
|------|----------|
| Live backend | **Rejected.** No axum/dioxus-liveview server. All mutation is client-side, in-memory, against the snapshot already embedded in the page. |
| CLI parity mechanism | A hidden `residual internal cli-schema` command serializes clap's real `Command` tree (subcommand + arg flags) to JSON — not a hand-duplicated Rust struct. Single source of truth is `src/cli.rs` itself. |
| TS toolchain | `bun` (already present on the dev host; added explicitly to `flake.nix` devShell `packages` for reproducibility). `bun test` for TS unit/parity tests, `bun build` to produce the shipped bundle. |
| Shipped JS artifact | Compiled bundle (`src/view/generated/app.js`) is **checked into the repo**, not built during `cargo build`/crane's sandboxed derivation (no network/bun guaranteed there). Regenerated via `scripts/gen-view-bundle.sh`, run manually or in CI — not part of `residual verify all`. |
| `src/view/commands.rs` (`StagedAdd`, `format_add_command`) | **Dead code** — built for the abandoned live-server plan, never wired into `static_export.rs` or `cli.rs`. Deleted in Phase 8, not repurposed. |
| Update CLI shape | `residual update <type> --<id-flag> <id> [...same optional flags as add]`, plus repeatable `--add-component`/`--remove-component` on stressor/purpose updates (folds NKP mutation into `update`, superseding `add residue`/`remove residue` as the *generated*-command surface; those subcommands remain for direct CLI use). |
| Row/column ordering | Everywhere emitted or bucketed: components, attractors, personas, forces (stressors/purposes); all `update` commands ordered after all `add` commands. |
| Write-lock header | `residual write authorize` (existing `WriteOp::Authorize`, `src/cli.rs:44`), included only in the downloadable `.sh` script, never in the plain copy-to-clipboard text. |
| Tests | Colocated: Rust tests in `#[cfg(test)]` modules beside the code; TS tests as `*.test.ts` beside their source under `web/`. |

## Phase index

| # | Phase | Surface | Primary forces |
|---|-------|---------|-----------------|
| 0 | Environment scaffolding | `flake.nix`, `web/` skeleton | — |
| 1 | `residual update` CLI | `src/cli.rs`, `src/storage/*.rs` | A-08, P-30/P-31 pattern |
| 2 | CLI schema introspection | `src/cli.rs` (`internal cli-schema`) | A-19 (operator/agent parity trust) |
| 3 | TS import parser + parity tests | `web/src/import-parser.ts` | S-27, A-19 |
| 4 | In-memory model + validation | `web/src/model.ts` | S-26, A-06 |
| 5 | DOM/rendering integration | `web/src/render.ts`, `src/view/shell.html` | S-26, S-27, A-06 |
| 6 | Import modal UI | `web/src/import-modal.ts` | A-06 |
| 7 | Export (bash script) | `web/src/export.ts` | A-08 |
| 8 | Cleanup + wiring + integration | `static_export.rs`, `mod.rs`, delete `commands.rs` | — |

---

## Phase 0 — Environment scaffolding

- Add `pkgs.bun` to `flake.nix` `devShells.default.packages`.
- `web/` layout: `web/src/`, `web/generated/` (checked-in `cli-schema.json` + bundle output target), `web/tsconfig.json`, `scripts/gen-cli-schema.sh`, `scripts/gen-view-bundle.sh`.
- No red/green here (infra only); verified by `nix develop -c bun --version` and `bun test` running (even with zero tests) before Phase 1 starts.

## Phase 1 — `residual update` CLI (P-30/P-31-style)

**Modules:** `src/cli.rs`, `src/storage/{stressors,purposes,attractors,components,terminology,personas,residues}.rs`

| Surface | Behavior |
|---------|----------|
| `residual update stressor --force-id <id> [--description] [--attractor-id] [--naive-change] [--outcomes] [--add-component <id>]... [--remove-component <id>]...` | Patches only supplied fields; add/remove-component mutate the residues.csv row for that force id |
| `residual update purpose --force-id <id> [...same shape, --feature instead of --naive-change]` | ditto |
| `residual update attractor --id <id> [--name] [--positive-state] [--negative-state] [--description]` | ditto |
| `residual update component --name <id> [--description] [--status] [--architecture-set]` | ditto |
| `residual update term --term <id> [--definition]` | ditto |
| `residual update persona --name <id> [--role]` | ditto |

Idempotency/session-hash guards mirror existing `add`/`remove` commands. Unknown id → error, no partial writes.

**Colocated tests:** in each `src/storage/*.rs` module + `src/cli.rs` integration tests (tempdir pattern already used by `remove_residue_clears_matrix_cell` etc).

## Phase 2 — CLI schema introspection

Add a hidden top-level command (not shown in `--help`, e.g. `#[command(hide = true)]`) `residual internal cli-schema` that walks `Cli::command()` (clap's `Command` value, via `<Cli as CommandFactory>::command()`) and serializes: for `add`/`update` subcommands only, `{ subcommand: "add stressor", flags: [{ name, required, multiple, takes_value }] }`.

Red: unit test asserting the schema contains e.g. `"add stressor"` with a `--description` flag marked required, and `"update stressor"` with the same flag marked optional. Green: implement via clap introspection (no hand-listing).

`scripts/gen-cli-schema.sh` runs the built binary and writes `web/generated/cli-schema.json` (checked in, regenerated whenever `cli.rs` flags change — drift is caught by Phase 3's parity test failing against a stale committed schema, so regeneration is a required step, not a suggestion).

## Phase 3 — TS import parser + parity tests

`web/src/import-parser.ts`: tokenizes a pasted line (`residual add stressor --description "..." ...` / `residual update ...`) respecting shell quoting, maps flags to a typed pending-item, validates required flags against `cli-schema.json`. Returns `{ items: PendingItem[], errors: { line: string; message: string }[] }`.

- `web/src/import-parser.test.ts` — hand-written cases per subcommand (happy path, missing required flag, unknown flag, quoting edge cases).
- `web/src/import-parser.parity.test.ts` — loads `cli-schema.json` and, for every documented subcommand/flag, asserts the parser's flag table recognizes it (loop over schema, not a hand-enumerated mirror) — this is the automatic parity mechanism; it fails the moment `cli-schema.json` is regenerated with a flag the parser doesn't know about.

## Phase 4 — In-memory model + validation

`web/src/model.ts`, framework-free pure functions/types:
- `PendingState`: adds + updates per bucket (components, attractors, personas, forces), plus in-memory NKP toggles keyed by force-id×component-id.
- Row validity: required-field-empty check per force type; force additionally invalid iff it has zero components toggled on.
- Ordering: stable bucket sort (components, attractors, personas, forces) with all updates ordered after all adds within/across buckets as specified.
- Command-text generation (`toCommandLines(state): { text: string; invalidLineIndices: number[] }`) — invalid rows' lines prefixed `# `.

`web/src/model.test.ts` covers validation edge cases and ordering.

## Phase 5 — DOM/rendering integration

Replaces the inline `<script>` in `src/view/shell.html` (currently only drives the below-table add forms) with the compiled bundle from `web/src/render.ts`, wired against `model.ts`:
- Right-click context menu → add row above/below (visual reorder only, no stored order) → new row opens in edit mode.
- Double-click on an NKP cell toggles it via `model.ts`.
- Row **Edit** button (no double-click) expands non-NKP fields → **OK**/**Cancel**; attractor field renders as `<select>` populated from the snapshot's attractors plus any added this session.
- Below-table component-add form appends an in-memory column; table re-renders.
- Two checkboxes: show/hide proposed components; show/hide components unrelated to the currently filtered forces.
- Red state: a CSS class distinct from the existing fusion/fission highlight class, applied to invalid cells and propagated to the sticky header cell (column) and sticky label cell (row) for any invalid cell's axis.

Pure "what should be tinted / what rows are valid" decisions stay in `model.ts` (unit-testable); `render.ts` only consumes that output to mutate the DOM — kept thin so it doesn't need a DOM-testing harness. Manual browser verification (`residual view`) closes this phase per the repo's UI-testing standard.

## Phase 6 — Import modal UI

`web/src/import-modal.ts`: modal with a primary paste textarea, an "Import" action running `import-parser.ts`, appending returned valid items into the existing `PendingState` (merge, not replace — `Clear` remains the reset action). On parse errors, offending lines move into a second textbox; a **Retry** button re-runs the parser against both boxes' concatenated content and moves newly-valid lines into the primary box.

## Phase 7 — Export (bash script)

`web/src/export.ts`: existing "Copy commands" behavior unchanged (uses `model.ts` output, no auth header). New "Generate bash script" button builds `#!/bin/env bash\n\nresidual write authorize\n\n<same ordered commands>` and triggers a `.sh` download via a Blob URL.

## Phase 8 — Cleanup + wiring + integration

- Delete `src/view/commands.rs`; remove its `pub use` from `src/view/mod.rs`.
- `static_export.rs` embeds `web/generated/app.js` (post-`gen-view-bundle.sh`) via `include_str!`, replacing the current inline script content in the rendered HTML.
- Full suite: `cargo test`, `bun test`, `cargo clippy --all-targets -- --deny warnings` (existing pre-existing warnings excluded per prior session's baseline), `residual verify all`, manual `residual view` smoke test in a browser.
