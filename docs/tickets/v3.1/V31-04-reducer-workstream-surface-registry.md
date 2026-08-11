# V31-04 — Client reducer + Narrative/Activity Workstream + Controlled Surface Registry

**Parent**: spec-A（#1）；权威 V3.1 §27.6、§28、§0.5 红线
**批次**: 1（前端部分可归 frontend lane）
**Blocked by**: V31-01, V31-03
**Status**: done (merged, 2026-08-08)

**Implementation state**: done
**Verification state**: verified
**Evidence SHA**: bdedef710e886246b452cb41bc7499e073c4faea
**Workflow Run**: 
**Artifact Digest**: 

## What to build

前端 event reducer（从 semantic 流重建 Thread 状态：乱序/重复安全、patch 失败回退 snapshot）+ 文档行 Narrative/折叠 Activity 的 Workstream 组件（非聊天气泡）；**Controlled Surface Registry 基础合同与负向门**：未注册组件/任意 HTML/className/component/action 一律拒绝，后续各票只注册自己组件。重连顺序按 §27.6（显式 taskId 优先，pending interrupt 优先）。

## Acceptance criteria

- [ ] reducer 断线重连/回放恢复唯一实现，patch 失败自动重取 snapshot（合同测试）
- [ ] arbitrary UI/component 拒绝合同测试（§37.1）
- [ ] 卡片减量：不显示空 Activity 或重复交付
- [ ] 不新增全局状态库（reducer + external store 小封装）
- [ ] 移动端过程/作品切换基础形态可用

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
