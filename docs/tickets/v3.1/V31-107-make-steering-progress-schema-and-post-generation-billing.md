# V31-107 — make-steering 完整修：进度表补 label/page_index，分类器读真进度，§5.6「页已生成后」计费口径重裁

**Parent**: V31-105 §1（B 止血已在 `claude/steer-id` 落地；本票是 A）
**批次**: 产品＋schema（用户 2026-08-23 裁决：B 先上、A 另票）
**Blocked by**: V31-105 §1 B 合入
**Related**: V31-90、V31-16/27（steering 合同）、§5.6

**Status**: open（2026-08-23）— 止血版只对齐两端 task_id 并把分类器不命中降级为「整篇处理」；本票补进度表 label/page_index、让 `steeringUnitLabel`/`inferAffectedFromInstruction` 命中真页，并重裁页已生成后的计费：**建议口径＝已生成页重做按页计费、未生成页免费改向**（待用户终裁）

**Implementation state**: not started
**Verification state**: n/a
**Evidence SHA**:
**Workflow Run**:

## 前因

- `p1_make_steering_task_progress` 只有 `(workspace_id, task_id, unit_id, status)`，无 label / page_index。对齐 key 后 `steeringUnitLabel`（`steering-service.ts:349-359`）对 `page-1` 只能返回「这一步」；`inferAffectedFromInstruction` 的 `unitsByPage` 靠 pageIndex、`findCoverUnit` 兜底靠 `/cover/i`，都不命中 → B 版降级为整篇处理（不再拒绝）。
- §5.6「页已生成后」的 rebilled/settled 口径未裁：页已生成再改，是重做该页（补扣）还是免费？现状回读「不额外算积分」是建立在 progress 恒空的假乐观上。

## 范围

1. schema：进度表加 `label`、`page_index`（migration＋写点 `workflow-core.ts:2548` / `dbos-workflow.ts:1830` 一并写入）。
2. Core：`steeringUnitLabel` 与分类器读真进度；B 版「整篇处理」降级保留为兜底。
3. 计费：按裁定口径实现——已生成页重做＝按页预留/结算（复用现有 quote/settle），未生成页改向＝0；回读文案明示「这一页会重做，预计 N 分」。
4. 合同：§5.6 文本与 `packages/contracts` steering authority 字段同步。

## 验收

- 带库单测：进度行带 label/page_index；「封面不要写最后两个名额」命中封面页而非整篇；页已生成后 authority 回读含重做计费；未生成页回读 0 分。先红后绿＋反向对照。
- e2e `v31-mid-run-steering-journey` 两轮绿，另加「页已生成后改封面」一腿。
- V31-105 §1 标「A 已修」。
