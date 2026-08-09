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

### ID 传递链（七跳，逐跳锚已亲验；实施这条修法需要整条链）

派生只发生在第 ⑦ 跳，其余六跳全是**逐字透传**——所以「解析存的 id」只需在 ① 的位置换成读权威存的那一份，中间跳无需改动：

| 跳 | T7 树位置（发现时） | **集成树 `98949870a`（实施基准）** | 动作 |
|---|---|---|---|
| ① | `submission-coordinator.ts:382`（`startPrepared`） | **`:418`** | **缺陷所在**：重算 base，遇 `:r:` 后继即找不到。**已修 ⇒ `5d7326e35`（merged `bb6fe34be`）**：`fix(execution-spine): startPrepared resolves the persisted authority ID instead of recomputing it`，同 commit 改 `submission-coordinator.ts` 与 `composer-http.test.ts` |
| ② | `submission-coordinator.ts:1319` → `:1334`（`submissionResponse`） | **`:1444`** → **`:1461`** | 读 `confirmationDispatch.requestId` 并原样暴露给浏览器（零派生） |
| ③ | `submission-coordinator.ts:701` → `:710` | **`:742`**（取值）→ **`:751`**（写入 dispatch）；缺 ID 即抛在 **`:744-747`** | 取 `prepared.executionConfirmationRequestId`，原样写入 `confirmationDispatch` |
| ④ | `creation-stage-port.ts:67` | **`:74`** | 转发到 Harness 端口 |
| ⑤ | `task-admission.ts:383` → `:384 admit(input, false)` | **`:418`** → **`:419`** | 进入准备态（不启 DBOS） |
| ⑥ | `task-admission.ts:692` | **`:760`** | **ID 换载体的赋值点**：`request.executionConfirmationRequestId = created.stored.request.requestId` |
| ⑦ | `execution-confirmation-authority.ts:115` → `:169 resolveRequestId` → `:173` helper / `:199` `:r:` 派生 | **未漂**：`:115` → `:169` → `:173` / `:199`（`terminalFact` 在 `:198`） | **唯一派生处**（base 由单一 helper 出；有前序终态决策时派生 `:r:` 后继） |

> **Wave 4 重锚（2026-08-10，review-memory 逐跳只读亲验）**：①–⑥ 在集成树上全部漂移（协调器侧 +36～+125 行，`task-admission` 侧 +35～+68 行），⑦ 所在文件**未漂**。**七跳的结构与「派生只在 ⑦」这一结论在集成树上逐跳复现，无一跳被改动。** 实施 lane 认集成树列；开工前先 `git -C <树> log -1 --format=%H` 取真 HEAD，若已前进则重新定位符号——本表的漂移量即这条协议的实证。

第 ⑥ 跳由 review-memory 补出（我原先的记账把它与 ⑦ 合并成一跳，五跳实为七跳）。它是唯一「跨载体」的赋值——从确认权威的 `stored.request` 搬到 Harness 的 `request` 上——所以任何排查「id 在哪一跳变了」的人必须知道这一跳存在。

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

## 追加项：decide 四层防线零测试覆盖（W4-B 承重项，2026-08-10）

R4 把付费确认权威 ID 交给浏览器并落进 `sessionStorage`（`session.task.executionConfirmationRequestId`）。review-memory 二轮复核独立判定**该句柄不构成越权面**，但同时发现**四层防线一条断言都没有**。R4 之前这个句柄不进浏览器存储，两条断言属「好有」；现在它进了，两条断言变**承重**。

**分派**：代码归 confirmation lane（**W4-B**），票面文字归本票（W4-C），两边不撞文件。

### 四层防线（锚署集成树 `98949870a`，逐层只读亲验）

| 层 | 机制 | 锚 |
|---|---|---|
| 1 | workspace 由**服务端会话**解析，客户端只能控 path 里的 requestId 一段 | `mkfast-template-main/src/lib/core-client.ts:126`（`forwardWorkspaceCoreRequest`）→ `:159`（`authorizeWorkspaceCoreRequest`，生产走 requireActiveSession）→ `:167`（`resolveActiveWorkspace(session.user.id)`） |
| 2 | Core 端点要 service-token，浏览器直连打不到 | 路由注册 `apps/core/src/server.ts:2529`，内联声明在 `:2536`；**集成树新增集中式路由表** `apps/core/src/route-table.ts:42` `['confirmation-decide', 'service-token']`——**这一层现在有两个锚，改任一处都要同步** |
| 3 | `workspaceId` 取服务端上下文；body 夹带不进来 | `server.ts:2557-2562`（`decide({ ...body, requestId, actorId, workspaceId: context.workspaceId, decidedAt })`——显式键在 spread **之后**）；更强的一层是 `executionConfirmationDecideBodySchema`（`server.ts:352`）只声明 `{decisionId, decision}`，**zod 默认 strip 未知键**，故 body 根本携带不了 `workspaceId`。顺序是第二道，strip 才是第一道 |
| 4 | 落到 SQL 按租户收窄；跨租户与不存在**同样 404**，无存在性 oracle | `execution-confirmation-service.ts:511`（`completeDecision` → `getOwnedRequest`，定义 `:854`）→ `postgres-execution-confirmation-store.ts:212`（`getByWorkspaceIdWithClient`，SQL `WHERE workspace_id = $1 AND request_id = $2`） |

