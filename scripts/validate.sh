#!/usr/bin/env bash
#
# Pre-commit validation gate for cfr-free: a fast safety net run AFTER
# independent code review and BEFORE commit/push/merge. Checks the changed
# set (unstaged + staged + untracked) — or the whole tree with --all —
# through format, lint, types, tests, and the existing security scan suite.
#
# Supplements, never bypasses, CI: no coverage, no build, and the branch's
# required checks stay CI's job (see AGENTS.md merge gate). Exit 1 only on
# a real check failure; skips/unavailable tools are warnings. Routine
# target is < 30 s where practical — types (tsc) and tests dominate, which
# is expected. Conventions mirror tools/security-scan.sh.
#
# Usage: scripts/validate.sh [--fix] [--base <ref>] [--all] [--help]
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

failures=0

# One row per check, parallel arrays: name / status / seconds / reason.
s_name=()
s_status=()
s_secs=()
s_reason=()

section() { printf '\n=== %s ===\n' "$1"; }

usage() {
  cat <<'EOF'
Usage: scripts/validate.sh [--fix] [--base <ref>] [--all] [--help]

Pre-commit gate over the changed set (unstaged + staged + untracked); if
empty it falls back to @{upstream}...HEAD, or the full suite when no
upstream is configured. An empty set exits 0 ("no changed files detected").
  --fix         prettier --write + eslint --fix first (cosmetic, never fails)
  --base <ref>  diff against <ref> instead of the local changed set
  --all         every check on the whole tree (npm run ci minus coverage/build)
Budget: routine checks target < 30 s; types (tsc) and tests dominate — expected.
Types runs project-wide: tsc has no sound per-file mode against this repo's tsconfig — a pre-existing type error anywhere FAILs the gate (loudly, with the file) and that is the accepted trade-off.
Exit: 0 = pass (skips/warnings don't fail), 1 = a check FAILED, 2 = usage error.
EOF
}

# finish <name> <pass|FAIL|skip|UNAVAILABLE> <seconds> [reason]
finish() {
  local name=$1 status=$2 secs=$3 reason=${4:-}
  case "$status" in
    pass) printf 'pass %s (%ss)\n' "$name" "$secs" ;;
    FAIL)
      [ -n "$reason" ] || reason='command failed'
      printf 'FAIL: %s — %s\n' "$name" "$reason"
      failures=$((failures + 1))
      ;;
    skip) printf 'skip %s: %s\n' "$name" "$reason" ;;
    UNAVAILABLE) printf 'UNAVAILABLE: %s — %s\n' "$name" "$reason" ;;
  esac
  s_name+=("$name")
  s_status+=("$status")
  s_secs+=("$secs")
  s_reason+=("$reason")
}

# fail_reason <file> — the most specific one-line FAIL reason: first line
# naming the problem (error / [warn] / FAIL), else the last non-blank line.
fail_reason() {
  local line
  line=$(awk 'index($0, "error") || index($0, "[warn]") || index($0, "FAIL") { print substr($0, 1, 160); exit }' "$1")
  if [ -z "$line" ]; then
    line=$(awk 'NF { last = $0 } END { if (last) print substr(last, 1, 160) }' "$1")
  fi
  printf '%s' "$line"
}

# tool_ok <cmd> — shared availability probe for the UNAVAILABLE checks.
tool_ok() { command -v "$1" >/dev/null 2>&1; }

