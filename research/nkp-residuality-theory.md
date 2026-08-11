# NKP Residuality Theory — Research Notes

Source: Barry O'Reilly, *Residuality Theory* (epub, ParsedDocument481689407)

---

## Core Definitions

### Walk (Deleuzian Walk)
> "This explains how we come to knowledge not by listing, comparing, contrasting, and abstracting things until we give them an identity–but instead by walking around the problem repetitively observing each time the differences in this particular walk. Eventually our understanding of the thing we are contemplating becomes very rich."

Knowledge from iteration, not from identity. Each walk reveals new details. The architect must "indulge in enough walks."

### Residue
> "A residue is what is left over of a system after it is exposed to some form of stress."
> "Each residue is a simple description of the changes necessary to the naïve architecture, not an entire architectural description"
> "The residue is a unit of change that allows the architecture to change in a particular way without being entirely certain about when the change will occur or even if it will"

The **residue is the fundamental unit** of software architecture — not components, not patterns. When the system changes, the new system is the residue of the previous one. The **residual architecture** is the integration of all residues.

### Stressor
> "A stressor [is something that] may happen which have not been considered yet"
> "The stressor does not have to have consensus that it will happen, it does not have to have a high likelihood, it does not have to have an assigned probability and it only needs to have a coherent narrative that describes how the wider business system will move to a different attractor"

Key distinctions:
- Stressor ≠ risk (no probability, no impact score)
- Stressor ≠ edge case (doesn't assume current abstraction is correct)
- Stressor = narrative that places the system in a different attractor

### Attractor
> "An attractor is a particular state that a system arrives in over and over again."
> "In software engineering patterns can be seen as attractors."
> "The business system is considered as a network of attractors which it shifts between over time."

Attractors are the recurring configurations of a system. They provide predictability in a complex environment. Every stressor points to an attractor the system must survive.

---

## NKP Matrix

> "In the matrix we set our potential components as the columns and our stressors as the rows"
> "We then fill in the cells of the matrix by adding 1's where the stressor affects the component's operation and a zero where it doesn't"

**N** = number of stressors + components (total nodes)
**K** = total 1s in the matrix (links/coupling)
**P** = node bias toward predictable behavior (interfaces, uniform error handling, security)

Column totals → most vulnerable components
Row totals → most impactful stressors
Two 1s in same row → **hyperliminal coupling** (hidden dependency)

> "Two 1's in the same row indicates this hidden coupling and provides information about the non-functional dispositions the architecture will need."

---

## Fusion and Fission

**Fusion** (combining):
> "From these matrices you can see that any components with the same patterns of response to stress can live in the same component–they can be combined!"
> "This allows the architect to safely reduce N, reducing effort in operations and deployment"

**Fission** (splitting):
Driven by excessive coupling — when a component's column total is high, its stress surface is too large and it should be split to reduce K.

---

## Residual Index

Ri = (Y - X) / S

- X = stressors survived by naïve architecture
- Y = stressors survived by residual architecture
- S = total test stressors (never used in development of either architecture)
- Valid range: -1 < Ri < 1

> "If Ri > 0 then we have a positive movement toward criticality for the effort expanded."
> "As Ri approaches 0 across iterations there is less and less return in doing further architectural work"

---

## Criticality

> "Kauffman identified the property of criticality. This means that at a certain level of N (nodes) and K (links), a system is resilient to unexpected changes and at the same time not so complicated that it collapses under the weight of managing its own resources."
> "Criticality is finding the balance between these things."

K≈2 per node is the zone of criticality (Kauffman). Monoliths have low N/K; microservices have high N/K. Criticality is between.

---

## No Probabilities

> "A risk is something which has an attached probability and impact–numbers which are most often simply an opinion. Stressors are completely free from these hindrances"
> "Probability in risk is a necessary technique for the management of capital risk, for showing evidence of due diligence, but for the purposes of architecture we do not need to enter into the charade of pretending these numbers have scientific meaning."

---

## Hyperliminal Systems

> "A hyperliminal system is a system where a complicated, ergodic, ordered system executes inside a complex, non-ergodic, disordered context."

- Software = ergodic, ordered, complicated
- Business environment = non-ergodic, disordered, complex

> "You cannot map hyperliminal systems"
> "You cannot control hyperliminal systems"

Non-functional requirements are only discoverable through random simulation of stress scenarios — they cannot be predicted through analysis.

---

## Mathematical Leverage

> "At the heart of this idea is a simple mathematical leverage that makes it work. Each attractor has a certain number of stressors that can push a system to that attractor. The architect only has to identify one to protect against all of the unlisted ones."
> "The number of potential stressors–things that can happen in the environment–is orders of magnitude greater than the number of potential attractors in a complex system."

Random simulation works because stressors are many; attractors are few. Identifying an attractor's residue protects against all stressors that lead to it.

---

## FMEA

> "This technique can be used once the architecture starts to near completion to manage the stress of technical failure. A simple technique that takes mere minutes to learn, FMEA can be used to make sure that a certain level of quality will be present in the architecture."
> "An inability to describe the impact of component failures on an architecture suggests a poor architecture, so this serves as a final test of the work that has been done thus far."

FMEA is a technical validation layer applied after residual analysis is complete.

## ATAM

Architecture Trade-off Analysis Method. Applied after FMEA:

> "The ATAM analysis catches political and business misunderstandings, and FMEA catches technical issues introduced by the addition of components."

Both are positioned as validation layers after the residual architecture is established.

---

## Key Heuristics

> "Flows are better than process or use case mapping"
> "Matrices are better than component decomposition by pattern or framework"
> "Residues replace components or patterns as the unit of architecture"
> "Random simulation is better than requirements, risks, and predictions"
> "Software architecture is the practice of being consistently wrong until you reach a point of being a little bit less wrong."
