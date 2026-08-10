# V31-55 — admission 变体②：context 围栏拒绝之后，商家收到的是「幂等冲突」

**Parent**: V31-12（snapshot admission）为合同面；症状暴露于 §37.4-B2 与 §37.4-J 两条旅程
**批次**: 收尾
**Blocked by**: 无——4D 根因已定位并修复（W4-B，本worktree `codex/v31-w4-confirmation`），待主控亲验合入
**Related**: V31-33 / V31-41 / V31-39（恢复与确认链三角）；4C 家族（变体①`unavailable for interrupt projection`）是**另一个**单根因，勿合并
**Status**: 待主控合入验收（两臂修法已落地+测试红转绿+tsc 净，SHA 见下）

## 症状（一句话）

Core 抛出 `CONTEXT_FENCE_MISMATCH`（「material context head drifted after freeze」）之后，**商家侧收到的却是 `IDEMPOTENCY_CONFLICT`**，文案是「ExecutionPlanSnapshot `<hash>` is immutable and already bound to a different admission row.」——两条错误说的不是同一件事。

> **锚署树**：`2da11d5ab`（W4-D round3 证据树）。

## 证据（两条 spec 各一次，形态一致）

| # | 证据 | 落点 |
|---|---|---|
| 1 | B2：先围栏、后幂等冲突 | `round3-per-spec/v31-memory-injection-b2-journey.log:226-227`（`[Core] DBOS context fence failed: material context head drifted after freeze.` ＋ `ExecutionPlanAdmissionError`）→ `:243` 客户端 `body={"error":{"code":"IDEMPOTENCY_CONFLICT","message":"ExecutionPlanSnapshot 040ce68… is immutable and already bound to a different admission row."}}` |
| 2 | J（ops-console）：同一形态 | 同目录 `v31-ops-console-release-journey.log:314-315` → `:331`（同两句，hash 为 `488a7f6…`） |
| 3 | 围栏抛出点 | `apps/core/src/p1/harness/execution-plan-admission.ts:419`（`if (input.live.contextDrifted === true)`）→ `:420` `throw new ExecutionPlanAdmissionError(` → `:421` code `'CONTEXT_FENCE_MISMATCH'` → `:422` 文案 |
| 4 | 客户端那句话的产出点（**两处同文，日志无法区分**） | `apps/core/src/p1/harness/memory-execution-plan-admission-store.ts:41-44`（code `IDEMPOTENCY_CONFLICT`）**与** `apps/core/src/p1/harness/postgres-execution-plan-admission-store.ts:121`——两个 store 都带同一句文案 |
| 5 | 命中面 | W4-D 终表：`v31-memory-injection-b2-journey`（1 FAIL）＋ `v31-ops-console-release-journey`（1 FAIL）；与变体①的 5 个 spec **不重叠** |

## 三件必须分清的事（本票的主要价值）

**① 因果链是「日志相邻」推得的，不是证明。** 围栏拒绝先出现、幂等冲突后出现，最自然的解释是：围栏拒绝 → 某处重试/重提 → 同一个 `snapshotHash` 撞上已绑定的另一条 admission row → `IDEMPOTENCY_CONFLICT`。**但本票没有证明那次重试存在、也没有证明它在哪。** 这是 4D 要定的事，票面**不得**把这条推论写成结论。

**② 商家看到的错误与真实原因不符，这本身是独立于根因的缺陷。** 即使 4D 把围栏误判修好，只要「围栏拒绝之后会冒出一个幂等冲突」的路径还在，下一次因**任何**正当理由触发围栏时，商家仍会收到一句关于「快照不可变」的话——那对商家毫无意义，对排障也是误导（它把注意力引向幂等/重放，而真实原因是上下文漂移）。所以 4D 收口时要**分别**回答：围栏为什么误判（根因）／围栏拒绝后为什么变成幂等冲突（错误传播）。

