import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every markdown table in the repository must be RECTANGULAR: each row has
 * the same number of cells as the header.
 *
 * This exists because the repo's other gates cannot see a broken table.
 * Prettier re-pads a malformed table without complaining; eslint does not
 * read Markdown; and no test read the documents. On 2026-10-21 that let two
 * defects through the whole gate, both found only by an independent review:
 *
 *  1. A hand-resolved conflict left `docs/SPEC.md`'s API route table RAGGED
 *     — one row (`GET /api/v1/sections/:citation`) lost, and the column
 *     widths mismatched. The row was simply gone.
 *  2. A reclassification was written into a table cell as THREE physical
 *     lines, so the closure table rendered with NINE body rows instead of
 *     six: three "findings" whose names were sentence fragments, and one
 *     row's description truncated mid-sentence.
 *
 * Both are invisible in the source diff unless you count cells, and both
 * were caught by a reviewer rendering the file (markdown-it) rather than
 * reading it. This test does the counting.
 *
 * THE RULES, and what they cost:
 *
 * - A table is a run of lines that start and end with `|`, preceded by a
 *   separator line (`|---|`) that fixes the column count. Rows before a
 *   separator are not a table.
 * - Cells are split on `|` that are neither ESCAPED (`\|`) nor inside a
 *   code span, so a cell may contain `a | b` escaped and `` `a|b` ``
 *   unescaped.
 * - Fenced code blocks (``` and ~~~) are skipped: a table shown inside a
 *   fence is documentation, not a table. Indented code blocks are NOT
 *   skipped — a malformed table indented into a code block is still
 *   malformed, and this repo indents its continuation lines.
 * - The leading and trailing `|` are delimiters, not cells, so a table
 *   with N columns has N-1 separators on its interior.
 */

// A separator cell is dashes with optional alignment colons. Kept as a
// simple, single-quantifier pattern on purpose: a nested-quantifier regex
// here trips the repo's own security/detect-unsafe-regex rule, and a table
// separator does not need one.
const SEPARATOR_CELL = /^:?-+:?$/;

/** True when the line is a table separator row (`| --- | --- |`). */
function isSeparatorRow(line: string): boolean {
  const cells = tableCells(line);
  if (cells === null || cells.length === 0) return false;
  return cells.every((cell) => SEPARATOR_CELL.test(cell.trim()));
}

/** The tracked markdown files of the repository, or null if there is no repo. */
function trackedMarkdownFiles(): string[] | null {
  try {
    const output = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { encoding: 'utf8' });
    return output.split('\0').filter((entry) => entry.length > 0);
  } catch {
    return null;
  }
}

/**
 * Split one table row into its cells, honouring escaped pipes and code
 * spans. Returns null when the line is not a table row.
 */
export function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === '\\' && trimmed[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }
    if (char === '`') {
      inCode = !inCode;
      current += char;
      continue;
    }
    if (char === '|' && !inCode) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  // The leading and trailing pipes delimit the row; the interior pipes
  // separate cells. A row "| a | b |" yields ["", " a ", " b ", ""].
  return cells.slice(1, cells.length - 1);
}

/** The number of cells every row of the tables in this text must have. */
export function raggedTables(text: string): string[] {
  const problems: string[] = [];
  const lines = text.split('\n');
  let inFence = false;
  let headerColumns: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      headerColumns = null;
      continue;
    }
    if (inFence) continue;
    if (isSeparatorRow(line)) {
      const header = lines[index - 1] ?? '';
      const cells = tableCells(header);
      if (cells) headerColumns = cells.length;
      continue;
    }
    const cells = tableCells(line);
    if (!cells) {
      headerColumns = null;
      continue;
    }
    if (headerColumns === null) continue;
    if (cells.length !== headerColumns) {
      problems.push(`line ${index + 1}: ${cells.length} cells, expected ${headerColumns}`);
    }
  }
  return problems;
}

describe('every markdown table is rectangular', () => {
  it('has the same number of cells in every row of every table', (context) => {
    const files = trackedMarkdownFiles();
    if (files === null) {
      context.skip('not a git checkout — the tracked-file scan cannot run');
      return;
    }
    if (files.length === 0) {
      context.skip('no tracked markdown files — the scan would pass vacuously');
      return;
    }
    const problems: string[] = [];
    for (const file of files) {
      const text = readFileSync(path.resolve(file), 'utf8');
      for (const problem of raggedTables(text)) {
        problems.push(`${file}:${problem}`);
      }
    }
    expect(problems, `ragged markdown tables: ${problems.join('; ')}`).toEqual([]);
  });

  it('counts cells, ignoring escaped pipes and code spans', () => {
    expect(tableCells('| a | b |')).toEqual([' a ', ' b ']);
    // an escaped pipe stays inside its cell
    expect(tableCells('| a \\| b | c |')).toEqual([' a | b ', ' c ']);
    // a pipe inside a code span stays inside its cell
    expect(tableCells('| `a|b` | c |')).toEqual([' `a|b` ', ' c ']);
    // a line that is not a table row
    expect(tableCells('not a table row')).toBeNull();
  });

  it('finds a ragged table and leaves a well-formed one alone', () => {
    const good = ['| a | b |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');
    expect(raggedTables(good)).toEqual([]);
    const bad = ['| a | b |', '| --- | --- |', '| 1 | 2 |', '| 3 |'].join('\n');
    expect(raggedTables(bad)).toEqual(['line 4: 1 cells, expected 2']);
    // a table inside a fence is documentation, not a table
    const fenced = ['```', '| a | b |', '| --- | --- |', '| 1 |', '```'].join('\n');
    expect(raggedTables(fenced)).toEqual([]);
  });
});
