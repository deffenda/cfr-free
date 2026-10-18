import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('provides safe defaults', () => {
    const config = loadConfig({});
    expect(config.indexPath).toMatch(/\.cfr-free\/index\.sqlite$/);
    expect(config.maxAgeDays).toBe(7);
    expect(config.autoSync).toBe(true);
    expect(config.refreshHours).toBe(0);
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8787);
    expect(config.allowRemote).toBe(false);
    expect(config.logLevel).toBe('info');
  });

  it('honors explicit values', () => {
    const config = loadConfig({
      CFR_INDEX_PATH: '/tmp/custom.sqlite',
      CFR_MAX_AGE_DAYS: '0',
      CFR_AUTO_SYNC: '0',
      CFR_REFRESH_HOURS: '24',
      CFR_HOST: 'localhost',
      CFR_PORT: '9999',
      CFR_LOG_LEVEL: 'debug',
    });
    expect(config.indexPath).toBe('/tmp/custom.sqlite');
    expect(config.maxAgeDays).toBe(0);
    expect(config.autoSync).toBe(false);
    expect(config.refreshHours).toBe(24);
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(9999);
    expect(config.logLevel).toBe('debug');
  });

  it('rejects non-loopback binds without explicit opt-in', () => {
    expect(() => loadConfig({ CFR_HOST: '0.0.0.0' })).toThrow(ConfigError);
    expect(() => loadConfig({ CFR_HOST: '0.0.0.0', CFR_ALLOW_REMOTE: '1' })).not.toThrow();
  });

  it.each([
    [{ CFR_PORT: '0' }, 'CFR_PORT'],
    [{ CFR_PORT: '99999' }, 'CFR_PORT'],
    [{ CFR_MAX_AGE_DAYS: '999' }, 'CFR_MAX_AGE_DAYS'],
    [{ CFR_MAX_AGE_DAYS: 'soon' }, 'CFR_MAX_AGE_DAYS'],
    [{ CFR_REFRESH_HOURS: '169' }, 'CFR_REFRESH_HOURS'],
    [{ CFR_REFRESH_HOURS: 'abc' }, 'CFR_REFRESH_HOURS'],
    [{ CFR_AUTO_SYNC: 'yes' }, 'CFR_AUTO_SYNC'],
    [{ CFR_LOG_LEVEL: 'loud' }, 'CFR_LOG_LEVEL'],
    [{ CFR_INDEX_PATH: '' }, 'CFR_INDEX_PATH'],
  ])('rejects %j', (env, expected) => {
    expect(() => loadConfig(env)).toThrow(expected);
  });

  it('produces actionable remote-bind guidance', () => {
    expect(() => loadConfig({ CFR_HOST: '10.0.0.5' })).toThrow(/CFR_ALLOW_REMOTE=1/);
  });

  it('names the environment when a failure carries no field path', () => {
    expect(() => loadConfig(null as never)).toThrow(/env:/);
  });
});
