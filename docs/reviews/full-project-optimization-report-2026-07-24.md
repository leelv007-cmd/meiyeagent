# 美业内容2 优化报告（可执行 · ROI 排序）— 2026-07-24

> **配套**：评审报告 `docs/reviews/agent-team-full-project-deep-review-2026-07-24.md`（总体结论、成熟度评分、七大横切主题、51 条发现明细）。
> **基线**：HEAD `f2b8c3aa` + 未提交 composer WIP。
> **本报告只谈"做什么、怎么做、什么顺序"。** 每项标注：涉及发现 · 成本 · 收益 · 触发点（如有）。

## 排序原则

1. **ROI = 影响 / 成本**：配置改动 > 局部重构 > 大结构重构；共同根因优先于症状。
2. **尊重触发点**：项目 D-040 已把合规/运营置后；本报告不提前启动挂触发点的能力，只优化"当前功能开发阶段"该做的。
3. **规模化悬崖优先于当下无感**：B-01/C-01 现在测试全绿，但上线数月翻车，且改造成本随历史增长上升——早改便宜。
4. **不破坏已验证资产**：拆 god 文件/优化投影时，靠现有测试（application-service.test 2527 行、product-service.test 2691 行等）回归护航，增量进行。

**六个执行层级**：Tier 0 立即修（WIP 合入前）→ Tier 1 高 ROI 快赢 → Tier 2 结构性治本 → Tier 3 演进/退役（挂触发点）→ Tier 4 安全加固 → Tier 5 前端体验补齐。

---

## Tier 0 — 立即修（composer WIP 合入前必做）

> WIP 是大额未提交改动且引入了真实回归，不能就这样合入 main。

### O-0.1 修掉 Day-0 身份回归 【F-01 · P1】
- **问题**：WIP 把营销身份设为硬性冻结字段，Day-0 不 seed 身份 → 新租户首次创作静默失败，D-029/D-043 回归。
- **动作**（二选一，推荐 b）：
  - (a) `workspace-provision.ts` 的 provisionTrial 或首个 store 登记时 seed 一个"门店中性/官方口吻"默认身份；
  - (b) **推荐**：让 `CreationExecutionSnapshot` 的 identity 可选、缺失时冻结为 `neutral`；服务端 `composer-submission-gate.ts:228` 放行空身份（与后端 harness 已有的中性回退 `langfuse-prompts.ts:12` / `policy-gates.ts:198` 对齐）；前端无身份时不阻断、走中性表达。
- **成本**：小（改 schema 可选性 + gate 放行分支 + 前端去掉硬 return）。**收益**：解除 Day-0 发布阻塞。**验收**：复跑 07-18 那条 Day-0 冷账号真链 e2e，确认新租户 0 前置表单出活。

### O-0.2 WIP 走特性分支 + 全量门 + 评审 【E-10 · P2】
- **动作**：composer 重构在特性分支提交 → 跑 `pnpm typecheck` + core test + web e2e → 正常评审。合入前对三个新 core 文件 `biome format` 统一 2-space（消除 A1-04 tab 漂移）。顺带收敛 A1-03 冗余 composer 投影端点（确认统一 workflows/events 为权威通道后删除或补 web 代理）。
- **成本**：小（流程）。**收益**：消除丢失风险 + 关键提交路径进 CI 门 + 阻止风格漂移扩散。

---

## Tier 1 — 高 ROI 快赢（配置/小改，大杠杆）

> 这些是"改一点、收益大"的项，建议本轮一并做掉。

### O-1.1 ⭐ 给 apps/core + contracts 补 Biome/knip/noUnusedLocals 治理门 【E-03 · P1 · 全报告最高 ROI】
- **为何最高 ROI**：这是主题四的共同根因，也是 E-08（混用缩进）/E-09（死代码）/A1-04（WIP 漂移）的上游；纯配置改动，不动业务逻辑。
- **动作**：
  1. apps/core 与 packages/contracts 的 `check` 脚本加 `biome check`；根 biome.json 显式设 `indentStyle`（与 web 一致 2-space，或团队认可的 tab——但要统一）。
  2. tsconfig（core + contracts）开 `noUnusedLocals` + `noUnusedParameters`。
  3. core 增配 knip。
  4. 并入 `.github/workflows/core-quality.yml` 作为 required 门。
