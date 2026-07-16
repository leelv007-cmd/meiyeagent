# Pro Studio security matrix evidence (Ticket 15 / 25)

Date: 2026-07-16

The machine-readable source of truth is
`docs/evidence/pro-studio/security-manifest.json`. Verify it with:

```sh
pnpm pro-studio:security --json
```

The verifier exits `0` only when the frozen controls, the complete production
security drill, and the named manual approval all pass. Production and approval
receipts must also match SHA-256 trust anchors supplied by protected release
configuration; checked-in self-claims cannot pass alone. A structurally invalid
or over-claimed manifest is `failed`; valid lower-tier evidence with open
release gates is `partial` and exits non-zero. Evidence paths are restricted to
real files inside this worktree, including after symlink resolution.

## Evidence tiers

- **unit**: in-process public application-service or BackendPort behavior.
- **fixture real-service**: real Main, Canvas, Core, Worker, and Postgres
  services with `MODEL_EXECUTION_MODE=fixture`; never production-equivalent.
- **production drill**: production deployment and production adapters. The
  Ticket 09 provider-reference probe has only
  `provider_reference_transport_only` scope.
- **manual approval**: a named security owner approves the redacted complete
  production drill. No approval is currently recorded.

## Control coverage

| Control | Unit | Fixture real-service | Production / manual |
| --- | --- | --- | --- |
| Cross-workspace project/revision/asset/job/package/grant/confirmation IDOR | opacity and zero-write tests passed; per-kind rejection-audit proof missing | opacity/zero-write passed; per-kind rejection-audit proof missing | complete production matrix missing |
| Forged `serverUrl` / provider routing fields | passed | not promoted from unit | complete production matrix missing |
| Idempotency replay and conflicting payload | passed | not promoted from unit | complete production matrix missing |
| Async failure refund and 2xx/accepted non-settlement | passed | not promoted from unit | complete production matrix missing |
| Grant expiry/revocation branch | passed: grant disabled and endpoint absent | not applicable while disabled | scoped Ticket 09 production transport probe passed; full matrix still missing |
| DNS / redirect SSRF and response bounds | passed | not promoted from unit | complete production matrix missing |
| Agent seven-verb allowlist and authorization recheck | passed | boundary flow covered indirectly | complete production matrix missing |
| Dual-session CAS with losing-session zero write | passed | passed | complete production matrix missing |
| Browser identity/cache isolation and stale-response fence | passed | passed | complete production matrix missing |

The fixture drill is
`mkfast-template-main/tests/e2e/specs/pro-studio-security-boundaries.spec.ts`.
It proves real local service and database behavior for all-object opacity,
two-session CAS recovery, and identity-switch cache fencing, but its model/media
adapter is fixture mode and `productionEquivalent` is explicitly `false`.

The ProviderReferenceGrant conditional branch is disabled because the scoped
Ticket 09 production probe proved bounded multipart upload from an owned
reference. `docs/evidence/pro-studio/ticket-09/probe-result.json` records
`grantEndpoint=null`, `grantUrlsProduced=false`, and a tuple-only release scope.
It is not the complete Ticket 25 production security drill. If grants are later
enabled, the verifier requires a dedicated lifecycle artifact proving TTL
expiry, explicit revoke, rights revoke, task/workspace binding, and `no-store`.

A future passed production receipt must bind deployment ID, commit SHA,
test-plan digest, completion time, run ID, and every frozen control. Its manual
approval receipt must bind that run and come from the protected release
approval channel. The protected release configuration supplies
`PRO_STUDIO_PRODUCTION_SECURITY_RECEIPT_SHA256` and
`PRO_STUDIO_MANUAL_APPROVAL_RECEIPT_SHA256`; these digests are trust anchors,
not credentials, and are intentionally not checked into this manifest.

## Current gate result

`pnpm pro-studio:security --json` computes **partial** with three blockers:

1. add real-service rejection-audit assertions for every enabled cross-workspace
   object kind;
2. repeat the complete security matrix against the production deployment and
   production adapters;
3. obtain named manual security approval for that redacted production result.

`docs/evidence/pro-studio/release-evidence.json` therefore keeps
`securityMatrix.status` as `partial`. Audio activation, N2 recovery, pricing,
and upsell sign-off remain separate release blockers in that manifest.
