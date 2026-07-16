# SaaS 壳源码审查

审查日期：2026-07-06

## 审查问题

P0 应该直接 fork `references/repos/mkfast-template`，只把它作为参考，还是从更小的壳项目 `references/repos/open-tanstarter` 开始？

## 结论

建议 fork `references/repos/mkfast-template` 作为 P0 的 app-shell 基线。

它适合复用的范围：

- TanStack Start 应用结构、路由组织、布局和 server functions。
- Better Auth 登录、注册、会话、管理员用户管理、API key 脚手架。
- dashboard、settings、admin、pricing、billing、storage、i18n、email、notification、marketing page 等 SaaS 外壳能力。
- payment、storage、newsletter、notification、analytics 的 provider-style 集成模式。
- R2 对象存储接入和 same-origin 文件代理方式。

但不要把它当成 Core API 或产品核心业务后端。

美业内容副驾需要一个自有的 Core API，并使用 Postgres 承载 Store Workspace、Store、Real Asset Library 元数据、Content Core、Platform Variant、Publish Package、Compliance Gate、Platform Capability Matrix、Lead Ledger、usage ledger、cost ledger 和 audit records。这些核心域不应该被塞进模板现有的 D1 `app.schema.ts`。

`references/repos/open-tanstarter` 只建议作为 Postgres-first 的 TanStack Start + Better Auth 参考。它不是 P0 首选壳，因为它缺少 `mkfast-template` 已经具备的大量 SaaS 产品面能力，而且当前栈里有更多早期/RC/beta 组件。

## 本地证据

主要本地来源：

- 产品基线：`合集-v1.2-含开源项目选型.md`
- 产品术语：`CONTEXT.md`
- 源码清单：`references/analysis/02-source-inventory.md`
- mkfast-template 源码：`references/repos/mkfast-template`
- open-tanstarter 源码：`references/repos/open-tanstarter`
- 官方文档索引：`references/INDEX.md`

审查过的 `mkfast-template` 关键文件：

- `references/repos/mkfast-template/package.json`
- `references/repos/mkfast-template/README.md`
- `references/repos/mkfast-template/docs/auth.md`
- `references/repos/mkfast-template/docs/db.md`
- `references/repos/mkfast-template/docs/storage.md`
- `references/repos/mkfast-template/docs/payment.md`
- `references/repos/mkfast-template/wrangler.jsonc`
- `references/repos/mkfast-template/src/auth/auth.ts`
- `references/repos/mkfast-template/src/auth/client.ts`
- `references/repos/mkfast-template/src/db/index.ts`
- `references/repos/mkfast-template/src/db/auth.schema.ts`
- `references/repos/mkfast-template/src/db/app.schema.ts`
- `references/repos/mkfast-template/src/api/payment.ts`
- `references/repos/mkfast-template/src/api/user-files.ts`
- `references/repos/mkfast-template/src/routes/api/storage/file.ts`
- `references/repos/mkfast-template/src/storage/index.ts`
- `references/repos/mkfast-template/src/storage/provider/r2.ts`
- `references/repos/mkfast-template/src/payment/index.ts`
- `references/repos/mkfast-template/src/payment/provider/stripe.ts`
- `references/repos/mkfast-template/src/payment/provider/creem.ts`
- `references/repos/mkfast-template/src/middlewares/auth-middleware.ts`
- `references/repos/mkfast-template/src/middlewares/admin-middleware.ts`

审查过的 `open-tanstarter` 关键文件：

- `references/repos/open-tanstarter/package.json`
- `references/repos/open-tanstarter/README.md`
- `references/repos/open-tanstarter/src/lib/auth/auth.ts`
- `references/repos/open-tanstarter/src/lib/auth/middleware.ts`
- `references/repos/open-tanstarter/src/lib/db/index.ts`
- `references/repos/open-tanstarter/src/lib/db/schema/auth.schema.ts`
- `references/repos/open-tanstarter/src/routes`
- `references/repos/open-tanstarter/src/env/server.ts`
- `references/repos/open-tanstarter/vite.config.ts`

## 产品适配判断

产品基线已经把 P0 定义为面向美业到店和医美/医疗内容商家的云端 Web Regulated Content Mode 创作副驾。核心链路是：

`Store Workspace -> Real Asset Library -> Creation Copilot -> Content Core and Platform Variants -> Publish Package or controlled publish -> Lead Ledger -> next recommendations`

