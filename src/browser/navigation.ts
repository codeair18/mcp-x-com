import type { Page } from 'playwright';

const ALLOWED_HOSTS = ['x.com', 'twitter.com'];

/**
 * Navigation is restricted to X itself plus local fixtures. `file:` and
 * `about:` stay allowed so tests can drive the same code paths as live runs.
 */
export function isAllowedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'file:' || parsed.protocol === 'about:') {
    return true;
  }
  if (parsed.protocol !== 'https:') {
    return false;
  }
  return ALLOWED_HOSTS.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
  );
}

export function assertAllowedUrl(url: string): void {
  if (!isAllowedUrl(url)) {
    throw new Error(`Navigation to ${url} is not allowed`);
  }
}

/**
 * Navigates and waits for DOM content only. `networkidle` is deliberately
 * avoided: X keeps long-lived connections open, so it never settles.
 */
export async function gotoAllowed(page: Page, url: string, timeoutMs: number): Promise<void> {
  assertAllowedUrl(url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
}
