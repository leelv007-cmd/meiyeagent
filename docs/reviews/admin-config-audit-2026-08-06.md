# Admin 后台配置项审计（2026-08-06）

范围：`mkfast-template-main` 的 `/admin` 全部 14 个路由页 + `apps/core` 的 admin-config 配置面。方法：五路并行读码审计（壳层 IA / 供给集成 / 能力生成资产 / 用户计费审计 / Core 消费方核查），每个配置项双向核查（UI→落库、落库→运行时消费）。只读审计，未改任何代码。

现场环境核实：Core 在 4100 运行，`.env` 显式 `APP_ENV=development` + `MODEL_EXECUTION_MODE=direct`，未触发 e2e+fixture 旁路——当前 dev 环境下 admin 落库配置会被 runtime 装配优先采用（`apps/core/src/p1/admin-config/runtime-wiring.ts:69-86`，有 regression-001 测试钉住）。

---

## 一、总体结论

1. **写入通道真实且统一。** 五大板块所有写操作都走 `commandP1` → `/api/core/p1/commands` 的类型化命令面（`src/p1/client.ts:244-306`），受控配置带 CAS（expectedRevision）+ 影响面预览确认 + ≥8 字写入原因 + 版本历史回滚 + 不可变审计。没有发现假写入。
2. **Core 侧配置键几乎全部有真实消费方。** `foundation-module.ts` 注册的 30+ 键中，无一个「完全无读取方」；仅 `harness.woz.recipe` 只消费 revision 号不消费值、合规三默认键是「专供前端读」、`plan.addons`/`plan.trial.enabled` 是积分制切换后的退役死链路。
3. **「是否接线」的权威真相表已存在**：`apps/core/src/assembly/domain-rules.ts:63-72` 的 `ADMIN_CONFIG_KEY_CLASSIFICATION`（hotReadKeys 存即生效 / wiredKeys 重启后生效 / readOnlyKeys 拒写），前端据此渲染「当前生效/重启后生效/未接线」徽章，且有 `assertAdminConfigKeyConsistency` 漂移自检。**但这张表本身有两处错标（见 §3.2）。**
4. **主要风险不在「配置不生效」，而在一批「静默坑」**：表单提交成功但字段被丢弃/覆盖、白名单写死导致绑定落空、质量门被前端硬编码通过、以及一条 fail-open 的越权读路径。
5. **IA 层级存在两套并行体系**（侧栏 13 条平铺 vs 能力目录 6 域两层但只覆盖 8 页），加上 supply/models 撞名、audit/templates 页语义超载，层级关系需要一次收敛（见 §4）。

---

## 二、按页面的配置项覆盖完成度与生效性

判定口径：完成度 = 完整/半成品/骨架/纯展示/缺失；生效性 = 端到端生效/仅落库不消费/纯前端/只读。证据为 文件:行号（web 相对 mkfast-template-main，core 相对 apps/core）。

### 2.1 /admin/supply 模型供应与网关控制中心 —— 全后台最闭环的一页

运行表：真服务端分页查询（URL search → `src/p1/use-admin-supply-control.ts:290-307` → core `p1/supply-registry/admin-control-plane.ts:140-240` → 真库查询）。五组 facet、排序、页长、翻页全部端到端生效。缺口：`q` 全文搜索与 `catalogModelId`/`deploymentId`/`taskId` 过滤 Core 已支持但**无 UI 输入框**，只能拼 URL（`admin-supply-run-table-model.ts:48`）；`?taskId=` 只过滤不展开下钻面板（路由从不传 prop，`src/routes/admin/supply.tsx:32-37`）。

14 个受治理动作全部走「预览 → ImpactReviewDialog 二次确认 → 类型化命令 → CAS+幂等+审计」（core `admin-control-plane.ts:1223-1302`）：

