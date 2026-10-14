/**
 * Cross-reference extraction: Title 38 sections cite each other heavily
 * (`see § 4.105`, `§§ 4.105, 4.106`, `38 CFR 4.130`). Claims reasoning
 * routinely ping-pongs across those links (rating criteria ↔ adjudication
 * rules ↔ definitions); surfacing the referenced citations on a section read
 * saves adjudicators manual grep work. Two flat patterns — identical
 * behavior to one nested pattern, and linear-time for ReDoS checkers.
 */

const REFERENCE_CAP = 50;
const SECTION_ITEM = String.raw`\d{1,3}\.\d{1,4}[a-z]{0,3}`;
/** Section-shaped token; also the membership test for captured items. */
const ITEM_RE = new RegExp(`^${SECTION_ITEM}$`, 'i');
/** `§ 4.105` and comma lists `§§ 4.105, 4.106` (each item re-validated). */
const SECTION_SIGN_RE = new RegExp(
  String.raw`§§?\s*(${SECTION_ITEM}(?:\s*,\s*${SECTION_ITEM})*)`,
  'gi',
);
/** Inline `38 CFR 4.130`, `38 C.F.R. § 4.130`. */
const INLINE_CFR_RE = new RegExp(String.raw`\b38\s+C\.?F\.?R\.?\s*§?\s*(${SECTION_ITEM})`, 'gi');

/**
 * Extract referenced Title 38 section citations from regulatory text.
 *
 * @returns Deduplicated, lowercased, sorted citations (≤ 50), each safe to
 * hand to a parameterized index lookup.
 */
export function extractReferences(text: string): string[] {
  const found = new Set<string>();
  const capture = (list: string): void => {
    for (const item of list.split(',')) {
      const citation = item.trim();
      if (ITEM_RE.test(citation)) found.add(citation.toLowerCase());
      if (found.size >= REFERENCE_CAP) return;
    }
  };
  for (const pattern of [SECTION_SIGN_RE, INLINE_CFR_RE]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1] !== undefined) capture(match[1]);
      if (found.size >= REFERENCE_CAP) break;
    }
  }
  return [...found].sort();
}
