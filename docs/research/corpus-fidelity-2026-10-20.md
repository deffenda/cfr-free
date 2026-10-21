# Corpus fidelity inventory — Title 38, issue date 2026-10-16

**What this is:** a dated, reproducible record of which eCFR constructs the
parser preserves, and what is still lost or misrepresented in the text a
claims adjudicator reads. It is research, not a spec — the design authority
stays `docs/SPEC.md`.

**Document snapshot the numbers below were measured against**

|                   |                                                                      |
| ----------------- | -------------------------------------------------------------------- |
| Document          | `https://www.ecfr.gov/api/versioner/v1/full/2026-10-16/title-38.xml` |
| Issue date        | 2026-10-16                                                           |
| Bytes             | 9,613,330                                                            |
| SHA-256           | `9506de6c7c4f940355bb13f1aba679208554bb39516ff67ffe9f01079e4654b6`   |
| Provisions parsed | 2,970 (2,953 sections + 17 appendices)                               |

The upstream document is **mutable**: the same issue date can be served with
different bytes over time (a 2026-10-20 re-fetch of this same issue date
returned 9,596,707 bytes for an earlier download of it). Every number here
is therefore a snapshot tied to the hash above — never a test expectation.

**Reproduce it**

```bash
npm run build
node tools/corpus-fidelity-probe.mjs            # the current issue date
node tools/corpus-fidelity-probe.mjs 2026-10-16 # this snapshot
```

