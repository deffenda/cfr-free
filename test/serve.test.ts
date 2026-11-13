import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { runServeCommand } from '../src/commands/serve.js';
import { CommandError } from '../src/exit-codes.js';
import { createTestLogger, openTempStore } from './helpers.js';

describe('serve command', () => {
  it('reports the URL it is serving, in plain language', async () => {
    // The structured log carries the URL too, but a log line is not what
    // the person who started the server reads to find out where it is.
    const temp = openTempStore();
    const controller = new AbortController();
    let served: string | null = null;
    try {
      // A free port: the OS picks one, the reservation is released, and
      // the server binds it a moment later.
      const probe = net.createServer();
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      const config = loadConfig({
        CFR_INDEX_PATH: temp.indexPath,
        CFR_PORT: String(port),
        CFR_AUTO_SYNC: '0',
      });
      const running = runServeCommand(config, createTestLogger(), {
        onListening: (url) => {
          served = url;
        },
        stop: controller.signal,
      });
      // The port is chosen by the OS, so the URL is only known once the
      // server is up.
      for (let attempt = 0; attempt < 100 && served === null; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(served).not.toBeNull();
      expect(String(served)).toBe(`http://127.0.0.1:${port}`);
      controller.abort();
      expect(await running).toBe(0);
    } finally {
      temp.cleanup();
    }
  });

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
