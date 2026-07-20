# Pro Studio exact-copy candidate inventory (K01)

- **Recorded:** 2026-07-19
- **Upstream:** `https://github.com/csyqlz/vozeb`
- **Pinned commit:** `a2c52c7aacf68d825563b7455efa9c34f3db0123` (`v1.0.0`)
- **Checkout env:** `PRO_STUDIO_UPSTREAM_ROOT` (must `git rev-parse HEAD` == pinned)
- **Primary surface:** `web/src/app/(user)/canvas/**` (46 files at pin)
- **Target pattern:** `apps/canvas/src/vendor/vozeb/<relative under web/src/>`
- **Policy:** canvas / render / retouch core only; 过窄优先 (narrow-first). No full-stack pack.
- **Re-apply:** `scripts/pro-studio/apply-exact-copies.mjs`

## Owner note (过窄优先)

Product/engineering owner accepts this inventory as **narrow-first**: only presentation-level canvas/retouch core + pure client utils. Explicitly **not** copying Vozeb API routes, provider-direct generation orchestration, arbitrary media proxy helpers, auth/admin/points shells, local Agent bridge, bulk prompt corpora, or server task stores. Runtime integration supplies product-owned BackendPort adapters outside exact-copy rows.

## Include → exact-copy (K02)

### Canvas surface — role `render` (node graph, shell, interaction)

| Source (upstream-relative) | Role | A3 risk | Into manifest |
| --- | --- | --- | --- |
| `web/src/app/(user)/canvas/[id]/page.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/constants.ts` | render | none material | yes |
| `web/src/app/(user)/canvas/export-types.ts` | render | none material | yes |
| `web/src/app/(user)/canvas/types.ts` | render | none material | yes |
| `web/src/app/(user)/canvas/components/vozeb-canvas.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-node.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-connections.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-mini-map.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-toolbar.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-zoom-controls.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-context-menu.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-config-composer.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-node-hover-toolbar.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-size-picker.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-resource-mention-textarea.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-project-card.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-delete-projects-dialog.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/asset-picker-modal.tsx` | render | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-prompt-library.tsx` | render | thin shell only; does **not** ship bulk prompt corpus (external dynamic import excluded) | yes |
| `web/src/app/(user)/canvas/components/canvas-agent-chat-ui.tsx` | render | Agent UI chrome (online path); no local bridge | yes |
| `web/src/app/(user)/canvas/components/canvas-agent-panel-motion.ts` | render | none material | yes |
| `web/src/app/(user)/canvas/stores/use-canvas-store.ts` | render | localForage persistence (browser); cloud adapter later (K04) | yes |
| `web/src/app/(user)/canvas/stores/use-canvas-ui-store.ts` | render | none material | yes |
| `web/src/app/(user)/canvas/utils/canvas-image-data.ts` | render | none material | yes |
| `web/src/app/(user)/canvas/utils/canvas-node-size.ts` | render | none material | yes |
| `web/src/app/(user)/canvas/utils/canvas-resource-references.ts` | render | none material | yes |
| `web/src/app/(user)/canvas/utils/canvas-agent-ops.ts` | render | pure op apply/summarize; product Agent path uses BackendPort confirm (K08) | yes |

### Retouch / local image tools — role `retouch`

| Source (upstream-relative) | Role | A3 risk | Into manifest |
| --- | --- | --- | --- |
| `web/src/app/(user)/canvas/components/canvas-node-mask-edit-dialog.tsx` | retouch | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-node-crop-dialog.tsx` | retouch | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-node-split-dialog.tsx` | retouch | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-node-upscale-dialog.tsx` | retouch | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-node-angle-dialog.tsx` | retouch | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-image-toolbar-tools.tsx` | retouch | none material | yes |
| `web/src/app/(user)/canvas/components/canvas-image-toolbar-settings-modal.tsx` | retouch | none material | yes |

### Pure client utils — role `pure-util`

