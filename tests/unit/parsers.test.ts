import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserManager } from '../../src/browser/browser-manager.js';
import {
  dedupeByStatusId,
  parseCount,
  parseProfilePage,
  parseTweetArticles,
} from '../../src/x/parsers.js';

const fixtureUrl = (name: string) =>
  `file://${join(process.cwd(), 'tests', 'fixtures', name)}`;

describe('parseCount', () => {
  it('parses plain, separated and suffixed numbers', () => {
    expect(parseCount('5 Replies. Reply')).toBe(5);
    expect(parseCount('1,234 reposts. Repost')).toBe(1234);
    expect(parseCount('5.3K Likes. Like')).toBe(5300);
    expect(parseCount('2M Likes. Like')).toBe(2_000_000);
    expect(parseCount('0 Replies. Reply')).toBe(0);
  });

  it('returns null when no number is present', () => {
    expect(parseCount('Reply')).toBeNull();
    expect(parseCount(null)).toBeNull();
    expect(parseCount('')).toBeNull();
  });
});

describe('dedupeByStatusId', () => {
  it('keeps the first occurrence of each status ID', () => {
    const posts = [{ statusId: '1' }, { statusId: '2' }, { statusId: '1' }];
    expect(dedupeByStatusId(posts).map((p) => p.statusId)).toEqual(['1', '2']);
  });
});

describe('page parsers', () => {
  let profileDir: string;
  let manager: BrowserManager;

  beforeAll(async () => {
    profileDir = await mkdtemp(join(tmpdir(), 'x-mcp-parsers-'));
    manager = new BrowserManager({
      mode: 'persistent',
      headless: true,
      profileDir,
      locale: 'en-US',
      timeoutMs: 15_000,
    });
  });

  afterAll(async () => {
    await manager.close();
    await rm(profileDir, { recursive: true, force: true });
  });

  it('parses a full post with author, time, metrics, media and quote', async () => {
    await manager.goto(fixtureUrl('x-post.html'));
    const posts = await manager.withPage((page) => parseTweetArticles(page, 10));

    const main = posts[0];
    expect(main).toBeDefined();
    expect(main?.statusId).toBe('1000000000000000042');
    expect(main?.url).toBe('https://x.com/carol/status/1000000000000000042');
    expect(main?.author).toEqual({ handle: 'carol', displayName: 'Carol Fixture' });
    expect(main?.text).toBe('Main fixture post with two photos and a quote.');
    expect(main?.postedAt).toBe('2026-07-12T09:15:00.000Z');
    expect(main?.metrics).toEqual({ replies: 12, reposts: 1234, likes: 5300 });
    expect(main?.media).toHaveLength(2);
    expect(main?.media[0]?.type).toBe('image');
    expect(main?.media[0]?.alt).toBe('First photo');
    expect(main?.media[1]?.alt).toBeNull();
    expect(main?.quotedPost).toEqual({
      statusId: '1000000000000000001',
      handle: 'alice',
      text: 'First fixture post about browser automation.',
    });
    expect(main?.isReply).toBe(false);
  });

  it('parses a reply with missing metrics as nulls', async () => {
    await manager.goto(fixtureUrl('x-post.html'));
    const posts = await manager.withPage((page) => parseTweetArticles(page, 10));

    const reply = posts[1];
    expect(reply?.statusId).toBe('1000000000000000043');
    expect(reply?.author.handle).toBe('dave');
    expect(reply?.isReply).toBe(true);
    expect(reply?.metrics).toEqual({ replies: null, reposts: null, likes: null });
    expect(reply?.media).toEqual([]);
    expect(reply?.quotedPost).toBeUndefined();
  });

  it('respects the limit when parsing timelines', async () => {
    await manager.goto(fixtureUrl('x-home.html'));
    const posts = await manager.withPage((page) => parseTweetArticles(page, 1));
    expect(posts).toHaveLength(1);
  });

  it('parses a profile page', async () => {
    await manager.goto(fixtureUrl('x-profile.html'));
    const profile = await manager.withPage((page) => parseProfilePage(page, 'dana'));

    expect(profile.handle).toBe('dana');
    expect(profile.displayName).toBe('Dana Fixture');
    expect(profile.bio).toBe('Test profile for the X browser MCP fixtures.');
    expect(profile.location).toBe('Fixture City');
    expect(profile.website).toBe('https://example.org');
    expect(profile.joined).toBe('Joined March 2020');
    expect(profile.followingCount).toBe(321);
    expect(profile.followersCount).toBe(5432);
    expect(profile.url).toBe('https://x.com/dana');
  });
});
