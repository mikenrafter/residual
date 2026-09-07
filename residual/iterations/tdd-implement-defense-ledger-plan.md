---
date: "2026-09-02"
branch: tdd-implement/defense-ledger-proposed-components
status: complete
notes: "R/G TDD complete — defense ledger, proposed→actual hygiene, walk reminders (persist+deferred). Next: A-19 landscape UX."
---

# TDD Implement — Defense Ledger + Proposed Components

Orchestration skill: `tdd-implement`. Baseline commit on parent branch before this worktree.

## Locked decisions

| Item | Decision |
|------|----------|
| P-27 / P-28 | **Deferred** — pluggable methodology slots; architecture TBD |
| Meta force IDs | `MS-01` / `MA-01` / `MP-01` — **never** enter main `stressors.csv`, `purposes.csv`, `attractors.csv`, or main `residues.csv` |
| Tests | **Colocated** in `src/**` `#[cfg(test)]` modules only — no `tests/a17_*.rs` monolith |
| Red agent | May create stub source files with failing tests; green agents may rename stubs |
| Metadata edits | One-time direct CSV edit allowed pre–Phase 0; thereafter use CLI |
| Toolchain | `nix develop -c residual`, `agentgrep`, `rtk` |
| Commit hook | Pre-commit uses freshly built binary when working tree binary is stale |

## Meta isolation (every phase)

- Main ledger CLI (`add` / `list` / `matrix` / non-defense `skill-data`) never reads or writes `residual/defense/`
- `verify all` fails on cross-contamination between meta (`MS-*` / `MA-*` / `MP-*`) and main force namespaces
- NKP matrix builder ignores defense ledger entirely
- Only `defense-walk` skill loads defense context

---

## Phase index

| # | Phase | Primary forces | Owner components |
|---|--------|----------------|------------------|
| 0 | CLI enablers | P-30, P-31 | `storage`, `structure-definition-components`, `structure-analysis-residues` |
| 1 | Git sidecar branch storage | S-51, P-04, S-58 | `storage-git-sidecar`, `storage-migration`, `storage-config`, `verification-git-hook` |
| 2 | Defense ledger | P-29 | `structure-defense-*`, `skills-defense-personas` |
| 3 | defense-walk + outsider analysis | P-29, S-52 | `skills-defense-walk`, `structure-analysis-outsiders` |
| 4 | skills-guru | S-46, S-57, many | `skills-guru` |
| 5 | Walk cadence reminders | P-23, S-46 | `verification-git-hook`, `skills-guru`, `storage-config` |
| 6 | Integration + ledger hygiene | — | all |

---

## Phase 0 — CLI enablers (P-30, P-31)

**Modules:** `src/cli.rs`, `src/storage/components.rs`, `src/storage/residues.rs`

| Surface | Behavior |
|---------|----------|
| `residual add component` | Append registry row; extend `residues.csv` header; idempotent on name |
| `residual remove residue --force-id … --component-id …` | Clear matrix cell; session-hash guarded |
| `residual add residue … --move-to <component>` | Repoint coupling atomically |

**Colocated tests:** `src/storage/components.rs`, `src/storage/residues.rs`

---

## Phase 1 — Git sidecar branch storage

**Slots after Phase 0, before Phase 2.**

### Anchors

| Force | Role |
|-------|------|
| **S-51** `anti-documentation-culture` | Full metadata on orphan git branch; working branch stays clean |
| **P-04** `verify-hook-integrity` | Hook still runs `verify all`; verify resolves ledger from sidecar |
| **S-58** `contradictory-tooling-instructions` | Surface resolved config/storage path on every command |

### Canonical store (sidecar branch)

Entire metadata tree on dedicated branch (e.g. `residual/metadata`):

```text
residual/                          # on sidecar branch only (when sidecar enabled)
  config.toml                      # may also live in parent dir (stealth mode)
  stressors.csv … components.csv
  residues.csv
  defense/ … defense-personas/       # reserved paths (empty until Phase 2)
  personas/ iterations/ research/
  .storage-hashes
  .walk-review.toml                # Phase 5; committed on sidecar
```

Working branch: code + optional `@stressor:` / `@purpose:` / `@component:` tags. No `residual/` commits when sidecar mode active.

