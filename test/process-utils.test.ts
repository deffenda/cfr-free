import { describe, expect, it, vi } from 'vitest';
import { createShutdownController } from '../src/process-utils.js';
import { createTestLogger } from './helpers.js';

describe('createShutdownController', () => {
  it('runs cleanup once and exits 0', async () => {
    const cleanup = vi.fn();
    const exit = vi.fn();
    const controller = createShutdownController(cleanup, { exit, logger: createTestLogger() });

    await controller.handle('SIGINT');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(controller.shuttingDown).toBe(true);
  });

  it('forces exit on a second signal without re-running cleanup', async () => {
    const cleanup = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const exit = vi.fn();
    const controller = createShutdownController(cleanup, { exit, logger: createTestLogger() });

    const first = controller.handle('SIGTERM');
    await controller.handle('SIGTERM');
    expect(exit).toHaveBeenCalledWith(1);
    await first;
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits 1 when cleanup fails', async () => {
    const exit = vi.fn();
    const controller = createShutdownController(
      () => {
        throw new Error('cleanup blew up');
      },
      { exit, logger: createTestLogger() },
    );

    await controller.handle('SIGINT');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
