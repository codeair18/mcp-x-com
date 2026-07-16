import type { Page } from 'playwright';
import type { BrowserManager } from '../browser/browser-manager.js';
import { SELECTORS } from '../browser/selectors.js';
import type { SessionState } from '../browser/session-guard.js';
import { detectSessionState } from '../browser/session-guard.js';
import { jitteredDelayMs, sleep } from '../browser/waits.js';
import { XError, isXError } from '../errors.js';
import { dedupeByStatusId, parseProfilePage, parseTweetArticles } from './parsers.js';
import type { Post, Profile, ReadMeta } from './types.js';
import {
  canonicalStatusUrl,
  extractStatusRef,
  normalizeHandle,
  profileUrl,
  searchUrl,
  type StatusRef,
} from './urls.js';

export interface XUrlResolver {
  post(ref: StatusRef): string;
  profile(handle: string): string;
  search(query: string, sort: 'latest' | 'top'): string;
  home(): string;
  notifications(): string;
}

export const liveUrls: XUrlResolver = {
  post: (ref) => canonicalStatusUrl(ref.statusId, ref.handle),
  profile: profileUrl,
  search: searchUrl,
  home: () => 'https://x.com/home',
  notifications: () => 'https://x.com/notifications/mentions',
};

export interface ReadServiceOptions {
  timeoutMs: number;
  maxReadItems: number;
  /** Hard cap on scroll rounds per read call. */
  maxScrolls?: number;
  /** Base delay before a read retry; jitter is added on top. */
  retryBaseDelayMs?: number;
  urls?: XUrlResolver;
}

/** Error codes that must never trigger a retry. */
const NON_RETRYABLE = new Set(['NOT_AUTHENTICATED', 'CHECKPOINT_REQUIRED', 'RATE_LIMITED', 'INVALID_TARGET']);
const MAX_READ_RETRIES = 2;

export class ReadService {
  private readonly urls: XUrlResolver;
  private readonly maxScrolls: number;
  private readonly retryBaseDelayMs: number;

  constructor(
    private readonly manager: BrowserManager,
    private readonly options: ReadServiceOptions,
  ) {
    this.urls = options.urls ?? liveUrls;
    this.maxScrolls = options.maxScrolls ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 300;
  }

  async getPost(input: string): Promise<{ post: Post; meta: ReadMeta }> {
    const ref = extractStatusRef(input);
    if (!ref) {
      throw new XError('INVALID_TARGET', `Not a recognizable post URL or ID: ${input}`);
    }
    return this.withReadRetry(async () => {
      await this.manager.goto(this.urls.post(ref));
      return this.manager.withPage(async (page) => {
        await this.probe(page, SELECTORS.post.article);
        const posts = await parseTweetArticles(page, 10);
        const post = posts.find((p) => p.statusId === ref.statusId) ?? posts[0];
        if (!post) {
          throw new XError('SELECTOR_DRIFT', 'No parseable post found on the status page');
        }
        return { post, meta: this.meta(page, [], false) };
      });
    });
  }

  async getProfile(input: string): Promise<{ profile: Profile; meta: ReadMeta }> {
    const handle = normalizeHandle(input);
    if (!handle) {
      throw new XError('INVALID_TARGET', `Not a recognizable handle or profile URL: ${input}`);
    }
    return this.withReadRetry(async () => {
      await this.manager.goto(this.urls.profile(handle));
      return this.manager.withPage(async (page) => {
        await this.probe(page, SELECTORS.profile.userName);
        const profile = await parseProfilePage(page, handle);
        return { profile, meta: this.meta(page, [], false) };
      });
    });
  }

  searchPosts(
    query: string,
    opts: { limit?: number; sort?: 'latest' | 'top' } = {},
  ): Promise<{ posts: Post[]; meta: ReadMeta }> {
    if (!query.trim()) {
      throw new XError('INVALID_TARGET', 'Search query must not be empty');
    }
    return this.collectList(() => this.urls.search(query, opts.sort ?? 'latest'), opts.limit);
  }

  getTimeline(opts: { limit?: number } = {}): Promise<{ posts: Post[]; meta: ReadMeta }> {
    return this.collectList(() => this.urls.home(), opts.limit);
  }

