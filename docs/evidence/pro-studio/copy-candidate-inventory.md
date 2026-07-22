# Pro Studio K1 copy/port inventory and foundation review

- **Recorded:** 2026-07-22 (Asia/Shanghai)
- **Upstream pin:** `a2c52c7aacf68d825563b7455efa9c34f3db0123`
- **Baseline recheck:** product code has no drift from
  `4625e423a7b0efc9a7ec014580e7b01633cf264a` in the Canvas/Core Pro Studio
  paths; the current K1 work starts from `e0dd4d81217957bddaac81fd417167a52542a63e`.
- **Machine authority:** `docs/evidence/pro-studio/copy-manifest.json` schema
  v2, regenerated only by `scripts/pro-studio/apply-exact-copies.mjs`.

The 2026-07-19 K01 inventory is historical only. D-099 rev2 and the K1–K7
plan replace its prior implication that an exact copy or an import establishes
upstream parity.

## Direct-copy classification

The v2 manifest closes the complete direct-copy set. `mount-exact` means a
future host ticket may mount the unchanged bytes through a listed production
boundary; it is not evidence that the surface is mounted today. `utility-exact`
is the same rule for a pure utility. `port-required` may not be mounted until a
host adapter/rebuild is completed. `delete-from-inventory` is deliberately
unmounted. `out-of-scope` has no production reference.

| Classification | Frozen upstream sources |
| --- | --- |
| `mount-exact` | `components/asset-picker-modal.tsx`, `canvas-config-composer.tsx`, `canvas-context-menu.tsx`, `canvas-delete-projects-dialog.tsx`, `canvas-image-toolbar-tools.tsx`, `canvas-mini-map.tsx`, `canvas-node-angle-dialog.tsx`, `canvas-node-crop-dialog.tsx`, `canvas-node-hover-toolbar.tsx`, `canvas-node-mask-edit-dialog.tsx`, `canvas-node-split-dialog.tsx`, `canvas-node-upscale-dialog.tsx`, `canvas-node.tsx`, `canvas-project-card.tsx`, `canvas-size-picker.tsx`, `canvas-zoom-controls.tsx`, `vozeb-canvas.tsx` |
| `utility-exact` | `constants.ts`, `types.ts`, `utils/canvas-image-data.ts`, `utils/canvas-node-size.ts`, `lib/audio-generation.ts`, `lib/canvas-theme.ts`, `lib/file-drop.ts`, `lib/image-reference-prompt.ts`, `lib/image-utils.ts`, `lib/utils.ts` |
| `port-required` | `components/canvas-image-toolbar-settings-modal.tsx` → `src/client/runtime-panel.tsx`; `components/canvas-prompt-library.tsx` → `src/client/runtime-panel.tsx`; `components/canvas-resource-mention-textarea.tsx` → `src/kernel-host/generation-adapter.ts`; `stores/use-canvas-ui-store.ts` → `src/kernel-host/ported/canvas-session-store.ts`; `lib/zip.ts` → `src/server/backend-port-vnext.ts` |
| `delete-from-inventory` | `[id]/page.tsx`, `export-types.ts`, `stores/use-canvas-store.ts`, `lib/storage-keys.ts` |
| `out-of-scope` | `components/canvas-agent-chat-ui.tsx`, `components/canvas-agent-panel-motion.ts`, `utils/canvas-agent-ops.ts` |

All paths in the table are relative to `web/src/app/(user)/canvas/` except the
explicit `lib/` entries. The v2 JSON stores the full, unambiguous source path
for every one of the 42 rows and is mechanically checked against
`EXACT_COPY_SOURCES`; the table is a reviewer aid, not a second source of
truth.

### Current production whitelist

Ten direct copies have a real production import after K2's first mounted
node/connection slice. The conformance gate
checks each listed consumer/import literal, so a whitelist row cannot become a
fake reference.

| Exact target | Host consumer |
| --- | --- |
| `components/canvas-context-menu.tsx` | `src/kernel-host/kernel-canvas-surface.tsx` |
| `components/canvas-mini-map.tsx` | `src/kernel-host/kernel-canvas-surface.tsx` |
| `components/canvas-node.tsx` | `src/kernel-host/kernel-canvas-surface.tsx` |
| `components/canvas-zoom-controls.tsx` | `src/kernel-host/kernel-canvas-surface.tsx` |
| `components/canvas-resource-mention-textarea.tsx` | transitive from approved `canvas-node.tsx`; references remain host-supplied |
| `constants.ts` | `src/kernel-host/kernel-node-adapter.ts` |
| `lib/image-reference-prompt.ts` | `apps/canvas/lib/image-reference-prompt.ts` |
| `components/vozeb-canvas.tsx` | `src/kernel-host/kernel-canvas-surface.tsx` |
| `utils/canvas-image-data.ts` | `src/kernel-host/retouch-adapter.ts` |
| `lib/canvas-theme.ts` | `apps/canvas/lib/canvas-theme.ts` |

## A2/A3 derivative port

`src/kernel-host/ported/canvas-session-store.ts`,
`src/kernel-host/ported/canvas-connections.tsx`, and
`src/kernel-host/ported/k2-canvas-toolbar.tsx` are the current derivative ports.
Their source and target hashes, pin, A2/A3 addenda, reviewer,
third-party notes, adaptation boundary, and adapter-replacement matrix are
each mandatory `ports[]` fields. The session port owns only ephemeral selection,
panel, toolbar, and viewport state; `CanvasShell` consumes it. The persistent
graph remains the project/revision fact and `fromKernelGraph()` deliberately
drops viewport/session state before `ProjectPersistenceAdapter` calls the
BackendPort.

