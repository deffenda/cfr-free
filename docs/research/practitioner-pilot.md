# Practitioner pilot — proposed protocol (ROADMAP M6)

**Date:** 2026-10-21 · **Status:** **PROPOSED — nothing in this document is
decided.** The success criteria in §8 are proposals for the operator to
accept, revise or reject _before_ any recruitment, per the M6 acceptance
condition (`ROADMAP.md` §M6).
**Authority:** the M6 section of `ROADMAP.md` (§M6).
**Evidence base:** this repository at `928e63e`; the local index built from
the eCFR issue date **2026-10-16** (**2 970 provisions** — 2 953 sections +
17 appendices, measured against a copy of the live index on 2026-10-21).
**Deliberately not here:** an outreach plan, a message template, a target
list, any code, any telemetry, any change to the product (§12).

---

## 1. Why this study exists

M6 is not a user-interface exercise. It is the **demand gate** for the
next two roadmap stages, and four specific decisions are waiting on its
output.

1. **M7 (integrations) and M8 (corpus/platform expansion) are gated on
   demand evidence** (`ROADMAP.md` §M7–§M8). The questions are narrow:
   _does anyone actually need this, and would they change their workflow?_
   This study is designed to answer exactly those two questions and nothing
   larger.
2. **The subject index is deferred pending this study.** A curated
   benefit/topic → sections map — the thing that would make § 4.125
   ("Diagnosis of mental disorders") reachable for the question "PTSD" —
   was explicitly **deferred, not cancelled**, with the recorded reason:
   _"The demand evidence is M6's practitioner study (does the workflow
   actually ask subject-level questions?)"_ (`ROADMAP.md` §M3). This
   protocol must therefore measure whether subject-level questions arise
   in real use, not whether a specific retrieval misses.