这不是一个通用 SaaS 模板能直接覆盖的问题。模板的价值是加速外壳搭建，不是替代产品领域模型。

`mkfast-template` 的价值在于它已经解决了很多非差异化的 SaaS 工作：登录、设置页、后台、支付入口、文件上传、基础 UI、部署结构等。直接从它开始能缩短拿到可用产品壳的时间。主要风险是过度复用：它现有的数据模型是 user-centric 和 Workers/D1-centric，而本产品是 workspace/store-centric，并且需要更强的 ledger、audit、workflow record。

## mkfast-template 审查结果

### 优势

`mkfast-template` 是完整 SaaS 壳，不是玩具 starter。

它已经包含：

- TanStack Start 应用结构和生成路由。
- Auth 页面和 Better Auth 集成。
- Dashboard、settings、admin、billing、files、API keys、legal/marketing 页面。
- Better Auth admin 和 API key plugin 使用方式。
- Stripe 与 Creem 的 payment provider registry。
- R2 文件存储和 same-origin 文件访问路由。
- Cloudflare Workers 部署配置。
- auth、DB、storage、payment、mail、env、analytics、newsletter、testing 的本地文档。
- 可复用到 admin/customer-success 视图的数据表和 UI 组件。

最值得复用的是 provider boundary。payment、storage、notification、newsletter、analytics 都已经有“调用方不关心具体 provider”的形状。这和本项目后续的 model provider、publish-route provider、renderer、platform capability adapter 很匹配。

### Auth 边界

Better Auth 已在 `src/auth/auth.ts` 和 `src/auth/client.ts` 中接好。路由和 API 中间件也比较清晰：

- `src/middlewares/auth-middleware.ts` 对应用路由和 server functions 检查 session 与 email verified。
- `src/middlewares/admin-middleware.ts` 通过 `session.user.role === 'admin'` 控制 admin 路由和 API。

这足够支撑 P0 的用户登录和管理员访问，但不等于 Store Workspace 权限系统。Store Workspace、Store roles、merchant/operator permissions 应该建模在 Core API 中。app-shell 可以把已认证的用户身份传给 Core API，但 workspace membership 和 store-level authorization 必须由 Core API 判定。

### DB 边界

`mkfast-template` 与 Cloudflare D1 绑定较深：

- `src/db/index.ts` 使用 `drizzle-orm/d1`。
- `src/db/index.ts` 从 `cloudflare:workers` 导入 `env`。
- `src/db/auth.schema.ts` 和 `src/db/app.schema.ts` 使用 SQLite table definitions。
- `wrangler.jsonc` 配置了 D1 binding 和 R2 bucket。

当前非 auth 的 app tables 只有：

- `payment`
- `user_files`

两者都围绕 `user_id` 建模。这对 starter 合理，但对美业内容产品不够。产品需要 workspace/store scope、platform account state、compliance audit、asset usage、content versions、lead records、quota accounting、provider cost records。

### Storage 边界

现有文件模块的机械部分有复用价值：

- 上传元数据表：`src/db/app.schema.ts` 的 `userFiles`。
- 用户侧 API：`src/api/user-files.ts`。
- same-origin 文件路由：`src/routes/api/storage/file.ts`。
- R2 provider：`src/storage/provider/r2.ts`。

但本产品的 Real Asset Library 不只是文件上传，它还需要：

- Workspace/store scope。
- Asset type 和 source。
- 客户授权或 release status。
- before/after 配对规则。
- 美业场景标签。
- 平台复用历史。
- 合规与审计状态。
- 与生成内容、平台变体、发布包的关联。

建议复用 R2 存储和代理机制，但用 Core API 的 asset metadata 替换或包裹 `userFiles` 语义。

### Payment 边界

当前 payment 层支持订阅和一次性/lifetime 支付：

- `src/payment/index.ts` 根据配置创建 provider。
- `src/api/payment.ts` 暴露 checkout、portal、current-plan、payment-completion server functions。
- `src/payment/provider/stripe.ts` 处理 checkout、customer portal、subscription webhooks、invoice paid、payment record updates。
- `src/payment/provider/creem.ts` 处理 Creem checkout、customer portal、webhook verification/parsing、subscription events。
- `src/db/app.schema.ts` 以 user/customer/subscription/session/invoice 维度存储 `payment` records。

