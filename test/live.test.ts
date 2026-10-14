import { describe, expect, it } from 'vitest';
import { HttpClient } from '../src/core/http-client.js';
import { EcfrApi } from '../src/core/ecfr.js';
import { syncIndex } from '../src/core/sync.js';
import { CFRService } from '../src/core/service.js';
import { VERSION } from '../src/version.js';
import { createTestLogger, openTempStore, type TempStore } from './helpers.js';

/**
 * Live end-to-end smoke against the real eCFR API. Runs only when
 * `LIVE_TESTS=1` (never in PR CI — SPEC §12 #12); the scheduled Live E2E
 * workflow and `workflow_dispatch` set it. This is the tripwire for eCFR
 * format or content drift: full sync, then consistent reads.
 */
const live = process.env.LIVE_TESTS === '1';

describe.skipIf(!live)('live e2e (real eCFR)', () => {
  it('syncs real Title 38 and serves consistent reads', async () => {
    const temp: TempStore = openTempStore({ seed: false });
    try {
      const logger = createTestLogger();
      const ecfr = new EcfrApi(new HttpClient({ userAgent: `cfr-free/${VERSION}-live-e2e` }));
      const report = await syncIndex({ ecfr, store: temp.store, logger });

      // Tripwire floor: live Title 38 carries ~2 950 sections; 2 000 catches
      // catastrophic format drift (parse collapse) while leaving headroom for
      // benign content reorganizations.
      expect(report.sections).toBeGreaterThan(2000);
      expect(Date.parse(report.issueDate)).not.toBeNaN();

      const service = new CFRService(temp.store, 7);
      const status = service.status();
      // Real parsed counts must match the structure tree — format drift fails here.
      expect(status.structureDrift).toBe(false);
      expect(status.stale).toBe(false);
      expect(status.sections).toBeGreaterThan(2000);

      const search = service.search({ query: 'mental disorder', page: 1, perPage: 5 });
      expect(search.total).toBeGreaterThan(0);
      expect(search.hits[0]?.matches.length).toBeGreaterThan(0);
      expect(search.hits[0]?.score).toBeLessThan(0);

      const section = service.getSection('4.125');
      expect(section.markdown.length).toBeGreaterThan(100);
      expect(section.sourceUrl).toContain('ecfr.gov');

      const parts = service.listParts();
      expect(parts.length).toBeGreaterThan(5);
      expect(parts.find((row) => row.part === '4')?.sections).toBeGreaterThan(0);
    } finally {
      temp.cleanup();
    }
  }, 240_000);
});
