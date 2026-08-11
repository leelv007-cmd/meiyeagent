# V31-06 — Session repository/service + turn runner + policy 中间件挂点 + AgentKernel port

**Parent**: spec-B（#2）`docs/specs/v3.1-agent-specs-2026-08-08/spec-B-430-session-plan.md`；权威 V3.1 §18–§21
**批次**: 2 ｜ **语义锁**: 06/07/08 同域（Session Harness），建议单 lane 串行
**Blocked by**: V31-01, V31-02
**Status**: evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending

**Implementation state**: done
**Verification state**: evidence-debt
**Evidence SHA**: 1179cac5ef2660b4927e25179b6fc0b5a1640bcd
**Workflow Run**: 
**Artifact Digest**: 

## What to build

Agent Session Harness 核心：AI SDK streamText 工具环（AgentKernel port 薄封装，无 durable checkpoint），状态机 idle→…→handing_off；AgentTurnInput 最小投影（权限裁剪+上下文预算）；AgentTurnDecision Zod strict parse；策略中间件挂点（before/after model、wrap、wrap_tool_call 确定性拦截，控制动作 continue|end_turn|ask_merchant，执行序 pin 进 release）；System-only 动作提案层拦截；6 段摘要+retainedTail compaction（U4，Thread checkpoint 唯一 writer 在此）。

## Acceptance criteria

- [ ] 只读轮零付费副作用（didNotCall('record') 负向断言）
- [ ] System-only 动作拦截返回 {blocked,gateId,reason,nextAction}
- [ ] AgentControlLimits 从 release 冻结绑定读取，未标定项拒进生产路径（U11）
- [ ] compaction 失败保留上次摘要不阻断；checkpoint 单 writer 构造性检查（E lane working 切片经此落盘）
- [ ] partial output 只更新临时 Activity，repair 后替换同一 stable ID

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