The connection port preserves the approved SVG geometry and callbacks while
adding the explicit React runtime required by the host. Connection edits still
flow through the kernel graph to the server draft; the port owns no project,
provider, generation, or local persistence behavior.

The K2 toolbar port preserves the approved dock and five node/upload/assets/
appearance/delete/clear actions, while removing the local theme switch that
would conflict with Canvas bootstrap/system appearance authority.

The conformance test covers both directions: an unregistered file under
`kernel-host/ported/`, a target hash drift, an outside target, and duplicated
source/target records fail. Exact-copy replay only removes stale files within
the vendor root and refuses a port target outside the port root.

## BackendPort vNext freeze

`apps/canvas/src/server/backend-port-vnext.ts` is a contract-only module. It
does not advertise unimplemented actions in `CANVAS_ACTION_CONTRACTS`.

| Contract | K1 state | Frozen behavior |
| --- | --- | --- |
| `quoteGeneration` / `submitGeneration` | active additive field | strict `modelId?` now reaches the existing one-item Core quote/submit path |
| catalog defaults | reserved | `defaultModelIdByOperation` plus safe per-operation unavailable reason code |
| prompts/assets/adoption targets | reserved | cursor/query/category-or-kind list request and paginated response contracts |
| export | reserved | revision-bound JSON/ZIP request and export ID response |
| bootstrap | reserved | `workspaceDisplayName` belongs to existing launch/session bootstrap, not a new Canvas auth path |
| generation lineage | reserved | project/revision plus checkpoint, node, or item binding; lineage origin is `advanced_canvas_project_revision` |

Every record names compatibility (`additive-v1`), idempotency, error codes,
Core owner, and a contract test. Checkpoint/node/item fields remain reserved
until shared contracts #141/#142 are actually merged; K1 does not bypass them.

## Batch and settings decisions

K1 chooses **B — fan-out**, because the current Core surface has one
quote/submit/job/reservation lifecycle and no safe aggregate endpoint. The
host ledger has deterministic `batchKey:item:n` item and idempotency keys; the
UI will obtain N independent quotes, show one aggregate confirmation, then
submit/recover every item individually. `generation-batch-contract.ts` is only
that deterministic UI ledger, not a new durable ledger or endpoint.

Parameter disposition:

- Existing Core fields: image width/height/ratio/resolution, video
  duration/ratio/resolution/audio/watermark, text temperature/token limit, and
  audio speech/SFX fields.
- UI aliases only: image quality and audio instruction-to-prompt presentation.
- New fields require a Core capability registry rather than Canvas guessing.
- A count control follows B: N individual calls, not a synthetic batch field.

All five shared controls are **rebuild**, not copy or port:

| Control | Decision | Boundary reason |
| --- | --- | --- |
| Image settings | rebuild | upstream `AiConfig` differs from Core capability facts |
| Video settings | rebuild | upstream Seedance/provider configuration is excluded |
| Audio settings | rebuild | product audio capability and prompt mapping are host-owned |
| Model picker | rebuild | model availability/defaults come from Core catalog |
| Prompt selector | rebuild | A3 forbids importing upstream prompt corpus; use paginated product prompts |

## Runtime and review record

Canvas now declares the K1 runtime versions required by its production-facing
surface: Ant Design 6.4.2, Antd Next registry 1.3.0, React Query 5.90.21,
Zustand 5.0.12, localForage 1.10.0, Lucide 1.16.0, plus direct utility
dependencies. `CanvasRuntimeProviders` supplies the SSR-safe
`AntdRegistry → ConfigProvider → App → QueryClientProvider` chain.

React Query is intentionally pinned to the monorepo's existing 5.90 line: the
upstream 5.100 peer would otherwise make Main Web's router resolve a second
`QueryClient` private type. The K1 provider APIs used here are unchanged, while
the root typecheck remains a single-version proof.

Tailwind 4 is intentionally not introduced in K1: existing Canvas CSS remains
the migration path. Radix is likewise not added because the five controls are
rebuilt on Ant Design rather than copied. `tsconfig.production.json` typechecks
the three whitelisted vendor entries and their real import graph separately
from unmounted vendor inventory. Canvas is its own app entry, so those package
dependencies cannot enter Main Web's initial bundle; K1's route budget is
enforced by `scripts/pro-studio/canvas-bundle-budget.mjs` after a Canvas build
(Main Web 350 KiB gzip remains a separate app budget).

Consumable K1 contracts and tests:

- `copy-manifest.json`, `apply-exact-copies.mjs`, and `conformance-gate.mjs`
- `backend-port-vnext.ts` and `backend-port-vnext.test.ts`
- `generation-batch-contract.ts` and its test
- `ported/canvas-session-store.ts` and its host-only test
- `ported/canvas-connections.tsx` and the K2 kernel surface tests
- `ported/k2-canvas-toolbar.tsx` and the K2 node-adapter tests
- `tsconfig.production.json` and `CanvasRuntimeProviders`

No K1 code changes `apps/core/src/main.ts`.