- **成本**：中（首次开启会暴露 7 个混用缩进文件 + 若干未用 import，需一次 `biome format --write` + 清理批，建议独立 format-only commit 与逻辑改动隔离）。**收益**：179k 行止血，防止风格/死代码继续漂移，团队扩张的最大维护杠杆。
- **顺带清掉**：E-08（跑一次 format）、E-09（knip 报出 ArkDirectVideoProvider barrel 导出 + ensurePersonalWorkspace 死代码后删除）。

### O-1.2 额度投影 4 次串行查询改 Promise.all 【C-01 step1 · P1 的零风险部分】
- **动作**：`entitlement-service.ts:705` 的 `for(resource of RESOURCES) await listUsageEvents` 改为 `Promise.all(RESOURCES.map(...))`。
- **成本**：极小（零语义变更）。**收益**：每次配额检查省 3 个 RTT（热路径，几乎每个前端交互触发）。**注**：这只是缓解延迟；治本（窗口化/快照）见 O-2.2。

### O-1.3 邮件 provider 告警脱敏 【D-01 · P2 · 唯一可操作安全项】
- **动作**：`mail/provider/resend.ts:52` + `cloudflare.ts:60` 的缺字段告警分支改为只记录缺失字段名（如 `missing:['from','html']`），禁止打印 to/html/subject 原文，与 GPT Pro A-11 脱敏口径对齐。
- **成本**：极小。**收益**：堵住"EMAIL_FROM 误配 → 认证 token 落日志 → 账号接管"的凭据泄露面。

### O-1.4 接线创作首页「最近创作」+「示例」区 【A3-01 · P1 · 后端已就绪】
- **动作**：`dashboard/index.tsx` 的 ComposerHome 四层之后新增 RecentCreations strip，消费 core 已建的 `recent_list` 操作（`recentLimitForViewport` 落桌面6/移动4、`nextActionLabelForRecent` 出状态驱动文案、每项链 `/dashboard/results/$workId`）；其后渲染 D-076「示例」冷态（复用现存但目前是死码的 `example-store-preview.tsx`）。
- **成本**：小-中（纯 web 消费面，后端投影+单测已就绪）。**收益**：兑现 D-097/D-076/D-032 Day-0=Day-N 连续性；同时消化 A3-02（把 /dashboard/recent 改接 recent_list 或并入本 strip 的"查看全部"）+ A3-03（example-store-preview 从死码变 live）。

### O-1.5 harness 激活口径诚实化 【A1-01 · P2】
- **动作**：`.env.example:38` 措辞从"Optional production five-stage Harness"改为"主创作链路载体，未配置则 composer 创作不可用"；web 侧 composer 提交对 404/503 做能力探测 + 明确降级文案（替代通用失败 toast）；`DEV-START` 一键脚本默认拉起 DBOS system DB 使 `pnpm dev` 即得可用主链。
- **成本**：小。**收益**：消除 fresh clone 后静默 404 的上手断点 + 运维诚实度。

---

## Tier 2 — 结构性治本（中等成本，早改便宜）

> 这些是真正的架构/性能治本，成本随历史增长上升，建议在试点前排期。

### O-2.1 ⭐⭐ Operations 按子聚合拆写边界 【B-01(P1) + E-01(P1) + B-07 一体】
- **关键洞察**：B-01 揭示 god 对象（E-01）拆不动的根因是**持久化把整个工作区当一个聚合**。所以顺序必须是"先拆持久化写边界，再拆 service，最后 thunk 循环依赖自然消解"，反过来只是搬代码。
- **动作**（增量、可分多个 sprint）：
  1. 把 append-only 集合（auditEvents/taskEvents/creationEvents/weeklyFacts）从 `OperationsWorkspaceState` 聚合的 load/save 中剥离——仅追加、不回读（立即消除最大的 O(历史) 读写放大源）。
  2. 引入轻量 `WorkspaceMutationContext`（提供 authorize + 幂等 receipt + 审计追加），把 ContentPackage/CreativeJob/Task/Template/WeeklyBatch 各自的写路径拆成独立 service，`loadWorkspace` 改为按需加载所在子聚合而非 22 表全量。
  3. 用按子聚合的行级锁/OCC 替代整工作区 `pg_advisory_xact_lock`（解除单锁串行化）。
  4. `OperationsApplicationService` 降级为组合门面；107-case 分派表随域拆分；main.ts 的 `let+thunk` 循环依赖（B-07）随窄接口注入自然消除。
