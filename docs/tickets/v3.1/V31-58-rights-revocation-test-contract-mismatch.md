# V31-58 — 素材撤权旅程断错 UI 类型（test-contract mismatch）

**Parent**: V31-14 AC3（素材撤权 fail closed）的 browser evidence debt；旅程见 §37.4-F
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-29（已核对无实施交集）；V31-49（本 browser spec 的建票来源）
**Status**: resolved — test-contract mismatch（测试修复 `e183a97dc`，集成 merge `67ea5e5e7`；生产代码无需修改）

**Implementation state**: done
**Verification state**: verified
**Evidence SHA**: fa9b5240ce10e44eb861a43ebeb7a94cc171dea1
**Workflow Run**: 
**Artifact Digest**: 

## 根因结论

Wave-4 终审 v2 的红灯**不是 terminal 生产/传输/投影缺口**，而是 spec 断错了 UI 类型。素材撤权后，生产路径已正确渲染 `composer-report-card`，其 `data-report-kind="failure"`，`composer-report-reason` 内已有「授权已撤销」的商家可读原因。原 spec 却等待另一种 UI 合同 `composer-terminal-outcome`，所以在产品已正确出面时仍超时判红。

因此本票按 **test-contract mismatch** 收口：不改生产代码，只把旅程断言对齐已存在的 failure report 合同。该旅程对 V31-14 AC3 的真实浏览器验收仍归 **V31-14 evidence debt**；关闭 V31-58 不等于另行宣告 V31-14 全部 AC 已完成。

## 与 V31-29 的交集核对（结论不变）

本红**不归 V31-29**：

- 该 spec 从 `ui-journey.ts` 只导入 `selectComposerLens`，没有调用 V31-29 所有的 `submitComposerJourney` / `chooseImageTextDirection`，因此不经过那三处「失败终态可当成成功」的共享 helper。
- 原失败断言在 spec `:189-190`，没有 `.or(success)`、early return 或接受任意终态的假绿分支；它的问题是**选错产品已定义的 UI 类型**，不是 V31-29 的共享 helper 放宽。
- V31-29 的修改面仅是 `tests/e2e/fixtures/ui-journey.ts`；本票的修复面是单一 spec 的直接断言。

## 修复与证据

- 原红证据：集成树 `d3e29ee0f`，`scratchpad/w4d/w4-final-v2/round-per-spec/v31-rights-revocation-journey.log:143-170`；它证明原 spec 等不到 `composer-terminal-outcome`，不证明生产失败报告缺失。
- 诊断/修复 commit `e183a97dc`：`v31-rights-revocation-journey.spec.ts` 改断 `composer-report-card[data-report-kind="failure"]`，并在 `composer-report-reason` 内断「授权已撤销」；保留「无 delivery card」以及后续 refund、换素材恢复、只扣一次的原断言。
- 该 commit 只改 `mkfast-template-main/tests/e2e/specs/v31-rights-revocation-journey.spec.ts`（9 行 diff），**零生产代码改动**，这与「产品已正确渲染 failure report」的根因结论一致。
- 主控已将修复合入集成树：merge `67ea5e5e7`（`merge: align rights revocation journey with failure report`）。

## Acceptance criteria（V31-58 收口）

- [x] 根因定为 spec 把 failure report 错当成 terminal outcome，不立生产缺陷
- [x] spec 改为断言 failure report 类型与「授权已撤销」原因，没有放宽为任意失败态
- [x] 保留无交付、退款、换素材恢复与只扣一次的原旅程合同
- [x] 测试修复已以 `e183a97dc` 落地并由主控 merge `67ea5e5e7`；生产代码无改动

## 收口边界

- 本票关闭的是「为什么正确生产表现被 spec 判红」，不改动产品对 failure report / terminal outcome 的 UI 分类。
- V31-14 仍是 §37.4-F 完整 browser journey 证据的归属票；后续对集成树的完整转绿结果应回填 V31-14，不在 V31-58 重建一份 Evidence 表。
