import { randomBytes } from 'node:crypto';
import { XError } from '../errors.js';

export type PreparedActionKind =
  | 'post'
  | 'reply'
  | 'like'
  | 'repost'
  | 'follow'
  | 'delete_post';

export interface PreparedAction {
  /** The confirmation token. Opaque, cryptographically random, single-use. */
  id: string;
  kind: PreparedActionKind;
  /** Handle that was active when the action was prepared. */
  account: string;
  /** Human-readable preview shown to the user before confirming. */
  preview: string;
  /** Immutable parameters of the prepared operation. */
  payload: Readonly<Record<string, unknown>>;
  createdAt: number;
  expiresAt: number;
}

export interface ActionDraft {
  kind: PreparedActionKind;
  account: string;
  preview: string;
  payload: Record<string, unknown>;
}

/**
 * Holds prepared actions in RAM only — nothing is ever persisted to disk.
 * Tokens are single-use and expire after the configured TTL.
 */
export class ActionStore {
  private readonly actions = new Map<string, PreparedAction>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  create(draft: ActionDraft): PreparedAction {
    this.prune();
    const createdAt = this.now();
    const action: PreparedAction = Object.freeze({
      id: randomBytes(24).toString('base64url'),
      kind: draft.kind,
      account: draft.account,
      preview: draft.preview,
      payload: Object.freeze({ ...draft.payload }),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    });
    this.actions.set(action.id, action);
    return action;
  }

  /**
   * Removes and returns the action for the token. A token can be consumed
   * exactly once; unknown and expired tokens throw typed errors.
   */
  consume(token: string): PreparedAction {
    const action = this.actions.get(token);
    if (!action) {
      throw new XError(
        'CONFIRMATION_REQUIRED',
        'There is no prepared action for this token — prepare the action first',
      );
    }
    this.actions.delete(token);
    if (this.now() > action.expiresAt) {
      throw new XError(
        'CONFIRMATION_EXPIRED',
        'The confirmation token expired — prepare the action again',
      );
    }
    return action;
  }

  private prune(): void {
    const now = this.now();
    for (const [token, action] of this.actions) {
      if (now > action.expiresAt) {
        this.actions.delete(token);
      }
    }
  }
}
