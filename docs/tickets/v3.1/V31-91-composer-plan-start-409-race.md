# V31-91 — 显式 start 间歇性 409 `COMPOSER_PLAN_START_FAILED`：确认落库与 /start 之间存在竞态

**Parent**: V31-16 P1 action boundary ／ Campaign paid Work（U7）
**批次**: 门稳定性（P1，直接影响 required 可用性）
**Blocked by**: 无
**Related**: V31-90（本票从其被撤回的因果指控中拆出）、`docs/ops/ci-arbiter-gate-shrink-2026-08-14.md`

**Status**: in progress（2026-08-16）— ①可区分**已合入 main**（`d95aef263`，经 PR #14）：十五处裸抛改为十五个码，下次红即可读出是哪一支；②定位竞态方、③不加重试 未动

**Implementation state**: step 1 merged（`d6ffb9b1b` + `6cb4cde4c`，合入 `d95aef263`）
**Evidence（门）**: `required` 八门全绿 @ `cbf6a9b31`（含 `core` 与 `core-persistence`）；
本地 `core` owner 全量 3815 测 0 fail；9 个 opt-in Postgres 套件在新建空库上 91 测 0 fail 0 skip
**Verification state**: unverified —— 失败模式已固化；下一次该 spec 变红即可读出是哪一支
**Evidence SHA**:
**Workflow Run**: 31879784097（`1c45089f6`）、31891110630（`f1ba27b8a`）

## 现象

`tests/e2e/specs/campaign-paid-work-confirmation.spec.ts:190`（辅助函数
`admitPromotionPosterMake`）断言显式 start 必须 202，实收 **409**：

```
{"error":{"code":"COMPOSER_PLAN_START_FAILED",
          "message":"Composer plan could not be started."}}
```

商家侧对应文案：`开始制作失败，请重试。`（`src/p1/merchant-p1-error.ts:12`）

## 为什么判为竞态而非回归

| Run | SHA | steering 线程作用域 | 该 spec |
|---|---|---|---|
| 31879784097 | `1c45089f6` | **已被删除** | 红（409，line 190） |
| 31891110630 | `f1ba27b8a` | **完好（回滚后）** | 红（409，line 190，同一行同一码） |
| 31877687189 / 31881895088 / 31884361098 / 31885101663 | 多个 | 完好 | 绿 |

同一失败模式在「有该改动」与「没有该改动」的树上都复现，且多轮绿——
**与 steering 改动无关，是间歇性的**。V31-90 初稿曾把它当作跨 Work 串绑的证据，
已在该票撤回。

## 已知的 409 语义（从产品代码读出，非猜测）

`/start` 在两种状态下返回 `COMPOSER_PLAN_START_FAILED` 409：

1. 任务**已在 mid-run**（`v31-artifact-growth-journey.spec.ts:791` 注释记录了这一条：
   对已在跑的任务点「开始制作」必得 409）；
2. **确认权威未决**就调用 start（`composer-home.tsx:859` 注释：parked paid Work
   会扣住 Make 并交回一个必须先由 Living Plan commit strip 决策的确认权威；
   漏掉它就会「start without a decision → 409」）。

所以竞态窗口在「确认决策落库」与「spec 发起 start」之间。

## What to build（先定位，勿猜修）

1. ~~**判别是哪一支**：在 409 的响应里区分「已 mid-run」与「确认未决」两种原因
   （现在两者共用一个错误码，日志里也分不出来）。这本身就是可交付的可观测性改进，
   并且商家侧「请重试」的建议只对其中一支成立。~~ **已完成（见上）。**
   注：落地时发现拒绝支不是两条而是**十五条**（`startPrepared` 十 ＋
   `completeExplicitStart` 五），上面「两种原因」的写法是严重低估。
2. **定位竞态方**：若是 spec 抢跑，则 `admitPromotionPosterMake` 应在 start 前
   等待确认权威进入 decided 态（等状态，不是 sleep）；若是产品侧决策提交后存在
   可见性窗口（写入已提交但读路径尚未可见），则属产品缺陷，须在 Core 侧收口。
3. **不要用重试掩盖**：给 start 加盲目重试会把「已 mid-run」那一支也一起吞掉，
   反而让真实死锁变成静默成功。

## ① 已完成（2026-08-16）：409 现在能报出是哪一支

`/start` 这条命令的**十五处**拒绝此前全是 `throw new Error(...)`。路由的兜底把任何抛出
统一压成一个 409（`apps/core/src/composer-plan-route-registrar.ts:88-100`，兜底码由
`:90` 模板字符串拼出——这就是为什么在 `apps/core` 里 grep 字面量
`COMPOSER_PLAN_START_FAILED` 一无所获），message 也被丢弃
（`apps/core/src/http-errors.ts:107-114`）。**更糟的是两对拒绝的 message 逐字相同**，
所以就算把 message 透出来也分不开它们。

