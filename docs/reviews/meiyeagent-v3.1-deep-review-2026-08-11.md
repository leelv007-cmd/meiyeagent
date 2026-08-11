# 丽客美页 Beauty Marketing Agent V3.1：实际完成情况深度 Review

- **仓库**：`leelv009/meiyeagent`
- **规划基线**：`meiye-agent-v3.1-authoritative-plan-2026-08-08.md`
- **Review 快照**：`main@5064c4565b5940c69fd2f08c0a787c6fffaf4a91`
- **Review 日期**：2026-08-11
- **结论口径**：按 V3.1 批次退出门、§37 测试矩阵、§43 发布前绝对门判定；不以“文件存在”“票面 Done”“单个聚焦测试绿”替代生产闭环。

---

## 1. 执行结论

### 1.1 总结

该项目**不是空壳，也不是仅有规划**。Agent-domain contracts、Agent Session Harness、PlanCompiler、确认与快照、DBOS 执行接缝、Artifact、Steering、Memory、HarnessRelease、评测与大量浏览器旅程均已有实质代码和测试资产。

但按权威规划的严格验收口径，当前状态应判定为：

> **已形成较完整的 V3.1 工程骨架和大量纵切实现，但仍未达到“生产闭环完成”或“可发布”状态。**

主要原因不是 UI 打磨，而是仍存在若干会直接触及钱、恢复、租户隔离、事件可见性、exact release、部分交付和真实验收可信度的未闭环项。

### 1.2 估算完成度

以下百分比是本次 Review 的加权估算，不是仓库官方指标：

| 维度 | 估算 | 说明 |
|---|---:|---|
| 代码资产/合同覆盖 | **80%–85%** | 规划中的大部分核心对象、模块、UI 面和测试文件已出现 |
| 生产主链闭环 | **55%–60%** | 多数能力已接入，但若干关键边界仍有 open/partial ticket |
| 验收证据闭环 | **40%–50%** | 聚焦测试不少，但当前同 SHA 的 required gate 仍红，且部分 fixture/票面状态曾产生假绿或漂移 |
| 发布就绪 | **BLOCKED** | 当前不能打 release stamp，不能执行 Legacy 最终退役 |

### 1.3 当前提交的直接阻断信号

1. `main` 当前为 `5064c456...`。
2. 当前分支 **未保护**，GitHub 返回 `protected=false`，required status checks 为空；这意味着即使工作流定义了 required 聚合，仓库治理层也没有强制阻止红灯提交进入 `main`。
3. 同一 SHA 的 `Core quality` run 中：
   - `session-quick-checks` 已通过；
   - `redline-evals` 失败，失败点为 `BeautyPreferenceMemoryEval`；
   - `production-main-journey` 失败。
4. 仓库最新 Wave-4 handoff 自身仍写明 `wave4_ready_to_stamp=false`，并保留 V31-59、V31-26b 等未闭环项。
5. 票面索引与个票状态有漂移：README 仍把 V31-56/57 标为 open，但个票已经记录 2026-08-11 fixed 和聚焦浏览器绿。完成度统计不能直接从 README 状态列求和。

因此，本次 Review 的发布判定为：

```text
RELEASE_VERDICT = BLOCKED
LEGACY_RETIREMENT = BLOCKED
FULL_ROLLOUT = BLOCKED
FOCUSED_DEVELOPMENT / FIXED-WORKSPACE PILOT = ALLOWED
```

---

## 2. 完成情况清单

状态定义：

- **完成**：真实 writer/consumer 已接线，持久化/恢复/计费/浏览器证据满足对应退出门。
- **基本完成**：生产代码已接线，仍欠非核心证据或治理收口。
- **部分完成**：有实质代码，但存在业务闭环、权威来源、恢复或全旅程缺口。
- **未完成/挂起**：核心能力不存在，或明确等待真实试点/外部条件。
- **阻断**：不修复就不能满足 §43 发布绝对门。

