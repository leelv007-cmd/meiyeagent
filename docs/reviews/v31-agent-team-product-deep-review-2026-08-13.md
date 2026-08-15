# V3.1 Agent Team 产品深度 Review（可执行修复总报告）

- **Date**: 2026-08-13
- **HEAD**: `0a6934089a160a0f0cc3ffc084d42466d47140e2`（tip 是文档归档；产品码等价祖先 `d97c9b09`）
- **Authority**:
  - `docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md`（产品/旅程/§39/§43）
  - `docs/ops/capability-ledger-2026-08-13.md`（唯一工作队列权威）
  - `PRODUCT.md` + `docs/ops/current-project-status.md`（CURRENT 仍钉 `39ca4b39`，**落后于本 HEAD**）
- **Method**: 五路只读 agent team（无 Orca）。未在本 SHA 新开浏览器。祖先 SHA 活体只作降级背书，不得拼接成 HEAD 可用。
- **Lane reports**（证据正文，本文件是派工入口）:
  - A 产品完整性 `docs/reviews/agent-team-lane-product-completeness-2026-08-13.md`
  - B 前后端连通 `docs/reviews/agent-team-lane-fe-be-connectivity-2026-08-13.md`
  - C UI/UX `docs/reviews/agent-team-lane-uiux-2026-08-13.md`
  - D 客户旅程 `docs/reviews/agent-team-lane-journeys-2026-08-13.md`
  - E 账本重评 `docs/reviews/agent-team-lane-capability-ledger-2026-08-13.md`
- **Supersedes as execution entry**: `docs/reviews/meiyeagent-v3.1-current-implementation-deep-review-2026-08-11.md`（已标 HISTORICAL）
- **Docs rewrite**: EXEC-00a 已回写账本 §1 与 CURRENT（Integration SHA=`0a693408`，verification≠release，D1–D7 生效）。

## 已拍板决策（本轮逐项过，未列入者不生效）

| # | 题目 | 决定 | 落点 | 日期 |
|---|---|---|---|---|
| D1 | 纯 copy 的「确认并开始」事实卡算不算违约 | **A：纯 copy 零确认卡**。`policy_exempt_copy` 从发送到第一条 token，0 张确认卡（执行卡＋事实卡都禁）。缺事实用 assumption「价格我先不写」，禁止把未确认价格写进成品。图文/视频照旧过执行确认。B（改嘴留卡）否决。 | EXEC-01 仍修写死的执行卡；EXEC-02 按 A 实施，不再等裁。规格/账本/C3 继续写「免确认直达」，e2e 删「出现就点」分支。 | 2026-08-13 |
| D2 | C1 字面是「第一条成品」还是「首访不撞死路」 | **A：改 C1 字面，成品归 C2**。C1＝零素材首访不撞死路、不被劝退、不扣分；图文给诚实引导。可发布成品并进 C2（自由文案 / 换无槽写法）。Day-0 门维持引导卡断言，不假装交付。B（补无种子成品腿撑旧字面）否决。C（引导卡内联挂源）不作为 C1 定义，以后可当体验优化。 | 账本 §1 回写时改 C1 文案；C2 验收加「新号不传图也能拿到通用文案」（依赖 D1=A）。禁止用 day-0 1/1 宣称 C1 可用。 | 2026-08-13 |
| D3 | CURRENT §3a 冻结令对 P0 死路松不松 | **A：诚实性 / 死路 P0 解冻，功能仍冻。** 可派：EXEC-00a/00b/00c、V31-50、82 仪器；EXEC-01/02/06/08/03a；EXEC-04/05。仍冻：EXEC-03b、07b、L0/L3、Goal、字幕、生产 canary、内联挂源当新功能。解冻条件＝全门可评价（非单 spec 绿）+ V31-76 清 + 同 SHA required CI。D2=A 后 Day-0 门不必等图文成品。B（一字不改只做原文 5 项）否决。C（P0 含 03b/07b 全开）否决。 | 本文件 Freeze class 以本条为准，supersede 派工时对 §3a「新功能」的过宽理解；§3a 解冻条件本身不废。 | 2026-08-13 |
| D4 | 文档 Workstream 大拆（EXEC-07b）是不是现在的体验门牙 | **B：07b 升为体验门牙，解冻后第一波做；冻结窗口内不做。** 仍先 07a（可派）+ D5 定流。解冻后 07b 优先于一般功能（L0/L3/Goal/字幕），不插队抢当前诚实性波，也不在门未可评价时拆 ComposerHome。A（07b 无限后置）否决。C（现在就做）否决。 | EXEC-07a 现在派；07b 标 `unfreeze-first-wave`。无 D5 禁止开工 07b。 | 2026-08-13 |
| D5 | Workbench 和对话事件听哪一条 | **B：冻结期 flag 关则 Host 不订 semantic；四态从 workflow/session 派生。07b 开工前必须打开 `agent_semantic_event_adapter_v1`（届时执行 A：开 adapter + 空 replay 降级）。** C（永远不订、07b 改吃 workflow）否决。现在就开 adapter（纯 A）否决。 | EXEC-09 按 B 现在可派（诚实性）。07b 准入加一条：adapter 开且 reconnect 保 interrupt。禁止第三套 EventSource。 | 2026-08-13 |
| D6 | 故意留红的 `v31-82` spec 还放不放进必跑门 | **A：先移出门或标 `not_evaluated`，仪器能造 `running+0 job` 后再请回来。** 成功跑完不得绿。B（留门里当诚实红、解冻排除 82）否决。C（删 e2e 只留 unit）否决。V31-82 产品码 keep，不关票。 | EXEC-00b：改 `run-v31-browser-acceptance.sh` 门清单；仪器落地前 82 不得当产品红。全门可评价不再被 KNOWN RED 卡死。 | 2026-08-13 |
| D7 | 付费旅程还准不准 `seedComposerInlineAuthorize` | **A：必跑付费旅程禁 seed，改走库选。** V31-77 静态契约扩到门内会过提交门的 C/D/F/G/K/C16 等 spec；先走上传/授权/挑选（或 V31-88 夹具），再断言确认/交付。fixture 模型仍可用。B（只钉 C4/C7）否决。C（维持 seed 合法）否决。 | 扩 `e2e-day0-seed-discipline.test.ts`（或并列付费门契约）。C7 撤权走真实 UI，禁止 `productCommand` 短路。门红视为真红，不回滚 seed。 | 2026-08-13 |

