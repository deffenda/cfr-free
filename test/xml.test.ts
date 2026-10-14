import { describe, expect, it } from 'vitest';
import { parseTitleXml, XmlFormatError } from '../src/core/xml.js';

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ECFR>
<DIV1 N="38" TYPE="TITLE"><HEAD>Title 38—Pensions, Bonuses, and Veterans' Relief</HEAD>
<DIV3 N="I" TYPE="CHAPTER"><HEAD> CHAPTER I—DEPARTMENT OF VETERANS AFFAIRS</HEAD>
<DIV5 N="4" TYPE="PART"><HEAD>PART 4—Schedule for Rating Disabilities</HEAD>
<DIV6 N="B" TYPE="SUBPART"><HEAD>SUBPART B—Mental Disorders</HEAD>
<DIV7 N="ECFRfa1" TYPE="SUBJGRP"><HEAD>Diagnoses of Mental Disorders</HEAD>
<DIV8 N="4.125" TYPE="SECTION">
<HEAD>§ 4.125 Diagnosis of mental disorders.</HEAD>
<P>(a) If the diagnosis of a mental disorder does not conform to DSM-5 <E T="04">or is not supported</E> by the findings, the rating agency shall return the report.</P>
<P>(b) Second paragraph with an entity: A &amp; B.</P>
<SECAUTH TYPE="N">(Authority: 38 U.S.C. 1155)</SECAUTH>
<CITA TYPE="N">[61 FR 52700, Oct. 8, 1996]</CITA>
<TABLE><THEAD><TR><TH>Rating</TH><TH>Description</TH></TR></THEAD><TBODY><TR><TD>10</TD><TD>Mild | transient</TD></TR></TBODY></TABLE>
</DIV8>
</DIV7>
</DIV6>
<DIV9 N="Appendix A to Part 4" TYPE="APPENDIX"><HEAD>Appendix A to Part 4—Table of Amendments and Effective Dates Since 1946.</HEAD><P>Appendix body.</P></DIV9>
</DIV5>
</DIV3>
</DIV1>
</ECFR>`;

describe('parseTitleXml', () => {
  const sections = parseTitleXml(FIXTURE_XML);

  it('extracts sections and appendices', () => {
    expect(sections).toHaveLength(2);
    expect(sections[0]?.citation).toBe('4.125');
    expect(sections[0]?.kind).toBe('section');
    expect(sections[1]?.citation).toBe('Appendix A to Part 4');
    expect(sections[1]?.kind).toBe('appendix');
  });

  it('cleans headings for both kinds', () => {
    expect(sections[0]?.heading).toBe('Diagnosis of mental disorders.');
    expect(sections[1]?.heading).toBe('Table of Amendments and Effective Dates Since 1946.');
  });

  it('records the hierarchy fields and path', () => {
    const section = sections[0];
    expect(section?.chapter).toBe('I');
    expect(section?.part).toBe('4');
    expect(section?.subpart).toBe('B');
    expect(section?.subjectGroup).toBe('ECFRfa1');
    expect(section?.path).toBe('/title:38/chapter:I/part:4/subpart:B/subject_group:ECFRfa1');
    expect(sections[1]?.part).toBe('4');
  });

  it('renders paragraphs, authority and source credits as plain text', () => {
    const text = sections[0]?.text ?? '';
    expect(text).toContain(
      'If the diagnosis of a mental disorder does not conform to DSM-5 or is not supported',
    );
    expect(text).toContain('A & B');
    expect(text).toContain('(Authority: 38 U.S.C. 1155)');
    expect(text).toContain('[61 FR 52700, Oct. 8, 1996]');
    expect(text).not.toContain('<');
  });

  it('renders tables as markdown pipe tables with escaped pipes', () => {
    const markdown = sections[0]?.markdown ?? '';
    expect(markdown).toContain('| Rating | Description |');
    expect(markdown).toContain('| --- | --- |');
    expect(markdown).toContain('| 10 | Mild \\| transient |');
  });

  it('produces a plain-text variant of tables for indexing', () => {
    expect(sections[0]?.text).toContain('10 | Mild | transient');
  });

  it('rejects DOCTYPE payloads', () => {
    const malicious = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><ECFR></ECFR>';
    expect(() => parseTitleXml(malicious)).toThrow(XmlFormatError);
    expect(() => parseTitleXml(malicious)).toThrow(/DOCTYPE/);
  });

  it('rejects sections without an N attribute', () => {
    const broken = '<DIV8 TYPE="SECTION"><HEAD>§ 1.1 x</HEAD><P>body</P></DIV8>';
    expect(() => parseTitleXml(broken)).toThrow(/without N attribute/);
  });

  it('rejects sections larger than the size cap', () => {
    const huge = `<DIV8 N="1.1" TYPE="SECTION"><HEAD>§ 1.1 big</HEAD><P>${'a'.repeat(400_001)}</P></DIV8>`;
    expect(() => parseTitleXml(huge)).toThrow(/exceeds/);
  });

  it('returns an empty list for documents without sections', () => {
    expect(parseTitleXml('<ECFR></ECFR>')).toEqual([]);
  });

  it('handles sub-headings, nested unknown containers and table captions', () => {
    const xml = `<DIV8 N="1.2" TYPE="SECTION"><HEAD>§ 1.2 Powers.</HEAD>
<HEAD>Introduction paragraph.</HEAD>
<AUTH><HED>Authority:</HED><PSPACE>5 U.S.C. 301.</PSPACE></AUTH>
<P>Body paragraph.</P>
<TABLE><CAPTION>Table 1 — Notice</CAPTION><TR><TD>only-row</TD></TR></TABLE>
<FP>Flush paragraph at the end.</FP>
</DIV8>`;
    const [section] = parseTitleXml(xml);
    expect(section?.heading).toBe('Powers.');
    expect(section?.markdown).toContain('### Introduction paragraph.');
    expect(section?.text).toContain('Authority:');
    expect(section?.text).toContain('5 U.S.C. 301.');
    expect(section?.text).toContain('Body paragraph.');
    expect(section?.markdown).toContain('| only-row |');
    expect(section?.text).toContain('Flush paragraph at the end.');
    expect(section?.markdown).not.toContain('Table 1');
  });

  it('normalizes messy whitespace into clean text', () => {
    const xml =
      '<DIV8 N="1.3" TYPE="SECTION"><HEAD>§ 1.3  Messy   heading.</HEAD><P>\n   spaced    out   \n</P></DIV8>';
    const [section] = parseTitleXml(xml);
    expect(section?.heading).toBe('Messy heading.');
    expect(section?.text).toBe('spaced out');
  });

  it('keeps headings that do not match the citation prefix', () => {
    const xml =
      '<DIV9 N="Appendix Q" TYPE="APPENDIX"><HEAD>Renamed appendix without dash.</HEAD><P>x</P></DIV9>';
    const [appendix] = parseTitleXml(xml);
    expect(appendix?.kind).toBe('appendix');
    expect(appendix?.heading).toBe('Renamed appendix without dash.');
  });

  it('renders loose text sitting directly in a section element', () => {
    const xml =
      '<DIV8 N="1.4" TYPE="SECTION"><HEAD>§ 1.4 Loose.</HEAD>Direct loose text.<P>Paragraph.</P></DIV8>';
    const [section] = parseTitleXml(xml);
    expect(section?.text).toContain('Direct loose text.');
    expect(section?.text).toContain('Paragraph.');
  });
});
