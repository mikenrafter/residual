# Demo: Purpose-walk — product purposes, actor terms, and dual-pressure attractors

This excerpt is from a session where the purpose-walk skill was used to discover
that P-01 through P-07 only described tooling plumbing — no purpose said why anyone
opens the CLI. The walk produced eight new product purposes, eight new terms (including
`operator`, `residual-architecture`, `negative-residual`/`positive-residual`, and
`probability-framing`), and a structural change to attractors (positive + negative
states instead of valence labels).

The session committed as `36ef602` and landed 17 purposes, 7 attractors, and 20 terms
with `verify all` passing.

---

## Opening: the tooling-only gap

After loading skill data the agent noticed that all seven existing purposes described
CLI mechanics, not the product job.

**Agent:**

> **Purpose-walk started.** Skill-check: `purpose-walk` is not installed for agent
> `cursor`. `verify all` passes. Current purposes (7):
>
> | ID | Purpose | Trait gap |
> |---|---|---|
> | P-01 | Define/iterate purposes without writing code | trait soft on *who* and *what* is verified |
> | P-02 | Agents get full context before a skill session | "accurate current context" is not a checkable predicate |
> | P-07 | Metadata in any order / phase without skill ceremony | trait only mentions stressors — narrower than the purpose |
>
> Stressors S-07…S-21 already point at purposes that are **not** recorded yet.
>
> **Opening question:** What is *this* project's job, in one sentence, for the person
> who opens the CLI? Name the **actor**, the **action they take**, and the **artifact
> or state** they leave with.

---

## Sharpening vague language

The operator described the product goals. The agent pushed back on aspirational phrasing
before accepting any of it as a purpose.

**Operator:**

> technical job: allow the user to programmatically engage w/ the residual architecture
> framework in a legible and independent way.
>
> Otherwise put: to help single-developers and teams design better software architecture
> by avoiding the problems of risk and pattern-based approaches, opting to instead model
> the state space of their application and identify architectures that survive more terrain.

**Agent (critic pass, turn 3):**

> **What I reject until sharpened**
>
> | Phrase | Problem |
> |---|---|
> | "better software architecture" | Aspiration. Survives *what*? Leaves *which* artifact? |
> | "resilient architecture" | Not in terminology. Closest defined ends: **residue**, **criticality**, architectures that survive named **stressors**. |
> | "faster / fewer people" | Relative to what baseline? Need a feature that replaces a specific process step. |
> | "larger portion of the state space" | Portion of *what countable set*? Stressors recorded? Attractors visited? Parallel component sets compared? |
> | "survive more terrain" | Poetic. Terrain must become named stressors / attractors. |

---

## Discovering structural gaps in terminology

While drafting the new purposes, the agent found that `residual-architecture` was
referenced in related_terms across the data but never defined — a contradiction that
would poison trait validation.

**Agent:**

> Hidden assumption: "stressors = negative residuals, purposes = positive residuals."
> Terminology defines `residue` and `stressor`/`purpose` separately and already
> *mentions* `residual-architecture` in related_terms **without defining it**. That
> contradiction will poison traits until fixed.

The operator approved a batch of term additions and edits, including a sharpened
definition for `probability-framing`:

**Operator:**

> b: go + add one change: `probability-framing` should state that probabilities are
> exclusionary opinions when in non-ergodic hyperliminal systems

**Resulting term (recorded):**

> `probability-framing` — encoding exploration as likelihoods or risk scores; collapses
> unseen attractors and blocks full state-space walks because probabilities are
> exclusionary opinions in non-ergodic hyperliminal systems

---

## A structural change to attractors

The operator introduced a new attractor model mid-session — dual-pressure states instead
of valence labels.

**Operator:**

> New purpose to add: Ensuring attractors have both positive and negative pressure in
> order to force clarity surrounding what/why/how to keep it going. No more positive vs
> negative attractors — attractors will be slightly more abstract in definition, but will
> have positive and negative states. Attractors are inherently multivariate, so things
> like "(abstract name) Variable validity, (positive state) A being < 2 when B is > 2,
> (negative state) A being >= 2 when B is > 2" do work.
>
> The stressor would be not knowing why a stressor hurts a project — solving it would be
> ensuring attractors have pressure from both sides.

This became attractor **A-07** (Software-Only Tunnel Vision), purpose **P-16** (dual-
pressure attractor clarity), and stressor **S-25**.

---

## Closing: actor consistency pass

The walk ended with a consistency sweep — P-01 through P-07 still said "architects"
while the new product purposes used `operator`. The agent rewrote all seven traits
before committing.

**Agent (after reword):**

> | ID | Trait (now) |
> |---|---|
> | P-01 | operator adds purposes tied to an attractor without writing code |
> | P-04 | operator cannot commit invalid traits or broken attractor links |
> | P-07 | operator records stressor narratives without switching between skill phases |
>
> **Landing inventory**
> | Store | Count |
> |---|---|
> | Purposes | 17 (P-01…P-17) |
> | Attractors | 7 (A-01…A-07) |
> | Terms | 20 |
> | Stressors | 25 |

---

## What this demonstrates

- **Product purposes and tooling purposes are different.** P-01–P-07 described CLI
  plumbing correctly but said nothing about why the CLI exists. The walk held both layers
  simultaneously, connected by traits that must compile against the same terminology.

- **The critic rule earns its place.** Turn-3 adversarial challenges forced vague
  phrases ("better architecture," "survive more terrain," "resilient") to resolve to
  defined terminology or get dropped. The critic is mandatory in the skill definition for
  this reason.

- **Terminology and purposes co-evolve.** Eight new terms were added in the same session
  as ten new purposes. You cannot write a verifiable trait for a concept that has no
  definition, so defining terms and defining purposes is the same work.

- **Structural insight can land mid-walk.** The dual-pressure attractor model (positive
  state + negative state instead of a valence label) arrived as an operator observation
  mid-session, became a purpose, and immediately triggered a stressor. The walk was the
  right place to discover it.

- **The Socratic interaction pattern enforced the read/write rule cleanly.** Every batch
  of adds was proposed in full before execution. The operator reviewed the commands,
  amended one (`probability-framing`), and approved the rest. Nothing was written without
  sign-off.
