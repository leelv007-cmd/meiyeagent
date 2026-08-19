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

Machine-readable ownership and release-decision metadata lives in
`scripts/ci/journey-ownership-catalog.json`. The validator resolves all 98
Playwright files and all 96 active canonical PostgreSQL/DBOS opt-in files, fails
on inventory drift, and excludes advisory/instrument outcomes from the release
verdict:

The browser inventory mirrors the current workflow graph: 10 required, 26
advisory, and 62 full-RC/local files. A local-only entry keeps `artifact: null`
until a real producer emits one.

Full RC product selection is also catalog-driven. It excludes `instrument`,
`known_red`, retired, and superseded decisions; V31-82 has a separate advisory
instrument producer and cannot affect the product release verdict.

```sh
node scripts/ci/journey-ownership-catalog.mjs validate
```

## V31 Campaign Paid Work Lifecycle

**File:** `specs/campaign-paid-work-confirmation.spec.ts` | **Priority:** P0 / required

| # | Test name | Flow |
|---|---|---|
| 1 | One visible Campaign gates plan and both paid Works independently | Enter through the production Composer Campaign control; create a `plan_only` confirmation with zero reserved credits; confirm it; prove Work 1 carries `single_work`, ordinal 1 and the Campaign plan ref; confirm and deliver Work 1; prove Work 2 is absent until that delivery, then appears on the same plan with ordinal 2 and a different held confirmation request; prove it does not execute before its own confirmation, then confirm and deliver it. |

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

## 2b. Admin Ban Session Immediacy

**File:** `specs/admin-ban-session-immediacy.spec.ts` | **Priority:** P0

Verifies Spec A / #364: after an admin bans a merchant, the merchant browser
context’s next page and API requests are refused and session cookies are
cleared, without disabling Better Auth cookie cache. After unban, a fresh
login succeeds on the first request.

| # | Test name | Flow |
|---|---|---|
| 1 | Ban takes effect on the next merchant request; unban allows re-login | Independent admin and merchant browser contexts. Merchant signs in and can open `/dashboard` and call a BFF API. Admin bans the merchant. Merchant’s next `/dashboard` navigation lands on `/auth/login`; next `/api/core/p1/query` returns 401 with expired `session_token`/`session_data` cookies. Admin unbans; merchant re-login succeeds and the first API request is authenticated. |

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

## 5. Runtime Tracer — retired

The dedicated Web diagnostics proxy and `runtime-tracer.spec.ts` were removed
after the dashboard diagnostics surface retired. Product workflows exercise
the Core seam through their authenticated production routes instead.

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
| 6 | Batch parse: multi-file upload → Core progress → per-draft confirm → finalize, with fixture demo label visible | Seed a legacy StoreProfile, open the store wizard, assert the fixture demo label is DOM-visible on the single-file capture surface, upload two price-list photos through `store-intake-photos`, assert the multi-file ready state, run `start_parse_asset_batch` from arrange, require Core progress text visible and the fixture label still visible on the arrange step, wait for arrange result, confirm each field through the existing confirm step, and require exactly one `finalize_store_intake` with a revision-1 price fact (fixture amount 239 CNY) in the ledger. |
| 7 | `MISSING SPEC` — the assets page entry runs the same five-step wizard | The wizard is mounted on `/dashboard/assets` (`routes/dashboard/assets.tsx`) and covered only by its mount code plus interaction tests; no Playwright journey walks intake from that entry yet. |
| 8 | `MISSING SPEC` — a W02-confirmed fact reaches the delivery ContextBundle as `current_fact` | W01 spec 1 proves this seam for the progressive card; the equivalent downstream assertion for a wizard-confirmed fact has not been written. |
| 9 | `MISSING SPEC` — importing only the stream a project is missing | Covered end to end at core level (`store-profile-import-finalize.test.ts`: staging skips per `factId`, and finalize accepts the upsert on the strength of the fact already in the ledger). No browser journey exists because no product surface can *create* the precondition: the wizard always confirms a project's name and price together, so a half-ledgered project cannot be reached through the UI. |

## 24c-b. V31-84 Day-0 Sentence Capture And Confirm

**File:** `specs/v31-84-store-onboarding-capture-confirm.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Saying one sentence confirms the store, unlocks asset upload, and lets an image-text recipe submit | Register a zero-store merchant, open `/dashboard/store`, fill the spoken sentence on step 3, walk to step 5, require the name field to prefill from that sentence, answer price validity, click 「都对，保存」 once, and require exactly one `finalize_store_intake`. Prove the store profile projection shows the confirmed name (empty-state gone). Upload through `/dashboard/assets` `#canonical-asset-upload` without the archive gate 「请先确认门店档案」, then apply `recipe.case_to_xhs_note` and require Composer submit to reach `/composer/submissions`. |

## 24c-c. V31-86 Day-0 Archive Card Batch Confirm

