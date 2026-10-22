# Fresh-holdout expectation adjudication — the 43 provisional entries

**Date:** 2026-10-22. **Status:** the 43 entries are adjudicated as recorded
below; the file is still **not a gate** until the operator ratifies it (see
"What the operator still owns").

**This records one thing and changes one thing.** It records the
adjudication of the expectations in `test/fixtures/retrieval/queries.fresh.ts`
— 43 queries written on 2026-10-21, every expectation marked
`adjudication: 'provisional'` — and it changes those expectations in the
file to the cross-checked result. It changes **no metric**: the frozen
dev set and the burned holdout are byte-for-byte as committed, the
evaluation runner is unchanged, and no reordering or re-scoping of any
existing set happened here.

## 1. How this was done

Two committee members (free-tier, independent of the author and of each
other) adjudicated the 43 entries **separately and blind to the
retriever**. Neither ran the evaluation runner or the search CLI — the
question being answered is "is this expectation right?", not "does the
retriever hit it?". Each member queried a **copy** of the corpus
(`cp ~/.cfr-free/index.sqlite /tmp/eval-*.sqlite`); the live index was
never opened in place.

|                     |                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Corpus              | `~/.cfr-free/index.sqlite`, issue date **2026-10-16**, **2 970** provisions (2 953 sections + 17 appendices) |
| Members             | two, independent, cross-checked against each other and against the corpus                                    |
| Blind to            | the retriever's output; each other's rulings; the prior adjudication's answers                               |
| Measured afterwards | the adjudicated set, once, with the repo's own runner                                                        |

The cross-check found **real defects in the author-written set** — five
entries where the expectation was the wrong object, and one where the
query did not correspond to the corpus at all. Both members found the
no-answer set clean, independently and with receipts.

## 2. The no-answer set: 8 of 8 confirmed

Both members confirmed all eight candidates are genuinely out of corpus,
and I re-probed them. Every token returns **0** under both a `LIKE` scan
of `text` and `heading` and an FTS phrase match, on a connection where
positive controls return non-zero (`aid and attendance` 31, `tinnitus` 4,
`Purple Heart` 4, `presumptive` 18, `underwriting` 13). The positive
controls matter: a "no-answer" claim is exactly where a silent false
negative would be invisible, so the zeros are shown to be real absences
rather than a broken matcher.

**The no-answer set needs no change.**

## 3. The six entries the cross-check changed

### 3.1 `"attendance allowance for veterans"` — REJECTED as written

The quoted string occurs **nowhere**: 0 `LIKE` hits and 0 FTS phrase hits.
The corpus says **"aid and attendance"** (31 provisions). The topic is
present in the corpus, so this is not a no-answer case either — it is a
quoted-phrase query whose string is not a phrase in the corpus.

