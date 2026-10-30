import { HttpError } from '../core/http-client.js';

/** An upstream failure, split into what a reader needs and what an operator needs. */
export interface UpstreamFailure {
  /** One clause a reader can act on. */
  readonly reason: string;
  /** What to do next, or empty when nothing the reader does will help. */
  readonly advice: string;
  /** The upstream path, for the log. */
  readonly url: string;
  /** The upstream status, when there was one. */
  readonly status: number | undefined;
  /** The raw message, for the log. */
  readonly detail: string;
}

/**
 * What the reader can do next, given what eCFR answered.
 *
 * The advice must not blame the reader's network when eCFR answered: a
 * status means the request reached eCFR and came back. Telling someone to
 * "check your network connection" because eCFR answered 404 is how a reader
 * spends an hour unplugging a router that was never the problem.
 *
 * - no answer at all: the network is the only suspect;
 * - 5xx: eCFR is unwell, and waiting is the only move;
 * - 4xx: eCFR answered and refused. Retrying changes nothing, so no advice
 *   is offered — the reason alone says what happened.
 */
function adviceFor(status: number | undefined): string {
  if (status === undefined) return 'Check your network connection and try again.';
  if (status >= 500) return 'The service is unavailable, so try again later.';
  return '';
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
  const status = error.status;
  return {
    reason: status === undefined ? 'eCFR could not be reached' : `eCFR answered HTTP ${status}`,
    advice: adviceFor(status),
    url: error.url,
    status,
    detail: error.message,
  };
}
