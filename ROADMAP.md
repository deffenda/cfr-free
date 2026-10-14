# cfr-free — TOP 10 IMPROVEMENTS

A prioritized roadmap for the highest-value improvements, focused on
user-facing value, operational robustness, ecosystem fit, and maintainability.

1. **MCP health check tool** — MCP clients need to know whether the index is
   ready before issuing queries. A dedicated `health` tool returns a simple
   `{status: 'ready'|'stale'|'empty'}` payload, letting clients avoid
   unnecessary requests against an unprepared index and improving ecosystem fit.

2. **Granular CLI exit codes** — Scripts currently only distinguish exit code 2
   (config/usage errors) from code 1 (everything else). Adding exit code 3
   ("index empty, auto-sync disabled") and exit code 4 ("port already in use")
   gives operators precise failure signals for automation and log correlation.

3. **Index backup / export subcommand** — There is no way to persist the SQLite
   index without re-downloading the full eCFR dump. A `cfr-free export <path>`
   command copies the index file, enabling disaster recovery, migration, and
   offline backup without repeat syncs, improving operational robustness.

4. **HTTP API rate limiting** — The Titan HTTP server has no protection against
   sustained or burst traffic. Adding simple per-IP rate limiting (e.g., 60
   requests/minute) prevents resource exhaustion under load, improves stability
   for self-hosted deployments, and aligns with operational robustness best
   practices.

5. **Prometheus `/metrics` endpoint** — Operators currently must parse the
   human-readable `index_status` output. A `GET /api/v1/metrics` route
   exposing row count, issue date, synced timestamp, and staleness flag in
   Prometheus exposition format gives instant observability without custom
   scraping, improving operational observability.

6. **MCP `list_parts` tool** — Users currently discover parts by trial-and-error
   searching. A `list_parts` tool enumerates every CFR part present in the local
   index with section counts, enabling rapid hierarchy discovery and improving
   user-facing value for new users.

7. **Concurrent sync prevention** — When `cfr-free sync` is invoked while another
   sync holds the SQLite lock, the CLI reports "sync in progress, please wait"
   instead of failing with a confusing database-locked error, improving failure
   modes and operator experience.

8. **Search result term transparency** — Search hits currently include a `snippet`
   but not the matching terms that drove the score. Surface the top contributing
   keywords per hit (e.g., "matched: 'traumatic brain injury'") to make results
   more explainable and improve user-facing value.

9. **Hardened HTTP query string size caps** — Beyond zod validation, enforce
   hard byte limits on all query parameters at the HTTP router level (e.g., `q`
   max 500 bytes, `part` max 10 chars), defending against malformed or malicious
   requests that could slip through validation and improving security surface
   area.

10. **Docker + docker-compose distribution** — Publish a `Dockerfile` and
    `docker-compose.yml` for single-process deployment (HTTP + MCP on stdio),
    lowering the barrier for new self-hosted users and improving ecosystem fit
    and packaging distribution.
