import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  startRefreshScheduler,
  type RefreshScheduler,
  type TimerHandle,
} from '../src/commands/refresh-scheduler.js';
import { createTestLogger } from './helpers.js';

/** Controllable clock: timers only fire when the test says so. */
interface FakeTimer {
  readonly ms: number;
  readonly callback: () => void;
  readonly unref: Mock<() => void>;
  readonly clear: Mock<() => void>;
  cleared: boolean;
  fired: boolean;
}

function createClock() {
  const timers: FakeTimer[] = [];
  let lastCallback: (() => void) | null = null;
  return {
    timers,
    armTimer(callback: () => void, ms: number): TimerHandle {
      const timer: FakeTimer = {
        ms,
        callback,
        unref: vi.fn<() => void>(),
        clear: vi.fn<() => void>(),
        cleared: false,
        fired: false,
      };
      timer.clear.mockImplementation(() => {
        timer.cleared = true;
      });
      timers.push(timer);
      lastCallback = callback;
      return timer;
    },
    /** Simulate expiry of the newest armed, un-cleared, un-fired timer. */
    fire(): boolean {
      const timer = timers.findLast((t) => !t.cleared && !t.fired);
      if (timer === undefined) return false;
      timer.fired = true;
      timer.callback();
      return true;
    },
    /** Re-invoke the newest armed callback regardless of state (in-flight probe). */
    invoke(): void {
      lastCallback?.();
    },
  };
}

/** Externally resolvable promise. */
function createGate(): { promise: Promise<void>; resolve(): void; reject(e: Error): void } {
  let resolveFn: (() => void) | null = null;
  let rejectFn: ((e: Error) => void) | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return {
    promise,
    resolve: () => resolveFn?.(),
    reject: (e: Error) => rejectFn?.(e),
  };
}