**③ `CONTEXT_FENCE_MISMATCH` 不在 HTTP 状态映射表里。** 实测 `apps/core/src/http-errors.ts:27` 有 `IDEMPOTENCY_CONFLICT: 409`，而 `CONTEXT_FENCE_MISMATCH` 在该文件中零命中（全仓仅三处：`execution-plan-admission.ts:51` 类型联合、`:421` 抛出、`execution-plan-admission.test.ts:287` 断言）。这**不构成**上面那条因果链的证明，但它说明围栏这个 code 从未被设计成对外可见——**如果 4D 决定让围栏拒绝直接对外，就必须同时给它一个状态码与商家可读文案**，否则会掉进默认分支。

## 根因结论（4D 回填，2026-08-10，W4-B）

三件必须分清的事里的第①条被证据坐实：**日志相邻不是因果。这两个错误各自独立成立，各有各的根因，两者可以在同一次提交里都发生，也可以只发生其中一个。**

### 臂 1 — `IDEMPOTENCY_CONFLICT` 本身：`putImmutable` 对自己刚写的行判假冲突

直接实证（隔离 lane、全新库、探针打在 `admit()`/`putImmutable()` 入口）：全程只有**一次** `admit()` 调用（栈：`CreationStagePort.start` → `HarnessTaskAdmissionService.admit`（task-admission.ts:592）→ `ExecutionPlanAdmissionService.admitSnapshot` → `admit`），`sameWorkflowId`/`sameWorkspaceId` 均为 `true`——不是两个位点、不是 id 形态错配、不是并发竞争。字段级 diff 显示唯一"不同"的字段是 `intentDeclaration`，但两侧打印的 JSON 逐字节相同——因为真正的差异是一个**值为 `undefined` 的 own property**，`JSON.stringify`（我的调试打印用的同一序列化）看不出它，但 `isDeepStrictEqual` 认为"存在但为 undefined 的属性"≠"不存在该属性"（已在 Node 里直接验证：`isDeepStrictEqual({a:undefined,b:1},{b:1})` → `false`）。

链路：`plan-compiler.ts:438`（`assumptions: proposal.assumptions`，裸透传，`desiredActions`/`platformHints` 用了 `.filter()` 保证总是数组，`assumptions` 没有同等保护）→ 当 `proposal.assumptions` 为 `undefined` 时（无 assumptions 的正常情形），构造出的对象带一个显式 `assumptions: undefined` 键 → `composer-plan-session.ts:933`（`intentDeclaration: revision.intent`）把这个键原样带进冻结的 `ExecutionPlanCompileFreeze` → `postgres-execution-plan-admission-store.ts:79` 用 `executionPlanSnapshotSchema.parse(row.snapshot)` 解析内存对象，Zod 保留这个显式 undefined 键（已直接验证：`schema.parse({a:undefined,b:1})` 保留 `a` 为 own property）→ `:103` `JSON.stringify(snapshot)` 写入 JSONB 时静默丢掉这个键（已验证）→ 回读的行天然没有这个键 → `:124`（现 `isDeepStrictEqual` 调用处）比较"回读的行"与"内存里仍带着该键的候选对象"，判不相等 → 对自己刚成功写入、从未有过第二个写者的行，判定为「已绑定到另一条 admission row」。

**这与围栏（臂 2）无关，且不需要任何重试或竞争——一次干净的全新提交就会触发。**

修法（采纳"窄修"：只归一化比较，不动源头）：`execution-plan-admission.ts` 新增 `normalizeForReplayComparison()`（`JSON.parse(JSON.stringify(x))`），在 `isDeepStrictEqual` 前对两侧同时归一化，用在三处结构相同的比较：`postgres-execution-plan-admission-store.ts:115`（`putImmutable` 自查）＋ `execution-plan-admission.ts`（`admit()` 的 `byWorkflow` 分支与 `priorByHash` 分支——这两处比较的一侧同样来自 store 回读，`admit()` 是存储无关的，Postgres 后端下同样会踩这个坑，主控裁决描述的"让比较语义与存储语义/哈希语义对齐"这一原则同样覆盖这两处，且如果不修，主控要求的回归测试②（同 hash/workflowId/payload 重放=no-op）无法转绿）。内存版 store（`memory-execution-plan-admission-store.ts`）不受影响——它两侧都走同一次 Zod parse、没有 JSON 序列化落库再回读的不对称，本来就不会踩这个坑，这也解释了为什么 4A 的 `dbos-workflow.test.ts`（用内存 store）从未捕获过这个 bug，只有真实 Postgres 的 e2e 才会命中。

