import { describe, expect, it } from 'vitest';
import { CFRService, ServiceError } from '../src/core/service.js';
import { StructureError } from '../src/core/structure.js';
import { FIXTURE_SECTIONS, FIXTURE_STRUCTURE, openTempStore } from './helpers.js';

function withService(fn: (service: CFRService) => void): void {
  const temp = openTempStore();
  try {
    const service = new CFRService(temp.store, 7);
    fn(service);
  } finally {
    temp.cleanup();
  }
}

describe('CFRService.search', () => {
  it('applies defaults and returns ranked hits', () => {
    withService((service) => {
      const result = service.search({ query: 'mental disorder' });
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(10);
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.hits[0]?.citation).toBeTruthy();
      expect(result.matchMode).toBe('and');
    });
  });

  it('rejects short queries', () => {
    withService((service) => {
      expect(() => service.search({ query: 'ab' })).toThrow(ServiceError);
      try {
        service.search({ query: 'ab' });
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        if (error instanceof ServiceError) expect(error.code).toBe('invalid_input');
      }
    });
  });

  it.each([
    [{ query: 'mental disorder', page: 0 }],
    [{ query: 'mental disorder', page: 1.5 }],
    [{ query: 'mental disorder', perPage: 21 }],
    [{ query: 'mental disorder', part: 'abc' }],
    [{ query: 'x'.repeat(201) }],
  ])('rejects invalid input %#', (input) => {
    withService((service) => {
      expect(() => service.search(input)).toThrow(/invalid input/);
    });
  });
});

