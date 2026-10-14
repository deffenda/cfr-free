/**
 * Process exit codes for CLI automation (documented in `USAGE` and README).
 *
 * Codes 3 and 4 let scripts distinguish "index needs a sync" and "port is
 * taken" from generic failures without parsing stderr.
 */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  INDEX_UNAVAILABLE: 3,
  ADDRESS_IN_USE: 4,
} as const;

/** Error carrying an explicit process exit code for the CLI entry point. */
export class CommandError extends Error {
  override readonly name: string = 'CommandError';
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}