_Both members found this independently_ (A: "the quoted string occurs 0
times"; B: "0 LIKE hits, 0 FTS phrase hits … miscategorized").

**Ruling:** the entry is rewritten as a natural-phrasing query for the
same topic, with the expectation that the corpus's own phrase carries.
The quoted-phrase category requires the quoted string to BE a phrase of
the corpus; three other quoted-phrase entries in the set are affected by
the same rule and are re-checked below.

### 3.2 `"individual unemployability"` — a member's claim, checked and REJECTED

Member A proposed rewording the query, on the ground that the heading
reads "unemployability of the individual" and so the quoted form is not a
phrase of the corpus.

**Checked against the corpus and rejected:** `"individual unemployability"`
IS an exact phrase — 11 `LIKE` hits and 11 FTS phrase hits, carried by
3.341, 3.343, 3.350, 3.750, 3.1704, 4.28 and others. The heading's word
order is not the phrase's.

**Ruling:** the query stands as written and the expectation (§ 4.16) was
already right. A proposal that the corpus contradicts does not become a
ruling, and the cross-check is where it is caught.

### 3.3 `"special monthly compensation rate"` — under-specified

The quoted string returns **0** `LIKE` hits, but the FTS phrase match
returns **3** provisions: **3.350, 4.71a, 4.73**. (The phrase without
"rate" returns 8.) The original expectation listed 3.350 alone, so the
set was under-specified for its own query.

**Ruling:** the expectation becomes all three provisions the phrase
actually reaches, and the query is reworded to the corpus's phrase.

### 3.4 `"hearing impairment"` — incomplete

The phrase reaches 8 provisions, of which the three that answer the
question are **4.85** (Evaluation of hearing impairment), **4.86**
(Exceptional patterns) and **4.87** (Schedule of ratings—ear). The
original expectation had only 4.85.

**Ruling:** amended to all three.

### 3.5 `traumatic brain injury residuals` — the wrong object

The expectation was § 3.350 (Special monthly compensation ratings).
Member A's finding: **§ 3.352(b)(2)** reads "As a result of
service-connected residuals of traumatic brain injury" — the query's words
verbatim — while 3.350 only lists brain injury as one enumerated SMC
basis. Member B did not raise it.

**Ruling:** amended to 3.352. The corpus decides this: the question asks
about _residuals_, and 3.352 is keyed to that word.

### 3.6 `which rule covers presumptive service connection` — incomplete

The expectation was 3.307 and 3.309. Member B found **3.308**
("Presumptive service connection; peacetime service before January 1,
1947") is a distinct rule the query plainly covers. Verified: 3.307 and
3.308 are both headed presumptive-service-connection, and 3.309 is the
disease-specific one.

**Ruling:** amended to 3.307, 3.308, 3.309.

## 4. The disputes the corpus settled against a member

Three entries where the members disagreed, and the corpus decided.

### 4.1 `Purple Heart benefits` — BOTH amendments are wrong

A amended to `[17.36, 17.149]`; B amended to `[17.149, 17.108]`.

Neither is right. The corpus has **exactly four** Purple Heart mentions,
and every one is an **eligibility carve-out**, not a benefits provision:

| provision | heading                                 | the Purple Heart mention                                                        |
| --------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| 17.36     | Enrollment—hospital and outpatient care | "veterans awarded the Purple Heart" qualify for enrollment without copay/offset |
| 17.149    | Sensori-neural aids                     | "Those awarded a Purple Heart" get aids                                         |
| 17.108    | Copayments                              | "A veteran awarded a Purple Heart" is exempt from copayments                    |
| 51.50     | Eligible veterans—nursing home care     | Purple Heart awardees are an eligible category                                  |

There is **no "Purple Heart benefits" provision in Title 38.** The query
asks for a thing the corpus does not have, and it is **plural and vague** —
a scope question the corpus cannot settle.

**Ruling:** the entry is reworded to what the corpus actually holds — the
Purple Heart **carve-out from copayments** (17.108) — with the expectation
narrowed to 17.108. The other three mentions are recorded in the
rationale. This is the one entry where **the author, not the committee,
chose the question**; the operator owns the final wording.

### 4.2 `what is the PTSD service connection rule` — B's amendment is wrong

B amended to `[3.304, 3.309, 3.310]`. Verified against the corpus:
**3.310 has no PTSD mention at all** — its heading is "Disabilities that
are proximately due to, or aggravated by, service-connected disease or
injury", which is the aggravation rule, not the PTSD rule. 3.304 carries
the PTSD service-connection paragraph (f); 3.309 carries the PTSD
presumption.

**Ruling:** amended to `[3.304, 3.309]` — the two provisions that carry
PTSD service-connection text. 3.310 is dropped.

### 4.3 `BVA review` — both amendments point at the wrong thing

A amended to `[20.1]`; B amended to `[20.103, 20.104]`. The headings:

- 19.2 — "Appellant's election for review of a **legacy appeal**" (A's
  objection to 19.2 is right: it is scoped to legacy appeals)
- 20.1 — "Rule 1. **Purpose and construction** of Rules of Practice" (a
  construction rule, not review structure — A's amendment is wrong)
- 20.103 — "Rule 103. **Principal functions** of the Board"
- 20.104 — "Rule 104. **Jurisdiction** of the Board"

A generic "BVA review" query most plausibly means the Board's
**structure and functions** (20.103, 20.104). 20.1 is a construction
rule; 19.2 is legacy-appeal-specific.

**Ruling:** amended to `[20.103, 20.104]`.

## 5. The entries the corpus cannot settle (operator decisions)

These stay **provisional**. The corpus does not decide them, and the repo's
precedent keeps content questions with the operator.

1. **`burial allowance rates`** — the corpus has **no rate**. § 3.1704
   and § 3.1705 authorize "the maximum burial allowance specified in
   38 U.S.C. 2307 / 2303" and set eligibility; no dollar figure exists
   anywhere in subpart B. (Verified: the only subpart-B section mentioning
   an amount is 3.1711, about government contributions, not a rate.) The
   query asks for something the corpus does not contain, so it is
   **reworded to eligibility** and the expectation is 3.1704/3.1705 — a
   ruling the corpus supports, but the choice of wording is the operator's.
2. **`MST`** — no provision in Title 38 is headed "military sexual
   trauma", and the phrase appears in exactly **two** provisions
   (17.2000 "Vet Center services" and 78.10 "Eligible individuals"),
   neither of which is a service-connection rule.
   Whether the abbreviation means the PTSD/psychosis presumption (3.309),
   the direct-service-connection rule (3.304) or the Vet Center
   entitlement (78.10) is **author intent**. The expectation is widened
   to `[3.304, 3.309]` — the two service-connection rules a practitioner
   would land on — and the rationale records the 78.10 reading.
3. **`NSC`** — genuinely ambiguous: "non-service-connected" makes 3.303
   the wrong object, but the corpus's own curated map treats `NSC` as
   shorthand for service-connection rules generally. Both readings are
   covered by `[3.303, 3.309]`. Separately, A's observation stands: this
   entry is a **weak test** — its own rationale concedes it reaches
   service-connection rules generally, which makes it hard to distinguish
   from two other queries in the same file. The operator may replace it
   with a near-miss that is actually out of corpus.
4. **`"service connection"` and `"individual unemployability"` — the
   quoted-phrase POLICY.** A quoted phrase reaches many provisions
   (`"service connection"` matches 60 by `LIKE` and 225 by FTS). Does a
   quoted-phrase query expect _every_ provision carrying the phrase, or
   only the canonical one? The set cannot be used for measurement until
   this is settled, because the two readings differ by an order of
   magnitude. B flagged this as a policy question; it is the operator's.
   The entries as adjudicated take the **canonical-provision** reading
   (the one the existing dev/holdout sets use), and that is recorded in
   the rationale of each quoted-phrase entry.

## 6. What changed in the file

`test/fixtures/retrieval/queries.fresh.ts` — the expectations and
rationales of the entries above, and the `adjudication` markers. **No
query text was changed except the three rewritten ones** (3.1, 3.2, 3.3),
because a quoted-phrase query whose string is not a phrase of the corpus
cannot be adjudicated as a quoted-phrase query; rewording is what makes it
a valid instance of its category.

**The set is still not a gate.** It becomes one when the operator
ratifies the four §5 decisions, at which point the `adjudication`
markers can move from `provisional` to `adjudicated` and the set can
gate a threshold-bearing round.

## 7. What the operator still owns

1. The four §5 content decisions (burial-allowance wording, MST scope,
   NSC scope, and the quoted-phrase policy).
2. Ratification, which is what makes the set gate-worthy.
3. Whether to replace `NSC` with a stronger near-miss.

The subject-index reopen condition (ROADMAP §M3) is **unaffected**: it
turns on the pilot's `E3` count, not on this set. This adjudication
changes no roadmap decision.

## 8. Reproducing this

```bash
cp ~/.cfr-free/index.sqlite /tmp/eval-index.sqlite   # never the live index
CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/retrieval/run.ts fresh
```

The two member findings are recorded verbatim in the review record for
this round; the corpus receipts quoted above (the 0-hit probes, the FTS
phrase hits, and the heading checks) are reproducible with `node:sqlite`
against the copied index.
