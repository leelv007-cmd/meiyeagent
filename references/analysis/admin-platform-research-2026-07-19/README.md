# 后端管理平台成熟架构与组件研究（2026-07-19）

## Question

在现有 React 19 + TanStack Start/Router/Query + shadcn/Radix + Cloudflare Workers 技术栈上，如何把已经存在的七类后台页面补成一套面向非技术运营人员的一体化可视化控制台，同时满足以下约束：

- 日常操作以点击、选择、开关和简单输入为主；
- 复杂维护与高风险告警转交技术人员；
- 后台以整个系统的功能/能力域为主要管理和运维对象，统一呈现每个能力的可用性、配置、依赖、用量/成本、任务/失败、变更/审计与安全操作；
- 账号、套餐、权益与用量只是其中一个业务能力域，不是管理后台的一级主对象；
- `workspaceId` 仅是内部数据隔离与路由键，不在管理产品中升格为门店/工作区业务对象；
- 复用现有权限、CAS、审计、回滚、server function 与业务合同；
- 不引入第二套前端框架或第二套管理运行时；
- 优先评估成熟开源方案，再决定整套采用、局部吸收或排除。

本次核对对象：Refine、React-admin、Backstage、Grafana、OpenTelemetry、TanStack Table、Recharts、Apache ECharts、React Flow。

## Local sources used

- [`mkfast-template-main/package.json`](../../../mkfast-template-main/package.json)：当前前端为 React 19.2、TanStack Start/Router/Query；已经直接依赖 `@tanstack/react-table` `^8.21.2` 与 `recharts` `3.8.0`，未直接依赖其余候选。
- [`mkfast-template-main/AGENTS.md`](../../../mkfast-template-main/AGENTS.md)：现有应用壳、Cloudflare Workers 运行时、TanStack Query 与 shadcn 组件约束。
- [`mkfast-template-main/src/routes/admin/index.tsx`](../../../mkfast-template-main/src/routes/admin/index.tsx)：`/admin` 当前直接重定向至模型页，尚无统一总览。
- [`mkfast-template-main/src/routes/admin/`](../../../mkfast-template-main/src/routes/admin/)：现有 models、plans、redemptions、integrations、templates、audit、users 七类后台页面，说明本任务是统一与补足，而非从零搭建 CRUD 后台。
- [`mkfast-template-main/src/components/data-table/`](../../../mkfast-template-main/src/components/data-table/) 与 [`mkfast-template-main/src/components/ui/chart.tsx`](../../../mkfast-template-main/src/components/ui/chart.tsx)：已有 TanStack Table 与 Recharts 的项目级封装可复用。
- [`mkfast-template-main/src/p1/admin-operations-health.tsx`](../../../mkfast-template-main/src/p1/admin-operations-health.tsx)：已有 queue、database、worker、runner、module revision 等细粒度健康指标，但当前更接近技术视图。
- [`mkfast-template-main/src/p1/admin-runtime-config-control.tsx`](../../../mkfast-template-main/src/p1/admin-runtime-config-control.tsx)：已有结构化 radio 等控件，仍有部分通用 value/textarea，适合继续类型化而非另建配置系统。
- [`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`](../../../docs/design/beauty-marketing-agent-product-design-2026-07-17.md)：D-037 要求扩展存量 admin-config、React Flow 只读 DAG viewer 缓建；D-048 要求面向日常运营的一体化可视化控制台且不另建第二套管理运行时。

## Live sources used

所有维护状态均在 2026-07-19 通过候选项目的官方仓库、release 页面和发布包 manifest 核对。GitHub `pushed_at` 只用于确认仓库未归档且近期仍有代码活动，不把 star 数当作维护质量证据。

