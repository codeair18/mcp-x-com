import type { Page } from 'playwright';
import { SELECTORS } from './selectors.js';
import { sleep } from './waits.js';

export type SessionState =
  | { status: 'logged_in'; handle: string }
  | { status: 'logged_out' }
  | { status: 'checkpoint' }
  | { status: 'unknown' };

/** How long a logged-out state must persist before it is believed. */
const LOGGED_OUT_GRACE_MS = 2_000;
const POLL_MS = 150;

/**
 * Determines whether the current page belongs to a logged-in session and
 * which account is active. Reads only public UI markers — never cookies,
 * storage, or credential fields.
 *
 * X renders its UI in stages, and the logged-in messages drawer shares the
 * "BottomBar" testid with the logged-out banner, so this polls and only
 * believes "logged out" once that state persists for a grace period with
 * no account switcher in sight.
 */
export async function detectSessionState(page: Page, timeoutMs: number): Promise<SessionState> {
  const url = page.url();
  if (SELECTORS.checkpointPaths.some((path) => url.includes(path))) {
    return { status: 'checkpoint' };
  }

  const accountSwitcher = page.locator(SELECTORS.session.accountSwitcher).first();
  const loggedOutCta = page.locator(SELECTORS.session.loggedOutCta).first();

  const deadline = Date.now() + timeoutMs;
  const grace = Math.min(LOGGED_OUT_GRACE_MS, Math.floor(timeoutMs / 2));
  let loggedOutSince: number | null = null;
  for (;;) {
    if (await accountSwitcher.isVisible()) {
      const handle = await readActiveHandle(page);
      return handle ? { status: 'logged_in', handle } : { status: 'unknown' };
    }
    if (await loggedOutCta.isVisible()) {
      loggedOutSince ??= Date.now();
      if (Date.now() - loggedOutSince >= grace) {
        return { status: 'logged_out' };
      }
    } else {
      loggedOutSince = null;
    }
    if (Date.now() >= deadline) {
      return { status: 'unknown' };
    }
    await sleep(POLL_MS);
  }
}

async function readActiveHandle(page: Page): Promise<string | null> {
  const prefix = SELECTORS.session.avatarContainerPrefix;
  const avatar = page
    .locator(SELECTORS.session.accountSwitcher)
    .locator(`[data-testid^="${prefix}"]`)
    .first();
  const testId = await avatar.getAttribute('data-testid').catch(() => null);
  if (testId && testId.length > prefix.length) {
    return testId.slice(prefix.length);
  }

  // Fallback: the profile link's href is "/<handle>".
  const href = await page
    .locator(SELECTORS.session.profileLink)
    .first()
    .getAttribute('href')
    .catch(() => null);
  const match = href?.match(/^\/([A-Za-z0-9_]{1,15})$/);
  return match?.[1] ?? null;
}
