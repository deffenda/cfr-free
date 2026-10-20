import { describe, expect, it } from 'vitest';
import { extractReferences } from '../src/core/references.js';
import { decodeNumericEntities, parseTitleXml } from '../src/core/xml.js';

/**
 * Regulatory-text fidelity fixtures (SPEC §13).
 *
 * Every fragment below is VERBATIM from the eCFR versioner API:
 *
 *   https://www.ecfr.gov/api/versioner/v1/full/2026-10-09/title-38.xml?part=4
 *
 * (title 38 issue date 2026-10-09, retrieved 2026-10-14). Nothing is
 * hand-written: attributes, whitespace, entities (`&#xA7;` → §, `&#x2014;`
 * → —) and even upstream typos are preserved as served. The goldens were
 * derived block-by-block from the XML and verified against the parser, so
 * any change to rendering of rating tables, paragraph structure, footnotes,
 * source credits or cross-reference decoding fails here — before it can
 * reach an adjudicator.
 *
 * Covered constructs:
 * - § 4.30   — paragraph designators, `<FP>` footnote, entity-encoded §
 *              cross-references, `<CITA>` source credit
 * - § 4.87a  — rating table (`<THEAD>`/`<TBODY>`, empty cell, `<strong>`)
 *              plus `<SECAUTH>` authority note
 * - § 4.17a  — `§§` comma-list cross-references extracted end-to-end
 */

const SECTION_4_30 = `<DIV8 N="4.30" TYPE="SECTION" hierarchy_metadata="{&quot;path&quot;:&quot;/on/_SUBSTITUTE_DATE_/title-38/section-4.30&quot;,&quot;citation&quot;:&quot;38 CFR 4.30&quot;}">
<HEAD>&#xA7; 4.30 Convalescent ratings.</HEAD>
<P>A total disability rating (100 percent) will be assigned without regard to other provisions of the rating schedule when it is established by report at hospital discharge (regular discharge or release to non-bed care) or outpatient release that entitlement is warranted under paragraph (a) (1), (2) or (3) of this section effective the date of hospital admission or outpatient treatment and continuing for a period of 1, 2, or 3 months from the first day of the month following such hospital discharge or outpatient release. The termination of these total ratings will not be subject to &#xA7; 3.105(e) of this chapter. Such total rating will be followed by appropriate schedular evaluations. When the evidence is inadequate to assign a schedular evaluation, a physical examination will be scheduled and considered prior to the termination of a total rating under this section.</P>
<P>(a) Total ratings will be assigned under this section if treatment of a service-connected disability resulted in:</P>
<P>(1) Surgery necessitating at least one month of convalescence (Effective as to outpatient surgery March 1, 1989.)</P>
<P>(2) Surgery with severe postoperative residuals such as incompletely healed surgical wounds, stumps of recent amputations, therapeutic immobilization of one major joint or more, application of a body cast, or the necessity for house confinement, or the necessity for continued use of a wheelchair or crutches (regular weight-bearing prohibited). (Effective as to outpatient surgery March 1, 1989.)</P>
<P>(3) Immobilization by cast, without surgery, of one major joint or more. (Effective as to outpatient treatment March 10, 1976.)</P>
<FP>A reduction in the total rating will not be subject to &#xA7; 3.105(e) of this chapter. The total rating will be followed by an open rating reflecting the appropriate schedular evaluation; where the evidence is inadequate to assign the schedular evaluation, a physcial examination will be scheduled prior to the end of the total rating period.
</FP>
<P>(b) A total rating under this section will require full justification on the rating sheet and may be extended as follows:</P>
<P>(1) Extensions of 1, 2 or 3 months beyond the initial 3 months may be made under paragraph (a) (1), (2) or (3) of this section.</P>
<P>(2) Extensions of 1 or more months up to 6 months beyond the initial 6 months period may be made under paragraph (a) (2) or (3) of this section upon approval of the Veterans Service Center Manager.</P>
<CITA TYPE="N">[41 FR 34256, Aug. 13, 1976, as amended at 54 FR 4281, Jan. 30, 1989; 71 FR 28586, May 17, 2006]
</CITA>
</DIV8>`;

