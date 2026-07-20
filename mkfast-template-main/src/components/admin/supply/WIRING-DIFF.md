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

## Shared surfaces to wire in batch B

### 1. `src/lib/routes.ts`

Add:

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

### 3. Locales (`project.inlang/messages/{en,zh}.json`)

| Key | zh | en |
|---|---|---|
| `admin_navigation_supply` | 供应控制中心 | Supply control center |
| `admin_supply_title` | 模型供应与网关控制中心 | Model supply & gateway control center |
| `admin_supply_description` | 总览三模态 readiness、双渠道覆盖、运行表与任务下钻、五关联视图与权益池状态。外部网关 Console 仅作技术证据深链。 | Overview of tri-modal readiness, dual-channel coverage, run table and task drilldown, five association views, and entitlement/pool status. External gateway consoles are evidence deep-links only. |

After locale land, replace hardcoded title/description in `supply.tsx`.

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

### 5. Optional Core HTTP (Z2 batch A)

- Mount typed admin query for expanded supply registry + runs + entitlement status.
- Never expose credential secrets; metadata only.
- External gateway consoles remain deep-link only (no second business truth).

### 6. nuqs wiring (optional polish)

Run table pure model already owns parse/serialize. Batch B may bind `nuqs` `useQueryStates` on the control using the same key set in `RUN_TABLE_URL_KEYS`.

## Hardcoded paths until batch B

- Control center: `/admin/supply`
- Association views: `/admin/supply/views/{model,counterparty-channel,deployment,credential,route}`
- Task drilldown: `/admin/supply/tasks/{taskId}`

## J5 delivered (same package; pure presentation until Z2)

| Path | Role |
|---|---|
| `src/p1/admin-supply-credential-model.ts` (+`.test.ts`) | CredentialAccount UI: 3-state + tested gate + draining, secret no-echo, env_fallback risk |
| `src/p1/admin-supply-route-simulator-model.ts` (+`.test.ts`) | G5 shared explanation projection (simulator ≡ task_audit) |
| `src/p1/admin-supply-quick-actions-model.ts` (+`.test.ts`) | D-070 full governed quick actions: command+permission+preview+audit |
| `src/components/admin/supply/supply-credential-panel.tsx` | CredentialAccount panel |
| `src/components/admin/supply/supply-route-simulator-panel.tsx` | Route simulator explanation panel |
| `src/components/admin/supply/supply-governed-actions-panel.tsx` | Governed actions catalog panel |
| `src/p1/admin-provider-credential-control*` | Evolved: trunk status / activation gate / drain / migration entry |

## Out of scope for this note

- Cloudflare read-only → J6  
- Live Core fetch / secret broker / hot assembly wiring → Z2  
- Composer / results / dashboard (#83) — zero intersection  

## Verification after batch B

```bash
pnpm --filter @meiye/web test -- src/p1/admin-supply
pnpm --filter @meiye/web test -- src/p1/admin-entitlement-status
pnpm --filter @meiye/web test -- src/routes/admin/-supply
pnpm --filter @meiye/web typecheck
# manual: /admin/supply → readiness cards → run table share URL → five views → task drilldown
```
