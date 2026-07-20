# Model supply & gateway control center — wiring diff note (Z2-WIRING batch B)

**Ticket:** #124 / J4  
**Owner of this note:** WT-J (delivered with business files)  
**Consumer:** Z2-WIRING batch B via cross-package frontend integration owner  
**Do not apply shared wiring in J4** — shared surfaces stay untouched until batch B.

## Delivered in J4

| Path | Role |
|---|---|
| `src/p1/admin-supply-types.ts` | Shared snapshot / run / audit types |
| `src/p1/admin-supply-fixture.ts` | Dual-channel presentation fixture (no apps/core import) |
| `src/p1/admin-supply-overview-model.ts` (+`.test.ts`) | Readiness + dual-channel + six-entity + revisions + health/capacity/cost/lifecycle/audit |
| `src/p1/admin-supply-run-table-model.ts` (+`.test.ts`) | Faceted filters + pagination/sort + URL state parse/serialize |
| `src/p1/admin-supply-task-drilldown-model.ts` | Summary / latency / timeline / error / artifact projection |
| `src/p1/admin-supply-association-views-model.ts` (+`.test.ts`) | Five views forward+reverse (model / counterparty-channel / deployment / credential / route) |
| `src/p1/admin-entitlement-status-model.ts` (+`.test.ts`) | EntitlementPolicy / AccountAllocation / SupplyPool status surfaces (H1 consume) |
| `src/p1/admin-supply-control.tsx` (+`.test.tsx`) | Control + SSR markup tests |
| `src/p1/admin-entitlement-status.tsx` | Entitlement status control |
| `src/components/admin/supply/**` | Overview / run table / drilldown / association / control-center panels |
| `src/components/admin/entitlements/entitlement-status-panel.tsx` | Entitlement / pool UI |
| `src/routes/admin/supply.tsx` | Control center route (`/admin/supply`) |
| `src/routes/admin/supply.views.$viewId.tsx` | Five association view routes |
| `src/routes/admin/supply.tasks.$taskId.tsx` | Task drilldown route |
| `src/routes/admin/-supply.route.test.tsx` | Route + five-view + URL state tests |

## Shared surfaces — batch B status

### 1. `src/lib/routes.ts`

Add (if not yet present):

```ts
AdminSupply: '/admin/supply',
AdminSupplyViews: '/admin/supply/views',
AdminSupplyTasks: '/admin/supply/tasks',
```

Optional helpers:

```ts
adminSupplyViewPath: (viewId: string) => `/admin/supply/views/${viewId}`,
adminSupplyTaskPath: (taskId: string) => `/admin/supply/tasks/${taskId}`,
```

### 2. `src/config/sidebar-config.ts`

- Import locale message + `Routes.AdminSupply`.
- Add admin nav item under AI supply domain (after capabilities / before or near models):

```ts
{
  title: () => admin_navigation_supply(),
  href: Routes.AdminSupply,
  icon: /* IconRoute or IconTopologyRing2 */,
}
```

### 3. Locales (`project.inlang/messages/{en,zh}.json`) — **landed (F-J-03)**

| Key | zh | en | Status |
|---|---|---|---|
| `admin_navigation_supply` | 供应控制中心 | Supply control center | **landed** |
| `admin_supply_title` | 模型供应与网关控制中心 | Model supply & gateway control center | **landed** |
| `admin_supply_description` | 总览三模态 readiness… | Overview of tri-modal readiness… | **landed** |
| `admin_exception_home_title` | 异常优先首页 | Exception-first home | **landed** |
| `admin_exception_home_description` | 只读聚合… | Read-only aggregation… | **landed** |

Routes `/admin` and `/admin/supply` consume paraglide keys (no hardcoded Chinese titles).

### 4. `src/routeTree.gen.ts`

Regenerate only (never hand-edit):

```bash
# from mkfast-template-main — project-standard route codegen
pnpm dev   # or build / router plugin
```

Ensure paths:

- `/admin/supply`
- `/admin/supply/views/$viewId`
- `/admin/supply/tasks/$taskId`

Then drop provisional `(createFileRoute as any)` casts in the three route modules.

### 5. Core HTTP / live reporters — **wired (Z2 + F-J-02)**

| Surface | Status |
|---|---|
| `admin_supply_control` snapshot query | **Live** via `useAdminSupplyControlSnapshot` → BFF `queryP1('model-supply')` |
| Run table server pagination / filters | **Live** — URL state → payload.runQuery |
| Credential panel | **Live** projection from snapshot (secret no-echo) |
| Governed quick actions | **Live** via `admin_supply_action_preview` + `admin_supply_action` |
| Route simulator panel | **Live (F-J-02)** — always mounted; idle until `route_simulate`; ready/error from Core preview/execute; fixture keeps demo ready |
| Exception-first home | **Live** pending-actions + OperationalMetric; explicit loading/error (F-J-04) |
| Merchant dual-end labels | **Partial (F-J-01)** — `channelReadiness` badge on `model-settings` ModelCard via `model_card_channel_*` |
| External gateway consoles | Evidence deep-link only (no second business truth) |

### 6. nuqs wiring (optional polish)

Run table pure model already owns parse/serialize. Batch B may bind `nuqs` `useQueryStates` on the control using the same key set in `RUN_TABLE_URL_KEYS`.

## Hardcoded paths until batch B

- Control center: `/admin/supply`
- Association views: `/admin/supply/views/{model,counterparty-channel,deployment,credential,route}`
- Task drilldown: `/admin/supply/tasks/{taskId}`

## J5 delivered (same package; pure presentation + live BFF)

| Path | Role |
|---|---|
| `src/p1/admin-supply-credential-model.ts` (+`.test.ts`) | CredentialAccount UI: 3-state + tested gate + draining, secret no-echo, env_fallback risk |
| `src/p1/admin-supply-route-simulator-model.ts` (+`.test.ts`) | G5 shared explanation projection (simulator ≡ task_audit) + `projectLiveRouteDecision` for BFF payloads |
| `src/p1/admin-supply-quick-actions-model.ts` (+`.test.ts`) | D-070 full governed quick actions: command+permission+preview+audit |
| `src/components/admin/supply/supply-credential-panel.tsx` | CredentialAccount panel |
| `src/components/admin/supply/supply-route-simulator-panel.tsx` | Route simulator panel (idle / error / ready) |
| `src/components/admin/supply/supply-governed-actions-panel.tsx` | Governed actions catalog; lifts `route_simulate` into simulator panel |
| `src/p1/admin-provider-credential-control*` | Evolved: trunk status / activation gate / drain / migration entry |

## Out of scope for this note

- Cloudflare read-only → J6  
- Secret broker / hot assembly domain → Core (not web)  
- Composer / results / dashboard (#83) product worksurfaces beyond model-settings dual-end labels  
- Sidebar `Routes.AdminSupply` nav item (remaining batch B shell wire)

## Verification

```bash
pnpm --filter @meiye/web test -- src/p1/admin-supply
pnpm --filter @meiye/web test -- src/p1/admin-exception-home
pnpm --filter @meiye/web test -- src/p1/admin-entitlement-status
pnpm --filter @meiye/web test -- src/routes/admin/-supply
pnpm --filter @meiye/web typecheck
# manual: /admin → loading then exceptions or empty panorama
# manual: /admin/supply → readiness → route simulator idle → route_simulate → ready panel
```