七条已齐。回写账本/CURRENT 时一并带上 D1–D7，不另开产品功能。

---

## 0. 给修复 agent 的读法

1. 先读 §1 总判和 §4 票包。不要从 89 张 V31 票重新发现。
2. 每张票的 **Freeze class** 遵守 **D3=A**：全门可评价 + V31-76 清 + 同 SHA required CI 之前，只许诚实性/死路/仪器（见已拍板 D3 白名单）。`frozen-new-feature`（含 EXEC-03b）禁止派。EXEC-07b 为 `unfreeze-first-wave`（D4=B），解冻后第一波，且 **D5=B：先做 EXEC-09（关旗不订），开 adapter 是 07b 准入不是现在的活**。
3. `available` = 商家路径 + 接线 + **本 SHA 走查/门绿**。代码在、票面 `implementation-complete`、祖先活体，一律最多 `degraded`。
4. 不要改 fixture 藏脏数据；**D7=A：门内付费旅程禁止 `seedComposerInlineAuthorize`**，改走库选；不要把超时退款写成「图文做成了」。
5. 冲突以本文件 §3 裁决为准，lane 报告作证据。

---

## 1. 总判

**接线完成度高，商家产品未完成，不能按 V3.1 放行。**

商家前台已有 Composer + Workbench Host + Living Plan + 报价 chip + 经验页 + 结果中心 + 发布交接。档案/素材/挂源/零素材引导在祖先 SHA 活体走过。Admin（C15）是唯一可维持「可用」的能力。

但规划里的产品不是「能提交的生成器」，而是 Thread-root 文档工作流：说一句 → 理解 → 分级做 → 同一 Artifact 长出 → 中途能改 → 交付后续聊 → 次日自报进 Memory。这条链在本 HEAD 被四条硬缝切开：

| # | 硬缝 | 商家看见 | 规划违约 |
|---|---|---|---|
| 1 | **确认门叠床架屋** | 纯文案也要先过确认卡 | §3 L1 / §37.4-B / §43 门 5 |
| 2 | **Steering 键空间 + 英文裸错** | 做一半改封面 → `No admitted execution plan exists for task composer-task:…` | §5.6 / §37.4-G / §43 门 6 |
| 3 | **Work-root Composer 绑架 Thread** | 交付后再打字就新开 session | §2.3 / §37.4-I / §43 门 18 |
| 4 | **主轴仍是聊天+卡片墙** | 不是文档 Workstream；右栏是 inspector 不是 Artifact；内部指令进标题 | §0 / §2.1 / §4.2 / §39 |

另外两条把「做成」和「学到」卡住：

- 付费图文：确认后钱先走；做成靠 fixture；悬死有 15min 超时退款（V31-82），商家等不及会以为丢钱。C4 最多 **degraded**，不是可用。
- 次日自报：面板和 chips 在，生产 hook 用内存 `publishedAtRef` 当门；刷新/隔日 **never-called**。学习闭环没有燃料，Proactive 永远关。

