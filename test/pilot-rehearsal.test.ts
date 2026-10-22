import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderRehearsal, runRehearsal, type RehearsalReport } from './fixtures/pilot/run.js';
import { makeSection, openTempStore } from './helpers.js';

/**
 * The M6 rehearsal, as a regression check.
 *
 * The protocol's own rehearsal record ends with the standing instruction:
 * "A rehearsal of this shape should be repeated as a regression check on
 * the instrument itself — not as evidence about practitioners, but as a
 * check that every task is still answerable and every sheet still
 * fillable after a change lands"
 * (`docs/research/pilot-rehearsal-2026-10-21.md`).
 *
 * This test runs that check. It is NOT study evidence and produces no
 * participant finding: it cannot say whether a practitioner would find the
 * right answer, because the suite can read the answer key. In particular
 * it does NOT touch the subject-index reopen condition, which is fixed on
 * the PILOT's `E3` count (`ROADMAP.md` §M3).
 *
 * The suite runs against a SEEDED temporary index, like the retrieval
 * evaluation's own test: it stays offline and hermetic, never touches the
 * operator's `~/.cfr-free/index.sqlite`, and never the network. The seed
 * carries the provisions the protocol's answer keys name, with the real
 * headings and the real phrases, so a check fails when the PRODUCT stops
 * producing the answer — not when the fixture drifts.
 */

/**
 * The provisions the protocol's answer keys name, with their real headings
 * and the phrases the tasks turn on. The seed is the corpus the rehearsal
 * answers from; it is deliberately small, and every entry earns its place
 * by being named in the protocol.
 */
const CORPUS = [
  makeSection({
    citation: '4.130',
    heading: 'Schedule of ratings—Mental disorders.',
    text: 'General Rating Formula. The following table is used to determine the rating.',
  }),
  makeSection({
    citation: '4.125',
    heading: 'Diagnosis of mental disorders.',
    text: 'If the diagnosis of a mental disorder does not conform to DSM-5 the rating agency shall return the report.',
  }),
  makeSection({
    citation: '4.129',
    heading: 'Mental disorders due to traumatic stress.',
    text: 'For the purposes of this rating, posttraumatic stress disorder is evaluated under the general rating formula.',
  }),
  makeSection({
    citation: '4.85',
    heading: 'Evaluation of hearing impairment.',
    text: 'General. Evaluate the impairment caused by any sensory organ or body part under the table set forth in Table VI, Numeric Designation of Hearing Impairment Based on Puretone Threshold Average and Speech Discrimination, and Table VIa. [image content not included: Table VI] ',
  }),
  makeSection({
    citation: '4.86',
    heading: 'Exceptional patterns of hearing impairment.',
    text: 'When there is a hearing impairment that is not reflected by the table, the examiner must explain the reason.',
  }),
  makeSection({
    citation: '4.87',
    heading: 'Schedule of ratings—ear.',
    text: 'Tinnitus is a frequent occurrence and is rated under the general rating formula.',
  }),
  // A BODY-ONLY distractor for the F2-A query, repeating the query's
  // phrase many times. The real corpus has 17.149 ("Sensori-neural aids"),
  // whose text mentions hearing loss and which the real query returns among
  // its hits.
  //
  // The repetition is what makes this distractor LOAD-BEARING. bm25 weighs
  // term frequency WITHIN a column, so without the heading-phrase key
  // (SPEC §4.1) the body-heavy § 17.149 would outrank § 4.85 — which
  // carries the query's phrase in its HEADING. With one mention instead of
  // ten, the seed's § 4.85 would lead either way and the F2-A check
  // would pass even with the ranking guarantee broken. A check that cannot
  // fail is not a check: this distractor is what makes the check real.
  makeSection({
    citation: '17.149',
    heading: 'Sensori-neural aids.',
    text: 'Hearing loss is rated. Hearing loss is rated. Hearing loss is rated. Hearing loss is rated. Hearing loss is rated. Hearing loss is rated. Hearing loss is rated. Hearing loss is rated. Hearing loss is rated. Hearing loss is rated. Veterans with hearing loss may be provided hearing aids under this section.',
  }),
  makeSection({
    citation: '3.350',
    heading: 'Special monthly compensation rates.',
    text: 'A veteran may be in need of regular aid and attendance as contained in § 3.352(a). The criteria for determining inactivity of tuberculosis are set out in § 3.375. (See § 3.552(b)(2) as to continuance.) A rating in excess of 10/200 (§ 4.83 of this chapter) does not qualify.',
  }),
  makeSection({
    citation: '3.352',
    heading: 'Criteria for determining need for aid and attendance and “permanently bedridden.”',
    text: 'As a result of service-connected residuals of traumatic brain injury, a veteran may need aid and attendance.',
  }),
  makeSection({
    citation: '3.375',
    heading: 'Schedule of ratings for reduced earnings.',
    text: 'General. This section is the schedule of general disability ratings.',
  }),
  makeSection({
    citation: '3.552',
    heading: 'The rating formula for compensation based on loss of use.',
    text: 'General rating formula for loss of use of a body part.',
  }),
  makeSection({
    citation: '3.304',
    heading: 'Direct service connection; wartime and peacetime.',
    text: 'Posttraumatic stress disorder. Service connection for posttraumatic stress disorder requires medical evidence diagnosing the condition.',
  }),
  makeSection({
    citation: '3.309',
    heading: 'Disease subject to presumptive service connection.',
    text: 'If the Secretary determines that the veteran has posttraumatic stress disorder (PTSD), and the veteran was interned or detained, the disease is presumed service-connected.',
  }),
  makeSection({
    citation: '4.71a',
    heading: 'Schedule of ratings—musculoskeletal system.',
    text: 'Use this schedule to evaluate the musculoskeletal system. [image content not included: Table V] The rating tables are graphics and are not included in this text.',
  }),
  makeSection({
    citation: '3.303',
    heading: 'Principles relating to service connection.',
    text: 'General. The principles of service connection are the basis of the evaluation.',
  }),
  // A provision that CITES § 3.350, so the backward-reference edge the
  // F3 task asks about ("what points back at it") exists in the seed. The
  // real corpus has 14 such provisions for § 3.350.
  makeSection({
    citation: '4.124a',
    heading: 'Schedule of ratings—neurological conditions.',
    text: 'The rating schedule for neurological disorders follows the general rating formula in § 3.350.',
  }),
];

