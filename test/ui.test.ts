import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { UI_JS } from '../src/titan/ui.js';

/**
 * Behavioural harness for the served UI script (review finding P1-02).
 *
 * The shipped UI is one flat file of browser JavaScript served at /ui.js.
 * The suite cannot drive a real browser (no browser library is a dependency,
 * and none may be installed), so this harness EXECUTES the served script
 * itself — the same string the HTTP server sends — against a minimal DOM
 * and fetch stub, with fully controllable response ordering.
 *
 * What it proves: a response may only paint the view that is still current.
 * A late success, a late error or a late body parse must never repaint a
 * route the user has already left, must never mix references from an
 * obsolete response into the current view, and must never push a level
 * into a tree the user has left.
 */

/** Minimal DOM node: the surface the served script actually uses. */
class StubNode {
  nodeType = 1;
  tagName: string;
  id = '';
  className = '';
  hidden = false;
  value = '';
  type = '';
  href = '';
  disabled = false;
  textContent = '';
  childNodes: StubNode[] = [];
  private handlers = new Map<string, Array<(event: unknown) => void>>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get firstChild(): StubNode | null {
    return this.childNodes[0] ?? null;
  }

  appendChild(child: StubNode): StubNode {
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: StubNode): StubNode {
    this.childNodes = this.childNodes.filter((node) => node !== child);
    return child;
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  /** Fire a listener the way a user gesture would. */
  dispatch(type: string, event: unknown = { preventDefault: () => undefined }): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }

  setAttribute(name: string, value: string): void {
    if (name === 'href') this.href = value;
    else if (name === 'class') this.className = value;
    else (this as unknown as Record<string, string>)[name] = value;
  }

  /** All text under this node (the script never reads it back; tests do). */
  get allText(): string {
    let out = this.textContent;
    for (const child of this.childNodes) out += child.allText;
    return out;
  }
}

/** One in-flight request the test resolves on its own schedule. */
interface PendingCall {
  readonly url: string;
  /** Resolve the response AND its body immediately. */
  respond(ok: boolean, body: unknown): void;
  /** Resolve the response now, the body later (delayed JSON parsing). */
  respondLater(ok: boolean): void;
  resolveBody(body: unknown): void;
  rejectBody(error: Error): void;
  /** Reject the request itself (network failure). */
  reject(error: Error): void;
}

interface Harness {
  /** What the UI handed the clipboard (the copy-a-citation action). */
  clipboardWrites: string[];
  /** Make the next clipboard write reject (blocked-permission path). */
  setClipboardRejects(value: boolean): void;
  readonly element: (id: string) => StubNode;
  readonly calls: PendingCall[];
  navigate(hash: string): Promise<void>;
  flush(): Promise<void>;
}

function makeHarness(): Harness {
  const elements = new Map<string, StubNode>();
  const calls: PendingCall[] = [];
  const hashListeners: Array<() => void> = [];

  const element = (id: string): StubNode => {
    let node = elements.get(id);
    if (node === undefined) {
      node = new StubNode('div');
      node.id = id;
      elements.set(id, node);
    }
    return node;
  };

  const location = {
    current: '',
    get hash(): string {
      return location.current;
    },
    set hash(value: string) {
      location.current = value;
      // Browsers fire hashchange asynchronously; the harness does the same
      // so the test cannot accidentally depend on synchronous dispatch.
      queueMicrotask(() => {
        for (const listener of hashListeners) listener();
      });
    },
  };

  const windowStub = {
    location,
    addEventListener(type: string, handler: () => void): void {
      if (type === 'hashchange') hashListeners.push(handler);
    },
  };

  const documentStub = {
    getElementById(id: string): StubNode {
      return element(id);
    },
    createElement(tag: string): StubNode {
      return new StubNode(tag);
    },
    createTextNode(text: string): StubNode {
      const node = new StubNode('#text');
      node.textContent = text;
      return node;
    },
  };

  const fetchStub = (url: string): Promise<unknown> => {
    let settleResponse!: (response: unknown) => void;
    let failResponse!: (error: Error) => void;
    let settleBody!: (body: unknown) => void;
    let failBody!: (error: Error) => void;
    const bodyPromise = new Promise((resolve, reject) => {
      settleBody = resolve;
      failBody = reject;
    });
    const call: PendingCall = {
      url,
      respond: (ok, body) => {
        settleResponse({ ok, json: () => bodyPromise });
        settleBody(body);
      },
      respondLater: (ok) => {
        settleResponse({ ok, json: () => bodyPromise });
      },
      resolveBody: (body) => settleBody(body),
      rejectBody: (error) => failBody(error),
      reject: (error) => failResponse(error),
    };
    calls.push(call);
    return new Promise((resolve, reject) => {
      settleResponse = resolve;
      failResponse = reject;
    });
  };

  const clipboardWrites: string[] = [];
  let clipboardRejects = false;
  const navigatorStub = {
    clipboard: {
      writeText: (value: string): Promise<void> => {
        clipboardWrites.push(value);
        return clipboardRejects ? Promise.reject(new Error('blocked')) : Promise.resolve();
      },
    },
  };

  runInNewContext(UI_JS, {
    window: windowStub,
    document: documentStub,
    fetch: fetchStub,
    URLSearchParams,
    navigator: navigatorStub,
    console,
  });

  const flush = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const navigate = async (hash: string): Promise<void> => {
    location.hash = hash;
    await flush();
  };

  return {
    element,
    calls,
    navigate,
    flush,
    clipboardWrites,
    setClipboardRejects: (value: boolean): void => {
      clipboardRejects = value;
    },
  };
}

