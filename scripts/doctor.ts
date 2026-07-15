/**
 * Environment diagnostics: Node version, Chromium availability, browser
 * profile/CDP configuration, reachability of x.com and session state.
 * Prints a PASS/FAIL summary. Never logs cookies, storage, headers or DOM.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { BrowserManager } from '../src/browser/browser-manager.js';
import { detectSessionState } from '../src/browser/session-guard.js';
import { loadConfig, redactConfig } from '../src/config.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

async function main(): Promise<void> {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  record('node', nodeMajor >= 22, `Node ${process.versions.node} (need >= 22)`);

  const config = loadConfig(process.env);
  console.log('Config:', JSON.stringify(redactConfig(config)));

  const chromiumPath = chromium.executablePath();
  record(
    'chromium',
    existsSync(chromiumPath),
    existsSync(chromiumPath)
      ? 'Playwright Chromium installed'
      : 'missing — run `npx playwright install chromium`',
  );

  if (config.browser.mode === 'cdp') {
    record('browser-mode', true, 'CDP (X_BROWSER_CDP_URL is set, takes precedence)');
  } else {
    const profileExists = existsSync(config.browser.profileDir);
    record(
      'browser-mode',
      true,
      `persistent profile at ${config.browser.profileDir}${profileExists ? '' : ' (will be created on first login)'}`,
    );
  }

  const manager = new BrowserManager(config.browser);
  try {
    await manager.goto('https://x.com/home');
    record('x-reachable', true, 'x.com loaded');

    const state = await manager.withPage((page) =>
      detectSessionState(page, config.browser.timeoutMs),
    );
    switch (state.status) {
      case 'logged_in':
        record('session', true, `logged in as @${state.handle}`);
        break;
      case 'logged_out':
        record('session', false, 'not logged in — run `npm run login`');
        break;
      case 'checkpoint':
        record('session', false, 'X requires manual attention (checkpoint/verification)');
        break;
      default:
        record('session', false, 'could not determine session state');
    }
  } catch (error) {
    record('x-reachable', false, error instanceof Error ? error.message : String(error));
  } finally {
    await manager.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? '\nAll checks passed.' : `\n${failed.length} check(s) failed.`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
