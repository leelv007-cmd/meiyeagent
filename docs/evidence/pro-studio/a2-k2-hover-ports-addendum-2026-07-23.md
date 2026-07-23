# A2 — K2 hover-port correction addendum

- **Recorded:** 2026-07-23 (Asia/Shanghai)
- **Basis:** `a2-authorization-2026-07-19.md` §3 authorizes derivative work
  inside 美业内容2 at the pinned Vozeb baseline.
- **Reviewer:** `product_owner`
- **Purpose:** correct the K1 `ports[]` ledger with source paths and hashes that
  can be recomputed from `a2c52c7aacf68d825563b7455efa9c34f3db0123`.

## Authorized derivative ports

| Upstream source | Source SHA-256 | Host target | Product boundary |
| --- | --- | --- | --- |
| `web/src/app/(user)/canvas/components/canvas-node-hover-toolbar.tsx` | `3f5a17c3bf26da7cc511d00b77d8f1992e2458d04d6e23369ec28eb33b1581e2` | `apps/canvas/src/kernel-host/ported/kernel-node-hover-toolbar.tsx` | Merchant-safe G23 hover actions through host callbacks only. |
| `web/src/app/(user)/canvas/components/canvas-image-toolbar-tools.tsx` | `d11c586d1ccf80ec2d0a3f9b3871d6255b2306b7a64e7c7fe339c6b578f75dc7` | `apps/canvas/src/kernel-host/ported/image-quick-tools.ts` | G25 visible-tool preference and normalization contract. |
| `web/src/app/(user)/canvas/components/canvas-image-toolbar-settings-modal.tsx` | `ef85ef1c1f5d3cb3838dbf72ca6b68879829ec1f64908d58c9059ee5dc8829d7` | `apps/canvas/src/kernel-host/ported/image-quick-tools.test.ts` | G25 settings-selection contract coverage; it is a host adaptation test, not an upstream test copy. |

The machine-checked `ports[]` record remains the authority for each target
hash and adapter-replacement matrix. These ports may not admit an upstream
local Agent bridge, provider/store authority, raw workspace or asset
identifiers, prompt corpus, or durable project state.

## Non-port correction

At the pinned commit, neither
`canvas-node-info-dialog.tsx` nor `canvas-node-info-dialog.test.tsx` exists.
The upstream information modal is part of
`canvas-node-hover-toolbar.tsx`; it is not a standalone source file. The
product's desensitized node-info projection and its test are host-owned
rebuilds with a different redaction boundary, so they live under
`apps/canvas/src/kernel-host/` rather than the derivative `ported/` namespace
and have no `ports[]` record. This addendum does not claim an upstream source
or copied bytes for those host-owned files.