  getNotifications(opts: { limit?: number } = {}): Promise<{ posts: Post[]; meta: ReadMeta }> {
    return this.collectList(() => this.urls.notifications(), opts.limit);
  }

  getSessionStatus(): Promise<SessionState> {
    return this.withReadRetry(async () => {
      await this.manager.goto(this.urls.home());
      return this.manager.withPage((page) => detectSessionState(page, this.options.timeoutMs));
    });
  }

  private collectList(
    // Resolved per attempt so retries re-evaluate the target URL.
    urlFor: () => string,
    requestedLimit?: number,
  ): Promise<{ posts: Post[]; meta: ReadMeta }> {
    const limit = Math.min(requestedLimit ?? this.options.maxReadItems, this.options.maxReadItems);
    return this.withReadRetry(async () => {
      await this.manager.goto(urlFor());
      return this.manager.withPage(async (page) => {
        await this.probe(page, SELECTORS.post.article);

        const warnings: string[] = [];
        let posts = dedupeByStatusId(await parseTweetArticles(page, limit * 2 + 10));
        let scrolls = 0;
        while (posts.length <= limit && scrolls < this.maxScrolls) {
          const before = posts.length;
          await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
          await sleep(300);
          posts = dedupeByStatusId([...posts, ...(await parseTweetArticles(page, limit * 2 + 10))]);
          scrolls += 1;
          if (posts.length === before) {
            break;
          }
        }

        const truncated = posts.length > limit;
        if (posts.length < limit) {
          warnings.push(
            `Returned fewer posts than requested (${posts.length} of ${limit}); no new posts appeared after scrolling`,
          );
        }
        return { posts: posts.slice(0, limit), meta: this.meta(page, warnings, truncated) };
      });
    });
  }

  /**
   * Waits until the page shows either the expected content or a recognizable
   * failure state, and throws the matching typed error for failures.
   */
  private async probe(page: Page, contentSelector: string): Promise<void> {
    const url = page.url();
    if (SELECTORS.checkpointPaths.some((path) => url.includes(path))) {
      throw new XError('CHECKPOINT_REQUIRED', 'X is asking for manual verification; resolve it in the browser');
    }
    const content = page.locator(contentSelector).first();
    const loggedOut = page.locator(SELECTORS.session.loggedOutCta).first();
    const rateLimited = page.getByText(/rate limit exceeded/i).first();
    const loadError = page.getByText(/something went wrong/i).first();

    try {
      await content
        .or(loggedOut)
        .or(rateLimited)
        .or(loadError)
        .first()
        .waitFor({ state: 'visible', timeout: this.options.timeoutMs });
    } catch {
      throw new XError('SELECTOR_DRIFT', `Timed out waiting for page content (${contentSelector})`);
    }

    if (await content.isVisible()) {
      return;
    }
    if (await rateLimited.isVisible()) {
      throw new XError('RATE_LIMITED', 'X reports the rate limit is exceeded; wait before retrying');
    }
    if (await loggedOut.isVisible()) {
      // The logged-in UI renders a "BottomBar" too (messages drawer), so a
      // visible account switcher overrides the logged-out marker.
      const accountSwitcher = page.locator(SELECTORS.session.accountSwitcher).first();
      if (!(await accountSwitcher.isVisible())) {
        throw new XError('NOT_AUTHENTICATED', 'Not logged in — run `npm run login` first');
      }
    }
    if (await loadError.isVisible()) {
      throw new XError('SELECTOR_DRIFT', 'X reported an error loading the page');
    }
    throw new XError('SELECTOR_DRIFT', 'Page reached an unrecognized state');
  }

  /** Reads may retry; writes never go through this path. */
  private async withReadRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_READ_RETRIES; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (isXError(error) && NON_RETRYABLE.has(error.code)) {
          throw error;
        }
        lastError = error;
        if (attempt < MAX_READ_RETRIES) {
          await sleep(jitteredDelayMs(this.retryBaseDelayMs));
        }
      }
    }
    throw lastError;
  }

  private meta(page: Page, warnings: string[], truncated: boolean): ReadMeta {
    return {
      sourceUrl: page.url(),
      observedAt: new Date().toISOString(),
      warnings,
      truncated,
    };
  }
}
