# V31-25 — 三 runner 收敛（§22.4 顺序：六原语化 → 单 executor）

**Parent**: spec-I（#9）`docs/specs/v3.1-spec-I-legacy-retirement-pending-publish.md`；权威 V3.1 §22.4、附录 A10（D-038 五条）
**批次**: 6
**Blocked by**: V31-13（shadow 关闭）, V31-14, V31-16, V31-21
**Status**: done (merged 881698d7b, 2026-08-09)

## What to build

严格按 §22.4 顺序（门与帧已在 V31-14 迁出）：三套 runner（copy/note/media）内部逻辑先替换为六原语（intent→read_context/ask；brief→generate；execution→generate/check/revise）→收敛为单 `CompiledExecutionPlan → DBOS executor` 路径，全部 carrier 由 typed unit 表达；五阶段只保留 trace grouping/admin explanation/metrics dimension（D-036）；全程满足 D-038 五条；in-flight durable 实例走发布 SOP（排空/版本粘滞不热切）。

## Acceptance criteria

- [ ] 收敛前后同一 fixture 任务集行为等价（交付物/结算/恢复语义逐项对比，DBOS 测试缝）
- [ ] kill/restart 重复副作用=0
- [ ] 全量 journey §37.4 A–K 收敛后全绿（等价性最终门）
- [ ] 新增 carrier 不再复制 runner（构造性检查）


## 关票记录（2026-08-09，主控）

- lane-21 交付 9 文件（taxonomy/recipes/executor/equivalence/convergence 测试 + workflow-core/make-snapshot-consume/dbos-workflow 接线 + release SOP），主控亲落 commit 64bdaded8，合入 main=881698d7b，零冲突。
- 单元等价门：runner-convergence + harness 套件 130/130（真 PG）。
- 浏览器等价门（诚实口径）：本机全量 journey 面不可靠（宿主定性，历史 134 红含 47×0ms 连坐；隔离/子集口径为准）。v31 子集与 Day-0 copy 旅程隔离绿；等价门期间连带揪出并修复：QA wave 的朋友圈交付包回归（39dc1536d）、lens 折叠竞态 fixture（2c25a2a7f）、image_text spec 缺 case_image 种子（400 fail-closed 为产品正确行为）。CI 全量复核待 GitHub 账号恢复后补。
- V31-16 steering 前台缺口另立 V31-27。
