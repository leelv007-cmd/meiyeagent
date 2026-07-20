# Pro Studio kernel integration V1 acceptance (K01–K11)

Date: 2026-07-19
Working branch at verification: `feat/ux-fold-supply-coldstart`
Spec: `docs/specs/pro-studio-kernel-integration-spec.md`

## Review conclusion

The first K01–K11 implementation was not accepted as complete: unsafe Agent/provider/proxy files were present in the exact-copy set, the copied `VozebCanvas` was not mounted by production code, several adapters were only exercised by isolated tests, upload/crop/generation/adoption were not proven through the UI, and the existing smoke called Canvas APIs directly.

The 2026-07-19 Agent Team review removed those false-positive completion paths and re-ran the work against the public seams. K01–K11 now meet their engineering DoD. This verdict does **not** approve commercial release.

## Ticket-by-ticket result

| Ticket | Result | Current evidence |
| --- | --- | --- |
| K01 | **pass** | Pinned upstream `a2c52c7`; frozen include/exclude inventory; forbidden runtime surfaces excluded. |
| K02 | **pass** | 42-row safe exact-copy set; source/target/SHA/A2/A3 recomputed; stale vendor targets deleted by replay. |
| K03 | **pass** | Production imports the authorized `VozebCanvas`; focusable media-safe nodes, graph-backed text editing, Shift background marquee, equal-delta multi-drag and visible Undo/Redo are mounted outside vendor code and exercised in the continuous browser journey. |
| K04 | **pass** | Production uses `ProjectPersistenceAdapter`; CRUD, draft CAS, checkpoint/restore and refresh recovery are covered. |
| K05 | **pass** | Canvas writes bounded bytes through authenticated Core storage, records workspace-owned receipts, inspects metadata without materializing bytes and reloads delivery URLs after refresh. |
| K06 | **pass** | Square crop persists a child OwnedAsset/node/edge; generation input is frozen from ordered selection + graph edges, and refreshed results write persistent input-to-generated lineage. |
| K07 | **pass** | Image/video/audio node delivery is wired; quote/submit follows catalog activation and remains fail-closed when inactive. |
| K08 | **pass** | Runtime uses `AgentAdapter`; per-operation confirmation, explicit reject and reload-before-replan are tested; audit refresh failure cannot mask a successful apply. |
| K09 | **pass** | Adoption consumes the canvas's ordered selection; the adopted badge and the same Main ContentPackage are verified by UI. |
| K10 | **pass** | A continuous Playwright UI journey covers E1, E2, fixture generation recovery and E4 without direct Canvas action calls. |
| K11 | **pass** | A cookie-clean BrowserContext restores the same server project/media/edges after re-login; product eye-check and screenshot are archived. |

## Browser evidence

- Spec: `mkfast-template-main/tests/e2e/specs/pro-studio-kernel-ui.spec.ts`
- Mode: `MODEL_EXECUTION_MODE=fixture`
- Result: Chromium `1 passed (55.7s)`; test body `23.2s`
- UI path: login → unlock → enter kernel → double-click text edit → dirty beforeunload cancel → save/refresh → upload/Shift-select/connect → square crop (4×2 to 2×2)/derived edge → clear selection on visible canvas space → Shift-drag a visible marquee around exactly two nodes → group-drag both nodes by `+36/+28` → Undo both to origin → Redo both to the shared delta → save/refresh → cookie-clean context re-login and restore → edge-derived generation input with frozen node lineage → checkpoint/quote/submit/worker completion/refresh/insert → persistent source-node generation edge → ordered selection/adopt/badge → same ContentPackage in Main library
- Setup-only APIs: user registration and entitlement unlock. Project, media, generation and adoption operations use visible controls.
- Screenshot: `docs/evidence/pro-studio/kernel-v1-ui-smoke.png`
- Screenshot properties: 1440×900, 142355 bytes, SHA-256 `9f64f936ff786133ebcc66a761ae9a7d7e68744742fe2d4861d76a6e95c8e31b`

## Important defects found and repaired during real UI verification

1. Core had a readable asset route but no production `PUT /v1/assets/:key`; visible upload returned `Canvas action failed.`. The authenticated, workspace-bound write route was restored and its HTTP test changed from 404 to 204.
2. New media nodes overlapped text nodes, blocking ordinary center clicks. New nodes now use a non-overlapping grid verified by a pure-function test.
3. The active model catalog advertised `width/height`, while the strict BackendPort image schema only accepted legacy `ratio/resolution`. The public contract now accepts bounded positive image dimensions and rejects zero, fractions and values above 4096.
4. Modifier-key pointerdown replaced the existing selection before click, so visible Shift multi-select could not connect nodes. Pointer selection now preserves the prior ordered set and prepares the correct drag group.
5. Core accepted generation input assets but omitted them from the public persisted job projection. After refresh the result node lost its lineage. Canonical results now persist ordered input roles and stable node bindings; BackendPort validates bindings against the frozen revision; Core quote/submit and get/list preserve `inputNodeIds`/`maskNodeId` alongside the asset IDs.
6. Node pointerdown accepted non-primary buttons, so middle/right button interaction could enter drag state. Node dragging now starts only for the primary button.
7. Runtime activity refresh depended on the full mutable project object, so pointer moves could trigger repeated jobs/adoptions/audit reads and allow stale responses to overwrite current state. Refresh now depends on stable project identity and uses a latest-request commit gate.

## Product eye-check

- [x] Pro Studio remains outside first-level navigation; Composer is not locked by this pack.
- [x] The authorized infinite canvas is runtime-mounted; the browser journey visibly performs node selection/connection, Shift background marquee, equal-delta multi-drag, Undo, Redo and graph-backed text editing.
- [x] One real retouch class is complete: crop → OwnedAsset → derived node/edge → saved draft → refresh recovery.
- [x] Project, media and edges recover through server-owned facts in a new cookie-clean browser context after re-login.
- [x] Audio/SFX availability is catalog-controlled. Fixture/recorded execution may be active; production without activation evidence is fail-closed.
- [x] The dark studio surface remains visually distinct from the Main application.

## Verification summary

- Canvas full tests: 152 passed, 1 skipped, 0 failed on the final tree.
- Canvas TypeScript: pass.
- Core TypeScript: pass.
- Stable Canvas→BackendPort→Core node-lineage targeted suites: 49 passed, 0 failed.
- Canvas production build: pass.
- Pro Studio conformance/kernel tests: 19 passed, 0 failed.
- K05 selected Core storage/security suites: 33 passed, 0 failed.
- Core generation projection + durable media suites: 52 passed, 0 failed.
- Browser UI journey: 1 passed in 55.7s (test body 23.2s); screenshot archived and visually inspected.

## Still open release gates

- N2 production recovery proof.
- Production security drill and manual approval.
- Pricing approval.
- Upsell validation with real merchant samples.
- Audio/SFX commercial activation and provider evidence where required.

## Verdict

**K01–K11 engineering DoD is complete.** Pro Studio is still **not approved for public sale** until the parent release gates above are closed.
