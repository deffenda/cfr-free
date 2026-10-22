# M6 protocol rehearsal — 2026-10-21

**What this is.** A rehearsal of the instrument in
[`practitioner-pilot.md`](practitioner-pilot.md), run at repo head `4c6d558`
by an AI agent acting as a **single participant** ("REHEARSAL-1") against a
**copy** of the 2026-10-16 corpus (2,953 sections + 17 appendices = **2,970
provisions**).

**It is not study data.** It produces no participant finding, and it
**triggers nothing** — in particular it does not trigger the subject-index
reopen condition, which is fixed on the **pilot's** `E3` count
(`ROADMAP.md` §M3). This document's readings are labelled as rehearsal
readings wherever they could be mistaken for evidence.

## The limitation, stated plainly

> **I can read the protocol, so I can see the expected provisions. A human
> participant cannot. So this rehearsal cannot tell us whether a real
> practitioner would find the right answer — only whether the answers are
> findable, whether the sheets can be filled, and whether the rules compute.**

Everything below is read against that. A rehearsal that flatters the
protocol is worth nothing, so the defects are the point of this document.

## Headline

**Every task was answerable and the tool found every expected provision.**
The retrieval evidence base reproduces to the digit: re-running the repo's
own frozen runner against a copy of the index gives **dev MRR 0.8448,
holdout MRR 0.8137, exact 35/46, recall@5 43/46** — every published §4
figure. The protocol's shape is sound.

**What would have failed on the day was the measurement machinery**, and the
rehearsal found **five defects that block a session**, six that corrupt a
measure or a decision without blocking one, and nine that confuse a single
attempt. All seventeen are repaired in `practitioner-pilot.md` in the same
commit as this document.

## Environment and integrity

| Item               | Value                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo               | `4c6d558`, working tree clean before and after                                                                                                                         |
| Corpus             | copy of the index, issue date **2026-10-16**, 2,970 provisions                                                                                                         |
| Live index         | **untouched** — byte-identical before and after; copied, never opened for writing, no `-wal`/`-shm`                                                                    |
| Node / OS          | v26.11.1 · darwin 25.6.0 arm64                                                                                                                                         |
| Surfaces exercised | HTTP JSON API, CLI, MCP over stdio; the web UI verified from the served `/ui.js` asset and source, **not by interaction** (no desktop browser attached to the session) |
| Scratch            | `/tmp`; `node_modules` symlinked in for prettier and the tests, removed at the end                                                                                     |

## Per-task results

All seven attempts were class **`E0`**. The rows below are what the sheets
recorded; the tool-behaviour column is where the findings live.

```
P#   | task | surface | class | final provision | exp_rank | seconds | tool behaviour observed
-----+------+---------+-------+-----------------+----------+---------+-----------------------------------------
REH  | F1-A | http    | E0    | 4.130           | 1        | 0.238   | the hit's sourceUrl is the CURRENT url;
     |      |         |       |                 |          |         | sourceUrlAtIndexDate is on the section read only
REH  | F2-A | http    | E0    | 4.85            | 1        | 0.223   | 4.85@1 for two natural phrasings; image
     |      |         |       |                 |          |         | markers present; = the paired run's Run 2
REH  | F2-B | http    | E0    | 4.125+4.129+4.130| 4.130@6; | 0.371   | "PTSD": 9 hits, no rating provision in
     |      |         |       |                 | 4.125 —; |         | top 5; reached by BROWSE, not search;
     |      |         |       |                 | 4.129 —  |         | 4.129 unreachable from "PTSD"
REH  | F3-A | http    | E0    | 3.350           | —        | 0.080   | 4 forward refs, 4.83 available=false;
     |      |         |       |                 |          |         | 14 citedBy; flag reads "not indexed"
REH  | F4-A | cli+http| E0    | 3.17            | —        | 9.230   | redline unchanged/0 hunks, diff says
     |      |         |       |                 |          |         | changed, heading retitled; the
     |      |         |       |                 |          |         | served-revision limit is NOT on this surface
REH  | F5-A | http+cli| E0    | 4.130           | —        | 0.505   | export 2,970 provisions; read-back
     |      |         |       |                 |          |         | byte-identical; refusal exits 2
REH  | F5-B | http+mcp| E0    | 4.71a           | —        | 0.148   | the NOTE is web-UI-only; CLI/MCP/JSON
     |      |         |       |                 |          |         | expose the raw marker only
```

**F2-B was reached by browsing, and only because the rehearsal agent had
read the answer key.** A participant who searches "PTSD" and does not
already know that Chapter I → Part 4 → Subpart B → "Mental Disorders" exists
has no route to § 4.125 or § 4.129. That is the subject-gap finding, and it
is why the `E3` reading below is close to meaningless as demand evidence.

## The fields that could not be filled — the rehearsal's real output

