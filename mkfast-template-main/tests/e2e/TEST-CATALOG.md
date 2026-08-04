# E2E Test Catalog

This catalog is the acceptance checklist for Playwright E2E coverage. Update it
before or alongside feature work, then use the implemented spec files to lock in
the verified behavior.

> **权威口径提示（2026-07-17 起）**：本目录如实记载现有代码的回归测试合同，继续作为实现层回归保护；但其中「固定三候选 / 3 选 1」相关合同（§12.4、§14.1、§17.1/3/4/6、文末 P0 golden journey 的 three copy candidates），作为**产品验收口径**已被 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md` D-023 显式取代——默认交付一个可直接采用的主推荐，备选仅在用户主动查看或主观方向确有分歧时按需展开（不超过两个）。前台整体形态后续将按 D-029/D-031/D-032/D-033 重构（Composer 主轴、无槽位填表、三进三出合同）；升级 B 期其余合同未被显式宣布取代（见 CONTEXT.md：ADR-0010 除候选政策外仍为升级方向权威）。新增功能的 Spec 步骤不得再以「3 选 1」为验收旅程模板；存量 spec 在对应界面完成重构前保留为回归保护。

## Workflow

Use the local feature flow:

```txt
Spec -> Code -> Verify -> Test -> Green
```

1. Spec: add or update the relevant journey in this catalog.
2. Code: implement the feature.
3. Verify: run the app and walk the real UI in a browser.
4. Test: add or update the matching Playwright spec.
5. Green: run the related spec locally; run full E2E before releases or large
   refactors.

E2E tests remain local-first during feature work. The full suite also runs in
the `Core quality` workflow when manually dispatched or when a pull request has
the `run-e2e` label. This opt-in gate provisions PostgreSQL and boots the real
Main, Core, and Worker harness without making every ordinary pull request wait
for the multi-service browser suite. A catalog row marked `MISSING SPEC` is an
acceptance intent, not executable coverage.

## Test Harness

- Config: `playwright.config.ts`
- Specs: `tests/e2e/specs/`
- Fixtures: `tests/e2e/fixtures/`
- Test-only APIs: `src/routes/api/e2e/users.ts`

The test-only API is disabled unless Vite is running locally with
`import.meta.env.DEV === true`, `MODE=e2e`, and the request includes the
configured `x-e2e-secret` header. Test accounts must use the
`e2e-*@example.test` email pattern so cleanup stays scoped.

## 1. Public Page Smoke Test

**File:** `specs/public-pages.spec.ts` | **Priority:** P0

Verifies that public pages render in English/Chinese and dark/light mode without
browser console errors or page errors.

| # | Test name | Flow |
|---|---|---|
| 1 | Public pages render successfully | Open `/`, `/pricing`, `/contact`, `/cookie`, `/privacy`, `/terms`, `/auth/login`, `/auth/register`, `/auth/forgot-password`, and `/auth/reset-password` for `en` and `zh`, in `dark` and `light` mode. Verify each returns 2xx, renders a visible body, applies the requested theme, and emits no browser errors. |
| 2 | Home 登录 links to the login page | Open `/`, click the landing header 登录 link, verify navigation to `/auth/login` with credential inputs visible, and assert no browser errors. |
| 3 | Retired starter and AI demo routes stay unavailable | Open `/ai`, `/about`, `/blog`, `/blog/getting-started`, `/changelog`, `/roadmap`, and `/waitlist` in `en` and `zh`; verify each returns the branded 404 surface without a generation form or template-brand residue. |
| 4 | Health check responds with pong | Call `/api/ping` and verify `{ "message": "pong" }`. |

## 2. Authentication And Protected Routes

**File:** `specs/auth.spec.ts` | **Priority:** P0

Verifies login and route protection with real Better Auth endpoints and seeded
verified users.

| # | Test name | Flow |
|---|---|---|
| 1 | Guests are redirected from dashboard | Open `/dashboard` while signed out, expect redirect to `/auth/login`, and verify the email input is visible. |
| 2 | Verified user can sign in | Create an E2E user, mark it verified, sign in through `/auth/login`, and verify dashboard content. |
| 3 | User can register from UI | Fill `/auth/register`, verify the registration success message, mark the test account verified, sign in through `/auth/login`, and verify dashboard content. |
| 4 | Non-admin cannot view admin pages | Sign in as a non-admin user, open `/admin/users`, and expect redirect to `/dashboard`. |
| 5 | Admin can view users dashboard | Sign in as an admin E2E user, open `/admin/users`, and verify the users dashboard shows the admin email. |

## 3. Protected Page Smoke Test

**File:** `specs/protected-pages.spec.ts` | **Priority:** P0

Verifies authenticated app pages render in English/Chinese and dark/light mode
without browser console errors or page errors.

| # | Test name | Flow |
|---|---|---|
| 1 | Protected pages render successfully | Sign in as an admin E2E user, then open the canonical dashboard task/asset pages, all six admin pages, and the account/models/connections settings pages for `en` and `zh`, in `dark` and `light` mode. Verify each returns 2xx, renders a visible body, applies the requested theme, and emits no browser errors. |

## 4. Profile Settings

**File:** `specs/settings-profile.spec.ts` | **Priority:** P1

Verifies the signed-in profile update flow.

| # | Test name | Flow |
|---|---|---|
| 1 | User can update display name | Sign in, open `/settings/account`, change the name, save, verify success toast, and reload to verify persistence. |
| 2 | Merchant credit billing and details stay merchant-safe | `specs/merchant-credit-billing-details.spec.ts` signs in through the browser, seeds only via the E2E-gated authenticated backend fixture, then opens the production aliases `/settings/credits` and `/settings/billing`. It verifies the issued billing period, FEFO batch associations for reservation, settlement, credited and expired-uncredited refunds, and expiry, with no task, lot, payment-provider, correlation, or actor identifiers. Guests receive 404 without the E2E secret and 401 without a session. |

## 5. Runtime Tracer

**File:** `specs/runtime-tracer.spec.ts` | **Priority:** P0

Verifies the Workers App Shell to Node Core health seam before product
workflows depend on it.

| # | Test name | Flow |
|---|---|---|
| 1 | User can verify Core service health | Sign in, open `/dashboard`, run the health check, and verify the Core service reports healthy. Content generation is exercised through the ModelSupply product path instead of a second diagnostics runtime. |

## 6. PWA And Mobile Media Primitives — retired

**Retired 2026-07-26 (T07 / #201).** `src/components/pwa` and `src/routes/pwa-proof.tsx`
are bucket-matrix §1A delete-now rows (PROD-gated dev-only proof, no production
surface built on it), so `specs/pwa-media-primitives.spec.ts` was removed with its
subject. The merchant-facing camera contract stays covered by
`specs/mobile-product-shell.spec.ts` (§15), which asserts the product surface's
`capture="environment"` input rather than the retired proof page.

## 7. P1 Recorded-Provider Journey

**File:** `specs/p1-recorded-journey.spec.ts` | **Priority:** P0

Verifies the P1 control plane through the real App Shell and deterministic Core
adapters, without external model credentials.

| # | Test name | Flow |
|---|---|---|
| 1 | User can complete the P1 recorded-provider journey | Choose an available image model through the current-session radio group; confirm store facts, submit a current Composer image-text recipe, and adopt its completed ContentPackage in Result Center; recover the completed work through the dashboard's current Continue section; then verify canonical search survives reload. |

## 8. Task Source Navigation

**File:** `specs/task-source-navigation.spec.ts` | **Priority:** P1

Verifies that Operations tasks retain a direct link to their authoritative
Product object instead of treating opaque IDs as full-text search terms.

| # | Test name | Flow |
|---|---|---|
| 1 | Content and asset task sources open the exact object | Create Product content and asset records, attach Operations tasks, then open each source link. Verify the content card or asset card is selected and highlighted. Attempt foreign-workspace IDs and verify the current workspace shows an explicit not-found state without a global-search fallback. |

## 9. P1 Integration Product Journeys

**File:** `specs/p1-integrations-journey.spec.ts` | **Priority:** P0

Verifies that recorded integrations are usable through the real settings UI
without exposing credentials or silently falling back to another provider.

| # | Test name | Flow |
|---|---|---|
| 1 | Recorded integrations stay usable and honestly labeled | Create a write-only workspace BYOK connection with an explicit capability request, receive the pending-verification acknowledgement, and confirm the key is cleared from the form. Published Feishu tool lifecycle is governed by the separate admin control surface rather than a merchant connection-card assertion. |

## 11. S1 Product Shell And Canonical Routes

**File:** `specs/uiux-shell-routes.spec.ts` | **Priority:** P0

Locks the one-time shell cutover before feature surfaces move onto the canonical
object graph.

| # | Test name | Flow |
|---|---|---|
| 1 | Product shell exposes the whole business navigation | Sign in as an admin, verify every business destination — 创作／内容／素材／门店／记忆, the fifth added by D-164④ — appears once and in the frozen order, settings stays in the utility area, the locked product brand and guide tokens are active, light-mode action text and page focus use accessible tokens, a real Tab-focused control retains a visible high-contrast sidebar ring, and admin mode is reachable only from the user menu. |
| 2 | Canonical routes survive deep links and reloads | Open Content, Assets, Recent activity, Work history, Memory, Session, Work, Job, settings, and six admin routes directly. `/dashboard?view=` is among them as a redirect: D-164① stopped it rendering a history page in place of the workbench, so the assertion is that an old link still lands on the route that owns the view. reload each route and verify its canonical heading remains available. The retired Lead detail route is intentionally absent. |
| 3 | Legacy routes only redirect through the frozen allowlist | Open legacy files, API key, profile, integration, and P1 admin locations; verify each lands on its fixed canonical destination without accepting an arbitrary return URL. |
| 4 | Admin authorization fails in both navigation and routing | Sign in as a non-admin, verify no management entry is rendered, open an admin deep link, and verify the server redirects to the workbench. |
| 5 | Shell remains keyboard and 200-percent-zoom reachable | At the 640px effective viewport, verify no horizontal overflow, focus the skip link first, activate it, and confirm focus returns to the product content region. |
| 6 | Collapsed sidebar links keep their accessible names | Collapse the desktop sidebar, wait for the first business-navigation label to finish its delayed `visibility:hidden` transition, then verify the four business links and settings link still expose their exact visible names. |

## 12. Retired Unified Creation Loop Disposition

**File:** `specs/uiux-creation-loop.spec.ts` | **Priority:** P0

The old S2 workbench was removed by the Z1 cutover. Six cases that entered
through `建立创作记录` / `创作助理整理的记录` or asserted the retired
`ContentPackageDetail` were removed in #242 instead of being skipped or made to
pass by restoring dead UI. Their live contracts remain on these shipped seams:

| Retired case | Current contract owner |
|---|---|
| Adding a source derives a new current Work | `apps/core/src/p1/operations/creative-work.test.ts` owns source inheritance and derivation; `specs/image-intent-service-journeys.spec.ts` proves submitted source counts on the current Composer HTTP/SSE seam. |
| E1 reuses the existing Task without copying it | The retired workbench Task picker no longer exists. Task references remain an Operations contract in `apps/core/src/p1/operations/http.test.ts`; current Composer source lineage is covered by `specs/image-intent-service-journeys.spec.ts`. |
| Composer uploads, drops, pastes, and removes image references | The retired upload-card IA is not restored. Current media journeys authorize their source slot before submission in `specs/m04-browser-hard-gate.spec.ts`, while source lineage and generated owned Assets are asserted in `specs/image-intent-service-journeys.spec.ts`. |
| Explicit contract adopts copy, attaches generated media, and preserves one ContentPackage | `specs/m04-browser-hard-gate.spec.ts` owns Composer → Result Center adoption and delivery; `specs/image-intent-service-journeys.spec.ts` owns generated media and three variants; `specs/works-reshell.spec.ts` owns canonical Works detail and export; `specs/t39-r-gate-journey-matrix.spec.ts` owns delivery, publication feedback, and reload. |
| Reload and derivation preserve the object graph | Current reload recovery is required by `specs/m04-browser-hard-gate.spec.ts` and `specs/t39-r-gate-journey-matrix.spec.ts`; derivation invariants stay at the Operations seam in `apps/core/src/p1/operations/creative-work.test.ts`. |
| Recorded-only model stays unavailable and cannot submit | Recorded-only deployments are removed from the public catalog by `src/p1/settings-view-model.test.ts`; `src/product/composer/quote-readiness.test.ts` owns the current Composer unavailable state, and `specs/m04-browser-hard-gate.spec.ts` proves the positive executable-model path. |

The two still-live Day-0 cases remain in this file and are catalogued in §25.

## 14. Keyboard Governance

**File:** `specs/uiux-keyboard-governance.spec.ts` | **Priority:** P0

Verifies that the core creation decision and high-impact governance confirmation
remain operable without pointer input.

| # | Test name | Flow |
|---|---|---|
| 1 | Keyboard completes the core creation journey and announces Job status | Create a Work, confirm and submit the generation contract, wait for an announced terminal Job state, focus candidate A, select it with Space, and activate the single “adopt selected copy” action with Enter. |
| 2 | Impact Dialog traps focus and returns it to the keyboard trigger | Open a template release impact dialog with Enter, verify focus starts on the audit reason, remains trapped while tabbing, closes with Escape, and returns focus to the release trigger. |

## 15. Mobile Product Surfaces

**File:** `specs/uiux-mobile-secondary.spec.ts` | **Priority:** P0

Verifies the mobile action book, upload recovery, desktop relay, and touch-target
contract across the supported compact viewports.

| # | Test name | Flow |
|---|---|---|
| 1 | Mobile action book remains readable and reachable | Open the action book at 320×720, 360×800, 379×820, 390×844, 430×932, and 844×390; verify the three stage controls and five-slot task navigation render without horizontal overflow and every stage target is at least 48px high. |
| 2 | Interrupted upload resumes one durable asset | Drop the first upload response after persistence, retry the same file, and verify exactly one Product Asset and one storage row remain after reload. |
| 3 | Mobile settings and admin deep links relay to desktop | Open model settings and admin routes on mobile, verify the compact desktop-relay explanation, and return safely to the action book. |
| 4 | Desktop secondary surfaces retain their ownership boundaries | Verify account models/BYOK, external connections, six admin routes, impact dialogs, and deliverable-output usage copy on a desktop viewport. |
| 5 | Admin activation canary exposes its local evidence seam | Open the admin model control plane and verify the configure-to-evidence onboarding, one explicit action per declared model operation, and the persistent provider-cost and evidence-detail columns. This browser check remains fixture/local and makes no provider call. |

## 16. UI/UX Upgrade B Composer Contracts

**File:** `specs/uiux-upgrade-b-composer.spec.ts` | **Priority:** P0

Locks the aggregate composer contracts that connect cold-start guidance,
progressive execution controls, content suites, and the cross-page command
palette without introducing hidden business writes.

| # | Test name | Flow |
|---|---|---|
| 1 | Failed projection keeps the editable intent until an explicit retry | Replace the first creative-workbench projection with a sanitized 503, verify the friendly failure surface does not leak the upstream secret, type an intent while failed, explicitly retry, and verify the same editable intent survives recovery. |
| 2 | Today suggestions and scene chips prefill an editable intent without writes | In an empty workspace, click one “今日建议” card and one scene chip, verify each inserts a real intent and leaves it editable, then prove no Work or Job was created. |
| 3 | Edited intent and explicit mode persist only after Work creation | Edit a suggested intent, switch to direct mode, prove the draft creates no business object, explicitly create the Work, and verify the saved intent and mode. |
| 4 | Named preset moves focus from the hidden prompt to material guidance | Choose Before/After and Price Card in turn, verify the free-form prompt leaves the accessibility tree, the relevant material instructions appear, and focus moves to the image-material region. |
| 5 | Named preset opens a progressive composer with one explicit model and an editable content suite | Choose a named preset and verify the free-form prompt disappears, create one Work, verify professional controls are collapsed by default, expand the rich model cards and keep exactly one explicit model selected, then verify the preset’s default content modules, one toggle, and the resulting ordered suite summary. |
| 6 | Shelf and global add-to-creation share the inheritance confirmation | Open the same source from the contextual shelf and global palette, verify both paths show five inheritance choices with the same four checked defaults, and prove no hidden write occurs before confirmation. |
| 7 | Global palette returns an add-to-creation action without creating a Work or Job | From the first-level Asset page, open the global palette with both `Cmd+K` and `Ctrl+K`, verify the navigation and add-to-creation groups, add the copy tool in one click, return to the workbench with the pending action, and prove no Work or Job was created. |
| 8 | Empty workbench leads with one editable request and one primary action | Open an empty workspace, verify the editable request appears before template choices and read-only “今日建议”, and require exactly one visually primary action before any Work is created. |
| 9 | XHS note generation exposes role and thinking only in free mode | Apply the XHS note recipe, switch to free mode, verify the role and thinking controls are interactive, then prove customized mode and a non-note lens hide the controls. |

## 17. UI/UX Upgrade B Result Contracts

**File:** `specs/uiux-upgrade-b-results.spec.ts` | **Priority:** P0

Locks the remaining result-stage contracts for Harness workflow-token results,
candidate batch boundaries, canonical media presentation, and English route
consistency. D-118 retires the standalone copy-stream transport and its
start/stop probes; incremental copy candidates now arrive only through the
shared Harness workflow event stream.

| # | Test name | Flow |
|---|---|---|
| 1 | The completed copy batch remains a single-choice flow on mobile | Complete one copy batch on desktop, switch to the mobile Progress stage, verify exactly three radios and one checked choice, keep the sticky adoption action enabled, and prove the page does not overflow. |
| 2 | Creation assistant streams rich text and exposes local-only patch controls | Send one assistant request, verify partial text and rich Markdown arrive before completion, inspect the current Work context, edit and locally accept one structured field patch, and prove the Work intent is not silently overwritten. |
| 3 | Single selection, paid reroll, and two free quality retries keep separate usage boundaries | Generate the first three-candidate batch, switch between A and C while keeping exactly one selection, explicitly confirm a paid reroll and verify one-unit usage, then use both zero-unit quality retries, verify the `0/2 -> 1/2 -> 2/2` boundary, and prove a third free retry is disabled without changing the fixed model. |
| 4 | Successful image media opens the lightbox and the same canonical Asset detail | Complete one real fixture-backed image Job, reload its persisted result, open the rendered media in the lightbox, prove previewing creates no Content or duplicate objects, then follow the detail link and verify the same canonical media source appears on its detail route, Asset library, and the formal Recent/history owning surface. |
| 5 | English locale retains route context and keeps empty product chrome free of Chinese leakage | Switch an empty Asset page to English while preserving path, query, hash, and login state; verify English chrome contains no Chinese at all, nor internal model/template residue, reload without losing locale, and navigate to the English Content page without dropping the `/en` prefix. |
| 6 | Completed result becomes the stage and keeps its visible intent legible on mobile | Complete one copy Work, verify the result hero is visually ahead of professional settings and reuse, require the submit composer and Operations rail to leave the completed stage, then switch to mobile Progress and verify the visible intent and candidate result remain visible. |
| 7 | Image-text export receipts download the generated ZIP | Export an accepted image-text ContentPackage, open its successful receipt, and verify the authenticated BFF returns the exact workspace-scoped generated ZIP without accepting a composed ZIP or a disguised extension. |
| 8 | Lost export and reuse responses retry the same intent once | Drop the first export and reuse responses after submission, retry each unchanged action, and verify each retry reuses its original idempotency key while the two different intents never share a key. |
| 9 | Slow platform generation cannot overwrite a newer package version | Hold the three-platform provider response, save a new current ContentPackage version, release the stale provider result, and verify the command reports a version conflict without attaching any stale platform variant. |
| 10 | Primary image-text creation adopts authorized store photos into one package | Start from the two product choices “Create image post” and “Create video,” create an image-text Work with an authorized real store photo, select one copy candidate, keep the referenced photo in the ordered visual list, adopt once, and verify the ContentPackage is immediately visible without any CreativeContent write. |
| 11 | **MISSING SPEC:** Trace-backed recommendation defaults to one result with optional alternatives | After the production harness persists `recommendedAssetId` and its complete DecisionTrace, open the completed result and verify only that candidate is selected and visible as the primary recommendation; verify all seven explanation fields, expand no more than two distinct alternatives on demand, adopt the default without a mandatory selection step, and retain the existing paid reroll and two zero-unit quality retries. A legacy Job without both recommendation facts must keep the existing candidate regression UI and must never label A or the first item as primary. |

## 18. UI/UX Upgrade B Asynchronous Job Contracts

**File:** `specs/uiux-upgrade-b-async.spec.ts` | **Priority:** P0

Locks automatic image-Job observation, cross-route task recovery, honest elapsed
time, unread completion, and one-click return without fake percentage progress.

| # | Test name | Flow |
|---|---|---|
| 1 | One image Job remains observable across routes and completes without manual refresh | Gate the submit and provider-query boundaries long enough to observe the submitting and running states, leave the Work for the Asset page, inspect the global task center on desktop and mobile, release the real query, verify exactly one automatic resume and one completed Asset, then return to the same canonical Job. |
| 2 | **MISSING SPEC:** Workflow SSE survives BFF transport, reconnects by stable cursor, and falls back temporarily | Start a non-terminal video workflow, observe named `workflow.progress` and `workflow.state` frames through the authenticated BFF without buffering, disconnect after a captured stable event ID, reconnect with the same cursor and verify no duplicate revision plus the final authoritative state. While the stream is unavailable, verify the existing five-second snapshot query resumes; after SSE reconnects, verify polling stops and the same five-step video panel continues from its cached `VideoWorkflowEnvelope`. |

## 20. UI/UX Upgrade B I18n, Motion, And Mobile Contracts

**File:** `specs/uiux-upgrade-b-i18n-motion.spec.ts` | **Priority:** P0

Locks clean-visit Chinese defaults, bidirectional product-copy convergence,
route-safe locale switching, public model metadata, real publication motion,
and complete touch-target audits at the two target mobile viewports.

| # | Test name | Flow |
|---|---|---|
| 1 | A clean first visit and authenticated workbench default completely to Chinese | Clear locale cookies, open the unprefixed login route, verify the Chinese locale and system copy, sign in, and verify the unprefixed workbench remains Chinese with only explicit product vocabulary and user data excluded from the Latin-copy scan. |
| 2 | English core product surfaces expose no Chinese system copy | Open the English workbench, assets, content, and store routes; remove only approved pass-through names and verify no Chinese system copy remains. The retired Lead ledger route is intentionally absent. |
| 3 | Language switching preserves route, query, hash, session, and one-language copy in both directions | Switch an authenticated Asset URL from Chinese to English and back, reload between changes, verify the path, query, hash, and session remain intact, then scan the returned Chinese surface for stray English system copy with a small explicit vocabulary allowlist. |
| 4 | Model cards retain public metadata while hiding internal identifiers | Visit the English model settings for copy, image, and video; verify each tab has selectable public cards and no recorded deployment, internal model, placeholder-version, or undefined identifier leaks. |
| 5 | Reduced motion keeps the real pending-generation accent readable and static at the 18px desktop root | Verify desktop product typography, create one Work, discover and submit its real execution action, hold it pending, and prove the reduced-motion accent keeps readable static text without animation or gradient transparency. |
| 6 | A real manual publication transition celebrates once and stays static under reduced motion | Create an accepted Product content item and L3 package through the mobile UI, report “not published” through the real handoff page and verify no celebration, report “published,” sync the mobile Product state through a real upload, verify exactly one readable celebration with hidden particles, then reload and verify it does not replay. |
| 7 | The 379x820 mobile product keeps every visible target usable in all three stages and both locales | At 379x820, verify 18px product typography and no overflow, then scan every visible Action, Progress, and Handoff control in Chinese and English for a minimum 48x48px hit area; exclude only inline prose links whose target follows text-flow spacing. |
| 8 | The 390x844 mobile product keeps every visible target usable in all three stages and both locales | Repeat the complete bilingual three-stage target, typography, and overflow audit at 390x844 and retain separate Action, Progress, and Handoff evidence frames. |

## 21–23. Pro Studio journeys — RETIRED (D-170)

Pro Studio product surface, entitlement checkout, Canvas harness journeys, and
security drills were removed under
`docs/specs/pro-studio-retirement-spec-2026-08-01.md` P1 fail-closed.
Specs `pro-studio-*.spec.ts` and fixture `fixtures/pro-studio.ts` are deleted.
Do not re-add catalog rows that treat `/pro-studio` or Canvas as product paths.

## 24. Marketing Entry Gates And Blocking Question

**File:** `specs/marketing-composer-harness.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Only complete marketing entries switch the canonical Composer context | Seed one D-023-complete entry and one entry missing any single MarketingPackage capability; open the canonical dashboard, verify only the complete entry is visible, click it, and verify the editable intent plus recommended tools change in place without navigation or a field form. Legacy scene chips appear only as secondary choices under the released parent. |
| 2 | One server-owned interaction persists and resumes the harness | Start a Harness task with one missing authoritative fact, follow its stable SSE progress into `suspended`, render exactly one inline interaction card, answer it, and require the request-bound interaction response to carry its revision and resume coordinates. Reload to prove the interaction is no longer pending and follow the same SSE stream through resumed progress to the delivered ContentPackage revision. Replaying the same answer is idempotent; a stale revision and a changed target both return 409. |
| 3 | Resumed durable interactions render and submit through Composer | Restore one active Harness task from Core; render its grouped ask-merchant request ahead of the legacy QuestionCard, acknowledge the mounted renderer, choose the merchant-visible label without leaking its description into the answer, and submit the request-bound revision and resume coordinates. Then render the frozen execution confirmation, reject it without inventing feedback, surface the dedicated waiting-message card, submit one trimmed continuation message against its exact identity, and remove each settled card without navigating away from the current Work. |

