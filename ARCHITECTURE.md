# Iteration 4 v3 — CLI hub + fully-qualified Structure/Storage tree

Prototype code structure (`architecture_set = iter4-cli-hub`).
**Iteration 5** implements A-02/A-04/A-06/A-07 outcomes atop this tree — see
[`residual/iterations/5.md`](residual/iterations/5.md). Component names remain
**fully-qualified** (e.g. `skills-personas`, not bare `personas`).

## Naming rule

Every registry row in `residual/components.csv` uses the exact fully-qualified string from the
architecture set. Bare leaf names (`personas`, `analysis`, `sessions`, …) are not component ids.

## Tree

```text
research-study                 ← STANDALONE, NOT RUNTIME (registry + terminology only)

cli                            ← hub: dispatch only; process text beside each clap action
cli-help                       ← completions / man / generate help

skills-personas                ← save/retrieve personas (SPLIT from research)
skills-research                ← walk+persona notes (NOT research-study)
skills-phases                  ← skill-list, skill-show, skill-data, ATAM+FMEA prose
skills-installer               ← skill-install, skill check-install

verification                   ← reads policy from storage-config (no separate verify config module)
verification-git-hook

structure                      ← EXTERNAL filter/sort/group API (default group=attractor)
├─ structure-analysis          ← NKP only — NOT ATAM/FMEA
│  ├─ structure-analysis-tag-scan
│  ├─ structure-analysis-force          ← force = 1/2 residue (purpose XOR stressor)
│  ├─ structure-analysis-purposes       ← :: Force — outcomes, NOT traits
│  ├─ structure-analysis-stressors      ← :: Force — outcomes, NOT traits
│  ├─ structure-analysis-attractors     ← +/- states, NO valence
│  └─ structure-analysis-residues      ← force ↔ component mapping
└─ structure-definition-*
   ├─ structure-definition-lexicon
   ├─ structure-definition-components
   └─ structure-definition-iterations

storage                        ← read / write / mutate
├─ storage-config              ← THE config (v3 TOML): app + verify policy keys
├─ storage-sessions
├─ storage-migration           ← naive → v3 only
└─ storage-format
```

## research-study standalone

`research-study` appears in the component registry for longitudinal alpha/beta work, but it is
**not** a runtime Rust module. `skills-research` stores walk notes only. Do not fuse
`skills-personas` with `skills-research`.

## Config split (v3)

| Owner | Keys |
|-------|------|
| **storage-config** | `format_version`, `change_detection`, **and** verify policy (`super_strict`, `token_warn`) |

There is **no** `verification/config.rs` module. Verification *reads* policy from
storage-config (app + verify policy keys live together).

## CLI-as-hub rule

Process / fluency text lives **beside each clap action** (`/// Process:` / `about`), not in a
shared preamble module. Whole-system-residue reminder sits next to add force/residue actions.

| CLI surface | Owner |
|-------------|--------|
| `skill-list` / `skill-show` / `skill-data` | `skills-phases` |
| `skill-install` / `skill check-install` | `skills-installer` |
| `verify *` | `verification` (via storage-config policy) |
| `matrix *` | `structure-analysis` (NKP) |
| `init` / `add` | `storage` via `storage-sessions` |
| `tag scan` | `structure-analysis-tag-scan` |
| `generate completions/man` | `cli-help` |
| `generate hook` | `verification-git-hook` |

## Force / residue / attractor

- **Force** = purpose XOR stressor + `shortname` + `naive_change` + `outcomes`. No traits.
- **Residue** = `force_id` × `component_id` (force is half of residue).
- **Attractor** = `positive_state` + `negative_state`. No valence.
- Lexicon continuity: ≥1 terminology word in each force **outcome** and each force **shortname**.

## Tag rule

Metadata-only OK. Tagged-in-code ⇒ must exist in metadata. Tag scan suggests; verification enforces.

## Gaps

1. **research-study / alpha-beta** — registry row only; no runtime module until the study lands.
2. **Legacy CSV traits/valence** — Force/Attractor types are v3-shaped; on-disk CSV may still carry traits/valence until migration catches up.
3. **Alternate backends** — migration is naive→v3 only; format is CSV. Deferred.
4. **P-value / interface discipline** — still no component.

See `residual/iterations/4.md` (stub) and `residual/components.csv` (25 fully-qualified names).
