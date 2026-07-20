# Capability Registry + Catalog — wiring diff note (Z2-WIRING batch B)

**Tickets:** #121 / J1, #123 / J3  
**Owner of this note:** WT-J (delivered with business files)  
**Consumer:** Z2-WIRING batch B via cross-package frontend integration owner  
**Do not apply in J1/J3** — shared wiring surfaces stay untouched until batch B.

## Delivered in J1 (already on branch)

| Path | Role |
|---|---|
| `src/components/admin/capability/**` | UI skeleton (panorama, six-question detail, metric envelopes) |
| `src/p1/admin-capability-registry-model.ts` (+`.test.ts`) | Pure model: inventory projection, six-question completeness, static dependency lookup |
| `src/p1/admin-capability-registry.tsx` (+`.test.tsx`) | Admin control + SSR markup tests |
| `src/routes/admin/capabilities.tsx` | Route module (page export + provisional `createFileRoute`) |
| `src/routes/admin/-capabilities.route.test.tsx` | Memory-router SSR route test |

## Delivered in J3 (this ticket)

| Path | Role |
|---|---|
| `src/p1/admin-capability-catalog-model.ts` (+`.test.ts`) | Two-level catalog IA projection; seven-page regroup; D-048 ban helpers; redacted handoff |
| `src/p1/admin-capability-catalog.tsx` (+`.test.tsx`) | Catalog control + SSR / D-048 ban assertions |
| `src/components/admin/capability/capability-catalog-panel.tsx` | L1 domains + L2 deps/evidence drilldowns UI |
| `src/components/admin/capability/capability-drilldown-banner.tsx` | Domain context banner for seven regrouped pages |
| `src/routes/admin/capabilities.tsx` | Catalog + registry combined page |
| `src/routes/admin/{models,templates,integrations,plans,redemptions,users,audit}.tsx` | Domain drilldown banner regroup (paths unchanged) |
| `src/routes/admin/redemptions.tsx` | Seventh drilldown page under 账号与商业化 (lean body; Td control wires later) |
| `src/routes/admin/-catalog-drilldowns.route.test.tsx` | Seven-page reachability + D-048 ban + p1 compat |
| `tests/e2e/specs/admin-capability-catalog-ops.spec.ts` | Playwright D-048 daily-ops ban on catalog (requires routeTree registration) |

Hardcoded paths used until batch B lands `Routes.AdminCapabilities`:

- Catalog entry: `/admin/capabilities`
- Seven drilldowns: `/admin/{users,plans,redemptions,models,templates,integrations,audit}`

**Upstream dependency brought into this branch for compile/test (owned by S2a / J1 when their tickets land first):**

- `packages/contracts/src/capability-registry.ts`
- `packages/contracts/src/capability-inventory.ts` (+test)
- `packages/contracts/src/index.ts` exports for the two modules
- J1 `admin-capability-registry-*` + capability UI skeleton under `components/admin/capability/`

## Shared surfaces to wire in batch B

### 1. `src/lib/routes.ts`

Add:

```ts
AdminCapabilities: '/admin/capabilities',
AdminRedemptions: '/admin/redemptions',
```

(alongside existing `AdminModels`, `AdminAudit`, …)

Optional (if batch B centralizes path tokens used by catalog model):

```ts
// Keep existing seven Admin* keys; catalog model can import Routes.*
// instead of hardcoded '/admin/…' strings after batch B.
```

### 2. `src/config/sidebar-config.ts`

- Import new locale message (below) and `Routes.AdminCapabilities`.
- Add admin nav item (suggested placement: first admin item, before models — capability command surface entry):

```ts
{
  title: () => admin_navigation_capabilities(),
  href: Routes.AdminCapabilities,
  icon: /* pick consistent Tabler icon, e.g. IconTopologyStar3 or IconListDetails */,
}
```

Optional IA hint (do not reorder seven leaf items unless product asks): group sidebar labels under L1 domain language, or keep flat list with catalog as the IA entry.

### 3. Locales (`project.inlang/messages/{en,zh}.json`)

Suggested keys (run `pnpm locale:sort` + `pnpm locale:compile` after edit):

| Key | zh | en |
|---|---|---|
| `admin_navigation_capabilities` | 能力目录 | Capability catalog |
| `admin_capabilities_title` | 能力目录 | Capability catalog |
| `admin_capabilities_description` | 两层信息架构：一级=能力域（功能/用户影响）；二级=技术依赖与证据下钻。现有七个管理页按能力域编组，不再是孤岛。 | Two-level IA: L1 capability domains (function / user impact); L2 technical dependencies and evidence drilldowns. Existing seven admin pages are regrouped under domains. |

After locale land, replace hardcoded title/description strings in `src/routes/admin/capabilities.tsx` with paraglide messages. Drilldown banner copy may stay code-local (operator language is product IA, not marketing locale) unless batch B wants full i18n.

### 4. `src/routeTree.gen.ts`

Regenerate only (never hand-edit):

```bash
# from mkfast-template-main — use the project's normal TanStack route generation path
# (dev server / build / router plugin will refresh routeTree.gen.ts)
pnpm dev   # or project-standard route codegen
```

Ensure `/admin/capabilities` appears under admin children and `FileRoutesByPath` includes the path so `createFileRoute('/admin/capabilities')` can drop the provisional cast in `capabilities.tsx`.

### 5. Route module cleanup after codegen

In `src/routes/admin/capabilities.tsx`:

1. Replace `(createFileRoute as any)('/admin/capabilities')` with typed:

   ```ts
   export const Route = createFileRoute('/admin/capabilities')({
     component: CapabilitiesPage,
   });
   ```

2. Swap hardcoded title/description for locale messages once keys exist.

3. Optionally replace hardcoded `/admin/capabilities` and drilldown `href`s in catalog/banner components with `Routes.*`.

### 6. Optional permission / deep-link notes

- Contracts already map `model-supply` query actions `capability_registry` / `capability_inventory` → `system.capability.view` (`packages/contracts/src/capability-permission.ts`).
- Live domain reporters (model-supply / job-runtime OperationalMetric / entitlement-pools) are **not** wired in J1/J3; skeleton uses honest `unknown` envelopes. Batch B only needs navigation/route/locale; API fetch wiring is a later J-series concern.
- D-048 ban is enforced on the **daily ops catalog path** (no code/SQL/env/raw JSON/CLI control surfaces). Existing typed admin controls on seven pages remain; do not introduce banned free-form editors onto the catalog entry.

## Out of scope for this note

- Exception home page (`/admin` redirect change) → J2  
- Supply control center → J4  
- Composer / results / dashboard (#83 WT-C/D) — zero intersection  
- Do not modify `p1.tsx` compat redirect (still resolves to models/templates/integrations)

## Verification after batch B

```bash
pnpm --filter @meiye/web test -- src/p1/admin-capability-catalog
pnpm --filter @meiye/web test -- src/p1/admin-capability-registry
pnpm --filter @meiye/web test -- src/routes/admin/-catalog-drilldowns
pnpm --filter @meiye/web typecheck
# manual: open /admin/capabilities via sidebar → L1 domains → seven drilldowns → audit health block
```
