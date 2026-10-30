# cfr-free — Spec

A self-hosted **38 CFR data service ("Titan")** plus an **MCP server**, TypeScript, vetted by local scanning gates (lint, strict TS, coverage floors, dependency audit + local security scanners).

## 1. Goals

- Index all of Title 38 CFR locally (SQLite + FTS5) from the public eCFR API.
- Expose the data two ways: an HTTP API (`serve`) and an MCP stdio server (`mcp`).
- Zero-infrastructure runtime: Node ≥ 22.5 built-ins only (`node:sqlite`, `node:http`).
- Local gates green: dependency audit clean, risky patterns lint-blocked, strict TS, high test coverage, low complexity.

**Non-goals:** titles other than 38 (design keeps `TITLE` a constant), auth/multi-tenant HTTP, vector/semantic search, live write-back to eCFR.

## 2. Architecture

Single npm package, one CLI (`cfr-free`) with subcommands (default: `mcp`):

```
mcp  sync  diff  redline  historical  search  serve  export  help  version
```

Signatures and one-line purposes live in `USAGE` (`src/cli.ts`); `help`
and `version` dispatch there, the other eight in `src/commands/`.

```
src/
  cli.ts              arg parsing, subcommand dispatch (thin)
  config.ts           env config, zod-validated
  exit-codes.ts       process exit-code contract for CLI automation
  logger.ts           stderr-only structured logging (stdout is JSON-RPC)
  process-utils.ts    idempotent shutdown handling shared by serve/mcp
  version.ts          package-version resolution seam
  commands/           per-subcommand entrypoints (diff, export,
                      historical, mcp, redline, search, serve, sync)
                      plus two internal helpers (ensure-index,
                      refresh-scheduler)
  core/
    changes.ts        sync change report: hash diff between syncs
    citations.ts      parse/normalize "38 CFR 4.125", "38 C.F.R. § 4.125", "§ 4.125", "4.125"
    diff.ts           point-in-time diff (no local index): fetch two issue dates, hash per citation
    ecfr.ts           eCFR endpoints: dates, structure, full-title XML, search
    errors.ts         the error types the whole service speaks: ServiceError, StructureError
    historical.ts     point-in-time read: a provision as it stood at a requested date
    http-client.ts    fetch wrapper: timeout, size cap, gzip, friendly errors
    point-in-time.ts  the "a date is a selector, not a stamp" notice, shared by the change views
    query.ts          the query language: tokenizer, synonyms, FTS5 fragments, stopwords
    redline.ts        per-provision line redline between two issue dates
    references.ts     cross-reference extraction for search results
    service.ts        facade shared by MCP + HTTP: search/getSection/browse/status
    store.ts          SQLite schema, queries (FTS5), transactional rebuild
    structure.ts      browse-tree validation + browse
    sync.ts           index build pipeline
    xml.ts            XML → markdown/text renderer + section extractor
  mcp/
    client-safe.ts    client-safe error text (sanitized messages on the wire)
    resources.ts      resource + prompt handlers
    server.ts         buildServer(deps) — testable, no I/O at module load
    tools.ts          tool schemas + handlers
  titan/
    http-server.ts    node:http server + router (GET-only; JSON API, metrics text, UI assets)
    rate-limit.ts     per-peer token bucket for deliberately exposed APIs
    ui.ts             read-only web UI: the HTML shell, plus the script and
                      stylesheet read from the files beside it
    ui-client.js      the browser script (served at /ui.js) — a real file, so
                      eslint and prettier can see it
    ui-client.css     the stylesheet (served at /ui.css)
test/                 vitest unit + integration (mocked fetch, temp SQLite)
```

## 3. Data source & sync (live eCFR, one-shot)

Endpoints (base `https://www.ecfr.gov`, fixed origin — no SSRF surface):