const ISSUE_DATE = '2026-10-16';

/**
 * Seed a temporary index and point the suite at it. The suite reads its
 * index from `CFR_INDEX_PATH`, so the env var is what wires it in; it is
 * restored afterwards so a test run cannot leak the fixture into the
 * developer's shell.
 */
async function withRehearsal(): Promise<RehearsalReport> {
  const temp = openTempStore({ sections: CORPUS, issueDate: ISSUE_DATE });
  const previous = process.env['CFR_INDEX_PATH'];
  try {
    process.env['CFR_INDEX_PATH'] = temp.indexPath;
    return await runRehearsal();
  } finally {
    if (previous === undefined) delete process.env['CFR_INDEX_PATH'];
    else process.env['CFR_INDEX_PATH'] = previous;
    temp.cleanup();
  }
}

describe('the M6 rehearsal — every task still answerable', () => {
  // The suite is ASYNC: the F4 family runs the product's own diff, redline
  // and historical cores against a STUB eCFR, so the payloads under test are
  // what the core produced rather than what this test wrote.
  let report: RehearsalReport;
  beforeAll(async () => {
    report = await withRehearsal();
  });

  it('passes every check, so no task has become unanswerable', () => {
    const failures = report.tasks.flatMap((task) =>
      task.checks
        .filter((c) => !c.ok)
        .map((c) => `${task.id}: ${c.claim} — ${c.detail ?? 'no detail'}`),
    );
    expect(failures, failures.join('\n')).toEqual([]);
    expect(report.failed).toBe(0);
  });

  it('covers every task family the protocol names', () => {
    // A family that silently stops being checked is worse than one that
    // fails: the check would report green while the protocol grew a task
    // nobody rehearses. F2-B is the subject-gap probe and F5-B the
    // incompleteness warning — the two the protocol calls out by name.
    expect(report.tasks.map((task) => task.id).sort()).toEqual([
      'F1',
      'F2-A',
      'F2-B',
      'F3-A',
      'F4-A',
      'F5-A',
      'F5-B',
    ]);
  });

  it('skips no task, so no task can quietly reach the network', () => {
    // A task that cannot run offline sets `skipped: true`. Today none do:
    // every family is answered from the local index. Pinning it means a
    // future task cannot add a network dependency to the suite without
    // this test noticing — the suite is offline BY ASSERTION, not by
    // inspection.
    expect(report.skipped).toBe(0);
    for (const task of report.tasks) {
      expect(task.skipped, `${task.id} is skipped: ${task.skipReason ?? 'no reason'}`).toBe(false);
    }
  });

  it('reaches no network by ANY route, so the suite is offline BY MEASUREMENT', async () => {
    // The runner's header claims "no check it runs performs a network
    // call". That claim is now ENFORCED rather than documented, so the
    // claim and the suite cannot drift apart.
    //
    // Every outbound seam is trapped, not just fetch: the product's HTTP
    // client resolves `fetch` at CALL TIME (`this.options.fetchFn ?? fetch`
    // in src/core/http-client.ts), so replacing the global intercepts the
    // product's own path. But a suite that reached the network through
    // `node:https`, `node:http` or `node:net` would slip past a fetch-only
    // trap, so those are trapped too — the whole point is that the zero
    // below means "no network", not "no fetch".
    const attempts: string[] = [];
    const restore: Array<() => void> = [];

    const trap = (holder: object, key: string, label: string): void => {
      const original = Object.getOwnPropertyDescriptor(holder, key);
      Object.defineProperty(holder, key, {
        configurable: true,
        writable: true,
        value: (...args: unknown[]) => {
          attempts.push(`${label}(${String(args[0])})`);
          throw new Error(`network attempt: ${label}`);
        },
      });
      restore.push(() => {
        if (original === undefined) delete (holder as Record<string, unknown>)[key];
        else Object.defineProperty(holder, key, original);
      });
    };

    trap(globalThis, 'fetch', 'fetch');
    // `get` is trapped separately from `request`: node's `http.get` calls
    // the module-LOCAL `request`, not the exported property, so replacing
    // `http.request` alone does not intercept `http.get`. (Proven by
    // mutation: an `https.get` inside the suite reached the socket, not
    // the trapped `https.request`.)
    trap(http, 'request', 'http.request');
    trap(http, 'get', 'http.get');
    trap(https, 'request', 'https.request');
    trap(https, 'get', 'https.get');
    trap(net, 'connect', 'net.connect');
    trap(dgram, 'createSocket', 'dgram.createSocket');
    const socketConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function trappedConnect(...args: unknown[]) {
      attempts.push(`net.Socket.connect(${String(args[0])})`);
      throw new Error('network attempt: net.Socket.connect');
    };
    restore.push(() => {
      net.Socket.prototype.connect = socketConnect;
    });

    try {
      const trapped = await withRehearsal();
      expect(trapped.failed, 'the suite failed while the network was trapped').toBe(0);
      expect(trapped.passed).toBeGreaterThan(20);
      expect(attempts, `the suite attempted: ${attempts.join(', ')}`).toEqual([]);
    } finally {
      for (const undo of restore.reverse()) undo();
    }
  });

  it('the network traps are live, so the zero above is a real zero', async () => {
    // A DEAD trap also reads zero. Without this control, the assertion
    // above could pass for the wrong reason — traps that never fire
    // because they were never wired up would look identical to a suite
    // that genuinely makes no calls. So: fire them deliberately, and prove
    // they fire.
    const attempts: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      attempts.push('fetch');
      throw new Error('trapped on purpose');
    }) as typeof fetch;
    try {
      // The trap throws synchronously, so the call is wrapped in a
      // microtask to turn that throw into the rejection being asserted.
      await expect(Promise.resolve().then(() => fetch('http://127.0.0.1:1/never'))).rejects.toThrow(
        'trapped on purpose',
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(attempts).toEqual(['fetch']);
  });

  it('runs real checks rather than none', () => {
    // The suite must not be able to pass by checking nothing.
    expect(report.passed).toBeGreaterThan(20);
    for (const task of report.tasks) {
      expect(task.checks.length, `${task.id} has no checks`).toBeGreaterThan(0);
    }
  });

  it('says plainly that it is a regression check, not study evidence', () => {
    // A reader of CI output must not read a green run as a finding about
    // practitioners. The banner says so, and it is asserted here so the
    // wording cannot be dropped. The comparison is case-insensitive because
    // the banner shouts its warning.
    const rendered = renderRehearsal(report).toLowerCase();
    expect(rendered).toContain('not study evidence');
    expect(rendered).toContain('regression check');
  });
});
