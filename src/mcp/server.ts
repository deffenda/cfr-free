import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CFRService } from '../core/service.js';
import type { EcfrApi } from '../core/ecfr.js';
import type { Logger } from '../logger.js';
import { VERSION } from '../version.js';
import { registerResources } from './resources.js';
import { registerTools } from './tools.js';

/**
 * Build the MCP server. Pure factory: no I/O, no transport, no process state —
 * tests wire it to an in-memory transport. `deps.ecfr` gates the `diff_issues`
 * tool: absent (the default) the server shape is the six local-index tools.
 */
export function buildMcpServer(
  service: CFRService,
  logger: Logger,
  deps?: { readonly ecfr?: EcfrApi },
): McpServer {
  const server = new McpServer({ name: 'cfr-free', version: VERSION });
  registerTools(server, service, logger, deps);
  registerResources(server, service, logger);
  return server;
}