### Config discovery + stealth mode

Config search order (stop at first hit):

1. **`../residual/config.toml`** — parent of repo root (stealth mode; never staged on working branch)
2. **`residual/config.toml`** — inside repo (inline / dogfood mode)
3. Walk up from cwd for `residual/` directory (existing behavior) — **bounded: stop at filesystem root `/`**

`residual_dir` resolves from config file location + `[storage]` keys, not only cwd.

```toml
[storage]
change_detection = true
git_sidecar_enabled = true
git_sidecar_branch = "residual/metadata"
git_sidecar_remote = "origin"

# Optional: config file lives one directory above repo root (stealth mode).
config_host = "parent"             # parent | repo (default repo)

[storage.git_sidecar]
working_tree_policy = "warn"       # warn | block | ignore — staged residual/ on working branch
```

When `config_host = "parent"`, config + sidecar pointer live at `<repo-parent>/residual/config.toml`; repo's working tree never contains config commits.

### Storage resolution

| Concern | Behavior |
|---------|----------|
| Read path | All load / verify / skill-data reads resolve sidecar branch tip |
| Write path | Mutations land on sidecar branch; session lock scoped to sidecar |
| Tag scan | Code from **working branch**; force/component IDs from **sidecar** |
| Managed paths | Include `defense/**`, `defense-personas/**`, `.walk-review.toml` in `storage-sessions` |

### Verification (conclusions change)

| Check | Sidecar mode |
|-------|--------------|
| Lexicon / links / outcomes | Sidecar branch tip CSVs |
| Tag ↔ metadata cross-check | Dual-source: code cwd, metadata sidecar |
| Session drift | `.storage-hashes` on sidecar |
| Working-tree staged `residual/` | Warn/block per `working_tree_policy` |

`verify all` unchanged at CLI surface; optional `--source working-tree` for debug/migration only.

### Migration (`storage-migration`)

Extend `src/storage/integrity/migration.rs`:

| Migration | Action |
|-----------|--------|
| inline → sidecar | Lift working-tree `residual/` to sidecar branch; set `git_sidecar_enabled` |
| parent config | Write config to `../residual/config.toml` when `config_host = parent` |
| v4 preserved | Existing naive→v3 and v3→v4 paths unchanged |

CLI: `residual migrate --sidecar`, `residual init --sidecar`

### Hook (largely unchanged)

```bash
residual verify all || exit 1
residual verify walk-reminder --staged   # Phase 5; non-blocking (exit 0), prints when overdue
```

### CLI additions

| Command | Role |
|---------|------|
| `residual init --sidecar` | Bootstrap sidecar branch + config |
| `residual git sidecar status` | Branch tip, drift, sync state |
| `residual git sidecar commit -m …` | Commit sidecar mutations |
| `residual git sidecar push` | Push sidecar branch |
| `residual migrate --sidecar` | Inline → sidecar lift |

**Inline fallback:** `git_sidecar_enabled = false` preserves today's behavior.

**Modules:** `src/storage/git_sidecar.rs`, `src/storage/config.rs`, `src/storage/integrity/migration.rs`, `src/storage/integrity/sessions.rs`, `src/config.rs`, `src/verification/mod.rs`, `src/verification/git_hook.rs`

**Colocated tests:** `src/storage/git_sidecar.rs`, `src/storage/integrity/migration.rs`, `src/config.rs`

---

## Phase 2 — Defense ledger (P-29)

**Modules:** `src/storage/defense/`, `src/structure/defense/`

```text
residual/defense/                  # sidecar branch when Phase 1 enabled
  meta-stressors.csv               # MS-01…
  meta-attractors.csv              # MA-01…
  meta-purposes.csv                # MP-01…
  strategy/ progress/ pitches/    # *.md
residual/defense-personas/         # *.md
```

| Surface | Behavior |
|---------|----------|
| `add meta-stressor` / `meta-attractor` / `meta-purpose` | Separate ID namespace; never touches main ledger |
| `add defense-persona`, `add defense-strategy`, … | Markdown artifacts |
| `list defense-*` | List meta forces / artifacts |
| `verify all` | Meta/main cross-contamination check |

**Colocated tests:** per submodule under `src/storage/defense/`, `src/structure/defense/`

