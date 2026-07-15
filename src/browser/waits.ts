import type { Locator } from 'playwright';

export async function waitVisible(locator: Locator, timeoutMs: number): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: timeoutMs });
}

export async function waitHidden(locator: Locator, timeoutMs: number): Promise<void> {
  await locator.waitFor({ state: 'hidden', timeout: timeoutMs });
}

/** Returns true when the locator becomes visible within the timeout. */
export async function becomesVisible(locator: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Base delay plus up to 50% random jitter, used only for read retries. */
export function jitteredDelayMs(baseMs: number): number {
  return Math.round(baseMs * (1 + Math.random() * 0.5));
}
