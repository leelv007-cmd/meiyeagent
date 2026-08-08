#!/usr/bin/env bash
# Mirror-push local main's tree to legacy-origin-b/meiyeagent (snapshot lineage).
#
# Why: the local clone is SHALLOW (14 boundary commits, 2026-07-16..20), so
# full history cannot be pushed to an empty remote (GitHub rejects packs with
# missing ancestry: "did not receive expected object"). The new repo's main is
# a snapshot-root lineage (first commit 1901a088, 2026-08-08). Until the legacy
# remote (legacy-origin-a/legacy-web-repo) is reachable again for
# `git fetch --unshallow origin`, every publish to the new repo must be a
# commit-tree child on that lineage — never a plain `git push legacy-origin-b main`.
#
# After reinstatement: unshallow, then `git push legacy-origin-b main -f` once to
# replace the snapshot lineage with real history, and retire this script.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

MIRROR_REF=refs/heads/mirror-legacy-origin-b
PARENT=$(git rev-parse "$MIRROR_REF")
TREE=$(git rev-parse 'main^{tree}')

if [ "$(git rev-parse "$PARENT^{tree}")" = "$TREE" ]; then
  echo "mirror already up to date ($PARENT)"
  exit 0
fi

SUBJECT=$(git log -1 --format=%s main)
SNAP=$(git commit-tree "$TREE" -p "$PARENT" -m "mirror: $SUBJECT (main @ $(git rev-parse --short main))")
git update-ref "$MIRROR_REF" "$SNAP"
git push legacy-origin-b "$SNAP":refs/heads/main
echo "pushed $SNAP -> legacy-origin-b/meiyeagent main"
