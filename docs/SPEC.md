# cfr-free — Spec (v0.1 draft)

A self-hosted **38 CFR data service ("Titan")** plus an **MCP server**, TypeScript, built to pass Snyk and SonarQube scans.

## 1. Goals

- Index all of Title 38 CFR locally (SQLite + FTS5) from the public eCFR API.
- Expose the data two ways: an HTTP API (`serve`) and an MCP stdio server (`mcp`).
- Zero-infrastructure runtime: Node ≥ 22.5 built-ins only (`node:sqlite`, `node:http`).
- Pass Snyk (no vulnerable deps, no risky patterns) and SonarQube (strict TS, high test coverage, low complexity).

**Non-goals:** titles other than 38 (design keeps `TITLE` a constant), auth/multi-tenant HTTP, vector/semantic search, live write-back to eCFR.

## 2. Architecture

Single npm package, one CLI (`cfr-free`) with subcommands (default: `mcp`):

```
cfr-free sync      # build/refresh the local index from eCFR
cfr-free serve     # start the Titan HTTP API (default 127.0.0.1:8787)
cfr-free mcp       # start the MCP stdio server (reads local index)
```

```
src/
  cli.ts              arg parsing, subcommand dispatch (thin)
  config.ts           env config, zod-validated
  logger.ts           stderr-only structured logging (stdout is JSON-RPC)
  core/
    http-client.ts    fetch wrapper: timeout, size cap, gzip, friendly errors
    ecfr.ts           eCFR endpoints: dates, structure, full-title XML, search
    xml.ts            XML → markdown/text renderer + section extractor
    citations.ts      parse/normalize "38 CFR 4.125", "§ 4.125", "4.125"
    store.ts          SQLite schema, queries (FTS5), transactional rebuild
    sync.ts           index build pipeline
    service.ts        facade shared by MCP + HTTP: search/getSection/browse/status
  mcp/
    server.ts         buildServer(deps) — testable, no I/O at module load
    tools.ts          tool schemas + handlers
  titan/
    http-server.ts    node:http server + router (GET-only, JSON)
test/                 vitest unit + integration (mocked fetch, temp SQLite)
```

## 3. Data source & sync (live eCFR, one-shot)

Endpoints (base `https://www.ecfr.gov`, fixed origin — no SSRF surface):

