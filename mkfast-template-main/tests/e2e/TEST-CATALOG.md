# E2E Test Catalog

This catalog is the acceptance checklist for Playwright E2E coverage. Update it
before or alongside feature work, then use the implemented spec files to lock in
the verified behavior.

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

E2E tests are intentionally local-first. CI should continue to prefer fast
checks such as `pnpm check` and `pnpm build` unless a separate E2E environment is
explicitly provisioned.

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
| 2 | Home login modal opens | Open `/`, click the navbar login button, verify the login dialog and credential inputs are visible, and assert no browser errors. |
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

## 6. PWA And Mobile Media Primitives

**File:** `specs/pwa-media-primitives.spec.ts` | **Priority:** P0

Verifies the isolated mobile proof before product asset and publishing journeys
depend on browser-specific install, camera, and file handoff behavior.

| # | Test name | Flow |
|---|---|---|
| 1 | Mobile proof registers the production-shaped service worker | Open `/pwa-proof` at a 390 x 844 touch viewport, verify the manifest and root-scoped `/sw.js` registration become ready, assert the manifest, active-route, and default-root metadata use the product theme color, and assert the page has no horizontal overflow. |
| 2 | Camera input returns a captured image fixture | Verify the file input requests `image/*` with `capture="environment"`, return a deterministic camera fixture, and verify its preview and file details are visible. |
| 3 | Camera launch failure explains how to recover | Simulate the browser rejecting the camera picker and verify the page points the user to camera permission settings and the photo-library fallback. |
| 4 | Image and video fixtures use Web Share with visible downloads | Provide file-capable Web Share, share the generated PNG and MP4 fixtures, verify the handed-off file names and MIME types, and keep both download links visible. |
| 5 | Share rejection keeps an actionable download fallback | Simulate a denied system share, verify the explanation offers a retry and download path, and confirm the media download remains visible. |

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
| 3 | Composer uploads, drops, pastes, and removes real image references | Confirm the three material facts, verify the separate camera and gallery contracts, upload one image and remove it from this creation while preserving it in the asset library, then add images through drag-and-drop and clipboard paste. Create one Work and verify only the two retained Product Asset IDs persist as visible source references. |
| 4 | Explicit contract produces Assets before one accepted ContentPackage | Review operation, active model, specification, quote, watermark, and AIGC controls. Submit once, verify A/B/C are internal Assets while legacy Content remains empty, select candidate B with the authorized real store photo, and create exactly one ContentPackage; reload and prove the same package and locked candidate persist. |
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

Locks the missing result-stage contracts for real copy streaming, candidate
batch boundaries, canonical media presentation, and English route consistency.
The streaming checks observe the paced fixture response through the real BFF;
they do not synthesize a completed response or business state.

| # | Test name | Flow |
|---|---|---|
| 1 | One real submission exposes streaming start, progress, and exactly three completed candidates | Submit one real copy-stream request, verify the paced response exposes three safe in-progress slots and a stop action before completion, then verify one completed Job persists exactly three ordered candidate Assets without duplicate Work or Job creation. |
| 2 | Production candidate preserves paced chunks through Worker and BFF | Run only with `PLAYWRIGHT_PRODUCTION_CANDIDATE=true`; build the Worker candidate, pass the paced Core fixture through Wrangler and the authenticated BFF, attach the browser transport probe, and require multiple chunks separated by more than 100ms. This is transport proof, not live-provider proof. |
| 3 | Stopping a partial copy stream preserves arrived content and requires explicit resubmission | Stop after the first visible partial candidate, verify arrived copy remains readable and no automatic retry occurs, explicitly resubmit, and verify the second request completes one three-candidate batch. |
| 4 | The completed copy batch remains a single-choice flow on mobile | Complete one copy batch on desktop, switch to the mobile Progress stage, verify exactly three radios and one checked choice, keep the sticky adoption action enabled, and prove the page does not overflow. |
| 5 | Creation assistant streams rich text and exposes local-only patch controls | Send one assistant request, verify partial text and rich Markdown arrive before completion, inspect the current Work context, edit and locally accept one structured field patch, and prove the Work intent is not silently overwritten. |
| 6 | Single selection, paid reroll, and two free quality retries keep separate usage boundaries | Generate the first three-candidate batch, switch between A and C while keeping exactly one selection, explicitly confirm a paid reroll and verify one-unit usage, then use both zero-unit quality retries, verify the `0/2 -> 1/2 -> 2/2` boundary, and prove a third free retry is disabled without changing the fixed model. |
| 7 | Successful image media opens the lightbox and the same canonical Asset detail | Complete one real fixture-backed image Job, reload its persisted result, open the rendered media in the lightbox, prove previewing creates no Content or duplicate objects, then follow the detail link and verify the same canonical media source appears on its detail route, Asset library, and the formal Recent/history owning surface. |
| 8 | English locale retains route context and keeps empty product chrome free of Chinese leakage | Switch an empty Asset page to English while preserving path, query, hash, and login state; verify English chrome contains no Chinese beyond the allowed product brand or internal model/template residue, reload without losing locale, and navigate to the English Content page without dropping the `/en` prefix. |
| 9 | Completed result becomes the stage and keeps its visible intent legible on mobile | Complete one copy Work, verify the result hero is visually ahead of professional settings and reuse, require the submit composer and Operations rail to leave the completed stage, then switch to mobile Progress and verify the visible intent and candidate result remain visible. |
| 10 | Image-text export receipts download the generated ZIP | Export an accepted image-text ContentPackage, open its successful receipt, and verify the authenticated BFF returns the exact workspace-scoped generated ZIP without accepting a composed ZIP or a disguised extension. |
| 11 | Lost export and reuse responses retry the same intent once | Drop the first export and reuse responses after submission, retry each unchanged action, and verify each retry reuses its original idempotency key while the two different intents never share a key. |
| 12 | Slow platform generation cannot overwrite a newer package version | Hold the three-platform provider response, save a new current ContentPackage version, release the stale provider result, and verify the command reports a version conflict without attaching any stale platform variant. |
| 13 | Primary image-text creation adopts authorized store photos into one package | Start from the two product choices “Create image post” and “Create video,” create an image-text Work with an authorized real store photo, select one copy candidate, keep the referenced photo in the ordered visual list, adopt once, and verify the ContentPackage is immediately visible without any CreativeContent write. |

