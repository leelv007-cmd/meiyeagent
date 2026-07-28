# 票 21 · 套餐/定价/额度可写 + 合规开关
> 建设面: E7 管理后台 ｜ 决策: DEC-ADMIN-CONTROL-PLANE ｜ Blocked-by: 05

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "21",
  "decisionIds": [
    "DEC-ADMIN-CONTROL-PLANE"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-NO-CONFIG-PERSIST"
  ],
  "contractIds": [
    "X-VISUAL-CONFIG"
  ],
  "blockedBy": [
    "05"
  ],
  "closureEvidence": [],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **US27（已核实）**：规格拍板"套餐 / 定价 / 额度在后台可写, so that 商业参数调整不经代码发布"。当前唯一的套餐管理面 `/admin/plans` 是纯只读投影：`mkfast-template-main/src/p1/admin-plan-control.tsx` 全文 147 行、只有一个 `useQuery`（`:30-38`）读 `entitlements.catalog`，唯一交互是刷新按钮（`:56-65`），**0 mutation**——brief 所引锚点未漂移。管理员想把 growth 的文案额度从 100 改成 120、把加量包 `copy-20` 从 0.99 改成 1.29，没有任何产品内入口。
- **套餐/定价事实 = 代码常量**：后台目录读的 `PLAN_OFFERS`（`apps/core/src/p1/foundation/entitlement-module.ts:29-51`）与 `ADD_ON_OFFERS`（`:53-75`）是硬编码 const 数组；`catalog` 查询直接 `structuredClone` 返回（`:219-227`），`checkout_plan` / `checkout_add_on` / 自动加量配置校验（`:137-159` / `:160-181` / `:271`）全从同两个常量取值。另有第二套套餐常量 `defaultProductPlanConfig`（`apps/core/src/product/plans.ts:18-49`）+ env 覆盖（`:79-85`）在 `main.ts:133` 注入旧 Product 侧。改任何一个数值 = 改代码 / 改 env + 重部署，正是诊断病根"改代码才能配"在商业参数上的具体表现。
- **合规开关默认值三处焊死在前端代码**：水印默认关 `useState(false)`、AIGC 标识默认开 `useState(true)`（`mkfast-template-main/src/product/unified-creation-workbench.tsx:360-361`）；门店登记表单 Regulated Mode 默认关 `regulated: false`（`mkfast-template-main/src/routes/dashboard/store.tsx:76`）。平台管理员想调整平台合规姿势（如"新门店默认按受监管品类对待"或"水印默认开"），只能改前端代码发版——US22-27 族"后台可配"在合规开关上同样无落点。
- **票 05 已备好装载位但 wired: false**：票 05 落配置持久层时已注册 `plan.allowances.{starter,growth,pro}`、`compliance.watermark.default`、`compliance.aigc_label.default` 作为 key 装载位，并明确"套餐生效（票 21）建在本票之上，本票不冒充"。本票的职责就是把这些 key **接线成真**（写→读点生效→wired 翻真），并补注册缺口（加量包定价、Regulated Mode 默认值）。
- **票界**：本票只做"商业参数与合规开关可写 + 生效"。水印/AIGC 真正烧录进导出文件与撤权阻断是票 15（本票交付的默认值是它的预填事实源，非其前置）；执行模式切换是票 18；凭据是票 19；配置表与 config_apply/CAS/审计机制本身是票 05，本票复用不重建。套餐月费字段当前产品内不存在（recorded commerce 无真实支付），本票**不发明无读点字段**——"定价可写"落在真实存在的加量包 `amountMicros/currency` 上；最终数值的确定按规格 Out of Scope 仍不在本票。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/p1/admin-plan-control.tsx:11-27`：前端 `PlanCatalog` 接口（mode/plans/addOns）；`:30-38` 只读 query；`:66-121` 三张套餐卡片、`:122-144` 加量包卡片，全部纯展示。brief 锚点"147 行，0 mutation，只读"核实无漂移。挂载点 `mkfast-template-main/src/routes/admin/plans.tsx:6,14`（独立 `/admin/plans` 路由，不在 `admin-control-plane.tsx:14-48` 四 Tab 内）。
- `apps/core/src/p1/foundation/entitlement-module.ts:119-126`：`ProductEntitlementFoundationModule`（name=`entitlements`）构造器——catalog source 的注入点；`:240-255` `requireRecordedCommerce`：生产环境（`recordedCommerceEnabled=false`）下 checkout 族命令一律 FORBIDDEN，catalog 查询不受限（商户与管理员都可读，`query()` 无 admin 门禁）。
- `apps/core/src/main.ts:511-513`：该模块唯一生产装配点（job-worker 的 `P1ApplicationService` 不带 operations 模块，`job-worker.ts:167` 实核——注入只需改一处）；`main.ts:133`（env 套餐）、`:148-151`（`ProductStateEntitlementPolicy` 兜底策略）、`:270`（并发上限取自 env 套餐）、`:415/:424`（两个 ProductService 用 env 套餐做初始额度）——这条 env 遗留读点链本票**不接线**，只做诚实对照（见风险）。
- `apps/core/src/p1/foundation/entitlement-service.ts:140-158`：`activatePlan` 把 checkout 时的 `ProductPlanPolicy` 快照写进账本；`:475` 起 `getProjection` 读的是已存 policy（`:500-510`）而非目录常量——**目录修改天然不追溯已激活套餐**，这是必须用测试锁死的既有不变量；`:812-833` `validatePlan` 非负整数校验是第二道闸。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:360-361`：两个合规开关的硬编码初值；`:1782-1800` 合规区 Switch UI（`:1787` 水印、`:1796` AIGC）；`:791/:811` 逐请求显式写进 `CreativeExecutionContract`；`:1990` 同一状态传入视频工作流面板——前端初始化点唯一。
- `apps/core/src/p1/operations/foundation-module.ts:225,241`：服务端对逐请求开关做 `=== true` 折叠，缺省即 false——服务端语义是"显式携带"，本票不改它（见改造方案第 5 步的边界声明）。
- `mkfast-template-main/src/routes/dashboard/store.tsx:76`：新门店表单 `regulated: false` 初值；`:83-106` 已有门店由真实 store 事实覆盖表单（天然不受默认值追溯影响）；`:573-576` 商户可见的 Regulated 复选框；`:193` 提交进 `register_store`。Regulated 的下游约束已真实存在：`apps/core/src/product/p1-model-policy.ts:67-69`（受监管门店未确认资质 → 缺 `confirmed_qualification`）、`apps/core/src/product/product-service.ts:2689-2702`（受监管门店交付前置 `REGULATED_CONFIRMATION_REQUIRED`）——本票只配"默认值"，不改这条门禁链。
- 复用底座（票 05 产物，形态以 05 落地为准）：`apps/core/src/p1/admin-config/` 配置服务与 key 注册表、`config_apply`/`config_rollback` 命令与 CAS、`server.ts:781-857`/`:859-905` 通用命令查询分发、`application-service.ts:282-382` 幂等机制——本票零重建。

