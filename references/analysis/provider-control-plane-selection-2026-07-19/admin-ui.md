# 多渠道模型供应控制面的管理 UI / CRUD 框架比选

> 研究快照：2026-07-19
>
> 适用范围：D-048、D-057、D-058～D-070；首轮同时覆盖文本、图片、视频，不把媒体供应管理留到第二轮
>
> 候选：Refine、React-admin、Appsmith、Directus、ToolJet

## 结论先行

**采用现有 TanStack Start/Router/Query + shadcn/Radix 管理壳，不引入第二套管理运行时。** Refine 与 React-admin 只作为 CRUD 交互模式参考；Directus 只参考其 revisions / compare / promote 与关系表单；Appsmith、Directus、ToolJet 都不作为生产供应控制面，也不嵌入现有后台。

模型供应与网关控制中心是统一后台可视化的核心模块，不是外置网关 Console 的包装页。现有管理壳必须直接承载供应关系、三模态 readiness、路由发布、任务/成本下钻及受治理快捷操作；Higress、Bifrost 或供应商自带 Console 只作为技术证据深链。

原因不是这些项目不成熟，而是本项目已拥有七类后台页面、Better Auth 入口、Core 领域命令、版本发布/回滚、审计和部分凭据治理。供应控制面还必须同时承载三模态异步任务、写入式密钥、CAS、影响预览、发布门、RouteSnapshot 和双账本；它不是一组普通 CRUD 表。换成外部后台会增加一套身份、权限、审计、运行时和 UI 真相，却仍需自行实现最难的领域合同。

| 方案 | 结论 | 本项目使用边界 |
| --- | --- | --- |
| **现有 TanStack 管理壳** | **ADOPT** | 唯一产品管理壳；继续使用现有路由、Query、React Hook Form/Zod、shadcn、TanStack Table、Recharts、Core API、CAS 与审计 |
| **Refine 5** | **REFERENCE** | 参考资源导航、CRUD hooks、auto-save/dirty-state 等模式；不引入 `<Refine>`、Resource、DataProvider、router/access-control 第二抽象 |
| **React-admin 5** | **REFERENCE** | 参考 list/show/edit、筛选、批量动作、mutation feedback；不整体采用 `<Admin>/<Resource>`、MUI 或 `ra-core` |
| **Directus 12** | **REFERENCE / RUNTIME REJECT** | 参考记录 diff、compare/promote、关系字段和活动侧栏；不让 Directus 数据库、Data Studio、Policy 或 Flow 持有产品真相 |
| **Appsmith 2** | **REJECT** | 不作为生产控制面或私有 iframe；最多用于完全可丢弃、只读、无密钥的内部原型 |
| **ToolJet 3 LTS** | **REJECT** | 不作为生产控制面或私有 iframe；不让其 Query、Workflow、GitSync 或 RBAC 替代领域命令与发布流 |

这与既有[后端管理平台成熟架构与组件研究](../admin-platform-research-2026-07-19/README.md)一致；本文件只补低代码候选，并把判断收窄到供应商控制面。

## 不能外移的供应控制面合同

供应控制面必须围绕以下产品对象工作，而不是围绕某个低代码平台的 datasource、collection 或 app：

- `ProviderProfile` / `SupplyContract`：实际交易方、合同、余额、限额、账单与数据政策；
- `CredentialAccount`：只写密钥、测试、轮换、排空、撤销与 vault 引用；
- `ExecutionChannel` / `Deployment`：endpoint、协议、provider alias、区域、价格、能力和发布状态；
- `CatalogModel` / operation conformance：文本生成/改写、图片生成/编辑、视频生成的能力证据；
- `SupplyPool` / `RoutePolicy` / `AccountAllocation`：渠道池、版本化路由、套餐与账号分配；
- `RouteSnapshot` / `ProviderAttempt` / 双账本：冻结实际渠道、接受态、产品用量和供应商成本；
- 图片/视频生命周期：`submit → accepted/unknown → recover/poll/callback → cancel → download → own-asset persistence`，并处理排空、晚到终态和禁止盲目重提。

