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

/** The codes a service failure carries. */
export type ServiceErrorCode = 'invalid_input' | 'not_found';

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

/**
 * Raised when the upstream's DATA is not what this service expects.
 *
 * WHY THIS CLASS EXISTS. CR-21 found three upstream-data faults raised as a
 * bare `Error` (`src/core/ecfr.ts`): eCFR returned a date that is not a date,
 * `titles.json` did not include Title 38, and `titles.json` reported no issue
 * date for it. A bare `Error` is indistinguishable from an internal fault,
 * so the HTTP layer classified them as "anything else" → logged and
 * collapsed into a generic `500 internal server error`. The most actionable
 * messages in the codebase were the ones being swallowed.
 *
 * These are not the reader's fault and not ours either: the upstream sent
 * something the contract does not allow. The HTTP surface answers 502 (Bad
 * Gateway) and the server keeps the detail in the log.
 */
export class UpstreamFormatError extends Error {
  override readonly name = 'UpstreamFormatError';

  constructor(message: string) {
    super(message);
  }
}
