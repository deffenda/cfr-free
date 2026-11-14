import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateVibePrompt, generateVibeRules } from '../src/commands/vibe.js';

describe('vibe rules and prompts', () => {
  it('generates cursor rules by default', () => {
    const rules = generateVibeRules();
    expect(rules.content).toContain('Title 38 CFR Domain & Adjudication Rules');
    expect(rules.content).toContain('search_sections');
    expect(rules.content).toContain('lookup_section');
    expect(rules.content).toContain('Diagnostic Codes');
  });

  it('generates claude system prompt format', () => {
    const rules = generateVibeRules({ format: 'claude' });
    expect(rules.content).toContain('You are a specialized legal assistant');
    expect(rules.content).toContain('cfr-free');
  });

  it('writes rules to disk when write option is true', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cfr-vibe-write-'));
    try {
      const res = generateVibeRules({ write: true, cwd: tempDir, format: 'cursor' });
      expect(res.writtenPath).toBe(path.join(tempDir, '.cursorrules'));
      if (!res.writtenPath) throw new Error('missing writtenPath');
      const onDisk = readFileSync(res.writtenPath, 'utf8');
      expect(onDisk).toBe(res.content);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('generates prompt presets', () => {
    const adjudicator = generateVibePrompt('adjudicator');
    expect(adjudicator).toContain('VA Disability Claim Adjudication Prompt');
    expect(adjudicator).toContain('Pillar 1: In-Service Event');
    expect(adjudicator).toContain('Pillar 2: Current Diagnosis');
    expect(adjudicator).toContain('Pillar 3: Medical Nexus');

    const researcher = generateVibePrompt('researcher');
    expect(researcher).toContain('Title 38 CFR Legal Research Prompt');
    expect(researcher).toContain('search_sections');

    const ratings = generateVibePrompt('ratings');
    expect(ratings).toContain('VA Rating Schedule Assessment Prompt');
    expect(ratings).toContain('4.130: Mental Disorders');
  });
});