---

## Phase 3 — defense-walk + outsider analysis

**New component:** `skills-defense-walk` (proposed → actual when green)

| Surface | Behavior |
|---------|----------|
| Audience registry | Locked priors, channel safety (raw vs translated) |
| Artifact routing | S-52 guard — raw ledger paths blocked for hostile channels |
| `skill-data defense-walk` | Defense ledger summary only |

**Modules:** `src/structure/analysis/outsiders.rs`, `src/skills/definitions/defense_walk.md`, `src/skills/context.rs`

**Colocated tests:** `src/structure/analysis/outsiders.rs`

---

## Phase 4 — skills-guru

Embedded snippet registry keyed by topic: `attractors`, `stressors`, `purposes`, `personas`, `whole-system-residue`, `walk-reminder`.

`skill-data` injects guru blocks; `skill list` reports guru token estimates.

**Modules:** `src/skills/guru/`

**Colocated tests:** `src/skills/guru/mod.rs`

---

## Phase 5 — Walk cadence reminders (P-23, S-46)

**Anchors:** P-23 `force-landscape-revisit`, S-46 `landscape-review-decay`

**Depends on Phase 1:** `.walk-review.toml` committed on **sidecar branch**.

### Config (`[verification]` on sidecar config)

```toml
walk_reminder_enabled = true
walk_reminder_interval_days = 30
```

### State (`residual/.walk-review.toml` on sidecar)

```toml
[last_completed]
purpose-walk = "2026-08-01"
stressor-walk = "2026-07-15"

[last_prompted]
purpose-walk = "2026-09-01"
stressor-walk = "2026-09-01"
```

### CLI

| Command | Role |
|---------|------|
| `residual walk record --kind purpose\|stressor --completed` | Stamp completed walk |
| `residual walk record --kind … --deferred` | Acknowledge deferral |
| `residual verify walk-reminder [--staged]` | Non-blocking check (exit 0 always) |

Reminder copy from guru topic `walk-reminder`. Prompts for **both** purpose-walk and stressor-walk.

**Out of scope:** S-57 quiz mode; blocking commits on overdue walks.

**Modules:** `src/verification/walk_reminder.rs`, `src/verification/git_hook.rs`

**Colocated tests:** `src/verification/walk_reminder.rs`

---

## Phase 6 — Integration + ledger hygiene

- `research-study` — registry-only, no Rust module
- Backfill P-30 / P-31 couplings in `residues.csv` via CLI
- Register `skills-defense-walk` couplings
- Update `ARCHITECTURE.md`
- Dogfood cutover: enable sidecar, migrate inline ledger
- `nix develop -c cargo test` + `nix develop -c residual verify all`

---

## TDD orchestration

```
✅  0. Baseline commit + plan metadata commit
✅  1. Red agent — stub files + colocated failing tests (Phases 0–5)
✅  2. Parent red gate — failures match intended contract gaps
✅  3. Green — Phase 0
✅  4. Green — Phase 1 (+ migration + parent config)
✅  5. Green — Phase 2 (+ meta isolation)
✅  6. Green — Phase 3 (+ defense-walk)
✅  7. Green — Phase 4 (guru)
✅  8. Green — Phase 5 (walk reminders — hook + persist + deferred)
✅  9. Green — Phase 6 (hygiene)
✅ 10. Final verification
```

### Subagent launch template

```
Task: Phase N of tdd-implement-defense-ledger.

Prior context:
- [completed phases, file paths, decisions]

This phase:
- [R/G scope from plan above]
- Run: nix develop -c cargo test <module>
- Stop when: phase pass criteria met
- Tests: colocated in src/ only
```

---

## Component registry (proposed → implement)

| Component | Phase | Notes |
|-----------|-------|-------|
| `storage-git-sidecar` | 1 | Branch resolve, read/write, parent config |
| `skills-defense-walk` | 3 | Skill lens for defense ledger |
| `skills-guru` | 4 | Snippet registry |
| `structure-analysis-outsiders` | 3 | Audience routing |
| `structure-defense-*` | 2 | Meta ledger + artifacts |
| `skills-defense-personas` | 2 | Outsider simulation voices |
| `research-study` | 6 | Registry-only — no runtime |