**File:** `specs/v31-86-store-onboarding-archive-card.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Saying one sentence prefills the card with defaults and one save creates the store | Register a zero-store merchant, open `/dashboard/store`, fill the spoken sentence, walk to step 5, require the extracted name plus platform-default district/address/booking with provenance badges, edit one field, answer price validity, click 「都对，保存」 once, and require `finalize_store_intake` `<400`. Prove the store profile exists and 「门店信息」 lists only the true-value facts. |

## 24c-d. V31-89 Spoken Sentence LLM Extract

**File:** `specs/v31-89-spoken-sentence-llm-extract.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Non-template wording is arranged into the archive card and one save writes the store | Register a zero-store merchant, open `/dashboard/store`, fill a spoken sentence the frontend regex cannot parse, wait for `extract_store_sentence`, require name/city/project/price plus the AI-guess badge on the archive card, answer price validity, click 「都对，保存」 once, and require exactly one `finalize_store_intake`. Full-stack run belongs to the master. |

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
| 1 | Cold tenant sees three sample stores and runs a sample task on the real chain | Register a cold tenant, verify the Day-0 recommendation invitation and the opt-in sample entry, reveal all three C-5 industries, and read the sample store's profile, confirmed facts, material, and works. Assert the cold tenant holds its whole one-time trial credit grant (D-172), remix a sample task so the Composer draft is prefilled, submit it through the real submission chain, wait for the Result Center, and prove the sample holds exactly the credits its quote froze — on the same ProductUsage receipt a paying merchant is charged on, with the retired three-bucket units empty — and that the artifact downloads through the same export path a paying merchant uses. Assert the dashboard carries 段①提议 then 段②创作 and no 段③ — an empty workspace has nothing to continue (D-164①). |
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
| 1 | Composer style reference → confirmation → dual styles → selected pages → full revision and AI-cover prefill | Register a Day-0 workspace; require its stored preference to retain `platform_default` origin and config revision without appearing as a merchant workspace default; require the current canonical preference and Composer submission to select `nano-banana-2` and carry the authorized source as `role=style`; require the seven-dimension stage in UI and SSE; complete the note confirmation/style journey (dual-style confirmation asserts two comparison cards each render full, mutually distinct positioning); then read the terminal ContentPackage and require its execution-snapshot projection to freeze `platform_default`, the same model id, and the exact platform config revision. From the Delivered card, require five beauty presets and three ratios, select non-default `salon_photo` + `9:16`, and require the Composer prefill to retain the label and bounded `1152x2048` size. Drain fixture credits only after the next quote has rendered; known shortfall must fail closed in the client with zero submission POSTs and expose distinct booster and subscription pricing anchors. Server rejection remains the authority only for unknown stale races. This fixture journey is not production-provider proof. |

## 29. Live Creation Catalog Capability Gate

**File:** `specs/catalog-live-navigation.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Server catalog hides ordinary tools without a verified execution chain | Open the authenticated full-screen catalog and require both `surface_browser` and `tool_list`; select an exact published Recipe revision and verify Composer adopts its lens; verify unverified ordinary tools are absent from the tools tab and a direct `/dashboard/tools/:toolEntryId` request renders unavailable instead of an empty tool workspace. |

## 30. Recipe / Surface Admin Lifecycle

**File:** `specs/admin-creation-experience-lifecycle.spec.ts` | **Priority:** P0 | **Tickets:** #376 / Spec D5

| # | Test name | Flow |
|---|---|---|
| 1 | Admin visually publishes and rolls back Recipe and Surface revisions | Sign in as an admin, use the `/admin/templates` visual editor to draft, preview, publish, revise, and roll back a Recipe; require the same-page Recipe publish success panel (no new route); seed a Surface, load it, select a published revision from the candidate dropdown (no free-text revision input), then draft, preview, publish, revise, and roll back the Surface through the real Creation Experience API. |
| 2 | Fixed recipe revision stays on frontend until Surface re-publish | Publish Recipe v1 and Surface pinned to that revision; publish Recipe v2 and assert `surface_browser` still returns v1 (Recipe publish alone is not Surface publish evidence); use the success panel to update Surface refs to v2, explicitly preview/publish Surface, then assert `surface_browser` returns v2. |

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
| 5 | Admin Skill catalog dispatches structured lifecycle and governance commands | Sign in as an administrator, install route mocks only for Skills P1 query/command calls, and open `/admin/skills`. Drive the existing five lifecycle actions, then submit a governed patch containing only `instruction` and `manifest.description`; administratively cancel, resume, approve, and refresh the same run; separately business-cancel a run and require its terminal audit result with no resume path; switch the unique Published pointer independently from the existing binding/rollback traffic controls; and require a retirement attempt to remain disabled while same-workspace/global dependency details or a cross-workspace `hiddenCount` exist. Inspect the exact outgoing payloads, then let an initially unreferenced retirement receive a concurrent `dependency_blocked` result and display `success`, `applied`, and validation details. Keep raw JSON, EvalRun reads, bulk-transfer actions, and download controls absent. **Admin rendering / dispatch regression only** — merchant user_selected closed loop is §31e / #382. |
| 6 | MISSING SPEC: Admin publishes plan reference numbers (#307) | On `/admin/plans`, select one reference model per copy/image/video category, require video to use its 15-second price, change that model price and observe a deviation, apply all suggestions locally, then confirm with an impact-review reason. The public plan catalog must retain the prior published value before confirmation and project only the confirmed outputs afterwards. This focused browser journey is deferred to the main acceptance lane; the #307 lane keeps the interaction and Core HTTP regressions. |

## 31e. Merchant user_selected Skill Journey (Spec E / #382)

**File:** `specs/user-selected-skill-journey.spec.ts` | **Priority:** P0 | **Tickets:** Spec E / #382

Merchant closed loop for `user_selected`: published E2E fixture seed (not admin
route-mock) → Composer capability pill → real BFF/Core submission → frozen
injection evidence + assembly audit axes. Also covers cancel (no inject) and
cross-workspace isolation.

| # | Test name | Flow |
|---|---|---|
| 1 | Select → submit → inject → audit | Seed published user_selectable Skill via `/api/e2e/user-selected-skill-fixture`, open copy Composer, select the capability pill, submit real `composer/submissions`, read `/api/e2e/user-selected-skill-evidence` and require `userSelectedSkillRefs` + `intent_naming` injection + task_pin catalogRevision/scene + stage promptName@version and skillId@skillVersion. |
| 2 | Cancel selection does not inject | Select then toggle off the pill, submit, and require empty selection refs with the fixture skill absent from frozen skillStages. |
| 3 | Tenant isolation | Two merchant contexts; seed a tenant-scoped pack for owner workspace; owner sees it, stranger does not (DOM + merchant_skill_projection). |

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
| 1 | Admin manages one sensitive word through the real stack | Sign in as an administrator, open `/admin/sensitive-words`, create one uniquely named medical sensitive word with two replacements, edit its word and replacements, disable it, delete it, and require zero browser console errors. |
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
| 3 | Pricing tiers render the approved wording with the pilot disclosure | In `#pricing`, verify the landing names **no** tier — neither the three it used to sell (初级/中级/终身版) nor the four `/pricing` sells (体验版/起步版/成长版/专业版), in Chinese or English. The user's 2026-08-05 de-tiering ruling moved that vocabulary to `/pricing` alone, so this row stopped asserting the tiers it had pinned since D-143. What is left is the shared offer: exactly one `public-paid-monthly-price` handle quoting some `¥<number>` under the 上线特惠 badge, the word 积分, a link to `/pricing`, exactly one `/auth/register` CTA, and zero `aria-disabled` pseudo-CTAs. Which number, and whether `/pricing` agrees with it, belongs to `specs/public-plan-price-source.spec.ts` — this row asserted ¥399 for weeks after the configured price moved to ¥1999. Structural lock: strip the price text and the block must contain no digit at all, since any other number would be a per-tier fact nothing keeps in step. The footnote keeps it honest, so also assert 线上支付未开放 and 兑换码 are on the page and that no 立即购买/订阅/升级 imperative appears. |
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

