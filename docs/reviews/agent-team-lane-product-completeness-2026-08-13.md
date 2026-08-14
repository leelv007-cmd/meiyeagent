# Lane A — Product Completeness
- HEAD: `0a6934089a160a0f0cc3ffc084d42466d47140e2`
- Date: 2026-08-13
- Scope: planned product functions vs current merchant-reachable implementation

## 1. Verdict

当前 HEAD 不是「未开工的骨架」，也不是「商家能按 V3.1 合同走完的产品」。它是一套**接线完成度很高、商家可达性被几条硬缝切开**的半成品：ComposerHome 仍是 `/dashboard` 唯一宿主，AgentWorkbenchHost / Living Plan / 报价 chip / 经验页 / 结果中心 / 发布交接都已嵌进同一张工作台，但主创作轴仍是 Work-root 的 Composer 会话，Thread-root 只是套在时间线外的投影层。

真正能当产品卖的只有三条窄路：① 已确认档案后的 **fixture 档纯 copy**（报价、预扣、交付卡、结果中心入口都在）；② **Day-0 档案/素材/挂源**（V31-84/86/87/88/89 在祖先 SHA 活体走过，HEAD 未复走）；③ **Admin / 经验空态 / Release 台渲染**。付费图文、视频、steering、次日自报、Goal 主动建议、L0 轻改、L3 Campaign 都还不能称为商家产品。

分级器 `classifyProgressiveLevel` 存在且单测绿，但商家确认门的权威不是它，而是 `approvalBasisForSubmission(lens)`：只有 `lens === 'copy'` 才 `policy_exempt_copy`。Level 1 旅程自己承认还会弹出「确认并开始」事实门。交付后一打字就 `rebindComposerSession`，直接违反 §2.3「Delivered ≠ Thread 完成」。Steering 生产查 plan 用 `getByWorkflowId(taskId)`，composer-task 对不上 admitted snapshot，V31-81 仍 open。次日自报合同有、面板有，但生产 hook 只在「我已发布」当次会话里问一次，次日回访没有独立追问面。

账本里大量 `implementation-complete` / `evidence-debt` 票不能写成可用。本评按账本四态：`available` 必须有商家路径 + 接线 + 走查/旅程证据；其余一律 `degraded` / `unavailable` / `unwalked`。本评未开浏览器，不发明 HEAD 活体绿证；祖先 SHA 走查只作降级背书。

## 2. Completeness matrix

