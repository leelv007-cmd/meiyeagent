# V31-90 — Mid-run steering 解析权威：预备任务 id / Workbench 线程下取不到 sync run，但不得靠拆掉线程隔离来解

**Parent**: V31-16 P1 action boundary（mid-run steering）
**批次**: 遥测红队列（P1，required 已绿之后再做）
**Blocked by**: 无。**但受约束**：PR #4 合并前不动 `core-assembly.ts`（见「禁区」）
**Related**: V31-63（successor 锁序）、`docs/ops/ci-arbiter-gate-shrink-2026-08-14.md`（遥测不阻塞）、`docs/ops/master-handoff-required-green-2026-08-15.md`

**Status**: open（2026-08-15）— 诊断有效，但上一版修法（删线程作用域）已回滚：曾致跨 Work 串绑、required 由绿转红；接线契约已钉，PR #4 合并前不开工

**Implementation state**: open（上一版修法已回滚至绿锚点 `bb124004d` 的实现）
**Verification state**: unverified —— 但**反例已固化**：回归版本 `1c45089f6`、
CI run 31879784097（红）对照 run 31877687189（绿，18/18）
**Evidence SHA**:

## 真实缺陷（保留，不因回滚而作废）

`v31-mid-run-steering-journey` 长期红。已定位的机制是真的：

- 202 admission 记在**裸 taskId** 上，而 `startPrepared` 写的是 `${taskId}:plan-rN`；
- 浏览器有时传**已预备的 task id**（带 `:plan-rN` 后缀），有时带的是 **Workbench /
  legacy-work 线程**而非该 run 的线程；
- 于是 `resolveAuthority` 的 join 取不到 sync run，`mapSessionError` 把它翻成
  `INVALID_STATE`，商家侧表现为 mid-run 改稿不可用。

**这个诊断有效，是本票要解决的问题。**

## 为什么上一版修法被回滚（反例，必读）

`1c45089f6` 的解法是把隔离拆掉：

1. 删掉 `AND run.thread_id = $4`（线程作用域整个消失）；
2. 用 `steeringBindingMatchesAdmitted` 换成「仅当 snapshot_hash 非空且不同才拒」。

后果（CI run 31879784097 vs 绿轮 31877687189 对照）：

- `campaign-paid-work-confirmation.spec.ts`「一个 Campaign 下 Work 1 与 Work 2
  **各自独立**」由绿转红；
- Core 冒出绿轮零次的 `EvalLayerResult l0.5:make:composer-task:…:plan-r1 is
  immutable and already bound to different facts`；
- `production-main-journey` 由 18/18 全绿转红，**`required` 由绿转红**；
- 且 `steeringBindingMatchesAdmitted` 变成只剩自身单测引用——**生产已不走它，单测照绿**。

一句话：为了让一条**不阻塞**的遥测 spec 变绿，放宽了跨线程数据隔离，赔掉了 required 绿。

## 禁区（防复发）

- `apps/core/src/p1/agent-session/steering-authority-isolation.static.test.ts`
  已把「线程作用域 + 守卫在位」钉在接线层。**该契约红＝不许提交**，不是改测试。
- 任何放宽跨线程绑定的方案，必须先在本票里写清合同并配一条钉住
  **Work 间互不串**的测试；不得以「让 spec 变绿」为由静默放宽。

## What to build（约束下的解法方向）

要解的是「**同一线程内**，裸 id 与 `:plan-rN` 两种写法都能取到同一个 run」，
而不是「跨线程都能取」。可选方向（择一，实施前先在票下定稿）：

1. **归一化 id、保留线程作用域**：入口把 `taskId` 规范到 base 形态用于
   `submission.task_id` join，`run.workflow_id` 仍用 base/prepared 双匹配，
   **`AND run.thread_id = $4` 原样保留**。（最小改动，优先评估）
2. **线程等价类**：若 Workbench 线程确实是同一 Work 的合法门面，则显式定义
   thread↔work 的等价关系并在 join 里表达该等价，而不是取消条件。需要产品拍板
   「哪些线程算同一 Work 的门面」，并在契约测试里枚举。
3. 若两者都不成立，则改前端：steering 请求必须携带发起该 run 的线程 id。

## Acceptance criteria

- [ ] `v31-mid-run-steering-journey` 绿（遥测轮）
- [ ] `campaign-paid-work-confirmation`「Work 1/Work 2 各自独立」保持绿——**先红后绿证**：
      先构造跨 Work 串绑用例证明新合同能拒，再证正常路径通
- [ ] `steering-authority-isolation.static.test.ts` 绿；若方案改变了该契约，
      须在本票记录新合同原文与拍板人
- [ ] 同 SHA `Core quality / required` 绿（不得只凭本地绿证）

## 落地纪律

PR #4（required 绿收口）合并之前，本票**不开工**。遥测红按能力账本排队，
required 绿是优先级更高的资产。