仪器现实：V31-77 把门升到 fail-fast 首位，但全门从未在 HEAD 跑完（8 绿 / 5 红 / 28 未评，workerd 死）。`v31-82` spec **故意留红**，必跑门按设计绿不了。CURRENT 仍写 Integration SHA `39ca4b39`，与本树脱节。

**完成度（Review 估算，非票数）**

| 口径 | 估 | 含义 |
|---|---:|---|
| 代码/结构资产 | 80–85% | 对象、Harness、路由、spec 大多存在 |
| 规划行为合同 | 45–55% | 主路径可辨认；确认/Thread/Workstream/自报未兑现 |
| 同 SHA 验证 | 25–40% | 无 HEAD 全门绿；无 HEAD 活体 |
| 商家可卖主链 | **约 40%** | 只有 fixture 纯 copy + Day-0 不撞 400 + Admin |

四态（本 HEAD，采纳 Lane E，并用 A/B/C/D 校正）：**可用 1（C15）／降级 12／不可用 1（C8）／未走查 3（C12 次日腿、C17、C1 成品腿）**。

---

## 2. C1–C17 重评（以本 HEAD 为准）

账本 §0/§6 跟上了深夜合入；§1 表仍把 77/78/82 当 open 根因。下面替换派工时对 §1 的理解（**不要在修产品时顺手改账本**，回写另批）。

| C# | 账本 §1 | 本 HEAD | 商家一句话 | 现差 |
|---|---|---|---|---|
| C1 | 修复中 | **degraded**（D2=A：按「不撞死路」评，不是成品） | 零素材图文不再 400、不扣分；引导在 | V31-76；禁止用门绿宣称可用 |
| C2 | 降级 | **degraded**（D2=A：承接「第一条成品」） | fixture 自由文案能交付；live 未走；事实卡待 EXEC-02 | required CI；新号不传图出通用文案 |
| C3 | 降级＋确认卡违约 | **degraded** | 账对，但免确认对店主不成立 | EXEC-01 + EXEC-02 |
| C4 | 不可用（82） | **degraded** | 能提交/能超时退款；不能宣称「做成了」 | EXEC-10；82 仪器 |
| C5 | 降级 | **degraded** | 零素材诚实引导；带素材未走 | 走查优先 |
| C6 | 降级（含过期的 82 无出口） | **degraded** | 健康链账对；旁路/空表/派生 revision 仍开 | 41/45/59 |
| C7 | 降级 | **degraded** | 上传授权挂源通；撤权未走 | 走查 |
| C8 | 不可用 | **unavailable** | 中途改要求死路 | EXEC-03 |
| C9 | 悬死不可用 | **degraded** | 悬死有终态；健康 interrupt 未走 | 82 仪器；V31-57 |
| C10 | 降级 | **degraded** | 换号泄漏已修；交付后续聊会断 Thread | EXEC-04 |
| C11 | 降级 | **degraded** | 空态诚实；注入/撤销/memoryId | V31-18 AC4 |
| C12 | 未走查 | **unwalked**（入口在、次日断） | 当日能补记；次日不会被追问 | EXEC-05 |
| C13 | 降级 | **degraded** | 无 Goal CRUD（正确）；无对话提议 | 冻结后 |
| C14 | 降级 | **degraded** | 台在；冻结期勿动生产 canary | — |
| C15 | 可用 | **available** | Admin 可治理 | V31-71/44 |
| C16 | 降级 | **degraded** | 工作区能编；标题可能是内部指令 | EXEC-06 |
| C17 | 未走查 | **unwalked** | 被 C4/C5 挡 | 后置 |

---

## 3. 跨 lane 冲突裁决

| 冲突 | 裁决 | 所以修什么 |
|---|---|---|
| C3「确认卡」是 execution confirm 还是 D-043 事实卡？ | **两张都在（事实）。D1 已裁 A：两张对纯 copy 都禁。** 浏览器 `composer-home.tsx:1807` 写死 `existingGate: true`；e2e 又点「确认并开始」。 | EXEC-01 去客户端执行卡；EXEC-02 去纯 copy 事实卡，改 assumption，不改规格嘴 |
| C4 不可用 vs 降级 | **降级。** 82 超时退款在祖先活体；做成未在 HEAD 证明。 | 不要重开 82 产品根；开仪器 + 「做成」核销 |
| C8 冻不冻 | **D3=A：03a 可派，03b 仍冻。** 中文错误映射＝诚实性。键对齐是做成，解冻前禁止瞎猜 admission。 | EXEC-03 分两刀；03b 等全门可评价 |
| V31-80 源在 fixture 还是产品？ | **产品 brief 含指令。** `make-snapshot-consume.ts:213-229` 把 `不得偏离 ExecutionPlanSnapshot` 和 `snapshotHash=` 写进 instructions；fixture echo 放大可见性。修来源字段，不要 scrub fixture。 | EXEC-06 |
| C1 门绿＝能力绿？ | **否（事实）。D2 已裁 A：改字面，不补图文成品腿。** 门 spec 断言 0 次 submissions＝「不撞死路」，不是交付。 | 账本 C1 改为引导/不扣分；成品验收挪到 C2 |
| 主轴：ComposerHome vs AgentWorkstream | 生产 DOM 是 `ChatConversation` + 卡片墙；`NarrativeLine` 只吃默认关的 semantic 流。**D4=B：07b 解冻后第一波，先 D5。** | 现在只派 07a；07b 不换肤、换主轴 |