fix=0
base=''
all=0
while [ $# -gt 0 ]; do
  case "$1" in
    --fix) fix=1 ;;
    --all) all=1 ;;
    --base)
      if [ $# -lt 2 ]; then
        printf 'validate: --base needs a ref\n' >&2
        usage >&2
        exit 2
      fi
      base=$2
      shift
      ;;
    --base=*) base=${1#--base=} ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'validate: unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

git rev-parse --git-dir >/dev/null 2>&1 || {
  printf 'validate: %s is not a git checkout\n' "$ROOT" >&2
  exit 2
}

# --- changed-set detection ---------------------------------------------------

changed=()
declare -A seen=()

# collect < <(git ...): read git path lines, drop deleted files and duplicates.
collect() {
  while IFS= read -r f; do
    if [ -n "$f" ] && [ -f "$f" ] && [ -z "${seen[$f]+x}" ]; then
      seen[$f]=1
      changed+=("$f")
    fi
  done
}

if [ "$all" -eq 1 ]; then
  if [ -n "$base" ]; then
    printf 'note: --all overrides --base (whole-tree checks)\n'
  fi
  printf 'checks: whole tree (--all)\n'
elif [ -n "$base" ]; then
  if ! git rev-parse --verify --quiet "${base}^{commit}" >/dev/null; then
    printf 'validate: unknown --base ref: %s\n' "$base" >&2
    exit 2
  fi
  collect < <(git diff --name-only "$base")
  printf 'changed set: %d file(s) vs %s\n' "${#changed[@]}" "$base"
else
  collect < <(
    git diff --name-only HEAD
    git diff --name-only --cached
    git ls-files -o --exclude-standard | grep -v '^node_modules\(/.*\)\?$'
  )
  if [ "${#changed[@]}" -eq 0 ]; then
    if git rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
      collect < <(git diff --name-only '@{upstream}...HEAD')
      printf 'changed set: %d file(s) vs @{upstream} (local set was empty)\n' "${#changed[@]}"
    else
      printf 'note: no upstream configured for this branch — running the full suite\n'
      all=1
      printf 'checks: whole tree (upstream fallback)\n'
    fi
  else
    printf 'changed set: %d file(s)\n' "${#changed[@]}"
  fi
fi

if [ "$all" -eq 0 ] && [ "${#changed[@]}" -eq 0 ]; then
  printf 'no changed files detected\n'
  exit 0
fi

# --- bucket the changed set --------------------------------------------------

fmt_files=()
lint_files=()
workflow_changed=0
related_files=()
direct_files=()
live_changed=0
for f in "${changed[@]}"; do
  case "$f" in
    .github/workflows/*.yml | .github/workflows/*.yaml)
      fmt_files+=("$f")
      workflow_changed=1
      ;;
    *.ts)
      fmt_files+=("$f")
      lint_files+=("$f")
      if [ "$f" = 'test/live.test.ts' ]; then
        live_changed=1
      elif [ "${f#test/}" != "$f" ] && [ "${f%.test.ts}" != "$f" ]; then
        direct_files+=("$f")
      else
        related_files+=("$f")
      fi
      ;;
    *.md | *.json | *.yaml | *.yml) fmt_files+=("$f") ;;
  esac
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# --- --fix phase (cosmetic; runs before checks, never fails the gate) --------

if [ "$fix" -eq 1 ]; then
  section 'fix (--fix — cosmetic, not gated)'
  if ! command -v npx >/dev/null 2>&1; then
    printf 'fix skipped: npx not found\n'
  elif [ "$all" -eq 1 ]; then
    npx prettier --write .
    npx eslint --fix .
  elif [ "${#fmt_files[@]}" -eq 0 ] && [ "${#lint_files[@]}" -eq 0 ]; then
    printf 'fix: no eligible files (skipped)\n'
  else
    if [ "${#fmt_files[@]}" -gt 0 ]; then
      npx prettier --write "${fmt_files[@]}"
    fi
    if [ "${#lint_files[@]}" -gt 0 ]; then
      npx eslint --fix "${lint_files[@]}"
    fi
    printf 'fix complete — cosmetic fixes are never gate failures\n'
  fi
fi

# --- checks ------------------------------------------------------------------

section 'format (prettier)'
start=$SECONDS
if ! tool_ok npx; then
  finish format UNAVAILABLE "$((SECONDS - start))" 'npx not found'
elif [ "$all" -eq 1 ]; then
  if npx prettier --check . >"$tmp/format.log" 2>&1; then
    finish format pass "$((SECONDS - start))"
  else
    finish format FAIL "$((SECONDS - start))" "$(fail_reason "$tmp/format.log")"
  fi
elif [ "${#fmt_files[@]}" -eq 0 ]; then
  finish format skip "$((SECONDS - start))" 'no eligible files'
else
  if npx prettier --check "${fmt_files[@]}" >"$tmp/format.log" 2>&1; then
    finish format pass "$((SECONDS - start))"
  else
    finish format FAIL "$((SECONDS - start))" "$(fail_reason "$tmp/format.log")"
  fi
fi

section 'lint (eslint)'
start=$SECONDS
if ! tool_ok npx; then
  finish lint UNAVAILABLE "$((SECONDS - start))" 'npx not found'
elif [ "$all" -eq 1 ]; then
  if npx eslint . >"$tmp/lint.log" 2>&1; then
    finish lint pass "$((SECONDS - start))"
  else
    finish lint FAIL "$((SECONDS - start))" "$(fail_reason "$tmp/lint.log")"
  fi
elif [ "${#lint_files[@]}" -eq 0 ]; then
  finish lint skip "$((SECONDS - start))" 'no eligible TypeScript files in the changed set'
else
  if npx eslint "${lint_files[@]}" >"$tmp/lint.log" 2>&1; then
    finish lint pass "$((SECONDS - start))"
  else
    finish lint FAIL "$((SECONDS - start))" "$(fail_reason "$tmp/lint.log")"
  fi
fi

section 'types (npm run typecheck — project-wide by DESIGN: per-file tsc would ignore the repo tsconfig)'
start=$SECONDS
if ! tool_ok npm; then
  finish types UNAVAILABLE "$((SECONDS - start))" 'npm not found'
elif bash -c 'npm run -s typecheck' >"$tmp/types.log" 2>&1; then
  finish types pass "$((SECONDS - start))"
else
  finish types FAIL "$((SECONDS - start))" "$(fail_reason "$tmp/types.log")"
fi

section 'tests (vitest related/run — no coverage, no build, no live)'
start=$SECONDS
if ! tool_ok npx; then
  finish tests UNAVAILABLE "$((SECONDS - start))" 'npx not found'
elif [ "$all" -eq 1 ]; then
  printf 'note: test/live.test.ts excluded (network-dependent live test)\n'
  # The two document-shape tests are excluded here and run by the markers
  # and tables sections below, so in --all mode each runs exactly once. In
  # changed-set mode the general run may still include them, if the test
  # file itself is what changed.
  if npx vitest run --exclude 'test/live.test.ts' --exclude 'test/no-conflict-markers.test.ts' --exclude 'test/markdown-tables.test.ts' >"$tmp/tests.log" 2>&1; then
    finish tests pass "$((SECONDS - start))"
  else
    finish tests FAIL "$((SECONDS - start))" "$(fail_reason "$tmp/tests.log")"
  fi
elif [ "${#related_files[@]}" -gt 0 ]; then
  # Changed src files map to their tests via the import graph; directly
  # changed test files ride the same related run (vitest treats every filter
  # as a changed file). live.test.ts imports src modules, so it would match.
  printf 'note: test/live.test.ts excluded (network-dependent live test)\n'
  if npx vitest related "${related_files[@]}" "${direct_files[@]}" --run \
    --exclude 'test/live.test.ts' >"$tmp/tests.log" 2>&1; then
    if grep -q 'No affected test files found' "$tmp/tests.log"; then
      finish tests skip "$((SECONDS - start))" 'no affected tests for changed files'
    else
      finish tests pass "$((SECONDS - start))"
    fi
  else
    finish tests FAIL "$((SECONDS - start))" "$(fail_reason "$tmp/tests.log")"
  fi
elif [ "${#direct_files[@]}" -gt 0 ]; then
  if npx vitest run "${direct_files[@]}" --exclude 'test/live.test.ts' >"$tmp/tests.log" 2>&1; then
    finish tests pass "$((SECONDS - start))"
  else
    finish tests FAIL "$((SECONDS - start))" "$(fail_reason "$tmp/tests.log")"
  fi
elif [ "$live_changed" -eq 1 ]; then
  finish tests skip "$((SECONDS - start))" 'only test/live.test.ts changed (network-dependent — excluded)'
else
  finish tests skip "$((SECONDS - start))" 'no source or test files changed'
fi

section 'markers (no unresolved conflict markers — test/no-conflict-markers.test.ts)'
start=$SECONDS
# The TEST is the single source of truth for the rule (it skips fenced code
# blocks, which documentation may legitimately show a marker in); this section
# runs it rather than re-implementing the rule, so the two cannot drift.
if ! tool_ok npx; then
  finish markers UNAVAILABLE "$((SECONDS - start))" 'npx not found'
elif [ ! -f test/no-conflict-markers.test.ts ]; then
  finish markers UNAVAILABLE "$((SECONDS - start))" 'test/no-conflict-markers.test.ts not found'
elif npx vitest run test/no-conflict-markers.test.ts >"$tmp/markers.log" 2>&1; then
  # A skip means the scan could not run (not a git checkout, or no tracked
  # files). That is a warning, not a pass: the gate must not report a green
  # row for a check that did not run.
  if grep -q 'skipped' "$tmp/markers.log"; then
    finish markers skip "$((SECONDS - start))" 'scan skipped (no git checkout or no tracked files)'
  else
    finish markers pass "$((SECONDS - start))"
  fi
else
  finish markers FAIL "$((SECONDS - start))" "$(fail_reason "$tmp/markers.log")"
fi

section 'tables (every markdown table is rectangular — test/markdown-tables.test.ts)'
start=$SECONDS
# A ragged markdown table is invisible in a diff and to prettier: the row
# count and the cell count have to be computed. The TEST is the source of
# truth for the rule; this section runs it rather than re-implementing it.
if ! tool_ok npx; then
  finish tables UNAVAILABLE "$((SECONDS - start))" 'npx not found'
elif [ ! -f test/markdown-tables.test.ts ]; then
  finish tables UNAVAILABLE "$((SECONDS - start))" 'test/markdown-tables.test.ts not found'
elif npx vitest run test/markdown-tables.test.ts >"$tmp/tables.log" 2>&1; then
  if grep -q 'skipped' "$tmp/tables.log"; then
    finish tables skip "$((SECONDS - start))" 'scan skipped (no git checkout or no tracked files)'
  else
    finish tables pass "$((SECONDS - start))"
  fi
else
  finish tables FAIL "$((SECONDS - start))" "$(fail_reason "$tmp/tables.log")"
fi

section 'actions (actionlint — workflow files; CI cannot start on an invalid workflow)'
start=$SECONDS
# actionlint is an external tool (brew/go): UNAVAILABLE is a warning, not a
# failure, so a machine without it still gets a passing gate — but the check
# is the only thing that can see an invalid .github/workflows/*.yml before
# GitHub answers with a zero-job failed run. See AGENTS.md evidence rules.
if ! tool_ok actionlint; then
  finish actions UNAVAILABLE "$((SECONDS - start))" 'actionlint not installed (brew install actionlint)'
elif [ "$all" -eq 1 ]; then
  if actionlint >"$tmp/actions.log" 2>&1; then
    finish actions pass "$((SECONDS - start))"
  else
    finish actions FAIL "$((SECONDS - start))" "$(fail_reason "$tmp/actions.log")"
  fi
elif [ "$workflow_changed" -eq 0 ]; then
  finish actions skip "$((SECONDS - start))" 'no workflow files changed'
else
  if actionlint >"$tmp/actions.log" 2>&1; then
    finish actions pass "$((SECONDS - start))"
  else
    finish actions FAIL "$((SECONDS - start))" "$(fail_reason "$tmp/actions.log")"
  fi
fi

section 'scan (tools/security-scan.sh — npm audit, osv-scanner, gitleaks, trivy, semgrep)'
start=$SECONDS
if [ ! -f tools/security-scan.sh ]; then
  finish scan UNAVAILABLE "$((SECONDS - start))" 'tools/security-scan.sh not found'
else
  # Existing suite untouched; output passed through (skip/warn lines from the
  # scanners are warnings, not gate failures). Its exit code is the verdict.
  bash tools/security-scan.sh 2>&1 | tee "$tmp/scan.log"
  scan_exit=${PIPESTATUS[0]}
  if [ "$scan_exit" -eq 0 ]; then
    finish scan pass "$((SECONDS - start))"
  else
    scan_count=$(awk '/^security scan: [0-9]+/ { print $3; exit }' "$tmp/scan.log")
    if [ -n "$scan_count" ]; then
      finish scan FAIL "$((SECONDS - start))" "$scan_count scanner(s) reported findings"
    else
      finish scan FAIL "$((SECONDS - start))" "security-scan.sh exited $scan_exit"
    fi
  fi
fi

# --- summary -----------------------------------------------------------------

section 'summary'
for i in "${!s_name[@]}"; do
  if [ -n "${s_reason[$i]}" ]; then
    printf '  %-8s %-12s %4ss  %s\n' \
      "${s_name[$i]}" "${s_status[$i]}" "${s_secs[$i]}" "${s_reason[$i]}"
  else
    printf '  %-8s %-12s %4ss\n' "${s_name[$i]}" "${s_status[$i]}" "${s_secs[$i]}"
  fi
done

if [ "$failures" -gt 0 ]; then
  printf 'GATE: FAIL (%d)\n' "$failures"
  exit 1
fi
printf 'GATE: PASS\n'
exit 0
