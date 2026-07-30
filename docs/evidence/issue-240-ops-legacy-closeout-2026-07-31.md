# Issue 240 legacy operations closeout evidence

Date: 2026-07-31

## Cancelled legacy tasks

| Legacy task hash | Terminal state | Cancellation evidence | Billing and quota refund evidence |
| --- | --- | --- | --- |
| `d816f498eaa7` | `core_hold_expired` | Decision event `473b96825c9d` at `2026-07-30T17:52:58.894Z` | Quote `619eebf46f35` refunded `0.08`; usage `110ed2e56874` refunded `copy:1,image:3` |
| `577ec9d4bc9b` | `workflow_failed` | Audit event `b92b41fc9700`, code `OPERATOR_CANCELLED_LEGACY_ACTIVE`, `quotaRefunded=true` | Quote `2945bf3fa071` refunded `0.08`; usage `4598ad96a14b` refunded `copy:1,image:3` |
| `1d681cfb52a0` | `core_hold_expired` | Decision event `2339a5ab7c5d` | Quote `36a1d440bb2c` refunded `0.02`; usage `8dcb0fa3c5d4` refunded `copy:1` |
| `a0c579e99a57` | `core_hold_expired` | Decision event `ac58cce8f61b` | Quote `addeae3770fe` refunded `0.08`; usage `958b211d8b18` refunded `image:1` |

None of the four tasks had a matching GrantLot usage transaction before cancellation, so no GrantLot refund transaction was synthesized.

## Current-path resubmissions

Each entry used the `issue-240-ops-resubmit-<legacy-task-hash>` namespace and the current catalog, quote, Brief sync/project/confirmation, and Composer submission path. Media resubmissions use a repository image persisted through `CanvasAssetFacade`, written through the Core asset API, and authorized through Product commands. The unavailable historical ContentPackage on `a0c579e99a57` was not reused.

| Legacy task hash | New submission ID | New task ID | Frozen route snapshot |
| --- | --- | --- | --- |
| `d816f498eaa7` | `snapshot-composer-task:a8e3cf1c8ed9a3fff4133ae741ba8ecec92f407bf303e15500ad992b2352d16b` | `composer-task:a8e3cf1c8ed9a3fff4133ae741ba8ecec92f407bf303e15500ad992b2352d16b` | present |
| `577ec9d4bc9b` | `snapshot-composer-task:1154b3234f1ce440e996b8ee29f3c485065c0619c9615dc954a6ec8b0482edc6` | `composer-task:1154b3234f1ce440e996b8ee29f3c485065c0619c9615dc954a6ec8b0482edc6` | present |
| `1d681cfb52a0` | `snapshot-composer-task:56e30f4edb304493ab4c64df59b323c56386f35493a85b340e69fc2badae062d` | `composer-task:56e30f4edb304493ab4c64df59b323c56386f35493a85b340e69fc2badae062d` | present |
| `a0c579e99a57` | `snapshot-composer-task:caf95a218c81fb9c7a26c186f84df2fb884b27d972fa74653dff8187834cce2f` | `composer-task:caf95a218c81fb9c7a26c186f84df2fb884b27d972fa74653dff8187834cce2f` | present |

The copy workflow had historical active Skill bindings pinned to `builtin-v1`. Those bindings were superseded through the production Skill define/eval/accept/rollback lifecycle by revisions pinned to the verified Langfuse production version `1`; no Skill or task table was edited directly.

During recovery, two additional `issue-240` live-prompt bindings were created before the three historical bindings were upgraded. Both point to accepted frozen revisions with the same verified Langfuse v1 platform instructions. The supported Skill lifecycle has no unbind operation and retirement correctly remains dependency-blocked while a binding is active, so these two redundant bindings remain an explicit follow-up governance cleanup item rather than being hidden by a direct table update.

## Final read-only audit

| Measure | Final value |
| --- | ---: |
| `harness_runtime.task_requests` | 578 |
| Requests with `frozenRouteSnapshot` | 153 |
| Legacy requests missing `frozenRouteSnapshot` | 425 |
| Legacy delivered | 364 |
| Legacy failed | 58 |
| Legacy hold expired | 3 |
| Legacy active | 0 |

The legacy membership count remained exactly 425. All newly submitted tasks above have a non-null `frozenRouteSnapshot`, so none enters the legacy class and active legacy remains zero.

## Repository validation

- Rebasing `issue/240-ops` onto local `main` at `b66d864b` completed cleanly.
- `pnpm --filter @meiye/core typecheck` passed after the rebase.