The probe prints the document's hash and the table below. It writes nothing
and installs nothing. Note the endpoint answers **406** unless the request's
`Accept-Encoding` permits compression ("This endpoint requires response
compression", supportCode 11) — the probe sends it and decompresses only if
the gzip magic bytes are still present (Node's `fetch` may have already
decompressed the body).

## 1. Content survival

`intact` = the provision keeps **all** of that construct's text; `partial` =
some survives; `lost` = none does.

**Correction (M1(b2)):** this table first reported **274** footnotes. That
count was wrong: it counted `<FP-1>` and `<FP-2>` as footnotes, and those
are not footnotes — they are list items inside an `<EXTRACT>` (212 of them,
175 inside extracts). The real footnote count is **62** (56 provisions).
The probe now matches element names EXACTLY, so `<FP>` no longer absorbs
`<FP-1>`/`<FP-2>`.

**Correction (M4, 2026-10-20):** this table was originally produced by a
probe with two measurement bugs that the repo's own security scan
surfaced (it built `RegExp()` from a variable, which the pre-commit gate
rejects). Once fixed with literal patterns — and once the per-class scan
was extended to appendices, which it had been skipping entirely — the
numbers moved and what looked like ONE REAL GAP appeared: **4 provisions
lose their footnote text** (§ 17.610, § 36.4221, § 36.4520, § 36.4527 —
signature blocks and one complex footnote). The original table showed
footnotes as fully intact. The appendix-blind scan also under-counted
source credits (1895 → 1907 provisions), authority notes (1265 → 1267),
sub-headings (1 → 2) and images (8 → 9).

**Correction (2026-10-21, the footnote gap was a MEASUREMENT artifact):
the "4 provisions lose their footnote text" finding above is WITHDRAWN —
no provision loses footnote text. The literal patterns the M4 fix
introduced ended the tag name in `\b` (`/<FP\b[^>]*>([\s\S]*?)<\/FP>/`),
and a word boundary is NOT an exact tag name: a hyphen is a non-word
character, so `\b` sits between "FP" and the "-" of `<FP-1>` and the
pattern matched the LIST ITEM. The capture then ran from the list item to
the next `</FP>` close tag, so the "fragment" was a span that exists
nowhere in the rendered output and the provision was reported as `lost`
— an artifact that reads exactly like lost content. The four provisions
were collateral damage of that pattern, not casualties of the parser.
`<FP-1>`/`<FP-2>` are LIST ITEMS — 212 of them across 11 provisions in
this snapshot — and exactly four provisions carry BOTH a list item and a
real `<FP>`, with the LIST ITEM FIRST (§ 17.610, § 36.4221, § 36.4520,
§ 36.4527: an `<EXTRACT>` of signature items, then the footnote). In
those four, the over-matching pattern began its capture at the list item
and ran to the `</FP>` that closes the real footnote, so the "fragment"
was the list plus the footnote — a span in no rendered output. The other
seven list-item provisions carry no `<FP>` at all, so the pattern had no
close tag to run to and never matched. The patterns now end the tag name
in `(?:\s[^>]*)?` — whitespace-and-attributes, or the closing ">" — never
a hyphen, a digit or any other continuation of the name. Re-measured on
the SAME snapshot (2026-10-16, 9 613 330 bytes, sha256 `9506de6c…` — the
very bytes the numbers below were measured against): footnotes are **56
intact / 0 partial / 0 lost**, and every other class is unchanged (the
before/after outputs differ in that one row and nowhere else).
The finding is corrected in place below, in the same spirit as the
corrections above: the earlier claim is kept, dated and marked, not
deleted.

**Evidence that the four provisions keep their footnote text** (checked
directly against the local corpus, `~/.cfr-free/index.sqlite`, table
`sections`, columns `text` and `markdown`): for each of § 17.610,
§ 36.4221, § 36.4520 and § 36.4527, every `<FP>` element's text is
present VERBATIM in the stored `text` AND in the stored `markdown`, and
so is every `<FP-1>` list item (1 `<FP>` plus 4 list items; 1 plus 7;
1 plus 7; 1 plus 8 respectively — 0 missing in every case). The
before/after probe outputs on the identical snapshot are the second,
independent witness: the same document, the same parser, the same
fragments — only the pattern changed.

**The two columns measure different populations, deliberately.** _Occurrences_
counts the elements present in the document; _Provisions_ counts the
provisions from which the probe could EXTRACT fragments to compare. They
differ where a construct nests its text in markup the probe does not extract
(e.g. an `<EXTRACT>` wrapping non-standard nested tags): EXTRACT shows 36
occurrences across 29 extractable provisions, CITA 1,910 across 1,907. The
occurrences figure is the complete count; the provisions figure is the
population the survival check could actually test — so it is a floor, not a
total.

| Construct                      | Occurrences | Provisions | Intact | Partial | Lost |
| ------------------------------ | ----------- | ---------- | ------ | ------- | ---- |
| footnotes (`<FP>`)             | 62          | 56         | 56     | 0       | 0    |
| notes (`<NOTE>`)               | 70          | 49         | 49     | 0       | 0    |
| editorial notes (`<EDNOTE>`)   | 33          | 28         | 28     | 0       | 0    |
| sub-headings (`<HD2>`)         | 3           | 2          | 2      | 0       | 0    |
| extracts (`<EXTRACT>`)         | 36          | 29         | 29     | 0       | 0    |
| source credits (`<CITA>`)      | 1,910       | 1,907      | 1,907  | 0       | 0    |
| authority notes (`<SECAUTH>`)  | 1,270       | 1,267      | 1,267  | 0       | 0    |
| table footers (`<TFOOT>`)      | 33          | 19         | 19     | 0       | 0    |
| graphic placeholders (`<GPH>`) | 0           | 0          | 0      | 0       | 0    |
| formulas (`<FORMULA>`)         | 0           | 0          | 0      | 0       | 0    |
| images (`<img>`)               | 15          | 9          | 9      | 0       | 0    |

**Row-level notes (2026-10-21).** The footnotes row was 52 intact / 4 lost
until the pattern fix above (the 4 were an artifact, not lost text). The
sub-headings, source credits, authority notes and image rows were still
carrying their PRE-appendix-scan counts (1 / 1,895 / 1,265 and 8) in this
table even though the M4 correction paragraph above already gave the
corrected values (2, 1,907, 1,267 and 9) — the table had not been updated
with them. Every row now carries the value re-measured on the snapshot
above by the fixed probe; the before/after outputs of the two probe
versions differ in the footnotes row ONLY, so these four rows are
unchanged by the pattern fix and were simply stale.

**No construct class loses text in this snapshot.** Numeric entities: 0
(named entities: 178, all decoded). Graphics are handled by the explicit
"image content not included" marker (finding P1-01).

## 2. What is still wrong (ranked by harm to a reader)

### G1 — Inline elements split words and phrases across blank lines (71 provisions)

**Harm:** a quoted phrase can arrive broken mid-token, so a reader (or an
agent) copying the text can quote "paragraph (g)(1)" as "paragraph (

g

)(1)".

