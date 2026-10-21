import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
 * The marker rule is Git's own: a line whose first non-whitespace
 * characters are `<<<<<<< `, exactly seven `=`, or `>>>>>>> ` (Git writes
 * the label after a space). A markdown setext heading underline is a run of
 * `=` of ANY length, so requiring EXACTLY seven keeps `====` and `=======`
 * apart from an underline; the repo's own tracked files are checked
 * against this rule by the test below, so the rule is known not to fire on
 * them.
 *
 * Fenced code blocks are skipped: documentation may legitimately SHOW a
 * marker (this file's own history does), and a marker inside a fence is
 * not damage in the merge sense. The cost of that choice is recorded here
 * rather than left implicit: a conflict that landed inside a code fence
 * would not be caught by this test.
 */

const MARKER = /^\s*(?:<{7} |={7}\s*$|>{7} )/;

/** True when the file is text we can scan (no NUL byte in the first 8 KiB). */
function isTextFile(filePath: string): boolean {
  const buffer = readFileSync(filePath);
  const probe = buffer.subarray(0, 8192);
  return !probe.includes(0);
}

/** The tracked files of the repository, as paths relative to the repo root. */
function trackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return output.split('\0').filter((entry) => entry.length > 0);
}

/** Every conflict-marker line in one file, as 1-based line numbers. */
function markerLines(filePath: string): number[] {
  if (!isTextFile(filePath)) return [];
  const content = readFileSync(filePath, 'utf8');
  const hits: number[] = [];
  let inFence = false;
  content.split('\n').forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (MARKER.test(line)) hits.push(index + 1);
  });
  return hits;
}

describe('no tracked file carries a conflict marker', () => {
  it('finds no conflict marker in the repository', () => {
    const offenders: string[] = [];
    for (const file of trackedFiles()) {
      for (const line of markerLines(path.resolve(file))) {
        offenders.push(`${file}:${line}`);
      }
    }
    expect(
      offenders,
      `unresolved conflict markers in tracked files: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('detects a marker when one is present', () => {
    // The rule itself, pinned: a setext underline of any other length and a
    // marker-looking word inside a line are both NOT markers.
    expect(MARKER.test('<<<<<<< HEAD')).toBe(true);
    expect(MARKER.test('=======')).toBe(true);
    expect(MARKER.test('>>>>>>> origin/main')).toBe(true);
    expect(MARKER.test('  <<<<<<< HEAD')).toBe(true);
    expect(MARKER.test('====')).toBe(false);
    expect(MARKER.test('======= not quite a separator')).toBe(false);
    expect(MARKER.test('text <<<<<<< HEAD')).toBe(false);
  });
});
