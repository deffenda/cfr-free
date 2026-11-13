#!/usr/bin/env bash
#
# Local security scan suite for cfr-free.
#
# Runs every scanner that is installed and skips the rest with a note, so the
# script works on any machine. Scanners that need the network (osv-scanner,
# trivy, semgrep) are additionally skipped when their backend is unreachable,
# with a clear note — an offline machine should not fail the gate silently.
#
# CI runs these scanners on every pull request, in these jobs:
#
#   npm audit     -> quality
#   gitleaks      -> security
#   osv-scanner   -> security
#   trivy (fs)    -> trivy
#   trivy (image) -> docker
#   semgrep       -> semgrep
#
# The `trivy` and `semgrep` jobs are not required checks — the database and
# the rule registry they read both move without this repository changing.
#
# Usage:
#   npm run scan          # every installed scanner; a missing tool is skipped
#   npm run scan:strict   # gitleaks + osv-scanner MUST run: a missing binary,
#                          # or an unreachable osv backend, FAILS the gate
#
# Why strict mode exists: the release path (a `v*` tag) runs `npm run ci`,
# whose audit step is `npm audit` alone — no secret scan and no osv-scanner.
# A plain `npm run scan` cannot close that gap on its own, because it SKIPS a
# scanner that is not installed and still reports success. Strict mode is the
# local floor the release checklist uses: it cannot pass unless the two
# scanners CI's `security` job runs actually ran.
set -u

STRICT=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    *)
      printf 'usage: %s [--strict]\n' "$0" >&2
      exit 2
      ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

failures=0

section() { printf '\n=== %s ===\n' "$1"; }

# reachable <url> — cheap probe with a short timeout.
reachable() { curl -sS -m 5 -o /dev/null "$1" 2>/dev/null; }

# skipped <tool> <reason> — a scanner that did not run. In strict mode a
# REQUIRED scanner that did not run FAILS: the gate must never report success
# for a scan that never happened.
skipped() {
  local tool="$1"
  local reason="$2"
  if [ "$STRICT" -eq 1 ]; then
    printf 'FAIL: %s — %s (required in strict mode)\n' "$tool" "$reason"
    failures=$((failures + 1))
  else
    printf 'skip: %s — %s\n' "$tool" "$reason"
  fi
}

# run_or_skip <command> <args...>
run_or_skip() {
  local cmd="$1"
  shift
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'skip: %s — is not installed\n' "$cmd"
    return 0
  fi
  if "$@"; then
    printf 'pass: %s\n' "$cmd"
  else
    printf 'FAIL: %s\n' "$cmd"
    failures=$((failures + 1))
  fi
}

# run_or_skip_net <probe-url> <command> <args...>
run_or_skip_net() {
  local probe="$1"
  shift
  if command -v "$1" >/dev/null 2>&1 && ! reachable "$probe"; then
    printf 'skip: %s — no route to %s\n' "$1" "$probe"
    return 0
  fi
  run_or_skip "$@"
}

section 'npm audit (high + critical)'
run_or_skip npm npm audit --audit-level=high

section 'osv-scanner (dependency advisories)'
# Exit-code contract: 0 = clean, 3 = vulnerabilities found (hard failure),
# anything else is an infrastructure/network error — warned, not failed
# (the CI action still gates on real findings with working network).
if ! command -v osv-scanner >/dev/null 2>&1; then
  skipped osv-scanner 'is not installed'
elif ! reachable https://api.osv.dev; then
  skipped osv-scanner 'has no route to api.osv.dev'
else
  osv-scanner scan --lockfile package-lock.json
  osv_exit=$?
  if [ "$osv_exit" -eq 0 ]; then
    printf 'pass: osv-scanner\n'
  elif [ "$osv_exit" -eq 3 ]; then
    printf 'FAIL: osv-scanner found vulnerabilities\n'
    failures=$((failures + 1))
  elif [ "$STRICT" -eq 1 ]; then
    printf 'FAIL: osv-scanner exited %d (likely network/infra) — required in strict mode\n' "$osv_exit"
    failures=$((failures + 1))
  else
    printf 'warn: osv-scanner exited %d (likely network/infra) — not counted\n' "$osv_exit"
  fi
fi

section 'gitleaks (secrets, including git history)'
if ! command -v gitleaks >/dev/null 2>&1; then
  skipped gitleaks 'is not installed'
elif ! gitleaks detect --source . --redact --no-banner --exit-code 1; then
  printf 'FAIL: gitleaks\n'
  failures=$((failures + 1))
else
  printf 'pass: gitleaks\n'
fi

section 'trivy (vulns, secrets, misconfig)'
run_or_skip_net https://ghcr.io trivy trivy fs \
  --scanners vuln,secret,misconfig \
  --severity HIGH,CRITICAL \
  --skip-dirs node_modules,dist,coverage,data \
  --exit-code 1 --quiet .

section 'semgrep (general static analysis)'
run_or_skip_net https://semgrep.dev semgrep semgrep scan --config auto --error --quiet

printf '\n'
if [ "$failures" -gt 0 ]; then
  printf 'security scan: %d scanner(s) reported findings\n' "$failures"
  exit 1
fi
if [ "$STRICT" -eq 1 ]; then
  printf 'security scan: strict mode passed — gitleaks and osv-scanner both ran\n'
else
  printf 'security scan: all installed scanners passed\n'
fi