| 规划域 | 状态 | 严格完成度 | 已完成资产 | 主要缺口 |
|---|---|---:|---|---|
| Agent contracts / branded IDs | 基本完成 | 85% | Thread、Run、Goal、Plan、Memory、Event、ExecutionPlan、Release、Steering、Outcome 均已有 Zod 合同 | 实现集中在大型 `agent-domain.ts`，与规划的分文件结构不一致；属维护债，不是首要发布阻断 |
| Thread / Run / persistence | 部分完成 | 70% | Thread/Run 合同、Session store、OCC、durability/executionLink 已有 | Thread-root 全旅程和 recent 收编仍需同 SHA 全门证明；恢复扫描仍有 tenant scoping 票 |
| Semantic Event / replay | 部分完成 | 60% | semantic-event contract、store/projector、Artifact producer 已有 | Plan revision 与 semantic event 非原子；边界冲突错误类型仍有缺口；不能保证 canonical revision 一定进入商家投影 |
| Workbench / frontend shell | 部分完成 | 65% | Workbench、Living Plan、Artifact、Interrupt、Publish、Memory receipt 等面已拆出 | 全量长串浏览器门仍红；部分旅程依赖 fixture；Composer 宿主仍重，目录收敛未完全按规划完成 |
| Agent Session Harness | 基本完成但未验收完 | 70% | Kernel adapter、turn runner、ambiguity、tool registry、policy、compaction、billing UX、PlanCompiler bind 已有 | 部分退出路径、真实 authority、E2E real-product mode 和同 SHA required gate 未闭环 |
| Progressive Plan L0/L1/L2 | 部分完成 | 70% | Quick Checks 绿；Level-1 freeze、余额不足、Living Plan revise/start 的聚焦 journey 已修复 | required production-main-journey 当前红；不能用聚焦 2/2、4/4 代替全门 |
| PlanCompiler / MarketingPlanRevision | 部分完成 | 60% | append-only plan、readiness、compiled execution plan、freeze 生产链已存在 | recipe/source/catalog/skill 仍存在合成或伪造 authority；跨载体只消费第一条；Plan→event 原子性不足 |
| Execution confirmation / snapshot | 部分完成 | 65% | approvalBasis、确认请求/决定、reserve、hold expiry、stale/context-fence 大量实现已落 | V31-55 仍 partial；V31-59 ordinary settlement identity 未证明；prepare 恒败缺死信和退款出口 |
| DBOS / billing / recovery | 阻断性部分完成 | 50% | hold-expiry refund、partial resume、FEFO/settlement 大量聚焦测试已绿 | tenantless recovery claim、prepare 无限重试/预留悬挂、ordinary settlement 双轴风险、derived revision 计费捷径 |
| Artifact stable ID | 基本完成 | 75% | Artifact protocol、stable ID、增量投影、聚焦 artifact growth 已绿 | 事件写失败/边界冲突处置仍需完善；全量浏览器门未绿 |
| Steering | 部分完成 | 55% | future patch / derived / replan、partial resume 等实现存在 | `derived_revision` 有潜伏的无 quote 直写路径；收费文案和 ledger 必须同源；跨载体/已 accepted 单元需共同复验 |
| Publish Handoff / self-report | 部分完成 | 50% | Publish panel、手机交接、自报入口及旅程文件存在 | Publish/self-report required journey 尚未在同 SHA 全门闭环；不得由 fixture 自演发布/结果 |
| Memory platform | 阻断性部分完成 | 50% | preference/correction/receipt、注入透明、PG 隔离测试等资产存在 | 当前 `BeautyPreferenceMemoryEval` 红；receipt 撤销态刷新后会复活；README/票面证据仍有漂移 |
| Video | 部分完成 | 40% | Video Artifact、付费执行旅程骨架存在 | 确认前 Plan 无可读分镜；无场景级部分失败/部分结算；fallback/release pin 仍有债 |
| Prompt Pack / HarnessRelease | 部分完成 | 50% | release contracts、prompt packs、workflow/eval jobs 已存在 | 仍有 11 处 prompt pin 静默替换；recipe/skill refs 可合成；exact release 无法完全复现 |
| Eval / CI / release governance | 阻断 | 40% | 工作流覆盖 Core、PG、Quick Checks、Eval、浏览器、依赖审计 | 当前 `redline-evals`、`production-main-journey` 红；main 无保护；未发现显式 lint required gate；状态索引未自动一致 |
| Proactive / Goal / retirement | 未完成/挂起 | 30% | Goal/Opportunity 合同与部分代码存在；26a 已做部分本地退役 | V31-26b 等真实商家试点；外部真实 DBOS/provider canary；旧路径最终删除均未满足条件 |

---

## 3. 已经可以认可的成果

以下部分有足够代码证据，可视为“真实实现资产”，不应重新从零建设：

