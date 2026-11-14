import { describe, expect, it } from 'vitest';
import { DEMO_ISSUE_DATE, DEMO_SECTIONS, openDemoStore } from '../src/core/demo-data.js';

describe('demo data', () => {
  it('opens an in-memory store populated with core Title 38 provisions', () => {
    const store = openDemoStore();
    try {
      expect(store.countSections()).toBe(DEMO_SECTIONS.length);
      expect(store.getMeta('issue_date')).toBe(DEMO_ISSUE_DATE);

      // Verify key provisions can be retrieved by citation
      const ptsd = store.getSection('4.130', 'section');
      expect(ptsd).not.toBeNull();
      expect(ptsd?.heading).toContain('mental disorders');
      expect(ptsd?.text).toContain('Diagnostic Code 9411');

      const tinnitus = store.getSection('4.87', 'section');
      expect(tinnitus).not.toBeNull();
      expect(tinnitus?.heading).toContain('ear');
      expect(tinnitus?.text).toContain('Diagnostic Code 6260');

      const serviceConnection = store.getSection('3.303', 'section');
      expect(serviceConnection).not.toBeNull();
      expect(serviceConnection?.heading).toContain('service connection');

      // Verify search operates on the demo index
      const searchResult = store.search({ query: 'PTSD', page: 1, perPage: 10 });
      expect(searchResult.total).toBeGreaterThan(0);
      expect(searchResult.hits[0]?.citation).toBe('4.130');
    } finally {
      store.close();
    }
  });
});
