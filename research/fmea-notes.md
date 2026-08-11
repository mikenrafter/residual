# FMEA — Failure Mode and Effects Analysis: Research Notes

Source: Barry O'Reilly, *Residuality Theory* (brief section in epub)

---

## Summary from Source

> "This technique can be used once the architecture starts to near completion to manage the stress of technical failure. A simple technique that takes mere minutes to learn, FMEA can be used to make sure that a certain level of quality will be present in the architecture. A huge number of projects would benefit greatly from using FMEA. An inability to describe the impact of component failures on an architecture suggests a poor architecture, so this serves as a final test of the work that has been done thus far."

---

## Role in Residuality Workflow

FMEA is applied AFTER the residual architecture is established. It is not a design input — it is a validation layer.

Order: purpose-walk → naive-draft → stressor-walk → integrate-analysis → **FMEA** → ATAM

FMEA catches **technical issues** introduced during architecture construction. ATAM catches **political and business misunderstandings**.

---

## Standard FMEA Process (to be expanded during fmea skill sessions)

For each component:
1. **Failure mode**: how can this component fail? (process failure, data corruption, unavailability, etc.)
2. **Effect**: what happens to the system and its attractors if this component fails?
3. **Severity**: qualitative — catastrophic / major / minor / negligible (no numbers — consistent with no-probabilities philosophy)
4. **Detection**: how would this failure be detected in production?
5. **Mitigation**: what architectural or operational change reduces severity or improves detection?

---

## Key Insight from Residuality Framing

An inability to describe the failure mode of a component indicates a **poorly defined component**. If you cannot say how it fails, you do not understand its boundary. This connects directly to APOSD's "deep modules" — a well-defined module has a clear failure surface.

---

## TODO

This section needs expansion via the `fmea` skill session with actual architecture. The epub contains only a brief reference. The standard IEEE/IEC 60812 FMEA methodology should be consulted for more depth.
