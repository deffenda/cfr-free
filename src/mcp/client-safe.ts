import { ServiceError, StructureError } from '../core/errors.js';

/**
 * Client-safe error text for the MCP surface — the parity fix for SPEC §7
 * ("all error paths return sanitized messages"). Before this module, the MCP
 * tool/resource handlers passed `error.message` through for any `Error`, while
 * the HTTP layer (src/titan/http-server.ts dispatch catch) returned the fixed
 * generic for unrecognized errors. Both surfaces now share one contract:
 *
 * - `ServiceError` / `StructureError` messages are documented user-facing
 *   guidance (e.g. "run `cfr-free sync`", "part '999' not found …" with its
 *   `available` alternatives) → returned verbatim, exactly as HTTP serves them
 *   (http-server.ts returns `error.message` for these two classes).
 * - Everything else → the fixed `'internal server error'`.
 *
 * The discriminator is the error class itself, never a structural `code`
 * field: `ServiceError` is the only src/ class carrying `code`, and a
 * string-`code` test would admit Node errno errors (ENOENT, SQLITE_CANTOPEN)
 * whose messages embed file paths — the exact leak this module closes.
 *
 * No logger parameter: each caller logs the full detail server-side first
 * (`error instanceof Error ? error.message : String(error)`, mirroring
 * http-server.ts), so sanitization applies to the wire only.
 */
function isClientSafe(error: unknown): error is ServiceError | StructureError {
  return error instanceof ServiceError || error instanceof StructureError;
}

/** Sanitized message for the client: guidance verbatim, everything else generic. */
export function clientSafeMessage(error: unknown): string {
  return isClientSafe(error) ? error.message : 'internal server error';
}
