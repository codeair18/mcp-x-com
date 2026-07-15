import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserManager } from '../../src/browser/browser-manager.js';
import { isXError } from '../../src/errors.js';
import { ReadService, type XUrlResolver } from '../../src/x/read-service.js';

const fixtureUrl = (name: string) =>
  `file://${join(process.cwd(), 'tests', 'fixtures', name)}`;

function fixtureResolver(overrides: Partial<XUrlResolver> = {}): XUrlResolver {
  return {
    post: () => fixtureUrl('x-post.html'),
    profile: () => fixtureUrl('x-profile.html'),
    search: () => fixtureUrl('x-search.html'),
    home: () => fixtureUrl('x-home.html'),
    notifications: () => fixtureUrl('x-notifications.html'),
    ...overrides,
  };
}

describe('ReadService (fixtures)', () => {
  let profileDir: string;
  let manager: BrowserManager;

  const service = (urls: XUrlResolver) =>
    new ReadService(manager, {
      timeoutMs: 3_000,
      maxReadItems: 20,
      maxScrolls: 3,
      retryBaseDelayMs: 50,
      urls,
    });

  beforeAll(async () => {
    profileDir = await mkdtemp(join(tmpdir(), 'x-mcp-read-'));
    manager = new BrowserManager({
      mode: 'persistent',
      headless: true,
      profileDir,
      locale: 'en-US',
      timeoutMs: 5_000,
    });
  });

  afterAll(async () => {
    await manager.close();
    await rm(profileDir, { recursive: true, force: true });
  });

  it('getPost returns the main post with metadata', async () => {
    const result = await service(fixtureResolver()).getPost(
      'https://x.com/carol/status/1000000000000000042',
    );
    expect(result.post.statusId).toBe('1000000000000000042');
    expect(result.post.author.handle).toBe('carol');
    expect(result.post.metrics.likes).toBe(5300);
    expect(result.meta.sourceUrl).toContain('x-post.html');
    expect(result.meta.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.meta.warnings).toEqual([]);
  });

  it('getPost rejects unrecognizable input as INVALID_TARGET', async () => {
    await expect(service(fixtureResolver()).getPost('not-a-post')).rejects.toSatisfy(
      (error: unknown) => isXError(error, 'INVALID_TARGET'),
    );
  });

  it('getProfile returns structured profile data', async () => {
    const result = await service(fixtureResolver()).getProfile('@dana');
    expect(result.profile.handle).toBe('dana');
    expect(result.profile.followersCount).toBe(5432);
  });

  it('searchPosts deduplicates by statusId', async () => {
    const result = await service(fixtureResolver()).searchPosts('mcp', {
      limit: 10,
      sort: 'latest',
    });
    expect(result.posts.map((p) => p.statusId)).toEqual([
      '1000000000000000001',
      '1000000000000000060',
    ]);
    expect(result.meta.truncated).toBe(false);
  });

  it('getTimeline truncates to the requested limit', async () => {
    const result = await service(fixtureResolver()).getTimeline({ limit: 1 });
    expect(result.posts).toHaveLength(1);
    expect(result.meta.truncated).toBe(true);
  });

  it('getTimeline stops scrolling when no new posts appear', async () => {
    const result = await service(fixtureResolver()).getTimeline({ limit: 10 });
    expect(result.posts).toHaveLength(2);
    expect(result.meta.truncated).toBe(false);
    expect(result.meta.warnings.join(' ')).toMatch(/fewer|no new/i);
  });

  it('getNotifications returns mention posts', async () => {
    const result = await service(fixtureResolver()).getNotifications({ limit: 5 });
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.author.handle).toBe('frank');
  });

  it('fails with NOT_AUTHENTICATED on the logged-out page without retrying', async () => {
    let calls = 0;
    const urls = fixtureResolver({
      home: () => {
        calls += 1;
        return fixtureUrl('x-logged-out.html');
      },
    });
    await expect(service(urls).getTimeline({ limit: 5 })).rejects.toSatisfy((error: unknown) =>
      isXError(error, 'NOT_AUTHENTICATED'),
    );
    expect(calls).toBe(1);
  });

  it('fails with RATE_LIMITED on the rate limit page', async () => {
    const urls = fixtureResolver({ search: () => fixtureUrl('x-rate-limit.html') });
    await expect(
      service(urls).searchPosts('mcp', { limit: 5, sort: 'latest' }),
    ).rejects.toSatisfy((error: unknown) => isXError(error, 'RATE_LIMITED'));
  });

  it('retries load errors up to 2 times, then reports SELECTOR_DRIFT', async () => {
    let calls = 0;
    const urls = fixtureResolver({
      search: () => {
        calls += 1;
        return fixtureUrl('x-error.html');
      },
    });
    await expect(
      service(urls).searchPosts('mcp', { limit: 5, sort: 'latest' }),
    ).rejects.toSatisfy((error: unknown) => isXError(error, 'SELECTOR_DRIFT'));
    expect(calls).toBe(3);
  });

  it('recovers when a retry succeeds', async () => {
    let calls = 0;
    const urls = fixtureResolver({
      search: () => {
        calls += 1;
        return calls === 1 ? fixtureUrl('x-error.html') : fixtureUrl('x-search.html');
      },
    });
    const result = await service(urls).searchPosts('mcp', { limit: 5, sort: 'latest' });
    expect(result.posts).toHaveLength(2);
    expect(calls).toBe(2);
  });

  it('reports the session status with the active handle', async () => {
    const status = await service(fixtureResolver()).getSessionStatus();
    expect(status).toEqual({ status: 'logged_in', handle: 'testuser' });
  });
});
