# residual

NKP Residuality architecture CLI — stressor-driven, attractor-aware, probability-free.

## Key commands

```bash
residual skill-show <name>              # read a skill definition inline
residual skill-data <name>             # get current project context for a skill
residual skill-install <name> --agent claude   # install skill to .claude/commands/
residual skill-check <name> --agent claude     # verify installed version is current

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

purpose-walk, naive-draft, stressor-walk, integrate, fmea, atam

Always run `residual skill-check <name> --agent claude` before starting a skill session.
Always run `residual skill-data <name>` at the start of a session to get current project context.

## No probabilities

Stressors replace risks. Never assign probability or impact scores. A stressor only needs a coherent narrative of how the system moves to a different attractor.

## Traits

Format: `<subject> <verb> <predicate>`. At least one word must appear in `terminology.csv`. Pipe-separate multiple traits: `trait one | trait two`. Traits that don't reference terminology will fail `residual verify traits` and block commits.