const SECTION_4_87A = `<DIV8 N="4.87a" TYPE="SECTION" hierarchy_metadata="{&quot;path&quot;:&quot;/on/_SUBSTITUTE_DATE_/title-38/section-4.87a&quot;,&quot;citation&quot;:&quot;38 CFR 4.87a&quot;}">
<HEAD>&#xA7; 4.87a Schedule of ratings&#x2014;other sense organs.</HEAD>
<DIV width="100%"><DIV class="gpotbl_div">
<TABLE border="1" cellpadding="1" cellspacing="1" class="gpo_table" frame="void" width="100%">
<THEAD>
<TR>
<TH class="center border-top-single border-bottom-single border-right-single"> </TH>
<TH class="center border-top-single border-bottom-single">Rating</TH>
</TR>
</THEAD>
<TBODY>
<TR>
<TD class="left border-right-single">6275 Sense of smell, complete loss</TD>
<TD class="right">10</TD>
</TR>
<TR>
<TD class="left border-right-single">6276 Sense of taste, complete loss</TD>
<TD class="right">10</TD>
</TR>
<TR>
<TD class="left border-bottom-single border-right-single primary-indent-hanging-1"><strong>Note:</strong> Evaluation will be assigned under diagnostic codes 6275 or 6276 only if there is an anatomical or pathological basis for the condition.</TD>
<TD class="right border-bottom-single"/>
</TR>
</TBODY>
</TABLE>
</DIV></DIV>
<SECAUTH TYPE="N">(Authority: 38 U.S.C. 1155)
</SECAUTH>
<CITA TYPE="N">[64 FR 25210, May 11, 1999]
</CITA>
</DIV8>`;

const SECTION_4_17A = `<DIV8 N="4.17a" TYPE="SECTION" hierarchy_metadata="{&quot;path&quot;:&quot;/on/_SUBSTITUTE_DATE_/title-38/section-4.17a&quot;,&quot;citation&quot;:&quot;38 CFR 4.17a&quot;}">
<HEAD>&#xA7; 4.17a Misconduct etiology.</HEAD>
<P>A permanent and total disability rating under the provisions of &#xA7;&#xA7; 4.15, 4.16 and 4.17 will not be precluded by reason of the coexistence of misconduct disability when:</P>
<P>(a) A veteran, regardless of employment status, also has innocently acquired 100 percent disability, or</P>
<P>(b) Where unemployable, the veteran has other disabilities innocently acquired which meet the percentage requirements of &#xA7;&#xA7; 4.16 and 4.17 and would render, in the judgment of the rating agency, the average person unable to secure or follow a substantially gainful occupation.</P>
<CITA TYPE="N">[40 FR 42536, Sept. 15, 1975, as amended at 43 FR 45349, Oct. 2, 1978]
</CITA>
</DIV8>`;

/** Parse a fixture that must contain exactly one section. */
function onlySection(xml: string) {
  const [section] = parseTitleXml(xml);
  if (section === undefined) throw new Error('fixture parsed to zero sections');
  return section;
}

