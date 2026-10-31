/**
 * The eCFR permalinks this service hands out.
 *
 * WHY THIS FILE EXISTS. CR-16 found the same URL shapes written twice — once
 * in `src/core/service.ts` and once in `src/core/historical.ts` — with
 * different variable names for the same thing. The permalink form is a
 * user-visible contract (`docs/SPEC.md` §6 promises `sourceUrlAtIndexDate` /
 * `sourceUrlAtRequestedDate`), so changing it takes two edits, and missing
 * one silently ships a different URL on one surface.
 *
 * The shapes live here now, once. Both callers use them.
 */

/** The kind of provision a permalink points at. */
export type PermalinkKind = 'section' | 'appendix';

/** The URL segment eCFR uses for each kind. */
function kindSegment(kind: PermalinkKind): string {
  return kind === 'appendix' ? 'appendix' : 'section';
}

/**
 * The permalink to the CURRENT text of a provision.
 *
 * An appendix has no stable anchor on eCFR's site, so it links to the
 * site's search for the appendix name; a section links to its own page.
 */
export function sourceUrlFor(citation: string, kind: PermalinkKind): string {
  const encoded = encodeURIComponent(citation);
  if (kind === 'appendix') {
    return `https://www.ecfr.gov/search?searchTerm=${encoded}&titles=38`;
  }
  return `https://www.ecfr.gov/current/title-38/section-${encoded}`;
}

/**
 * The permalink to a provision as it stood at a given issue date.
 *
 * eCFR serves every issue date of Title 38 under `/on/<date>/title-38/…`, so
 * this shape is the same for both kinds.
 */
export function datedSourceUrlFor(
  citation: string,
  kind: PermalinkKind,
  issueDate: string,
): string {
  const encoded = encodeURIComponent(citation);
  return `https://www.ecfr.gov/on/${issueDate}/title-38/${kindSegment(kind)}-${encoded}`;
}
