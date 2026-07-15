import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserManager } from '../../src/browser/browser-manager.js';
import { detectSessionState } from '../../src/browser/session-guard.js';

const fixtureUrl = (name: string) =>
  `file://${join(process.cwd(), 'tests', 'fixtures', name)}`;

describe('detectSessionState', () => {
  let profileDir: string;
  let manager: BrowserManager;

  beforeAll(async () => {
    profileDir = await mkdtemp(join(tmpdir(), 'x-mcp-guard-'));
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

  it('reports logged_in with the active handle', async () => {
    await manager.goto(fixtureUrl('x-home.html'));
    const state = await manager.withPage((page) => detectSessionState(page, 3_000));
    expect(state).toEqual({ status: 'logged_in', handle: 'testuser' });
  });

  it('reports logged_out on the public landing page', async () => {
    await manager.goto(fixtureUrl('x-logged-out.html'));
    const state = await manager.withPage((page) => detectSessionState(page, 3_000));
    expect(state).toEqual({ status: 'logged_out' });
  });

  it('reports unknown when neither state is detectable', async () => {
    await manager.goto(fixtureUrl('blank.html'));
    const state = await manager.withPage((page) => detectSessionState(page, 1_000));
    expect(state).toEqual({ status: 'unknown' });
  });
});