**债务留痕（不在本轮修复范围）**：`plan-compiler.ts:438` 的裸透传模式（`assumptions: proposal.assumptions`）可能不是唯一一处；`assertExecutionPlanFidelity`（`execution-plan-admission.ts:520` 附近）也有一处 `isDeepStrictEqual` 比较"confirmed 内存对象"与"executing 快照"，同源风险未审计，未纳入本轮修复与回归测试（本次两个失败旅程未触达该路径）。

### 臂 2 — `CONTEXT_FENCE_MISMATCH` 本身：identity 事实头恒缺，误判为漂移

同一次实证：`resolveFactHeads` 的 `brief:` 分支单独打点显示 `materialChanged:false`（brief 事实确实没漂移），但围栏仍然抛出——证明触发点不是 brief 分支。静态读码锁定：`factRevisionRefsFromSnapshot`（task-admission.ts:1210-1217）无条件构造两条 ref（`identity:…` 与 `brief:…`）；`resolveFactHeads` 的 `identity:` 分支（execution-plan-live-facts.ts）**只有在 `listActive` 命中匹配的 id+version 时才 push 一个 head**——不命中时（含 `identities` 端口完全未接线的常态）什么都不 push，连"未命中"的占位都没有。`resolveExecutionPlanLiveFactsFromPorts` 的聚合逻辑把 `live.factRevisionRefs.length !== snapshot.factRevisionRefs.length` 视为漂移——只要 identity ref 没解析出任何 head（几乎总是，因为 freeze 从未捕获过"当时解析到了什么"，verify 侧的 fail-closed 等于在验证一个从未真正建立过的前置条件），长度必然短一，围栏必然误击发。**这与臂 1 完全独立，不需要臂 1 先发生。**

修法（按兄弟分支降级语义补占位头）：`execution-plan-live-facts.ts` 的 identity 分支改为三态：①`listActive` 命中同 id 同 version → push 非漂移占位（不变）；②命中同 id 不同 version（真实可解析到的差异）→ push 一个不同的 `factRevisionId` 并设 `materialPriceOrDateChanged: true`（漂移，与 brief/store_fact 分支同构）；③未命中任何同 id 记录（含端口未接线）→ push 非漂移占位（而非什么都不 push），因为"没有信号"与"信号说不一样"是两件不同的事，前者不该被误判成后者。

**安全债留痕（如实记入，不在本轮修复）**：这个修法牺牲了"identity 被真实下架时能检测到漂移"的能力——因为 freeze 阶段从未把解析到的 identity 结果落进 snapshot，verify 阶段没有任何可信基线去判断"未命中"到底是真下架还是查询能力缺口。真正的 identity 退役漂移检测需要在 freeze 时把解析结果（或其摘要）写进 `ExecutionPlanCompileFreeze`（schema 变更），本波不做。

### 错误传播（ticket 原 AC2 要求的"重试路径指名"）

在同一次实证里确实观察到 `admit()`/`putImmutable()` 被调用了**两次**，相隔约 2.5 秒，workflowId 与 hash 完全相同，栈同样经过 `CreationStagePort.start`——第一次因臂 1 判假冲突（回滚，未落地），第二次成功（无 diff 记录）。这证明确实存在某个上层重试，形态与 `submission-coordinator.ts` 的 lease release-then-reclaim 语义一致，但**未继续深挖具体触发点**——主控裁决明确"第二次 admit 的 retry 触发源：不追……reclaim 语义本身是设计内的"。修臂 1 后首次 `admit()` 就会成功，这条重试路径在常态下不再被触发；若臂 2 的围栏仍因真实业务漂移合法拒绝，拒绝本身走 `CONTEXT_FENCE_MISMATCH`，不经过本票描述的幂等冲突文案传播路径（本轮未发现两者之间存在错误码转换/吞掉重抛的代码）。

