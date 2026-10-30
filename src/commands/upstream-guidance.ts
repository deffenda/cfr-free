import { HttpError, type HttpFailureKind } from '../core/http-client.js';

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
  /**
   * Which kind of failure this was, for the log.
   *
   * The kind is the machine-readable discriminator: a status alone cannot
   * tell an upstream that answered 200 with a page of HTML from an
   * upstream that answered 200 with a body over the cap, and an operator
   * reading the log should not have to recover that from the English in a
   * message.
   */
  readonly kind: HttpFailureKind;
}

/**
 * What eCFR did, in the reader's words.
 *
 * The reason says what happened, and never says more than the failure
 * knows. A status is reported when there was one; an answer that arrived
 * but was not usable is described as such rather than as the status it
 * happened to carry — "eCFR answered HTTP 200" reads like a success
 * report, and "the response was too large" is what actually happened.
 */
function reasonFor(error: HttpError): string {
  if (error.kind === 'transport') return 'eCFR could not be reached';
  if (error.kind === 'parse') return 'eCFR answered, but not with valid JSON';
  if (error.kind === 'size') return 'eCFR answered, but the response was too large';
  if (error.status === undefined) return 'eCFR answered';
  return `eCFR answered HTTP ${error.status}`;
}

/**
 * What the reader can do next, given what eCFR answered.
 *
 * The advice must not blame the reader's network when eCFR answered: a
 * status means the request reached eCFR and came back. Telling someone to
 * "check your network connection" because eCFR answered 404 is how a reader
 * spends an hour unplugging a router that was never the problem.
 *
 * The same holds for an answer that was not usable. eCFR answered 200 and
 * the body was a page of HTML — a captive portal, a proxy, a CDN error
 * page. The router is fine, and "check your network connection" would send
 * the reader after the wrong thing; what they can do is try again.
 *
 * - no answer at all: the network is the only suspect;
 * - 5xx: eCFR is unwell, and waiting is the only move;
 * - 4xx: eCFR answered and refused. Retrying changes nothing, so no advice
 *   is offered — the reason alone says what happened;
 * - an answer that was not usable: try again, because the upstream did
 *   answer;
 * - an answer over the cap: nothing the reader does changes it.
 */
function adviceFor(error: HttpError): string {
  if (error.kind === 'transport') return 'Check your network connection and try again.';
  if (error.kind === 'parse') return 'Try again in a moment.';
  if (error.kind === 'size') return '';
  if (error.status !== undefined && error.status >= 500) {
    return 'The service is unavailable, so try again later.';
  }
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
    reason: reasonFor(error),
    advice: adviceFor(error),
    url: error.url,
    status,
    detail: error.message,
    kind: error.kind,
  };
}
