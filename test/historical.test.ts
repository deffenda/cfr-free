import { describe, expect, it } from 'vitest';
import { historicalSection, ARCHIVE_FLOOR } from '../src/core/historical.js';
import { ServiceError } from '../src/core/service.js';
import { createTestLogger } from './helpers.js';
import type { EcfrApi } from '../src/core/ecfr.js';

const AT_DATE = '2024-03-10';

const HISTORICAL_XML = `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD>
<DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD>
<DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD>
<DIV8 N="4.130" TYPE="SECTION"><HEAD>&#xA7; 4.130 Schizophrenia.</HEAD><P>Body as it stood then.</P></DIV8>
<DIV9 N="Appendix A to Part 4" TYPE="APPENDIX"><HEAD>Appendix A to Part 4—Table</HEAD><P>Appendix body.</P></DIV9>
</DIV5></DIV3></DIV1></ECFR>`;

/** Offline eCFR stub: serves the document for one date, 404s for anything else. */
function stubEcfr(xmlByDate: Readonly<Record<string, string>>, requested: string[] = []): EcfrApi {
  return {
    getFullTitleXml: async (issueDate: string) => {
      requested.push(issueDate);
      const xml = xmlByDate[issueDate];
      if (xml === undefined) {
        const error = new Error(`HTTP 404 for ${issueDate}`) as Error & { status?: number };
        error.status = 404;
        throw error;
      }
      return xml;
    },
  } as unknown as EcfrApi;
}

describe('historicalSection (M2(c) point-in-time read)', () => {
  it('reads the provision as it stood at the requested date', async () => {
    const requested: string[] = [];
    const deps = {
      ecfr: stubEcfr({ [AT_DATE]: HISTORICAL_XML }, requested),
      logger: createTestLogger(),
    };
    const section = await historicalSection(deps, AT_DATE, '4.130');
    expect(section.requestedDate).toBe(AT_DATE);
    expect(section.citation).toBe('4.130');
    expect(section.kind).toBe('section');
    expect(section.heading).toBe('Schizophrenia.');
    expect(section.text).toContain('Body as it stood then.');
    expect(requested).toEqual([AT_DATE]);
  });

  it('names the REQUESTED date and the revision in force, never a served date', async () => {
    const deps = { ecfr: stubEcfr({ [AT_DATE]: HISTORICAL_XML }), logger: createTestLogger() };
    const section = await historicalSection(deps, AT_DATE, '4.130');
    // The response carries the requested date and a dated URL for it — and
    // no field claiming to know the issue date eCFR served.
    expect(section.requestedDate).toBe(AT_DATE);
    expect(section.sourceUrlAtRequestedDate).toBe(
      'https://www.ecfr.gov/on/2024-03-10/title-38/section-4.130',
    );
    expect(Object.keys(section)).not.toContain('servedDate');
    expect(Object.keys(section)).not.toContain('issueDate');
  });

  it('points the dated URL at an appendix with the citation URL-encoded', async () => {
    const deps = { ecfr: stubEcfr({ [AT_DATE]: HISTORICAL_XML }), logger: createTestLogger() };
    const section = await historicalSection(deps, AT_DATE, 'Appendix A to Part 4');
    expect(section.kind).toBe('appendix');
    expect(section.sourceUrlAtRequestedDate).toBe(
      'https://www.ecfr.gov/on/2024-03-10/title-38/appendix-Appendix%20A%20to%20Part%204',
    );
  });

  it('rejects a malformed date and a bad citation before any fetch', async () => {
    const requested: string[] = [];
    const deps = {
      ecfr: stubEcfr({ [AT_DATE]: HISTORICAL_XML }, requested),
      logger: createTestLogger(),
    };
    // The date and the citation are validated BEFORE any fetch, and the
    // failure carries the invalid_input code (the message says what was
    // wrong with the date).
    for (const bad of ['2024-13-01', 'not-a-date']) {
      const error = await historicalSection(deps, bad, '4.130').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).code).toBe('invalid_input');
    }
    await expect(historicalSection(deps, AT_DATE, 'not a citation')).rejects.toThrow(
      /not a citation/i,
    );
    // No fetch was paid for.
    expect(requested).toEqual([]);
  });

  it('maps a date outside eCFR archive to a usage error, not a service failure', async () => {
    // A date before the archive is a bad ARGUMENT: the CLI maps
    // `invalid_input` to exit 2 (usage) and `not_found` to exit 1 (a
    // service failure), and a script that retries on 1 would retry a date
    // eCFR will never serve.
    const deps = { ecfr: stubEcfr({}), logger: createTestLogger() };
    const error = await historicalSection(deps, '2015-01-01', '4.130').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe('invalid_input');
    expect((error as Error).message).toContain(ARCHIVE_FLOOR);
  });

  it('reports a citation that did not exist at that date', async () => {
    const deps = { ecfr: stubEcfr({ [AT_DATE]: HISTORICAL_XML }), logger: createTestLogger() };
    const error = await historicalSection(deps, AT_DATE, '99.999').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe('not_found');
    expect((error as Error).message).toContain('99.999');
    expect((error as Error).message).toContain(AT_DATE);
  });
});
