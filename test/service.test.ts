import { describe, expect, it } from 'vitest';
import { CFRService, ServiceError } from '../src/core/service.js';
import { StructureError } from '../src/core/structure.js';
import type { EcfrApi } from '../src/core/ecfr.js';
import {
  createTestLogger,
  FIXTURE_SECTIONS,
  FIXTURE_STRUCTURE,
  makeSection,
  openTempStore,
} from './helpers.js';

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
    // 'policy' is not one of the two section kinds; '4' is not a Roman numeral.
    [{ query: 'mental disorder', kind: 'policy' as never }],
    [{ query: 'mental disorder', chapter: '4' }],
    [{ query: 'x'.repeat(201) }],
  ])('rejects invalid input %#', (input) => {
    withService((service) => {
      expect(() => service.search(input)).toThrow(/invalid input/);
    });
  });

  it('constrains ranked results by kind and chapter', () => {
    withService((service) => {
      const appendixOnly = service.search({ query: 'rating schedule', kind: 'appendix' });
      expect(appendixOnly.hits.map((hit) => hit.citation)).toEqual(['Appendix A to Part 4']);
      const sectionOnly = service.search({ query: 'rating schedule', kind: 'section' });
      expect(sectionOnly.hits.map((hit) => hit.citation)).toEqual(['4.130']);
      // No fixture row lives in chapter II — the filter empties the result set.
      expect(service.search({ query: 'rating schedule', chapter: 'II' }).total).toBe(0);
      // All fixture rows live in chapter I.
      expect(service.search({ query: 'rating schedule', chapter: 'I' }).total).toBe(2);
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
      expect(() => service.browse()).toThrow(/unreadable/);
    } finally {
      temp.cleanup();
    }
  });

  it('keeps an exact "Part N" label with no title after the prefix', () => {
    const temp = openTempStore();
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
              children: [{ type: 'part', identifier: '4', label: 'Part 4', children: [] }],
            },
          ],
        }),
      });
      const parts = new CFRService(temp.store, 7).listParts();
      expect(parts.find((row) => row.part === '4')?.title).toBe('Part 4');
    } finally {
      temp.cleanup();
    }
  });

  it('rejects browse input that fails schema validation', () => {
    const temp = openTempStore();
    try {
      const service = new CFRService(temp.store, 7);
      expect(() => service.browse({ chapter: 42 as never })).toThrow(/invalid input/);
    } finally {
      temp.cleanup();
    }
  });
});

