# Demo: Stressor-walk — session lifecycle, write integrity, and matrix identity

This excerpt is from a stressor-walk session on the `residual` codebase itself. The
walk ran four lanes (A–D) in sequence: session lifecycle (install → check → skill-data →
add), write integrity under concurrent and bypassed writes, matrix/component identity,
and a summary close. The session produced seven new or updated forces (S-01, S-03,
S-09, S-26–S-29, P-18) plus a new term (`session`) — all ledger-only, no implementation.

The opening persona exchange set the frame: the matrix was almost perfectly diagonal,
meaning no shared stress response across components was visible yet, which is the gap
the walk was designed to probe.

---

## Opening: a diagonal matrix as the first finding

**Agent (after loading skill data):**

> **Stressor walk ready.** Context loaded: 7 attractors, 25 stressors, 17 purposes,
> 2 personas (`architect`, `agent`). Skill installed for Cursor (version check flagged
> installed v1 vs embedded v0 — we'll treat that as a live signal, not noise).
>
> **Matrix note:** every stressor sits on a single column — a perfect diagonal. No
> shared stress response across components yet. That is the gap this walk should probe.
>
> **Persona: Architect**
> > Twenty-five stressors and the matrix still looks like a checklist. If every stress
> > only hits one silo, I'm not learning coupling — I'm cataloguing features. Show me a
> > stressor that forces Storage and Skills to move together, or I'm editing the CSV
> > myself.
>
> **Persona: Agent**
> > I need to know which skill version I'm under. Right now `skill-check` says installed
> > 1 / embedded 0 — I don't know whether to trust the prompt or the binary. Also: if
> > `skill-data` ever comes back thin, I will invent architecture. Ground me before I
> > invent.

---

## Walk A: the operator proposes a stressor the ledger already covers

The operator pitched a new stressor before the walk formally opened. The agent cross-
checked existing forces first.

**Operator:**

> 1-stressor: the architecture design is slow to iterate because errors are only caught
> at commit time — outcome: surface validation failures to all skill-data outputs
> 2-look through the stressors and purposes, there's something in there about that
> already. Many changes are on the way, but we're not implementing yet.

**Agent:**

> Your proposed stressor is already in the ledger — no new add needed.
>
> **Closest existing cover**
> - **S-09** → A-05: unverified residual state after hook bypass; *outcome already says*
>   skill sessions surface that window before analysis.
> - **S-08** → A-05: empty/missing metadata; `skill-data` should warn and bootstrap
>   instead of analyzing fiction.
>
> Your outcome ("surface validation failures on all `skill-data` outputs") is the
> **bridge between P-04 and P-02** that S-09's `naive_change` already sketches —
> pending work, not a gap to invent.

The operator approved adding two new stressors anyway — many:1 stressor:attractor is
valid — and corrected the framing on S-01.

**Operator:**

> You're right that the attractor for S-09 is the same as this stressor I pitched. Add
> it anyway. Stressor:Attractor is many:1. The stressor is different even though the
> attractor isn't.
>
> 1. version inversion — generalize it to mismatched version rather than old version.
> The outcome fix of minimal-skill + binary produced details solves this.

**Agent (after writing):**

> | ID | Change |
> |---|---|
> | **S-26** → A-05 | Validation only at commit; outcome: every `skill-data` surfaces verify failures |
> | **S-27** → A-05 | No gated-add path; outcome: optional super-strict mode (default off — your workflow / P-07 intact) |
> | **S-01** → A-03 | Generalized to version *mismatch*; outcome: minimal stubs + binary-produced skill details |

---

## Walk A continued: surfacing vs halting

The persona challenge forced a resolution on what "surface failures" actually means
in practice — does the agent halt, or does the operator decide?

**Agent (Persona: Architect):**

> Fine — don't gate my adds. But if skill-start shows a broken baseline and you keep
> Socratically asking me for more stressors, you're training me to ignore the banner.
> Repair-first or analysis-first?

**Operator:**

> Operator chooses, agent surfaces. Repair mode is still socratic.

**Agent:**

> Settled for A: **agent surfaces, operator chooses; repair stays Socratic** — not an
> automatic halt. That refines S-26's residue. Proposed update (needs your OK before I
> write):
>
> - **naive_change:** `skill-data` embeds verify status; agent surfaces failures and
>   offers a Socratic repair path; analysis vs repair is the operator's choice (no forced
>   gate unless super-strict / S-27).

