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
Main, Core, Worker, and Canvas harness without making every ordinary pull
request wait for the multi-service browser suite. A catalog row marked
`MISSING SPEC` is an acceptance intent, not executable coverage.

## Test Harness

- Config: `playwright.config.ts`
- Specs: `tests/e2e/specs/`
- Fixtures: `tests/e2e/fixtures/`
- Test-only APIs: `src/routes/api/e2e/users.ts` and
  `src/routes/api/e2e/pro-studio-payment.ts`

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
| 1 | User can complete the P1 recorded-provider journey | Select an available image model; confirm store/asset facts and generate grounded copy; create a weekly task, run a real idempotent Product batch action, and produce a fact-only weekly review; load the Product image through the workspace storage proxy, insert it into a blank canvas, persist its exact Product asset ID, submit a durable image job, let the separately started P1 Worker complete it, and recover the completed job after reload; toggle the optional watermark and AIGC labels; create, explicitly confirm, recover, and cancel a video storyboard without a stale Worker overwriting the cancellation; then verify each search scope exposes its required structured filters. |

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
| 1 | Recorded integrations stay usable and honestly labeled | Create a write-only workspace BYOK connection, verify recorded mode is labeled as demo execution, execute a published model/profile, and verify Product Usage plus externally billed Provider Cost; open external connections and verify Douyin is labeled not integrated before any credential input; create and verify a Feishu UAT connection, consume the automatically published vendored tool revision, pin a shortcut, execute an explicit read intent, and recover both shortcut and activity after reload. |

## 10. UI/UX Pre-Cutover Quality Baseline

**File:** `specs/uiux-precutover-baseline.spec.ts` | **Priority:** P0

Pins the last stable dashboard before the one-time UI/UX cutover. The test stores
only aggregate accessibility rule counts, DOM/query counts, layout overflow, and
focus evidence; it must not attach user copy, media, credentials, or tokens.

| # | Test name | Flow |
|---|---|---|
| 1 | Dashboard stays within the recorded pre-cutover quality envelope | Sign in with an E2E admin, reload `/dashboard`, run WCAG 2.2 AA axe checks, count Product Core requests and DOM nodes, verify keyboard focus is visible, measure 1280px at 200% effective width, and attach a redacted aggregate report. New high-impact violations or regressions above the frozen envelope fail. |

## 11. S1 Product Shell And Canonical Routes

**File:** `specs/uiux-shell-routes.spec.ts` | **Priority:** P0

Locks the one-time shell cutover before feature surfaces move onto the canonical
object graph.

| # | Test name | Flow |
|---|---|---|
| 1 | Product shell exposes one six-item business navigation | Sign in as an admin, verify the six business destinations appear once and in the frozen order, settings stays in the utility area, the locked product brand and guide tokens are active, light-mode action text and page focus use accessible tokens, a real Tab-focused control retains a visible high-contrast sidebar ring, and admin mode is reachable only from the user menu. |
| 2 | Canonical routes survive deep links and reloads | Open the task, asset, session, work, job, settings, and six admin routes directly; reload each route and verify its canonical heading remains available. |
| 3 | Legacy routes only redirect through the frozen allowlist | Open legacy files, API key, profile, integration, and P1 admin locations; verify each lands on its fixed canonical destination without accepting an arbitrary return URL. |
| 4 | Admin authorization fails in both navigation and routing | Sign in as a non-admin, verify no management entry is rendered, open an admin deep link, and verify the server redirects to the workbench. |
| 5 | Shell remains keyboard and 200-percent-zoom reachable | At the 640px effective viewport, verify no horizontal overflow, focus the skip link first, activate it, and confirm focus returns to the product content region. |

## 12. S2 Cold Start And Unified Creation Loop

**File:** `specs/uiux-creation-loop.spec.ts` | **Priority:** P0

Locks the canonical `Work -> Job -> Assets -> ContentPackage` boundary and
the six fixed expert-agent journeys. These are deterministic candidate-build
checks; they are not evidence of testing with real target users.

