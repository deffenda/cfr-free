/**
 * Interactive developer playground served at `/playground`.
 *
 * Provides a zero-config visual sandbox for vibe coders to test clinical semantic
 * search, compute 38 C.F.R. § 4.25 VA Math combined ratings, and copy pre-built
 * Tailwind & React components.
 */

export const PLAYGROUND_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export const PLAYGROUND_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>cfr-free — Vibe Coder Playground</title>
    <style>
      :root {
        --bg: #0f172a;
        --card: #1e293b;
        --border: #334155;
        --text: #f8fafc;
        --muted: #94a3b8;
        --primary: #3b82f6;
        --primary-hover: #2563eb;
        --badge: #1e3a8a;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: var(--bg);
        color: var(--text);
        padding: 2rem 1rem;
        line-height: 1.5;
      }
      .container { max-width: 900px; margin: 0 auto; }
      header { margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
      h1 { font-size: 1.75rem; font-weight: 700; }
      .lead { color: var(--muted); font-size: 0.95rem; margin-top: 0.25rem; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
      .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 0.75rem;
        padding: 1.5rem;
      }
      .card h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
      label { display: block; font-size: 0.85rem; font-weight: 500; color: var(--muted); margin-bottom: 0.5rem; }
      input[type="text"], input[type="search"] {
        width: 100%;
        background: #0b1120;
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        color: var(--text);
        padding: 0.75rem 1rem;
        font-size: 0.95rem;
      }
      input:focus { outline: 2px solid var(--primary); }
      .row { display: flex; gap: 0.75rem; margin-top: 0.75rem; }
      button {
        background: var(--primary);
        color: #fff;
        border: none;
        border-radius: 0.5rem;
        padding: 0.75rem 1.25rem;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
      }
      button:hover { background: var(--primary-hover); }
      .btn-secondary { background: #334155; }
      .btn-secondary:hover { background: #475569; }
      .result-box {
        background: #0b1120;
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        padding: 1rem;
        margin-top: 1rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.85rem;
        white-space: pre-wrap;
        color: #38bdf8;
      }
      .badge {
        display: inline-block;
        background: var(--badge);
        color: #93c5fd;
        padding: 0.2rem 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        font-weight: 600;
        margin-right: 0.5rem;
      }
      .preset-btn {
        background: transparent;
        border: 1px solid var(--border);
        color: var(--muted);
        padding: 0.25rem 0.5rem;
        font-size: 0.75rem;
      }
      .preset-btn:hover { background: #1e293b; color: #fff; }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <h1>⚡ cfr-free Vibe Playground</h1>
        <p class="lead">Interactive sandbox for AI agent developers, disability claims, and statutory Title 38 CFR data.</p>
      </header>

      <div class="grid">
        <!-- VA Math Combined Ratings Calculator -->
        <section class="card">
          <h2>🧮 VA Math Combined Ratings Calculator (38 C.F.R. § 4.25)</h2>
          <p class="lead">Non-linear whole person disability rating algorithm.</p>
          <div style="margin-top: 1rem;">
            <label for="ratings-input">Disability Evaluation Percentages (comma-separated):</label>
            <input type="text" id="ratings-input" value="50, 30, 10" placeholder="e.g. 50, 30, 10" />
            <div class="row">
              <button onclick="calculateVaMath()">Calculate Combined Rating</button>
              <button class="preset-btn" onclick="setPreset('70, 20')">Preset: PTSD (70) + Knee (20)</button>
              <button class="preset-btn" onclick="setPreset('50, 50')">Preset: 50 + 50</button>
              <button class="preset-btn" onclick="setPreset('50, 30, 20, 10')">Preset: 4 Conditions</button>
            </div>
            <div id="va-math-result" class="result-box" style="display:none;"></div>
          </div>
        </section>

        <!-- Clinical Semantic Query Tester -->
        <section class="card">
          <h2>🔍 Clinical Semantic Query Mapper</h2>
          <p class="lead">Translate conversational medical symptoms into official Title 38 Diagnostic Codes.</p>
          <div style="margin-top: 1rem;">
            <label for="query-input">Symptom or Complaint:</label>
            <input type="search" id="query-input" value="ringing in ears after gunfire" placeholder="e.g. 'ringing in ears', 'sleep apnea cpap', 'migraines'" />
            <div class="row">
              <button onclick="testSemanticSearch()">Resolve Diagnostic Code & Search</button>
              <button class="preset-btn" onclick="setQuery('sleep apnea cpap machine')">Sleep Apnea</button>
              <button class="preset-btn" onclick="setQuery('prostrating migraines')">Migraines</button>
              <button class="preset-btn" onclick="setQuery('lumbosacral disc pain')">Spine</button>
            </div>
            <div id="search-result" class="result-box" style="display:none;"></div>
          </div>
        </section>
      </div>
    </div>

    <script>
      function setPreset(val) {
        document.getElementById('ratings-input').value = val;
        calculateVaMath();
      }

      function setQuery(val) {
        document.getElementById('query-input').value = val;
        testSemanticSearch();
      }

      async function calculateVaMath() {
        const input = document.getElementById('ratings-input').value;
        const resBox = document.getElementById('va-math-result');
        resBox.style.display = 'block';
        resBox.textContent = 'Calculating...';
        try {
          const res = await fetch('/api/v1/vibe/combine?ratings=' + encodeURIComponent(input));
          const data = await res.json();
          if (!res.ok) throw new Error(data.error?.message || 'Calculation failed');
          let text = 'Final Combined Rating: ' + data.combinedRating + '%\\n' +
                     'Raw Disability:        ' + data.rawDisabilityPercent + '%\\n\\n' +
                     'Calculation Steps:\\n';
          data.steps.forEach((s, idx) => {
            text += '  ' + (idx + 1) + '. ' + s.rating + '% rating applied to ' + s.efficiencyBeforePercent + '% efficiency ' +
                    '-> +' + s.pointsAppliedPercent + '% (Remaining efficiency: ' + s.efficiencyAfterPercent + '%)\\n';
          });
          resBox.textContent = text;
        } catch (err) {
          resBox.textContent = 'Error: ' + err.message;
        }
      }

      async function testSemanticSearch() {
        const q = document.getElementById('query-input').value;
        const resBox = document.getElementById('search-result');
        resBox.style.display = 'block';
        resBox.textContent = 'Searching...';
        try {
          const res = await fetch('/api/v1/search?semantic=1&q=' + encodeURIComponent(q));
          const data = await res.json();
          if (!res.ok) throw new Error(data.error?.message || 'Search failed');
          let text = 'Search Query: ' + data.query + '\\n';
          if (data.semanticMatches && data.semanticMatches.length > 0) {
            text += '\\nClinical Semantic Mappings:\\n';
            data.semanticMatches.forEach((m) => {
              text += '  • ' + m.canonicalName + ' (Diagnostic Code ' + m.diagnosticCode + ' -> § ' + m.citation + ')\\n';
            });
          }
          text += '\\nHits: ' + data.total + ' candidates\\n';
          data.hits.slice(0, 3).forEach((h, i) => {
            text += '\\n[' + (i + 1) + '] ' + h.citationDisplay + ' — ' + h.heading + '\\n' +
                    '    URL: ' + h.sourceUrlAtIndexDate + '\\n';
          });
          resBox.textContent = text;
        } catch (err) {
          resBox.textContent = 'Error: ' + err.message;
        }
      }
    </script>
  </body>
</html>
`;
