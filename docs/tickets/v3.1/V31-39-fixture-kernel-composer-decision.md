# V31-39 — Composer 意图轮的剩余「无出口等待」族：decision 缺失与 systemOnlyBlock

**Parent**: V31-06（Session Harness AgentKernel）/ Task 7（Real Session Intent）
**批次**: 收尾
**Blocked by**: None — can start immediately
**Related**: V31-41（存量已确认未执行预留的释放路径）/ V31-33（同摸 `recoverPendingStarts` ＋ sweep 谓词，三票成三角，禁并行开工）
**Status**: open

> **优先级注记（S0 树注）**：`startPrepared` 是 T7 树独有，S0 树无此函数——**合并后此缺陷才激活**，本票优先级按此排。

## 背景：fixture 停摆已修，但只修了其中一支

2026-08-09 查实（锚署树 `美业内容2-v31-fix-07`）：fixture 档每次 Composer 提交都静默 park——`DEFAULT_FIXTURE_DECISION`（`apps/core/src/p1/agent-session/ai-sdk-agent-kernel.ts:157`）是 `{action:{kind:'finish_turn'}}`，既非 `propose_plan` 也非 `ask_merchant`，于是 `prepare()` 走进 clarification 分支、把 run 置 `waiting`、返回 `makeReady:false`，而这个 wait 没有任何出边生产者：没有计划可开始，也没有问题可回答。这与 handoff 里「上游 Harness/renderer 阻塞」的旅程超时同形。

已修（commit `5bb24c54d`）：**只修「答了但不提计划、也不问」这一支**——fixture 档下让它落到生产已有的 `proposalFromSubmission(submission)` 兜底（`composer-plan-session.ts:242`），live 档保持响亮失败。

**为什么不采用「给 fixture kernel 一个 canned propose_plan」**（这条已被否，勿重开）：`FixtureAgentKernel` 确实接受静态 decision 或工厂 `(request) => AgentTurnDecision`（`agent-kernel.ts:75`），`createSessionAgentKernel` 也已经通了 `fixtureDecision` 形参（`ai-sdk-agent-kernel.ts:172`），**改端口不需要**。但 kernel 是 assembly 级单实例（`service.ts:257 kernel: this.options.kernel`），`AgentKernelTurnRequest` 只带 `{instructions, prompt, tools, activeToolNames, maxLlmSteps, onPartial}`，**看不到 submission**。因此任何 fixture 提案都是常量，且会 override 掉真兜底：每个 fixture 计划都显示同一组 fixture 编造的交付物，浏览器旅程断言的是 fixture 虚构而非商家所签——比 park 更坏，且正好把 Task 7 要证的「提案→计划」那条缝伪造掉。

## 本票范围：剩下两支仍是无出口等待

`turnDeclinedToPlan`（`composer-plan-session.ts`）刻意只放行「有 decision、非 systemOnlyBlock、非 ask_merchant」。以下两支在两档下都仍 park：

1. **`decision == null`**：kernel 返回了不可解析/空的决策。`assertTurnCanBeWaitedOn` 对 null 提前 return（不抛），随后 `requestClarificationInterrupt` 拿着一个没有 decision 的 turnResult 去建中断，run 置 `waiting`。商家看到一个不会前进的会话。
2. **`systemOnlyBlock === true`**：策略拦住了这一轮。拦是对的，但拦完之后没有面向商家的出口——没有「因为什么被拦、你可以做什么」的可锚定面，run 同样停在 `waiting`。

两支都是「入边有、出边无」，也是 V31-28 那类「计划面不出现」的独立成因，需各自的产品出口而不是各自的 throw。

## 实施范围

- `decision == null`：判为 turn 失败（与 finish_turn 在 live 档同待遇），run 置 `failed` 并带上可读原因，禁止建空中断。
- `systemOnlyBlock`：产出面向商家的阻塞面（何事被拦 + 下一步），并让 run 进入一个有出边的状态；策略拦截不得表现为静默等待。
- 两支各留一条测试钉住「没有出边的 waiting 不再可达」。

## 第三支（同族，前台）：ask_merchant 的等待有 Core 出口但没有可用入口

`ask_merchant` 是唯一一支「等待有生产者」的分支——商家答一句就前进。但前台答不进去。

主控 R5 批复把「完整答复入口 UX」指向 V31-28 或本票；V31-28 与 V31-27 均已 `done`，故落在本票。