| Field                                                                         | Why unfillable                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §10.1 `Cohort:` / `Observers:`                                                | A rehearsal is not a study, and the observer was the agent doing the tasks.                                                                                            |
| §10.2 `exp_rank` for F2-B                                                     | **Undefined by the template** — F2-B has three expected provisions with three different ranks (measured 4.130@6, 4.125 —, 4.129 —). One cell, three values. → repaired |
| §10.3 `what the participant said`                                             | No participant; the column is a transcript field.                                                                                                                      |
| §10.3 `E3 sub-reason`                                                         | No `E3` arose; and for any `E3` outside F2-B neither value applies. → repaired                                                                                         |
| §10.4 `existing tool named`, `seconds (existing)`, `outcome class (existing)` | The rehearsal has no existing tool.                                                                                                                                    |
| §10.5, §10.6                                                                  | Obstacles and debrief answers require a human reporting their own friction.                                                                                            |
| §7.6 `requested_another_session` … `second_session_scope`                     | Out-of-session and human-only.                                                                                                                                         |
| §9.5 consent fields                                                           | No human, no consent.                                                                                                                                                  |
| SC-1's "and request another session"; SC-4                                    | Not measurable → **not evaluable**, not merely unmet.                                                                                                                  |

## The measures

`seconds_to_first_successful_query` (§7.4 — from session start, installation
included):

| Step                      | Seconds                 |
| ------------------------- | ----------------------- |
| `git clone` (local clone) | 0.349                   |
| `npm run build`           | 0.951                   |
| `cfr-free sync` (network) | 2.458                   |
| server ready              | 0.226                   |
| first successful query    | 0.027                   |
| **total**                 | **4.120 s = 0.069 min** |

**`npm ci` was NOT run** — `AGENTS.md` forbids an agent from installing
dependencies, so the main checkout's `node_modules` was symlinked. The real
install clock includes `npm ci`, which the rehearsal cannot measure, so
**this figure is a LOWER BOUND and SC-3 was therefore not exercised.** A
0.069-minute reading cannot be reported as a pass.

The paired run's two timings: **Run 1 is N/A — the rehearsal has no existing
tool**, and no number was estimated for it. Run 2 (cfr-free, F2-A) was
**0.223 s**.

## The `E3` count for F2-B — a rehearsal reading, not evidence

> **F2-B `E3` count (REHEARSAL-1): 0 of 1.** This is a rehearsal reading. It
> is NOT study evidence and it does NOT trigger the subject-index reopen
> condition, which is fixed on the **pilot's** `E3` count.

Three reasons the 0 carries almost no demand signal:

1. **The agent held the answer key.** It knew § 4.125 and § 4.129 were the
   targets before typing anything.
2. **The instrument's own rule lets a knowledgeable participant bypass the
   tool.** §6.4 scored `E0` for reaching the provisions "by any route … or
   their own knowledge", so the `E3` count only ever counts participants who
   do not already know the citations — it is confounded with prior knowledge,
   and no field separated them. → repaired (§5.3 rule 1, `tool_calls`)
3. **The `E3` branch was never exercised** — 1 of 1 attempts was `E0`, so the
   sub-reason taxonomy and the second-observer re-classification are
   untested.

## The §11.2 mapping, exercised

**This is the mapping running on rehearsal data to see whether it computes.**
On this data it did not compute — it produced **`STOP`** on the trigger _"SC-1
not met, and fewer than 2 of N requested another session"_, where the return
count defaulted to 0 because there was no participant to ask. Every task had
been answered correctly and every observation was irrelevant to the output.
**A cohort of 1 or 2 cannot reach CONTINUE under this mapping no matter what
the tool does**, because "≥ 3 of N" and "≥ 4 of N" are absolute counts while
§5.2 claims the protocol works at any N. → repaired (§11.2: not evaluable
below N = 3)

## Defects found, and what happened to each

**Blocks a session** — all five repaired in this commit:

1. **§10.3's `E3 sub-reason` had no legal value outside F2-B** (both values
   are subject-gap-specific; F4's incomplete third step would have had to
   carry one of them). _Repair:_ filled only for F2-B rows; `n/a — not a
subject-gap probe` elsewhere.
2. **F4's third requirement could not be answered from the surface the task
   names** — the change view carries no notice field; the limit is printed
   only by `historical` and the SPEC. _Repair:_ §6.6 says so, names
   `historical`, and forbids reading its absence as the participant's error.
3. **F5-B's answer key and its `E5` pre-list were surface-conditional** — on
   CLI/MCP/JSON the tool never emits the warning the `E5` case is for.
   _Repair:_ §6.7 states the warning is web-UI-only and scores a participant
   who states the omission in words as `E0`.
4. **§10.2's `exp_rank` was undefined for F2-B** — one cell, three ranks.
   _Repair:_ per-expected-provision ranks for F2-B.