| # | Test name | Flow |
|---|---|---|
| 1 | E0 example is opt-in and can be remixed without creating business objects | Sign in to an empty workspace, prove the personal workbench does not mix in example content, explicitly choose “View example,” browse the read-only example store, use “remix” to prefill an editable intent, and prove no Work, Job, Asset, or ContentPackage is created. Close the example, reload, and prove it remains opt-in. |
| 2 | E1 reuses the existing Task without copying it | Create one real Operations Task, return to the cold start, select that source, explicitly create one Work, and assert the Task count is unchanged and the Work retains the canonical Task reference. |
| 3 | Composer uploads, authorizes, drops, pastes, and removes real image references | Confirm material facts and public-use scope inside each upload card. For a restricted before/after portrait, persist an evidence reference, applicable platform, and explicit no-expiry grant before attaching it. Verify the separate camera and gallery contracts, remove one authorized image from this creation while preserving it in the asset library, then add authorized images through drag-and-drop and clipboard paste. Create one Work and verify only the two retained Product Asset IDs persist as visible source references. |
| 4 | Explicit contract produces Assets before one accepted ContentPackage | Review operation, active model, specification, quote, watermark, and AIGC controls. Submit once, verify A/B/C are internal Assets while legacy Content remains empty, select candidate B with the authorized real store photo, and create exactly one ContentPackage. Generate an image in the same Session, explicitly attach it to that package, open the stable package route, prove the current version and all three platform variants inherit the generated owned Asset, reload to prove persistence, export the package ZIP, verify the honest assisted-delivery state, record the native published result, use one store-visit chip to advance the cumulative result ladder without causal claims, and continue from weekly review by creating a new source-linked Task without cloning the old ContentPackage. From the exact current package version, choose the poster export use, open Light Composer, and prove the server-created 1080×1080 Work contains the source title, body, CTA, and package/version lineage instead of a blank client-seeded document. |
| 5 | Async recovery, reload, and derivation preserve the object graph | Submit an internal image tool Job through the deterministic worker, verify the running Job until its Asset is recovered and saved to Materials without a legacy Content write, then reload and derive a new draft Work without rewriting the completed source objects. |
| 6 | Unverified models and recovery branches remain honest | Replace the catalog response with a recorded-only deployment and verify submission is disabled with an explicit reason. Core state-machine coverage proves recoverable resumes the same Job, running/unknown only verify the original Job, terminal failure creates `retryOf`, and changed execution input creates `derivedFrom`. |

## 13. S3 Operations, Reuse, Asset, And History

**File:** `specs/uiux-operations-reuse.spec.ts` | **Priority:** P0

Locks the desktop Operations rail, shared reuse catalog, explicit tool Job
boundary, canonical history, and Canvas owning-route boundary.

| # | Test name | Flow |
|---|---|---|
| 1 | Rail stays thin and complete work stays canonical | Create normal and publication Tasks, verify the workbench shows one next action, five weekdays, and anomaly summary, open the complete Task inbox, switch to the URL-backed week view, and assert publication is excluded from the executable batch while a missing review stays an explicit create action. |
| 2 | One catalog inserts tools and references without hidden execution | Create one Work, choose an image tool from the contextual shelf, assert no Job exists, open the same catalog with `Cmd+K`, verify an honest empty result, use reference decomposition with zero fields selected, persist an explicit historical Work reference, then explicitly execute and assert one Job. Reload URL-backed Search and verify the same canonical Work remains. |
| 3 | Daily light editor owns Canvas Work routes and compliance exports | Create a blank Canvas Work from the shared catalog, enter its exact `/dashboard/works/:id` route, edit copy, crop and reorder its modules, save the revision, then export all four watermark/AIGC switch combinations. Verify four distinct PNG binaries and matching receipts with image, font, CJK line-break, raster dimension, and SHA-256 evidence; return to the same route and capture the visible daily light editor without any Polotno request. |

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
| 5 | English locale retains route context and keeps empty product chrome free of Chinese leakage | Switch an empty Asset page to English while preserving path, query, hash, and login state; verify English chrome contains no Chinese beyond the allowed product brand or internal model/template residue, reload without losing locale, and navigate to the English Content page without dropping the `/en` prefix. |
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

## 19. UI/UX Upgrade B Durable Video Workflow

**File:** `specs/uiux-upgrade-b-video.spec.ts` | **Priority:** P0

Locks the composed-video workflow as one durable, recoverable track rather than
a duplicate generic creative Job or synchronous render request.