- **成本**：大（但可增量，一次一个子聚合）。**收益**：同时解决主题二（可维护性合并咽喉）+ 主题三（写放大 + 单锁串行悬崖）+ B-07（脆弱 init）。靠现有 2527 行 application-service.test.ts 每步回归护航。
- **触发点考量**：验证期少商户无感，但**一个试点商户数月运营即可显现**——建议在真实试点前完成 step 1（剥离 append-only），step 2-4 可随 god 文件拆分批推进。

### O-2.2 额度/用量投影窗口化 + 快照 【C-01 step2/3 · P1 治本】
- **动作**：
  - step2：`listUsageEvents`/`listProductEntitlementEvents` 的 SQL 加 `created_at >= 周期起点` 边界（投影本是 month 维度，只需读当期）。
  - step3：引入按月 rollup/snapshot 物化行（consumed 汇总），投影只重放 snapshot 之后的增量事件。
- **成本**：中。**收益**：把最热读路径从 O(N事件) 降到 O(当期事件)，消除 C-01 悬崖。**注意**：grant-lot 生产子类额外叠加 synchronize+rebuild，改造时一并核对。

### O-2.3 god 文件拆分批（低风险搬移为主）【E-05 + E-06 + B-02 + A2-03】
- **动作**（每项都是"移动类到独立文件"而非改写，靠 tsc + 现有测试验证）：
  - `model-supply/index.ts`（5647）：把嵌入的 durable 视频工作流子系统（ContentWorkflowRunner/runDurableVideoWorkflow/VideoComposition/QualityScorer/DurableVideoWorkflowStore，~1700 行）抽到 `p1/video` 或 `p1/model-supply/video-workflow/`；ModelSupplyApplicationService 抽到独立文件；index.ts 回归纯 barrel。
  - `model-supply/foundation-module.ts`（6371）：6 个类各拆独立文件（control-plane-repository / control-plane-service / canvas-text-outbox-worker / 流式 / 校验），保留 barrel re-export。
  - `integrations/application-service.ts`（4200）：按集成边界拆 ConnectionLifecycleService / DouyinIntegrationService / FeishuIntegrationService，薄 facade 组合。integration.test.ts 3475 行护航。
- **成本**：中（机械搬移）。**收益**：消除主题二剩余体量集中；导航/blame/合并冲突显著改善。**依赖**：建议在 O-1.1（core lint 门）之后做，避免拆分时引入新漂移。

### O-2.4 抽共享 Postgres 事务 helper 【E-04 · P2】
- **动作**：抽 `withPgTransaction(pool, async (client) => {...})`（内建 BEGIN/COMMIT/ROLLBACK/release），39 个仓库文件改回调式调用。增量迁移，每步靠对应 `*.postgres.test.ts` 回归。
- **成本**：中（39 文件但机械）。**收益**：消除"某仓库漏写 ROLLBACK/release 泄漏连接"的手动正确性契约（尤其 core 无 lint 兜底时）。

### O-2.5 harness 只读 ContentPackage 端口 【B-05 · P2】
- **动作**：为 harness 提供只读 ContentPackage 端口（由 operations 暴露、返回 contracts 投影类型），harness 不再 import operations 内部 `buildContentPackage`/表名；若需写则统一经 `adoptHarnessCandidate` 走锁+OCC。
- **成本**：中。**收益**：消除边界泄漏，operations 改 ContentPackage schema 不再静默波及 harness。**可与 O-2.1 一并做**（都是 Operations 边界收敛）。

### O-2.6 执行快照复用 contracts canonical schema 【B-06 · P2】
- **动作**：`creation-execution-snapshot.ts` 从 `@meiye/contracts` 复用 platform/revisionReference/deliverable/lens 的 canonical schema（或复用其 id 常量数组构造 z.enum）；统一 lens 词汇为 `image_text` 或在 contracts 显式定义"执行 lens vs 目录 lens"映射函数并单测钉死。
- **成本**：小-中。**收益**：兑现"contracts=前后端唯一事实源"，消除 `image_text→image` 靠人肉记忆的静默漂移温床。

