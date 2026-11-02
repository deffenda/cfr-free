# Ranking instrument design — 2026-11-01

**Status:** design brief for the next M3 engineering round. This document records
no new retrieval run and proposes no new corpus fact. Its evidence base is the
measured residual record, the expectation adjudication (especially §11.2), the
M3 roadmap record, SPEC §4, and the current search implementation.

## 1. Per-case adjudication

The measured baseline is **35/46 top-hit accuracy**, **43/46 recall@5**, with
**8** in-window-but-not-first cases. Thus the eight rows below include the
§ 9.21 case; it is not a ninth case (35 + 8 = 43). “Expected” means the
committee-adjudicated expected set, not a new preference introduced here.

| Query                                  | Expected                     | First today | Verdict                  | Basis                                                                                     |
| -------------------------------------- | ---------------------------- | ----------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| `SMC`                                  | § 3.350                      | § 17.151    | **REAL RANKING FAILURE** | §11.2: **invalid lifts** are a different benefit type; naming SMC verbatim is not enough. |
| `special monthly compensation`         | § 3.350                      | § 17.151    | **REAL RANKING FAILURE** | §11.2: **invalid lifts** are a different benefit type; naming SMC verbatim is not enough. |
| `"special monthly compensation"`       | § 3.350                      | § 17.151    | **REAL RANKING FAILURE** | §11.2: **invalid lifts** are a different benefit type; naming SMC verbatim is not enough. |
| `veterans dental benefits eligibility` | § 17.161, § 17.162, § 3.381  | § 17.160    | **REAL RANKING FAILURE** | §11.2: who may be **examined**, not who is **eligible**.                                  |
| `military burial allowance rate table` | § 3.1704, § 3.1705, § 3.1700 | § 3.1701    | **REAL RANKING FAILURE** | §11.2: **eligibility**, not the **rate** the query asks for.                              |
| `va loan underwriting guidelines`      | § 36.4340, § 36.4206         | § 36.4225   | **REAL RANKING FAILURE** | §11.2: authority to **close** a loan, not the **underwriting standards**.                 |
| `DIC`                                  | § 3.5, § 3.10, § 3.25        | § 3.455     | **REAL RANKING FAILURE** | §11.2: **apportionment**; a mechanic that presupposes the entitlement.                    |
| `traumatic brain injury compensation`  | § 3.350, § 4.124a, § 3.310   | § 9.21      | **REAL RANKING FAILURE** | §7/§11.3: wrong benefit programme; ROADMAP: **NOT fixable by a ranking rule**.            |

No current residual row is merely an **ORDERING PREFERENCE (adjudicated)**.
The accepted-sibling decisions removed cases where the first hit was a
defensible answer from this residual. For the seven question-object cases
above, §11.2 expressly rejected the first hit as an acceptable sibling; for
§ 9.21, no acceptable-sibling reading exists. Calling any of these first hits a
co-equal ordering choice would contradict that adjudication. This does not
erase the roadmap's distinction between the seven related-but-wrong
question-object failures and the one clear wrong-programme failure.

No verdict above is unsettled. What the record does **not** establish is that a
particular structural signal will repair any row; that is the hypothesis to
test, not an adjudication or a measurement supplied by this brief.

## 2. What the corpus structure offers

The current order is heading-phrase key, AND-tier membership, exception
demotion, BM25, then deterministic `s.citation`. The heading key requires the
query's content terms as a phrase; BM25 still weighs repetition within its
columns. The structural fields already available are `chapter`, `part`,
`subpart`, `subject_group`, and `path` on each section, part titles in
`meta.structure_json`, and the materialized `section_references` graph. The
analysis below does not assume an unrecorded group label, edge count, or
amendment fact.

### 2.1 `SMC`, `special monthly compensation`, and `"special monthly compensation"`

- **Heading and hierarchy.** § 3.350 is “Special monthly compensation
  ratings.”; § 17.151 is “Invalid lifts for recipients of aid and attendance
  allowance or special monthly compensation.” Their head noun phrases express
  different objects—ratings versus invalid lifts—even though both carry the
  compensation phrase. The part title, `path`, and `subject_group` can expose
  the move between Part 17 and Part 3 instead of presenting the shared phrase
  as answer equivalence.
