# Engineering-pushable tickets 08 / 10 / 13 / 14 / 16 / 17 / 20 / 22 / 23

Date: 2026-07-16

## Domain / unit journeys (always runnable)

| Ticket | Command | Assertion |
| --- | --- | --- |
| 08 | `pnpm --filter @meiye/core exec tsx --test src/pro-studio-runtime/engineering-ticket-journeys.test.ts` | reverse-prompt `text.respond` deliver → text deliverable + fail release |
| 08 | `pnpm --filter @meiye/canvas exec tsx --test src/client/engineering-ticket-journeys.test.ts` | UI DTO uses reference_image only; result is text node |
| 10 | same core journey file | video submit → list recovery → OwnedAsset; probe fields forbidden |
| 10 | same canvas journey file | video parameters + video node type |
| 13 | core journey + `advanced-canvas-package-lifecycle.test.ts` | adopt + listAdoptions badge; export + reuse in content library |
| 16 | canvas journey + `prompt-seed-actions.ts` | seed apply fills prompt/operation; 40 seeds; no remote CRUD fields |
| 20 | `node --test scripts/polotno-retirement-gate.test.mjs` | zero SDK refs + entry routes host Light Composer only |
| 22 | `media-custody-live-drill.test.ts` | filesystem sample missing → repair `copy_to_owned` |
| 23 | `merchant-support-diagnostic.test.ts` (existing) + Playwright | four-factor table without DB access |

## Playwright (requires local stack)

```bash
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/pro-studio-engineering-tickets.spec.ts \
  tests/e2e/specs/pro-studio-entitlement.spec.ts
```

| Ticket | Spec | Evidence screenshot |
| --- | --- | --- |
| 14 | unpurchased intro + fixture unlock | `ticket14-unpurchased-intro.png`, `ticket14-unlocked-entry.png` |
| 16 | canvas seed select fills prompt | `ticket16-prompt-seeds.png` |
| 17 / 20 gate 1 | 存为自建模板 → 改文案/裁剪/排序 → 保存 → workspace-owned raster → accepted ContentPackage | `ticket20-layout-adopted-package.png` |
| 20 gate 4 (partial) | blank canvas / deep link / works list never hit polotno | (assertion only; exact full entry matrix remains open) |
| 23 | `/admin/audit` merchant diagnostic | `ticket23-merchant-support.png` |

## Release note

These tickets no longer block on product-external credentials. Remaining Pro Studio
release blockers stay on 09 / 11 / 12 / 18 / 21 / 25 only.
