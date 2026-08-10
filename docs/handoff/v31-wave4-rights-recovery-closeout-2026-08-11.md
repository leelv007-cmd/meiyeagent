# Wave-4 Rights Recovery Closeout（2026-08-11 continue）

> Integration: `codex/v31-integration` @ `1de3a9751` (`1de3a9751bb4c32ef776a8c9529152d2a5e7a33e`)  
> Safety: no push; did not kill :3001; e2e-lock + isolated ports/DBs.

## Root cause (leg 3 submit)

After rights-revoked safe stop, recovery fill+click never reached
`POST /composer/submissions` because:

1. Composer stayed on the **failed session id** (quote/submit idempotency).
2. Reopened frozen draft still pinned the **withdrawn asset**, so
   `missingCreativeGrounding` permanently reported `real_authorized_asset`.

## Fixes landed

| SHA | Change |
|---|---|
| `d2adb64c1` | `recoverFromReport` thaws lens, strips ineligible sources after product refresh; `product.refresh` returns state |
| e2e series through `1de3a9751` | Use `composer-report-action-adjust_intent` then re-authorize; plan deliverable regex; multi-unit debit meter |

## Evidence (tip)

| Spec | Result | Log |
|---|---|---|
| rights revocation full journey | **1/1 PASS** (31–37s solo) | `/var/folders/ht/bxq1vnjx01gccj82hkz549nc0000gn/T/grok-goal-cbaaf9a00d5f/implementer/pw-rightsA.log`, `/var/folders/ht/bxq1vnjx01gccj82hkz549nc0000gn/T/grok-goal-cbaaf9a00d5f/implementer/pw-b2-rights.log` |
| B2 memory revoke | **1/1 PASS** (1.6m) | `/var/folders/ht/bxq1vnjx01gccj82hkz549nc0000gn/T/grok-goal-cbaaf9a00d5f/implementer/pw-b2-rights.log` |
| living-plan both cases | **2/2 PASS** (short batch before cascade) | `/var/folders/ht/bxq1vnjx01gccj82hkz549nc0000gn/T/grok-goal-cbaaf9a00d5f/implementer/pw-short-batch.log` |
| level1 both cases | **2/2 PASS** | same |
| artifact growth | **1/1 PASS** | same |
| interrupt expiry | **1/1 PASS** | same |
| interrupt owner homepage | **1/1 PASS** | same |
| interrupt resume-by-id | **FAIL** (V31-28 surface debt) | same |
| long short-batch after living-plan | Web `ECONNRESET` cascade killed B2/rights workers | infra, not product (solo re-green) |

## Stamp

`wave4_ready_to_stamp = false`

Still open for full Wave-4 stamp: V31-28 resume-by-id / plan-diff, full
`run-v31-browser-acceptance.sh`, day0/goal/context-fence historical reds,
V31-26b external, multi-unit get_usage vs ledger (receipt 15 vs balance 30).

Rights recovery leg 3 is **closed** on this tip with solo Chromium green.
