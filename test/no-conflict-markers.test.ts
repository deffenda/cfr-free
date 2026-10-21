import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No tracked file may carry an unresolved merge-conflict marker.
 *
 * This exists because the repo's own gate could not see one: `prettier`
 * treats `<<<<<<< HEAD` as ordinary prose, and no test looked for it. On
 * 2026-10-21 a hand-resolved conflict in `docs/SPEC.md` shipped WITH its
 * markers — the resolution had replaced only the FIRST conflict hunk — and
 * two independent reviews caught it (one P0, one P1, both REQUEST CHANGES).
 * The same resolution also left a markdown route table ragged, with one row
 * lost, which a later review caught as a P2.
 *
 * THE RULE, and why it is this narrow:
 *
 * - `<<<<<<< ` and `>>>>>>> ` are UNAMBIGUOUS. No valid markdown line
 *   begins with seven `<` or seven `>` followed by a space, so these two
 *   branches can never fire on legitimate content.
 * - The separator line `=======` is AMBIGUOUS and is therefore NOT matched
 *   on its own: a CommonMark setext heading underline of exactly seven `=`
 *   is valid markdown, so matching it would fail the gate on an innocent
 *   heading. A merge conflict always carries the two unambiguous halves as
 *   well, so nothing real is lost by leaving the separator alone.
 * - Fenced code blocks are skipped, because documentation may legitimately
 *   SHOW a marker (this file's own history does). BOTH fence forms are
 *   recognised: the backtick fence and the tilde fence. Indented code
 *   blocks (four spaces) are NOT skipped — a marker there is still a marker
 *   in the file — and that is deliberate.
 *
 * The cost of the fence exemption is recorded here rather than left
 * implicit: a conflict that landed inside a fenced code block would not be
 * caught by this test.
 */

const MARKER = /^\s*(?:<{7} |>{7} )/;

/** True when the file is text we can scan (no NUL byte in the first 8 KiB). */
function isTextFile(filePath: string): boolean {
  const buffer = readFileSync(filePath);
  const probe = buffer.subarray(0, 8192);
  return !probe.includes(0);
}

/** The tracked files of the repository, or null when there is no repository. */
function trackedFiles(): string[] | null {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
    return output.split('\0').filter((entry) => entry.length > 0);
  } catch {
    return null;
  }
}

/** Every conflict-marker line in one file, as 1-based line numbers. */
function markerLines(filePath: string): number[] {
  if (!isTextFile(filePath)) return [];
  const content = readFileSync(filePath, 'utf8');
  const hits: number[] = [];
  let inFence = false;
  content.split('\n').forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (MARKER.test(line)) hits.push(index + 1);
  });
  return hits;
}

describe('no tracked file carries a conflict marker', () => {
  it('finds no conflict marker in the repository', (context) => {
    const files = trackedFiles();
    if (files === null) {
      context.skip('not a git checkout — the tracked-file scan cannot run');
      return;
    }
    if (files.length === 0) {
      context.skip('no tracked files — the scan would pass vacuously');
      return;
    }
    const offenders: string[] = [];
    for (const file of files) {
      for (const line of markerLines(path.resolve(file))) {
        offenders.push(`${file}:${line}`);
      }
    }
    expect(
      offenders,
      `unresolved conflict markers in tracked files: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('matches only the unambiguous marker forms', () => {
    // The two halves Git writes. Nothing else may match: a setext heading
    // underline of any length is valid markdown, including exactly seven
    // `=`, and a marker-looking word inside a line is just a word.
    expect(MARKER.test('<<<<<<< HEAD')).toBe(true);
    expect(MARKER.test('>>>>>>> origin/main')).toBe(true);
    expect(MARKER.test('  <<<<<<< HEAD')).toBe(true);
    expect(MARKER.test('=======')).toBe(false);
    expect(MARKER.test('====')).toBe(false);
    expect(MARKER.test('text <<<<<<< HEAD')).toBe(false);
    expect(MARKER.test('> quote')).toBe(false);
  });

  it('skips both fence forms and keeps scanning indented blocks', () => {
    const write = (name: string, content: string): string => {
      const file = path.join(mkdtempSync(path.join(tmpdir(), 'cfr-markers-')), name);
      writeFileSync(file, content);
      return file;
    };
    // A marker inside a backtick fence: skipped (documentation may show one).
    const backtick = write('backtick.md', 'text\n```\n<<<<<<< HEAD\n```\n');
    // The same inside a tilde fence: also skipped — the earlier draft
    // recognised only the backtick form, which is a false positive waiting
    // for the next document that uses `~~~`.
    const tilde = write('tilde.md', 'text\n~~~\n<<<<<<< HEAD\n~~~\n');
    // An indented code block is NOT a fence: a marker there is still a
    // marker in the file, so it is reported.
    const indented = write('indented.md', 'text\n\n    <<<<<<< HEAD\n');
    // A marker outside any block: reported.
    const plain = write('plain.md', 'text\n<<<<<<< HEAD\nmore\n');

    expect(markerLines(backtick)).toEqual([]);
    expect(markerLines(tilde)).toEqual([]);
    expect(markerLines(indented)).toEqual([3]);
    expect(markerLines(plain)).toEqual([2]);
  });
});