这适合作为套餐选择和 customer portal UX 的起点，但不是完整的 usage ledger。

本产品要把 payment state 和 usage accounting 分开：

- Shell billing 负责 plan 展示、checkout、portal entry。
- Core API 负责 quota balance、usage reservation、commit/refund、model cost records、render cost、publish-route cost、audit records、admin adjustment history。

不能只用 `payment.paid` 推导产品权益。Core API 应该结合 plan、quota、workspace membership、usage ledger、feature flags 来计算 capability。

### Runtime 边界

`mkfast-template` 面向 Cloudflare Workers 优化。它适合作为 app-shell 和轻量 server functions，但产品核心任务不应被迫放进 Workers：

- Agent workflows 可能长时间运行，需要 retry、tool-call trace、memory/RAG、provider cost accounting。
- 图文卡片/视频脚本渲染可能需要更重的 CPU、字体处理、浏览器渲染或后台队列。
- 平台能力检查和发布包生成需要持久 audit 与 idempotency。

因此 app-shell 应该调用 Core API 和 Agent Service，而不是把自己演变成完整后端。

## open-tanstarter 审查结果

`open-tanstarter` 的价值是展示一个更小的 Postgres-first app 形态：

- `src/lib/db/index.ts` 使用 `postgres(env.DATABASE_URL)` 和 `drizzle-orm/postgres-js`。
- `src/lib/auth/auth.ts` 使用 `drizzleAdapter(db, { provider: "pg" })`。
- 路由很少：guest auth、authenticated app route、auth API、root、index。

如果后续决定把 auth 或 app-shell data 从 D1 迁到 Postgres，它是不错的参考。

但它不适合作为 P0 主壳：

- 它缺少 `mkfast-template` 已具备的 billing、storage、admin、dashboard、settings、marketing/legal、i18n、production SaaS scaffolding。
- 它虽然更轻，但会把大量壳层工作重新推回项目。
- 当前依赖中有多个早期/RC/beta 部件，包括 Better Auth RC、Drizzle ORM RC、Nitro beta、Vite Plus。

结论：只作为模式参考，不作为起始 repo。

## 架构边界

建议的 P0 边界：

```text
mkfast-template fork
  TanStack Start app shell
  Better Auth session
  Dashboard/settings/admin UI
  Billing/portal UX
  R2 upload/proxy mechanics
  BFF/server functions
          |
          v
Core API, Postgres
  Store Workspace
  Store profile
  Real Asset Library metadata
  Content Core
  Platform Variant
  Publish Package
  Platform Capability Matrix
  Compliance Gate and audit
  Lead Ledger
  Usage ledger and provider cost ledger
          |
          v
Agent Service
  Creation Copilot workflows
  Beauty Skill Pack
  model/provider registry
  tool-call trace
  eval and benchmark hooks
          |
          v
Workers / queue / renderer services
  graphic rendering
  export jobs
  platform route probes
  scheduled reports
```

第一轮 spike 期间，app-shell 可以暂时保留 D1 来承载 starter-local auth/payment/file metadata，前提是不要加入产品核心域表。进入付费试点前，需要明确身份与 shell billing 是继续留在 D1，还是迁移到和 Core API 相同的 Postgres 系统。

## P0 执行路径

### Step 1：Fork app shell

从 `mkfast-template` 创建产品 app，删除或隐藏不服务于美业内容 P0 的泛 demo blocks。保留 auth、dashboard、settings、admin、billing、API keys、files、UI primitives 和 docs。

验收：

- App 可以本地启动。
- 登录/注册可用。
- dashboard/settings/admin 路由可渲染。
- 本地开发能干净地关闭 payment。

### Step 2：冻结 shell/domain 边界

在加入产品表之前创建 architecture decision record：

- App shell 负责 UI、session、简单 BFF routes、public pages、settings、admin surface。
- Core API 负责 product domain、workspace authorization、ledgers、compliance、audit。
- Agent Service 负责 workflow execution 和 tool traces。
- R2 存二进制资产；Postgres 存 asset metadata 和 audit links。

验收：

- 不在 `mkfast-template/src/db/app.schema.ts` 中加入 Store Workspace、Content Core、Platform Variant、Lead Ledger、usage ledger 表。
- Shell routes 通过 typed client 或 server-function adapter 调用 Core API。