**D1 已裁 A（2026-08-13）**：纯 copy + `policy_exempt_copy` 路径 0 张确认卡；事实缺口改 assumption chip「价格我先不写」。B 否决。

---

## 4. 可执行票包（修复 agent 只领这些）

每张票：一个目标、一组文件、可测 DoD、一条命令、Freeze、依赖。不要再拆「调研票」。

### Wave 0 — 仪器 / 权威文档（全部 freeze-allowed）

#### EXEC-00a — 回写权威文档

- Goal: 账本 §1 与 CURRENT 对齐 HEAD，避免派工打已修根。
- Files: `docs/ops/capability-ledger-2026-08-13.md`；`docs/ops/current-project-status.md`
- DoD: CURRENT Integration SHA=`0a693408` 并写明 verification≠release；账本 §1 采用本文 §2 表；V31-50 从 parked 升仪器。
- Test: 无。主控文档。
- Freeze: freeze-allowed
- Do not: 不要把 C1/C4 写成可用。

#### EXEC-00b — 全门可评价（workerd / 82 spec / V31-50）

- Goal: 人为杀 workerd 不得把 28 条写成产品红；**D6=A：82 spec 先移出门 / `not_evaluated`**；仪器能造 `running+0 job` 后再请回；SSR socket `'error'` 不杀进程。
- Files: `scripts/ci/run-v31-browser-acceptance.sh`；`mkfast-template-main/tests/e2e/specs/v31-82-stalled-image-work-timeout.spec.ts`；`mkfast-template-main/src/db/postgres-connection-safety.ts`；V31-50 / V31-64 / V31-70 / V31-79
- DoD: 断 workerd → 剩余=`not_evaluated` 或复活后续跑；门清单在仪器前不含 82 产品红；仪器后无停滞不得绿、有停滞须退款解锁。
- Test: 门脚本故障探针；V31-50 child-process。
- Freeze: freeze-allowed
- Do not: 不要用 `alreadyTerminal` 喂绿 82；不要关 V31-82 产品票。

#### EXEC-00d — D7 付费旅程去 seed

- Goal: 门内会过提交门的付费 spec 禁止 `seedComposerInlineAuthorize`，改走授权库选（或 V31-88 夹具）。
- Files: `mkfast-template-main/src/lib/e2e-day0-seed-discipline.test.ts`；`run-v31-browser-acceptance.sh` 清单上的 living-plan / video / rights / steering / publish / artifact 等 spec
- DoD: 静态契约红则门红；C7 点真实撤权按钮；不回滚 seed 喂绿
- Freeze: freeze-allowed（D7=A，门诚实性）
- Do not: 为了保绿把 seed 加回 Day-0 例外之外的门内 spec

#### EXEC-00c — V31-76 remix / continue-item

- Goal: `uiux-creation-loop` 与 `dashboard-home-mount` 整档绿（§3a 明文）。
- Files: `example-store-preview.tsx`；`creation-entry-model.ts`；composer draft restore；两 spec
- DoD: 二次 remix 覆盖草稿；continue-item 要么真渲染要么改契约。先判产品 vs spec。
- Test: `pnpm --filter @meiye/web e2e -- tests/e2e/specs/uiux-creation-loop.spec.ts`
- Freeze: freeze-allowed
- Existing: V31-76

### Wave 1 — 商家死路 / 诚实性（freeze-allowed）

#### EXEC-01 — P0 纯 copy 禁止客户端执行确认卡

- Lanes: B-001, C-009, D-001
- Goal: `lensId==='copy'` 且 quote 无付费媒体 unit 时，发送不经过 `ExecutionConfirmCard`。
- Why: `composer-home.tsx:1806-1811` 写死 `existingGate: true`，`shouldOpenExecutionConfirm` 恒 true。Core 已 `policy_exempt_copy` + `makeReady:true`、无 `executionConfirmationRequestId`。属 200-but-wrong。
- Files:
  - `mkfast-template-main/src/product/composer/composer-home.tsx:1798-1818`
  - `mkfast-template-main/src/product/composer/execution-confirm-card.ts`
  - 已有 Core：`progressive-level.ts` / `submission-coordinator.ts`（不要改成走 decide）
