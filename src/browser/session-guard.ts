import type { Page } from 'playwright';
import { SELECTORS } from './selectors.js';

export type SessionState =
  | { status: 'logged_in'; handle: string }
  | { status: 'logged_out' }
  | { status: 'checkpoint' }
  | { status: 'unknown' };

/**
 * Determines whether the current page belongs to a logged-in session and
 * which account is active. Reads only public UI markers — never cookies,
 * storage, or credential fields.
 */
export async function detectSessionState(page: Page, timeoutMs: number): Promise<SessionState> {
  const url = page.url();
  if (SELECTORS.checkpointPaths.some((path) => url.includes(path))) {
    return { status: 'checkpoint' };
  }

  const accountSwitcher = page.locator(SELECTORS.session.accountSwitcher);
  const loggedOutCta = page.locator(SELECTORS.session.loggedOutCta);

  try {
    await accountSwitcher.or(loggedOutCta).first().waitFor({
      state: 'visible',
      timeout: timeoutMs,
    });
  } catch {
    return { status: 'unknown' };
  }

  // The logged-in check must come first: the logged-in UI also renders a
  // "BottomBar" (the messages drawer), which doubles as the logged-out CTA
  // banner's testid.
  if (await accountSwitcher.first().isVisible()) {
    const handle = await readActiveHandle(page);
    if (handle) {
      return { status: 'logged_in', handle };
    }
    return { status: 'unknown' };
  }
  if (await loggedOutCta.first().isVisible()) {
    return { status: 'logged_out' };
  }
  return { status: 'unknown' };
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
