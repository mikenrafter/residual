# A Philosophy of Software Design — Research Notes

Source: John Ousterhout, *A Philosophy of Software Design* (highlights from Obsidian vault)

---

## Core Thesis

> "The greatest limitation in writing software is our ability to understand the systems we are creating."

> "Complexity is what a developer experiences at a particular point in time when trying to achieve a particular goal...if such a system is easy to work on, then, for the purposes of this book, it is not complex."

Complexity is a *developer experience* metric, not a structural one.

---

## Three Manifestations of Complexity

1. **Unknown unknowns** — worst: you don't know what to change or if your solution works
2. **Change amplification** — annoying: clear what must change, but it's too many places
3. **Cognitive load** — slows you but change is likely correct

> "Complexity isn't caused by a single catastrophic error; it accumulates in lots of small chunks...Eventually, there are so many of these small issues that every possible change to the system is affected by several of them."

---

## Deep Modules

> "Information hiding and deep modules are closely related. If a module hides a lot of information, that tends to increase the amount of functionality provided by the module while also reducing its interface. This makes the module deeper."

> "General-purpose interfaces have many advantages over special-purpose ones. They tend to be simpler, with fewer methods that are deeper. They also provide a cleaner separation between classes, whereas special-purpose interfaces tend to leak information between classes."

Depth = ratio of functionality to interface complexity. Prefer deep modules.

---

## Information Leakage

> "Information leakage is one of the most important red flags in software design...If you encounter information leakage between classes, ask yourself 'How can I reorganize these classes so that this particular piece of knowledge only affects a single class?'"

> "Temporal decomposition often results in information leakage." — Organizing by execution order, not knowledge encapsulation, creates hidden dependencies.

---

## Pass-through Methods

> "Pass-through methods make classes shallower: they increase the interface complexity of the class...but they don't increase the total functionality of the system. Pass-through methods also create dependencies between classes."

---

## Design-It-Twice

> "Designing it twice does not need to take a lot of extra time...The initial design experiments will probably result in a significantly better design, which will more than pay for the time spent designing it twice."
> "No-one is good enough to get it right with their first try." (especially for large systems)

---

## Strategic vs. Tactical Programming

> "In tactical programming, the primary goal is to get something working quickly, even if that results in additional complexity; in strategic programming, the most important goal is to produce a great system design."
> "Spend about 10-20% of your total development time on investments...You will start experiencing the benefits within a few months."

---

## Comments and Abstraction

> "Code isn't suitable for describing abstractions; it's too low level and it includes implementation details that shouldn't be visible in the abstraction. The only way to describe an abstraction is with comments."

---

## Relation to Residuality

APOSD's "information hiding" maps directly to reducing hyperliminal coupling in the NKP matrix. When two components share knowledge (leakage), they share stress response — they appear in the same matrix row. APOSD's deep modules are high-P nodes: their restricted interface reduces K without reducing N.

The "unknown unknowns" category maps exactly to hyperliminal coupling: invisible until stress reveals it.