| ID | Planned function | Plan § | Ledger C# | Verdict | Evidence | Gap |
|---|---|---|---|---|---|---|
| C1 | 零素材首访拿到第一条成品，不撞死路 | §37.4-A | C1 | degraded | 引导卡接线：`v31-zero-source-image-text-first-visit.spec.ts:54-69`；门升格 V31-77 / `docs/reviews/v31-77-gate-verdicts-2026-08-13.md:119-137`（祖先 SHA `d97c9b09` day-0 1 passed）。档案/挂源祖先活体：ledger `capability-ledger-2026-08-13.md:28-41`。 | 零素材图文仍停在 slot 引导，不是第一条成品；remix 红 V31-76 open；HEAD 无 day-0 复走。 |
| C2 | 免费自由创作：模糊输入→通用文案→发布交接 | §37.4-A | C2 | degraded | Spec `v31-day0-free-creation-journey.spec.ts:1-25`；提交仍可能先过 Brief「确认并开始」`:46-71`。 | 仅 fixture 档；事实门仍出现；live 生成未走。 |
| C3 | L1 纯 copy 免确认直达；报价常显；余额不足双出口 | §3 L1 / §37.4-B | C3 | degraded | 免确认权威=`approvalBasisForSubmission` `composer-plan-session.ts:1228-1232`；e2e `v31-level1-copy-journey.spec.ts:267-377` 断言无 execution-confirm / 无 `/start`，但 `settleLevel1Submission:243-258` 接受「确认并开始」。报价 `composer-home.tsx:4676-4690`。双出口 `workbench-credit-purchase-actions.tsx:11-28`。盘点：`capability-baseline-audit-2026-08-13.md:30` 出了确认卡 + 内部指令。 | 事实确认卡=免确认违约；V31-80 泄漏仍 open；文案与 `billing-ux.ts:58-59` 双套。 |
| C4 | 定制图文：检索→只问一题→Living Plan→确认→逐页生成→交付 | §3 L2 / §37.4-C | C4 | degraded | 提交 `makeReady:false`：`v31-living-plan-journey.spec.ts:29-37`；commit strip `use-living-plan-controller.ts:38-79`。V31-82 超时退款票面 `V31-82-image-work-stalls-running-credits-hang.md:7-37`（活体在 `97f534d0`）。 | 全链未在 HEAD 走通；V31-56 revise 卡死仍 debt；C8 同路径死；fixture 档生成≠ live。 |
| C5 | 视频付费：时长/积分透明、中断恢复、部分失败不吞钱 | §37.4-D | C5 | degraded | Spec `v31-video-paid-execution-journey.spec.ts:18-40`；零素材假出口已改诚实引导 V31-85 `implementation-complete`。分镜不进 Plan 已废止 V31-35。 | 带素材视频线未走查；字幕/封面残链 V31-61 debt；部分失败只靠 fixture 锚。 |
| C6 | 计费可信：报价=扣分、失败退回、不重复扣、账面对得上 | §3 R5 / §43①③ | C6 | degraded | L1 e2e 冻结 quote + replay 不双扣 `v31-level1-copy-journey.spec.ts:402-445`；V31-82 悬死退款票面已证。`projectSessionBillingUx` `billing-ux.ts:90-151`。 | 付费图文成功结算未在 HEAD 走；退回文案双套；V31-45 潜伏不计费臂；credits 空表兜底未复走。 |
| C7 | 素材授权与撤权：撤权 fail closed、可换、不重复扣 | §37.4-F | C7 | degraded | 上传/授权/挂源祖先活体 V31-84/87/88；撤权 spec `v31-rights-revocation-journey.spec.ts:15-25`。 | 撤权链本身未走查；R2 时被档案链挡住 `capability-baseline-audit-r2-2026-08-13.md:30`。 |
| C8 | 中途改要求：改两页其余不动；加页 replan+requote | §5.6 / §37.4-G | C8 | unavailable | 面板 `steering-composer-panel.tsx:59-135`；生产查 plan `core-assembly.ts:856-864` 按 `taskId` 当 workflowId。错误原文进商家 alert：V31-81 `V31-81-steering-no-admitted-plan-for-composer-task.md:17-21`。catch 直出 `Error.message` `steering-composer-panel.tsx:88-94`。 | V31-81 未开工；Wave-4 已证伪 V31-27 AC1。 |
| C9 | 中断/恢复：关页不丢、过期退分、重复恢复幂等 | §37.4-H / §43③④ | C9 | degraded | Interrupt spec `v31-interrupt-resume-journey.spec.ts:14-78`；悬死有界终态 V31-82。 | 健康 interrupt 路径未走查；V31-57 时钟仪器债；R2：悬死锁 composer `capability-baseline-audit-r2-2026-08-13.md:32`。 |
| C10 | Thread 连续：交付后同一会话新 Work，刷新不丢 | §2.3 / §5.1 / §37.4-I | C10 | degraded | Host 接线 `composer-home.tsx:3829-3851`；recent=`ThreadListPage` `thread-list-page.tsx:1-6`；e2e 用 `create_thread` API `v31-thread-root-workbench.spec.ts:101-141`。交付后打字重绑 `composer-home.tsx:2713-2730`。 | Delivered 后继续=新 Composer session，不是同一 Thread 新 Work；旅程未用真实创作产出 Thread。 |
| C11 | 记忆注入透明：清单、来源、撤销后不再注入 | §12 / §37.4-B2 | C11 | degraded | 面板 `memory-injection-receipt.tsx:35-70`；host 挂载 `agent-workbench.tsx:351-356`；经验页 `memory-vault-page.tsx:1-31`；双通道 Core `agent-memory-platform.ts:690-736`。B2 spec `v31-memory-injection-b2-journey.spec.ts:18-34`。 | 会话转正无商家 chip；风格约束未接线 `V31-18-memory-platform.md:27-35`；AC4 删源债；R2 注入/撤销未走到。 |
| C12 | 发布交接与次日自报落 OutcomeEvidence | §6 / §37.4-K | C12 | degraded | 交接面板 `publish-handoff-panel.tsx:281-357`；hook `use-publish-handoff.ts:67-150,187-230` 只在 `phase==='delivered'` 且「我已发布」后查 ask。结果中心另有表单 `outcome-chips-panel.tsx:57-149`。合同 `publish-handoff.ts:395-448`。 | 无次日回访追问面；交付后重绑丢失 delivered；K 旅程未真人走；V31-19 AC 空表。 |
| C13 | 目标与 evidence 门控主动建议 | §11 / §25 / §37.4 | C13 | degraded | Idle 面板 `idle-goal-proactive.tsx:1-6,78-97`；无 Goal CRUD：`v31-goal-proactive-idle.spec.ts:274-277` `/dashboard/goals` 非 200。门默认关 U13。 | 对话提议创建/归组无商家路径；evidence 门控建议未用真实自报走到。 |
| C14 | 运营 Release/canary/rollback（商家无感） | §29–30 / §37.4-J | C14 | degraded | Admin 台 spec `v31-ops-console-release-journey.spec.ts:38-60`；R2 渲染在位 `capability-baseline-audit-r2-2026-08-13.md:36`。 | 未执行生产控制动作；商家路径本应不可见——符合，但 J 旅程未 live。 |
| C15 | Admin 后台治理 | admin 波 | C15 | available | R2 `/admin` 14 区走查 `capability-baseline-audit-r2-2026-08-13.md:37`；票 V31-65/68 done。 | HEAD 未复走；余 V31-71 CI-only、V31-44 open。 |
| C16 | Artifact 原位生长，stable ID，无重复对象 | §5.5 / §27.5 | C16 | degraded | Spec `v31-artifact-growth-journey.spec.ts:1-32`；V31-62 done。工作区 `result-center-page.tsx:1-7` + `object-workspace/`。 | fixture 标题=内部指令 V31-80；live 原位生长未走。 |
| C17 | 部分交付后续跑，assisted 不重扣 | §24 / V31-16 | C17 | unwalked | Spec `v31-partial-resume-assisted-journey.spec.ts:1-67` 存在。 | 无走查、无票面绿证、被 C4/C5 挡住。 |
| L0 | 确定性轻修改：无 Plan、无确认、无 Session LLM | §3 L0 / §7.4 | — | unavailable | 分类器 `progressive-level.ts:172-183`；turn-runner 短路 `turn-runner.ts:216-251` 产出 `finish_turn`。Composer 只编译 `propose_plan` `composer-plan-session.ts:1295-1306`。 | 商家「删最后一句」不会走 revise 原语；L0 决策进不了 Make。 |
| L1 | 纯 copy 免确认永久口径 + 冻结 snapshot | §3 L1 / U1/U9 | C3 | degraded | 见 C3。Kill switch 只收紧 `progressive-level.ts:245-265`。 | 确认门权威是 lens 不是分级器；事实门仍在。 |
| L2 | Living Plan → 可改 → 付费确认 → Make | §3 L2 / §5.3 | C4 | degraded | 见 C4。 | 调整/逐页/发布交接未在 HEAD 走通。 |
| L3 | Campaign/Goal：一 Plan 派生 N Work；每付费 Work 单独确认 | §3 L3 / U7 | C13 | degraded | 前台是 Composer 开关 `composer-home.tsx:793-798` + `campaign-paid-work-confirmation.spec.ts:39-59`，不是 Goal 拆周。 | 无「8 月持续推」对话建 Goal；toggle 是实现泄漏。 |
| T/R/G | AgentThread / AgentRun / MarketingGoal（Goal 不首切片 CRUD） | §0.3 / §9–11 | C10/C13 | degraded | 合同+PG 仓储在；Goal 无管理页（正确）。Thread 持久化 V31-02 implementation-done / evidence-debt。 | Goal 只有 Idle 投影+command，无对话提议确认；Thread 被 Composer session 重绑架空。 |
| WB | Workbench Thread-root；Delivered ≠ Thread 完成 | §2.3 / §5.1 | C10 | degraded | Host 嵌在 ComposerHome `dashboard/index.tsx:162-179` + `composer-home.tsx:3829`。 | 见 FIND-A-003。 |
| MEM | 双通道经验；注入可见；撤销 | §12.3 / §12.7 | C11 | degraded | 见 C11。 | 会话→跨 Thread 转正无 UI。 |
| OE | OutcomeEvidence + 次日自报 | §6.3 / §26 | C12 | degraded | 合同+结果中心 chips + workbench chips。 | 次日旅程断；双入口。 |
| PRO | evidence 门控 proactive | §25 | C13 | degraded | 见 C13。 | 门默认关；无真实 evidence 燃料。 |
| HR | HarnessRelease 商家不可见 | §0.3 / §29 | C14 | degraded | Admin 台在；商家无入口（正确）。 | J 未生产演练。 |
| RC | Result Center / Object Workspace | §0.2 / §4.1 | C16 | degraded | 路由 `results_/$workId.tsx:13-57`；对象工作区三件套在 `object-workspace/`。 | 与 Thread Delivered 面重复；内部指令进标题。 |
| CAR | copy \| note \| media 载体 | §0.2 / A9 | — | degraded | 合同三枚举在；商家 lens=`copy/image_text/video` `lens-labels.ts:7-11`。跨载体 V31-47 evidence-debt。 | 前台仍是 legacy 轴名；一单多载体商家不可达。 |
| BILL | 报价 chip 常显、失败退回双态、不透支、双出口 | §3 R5 / A5 | C6 | degraded | Chip `composer-home.tsx:4676-4690`；短少双出口 `workbench-credit-purchase-actions.tsx:11-28`。e2e 文案 `失败将退回积分\|失败不退回积分` `v31-level1-copy-journey.spec.ts:192`。Core 文案 `失败自动退回` `billing-ux.ts:58`。 | 双套文案；确认卡路径用量双行 V31-80#6。 |
| A | Day-0 自由创作 | §37.4-A | C1/C2 | degraded | 见 C1/C2。 | 引导≠成品；remix 红。 |
| B | L1 纯 copy | §37.4-B | C3 | degraded | 见 C3。 | 事实门。 |
| B2 | 记忆注入透明 | §37.4-B2 | C11 | degraded | Spec 在；fixture 风格断言已删 `v31-memory-injection-b2-journey.spec.ts:26-34`。 | HEAD 未走；风格不生效。 |
| C | 定制图文 | §37.4-C | C4 | unwalked | Spec 在；HEAD 无浏览器绿证。V31-77 门第一次真跑未评到该 spec（仪器死）。 | 不得用旧 SHA 拼接。 |
| D | 视频付费 | §37.4-D | C5 | unwalked | Spec 在；带素材线未走。 | 零素材线只证明诚实引导。 |
| E | Plan stale | §37.4-E | C6 | unwalked | Spec `v31-context-fence-journey.spec.ts:18-27`；门跑 interrupted `v31-77-gate-verdicts-2026-08-13.md:47,109-111`。 | 无绿证。 |
| F | 素材撤权 | §37.4-F | C7 | unwalked | Spec 在。 | 上传链修了≠撤权走过。 |
| G | Mid-run Steering | §37.4-G | C8 | unavailable | 见 C8。 | 英文裸错死路。 |
| H | Interrupt resume | §37.4-H | C9 | unwalked | Spec 在。 | 无 HEAD 走查。 |
| I | Thread 连续 | §37.4-I | C10 | degraded | Spec 用 API 建 Thread，不经交付后继续。 | 见 FIND-A-003。 |
| J | Harness Release | §37.4-J | C14 | unwalked | Spec 在；R2 只渲染。 | 未 canary/rollback 真动作。 |
| K | 自报旅程 | §37.4-K | C12 | unwalked | Spec 用 clock/query 推次日 `v31-publish-handoff-selfreport.spec.ts:341-405`；生产 hook 无次日回访。 | 测试推进时钟≠商家次日被追问。 |
| §0.5-1 | 不让 LLM 当状态机/DB 权威 | §0.5 | — | available | 写路径仍 Task/DBOS/ledger；AgentKernel 无 durable checkpoint（计划 §7.3）。 | 无违规实现。 |
| §0.5-2 | 模型不选 Provider、不改费用、不绕权利 | §0.5 | — | degraded | 确认/报价/权利仍确定性服务。V31-45 潜伏不计费臂 `V31-45-derived-revision-billing-bypass.md:17-49`（生产 HTTP 今日走不到）。 | 潜伏债，未在产出血。 |
| §0.5-3 | 不引入第二套 durable runtime | §0.5 | — | available | 无 LangGraph/Mastra workflow 生产依赖；产品代码检索无 `@langchain` / mastra runtime。 | 文档史仍提 Mastra，未进商家路径。 |
| §0.5-4 | 不建 Plan Grammar / 商家 DAG | §0.5 | — | available | plan-as-data；无 grammar 解释器。 | — |
| §0.5-5 | 不暴露原始 CoT，不持久化 | §0.5 | — | degraded | 进度卡用 HeroUI `ChainOfThought` `composer-progress-card.tsx:14-21,44-63`，展示的是白话 stage，不是模型 CoT。 | 组件名/slot=`chain-of-thought` 是 IA 泄漏；未证明未落库 raw CoT。 |
| §0.5-6 | 不生成任意 HTML/CSS/JS/React | §0.5 | — | available | Controlled Surface Registry 方向在；无商家任意组件。 | — |
| §0.5-7 | 无无限多 Agent 协商；Specialist 无独立人格 Memory | §0.5 | — | available | 未见多人格 Memory 表。 | — |
| §0.5-8 | 不把稳定 SSE 全量迁 WebSocket | §0.5 | — | available | 仍 SSE/semantic live。 | — |
| §0.5-9 | 不建完整视频 NLE / CRM / 预约收银 | §0.5 | — | available | 无 NLE/CRM 商家面。 | — |
| §0.5-10 | 确认后不静默重算不同方案 | §0.5 | — | degraded | 持久臂短路防漂移 `V31-18-memory-platform.md:54-61`。 | C4 悬死后超时终态是另一条路；确认后 fidelity 未 HEAD 走查。 |
| §0.5-11 | 商家不可装 Skill；无任意 shell/SQL | §0.5 | — | available | 无商家 Skill 商店。 | — |
| §0.5-12 | Agent 不改价格事实、不判权利、不无确认发布 | §0.5 | — | available | 发布=商家自发 MobilePublishHandoff。 | — |
| §0.5-13 | 不逐 token 落库 | §0.5 | — | unwalked | 合同禁止；本评未审计 PG writer。 | 需 Core lane 证 ephemeral 不落库。 |
| §0.5-14 | 简单改字不生成 Living Plan | §0.5 | — | unavailable | L0 未接通商家路径（FIND-A-005）。短句在 copy lens 会当 L1 整单生成。 | 违反「每次简单改字不生成 Living Plan」。 |
| §0.5-15 | 不建 Goal CRUD | §0.1/§11 | C13 | available | `/dashboard/goals` 非 200 `v31-goal-proactive-idle.spec.ts:274-277`。 | 正确未做。 |

