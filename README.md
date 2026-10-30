# cfr-free

[![CI](https://github.com/deffenda/cfr-free/actions/workflows/ci.yml/badge.svg)](https://github.com/deffenda/cfr-free/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/deffenda/cfr-free/blob/main/LICENSE)

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
- **Honest about images:** a few provisions publish their rating tables as
  eCFR images rather than text. Those provisions carry an explicit
  `[image content not included: <path>]` marker where the graphic belongs,
  so a missing table is never mistaken for complete text. Nothing is
  fetched or transcribed — the service stays fully offline.
- **Read-only web UI** (search, browse, section reads, line-level redlines,
  copy-a-citation) over the same JSON API.
- **MCP server** with nine read-only tools any MCP client can use: six
  offline index-backed ones (`search_regulations`, `get_section`,
  `browse_title38`, `index_status`, `list_parts`, `health`) plus three that
  fetch the live eCFR versioner per call (`get_section_at` (one provision
  as it stood at a date), `diff_issues`, `redline`).
- **HTTP JSON API** for scripts and apps: search, read sections, browse the
  CFR hierarchy, health check, Prometheus metrics.
- **Measured retrieval**: a frozen query set and runner score the search
  over citations, abbreviations and plain-language questions — see
  `docs/research/retrieval-baseline-2026-10-20.md`.
- **Freshness tracking**: the index records the eCFR issue date it was built
  from and warns when it goes stale or drifts from the structure tree.
- **Backup-friendly**: `cfr-free export <path> [jsonl|md]` writes a consistent
  snapshot of the index you can copy anywhere (sqlite default; `jsonl` and `md`
  for pipeline ingestion).

## Requirements

- Node.js **≥ 22.5** (uses the built-in `node:sqlite`; SQLite ≥ 3.50 with
  FTS5, bundled with Node 22.5+)
- Network access only for `cfr-free sync`, `cfr-free diff`,
  `cfr-free redline` and `cfr-free historical` (~2–3 MB from ecfr.gov
  per full-title fetch; the two-date views fetch twice); the startup
  refresh of a stale or empty index by `search`, `serve` and `mcp`
  (unless `CFR_AUTO_SYNC=0`); the opt-in periodic re-sync in `serve`
  and `mcp` when `CFR_REFRESH_HOURS` is set (default 0 = off);
  `serve`'s `/api/v1/diff` and `/api/v1/redline` routes; and `mcp`'s
  three eCFR-backed tools (`get_section_at`, `diff_issues`, `redline`),
  which fetch from eCFR on every call. Reads from a fresh index never
  touch the network.

## Quickstart

Five ways in, depending on what you have. The first needs nothing but
Docker; the second needs only npm; the third needs only Node and runs
the package straight from a release tarball (no compiler); the fourth
needs npm and a compiler; the fifth needs a checkout.

### 1. Docker (nothing to install)

```bash
docker run -d --name cfr-free -p 8787:8787 -v cfr-data:/data \
  ghcr.io/deffenda/cfr-free:latest
```

The image is public and pulls anonymously. It syncs the index on first
start (~5 s, ~2–3 MB from eCFR) and serves the API on
<http://127.0.0.1:8787>; the index persists in the `cfr-data` volume. Any
CLI command works the same way, e.g. `docker run --rm -v cfr-data:/data
ghcr.io/deffenda/cfr-free:latest sync` to refresh, or `… export
/data/backup.sqlite` to snapshot into the volume. Details under
[Docker](#docker) below.

### 2. From npm (no compiler, no Docker)

```bash
npm install -g cfr-free

# or, with no install at all:
npx -y cfr-free version         # -> 0.2.1
npx -y cfr-free sync            # build the local index (~2-3 MB, ~5 s)
npx -y cfr-free serve           # HTTP API on http://127.0.0.1:8787
```

The published tarball ships the compiled `dist/`, so this route needs
neither a compiler nor a checkout — it is the fastest way in.

### 3. From a release tarball (no compiler)

```bash
npx -y https://github.com/deffenda/cfr-free/releases/download/v0.2.1/cfr-free-0.2.1.tgz version  # -> 0.2.1
npx -y https://github.com/deffenda/cfr-free/releases/download/v0.2.1/cfr-free-0.2.1.tgz serve    # HTTP API on http://127.0.0.1:8787
```

Every GitHub release carries the package tarball at
`releases/download/<tag>/cfr-free-<version>.tgz`; for `v0.2.1` that
tarball holds the same contents the npm registry serves (verified by
unpacking both: identical file trees). `npx` installs the tarball
directly from the URL — the `cfr-free` package itself never comes from
the registry, no compiler runs on first use, and the version in the URL
pins the release exactly. `npx` does still fetch the package's runtime
dependencies from npm (they are not bundled). Verified on the `v0.2.1`
release, 2026-10-29: both commands above ran end to end (`version` →
`0.2.1`; `serve` answered `/health` with HTTP 200). Swap the tag and
filename together to pick another release.

### 4. From GitHub (no publish step)

```bash
npx -y github:deffenda/cfr-free version    # -> 0.2.2
npx -y github:deffenda/cfr-free serve      # HTTP API on http://127.0.0.1:8787
```

`npx` fetches and compiles the project on first use, so the first run takes
a minute and needs a compiler (npm runs the project's `prepare` script when
it installs from a git URL, and that script runs `tsc`). The Docker route
above needs neither.

To use it as a dependency of your own project:

```bash
npm install github:deffenda/cfr-free
```

> **A global install from a git URL (`npm install -g github:…`) does not
> work**, and the failure is npm's rather than the project's. Measured on
> npm 11.20.0, five runs in a row left the SAME broken end state: the
> package is not installed, and the `cfr-free` command npm puts in your
> PATH points at a file that does not exist, so running it fails with "no
> such file or directory".
>
> Whether npm _reports_ the failure varies, and the quiet case is the more
> misleading one: most runs print "added 104 packages" and exit 0, so
> nothing looks wrong until you run the command; some abort part-way with
> `ENOENT … chmod … node_modules/which/bin/node-which` (exit 254). On npm
> 10.9.9 the same class of failure presents as a dropped dependency tree
> (`ENOENT … readlink … node_modules/.bin/fxparser`). All of this was
> measured, and it reproduces on the unmodified repository too. Use `npx`, a
> project-local install, the npm route above, or the Docker image instead —
> all four were re-verified on npm 11.20.0.

### 5. From a source checkout

```bash
# requires Node >= 22.5
git clone https://github.com/deffenda/cfr-free.git
cd cfr-free
npm ci                  # install the pinned dependencies
npm run build           # compile to dist/ (the CLI entry point is dist/cli.js)

node dist/cli.js version        # -> 0.2.2   (verifies the build)
node dist/cli.js sync           # build the local index (~2-3 MB download, ~5 s)
node dist/cli.js serve          # HTTP API on http://127.0.0.1:8787
# or
node dist/cli.js mcp            # MCP server on stdio (default command)

node dist/cli.js export ./backup.sqlite   # consistent snapshot of the local index

node dist/cli.js search PTSD               # ranked provisions from the local index (top 10)

node dist/cli.js diff 2026-01-01 2026-06-01   # provision changes between two issue dates
node dist/cli.js redline 2026-01-01 2026-06-01 4.125   # line-level redline of one provision
```

`npm link` in the checkout puts `cfr-free` on your PATH, after which the
examples above work verbatim as `cfr-free …`.

`cfr-free sync` writes the index at `~/.cfr-free/index.sqlite`. To try it
against a throwaway index instead of your own, point `CFR_INDEX_PATH`
somewhere else:

```bash
CFR_INDEX_PATH=/tmp/cfr-smoke.sqlite node dist/cli.js sync   # ~5 s, then delete the file
```

### Docker

```bash
docker run -d --name cfr-free -p 8787:8787 -v cfr-data:/data \
  ghcr.io/deffenda/cfr-free:latest
```

The container syncs on first start (~5 s, ~2–3 MB from eCFR), then serves
the HTTP API; the index persists in the `cfr-data` volume mounted at `/data`.
Any CLI command works the same way, e.g.
`docker run --rm -v cfr-data:/data ghcr.io/deffenda/cfr-free:latest sync` to
refresh, or `… export /data/backup.sqlite` to snapshot into the volume.

The image runs as a non-root user and binds `0.0.0.0` with the remote opt-in
already set — inside a container the published port (`-p`) is the exposure
gate, and loopback would make it unreachable. Outside Docker the CLI still
defaults to `127.0.0.1` with `CFR_ALLOW_REMOTE=1` required. When you do
expose it, a per-peer token-bucket rate limit (60-burst, 10 req/s) turns on
automatically. Images are published to GHCR on `v*` tags with
build-provenance attestations.

Prefer Compose? `docker compose up -d --build` serves the API on
`127.0.0.1:8787` with a named volume, healthcheck, and sync left explicit
(`docker compose run --rm cfr-free sync`) so starts never trigger a surprise
download.

The package is on npm (`npm view cfr-free version` prints the latest; see
[Quickstart](#quickstart)). Releases publish from the `v*`-tag workflow
with OIDC provenance (no publish token), gated behind the
`NPM_TRUSTED_PUBLISHING` repository variable plus one-time
trusted-publisher registration on npmjs.com. The publish job verifies
before it publishes that the packed tarball carries the executable and
every file it imports, and that the tag matches the `package.json`
version — so a release cannot ship a broken package.

### Verify the install (smoke checklist)

Every command below was run against an isolated throwaway index
(`CFR_INDEX_PATH=/tmp/smoke.sqlite`) on the 2026-10-16 corpus; the
outputs are what you should see. Nothing outside `/tmp` is touched.
**The install routes were measured, not assumed.** A clean global install of
the packed tarball into a throwaway prefix was run and the installed binary
was exercised (`--version`, and a search against a copy of the index); the
GitHub Release asset route — the same tarball, fetched from a release URL —
was created, downloaded and installed end to end **in a scratch
repository**; it now also runs straight from this repository's own
releases (`v0.2.1`, verified 2026-10-29, see [Quickstart](#quickstart)). A
project-local `npm install github:deffenda/cfr-free` was run and its
binary exercised, and `npx -y github:deffenda/cfr-free` was run, MCP over
stdio included.
The route that does **not** work — `npm install -g github:…` — was measured
too, and the failure is npm's (see [Quickstart](#quickstart)). The sequence
below was run against a provisioned checkout; what it does not cover is an
install on a machine with no npm cache and no network beyond the first
fetch.

```bash
export CFR_INDEX_PATH=/tmp/smoke.sqlite   # never your real index

# 1. the build is what you think it is
node dist/cli.js version                  # -> 0.2.2

# 2. network: build the index (~2-3 MB, ~5 s)
node dist/cli.js sync
# -> synced 2953 sections + 17 appendices (issue date 2026-10-16; ...
#    9 provisions contain image content not included; 2134 ms; corpus hash ...)

# 3. HTTP read (no network from here on)
CFR_PORT=8791 node dist/cli.js serve & SERVER_PID=$!
curl -s http://127.0.0.1:8791/health | head -c 80
# -> {"status":"ok","issueDate":"2026-10-16","syncedAt":...
curl -s 'http://127.0.0.1:8791/api/v1/search?q=4.130&per_page=1' | head -c 80
# -> {"query":"4.130","page":1,"perPage":1,"total":42,...
curl -s http://127.0.0.1:8791/api/v1/sections/4.130 | head -c 80
# -> {"citation":"4.130","kind":"section","heading":"Schedule of ratings...

# 4. offline restart: reads come from the local index, no network
kill "$SERVER_PID"; CFR_PORT=8791 node dist/cli.js serve & SERVER_PID=$!
# /health answers identically — that is the point

# 5. MCP over stdio: initialize, then call a tool
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_section","arguments":{"citation":"38 C.F.R. § 4.130"}}}' \
  | node dist/cli.js mcp | tail -1 | head -c 120
# -> {"result":{"content":[{"type":"text","text":"{\n  \"citation\": \"4.130\"...
# (note: the DOTTED display citation resolves — P1-03)

# 6. export: the whole corpus, offline
node dist/cli.js export /tmp/smoke.jsonl jsonl
# -> exported 2970 provisions as jsonl (17062107 bytes) to /tmp/smoke.jsonl

kill "$SERVER_PID"; rm -f /tmp/smoke.sqlite /tmp/smoke.jsonl   # clean up
```

Only steps 1–2 need the network; 3–6 are fully offline once the index
exists. If step 3 answers and step 4 answers identically after the
restart, your install reads from the local index exactly as intended.

### Use with Claude (MCP)

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cfr-free": {
      "command": "npx",
      "args": ["-y", "cfr-free", "mcp"]
    }
  }
}
```

Using Claude Code? The same server registers in one command (verified
2026-10-29):

```bash
claude mcp add cfr-free -- npx -y cfr-free mcp
```

That writes the local scope — this project only, the default;
`claude mcp add -s user cfr-free -- npx -y cfr-free mcp` registers it for
every project instead.

All of these forms run `npx -y cfr-free mcp` under the hood: nothing
installed, no path to edit, and the published tarball ships compiled —
no compiler runs on first use. The JSON config also works from the git URL
(`"args": ["-y", "github:deffenda/cfr-free", "mcp"]`), which `npx` fetches
and compiles on first use (verified end to end: the `list_parts` tool
answers over stdio). If you built it from a checkout, use the absolute
path to the built CLI, because MCP clients do not inherit your shell's
`PATH`:

```json
{
  "mcpServers": {
    "cfr-free": {
      "command": "/absolute/path/to/cfr-free/dist/cli.js",
      "args": ["mcp"]
    }
  }
}
```

Then ask things like _"What does 38 CFR 4.125 say about diagnosing mental
disorders?"_ or _"Search Title 38 for traumatic brain injury compensation."_

### MCP tools

| Tool                 | Arguments                                                   | Returns                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `search_regulations` | `query`, `page?`, `per_page?`, `part?`, `kind?`, `chapter?` | Ranked hits: citation (+ `38 C.F.R. §` display form, ecfr.gov link), heading, snippet, score, matches — with exact-citation pinning, `"quoted phrase"` search, and claims-acronym expansion (PTSD, TDIU, SMC, …). Each response also carries `matchedTerms`/`unmatchedTerms`: the query's content words the returned hits did and did not answer |
| `get_section`        | `citation` (e.g. `38 CFR 4.125`)                            | Full section text as markdown + ecfr.gov link + cross-references with availability flags                                                                                                                                                                                                                                                         |
| `browse_title38`     | `chapter?`, `part?`, `subpart?`, `subject_group?`           | Children of the requested hierarchy level (a `subject_group` holds the sections of one regulatory subject)                                                                                                                                                                                                                                       |
| `index_status`       | —                                                           | Issue date, last sync, row counts, staleness, drift flag, corpus receipt hash, and what the last sync amended/added/removed                                                                                                                                                                                                                      |
| `list_parts`         | —                                                           | Parts in the index with titles and section/appendix counts                                                                                                                                                                                                                                                                                       |
| `health`             | —                                                           | One-call readiness verdict: `ready`, `stale`, `degraded` (structure drift), or `empty`                                                                                                                                                                                                                                                           |
| `get_section_at`     | `at_date` (YYYY-MM-DD), `citation`                          | One provision as it stood at a date: the eCFR revision in force then, fetched statelessly on every call (no local index; the point-in-time archive starts 2017-01-01)                                                                                                                                                                            |
| `diff_issues`        | `from_date`, `to_date`                                      | Provision-level diff between two eCFR issue dates: changed/added/removed citations (capped, with a truncation flag)                                                                                                                                                                                                                              |
| `redline`            | `from_date`, `to_date`, `citation`                          | Line-level redline of one provision between two eCFR issue dates: status, both sides' text, and per-line hunks                                                                                                                                                                                                                                   |

All tools are **read-only**; the six index tools query only the local index and
never hit the network, while `get_section_at`, `diff_issues` and `redline`
fetch from eCFR on each call (a point-in-time revision, or two issue dates'
full-title XML). Search and section responses carry a freshness envelope
(`indexStale` + a `notice` when the local index has aged out) so a client can
never unknowingly quote a lapsed version.

Beyond tools, the server exposes three MCP **resources** that clients can read
directly — `cfr://index/status` (freshness JSON: issue date, last sync, row
counts, staleness, drift, corpus receipt hash), `cfr://title38/parts` (parts with titles and
counts), and `cfr://title38/definitions` (§ 3.1 master definitions section
detail) — plus two **prompts**: `cfr_research` (`topic`, `part?`), which walks
a model through the search → read → cite workflow, and
`cfr_claim_evaluation` (`issue`, `part?`, `citation?`), which encodes the
adjudicator workflow: readiness gate → locate criteria → quote verbatim →
follow cross-references → paste-ready citations with source URLs.

### HTTP API

| Method         | Path                         | Query params                                                           |
| -------------- | ---------------------------- | ---------------------------------------------------------------------- |
| `GET` / `HEAD` | `/health`                    | —                                                                      |
| `GET` / `HEAD` | `/metrics`                   | — (Prometheus text format)                                             |
| `GET` / `HEAD` | `/api/v1/search`             | `q` (required), `page`, `per_page`, `part`, `kind`, `chapter`          |
| `GET` / `HEAD` | `/api/v1/sections/:citation` | — (URL-encode citations with spaces)                                   |
| `GET` / `HEAD` | `/api/v1/browse`             | `chapter`, `part`, `subpart`, `subjgrp`                                |
| `GET` / `HEAD` | `/api/v1/diff`               | `from`, `to` (both required; fetches from eCFR per request)            |
| `GET` / `HEAD` | `/api/v1/redline`            | `from`, `to`, `citation` (all required; fetches from eCFR per request) |

`/health` and `/metrics` additionally expose `diskFree`/`diskTotal` and the
`cfr_free_disk_free_bytes`/`cfr_free_disk_total_bytes` gauges when the platform
provides `fs.statfs` (as of boot or last refresh round); omitted otherwise.

The three index-backed reads (`/api/v1/search`, `/api/v1/sections/:citation`,
`/api/v1/browse`) send a strong `ETag` over the response payload. Resend it as
`If-None-Match` and the server answers `304 Not Modified` with no body when the
text has not changed, so a client can confirm the provision it quotes without
downloading it again:

```bash
etag=$(curl -sD - -o /dev/null 'http://127.0.0.1:8787/api/v1/sections/4.125' \
  | awk 'tolower($1) == "etag:" { print $2 }' | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $etag" \
  'http://127.0.0.1:8787/api/v1/sections/4.125'   # 304
```

`/health`, `/metrics` and the two eCFR-fetching routes (`/api/v1/diff`,
`/api/v1/redline`) carry no validator, and an error response is never a 304.

```bash
curl 'http://127.0.0.1:8787/api/v1/search?q=traumatic%20brain%20injury&part=4'
curl 'http://127.0.0.1:8787/api/v1/sections/4.125'
curl 'http://127.0.0.1:8787/api/v1/browse?chapter=I&part=17'
curl 'http://127.0.0.1:8787/metrics'
```

The full request/response contract (schemas, error envelopes) is documented in
[`docs/openapi.yaml`](https://github.com/deffenda/cfr-free/blob/main/docs/openapi.yaml) (OpenAPI 3.1).

The API is intentionally minimal: **GET-only, no request bodies, no
templating**, bound to `127.0.0.1` by default. The deliberate non-JSON
responses are `/metrics` (Prometheus exposition text for scrapers) and the
static web UI assets. There is **no authentication** — if you bind it to a
non-loopback address you must put it behind your own reverse proxy/auth
(`CFR_ALLOW_REMOTE=1` is required to allow that, as an explicit opt-in).

The serve root `/` also serves a **read-only web UI** (search + section
reader with chapter/part browse + a redline view, over the same JSON API, hash-routed) — no auth, loopback bind by
default like the rest of the surface.

## Configuration

All configuration is environment variables (flags are deliberately avoided so
MCP client configs stay uniform):

| Variable            | Default                    | Meaning                                                    |
| ------------------- | -------------------------- | ---------------------------------------------------------- |
| `CFR_INDEX_PATH`    | `~/.cfr-free/index.sqlite` | SQLite index location                                      |
| `CFR_MAX_AGE_DAYS`  | `7`                        | Index older than this is reported stale                    |
| `CFR_AUTO_SYNC`     | `1`                        | Sync at startup when index empty/stale                     |
| `CFR_REFRESH_HOURS` | `0`                        | Hours between background refreshes while serving (0 = off) |
| `CFR_HOST`          | `127.0.0.1`                | HTTP bind address                                          |
| `CFR_PORT`          | `8787`                     | HTTP bind port                                             |
| `CFR_ALLOW_REMOTE`  | unset                      | Set `1` to permit non-loopback binds                       |
| `CFR_LOG_LEVEL`     | `info`                     | `debug` \| `info` \| `warn` \| `error`                     |

Logs are structured JSON lines on **stderr** only — stdout is reserved for
MCP's JSON-RPC protocol.

### Exit codes

| Code | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| `0`  | Success                                                                       |
| `1`  | Generic error (sync failure, corrupt index, …)                                |
| `2`  | Usage or configuration error                                                  |
| `3`  | Index unavailable (empty, and auto-sync disabled)                             |
| `4`  | HTTP port could not be bound (in use or permission denied)                    |
| `5`  | Refused to overwrite an existing export file (remove it or pick another path) |

Scripts can branch on these — e.g. retry later on `3`, pick another port
on `4`.

## Development

```bash
npm ci
npm run ci           # format:check + lint + workflow lint + typecheck + tests + build + audit
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
- `src/commands/` — one entrypoint per subcommand: `mcp`, `sync`, `diff`,
  `redline`, `historical`, `search`, `serve`, `export` (`help` and
  `version` dispatch from `src/cli.ts`)
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

See [SECURITY.md](https://github.com/deffenda/cfr-free/blob/main/SECURITY.md) for reporting vulnerabilities and the security
posture summary. Reported by default: lint/strict-TS/typecheck/coverage/Audit
gates (plus local trivy/semgrep/osv-scanner/gitleaks scans), zero runtime
dependencies beyond the MCP SDK, XML parser hardening (no
DOCTYPE, bounded depth/size), FTS query sanitization (no SQL injection
surface), and loopback-only networking by default.

## License

[MIT](https://github.com/deffenda/cfr-free/blob/main/LICENSE)