- **Graph and history.** The citation graph can test whether other provisions
  cite § 3.350 as an operative compensation provision more broadly than they
  cite § 17.151. That direction and degree are unmeasured here. Amendment
  history supplies no recorded basis for preferring either section in these
  cases.
- **Why the existing keys miss it.** A phrase key can reward the verbatim
  compensation phrase in § 17.151 without recognizing “invalid lifts”; AND
  membership and BM25 likewise carry no benefit-type distinction. The
  abbreviation expansion noted for `SMC` does not supply that distinction.

### 2.2 `veterans dental benefits eligibility`

- **Heading and hierarchy.** § 17.160 is “Authorization of dental
  examinations.” Its examination object differs from the eligibility object
  attributed to § 17.161, § 17.162, and § 3.381. Part titles, `subpart`,
  `subject_group`, and `path` can keep the dental authorizations visible as a
  structural family while preserving the cross-part § 3.381 answer.
- **Graph and history.** Inbound references can test whether citing provisions
  treat the expected sections as the eligibility or service-connection rules,
  rather than treating § 17.160's examination authorization as the destination.
  No edge direction, count, or amendment preference is asserted without reading
  the graph.
- **Why the existing keys miss it.** Shared dental vocabulary does not encode
  the examination/eligibility distinction. Neither a whole-query heading phrase
  nor body frequency supplies the missing question object.

### 2.3 `military burial allowance rate table`

- **Heading and hierarchy.** § 3.1701 is “Deceased veterans for whom VA may
  provide burial benefits.” The expected set is § 3.1704, § 3.1705, and
  § 3.1700: the rate and benefit-type provisions rather than the eligibility
  provision. Their shared Part 3 hierarchy, `subpart`, `subject_group`, and
  `path` offer a way to present the burial-benefit family without elevating the
  first lexical hit.
- **Graph and history.** The graph can test whether cross-references converge
  on the expected rate and benefit-type provisions when other burial sections
  describe them. The record supplies no citation counts and no amendment-based
  ordering, so neither is presumed.
- **Why the existing keys miss it.** Burial and allowance vocabulary is shared
  by eligibility and rate provisions. Heading-first matching and BM25 do not
  encode that the query asks for a **rate**, not eligibility.

### 2.4 `va loan underwriting guidelines`

- **Heading and hierarchy.** § 36.4225 is “Authority to close manufactured home
  loans on the automatic basis.” Its head noun phrase concerns closing
  authority; the committee expected § 36.4340 and § 36.4206 for underwriting
  standards. Part 36 context plus `subpart`, `subject_group`, and `path` can
  distinguish those structural locations without treating all loan-guaranty
  vocabulary as the same question.
- **Graph and history.** References from other Part 36 provisions can test
  whether the underwriting sections are the cited destinations for standards,
  while § 36.4225 is cited for closing authority. That is a proposed graph
  read, not a measured fact. No amendment-history preference is recorded.
- **Why the existing keys miss it.** The current lexical keys have no
  underwriting-versus-closing feature. A heading phrase or repeated loan terms
  can therefore leave the authority provision first even though it answers a
  different question.

### 2.5 `DIC`

- **Heading and hierarchy.** § 3.455 is “Apportionment of a surviving spouse's
  dependency and indemnity compensation.” The expected § 3.5, § 3.10, and
  § 3.25 state the DIC entitlement and rates. The Part 3 `subject_group`,
  `subpart`, and `path` fields can expose that family and the apportionment
  subsection's position within it.
- **Graph and history.** Inbound citations can test whether § 3.5, § 3.10, and
  § 3.25 serve as entitlement and rate destinations while § 3.455 is cited for
  the apportionment mechanic. The brief asserts no measured degree or amendment
  signal.
