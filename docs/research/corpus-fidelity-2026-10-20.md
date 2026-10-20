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

**The two columns measure different populations, deliberately.** _Occurrences_
counts the elements present in the document; _Provisions_ counts the
provisions from which the probe could EXTRACT fragments to compare. They
differ where a construct nests its text in markup the probe does not extract
(e.g. an `<EXTRACT>` wrapping non-standard nested tags): EXTRACT shows 36
occurrences across 29 extractable provisions, CITA 1,910 across 1,895. The
occurrences figure is the complete count; the provisions figure is the
population the survival check could actually test — so it is a floor, not a
total.

| Construct                      | Occurrences | Provisions | Intact | Partial | Lost |
| ------------------------------ | ----------- | ---------- | ------ | ------- | ---- |
| footnotes (`<FP>`)             | 274         | 56         | 56     | 0       | 0    |
| notes (`<NOTE>`)               | 70          | 49         | 49     | 0       | 0    |
| editorial notes (`<EDNOTE>`)   | 33          | 28         | 28     | 0       | 0    |
| sub-headings (`<HD2>`)         | 3           | 1          | 1      | 0       | 0    |
| extracts (`<EXTRACT>`)         | 36          | 29         | 29     | 0       | 0    |
| source credits (`<CITA>`)      | 1,910       | 1,895      | 1,895  | 0       | 0    |
| authority notes (`<SECAUTH>`)  | 1,270       | 1,265      | 1,265  | 0       | 0    |
| table footers (`<TFOOT>`)      | 33          | 19         | 19     | 0       | 0    |
| graphic placeholders (`<GPH>`) | 0           | 0          | 0      | 0       | 0    |
| formulas (`<FORMULA>`)         | 0           | 0          | 0      | 0       | 0    |
| images (`<img>`)               | 15          | 8          | 8      | 0       | 0    |

**No construct class loses text in this snapshot.** Numeric entities: 0
(named entities: 178, all decoded). Graphics are handled by the explicit
"image content not included" marker (finding P1-01).

## 2. What is still wrong (ranked by harm to a reader)

### G1 — Inline elements split words and phrases across blank lines (71 provisions)

**Harm:** a quoted phrase can arrive broken mid-token, so a reader (or an
agent) copying the text can quote "paragraph (g)(1)" as "paragraph (

g

)(1)".

The eCFR marks inline text with `<E T="01">` elements. The parser renders an
inline element's text but keeps the XML's pretty-print whitespace around it,
so the text is split by blank lines. Measured on the snapshot above: **407
inline `<E>` elements across 136 provisions**, and **at least 71 provisions
have at least one mid-token split** — a lower bound, not a total: the
detection used here (a blank line whose two sides are both word/bracket
characters) is strict, and a looser detection (any mid-token blank-line
boundary) finds 94 provisions affected. The gap is real either way; the
exact figure depends on the detection rule, so treat 71 as the floor.

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

### G2 — Footnotes are preserved but not anchored, and not labelled

**Harm:** a reader cannot tell which claim a footnote qualifies, and may
read the footnote's own words as part of the rule.

§ 1.916 renders as: body paragraphs, then (unlabelled) the footnote text
"A notice of the right to request this information will be sent with the
notice described in paragraph (d)(1) of this section." — with no marker
tying it to the sentence it belongs to. The upstream footnote block carries
no reference number either, so the anchor has to come from position alone.

### G3 — Editorial notes read as regulatory prose

**Harm:** an _editorial_ note (a Federal Register pointer, a finding-aid
note) can be mistaken for the regulation's own text — the opposite of what
it is.

§ 2.6 renders "Editorial Note: For Federal Register citations affecting
§ 2.6, see the List of CFR Sections Affected…" as ordinary paragraphs
with no label beyond the word "Editorial Note:" itself (which does survive,
inline-split per G1).

### G4 — Notes and extracts are not labelled

**Harm:** a reader cannot distinguish a note to a paragraph from the
paragraph it annotates, and an extract from surrounding text.

§ 1.561's "Note to paragraph (g)(1): …" is rendered as plain text with no
"Note" label of its own beyond the upstream wording, and `<EXTRACT>` blocks
(36 occurrences) are rendered as plain paragraphs with no marker.

### G5 — Sub-headings are rendered as ordinary text

**Harm:** a subsection heading reads as a run-on sentence.

`<HD2>` occurs 3 times (e.g. § 17.395 "Live Donor Follow-Up Means"); the text
survives but is rendered inline, not as a heading.

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

**This inventory does not change parser behavior.** The behaviour is pinned
where it is desirable (footnote/note/editorial-note text survives) and
documented where it is not.
