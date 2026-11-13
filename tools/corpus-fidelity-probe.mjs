#!/usr/bin/env node
/**
 * Corpus fidelity probe — dated, reproducible inventory of the constructs the
 * eCFR document uses and what the current parser does with each of them.
 *
 * Usage:
 *   node tools/corpus-fidelity-probe.mjs [YYYY-MM-DD]
 *
 * The date defaults to the current issue date resolved from titles.json. The
 * document's SHA-256 and byte length are printed, so every number below can
 * be tied to an exact document snapshot (the upstream document is mutable:
 * these counts are a dated snapshot, never a test expectation).
 *
 * Network notes (both measured, not assumed):
 * - The full-title endpoint answers 406 unless the request's Accept-Encoding
 *   permits compression ("This endpoint requires response compression",
 *   supportCode 11). This script therefore sends `Accept-Encoding: gzip` and
 *   decodes the response itself.
 * - The structure/titles endpoints answer fine without compression.
 *
 * The probe writes nothing: it prints a deterministic, count-only report and
 * exits non-zero on a fetch or parse failure.
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://www.ecfr.gov/api/versioner/v1';
const TITLE = 38;

/** Construct classes inventoried, with the element names that carry them. */
const CLASSES = [
  { key: 'FP', label: 'footnotes (<FP>)', tags: ['FP'], labelled: false, anchored: false },
  { key: 'NOTE', label: 'notes (<NOTE>)', tags: ['NOTE'], labelled: false, anchored: false },
  {
    key: 'EDNOTE',
    label: 'editorial notes (<EDNOTE>)',
    tags: ['EDNOTE'],
    labelled: false,
    anchored: false,
  },
  { key: 'HD2', label: 'sub-headings (<HD2>)', tags: ['HD2'], labelled: false, anchored: false },
  {
    key: 'EXTRACT',
    label: 'extracts (<EXTRACT>)',
    tags: ['EXTRACT'],
    labelled: false,
    anchored: false,
  },
  {
    key: 'CITA',
    label: 'source credits (<CITA>)',
    tags: ['CITA'],
    labelled: false,
    anchored: false,
  },
  {
    key: 'SECAUTH',
    label: 'authority notes (<SECAUTH>)',
    tags: ['SECAUTH'],
    labelled: false,
    anchored: false,
  },
  {
    key: 'TFOOT',
    label: 'table footers (<TFOOT>)',
    tags: ['TFOOT'],
    labelled: false,
    anchored: false,
  },
  {
    key: 'GPH',
    label: 'graphic placeholders (<GPH>)',
    tags: ['GPH'],
    labelled: false,
    anchored: false,
  },
  {
    key: 'FORMULA',
    label: 'formulas (<FORMULA>)',
    tags: ['FORMULA'],
    labelled: false,
    anchored: false,
  },
  { key: 'IMG', label: 'images (<img>)', tags: ['img'], labelled: true, anchored: true },
];

