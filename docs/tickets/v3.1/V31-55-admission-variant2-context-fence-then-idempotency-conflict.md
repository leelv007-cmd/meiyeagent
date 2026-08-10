# V31-55 — admission 变体②：context 围栏拒绝之后，商家收到的是「幂等冲突」

**Parent**: V31-12（snapshot admission）为合同面；症状暴露于 §37.4-B2 与 §37.4-J 两条旅程
**批次**: 收尾
**Blocked by**: **根因归 W4-B 4D 攻坚（主控另派）**——本票**只记症状与证据**，不领实施
**Related**: V31-33 / V31-41 / V31-39（恢复与确认链三角）；4C 家族（变体①`unavailable for interrupt projection`）是**另一个**单根因，勿合并
**Status**: open（症状票，等 4D 根因结论回填）

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

## 本票不做什么

- **不领根因实施**。围栏为什么在这两条旅程上误判＝W4-B 4D 攻坚，主控另派。
- **不合并进 4C**。变体①（`Agent Run … unavailable for interrupt projection`，5 个 spec）与本变体命中面不重叠、错误形态不同，W4-D 已判为两个单根因。合并会让其中一个被另一个的修复"顺手治好"的假象掩盖。
- 不改 `memory-` / `postgres-execution-plan-admission-store.ts` 的不可变守卫——那个守卫本身是对的。

## Acceptance criteria（等 4D 根因结论后按此收口）

- [ ] **4D 根因结论回填本票**（围栏为什么在这两条旅程误判），并注明 commit
- [ ] **错误传播单独有结论**：围栏拒绝之后为什么变成 `IDEMPOTENCY_CONFLICT`；若确有重试路径，指名它在哪（file:line，署树）
- [ ] 商家侧文案与真实原因一致：因上下文漂移被拒时，商家看到的是关于**上下文/计划已变**的话，不是关于快照不可变的话
- [ ] 若围栏 code 对外可见，`http-errors.ts` 有它的状态映射（当前零命中）
- [ ] `v31-memory-injection-b2-journey` 与 `v31-ops-console-release-journey` 两条旅程转绿
- [ ] **变异反证**：人为置 `input.live.contextDrifted = true` ⇒ 商家侧必须收到上下文类错误而**不是**幂等冲突。改后立即还原，终态 `git status --porcelain` 空

## 留痕

- 开票：W4-D 三轮浏览器验收把 23 红归为两个单根因，本票为变体②；主控 2026-08-10 派 review-memory 落票，并明示「根因归 4D，票面先记症状与证据」。
- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`）：两条 spec 的日志逐条只读核证（围栏句与客户端幂等冲突句各自行号、两个不同 snapshot hash）；围栏抛出点按 `2da11d5ab` 署实为 `:419-422`（派件给的 `:420` 是 throw 行，guard 在 `:419`、文案在 `:422`）；查明客户端那句文案**两个 store 都有**（`memory-…:41-44` 与 `postgres-…:121`），故日志无法判定是哪一个产出，票面如实标注不猜。**新增三条本票自有的判断**：因果链是日志相邻推论而非证明（4D 不得把它当结论）；「错误与真实原因不符」是独立于根因的缺陷、须分别收口；`CONTEXT_FENCE_MISMATCH` 在 `http-errors.ts` 零命中说明它从未被设计成对外可见。本 commit 零代码改动。