1. **Agent-domain 合同已经建立**：Thread、Run、Goal、Plan、Memory、semantic event、ExecutionPlanSnapshot、HarnessRelease、Steering、Outcome 等合同不是文档占位。
2. **Agent Session Harness 已形成独立服务层**：具备 server-owned authority、Kernel、tool/policy、progressive level、quote/balance、PlanCompiler、execution confirmation 等接缝。
3. **Progressive Plan 和确认链已穿透多个真实路径**：Level-1 policy exempt、余额不足、Living Plan revise/start、hold expiry、partial resume、rights/context fence 有聚焦测试证据。
4. **Artifact/Workbench 不是纯静态原型**：已有 reducer、semantic-event、stable artifact、Living Plan、Interrupt、Publish、Memory receipt 等真实组件和 Core 连接。
5. **测试工程投入显著**：CI 具有 Core、PG、Quick Checks、eval、browser、dependency audit 多层门，且部分任务确实能在 GitHub Actions 上通过。

修复策略应优先“补闭环、消除旁路、加 fail-closed 和证据”，而不是再做一轮大重构。

---

## 4. 发布阻断问题清单

### P0-01：CI 红灯且 main 未强制门控

**现状**

- `redline-evals` 在 `BeautyPreferenceMemoryEval` 失败。
- `production-main-journey` 失败。
- `main` 未开启保护，required checks 未由仓库规则强制。

**风险**

- 规划 §43 的绝对门失去工程强制力。
- 红灯提交可直接进入 `main`。
- “聚焦 journey 绿”容易被误当成 release-ready。

**修复**

1. 先定位两个 job 的真实失败，不降阈值、不 skip、不放宽断言。
2. 给 `main` 开启 branch protection：
   - 禁止直接 push；
   - 要求 PR；
   - 要求 `required` 聚合、`redline-evals`、`production-main-journey`；
   - 要求分支与 base 最新；
   - 禁止管理员默认绕过，紧急绕过必须留审计。
3. required 聚合必须 fail closed，任何依赖 job `failure/cancelled/skipped` 均不可判绿。
4. 将票面索引一致性加入 CI：README 状态必须由个票 frontmatter 自动生成或校验。

**验收**

- 同一 SHA 的全部 required jobs green。
- 人工制造一个 failing test，PR 不可 merge。
- README 中 V31-56/57 状态与个票一致。

---

### P0-02：计费身份、终态补偿和 Steering 计费仍有旁路

**涉及票**

- V31-59 ordinary settlement billing identity。
- V31-41 prepare failure dead-letter/refund。
- V31-45 derived revision billing bypass。
- 与 V31-55、V31-57 的 hold/expiry/idempotency 语义共同复验。

**核心问题**

1. 普通 DBOS settle/refund 在 `sourceTaskId` 缺失时可能回落到 workflow id，存在 ledger identity 双轴风险。
2. prepare 恒定失败无计数、无死信、无预留释放，可能无限扫描并永久占用积分。
3. `derived_revision` 存在 authority 直写分支；一旦可达可绕过 quote/reserve/settle，同时前台仍宣称“按正常生成计积分”。

**修复设计**

- 建立唯一 `BillingIdentity` 值对象：
  ```ts
  type BillingIdentity = {
    sourceTaskId: string;
    workflowId: string;
    reservationId: string;
    usageId: string;
  };
  ```
- 所有 settle/refund/cancel/expiry/partial resume/derived revision 只接受显式 `BillingIdentity`，禁止在深层函数内“猜” task id。
- prepare failure 引入：
  - versioned failure classifier；
  - attempt counter + bounded backoff；
  - terminal rejection/dead-letter；
  - terminal 时 exactly-once refund；
  - 商家可读失败和运营可检索原因。
- `derived_revision` 统一走 paid workflow；无 quote/reservation 证据时 fail closed。删除或封死直写捷径。

**必须测试的矩阵**

| 场景 | source task 与 workflow | 期望 |
|---|---|---|
| 首次普通执行 | 相同 | settle 一次 |
| prepared attempt | 不同 | 使用 source billing identity，不能新建第二条 usage |
| hard failure | 不同 | refund 原 reservation，一次 |
| hold expiry | 不同 | cancel + refund，一次 |
| prepare 永久失败 | 任意 | 有限重试后终态，不再 sweep，积分有出口 |
| derived revision 无 quote | 任意 | 拒绝，不写 ContentPackage |
| derived revision 有 quote | 任意 | reserve→execute→settle，fee note 与 ledger 同源 |
| duplicate resume/submit | 任意 | debit/accepted side effect 均不重复 |

