# 美页 Beauty Marketing Agent V3.1：当前实现深度 Review 与 Agent 修复方案

> Review 基准：`main@cffc41f6f387e7d8cb50b8d5df84b607efd37ea2`  
> 权威规划：`meiye-agent-v3.1-authoritative-plan-2026-08-08.md`  
> 仓库：`leelv009/meiyeagent`  
> Review 日期：2026-08-11  
> 结论口径：代码存在 ≠ 业务合同成立 ≠ 当前 SHA 验收通过 ≠ 可发布

---

## 1. 结论摘要

### 1.1 总体判断

项目已经不是“尚未开始”的状态。V3.1 的主要领域对象、Agent Session Harness、Plan Compiler、ExecutionPlanSnapshot、语义事件、Workbench、Memory、HarnessRelease、Artifact/Steering、Goal/Proactive 等大部分**代码骨架和主路径已经进入仓库**，并在 2026-08-11 合入了一次较大的 repair wave。

但当前不能认定 V3.1 完成，也不能认定 `main` 可发布。原因不是单一测试偶发，而是四类发布阻断同时存在：

1. `main` 当前 Core TypeScript 编译失败，生产构建被直接阻断；
2. Core persistence、root quality、Journey、Web interaction、Biome、PG evidence 等多个 required gate 同时为红；
3. 计费、恢复、exact pin、recipe/skill 权威、Plan 事件原子性、浏览器主旅程仍存在实质 open/partial 项；
4. `main` 未启用分支保护，红提交能够直接合入；票据索引只校验“README 与票面状态文本一致”，没有校验“状态与代码、提交、CI 证据一致”。

### 1.2 建议完成度

这些比例是基于规划权重、代码接线、当前同 SHA 证据和发布绝对门的 Review 估算，不是机械票数：

| 口径 | 估算 | 含义 |
|---|---:|---|
| 代码/结构资产完成度 | **80%–85%** | 主要模块、合同、表、UI、测试文件大多存在 |
| 按权威规划的行为合同完成度 | **60%–65%** | 多数主路径可辨认，但 exact authority、计费/恢复、视频契约、事件原子性仍未收口 |
| 同一 SHA 的自动化验证完成度 | **35%–45%** | required gate 当前多项失败，release-candidate 验收未形成完整绿证 |
| 综合建议完成度 | **约 62%** | 可以进入集中收口阶段，但不应宣称 V3.1 已完成或可全量发布 |

### 1.3 票据快照（62 张 V31 票，非加权）

| 类别 | 数量 | 票号 |
|---|---:|---|
| 代码已落/历史上有局部证据，但必须在当前 HEAD 重验 | 28 | V31-01–04、06–17、19–25、51、53、56–58 |
| 部分完成、证据债、状态漂移或实现仍需收口 | 20 | V31-05、18、26–29、33–34、36–37、40–41、47、50、52、54–55、60–62 |
| 实质 open | 12 | V31-30–32、38–39、43–46、48–49、59 |
| 废止/记录型，不应作为实现缺口计入 | 2 | V31-35、42 |

> 票数不能直接代表工程完成度。V31-32、38、41、45、59 等一张票的权重高于多张普通 UI 收尾票。

---

## 2. Review 方法与可信度边界

本 Review 使用四层证据，优先级从高到低：

1. **权威规划合同**：批次退出门、A–K 主旅程、18 条发布绝对门、附录 A 硬约束；
2. **当前 `main` 代码**：不是只看目录或提交标题，而是核对具体实现和合同；
3. **当前 HEAD 的 GitHub Actions 与产物**：Core quality run `31451672600`，包含 root、persistence、redline、security 等产物；
4. **票据与仓库自带 Review**：用于理解历史意图，但若与当前代码或 CI 冲突，以当前代码/同 SHA 证据为准。

未把以下内容当成“完成证明”：

- 票面写 `done`；
- 提交信息写 `fix`；
- 测试文件存在但 required job 未运行；
- fixture 直接构造目标结果；
- 只通过静态 grep、单测或局部 Chromium，而没有证明生产接缝；
- 旧 SHA 的绿证直接继承到当前 SHA。

---

## 3. 当前 HEAD 与 CI 实况

### 3.1 仓库治理

- `main` HEAD：`cffc41f6f387e7d8cb50b8d5df84b607efd37ea2`；
- 合并提交：`merge: V3.1 agent repair wave into main`；
- `main` 当前未启用 branch protection，required status checks enforcement 为 off；
- 合并提交未签名。未签名不是产品缺陷，但在 release provenance 上应明确策略。

### 3.2 当前 required gate 快照

当前普通质量工作流设计上有九个 required jobs：redline eval、core、session quick checks、root quality、core persistence、production main journey、P2 browser、V31 browser、production dependency audit，并由 `required` 聚合。

已确认的结果：

| Job / 证据 | 当前状态 | 关键结论 |
|---|---|---|
| `redline-evals` | 绿 | recorded redlines 23/23；merchant language 7/7；负向 control 正常转红；Memory eval 已恢复 |
| `session-quick-checks` | 绿 | Progressive Level 0/1 与零 LLM 行为门通过 |
| `core` | **红** | `@meiye/core typecheck` 失败，Core 单测被跳过 |
| `production-dependency-audit` | **红** | 4 个未豁免 high，另有 12 moderate / 3 low |
| `root-quality` | **红** | typecheck、build、unit、journey、interaction、Biome、evidence freshness、bundle 全部未通过 |
| `core-persistence` | **红** | 16 个叶子级失败，集中在 DBOS replay/timeout、prompt fixture、durable stage、视频旧契约 |
| Browser jobs | Review 时仍在运行/未形成可采信绿证 | 即使后续局部绿，`core`、security、root、persistence 已足以使 required 聚合失败 |
| Release-candidate `e2e` | 未运行 | 仅 workflow_dispatch 或 PR `release-candidate` 标签触发；当前 push 不构成 release 证据 |

### 3.3 Core TypeScript/Build 失败清单

当前编译错误不是一个点，而是修复波次跨域改动没有完成合同传播：

1. `api-runtime.ts`：`StoreProfile | null | undefined` 与 `StoreProfile | undefined` 端口不一致；
2. `composer-plan-session.test.ts`：`CompilePlanResult` 新增多载体 `executionPlans` 后 fixture 未同步；
3. `campaign-work-quote.ts`：访问了 `ComposerSubmissionRequest` 已显式 omit 的 `operation`；
4. `dbos-workflow.test.ts` 两处：普通 `string` 未通过 `PlanConfirmationDecisionId` / request ID branded type；
5. `workflow-core.test.ts`：普通 `string` 未通过 `AgentThreadIdentity`；
6. `model-supply/index.ts`：仍读取可空的 `delivery.subtitles`；
7. `content-package-export-adapter.test.ts`：字幕 `format` 的 optional/required 合同冲突；
8. `content-package-export-adapter.ts`：仍读取可空字幕。

**判断**：V31-47/V31-60/V31-61/Campaign Work2 quote 的票面状态不能按“完成”计算。当前 HEAD 的编译器已经证明合同没有闭合。

### 3.4 Root quality 额外失败

除 Core 编译外，root evidence 还显示：

- Web 静态单测：`completed recommendation prefill rebinds a new run...` 失败；
- Root 普通测试错误地包含要求 `TEST_DBOS_SYSTEM_DATABASE_URL` 的 `dbos-registration.smoke.test.ts`，而 root-quality job 没有 PG service；
- Artifact + SSE + Workbench Journey 因 fixture 未提供 server-owned confirmed experience retrieval 而失败；
- Web interaction：emoji 前缀的第二段 Tiptap selection 未触发 `onAdjust`；
- Biome 7 个错误；
- opt-in PG evidence 共 **91 条 stale**（22 个新 suite 无证据、69 个 suite 在相关代码变更后证据过期）；
- production build 没产出，因此 bundle report 为 `not-run`。

### 3.5 Core persistence 失败分组

当前 fresh Postgres/DBOS run 出现 16 个叶子级失败：