- DoD:
  1. copy send 后 `execution-confirm` 与 `execution-confirmation-interaction-card` count=0
  2. 仍冻结 snapshot `approvalBasis=policy_exempt_copy`
  3. 1 分账、replay 不双扣保持
- Test: `v31-level1-copy-journey.spec.ts`；扩 `execution-cost-feedback` interaction
- Freeze: freeze-allowed（诚实性 / 门 5）
- Do not: 积分阈值免确认；把 L1 改成真 `confirmation-decide`

#### EXEC-02 — P0 纯 copy 禁止「确认并开始」事实卡

- Lanes: A-001, D-001, E-010
- Goal: `policy_exempt_copy` 从填完 intent 到第一条 token，商家 0 次「确认并开始」/「确认本次创作」。
- Why: e2e `settleLevel1Submission` / `settleFreeSubmission` 主动点事实门再宣称免确认。盘点真人看到确认卡。
- Files:
  - `apps/core/src/p1/harness/fact-satisfaction.ts`
  - `mkfast-template-main/tests/e2e/specs/v31-level1-copy-journey.spec.ts`
  - `mkfast-template-main/tests/e2e/fixtures/ui-journey.ts`
  - `apps/core/src/p1/agent-session/composer-plan-session.ts`（`approvalBasisForSubmission`）
- DoD: 上述按钮 count=0；缺价格事实 → inline assumption「价格我先不写」，禁止 suspend 确认卡；不得把未确认价格写进成品。
- Test: 同 Level-1 spec，删除 fact_gate 点击分支。
- Freeze: freeze-allowed（D1=A 已裁，可派）
- Do not: 只改 spec 放过卡；付费图文也免确认；缺价时编造价格

#### EXEC-03 — P0 Steering：先中文护栏，再键对齐

- Lanes: A-002, B-002, C-steering, D-002, E-005；票 V31-81 / V31-27
- Goal:
  - **03a** 无 admitted snapshot / 空 progress：HTTP 成形 `not_ready` + 中文「现在还不能改这一页，等做出第一页再调」，UI 不渲染 `error.message` / `composer-task:`
  - **03b** `resolveAuthority` 用与 composer 提交链同一键（查清 `taskId` vs `workflow_id` vs admitted snapshot），running 图文单改封面/第 2 页生效、其余页不动
- Evidence: `apps/core/src/assembly/core-assembly.ts:857-863` `getByWorkflowId(taskId)`；`steering-composer-panel.tsx:88-94` 原样 `caught.message`
- Files: 上两处；`apps/core/src/p1/agent-session/steering-service.ts`；`mkfast-template-main/src/p1/client.ts`（`readP1Envelope`）
- DoD: `v31-mid-run-steering-journey` 走到 submit 且无英文裸错；负向无 snapshot 时无 `admitted`/`task` 可见文本。
- Test: Core unit + web interaction + e2e G
- Freeze: 03a freeze-allowed（D3=A 白名单）；03b frozen-new-feature（做成，解冻前不派）
- Do not: 浏览器分类 steering；fixture 短路伪装 admitted

#### EXEC-04 — P0 Delivered 后保持同一 Thread

- Lanes: A-003, B-006, D-I
- Goal: 交付后打字不 `newComposerSessionId`；`rebind` 可清 task，必须保留 `agentThreadId`；刷新后再提交 body 仍带同一 thread。
- Evidence: `composer-home.tsx:2713-2730` delivered 重绑；`activeAgentThreadId` 回落内存 `agentBinding`（`:875`）
- Files: `composer-home.tsx`；`composer-session.ts`；`use-composer-run.ts`；`v31-thread-root-workbench.spec.ts`
- DoD: 交付 → 输入 → 刷新 → 第二条 submission `threadId` 等于第一条；recent 一条 Thread 两张 Work。
- Test: 改写 I 旅程，禁止只用 `create_thread` API 深链冒充。
- Freeze: freeze-allowed（§43 门 18 诚实性）
- Do not: 每次交付 `create_thread`；把 recent 改回 Work 列表

#### EXEC-05 — P0 次日自报可回访

- Lanes: A-004, B-005, D-009
- Goal: 去掉 `publishedAtRef` 门。Delivered / 结果页 mount 用 `workId+packageId` 调 `self_report_ask`。发布记录次日，打开工作台或该 Work，出现一句追问 + 六 chips，点写入 `merchant_reported`。
- Evidence: `use-publish-handoff.ts:57-150,187-231`；合同当日返回 `not_yet_next_day`
- Files: 上 hook；`idle-goal-proactive.tsx`；`outcome-chips-panel.tsx`；`apps/core/src/p1/operations/foundation-module.ts`
- DoD: 已发布 work 刷新后芯片仍在；seed 昨天的 published → 登录可见 → 点「有人问」落库。同一 Work 只问一次。
- Test: 新/改 `v31-publish-handoff-selfreport.spec.ts`；禁止只 `evaluate` 拨钟冒充 UI 回访。
- Freeze: freeze-allowed（闭环燃料；不做新追问产品）
- Do not: 可配置多次；浏览器算「次日」