因此所有 UI mutation 必须调用 Core 的类型化命令，并携带 permission、目标 revision / expected version、原因、影响预览所需上下文和 correlation ID。任何框架的前端 access control、通用 `update()`、Git 版本或平台 audit log 都不能替代这条服务端合同。

## 候选矩阵

| 维度 | Refine | React-admin | Appsmith | Directus | ToolJet |
| --- | --- | --- | --- | --- | --- |
| 产品形态 | 进程内、headless React 框架 | 进程内 React B2B/CRUD 框架，默认 MUI | 独立低代码应用平台 | 独立 Node 后端 + Vue Data Studio | 独立低代码应用/工作流平台 |
| 嵌入现有 React/TanStack | 可包在现有应用中，但引入 Resource/DataProvider/router/access-control 抽象；官方 shadcn 集成改善视觉适配 | 有官方 TanStack Router/Start 适配，但会引入 `<Admin>/<Resource>` 生命周期；默认 MUI 与现有 shadcn 体系重复 | 官方嵌入方式是 iframe；私有嵌入要求独立实例、SSO/同域等条件 | Studio 是 Vue 应用；可通过 API/SDK接入数据，但不是可嵌入的 React 组件层 | 官方公有/私有嵌入方式是 iframe；私有会新增 PAT/session 生命周期 |
| 数据接入 | 自定义或多 DataProvider，底层使用 TanStack Query | 自定义 DataProvider 将标准 CRUD 映射到 REST/GraphQL | REST/API/数据库 Query，JSON Form 可按数据生成表单 | 以 Directus collection/数据库为中心自动生成 REST/GraphQL/SDK | REST/GraphQL/SOAP/数据库连接均由 ToolJet server 代理 |
| 复杂结构化表单 | 能组合任意 React 表单库；领域 schema、secret field、影响预览仍需自建 | Simple/Tabbed/array 等 CRUD 表单成熟；复杂表单与领域命令仍需自定义，部分高级布局/RBAC在商业包 | JSON Form、数组/对象字段、文件/API 绑定强，但生成结果受平台 widget/runtime 约束 | 关系字段、schema-driven interfaces 最强，适合数据内容编辑 | 内置 Form、Table、文件和大量组件，适合快速内部工具 |
| RBAC / 审计 | `accessControlProvider` 是集成接口；官方明确它不会自行强制授权，服务端仍须校验；领域审计自建 | AuthProvider/基础 access control 可接入；细粒度 `ra-rbac` 属 Enterprise；领域审计自建 | GAC 与 audit logs 属付费 Business；权限与审计只覆盖 Appsmith 资源/Query | Policy/permission、activity/revision 原生较强，但会形成第二套授权和审计真相 | workspace roles 基础可用；动态 page/query/component/row 规则、私有嵌入和 audit 等关键能力存在付费边界 |
| 版本 diff / 审批 | 无供应配置发布流，需自建 | 无供应配置发布流，需自建 | Git 管的是 Appsmith 应用定义，不是 Provider/Deployment revision | Content Version 支持 compare/promote，最接近所需交互；审批仍需用 policy/workflow 配置并映射领域规则 | GitSync/App Version 管的是 ToolJet 应用定义，不是供应配置 revision |
| 图表 | 自选 React 图表库 | 自选/扩展 React 图表库 | 内建图表与 Custom ECharts | Insights dashboard/panel | 内建 charts/dashboard |
| 是否新增后端/运行时 | 否，但新增前端框架层 | 否，但新增前端框架和常见 MUI 层 | **是**，需独立 Appsmith 实例及其数据/升级/备份 | **是**，需 Directus server、数据库和 Studio | **是**，需 ToolJet server、数据库和升级链 |
| UI 一致性成本 | 中；shadcn 方向较好，但 hooks 与资源模型有侵入 | 中高；MUI 与现有设计系统重复，headless 化也需重写视图 | 高；iframe 只能做主题近似，导航、错误态、焦点和无障碍成为跨应用问题 | 高；Vue Studio 是另一套产品体验 | 高；iframe 与独立 session 带来跨应用体验 |
| 许可证/商业边界 | MIT core；企业服务/能力需单独核验 | MIT core；RBAC 等 Enterprise 包需订阅 | 仓库 core 为 Apache-2.0；GAC/audit/private embed 等关键能力分属 Business/Enterprise | BSL 1.1 + additional grant；超过 500 万美元 total annual finances 的实体生产使用需商业许可 | core 为 AGPL-3.0；动态访问、私有 embed、audit/多环境等关键治理能力有 Team/Enterprise 边界 |
| 本项目判断 | **参考，不采用** | **参考，不采用** | **生产拒绝** | **只参考交互，运行时拒绝** | **生产拒绝** |