| 分组 | 数量 | 说明 |
|---|---:|---|
| DBOS timeout/replay/legacy layout | 7 | durable step 序、system_default topic、renderer expiry、旧 layout replay、无 reservation continuation 等 |
| Prompt exact-pin fixture | 1 | identity revocation 路径缺 `copyCandidate` frozen pin；这是 V31-32 fixture blast radius 的现实证据 |
| Production media stage topology | 1 | 持久化阶段中出现计划未定义的 `legacy_shadow_observation` |
| Video legacy delivery contract | 7 | 多个 model-supply / repository / derivation 测试因 `delivery.subtitles` 为 undefined 直接崩溃 |

---

## 4. 按规划批次的实际完成度

| 批次 | 估算 | 已完成的主要内容 | 未完成/偏离 |
|---|---:|---|---|
| 批次 1：合同 + Thread + 事件 + 外壳 | **80%–85%** | Agent 域合同、Thread/Run、语义事件、Workbench reducer/外壳、recent 收编大体存在 | replay Journey 当前红；票据/evidence 漂移；A16 视觉基线/真实性能基线未闭合 |
| 批次 2：Session Harness + Progressive Plan | **70%–80%** | Session Harness、Level 0/1 quick checks、Plan Compiler、Living Plan 等已落 | `CompilePlanResult` 合同未贯通；V31-38 真 authority 未做；V31-32 exact pin 仍有 11 处；Journey fixture 红 |
| 批次 3：确认 + 快照 + Make 消费 | **55%–65%** | confirmation request/decision、snapshot/admission、DBOS 接线、部分恢复机制已落 | Core/Persistence 红；计费 identity 和 derived revision 旁路；恢复终态消费者证据未闭合；campaign quote 类型错误 |
| 批次 4：Artifact + Steering + Handoff + 自报 | **55%–65%** | Artifact registry、Steering、Publish Handoff、自报组件/测试大量存在 | 主浏览器旅程与真实生产接缝证据债；stage topology 漂移；视频 partial/legacy 契约未收口；steering 计费旁路 |
| Memory 并行 lane | **70%–75%** | Memory redline eval 已绿；候选/晋升/receipt/revocation 有实现 | V31-18 AC4、来源展示、production-main-journey、撤销后不再注入的同 SHA 完整证据仍不足 |
| 批次 5：Prompt Pack + HarnessRelease + Eval | **50%–60%** | Prompt packs、HarnessRelease 三对象、Ops/Eval 代码存在，recorded eval 绿 | prompt 静默替换、recipe/source/catalog/skill 合成 authority；release-candidate 未跑；依赖安全门红 |
| 批次 6：Proactive + 退役 | **35%–45%** | Goal/Proactive 管道与 runner 收敛代码存在 | 真实商家试点门未过；26b/legacy retirement 未完成；主动建议/Goal 连续旅程缺完整发布证据 |

---

## 5. 发布绝对门逐条 Review