## 改造方案（步骤级）

1. **Schema/契约——key 注册定稿与补缺**（`apps/core/src/p1/admin-config/` key 注册表，票 05 产物上扩展）：
   - `plan.allowances.{starter,growth,pro}`（沿用 05 注册名）：值 schema 定稿为完整套餐形 zod 对象 `{ allowance: { copy, image, video }, concurrencyLimit, queuePriority, supportLabel }`，额度非负整数、并发 ≥1、supportLabel 枚举——与 `entitlement-module.ts:13-19` `PlanOffer` 同形。
   - 新注册 `plan.addons`：加量包数组 `{ id, resource, quantity, amountMicros, currency }[]`，金额为非负整数微元、resource 枚举 copy/image/video、id 唯一。
   - 新注册 `compliance.regulated_mode.default`：boolean；`compliance.watermark.default`、`compliance.aigc_label.default` 沿用 05 注册。全部 global 作用域，写走 admin 门禁。
2. **Application Service——套餐/定价读点接线（不新增 seam）**：`ProductEntitlementFoundationModule` 构造器新增注入 catalog source（从 admin-config 配置服务按 key 读当前 head，未写过的 key 回落 `PLAN_OFFERS`/`ADD_ON_OFFERS` 代码缺省）；`catalog` 查询（`:219-227`）、`checkout_plan`（`:137-159`）、`checkout_add_on`（`:160-181`）、`configure_auto_top_up` 的 offer 校验（`:271`）全部改走同一 source，**每次调用现读**——热加载生效，按规格 §5 在配置面显式声明"热加载"；对应 key 的 wired 标志翻真（05 的存储值 vs 生效值对照从此一致）。注入点只有 `main.ts:511-513` 一处。命令/查询面与门禁不变，模块内部换数据来源，seam 零新增。
3. **Application Service——合规默认值的商户可读投影**：admin-config 模块新增一个窄查询（白名单只含 `compliance.{watermark,aigc_label,regulated_mode}.default` 三键，只返回生效布尔值，不返回版本/操作者元数据），workspace 成员可读——不放宽 05 对 `config_get/config_list` 的 admin 门禁，也不把合规默认值塞进语义不符的 `entitlements.catalog`。管理员详情与历史仍走 05 的 `config_get`/`config_history`。
4. **前端 `/admin/plans` 可写化**：`admin-plan-control.tsx` 升级——每张套餐卡片加编辑表单（额度三项 + 并发 + 优先级，react-hook-form + zod 项目惯例）、加量包卡片加定价编辑、新增"合规开关"卡片（水印默认 / AIGC 标识默认 / Regulated Mode 默认三个 Switch）；所有写入统一经 05 的 `config_apply`（携 expectedRevision CAS + 分级变更确认：变更 diff + 影响范围说明 + 原因），成功后显示新值、版本 +1、操作者与时间；被 env 遗留读点治理的字段（并发上限兜底等，见风险）带「部分接线」诚实标注。paraglide 新增中文文案键；BFF `routes/api/core/p1/commands.ts` 通用转发零改动。
5. **前端默认值消费（默认 = 预填，不是服务端静默改写）**：`unified-creation-workbench.tsx:360-361` 改为从第 3 步查询初始化（查询未返回前合规区呈禁用态，返回后一次性初始化；查询失败回落现行内置缺省；用户已交互后不再被查询结果覆盖）；`:1990` 视频面板同源，无第二初始化点。`store.tsx:76` 新门店表单 `regulated` 初值同查询（已有门店仍由 `:83-106` 真实 store 事实覆盖）。**逐请求语义不变**：请求仍显式携带开关值（`workbench:791/:811`、服务端 `foundation-module.ts:225/:241` 不动），平台默认值绝不静默改写商户的显式选择，也不破坏含 AIGC 开关的既有幂等/报价散列。
6. **测试（全部打 Application Service 外部行为，PG 真实事务，学 `entitlement-module.test.ts` 与 05 的 restartedRepository 范式）**：
   - `config_apply` 写 growth 额度 → `entitlements.catalog` 查询立即返回新值（无重启）；新建 repository 实例（模拟重启）后 catalog 仍返回新值——"后台改了、重启不丢、目录真读它"。
   - 改目录后 `checkout_plan` 激活的新 policy 用新额度；**改目录前已激活的套餐 projection 分毫不变**（锁死不追溯不变量）；改加量包价格后 `checkout_add_on` 按新 `amountMicros` 记账。
   - 合规默认值：写 `compliance.regulated_mode.default=true` → 窄查询返回 true；窄查询永不返回白名单外 key；商户 actor 读窄查询放行、写任何 plan/compliance key 收 FORBIDDEN。
   - 契约拒绝：负额度、并发 0、金额非整数微元、未注册 key 均被 key schema 拒；幂等复用 05 机制（同 key 同 payload 回放、不同 payload conflict）。测试是工程护栏，不作为关票依据。