**禁止捷径**

- 不得只改 UI 文案。
- 不得新增“找不到 usage 就创建一条”的 fallback。
- 不得把失败改成 skip。
- 不得仅以 merchant message 证明退款，必须查 ProductUsage/GrantLot/ledger。

---

### P0-03：恢复扫描缺少 tenant 公平性与终止性

**涉及票**

- V31-33 tenant-scoped recovery。
- V31-41 prepare dead-letter。
- V31-39 确认链入口相关终态；三者不可并行改同一扫描面。

**修复顺序**

1. **先做 V31-33**：选择并固定恢复语义：
   - 推荐：数据库 claim 时按 workspace 分片/公平轮转；
   - 或全局扫描但带 per-workspace quota。
2. 再做 V31-41：在同一 claim 模型上增加 prepare attempt、退避、terminal/refund。
3. 最后复验 V31-39 入口与 persistent arm 的“不重新 prepare”短路，禁止回退确认后冻结语义。

**验收**

- 两个 workspace 各有 100 条积压，A 不能吃光 B 的恢复额度。
- claim 带 workspace/lease/CAS，不能先全局 list 再 tenantless claim。
- 恒败 payload 有有限尝试和 exactly-once refund。
- restart 后仍按相同状态继续，不重复启动 Provider。
- 指标能按 workspace、submission、failure class 查询。

---

### P0-04：Plan revision 与商家可见 semantic event 非原子

**涉及票**

- V31-40。

**风险**

Plan 已写入 canonical store，但 `plan.created/plan.revised` 事件写失败时，商家永远看不到该 Plan；仅有 event idempotency 不能保证有人重试。

**推荐实现**

使用**同事务 outbox**，不建第二套状态机：

1. `MarketingPlanRevision` append 与 semantic event candidate 同事务写。
2. 复用已有 outbox dispatch 状态形态。
3. projector 幂等消费。
4. dispatch 失败可重试；计划与事件 candidate 不会分离。
5. 提供 reconciliation 指标，但不以扫描替代事务原子性。

**验收**

- 在 revision commit 后、dispatch 前故障注入并 kill 进程。
- restart 后商家仍能看到相同 plan revision。
- 同 planId+revision 只出现一个 event。
- 不能出现“revision 有、outbox 无”的状态。
- Living Plan 不依赖前端猜测或重拉其他 DTO 补洞。

---

### P0-05：Context Fence、snapshot identity 与幂等键仍未完全收口

**涉及票**

- V31-55 partial。
- 相关债：context refresh 后复用旧 idempotency key、identity/rights 头不对称、对外错误码/文案不一致。

**修复原则**

- `snapshotHash` 是冻结内容身份；任何 material change 产生**新 snapshotHash + 新 admission identity**。
- 原 request 若 stale，返回明确的 `CONTEXT_FENCE_MISMATCH` / `SNAPSHOT_STALE` 商家语义，不得在后续被覆盖成 `IDEMPOTENCY_CONFLICT`。
- JSONB round-trip 比较必须使用 canonical serialization 语义，不能把 `undefined own property` 当不同业务对象。
- `identity`、`fact`、`rights` 的 freeze 与 verify 必须对称；未采集到的 authority 不得伪装成“未变化”。

**验收**

- 旧 snapshot stale 后：
  - 旧 admission fail closed；
  - 新 revision/new snapshot 可执行一次；
  - 重放新 snapshot 为 no-op；
  - 不出现幂等冲突误导。
- 错误码、HTTP status、商家文案和内部 trace 保持一一对应。
- rights/fact/identity 三类分别做 mutation test。

---

### P0-06：exact Prompt / Recipe / Skill authority 未真正闭环

**涉及票**

- V31-32：剩余 prompt pin 静默替换。
- V31-38：recipe/source/catalog/skill 合成值。
- V31-37：视频字幕/封面 fallback 决策与 release pin。

**现状风险**

- 运行台账记录某 release/prompt version，但实际可能使用 builtin。
- skill revision/content hash 可由本地拼接，属于伪造收据。
- recipe/source/catalog 为空或字面量 fallback，Plan 无法重现。

**修复**

