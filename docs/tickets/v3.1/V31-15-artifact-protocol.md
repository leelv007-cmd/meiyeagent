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
> **一行未填满，对应 AC 不得勾选。**

| AC | production writer | production consumer | failure-recovery test | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — |
