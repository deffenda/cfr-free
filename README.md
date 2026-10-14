# cfr-free

[![CI](https://github.com/deffenda/cfr-free/actions/workflows/ci.yml/badge.svg)](https://github.com/deffenda/cfr-free/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Self-hosted **Title 38 CFR data service**: it builds a local, full-text
searchable index of Title 38 of the Code of Federal Regulations (the VA
benefits rulebook) straight from the public
[eCFR API](https://www.ecfr.gov/developers/documentation/api/v1), and serves
it through an **MCP server** (for AI assistants like Claude) and a small
**HTTP API** ("Titan-style" query surface). No cloud dependencies, no API
keys, no telemetry — one Node process and one SQLite file.

## What you get

- **Local full-text search** over every section and appendix of Title 38,
  powered by SQLite FTS5 (BM25-ranked with citation/heading weighting,
  relevance snippets, and the matched terms shown per hit).
- **MCP server** with five read-only tools any MCP client can use:
  `search_regulations`, `get_section`, `browse_title38`, `index_status`,
  `list_parts`.
- **HTTP JSON API** for scripts and apps: search, read sections, browse the
  CFR hierarchy, health check, Prometheus metrics.
- **Freshness tracking**: the index records the eCFR issue date it was built
  from and warns when it goes stale or drifts from the structure tree.
- **Backup-friendly**: `cfr-free export <path>` writes a consistent snapshot
  of the index you can copy anywhere.

## Requirements

- Node.js **≥ 22.5** (uses the built-in `node:sqlite`; SQLite ≥ 3.50 with
  FTS5, bundled with Node 22.5+)
- Network access only for `cfr-free sync` (~2–3 MB from ecfr.gov); serving
  and searching are fully offline.

## Quickstart

```bash
npm install -g cfr-free    # or: npx cfr-free
cfr-free sync              # build the local index (~2-3 MB download)
cfr-free serve             # HTTP API on http://127.0.0.1:8787
# or
cfr-free mcp               # MCP server on stdio (default command)

cfr-free export ./backup.sqlite   # consistent snapshot of the local index
```

### Docker

```bash
docker run -d --name cfr-free -p 8787:8787 -v cfr-data:/data \
  ghcr.io/deffenda/cfr-free:latest
```

The container syncs on first start (~15 s, ~2–3 MB from eCFR), then serves
the HTTP API; the index persists in the `cfr-data` volume mounted at `/data`.
Any CLI command works the same way, e.g.
`docker run --rm -v cfr-data:/data ghcr.io/deffenda/cfr-free:latest sync` to
refresh, or `… export /data/backup.sqlite` to snapshot into the volume.

The image runs as a non-root user and binds `0.0.0.0` with the remote opt-in
already set — inside a container the published port (`-p`) is the exposure
gate, and loopback would make it unreachable. Outside Docker the CLI still
defaults to `127.0.0.1` with `CFR_ALLOW_REMOTE=1` required. Images are
published to GHCR on `v*` tags with build-provenance attestations.

### Use with Claude (MCP)

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cfr-free": {
      "command": "cfr-free",
      "args": ["mcp"]
    }
  }
}
```

Then ask things like _"What does 38 CFR 4.125 say about diagnosing mental
disorders?"_ or _"Search Title 38 for traumatic brain injury compensation."_

### MCP tools

| Tool                 | Arguments                              | Returns                                                    |
| -------------------- | -------------------------------------- | ---------------------------------------------------------- |
| `search_regulations` | `query`, `page?`, `per_page?`, `part?` | Ranked hits: citation, heading, snippet, score, matches    |
| `get_section`        | `citation` (e.g. `38 CFR 4.125`)       | Full section text as markdown + ecfr.gov link              |
| `browse_title38`     | `chapter?`, `part?`, `subpart?`        | Children of the requested hierarchy level                  |
| `index_status`       | —                                      | Issue date, last sync, row counts, staleness, drift flag   |
| `list_parts`         | —                                      | Parts in the index with titles and section/appendix counts |

All tools are **read-only** and query only the local index — they never hit
the network.

Beyond tools, the server exposes two MCP **resources** that clients can read
directly — `cfr://index/status` (freshness JSON: issue date, last sync, row
counts, staleness, drift) and `cfr://title38/parts` (parts with titles and
counts) — plus one **prompt**, `cfr_research` (`topic`, `part?`), which walks a
model through the search → read → cite workflow before answering.

### HTTP API

| Method         | Path                         | Query params                               |
| -------------- | ---------------------------- | ------------------------------------------ |
| `GET` / `HEAD` | `/health`                    | —                                          |
| `GET` / `HEAD` | `/metrics`                   | — (Prometheus text format)                 |
| `GET` / `HEAD` | `/api/v1/search`             | `q` (required), `page`, `per_page`, `part` |
| `GET` / `HEAD` | `/api/v1/sections/:citation` | — (URL-encode citations with spaces)       |
| `GET` / `HEAD` | `/api/v1/browse`             | `chapter`, `part`, `subpart`               |

```bash
curl 'http://127.0.0.1:8787/api/v1/search?q=traumatic%20brain%20injury&part=4'
curl 'http://127.0.0.1:8787/api/v1/sections/4.125'
curl 'http://127.0.0.1:8787/api/v1/browse?chapter=I&part=17'
curl 'http://127.0.0.1:8787/metrics'
```

The API is intentionally minimal: **GET-only, JSON-only, no request bodies,
no templating**, bound to `127.0.0.1` by default. The single deliberate
exception is `/metrics`, which serves Prometheus exposition text for
scrapers. There is **no authentication** — if you bind it to a non-loopback
address you must put it behind your own reverse proxy/auth
(`CFR_ALLOW_REMOTE=1` is required to allow that, as an explicit opt-in).

## Configuration

All configuration is environment variables (flags are deliberately avoided so
MCP client configs stay uniform):

| Variable           | Default                    | Meaning                                 |
| ------------------ | -------------------------- | --------------------------------------- |
| `CFR_INDEX_PATH`   | `~/.cfr-free/index.sqlite` | SQLite index location                   |
| `CFR_MAX_AGE_DAYS` | `7`                        | Index older than this is reported stale |
| `CFR_AUTO_SYNC`    | `1`                        | Sync at startup when index empty/stale  |
| `CFR_HOST`         | `127.0.0.1`                | HTTP bind address                       |
| `CFR_PORT`         | `8787`                     | HTTP bind port                          |
| `CFR_ALLOW_REMOTE` | unset                      | Set `1` to permit non-loopback binds    |
| `CFR_LOG_LEVEL`    | `info`                     | `debug` \| `info` \| `warn` \| `error`  |

Logs are structured JSON lines on **stderr** only — stdout is reserved for
MCP's JSON-RPC protocol.

### Exit codes

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| `0`  | Success                                                    |
| `1`  | Generic error (sync failure, corrupt index, …)             |
| `2`  | Usage or configuration error                               |
| `3`  | Index unavailable (empty, and auto-sync disabled)          |
| `4`  | HTTP port could not be bound (in use or permission denied) |

Scripts can branch on these — e.g. retry later on `3`, pick another port
on `4`.

## Development

```bash
npm ci
npm run ci           # format:check + lint + typecheck + tests + build + audit
npm run test:coverage
npm run scan         # gitleaks + osv-scanner + trivy + semgrep (skips missing tools)
```

### Local LLM review (Gemma via LM Studio)

```bash
npm run review            # reviews docs/SPEC.md + src/ with the local model
npm run review:spec       # spec only
```

Talks to LM Studio's OpenAI-compatible endpoint (`http://localhost:1234` by
default, model `google/gemma-4-12b`). Configure with `LMSTUDIO_BASE_URL`,
`LMSTUDIO_MODEL`, `LLM_REVIEW_TIMEOUT_MS`, or `--model` / `--base-url` /
`--max-tokens` / `--instruction` flags. Reasoning models are handled
automatically (retries with a larger token budget when the visible answer
has not been emitted yet).

## Architecture

```
eCFR API ──sync──▶ SQLite (sections + FTS5 + structure meta)
                     ▲                 ▲
                     │                 │
              MCP tools (stdio)   HTTP API (node:http)
```

- `src/core/` — eCFR client, XML parser, FTS5 store, sync, service facade
- `src/mcp/` — MCP server and tool registrations
- `src/titan/` — HTTP JSON API
- `src/commands/` — `sync`, `serve`, `mcp`
- `docs/SPEC.md` — design decisions and review dispositions

Sync is atomic: the whole index is replaced inside one `BEGIN IMMEDIATE`
transaction under WAL, so concurrent readers never see a partial build, and
an interrupted sync simply rolls back.

## Data source & attribution

Regulatory content comes from the **eCFR API** operated by the Office of the
Federal Register and the Government Publishing Office. eCFR content is in the
public domain (17 U.S.C. § 105). cfr-free is an independent project and is
**not** endorsed by or affiliated with the VA, the OFR, or GPO. This tool is
not legal advice; verify citations against the official eCFR.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities and the security
posture summary. Reported by default: Snyk/Sonar-ready lint and CI gates,
zero runtime dependencies beyond the MCP SDK, XML parser hardening (no
DOCTYPE, bounded depth/size), FTS query sanitization (no SQL injection
surface), and loopback-only networking by default.

## License

[MIT](LICENSE)