| # | 权威门 | 当前判定 | 主要证据/缺口 |
|---|---|---|---|
| 1 | Plan 与 execution snapshot exact 一致 | **部分/阻断** | snapshot 架构已落；多载体 compile 合同红、recipe/skill 假 ref、prompt fallback 未清 |
| 2 | LLM 不得绕过事实/权利/费用/权限 | **部分** | redline eval 绿；V31-45 derived_revision 计费旁路、V31-59 settlement identity 仍开 |
| 3 | pending interrupt 刷新/重连不丢 | **部分** | 协议和测试存在；当前 DBOS timeout/replay 与 browser 证据未绿 |
| 4 | duplicate resume/event/submit/debit/side effect 为 0 | **部分** | 有大量幂等测试；当前 persistence 失败，不能形成同 SHA 证明 |
| 5 | Day-0 可达、简单任务不变慢/不复杂 | **部分** | Day-0 null 投影已修；Core port 类型仍冲突；Level 1 browser spec/required 证据不完整 |
| 6 | Steering 不静默改变费用/事实/其他页面 | **部分/阻断** | Steering 主体已落；derived_revision 直写不报价不计费；浏览器证据债 |
| 7 | partial output 不写 canonical state | **较高可信** | 合同与 reducer/事件测试存在；仍需当前 required 全绿后正式判定 |
| 8 | Prompt/Skill/Tool/Schema/Model Policy 可定位 exact release | **阻断** | V31-32 余 11 处 silent substitution；V31-38 四类 authority 合成/缺失 |
| 9 | replay/shadow 不产生生产副作用 | **阻断/需裁决** | RC replay 未跑；durable stage 出现 `legacy_shadow_observation`，与五阶段兼容合同冲突 |
| 10 | rollback/kill/restart 重复副作用为 0 | **部分/阻断** | release/rollback 代码存在；RC 未跑，persistence red |
| 11 | live / fixture / recorded 严格区分 | **部分** | V31-29 有进展；V31-30/V31-48 仍开；root smoke/job 拆分本身错误 |
| 12 | 真实门店试点不劣于旧流程 | **未完成** | 26b 与批次 6 明确挂真实试点门 |
| 13 | 不显示原始 CoT | **未发现违反** | 代码/规划一致；不代表其余门可放行 |
| 14 | 无障碍、移动、reduced motion | **证据不足** | 组件规则存在；视觉基线重拍与完整 browser gate 未闭合 |
| 15 | Memory 无跨店泄漏/错误固化 | **部分偏强** | recorded redline/Memory eval 当前绿；生产 Journey/来源/撤销完整证据仍有债 |
| 16 | invalid plan / unresolved hard requirement 不得进入执行 | **部分** | Compiler/policy 有实现；真 recipe/skill/source authority 缺失，Core compile 红 |
| 17 | Event snapshot+replay 等价；ephemeral 不影响恢复 | **部分/阻断** | 事件层已落；Plan outbox 仍为 open，双路径 payload/失败重试有缺口；Journey 红 |
| 18 | Thread 跨 Work 连续；Memory 可管；推荐有依据 | **部分** | 产品面和代码存在；同 SHA browser/试点证据不全 |

**结论**：至少 1、2、6、8、9、10、12、16、17 当前不能放行；因此项目不满足全量发布门。

---

## 6. 深度 Review 发现

### P0-1：当前 `main` 不可构建，修复波次没有完成跨合同传播

#### 问题

repair wave 同时修改了多载体 Plan、Campaign quote、branded IDs、视频交付合同和 Day-0 缺席编码，但没有以 `pnpm typecheck/build` 作为合入前的硬前置。结果是多个领域分别“看似修完”，组合后编译失败。

#### 修复原则

- 先修类型/合同，不得用 `as unknown as` 扩大逃逸；
- fixture 必须与生产合同同形；
- branded ID 用统一 constructor/parser，不在测试里撒裸字符串；
- campaign quote 只能从 signed/server-owned fields 推导 operation，不能读取 request schema 明确 omit 的字段。

#### 退出条件

```bash
pnpm --filter @meiye/contracts typecheck
pnpm --filter @meiye/core typecheck
pnpm --filter @meiye/core test
pnpm build
```

四条在同一 SHA 全绿。

---

### P0-2：视频“字幕/封面无效功能”裁决只改了部分 schema，运行时仍把它当硬 provenance

#### 问题

权威方案已裁决视频不交付字幕/封面，但当前 `hasValidComposedVideoProvenance()` 仍要求：

- `delivery.subtitles.durationSeconds`；
- `delivery.subtitles.text` 非空；
- `delivery.cover` 的 content type、id、object key、sha、size；
- export adapter 仍检查字幕/封面的 recorded synthetic validation。

这不是“可选字段没判空”这么简单，而是**业务权威未真正迁移**：旧功能仍是视频有效性的必要条件。把 `?.` 加上只会把硬崩变成隐性拒绝，仍违反产品裁决。

#### 修复方案

1. 定义新的 canonical video delivery/provenance 版本，不含 subtitles/cover；
2. `hasValidComposedVideoProvenance` 改为只验证：output hash/size、workflow、storyboard/composition revision、duration、clip/source refs、AIGC/brand 合规；
3. export adapter 删除字幕/封面硬门；
4. 历史数据需要时只提供**只读 legacy adapter**，不得把 legacy 字段重新写回新 canonical contract；
5. 删除或迁移所有测试 fixture 的 subtitles/cover；
6. Playwright 明确断言“不承诺字幕轨/封面面板”，场景进度只保留分镜/关键帧。

