import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserManager } from '../../src/browser/browser-manager.js';
import { ActionStore } from '../../src/safety/action-store.js';
import { WriteRateLimiter } from '../../src/safety/rate-limiter.js';
import { createServer } from '../../src/server.js';
import { ReadService } from '../../src/x/read-service.js';
import { WriteService } from '../../src/x/write-service.js';

const fixtureUrl = (name: string) =>
  `file://${join(process.cwd(), 'tests', 'fixtures', name)}`;

const EXPECTED_TOOLS = [
  'x_session_status',
  'x_get_post',
  'x_get_profile',
  'x_search_posts',
  'x_get_timeline',
  'x_get_notifications',
  'x_prepare_post',
  'x_prepare_reply',
  'x_prepare_like',
  'x_prepare_repost',
  'x_prepare_follow',
  'x_prepare_delete_post',
  'x_execute_action',
];

function firstText(result: unknown): string {
  const content = (result as { content?: { type: string; text: string }[] }).content;
  return content?.[0]?.text ?? '';
}

describe('MCP server', () => {
  let profileDir: string;
  let manager: BrowserManager;
  let client: Client;

  beforeAll(async () => {
    profileDir = await mkdtemp(join(tmpdir(), 'x-mcp-server-'));
    manager = new BrowserManager({
      mode: 'persistent',
      headless: true,
      profileDir,
      locale: 'en-US',
      timeoutMs: 5_000,
    });
    await manager.goto(fixtureUrl('x-home.html'));

    const readService = new ReadService(manager, {
      timeoutMs: 3_000,
      maxReadItems: 20,
      retryBaseDelayMs: 50,
      urls: {
        post: () => fixtureUrl('x-post.html'),
        profile: () => fixtureUrl('x-profile.html'),
        search: () => fixtureUrl('x-search.html'),
        home: () => fixtureUrl('x-home.html'),
        notifications: () => fixtureUrl('x-notifications.html'),
      },
    });
    const writeService = new WriteService(manager, {
      store: new ActionStore(120_000),
      limiter: new WriteRateLimiter({ minIntervalMs: 0, maxPerHour: 1_000 }),
      timeoutMs: 3_000,
      urls: {
        compose: () => fixtureUrl('x-compose.html'),
        post: () => fixtureUrl('x-write-post.html'),
        profile: () => fixtureUrl('x-follow-profile.html'),
        home: () => fixtureUrl('x-home.html'),
      },
    });

    const server = createServer({ readService, writeService });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await manager.close();
    await rm(profileDir, { recursive: true, force: true });
  });

  it('lists all tools with safety annotations', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());

    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('x_get_post')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('x_prepare_post')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('x_execute_action')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('x_execute_action')?.annotations?.readOnlyHint).toBeFalsy();
  });

  it('reads a post through the MCP tool', async () => {
    const result = await client.callTool({
      name: 'x_get_post',
      arguments: { target: 'https://x.com/carol/status/1000000000000000042' },
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(firstText(result)) as {
      post: { statusId: string };
      meta: { sourceUrl: string };
    };
    expect(payload.post.statusId).toBe('1000000000000000042');
    expect(payload.meta.sourceUrl).toContain('x-post.html');
  });

  it('reports typed errors for invalid targets', async () => {
    const result = await client.callTool({
      name: 'x_get_post',
      arguments: { target: 'garbage' },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('INVALID_TARGET');
  });

  it('prepare returns a token without publishing; execute publishes', async () => {
    const prepared = await client.callTool({
      name: 'x_prepare_post',
      arguments: { text: 'Posted via MCP test' },
    });
    expect(prepared.isError).toBeFalsy();
    const prep = JSON.parse(firstText(prepared)) as {
      confirmationToken: string;
      requiredPhrase: string;
      executed: boolean;
    };
    expect(prep.executed).toBe(false);
    expect(prep.requiredPhrase).toBe('CONFIRM');

    const executed = await client.callTool({
      name: 'x_execute_action',
      arguments: {
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: 'CONFIRM',
      },
    });
    expect(executed.isError).toBeFalsy();
    const outcome = JSON.parse(firstText(executed)) as { executed: boolean; resultUrl: string };
    expect(outcome.executed).toBe(true);
    expect(outcome.resultUrl).toContain('/status/');
  });

  it('rejects execution with a wrong phrase', async () => {
    const prepared = await client.callTool({
      name: 'x_prepare_post',
      arguments: { text: 'Should not go out' },
    });
    const prep = JSON.parse(firstText(prepared)) as { confirmationToken: string };
    const executed = await client.callTool({
      name: 'x_execute_action',
      arguments: {
        confirmationToken: prep.confirmationToken,
        confirmationPhrase: 'yes please',
      },
    });
    expect(executed.isError).toBe(true);
    expect(firstText(executed)).toContain('CONFIRMATION_REQUIRED');
  });
});
