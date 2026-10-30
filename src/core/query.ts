/**
 * The query language: how a reader's words become an FTS5 match, and how a
 * hit is judged to have answered.
 *
 * WHY THIS FILE EXISTS. CR-32 found `store.ts` carrying two independently
 * evolvable concerns. Between the SQL constants and the `Store` class sat a
 * self-contained query interpreter — the tokenizer, the curated synonym
 * table, the FTS5 fragment builder, the stopword list, the "did this hit
 * answer the question" rules — with no SQLite dependency at all.
 *
 * Every function here was small, documented and single-purpose, which is
 * exactly why the overload went unnoticed: CR-15 could arise (the FTS query
 * built on two paths) without anything flagging it. The rules now have
 * their own home, and — the point of the move — they are unit-testable
 * without opening a database.
 *
 * Nothing here imports SQLite, and nothing here imports `store.ts`.
 */

/** FTS5 caps the number of terms we emit per query (bounded wildcards). */
export const MAX_TERMS = 12;

/** How the query terms combine: any of them, or all of them. */
export type MatchMode = 'and' | 'or';

/**
 * Curated VA claims-language → regulatory-phrase expansions (one direction:
 * acronym → phrase). Queries written in rating-office shorthand ("ptsd",
 * "TDIU", "SMC") match text that only spells the concept out, while the
 * primary prefix term still catches text that uses the acronym itself.
 * Kept deliberately small: every entry is unambiguous in Title 38 context.
 */
const SYNONYM_PHRASES: Readonly<Record<string, string | readonly string[]>> = {
  // The corpus spells some concepts two ways; each expansion lists every
  // spelling that actually occurs, so the expansion reaches the sections
  // that use it. Counts are measured against the 2026-10-16 corpus.
  ptsd: ['posttraumatic stress', 'post-traumatic stress'],
  tbi: 'traumatic brain injury',
  tdiu: 'individual unemployability',
  smc: 'special monthly compensation',
  // "dependency and indemnity compensation" (98 sections) — the previous
  // form omitted the "and" and matched ONE section.
  dic: 'dependency and indemnity compensation',
  mst: 'military sexual trauma',
  hlr: 'high level review',
  // "board of veterans' appeals" (75 sections) — the previous form omitted
  // the apostrophe and matched SEVEN.
  bva: "board of veterans' appeals",
  nsc: 'non service connected',
  // The corpus says "hearing impairment" (14 sections, including § 4.85
  // "Evaluation of hearing impairment"); clients say "hearing loss" (3
  // sections use that form). Both forms stay searchable: the expansion
  // adds the corpus's phrasing beside the client's.
  hearing: 'hearing impairment',
};

/**
 * Abbreviations whose letters are separated by punctuation, so the TOKENIZER
 * never produces a usable token for them: "A&A" becomes two single
 * letters, which are dropped — the query degenerates and the search
 * returns noise. These are matched against the RAW query before
 * tokenizing, and expand to a phrase the corpus actually uses
 * ("aid and attendance" appears in 31 sections).
 */
const RAW_PHRASE_EXPANSIONS: Readonly<Record<string, string>> = {
  'a&a': 'aid and attendance',
  'c&c': 'care and attendance',
};

/** How a query term was read. */
export type QueryTermKind = 'token' | 'phrase' | 'substitution';

/**
 * One interpreted term of a query: what the client wrote, and what the
 * corpus calls it.
 *
 * The interpretation lives in ONE place because two consumers must agree on
 * it: the FTS query builder and the response's term diagnostics. If they
 * read a query differently, the service can report a term as "not found"
 * that the search actually searched for.
 */
export interface QueryTerm {
  /** The term as the client wrote it, lowercased. */
  readonly term: string;
  /** The words the term contributes to the FTS query. */
  readonly words: readonly string[];
  /** The corpus phrases the term stands for (empty when it stands for itself). */
  readonly expansions: readonly string[];
  /** How the term was read: a bare token, a quoted span, a punctuated abbreviation. */
  readonly kind: QueryTermKind;
}