## 3. Findings

### FIND-A-001 — Severity: P0
- Title: Level 1「免确认直达」被事实门「确认并开始」拆成两次确认
- Plan anchor: §3 Level 1；§37.4-B；§43 门 5；附录 A13
- Capability: C3 / B
- Evidence: `v31-level1-copy-journey.spec.ts:236-258` 把 D-043「确认并开始」写成「不是执行确认，出现就点」；`v31-day0-free-creation-journey.spec.ts:46-71` 同样接受 Brief 确认。盘点真人：`capability-baseline-audit-2026-08-13.md:30`「出了确认卡=免确认直达违约」。生产确认豁免只看 lens：`composer-plan-session.ts:1228-1232`。
- Merchant impact: 写一条朋友圈仍要先过「确认本次创作」，简单任务因升级变复杂。
- Repro (code-level): 已确认门店 + 文案 lens + Level-1 intent → 发送 → 若 intent 触发 fact-satisfaction，先出「确认并开始」，再 `POST /composer/submissions` 且 `makeReady:true`。
- Root cause: 执行确认与事实确认两套门叠在商家同一颗按钮语义上；旅程测试把违约合法化。
- Fix contract (acceptance, testable): 纯 copy + `approvalBasis=policy_exempt_copy` 的发送路径，从填完 intent 到第一条 token，商家 0 次「确认并开始」/「确认并制作」。事实缺口用 inline assumption chip，不得用确认卡。e2e 删除 `settleLevel1Submission` 的 fact_gate 分支，断言该按钮 count=0。
- Files a fix agent should open first: `apps/core/src/p1/harness/fact-satisfaction.ts`；`mkfast-template-main/tests/e2e/specs/v31-level1-copy-journey.spec.ts`；`mkfast-template-main/tests/e2e/fixtures/ui-journey.ts:453-474`；`apps/core/src/p1/agent-session/composer-plan-session.ts:1228`
- Tests to add/update: `v31-level1-copy-journey.spec.ts` 无条件 `getByRole('button', { name: '确认并开始' }).toHaveCount(0)`；Core 单测：copy lens + 缺价格事实不得 suspend。
- Out of scope / Do not: 不要把付费图文也免确认；不要只改 spec 放过确认卡。
- Depends on: 无

### FIND-A-002 — Severity: P0
- Title: 运行中 steering 对 composer-task 查不到 admitted plan，英文裸错直出
- Plan anchor: §5.6；§24；§37.4-G；§43 门 6
- Capability: C8 / G
- Evidence: `apps/core/src/assembly/core-assembly.ts:856-864` `getByWorkflowId(taskId)`，找不到即 `No admitted execution plan exists for task ${taskId}`。票 `docs/tickets/v3.1/V31-81-steering-no-admitted-plan-for-composer-task.md:17-21` 盘点复现。前端 `steering-composer-panel.tsx:88-94` 把 `caught.message` 写进 `steering-error`。
- Merchant impact: 图文做一半说「封面别写价格」→ 技术英文 + 内部 task id；中途纠偏死路。
- Repro (code-level): 付费图文 running → `steering-composer-input` 提交 → `agent-session.steering_submit` → 404 英文。
- Root cause: steering 权威键是 admitted snapshot 的 workflowId；composer 提交链的 task 键空间未对齐。失败呈现未翻译。
- Fix contract (acceptance, testable): 同一 composer 图文单 running 时，改封面/第 2 页指令返回中文影响范围，其余页保持；找不到 plan 时中文「现在还不能改这一单」无 task id。e2e `v31-mid-run-steering-journey.spec.ts` 走到被测步且绿。
- Files a fix agent should open first: `apps/core/src/assembly/core-assembly.ts:852-908`；`apps/core/src/p1/agent-session/steering-service.ts`；`mkfast-template-main/src/product/composer/steering-composer-panel.tsx`；`docs/tickets/v3.1/V31-81-steering-no-admitted-plan-for-composer-task.md`
- Tests to add/update: Core：composer-task id 能 resolve admitted plan；web interaction：错误无 ASCII 技术句；e2e G。
- Out of scope / Do not: 不要先做 follow_up 双队列；不要用 fixture 短路伪装 admitted。
- Depends on: C4 必须有 admitted snapshot（V31-82 只保证超时，不保证 admission 键）

### FIND-A-003 — Severity: P0
- Title: Delivered 后继续输入会新开 Composer session，Thread 不断、会话断
- Plan anchor: §2.3；§5.1；§37.4-I；§43 门 18
- Capability: C10 / I
- Evidence: `composer-home.tsx:2713-2730`：`session.phase === 'delivered'` 且不在 revise/clarification 时，`newComposerSessionId()` + `rebindComposerSession`。同文件 `:4978-4987` 推荐 handoff 同样重绑。Thread e2e 只 `create_thread` 深链 `v31-thread-root-workbench.spec.ts:109-141`，不测交付后第二条 Work。
- Merchant impact: 做完一条再聊，左侧像新开一单；「继续同一 Thread」承诺落空；自报/handoff 随 delivered phase 一起丢。
- Repro (code-level): 任意交付 → 在 intent 框改一个字 → session id 变、phase 离开 delivered。
- Root cause: Composer 仍以 Work/session 为根；Thread-root 只包了一层 Host。
- Fix contract (acceptance, testable): Delivered 后同一 `threadId` 下再提交，产生新 `workId`/`runId`，URL `threadId` 不变，recent 仍一条 Thread 两张 Work。禁止因打字重绑 session。e2e I 必须走真实交付而不是 `create_thread`。
- Files a fix agent should open first: `mkfast-template-main/src/product/composer/composer-home.tsx:2713`；`rebindComposerSession` 定义处；`v31-thread-root-workbench.spec.ts`
- Tests to add/update: 交付后输入不改 `data-thread-id`；第二条 submission 的 `threadId` 等于第一条。
- Out of scope / Do not: 不要新建 `/intent` 页；不要把 recent 改回 Work 列表。
- Depends on: FIND-A-012（自报依赖 delivered 不丢）