## 分项判断

### Refine：最接近现有 UI 栈，但引入收益不足以覆盖重复抽象

Refine v5 是活跃的 MIT headless React 项目，`@refinedev/core@5.0.12` 于 2026-04-02 发布；官方提供 DataProvider、多 DataProvider、access-control 接口及 shadcn 集成。它是五个候选里视觉和组件层最容易贴近现有栈的一个。

问题在于本项目已经直接使用 TanStack Query、TanStack Router、React Hook Form/Zod 和 shadcn，并已有七类后台页。引入 Refine 后，现有 Query keys、文件路由、Core command、权限检查和错误合同仍要逐一包进 Refine provider；供应发布、CAS、凭据只写和三模态任务不会因此消失。官方还明确说明，仅配置 `accessControlProvider` 不会自动强制授权，受保护路由/组件仍需接入，而服务端依然必须拥有最终权限。

**结论：REFERENCE。** 只吸收资源导航、dirty state、mutation feedback、saved views 等交互模式。只有未来出现大批同构、低风险、标准 CRUD 资源，才允许用一个隔离页面做计时 spike；不得迁移现有供应主链来证明框架价值。

### React-admin：CRUD 能力成熟，但会叠加第二套应用与设计系统

React-admin `v5.15.1` 于 2026-06-24 发布，MIT core 活跃；官方支持 TanStack Start/Router，并通过 DataProvider 把 `getList/getOne/create/update/delete` 映射到 API。其列表、筛选、关系字段、批量操作和 mutation 状态值得参考。

但供应配置不是标准 `PUT /resource/:id`：发布、退役、排空、凭据轮换和路由变更都要求命令语义、expected revision、reason、影响预览和不可变审计。React-admin 默认还引入 MUI/Emotion；即便只用 `ra-core`，也会形成第二套 Resource/DataProvider/Query 生命周期。细粒度 `ra-rbac` 属 Enterprise，而且前端 RBAC 仍不能替代 Core 权限。

**结论：REFERENCE。** 借鉴 list/show/edit 连续性、批量动作影响提示、失败反馈与筛选；不整体采用，也不为供应控制面引入 MUI。

### Appsmith：适合快速内部工具，不适合成为本产品的一体化控制面

Appsmith `v2.2` 于 2026-07-09 发布，仓库在 2026-07-19 仍活跃，core 为 Apache-2.0。官方能力包括 REST/数据库 Query、JSON Form、文件上传、图表和 Git version control，搭建数据驱动内部工具很快。

生产接入存在四个硬冲突：

1. 官方公有/私有嵌入均是 iframe；私有嵌入需要自托管、SSO 和同域等条件，形成第二套身份与 session。
2. GAC 和 audit logs 属 Business，私有 embed 标为 Enterprise；“开源 core”不等于所需治理能力无商业依赖。
3. Git version control 版本化的是 Appsmith 应用定义，不是 `Deployment`/`RoutePolicy`/`CredentialAccount` 的候选、审批和发布状态。
4. Appsmith audit 可记录 Query execution，官方说明参数可进入日志且上限达 5 MB；若用于凭据/供应命令，会增加敏感数据进入第二日志面的风险。即使完成脱敏，它记录的也是 Appsmith 行为，不是产品领域审计。

