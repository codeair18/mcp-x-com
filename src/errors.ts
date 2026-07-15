export const ERROR_CODES = [
  'NOT_AUTHENTICATED',
  'CHECKPOINT_REQUIRED',
  'RATE_LIMITED',
  'SELECTOR_DRIFT',
  'INVALID_TARGET',
  'CONFIRMATION_REQUIRED',
  'CONFIRMATION_EXPIRED',
  'ACCOUNT_CHANGED',
  'UNKNOWN_OUTCOME',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class XError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'XError';
  }
}

export function isXError(error: unknown, code?: ErrorCode): error is XError {
  return error instanceof XError && (code === undefined || error.code === code);
}
