# V31-12 — ExecutionPlanSnapshot + admission 绑定 + DBOS 复验 + stale/expiry

**Parent**: spec-C（#3）；权威 V3.1 §14.2、§22.3、U9
**批次**: 3
**Blocked by**: V31-11
**Status**: done (merged, 2026-08-08)

## What to build

编译定稿冻结执行内容并算 snapshotHash（不含 confirmationDecisionRef）；确认请求持 hash 作锚；快照行在 task-admission 一次性写入（merchant_confirmed 带 decisionRef / policy_exempt_copy 免确认不免冻结）；DBOS 运行前复验（verification→context/rights fence）；确认后关键事实/权利/费用变化→stale+diff+重确认；legacy durable task 走独立 replay 分支，layout 不兼容 fail closed。

## Acceptance criteria

- [ ] fidelity=100%：确认的方案与执行逐字段一致（退出门）
- [ ] 纯 copy 路径同样按冻结 plan/quote/release 执行（U9）
- [ ] stale 确认拒绝；mismatch fail closed
- [ ] 重放不重复创建 Task/扣费（at-least-once 幂等）
- [ ] legacy replay 分支可恢复且与新链无双写

## Evidence

> 空表由 L-CI 脚手架落盘，**Wave 4 对着真实证据填**。填表规则（机器可判优先）：
> `AC<n>` 对应「Acceptance criteria」小节里第 n 个 checkbox 条目，顺序固定；id 列只写
> `AC<n>`，不加任何修饰。writer / consumer 写 `path/to/file.ts:line`。PG result 与
> Playwright result 写真实结果（如 `12/12 pass`）；没跑就留 `—`，不写「应该通过」之类
> 的推测。required CI job 写 `.github/workflows/core-quality.yml` 里的 job 名。
> 单元格内的 `|` 必须转义成 `\|`。空值统一写 `—`。
> **三个结果列各守一轴，不得跨轴填**：`unit/eval result` 只收单测与离线评测结果，
> `PG result` 只收真实 Postgres 套件结果，`Playwright result` 只收浏览器旅程结果。
> 把 `biome` / `tsc` / 单测结果写进 `Playwright result` 属跨轴，须改回本轴。
> 三个结果列的空值分三种，必须区分：`—`＝该格未填（脚手架初始态）；`n/a`＝该 AC 在该轴上
> **没有**证据要求（须在表下用一句话说明为何没有）；`未跑`＝该轴有要求但本轮未执行（须写出
> 未执行的原因）。writer / consumer / failure-recovery test / required CI job 四列的空值
> 仍统一写 `—`。
> **勾选规则**：writer / consumer / failure-recovery test / required CI job 四列非空，**且**
> 三个结果列每一格都是真实结果或 `n/a` ⇒ 方可勾选。任一结果格为 `—` 或 `未跑` ⇒ 不得勾选。
> （原规则是「一行未填满，对应 AC 不得勾选」。在只有 PG / Playwright 两个结果列时，它把
> 「本来就不该有 PG 证据的 AC」也判成未验收——列集扩展史见 V31-29「Evidence」节末。）

| AC | production writer | production consumer | failure-recovery test | unit/eval result | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — | — |

## Wave-4 归档：4A 修复归本票（`d83bbdbca`，2026-08-10 review-memory 落）

**每一个新付费任务都死在 workflow 第一步**，根因正是本票定下的那条合同被上游误用了。

`d83bbdbca`（`fix(harness): scope the pre-run admission verify to the pre-admitted snapshot branch (4A)`）的 commit message 逐字点名本票：workflow 顶部的 `execution-plan-snapshot-verification` step 对**每一个**非 legacy 回放分支都无条件调 `executionPlanAdmission.verifyAdmittedForDbos()`，但 **`pending_confirmation` 分支在那一刻按设计根本还没被 admit**——**V31-12 把付费媒体的 admission 推迟到确认门**，那道门在同一个 workflow 体内、商家决定之后才跑（`admitExecutionPlanSnapshot` 一次完成 admit＋verify）。于是 verify 去查一行还不存在的记录，在确认卡被建出来之前就抛 `NOT_FOUND`。

**修法（option A，已裁）**：把 verify 调用收窄到 `replayBranch.branch === 'execution_plan_snapshot'`——即 `task-admission.ts` 在 workflow 启动前**同步** admit 的那一支。未增删或改名任何 step，index 未变。同一个 registration 函数里更靠下的第二处独立验证 checkpoint 本来就做对了（对 `pending_confirmation` 早退，从不走到 admission verify），本次修复是把上面那处**对齐到已经正确的那处**。

**回归证据（commit message 自带）**：`dbos-workflow.test.ts` 全量 51/51 pass；`dbos-registration.smoke.test.ts` 在一次性新库上**带与不带本修复各跑一次**，两次都是 **12 pass / 7 fail** 且按用例名排序后 diff 为空——即那 7 个失败与本修复无关（见 V31-48）。

**对本票的含义**：本票的合同（付费媒体延迟 admission 到确认门）**没有被改动**，被修正的是上游对它的误用。故本票语义不变，只是补上这条「合同被误用一次、已按合同收窄」的归档记录。

