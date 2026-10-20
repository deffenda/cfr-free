/**
 * Read-only web UI assets, embedded as string constants.
 *
 * The tsc build lands these in dist/ with the rest of the sources — no
 * asset-copy step, no bundler, no external dependency. `http-server.ts`
 * serves them at `/` (HTML), `/ui.js`, and `/ui.css`; the page talks to the
 * same JSON API a curl client would (`/api/v1/search`, `/api/v1/sections/…`).
 *
 * Security posture (pinned by test/http-server.test.ts):
 * - Zero inline script and zero inline handlers: the HTML references
 *   `/ui.js`/`/ui.css` as separate GET routes and the server sends a
 *   `default-src 'none'`-class CSP on the HTML response, so any injection
 *   that smuggled a tag or attribute past the static posture checks could
 *   still not execute.
 * - The client JS builds every dynamic node with `createElement` +
 *   `textContent`; server-provided regulatory text (snippets, headings,
 *   citations, section text) is never assigned to `innerHTML`/`outerHTML`,
 *   so the UI cannot become an HTML-injection vector for index content.
 * - No frameworks, no CDN links, no external fonts, no storage/session use.
 */

/** CSP sent with the HTML shell (and HEAD twin) at `/`. Subresource routes (`/ui.js`, `/ui.css`) deliberately send no CSP of their own: a policy on a stylesheet/script response would only apply if that resource were rendered as a document, which the UI never does. */
export const UI_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** The single-page HTML shell: static structure only, no dynamic content. */
export const UI_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>cfr-free — Title 38 CFR search</title>
    <link rel="stylesheet" href="/ui.css" />
  </head>
  <body>
    <header class="site-header">
      <h1><a href="#/search">cfr-free</a></h1>
      <p>Read-only search over the local Title 38 CFR index.</p>
    </header>
    <noscript>
      <p>This page needs JavaScript. The JSON API stays available at /api/v1/… without it.</p>
    </noscript>
    <main id="main">
      <section id="search-view">
        <form id="search-form">
          <label for="q">Search</label>
          <input id="q" name="q" type="search" autocomplete="off" />
          <label for="kind">Kind</label>
          <select id="kind" name="kind">
            <option value="">any</option>
            <option value="section">section</option>
            <option value="appendix">appendix</option>
          </select>
          <label for="chapter">Chapter</label>
          <input id="chapter" name="chapter" type="text" placeholder="e.g. I" />
          <label for="per-page">Per page</label>
          <select id="per-page" name="per_page">
            <option value="10">10</option>
            <option value="20">20</option>
          </select>
          <button type="submit">Search</button>
        </form>
        <p id="search-status" role="status"></p>
        <ul id="search-hits" class="hits"></ul>
        <nav id="search-pager" aria-label="Pagination"></nav>
      </section>
      <section id="section-view" hidden>
        <p id="section-back"><a href="#/search">Back to search</a></p>
        <p id="section-error" role="status"></p>
        <h2 id="section-heading"></h2>
        <p id="section-path" class="breadcrumb"></p>
        <p id="section-meta" class="breadcrumb"></p>
        <blockquote id="section-text"></blockquote>
        <h3>References</h3>
        <ul id="section-references"></ul>
        <h3>Cited by</h3>
        <ul id="section-citedby"></ul>
      </section>
    </main>
    <script src="/ui.js"></script>
  </body>
