import { describe, expect, it } from 'vitest';
import {
  draftFingerprint,
  requiredPhraseFor,
  validateConfirmation,
} from '../../src/safety/confirmation.js';
import { isXError } from '../../src/errors.js';

const baseAction = {
  id: 'token',
  kind: 'post' as const,
  account: 'testuser',
  preview: 'Hello',
  payload: { text: 'Hello' },
  createdAt: 0,
  expiresAt: 120_000,
};

describe('requiredPhraseFor', () => {
  it('requires CONFIRM for regular writes', () => {
    expect(requiredPhraseFor(baseAction)).toBe('CONFIRM');
  });

  it('requires DELETE <postId> for deletions', () => {
    const deleteAction = {
      ...baseAction,
      kind: 'delete_post' as const,
      payload: { statusId: '12345' },
    };
    expect(requiredPhraseFor(deleteAction)).toBe('DELETE 12345');
  });
});

describe('validateConfirmation', () => {
  it('accepts the exact phrase and matching account', () => {
    expect(() => validateConfirmation(baseAction, 'CONFIRM', 'testuser')).not.toThrow();
  });

  it('rejects a wrong phrase with CONFIRMATION_REQUIRED', () => {
    try {
      validateConfirmation(baseAction, 'confirm', 'testuser');
      expect.unreachable();
    } catch (error) {
      expect(isXError(error, 'CONFIRMATION_REQUIRED')).toBe(true);
    }
  });

  it('rejects a mismatched delete phrase', () => {
    const deleteAction = {
      ...baseAction,
      kind: 'delete_post' as const,
      payload: { statusId: '12345' },
    };
    try {
      validateConfirmation(deleteAction, 'DELETE 99999', 'testuser');
      expect.unreachable();
    } catch (error) {
      expect(isXError(error, 'CONFIRMATION_REQUIRED')).toBe(true);
    }
  });

  it('rejects when the active account changed since prepare', () => {
    try {
      validateConfirmation(baseAction, 'CONFIRM', 'someone_else');
      expect.unreachable();
    } catch (error) {
      expect(isXError(error, 'ACCOUNT_CHANGED')).toBe(true);
    }
  });
});

describe('draftFingerprint', () => {
  it('is deterministic and does not contain the draft text', () => {
    const a = draftFingerprint('my secret draft');
    const b = draftFingerprint('my secret draft');
    expect(a).toEqual(b);
    expect(a.fingerprint).not.toContain('secret');
    expect(a.fingerprint).toHaveLength(12);
    expect(a.length).toBe('my secret draft'.length);
  });

  it('differs for different drafts', () => {
    expect(draftFingerprint('one').fingerprint).not.toBe(draftFingerprint('two').fingerprint);
  });
});