describe('CFRService citation-direct search', () => {
  it('pins the exact section when the query is a citation', () => {
    withService((service) => {
      const result = service.search({ query: '38 CFR 4.130' });
      const first = result.hits[0];
      expect(first?.citation).toBe('4.130');
      expect(first?.direct).toBe(true);
      expect(first?.citationDisplay).toBe('38 C.F.R. § 4.130');
      expect(first?.sourceUrl).toBe('https://www.ecfr.gov/current/title-38/section-4.130');
      expect(first?.matches).toEqual(expect.arrayContaining(['4', '130']));
      expect(result.hits.filter((hit) => hit.citation === '4.130')).toHaveLength(1);
      expect(result.total).toBeGreaterThanOrEqual(1);
    });
  });

  it('resolves § prefixes and paragraph designators', () => {
    withService((service) => {
      expect(service.search({ query: '§ 4.125(a)' }).hits[0]?.citation).toBe('4.125');
      expect(service.search({ query: '4.125(a)(1)' }).hits[0]?.citation).toBe('4.125');
    });
  });

  it('suppresses the pin when the part filter excludes it', () => {
    withService((service) => {
      const result = service.search({ query: '38 CFR 17.15', part: '4' });
      expect(result.hits.some((hit) => hit.direct)).toBe(false);
    });
  });

  it('suppresses the pin when the kind filter excludes it', () => {
    withService((service) => {
      // 4.130 is a section; kind=appendix must keep the pin suppressed.
      const result = service.search({ query: '38 CFR 4.130', kind: 'appendix' });
      expect(result.hits.some((hit) => hit.direct)).toBe(false);
    });
  });

  it('suppresses the pin when the chapter filter excludes it', () => {
    withService((service) => {
      // 4.130 lives in chapter I; chapter=II has no rows at all.
      const result = service.search({ query: '38 CFR 4.130', chapter: 'II' });
      expect(result.hits.some((hit) => hit.direct)).toBe(false);
      expect(result.total).toBe(0);
    });
  });

  it('keeps the pin when kind and chapter match it', () => {
    withService((service) => {
      const result = service.search({ query: '38 CFR 4.130', kind: 'section', chapter: 'I' });
      expect(result.hits[0]?.citation).toBe('4.130');
      expect(result.hits[0]?.direct).toBe(true);
    });
  });

  it('leaves non-citation queries unpinned', () => {
    withService((service) => {
      const result = service.search({ query: 'mental disorder' });
      expect(result.hits.every((hit) => hit.direct)).toBe(false);
      expect(result.hits[0]?.citationDisplay).toMatch(/^38 C\.F\.R\. § /);
    });
  });

  it('keeps the pin-adjusted total consistent on later pages', () => {
    // 4.132 matches the AND-mode citation query; the pinned 4.130 does not
    // (its citation and text never say "38" or "cfr"), so the pin is added
    // to the result union — and every page must report that same total.
    const temp = openTempStore({
      sections: [
        makeSection({
          citation: '4.130',
          text:
            'Residual functional capacity evaluation for mental disorder claims under the rating ' +
            'schedule applies in part 4 and after the 130 day waiting period for claims.',
        }),
        makeSection({
          citation: '4.132',
          text: 'Refer to 38 CFR 4.130 and the 38 CFR rule for details.',
        }),
      ],
    });
    try {
      const service = new CFRService(temp.store, 7);
      const first = service.search({ query: '38 CFR 4.130', page: 1, perPage: 5 });
      const second = service.search({ query: '38 CFR 4.130', page: 2, perPage: 5 });
      expect(first.hits[0]?.citation).toBe('4.130');
      expect(first.hits[0]?.direct).toBe(true);
      expect(first.total).toBe(2);
      expect(second.total).toBe(2);
      expect(second.hits).toHaveLength(0);
    } finally {
      temp.cleanup();
    }
  });

  it('does not repeat the pin on later pages', () => {
    const temp = openTempStore({
      sections: [
        makeSection({
          citation: '4.130',
          text:
            'Residual functional capacity evaluation for mental disorder claims under the rating ' +
            'schedule applies in part 4 and after the 130 day waiting period for claims.',
        }),
        makeSection({ citation: '4.131', text: '4 130 4 130 4 130' }),
      ],
    });
    try {
      const service = new CFRService(temp.store, 7);
      const page1 = service.search({ query: '4.130', page: 1, perPage: 1 });
      const page2 = service.search({ query: '4.130', page: 2, perPage: 1 });
      expect(page1.hits[0]?.citation).toBe('4.130');
      expect(page1.hits[0]?.direct).toBe(true);
      // 4.131 ranks first (denser, shorter), so the pinned section's natural
      // copy falls on page 2 — where it must not reappear after the pin.
      expect(page2.hits.some((hit) => hit.citation === '4.130')).toBe(false);
      expect(page1.total).toBe(2);
      expect(page2.total).toBe(2);
    } finally {
      temp.cleanup();
    }
  });
});

describe('CFRService freshness envelope', () => {
  it('reports issue date and no notice on a fresh index', () => {
    withService((service) => {
      const search = service.search({ query: 'mental disorder' });
      expect(search.indexIssueDate).toBe('2026-10-09');
      expect(search.indexStale).toBe(false);
      expect(search.notice).toBeNull();
      const section = service.getSection('4.125');
      expect(section.indexStale).toBe(false);
      expect(section.notice).toBeNull();
    });
  });

  it('emits a stale notice when the index ages out', () => {
    const temp = openTempStore();
    try {
      temp.store.setMeta(
        'synced_at',
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      );
      const service = new CFRService(temp.store, 7);
      const search = service.search({ query: 'mental disorder' });
      expect(search.indexStale).toBe(true);
      expect(search.notice).toMatch(/stale/);
      expect(service.getSection('4.125').notice).toMatch(/verify against the current eCFR/);
    } finally {
      temp.cleanup();
    }
  });
});