- **Why the existing keys miss it.** The DIC expansion and the shared phrase
  identify the subject, not the question object. In particular, a heading that
  names dependency and indemnity compensation can still be an apportionment
  mechanic; BM25 cannot supply the entitlement distinction.

### 2.6 `traumatic brain injury compensation`

- **Heading and hierarchy.** § 9.21 is “Schedule of Losses.” in Part 9,
  “Servicemembers' Group Life Insurance and Veterans' Group Life Insurance.”
  The expected provisions are § 3.350, § 4.124a, and § 3.310. The part title is
  therefore the decisive context already available; `path` and `subject_group`
  can add ancestry but cannot turn the insurance loss schedule into a
  disability-compensation answer.
- **Graph and history.** § 9.20 “Traumatic injury protection.” cites § 9.21.
  That edge explains the insurance neighborhood; it is not evidence that
  § 9.21 answers this query. More graph support inside the wrong programme
  could reinforce the collision. No amendment-history rule is supported by the
  record.
- **Why the existing keys miss it.** No top-five heading carries the whole
  query phrase, all five are AND-tier members, and BM25 body repetition puts
  § 9.21 first. The roadmap has already rejected a per-part rule, a § 9.21
  blocklist, a BM25 retune, and an abstention band. The instrument below must
  therefore not claim to fix this case by reranking; part-title context remains
  the honest remedy.

**Amendment-history boundary for all cases.** SPEC §4's current section schema
has `issue_date`, and the corpus contains amendment material, but it has no
structured per-section amendment-history column. This brief does not infer a
history signal from those facts or authorize new corpus data. Amendment history
is consequently excluded from the instrument's quantity.

## 3. The instrument: Structural Citation Support

### 3.1 Exact quantity

**Structural Citation Support (SCS)** is a query-independent, deterministic
vector computed for each candidate section `s` from the existing `sections`
and `section_references` tables. Let `r` range over reference edges whose
`cited_citation` equals `s.citation`, joined to the citing section `c` by
`c.id = r.citing_id`. Exclude self-citations (`c.id = s.id`). Define:

- `I(s)` — the number of **distinct citing section IDs** that cite `s`;
- `P(s)` — the same count restricted to citing sections whose non-null,
  non-empty `part` exactly equals `s.part`; and
- `G(s)` — the count restricted further to citing sections whose non-null,
  non-empty `subject_group` exactly equals `s.subject_group` within that same
  part.

Then:

```text
SCS(s) = (G(s), P(s), I(s))
```

The vector is compared lexicographically, each component descending. Distinct
IDs make repeated references from one citing section count once. A missing or
empty `part` or `subject_group` contributes to `I` but never to `P` or `G`;
missing metadata must not become a wildcard match. Zero is a real value, and
`path` remains available to audit the section's ancestry rather than being
collapsed into a partial-string score. No query text, heading synonym,
hand-maintained topic list, new corpus field, or amendment inference enters the
computation.

### 3.2 Proposed surfacing and ranking experiment

The next engineering round may first expose the three components as diagnostic
output beside the existing part title and structural path: **subject-group
support / part support / total inbound support**. That makes the quantity
inspectable and shows why a section surfaced. It does not require a new public
wire field in this design round.

Only as a separately declared experiment, SCS would be inserted **after** the
existing heading-phrase, AND-tier, and exception-demotion keys and **before**
BM25; `s.citation` would remain the final deterministic tie-break. The OR
candidate set, FTS5 indexing, expected sets, and all corpus rows stay
unchanged. The intended effect is to surface an already-retrieved operative
provision when the existing lexical keys tie on the question's vocabulary but
the corpus's own citations support a different destination.

This is not a § 9.21 ranking fix. Any experiment must report that query's
output separately and retain its part-title context. A higher SCS score for
§ 9.21 would be evidence that graph degree measures neighbourhood prominence,
not answer correctness; there must be no § 9.21 exception, per-part branch, or
blocklist hidden in SCS.

### 3.3 Acceptance measure

The acceptance run uses the existing frozen benchmark's **46 answerable
queries** (across the 50-entry dev-plus-holdout benchmark), on an isolated copy
of the same index and with the same corpus provenance. It introduces no new
retrieval-quality metric:

