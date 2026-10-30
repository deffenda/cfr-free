/**
 * Read-only web UI assets.
 *
 * The HTML shell is a string constant; the page script and the stylesheet
 * are real files — `ui-client.js` and `ui-client.css`, served at `/ui.js`
 * and `/ui.css`. (The file names differ from the routes on purpose: the
 * compiled `ui.ts` is itself `ui.js` next to them.) They are files rather
 * than string constants so that eslint
 * and prettier can reach them: as a `String.raw` template literal, 840
 * lines of browser JavaScript sat inside a TypeScript string where no
 * linter, no formatter and no type-checker in the gate could see them. A
 * malformed probe — an `==` comparison, an unused variable, a `debugger`
 * statement — passed the whole gate unnoticed.
 *
 * `tsc` compiles TypeScript and copies no other file, so the build copies
 * these two into `dist/` next to this module (`scripts/copy-assets.mjs`).
 * The server reads them from the same directory at startup, which is
 * `src/titan/` in development and `dist/titan/` once built.
 *
 * `http-server.ts` serves them at `/` (HTML), `/ui.js`, and `/ui.css`; the
 * page talks to the same JSON API a curl client would (`/api/v1/search`,
 * `/api/v1/sections/…`).
 *
 * Security posture (pinned by test/http-server.test.ts):
 * - Zero inline script and zero inline handlers: the HTML references
 *   `/ui.js`/`/ui.css` as separate GET routes and the server sends a
 *   `default-src 'none'`-class CSP on the HTML response, so any injection
 *   that smuggled a tag or attribute past the static posture checks could
 *   still not execute.
 * - The client JS builds every dynamic node with `createElement` +
 *   `textContent`; server-provided regulatory text (snippets, headings,
 *   citations, section text) is never assigned to HTML sinks (`innerHTML`,
 *   `outerHTML`, …), so the UI cannot become an HTML-injection vector for
 *   index content.
 * - No frameworks, no CDN links, no external fonts, no storage/session use.
 */
import { readFileSync } from 'node:fs';

/** CSP sent with the HTML shell (and HEAD twin) at `/`. Subresource routes (`/ui.js`, `/ui.css`) deliberately send no CSP of their own: a policy on a stylesheet/script response would only apply if that resource were rendered as a document, which the UI never does. */
export const UI_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

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
    <a class="skip-link" href="#main">Skip to the main content</a>
    <header class="site-header">
      <h1><a href="#/search">cfr-free</a></h1>
      <p>Read-only search over the local Title 38 CFR index.</p>
      <nav class="site-tabs" aria-label="Views">
        <a href="#/search">Search</a>
        <a href="#/browse">Browse</a>
        <a href="#/redline">Redline</a>
      </nav>
    </header>
    <noscript>
      <p>This page needs JavaScript. The JSON API stays available at /api/v1/… without it.</p>
    </noscript>
    <main id="main">
      <p id="view-announcer" class="visually-hidden" role="status" aria-live="polite"></p>
      <section id="search-view">
        <h2 id="search-heading" class="visually-hidden">Search</h2>
        <form id="search-form">
          <label for="q">Search</label>
          <input id="q" name="q" type="search" autocomplete="off" />
          <label for="kind">Kind</label>
          <select id="kind" name="kind">
            <option value="">any</option>
            <option value="section">section</option>
            <option value="appendix">appendix</option>
          </select>
          <label for="part">Part</label>
          <input id="part" name="part" type="text" inputmode="numeric" autocomplete="off"
                 pattern="[0-9]{1,3}" maxlength="3" title="The CFR part number, for example 4"
                 placeholder="e.g. 4" />
          <label for="chapter">Chapter</label>
          <input id="chapter" name="chapter" type="text" autocomplete="off"
                 pattern="[IVXLCDM]{1,8}" maxlength="8"
                 title="The chapter as a Roman numeral, for example IV" placeholder="e.g. I" />
          <label for="per-page">Per page</label>
          <select id="per-page" name="per_page">
            <option value="10">10</option>
            <option value="20">20</option>
          </select>
          <button type="submit">Search</button>
        </form>
        <p id="search-status" role="status"></p>
        <p id="search-caution" role="note" hidden></p>
        <ul id="search-hits" class="hits"></ul>
        <nav id="search-pager" aria-label="Pagination"></nav>
      </section>
      <section id="section-view" hidden>
        <p id="section-back"><a href="#/search">Back to search</a></p>
        <p id="section-error" role="status"></p>
        <h2 id="section-heading" tabindex="-1"></h2>
        <p id="section-path" class="breadcrumb"></p>
        <p id="section-meta" class="breadcrumb"></p>
        <p id="section-copy"><button type="button" id="copy-citation">Copy citation</button>
          <span id="copy-status" role="status"></span></p>
        <textarea id="citation-block" rows="6" readonly tabindex="-1"
                  aria-label="Citation block to copy"></textarea>
        <blockquote id="section-text"></blockquote>
        <h3>References</h3>
        <ul id="section-references"></ul>
        <h3>Cited by</h3>
        <ul id="section-citedby"></ul>
      </section>
      <section id="browse-view" hidden>
        <p id="browse-error" role="status"></p>
        <nav id="browse-crumbs" class="breadcrumb" aria-label="Breadcrumb"></nav>
        <h2 id="browse-heading" tabindex="-1"></h2>
        <ul id="browse-list"></ul>
      </section>
      <section id="redline-view" hidden>
        <form id="redline-form">
          <label for="redline-from">From date</label>
          <input id="redline-from" name="from" type="text" inputmode="numeric" autocomplete="off" placeholder="2026-01-01" />
          <label for="redline-to">To date</label>
          <input id="redline-to" name="to" type="text" inputmode="numeric" autocomplete="off" placeholder="2026-06-01" />
          <label for="redline-citation">Citation</label>
          <input id="redline-citation" name="citation" type="text" autocomplete="off" placeholder="4.130" />
          <button type="submit">Show redline</button>
        </form>
        <p id="redline-error" role="status"></p>
        <h2 id="redline-heading" tabindex="-1"></h2>
        <p id="redline-meta" class="breadcrumb"></p>
        <pre id="redline-output" aria-label="Line-level redline"></pre>
      </section>
    </main>
    <script src="/ui.js"></script>
  </body>
</html>
`;

/**
 * Read an asset that sits beside this module — `src/titan/` in
 * development, `dist/titan/` in a build.
 */
function readAsset(name: string): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

/** The page script, served at `/ui.js` as `text/javascript`. */
export const UI_JS = readAsset('ui-client.js');

/** The stylesheet, served at `/ui.css` as `text/css`. */
export const UI_CSS = readAsset('ui-client.css');