| # | Test name | Flow |
|---|---|---|
| 1 | A Work edits and restores V1 before completing one durable video workflow | Create and lock an AIDA storyboard, prove every draft freezes the accepted 15-second 9:16 quote into explicit 4/4/4/3 shot timing and 720x1280 framing, derive a V2 workflow instead of mutating V1, reload the same revision, confirm it for background execution, recover and complete any required shot review on mobile, play the authorized MP4, reload the completed workflow on desktop and its ContentPackage detail with the exact completed workflow still visible, prove mobile Handoff stays bound to that Work after a newer unrelated package exists, verify no generic video Job or legacy synchronous process request was submitted, and prove the retired legacy route returns 404 through the API request context. |
| 2 | A confirmed workflow can be cancelled and restores cancellation after reload | Lock and confirm a video storyboard, explicitly cancel the running workflow, wait for the durable cancelled state, reload, and verify the same workflow remains cancelled without another cancel action. |

## 20. UI/UX Upgrade B I18n, Motion, And Mobile Contracts

**File:** `specs/uiux-upgrade-b-i18n-motion.spec.ts` | **Priority:** P0

Locks clean-visit Chinese defaults, bidirectional product-copy convergence,
route-safe locale switching, public model metadata, real publication motion,
and complete touch-target audits at the two target mobile viewports.

| # | Test name | Flow |
|---|---|---|
| 1 | A clean first visit and authenticated workbench default completely to Chinese | Clear locale cookies, open the unprefixed login route, verify the Chinese locale and system copy, sign in, and verify the unprefixed workbench remains Chinese with only explicit product vocabulary and user data excluded from the Latin-copy scan. |
| 2 | English core product surfaces expose no Chinese system copy | Open the English workbench, tasks, assets, content, leads, and store routes; remove only approved pass-through names and verify no Chinese system copy remains. |
| 3 | Language switching preserves route, query, hash, session, and one-language copy in both directions | Switch an authenticated Asset URL from Chinese to English and back, reload between changes, verify the path, query, hash, and session remain intact, then scan the returned Chinese surface for stray English system copy with a small explicit vocabulary allowlist. |
| 4 | Model cards retain public metadata while hiding internal identifiers | Visit the English model settings for copy, image, and video; verify each tab has selectable public cards and no recorded deployment, internal model, placeholder-version, or undefined identifier leaks. |
| 5 | Reduced motion keeps the real pending-generation accent readable and static at the 18px desktop root | Verify desktop product typography, create one Work, discover and submit its real execution action, hold it pending, and prove the reduced-motion accent keeps readable static text without animation or gradient transparency. |
| 6 | A real manual publication transition celebrates once and stays static under reduced motion | Create an accepted Product content item and L3 package through the mobile UI, report “not published” through the real handoff page and verify no celebration, report “published,” sync the mobile Product state through a real upload, verify exactly one readable celebration with hidden particles, then reload and verify it does not replay. |
| 7 | The 379x820 mobile product keeps every visible target usable in all three stages and both locales | At 379x820, verify 18px product typography and no overflow, then scan every visible Action, Progress, and Handoff control in Chinese and English for a minimum 48x48px hit area; exclude only inline prose links whose target follows text-flow spacing. |
| 8 | The 390x844 mobile product keeps every visible target usable in all three stages and both locales | Repeat the complete bilingual three-stage target, typography, and overflow audit at 390x844 and retain separate Action, Progress, and Handoff evidence frames. |

## 21. Pro Studio Entitlement Checkout

