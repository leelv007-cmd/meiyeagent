# Creation Catalog Migration Matrix (A1 / #88)

> Reference for C-line tickets (Composer / catalog BFF) and Z1 cutover.
> Design authority: D-078, D-082, D-098 C3 · Spec § Implementation Decisions #3.

## Scope

This document maps the **old Creation Catalog** surface
(`shortcuts` / `templates` / `userTemplates` via operations
`creation_catalog` / `listTemplates`) onto the **new Creation Experience Catalog**
(`CreationRecipeVersion` + `CreationSurfaceRevision`).

Rules:

1. Two same-named catalog entry truths must not coexist after Z1.
2. Frontend `selectedPreset.internalIntent` direct-mutate path is deleted with C1.
3. Lens stays a static enum; ToolEntry stays a static registry seed (no publish lifecycle).
4. Hidden prompts ship only as server `promptRevisionRef` — never prompt bodies.

## Object mapping

| Old object | Old location | New object | Mapping notes | First-wave fate |
|---|---|---|---|---|
| Official template family + published version | `p1_templates` / `p1_template_versions` (CanvasDocument body) | `CreationRecipeVersion` | One published official template version → one Recipe revision snapshot (presentation, lens, delivery defaults, model policy, workflow/prompt/quote refs). Canvas body is **not** copied into Recipe. | **Map & re-author** as Recipe seeds (A2). Old template rows remain historical until Z1. |
| Template shortcut pin | `p1_template_shortcuts` + catalog `shortcuts[]` | `CreationSurfaceRevision.recipeRefs[]` with `featured: true` | Shortcut order → Surface `order`; pin/unpin → featured/visible flags. | **Map** into default global Surface seed (A2). |
| User template | `p1_user_templates` / catalog `userTemplates[]` | — (out of Recipe publish scope) | User-owned drafts are not admin-published Recipes. Future "save as personal recipe" is a separate ticket if product asks. | **Historical only** — keep readable via legacy ops until personal-recipe story exists; not in Surface. |
| Tool rows in frontend `creation-catalog-model` (`copy.generate` / `image.generate` / `video.generate`) | Frontend static `toolEntries()` | ~~`CreativeToolEntry` static seed + `Surface.toolEntryRefs`~~ (retired by D-177 / #419) | Operation ids are not ToolEntry ids. Standalone tools removed entirely. | **Retired** — standalone tool chain deleted by D-177 / #419. |
| Scene / suggestion chips (`SceneVisualButton`, `NAMED_PRESET_CONTRACTS`) | Frontend hardcode | `CreationRecipeVersion` + Surface featured set | Superseded by D-082/D-083/D-084. | **Delete** with C1 (do not port chips). |
| `selectedPreset.internalIntent` | Frontend apply path | Server `RecipePatchPreview` (A2) | Preserve/stash/change; no silent intent overwrite. | **Delete** direct path with C1. |

## Query / API mapping

| Old query / command | Consumer today | New seam | Retire when |
|---|---|---|---|
| `operations` action `creation_catalog` → `{ shortcuts, templates, userTemplates }` | Frontend creation entry / catalog model | `creation-experience` query `surface_browser` (+ nested `recipes`) for published Surface; `lens_list` / `tool_list` for static seeds | After C1/C3 consume new projection **and** Z1 removes dual entry. Until then old query stays read-only frozen. |
| `listTemplates` / template family admin APIs | Admin templates UI, ops tests | Admin "创作入口与模板" visual editor over the Creation Experience Recipe/Surface lifecycle, mounted at `/admin/templates` | Editor shipped; close the Composer-entry dual-write window at Z1. Canvas template admin may remain for Canvas-only assets, not Composer entry. |
| `publishTemplateVersion` / `retireTemplate` | Admin | `recipe_publish` / `surface_publish` / rollback | Composer entry publish moves fully to creation-experience; Canvas publish stays on template versions for canvas documents only. |
| Frontend `projectCreationCatalog(shortcuts, templates, userTemplates)` | Cold-start catalog list | Browser projection from frozen session Surface | C1 rewires; function deleted or reduced to adapter during dual-read, removed at Z1. |

## Field-level Recipe mapping (official templates → Recipe)

| Recipe field | Source in old world | Notes |
|---|---|---|
| `presentation.title/summary` | Template name / family label | Re-authored per D-083 six-card copy in A2 seeds. |
| `lensId` | Inferred from template family / operation | Must be explicit enum (`copy` \| `image_text` \| `video`). |
| `delivery.*` | Hardcoded preset aspect/count/duration | Move into Recipe defaults (D-082). |
| `modelPolicy` | Client default model / NAMED_PRESET | `auto` \| `fixed` + optional `catalogModelId`. |
| `promptRevisionRef` | Inline / implied system prompt | **Ref only** — never body to browser. |
| `workflowRevisionRef` | Implicit workflow | Optional ref; A2 may leave null until workflow catalog ids exist. |
| `quotePolicyRevisionRef` | Client `quoteFor` | Points at product-quote policy revision when B2 lands. |
| `targetWorkspaceKind` | Result workbench mode | Aligns with lens for first wave. |
| Canvas `body` | `p1_template_versions.payload` | **Not mapped** into Recipe. Canvas remains separate artifact. |

## Surface mapping

| Surface field | Old analog | Notes |
|---|---|---|
| `recipeRefs[].recipeRevisionId` | Published template version id | Must be **published** Recipe revision; validate rejects drafts. |
| `recipeRefs[].order` | Shortcut order / chip order | |
| `recipeRefs[].featured` | Shortcut membership | Cold-start six cards = featured ∩ visible. |
| `recipeRefs[].visible` | published && !retired | |
| `recipeRefs[].lensId` | — | Must match Recipe.lensId (validated). |
| ~~`toolEntryRefs[]`~~ | Frontend toolEntries list | Retired by D-177 / #419 — field removed from Surface. |

## Lifecycle & session freeze

| Concern | Old behavior | New behavior |
|---|---|---|
| Publish | Template version publish/canary/retire | Recipe + Surface: `draft → preview → validate → publish → rollback` with CAS `expectedRevision` |
| Config store | Mixed: ops templates + admin-config keys | **Independent** catalog aggregate (not `admin_config_revisions`, not canvas template versions) |
| In-flight drafts | Unclear / client preset id | Session freezes published `SurfaceRevisionId` (+ recipe refs); later publishes affect **new** sessions only |
| Audit | Template publish actor fields | `actorId` / `reason` / `correlationId` on every append |

## Retirement timeline (reference for C / Z tickets)

| Phase | Ticket | Old catalog | New catalog |
|---|---|---|---|
| A1 (this) | #88 | Untouched (frozen ops) | Module + contracts + matrix |
| A2 | #89 | Untouched | Six-card / eight-variant Recipe seeds (`launch-seeds.ts`) + `buildRecipePatchPreview` (D-082/D-083) |
| A3 | #90 | Untouched | Brief trigger projection (`brief-trigger-projection.ts`) + event audit (`creation-experience-events.ts`) |
| C1–C3 | #95–#97 | Read dual optional; prefer new Surface | Composer + mobile catalog consume new projection |
| Z1 | #105 | **Retire** `creation_catalog` dual entry, chip presets, internalIntent path | Sole entry truth |

## Non-goals (explicit)

- No Lens/Tool publish lifecycle (D-098 C3).
- No second config runtime / no writes into `admin_config_revisions` for catalog combos.
- No Postgres repository in A1 (memory repo + contract tests; persistence ticket later if needed).
- No wiring into `apps/core/src/main.ts` or `OperationsApplicationService` (integration owner).

## Import path for consumers

- Contracts: `@meiye/contracts` → `creation-experience` exports (already re-exported by S1).
- Core module (tests / future BFF): `apps/core/src/p1/creation-experience/**`.
- This matrix: `apps/core/src/p1/creation-experience/migration-matrix.md` (also referenceable as docs path via repo-relative link from C-line tickets).