describe('CFRService.getSection', () => {
  it('resolves flexible citations to full content', () => {
    withService((service) => {
      const section = service.getSection('38 CFR 4.125');
      expect(section.citation).toBe('4.125');
      expect(section.kind).toBe('section');
      expect(section.markdown).toContain('Diagnosis of mental disorders.');
      expect(section.issueDate).toBe('2026-10-09');
      expect(section.sourceUrl).toBe('https://www.ecfr.gov/current/title-38/section-4.125');
      expect(section.path).toContain('part:4');
    });
  });

  it('resolves appendices with a search permalink', () => {
    withService((service) => {
      const appendix = service.getSection('Appendix A to Part 4');
      expect(appendix.kind).toBe('appendix');
      expect(appendix.sourceUrl).toContain('ecfr.gov/search');
      expect(appendix.sourceUrl).toContain('titles=38');
    });
  });

  it('maps unknown citations to not_found', () => {
    withService((service) => {
      try {
        service.getSection('99.999');
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        if (error instanceof ServiceError) expect(error.code).toBe('not_found');
      }
    });
  });

  it.each(['', 'not a citation at all', '§§§'])(
    'maps garbage input to invalid_input: %j',
    (input) => {
      withService((service) => {
        try {
          service.getSection(input);
          expect.unreachable('should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(ServiceError);
          if (error instanceof ServiceError) expect(error.code).toBe('invalid_input');
        }
      });
    },
  );
});

describe('CFRService.browse', () => {
  it('lists chapters by default', () => {
    withService((service) => {
      const result = service.browse();
      expect(result.node.type).toBe('title');
      expect(result.children.map((child) => child.identifier)).toEqual(['I', 'II']);
    });
  });

  it('navigates into parts', () => {
    withService((service) => {
      const result = service.browse({ chapter: 'I', part: '4' });
      expect(result.node.type).toBe('part');
      expect(result.children.some((child) => child.type === 'appendix')).toBe(true);
    });
  });

  it('propagates structure misses for the HTTP layer to map', () => {
    withService((service) => {
      expect(() => service.browse({ chapter: 'I', part: '999' })).toThrow(StructureError);
    });
  });

  it('rejects subpart without part', () => {
    withService((service) => {
      try {
        service.browse({ subpart: 'A' });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        if (error instanceof ServiceError) expect(error.code).toBe('invalid_input');
      }
    });
  });

  it('reports missing structure data', () => {
    const temp = openTempStore({ seed: false });
    try {
      const service = new CFRService(temp.store, 7);
      expect(() => service.browse()).toThrow(/no structure data/);
    } finally {
      temp.cleanup();
    }
  });
});

describe('CFRService.status', () => {
  it('reports a fresh index', () => {
    const temp = openTempStore({ seed: false });
    try {
      const service = new CFRService(temp.store, 7);
      const fresh = service.status();
      expect(fresh.stale).toBe(true); // never synced
      expect(fresh.sections).toBe(0);

      temp.store.replaceAll([], '2026-10-09', {
        synced_at: new Date().toISOString(),
        appendices_count: '0',
      });
      const now = service.status();
      expect(now.stale).toBe(false);
      expect(now.maxAgeDays).toBe(7);
    } finally {
      temp.cleanup();
    }
  });

  it('marks old syncs as stale', () => {
    const temp = openTempStore({ seed: false });
    try {
      const service = new CFRService(temp.store, 7);
      temp.store.replaceAll([], '2026-01-01', {
        synced_at: '2020-01-01T00:00:00.000Z',
        appendices_count: '2',
      });
      const status = service.status();
      expect(status.stale).toBe(true);
      expect(status.appendices).toBe(2);
      expect(status.syncedAt).toBe('2020-01-01T00:00:00.000Z');
    } finally {
      temp.cleanup();
    }
  });

  it('treats unparseable timestamps as stale', () => {
    const temp = openTempStore({ seed: false });
    try {
      const service = new CFRService(temp.store, 7);
      temp.store.replaceAll([], '2026-10-09', { synced_at: 'yesterday-ish' });
      expect(service.status().stale).toBe(true);
    } finally {
      temp.cleanup();
    }
  });

  it('reports structure drift against recorded expectations', () => {
    const temp = openTempStore();
    try {
      const service = new CFRService(temp.store, 7);
      // Fixtures predate the expectation meta: drift unknown, not false.
      expect(service.status().structureDrift).toBeNull();

      // The fixture index holds 3 sections + 1 appendix.
      const meta = {
        synced_at: new Date().toISOString(),
        appendices_count: '1',
        structure_json: JSON.stringify(FIXTURE_STRUCTURE),
        structure_expected_sections: '3',
        structure_expected_appendices: '1',
      };
      temp.store.replaceAll(FIXTURE_SECTIONS, '2026-10-09', meta);
      expect(service.status().structureDrift).toBe(false);

      temp.store.replaceAll(FIXTURE_SECTIONS, '2026-10-09', {
        ...meta,
        structure_expected_sections: '4',
      });
      expect(service.status().structureDrift).toBe(true);

      temp.store.replaceAll(FIXTURE_SECTIONS, '2026-10-09', {
        ...meta,
        structure_expected_sections: 'nope',
      });
      expect(service.status().structureDrift).toBe(true);
    } finally {
      temp.cleanup();
    }
  });
});

describe('CFRService.listParts', () => {
  it('lists parts with structure titles and per-kind counts', () => {
    const temp = openTempStore();
    try {
      const service = new CFRService(temp.store, 7);
      expect(service.listParts()).toEqual([
        { part: '4', title: 'Schedule for Rating Disabilities', sections: 2, appendices: 1 },
        { part: '17', title: 'Medical Care', sections: 1, appendices: 0 },
      ]);
    } finally {
      temp.cleanup();
    }
  });

  it('falls back to null titles when structure is missing', () => {
    const temp = openTempStore({ seed: false });
    try {
      temp.store.replaceAll(
        [
          {
            kind: 'section' as const,
            heading: 'H.',
            chapter: 'I',
            subchapter: null,
            part: '4',
            subpart: null,
            subjectGroup: null,
            path: '/title:38/chapter:I/part:4',
            text: 'T.',
            markdown: 'T.',
            citation: '4.1',
          },
        ],
        '2026-10-09',
        {},
      );
      const service = new CFRService(temp.store, 7);
      expect(service.listParts()).toEqual([{ part: '4', title: null, sections: 1, appendices: 0 }]);
    } finally {
      temp.cleanup();
    }
  });

  it('keeps the raw label when it has no Part <id> prefix', () => {
    const temp = openTempStore({ seed: false });
    try {
      temp.store.replaceAll(FIXTURE_SECTIONS, '2026-10-09', {
        structure_json: JSON.stringify({
          type: 'title',
          identifier: '38',
          label: 'Title 38',
          children: [
            {
              type: 'chapter',
              identifier: 'I',
              label: 'Chapter I',
              children: [
                { type: 'part', identifier: '4', label: 'Custom label', children: [] },
                { type: 'part', identifier: '17', label: 'Part 17—Medical Care', children: [] },
              ],
            },
          ],
        }),
      });
      const parts = new CFRService(temp.store, 7).listParts();
      expect(parts.find((row) => row.part === '4')?.title).toBe('Custom label');
      expect(parts.find((row) => row.part === '17')?.title).toBe('Medical Care');
    } finally {
      temp.cleanup();
    }
  });

  it('degrades to null titles when stored structure is unreadable', () => {
    const temp = openTempStore();
    try {
      temp.store.replaceAll(FIXTURE_SECTIONS, '2026-10-09', { structure_json: '{not json' });
      const service = new CFRService(temp.store, 7);
      const parts = service.listParts();
      expect(parts.length).toBeGreaterThan(0);
      expect(parts.every((row) => row.title === null)).toBe(true);
    } finally {
      temp.cleanup();
    }
  });
});
