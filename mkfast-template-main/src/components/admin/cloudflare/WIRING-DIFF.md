# Cloudflare read-only panel — wiring diff note (Z2-WIRING)

**Ticket:** #126 / J6  
**Owner of this note:** WT-J (delivered with business files)  
**Consumer:** Z2-WIRING batch B (frontend) + batch A (core HTTP if exposing inventory)  
**Do not apply in J6** — shared wiring surfaces stay untouched until Z2.

## Delivered in J6

| Path | Role |
|---|---|
| `apps/core/src/p1/cloudflare-read/**` | Pure domain: REST inventory adapter (query/normalize/cache/freshness/unknown), min permission list, deep-link resolver, self probes, config risks, write-op denials. **No GraphQL.** |
| `src/p1/admin-cloudflare-deep-link.ts` (+`.test.ts`) | Redacted deep-link envelope builder |
| `src/p1/admin-cloudflare-probe.ts` (+`.test.ts`) | Self-probe presentation |
| `src/p1/admin-cloudflare-presentation.ts` (+`.test.ts`) | Business-impact projection; no Queue card; write denials |
| `src/p1/admin-cloudflare-control.tsx` (+`.test.tsx`) | Admin control + SSR tests |
| `src/components/admin/cloudflare/cloudflare-readonly-panel.tsx` | Read-only panel UI |

## Shared surfaces to wire in Z2

### 1. `src/lib/routes.ts`

Add:

```ts
AdminCloudflare: '/admin/cloudflare',
```

### 2. `src/config/sidebar-config.ts`

- Import locale message + `Routes.AdminCloudflare`.
- Add admin nav item under runtime/governance (after audit / capabilities):

```ts
{
  title: m.admin_nav_cloudflare(),
  url: Routes.AdminCloudflare,
  icon: IconCloud,
}
```

### 3. Locale messages (`project.inlang/messages/{en,zh}.json`)

```json
"admin_nav_cloudflare": "Cloudflare 只读",
"admin_cloudflare_title": "Cloudflare 只读运行投影"
```

### 4. Route module (Z2 creates)

`src/routes/admin/cloudflare.tsx` — page that renders `<AdminCloudflareControl />` via `createFileRoute`.

Hardcoded path until then: `/admin/cloudflare` (also used as deep-link `returnTo`).

### 5. Core HTTP (Z2 batch A, optional)

If product admin needs live inventory:

- Mount a **query-only** admin endpoint that constructs `CloudflareInventoryAdapter` with server-held token + verified mapping.
- Never expose `apiToken` to the browser.
- Do **not** mount GraphQL analytics broker (deferred D-080 C3).
- Do **not** register write actions; `assertCloudflareWriteDenied` remains default-deny via capability-permission.

### 6. Env

```
CLOUDFLARE_INVENTORY_READ_TOKEN=  # server only, min-read permissions
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_SCRIPT_NAME=
CLOUDFLARE_MAPPING_VERIFIED=false
```

## Out of scope for Z2 from this ticket

- GraphQL `workersInvocationsAdaptive` trend broker
- Observability Query API (requires Write)
- Any CF control-plane write (deploy/rollback/DNS/WAF/Secret/R2/billing)
- Fictional Cloudflare Queue cards
