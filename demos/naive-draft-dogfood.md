# Demo: Naive Draft on residual itself

This excerpt is from an early session where the `naive-draft` skill was run on the
`residual` codebase — the tool analyzing its own architecture. The session surfaced
several stressors that were subsequently recorded and drove the next iteration.

This is a self-referential example: the method is being applied to the codebase that
implements the method. The stressors discovered here (`skill-stub-burden`,
`absent-metadata-session`, `unverified-baseline`) became part of the canonical
force set.

---

## Setting the stage

The operator invoked `/residual-naive-draft`. The agent read `skill-data` for context,
then surveyed the module tree before discussing.

**Agent:**

> Here's what I'm seeing. The project is `residual` v0.1.0 — a Rust CLI already
> built and working. The Naive Draft skill applied here gives us a baseline
> architecture to reason from, exposing flaws before the stressor walk drives
> the next iteration.
>
> **Current module structure maps to 5 behavioral slices:**
> - `storage/` — CSV-backed entity CRUD
> - `skills/` — embedded skill lifecycle
> - `nkp/` — matrix math (N/K/criticality/Ri)
> - `structure/` — domain analysis types
> - `verification/` — trait + link integrity checks
>
> **Observed flaws in the naive architecture:**
>
> 1. `storage/mod.rs::add()` and `list()` are pure dispatch — no behavior of their
>    own. Each entity module independently implements the same three-function pattern.
>    This is not a problem yet, but it's the shape that produces a storage-router
>    component with high K as entities multiply.
>
> 2. Skills are versioned by a `version:` field in installed front-matter. When the
>    binary updates, operators must manually re-run `skill-install` to get the new
>    methodology. There is no check command. (→ `skill-version-drift`)
>
> 3. Terminology validation iterates the full term set on every trait check. At
>    current scale this is instant. At 200+ terms with a pre-commit hook it will
>    become slow enough to cause hook avoidance. (→ `verify-hook-bypass`)
>
> 4. The versioned installed skill stubs require ongoing maintenance — users must
>    track, update, and reconcile stale files. A static stub that simply calls the
>    binary for content would remove the lifecycle entirely. No version needed.
>    (→ `skill-stub-burden`, a new attractor candidate)
>
> 5. `research.rs` is an unimplemented stub. Should be tagged `@stressor` so the
>    gap is visible.

**Operator:**

> flaw 1 deserves some exploration
> flaw 2 - looks like it has a stressor already, if not then fix that
> flaw 3 - slow git hook, worth adding as a stressor
> flaw 4 - new stressor: added management layer for the user, when a static stub
>   that defers to the binary would solve this. no version needed - version drift
>   attractor (is this unique?)
> flaw 5 - looks like a stub, make sure it's tagged

---

## Discovering residuals incongruence

After adding the initial stressors, the operator identified an unconsidered case:
what happens when residual skills are run on a project with no existing metadata?

**Operator:**

> We're in an unconsidered case here... bootstrapping the naive draft into the
> residuals structure. Add an attractor for incongruent project and residuals state.
> And 4 stressors:
> - preexisting project without metadata — tooling/skills should identify this and
>   be more focused on capturing the metadata first
> - entity (dev/PM/agent/etc) circumvented validation (--no-verify or another means)
> - [two more in the session...]

**Agent (after running `residual verify all`):**

> There's the real incongruence — trait violations all over the existing data.
>
> The verify output reveals the actual data problem: exact-word matching rejects
> plurals — "skills" ≠ "skill", "traits" ≠ "trait", etc. Eight pre-existing
> violations. I'll add A-05 (residuals-incongruence), all four stressors, then fix
> the violated traits.

After the additions:

> **Matrix: 11×9, still perfectly diagonal.** Two stressor clusters worth naming:
>
> - `skill-version-drift` + `skill-stub-burden`: two stressors accumulating on one
>   component. First fission candidate if this grows.
> - `lexicon-scale-lag` + `verify-hook-bypass`: two stressors sharing the same
>   component. Same pattern.
>
> **Latent coupling signal in components:** the matrix is visually parseable now.
> It won't be at 20+ stressors — which suggests a filtering/grouping stressor is
> itself latent in the current architecture.

---

## What this demonstrates

- **Dogfooding:** residual's own architecture was walked using residual. The stressors
  discovered (`skill-stub-burden`, `absent-metadata-session`, `unverified-baseline`,
  `cross-store-incongruence`) are now part of the canonical force set.
- **Fluent capture:** stressors were added mid-session as the conversation surfaced
  them, without phase ceremony.
- **Verify as signal:** running `verify all` mid-session exposed pre-existing data
  violations that weren't visible from the CSV alone.
- **Fission prediction:** the matrix flagged the first coupling accumulation before
  it became a problem — `skill-version-drift` + `skill-stub-burden` on a single
  component.
