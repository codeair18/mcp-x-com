import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Locator, Page } from 'playwright';
import type { BrowserManager } from '../browser/browser-manager.js';
import { SELECTORS } from '../browser/selectors.js';
import { detectSessionState } from '../browser/session-guard.js';
import { XError } from '../errors.js';
import type { ActionStore, PreparedAction, PreparedActionKind } from '../safety/action-store.js';
import { requiredPhraseFor, validateConfirmation } from '../safety/confirmation.js';
import type { WriteRateLimiter } from '../safety/rate-limiter.js';
import { canonicalStatusUrl, extractStatusRef, normalizeHandle, profileUrl, type StatusRef } from './urls.js';

export interface WriteUrlResolver {
  compose(): string;
  post(ref: StatusRef): string;
  profile(handle: string): string;
  home(): string;
}

export const liveWriteUrls: WriteUrlResolver = {
  compose: () => 'https://x.com/compose/post',
  post: (ref) => canonicalStatusUrl(ref.statusId, ref.handle),
  profile: profileUrl,
  home: () => 'https://x.com/home',
};

export interface PrepareResult {
  action: PreparedActionKind;
  account: string;
  preview: string;
  confirmationToken: string;
  expiresAt: string;
  requiredPhrase: string;
  executed: false;
}

export interface ExecuteResult {
  executed: true;
  action: PreparedActionKind;
  account: string;
  resultUrl: string | null;
  statusId: string | null;
  detail: string;
}

interface WriteServiceDeps {
  store: ActionStore;
  limiter: WriteRateLimiter;
  timeoutMs: number;
  urls?: WriteUrlResolver;
  /** Prepare-time text cap; defaults to the Premium ceiling. */
  maxPostChars?: number;
}

/** Post length without Premium; X's compose UI enforces it, we only classify. */
export const FREE_POST_CHARS = 280;
/** X Premium's post-length ceiling. */
export const PREMIUM_POST_CHARS = 25_000;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/**
 * All state-changing operations on X. Every operation is split into
 * `prepare*` (validates, snapshots the action, returns a confirmation token,
 * performs NO clicks) and `executeAction` (consumes the token once, verifies
 * account and phrase, performs exactly the prepared operation, verifies the
 * effect in the UI). Writes are never retried: an ambiguous result surfaces
 * as UNKNOWN_OUTCOME instead of a second click.
 */
export class WriteService {
  private readonly urls: WriteUrlResolver;
  readonly maxPostChars: number;

  constructor(
    private readonly manager: BrowserManager,
    private readonly deps: WriteServiceDeps,
  ) {
    this.urls = deps.urls ?? liveWriteUrls;
    this.maxPostChars = deps.maxPostChars ?? PREMIUM_POST_CHARS;
  }

  async preparePost(input: { text: string; mediaPaths?: string[] }): Promise<PrepareResult> {
    const mediaPaths = input.mediaPaths ?? [];
    this.validateText(input.text);
    await this.validateMedia(mediaPaths);
    const account = await this.activeHandle();
    return this.storeAction({
      kind: 'post',
      account,
      preview: this.previewText(input.text, mediaPaths),
      payload: { text: input.text, mediaPaths },
    });
  }

  async prepareReply(input: {
    target: string;
    text: string;
    mediaPaths?: string[];
  }): Promise<PrepareResult> {
    const ref = this.requireStatusRef(input.target);
    const mediaPaths = input.mediaPaths ?? [];
    this.validateText(input.text);
    await this.validateMedia(mediaPaths);
    const account = await this.activeHandle();
    return this.storeAction({
      kind: 'reply',
      account,
      preview: `Reply to ${canonicalStatusUrl(ref.statusId, ref.handle)}: ${this.previewText(input.text, mediaPaths)}`,
      payload: { statusId: ref.statusId, handle: ref.handle ?? null, text: input.text, mediaPaths },
    });
  }

  async prepareLike(input: { target: string }): Promise<PrepareResult> {
    return this.prepareTargetAction('like', input.target, 'Like');
  }

  async prepareRepost(input: { target: string }): Promise<PrepareResult> {
    return this.prepareTargetAction('repost', input.target, 'Repost');
  }

