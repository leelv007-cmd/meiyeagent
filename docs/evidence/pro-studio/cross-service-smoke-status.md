# Cross-service smoke status (Ticket 25)

Date: 2026-07-16

## Required path

Login → enter Pro Studio Canvas → generate one image → adopt → ContentPackage
visible in the content library.

## Current automation

| Segment | Coverage | Notes |
| --- | --- | --- |
| Login + unpurchased intro + purchase unlock + one-click enter | Playwright | `mkfast-template-main/tests/e2e/specs/pro-studio-entitlement.spec.ts` |
| Canvas as 4th Playwright webServer | config | `mkfast-template-main/playwright.config.ts` |
| Image generate / adopt domain | unit + PG | `generation-runtime`, `adoption`, `postgres-adoption-service` |
| Content library post-adopt edit/export/reuse | fixture smoke passed | The run asserted the adopted package locator in the Main content library after the Advanced Canvas handoff. |

## Passed run

- Command: `pnpm exec playwright test tests/e2e/specs/pro-studio-cross-service-smoke.spec.ts --project=chromium`
- Result: `1 passed` in fixture mode (41.2s).
- Package receipt: `content-package-4c4a6350f5781d386ef0ed9c`.
- Screenshot: `docs/evidence/pro-studio/ticket25-cross-service-smoke.png`.
- The job was generated through Core's `model_generation_jobs` read model, adopted
  from a checkpoint-origin revision into the frozen current draft, and then found
  by package id in the Main content library.

This is recorded-mode evidence; it does not claim a live external provider,
pricing approval, or upsell validation.

## Operator command (when env is ready)

```bash
pnpm dev:live
# then
pnpm --filter @meiye/web exec playwright test tests/e2e/specs/pro-studio-entitlement.spec.ts
# plus a future pro-studio-adopt-smoke.spec.ts covering generate + adopt
```