1. V31-38 先接真 authority：
   - recipe/source/catalog 从真实 repository/snapshot 取得 exact revision；
   - skill 从 manifest authority 取得 exact revision + contentHash；
   - 缺失一律 fail closed。
2. V31-32 单 owner 全量扫除 11 处 fallback：
   - guard 位于 fallback/repair try-catch **之外**；
   - error 必须带 prompt key；
   - mutation 恢复 builtin 时测试必须红。
3. 视频 fallback 全部从 HarnessRelease pin 读取；未 pin 不得硬编码继续。
4. 在 trace、Plan、Snapshot、Task 上记录同一 releaseId 和 exact refs。

**验收**

- 任一缺 prompt/recipe/skill/catalog/source 均拒绝执行。
- 同 releaseId 的 manifest hash 唯一、不可变。
- rollback 到旧 release 能重放 exact refs。
- eval 归因到实际使用的 pin，不是声明 pin。

---

### P0-07：SSR 数据库连接错误可杀死整个 Web 进程

**涉及票**

- V31-50。

**修复**

- 统一两条 postgres.js connection/socket error 处理路径。
- 将连接错误转换为 request-scoped 5xx 或降级渲染。
- 不做无界重试，不通过扩大连接池掩盖。
- 日志保留 error code、route、workspace correlation，禁止输出 secret。

**验收**

1. 对 dashboard SSR 注入 `53300` 或 socket error。
2. 当前请求返回 5xx。
3. 进程 PID 保持存活。
4. 紧接着健康请求成功。
5. 摘掉 handler 的 mutation 必须让测试变红。

---

### P0-08：E2E 真实性与 full gate 仍未闭环

**涉及票**

- V31-29 fixture truthfulness。
- V31-49 missing browser journeys。
- V31-51–54、当前 `production-main-journey` 失败。
- Wave-4 full serial Web crash/cascade。

**修复原则**

建立两种明确模式，禁止混合：

```text
real-product mode:
  只允许真实 product route / DB / projection / browser UI
  不允许 fixture 在缺状态时自动补成功

scenario-fixture mode:
  允许确定性造错，但必须显式标记 fixture
  不得为 production acceptance 背书
```

**验收**

- `outcome=failed` 必须让 happy-path journey 红。
- 预期提问但未提问必须红。
- Artifact/worksurface 不渲染必须红。
- 同一 SHA、隔离 DB/端口运行：
  - `production-main-journey`
  - `v31-browser-acceptance`
  - memory B2
  - thread-root
  - steering
  - publish/self-report
  - video
- 不接受“单独跑都绿、串行全门红”作为 release 证据；必须修复 stack/process/DB 生命周期。

---

## 5. P1 产品完整性问题

### P1-01：跨载体计划只执行第一载体

**涉及票**：V31-47。

**当前正确行为**是 fail closed，不能先拆门。最终需明确：

- 一个跨载体 revision 是 N 个 Make 还是一个多载体 snapshot；
- Make 级幂等键加载体维度；
- mixed copy+paid media 的确认粒度；
- 部分成功 readiness/结算；
- quote 的载体集合必须等于实际执行集合。

**验收旅程**

`note + copy` revision：

- 两个执行端口都被调用；
- effect keys 不同；
- 重放不重复 side effect；
- quote/ledger 包含两个载体；
- 一个失败时另一个可交付，账目正确；
- 行为绿后才删除 `MULTI_CARRIER_FREEZE_UNSUPPORTED`。

---

### P1-02：Memory 撤销态刷新后复活

**涉及票**：V31-34。

**修复**

- receipt 保持不可变；
- UI 当前 authority/state 从 server-side memory projection 派生；
- revoke 产生持久状态和 negative provenance；
- 后续 injection query 排除 revoked/superseded；
- 同一 merchant 多设备刷新一致。

**验收**

- 撤销→刷新→仍显示已撤销且不可再次撤销。
- 幸存条目仍可撤销。
- 后续任务 receipt 不再包含撤销项。
- `BeautyPreferenceMemoryEval` 恢复绿色，false persistence/cross-store leak 仍为 0。

---

### P1-03：视频付费知情和部分失败能力不完整

**涉及票**

- V31-35：确认前 Plan 分镜。
- V31-36：场景级部分失败和结算。
- V31-37：字幕/封面 assisted fallback release pin。

**修复顺序**