</html>
`;

/**
 * The page script, served at `/ui.js` as `text/javascript`.
 *
 * String.raw keeps the regex escapes (`\p{L}`) intact; the code deliberately
 * contains no backticks or `\${` so the raw template stays literal. Written
 * in ES5-flavored style (var, string concatenation) — it runs in whatever
 * browser the operator opens, not in Node.
 */
export const UI_JS = String.raw`(function () {
  'use strict';

  function byId(id) {
    return document.getElementById(id);
  }

  function clear(node) {
    while (node.firstChild !== null) node.removeChild(node.firstChild);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className !== '') node.className = className;
    if (text !== '') node.textContent = text;
    return node;
  }

  var searchView = byId('search-view');
  var sectionView = byId('section-view');
  var searchForm = byId('search-form');
  var qInput = byId('q');
  var kindSelect = byId('kind');
  var chapterInput = byId('chapter');
  var perPageSelect = byId('per-page');
  var statusLine = byId('search-status');
  var hitsList = byId('search-hits');
  var pager = byId('search-pager');
  var sectionError = byId('section-error');
  var sectionHeading = byId('section-heading');
  var sectionPath = byId('section-path');
  var sectionMeta = byId('section-meta');
  var sectionText = byId('section-text');
  var sectionReferences = byId('section-references');
  var sectionCitedBy = byId('section-citedby');

  function clampInt(raw, fallback, max) {
    var value = parseInt(raw === null ? '' : raw, 10);
    if (!isFinite(value) || value < 1) return fallback;
    if (max !== null && value > max) return max;
    return value;
  }

  function parseHash() {
    var hash = window.location.hash;
    var sectionPrefix = '#/section/';
    if (hash.indexOf(sectionPrefix) === 0) {
      var raw = hash.slice(sectionPrefix.length);
      var citation = raw;
      try {
        citation = decodeURIComponent(raw);
      } catch (error) {
        citation = raw;
      }
      return { view: 'section', citation: citation };
    }
    var rest = hash.indexOf('#/search') === 0 ? hash.slice('#/search'.length) : '';
    if (rest.charAt(0) === '?') rest = rest.slice(1);
    var params = new URLSearchParams(rest);
    return {
      view: 'search',
      q: params.get('q') === null ? '' : params.get('q'),
      kind: params.get('kind') === null ? '' : params.get('kind'),
      chapter: params.get('chapter') === null ? '' : params.get('chapter'),
      page: clampInt(params.get('page'), 1, 10000),
      perPage: clampInt(params.get('per_page'), 10, 20),
    };
  }

  function hashForSearch(state) {
    var params = new URLSearchParams();
    if (state.q !== '') params.set('q', state.q);
    if (state.kind === 'section' || state.kind === 'appendix') params.set('kind', state.kind);
    if (state.chapter !== '') params.set('chapter', state.chapter);
    if (state.page > 1) params.set('page', String(state.page));
    if (state.perPage !== 10) params.set('per_page', String(state.perPage));
    var query = params.toString();
    return '#/search' + (query === '' ? '' : '?' + query);
  }

  function withPage(state, page) {
    return {
      view: 'search',
      q: state.q,
      kind: state.kind,
      chapter: state.chapter,
      page: page,
      perPage: state.perPage,
    };
  }

  function searchUrlFromState(state) {
    var params = new URLSearchParams();
    params.set('q', state.q);
    if (state.kind === 'section' || state.kind === 'appendix') params.set('kind', state.kind);
    if (state.chapter !== '') params.set('chapter', state.chapter);
    params.set('page', String(state.page));
    params.set('per_page', String(state.perPage));
    return '/api/v1/search?' + params.toString();
  }

  function sectionHref(citation) {
    return '#/section/' + encodeURIComponent(citation);
  }

  function appendCitationLink(listItem, citation) {
    var link = document.createElement('a');
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
    var lower = text.toLowerCase();
    var ranges = [];
    for (var i = 0; i < matches.length; i += 1) {
      var token = String(matches[i]).toLowerCase();
      if (token === '') continue;
      var from = 0;
      for (;;) {
        var at = lower.indexOf(token, from);
        if (at === -1) break;
        if (!isWordChar(lower.charAt(at - 1))) ranges.push([at, at + token.length]);
        from = at + token.length;
      }
    }
    ranges.sort(function (left, right) {
      return left[0] - right[0] || left[1] - right[1];
    });
    var merged = [];
    for (var r = 0; r < ranges.length; r += 1) {
      var range = ranges[r];
      var last = merged[merged.length - 1];
      if (last !== undefined && range[0] <= last[1]) {
        if (range[1] > last[1]) last[1] = range[1];
      } else {
        merged.push([range[0], range[1]]);
      }
    }
    var cursor = 0;
    for (var m = 0; m < merged.length; m += 1) {
      var span = merged[m];
      if (span[0] > cursor) {
        container.appendChild(document.createTextNode(text.slice(cursor, span[0])));
      }
      var mark = document.createElement('mark');
      mark.textContent = text.slice(span[0], span[1]);
      container.appendChild(mark);
      cursor = span[1];
    }
    if (cursor < text.length) {
      container.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  function appendHit(hit) {
    var item = document.createElement('li');
    item.className = 'hit';
    var heading = document.createElement('h3');
    var link = document.createElement('a');
    link.href = sectionHref(String(hit.citation));
    var label =
      hit.citationDisplay === undefined || hit.citationDisplay === null || hit.citationDisplay === ''
        ? String(hit.citation)
        : String(hit.citationDisplay);
    link.textContent = label;
    heading.appendChild(link);
    if (hit.direct === true) heading.appendChild(el('span', 'badge', 'direct hit'));
    item.appendChild(heading);
    var part = hit.part === null || hit.part === undefined ? '' : ' — part ' + String(hit.part);
    item.appendChild(el('p', 'hit-meta', String(hit.heading) + part));
    var snippet = el('p', 'hit-snippet', '');
    markMatches(snippet, String(hit.snippet), Array.isArray(hit.matches) ? hit.matches : []);
    item.appendChild(snippet);
    hitsList.appendChild(item);
  }

  function renderPager(state, total) {
    var pages = Math.max(1, Math.ceil(total / state.perPage));
    pager.appendChild(
      el('p', 'pager-info', 'Page ' + state.page + ' of ' + pages + ' (' + total + ' hits)'),
    );
    var previous = document.createElement('button');
    previous.type = 'button';
    previous.textContent = 'Previous page';
    previous.disabled = state.page <= 1;
    previous.addEventListener('click', function () {
      window.location.hash = hashForSearch(withPage(state, state.page - 1));
    });
    var next = document.createElement('button');
    next.type = 'button';
    next.textContent = 'Next page';
    next.disabled = state.page >= pages;
    next.addEventListener('click', function () {
      window.location.hash = hashForSearch(withPage(state, state.page + 1));
    });
    pager.appendChild(previous);
    pager.appendChild(next);
  }

  function renderSearchResult(state, ok, body) {
    clear(hitsList);
    clear(pager);
    if (!ok || typeof body.error === 'string') {
      statusLine.textContent =
        'Search failed (' + String(body.error) + '): ' + String(body.message);
      return;
    }
    var total = typeof body.total === 'number' ? body.total : 0;
    var notice = typeof body.notice === 'string' ? body.notice : '';
    statusLine.textContent =
      total +
      ' hit' +
      (total === 1 ? '' : 's') +
      ' — page ' +
      String(body.page) +
      ', match mode ' +
      String(body.matchMode) +
      (notice === '' ? '' : ' — ' + notice);
    var hits = Array.isArray(body.hits) ? body.hits : [];
    for (var i = 0; i < hits.length; i += 1) appendHit(hits[i]);
    renderPager(state, total);
  }

  function renderSearch(state) {
    searchView.hidden = false;
    sectionView.hidden = true;
    qInput.value = state.q;
    kindSelect.value = state.kind === 'section' || state.kind === 'appendix' ? state.kind : '';
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
        renderSearchResult(state, result.ok, result.body);
      })
      .catch(function (error) {
        clear(hitsList);
        clear(pager);
        statusLine.textContent =
          'Request failed: ' + String(error && error.message ? error.message : error);
      });
  }

  function fillSection(section) {
    sectionHeading.textContent = String(section.heading);
    var crumbs = [];
    if (typeof section.kind === 'string') crumbs.push(section.kind);
    if (typeof section.chapter === 'string' && section.chapter !== '') {
      crumbs.push('Chapter ' + section.chapter);
    }
    if (typeof section.part === 'string' && section.part !== '') crumbs.push('Part ' + section.part);
    if (typeof section.subpart === 'string' && section.subpart !== '') {
      crumbs.push('Subpart ' + section.subpart);
    }
    if (typeof section.path === 'string' && section.path !== '') crumbs.push(section.path);
    sectionPath.textContent = crumbs.join(' › ');
    var meta = 'Issue date: ' + String(section.issueDate);
    if (section.indexStale === true) meta += ' — index stale';
    sectionMeta.textContent = meta;
    if (typeof section.notice === 'string' && section.notice !== '') {
      sectionMeta.appendChild(document.createTextNode(' — ' + section.notice));
    }
    sectionText.textContent = String(section.text);
    var references = Array.isArray(section.references) ? section.references : [];
    for (var i = 0; i < references.length; i += 1) {
      var reference = references[i];
      var item = document.createElement('li');
      if (reference.available === true) {
        appendCitationLink(item, String(reference.citation));
      } else {
        item.textContent = String(reference.citation) + ' (not indexed)';
      }
      sectionReferences.appendChild(item);
    }
    if (references.length === 0) sectionReferences.appendChild(el('li', '', 'None indexed.'));
    var citedBy = Array.isArray(section.citedBy) ? section.citedBy : [];
    for (var j = 0; j < citedBy.length; j += 1) {
      var backItem = document.createElement('li');
      appendCitationLink(backItem, String(citedBy[j]));
      sectionCitedBy.appendChild(backItem);
    }
    if (citedBy.length === 0) sectionCitedBy.appendChild(el('li', '', 'None indexed.'));
  }

  function renderSection(citation) {
    searchView.hidden = true;
    sectionView.hidden = false;
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
        if (!result.ok || typeof result.body.error === 'string') {
          sectionError.textContent =
            'Failed to load ' +
            citation +
            ' (' +
            String(result.body.error) +
            '): ' +
            String(result.body.message);
          return;
        }
        fillSection(result.body);
      })
      .catch(function (error) {
        sectionError.textContent =
          'Request failed: ' + String(error && error.message ? error.message : error);
      });
  }

  searchForm.addEventListener('submit', function (event) {
    event.preventDefault();
    window.location.hash = hashForSearch({
      view: 'search',
      q: qInput.value.trim(),
      kind: kindSelect.value,
      chapter: chapterInput.value.trim(),
      page: 1,
      perPage: clampInt(perPageSelect.value, 10, 20),
    });
  });

  function renderRoute() {
    var state = parseHash();
    if (state.view === 'section') renderSection(state.citation);
    else renderSearch(state);
  }

  window.addEventListener('hashchange', renderRoute);
  renderRoute();
})();
`;

/** The stylesheet, served at `/ui.css` as `text/css`. */
export const UI_CSS = `:root {
  color-scheme: light dark;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0 auto;
  padding: 1rem;
  max-width: 52rem;
  font: 16px/1.5 system-ui, sans-serif;
  color: #1b1b1b;
  background: #ffffff;
}

