import { describe, expect, it } from 'vitest';
import { Semaphore } from '../src/core/semaphore.js';

/** Wait until the predicate holds, so the test does not count microtasks. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe('Semaphore', () => {
  it('runs at most `permits` tasks at a time', async () => {
    // The bound this exists for: the upstream document fetches must not
    // pile up, whatever the request rate is.
    const semaphore = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const release: Array<() => void> = [];

    const task = (): Promise<void> =>
      semaphore.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => release.push(resolve));
        running -= 1;
      });

    const started = [task(), task(), task(), task()];
    // Two permits are free, so two tasks are running and two are waiting.
    await waitFor(() => running === 2);
    expect(running).toBe(2);
    expect(peak).toBe(2);

    release.splice(0).forEach((resolve) => resolve());
    await waitFor(() => running === 2 && release.length === 2);
    expect(running).toBe(2);

    release.splice(0).forEach((resolve) => resolve());
    await waitFor(() => running === 0);

    await Promise.all(started);
    expect(running).toBe(0);
    expect(peak).toBe(2);
  });

  it('releases its permit when the task fails', async () => {
    const semaphore = new Semaphore(1);
    await expect(
      semaphore.run(async () => {
        throw new Error('upstream said no');
      }),
    ).rejects.toThrow('upstream said no');
    // The permit came back: the next task runs instead of waiting for a
    // permit that will never be returned.
    await expect(semaphore.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('treats a zero permit count as one', async () => {
    const semaphore = new Semaphore(0);
    await expect(semaphore.run(async () => 'ok')).resolves.toBe('ok');
  });
});
