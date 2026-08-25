# V31-107 — make-steering 完整修：进度表补 label/page_index，分类器读真进度，§5.6「页已生成后」计费口径重裁

**Parent**: V31-105 §1（B 止血已在 `claude/steer-id` 落地；本票是 A）
**批次**: 产品＋schema（用户 2026-08-23 裁决：B 先上、A 另票）
**Blocked by**: V31-105 §1 B 合入
**Related**: V31-90、V31-16/27（steering 合同）、§5.6

**Status**: 已修待关

**Implementation state**: 已修待关（schema label/page_index + 分类器读真进度 + 已生成页按页报价；e2e 见票底）
**Verification state**: local-verified（unit + postgres + v31-mid-run-steering-journey 三腿绿）
**Evidence SHA**: 3b5ce927a68393ae44d50353c14982ca414d3bde
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

- [x] 带库单测：进度行带 label/page_index；「封面不要写最后两个名额」命中封面页而非整篇；页已生成后 authority 回读含重做计费；未生成页回读 0 分。先红后绿＋反向对照。
- [x] e2e `v31-mid-run-steering-journey` 三腿绿（isolated PORT=3312 / CORE=4312 / 54329 `meiye_lane_v31107_e2e`）：未生成页免费改向、replan+requote、页已生成后改封面按页计费。
- [x] V31-105 §1 标「A 已修」。

## 实施记录（非 GitHub）

**Status → 已修待关**

- schema：`p1_make_steering_task_progress` 加 `label` / `page_index`（`PostgresSteeringCommandStore.migrate` `ADD COLUMN IF NOT EXISTS`）；`recordTaskProgress` 写入；`getTaskProgress` 回读。Memory store 同形。
- 写点：`MakeUnitCursor.units`；`createNotePageSteeringBoundaryTracker` / `createNotePageProgressReporter` 经 `notePageMerchantUnits`（1-based `notePageOrderLabel` → 0-based pageIndex，封面/第N页）。`dbos-workflow` 全终态 cursor 允许无 label。
- 分类：progress 带 label/page_index 后「封面不要写最后两个名额」命中封面；B 整篇兜底保留。反向：剥掉 label/page_index → 整篇。
- 计费：已生成页 `rebilled=true`，feeNote 用 `quoteAuthority.resolve` 的 `creditCost`（「并计 N 积分」）；未生成页 `rebilled=false` / 不额外算积分。无 quote 不猜数字。D-061。
- 合同：`steeringUnitProgressSchema`；§5.6 文本按 2026-08-23 终裁改写。
- **Evidence SHA**：`3b5ce927a68393ae44d50353c14982ca414d3bde`（实现 commit）。e2e 三腿绿见本分支 follow-up（fixture 在第一页 success 后短暂停住，避免整单瞬间 delivered 拆掉中途入口）。