1. `GET /api/versioner/v1/titles.json` → Title 38 `up_to_date_as_of` (fallback `latest_issue_date`). eCFR rejects dates past the issue date, so this is resolved every sync.
2. `GET /api/versioner/v1/structure/{date}/title-38.json` (~124 KB) → browse tree, stored in `meta`.
3. `GET /api/versioner/v1/full/{date}/title-38.xml` (~2 MB gzip'd, verified: 2953 SECTION + 17 APPENDIX DIVs, exact match with structure JSON) → parsed in one pass.

Parse rule: walk `<DIVn>` nodes by their `TYPE` attribute (`TITLE|CHAPTER|PART|SUBPART|SUBJGRP|SECTION|APPENDIX`), maintaining an identifier stack → each section gets `path`, `part`, `subpart` columns. Headings from `<HEAD>` (strip `§ 4.125 ` prefix). Sanity check: parsed count vs. structure count; hard-fail on 0, warn on mismatch.

**Inline vs block rendering:** a container that mixes its own text with
inline elements (`<E T="01">`, `<I>`, `<SU>`, `<strong>`, `<sub>`, `<sup>`,
`<br>`) is an INLINE context and renders as ONE block, so a phrase is never
split by a blank line around the inline element it contains — upstream
`Note to paragraph (<E T="01">g</E>)(1):` renders as `Note to paragraph
(g)(1):`, not as a paragraph, a blank line, the letter, and another blank
line. A container that holds BLOCK children (a `<P>`, `<TABLE>`, `<NOTE>`'s
paragraph, the `DIV` hierarchy) keeps its block structure: a note's heading
and its paragraph stay separate blocks. The rule is structural (inline
elements hold text only), not a tag list, with one explicit guard: a child
that is a `P`, `FP`, `HEAD`, `TABLE`, `CITA`, `SECAUTH`, `NOTE`, `EDNOTE` or
`EXTRACT` is never part of a phrase, whatever its content. The guard makes
the rule independent of the current document — a future eCFR document that
places a paragraph inside a container with its own text keeps that
paragraph as its own block instead of silently folding it into a
phrase.

**What counts as a change (M2(b)):** a provision's content fingerprint
covers its text AND its heading. A heading is part of the provision's
meaning: § 3.17 was retitled from "Disability and death pension" to
"Disability and survivors pension" with no change to the body, and a
text-only hash reported that amendment as "no change" — in the sync
change report, in `cfr-free diff`, and in the MCP `diff_issues` tool
alike. Measured on the live corpus: one such heading-only amendment per
~2,921 provisions per year, and it is invisible to a text-only
comparison. The comparison's baseline is the live index table, so
including the heading needs no hash-compatibility transition: the
previous index's rows carry their headings. The LINE-LEVEL redline keeps
its text-only contract (`redline` is a text diff by definition); a
heading-only amendment is surfaced by the change-detection surfaces, not
by the redline.

**Point-in-time reads (M2(c)):** `cfr-free historical <at> <citation>`
and the MCP tool `get_section_at` return one provision AS IT STOOD at a
requested date. eCFR serves the revision in force on that date, so a date
that is not itself an issue date resolves to the revision that was in
force then. The upstream does NOT report which issue date it served, so
the read NAMES THE REQUESTED DATE and never a served-revision date. The
response also carries the dated eCFR URL for the requested date — the
same revision the text came from. eCFR's point-in-time archive starts at
2017-01-01 (measured 2026-10-20: the versioner answers 404 before that);
a date outside the archive is a USAGE error (`invalid_input`: exit 2 on the
CLI, HTTP 400 on the API). The date's SHAPE is validated BEFORE any fetch;
the archive floor can only be known from the upstream's answer.

**Dated source URL (M2(a)):** every section response carries TWO links to
the same provision on ecfr.gov: `sourceUrl` points at the CURRENT text
(`/current/title-38/section-<citation>`) for navigation and verification,
and `sourceUrlAtIndexDate` points at the SAME provision at the revision the
index was built from — the eCFR point-in-time form
(`/on/<issue date>/title-38/section-<citation>`, appendix form
`/on/<issue date>/title-38/appendix-<citation>`, URL-encoded). The
`/current/` form drops the revision, so a reader who opened it could not
tell which text they were looking at; the dated form keeps the date, and
the index's issue date IS the revision the indexed text was parsed from.

**Which form the CLI prints.** A human-facing surface must print the DATED
form: `cfr-free search` prints `sourceUrlAtIndexDate` for each hit, because
that is the link a reader can open and show which revision the text came
from. The `/current/` form remains on the wire as `sourceUrl` for
navigation (it is the "what does it say today" link), and the HTTP and MCP
surfaces carry both. The same rule governs the section view's copy block,
which prints the dated form as its verification link.

**The CLI's search surface.** `cfr-free search` runs the same search the
HTTP and MCP surfaces run, and takes the same parameters: `--page`,
`--per-page`, `--part`, `--kind` and `--chapter` mirror the HTTP query
parameters, and `--json` emits the `SearchResponse` verbatim for a script
(the prose is for a reader; a script must never have to parse it). The
page size is the reader's to choose: the ten results the command used to
print were a dead end for anyone who narrowed by the wrong wording, with
no route to the rest. The flags are validated BEFORE the index is opened,
for the same reason the query length is — a rejected input is the reader's
mistake, and it must not be billed to a 2–3 MB sync.

Verified 2026-10-20 against the live site: both forms answer 302 to a
canonical path that preserves the date. **Retention limit (also measured
2026-10-20):** eCFR serves the point-in-time archive only from 2017
onward for Title 38 — `/on/2017-01-01/…` answers 302, `/on/2016-06-01/…`
answers 404. The link therefore names the revision the index holds (which
is always true), but for an index older than the archive window it will
not resolve; the index's own issue date remains the authority, and the
existing staleness notice already tells the reader the index may be old.

**Labelling supplementary text (M1(b2)):** a footnote (`<FP>`) and an
extract (`<EXTRACT>`) carry text that is NOT the provision's own regulatory
prose — a footnote is supplementary text attached to a paragraph, an extract
is quoted material from elsewhere — and the upstream document labels
neither. Both are therefore labelled in the document's own style (the
`NOTE`/`EDNOTE` headings read "Note:" / "Editorial Note:"): a footnote
renders as a `Footnote:` block followed by its text, an extract as an
`Extract:` block followed by its content, and the labelled content keeps
the structure it had (an extract's list items stay list items). A sub-heading
(`<HD2>`) renders as a heading. Notes and editorial notes are NOT
re-labelled: the upstream wording already labels them ("Note:",
"Editorial Note:").

**Image content (P1-01):** some provisions publish their rating tables as `<img>` elements (15 in the 2026-10-16 document, across 9 provisions — 1.9, 4.71, 4.71a, 4.76a, 4.77, 4.85, 17.610, 45.605, 59.50). The parser cannot include image content offline and must never drop it silently: every `<img>` — inline in a paragraph, nested in a container, or a direct content child — is replaced IN PLACE by the explicit marker `[image content not included: <path>]` in BOTH the text and the markdown representation. Only a vetted relative eCFR graphics path (`/graphics/<file>`, safe charset, no traversal) is named; any other source (scheme-qualified, host-qualified, outside `/graphics/`, or missing) yields `[image content not included: unrecognized image source]` and is never echoed. Nothing is fetched, OCR'd, or transcribed: the service stays fully offline, and a matching section count never implies complete textual coverage — the sync report states how many provisions carry the marker (`meta.image_content_sections`).

Sync is a single transaction: `DELETE FROM sections` + bulk insert (FTS5 external-content triggers keep the index consistent). Sync is atomic — readers never see a half-built index (SQLite WAL mode).

Policies: HTTP timeout 15 s, max response 50 MB, `User-Agent: cfr-free/<version>`, 2 retries (3 attempts) with 250 ms-per-attempt backoff on 5xx/429/timeouts only; no cross-process or persistent cache (cut — §10 row 11). The one reuse of an upstream document is the per-process, in-memory memo described in §5.

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

**FTS query safety:** user input never passes through raw. `toFtsQuery()` tokenizes on `[^\p{L}\p{N}]`, emits `"tok"*` terms; the same fragments are joined by `OR` for the candidate set and by `AND` for the AND-tier membership (§4.1). Bound inputs: query 3–200 chars, `per_page` 1–20, page ≥ 1. Results deduped by citation (eCFR search returns one row per change event).

**Retrieval evaluation (M3):** `test/fixtures/retrieval/` holds a frozen
query set (30 development + 20 holdout queries across citations, display
citations, abbreviations, natural phrasing, quoted phrases, ambiguous topics,
appendices and no-answer cases) and a runner that reports exact-citation
success, recall@5, mean reciprocal rank, no-answer violations and warm-search
latency with machine/runtime/corpus provenance. Run it against an isolated
copy of an index:
`CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/retrieval/run.ts dev`.
The baseline report is `docs/research/retrieval-baseline-2026-10-20.md`. The
set's expectations were adjudicated by a two-member committee on 2026-10-21
and cross-checked against each other and against the corpus — the record is
`docs/research/expectation-adjudication-2026-10-21.md` — and the dev set's
expectations were later amended by operator decisions recorded on issue #135
(2026-10-22, e.g. the quoted-phrase all-match policy); the holdout set stays
byte-frozen and is never amended; an expert remains the authority. A change to
the set is a change to the benchmark and must be visible in the diff. The
holdout set is not tuned on.

**Index receipt:** every rebuild records a corpus receipt in `meta`: the eCFR
issue date plus `corpus_hash`, a sha256 over each provision's
(citation, content-hash) pair — the content hash is `text\0heading` over the
provision's text + heading (rendering and structure metadata are outside the
digest) — with the pairs joined as `citation\0hash\n` and sorted by citation
in UTF-16 code-unit order (`4.10` sorts before `4.9`), so the digest binds
content to citations. `index_status` (the MCP tool and the HTTP `/health`
report) surfaces it and the retrieval runner prints it. Any change round that
touches index-affecting code (parsing, sync, schema, ranking inputs) must
re-record the receipt against a rebuilt index and cite (issue date, corpus
hash) in the change request; retrieval results are only comparable when their
provenance carries the same receipt. Reports written before the receipt field
existed record none, and the runner prints `unknown` for an index built
before it — such runs are comparable only among themselves and by issue
date; comparability across the cutover starts at the first receipt-bearing
rebuild, not retroactively. One stale-receipt path remains: a rebuild
performed by a build that predates the receipt writes only the meta keys it
knows, so the previous receipt stays behind while the rows move on — re-sync
with a receipt-bearing build before citing one. The digest definition is
part of the contract:
changing `hashContent`, `corpusHash` or their framing changes every future
receipt, so such a change must be stated in the change request alongside the
receipt it replaces.

