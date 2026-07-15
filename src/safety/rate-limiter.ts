import { XError } from '../errors.js';

const HOUR_MS = 3_600_000;

export interface WriteRateLimits {
  /** Minimum spacing between two writes. */
  minIntervalMs: number;
  /** Maximum writes in any sliding one-hour window. */
  maxPerHour: number;
}

/**
 * Local write throttle. This is a self-imposed safety brake, not an attempt
 * to model X's real limits — it keeps the automation deliberately slow.
 */
export class WriteRateLimiter {
  private writeTimestamps: number[] = [];

  constructor(
    private readonly limits: WriteRateLimits,
    private readonly now: () => number = Date.now,
  ) {}

  /** Throws RATE_LIMITED when a write must not happen right now. */
  assertWriteAllowed(): void {
    const now = this.now();
    this.writeTimestamps = this.writeTimestamps.filter((t) => now - t < HOUR_MS);

    const last = this.writeTimestamps[this.writeTimestamps.length - 1];
    if (last !== undefined && now - last < this.limits.minIntervalMs) {
      const waitMs = this.limits.minIntervalMs - (now - last);
      throw new XError('RATE_LIMITED', `Too soon after the previous write — wait ${waitMs} ms`);
    }
    if (this.writeTimestamps.length >= this.limits.maxPerHour) {
      throw new XError(
        'RATE_LIMITED',
        `Hourly write limit of ${this.limits.maxPerHour} reached — try again later`,
      );
    }
  }

  recordWrite(): void {
    this.writeTimestamps.push(this.now());
  }
}
