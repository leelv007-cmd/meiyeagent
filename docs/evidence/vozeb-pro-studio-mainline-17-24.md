# Pro Studio mainline evidence: Tickets 17-24

Date: 2026-07-16

## Implemented seams

- Ticket 17: the Canvas Work route uses the daily light Composer for copy edits, image replacement/crop, module ordering, preview, immutable revision save, template save, and export.
- Ticket 18: `canvas:retirement-snapshot` captures Work/Revision/Template/ExportReceipt rows inside one PostgreSQL `REPEATABLE READ READ ONLY` transaction, records the transaction snapshot and WAL LSN, verifies independently queried counts and an externally captured managed-object manifest, and emits a provenance-bound snapshot SHA. Its stdout JSON is accepted directly by the existing inventory and access CLIs. `inventoryLegacyCanvasData` then reports pages/element kinds/unknown fields/last edit/last export and classifies `convertible`, `read_only`, or `raster_fallback`.
- Ticket 19: `renderLightCanvasDocument` burns watermark/AIGC labels into the raster. Tests cover all four label combinations and the returned PNG data URL. Existing Canvas export validation continues to assert image/font/CJK line-break evidence and raster SHA.
- Ticket 20: Canvas export now persists validated raster bytes through `PersistentCanvasExportAdapter` into workspace-owned Asset storage. The strict `adopt_canvas_work_export` command validates workspace, Work, revision, receipt, and durable Asset custody; it idempotently creates an accepted image-text ContentPackage whose source records the exact Work/revision/receipt lineage. `CanvasWorkPage` opens that package in the content library after export. The page-editor SDK, runtime, license gate, dependency, lock entries, env variables, and locale copy remain absent, with `scripts/polotno-retirement-gate.test.mjs` as the repeatable static gate.
- Ticket 21: activation probes use sanitized fixed image/video probe inputs, `productUsageQuantity: 0`, the production submit/poll/download lifecycle, classified errors, cancellation conformance, observed provider cost, and configuration-revision-bound evidence. The [real Tuzi adapter baseline](./pro-studio/ticket-21/live-adapter-canary-2026-07-16.md) passed for image and video. No Vozeb-derived fixture was copied because the A2/A3 authorization manifest is still blocked.
- Ticket 22: media custody reconciliation labels source/owned/replica state, rejects cross-workspace object keys, and emits deterministic `copy_to_owned` repairs for missing replicas.
- Ticket 23: the admin audit route includes merchant support diagnostics for quota, ledger consistency, estimate/actual provider cost, failure reason, and refund status without direct database access.
- Ticket 24: database migration `0002_last_admin_guard.sql` serializes administrator deletion/demotion and rejects removal of the final platform admin. Offline credential reset is available as `pnpm --filter @meiye/web auth:reset-password:offline -- --email <email> --password-stdin`; it hashes through Better Auth, updates the credential account transactionally, and revokes all sessions without logging the password.

## Operator drills

Last-admin drill:

1. Apply migrations to the drill database.
2. With one platform admin, attempt role demotion and deletion; both must fail with `LAST_ADMIN_REQUIRED`.
3. Add a second platform admin; demotion or deletion of the first must succeed.
4. Concurrently demote two admins; the advisory transaction lock must allow at most one operation to remove admin status.

Offline reset drill:

```bash
read -rs RESET_PASSWORD
printf '%s' "$RESET_PASSWORD" | DATABASE_URL='<database-url>' pnpm --filter @meiye/web auth:reset-password:offline -- --email admin@example.com --password-stdin
unset RESET_PASSWORD
```

Success output contains only email, user ID, and revoked-session count. Verify old sessions fail and the new password signs in.

## Runtime drill evidence

### Ticket 24: PostgreSQL and Better Auth

The drill ran against a randomly named disposable database on the local PostgreSQL 16 service. The database was created for this drill only and dropped with `DROP DATABASE ... WITH (FORCE)` after the assertions; a final catalog query returned zero matching databases.

- `pnpm db:migrate` applied every migration, including `0002_last_admin_guard.sql`, successfully.
- Deleting the only administrator failed with PostgreSQL error `LAST_ADMIN_REQUIRED`; the row remained an administrator.
- After adding a second administrator, two concurrent role-demotion transactions targeted different administrators. One committed and one failed with `LAST_ADMIN_REQUIRED`; the final query returned `admin_count=1`.
- A real Better Auth credential user signed in with the old password (`HTTP 200`) and created one persisted session.
- The documented offline reset command returned `revokedSessions: 1`; the immediate database query returned zero sessions.
- The old password then returned `HTTP 401` and created no session. The new password returned `HTTP 200` and created one session.
- The drill exposed and fixed one CLI defect: pnpm's conventional `--` argument separator reached the parser as an argument. The parser now accepts one leading separator and the documented command is covered by the unit test and the real drill.

### Tickets 17 and 19: browser edit and raster receipt

The isolated Chromium run exercised the real Web → Core → PostgreSQL path:

1. Created a blank Canvas Work and seeded one immutable revision with two Chinese text modules and one same-origin image.
2. In the visible light Composer, changed multiline Chinese copy, cropped the image module, reordered modules, and enabled both watermark and AIGC switches.
3. Saved a new revision and asserted its persisted text, dimensions, and element order.
4. Exported through the browser renderer, decoded the returned file, asserted the PNG signature, and compared its byte count and SHA-256 with the persisted Core receipt.
5. Asserted receipt evidence for `hero`, `sans-serif`, multiline CJK, `1080 × 1350`, both compliance switches, and zero requests containing the retired runtime name.

