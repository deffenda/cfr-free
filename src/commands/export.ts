import { randomBytes } from 'node:crypto';
import { existsSync, linkSync, lstatSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { CommandError, EXIT } from '../exit-codes.js';
import type { Logger } from '../logger.js';
import { Store } from '../core/store.js';
import type { SectionRow } from '../core/store.js';

/** Optional export formats; the format-less default is the sqlite snapshot. */
export type ExportOutputFormat = 'jsonl' | 'md';

export interface ExportReport {
  readonly path: string;
  readonly bytes: number;
  /** Which writer produced the file (the default writer is the sqlite snapshot). */
  readonly format: 'sqlite' | 'jsonl' | 'md';
  /** Provisions (sections + appendices) written to the file. */
  readonly provisions: number;
}

/**
 * One compact JSON line per provision, fields in the wire's SectionDetail
 * order (plus subchapter/subjectGroup) — insertion order here is the line's
 * key order, so the shape stays stable for pipeline consumers.
 */
function toJsonlLine(row: SectionRow): string {
  return `${JSON.stringify({
    citation: row.citation,
    kind: row.kind,
    heading: row.heading,
    chapter: row.chapter,
    subchapter: row.subchapter,
    part: row.part,
    subpart: row.subpart,
    subjectGroup: row.subjectGroup,
    path: row.path,
    issueDate: row.issueDate,
    text: row.text,
    markdown: row.markdown,
  })}\n`;
}

/**
 * Write every provision as JSONL (compact lines, one object per line,
 * trailing newline at EOF) and return the row count.
 *
 * Chunk array + ONE `writeFileSync`, deliberately over a write stream: at
 * Title 38 scale the whole document is ~20 MB (measured: 2 970 rows,
 * ~16 MB of text+markdown), so the peak stays ~3× the corpus (rows +
 * chunks + joined string ≈ 60 MB) — within the accepted envelope — while a
 * single write keeps the failure mode simple (no half-written stream to
 * reconcile with the refuse-to-overwrite contract). No pretty-printing:
 * compact lines are the ingest contract.
 */
function writeJsonl(store: Store, target: string): number {
  const rows = store.allSections();
  const chunks: string[] = rows.map(toJsonlLine);
  writeExclusive(target, chunks.join(''));
  return rows.length;
}

/**
 * Write one Markdown document: a title header carrying the index issue
 * date, then each provision as a `## {citation} — {heading}` section with
 * its `text` verbatim (never fenced, never reflowed) and a `---` separator.
 * Returns the row count.
 *
 * Same chunk-array + single-write choice (and peak) as {@link writeJsonl}.
 */
function writeMarkdown(store: Store, target: string): number {
  const issueDate = store.getMeta('issue_date') ?? 'unknown';
  const rows = store.allSections();
  const chunks: string[] = [
    `# Code of Federal Regulations — Title 38 (issue date: ${issueDate})\n`,
  ];
  for (const row of rows) {
    // Exactly one newline joins text to the separator: append only when the
    // stored text does not already end in one (verbatim either way).
    const body = row.text.endsWith('\n') ? row.text : `${row.text}\n`;
    chunks.push(`\n## ${row.citation} — ${row.heading}\n${body}\n---\n`);
  }
  writeExclusive(target, chunks.join(''));
  return rows.length;
}

/**
 * Snapshot the index to `target` without ever following or replacing
 * whatever is at that path. SQLite's `VACUUM INTO` opens its output by name,
 * so a symlink planted after the existence check would be written through.
 * Write a private temporary file beside the target instead, then `link` it
 * into place: `link` fails with EEXIST on any existing path, a symlink
 * included, at the moment of linking.
 */
function snapshotExclusive(store: Store, target: string): void {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    store.backupTo(temporary);
    try {
      linkSync(temporary, target);
    } catch (error) {
      throw refusedIfExists(error, target);
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // never created, or already gone
    }
  }
}

function writeExclusive(target: string, text: string): void {
  try {
    writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    throw refusedIfExists(error, target);
  }
}

/** An EEXIST from an exclusive create is the refusal contract, not a crash. */
function refusedIfExists(error: unknown, target: string): unknown {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
    return new CommandError(
      `refusing to overwrite existing file: ${target} — remove it first`,
      EXIT.REFUSED,
    );
  }
  return error;
}

/** Whether anything, a dangling symlink included, is at `target`. */
function pathExists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

/**
 * `cfr-free export <path> [jsonl|md]` — write a consistent export of the
 * local index.
 *
 * Default: SQLite `VACUUM INTO`, which includes WAL content, so the copy is
 * a point-in-time image safe to copy elsewhere. Optional `jsonl`/`md`
 * re-serialize the SAME store's rows for pipeline ingestion. Never
 * overwrites: the target must not exist, and the source index must.
 *
 * @param format omit for the sqlite snapshot (unchanged default behavior).
 * @throws {CommandError} exit 3 when there is no index; exit 5 when the
 *   target already exists (a deliberate refusal, not a usage error).
 */
export function runExportCommand(
  config: AppConfig,
  target: string,
  logger: Logger,
  format?: ExportOutputFormat,
): ExportReport {
  if (!existsSync(config.indexPath)) {
    throw new CommandError(
      `no index at ${config.indexPath} — run \`cfr-free sync\` first`,
      EXIT.INDEX_UNAVAILABLE,
    );
  }
  // `lstat`, not `existsSync`: a dangling symlink "does not exist" to
  // `existsSync`, and the write that follows would create the file it points
  // at, wherever that is. The writers below create exclusively (`wx`, or
  // `link` for the snapshot), which refuses an existing path (symlink
  // included) at the moment of writing.
  if (pathExists(target)) {
    throw new CommandError(
      `refusing to overwrite existing file: ${target} — remove it first`,
      EXIT.REFUSED,
    );
  }

  // STRICT open (no allowSchemaUpgrade): the read-only export path never
  // adopts a schema, same contract as the diff command.
  const store = Store.open(config.indexPath);
  let provisions: number;
  try {
    if (format === undefined) {
      snapshotExclusive(store, target);
      provisions = store.countSections();
    } else if (format === 'jsonl') {
      provisions = writeJsonl(store, target);
    } else {
      provisions = writeMarkdown(store, target);
    }
  } finally {
    store.close();
  }
  const bytes = statSync(target).size;
  const reportFormat: ExportReport['format'] = format ?? 'sqlite';
  logger.info('index exported', { target, bytes, format: reportFormat, provisions });
  return { path: target, bytes, format: reportFormat, provisions };
}
