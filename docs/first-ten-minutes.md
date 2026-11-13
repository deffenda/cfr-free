# First 10 minutes with cfr-free

From “I want to look something up in 38 CFR” to “I have a ranked hit and the
provision text behind it”.

This is a path, not a reference: the [README](../README.md) stays the canonical
document for options, configuration, the API contract and the MCP tools. The
commands below use the npm route, and each quoted output states its provenance.

## What you will have done

1. [Choose a route](#1-choose-one-route) and get a working `cfr-free` command.
2. [Build the local index](#2-build-the-local-index).
3. [Inspect the index](#3-inspect-the-index) — freshness, drift, row counts.
4. [Search it](#4-search-the-local-index) from the terminal.
5. [Read one provision and cite it](#5-read-the-provision-and-cite-it).

On the npm route, none of these steps needs a compiler, a checkout, an account
or an API key.

## 1. Choose one route

The README documents five routes
([Quickstart](../README.md#quickstart)). They differ in what they require of
your machine:

| What your machine has                                    | Route                                                                | What it costs                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| Docker, no Node                                          | [Docker](../README.md#1-docker-nothing-to-install)                   | a container; the index lives in a volume               |
| Node ≥ 22.5 and npm                                      | [npm](../README.md#2-from-npm-no-compiler-no-docker)                 | nothing to compile — the published tarball ships built |
| Node, and you want one pinned release                    | [Release tarball](../README.md#3-from-a-release-tarball-no-compiler) | nothing to compile; the URL pins the version           |
| A compiler, and you want the git tree without a checkout | [GitHub](../README.md#4-from-github-no-publish-step)                 | the first run compiles the project                     |
| You intend to change the code                            | [Source checkout](../README.md#5-from-a-source-checkout)             | `npm ci` and a build                                   |

Three things the README records, kept here so they are not lost along the way:

- **Node ≥ 22.5 is required** by every route but Docker — the index runs on
  the built-in `node:sqlite` module.
- **`npm install -g github:deffenda/cfr-free` does not work.** npm itself
  leaves a command on PATH that does not run (measured; the README has the
  details). Use `npx`, a project-local install, the npm route or Docker.
- **The routes are not all the same version of the tool**: npm gives the
  latest **published** release (0.2.1, checked 2026-11-01), the GitHub route
  compiles the default branch (0.2.2 at this commit), a checkout runs the tree
  you have, and the Docker image carries whatever its tag was built from. The
  differences are small today, but a step's output can differ from the
  examples below.

**The rest of this guide uses the npm route** (`npx -y cfr-free`), because it
needs neither a compiler nor a checkout:

```bash
npx -y cfr-free version    # -> 0.2.1   (the latest published release)
```

If you took another route, every step below still applies — swap `npx -y cfr-free`
for your own command (`cfr-free` after a global npm install, `node dist/cli.js`
in a checkout). Docker is not a drop-in substitution: it publishes its own port,
mounts its own volume and runs every command through `docker run` — see the
README’s [Docker section](../README.md#docker).

## 2. Build the local index

```bash
npx -y cfr-free sync
```

This is the step that downloads the corpus: it pulls Title 38 from the
[eCFR API](https://www.ecfr.gov/developers/documentation/api/v1) and writes one
SQLite file — `~/.cfr-free/index.sqlite` by default (`CFR_INDEX_PATH` moves
it; see [Configuration](../README.md#configuration)). The README records the
transfer as ~2–3 MB and about 5 s on the maintainer’s machine.

The command writes one line to stdout:

```text
synced <sections> sections + <appendices> appendices (issue date <YYYY-MM-DD>; <what changed>; <duration> ms; corpus hash <sha256>)
```

That line is the whole of stdout, but it is not the whole of the output: the
progress log (`resolving eCFR issue date`, `fetching title structure`,
`fetching full title XML`, `index rebuilt`) goes to stderr, one JSON object
per line. Redirecting stdout leaves the summary on its own.

Four parts of that line matter. The **issue date** is the eCFR revision your
index holds — every search result, and every citation you take from it, is
from that revision and not from today’s eCFR. The **section and appendix
counts** say how much was indexed, and the **change count** says what the last
sync amended. Between the change count and the duration the line may carry one
more clause, `<n> provisions contain image content not included`: a few
publish their rating tables as eCFR images, and the index marks them instead
of pretending otherwise ([more in the README](../README.md#what-you-get)).

After this step, the local-index reads are offline: from a fresh index,
`search`, the section reads and the index-backed MCP tools answer without the
network.

## 3. Inspect the index

Three surfaces read the local file: the CLI, the HTTP server and the MCP
server. Two mechanisms fetch from the network, and only one of them repeats.
The startup auto-sync is a one-shot check: when `search`, `serve` or `mcp`
starts, it syncs a stale or empty index once, unless `CFR_AUTO_SYNC=0`. Only
`CFR_REFRESH_HOURS` arms a periodic timer — and only `serve` and `mcp`
arm it, re-syncing every N hours while they run (default 0 = off, so no
timer at all). The local-index reads — `search`, a section read, the
index-backed MCP tools — do not refresh the index in the background by
default: with a fresh index the auto-sync has nothing to do.

A third kind is on demand: the answer comes from eCFR at call time, not from
the index on disk. `serve`'s `/api/v1/diff` and `/api/v1/redline` routes, the
three eCFR-backed MCP tools (`get_section_at`, `diff_issues`, `redline`) and
the CLI commands `diff`, `redline` and `historical` all fetch on every call —
`cfr-free diff` reads the index only to default its `to` date to the index's
issue date. The README's [Requirements](../README.md#requirements) list names
every place the network comes back.

**From the CLI.** `cfr-free search` runs the same local-index search as the
other two surfaces; `cfr-free export` copies the index file. The CLI prints no
status object — for the fields below, ask the server.

**Over HTTP.** Start the server:

```bash
npx -y cfr-free serve
```

`serve` prints nothing on stdout — the ready line is a structured log on
stderr. When you see the line below, it is serving:

```text
{"time":"…","level":"info","message":"http api listening","url":"http://127.0.0.1:8787","freshness":"fresh"}
```

Leave the server running. Open a second terminal for the remaining commands,
then ask it what it has:

```bash
curl -s http://127.0.0.1:8787/health
```

`status` is the **server’s** health — `ok` means the HTTP surface is up, and
says nothing about the index. The index’s own condition is in the other
fields: `issueDate`, `syncedAt`, `sections`, `appendices`, `stale`,
`maxAgeDays`, `parserVersion`, `structureDrift`, `lastChanges` and
`corpusHash` (plus `diskFree`/`diskTotal` where the platform provides them).

Read three of those index fields. `issueDate` names the revision you are
reading. `stale` says the index is older than `CFR_MAX_AGE_DAYS` (default 7
— the [Configuration](../README.md#configuration) table names the knob).
`structureDrift` says the index's rows and the structure it was built from
disagree: it compares the row count the index holds (sections plus
appendices) against the counts the eCFR structure tree gave at the last sync.
The check is local — nothing is fetched — and it is `null` on an index too old
to carry those counts.

**Over MCP.** The `index_status` tool reports the index’s condition and takes
no arguments ([MCP tools](../README.md#mcp-tools)). The `health` tool is a
different thing: a readiness verdict — `ready`, `stale`, `degraded` (structure
drift) or `empty`. It is not the HTTP `/health`’s `status: ok`.

## 4. Search the local index

```bash
npx -y cfr-free search "traumatic brain injury"
```

Each hit prints three things — the citation with its heading, the dated eCFR
URL and a snippet that can run to several lines — and the run ends with a
summary line:

```text
1. 38 C.F.R. § 3.310 — Disabilities that are proximately due to, or aggravated by, service-connected disease or injury. — part 3: Adjudication
   https://www.ecfr.gov/on/2026-10-27/title-38/section-3.310
   …Structural imaging of the brain.
…
182 candidate provision(s); index issue date 2026-10-27
```

Real output, trimmed, verified on 2026-11-01 against a local index whose issue
date was 2026-10-27. The summary line names the index's issue date, then any
terms the hits did not answer (`; terms not answered by these hits: …`), and a
stale index adds a `warning:` line after it. The trailing
`— part 3: Adjudication` is this checkout's hit format: the published 0.2.1
that `npx -y cfr-free` runs does not print it yet, so on the npm route your hit
line ends at the heading.

Three things to know about it:

- **The URL is dated.** `…/on/2026-10-27/…` is the revision the indexed text
  came from. `/current/` names whatever revision eCFR serves now: the same
  one, while the index is current — or a newer one, once eCFR has moved past
  the issue date above. Cite the dated URL.
- **The first hit is the best text match, not the governing provision.** A
  query that is itself a citation (`38 CFR 3.310`) pins that exact provision
  as hit 1 — the pin outranks the text match. Otherwise the ranking is BM25
  over the index’s FTS5 text, weighted toward citations and headings — a
  lexical score, not a legal one. Read the provision before you rely on it.
- **The command takes a query and nothing else.** There is no `--part` or
  `--per_page` flag — an unknown option is a usage error (exit 2) — and the
  query must be 3–200 characters. For filters, use the
  [HTTP API](../README.md#http-api) (`/api/v1/search?q=…&part=4&per_page=…`)
  or the `search_regulations` MCP tool.

## 5. Read the provision and cite it

Take a citation from the hit — `3.310` — and read the text behind it:

```bash
curl -s http://127.0.0.1:8787/api/v1/sections/3.310
```

The response carries the citation, the heading, the hierarchy (`chapter`,
`part`, `subpart`), the `issueDate`, the full text as `markdown` and any
cross-references — and **two** eCFR URLs. `sourceUrl` points at the current
eCFR revision of that citation; `sourceUrlAtIndexDate` points at the revision
your index actually holds. Cite the dated one: it is the text you read.

Over MCP, the same read is the `get_section` tool, which accepts `3.310`,
`§ 3.310` or `38 CFR 3.310`.

What you take away is the display form, the issue date and the dated URL —
the same block the web UI’s copy button fills in:

```text
38 C.F.R. § 3.310
Disabilities that are proximately due to, or aggravated by, service-connected disease or injury.
Source: 38 CFR 3.310 (issue date 2026-10-27)
Verify at the indexed revision: https://www.ecfr.gov/on/2026-10-27/title-38/section-3.310
```

`serve` also serves a read-only web UI at <http://127.0.0.1:8787/> — search,
section reads and copy-a-citation over the same JSON API.

## Where to go next

- **Claude or another MCP client**:
  [Use with Claude (MCP)](../README.md#use-with-claude-mcp) — one command,
  `claude mcp add cfr-free -- npx -y cfr-free mcp`.
- **Your own scripts**: the [HTTP API](../README.md#http-api) and its
  [OpenAPI contract](openapi.yaml).
- **Other assistants**: the nine [MCP tools](../README.md#mcp-tools) — six
  offline index-backed ones, three that fetch from eCFR per call.
- **Backups**: `cfr-free export ./backup.sqlite` writes a consistent snapshot
  of the index; it refuses to overwrite an existing file (exit 5).
- **Older and newer text**: `cfr-free diff <from> <to>`,
  `cfr-free redline <from> <to> <citation>` and
  `cfr-free historical <at> <citation>`.
- **Tuning**: [Configuration](../README.md#configuration). Everything is an
  environment variable; flags are deliberately avoided.

## When something goes wrong

| What you see                                                              | Exit | What it means                                          | What to do                                        |
| ------------------------------------------------------------------------- | ---- | ------------------------------------------------------ | ------------------------------------------------- |
| ``index at … is empty — run `cfr-free sync` first``                       | 3    | no index yet, and auto-sync is off (`CFR_AUTO_SYNC=0`) | run `cfr-free sync`, or unset `CFR_AUTO_SYNC`     |
| `unknown option for search: --part`                                       | 2    | the CLI search takes a query only                      | use the HTTP API or the MCP tool for filters      |
| `invalid input: query: Too small: expected string to have >=3 characters` | 1    | the query is too short — npm 0.2.1                     | use a longer query                                |
| `the search query needs at least 3 characters`                            | 2    | the query is too short — checkout 0.2.2                | use a longer query                                |
| `port 8787 is already in use`                                             | 4    | the bind failed                                        | set `CFR_PORT`                                    |
| `refusing to overwrite existing file`                                     | 5    | `export` will not clobber                              | remove the file or choose another path            |
| `npm install -g github:…` leaves a command that does not run              | —    | npm’s own failure, measured on npm 11.20.0             | use `npx`, a project-local install, npm or Docker |

The two short-query rows are version-specific: the CLI prints every failure
as `cfr-free: <message>`. npm 0.2.1 checks the query after the index is built,
so on a machine with no index yet it downloads the corpus first, then prints
the `Too small` message and exits 1. The 0.2.2 checkout refuses the query
before it opens the index — no download — and exits 2. Every other row is the
same in both versions.

The README’s [exit codes](../README.md#exit-codes) table is the full list.

## What this guide does not claim

- **No timings.** The ~2–3 MB and ~5 s figures are the README’s, from the
  maintainer’s machine; your network decides.
- **No usability testing.** Neither this guide nor the routes it lists were
  tested with people. The README’s
  [smoke checklist](../README.md#verify-the-install-smoke-checklist) ran its
  command sequence against a provisioned checkout (`node dist/cli.js`) and
  measured the install routes separately: a clean global install of the packed
  tarball into a throwaway prefix, the GitHub Release asset route end to end
  in a scratch repository, this repository’s own `v0.2.1` release, a
  project-local `npm install github:deffenda/cfr-free`, and
  `npx -y github:deffenda/cfr-free` with MCP over stdio. It also measured
  the failing route, `npm install -g github:…`. It did not exercise Docker,
  an install from the npm registry, or an install with no npm cache and no
  network beyond the first fetch.
- **The quoted outputs are examples.** The search output came from a real
  run of this repository’s build (2026-11-01, index issue date 2026-10-27)
  and will differ in counts, dates and ranking on your index. The command
  shapes are the contract; the numbers are not.
