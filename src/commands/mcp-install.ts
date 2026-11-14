import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type SupportedClient = 'cursor' | 'claude' | 'windsurf' | 'vscode';

export interface McpInstallOptions {
  readonly client?: string | undefined;
  readonly workspace?: boolean | undefined;
  readonly print?: boolean | undefined;
  readonly cwd?: string | undefined;
  readonly homedir?: string | undefined;
}

export interface McpInstallResult {
  readonly client: SupportedClient;
  readonly path: string;
  readonly updated: boolean;
  readonly status: 'updated' | 'created' | 'printed';
}

const MCP_ENTRY = {
  command: 'npx',
  args: ['-y', 'cfr-free@latest', 'mcp'],
};

/** Determine target config paths for each supported client. */
export function clientConfigPath(
  client: SupportedClient,
  options: { cwd: string; homedir: string; workspace?: boolean | undefined },
): string {
  const { cwd, homedir, workspace } = options;
  switch (client) {
    case 'cursor':
      return workspace === false
        ? path.join(
            homedir,
            'Library',
            'Application Support',
            'Cursor',
            'User',
            'globalStorage',
            'cursor.mcp',
            'mcp.json',
          )
        : path.join(cwd, '.cursor', 'mcp.json');
    case 'vscode':
      return path.join(cwd, '.vscode', 'mcp.json');
    case 'windsurf':
      return path.join(homedir, '.codeium', 'windsurf', 'mcp_config.json');
    case 'claude':
      if (process.platform === 'win32') {
        const appData = process.env['APPDATA'] ?? path.join(homedir, 'AppData', 'Roaming');
        return path.join(appData, 'Claude', 'claude_desktop_config.json');
      }
      if (process.platform === 'darwin') {
        return path.join(
          homedir,
          'Library',
          'Application Support',
          'Claude',
          'claude_desktop_config.json',
        );
      }
      return path.join(homedir, '.config', 'Claude', 'claude_desktop_config.json');
  }
}

/** Generate a snippet object for display. */
export function formatMcpSnippet(): string {
  return JSON.stringify({ mcpServers: { 'cfr-free': MCP_ENTRY } }, null, 2);
}

/** Install or update MCP server config for the given client. */
export function installClientConfig(
  _client: SupportedClient,
  targetPath: string,
): { updated: boolean; status: 'updated' | 'created' } {
  let existing: Record<string, unknown> = {};
  let isCreated = true;
  try {
    const raw = readFileSync(targetPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
      isCreated = false;
    }
  } catch {
    // File does not exist or invalid JSON; start fresh
    isCreated = true;
  }

  const mcpServers =
    existing['mcpServers'] &&
    typeof existing['mcpServers'] === 'object' &&
    !Array.isArray(existing['mcpServers'])
      ? (existing['mcpServers'] as Record<string, unknown>)
      : {};

  mcpServers['cfr-free'] = MCP_ENTRY;
  existing['mcpServers'] = mcpServers;

  const parentDir = path.dirname(targetPath);
  mkdirSync(parentDir, { recursive: true });
  writeFileSync(targetPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');

  return {
    updated: true,
    status: isCreated ? 'created' : 'updated',
  };
}

/** Execute the `cfr-free mcp install` command. */
export function runMcpInstallCommand(options: McpInstallOptions = {}): {
  readonly results: readonly McpInstallResult[];
  readonly output: string;
} {
  const cwd = options.cwd ?? process.cwd();
  const homedir = options.homedir ?? os.homedir();
  const rawClient = (options.client ?? 'all').toLowerCase();

  const validClients: SupportedClient[] =
    rawClient === 'all'
      ? ['cursor', 'claude', 'windsurf', 'vscode']
      : (rawClient.split(',').map((c) => c.trim()) as SupportedClient[]);

  if (options.print === true) {
    const lines = [
      '# Add cfr-free to your MCP client configuration:\n',
      'For Cursor (.cursor/mcp.json), Claude Desktop (claude_desktop_config.json), or Windsurf (mcp_config.json):\n',
      '```json',
      formatMcpSnippet(),
      '```',
    ];
    return {
      results: validClients.map((client) => ({
        client,
        path: clientConfigPath(client, { cwd, homedir, workspace: options.workspace }),
        updated: false,
        status: 'printed',
      })),
      output: lines.join('\n') + '\n',
    };
  }

  const results: McpInstallResult[] = [];
  const lines: string[] = [];

  for (const client of validClients) {
    const targetPath = clientConfigPath(client, { cwd, homedir, workspace: options.workspace });
    const { updated, status } = installClientConfig(client, targetPath);
    results.push({ client, path: targetPath, updated, status });
    lines.push(`✓ Configured cfr-free for ${client}: ${targetPath}`);
  }

  lines.push('\ncfr-free MCP server is configured. Restart or reload your AI editor to connect.');
  return { results, output: lines.join('\n') + '\n' };
}
