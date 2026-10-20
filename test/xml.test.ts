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

  it('rejects ENTITY declarations independently of the DOCTYPE gate', () => {
    const smuggled =
      '<ECFR><!ENTITY lol "lol"><DIV8 N="1.9" TYPE="SECTION"><HEAD>§ 1.9 x</HEAD></DIV8></ECFR>';
    expect(() => parseTitleXml(smuggled)).toThrow(XmlFormatError);
    expect(() => parseTitleXml(smuggled)).toThrow(/ENTITY/);
  });

  it('rejects section content nested past the depth cap', () => {
    const inner = `${'<DIV N="n" TYPE="DIV9">'.repeat(70)}<P>deep</P>${'</DIV>'.repeat(70)}`;
    const xml = `<DIV8 N="1.8" TYPE="SECTION"><HEAD>§ 1.8 deep.</HEAD>${inner}</DIV8>`;
    expect(() => parseTitleXml(xml)).toThrow(/nesting exceeds 64 levels/);
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

  it('keeps section headings that lack the section-sign prefix', () => {
    const xml =
      '<DIV8 N="1.5" TYPE="SECTION"><HEAD>Caption without citation.</HEAD><P>x</P></DIV8>';
    const [section] = parseTitleXml(xml);
    expect(section?.heading).toBe('Caption without citation.');
  });

  it('reports malformed XML as a parse failure', () => {
    expect(() => parseTitleXml('<ECFR><DIV1')).toThrow(/XML parse failed/);
  });

  it('ignores stray text sitting directly inside a table body', () => {
    const xml =
      '<DIV8 N="1.6" TYPE="SECTION"><HEAD>§ 1.6 table.</HEAD><TABLE><TBODY>noise<TR><TD>1</TD></TR></TABLE></DIV8>';
    const [section] = parseTitleXml(xml);
    expect(section?.markdown).toContain('| 1 |');
  });

  it('renders a table without rows as empty', () => {
    const xml =
      '<DIV8 N="1.7" TYPE="SECTION"><HEAD>§ 1.7 table.</HEAD><TABLE><CAPTION>none</CAPTION></TABLE></DIV8>';
    const [section] = parseTitleXml(xml);
    expect(section?.markdown).not.toContain('|');
    expect(section?.text).not.toContain('|');
  });

  it('keeps an appendix heading that is exactly its citation', () => {
    const xml = '<DIV9 N="Appendix Q" TYPE="APPENDIX"><HEAD>Appendix Q</HEAD><P>x</P></DIV9>';
    const [appendix] = parseTitleXml(xml);
    expect(appendix?.kind).toBe('appendix');
    expect(appendix?.heading).toBe('Appendix Q');
  });

  it('rejects division nesting deeper than the walk cap', () => {
    const xml = `${'<DIV9 N="n" TYPE="OTHER">'.repeat(70)}${'</DIV9>'.repeat(70)}`;
    expect(() => parseTitleXml(xml)).toThrow(/nesting exceeds 64 levels/);
  });

  it('parses divisions without an N attribute as empty stack ids', () => {
    const xml =
      '<DIV3 TYPE="CHAPTER"><DIV5 N="4" TYPE="PART"><DIV8 N="1.9" TYPE="SECTION"><HEAD>§ 1.9 x.</HEAD><P>b</P></DIV8></DIV5></DIV3>';
    const [section] = parseTitleXml(xml);
    expect(section?.chapter).toBeNull();
    expect(section?.citation).toBe('1.9');
  });
});

/**
 * Image content markers (review finding P1-01).
 *
 * eCFR carries rating tables as <img> elements. The parser cannot include
 * their content offline, so it must never drop them silently: an explicit
 * "not included" marker stands in, carrying the vetted source path.
 */
