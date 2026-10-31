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
 * citations (`38 CFR 4.125`, `38 C.F.R. § 4.125` — the dotted legal form
 * the product itself emits), and appendix names (`Appendix A to Part 4`).
 *
 * @returns `null` when the input is not a recognizable citation.
 */
export function normalizeCitation(input: string): ParsedCitation | null {
  const trimmed = collapseWhitespace(input);
  if (trimmed.length === 0 || trimmed.length > MAX_CITATION_LENGTH) return null;

  if (/^appendix\b/i.test(trimmed)) return { kind: 'appendix', citation: trimmed };

  // Two flat patterns instead of one nested-quantifier pattern: identical
  // behavior, and linear-time for ReDoS checkers (eslint-plugin-security).
  //
  // The dotted form matters: `displayCitation` emits `38 C.F.R. § 4.130`
  // (the paste-ready legal form), so the parser must accept exactly what
  // the product hands the user — otherwise copying a citation the tool
  // printed back into the tool yields "invalid input" (review finding
  // P1-03). The optional dots are per letter and flat, so no ReDoS shape.
  const withoutTitle = trimmed
    .replace(/^38\s+c\.?f\.?r\.?\s*/i, '')
    .replace(/^c\.?f\.?r\.?\s*/i, '');
  const withoutSection = withoutTitle.replace(/^§\s*/, '');
  const candidate = withoutSection.replace(/\.$/, '').trim();
  if (!SECTION_RE.test(candidate)) return null;
  return { kind: 'section', citation: candidate.toLowerCase() };
}

/**
 * The one provision in a parsed document that a citation names.
 *
 * CR-17 found two functions named `findProvision` with the same intent and
 * DIFFERENT matching rules: the point-in-time read folded both sides to
 * lower case, while the redline folded both sides for an appendix but
 * compared a section against `target.citation` alone — relying on an
 * invariant (`normalizeCitation` already lower-cases) that is invisible at
 * the call site and easy to break. A future change to one would not have
 * reached the other.
 *
 * The rule now lives in one place:
 *
 * - both sides are compared case-INSENSITIVELY. The corpus stores section
 *   citations lower-cased (`4.124A` is `4.124a`), and the store is this
 *   repo's citation-identity authority — `Store.getSection` resolves
 *   appendix citations with COLLATE NOCASE, so 'appendix a to part 4' hits
 *   the same row 'Appendix A to Part 4' does;
 * - the kind must match exactly.
 *
 * The REPORTED citation stays the row's verbatim XML `N` (the corpus form);
 * only the MATCH folds case.
 *
 * @param sections The provisions parsed from a document.
 * @param kind The kind of provision wanted.
 * @param citation The citation wanted, in any case.
 * @returns The matching provision, or `undefined` when there is none.
 */
export function findProvision<T extends { readonly kind: string; readonly citation: string }>(
  sections: readonly T[],
  kind: 'section' | 'appendix',
  citation: string,
): T | undefined {
  const wanted = citation.toLowerCase();
  return sections.find(
    (section) => section.kind === kind && section.citation.toLowerCase() === wanted,
  );
}