### FIND-A-004 — Severity: P0
- Title: 次日自报没有商家回访入口，K 旅程只在测试里拨钟
- Plan anchor: §6.3；§26.1；§37.4-K；R11
- Capability: C12 / K
- Evidence: 生产 hook `use-publish-handoff.ts:67-150` 仅 `phase==='delivered'` 准备交接；自报查询还要 `publishedAtRef.current`（`:120`）。「我已发布」后立刻 `self_report_ask`（`:216-227`），合同同日返回 `not_yet_next_day`（`publish-handoff.ts:448`）。没有 dashboard Idle / 次日通知 / 结果中心自动追问把 `kind:'ask'` 在次日推到商家眼前。e2e K 用 query 推次日 `v31-publish-handoff-selfreport.spec.ts:341-405`。结果中心另做表单 `outcome-chips-panel.tsx:57-149`，不是「昨天的笔记有人来问吗？」一键 chips。
- Merchant impact: 学习闭环没有燃料；Proactive 准入门永远关。
- Repro (code-level): 交付 → 当日点「确认已发布」→ chips 不出现（not_yet_next_day）→ 第二天从 recent 进来已被 FIND-A-003 重绑 → hook 因 phase≠delivered 不再问。
- Root cause: 自报被塞进当次 Delivered hook，没有「次日一次」的独立 surface。
- Fix contract (acceptance, testable): 发布记录次日，商家打开工作台 Idle 或该 Work 结果页，自动出现一句追问 + 六个 chips；同一 Work 只问一次；点 chip 写 `merchant_reported` OutcomeEvidence。不依赖测试拨钟才能看见。
- Files a fix agent should open first: `use-publish-handoff.ts`；`idle-goal-proactive.tsx`；`publish-handoff.ts`；结果中心 `outcome-chips-panel.tsx`
- Tests to add/update: 浏览器：seed 昨天的 published 记录 → 登录 → chips 可见 → 点「有人问」→ ledger 一行。禁止只 assert query API。
- Out of scope / Do not: 不要做可配置多次追问；不要自动 verified 平台数。
- Depends on: FIND-A-003；V31-19 writer 合同勾选

### FIND-A-005 — Severity: P1
- Title: Level 0 只存在于 Session turn-runner，商家改字仍走整单生成
- Plan anchor: §3 L0；§7.4；§0.5「每次简单改字不生成 Living Plan」
- Capability: L0
- Evidence: `turn-runner.ts:216-251` L0 返回 `finish_turn`、`llmCallCount:0`。Composer 只把 `propose_plan` 当可编译 `composer-plan-session.ts:1295-1306`。无「对已交付文案删最后一句」的商家 revise 入口。
- Merchant impact: 「删除最后一句」要么当新的 L1/L2 再扣一次，要么卡在 clarification。
- Repro (code-level): 已交付 copy → 输入「删除最后一句」→ 走 submissions/compile，不走 revise 原语。
- Root cause: 分级器与 Composer 编译入口未接；L0 没有对象工作区选区/整篇确定性修订命令。
- Fix contract (acceptance, testable): 对已交付 copy 包，匹配 L0 的短指令不调 Session LLM、不新开 Living Plan、不二次确认；产出 derived revision。trace `llmCallCount=0`。
- Files a fix agent should open first: `apps/core/src/p1/agent-session/turn-runner.ts:216`；`composer-plan-session.ts:1295`；对象工作区 selection-ai
- Tests to add/update: Core：L0 `finish_turn` 必须触发 revise 原语而非 clarification；e2e：交付后「删除最后一句」无确认卡、积分按 derived 规则。
- Out of scope / Do not: 不要用正则把长经营目标误判 L0（现有 `LEVEL0_PATTERNS` 已过宽，修时收紧）。
- Depends on: FIND-A-003（必须还在同一 Thread/包上改）

### FIND-A-006 — Severity: P1
- Title: Progressive Level 判定与确认门权威分裂：商家分级器是死的
- Plan anchor: §3；V31-08；U1/A13
- Capability: L0–L3 / C3
- Evidence: 分类器 `progressive-level.ts:161-239` 看 units/lens/carriers/文案。Composer 冻结确认只看 `lens === 'copy'` `composer-plan-session.ts:1228-1232`。`runIntentTurn` 虽传入 `authority.progressiveLevel`（`:861-867`），`makeReady` 仍用 freeze/lens（`:439-443`）。V31-08 AC1/AC4/AC5 证据表全空 `V31-08-progressive-levels-billing-ux.md:47-52`。
- Merchant impact: 「帮我持续推头皮护理」不会变成 Campaign；图文轴上的「写一条介绍」仍强制 Living Plan+确认。
- Repro (code-level): 对比 `classifyProgressiveLevel({merchantMessage:'帮我持续推…'})` → level 3，与 `approvalBasisForSubmission('copy')` → exempt，两套结果互不消费。
- Root cause: V31-08 分类器停在 Session harness；生产 Composer 仍是 lens 开关。
- Fix contract (acceptance, testable): 同一 submission 的 `progressiveLevel.level`、`confirmationExempt`、`approvalBasis` 三值一致且驱动 makeReady。L3 文案不得 `policy_exempt_copy` 整月免确认。
- Files a fix agent should open first: `composer-plan-session.ts:439-443,1228-1243`；`progressive-level.ts`；`turn-runner.ts:540-558`
- Tests to add/update: 补齐 V31-08 AC1；composer-plan-session：L3 文案 + copy lens ≠ 整月 exempt。
- Out of scope / Do not: 不要按积分阈值免确认。
- Depends on: FIND-A-001

### FIND-A-007 — Severity: P1
- Title: Level 3 Campaign 是 Composer 开关，不是 Goal 派生的多 Work 计划
- Plan anchor: §3 L3；§11；U7
- Capability: L3 / C13
- Evidence: UI `campaignEnabled` state `composer-home.tsx:793-798`；e2e 勾 `campaign-paid-work-toggle` `campaign-paid-work-confirmation.spec.ts:39-59`。无对话「8 月持续推」→ Goal 提议 → 确认。`/dashboard/goals` 故意不存在（正确）。
- Merchant impact: 商家看不到「一个目标拆成多次宣发」；看到的是实现开关。
- Repro (code-level): dashboard 无 Goal 提议卡；只有 recipe+toggle 才能打到 `POST /campaigns/paid-works`。
- Root cause: U7 生命周期先落地，Goal 产品面（V31-24）只有 Idle 投影。
- Fix contract (acceptance, testable): 商家说长期目标 → Agent 提议 Goal（非 CRUD 页）→ 确认后按周派生 Work；每个付费 Work 单独确认。Composer 上的 campaign toggle 对商家隐藏或降为调试。
- Files a fix agent should open first: `idle-goal-proactive.tsx`；`apps/core/src/p1/goal-proactive/`；`composer-home.tsx:793`
- Tests to add/update: 对话提议→确认→两个 paid Work 各一张确认卡；断言无 `/dashboard/goals`。
- Out of scope / Do not: 不要建 Goal 管理后台。
- Depends on: C12 自报燃料不是本票前置，但 Proactive 门是

### FIND-A-008 — Severity: P1
- Title: 付费图文主链在 HEAD 仍不可称为产品（超时兜底≠做成了）
- Plan anchor: §37.4-C；§5.3–5.5
- Capability: C4 / C / C16
- Evidence: Living Plan spec 要求 start + 方向题 `v31-living-plan-journey.spec.ts:17-37`。V31-82 收口是「90s/15min 无 job → failed + 退款」`V31-82-image-work-stalls-running-credits-hang.md:31-37`，不是逐页长出。V31-56 Living Plan revise/start 卡死仍 evidence-debt。V31-77 门第一次真跑未评 C 旅程。
- Merchant impact: 定制图文要么悬死后退钱，要么只在 fixture 里「做成」。
- Repro (code-level): 祖先 SHA 活体：确认→扣分→running 无 generation job。HEAD 应用超时后应 failed，仍无成品。
- Root cause: admission/job 创建链与 fixture 绿证分离；容错票修了钱，没修做成。
- Fix contract (acceptance, testable): fixture 与单一真相栈各走通：检索 Activity → ≤1 问 → Living Plan → 确认 → 逐页 Artifact → Delivered。HEAD 同 SHA 留浏览器证据。失败才走 V31-82 终态。
- Files a fix agent should open first: `composer-plan-session.ts`；`use-living-plan-controller.ts`；generation job 创建路径；`v31-living-plan-journey.spec.ts`
- Tests to add/update: C 旅程进 required 门且无 `seedComposerInlineAuthorize` 掩盖 slot（已有零素材门）。
- Out of scope / Do not: 不要把超时退款写成 C4 可用。
- Depends on: FIND-A-002 若要中途改

