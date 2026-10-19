import { describe, expect, it } from 'vitest';
import { readVersionFrom } from '../src/version.js';

describe('readVersionFrom', () => {
  it('falls back to 0.0.0 when the underlying require throws', () => {
    const failing = (): never => {
      throw new Error('synthetic');
    };
    expect(readVersionFrom(failing as unknown as NodeRequire)).toBe('0.0.0');
  });

  it("falls back to '0.0.0' when pkg.version is not a string", () => {
    const requireFn = ((): unknown => ({ version: 42 })) as unknown as NodeRequire;
    expect(readVersionFrom(requireFn)).toBe('0.0.0');
    const missing = ((): unknown => ({})) as unknown as NodeRequire;
    expect(readVersionFrom(missing)).toBe('0.0.0');
  });
});