## 24b. W01 Store Intake Fact Wiring

**File:** `specs/w01-storefact-wiring.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | One inline confirmation reaches the customized delivery context without erasing the store profile | Create one legacy StoreProfile with two accounts and two confirmed projects, prove its public active-fact ledger is empty, then use the visible ProgressiveFactCard to explicitly reconfirm the first project name, change its price, and answer how long that price runs (#244 — the confirm button does not appear until it is answered). Require exactly one `asset-memory.finalize_store_intake` request, two revision-1 merchant-confirmed facts, and preservation of the second project, accounts, compliance flag, prohibitions, and all untouched profile fields. Submit a customized copy journey, read the resulting ContentPackage and its exact public ContextBundle revision, and prove the service and price revisions are frozen as `current_fact` / `store_personal` with matching source, expiry, references, and package fact evidence. |
| 2 | A fact-free image-text recipe completes with confirmed facts in the ledger | After the preceding W01 journey has publicly confirmed and read back the service and price facts, open a fresh Composer page in the same signed-in browser context. Explicitly select `recipe.case_to_xhs_note`, whose `factTypes` contract is empty, authorize its source image, and require the real fixture-backed image-text journey to reach a usable result without referencing the ledger facts outside its empty authorization set. |

## 24c. W02 Five-Step Store Intake

**File:** `specs/w02-five-step-intake.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | A price-list photo becomes a confirmed store fact, and its origin is never hidden | Seed a legacy StoreProfile with an empty fact ledger, open the store page wizard, rotate the platform sample, upload a price-list photo through the newly exposed workspace asset `PUT` (objectKey + sha256 + sizeBytes), run `parse_single_asset`, and require the server draft to come back `parsed` with a `photo_extract` field. Prove the extracted price is prefilled, badged "照片识别", and still marked unconfirmed until each field is explicitly confirmed, and that a photo-read price cannot be saved until the merchant separately says how long it holds (#244); then require exactly one `asset-memory.finalize_store_intake`, a revision-1 price fact of 239 CNY in the public ledger, a store-name fact, and preservation of the untouched profile fields. |
| 2 | A failed read hands the merchant the same schema to type in | Inject a single `parse_single_asset` failure, prove the wizard surfaces an honest failure with a one-click switch, then require the real `prepare_manual_asset_draft` round trip to return a `manual` draft whose fields carry the same `store.profile.*` / `service.*` keys the parse lane maps from, every one `user`-provenance and `unconfirmed`. |
| 3 | A work photo is classified into one of the four contract slots, with a rights reminder that does not block | Switch the intake target to the visual-asset lane, upload a photo without answering the rights prompt, and require `parse_single_asset` to return a `visualClassification` whose slot is a member of `VISUAL_ASSET_SLOTS` and whose `rightsPrompt.blocking` is `false`. Prove the slot badge and the rights reminder are rendered, and that a classification writes nothing to the fact ledger. |
| 4 | Details entered before the ledger existed are staged for confirmation, never promoted | Seed a two-project legacy profile, open the store page, and require the D-151③ import panel to stage the second project as well as the first while the active-fact ledger stays empty. Confirm the staged candidates and require revision-1 facts whose `source.kind` is `import`, including the fulfillment booking value the progressive card could never reach. |
| 5 | The upload channel only accepts an object that names its own bytes | Log in, open the store page, and drive the workspace asset `PUT` directly from the authenticated page. Require the honest `intake-<sha256>.png` write to succeed, a free-form `canvas/assets/cover.png` write to be refused (403) even though the same key is readable, another workspace's prefix to be refused (403), and an `intake-<sha256>` key whose digest does not match the bytes to be refused (400). The 25 MiB ceiling is covered at unit level (`src/lib/core-client.test.ts`) because a browser cannot forge `Content-Length` and streaming 25 MiB per run is not worth the wall clock. |
| 6 | `MISSING SPEC` — the assets page entry runs the same five-step wizard | The wizard is mounted on `/dashboard/assets` (`routes/dashboard/assets.tsx`) and covered only by its mount code plus interaction tests; no Playwright journey walks intake from that entry yet. |
| 7 | `MISSING SPEC` — a W02-confirmed fact reaches the delivery ContextBundle as `current_fact` | W01 spec 1 proves this seam for the progressive card; the equivalent downstream assertion for a wizard-confirmed fact has not been written. |
| 8 | `MISSING SPEC` — importing only the stream a project is missing | Covered end to end at core level (`store-profile-import-finalize.test.ts`: staging skips per `factId`, and finalize accepts the upsert on the strength of the fact already in the ledger). No browser journey exists because no product surface can *create* the precondition: the wizard always confirms a project's name and price together, so a half-ledgered project cannot be reached through the UI. |

## 24d. #244 Price Validity Window

**File:** `specs/price-validity-window.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | A limited-time price is frozen inside its window and expires from active facts | Seed a legacy StoreProfile with one confirmed project, open the store wizard, and state a price together with the day it runs to — the save button stays disabled until that question is answered, so no price can reach the ledger without it. Read the sent `finalize_store_intake` and require the window to ride on the price candidate's own `expiresAt` and to be repeated identically on the profile side. Generate through the production Composer/Harness path while the window is open and require the price revision in `marketing.factRefs`; then query the canonical fact ledger just after `expiresAt` and require `store_fact_history` to retain exactly revision 1 while `store_facts_active(at)` drops the price and keeps the service name. The deterministic bundle recompile/fence assertion lives in `production-context-port.test.ts`, where the Harness clock is controllable without exposing a browser audit command. |

## 25. Day-0 Recommendation And Example Store

**File:** `specs/uiux-creation-loop.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Example storefront stays opt-in and isolated below the canonical Composer | Open an empty workspace, verify the honest Day-0 recommendation invitation and editable Composer are present, reveal the read-only three-industry sample showcase (护发／皮肤管理／生发), switch industry, remix a sample structure into the Composer, require submit to remain fact-gated rather than treating platform samples as merchant facts, and prove browsing, remixing, hiding, and reloading create no Work, Job, Asset, ContentPackage, or store fact. |
| 2 | Today recommendation follows the persisted fact revision state | Read revision 0 as an honest invitation, then read a server recommendation bound to revision 1 and verify why-now, the merchant-language fact count (never a `store_fact:` id), customer action, source, and the compact active opportunity summary. Verify the CTA prefills the Composer draft in place instead of navigating. Advance to revision 2 and verify the revision-1 recommendation and its opportunity are withheld instead of being described as current personalization. |

## 25b. D-126 Dashboard Home Mount (Hot / Cold)

**File:** `specs/dashboard-home-mount.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Cold tenant sees three sample stores and runs a sample task on the real chain | Register a cold tenant, verify the Day-0 recommendation invitation and the opt-in sample entry, reveal all three C-5 industries, and read the sample store's profile, confirmed facts, material, and works. Assert the trial tier allowance is 5/5/1, remix a sample task so the Composer draft is prefilled, submit it through the real submission chain, wait for the Result Center, and prove the trial copy remainder dropped and the artifact downloads through the same export path a paying merchant uses. Assert the dashboard carries 段①提议 then 段②创作 and no 段③ — an empty workspace has nothing to continue (D-164①). |
| 2 | platform_sample material never reaches the merchant workspace | Collect every platform-sample id from the revealed showcase, seed the merchant's own confirmed store, and assert the merchant's own facts are present (positive control) while no sample id appears in product state assets/contents/handoffs or in the creative workbench assets/contents/works/jobs projection. A workspace with real facts stops offering samples entirely. |
| 3 | Hot tenant gets one recommendation whose CTA prefills the Composer | Seed confirmed store facts, drive the real five-stage Harness to a delivered package (no route stubbing), poll the real recommendation API until it is grounded, and verify the card shows all three explanation elements plus a merchant-language fact count. With real work in hand, assert the one dashboard route carries all three sections in order — 提议 → 创作 → 继续 — with the continue section listing real work (D-164①). Click the CTA and prove the Composer draft is prefilled and focused on the same page — no navigation, no auto-submit. Then, with the real produced work left in place, empty both recommendation sources (Harness projection + ContentPackage fallback) and require the degraded card to read `pending` (今天的主推荐还没排出来) with the next-step entry still present — never the cold-start copy. |
| 4–5 | Cold home renders on mobile in the light/dark theme | Load the cold home at 375×812 in each theme, reveal all three industries, verify the recommendation card is present, assert no horizontal overflow, and capture a full-page screenshot as walkthrough evidence. |

## 26. Pending Action Inbox And Per-Task Blocking

**File:** `specs/pending-actions-inbox.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Three parallel tasks keep one stable current action and each resumes after its authoritative card | Run three real Harness tasks against separate ContentPackages. Advance one deliverable through platform variants and an exact target export so its approval-domain request is pending, while the other two remain on their server-owned QuestionCards. Verify the shared desktop inbox shows all three authoritative actions and exactly one current item; reload and require the same server-ordered current item; approve the exported package through the reused one-time ApprovalCard, answer both reused QuestionCards, and verify the approval request is consumed, assisted handoff is prepared, both question workflows reach their review-ready revisions, and the pending section plus badge become silent. |

## 27. Marketing Identity Single-Question Flow

**File:** `specs/marketing-identity-flow.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Identity registration stays single-question, editable, and accessible | Open the authenticated Asset page, verify identity registration starts with one generated question and no field form, then complete a brand identity one answer at a time. Require every question change to move focus to and announce the new question region, preserve typed spaces and multiline samples, allow a confirmed answer to be edited from its chip, preview only merchant-language identity information, submit the exact brand payload, and render a localized active status without a raw status code or primary version. |

**File:** `specs/w12-identity-draft-assistant.spec.ts` | **Priority:** P0 · required PR gate

| # | Test name | Flow |
|---|---|---|
| 1 | One line and a reference image become a revision-bound draft the merchant must confirm | Upload a visibly matching PNG through the production asset URL, parse it as `brand_reference`, and ask the governed assistant for supported fields only. Require every proposal to remain unconfirmed, manually fill unsupported fields, preserve merchant-only scope and authorization answers, register against the exact server draft revision, read the saved provenance audit, record the exact session identity decision, and submit one real Composer creation whose `CreationExecutionSnapshot` echoes the same identity and decision revisions. PDF and Office reference documents are explicitly deferred to downstream ticket W12③; this surface and test promise reference images only. |

## 28. V1 Day-0 Experience Contract Hard Gate

**File:** `specs/uiux-day0-contract.spec.ts` | **Priority:** P0

Implements D-043 Day-0 contract + V1 复审修订七条计数口径. Metric name: **用户激活次数**. Capture layer: `fixtures/user-activation.ts` (`page.addInitScript` + `page.exposeBinding`, only top-level `event.isTrusted` primary-button clicks; Cmd/Ctrl+Enter counts as 1 keyboard activation). First-token endpoint: `[data-has-token="true"]` on harness primary/alternative candidates and copy-stream slots. Seed boundary: register/login/`seedConfirmedStore`/`seedComposerInlineAuthorize` are measurement prep (this spec seeds them itself and never calls `seedAuthorizedGrounding`, which additionally confirms a store and would move the counter); counter is zeroed after prep. The spec uses the real Web → Core → Harness/DBOS HTTP+SSE chain with an isolated DBOS database; only the model provider boundary is deterministic fixture mode. Product HTTP/SSE calls are never mocked. Screenshots do not replace these assertions. Tour script: `scripts/uiux/day0-tour-screenshots.mjs` → `docs/evidence/ux-fold-supply-day0/`.

| # | Test name | Flow |
|---|---|---|
| 1 | Canonical mouse path: ≤2 user activations to first token, 0 blocking cards | After seed prep, zero the capture counter, fill composer intent, click submit (never click 暂时跳过), assert 0 blocking questions / Brief confirm before submit, wait for first `[data-has-token="true"]`, stop counting, require 用户激活次数 ≤ 2 and no-conflict path still has 0 blocking cards. Also require the authenticated product-metric request selected by `first-usable-draft-v1:` idempotency prefix plus valid path/time/count fields to receive HTTP 202, carry the captured count, and report `canonical_mouse` (the documented non-conflict precision sample). |
| 2 | Keyboard submit path counts as 1 user activation (equivalence) | Same prep; submit via Cmd/Ctrl+Enter; require exactly one `keyboard_submit` activation and first token visible. |
| 3 | Conflict path: exactly one question then continue (exempt from ≤2) | Submit a fixture intent that makes the real Harness return one server-owned free-text question; answer it, click 确认并继续, assert exactly one question, URL unchanged, card clears, and a real first token arrives. Does **not** apply the ≤2 activation gate. |
| 4 | T5 independent: upload → inline one-question → evidence → continue | On `/dashboard`, set composer gallery file, assert one inline authorization question (no library evidence form), confirm public marketing, require URL stays on dashboard (no `/dashboard/assets/:id` hop), and observe the actual `add_asset` metadata plus `authorize_asset` command with `rightsEvidence=system:inline-auth:…`. Then submit from the same composer and require a real first token. |
| 5 | Capture layer survives navigation and ignores child frames | Begin measurement on authenticated dashboard, click a trusted control inside a child frame and require count 0, then use two real top-level links that perform full document navigations. Require `page.exposeBinding` to preserve exactly two captured activations across both documents. |

## 28b. Canonical Platform Default Provenance (#240① / D-150)

**File:** `specs/image-text-note-compiler.spec.ts` | **Priority:** P0

The image-text-note branch deliberately configures `nano-banana-2`, a real
fixture-executable catalog model that differs from the retired browser constant
`seedream-5-pro`. Its complete journey reads preferences, submits through
Composer, completes Harness, and reads the immutable selection evidence back
through the ContentPackage projection. The same fixture-only journey marks its
authorized image as `role=style`, observes the seven-dimension UI/SSE stage and
terminal package, then verifies the Delivered AI-cover affordance exposes all
five beauty presets and all three bounded ratios without claiming live-provider
evidence.

| # | Test name | Flow |
|---|---|---|
| 1 | Composer style reference → confirmation → dual styles → selected pages → full revision and AI-cover prefill | Register a Day-0 workspace; require its stored preference to retain `platform_default` origin and config revision without appearing as a merchant workspace default; require the current canonical preference and Composer submission to select `nano-banana-2` and carry the authorized source as `role=style`; require the seven-dimension stage in UI and SSE; complete the note confirmation/style journey; then read the terminal ContentPackage and require its execution-snapshot projection to freeze `platform_default`, the same model id, and the exact platform config revision. From the Delivered card, require five beauty presets and three ratios, select non-default `salon_photo` + `9:16`, and require the Composer prefill to retain the label and bounded `1152x2048` size. Drain fixture credits only after the next quote has rendered; known shortfall must fail closed in the client with zero submission POSTs and expose distinct booster and subscription pricing anchors. Server rejection remains the authority only for unknown stale races. This fixture journey is not production-provider proof. |

## 29. Live Creation Catalog Capability Gate

**File:** `specs/catalog-live-navigation.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Server catalog hides ordinary tools without a verified execution chain | Open the authenticated full-screen catalog and require both `surface_browser` and `tool_list`; select an exact published Recipe revision and verify Composer adopts its lens; verify unverified ordinary tools are absent from the tools tab and a direct `/dashboard/tools/:toolEntryId` request renders unavailable instead of an empty tool workspace. |

## 30. Recipe / Surface Admin Lifecycle

**File:** `specs/admin-creation-experience-lifecycle.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Admin visually publishes and rolls back Recipe and Surface revisions | Sign in as an admin, use the `/admin/templates` visual editor to draft, preview, publish, revise, and roll back a Recipe; compose a Surface from the published Recipe revision (no Pro Studio tool offer — retired), then draft, preview, publish, revise, and roll back the Surface through the real Creation Experience API. |

## 31. Admin Supply Operations Acceptance

**File:** `specs/admin-supply-ops.spec.ts` | **Priority:** P0 | **Tickets:** #122 / #123 / #128

Locks the four-service admin operations journey at the public browser seam. It
does not treat fixture projections or SSR-only checks as proof that the
operator path is complete.

| # | Test name | Flow |
|---|---|---|
| 1 | Admin enters the exception-first home and drills into model supply | Register and sign in as an administrator, open `/admin`, require the read-only exception-first surface with no acknowledge/assign ownership workflow, follow a visible model-supply drilldown, and reach the model supply and gateway control center at `/admin/supply`. |
| 2 | Governed channel isolation requires impact review and reaches audit evidence | On `/admin/supply`, select a real fixture channel target from the `channel_isolate` governed action, require impact scope/reversibility plus a concrete reason before confirmation, confirm through the typed action UI, follow the resulting audit link, and find the exact unique reason on `/admin/audit`. |
| 3 | Daily operator surfaces expose no technical editors or exception ownership workflow | Walk `/admin`, `/admin/capabilities`, `/admin/supply`, and `/admin/audit`; require successful documents and visible main surfaces, then reject any code, SQL, env, raw JSON, CLI, shell, or terminal editor/control and any acknowledge/assign/owner control. |

## 31b. Admin Dashboard Shell (D-130 template-dashboard)

**File:** `specs/admin-dashboard-shell.spec.ts` | **Priority:** P0 | **Tickets:** T35 / #229 / #258 / #259 / #254

Locks 运营后台 on the template-dashboard shell and the governed credit-plan
configuration seam. Journeys 1–4 run against the live local stack: the admin
surfaces read the real admin-config / model-supply / job-runtime projections.
Journey 5 is deliberately narrower: a route mock isolates the Skills query and
command boundary so it proves browser dispatch shape and durable-run recovery
presentation without claiming live Langfuse, provider, Core persistence,
PostgreSQL, or DBOS evidence.

| # | Test name | Flow |
|---|---|---|
| 1 | Every admin page renders the template-dashboard shell in both themes | Sign in as an administrator and walk `/admin`, `/admin/models`, `/admin/templates`, `/admin/integrations`, `/admin/plans`, `/admin/users` and `/admin/audit`; require the Glass token-bridge host class and a HeroUI sidebar item on each, require the merchant shell no longer wraps 后台, and require a resolved background in both light and dark. |
| 2 | A credit-cycle coefficient reaches its governed revision and audit trail | On `/admin/plans`, change the continuous-monthly coefficient with the structured control, pass impact review with a unique audit reason, require that reason in `config_history`, then restore through the same governed control. This proves the revisioned `plan.credits.cycle_coefficients` admin entry path without claiming the later #307/#310 merchant display work. |
| 3 | Model assembly separates the catalog layer from the channel layer | On `/admin/models`, require the CatalogModel and ExecutionChannel layers to render as separate panels and require each to carry only its own governed keys. |
| 4 | The wired merchant decision hold is editable through the governed control | On `/admin/plans`, select the merchant decision hold alongside the credit controls, require a bounded number stepper instead of an empty form, submit a changed value through impact review with an audit reason, require the reason in config history, then restore through the same governed path. |
| 5 | Admin Skill catalog dispatches structured lifecycle and governance commands | Sign in as an administrator, install route mocks only for Skills P1 query/command calls, and open `/admin/skills`. Drive the existing five lifecycle actions, then submit a governed patch containing only `instruction` and `manifest.description`; administratively cancel, resume, approve, and refresh the same run; separately business-cancel a run and require its terminal audit result with no resume path; switch the unique Published pointer independently from the existing binding/rollback traffic controls; and require a retirement attempt to remain disabled while same-workspace/global dependency details or a cross-workspace `hiddenCount` exist. Inspect the exact outgoing payloads, then let an initially unreferenced retirement receive a concurrent `dependency_blocked` result and display `success`, `applied`, and validation details. Keep raw JSON, EvalRun reads, bulk-transfer actions, and download controls absent. This is route-mock browser evidence, not live Langfuse/provider/Core/PG/DBOS proof. |
| 6 | MISSING SPEC: Admin publishes plan reference numbers (#307) | On `/admin/plans`, select one reference model per copy/image/video category, require video to use its 15-second price, change that model price and observe a deviation, apply all suggestions locally, then confirm with an impact-review reason. The public plan catalog must retain the prior published value before confirmation and project only the confirmed outputs afterwards. This focused browser journey is deferred to the main acceptance lane; the #307 lane keeps the interaction and Core HTTP regressions. |

## 31c. Note Style Set Governance (U05 硬门 / D-107)

**File:** `specs/admin-note-style-governance.spec.ts` | **Priority:** P0 | **Tickets:** U05 / #241

图文笔记的风格集合以前只在契约里，后台没有入口，换一种风格得改代码。这条门
锁住它现在的走法：结构化表单改值 → 影响面确认 → 写入原因 → CAS 版本推进，
全程一次 JSON 手改都不许有。

| # | Test name | Flow |
|---|---|---|
| 1 | An operator reshapes the note style set without ever touching JSON | Sign in as an administrator, open `/admin/templates`, require the editor region to contain zero `textarea.font-mono` and zero rich-text hosts, require the form to open on the style set that is actually live, then rename a style, rewrite its guide and switch a platform off using only labelled form controls; pass impact review with an audit reason and require the new name to survive a reload. Then require the CAS revision to advance, require a re-submit carrying the stale `expectedRevision` to be rejected with `IDEMPOTENCY_CONFLICT` and to leave the revision untouched, and require the reason plus a non-empty actor to land in `config_history` under the new revision. Restores the shared value through the same governed path in `finally`. |

## 31d. Sensitive Words Operations And Delivery Guard (#320)

**Files:** `specs/admin-sensitive-words.spec.ts`, `specs/p0-golden-journey.spec.ts` | **Priority:** P0 | **Ticket:** #320

Locks both user-facing consumers of the shared sensitive-word lexicon without
claiming the object-workspace inline replacement owned by #327.

| # | Test name | Flow |
|---|---|---|
| 1 | Admin manages one sensitive word through the real stack | Sign in as an administrator, open `/admin/templates`, create one uniquely named medical sensitive word with two replacements, edit its word and replacements, disable it, delete it, and require zero browser console errors. |
| 2 | Copy Result delivery waits for a clear sensitive-word check | Complete the canonical Composer copy journey, adopt the ContentPackage, and open its real delivery panel. Hold the real Core `check_bar` request at the browser boundary, require the check bar to remain `checking` and every delivery action to stay disabled, then release that same request, require `clear`, and only then continue with the enabled delivery actions. |

## 32. LIKEPAGE Marketing Landing Page

**File:** `specs/landing-page.spec.ts` | **Priority:** P0

Locks the 丽客美页 LIKEPAGE landing at `/` (ai-saas template structure,
champagne-amber palette, register-first CTAs). Sections and animations come
from the ported template. Since T36 the copy authority is the shipped
capability contract, not the pre-gate copy doc: `delivery-capability-groups`
(`launchAutomaticVerifiedCount() === 0`, so no publish:<platform> claim),
the four outputKinds, and the locked platform carriers. The frame itself is
frozen until the D-125 stage-two window.

| # | Test name | Flow |
|---|---|---|
| 1 | Landing sections render in order | Open `/`, verify hero slogan 美页出发/丽客进门, then the section anchors `#features`, `#showcase`, `#pricing`, `#faq` all exist in DOM order with their headings visible on scroll. |
| 2 | Nav anchors scroll to their sections | Click 功能/作品/定价/常见问题 in the header and verify the target section becomes visible (viewport intersects the anchor element). |
| 3 | Pricing tiers render the approved wording with the pilot disclosure | In `#pricing`, verify 初级 免费 and 中级 quoting some `¥<number>` under the 上线特惠 badge with a CTA whose text is exactly 升级中级套餐 pointing at `/auth/register`, and 终身版 disabled at 敬请期待 with no link. Which number, and whether `/pricing` agrees with it, belongs to `specs/public-plan-price-source.spec.ts` — this row asserted ¥399 for weeks after the configured price moved to ¥1999. The wording is the user's own call; what keeps it honest is the footnote, so also assert 线上支付未开放 and 兑换码 are on the page and that no 立即购买/订阅/升级 imperative appears. |
| 4 | Rendered copy claims only capability the delivery gate grants | Read the page text and assert no 一键发布/自动发布/直接发布/替你发布 claim survives, that all four output kinds and the three locked platforms are named, and that 辅助交接 and 兑换码 appear as the real delivery and activation routes. |
| 5 | Every live CTA stays inside the allowed destinations | Collect all `<a href>` values on `/`; assert each is in the allowlist, that no bare `#` placeholder exists, that every in-page anchor matches exactly one element, and that every internal route answers with a non-error status. |
| 6 | Mobile viewport keeps every section and avoids sideways scroll | Load `/` at 390×844, verify all four section anchors still render and the document has no horizontal overflow. |
| 7 | Bottom form invites registration | Fill the bottom email input, submit, and verify navigation to `/auth/register` with no browser errors. |
| 8 | Theme toggle flips the landing skin | Click the floating theme switch, verify `html.dark` toggles and the page stays healthy. |
| 9 | Reduced motion renders all sections | Emulate `prefers-reduced-motion: reduce`, reload `/`, and verify all section anchors and pricing copy render with no browser errors. |

## 33. P0 Merchant Result And Mobile Truth

**Files:** `specs/ui-journey-three-modal.spec.ts`, `specs/mobile-product-shell.spec.ts`, `fixtures/ui-journey.ts` | **Priority:** P0 | **Tickets:** #144 / #145

| # | Test name | Flow |
|---|---|---|
| 1 | Result keeps merchant language across copy, image, and video | Run the real Composer HTTP/SSE journey in desktop light and 375px mobile dark. Verify ProductStatus and usable actions, then reject Work/Asset IDs, raw execution states, provider text, and model slugs from the Result surface before adjustment, adoption, delivery, and reload restoration. |
| 2 | Mobile Progress never opens a phantom stage | With no active Work, verify the mobile Progress entry goes to the real task center. The target model contract separately verifies that the newest in-flight Work becomes its exact Result deep link, rather than a dashboard query flag. |
| 3 | Product modal semantics and safe area stay intact | Interaction tests require one aria-modal Bottom Sheet/Dialog, Escape close, focus return, and product portal tokens; the 375px browser journey checks Result does not overflow or hide behind the bottom navigation. |

## 34. Pro Studio G-index Local And Release QA — RETIRED (D-170)

Former G-index / Canvas acceptance journeys removed with the Pro Studio product
surface. See `docs/specs/pro-studio-retirement-spec-2026-08-01.md`.
| 5 | G42 stays deferred and forbidden | Do not add a chat shell, local Agent bridge, token storage, or arbitrary provider connection. The acceptance is the absence guard plus the existing governed plan/confirm/apply surface, not a substitute assistant UI. |

### Known fixture boundaries

- The local harness provisions PostgreSQL and starts Main, Core, Worker, and
  Canvas with `MODEL_EXECUTION_MODE=fixture`; an unavailable Docker/PostgreSQL
  fixture blocks the journeys rather than allowing a soft pass.
- Recorded/fixture image, audio, checkout, and security behavior remains local
  acceptance only. The opt-in real-provider checkout smoke does not demonstrate
  a completed payment, live model execution, protected workflow, or production
  security approval.
- A release claim still requires the pinned upstream checkout plus the protected
  production security drill, manual approval, N2 recovery, audio activation,
  pricing approval, and upsell validation. Do not infer any of those from this
  catalog or from unit/build output.

## 35. P1-F2 Continuous Production Acceptance

**File:** `specs/p1-f2-acceptance.spec.ts` | **Priority:** P0 | **Tickets:** #161 / #326

Continuous recorded-mode acceptance for P1 productization. Primary seam is a
logged-in browser through the public App Shell HTTP+SSE BFF into Core with
`MODEL_EXECUTION_MODE=fixture` (recorded adapters). Frontend fixture
short-circuits are never treated as #161 pass evidence. Evidence and residuals:
`docs/evidence/p1-f2-161/README.md`. Production-build opt-in:
`PLAYWRIGHT_PRODUCTION_CANDIDATE=true`.

| # | Test name | Flow |
|---|---|---|
| 1 | Merchant-language guard rejects a full UUID negative control | Render a deliberate full UUID on a merchant-visible surface and require the same merchant-language guard used by the journeys to reject it, proving the UUID leak regex is live. |
| 2 | Copy continuous close-loop | Discover three modalities, submit copy through the Composer Submission BFF with only public references, require Core to freeze the confirmed quote/model/route and return canonical Work/Task/ContentPackage IDs, follow the Task Harness stream into the same Result route, then adopt, hand-edit the canonical ContentPackage, open the distribution-only Moments Delivery only from its frozen signed destination (never mutable Work intent), and download its package current. For manual publication, explicitly select one real current platform variant (the journey chooses Xiaohongshu; no implicit first-variant fallback), persist that exact platform/version pair, record an outcome chip, confirm the weekly-review next-round action, and restore after reload. Axe + merchant-language on Composer/Result/Delivery. |
| 3 | Image-text continuous to delivery | Upload and authorize the Recipe-required image, submit image_text through the same Composer Submission BFF, follow the returned Task Harness stream to Result, and require one note Object Workspace to contain the media worksurface, controlled Tiptap body, selection AI, phone-shell note preview, and the note's authorized cover in a two-column discovery waterfall. Edit the title and require both previews to update live, with no duplicate adopt/adjust exits; then adopt, download 小红书 ZIP, and restore after reload. |
| 4 | Video continuous to delivery | Upload and authorize the Recipe-required source, submit video (抖音) through the same Composer Submission BFF, follow the returned Task Harness stream to Result in dark theme, adopt, download 抖音 ZIP, and restore after reload. |
| 5 | Content + Assets merchant-safe axe matrix | Open Content, Assets, and Tasks/Weekly shell in light and dark; require zero axe serious/critical and no UUID/raw enum/provider slug leaks. |
| 6 | Responsive 320/375/768/1440 + 720 CSS px reflow equivalent | On a ready Result, assert no horizontal overflow and no fully occluded primary CTA at each width and at the 720 CSS px layout equivalent of a 1440 device-pixel frame at 200% zoom. |
| 7 | prefers-reduced-motion Result/Delivery usable | Emulate reduced motion, complete copy Result→adopt→Delivery; document Save-Data product-hook residual when absent. |
| 8 | Mobile dark Result smoke | 375px dark Result: no overflow, primary CTA geometry, merchant language, axe clean. |

### Residuals (honest, not soft-pass)

- VoiceOver manual checklist (Lens, stream, media roles, status, share degrade, chips).
- Save-Data / low-power product hooks not present.
- Legacy Content on-demand anchor browser journey without seeded legacy fixtures.
- Rights withdrawal → pending replace → safe replace → re-delivery browser journey.
- #147 P0 staging RC and live Provider remain out of band.

## 36. Memory Sedimentation And Governance

**File:** `specs/memory-vault-governance.spec.ts` | **Priority:** P0 | **Ticket:** #251

| # | Test name | Flow |
|---|---|---|
| 1 | Composer proposes a governed memory that the next ContextBundle consumes | Complete one real Composer copy run with an explicit durable preference, verify the pending memory and its source pointer, confirm it in the Memory UI, complete a second Composer run, verify its production ContextBundle consumes the confirmed preference, then tombstone the memory-owned provenance snapshot and verify the memory remains with a deleted-source marker. Deleting the canonical Composer conversation is deferred to #271. |

## 36b. Waffo Test Checkout And Webhook Acceptance (#304)

**File:** specs/waffo-acceptance.spec.ts | **Priority:** P1 | **Ticket:** #304

This opt-in browser acceptance runs only with PLAYWRIGHT_WAFFO_ACCEPTANCE=true
against the isolated Waffo Test candidate. It never publishes Waffo products,
uses Production credentials, or changes a production Worker route.

| # | Test name | Flow |
|---|---|---|
| 1 | Authenticated pricing opens a Waffo Test checkout preflight | Register and sign in through the real app, open /pricing, require the Growth card to show HKD and an enabled candidate-catalog checkout button, then require its authenticated session to navigate to `pancake.waffo.ai` with `test=true`; this test never enters a card. |
| 2 | The public Waffo webhook rejects an unsigned delivery | POST a raw JSON delivery with an invalid x-waffo-signature and require a 400 response with received: false; no database settlement is attempted. |
| 3 | Deterministic Test acceptance settles one paid period | With the isolated Test-only flag enabled, register and sign in to bootstrap the workspace, verify the HKD Growth checkout surface and a monthly checkout binding/intent fixture, then POST a locally generated RSA-signed `subscription.payment_succeeded` raw body through a Playwright route fixture. Assert delivery-id inbox acceptance, durable outbox queueing, Core paid-period application, and active Web payment/binding/subscription projections. The fixture never enters a card, calls Waffo, publishes a product, or writes Production. |

## Deferred Coverage

These flows should be added after their dependencies are made deterministic:

| Area | Reason |
|---|---|
| Generic payment portal | Requires Stripe or Waffo test fixtures and provider-specific env. Plan payment remains the commerce path after Pro Studio add-on retirement. |
| Transactional email | Requires a fake mail provider or captured verification links. |
# P0 golden journey

- `p0-golden-journey.spec.ts` verifies the authenticated, workspace-scoped merchant outcome through the canonical Composer chain: a confirmed store submits and resolves its interaction in the current conversation, adopts the resulting ContentPackage, reaches the Result Center delivery panel from the Works doorway, creates a one-shot assisted handoff, and records the merchant-reported publication result. Legacy ContentItem writes and `L3_HANDOFF_PACKAGE` are read-only history and not test setup.
- `product-asset-upload.spec.ts` verifies that a real image crosses the authenticated workspace upload adapter into R2, receives Core rights metadata, keeps public authorization disabled until consent evidence is recorded, becomes publicly usable only after explicit consent, and remains downloadable through the authorized same-origin storage proxy.
- `mobile-product-shell.spec.ts` verifies the bottom bar exposes the merchant destinations (creation, content, assets, store, and — since D-164④ — memory), one slot each. It carries no central create action: the bar is `BUSINESS_SIDEBAR_ITEMS` and nothing else, and this line said otherwise long before that ticket. It also preserves the camera capture contract and prevents horizontal overflow at the representative 390×844 viewport. It does not replace the retired Lead assertion with an unrelated store-to-workspace journey.
## UI journey three-modal Day-0

`specs/ui-journey-three-modal.spec.ts` is the Z1 / #105 browser hard gate. It
boots the real four-service Playwright stack and covers copy, image-text, and
video in desktop/light and mobile/dark profiles. Every path must discover the
three modalities, submit with the exact C6 activation budget, visibly pass
through the running/first-token state, explicitly authorize a visible upload
before image and video submission, use the modality-specific Result Center
workspace, send real adjust/adopt mutations for copy and image, use received
candidate adoption without video editing for video, enter canonical delivery,
download a real non-empty package for the expected platform (小红书 ZIP、抖音
ZIP、朋友圈分段文本), and preserve the same work/adoption/delivery state after
reload. Missing wiring is a hard failure; the spec has no fixture-submit or
soft-skip branch.

## T31 卡片族与确认卡（#225）

`specs/composer-card-family.spec.ts` covers the presentation layer of the three
outbound seam messages against real core SSE. The container journey itself
（不跳转／刷新恢复／签名提交体）stays in `composer-reshell.spec.ts`.

- One creation journey shows 进度宣告卡 → 意图确认卡 → 成品交付卡 in DOM order.
- Answering the question posts an `accepted` decision and the run then delivers
  a bound revision — a workflow suspended on `pending-structured-decision`
  produces none, so the binding is the proof it left PENDING.
- Leaving the card alone posts an `ignored` decision after the real D-116
  countdown (measured, asserted between 15s and 90s) and that run delivers too.
  No fake timer and no shortened parameter: this spec waits out the real wall
  clock, which is why it is the slowest test in the file.
- That timeout is distinguishable from an explicit 「继续」 in the ledger: the
  posted value states the absence（`未作答`）rather than quoting a merchant who
  said nothing, and the idempotency key carries the settlement.
- Typing pauses the countdown before submit, so the merchant is never released
  past mid-sentence.
- 「采用」 carries `contentId`/`versionId` that the `operations.content_packages`
  projection — a different seam from the SSE snapshot the card read — agrees
  with.
- Every visible sentence on all three cards passes the D-116 language gate
  (mirrors `src/product/composer/card-language.ts`).
- A released hold keeps the question actionable but changes its promise before
  the merchant answers: the card says the old quota is back and a new answer
  will re-enter the queue and reserve quota again.
- Quota is a passive line with no controls and no blocking card on the main
  path (D-043 无冲突路径 0 张阻塞卡). Only behaviour is asserted, never the
  numbers — those belong to the entitlements projection.
- Both themes × mobile/desktop render the family and write walkthrough shots.

## S2 失败申报与时间桥（#236）

`specs/composer-failure-recovery.spec.ts` covers the two journeys W03 and W10
exist to make true, both against the real Web → Core → Harness/DBOS chain.

- **失败申报 (P0-2)**: a run whose candidate is blocked by the canonical
  `critical_fact_source` gate reaches the conversation as a 申报卡 carrying a
  Chinese 白话原因, a 下一步动作, at least one recovery entry, and the 额度
  outcome — asserted both on the card and as an observed return of the passive
  quota number, not only as a sentence the card makes about itself. The blocked
  draft is gone from the transcript: a refused candidate must not be left on
  screen as if it were usable. Every visible sentence passes the D-116 language
  gate.
  - **可恢复入口是按下去有用的**: the entries are clicked, not counted, and each
    one is proved on its own path — 再生成一次 rebuilds the session from scratch,
    which would hide every defect 改一下要求 leaves standing.
    - 再生成一次 straight from the failure reaches Core with a run of its own,
      while the composer is still frozen. An entry that only calls `focus()` is
      a dead button, and this is what tells the two apart (D-150).
    - 改一下要求 turns the composer from disabled back to editable, accepts a
      rewritten sentence, and the merchant's **own** send button then delivers:
      the second run's progress lines are visible (a progress cursor left at the
      first run's high-water mark would swallow them) and the previous 申报 is
      gone from the transcript rather than describing work this run never did.
      This is the path that needed quotefix: the quote id now covers the signed
      payload the server fingerprints it by, so a rewritten sentence re-quotes
      under its own key instead of returning IDEMPOTENCY_CONFLICT and leaving
      the composer priceless.
  - **失败档 (fixture failure profile)**: the only deterministic boundary is the
    model provider, the same as every other fixture journey. A merchant intent
    containing 「失败档」 makes the fixture structured runner
    (`apps/core/src/p1/model-supply/ai-sdk-runner.ts`) emit a price claim with no
    traceable source. Everything downstream is production code — the real gate
    blocks it, the real workflow fails, the real reservation is refunded, the
    real audit fact is written and the real terminal frame carries the 申报.
    Fixture mode is `APP_ENV=e2e` only, so the drill cannot arm in production.
- **时间桥 (D-145)**: a run held on a question survives closing the tab. The
  spec closes the page and opens a new one in the same browser context — login
  kept, per-tab `sessionStorage` gone — and asserts `sessionStorage.length === 0`
  so the restore cannot be the browser handle. The conversation comes back with
  the merchant sentence, the 进度宣告卡 with at least as many stage lines as
  before, and the pending question still in place, all rebuilt from the server
  event replay. The async task centre then shows the same run and the `?taskId=`
  deep link is followed, not merely counted: it lands back on the same
  conversation, and a tab whose `sessionStorage` was planted with a different
  session still opens the run the link names (server truth beats the local
  handle).
  - **超时终态是真发生的**: the confirmation hold is set to 120s through the
    governed admin-config path, so it expires while the merchant is away. The
    card settles to Core's 「系统已按通用模式继续」 and that line is still there
    after reopening the page — it comes back from the event replay, so a browser
    that invented it would not survive the reload.

## T32 作品与对象页换壳（#226）

`specs/works-reshell.spec.ts` covers the reshelled 作品 surface against real
core. The four-shape rendering has a deterministic twin in
`src/product/works/works-list.interaction.test.tsx` (fixture 产物 for
copy/image/note/video); this spec proves the shape a live run produces.

- One real creation delivers, and the same 作品 is visible on `/dashboard/works`
  — the new surface, keyed by the ContentPackage the 交付卡 bound.
- Every list row links into `/dashboard/works/…`; nothing routes back to a
  legacy object or content deep link (唯一投影, ADR-0011).
- 详情 revision 与交付卡一致: the detail's `data-package-id` /
  `data-version-id` / `data-revision` are read off the canonical
  `operations.content_packages` projection and must equal what the SSE terminal
  snapshot bound on the card — two independent seams agreeing.
- 导出动作成功: straight out of a run the 成品 is not adopted, so the surface
  offers 采用 and no 导出 at all; after the canonical `adopt_harness_candidate`,
  clicking 导出 posts `result-delivery/result_export` carrying the confirmed
  package and a real download link comes back with no failed command on the
  seam. The headline run is 图文 on purpose — core builds the delivery ZIP out
  of the variant's images and refuses to build one without any, so a 文案 作品
  has no 导出 (asserted in `works-projection.test.ts`, not here).
- 轻编辑入口可达: the canonical `create_work_from_content_package` command makes
  the 轻编辑 work a 作品 row, and its detail mounts LightComposerCanvas (KEEP
  capability core) unchanged.
- Both themes × mobile/desktop walk the list and the detail, assert no sideways
  scroll, and write walkthrough shots to
  `.scratch/t32-works-reshell-2026-07-26/`.
- Contrast is measured, not declared: the 四类输出筛选器 label and the two
  氛围层页头 items (状态标签, 第 N 版) are sampled by hiding the text, reading the
  backdrop pixels actually painted there, compositing the text colour over that
  mean and asserting the WCAG ratio ≥4.5:1 in both themes. DESIGN.md:251 sets
  the bar for ambient headers and DESIGN.md:259 extends it to vendored
  components; the ratios are printed as `[contrast] …` lines so a run reports
  numbers rather than a pass/fail bit.

## T33 / T46 门店橱窗与氛围空态回归

**Files:** `specs/t33-asset-surfaces-reshell.spec.ts`,
`specs/t46-ambient-copy-contrast.spec.ts` | **Priority:** P1

| # | Test name | Flow |
|---|---|---|
| 1 | Three retained asset surfaces share the reshelled storefront | Open Store, Identity, and Workspace in both themes and at the phone viewport; require one shared Glass shell, no page-body shadcn residue, and no horizontal overflow. The retired Lead ledger is intentionally absent. |
| 2 | Retained ambient empty states remain readable | Measure the rendered empty-state and ambient-header copy on Works, Store, and Identity across both themes and desktop/mobile viewports; require every sampled ratio to be at least 4.5:1. The retired Lead list and detail empty states are intentionally absent. |

## S7 商家壳 Muted 文案对比度

**File:** `specs/s7-shell-muted-contrast.spec.ts` | **Priority:** P1

Measures the rendered text against its actual composited backdrop so shared
shell fallbacks and the works glass-piece override are both held to WCAG AA.

| # | Test name | Flow |
|---|---|---|
| 1 | Segment 未选中项与 text-muted 文案在 light 主题下实测 ≥4.5:1 | Sign in under the light theme; measure the unselected creation-mode Segment, the unselected works-shape Segment, and workspace muted copy; require every rendered ratio to be at least 4.5:1. The retired Lead surface is intentionally absent. |
| 2 | Segment 未选中项与 text-muted 文案在 dark 主题下实测 ≥4.5:1 | Repeat the same rendered-backdrop measurements under the dark theme and require every ratio to be at least 4.5:1. |

## S3 钱的旅程（#237 / W05+W06）

`specs/s3-money-journey.spec.ts` covers the two legs the money story has to
walk end to end. Both drive real backends — the allowance moves through the
governed admin-config CAS path an operator uses, the shortfall is a real
ledger state, and the redemption is a real code an admin recorded.

- 缺哪桶说哪桶：an 图文 run debits copy AND image server-side
  (`server-quote-authority.ts` `debitUnitsFor` /
  `composer-submission-gate.ts` `noteUsageUnits`). A merchant whose grant has
  图片 to spare and 文案 at zero is stopped in front of 生成 and told which
  bucket, not handed an `INSUFFICIENT_ENTITLEMENT` after the fact (P0-5).
- 原地解锁：the exits on that card are the inline redemption code and the
  contact form — the old 「查看套餐」 link redirected to the same read-only
  usage page the merchant was already looking at (D-141). Redeeming keeps the
  same URL and the same draft, and 生成 comes back.
- 一个数字一个来源：changing the 初级 文案额度 in the operations console
  changes what `/pricing` quotes on the next load. No deploy, no second number
  to edit — the public page reads the same `plan.allowances.*` revision the
  grant reads (D-143 单一商品目录).

## 两页套餐价同源（#242，S3 转入）

**File:** `specs/public-plan-price-source.spec.ts` | **Priority:** P0 | **Tickets:** #242 / D-143

我们卖给商家的套餐月价（不是商家自己的服务价）。The landing once said ¥399
while `/pricing` said ¥499. S3 routed both pages through one helper and guarded
it by reading source text; 终审 ruled that a source-level guard has no fixed
point against a namespace import or a computed access, so it stays as the fast
feedback layer (`src/routes/(pages)/pricing.contract.test.ts`) and this file
becomes the ground truth — what a browser renders on the two pages a visitor
can reach.

Both pages carry `data-testid="public-paid-monthly-price"` on the paid tier's
month price, exported as `PUBLIC_PAID_MONTHLY_PRICE_TESTID` from the module
that owns the price.

| # | Test name | Flow |
|---|---|---|
| 1 | The landing and /pricing quote the same 中级 month price | Open `/` and `/pricing`, take the price text off the testid on each (requiring exactly one per page), require each to read as `¥<number>` — so "both say 敬请期待" cannot pass as agreement — and require the two strings to be identical. |
| 2 | Moving the source moves both pages together | Read both pages' price off the suite's own stack, then start a second copy of the web app from a different `VITE_PUBLIC_QUOTED_MONTHLY_CENTS` (the override `src/lib/public-display-price.ts` reads so this suite can move the quoted copy — D-156; not a provisioning item and not a billing knob), and require both pages on it to quote the moved value and neither to quote the old one. Agreement at a single value is equally consistent with both pages hard-coding the same literal; only the move tells them apart. |

## S5 成品动作面（#239 / W07+W08+W09）

`specs/s5-work-page.spec.ts` walks the two things a merchant could not do on a
finished 成品 before this slice, against a real backend.

- 改一句就用：selecting 弱促销 on the copy worksurface shows the diff first —
  原来的 / 改写后 — and writes nothing until 就用这版. That button is the only
  producer of a `QuickEditIntent`; the spec asserts the outgoing
  `edit_content_package_version` carries `intent.action = promotion_weaker`,
  because the 13-action contract had been fully implemented server-side with no
  browser that could reach it.
- 做成海报 → 海报入口：the export-use intent lands, core attaches
  `exportUseDelivery` to the new version, and the carrier renders on the same
  page. Before, the renderer was unreachable code waiting for a field the
  front end never produced.
- 昨天的到店：the result chip now carries 数量 and 「这是昨天的」. The spec
  asserts the command leaves with `quantity` and a backdated `occurredAt`, and
  that the row reads as yesterday's date — 「not today」 alone is passed by any
  wrong clock, and a backdated signal that stamps `now` is a false record.
- 三级分层不再是装饰：the inferred tier is computed per request by
  `content_package_results`, never stored on the package. The spec requires a
  real row under 推断相关性 plus its non-causal sentence, which is what tells a
  wired third tier apart from an empty heading.
- 基于此再创作 → 基于「X」再创作：the derive is walked end to end, because both
  of its failures were invisible without one — core refused it for the Work's
  Composer session id and again for the missing Brief context, so the lineage
  the surfaces read had never been written at all. The spec asserts the derive
  is accepted, that it carries a `kind: 'content'` source reference, and that
  the page it lands on names the 作品 it came from.

## M-04 required browser hard gate（T37 / #231）

`specs/m04-browser-hard-gate.spec.ts` is the browser journey the ordinary pull
request runs. `scripts/ci/run-pr-production-journey.sh` executes it beside the
assembly gate in the `production-main-journey` job, which the `required`
aggregation job depends on — so this is the spec that has to be green for a
branch-protection required check to pass, not a strict file that exists off the
required path.

Three modalities are locked: copy → 朋友圈, image_text → 小红书, video → 抖音.
The contract lookup throws if `JOURNEY_CONTRACTS` stops carrying one of them,
because a gate that greens while 视频 is uncovered is exactly the M-04 finding.
Per modality, one test walks:

- **提交** on `/api/core/p1/composer/submissions` — a 202 carrying real task /
  work / contentPackage / snapshot / usageReservation ids, and a body whose T08
  双字段 pair (`contentPackagePlatform` × `distributionTarget`) matches the
  platform the delivered package turns out to carry.
- **流式候选** — 白话进度 announcements in merchant language (no workflow /
  revision / provider vocabulary), and for copy and image_text a real first
  token on `composer-candidate-stream` while the run is still going. Video is an
  ADR-0010 long task with no token stream, so it is held to the announcement.
- **Day-0 严格断言**, migrated here from `uiux-day0-contract.spec.ts`: exactly
  `expectedActivations` isTrusted clicks to the first usable result (2, or 3 for
  video's Brief confirm), zero pre-submit form, and the first-token endpoint.
  The counter is frozen before the recovery reload so no later click can be
  laundered into the budget.
- **刷新恢复 ①** — reload mid-run; the merchant returns to the same conversation
  with the merchant turn and the replayed progress, and exactly one submission
  has been posted for the whole journey (a second POST would be the second
  submit truth ADR-0014 forbids).
- **英文过期 Brief 支线** — open the real high-risk Brief on `/en/dashboard`,
  edit the intent after the quote-bound card appears, and require the visible
  stale-decision notice to be English with the confirm action disabled. This
  keeps the locale regression on the required browser spec rather than only in
  a model test.
- **workId-only Result 重连** — a second tab opens the running copy Result from
  `/dashboard/results/:workId` with no task query and must render the unique
  token emitted by that Work's canonical Harness workflow. Playwright holds the
  first structured fixture copy chunk for 10,000 ms instead of the 40 ms
  default, an E2E-only cost of +9,960 ms per copy run; non-E2E and invalid
  overrides remain at 40 ms.
- **stale taskId 负控** — one user creates two real copy workflows carrying
  distinct fixture lineage tokens, then opens Work A with workflow B's stale
  URL `taskId`. A document-lifetime observer proves B's token was never
  projected, including before the authoritative ContentPackage query settles.
- **采用 → 交付** — the canonical adopt mutation, then the delivery panel and a
  real non-empty package whose manifest platform is this contract's.
- **刷新恢复 ②** — `assertJourneyRestored`: the result surface, the delivery
  panel, and the adopted state all survive a reload.

Identity stays neutral (D-111 / M-03): the tenant registers none, and the run is
required to have delivered without inventing one. Nothing here needs a
credential — `MODEL_EXECUTION_MODE=fixture` is injected by the CI script and the
Playwright config, so a missing provider key cannot redden this gate.

Companion static gate: `src/lib/e2e-hard-gate-contract.test.ts` asserts this
spec is in the required set, that no browser test listens for the retired
`create_creative_work` / `submit_creative_work` pair, that every demoted old UI
spec is marked in place and stays out of the required set, and that no spec
writes a screenshot into the tracked `docs/evidence/` tree.

### Relanded UI contracts

The Z1 cutover removed the unified creation workbench from `src`. #277 relanded
the remaining UI/UX Upgrade B contracts on the shipped Composer and Result
Center rather than retaining `fixme` coverage of retired controls:

- `specs/uiux-upgrade-b-composer.spec.ts` — cold lens, quote readiness, and no
  implicit Product write before submit.
- `specs/uiux-upgrade-b-async.spec.ts` — in-flight Composer refresh recovery
  without a second submission.
- `specs/uiux-upgrade-b-results.spec.ts` — Composer to ContentPackage adoption,
  delivery download, and Result Center restoration.
- `specs/uiux-upgrade-b-i18n-motion.spec.ts` — locale URL preservation, reduced
  motion through a ContentPackage delivery, and the current five-slot mobile nav.

`specs/uiux-creation-loop.spec.ts` no longer carries its six retired-workbench
cases: #242 removed them after recording their current contract owners in §12.
Its two Day-0 recommendation/example-store cases remain active (§25).

`specs/mobile-product-shell.spec.ts` lost its already-`fixme`d mobile Result
journey outright: its only mechanism was holding a retired command, and its
second half addressed `/dashboard/tasks`, which T34 retired. Relanding belongs
to T38.

## Composer 会话删除入口（#271 / D-168②）

**File:** `specs/composer-conversation-deletion.spec.ts` | **Priority:** P1

在 `/dashboard/recent` 的真实页面壳内锁定会话删除入口，只允许
`operations:delete_composer_conversation` 这一条写路径。确认文案必须如实说明
记忆保留并标注「来源已删除」；取消不发命令，成功即时移除会话，403 则保留
原记录并显示可见反馈。

| # | Test name | Flow |
|---|---|---|
| 1 | recent activity confirms, cancels, then deletes through the canonical Operations command | Open Recent, verify the delete entry exists only on the conversation record, open the confirmation and read the retained-memory policy, cancel without a command, then confirm and require `module=operations`, `action=delete_composer_conversation`, and `payload={ conversationId }` before the conversation disappears immediately. |
| 2 | a forbidden deletion stays visible and reports the failure | Inject a 403 for the same canonical command, confirm deletion, require a visible merchant-facing failure, close the confirmation, and verify the conversation remains available. |

## 工作台四态 P0 收敛（#286 / P0-A）

**File:** 暂无独立 Playwright spec（见下）| **Priority:** P0

规格 `docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §2.2/§8.1（D2/D3/D7）。
验收旅程以行为为证，当前 owner 是 interaction / 静态套件（先例：§12 的 Z1 记账方式）：

| 验收 | 旅程 | 当前 owner |
|---|---|---|
| P0-1 | 任务进入 Active 后，段① 今日推荐与段③「继续上次工作」折叠，不与时间线抢首屏 | `src/product/composer/workbench-mode.test.ts` + `src/product/dashboard-home-contract.test.ts` |
| P0-2 | 长对话只有页面这一条滚动主轴，无内层 70svh 双滚动 | `src/product/composer/workbench-p0.static.test.ts` + `composer-conversation.interaction.test.tsx` |
| P0-3 | 候选完成后收为一行胶囊，交付卡不再重复贴正文；后续新一轮运行的流式候选保持全文 | `composer-conversation.interaction.test.tsx`（含 run-2 回归） |
| P0-4 | 推荐→Composer 为类型化 handoff，不无条件预填 copy lens，有 outputHint 时尊重 | `src/product/recommendation-handoff.test.ts` |

Playwright 旅程与四态形态的 P1 变更（双栏 / Composer 粘底 morph / 宽度合同
800→1240）绑定：形态在 P1 仍会重排，先在 P1 落地时一并写 spec，避免为将被
重排的 DOM 写一次性 e2e。本节先按 E2E Workflow 的 Spec 步骤记账旅程与 owner。

## #328 OpenCLI live 门与链接主路径

**File:** `specs/viral-adapt-opencli-gate.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | verified OpenCLI gate uses the injected logged-in bridge and keeps paste fallback | Log in, open the real Dashboard 「爆款复刻」 chip, and require the verified link track to be first and selected only while the injected device bridge is ready. Pass the fixture bridge one complete fixture note URL, project only note text plus host-authorized asset ids into the confirm card, and prove the complete URL/token never enters the Composer intent or any XHS network request. Reopen the journey, switch to the always-available paste fallback, and reach its source-specific confirmation without contacting XHS. Live proof is recorded separately in the redacted #328 ops handoff and is never replaced by this fixture. |
| 2 | a verified gate with no device bridge fails closed to paste | Leave the local bridge absent, require paste to remain the default plus an honest disconnected status; explicitly select the unavailable link track, require its read action disabled, then return to paste without any XHS request. |
| 3 | a local bridge error stays generic and recovers through paste | Inject a ready bridge that rejects, require a generic merchant error with no URL/token echo, and recover through paste without any XHS request. |

The pre-verification `gate=false` regression stays owned by
`viral-adapt-journey.test.ts` and `viral-adapt.interaction.test.tsx`: those
tests explicitly create a closed evidence gate and require paste-only behavior.
The browser spec does not add a production query flag or global that could
reopen/override the evidence decision.

## P2 图文对象工作区、AI 封面与爆款复刻合入门（#320–#325）

**File:** `specs/p2-browser-closure.spec.ts` | **Priority:** P0

真实本地 PostgreSQL、Web → Core 公共 HTTP/SSE 与 Chromium；仅模型边界使用
fixture。产品请求不 mock，静态源码断言不能替代以下三条旅程。

| # | Test name | Flow |
|---|---|---|
| 1 | image-text customer deep run keeps canonical edit, Selection AI, sensitive-word guard, and delivery on one journey | 以 customer + deep 提交 note，核对冻结请求；进入带媒体的 Tiptap 对象工作区，真实选中正文片段并接受 Selection AI 调整，进入派生 Result；采用后保存 canonical 正文，要求 delivery 违禁词检查与当前正文同源、命中时 fail closed，修正后重新变 clear 并下载真实 ZIP。 |
| 2 | delivered AI cover exposes five presets, signed ratios, style-role analysis, and a Result image | 从已交付图文卡进入 AI 封面，要求 5 个美业 preset 均可达、3 个 ratio 的签名尺寸不超过当前模型上限；以 1:1 正例和授权 style-role 素材提交，观察七维分析阶段、签名 payload、终态交付与 Result 图片。 |
| 3 | viral chip uses honest paste fallback and authorized image through task experience morph to note Result | 从爆款复刻 chip 进入粘贴轨，确认 OpenCLI live 证据已核销但当前设备桥缺失时仍默认粘贴且无外部抓取；粘贴参考原文、上传并授权图片、确认 exact `recipe.viral_adapt` note 合同与结构化 `viralAdaptSource`，要求商家输入不泄露 raw note/内部传输字段/素材 ID，随后观察 basis → candidate/delivery morph → sediment/correction、成功终态主动 refetch memory entries（无 reload），并进入 note Result。 |
