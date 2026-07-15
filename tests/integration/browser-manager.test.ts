import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserManager } from '../../src/browser/browser-manager.js';
import type { AppConfig } from '../../src/config.js';

function browserConfig(profileDir: string): AppConfig['browser'] {
  return {
    mode: 'persistent',
    headless: true,
    profileDir,
    locale: 'en-US',
    timeoutMs: 15_000,
  };
}

describe('BrowserManager', () => {
  let profileDir: string;
  let manager: BrowserManager;

  beforeEach(async () => {
    profileDir = await mkdtemp(join(tmpdir(), 'x-mcp-profile-'));
    manager = new BrowserManager(browserConfig(profileDir));
  });

  afterEach(async () => {
    await manager.close();
    await rm(profileDir, { recursive: true, force: true });
  });

  it('launches a single persistent context and reuses the same page', async () => {
    const first = await manager.withPage((page) => Promise.resolve(page));
    const second = await manager.withPage((page) => Promise.resolve(page));
    expect(first).toBe(second);
  });

  it('serializes operations instead of running them in parallel', async () => {
    const order: string[] = [];
    const slow = manager.withPage(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      order.push('slow');
    });
    const fast = manager.withPage(() => {
      order.push('fast');
      return Promise.resolve();
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['slow', 'fast']);
  });

  it('keeps the queue alive after an operation fails', async () => {
    await expect(
      manager.withPage(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    const result = await manager.withPage(() => Promise.resolve('still-works'));
    expect(result).toBe('still-works');
  });

  it('blocks navigation outside the allowed domains', async () => {
    await expect(manager.goto('https://example.com')).rejects.toThrow(/not allowed/i);
  });

  it('navigates to allowed fixture pages', async () => {
    const fixture = join(process.cwd(), 'tests', 'fixtures', 'blank.html');
    await manager.goto(`file://${fixture}`);
    const title = await manager.withPage((page) => page.title());
    expect(title).toBe('Fixture');
  });

  it('close is graceful and idempotent', async () => {
    await manager.withPage(() => Promise.resolve());
    await manager.close();
    await manager.close();
  });
});