@media (prefers-color-scheme: dark) {
  body {
    color: #ededed;
    background: #171717;
  }

  a {
    color: #8ab4f8;
  }

  .badge {
    background: #1f3a5f;
  }

  mark {
    color: #1b1b1b;
  }
}

a {
  color: #0b57d0;
}

.site-header h1 {
  margin: 0 0 0.25rem;
  font-size: 1.4rem;
}

.site-header h1 a {
  color: inherit;
  text-decoration: none;
}

form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
  margin-bottom: 1rem;
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.85rem;
}

input,
select,
button {
  font: inherit;
  padding: 0.35rem 0.5rem;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: default;
  opacity: 0.5;
}

.hits {
  padding-left: 0;
  list-style: none;
}

.hit {
  margin-bottom: 1.25rem;
}

.hit h3 {
  margin: 0 0 0.15rem;
  font-size: 1.05rem;
}

.hit-meta {
  margin: 0 0 0.25rem;
  font-size: 0.85rem;
}

.hit-snippet {
  margin: 0;
}

.badge {
  margin-left: 0.5rem;
  padding: 0.05rem 0.4rem;
  border-radius: 0.3rem;
  background: #e2edfb;
  font-size: 0.75rem;
}

mark {
  background: #ffe08a;
  color: #1b1b1b;
}

.breadcrumb {
  margin: 0.15rem 0;
  font-size: 0.85rem;
}

blockquote {
  margin: 1rem 0;
  padding: 0.5rem 1rem;
  border-left: 4px solid #b9b9b9;
  white-space: pre-wrap;
}

.pager-info {
  margin: 0.5rem 0;
}
`;
