# T38 conditional deletion evidence

Date: 2026-07-26
Branch: `legacy-origin-a/t38-conditional-delete-1d-1b`
Baseline: `980c4899`

## Final predicate disposition

| Batch row | Disposition | Evidence |
|---|---|---|
| 1D-1 Polotno retirement and renderer comparison cluster | Deleted | T30/T32/T33/T34/T35 are present on the baseline; the retirement CLIs, implementation, tests, barrel exports, and four package scripts are gone. |
| 1D-2 ContentPackage card/detail | Deleted | T34 Result Center replacement is mounted and the production-import reverse search below returns zero matches. The compatibility redirect shells remain. |
| 1D-3 strict BYOK panels/schemas | Deleted | The model/integration settings surface remains; only the D-031 four-field form and its schema/tests were removed. |
| 1D-4 Composer reuse panel and slot state | Deleted | T30 owns reuse through the conversation flow; the panel, `reuse_panel` phase, selection type, helpers, exports, and tests tied to that form are gone. |
| 1D-5 legacy content-package projection | **Retained** | `canonical-history-page.tsx` and `creative-object-page.tsx` still import it in production. `ContentPackageProjection` was moved into this retained file without changing its shape. |
| 1B-6 content-package migration cluster | **Retained** | The lane database has zero migration-run rows, which means “not run” on this newly created database, not a drained cutover receipt. |
| 1B-7 legacy in-flight decision | **Retained** | It shares the same missing authoritative cutover evidence as row 1B-6; an empty lane database is not accepted as proof. |
| §3 canonical five-page row | **Retained** | Nine production route entries still consume the canonical pages; OI-63 IA ownership must be decided before deletion. |
| §3 Canvas work page and Canvas capability files | **Retained** | Explicitly excluded by OI-64 and the REBUILD/KEEP boundary. |
| §3 six legacy operations IA modules | Deleted | The route graph guard checks all six names, reports that none of the files exist, and finds no reachable mounts. `operations-view-model.ts` remains. |
| §3 operations task page | Deleted | Covered by the same six-module route graph guard and the T34 pending-actions replacement. |
| §3 old content-route helpers/surface | Partially deleted | `-content-library-surface.tsx` and `-content-helpers.tsx` were deleted. `content.tsx` and `content_/$contentId.tsx` are T34 compatibility redirects and were moved out of this batch; their deletion condition is a post-pilot zero-redirect-traffic receipt, which does not exist today. |
| T34 task-source spec | Deleted | The skipped journey began only at the retired task inbox and has no honest successor journey in this ticket. |
| OI-72 orphan families | Deleted | Removed the unimported `use-apikeys.ts`, unused `@beehiiv/sdk`, its lock entry, its knip exception, and 233 unreferenced locale keys per language. |
| T38-R2 orphan cascade | Deleted | Removed four modules orphaned by this batch, the three self-only tests, and exactly three newly orphaned `p1/types.ts` exports; `TrustedReturnId` is now file-internal. |
| OI-66 works guidance | Updated | Guidance only promises export/handoff when its rendered action exists; `ACTION_WORDS` now covers export, adoption, handoff, and download claims, including missing-`workId` coverage. |

The evidence shape required before either 1B row can be deleted is a zero-difference
dual-read receipt from the authoritative database for active migrations, produced at
the cutover point. No such receipt exists today.

## Predicate commands and output

### Content card/detail zero production imports

```text
$ rg -n "(?:from\s+['\"][^'\"]*(?:content-package-card|content-package-detail)|import\(['\"][^'\"]*(?:content-package-card|content-package-detail))" apps/core/src mkfast-template-main/src --glob '!*.test.*'
exit_code=1 (zero matches)
```

The T34 compatibility routes still resolve old URLs to Result Center:

```text
mkfast-template-main/src/routes/dashboard/content.tsx:28:to: '/dashboard/works/$workId'
mkfast-template-main/src/routes/dashboard/content_/$contentId.tsx:14:to: '/dashboard/works/$workId'
```

### Retired IA zero mounts and physical absence

```text
$ node scripts/uiux/retired-ia-route-mount-guard.mjs
{
  "modulesChecked": 6,
  "retiredFilesPresent": [],
  "routeEntries": 105,
  "reachableFiles": 664,
  "findings": []
}
```

### Reuse/Polotno zero production imports

```text
$ rg -n "(?:from\s+['\"][^'\"]*(?:reuse-content-panel|polotno-retirement)|import\(['\"][^'\"]*(?:reuse-content-panel|polotno-retirement))" apps/core/src mkfast-template-main/src --glob '!*.test.*'
exit_code=1 (zero matches)
```

### 1B database fact

```text
$ psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM content_package_migration_runs;"
0
```

