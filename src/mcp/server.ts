import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CFRService } from '../core/service.js';
import type { Logger } from '../logger.js';
import { VERSION } from '../version.js';
import { registerResources } from './resources.js';
import { registerTools } from './tools.js';

/**
 * Build the MCP server. Pure factory: no I/O, no transport, no process state —
 * tests wire it to an in-memory transport.
 */
export function buildMcpServer(service: CFRService, logger: Logger): McpServer {
  const server = new McpServer({ name: 'cfr-free', version: VERSION });
  registerTools(server, service, logger);
  registerResources(server, service, logger);
  return server;
}
