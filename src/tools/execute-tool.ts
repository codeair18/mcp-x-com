import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WriteService } from '../x/write-service.js';
import { runTool } from './register-tools.js';

export function registerExecuteTool(server: McpServer, writeService: WriteService): void {
  server.registerTool(
    'x_execute_action',
    {
      description:
        'Execute a previously prepared action on X. Requires the single-use confirmationToken from a x_prepare_* call plus the exact requiredPhrase, given with explicit user approval. The token is consumed by this call regardless of outcome; an ambiguous result returns UNKNOWN_OUTCOME and must never be retried blindly.',
      inputSchema: {
        confirmationToken: z.string().describe('Token returned by the matching x_prepare_* call'),
        confirmationPhrase: z
          .string()
          .describe('Exact required phrase: "CONFIRM", or "DELETE <postId>" for deletions'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ confirmationToken, confirmationPhrase }) =>
      runTool(() => writeService.executeAction({ confirmationToken, confirmationPhrase })),
  );
}
