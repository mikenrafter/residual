# ATAM — Architecture Tradeoff Analysis Method: Research Notes

Source: Barry O'Reilly, *Residuality Theory* (brief mention); SEI methodology to be populated during atam skill sessions.

---

## Role in Residuality Workflow

> "The ATAM analysis catches political and business misunderstandings, and FMEA catches technical issues introduced by the addition of components."

ATAM is the final validation layer, applied after FMEA. It surfaces stakeholder concerns, quality attribute tradeoffs, and political constraints against the candidate architecture.

Order: integrate-analysis → FMEA → **ATAM**

---

## Standard ATAM Process (placeholder — expand during atam skill sessions)

1. **Present the architecture** to stakeholders
2. **Identify quality attribute scenarios**: performance, security, modifiability, availability, etc.
3. **Analyze architectural decisions** against each scenario:
   - Which decisions support this quality attribute?
   - Which trade against it?
4. **Identify sensitivity points**: decisions that strongly affect one quality attribute
5. **Identify tradeoff points**: decisions that affect multiple quality attributes in opposing directions
6. **Document risks**: architectural decisions that may not satisfy a quality attribute in some attractor

---

## Residuality Framing

In residuality, ATAM scenarios map to attractors. Each quality attribute scenario is a stressor — what happens to this quality attribute when the system transitions to attractor X?

Personas from `residual/personas/` serve as the stakeholder voices. Each persona has quality attribute concerns expressed in their persona file.

Risks in ATAM (consistent with no-probabilities philosophy) are: architectural decisions that may fail to satisfy a quality attribute in a particular attractor — not probability/impact pairs.

---

## TODO

Populate this file with specific ATAM findings during the `atam` skill session. Reference the SEI ATAM report template (IEEE Std 1471 and the original Bass, Clements, Kazman methodology).
