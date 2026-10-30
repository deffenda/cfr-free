# Critical review — security, maintainability, usability — 2026-10-29

Audited commit: `aa3f73c`, then rebased onto `8c876c5` when `main` moved
mid-audit (see "Provenance" for exactly what was re-verified after the
rebase).
Scope: `src/` (37 files, ~8.4k lines), `test/` (36 test files; 766 test cases
— 722 executed in the audited run, plus the 44 in `openapi-conformance`, whose
21 source-level declarations expand to 44 cases, and which could not load
locally without PyYAML),
`.github/workflows/` (3 files), `Dockerfile`, `docker-compose.yml`,
`package.json`, `scripts/`, `tools/`, `docs/SPEC.md`, `docs/openapi.yaml`,
`README.md`, `ROADMAP.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`.

This file is a **finding log**, not a dispatch handoff. It does not follow the
"Dispatch and closure contract" of `docs/research/review-2026-10-21.md`; no
finding below is tracked to an issue or a fixing pull request yet. Nothing in
it has been changed in the tree — every item is an open observation.

## How to read this

Every finding carries:

- **Location** — `file:line`, clickable.
- **Evidence** — the code or output that proves it, quoted or reproduced.
- **Impact** — what a user or operator actually experiences.
- **Fix** — the smallest change that resolves it.
- **Confidence** — `CONFIRMED` (traced end to end in code or reproduced by
  execution), `SUSPECTED` (pattern is real but the exploit/precondition was
  not proven), `OBSERVATION` (accurate statement, not a defect).

Severity: **P0** actively broken · **P1** real weakness needing a fix ·
**P2** hardening / cost of change · **P3** polish.

### Provenance of the findings

Three independent reviews were run (security, maintainability, usability) and
every headline claim was re-checked against the source by the orchestrating
session. Findings that two reviews reached independently are marked
`[security+usability]` etc. Findings the orchestrator proved by execution are
marked `[verified by execution]`.

### Verification log

Commands run against the audited commit, and their outcomes. This is the
evidence base for every claim above; per `AGENTS.md` ("Evidence"), a gate
claim needs the local output.

| Check                             | Command                                                                                                     | Result                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote state                      | `git fetch --all --prune`                                                                                   | `main` = `origin/main` at `aa3f73c`; `main` then moved to `8c876c5` mid-audit and the affected citations were re-verified (see "Provenance")       |
| Typecheck                         | `npm run typecheck`                                                                                         | pass, no output                                                                                                                                    |
| Lint                              | `npm run lint`                                                                                              | pass, **8 warnings**, 0 errors (all `security/detect-non-literal-fs-filename`)                                                                     |
| Tests + coverage                  | `npm run test:coverage`                                                                                     | **2 files fail** — see CR-01 and CR-02                                                                                                             |
| Coverage floors                   | `npx vitest run --coverage --exclude test/openapi-conformance.test.ts --exclude test/install-paths.test.ts` | statements 97.35 %, branches 90.90 %, functions 97.65 %, lines 98.80 % — **all above the 90 % floors** in `vitest.config.ts:23-28`                 |
| `any` / `@ts-ignore` / TODO sweep | `grep -rn` over `src/`                                                                                      | 0 `any`, 0 `@ts-ignore`, 0 TODO/FIXME/HACK                                                                                                         |
| Layering                          | `grep -rn "from '\.\./\(commands\|titan\|mcp\)" src/core/`                                                  | clean — `core/` has no upward imports                                                                                                              |
| CI state                          | `gh run list --branch main`                                                                                 | all recent runs `success`                                                                                                                          |
| Tag visibility in CI              | `git clone --depth 1` of the public repo                                                                    | `git tag` → **0 tags** (root cause of CR-01)                                                                                                       |
| Linter blind spot                 | injected `==` and `debugger` into `UI_JS`                                                                   | prettier: 0 diff; eslint: 0 findings; the same code in a `.ts` control file under the repo's own eslint config: **2 errors** (root cause of CR-03) |
| CLI behaviour                     | `node dist/cli.js search ab`                                                                                | full eCFR sync runs, **then** exit 1 (root cause of CR-05, CR-07)                                                                                  |

The audit ran `npm ci` from the committed lockfile to execute these gates.
That produced a gitignored `node_modules/` and `dist/`; **no tracked file was
modified** and `git status` was clean before and after.

---

## Index