1. 合同增加最小 storyboard/scene intent，保持 strict schema。
2. PlanCompiler 真实生成并写入 plan revision。
3. Living Plan 在确认前展示，不由 Web 从 intent 猜。
4. Harness 增加 scene-level execution result。
5. 定义“已调用但不可用”和“未调用失败”的计费差异。
6. scene retry 使用独立 effect key，只重试目标 scene。
7. fallback 只使用 pinned release prompt/capability。

**验收**

- 商家确认前看到时长、分镜、积分。
- 3 个 scene 中 2 成 1 败：2 个可交付、失败 scene 具名、账目按拍板口径。
- 重试失败 scene 不重复扣整条视频。
- UI 报告消费 Core scene result，而非按文件缺失推断。

---

### P1-04：Publish、自报、Thread 连续旅程需真实闭环

**验收**

- Delivered 后在同 Thread 产生新 Work，刷新后上下文和 pending interrupt 不丢。
- Publish Handoff 绑定 exact ContentPackage revision。
- 未验证能力不显示直发。
- 次日一次自报 chips 写入 canonical manual outcome contract。
- 频控生效，连续两次忽略后降频。
- 浏览器旅程使用真实 product route，不使用客户端注入服务端 gate 配置。

---

## 6. P2 结构和治理债

1. 将大型 `agent-domain.ts` 按规划域拆分，但保持公共导出兼容；不得与 P0 同 PR。
2. 继续把 Composer 宿主收缩为 route/wiring/restore/layout，业务组件移入 `product/agent-workbench`。
3. 增加显式 lint/static-analysis required job；不要把 UI `check` 脚本当 lint。
4. 自动生成 ticket index，个票状态是唯一来源；索引漂移 CI fail。
5. 每张票增加机器可读字段：
   - `status`
   - `plan_refs`
   - `writer`
   - `consumer`
   - `tests`
   - `required_jobs`
   - `evidence_sha`
6. Proactive、percentage rollout、自动回滚门继续遵循 trigger-bound 原则，不因已有代码提前放量。

---

## 7. 建议的 Agent 修复波次

### Wave 0：证据与治理锁定

- 建 repair branch，不再直接改 `main`。
- 记录基准 SHA、当前失败 job/artifact、open ticket snapshot。
- 修复 ticket index 漂移。
- 配置 branch protection。
- 不做业务重构。

**退出门**：任何红灯 PR 无法 merge；状态索引可机器验证。

### Wave 1：钱与 durable correctness

串行顺序：

1. V31-59 billing identity 证明/修复。
2. V31-33 tenant-scoped recovery。
3. V31-41 prepare terminal/refund。
4. V31-45 derived revision paid path。
5. V31-55 remaining snapshot/idempotency/error propagation。

并行独立 lane：

- V31-40 outbox。
- V31-50 SSR process survival。

**退出门**：

- duplicate debit/refund/accepted side effect = 0；
- 所有 reservation 有终态；
- 两租户恢复公平；
- process fault injection 绿；
- Core + PG 全绿。

### Wave 2：exact release authority

1. V31-38 真 recipe/source/catalog/skill。
2. V31-32 全量 prompt fallback sweep。
3. V31-37 video fallback pin。
4. HarnessRelease replay/rollback exactness 测试。

**退出门**：缺任一 pin/ref 均 fail closed；同 releaseId 可完全还原。

### Wave 3：产品闭环

1. V31-47 跨载体。
2. V31-34 Memory server revocation。
3. V31-35/36 视频分镜与部分失败。
4. Publish/self-report/thread-root 真实旅程。

**退出门**：Plan 所见=执行所做=账本所结；刷新/重连不丢。

### Wave 4：全门与外部试点

1. 修复 `BeautyPreferenceMemoryEval`。
2. 修复 `production-main-journey`。
3. 同一 SHA 跑全量 `v31-browser-acceptance`。
4. 真实 DBOS/provider canary，禁止生产副作用重复。
5. 小范围真实商家试点，比较旧流程。
6. 试点结论满足后才开启 V31-26b。

**退出门**：§43 全部 18 条有 evidence；rollback drill 通过；`wave4_ready_to_stamp=true`。

---

## 8. Agent 执行规范

每个修复 Agent 必须按以下格式工作：

### 8.1 开工前

1. 读取权威计划对应章节。
2. 读取目标票及 related/blocked-by。
3. 写下：
   - canonical writer；
   - production consumer；
   - 当前旁路；
   - 失败/恢复路径；
   - 会触碰的语义锁。
