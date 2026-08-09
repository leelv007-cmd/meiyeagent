# V31-03 — Semantic Event Projector（三帧扩展）+ snapshot/replay

**Parent**: spec-A（#1）；权威 V3.1 §27
**批次**: 1
**Blocked by**: V31-01, V31-02
**Status**: done (merged, 2026-08-08)

## What to build

基于现有 workflow progress/token/state 三帧扩展统一 Semantic Event Projector：各领域经 outbox 产出 semantic 事件，Projector 赋 per-thread 单调 streamOffset（domain bigint / wire decimal string）；contextRole: included|excluded|summarized；ephemeral 帧发射侧标 transient 绝不落库；snapshot+replay 恢复链（session projection → StateSnapshot → lastEventId 回放）。影子事件不改 Task/账单/UI。

## Acceptance criteria

- [ ] snapshot+replay 等价断言：乱序/重复/跨 thread 隔离全过（主 seam：P1 action + SSE 事件流）
- [ ] ephemeral 不落库的构造性检查（逐 token 零 PostgreSQL 写）
- [ ] wire/domain schema 分离，游标按数值序
- [ ] AG-UI 仅输出 adapter，内部 domain event 不用 AG-UI enum
- [ ] 影子运行期现有 UI/账单零变化

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
| AC5 | — | — | — | — | — | — |