| 动作 | 完成度 | 生效性 | 备注 |
|---|---|---|---|
| connectivity_probe / conformance_probe | 完整 | 端到端 | 探针结果写 CredentialAccount 并可自动激活 |
| candidate_config_validate / route_simulate / pre_revoke_impact_check | 完整 | 只读模拟（按设计） | |
| candidate_config_save | 完整 | 仅落库（按设计，需 publish） | |
| publish / rollback | 完整 | 端到端 | 写 `p1_supply_route_policy_heads`，生成链 `readPlanningState` 真读该表进候选过滤（core `model-supply/foundation-module.ts:3366-3429`） |
| channel_isolate / recover / drain | 完整 | 端到端 | 提交闸门 `composer-submission-gate.ts:118` 真拦截新任务 |
| stop_new_tasks | 完整 | 端到端 | **与 isolate 在 Core 落到同一 isolateChannel（`postgres-admin-supply-runtime.ts:1064-1076`），两动作无差别，语义需产品裁决** |
| credential_rotate | 半成品 | 端到端但入口断裂 | 需手填「安全写入回执 ID」，而签发回执的 /admin/integrations 把它丢了（见 2.2） |
| health_balance_refresh | 完整 | 端到端 | 健康覆盖层被路由 healthExcludedDeploymentIds 消费 |

只读面板（总览/凭据/模拟器/五关联视图/权益池）均为真快照投影，无 fixture 回落。

### 2.2 /admin/integrations 集成治理

| 配置项 | 完成度 | 生效性 | 证据 |
|---|---|---|---|
| 平台凭据存入（首次）/ 撤销 | 完整 | 端到端 | `src/p1/admin-provider-credential-control.tsx:124-141` |
| **凭据轮换** | **半成品** | **仅落库，链路断在 UI** | Core `stageRotation` 只暂存密钥并签发 15 分钟有效回执（core `integrations/provider-credential-runtime.ts:344-386`），前端 `await commandP1` **丢弃返回值**只弹「已保存」——操作员拿不到回执 ID，无法去 /admin/supply 完成 credential_rotate。**平台凭据轮换在产品里走不通，secretVersion 永不前进** |
| **测试连接** | **半成品** | **写读错位** | 结果写 IntegrationConnection（core `application-service.ts:521-585`），页面回读却投影 CredentialAccount.lastTest（只被 supply 的 connectivity_probe 更新）——**本页点了测试，本页看不到结果** |
| 飞书工具目录同步并发布 | 完整 | 端到端 | published 工具被 `feishu_tool_catalog` 查询过滤消费；连接只能选不能建（创建在商家侧 `integration-settings.tsx:1192`） |

dev 档提示：`scripts/dev/runtime-profile.mjs` 对未显式设置的键填默认 `FEISHU_MCP_MODE=recorded`（4 个硬编码假工具）、`INTEGRATION_SECRET_STORE_MODE=recorded`（FakeKms）。显式设置永远优先，但不设置就默认 recorded。

### 2.3 /admin/cloudflare 只读盘点

全页只读（按设计），盘点/探针/新鲜度徽章均真实，无 token 时诚实降级 unknown。唯一问题：**「技术台 deep-link」4 个 CTA 是死的**——渲染成 `<span>` 非 `<a>`（`cloudflare-readonly-panel.tsx:201-212`）；Core 有 dashboardUrl 生成器（core `cloudflare-read/deep-link.ts:185-209`）但全仓无调用方。dev 下 CLOUDFLARE_* env 不在 runtime-profile 填充范围，必然全 unknown。

### 2.4 /admin/models 模型

装配层 7 个受控参数：

| 键 | 完成度 | 生效性 | 备注 |
|---|---|---|---|
| platform.defaultModel.{copy,image,video,audio} | 完整 | **端到端热读，存即生效** | 消费于 Day-0 建工作区默认与 composer 偏好兜底（core `workspace-provision.ts:224-264`）；admin 值优先于 env（`core-assembly.ts:543`），**不受 fixture 档影响** |
| model.execution.mode / model.media.execution.mode | 半成品 | **单向生效** | 写 disabled 有 5s TTL 热闸门（`mode-gate.ts:44-58`）；写 gateway/direct 需重启；**裸 `pnpm dev`（不带 .env 显式值）时 runtime-profile 默认灌 e2e+fixture，开机完全不读落库值（`runtime-wiring.ts:69-86`）——界面标「重启后生效」，重启后依然不生效** |
| byok.adapter.assembly | 半成品 | 同上 | fixture 档下强制 recorded（`runtime-wiring.ts:154-159`），无热读 kill-switch |