describe('image content markers (P1-01)', () => {
  const IMAGE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ECFR>
<DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD>
<DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD>
<DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD>
<DIV8 N="4.85" TYPE="SECTION">
<HEAD>&#xA7; 4.85 Evaluation of hearing impairment.</HEAD>
<P>(a) An examination for hearing impairment must include a controlled speech discrimination test.
</P>
<P>(b) Table VI is used to determine a Roman numeral designation.
</P>
<img src="/graphics/er11my99.005.gif"/>
<img src="/graphics/er11my99.006.gif"/>
</DIV8>
<DIV8 N="4.99" TYPE="SECTION">
<HEAD>&#xA7; 4.99 Inline image.</HEAD>
<P>Before <img src="/graphics/er25se06.021.gif"/> after the image.</P>
<P>Nested <EXTRACT>inside <img src="/graphics/ec04no91.000.gif"/> a container</EXTRACT>.</P>
</DIV8>
</DIV5>
</DIV3>
</DIV1>
</ECFR>`;

  const sections = parseTitleXml(IMAGE_XML);
  const hearing = sections.find((section) => section.citation === '4.85');
  const inline = sections.find((section) => section.citation === '4.99');

  it('emits an explicit not-included marker for block-level images', () => {
    expect(hearing?.text).toContain('[image content not included: /graphics/er11my99.005.gif]');
    expect(hearing?.text).toContain('[image content not included: /graphics/er11my99.006.gif]');
    expect(hearing?.markdown).toContain('[image content not included: /graphics/er11my99.005.gif]');
  });

  it('keeps the marker in place, without disturbing prose order', () => {
    const text = hearing?.text ?? '';
    expect(text.indexOf('must include a controlled speech discrimination test')).toBeLessThan(
      text.indexOf('[image content not included: /graphics/er11my99.005.gif]'),
    );
    expect(text.indexOf('[image content not included: /graphics/er11my99.005.gif]')).toBeLessThan(
      text.indexOf('[image content not included: /graphics/er11my99.006.gif]'),
    );
  });

  it('captures images nested inside paragraphs and containers', () => {
    expect(inline?.text).toContain('[image content not included: /graphics/er25se06.021.gif]');
    expect(inline?.text).toContain('[image content not included: /graphics/ec04no91.000.gif]');
    expect(inline?.text).toContain('Before');
    expect(inline?.text).toContain('after the image.');
  });

  it('never names an unvetted image source', () => {
    const hostile = [
      'http://evil.example/x.gif',
      'https://evil.example/x.gif',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      '//evil.example/x.gif',
      '/other/path.gif',
      '/graphics/../../etc/passwd',
      '/graphics/',
    ];
    for (const src of hostile) {
      const xml = `<ECFR><DIV8 N="1.1" TYPE="SECTION"><HEAD>x</HEAD><P>t <img src="${src}"/></P></DIV8></ECFR>`;
      const [section] = parseTitleXml(xml);
      expect(section?.text).toContain('[image content not included: unrecognized image source]');
      expect(section?.text).not.toContain(src);
      expect(section?.text).not.toContain('javascript:');
      expect(section?.text).not.toContain('data:');
    }
  });

  it('marks an image with no source at all', () => {
    const xml = '<ECFR><DIV8 N="1.1" TYPE="SECTION"><HEAD>x</HEAD><P>t <img/></P></DIV8></ECFR>';
    const [section] = parseTitleXml(xml);
    expect(section?.text).toContain('[image content not included: unrecognized image source]');
  });

  it('leaves provisions without images byte-identical', () => {
    // The pre-existing fixture (no images) must render exactly as before:
    // no marker, no whitespace drift, no changed prose.
    const [plain] = parseTitleXml(FIXTURE_XML);
    expect(plain?.text).not.toContain('image content not included');
    expect(plain?.markdown).not.toContain('image content not included');
    expect(plain?.text).toContain('(a) If the diagnosis of a mental disorder');
    expect(plain?.markdown).toContain('| Rating | Description |');
  });
  it('refuses an over-long image source (no index bloat)', () => {
    const long = '/graphics/' + 'a'.repeat(1000) + '.gif';
    const xml = `<ECFR><DIV8 N="1.1" TYPE="SECTION"><HEAD>x</HEAD><P>t <img src="${long}"/></P></DIV8></ECFR>`;
    const [section] = parseTitleXml(xml);
    expect(section?.text).toContain('[image content not included: unrecognized image source]');
    expect(section?.text).not.toContain(long);
  });

  it('captures an image that is a direct child of a table', () => {
    const xml =
      '<ECFR><DIV8 N="1.1" TYPE="SECTION"><HEAD>x</HEAD>' +
      '<TABLE><THEAD><TR><TH>Rating</TH></TR></THEAD><TBODY>' +
      '<img src="/graphics/er11my99.005.gif"/>' +
      '<TR><TD>10</TD></TR></TBODY></TABLE></DIV8></ECFR>';
    const [section] = parseTitleXml(xml);
    expect(section?.text).toContain('[image content not included: /graphics/er11my99.005.gif]');
    expect(section?.markdown).toContain('[image content not included: /graphics/er11my99.005.gif]');
    // The table's own rows are still rendered.
    expect(section?.text).toContain('Rating');
    expect(section?.text).toContain('10');
  });

  it('captures an image inside a table cell', () => {
    const xml =
      '<ECFR><DIV8 N="1.1" TYPE="SECTION"><HEAD>x</HEAD>' +
      '<TABLE><TBODY><TR><TD>see <img src="/graphics/er11my99.005.gif"/></TD></TR></TBODY>' +
      '</TABLE></DIV8></ECFR>';
    const [section] = parseTitleXml(xml);
    expect(section?.text).toContain('[image content not included: /graphics/er11my99.005.gif]');
  });

  it('keeps an image marker out of the heading', () => {
    const xml =
      '<ECFR><DIV8 N="1.1" TYPE="SECTION"><HEAD>§ 1.1 <img src="/graphics/x.gif"/> Title.</HEAD>' +
      '<P>body</P></DIV8></ECFR>';
    const [section] = parseTitleXml(xml);
    expect(section?.heading).toBe('Title.');
    expect(section?.heading).not.toContain('image content not included');
  });
});
