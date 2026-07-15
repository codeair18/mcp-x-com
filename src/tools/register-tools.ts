import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadService } from '../x/read-service.js';
import type { WriteService } from '../x/write-service.js';
import { registerExecuteTool } from './execute-tool.js';
import { registerPrepareTools } from './prepare-tools.js';
import { registerReadTools } from './read-tools.js';

export interface ToolDeps {
  readService: ReadService;
  writeService: WriteService;
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  registerReadTools(server, deps.readService);
  registerPrepareTools(server, deps.writeService);
  registerExecuteTool(server, deps.writeService);
}

/** Serializes a successful tool result as pretty JSON text. */
export function toolResult(data: unknown): {
  content: { type: 'text'; text: string }[];
} {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Maps errors to `CODE: message` so agents can branch on the code. */
export function toolError(error: unknown): {
  isError: true;
  content: { type: 'text'; text: string }[];
} {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'INTERNAL_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text', text: `${code}: ${message}` }] };
}

export async function runTool(fn: () => Promise<unknown>): Promise<
  ReturnType<typeof toolResult> | ReturnType<typeof toolError>
> {
  try {
    return toolResult(await fn());
  } catch (error) {
    return toolError(error);
  }
}
