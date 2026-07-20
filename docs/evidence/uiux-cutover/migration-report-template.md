# UI/UX Migration And Reconciliation Report Template

## Run identity

- Candidate commit:
- Schema revision:
- Cutover run ID:
- Environment:
- Workspace scope/count:
- Dry-run / rehearsal / activation:
- Actor and correlation IDs: safe references only

## Migration totals

| Kind | Source | Expected | Written | Skipped | Conflict | Failed |
|---|---:|---:|---:|---:|---:|---:|
| Task | | | | | | |
| Work/Revision | | | | | | |
| Job/Attempt/RouteSnapshot | | | | | | |
| Asset/receipt | | | | | | |
| Content/Version | | | | | | |
| Publication snapshot/job | | | | | | |
| Product/provider ledger | | | | | | |

## Reconciliation

- Canonical ID differences:
- Tenant/owner differences:
- Status differences:
- Version-order differences:
- Asset receipt/hash differences:
- Usage and provider-cost differences:
- Explained normalization differences:
- Unexplained differences: must be zero before activation

## In-flight work

| Job | Original owner | Decision | Original route/task preserved | Regeneration allowed |
|---|---|---|---|---|
| redacted stable reference | | | yes | no |

## Idempotency and recovery

- First dry-run result:
- Repeated dry-run result:
- Interrupted/restarted run result:
- Duplicate-object count:
- Duplicate-Asset count:
- Duplicate-settlement count:

## Decision

- Proceed / stop / rollback:
- Blocking findings:
- Responsible owner:
- Evidence references:

Do not include database URLs, credentials, external tokens, customer content, or
customer media in this report.