#### 禁止捷径

- 不得把 `subtitles` 改 optional 后继续读取；
- 不得为了绿测试重新把字幕/封面变成必填；
- 不得在 Plan 中新增分镜或把分镜与积分绑定。

---

### P0-3：计费仍未形成一个 canonical BillingIdentity，Steering/Campaign/普通结算存在分叉

#### 关联票

V31-45、V31-47 residual、V31-59，以及 Campaign Work2 quote。

#### 风险

- `derived_revision` 的潜伏直写路径可绕过 quote/reserve/settle；
- 普通 settlement 在缺 `sourceTaskId` 时可能回退到 workflowId，可能错退或静默 miss；
- 多载体/每 carrier 账本拆分尚未完全闭合；
- Campaign Work2 quote 刚落地即出现 request operation 合同错误。

#### 修复方案

建立一个在 admission 时产生、后续不可重算的 `BillingIdentity`：

```ts
type BillingIdentity = {
  workspaceId: WorkspaceId;
  taskId: TaskId;
  workId: WorkId;
  workflowId: WorkflowId;
  planId: MarketingPlanId;
  planRevision: number;
  snapshotHash: string;
  quoteRef: RevisionRef;
  reservationId: ReservationId;
  carrierUnitId?: string;
};
```

- snapshot、provider attempt、settlement、refund、hold expiry、partial delivery、derived revision、campaign child Work 都只传递该 identity；
- 缺失或不一致一律 fail closed，不允许 `workflowId ?? sourceTaskId` 一类猜测；
- derived revision 按权威规划正常计费，必须创建新修改对象并走 quote/reserve/settle；
- 每 carrier settlement 使用独立 unit identity，但仍聚合在同一 Work/Plan/snapshot 下；
- 对 confirmed/accepted/acceptance_unknown 不做盲重提或“修改原调用”。

#### 必须测试

- 首次执行、重放、prepared retry；
- Campaign Work2 exact quote；
- derived revision；
- hold expiry refund 回原 GrantLot；
- partial delivery；
- duplicate resume/submit；
- 故意错传 task/workflow/quote，必须在扣费前失败。

---

### P0-4：恢复链路有“公平性已修、终止性/消费者/可观测性未闭合”的半完成状态

#### 当前状态

- V31-33 AC1–AC3 已做 workspace 配额公平扫描；AC4 三处 silent-empty 仍开；
- V31-41 已做 prepare failure 计数/终态/refund/运营信号的大部分，但 D-150 “submit 消费终态”与 mutation 证据仍开；
- V31-39 的 `decision == null`、`systemOnlyBlock`、ask_merchant 前台入口/跨设备确认恢复仍未整体关票；
- persistence 当前 DBOS timeout/replay 有 7 个失败。

#### 修复顺序（同域串行）

1. **先锁定入口 identity**：确认 request id、`:r:` successor、snapshot hash、workflow id 只读存储值，不重算；
2. **再修终止性**：prepare transient/terminal 分类、attempt backoff、dead letter、refund/reconciliation；
3. **再修消费者**：submit/read model 必须把 terminal failure 呈现为可处理状态，不得继续 waiting；
4. **最后修公平扫描与 silent-empty**：server-owned retrieval 未绑定一律明确 fail closed，legacy 空值必须单独 adapter + 测试；
5. 运行旧 layout replay matrix，禁止改测试期待来掩盖 durable layout 漂移。

---

### P0-5：exact release 仍是假完成——prompt silent fallback 与 recipe/skill 合成 ref 同时存在

#### Prompt

V31-32 已列出 11 个剩余生产点，缺 pin 时仍可能退到 builtin。其风险是 release 回滚和 eval 归因失真。

#### Plan authority

V31-38 明确指出：

- skill revision 由 `@plan_compile` 合成并现算 hash；
- catalog revision 缺失时使用字面量；
- recipe/source revision 返回空数组。

这意味着 Plan 看似带 exact refs，实则没有权威签发。

#### 修复方案

