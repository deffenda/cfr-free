# Pilot session pack — running one M6 session

**What this is.** The operator-side materials for one session of the M6
practitioner study: an invitation to send, the consent text, and the
run-through checklist. The protocol itself is
[`practitioner-pilot.md`](practitioner-pilot.md) — this pack points into it
rather than restating it, so the two cannot drift.

**The repository contacts no one.** The invitation below is a draft for
the operator to send in their own voice, to people they already know.
Nothing here is sent automatically, there is no telemetry, and the tool
never initiates follow-up (`practitioner-pilot.md` §9.7).

**This pack is used alongside the protocol**, not instead of it: the
scenario texts are in the protocol's Appendix A, and the results templates
are in its §10. The pack carries the invitation, the consent conversation
and the run order; the protocol carries the scenarios and the sheets, so
the two cannot drift apart.

---

## 1. The invitation (draft — edit, then send)

> **Subject:** Would you try a free offline CFR search tool for 45 minutes?
>
> Hi — I'm testing a free, self-hosted tool that mirrors Title 38 (the VA
> claims regulations) so it can be searched **offline**, with the text and
> the source date shown for every hit.
>
> Would you be willing to try it on a **synthetic** scenario I provide?
> Nothing of yours is involved: no claim, no document, no personal or
> medical information, and no real case. The session is **observed and
> timed** — I'd be watching your screen and taking notes, because I need to
> see where it gets in your way.
>
> About 45 minutes. You're welcome to stop at any point, and if you'd
> like, I'll destroy the notes from that point on request. The notes stay
> on my machine, and nothing is published.
>
> If you use a different tool for this kind of lookup, I'd also like to
> time you on your own way first, so the comparison is fair.
>
> Want to take a look?

**Before sending it, check:** the participant can run Node.js ≥ 22.5 and
reach `ecfr.gov` (§5.1 inclusion; §12) — the tool is not on npm and there is no hosted
service, so the session runs on _their_ machine (§12).

---

## 2. The consent conversation (read aloud, then record)

Everything below is from §9 of the protocol; say it in your own words and
record the answers.

- **What you will be asked to do** — the paired baseline run on your own
  tool first (§6.1), then the tasks in §6.3–§6.7 (one per family: F1
  citation lookup, F2 shorthand-to-criteria, F3 cross-reference follow-up,
  F4 historical comparison, F5 export/copy verification).
- **What is recorded** — task outcomes, the provisions you landed on, the
  time, the installation obstacles, and your answers to the debrief
  questions (§9.1).
- **What is never recorded** — no claim, no document, no personal or
  medical information; nothing that would identify a person (§9.2).
- **That the session is observed and timed** (§9.1).
- **That the notes are local and operator-controlled**, destroyed on the
  schedule in §9.6, and not published (§9.4, §9.6).
- **That you may stop at any point**, and that the notes for that point
  are destroyed on request (§9.3).
- **That you may consent to one specific verbatim quote being kept** —
  only that quote, marked as verbatim (§9.5).
- **That the tool never contacts you afterwards** (§9.7).

**Record** (§10.1): consent given y/N; the verbatim-quote opt-in y/N; the
participant's role; the date; the device (Node version, OS); the actual N
as it stands.

---

## 3. The run-through checklist

**Before the participant arrives**

1. The index is synced and current: `cfr-free sync` (§12; the corpus is
   ~2–3 MB and takes ~5 s). Note the index issue date — F1/F4/F5 are
   scored against it.
2. A source checkout of the tool, `npm ci` already run, `npm run build`
   already run (§12).
3. The scenario material for the five families, in the form §6.3–§6.7
   specify.
4. A blank copy of the results template (§10.1–§10.4) ready to fill.

**During**

5. The **paired baseline run first** (§6.1): the participant does the
   same task their own way, and it is timed with the same clock — the
   comparison is within-participant and unblinded, and that is stated in
   the limits (§12).
6. The tasks in order, timing each from the participant's first action to
   completion, and writing the **provision they landed on** (not the one
   you expected) for every attempt (§10.2).
7. Classify each attempt as you go, against the classes in §6.8 and the
   legend in §7.2 — and for a sibling, **write the one-sentence
   justification**; if you cannot, it is `E1` or `E2`, not `S` (§6.8).
8. Record every installation obstacle with minutes lost, not averaged
   away (§7.5), and the `U`-class exclusions with the rate they affect.
9. The debrief (§6.9), with question 3 recorded **verbatim** where
   consent was given (§9.5).

**After**

10. Fill the cohort header and the per-participant table (§10.1, §10.2),
    and the failure inventory with its `E3` sub-reasons (§10.3).
11. Complete the paired-run table (§10.4) and the comparison notes
    (§7.7).
12. Record whether you **invited** a return, and whether one happened
    within 30 days (§7.6).
13. Keep the notes where §9.4 says they live, and destroy them on the
    schedule in §9.6.

---

## 4. What the results decide

- **Continue / change / stop** — the agreed mapping in §11.2, with the
  seven criteria in §8 (all agreed 2026-10-21). Precedence: CONTINUE
  wins over CHANGE when both match; anything matching neither CONTINUE nor
  STOP defaults to CHANGE.
- **The subject index** — the pilot's `E3` count decides whether it is
  ever built: **a majority of the cohort's F2-B attempts** (3 or more at
  N = 5) reopens the brief; below that it stays closed as not justified
  (`ROADMAP.md` §M3, decided 2026-10-21 — the reopen condition was fixed
  before any data exists, so it cannot be reopened by re-interpreting it
  later). A **second observer re-classifies a sample** of the `E3` entries
  before the count is used (§8, SC-7).

---

## 5. What is deliberately not here

No outreach plan, no target list, no contact script (§9.5) — those are
the operator's by design, because M6 requires operator arrangement and
authorization. No telemetry and no automatic outreach anywhere (§9.7). No
real claim, document, or personal or medical information at any point
(§9.2).