| ID              | P   | Area            | Subject                                                             | Confidence |
| --------------- | --- | --------------- | ------------------------------------------------------------------- | ---------- |
| [CR-01](#cr-01) | P1  | CI / release    | The release guard is red locally and vacuous in CI                  | CONFIRMED  |
| [CR-02](#cr-02) | P1  | Tests           | The OpenAPI contract suite has undeclared dependencies              | CONFIRMED  |
| [CR-03](#cr-03) | P1  | Tooling         | 840 lines of browser JS escape every gate                           | CONFIRMED  |
| [CR-04](#cr-04) | P1  | Security        | Rate limiting is blind to the cost of a request                     | CONFIRMED  |
| [CR-05](#cr-05) | P1  | CLI             | The query is validated after the index is built                     | CONFIRMED  |
| [CR-06](#cr-06) | P1  | CLI             | No machine-readable output; results hard-capped at 10               | CONFIRMED  |
| [CR-07](#cr-07) | P1  | CLI / docs      | Usage errors exit 1, contradicting the documented table             | CONFIRMED  |
| [CR-08](#cr-08) | P1  | Web UI          | Raw validation-library messages shown to end users                  | CONFIRMED  |
| [CR-09](#cr-09) | P1  | Web UI / a11y   | Focus is never moved on route change                                | CONFIRMED  |
| [CR-10](#cr-10) | P2  | Architecture    | Two runtime ESM import cycles                                       | CONFIRMED  |
| [CR-11](#cr-11) | P1  | Tests           | The contract suite pins exact source line numbers                   | CONFIRMED  |
| [CR-12](#cr-12) | P2  | Security / docs | Default container posture is an unauthenticated public API          | CONFIRMED  |
| [CR-13](#cr-13) | P2  | Release         | The release pipeline never re-runs the secret scan                  | CONFIRMED  |
| [CR-14](#cr-14) | P2  | Security        | No connection or header-timeout hardening                           | CONFIRMED  |
| [CR-15](#cr-15) | P2  | Core            | The FTS query string is built on two paths                          | CONFIRMED  |
| [CR-16](#cr-16) | P2  | Core            | eCFR permalink construction is duplicated                           | CONFIRMED  |
| [CR-17](#cr-17) | P2  | Core            | `findProvision` is duplicated with divergent case-folding           | CONFIRMED  |
| [CR-18](#cr-18) | P2  | MCP             | Nine identical error-handling blocks                                | CONFIRMED  |
| [CR-19](#cr-19) | P2  | Docs            | `docs/SPEC.md` contradicts `eslint.config.mjs`                      | CONFIRMED  |
| [CR-20](#cr-20) | P2  | Core            | `JSON.parse` cast for the persisted sync-change record              | CONFIRMED  |
| [CR-21](#cr-21) | P2  | Core            | Bare `Error` for upstream-data faults is swallowed to a generic 500 | CONFIRMED  |
| [CR-22](#cr-22) | P2  | Core            | A cast where an `instanceof` check belongs                          | CONFIRMED  |
| [CR-23](#cr-23) | P2  | Web UI          | Rating tables lose their structure                                  | CONFIRMED  |
| [CR-24](#cr-24) | P2  | Web UI          | The search form omits `part` and hides the chapter rule             | CONFIRMED  |
| [CR-25](#cr-25) | P2  | HTTP            | No discovery route                                                  | CONFIRMED  |
| [CR-26](#cr-26) | P3  | Docs            | README route table — **fixed upstream**; UI description still stale | CONFIRMED  |
| [CR-27](#cr-27) | P2  | MCP             | Every tool returns its payload twice                                | CONFIRMED  |
| [CR-28](#cr-28) | P2  | MCP             | No injection posture and no size bound on a provision               | CONFIRMED  |
| [CR-29](#cr-29) | P2  | CLI             | The first-run error is the least actionable message in the tool     | CONFIRMED  |
| [CR-30](#cr-30) | P2  | Tests           | 1 627 lines of test guard a 139-line YAML file                      | CONFIRMED  |
| [CR-31](#cr-31) | P2  | Docs            | `SPEC.md` and `ROADMAP.md` have become delivery journals            | CONFIRMED  |
| [CR-32](#cr-32) | P2  | Core            | `store.ts` mixes persistence with query-language semantics          | CONFIRMED  |
| [CR-33](#cr-33) | P2  | HTTP            | Missing `Referrer-Policy` / HSTS headers                            | CONFIRMED  |
| [CR-34](#cr-34) | P3  | CI              | `actionlint` is installed by mutable tag                            | CONFIRMED  |
| [CR-35](#cr-35) | P3  | CI              | `trivy` and `semgrep` never run in CI                               | CONFIRMED  |
| [CR-36](#cr-36) | P3  | Packaging       | The install-time `prepare` script reaches the network               | CONFIRMED  |
| [CR-37](#cr-37) | P3  | MCP             | Prompt templates interpolate free-text arguments                    | CONFIRMED  |
| [CR-38](#cr-38) | P3  | MCP             | The corpus receipt is a receipt, not a trust anchor                 | CONFIRMED  |
| [CR-39](#cr-39) | P3  | CLI / UI        | `--help` on a subcommand is an error                                | CONFIRMED  |
| [CR-40](#cr-40) | P3  | UI / a11y       | Missing `aria-current`; heading order skips `h2`                    | CONFIRMED  |
| [CR-41](#cr-41) | P3  | Core            | Stale JSDoc block and two unused exports                            | CONFIRMED  |
| [CR-42](#cr-42) | P3  | CI / docs       | `AGENTS.md` names three required checks; protection requires four   | CONFIRMED  |

---

## P1 findings

<a id="cr-01"></a>

### CR-01 — The release guard is red locally and vacuous in CI

**Severity: P1** · **Location:** `test/install-paths.test.ts:575-582`,
`package.json:3`, `.github/workflows/ci.yml:33`, `.github/workflows/release.yml:23`
· **Confidence: CONFIRMED** (reproduced on a clean working tree)

The release guard reads the local tag list and requires `package.json`'s
version not to be a tag that already exists:

```ts
// test/install-paths.test.ts:575
const tags = execFileSync('git', ['tag'], { encoding: 'utf8' })
  .split('\n')
  .map((tag) => tag.trim())
  .filter((tag) => tag.startsWith('v') && tag !== releasingTag);
for (const tag of tags) {
  const tagged = tag.slice(1);
  expect(version, `package.json ${version} is already used by tag ${tag}`).not.toBe(tagged);
}
```

`main` has sat at `0.2.1` since tag `v0.2.1` was cut at `ebd1475`, so the
guard fires:

```
FAIL test/install-paths.test.ts > the release guard > declares a version that is not already taken by a tag
AssertionError: package.json 0.2.1 is already used by tag v0.2.1: expected '0.2.1' not to be '0.2.1'
```

In CI the guard cannot fire at all. `ci.yml:33` uses `actions/checkout` with
no `fetch-depth`, so the clone is depth-1 and `git tag` returns **zero tags**
— verified by cloning the public repository at `--depth 1`:

```
=== git tag output in CI-style shallow clone ===
=== tag count: 0 ===
```

The only `fetch-depth: 0` checkout is `release.yml:135` (the release-notes
job), which runs no tests. The `security` job does use `fetch-depth: 0`
(`ci.yml:85`) but runs no vitest.

Two consequences:

1. **The protection is absent from the merge gate.** The guard was added in
   `21ae9da` ("fix(distribution): make the git install routes work"), which
   created `test/install-paths.test.ts`; `ebd1475` later _modified_ it to
   exempt the tag being released. In CI the guard has never executed.
2. **Its invariant contradicts the release workflow.** `release.yml:148` and
   `release.yml:246` both require `tag == package.json version`, so `main` is
   _guaranteed_ to hold `version == latest tag` between releases — exactly
   the state the test forbids. The `ebd1475` fix exempted only the tag being
   released (`GITHUB_REF_TYPE === 'tag'`), which covers the release run but
   not a branch run.

The documented first-run path in `CONTRIBUTING.md` (`clone` → `npm ci` →
`npm run ci`) therefore fails for anyone whose clone has tags.

**Impact:** the repo's own gate is self-deceiving in both directions — red for
contributors, vacuous in CI.

**Fix:** bump `package.json` to `0.2.2`; add `fetch-tags: true` to the
`quality` job checkout; and make the test fail loudly when the tag list is
empty instead of passing vacuously.

---

<a id="cr-02"></a>

### CR-02 — The OpenAPI contract suite has undeclared dependencies

**Severity: P1** · **Location:** `test/openapi-conformance.test.ts:43-45`,
`test/openapi-conformance.test.ts:63-118`, `package.json` · **Confidence: CONFIRMED**

Two independent undeclared dependencies sit on the repo's most valuable test
suite.

**(a) `ajv` and `ajv-formats` are not in `package.json`.**

```ts
// test/openapi-conformance.test.ts:43-45
import addFormats from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AnySchema } from 'ajv';
```

`grep -n ajv package.json` → no match. They resolve only because
`@modelcontextprotocol/sdk` hoists them transitively:

```
cfr-free@0.2.1
├─┬ @modelcontextprotocol/sdk@1.32.1
│ ├─┬ ajv-formats@3.0.1
│ │ └── ajv@8.20.0 deduped
│ └── ajv@8.20.0
└─┬ eslint@10.13.0
  └── ajv@6.15.0
```

`ajv/dist/2020.js` is an ajv-8 path; eslint nests an incompatible ajv-6.
If the MCP SDK drops `ajv-formats`, or npm's hoisting changes so that ajv-6
wins the top-level slot, the import fails and the whole suite fails to load.
An undeclared dependency is also invisible to `npm audit` and `osv-scanner`,
which audit the lockfile as declared.

**(b) The spec is parsed through a Python + PyYAML subprocess.**

```ts
// test/openapi-conformance.test.ts:63-68
const YAML_TO_JSON_BRIDGE = [
  'import json, sys, yaml',
  'doc = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))',
  'json.dump(doc, sys.stdout)',
].join('\n');
```

The test's own comment says _"macOS python3 and GitHub ubuntu runners ship
it"_. On this machine it does not — neither Apple's `/usr/bin/python3` nor
any Homebrew Python has PyYAML:

```
/usr/bin/python3: NO PyYAML
/opt/homebrew/bin/python3: NO PyYAML
/opt/homebrew/bin/python3.11: NO PyYAML
/opt/homebrew/bin/python3.12: NO PyYAML
/opt/homebrew/bin/python3.13: NO PyYAML
/opt/homebrew/bin/python3.14: HAS PyYAML
/opt/homebrew/bin/python3.15: NO PyYAML
```

The failure is loud by design (the test comments a silent skip would
disable the contract) — that is the right call — but the prerequisite is
documented in neither `CONTRIBUTING.md` nor `AGENTS.md:45`, both of which
enumerate gate prerequisites.

**Impact:** the contract suite cannot run on a stock macOS checkout, and
`npm run ci` — named in `AGENTS.md:45` as the one-shot gate — fails with a
`ModuleNotFoundError` that names a Python module rather than the missing
dependency.

**Fix:** add `"ajv": "^8.20.0"` and `"ajv-formats": "^3.0.1"` to
`devDependencies`; add `yaml` and parse the spec natively, dropping the
interpreter from the gate entirely.

---

<a id="cr-03"></a>

### CR-03 — 840 lines of browser JS escape every gate

**Severity: P1** · **Location:** `src/titan/ui.ts:126-965` (`UI_JS`),
`src/titan/ui.ts:967-1116` (`UI_CSS`) · **Confidence: CONFIRMED** (reproduced)

`ui.ts` is 1 116 lines; ~840 are browser JavaScript inside a `String.raw`
template and ~150 are CSS. Neither is parsed by any tool in the gate.

Proven by injection, not inference. A malformed probe was inserted into the
`UI_JS` block and the repo's own tooling was run against it:

```
injected: var probeVar   =    1;
          if (probeVar == 1) { debugger; }

prettier --check ui.ts   →  "All matched files use Prettier code style!"   (0 diff)
eslint  (eqeqeq: error, no-debugger: error) on ui.ts → 0 findings
eslint  on the identical code in a .ts control file, under the repo's own
        eslint config                                    → 2 errors
```

The tooling works; the `String.raw` block is specifically opaque to it. The
same holds for `tsc`, which sees only a template literal. (The control is a
`.ts` file, not a `.js` one: `eqeqeq` is scoped to `**/*.ts` in
`eslint.config.mjs:25`, so a `.js` control reproduces a different count under
the repo's own config.)

**Impact:** the largest single blob of logic in the repository is checked by
no linter, no formatter and no type-checker. `==` comparisons, unused
variables, unreachable branches and typo-level mistakes in the UI are
invisible. `test/ui.test.ts` does execute the served string in `node:vm`
against a stub DOM — genuinely good — but its 39 test cases (96 assertions) cover specific
behaviours, not style or dead code.

**Fix:** extract `UI_JS` into a real `.js` file served as a static asset
(the server already serves `/ui.js`), then let eslint and prettier see it.

---

<a id="cr-04"></a>

### CR-04 — Rate limiting is blind to the cost of a request

**Severity: P1** · **Location:** `src/titan/http-server.ts:599-606`,
`src/commands/serve.ts:67`, `src/core/diff.ts:114-116`,
`src/core/ecfr.ts:73-80`, `src/core/http-client.ts:46` · **Confidence: CONFIRMED**

The per-peer token bucket is consumed in `precheck`, before routing, at one
token per request regardless of what the route then does:

```ts
// src/titan/http-server.ts:599
  if (limiter !== null) {
    const verdict = limiter.consume(req.socket.remoteAddress ?? 'unknown');
```

```ts
// src/commands/serve.ts:67
    ...(config.allowRemote ? { rateLimit: { capacity: 60, refillPerSec: 10 } } : {}),
```

Two routes then perform two parallel full-title XML fetches each:

```ts
// src/core/diff.ts:114
  const [fromXml, toXml] = await Promise.all([
    ecfr.getFullTitleXml(fromDate),
    ecfr.getFullTitleXml(toDate),
```

`getFullTitleXml` retrieves the complete Title 38 document (~2 MB per the
module's own comment, `src/core/ecfr.ts:73`); the client caps each response
at 50 MiB (`src/core/http-client.ts:46`) with a 15 s timeout and 2 retries.
There is **no concurrency cap** — `server.requestTimeout = 60_000`
(`http-server.ts:678`) bounds request _duration_, not request _count_, and
`server.maxConnections` is never set.

**Impact.** Precondition: `CFR_ALLOW_REMOTE=1`, which the published image
sets by default (`Dockerfile:26`). At the sustained 10 req/s the limiter
permits, with each request occupying a slot for up to ~45 s (15 s × 3
attempts), steady-state concurrency reaches ~450 in-flight requests. At the
real ~3 MB upstream size plus ~16 MB parsed output each, that is multiple GB
of heap: local OOM or a container restart loop. Simultaneously it drives
~30 MB/s at `www.ecfr.gov` — amplification against a third-party government
service, attributable to this deployment.

**Fix.** (a) Charge the expensive routes N tokens in `precheck`, not 1.
(b) Add a semaphore bounding in-flight upstream fetches (2–4).
(c) Memoize fetched full-title XML by issue date with a short TTL —
`docs/SPEC.md:363` rejected a dual-TTL cache, but a same-date memo collapses
the repeated identical fetches that make the amplification cheap.

---

<a id="cr-05"></a>

### CR-05 — The query is validated after the index is built

**Severity: P1** · **Location:** `src/commands/search.ts:16-20`,
`src/core/service.ts:46`, `src/cli.ts:166-173` · **Confidence: CONFIRMED**
· **verified by execution**

```ts
// src/commands/search.ts:16-20
  const store = Store.open(config.indexPath);
  try {
    await ensureIndex(store, config, logger);
    const service = new CFRService(store, config.maxAgeDays, createEcfrApi(), logger);
    return service.search({ query, perPage: 10 });
```

`ensureIndex` may run a full eCFR sync; only then does the service enforce
`query: z.string().trim().min(3).max(200)`. The CLI's own parser accepts any
non-empty query.

Reproduced against the built CLI:

```
$ node dist/cli.js search ab
{"level":"info","message":"index empty, running initial sync", ...}
{"level":"info","message":"resolving eCFR issue date for title 38"}
{"level":"info","message":"fetching title structure","issueDate":"2026-10-27"}
... exit=1
```

**Impact:** on a fresh machine a 2-character query costs a 2–3 MB download
and ~5 s of waiting before the user is told their query was rejected. On a
stale index it silently refreshes first. The user's mistake is billed to the
network.

The sibling path gets this right — `src/core/historical.ts:95`: _"Validation
first: a bad date or citation must not cost a 2–3 MB fetch."_

**Fix:** validate `query.length >= 3` in `parseSearchArgs` (`src/cli.ts:166`)
so it exits 2 before the store is opened.

---

<a id="cr-06"></a>

### CR-06 — No machine-readable output; results hard-capped at 10

**Severity: P1** · **Location:** `src/commands/search.ts:20`,
`src/cli.ts:166-173` · **Confidence: CONFIRMED** · **verified by execution**

There is no `--json`, `--format`, `--page` or `--per-page` flag anywhere in
the CLI. `parseSearchArgs` rejects any dash-prefixed argument:

```
$ node dist/cli.js search --json
cfr-free: unknown option for search: --json     [exit=2]
$ node dist/cli.js search --page 2
cfr-free: unknown option for search: --page     [exit=2]
```

```ts
// src/commands/search.ts:20 — the cap is hard-coded
return service.search({ query, perPage: 10 });
```

The only machine-readable output in the whole tool is `cfr-free export <path>
jsonl`, which dumps the corpus, not a query result.

**Impact.** The CLI's own stated purpose is _"the same search the MCP and HTTP
surfaces run, so a CLI-only user can search"_ (`src/commands/search.ts:9`) —
but it exposes 10 of N hits and prints `N candidate provision(s)`
(`src/commands/search.ts:54`) with no route to the rest. A practitioner who
narrows by the wrong wording sees only the first 10 lexical matches and
cannot check the others. Scripting the CLI is impossible.

**Fix.** Add `--json` (emit the `SearchResponse` verbatim), `--page` /
`--per-page` mirroring the HTTP params, and `--part` / `--kind` / `--chapter`.
The parameter set already exists in `src/mcp/tools.ts:271-307` and
`docs/openapi.yaml:189-210`.

---

<a id="cr-07"></a>

### CR-07 — Usage errors exit 1, contradicting the documented table

**Severity: P1** · **Location:** `src/cli.ts:301-305`, `src/core/service.ts:35`,
`src/core/service.ts:259-267`, `README.md:437-442` (the "2" row is
`README.md:439`) · **Confidence: CONFIRMED** ·
**verified by execution**

```ts
// src/cli.ts:301-305
io.err(`cfr-free: ${message}\n`);
if (error instanceof CommandError) return error.exitCode;
return error instanceof ConfigError ? EXIT.USAGE : EXIT.ERROR;
```

`ServiceError extends Error` (`src/core/service.ts:35`) and is neither a
`CommandError` nor a `ConfigError`, so it maps to `EXIT.ERROR` (1). The
README assigns code 2 to usage errors:

```
| `1`  | Generic error (sync failure, corrupt index, …)  |
| `2`  | Usage or configuration error                    |
```

and then invites scripting on it: _"Scripts can branch on these."_

The message is also the validation library's internal phrasing rather than
guidance: `cfr-free: invalid input: query: Too small: expected string to
have >=3 characters`.

**Impact:** a script that retries on 1, or reports "bad usage" on 2,
misclassifies a typo'd query as a service failure.

**Fix.** Map `ServiceError` with `code === 'invalid_input'` to `EXIT.USAGE`,
and rewrite validation messages as user guidance ("the query needs at least 3
characters").

---

<a id="cr-08"></a>

### CR-08 — Raw validation-library messages shown to end users

**Severity: P1** · **Location:** `src/titan/ui.ts:421-422`,
`src/core/service.ts:259-267` · **Confidence: CONFIRMED**

```js
// src/titan/ui.ts:421-422
statusLine.textContent = 'Search failed (' + String(body.error) + '): ' + String(body.message);
```

A user who types a lowercase chapter gets:

```
Search failed (invalid_input): invalid input: chapter: Invalid string: must match pattern /^[IVXLCDM]+$/
```

**Impact:** the audience is VA claims practitioners, not developers. A regex
in an error message is unreadable and tells them nothing about what to type
instead. The rule is knowable only by reading the API schema.

**Fix.** Map the `invalid_input` code to plain guidance in the UI ("Chapter
must be a Roman numeral such as I or IV"), or add a `hint` field to the
service's error envelope.

---

<a id="cr-09"></a>

### CR-09 — Focus is never moved on route change

**Severity: P1** · **Location:** `src/titan/ui.ts:961`, `src/titan/ui.ts:708-712`
· **Confidence: CONFIRMED**

The UI is a hash-routed SPA whose views are toggled with the `hidden`
attribute. `hashchange` re-renders, but there is no `focus()` call anywhere
in the file and no `tabindex="-1"` on `<main>`:

```js
// src/titan/ui.ts:961
window.addEventListener('hashchange', renderRoute);
```

The focused element (e.g. a search-result link) is inside the view that was
just hidden, so focus silently falls back to `<body>`. The `role="status"`
live regions cover status text, not the view change.

**Impact:** after clicking a search hit, a keyboard or screen-reader user is
dumped at the top of the document with no announcement of the new view and no
focusable position. The new content is never read out.

**Fix.** On route change, move focus to the new view's heading
(`tabindex="-1"` + `focus()`), announce the view via a live region, and add a
skip link to `<main>`.

---

<a id="cr-10"></a>

### CR-10 — Two runtime ESM import cycles

**Severity: P2** (downgraded from P1 on review — see the note below) ·
**Location:** `src/core/service.ts:5-6`,
`src/core/diff.ts:5`, `src/core/redline.ts:4,7` · **Confidence: CONFIRMED**

Value imports (type-only imports are erased and do not cycle):

```
src/core/service.ts:5  import { diffIssues, type IssueDiff } from './diff.js';
src/core/diff.ts:5     import { ServiceError } from './service.js';

src/core/service.ts:6  import { redlineSection, type SectionRedline } from './redline.js';
src/core/redline.ts:7  import { ServiceError } from './service.js';
```

A third edge (`redline.ts:4` → `diff.ts`) makes a 3-node cycle.

**Impact:** the cycles are benign today only because `ServiceError` is
_referenced_ inside function bodies, so the class TDZ is never reached at
module-evaluation time. That is a coincidence, not a guarantee: moving any
`ServiceError` construction to module top level in `diff.ts` / `redline.ts`
produces a `ReferenceError` at import time. The deeper smell is the inverted
dependency — a core domain module must import a _facade_ module to throw a
domain error.

**Fix.** Move `ServiceError` and `StructureError` into `src/core/errors.ts`.
Both cycles vanish, `mcp/client-safe.ts:1-2` simplifies to one import, and
`client-safe.ts` stops being the only module that knows the client-safe
class set.

**Severity note (added on review).** This was rated P1 when first written and
is downgraded to P2. The cycles are real and the citations are exact, but
there is no present defect: the code is correct today, the impact is
hypothetical, and by this document's own scale — P1 "real weakness needing a
fix", P2 "hardening / cost of change" — a latent-risk code smell with a
sound, non-breaking fix belongs at P2. It is worth fixing; it is not a
blocking weakness.

---

<a id="cr-11"></a>

### CR-11 — The contract suite pins exact source line numbers

**Severity: P1** · **Location:** `docs/openapi.yaml:39,64,89,114,139,164,251,306,383,430,491,497,503,511,517,525,531`;
enforced by `test/openapi-conformance.test.ts:1020-1035` · **Confidence: CONFIRMED**

Seventeen `# source: src/titan/http-server.ts:NN` comments (an 18th match in
a grep is the convention note at `docs/openapi.yaml:4`), for example:

```yaml
# docs/openapi.yaml:39
# source: src/titan/http-server.ts:545
# docs/openapi.yaml:491
# source: src/titan/http-server.ts:293,620,625 (encoding, URL parse, byte caps) + :429 (service input) + :347 (diff params) + :410 (redline params)
```

The test's own header explains the design (_"a line shift in the router fails
the suite instead of silently invalidating the doc's provenance claims"_) and
documents that a windowed fuzzy match was evaluated and rejected.

**Impact:** every insertion or deletion above `http-server.ts:669` shifts the
citations and fails the suite. `http-server.ts` is the file most likely to
grow, so this is recurring merge friction on the highest-traffic file — and
the failure message ("likely off by 1–2 lines") points at the router rather
than at the doc that must change.

**Fix.** Anchor the citations to a _symbol_ rather than a line
(`# source: src/titan/http-server.ts#handleSection`) and resolve the symbol at
test time; the line number can remain in the comment as a hint.

---

## P2 findings

<a id="cr-12"></a>

### CR-12 — Default container posture is an unauthenticated public API

**Severity: P2** · **Location:** `Dockerfile:23-26`, `README.md:67`,
`README.md:406-408` · **Confidence: CONFIRMED** · **[security+usability]**

```dockerfile
# Dockerfile:23-26
ENV NODE_ENV=production \
    CFR_INDEX_PATH=/data/index.sqlite \
    CFR_HOST=0.0.0.0 \
    CFR_ALLOW_REMOTE=1
```

```bash
# README.md:67
docker run -d --name cfr-free -p 8787:8787 -v cfr-data:/data \
  ghcr.io/deffenda/cfr-free:latest
```

The README states plainly that _"There is **no authentication** — if you bind
it to a non-loopback address you must put it behind your own reverse
proxy/auth"_ (`README.md:406-408`), but that line is nine screens away from
the copy-pasteable command. `-p 8787:8787` publishes on every host interface.
`docker-compose.yml:13-14` binds `127.0.0.1:8787:8787` — the two documented
paths disagree.

**Impact:** a reader who copies the first example ends up with an
unauthenticated API whose only guard is the rate limiter from CR-04. The
corpus is public data, so the confidentiality impact is low, but the default
should not be the exposed one.

**Fix.** Change the quickstart to `-p 127.0.0.1:8787:8787`, lead with the
Compose form, and add one sentence stating that the published port is the
exposure gate and the API is unauthenticated.

---

<a id="cr-13"></a>

### CR-13 — The release pipeline never re-runs the secret scan

**Severity: P2** · **Location:** `.github/workflows/release.yml:19-40`,
`.github/workflows/ci.yml:3-7`, `.github/workflows/ci.yml:78-93`,
`package.json` (`ci` script) · **Confidence: CONFIRMED**

`ci.yml`'s security job (gitleaks + osv-scanner) is triggered by
`push: branches: [main]` and `pull_request` only:

```yaml
# ci.yml:3-6
on:
  push:
    branches: [main]
  pull_request:
```

`release.yml`'s gate job runs `npm run ci`, whose scan step is `scan:audit`
(`npm audit --audit-level=high`) alone. A `v*` tag push therefore publishes
to GHCR and npm **without gitleaks and without osv-scanner**, and a tag can
be pushed against a commit whose main-branch CI never ran.

**Impact:** a secret committed on a branch, or an advisory affecting a
production dependency, reaches a published image and an npm package before
either scanner objects.

**Fix.** Add gitleaks (with `fetch-depth: 0`) to `release.yml`'s `ci` job, or
make the publish jobs depend on a job running the same scanner set as
`ci.yml`.

---

<a id="cr-14"></a>

### CR-14 — No connection or header-timeout hardening

**Severity: P2** · **Location:** `src/titan/http-server.ts:676-679`
· **Confidence: CONFIRMED**

```ts
// Bound how long a client may take to complete a request (SPEC §12 #16);
// the header timeout already defaults to 60 s.
server.requestTimeout = 60_000;
```

`server.maxConnections` is never set and `server.headersTimeout` is left at
Node's 60 s default. The rate limiter runs inside `precheck`, i.e. only after
the request line and headers are complete — so a client that dribbles headers
holds a socket without consuming a token. `docs/SPEC.md:310` calls the
limiter the "only DoS guard that needs no auth story"; a slow-header
connection bypasses it entirely.

**Fix.** Set `server.maxConnections` (e.g. 256),
`server.headersTimeout = 10_000`, `server.keepAliveTimeout = 5_000`.

---

<a id="cr-15"></a>

### CR-15 — The FTS query string is built on two paths

**Severity: P2** · **Location:** `src/core/store.ts:514-518` vs
`src/core/store.ts:1100-1105` · **Confidence: CONFIRMED**

```ts
// store.ts:514 — the exported canonical builder
export function toFtsQuery(raw: string, mode: MatchMode): string | null {
  const parts = ftsParts(queryTerms(raw));
  if (parts.length === 0) return null;
  return parts.join(mode === 'and' ? ' AND ' : ' OR ');
}
```

```ts
// store.ts:1100-1105 — search() re-implements it inline
const parts = ftsParts(terms);
const orQuery = parts.join(' OR ');
const andQuery = parts.join(' AND ');
```

`service.ts:374` calls `store.search({ query, ... })`;
`service.ts:435` calls `store.hasSearchMatch('or', query, row.citation)` →
`store.ts:1154` `toFtsQuery(rawQuery, mode)`. The same raw query string is
turned into an FTS query by two different code paths, and `hasSearchMatch`
re-tokenises the query a second time.

**Impact:** the `inResults` flag on pinned hits comes from
`hasSearchMatch`, while the hits themselves come from `search()`. If the
FTS-building rules change (a new escape, a new synonym expansion),
`search()` will not follow `toFtsQuery` and `inResults` becomes wrong — a
silent correctness bug, not a crash.

**Fix.** Have `search()` call `toFtsQuery`, or extract one
`buildFtsQueries(terms)` returning `{ or, and }` used by both.

---

<a id="cr-16"></a>

### CR-16 — eCFR permalink construction is duplicated

**Severity: P2** · **Location:** `src/core/service.ts:269-297` vs
`src/core/historical.ts:55-63` · **Confidence: CONFIRMED**

```ts
// service.ts:272
return `https://www.ecfr.gov/search?searchTerm=${encodeURIComponent(citation)}&titles=38`;
// service.ts:274
return `https://www.ecfr.gov/current/title-38/section-${encodeURIComponent(citation)}`;
// service.ts:297
return `https://www.ecfr.gov/on/${issueDate}/title-38/${kindSegment}-${encodeURIComponent(citation)}`;
```

```ts
// historical.ts:60-62
? `https://www.ecfr.gov/search?searchTerm=${encoded}&titles=38`
: `https://www.ecfr.gov/current/title-38/section-${encoded}`,
sourceUrlAtRequestedDate: `https://www.ecfr.gov/on/${requestedDate}/title-38/${kindSegment}-${encoded}`,
```

Identical URL shapes written twice, with different variable names.

**Impact:** the permalink form is a user-visible contract (`SPEC.md` §6
promises `sourceUrlAtIndexDate` / `sourceUrlAtRequestedDate`). Changing it
takes two edits; missing one silently ships a different URL on one surface.

**Fix.** One `core/urls.ts` exporting `sourceUrlFor(citation, kind)` and
`datedSourceUrlFor(citation, kind, date)`, used by both.

---

<a id="cr-17"></a>

### CR-17 — `findProvision` is duplicated with divergent case-folding

**Severity: P2** · **Location:** `src/core/historical.ts:72-81` vs
`src/core/redline.ts:93-103` · **Confidence: CONFIRMED**

```ts
// historical.ts — folds BOTH sides to lower case
return sections.find(
  (section) => section.kind === kind && section.citation.toLowerCase() === wanted,
);
```

```ts
// redline.ts — appendix folds both sides; section compares against target.citation
target.kind === 'appendix'
  ? section.kind === 'appendix' && section.citation.toLowerCase() === target.citation.toLowerCase()
  : section.kind === 'section' && section.citation.toLowerCase() === target.citation,
```

**Impact:** two functions with the same name and intent but different matching
rules. `redline.ts` relies on `target.citation` already being lower-cased by
`normalizeCitation` — an invariant invisible at the call site and easy to
break. A future change to one will not reach the other.

**Fix.** One shared helper in `core/citations.ts`, with the matching rule
explicit in a single place.

---

<a id="cr-18"></a>

### CR-18 — Nine identical error-handling blocks

**Severity: P2** · **Location:** `src/mcp/tools.ts:331, 369, 420, 463, 496, 527, 598, 650, 716`
· **Confidence: CONFIRMED**

Each of the nine `registerTool` handlers ends with the same block; only the
tool name differs:

```ts
} catch (error) {
  logger.error('tool search_regulations failed', {
    message: error instanceof Error ? error.message : String(error),
  });
  return {
    content: [{ type: 'text', text: `Error: ${clientSafeMessage(error)}` }],
    isError: true,
  };
}
```

**Impact:** nine copies of the sanitisation contract. A change to the error
shape must be made nine times, and one missed copy leaks an internal message
to a client — exactly the leak `src/mcp/client-safe.ts:4-25` exists to
prevent.

**Fix.** A `withToolErrorHandling(logger, toolName, fn)` wrapper applied at
registration.

---

<a id="cr-19"></a>

### CR-19 — `docs/SPEC.md` contradicts `eslint.config.mjs`

**Severity: P2** · **Location:** `docs/SPEC.md:334` vs
`eslint.config.mjs:26` · **Confidence: CONFIRMED**

```
SPEC.md:334:  … `no-explicit-any=error`, `no-console` allow-only-`error`, `complexity ≤ 10`, `eqeqeq` …
eslint.config.mjs:26:      complexity: ['error', 15],
```

`AGENTS.md:44` states: _"Do not edit `docs/SPEC.md` so that it contradicts the
implementation; change both in the same reviewed diff."_ This is a live
contradiction.

**Impact:** SPEC.md is the declared design authority, so a reader trusting it
will believe the complexity ceiling is 10 and mis-assess whether a function
is over budget. The same SPEC line claims "no `child_process`", which is
true of `src/` but not of `test/` (`test/markdown-tables.test.ts:59`,
`test/install-paths.test.ts:7`).

**Fix.** Update `SPEC.md:334` to match `15` (or lower the lint rule to 10),
and qualify the `child_process` claim as "in `src/`".

---

<a id="cr-20"></a>

### CR-20 — `JSON.parse` cast for the persisted sync-change record

**Severity: P2** · **Location:** `src/core/service.ts:592-601`
· **Confidence: CONFIRMED**

```ts
  /** Parsed sync-change record; corrupted meta degrades to null, never throws. */
  private lastChanges(): SyncChanges | null {
    const raw = this.store.getMeta('last_changes');
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as SyncChanges;
    } catch {
      return null;
    }
  }
```

The `catch` covers only _parse_ failure. A syntactically valid record with a
different shape passes straight through the `as` cast and onto the wire
(`/health`'s `lastChanges`, MCP `index_status`). This is the only `JSON.parse`
in `src/` without a validating schema — everywhere else uses zod
(`src/config.ts:36-54`, `src/core/service.ts:45-58`, `src/core/ecfr.ts:10-19`).

**Impact:** low likelihood (written only by `sync.ts:230`), but the cast
silently disables the guarantee the doc comment claims, and a future change to
`SyncChanges` (`src/core/changes.ts:15-30`) would not be caught.

**Fix.** `syncChangesSchema.safeParse(JSON.parse(raw))`, returning `null` on
failure.

---

<a id="cr-21"></a>

### CR-21 — Bare `Error` for upstream-data faults is swallowed to a generic 500

**Severity: P2** · **Location:** `src/core/ecfr.ts:31,60,62`;
handled at `src/titan/http-server.ts:649-660` · **Confidence: CONFIRMED**

```ts
// ecfr.ts:31
if (!DATE_RE.test(value)) throw new Error(`eCFR returned an invalid date: ${value}`);
// ecfr.ts:60
if (!title) throw new Error(`eCFR titles.json does not include title ${TITLE_38}`);
// ecfr.ts:62
if (upToDateAsOf === null) throw new Error(`eCFR reports no issue date for title ${TITLE_38}`);
```

These are upstream-data faults, not internal errors, but they are plain
`Error`, so the HTTP layer classifies them as "anything else" → logged and
collapsed into a generic `500 internal server error`. The most actionable
messages in the codebase are the ones being swallowed.

**Fix.** A typed `UpstreamFormatError` (or reuse `SyncError`) mapped to 502
with the message attached server-side.

---

<a id="cr-22"></a>

### CR-22 — A cast where an `instanceof` check belongs

**Severity: P2** · **Location:** `src/core/historical.ts:110`
· **Confidence: CONFIRMED**

```ts
// historical.ts:110
const status = (error as { status?: number }).status;
```

`HttpError` (`src/core/http-client.ts:32-40`) declares
`readonly status: number | undefined`, so
`error instanceof HttpError ? error.status : undefined` is both safer and
clearer. The cast will silently read `undefined` from any non-`HttpError`
that happens to carry a `status` property.

A second, _defended_ instance sits at `src/titan/http-server.ts:276`
(`kind: (url.searchParams.get('kind') ?? undefined) as 'section' | 'appendix' | undefined`);
the comment above it states the zod schema validates it, so it is not a
defect today — but the assertion means the compiler cannot catch a widening
of the union.

**Fix.** Replace the `historical.ts` cast with an `instanceof` check.

---

<a id="cr-23"></a>

### CR-23 — Rating tables lose their structure

**Severity: P2** · **Location:** `src/core/xml.ts:242-262`,
`src/titan/ui.ts:630`, `src/titan/ui.ts:1095-1100` · **Confidence: CONFIRMED**

The store keeps two renderings of a provision. `markdown` is a real markdown
table; `text` is pipe-joined rows with no separator row. The UI renders only
`text`:

```ts
// src/core/xml.ts:259-262
return {
  markdown: markdownRows.join('\n') + stray,
  text: rows.map((row) => row.join(' | ')).join('\n') + stray,
};
```

```js
// src/titan/ui.ts:630
sectionText.textContent = String(section.text);
```

with `blockquote { white-space: pre-wrap; }` (`ui.ts:1099`), so rows wrap
unpredictably on narrow screens.

**Impact:** § 4.130 (Schedule of Ratings — Disability Ratings) is the
most-read provision for this audience, and its rating tables become an
unaligned run-on block. The structured rendering already exists in the
payload; the UI just does not use it.

**Fix.** Render the `markdown` field with a minimal table/heading renderer
over a `textContent`-based builder, preserving the no-`innerHTML` posture —
or at minimum render pipe-rows as a `<table>`.

---

<a id="cr-24"></a>

### CR-24 — The search form omits `part` and hides the chapter rule

**Severity: P2** · **Location:** `src/titan/ui.ts:52-69`,
`src/core/service.ts:49-56`, `docs/openapi.yaml:203-210`
· **Confidence: CONFIRMED**

The API accepts `part`, `kind` and `chapter`; the UI form exposes `kind` and
`chapter` only. The chapter field is
`<input id="chapter" name="chapter" type="text" placeholder="e.g. I" />` with
no `pattern`, no `maxlength`, and no hint that the value must be an
**uppercase** Roman numeral — while `src/core/service.ts:54-56` enforces
`^[IVXLCDM]+$` and `docs/openapi.yaml:208-210` calls it "exact and
case-sensitive".

**Impact:** `part` is the most useful scope for this audience ("just part 4")
and the API supports it, but the UI cannot express it. Typing `i` instead of
`I` produces the regex error from CR-08.

**Fix.** Add a `part` input; set `pattern="[IVXLCDM]+"`, `maxlength="8"` and
`title="A Roman numeral, e.g. I"` on the chapter field so the browser
validates before the round-trip.

---

<a id="cr-25"></a>

### CR-25 — No discovery route

**Severity: P2** · **Location:** `src/titan/http-server.ts:494-557`
· **Confidence: CONFIRMED**

`dispatch` routes seven known paths and answers everything else with a bare
404:

```ts
// src/titan/http-server.ts:557
sendJson(req, res, 404, errorBody('not_found', `no route for ${pathname}`));
```

There is no `/` JSON index (that path serves the UI HTML,
`http-server.ts:545-548`) and no `/api/v1` route.

**Impact:** a developer or an LLM agent probing the service gets a dead end.
`docs/openapi.yaml` is the contract, but it is not reachable from the
running service — a self-hosted instance gives a user nothing to read to
learn the routes.

**Fix.** Serve `docs/openapi.yaml` at `/openapi.yaml` and add a small JSON
route index at `/api/v1` listing the routes and their required parameters.

---

<a id="cr-26"></a>

### CR-26 — README route table (fixed upstream); UI description still stale

**Severity: P3 (residual)** · **Disposition: the route-table half was FIXED
upstream by `8c876c5`; the UI-description item remains OPEN** · **Location:**
`README.md:410-412` vs `src/titan/ui.ts:44`, `docs/SPEC.md:307` ·
**Confidence: CONFIRMED**

**As audited at `aa3f73c` — now fixed.** The README route table listed five
routes:

```
| `GET` / `HEAD` | `/api/v1/search`             | `q` (required), `page`, `per_page`, `part` |
```

while `docs/openapi.yaml` documents seven — `/api/v1/diff` and
`/api/v1/redline` were missing from the table entirely, and the search params
`kind` and `chapter` were missing from the row. The two omitted routes were
mentioned only in README prose, never in the table a user scans.

**Upstream fix.** `8c876c5` (_"docs: tighten the network bullet, complete the
HTTP API table, fix SPEC disposition row 11"_) completed the table. It now
carries all seven routes and the full search parameter set:

```
| `GET` / `HEAD` | `/api/v1/diff`               | `from`, `to` (both r…
| `GET` / `HEAD` | `/api/v1/redline`            | `from`, `to`, `citat…
```

**Still open.** The same commit left the UI description stale. `README.md:410-412`
describes the UI as _"search + section reader with chapter/part browse"_,
omitting the Redline view that `src/titan/ui.ts:44` implements and
`docs/SPEC.md:307` documents:

```
The serve root `/` also serves a **read-only web UI** (search + section
reader with chapter/part browse over the same JSON API, hash-routed) — no auth, loopback bind by
default like the rest of the surface.
```

**Impact (residual):** low. A user looking for the diff endpoint now finds it
in the route table. A user looking for the redline _view_ in the browser does
not learn that it exists, because the UI's three tabs are described as two.

**Fix.** Update the `README.md:410-412` sentence to name the redline view —
"search + section reader with chapter/part browse + a redline view".

---

<a id="cr-27"></a>

### CR-27 — Every tool returns its payload twice

**Severity: P2** · **Location:** `src/mcp/tools.ts:365-368` and every other
tool handler · **Confidence: CONFIRMED**

```ts
return {
  content: [{ type: 'text', text: textContent(result) }],
  structuredContent: result,
};
```

`textContent` is `JSON.stringify(payload, null, 2)` (`tools.ts:231-233`) —
indentation inflates the copy further. On top of that, a section payload
carries both `text` and `markdown`, near-identical renderings of the same
body.

**Impact:** for a client that serializes both channels into the model
context, one `get_section` call on a large provision (§ 4.130 is tens of KB)
delivers roughly **four** copies of the same text. This is the classic way an
MCP server blows out an agent's context.

**Fix.** Return `structuredContent` only (clients that need text can
serialize it), or return a _trimmed_ text projection (citation, heading,
issue date, source URL, truncated body) alongside the full structured
payload.

---

<a id="cr-28"></a>

### CR-28 — No injection posture and no size bound on a provision

**Severity: P2** · **Location:** `src/mcp/tools.ts:246-270`,
`src/mcp/tools.ts:65-82`, `src/mcp/resources.ts:137-155`,
`src/core/changes.ts:13` · **Confidence: CONFIRMED**

The tool descriptions are unusually careful about _ranking_ ("Hits are ranked
by LEXICAL OVERLAP with the query, not by legal authority",
`tools.ts:266`) and about not citing unread provisions (`tools.ts:270`). But
nothing tells the model that the regulation text itself is untrusted data
that could contain instructions. A grep of the repo for `injection|untrusted`
finds only SQL-injection and XML-entity discussions (`SECURITY.md:26`,
`docs/SPEC.md:383`) plus one prompt-argument hardening note
(`docs/SPEC.md:469`) — nothing about content returned _to_ the model.

Separately, `diff_issues` bounds its citation lists at `CHANGE_LIST_CAP` and
reports a `truncated` flag (`tools.ts:166-188`), but `get_section`'s output
schema (`tools.ts:65-82`) has no cap and no truncation flag — a single huge
provision is returned whole.

**Impact:** regulatory text is normally inert, but the MCP surface's whole
purpose is to feed it to a model, and the `cfr_claim_evaluation` prompt
instructs the model to _"quote the operative text verbatim"_. The missing size
bound is the more immediate risk, given CR-27.

**Fix.** Add the injection posture to the `search_regulations` and
`get_section` descriptions and to both prompts; add a byte/line cap with an
explicit `truncated` flag to `get_section` / `get_section_at`, mirroring
`CHANGE_LIST_CAP`.

---

<a id="cr-29"></a>

### CR-29 — The first-run error is the least actionable message in the tool

**Severity: P2** · **Location:** `src/core/http-client.ts:189-192`,
`src/commands/ensure-index.ts:45-48` · **Confidence: CONFIRMED**

When the index is empty and auto-sync is on, `ensureIndex` calls `syncIndex`,
whose fetch failure propagates as a raw `HttpError`:

```ts
// src/core/http-client.ts:189-192
throw new HttpError(`request failed for ${url.pathname}: ${errorMessage(error)}`, url.pathname);
```

The user sees
`cfr-free: request failed for /api/versioner/v1/full/2026-10-29/title-38.xml: fetch failed`
— no indication that they are offline, that eCFR may be down, or that the
index is still empty. Contrast the sibling path, which is excellent:

```ts
// src/commands/ensure-index.ts:45-48
throw new CommandError(
  `index at ${config.indexPath} is empty — run \`cfr-free sync\` first`,
  EXIT.INDEX_UNAVAILABLE,
);
```

**Impact:** the error a first-time user is most likely to hit (no network, no
index yet) is the least helpful message in the tool. The upstream URL path is
also leaked where no user action depends on it.

**Fix.** Catch the fetch failure in `ensureIndex` / `syncIndex` and re-throw
with guidance — "could not reach ecfr.gov — check your network connection, or
set `CFR_AUTO_SYNC=0` and run `cfr-free sync` later" — keeping the detail in
the structured log.

---

<a id="cr-30"></a>

### CR-30 — 1 627 lines of test guard a 139-line YAML file

**Severity: P2** · **Location:** `test/ci-workflow.test.ts` (whole file),
`.github/workflows/ci.yml` · **Confidence: CONFIRMED**

`test/ci-workflow.test.ts` is 1 627 lines — roughly 10 % of the ~16 300-line
suite (16 150 of those lines are in `*.test.ts`) — and asserts on the raw text
of the 139-line `ci.yml`. It is already
linted by `actionlint`, which is in the gate (`package.json:46`) and is what
actually catches the GitHub-expression errors the guard's own header says it
cannot (`ci-workflow.test.ts:38-51`).

The guard's unique value is narrow: the required-check names, the
`npm run ci` step-order parity, and the actionlint-install-before-lint
ordering.

**Fix.** Keep those three checks; move the rest behind `actionlint` and a
YAML parse, and cut the file to a few hundred lines.

---

<a id="cr-31"></a>

### CR-31 — `SPEC.md` and `ROADMAP.md` have become delivery journals

**Severity: P2** · **Location:** `docs/SPEC.md:1`, `:349`, `:376`, `:411`;
`ROADMAP.md` (903 lines) · **Confidence: CONFIRMED**

`SPEC.md` §12 is a 28-row table of review findings (`#13`–`#40`), each with a
source attribution (`**Nemotron**`, `**Gemma**`, `**CI run**`) and a
disposition; §13 is a further backlog table with `Fixed`/`Backlog`/`Refuted`.
The document is titled `# cfr-free — Spec (v0.1 draft)` while `package.json`
is at `0.2.1`, and §13 states "**Fixed** = implemented in v0.4" — a version
that does not exist.

`ROADMAP.md` marks items `**Built** (M5 slice 2)`, `**Verified**
(2026-10-18)`, `**Researched — not bulk-derivable** (2026-10-18)`; its
"Later" section is a numbered list of 20 items that are all closed.

**Impact:** the design authority carries ~100 KB of delivery history a reader
must filter out to find the design. The stale title and the phantom "v0.4"
make it impossible to tell which parts are normative — a new contributor
cannot distinguish "this is how the system works" from "this is what a
reviewer said in October". 90 KB of roadmap for 8 400 lines of code, with
nothing ever removed, no longer answers "what next?".

**Fix.** Move `SPEC.md` §10/§12/§13 into `docs/review-log.md` (dated,
append-only) and leave SPEC.md normative with a corrected title. Keep
`ROADMAP.md` to open items only — its `## Open review findings — dispatch
first` section at `:3` is the useful part — and move closed items to
`docs/delivery-log.md`.

---

<a id="cr-32"></a>

### CR-32 — `store.ts` mixes persistence with query-language semantics

**Severity: P2** · **Location:** `src/core/store.ts:315-763` (query
language) vs `src/core/store.ts:785-1184` (`class Store`) · **Confidence:
CONFIRMED**

Between the SQL constants and the `Store` class sits a self-contained query
interpreter with no SQLite dependency: `SYNONYM_PHRASES` (315),
`RAW_PHRASE_EXPANSIONS` (347), `queryTerms` (407), `ftsParts` (478),
`toFtsQuery` (514), `tidySnippet` (526), `STOPWORDS` (575),
`contentTerms` (588), `asksAboutExceptions` (672), `visibleMatches` (690),
`hitWords` (711), `termResponded` (733) — roughly 380 lines. Only
`headingMatchKey` (608) and `presentFilters` / `filterClause` (277) are
SQL-coupled.

**Assessment:** the file is cohesive but overloaded — every function is small,
documented and single-purpose, but two independently evolvable concerns live
in one file, which is why CR-15 could arise without anything noticing.

**Fix.** Extract the query-language block into `src/core/query.ts` (~380
lines, no SQLite import). `Store` then drops to ~400 lines and the query
rules become unit-testable without a database.

---

<a id="cr-33"></a>

### CR-33 — Missing `Referrer-Policy` / HSTS headers

**Severity: P2** · **Location:** `src/titan/http-server.ts:557`,
`src/titan/http-server.ts:183-191` · **Confidence: CONFIRMED**

The request path is reflected into the 404 body:

```ts
sendJson(req, res, 404, errorBody('not_found', `no route for ${pathname}`));
```

**This is not exploitable as XSS** — the response carries
`content-type: application/json; charset=utf-8`,
`X-Content-Type-Options: nosniff` and `cross-origin-resource-policy:
same-origin`, so no browser renders it as HTML. It is recorded here because it
is user input echoed into a body.

Separately, API responses carry no `Referrer-Policy` and no HSTS header (the
UI document does set `<meta name="referrer" content="no-referrer">` and CSP
`frame-ancestors 'none'`).

**Fix.** Add `Referrer-Policy: no-referrer` to `sendJson` / `sendText`; add
HSTS only if a deployment is ever fronted by TLS.

---

## P3 findings

<a id="cr-34"></a>

### CR-34 — `actionlint` is installed by mutable tag

**Severity: P3** · **Location:** `.github/workflows/ci.yml:58`,
`.github/workflows/ci.yml:103`, `.github/workflows/release.yml:38`
· **Confidence: CONFIRMED**

```yaml
go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
```

Every GitHub Action in these workflows is SHA-pinned with the version in a
comment — an excellent, deliberate posture. This `go install` is the one
unpinned fetch; a retagged upstream release would execute in CI with the
runner's default credentials.

**Fix.** Pin to the module's commit SHA and record `v1.7.12` in a comment,
matching the existing convention.

---

<a id="cr-35"></a>

### CR-35 — `trivy` and `semgrep` never run in CI

**Severity: P3** · **Location:** `tools/security-scan.sh:78-86`,
`package.json` (`ci` script) · **Confidence: CONFIRMED**

`tools/security-scan.sh` runs npm audit, osv-scanner, gitleaks, **trivy**
(`vuln,secret,misconfig` at HIGH/CRITICAL) and **semgrep** (`--config auto`).
CI runs only the first three; trivy and semgrep exist solely in the local
`npm run scan` path, so a container or SAST finding surfaces only on a
developer machine that happens to have them installed.

`AGENTS.md:45` documents this accurately ("CI's `security` job runs only
gitleaks and osv-scanner"), so this is a coverage gap rather than a
documentation error.

**Fix.** Add a pinned `aquasecurity/trivy-action` step to `ci.yml`'s security
job, scanning the filesystem and the built image.

---

<a id="cr-36"></a>

### CR-36 — The install-time `prepare` script reaches the network

**Severity: P3** · **Location:** `scripts/prepare.mjs:95-112`,
`package.json` (`files`, `prepare`) · **Confidence: CONFIRMED**

```js
const status = run(
  'npm',
  [
    'install',
    '--include=dev',
    '--no-save',
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
    '--global=false',
  ],
  env,
);
```

When TypeScript is not locally resolvable (the `npm install -g
github:deffenda/cfr-free` path), this runs a full dev-dependency install —
including every dependency's lifecycle scripts — at install time, with
`--no-audit` disabling the audit of that very install. The script is also
shipped in the published tarball.

Separately, `eslint.config.mjs` applies `security/detect-child-process` and
`security/detect-unsafe-regex` only to `**/*.ts`; the `.mjs` block that
covers `prepare.mjs` has no `security` plugin, so this file sits outside the
repo's own security lint — and it _does_ use `spawnSync` (`prepare.mjs:45`).

**Fix.** Extend the `security` plugin rules to `**/*.mjs` / `**/*.js`, and
prefer `npm ci` against a committed lockfile for the fallback install.

---

<a id="cr-37"></a>

### CR-37 — Prompt templates interpolate free-text arguments

**Severity: P3** · **Location:** `src/mcp/resources.ts:128,146,172,183,193,201`
· **Confidence: CONFIRMED**

```ts
topic: z.string()
  .min(3)
  .max(200)
  .regex(/^[^\p{C}]+$/u, 'topic must not contain control characters');
```

```ts
                `Research "${args.topic}" in ${scope} using the cfr-free tools.\n` +
```

The control-character rejection correctly blocks newline-based restructuring
of the generated message, but it does not block instruction text — a `topic`
of `x" and now do something else instead` lands inside the generated user
message. This is self-injection (the caller supplies the argument, so the
caller gains nothing), which is why it is P3.

**Fix.** Wrap free-text arguments in an explicit delimiter with a
"treat as data, not instructions" instruction.

---

<a id="cr-38"></a>

### CR-38 — The corpus receipt is a receipt, not a trust anchor

**Severity: P3** · **Location:** `src/mcp/resources.ts:41`,
`src/core/changes.ts:80` · **Confidence: CONFIRMED**

The MCP resource advertises _"the corpus receipt hash"_. It is computed from
the section hashes and stored in the same SQLite file it covers
(`src/core/changes.ts:80`), so anyone who can write the index can recompute
it. The wording "receipt" is honest and the SPEC does not claim a trust
anchor, so this is an observation rather than a defect.

**Impact:** bounded — the precondition (write access to the index file, or a
compromised CA for the upstream TLS) is the same trust level as the process
itself. Worth stating explicitly because the product's consumers are told to
quote the text verbatim in a benefits-adjudication context.

**Fix.** If tamper-evidence is wanted, sign the receipt with a key held
outside the index, or publish the expected hash per issue date as a signed
release artifact.

---

<a id="cr-39"></a>

### CR-39 — `--help` on a subcommand is an error

**Severity: P3** · **Location:** `src/cli.ts:168,198`, `src/commands/serve.ts:80`
· **Confidence: CONFIRMED**

```
$ node dist/cli.js search --help
cfr-free: unknown option for search: --help      [exit=2]
$ node dist/cli.js sync --help
cfr-free: unexpected arguments after 'sync': --help   [exit=2]
```

The only usage text is the global `USAGE` block (`src/cli.ts:18-47`); there
is no per-command help. Separately, `cfr-free serve` reports its URL only
through the structured log —
`logger.info('http api listening', { url: ..., freshness })`
(`src/commands/serve.ts:80`) — so a human gets no plain-language
"Serving on http://127.0.0.1:8787".

**Fix.** Accept `--help` / `-h` after any command and print that command's
usage; print a plain "Serving on <url>" line.

---

<a id="cr-40"></a>

### CR-40 — Missing `aria-current`; heading order skips `h2`

**Severity: P3** · **Location:** `src/titan/ui.ts:42-44`,
`src/titan/ui.ts:1063` · **Confidence: CONFIRMED**

The UI's nav tabs carry no `aria-current`, so screen-reader users get no
"active tab" signal; the search view jumps `h1` → `h3`.

**Fix.** Set `aria-current="page"` on the active nav link; use `h2` for
search-result headings.

---

<a id="cr-41"></a>

### CR-41 — Stale JSDoc block and two unused exports

**Severity: P3** · **Location:** `src/core/store.ts:1027-1029`,
`src/mcp/client-safe.ts:26`, `src/core/store.ts:575` · **Confidence: CONFIRMED**

```ts
  /** sha256 of every indexed section's text — the pre-sync snapshot. */
  /**
   * SHA-256 of every section's text, keyed by citation. Read in bounded
   * rowid batches: …
```

Two JSDoc blocks stacked on one method; the first is a stale one-line summary
superseded by the second. `isClientSafe` (`client-safe.ts:26`) and
`STOPWORDS` (`store.ts:575`) are exported but referenced only within their
own files.

**Fix.** Delete the stale one-liner; drop the `export` from the two symbols
unless a consumer is planned.

---

<a id="cr-42"></a>

### CR-42 — `AGENTS.md` and its guard name three required checks; branch protection requires four

**Severity: P3** · **Location:** `AGENTS.md:48`,
`test/ci-workflow.test.ts:55` · **Confidence: CONFIRMED** (found on review)

`AGENTS.md:48` states that the required checks on `main` are "`quality (22)`,
`quality (24)` and `security`". Branch protection actually requires four:

```
$ gh api repos/deffenda/cfr-free/branches/main/protection --jq '.required_status_checks.contexts'
["quality (22)","quality (24)","security","actionlint"]
```

The guard that is supposed to keep the list in step repeats the same stale
three:

```ts
// test/ci-workflow.test.ts:54-55
/** The checks branch protection on `main` requires. Keep in step with it. */
const REQUIRED_CHECKS = ['quality (22)', 'quality (24)', 'security'] as const;
```

**Impact:** low — `actionlint` is a required check that CI runs and that
`npm run ci` also runs, so nothing is actually skipped. But `AGENTS.md` is the
canonical agent-facing file, and it under-states the merge floor by one check,
while the test whose stated job is to track that floor is itself stale. An
agent reading `AGENTS.md` to decide which checks to wait for would wait for
three of four.

**Fix.** Add `actionlint` to the list in `AGENTS.md:48` and to
`REQUIRED_CHECKS` in `test/ci-workflow.test.ts:55`.

---

## Controls that work — preserve these

These were verified, not assumed. Do not regress them while fixing the above.

- **FTS5 injection is closed.** `ftsParts` (`src/core/store.ts:478-501`)
  emits only `"${word}"*` where words come from `split(/[^\p{L}\p{N}]+/u)`,
  and the expression is always a bound parameter. The one path where user
  text re-enters the builder — `service.ts:490` `notFoundMessage` →
  `.search({ query: `"${citation}"`, page: 1, perPage: 5 })`, with an appendix citation that may
  contain quotes (`src/core/citations.ts:27`) — is neutralised by the
  span/token splitter. No operator can escape.
- **SQL is fully parameterized.** Every user-derived value in `store.ts` is
  bound (`?`); the only concatenated SQL text is from fixed constants plus
  bound parameters.
- **XXE and billion-laughs closed twice.** `src/core/xml.ts:580` rejects
  `<!DOCTYPE` pre-parse; `:584` independently rejects `<!ENTITY`; plus
  `MAX_DEPTH = 64` and `MAX_SECTION_CHARS = 400_000`.
- **Loopback-by-default with a coupled limiter.** `src/config.ts:90` refuses
  a non-loopback bind without `CFR_ALLOW_REMOTE=1`, and
  `src/commands/serve.ts:67` enables the limiter on exactly that same flag —
  the limiter can never be off on a remote bind. (The check is on the literal
  host string: `LOOPBACK_HOSTS` (`src/config.ts:31`) is
  `127.0.0.1`, `::1`, `localhost`, `[::1]`, and `localhost` is trusted as
  loopback without being resolved. Harmless in practice — `localhost`
  resolves to a loopback address — but a manipulated `/etc/hosts` would make
  a `CFR_HOST=localhost` bind routable with no limiter.)
- **Rate-limiter peer identity is unforgeable:** `req.socket.remoteAddress`,
  with no `X-Forwarded-For` trust. Memory is bounded by `maxPeers` + LRU
  prune (`src/titan/rate-limit.ts:78-84`), and the IPv6-rotation trade-off is
  documented rather than hidden.
- **Client-safe error taxonomy.** `src/mcp/client-safe.ts:26-33`
  discriminates on class identity, not a `code` string, so `ENOENT` /
  `SQLITE_CANTOPEN` messages carrying file paths can never reach a client.
  Failures that are neither `ServiceError` nor `StructureError` collapse to a
  fixed generic (`src/titan/http-server.ts:669`); `StructureError` messages do
  reach the client by design, and are documented user-facing guidance
  (`http-server.ts:653-662`).
- **HTTP hygiene.** GET/HEAD only (`http-server.ts:594`), URL ≤ 2048 bytes →
  414, `q` ≤ 800 bytes, `part` ≤ 10 bytes, `nosniff` + CORP `same-origin` on
  every response, no CORS headers, strong sha256 `ETag` over exact bytes
  (`http-server.ts:62-71`) with RFC 9110 weak comparison and correct list
  splitting (`http-server.ts:116-135`).
- **The UI is not an injection vector.** Zero inline script, `default-src
'none'` CSP with `frame-ancestors 'none'` on the document, and no
  `innerHTML` / `outerHTML` / `document.write` anywhere in `src/` — dynamic
  nodes are built with `createElement` + `textContent`, and every href is
  `encodeURIComponent`-encoded (`src/titan/ui.ts:267-269`). (A grep for those
  three names in `src/` returns exactly two hits, both inside the comment
  that documents this rule at `src/titan/ui.ts:17-18`; there are no
  assignments.)
- **Upstream client.** Hardcoded `https://www.ecfr.gov`
  (`src/core/ecfr.ts:7`), not env-overridable → no SSRF. 15 s timeout, 50 MiB
  streaming cap enforced _during_ the read, bounded retries with backoff,
  error bodies truncated to 200 chars, no query strings in error messages.
- **Validation precedes cost** on the paths that got it right —
  `src/core/historical.ts:95-103`, `src/core/diff.ts:101-105`.
- **CI/CD.** All actions SHA-pinned; workflow-level `permissions: contents:
read`; `pull_request_target` unused; no untrusted `${{ }}` reaches a `run:`
  block (tag names flow through quoted `$GITHUB_REF_NAME`); `actionlint` +
  shellcheck; gitleaks + OSV + npm audit on every PR; npm publish via OIDC
  trusted publishing with `--provenance`, gated behind
  `vars.NPM_TRUSTED_PUBLISHING`, with a tag/version match enforced.
- **Docker.** Digest-pinned base image, non-root `cfr` user with `/data`
  chowned to it, `--ignore-scripts` in the build stage,
  `npm prune --omit=dev`.
- **Secrets hygiene.** No tokens, keys, real hostnames or non-loopback IPs in
  the tree or in git history. `.gitignore` excludes `*.sqlite` and `.env*`; no
  index files are tracked.
- **Static analysis.** `security/detect-unsafe-regex` and
  `detect-child-process` are eslint _errors_; there is no `child_process` use
  in `src/`, and the regexes are deliberately flat rather than
  nested-quantifier shaped (`src/core/citations.ts:29-36`).
- **Layering is clean.** No import from `src/core/` reaches `src/commands/`,
  `src/titan/` or `src/mcp/`; `src/titan/` and `src/mcp/` never import
  `src/commands/`. The `src/` tree in `SPEC.md:26-61` matches the filesystem
  exactly.
- **Strict typing.** `tsconfig.json:8-21` sets `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitReturns`, `noUnusedLocals`/`Parameters`, `verbatimModuleSyntax`.
  The result: **zero** `any`, **zero** `@ts-ignore`, **zero** non-null
  assertions in `src/`.
- **zod at every real external boundary:** env (`config.ts:36-54`), service
  inputs (`service.ts:45,156,158`), upstream API response (`ecfr.ts:10-19`),
  MCP output schemas (`tools.ts:35+`).
- **The OpenAPI contract is real, not aspirational.** The conformance suite
  boots an in-process server and validates live response bodies against the
  schemas (`test/openapi-conformance.test.ts:765-976`), checks that HEAD
  mirrors GET (`:839`), and verifies that every `# source: file:line`
  citation in the YAML still points at the construct it names (`:1099`).
- **The UI's `node:vm` harness** (`test/ui.test.ts:1-20`) executes the
  _served string_ against a stub DOM with controllable response ordering — the
  right answer to "no browser library allowed", and it has caught real bugs.
- **Graceful staleness.** A failed refresh serves the existing index with a
  warning instead of failing (`src/commands/ensure-index.ts:60-68`), and the
  stale state is surfaced end to end — API envelope, UI status line, MCP
  `health` tool.
- **Citation honesty.** Hits print the _dated_ source URL
  (`src/commands/search.ts:29-39`); the UI labels an out-of-index cross-cite
  as "(not in this copy)" rather than implying the provision does not exist.

---

## Not verified / out of scope

- **Live eCFR behaviour.** No systematic network testing against
  `www.ecfr.gov`; upstream payload sizes and the ~5 s sync duration are taken
  from the repo's own measurements and code comments. One incidental sync ran
  during CLI verification.
- **Dependency sources.** `fast-xml-parser`, `@modelcontextprotocol/sdk` and
  `zod` were not audited. `npm audit --audit-level=high` runs in CI; no
  `osv-scanner` run was executed in this audit.
- **The contents of the GitHub Actions at their pinned SHAs** — only the
  pinning format was verified, not what those commits do.
- **The MCP SDK's stdio framing** and its zod → JSON-Schema conversion for
  tool input schemas.
- **`docs/openapi.yaml` schema bodies** beyond the `source:` citations.
- **Container runtime behaviour** — no image was built or run; memory limits,
  seccomp profile and whether `docker-proxy` masks client IPs from
  `remoteAddress` were not observed.
- **GHCR / npm registry contents** and the SLSA provenance attestation chain.
- **Git history beyond a secret-pattern grep** — no full gitleaks run over all
  revisions.
- **Performance, load and accessibility testing.** CR-04's concurrency
  arithmetic is derived from the code's own limits, not measured under load.
- **Windows and other-platform behaviour**; multi-user concurrency; the rate
  limiter's fairness semantics.
- **`tools/llm-review.mjs`, `tools/corpus-fidelity-probe.mjs` and the body of
  `scripts/validate.sh`** (15 KB) were read only as far as their headers and
  invocation sites. `scripts/validate.sh` is _not_ part of `npm run ci` — it
  is an optional pre-commit gate — and was not assessed for correctness.
- **`docs/research/` prose claims and `ROADMAP.md` content** were not audited
  as factual assertions, only for structure (CR-31).

---

## Suggested sequencing

Ordered by dependency and by cost, not by severity alone.

1. **CR-01, CR-02** — the gate is currently self-deceiving; fix it before
   trusting any other gate result. Two small diffs.
2. **CR-05, CR-07** — move query validation ahead of the sync and correct the
   exit-code mapping. Small, self-contained, high user value.
3. **CR-03** — extract `UI_JS`; unlock linting over 840 lines.
4. **CR-04, CR-14** — weight the rate limiter and bound connections. Touches
   `http-server.ts`, so coordinate with CR-11's line-number citations.
5. **CR-06, CR-08, CR-09, CR-23, CR-24, CR-25** — the usability sweep.
   (CR-26's route-table half landed in `8c876c5`; only the README UI-description
   sentence remains.)
6. **CR-10, CR-15, CR-16, CR-17, CR-18, CR-20, CR-21, CR-22, CR-32** — the
   maintainability refactors. CR-10 (extract `errors.ts`) is the enabling
   change for CR-21 and CR-22.
7. **CR-12, CR-13, CR-19, CR-31** — deployment posture and doc hygiene.
8. **The P3 sweep** — CR-34 through CR-42.

---

## Disclosure — tests that assert on the text of other files

Required by `AGENTS.md:51` (_"If a test asserts on the text of another file,
surface it"_).

| Test file                                                          | Reads                                                                                                                                                           | Cost of a false failure                                                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/install-paths.test.ts:55,96,101,247,287,310,472-474,486,600` | **seven** repo files: `package.json`, `src/cli.ts`, `scripts/prepare.mjs`, `Dockerfile`, and all three workflow files (`ci.yml`, `release.yml`, `live-e2e.yml`) | renaming a script or env var breaks the test; **editing any workflow file breaks it** — e.g. renaming `gh release create` fails 2 further tests |
| `test/ci-workflow.test.ts` (1 627 lines)                           | **every** `.yml`/`.yaml` in `.github/workflows/` (`:61-66`, `:788`, `:815`, `:900`) and `package.json` (`:52`)                                                  | **any** reformat of **any** workflow file breaks the guard — see CR-30                                                                          |
| `test/openapi-conformance.test.ts:1000-2072`                       | the SYMBOLS of `src/titan/http-server.ts` — its declarations, path constants and dispatch branches — and no longer its line numbers                             | renaming a cited symbol, or moving a handler to another route, breaks the suite — see CR-11                                                     |
| `test/markdown-tables.test.ts:152-171`                             | the text of every tracked `.md`                                                                                                                                 | a malformed table fails the suite                                                                                                               |
| `test/no-conflict-markers.test.ts:75-96`                           | the text of every tracked file                                                                                                                                  | a conflict marker fails the suite                                                                                                               |
| `test/contract-drift.test.ts` (added by CR-04)                     | the text of `docs/openapi.yaml` (the token-cost table and the 429 text), `docs/SPEC.md`, `README.md` and EVERY `.ts`/`.js`/`.mjs`/`.cjs` file under `src/`      | editing a published price or fetch bound fails the suite; editing a source file's DOC COMMENT can fail it (a false claim about the memo)        |

**Assessment:** the first two are defensible inter-file contract tests —
`install-paths.test.ts:36-40` states the rationale explicitly and each
assertion names the file it reads — but their blast radius is wider than the
"Reads" column first suggested, and the table above now names every file.
Two edits that the earlier form of this table did not disclose were confirmed
to break the suite: unpinning `actions/checkout@v7` in `live-e2e.yml` fails
`ci-workflow.test.ts` ("pins every action to a full commit SHA"), and renaming
`gh release create` to `gh release upload` in `release.yml` fails 2 further
`install-paths.test.ts` tests (a third, the release guard, was already red —
see CR-01). The markdown and conflict-marker guards
are structural rather than textual-brittle, and both document precisely what
they cannot see (a marker inside a fenced block; a setext `=======` underline)
and skip vacuously rather than falsely when there is no git checkout
(`markdown-tables.test.ts:155-162`). The cost asymmetry in
`ci-workflow.test.ts` is the one that is not defensible — see CR-30.

---

## Provenance

Audit performed 2026-10-29 against `main` at `aa3f73c`, with `origin/main`
in sync. Three independent reviews (security, maintainability, usability)
were run and their findings cross-checked against the source by the
orchestrating session; every headline claim above was re-verified there, by
execution where the claim was behavioural. No repository file was modified
in the course of the audit.

### Fresh-context review

The merged head was reviewed by an independent reviewer with no prior
knowledge of this document, instructed to audit the audit: spot-check the
citations, challenge the P1 severities, verify the "Controls that work"
claims for false comfort, and look for material omissions. It confirmed the
headline findings — CR-01's two halves, CR-02's undeclared dependencies, the
CR-03 linter blind spot, CR-05 and CR-07's CLI behaviour (reproduced live),
the coverage and lint figures, and every row of the rebase-mapping table
below — and raised the following corrections, all of which are now applied:

| Correction                                                                                                                               | Change                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CR-10 rated P1 while the document itself concedes the code is correct today                                                              | downgraded to **P2**, with a note recording the reasoning                                                                                                                                                                                                                                                                                                                    |
| "Non-`ServiceError` failures collapse to a fixed generic" — `StructureError` is not a `ServiceError` and its message is echoed by design | claim made precise                                                                                                                                                                                                                                                                                                                                                           |
| The ETag claim cited one range for two separate locations                                                                                | split into `http-server.ts:62-71` (sha256) and `:116-135` (matcher)                                                                                                                                                                                                                                                                                                          |
| "Eighteen `# source:` comments" — 17 citations plus the convention note at `docs/openapi.yaml:4`                                         | corrected to seventeen                                                                                                                                                                                                                                                                                                                                                       |
| "`test/ci-workflow.test.ts` is ~11 % of the ~14 700-line suite"                                                                          | corrected to ~10 % of ~16 300 lines (16 150 in `*.test.ts`)                                                                                                                                                                                                                                                                                                                  |
| Scope header said `test/` has 39 files                                                                                                   | corrected to 36 `*.test.ts` files and a measured 766 cases                                                                                                                                                                                                                                                                                                                   |
| `Dockerfile:25-26` quoted a four-line `ENV` block                                                                                        | corrected to `:23-26`                                                                                                                                                                                                                                                                                                                                                        |
| `SPEC.md:24-58` for the `src/` tree                                                                                                      | corrected to `:26-61`                                                                                                                                                                                                                                                                                                                                                        |
| A quoted YAML citation spliced two non-adjacent lines                                                                                    | shown as two separate lines with their line numbers                                                                                                                                                                                                                                                                                                                          |
| The CR-02 import quote omitted the third import                                                                                          | completed                                                                                                                                                                                                                                                                                                                                                                    |
| `test/ui.test.ts` "39 assertions"                                                                                                        | corrected to 39 test cases / 96 assertions                                                                                                                                                                                                                                                                                                                                   |
| The linter control experiment's configuration was not stated                                                                             | stated (a `.ts` control under the repo's own eslint config — a `.js` control reproduces a different count, because `eqeqeq` is scoped to `**/*.ts`)                                                                                                                                                                                                                          |
| The `innerHTML` claim did not mention the two comment hits                                                                               | noted                                                                                                                                                                                                                                                                                                                                                                        |
| The `LOOPBACK_HOSTS` caveat and the `openapi-conformance` range fix were applied but unlisted                                            | both added to the corrections table                                                                                                                                                                                                                                                                                                                                          |
| **The AGENTS.md:51 Disclosure table under-reported which files are text-asserted on**                                                    | both rows expanded: `ci-workflow.test.ts` reads **every** workflow file plus `package.json`; `install-paths.test.ts` reads **all three** workflow files and the raw text of `release.yml`. Two edits the earlier table did not disclose were confirmed to break the suite (unpinning `actions/checkout@v7` in `live-e2e.yml`; renaming `gh release create` in `release.yml`) |
| `AGENTS.md:48` and `test/ci-workflow.test.ts:55` name three required checks; branch protection requires four                             | added as **CR-42**                                                                                                                                                                                                                                                                                                                                                           |

The reviewer also confirmed the CR-18 "nine identical error-handling blocks"
claim (nine `server.registerTool` calls, catch blocks at exactly the nine
cited lines) and the `ajv` dependency graph from `package-lock.json`
(`node_modules/ajv` 8.20.0, `node_modules/ajv-formats` 3.0.1, MCP SDK
`ajv@^8.17.1` + `ajv-formats@^3.0.1`, eslint nesting `ajv@6.15.0`).

### Rebase onto `8c876c5`

`origin/main` moved to `8c876c5` (_"docs: tighten the network bullet,
complete the HTTP API table, fix SPEC disposition row 11"_) while the audit
was in flight. That commit touches only `README.md` and `docs/SPEC.md`, so
every finding that cites source code is unaffected. The document was rebased
onto `8c876c5` and the affected documentation citations re-verified line by
line against the new base:

| Citation at `aa3f73c`              | Corrected at `8c876c5`                    | Status                                                 |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| `README.md:363-369`                | `README.md:363-371`                       | content changed — CR-26 route table completed upstream |
| `README.md:388`                    | `README.md:52`                            | shifted — now used only for the prose-mention note     |
| `README.md:404-406`                | `README.md:406-408`                       | shifted — re-verified                                  |
| `README.md:408-410`                | `README.md:410-412`                       | shifted — re-verified                                  |
| `README.md:437`                    | `README.md:437-442` (the "2" row: `:439`) | shifted — re-verified                                  |
| `docs/SPEC.md:308`                 | `docs/SPEC.md:307`                        | shifted — re-verified                                  |
| `docs/SPEC.md:1,349,376,411`       | unchanged                                 | re-verified                                            |
| `docs/SPEC.md:310,334,363,383,469` | unchanged                                 | re-verified                                            |
| `docs/SPEC.md:26-61`               | unchanged                                 | re-verified                                            |

CR-26 is the only finding whose _substance_ changed; it is now marked
fixed-upstream with a residual item. No other finding's disposition moved.