**File:** `specs/pro-studio-entitlement.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | A tenant without the entitlement sees a locked workbench entry that never enters the workspace | Sign in, open `/dashboard`, and require the Pro Studio entry to report the canonical `locked` state with a "了解并解锁" call to action and no "进入专业工作区" promise. Click it and require the canonical `/pro-studio` gate, the locked gate state, the purchase offer, no unlocked copy, no one-click entry, and an origin that is not Canvas. |
| 2 | A tenant with the entitlement sees an active workbench entry that enters the workspace | From the same locked start, settle the fixture-signed paid webhook, reload `/dashboard`, and require the entry to report `active` with the "进入专业工作区" call to action. Click it and require the `/pro-studio` gate to report `active` with the unlocked copy and the one-click entry action. |
| 3 | Unpurchased Owner sees the dedicated offer and server-owned checkout action | Sign in as a workspace Owner, open `/pro-studio`, verify the explanation/demo/price surface and a POST form to the dedicated checkout route; no workspace, price, or payment fact is submitted by the browser. |
| 4 | Fixture-signed webhook unlocks Pro Studio and completes Canvas SSO | In local E2E mode, submit an HMAC-signed fixed-schema paid Stripe checkout event. A fixed fixture provider runs the production Owner-session checkout binding and canonical catalog validation before the provider payment, claim, lease, and Canvas activation path. Reload `/pro-studio`, verify “工作区已解锁”, click “一键进入”, and require the Canvas origin, workspace shell, session cookie, and CSRF cookie. |
| 5 | Real provider hosted-checkout smoke remains opt-in | With explicit real-provider credentials and `PLAYWRIGHT_REAL_PRO_STUDIO_CHECKOUT_URL`, verify the hosted checkout is reachable. This smoke does not replace the default signed-fixture activation closure and does not claim a completed real payment. |

## 22. Pro Studio Engineering And Cross-Service Smoke

**Files:** `specs/pro-studio-engineering-tickets.spec.ts`,
`specs/pro-studio-cross-service-smoke.spec.ts`,
`specs/pro-studio-kernel-ui.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Engineering tickets keep their bounded UI and lifecycle journeys | Verify the fixture entitlement and prompt seeds; in Light Composer, upload and authorize a distinctive asset, replace and source-crop an image without changing its destination box, save the normalized crop in a revision, export and sample the cropped PNG pixels, and adopt it into ContentPackage; then verify merchant diagnostics and media-custody recovery through the owning product routes. |
| 2 | Cross-service generation is adopted into the main ContentPackage library | Register and sign in, unlock the fixture workspace, enter Canvas, create a project and checkpoint, generate a recorded image, save the graph, adopt the Advanced Canvas output, and verify the resulting package is visible in Main ContentPackage. |
| 3 | Recorded TTS and SFX complete through Core and remain playable in Canvas | In the same real Main + Canvas + Core + Postgres harness, quote and submit independent `audio.speech` and `audio.sfx` jobs, let the durable Worker recover both, persist decoded workspace-owned audio, render two Canvas audio players, verify bounded Range delivery, and require server-controlled attachment headers for download. |
| 4 | Authorized kernel completes the full UI creation and adoption journey | With `MODEL_EXECUTION_MODE=fixture`, use only visible Canvas controls after fixture registration and entitlement unlock: create a project through the keyboard-accessible name form, then create and soft-delete a disposable project through the visible cancellable confirmation layer with focus restored to its trigger; edit a text node, click “返回主产品” before saving, capture and dismiss the native `beforeunload` warning, prove the Canvas and unsaved state remain, then save and refresh under the existing autosave/OCC contract; upload and insert an owned image, select and connect nodes, and run square crop into a distinct square OwnedAsset and derived node; Shift-drag a visible background marquee around two nodes, drag the selected group by one shared delta, undo the move, redo it, save, and refresh media; start a cookie-clean browser context, sign in as the same user, and restore the same project, media, and edges; select the text anchor so its visible graph edge supplies the reference image, create a checkpoint, quote and submit image generation, refresh the task projection, insert the result with an input-derived edge, select text then generated media in order, adopt through the UI, verify the adopted badge, and open the same package in the Main ContentPackage library. This journey must not depend on native prompt or confirm dialogs; its browser `beforeunload` safeguard remains required. Capture `docs/evidence/pro-studio/kernel-v1-ui-smoke.png`. |

## 23. Pro Studio Security Boundaries

**File:** `specs/pro-studio-security-boundaries.spec.ts` | **Priority:** P0

This is a fixture-local cross-service drill. It runs the real Main, Canvas, Core,
Worker, and Postgres services while keeping model/media execution in
`MODEL_EXECUTION_MODE=fixture`; it is not live-provider or production-release
evidence.

| # | Test name | Flow |
|---|---|---|
| 1 | Cross-workspace objects remain opaque and auditable | Create independent workspaces and reject foreign projects, revisions, assets, generation jobs, ContentPackages, the disabled Grant branch, and Agent confirmations with one opaque response; prove projects/assets/jobs/adoptions remain unchanged and reread seven workspace-scoped PostgreSQL rejection audits containing target hashes rather than raw IDs. |
| 2 | Dual Canvas sessions preserve CAS zero-write | Plan and confirm the same revision in two sessions, require the stale apply to return `REVISION_CONFLICT` with no write, then re-read, re-plan, confirm, and apply successfully. |
| 3 | Identity switch clears caches and fences late responses | Hold a stale `listProjects` response across sign-out and identity switch, then verify workspace-scoped storage/cache cleanup, the new cache namespace, and no stale project rendering. |

