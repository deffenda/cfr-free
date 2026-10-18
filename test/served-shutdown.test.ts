/**
 * In-process cementing of the `serve` shutdown contract (PR #22): SIGINT
 * while a background refresh is mid-flight is benign. Mirrors the post-bind
 * lifecycle of src/commands/serve.ts (scheduler + shutdown controller + signal
 * registration) minus the HTTP server — real scheduler, real syncIndex over a
 * controllable fake fetch, real shutdown controller; no child process, no
 * network, no production file touched.
 */
import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/core/http-client.js';
import { EcfrApi } from '../src/core/ecfr.js';
import { syncIndex } from '../src/core/sync.js';
import { Store } from '../src/core/store.js';
import { createShutdownController } from '../src/process-utils.js';
import { startRefreshScheduler } from '../src/commands/refresh-scheduler.js';
import { createTestLogger, FIXTURE_STRUCTURE, openTempStore } from './helpers.js';
import type { RefreshScheduler } from '../src/commands/refresh-scheduler.js';
import type { FetchLike } from '../src/core/http-client.js';
import type { TestLogger, TempStore } from './helpers.js';

const ISSUE_DATE = '2026-10-09';

// Inline copy of sync.test.ts's fixture title XML (that file does not export it).
const FULL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ECFR>
<DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD>
<DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD>
<DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD>
<DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Diagnosis of mental disorders.</HEAD><P>Body text.</P></DIV8>
</DIV5>
<DIV9 N="Appendix A to Part 4" TYPE="APPENDIX"><HEAD>Appendix A to Part 4—Table</HEAD><P>Appendix text.</P></DIV9>
</DIV3>
</ECFR>`;

/** eCFR schedule fixture: title 38 with a usable currency date. */
const SCHEDULE_JSON = {
  titles: [
    {
      number: 38,
      name: 'Pensions, Bonuses, and Veterans\u2019 Relief',
      latest_issue_date: '2026-08-27',
      up_to_date_as_of: ISSUE_DATE,
      latest_amended_on: '2026-08-27',
    },
  ],
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Fetch fixture with a controllable stall on the `/full/` XML request: the
 * request signals `fullRequests()` when issued and parks on a deferred until
 * `releaseFull()` — letting the test interleave shutdown with an in-flight
 * refresh deterministically (no fixed sleeps).
 */
function createRacingFetch(): {
  fetchFn: FetchLike;
  fullRequests: () => number;
  releaseFull(): void;
} {
  let fullRequests = 0;
  let release: (() => void) | null = null;
  const fullGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchFn: FetchLike = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/titles.json')) return json(SCHEDULE_JSON);
    if (url.pathname.includes('/structure/')) return json(FIXTURE_STRUCTURE);
    if (url.pathname.includes('/full/')) {
      fullRequests += 1;
      await fullGate;
      return new Response(FULL_XML, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    }
    return new Response('not found', { status: 404 });
  };
  return {
    fetchFn,
    fullRequests: () => fullRequests,
    releaseFull: () => release?.(),
  };
}

interface LifecycleHarness {
  readonly temp: TempStore;
  readonly logger: TestLogger;
  readonly scheduler: RefreshScheduler;
  /** Codes pushed by the controller's injected `exit`, in call order. */
  readonly exitCodes: number[];
  /** Invoke the exact handler serve registers via `process.once('SIGINT', …)`. */
  fireSigint(): void;
  cleanupRuns(): number;
}

/**
 * Mirror of serve.ts's post-bind lifecycle minus the HTTP server: real
 * scheduler over a real syncIndex, real shutdown controller with serve's
 * cleanup ordering (dispose first, then close the store), and the SIGINT
 * handler captured at its actual `process.once` registration instead of
 * dispatching a real signal.
 */
function wireServeLifecycle(options: {
  refreshHours: number;
  fetchFn: FetchLike;
}): LifecycleHarness {
  const temp = openTempStore();
  const logger = createTestLogger();
  const ecfr = new EcfrApi(
    new HttpClient({
      fetchFn: options.fetchFn,
      sleep: async () => undefined,
      retryDelayMs: 0,
      retries: 0,
    }),
  );
  const scheduler = startRefreshScheduler({
    refreshHours: options.refreshHours,
    logger,
    // Exactly as serve does: wrap syncIndex so the refresh returns void.
    refresh: async () => {
      await syncIndex({ ecfr, store: temp.store, logger });
    },
    // Tiny constant delay so the real (unref'd) timer fires promptly.
    nextDelayMs: () => 20,
  });
  scheduler.schedule(); // armed after the "bind", exactly as serve does

  const exitCodes: number[] = [];
  let cleanupRuns = 0;
  const shutdown = createShutdownController(
    () => {
      // Serve's cleanup ordering minus server.close(): dispose the scheduler
      // first so an in-flight attempt cannot re-arm, then close the store.
      cleanupRuns += 1;
      scheduler.dispose();
      temp.store.close();
    },
    { exit: (code) => exitCodes.push(code), logger },
  );

  // vi.spyOn keeps the original implementation, so the handler is genuinely
  // registered; we only observe the registration to capture its reference.
  const onceSpy = vi.spyOn(process, 'once');
  try {
    process.once('SIGINT', () => void shutdown.handle('SIGINT'));
    const registration = onceSpy.mock.calls.find((call) => call[0] === 'SIGINT');
    const handler = registration?.[1];
    if (typeof handler !== 'function') {
      throw new Error('expected serve-style registration to capture a SIGINT handler');
    }
    // Detach so the captured handler only fires when the test invokes it.
    process.removeListener('SIGINT', handler);
    return {
      temp,
      logger,
      scheduler,
      exitCodes,
      fireSigint: () => void handler(),
      cleanupRuns: () => cleanupRuns,
    };
  } finally {
    onceSpy.mockRestore();
  }
}

/** Counters for crashes the scheduler is supposed to swallow. */
function installCrashGuard(): {
  rejections: unknown[];
  exceptions: unknown[];
  uninstall(): void;
} {
  const rejections: unknown[] = [];
  const exceptions: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    rejections.push(reason);
  };
  const onException = (error: unknown): void => {
    exceptions.push(error);
  };
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  return {
    rejections,
    exceptions,
    uninstall(): void {
      process.off('unhandledRejection', onRejection);
      process.off('uncaughtException', onException);
    },
  };
}

/** One event-loop turn so any pending unhandled-rejection notice surfaces. */
function flushEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function reopenAndQuery(indexPath: string): number {
  const reopened = Store.open(indexPath);
  try {
    return reopened.countSections();
  } finally {
    reopened.close();
  }
}

describe('serve shutdown under an in-flight background refresh', () => {
  it('SIGINT while the refresh fetch is in flight exits 0 with no unhandled rejections', async () => {
    const guard = installCrashGuard();
    const { fetchFn, fullRequests, releaseFull } = createRacingFetch();
    const harness = wireServeLifecycle({ refreshHours: 0.001, fetchFn });
    try {
      // The scheduler's first fire reaches the /full/ fetch and parks there.
      await vi.waitFor(() => expect(fullRequests()).toBe(1), { timeout: 5000 });

      // Shutdown first: dispose the scheduler, close the store, exit(0) —
      // all while the refresh's XML fetch is still parked.
      harness.fireSigint();
      await vi.waitFor(() => expect(harness.exitCodes).toEqual([0]), { timeout: 10_000 });

      // Now the fetch resolves: the refresh walks into parse + write on a
      // closed store. Either terminal state is contract-compliant; a crash
      // or a re-arm is not.
      releaseFull();
      await vi.waitFor(
        () =>
          expect(harness.scheduler.counts.successes + harness.scheduler.counts.failures).toBe(1),
        { timeout: 10_000 },
      );
      expect(harness.scheduler.counts.attempts).toBe(1); // no re-arm after dispose
      const attempt = harness.logger.records.find(
        (record) => record.message === 'background refresh attempt',
      );
      expect(attempt?.fields?.['result']).toMatch(/^(ok|failed)$/);

      // The index file survives the race: reopen it and run a trivial query.
      expect(reopenAndQuery(harness.temp.indexPath)).toBeGreaterThan(0);

      await flushEventLoop();
      expect(guard.exceptions).toEqual([]);
      expect(guard.rejections).toEqual([]);
    } finally {
      harness.temp.cleanup();
      guard.uninstall();
    }
  });

  it('SIGINT with an inert scheduler exits 0 and closes the store cleanly', async () => {
    const guard = installCrashGuard();
    let fetchCalls = 0;
    const fetchFn: FetchLike = async () => {
      fetchCalls += 1;
      return new Response('not found', { status: 404 });
    };
    const harness = wireServeLifecycle({ refreshHours: 0, fetchFn });
    try {
      harness.fireSigint(); // immediately after the bind-equivalent wiring
      await vi.waitFor(() => expect(harness.exitCodes).toEqual([0]), { timeout: 10_000 });
      expect(harness.cleanupRuns()).toBe(1);
      expect(harness.scheduler.counts).toEqual({ attempts: 0, successes: 0, failures: 0 });
      expect(fetchCalls).toBe(0); // refreshHours 0 never arms a timer
      expect(harness.logger.records.some((record) => record.message === 'shutting down')).toBe(
        true,
      );
      expect(reopenAndQuery(harness.temp.indexPath)).toBeGreaterThan(0);

      await flushEventLoop();
      expect(guard.exceptions).toEqual([]);
      expect(guard.rejections).toEqual([]);
    } finally {
      harness.temp.cleanup();
      guard.uninstall();
    }
  });

  it('a second signal forces exit(1) with cleanup running exactly once', async () => {
    const guard = installCrashGuard();
    const fetchFn: FetchLike = async () => new Response('not found', { status: 404 });
    const harness = wireServeLifecycle({ refreshHours: 0, fetchFn });
    try {
      harness.fireSigint();
      await vi.waitFor(() => expect(harness.exitCodes).toEqual([0]), { timeout: 10_000 });

      // Second delivery reaches the controller's forced-exit branch.
      harness.fireSigint();
      await vi.waitFor(() => expect(harness.exitCodes).toEqual([0, 1]), { timeout: 10_000 });
      expect(harness.cleanupRuns()).toBe(1);
      const forced = harness.logger.records.find(
        (record) => record.message === 'second signal received, forcing exit',
      );
      expect(forced?.level).toBe('warn');

      await flushEventLoop();
      expect(guard.exceptions).toEqual([]);
      expect(guard.rejections).toEqual([]);
    } finally {
      harness.temp.cleanup();
      guard.uninstall();
    }
  });
});