describe('CFRService phrase and acronym search', () => {
  it('finds spelled-out text from a claims acronym query', () => {
    const temp = openTempStore({
      sections: [
        makeSection({
          citation: '4.131',
          heading: 'Posttraumatic stress disorder.',
          text: 'Posttraumatic stress disorder evaluation criteria apply under this section.',
        }),
      ],
    });
    try {
      const service = new CFRService(temp.store, 7);
      expect(service.search({ query: 'ptsd' }).hits[0]?.citation).toBe('4.131');
      expect(service.search({ query: 'ptsd criteria' }).hits[0]?.citation).toBe('4.131');
    } finally {
      temp.cleanup();
    }
  });

  it('matches a quoted phrase as an exact token sequence', () => {
    const temp = openTempStore({
      sections: [
        makeSection({
          citation: '4.16',
          heading: 'Total disability ratings.',
          text: 'Individual unemployability findings are made under this section.',
        }),
        makeSection({
          citation: '4.17',
          heading: 'Unemployability procedures.',
          text: 'The individual may seek unemployability findings later.',
        }),
      ],
    });
    try {
      const service = new CFRService(temp.store, 7);
      const result = service.search({ query: '"individual unemployability"' });
      const citations = result.hits.map((hit) => hit.citation);
      expect(citations).toContain('4.16');
      expect(citations).not.toContain('4.17'); // words present, sequence not
    } finally {
      temp.cleanup();
    }
  });
});

describe('CFRService.getSection references', () => {
  it('extracts cross-references with availability flags', () => {
    const temp = openTempStore({
      sections: [
        makeSection({
          citation: '3.303',
          text: 'Basic service requirements apply. See § 3.304 and § 4.130 for specifics under 38 CFR 999.999.',
        }),
        makeSection({ citation: '3.304', text: 'Presumptive service-connection rules.' }),
      ],
    });
    try {
      const section = new CFRService(temp.store, 7).getSection('3.303');
      expect(section.references).toEqual([
        { citation: '3.304', available: true },
        { citation: '4.130', available: false },
        { citation: '999.999', available: false },
      ]);
    } finally {
      temp.cleanup();
    }
  });

  it('returns an empty list when the text cites nothing', () => {
    withService((service) => {
      expect(service.getSection('4.125').references).toEqual([]);
    });
  });
});

describe('CFRService.getSection citedBy', () => {
  it('lists inbound citations sorted by citing citation', () => {
    const temp = openTempStore({
      sections: [
        makeSection({ citation: '4.130', text: 'Evaluation rules for mental disorder claims.' }),
        makeSection({ citation: '4.131', text: 'See § 4.130 for the evaluation procedure.' }),
        makeSection({ citation: '4.128', text: 'See § 4.130 as well.' }),
      ],
    });
    try {
      const section = new CFRService(temp.store, 7).getSection('4.130');
      expect(section.citedBy).toEqual(['4.128', '4.131']);
    } finally {
      temp.cleanup();
    }
  });

  it('returns an empty list when nothing cites the section', () => {
    withService((service) => {
      // Fixture sections cite nothing, so 4.125 has no inbound edges.
      expect(service.getSection('4.125').citedBy).toEqual([]);
    });
  });

  it('maps unknown citations to not_found before any backlink lookup', () => {
    withService((service) => {
      expect(() => service.getSection('99.999')).toThrow(ServiceError);
      try {
        service.getSection('99.999');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        if (error instanceof ServiceError) expect(error.code).toBe('not_found');
      }
    });
  });
});

describe('CFRService.health', () => {
  it('reports ready on a fresh seeded index', () => {
    withService((service) => {
      const health = service.health();
      expect(health.status).toBe('ready');
      expect(health.issueDate).toBe('2026-10-09');
      expect(health.stale).toBe(false);
      expect(health.syncedAt).toBeTruthy();
    });
  });

  it('reports empty on an unseeded index', () => {
    const temp = openTempStore({ seed: false });
    try {
      const health = new CFRService(temp.store, 7).health();
      expect(health.status).toBe('empty');
      expect(health.issueDate).toBeNull();
    } finally {
      temp.cleanup();
    }
  });

  it('reports stale when the index ages out', () => {
    const temp = openTempStore();
    try {
      temp.store.setMeta(
        'synced_at',
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      );
      const health = new CFRService(temp.store, 7).health();
      expect(health.status).toBe('stale');
      expect(health.stale).toBe(true);
    } finally {
      temp.cleanup();
    }
  });

  it('reports degraded when live rows disagree with the structure tree', () => {
    const temp = openTempStore();
    try {
      temp.store.setMeta('structure_expected_sections', '9999');
      temp.store.setMeta('structure_expected_appendices', '0');
      const service = new CFRService(temp.store, 7);
      expect(service.status().structureDrift).toBe(true);
      expect(service.health().status).toBe('degraded');
    } finally {
      temp.cleanup();
    }
  });

  it('prefers degraded over stale when the index is drifted and old', () => {
    const temp = openTempStore();
    try {
      temp.store.setMeta('structure_expected_sections', '9999');
      temp.store.setMeta('structure_expected_appendices', '0');
      temp.store.setMeta(
        'synced_at',
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      );
      const health = new CFRService(temp.store, 7).health();
      expect(health.status).toBe('degraded');
      expect(health.stale).toBe(true);
    } finally {
      temp.cleanup();
    }
  });
});

