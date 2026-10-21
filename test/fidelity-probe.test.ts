import { describe, expect, it } from 'vitest';

/**
 * The corpus fidelity probe's element patterns must match the EXACT element
 * name — this file pins that, because getting it wrong produces a
 * measurement artifact that reads exactly like lost content.
 *
 * A word boundary after the tag name is NOT exact: a hyphen is a non-word
 * character, so `\b` sits between "FP" and the "-" of "<FP-1>" and the
 * pattern matches the LIST ITEM. The capture then runs from the list item to
 * the next `</FP>` close tag — a span that exists nowhere in the rendered
 * output — so the provision is reported as `lost` even though its footnote
 * text is present verbatim. That is how the 2026-10-20 inventory came to
 * claim that four provisions "LOSE their footnote text" (a measurement bug,
 * not a product defect; see docs/research/corpus-fidelity-2026-10-20.md).
 */

interface ProbeModule {
  ELEMENT_PATTERNS: Record<string, RegExp>;
  elementText: (block: string, tag: string) => string[];
}

// The probe is a plain .mjs tool with no type declarations, and this
// repository type-checks its tests. The specifier is therefore held in a
// variable: TypeScript then resolves nothing (so it does not demand
// declarations for the tool) and the tool's shape is stated by the
// interface above instead. Do NOT inline this back into a literal import.
const PROBE_SPECIFIER = '../tools/corpus-fidelity-probe.mjs';
const probe = (await import(PROBE_SPECIFIER)) as ProbeModule;
const { ELEMENT_PATTERNS, elementText } = probe;

describe('corpus fidelity probe element patterns', () => {
  it('matches the exact tag, with and without attributes', () => {
    expect(elementText('<FP>Note text.</FP>', 'FP')).toEqual(['Note text.']);
    expect(elementText('<FP N="1">Note text.</FP>', 'FP')).toEqual(['Note text.']);
    expect(elementText('<NOTE N="1">Note text.</NOTE>', 'NOTE')).toEqual(['Note text.']);
  });

  it('does NOT match the hyphenated sibling <FP-1>', () => {
    expect(elementText('<FP-1>Under Secretary for Benefits</FP-1>', 'FP')).toEqual([]);
    expect(elementText('<FP-2>[70 FR 29616, June 12, 2005]</FP-2>', 'FP')).toEqual([]);
  });

  it('does not let a <FP-1> list item swallow the fragment span', () => {
    // The real shape of a signature block: one <FP> plus its <FP-1> list
    // items. The fragment must be the <FP> text alone — never a span that
    // runs across the list items, because such a span is in no output.
    const block =
      '<FP>The authority hereby delegated to employees of the positions ' +
      'designated in this paragraph may be redelegated.</FP>' +
      '<FP-1>Under Secretary for Benefits</FP-1>' +
      '<FP-1>Executive Director, Loan Guaranty Service</FP-1>';
    expect(elementText(block, 'FP')).toEqual([
      'The authority hereby delegated to employees of the positions designated in this paragraph may be redelegated.',
    ]);
  });

  it('extracts every <FP> and none of the list items from a mixed block', () => {
    const block =
      '<FP>First footnote.</FP><FP-1>Item one.</FP-1>' +
      '<FP>Second footnote.</FP><FP-2>Item two.</FP-2>';
    expect(elementText(block, 'FP')).toEqual(['First footnote.', 'Second footnote.']);
  });

  it('keeps every class pattern exact-tag', () => {
    for (const [tag, pattern] of Object.entries(ELEMENT_PATTERNS)) {
      const sibling = `<${tag}-1>sibling text</${tag}-1>`;
      pattern.lastIndex = 0;
      expect(pattern.test(sibling), `${tag} must not match <${tag}-1>`).toBe(false);
      pattern.lastIndex = 0;
      expect(pattern.test(`<${tag}>exact</${tag}>`), `${tag} must match <${tag}>`).toBe(true);
      pattern.lastIndex = 0;
      expect(pattern.test(`<${tag} N="1">exact</${tag}>`), `${tag} must match <${tag} …>`).toBe(
        true,
      );
    }
  });

  it('covers every construct class the probe inventories', () => {
    expect(Object.keys(ELEMENT_PATTERNS)).toEqual([
      'FP',
      'NOTE',
      'EDNOTE',
      'HD2',
      'EXTRACT',
      'CITA',
      'SECAUTH',
      'TFOOT',
    ]);
  });
});
