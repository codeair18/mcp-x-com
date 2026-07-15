import { pino, type Logger } from 'pino';

/**
 * Stdout carries the MCP protocol exclusively, so all logging goes to
 * stderr (fd 2). Log content policy: never cookies, storage, headers,
 * page DOM or draft text — identifiers and fingerprints only.
 */
export function createLogger(level: string): Logger {
  return pino({ level }, process.stderr);
}
