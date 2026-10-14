/** A normalized citation that can be looked up in the local index. */
export type ParsedCitation =
  | { readonly kind: 'section'; readonly citation: string }
  | { readonly kind: 'appendix'; readonly citation: string };

/** `4.125`, `4.124a`, `17.103` … (section numbers within a part). */
const SECTION_RE = /^\d{1,3}\.\d{1,4}[a-z]{0,3}$/i;
const MAX_CITATION_LENGTH = 120;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Parse user-supplied citation text into a canonical lookup key.
 *
 * Accepts bare citations (`4.125`), `§`-prefixed forms (`§ 4.125`), full
 * citations (`38 CFR 4.125`), and appendix names (`Appendix A to Part 4`).
 *
 * @returns `null` when the input is not a recognizable citation.
 */
export function normalizeCitation(input: string): ParsedCitation | null {
  const trimmed = collapseWhitespace(input);
  if (trimmed.length === 0 || trimmed.length > MAX_CITATION_LENGTH) return null;

  if (/^appendix\b/i.test(trimmed)) return { kind: 'appendix', citation: trimmed };

  // Two flat patterns instead of one nested-quantifier pattern: identical
  // behavior, and linear-time for ReDoS checkers (eslint-plugin-security).
  const withoutTitle = trimmed.replace(/^38\s+cfr\.?\s*/i, '').replace(/^cfr\.?\s*/i, '');
  const withoutSection = withoutTitle.replace(/^§\s*/, '');
  const candidate = withoutSection.replace(/\.$/, '').trim();
  if (!SECTION_RE.test(candidate)) return null;
  return { kind: 'section', citation: candidate.toLowerCase() };
}
