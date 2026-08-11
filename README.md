# residual

NKP Residuality architecture CLI — stressor-driven, attractor-aware, probability-free.

`residual` operationalizes Barry O'Reilly's Residuality Theory. It guides architects through a sequence of Socratic, LLM-driven skills to produce architectures that survive unknown stressors — not by predicting the future, but by iterating on what the system must become after stress.

## Core Ideas

- **No probabilities.** Stressors replace risks. A stressor only needs a coherent narrative describing how the system moves to a different attractor.
- **Attractors, not edge cases.** Edge cases assume the current abstraction is correct. Attractors don't.
- **Residues as units of change.** Not components. Not patterns. What survives stress.
- **NKP matrix.** Stressors × components incidence matrix. Reveals hidden (hyperliminal) coupling. Drives fusion and fission decisions.
- **Criticality over correctness.** The right balance of N (nodes), K (links), P (predictability).
- **Traits.** Verifiable statements: `<subject> <verb> <predicate>` using defined terminology. Enforced at commit.

## Quick Start

```bash
# In a Nix environment
nix develop   # enter devShell
cargo build --release

# Initialize residual/ in your project
residual init

# Start the purpose-walk skill session
residual skill-install purpose-walk --agent claude
residual skill-data purpose-walk
# → paste context into your Claude session, then begin purpose-walk
```

## Workflow

```
purpose-walk → naive-draft → stressor-walk → integrate → FMEA → ATAM
```

Each step produces artifacts in `residual/`:

| File | Contents |
|---|---|
| `stressors.csv` | Stressors with attractor refs, naive changes, traits, affected components |
| `purposes.csv` | Purposes with features, traits, enabled components |
| `attractors.csv` | Attractors (positive + negative) with phase state descriptions |
| `terminology.csv` | Domain terms required by trait validation |
| `iterations/<n>.md` | Architecture snapshots with N, K, Ri scores |
| `personas/<name>.md` | Stakeholder voices used during stressor-walk and ATAM |
| `research/<source>.md` | Research notes from external documents |

## Skills

Skills are agent-agnostic prompt documents embedded in the binary.

```bash
residual skill-list                          # list all skills with version + token estimate
residual skill-show purpose-walk             # print skill definition
residual skill-install purpose-walk \
  --agent claude                             # install to .claude/commands/
residual skill-check purpose-walk \
  --agent claude                             # verify installed version matches binary
residual skill-data purpose-walk            # print current project context for this skill
```

Supported agents: `claude`, `cursor`, `copilot`, `agnostic`

## NKP Matrix

```bash
residual matrix show          # colored table: stressors × components
residual matrix calc          # N, K, K/N values
residual matrix criticality   # criticality assessment
residual matrix fusion        # components safe to merge (identical stress patterns)
residual matrix fission       # components under excessive stress (high K)
residual matrix ri \
  --stressors 10 \
  --naive-survived 3 \
  --residual-survived 8       # Ri = (8-3)/10 = 0.5
```

## Data Management

```bash
residual add stressor --description "..." --attractor-id A-01 \
  --naive-change "..." --components "auth,billing"
residual add attractor --name "..." --valence negative --description "..."
residual add term --term "..." --definition "..."
residual list stressors / purposes / attractors / terminology / personas / iterations
```

## Validation + Git Hook

```bash
residual verify all           # validate traits + referential integrity
residual generate hook        # install pre-commit hook to .git/hooks/
```

The pre-commit hook runs `residual verify all` before any commit that touches `residual/` files. Configure `validation.strict = false` in `residual/config.toml` to allow commits when no `residual/` files are staged.

## Codebase Tagging

```rust
// @residue: R-03
// @stressor: S-07, S-12
```

```bash
residual tag scan     # find dangling tags + untagged stressors
residual tag report   # map each tag to its file:line
```

## Nix / NixOS

```bash
nix develop           # enter devShell (cargo, rust-analyzer, cargo-watch, cargo-audit)
nix build             # build the binary
```

Add to your NixOS flake:
```nix
inputs.residual.url = "github:mikenrafter/residual";
# Then: pkgs.residual or residual.packages.${system}.default
```

## Development

```
nix develop
cargo test         # run full test suite (79 tests)
cargo watch -x check
cargo audit
```

## Research

Background reading is in `research/`:
- `nkp-residuality-theory.md` — NKP framework, verbatim definitions
- `aposd.md` — A Philosophy of Software Design key insights
- `vertical-slice-arch.md` — Vertical Slice Architecture synthesis
- `fmea-notes.md` — FMEA methodology notes
- `atam-notes.md` — ATAM methodology notes

## License

MIT
