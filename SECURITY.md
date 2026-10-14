# Security

## Supported versions

Only the latest release on `main` receives security fixes.

## Reporting a vulnerability

Please report suspected vulnerabilities via
[GitHub private vulnerability reporting](https://github.com/deffenda/cfr-free/security/advisories/new)
(preferred — keeps the report private until a fix ships). If that form is
unavailable, contact the maintainer through GitHub directly. Do not open a
public issue for security-sensitive reports. You can expect an acknowledgment
within a few days.

## Security posture

Design choices that keep the attack surface small:

- **Read-only by construction.** All MCP tools and HTTP routes are `GET`
  over the local index. There are no write paths exposed at runtime; the only
  writer is the `sync` command, which fetches from a fixed first-party URL.
- **No SSRF surface.** The eCFR base URL is hard-coded; request URLs are
  built from validated `YYYY-MM-DD` dates only. User input never reaches a
  fetch URL.
- **No SQL injection surface.** Every query is a prepared statement with
  bound parameters. Free-text search terms are sanitized into quoted FTS5
  prefix terms (max 12 tokens); user input can never introduce FTS5/SQL
  operators.
- **Hardened XML parsing.** `fast-xml-parser` runs with `processEntities`
  only (no external entity expansion), DOCTYPE payloads are rejected up
  front, and the walker enforces bounded depth (64) and section size
  (400 KB) as format-drift tripwires.
- **Loopback-only by default.** The HTTP API binds `127.0.0.1` and refuses
  non-loopback addresses unless `CFR_ALLOW_REMOTE=1` is explicitly set.
  There is no authentication built in — put your own auth in front before
  exposing it.
- **Protocol hygiene.** MCP stdout carries JSON-RPC only; all logging goes to
  stderr as JSON lines. Error messages returned to HTTP clients are
  sanitized (no stack traces, no raw upstream bodies, no query strings).
- **Dependency discipline.** Three runtime dependencies, all pinned to
  audited ranges; `npm audit` gates CI; Dependabot opens weekly update PRs;
  supply-chain install scripts are allowlisted explicitly (`allowScripts`).

## Continuous scanning

Every PR runs `npm audit` (high+), gitleaks (secret scan over full git
history) and osv-scanner in CI. Locally, `npm run scan` additionally runs
trivy and semgrep when installed.
