import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { runServeCommand } from '../src/commands/serve.js';
import { CommandError } from '../src/exit-codes.js';
import { createTestLogger, openTempStore } from './helpers.js';

describe('serve command', () => {
  it('reports a bound port with exit code 4', async () => {
    const temp = openTempStore();
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const address = blocker.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const config = loadConfig({
        CFR_INDEX_PATH: temp.indexPath,
        CFR_PORT: String(port),
        CFR_AUTO_SYNC: '0',
      });
      let caught: unknown;
      try {
        await runServeCommand(config, createTestLogger());
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CommandError);
      expect((caught as CommandError).exitCode).toBe(4);
      expect((caught as Error).message).toMatch(/already in use/);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      temp.cleanup();
    }
  });
});
