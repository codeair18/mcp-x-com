import { describe, expect, it } from 'vitest';
import { ActionStore } from '../../src/safety/action-store.js';
import { isXError } from '../../src/errors.js';

const TTL = 120_000;

function makeStore(now: () => number) {
  return new ActionStore(TTL, now);
}

const draft = {
  kind: 'post' as const,
  account: 'testuser',
  preview: 'Hello world',
  payload: { text: 'Hello world' },
};

describe('ActionStore', () => {
  it('issues opaque, unique, sufficiently long tokens', () => {
    const store = makeStore(() => 0);
    const a = store.create(draft);
    const b = store.create(draft);
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThanOrEqual(32);
    expect(a.id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('sets expiry from the TTL', () => {
    const store = makeStore(() => 1_000);
    const action = store.create(draft);
    expect(action.expiresAt).toBe(1_000 + TTL);
  });

  it('freezes the stored action and payload', () => {
    const store = makeStore(() => 0);
    const action = store.create(draft);
    expect(Object.isFrozen(action)).toBe(true);
    expect(Object.isFrozen(action.payload)).toBe(true);
  });

  it('consume returns the action exactly once', () => {
    const store = makeStore(() => 0);
    const action = store.create(draft);
    const consumed = store.consume(action.id);
    expect(consumed.preview).toBe('Hello world');
    expect(() => store.consume(action.id)).toThrow(/no prepared action/i);
  });

  it('rejects unknown tokens with CONFIRMATION_REQUIRED', () => {
    const store = makeStore(() => 0);
    try {
      store.consume('bogus-token');
      expect.unreachable();
    } catch (error) {
      expect(isXError(error, 'CONFIRMATION_REQUIRED')).toBe(true);
    }
  });

  it('rejects expired tokens with CONFIRMATION_EXPIRED and forgets them', () => {
    let now = 0;
    const store = makeStore(() => now);
    const action = store.create(draft);
    now = TTL + 1;
    try {
      store.consume(action.id);
      expect.unreachable();
    } catch (error) {
      expect(isXError(error, 'CONFIRMATION_EXPIRED')).toBe(true);
    }
    // After expiry the token is gone entirely.
    try {
      store.consume(action.id);
      expect.unreachable();
    } catch (error) {
      expect(isXError(error, 'CONFIRMATION_REQUIRED')).toBe(true);
    }
  });
});
