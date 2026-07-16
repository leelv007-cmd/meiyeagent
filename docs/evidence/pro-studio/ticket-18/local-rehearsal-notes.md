# Ticket 18 — Local / Rehearsal Evidence (NOT PRODUCTION)

**Label:** `LOCAL_REHEARSAL_ONLY_NOT_PRODUCTION`

**Captured:** 2026-07-16 (local engineering pass)

**Database:** `postgres://meiye:***@127.0.0.1:54329/meiye` (local Postgres only)

## What this is

Engineering rehearsal of the Ticket 18 inventory pipeline against local data
and a seeded local fixture workspace. This package deliberately does **not**
claim production inventory coverage and **cannot** close retirement gate ②.

## Freeze gate ①

- Command: `node scripts/polotno-retirement-gate.test.mjs`
- Result: pass (see `local-rehearsal-freeze-gate.txt`)
- Polotno SDK remains absent from runtime, dependencies, env, locale, and lockfile.
- Owning canvas entry routes use Light Composer.

## Local rehearsal snapshot + inventory (all three dispositions)

Seeded workspace: `ws_t18_local_rehearsal` (synthetic fixture rows in local DB only).

Commands (from `apps/core`):

```bash
export DATABASE_URL='postgres://meiye:meiye@127.0.0.1:54329/meiye'
tsx src/p1/operations/polotno-retirement-snapshot-cli-entry.ts \
  --workspace-id ws_t18_local_rehearsal \
  --deployment local-rehearsal \
  --capture-id local-rehearsal-2026-07-16T17-45-00Z \
  --object-inventory ../../docs/evidence/pro-studio/ticket-18/local-rehearsal-object-inventory.json

tsx src/p1/operations/polotno-retirement-inventory-cli.ts \
  --input ../../docs/evidence/pro-studio/ticket-18/local-rehearsal-snapshot.json
```

### Disposition classification exercised

| Work id | Disposition | Why |
| --- | --- | --- |
| `work-convertible` | `convertible` | Clean text + image geometry, no unknown fields |
| `work-read-only` | `read_only` | Unknown document/page fields (`schemaVersion`, `dpi`, `unit`, `fonts`, `audios`, `background`) |
| `work-raster-fallback` | `raster_fallback` | Unsupported element kind `edge` |

Template `template-convertible` → `convertible` (sourced from convertible revision).

Managed rasters bound from export receipt: 2

### Snapshot provenance (local)

- captureId: `local-rehearsal-2026-07-16T17-45-00Z`
- deployment: `local-rehearsal`
- snapshotSha256: `0dcddf9ee34326ef8a7afe9d15f7beab13c8e212c32fa6f7f57b1e2c26325526`
- database LSN: `1/8578C1C8`
- transaction snapshot: `2264213:2264213:`
- sourceCounts: `{"exportReceipts": 1,"revisions": 3,"templates": 1,"templateVersions": 1,"works": 3}`

### Inventory totals (rehearsal workspace)

```json
{
  "exportRecords": 1,
  "pages": 4,
  "revisions": 3,
  "templateVersions": 1,
  "templates": 1,
  "works": 3
}
```

Element kinds: `{"text": 2,"image": 2,"edge": 1}`

Unknown fields: `{"document.dpi": 1,"document.unit": 1,"document.fonts": 1,"document.audios": 1,"document.schemaVersion": 1,"page.background": 1}`

## Local multi-workspace aggregate scan

File: `local-db-aggregate-scan.json`

Classifies every workspace present in the local Postgres instance with the same
`inventoryLegacyCanvasData` disposition rules. Includes the seeded rehearsal
workspace above.

- workspaces: 82
- works: 86
- revisions: 159
- pages: 174
- templates: 15
- exportRecords: 16
- dispositionCounts: `{"convertible": 69,"read_only": 16,"raster_fallback": 1}`

Pre-existing local works (excluding the seeded raster fixture) already showed
real `convertible` and `read_only` shapes (legacy Polotno-ish unknown fields).
`raster_fallback` appears via the seeded rehearsal fixture.

## Tooling fix in this pass

`polotno-retirement-inventory-cli.ts` now strips a leading `--` token so
`pnpm canvas:retirement-inventory -- --input ...` matches the snapshot CLI
contract.

## Explicitly still open (production gate ②)

- [ ] Production credentials / deployment identity exercised
- [ ] Production PostgreSQL snapshot with LSN + transaction snapshot
- [ ] Production managed-object inventory bound to the same capture id
- [ ] Production inventory report covering 100% Work / Revision / Template
- [ ] Production disposition rulings used as gate ② evidence for Ticket 20

Do **not** treat any file in this directory as production inventory evidence.