function sectionBody(citation: string, heading: string): Record<string, unknown> {
  return {
    citation,
    kind: 'section',
    heading,
    chapter: 'I',
    part: '4',
    subpart: 'B',
    path: '/title:38/chapter:I/part:4/subpart:B',
    issueDate: '2026-10-16',
    text: `Body ${citation}.`,
    markdown: `Body ${citation}.`,
    references: [{ citation: '4.125', available: true }],
    citedBy: ['4.16'],
    sourceUrl: `https://www.ecfr.gov/current/title-38/section-${citation}`,
    sourceUrlAtIndexDate: `https://www.ecfr.gov/on/2026-10-16/title-38/section-${citation}`,
    indexStale: false,
    notice: null,
  };
}

/** A section whose text carries the P1-01 image marker. */
function sectionBodyWithImage(citation: string): Record<string, unknown> {
  return {
    ...sectionBody(citation, 'Heading ' + citation),
    text:
      `Some prose.\n\nFootnote: note text.\n\n` +
      `[image content not included: /graphics/er11my99.005.gif]\n\nMore prose.`,
  };
}

function searchBody(citation: string, heading: string): Record<string, unknown> {
  return {
    total: 1,
    page: 1,
    // The OR tier is the only candidate tier.
    matchMode: 'or',
    matchedTerms: [],
    unmatchedTerms: [],
    hits: [
      {
        citation,
        citationDisplay: `38 C.F.R. § ${citation}`,
        heading,
        snippet: `Snippet for ${citation}.`,
        matches: [],
        direct: false,
        part: '4',
      },
    ],
  };
}

describe('UI search grounding', () => {
  it('warns about the terms the results did not answer, without claiming coverage', async () => {
    const harness = makeHarness();
    await harness.navigate('#/search?q=alpha');
    harness.calls[0]?.respond(true, {
      ...searchBody('4.16', 'Heading 4.16'),
      unmatchedTerms: ['appendices', 'amendments'],
    });
    await harness.flush();

    const caution = harness.element('search-caution');
    expect(caution.hidden).toBe(false);
    expect(caution.textContent).toContain('"appendices" or "amendments"');
    expect(caution.textContent).toContain('may not be among them');
    // The wording is about the RESULTS: it never claims the corpus does or
    // does not cover the question.
    for (const forbidden of ['not covered', 'no rule', 'does not cover', 'Title 38 does not']) {
      expect(caution.textContent).not.toContain(forbidden);
    }
  });

  it('shows the no-match wording when nothing was indexed', async () => {
    const harness = makeHarness();
    await harness.navigate('#/search?q=alpha');
    harness.calls[0]?.respond(true, { total: 0, page: 1, matchMode: 'or', hits: [] });
    await harness.flush();

    const caution = harness.element('search-caution');
    expect(caution.hidden).toBe(false);
    expect(caution.textContent).toContain('No indexed provision matched these terms');
  });

  it('shows no caution when every term was answered', async () => {
    const harness = makeHarness();
    await harness.navigate('#/search?q=alpha');
    harness.calls[0]?.respond(true, searchBody('4.16', 'Heading 4.16'));
    await harness.flush();

    expect(harness.element('search-caution').hidden).toBe(true);
  });

  it('names the count candidates, not hits', async () => {
    const harness = makeHarness();
    await harness.navigate('#/search?q=alpha');
    harness.calls[0]?.respond(true, { ...searchBody('4.16', 'Heading 4.16'), total: 42 });
    await harness.flush();

    // The total is the CANDIDATE SET (every provision matching at least one
    // query term), so the status line must not call it "hits".
    const status = harness.element('search-status').textContent ?? '';
    expect(status).toContain('42 candidates');
    expect(status).not.toContain('hit');
    expect(status).not.toContain('match mode');
  });
});