## 24. Marketing Entry Gates And Blocking Question

**File:** `specs/marketing-composer-harness.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Only complete marketing entries switch the canonical Composer context | Seed one D-023-complete entry and one entry missing any single MarketingPackage capability; open the canonical dashboard, verify only the complete entry is visible, click it, and verify the editable intent plus recommended tools change in place without navigation or a field form. Legacy scene chips appear only as secondary choices under the released parent. |
| 2 | One server-owned question persists and resumes the harness | Start a Harness task with one missing authoritative fact, follow its stable SSE progress into `suspended`, render exactly one inline QuestionCard, answer it, and require the structured decision to bind the server-declared field, task, question, workflow revision, scope, and idempotency key. Reload to prove the question is no longer pending and follow the same SSE stream through resumed progress to the delivered ContentPackage revision. Replaying the same answer is idempotent; a stale revision and a changed target both return 409. |

## 25. Day-0 Recommendation And Example Store

**File:** `specs/uiux-creation-loop.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Example storefront stays opt-in and isolated below the canonical Composer | Open an empty workspace, verify the honest Day-0 recommendation invitation and editable Composer are present, reveal the read-only three-industry sample showcase (护发／皮肤管理／生发), switch industry, remix a sample structure into the Composer, and prove browsing, remixing, hiding, and reloading create no Work, Job, Asset, ContentPackage, or store fact. |
| 2 | Today recommendation follows the persisted fact revision state | Read revision 0 as an honest invitation, then read a server recommendation bound to revision 1 and verify why-now, the merchant-language fact count (never a `store_fact:` id), customer action, source, and the compact active opportunity summary. Verify the CTA prefills the Composer draft in place instead of navigating. Advance to revision 2 and verify the revision-1 recommendation and its opportunity are withheld instead of being described as current personalization. |

## 25b. D-126 Dashboard Home Mount (Hot / Cold)

**File:** `specs/dashboard-home-mount.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Cold tenant sees three sample stores and runs a sample task on the real chain | Register a cold tenant, verify the Day-0 recommendation invitation and the opt-in sample entry, reveal all three C-5 industries, and read the sample store's profile, confirmed facts, material, and works. Assert the trial tier allowance is 5/5/1, remix a sample task so the Composer draft is prefilled, submit it through the real submission chain, wait for the Result Center, and prove the trial copy remainder dropped and the artifact downloads through the same export path a paying merchant uses. |
| 2 | platform_sample material never reaches the merchant workspace | Collect every platform-sample id from the revealed showcase, seed the merchant's own confirmed store, and assert the merchant's own facts are present (positive control) while no sample id appears in product state assets/contents/handoffs or in the creative workbench assets/contents/works/jobs projection. A workspace with real facts stops offering samples entirely. |
| 3 | Hot tenant gets one recommendation whose CTA prefills the Composer | Seed confirmed store facts, drive the real five-stage Harness to a delivered package (no route stubbing), poll the real recommendation API until it is grounded, and verify the card shows all three explanation elements plus a merchant-language fact count. Click the CTA and prove the Composer draft is prefilled and focused on the same page — no navigation, no auto-submit. |
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

## 28. V1 Day-0 Experience Contract Hard Gate

**File:** `specs/uiux-day0-contract.spec.ts` | **Priority:** P0

Implements D-043 Day-0 contract + V1 复审修订七条计数口径. Metric name: **用户激活次数**. Capture layer: `fixtures/user-activation.ts` (`page.addInitScript` + `page.exposeBinding`, only top-level `event.isTrusted` primary-button clicks; Cmd/Ctrl+Enter counts as 1 keyboard activation). First-token endpoint: `[data-has-token="true"]` on harness primary/alternative candidates and copy-stream slots. Seed boundary: register/login/`seedConfirmedStore`/`seedComposerInlineAuthorize` are measurement prep (composer path — **not** `seedAuthorizedGrounding` library path); counter is zeroed after prep. The spec uses the real Web → Core → Harness/DBOS HTTP+SSE chain with an isolated DBOS database; only the model provider boundary is deterministic fixture mode. Product HTTP/SSE calls are never mocked. Screenshots do not replace these assertions. Tour script: `scripts/uiux/day0-tour-screenshots.mjs` → `docs/evidence/ux-fold-supply-day0/`.

| # | Test name | Flow |
|---|---|---|
| 1 | Canonical mouse path: ≤2 user activations to first token, 0 blocking cards | After seed prep, zero the capture counter, fill composer intent, click submit (never click 暂时跳过), assert 0 blocking questions / Brief confirm before submit, wait for first `[data-has-token="true"]`, stop counting, require 用户激活次数 ≤ 2 and no-conflict path still has 0 blocking cards. Also require the authenticated product-metric request selected by `first-usable-draft-v1:` idempotency prefix plus valid path/time/count fields to receive HTTP 202, carry the captured count, and report `canonical_mouse` (the documented non-conflict precision sample). |
| 2 | Keyboard submit path counts as 1 user activation (equivalence) | Same prep; submit via Cmd/Ctrl+Enter; require exactly one `keyboard_submit` activation and first token visible. |
| 3 | Conflict path: exactly one question then continue (exempt from ≤2) | Submit a fixture intent that makes the real Harness return one server-owned free-text question; answer it, click 确认并继续, assert exactly one question, URL unchanged, card clears, and a real first token arrives. Does **not** apply the ≤2 activation gate. |
| 4 | T5 independent: upload → inline one-question → evidence → continue | On `/dashboard`, set composer gallery file, assert one inline authorization question (no library evidence form), confirm public marketing, require URL stays on dashboard (no `/dashboard/assets/:id` hop), and observe the actual `add_asset` metadata plus `authorize_asset` command with `rightsEvidence=system:inline-auth:…`. Then submit from the same composer and require a real first token. |
| 5 | Capture layer survives navigation and ignores child frames | Begin measurement on authenticated dashboard, click a trusted control inside a child frame and require count 0, then use two real top-level links that perform full document navigations. Require `page.exposeBinding` to preserve exactly two captured activations across both documents. |

## 29. Live Creation Catalog Capability Gate

**File:** `specs/catalog-live-navigation.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Server catalog hides ordinary tools without a verified execution chain | Open the authenticated full-screen catalog and require both `surface_browser` and `tool_list`; select an exact published Recipe revision and verify Composer adopts its lens; verify unverified ordinary tools are absent from the tools tab and a direct `/dashboard/tools/:toolEntryId` request renders unavailable instead of an empty tool workspace. |