**结论：REJECT。** 不做生产 iframe，不直连数据库，不保存供应凭据。若要做临时原型，只允许调用只读、脱敏、可废弃 API，并明确原型不进入发布链。

### Directus：版本交互最值得借鉴，但其数据中心架构与现有 Core 冲突

Directus `v12.1.1` 于 2026-07-01 发布，仓库在 2026-07-18 仍活跃。Data Studio 提供 schema-driven 关系表单、Policy/permission、activity/revision、Insights、Flows；Content Version API/界面支持 compare、outdated 判断、promote 和 revert。这是五个候选中最接近“候选 revision → 查看 diff → promote”的现成产品。

然而 Directus 的核心是“数据库/collection → Directus server → REST/GraphQL → Vue Data Studio”。若让它管理供应对象，就必须让 Directus collection 成为新真相，或建立双向同步；两种方式都会与现有 Core aggregate、CAS、ledger、DBOS 和审计竞争。把现有 API 包成 Directus extension 仍要维护另一套服务和 Vue UI，收益有限。凭据若进入 collection，还必须额外避免 activity/revision/backup 泄漏。

其许可证也不是无条件 permissive OSS：官方说明为 BSL 1.1 + additional grant，超过 500 万美元 total annual finances 的实体在生产使用需商业许可，正式采用前必须做许可证复核。

**结论：REFERENCE / RUNTIME REJECT。** 只借鉴 revisions side panel、字段级 diff、outdated 提示、promote/revert 与关系表单；不部署 Directus，不把供应对象或密钥同步进去。

### ToolJet：组件和集成丰富，但 iframe、平台权限与发布语义重复

ToolJet `v3.20.196-lts` 于 2026-07-17 发布，仓库在 2026-07-19 仍活跃，core 为 AGPL-3.0。官方平台包含表单、表格、图表、REST/GraphQL/SOAP/数据库连接、工作流、RBAC、GitSync、多环境和嵌入。

但公有嵌入是 iframe；安全的私有嵌入通过 ToolJet PAT 建立独立 app-user session，官方标为 Enterprise Self Hosted。动态 page/query/component/row access rule 也标为 Enterprise，audit logs 标为 Team/Enterprise 付费能力。GitSync/Release 管理 ToolJet app version，不是产品供应 revision。若 Builder 直接编排 Query 或 Workflow，还可能绕过 Core 的命令白名单、接受态和 CAS。

**结论：REJECT。** 不进入生产控制面，不持有密钥或写权限。其多环境/发布 UX 可作一般参考，但不能成为实际发布系统。

## 横向风险：为什么“嵌一个低代码页”并不轻

| 风险 | 若采用 Appsmith/Directus/ToolJet | 本项目要求 |
| --- | --- | --- |
| 身份 | Better Auth 用户之外再维护平台用户、SSO 或 PAT | 一个登录态；现有 admin 入口 + Core capability permission |
| 授权 | 平台 RBAC 只保护其 page/query/collection | 每个 Core query/command 服务端默认拒绝；隐藏按钮不算权限 |
| CAS / 并发 | 通用 update 易覆盖较新 revision | expected revision、冲突展示、刷新后重审影响 |
| 审计 | 记录平台页面、Query 或 collection 变更 | actor、permission、target、before/after、reason、correlation、结果和领域语义 |
| 密钥 | 多一个 datasource/日志/备份/平台管理员可见面 | secret value 只写入 vault；UI/API 只回 mask、version、status、testedAt |
| 三模态任务 | 通用 CRUD/Workflow 容易把 submit、poll、cancel 当普通按钮 | 冻结 RouteSnapshot；接受未知禁止重提；图片/视频晚到终态和资产托管可恢复 |
| UI/无障碍 | iframe 的焦点、导航、主题、错误态和移动端独立 | 一个 React/shadcn 壳、统一 breadcrumbs/权限/错误/空态/键盘路径 |
| 运维 | 新增服务、数据库、升级、备份、CVE、HA 与监控 | Cloudflare + 现有 Core/Web 边界内最小新增依赖 |