- Prompt guard 移到任何降级 try/catch 之外；缺 pin 报出 key 并拒绝；
- 每处有 mutation-RED，不能只断最终 outcome；
- recipe/source/catalog 从 published repository/snapshot 真引用读取；
- skill 从 platform skill manifest 读取真实 revision/contentHash；
- 缺失即 `INVALID_STATE`，不得合成；
- release publish 时做 constructive coverage test；runtime 只读 exact bindings。

---

### P0-6：Plan revision outbox 已有实现，但仍不是可关票形态

#### 已完成

- revision 与 outbox candidate 同一事务；
- `pending → dispatched`；
- eventId 稳定；
- dispatcher/poller 已有代码和测试。

#### 新发现/残余

1. `workspaceId` 缺失时回退到 `threadId`，会把租户作用域错误伪装成合法 resource；
2. dispatcher 逐行 `catch { failed += 1 }`，丢掉 error、attempt、age、dead-letter，恒定错误会每秒重试；
3. fast path 与 outbox path 的 payload 被注释为“一个 richer、一个 rebuild”，同 eventId 下若 outbox 先赢，后续 fast path 可能产生内容冲突；
4. outbox 表保存 `payload`，dispatcher 却忽略它并重新构造 candidate；
5. `ON CONFLICT ... DO NOTHING` 没有验证现存 outbox 行是否与当前 revision/eventId 完全一致。

#### 正确收口

- `workspaceId` 必填，legacy 只能通过 authoritative thread→workspace lookup，不能字符串 fallback；
- outbox candidate/payload 是唯一 canonical event candidate；fast path 只能触发同一个 dispatcher 或使用完全相同序列化；
- 添加 attempts、next_attempt_at、last_error_code、dead-letter/ops signal；
- 断言 revision + exact outbox payload 原子；
- crash/replay/concurrent poller/poison row/foreign workspace 全部 PG 测试。

---

### P0-7：CI 本身存在结构性假红/假绿风险

#### 结构性问题

- root-quality 没有 PG service，却通过 root `pnpm test` 启动“必须有 DB 且永不 skip”的 DBOS smoke；
- 与此同时另有专门的 core-persistence job；当前职责重叠导致 root job结构性失败；
- 91 条 opt-in evidence 过期，说明 evidence ledger 没有随大合并自动收口；
- ticket-index CI 只校验 README 与票面 `Status` 文本相同，无法发现“local/no push 其实已经在 main”或“done 但 required gate 红”；
- branch protection 关闭，使上述 required 聚合没有合入约束力。

#### 修复方案

- root test 显式排除 PG/DBOS smoke；core-persistence 必须显式包含并断言数量，避免“排除后永远不跑”；或给 root job provision DB，二选一但不能两边重复/两边漏；
- test manifest 按 `unit / interaction / pg / dbos / browser / release` 分类；每个 suite 只有一个 required owner；
- PG evidence 由 fresh-DB run 产出 machine-readable manifest，再更新 ledger，不手工“批量改 verifiedAt”；
- ticket 状态拆为 `implementation_state`、`verification_state`、`evidence_sha`、`workflow_run_id`；
- `main` 启用 required `Core quality / required`、PR review、禁止普通 bypass。

---

### P0-8：生产依赖安全门红

当前 audit：

| 包 | 当前版本 | Advisory | 修复版本 | 路径 |
|---|---:|---|---:|---|
| `undici` | 7.28.0 | GHSA-4cwx-7wf7-3272 | >=7.29.0 | Cloudflare vite plugin → miniflare |
| `js-yaml` | 4.3.0 | GHSA-5p4m-2wfm-xmqj | >=4.3.1 | core → graphile-worker → cosmiconfig |
| `nanoid` | 5.1.6 | GHSA-28wg-ghj8-5hjv | >=5.1.16 | Web direct |
| `nanoid` | 3.3.16 | GHSA-2v37-7h3g-55p8 | >=3.3.17 | Vite → PostCSS |

处理顺序：优先正常升级直接/上游包；必要时使用精确 override 并跑构建/SSR/Cloudflare/ID 生成回归。临时 waiver 只能在无法立即升级且已做 exploitability 分析时使用，必须包含 owner、理由、过期日和移除票，不能为了绿门永久豁免。

