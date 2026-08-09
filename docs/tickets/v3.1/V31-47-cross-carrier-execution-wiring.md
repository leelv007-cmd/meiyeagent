# V31-47 — 跨载体交付真接线（一 Make 一载体），并拆除 freeze 处的 fail-closed 门

**Parent**: V31-09（PlanCompiler）/ V31-12（snapshot admission）/ V31-14（Make consumes snapshot）；权威 V3.1 §13、§22.1–22.2
**批次**: 收尾（V3.1 全量修复波 P0-C 的遗留实现面）
**Blocked by**: None — 门已 fail-closed，本票是把门后的能力补上
**Status**: ready-for-agent

## 为什么会有这张票

V3.1 全量修复波 lane T-9 的 P0-C 复原了 PlanCompiler 的真实编译（此前是按载体写死的常量），编译现在**按载体拆分**产出 `CompiledCarrierExecutionPlan[]`。但拆出来的第 2..n 条**没有任何生产消费者**，而唯一的 freeze 生产者只带得走一条。为避免静默半交付，跨载体 revision 在 freeze 处 fail-closed 抛错。本票是把「拆了但只跑一条」变成「拆了都跑」，并在接线成立后拆掉那道门。

锚点全部 tree-stamped 于 `codex/v31-fix-runner` @ `01af2bc05`（lane T-9 worktree `美业内容2-v31-fix-09`）：

- `apps/core/src/p1/agent-session/plan-compiler.ts:204` — `CompilePlanResult.executionPlans: CompiledCarrierExecutionPlan[]`，`:419` 产出，`:467` 收敛；`:207` 注释已写明「多载体 revision 的调用方必须从 executionPlans 里挑」；`:424` 的 `const [primary] = executionPlans` 就是「只取第一条」的现状。
- 生产侧唯一被读的是单数 `executionPlan`，在 `apps/core/src/p1/agent-session/composer-plan-session.ts:257`。`executionPlans[1..n]` 的全部引用只剩测试（`plan-compiler.test.ts:412/422`、`composer-plan-session.test.ts:320`）。
- `composer-plan-session.ts:230` `compileFinalizeExecutionPlanFreeze` 是 `ExecutionPlanCompileFreeze` 的**唯一**生产者（`:196` 调用），它把一个载体的 `executionPlan`（`:257`）与 revision 的**全部** `deliverables`（`:258`）配成同一份冻结件。
- 下游从不比对两者的载体集合：`apps/core/src/p1/harness/task-admission.ts:427-428` 直接以 `input.executionPlanFreeze` 作为 snapshot 来源；`apps/core/src/p1/execution-spine/creation-stage-port.ts:33/98-99` 继续往下带。
- 现有的门：`composer-plan-session.ts:239-244`，`ExecutionPlanFreezeError`（`:205`）+ code `MULTI_CARRIER_FREEZE_UNSUPPORTED`（`:241`），报错点名载体集合并指出「会承诺全部交付物、只执行 first carrier」。
- 生产可达链：`apps/core/src/assembly/api-runtime.ts:1572`（构造）→ `:1623`（注入）→ `apps/core/src/p1/execution-spine/submission-coordinator.ts:316` `agentPlanning.prepare()` → `composer-plan-session.ts:113` `this.compile()` → `:196` freeze。

**当前不出血的原因**（不要据此降低优先级，这只是入口窄）：`proposalFromSubmission`（`composer-plan-session.ts:277`）的 `recommendedDeliverables`（`:296`）恒为单元素，carrier 由 `snapshot.lens` 三分支决定，所以现网 Composer→Make 这条路暂时产不出跨载体 plan。但 Living Plan / 报价 / 积分成本三处都已按跨载体 revision 投影（见 `plan-semantic-event.test.ts:35-43` 的 note×6 + copy×1 fixture 及其五段式/creditCost 断言），商家侧已经能看到跨载体计划——入口一旦放宽（多载体推荐、或运营侧直接构造 revision），门就是唯一拦住半交付的东西。

## What to build

1. **每载体各起一个 Make 的调度语义**（本票的核心决策面，先定语义再写码，语义写回本票）。至少要答清：
   - 一个跨载体 Plan revision 对应 N 个 `ExecutionPlanCompileFreeze` 还是 1 个能承载 N 条 plan 的冻结件？（前者改 submission 层扇出，后者改冻结件 schema 与 admission 的 snapshot 绑定，代价与影响面不同，选哪个都要写明理由。）
   - N 个 Make 的**幂等键**如何区分。现有 `harnessEffectKey` 已含 `deliverableId`/`deliverableIndex`，但 Make 级 id 目前是 submission 级派生的：`composer-plan-session.ts:330`/`:337`/`:344` 的 `composerThreadId`/`composerRunId`/`composerPlanId` 都只按 workspaceId+taskId 指纹，同一 submission 扇出多 Make 时必须再加载体维度，否则重试会互相顶掉。
   - 部分成功怎么算：其中一个载体的 Make 失败时，revision 的 readiness 投影、报价与积分该呈现什么（readiness 恒 projection 是 V31-09 的硬约束，禁止引入第二 writer）。
   - 商家确认（`approvalBasisForSubmission`，`composer-plan-session.ts:271`：copy 走 `policy_exempt_copy`、其余走 `merchant_confirmed`）在跨载体下是一次确认覆盖全部，还是逐载体确认。混合载体里含 copy 时尤其要定。
2. **让 `executionPlans[1..n]` 获得生产消费者**：按上一条定下的语义接线，`plan-compiler.ts:424` 那个「取第一条」不应再是生产路径的终点。
3. **拆门的条件**（拆除 `composer-plan-session.ts:239-244`，同时删掉 `ExecutionPlanFreezeError` 若不再有别的用途）：必须先有一条**行为为证**的测试，断言一个跨载体 revision 的**每个**载体都真的被执行（不是「编译拆了」，也不是「冻结成功了」）。门在这条测试变绿之前不许拆——它现在是唯一阻止静默半交付的机制。
4. 顺带（可选，同域）：`boundedRetry` 与 `cachePolicies`/`unitCacheKeys` 目前编译后被携带但执行器不读（write-only）。若本票的接线要碰 executor 的 plan 消费面，一并让这几项被读，否则另开票，别默默留着。

## Acceptance criteria

- [ ] 调度语义四问（Make 基数 / 幂等键 / 部分成功 / 确认粒度）在本票内写定，与 V31-09「readiness 恒 projection、无第二 writer」不冲突
- [ ] 存在跨载体端到端测试：一个 note+copy 的 revision 提交后，**两个载体的执行端口都被调用**，且效果键可区分、重跑不重复副作用（at-least-once 幂等）
- [ ] `executionPlans[1..n]` 有生产消费者（不再只被测试引用）
- [ ] 上一条成立后拆除 `MULTI_CARRIER_FREEZE_UNSUPPORTED` 门；拆除的同一提交里必须带上让门变得多余的那条测试
- [ ] 报价/积分与实际执行的载体集合一致（不存在「按全量收费、只交付一个载体」的可达路径）
- [ ] 反向复核：复核方取「接线没真接上、只是把门挪走了」的立场，须逐条反驳