**What the receipt is not.** The receipt is a RECEIPT over the local copy: it
detects ACCIDENTAL corruption of that copy — a truncated row, a half-written
sync, a stale file. It is stored in the same SQLite file it covers, so anyone
who can write the index can recompute it: it is NOT a signature and it makes
no claim about the upstream text the copy was built from. Signing the receipt
with a key held outside the index is a design change, not a property of the
current one. Consumers that quote regulation text in a benefits-adjudication
context must treat the receipt as a freshness and corruption check, never as
provenance the upstream attests to.

### 4.1 The candidate set and the ranking order

**The candidate set is the OR tier:** every provision that matches AT LEAST
ONE query term. The AND tier (every term present) is no longer a candidate
tier — it is a RANKING boost. The old contract made the AND tier the
candidate set and fell back to OR only when AND returned nothing, so a
provision that answers the question with different words was not a
candidate at all, and no ranking rule can surface a row that was never a
candidate. The canonical case: "how is hearing loss rated" wants § 4.85
"Evaluation of hearing impairment.", and § 4.85 carries neither "rated" nor
"loss" — under the AND tier it was excluded from the results entirely.
Measured on the frozen 50 (2026-10-16 corpus), the AND candidate set holds
**71 of the 92** expected provisions and the OR candidate set holds **91 of
the 92**; § 4.85 now ranks **2nd** for that query (was absent). (Before the
2026-10-21 expectation adjudication the same figures were 50/68 and 67/68 —
the expected sets grew, so the counts are not comparable.)

`total` is the size of the candidate set — what the pagination walks — plus
the pinned citation when the candidate set did not already hold it. The
increment is identical on every page, so the pin is counted exactly once.
The response's `matchMode` stays (its `and`/`or` enum is part of the wire
contract) and reports `or`, the only candidate tier.

**The order of the hits** (this exact order):

1. **the heading-phrase key** DESC — a hit whose HEADING carries the
   query's CONTENT terms as a phrase (or the corpus phrase a synonym stands
   for) outranks the body-only hits. The delivery log's §13 row 4 promises that
   "citation/heading matches outrank body-only hits", and the bm25 column
   weights (citation 10, heading 5, text 1) do NOT deliver it: bm25 weighs
   term frequency WITHIN a column, so a section whose body repeats the
   phrase ten times outranks a section whose HEADING is the phrase. The key
   requires the PHRASE, not merely one of the query's words: counting the
   words instead promotes any heading that happens to contain a generic term
   ("rating", "service", "recipients") above the provision that answers the
   question, which measured as three lost exact-citation hits on the
   holdout. Both forms were measured on the frozen 50 before this was
   settled.
2. **the AND-tier membership** DESC — a provision that matches EVERY query
   term outranks one that matches only some. The membership is computed in
   SQL (a CTE over the AND query, LEFT JOINed onto the ranked rows): a JS
   prototype that sorted the rows to find the AND members cost ~200 ms and
   ~700 ms on citation queries.
