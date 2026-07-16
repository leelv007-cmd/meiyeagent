# Ticket 18 — Local Full Workspace Inventory (LOCAL NOT PRODUCTION)

**Label:** `LOCAL_FULL_INVENTORY_ONLY_NOT_PRODUCTION`

**Captured:** 2026-07-16

**Database:** `postgres://meiye:***@127.0.0.1:54329/meiye` (local Postgres only)

**Deployment identity used by tooling:** `local-postgres-dev`

**Capture id:** `local-full-inventory-2026-07-16T10-00-00Z`

## What this is

Full local engineering inventory of **every workspace that has `p1_canvas_works` rows** on the local development Postgres instance. For each workspace the run produced:

1. object inventory JSON (derived from local `p1_export_receipts` metadata)
2. `exportLegacyCanvasProductionSnapshot` / `canvas:retirement-snapshot` equivalent capture (REPEATABLE READ READ ONLY, LSN + transaction snapshot + snapshot SHA)
3. `inventoryLegacyCanvasData` / `canvas:retirement-inventory` disposition report

Aggregate + per-workspace artifacts live under:

`docs/evidence/pro-studio/ticket-18/local-full-inventory-2026-07-16/`

This package deliberately does **not** claim production inventory coverage and **cannot** close retirement gate ② / Ticket 18 production DoD.

## Totals (local)

| Metric | Count |
| --- | ---: |
| workspaces with canvas works | 82 |
| works | 86 |
| revisions | 159 |
| pages | 174 |
| templates | 15 |
| template versions | 15 |
| export records | 16 |
| managed rasters bound from receipts | 17 |

Observed database LSN during the capture loop: `1/86410A80` (stable across workspace captures in this read-only pass).

## Disposition counts (ALL local works)

| Disposition | Works |
| --- | ---: |
| `convertible` | **69** |
| `read_only` | **16** |
| `raster_fallback` | **1** |
| **Total** | **86** |

Notes:

- `read_only` is driven by real local documents that retain Polotno-ish unknown fields (`document.dpi` / `unit` / `fonts` / `audios` / `schemaVersion`, page bleed/size/background, extensive `element.image.*` keys, etc.).
- `raster_fallback` appears only via the seeded local fixture workspace `ws_t18_local_rehearsal` (`work-raster-fallback`, unsupported element kind `edge`).
- Pre-existing local works already exercise both `convertible` and `read_only` without the fixture.

### Element kinds (aggregate)

```json
{"text": 94, "image": 89, "edge": 1}
```

### Unknown fields (top)

`document.dpi/unit/fonts/audios/schemaVersion` (14), `page.background` (14), `page.bleed/width/height/children/duration` (13), plus many `element.image.*` unknown keys (13 each). Full map: `local-full-inventory-2026-07-16/aggregate-report.json`.

## Artifact layout

```
docs/evidence/pro-studio/ticket-18/local-full-inventory-2026-07-16/
  aggregate-report.json          # LOCAL aggregate + dispositionCounts
  workspace-index.json           # per-workspace summary + paths
  workspaces/
    <workspaceId>.object-inventory.json
    <workspaceId>.snapshot.json
    <workspaceId>.inventory-report.json
  access-samples/
    convertible.json
    read_only.json
    raster_fallback.json
    real-convertible-with-raster.json
    rehearsal-full-audit.json
    rehearsal-patched-for-access.snapshot.json
    cli-retirement-access.json
  managed-root/                  # synthetic 1x1 PNG bytes for access-path proof only
```

82/82 workspaces with canvas works produced object inventory + snapshot + inventory report with **zero capture errors**.

## Access path samples (open / export classification)

Samples prove disposition routing through `LegacyCanvasHistoryAccess` / `canvas:retirement-access`.

| Disposition class | Open mode | Editable | Export source |
| --- | --- | --- | --- |
| `convertible` | `light_composer` | true | `existing_managed_raster` |
| `read_only` | `read_only_document` | false | `existing_managed_raster` |
| `raster_fallback` | `managed_raster` | false | `existing_managed_raster` |

Primary samples use local fixture workspace `ws_t18_local_rehearsal` with a synthetic managed PNG attached to every revision/template version so open **and** export paths can be exercised for all three classes. See:

- `access-samples/convertible.json`
- `access-samples/read_only.json`
- `access-samples/raster_fallback.json`

Official CLI audit on the patched rehearsal fixture:

```bash
pnpm exec tsx src/p1/operations/polotno-retirement-access-cli.ts \
  --input .../access-samples/rehearsal-patched-for-access.snapshot.json \
  --managed-root .../managed-root
```

Result (`access-samples/cli-retirement-access.json`):

- `passed: true`
- targets: 8 opened / 8 exported
- `exportStrategy: existing_managed_raster_only`
- works: convertible + read_only + raster_fallback all present

Additional real local row (not fixture-only) with pre-existing managed raster metadata:

- workspace `ws_953LLKdqBWAZquXwMEu1dui5xXWE3kZb`
- work `d9757f1b-37e1-4f95-8985-5345e2b28296`
- open → `light_composer` / editable
- export → `existing_managed_raster`
- evidence: `access-samples/real-convertible-with-raster.json`

**Important:** managed bytes under `managed-root/` are synthetic local 1×1 PNGs used only to prove open/export routing and integrity checks. They are **not** production object-store custody evidence.

## Method notes

1. Enumerated every `workspace_id` from `p1_canvas_works` on local Postgres.
2. Built per-workspace object inventory from distinct `p1_export_receipts` object metadata (`objectKey` / `contentType` / `sha256` / `bytes`) with the same capture identity.
3. Ran `PostgresLegacyCanvasSnapshotSource` + `exportLegacyCanvasProductionSnapshot` (same path as `canvas:retirement-snapshot`).
4. Ran `inventoryLegacyCanvasData` (same path as `canvas:retirement-inventory`) and aggregated disposition counts across all works.
5. Ran disposition-class access samples via `LegacyCanvasHistoryAccess` and the `canvas:retirement-access` CLI.

Example single-workspace inventory CLI check:

```bash
export DATABASE_URL='postgres://meiye:meiye@127.0.0.1:54329/meiye'
pnpm exec tsx src/p1/operations/polotno-retirement-inventory-cli.ts \
  --input docs/evidence/pro-studio/ticket-18/local-full-inventory-2026-07-16/workspaces/<workspaceId>.snapshot.json
```

## Explicitly still open (production gate ②)

- [ ] Production credentials / deployment identity exercised
- [ ] Production PostgreSQL snapshot with LSN + transaction snapshot
- [ ] Production managed-object inventory bound to the same capture id (real object store listing, not local receipt-derived metadata)
- [ ] Production inventory report covering 100% Work / Revision / Template
- [ ] Production disposition rulings used as gate ② evidence for Ticket 20
- [ ] Production every-work open/export behavior with real managed rasters

Do **not** treat this directory, or any file under `docs/evidence/pro-studio/ticket-18/`, as production inventory evidence.