## 30. Recipe / Surface Admin Lifecycle

**File:** `specs/admin-creation-experience-lifecycle.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Admin visually publishes and rolls back Recipe and Surface revisions | Sign in as an admin, use the `/admin/templates` visual editor to draft, preview, publish, revise, and roll back a Recipe; compose a Surface from the published Recipe revision, verify only capability-approved Pro Studio is offered, then draft, preview, publish, revise, and roll back the Surface through the real Creation Experience API. |

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

**File:** `specs/admin-dashboard-shell.spec.ts` | **Priority:** P0 | **Tickets:** T35 / #229

Locks 运营后台 on the template-dashboard shell and the hand-entry seam behind the
three-bucket numbers. Every assertion runs against the live stack: the admin
surfaces read the real admin-config / model-supply / job-runtime projections, so
none of these can pass on fixture data (ADR-0019 / D-131).

| # | Test name | Flow |
|---|---|---|
| 1 | Every admin page renders the template-dashboard shell in both themes | Sign in as an administrator and walk `/admin`, `/admin/models`, `/admin/templates`, `/admin/integrations`, `/admin/plans`, `/admin/users` and `/admin/audit`; require the Glass token-bridge host class and a HeroUI sidebar item on each, require the merchant shell no longer wraps 后台, and require a resolved background in both light and dark. |
| 2 | A hand-entered three-bucket number reaches the merchant through governed config | Hand-enter the trial copy bucket on `/admin/plans`, pass impact review with an audit reason, require the editor's CAS revision line to advance, then register a store and require its `/settings/account` to read that number with nothing redeployed. The governed key feeds the catalog and provisioning materialises it at activation, so the number reaches stores provisioned after the change — an already-provisioned workspace is not rewritten, by design. |
| 3 | Model assembly separates the catalog layer from the channel layer | On `/admin/models`, require the CatalogModel and ExecutionChannel layers to render as separate panels and require each to carry only its own governed keys. |

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
| 3 | Pricing tiers render the approved wording with the pilot disclosure | In `#pricing`, verify Starter 免费, Growth ¥399 under the 上线特惠 badge with a CTA whose text is exactly 升级 Growth pointing at `/auth/register`, and 终身版 disabled at 敬请期待 with no link. The wording is the user's own call; what keeps it honest is the footnote, so also assert 线上支付未开放 and 兑换码 are on the page and that no 立即购买/订阅/升级 imperative appears. |
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