模型控制台：路由模拟器与生产共用同一 planner（非前端近似）、质量评测真跑落库、Prompt/目录版本回滚真影响生成、Catalog JSON 编辑与积分定价进报价链、生命周期 publish/retire 带影响面确认（enable 无确认直接提交）——以上全部端到端。缺陷：

- **Catalog 的 `capabilities` 与 `routes` 两个字段仅落库不消费**（真实路由来自 RoutePolicy head），UI 还各有统计 chip（`admin-model-control.tsx:1935-1943`）误导运营以为改它们能变路由。
- 「Recent revision activity」表纯前端会话态，刷新即清空；Core 的 catalog_revisions 查询在跑却没接入（`:574, :2094-2112`）。
- 回滚/生命周期表单是「单文本框无 submit 按钮」结构，文本框内回车会触发浏览器隐式提交跳页。

### 2.5 /admin/skills 技能 —— 启停开关真实闭环

绑定模式三态（required/user_selected/disabled）是真正的启停开关，消费链已验证闭合到 LLM 调用（`service.ts:1339` → `stage-injection.ts:20-27` → `execution-selection-internal.ts:398/506`）。治理运行全链、skill_define、回滚、反向依赖退役（fail-closed）均端到端。缺陷：

- **治理白名单硬编码 `['workflow.copy@1']`**（`admin-skills-control.tsx:334`），而实际配方跑 workflow.image_text@1 / workflow.video.15s@1 等——**从后台新建的 Skill 绑到非文案类配方会静默落空、零报错**。这是「表单成功、生成链无变化」的最可能根因。
- user_selected 模式恒空转（userSelectedSkillRefs 全仓无生产者，`service.ts:1351`）= 隐性 disabled。
- 「切换 Published」仅落库不驱动生成链（生成读 bindings 不读 activeRevisionRef）。
- presentationPolicy、skill_deployment 仅落库不消费；expectedPublicationGeneration 乐观锁声明了但从不渲染。
- 「绑定阶段」的工作流版本是自由文本，无下拉无校验无联查（`:226`）。

### 2.6 /admin/recipe-studio 配方工作室 —— 全后台完成度最低

页面自述「受控积木编译」，实际是裸 JSON Textarea（`admin-recipe-studio-control.tsx:168-173`），违反 D-048 禁 raw-json-editor 的既有决议（检测靠 data-testid 正则被绕过）。compile/validate/production 切换与回滚端到端生效，但：

- **「记录评测」「内测试跑」的 `passed: true` 由前端硬编码捏造**（`:198-232`），Core 原样收下——受控发布链的顺序门是真的，质量门是假的。
- **零查询**：无法加载已有 Recipe、无列表无历史，刷新页面 record 丢失后所有按钮永久 disabled，无法接手他人半成品。
- Surface revision 要手输数字且页面无处可查；surfaceId 硬编码。

### 2.7 /admin/templates 官方模板（实为四合一容器）

- **官方模板目录**：新建/版本草稿/灰度（按 workspace 哈希桶真分流）/发布（rollout≠100 服务端 409）/退役/预览全链端到端；模板发布后生成链真读 document（core `application-service.ts:2731-2783, 4595-4720`）。这是全后台完成度最高的控件。
- **敏感词库**：增删改、启停、筛选端到端；生成侧硬门命中即判候选失败（core `policy-gates.ts:302-327`）。**注意 `:306-307` 是「词库为空则跳过」的软失败语义——词条全停用等于整个门关闭。** 三处 commandP1 未传 idempotencyKey。
- **笔记风格集合**：热读，存即生效，界面文案正确。
- **创作体验（Recipe/Surface）**：Recipe 编辑、预览/发布/回滚、Surface 卡片编排端到端生效并决定前台首页排序。三个坑：
  1. **Surface `toolEntryRefs` 前端硬编码 `[]`**（`admin-creation-experience-control.tsx:790`），Core 全量覆盖、前台真消费——**每存一次 Surface 草稿就静默抹掉工具区编排**。
  2. **Recipe 保存草稿丢字段**：factTypes/skillRevisionRefs 从不发送，Core `?? []` 兜底——**改一次标题就清空技能绑定**（`:304-341` vs core `catalog-service.ts:145,164`）。
  3. **Recipe 发布不自动上前台**：Surface recipeRefs 仍指旧 revision，需手工贴新 revisionId 重走发布，且 ID 全靠自由文本输入。

