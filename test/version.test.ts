import { describe, expect, it } from 'vitest';
import { readVersionFrom } from '../src/version.js';

describe('readVersionFrom', () => {
  it('falls back to 0.0.0 when the underlying require throws', () => {
    const failing = (): never => {
      throw new Error('synthetic');
    };
    expect(readVersionFrom(failing as unknown as NodeRequire)).toBe('0.0.0');
  });
});
