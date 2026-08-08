# A3 — Third-party source gate evidence (companion to written A2)

- **Recorded:** 2026-07-19 (Asia/Shanghai)
- **Updated:** 2026-07-19 — aligned with dual-grantor written instrument
- **Gate:** A3 third-party / non-author source gate for Pro Studio direct copies
- **Primary A2 instrument:** `docs/design/# Git 仓库开发授权书.md`  
  (stable copy + hash in `a2-authorization-2026-07-19.md` §2)
- **Does not claim:** Full SPDX BOM for all of `a2c52c7`, or clearance of every npm/font/media asset in Vozeb

## 1. Relationship to A2

- **A2** (`a2-authorization-2026-07-19.md`): `csyqlz` + `basketikun` written grant to `legacy-origin-a` for commercial development and copy of `https://github.com/csyqlz/vozeb`, with product policy limiting exact-copy rows to canvas/render/retouch core at the pinned commit.
- **A3** (this file): disposition of **third-party and non-grantor** materials that may appear next to or inside those files.

The written instrument §五 requires the grantee to avoid unlicensed third-party code/assets and to respect open-source licenses when introducing dependencies. That clause **reinforces** A3; it does **not** auto-clear third-party works that the grantors do not own.

## 2. Operating rules for exact-copy rows

| Asset class | Disposition |
| --- | --- |
| npm / runtime dependencies | **Do not copy as first-party source.** Declare in package manifests; obey each package license. |
| Fonts, icons, raster/vector media shipped in Vozeb | **Not auto-cleared.** Only enter the monorepo if listed on a per-file `copies[]` row with license notes, or replaced with our own assets. |
| Prompt / seed corpora from Vozeb | **Not authorized for bulk copy.** Pro Studio seeds remain product-owned static recipes (Ticket 16), not a Vozeb dump. |
| `@basketikun/*` identifiers / package names | Provenance markers; rename or isolate at integration boundary when embedding. |
| AGPL-marked third-party snippets of unknown rightsholders | Fail closed until identified and cleared. |
| Unrelated third parties | Instrument §三.4 forbids providing source to **unrelated** third parties; product exact-copy stays inside the grantee’s authorized commercial product path. |

## 3. Default for exact-copy rows

When a future `copies[]` entry is added:

1. Reference this A3 evidence (or a superseding instrument).
2. If bytes are pure grantor-owned canvas/render/retouch core with no third-party media blobs, A3 is **cleared by exclusion** under the table above.
3. If bytes embed third-party media or license-encumbered assets, add row-level `thirdPartyNotes` (or an A3 addendum) before `authorizationStatus: authorized`.

## 4. Residuals

- No exhaustive third-party inventory of the entire Vozeb tree was produced on 2026-07-19.
- Production release of any exact-copy surface should attach a short third-party checklist for the **actual copied file set**.

## 5. What this unlocks / does not unlock

**Unlocks**

- Stable A3 path for copy-manifest rows under the written A2 instrument.

**Does not unlock**

- Copying Vozeb fixtures, prompt banks, or media without an explicit row.
- Conformance pass with empty `copies[]`.