describe('CFRService direct-hit excerpts', () => {
  it('cuts long section text on a sentence boundary', () => {
    const temp = openTempStore({
      sections: [
        makeSection({
          citation: '4.99',
          heading: 'Total disability framework.',
          text:
            'Total disability will be found when the evidence shows the veteran is unable to ' +
            'follow a substantially gainful occupation. ' +
            'Secondary considerations include age, education, and work experience. ' +
            'Additional factors may apply.',
        }),
      ],
    });
    try {
      const hit = new CFRService(temp.store, 7).search({ query: '38 CFR 4.99' }).hits[0];
      expect(hit?.citation).toBe('4.99');
      expect(hit?.snippet.startsWith('Total disability will be found')).toBe(true);
      expect(hit?.snippet.endsWith('.')).toBe(true);
      // Cuts at the last sentence boundary within the ~200-char window.
      expect(hit?.snippet.length ?? 0).toBeLessThan(200);
    } finally {
      temp.cleanup();
    }
  });

  it('falls back to a word boundary when text has no sentence breaks', () => {
    const temp = openTempStore({
      sections: [
        makeSection({
          citation: '4.98',
          heading: 'Run-on text.',
          text: `lorem ipsum dolor sit amet consectetur ${'adipiscing '.repeat(30)}`,
        }),
      ],
    });
    try {
      const hit = new CFRService(temp.store, 7).search({ query: '38 CFR 4.98' }).hits[0];
      expect(hit?.snippet.endsWith('…')).toBe(true);
    } finally {
      temp.cleanup();
    }
  });

  it('advertises only query terms visible in the shown snippet', () => {
    // 354-char run-on: `38` at char 30 (inside the ~200-char window),
    // `cfr` at char 305 (past the ellipsis cut).
    const temp = openTempStore({
      sections: [
        makeSection({
          citation: '4.97',
          heading: 'Excerpt match visibility.',
          text:
            'Entitlement to benefits under 38 depends on the evidence of record and the rating ' +
            'schedule criteria applied consistently to every claimant under the agency standards ' +
            'of review and weighing of testimony plus the procedural requirements outlined in ' +
            'this part for filing and development of claims before the cfr token that sits only ' +
            'past the excerpt window.',
        }),
      ],
    });
    try {
      const hit = new CFRService(temp.store, 7).search({ query: '38 CFR 4.97' }).hits[0];
      expect(hit?.direct).toBe(true);
      expect(hit?.snippet.endsWith('…')).toBe(true);
      // `cfr` is invisible in the snippet, so it must not be advertised…
      expect(hit?.snippet).not.toContain('cfr');
      expect(hit?.matches).not.toContain('cfr');
      // …while `38` sits inside the window and must still be (no over-correction).
      expect(hit?.matches).toContain('38');
    } finally {
      temp.cleanup();
    }
  });
});

describe('CFRService vanished-citation guidance', () => {
  it('points to eCFR and surfaces mentioning sections', () => {
    const temp = openTempStore({
      sections: [
        makeSection({
          citation: '4.151a',
          heading: 'Disability of participants in medal ceremonies.',
          text: 'Ratings for conditions under § 4.151 are evaluated under this paragraph.',
        }),
      ],
    });
    try {
      const service = new CFRService(temp.store, 7);
      expect(() => service.getSection('4.151')).toThrow(/reserved, removed, or outside Title 38/);
      try {
        service.getSection('4.151');
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        expect(message).toContain('ecfr.gov/current/title-38/section-4.151');
        expect(message).toContain('4.151a');
      }
    } finally {
      temp.cleanup();
    }
  });

  it('omits the mentions clause when nothing references the citation', () => {
    withService((service) => {
      try {
        service.getSection('999.999');
        expect.unreachable('expected not_found');
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        expect(message).toContain('no indexed content for citation 999.999');
        expect(message).not.toContain('mention it');
      }
    });
  });
});