7. **留证（D01 口径）**：真实运行界面连续录屏——管理员在 `/admin/plans` 改 growth 额度与加量包价格 → 页面即时新值 + 版本 +1 → 重启 core 两进程 → 值仍在；翻 AIGC 默认开关 → 商户新开创作会话开关初态跟随、新门店表单 Regulated 初态跟随；配 `admin_config_revisions` 版本链 SQL 输出，落 `docs/evidence/contentpackage/`。

## DoD（全部必须是用户可见行为）

- 平台管理员在 `/admin/plans` 直接修改某套餐的文案/图片/视频额度与并发上限，确认后页面立即显示新值、版本 +1、操作者为本人；重启 core（HTTP 与 job-worker 两进程）后再打开，新值仍在。**对照证据（当前 vs 改造后）**：当前该页 147 行 0 mutation 纯只读（`admin-plan-control.tsx:30-38`，唯一交互是刷新 `:56-65`），任何数值调整须改 `entitlement-module.ts:29-75` 常量或 `plans.ts` env 并重新部署、且不留操作者/时间任何痕迹；改造后管理员一次点选完成，全程带版本与审计。
- 平台管理员修改加量包定价（如 `copy-20` 0.99→1.29 CNY）后：目录卡片即时显示新价；此后发生的加量购买按新价记账进用量账本；**修改之前已激活的套餐与已购加量不被追溯改写**（管理员可在同一界面对照验证某商户的既有 projection 分毫未动）。真实购买生效演示在 recorded commerce 开启的环境完成并如实标注（生产 checkout 门禁 `entitlement-module.ts:240-255` 不因本票放宽）。
- 平台管理员把"AIGC 标识默认值"从开改关（或水印默认从关改开）后：商户**新开**创作会话时，合规区对应开关的初始状态跟随平台配置；商户仍可在本次创作中自行改动，其显式选择不被平台默认值覆盖。对照当前：默认值焊死在 `unified-creation-workbench.tsx:360-361`，改默认 = 改前端代码 + 发版。
- 平台管理员把"Regulated Mode 默认值"改为开后：商户**新登记门店**的表单中"受监管品类"默认勾选（商户可改；勾选后既有的资质确认与交付前责任确认门禁按现行链路生效）；已登记门店的 regulated 事实与表单回显不受任何追溯影响。对照当前：`store.tsx:76` 硬编码 `regulated: false`。
- 权限与导航边界可见：商户角色（owner/operator/reviewer）尝试写套餐/定价/合规 key 收到与现有权限口径一致的拒绝；商户一级导航（创作/内容/素材/门店）不出现任何套餐或合规配置入口，合规默认值只以开关初态的形式对商户呈现。
- **关票前置**：上述"改→即时可见→重启仍在→商户侧初态跟随"的连续留证（录屏/截图 + 版本链 SQL）落 `docs/evidence/contentpackage/`。仅 config 表写入成功、单测绿、curl 出 JSON、fixture 全绿，一律不得关票；且遵守 MAP 全局规则——票 01 聚合合同冻结前本票不得关闭。