describe('UI route ownership (P1-02)', () => {
  it('lets the newest route win when responses resolve out of order', async () => {
    const harness = makeHarness();
    await harness.navigate('#/section/4.125');
    await harness.navigate('#/section/4.130');
    expect(harness.calls.map((call) => call.url)).toEqual([
      '/api/v1/sections/4.125',
      '/api/v1/sections/4.130',
    ]);

    // The NEWER request resolves first, then the obsolete one lands late.
    harness.calls[1]?.respond(true, sectionBody('4.130', 'Heading 4.130'));
    await harness.flush();
    harness.calls[0]?.respond(true, sectionBody('4.125', 'Heading 4.125'));
    await harness.flush();

    const heading = harness.element('section-heading').textContent;
    expect(heading).toBe('Heading 4.130');
    expect(harness.element('section-text').textContent).toBe('Body 4.130.');
    expect(harness.element('section-text').textContent).not.toContain('4.125');
  });

  it('does not let a late section error paint over the current view', async () => {
    const harness = makeHarness();
    await harness.navigate('#/section/4.125');
    await harness.navigate('#/section/4.130');
    harness.calls[1]?.respond(true, sectionBody('4.130', 'Heading 4.130'));
    await harness.flush();
    harness.calls[0]?.reject(new Error('network down'));
    await harness.flush();

    expect(harness.element('section-heading').textContent).toBe('Heading 4.130');
    expect(harness.element('section-error').textContent).toBe('');
  });

  it('does not let a late body parse repaint the current view', async () => {
    const harness = makeHarness();
    await harness.navigate('#/section/4.125');
    await harness.navigate('#/section/4.130');
    // The obsolete response arrives; its BODY is still pending.
    harness.calls[0]?.respondLater(true);
    await harness.flush();
    harness.calls[1]?.respond(true, sectionBody('4.130', 'Heading 4.130'));
    await harness.flush();
    // Now the obsolete body finally parses.
    harness.calls[0]?.resolveBody(sectionBody('4.125', 'Heading 4.125'));
    await harness.flush();

    expect(harness.element('section-heading').textContent).toBe('Heading 4.130');
    expect(harness.element('section-text').textContent).toBe('Body 4.130.');
  });

  it('does not let a late search response overwrite a newer search', async () => {
    const harness = makeHarness();
    await harness.navigate('#/search?q=alpha');
    await harness.navigate('#/search?q=beta');
    harness.calls[1]?.respond(true, searchBody('4.16', 'Heading 4.16'));
    await harness.flush();
    harness.calls[0]?.respond(true, searchBody('4.130', 'Heading 4.130'));
    await harness.flush();

    const hits = harness.element('search-hits');
    expect(hits.allText).toContain('Heading 4.16');
    expect(hits.allText).not.toContain('Heading 4.130');
  });

  it('does not let a late search response paint into another view', async () => {
    const harness = makeHarness();
    await harness.navigate('#/search?q=alpha');
    await harness.navigate('#/section/4.130');
    harness.calls[0]?.respond(true, searchBody('4.16', 'Heading 4.16'));
    await harness.flush();

    expect(harness.element('search-hits').allText).toBe('');
    expect(harness.element('section-heading').textContent).toBe('4.130');
  });

  it('does not let a late search response repaint a cleared query', async () => {
    const harness = makeHarness();
    await harness.navigate('#/search?q=alpha');
    await harness.navigate('#/search');
    harness.calls[0]?.respond(true, searchBody('4.16', 'Heading 4.16'));
    await harness.flush();

    expect(harness.element('search-hits').allText).toBe('');
    expect(harness.element('search-status').textContent).toContain('at least 3 characters');
  });

  it('does not accumulate references from an obsolete response', async () => {
    const harness = makeHarness();
    await harness.navigate('#/section/4.125');
    await harness.navigate('#/section/4.130');
    harness.calls[0]?.respond(true, sectionBody('4.125', 'Heading 4.125'));
    await harness.flush();

    // The obsolete response carried a reference; it must not appear.
    expect(harness.element('section-references').allText).toBe('');
    expect(harness.element('section-citedby').allText).toBe('');
  });

  it('descends into a subject group from the browse tree', async () => {
    const harness = makeHarness();
    await harness.navigate('#/browse');
    expect(harness.calls[0]?.url).toBe('/api/v1/browse');
    harness.calls[0]?.respond(true, {
      node: { type: 'title', identifier: '38', label: 'Title 38' },
      path: [],
      children: [{ type: 'part', identifier: '17', label: 'Part 17—Medical Care' }],
    });
    await harness.flush();

    // The part row is a button; clicking it fetches the next level.
    harness.element('browse-list').childNodes[0]?.childNodes[0]?.dispatch('click');
    await harness.flush();
    expect(harness.calls[1]?.url).toBe('/api/v1/browse?part=17');

    harness.calls[1]?.respond(true, {
      node: { type: 'part', identifier: '17', label: 'Part 17—Medical Care' },
      path: [
        { type: 'chapter', identifier: 'I', label: 'Chapter I' },
        { type: 'part', identifier: '17', label: 'Part 17—Medical Care' },
      ],
      children: [
        {
          type: 'subject_group',
          identifier: 'ECFRfixturegroup0001',
          label: 'Subgroup—Hospitalization and Emergency Care',
        },
      ],
    });
    await harness.flush();

    // A subject group is a descendable level: its sections were unreachable.
    harness.element('browse-list').childNodes[0]?.childNodes[0]?.dispatch('click');
    await harness.flush();
    expect(harness.calls[2]?.url).toBe('/api/v1/browse?part=17&subjgrp=ECFRfixturegroup0001');

    harness.calls[2]?.respond(true, {
      node: {
        type: 'subject_group',
        identifier: 'ECFRfixturegroup0001',
        label: 'Subgroup—Hospitalization and Emergency Care',
      },
      path: [
        { type: 'chapter', identifier: 'I', label: 'Chapter I' },
        { type: 'part', identifier: '17', label: 'Part 17—Medical Care' },
        {
          type: 'subject_group',
          identifier: 'ECFRfixturegroup0001',
          label: 'Subgroup—Hospitalization and Emergency Care',
        },
      ],
      children: [{ type: 'section', identifier: '17.15', label: '§ 17.15' }],
    });
    await harness.flush();
    expect(harness.element('browse-list').allText).toContain('17.15');
  });

  it('does not let a late browse response push a level into the tree', async () => {
    const harness = makeHarness();
    await harness.navigate('#/browse');
    await harness.navigate('#/search?q=alpha');
    harness.calls[0]?.respond(true, {
      node: { type: 'title', identifier: '38', label: 'Title 38' },
      path: [],
      children: [{ type: 'chapter', identifier: 'I', label: 'Chapter I' }],
    });
    await harness.flush();

    // The obsolete response must not push a level or paint the tree.
    expect(harness.element('browse-list').allText).toBe('');
    expect(harness.element('browse-heading').textContent).not.toContain('Title 38');
    expect(harness.element('browse-view').hidden).toBe(true);
  });

  it('still renders a response that belongs to the current route', async () => {
    const harness = makeHarness();
    await harness.navigate('#/section/4.130');
    harness.calls[0]?.respond(true, sectionBody('4.130', 'Heading 4.130'));
    await harness.flush();

    expect(harness.element('section-heading').textContent).toBe('Heading 4.130');
    expect(harness.element('section-path').textContent).toContain('Chapter I');
    expect(harness.element('section-references').allText).toContain('4.125');
  });
});

