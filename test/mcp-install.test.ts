import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clientConfigPath,
  formatMcpSnippet,
  installClientConfig,
  runMcpInstallCommand,
} from '../src/commands/mcp-install.js';

describe('mcp-install', () => {
  it('formats snippet with npx command and mcp args', () => {
    const snippet = formatMcpSnippet();
    expect(snippet).toContain('"cfr-free"');
    expect(snippet).toContain('"command": "npx"');
    expect(snippet).toContain('"args": [');
    expect(snippet).toContain('"mcp"');
  });

  it('computes expected paths for cursor, vscode, and windsurf', () => {
    const cwd = '/test/workspace';
    const homedir = '/test/home';
    expect(clientConfigPath('cursor', { cwd, homedir })).toBe(
      path.join(cwd, '.cursor', 'mcp.json'),
    );
    expect(clientConfigPath('vscode', { cwd, homedir })).toBe(
      path.join(cwd, '.vscode', 'mcp.json'),
    );
    expect(clientConfigPath('windsurf', { cwd, homedir })).toBe(
      path.join(homedir, '.codeium', 'windsurf', 'mcp_config.json'),
    );
  });

  it('creates target file and injects cfr-free server entry', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cfr-mcp-install-'));
    try {
      const target = path.join(tempDir, '.cursor', 'mcp.json');
      const result = installClientConfig('cursor', target);
      expect(result.status).toBe('created');
      expect(result.updated).toBe(true);

      const content = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
      expect(content['mcpServers']).toBeDefined();
      const servers = content['mcpServers'] as Record<string, unknown>;
      expect(servers['cfr-free']).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves existing servers when updating config', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cfr-mcp-preserve-'));
    try {
      const target = path.join(tempDir, 'mcp.json');
      writeFileSync(
        target,
        JSON.stringify({ mcpServers: { other: { command: 'other-cmd' } } }),
        'utf8',
      );
      const result = installClientConfig('cursor', target);
      expect(result.status).toBe('updated');

      const content = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
      const servers = content['mcpServers'] as Record<string, unknown>;
      expect(servers['other']).toEqual({ command: 'other-cmd' });
      expect(servers['cfr-free']).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('supports --print mode without writing files', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cfr-mcp-print-'));
    try {
      const res = runMcpInstallCommand({ print: true, cwd: tempDir, homedir: tempDir });
      expect(res.output).toContain('```json');
      expect(res.output).toContain('"cfr-free"');
      expect(res.results.every((r) => r.status === 'printed')).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('installs across clients in specified cwd and homedir', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cfr-mcp-run-'));
    try {
      const res = runMcpInstallCommand({
        client: 'cursor,vscode',
        cwd: tempDir,
        homedir: tempDir,
      });
      expect(res.results.length).toBe(2);
      expect(res.output).toContain('Configured cfr-free for cursor');
      expect(res.output).toContain('Configured cfr-free for vscode');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