### 2.8 /admin/users 用户

新建用户、封禁/解封、搜索分页筛选、开通人归属（含 DB 触发器审计）端到端。缺口：

- **角色值生效但无修改入口**：role 真被 admin-middleware 与 x-core-actor 消费，但全仓无 setRole 调用、创建表单硬编码 'user'——**后台造不出第二个管理员**。
- **封禁有最长 1 小时执行窗口**：cookie cache 60 分钟（`src/auth/auth.ts:36-40`）且应用不检查 session.user.banned，刚封禁的用户可用缓存 cookie 继续访问。
- 列排序服务端就绪、前端全部 `enableSorting:false`。
- 删除用户/模拟登录/改密码无 UI 但 Better Auth 端点仍活。

### 2.9 /admin/plans 套餐 —— 两类「反向错标」

积分套餐全家桶（plan.credits.trial/starter/growth/pro/addons/cycle_coefficients/trial.enabled）端到端生效：发放（`credit-billing-service.ts:106-130`）、定价（`credit-plan-catalog.ts:68-105`）、对外 `GET /public/plan-catalog`。价格页参考数字控制台端到端。两类错标：

- **plan.addons / plan.trial.enabled 已退役为 readOnlyKeys（写入必抛 INVALID_STATE），页面却仍渲染完整编辑+保存控件**（`admin-plan-control.tsx:39-40`）——运营改完点保存必报错。
- **plan.payment-mapping 相反：结算真读（`credit-billing-service.ts:139-142`），却漏出 wiredKeys，界面显示「未接线」**、effectiveValue 恒 null——看着像死配置，实为活键。

另：CREDIT_PLAN_CONFIG_KEYS 存在三份手抄副本，shell 那份漏了 plan.credits.reference_numbers，导致该键不出现在运行时配置表。注意套餐配置只管发放与报价，**扣减来自 CatalogModel.creditPricing**（在 /admin/models 配），两套配置面独立。合规三默认键（watermark/aigc_label/regulated_mode）仅作前台表单 Day-0 默认值，Core 执行侧只读任务自带字段——**D8 拍板确认此即终态（与 D-117/D-122「生成自由+发布收口」自洽），判「按设计」而非半成品**。

### 2.10 /admin/redemptions 兑换码

生成（积分/码/过期）、列表、作废（CAS）端到端；核销在商家侧自助（composer 配额卡 + /settings/account），积分入账走 credit ledger，与 credit-billing-spec 的单一积分口径对得上（DB XOR 约束禁 grants+credits 并存）。缺口：过期是惰性 sweep（仅管理员开列表时触发，且 revision+1 会让他人页面的作废按钮报 CAS 冲突）；batchId/grants/redeemedBy 三字段骨架；「批量生成」实际每次只造一个码。

### 2.11 /admin/audit 审计

五张审计表 + 运行健康均真实只读；退款复核是页内唯一写操作且最扎实（step-up 二次认证 + 幂等重放校验）。**审计筛选（时间/操作者/动作）与导出：压根不存在，不是半成品**（五张表零筛选控件，grep csv/导出零命中）。

### 2.12 /admin（首页）与 /admin/p1

- 上段三面板数据基本真实，两处诚实标注「未接线」（平台真实消耗、试用发放普查为硬编码 unknown 常量）。
- **下段异常首页的能力清单是静态基线**：13 条硬编码于 `src/p1/capability-inventory.ts`（capturedAt 冻结 2026-07-20），除 job_queue_harness 外 12 条 availability 恒「未核验」。**同一能力在 /admin/capabilities 会叠加供给快照投影显示活状态，在首页恒未核验——两页状态互相矛盾**（`admin-capability-registry.tsx:509-520` vs `admin-exception-home.tsx:61-64`）。
- /admin/p1 为纯重定向别名；重定向 telemetry 的 fromRoute 误报 /admin（`navigation.ts:109`），legacyRedirects 映射两处重复维护。

