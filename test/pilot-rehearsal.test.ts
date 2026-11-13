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
 * the PILOT's `E3` count (delivery log §M3).
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

/**
 * One outbound seam the hermeticity trap covers.
 *
 * `install` puts the trap in place and returns the undo; `probe` invokes
 * the seam once, so a control can observe the trap firing. Both the
 * measurement test and the liveness control go through THIS list, so the
 * control cannot cover fewer seams than the trap installs — which is
 * exactly the gap a fetch-only control left open.
 */
interface NetworkSeam {
  /** How an attempt through this seam is labelled. */
  readonly label: string;
  /** Install the trap; returns the undo. */
  readonly install: (onAttempt: (label: string) => void) => () => void;
  /** Invoke the seam once. Throws when the trap is live. */
  readonly probe: () => void;
}

/** Trap a property, and return the undo. */
function propertyTrap(
  holder: object,
  key: string,
  label: string,
  onAttempt: (label: string) => void,
): () => void {
  const original = Object.getOwnPropertyDescriptor(holder, key);
  Object.defineProperty(holder, key, {
    configurable: true,
    writable: true,
    value: () => {
      onAttempt(label);
      throw new Error(`network attempt: ${label}`);
    },
  });
  return () => {
    if (original === undefined) delete (holder as Record<string, unknown>)[key];
    else Object.defineProperty(holder, key, original);
  };
}

/**
 * Every outbound seam a rehearsal could reach the network through.
 *
 * `fetch` is the product's own path (its HTTP client resolves
 * `this.options.fetchFn ?? fetch` at CALL TIME, so replacing the global
 * intercepts it). The node builtins are the paths a future FIXTURE could
 * take, and they are here so that the guarantee means "no network" rather
 * than "no fetch".
 *
 * `get` is listed separately from `request` because node's `http.get` calls
 * the module-LOCAL `request`, not the exported property — trapping
 * `http.request` alone does NOT intercept `http.get`. (Proven by mutation:
 * an `https.get` inside the suite went past the trapped `https.request`.)
 */
const NETWORK_SEAMS: readonly NetworkSeam[] = [
  {
    label: 'fetch',
    install: (onAttempt) => propertyTrap(globalThis, 'fetch', 'fetch', onAttempt),
    probe: () => {
      void (globalThis.fetch as (input: string) => unknown)('https://probe.invalid/');
    },
  },
  {
    label: 'http.request',
    install: (onAttempt) => propertyTrap(http, 'request', 'http.request', onAttempt),
    probe: () => {
      void http.request('http://127.0.0.1:1/probe');
    },
  },
  {
    label: 'http.get',
    install: (onAttempt) => propertyTrap(http, 'get', 'http.get', onAttempt),
    probe: () => {
      void http.get('http://127.0.0.1:1/probe');
    },
  },
  {
    label: 'https.request',
    install: (onAttempt) => propertyTrap(https, 'request', 'https.request', onAttempt),
    probe: () => {
      void https.request('https://127.0.0.1:1/probe');
    },
  },
  {
    label: 'https.get',
    install: (onAttempt) => propertyTrap(https, 'get', 'https.get', onAttempt),
    probe: () => {
      void https.get('https://127.0.0.1:1/probe');
    },
  },
  {
    label: 'net.connect',
    install: (onAttempt) => propertyTrap(net, 'connect', 'net.connect', onAttempt),
    probe: () => {
      void net.connect(1, '127.0.0.1');
    },
  },
  {
    label: 'dgram.createSocket',
    install: (onAttempt) => propertyTrap(dgram, 'createSocket', 'dgram.createSocket', onAttempt),
    probe: () => {
      void dgram.createSocket('udp4');
    },
  },
  {
    label: 'net.Socket.connect',
    install: (onAttempt) => {
      const original = net.Socket.prototype.connect;
      net.Socket.prototype.connect = function trappedConnect() {
        onAttempt('net.Socket.connect');
        throw new Error('network attempt: net.Socket.connect');
      };
      return () => {
        net.Socket.prototype.connect = original;
      };
    },
    probe: () => {
      void new net.Socket().connect(1, '127.0.0.1');
    },
  },
];

/**
 * Install every outbound seam, and return ONE undo for the whole set.
 *
 * `NETWORK_SEAMS.map(...)` hides a trap of its own: an install that throws
 * mid-map leaves the seams already installed PATCHED, and the restore array
 * is never assigned — so the caller's `finally` guards nothing and the
 * globals stay trapped for the rest of the process. A mid-install throw here
 * undoes what it already installed BEFORE the error propagates, and a restore
 * that throws does not strand the remaining seams — every one is still
 * attempted, and the ORIGINAL install error is rethrown unchanged. The
 * returned undo restores every seam in REVERSE install order, the order a
 * hand-written unwind used to follow; the restore list is never mutated, so
 * every invocation of that undo runs in that same reverse order. That
 * per-restore tolerance belongs to the UNWIND, not to the returned undo: a
 * success-path restore on these seams is a `delete`, a re-`defineProperty`
 * of the original descriptor, or (net.Socket.connect) a re-assignment of
 * the original method — none of which throws here. One that did would
 * propagate to the caller, with no competing error for it to shield.
 */