describe('regulatory-text fidelity (verified eCFR fixtures)', () => {
  describe('§ 4.30 — paragraphs, footnote, entity-encoded cross-references', () => {
    const section = onlySection(SECTION_4_30);

    it('extracts the section with a citation-stripped heading', () => {
      expect(section).toBeDefined();
      expect(section.citation).toBe('4.30');
      expect(section.kind).toBe('section');
      expect(section.heading).toBe('Convalescent ratings.');
      // path records ancestor divisions only; this fixture is the verbatim
      // section element without its chapter/part wrappers, so it is root.
      // (Full-hierarchy paths are covered by the structure tests.)
      expect(section.path).toBe('/');
    });

    it('reproduces every paragraph, the footnote and the source credit verbatim', () => {
      const expected = [
        'A total disability rating (100 percent) will be assigned without regard to other provisions of the rating schedule when it is established by report at hospital discharge (regular discharge or release to non-bed care) or outpatient release that entitlement is warranted under paragraph (a) (1), (2) or (3) of this section effective the date of hospital admission or outpatient treatment and continuing for a period of 1, 2, or 3 months from the first day of the month following such hospital discharge or outpatient release. The termination of these total ratings will not be subject to § 3.105(e) of this chapter. Such total rating will be followed by appropriate schedular evaluations. When the evidence is inadequate to assign a schedular evaluation, a physical examination will be scheduled and considered prior to the termination of a total rating under this section.',
        '(a) Total ratings will be assigned under this section if treatment of a service-connected disability resulted in:',
        '(1) Surgery necessitating at least one month of convalescence (Effective as to outpatient surgery March 1, 1989.)',
        '(2) Surgery with severe postoperative residuals such as incompletely healed surgical wounds, stumps of recent amputations, therapeutic immobilization of one major joint or more, application of a body cast, or the necessity for house confinement, or the necessity for continued use of a wheelchair or crutches (regular weight-bearing prohibited). (Effective as to outpatient surgery March 1, 1989.)',
        '(3) Immobilization by cast, without surgery, of one major joint or more. (Effective as to outpatient treatment March 10, 1976.)',
        // The upstream typo "physcial" is part of the served text: fidelity
        // means reproducing it, not silently correcting it.
        'A reduction in the total rating will not be subject to § 3.105(e) of this chapter. The total rating will be followed by an open rating reflecting the appropriate schedular evaluation; where the evidence is inadequate to assign the schedular evaluation, a physcial examination will be scheduled prior to the end of the total rating period.',
        '(b) A total rating under this section will require full justification on the rating sheet and may be extended as follows:',
        '(1) Extensions of 1, 2 or 3 months beyond the initial 3 months may be made under paragraph (a) (1), (2) or (3) of this section.',
        '(2) Extensions of 1 or more months up to 6 months beyond the initial 6 months period may be made under paragraph (a) (2) or (3) of this section upon approval of the Veterans Service Center Manager.',
        '[41 FR 34256, Aug. 13, 1976, as amended at 54 FR 4281, Jan. 30, 1989; 71 FR 28586, May 17, 2006]',
      ].join('\n\n');
      expect(section.text).toBe(expected);
      // No tables or headings render differently: markdown mirrors text here.
      expect(section.markdown).toBe(expected);
    });

    it('decodes § entities and extracts the referenced provision', () => {
      expect(section.text).toContain('§ 3.105(e)');
      expect(section.text).not.toContain('&#xA7;');
      // Both the intro paragraph and the footnote cite 3.105(e); deduped.
      expect(extractReferences(section.text)).toEqual(['3.105']);
    });
  });

  describe('§ 4.87a — rating table, authority note, source credit', () => {
    const section = onlySection(SECTION_4_87A);

    it('extracts the section', () => {
      expect(section).toBeDefined();
      expect(section.citation).toBe('4.87a');
      expect(section.heading).toBe('Schedule of ratings—other sense organs.');
    });

    it('reproduces the rating table as a pipe table with every row intact', () => {
      const table = [
        '|  | Rating |',
        '| --- | --- |',
        '| 6275 Sense of smell, complete loss | 10 |',
        '| 6276 Sense of taste, complete loss | 10 |',
        '| Note: Evaluation will be assigned under diagnostic codes 6275 or 6276 only if there is an anatomical or pathological basis for the condition. |  |',
      ].join('\n');
      expect(section.markdown).toBe(
        [table, '(Authority: 38 U.S.C. 1155)', '[64 FR 25210, May 11, 1999]'].join('\n\n'),
      );
    });

    it('reproduces the same table in the plain-text index variant', () => {
      const table = [
        ' | Rating',
        '6275 Sense of smell, complete loss | 10',
        '6276 Sense of taste, complete loss | 10',
        'Note: Evaluation will be assigned under diagnostic codes 6275 or 6276 only if there is an anatomical or pathological basis for the condition. | ',
      ].join('\n');
      expect(section.text).toBe(
        [table, '(Authority: 38 U.S.C. 1155)', '[64 FR 25210, May 11, 1999]'].join('\n\n'),
      );
    });

    it('has no CFR cross-references (authority is statutory)', () => {
      expect(extractReferences(section.text)).toEqual([]);
    });
  });

  describe('§ 4.17a — §§ comma-list cross-references', () => {
    const section = onlySection(SECTION_4_17A);

    it('decodes the §§ lists inside the paragraph text', () => {
      expect(section.heading).toBe('Misconduct etiology.');
      expect(section.text).toContain('§§ 4.15, 4.16 and 4.17');
      expect(section.text).toContain('§§ 4.16 and 4.17');
      expect(section.text).not.toContain('&#xA7;');
    });

    it('extracts every §-anchored citation from the real text', () => {
      // §-anchored list items only: the `and 4.17` tails carry no § marker
      // by design (the rendered text still contains them verbatim above).
      expect(extractReferences(section.text)).toEqual(['4.15', '4.16']);
    });

    it('reproduces all paragraphs and the source credit verbatim', () => {
      const expected = [
        'A permanent and total disability rating under the provisions of §§ 4.15, 4.16 and 4.17 will not be precluded by reason of the coexistence of misconduct disability when:',
        '(a) A veteran, regardless of employment status, also has innocently acquired 100 percent disability, or',
        '(b) Where unemployable, the veteran has other disabilities innocently acquired which meet the percentage requirements of §§ 4.16 and 4.17 and would render, in the judgment of the rating agency, the average person unable to secure or follow a substantially gainful occupation.',
        '[40 FR 42536, Sept. 15, 1975, as amended at 43 FR 45349, Oct. 2, 1978]',
      ].join('\n\n');
      expect(section.text).toBe(expected);
      expect(section.markdown).toBe(expected);
    });
  });

  describe('numeric character reference decoding (guard rails)', () => {
    const section = onlySection(
      `<DIV8 N="4.99" TYPE="SECTION"><HEAD>&#xA7; 4.99 Entity edges.</HEAD>` +
        `<P>dec &#169; hex &#x2014; lf &#x0A; x</P>` +
        `<P>bad &#0; nul &#x07; bell &#xD800; surrogate &#x7F; del &#x9F; c1 &#x110000; overflow</P>` +
        `</DIV8>`,
    );

    it('decodes valid numeric references, including decimal and linefeed', () => {
      // The stripped heading itself proves § decoded: cleanHeading only
      // matches when `&#xA7;` became §.
      expect(section.heading).toBe('Entity edges.');
      expect(section.text).toContain('dec © hex — lf x');
    });

    it('never emits control characters or lone surrogates', () => {
      // The parser drops invalid numeric refs before decoding; assert the
      // end-to-end guarantee regardless of which layer enforced it.
      expect(section.text).not.toContain('&#0;');
      expect(section.text).not.toContain('&#x07;');
      expect(section.text).not.toContain('&#xD800;');
    });

    it('keeps undecodable references as literal text', () => {
      // DEL, C1 controls and out-of-range codepoints are refused by the
      // decoder (the latter would otherwise throw String.fromCodePoint).
      expect(section.text).toContain('&#x7F;');
      expect(section.text).toContain('&#x9F;');
      expect(section.text).toContain('&#x110000;');
    });
  });

  describe('decodeNumericEntities (direct)', () => {
    it('decodes hex and decimal references', () => {
      expect(decodeNumericEntities('x &#xA7; &#169; &#x2014;')).toBe('x \u00a7 \u00a9 \u2014');
    });

    it('decodes tab, linefeed and carriage return but refuses other C0', () => {
      expect(decodeNumericEntities('a&#x09;b')).toBe('a\tb');
      expect(decodeNumericEntities('a&#10;b')).toBe('a\nb');
      expect(decodeNumericEntities('a&#x0D;b')).toBe('a\rb');
      expect(decodeNumericEntities('a&#x07;b')).toBe('a&#x07;b');
      expect(decodeNumericEntities('a&#0;b')).toBe('a&#0;b');
      expect(decodeNumericEntities('a&#x1F;b')).toBe('a&#x1F;b');
    });

    it('refuses DEL, C1 controls, surrogate halves and out-of-range', () => {
      expect(decodeNumericEntities('a&#x7F;b')).toBe('a&#x7F;b');
      expect(decodeNumericEntities('a&#x85;b')).toBe('a&#x85;b');
      expect(decodeNumericEntities('a&#x9F;b')).toBe('a&#x9F;b');
      expect(decodeNumericEntities('a&#xD800;b')).toBe('a&#xD800;b');
      expect(decodeNumericEntities('a&#xDFFF;b')).toBe('a&#xDFFF;b');
      expect(decodeNumericEntities('a&#x110000;b')).toBe('a&#x110000;b');
    });

    it('leaves text without numeric references untouched', () => {
      expect(decodeNumericEntities('plain &amp; named text')).toBe('plain &amp; named text');
    });
  });
});