/** True for a letter or a digit — the characters that make up a word. */
export function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/** The words of a corpus phrase ("special monthly compensation" → 3 words). */
export function phraseWords(phrase: string): string[] {
  return phrase.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
}

/** Replace punctuated abbreviations inside a quoted span with their phrases. */
export function expandAbbreviationsIn(text: string): string {
  let out = text;
  for (const [abbreviation, phrase] of Object.entries(RAW_PHRASE_EXPANSIONS)) {
    out = out.split(abbreviation).join(phrase);
  }
  return out;
}

/**
 * Read a query into terms, once.
 *
 * - A quoted span is one term, verbatim: `"special monthly compensation"`.
 * - A punctuated abbreviation ("A&A") is one term standing for its corpus
 *   phrase — the tokenizer would drop "A&A" to two single letters. Only a
 *   STANDALONE abbreviation counts: "VA&A" is a different word.
 * - Every other word is a token, expanded through the curated synonym map
 *   when the corpus spells the concept differently.
 *
 * Spans (quoted or substituted) come first, then the bare tokens — the
 * order the FTS builder has always emitted them in.
 */
export function queryTerms(raw: string): readonly QueryTerm[] {
  const text = raw.toLowerCase();
  const spanTerms: QueryTerm[] = [];
  let residual = '';
  let last = 0;

  /** Pull the standalone abbreviations out of a plain chunk. */
  const takePlain = (chunk: string): void => {
    const found: Array<{ at: number; length: number; term: QueryTerm }> = [];
    for (const [abbreviation, phrase] of Object.entries(RAW_PHRASE_EXPANSIONS)) {
      let at = chunk.indexOf(abbreviation);
      while (at !== -1) {
        const before = at === 0 ? undefined : chunk[at - 1];
        const after = chunk[at + abbreviation.length];
        if (!isWordChar(before) && !isWordChar(after)) {
          found.push({
            at,
            length: abbreviation.length,
            term: {
              term: abbreviation,
              words: phraseWords(phrase),
              expansions: [phrase],
              kind: 'substitution',
            },
          });
        }
        at = chunk.indexOf(abbreviation, at + abbreviation.length);
      }
    }
    found.sort((a, b) => a.at - b.at);
    let cursor = 0;
    for (const hit of found) {
      residual += chunk.slice(cursor, hit.at);
      residual += ' ';
      cursor = hit.at + hit.length;
      spanTerms.push(hit.term);
    }
    residual += chunk.slice(cursor);
  };

  const spanPattern = /"([^"]{3,200})"/g;
  let match = spanPattern.exec(text);
  while (match !== null) {
    takePlain(text.slice(last, match.index));
    const span = match[1] ?? '';
    const words = phraseWords(expandAbbreviationsIn(span));
    if (words.length > 0) {
      spanTerms.push({ term: span, words, expansions: [], kind: 'phrase' });
    }
    residual += ' ';
    last = match.index + match[0].length;
    match = spanPattern.exec(text);
  }
  takePlain(text.slice(last));

  const tokenTerms: QueryTerm[] = [];
  for (const token of residual.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0)) {
    const entry = SYNONYM_PHRASES[token];
    const expansions = entry === undefined ? [] : typeof entry === 'string' ? [entry] : [...entry];
    tokenTerms.push({ term: token, words: [token], expansions, kind: 'token' });
  }
  return [...spanTerms, ...tokenTerms];
}

/**
 * The FTS5 fragments of a PARSED query: one quoted prefix phrase per term.
 *
 * The candidate query (the OR tier) and the AND-tier membership query are
 * the SAME fragments joined differently, so both are built from ONE parse of
 * the query — a query with no usable terms yields neither.
 */
