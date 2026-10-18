# Contributing

Thanks for contributing! This project stays small and strict on purpose.

## Development setup

```bash
git clone https://github.com/deffenda/cfr-free.git
cd cfr-free
npm ci          # installs pinned deps (allowlist-managed install scripts)
npm run ci      # the same gate CI runs
```

Requires Node ≥ 22.5.

## Workflow

1. Open an issue first for anything beyond small fixes.
2. Branch from `main`: `git checkout -b fix/short-description`.
3. Make the change with tests. `docs/SPEC.md` is the design authority —
   update it when behavior or architecture changes. HTTP API changes must
   also update `docs/openapi.yaml` (each path cites its router line in
   `src/titan/http-server.ts`).
4. Run the gates locally before pushing:

   ```bash
   npm run ci        # format, lint, typecheck, tests+coverage, build, audit
   npm run scan      # optional: gitleaks/osv/trivy/semgrep (skips missing tools)
   ```

5. Open a pull request using the template. CI must be green
   (`quality (22)`, `quality (24)`, `security`).
6. Squash-merged PRs only; keep commit messages meaningful in the squash
   title.

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

## Reviews

## Reviews

Human PR reviews are not required (solo maintainer). Every PR gets an
independent multi-model review round before merge — see the
`AGENTS.md` and `claude/rules/cross-model-review.md` files at the repo
root for the standing process (hostile-stance reviewer, effort floor,
verdict format). Gemma/LM-Studio passes were part of earlier rounds and
are recorded in the SPEC review log when their findings changed the
design.