## 34. Pro Studio G-index Local And Release QA

**Files:** `specs/pro-studio-k2-canvas.spec.ts`,
`specs/pro-studio-kernel-ui.spec.ts`,
`specs/pro-studio-cross-service-smoke.spec.ts`,
`specs/pro-studio-security-boundaries.spec.ts` | **Priority:** P0 | **Tickets:** #163–#169

These are visible, fixture-local acceptance journeys for the current G-index
implementation. A catalog row is not a passing run: it requires the real local
Main, Core, Worker, Canvas, and PostgreSQL harness. It is never live-provider,
protected-release, pricing-approval, or manual-security-approval evidence.

| # | Test name | Flow |
|---|---|---|
| 1 | G01–G25 graph interaction stays visible and merchant-safe | Unlock the fixture workspace, create a project using the visible name dialog, create/select five node types, use the rich node controls, preview an owned image, adjust text/resize, marquee/multi-select, connect/copy/delete, change background/minimap/zoom controls, open the node info surface, and exercise the hover quick-tool preference. Require no raw node, asset, workspace, model, or provider identifier in rendered merchant copy. |
| 2 | G26–G31 retouch creates governed child lineage | Insert an owned image through the visible picker, use crop/mask/upscale/split/angle/reverse-prompt controls, confirm the quote where required, and verify each result is a distinct owned child with a derived graph edge. A fixture result proves only the local durable path; it does not prove a live model or provider. |
| 3 | G32–G41 contextual generation is fail-closed and recoverable | Select a text/image/config node, open the visible node generation surface, prove an inactive catalog cannot quote or submit, then use an active fixture capability with an explicit `@` mention. Exercise 1 and 15 item quote/confirmation, partial failure, retry/cancel, durable text-stream cursor recovery, prompt search, and image/video/audio asset pagination without injecting an unmentioned resource. |
| 4 | G43–G48 project/export controls preserve product boundaries | Create, rename, select and soft-delete a disposable project through visible confirmation dialogs; use beforeunload with an unsaved draft; create a checkpoint; export a frozen revision with the explicit available-only choice; and verify the result remains a Canvas ZIP manifest rather than a ContentPackage write. Recheck the adopted badge and Main ContentPackage only through the existing cross-service smoke. |
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

**File:** `specs/p1-f2-acceptance.spec.ts` | **Priority:** P0 | **Ticket:** #161

Continuous recorded-mode acceptance for P1 productization. Primary seam is a
logged-in browser through the public App Shell HTTP+SSE BFF into Core with
`MODEL_EXECUTION_MODE=fixture` (recorded adapters). Frontend fixture
short-circuits are never treated as #161 pass evidence. Evidence and residuals:
`docs/evidence/p1-f2-161/README.md`. Production-build opt-in:
`PLAYWRIGHT_PRODUCTION_CANDIDATE=true`.

| # | Test name | Flow |
|---|---|---|
| 1 | Day-0 Landing intent restores without auto-submit | Capture Landing intent into same-browser handoff, sign in, confirm restore into Composer intent, require no automatic Result navigation. |
| 2 | Copy continuous close-loop | Discover three modalities, submit copy through the Composer Submission BFF with only public references, require Core to freeze the confirmed quote/model/route and return canonical Work/Task/ContentPackage IDs, follow the Task Harness stream into the same Result route, then adjust, adopt, open Delivery, download the full package, record manual publication, record an outcome chip, confirm weekly-review next-round action, and restore after reload. Axe + merchant-language on Composer/Result/Delivery. |
| 3 | Image-text continuous to delivery | Upload and authorize the Recipe-required image, submit image_text through the same Composer Submission BFF, follow the returned Task Harness stream to Result, adopt, download 小红书 ZIP, and restore after reload. |
| 4 | Video continuous to delivery | Upload and authorize the Recipe-required source, submit video (抖音) through the same Composer Submission BFF, follow the returned Task Harness stream to Result in dark theme, adopt, download 抖音 ZIP, and restore after reload. |
| 5 | Content + Assets merchant-safe axe matrix | Open Content, Assets, and Tasks/Weekly shell in light and dark; require zero axe serious/critical and no UUID/raw enum/provider slug leaks. |
| 6 | Responsive 320/375/768/1440 + 200% zoom | On a ready Result, assert no horizontal overflow and no fully occluded primary CTA at each width and at 200% zoom. |
| 7 | prefers-reduced-motion Result/Delivery usable | Emulate reduced motion, complete copy Result→adopt→Delivery; document Save-Data product-hook residual when absent. |
| 8 | Mobile dark Result smoke | 375px dark Result: no overflow, primary CTA geometry, merchant language, axe clean. |