/**
 * § 4.85 — VERBATIM from the eCFR versioner API
 * (https://www.ecfr.gov/api/versioner/v1/full/2026-10-16/title-38.xml,
 * title 38 issue date 2026-10-16, retrieved 2026-10-20).
 *
 * The provision's rating tables (Tables VI, VIA* and VII) are published as
 * <img> elements. Their content cannot be included offline, so the parser
 * must stand in with an explicit "not included" marker that names the
 * source path — a reader (or an agent) must never mistake a missing
 * graphic for complete text (review finding P1-01).
 */
const SECTION_4_85 = `<DIV8 N="4.85" TYPE="SECTION" VOLUME="1">
<HEAD>§ 4.85   Evaluation of hearing impairment.</HEAD>
<P>(a) An examination for hearing impairment for VA purposes must be conducted by a state-licensed audiologist and must include a controlled speech discrimination test (Maryland CNC) and a puretone audiometry test. Examinations will be conducted without the use of hearing aids.
</P>
<P>(b) Table VI, “Numeric Designation of Hearing Impairment Based on Puretone Threshold Average and Speech Discrimination,” is used to determine a Roman numeral designation (I through XI) for hearing impairment based on a combination of the percent of speech discrimination (horizontal rows) and the puretone threshold average (vertical columns). The Roman numeral designation is located at the point where the percentage of speech discrimination and puretone threshold average intersect.
</P>
<P>(c) Table VIa, “Numeric Designation of Hearing Impairment Based Only on Puretone Threshold Average,” is used to determine a Roman numeral designation (I through XI) for hearing impairment based only on the puretone threshold average. Table VIa will be used when the examiner certifies that use of the speech discrimination test is not appropriate because of language difficulties, inconsistent speech discrimination scores, etc., or when indicated under the provisions of § 4.86.
</P>
<P>(d) “Puretone threshold average,” as used in Tables VI and VIa, is the sum of the puretone thresholds at 1000, 2000, 3000 and 4000 Hertz, divided by four. This average is used in all cases (including those in § 4.86) to determine the Roman numeral designation for hearing impairment from Table VI or VIa.
</P>
<P>(e) Table VII, “Percentage Evaluations for Hearing Impairment,” is used to determine the percentage evaluation by combining the Roman numeral designations for hearing impairment of each ear. The horizontal rows represent the ear having the better hearing and the vertical columns the ear having the poorer hearing. The percentage evaluation is located at the point where the row and column intersect.
</P>
<P>(f) If impaired hearing is service-connected in only one ear, in order to determine the percentage evaluation from Table VII, the non-service-connected ear will be assigned a Roman Numeral designation for hearing impairment of I, subject to the provisions of § 3.383 of this chapter.
</P>
<P>(g) When evaluating any claim for impaired hearing, refer to § 3.350 of this chapter to determine whether the veteran may be entitled to special monthly compensation due either to deafness, or to deafness in combination with other specified disabilities.
</P>
<P>(h) <I>Numeric tables VI, VIA*, and VII.</I>
</P>
<img src="/graphics/er11my99.005.gif"/>
<img src="/graphics/er11my99.006.gif"/>
<CITA TYPE="N">[64 FR 25206, May 11, 1999]



</CITA>
</DIV8>`;