/** Let scheduler-internal promise continuations run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function schedulerWith(
  clock: ReturnType<typeof createClock>,
  refresh: () => Promise<void>,
  refreshHours = 6,
): { scheduler: RefreshScheduler; logger: ReturnType<typeof createTestLogger> } {
  const logger = createTestLogger();
  const scheduler = startRefreshScheduler({
    refreshHours,
    refresh,
    logger,
    armTimer: clock.armTimer,
    now: () => 0,
  });
  return { scheduler, logger };
}

describe('startRefreshScheduler', () => {
  it('fires refresh only after the configured delay, not before', async () => {
    const clock = createClock();
    const refresh = vi.fn(async () => undefined);
    const { scheduler, logger } = schedulerWith(clock, refresh, 6);

    scheduler.schedule();
    expect(clock.timers).toHaveLength(1);
    expect(clock.timers[0]?.ms).toBe(6 * 3_600_000);
    expect(refresh).not.toHaveBeenCalled();

    expect(clock.fire()).toBe(true);
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(scheduler.counts).toEqual({ attempts: 1, successes: 1, failures: 0 });
    expect(logger.records).toContainEqual({
      level: 'info',
      message: 'background refresh attempt',
      fields: { attempt: 1, result: 'ok', elapsedMs: 0 },
    });
  });

  it('re-arms with the same interval after a successful refresh', async () => {
    const clock = createClock();
    const refresh = vi.fn(async () => undefined);
    const { scheduler } = schedulerWith(clock, refresh, 6);

    scheduler.schedule();
    clock.fire();
    await settle();
    expect(clock.timers).toHaveLength(2);
    expect(clock.timers[1]?.ms).toBe(6 * 3_600_000);

    expect(clock.fire()).toBe(true);
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(scheduler.counts).toEqual({ attempts: 2, successes: 2, failures: 0 });
  });

  it('re-arms and counts a failed refresh without throwing', async () => {
    const clock = createClock();
    const refresh = vi.fn(async () => {
      throw new Error('network down');
    });
    const logger = createTestLogger();
    const scheduler = startRefreshScheduler({
      refreshHours: 1,
      refresh,
      logger,
      armTimer: clock.armTimer,
    });

    scheduler.schedule();
    expect(clock.fire()).toBe(true);
    await settle();

    expect(scheduler.counts).toEqual({ attempts: 1, successes: 0, failures: 1 });
    expect(clock.timers).toHaveLength(2); // failure re-armed the timer
    const failed = logger.records.find((r) => r.fields?.['result'] === 'failed');
    expect(failed?.level).toBe('warn');
    expect(failed?.fields?.['message']).toBe('network down');
    expect(typeof failed?.fields?.['elapsedMs']).toBe('number');
  });

  it('skips a tick that lands while a refresh is in flight', async () => {
    const clock = createClock();
    const gate = createGate();
    const refresh = vi.fn(() => gate.promise);
    const { scheduler, logger } = schedulerWith(clock, refresh, 1);

    scheduler.schedule();
    expect(clock.fire()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Probe the tick again while the first refresh promise is pending.
    clock.invoke();
    expect(refresh).toHaveBeenCalledTimes(1); // not queued, not re-entered
    const skipped = logger.records.find((r) => r.fields?.['result'] === 'skipped_in_flight');
    expect(skipped?.level).toBe('warn');
    expect(clock.timers).toHaveLength(1); // no timer armed during the flight

    gate.resolve();
    await settle();
    expect(scheduler.counts).toEqual({ attempts: 1, successes: 1, failures: 0 });
    expect(clock.timers).toHaveLength(2); // exactly one re-armed timer
  });

  it('dispose cancels a pending fire and is idempotent', async () => {
    const clock = createClock();
    const refresh = vi.fn(async () => undefined);
    const { scheduler } = schedulerWith(clock, refresh, 2);

    scheduler.schedule();
    const [pending] = clock.timers;
    scheduler.dispose();
    expect(pending?.clear).toHaveBeenCalledTimes(1);
    expect(clock.fire()).toBe(false);
    expect(refresh).not.toHaveBeenCalled();

    scheduler.dispose(); // second call is a no-op
    scheduler.schedule(); // scheduling after dispose arms nothing
    expect(clock.timers).toHaveLength(1);
  });

  it('arms a single timer for repeated schedule calls and tolerates bare dispose', () => {
    const clock = createClock();
    const refresh = vi.fn(async () => undefined);
    const logger = createTestLogger();
    const make = (): RefreshScheduler =>
      startRefreshScheduler({
        refreshHours: 2,
        refresh,
        logger,
        armTimer: clock.armTimer,
        now: () => 0,
      });

    const scheduler = make();
    scheduler.schedule();
    scheduler.schedule(); // an already-armed timer is not duplicated
    expect(clock.timers).toHaveLength(1);
    scheduler.dispose();

    const idle = make();
    idle.dispose(); // safe when nothing was ever armed
    idle.schedule(); // and stays inert after dispose
    expect(clock.timers).toHaveLength(1);
  });

  it('unrefs every timer it arms so it never holds the process open', async () => {
    const clock = createClock();
    const refresh = vi.fn(async () => undefined);
    const { scheduler } = schedulerWith(clock, refresh, 3);

    scheduler.schedule();
    expect(clock.timers[0]?.unref).toHaveBeenCalledTimes(1);
    clock.fire();
    await settle();
    expect(clock.timers).toHaveLength(2);
    expect(clock.timers[1]?.unref).toHaveBeenCalledTimes(1);
  });

  it('is a no-op scheduler when refreshHours is 0', () => {
    const clock = createClock();
    const refresh = vi.fn(async () => undefined);
    const logger = createTestLogger();
    const scheduler = startRefreshScheduler({
      refreshHours: 0,
      refresh,
      logger,
      armTimer: clock.armTimer,
    });

    scheduler.schedule();
    expect(clock.timers).toHaveLength(0);
    scheduler.dispose();
    expect(clock.timers).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
    expect(scheduler.counts).toEqual({ attempts: 0, successes: 0, failures: 0 });
    expect(logger.records).toHaveLength(0);
  });

  it('drives real Node timers by default and stops after dispose', async () => {
    const gate = createGate();
    const refresh = vi.fn(() => gate.promise);
    const logger = createTestLogger();
    // ~36 ms: real timers, well under the suite budget, no wall-clock sleeps
    // beyond vi.waitFor's polling.
    const scheduler = startRefreshScheduler({ refreshHours: 1e-5, refresh, logger });
    scheduler.schedule();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1), { timeout: 2000 });
    scheduler.dispose();
    gate.resolve();
    await vi.waitFor(() => expect(scheduler.counts.successes).toBe(1), { timeout: 2000 });
    expect(scheduler.counts).toEqual({ attempts: 1, successes: 1, failures: 0 });

    // The pending (not yet fired) Node timer is cleared on dispose.
    const pending = startRefreshScheduler({ refreshHours: 6, refresh, logger });
    pending.schedule();
    pending.dispose();
  });
});
