import type { Logger } from '../logger.js';

/**
 * Opt-in periodic index refresh for long-running `serve`/`mcp` processes
 * (ROADMAP #17): re-runs the startup sync path every `refreshHours` so
 * staleness repairs itself mid-flight. Disabled (no timer at all) when
 * `refreshHours` is 0.
 *
 * The timer is unref'd and every callback is fully guarded, so the scheduler
 * can never hold the process open or crash it — a failed attempt just logs a
 * warn line and re-arms for the next interval.
 */

/** Running totals of background refresh attempts since start. */
export interface ScheduledRefreshCounts {
  readonly attempts: number;
  readonly successes: number;
  readonly failures: number;
}

/** Minimal timer surface the scheduler needs; Node's `Timeout` satisfies it. */
export interface TimerHandle {
  /** Stop the timer from keeping the event loop alive by itself. */
  unref(): void;
  /** Cancel the pending fire; safe once fired or already cleared. */
  clear(): void;
}

export interface RefreshScheduler {
  /** Arm the first timer; fires once per interval, never immediately. */
  schedule(): void;
  /** Cancel any pending timer; idempotent and safe when nothing is pending. */
  dispose(): void;
  readonly counts: ScheduledRefreshCounts;
}

export interface RefreshSchedulerDeps {
  /** Hours between refreshes; 0 (the default) disables the scheduler. */
  readonly refreshHours: number;
  /** Runs one refresh; throwing is OK and counts as a failed attempt. */
  readonly refresh: () => Promise<void>;
  readonly logger: Logger;
  /** Delay between fires; injectable so tests avoid hour-long timers. */
  readonly nextDelayMs?: (hours: number) => number;
  /** Arms an unref'd, clearable timer; injectable for tests. */
  readonly armTimer?: (callback: () => void, ms: number) => TimerHandle;
  /** Monotonic-enough clock for elapsed-time logs; injectable for tests. */
  readonly now?: () => number;
}

const HOUR_MS = 3_600_000;

/** Node timers wrapped so callers never see (or cast to) `NodeJS.Timeout`. */
const armNodeTimer = (callback: () => void, ms: number): TimerHandle => {
  const timer = setTimeout(callback, ms);
  return {
    unref: () => void timer.unref(),
    clear: () => clearTimeout(timer),
  };
};

/**
 * Start the background refresh loop.
 *
 * `schedule()` arms a single timer for `+refreshHours` (the startup path
 * already synced, so the first refresh is never immediate). Each fire runs
 * `refresh()` — success logs an ok attempt, failure logs a warn attempt —
 * and re-arms for the next interval. A fire landing while a previous
 * refresh is still running is skipped rather than queued.
 */
export function startRefreshScheduler(deps: RefreshSchedulerDeps): RefreshScheduler {
  const { refreshHours, refresh, logger } = deps;
  const nextDelayMs = deps.nextDelayMs ?? ((hours: number): number => hours * HOUR_MS);
  const armTimer = deps.armTimer ?? armNodeTimer;
  const now = deps.now ?? Date.now;

  if (refreshHours <= 0) {
    return {
      schedule: () => undefined,
      dispose: () => undefined,
      counts: { attempts: 0, successes: 0, failures: 0 },
    };
  }

  let timer: TimerHandle | null = null;
  let disposed = false;
  let running = false;
  let attempts = 0;
  let successes = 0;
  let failures = 0;

  const tick = (): void => {
    // The firing timer is consumed before the single-flight check, so a
    // mid-refresh fire is skipped rather than stacked behind a second timer.
    timer = null;
    if (running) {
      // Single-flight: one timer should never double-fire, but if a tick
      // lands mid-refresh, skip it — the in-flight attempt re-arms on settle.
      logger.warn('background refresh skipped', {
        result: 'skipped_in_flight',
        intervalHours: refreshHours,
      });
      return;
    }
    running = true;
    attempts += 1;
    const attempt = attempts;
    const startedAt = now();
    void (async () => {
      try {
        await refresh();
        successes += 1;
        logger.info('background refresh attempt', {
          attempt,
          result: 'ok',
          elapsedMs: now() - startedAt,
        });
      } catch (error) {
        failures += 1;
        logger.warn('background refresh attempt', {
          attempt,
          result: 'failed',
          elapsedMs: now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        running = false;
        if (!disposed) arm();
      }
    })();
  };

  const arm = (): void => {
    timer = armTimer(tick, nextDelayMs(refreshHours));
    timer.unref();
  };

  return {
    schedule(): void {
      if (disposed || timer !== null) return;
      arm();
    },
    dispose(): void {
      disposed = true;
      timer?.clear();
      timer = null;
    },
    get counts(): ScheduledRefreshCounts {
      return { attempts, successes, failures };
    },
  };
}