最危险的接法是让低代码平台直连业务数据库。它会绕过 Core 对 permission、CAS、secret、发布门、账本和审计的唯一写入路径。即使未来为只读报表使用低代码工具，也只能接脱敏 read model 或受控 BFF，绝不获得生产表直写权限。

## 推荐的原生页面构成

不采用整套框架不等于从零手搓所有 UI。供应控制面沿用现有组件体系，按领域任务组合成熟基础件：

1. **供应总览**：文本/图片/视频 readiness、核心模型双渠道覆盖、余额/成本风险、异常与待审批；使用现有 Card、TanStack Table、Recharts。
2. **供应链目录**：Provider → Contract → CredentialAccount → Channel → Deployment → CatalogModel 的列表/详情与反向影响查询；默认表格，关系图只作后续只读辅助。
3. **分步接入向导**：交易方与合同 → 写入密钥 → endpoint 测试 → operation conformance → 数据/价格证据 → Deployment candidate；使用现有 React Hook Form + Zod + shadcn。
4. **发布工作台**：candidate 与 effective revision diff、验证结果、影响账号/套餐/任务、审批原因、publish/drain/rollback；借鉴 Directus compare/promote，但调用 Core command。
5. **路由与分配**：SupplyPool/RoutePolicy revision、套餐默认、AccountAllocation、route simulator；固定模型与 Auto 路径分开表达。
6. **三模态运行下钻**：同步文本 attempt 与异步图片/视频 task 的统一时间线；明确 `rejected_before_accept`、`accepted`、`acceptance_unknown`、poll/callback/cancel/download/asset 状态。
7. **凭据页**：只写、mask、版本、测试证据、绑定、轮换、排空和撤销；任何 diff/audit 都不得含 secret value。

## 选型门与后续票

### 本轮可直接拍板

- **PC-UI-01 — Native control-plane shell**：现有 TanStack 管理壳为唯一实现路径，Appsmith/Directus/ToolJet 不进入生产依赖。
- **PC-UI-02 — Typed query/command boundary**：供应 UI 只调用受控 BFF/Core contracts；禁止浏览器或低代码工具直连生产数据库和 Secret Manager。
- **PC-UI-03 — Revision workspace**：实现 candidate/effective diff、stale detection、impact preview、reason、CAS publish/drain/rollback，交互参考 Directus、真相保留在 Core。
- **PC-UI-04 — Tri-modal lifecycle views**：首轮页面、状态合同和 E2E 同时覆盖文本、图片、视频；不允许只做文本 CRUD 后宣称供应后台完成。
- **PC-UI-05 — One identity and audit trail**：Better Auth 只负责外层身份，Core capability permission 负责每个动作；统一领域审计，不新增 iframe session/audit truth。

### 仅在触发条件出现时重开框架评估

只有当未来新增大量同构、低风险、无 secret、无发布流的标准 CRUD 资源时，才可让 Refine 或 React-admin 对一个孤立资源做时间盒 spike。验收必须同时比较：代码量、bundle、文件路由保真、现有 QueryClient、服务端权限、CAS/审计映射、shadcn 一致性、无障碍和移除成本。未胜过原生实现，不引入依赖。

## 官方来源与研究边界

检索先使用 OpenCLI；OpenCLI 无法定位部分 Directus/ToolJet 页面后，才以 Web Search 补齐，并只采用项目官方文档、官方仓库与 release。维护状态只表示近期仍有官方发布/提交，不等于已经通过本项目安全、性能或协议验收。

