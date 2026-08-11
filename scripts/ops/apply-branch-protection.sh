#!/usr/bin/env bash
# Apply the `main` branch-protection ruleset (T40/E-01).
#
# Prepared, not published. The default mode is --dry-run: it validates the
# ruleset against the workflow that has to satisfy it, prints the exact `gh api`
# calls, and touches GitHub not at all. Applying requires an explicit --apply.
#
# Why one required context instead of four:
#   The four gates E-01 names are not four jobs. The assembly gate (T04) and the
#   M-04 browser hard gate (T37) deliberately ride a single job
#   (`production-main-journey`, .github/workflows/core-quality.yml), SCA is
#   `production-dependency-audit`, and the eval gate is `redline-evals`. All of
#   them — plus `core`, `root-quality`, `core-persistence` — are aggregated by the
#   `required` job, which fails unless every one of them succeeded
#   (scripts/ci/assert-required-jobs.mjs). Registering `required` therefore covers
#   all four gates with one context that cannot be satisfied while any gate is
#   red; registering four separate names would add virtual entries without adding
#   coverage.
#
# The declarative ruleset requires one approving review and strict status
# checks. These settings mirror the live main-branch protection; changing them
# here must be an explicit governance decision, not an accidental downgrade via
# the apply script.
#
# Usage:
#   scripts/ops/apply-branch-protection.sh [--dry-run|--apply] [--repo owner/name]
#                                          [--ruleset path]
set -euo pipefail

ruleset_file="docs/ops/branch-protection-ruleset.json"
workflow_file=".github/workflows/core-quality.yml"
mode="dry-run"
repo=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) mode="apply" ;;
    --dry-run) mode="dry-run" ;;
    --repo)
      shift
      repo="${1:-}"
      ;;
    --ruleset)
      shift
      ruleset_file="${1:-}"
      ;;
    -h|--help)
      sed -n '2,35p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [[ ! -f "${ruleset_file}" ]]; then
  echo "Ruleset file is missing: ${ruleset_file}" >&2
  exit 1
fi

if [[ -z "${repo}" ]]; then
  # Resolved locally from the git remote: dry-run must not call GitHub at all.
  remote_url="$(git remote get-url origin 2>/dev/null || true)"
  repo="$(printf '%s' "${remote_url}" | sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##')"
fi
if [[ -z "${repo}" ]]; then
  echo "Repository could not be resolved; pass --repo owner/name." >&2
  exit 1
fi

ruleset_name="$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).name ?? ""))' "${ruleset_file}")"
if [[ -z "${ruleset_name}" ]]; then
  echo "Ruleset name is missing in ${ruleset_file}." >&2
  exit 1
fi

contexts="$(node -e '
const ruleset = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const rule = (ruleset.rules ?? []).find((entry) => entry.type === "required_status_checks");
const checks = rule?.parameters?.required_status_checks ?? [];
process.stdout.write(checks.map((check) => check.context).join("\n"));
' "${ruleset_file}")"

if [[ -z "${contexts}" ]]; then
  echo "Ruleset declares no required status checks; refusing to apply." >&2
  exit 1
fi

# Every required context must be a real job in the workflow, so protection can
# never be registered against a check name that never reports.
while IFS= read -r context; do
  [[ -z "${context}" ]] && continue
  if ! grep -qE "^  ${context}:" "${workflow_file}"; then
    echo "Required context '${context}' is not a job in ${workflow_file}." >&2
    exit 1
  fi
done <<< "${contexts}"

echo "Repository:        ${repo}"
echo "Ruleset:           ${ruleset_file} (name=${ruleset_name})"
echo "Required contexts: $(printf '%s' "${contexts}" | tr '\n' ' ')"
echo "Verified:          every required context exists as a job in ${workflow_file}"
echo
echo "Planned calls (idempotent — update in place when the ruleset already exists):"
echo "  gh api repos/${repo}/rulesets --jq '.[] | select(.name==\"${ruleset_name}\") | .id'"
echo "  # when found: gh api --method PUT repos/${repo}/rulesets/<id> --input ${ruleset_file}"
echo "  # otherwise:  gh api --method POST repos/${repo}/rulesets --input ${ruleset_file}"
echo "  gh api repos/${repo}/rulesets --jq '.[] | {id, name, target, enforcement}'"
echo

if [[ "${mode}" != "apply" ]]; then
  echo "Dry run: no GitHub call was made. Re-run with --apply to publish."
  exit 0
fi

existing_id="$(gh api "repos/${repo}/rulesets" \
  --jq ".[] | select(.name==\"${ruleset_name}\") | .id" | head -n 1)"

if [[ -n "${existing_id}" ]]; then
  echo "Updating existing ruleset ${existing_id}."
  gh api --method PUT "repos/${repo}/rulesets/${existing_id}" --input "${ruleset_file}"
else
  echo "Creating ruleset ${ruleset_name}."
  gh api --method POST "repos/${repo}/rulesets" --input "${ruleset_file}"
fi

echo
echo "Active rulesets:"
gh api "repos/${repo}/rulesets" --jq '.[] | {id, name, target, enforcement}'
