# cfr-free — Top 20 build items (groomed)

Mission filter: **accuracy and information quality for veteran support
officers and claims adjudicators evaluating a veteran's claim.** Every item
must make it easier to find, verify, quote, or trust the governing Title 38
CFR text. Groomed 2026-10-14 from the legacy top-10 (items 2, 3, 5, 6, 7, 8
already shipped: exit codes, `export`, `/metrics`, `list_parts`, concurrent
sync prevention, `matches[]`; item 10 ships as Dockerfile, compose follows).

## Round 1 — built (2026-10-14)

All ten items below shipped together with `docker-compose.yml` (item 11):
citation-direct pinning, phrase search, acronym expansion, cross-reference
extraction, freshness envelope, citation display/deep links, sentence-boundary
snippets, the `cfr_claim_evaluation` prompt, the `health` tool, and HTTP byte
caps. SPEC §5/§6 document the resulting surface.

1. **Citation-direct search resolution** — a query that _is_ a citation
   (`4.130`, `38 CFR 4.16`, `§ 3.350(a)`) must surface that exact section as
   the top hit. Adjudicators paste citations constantly; fuzzy keyword noise
   above the exact provision is a correctness failure.
2. **Quoted-phrase search** — quoted spans (`"traumatic brain injury"`) map
   to exact FTS5 phrase queries so verbatim regulatory language can be
   searched as written, not as loose token soup.
3. **VA acronym / phrase expansion** — curated synonym groups (`ptsd` ↔
   posttraumatic stress, `tdiu` ↔ individual unemployability, `smc` ↔ special
   monthly compensation, `mst`, `dic`, `tbi`, `hlr`, `bva`, `nsc`) so queries
   in either the acronym language of the rating office or the full regulatory
   language find the same provisions.
4. **Cross-reference extraction** — `get_section` returns `references[]`:
   every `§ 4.105` / `38 CFR 4.130` mentioned in the text, with an
   `available` flag (present locally vs. needs eCFR). Claims reasoning
   routinely ping-pongs across parts; surfacing the web of citations removes
   manual grep work.
5. **Freshness envelope on every response** — search and section reads carry
   `indexIssueDate`, `indexStale`, and a `notice` when the index is stale, so
   an AI client can never unknowingly quote a lapsed version.
6. **Legal citation formatting + eCFR deep links on hits** — every hit gains
   `citationDisplay` (`38 C.F.R. § 4.130`) and `sourceUrl`, ready to paste
   into a rating decision or brief.
7. **Sentence-boundary snippet windows** — snippets widen (36 tokens) and
   never start mid-sentence, so quoted context reads as prose, not shards.
8. **Claim-evaluation MCP prompt** — `cfr_claim_evaluation(issue, part?,
citation?)` encodes the adjudicator workflow: locate criteria → read
   verbatim → follow cross-references → cite with source URL and issue date.
9. **MCP `health` tool** — `ready | stale | empty` in one call; clients gate
   queries on it instead of parsing full status payloads.
10. **HTTP query byte caps** (legacy #9) — router-level hard limits
    (URL ≤ 2048 bytes, `q` ≤ 800 bytes, `part` ≤ 10 bytes) on top of zod, so
    malformed oversized requests die before validation.

## Next round

11. **`docker-compose.yml`** (legacy #10 remainder) — single-command
    deployment: HTTP server, `/data` volume, healthcheck. **Built in Round 1.**
12. **Rate limiting for remote binding** (legacy #4) — token bucket keyed by
    peer address, active only when `CFR_ALLOW_REMOTE=1`. **Built.**
13. **Sync-change report** — per-citation content hashes across syncs:
    "N sections amended since your last sync" with the list. **Built**
    (schema-free: outgoing hashes captured before the wholesale rebuild;
    `index_status`/`/health`/`cfr-free sync` report carry the diff).
14. **Reserved / removed section clarity** — reads of reserved or vanished
    citations say so explicitly instead of `not_found`. **Built** (Title 38
    has no reserved placeholders in the XML, so vanished citations get
    reserved/removed/outside-Title-38 guidance + the eCFR verify link +
    indexed sections that mention them).
15. **Historical-version guidance** — effective-date-of-claim disclaimer with
    a deep link to the eCFR historical/annual-edition archive (CUE claims).
    **Built** (stale notices + the claim-evaluation prompt link the verified
    point-in-time URL form `/on/<date>/title-38/section-<citation>`).

## Later

16. **OpenAPI 3.1 document** (§13 #17) for third-party API consumers. **Built**
    (v0.2.0, PR #21).
17. **Auto-refresh stale index at startup** (§13 #14) beyond `CFR_AUTO_SYNC`.
    **Built** (opt-in CFR_REFRESH_HOURS, PR #22).
18. **Per-section amendment dates** — research eCFR's amendment metadata
    feed; if derivable, attach `amendedAt` to sections (gold for date-of-claim
    analysis).
    **Researched — not bulk-derivable** (2026-10-18, see
    docs/research/amendment-dates.md): no section-level amendment feed exists;
    per-section `starts_on` is available but at ~1 request/section per sync.
    Date-of-claim path remains the point-in-time URL links shipped in §4.
19. **Definitions quick access** — dedicated path to §3.1 master definitions
    (e.g. "established profession of medicine") from tools/resources.
    **Built** (MCP resource `cfr://title38/definitions`, PR #24).
20. **Appendix parity in browse** — verify appendices appear in `browse` and
    `list_parts` navigation consistently with sections.
    **Verified** (2026-10-18): browse returns all children unfiltered (appendix
    entries included, `type: 'appendix'`); fixtures pin appendix children in
    part-level browse and per-part counts; live corpus confirms part 4 ships 3
    appendix structure entries + 3 indexed appendix rows. No code change.
