# A2 — K1 derivative-port addendum

- **Recorded:** 2026-07-22 (Asia/Shanghai)
- **Basis:** `a2-authorization-2026-07-19.md` §3 grants the named grantee the
  limited right to modify and create derivatives inside 美业内容2.
- **Reviewer:** `product_owner`
- **Status:** authorized under the recorded written instrument; this is an
  engineering scope record, not a new claim of third-party rights.

## Authorized derivative

| Field | Value |
| --- | --- |
| Upstream | `web/src/app/(user)/canvas/stores/use-canvas-ui-store.ts` |
| Pinned commit | `a2c52c7aacf68d825563b7455efa9c34f3db0123` |
| Source SHA-256 | `ce6ca88828354ddccb77a9a0e89b79503b78e3e5eaf94ea0eb709bea0c137003` |
| Host target | `apps/canvas/src/kernel-host/ported/canvas-session-store.ts` |
| Product use | Canvas-only ephemeral session projection |

The target may retain only the source's UI-session intent: selection, panel,
toolbar preference, and viewport state. It must not copy a durable project
store, local Agent bridge, provider configuration, prompt corpus, or upstream
account/points/auth behavior. Persistent graph, checkpoint, lineage, and
OwnedAsset facts remain behind the product-owned BackendPort and Core services.

The port record in `copy-manifest.json` is the machine-checked authority for
the target hash and adapter-replacement matrix. Any additional derivative file
requires a separate A2/A3 addendum and a new `ports[]` row first.