### 缺口

`execution-confirmation-service.test.ts` / `postgres-execution-confirmation.postgres.test.ts` / `execution-confirmation-http.test.ts` 三个套件里**搜不到任何跨 workspace decide 被拒的断言**，也没有「body 夹带 workspaceId 不得生效」的断言。四层都是「按构造正确」，没有一层有红灯守着。

**同租户边界（明确不在本票）**：同一 workspace 内任何过 `authorizeContentCreation` 的成员都能 decide 本 workspace 的待决确认。这属同租户授权设计口径，主控在裁，本票不判、不实施。

## Acceptance criteria

> **未核证项（review-memory 自陈，2026-08-10）**：上面两条 AC 的代码已落地（`0761bccfa`，`postgres-execution-confirmation.postgres.test.ts` **+202 行**，merged `bb6fe34be`、主控亲验），但**我没有勾选**，因为我写在 AC 里的两项要求无法由 diff 单独证明：① 断言是否真压在 SQL 收窄那一层（`postgres-execution-confirmation-store.ts:212` 的谓词）而非只压 HTTP 状态码；② **变异背书**是否真做过——把 `server.ts:2557-2562` 的 spread 顺序反转后该断言必须转红。`0761bccfa` 只改了一个测试文件，变异测试按定义不会在 diff 里留痕。**请主控在勾选前确认这两点**；若已确认，直接把这两个框勾上即可，无需改文字。


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
- [ ] **（W4-B 代码，`0761bccfa` merged `bb6fe34be` 已落地；勾选待主控，见下方「未核证项」）跨 workspace decide 被拒**：workspace A 的会话持 workspace B 的 requestId 去 decide → 得 `NOT_FOUND`/404，**且与「requestId 完全不存在」返回同一状态**（不得出现可区分的存在性 oracle）。断言要压在 SQL 收窄那一层（`postgres-execution-confirmation-store.ts:212` 的谓词），不是只压 HTTP 状态码
- [ ] **（W4-B 代码，`0761bccfa` merged `bb6fe34be` 已落地；勾选待主控，见下方「未核证项」）body 夹带 `workspaceId` 不生效**：请求体带一个异租户 `workspaceId` → 被 zod strip 掉、decide 仍用会话上下文的 workspace。**变异背书**：把 `server.ts:2557-2562` 的 spread 顺序反转（`...body` 放到显式键之后）→ 该断言必须转红；不转红说明断言压错了层
- [ ] 上面两条以**行为为证**，不接受「读一遍代码确认安全」；补完后本节「缺口」段随之改写为已覆盖

## per-file 对账基准（T7 域，review-memory 实测，2026-08-09）

> **用途**：给 gates lane（W4-A）在集成树上机械推导的全集做**对账下界**，不是验收表。
> **读法（关键）**：下列数字出自 **T7 树** `codex/v31-fix-session-plan`（core 部分 @ `556fdd654`，其中三文件在 `9b96d2761` 复验），库＝`provision-test-db.sh` 一次性库 `meiye_v31_t7_review`，命令＝`apps/core/node_modules/.bin/tsx --test --test-concurrency=1 <单文件>`（绕开 `locale:compile`），exit code 逐文件取 `$?`。
> **集成树上同名文件的计数只应 ≥ 本表**（合入其他 lane 会新增测试）；若某文件在集成树上**少于**本表，那是有测试被删或被破，必须查明后才能记账——这是本表唯一的判据用法，不要拿它当「集成树应该等于这些数字」。

