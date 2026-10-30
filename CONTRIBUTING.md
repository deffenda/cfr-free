# Contributing

Thanks for contributing! This project stays small and strict on purpose.

## Development setup

```bash
git clone https://github.com/deffenda/cfr-free.git
cd cfr-free
npm ci          # installs pinned deps (allowlist-managed install scripts)
npm run ci      # the same gate CI runs
```

Requires Node ≥ 22.5 and `git` on PATH. The release guard
(`test/install-paths.test.ts`) reads the repository's tags with `git`, and a
checkout without them makes that guard fail rather than pass silently: a
shallow clone (`git clone --depth 1`) carries no tags, so fetch them with
`git fetch --tags`.

The local gate also needs `actionlint` on PATH — `npm run ci` runs
`npm run lint:actions`. Install the version CI installs — v1.7.12, and by
COMMIT: `go install github.com/rhysd/actionlint/cmd/actionlint@914e7df21a07ef503a81201c76d2b11c789d3fca`;
`brew install actionlint` also works, but its release must be v1.7.12.

Nothing else is needed: the OpenAPI contract suite parses `docs/openapi.yaml`
with the `yaml` package from this repository's own devDependencies, so no
Python interpreter or PyYAML is involved.

## Workflow

1. Open an issue first for anything beyond small fixes.
2. Branch from `main`: `git checkout -b fix/short-description`.
3. Make the change with tests. `docs/SPEC.md` is the design authority —
   update it when behavior or architecture changes. HTTP API changes must
   also update `docs/openapi.yaml` (each path cites the router SYMBOL it
   comes from — `src/titan/http-server.ts#handleSearch` — not a line
   number, so inserting a line above the router does not invalidate the
   citation; the contract suite resolves every citation and fails if the
   symbol is gone or no longer carries the construct it is cited for).
4. Run the gates locally before pushing:

   ```bash
   npm run ci        # format, lint, workflow lint, typecheck, tests+coverage, build, audit
   npm run scan      # optional: gitleaks/osv/trivy/semgrep (skips missing tools)
   ```

   `npm run scan` skips a tool that is not installed, so a green run is not by
   itself proof that a secret scan happened. Before tagging a release, run
   `npm run scan:strict` instead — it fails unless gitleaks and osv-scanner
   actually ran.

5. Open a pull request using the template. CI must be green
   (`quality (22)`, `quality (24)`, `security`).
6. Squash-merged PRs only; keep commit messages meaningful in the squash
   title.

**Before you finish:**

- Changed a route? Update `docs/openapi.yaml` in the same commit.
- Added or changed a field? Confirm `test/openapi-conformance.test.ts` still passes.
- Run `npm test`, then `npm run ci`, before pushing (full suite, coverage floors).
- `/health` should still match its schema — the conformance test asserts it live.
- Want to see the served shape? `cfr-free serve`, then `GET /health` in a browser.

## Releasing

A `v*` tag is cut by the operator, and the release workflow's gate is
`npm run ci` — which does not include the secret scan. The release checklist
is [`docs/SPEC.md`](docs/SPEC.md) §11.1; in short: `npm run ci`, then
`npm run scan:strict`, then `npm run build`, and check the scan output says
`pass: gitleaks` and `pass: osv-scanner` rather than `skip:`.

## Style

- TypeScript strict mode, ESM, `.js` import extensions (NodeNext).
- No `any` in `src/` (eslint-enforced), explicit return types on exported
  functions.
- Prettier is authoritative for formatting — never hand-format.
- Error messages are actionable and free of stack traces; logs are structured
  JSON on stderr.

## Testing

- Vitest unit tests live in `test/` and must never touch the network —
  inject fetch/sleep through `HttpClient` options.
- Keep the coverage thresholds green (`npm run test:coverage`); they are
  floors, not targets — prefer tests over exclusions.

## Releases

The release guard (`test/install-paths.test.ts`) compares `package.json`'s
version with the repository's tags, so the rule is: **the version must move
past the newest released tag.** Between releases `main` holds the version it
just published; the first change on top of that must bump `package.json` to
a new version (`0.2.2` → `0.2.3`), and the tag you cut must equal
`package.json` exactly — the release workflow refuses to publish otherwise
(`test "$TAG" = "$PKG"`).

The guard reads `git tag`, so a checkout without tags leaves it asserting
nothing. CI checks out with `fetch-depth: 0`; a shallow local clone needs
`git fetch --tags` before the suite can judge the version.

## Reviews

Human PR reviews are not required (solo maintainer). An independent
fresh-context review of the exact head, with no unresolved P0 or P1
findings, is required for every PR before merge — see `AGENTS.md` at the
repo root for the merge rule. Gemma/LM-Studio passes were part of earlier
rounds and are recorded in the SPEC review log when their findings changed
the design.