3. **The ranking investment is currently unmeasurable as a _preference_.**
   On the frozen 50-query evaluation set, **43 of the 46 answerable
   queries have their expected provision in the top five, but only 35 have
   it first** — the top hit is right about **76%** of the time (measured
   2026-10-21 on the committee's adjudicated expectations, re-measured
   after the ranking round in PR #105; the runner's own metric — §4). The
   **eight** in-window-but-not-first cases are _not_ a block of harmless
   near-misses: the adjudication committee **rejected** every sibling
   proposed for them — § 17.151 (invalid lifts) for the three
   special-monthly-compensation queries, plus § 17.160, § 3.1701,
   § 36.4225 and § 3.455 — on the principle that a sibling counts when it
   **answers the question the query asks**, not when it merely shares
   vocabulary with the expected provision
   (`docs/research/expectation-adjudication-2026-10-21.md` §11.2). What is
   left is a different benefit type, an eligibility rule where a rate was
   asked for, a mechanic that presupposes the entitlement, and one
   phrase-perfect hit on the wrong programme (§ 9.21). The exception case
   (§ 4.86 for § 4.85) was rejected on the same principle and has since
   been closed by the ranking round in PR #105; the rest are recorded in
   the ROADMAP (`ROADMAP.md` §M3). So "top-1 is 76%" **cannot be read as
   "24% of the time the tool misleads the practitioner."** This study is
   the instrument that separates the two readings: it observes whether a
   practitioner, shown the heading and the snippet, lands on the right
   provision anyway.
4. **The M5 workflow must be shown usable end to end**: find provision →
   read full content → follow references → inspect the dated change view →
   copy a citation (`ROADMAP.md` §M5).

## 2. What this study is, and what it is not

### 2.1 The dependency M6 records, and where it stands

M6 opens with its own dependency line: _"study design can start now;
usable pilot requires A and C"_ (`ROADMAP.md` §M6). Read against the
delivery-order table (`ROADMAP.md`, "Delivery order and exit gates"), that means:

| Stage | Work                               | Exit evidence                                                                                    | Where it stands for this study                                                                                                                                                                                                                                                                                                                                      |
| ----- | ---------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | trustworthy baseline (P1-01…P1-04) | four fixing PRs, reviewed SHAs, gate tails; no silent loss of graphics or stale-route repaint    | **Shipped** — the corpus fidelity work and the route-ownership fix are in `origin/main`; the corpus this study uses is the post-A corpus (2 970 provisions, 9 image-marked provisions, measured 2026-10-21)                                                                                                                                                         |
| **C** | usable distribution (M4, M5)       | verified onboarding and one end-to-end research/export workflow                                  | **Shipped** — the M5 section header records 4 of 4 slices done (`ROADMAP.md` §M5); the copy block (`src/titan/ui.ts:629-649`), the redline view (`src/titan/ui.ts:44`, `:97-110`, `:429-484`, shipped as `ae61dbf`), the subject-group descent (`src/core/service.ts:519-540`) and the ETag reads (`docs/SPEC.md:244`) are what families F1, F3, F4 and F5 exercise |
| **D** | validate demand (M6)               | operator-arranged practitioner study, task-level results, explicit continue/change/stop decision | **This document** — the protocol; the study itself is operator-arranged and has not been run                                                                                                                                                                                                                                                                        |

> **One stale row in the ROADMAP, flagged rather than absorbed.** The M5
> header says 4 of 4 slices are done (`ROADMAP.md` §M5), but the **slice-2
> row of the table below it still reads "OPEN"** — while the UI redline
> view it describes is implemented (`src/titan/ui.ts:44` links the route,
> `:97-110` is the form, `:429-484` renders it, `:501` calls
> `/api/v1/redline`, shipped as commit `ae61dbf` with 109 lines of
> behavioural test). The header was corrected by `736b355`; the row was
> missed. This document cites the **implementation**, which is what
> families F1, F4 and F5 actually exercise. The ROADMAP row is the
> operator's to correct — this packet does not touch the ROADMAP.

So the design may start now **and** the two stages it depends on are
already delivered. What is still outstanding is entirely on the
operator's side: recruitment, consent, and the agreement of the success
criteria in §8 before anyone is contacted.

### 2.2 What the study is, and what it is not

| This study **is**                                                                     | This study **is not**                                                                            |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A structured observation of **5 participants** doing **7 synthetic tasks each**       | A statistical validation — n = 5 is a planning target, not a sample                              |
| A measurement of the **local tool** on a **local machine**                            | A measurement of a hosted service; there is no hosted service and no account (`README.md:10-12`) |
| A source of **counts with denominators**, a **failure inventory**, and a **decision** | A market-size estimate, a revenue forecast, a claim-accuracy opinion check, or a legal opinion   |
| A **proposal** for the operator to agree the success criteria up front                | An agreed threshold set — §8 is unapproved until the operator signs it                           |

Two consequences worth stating plainly, because they are the kind of thing
that gets quietly forgotten later:

- **The M6 cohort size is a planning target, not evidence of demand.**
  `ROADMAP.md` §M6 says so in terms: _"Proposed starting cohort: five
  practitioners or tool builders; this is a planning target, not existing
  demand evidence."_ A successful pilot of five people is evidence that
  five people found it useful. It is **not** evidence that the market
  wants it. The decision log in §11 carries that distinction into every
  row it will ever hold.
- **The suggested continue signal is a decision threshold, not proof.** The
  ROADMAP's own words (`ROADMAP.md` §M6) are: _"at least three
  participants complete four of five tasks without a citation/version error
  and request repeat use; explicitly label this an initial decision
  threshold, not statistical proof or a revenue forecast."_ §8 adopts that
  signal as **SC-1** and repeats the label verbatim.

## 3. The capabilities under test

Everything below ships today and is cited to its implementation. The study
measures _these_, in the version recorded here.

| Capability                                                                                                                             | Where it lives                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Full-text search over the local index                                                                                                  | `src/core/store.ts:1002` (`Store.search`)                                                                                                 |
| Curated claims-language → regulatory-phrase synonym map (9 acronyms + 1 vocabulary bridge + 2 punctuated abbreviations)                | `src/core/store.ts:313-335` (`SYNONYM_PHRASES`), `src/core/store.ts:345-348` (`RAW_PHRASE_EXPANSIONS`)                                    |
| Candidate set = the OR tier; AND tier is a ranking boost                                                                               | `docs/SPEC.md:187-198` (SPEC §4.1), `docs/SPEC.md:221-226`                                                                                |
| Heading-phrase ranking key ahead of body-only hits                                                                                     | `docs/SPEC.md:206-220` (§4.1); the SPEC backlog row that promised it is `docs/SPEC.md:355` (SPEC §13 row 4)                               |
| Citation queries are pinned as the first hit                                                                                           | `docs/SPEC.md:237` (HTTP `search`), `docs/SPEC.md:252` (MCP `search_regulations`)                                                         |
| Read a provision in full, with its source date and a **dated** verification URL                                                        | `src/core/service.ts:166-198` (`SectionDetail`), `src/core/service.ts:280-283` (the dated URL builder)                                    |
| Forward cross-references (`references[]`) with a local-availability flag                                                               | `src/core/references.ts:39-50` (extraction), `src/core/service.ts:186-187`                                                                |
| Backward cross-references (`citedBy`)                                                                                                  | `src/core/service.ts:188-193`                                                                                                             |
| Browse the structure tree                                                                                                              | `src/core/service.ts:519-540`, `src/core/structure.ts:95-128`                                                                             |
| Subject-group descent (the fifth tree level)                                                                                           | `src/core/service.ts:519-540` (the `subjgrp` input), `docs/SPEC.md:239`                                                                   |
| Dated change view between two eCFR dates                                                                                               | `src/core/diff.ts:57-73` (provision level: hashes **text and heading**), `src/core/redline.ts:217-281` (line level: hashes **text only**) |
| Copy-a-citation block (legal display form, heading, source line + issue date, dated verification URL, explicit incompleteness warning) | `src/titan/ui.ts:629-649` (the block), `src/titan/ui.ts:643-647` (the image-marker warning)                                               |
| Export to SQLite / JSONL / Markdown                                                                                                    | `src/commands/export.ts:98-137`; `src/commands/export.ts:25-59` (JSONL), `src/commands/export.ts:69-83` (Markdown)                        |
| Export refuses to overwrite an existing target                                                                                         | `src/commands/export.ts:110-115`                                                                                                          |
| MCP surface: `search_regulations`, `get_section`, `browse_title38`, `index_status`, `list_parts`, `health`                             | `src/mcp/tools.ts:225`, `:326`, `:364`, `:415`, `:456`, `:489`                                                                            |
| MCP live tools: `get_section_at`, `diff_issues`, `redline`                                                                             | `src/mcp/tools.ts:525`, `:583`, `:634`                                                                                                    |
| MCP resources and prompts (`cfr_research`, `cfr_claim_evaluation`)                                                                     | `src/mcp/resources.ts:36`, `:58`, `:80`, `:115`, `:159`                                                                                   |

Three properties of the tool shape the protocol, and are stated here so no
participant or observer has to guess them:

- **It is local.** The HTTP API binds `127.0.0.1` by default and has no
  auth; the index is one SQLite file (`docs/SPEC.md:231-244`,
  `src/cli.ts:34-41`). Nothing is sent anywhere.
- **It is not published.** `npm install -g cfr-free` does not work: the
  registry returns 404 for `cfr-free` (last checked 2026-10-20,
  `README.md:83-86`). The installation path is a source checkout
  (`README.md:50-81`).
- **Two of the five families need the network.** `sync`, `diff`,
  `redline` and `historical` fetch from eCFR (`README.md:44-48`,
  `src/core/diff.ts:9-14`). Serving and searching are offline
  (`README.md:47-48`). The protocol treats an upstream failure as its own
  outcome class (§6.8), never as a participant error.

## 4. The measured baseline the tasks are built on

All numbers below were **re-measured on 2026-10-21** by running the repo's
own frozen harness against a copy of the live index, exactly as
`docs/research/retrieval-baseline-2026-10-20.md:24-35` documents:

```bash
cp ~/.cfr-free/index.sqlite /tmp/eval-index.sqlite
CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/retrieval/run.ts dev
CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/retrieval/run.ts holdout
```

| Metric (frozen 50: 30 dev + 20 holdout) | Measured 2026-10-21, adjudicated expectations |
| --------------------------------------- | --------------------------------------------- |
| Queries / answerable                    | 50 / 46                                       |
| Expected provision in the **top five**  | **43 of 46**                                  |
| Expected provision **first**            | **35 of 46** (top hit right ≈ **76%**)        |
| In-window-but-not-first                 | **8**                                         |
| Mean reciprocal rank                    | dev 0.8448 · holdout 0.8137                   |

The runner's own definitions are at `test/fixtures/retrieval/run.ts:110-113`
and its aggregation at `test/fixtures/retrieval/run.ts:151-162`. The
"35 / 43 / 8" figures are the run at `496d24f` — the ranking round's merge —
against the committee's adjudicated expectations. The pre-adjudication
figures they replace were 29 / 42 / 13; both sets of numbers are recorded
in the ROADMAP (`ROADMAP.md` §M3).

Two things the tasks are built on, and one thing they are not:

- **The eight in-window-but-not-first cases** (re-measured at `496d24f`; each
  row is the runner's own output):

  | #   | Query                                  | Top hit | Expected (rank)          |
  | --- | -------------------------------------- | ------- | ------------------------ |
  | 1   | `SMC`                                  | 17.151  | 3.350 (2)                |
  | 2   | `special monthly compensation`         | 17.151  | 3.350 (2)                |
  | 3   | `"special monthly compensation"`       | 17.151  | 3.350 (2)                |
  | 4   | `traumatic brain injury compensation`  | 9.21    | 3.350 (3), 4.124a (4)    |
  | 5   | `veterans dental benefits eligibility` | 17.160  | 17.161 (4), 3.381 (3)    |
  | 6   | `military burial allowance rate table` | 3.1701  | 3.1704 (2), 3.1705 (4)   |
  | 7   | `va loan underwriting guidelines`      | 36.4225 | 36.4206 (4), 36.4340 (3) |
  | 8   | `DIC`                                  | 3.455   | 3.10 (5), 3.25 (3)       |

  Every sibling the committee proposed for these eight was **rejected**
  (`docs/research/expectation-adjudication-2026-10-21.md` §11.2), each on
  the question-asked principle: § 17.151 furnishes **invalid lifts** — a
  different benefit type from the rating schedule (rows 1–3); § 17.160 says
  who may be **examined**, not who is **eligible** (row 5); § 3.1701 is
  **eligibility**, not the **rate** (row 6); § 36.4225 is the lender's
  authority to **close** a loan, not the **underwriting standards** (row 7);
  and § 3.455 is **apportionment** — a mechanic that presupposes the
  entitlement rather than stating it (row 8). Row 4 is the record's one
  clear ranking failure: § 9.21, the Part 9 servicemembers'-insurance loss
  schedule, which names "Traumatic Brain Injury" verbatim and pays $25,000.
  The hearing case that stood here before the ranking round (§ 4.86 for
  § 4.85 — the exception, not the general rule) is **closed**: PR #105
  demotes a heading that announces an exception, and the general evaluation
  § 4.85 now leads. **This protocol does not re-adjudicate the committee's
  rulings.** What it does is observe whether a practitioner experiences
  these same cases as failures.

- **The vocabulary gap is real and measurable.** The corpus says "hearing
  impairment" (14 provisions) where clients say "hearing loss" (3), and a
  bridge for it now ships (`src/core/store.ts:330-334`); the measured
  shape of the problem is that **the corpus's vocabulary is not the
  user's**. The tasks keep asking the way a rating office asks.
- **The subject gap is a separate, larger class.** Searching `PTSD` returns
  § 3.304, § 17.644, § 61.1, § 3.12, § 9.21 — **no rating provision in
  the top five** (measured 2026-10-21). § 4.125 "Diagnosis of mental
  disorders" contains no "PTSD", no "posttraumatic" and no "stress
  disorder" at all; neither does § 4.129. Only § 4.130 carries that
  vocabulary, and § 3.309 carries it in the service-connection context.
  Task **F2-B** is built specifically to see whether practitioners need
  the unreachable provisions (§6.4).
- **What the baseline does not say.** These are 50 _authored_ queries, not
  a traffic sample. No participant traffic exists to compare against, and
  the harness measures the **retriever**, not whether a human lands on the
  right provision. That gap is exactly what this study closes.

## 5. Cohort, denominators, and how the numbers are counted

### 5.1 Cohort

**Proposed: 5 participants** — practitioners (claims adjudicators, rating
officers, veteran-support officers) or tool builders, per `ROADMAP.md` §M6.
The protocol works at any N; §5.2 states every denominator in terms of the
**actual N**, so a cohort of 3 or 7 is reportable without changing a
single table.

**The N is never assumed.** Every figure in §10 is written `x/N` with the
real N substituted at analysis time. A report that says "four of five
participants" when four of five were _attempted_ is not a result; the
attempted and completed denominators are recorded separately.

**Inclusion:** the participant can run Node.js ≥ 22.5 on a machine they
control and can reach `ecfr.gov` (needed for `sync`, and for family F4).
**Exclusion:** anyone for whom the study would require handling a real
claim file or a real person's medical information (§9).

### 5.2 Denominators — the complete list

| Denominator               | Value                                       | Used for                               |
| ------------------------- | ------------------------------------------- | -------------------------------------- |
| `N` participants          | actual, target 5                            | every cohort-level claim               |
| `N × 5` core tasks        | one core task per family per participant    | the ROADMAP's continue signal (SC-1)   |
| `N × 2` variant tasks     | one variant in F2 and one in F5, per person | the per-family error rate in F2 and F5 |
| `N × 7` task attempts     | 5 core + 2 variants per participant         | the failure inventory                  |
| `N` attempts per family   | `N` in F1, F3, F4; `2N` in F2 and F5        | the per-family denominator             |
| `N` paired baseline runs  | one task, run twice (see §6.1)              | the time comparison in SC-2            |
| `N` installation episodes | one per participant                         | installation obstacles (SC-3)          |
| `N` return decisions      | one per participant                         | "return for another session" (§7.6)    |
| `N` debriefs              | one per participant                         | the workflow-change question (SC-6)    |

**The continue signal is evaluated on the five CORE tasks only** (one per
family). The variant tasks contribute to the per-family error rate in F2
and F5 and to the failure inventory, but never to SC-1. This keeps a 1:1
correspondence with the ROADMAP's wording — _"complete four of five
tasks"_ means four of the five families' core tasks — and it means the
continue signal is not inflated by a second, similar attempt.

**Why only two families have a variant.** F1, F3 and F4 are each a
single, unambiguous act (open a citation; follow a reference set; compare
two dated versions of one provision), and a second wording of them would
mostly re-test the same thing. F2 and F5 are the families where a
_different wording measures something new: F2's variant is the
subject-gap probe (does the question need a provision that is not reachable
by vocabulary?) and F5's is the incompleteness probe (does the pasted
block imply coverage it does not have?). Both are scored on a chain rather
than on a first hit, so the extra attempt adds an observation the core
attempt cannot produce — which is why they are variants and not repeats.

### 5.3 Counting rules (fixed before the first session)

1. **A task attempt is "completed"** when the participant produces the
   artefact the task asks for (the provision, the citation block, the
   export, the comparison) — **not** when the observer judges the answer
   correct. Completion and correctness are separate fields.
2. **Every task attempt gets exactly one outcome class** from §6.8. There
   is no "partly right"; the partial cases are separate classes with
   their own names, because a half-chain (found the schedule, never
   reached the diagnosis rule) is a distinct and important observation.
3. **A task that fails for an upstream reason** (eCFR unreachable, an
   upstream timeout) is class `U` and is **excluded from the participant's
   denominator**, with the exclusion reported next to the rate. Silently
   keeping it would inflate a denominator; silently dropping it would hide
   a fact.
4. **Every failure is written up**, with the provision the participant
   landed on, the provision they should have landed on, and one sentence
   of the participant's own account. The failure inventory (§10.3) is
   part of the deliverable, not an appendix to it.
5. **The observer records the error class at the moment of the task**,
   before any aggregation. Aggregation happens once, at the end, over the
   recorded classes. Nothing is reclassified after seeing the totals.

## 6. Protocol

### 6.1 The paired baseline run (first, before any cfr-free work)

Each participant performs **one** task — **F2-A**, the hearing-evaluation
task — twice:

- **Run 1 — their existing workflow.** The participant uses whatever they
  use today (the printed schedule, the eCFR site, a bookmark, a saved
  PDF, an assistant). Timed by the observer from the first keystroke to
  the artefact.
- **Run 2 — cfr-free.** The participant uses the local tool. Same task,
  same wording, same observer, same timing convention.

**Order is counterbalanced** (AB/BA by participant number) so that neither
tool benefits from being first. Run 1 is deliberately _not_ a trial
session: the point is what they actually do today, warts included.

This produces the study's only **within-participant paired comparison** —
and, with n = 5, it is a comparison of five paired observations, not a
statistical test. §8 states it that way.

**The workflow comparison (M6's "compare with each participant's existing
workflow") is captured here and in the debrief (§6.9):**

| Recorded                                            | Notes                                                        |
| --------------------------------------------------- | ------------------------------------------------------------ |
| What they use today, concretely                     | tool name + version if known + where it lives                |
| Whether it is the same step they would use for this | a lookup they love is not the same as a lookup they need     |
| How long the task takes today (their own estimate)  | recorded **separately** from the observed time               |
| How long the task actually took (observed)          | timed by the observer, same convention both runs             |
| What they _trust_ and why                           | e.g. "the PDF because the eCFR changes and I can't tell"     |
| What would make them switch                         | free text, kept verbatim only with consent (§9.5)            |
| Whether they had ever used cfr-free before          | a first-time user and a returning user are different samples |

### 6.2 The tasks — general rules

- **Every task is synthetic and public.** All scenario text is invented for
  this protocol. No task uses a real claim, a real claimant, a real
  document, or any real person's medical information.
- **The claimant in these tasks is a fiction.** No name, no date of
  birth, no service history, no medical record. Where a task needs a
  clinical phrase, it is a **regulatory label** — the words a regulation
  uses — not a description of a real person. The scenario text is printed
  on the observer's sheet and read aloud; the participant is never asked
  to supply case facts of their own.
- **The observer's sheet carries three columns per task**: the question as
  read aloud; what a correct answer looks like; and the **pre-listed
  plausible wrong answers**. The observer reads the question and stops;
  the answer panel is for the observer, never shown to the participant
  before they answer.
- **The participant may use any surface**: the web UI, the CLI, the MCP
  server, or an assistant pointed at the MCP server. The surface used is
  recorded — it is a finding, not a nuisance.

### 6.3 F1 — Citation lookup

**Question (read verbatim).**

> _Here is an extract from a memo someone else drafted. It reads: "The
> rating criteria for psychiatric conditions are at 38 C.F.R. § 4.130.
> Confirm the text and give me the citation block I would paste into the
> memo." Open the provision it cites. Tell me its heading, tell me whether
> the text you have is dated, and give me the citation block you would
> paste._

**What a correct answer looks like.**

- The provision resolves to **§ 4.130 "Schedule of ratings—Mental
  disorders."** — the dotted legal form, the bare form and the `38 CFR`
  form all resolve to the same provision (the citation pin,
  `docs/SPEC.md:237`).
- The answer says the text is dated, and names the date: the index's issue
  date **2026-10-16**.
- The block carries the legal display form `38 C.F.R. § 4.130`, the
  heading, `Source: 38 CFR 4.130 (issue date 2026-10-16)`, and the dated
  verification URL `https://www.ecfr.gov/on/2026-10-16/title-38/section-4.130`
  (`src/titan/ui.ts:629-648`, dated URL at `src/core/service.ts:280-283`).

**Plausible wrong answers (pre-listed).**

| #   | Wrong answer                                                                               | Class it should land in                     |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| a   | Lands on **§ 4.126 "Evaluation of disability from mental disorders."**                     | sibling → §6.8 `S` if defensible, else `E1` |
| b   | Uses the **current** eCFR URL (`/current/title-38/section-4.130`) instead of the dated one | `E5` — right text, unverifiable provenance  |
| c   | Pastes `38 CFR 4.130` with **no issue date and no URL**                                    | `E5`                                        |
| d   | Says the text is "**effective** 2026-10-16"                                                | `E4` — issue date read as an effective date |
| e   | Pastes the **heading only**, with no source line                                           | `E5` (incomplete citation)                  |

### 6.4 F2 — Shorthand-to-criteria search

#### F2-A (core; also the paired baseline task)

**Question (read verbatim).**

> _A colleague's note reads: "Hearing. Find the provision that tells you
> how to evaluate it, and tell me which Roman-numeral tables it uses."_

**What a correct answer looks like.**

- **§ 4.85 "Evaluation of hearing impairment."** — the evaluation rule, not
  the schedule.
- It names **Table VI** ("Numeric Designation of Hearing Impairment Based
  on Puretone Threshold Average and Speech Discrimination") and **Table
  VIa**.
- **A participant who goes on to open the tables discovers that § 4.85
  itself carries the image marker** — the tables are graphics and are
  **not** in the text (§ 4.85 is one of the nine image-marked provisions,
  §6.7). A participant who notices this and says "the tables are not in
  this copy; they must be checked at eCFR" has fully answered the task. A
  participant who names Table VI as though the table were in front of them
  has produced an **unverifiable rating**, and the observer records the
  class accordingly.

**Plausible wrong answers (pre-listed).**

| #   | Wrong answer                                                           | Why it is plausible                                                                                                                                         |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | **§ 4.86 "Exceptional patterns of hearing impairment."**               | The sibling. **Measured:** the frozen set ranks § 4.86 **first** and § 4.85 **second** for "how is hearing loss rated" — this is the canonical sibling case |
| b   | **§ 4.87 "Schedule of ratings—ear."**                                  | The _schedule_ substituted for the _evaluation rule_ — a different object                                                                                   |
| c   | **§ 17.149 "Sensori-neural aids."**                                    | Part 17 prosthetics; "hearing loss" also surfaces it (measured top-5: 4.86, 4.85, 17.149, 3.383, 3.350)                                                     |
| d   | An **eye** provision (e.g. § 4.76a, § 4.77)                            | "designation" and "table" recur across body systems                                                                                                         |
| e   | Names Table VI / VIa **as if the table content were in front of them** | § 4.85 names the tables but does not contain them — the marker is the whole point                                                                           |

#### F2-B (variant; the subject-gap probe)

**Question (read verbatim).**

> _A file says "PTSD". Find the rating provisions and the diagnosis rule
> for it._

**What a correct answer looks like.**

- The rating schedule: **§ 4.130 "Schedule of ratings—Mental disorders."**
- The diagnosis rule: **§ 4.125 "Diagnosis of mental disorders."**
- The traumatic-stress provision: **§ 4.129 "Mental disorders due to
  traumatic stress."**
- All six sections of the Mental Disorders subject group are reachable by
  **browsing** Part 4 → Subpart B → "Mental Disorders"
  (`ECFRfa64377db09ae97`; measured) — so the answer is reachable by
  structure even where it is not reachable by vocabulary.

**Plausible wrong answers (pre-listed).**

| #   | Wrong answer                                                     | Measured behaviour                                                                                                                                                                        |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | **§ 3.304 "Direct service connection; wartime and peacetime."**  | Searching `PTSD` returns § 3.304 first, then § 17.644, § 61.1, § 3.12, § 9.21 — **no rating provision in the top five**                                                                   |
| b   | **§ 3.309 "Disease subject to presumptive service connection."** | The corpus's "PTSD" vocabulary lives here (verified: § 3.309 carries "PTSD", "posttraumatic", "post-traumatic" and "stress disorder"); it is a service-connection rule, not a rating rule |
| c   | **§ 4.130 only** — the schedule, and the chain stops there       | The half-answer. **This is the observation that matters for the deferred subject index**: the participant found the rating schedule and never reached the diagnosis rule                  |

**F2-B is scored on the chain, not on the first hit.** A participant who
reaches § 4.130 and § 4.125 by any route (search, browse, or their own
knowledge) scores `E0` for the task; a participant who reaches § 4.130
alone scores `E3` (incomplete chain, §6.8). The count of `E3` attempts is
the demand evidence for the subject-index decision
(`ROADMAP.md` §M3) — **it is a count, not a score**.

### 6.5 F3 — Cross-reference follow-up

**Question (read verbatim).**

> _You are drafting a memo that quotes § 3.350. Before you send it: what
> does § 3.350 point to, what points back at it, and is there anything in
> its references that is not in your local copy?_

**What a correct answer looks like.**

- **Forward references** (§ 3.350 → § 3.352, § 3.375, § 3.552, and **§ 4.83,
  which is flagged as not available in this local copy**).
- **Backward references** (`citedBy`, 14 sections, measured): § 3.155,
  § 3.352, § 3.401, § 3.552, § 3.810, § 4.115b, § 4.116, § 4.71a, § 4.73,
  § 4.75, § 4.79, § 4.85, § 4.96, § 4.97.
- The participant says § 4.83 **exists in the CFR but is not in this
  index** — the availability flag means "not in this copy", not "does not
  exist".

**Plausible wrong answers (pre-listed).**

| #   | Wrong answer                                                          | Why it is plausible                                                                                        |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| a   | Reports § 4.83 as a **broken link or a bug**                          | The availability flag is easy to miss; "broken" and "not in this copy" mean different things               |
| b   | Answers only the **forward** references                               | The back-reference half (`citedBy`) is the part the "follow references" step of the M5 workflow depends on |
| c   | Substitutes **§ 3.351** for § 3.350                                   | The sibling named in `ROADMAP.md` §M3                                                                      |
| d   | Reports a **count** ("four references") without checking availability | The count is right and the availability is the finding                                                     |

### 6.6 F4 — Historical comparison (requires network)

**Question (read verbatim).**

> _You need to know whether § 3.17 changed between 2026-01-01 and
> 2026-10-16, and exactly how. Use the tool's change view. Give me the
> citation, the two dates, and the changed lines. Then tell me what the
> tool does and does not claim about which revision it served._

**What a correct answer looks like.** Two parts, and the second is the
real content of the task:

1. The **line-level redline** for § 3.17 between the two dates reports
   **`unchanged`, with zero hunks** — the body text is byte-identical.
2. The participant notices that the **provision-level diff over the same
   two dates lists § 3.17 as `changed`**, and works out why: the
   provision was **retitled**. The heading went from _"Disability and
   death pension; Mexican border period and later war periods."_ to
   _"Disability and survivors pension; Mexican border period and later war
   periods."_ (measured 2026-10-21 against eCFR, both dates).

> **Why this task is worth running.** The two shipped surfaces genuinely
> disagree, and they disagree for a reason a practitioner can understand
> but would not guess: the provision-level diff hashes **text and
> heading** (`src/core/diff.ts:70-73`, `src/core/changes.ts:57-63`) while
> the line-level redline compares **body text only**
> (`src/core/redline.ts:255`). Both were run end to end through the
> shipped code path on 2026-10-21 to confirm this task is real and not a
> guess.

3. The participant also states the tool's own honest limit: the dates are
   **selectors** — eCFR serves the revision in force on the requested date
   and does not report which issue date it served
   (`docs/SPEC.md:241`, `src/core/historical.ts:18-19`,
   `src/core/historical.ts:47`).

**Plausible wrong answers (pre-listed).**

| #   | Wrong answer                                          | Class                                                                                                                             |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| a   | Reports "**no change**" and stops                     | `E1` — the redline's answer, and it is incomplete                                                                                 |
| b   | Reports "**changed**" without saying **what** changed | `E1` — the diff's answer, and it is equally incomplete                                                                            |
| c   | Uses **today's text** as the 2026-01-01 text          | `E4` — the exact failure M2's dated-provenance work exists to prevent (`ROADMAP.md` §M2)                                          |
| d   | Reads a **coarse** diff as a line-by-line one         | `E1` — the coarse flag exists precisely so this cannot happen silently (`src/core/redline.ts:270-279`, `src/titan/ui.ts:479-481`) |
| e   | Claims the tool reports the **served revision date**  | `E4` — it does not, and the tool says so                                                                                          |

**Spare provision:** § 3.314 "Basic pension determinations" changes in body
text over the same window (27 hunks, measured) — a plain-text-change task
if the operator prefers F4 to have no subtlety.

### 6.7 F5 — Export / copy verification

#### F5-A (core)

**Question (read verbatim).**

> _Two things before I file this. One: give me the paste-ready citation
> for § 4.130. Two: export the local index so I can archive it. Then
> verify for me — does what you exported actually contain the text you
> quoted?_

**What a correct answer looks like.**

- The citation block: display form `38 C.F.R. § 4.130`, the heading,
  `Source: 38 CFR 4.130 (issue date 2026-10-16)`, and the dated
  verification URL (`src/titan/ui.ts:629-648`).
- An export (`cfr-free export <path>`, or `jsonl` / `md` —
  `src/commands/export.ts:98-137`).
- **The participant opens the exported file and confirms the provision's
  text is in it.** This third part is the task: an export that was never
  read back is not a verified export.

**Plausible wrong answers (pre-listed).**

| #   | Wrong answer                                                                                  | Class                                                                            |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| a   | "The export worked" — **never reads the exported file back**                                  | `E1` (unverified completion — the count is reported, the content is not checked) |
| b   | Pastes a citation with **no issue date and no dated URL**                                     | `E5`                                                                             |
| c   | Runs the export into a path that **already exists** and reports the refusal as a tool failure | `E1` — the refusal is deliberate (`src/commands/export.ts:110-115`)              |
| d   | Uses the **current** URL instead of the dated one                                             | `E5`                                                                             |

#### F5-B (variant; the incompleteness warning)

**Question (read verbatim).**

> _Give me the paste-ready citation for § 4.71a and tell me whether what
> you pasted contains the whole rating table._

**What a correct answer looks like.** The block for **§ 4.71a "Schedule of
ratings—musculoskeletal system"** carries the explicit note that the
provision contains graphic content (rating tables) that is **not included**
in this text, and the participant says the table must be checked at eCFR
(`src/titan/ui.ts:643-647`).

> **Measured: 9 provisions in the 2026-10-16 corpus carry the image
> marker** — § 1.9 "Description, use, and display of VA seal and flag",
> § 4.71 "Measurement of ankylosis and joint motion", § 4.71a "Schedule of
> ratings—musculoskeletal system", § 4.76a "Computation of average
> concentric contraction of visual fields", § 4.77 "Visual fields", § 4.85
> "Evaluation of hearing impairment", § 17.610 "Failure to comply with
> terms and conditions of participation", § 59.50 "Priority list", and
> Appendix B to Part 45 "Disclosure Form to Report Lobbying". Note that
> **§ 4.85 is one of them** — the hearing tables are graphics too.

**Plausible wrong answers (pre-listed).**

| #   | Wrong answer                                                                    | Class                                                             |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| a   | Pastes the citation and says the table **is** included                          | `E1` — the paste implies coverage it does not have                |
| b   | Notices the marker in the raw text but pastes the block **without** the warning | `E5`                                                              |
| c   | Replaces the missing table with a **typed-out** version                         | `E1` — the product never transcribes graphics (`README.md:19-23`) |

### 6.8 The outcome classes (the observer's sheet)

Exactly one class per task attempt. The classes are named so the two
things the ROADMAP cares about — **wrong provision** and **wrong version** —
cannot be blurred together.

| Class | Name                               | Meaning                                                                                                                                                                                                                                                |
| ----- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `E0`  | Correct                            | The expected provision, and the answer addresses the question asked.                                                                                                                                                                                   |
| `E1`  | Wrong provision (not defensible)   | A provision that is neither the expected one nor a defensible sibling — e.g. § 3.304 for a rating question, § 61.1 "Definitions".                                                                                                                      |
| `E2`  | Wrong provision (wrong **object**) | The right subject area, the wrong object: the definition instead of the schedule (§ 3.384 for § 4.130), the schedule instead of the evaluation rule (§ 4.87 for § 4.85), the service-connection rule instead of the rating rule (§ 3.309 for § 4.130). |
| `S`   | Defensible sibling                 | A different provision that a competent practitioner could reasonably have cited in answer to the question as written. **Not a tool failure. Not counted as correct.** Reported on its own line, with the justification.                                |
| `E3`  | Incomplete chain                   | A correct first step and a missing second step (F2-B: the schedule, never the diagnosis rule). Each `E3` entry also carries a recorded sub-reason — vocabulary mismatch or concept not indexed (§8, SC-7).                                             |
| `E4`  | Wrong version / wrong date         | The text quoted is not the version the task asked for, or a date is misread (issue date read as effective date; today's text used as the dated text).                                                                                                  |
| `E5`  | Unverifiable citation              | The citation as given cannot be checked: no issue date, no dated URL, the current URL used where the dated one was required, or a completeness warning dropped.                                                                                        |
| `U`   | Upstream unavailable               | eCFR unreachable or slow; the task could not be run. **Excluded from the participant's denominator and reported as an exclusion.**                                                                                                                     |
| `X`   | Abandoned                          | The participant chose not to continue the task.                                                                                                                                                                                                        |

**The sibling rule (`S`) is the one that decides this study, so it is
written down before the first session and applied by the observer at the
moment of the task:**

> A retrieval is a **defensible sibling** when **all three** hold:
>
> 1. it is a different provision from the expected one;
> 2. it is in the same subject area — the same CFR part, or the same
>    subject group within a part, or a provision the expected one itself
>    cross-references;
> 3. it states a rule a practitioner could reasonably have cited in answer
>    to **the task's question as written**, judged against that task's
>    "correct answer" and pre-listed wrong answers.
>
> The observer records the specific provision and writes **one sentence**
> of justification. If the observer cannot write that sentence, the class
> is `E1` or `E2`, not `S`.

Two consequences, both deliberate:

- **`S` is not "correct".** It is reported as its own rate: _"N attempts
  ended on a defensible sibling"_. The ROADMAP's "about ten of the
  thirteen" claim (`ROADMAP.md` §M3) is exactly this rate on the
  authored query set; this study measures the same rate on human
  attempts.
- **A sibling can be a failure of the _question_, not of the tool.** If a
  participant consistently lands on a sibling because the task's wording
  invites it, that is a finding about the tool's retrieval _and_ about
  the design of any future subject index. Both readings are recorded.

### 6.9 Debrief (after the tasks)

Five questions, asked the same way for every participant:

1. Which step was hardest, and what made it hard?
2. Which output would you actually paste into a memo — and which would
   you not trust?
3. **What would have to change for you to use this instead of what you
   use today?** (This is the SC-6 evidence: the workflow-change question.)
4. What did you have to install, and what nearly stopped you?
5. **Would you come back for another session?** (This is the return
   measure; §7.6.)

## 7. Recorded measures

Every measure below is recorded **per task attempt** or **per participant**,
with its denominator attached. Nothing is recorded as an impression.

### 7.1 Task completion

- `completed` (boolean): the artefact the task asked for was produced.
- `outcome_class`: one of `E0 E1 E2 S E3 E4 E5 U X` (§6.8).
- `provisions_visited`: the citations the participant actually opened,
  in order.
- `final_provision`: the provision the participant's answer rests on.
- `expected_rank_in_results`: if the expected provision appeared in the
  participant's result list, its 1-based rank (this is what separates
  "the tool ranked it third" from "the tool never showed it").
- `route`: the surface used (`ui` / `cli` / `mcp` / `assistant-over-mcp` /
  `mixed`) and the sequence of surfaces if mixed.

### 7.2 Wrong-provision errors

- `wrong_provision_count`: the number of `E1` + `E2` outcomes — a wrong
  provision that is not defensible.
- `wrong_provision_rate`: `E1 + E2` over the completed attempts.
- `sibling_count` / `sibling_rate`: `S` over completed attempts, with the
  sibling cited for every instance. **Reported separately, because the
  sibling rate is the number that tells us whether the ranking gap is a
  practitioner-visible failure** (§1, item 3).
- `incomplete_chain_rate`: `E3` over completed attempts (the subject-index
  demand signal).
- `class_legend`: the mapping the ROADMAP's phrase is read through, stated
  once so the criterion is auditable: **"a citation error" = `E1` + `E2`
  (the wrong provision); "a version error" = `E4` (the wrong text or the
  wrong date); `E5` (the provision is right but the citation as written
  cannot be checked) and `E3` (a right first step and a missing second
  step) are reported but are **not** inside SC-1** — they are a
  completeness question, not a wrong-answer question.** The operator may
  change this mapping in the §8 "revise" cell before recruitment; the
  mapping used is recorded in the cohort header (§10.1).

### 7.3 Wrong-version errors

- `wrong_version_count`: `E4` outcomes.
- `wrong_version_rate`: `E4` over completed attempts.
- `citation_verifiability`: for every citation the participant produced,
  whether it carries (a) the provision, (b) an issue date or other source
  date, (c) a URL, and (d) — where the text carries an image marker — the
  incompleteness warning. **A citation missing (b) or (c) is counted in
  the unverifiable-citation count even when the provision was right.**

### 7.4 Time

- `task_seconds`: seconds from the participant's first action to the
  completion of the artefact, by the observer's stopwatch, **identical
  convention in the paired run**.
- `paired_seconds_existing` / `paired_seconds_cfr_free`: the two halves of
  the §6.1 pair.
- `seconds_to_first_successful_query`: from **session start, installation
  included**, to the first query that returns the expected provision — the
  same elapsed clock as `install_minutes_total` (§7.5), in seconds.
  (Distinct from "time to first output" — this one measures whether the
  tool is _usable_, not merely running.)

### 7.5 Installation obstacles

Recorded per participant, as a **list**, not a score:

- `obstacles`: each obstacle as (what happened verbatim, what the
  participant did about it, minutes lost, resolved yes/no).
- `install_minutes_total`: from "start" to the first successful query.
- `network_required`: whether the participant's machine could reach
  `ecfr.gov` — because two of the five families need it, and a machine
  that cannot is a cohort-selection fact, not a participant failure.

### 7.6 Return for another session

- `requested_another_session`: yes/no, asked at the debrief.
- `invited_to_return`: yes/no — whether the participant was invited to come
  back for a second session at all. At N = 5 the return count only means
  something next to the number invited: zero returns against zero
  invitations is a different fact from zero returns against five
  invitations.
- `returned_within_30_days`: did the participant come back for a second
  session within 30 days of the session, or by their next real task,
  whichever came first? (Recorded by the operator; this is the only measure
  that is not observed inside the session, and it is the one the ROADMAP's
  continue signal names.)
- `second_session_scope`: if they returned, what they did.

### 7.7 The workflow comparison

Per participant, per §6.1 and §6.9: today's tool, today's time (observed
and self-reported), what they trust and why, and what would have to change.
This is the **SC-2 and SC-6 evidence** — descriptive and supporting
respectively (§8) — read together with SC-4's return behaviour, and it is
the reason the study exists for M7 and M8.

## 8. Proposed success criteria — the operator agrees these BEFORE recruitment

**None of this is decided.** The ROADMAP's acceptance condition is explicit:
_"before recruitment, operator agrees success criteria"_ (`ROADMAP.md` §M6).
The table below is the proposal; the operator ticks **accept / revise /
reject** per row **before** any participant is contacted, and the signed
version is what the results are judged against. Changing a criterion after
seeing results invalidates the pilot, and the change must then be recorded
as a decision-log row.

**Reviewed 2026-10-21.** The operator's decision committee reviewed the
seven criteria below and the §11.2 decision mapping; the criteria
incorporate its revisions. **Operator acceptance of the criteria remains the
precondition before recruitment** — the committee's review is not
acceptance, and the **accept / revise / reject** cells are still the
operator's to tick.

| #        | Proposed criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence that settles it                                                                          | Operator decision          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------- |
| **SC-1** | **≥ 3 of N participants complete ≥ 4 of the 5 core tasks with no `E1`/`E2`/`E4` outcome, and request another session.** This is the ROADMAP's suggested continue signal (`ROADMAP.md` §M6). "Citation error" is read as `E1` + `E2` and "version error" as `E4` (§7.2). **The two components are reported separately with their denominators — "core tasks completed clean: x/N" and "requested another session: y/N" — because the conjunction otherwise hides which half failed.** **It is an initial decision threshold, not statistical proof and not a revenue forecast.**                                                                                                                                                                                                                                | The per-participant core-task table (§10.2) and the return measure (§7.6).                        | ☐ accept ☐ revise ☐ reject |
| **SC-2** | **Descriptive, not a gate.** The paired timing — median seconds, existing tool vs cfr-free (§7.4) — and each participant's "usable without a second lookup" yes/no are **reported descriptively**. A timing difference counts only if it clears the larger of **2 minutes** and **25 % of the existing-tool time** — the saving must be **at least** that bar, not merely above one of the two; a smaller saving, and a saving exactly equal to the bar, is scored a **tie**. Worked example: existing tool 600 s, cfr-free 480 s is a 120 s (20 %) saving — the bar is the larger of 120 s and 150 s, i.e. 150 s, so that run is a **tie**, not "faster". This evidence supports SC-4 and SC-6 and is **not** a CONTINUE trigger: stated preference plus unblinded timing at n = 5 will not carry a decision. | The paired run (§6.1), the time measures (§7.4), the debrief question 2 (§6.9).                   | ☐ accept ☐ revise ☐ reject |
| **SC-3** | **≥ 4 of N participants reach their first successful query within 30 minutes of starting**, and **every** installation obstacle is listed, with minutes lost, not averaged away. The clock is **elapsed time from session start, installation included**, to the first successful query (§7.4, §7.5). `U`-class (network/environment) exclusions are reported next to the rate they affect, never silently dropped.                                                                                                                                                                                                                                                                                                                                                                                            | `seconds_to_first_successful_query` (§7.4), the obstacle list and `install_minutes_total` (§7.5). | ☐ accept ☐ revise ☐ reject |
| **SC-4** | **≥ 3 of N participants return for a second session within 30 days** — or by their next real task, whichever comes first — **of their own initiative.** The operator records **"invited to return: y/N"** per participant, so that the return count is interpretable at n = 5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `returned_within_30_days` (§7.6).                                                                 | ☐ accept ☐ revise ☐ reject |
| **SC-5** | **Zero `E4` (wrong-version) outcomes in families F1, F4 and F5.** Dated, verifiable text is the product's core promise; one wrong-version citation is a trust failure, not a learning curve. The **all-families** `E4` rate is reported alongside for visibility; only F1, F4 and F5 count for the pass/fail, per the `class_legend` mapping (§7.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                           | The per-task outcome table (§10.2), the `E4` column.                                              | ☐ accept ☐ revise ☐ reject |
| **SC-6** | **Supporting evidence — not a pass/fail criterion, and not a CONTINUE trigger.** Debrief question 3 is recorded **verbatim** (where consent was given, §9.5), with a count of distinct demand themes. Stated preference is weak evidence (§13). M7 and M8 are decided from SC-4 behaviour together with these themes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Debrief question 3, verbatim (§6.9).                                                              | ☐ accept ☐ revise ☐ reject |
| **SC-7** | **Not a pass/fail criterion — a recorded count, over a stated denominator.** The denominator is the **N** F2-B attempts: a **count, not a rate**, with `U` exclusions reported. Each `E3` entry is attributed to one of two recorded sub-reasons: **(a) vocabulary mismatch** — the provision exists, but the participant's own words do not reach it; **(b) concept not indexed** — no section covers the concept at all. A **second observer re-classifies a sample** of the `E3` entries before the count is used as demand evidence. The count informs the subject-index brief; it does not decide it (`ROADMAP.md` §M3).                                                                                                                                                                                  | The `E3` count and the F2-B failure entries (§10.3).                                              | ☐ accept ☐ revise ☐ reject |

**What happens if the operator rejects SC-1?** The protocol still runs and
the rest of the table still applies; SC-1 is replaced by whatever
threshold the operator writes in the "revise" cell, and the substitution
is recorded in the decision log (§11) **before** recruitment.

## 9. Data boundaries, consent, and destruction

### 9.1 What is recorded

Only what §7 lists: task outcomes and classes, provisions visited and
cited, timings, the installation obstacle list, the workflow comparison,
the debrief answers, and the return record. All of it is a **count, a
class, a citation, a duration, or a sentence about the tool's behaviour**.

### 9.2 What is NOT recorded, ever

- **No claimant documents.** No claim file, no medical record, no
  correspondence, no rating decision, no document of any kind belonging to
  a real person.
- **No personal or medical information** about any real person — not a
  name, not a date of birth, not a service history, not a diagnosis, not
  a case number, not a screenshot of a file that contains any of these.
  (`ROADMAP.md` §M6: _"Avoid claimant documents or personal/medical
  information."_)
- **No participant contact details** beyond what the operator already
  holds for scheduling, and no copy of those details in the study notes.
- **No audio, no screen recording.** The observer writes notes.
- **No free text that is not about the tool's behaviour.** If a participant
  volunteers a fact about a real person, the observer stops, does not
  write it down, and records the incident (see §9.3).

### 9.3 The substitution rule

The tasks are synthetic, so the participant has nothing real to supply. If
a participant volunteers a real case anyway, the observer:

1. says plainly that the study does not need it;
2. **does not write it down**;
3. records only that a substitution was offered and declined.

### 9.4 Where the notes live

- **A local, operator-controlled directory outside the repository** —
  proposed `~/cfr-free-pilot/`, one directory per participant, one
  spreadsheet per cohort. Nothing is written into this repository except
  the anonymised aggregate, and only after the cohort's decision is
  recorded.
- **The operator holds the keys.** The notes are not shared, not
  uploaded, not committed, and not attached to issues or PRs.
- `ROADMAP.md` §M6 requires _"notes local/operator-controlled"_; this is
  how that is honoured.

### 9.5 Consent, and who arranges it

**Consent and recruitment are the operator's to arrange and to authorize.
This document does not contain an outreach plan, a message template, a
target list, or a contact script — deliberately, and because M6 is
explicit that _"external participation needs operator
arrangement/authorization"_ (`ROADMAP.md` §M6) and that _"recruiting,
messages, and live sessions remain operator-arranged or explicitly
authorized"_ (`ROADMAP.md`, delivery-order note).**

What the protocol supplies instead is the **content** a consent conversation
needs, so that the operator can write the invitation in their own voice:

- what the participant will be asked to do (7 synthetic tasks, on a
  synthetic scenario, using a tool on their own machine);
- that **no real claim, document, or personal information is needed, or
  wanted** (§9.2);
- that the session is **observed and timed**, and that notes are taken;
- that **the notes are local and operator-controlled**, are destroyed on
  the schedule in §9.6, and are not published;
- that the participant may **stop at any point** and have their notes for
  that point destroyed on request;
- that a participant may consent to a **specific verbatim quote** being
  kept (and that only that quote is kept, marked as verbatim);
- that **there is no follow-up contact initiated by the tool** — see
  §9.7.

### 9.6 Destruction

- **Raw per-participant sheets** (task tables, obstacle lists, free-text
  notes, debrief transcripts) are destroyed **30 days after the cohort
  decision is recorded in the decision log** — a proposal; the operator
  sets the actual window.
- **What survives:** the anonymised aggregate — the counts, the rates, the
  median and per-participant times, the outcome-class tallies, the
  sibling list, and the failure inventory, with every citation to a
  regulation and every observation about the tool's behaviour.
- **What does not survive:** anything that identifies a participant, and
  any free text not covered by a specific quote consent.
- Destruction is recorded: what was destroyed, when, and by whom.

### 9.7 No telemetry and no automatic outreach

Both are required by `ROADMAP.md` §M6 and both are properties of the
product as it stands, verified rather than asserted:

- **No telemetry ships for this study, and none exists.** The tool is a
  local process over a local SQLite file (`src/config.ts:96`,
  `src/cli.ts:34-41`); the HTTP API binds `127.0.0.1` and serves the
  corpus only (`docs/SPEC.md:231-244`). **Measured 2026-10-21:** the only
  outbound hosts anywhere in `src/` are `127.0.0.1`, `localhost` and
  `www.ecfr.gov`, and a search of `src/` for `telemetry`, `analytics`,
  `sentry`, `mixpanel`, `posthog`, `segment.io`, `google-analytics` or a
  `track(` call returns **nothing**. There is no analytics client, no
  error reporter, no user registry, and no phone-home. **The study adds no
  code and no instrumentation** — the observer's notes are the entire data
  path (§9.4).
- **There is no automatic outreach, from the product or from the study.**
  The tool has no mailing capability, no user list, and no notification
  path; the only network calls it ever makes are to `ecfr.gov`
  (`src/core/ecfr.ts:46-81`). The study's follow-up (§7.6, the return
  measure) is a **note the operator keeps** and an invitation the operator
  sends, if and when they choose to — **not** an automatic mechanism, and
  not something the participant's copy of the tool does.

## 10. Results template

### 10.1 Cohort header

```
Cohort:            ______________________
Participants:       N = ______   (attempted: ____  completed: ____  abandoned: ____)
Corpus issue date: 2026-10-16  (2 970 provisions)
Index build:       local, per participant   |   index issue date at session: __________
Success criteria:  as agreed on __________  (see §8; any revision after this date invalidates the pilot)
Observers:         ______________________
```

### 10.2 Per-participant task table — the primary record

One row per task attempt. `class` is one of `E0 E1 E2 S E3 E4 E5 U X`.
`exp_rank` is the 1-based rank of the expected provision in the
participant's own result list, or `—`.

```
P#  | task | surface | completed | class | final provision | exp_rank | seconds | notes (tool behaviour only)
----+------+---------+-----------+-------+-----------------+----------+---------+---------------------------
 1  | F1-A |         |           |       |                 |          |         |
 1  | F2-A |         |           |       |                 |          |         |
 1  | F2-B |         |           |       |                 |          |         |
 1  | F3-A |         |           |       |                 |          |         |
 1  | F4-A |         |           |       |                 |          |         |
 1  | F5-A |         |           |       |                 |          |         |
 1  | F5-B |         |           |       |                 |          |         |
 ...
```

**Per-participant roll-up** (every cell carries its denominator):

```
P# | core tasks completed clean (of 5) | E1+E2 rate (n/N) | sibling rate (n/N) | E4 rate (n/N) | E5 rate (n/N) | E3 count | total minutes | requests another session
```

**Cohort roll-up** — every rate written with its real N:

```
metric                                    | value   | denominator     | exclusions (U) | notes
------------------------------------------+---------+-----------------+----------------+-------
core tasks completed clean ≥4 of 5 (P#)   |    /    |        N        |                |
requested another session (P#)            |    /    |        N        |                |
SC-1 participants                         |    /    |        N        |                |
paired run: faster (clears the larger of 2 min / 25 %) |    /    |    paired N     |                |
paired run: tied (does not clear that bar)   |    /    |    paired N     |                |
paired run: median seconds, existing      |    s    |        N        |                |
paired run: median seconds, cfr-free      |    s    |        N        |                |
E1+E2 rate (all families)                 |    /    |        N        |                |
sibling rate (S)                          |    /    |        N        |                |
E4 rate (all families)                    |    /    |        N        |                |
E4 count in F1/F4/F5 (SC-5)               |    #    |  3N (F1/F4/F5)  |                |
E5 rate                                   |    /    |        N        |                |
E3 count (subject-gap probe, total)       |    /    |    N (F2-B)     |                |
E3 count — (a) vocabulary mismatch        |    /    |    N (F2-B)     |                |
E3 count — (b) concept not indexed        |    /    |    N (F2-B)     |                |
first successful query ≤30 min (SC-3)    |    /    |     N (minus U) |                |
install_minutes_total: median / max       |    /    |        N        |                |
obstacles logged (count)                  |         |        N        |                |
invited to return (P#)                    |    /    |        N        |                |
returned within 30 days                   |    /    |        N        |                |
named a workflow change                   |    /    |        N        |                |
distinct demand themes (SC-6)             |    #    |        —        |                |
```

### 10.3 Failure inventory — mandatory, not an appendix

Every non-`E0` outcome gets a row. **This is the part that makes the
study worth more than the headline rate.**

```
# | P# | task | class | E3 sub-reason | provision the participant landed on | provision expected | what the participant said | observed tool behaviour
```

The last column records what the **tool** did, separately from what the
participant did. A row with a defect in that column is a candidate for a
future packet; a row without one is a learning-curve observation. The two
are never merged.

The **E3 sub-reason** column records, for every `E3` row, why the chain
broke: **(a) vocabulary mismatch** — the provision exists, but the
participant's own words did not reach it — or **(b) concept not indexed** —
no section covers the concept at all (§8, SC-7). It is blank for every
other class. **Before the count is used as demand evidence, a second
observer re-classifies a sample of the `E3` entries**; the disagreements
are resolved in writing and counted (§13).

### 10.4 The paired-run table

```
P# | order (AB/BA) | existing tool named | seconds (existing) | seconds (cfr-free) | outcome class (existing) | outcome class (cfr-free) | "usable without a second lookup?" | what they trust and why
```

### 10.5 The installation obstacle log

```
P# | # | what happened (verbatim) | what the participant did | minutes lost | resolved? | would it have blocked the session?
```

### 10.6 The debrief

```
P# | Q1 hardest step | Q2 would paste / would not trust | Q3 what would have to change | Q4 install friction | Q5 would you come back
```

## 11. Decision log

### 11.1 The log

Every decision the study informs gets a row. **The evidence column points
at a specific table in §10, not at a summary sentence.**

```
date | item | options considered | decision | evidence (table + row) | decided by
```

**Pre-seeded rows** — the decisions this study exists to inform, each with
its current state, so the log starts populated rather than empty:

| Item                                                            | Current state                                                                                                                                         | This study settles                                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **M7 — integrations**                                           | Gated on M6 evidence (`ROADMAP.md` §M7)                                                                                                               | Whether a destination is demonstrated; feeds `docs/research/integration-decision.md` |
| **M8 — corpus/platform expansion**                              | Gated on M6 evidence + operator scope approval (`ROADMAP.md` §M8)                                                                                     | Whether expansion has a demonstrated need, not a speculative one                     |
| **The subject index** (curated benefit/topic → sections map)    | **DEFERRED** pending this study (`ROADMAP.md` §M3)                                                                                                    | The `E3` count (SC-7): do practitioners actually need subject-level reach?           |
| **The ranking investment** (top-1 accuracy)                     | Partly built: the exception case shipped in PR #105, leaving 8 in-window-but-not-first cases whose siblings the committee REJECTED (`ROADMAP.md` §M3) | The sibling rate from §10.2: does the top-1 gap reach the practitioner as a failure? |
| **The M5 workflow** (find → read → follow → change view → copy) | 4 of 4 slices shipped (`ROADMAP.md` §M5)                                                                                                              | Whether the five steps are usable end to end by someone who did not build them       |
| **The M6 study itself**                                         | Design proposed in this document                                                                                                                      | Continue / change / stop, below                                                      |

### 11.2 The continue / change / stop decision

**The decision is made after the pilot, with the evidence attached.** The
thresholds below are proposals for the operator to accept, revise or reject
alongside §8.

| Outcome      | Proposed trigger                                                                                                                                                                                                                                                                                        | Then                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CONTINUE** | All three: 1. SC-1 met (≥ 3 of N clean on ≥ 4 of 5 core tasks **and** requesting another session).<br>2. SC-5 met (zero `E4` outcomes in F1/F4/F5).<br>3. SC-4 met (≥ 3 of N returned within 30 days).                                                                                                  | Open the M7 integration decision brief (`ROADMAP.md` §M7) **and** write the subject-index brief if the SC-7 count justifies it. SC-2's timing and SC-6's demand themes are read alongside the decision as supporting evidence, not as triggers. The subject index stays deferred until that brief exists.                                                                  |
| **CHANGE**   | Any one of: (i) SC-1 met but SC-3 or SC-5 missed; (ii) SC-1 not met **and** ≥ 2 of N requested another session — demand exists while completion is low, so change the tool or the workflow and investigate why completion failed; (iii) the sibling rate is high while the wrong-provision rate is low. | Change the tool or the workflow, not the threshold. Which change is implied is named by the failing criterion: an SC-5 failure is a dated-provenance defect; a high sibling rate is a ranking or a subject-index question; an SC-3 failure is an installation/onboarding question; and case (ii) is a completion failure to investigate, with the demand already recorded. |
| **STOP**     | SC-1 not met, **and** fewer than 2 of N requested another session.                                                                                                                                                                                                                                      | Record the stop with the evidence, close M6, and record M7/M8 as not-evidenced rather than as deferred-pending-evidence. The subject index is closed as well: its only justification was this study.                                                                                                                                                                       |

**Any outcome that matches neither CONTINUE nor STOP defaults to CHANGE.**

**When more than one row matches, CONTINUE takes precedence over CHANGE.** The one
real overlap is a cohort with SC-1, SC-4 and SC-5 all met while SC-3 is missed: the
participants returned, which is the strongest signal in this protocol, so the
decision is CONTINUE and the installation defect is carried into the M7 brief as a
named follow-up rather than used to reverse the decision.

**This is an initial decision rule applied to five people, not statistical
proof of a population effect.**

**Two rules that go with the decision:**

1. **A STOP is a result, not a failure of the pilot.** It is written down
   with the same care as a CONTINUE, with the same denominators.
2. **The decision never overwrites the evidence.** The §10 tables stay as
   they were on the decision date. If the operator later re-reads them
   with different expectations, that re-reading is a new decision-log
   row, not an edit to the old one.

## 12. Constraints, honest limits, and what is deliberately excluded

**Constraints the operator must plan around (all measured, not guessed):**

- **The tool must be installed locally.** Node.js ≥ 22.5 (`README.md:42-48`),
  a source checkout, `npm ci`, `npm run build`, then `cfr-free sync`
  (~2-3 MB from eCFR, ~5 s — `README.md:50-81`, `docs/SPEC.md:369`). It
  is **not on npm**: the registry returns 404 for `cfr-free` (checked
  2026-10-20, `README.md:83-86`).
- **There is no hosted service and no account.** The study measures the
  local tool on the participant's own machine; nothing is signed into and
  nothing is hosted.
- **Two of the five families need the network** at task time (F4 needs
  eCFR for the dated comparison; `sync` needs it for the index). A
  participant on a restricted network cannot run F4 — that is recorded as
  a cohort fact (§7.5), and an `U` outcome, not a participant error.
- **Recruitment and consent are the operator's.** Nothing in this document
  contacts anyone (§9.5).

**Limits of what this design can settle, stated so the decision log does
not over-read the results:**

- **n = 5.** Every rate in §10 is a count over five people. It supports a
  _decision_; it does not support a claim about a population.
- **The paired comparison is within-participant and un-blinded.** The
  participant knows which tool they are using. It is a real-work
  comparison, not a laboratory one.
- **The observer is not blind.** The observer knows the correct answer and
  the pre-listed wrong answers. The sibling rule in §6.8 is written down
  in advance precisely to limit that, but it cannot remove it. Mitigation
  if the operator wants it: a second observer independently classes a
  sample of attempts from the written notes alone, with the classes
  compared before the aggregate is computed.
- **The tasks are authored by the person who knows the tool.** They may be
  kinder to the tool than real work is. The paired baseline run is the
  partial countermeasure: the participant's own workflow is the comparison,
  not the task designer's idea of it.
- **F4 measures a real behavioural difference between two shipped
  surfaces** (§6.6). If the operator considers that a defect rather than a
  task, the finding is still valid and belongs in the decision log; this
  protocol does not decide which it is.

**Deliberately excluded from this deliverable** (each with the reason):

| Excluded                                                           | Why                                                                                                                                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An outreach plan, message template, target list, or contact script | Recruitment and consent are operator-arranged and operator-authorized (`ROADMAP.md`, delivery-order note; §M5). §9.5 supplies the content, not the campaign.                     |
| Any change to the product, code, fixtures, or tests                | The study observes; it does not instrument. No telemetry ships (§9.7).                                                                                                           |
| Any change to `ROADMAP.md`                                         | The roadmap is updated by the operator after the review, not by this packet.                                                                                                     |
| A sample size calculation, power analysis, or significance test    | n = 5 is a decision threshold, not a statistical claim (`ROADMAP.md` §M6). §8 labels it so.                                                                                      |
| A new evaluation set or a threshold proposal                       | The holdout is **burned** and is a regression set only; a **fresh** holdout is built before the first threshold-bearing round (`ROADMAP.md` §M3). This protocol touches neither. |
| A claim that the results generalise                                | Out of scope, and the ROADMAP forbids the claim outright (`ROADMAP.md`, "Evidence required to mark a roadmap item delivered").                                                   |
| Prices, revenue, customer commitments, or a market-size estimate   | Forbidden by M7's own terms (`ROADMAP.md` §M7) and out of scope for M6.                                                                                                          |

## 13. Known limitations of this design, and the concrete alternatives

Three places where the design is weaker than it could be. Each is stated
with the alternative, so the operator can choose rather than inherit.

1. **The observer classifies errors, and the observer is not blind.** The
   sibling rule (§6.8) is the mitigation, but it is a mitigation, not a
   fix. **Alternative:** a second observer re-classifies a sample of
   attempts from the written notes alone, before any aggregate is
   computed; disagreements are resolved in writing and counted. Cost:
   one observer-half-day. This protocol recommends the operator add it if
   the sibling rate is the number the decision will rest on — which, given
   §1, item 3, it probably is.
2. **"Would you change your workflow?" is a stated preference, and stated
   preferences are weak evidence.** SC-2's timing difference is reported
   descriptively alongside it (§8), which sharpens the reading but does not
   make either of them a gate; the strongest available signal is SC-4 —
   whether they came back. **Alternative:** make the second session the
   primary measure; SC-6 is already recorded as supporting rather than
   decision-bearing (§8).
3. **The tasks are authored by someone who knows the tool's strengths and
   weaknesses.** The synthetic scenarios were built around the corpus's
   actual vocabulary gaps (which is the point of a synthetic task) and
   therefore probably understate the difficulty of a real,
   messier question. **Alternative:** after the cohort, ask each
   participant to phrase one real question of their own (with the
   claimant facts stripped, and with their consent) and record it as a
   **candidate for the fresh holdout** — the discipline for a fresh
   holdout is set out in `ROADMAP.md` §M3, and this would be a
   candidate pool for it, not a set to tune against.

---

## Appendix A — one-page task sheet (observer copy)

```
F1-A CITATION LOOKUP
  Read: "Here is an extract from a memo someone else drafted. It reads:
  'The rating criteria for psychiatric conditions are at 38 C.F.R. § 4.130.
  Confirm the text and give me the citation block I would paste into the
  memo.' Open the provision it cites. Tell me its heading, tell me whether
  the text you have is dated, and give me the citation block you would
  paste."
  CORRECT: § 4.130 "Schedule of ratings—Mental disorders."; dated 2026-10-16;
    block = display form + heading + "Source: 38 CFR 4.130 (issue date
    2026-10-16)" + https://www.ecfr.gov/on/2026-10-16/title-38/section-4.130
  WRONG: 4.126 (sibling?) | current URL (E5) | no date (E5) | "effective
    2026-10-16" (E4) | heading only (E5)

F2-A SHORTHAND → CRITERIA  (also the paired-baseline task)
  Read: "A colleague's note reads: 'Hearing. Find the provision that tells
  you how to evaluate it, and tell me which Roman-numeral tables it uses.'"
  CORRECT: § 4.85 "Evaluation of hearing impairment."; Table VI and Table VIa
  WRONG: 4.86 (sibling — measured FIRST for this query) | 4.87 (wrong object)
    | 17.149 | an eye section

F2-B SHORTHAND → CRITERIA (variant; subject-gap probe)
  Read: "A file says 'PTSD'. Find the rating provisions and the diagnosis
  rule for it."
  CORRECT: § 4.130 (schedule) + § 4.125 (diagnosis) + § 4.129
  WRONG: 3.304 (measured FIRST for "PTSD") | 3.309 | 4.130 only (E3 — the
    half-chain; this is the subject-index evidence)

F3-A CROSS-REFERENCE FOLLOW-UP
  Read: "You are drafting a memo that quotes § 3.350. Before you send it:
  what does § 3.350 point to, what points back at it, and is there anything
  in its references that is not in your local copy?"
  CORRECT: refs 3.352, 3.375, 3.552, 4.83 (4.83 NOT available locally);
    citedBy = 14 sections (3.155, 3.352, 3.401, 3.552, 3.810, 4.115b, 4.116,
    4.71a, 4.73, 4.75, 4.79, 4.85, 4.96, 4.97)
  WRONG: calls 4.83 a broken link | forward only | substitutes 3.351 |
    counts without checking availability

F4-A HISTORICAL COMPARISON  (network required)
  Read: "You need to know whether § 3.17 changed between 2026-01-01 and
  2026-10-16, and exactly how. Use the tool's change view. Give me the
  citation, the two dates, and the changed lines. Then tell me what the
  tool does and does not claim about which revision it served."
  CORRECT: redline says UNCHANGED (0 hunks, body identical) AND the diff
    says CHANGED — because the HEADING was retitled: "Disability and death
    pension; ..." → "Disability and survivors pension; ..."; plus the tool
    does not claim a served-revision date (dates are selectors)
  WRONG: "no change" and stop (E1) | "changed" without what (E1) | today's
    text as the dated text (E4) | coarse read as line-by-line (E1) | claims
    a served revision date (E4)
  SPARE: § 3.314 (body changed, 27 hunks, measured)

F5-A EXPORT / COPY VERIFICATION
  Read: "Two things before I file this. One: give me the paste-ready
  citation for § 4.130. Two: export the local index so I can archive it.
  Then verify for me — does what you exported actually contain the text
  you quoted?"
  CORRECT: the 4-line block; an export; and the exported file READ BACK and
    confirmed to contain the provision's text
  WRONG: "the export worked" without reading it back (E1) | no date/URL
    (E5) | export into an existing path reported as a tool failure (E1) |
    current URL (E5)

F5-B EXPORT / COPY VERIFICATION (variant; incompleteness warning)
  Read: "Give me the paste-ready citation for § 4.71a and tell me whether
  what you pasted contains the whole rating table."
  CORRECT: the block carries the NOTE that graphic content (rating tables)
    is NOT included, and the participant says to check the table at eCFR
    (9 provisions carry the marker in the 2026-10-16 corpus)
  WRONG: says the table is included (E1) | notices the marker but drops the
    warning (E5) | types the table out (E1)
```

## Appendix B — the source files this protocol cites

ROADMAP references here are **section anchors** (§M2 … §M8) rather than line numbers:
the roadmap is edited every round, so a line number is stale the moment
anything above it changes. The other files are cited by line as of this writing.

| File                                                                                   | What was taken from it                                                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `ROADMAP.md` §M6                                                                       | the M6 section — the authority for every requirement in this document                              |
| `ROADMAP.md` §M3                                                                       | the subject-index deferral, the holdout's status, the top-1 re-scoping                             |
| `ROADMAP.md` §M5                                                                       | the M5 workflow definition and its slice record                                                    |
| `docs/research/retrieval-baseline-2026-10-20.md`                                       | the baseline this protocol re-measured on 2026-10-21                                               |
| `test/fixtures/retrieval/run.ts`                                                       | the runner's metric definitions and aggregation (`:110-113`, `:151-162`)                           |
| `test/fixtures/retrieval/queries.{dev,holdout}.ts`                                     | the frozen 50-query set                                                                            |
| `docs/SPEC.md:185-229`                                                                 | §4.1 — the candidate set and the ranking order                                                     |
| `docs/SPEC.md:231-261`                                                                 | §5 — the HTTP surface; §6 — the MCP tools                                                          |
| `docs/SPEC.md:355`                                                                     | §13 row 4 — the heading-boost promise                                                              |
| `src/core/store.ts:313-348`                                                            | the curated synonym map                                                                            |
| `src/core/references.ts:39-50`                                                         | cross-reference extraction                                                                         |
| `src/core/service.ts:166-198`, `:280-283`                                              | the section read and the dated verification URL                                                    |
| `src/core/diff.ts:57-73`, `src/core/changes.ts:57-63`                                  | the provision-level diff hashes text **and** heading                                               |
| `src/core/redline.ts:217-281`                                                          | the line-level redline compares body text **only**                                                 |
| `src/core/historical.ts:18-19`, `:47`                                                  | the point-in-time archive floor and the "not a served-revision date" limit                         |
| `src/titan/ui.ts:629-649`                                                              | the copy-a-citation block and the incompleteness warning                                           |
| `src/titan/ui.ts:479-481`                                                              | the coarse-diff warning                                                                            |
| `src/commands/export.ts:98-137`                                                        | the export command and its formats and refusal                                                     |
| `src/mcp/tools.ts:225`, `:326`, `:364`, `:415`, `:456`, `:489`, `:525`, `:583`, `:634` | the nine MCP tools                                                                                 |
| `README.md:10-12`, `:19-23`, `:42-48`, `:50-86`                                        | no telemetry, the honest-about-images note, the requirements, the install path, the npm-404 status |
| `src/cli.ts:17-45`                                                                     | the command surface and the environment variables                                                  |

**Provenance of the numbers in this document.** Everything measured was
measured on **2026-10-21** against this repository at `928e63e` (the base
of this branch; the product code is byte-identical to `736b355`, so the
`src/` line references are the same at either) and the 2026-10-16 eCFR
issue date, using the repo's own code: the frozen evaluation runner
against a copy of the live index (the live index at
`~/.cfr-free/index.sqlite` is read-only and was not modified), and the
shipped `redlineSection` / `diffIssues` against eCFR for 2026-01-01 and
2026-10-16.