describe('UI copy-a-citation (M5 slice 1)', () => {
  it('builds the citation block from the loaded section', async () => {
    const harness = makeHarness();
    await harness.navigate('#/section/4.130');
    harness.calls[0]?.respond(true, sectionBody('4.130', 'Schedule of ratings—Mental disorders.'));
    await harness.flush();

    const block = harness.element('citation-block');
    expect(block.value).toContain('38 C.F.R. § 4.130');
    expect(block.value).toContain('Schedule of ratings—Mental disorders.');
    expect(block.value).toContain('issue date 2026-10-16');
    // The DATED verification URL — the revision this text came from.
    expect(block.value).toContain('https://www.ecfr.gov/on/2026-10-16/title-38/section-4.130');
  });

  it('warns that image content is not included when the text carries the marker', async () => {
    const harness = makeHarness();
    await harness.navigate('#/section/4.85');
    harness.calls[0]?.respond(true, sectionBodyWithImage('4.85'));
    await harness.flush();
    expect(harness.element('citation-block').value).toContain(
      'graphic content (rating tables) that is NOT included',
    );
  });

  it('adds no incompleteness warning for a complete provision', async () => {
    const harness = makeHarness();
    await harness.navigate('#/section/4.130');
    harness.calls[0]?.respond(true, sectionBody('4.130', 'Heading 4.130'));
    await harness.flush();
    expect(harness.element('citation-block').value).not.toContain('NOT included');
  });

  it('copies the block to the clipboard on click', async () => {
    const harness = makeHarness();
    await harness.navigate('#/section/4.130');
    harness.calls[0]?.respond(true, sectionBody('4.130', 'Heading 4.130'));
    await harness.flush();
    harness.element('copy-citation').dispatch('click', { preventDefault: () => undefined });
    // The write resolves on a microtask, so the confirmation lands after a flush.
    await harness.flush();
    expect(harness.clipboardWrites).toHaveLength(1);
    expect(harness.clipboardWrites[0]).toContain('38 C.F.R. § 4.130');
    // The status line confirms, and the block is selectable regardless.
    expect(harness.element('copy-status').textContent).toContain('Copied');
  });

  it('never labels the block with a served date it cannot verify', async () => {
    const harness = makeHarness();
    await harness.navigate('#/section/4.130');
    harness.calls[0]?.respond(true, sectionBody('4.130', 'Heading 4.130'));
    await harness.flush();
    const block = harness.element('citation-block').value;
    expect(block).not.toMatch(/served/i);
    expect(block).not.toMatch(/revision (was|served)/i);
  });

  it('reports a blocked clipboard write instead of failing silently', async () => {
    const harness = makeHarness();
    await harness.navigate('#/section/4.130');
    harness.calls[0]?.respond(true, sectionBody('4.130', 'Heading 4.130'));
    await harness.flush();
    harness.setClipboardRejects(true);
    harness.element('copy-citation').dispatch('click', { preventDefault: () => undefined });
    await harness.flush();
    expect(harness.element('copy-status').textContent).toContain('blocked');
  });
});