describe('CFRService historical-version guidance', () => {
  it('links the eCFR point-in-time URL in the stale notice', () => {
    const temp = openTempStore();
    try {
      temp.store.setMeta(
        'synced_at',
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      );
      const search = new CFRService(temp.store, 7).search({ query: 'mental disorder' });
      expect(search.notice).toContain('point-in-time');
      expect(search.notice).toContain('/on/<YYYY-MM-DD>/title-38/section-<citation>');
    } finally {
      temp.cleanup();
    }
  });
});

describe('CFRService.diffBetween (diff facade)', () => {
  const FROM_DATE = '2026-01-01';
  const TO_DATE = '2026-06-01';

  // Minimal full-title XML, same shape the core diff parses (see
  // test/diff.test.ts): one amended section between the two dates.
  const FROM_XML = `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD><DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Test.</HEAD><P>Original body.</P></DIV8></DIV5></DIV3></DIV1>`;
  const TO_XML = FROM_XML.replace('Original body.', 'Amended body.');

  /** Offline eCFR stub: serves the fixture XML for any requested date. */
  function stubEcfr(requested: string[]): EcfrApi {
    return {
      getFullTitleXml: async (issueDate: string) => {
        requested.push(issueDate);
        return issueDate === FROM_DATE ? FROM_XML : TO_XML;
      },
    } as unknown as EcfrApi;
  }

  it('delegates to the core diff through the injected client and logger', async () => {
    const temp = openTempStore();
    try {
      const requested: string[] = [];
      const service = new CFRService(temp.store, 7, stubEcfr(requested), createTestLogger());
      const report = await service.diffBetween(FROM_DATE, TO_DATE);
      expect(report.fromIssueDate).toBe(FROM_DATE);
      expect(report.toIssueDate).toBe(TO_DATE);
      expect(report.changed).toEqual(['4.125']);
      expect(report.added).toEqual([]);
      expect(report.removed).toEqual([]);
      expect(requested).toEqual([FROM_DATE, TO_DATE]);
    } finally {
      temp.cleanup();
    }
  });

  it('fails closed with a mapped invalid_input when no eCFR client was injected', async () => {
    const temp = openTempStore();
    try {
      // Plain 2-arg construction (tests, index readers): the facade must not
      // reach into an undefined client — it throws a clean ServiceError the
      // HTTP layer maps through statusFor instead of crashing the handler.
      const service = new CFRService(temp.store, 7);
      const error = await service.diffBetween(FROM_DATE, TO_DATE).then(
        () => {
          throw new Error('expected the promise to reject');
        },
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).code).toBe('invalid_input');
      expect((error as ServiceError).message).toBe('diff unavailable — no eCFR client injected');
    } finally {
      temp.cleanup();
    }
  });

  it('keeps core validation semantics on the facade (identical dates, no fetch)', async () => {
    const temp = openTempStore();
    try {
      const requested: string[] = [];
      const service = new CFRService(temp.store, 7, stubEcfr(requested), createTestLogger());
      await expect(service.diffBetween(FROM_DATE, FROM_DATE)).rejects.toMatchObject({
        name: 'ServiceError',
        code: 'invalid_input',
      });
      expect(requested).toEqual([]);
    } finally {
      temp.cleanup();
    }
  });
});

describe('CFRService last sync changes', () => {
  it('surfaces the recorded change report and survives corrupted meta', () => {
    const temp = openTempStore();
    try {
      const service = new CFRService(temp.store, 7);
      // Seeded fixture stores never synced — no record yet.
      expect(service.status().lastChanges).toBeNull();

      temp.store.setMeta(
        'last_changes',
        JSON.stringify({
          fromIssueDate: '2026-10-01',
          toIssueDate: '2026-10-09',
          changed: 2,
          added: 1,
          removed: 0,
          changedCitations: ['4.125', '4.130'],
          addedCitations: ['4.126'],
          removedCitations: [],
          baseline: false,
          parserChanged: false,
          recordedAt: '2026-10-09T00:00:00.000Z',
        }),
      );
      const status = service.status();
      expect(status.lastChanges?.changed).toBe(2);
      expect(status.lastChanges?.changedCitations).toEqual(['4.125', '4.130']);

      temp.store.setMeta('last_changes', '{not json');
      expect(service.status().lastChanges).toBeNull();
    } finally {
      temp.cleanup();
    }
  });
});
