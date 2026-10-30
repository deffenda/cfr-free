(function () {
  'use strict';

  function byId(id) {
    return document.getElementById(id);
  }

  function clear(node) {
    while (node.firstChild !== null) node.removeChild(node.firstChild);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className !== '') node.className = className;
    if (text !== '') node.textContent = text;
    return node;
  }

  const searchView = byId('search-view');
  const sectionView = byId('section-view');
  const searchForm = byId('search-form');
  const qInput = byId('q');
  const kindSelect = byId('kind');
  const partInput = byId('part');
  const chapterInput = byId('chapter');
  const perPageSelect = byId('per-page');
  const statusLine = byId('search-status');
  const cautionLine = byId('search-caution');
  const hitsList = byId('search-hits');
  const pager = byId('search-pager');
  const announcer = byId('view-announcer');
  const sectionError = byId('section-error');
  const sectionHeading = byId('section-heading');
  const copyButton = byId('copy-citation');
  const copyStatus = byId('copy-status');
  const citationBlock = byId('citation-block');
  const sectionPath = byId('section-path');
  const sectionMeta = byId('section-meta');
  const sectionText = byId('section-text');
  const sectionReferences = byId('section-references');
  const sectionCitedBy = byId('section-citedby');
  // Incremented on every navigation; a response may only mutate the DOM
  // while the generation it captured is still current.
  let routeGeneration = 0;
  // The view that was showing before this navigation; null until the first
  // render has happened. The keyboard moves only when the VIEW changes.
  let lastView = null;
  const browseView = byId('browse-view');
  const browseError = byId('browse-error');
  const browseCrumbs = byId('browse-crumbs');
  const browseHeading = byId('browse-heading');
  const browseList = byId('browse-list');
  const redlineView = byId('redline-view');
  const redlineForm = byId('redline-form');
  const redlineFrom = byId('redline-from');
  const redlineTo = byId('redline-to');
  const redlineCitation = byId('redline-citation');
  const redlineError = byId('redline-error');
  const redlineHeading = byId('redline-heading');
  const redlineMeta = byId('redline-meta');
  const redlineOutput = byId('redline-output');
  // Per-submission request identity for the redline view. routeGeneration
  // only advances on NAVIGATION, so two submissions on the same #/redline
  // route would otherwise share one guard and a stale response could
  // overwrite a newer one. Every submission attempt - valid or not -
  // takes a fresh identity, and a response is applied only when its
  // identity is still the latest. Invalid submissions also take an
  // identity so an in-flight request from a previous attempt is
  // invalidated rather than left to resurrect stale text.
  let redlineRequestId = 0;
  // Tree navigation state: one entry per level, deepest last. It lives HERE,
  // never in the hash — #/browse is a single route and the stack is
  // depth-limited (root → chapter → part → subpart).
  let browseLevels = [];

  function clampInt(raw, fallback, max) {
    const value = parseInt(raw === null ? '' : raw, 10);
    if (!isFinite(value) || value < 1) return fallback;
    if (max !== null && value > max) return max;
    return value;
  }

  /**
   * Plain-error messages, in the reader's words.
   *
   * The service's message already names the rule that was broken — "the
   * chapter must be a Roman numeral such as I, II or IV". What a claims
   * practitioner must not be shown is the label the API puts on it, or a
   * validation library's own phrasing. The code is for a program; the
   * message is for the reader.
   */
  function plainErrorMessage(code, message) {
    const text = String(message === undefined || message === null ? '' : message);
    if (code !== 'invalid_input') return text;
    const prefix = 'invalid input: ';
    return text.indexOf(prefix) === 0 ? text.slice(prefix.length) : text;
  }

  /** The heading each view's keyboard focus moves to. */
  const VIEW_HEADINGS = {
    search: 'search-heading',
    section: 'section-heading',
    browse: 'browse-heading',
    redline: 'redline-heading',
  };

  /** What the live region says when a view opens. */
  const VIEW_LABELS = {
    search: 'Search.',
    section: 'Provision.',
    browse: 'Browse.',
    redline: 'Redline.',
  };

  function parseHash() {
    const hash = window.location.hash;
    // Single browse route: no query params — the tree state stays in the click
    // handlers below. Any other unknown hash falls through to the search view.
    if (hash === '#/browse') return { view: 'browse' };
    // The redline form keeps its own state in the DOM (the fields are
    // the state), so the route carries no query — one route, like browse.
    if (hash === '#/redline') return { view: 'redline' };
    const sectionPrefix = '#/section/';
    if (hash.indexOf(sectionPrefix) === 0) {
      const raw = hash.slice(sectionPrefix.length);
      // A malformed percent-escape is not a route error: the citation is
      // shown as it arrived, so a link with a stray `%` still opens.
      let citation;
      try {
        citation = decodeURIComponent(raw);
      } catch {
        citation = raw;
      }
      return { view: 'section', citation: citation };
    }
    let rest = hash.indexOf('#/search') === 0 ? hash.slice('#/search'.length) : '';
    if (rest.charAt(0) === '?') rest = rest.slice(1);
    const params = new URLSearchParams(rest);
    return {
      view: 'search',
      q: params.get('q') === null ? '' : params.get('q'),
      kind: params.get('kind') === null ? '' : params.get('kind'),
      part: params.get('part') === null ? '' : params.get('part'),
      chapter: params.get('chapter') === null ? '' : params.get('chapter'),
      page: clampInt(params.get('page'), 1, 10000),
      perPage: clampInt(params.get('per_page'), 10, 20),
    };
  }

  function hashForSearch(state) {
    const params = new URLSearchParams();
    if (state.q !== '') params.set('q', state.q);
    if (state.kind === 'section' || state.kind === 'appendix') params.set('kind', state.kind);
    if (state.part !== '') params.set('part', state.part);
    if (state.chapter !== '') params.set('chapter', state.chapter);
    if (state.page > 1) params.set('page', String(state.page));
    if (state.perPage !== 10) params.set('per_page', String(state.perPage));
    const query = params.toString();
    return '#/search' + (query === '' ? '' : '?' + query);
  }

  function withPage(state, page) {
    return {
      view: 'search',
      q: state.q,
      kind: state.kind,
      part: state.part,
      chapter: state.chapter,
      page: page,
      perPage: state.perPage,
    };
  }

  function searchUrlFromState(state) {
    const params = new URLSearchParams();
    params.set('q', state.q);
    if (state.kind === 'section' || state.kind === 'appendix') params.set('kind', state.kind);
    if (state.part !== '') params.set('part', state.part);
    if (state.chapter !== '') params.set('chapter', state.chapter);
    params.set('page', String(state.page));
    params.set('per_page', String(state.perPage));
    return '/api/v1/search?' + params.toString();
  }

  function sectionHref(citation) {
    return '#/section/' + encodeURIComponent(citation);
  }

  function appendCitationLink(listItem, citation) {
    const link = document.createElement('a');
    link.href = sectionHref(citation);
    link.textContent = citation;
    listItem.appendChild(link);
  }

  function isWordChar(character) {
    return character !== '' && /[\p{L}\p{N}]/u.test(character);
  }

  function markMatches(container, text, matches) {
    // 'matches' are the lowercased query tokens the API reports as visible in
    // this hit; their character offsets in the snippet are computed HERE and
    // rendered as <mark> elements around known spans. The snippet itself is
    // only ever inserted as text nodes — never parsed as HTML.
    const lower = text.toLowerCase();
    const ranges = [];
    for (let i = 0; i < matches.length; i += 1) {
      const token = String(matches[i]).toLowerCase();
      if (token === '') continue;
      let from = 0;
      for (;;) {
        const at = lower.indexOf(token, from);
        if (at === -1) break;
        if (!isWordChar(lower.charAt(at - 1))) ranges.push([at, at + token.length]);
        from = at + token.length;
      }
    }
    ranges.sort(function (left, right) {
      return left[0] - right[0] || left[1] - right[1];
    });
    const merged = [];
    for (let r = 0; r < ranges.length; r += 1) {
      const range = ranges[r];
      const last = merged[merged.length - 1];
      if (last !== undefined && range[0] <= last[1]) {
        if (range[1] > last[1]) last[1] = range[1];
      } else {
        merged.push([range[0], range[1]]);
      }
    }
    let cursor = 0;
    for (let m = 0; m < merged.length; m += 1) {
      const span = merged[m];
      if (span[0] > cursor) {
        container.appendChild(document.createTextNode(text.slice(cursor, span[0])));
      }
      const mark = document.createElement('mark');
      mark.textContent = text.slice(span[0], span[1]);
      container.appendChild(mark);
      cursor = span[1];
    }
    if (cursor < text.length) {
      container.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  function appendHit(hit) {
    const item = document.createElement('li');
    item.className = 'hit';
    const heading = document.createElement('h3');
    const link = document.createElement('a');
    link.href = sectionHref(String(hit.citation));
    const label =
      hit.citationDisplay === undefined ||
      hit.citationDisplay === null ||
      hit.citationDisplay === ''
        ? String(hit.citation)
        : String(hit.citationDisplay);
    link.textContent = label;
    heading.appendChild(link);
    if (hit.direct === true) heading.appendChild(el('span', 'badge', 'direct hit'));
    item.appendChild(heading);
    let part = '';
    if (hit.part !== null && hit.part !== undefined) {
      part = ' — part ' + String(hit.part);
      if (hit.partTitle !== null && hit.partTitle !== undefined && String(hit.partTitle) !== '') {
        part = part + ': ' + String(hit.partTitle);
      }
    }
    item.appendChild(el('p', 'hit-meta', String(hit.heading) + part));
    const snippet = el('p', 'hit-snippet', '');
    markMatches(snippet, String(hit.snippet), Array.isArray(hit.matches) ? hit.matches : []);
    item.appendChild(snippet);
    hitsList.appendChild(item);
  }

  function renderPager(state, total) {
    const pages = Math.max(1, Math.ceil(total / state.perPage));
    pager.appendChild(
      el('p', 'pager-info', 'Page ' + state.page + ' of ' + pages + ' (' + total + ' candidates)'),
    );
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.textContent = 'Previous page';
    previous.disabled = state.page <= 1;
    previous.addEventListener('click', function () {
      window.location.hash = hashForSearch(withPage(state, state.page - 1));
    });
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = 'Next page';
    next.disabled = state.page >= pages;
    next.addEventListener('click', function () {
      window.location.hash = hashForSearch(withPage(state, state.page + 1));
    });
    pager.appendChild(previous);
    pager.appendChild(next);
  }

  /** A readable list of quoted terms: "a", "b" or "c". */
  function quoteList(words) {
    const quoted = [];
    for (let i = 0; i < words.length; i += 1) quoted.push('"' + String(words[i]) + '"');
    if (quoted.length === 1) return quoted[0];
    return quoted.slice(0, -1).join(', ') + ' or ' + quoted[quoted.length - 1];
  }

  /**
   * The caution line: what the RESULTS did not speak to, never what Title 38
   * covers. A term can be unmatched because the governing provision sits
   * outside the returned window, because it uses other words, or because the
   * corpus does not discuss it at all — so the wording names only the terms
   * and leaves the reason open.
   */
  function renderSearchCaution(body, total) {
    clear(cautionLine);
    const unmatched = Array.isArray(body.unmatchedTerms) ? body.unmatchedTerms : [];
    if (unmatched.length > 0) {
      cautionLine.textContent =
        'None of these results mention ' +
        quoteList(unmatched) +
        '. The provision that answers your question may not be among them.';
      cautionLine.hidden = false;
      return;
    }
    if (total === 0) {
      cautionLine.textContent =
        'No indexed provision matched these terms. Try different wording, or use Browse to find the relevant part.';
      cautionLine.hidden = false;
      return;
    }
    cautionLine.hidden = true;
  }

  function renderSearchResult(state, ok, body) {
    clear(hitsList);
    clear(pager);
    if (!ok || typeof body.error === 'string') {
      clear(cautionLine);
      cautionLine.hidden = true;
      statusLine.textContent = 'Search failed: ' + plainErrorMessage(body.error, body.message);
      return;
    }
    const total = typeof body.total === 'number' ? body.total : 0;
    const notice = typeof body.notice === 'string' ? body.notice : '';
    // The count is the CANDIDATE SET — every provision matching at least one
    // query term — not the number of hits on this page. The tier is always
    // the OR tier, so there is no match mode to report.
    statusLine.textContent =
      total +
      ' candidate' +
      (total === 1 ? '' : 's') +
      ' — page ' +
      String(body.page) +
      (notice === '' ? '' : ' — ' + notice);
    const hits = Array.isArray(body.hits) ? body.hits : [];
    for (let i = 0; i < hits.length; i += 1) appendHit(hits[i]);
    renderSearchCaution(body, total);
    renderPager(state, total);
  }

  /**
   * The redline view (M5 slice 2): the line-level diff of ONE provision
   * between two eCFR dates, rendered in the same shape the CLI prints, so
   * a reader sees the same diff in the browser as on the terminal.
   *
   * The wire serves the core's contract verbatim (fromIssueDate,
   * toIssueDate, citation, status, hunks, coarse). The coarse flag is
   * shown explicitly: above the line cap the diff is a whole-block
   * comparison, not a line-by-line one, and the reader must not mistake
   * it for one.
   */
  function renderRedline() {
    searchView.hidden = true;
    sectionView.hidden = true;
    browseView.hidden = true;
    redlineView.hidden = false;
    clear(redlineError);
    clear(redlineHeading);
    clear(redlineMeta);
    redlineOutput.textContent = '';
  }

  /** Leaving the redline route clears it, so a hidden view holds no stale diff. */
  function clearRedline() {
    redlineView.hidden = true;
    clear(redlineError);
    clear(redlineHeading);
    clear(redlineMeta);
    redlineOutput.textContent = '';
  }

  function redlineHunkLine(hunk) {
    const from =
      hunk.fromLine === null || hunk.fromLine === undefined ? '-' : String(hunk.fromLine);
    const to = hunk.toLine === null || hunk.toLine === undefined ? '-' : String(hunk.toLine);
    let prefix = ' ';
    if (hunk.type === 'del') prefix = '-';
    else if (hunk.type === 'add') prefix = '+';
    return 'L' + from + ' | L' + to + ' | ' + prefix + ' ' + String(hunk.text);
  }

  function showRedlineError(message) {
    redlineError.textContent = message;
    redlineHeading.textContent = '';
    redlineMeta.textContent = '';
    redlineOutput.textContent = '';
  }

  function fillRedline(body) {
    const status = String(body.status);
    redlineHeading.textContent = 'Section ' + String(body.citation) + ': ' + status;
    let meta = 'from ' + String(body.fromIssueDate) + ' to ' + String(body.toIssueDate);
    if (body.coarse === true) {
      meta += ' — coarse diff: the provision is too large for a line-by-line comparison';
    }
    // The limit on what the two dates mean travels with the comparison
    // itself, so a reader of the change view is not left to find it
    // elsewhere. It is a sentence, not a link, and it is set as text.
    if (typeof body.notice === 'string' && body.notice !== '') {
      meta += ' — ' + body.notice;
    }
    redlineMeta.textContent = meta;
    const lines = [];
    if (status === 'unchanged') {
      lines.push('No text difference between the two dates.');
    } else {
      lines.push(
        '        | ' + String(body.fromIssueDate) + ' | ' + String(body.toIssueDate) + ' | text',
      );
      const hunks = Array.isArray(body.hunks) ? body.hunks : [];
      for (let i = 0; i < hunks.length; i += 1) lines.push(redlineHunkLine(hunks[i]));
    }
    redlineOutput.textContent = lines.join('\n');
  }

  function loadRedline(from, to, citation, generation, requestId) {
    clear(redlineError);
    redlineOutput.textContent = 'Loading…';
    const params = new URLSearchParams();
    params.set('from', from);
    params.set('to', to);
    params.set('citation', citation);
    fetch('/api/v1/redline?' + params.toString())
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (generation !== routeGeneration) return;
        if (requestId !== redlineRequestId) return;
        if (!result.ok || typeof result.body.error === 'string') {
          showRedlineError(
            'Redline failed: ' + plainErrorMessage(result.body.error, result.body.message),
          );
          return;
        }
        fillRedline(result.body);
      })
      .catch(function (error) {
        if (generation !== routeGeneration) return;
        if (requestId !== redlineRequestId) return;
        showRedlineError(
          'Request failed: ' + String(error && error.message ? error.message : error),
        );
      });
  }

  redlineForm.addEventListener('submit', function (event) {
    event.preventDefault();
    const from = redlineFrom.value.trim();
    const to = redlineTo.value.trim();
    const citation = redlineCitation.value.trim();
    // Every submission attempt takes a fresh request identity, including an
    // invalid one, so a response from a previous attempt can never overwrite
    // this attempt's result and an in-flight request is invalidated.
    redlineRequestId += 1;
    const requestId = redlineRequestId;
    // Invalid submission policy: a client-rejected submission does not fetch.
    // It clears any previously displayed comparison and shows the reason, so
    // a stale result is never presented as the answer to the current form;
    // taking the fresh identity above also invalidates any in-flight request.
    if (from === '' || to === '' || citation === '') {
      showRedlineError('A from date, a to date and a citation are all required.');
      return;
    }
    loadRedline(from, to, citation, routeGeneration, requestId);
  });

  function renderSearch(state, generation) {
    searchView.hidden = false;
    sectionView.hidden = true;
    browseView.hidden = true;
    clearRedline();
    qInput.value = state.q;
    kindSelect.value = state.kind === 'section' || state.kind === 'appendix' ? state.kind : '';
    partInput.value = state.part;
    chapterInput.value = state.chapter;
    perPageSelect.value = String(state.perPage);
    clear(hitsList);
    clear(pager);
    if (state.q === '') {
      statusLine.textContent = 'Enter a query of at least 3 characters.';
      return;
    }
    statusLine.textContent = 'Searching…';
    fetch(searchUrlFromState(state))
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        // Ownership check AFTER the body has been parsed: a slow parse
        // must not let a superseded response repaint the current view.
        if (generation !== routeGeneration) return;
        renderSearchResult(state, result.ok, result.body);
      })
      .catch(function (error) {
        if (generation !== routeGeneration) return;
        clear(hitsList);
        clear(pager);
        clear(cautionLine);
        cautionLine.hidden = true;
        statusLine.textContent =
          'Request failed: ' + String(error && error.message ? error.message : error);
      });
  }

  /** The cells of one pipe row, with the escaped pipes unescaped. */
  function tableCells(line) {
    const trimmed = line.trim();
    if (trimmed.indexOf('|') === -1) return [];
    const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let current = '';
    for (let index = 0; index < inner.length; index += 1) {
      const char = inner.charAt(index);
      // A cell's own pipe is escaped by the parser; the separator row and
      // the cell boundary are not.
      if (char === '\\' && inner.charAt(index + 1) === '|') {
        current += '|';
        index += 1;
        continue;
      }
      if (char === '|') {
        cells.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  }

  /** True when the line is a markdown table row. */
  function isPipeRow(line) {
    return line.trim().indexOf('|') === 0;
  }

  /** True when the row is the table's separator (a row of dashes). */
  function isSeparatorRow(line) {
    const cells = tableCells(line);
    // The alignment colons are part of the dialect: the repository's own
    // table parser accepts `| :--- | ---: |`, so the renderer does too.
    return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
  }

  /**
   * True when the line at `index` starts a markdown table.
   *
   * A table is a header row and a separator row. A line that merely
   * begins with a pipe is a paragraph that happens to start with one, and
   * rendering it as a table would show a table with no body — and no way
   * to read what the line said.
   */
  function isTableStart(lines, index) {
    if (!isPipeRow(lines[index] ?? '')) return false;
    return isSeparatorRow(lines[index + 1] ?? '');
  }

  /** One markdown table, as a real table. */
  function renderTable(rows) {
    const table = el('table', 'rating-table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const cell of tableCells(rows[0] ?? '')) headRow.appendChild(el('th', '', cell));
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement('tbody');
    // The parser emits a separator row under the header; a table without one
    // has no row to skip.
    const bodyRows =
      rows.length > 1 && isSeparatorRow(rows[1] ?? '') ? rows.slice(2) : rows.slice(1);
    for (const line of bodyRows) {
      const row = document.createElement('tr');
      for (const cell of tableCells(line)) row.appendChild(el('td', '', cell));
      body.appendChild(row);
    }
    table.appendChild(body);
    return table;
  }

  /**
   * Render a provision's markdown into the DOM.
   *
   * A provision arrives in TWO renderings: `text` (pipe-joined rows with no
   * separator) and `markdown` (a real markdown table). The UI used the
   * first, so § 4.130's rating tables — the most-read provision for this
   * audience — came out as an unaligned run-on block that wrapped
   * unpredictably on a narrow screen. The structured rendering was already
   * in the payload; the UI just did not use it.
   *
   * This renders the three shapes the parser emits — headings, paragraphs
   * and tables — with `createElement` and `textContent`, like everything
   * else here, so the no-HTML-sink posture holds: regulatory text never
   * reaches one.
   */
  function renderMarkdown(container, markdown) {
    clear(container);
    // CRLF is one line break, not two: a carriage left at the end of a
    // heading is a character the reader sees.
    const lines = String(markdown === undefined || markdown === null ? '' : markdown).split(
      /\r?\n/,
    );
    let index = 0;
    while (index < lines.length) {
      const line = lines[index] ?? '';
      if (line.trim() === '') {
        index += 1;
        continue;
      }
      if (isTableStart(lines, index)) {
        index = renderTableBlock(container, lines, index);
        continue;
      }
      if (/^###\s/.test(line)) {
        container.appendChild(el('h3', '', line.replace(/^###\s+/, '')));
        index += 1;
        continue;
      }
      index = renderParagraphBlock(container, lines, index);
    }
  }

  /** The table at `index`, and the index of the first line after it. */
  function renderTableBlock(container, lines, index) {
    const rows = [];
    while (index < lines.length && isPipeRow(lines[index] ?? '')) {
      rows.push(lines[index] ?? '');
      index += 1;
    }
    container.appendChild(renderTable(rows));
    return index;
  }

  /** The paragraph at `index`, and the index of the first line after it. */
  function renderParagraphBlock(container, lines, index) {
    const paragraph = [];
    while (index < lines.length) {
      const next = lines[index] ?? '';
      if (next.trim() === '' || isTableStart(lines, index) || /^###\s/.test(next)) break;
      paragraph.push(next);
      index += 1;
    }
    if (paragraph.length > 0) container.appendChild(el('p', '', paragraph.join('\n')));
    return index;
  }

  function fillSection(section) {
    sectionHeading.textContent = String(section.heading);
    const crumbs = [];
    if (typeof section.kind === 'string') crumbs.push(section.kind);
    if (typeof section.chapter === 'string' && section.chapter !== '') {
      crumbs.push('Chapter ' + section.chapter);
    }
    if (typeof section.part === 'string' && section.part !== '')
      crumbs.push('Part ' + section.part);
    if (typeof section.subpart === 'string' && section.subpart !== '') {
      crumbs.push('Subpart ' + section.subpart);
    }
    if (typeof section.path === 'string' && section.path !== '') crumbs.push(section.path);
    sectionPath.textContent = crumbs.join(' › ');
    let meta = 'Issue date: ' + String(section.issueDate);
    if (section.indexStale === true) meta += ' — index stale';
    sectionMeta.textContent = meta;
    if (typeof section.notice === 'string' && section.notice !== '') {
      sectionMeta.appendChild(document.createTextNode(' — ' + section.notice));
    }
    // The markdown is the structured rendering — the one with the rating
    // tables intact. The text is the fallback, for a payload that does not
    // carry it. A markdown body that is only whitespace carries nothing
    // either, and the text is what the reader should see.
    const markdown = typeof section.markdown === 'string' ? section.markdown : '';
    renderMarkdown(sectionText, markdown.trim() === '' ? String(section.text) : markdown);
    fillCitationBlock(section);
    fillReferences(section);
    fillCitedBy(section);
  }

  /**
   * The provisions this one cites. A link when the provision is in this
   * copy; when it is not, the citation marked "not in this copy" — which
   * says what is true: the provision is not in THIS index. "not indexed"
   * reads as "this does not exist", which is a different claim — a section
   * can be in the CFR and missing from this copy. The pilot protocol
   * records this wording as the reason a participant has to make the
   * tool's inference for it.
   */
  function fillReferences(section) {
    const references = Array.isArray(section.references) ? section.references : [];
    for (let i = 0; i < references.length; i += 1) {
      const reference = references[i];
      const item = document.createElement('li');
      if (reference.available === true) {
        appendCitationLink(item, String(reference.citation));
      } else {
        item.textContent = String(reference.citation) + ' (not in this copy)';
      }
      sectionReferences.appendChild(item);
    }
    if (references.length === 0) sectionReferences.appendChild(el('li', '', 'None indexed.'));
  }

  /** The provisions that cite this one. */
  function fillCitedBy(section) {
    const citedBy = Array.isArray(section.citedBy) ? section.citedBy : [];
    for (let j = 0; j < citedBy.length; j += 1) {
      const backItem = document.createElement('li');
      appendCitationLink(backItem, String(citedBy[j]));
      sectionCitedBy.appendChild(backItem);
    }
    if (citedBy.length === 0) sectionCitedBy.appendChild(el('li', '', 'None indexed.'));
  }

  /**
   * The M5 copy block: the citation, heading, source date, the DATED
   * verification URL (the revision this text came from), and — when the
   * text carries an image marker — an explicit incompleteness warning, so
   * a copied citation can never imply complete coverage. Keyboard-reachable
   * button; the block is also shown in a readonly textarea, so it works
   * without clipboard permission.
   */
  function fillCitationBlock(section) {
    const citation = String(section.citation);
    const kind = String(section.kind);
    const display = kind === 'appendix' ? citation : '38 C.F.R. § ' + citation;
    const lines = [];
    lines.push(display);
    if (typeof section.heading === 'string' && section.heading !== '') {
      lines.push(section.heading);
    }
    lines.push('Source: 38 CFR ' + citation + ' (issue date ' + String(section.issueDate) + ')');
    if (typeof section.sourceUrlAtIndexDate === 'string' && section.sourceUrlAtIndexDate !== '') {
      lines.push('Verify at the indexed revision: ' + section.sourceUrlAtIndexDate);
    }
    const body = String(section.text);
    if (body.indexOf('[image content not included:') !== -1) {
      lines.push(
        'NOTE: this provision contains graphic content (rating tables) that is NOT included in this text — verify the rating table at eCFR.',
      );
    }
    citationBlock.value = lines.join('\n');
  }

  copyButton.addEventListener('click', function () {
    const text = citationBlock.value;
    const clipboard = navigator.clipboard;
    if (clipboard !== undefined && clipboard.writeText !== undefined) {
      // The write can REJECT (blocked permission, non-secure context); an
      // unhandled rejection would surface as a console error and no
      // feedback, so both outcomes report honestly.
      clipboard.writeText(text).then(
        function () {
          copyStatus.textContent = 'Copied — the block below is also selectable.';
        },
        function () {
          copyStatus.textContent = 'Copy was blocked — select the block below and copy it.';
        },
      );
    } else {
      copyStatus.textContent = 'Select the block below and copy it (clipboard unavailable).';
    }
  });

  function renderSection(citation, generation) {
    searchView.hidden = true;
    sectionView.hidden = false;
    browseView.hidden = true;
    clearRedline();
    clear(sectionReferences);
    clear(sectionCitedBy);
    clear(sectionText);
    sectionError.textContent = '';
    sectionHeading.textContent = citation;
    sectionPath.textContent = '';
    sectionMeta.textContent = '';
    if (citation === '') {
      sectionError.textContent = 'No citation given — use #/section/<citation> or search above.';
      return;
    }
    fetch('/api/v1/sections/' + encodeURIComponent(citation))
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (generation !== routeGeneration) return;
        if (!result.ok || typeof result.body.error === 'string') {
          sectionError.textContent =
            'Failed to load ' +
            citation +
            ': ' +
            plainErrorMessage(result.body.error, result.body.message);
          return;
        }
        fillSection(result.body);
      })
      .catch(function (error) {
        if (generation !== routeGeneration) return;
        sectionError.textContent =
          'Request failed: ' + String(error && error.message ? error.message : error);
      });
  }

  // ---- #/browse: lazy chapter/part/subpart/subject-group tree over /api/v1/browse ----

  /** Node text: the entry's label, or a "type: identifier" fallback. */
  function browseLabel(entry) {
    const label = typeof entry.label === 'string' ? entry.label : '';
    if (label !== '') return label;
    return String(entry.type) + ': ' + String(entry.identifier);
  }

  /** URL for one browse level; omitted levels mean "stop here". */
  function browseUrl(level) {
    const params = new URLSearchParams();
    if (level.chapter !== '') params.set('chapter', level.chapter);
    if (level.part !== '') params.set('part', level.part);
    if (level.subpart !== '') params.set('subpart', level.subpart);
    if (level.subjgrp !== '') params.set('subjgrp', level.subjgrp);
    const query = params.toString();
    return '/api/v1/browse' + (query === '' ? '' : '?' + query);
  }

  /** The next level reached by opening 'entry' from 'parent'. */
  function childLevel(parent, entry) {
    const type = String(entry.type);
    const next = {
      chapter: parent.chapter,
      part: parent.part,
      subpart: parent.subpart,
      subjgrp: parent.subjgrp,
    };
    if (type === 'chapter') next.chapter = String(entry.identifier);
    else if (type === 'part') next.part = String(entry.identifier);
    else if (type === 'subpart') next.subpart = String(entry.identifier);
    else if (type === 'subject_group') next.subjgrp = String(entry.identifier);
    return next;
  }

  function appendBrowseEntry(item, entry, level) {
    const type = String(entry.type);
    const text = browseLabel(entry);
    if (type === 'section' || type === 'appendix') {
      // Leaf-linking rule: both identifiers are citations the reader route
      // accepts — appendix identifiers are full citations ("Appendix A to
      // Part 4"), section identifiers bare citations ("18.1").
      const leaf = document.createElement('a');
      leaf.href = sectionHref(String(entry.identifier));
      leaf.textContent = text;
      item.appendChild(leaf);
      return;
    }
    // A subject group is a DESCENDABLE level: its sections are the ones the
    // flat tree could not reach (1,910 of the corpus's 2,953 sections), so the
    // row opens them instead of rendering as inert text.
    if (type === 'chapter' || type === 'part' || type === 'subpart' || type === 'subject_group') {
      const nav = document.createElement('button');
      nav.type = 'button';
      nav.textContent = text;
      nav.addEventListener('click', function () {
        // A click is not a navigation, but the level it starts must still
        // belong to the CURRENT route: a click after the user left the
        // browse view must not push a level or paint the tree.
        loadBrowseLevel(childLevel(level, entry), routeGeneration);
      });
      item.appendChild(nav);
      return;
    }
    // Any other type (a level the wire cannot descend into): entries are flat
    // {type, identifier, label} — no deeper fetch exists, so the row renders
    // expanded in place: label only, no link, no request, no dead end.
    item.textContent = text;
  }

  /** Breadcrumb from the deepest response's path; back-links restore the stack. */
  function renderBrowseCrumbs(levels) {
    clear(browseCrumbs);
    const deepest = levels[levels.length - 1];
    // path includes the deepest node as its last entry, and levels[0].node is
    // the root the path never contains — so crumbs[i] always maps to levels[i].
    const entries = [levels[0].result.node].concat(deepest.result.path);
    for (let i = 0; i < entries.length; i += 1) {
      if (i > 0) browseCrumbs.appendChild(document.createTextNode(' › '));
      const text = browseLabel(entries[i]);
      if (i === entries.length - 1) {
        browseCrumbs.appendChild(el('span', 'crumb-current', text));
        continue;
      }
      const back = document.createElement('a');
      back.href = '#/browse';
      back.textContent = text;
      back.addEventListener(
        'click',
        (function (index) {
          return function (event) {
            // Back-links pop the cached stack — they never trigger a fetch.
            event.preventDefault();
            browseLevels = browseLevels.slice(0, index + 1);
            renderBrowseLevel();
          };
        })(i),
      );
      browseCrumbs.appendChild(back);
    }
  }

  /** Render the deepest cached level: node heading, breadcrumb, children list. */
  function renderBrowseLevel() {
    const level = browseLevels[browseLevels.length - 1];
    clear(browseError);
    clear(browseList);
    browseHeading.textContent = browseLabel(level.result.node);
    renderBrowseCrumbs(browseLevels);
    const children = Array.isArray(level.result.children) ? level.result.children : [];
    if (children.length === 0) {
      browseList.appendChild(el('li', '', 'No children at this level.'));
      return;
    }
    for (let i = 0; i < children.length; i += 1) {
      const item = document.createElement('li');
      appendBrowseEntry(item, children[i], level);
      browseList.appendChild(item);
    }
  }

  function showBrowseError(message) {
    if (browseLevels.length > 0) renderBrowseLevel();
    else browseHeading.textContent = '';
    browseError.textContent = message;
  }

  /** Fetch one level (root first) and push it onto the navigation stack. */
  function loadBrowseLevel(level, generation) {
    clear(browseError);
    clear(browseCrumbs);
    clear(browseList);
    browseHeading.textContent = 'Loading…';
    fetch(browseUrl(level))
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (generation !== routeGeneration) return;
        if (!result.ok || typeof result.body.error === 'string') {
          showBrowseError(
            'Browse failed: ' + plainErrorMessage(result.body.error, result.body.message),
          );
          return;
        }
        browseLevels.push({
          chapter: level.chapter,
          part: level.part,
          subpart: level.subpart,
          subjgrp: level.subjgrp,
          result: result.body,
        });
        renderBrowseLevel();
      })
      .catch(function (error) {
        if (generation !== routeGeneration) return;
        showBrowseError(
          'Request failed: ' + String(error && error.message ? error.message : error),
        );
      });
  }

  function renderBrowse(generation) {
    searchView.hidden = true;
    sectionView.hidden = true;
    browseView.hidden = false;
    clearRedline();
    if (browseLevels.length > 0) {
      renderBrowseLevel();
      return;
    }
    loadBrowseLevel({ chapter: '', part: '', subpart: '', subjgrp: '' }, generation);
  }

  searchForm.addEventListener('submit', function (event) {
    event.preventDefault();
    window.location.hash = hashForSearch({
      view: 'search',
      q: qInput.value.trim(),
      kind: kindSelect.value,
      part: partInput.value.trim(),
      chapter: chapterInput.value.trim(),
      page: 1,
      perPage: clampInt(perPageSelect.value, 10, 20),
    });
  });

  /**
   * Move the keyboard to the view that just opened.
   *
   * The heading takes the focus, and it takes it WITHOUT becoming a tab
   * stop: `tabindex="-1"` makes an element focusable on demand without
   * putting it in the tab order.
   */
  function moveFocusTo(view) {
    const target = byId(VIEW_HEADINGS[view]);
    if (target === null || typeof target.focus !== 'function') return;
    target.focus();
  }

  /**
   * Say which view opened.
   *
   * The live region carries the change of view, because a screen-reader
   * user gets no other signal that the page they were on is gone.
   */
  function announceView(view) {
    if (announcer === null) return;
    announcer.textContent = VIEW_LABELS[view] || '';
  }

  function renderRoute() {
    // Route ownership: every navigation (including an empty search, the
    // browse tree and a repeat of the same route) invalidates the work
    // started by the previous one. A response may only touch the DOM while
    // its generation is still the current one — a late success, a late
    // error or a late body parse must never repaint a view the user has
    // already left (review finding P1-02).
    routeGeneration += 1;
    const generation = routeGeneration;
    const state = parseHash();
    if (state.view === 'section') renderSection(state.citation, generation);
    else if (state.view === 'browse') renderBrowse(generation);
    else if (state.view === 'redline') renderRedline();
    else renderSearch(state, generation);
    // The keyboard follows the view. The focused element was inside the
    // view that was just hidden, so focus fell back to the body: a keyboard
    // or screen-reader user was dumped at the top of the document with no
    // announcement of the new view and nowhere to go next.
    //
    // Only when the VIEW changed: the first render is not a navigation, and
    // a second search on the same view updates in place — moving the
    // keyboard there would take it away from the field being typed in.
    if (lastView !== null && lastView !== state.view) {
      moveFocusTo(state.view);
      announceView(state.view);
    }
    lastView = state.view;
  }

  window.addEventListener('hashchange', renderRoute);
  renderRoute();
})();
