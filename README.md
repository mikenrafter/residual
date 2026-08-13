# residual

A CLI that helps you practice Residuality Theory on a real codebase — with your coding agent as a Socratic partner.

This project is a **slight expansion** of Barry O’Reilly’s Residuality Theory: the original method centers on **stressors**, attractors, residues, and the NKP matrix. Here, **purposes** are added as complements to stressors and both are generalized as **forces**, with extra tooling (lexicon, git integration, tagging, naïve-draft) drawn from other sources. See [What is whose?](#what-is-whose) and [Sources of inspiration](#sources-of-inspiration).

Most architecture work tries to predict the future (risk scores, edge cases, “what if” lists). Residuality Theory takes a different path: you walk the problem, notice the recurring situations a system falls into (**attractors**), and record the small changes that would let it survive those situations (**residues**). You do this without assigning probabilities. The goal is not a perfect forecast — it is an architecture that still works when the unexpected arrives.

`residual` operationalizes that method (plus the small expansions above). It stores your walks as structured project data, keeps language consistent, and hands your agent focused skill prompts. Usage is **a-la-carte**: pick the lens you need, mid-session, without a rigid ceremony. Verify enforces structure, not phase order.

## Learn the method

Start with O’Reilly. The practical + philosophical pair is sold together:

**[Residues and The Philosophy of Software Architecture](https://leanpub.com/b/residues)** (Leanpub bundle) — *Residues: Time, Change, and Uncertainty in Software Architecture* plus *The Architect’s Paradox*.

Repo notes under `research/` are companions for this codebase; the books are the place to learn Residuality Theory itself. For everything else this tool borrows, see [Sources of inspiration](#sources-of-inspiration).

## Concepts (gentle tour)

You do not need the full theory to start. These ideas are enough to use the tool:

1. **Stressors** (O’Reilly) — A coherent story of how the wider world moves the system. No scenario is too outlandish.
2. **Purposes / forces** (this project) — Purposes complement stressors (what you intend vs what the world may do); together they are **forces**. The same abstraction runs at any scale of the hyperliminal system — not software-only. Forces carry **outcomes** — short, checkable statements — and a naïve change idea. They do not list components directly.
3. **Residues** — The unit of architectural change: what is left after stress or intent. In this tool, a residue maps one force to one component (or to the whole system when the answer is hardware, process, organization, or policy).
4. **Attractors** — Recurring states the system returns to. Here each has a **positive state** and a **negative state**.
5. **NKP matrix** — A table of forces × components. Shared marks in a row reveal hidden coupling. Fusion and fission suggestions come from that pattern.
6. **Lexicon** (tooling) — Shared vocabulary so outcomes and shortnames stay coherent as the project grows.

Deeper ideas (criticality, residual index, hyperliminal coupling, walks) are in O’Reilly’s books and in `research/nkp-residuality-theory.md`.

## Quick Start

```bash
# In a Nix environment
nix develop   # enter devShell (residual is on PATH)
cargo build --release

# Initialize residual/ in your project
residual init

# Install a skill for your agent, then load project context into the session
residual skill-install purpose-walk --agent claude
# Launch the /residual-purpose-walk skill once initialized
claude
```

Coming from an older `residual/` layout? Run `residual migrate` to move to the v3 shape (forces, residues, lexicon, attractor ± states).

## Workflow

**A-la-carte by design.** Skills are optional analytical lenses — invoke only what the moment needs. There is no mandatory skill sequence; `verify` cares about residual structure, not which ceremony you ran.

```
purpose-walk · naive-draft · stressor-walk · integrate · FMEA · ATAM
```

A common early pass is still *purpose → naïve draft → stressor walk → integrate*, then FMEA/ATAM when you want structured critique — but that path is a suggestion, not a gate. Record a force or residue whenever it appears.

Each step writes into `residual/`:

| File | Contents |
|---|---|
| `forces.csv` | Unified forces (purposes and stressors): shortname, naïve change, outcomes, attractor |
| `residues.csv` | Force × component matrix (the coupling the NKP view uses) |
| `attractors.csv` | Attractors with positive and negative states |
| `components.csv` | Fully-qualified component registry for the architecture set |
| `lexicon.csv` | Domain terms (with aliases) used by outcome validation |
| `purposes.csv` / `stressors.csv` | Legacy force views kept during transition |
| `terminology.csv` | Legacy term store; prefer `lexicon.csv` |
| `iterations/<n>.md` | Architecture snapshots (N, K, notes, Ri when recorded) |
| `personas/<name>.md` | Stakeholder voices for walks and ATAM |
| `research/<source>.md` | Research notes from external documents |

## Skills

Skills are agent-agnostic prompt documents embedded in the binary. Install a-la-carte — only the lenses you actually use.

```bash
residual skill-list                          # list skills with version + token estimate
residual skill-show purpose-walk             # print skill definition
residual skill-install purpose-walk \
  --agent claude                             # install for that agent
residual skill-check purpose-walk \
  --agent claude                             # verify installed version matches binary
residual skill-data purpose-walk             # print current project context for this skill
```

Supported agents: `claude`, `cursor`, `copilot`, `agnostic`

## NKP Matrix

```bash
residual matrix show          # table: force shortnames × components
residual matrix calc          # N, K, K/N
residual matrix criticality   # criticality assessment
residual matrix fusion        # components safe to merge (identical stress patterns)
residual matrix fission       # components under excessive stress (high K)
residual matrix ri \
  --stressors 10 \
  --naive-survived 3 \
  --residual-survived 8       # Ri = (8-3)/10 = 0.5
```

## Data Management

Prefer **force then residue**: record the purpose or stressor, then map which components (or the whole system) carry the change.

```bash
residual add attractor --name "..." --description "..." \
  --positive-state "..." --negative-state "..."

residual add stressor --description "..." --attractor-id A-01 \
  --naive-change "..." --outcomes "..."
residual add residue --force-id S-01 --component-id my-component

# When the surviving change is not software
residual add stressor --description "..." --attractor-id A-01 \
  --naive-change "..." --outcomes "..." \
  --whole-system --notes "policy zig: ..."

residual add purpose --description "..." --attractor-id A-01 \
  --feature "..." --outcomes "..."
residual add term --term "..." --definition "..."

residual list stressors / purposes / attractors / terminology / residues / personas / iterations
```

## Verification + Git Hook

```bash
residual verify all           # outcomes, links, tags, and related integrity checks
residual generate hook        # install pre-commit hook to .git/hooks/
```

The pre-commit hook runs `residual verify all` before commits that touch `residual/` files. Verification policy (`super_strict`, `token_warn`, and related keys) lives in `residual/config.toml`. Commit subjects follow [Scoped Commits](https://scopedcommits.com/) — `<scope>: <description>` — with scopes drawn from your lexicon and component registry (or `general - …` when no project term fits), not Conventional Commit type prefixes like `feat:` or `fix:`.

## Codebase Tagging

```rust
// @residue: R-03
// @stressor: S-07, S-12
```

```bash
residual tag scan     # find dangling tags + untagged stressors
residual tag report   # map each tag to its file:line
```

Metadata-only tags are fine. Tags in code must exist in metadata; verification enforces that one-way rule.

## Nix / NixOS

```bash
nix develop           # enter devShell (cargo, rust-analyzer, cargo-watch, cargo-audit; residual on PATH)
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
cargo test
cargo watch -x check
cargo audit
```

Prototype layout and naming rules for the current architecture set are in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## What is whose?

### From Residuality Theory (Barry O’Reilly)

These ideas are the core of the method. Learn them properly from the books linked in [Sources of inspiration](#sources-of-inspiration):

- **Stressors** — coherent narratives of how the wider business system moves; no probabilities required
- **Attractors** — recurring states a system returns to
- **Residues** — what remains after stress; the unit of architectural change
- **Naïve vs residual architecture** — start simple, then integrate residues
- **NKP matrix** — stressors × components; fusion/fission; criticality; residual index (Ri)
- **Walks** — iterative, multi-perspective exploration (e.g. stressor-walk)
- **FMEA / ATAM** — late validation layers as framed in the Residuality workflow (FMEA for technical failure modes; ATAM for stakeholder tradeoffs)

In the original framework, the force that drives residue work is the **stressor**. Purposes-as-forces are not part of that core.

### Added in this project (framework)

A small conceptual overlay on top of the theory — deliberately **scale-independent**. Forces apply to the whole hyperliminal system (the ordered software executing inside a disordered business/world context), not only to software features. That breadth is counterintuitive and hard; it is also what makes the results meaningful.

- **Purposes** — complements to stressors: what the system is *for*, at whatever scale you are walking (product, org, policy, hardware, code, …)
- **Forces** — generalization: a force is a purpose *or* a stressor, carrying a naïve change and checkable **outcomes**
- **Residue as force × component** — explicit mapping (including a whole-system residue when the surviving answer is not software)
- **Attractor ± states** — each attractor recorded with a positive state and a negative state, rather than a single valence label

### Added in this project (tooling, from other sources)

Programmatic and process pieces integrated so the method sticks in a real repo:

- **Lexicon** — shared vocabulary with alias-aware validation of outcomes
- **Git integration** — verify hooks and commit-message checks in [Scoped Commits](https://scopedcommits.com/) form: scope-first subjects tied to lexicon and components, with Conventional Commit type prefixes rejected
- **Code tagging** — `@residue` / `@stressor` markers linked to metadata
- **Naïve-draft phase** — agent skill that drafts a naïve architecture using **deep modules** ([APOSD](#sources-of-inspiration)) and **vertical slices**, then TDD-first scaffolding

## Sources of inspiration

| Source | Role in this project |
|---|---|
| [Residues and The Philosophy of Software Architecture](https://leanpub.com/b/residues) (Leanpub bundle by Barry M. O’Reilly) | Residuality Theory proper: stressors, attractors, residues, NKP, walks, Ri, criticality; FMEA/ATAM placement in the workflow |
| [A Philosophy of Software Design](https://stanford.edu/~ouster/cgi-bin/aposd.php) — John Ousterhout, Yaknyam Press ([2nd ed. on Amazon](https://www.amazon.com/Philosophy-Software-Design-2nd/dp/173210221X)) | Deep modules / information hiding informing the **naive-draft** skill |
| [Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/) — Jimmy Bogard | Feature-shaped slices (maximize coupling in a slice) in **naive-draft** |
| [Scoped Commits](https://scopedcommits.com/) | Scope-first commit subjects (`<scope>: <description>`); this tool defines valid scopes from the lexicon and component registry and rejects generic Conventional Commit type prefixes (`feat:`, `fix:`, …) |
| SEI Architecture Tradeoff Analysis Method (ATAM) | Stakeholder tradeoff analysis skill (`atam`), as used after residual integration |
| Failure Mode and Effects Analysis (FMEA) | Technical failure-mode skill (`fmea`), as framed after residual integration in O’Reilly’s workflow |

Local digests of several of these live under `research/`.

## Research

Background reading is in `research/`:
- `nkp-residuality-theory.md` — NKP framework, verbatim definitions
- `aposd.md` — A Philosophy of Software Design key insights
- `vertical-slice-arch.md` — Vertical Slice Architecture synthesis
- `fmea-notes.md` — FMEA methodology notes
- `atam-notes.md` — ATAM methodology notes

## License

MIT
