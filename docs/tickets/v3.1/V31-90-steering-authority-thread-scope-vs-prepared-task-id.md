# V31-90 — Mid-run steering 解析权威：预备任务 id / Workbench 线程下取不到 sync run，但不得靠拆掉线程隔离来解

**Parent**: V31-16 P1 action boundary（mid-run steering）
**批次**: 遥测红队列（P1，required 已绿之后再做）
**Blocked by**: 无。**但受约束**：PR #4 合并前不动 `core-assembly.ts`（见「禁区」）
**Related**: V31-63（successor 锁序）、`docs/ops/ci-arbiter-gate-shrink-2026-08-14.md`（遥测不阻塞）、`docs/ops/master-handoff-required-green-2026-08-15.md`

**Status**: open（2026-08-15）— 诊断有效，上一版修法（删线程作用域）已回滚；**初稿「致跨 Work 串绑」的因果指控已撤回**（同一 409 在干净树复现，拆出 V31-91），回滚依据只剩设计面；接线契约已钉

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

**2026-08-16 CI 实例（与上述机制逐字对上）**：run `31933812189` 的
`v31-browser-report`（job `95132566168`，advisory 非 `required`）报
`V3.1 remaining-file verdicts: 21 passed, 1 failed, 0 instrument`——
**唯一那条红就是本票的 journey**：

```
v31-mid-run-steering-journey.spec.ts:159
  Error: steering_submit failed: 现在还不能继续这一步，请稍后重试。
```

那句文案是 `merchant-p1-error.ts` 的 `INVALID_STATE`，正是上面第三条说的
「`mapSessionError` 把取不到 sync run 翻成 `INVALID_STATE`」在商家面的落地形态。
`0 instrument` 说明这一轮**不是**仪器故障截断（同轮 `p2-browser-acceptance` 才是），
所以这条红是真红。

已核**不是本轮改动引入**：`INVALID_STATE` 在 `meiyeagent/main` 上就存在
（`merchant-p1-error.ts:9`），FIND-B-004 那次提交（`c9f3183c0`，只加
十五个 `COMPOSER_PLAN_START_*`）的 diff 里没有任何 `INVALID_STATE` 行。

## 为什么上一版修法被回滚（反例，必读）

`1c45089f6` 的解法是把隔离拆掉：

1. 删掉 `AND run.thread_id = $4`（线程作用域整个消失）；
2. 用 `steeringBindingMatchesAdmitted` 换成「仅当 snapshot_hash 非空且不同才拒」。

### 回滚的真实理由（2026-08-15 二次更正——初稿的因果指控已撤回）

初稿把 `1c45089f6` 上 `campaign-paid-work-confirmation`（「Work 1 与 Work 2 各自
独立」）的红指为「跨线程串绑」的后果。**该指控不成立，予以撤回**：

- 那次红的失败模式是 `admitPromotionPosterMake` 显式 start 收到 **409
  `COMPOSER_PLAN_START_FAILED`**（期望 202），不是任何跨 Work 数据串扰；
- 同一行、同一 409，在**线程作用域完好**的干净树上照样复现（run 31891110630 @
  `f1ba27b8a`，该树 steering 部分＝回滚后版本）。因此它是与本票无关的
  **间歇性竞态**，已另立 **V31-91**；
- 同理，`L0.5 … already bound to different facts` 日志在干净 main（run
  31890594956）上同样出现，**不是该改动引入的**。

**回滚仍然成立，但依据只剩设计面，不含实证**：

1. 该改动放宽了跨线程绑定边界，却没有任何合同或测试说明「哪些线程算同一 Work
   的合法门面」——放宽隔离必须先定义等价关系，不能靠删条件；
2. 它**从未达成自己的目标**（下节：五轮里 mid-run-steering 全红）；
3. `steeringBindingMatchesAdmitted` 被架空后只剩自身单测引用——**生产不走它、
   单测照绿**，这类「守卫静默失联」正是接线契约要挡的。

**方法论教训（本票已连犯两次）**：`required` 的浏览器 job 本身有实质抖动，
单轮「改动 X → spec Y 变红」不构成因果。要下因果结论，先取 ≥3 轮样本，
再比对**失败模式**（错误码／堆栈位置），而不是只比对红绿。

### 而且它连目标都没达成（关键，勿重试该方向）

五轮遥测 verdicts 全表（`v31-file-verdicts.log`，同一份 22 spec catalog）：

| SHA | 说明 | 通过/失败 | mid-run-steering（改动目标） |
|---|---|---|---|
| `bb124004d` | 绿锚点 | 19 / 3 | 红 |
| `1c45089f6` | 删线程作用域＋e2e picker 重写 | 19 / 3 | **仍红** |
| `0ce061f95` | 只回滚 Core | 17 / 5 | 红 |
| `a5212ad42` | ＋opt-in 账本 | 18 / 4 | 红 |
| `a69ea7740` | 再回滚 e2e，树＝锚点＋契约 | 17 / 5 | 红 |

**目标 spec 在五轮里全红**，无论怎么改。所以「join 取不到 sync run」不足以解释
mid-run steering 的红：接手时须先重新做根因定位（读 run 级 trace／Core 侧
`INVALID_STATE` 实际抛出点），**不要从「放宽匹配条件」这一族方案起手**。

### 更正：不要把单轮遥测差值当因果（2026-08-15 自我更正）

本票初稿曾断言「删线程作用域连带压红了 `v31-artifact-growth-journey`」。
**该结论被 `a69ea7740` 推翻**：e2e picker 改动已回滚、代码树等于锚点，
artifact-growth 仍红。跨五轮统计，只有 `v31-mid-run-steering-journey` 与
`v31-ops-console-release-journey` 是**稳定红**；`rights-revocation`（红 4/5）、
`artifact-growth`（红 4/5）、`video-paid-execution`（红 2/5）、`v31-83`（红 1/5）
都翻转过。

**这条遥测的运行间方差是真实存在的**。因此：

- 追某条遥测红之前，先取 **≥3 轮样本**确认它稳定红，否则会去修一个抖动；
- 单轮「某改动让 X 变红/变绿」不构成因果证据——本票初稿就是这么错的；
- 唯一可靠的即时判据仍是 `required`：它的八个 job 跨五轮零抖动（唯一一次
  root-quality 红经同 SHA 重跑即绿）。

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