### FIND-A-009 — Severity: P1
- Title: 带素材视频付费执行未走通；零素材线只有诚实死胡同
- Plan anchor: §37.4-D；V31-35 废止；V31-37 A
- Capability: C5 / D
- Evidence: V31-85 改假出口为引导（票 implementation-complete）。带素材 D 旅程 spec 存在但 ledger/R2 写明未走 `capability-baseline-audit-r2-2026-08-13.md:29`。V31-36/37/61 仍 open/debt。
- Merchant impact: 视频不是可卖能力；商家最多被诚实告知缺素材。
- Repro (code-level): 零素材选视频 → 引导，无成片。带素材路径无 HEAD 证据。
- Root cause: 视频 Make/部分失败/恢复与 slot 配方仍分离。
- Fix contract (acceptance, testable): 已授权素材 + 视频 lens：Plan 显示时长与积分、确认、关页恢复、一笔扣费、交付面不出现字幕轨/封面面板。
- Files a fix agent should open first: `v31-video-paid-execution-journey.spec.ts`；video worksurface；V31-36 通路
- Tests to add/update: D 旅程真跑；断言无 subtitle/cover 承诺。
- Out of scope / Do not: 不要做 NLE；不要把分镜与积分挂钩。
- Depends on: C7 授权链

### FIND-A-010 — Severity: P1
- Title: 素材撤权旅程只有 spec，商家 fail-closed 未证明
- Plan anchor: §23.4；§37.4-F
- Capability: C7 / F
- Evidence: Spec `v31-rights-revocation-journey.spec.ts:15-25`。上传/挂源已修，撤权「余=撤权链本身未走查」ledger `:56`。
- Merchant impact: 撤权后是否仍生成、是否重复扣，商家无法信任。
- Repro (code-level): 无 HEAD 走查步骤可引。
- Root cause: C7 被档案链长期挡住，修完上传后未回头走撤权。
- Fix contract (acceptance, testable): Plan 形成后撤权 → admission fail closed 中文说明 → 换素材可继续 → ProductUsage 不二次扣。
- Files a fix agent should open first: `v31-rights-revocation-journey.spec.ts`；rights fence；composer 换素材
- Tests to add/update: F 旅程真跑 + ledger 断言。
- Out of scope / Do not: 不要只 assert 页面没有「重复扣费」字样（spec 已禁止这种假绿）。
- Depends on: 档案确认链保持绿

### FIND-A-011 — Severity: P1
- Title: 记忆双通道缺「Thread 结束一键转正」；注入可见但风格不生效
- Plan anchor: §12.3–12.7；§37.4-B2
- Capability: C11 / B2
- Evidence: Core `proposeSessionPromotion` `agent-memory-platform.ts:690-736` 无前端引用（仓内仅 platform + 单测）。经验页是待确认/已记住，不是会话转正 chip。风格约束「现在不接线」`V31-18-memory-platform.md:27-35`。B2 spec 已删除效果断言 `:26-34`。
- Merchant impact: 「以后都这样」要么没有，要么 receipt 说注入了但文案不变——信任破产。
- Repro (code-level): 确认两条偏好 → 跑 copy → 面板有清单；输出不受 `maxBodyChars` 约束。
- Root cause: 透明度做了，执行挂钩故意停在 `merchant_confirmed` 快照消费之前。
- Fix contract (acceptance, testable): 交付时出现「记住这次的说法？」；确认后下一单 receipt 含该条；撤销后下一单 receipt 不含。风格只做 advisory，不得 brick。
- Files a fix agent should open first: `memory-vault-page.tsx`；`memory-injection-receipt.tsx`；`make-snapshot-consume.ts`；`agent-memory-platform.ts:690`
- Tests to add/update: B2 保留撤销；另加「转正 chip」interaction；禁止再拿 fixture 正则冒充风格生效。
- Out of scope / Do not: 不要把风格做成 HarnessGateId。
- Depends on: 无

### FIND-A-012 — Severity: P1
- Title: 发布交接与结果中心自报是两套 UI，主燃料入口分裂
- Plan anchor: §6.2–6.3；§26.1 MAJOR-13
- Capability: C12
- Evidence: Workbench `self-report-journey` chips `publish-handoff-panel.tsx:322-348`。结果中心 `OutcomeChipsPanel` 带数量/时间/备注表单 `outcome-chips-panel.tsx:28-36,152-163`。V31-19 AC 表全空 `V31-19-outcome-evidence.md:46-50`。
- Merchant impact: 不知道该在哪报；表单摩擦违反「近零摩擦」。
- Repro (code-level): 打开结果中心 vs Delivered workstream，两套文案与字段。
- Root cause: P1-E1 旧结果补记与 V31-17 新自报并存。
- Fix contract (acceptance, testable): 商家只看到一套 chips（计划 §6.3 六信号）；结果中心复用同一组件；canonical writer 唯一。
- Files a fix agent should open first: `outcome-chips-panel.tsx`；`publish-handoff-panel.tsx`；V31-19 writer
- Tests to add/update: 同一 package 在两面提交幂等键碰撞只留一行。
- Out of scope / Do not: 不要删「我已发布」留痕。
- Depends on: FIND-A-004

### FIND-A-013 — Severity: P1
- Title: Idle 主动建议按设计关门，对话也不会提议 Goal
- Plan anchor: §11；§25；U13
- Capability: C13
- Evidence: 面板写明无管理页 `idle-goal-proactive.tsx:1-6`。e2e 用 admin 写 `proactive_opportunity_v1` + 未来时钟才出建议 `v31-goal-proactive-idle.spec.ts:208-237`。unset=关。无「把最近三次内容归到这个目标」确认卡。
- Merchant impact: Idle 正确空，但「只说一个经营目标，Agent 拆任务」完全不存在。
- Repro (code-level): 新商家 dashboard → `idle-goal-proactive` attached 但无建议；说「最近新客少」不会创建 Goal。
- Root cause: V31-24 只做了投影与 flag，没做 Thread 内提议。
- Fix contract (acceptance, testable): Thread 中长期目标语句 → 提议卡 → 确认才写 MarketingGoal。evidence 门 unset 时仍允许**对话内提议**（那不是打扰式 proactive）。
- Files a fix agent should open first: `apps/core/src/p1/goal-proactive/`；`idle-goal-proactive.tsx`；composer 提议卡
- Tests to add/update: 提议→确认→Idle 出现 primaryGoal；拒绝不写库。
- Out of scope / Do not: 不要从历史 Work 自动猜 Goal。
- Depends on: 无（可先做提议，不必等自报）

### FIND-A-014 — Severity: P1
- Title: 示例店 remix 第二次不覆盖草稿，Day-0 示例入口骗商家
- Plan anchor: §37.4-A；§43 门 5
- Capability: C1 / A
- Evidence: V31-76 open `V31-76-day0-spec-unblock-discovered-reds.md:21-28`：切行业后再点「复用这条结构」，草稿仍是第一家店。存储键 `meiye.creation-draft-intent.v1` `creation-entry-model.ts:46-74`。
- Merchant impact: 选了新店新行业，拿到旧草稿。
- Repro (code-level): 见票面 `:21-28`，两轮确定性。
- Root cause: remix 写入/覆盖链未按新 preview 覆盖 sessionStorage。
- Fix contract (acceptance, testable): 第二次 remix 后 intent 等于当前 preview 文案。`uiux-creation-loop.spec.ts` 整档绿。
- Files a fix agent should open first: `creation-entry-model.ts`；suggestion-capsules / example store remix handler；`V31-76-day0-spec-unblock-discovered-reds.md`
- Tests to add/update: 该 spec 红 1 + continue-item 红 2 定性后修对应侧。
- Out of scope / Do not: 不要 skip 断言。
- Depends on: 无