export function ftsParts(terms: readonly QueryTerm[]): string[] {
  const parts: string[] = [];
  let budget = MAX_TERMS;

  for (const term of terms) {
    if (term.kind === 'token') {
      if (budget <= 0) continue;
      budget -= 1;
      if (term.expansions.length === 0) {
        parts.push(`"${term.term}"*`);
        continue;
      }
      const alternatives = term.expansions.map((phrase) => `"${phrase}"*`).join(' OR ');
      parts.push(`("${term.term}"* OR ${alternatives})`);
      continue;
    }
    // A quoted span or a substituted abbreviation: a phrase query, whose
    // words are charged against the term budget.
    if (budget <= 0) continue;
    budget = Math.max(0, budget - term.words.length);
    parts.push(`"${term.words.join(' ')}"*`);
  }
  return parts;
}

/**
 * Translate free text into a safe FTS5 match string.
 *
 * Quoted spans become phrase queries (exact token sequence, prefix on the
 * last token) so verbatim regulatory language can be searched as written.
 * Every other token is emitted as a quoted prefix (`"tok"*`), optionally
 * grouped with a curated claims-language synonym phrase. User input can
 * never introduce FTS5 operators: every emitted piece is alphanumeric
 * tokens wrapped in quotes, and the result is always passed to SQLite as a
 * bound parameter, never concatenated into SQL.
 */
export function toFtsQuery(raw: string, mode: MatchMode): string | null {
  const parts = ftsParts(queryTerms(raw));
  if (parts.length === 0) return null;
  return parts.join(mode === 'and' ? ' AND ' : ' OR ');
}

/**
 * Trim a snippet so it never starts mid-sentence: when the window opens
 * on a lowercase fragment and a sentence boundary arrives in the first
 * 60% (so at least ~40% of the window remains), restart at the next
 * sentence. Returns the input unchanged when no safe boundary exists.
 */