改法：新增 `ComposerPlanStartRefusedError`（`code` + `status = 409` + 可选 `details`），
十五处各带一个码。`toHttpError` 对同时带 `code`/`status` 的抛出原样保留二者
（`apps/core/src/http-errors.ts:96-106`），因此 **HTTP 语义没动**——仍是 409，只是不再匿名。

### ⚠️ 十处只是一半：`completeExplicitStart` 里还有五处

只改 `startPrepared` 是不够的。它调用的 `completeExplicitStart`
（`apps/core/src/p1/agent-session/composer-plan-session.ts:671-763`）另有 **5 处裸抛**，
走的是同一个兜底。其中 `Explicit start requires latest plan revision N`
**正是本票假设的那种「修订号竞态」形状**——确认在商家读到方案与发起 start 之间提交了
新修订。把这五处留在匿名态，等于把头号嫌疑人留在黑箱里。所以本次一并编码。

所有行号相对**本 PR 合入后**的树（`startPrepared` 现为 `submission-coordinator.ts:710-886`）；
改动前的旧行号一律作废。

| 码 | 触发位（`submission-coordinator.ts`） |
|---|---|
| `COMPOSER_PLAN_START_UNAVAILABLE` | `:716` 协调器/planning 端口缺失 |
| `COMPOSER_PLAN_START_TASK_NOT_FOUND` | `:726` 按 task 读不到 submission |
| `COMPOSER_PLAN_START_FREEZE_NOT_CONFIRMED` | `:735` 无 freeze 或非 `merchant_confirmed` |
| `COMPOSER_PLAN_START_AUTHORITY_UNAVAILABLE` | `:741` 无 explicitConfirmations |
| `COMPOSER_PLAN_START_AUTHORITY_INCOMPLETE` | `:751` 确认端口方法不全 |
| `COMPOSER_PLAN_START_PLAN_AUTHORITY_MISMATCH` | `:769` planAuthority 与 freeze 不符 |
| `COMPOSER_PLAN_START_DISPATCH_ID_MISSING` | `:784` 缺 dispatch requestId |
| `COMPOSER_PLAN_START_REQUEST_MISMATCH` | `:800` authority.request 与 freeze 不符 |
| `COMPOSER_PLAN_START_NOT_DECIDED` | `:848` `authority.request.status !== "decided"` |
| `COMPOSER_PLAN_START_DECISION_NOT_CONFIRMED` | `:865` decision 缺失／换号／未 confirmed |

`completeExplicitStart`（`composer-plan-session.ts`）：

| 码 | 触发位 | details |
|---|---|---|
| `COMPOSER_PLAN_START_RUN_NOT_FOUND` | `:690` Run 取不到 | `resourceId`, `runId` |
| `COMPOSER_PLAN_START_PLAN_REVISION_STALE` | `:701` 请求修订号 ≠ 最新修订号（**头号嫌疑**） | `planId`, `requestedRevision`, `latestRevision` |
| `COMPOSER_PLAN_START_FREEZE_DRIFTED` | `:720` freeze 与最新 durable plan 对不上 | `planId`, `freezePlanId`, `freezeRevision`, `latestRevision` |
| `COMPOSER_PLAN_START_PLAN_NOT_READY` | `:747` readiness ≠ ready | `planId`, `readiness` |
| `COMPOSER_PLAN_START_RUN_STATE_UNSTARTABLE` | `:758` Run 状态不可开始 | `runId`, `runStatus` |

这五条原来的 message 里带着 `runId`／修订号——**正是排查竞态要用的信息**。换成商家话的同时
把它们挪进 `details`（`toHttpError` 会从 shaped error 上读 `details`，
`apps/core/src/http-errors.ts:99,191-197`），既没丢诊断也没泄给商家。

**已知残留**：`PLAN_NOT_READY` 一个码盖了所有 readiness 值（`blocked` /
`model_unavailable` …）。区分只在 `details.readiness` 里，而 `/start` 路由当前不透出
details，所以单看 HTTP 响应分不出是哪一种。商家侧建议对两者相同，故未再拆码；
若后续 ② 需要从 HTTP 响应直接读出，再拆。

message 全部换成商家话且**分因给建议**——`merchantMessageFromP1`
（`mkfast-template-main/src/p1/merchant-p1-error.ts:18-28`）会渲染未入表码的 message，
前提是不含内部标识符、不含连续四个拉丁字母。原来那句「请重试」对其中大多数是假的。