### FIND-A-015 — Severity: P1
- Title: 计费退回文案双套，确认卡路径用量双行
- Plan anchor: §3 R5；A5；D-061
- Capability: C6 / BILL
- Evidence: Core `失败自动退回` / `该模型失败不退回` `billing-ux.ts:58-59`。Commit strip 同文案 `commit-strip-model.ts:7,103`。L1 e2e 商家 chip 断言 `失败将退回积分|失败不退回积分` `v31-level1-copy-journey.spec.ts:192`。V31-80#6：确认卡「本次约消耗」与「本次用量已确认」同屏 `V31-80-composer-internal-text-leakage-second-wave.md:29-30`。
- Merchant impact: 同一失败规则两种说法；确认前后两行报价互相打架。
- Repro (code-level): 打开 copy 报价 chip vs Living Plan commit strip vs 确认卡。
- Root cause: Session billing-ux、paraglide chip、quoteUsage 三套投影。
- Fix contract (acceptance, testable): 全站失败退回只有一对句子（与 A5 原文对齐）；同一时刻只一行用量。
- Files a fix agent should open first: `billing-ux.ts`；`composer-home.tsx:4673-4711`；`V31-80-composer-internal-text-leakage-second-wave.md`
- Tests to add/update: 静态扫描两种退回文案不得并存；interaction：确认卡路径互斥。
- Out of scope / Do not: 不要动扣费数字。
- Depends on: 无

### FIND-A-016 — Severity: P1
- Title: 内部指令与裸 work id 直出商家时间线/标题
- Plan anchor: §2.1；§39；Anti-references「后台代码不进主界面」
- Capability: C3 / C16
- Evidence: V31-80 open `V31-80-composer-internal-text-leakage-second-wave.md:19-27`。盘点 `capability-baseline-audit-2026-08-13.md:60-65`。
- Merchant impact: 看到 ExecutionPlanSnapshot、work-uuid，产品不像给店主用的。
- Repro (code-level): fixture 档跑完 copy/图文，看时间线「结果」行与工作区标题。
- Root cause: 叙述/标题取了 brief/执行指令拼接。
- Fix contract (acceptance, testable): 时间线、标题、右栏无内部类型名/裸 id；方案卡在 executing/delivered 冻结按钮。
- Files a fix agent should open first: 票所列七项锚点；composer 结果行投影；inspector workId
- Tests to add/update: V31-75 旁静态扫描 + 多 Work 叙述唯一。
- Out of scope / Do not: 不要改生成模型；不要只修 fixture。
- Depends on: 无

### FIND-A-017 — Severity: P1
- Title: 健康 interrupt 恢复与 Plan stale 只有 spec，门跑还红/中断
- Plan anchor: §37.4-E/H；§43 门 3–4
- Capability: C9 / E / H
- Evidence: H spec `v31-interrupt-resume-journey.spec.ts:14-22`。E spec `v31-context-fence-journey.spec.ts:18-27`。门第一次真跑 E interrupted `v31-77-gate-verdicts-2026-08-13.md:47,109-111`。V31-57 时钟债。
- Merchant impact: 关页回来、价格变了要重确认——合同在，商家没走过。
- Repro (code-level): 无 HEAD 绿证。
- Root cause: 仪器 + fixture 时钟 + 确认卡接线未在同 SHA 收口。
- Fix contract (acceptance, testable): H：pending interrupt 刷新仍在，duplicate resume 幂等，hold 到期取消+退分+白话。E：确认前改价格 → diff → 旧确认拒 → 新确认才执行。
- Files a fix agent should open first: 两份 spec；`execution-confirmation-expiry-job.ts`；V31-57
- Tests to add/update: 进 required 门且同 SHA 绿。
- Out of scope / Do not: 不要用不同 SHA 拼接。
- Depends on: 门仪器 V31-64/70

### FIND-A-018 — Severity: P1
- Title: 部分交付续跑（C17）完全未走查
- Plan anchor: §24；V31-16 AC3
- Capability: C17
- Evidence: `v31-partial-resume-assisted-journey.spec.ts` 存在；ledger `:66` 未走查；V31-16 AC 未勾。
- Merchant impact: 5/6 页成功时商家不知道会不会整单重扣。
- Repro (code-level): 无。
- Root cause: 排在收敛末尾，被 C4/C5 挡。
- Fix contract (acceptance, testable): 故意失败 1 页 → 报告 + 只重跑失败页 + 不重扣成功页。
- Files a fix agent should open first: `v31-partial-resume-assisted-journey.spec.ts`；steering/partial settlement
- Tests to add/update: C17 真跑 + usage 分项。
- Out of scope / Do not: 不要重跑整单冒充续跑。
- Depends on: FIND-A-008

### FIND-A-019 — Severity: P2
- Title: 商家进度轨复用 ChainOfThought 组件，违反「不暴露 CoT」的信息架构
- Plan anchor: §0.5；§43 门 13
- Capability: §0.5-5
- Evidence: `composer-progress-card.tsx:14-21,44-63`；测试钉死 `data-slot="chain-of-thought"` `composer-conversation.interaction.test.tsx:624-628`。
- Merchant impact: 无障碍树/测试/CSS 都把它叫推理链；若上游塞进 reasoning，会直接长在进度卡。
- Repro (code-level): 任意 running 会话检查 progress card slot。
- Root cause: U03 视觉复用压过 §0.5 命名红线。
- Fix contract (acceptance, testable): 商家 DOM 不再出现 chain-of-thought slot/类名；内容仍只允许白话 stage。静态扫描禁止该 slot。
- Files a fix agent should open first: `composer-progress-card.tsx`；heroui-pro ChainOfThought 引用
- Tests to add/update: 改 interaction 断言为 `composer-progress-card` + stage lines。
- Out of scope / Do not: 不要展示模型 raw reasoning。
- Depends on: 无

### FIND-A-020 — Severity: P2
- Title: 商家创作轴仍是 copy / 图文 / 视频，不是 copy \| note \| media
- Plan anchor: §0.2；A9；D-171
- Capability: CAR
- Evidence: `lens-labels.ts:7-11`。内部才 `copy|note|media` `progressive-level.ts:17-18`。
- Merchant impact: 与对象工作区/合同词汇不一致；「图文」掩盖 note 页计划。
- Repro (code-level): dashboard 分段器文案。
- Root cause: D-171 兼容别名停在内部，未做商家词汇切换。
- Fix contract (acceptance, testable): 一级轴与合同三枚举对齐（或产品文案明确「图文=笔记页」且测试/文档只用一套词）。
- Files a fix agent should open first: `lens-labels.ts`；creation entry IA
- Tests to add/update: 分段器 i18n 快照。
- Out of scope / Do not: 不要破坏性改 kind 枚举。
- Depends on: 无

### FIND-A-021 — Severity: P2
- Title: MemoryInjectionReceipt 把 memoryId 渲染给商家
- Plan anchor: §2.1；§12.7（可见的是 statement/来源，不是内部 id）
- Capability: C11
- Evidence: `memory-injection-receipt.tsx:106-114` `memory-injection-receipt-memory-id` 展示 `memory_injection_receipt_source({ memoryId })`。
- Merchant impact: 又一次内部 id 泄漏。
- Repro (code-level): 任意有 receipt 的 task 打开 dashboard。
- Root cause: 调试字段进了生产面板。
- Fix contract (acceptance, testable): 面板只显示 statement + 人读来源 + 撤销；memoryId 仅 data 属性。
- Files a fix agent should open first: `memory-injection-receipt.tsx`
- Tests to add/update: interaction 断言无 `reuse-` / uuid 正文。
- Out of scope / Do not: 不要去掉撤销。
- Depends on: 无