### Residuals (honest, not soft-pass)

- VoiceOver manual checklist (Lens, stream, media roles, status, share degrade, chips).
- Save-Data / low-power product hooks not present.
- Legacy Content on-demand anchor browser journey without seeded legacy fixtures.
- Rights withdrawal → pending replace → safe replace → re-delivery browser journey.
- #147 P0 staging RC and live Provider remain out of band.

## Deferred Coverage

These flows should be added after their dependencies are made deterministic:

| Area | Reason |
|---|---|
| Generic payment portal | Requires Stripe or Creem test fixtures and provider-specific env. Pro Studio has its own bounded opt-in payment journey above. |
| Transactional email | Requires a fake mail provider or captured verification links. |
# P0 golden journey

- `p0-golden-journey.spec.ts` verifies the authenticated, workspace-scoped merchant outcome: confirmed store facts, authorized real-asset metadata, three copy candidates, selected/versioned content, AIDA confirmation, durable video states and quota, an explicitly disabled creation-time AIGC label reflected consistently in the artifact and handoff, a real Product publish snapshot flowing through Douyin contract authorization and independent Owner capability activation, rejected-before-accept fallback to `manual_required`, L3 handoff, manual publication, platform variant, finite weekly set, refresh persistence, and a manually linked lead without causal-attribution language.
- `product-asset-upload.spec.ts` verifies that a real image crosses the authenticated workspace upload adapter into R2, receives Core rights metadata, keeps public authorization disabled until consent evidence is recorded, becomes publicly usable only after explicit consent, and remains downloadable through the authorized same-origin storage proxy.
- `mobile-product-shell.spec.ts` verifies the five-slot mobile shell exposes only the four merchant destinations (creation, content, assets, and store) around the central create action, keeps the lead ledger reachable from the store context, preserves the camera capture contract, and prevents horizontal overflow at the representative 390×844 viewport.
## UI journey three-modal Day-0

`specs/ui-journey-three-modal.spec.ts` is the Z1 / #105 browser hard gate. It
boots the real four-service Playwright stack and covers copy, image-text, and
video in desktop/light and mobile/dark profiles. Every path must discover the
three modalities, submit with the exact C6 activation budget, visibly pass
through the running/first-token state, use the modality-specific Result Center
workspace, send real adjust and adopt mutations, enter canonical delivery,
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
- Quota is a passive line with no controls and no blocking card on the main
  path (D-043 无冲突路径 0 张阻塞卡). Only behaviour is asserted, never the
  numbers — those belong to the entitlements projection.
- Both themes × mobile/desktop render the family and write walkthrough shots.

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

### Demoted old UI specs

The Z1 cutover removed the unified creation workbench from `src`, so specs that
reach the product through 「建立创作记录」/「快速起步预设」/`execute-tool-action`
cannot pass. They are demoted (`test.describe.fixme` plus an `M-04 DEMOTED`
header naming what replaced them), not deleted — no disposition batch approves
deleting them, and the contracts underneath still need relanding:

- `specs/uiux-upgrade-b-composer.spec.ts` — pre-submit contracts (whole file).
- `specs/uiux-upgrade-b-results.spec.ts` — result contracts (whole file).
- `specs/uiux-upgrade-b-async.spec.ts` — asynchronous Job contracts (whole file).
- `specs/uiux-upgrade-b-i18n-motion.spec.ts` — the reduced-motion case only; the
  locale and mobile cases in that file still run.
- `specs/uiux-creation-loop.spec.ts` and `specs/uiux-upgrade-b-video.spec.ts` —
  the 海报 / 三平台版本 / 成片 assertions of the retired ContentPackageDetail,
  marked at the assertion with their T38 coordinate.

`specs/mobile-product-shell.spec.ts` lost its already-`fixme`d mobile Result
journey outright: its only mechanism was holding a retired command, and its
second half addressed `/dashboard/tasks`, which T34 retired. Relanding belongs
to T38.