3. **the exception demotion** ASC — a heading that ANNOUNCES an exception
   ("Exceptional patterns of …", "Exceptions to …") names a case the rule
   does not cover, not the rule the question asks about; when both headings
   carry the query phrase, body repetition would otherwise hand the answer
   to the exception. The key is a fixed GLOB prefix over the corpus's
   own headings, placed after the AND-tier key so it only separates rows
   already equal on phrase and AND membership, and it is switched off when
   the query itself asks about exceptions (then the exception IS the
   answer). "Asks about exceptions" means: one of the query's TERMS
   contains an exception word — `exception`, `exceptions`, `exceptional`,
   `exceptionals` or `excepted` — as a WHOLE word, case-insensitively.
   The word may sit anywhere in the term, because a quoted span is ONE
   term: `"hearing impairment exceptions"` asks about exceptions exactly
   as the unquoted form does. A word that merely contains the letters
   ("exceptionally", "unexceptional", "antiexceptions") does not count.
   It binds no parameters.
4. **bm25** ASC (lower is better) — the tie-breaker. After bm25 the order
   ends with `s.citation` ASC, so equal-score rows have a stable order and
   pagination cannot drift across builds.

The AND-tier membership and the candidate query are the SAME fragments
joined differently, so one parse of the query feeds both.

## 5. Titan HTTP API (GET-only; JSON + two text exceptions, bind 127.0.0.1)