### ⚠️ 但商家在 Living Plan 这条路径上**还看不到**这些文案（本票不修，说明白）

`use-living-plan-controller.ts:151-152` 的 catch 把 `P1RequestError` 整个吞掉，
硬编码 `toast.error('开始制作失败，请重试')`。`readP1Envelope`（`p1/client.ts:116-129`）
其实**已经**用 `merchantMessageFromP1` 造好了商家文案并带 code 抛出，是这个 catch 丢的。
所以：

- **可观测性这一半是真的到手了**：Core 的响应体里就是具体码，e2e 断言失败时会把
  `body={"error":{"code":"COMPOSER_PLAN_START_..."}}` 原样打出来——这正是 ① 的验收点；
- **商家诚实这一半在这条路径上还没兑现**：商家仍看到那句对多数支为假的「请重试」。

这不归本票：**FIND-B-004**（`docs/reviews/agent-team-lane-fe-be-connectivity-2026-08-13.md:127-137`，
P1）已经把这个 catch 点名为缺陷，修复合同是「单一 `merchantErrorFromP1(code, status)` 表；
**白名单外永不渲染上游 `message`**」。注意那条合同与「靠 message 透传」相左——
若按它实施，正解是把这 15 个码加进 `CODE_COPY` 白名单，而不是依赖 fallthrough。
**码是耐久的那一半，message 只是白名单落地前的兜底。**

守卫：`apps/core/src/p1/execution-spine/composer-plan-start-refusal.test.ts`（6 测）——
四条钉源码性质（两个函数体内均无裸抛、≥15 个码、无重码、原本重复 message 的四支各只出现
一次、message 过得了商家渲染），两条钉真实链路（coded 拒绝穿过 `toHttpError` 后码/状态/
中文 message 三者都在；裸 `Error` 仍然坍缩成 `COMPOSER_PLAN_START_FAILED`——**后者是故意
留的**，防止将来有人靠放宽兜底来「修」红而不是给拒绝编码）。

守卫按**函数体花括号深度**取范围，不做全文件匹配：`if (!run) throw new Error(...)`
在 session 文件里出现三次，全文件改法会打到别的方法上（这个坑本轮真踩到了，两次）。

变异证：两个站点各改回一处裸 `Error`，守卫都由 6/6 变 `pass 4 / fail 2`。

改动波及的既有断言（都从「断文案」改成「断码」）：
- `composer-http.test.ts:1576` 原匹配 `/immutable confirmed decision/`，而那句 message
  **两支共用**，所以它本来就可能在错的分支上通过；
- `composer-plan-session.test.ts:1041` 原匹配 `/Composer Agent Run .* was not found/`；
- `composer-plan-session.test.ts:963` 原匹配 `/latest plan is blocked/`——改后仍断言
  `details.readiness === 'blocked'`，**保住它原本区分 blocked 与 model_unavailable 的能力**。

本地：`core` owner 全量 3815 测 0 fail（57 skip 为 Postgres 专属）、`tsc --noEmit` 干净。

### ⚠️ 一条必须写死的更正

我在轮次中说过「409 落到兜底，恰好证明不是 spec 猜的那两支」——**这是错的，别照着它推**。

落到兜底只证明**抛出未带类型**，推不出「不是被建模过的那两支」。因为：

- 「**确认未决**」这一支就是 `:848`／`:865` 两处，改动前**本身就是裸抛**。旧证据对它
  既不能证实也不能证伪。
- 「**已在 mid-run**」这一支的具体抛出点**本轮未定位**——`completeExplicitStart` 对
  `running`/`waiting`/`completed` 三态都是放行的（`composer-plan-session.ts:753-756`），所以那个 409 不是从这里
  出来的。既然没找到它是不是带类型的抛出，也就不能据兜底把它排除。

结论：旧的 409 证据对两支**都**没有排除力。① 落地后才第一次具备区分能力。

## ② 定位进展（2026-08-16）：两个原假设都不成立，真正的嫌疑在客户端身份

票面原本写的两支是「已在 mid-run」与「确认未决」。逐条读下来，**两个都不是**，
而且第二支的窗口根本不存在：

`decide` 走的是 `decisions.appendInTransaction`
（`apps/core/src/p1/agent-session/execution-confirmation-service.ts:672`），
追加的是**决策**。方案修订的写入方只有三处——`plan-compiler.ts:629`（编译）、
`:798`（调整）、`postgres-repriced-paid-execution-successor-builder.ts:194`
（**在 start 事务内**）。**`decide` 往返期间没有任何修订写入方**。