describe('UI redline view (M5 slice 2)', () => {
  const HUNK = {
    fromLine: 1,
    toLine: null,
    type: 'del',
    text: 'Old line.',
  };
  const ADDED = {
    fromLine: null,
    toLine: 1,
    type: 'add',
    text: 'New line.',
  };

  function redlineBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      fromIssueDate: '2026-01-01',
      toIssueDate: '2026-06-01',
      citation: '4.130',
      status: 'changed',
      fromText: 'Old line.\n',
      toText: 'New line.\n',
      hunks: [HUNK, ADDED],
      coarse: false,
      ...overrides,
    };
  }

  async function submitRedline(harness: Harness): Promise<void> {
    harness.element('redline-from').value = '2026-01-01';
    harness.element('redline-to').value = '2026-06-01';
    harness.element('redline-citation').value = '4.130';
    harness.element('redline-form').dispatch('submit', { preventDefault: () => undefined });
    await harness.flush();
  }

  it('requests the redline for the entered date pair and citation', async () => {
    const harness = makeHarness();
    await harness.navigate('#/redline');
    await submitRedline(harness);
    expect(harness.calls[0]?.url).toBe(
      '/api/v1/redline?from=2026-01-01&to=2026-06-01&citation=4.130',
    );
  });

  it('renders the hunks in the CLI shape', async () => {
    const harness = makeHarness();
    await harness.navigate('#/redline');
    await submitRedline(harness);
    harness.calls[0]?.respond(true, redlineBody());
    await harness.flush();

    expect(harness.element('redline-heading').textContent).toBe('Section 4.130: changed');
    expect(harness.element('redline-meta').textContent).toContain('from 2026-01-01 to 2026-06-01');
    const output = harness.element('redline-output').textContent;
    expect(output).toContain('L1 | L- | - Old line.');
    expect(output).toContain('L- | L1 | + New line.');
  });

  it('shows the coarse flag so a whole-block diff is not read as a line diff', async () => {
    const harness = makeHarness();
    await harness.navigate('#/redline');
    await submitRedline(harness);
    harness.calls[0]?.respond(true, redlineBody({ coarse: true }));
    await harness.flush();
    expect(harness.element('redline-meta').textContent).toContain('coarse diff');
  });

  it('reports an unchanged provision plainly', async () => {
    const harness = makeHarness();
    await harness.navigate('#/redline');
    await submitRedline(harness);
    harness.calls[0]?.respond(true, redlineBody({ status: 'unchanged', hunks: [] }));
    await harness.flush();
    expect(harness.element('redline-output').textContent).toContain('No text difference');
  });

  it('surfaces an upstream error instead of an empty diff', async () => {
    const harness = makeHarness();
    await harness.navigate('#/redline');
    await submitRedline(harness);
    harness.calls[0]?.respond(false, { error: 'not_found', message: '4.999 is not in Title 38' });
    await harness.flush();
    expect(harness.element('redline-error').textContent).toContain('not_found');
    expect(harness.element('redline-output').textContent).toBe('');
  });

  it('requires a date pair and a citation before fetching', async () => {
    const harness = makeHarness();
    await harness.navigate('#/redline');
    harness.element('redline-form').dispatch('submit', { preventDefault: () => undefined });
    await harness.flush();
    expect(harness.calls).toHaveLength(0);
    expect(harness.element('redline-error').textContent).toContain('required');
  });

  it('does not let a late response repaint a view the user left (P1-02 ownership)', async () => {
    const harness = makeHarness();
    await harness.navigate('#/redline');
    await submitRedline(harness);
    // The user navigates away before the redline lands.
    await harness.navigate('#/search?q=alpha');
    harness.calls[0]?.respond(true, redlineBody());
    await harness.flush();
    expect(harness.element('redline-heading').textContent).toBe('');
    expect(harness.element('redline-output').textContent).toBe('');
  });
});