## V31-96 窄视口单栏 shell

`specs/workbench-narrow-viewport-shell.spec.ts` covers the one thing about the
workbench shell that only a real browser can answer: whether
`.meiye-workbench-stream-only-group { touch-action: auto !important }` actually
reaches that element through the built stylesheet. The library writes
`touch-action` after the user style spread, so where there is no drag handle
only CSS can drop the pan-y guard, and jsdom has no cascade to resolve.

The chromium project pins 1440x900, so before this the single-column shell had
never rendered in a browser gate at all — `WORKBENCH_DUAL_COLUMN_MIN_WIDTH_PX`
is 1240.

- At 1000px（`data-viewport="desktop"`，仍在 1240 以下）单栏 group 存在，
  computed `touch-action` 为 `auto`，且页面不横向滚动。1000px 此前无任何覆盖。
- 390px 同样断言。composer-reshell 与 composer-card-family 已到过这个宽度，
  但都不验这条规则。
- 不驱动 run：workbench shell 在 `/dashboard` 上就渲染，先跑一次创作只会把
  模型与报价链路挂到一条测 CSS 的用例上。
- 不验 V31-99 的 40%/24% 拖拽地板：那两个 prop 在双栏 group 上，
  低于 1240 不渲染，该项属于 CI 已经在跑的 1440。
- 没有 1440 双栏对照：双栏还要求 `phase !== 'idle'`，刚进 /dashboard 时
  任何宽度都不渲染双栏，写了也不可能通过。所以本 spec 里 dual-column 计数为 0
  **不是** 1240 门槛的证据。

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
  Chinese 白话原因, a 下一步动作, at least one recovery entry, and the 积分
  outcome — asserted both on the card and as an observed return of the credit
  balance beside the composer, not only as a sentence the card makes about
  itself. The blocked
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