---

### P1-1：`legacy_shadow_observation` 不应静默成为第六个 durable stage

权威规划要求现有五阶段短期保留为物理 durable 拓扑，shadow 只对账确定性字段并时间盒运行。当前 persistence 测试观察到：

```text
intent_naming
context_injection
legacy_shadow_observation   <-- 新增
brief_compilation
execution_selection
assembly_delivery
```

这不是普通测试期望漂移。额外 durable stage 会影响 replay layout、step ordering、版本粘滞和旧 workflow 兼容。

**裁决建议**：把 shadow observation 移出 durable stage list，作为 trace/span/outbox evidence；若坚持保留为 physical stage，必须显式 supersede 权威规划、定义 layout version、legacy replay 与 rollback，不得只改测试数组。

---

### P1-2：浏览器 A–K 主旅程仍未形成“一张表、一份真证据”

必须以权威 A–K 为唯一索引：Day-0、Level 1、Memory B2、Level 2、Video、stale、rights、steering、interrupt、thread、release、自报。

当前已知缺口：

- Level 1 纯 copy 真重放与不重复扣费；
- Memory 来源 preview/observedAt 与撤销后不再注入；
- Artifact stable ID 原位生长；
- Steering 指定范围与 requote；
- Campaign child paid Work exact quote；
- release canary/rollback 同 SHA；
- 视频不承诺字幕/封面、scene partial/resume；
- fixture truthfulness / route envelope / smoke fixture。

每条浏览器旅程都必须经过真实 Core API seam，不能用 route mock 直接返回最终 UI 状态。

---

### P1-3：V31-50 的当前实现方向偏离“请求级失败”目标

当前实现同时：

- 包装 `client.options.onclose`；
- 在数据库模块 import 时安装全局 `process.on('uncaughtException')`；
- 对被分类为 PG capacity/transport 的 uncaught exception 记录后继续运行。

风险：

1. 进程级吞异常不是请求级错误边界；
2. `onclose` 测试只模拟“旧 callback 自己抛错”，没有证明真实 socket emitter 被接管；
3. 没有 child-process mutation 证明该请求 5xx、后续请求正常；
4. 全局 uncaught handler 可能掩盖同类但非预期的程序错误，并让进程在未知状态继续。

修复应回到 ticket 原目标：驱动层/连接层的正式错误 hook + route error boundary，错误 promise 归属于请求；全局 handler 至多作为最后的崩溃记录与有序退出，不作为正常恢复机制。

---

## 7. 可直接交给 Agent 的修复波次

### Wave 0：冻结与恢复可信基线

1. 暂停继续向 `main` 直接合入；
2. 开启 branch protection，先要求 `Core quality / required`；
3. 从 `cffc41f6` 建单一 repair branch；
4. 为当前失败建立 immutable evidence bundle；
5. 所有任务只在同一基线重放，禁止用不同 worktree/不同 SHA 拼绿证。

### Wave 1：P0 构建与产品红线

并行 lane：

- **Lane A（contracts/video）**：P0-1 + P0-2；
- **Lane B（security/CI）**：P0-7 + P0-8；
- **Lane C（prompt/authority）**：P0-5；
- **Lane D（execution-spine，必须串行）**：P0-3 → P0-4 → P0-6；
- **Lane E（governance）**：branch protection + ticket provenance。

Wave 1 退出：typecheck/build/root/core-persistence/security 全绿；不跑 browser 也不得提前合并。

### Wave 2：产品旅程与语义收口

1. 裁决并移除第六 durable stage；
2. 完成 A–K browser matrix；
3. Memory source/revocation；
4. Artifact/Steering/Campaign/Video partial；
5. 修复 SSR PG error boundary；
6. 清 V31-30、43、44、46、48、49 等平台/测试收尾。

Wave 2 退出：普通 required 九 job 同 SHA 全绿，A–K 每项有真实 API seam 证据。

### Wave 3：Release / Pilot / Retirement

