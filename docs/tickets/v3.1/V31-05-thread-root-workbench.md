# V31-05 — Thread-root Workbench + recent 收编 + 基线采集 + A15/A16 验收

**Parent**: spec-A（#1）；权威 V3.1 §4–§5.1、§35 批次 1 退出门、§38
**批次**: 1（批次收口票）
**Blocked by**: V31-02, V31-04
**Status**: ready-for-agent

## What to build

Workbench 从 Work-root 改 Thread-root（保留 Work inline projection）：显式 threadId 优先恢复，无显式目标时由 WorkbenchSessionProjection 决定 Idle 或续接活跃 Thread；`/dashboard/recent` 收编为 Thread 列表投影（supersede D-088）；ai 与 @ai-sdk/react 大版本对齐；**采集当前漏斗与性能基线**（口径 §38，落 docs/ops 基线文件，供 §43.11/12 不劣化比较）。

## Acceptance criteria

- [ ] 刷新/换设备回同一 Thread 过程不丢（Playwright journey）
- [ ] 会话入口唯一：「最近」=Thread 列表，无两套历史
- [ ] 批次 1 退出门全过：多 Work/重连/lazy 打开/业务写路径零变化
- [ ] before 基线文件落盘（漏斗+延迟，数据窗口注明）
- [ ] A15 required CI job 聚合门与五 journey 门保持；A16 三态截图基线重拍（GAP L4-3/L4-4/A-5）