| Route                            | Params                                                                                                                | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                    | —                                                                                                                     | `{status, issueDate, syncedAt, sections, …, structureDrift, corpusHash, diskFree?, diskTotal?}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /metrics`                   | —                                                                                                                     | Prometheus text exposition (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET /api/v1/search`             | `q` (req), `page`, `per_page`, `part`, `kind` (`section`/`appendix`), `chapter` (Roman numeral, exact/case-sensitive) | hits: citation(+display form), source URL, direct flag, heading, snippet, score, matches, partTitle + `indexIssueDate`/`indexStale`/`notice` envelope + `matchedTerms`/`unmatchedTerms` (the query's content terms the returned hits did and did not answer — a statement about the RESULTS, never about what Title 38 covers; for a quoted phrase "answered" means its words occur in a hit's text in that order and contiguously, under the search's own token boundaries and prefix rules); a query that _is_ a citation is pinned as the first hit (page 1 only; the pin-adjusted total is identical on every page); the pin itself respects the `part`/`kind`/`chapter` filters; the response carries a strong `ETag` and answers a matching `If-None-Match` with a bodyless `304`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GET /api/v1/sections/:citation` | citation URL-encoded                                                                                                  | full markdown + text + metadata + source URL + `references[]` (cross-cites with local-availability flags; a cross-cite that is not in THIS index is rendered by the web UI as "(not in this copy)" — it says the provision is absent from this copy, not that it does not exist, because a provision can be in the CFR and missing from this index) + `citedBy` (sorted inbound citing citations; empty array when none); the response carries a strong `ETag` and answers a matching `If-None-Match` with a bodyless `304`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /api/v1/browse`             | `chapter`, `part`, `subpart`, `subjgrp`                                                                               | children of that node (type, id, label); `subjgrp` descends into a subject group (the eCFR node id of a `subject_group` entry), which is the level that holds the sections the flat tree could not reach (1,910 of the corpus's 2,953 sections); it requires `part`, because a subject group hangs off a part or a subpart; the response carries a strong `ETag` and answers a matching `If-None-Match` with a bodyless `304`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET /api/v1/diff`               | `from` (req), `to` (req), both `YYYY-MM-DD`                                                                           | provision-level diff between the two issue dates: `changed[]`/`added[]`/`removed[]` citation lists (each capped at 100, `truncated: true` when any list was cut) + `fromIssueDate`/`toIssueDate` + a `notice` stating the limit on what the two dates mean (eCFR serves the revision in force on the requested date and does not report which issue date that is, so the dates are selectors, not a stamp of the revision served); both dates are fetched from eCFR on demand — there is no local index for a point-in-time diff, but a short-lived in-memory memo in the fetching process may serve a document it fetched moments ago (a five-minute reuse window, four documents kept), and concurrent readers of the same date share one fetch; no default-`to` on the wire                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /api/v1/redline`            | `from` (req), `to` (req), `citation` (req)                                                                            | line-level redline of one provision between the two dates: `status` (changed/added/removed/unchanged), `hunks[]` (same/add/del with 1-based anchors into each side), both sides' text, a `coarse` flag when either side exceeded the core's 2000-line cap (two whole-text blocks), and a `notice` stating the limit on what the two dates mean (selectors, not a stamp of the revision served); fetched from eCFR on demand — the same per-process, in-memory document memo as the diff route (a five-minute reuse window, four documents kept); the response's own HTTP cache ceiling is 5 min (`max-age=300`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /`                          | —                                                                                                                     | read-only web UI (search + section reader, with chapter/part browse tree) as `text/html` — static assets `/ui.js` (`text/javascript`) + `/ui.css` (`text/css`); hash-routed; zero inline script; CSP on the document only; **search form**: the same parameters the API takes — query, kind, part, chapter, page size — and the chapter and part fields carry their own rule (`pattern`, `maxlength`, `title`), so the rule is visible in the form rather than only in a schema; **keyboard and screen-reader posture**: a route change moves the focus to the new view's heading (`tabindex="-1"`, so it takes the focus without becoming a tab stop) and announces the view in a live region, a skip link reaches the content past the header, and the focused element is never left inside a view that was hidden; **redline view (M5 slice 2)**: a `#/redline` route takes a from/to date pair and a citation and renders the wire's line-level diff in the CLI's shape, with the `coarse` flag shown explicitly so a whole-block comparison is never read as a line-by-line one; **route ownership**: every navigation invalidates in-flight responses, so a late success, error or body parse can never repaint a route the user has left (P1-02); **copy-a-citation (M5)**: the section view builds a plain-text block of the citation's legal display form, its heading, the source line with the index's issue date, the DATED verification URL (the revision the text came from), and — when the text carries an image marker — an explicit incompleteness warning, so a copied citation never implies complete coverage; the block is also shown in a readonly selectable textarea so it works without clipboard permission |

Hardening: no request bodies, zod-validated query strings, router-level byte caps (URL ≤ 2048 bytes → `414 uri_too_long`; `q` ≤ 800 bytes, `part` ≤ 10 bytes → `400`), per-peer token-bucket rate limiting (`429` + `Retry-After`) when `CFR_ALLOW_REMOTE=1` (loopback default never throttles; a peer is a socket address, so clients behind one NAT share a budget — fine for a coarse DoS guard, not per-user fairness). The budget is spent by COST, not by request: the index-backed reads cost one token, and the two routes that pull the complete upstream document (`/api/v1/diff`, `/api/v1/redline` — ~2 MB on the wire, ~16 MB parsed) cost ten. The old one-token price bought the published budget of ten requests a second — twenty whole documents a second, because a diff or a redline pulls two of them; the ten-token price buys one such request (two documents) a second. Every request is charged BEFORE the router's own gates answer, so a refused request is not free: a request the method gate refuses (`405`), the URL-size gate refuses (`414`) or the URL parser refuses (`400`) still costs one token. Every other request is charged the ROUTE's own price — including one that is then rejected for a reason of its own (a malformed date, which the route's validation catches; a `q` over 800 bytes, which the router's byte caps catch): the price follows the path the request would have taken, so a `POST` to `/api/v1/diff` costs one token while a `GET /api/v1/diff?from=nonsense` costs ten. `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` on every response, a 60 s request timeout, a 10 s header timeout, a 5 s keep-alive timeout and a 256-connection cap (the limiter runs only after the headers are complete, so a client that dribbles them would otherwise hold a socket without spending a token), 404/405/400 with machine-readable error JSON, a `502 upstream_error` when eCFR's DATA is not usable (an unparseable date, a missing title, a missing issue date) — an upstream-data fault is neither the reader's fault nor ours, so it is a bad gateway rather than a generic 500, and the detail stays in the server log, `Cache-Control: max-age=3600` on section reads (content only changes on amendment); the two eCFR-fetching routes cache their responses at shorter ceilings (`diff` `max-age=3600`, `redline` `max-age=300` — a redline spans two upstream fetches and the from/to window is only rarely an identical document). The upstream document fetches are bounded on BOTH sides, because a request budget bounds how fast they START and nothing bounded how many could run at once: a semaphore lets four run at a time and refuses a request whose wait queue is full (sixteen waiting) with `503 upstream_busy` — refused at once rather than parked for minutes — and the fetched documents are memoised by issue date (the same date is the same document) in a per-process, in-memory memo that keeps at most four documents for five minutes; concurrent readers of the same date share ONE upstream fetch. The three index-backed reads (`/api/v1/search`, `/api/v1/sections/:citation`, `/api/v1/browse`) also carry a **strong `ETag`** — a quoted sha256 over the exact response bytes, so the tag changes if and only if the body changes — and answer a matching `If-None-Match` with a bodyless `304` (RFC 9110 §13.1.2: `*` matches any representation, a list matches when any member matches, and a weak validator `W/"x"` matches the strong `"x"`), so a client can confirm the text it quotes is unchanged without re-downloading it. Only a 200 is eligible: `/health`, `/metrics`, the two eCFR-fetching routes and every error response carry no validator and are never a 304. No auth — documented as localhost-only; `HOST` env can override deliberately (with the rate budget attached). The application sends no HSTS header: the header is a promise about the public hostname, and the application does not know it — a TLS-terminating proxy in front of the deployment must send it there. The container image is the one documented exception, and §7 states the deployment posture it implies.

The API is JSON-only except for two deliberate text routes: `GET /metrics` serves Prometheus exposition text (gauges: `cfr_free_sections`, `cfr_free_appendices`, `cfr_free_stale`, `cfr_free_max_age_days`, `cfr_free_issue_date_timestamp_seconds`, `cfr_free_synced_at_timestamp_seconds`, `cfr_free_structure_drift` when recorded, and `cfr_free_disk_free_bytes`/`cfr_free_disk_total_bytes` when a statfs snapshot exists) so scrapers need no JSON parsing — it returns the same read-only data as `/health` — and the read-only UI asset routes (`/`, `/ui.js`, `/ui.css`) serve `text/html`/`text/javascript`/`text/css` (§6-R5 batch-6 addition: the HTML shell is a string constant in `src/titan/ui.ts`; the script and stylesheet are real files (`src/titan/ui-client.js`, `src/titan/ui-client.css`) — being files is what lets the gate's linter and formatter see them, and the build copies them into `dist/` beside the module that reads them so the server can serve them; served with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, same-origin CORP, and a `default-src 'none'` CSP on the document; the UI consumes the same JSON API above).

Machine-readable contract: [`docs/openapi.yaml`](openapi.yaml) (OpenAPI 3.1, derived from `src/titan/http-server.ts` — keep in sync).

**Provenance convention.** The contract does not cite line numbers. Each path and each shared error response carries a `# source:` comment naming the SYMBOL it comes from — `src/titan/http-server.ts#handleSearch`, `src/titan/http-server.ts#precheck` — and a bare symbol in the same comment inherits the file of the pair before it (`# source: src/titan/http-server.ts#dispatch, handleSearch`). A symbol is stable where a line is not: the router can grow a hundred lines and `#dispatch` still names the same function, so the citation is a claim about the implementation rather than a tripwire on every insertion above it. The conformance suite (`test/openapi-conformance.test.ts`) resolves every citation against the cited file and fails if the symbol is absent, is commented out, or no longer carries the construct the citation claims for it; the same rule covers the inline `#symbol` anchors in the response descriptions, and a citation that names nothing is a failure, never a silent skip. `docs/openapi.yaml` therefore has one account of where each construct lives, and the suite is what keeps that account true.

## 6. MCP tools (all read-only annotations)

1. `search_regulations(query, page?, per_page?, part?, kind?, chapter?)` → ranked hits with citations, snippets, bm25 scores and the query terms visible in each hit (`matches`). A query that _is_ a citation (`4.130`, `38 CFR 4.16`, `§ 3.350(a)`) pins that exact section as the first hit (page 1 only; totals include the pin on every page); quoted spans search as exact phrases; curated claims acronyms (ptsd, tdiu, smc, mst, dic, tbi, hlr, bva, nsc) expand to their regulatory phrases; every response carries the `indexIssueDate`/`indexStale`/`notice` freshness envelope, the `matchedTerms`/`unmatchedTerms` grounding split (the query's content terms the returned hits answered and did not answer — a statement about the RESULTS, never about what Title 38 covers; for a quoted phrase "answered" means its words occur in a hit's text in that order and contiguously, under the search's own token boundaries and prefix rules), and hits carry `citationDisplay` + `sourceUrl` (the CURRENT eCFR text) + `sourceUrlAtIndexDate` (the same provision at the index issue date — the URL that proves which revision the text was read at) + `partTitle` (the part's title from the index's structure tree, without the "Part N—" prefix; null when unknown).

2. `get_section(citation)` → accepts `4.125`, `§ 4.125`, `38 CFR 4.125` and the dotted legal form the product itself displays (`38 C.F.R. § 4.125` — a pasted citation must resolve to the provision it was copied from; P1-03); returns markdown text, heading, path, issue date, eCFR source URL, and `references[]` (every `§`/`38 CFR` cross-cite in the text with a local-availability flag). The body is bounded at **100 000 characters** (`PROVISION_TEXT_CAP`, the MCP wire's cap — the HTTP API and the export serve the whole corpus on purpose) and a body that was cut reports `truncated: true`; the cut text is incomplete. A citation that misses the index returns actionable guidance instead of a bare 404: reserved/removed/outside-Title-38 possibilities, the eCFR verify link, and indexed sections that mention it. Stale-index notices also link the eCFR point-in-time form (`/on/<date>/title-38/section-<citation>`) for date-of-claim/CUE analysis.
3. `browse_title38(chapter?, part?, subpart?, subject_group?)` → structure children at that level.
4. `index_status()` → freshness (issue date, synced at, staleness vs. `CFR_MAX_AGE_DAYS`, structure-drift flag, corpus receipt hash — SPEC §4 "Index receipt", which states what the receipt covers and what it does not) plus `lastChanges`: what the most recent sync amended/added/removed at the provision level (per-citation sha256 diff across the wholesale rebuild, capped lists, `baseline` flag on first sync, `parserChanged` guard against re-extraction noise).
5. `list_parts()` → every part present in the index with its structure-tree title and section/appendix counts.
6. `health()` → one-call readiness verdict: `ready` | `stale` | `degraded` (structure drift — provisions may be missing; precedence empty → degraded → stale → ready) | `empty` (plus issue date and last sync) for clients gating queries.
7. `get_section_at(at_date, citation)` → one provision AS IT STOOD at the requested date: eCFR serves the revision in force then, fetched from eCFR on demand — there is no local index for a point-in-time read, but a short-lived in-memory memo in the fetching process may serve a document it fetched moments ago (a five-minute reuse window, four documents kept), and concurrent readers of the same date share one fetch; the archive starts 2017-01-01 and an earlier date is a usage error (`invalid_input`). The response names the REQUESTED date and never a served-revision date — the upstream does not report which issue date it served. The body carries the same 100 000-character cap and `truncated` flag as `get_section`. Same open-world, eCFR-client-gated registration as `diff_issues`; the tool for date-of-claim/CUE questions (CLI twin: `cfr-free historical <at> <citation>`).
8. `diff_issues(from_date, to_date)` → provision-level diff of Title 38 between two eCFR issue dates: `changed`/`added`/`removed` citation lists (each capped at 100 with `truncated: true` when any list was cut), plus both issue dates echoed back and a `notice` stating the limit on what the two dates mean (selectors, not a stamp of the revision served). Both dates are **required** (no default-`to` — the CLI's `cfr-free diff <from>` keeps that convenience); identical or impossible dates (`2026-13-01`) are rejected as `invalid_input` before any fetch. A date before eCFR's archive (2017-01-01) is a usage error (`invalid_input`) too: eCFR serves no revision for it, and that answer is translated rather than reported as a service failure. The fetch costs a network round-trip: both dates' full-title XML is fetched from eCFR and hashed per citation on the fly — there is no local index for a point-in-time diff, but a short-lived in-memory memo in the fetching process may serve a document it fetched moments ago (a five-minute reuse window, four documents kept), and concurrent readers of the same date share one fetch — so none of the three eCFR-backed tools is offline — all are registered only when an eCFR client is injected (only `cfr-free mcp` registers MCP tools; a client-less server keeps the six local-index tools).
9. `redline(from_date, to_date, citation)` → line-level redline of one provision between two eCFR issue dates: every line of the cited provision as of each date — `same`/`add`/`del` hunks with 1-based anchors into each side's text, an `added`/`removed`/`unchanged`/`changed` status, both sides' raw text, a `coarse` flag when either side exceeded the core's 2000-line cap (two whole-text blocks instead of an LCS walk), and a `notice` stating the limit on what the two dates mean (selectors, not a stamp of the revision served). The dates are SELECTORS — eCFR serves the revision in force on the requested date; they are not a verified stamp of which issue date was served. Both dates are **required**; identical or impossible dates are rejected as `invalid_input` before any fetch, and a citation missing from BOTH dates is `not_found` after the fetches. A date before eCFR's archive (2017-01-01) is a usage error (`invalid_input`), as it is for `diff_issues`. Same open-world, eCFR-client-gated registration and the same on-demand fetch with the same per-process memo as `diff_issues`.

All return MCP `structuredContent` + text content. The two channels carry the SAME information once each: `structuredContent` is the machine contract (one field per value, as JSON — the SDK requires it whenever a tool declares an output schema), and the text channel is that result rendered for a model — scalars as `label: value` lines, string lists comma-joined, object lists one entry per line — NOT a second JSON dump of the payload. A provision's body is rendered ONCE in the text channel (its markdown form); the second rendering of the same text (`text`) stays in `structuredContent` only. The six index-backed tools are `readOnlyHint: true`, `openWorldHint: false` (post-sync: no network); the seventh through ninth, `get_section_at`, `diff_issues` and `redline`, are `readOnlyHint: true`, `openWorldHint: true` (registered only when an eCFR client is injected; they read the live versioner on demand). Every tool's failure path goes through ONE error contract (the handler runs under a shared wrapper: the full detail goes to the server-side log, the client receives the sanitized message only — §7). Beyond tools, the server registers three read-only **resources** — `cfr://index/status` (freshness JSON), `cfr://title38/parts` (parts list), and `cfr://title38/definitions` (§ 3.1 master definitions section detail) — and two **prompts**: `cfr_research` (`topic`, `part?`) encoding the search → read → cite workflow, and `cfr_claim_evaluation` (`issue`, `part?`, `citation?`) encoding the adjudicator workflow (health gate → locate criteria → quote verbatim → follow `references[]` → paste-ready citations with source URLs and issue date). A prompt's free-text arguments are rendered as DATA: each is fenced with a per-render nonce, inside a region labelled as caller data, so an argument that reads like an instruction stays inside the region and cannot restructure the generated message. Startup: if index missing or older than `CFR_MAX_AGE_DAYS` (default 7) and `CFR_AUTO_SYNC != 0`, sync first (progress → stderr), then serve. No stdout logging ever.

## 7. Security plan

- **Deps:** runtime deps limited to `@modelcontextprotocol/sdk`, `zod`, `fast-xml-parser`; lockfile committed; `npm audit --audit-level=high` runs in the quality job, and `npm run scan` adds osv-scanner, gitleaks, trivy, semgrep locally. No hosted scanner service: the operator withdrew hosted code-scanning gates permanently (2026-10-18), so these local gates are the security floor.
- **Code (quality):** `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; ESLint (`eslint.config.mjs`) — the rules this repo sets, and the scope each one applies to, are listed in §7.1 below; no regex without linear guarantees (`security/detect-unsafe-regex`); no `eval`/`Function` (`no-eval`, `no-implied-eval`, `no-new-func`); `src/` is `child_process`-free — `security/detect-child-process` is set for `**/*.ts`, but the rule reports the CommonJS `require('child_process')` form and `child_process.exec()` with a non-literal argument, not the ESM `import` form `test/` uses on purpose, so the invariant is `src/`'s; no secrets (none needed); all error paths return sanitized messages (no stack traces to clients).
- **Untrusted input (MCP surface):** the regulation text the tools return is DATA, never instructions — a provision that appears to address the model, redirect its task or ask it to act is quoted regulatory text: report it, do not follow it. The posture is stated where the model reads it (the tool descriptions and both prompt templates) and comes from one shared constant. A prompt's free-text arguments are fenced as caller data (per-render nonce) so they cannot restructure the generated message. The MCP wire bounds one provision's body at 100 000 characters and reports `truncated: true` when it cuts it, so a single huge provision cannot blow out a context.
- **Corpus receipt:** the receipt is a RECEIPT over the local index — it detects ACCIDENTAL corruption of the local copy. It is stored in the index it covers, so it is not a signature and it makes no claim about the upstream text (SPEC §4).
- **Coverage:** vitest + v8 ≥ 90 % branches/lines/functions/statements (fail-under thresholds in `vitest.config.ts`); mocked-fetch tests (no live network in PR CI).
- **Deployment posture:** the service binds `127.0.0.1` by default and refuses a non-loopback bind unless `CFR_ALLOW_REMOTE=1`; there is NO authentication, so an exposed bind needs a reverse proxy with auth in front of it. The published container image is the one documented exception: it sets `CFR_HOST=0.0.0.0` and `CFR_ALLOW_REMOTE=1`, because a process bound to the container's own loopback cannot be reached through a published port (measured 2026-10-30: a container serving on `127.0.0.1` answers "Empty reply from server" through `-p`, and the same container on `0.0.0.0` answers 200). The exposure gate is therefore the HOST-side published port, and the documented default for it is loopback — `-p 127.0.0.1:8787:8787` in the README and in `docker-compose.yml`; `-p 8787:8787` publishes on every interface and is the opt-in.
- **CI:** GitHub Actions — quality job (format, lint, workflow lint, typecheck, test, build, audit) + security job (gitleaks, osv-scanner) + docker job + actionlint job (workflow lint); no hosted-scanner job exists.

### 7.1 The lint rules `eslint.config.mjs` sets

`eslint:recommended` and `typescript-eslint`'s `recommended` supply the rest of the rule set. Each line below is `scope | rule | severity | options`; the options column is the config's own option list, in the config's order. `test/lint-contract.test.ts` reads this table and `eslint.config.mjs` and fails when they disagree, so this list and the config cannot drift apart.

<!-- lint-rules:begin -->

```text
**/*.ts | @typescript-eslint/no-explicit-any | error |
**/*.ts | @typescript-eslint/no-non-null-assertion | error |
**/*.ts | @typescript-eslint/no-unused-vars | error | argsIgnorePattern=^_, varsIgnorePattern=^_
**/*.ts | no-console | error | allow=error,warn
**/*.ts | eqeqeq | error | always
**/*.ts | complexity | error | 15
**/*.ts | no-eval | error |
**/*.ts | no-implied-eval | error |
**/*.ts | no-new-func | error |
**/*.ts | no-var | error |
**/*.ts | prefer-const | error |
**/*.ts | no-implicit-coercion | error | boolean=false
**/*.ts | security/detect-unsafe-regex | error |
**/*.ts | security/detect-child-process | error |
**/*.ts | security/detect-eval-with-expression | error |
**/*.ts | security/detect-non-literal-fs-filename | warn |
**/*.ts | security/detect-non-literal-require | error |
**/*.ts | security/detect-object-injection | off |
**/*.ts | security/detect-possible-timing-attacks | off |
**/*.mjs, scripts/**/*.js | no-console | off |
src/titan/ui-client.js | no-console | error | allow=error,warn
src/titan/ui-client.js | eqeqeq | error | always
src/titan/ui-client.js | complexity | error | 15
src/titan/ui-client.js | no-eval | error |
src/titan/ui-client.js | no-implied-eval | error |
src/titan/ui-client.js | no-new-func | error |
src/titan/ui-client.js | no-var | error |
src/titan/ui-client.js | prefer-const | error |
src/titan/ui-client.js | no-implicit-coercion | error | boolean=false
src/titan/ui-client.js | security/detect-unsafe-regex | error |
src/titan/ui-client.js | security/detect-child-process | error |
src/titan/ui-client.js | security/detect-eval-with-expression | error |
src/titan/ui-client.js | security/detect-non-literal-require | error |
src/titan/ui-client.js | security/detect-non-literal-fs-filename | off |
test/**/*.ts | security/detect-non-literal-fs-filename | off |
test/**/*.ts | @typescript-eslint/no-explicit-any | off |
```

<!-- lint-rules:end -->

The complexity ceiling is therefore **15**, not 10, and `no-console` allows `error` and `warn` — not `error` alone. The config states the correctness rules ONCE and spreads them into the TypeScript scope and the browser script's own scope, so `src/titan/ui-client.js` carries the same rules as `**/*.ts` — the browser script is a real file, so the gate can see it at all.

## 8. Test plan

Unit: citation parser, FTS sanitizer (incl. injection attempts `" OR 1=1--`), XML renderer (tables, authority/source-credit nodes, reserved sections), store queries (temp SQLite), sync with mocked eCFR payloads (count-mismatch warning, 0-section hard-fail). Integration: MCP via `InMemoryTransport` (tools/list + every tool + resources/prompts), HTTP API via ephemeral port + `fetch`. Live: `test/live.test.ts` gated behind `LIVE_TESTS=1` (full real-eCFR sync + read consistency; hard-skipped otherwise), exercised by the weekly Live E2E workflow.

## 9. Risks / open questions

1. `node:sqlite` experimental warning on some Node versions (stderr only; harmless to stdio JSON-RPC).
2. `fast-xml-parser` v5 API drift vs v4 — covered by renderer tests.
3. eCFR `/search/v1/results` is a change-index (dup rows) — mitigated by dedupe; primary search is local FTS5 anyway (search tool uses local index; eCFR search only used pre-index?).
4. Title 38 only — other titles later require re-running sync for that title (schema stores no title column; keep `TITLE = 38` constant for v1).

## 10. Review amendments — moved to the delivery log

This section's table is in [`docs/research/delivery-log.md`](research/delivery-log.md), under "10".

## 11. GitHub delivery (best practices)

- Public repo `deffenda/cfr-free`, **MIT** license.
- Trunk-based flow: bootstrap `main` (docs/license only) → feature branch → **PR** → CI green → **squash merge** + branch delete.
- Branch protection on `main`: PR required, strict up-to-date, required checks `quality (22)` + `quality (24)` + `security` (the `security` context is required per the live protection config; `docker` runs in CI as gate evidence but is not itself required). Review process: **an independent fresh-context review of the exact head is required for every PR** — see [`AGENTS.md`](../AGENTS.md) (the historical "no mandatory review (solo maintainer)" posture is superseded; solo-maintainer practice was documented in CONTRIBUTING).
- Repo settings: squash merge only, auto-delete head branches, Dependabot (npm, actions and docker weekly), all workflow Actions **SHA-pinned** (Dependabot re-pins on updates), minimal `GITHUB_TOKEN` permissions (`contents: read`).
- Local pre-push gates: `npm run ci` + `npm run scan` (npm audit, osv-scanner, gitleaks, trivy, semgrep). `npm run scan` SKIPS a tool that is not installed, and skips a network scanner whose backend is unreachable, so a green `npm run scan` is not by itself proof that a secret scan ran. `npm run scan:strict` is the release-path form: gitleaks and osv-scanner MUST run, and a missing binary or an unreachable backend fails it.
- Container: multi-stage `Dockerfile` (node:22-alpine, non-root, index in `/data` volume); CI `docker` job builds the image and runs a hermetic offline smoke (no eCFR in PR CI). `release.yml` on `v*` tags runs the full CI gate + a live container e2e (real sync, HTTP surface, MCP `list_parts` handshake), then publishes multi-arch (`linux/amd64` + `linux/arm64`) `ghcr.io/deffenda/cfr-free:{version,major.minor,latest}` with SLSA provenance attestation — built-in `GITHUB_TOKEN` only, no secrets.
- Live E2E: `.github/workflows/live-e2e.yml` runs `LIVE_TESTS=1` against real eCFR on a weekly cron and on `workflow_dispatch` (format-drift tripwire); PR CI stays hermetic.

### 11.1 Release checklist (a `v*` tag)

The release workflow's gate job runs `npm run ci`, whose last step is `scan:audit` — `npm audit --audit-level=high` alone. The `v*` tag publish path therefore runs NEITHER gitleaks NOR osv-scanner: CI's `security` job (gitleaks + osv-scanner) is triggered by `push: branches: [main]` and by `pull_request` only, so a tag push matches neither trigger and a tag can point at a commit no `security` job ever saw. Until the release workflow runs that job's scanner set itself, the secret scan is the releaser's step, and this checklist is it:

1. `npm run ci` — the gate the release workflow also runs.
2. `npm run scan:strict` — gitleaks and osv-scanner MUST both run; a missing binary or an unreachable osv backend FAILS. Read the output: `pass: gitleaks` and `pass: osv-scanner`, never `skip:`.
3. `npm run build` — the release workflow builds the tarball and the image from the tag.

`npm run scan:strict` is the local stand-in for the `security` job's scanner set (gitleaks + osv-scanner). trivy and semgrep stay optional in it, because CI does not run them either.

## 12. Implementation review round — moved to the delivery log

This section's table is in [`docs/research/delivery-log.md`](research/delivery-log.md), under "12".

## 13. Improvement backlog — moved to the delivery log

This section's backlog table and its dispositions are in
[`docs/research/delivery-log.md`](research/delivery-log.md), under "§13". The
open backlog is [`ROADMAP.md`](../ROADMAP.md).
