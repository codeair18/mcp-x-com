import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BrowserManager } from '../../src/browser/browser-manager.js';
import { isXError } from '../../src/errors.js';
import { ActionStore } from '../../src/safety/action-store.js';
import { WriteRateLimiter } from '../../src/safety/rate-limiter.js';
import { WriteService, type WriteUrlResolver } from '../../src/x/write-service.js';

const fixtureUrl = (name: string, query = '') =>
  `file://${join(process.cwd(), 'tests', 'fixtures', name)}${query}`;

const fixturePath = (name: string) => join(process.cwd(), 'tests', 'fixtures', name);

function resolver(overrides: Partial<WriteUrlResolver> = {}): WriteUrlResolver {
  return {
    compose: () => fixtureUrl('x-compose.html'),
    post: () => fixtureUrl('x-write-post.html'),
    profile: () => fixtureUrl('x-follow-profile.html'),
    home: () => fixtureUrl('x-home.html'),
    ...overrides,
  };
}

const TARGET = 'https://x.com/testuser/status/1000000000000000042';
const TARGET_ID = '1000000000000000042';

describe('WriteService (fixtures)', () => {
  let profileDir: string;
  let manager: BrowserManager;
  let store: ActionStore;
  let limiter: WriteRateLimiter;

  const service = (urls: WriteUrlResolver = resolver(), maxPostChars?: number) =>
    new WriteService(manager, {
      store,
      limiter,
      timeoutMs: 3_000,
      urls,
      ...(maxPostChars !== undefined ? { maxPostChars } : {}),
    });

  beforeAll(async () => {
    profileDir = await mkdtemp(join(tmpdir(), 'x-mcp-write-'));
    manager = new BrowserManager({
      mode: 'persistent',
      headless: true,
      profileDir,
      locale: 'en-US',
      timeoutMs: 5_000,
    });
    // Establish a logged-in "current page" once; prepare reads it.
    await manager.goto(fixtureUrl('x-home.html'));
  });

  beforeEach(() => {
    store = new ActionStore(120_000);
    // Generous limits by default so individual tests control throttling.
    limiter = new WriteRateLimiter({ minIntervalMs: 0, maxPerHour: 1_000 });
  });

  afterAll(async () => {
    await manager.close();
    await rm(profileDir, { recursive: true, force: true });
  });

  describe('prepare', () => {
    it('returns a confirmation contract and does not publish', async () => {
      const svc = service();
      const prep = await svc.preparePost({ text: 'Hello from the fixture test' });
      expect(prep.executed).toBe(false);
      expect(prep.action).toBe('post');
      expect(prep.account).toBe('testuser');
      expect(prep.preview).toContain('Hello from the fixture test');
      expect(prep.requiredPhrase).toBe('CONFIRM');
      expect(prep.confirmationToken.length).toBeGreaterThanOrEqual(32);
      // Prepare must not navigate to compose or click anything.
      const url = await manager.withPage((page) => Promise.resolve(page.url()));
      expect(url).not.toContain('x-compose.html');
    });

    it('rejects text over the 25000 character Premium limit', async () => {
      await expect(service().preparePost({ text: 'x'.repeat(25_001) })).rejects.toSatisfy(
        (e: unknown) => isXError(e, 'INVALID_TARGET'),
      );
    });

    it('honors a configured lower character limit', async () => {
      await expect(
        service(resolver(), 100).preparePost({ text: 'x'.repeat(101) }),
      ).rejects.toSatisfy((e: unknown) => isXError(e, 'INVALID_TARGET'));
      const prep = await service(resolver(), 100).preparePost({ text: 'x'.repeat(100) });
      expect(prep.executed).toBe(false);
    });

    it('rejects empty text', async () => {
      await expect(service().preparePost({ text: '   ' })).rejects.toSatisfy((e: unknown) =>
        isXError(e, 'INVALID_TARGET'),
      );
    });

    it('rejects more than 4 images', async () => {
      const img = fixturePath('img1.png');
      await expect(
        service().preparePost({ text: 'hi', mediaPaths: [img, img, img, img, img] }),
      ).rejects.toSatisfy((e: unknown) => isXError(e, 'INVALID_TARGET'));
    });

    it('rejects non-image files and missing files', async () => {
      await expect(
        service().preparePost({ text: 'hi', mediaPaths: [fixturePath('not-image.txt')] }),
      ).rejects.toSatisfy((e: unknown) => isXError(e, 'INVALID_TARGET'));
      await expect(
        service().preparePost({ text: 'hi', mediaPaths: [fixturePath('missing.png')] }),
      ).rejects.toSatisfy((e: unknown) => isXError(e, 'INVALID_TARGET'));
    });

    it('rejects oversized images', async () => {
      const bigPath = join(tmpdir(), `x-mcp-big-${Date.now()}.png`);
      await writeFile(bigPath, Buffer.alloc(5 * 1024 * 1024 + 1));
      try {
        await expect(
          service().preparePost({ text: 'hi', mediaPaths: [bigPath] }),
        ).rejects.toSatisfy((e: unknown) => isXError(e, 'INVALID_TARGET'));
      } finally {
        await rm(bigPath, { force: true });
      }
    });

    it('requires a DELETE phrase naming the post for deletions', async () => {
      const prep = await service().prepareDeletePost({ target: TARGET });
      expect(prep.requiredPhrase).toBe(`DELETE ${TARGET_ID}`);
    });
  });

  describe('execute', () => {
    it('publishes a post only after confirmation and returns the URL', async () => {
      const svc = service();
      const prep = await svc.preparePost({ text: 'Publish me' });
      const result = await svc.executeAction({
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: 'CONFIRM',
      });
      expect(result.executed).toBe(true);
      expect(result.resultUrl).toBe('https://x.com/testuser/status/1000000000000000099');
      expect(result.statusId).toBe('1000000000000000099');
    });

    it('publishes a post with images', async () => {
      const svc = service();
      const prep = await svc.preparePost({
        text: 'With images',
        mediaPaths: [fixturePath('img1.png'), fixturePath('img2.png')],
      });
      const result = await svc.executeAction({
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: 'CONFIRM',
      });
      expect(result.executed).toBe(true);
      expect(result.statusId).toBe('1000000000000000099');
    });

    it('rejects a wrong confirmation phrase without publishing', async () => {
      const svc = service();
      const prep = await svc.preparePost({ text: 'Should not publish' });
      await expect(
        svc.executeAction({
          confirmationToken: prep.confirmationToken,
          confirmationPhrase: 'confirm',
        }),
      ).rejects.toSatisfy((e: unknown) => isXError(e, 'CONFIRMATION_REQUIRED'));
    });

    it('rejects an unknown token', async () => {
      await expect(
        service().executeAction({ confirmationToken: 'nope', confirmationPhrase: 'CONFIRM' }),
      ).rejects.toSatisfy((e: unknown) => isXError(e, 'CONFIRMATION_REQUIRED'));
    });

    it('rejects an expired token', async () => {
      let now = 0;
      store = new ActionStore(1_000, () => now);
      const svc = service();
      const prep = await svc.preparePost({ text: 'Too late' });
      now = 2_000;
      await expect(
        svc.executeAction({
          confirmationToken: prep.confirmationToken,
          confirmationPhrase: 'CONFIRM',
        }),
      ).rejects.toSatisfy((e: unknown) => isXError(e, 'CONFIRMATION_EXPIRED'));
    });

    it('rejects execution when the active account changed', async () => {
      const svc = service();
      const prep = await svc.preparePost({ text: 'Account check' });
      await manager.goto(fixtureUrl('x-home-other.html'));
      try {
        await expect(
          svc.executeAction({
            confirmationToken: prep.confirmationToken,
            confirmationPhrase: 'CONFIRM',
          }),
        ).rejects.toSatisfy((e: unknown) => isXError(e, 'ACCOUNT_CHANGED'));
      } finally {
        await manager.goto(fixtureUrl('x-home.html'));
      }
    });

    it('enforces the write rate limit', async () => {
      limiter = new WriteRateLimiter({ minIntervalMs: 60_000, maxPerHour: 1_000 });
      const svc = service();
      const first = await svc.preparePost({ text: 'First write' });
      await svc.executeAction({
        confirmationToken: first.confirmationToken,
        confirmationPhrase: 'CONFIRM',
      });
      const second = await svc.preparePost({ text: 'Second write' });
      await expect(
        svc.executeAction({
          confirmationToken: second.confirmationToken,
          confirmationPhrase: 'CONFIRM',
        }),
      ).rejects.toSatisfy((e: unknown) => isXError(e, 'RATE_LIMITED'));
    });

    it('publishes a post over 280 characters when the account has Premium', async () => {
      const svc = service(resolver({ compose: () => fixtureUrl('x-compose.html', '?premium=1') }));
      const prep = await svc.preparePost({ text: 'y'.repeat(1_000) });
      const result = await svc.executeAction({
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: 'CONFIRM',
      });
      expect(result.executed).toBe(true);
      expect(result.statusId).toBe('1000000000000000099');
    });

    it('reports PREMIUM_REQUIRED for a long draft when X keeps the button disabled', async () => {
      // Default fixture behaves like a non-Premium account: 280-char cap.
      const svc = service();
      const prep = await svc.preparePost({ text: 'y'.repeat(300) });
      await expect(
        svc.executeAction({
          confirmationToken: prep.confirmationToken,
          confirmationPhrase: 'CONFIRM',
        }),
      ).rejects.toSatisfy((e: unknown) => isXError(e, 'PREMIUM_REQUIRED'));
    });

    it('reports SELECTOR_DRIFT when the post button never enables, without clicking', async () => {
      const svc = service(resolver({ compose: () => fixtureUrl('x-compose.html', '?disabled=1') }));
      const prep = await svc.preparePost({ text: 'Never enabled' });
      await expect(
        svc.executeAction({
          confirmationToken: prep.confirmationToken,
          confirmationPhrase: 'CONFIRM',
        }),
      ).rejects.toSatisfy((e: unknown) => isXError(e, 'SELECTOR_DRIFT'));
    });

    it('reports UNKNOWN_OUTCOME when no result appears after the click', async () => {
      const svc = service(resolver({ compose: () => fixtureUrl('x-compose.html', '?silent=1') }));
      const prep = await svc.preparePost({ text: 'Silent post' });
      await expect(
        svc.executeAction({
          confirmationToken: prep.confirmationToken,
          confirmationPhrase: 'CONFIRM',
        }),
      ).rejects.toSatisfy((e: unknown) => isXError(e, 'UNKNOWN_OUTCOME'));
    });
  });

  describe('reply, like, repost, follow, delete', () => {
    it('replies to a post', async () => {
      const svc = service();
      const prep = await svc.prepareReply({ target: TARGET, text: 'A fixture reply' });
      const result = await svc.executeAction({
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: 'CONFIRM',
      });
      expect(result.statusId).toBe('1000000000000000100');
    });

    it('likes a post and verifies the state change', async () => {
      const svc = service();
      const prep = await svc.prepareLike({ target: TARGET });
      const result = await svc.executeAction({
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: 'CONFIRM',
      });
      expect(result.executed).toBe(true);
      expect(result.detail).toMatch(/liked/i);
    });

    it('treats an already-liked post as a no-op', async () => {
      const svc = service(resolver({ post: () => fixtureUrl('x-write-post.html', '?liked=1') }));
      const prep = await svc.prepareLike({ target: TARGET });
      const result = await svc.executeAction({
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: 'CONFIRM',
      });
      expect(result.detail).toMatch(/already/i);
    });

    it('reposts a post through the confirm menu', async () => {
      const svc = service();
      const prep = await svc.prepareRepost({ target: TARGET });
      const result = await svc.executeAction({
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: 'CONFIRM',
      });
      expect(result.detail).toMatch(/reposted/i);
    });

    it('treats an already-reposted post as a no-op', async () => {
      const svc = service(
        resolver({ post: () => fixtureUrl('x-write-post.html', '?reposted=1') }),
      );
      const prep = await svc.prepareRepost({ target: TARGET });
      const result = await svc.executeAction({
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: 'CONFIRM',
      });
      expect(result.detail).toMatch(/already/i);
    });

    it('follows a profile', async () => {
      const svc = service();
      const prep = await svc.prepareFollow({ handle: '@dana' });
      const result = await svc.executeAction({
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: 'CONFIRM',
      });
      expect(result.detail).toMatch(/followed/i);
    });

    it('treats an already-followed profile as a no-op', async () => {
      const svc = service(
        resolver({ profile: () => fixtureUrl('x-follow-profile.html', '?following=1') }),
      );
      const prep = await svc.prepareFollow({ handle: 'dana' });
      const result = await svc.executeAction({
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: 'CONFIRM',
      });
      expect(result.detail).toMatch(/already/i);
    });

    it('deletes a post only with the exact DELETE phrase', async () => {
      const svc = service();
      const wrong = await svc.prepareDeletePost({ target: TARGET });
      await expect(
        svc.executeAction({
          confirmationToken: wrong.confirmationToken,
          confirmationPhrase: 'CONFIRM',
        }),
      ).rejects.toSatisfy((e: unknown) => isXError(e, 'CONFIRMATION_REQUIRED'));

      const prep = await svc.prepareDeletePost({ target: TARGET });
      const result = await svc.executeAction({
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: `DELETE ${TARGET_ID}`,
      });
      expect(result.executed).toBe(true);
      expect(result.detail).toMatch(/deleted/i);
    });
  });
});
