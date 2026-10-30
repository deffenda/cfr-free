import { HttpError } from '../core/http-client.js';

/** An upstream failure, split into what a reader needs and what an operator needs. */
export interface UpstreamFailure {
  /** One clause a reader can act on. */
  readonly reason: string;
  /** The upstream path, for the log. */
  readonly url: string;
  /** The upstream status, when there was one. */
  readonly status: number | undefined;
  /** The raw message, for the log. */
  readonly detail: string;
}

/**
 * The upstream failure behind an error, or null when the error is not an
 * upstream one.
 *
 * The upstream path stays OUT of the user-facing text: no user action
 * depends on which endpoint failed, and the raw message — "request failed
 * for /api/versioner/v1/full/2026-01-01/title-38.xml: fetch failed" — is
 * developer-facing. The detail belongs in the structured log, where it
 * belongs.
 *
 * Every command that reaches eCFR can fail this way: the index sync, and
 * the `historical`, `diff` and `redline` reads, which fetch the upstream
 * document directly.
 */
export function upstreamFailure(error: unknown): UpstreamFailure | null {
  if (!(error instanceof HttpError)) return null;
  return {
    reason:
      error.status === undefined
        ? 'eCFR could not be reached'
        : `eCFR answered HTTP ${error.status}`,
    url: error.url,
    status: error.status,
    detail: error.message,
  };
}