4. 先写失败测试或故障注入，确认当前 main 能复现。

### 8.2 实施中

- 一票一 owner。
- 不顺手大重构。
- 不新增第二 writer、第二 durable runtime、第二 release truth。
- 不在 catch 内放 fail-closed guard。
- 不使用 UI 文案替代账本/状态断言。
- 不使用 fixture 补成功状态。
- 不把 red 改成 skip。
- 所有新 idempotency key 必须写明业务身份组成。
- 所有 material snapshot change 必须改变 snapshot identity。

### 8.3 交付证据

每票至少交：

```text
1. base SHA / result SHA
2. RED 命令与失败输出
3. GREEN 命令与真实通过计数
4. production writer file:symbol
5. production consumer file:symbol
6. failure/recovery test
7. PG test（涉及持久化/计费时）
8. Playwright（涉及商家旅程时）
9. required CI job
10. mutation or negative-control 证据
11. rollback note
12. 未解决项与新票
```

---

## 9. 最终验收命令建议

在同一干净 SHA、一次性数据库、隔离端口下执行：

```bash
pnpm install --frozen-lockfile

pnpm --filter @meiye/contracts typecheck
pnpm --filter @meiye/core typecheck
pnpm --filter @meiye/core test

pnpm eval:preference-memory
pnpm eval:redlines
pnpm eval:fact-satisfaction
pnpm eval:copywriting

./scripts/ci/provision-test-db.sh
bash scripts/ci/run-core-persistence.sh

bash scripts/ci/run-pr-production-journey.sh
bash scripts/ci/run-v31-browser-acceptance.sh

pnpm typecheck
pnpm check
```

附加故障注入必须单独执行并上传证据：

- PG `53300` / socket error，SSR 进程存活；
- plan revision commit 后、event dispatch 前 kill；
- prepare 恒败，有限重试 + refund；
- 两 workspace recovery fairness；
- stale snapshot → new identity；
- duplicate submit/resume；
- cross-carrier 一成一败；
- video scene partial failure；
- Memory revoke 后 refresh/reuse。

---

## 10. 可宣布完成的最终条件

只有以下条件同时成立，才可把项目标记为 V3.1 completed：

1. 同一 SHA 的 required CI 全绿。
2. `main` 受保护，红灯不可合并。
3. 当前所有 P0 票关闭且有 writer/consumer/recovery/PG/browser 证据。
4. Plan、ExecutionPlanSnapshot、实际执行、quote/ledger 的载体和 revision 完全一致。
5. 所有 reservation 最终 settle/refund/cancel/dead-letter，不存在永久悬挂。
6. tenant、rights、fact、billing、release identity 均 fail closed。
7. Prompt/Skill/Recipe/Source/Catalog 不存在合成 pin 或静默 builtin。
8. Thread、Interrupt、Artifact、Memory 在刷新/重连后等价恢复。
9. Publish/self-report/video/cross-carrier 旅程走真实 product route。
10. 外部真实 DBOS/provider canary 和真实商家试点完成。
11. rollback 演练通过。
12. V31-26b 条件门满足后，才删除 legacy fallback。

---

## 11. 证据索引

### 规划

- `meiye-agent-v3.1-authoritative-plan-2026-08-08.md`
  - §35 批次与退出门
  - §37 测试矩阵
  - §38 硬门/SLO
  - §43 发布前绝对门

### 当前仓库

- `packages/contracts/src/agent-domain.ts`
- `apps/core/src/p1/agent-session/service.ts`
- `.github/workflows/core-quality.yml`
- `docs/tickets/v3.1/README.md`
- `docs/handoff/v31-w4-section7-progress-2026-08-11.md`

### 关键阻断票

- V31-29 E2E fixture truthfulness
- V31-32 prompt-pin silent substitution
- V31-33 recovery tenant scoping
- V31-34 memory server revocation
- V31-35 video storyboard
- V31-36 video scene partial failure
- V31-38 true recipe/skill authority
- V31-40 plan/event atomicity
- V31-41 prepare dead-letter/refund
- V31-45 derived revision billing
- V31-47 cross-carrier execution
- V31-50 SSR process survival
- V31-55 snapshot/idempotency
- V31-59 ordinary settlement identity
- V31-26b external pilot and final retirement