### Step 3：增加 Core API skeleton

用 Postgres 和 Drizzle 建一个小的 Core API。首批表建议：

- `workspaces`
- `workspace_members`
- `stores`
- `store_profiles`
- `assets`
- `asset_versions`
- `content_cores`
- `platform_variants`
- `compliance_checks`
- `publish_packages`
- `lead_events`
- `usage_ledger_entries`
- `provider_cost_entries`
- `audit_events`

验收：

- 一个 seeded workspace/store 可以被已认证 shell user 读取。
- Workspace membership check 发生在 Core API，而不是只发生在 shell。
- 每个影响 compliance、publishing、cost、leads 的写操作都创建 audit event。

### Step 4：替换 user-file 语义

保留 R2 机械能力，但在 Core API 中引入 Real Asset Library APIs。Shell 中现有的 files UI 可以重构为 asset library UI。

验收：

- 上传时对象进入 R2，元数据进入 Core API/Postgres。
- 元数据包含 workspace/store scope。
- Asset 使用记录可以关联到 generated content 和 publish packages。

### Step 5：把 billing 接入产品权益

保留 provider pattern 和 billing UI。增加 Core API usage ledger 和 entitlement calculation。

验收：

- Plan state 和 usage balance 分离。
- 一次 generation request 支持 reserve quota、success commit、failure refund。
- Provider costs 独立于 customer billing 记录。

### Step 6：增加 Creation Copilot 产品入口

在 shell 中增加产品路由：

- Workspace/store selector。
- Store profile setup。
- Real Asset Library。
- Weekly content generation。
- Content Core detail。
- Platform Variant editor。
- Publish Package view。
- Lead Ledger view。

这些路由应该通过 adapters 调用 Core API 和 Agent Service。不要把长时间运行的 agent logic 直接嵌进 TanStack route layer。

验收：

- 一个 mock store 可以生成 3 到 5 张 content cards。
- 每张 card 有 compliance status，并可保存为 Content Core + Platform Variants。
- 至少一个 L3 Publish Package 能导出可用文本、资产和人工发布步骤。

## 风险与控制

### 风险：D1 被误用成产品数据库

控制：`mkfast-template/src/db/app.schema.ts` 只保留 shell-local data。产品表从第一个 product spike 开始就放到 Core API/Postgres。

### 风险：用户身份和 workspace authorization 混在一起

控制：Better Auth 只作为 identity/session。Store Workspace membership 和 store permissions 由 Core API 做领域授权。

### 风险：payment records 被误当成 quota accounting

控制：复用 payment provider integration，但建立单独的 usage ledger，支持 reserve/commit/refund。

### 风险：app-shell server functions 变成隐藏后端单体

控制：server functions 只做 BFF/adapters。Business rules、compliance、ledgers、workflow state 放在 shell 外。

### 风险：从 open-tanstarter 重建导致时间浪费

控制：只在需要时借鉴它的 Postgres 和 Better Auth 形态。除非 `mkfast-template` 不可用或拆解成本过高，否则不要把它作为 P0 主壳。

## 采用评分

| 候选方案 | 壳完整度 | 产品域适配 | 后端适配 | P0 速度 | 建议 |
|---|---:|---:|---:|---:|---|
| `mkfast-template` fork | 高 | 中，需要边界控制 | 中；D1/Workers 适合 shell，不适合 core | 高 | 采用为 app shell |
| `mkfast-template` reference only | 高，作为参考 | 高，灵活 | 高，灵活 | 中低 | 壳层工作太多 |
| `open-tanstarter` fork | 中低 | 中 | 高，Postgres-first | 中低 | 只做参考 |
| Custom shell from scratch | 低 | 高 | 高 | 低 | P0 不值得 |

## 最终建议

使用 `mkfast-template` 作为产品 app-shell fork，并立即设置硬边界：

- Shell：TanStack Start、auth、UI、settings、admin、billing entry、upload/proxy mechanics。
- Core API/Postgres：全部产品域、ledgers、compliance、audit、workspace/store authorization。
- Agent Service：content workflow execution、tools、provider registry、traces、eval hooks。

这样能最快拿到可用 P0，同时避免最大风险：让一个通用 D1 SaaS starter 变成 workflow-heavy、ledger-heavy、compliance-sensitive 的本地商家内容产品的数据事实来源。
