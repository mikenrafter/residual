# Vertical Slice Architecture — Research Notes

Sources: Jimmy Bogard, Oskar Dudycz, Rituraj, Daniel Balcárek, Sam Voisin (5 articles from Obsidian vault)

---

## Core Principle

> "Minimize coupling between slices, and maximize coupling in a slice." — Jimmy Bogard

Inverts traditional layered architecture: horizontal coupling (across layers) → vertical coupling (within features).

---

## What VSA Solves

**Change amplification**: A single feature change in layered architecture touches Domain Entity → DTO → Repository Interface → Repository Implementation → Service Interface → Service Implementation (6+ files). VSA contains change to one slice.

**Context switching**: Jumping between horizontal layers requires mental context switch. VSA co-locates all code for a feature.

> "Our goal is to quickly stand up new functionality with minimal impact on existing features." — Sam Voisin

---

## TDD in VSA

> "New features only add code, you're not changing shared code and worrying about side effects." — Jimmy Bogard

This enables rapid TDD cycles without regression fear. Each vertical slice is independently testable.

> "However, as it does assume that your team understands code smells and refactoring. If your team does not understand when a 'service' is doing too much to push logic to the domain, this pattern is likely not for you."

VSA requires skill. It is not a substitute for judgment.

---

## Semantic Diffusion (Oskar Dudycz)

> "'You can't share any code between slices' — Jimmy never said this. He said to minimise coupling between slices. Minimise isn't zero."
> "'Every slice must have its own database table' — Where did this come from? Slices can share storage."
> "'You must copy-paste everything' — No. You can extract common patterns when they prove themselves useful."

The pattern has been diluted by misrepresentation. Go back to Bogard's original article.

---

## Failure Modes

**Feature factory risk**:
> "With pure slices, you risk turning into a 'feature factory' where each feature is built in isolation without considering the overall system design. You might lose sight of the broader domain concepts because everything is scattered across independent slices." — Oskar Dudycz

**Code duplication at scale**: As the project grows, duplication accumulates. VSA is "well-suited for tiny or CRUD APIs due to its simplicity" but needs careful abstraction discipline at scale.

---

## CQRS and VSA

> "Vertical Slices Architecture is essentially CQRS with more prescriptive guidance on how to cut your architecture." — Oskar Dudycz
> "When you properly apply CQRS, you naturally drift towards Vertical Slices. The patterns reinforce each other."
> "CQRS is just about separating commands and queries. VSA is just about organising by feature instead of the technical layer."

CQRS ≠ two databases, event sourcing, eventual consistency, message queues. Those are accidental baggage.

---

## Recommended Hybrid (Balcárek)

> "Use VSA in the base with a feature folder structure and follow the rule that features do not reference each other. From CA, use a good level of abstractions in features where needed; we don't have to create abstractions in simple CRUD operations."

---

## Relation to Residuality

VSA's "minimize coupling between slices" maps directly to reducing K in the NKP matrix. Each vertical slice is a component. Shared code between slices creates hyperliminal coupling — it will only be revealed when a stressor hits both slices simultaneously.

The naive-draft skill should default to VSA: one slice per purpose identified in the purpose-walk. Slices that share stress responses (same matrix row pattern) are fusion candidates.
