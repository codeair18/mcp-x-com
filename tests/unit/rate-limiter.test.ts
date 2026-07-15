import { describe, expect, it } from 'vitest';
import { WriteRateLimiter } from '../../src/safety/rate-limiter.js';
import { isXError } from '../../src/errors.js';

function makeLimiter(now: () => number) {
  return new WriteRateLimiter({ minIntervalMs: 5_000, maxPerHour: 10 }, now);
}

describe('WriteRateLimiter', () => {
  it('allows the first write', () => {
    const limiter = makeLimiter(() => 0);
    expect(() => limiter.assertWriteAllowed()).not.toThrow();
  });

  it('blocks a second write within 5 seconds', () => {
    let now = 0;
    const limiter = makeLimiter(() => now);
    limiter.assertWriteAllowed();
    limiter.recordWrite();
    now = 4_999;
    try {
      limiter.assertWriteAllowed();
      expect.unreachable();
    } catch (error) {
      expect(isXError(error, 'RATE_LIMITED')).toBe(true);
    }
    now = 5_001;
    expect(() => limiter.assertWriteAllowed()).not.toThrow();
  });

  it('blocks the 11th write within an hour', () => {
    let now = 0;
    const limiter = makeLimiter(() => now);
    for (let i = 0; i < 10; i += 1) {
      now = i * 10_000;
      limiter.assertWriteAllowed();
      limiter.recordWrite();
    }
    now = 200_000;
    try {
      limiter.assertWriteAllowed();
      expect.unreachable();
    } catch (error) {
      expect(isXError(error, 'RATE_LIMITED')).toBe(true);
    }
  });

  it('allows writing again once the hour window slides', () => {
    let now = 0;
    const limiter = makeLimiter(() => now);
    for (let i = 0; i < 10; i += 1) {
      now = i * 10_000;
      limiter.assertWriteAllowed();
      limiter.recordWrite();
    }
    // First write ages out of the 1-hour window.
    now = 3_600_000 + 1;
    expect(() => limiter.assertWriteAllowed()).not.toThrow();
  });
});