function installNetworkSeams(
  onAttempt: (label: string) => void,
  seams: readonly NetworkSeam[] = NETWORK_SEAMS,
): () => void {
  const restores: Array<() => void> = [];
  try {
    for (const seam of seams) {
      restores.push(seam.install(onAttempt));
    }
  } catch (error) {
    for (const restore of [...restores].reverse()) {
      try {
        restore();
      } catch {
        // A failing undo must not strand the seams still waiting theirs.
      }
    }
    throw error;
  }
  return () => {
    for (const restore of [...restores].reverse()) restore();
  };
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
    // EVERY outbound seam is trapped, not just fetch: the product's HTTP
    // client resolves `fetch` at CALL TIME (`this.options.fetchFn ?? fetch`
    // in src/core/http-client.ts), so replacing the global intercepts the
    // product's own path — but a suite that reached the network through
    // `node:https`, `node:http`, `node:net` or `node:dgram` would slip
    // past a fetch-only trap. The whole point is that the zero below
    // means "no network", not "no fetch".
    const attempts: string[] = [];
    const restore = installNetworkSeams((label) => attempts.push(label));
    try {
      const trapped = await withRehearsal();
      expect(trapped.failed, 'the suite failed while the network was trapped').toBe(0);
      expect(trapped.passed).toBeGreaterThan(20);
      expect(attempts, `the suite attempted: ${attempts.join(', ')}`).toEqual([]);
    } finally {
      restore();
    }
  });

  it('EVERY network trap is live, so the zero above is a real zero', () => {
    // A DEAD trap also reads zero. Without this control, the assertion
    // above could pass for the wrong reason — traps that never fire
    // because they were never wired up would look identical to a suite
    // that genuinely makes no calls. So: fire EVERY seam deliberately,
    // through the SAME list the measurement test installs, and prove each
    // one fires.
    //
    // It used to cover only `fetch`, which meant a dead trap set for the
    // other seven seams still passed. That was caught by a review that
    // deleted one trap and watched the suite stay green.
    const attempts: string[] = [];
    const restore = installNetworkSeams((label) => attempts.push(label));
    try {
      for (const seam of NETWORK_SEAMS) {
        expect(() => seam.probe(), `${seam.label} did not trip its trap`).toThrow(
          /network attempt/,
        );
      }
    } finally {
      restore();
    }
    // Every seam fired exactly once, in the order the list declares.
    expect(attempts).toEqual(NETWORK_SEAMS.map((seam) => seam.label));
  });

  it('undoes the seams it installed when an install throws', () => {
    // A mid-install throw must not leave the earlier seams patched: with
    // `map` the restore array was never assigned, so nothing could undo
    // them. FAKE seams observe the undo without touching a real global —
    // the recorders note their undo in turn, and the last seam throws a
    // known error.
    const undone: string[] = [];
    const recording = (label: string, sink: string[]): NetworkSeam => ({
      label,
      install: () => () => {
        sink.push(label);
      },
      probe: () => {},
    });
    const failure = new Error('install failed');
    const boom: NetworkSeam = {
      label: 'boom',
      install: () => {
        throw failure;
      },
      probe: () => {},
    };
    const thrown: unknown[] = [];
    try {
      installNetworkSeams(() => {}, [
        recording('first', undone),
        recording('second', undone),
        boom,
      ]);
    } catch (error) {
      thrown.push(error);
    }
    // The ORIGINAL install error propagates by IDENTITY — `toThrow(failure)`
    // compares messages only, which a same-message look-alike would pass.
    expect(thrown[0]).toBe(failure);
    // Both earlier seams were undone, in REVERSE install order — the CATCH
    // path, where forward and reverse used to be indistinguishable with a
    // single installed undo.
    expect(undone).toEqual(['second', 'first']);

    // A restore that THROWS must not strand the seams behind it: the
    // original install error still propagates by identity, and the other
    // seam's undo still ran. The poison restore records its own attempt
    // BEFORE throwing, so the assertion proves it ran first (reverse
    // install order) instead of the unwind quietly skipping it.
    const poisonUndone: string[] = [];
    const poison: NetworkSeam = {
      label: 'poison',
      install: () => () => {
        poisonUndone.push('poison');
        throw new Error('restore failed');
      },
      probe: () => {},
    };
    const poisonThrown: unknown[] = [];
    try {
      installNetworkSeams(() => {}, [recording('other', poisonUndone), poison, boom]);
    } catch (error) {
      poisonThrown.push(error);
    }
    expect(poisonThrown[0]).toBe(failure);
    expect(poisonUndone).toEqual(['poison', 'other']);

    // The success path returns one undo that restores in REVERSE install
    // order, so a caller can hand it straight to a `finally` — and because
    // the undo never mutates the restore list, a SECOND invocation runs in
    // reverse again instead of falling back to forward order.
    const restored: string[] = [];
    const restore = installNetworkSeams(() => {}, [
      recording('a', restored),
      recording('b', restored),
    ]);
    restore();
    restore();
    expect(restored).toEqual(['b', 'a', 'b', 'a']);
  });

  it('traps every outbound seam it claims to, and cannot be quietly narrowed', () => {
    // The liveness control above proves the seams IN THE LIST are live. It
    // cannot prove a seam that was REMOVED from the list is still trapped,
    // because the list is the single source of truth for both the traps
    // and the control — so shrinking the list would be self-consistent and
    // would silently weaken the guarantee.
    //
    // Therefore the list itself is pinned. Dropping a seam now fails this
    // assertion, and adding one fails it too — the set of trapped seams
    // can only change deliberately.
    expect(NETWORK_SEAMS.map((seam) => seam.label)).toEqual([
      'fetch',
      'http.request',
      'http.get',
      'https.request',
      'https.get',
      'net.connect',
      'dgram.createSocket',
      'net.Socket.connect',
    ]);
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
