# V31-39 — Composer 意图轮的剩余「无出口等待」族：decision 缺失与 systemOnlyBlock

**Parent**: V31-06（Session Harness AgentKernel）/ Task 7（Real Session Intent）
**批次**: 收尾
**Blocked by**: None — can start immediately
**Status**: open

## 背景：fixture 停摆已修，但只修了其中一支

2026-08-09 查实（锚署树 `美业内容2-v31-fix-07`）：fixture 档每次 Composer 提交都静默 park——`DEFAULT_FIXTURE_DECISION`（`apps/core/src/p1/agent-session/ai-sdk-agent-kernel.ts:157`）是 `{action:{kind:'finish_turn'}}`，既非 `propose_plan` 也非 `ask_merchant`，于是 `prepare()` 走进 clarification 分支、把 run 置 `waiting`、返回 `makeReady:false`，而这个 wait 没有任何出边生产者：没有计划可开始，也没有问题可回答。这与 handoff 里「上游 Harness/renderer 阻塞」的旅程超时同形。

已修（commit `5bb24c54d`）：**只修「答了但不提计划、也不问」这一支**——fixture 档下让它落到生产已有的 `proposalFromSubmission(submission)` 兜底（`composer-plan-session.ts:212`），live 档保持响亮失败。

**为什么不采用「给 fixture kernel 一个 canned propose_plan」**（这条已被否，勿重开）：`FixtureAgentKernel` 确实接受静态 decision 或工厂 `(request) => AgentTurnDecision`（`agent-kernel.ts:75`），`createSessionAgentKernel` 也已经通了 `fixtureDecision` 形参（`ai-sdk-agent-kernel.ts:170`），**改端口不需要**。但 kernel 是 assembly 级单实例（`service.ts:257 kernel: this.options.kernel`），`AgentKernelTurnRequest` 只带 `{instructions, prompt, tools, activeToolNames, maxLlmSteps, onPartial}`，**看不到 submission**。因此任何 fixture 提案都是常量，且会 override 掉真兜底：每个 fixture 计划都显示同一组 fixture 编造的交付物，浏览器旅程断言的是 fixture 虚构而非商家所签——比 park 更坏，且正好把 Task 7 要证的「提案→计划」那条缝伪造掉。

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
- `startPrepared` 重算的是 base requestId（`submission-coordinator.ts:386`），而 `resolveRequestId` 在「同 plan revision + 同 snapshot 上一次决策为 rejected/expired」时会派生 `${base}:r:${digest}` 候选（`execution-confirmation-authority.ts:196`）。商家拒绝后不改方案、直接再确认，这两个 ID 会不相等 → 启动被判「不是准备好的那份权威」。窄，但真。

## Acceptance criteria

- [ ] `decision == null` 有 RED→GREEN：run 终态为 `failed`、错误文案指名原因、无中断行写入
- [ ] `systemOnlyBlock` 有 RED→GREEN：产生可锚定的商家阻塞面，run 不停在无出边 `waiting`
- [ ] 一条覆盖性断言：意图轮的所有出口分支穷举（propose / ask / declined / null / blocked），不存在落进 `waiting` 且无生产者的组合
- [ ] 不得用「给 fixture 灌 canned 提案」绕过本票（上文已否，理由随票）
- [ ] 前台：语义事件通道的待答澄清必须让输入框可用，并有一条渲染级测试证明商家能把答复提交进 `/answer`（现有 hook 级测试不算）
- [ ] 时间桥恢复的会话能取回待决确认 ID 并完成「先 decide 再 start」
- [ ] 拒绝后再确认同一方案 revision：start 使用的 ID 与权威派生的 ID 一致（或明确判定该场景应强制改稿）