#### EXEC-06 — P0 V31-80 展示泄漏护栏

- Lanes: A-内部指令, B 旁证, C-001/002/006/007, D-006, E-006；票 V31-80
- Goal: 商家可见标题/结果行/右栏不得出现 `ExecutionPlanSnapshot`、`不得偏离`、`snapshotHash=`、裸 `work-<uuid>`。「约消耗」与「用量已确认」互斥。方案卡在 confirmed/executing/delivered/failed 只读。
- Evidence: `make-snapshot-consume.ts:213-229`；`workbench-inspector-work-id`；`projectCommitStrip` 不读终态
- Files:
  - `apps/core/src/p1/harness/make-snapshot-consume.ts`
  - `composer-delivery-card.tsx` / `composer-session.ts`（`deliveryStatement`）
  - `workbench-shell-layout.tsx`
  - `commit-strip-model.ts`
  - `composer-home.tsx` usageSlot
- DoD: fixture copy 单交付文案/标题不含内部词；全页无可见 `/work-[0-9a-f-]{8}/`；delivered 后无「开始制作」可点；两个 quote testid 不可同时 visible。
- Test: 静态扫描 + `v31-level1-copy-journey` / artifact 旅程断言
- Freeze: freeze-allowed
- Do not: 改 fixture 藏指令；渲染层 substring scrub 而不改 brief 源

### Wave 2 — 工作台合同（多数 freeze-allowed 诚实性；大拆分可后置）

#### EXEC-07 — P1 单轴文档 Workstream（行为，不换肤）

- Lanes: C-003/004/005
- Goal 分两刀：
  - **07a** Idle 可见序＝问候 → 分段器 → **单一 Composer** → 建议芯片 → Shelf。分段器与输入之间不可见档案大卡 / 模型面板 / Campaign 勾选 / Goal 卡。
  - **07b** 生产主轴只渲染 `AgentWorkstream` 文档行；`ChatConversation` 退出生产 DOM；Active 右 38% 是 `ArtifactCanvas` 不是 inspector。
- Files: `composer-home.tsx`；`composer-conversation.tsx`；`agent-workstream.tsx`；`dashboard-home-contract.test.ts`（门升级，不是删）；`workbench-shell-layout.tsx`
- DoD: Playwright 节点序；Idle 主列 0 张业务大卡（问候/分段器/Composer/芯片除外）；1440 宽右栏是 artifact。
- Freeze: 07a freeze-allowed（D3=A）。07b＝`unfreeze-first-wave`（D4=B；准入＝D5 的 adapter 已开 + EXEC-09 降级在）
- Do not: 气泡改左对齐当修复；为过门 `hidden` 仍占焦点；空 Idle 拉到 1240

#### EXEC-08 — P1 商家错误词典

- Lanes: B-004, C-steering 护栏
- Goal: `readP1Envelope` / interrupt / Living Plan toast 走同一 `code→中文` 表；白名单外永不渲染上游 `message`。
- Files: `mkfast-template-main/src/p1/client.ts`；`typed-interrupt-client.ts`；`agent-workbench.tsx`；`use-living-plan-controller.ts`
- DoD: 10 个常见 code 单测无英文、无 `composer-task:`
- Freeze: freeze-allowed
- Do not: Zod `parsed.error.message` 当商家文案

#### EXEC-09 — P1 双流权威二选一

- Lanes: B-003
- Goal: **D5=B**。flag 关：Host 不订 `/agent-threads/.../events`，四态从 workflow/session 派生。flag 开才订 semantic。07b 开工前另开 adapter（空 replay + active workflow 须降级，不得装成 Idle）。
- Files: `semantic-event-projector.ts:42-79`；`api-runtime.ts:2163`；`agent-event-transport.ts`；`composer-home.tsx:3832-3852`
- DoD: flag 关不发起 semantic EventSource，已绑定 thread 不得画成冷启动；07b 前补：flag 开 reconnect 保 pending interrupt
- Freeze: 本期 B＝freeze-allowed。打开 adapter＝07b 准入，不在冻结窗口做
- Do not: 第三套 EventSource；flag 关仍订空 replay

### Wave 3 — 钱与做成（部分仍冻）

#### EXEC-10 — P1 C4 做成核销（超时≠做成）