describe('UI search part title', () => {
  it('shows the part title in the meta line when present', async () => {
    const harness = makeHarness();
    await harness.navigate('#/search?q=alpha');
    harness.calls[0]?.respond(true, {
      total: 1,
      page: 1,
      matchMode: 'or',
      matchedTerms: [],
      unmatchedTerms: [],
      hits: [
        {
          citation: '4.16',
          citationDisplay: '38 C.F.R. § 4.16',
          heading: 'Heading 4.16',
          snippet: 'Snippet for 4.16.',
          matches: [],
          direct: false,
          part: '4',
          partTitle: 'Schedule for Rating Disabilities',
        },
      ],
    });
    await harness.flush();

    const hits = harness.element('search-hits');
    expect(hits.allText).toContain(' — part 4: Schedule for Rating Disabilities');
  });

  it('keeps the bare part number when partTitle is absent', async () => {
    const harness = makeHarness();
    await harness.navigate('#/search?q=alpha');
    harness.calls[0]?.respond(true, {
      total: 1,
      page: 1,
      matchMode: 'or',
      matchedTerms: [],
      unmatchedTerms: [],
      hits: [
        {
          citation: '4.16',
          citationDisplay: '38 C.F.R. § 4.16',
          heading: 'Heading 4.16',
          snippet: 'Snippet for 4.16.',
          matches: [],
          direct: false,
          part: '4',
        },
      ],
    });
    await harness.flush();

    const hits = harness.element('search-hits');
    expect(hits.allText).toContain(' — part 4');
    expect(hits.allText).not.toContain(' — part 4:');
  });
});