- 缺多少说多少：admission is one credit reservation for the whole run
  (D-172), so a merchant short of credits is stopped in front of 生成 and told
  the gap in 分, not handed an `INSUFFICIENT_ENTITLEMENT` after the fact
  (P0-5). The per-bucket precheck this replaced is retired with the
  three-bucket projection that fed it (#336).
- 原地解锁：the exits on that card are the inline redemption code and the
  contact form — the old 「查看套餐」 link redirected to the same read-only
  usage page the merchant was already looking at (D-141). Redeeming keeps the
  same URL and the same draft, and 生成 comes back.
- 一个数字一个来源：changing a plan's monthly credits in the operations
  console changes what `/pricing` quotes on the next load. No deploy, no second
  number to edit — the public page reads the same `plan.credits.*` revision the
  grant reads (D-143 单一商品目录 / D-172).

## 公开价可追同源（#242 / #346，S3 转入）

**File:** `specs/public-plan-price-source.spec.ts` | **Priority:** P0 | **Tickets:** #242 / #346 / D-143

我们卖给商家的套餐月价（不是商家自己的服务价）。The landing once said ¥399
while `/pricing` said ¥499. S3 routed both pages through one helper and guarded
it by reading source text; 终审 ruled that a source-level guard has no fixed
point against a namespace import or a computed access, so it stays as the fast
feedback layer (`src/routes/(pages)/pricing.contract.test.ts`) and this file
becomes the ground truth — what a browser renders on the two pages a visitor
can reach.

Both pages carry `data-testid="public-paid-monthly-price"` on the paid tier's
month price, exported as `PUBLIC_PAID_MONTHLY_PRICE_TESTID` from the module
that owns the price. `/pricing` hangs it on the growth card and only under the
monthly cycle — under the yearly cycle the number beside it is a year's price.

**What this file asks changed in #346.** It used to ask whether both pages
print the same number. #310 moved `/pricing` onto the Core published catalog,
so the two pages no longer share a source and the guard sat reading zero
elements on `/pricing`, passing nothing, for weeks. Same-number is also the
weaker question: two hand-synced literals agree perfectly, which is the state
the product is actually in (under a Waffo runtime both read HK$522, out of two
places kept in step by hand). D-143's requirement is that every price a visitor
reads is traceable to one declared source, so that is what is asked now — per
surface, plus the anti-crosstalk leg that a same-number assertion cannot reach.

**Known condition, named not blessed (#352):** the landing quotes
`PUBLIC_DISPLAY_PRICE_CENTS` (D-156 pilot copy, CNY on a non-Waffo runtime)
while `/pricing` quotes the governed Core catalog (HKD). Whether the product
should keep two pricing assets is tracked in #352 and settled after the pilot
alongside the #240 operations window; this file holds each surface to its own
source until that lands.

| # | Test name | Flow |
|---|---|---|
| 1 | Each public surface quotes the paid month exactly once, and a real price | Open `/` and `/pricing`, take the price text off the testid on each requiring **exactly one per page** (a second copy on one page is the same drift as a second copy across two, one level down), and require each to read as a currency mark plus an amount — so "both say 敬请期待" cannot pass as agreement. |
| 2 | Moving a source moves the surface that declares it, and only that one | Read both prices off the suite's own stack, then move each source in turn against a second copy of the web app. **Display price:** start it from a different `VITE_PUBLIC_QUOTED_MONTHLY_CENTS` (the override `src/lib/public-display-price.ts` reads so this suite can move the quoted copy — D-156; not a provisioning item, not a billing knob); the landing must quote the moved value and **`/pricing` must not move**. **Published catalog:** point that app's `CORE_SERVICE_URL` at a stub Core publishing a different growth monthly price; `/pricing` must quote the moved value and **the landing must not move** — its number is compiled in and never asks Core. The two "must not move" legs are the anti-crosstalk half: they catch a surface that has started reading the other's source, which is the same defect as the pages disagreeing, with the numbers happening to line up. |

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

## #333 Note 单页重生 browser 旅程（xcheck A6）

**File:** `specs/note-page-regeneration-journey.spec.ts` | **Priority:** P0

零后端改动。ComposerHome delivered 态 note-plan 时间线 → 单页重生。OCC 语义锚定：
仅 prepare 携带 `expectedWorkUpdatedAt`，confirm 不带。

> **实测结论（2026-08-05）**：本票原假设「生产链已闭合、只差旅程见证」被浏览器
> 证伪——**单页重生当前从 UI 不可达**。delivered 态下按钮渲染且 enabled，但点击
> 永远不发 `result_adjust_prepare`，在 `composer-home.tsx:2710-2719` 被客户端拦下
> （`notePlanCanonicalPackageRef` 从未被填充），商家只拿到
> 「暂时无法读取当前图文版本，请刷新后重试。」。非本 spec 时序问题：~90s 内反复点击
> 零命令；`session.task` 同时带 workId 与 packageId；`operations.content_packages`
> 返回的正是该 packageId，且 revision 1 / review_ready / currentVersionId 已设 /
> 2 version × 3 页 / snapshot 齐全；reload 后 note_plan turn 干脆不再挂载。

| # | Test name | Status | Flow |
|---|---|---|---|
| 1 | stale OCC prepare is rejected then successful page regen reaches new task/package | **BLOCKED（`test.fixme`）** | 覆盖 AC ①②，因上述可达性缺陷当前无法见证（两半都要求 prepare 真的发出）。旅程按目标合同完整写出并原地保留：负例①用 route 仅改写 prepare 体的 `expectedWorkUpdatedAt` → 期望 409 + `RESULT_ADJUST_REVISION_CONFLICT` + 诚实文案 + 无 confirm 请求 + 无新 package；正例 → 确认卡 → confirm 体不含 `expectedWorkUpdatedAt` → 新 taskId 出现在 harness active tasks（**必须在等交付之前**，该列表排除已 `package_delivered`）→ poll confirm 返回的**具体**新 package id 至 `revision>=1` 且有 `currentVersionId` → 断言 `lineage.reusedFromPackageId` 命中重生前 parent、某 version 带本页 regenerationReceipt（`toRevision=fromRevision+1`, `imagePoints=1`）。缺陷修复后去掉 `fixme` 即成回归门。 |
| 2 | regenerate on a delivered note fails honestly and builds nothing | 绿 | 覆盖 AC ③，**零注入**：delivered 态点击重生 → 诚实文案「暂时无法读取当前图文版本，请刷新后重试。」（并断言不是 prepare 层那句，两层文案不得混同）；全程无 `result_adjust_prepare`/`result_adjust` 离开浏览器；无确认卡与 slot；目标行仍 `ready`/「已配图」、按钮可重试；package 列表不变。早期草稿曾 strip `creationExecutionSnapshot` 制造该失败，已**删除**——不 strip 也是同一句文案，注入什么都没隔离出来，留着就是「为错误的理由而绿」。 |

## P2 图文对象工作区、AI 封面与爆款复刻合入门（#320–#325）

**File:** `specs/p2-browser-closure.spec.ts` | **Priority:** P0

真实本地 PostgreSQL、Web → Core 公共 HTTP/SSE 与 Chromium；仅模型边界使用
fixture。产品请求不 mock，静态源码断言不能替代以下三条旅程。

| # | Test name | Flow |
|---|---|---|
| 1 | image-text customer deep run keeps canonical edit, Selection AI, sensitive-word guard, and delivery on one journey | 以 customer + deep 提交 note，核对冻结请求；进入带媒体的 Tiptap 对象工作区，真实选中正文片段并接受 Selection AI 调整，进入派生 Result；采用后保存 canonical 正文，要求 delivery 违禁词检查与当前正文同源、命中时 fail closed，修正后重新变 clear 并下载真实 ZIP。 |
| 2 | delivered AI cover exposes five presets, signed ratios, style-role analysis, and a Result image | 从已交付图文卡进入 AI 封面，要求 5 个美业 preset 均可达、3 个 ratio 的签名尺寸不超过当前模型上限；以 1:1 正例和授权 style-role 素材提交，观察七维分析阶段、签名 payload、终态交付与 Result 图片。 |
| 3 | viral chip uses honest paste fallback and authorized image through task experience morph to note Result | 从爆款复刻 chip 进入粘贴轨，确认 OpenCLI live 证据已核销但当前设备桥缺失时仍默认粘贴且无外部抓取；粘贴参考原文、上传并授权图片、确认 exact `recipe.viral_adapt` note 合同与结构化 `viralAdaptSource`，要求商家输入不泄露 raw note/内部传输字段/素材 ID，随后观察 basis → candidate/delivery morph → sediment/correction、成功终态主动 refetch memory entries（无 reload），并进入 note Result。 |

## D-174 今日推荐行业层换源（#342，重述自 #330 AC3）

**File:** `specs/today-recommendation-industry.spec.ts` | **Priority:** P1

单独成文件而不是并入 `dashboard-home-mount.spec.ts`：它证的是一条产品合同
（行业层数据源＝门店档案），与 D-126 首页挂载是两回事。跑一次真实生成，属长用例，
**不进 production-journey 必跑集**。

旧口径（答行业问题卡→从任务读回）经 #330 实证端到端不可达：商家可写事实的封闭词表
里没有行业身份，行业缺口恒被自动放行；即便挂起，流内作答也不落库。D-174 因此把数据源
换成门店档案——whyNow 文案「结合本店…」本来说的就是门店属性。

| # | Test name | Flow |
|---|---|---|
| 1 | a stated industry gives the hot recommendation its industry whyNow | 确认门店后以一条 `finalize_store_intake` 写入行业（档案字段＋`store.profile.industry` 事实同批落地，并回读 ProductState 证明档案侧真的写进去了）；**先声明再生成**（后写事实会正确地把已交付推荐置为 stale 而非改写它）；走真实 Composer 交付一单；回首页展开今日推荐迷你卡，断言行业层原文「结合本店护发与头皮护理，今天适合把主推项目讲清楚。」，并**排他断言** platform／weekday 两句兜底文案缺席——没有排他这一半，一张同时显示两句的卡也会绿。 |

## V3.1 批次旅程（发布交接 §37.4-K / Ops Console AC4 / Day-0 自由创作 §37.4-A）

门收缩（2026-08-14，docs/ops/ci-arbiter-gate-shrink-2026-08-14.md）后，同一份
catalog 由 `scripts/ci/run-v31-browser-acceptance.sh` 按 `V31_GATE_SCOPE` 服务两个
CI job：`v31-day0-gate`（scope=day0，**required**，只跑零素材首访 release gate）和
`v31-browser-report`（scope=remaining，遥测——红在 PR 上可见、逐文件写
`v31-file-verdicts.log`，但不阻塞 `required`；旅程回归阻塞集须显式决策，不是默认）。
两个 job 都使用独立 PostgreSQL/DBOS 数据库与 fixture 模型边界，成功或失败都上传各自的
`output/ci/v31-day0-gate` / `output/ci/v31-browser-report` 及 Playwright test results。
发布候选 full E2E 另行使用同 SHA release manifest，不会把该条件传播到
普通 V3.1 browser gate。CI 清单是显式的：新增 V3.1 spec 必须同步更新
`scripts/ci/run-v31-browser-acceptance.sh` 和本 catalog，不允许靠 glob 静默纳入或遗漏；
缺文件 fail closed 在所有 scope 生效。
零素材首访单独 fail-fast（沿用 CI 默认 retries，给用量未算完这类瞬时红一次重试）；其余每个登记文件各自一次 Playwright 调用、各自 `--retries=0`、各自 `playwright-<slug>.log`，某一个 remaining 文件产品红或 instrument 死后继续跑完后续文件并写入 `v31-file-verdicts.log`，不再把后文件记为 NOT evaluated。V31-64 的 NOT evaluated 只用于本地 `full` scope 的 day-0 红（CI 拆 job 后 remaining 恒有各自 verdict）。

**§37.4 A–K 与 spec 文件登记表（gate 逐个文件名索取，缺文件即 fail closed）**

旅程定义以 `docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md`
§37.4（1763 行起）为权威，下表文件名照该节措辞取名，**一个字母一个文件**（主控裁决：
E 与 F 不共用文件，否则红灯归属不可判、A–K 一对一归因断裂）。

| §37.4 | 旅程 | Spec 文件 | 文件是否已存在 |
|---|---|---|---|
| A | Day-0 自由创作 | `specs/v31-day0-free-creation-journey.spec.ts` | 是 |
| B | Level 1 纯 copy | `specs/v31-level1-copy-journey.spec.ts` | 是 |
| B2 | 记忆注入透明 | `specs/v31-memory-injection-b2-journey.spec.ts` | 是（复用 V31-18 B2 生产合同） |
| C | 定制图文（Level 2） | `specs/v31-living-plan-journey.spec.ts` | 是 |
| D | 视频付费执行 | `specs/v31-video-paid-execution-journey.spec.ts` | 是 |
| E | Plan stale | `specs/v31-context-fence-journey.spec.ts` | 是 |
| F | 素材撤权 | `specs/v31-rights-revocation-journey.spec.ts` | 是 |
| G | Mid-run Steering | `specs/v31-mid-run-steering-journey.spec.ts` | 是 |
| H | Interrupt resume | `specs/v31-interrupt-resume-journey.spec.ts` | 是 |
| I | Thread 连续 | `specs/v31-thread-root-workbench.spec.ts` | 是 |
| J | Harness Release | `specs/v31-ops-console-release-journey.spec.ts` | 是 |
| K | 自报旅程 | `specs/v31-publish-handoff-selfreport.spec.ts` | 是 |
| — | Artifact 语义流 | `specs/v31-artifact-growth-journey.spec.ts` | 是 |
| — | Goal + Proactive Idle | `specs/v31-goal-proactive-idle.spec.ts` | 是 |
| — | 零素材图文首访（V31-73） | `specs/v31-zero-source-image-text-first-visit.spec.ts` | 是 |
| — | 零素材视频 fallback（V31-85） | `specs/v31-85-video-fallback-recipe-dead-end.spec.ts` | 是 |
| — | 同内容跨面重传（V31-87） | `specs/v31-87-same-content-reupload.spec.ts` | 是 |
| — | 素材库挂入 composer（V31-88） | `specs/v31-88-asset-library-composer-source-attach.spec.ts` | 是 |

其余文件名均为后续 wave 使用的确切路径；B2 按
V31-49 裁决复用已有 `v31-memory-injection-b2-journey.spec.ts`。gate 现在就按名索取，文件不在
时 `run-v31-browser-acceptance.sh` 在跑 Playwright 之前退出 1 并把缺失清单写入
`missing-specs.log`，不允许「少跑几条也算绿」。`scripts/ci/quality-gates.test.mjs`
同时校验仓库里每个 `v31-*.spec.ts` 都在该清单内，或登记为 instrument-only（D6=A：`v31-82` 无 stall fixture，不进必跑门；反向漂移仍 fail closed）。

F 从 context-fence 拆出后，E 与 F 的验收面不同：E＝确认前 price revision 变化 → 显示
diff → 旧确认不可提交 → 重新确认后执行；F＝Plan 形成后撤权 → Make admission fail
closed → 可换素材 → **不重复扣费（须验 ledger，不是页面文案）**。

**File:** `specs/v31-thread-root-workbench.spec.ts` | **Priority:** P1

| # | Test name | Flow |
|---|---|---|
| 1 | an explicit B deep link replaces a persisted A Composer Thread | 同一已登录工作区创建 Thread A/B → sessionStorage 持久化一条绑定 A 的 Composer task → 先打开 A 证明旧 handle 可恢复 → 同标签 deep link B → `agent-workbench-host[data-thread-id]` 必须为 B 且不得回退 A。 |

2026-08-09 登记三个 v3.1 journey spec（此前 v3.1 系列在目录中无登记，deep review 批次指
出 V31-16/17 缺失）。三个 spec 均为 write-only，实跑归 merge controller；均无
`test.skip`/`test.fixme`/条件 `isVisible` 包裹，面板锚定由真实交付保证。

**File:** `specs/v31-publish-handoff-selfreport.spec.ts` | **Priority:** P1

修复 P1-a/P1-b：Delivered ContentPackage 由真实 Composer fixture journey（image_text
合同，仅模型边界为 fixture）产生，发布交接面板无条件锚定。

| # | Test name | Flow |
|---|---|---|
| 1 | Delivered handoff anchors: copy blocks, ZIP name, QR merchant-self, no direct publish | 真实图文 journey 到 delivered（不离开会话）→ `publish-handoff-panel` 必现：`data-show-direct-publish=false`、无直发提示、copy blocks ≥3、ZIP 名非空、`mobile-publish-handoff` 为 merchant_self_publish 且 `data-system-driven-allowed=false`；驱动代发尝试→拒绝提示可见（A19 客户端 fail-closed）；「我已发布」`data-binding-revision` 与 `content_packages` 的 package revision 精确一致；点击确认已发布→「已记录发布」；同日不渲染自报 strip（`not_yet_next_day` 诚实，零伪造）；再切换到新 Thread 后旧 `publish-handoff-panel` / QR 必须消失，不得用旧 package 重新准备。 |
| 2 | A19 attempt_publish_from_handoff rejects driven intents via P1 | 直发 P1 `operations:attempt_publish_from_handoff`（system_driven_publish）→ 403 `DRIVEN_PUBLISH_FROM_HANDOFF_REJECTED`。 |
| 3 | self-report journey: next-day chips, once-per-work, two-ignore backoff | 真实交付后走真实 P1 边界：同日 ask→`not_yet_next_day`；次日记 `publishHandoffCompletedAt`→`ask` + 六 chips 全集；`mark_asked` 两次→409 `SELF_REPORT_ASK_CONFLICT`（once-per-work）；chips 落库为 merchant_recorded inquiry（V31-19 OutcomeEvidence 写路径）；回答后→`already_answered`；两个 work 连续 ignore→`store_backoff`。 |

**File:** `specs/v31-ops-console-release-journey.spec.ts` | **Priority:** P1

V31-22 AC4 全流程（review P1「声明的 Playwright 全流程不存在」修复）：admin 用户直驱真实
P1 `ops-console` 模块。

| # | Test name | Flow |
|---|---|---|
| 1 | 发布 → 圈 canary → 试跑 → 放量 → 回滚 → 审计留痕 | `publish_release` 全标定成功、缺 pin（U11 控制项未设）拒发且不产生 artifact；`transition_lifecycle` draft→evaluating→canary；`set_canary_allowlist` 生效；`set_candidate_trial` 记录；`promote_to_production`（U12 人工放量）；`diff_releases` 可读；第二 release 放量后 `rollback_production`（reason+evidence 强制）→ `list_releases.production` 回到旧 release（`resolveForRun` 只读 production lifecycle，此即「新任务走旧 release」的 P1 可观察面）、新 release retired、canary 空；`record_rollback_drill` passed 落库；`list_audit` 逐 action 断言 operator/reason/evidence 留痕。 |

**File:** `specs/v31-zero-source-image-text-first-visit.spec.ts` | **Priority:** P1

V31-73：零素材新账号选图文发送，不得走到「确认并开始→400」。**禁止**调用
`seedComposerInlineAuthorize`。

| # | Test name | Flow |
|---|---|---|
| 1 | 零素材选图文发送进入引导，走不到确认并开始 400 | 注册全新账号（不种案例图）→ dashboard → 选图文 → 填任意 prompt → 发送 → `composer-recipe-slot-guidance` 可见且 `data-slot=case_image` → 「去传素材」「换不需要案例图的写法」可见 → 无「确认并开始」→ 无「可以直接再发一次」→ 无 `POST /composer/submissions` → 报价行不出现「本次用量已确认」。 |

**File:** `specs/v31-85-video-fallback-recipe-dead-end.spec.ts` | **Priority:** P1

V31-85：零素材视频线不得展示假出口。视频 launch 配方均有 required slot，引导卡只留「去传素材」。

| # | Test name | Flow |
|---|---|---|
| 1 | 零素材选视频进入诚实引导，没有假出口也不提交 | 注册全新账号 → 选视频 → 发送 → 引导卡可见且 `data-can-switch=false` → 「去传素材」可见、「换不需要案例图的写法」0 命中、「改一改再发就好」0 命中 → 无「确认并开始」→ 无 `POST /composer/submissions`。 |

**File:** `specs/v31-87-same-content-reupload.spec.ts` | **Priority:** P1

V31-87：素材页已授权图片在 composer 内联重传同字节，不得 409，素材库不得出现同内容重复资产。全栈跑归主控。

| # | Test name | Flow |
|---|---|---|
| 1 | 素材页授权后再在 composer 内联重传同图不 409 且不重复建资产 | 确认门店 → 素材页上传并授权 → composer 内联再传同一张图 → 无 409、无「请重试」、`objectKey` 只对应一条资产。 |

**File:** `specs/v31-88-asset-library-composer-source-attach.spec.ts` | **Priority:** P1

V31-88：素材页已授权资产经 composer 挑选进入 `draft.sources`。**禁止**调用 `seedComposerInlineAuthorize`。

| # | Test name | Flow |
|---|---|---|
| 1 | 素材页已授权资产经挑选进入 sources 后图文提交 <400 | 确认门店 → 素材页上传并授权为 customer_case → composer 选图文套用案例配方 → 「从素材库选择」挂源 → 提交 `<400`。 |

**File:** `specs/v31-day0-free-creation-journey.spec.ts` | **Priority:** P1

V31-07 §37.4-A（review P2 修复）：零门店商家 Day-0 自由创作。

| # | Test name | Flow |
|---|---|---|
| 1 | 零门店商家 free 模式提交自由创作，得到不带虚构门店事实的通用结果 | 不种门店（ProductState.store=null 为诚实前置）→ 切「自由创作」入口（D-111）→ copy lens + 显式选模型 + 目的地小红书 → 通用 intent 提交 202 → 首 token + 候选可见 + 交付卡到达 → `data-delivered=true`；全程无 `composer-grounding-blocker`（D-175 free 不被缺 confirmed_store/project 阻断）；`content_packages` 正文与候选文本非空且**排他断言**不含从未种过的门店名/项目/地址（零虚构门店事实）。 |

**File:** `specs/v31-memory-injection-b2-journey.spec.ts` | **Priority:** P1

V31-18 §37.4-B2（adversarial review 修复）：记忆注入透明度与撤销。**双记忆**是本 spec 的核心约束——单记忆时撤销后 receipt 结构上不可能存在，`toHaveCount(0)` 在「记忆层整体坏掉」时同样通过，无法区分「撤销生效」与「从未注入」。

| # | Test name | Flow |
|---|---|---|
| 1 | 撤销两条已确认记忆中的一条，只有那一条不再注入 | 两次提交各声明一条长期偏好 → 各自沉淀 pending → Memory UI 逐条「确认记住」→ 第三次提交后任务详情 receipt 面板**同时**列出两条，两条来源行分别内联真实 preview（按 statement 关联 memoryId，不用 memory 页 `entryId`）→ 删除幸存条来源对话 → 回到同一任务，该条显示「来源对话已删除」且 preview 消失，另一条 preview 仍可读 → 只撤销另一条 → 就地断言该条 disabled+已撤销、幸存条仍 enabled（V31-34：`currentStatus` 服务端投影，非本地 Set）→ 刷新任务详情后被撤条仍 disabled+已撤销、幸存条仍 enabled → `entries_page` 服务端断言幸存条仍 confirmed、被撤条不再 confirmed → 第四次提交：receipt 面板仍在且**正向**含幸存条 1 条、被撤条 0 条，幸存条继续显示已删除且不再泄漏 preview。原「风格约束生效」断言（标题≤24／正文≤32／无禁用词）已移除：它只因 fixture 自读 prompt（`ai-sdk-runner.ts:1657`）返回硬编码合规文案而通过，真实约束改由 `assessMemoryStyleCompliance` 单测对真实输出断言。 |

## V31-15 Artifact 原位生长（§5.5 / V31-49 / V31-62）

**File:** `specs/v31-artifact-growth-journey.spec.ts` | **Priority:** P1

V31-49 §三 / plan §5.5 四件合同 + V31-15 AC2/3/4 定向绿证（V31-62）。真实图文
fixture journey（仅模型边界 fixture）。AC2 用 Core `e2eAgentFault`（`artifact-head-replay`
/ `artifact-gap-close`）真实扰动，**不** `route.fulfill` 伪造成功。乱序/重复/跳 revision
的纯 reconcile 合同在 unit 轴（`packages/contracts` + `agent-event-reducer`）取证。

| # | Test name | Flow |
|---|---|---|
| 1 | AC1: stable Artifact id grows in place on the right rail without triple object cards | 注册商家 → seed 门店+授权素材 → 小红书图文提交 → 方向确认 → Make 中右栏首次挂载 Artifact 取 `data-artifact-id` → 后续采样同 id、`agent-artifact-card` 恒为 1、签名/revision 证明内容生长 → 左 `agent-workstream-process` 承载会话、右 `agent-workstream-works` 只承载 Artifact → ready 后 expanded candidate 不叠 Result Center、`data-artifact-count=1`。 |
| 2 | AC2: SSE gap-close + head-replay reconnect keeps one Artifact and recovers ready | 同上进入 Make → 首条 events 流注入 `artifact-gap-close`（丢一 revision 后断流）+ replay 注入 `artifact-head-replay`（冷/resync 只回第一条 artifact）→ 主机自动重连（`replayCalls≥2`/`eventCalls≥2`/`x-meiye-e2e-agent-fault-applied` 双故障）→ 同 `data-artifact-id` 恢复 `ready`、卡片恒 1。 |
| 3 | AC3: mobile viewport Artifact fullscreen sheet open/close/content | viewport 390×844 → `data-viewport=mobile` + `agent-mobile-process-works-switch` → 默认过程无 sheet → 点作品打开 `agent-artifact-mobile-sheet`（dialog）见同 id Artifact 内容 → 关闭回过程 → 再开同 id、revision 不回退 → ready 后仍可关 sheet。 |
| 4 | AC4: derived revision after page regen enables version lookback without overwrite | ready 后无 `agent-artifact-version-browser` → timeline 点 `note-plan-page-regenerate`（真实 `result_adjust_prepare`/`result_adjust`）→ 同 id revision 前进 → 版本浏览器 ≥2 chips → 点历史 chip 看 `data-viewing-revision`（`data-revision` 仍为 live）→ 点「当前」回到 live head；卡片恒 1。 |

## V31-15 Artifact 旅程缺口（其余未实施面，登记待领）

2026-08-09 登记。`specs/xhs-image-text-main-journey.spec.ts` 是此前唯一见证
`artifact.revised` 的浏览器旅程；`v31-artifact-growth-journey.spec.ts` 已覆盖 §5.5
四件（稳定 id / 原位生长 / 左右分工 / 无三重卡）。它已覆盖的部分是真的：
中途断流 → 主机自行重连 → `artifact-head-replay` / `artifact-gap-close` 两个故障
标记 → 单卡片不分裂 → 末条 `status=ready`。下面五条是它**没有**覆盖的面，逐条写出
必须见证什么。全部尚未实现，本节只是合同；实现方按目录既有体例把条目移入自己的
spec 段落，不要在本节挂 `test.skip`/`test.fixme` 占位。

| # | 待实施旅程 | 必须见证的流 |
|---|---|---|
| 1 | 非连续子集重生落在各自源页 | 现有旅程只重生**第 1 页**——恰好是 `pageIndex` 塌缩到 0 时唯一「碰巧正确」的那一页（core 侧塌缩已修，见 `note-page-execution-frame.ts` 的 `sourcePageOrder`）。旅程须选**页 3 与页 5** 这类非连续子集：确认卡 → confirm → 商家进度文案逐条为「正在生成第 3 页配图」「第 3 页配图已完成」「正在生成第 5 页配图」…（**排他断言**不出现裸 page id，如「第 page-3 页」）→ 卡片上第 3/5 行 `data-image-status` 走 generating→ready 而第 1/2/4 行的 imageRef **不变**（重生前后取属性对比，不是「存在即通过」）。 |
| 2 | 版本回看 | 交付后回看历史 revision：卡片上打开版本列表 → 选一条早于当前的 revision → 面板渲染**那一条**的页文案与配图（与当前 revision 断言不等）→ 返回最新不留残影（`data-revision` 回到最大值）。当前无任何浏览器证据表明版本回看可达，实现前先按 #333 的教训确认它**从 UI 真的可达**，不可达就照实记 BLOCKED 而不是写个能过的断言。 |
| 3 | 刷新后重新水合 | 现有旅程刻意「never reloads the page」，所以冷启动水合从未被见证。旅程须在 artifact 处于 `partial`（若干页 ready、若干页 generating）时 `page.reload()` → 冷 replay 后卡片恢复到**刷新前那些页的同一状态**（逐行 `data-image-status` 对比，不是只看卡片存在）→ 随后仍能收到剩余页的实时 revision 直到 `ready`；且刷新不产生第二张卡片。刷新前后的 `data-revision` 单调不回退。 |
| 4 | 视频 artifact | 只有 note 侧被见证过。视频链同样发 `artifact.revised`（`emitVideoScenesArtifactProgress`，storyboard 编译时 running、成片选定后 success）。旅程须走视频 lens 到交付：分镜行按 `sceneIndex` 逐条出现且带 storyboard 文案 → `keyframeStatus` generating→ready → 末条 `status=ready` → 单卡片。 |
| 5 | 阶段生长断言到位，而不是数条数 | 现有断言是 `artifacts.length >= 3` 加末条 ready，这对「三条都是同一阶段」也成立。旅程须按页断言 `骨架 → 文案 → 配图` 的**次序**：同一 `pageIndex` 上先出现 `stage=skeleton`，再 `stage=copy` 且带 body 文案，最后 `stage=image` 且 `imageStatus` 由 generating 转 ready；跨页断言页序，不用总条数代替。 |