## 18. UI/UX Upgrade B Asynchronous Job Contracts

**File:** `specs/uiux-upgrade-b-async.spec.ts` | **Priority:** P0

Locks automatic image-Job observation, cross-route task recovery, honest elapsed
time, unread completion, and one-click return without fake percentage progress.

| # | Test name | Flow |
|---|---|---|
| 1 | One image Job remains observable across routes and completes without manual refresh | Gate the submit and provider-query boundaries long enough to observe the submitting and running states, leave the Work for the Asset page, inspect the global task center on desktop and mobile, release the real query, verify exactly one automatic resume and one completed Asset, then return to the same canonical Job. |

## 19. UI/UX Upgrade B Durable Video Workflow

**File:** `specs/uiux-upgrade-b-video.spec.ts` | **Priority:** P0

Locks the composed-video workflow as one durable, recoverable track rather than
a duplicate generic creative Job or synchronous render request.

| # | Test name | Flow |
|---|---|---|
| 1 | A Work edits and restores V1 before completing one durable video workflow | Create and lock an AIDA storyboard, derive a V2 workflow instead of mutating V1, reload the same revision, confirm it for background execution, recover and complete any required shot review on mobile, play the authorized MP4, reload the completed workflow on desktop and its ContentPackage detail with the exact completed workflow still visible, prove mobile Handoff stays bound to that Work after a newer unrelated package exists, verify no generic video Job or legacy synchronous process request was submitted, and prove the retired legacy route returns 404 through the API request context. |
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
| 1 | Unpurchased Owner sees the dedicated offer and server-owned checkout action | Sign in as a workspace Owner, open `/pro-studio`, verify the explanation/demo/price surface and a POST form to the dedicated checkout route; no workspace, price, or payment fact is submitted by the browser. |
| 2 | Fixture-signed webhook unlocks Pro Studio and completes Canvas SSO | In local E2E mode, submit an HMAC-signed fixed-schema paid Stripe checkout event. A fixed fixture provider runs the production Owner-session checkout binding and canonical catalog validation before the provider payment, claim, lease, and Canvas activation path. Reload `/pro-studio`, verify “工作区已解锁”, click “一键进入”, and require the Canvas origin, workspace shell, session cookie, and CSRF cookie. |
| 3 | Real provider hosted-checkout smoke remains opt-in | With explicit real-provider credentials and `PLAYWRIGHT_REAL_PRO_STUDIO_CHECKOUT_URL`, verify the hosted checkout is reachable. This smoke does not replace the default signed-fixture activation closure and does not claim a completed real payment. |

## 22. Pro Studio Engineering And Cross-Service Smoke

**Files:** `specs/pro-studio-engineering-tickets.spec.ts`,
`specs/pro-studio-cross-service-smoke.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Engineering tickets keep their bounded UI and lifecycle journeys | Verify the fixture entitlement and prompt seeds; in Light Composer, upload and authorize a distinctive asset, replace and source-crop an image without changing its destination box, save the normalized crop in a revision, export and sample the cropped PNG pixels, and adopt it into ContentPackage; then verify merchant diagnostics and media-custody recovery through the owning product routes. |
| 2 | Cross-service generation is adopted into the main ContentPackage library | Register and sign in, unlock the fixture workspace, enter Canvas, create a project and checkpoint, generate a recorded image, save the graph, adopt the Advanced Canvas output, and verify the resulting package is visible in Main ContentPackage. |
| 3 | Recorded TTS and SFX complete through Core and remain playable in Canvas | In the same real Main + Canvas + Core + Postgres harness, quote and submit independent `audio.speech` and `audio.sfx` jobs, let the durable Worker recover both, persist decoded workspace-owned audio, render two Canvas audio players, verify bounded Range delivery, and require server-controlled attachment headers for download. |

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