已修的只是姊妹症状（commit `a6630ae91`）：`返回修改` 聚焦到一个 `disabled` 的输入框。机理（锚署树 `美业内容2-v31-fix-07`）：`PromptInput` 的 `lockInputOnRun` 默认 true（`src/components/heroui-pro/vendor/components/prompt-input/prompt-input.tsx:68`），textarea 在 `disabled: disabled || (lockInputOnRun && isGenerating)`（同文件 `:316`）被禁；而计划呈现期 session 仍是 `running`，`composer-home.tsx` 的 `running=` 因此恒真。已让 `revising` 期间让位。

**未修的一支**：Composer 澄清中断走的是语义事件通道（`composer-clarification-interrupt.ts:58` 发 `interrupt.requested` → workbench store 的 `pendingInterrupts`），**不**经 `readPendingHarnessDecision` / `readPendingHarnessInteraction`，因此 `applyComposerPendingInterrupts` 不会把 phase 提到 `awaiting_answer`（`composer-session.ts` 内该函数），phase 停在 `running`，输入框保持 disabled。`use-living-plan-controller.ts` 里 `hasPendingPlanClarification()` 那条 `/answer` 分支于是没有可达的人类调用者——只有测试直接调 hook 时才走得到。

同时记入本票的相邻缺口（R4 实施时暴露，`c3819318f`）：

- 付费确认权威 ID 现在由 submit 响应带回并存在 `session.task`（含 sessionStorage 恢复）。但 `restoreComposerSessionFromActiveTask`（服务端在飞任务重建，即 D-145 时间桥）不带这个 ID，换标签页/换设备恢复的会话点「开始制作」会因缺 ID 而无法记录决策。出口应是从服务端读回待决确认（已有 `GET /v1/workspaces/:id/p1/confirmation-requests` 列表路由，web 侧尚无代理路由与 client）。
- `startPrepared` 重算的是 base requestId（`submission-coordinator.ts:382`），而 `resolveRequestId` 在「同 plan revision + 同 snapshot 上一次决策为 rejected/expired」时会派生 `${base}:r:${digest}` 候选（`execution-confirmation-authority.ts:199`，终态事实取自 `:198`）。两个 ID 不相等 → 启动被判「不是准备好的那份权威」。**下节是这一条的终裁，实施以下节为准。**

## 终裁：`:r:` / startPrepared（2026-08-09，S0 确认设计意图，主控终裁）

### 定级

活性缺陷 ＋ 资金悬挂（无损失；**无自动回收——U8 有意：confirmed 不设 TTL**；释放依赖执行恢复，存量需一次性清理）。

**现象**（只读实证，锚署树 `美业内容2-v31-fix-07`）：`confirmed` 决策保留 hold（只有 `rejected` 退款）；过期清扫谓词是 `WHERE status = 'pending' AND hold_expires_at <= $1`（`postgres-execution-confirmation-store.ts:375`），被确认过的 request 状态已是 `decided`，清扫器扫不到它。商家点了确认、start 撞硬等值检查抛错、方案永远启动不了，那笔预留既不被消费也不被退回。客服口径因此是「我的积分不见了」，不是「按钮没反应」。

**性质**（归因，不要把上面的现象读成缺陷）：`confirmed` 不被定时器回收是立项时的明确选择——立项提交 `ed370e197`（V31-11 confirmation objects）正文原话「PlanConfirmationDecision immutable; **confirmed record carries no TTL (U8)**」，以及「Reject/expiry refunds原扣批次 in full … hold expiry = cancel + refund via DBOS durable seam」。清扫器不碰 `decided` 是 U8 的正确实现。释放路径本来就存在，就是「执行消费掉它」；只不过 `startPrepared` 重算 base 让执行永远到不了。**资金悬挂是活性缺陷的下游后果，不是确认链的设计缺口。**

### 修法

`startPrepared` **解析当前存的 authority id，不重算 base**。（不是二选一——重算这个策略与该机制在数学上不兼容：`:r:` id 掺入了上一次终态决策的 `decisionId`，是决策历史的函数而非 `{workflowId, planRevision, snapshotHash}` 的函数，所以任何从输入重算的做法在存在前序终态决策时必然找不到当前 id。）

### 产品口径

**拒绝后强制改稿**（D-122 介入位＝修正点；「暂不执行」后不改稿再确认对商家无新信息量）。改稿 bump planRevision → 新 base，拒绝臂自然失活，无需退役任何东西。

