/**
 * The error types the whole service speaks.
 *
 * WHY THIS FILE EXISTS. `ServiceError` lived in `src/core/service.ts`, which
 * the core domain modules (`diff.ts`, `redline.ts`, `historical.ts`,
 * `archive.ts`) had to import to throw a domain error — and `service.ts`
 * imports those modules back. The two value-import cycles were benign only
 * because the class was REFERENCED inside function bodies, so its temporal
 * dead zone was never reached at module-evaluation time. That is a
 * coincidence, not a guarantee: moving one construction to a module's top
 * level would make the program throw a ReferenceError at import time.
 *
 * The deeper smell was the inverted dependency — a core domain module
 * importing a FACADE module to throw a domain error. The errors live here
 * now, and nothing imports a facade to throw one.
 */

/**
 * The codes a service failure carries.
 *
 * `invalid_input` is the READER's mistake (exit 2 on the CLI, HTTP 400) and
 * `not_found` is a missing provision (HTTP 404). `unavailable` is neither:
 * it is a DEPLOYMENT fault — the service was wired without the client it
 * needs — so it is a service failure (exit 1, HTTP 500), never a usage
 * error a script would retry forever.
 */
export type ServiceErrorCode = 'invalid_input' | 'not_found' | 'unavailable';

/** Domain error carrying a machine-readable code and client-safe message. */
export class ServiceError extends Error {
  override readonly name = 'ServiceError';
  readonly code: ServiceErrorCode;

  constructor(message: string, code: ServiceErrorCode) {
    super(message);
    this.code = code;
  }
}

/** Raised when navigation input does not match the structure. */
export class StructureError extends Error {
  override readonly name = 'StructureError';
  readonly available: readonly string[];

  constructor(message: string, available: readonly string[] = []) {
    super(message);
    this.available = available;
  }
}
