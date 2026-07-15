#!/usr/bin/env node

/**
 * Entry point for the X.com browser MCP server.
 * The server transport is stdio, so nothing may write to stdout
 * except the MCP protocol itself.
 */
async function main(): Promise<void> {
  // Server wiring is added in later tasks.
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
