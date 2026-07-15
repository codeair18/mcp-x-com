import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logger.js';

describe('createLogger', () => {
  it('creates a logger at the requested level', () => {
    const logger = createLogger('debug');
    expect(logger.level).toBe('debug');
  });
});