  async prepareFollow(input: { handle: string }): Promise<PrepareResult> {
    const handle = normalizeHandle(input.handle);
    if (!handle) {
      throw new XError('INVALID_TARGET', `Not a recognizable handle: ${input.handle}`);
    }
    const account = await this.activeHandle();
    return this.storeAction({
      kind: 'follow',
      account,
      preview: `Follow @${handle}`,
      payload: { handle },
    });
  }

  async prepareDeletePost(input: { target: string }): Promise<PrepareResult> {
    return this.prepareTargetAction('delete_post', input.target, 'Delete');
  }

  /**
   * Consumes the confirmation token (single use — a failed attempt requires
   * a fresh prepare), re-verifies the active account, and performs the
   * prepared operation.
   */
  async executeAction(input: {
    confirmationToken: string;
    confirmationPhrase: string;
  }): Promise<ExecuteResult> {
    this.deps.limiter.assertWriteAllowed();
    const action = this.deps.store.consume(input.confirmationToken);
    const account = await this.activeHandle();
    validateConfirmation(action, input.confirmationPhrase, account);

    switch (action.kind) {
      case 'post':
        return this.executeCompose(action, this.urls.compose());
      case 'reply':
        return this.executeCompose(action, this.urls.post(this.payloadRef(action)));
      case 'like':
        return this.executeLike(action);
      case 'repost':
        return this.executeRepost(action);
      case 'follow':
        return this.executeFollow(action);
      case 'delete_post':
        return this.executeDelete(action);
    }
  }

  // ── prepare helpers ────────────────────────────────────────────────

  private async prepareTargetAction(
    kind: 'like' | 'repost' | 'delete_post',
    target: string,
    verb: string,
  ): Promise<PrepareResult> {
    const ref = this.requireStatusRef(target);
    const account = await this.activeHandle();
    return this.storeAction({
      kind,
      account,
      preview: `${verb} post ${canonicalStatusUrl(ref.statusId, ref.handle)}`,
      payload: { statusId: ref.statusId, handle: ref.handle ?? null },
    });
  }

  private storeAction(draft: {
    kind: PreparedActionKind;
    account: string;
    preview: string;
    payload: Record<string, unknown>;
  }): PrepareResult {
    const action = this.deps.store.create(draft);
    return {
      action: action.kind,
      account: action.account,
      preview: action.preview,
      confirmationToken: action.id,
      expiresAt: new Date(action.expiresAt).toISOString(),
      requiredPhrase: requiredPhraseFor(action),
      executed: false,
    };
  }

  private requireStatusRef(target: string): StatusRef {
    const ref = extractStatusRef(target);
    if (!ref) {
      throw new XError('INVALID_TARGET', `Not a recognizable post URL or ID: ${target}`);
    }
    return ref;
  }

  private validateText(text: string): void {
    if (text.trim().length === 0) {
      throw new XError('INVALID_TARGET', 'Post text must not be empty');
    }
    if (text.length > this.maxPostChars) {
      throw new XError(
        'INVALID_TARGET',
        `Post text is ${text.length} characters — the limit is ${this.maxPostChars}`,
      );
    }
  }