- Lanes: A-008, D-003, E-C4
- Goal: HEAD 同 SHA 走出检索 → ≤1 问 → Living Plan → 确认 → 逐页 Artifact → Delivered。失败才走 82 终态。商家 Waiting 要有倒计时/取消，不等默默 15min。
- Files: Living Plan controller；generation job 创建；`v31-living-plan-journey.spec.ts`；V31-56 复跑
- DoD: C 旅程有判决；悬死夹具下可见钱出口；禁止 alreadyTerminal 假绿
- Freeze: 复跑/核销 freeze-allowed；新做 job 创建猜修需证据
- Do not: 把 82 退款写成 C4 可用

#### EXEC-11 — P1 钱债三件套

- Existing: V31-41 residual；V31-45 derived_revision 必须报价；V31-59 settlement identity
- DoD: 无 quote 不得 completed；缺 `sourceTaskId` 不得落到错误 usage 键；credits 空表有兜底句
- Freeze: freeze-allowed（§38 硬门①③）
- Do not: 新套餐/新加油包 SKU

### Wave 4 — 走查优先，未证先不修

只记账，冻结期不派功能：

| ID | 能力 | 动作 |
|---|---|---|
| WALK-C5 | C5 | 带素材视频活体；无字幕/封面承诺 |
| WALK-C7 | C7 | 撤权点真实 UI，不 `productCommand` 短路 |
| WALK-C9 | C9 | 健康 interrupt；V31-57 时钟 |
| WALK-C11 | C11 | 注入/撤销；藏 memoryId |
| WALK-C17 | C17 | 等 C4 能造 partial |
| EXEC-L0 | L0 | 已交付「删最后一句」走 revise，零 Session LLM（`frozen-new-feature`） |
| EXEC-L3 | L3 | 对话提议 Goal，隐藏 campaign toggle（`frozen-new-feature`） |
| EXEC-IA | IA | jobs/sessions/search 301；workspace/identity 并入 store（可跟 07a） |

---

## 5. 前后端连通摘要（Lane B）

主链注册→档案→素材→报价→提交在路由上是真接线。商家感知被政策打架、双流、错误面压住。

必须修的断点：

1. UI 不读 `makeReady` / `executionConfirmationRequestId`，用本地 `existingGate:true` 代替 Core 政策。
2. Steering `getByWorkflowId(taskId)` 与 composer-task 键不对。
3. Semantic adapter 默认关，Workbench 仍订空 replay。
4. 自报 ask 被内存 ref 挡死。
5. Thread 续写靠未持久化 binding。

孤儿（后置，勿当 P0）：`/dashboard/jobs|sessions|search|workspace|identity`；`assistant-stream` BFF 无 product 调用；`create_thread` / `confirm_goal_proposal` / confirmation-list 无商家面。`/dashboard/catalog` 与 `/dashboard/assets` **不要删**。

---

## 6. UI/UX vs 规划摘要（Lane C）

外壳合同一半钉住：问候 h1、分段器、800/1240 数字、62/38 默认、一级导航五词、Tiptap 不进 Composer。

体验合同 Fail：

- 主轴=`ComposerHome`（~5000 行）里的 `ChatConversation` + 右对齐瓷块 + AgentFrame 卡，不是文档时间线。
- 首屏静态门只扫五个标记顺序，运行时在 Composer 前插入档案/模型/Goal/Campaign。
- 右栏是「上下文」inspector，Artifact 竖叠在左列；双栏门槛整窗 ≥1240，14" 常锁单列。
- 手机点「进入对象工作区」仍上 Tiptap，违反 §4.3。
- 六态无投影；Waiting 缺「不做会怎样」。
- 退回文案至少两套（「失败将退回积分」vs「失败自动退回」）。

不要开「工作台视觉升级」票。顺序：EXEC-06 → EXEC-01/02 → EXEC-07a → 再谈 07b/右栏。

---

## 7. 客户旅程漏斗（Lane D）

```
注册（78 砖号已修，缺故障 e2e）
  → 首页：文案可试 / 图文引导不扣分 / 视频只去传素材
  → 建档+授权+库选（84/86/88 代码通）
  → L1 copy：账对，确认卡违约          ← 掉点 1
  → L2 图文：确认后钱走、进度可停很久   ← 掉点 2
  → 中途改：英文裸错                    ← 掉点 3
  → 视频/撤权/stale/interrupt/partial：spec 在、多种子、HEAD 未走
  → 交付交接在；次日追问只在测试拨钟时出现
```

Day-0 不再是「点发送就 400」。商家现在死在确认卡、steering、付费等待。C1 零素材图文要离开 Composer 去建档传图——§2.2 成功形态对零素材店不成立（权利门，不是回归）。**D2=A**：这不算 C1 缺口；第一条可发布成品按 C2 验收。