### 三道「防好心修坏」栅栏（本票的不变量，实施与复核都按此判）

**栅栏一 — `:r:` 保留，谁要删它必须先破掉两条 founding 属性之一。** `:r:` 是「终态决策不可改写 ＋ id 内容派生」两条属性逼出的**唯一数学形状**。它对**过期臂**承重：过期非商家之错，若无 `:r:` 槽位，base 被永久占住，商家永远无法再确认同一方案。拒绝臂靠改稿自然失活——**看起来像死码，不是死码**。

**栅栏二 — 强制改稿必须实现为旅程/前台规则，严禁实现为权威层「同 base 第二次请求一律拒绝」。** 机械证据：拒绝臂与过期臂**在代码里是同一条路径**，只靠 `const terminalFact = decision?.decisionId ?? 'expired'`（`execution-confirmation-authority.ts:198`）区分。权威层禁令会把合法的过期旅程一起打死，而**过期臂全仓零测试，不会有任何红灯拦住这个事故**。

**栅栏三 — 存量清理严禁以给 `confirmed` 加 TTL 的方式实现。** 那会破掉 U8（`ed370e197`）：商家确认过的方案会被定时器悄悄退款作废。

### 边界：本票只关入口

本票修法只关**入口**——解析存的 id 后，过期臂不再撞错，**新发生案例自愈**（hold 按 U8 原意被执行消费）。**存量已锁死预留的释放路径归 V31-41 族**（与 V31-33 同摸 `recoverPendingStarts` ＋ sweep 谓词那一对，三票成三角，禁并行开工）。写明这条是为了防「本票关了会显得修完了，而已锁死的钱还在」。

## 记录性说明：R5 静态断言的已知脆性（记录，不修）

`living-plan-revise-entry.static.test.ts` 用正则钉 `composer-home.tsx` 的 `running=` 表达式。三条已知局限，Wave 4 若打假红按此对照：

1. **格式化漂移会让它假红**——正则依赖 18 空格缩进与换行形状，Biome 改行宽即失效。方向安全（漂移→红，不会漏过真缺陷）。
2. **语义反转认不出**——把 `!livingPlanController.revising` 写成 `livingPlanController.revising` 仍然匹配，正则只查子串在场。
3. **合成行为无单一测试**——「锁是病因」（渲染级）与「宿主读了那个事实」（静态级）分两处证，没有一条测试同时覆盖「按下返回修改→框可编辑→提交到 /revise」的完整链。渲染级那条已用变异证明有牙（删掉宿主那行 → 2 绿变 1 红 1 绿 → 复原 2 绿）。

## Acceptance criteria

- [ ] `decision == null` 有 RED→GREEN：run 终态为 `failed`、错误文案指名原因、无中断行写入
- [ ] `systemOnlyBlock` 有 RED→GREEN：产生可锚定的商家阻塞面，run 不停在无出边 `waiting`
- [ ] 一条覆盖性断言：意图轮的所有出口分支穷举（propose / ask / declined / null / blocked），不存在落进 `waiting` 且无生产者的组合
- [ ] 不得用「给 fixture 灌 canned 提案」绕过本票（上文已否，理由随票）
- [ ] 前台：语义事件通道的待答澄清必须让输入框可用，并有一条渲染级测试证明商家能把答复提交进 `/answer`（现有 hook 级测试不算）
- [ ] 时间桥恢复的会话能取回待决确认 ID 并完成「先 decide 再 start」
- [ ] `startPrepared` 解析当前存的 authority id（不重算 base），并有一条测试证明存在前序终态决策时 start 仍能找到权威
- [ ] **钉过期臂的测试**（形状写死）：过期 → 同方案再请求 → 拿到**新 `:r:` request** → 确认成功。S0 报全仓零测试钉它，而一个有意设计零测试正是它被误删的路径；这条测试同时把栅栏二变成可执行约束而非注释
- [ ] 强制改稿实现在旅程/前台（拒绝后引导商家进编辑态）；**权威层不得出现「同 base 第二次请求一律拒绝」**——加了就会打死过期臂且无红灯
- [ ] 存量清理不得给 `confirmed` 加 TTL（U8，`ed370e197`）；释放走「执行消费」或 V31-41 族的一次性清理
- [ ] 票面三道栅栏与 U8 归因随实施保留，不得因「看起来是死码/看起来是缺陷」而删