  private async validateMedia(paths: string[]): Promise<void> {
    if (paths.length > MAX_IMAGES) {
      throw new XError('INVALID_TARGET', `At most ${MAX_IMAGES} images are allowed`);
    }
    for (const path of paths) {
      const ext = extname(path).toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        throw new XError(
          'INVALID_TARGET',
          `Unsupported media type "${ext}" for ${basename(path)} — allowed: png, jpg, jpeg, gif, webp`,
        );
      }
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) {
        throw new XError('INVALID_TARGET', `Media file not found: ${path}`);
      }
      if (info.size > MAX_IMAGE_BYTES) {
        throw new XError(
          'INVALID_TARGET',
          `${basename(path)} is ${info.size} bytes — the image limit is ${MAX_IMAGE_BYTES}`,
        );
      }
    }
  }

  private previewText(text: string, mediaPaths: string[]): string {
    const media = mediaPaths.length > 0 ? ` [+${mediaPaths.length} image(s)]` : '';
    return `${text}${media}`;
  }

  /** Reads the active handle, navigating home only when necessary. */
  private async activeHandle(): Promise<string> {
    let state = await this.manager.withPage((page) =>
      detectSessionState(page, this.deps.timeoutMs),
    );
    if (state.status !== 'logged_in') {
      await this.manager.goto(this.urls.home());
      state = await this.manager.withPage((page) => detectSessionState(page, this.deps.timeoutMs));
    }
    if (state.status === 'checkpoint') {
      throw new XError('CHECKPOINT_REQUIRED', 'X is asking for manual verification');
    }
    if (state.status !== 'logged_in') {
      throw new XError('NOT_AUTHENTICATED', 'Not logged in — run `npm run login` first');
    }
    return state.handle;
  }

  // ── execute helpers ────────────────────────────────────────────────

  /** Publishing a new post and replying share the same compose mechanics. */
  private async executeCompose(action: PreparedAction, url: string): Promise<ExecuteResult> {
    const text = action.payload['text'] as string;
    const mediaPaths = (action.payload['mediaPaths'] as string[] | undefined) ?? [];
    await this.manager.goto(url);
    return this.manager.withPage(async (page) => {
      const textbox = page.locator(SELECTORS.compose.textbox).first();
      await textbox.waitFor({ state: 'visible', timeout: this.deps.timeoutMs });
      await textbox.fill(text);

      if (mediaPaths.length > 0) {
        await page.locator(SELECTORS.compose.fileInput).first().setInputFiles(mediaPaths);
        await page
          .locator(SELECTORS.compose.attachments)
          .locator('> *')
          .nth(mediaPaths.length - 1)
          .waitFor({ state: 'visible', timeout: this.deps.timeoutMs });
      }

      const button = page.locator(SELECTORS.compose.postButton).first();
      try {
        // click() auto-waits for the button to become enabled; a timeout
        // here means nothing was submitted.
        await button.click({ timeout: this.deps.timeoutMs });
      } catch {
        // The compose UI is the source of truth for the account's real
        // limit: without Premium it keeps the button disabled above 280.
        if (text.length > FREE_POST_CHARS) {
          throw new XError(
            'PREMIUM_REQUIRED',
            `The post button never enabled for a ${text.length}-character draft — ` +
              `the account's limit is likely ${FREE_POST_CHARS} (no X Premium); nothing was submitted`,
          );
        }
        throw new XError(
          'SELECTOR_DRIFT',
          'The post button never became clickable — nothing was submitted',
        );
      }
      this.deps.limiter.recordWrite();
      return this.awaitToastResult(page, action, `${action.kind} submitted`);
    });
  }

  private async executeLike(action: PreparedAction): Promise<ExecuteResult> {
    const ref = this.payloadRef(action);
    await this.manager.goto(this.urls.post(ref));
    return this.manager.withPage(async (page) => {
      const article = await this.targetArticle(page, ref.statusId);
      if (await article.locator(SELECTORS.actions.unlike).first().isVisible()) {
        return this.result(action, null, 'Post is already liked — nothing to do');
      }
      await article.locator(SELECTORS.actions.like).first().click({ timeout: this.deps.timeoutMs });
      this.deps.limiter.recordWrite();
      await this.verifyAppears(article.locator(SELECTORS.actions.unlike).first(), 'like');
      return this.result(action, ref, 'Post liked');
    });
  }

  private async executeRepost(action: PreparedAction): Promise<ExecuteResult> {
    const ref = this.payloadRef(action);
    await this.manager.goto(this.urls.post(ref));
    return this.manager.withPage(async (page) => {
      const article = await this.targetArticle(page, ref.statusId);
      if (await article.locator(SELECTORS.actions.unrepost).first().isVisible()) {
        return this.result(action, null, 'Post is already reposted — nothing to do');
      }
      await article
        .locator(SELECTORS.actions.repost)
        .first()
        .click({ timeout: this.deps.timeoutMs });
      await page
        .locator(SELECTORS.actions.repostConfirm)
        .first()
        .click({ timeout: this.deps.timeoutMs });
      this.deps.limiter.recordWrite();
      await this.verifyAppears(article.locator(SELECTORS.actions.unrepost).first(), 'repost');
      return this.result(action, ref, 'Post reposted');
    });
  }

  private async executeFollow(action: PreparedAction): Promise<ExecuteResult> {
    const handle = action.payload['handle'] as string;
    await this.manager.goto(this.urls.profile(handle));
    return this.manager.withPage(async (page) => {
      const follow = page.locator(SELECTORS.actions.followButton).first();
      const unfollow = page.locator(SELECTORS.actions.unfollowButton).first();
      try {
        await follow.or(unfollow).first().waitFor({ state: 'visible', timeout: this.deps.timeoutMs });
      } catch {
        throw new XError('SELECTOR_DRIFT', 'Could not find the follow button on the profile');
      }
      if (await unfollow.isVisible()) {
        return this.result(action, null, `@${handle} is already followed — nothing to do`);
      }
      await follow.click({ timeout: this.deps.timeoutMs });
      this.deps.limiter.recordWrite();
      await this.verifyAppears(unfollow, 'follow');
      return this.result(action, null, `Followed @${handle}`);
    });
  }

  private async executeDelete(action: PreparedAction): Promise<ExecuteResult> {
    const ref = this.payloadRef(action);
    await this.manager.goto(this.urls.post(ref));
    return this.manager.withPage(async (page) => {
      const article = await this.targetArticle(page, ref.statusId);
      await article.locator(SELECTORS.actions.caret).first().click({ timeout: this.deps.timeoutMs });
      try {
        await page
          .locator(SELECTORS.actions.deleteMenuItem)
          .first()
          .click({ timeout: this.deps.timeoutMs });
      } catch {
        throw new XError(
          'INVALID_TARGET',
          'No delete option found — the post may not belong to the active account',
        );
      }
      await page
        .locator(SELECTORS.actions.confirmDialogButton)
        .first()
        .click({ timeout: this.deps.timeoutMs });
      this.deps.limiter.recordWrite();
      try {
        await article.waitFor({ state: 'detached', timeout: this.deps.timeoutMs });
      } catch {
        throw new XError(
          'UNKNOWN_OUTCOME',
          'Delete was confirmed but the post is still visible — verify manually, do not retry blindly',
        );
      }
      return this.result(action, null, `Post ${ref.statusId} deleted`);
    });
  }

  private payloadRef(action: PreparedAction): StatusRef {
    const statusId = action.payload['statusId'] as string;
    const handle = action.payload['handle'] as string | null;
    return handle ? { statusId, handle } : { statusId };
  }

  private async targetArticle(page: Page, statusId: string): Promise<Locator> {
    const article = page
      .locator(SELECTORS.post.article)
      .filter({ has: page.locator(`a[href*="/status/${statusId}"]`) })
      .first();
    try {
      await article.waitFor({ state: 'visible', timeout: this.deps.timeoutMs });
    } catch {
      throw new XError('INVALID_TARGET', `Post ${statusId} was not found on the page`);
    }
    return article;
  }

  private async verifyAppears(locator: Locator, what: string): Promise<void> {
    try {
      await locator.waitFor({ state: 'visible', timeout: this.deps.timeoutMs });
    } catch {
      throw new XError(
        'UNKNOWN_OUTCOME',
        `The ${what} was clicked but the UI did not confirm the change — verify manually, do not retry blindly`,
      );
    }
  }

  /** Waits for the confirmation toast and extracts the resulting post URL. */
  private async awaitToastResult(
    page: Page,
    action: PreparedAction,
    detail: string,
  ): Promise<ExecuteResult> {
    const toast = page.locator(SELECTORS.actions.toast).first();
    try {
      await toast.waitFor({ state: 'visible', timeout: this.deps.timeoutMs });
    } catch {
      throw new XError(
        'UNKNOWN_OUTCOME',
        'The submit was clicked but no confirmation appeared — verify manually, do not retry blindly',
      );
    }
    const href = await toast
      .locator('a[href*="/status/"]')
      .first()
      .getAttribute('href', { timeout: 1_000 })
      .catch(() => null);
    const ref = href ? extractStatusRef(`https://x.com${href}`) : null;
    return this.result(action, ref, detail);
  }

  private result(
    action: PreparedAction,
    ref: StatusRef | null,
    detail: string,
  ): ExecuteResult {
    return {
      executed: true,
      action: action.kind,
      account: action.account,
      resultUrl: ref ? canonicalStatusUrl(ref.statusId, ref.handle) : null,
      statusId: ref?.statusId ?? null,
      detail,
    };
  }
}
