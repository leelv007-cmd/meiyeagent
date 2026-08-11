# V31-05 — Thread-root Workbench + recent 收编 + 基线采集 + A15/A16 验收

**Parent**: spec-A（#1）；权威 V3.1 §4–§5.1、§35 批次 1 退出门、§38
**批次**: 1（批次收口票）
**Blocked by**: V31-02, V31-04
**Status**: done (merged, 2026-08-08) — 遗留：A16 三态截图基线重拍、基线真数待 analytics 导出后跑 collector --mode=from-export

**Implementation state**: done
**Verification state**: verified
**Evidence SHA**: 8fee67ff83b711ccb5158beba71c7436e6d31a4d
**Workflow Run**: 
**Artifact Digest**: 

## What to build

Workbench 从 Work-root 改 Thread-root（保留 Work inline projection）：显式 threadId 优先恢复，无显式目标时由 WorkbenchSessionProjection 决定 Idle 或续接活跃 Thread；`/dashboard/recent` 收编为 Thread 列表投影（supersede D-088）；ai 与 @ai-sdk/react 大版本对齐；**采集当前漏斗与性能基线**（口径 §38，落 docs/ops 基线文件，供 §43.11/12 不劣化比较）。

## Acceptance criteria

- [ ] 刷新/换设备回同一 Thread 过程不丢（Playwright journey）
- [ ] 会话入口唯一：「最近」=Thread 列表，无两套历史
- [ ] 批次 1 退出门全过：多 Work/重连/lazy 打开/业务写路径零变化
- [ ] before 基线文件落盘（漏斗+延迟，数据窗口注明）
- [ ] A15 required CI job 聚合门与五 journey 门保持；A16 三态截图基线重拍（GAP L4-3/L4-4/A-5）

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
