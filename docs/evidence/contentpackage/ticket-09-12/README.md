# ContentPackage Ticket 09–12 evidence

## Result

The 2026-07-17 run adds the missing real-browser evidence for Tickets 11 and
12. One uncut browser session registers an isolated merchant, confirms a store
and owned source asset, generates three candidates through the currently
activated LLM route, adopts one candidate, generates all three platform
variants, edits Xiaohongshu, compares history, restores an earlier version as a
new version, and exposes an optimistic-write conflict in the UI.

The structured manifest asserts that free edit and rollback do not change the
ContentPackage status or Product Usage, that the other two platform histories
remain byte-for-byte unchanged, and that the stale save returns
`CONTENT_PACKAGE_VERSION_CONFLICT`.

| Ticket | Current evidence grade | Evidence |
| --- | --- | --- |
| 09 | accepted | Real authorized-photo reference generation and owned output are in `../real-run-0003/journey/`; deterministic missing/withdrawn/unreadable rejection remains covered by resolver and creation-adapter tests. |
| 10 | partial | `../real-run-0001/provider-probe/` contains playable real Tuzi video bytes and lifecycle hashes. A same-session merchant browser video journey with current activation/admin-state evidence is still missing. |
| 11 | accepted | `run-20260717/continuous-journey.webm`, keyframes 01–02, and the three distinct copy digests in the manifest. |
| 12 | accepted | The same video, keyframes 03–05, the version-source sequence, unchanged-status/usage assertions, independent-platform assertion, and the recorded HTTP 409. |

## Reproduce

Keep the existing web, Core, worker, and PostgreSQL services running, then run:

```bash
CONTENTPACKAGE_EVIDENCE_OUT="$PWD/output/playwright/contentpackage-ticket-09-12" \
  pnpm --filter @meiye/web exec node \
  "$PWD/scripts/evidence/contentpackage-ticket-09-12.mjs"
```

Optional inputs:

- `CONTENTPACKAGE_BASE_URL` changes the web origin (default
  `http://localhost:3000`).
- `CONTENTPACKAGE_SOURCE_PHOTO` selects the owned test source image.
- `CONTENTPACKAGE_E2E_SECRET` changes the local E2E verification secret.

The run never stores account credentials, cookies, provider task references,
signed URLs, workspace ids, or raw generated copy. Reproduction requires a web
server running in local E2E mode because the harness creates and verifies an
isolated test merchant.

## Artifact inventory

- `run-20260717/run-manifest.json`: structured assertions, cross-ticket links,
  step timestamps, and SHA-256 inventory.
- `run-20260717/continuous-journey.webm`: one uncut browser recording.
- `run-20260717/keyframes/`: candidate, variants, edit/compare, rollback, and
  conflict states.
- `run-20260717/network-log.jsonl`: redacted Core method/status/path,
  correlation ids, and the conflict error code.
