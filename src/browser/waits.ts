export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Base delay plus up to 50% random jitter, used only for read retries. */
export function jitteredDelayMs(baseMs: number): number {
  return Math.round(baseMs * (1 + Math.random() * 0.5));
}