5. **§11.2 was degenerate below N = 3.** _Repair:_ not evaluable below N = 3,
   recorded as such rather than as STOP.

**Corrupts a measure or a decision** — all repaired:

- **`E1` was overloaded.** Seven pre-listed failures assigned "the wrong
  provision" to cases where the provision was **right** (never read the
  export back, "no change" and stop, says the table is included …), which put
  completeness failures inside SC-1's "no E1/E2/E4" gate and inside the
  "citation error" rate the ROADMAP reads. _Repair:_ a new class `E6` —
  right provision, wrong or incomplete claim — reported separately and
  excluded from the `E1 + E2` legend and from SC-1.
- **The hardcoded corpus issue date.** A fresh sync returns 2026-10-19; the
  corpus is byte-identical (0 of 2,970 provisions differ), so a literal
  observer would have scored a correct answer `E4`. _Repair:_ the date is
  recorded at session time, never assumed.
- **§6.4 and Appendix A claimed § 4.86 ranked "measured FIRST"** — true
  before the ranking round, false now. _Repair:_ § 4.85 first, § 4.86 second,
  measured 2026-10-21.
- **Nothing required the participant to use the tool** — a practitioner who
  knew the citations could score `E0` on all five core tasks with zero tool
  calls and satisfy SC-1. _Repair:_ §5.3 rule 1 requires a tool call;
  §7.1 records `tool_calls`.
- **The roll-up denominators used `N` for three different things** (a
  participant's 7 attempts, the cohort's 5 participants, and §7.2's
  completed attempts). _Repair:_ every denominator named in the template.
- **The paired Run 2's relationship to the F2-A attempt was unstated** — read
  as separate, the cohort has 8 attempts and every denominator disagrees.
  _Repair:_ Run 2 **is** the F2-A attempt.

**Confuses one attempt** — nine found; the protocol-side ones are repaired
here (the browse descent path now names Chapter I, § 4.129's reach is
stated, the export format is `jsonl`, the availability flag's meaning is
stated, F1 no longer offers a class the sibling rule forbids). The remaining
observations are **tool behaviour**, recorded in §10.3's own vocabulary as
candidates for a future packet: the search hit's URL is the current one; the
export refusal exits 2 (which the README defines as "usage error"); there is
no CLI `search` command, so a CLI-only participant has no way to search;
`GET /api/v1/browse?part=4` 404s with a message that says Part 4 does not
exist; and the availability flag reads "not indexed" rather than "not in
this copy".

## What the rehearsal could not exercise at all

- **8 of the 10 outcome classes were never exercised** — only `E0` was.
  `E1`, `E2`, `S`, `E3`, `E4`, `E5`, `E6`, `U` and `X` have no rehearsal
  coverage. The network was reachable, so the `U` path was not taken.
- **`S` is the class the study exists to produce** (§1 item 3) — and it
  cannot be exercised by a rehearsal, because a rehearsal participant holds
  the answer key and never lands on a sibling. The second-observer
  mitigation (§13) is likewise untested.
- The debrief, the return measure, the consent flow and the paired Run 1 are
  all human-only.

## Verdict

**The protocol was not ready for a human participant, and is now closer than
that.** Every task family is answerable, the tool found every expected
provision, and the instrument's shape is sound — but one task's third
requirement could not be answered from the surface it named, the citation
block and its warning exist only in the web UI, a required column had no
legal value and another none inside its own row, and the taxonomy's two
halves contradicted each other by counting completeness failures as citation
errors.

Three changes would have made it ready, and all three are in this commit:
**(1)** make the protocol surface-aware and self-sufficient (§6.3, §6.4,
§6.5, §6.6, §6.7); **(2)** repair the taxonomy and the unfillable fields
(`E6`, the `E3 sub-reason`, `exp_rank`, `tool_calls`, the denominators);
**(3)** make the answer key and the decision mapping agree with the tool as
it ships today (the recorded issue date, the corrected sibling rank, and
`not evaluable` below N = 3).

**A rehearsal of this shape should be repeated as a regression check on the
instrument itself** — not as evidence about practitioners, but as a check
that every task is still answerable and every sheet still fillable after a
change lands.

> **DONE (2026-10-22).** That check is now automated:
> `test/fixtures/pilot/run.ts` runs the seven task families against a
> seeded index and asserts, per task, that the surface the task NAMES can
> still produce the answer the task asks for — 32 checks, all passing. It
> runs in CI via `test/pilot-rehearsal.test.ts`, is offline and hermetic
> (it never touches the operator's index and never the network), and says
> on its face that it is a regression check on the instrument and NOT
> study evidence. Run it with
> `CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/pilot/run.ts`.
> It does not touch the subject-index reopen condition, which is fixed on
> the PILOT's `E3` count.