本地现状依据：[`package.json`](../../../mkfast-template-main/package.json)、[现有 admin routes](../../../mkfast-template-main/src/routes/admin/)、[admin middleware](../../../mkfast-template-main/src/middlewares/admin-middleware.ts)、[凭据控制](../../../mkfast-template-main/src/p1/admin-provider-credential-control.tsx)、[模型发布/路由/审计控制](../../../mkfast-template-main/src/p1/admin-model-control.tsx)，以及设计文档 [D-048/D-057/D-068/D-069](../../../docs/design/beauty-marketing-agent-product-design-2026-07-17.md)。

- Refine：[v5 overview](https://refine.dev/core/docs/)、[DataProvider](https://refine.dev/core/docs/data/data-provider/)、[access control](https://refine.dev/core/docs/authorization/access-control-provider/)、[shadcn integration](https://refine.dev/core/docs/ui-integrations/shadcn/introduction/)、[MIT license](https://github.com/refinedev/refine/blob/main/LICENSE)、[`@refinedev/core@5.0.12`](https://github.com/refinedev/refine/releases/tag/%40refinedev%2Fcore%405.0.12)
- React-admin：[architecture](https://marmelab.com/react-admin/Architecture.html)、[DataProvider](https://marmelab.com/react-admin/DataProviders.html)、[TanStack Start](https://marmelab.com/react-admin/TanStackStart.html)、[RBAC/Enterprise boundary](https://marmelab.com/react-admin/AuthRBAC.html)、[MIT license](https://github.com/marmelab/react-admin/blob/master/LICENSE.md)、[`v5.15.1`](https://github.com/marmelab/react-admin/releases/tag/v5.15.1)
- Appsmith：[overview](https://docs.appsmith.com/)、[REST API](https://docs.appsmith.com/connect-data/reference/rest-api)、[JSON Form](https://docs.appsmith.com/reference/widgets/json-form)、[Chart](https://docs.appsmith.com/reference/widgets/chart)、[embed](https://docs.appsmith.com/advanced-concepts/embed-appsmith-into-existing-application)、[GAC](https://docs.appsmith.com/advanced-concepts/granular-access-control)、[audit logs](https://docs.appsmith.com/advanced-concepts/audit-logs)、[Git version control](https://docs.appsmith.com/advanced-concepts/version-control-with-git)、[Apache-2.0 license](https://github.com/appsmithorg/appsmith/blob/release/LICENSE)、[`v2.2`](https://github.com/appsmithorg/appsmith/releases/tag/v2.2)
- Directus：[architecture](https://docs.directus.io/getting-started/architecture)、[collections/accountability](https://docs.directus.io/app/data-model/collections)、[content versions API](https://docs.directus.io/reference/system/versions)、[content versioning](https://docs.directus.io/guides/headless-cms/content-versioning)、[approval workflow pattern](https://docs.directus.io/guides/headless-cms/approval-workflows)、[Flows](https://docs.directus.io/app/flows)、[self-host quickstart](https://docs.directus.io/self-hosted/quickstart)、[license boundary](https://directus.io/pricing/)、[`v12.1.1`](https://github.com/directus/directus/releases/tag/v12.1.1)
- ToolJet：[platform overview](https://docs.tooljet.ai/docs/getting-started/platform-overview/)、[roles](https://docs.tooljet.ai/docs/user-management/role-based-access/user-roles/)、[dynamic access rules](https://docs.tooljet.ai/docs/app-builder/dynamic-access-rule/overview/)、[private embed/PAT](https://docs.tooljet.ai/docs/user-management/authentication/self-hosted/pat/)、[public embed](https://docs.tooljet.ai/docs/app-builder/embed-app/public-app/)、[audit logs](https://docs.tooljet.ai/docs/security/audit-logs/)、[multi-instance/GitSync](https://docs.tooljet.ai/docs/development-lifecycle/environment/self-hosted/multi-instance/instance-as-environment/)、[AGPL-3.0 license](https://github.com/ToolJet/ToolJet/blob/main/LICENSE)、[`v3.20.196-lts`](https://github.com/ToolJet/ToolJet/releases/tag/v3.20.196-lts)

许可证判断仅用于工程选型风险识别，不替代专业法律意见。