| 候选 | 官方产品/架构文档 | 官方仓库、版本与许可证证据 |
| --- | --- | --- |
| Refine | [Refine v5 overview](https://refine.dev/core/docs/)、[routing](https://refine.dev/core/docs/guides-concepts/routing/)、[shadcn integration](https://refine.dev/core/docs/ui-integrations/shadcn/introduction/) | [repository](https://github.com/refinedev/refine)、[releases](https://github.com/refinedev/refine/releases)、[MIT license](https://github.com/refinedev/refine/blob/main/LICENSE) |
| React-admin | [TanStack Start integration](https://marmelab.com/react-admin/TanStackStart.html)、[TanStack Router integration](https://marmelab.com/react-admin/TanStackRouter.html)、[architecture](https://marmelab.com/react-admin/Architecture.html) | [repository](https://github.com/marmelab/react-admin)、[releases](https://github.com/marmelab/react-admin/releases)、[MIT license](https://github.com/marmelab/react-admin/blob/master/LICENSE.md) |
| Backstage | [overview](https://backstage.io/docs/overview/generated-index/)、[software catalog](https://backstage.io/docs/features/software-catalog/)、[frontend plugins](https://backstage.io/docs/frontend-system/architecture/plugins/) | [repository](https://github.com/backstage/backstage)、[releases](https://github.com/backstage/backstage/releases)、[Apache-2.0 license](https://github.com/backstage/backstage/blob/master/LICENSE) |
| Grafana | [developer tools](https://grafana.com/docs/grafana/latest/developer-resources/developer-tools/)、[plugin tools](https://grafana.com/developers/plugin-tools) | [repository](https://github.com/grafana/grafana)、[releases](https://github.com/grafana/grafana/releases)、[AGPL-3.0 default and Apache-2.0 exceptions](https://github.com/grafana/grafana/blob/main/LICENSING.md) |
| OpenTelemetry JS | [JavaScript status](https://opentelemetry.io/docs/languages/js/)、[Workers traces](https://developers.cloudflare.com/workers/observability/traces/)、[Workers OTel export](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/) | [repository](https://github.com/open-telemetry/opentelemetry-js)、[releases](https://github.com/open-telemetry/opentelemetry-js/releases)、[Apache-2.0 license](https://github.com/open-telemetry/opentelemetry-js/blob/main/LICENSE) |
| TanStack Table | [overview](https://tanstack.com/table/latest/docs/overview)、[React adapter](https://tanstack.com/table/latest/docs/framework/react) | [repository](https://github.com/TanStack/table)、[releases](https://github.com/TanStack/table/releases)、[MIT license](https://github.com/TanStack/table/blob/beta/LICENSE) |
| Recharts | [official guide](https://recharts.github.io/en-US/guide/) | [repository](https://github.com/recharts/recharts)、[releases](https://github.com/recharts/recharts/releases)、[MIT license](https://github.com/recharts/recharts/blob/main/LICENSE) |
| Apache ECharts | [handbook](https://echarts.apache.org/handbook/en/get-started/)、[ARIA guidance](https://echarts.apache.org/handbook/en/best-practices/aria/) | [repository](https://github.com/apache/echarts)、[releases](https://github.com/apache/echarts/releases)、[Apache-2.0 license](https://github.com/apache/echarts/blob/master/LICENSE) |
| React Flow | [official site](https://reactflow.dev/)、[accessibility](https://reactflow.dev/learn/advanced-use/accessibility)、[React 19 + shadcn UI tutorial](https://reactflow.dev/learn/tutorials/getting-started-with-react-flow-components) | [repository](https://github.com/xyflow/xyflow)、[releases](https://github.com/xyflow/xyflow/releases)、[MIT license](https://github.com/xyflow/xyflow/blob/main/LICENSE) |

## Findings

### 1. Compatibility and adoption matrix

| Candidate | 2026-07-19 maintenance evidence | React 19 / current-stack compatibility | Integration cost | Adoption judgment | Appropriate boundary |
| --- | --- | --- | --- | --- | --- |
| **Refine 5** | Active, not archived; `@refinedev/core@5.0.12` released 2026-04-02; repository last pushed 2026-06-05. | **Compatible.** Refine v5 officially supports React 18/19 and TanStack Query 5; it is headless and now has an official shadcn registry. It has no first-party TanStack Router binding in the documented binding list, but its custom router interface can bridge it. | **High for this repo.** Full adoption adds `<Refine>`, Resource, DataProvider, auth/access-control and router abstractions around contracts that already exist. Its shadcn views are coupled to Refine hooks, so they are not zero-cost standalone components. | **Do not adopt as the current admin shell.** Selectively study its CRUD/auto-save/navigation patterns. Keep as a conditional future spike, not a dependency now. | Reconsider only if the backlog grows into many homogeneous CRUD resources and a measured spike proves that mapping existing CAS/audit/permissions is cheaper than continuing native pages. It is a poor fit for workflow health, model routing, impact review and cross-domain operational drill-down as the dominant use cases. |
| **React-admin 5** | Active, not archived; `v5.15.1` released 2026-06-24; repository last pushed 2026-07-16. | **Compatible, with important trade-offs.** Published packages declare React 18/19 support, and official `ra-router-tanstack` plus TanStack Start guidance exists. The adapter does not preserve TanStack Router's compile-time route typing, route loaders, typed search params or file-route model; default UI remains Material UI. | **High.** Full adoption adds `<Admin>/<Resource>`, DataProvider, its resource CRUD lifecycle, and usually MUI/Emotion. Even headless `ra-core` still introduces a second application abstraction and would require wrapping the existing seven routes and server-function contracts. | **Do not adopt wholesale.** Borrow its undo, saved filters, list/detail, optimistic-feedback and bulk-action UX patterns where they fit. | A small isolated resource island may be spiked only after a genuinely large same-shape CRUD set appears. Do not rewrite existing admin pages merely because official TanStack integration now exists. OSS core is MIT; Enterprise modules and their capabilities must not be assumed free/open. |
| **Backstage 1.53** | Active, not archived; `v1.53.0` released 2026-07-14; repository last pushed 2026-07-17. | **Not officially React 19 compatible in current published frontend manifests.** Current frontend packages declare React 17/18 and React Router 6. It also brings its own frontend plugin system, backend plugin system, catalog model, app packaging and often Material UI. | **Very high.** This would be a parallel product/platform rather than a component addition. | **Exclude.** Do not use it as the operations admin framework. | Backstage is a developer portal and software catalog for engineering assets, ownership and infrastructure tooling. Its catalog/plugin concepts can inspire technical service inventory, but the target users here are nontechnical content-platform operators and the product already has its own domain objects and truth stores. |
| **Grafana 13.1** | Active, not archived; `v13.1.0` released 2026-07-01; repository last pushed 2026-07-19. | A separately deployed Grafana is stack-independent. Embedding `@grafana/ui` is **not** a good current-stack fit: its published peer range is React 18, and it carries Grafana's design/runtime assumptions. Whole Grafana is AGPL-3.0-only by default; `packages/grafana-ui` is an Apache-2.0 exception. | **Low/medium as an external technical console; very high as embedded product UI.** | **Use externally for technical drill-down, not as the operations product shell and not as a component library.** | Grafana owns high-cardinality telemetry exploration, traces/logs, technical dashboards and alert investigation. The operations UI should show a simplified projection—status, affected capability/users, suggested safe action, last change and evidence link—then deep-link qualified technical staff to Grafana. |
| **OpenTelemetry JS 2.9** | Active, not archived; `v2.9.0` released 2026-07-02; repository last pushed 2026-07-17. | No React UI dependency. OTel JS traces and metrics are stable, logs are development; browser client instrumentation is officially experimental. Cloudflare Workers can collect request/binding/handler traces without code and export OTel traces/logs. | **Low for Workers-native traces/logs; medium for domain spans and correlation design.** | **Adopt the telemetry standard and Cloudflare-native export seam; do not treat it as an admin UI library.** | Start with server/Worker traces and logs plus domain correlation IDs. Do not blanket-instrument the React browser yet. Cloudflare explicitly does **not** support OTel export of Worker/custom metrics today, so product health metrics still need existing Core projections or another measured metrics path. |
| **TanStack Table 8** | Active, not archived; repository last pushed 2026-07-18; current published React package is 8.21.x. | **Excellent fit.** Headless, framework adapter supports React `>=16.8`, and it is already installed and wrapped in this repo. | **Low.** Remaining cost is product-specific columns, server pagination/filter/sort contracts, empty/error states and accessibility—not framework integration. | **Adopt as the default object-list engine.** | Users, providers/deployments, models, templates, plans, redemption batches, audit events and incident/evidence lists. It should not be forced onto overview summaries or relationship graphs. Keep shadcn markup and the existing admin visual language. |
| **Recharts 3** | Active, not archived; `v3.9.2` released 2026-07-04; repository last pushed 2026-07-18. | **Excellent fit.** Published peer ranges include React 19; version 3.8 is already installed with a project-level shadcn-style chart wrapper. | **Low.** | **Use as the default overview and operational-trend chart library.** | Small/medium data volume: success/failure trends, provider latency and cost, quota use, generation throughput, queue age and conversion funnels. Prefer 3–5 legible business charts over a wall of microcharts; every chart needs a textual summary and a route to its source list. |
| **Apache ECharts 6.1** | Active, not archived; `6.1.0` released 2026-05-19; repository last pushed 2026-07-15. | Framework-agnostic and therefore React 19 compatible, but requires a React lifecycle wrapper/client-only initialization and its own theme/accessibility setup. | **Medium.** It adds a second chart API, SSR/client lifecycle work and duplicate design tokens. | **Conditional partial adoption only.** Do not add it to the first admin-overview increment. | Use only when Recharts is demonstrably insufficient—for example large/high-density time series, heatmaps, complex multi-axis or topology-like analytic views. ECharts ARIA is off by default and must be explicitly imported/enabled; retain a data-table/text alternative. |
| **React Flow 12.11** | Active, not archived; current official site shows `12.11.2`; repository last pushed 2026-07-17. | **Good fit when needed.** Published peers accept React `>=17`; official React Flow UI guidance is updated for React 19, Tailwind 4 and shadcn. | **Medium.** Rendering nodes is easy; trustworthy layout, domain mapping, read-only/edit permissions, diff/version semantics and non-graph fallback are the real cost. | **Deferred, read-only partial adoption.** | Use for provider routing topology or Harness/workflow DAG only after operators need relationship diagnosis that tables cannot answer. It must not become the default homepage, a speculative workflow editor, or a bypass around candidate→eval→approve→publish. Pair it with a list/table fallback and Chinese ARIA labels. |

### 2. Recommended combination

The lowest-risk combination is a layered native admin, not a framework replacement:

| Layer | Recommended tool | Product responsibility |
| --- | --- | --- |
| Application shell, routes, permissions, mutations | **Existing TanStack Start/Router/Query + shadcn/Radix** | Preserve current admin routes, server functions, auth middleware, CAS, audit, impact review and rollback contracts. Add `/admin` overview and unified navigation inside the existing shell. |
| Dense object lists | **Existing TanStack Table wrapper** | Search, filters, server pagination/sort, saved view state where justified, row/detail drill-down and controlled bulk actions. |
| Overview and ordinary trends | **Existing Recharts wrapper** | Business-readable summaries with plain-language labels, thresholds and source links. |
| Complex/high-volume visual analysis | **Apache ECharts, only behind a proven need** | Heatmaps or dense time series that fail an explicit Recharts performance/readability acceptance test. |
| Workflow/routing relationship view | **React Flow, deferred and read-only** | A secondary technical/advanced view; no visual editing until a separately approved authoring contract exists. |
| Telemetry transport | **Cloudflare-native traces/logs using OTel conventions** | Correlated telemetry from Worker requests, bindings and domain operations. Preserve redaction and sampling controls. |
| Deep technical investigation | **External Grafana/Grafana Cloud** | Technical traces/logs/dashboards and alert investigation. The operations console links into it with context; it does not expose raw PromQL, trace attributes or infrastructure jargon by default. |

Refine and React-admin are credible, maintained products and are technically more compatible with this stack than older evaluations might imply. They are still the wrong default here because the repo already owns the application shell and seven domain-specific pages; adopting either now would duplicate product architecture rather than merely reuse components. Backstage is a categorical user/domain mismatch.

### 3. Management object and information-architecture boundary

The platform is an internal developer/operations admin, not a merchant store-management product or an account-centric CRM. Its first-class management object is the system's **capability/module**, with one consistent detail contract for every module:

1. **Availability:** healthy / attention needed / blocked, freshness and affected user-facing function.
2. **Configuration and dependencies:** effective revision, required provider/integration/runtime dependencies and readiness evidence.
3. **Usage and cost:** volume, allowance or resource consumption, external cost and relevant trend.
4. **Jobs and failures:** recent/running/stuck/failed work, normalized cause and recoverable next action.
5. **Changes and audit:** actor, reason, revision diff, publish/rollback history and correlation evidence.
6. **Safe operations:** only allowlisted, permission-checked, impact-previewed and reversible actions; everything else becomes a technical handoff.

The navigation should group modules by capability domain rather than by technical service or database object. A practical first pass is:

- **Capability overview:** all modules, exceptions and pending actions;
- **Creation and AI supply:** copy/image/video capabilities, providers/models, routing, quality and generation jobs;
- **Content capability:** templates, assets/results and related lifecycle evidence;
- **Accounts and commercial capability:** user accounts, plans, entitlements, usage, redemption/payment and reconciliation;
- **Integration capability:** external platform connections, credentials and readiness;
- **Runtime and governance capability:** queue/worker/database projections, incidents, configuration revisions, unified audit and security operations.

This grouping is a product information architecture, not a mandate to merge all existing routes. Existing pages can remain as drill-downs behind the capability overview. `workspaceId` may continue to scope queries and writes internally, but the UI must not create a store/workspace directory, workspace switcher or merchant-management concept from that technical key. When internal scope is necessary for diagnosis, label it as folded technical evidence rather than product identity.

### 4. Operator-to-technician boundary

The visual platform should not equate “more metrics” with “more useful operations.” Existing health data can be projected into two levels:

1. **Operations summary:** healthy / attention needed / blocked; affected capability/module and, where relevant, account or job; when it started; last relevant config change; one safe suggested action; owner and escalation status.
2. **Technical evidence:** raw queue/database/worker metrics, trace ID/correlation ID, recent errors, config revision diff, logs/Grafana deep link and runbook reference.

Only explicitly allowlisted, reversible actions belong at level 1—for example retry after idempotency is proven, disable new attempts on a failing deployment, roll back to a known revision through existing CAS, acknowledge/assign an incident, or open the affected object. Credential rotation, schema repair, arbitrary JSON/config editing, SQL, runtime restarts and infrastructure changes remain technical handoff actions.

### 5. UX lessons worth absorbing without adding frameworks

- From Refine/React-admin: resource-oriented navigation, list/detail continuity, undo where the backend contract truly supports it, saved filters, explicit dirty state, mutation feedback and bulk-action impact preview.
- From Grafana: overview → panel → evidence drill-down, time-range consistency, visible freshness and annotation of relevant changes; do not copy raw observability terminology into the operator home.
- From Backstage: every technical object should expose owner, lifecycle and linked evidence; do not import its software-catalog entity model.
- From React Flow: make relationship views navigable and screen-reader aware, but always provide an equivalent ordered list/table because a canvas alone is not an operational contract.

## Decision or open risk

### Recommended decision

Retain the existing TanStack Start admin as the only product shell. Standardize on existing TanStack Table + Recharts + shadcn/Radix for the first complete admin visualization increment; use Cloudflare/OTel traces and logs with an external Grafana technical console. Treat ECharts and React Flow as narrowly triggered secondary components. Do not adopt Refine, React-admin, Backstage or Grafana UI as a replacement framework/component system.

This is a research recommendation for product discussion, not a new accepted product decision by itself.

### Open risks

- **Metrics gap:** Cloudflare's current OTel export supports traces and logs, not Worker/custom metrics. The admin summary must not promise a single OTel pipeline until a metrics source and retention contract are chosen.
- **Semantic projection:** technical thresholds cannot be copied directly to operators. “Queue depth 23” needs a domain impact calculation, freshness, affected capability/module and, where relevant, account/job, plus a recommended action.
- **Action safety:** retry, disable, rollback and credential/config actions need an explicit allowlist, permission check, impact preview, idempotency/CAS behavior and immutable audit record.
- **Chart duplication:** adding ECharts early would create two chart systems and accessibility/theming work. Its adoption must be justified by a failed Recharts acceptance case.
- **Canvas scope creep:** React Flow can easily turn a read-only diagnostic view into an ungoverned workflow editor. D-037's deferred/read-only boundary must remain explicit.
- **Framework temptation:** Refine and React-admin now have better React 19/shadcn/TanStack compatibility, but compatibility alone does not justify re-platforming existing domain pages.

## Follow-up tickets

1. **AP-01 — Unified admin information architecture and `/admin` overview**
   Inventory the seven existing pages and define a capability/module registry plus the six common detail dimensions: availability, configuration/dependencies, usage/cost, jobs/failures, changes/audit and safe operations. Build one exception-first overview using the existing shell, Table and Recharts wrappers. Acceptance: every module summary has freshness and a drill-down route; `/admin` no longer redirects blindly to models; accounts/commercial remains one capability domain; no store/workspace business-management surface is introduced.

2. **AP-02 — Operations health projection contract**
   Add a typed projection over existing queue/database/worker/runner/module-revision evidence: module identity, severity, affected user-facing capability and optional account/job scope, started-at, last-change, suggested safe action, owner/escalation and evidence links. Keep internal isolation keys and raw metrics in the folded technical detail.

3. **AP-03 — Safe action allowlist and technical handoff envelope**
   Classify each proposed control as operator-safe or technician-only. Require permission, impact preview, CAS/idempotency, audit, rollback semantics and a handoff payload containing correlation IDs and relevant revision/evidence links.

4. **AP-04 — Typed configuration-control completion**
   Replace remaining generic value/textarea editing for known artifacts with select/radio/switch/constrained inputs and plain-language consequences; retain free-form only for explicitly untyped transitional artifacts.

5. **AP-05 — Workers OTel → external Grafana spike**
   Verify automatic traces/logs, sampling, redaction, correlation propagation and deep links on the deployed Workers path. Document the unsupported metrics path separately; do not add browser-wide OTel instrumentation in this ticket.

6. **AP-06 — Table/chart accessibility and density gate**
   Test keyboard use, screen-reader summaries, empty/error/stale states, reduced motion, color independence and representative high-volume data. Only open an ECharts implementation ticket if Recharts fails a recorded performance/readability case.

7. **AP-07 — Deferred read-only topology spike**
   When a real provider-routing or Harness-diagnosis task cannot be answered efficiently by list/detail views, test React Flow as a read-only, version-pinned DAG with Chinese ARIA labels and a table fallback. Do not include graph editing.

8. **AP-08 — Framework re-evaluation trigger**
   Do not schedule a Refine/react-admin migration. Reopen comparison only after a large new set of homogeneous CRUD resources exists; measure one isolated resource against native implementation, including bundle, routing, auth, CAS/audit mapping, accessibility and deletion cost.