Observed receipt:

- bytes: `87133`
- SHA-256: `9d862c6596ca515cf17767aeae05ecb20987f226a6c0b1d47c64ef3f84ad6661`
- screenshot: `docs/evidence/pro-studio/ticket17-19-light-composer-runtime.png`

The run also exposed and fixed an edit-loss bug: label mutations refetched the same revision with a new object identity and reset unsaved local edits. The light Composer now resets its local document only when the immutable revision ID changes.

### Ticket 20 gate 1: template to accepted ContentPackage

The isolated Chromium run exercised the complete daily-layout handoff through the real Web → Core → PostgreSQL path:

1. Created a blank Work, seeded a text/image layout, and saved it as a user template.
2. Edited copy, cropped and reordered modules, and saved an immutable revision in the light Composer.
3. Exported the browser raster; Core validated the evidence marker and persisted the bytes under the current workspace's `owned/` namespace.
4. Adopted the exact Work/revision/export-receipt tuple through `adopt_canvas_work_export` and asserted the resulting image-text ContentPackage was immediately `accepted` with one ordered owned Asset.
5. Navigated to `/dashboard/content?packageId=...`, observed the matching content-library card, and asserted zero network requests containing `polotno`.

Evidence screenshot: `docs/evidence/pro-studio/ticket20-layout-adopted-package.png`.

## Verification commands

```bash
node --test scripts/polotno-retirement-gate.test.mjs scripts/uiux/evidence-tools.test.mjs
pnpm uiux:bundle-check
pnpm --filter @meiye/core exec tsx --test src/p1/model-supply/activation-probe-executor.test.ts src/p1/operations/media-custody.test.ts src/p1/operations/polotno-retirement-inventory.test.ts src/p1/operations/polotno-retirement-snapshot.test.ts src/p1/operations/polotno-retirement-snapshot-cli.test.ts
pnpm --filter @meiye/core exec tsx --test src/p1/operations/canvas-export-adoption.test.ts src/p1/operations/content-package-export-adapter.test.ts src/p1/operations/content-package.test.ts
pnpm --filter @meiye/web exec tsx --test src/product/light-composer-document.test.ts src/product/light-composer-compliance.test.ts src/p1/merchant-support-diagnostic.test.ts src/auth/offline-password-reset.test.ts src/auth/last-admin-migration.test.ts
TEST_DATABASE_URL='<isolated-db-url>' DATABASE_URL='<isolated-db-url>' PORT=3124 PLAYWRIGHT_CORE_PORT=4124 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3124 PLAYWRIGHT_AUTH_BASE_URL=http://127.0.0.1:3124 pnpm --filter @meiye/web exec playwright test tests/e2e/specs/uiux-operations-reuse.spec.ts --grep 'edits, saves, and exports'
pnpm --filter @meiye/web exec playwright test tests/e2e/specs/pro-studio-engineering-tickets.spec.ts --grep 'ticket 17/20 gate 1'
pnpm --filter @meiye/web exec playwright test tests/e2e/specs/pro-studio-engineering-tickets.spec.ts --grep 'ticket 20 gate 4'
```

The production historical-data counts remain environment evidence. First export an object manifest with the same deployment/workspace/capture identity, then run `DATABASE_URL='<production-readonly-url>' pnpm --filter @meiye/core canvas:retirement-snapshot -- --workspace-id <workspace-id> --deployment <deployment> --capture-id <capture-id> --object-inventory <objects.json> > snapshot.json`. Retain the snapshot, run the inventory and access CLIs against it, and retain both reports before declaring the data gate complete.

## Unmet runtime and authorization evidence

- Ticket 17: the real browser edit/save/export journey and the template-to-ContentPackage daily-layout handoff pass.
- Ticket 18: the fixture-backed production snapshot contract and read-only PostgreSQL capture path pass. A **local** full inventory of every workspace with canvas works on dev Postgres is archived (`docs/evidence/pro-studio/ticket-18/local-full-inventory-2026-07-16.md`; 86 works → convertible 69 / read_only 16 / raster_fallback 1) with disposition open/export path samples. No production snapshot was supplied or executed, so production historical coverage, counts, and every-work open/export behavior remain unverified.
- Ticket 19: the new renderer's real PNG bytes and persisted receipt now pass (takeover complete). No old-renderer comparison is claimed because the retired runtime is absent and no approved historical comparison artifact was supplied; sample-equivalence remains the only open ticket 19 checkbox.
- Ticket 20: gates ①/③/④/⑤ pass. Gate ③ is literal takeover (new renderer sole path for watermark/AIGC/export evidence; see ticket 19 matrix + retirement gate), not sample-equivalence. The complete named-entry Playwright matrix reaches Light Composer with zero Polotno traffic, and the production bundle passes at 345436 JS gzip / 36548 CSS gzip bytes. Production historical fallback (gate ②) remains open. SDK removal must not be treated as release approval while gate ② and ticket 19 sample-equivalence are open.
- Ticket 21: `docs/evidence/pro-studio/copy-manifest.json` remains `blocked_pending_a2_a3_authorization`; no upstream-derived fixture may be added or claimed complete. The real adapter baseline passed, but the administrator activation-evidence drill and real cancel/failure proof have not run.
- Ticket 22: reconciliation and repair planning are tested, but no live storage repair was executed.
- Ticket 23: the diagnostic projection is tested, but the authorized-support browser drill was not run.
- Ticket 24: the real migration, concurrent last-admin invariant, offline reset, session revocation, old-password rejection, and new-password login drill passed in the disposable database.