| 文件 | tests | pass | fail | skip | exit |
|---|---|---|---|---|---|
| `p1/agent-session/composer-plan-session.test.ts` | 17 | 17 | 0 | 0 | 0 |
| `p1/execution-spine/composer-http.test.ts` | 32 | 32 | 0 | 0 | 0 |
| `p1/agent-session/execution-confirmation-authority.test.ts` | 4 | 4 | 0 | 0 | 0 |
| `p1/agent-session/execution-confirmation-service.test.ts` | 17 | 17 | 0 | 0 | 0 |
| `p1/agent-session/execution-confirmation-http.test.ts` | 9 | 9 | 0 | 0 | 0 |
| `p1/agent-session/postgres-execution-confirmation.postgres.test.ts` | 15 | 15 | 0 | 0 | 0 |
| `p1/harness/paid-generation-confirmation.test.ts` | 4 | 4 | 0 | 0 | 0 |
| `p1/execution-spine/postgres-creation-submission-store.postgres.test.ts` | 14 | 14 | 0 | 0 | 0 |
| `p1/agent-session/execution-confirmation-authority-store.test.ts` | 1 | 1 | 0 | 0 | 0 |
| `p1/agent-session/execution-confirmation-expiry-job.test.ts` | 2 | 2 | 0 | 0 | 0 |
| `p1/harness/confirmation-gate-merge.test.ts` | 5 | 5 | 0 | 0 | 0 |
| **core 小计（11 文件）** | **120** | **120** | **0** | **0** | — |
| `mkfast/src/product/composer/living-plan-revise-entry.static.test.ts` | 2 | 2 | 0 | 0 | 0 |
| `mkfast/src/product/composer/composer-submission-client.test.ts` | 6 | 6 | 0 | 0 | 0 |
| `mkfast/src/product/harness-client.test.ts` | 8 | 8 | 0 | 0 | 0 |
| `mkfast/src/product/composer/composer-session.test.ts` | 25 | 25 | 0 | 0 | 0 |
| **web node 小计（4 文件）** | **41** | **41** | **0** | **0** | — |
| web vitest（`use-living-plan-controller` + `living-plan-revise-entry` interaction） | 4 | 4 | 0 | 0 | — |

**变异判别力（同轮实测，四发，改后即还原、终态 porcelain 空）**——这四条是「断言真的有牙」的证据，集成树上若要改动对应源码，应能复现同样的红：

| 变异 | 结果 | 红在哪 |
|---|---|---|
| `api-runtime.ts` 的 `modelRuntime.mode === 'fixture'` → `true` | 16/17 | 源码正则断言 `the submission fallback reaches production bound to fixture mode only` |
| `composer-plan-session.ts` 构造器 `=== true` → `!== false`（默认泄漏到 live） | 16/17（`composer-http` 仍 32/32） | **行为级** `a turn that neither proposes nor asks fails the run instead of parking it` |
| `composer-home.tsx` 删 `!livingPlanController.revising &&` | 1/2 | R5 静态断言（证明非空洞） |
| `submissionResponse` 改为自行派生 `confirmation:${task.id}` | 31/32 | `actual 'confirmation:task-1'` vs `expected 'confirmation:authority:task-1'` |

**T7 自报全集对账**：T7 落盘的 `core-perfile-summary.txt` 报 `files=30 tests=432 pass=432 fail=0 skip=0`。review-memory 独立核算：30 行 per-file 的 `tests` 加总确为 **432**、`pass` 加总 **432**、无任何 `exit≠0` 行，**加总成立**；且本表 11 个文件中有 **10 个在其集合内且计数逐个相同**。唯一差异是 `p1/harness/paid-generation-confirmation.test.ts`（本表 4/4）**不在**其 30 之内——那是另一个 id helper（`executionConfirmationRequestId(workflowId)`）的消费者面，建议 W4-A 的全集把它纳入。

## 留痕

- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`，基座 `98949870a`）：七跳表加集成树列；新建「追加项：decide 四层防线零测试覆盖」节（四层锚点表，含中央 `route-table.ts:42` 这个第二锚点）＋两条承重 AC；落 T7 域 per-file 对账基准与 432/432 对账。
- Wave 4 追加（同日，回填 W4-B 交付 SHA）：两条承重 AC 的代码已由 W4-B 落地 ⇒ `0761bccfa`（`test(agent-session): pin decide's cross-workspace rejection and body-smuggled workspaceId rejection`，`postgres-execution-confirmation.postgres.test.ts` **+202 行**），经 merge `bb6fe34be` 入集成树、主控亲验。七跳表第 ① 跳的缺陷亦已修 ⇒ `5d7326e35`（同 commit 改产品与测试两个文件）。**该 merge 共带三个 commit**（第三条是 `111022d1d` 崩溃恢复重钉，见 V31-18），**三者都不碰 `agent-memory-platform`**——即 V31-18 AC1 的 Business Fact 守卫测试（W4-B 任务 5）**尚未落地**，那个引用位仍留 `待补录`，勿误认为已闭合。