The operator then added a stressor for the edge case — an operator who tries to enable
super-strict mode while already in invalid state.

**Operator:**

> stressor: user has invalid state and tries to switch to super-strict mode — outcome:
> prevent the switch and give a descriptive error message with helpful next steps if the
> user wants to do that. Since super-strict mode is a config item, launching the CLI will
> merely refuse to be super strict and it will be very obnoxious about its
> misconfiguration.
>
> Approved. Apply all.

---

## Walk B: concurrent writes and the session concept

Walk B examined whether the SHA-based change-detection (S-20) covered hand-edited rows
followed by CLI appends. The agent initially thought it didn't; the operator corrected it.

**Agent:**

> **Hyperliminal gap:** Change-detection keyed on **overwrite** does not fire on
> **append**. Operator hand-edits a stressor row → agent `residual add stressor`
> appends → no hash mismatch, no diff, no `--force` — and the file is still
> "CLI-touched" after human drift.

**Operator:**

> running `residual add stressor` after hand-editing will trigger the change detection
> mechanism. The SHAs will differ. No issue.

B.1 (concurrent append) produced the most structural output: the operator introduced a
session concept mid-walk.

**Operator:**

> Add a session concept. Purpose: data integrity, Stressor: parallel agents — fix:
> lockfile with sessions that auto-expire after 30m. The agent will close it when
> concluding (skill). If a skill is interactively launched by an operator while a session
> lock is active, the data will not return, and instead a message asking if the operator
> would like to clear the session before continuing.

**Agent (after writing):**

> | ID | What |
> |---|---|
> | **S-03** | Generalized to all CSV appends / agents; SHA change-detection + return assigned ID (no predicted next-ID) |
> | term `session` | Lockfile engagement, TTL default 30m, explicit close |
> | **P-18** → A-01 | Session lock preserves data integrity across concurrent skill engagements |
> | **S-29** → A-04 | Parallel agents; lockfile acquire/release/expire; interactive skill-data withholds context and asks to clear |

---

## Walk C: free-text component columns hiding coupling

The final lane examined why the matrix stayed diagonal despite 29 stressors. The answer
was string equality on entire `components_affected` values.

**Agent:**

> **Live evidence from this session's matrix:** nearly diagonal. Columns are free-text
> blobs from `components_affected` — e.g. `skill-data verify-all` vs `git-hook
> skill-data verify-all` vs `skill-data storage-init` are **three columns**, not shared
> marks on `skill-data`. Hyperliminal coupling is invisible because identity is string
> equality on the whole field, not a registry.
>
> **Persona: Architect**
> > Twenty-nine stressors and the matrix still won't show me that S-09 and S-26 both
> > touch `skill-data`. If fusion candidates require identical column sets, free-text
> > naming guarantees I'll never get a fusion signal. Fix identity or delete the colored
> > table.
>
> **Persona: Agent**
> > I invent component strings at add-time. Nobody checks them. I will keep inventing
> > synonyms and call it architecture.

**Operator:**

> 2+3 — already thought through and will be handled before long.

The walk closed without inventing new stressors for C: the planned registry-first path
(S-11/S-15) and residues-owned coupling (S-17/S-19) already covered the lane.

---

## What this demonstrates

- **Persona mode surfaces real blind spots.** The agent-persona's complaint about
  inventing architecture when `skill-data` comes back thin (and about the version
  inversion) were the two liveevidence signals that anchored Walk A. Personas are not
  decoration — they are information-flow probes.

- **Many:1 stressor-to-attractor is the norm, not an error.** The operator explicitly
  clarified this when the agent flagged that S-26 and S-09 share an attractor. Two
  different narratives of how the system reaches the same bad state are two stressors.

- **Socratic interaction keeps the operator in control of scope.** The agent proposed
  before writing in every case. When the operator said "3" to choose a sub-lane or
  "approved, apply all" for a batch, execution followed. Nothing was written speculatively.

- **The session concept arrived from a stressor, not a design session.** P-18
  (session lock for data integrity) and S-29 (parallel agents) were discovered while
  walking B.1. The mechanism (lockfile, 30m TTL, withhold skill-data) came out of the
  stressor narrative, not a feature planning meeting.

- **A diagonal matrix is a diagnostic, not a failure.** It meant free-text component
  labels were hiding coupling. The walk named the root cause (string equality, no
  registry), confirmed that S-11/S-15/S-17/S-19 already described the fix, and moved on
  without duplicating stressors. Knowing when *not* to add is part of the skill.