This query was run against the isolated `meiye_be1` lane database. Because that
database was created empty for the ticket, `0` is evidence that the migration was
never run there, not evidence that authoritative active migrations reconciled.

### OI-63 production consumers

The exact production import/render search found the six list/index routes and three
detail routes below:

```text
dashboard/index.tsx             -> CanonicalHistoryPage
dashboard/assets.tsx            -> CanonicalHistoryPage
dashboard/jobs.tsx              -> CanonicalHistoryPage
dashboard/sessions.tsx          -> CanonicalHistoryPage
dashboard/search.tsx            -> CanonicalHistoryPage
dashboard/recent.tsx            -> CanonicalHistoryPage
dashboard/assets_/$assetId.tsx  -> CanonicalAssetDetailPage
dashboard/jobs_/$jobId.tsx      -> CanonicalJobRoutePage
dashboard/sessions_/$sessionId.tsx -> CreativeObjectPage
```

This was written back to OI-63 in
`docs/handoff/t34-content-operations-replacement-map.md`. Redirecting these
unrelated IA entries to works/Result Center would be new IA design, so the entire
canonical row remains outside this change.

The retained legacy projection has two production consumers:

```text
mkfast-template-main/src/product/creative-object-page.tsx
mkfast-template-main/src/product/canonical-history-page.tsx
```

## R2 orphan cascade evidence

The `980c4899` baseline importer search proves that every R2 module was consumed
only by a file deleted in T38:

```text
components/product/handoff-qr.tsx
  <- routes/dashboard/-content-library-surface.tsx (no self-test)
product/marketing-evidence-chips.tsx
  <- p1/content-package-detail.tsx (+ its self-test)
product/output-quota-meter.tsx
  <- routes/dashboard/-content-library-surface.tsx (+ its self-test)
product/content-library-model.ts
  <- routes/dashboard/-content-library-surface.tsx (+ its self-test)
```

Comparing the baseline and post-T38 knip reports identifies exactly three newly
orphaned exports in `p1/types.ts`: `FilterOption`, `WeeklyReviewFactView`, and
`NextWeekCandidateView`. `FilterOption` remains file-internal, while the other
two declarations were removed. `TrustedReturnId` likewise remains in use only
inside `trusted-return.tsx`, so only its export was removed.

## Verification

| Command | Result |
|---|---|
| `pnpm --filter @meiye/core typecheck` | exit 0 |
| `pnpm --filter @meiye/web build` | exit 0 |
| `pnpm --filter @meiye/web typecheck` | exit 0 |
| `pnpm --filter @meiye/web locale:check` | exit 0; 3,802 keys |
| `node --test scripts/uiux/retired-ia-route-mount-guard.test.mjs scripts/uiux/works-canonical-projection-guard.test.mjs scripts/polotno-retirement-gate.test.mjs` | 23 passed, 0 failed |
| `pnpm --filter @meiye/web test` | 1,258 passed, 0 failed, 0 skipped |
| `pnpm --filter @meiye/core test` | 2,222 passed, 0 failed, 10 live opt-in skipped |
| `pnpm test` (T38-R1) | exit 0: contracts 77/77; web 1,263/1,263; core 2,222 passed, 0 failed, 10 live opt-in skipped; scripts 122 passed, 0 failed, 1 skipped |
| `pnpm check` (T38-R2) | exit 0; workspace, secret scan, D-123, decision-ticket, HeroUI mirror, works projection, and retired-IA guards all passed |
| `pnpm --filter @meiye/web knip` | expected pre-existing exit 1; unused files 44→32, unused exports 344→340, unused exported types 518→510; no R2 orphan remains in the report |
| `git diff --check` | exit 0 |

The first R2 `pnpm check` attempt ran before the candidate deletions were staged.
The D-123 scanner obtains its file list from the index and therefore tried to
read the already-removed `handoff-qr.tsx` from the worktree, producing ENOENT.
After staging the exact candidate diff, the unchanged guard and full root check
passed with exit 0.

The first T38 evidence revision selectively reported files and exports but omitted
the simultaneously available exported-types line. This R2 evidence records all
three knip sections explicitly; the omission was not an acceptable reporting
choice.

Ticket-scoped browser run:

```text
$ .scratch/orca-run-2026-07-25/e2e-lock.sh pnpm --filter @meiye/web e2e tests/e2e/specs/t34-content-operations-reshell.spec.ts --reporter=list
3 passed (1.2m)
```

Lock audit:

```text
2026-07-26T21:01:25+0800 acquire pid=80650 waited=60s cwd=/Users/bin/orca/workspaces/美业内容2/t38-conditional-delete-1d-1b cmd=pnpm --filter
2026-07-26T21:02:43+0800 release pid=80650 cwd=/Users/bin/orca/workspaces/美业内容2/t38-conditional-delete-1d-1b
```