The eCFR marks inline text with `<E T="01">` elements. A container that
mixes its own text with such an element was rendered as a sequence of
BLOCKS, so the text around the inline element was separated from it by a
blank line. Measured on the snapshot above: **407 inline `<E>` elements
across 136 provisions**, and **71 provisions flagged** by the detection used
here (a blank line whose two sides are both word/bracket characters) — a
lower bound, not a total: a looser detection (any mid-token blank-line
boundary) finds 94 provisions affected.

**Refined after the M1(b1) fix (which renders inline contexts inline):**
the defect is **55 provisions**. The corpus diff against the unfixed
renderer changed 57 provisions, every change whitespace-only, and the
remaining 16 flagged provisions are LEGITIMATE block boundaries the
detection also catches — a paragraph ending, a table row, two sibling
`<FP-1>` list items (§ 4.130's "9201 Schizophrenia" / "9202 [Removed]").
So the 71 is a proxy count, and 55 is the defect.

Verbatim upstream (§ 1.561, NOTE):

```xml
<NOTE>
<HED>Note to paragraph (<E T="01">g</E>)(1):</HED>
<P>VA will charge fees consistent with the salary scale published by the Office of Personnel Management (OPM).</P></NOTE>
```

Rendered today:

```
Note to paragraph (

g

)(1):

VA will charge fees consistent with the salary scale published by the Office of Personnel Management (OPM).
```

The same pattern splits "For **Federal Register** citations" in § 2.6's
editorial note into three lines.

### G2 — Footnotes: RESOLVED by M1(b2) (labelled; anchoring is impossible); no gap remains

**Harm (before the fix):** a reader could not tell a footnote from the
rule, and could not tell which claim a footnote qualifies.

§ 1.916 rendered as body paragraphs and then, unlabelled, the footnote
text "A notice of the right to request this information will be sent with
the notice described in paragraph (d)(1) of this section." — with no
marker tying it to the sentence it belongs to.

**Still open (measured in M4):** four provisions LOSE their footnote
text entirely — § 17.610, § 36.4221, § 36.4520, § 36.4527 — so no label
can help: the text is not in the index at all. The next M1(b) candidate.

**Corrected (2026-10-21): the "still open" item above is CLOSED, and it
was never a gap.** The four provisions do NOT lose their footnote text:
every `<FP>` element's text — and every `<FP-1>` list item's text — is
present VERBATIM in the local corpus (§ 17.610: 1 `<FP>` + 4 list items;
§ 36.4221: 1 + 7; § 36.4520: 1 + 7; § 36.4527: 1 + 8; none missing), in
both the `text` and the `markdown` columns of `sections` in
`~/.cfr-free/index.sqlite`. What the M4 measurement actually found was
the probe's OWN pattern: the literal `<FP>` pattern ended in `\b`, and a
word boundary matches the hyphen of `<FP-1>`, so the capture spanned
from a list item to the next `</FP>` close tag — a span that is in no
rendered output, and therefore always reported as `lost`. The pattern now
ends in `(?:\s[^>]*)?` (exact tag name), and re-measured on the same
snapshot the four provisions are **intact**, with footnotes at **56
intact / 0 partial / 0 lost**. There is no missing-footnote defect to
fix, and no parser change is owed: the text was in the index all along.
The probe's own output is now pinned by
`test/fidelity-probe.test.ts`, so the over-matching pattern cannot come
back silently.

**Now labelled:** a footnote renders as its own `Footnote:` block followed
by its text (the document's own label style — the NOTE/EDNOTE headings
read "Note:" / "Editorial Note:"). **Anchoring is not possible and is not
attempted:** the upstream footnote block carries no reference number, so
there is nothing to anchor to except position — inventing one would be
worse than not having it.

### G3 — Editorial notes: CORRECTED (they were already self-labelling)

**This gap was overstated.** Measured: all **33** editorial notes carry a
`<HED>` reading "Editorial Note:" — the document labels itself, and that
label survived the parser (it was only split by the inline bug of G1, now
fixed). So the note cannot be mistaken for the regulation's own text: the
words "Editorial Note:" are right there.

What remains true: an editorial note is a Federal Register pointer or a
finding-aid note, and a reader skimming for the rule has to read past it —
a readability point, not a mislabelling one. No code change is warranted;
the inventory records the correction rather than a fix.

### G4 — Notes: CORRECTED (they were already self-labelling); extracts RESOLVED by M1(b2)

**Notes:** measured, all **70** notes carry a `<HED>` — "Note:" or
"Note to paragraph (g)(1):" — so the upstream wording labels them. The
claim that notes were unlabelled was wrong; recorded as a correction.

**Extracts (the real gap here):** `<EXTRACT>` blocks (36 occurrences) hold
quoted material from elsewhere and carried no marker at all, so a reader
could take the quotation for the provision's own text. An extract now
renders as its own `Extract:` block, and its content keeps the structure it
had (an extract's list items stay list items).

### G5 — Sub-headings: RESOLVED by M1(b2) (rendered as headings)

**Harm (before the fix):** a subsection heading read as a run-on sentence.

`<HD2>` occurs 3 times (e.g. § 17.395 "Live Donor Follow-Up Means"); the
text survived but was rendered inline. It now renders as its own block, and
as a heading in the markdown (`### …`), like a `<HEAD>`.

## 3. What is already handled (no work needed)

- **Graphics** (P1-01): every `<img>` is replaced in place by
  `[image content not included: /graphics/…]`; unvetted sources are never
  echoed; the sync report and `meta.image_content_sections` state how many
  provisions are affected.
- **Entities**: named and numeric character references decode correctly
  (`&#xA7;` → §, `&#x2014;` → —, `&#160;` → non-breaking space).
- **Tables**: header, body and footer rows all render; cell pipes are
  escaped; the fidelity suite pins the exact rendering of real sections.
- **Authority notes and source credits**: preserved verbatim, and they are
  self-labelling ("(Authority: 38 U.S.C. 501)", "[52 FR 34907, …]").

## 4. Next step (M1(b), not implemented here)

The gaps above are a rendering problem, not a data problem: the text is in
the document and in the index. A follow-up should decide, per class, whether
the output should **label** it (`[footnote]`, `Note:`, `Editorial note:`),
**anchor** it (a marker for footnotes), or **silence** it — and then change
`src/core/xml.ts` accordingly, with offline fixtures for each class. Until
then, the index is content-complete but presentation-lossy for these
constructs.

**Historical note (2026-10-21):** the follow-up described above has since
shipped — M1(b1) fixed the inline rendering gap (G1) and M1(b2) labelled
footnotes and extracts and rendered sub-headings as headings (G2, G4, G5).
The one item this inventory still listed as open — the four provisions
"losing" their footnote text — was withdrawn on 2026-10-21 as a
measurement artifact of the probe's own pattern (see §1 and G2): the text
was in the index all along, so no parser change was owed for it.

**This inventory does not change parser behavior.** The behaviour is pinned
where it is desirable (footnote/note/editorial-note text survives) and
documented where it is not.
