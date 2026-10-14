import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';

function captureStream(): { stream: { write(chunk: string): void }; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    stream: { write: (chunk: string) => void lines.push(chunk) },
  };
}

describe('createLogger', () => {
  it('emits JSON lines with level, message and fields', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger('info', stream);
    logger.info('hello', { count: 3 });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(record['level']).toBe('info');
    expect(record['message']).toBe('hello');
    expect(record['count']).toBe(3);
    expect(typeof record['time']).toBe('string');
  });

  it('filters below the configured level', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger('warn', stream);
    logger.debug('nope');
    logger.info('nope');
    logger.warn('yes');
    logger.error('yes');
    expect(lines).toHaveLength(2);
  });

  it('never throws on unserializable fields', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger('debug', stream);
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => logger.debug('circular', { circular })).not.toThrow();
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(record['fieldsError']).toBe('unserializable');
  });

  it('falls back to an empty object when serialization yields undefined', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger('debug', stream);
    // A field that hijacks toJSON can make JSON.stringify return undefined.
    logger.info('custom toJSON', { toJSON: () => undefined });
    expect(lines[0]?.trim()).toBe('{}');
  });
});