---

## Tier 3 — 演进 / 退役（挂触发点，防永久债）

> 这些是"过渡态没有退役判据"的挂账（主题六）。不必现在动工，但**必须落一条明确的退役触发点**，否则无限期累积。

### O-3.1 落 Cutover 退役判据与工单 【B-09 + E-02 + E-11 一体】
- **动作**：定义 legacy ProductService 的退役完成判据（如"所有活跃工作区 write-owner=p1 且 legacyInFlightDecisions 为空达 N 天"），落工单；届时删 legacy runtime/service/bridge + 双 `initializeWorkspaceCatalog`，把 1,557 行 apply()（E-02）随之退役而非重构；三套错误分类法（E-11）里的 product DomainError 随之收敛到 P1DomainError。在 CONTEXT/ADR 记录该触发点。
- **成本**：小（现在只需写判据）；退役执行=中。**收益**：防止双内容栈（legacy JSONB vs relational）成为永久复杂度与测试面负担。**触发点**：cutover 实质完成。

### O-3.2 canvas / core 数据库边界收敛 【B-04 · P2】
- **动作**：二选一并写进 ADR/DESIGN——(a) canvas 收敛为纯 BFF（全部状态变更走 core HTTP，core 为唯一 DB 写方）；(b) 正式把 canvas 记为独立有界上下文，明确其独占且与 core 不相交的表集，消除"既直写又 HTTP 委托"中间态；同步更新 D-032 拓扑描述以反映双服务现状。
- **成本**：中（视选项）。**收益**：消除边界模糊 + 连接预算/双迁移属主风险。**触发点**：Pro Studio 商业化前，或 canvas 功能显著扩张时。

### O-3.3 补偿 worker 独立化 + 空闲退避 【B-11 + C-05】
- **动作**：先确认 outboxWorker/resumeReconciler 的 runOnce 具备行级 claim（FOR UPDATE SKIP LOCKED 或 workerId 租约，B-11）；轮询器加空轮询指数退避（250ms→1s→5s，有活复位）或调高默认间隔（C-05，均已 env 可调但默认太紧）；中长期把补偿抽为独立 worker 角色（单独进程/leader 选举）而非搭 HTTP 进程。
- **成本**：小（退避）→ 中（独立进程）。**收益**：API 副本可自由水平伸缩不重复投递 + 消除稳态 ~8 次空 claim/秒的常驻噪声。**触发点**：多副本水平扩容前必做 claim 校验。

### O-3.4 RouteSnapshot 收敛 / gateway foot-gun 收口 【A2-01 + A2-04 + A2-02 + A2-05】
- **动作**：
  - A2-01：按 S2b 原意收敛 RouteSnapshot 为单一 SSOT + 单向 adapter（同名类型至少重命名 FoundationRouteSnapshot/SupplyRouteSnapshot），或撤回 S2b 措辞并文档化多形态为终态、消除审计口径分叉。
  - A2-04：`MODEL_EXECUTION_MODE=gateway` 增 APP_ENV 门控或选择时显式告警"recorded PoC 非真实网关"；BifrostLiteLlmComparison 死代码移入 docs/references。
  - A2-02：seed 后用真实已发布 catalog head revisionId 调 `applyCatalogRevisionHead`，无发布才回退 recorded 标签并显式标 stage。
  - A2-05：supportsDeployment 无 head 时生产路径 fail-closed。
- **成本**：A2-01 中、其余小。**收益**：消除 model-supply 最集中的过度工程症状 + 运维标签失真 + gateway 假响应 foot-gun。

---

## Tier 4 — 安全加固（纵深，低可利用性）

> GPT Pro 21 项修复全在位，无 P0/P1。以下是加固层，可批量做掉。