| Source (upstream-relative) | Role | A3 risk | Into manifest | Why included |
| --- | --- | --- | --- | --- |
| `web/src/lib/canvas-theme.ts` | pure-util | none | yes | theme tokens used across canvas |
| `web/src/lib/image-utils.ts` | pure-util | type-only external import | yes | meta/size helpers for retouch |
| `web/src/lib/utils.ts` | pure-util | clsx/tailwind-merge npm | yes | `cn()` helper |
| `web/src/lib/file-drop.ts` | pure-util | none | yes | drag/drop helpers |
| `web/src/lib/image-reference-prompt.ts` | pure-util | none | yes | reference labels/prompt text |
| `web/src/lib/audio-generation.ts` | pure-util | none | yes | voice/format labels for audio node UI |
| `web/src/lib/zip.ts` | pure-util | fflate npm | yes | project import/export |
| `web/src/lib/storage-keys.ts` | pure-util | branding keys only | yes | export id / storage key helpers |

**Include counts:** canvas 34 + pure-util 8 = **42** exact-copy rows.

## Exclude — role `exclude` (do **not** exact-copy)

| Source / surface | Role | Reason |
| --- | --- | --- |
| `web/src/app/(user)/canvas/components/canvas-local-agent-panel.tsx` | exclude | Local Agent bridge (agentToken/agentUrl/localStorage token) — unsafe for SaaS build |
| `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`, `components/canvas-assistant-panel.tsx`, `stores/use-canvas-agent-store.ts` | exclude | Local Agent URL/token state and local-mode entry; the page also calls upstream provider/storage services directly |
| `web/src/app/(user)/canvas/page.tsx`, `components/canvas-node-generation.ts`, `components/canvas-*-settings-popover.tsx`, `components/canvas-config-node-panel.tsx`, `components/canvas-node-prompt-panel.tsx`, `utils/canvas-export.ts` | exclude | Upstream provider/config/storage orchestration; product runtime must use BackendPort adapters |
| `web/src/lib/browser-media-url.ts` | exclude | Constructs an arbitrary `/api/media-proxy?url=...` target |
| `web/src/lib/seedance-video.ts` | exclude | Reads upstream provider config and base URL directly |
| `web/src/app/api/**` | exclude | Vozeb backend/business runtime; arbitrary proxy / task routes |
| `web/src/app/**/auth/**`, auth libs | exclude | Independent auth bootstrap |
| `web/src/app/**/admin/**` | exclude | Admin shell |
| `web/src/app/**/points/**`, points libs | exclude | Points/billing runtime |
| `web/src/lib/prompts/**` | exclude | Bulk prompt corpus (A3 / product seed policy separate) |
| `web/src/lib/server/**` | exclude | Server secrets / task stores |
| `web/src/lib/auth/**`, `web/src/lib/mail/**` | exclude | Auth/mail runtime |
| `web/src/lib/localforage-storage.ts` | exclude | Browser storage adapter; product uses OwnedAsset/BackendPort (K04/K05) — not pure enough for frozen util allow-list |
| `web/src/lib/media-url.ts`, `web/src/lib/app-theme.ts`, other unlisted libs | exclude | Not required by frozen canvas allow-list / not pure canvas util |
| `web/src/services/**`, `web/src/stores/**` (except canvas stores above) | exclude | Upstream business services & config channels |
| `web/src/components/prompts/**` | exclude | Bulk prompt UI/corpus behind prompt library shell |
| `canvas-agent/**` (repo root package) | exclude | Local agent package / shell |
| Unpinned `main` drift | exclude | Only a2c52c7 bytes authorized for rows |

## Mapping rule

```text
web/src/<rel>  →  apps/canvas/src/vendor/vozeb/<rel>
```

Example:

```text
web/src/app/(user)/canvas/components/vozeb-canvas.tsx
  → apps/canvas/src/vendor/vozeb/app/(user)/canvas/components/vozeb-canvas.tsx
```

## Verification checklist

1. `git -C "$PRO_STUDIO_UPSTREAM_ROOT" rev-parse HEAD` == `a2c52c7aacf68d825563b7455efa9c34f3db0123`
2. Every `copies[]` row: `sha256(source) == sha256(target) == row.sha256`
3. `authorizationStatus: authorized`; A2/A3 paths exist
4. No undeclared exact-copy under `apps/canvas` (discoverExactCopyTargets)
5. Re-apply: `PRO_STUDIO_UPSTREAM_ROOT=… node scripts/pro-studio/apply-exact-copies.mjs`
