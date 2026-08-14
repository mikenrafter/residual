# residual

NKP Residuality architecture CLI — stressor-driven, attractor-aware, probability-free.

## Key commands

```bash
residual skill show <name>              # read a skill definition inline
residual skill data <name>             # get current project context for a skill
residual skill install <name> --agent claude   # install skill to .claude/commands/
residual skill install all --agent claude      # install all skills
residual skill check-install <name> --agent claude  # verify installed version is current

residual add stressor --description "..." --attractor-id A-01 --naive-change "..." --components "C1,C2"
residual add purpose  --description "..." --attractor-id A-01 --feature "..." --traits "..."
residual add attractor --name "..." --valence positive --description "..."
residual add term --term "..." --definition "..."
residual add persona --name "..." --role "..."

residual list stressors / purposes / attractors / terminology / personas / iterations

residual matrix show       # NKP matrix with hyperliminal coupling highlights
residual matrix calc       # N, K, K/N values
residual matrix fusion     # components safe to merge
residual matrix fission    # components under excessive stress
residual matrix ri --stressors N --naive-survived X --residual-survived Y

residual verify all        # validate outcomes + links (run before committing)

residual tag scan          # find @residue:/@stressor: annotations; report dangling
```

## Skills

purpose-walk, naive-draft, stressor-walk, integrate, fmea, atam, tdd-implement

Always run `residual skill check-install <name> --agent claude` before starting a skill session.
Always run `residual skill data <name>` at the start of a session to get current project context.

## Use the tool — always

**Always use `residual` CLI commands for data operations, even outside a skill session.** Never directly edit `residual/*.csv` files when a CLI command exists for the operation. Direct mutation bypasses ID generation, idempotency guards, and verify. This is a residue of **cli-bypass** (S-29) and the **tooling-circumvention** attractor (A-08).

- Add forces: `residual add stressor / purpose / attractor / term / persona`
- Read state: `residual list stressors / purposes / attractors / terminology`
- Check integrity: `residual verify all`
- Inspect coupling: `residual matrix show / calc / fusion / fission`

Direct CSV edits are only acceptable for operations the CLI does not support (e.g., updating an existing force's outcome field — no `residual update` command exists yet).

## Shortnames over IDs

When referring to forces, attractors, or components in conversation or commit messages, prefer shortnames (`skill-stub-burden`, `fluent-metadata-capture`, `architecture-clarity`) over numeric IDs (`S-07`, `P-07`, `A-01`). IDs are brittle pointers; shortnames carry intent and stay readable in git log. This is a residue of **lexicon-project-wide** (P-18).

## Engineering standards

These are craft concerns, not residuality forces — they belong here, not in forces.csv:

- **Test colocation**: place `#[cfg(test)] mod tests { ... }` alongside the code being tested, not only in `tests/`. Unit tests live beside the unit.
- **No unwrap in production paths**: use `?` or proper error handling. `.unwrap()` is acceptable only in tests and in `main()` for top-level CLI errors.

## No probabilities

Stressors replace risks. Never assign probability or impact scores. A stressor only needs a coherent narrative of how the system moves to a different attractor.

## Traits

Format: `<subject> <verb> <predicate>`. At least one word must appear in `terminology.csv`. Pipe-separate multiple traits: `trait one | trait two`. Traits that don't reference terminology will fail `residual verify traits` and block commits.