`seedComposerInlineAuthorize` 仍在 living-plan / video / publish / artifact / steering 等必跑旅程里。**D7=A：门内这些旅程禁 seed，改走库选**；门绿不得再等于「测试替商家把图挂上了」。

---

## 8. §43 发布绝对门（本 HEAD）

| # | 门 | 状态 |
|---|---|---|
| 1 | Plan ≡ snapshot | 未 HEAD 走查 |
| 2 | LLM 不绕事实/权利/费用 | 主路径在；V31-45 潜伏臂 |
| 3 | pending interrupt 重连不丢 | adapter 默认关，未证 |
| 4 | 幂等 / 不双扣 | L1 fixture 有；付费全链未证 |
| 5 | Day-0 可达且简单任务不变复杂 | Day-0 不撞 400；简单任务仍多确认卡 → **红** |
| 6 | steering 不静默改费用/事实/其它页 | **不可达**（先 404） |
| 7 | partial 不写 canonical | 未证 |
| 8 | exact release | 台在，未生产演练 |
| 11 | live/fixture/recorded 严格区分 | 走查曾被假 Core 污染；79 未完全收口 |
| 13 | 不显示原始 CoT/内部指令 | **红**（brief 含 ExecutionPlanSnapshot；进度卡 slot 名 CoT） |
| 14 | a11y / 移动 / reduced motion | 部分；手机全编辑器违约 |
| 18 | Thread 跨 Work；Memory 可撤；推荐可解释 | Thread 交付后断；Memory 未走；推荐无证据燃料 |

硬门 5 条里至少 **⑤⑥** 以及展示 **⑬** 未过。不全量上线。

---

## 9. 修复 agent 开工清单（复制即用）

派工时把下面整段贴给 agent，只改 `EXEC-xx`。

```text
Repo: /Users/bin/Desktop/开发/内容无人区/美业内容2
HEAD baseline: 0a6934089a160a0f0cc3ffc084d42466d47140e2
You are implementing ONLY ticket EXEC-xx from
docs/reviews/v31-agent-team-product-deep-review-2026-08-13.md
Lane evidence: docs/reviews/agent-team-lane-*-2026-08-13.md
Rules:
- Surgical. English code/commits. No drive-by.
- Do not edit the capability ledger or CURRENT unless you are EXEC-00a.
- Do not add seedComposerInlineAuthorize. Do not hide leaks by editing fixtures.
- Respect Freeze class. If frozen-new-feature and Day-0 full gate is not green, stop.
- Prove DoD with the listed test command. If you cannot run e2e, say so and leave the test written.
- Conventional commit: fix(v31): <ticket-id> <imperative>
```

建议第一波（可并行，耦合低）：

| Agent | Ticket | 预估耦合 |
|---|---|---|
| 1 | EXEC-01 | 低（UI 决策点） |
| 2 | EXEC-06 | 中（brief + 展示） |
| 3 | EXEC-03a | 低（错误面） |
| 4 | EXEC-04 | 中（session） |
| 5 | EXEC-00c / V31-76 | 中（draft） |
| 6 | EXEC-08 | 低（词典） |

EXEC-02 已按 D1=A 可派。EXEC-03b 等 03a + 键空间结论。EXEC-05 可与 04 并行但测交付后 phase。EXEC-00b 单独仪器 lane。

明确不要派：字幕/封面、Goal CRUD、生产 canary、重开 84/86/88 根因、用 `39ca4b39` 绿证拼接 HEAD、Ponytail 式大删 ComposerHome。

---

## 10. 未证明（禁止写成事实）

1. 本 SHA 无新活体。82/84/86/88/89 活体在祖先树。
2. live/direct 模型链零证据。C2–C5「做成」最多 fixture。
3. remix 红 1 是产品还是 `sampleStores[2]` 过期假设，未跑浏览器。
4. `HARNESS_DBOS_SYSTEM_DATABASE_URL` 未配时 dev 档媒体是否仍走不完。
5. 全门真实颜色未知。已知 day-0 绿、84/86/87/88 在 `d97c9b09` 轮绿、82 故意红、28 未评。
6. V31-83 服务端跨号读 4xx、票面 AC 未勾。
7. token 是否落库（§0.5-13）未审计。
8. 生产是否已打开 `agent_semantic_event_adapter_v1`：代码默认关。

---

## 11. 一页结论

骨架已经是 V3.1。店主买到的还不是 V3.1。

先让纯文案真的一击直达、内部词从成品上消失、中途改要求不再喷英文、交付后还是同一段对话、次日会被问一句结果。同时把必跑门修到能跑完。这些做完之前，不要宣称 C1/C3/C4/C8/C10/C12 可用，也不要开下一轮功能票。