1. 创建 immutable candidate HarnessRelease；
2. 运行 release-manifest + RC e2e；
3. allowlist canary，同 SHA 记录 releaseId/prompt/skill/tool/schema/model policy；
4. 人工 rollback 演练；
5. 真实商家试点与旧流程对照；
6. 满足 U14 后再做 26b/legacy retirement。

---

## 8. Agent 任务执行模板

每张修复票必须包含：

```yaml
objective: 一句话业务不变量
current_failure: 当前 HEAD 的可复现失败
canonical_owner: 哪个领域是唯一 writer/authority
scope:
  files: []
  migrations: []
  APIs: []
preconditions: []
implementation_steps: []
required_tests:
  red: []
  green: []
  mutation: []
  replay: []
exit_criteria: []
forbidden_shortcuts: []
evidence:
  commit_sha: null
  workflow_run_id: null
  artifact_digest: null
```

Agent 不得用以下方式关票：

- 改测试期望接受未裁决行为；
- 新增 `as any` / `as unknown as` 掩盖合同；
- 把 fail-closed 改成 fallback；
- 用 fixture 直接注入最终 UI 状态；
- 只跑局部单测，不跑所属 required owner；
- 把安全 high 加永久 waiver；
- 把 ticket `Status` 改成 done 但不记录当前 SHA 的 CI 证据；
- 通过全局 `uncaughtException` 吞错代替请求/连接级处理；
- 重新引入字幕/封面或把分镜放回 Plan。

---

## 9. 推荐的最终 Definition of Done

V3.1 只能在以下全部成立时标记完成：

1. `main` 开启保护，所有变更经 PR；
2. 普通 `Core quality / required` 九 job 在同一 SHA 全绿；
3. `pnpm audit --prod` 无未豁免 high/critical；
4. Core typecheck/build/unit/persistence 全绿；
5. root unit/journey/interaction/check/build/bundle 全绿；
6. opt-in evidence ledger 与当前 SHA 一致，零 stale；
7. A–K 旅程逐项真实接缝通过；
8. release-manifest / candidate e2e / rollback 演练同一 SHA；
9. Plan/snapshot fidelity、duplicate debit、accepted side effect、pending interrupt loss 均为 0；
10. prompt/skill/recipe/source/catalog 全部来自 exact authority；
11. 视频 canonical contract 不含字幕/封面依赖；
12. 真实商家 pilot 不劣于旧流程；
13. ticket index 中每张 done 票都有 commit SHA、workflow run、artifact digest；
14. legacy retirement 只在 U14 条件门满足后执行。

---

## 10. 建议的管理结论

- **可以继续投入修复**：架构资产已达到值得收口的程度，不建议重写；
- **不应继续扩功能**：当前优先级应从“再加 Agent 能力”切到“合同闭合、计费/恢复、exact release、真实旅程证据”；
- **不应按票面 done 率汇报进度**：建议同时报告代码完成度、合同完成度、同 SHA 验证完成度；
- **不应在红 main 上做 pilot**：先恢复 required green，再做 allowlist candidate；
- **下一次 Review 的基准**：只接受受保护 PR 合入后的单一 SHA，不再接受跨分支、local、未 push、旧 evidence 拼接。

---

## 附录 A：本 Review 使用的关键仓库证据

- `main@cffc41f6f387e7d8cb50b8d5df84b607efd37ea2`
- Actions run `31451672600`
- `root-required-quality-evidence` digest `sha256:c445f3b1031093eec6716524843fd8b585de8e1ed6e5825992fa0ec05e6ab636`
- `core-persistence-evidence` digest `sha256:e9356018ded171a1fca95c8790810d677468314e82380479e148988df0544fc7`
- `recorded-redline-evals` digest `sha256:4e3637a199eebd999033e33a66e22a28c040f284a7a58027e8c0cd011c5ff1ef`
- `production-dependency-audit` digest `sha256:4a5511bcdff01ab01c097355d24f7d02544c9173037d92e3bceefc6df0e0c7ce`
- 票据索引：`docs/tickets/v3.1/README.md`
- 当前仓库自带历史 Review：`docs/reviews/meiyeagent-v3.1-deep-review-2026-08-11.md`（仅作旧 SHA 基线，不替代本 Review）