async function fetchWithEncoding(url, accept) {
  const response = await fetch(url, {
    headers: { accept: accept, 'accept-encoding': 'gzip', 'user-agent': 'cfr-free/fidelity-probe' },
  });
  if (!response.ok) {
    throw new Error(`upstream HTTP ${response.status} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  // Node's fetch may have already decompressed the body; decompress only if
  // the gzip magic bytes are still present (otherwise gunzip throws).
  const stillCompressed = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  return stillCompressed ? gunzipSync(buffer) : buffer;
}

async function resolveIssueDate() {
  const buffer = await fetchWithEncoding(`${BASE_URL}/titles.json`, 'application/json');
  const payload = JSON.parse(buffer.toString('utf8'));
  const title = payload.titles.find((entry) => entry.number === TITLE);
  if (!title) throw new Error(`title ${TITLE} missing from titles.json`);
  return title.up_to_date_as_of ?? title.latest_issue_date;
}

/**
 * Element name -> a pattern that matches EXACTLY that element name.
 *
 * EXACT tag name: `<FP>` must not match `<FP-1>`/`<FP-2>`. A word boundary
 * after the tag name (`\b`) is NOT exact — a hyphen is a non-word character,
 * so `\b` sits between "FP" and the "-" of "<FP-1>" and the pattern matches
 * the LIST ITEM. The capture then runs from the list item to the next `</FP>`
 * close tag, so the "fragment" is a span that exists nowhere in the rendered
 * output and the provision is reported as `lost` — a measurement artifact
 * that reads exactly like lost content. Hence the tag name is followed by
 * `(?=\s|>)`: whitespace-and-attributes, or the closing ">" — never a
 * hyphen, a digit or any other continuation of the name.
 *
 * A LITERAL pattern per element name — not built from a variable (that trips
 * the repo's ReDoS linter, semgrep detect-non-literal-regexp, which the
 * pre-commit scan enforces) and not one shared alternation (an alternation
 * closes on the first matching close tag and can truncate).
 */
export const ELEMENT_PATTERNS = {
  FP: /<FP(?=\s|>)[^>]*>([\s\S]*?)<\/FP>/gi,
  NOTE: /<NOTE(?=\s|>)[^>]*>([\s\S]*?)<\/NOTE>/gi,
  EDNOTE: /<EDNOTE(?=\s|>)[^>]*>([\s\S]*?)<\/EDNOTE>/gi,
  HD2: /<HD2(?=\s|>)[^>]*>([\s\S]*?)<\/HD2>/gi,
  EXTRACT: /<EXTRACT(?=\s|>)[^>]*>([\s\S]*?)<\/EXTRACT>/gi,
  CITA: /<CITA(?=\s|>)[^>]*>([\s\S]*?)<\/CITA>/gi,
  SECAUTH: /<SECAUTH(?=\s|>)[^>]*>([\s\S]*?)<\/SECAUTH>/gi,
  TFOOT: /<TFOOT(?=\s|>)[^>]*>([\s\S]*?)<\/TFOOT>/gi,
};

/**
 * Element name -> the text it contains, with tags stripped and whitespace collapsed.
 *
 * Limitation (stated in the inventory): this extracts text nested directly
 * under the element. A construct that wraps its text in non-standard nested
 * markup yields NO fragment, so the provision is not part of the survival
 * comparison — the "provisions" figure is therefore a floor for such classes
 * (the "occurrences" figure still counts every element in the document).
 */
export function elementText(block, tag) {
  const out = [];
  const pattern = ELEMENT_PATTERNS[tag];
  if (pattern === undefined) return out;
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(block)) !== null) {
    // Tags become NOTHING (not a space): the parser concatenates inline
    // elements without a separator, so inserting one here would make a
    // perfectly preserved construct look lost.
    const text = match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&#(\d+);/g, (_all, dec) => String.fromCodePoint(Number(dec)))
      .replace(/&#x([0-9a-f]+);/gi, (_all, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0) out.push(text);
  }
  return out;
}

/**
 * Count elements with EXACTLY this tag name: `<FP>` must not count the
 * `<FP-1>`/`<FP-2>` list items, and `<E>` must not count `<ECFR>`.
 */
function countTag(xml, tag) {
  let count = 0;
  for (const match of xml.matchAll(/<([A-Za-z][\w-]*)(?=\s|>)[^>]*>/g)) {
    if (match[1] === tag) count += 1;
  }
  return count;
}

async function main() {
  // Imported lazily: the parser is a BUILD artifact, and this module is also
  // imported by the pattern test — which must not need a build to run.
  const { parseTitleXml } = await import('../dist/core/xml.js');
  const requested = process.argv[2];
  const issueDate = requested ?? (await resolveIssueDate());
  const url = `${BASE_URL}/full/${issueDate}/title-${TITLE}.xml`;
  const buffer = await fetchWithEncoding(url, 'application/xml, text/xml;q=0.9, */*;q=0.1');
  const xml = buffer.toString('utf8');
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  const sections = parseTitleXml(xml);
  const byCitation = new Map(sections.map((section) => [section.citation, section]));

  // Per-class accounting, all at PROVISION level so the columns compare:
  // a provision is intact when EVERY fragment of that class survives the
  // parser, partial when some survive, and lost when none do.
  const rows = [];
  for (const entry of CLASSES) {
    let occurrences = 0;
    let provisions = 0;
    let intact = 0;
    let partial = 0;
    let lost = 0;
    for (const entryTag of entry.tags) occurrences += countTag(xml, entryTag);

    // Sections AND appendices both carry these constructs (source credits,
    // authority notes, sub-headings and images all appear in appendices);
    // scan DIV8 and DIV9, closing each block on its OWN tag.
    const blockPattern = /<DIV(?:8|9) N="([^"]+)"[^>]*>/g;
    let match;
    while ((match = blockPattern.exec(xml)) !== null) {
      const citation = match[1];
      const start = match.index;
      const end8 = xml.indexOf('</DIV8>', start);
      const end9 = xml.indexOf('</DIV9>', start);
      const end = end9 > 0 && (end8 === -1 || end9 < end8) ? end9 : end8;
      const block = xml.slice(start, end === -1 ? undefined : end);

      // An image has no inner text: the thing to survive is the marker the
      // parser emits in its place. EXACT tag name here too: a plain
      // "contains <img" test would also fire on a sibling like "<img-1>".
      const fragments =
        entry.key === 'IMG'
          ? /<img(?=\s|>)[^>]*>/.test(block)
            ? ['[image content not included:']
            : []
          : entry.tags.flatMap((tag) => elementText(block, tag));
      if (fragments.length === 0) continue;
      provisions += 1;

      const section = byCitation.get(citation);
      if (section === undefined) {
        lost += 1;
        continue;
      }
      // Compare with ALL whitespace removed: the parser concatenates inline
      // elements without inserting a space, while the probe strips tags to a
      // space — so a whitespace-sensitive comparison would report false
      // losses for any construct with inline markup inside it.
      const flat = section.text.replace(/\s+/g, '');
      const kept = fragments.filter((text) => flat.includes(text.replace(/\s+/g, ''))).length;
      if (kept === fragments.length) intact += 1;
      else if (kept > 0) partial += 1;
      else lost += 1;
    }

    rows.push({ class: entry.label, occurrences, provisions, intact, partial, lost });
  }

  console.log('corpus fidelity probe');
  console.log(`  document      ${url}`);
  console.log(`  issue date    ${issueDate}`);
  console.log(`  bytes         ${buffer.length}`);
  console.log(`  sha256        ${sha256}`);
  console.log(
    `  provisions    ${sections.length} (${sections.filter((s) => s.kind === 'appendix').length} appendices)`,
  );
  console.log('');
  console.log('class                          occurrences  provisions    intact  partial    lost');
  for (const row of rows) {
    console.log(
      `${row.class.padEnd(30)} ${String(row.occurrences).padStart(11)} ${String(row.provisions).padStart(11)} ${String(row.intact).padStart(8)} ${String(row.partial).padStart(9)} ${String(row.lost).padStart(6)}`,
    );
  }
  console.log('');
  console.log("intact = the provision keeps ALL of this construct's text;");
  console.log('partial = some of it survives; lost = none of it does.');
  // Mid-token splits: a blank line whose two sides are both word/bracket
  // characters — the inventory's detection method for the inline-element
  // rendering gap (G1). This is a PROXY: it also flags legitimate block
  // boundaries (a paragraph ending, a table row, two sibling <FP-1> list
  // items), so a non-zero count means "inspect these", not "N defects".
  const splitProvisions = sections.filter((section) => {
    const parts = section.text.split('\n\n');
    for (let i = 1; i < parts.length; i += 1) {
      const before = parts[i - 1];
      const after = parts[i];
      if (before.length === 0 || after.length === 0) continue;
      // A label block ("Footnote:", "Extract:") is a deliberate separator,
      // not a split phrase: the boundary BEFORE it is prose-then-label, so
      // skip it. (The label is the `after` side of that boundary — the
      // earlier form checked the `before` side and never fired.)
      if (after === 'Footnote:' || after === 'Extract:') continue;
      const left = before[before.length - 1];
      const right = after[0];
      // Both sides must look like the middle of a word or a bracket group.
      const opensWord = (character) =>
        /[A-Za-z0-9]/.test(character) || character === '(' || character === '[';
      const closesWord = (character) =>
        /[A-Za-z0-9]/.test(character) || character === ')' || character === ']';
      if (opensWord(left) && closesWord(right)) return true;
    }
    return false;
  });

  console.log('');
  console.log(`numeric entities  ${countTag(xml, '&#')}`);
  console.log(`named entities    ${[...xml.matchAll(/&[a-z]+;/gi)].length}`);
  console.log(
    `mid-token splits  ${splitProvisions.length} provision(s) flagged (proxy — includes legitimate block boundaries)`,
  );
  console.log('');
  console.log('note: a preserved construct is not necessarily LABELLED or ANCHORED in the');
  console.log('output — see docs/research/corpus-fidelity-2026-10-20.md for that assessment.');
}

/**
 * True when this file is the process entry point (the repo's `isMainModule`
 * convention, as in `src/cli.ts`). Importing the module — the pattern test
 * does — must not fetch the document or print a report.
 */
function isMainModule() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`probe failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
