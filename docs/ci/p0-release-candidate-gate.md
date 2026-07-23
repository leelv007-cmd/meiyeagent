# P0 Release Candidate Gate (#147)

Same-commit acceptance for P0-F. The gate **fails closed** when live provider
evidence is missing, expired, unbound to the release SHA, or incomplete.

## What it proves

On one `RELEASE_COMMIT_SHA`:

1. **Provider live evidence** (`primary_connectivity`) for copy / image / video
   official channels, each `live_verified`, labeled
   `single-channel/no-fallback` unless two independent fault domains prove
   multi-channel ready.
2. **Release unit identity** for web / core / worker / canvas on that SHA.
3. Production network boundary contract (existing gate).
4. Production build + four-service Web E2E.

Recorded fixtures, token validation, HTTP 200, or historical receipts **do not**
satisfy this gate. `recorded ≠ live_verified`.

## Commands

```bash
export RELEASE_COMMIT_SHA="$(git rev-parse HEAD)"
export PROVIDER_LIVE_EVIDENCE_PATH=apps/core/provider-live-evidence/provider-live-gate.json
export RELEASE_MANIFEST_PATH=output/release/staging-release-manifest.json

# Evidence-only (cheap, fail closed without secrets in this step):
node scripts/ci/assert-release-candidate-evidence.mjs

# Full RC quality path (also used by the release-candidate workflow label):
bash scripts/ci/run-release-candidate-quality.sh
```

## Evidence artifact

Produced by `.github/workflows/provider-live.yml` (or an authorized local run of
the official adapter gate). Required fields:

| Field | Rule |
|---|---|
| `releaseRef` | Must equal `RELEASE_COMMIT_SHA` |
| `acceptanceMode` | `primary_connectivity` |
| `environment` / `configurationRevision` / `runNonce` | Non-empty |
| `effectiveConfigurationSha256` | SHA-256 of the resolved Provider/Catalog/Route configuration |
| `startedAt` / `completedAt` / `expiresAt` | ISO timestamps; not expired |
| `activationEvidence` | `live_verified` + `official_direct`, deployment/Catalog/Provider profile, timestamp, and successful adapter call for three core ops |
| `probes` / `actualCost` | Accepted task receipt and CNY cost per core op; bounded aggregate CNY ledger |
| `publishGates` | `publishAllowed`; single-channel labeled no-fallback |
| `blockedChecks` / `skippedOperations` | Both arrays must be empty; any entry, including a non-core operation, rejects the whole RC |
| secrets | Must not appear in the redacted JSON |

The raw path `apps/core/provider-live-evidence/` remains gitignored.

## Staging release manifest

`RELEASE_MANIFEST_PATH` is mandatory for RC acceptance. The gate does not infer
four deployments from environment variables: that would only restate the source
SHA, not prove what reached staging. The redacted artifact must contain:

```json
{
  "schemaVersion": 1,
  "releaseRef": "<40-character release SHA>",
  "environment": "staging",
  "workflowRun": "<immutable CI or deployment run reference>",
  "startedAt": "<ISO timestamp>",
  "completedAt": "<ISO timestamp>",
  "capturedAt": "<ISO timestamp>",
  "expiresAt": "<ISO timestamp>",
  "result": "pass",
  "verification": {
    "readinessEvidenceRef": "<staging readiness artifact>",
    "recoveryEvidenceRef": "<worker recovery artifact>",
    "journeyEvidenceRefs": {
      "copy": "<production-build journey screenshot or video>",
      "image": "<production-build journey screenshot or video>",
      "video": "<production-build journey screenshot or video>"
    }
  },
  "units": [
    { "unit": "web", "commitSha": "<SHA>", "artifactDigest": "<immutable digest>", "configRevision": "<deployed config revision>" },
    { "unit": "core", "commitSha": "<SHA>", "artifactDigest": "<immutable digest>", "configRevision": "<deployed config revision>" },
    { "unit": "worker", "commitSha": "<SHA>", "artifactDigest": "<immutable digest>", "configRevision": "<deployed config revision>" },
    { "unit": "canvas", "commitSha": "<SHA>", "artifactDigest": "<immutable digest>", "configRevision": "<deployed config revision>" }
  ]
}
```

No checked-in sample may substitute for a staging-produced manifest. The current
repository does not mint this artifact or inject protected Provider evidence into
the label-triggered RC job; the staging/release owner must supply both from the
same protected run, otherwise the gate remains blocked by design.

## Capability projection (#146)

Core runtime-truth modules:

- `apps/core/src/runtime-truth/provider-evidence.ts` — judge live report
- `apps/core/src/runtime-truth/capability-assembly.ts` — shared readiness + capabilities
- `apps/core/src/runtime-truth/release-candidate.ts` — same-commit acceptance

Merchant `/capabilities` only emits `verified | assisted | unavailable` plus
optional `channelMode` / `channelLabel`. Internal evidence tokens never leave
the process.

## Residual honesty

Without protected `provider-live` credentials, the live workflow cannot mint a
current artifact. In that case:

- keep #119 / #146 / #147 open for the live half of DoD
- continue projecting assisted/unavailable (never forge verified)
- do not claim multi-channel ready