### 2.13 /admin/capabilities 能力目录

纯只读 IA 导航页（零写操作），运行事实指标真实实时。「允许的安全操作」只渲染 chip 无按钮；技术移交 envelope 只显示 deepLink 字符串。`WIRING-DIFF.md` 已过时（宣称未接线的 live reporters 实际已接），建议删除或重写。

---

## 三、Core 配置面与生效机制（权威事实）

### 3.1 配置键消费判定

30+ 键全部核查，无「完全无读取方」。真消费清单（键 → 消费场景）：note 风格→图文编译、asset-intake 引导→ParseService、harness 三超时→DBOS 工作流与 sweeper、langfuse outbox、今日推荐、due-delivery 保留天数、bounded execution 校准/上限→任务准入 fail-closed、credit 全家桶→CreditBillingService、platform.defaultModel.*→建工作区、payment-mapping→结算。例外三类：

- `harness.woz.recipe`：**只消费 revision 号**（触发上下文重冻结），JSON 值全仓无读取方，schema `z.json()` 无约束——票面若称内容驱动 ContextBundle 与实现不符。
- 合规三默认键：Core 内无业务消费，专供前端 `config_defaults` query（capability 仅需 workspace.read）。
- `plan.addons` / `plan.trial.enabled`：readOnlyKeys，下游分支在 creditBilling 恒注入下不可达，属残留读取。

### 3.2 分类表两处错标（应修 domain-rules.ts）

1. `plan.payment-mapping` 真被结算消费却不在 wiredKeys → UI 错标「未接线」。
2. `plan.addons`/`plan.trial.enabled` 在 readOnlyKeys（正确）但前端套餐页仍渲染可编辑控件（错在 `admin-plan-control.tsx`）。

### 3.3 HTTP 面与认证

admin-config 走通用 P1 双端点（`POST /v1/workspaces/:id/p1/commands|query`，注意 query 单数）：config_apply/rollback/get/list/history/defaults + cloudflare_inventory。三层认证：service-token 传输层 → capability 判定（config.publish 等）→ 模块层 requireAdmin（global 作用域键一律二次过 admin 门）。`config_get/list` 投影区分 storedValue/effectiveValue 并带 `wired` 标记。

### 3.4 fixture 旁路的准确边界

- 触发条件：`APP_ENV=e2e && MODEL_EXECUTION_MODE=fixture`。`runtime-profile.mjs:30-33` 只在两键都未显式设置时灌这对默认值（显式键永远优先，"硬覆盖 .env" 的旧结论已过时）。
- 影响面：model.execution.mode / model.media.execution.mode 开机不读落库值；byok.adapter.assembly 强制 recorded。**platform.defaultModel.* 不受影响**（admin 值优先，env 只兜底）。
- 当前仓 `.env` 显式 development+direct，正常 dev:all 流程不踩此坑；裸 `pnpm dev`（core 不带 .env）会踩。

---

## 四、页面管理逻辑层级关系评估

### 4.1 两套并行 IA

侧栏是单组 13 条平铺（`admin-dashboard-shell.tsx:45`），供给/能力/计费/审计混排。真正按业务域的分组存在于能力目录（6 个 L1 域，`admin-capability-catalog-model.ts:23-30`）但只覆盖 8 页——supply、recipe-studio、cloudflare、capabilities 自身与 index 不在内，CapabilityDrilldownBanner 也因此只出现在那 8 页。**建议：以能力目录的 6 域为准收敛侧栏分组，补齐缺口页。**

### 4.2 命名与语义问题

- **「模型供应」一词指两个页面**：侧栏第 2 项「模型供应」→ /admin/supply，而 /admin/models 的页面 h1 也叫「模型供应」。两页管同一批实体（CatalogModel/ExecutionChannel/路由策略/凭据），是同一份 model-supply 快照的两种切法。
- **「配方」一词指两个东西**：creation-experience 的 Recipe（用户创作入口）与 Core skills 的 platform-recipes（预置 Skill 包）同名异物，Skill 目录说明文案沿用后者语义，易误读。
- **/admin/audit 名不副实**：只读语义的页里挂着退款复核（写操作业务流程）与商家支持。
- **/admin/templates 是四合一容器**：官方模板 + 笔记风格 + 敏感词 + 创作体验。敏感词属合规治理，与模板无关。