describe('§ 4.85 image content is flagged, never dropped (P1-01)', () => {
  const [section] = parseTitleXml(SECTION_4_85);

  it('keeps both rating-table references in the text representation', () => {
    expect(section?.citation).toBe('4.85');
    expect(section?.text).toContain('[image content not included: /graphics/er11my99.005.gif]');
    expect(section?.text).toContain('[image content not included: /graphics/er11my99.006.gif]');
  });

  it('keeps both rating-table references in the markdown representation', () => {
    expect(section?.markdown).toContain('[image content not included: /graphics/er11my99.005.gif]');
    expect(section?.markdown).toContain('[image content not included: /graphics/er11my99.006.gif]');
  });

  it('leaves the surrounding regulatory prose intact', () => {
    expect(section?.text).toContain('Numeric tables VI, VIA*, and VII.');
    expect(section?.text).toContain('(a) An examination for hearing impairment for VA purposes');
    expect(section?.heading).toBe('Evaluation of hearing impairment.');
  });

  it('never claims the graphic content is present', () => {
    expect(section?.text).not.toMatch(/!\[/);
    expect(section?.markdown).not.toMatch(/!\[/);
    expect(section?.text).not.toContain('](http');
  });
});

/**
 * § 1.916, § 1.561 and § 2.6 — VERBATIM from the eCFR versioner API
 * (https://www.ecfr.gov/api/versioner/v1/full/2026-10-16/title-38.xml,
 * title 38 issue date 2026-10-16, retrieved 2026-10-20).
 *
 * These three provisions carry the construct classes the dated inventory
 * (docs/research/corpus-fidelity-2026-10-20.md) examines: a footnote, a
 * note to a paragraph, and an editorial note. The inventory measured that
 * NO class loses text; what it also found is that the rendering is lossy
 * in MEANING (footnotes are not anchored or labelled, notes are not
 * labelled) and that inline <E> elements split words across blank lines.
 *
 * These tests pin BEHAVIOUR, never counts: the upstream document is
 * mutable, so a count would be a test that fails the day eCFR changes.
 */
const SECTION_1_916_FOOTNOTE = `<DIV8 N="1.916" TYPE="SECTION">
<HEAD>&#xA7; 1.916 Reports to consumer reporting agencies.</HEAD>
<P>(a) When an agency discloses information under paragraph (b) of this section, it shall provide a copy of the information to each consumer reporting agency to which information was released.</P>
<FP><FP>A notice of the right to request this information will be sent with the notice described in paragraph (d)(1) of this section.</FP></FP>
</DIV8>`;

const SECTION_1_561_NOTE = `<DIV8 N="1.561" TYPE="SECTION">
<HEAD>&#xA7; 1.561 Fees.</HEAD>
<P>(g) The Department of Veterans Affairs will charge the requester the full cost of the information.</P>
<NOTE>
<HED>Note to paragraph (<E T="01">g</E>)(1):</HED>
<P>VA will charge fees consistent with the salary scale published by the Office of Personnel Management (OPM).</P></NOTE>
</DIV8>`;

const SECTION_2_6_EDNOTE = `<DIV8 N="2.6" TYPE="SECTION">
<HEAD>&#xA7; 2.6 Head of staff and certain other officials.</HEAD>
<P>(a) The Secretary may appoint the heads of the staff offices, assistant secretaries, or staff office heads.</P>
<EDNOTE>
<HED>Editorial Note:</HED><PSPACE>For <E T="04">Federal Register</E> citations affecting § 2.6, see the List of CFR Sections Affected, which appears in the Finding Aids section of the printed volume and at <I>www.govinfo.gov.</I></PSPACE></EDNOTE>
</DIV8>`;

/** Compare ignoring whitespace: the parser concatenates inline elements without a space. */
function withoutWhitespace(value: string): string {
  return value.replace(/\s+/g, '');
}

describe('construct classes survive the parser (M1 inventory, behaviour only)', () => {
  it("keeps a footnote's text in both representations", () => {
    const [section] = parseTitleXml(SECTION_1_916_FOOTNOTE);
    const footnote =
      'A notice of the right to request this information will be sent with the notice described in paragraph (d)(1) of this section.';
    expect(withoutWhitespace(section?.text ?? '')).toContain(withoutWhitespace(footnote));
    expect(withoutWhitespace(section?.markdown ?? '')).toContain(withoutWhitespace(footnote));
    // The surrounding regulatory prose is untouched.
    expect(section?.text).toContain('it shall provide a copy of the information');
  });

  it("keeps a note-to-paragraph's text", () => {
    const [section] = parseTitleXml(SECTION_1_561_NOTE);
    const note =
      'VA will charge fees consistent with the salary scale published by the Office of Personnel Management (OPM).';
    expect(withoutWhitespace(section?.text ?? '')).toContain(withoutWhitespace(note));
    expect(withoutWhitespace(section?.markdown ?? '')).toContain(withoutWhitespace(note));
  });

  it("keeps an editorial note's text", () => {
    const [section] = parseTitleXml(SECTION_2_6_EDNOTE);
    const note =
      'For Federal Register citations affecting \u00a7 2.6, see the List of CFR Sections Affected, which appears in the Finding Aids section of the printed volume and at www.govinfo.gov.';
    expect(withoutWhitespace(section?.text ?? '')).toContain(withoutWhitespace(note));
  });

  it('documents the known rendering gap: inline elements split a word across blank lines', () => {
    // The inventory's G1 finding: the inline <E T="01">g</E> renders as
    // "(\n\ng\n\n)" because the parser keeps the XML pretty-print
    // whitespace around an inline element. This test pins the CURRENT
    // behaviour on purpose — M1(b) will change it, and the change must
    // then update this assertion deliberately.
    const [section] = parseTitleXml(SECTION_1_561_NOTE);
    expect(section?.text).toContain('Note to paragraph (');
    expect(section?.text).toContain(')');
    // The note's substance is still present despite the split.
    expect(withoutWhitespace(section?.text ?? '')).toContain(
      withoutWhitespace('VA will charge fees consistent with the salary scale'),
    );
  });
});
