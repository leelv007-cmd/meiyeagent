# V31-04 — Client reducer + Narrative/Activity Workstream + Controlled Surface Registry

**Parent**: spec-A（#1）；权威 V3.1 §27.6、§28、§0.5 红线
**批次**: 1（前端部分可归 frontend lane）
**Blocked by**: V31-01, V31-03
**Status**: ready-for-agent

## What to build

前端 event reducer（从 semantic 流重建 Thread 状态：乱序/重复安全、patch 失败回退 snapshot）+ 文档行 Narrative/折叠 Activity 的 Workstream 组件（非聊天气泡）；**Controlled Surface Registry 基础合同与负向门**：未注册组件/任意 HTML/className/component/action 一律拒绝，后续各票只注册自己组件。重连顺序按 §27.6（显式 taskId 优先，pending interrupt 优先）。

## Acceptance criteria

- [ ] reducer 断线重连/回放恢复唯一实现，patch 失败自动重取 snapshot（合同测试）
- [ ] arbitrary UI/component 拒绝合同测试（§37.1）
- [ ] 卡片减量：不显示空 Activity 或重复交付
- [ ] 不新增全局状态库（reducer + external store 小封装）
- [ ] 移动端过程/作品切换基础形态可用