### 读出来的结构缺陷

| 事实 | 位置 |
|---|---|
| `activePlanRevision()` 经 `workbench.activePlanId` 取值——**一个全局指针** | `use-living-plan-controller.ts:18-24` |
| **每一个到达的方案修订事件都把 `activePlanId` 覆盖成自己的 planId**，最后到的赢 | `agent-event-reducer.ts:768,778,792,806` |
| 修订事件里**没有 task 身份**，reducer 也没有 task→plan 映射 | `living-plan-model.ts:50-89` |
| 于是客户端**在结构上无法**校验「全局活跃方案」属于它要启动的那个 task | 同上 |
| 修订号**按 planId 独立编号**，别的方案的号码对本方案毫无意义 | `plan-store.ts:52-57` |
| 值在点击瞬间取，`/start` 在一整个 `decide` 往返之后才发 | `:104` → `:121` → `:137` |
| 按钮的 enabled 只看额度/余额/readiness/权利/报价，**从不检查修订号是否为最新** | `commit-strip-model.ts:110-150` |
| 喂这个 store 的 outbox **自认滞后 ~1s**（为此设了 400ms×6 重放） | `use-living-plan-controller.ts:145-151` |

失败点是 `campaign-paid-work-confirmation.spec.ts:119`＝**Work 2 的 admit**，
发生在 Work 1 已经 start 之后——正是「另一个方案的事件刚到、`activePlanId` 指向它」
的时机。

### 剩下两个候选，以及怎么分开它们

1. **发错了方案的号**：`activePlanId` 指向 Work 1 的方案，号码随 Work 2 的 taskId 发出；
2. **同一方案但客户端落后**：号码是本方案的，只是 store 还没追上 Core。

两者**都**落在 `PLAN_REVISION_STALE`，只能靠数字分开：
`requestedRevision` 是否属于该 task 的 planId。

（另注：`set_session` 只在 threadId 变化时清空 `plans`／`activePlanId`
（`agent-event-reducer.ts:310-321`）。若两个 Work 分属不同 thread，store 会被清空、
`activePlanRevision()` 返回 `null`，症状是「方案还没有准备好」而**不是** 409——
这条尚未证否，是候选 1 成立的前提。）

### ⚠️ 更正：我说过 `details` 会「留在 Core 日志里」，那是错的

上一轮我把 `runId`／修订号挪进 `details` 时写了「既没丢诊断也没泄给商家」。
**诊断其实是丢了的**：`withErrorEnvelope` 根本不记日志
（`apps/core/src/http-errors.ts:117-150`），而这条路由也不传 `includeDetails`——
`details` 被写下、然后被丢掉，哪儿都看不到。

本轮补上：`composer-plan-route-registrar.ts` 在**一处**捕获
`ComposerPlanStartRefusedError`、`console.warn` 出码与 `details` 后原样重抛。
选择记日志而非透出 body，是为了让 `planId`／run id 不进入商家可见的响应。
守卫＝`apps/core/src/composer-plan-route-registrar.test.ts`（3 测，含
「数字不得进入 body」与「裸 Error 不记日志」两条反向断言）；变异证：摘掉日志 → 2 pass / 1 fail。

**下一次该 spec 变红，日志里就会有 `planId` / `requestedRevision` / `latestRevision`，
一轮即可在上面两个候选之间收敛。** 在那之前不猜修。

## Acceptance criteria

- [x] 409 能区分两种原因（错误码或 detail 字段），并有测试钉住 —— 实际做到**十五选一**，
      非两选一；见「① 已完成」
- [ ] 竞态方定位有据（trace／Core 日志），结论写入本票 —— **进行中**：两个原假设已证否，
      结构缺陷已定位，剩两个候选待一次红收敛（判别器已就位，见「② 定位进展」）
- [ ] （跨票）商家侧看到分因文案 —— 归 FIND-B-004，需把 15 个码并入
      `merchant-p1-error.ts` 白名单并让 Living Plan 的 catch 不再硬编码
- [ ] `campaign-paid-work-confirmation` 连续 **≥3 轮** required 绿（单轮绿不算，
      本票就是被单轮结论误判过的）
- [ ] 若判为产品缺陷：先红后绿证；若判为 spec 抢跑：改等待条件，不加 sleep

## 影响

该 spec 在 `production-main-journey` 内，属 **required** 的一部分——所以这条竞态
直接降低合并门的可用性（一次随机红＝一轮重跑）。与 `memory-vault-governance` 的
`selectComposerLens` 20s 超时（另一种间歇红）合并考虑：**required 的浏览器 job
当前不是「零抖动」**，这是 2026-08-15 的实测更正。