1. Record the complete per-query top-five output. It is the regression guard
   and stays identical unless a difference is deliberately declared in the
   implementation packet. An undeclared changed hit, ordering, or no-answer
   result fails acceptance even when the aggregate improves.
2. Top-hit accuracy must not regress from **35/46**. The existing **43/46
   recall@5** baseline remains visible so a rerank cannot be reported as
   improved recall; SCS does not change the candidate set.
3. Report the wrong-programme § 9.21 case, the seven related-but-wrong
   question-object cases, and the subject-level `PTSD` → § 4.125 case
   separately; a single aggregate is insufficient. Do not convert an ordering
   change on § 9.21 into a claim that a ranking rule solved the programme
   collision, and do not reopen the subject index without the roadmap's fixed
   M6 F2-B `E3` majority threshold.
4. Do not tune SCS or select a threshold against the burned holdout. Any later
   threshold-bearing round keeps the roadmap's fresh-holdout and expert
   adjudication discipline.

**Meaning of a negative result.** If SCS is zero or tied where it is consulted,
or if it moves no ranked output, that is a finding that the corpus's citation
and subject structure does not discriminate these question objects at this
decision point. It is not a failed implementation to be rescued by adding
weights, synonyms, or hand-picked edges. If SCS moves output but fails the
regression guard, the experiment is rejected and the per-query differences are
retained as evidence.

## 4. Maintenance and curation

This follows the subject-index brief's topic-map, curation-effort,
corpus-change-maintenance, and acceptance-measure shape without creating a
hand-curated topic map.

- **Topic map.** SCS derives its neighbourhoods mechanically from exact `part`
  and `subject_group` values and from `section_references`; `path` and the
  `meta.structure_json` part title make those neighbourhoods legible. There is
  no benefit/topic → sections list and no synonym vocabulary to curate.
- **Who curates, and at what effort.** The index/sync maintainer owns correct
  extraction of section metadata and reference edges; the retrieval maintainer
  owns the SCS calculation and its regression report. Neither curates legal
  answer sets. The committee or expert remains the authority for expectations,
  and any expectation change remains a separately visible benchmark decision.
  Review effort is limited to changed structural metadata, changed edges, and
  declared per-query differences rather than a manual pass that assigns topics
  to the corpus.
- **What breaks when the corpus syncs.** An added, removed, or retitled
  section can change references and therefore SCS even when its own text is
  unchanged. Corrected cross-references, changed `part` or `subject_group`
  assignments, missing or empty metadata, and structure drift can change or
  invalidate neighbourhoods. Sync must rebuild the graph and metadata
  atomically; SCS is recomputed from that rebuilt index, never carried across
  issue dates as a persistent score. Repeated edges remain deduplicated by
  citing section ID, and missing values retain the semantics in §3.1.
- **How often to re-measure.** Run the acceptance comparison for every proposed
  SCS or ranking-input change and after any corpus sync on which a ranking
  claim relies. Report the index issue date and corpus receipt; compare outputs
  only on the same receipt. A sync that changes support requires a fresh
  per-query report, not an assumption that the previous result still holds.
- **Delivery evidence and rejected options.** If an engineering packet picks up
  this design, the roadmap record must carry its item/packet ID, implementation
  PR, reviewed SHA and verdict, exact validation tails, required CI links,
  operator decisions where needed, verified merge SHA, and measured M3 outcome.
  Keep a negative SCS result with the rejected-options record. Its revisit
  trigger is new corpus-structure evidence, not a desire to make the aggregate
  move; the already rejected § 9.21 per-part rule, blocklist, BM25 retune, and
  abstention band stay rejected.

## 5. Boundary

**No implementation change is authorized by this artifact.** This is the design
the next engineering round picks up: no ranking code, schema or wire-contract
change, source or test edit, fixture, synonym list, corpus-data addition, or
SPEC amendment is authorized here. The next round must declare its experiment
and per-query differences before treating SCS as more than a measured design.