### FIND-A-022 — Severity: P2
- Title: 工作台双叙述：AgentWorkstream + ComposerConversation 叠两套过程
- Plan anchor: §4.2；§28.3；§39 减卡
- Capability: WB
- Evidence: `composer-home.tsx:3829-3858` Host 的 `processSlot` 仍塞完整 `ComposerConversation`。Workstream 自己还有 narratives/Activity/Plan。
- Merchant impact: 同一句话双气泡（V31-80#5 多 Work 复发）。
- Repro (code-level): 提交后同时存在 `agent-workstream` 与 `composer-conversation` 过程行。
- Root cause: §28.3「ComposerHome 变薄宿主」未完成，Host 被塞回旧对流。
- Fix contract (acceptance, testable): 过程叙述只在 Workstream；Conversation 不再重复 stage/结果行。多 Work 叙述唯一。
- Files a fix agent should open first: `composer-home.tsx:3827`；`agent-workstream.tsx`；V31-80#5
- Tests to add/update: 多 Work 叙述去重 e2e。
- Out of scope / Do not: 不要一次重写 4000 行 ComposerHome。
- Depends on: FIND-A-016

### FIND-A-023 — Severity: P2
- Title: derived_revision 存在不计费直写臂（今日 HTTP 走不到，文案已承诺计费）
- Plan anchor: §5.6 计费口径；§0.5-2；D-061
- Capability: C6 / C8
- Evidence: `V31-45-derived-revision-billing-bypass.md:17-49`：`consumeDerivedRevision` 优先直写、无 quote；生产 `resolveAuthority` 不给 `derivedRevisionAuthority`，故走计费臂。但 `projectSteeringImpact` 恒 `rebilled===true`。
- Merchant impact: 今日少收风险低；一旦有人补上 authority，会绕过报价。
- Repro (code-level): 读 `steering-service.ts` 两消费者顺序（票内行号随树漂移，以符号为准）。
- Root cause: 双消费者优先级与商家 feeNote 不一致。
- Fix contract (acceptance, testable): 删除或默认关闭不计费直写；任何 derived_revision 必须 quote+reserve。单测锁死。
- Files a fix agent should open first: `steering-service.ts`；`core-assembly.ts` resolveAuthority
- Tests to add/update: 即使注入 authority 也必须计费。
- Out of scope / Do not: 不要在 C8 修好前扩大 steering 入口。
- Depends on: FIND-A-002

### FIND-A-024 — Severity: P2
- Title: HarnessRelease 运营台是真 UI，但当产品能力只能算「商家无感的半成品」
- Plan anchor: §29–30；§37.4-J
- Capability: C14 / J
- Evidence: R2 渲染 production/retired 行 `capability-baseline-audit-r2-2026-08-13.md:36`。未 publish/canary/rollback 真动作。V31-21/22 evidence-debt。
- Merchant impact: 无直接伤害；release 无法还原 exact pin 的运营承诺未兑现。
- Repro (code-level): `/admin/ops-console` 可点，生产动作未证。
- Root cause: 展示层先于控制动作验收。
- Fix contract (acceptance, testable): allowlist canary 命中候选、非 canary 用 production、rollback 后新任务回旧、在途任务钉住。全程商家无感。
- Files a fix agent should open first: `v31-ops-console-release-journey.spec.ts`；HarnessRelease service
- Tests to add/update: J 旅程在隔离环境真跑（禁止对生产 release 下手）。
- Out of scope / Do not: 不要做商家可见的 Prompt/模型页。
- Depends on: 无

### FIND-A-025 — Severity: P2
- Title: 跨载体一单多交付（图文+文案）商家不可达
- Plan anchor: §3 L2 例「小红书 6 页 + 朋友圈短文案」；V31-47
- Capability: CAR / C4
- Evidence: V31-47 写明 Composer `proposalFromSubmission` 恒单载体 `V31-47-cross-carrier-execution-wiring.md:27`。计划成功形态第 5 步是多交付。
- Merchant impact: Living Plan 不能一次出笔记+朋友圈。
- Repro (code-level): 任意 Composer 提交 `recommendedDeliverables` 长度 1。
- Root cause: 编译能拆多载体，入口故意单透镜。
- Fix contract (acceptance, testable): 一条 Living Plan 可含 note+copy；一次付费确认；两 Make 都交付或诚实部分失败。
- Files a fix agent should open first: `composer-plan-session.ts` proposalFromSubmission；V31-47
- Tests to add/update: 多载体 freeze + 双包交付。
- Out of scope / Do not: 不要让 copy 部分免确认、媒体部分漏确认。
- Depends on: FIND-A-008

### FIND-A-026 — Severity: P1
- Title: Day-0「第一条成品」仍被配方 slot 挡住，引导卡不是交付
- Plan anchor: §37.4-A；retro R1；C1 定义「拿到第一条成品」
- Capability: C1
- Evidence: 零素材 spec 成功标准是「不 POST submissions、出 guidance」`v31-zero-source-image-text-first-visit.spec.ts:54-69`。账本 C1 文案是「零素材首访拿到第一条成品」。自由创作（copy/free）才可能到通用文案。
- Merchant impact: 默认图文轴首访拿不到成品，只拿到「去传图/换写法」。
- Repro (code-level): 新号选图文发送 → `composer-recipe-slot-guidance`。
- Root cause: 默认配方 `case_image` 硬前置；C1 被降级成「不死」而非「做成」。
- Fix contract (acceptance, testable): 零素材首访在**默认轴**也能拿到一条不含虚构门店事实的可发布文案或明确的「先走文案」一键切换并直接生成。不允许停在只有上传的死胡同还叫 C1 可用。
- Files a fix agent should open first: 默认 recipe 种子；`v31-zero-source-image-text-first-visit.spec.ts`；C2 free 路径
- Tests to add/update: C1 门增加「到达 delivery-card 或等价成品」正路径（可走文案轴，但必须是默认首访无需懂配方）。
- Out of scope / Do not: 不要为了绿而 seed 案例图。
- Depends on: FIND-A-001（文案路径不要再弹确认）

### FIND-A-027 — Severity: P2
- Title: Thread 旅程用 API 种会话，未证明创作产生的 Thread 可恢复
- Plan anchor: §35 批次 1 退出门；§37.4-I
- Capability: C10 / I
- Evidence: `v31-thread-root-workbench.spec.ts:109-118` `agent-session.create_thread`。真实创作 Thread 绑定在 L1 e2e `v31-level1-copy-journey.spec.ts:337-344`，但该文件不断言 refresh 后同一 thread 再开新 Work。
- Merchant impact: 深链恢复可能绿，创作连续性仍未知。
- Repro (code-level): 读 I spec 无 submissions。
- Root cause: 把 persistence 探测当成产品旅程。
- Fix contract (acceptance, testable): 一条真实 copy 交付 → reload → 同一 threadId → 再发一条 → 两个 workId。
- Files a fix agent should open first: `v31-thread-root-workbench.spec.ts`
- Tests to add/update: 替换或追加创作驱动用例。
- Out of scope / Do not: 不要删除深链用例。
- Depends on: FIND-A-003

### FIND-A-028 — Severity: P1
- Title: 余额不足双出口组件在，但 quota 卡仍指「联系运营」旧出路
- Plan anchor: §3 R5「买加油包 / 升级套餐，不透支」
- Capability: C6 / BILL
- Evidence: 新双出口 `workbench-credit-purchase-actions.tsx:10-28`。旧卡 `quota-blocking.ts:27-33` 注释写明「查看套餐」曾死链，现保留「联系运营开通」。
- Merchant impact: 不同阻断面出口不一致；有的能买，有的只能找人。
- Repro (code-level): 对比 shortfall 面与 exhausted quota 面。
- Root cause: GL-23 旧卡未收敛到 R5。
- Fix contract (acceptance, testable): 所有余额/配额阻断只呈现加油包+升级（可另附兑换码），不再作为唯一主出口的「联系运营」。
- Files a fix agent should open first: `quota-blocking.ts`；`workbench-credit-purchase-actions.tsx`；composer-home 引用点
- Tests to add/update: L1 shortfall e2e 已有则扩到 exhausted 卡。
- Out of scope / Do not: 不要透支。
- Depends on: 无

## 4. False completeness

1. **V31-01…25「implementation done / evidence-debt」**  
   票面 Implementation=done 只证明有代码与某 SHA。Evidence 表大量空行（V31-08/17/19/24）。不能当可用。

2. **`v31-level1-copy-journey` 2/2 pass**  
   绿的是「无 execution-confirm + 无 /start + 有 quote」。它主动点掉「确认并开始」，把 A13/§37.4-B 免确认合同洗成假绿。

3. **V31-82 implementation-complete + 活体退款**  
   修的是悬死终态，不是 C4 做成。把超时退款写成「定制图文可用」是假完成。

4. **V31-73/85 零素材引导绿**  
   证明不死，不证明 C1「第一条成品」。门 spec 甚至断言不得 POST。