export function tidySnippet(raw: string): string {
  const snippet = raw.trim();
  if (!/^[a-z]/.test(snippet)) return snippet;
  const boundary = snippet.match(/[.!?]["')\]]?\s+/);
  if (boundary?.index !== undefined && boundary.index < snippet.length * 0.6) {
    return snippet.slice(boundary.index + boundary[0].length);
  }
  return snippet;
}

/**
 * Words that carry no question: function words, and the "38 CFR" of a
 * citation. Published and fixed — a presentation constant, never tuned.
 * The list mirrors the function words SQLite's tokenizer drops, so the
 * ranking key counts the same words the FTS query actually matched.
 */
export const STOPWORDS: ReadonlySet<string> = new Set(
  (
    'a an and are as at be by cfr cfrs for from had has have how in is it its many much no not of on ' +
    'or that the their there these this to too was were what when where which who whom why will with ' +
    'you your'
  ).split(' '),
);

/**
 * The query's terms that carry a question: not a stopword, not a bare
 * numeral, not a single letter. A quoted span or a punctuated abbreviation
 * is deliberate — never noise.
 */
export function contentTerms(terms: readonly QueryTerm[]): readonly QueryTerm[] {
  return terms.filter((term) => {
    if (term.kind !== 'token') return true;
    return term.term.length > 1 && !/^\p{N}+$/u.test(term.term) && !STOPWORDS.has(term.term);
  });
}

/**
 * A heading that ANNOUNCES an exception ("Exceptional patterns of ...",
 * "Exceptions to ...") names a case the rule does not cover, not the rule
 * the question asks about: for "how is hearing loss rated" both § 4.85
 * ("Evaluation of hearing impairment.") and § 4.86 ("Exceptional patterns of
 * hearing impairment.") carry the corpus's bridge phrase, so the
 * heading-phrase key ties and body repetition hands the answer to the
 * exception. Demote the announcing heading — unless the query itself asks
 * about exceptions, in which case it IS the answer (see
 * `asksAboutExceptions`). ONE fixed GLOB prefix deliberately covers both
 * spellings ('exception*' matches "Excepted", "Exceptions" and
 * "Exceptional"); it reads the corpus's own headings and no per-query or
 * per-part list.
 */
export const EXCEPTION_DEMOTION_KEY =
  "(CASE WHEN lower(s.heading) GLOB 'exception*' THEN 1 ELSE 0 END) ASC";

/** The words that mean "the query asks about exceptions". */
export const EXCEPTION_WORDS = new Set([
  'exception',
  'exceptions',
  'exceptional',
  'exceptionals',
  'excepted',
]);

/**
 * Whether the query itself asks about exceptions — the gate that switches
 * the exception demotion off.
 *
 * The exception word may sit ANYWHERE in a term, not only at its start: a
 * quoted span is ONE term ("hearing impairment exceptions"), so the word
 * never begins it, and a startsWith test missed it — the audit of
 * 2026-10-21 (P1-20261021-06) found the quoted form ranked the GENERAL
 * provision first, the opposite of what the user asked for.
 *
 * The word must be a WHOLE word. "exceptionally" and "unexceptional" are
 * not the same request, and "antiexceptions" is one token, not the word.
 * The term is split with this module's own word rule (`phraseWords`), so
 * the test is case-insensitive and reads words exactly as the rest of the
 * module reads them.
 */
export function asksAboutExceptions(terms: readonly QueryTerm[]): boolean {
  return terms.some((term) =>
    phraseWords(term.term).some((word) => EXCEPTION_WORDS.has(word.toLowerCase())),
  );
}

/** Query tokens that actually appear in a hit (citation/heading/snippet). */
export function visibleMatches(
  terms: readonly QueryTerm[],
  hit: {
    citation: string;
    heading: string;
    snippet: string;
  },
): string[] {
  const words = hitWords(hit);
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const term of terms) {
    if (matches.length >= 8) break;
    if (seen.has(term.term)) continue;
    seen.add(term.term);
    if (termResponded(term, words)) matches.push(term.term);
  }
  return matches;
}

/** The words of a hit, lowercased and split. */
export function hitWords(hit: { citation: string; heading: string; snippet: string }): string[] {
  return `${hit.citation}\n${hit.heading}\n${hit.snippet}`.toLowerCase().split(/[^\p{L}\p{N}]+/u);
}

/**
 * True when the hit's text answers the term.
 *
 * - A single-token term is answered when the token is present anywhere, with
 *   the search's prefix rule (`"term"*` → `startsWith`).
 * - A multi-word term (a quoted phrase, or a punctuated abbreviation standing
 *   for one) is answered only when its words occur in the hit's text in that
 *   order and contiguously — the same normalising the search applies (case and
 *   token boundaries). Every word but the last must match a whole token; the
 *   last uses the search's prefix rule, mirroring an FTS phrase query.
 * - A synonym/substitution term is answered through its own words OR through
 *   any of its corpus expansions, each expansion matched with the same rules
 *   (a single-word expansion uses the prefix rule; a multi-word expansion must
 *   be contiguous and in order).
 *
 * The word-start match mirrors the FTS prefix semantics ("term"*) and avoids
 * false positives like the token "in" matching inside "brain".
 */
export function termResponded(term: QueryTerm, words: readonly string[]): boolean {
  const tokens = words.filter((word) => word.length > 0);
  const phraseMatches = (phrase: readonly string[]): boolean => {
    if (phrase.length === 0) return false;
    if (phrase.length === 1)
      return tokens.some((candidate) => candidate.startsWith(phrase[0] ?? ''));
    const last = phrase.length - 1;
    for (let i = 0; i + phrase.length <= tokens.length; i++) {
      let ok = true;
      for (let j = 0; j < phrase.length; j++) {
        const token = tokens[i + j] ?? '';
        const word = phrase[j] ?? '';
        if (j === last) {
          if (!token.startsWith(word)) {
            ok = false;
            break;
          }
        } else if (token !== word) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  };

  if (phraseMatches(term.words)) return true;
  return term.expansions.some((phrase) => phraseMatches(phraseWords(phrase)));
}