### 4.3 页面间断缝

- **Recipe 编辑双入口互踩**：/admin/templates 的创作体验控件与 /admin/recipe-studio 都改 recipe，后者的 studioRelease 发布证据会被前者存草稿主动删除（core `creation-experience/foundation-module.ts:433-435`）。
- **凭据轮换跨页接力棒掉落**：integrations 签发回执 → supply 消费回执，交接处断（§2.2）。
- **供应审计流两处渲染**（supply 总览「最近变更」与 audit 页 SupplyAuditTable），同一份 recentChanges——可接受但应标注同源。
- **Skill↔Recipe 绑定全靠手打字符串**，且被硬编码白名单拒掉。

### 4.4 入口与导航细节

- 商家壳「进入管理模式」跳 /admin/models 而非 /admin 首页（`sidebar-user.tsx:202-211`）——异常优先首页永远不是第一屏。
- 顶栏无面包屑无页题（商家壳有，换壳时丢了），深链 /admin/supply/tasks/xxx 零定位。
- 首页异常清单（静态基线）与 capabilities 页（叠加实时投影）对同一能力显示矛盾状态。
- 无孤儿页、无占位页；一条死文案 admin_navigation_supply；六处硬编码中文违反导航文案单一来源约束。

### 4.5 权限守卫（机制记录）

服务端 adminRouteMiddleware 判 role（`admin-middleware.ts:18-38`）；客户端壳只查 session 不查 role 且 /admin 是 ssr:false；数据层由 BFF 按 session 下发 x-core-actor 由 Core 裁决；关键写入有 recentAdmin step-up。**跨页安全缺口（P0）**：`/api/core/p1/*` 代理读路径不校验管理员——`workspace-core-authorization.ts:21-27` 只要求 session+emailVerified，且 config_get/list/history 在免二次认证名单（`recent-authentication.ts:40-42`），**任何已验证邮箱的普通商家可直接读全部平台配置（含定价与支付映射）**。写路径靠 Core capability 兜底，读路径在 shell 层 fail-open。

---

## 五、修复优先级汇总

> 2026-08-06 追记：本清单中带决策性质的条目已由 §六 的 D1–D9 拍板收敛，开票时以 §六 为准；本节保留审计原貌。

**P0（安全/静默数据丢失）**
1. p1 代理读路径 fail-open，普通商家可读全部平台配置（§4.5）。
2. Surface toolEntryRefs 硬编码 `[]`，每存草稿静默抹掉工具区编排（§2.7）。
3. Skill 治理白名单写死 workflow.copy@1，非文案类 Skill 静默失效（§2.5）。
4. 封禁后 cookie cache 1 小时执行窗口（§2.8）。

**P1（运营会踩的断链/错标）**
5. 凭据轮换回执断链——integrations 应展示回执 ID 或直接跳转 supply 预填（§2.2）。
6. Recipe 草稿丢 skillRevisionRefs/factTypes，改标题清空技能绑定（§2.7）。
7. plans 页两类反向错标：退役键渲染可编辑控件 / payment-mapping 错标未接线（§2.9、§3.2）。
8. recipe-studio 评测与内测 passed:true 前端硬编码，质量门形同虚设（§2.6）。
9. integrations「测试连接」结果写读错位不回显（§2.2）。
10. 模型页三个通道键在裸 dev 档下开机不读，界面「重启后生效」承诺失真（§3.4）。

**P2（IA 收敛与补全）**
11. 侧栏按能力目录 6 域收敛分组；补 recipe-studio 等进能力目录；修 supply/models 撞名。
12. audit 页拆出退款复核；templates 页拆出敏感词。
13. 审计筛选/导出（缺失）；运行表 q/模型/任务过滤补 UI。
14. Catalog capabilities/routes 死字段与统计 chip 清理；models 页 revision activity 接真查询。
15. 后台无 setRole 入口造不出第二个管理员；兑换码惰性过期改定时任务；CREDIT_PLAN_CONFIG_KEYS 三副本收敛；Cloudflare deep-link 接上或撤区块；stop_new_tasks vs isolate 语义裁决；WIRING-DIFF.md 两份过时文档删除或重写；recipe-studio 违反 D-048 裁决。