5. **V31-05 Thread-root + `/dashboard/recent` 收编**  
   Host 挂上了，但 Delivered 打字重绑，产品语义仍是 Work-root Composer。

6. **V31-18 B2 Playwright 曾绿**  
   风格生效断言已删除；转正 chip 不存在；AC4 仍债。透明清单≠记忆产品。

7. **V31-17/19 自报**  
   合同+面板+e2e 拨钟 ≠ 次日商家被问到。

8. **V31-24 Goal/Proactive**  
   无 CRUD（正确）被当成「Goal 产品面完成」。实际没有提议创建。

9. **V31-16/27 Steering**  
   面板与分类器在，生产键空间死。V31-27 自己写 AC1 被证伪。

10. **V31-15/62 Artifact 4/4**  
    fixture 门绿；盘点标题是内部指令。原位生长的商家观感未达标。

11. **V31-47 跨载体接线**  
    票写 implemented，Composer 入口仍单载体。商家做不出计划里的「笔记+朋友圈」。

12. **C15 Admin 可用**  
    这是真走查过的少数面，但它不是商家宣发产品。不能拿它给 V3.1 主线镀金。

13. **账本「Day-0 全链首次跑通」**  
    祖先 SHA 活体（档案→素材→202）成立；HEAD `0a693408` 未复走；且那条链到 202 提交，不是到成品+发布+自报。

## 5. Executable ticket pack

1. **FIX-L1-NO-FACT-GATE** — 纯 copy 去掉「确认并开始」。文件：`fact-satisfaction.ts`、`v31-level1-copy-journey.spec.ts`、`ui-journey.ts`。DoD：L1 e2e 该按钮 count=0 且 202/makeReady。命令：`pnpm --filter @meiye/web e2e -- tests/e2e/specs/v31-level1-copy-journey.spec.ts`。风险：缺事实的 copy 可能写进未确认价格——必须改成 assumption 不写价。

2. **FIX-STEERING-ADMIT-KEY** — 对齐 composer-task 与 admitted snapshot。文件：`core-assembly.ts`、`steering-service.ts`、`steering-composer-panel.tsx`。DoD：G 旅程走到改页断言；错误无英文裸串。命令：`v31-mid-run-steering-journey.spec.ts`。风险：误用错误 workflowId 改到别人的 run。

3. **FIX-DELIVERED-KEEP-THREAD** — 删除 delivered 打字重绑。文件：`composer-home.tsx` 四处 `rebindComposerSession`。DoD：交付后输入 threadId 不变，第二条 work 同 thread。命令：改写 `v31-thread-root-workbench.spec.ts`。风险：旧 session restore 逻辑回潮。

4. **FIX-NEXT-DAY-ASK-SURFACE** — Idle/结果页次日追问。文件：`use-publish-handoff.ts`、Idle、结果中心。DoD：昨天 published 的 Work 今日打开必见 chips，点写入 OutcomeEvidence。命令：新 spec，禁止 evaluate 拨钟冒充 UI。风险：频控被绕过。

5. **FIX-L0-REVISE-PRIMITIVE** — 已交付 copy 的确定性修订。文件：`turn-runner.ts`、`composer-plan-session.ts` isCompilableTurn、revise 原语。DoD：L0 零 LLM、无新 Living Plan。风险：过宽正则误伤。

6. **FIX-LEVEL-AUTHORITY-ONE-WRITER** — `approvalBasis`/`makeReady` 消费 `classifyProgressiveLevel`。文件：`composer-plan-session.ts`。DoD：V31-08 AC1 有单测+一条浏览器。风险：copy lens 上的 L3 文案突然要确认——这是正确收紧。

7. **FIX-C4-MAKE-ACTUALLY-FINISH** — 图文 job 创建到逐页交付。文件：execution spine / generation jobs / Living Plan controller。DoD：C 旅程 HEAD 同 SHA 绿 + 一条 dev fixture 活体。风险：与 V31-82 超时竞态。

8. **FIX-VIDEO-WITH-ASSET-D** — 带素材视频全链。文件：D spec、video worksurface、V31-36。DoD：一笔扣费、无字幕/封面承诺。风险：供应商部分失败结算。

9. **FIX-RIGHTS-REVOKE-F** — 撤权 fail closed。文件：F spec、rights fence。DoD：换素材可继续、不双扣。风险：误伤未引用素材。

10. **FIX-MEMORY-PROMOTE-CHIP** — 交付时「记住这次？」+ 隐藏 memoryId。文件：memory 面板、`agent-memory-platform.ts`。DoD：转正/撤销 B2 真人可走。风险：false persistence。

11. **FIX-SELF-REPORT-ONE-SURFACE** — 合并结果中心与 workbench chips。文件：两个 panel。DoD：单一 writer、单一文案。风险：旧结果补记兼容。

12. **FIX-GOAL-PROPOSE-IN-THREAD** — 对话提议 Goal，不建 CRUD。文件：goal-proactive、composer 卡。DoD：确认才落库。风险：乱提议打扰——默认只在用户说长期目标时出现。

13. **FIX-REMIX-SECOND-CLICK** — V31-76。文件：`creation-entry-model.ts`、creation-loop spec。DoD：两轮 remix 覆盖草稿；continue-item 定性。命令：`uiux-creation-loop.spec.ts`、`dashboard-home-mount.spec.ts`。

14. **FIX-BILLING-COPY-ONE-PAIR** — 统一退回文案、去掉双行。文件：`billing-ux.ts`、`composer-home.tsx`、V31-80#6。DoD：全站一对句子。风险：i18n 键漂移。

15. **FIX-INTERNAL-TEXT-LEAK** — V31-80 七项。文件：票面清单。DoD：无 ExecutionPlanSnapshot/work-uuid 正文；方案卡冻结。

16. **FIX-E-H-GATE** — stale + interrupt 同 SHA 绿。文件：E/H spec、expiry job、V31-57。DoD：required 门评到且绿。

17. **FIX-PARTIAL-RESUME-C17** — 失败页续跑不重扣。文件：C17 spec。DoD：usage 分项。依赖 C4。

18. **FIX-QUOTA-EXITS** — exhausted 卡对齐加油包/升级。文件：`quota-blocking.ts`。DoD：无「只联系运营」主出口。

19. **FIX-PROGRESS-NOT-COT** — 去掉商家 CoT slot。文件：`composer-progress-card.tsx`。DoD：静态扫描零 chain-of-thought。

20. **FIX-STEERING-LATENT-FREE-WRITE** — 关 V31-45 不计费臂。文件：`steering-service.ts`。DoD：注入 authority 也计费。

21. **FIX-C1-FIRST-ARTIFACT** — 默认首访到达通用成品或一键文案直达。文件：默认 recipe + C1 spec。DoD：新号不传图也能拿到可发布 copy。

22. **FIX-I-JOURNEY-FROM-CREATION** — I spec 改为创作驱动。文件：`v31-thread-root-workbench.spec.ts`。DoD：两 Work 一 Thread。

## 6. Open questions / unproven

- HEAD `0a693408` 本身没有本评执行的浏览器走查。C15 / Day-0 档案链 / V31-82 退款的活体均发生在祖先 SHA（`1baf2074` / `97f534d0` / `7e6876ac` 等）。它们**不能**自动写成 HEAD available。
- Live 模型生成链（非 fixture）本评零证据。C2/C3/C4/C5 的「做成」全部至多 fixture。
- `workflow.token` 是否仍有任何 PG writer（§0.5 不逐 token 落库）未审计。
- V31-78 砖号在 HEAD 是否自愈，未测。
- 服务端跨账号读 work 是否 4xx（V31-83 的另一半）R2 写明未测成。
- `workbench_credit_refund` paraglide 源文案未在 `src/locale` 检索到（可能生成产物被 ignore）；商家最终句以 e2e 正则与运行时函数为准，需打开生成文件核对。
- required CI / `Core quality` 在 HEAD 是否绿：CURRENT 写的是另一 Integration SHA `39ca4b39`，与本评 HEAD 不是同一棵树。Release-ready **未证明**。
- L2「只问一个问题」在生产 Intent turn 是否硬限制，本评只见到政策/预算代码存在，未见到商家路径计数证据。
- 三 runner 是否已在生产路径收敛为单 executor：V31-25 票面自称 done，商家无感知差异，等价门自己承认全量 journey 不可靠。