**`CONTEXT_FENCE_MISMATCH` 在 `http-errors.ts` 零命中（ticket 原 AC4）——本轮未处理，非本次修复范围**：两臂修复后，两条失败旅程复测应转绿，该状态映射缺口暂无法通过本票现有证据继续验证是否仍有实际影响；作为独立债务留痕，若未来围栏因真实漂移合法拒绝且需要对外可见，仍需要补映射与商家可读文案。

## 本票不做什么

- **不领根因实施**。围栏为什么在这两条旅程上误判＝W4-B 4D 攻坚，主控另派。
- **不合并进 4C**。变体①（`Agent Run … unavailable for interrupt projection`，5 个 spec）与本变体命中面不重叠、错误形态不同，W4-D 已判为两个单根因。合并会让其中一个被另一个的修复"顺手治好"的假象掩盖。
- 不改 `memory-` / `postgres-execution-plan-admission-store.ts` 的不可变守卫——那个守卫本身是对的。

## Acceptance criteria（等 4D 根因结论后按此收口）

- [x] **4D 根因结论回填本票**（围栏为什么在这两条旅程误判），并注明 commit — 见「根因结论」section；commit SHA 待主控合入后回填本行
- [~] **错误传播单独有结论**：围栏拒绝之后为什么变成 `IDEMPOTENCY_CONFLICT`；若确有重试路径，指名它在哪（file:line，署树）——观察到确有重试（`CreationStagePort.start` 被重入，相隔~2.5s，同 workflowId/hash），但**未继续钉到具体触发点**：主控裁决明确此项不追（reclaim 语义设计内），故此项按主控裁决收口而非按票面原始要求收口，见「错误传播」section
- [ ] 商家侧文案与真实原因一致：因上下文漂移被拒时，商家看到的是关于**上下文/计划已变**的话，不是关于快照不可变的话——本轮未处理，两个根因都已在结构层面修复（不再误判），此项暂无实证场景可验证是否仍有影响，留债
- [ ] 若围栏 code 对外可见，`http-errors.ts` 有它的状态映射（当前零命中）——本轮未处理，非本次修复范围，留债
- [ ] `v31-memory-injection-b2-journey` 与 `v31-ops-console-release-journey` 两条旅程转绿——待主控浏览器终验轮复跑确认（4D 未预复现，按主控裁决把预算留给终验轮）
- [x] **变异反证**：单元/Postgres 层已完成红→绿→红(mutation)→绿的完整闭环，两处：①`postgres-execution-plan-admission.postgres.test.ts` 新增用例（显式 undefined 键的首次 admit / 同参重放 no-op / 真冲突仍被拒），②`execution-plan-live-facts.test.ts` 新增用例（identity 无信号→非漂移 / identity 可解析但版本不同→仍漂移，端到端跑过 `resolveExecutionPlanLiveFactsFromPorts` 断言 `contextDrifted`）。均已在修复前验证 RED、修复后验证 GREEN。浏览器层的 `input.live.contextDrifted = true` 变异反证留给主控终验轮（票面原文措辞的场景），终态 `git status --porcelain` 空（本次 4D 探针已全部剔除，未入库）

## 留痕

- 开票：W4-D 三轮浏览器验收把 23 红归为两个单根因，本票为变体②；主控 2026-08-10 派 review-memory 落票，并明示「根因归 4D，票面先记症状与证据」。
- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`）：两条 spec 的日志逐条只读核证（围栏句与客户端幂等冲突句各自行号、两个不同 snapshot hash）；围栏抛出点按 `2da11d5ab` 署实为 `:419-422`（派件给的 `:420` 是 throw 行，guard 在 `:419`、文案在 `:422`）；查明客户端那句文案**两个 store 都有**（`memory-…:41-44` 与 `postgres-…:121`），故日志无法判定是哪一个产出，票面如实标注不猜。**新增三条本票自有的判断**：因果链是日志相邻推论而非证明（4D 不得把它当结论）；「错误与真实原因不符」是独立于根因的缺陷、须分别收口；`CONTEXT_FENCE_MISMATCH` 在 `http-errors.ts` 零命中说明它从未被设计成对外可见。本 commit 零代码改动。