| 项 | 发现 | 动作 | 成本 |
|---|---|---|---|
| CSRF 纵深 | D-02 | 对 api/core/** 变更路由加显式 Origin/Sec-Fetch-Site 断言或 Better Auth trustedOrigins 校验，作为 SameSite 之外第二道防线 | 小 |
| IPv6 私网归一化 | D-03 | `isPublicIpv6` 改默认拒绝，或补齐 `::a.b.c.d`（IPv4-compatible）与 `64:ff9b::/96`（NAT64）归一化后按 IPv4 私网判定 | 小 |
| BYOK endpoint 守卫 | D-04 | ControlledEndpointProfile 注册/启动时校验 endpoint 为 HTTPS 且解析到公网（复用 isPublicAddress），fail-closed | 小 |
| 信任集中度 | D-05 | 考虑 per-actor token 或调用方身份签名，使 payment/worker/admin 提权不共用同一代理 token；至少把 CORE_SERVICE_TOKEN 轮换/最小暴露列入发布 SOP | 中（by-design，可挂 C-12 外部门） |

---

## Tier 5 — 前端体验补齐（产品完整度）

> 这些是让"商家可见旅程"成一体的 last-mile，多为小改。

| 项 | 发现 | 动作 | 成本 |
|---|---|---|---|
| 提交失败分流提示 | F-02 | 按失败原因分流：缺身份→"先登记表达身份"（带内联入口）、缺报价→"模型/报价读取中或不可用"、未选 lens→现有提示；不要用 lens 必填提示兜所有失败 | 小 |
| 模型/报价不可用恢复路径 | F-03 | 不可用时给可操作恢复：重试链接 / "换文案/图文"显式切换建议 / 按 #129 直接把不可用 Lens 标为明确不可用态（而非可点后灰死） | 小 |
| 内容/素材导航产品化 | F-04 | 按 #130 P1-C 落地 Content/Assets 公共投影治理（业务标题、平台/项目/IP/系列/权利筛选、来源血缘、失败态分离）；达标前不宣称完整旅程上线 | 中（已有票 #130） |
| 缺素材阻塞态入口 | F-05 | 为缺授权素材阻塞态补"上传/选择素材"按钮，聚焦 ComposerImageInput（sourcePickerRef 已存在），与缺门店态对齐 | 小 |
| 在途 Harness 问题卡落点 | A1-02 | result 视图在 needs_input/suspended 时对当前任务的 pending harness decision 内联渲染 HarnessQuestionCard 或给指向收件箱的 CTA，与 D-032"每任务一个阻塞节点"对齐 | 小 |
| 长列表虚拟化 | C-06 | 对可无界增长的主列表（content-library/canonical-history/results）接 @tanstack/react-virtual 或服务端游标分页 + useInfiniteQuery | 中 |
| 剩余 N+1 | C-03/C-07 | C-03 用 `DISTINCT ON (asset_id) ... ORDER BY asset_id, event_order DESC` 一次取全部资产末条 lifecycle；C-07 改 Promise.all 并行解析 reference | 小 |
| 任务控制台性能 | C-02/C-04 | C-02 物化 started_at/cost_micros 为真实列并建索引 + 分面缓存 + keyset 分页；C-04 轮询改指数退避或 DBOS readStream + 仅 eventId 变化才 structuredClone + 加 videoWorkflowId 部分函数索引 | 中 |

---

## 防复发机制 —— 针对头号根因「最后一公里未接线」

主题一（A3-01/F-01/A1-01/F-04）反复出现同一模式：**后端能力+单测就绪，前端消费面缺失，验收绿但体验断**。建议建立一道**轻量对账门**，而非只靠人肉走查：

1. **"后端投影必须有前端消费方"守卫**：对 core 新增的 `foundation-module` 投影 action（如 `recent_list`），加一条静态检查——若无 web 端 grep 命中其消费，则 CI 告警（类似现有 `z1-cutover-retirement.static.test.ts` 的 token 守卫思路，扩展到"投影→消费"对账）。
2. **Day-0 真链 e2e 纳入 required**：已有 `uiux-day0-contract.spec.ts` 这条极严格的真链硬门（isTrusted 点击计数、0 前置表单）——把它升为 release-required，则 F-01 这类"新租户静默失败"会在 CI 被拦（而非等人肉走查）。这也是 GL-16/GL-25/26 提到的"CI 真机 job"待办的一部分。
3. **决策→验收对账**：D-097 这类"呈现层要求"的决策，在决策票里显式列出前端验收锚点（如"创作首页四层后有 RecentCreations strip"），纳入 spec 验收清单。

---

## 分阶段路线图（建议）

> 假设当前处"功能完善的产品开发阶段"（D-040），试点尚未启动。

**Sprint A — 止血与快赢（1 个短 sprint）**
- Tier 0 全部（O-0.1 F-01 回归、O-0.2 WIP 入 CI）
- O-1.1 core 治理门（⭐ 最高 ROI）+ 顺带 E-08/E-09
- O-1.2 额度查询 Promise.all、O-1.3 邮件脱敏、O-1.5 harness 口径
- O-1.4 最近创作/示例区接线（+ A3-02/A3-03）
- 防复发机制第 2 条（Day-0 e2e 升 required）

**Sprint B — 结构性治本（2-3 个 sprint，可并行）**
- O-2.1 Operations 子聚合拆写边界 step1（剥离 append-only）——试点前必做
- O-2.2 额度投影窗口化/快照
- O-2.3 god 文件拆分批（在 O-1.1 之后）
- O-2.4 事务 helper、O-2.5 harness 只读端口、O-2.6 执行快照复用 contracts

**Sprint C — 演进/退役 + 加固（挂触发点，随功能推进）**
- O-2.1 step2-4（子聚合 service + 行级锁）
- O-3.1~O-3.4（cutover 退役判据、canvas 边界、worker 独立化、RouteSnapshot 收敛）
- Tier 4 安全加固批（D-02~D-05）
- Tier 5 前端体验补齐（F-02~F-05、A1-02、C-02~C-07 剩余）

**试点前硬门对账**（沿用团队自身登记，本报告不重复展开）：e2e 升 release-required + CI 真机持久层 job（含历史 GL-25/26）、生产密钥 hardening、trial 定价数值、Langfuse 生产口径；两道商用硬门=ADR-0008 视频六题 spike 验收 + GL-20 真实单店 Owner 验证（均按 D-040 锁触发点）。

---

## ROI 速览矩阵

| 优化项 | 涉及发现 | 影响 | 成本 | ROI | 层级 |
|---|---|---|---|---|---|
| Day-0 身份回归修复 | F-01 | 高（解阻塞） | 小 | ★★★★★ | T0 |
| core 补 biome/knip 治理门 | E-03,E-08,E-09,A1-04 | 高（根因） | 中 | ★★★★★ | T1 |
| 额度查询 Promise.all | C-01(part) | 中（热路径） | 极小 | ★★★★★ | T1 |
| 邮件 provider 脱敏 | D-01 | 中（凭据） | 极小 | ★★★★★ | T1 |
| 最近创作/示例区接线 | A3-01,A3-02,A3-03 | 中-高 | 小-中 | ★★★★ | T1 |
| harness 激活口径诚实化 | A1-01 | 中 | 小 | ★★★★ | T1 |
| Operations 子聚合拆写边界 | B-01,E-01,B-07 | 高（悬崖+根因） | 大 | ★★★★ | T2 |
| 额度投影窗口化/快照 | C-01 | 高（悬崖） | 中 | ★★★★ | T2 |
| god 文件拆分批 | E-05,E-06,B-02,A2-03 | 中 | 中 | ★★★ | T2 |
| 事务 helper / harness 端口 / 快照复用 | E-04,B-05,B-06 | 中 | 中 | ★★★ | T2 |
| Cutover 退役判据 | B-09,E-02,E-11 | 中（防永久债） | 小（判据） | ★★★★ | T3 |
| canvas/core 边界收敛 | B-04 | 中 | 中 | ★★★ | T3 |
| 补偿 worker 独立化+退避 | B-11,C-05 | 中（扩容前必做） | 小-中 | ★★★ | T3 |
| RouteSnapshot/gateway 收口 | A2-01,A2-04,A2-02,A2-05 | 中 | 小-中 | ★★★ | T3 |
| 安全加固批 | D-02,D-03,D-04,D-05 | 低（纵深） | 小 | ★★★ | T4 |
| 前端体验补齐 | F-02~F-05,A1-02,C-02~C-07 | 中（完整度） | 小-中 | ★★★ | T5 |

---

*本优化报告基于 2026-07-24 评审基线（HEAD `f2b8c3aa`）。所有 ROI/成本为量级估计，实际排期以团队容量与触发点为准。*