---

## 六、决策记录（2026-08-06 拍板）

九项决议均已由产品负责人当日拍板，以下为权威记录；与 §2–§5 表述冲突处以本节为准。

**D1｜supply/models 分工 = B（保持两页、明确分工并改名）**
分工：/admin/supply =「供给运行控制台」（探针、隔离恢复、发布回滚、凭据动作、运行表）；/admin/models =「模型资产与定价」（目录、定价、Prompt、评测、生命周期）。两页顶部互挂跳转，「模型供应」撞名文案一次改净（侧栏项、models 页 h1、能力目录条目标题三处）。

**D2｜侧栏 IA 按能力目录 6 域收敛 = A（全量、分两步）**
第一步（低风险）：补齐能力目录覆盖（supply/cloudflare/capabilities/index；recipe-studio 因 D3 下线无需补）+ 按 D1 改名。第二步：侧栏按 6 域分组重排 + 商家壳「进入管理模式」入口改跳 /admin 首页 + 补面包屑；入口改跳与「异常首页静态基线」修复（§2.12）绑定同批落地，避免第一屏呈现矛盾数据。

**D3｜recipe-studio = B（整页下线，并入创作体验控件）**
创作体验控件（/admin/templates 内）成为 recipe 唯一编辑入口；studio 独有的 compile/validate 顺序门命令迁入；「评测门真做」（替换前端硬编码 passed:true）剥离为独立立项，不阻塞下线。下线同时消除双入口互踩（存草稿删 studioRelease 证据）与 D-048 违规。

**D4｜Skill user_selected 模式 = B（本阶段补全商家侧旅程，不砍两态）**
按「饱和开发资源=完整功能落地」口径，补齐 user_selected 成立所需的全链：商家侧「选用技能」UI 与旅程设计、userSelectedSkillRefs 生产者、presentationPolicy（explainable/user_selectable）消费端。此项含前台产品设计，开票前需先出旅程设计稿（建议走 wayfinder 流程）。白名单硬编码 workflow.copy@1 的修复（recipe 目录联查 + 下拉）不受此决策影响，照常 P0 修。

**D5｜Recipe→Surface 引用 = B（保持受控发布语义，手工确认流程化）**
不做发布自动联动。Recipe 发布成功后给「更新 Surface 引用」引导入口；Surface 编辑处把自由文本 revision 输入替换为可查可选的下拉。落点依 D3 收敛后的唯一入口。符合 D-117/D-122「介入位=修正点非审批墙」。

**D6｜stop_new_tasks = A（认定与 isolate 同义，删除入口）**
受治理动作清单删除 stop_new_tasks，语义矩阵收敛为 isolate（停新增+隔离）与 drain（停新增+等在途排空）两种真实行为。

**D7｜管理员角色管理 = A（补 UI + 端点收口）**
用户详情页加角色管理，走 recentAdmin step-up + 审计 + 防降级最后一个 admin。同批对「无 UI 但端点活」的删除用户/模拟登录/改密码端点做显式处置（禁用或补 UI，不留灰色地带）。与 P0「p1 代理读路径 fail-open」同批作为权限面收口。

**D8｜合规三默认键 = 确认为终态**
仅作前台 Day-0 表单默认、执行侧读任务自带字段即最终设计；审计判定由「半成品」改「按设计」（§2.9 已更正）。

**D9｜敏感词空库语义 = B（保持跳过 + 显式告警）**
维持「词库为空/全停用则门跳过」的冷启动友好语义，但在 admin 首页与审计页挂「敏感词门未生效」显式告警，消除静默关门。

**报备项（默认执行，未见异议）**：① `harness.woz.recipe` 定位文档化为「版本触发器」（值无消费方为既定事实，不补消费）；② 封禁 1 小时 cookie 窗口修法取「session 校验处补 banned 检查」，不关 cookie cache。

---

*审计执行：五路并行读码 agent + 主控现场核实（Core 4100 运行态 env、admin-config 键目录与 runtime-wiring 亲读）。审计全程只读；§六 决策由产品负责人 2026-08-06 拍板后回填。*
