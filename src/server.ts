import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools, type ToolDeps } from './tools/register-tools.js';

export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer({
    name: 'x-browser-mcp',
    version: '0.1.0',
  });
  registerTools(server, deps);
  return server;
}
