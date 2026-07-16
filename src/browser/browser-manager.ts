import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { AppConfig } from '../config.js';
import { gotoAllowed } from './navigation.js';

/**
 * Runs operations strictly one after another. X gets confused by parallel
 * interactions in one session, so every page operation goes through here.
 */
class OperationQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export class BrowserManager {
  private context: BrowserContext | null = null;
  /** Set only in CDP mode; the external browser is never closed by us. */
  private cdpBrowser: Browser | null = null;
  private page: Page | null = null;
  private closed = false;
  private readonly queue = new OperationQueue();

  constructor(private readonly config: AppConfig['browser']) {}

  /**
   * Runs an operation against the shared page. Operations are serialized;
   * the browser is launched lazily on first use.
   */
  withPage<T>(operation: (page: Page) => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      if (this.closed) {
        throw new Error('Browser manager is closed');
      }
      const page = await this.ensurePage();
      return operation(page);
    });
  }

  /** Navigates the shared page, enforcing the domain allowlist. */
  goto(url: string): Promise<void> {
    return this.withPage((page) => gotoAllowed(page, url, this.config.timeoutMs));
  }

  private async ensurePage(): Promise<Page> {
    const context = await this.ensureContext();
    if (!this.page || this.page.isClosed()) {
      this.page = context.pages()[0] ?? (await context.newPage());
    }
    return this.page;
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }
    if (this.config.mode === 'cdp') {
      if (!this.config.cdpUrl) {
        throw new Error('CDP mode requires X_BROWSER_CDP_URL');
      }
      this.cdpBrowser = await chromium.connectOverCDP(this.config.cdpUrl);
      this.context = this.cdpBrowser.contexts()[0] ?? (await this.cdpBrowser.newContext());
    } else {
      this.context = await chromium.launchPersistentContext(this.config.profileDir, {
        headless: this.config.headless,
        locale: this.config.locale,
        viewport: { width: 1280, height: 900 },
        // A real system browser (e.g. channel "chrome") is required for
        // macOS passkeys/hardware keys during manual login.
        ...(this.config.channel !== undefined ? { channel: this.config.channel } : {}),
      });
    }
    this.context.setDefaultTimeout(this.config.timeoutMs);
    return this.context;
  }

  /**
   * Graceful shutdown. In CDP mode this only disconnects — the external
   * browser and its session stay untouched.
   */
  async close(): Promise<void> {
    this.closed = true;
    const context = this.context;
    const cdpBrowser = this.cdpBrowser;
    this.context = null;
    this.cdpBrowser = null;
    this.page = null;
    try {
      if (cdpBrowser) {
        await cdpBrowser.close();
      } else if (context) {
        await context.close();
      }
    } catch {
      // Shutdown must never throw; the process is exiting anyway.
    }
  }
}
