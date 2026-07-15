import { createHash } from 'node:crypto';
import { XError } from '../errors.js';
import type { PreparedAction } from './action-store.js';

/**
 * Deletions require naming the exact post; everything else requires the
 * literal word CONFIRM.
 */
export function requiredPhraseFor(action: Pick<PreparedAction, 'kind' | 'payload'>): string {
  if (action.kind === 'delete_post') {
    return `DELETE ${String(action.payload['statusId'])}`;
  }
  return 'CONFIRM';
}

/**
 * Verifies the confirmation phrase and that the active account still matches
 * the one the action was prepared for. Phrase comparison is exact — no
 * trimming, no case folding — so confirmation stays a deliberate act.
 */
export function validateConfirmation(
  action: PreparedAction,
  phrase: string,
  activeAccount: string,
): void {
  if (activeAccount !== action.account) {
    throw new XError(
      'ACCOUNT_CHANGED',
      `Action was prepared for @${action.account} but the active account is @${activeAccount}`,
    );
  }
  const expected = requiredPhraseFor(action);
  if (phrase !== expected) {
    throw new XError(
      'CONFIRMATION_REQUIRED',
      `Confirmation phrase mismatch — expected "${expected}"`,
    );
  }
}

/**
 * Logging-safe identity of a draft: a short hash plus the length. The draft
 * text itself must never be logged.
 */
export function draftFingerprint(text: string): { fingerprint: string; length: number } {
  return {
    fingerprint: createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12),
    length: text.length,
  };
}
