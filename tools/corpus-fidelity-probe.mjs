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
import { gunzipSync } from 'node:zlib';
import { parseTitleXml } from '../dist/core/xml.js';

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

/** Element name -> the text it contains, with tags stripped and whitespace collapsed. */
function elementText(block, tag) {
  const out = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let match;
  while ((match = pattern.exec(block)) !== null) {
    const text = match[1]
      .replace(/<[^>]+>/g, ' ')
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

function countTag(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}\\b`, 'gi'))].length;
}

async function main() {
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

    const blockPattern = /<DIV8 N="([^"]+)"[^>]*>/g;
    let match;
    while ((match = blockPattern.exec(xml)) !== null) {
      const citation = match[1];
      const start = match.index;
      const end = xml.indexOf('</DIV8>', start);
      const block = xml.slice(start, end === -1 ? undefined : end);

      // An image has no inner text: the thing to survive is the marker the
      // parser emits in its place.
      const fragments =
        entry.key === 'IMG'
          ? block.includes('<img')
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
  console.log('');
  console.log(`numeric entities  ${countTag(xml, '&#')}`);
  console.log(`named entities    ${[...xml.matchAll(/&[a-z]+;/gi)].length}`);
  console.log('');
  console.log('note: a preserved construct is not necessarily LABELLED or ANCHORED in the');
  console.log('output — see docs/research/corpus-fidelity-2026-10-20.md for that assessment.');
}

main().catch((error) => {
  console.error(`probe failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
