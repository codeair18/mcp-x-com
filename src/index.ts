#!/usr/bin/env node

/**
 * Entry point for the X.com browser MCP server. Transport is stdio:
 * stdout carries the MCP protocol exclusively; all logs go to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BrowserManager } from './browser/browser-manager.js';
import { loadConfig, redactConfig } from './config.js';
import { createLogger } from './logger.js';
import { ActionStore } from './safety/action-store.js';
import { WriteRateLimiter } from './safety/rate-limiter.js';
import { createServer } from './server.js';
import { ReadService } from './x/read-service.js';
import { WriteService } from './x/write-service.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config.logLevel);
  logger.info({ config: redactConfig(config) }, 'starting x-browser-mcp');

  const manager = new BrowserManager(config.browser);
  const readService = new ReadService(manager, {
    timeoutMs: config.browser.timeoutMs,
    maxReadItems: config.limits.maxReadItems,
  });
  const writeService = new WriteService(manager, {
    store: new ActionStore(config.safety.actionTokenTtlMs),
    limiter: new WriteRateLimiter({
      minIntervalMs: 5_000,
      maxPerHour: config.limits.writeRatePerHour,
    }),
    timeoutMs: config.browser.timeoutMs,
    maxPostChars: config.limits.maxPostChars,
  });

  const server = createServer({ readService, writeService });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    void manager
      .close()
      .catch(() => undefined)
      .then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await server.connect(new StdioServerTransport());
  logger.info('x-browser-mcp connected over stdio');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