1. `GET /api/versioner/v1/titles.json` → Title 38 `up_to_date_as_of` (fallback `latest_issue_date`). eCFR rejects dates past the issue date, so this is resolved every sync.
2. `GET /api/versioner/v1/structure/{date}/title-38.json` (~124 KB) → browse tree, stored in `meta`.
3. `GET /api/versioner/v1/full/{date}/title-38.xml` (~2 MB gzip'd, verified: 2953 SECTION + 17 APPENDIX DIVs, exact match with structure JSON) → parsed in one pass.

Parse rule: walk `<DIVn>` nodes by their `TYPE` attribute (`TITLE|CHAPTER|PART|SUBPART|SUBJGRP|SECTION|APPENDIX`), maintaining an identifier stack → each section gets `path`, `part`, `subpart` columns. Headings from `<HEAD>` (strip `§ 4.125 ` prefix). Sanity check: parsed count vs. structure count; hard-fail on 0, warn on mismatch.

Sync is a single transaction: `DELETE FROM sections` + bulk insert (FTS5 external-content triggers keep the index consistent). Sync is atomic — readers never see a half-built index (SQLite WAL mode).

Policies: HTTP timeout 20 s, max response 50 MB, `User-Agent: cfr-free/<version>`, 3 attempts with backoff on 5xx/timeouts only, in-memory TTL cache (structure 24 h, dates 1 h).

## 4. Storage schema (SQLite, FTS5)

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sections (
  id INTEGER PRIMARY KEY,
  citation TEXT NOT NULL UNIQUE,     -- '4.125' | 'Appendix A to Part 4'
  kind TEXT NOT NULL CHECK (kind IN ('section','appendix')),
  heading TEXT NOT NULL,             -- 'Diagnosis of mental disorders.'
  chapter TEXT, subchapter TEXT, part TEXT, subpart TEXT, subject_group TEXT,
  path TEXT NOT NULL,                -- '/chapter:I/part:4/subpart:B/...'
  text TEXT NOT NULL,                -- plain text
  markdown TEXT NOT NULL,            -- rendered markdown
  issue_date TEXT NOT NULL
);
CREATE VIRTUAL TABLE sections_fts USING fts5(
  citation, heading, text, content='sections', content_rowid='id',
  tokenize='porter unicode61'
);
-- standard ai/ad/au sync triggers
```

**FTS query safety:** user input never passes through raw. `toFtsQuery()` tokenizes on `[^\p{L}\p{N}]`, emits `"tok"*` terms joined by `AND`; service retries once with `OR` if `AND` yields 0 rows. Bound inputs: query 3–200 chars, `per_page` 1–20, page ≥ 1. Results deduped by citation (eCFR search returns one row per change event).

## 5. Titan HTTP API (GET-only, JSON, bind 127.0.0.1)

| Route                            | Params                                | Returns                                      |
| -------------------------------- | ------------------------------------- | -------------------------------------------- |
| `GET /health`                    | —                                     | `{status, issueDate, syncedAt, sections}`    |
| `GET /api/v1/search`             | `q` (req), `page`, `per_page`, `part` | hits: citation, heading, snippet, score      |
| `GET /api/v1/sections/:citation` | citation URL-encoded                  | full markdown + text + metadata + source URL |
| `GET /api/v1/browse`             | `chapter`, `part`, `subpart`          | children of that node (type, id, label)      |

Hardening: no request bodies, zod-validated query strings, `X-Content-Type-Options: nosniff`, request timeout, 404/405/400 with machine-readable error JSON, `Cache-Control: max-age=3600` on section reads (content only changes on amendment). No auth — documented as localhost-only; `HOST` env can override deliberately.

## 6. MCP tools (all read-only annotations)

1. `search_regulations(query, page?, per_page?, part?)` → ranked hits with citations + snippets.
2. `get_section(citation)` → accepts `4.125`, `§ 4.125`, `38 CFR 4.125`; returns markdown text, heading, path, issue date, eCFR source URL.
3. `browse_title38(chapter?, part?, subpart?)` → structure children at that level.
4. `index_status()` → freshness (issue date, synced at, staleness vs. `CFR_MAX_AGE_DAYS`).

All return MCP `structuredContent` + text content. `readOnlyHint: true`, `openWorldHint: false` (post-sync: no network). Startup: if index missing or older than `CFR_MAX_AGE_DAYS` (default 7) and `CFR_AUTO_SYNC != 0`, sync first (progress → stderr), then serve. No stdout logging ever.

## 7. Security / Snyk / SonarQube plan

- **Deps (Snyk):** runtime deps limited to `@modelcontextprotocol/sdk`, `zod`, `fast-xml-parser`; lockfile committed; `npm audit --audit-level=high` + `snyk test --severity-threshold=high` in CI (token-gated).
- **Code (Sonar):** `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; ESLint (recommended, `no-explicit-any=error`, `no-console` allow-only-`error`, `complexity ≤ 10`, `eqeqeq`); no regex without linear guarantees; no `eval`/`Function`/`child_process`; no secrets (none needed); all error paths return sanitized messages (no stack traces to clients).
- **Coverage:** vitest + v8 ≥ 80 % lines/functions; mocked-fetch tests (no live network in CI); SonarQube reads `coverage/lcov.info` (`sonar-project.properties` committed).
- **CI:** GitHub Actions — quality job (lint, typecheck, test, build, audit), `snyk` job (skips without `SNYK_TOKEN`), `sonar` job (skips without `SONAR_TOKEN`).

## 8. Test plan

Unit: citation parser, FTS sanitizer (incl. injection attempts `" OR 1=1--`), XML renderer (tables, authority/source-credit nodes, reserved sections), TTL-LRU cache, store queries (temp SQLite), sync with mocked eCFR payloads (count-mismatch warning, 0-section hard-fail). Integration: MCP via `InMemoryTransport` (tools/list + every tool), HTTP API via ephemeral port + `fetch`. Optional `LIVE_TESTS=1` smoke against real eCFR.

## 9. Risks / open questions

1. `node:sqlite` experimental warning on some Node versions (stderr only; harmless to stdio JSON-RPC).
2. `fast-xml-parser` v5 API drift vs v4 — covered by renderer tests.
3. eCFR `/search/v1/results` is a change-index (dup rows) — mitigated by dedupe; primary search is local FTS5 anyway (search tool uses local index; eCFR search only used pre-index?).
4. Title 38 only — other titles later require re-running sync for that title (schema stores no title column; keep `TITLE = 38` constant for v1).

## 10. Review amendments (v0.2 — Nemotron + Gemma design reviews)

| #   | Finding (source)                                                        | Disposition                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | FTS5 sync triggers not spelled out (**Nemotron**, blocker)              | **Accepted** — full `ai`/`ad`/`au` trigger DDL ships in `store.ts`; verified by update/delete tests.                                                                                                                                                                                                                                  |
| 2   | Sync-failure fallback undefined (**Nemotron**, blocker)                 | **Accepted** — policy: sync runs _before_ serving starts; if sync fails and a non-empty index exists → serve stale with `level=warn` log + `stale: true` in `index_status`; if index empty → exit code 1 with actionable stderr message. Never retry-loop.                                                                            |
| 3   | `HOST` override defeats localhost-only claim (**Nemotron**, blocker)    | **Accepted** — non-loopback `CFR_HOST` rejected unless `CFR_ALLOW_REMOTE=1` (`ConfigError`).                                                                                                                                                                                                                                          |
| 4   | Unbounded FTS `*` wildcard terms (**Nemotron**, major)                  | **Accepted** — tokenizer emits ≤ `MAX_TERMS = 12` terms; term count enforced + unit-tested.                                                                                                                                                                                                                                           |
| 5   | No graceful shutdown (**Nemotron**, major)                              | **Accepted** — shared shutdown controller (SIGINT/SIGTERM, idempotent cleanup, force-exit on second signal); SQLite writes are transactional so Ctrl+C mid-sync rolls back cleanly.                                                                                                                                                   |
| 6   | eCFR XML format drift (**Nemotron**, major)                             | **Accepted** — hard-fail on 0 parsed sections, warn on count mismatch vs. structure, `parser_version` recorded in `meta`.                                                                                                                                                                                                             |
| 7   | `User-Agent` version source (**Nemotron**, major)                       | **Accepted** — read from `package.json` at startup via `createRequire`, fallback `0.0.0`.                                                                                                                                                                                                                                             |
| 8   | Zero-availability window during DELETE+insert sync (**Gemma**, blocker) | **Rejected w/ rationale** — sync uses one `BEGIN IMMEDIATE … COMMIT`; under WAL, concurrent connections read the pre-commit snapshot (no empty window). In-process auto-sync completes _before_ the MCP/HTTP server starts listening. Shadow-table swap adds risk without benefit at this scale (2 970 rows, <1 s). Documented in §3. |
| 9   | DOM memory on 2 MB XML (**Gemma**, major)                               | **Accepted (bounded)** — single ordered-tree pass, no backtracking regexes, per-section 400 k-char cap, HTTP 50 MB cap; ~2 MB input ⇒ tens of MB peak, one-shot during sync.                                                                                                                                                          |
| 10  | AND→OR fallback must not be dynamic SQL (**Gemma**, major)              | **Accepted** — two separate prepared statements executed in sequence; FTS query string is always a **bound parameter** (never concatenated into SQL).                                                                                                                                                                                 |
| 11  | Dual TTL cache (**Nemotron**, minor)                                    | **Rejected (cut)** — no cross-process cache: sync is rare and `serve`/`mcp` never call eCFR after indexing. Simpler than any cache policy.                                                                                                                                                                                            |
| 12  | `LIVE_TESTS` in CI (**Nemotron**, minor)                                | **Accepted** — live tests require explicit `LIVE_TESTS=1`; CI never sets it.                                                                                                                                                                                                                                                          |

## 11. GitHub delivery (best practices)

- Public repo `deffenda/cfr-free`, **MIT** license.
- Trunk-based flow: bootstrap `main` (docs/license only) → feature branch → **PR** → CI green → **squash merge** + branch delete.
- Branch protection on `main`: PR required, strict up-to-date, required checks `quality (22)` + `quality (24)`; no mandatory review (solo maintainer — documented in CONTRIBUTING).
- Repo settings: squash merge only, auto-delete head branches, Dependabot (npm + actions weekly), minimal `GITHUB_TOKEN` permissions (`contents: read`).
- Local pre-push gates: `npm run ci` + `npm run scan` (npm audit, osv-scanner, gitleaks, trivy, semgrep).

## 12. Implementation review round (v0.3 — post-code reviews + live smoke)

Code-review findings on the implemented source, with dispositions:

| #   | Finding (source)                                                                                  | Disposition                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13  | `titles.json` contains null dates for reserved titles (**live smoke**)                            | **Accepted (bug found by live sync)** — schema made nullable; title 38's own dates validated at extraction; regression test seeds a null-date title.                                                                                                                                                                                              |
| 14  | FTS/SQL injection via search terms (**Gemma review prompt**)                                      | **Accepted by design** — terms re-tokenized into ≤12 quoted prefix phrases, always bound parameters; property-tested with `OR`/`--`/quote payloads.                                                                                                                                                                                               |
| 15  | DOCTYPE check bypass via case variants (**Nemotron**, minor)                                      | **Accepted** — check is now case-insensitive; fast-xml-parser never expands external entities regardless.                                                                                                                                                                                                                                         |
| 16  | No HTTP server request timeout (**Nemotron**, minor)                                              | **Accepted** — `requestTimeout` 60 s set explicitly on the Node HTTP server (headers timeout already defaults to 60 s).                                                                                                                                                                                                                           |
| 17  | `quick_check` breaks new databases (**Nemotron**, minor)                                          | **Rejected** — `PRAGMA quick_check` succeeds on fresh files; covered by every `openTempStore` test (170 tests open fresh DBs).                                                                                                                                                                                                                    |
| 18  | `process.once('exit')` useless under SIGKILL (**Nemotron**, minor)                                | **Rejected** — nothing survives SIGKILL; WAL journal recovery handles any interruption, and SIGINT/SIGTERM paths run full cleanup.                                                                                                                                                                                                                |
| 19  | Parser singleton thread-safety (**Nemotron**, minor)                                              | **Rejected** — Node.js is single-threaded; the shared parser is immutable after init.                                                                                                                                                                                                                                                             |
| 20  | Sync error message ambiguity, constant naming, trigger docs (**N**)                               | **Mixed** — `ERROR_BODY_SNIPPET` → `MAX_ERROR_BODY_CHARS` rename + trigger purpose comments accepted; message rewording rejected (message already states both hypotheses).                                                                                                                                                                        |
| 21  | osv-scanner CI action subpath (**CI run**)                                                        | **Accepted** — corrected to `google/osv-scanner-action/osv-scanner-action` (the `osv-scanner` subpath does not exist at v2.7.0); local script treats non-`3` exits as network/infra warnings, exit 3 = findings.                                                                                                                                  |
| 22  | `cli.ts` prints `error.message` to stderr (**Gemma**, "blocker")                                  | **Rejected w/ rationale** — local CLI; the operator needs actionable messages ("port in use", "run `cfr-free sync`"). Messages are already sanitized: no stack traces are ever printed, upstream HTTP bodies are truncated, and the remote HTTP/MCP surfaces map internal errors to a generic 500/"internal error".                               |
| 23  | Set `processEntities: false` for XXE (**Gemma**, major)                                           | **Rejected w/ rationale** — `fast-xml-parser` never resolves _external_ entities (no network/filesystem access during parsing) and DOCTYPE is rejected up front (case-insensitive). Disabling entity processing entirely would corrupt legitimate content (`&amp;`, numeric character references must decode — covered by tests).                 |
| 24  | Non-loopback `CFR_HOST` requires `CFR_ALLOW_REMOTE` (**Gemma**, major)                            | **Already implemented** — exact behavior ships in `config.ts` (`ConfigError` with guidance) with dedicated tests; see SPEC §10 #3.                                                                                                                                                                                                                |
| 25  | Replace manual `parseArgs` with commander/yargs (**Gemma**, minor)                                | **Rejected** — a runtime dependency for ~20 lines of trivial parsing; complexity is well under the Sonar limit; flags are deliberately avoided (env-first config keeps MCP client configs uniform).                                                                                                                                               |
| 26  | Whitelist FTS query terms before binding (**Gemma**, minor)                                       | **Already implemented** — `toFtsQuery` re-tokenizes on `[^\p{L}\p{N}]` (letters/digits whitelist), emits ≤12 quoted prefix terms, always bound as parameters; tests feed `" OR 1=1 --`, `NEAR(x)` and quote payloads and assert neutralization.                                                                                                   |
| 27  | Review-run failure: batch 2/5 produced reasoning only (**infra**)                                 | **Handled** — the model overthought a large multi-file batch and exhausted even the 16k retry budget; a narrower follow-up pass (security-critical files only, 12k-char batches) was run instead.                                                                                                                                                 |
| 28  | Size cap checked only after `response.text()` buffers the body (**Gemma security pass**, blocker) | **Accepted** — real weakness: the cap rejected oversized responses correctly but only _after_ buffering them. Now enforced by a streaming reader that counts bytes and aborts + cancels the stream the moment the cap is exceeded; regression test asserts the stream is not pulled past the cap.                                                 |
| 29  | Error-body snippet read unbounded (**Gemma security pass**, blocker)                              | **Accepted** — `response.text()` on error responses was unbounded (sliced only after the fact). Now a bounded reader keeps ≤200 bytes and cancels the rest; regression test asserts <10 pulls on an effectively infinite error body.                                                                                                              |
| 30  | `lastError` rethrow could leak raw messages (**Gemma security pass**, major)                      | **Rejected w/ rationale** — every error on that path originates from `fetchOnce`, which only ever throws `HttpError` with sanitized messages (pathname only, truncated upstream bodies, no query strings, no stack traces).                                                                                                                       |
| 31  | Security-pass batch 2 hit the 600 s reasoning abort (**infra**)                                   | **Handled** — raised `LLM_REVIEW_TIMEOUT_MS` to 900 s and narrowed batches to 9k chars for the final follow-up pass over `xml.ts`/`sync.ts`/`http-server.ts`.                                                                                                                                                                                     |
| 32  | XXE via `parseTitleXml` (**Gemma final pass**, blocker)                                           | **Rejected — restates #15/#23** — the parser entry rejects DOCTYPE up front, `fast-xml-parser` never resolves external entities, and entity expansion cannot occur without declarations.                                                                                                                                                          |
| 33  | OOM on large raw sync strings (**Gemma final pass**, major)                                       | **Already implemented** — every upstream read streams through `HttpClient`'s `maxBytes` cap (50 MiB, enforced during the stream per #28) before `structureRaw`/`xml` ever exist.                                                                                                                                                                  |
| 34  | `JSON.stringify(structureRaw)` blocks the event loop (**Gemma final pass**, major)                | **Rejected w/ rationale** — the validated structure of a single title is MB-scale, so the stringify is single-digit milliseconds, and `sync` is a one-shot CLI command with no concurrent request paths.                                                                                                                                          |
| 35  | `processEntities: true` enables billion-laughs (**Gemma final pass**, blocker)                    | **Rejected + defense in depth** — amplification requires `ENTITY` declarations, which require a DOCTYPE, which is rejected pre-parse (fail-closed, case-insensitive). Added an _independent_ `<!ENTITY` rejection so the class stays closed even if the DOCTYPE gate ever changes; regression test covers both.                                   |
| 36  | Unbounded recursion in `inlineText`/render helpers (**Gemma final pass**, major)                  | **Accepted** — section _internals_ were not covered by `walk`'s depth counter. A `depth` counter now threads through `renderBlocks`/`renderBlock`/`inlineText`/`renderTable`/`collectTableRows` and throws `XmlFormatError` past `MAX_DEPTH`, matching `walk`; test nests 70 levels and asserts the throw.                                        |
| 37  | `MAX_SECTION_CHARS` checked after rendering (**Gemma final pass**, major)                         | **Rejected w/ rationale** — the check is a fail-closed format-drift tripwire; the input it guards is already streamed under the 50 MiB cap, so the worst case is a bounded transient string in a sync-only CLI, never an unbounded allocation. Threading a running total through every render path would add complexity for no availability gain. |
| 38  | `escapePipe` escapes only `\|` (**Gemma final pass**, minor)                                      | **Rejected w/ rationale** — only `\|` structurally breaks our table cells; escaping `*`, `_`, `[`, `]` would corrupt legitimate CFR text (footnotes, cross-references) and is at worst a cosmetic rendering nit.                                                                                                                                  |
| 39  | `Number(raw)` lets NaN reach the service (**Gemma http-server pass**, blocker)                    | **Rejected w/ rationale (empirically verified)** — `searchInputSchema` is `z.number().int().min(1)…`, and zod rejects `NaN` (`invalid_type: received NaN`) and fractions; `toServiceError` maps that to `invalid_input` → HTTP 400 before any SQL executes. Regression tests now assert `page=abc`, `page=2.5`, `per_page=999` → 400.             |
| 40  | `server.requestTimeout` "is not a valid property" (**Gemma http-server pass**, major)             | **Rejected w/ rationale (empirically verified)** — `requestTimeout` is a documented Node ≥18 `http.Server` property (default 300 000 ms, here set to 60 000 ms); `timeout` is the _socket idle_ timeout, a different mechanism. The claim is factually incorrect.                                                                                 |
