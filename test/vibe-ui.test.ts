import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runVibeUiCommand, VIBE_UI_COMPONENTS } from '../src/commands/vibe-ui.js';

describe('vibe-ui: copy-paste UI components', () => {
  it('lists available components when called without component or with list=true', () => {
    const list1 = runVibeUiCommand({});
    expect(list1.output).toContain('Available Vibe UI Components');
    for (const c of VIBE_UI_COMPONENTS) {
      expect(list1.output).toContain(c.id);
    }

    const list2 = runVibeUiCommand({ list: true });
    expect(list2.output).toBe(list1.output);
  });

  it('outputs react snippet for rating-card by default', () => {
    const res = runVibeUiCommand({ component: 'rating-card' });
    expect(res.output).toContain('export function DisabilityRatingCard');
    expect(res.output).toContain('DC {diagnosticCode}');
    expect(res.output).toContain('{ratingPercent}%');
  });

  it('outputs html/tailwind snippet when framework is html', () => {
    const res = runVibeUiCommand({ component: 'rating-card', framework: 'html' });
    expect(res.output).toContain('<!-- Disability Rating Card (Tailwind CSS) -->');
    expect(res.output).toContain('DC 6260');
    expect(res.output).not.toContain('export function');
  });

  it('writes component snippet to file on disk when write is specified', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cfr-vibe-ui-'));
    try {
      const targetFile = path.join(tempDir, 'RatingCard.tsx');
      const res = runVibeUiCommand({
        component: 'rating-card',
        framework: 'react',
        write: targetFile,
      });
      expect(res.writtenPath).toBe(targetFile);
      expect(existsSync(targetFile)).toBe(true);
      const content = readFileSync(targetFile, 'utf8');
      expect(content).toContain('export function DisabilityRatingCard');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('throws helpful error on unknown component', () => {
    expect(() => runVibeUiCommand({ component: 'non-existent' })).toThrow(
      /Unknown component 'non-existent'/,
    );
  });
});
