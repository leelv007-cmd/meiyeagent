# V31-15 — Artifact protocol（snapshot/delta）+ 原位生长 + registry 注册

**Parent**: spec-D（#4）`docs/specs/v3.1-agent-specs-2026-08-08/spec-D-433-delivery.md`；权威 V3.1 §5.5、§24.1、§27.5
**批次**: 4（frontend 部分可归 frontend lane）
**Blocked by**: V31-03, V31-04
**Status**: done (merged, 2026-08-08)

## What to build

右栏稳定 Artifact 原位生长（同一 artifactId reconciliation）：图文逐页（骨架→文案→配图状态）、视频逐场景（分镜/关键帧/字幕/封面）；ArtifactUpdate wire=discriminated union {mode:'snapshot',full}/{mode:'delta',baseRevision,patch}，patch schema 按 artifactType 受控；同 revision 重放幂等、跳 revision 退回取 snapshot；渲染组件全部注册 Controlled Surface Registry；已完成内容永不静默覆盖（修改产生派生版本）。

## Acceptance criteria

- [ ] artifact stable id 断言：重复对象率=0
- [ ] SSE round-trip：乱序/重复/跳 revision/断线重连全过（delta 失败回退 snapshot）
- [ ] 移动端 Artifact 全屏 Sheet 可用
- [ ] 版本回看可达（派生版本不覆盖）

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