## Blocked-by / Blocks

- **Blocked-by**：**票 05**（配置持久层）——本票所有写入走 05 的 `config_apply`/CAS/版本/审计与 key 注册表，无 05 则"后台可写"退化为重启即丢的内存假象（MAP 波次 1：21 ← 05）。不依赖票 01 的聚合合同（本票在管理面/配置域，不读写 ContentPackage 成品事实），实施可与主线并行；但受全局 gate 约束：票 01 完成前不得关票。不依赖真实支付或真实供应凭据。
- **Blocks**：无直接下游票（票 20 的前置是 05+19）。但本票是 E7 管理面"套餐定价额度 + 合规开关"建设面，ADR-0009 单发布闸要求 E7 配套可用方可面世；它解阻的是运营能力——US27"商业参数调整不经代码发布"从此成立，并为票 15（水印/AIGC 烧录）提供默认值预填事实源（衔接而非硬前置，15 的 blocked-by 仍是 13）。本票完成不计入北极星"真实跑通链路数"，不冒充链路进度。

## 风险与回退

- **双套餐事实源（最大风险）**：接线后目录/结账走配置层，但 `plans.ts` env 常量仍喂旧 Product 侧（`main.ts:133/:270/:415/:424` 的初始额度、并发兜底与 `ProductStateEntitlementPolicy` 未激活套餐兜底）。管理员可能误以为改目录就改了兜底额度。控制：本票不碰这条 env 链（动它要改两进程 boot 装配，超一票上下文，且旧 Product 按 ADR-0011 已降只读迁移来源）；在配置面用 05 的存储值 vs 生效值对照给这些字段挂「部分接线（兜底仍由部署配置治理）」诚实标注，其收敛随旧三套迁移线（票 17 之后）处置。
- **追溯性破坏**：实现时若"顺手"把 projection 改成现读目录，会让改价追溯已购商户。控制：`activatePlan` 快照语义（`entitlement-service.ts:140-158`）是既有不变量，第 6 步测试显式锁死"改目录后旧 projection 分毫不变"。
- **误操作值域风险**：额度写 0、并发写 0、价格写天文数字直接影响商户购买。控制：key schema 上下限 + `validatePlan`（`:812-833`）双闸；生效边界 = 只影响新激活/新购买；写错可用 05 的 `config_rollback` 回滚出新版本，全程审计可追。
- **异步默认值抢跑**：默认值查询晚于商户操作返回，覆盖已翻的开关。控制：查询未返回前合规区禁用（复用现有 `executionControlsBusy` 禁用样式）、返回后仅一次性初始化、已交互不覆盖；查询失败回落内置缺省，不阻塞创作。
- **recordedCommerceEnabled 环境边界**：生产 checkout 被禁，"新购买按新价"只能在 recorded commerce 环境演示。控制：留证如实标注环境（对齐 D10 诚实标注原则），不以 recorded 演示冒充真实支付；目录可写、持久化、默认值跟随三类证据不受此限。
- **回退**：expand-only——摘除 `main.ts:511-513` 的 catalog source 注入即回代码常量目录；前端默认值查询失败路径本身就是回退（内置缺省）；隐藏 `/admin/plans` 编辑表单即回纯只读。已写入的配置版本与审计作为事实保留，不删除；无表结构回滚（表属票 05）。
