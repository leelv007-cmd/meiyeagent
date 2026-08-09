# V31-04 — Client reducer + Narrative/Activity Workstream + Controlled Surface Registry

**Parent**: spec-A（#1）；权威 V3.1 §27.6、§28、§0.5 红线
**批次**: 1（前端部分可归 frontend lane）
**Blocked by**: V31-01, V31-03
**Status**: done (merged, 2026-08-08)

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
> **一行未填满，对应 AC 不得勾选。**

| AC | production writer | production consumer | failure-recovery test | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — |
