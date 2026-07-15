/**
 * Opens a headed Chromium on x.com so a human can log in manually.
 * This script never reads or types credentials — the whole point is that
 * passwords and 2FA stay between the human and the browser.
 */
import { BrowserManager } from '../src/browser/browser-manager.js';
import { detectSessionState } from '../src/browser/session-guard.js';
import { loadConfig } from '../src/config.js';

const POLL_INTERVAL_MS = 3_000;
const MAX_WAIT_MS = 10 * 60 * 1_000;

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  if (config.browser.mode === 'cdp') {
    console.log('CDP mode is configured (X_BROWSER_CDP_URL is set).');
    console.log('Log in to x.com directly in the externally running browser,');
    console.log('then run `npm run doctor` to verify the session.');
    return;
  }

  const manager = new BrowserManager({ ...config.browser, headless: false });
  console.log(`Opening Chromium with profile: ${config.browser.profileDir}`);
  console.log('Log in to X manually in the opened window (password, 2FA, CAPTCHA).');
  console.log('This script only watches for the logged-in marker — it never touches credentials.');

  try {
    await manager.goto('https://x.com/home');
    const deadline = Date.now() + MAX_WAIT_MS;
    for (;;) {
      const state = await manager.withPage((page) => detectSessionState(page, POLL_INTERVAL_MS));
      if (state.status === 'logged_in') {
        console.log(`Logged in as @${state.handle}. Session saved in the browser profile.`);
        return;
      }
      if (Date.now() > deadline) {
        console.error('Timed out waiting for login. Run `npm run login` again when ready.');
        process.exitCode = 1;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } finally {
    await manager.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
