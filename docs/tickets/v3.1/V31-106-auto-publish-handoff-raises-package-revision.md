# V31-106 — 自动准备手机发布交接背着商家抬 ContentPackage revision：改写者，不再逐个读者打补丁

**Parent**: V31-105（观察债 ⑥）
**批次**: 产品缺陷（写者侧一次修净）
**Blocked by**: 无
**Related**: V31-105 §6/§7/§15、T20（`c6c8bc60b`）、p2 `:344`（`15e89bcfb`）、artifact-growth AC4（`428cec896`）、V31-104

**Status**: open（2026-08-23）— 同一缺陷已让三条旅程各打一次 spec 补丁（T20 / p2 :344 / artifact-growth AC4 :806），读者每多一个入口就再撞一次 CAS；裁决＝修写者（自动交接准备不得抬商家可见 revision，或 adjust 类 CAS 对「系统抬的 revision」免疫），不再靠测试兜

**Implementation state**: not started
**Verification state**: n/a
**Evidence SHA**:
**Workflow Run**:

## 现象（三次实测，同一形态）

package 一读到 delivered，workbench 立刻自动 `prepare_mobile_publish_handoff`；Core 在这次调用里记一条 `self_publish` approval receipt 并把 ContentPackage revision 抬一级。商家没有任何操作。随后任何「先读 revision 再提交」的写者都撞 CAS：

| 旅程 | 撞到的错 | 间隔 | 补丁 |
|---|---|---|---|
| T20 note-adopt | `CONTENT_PACKAGE_REVISION_CONFLICT` | ~0.5s | `c6c8bc60b`（command turn 内重读 revision） |
| p2 `:344` 自动发布交接 | `CONTENT_PACKAGE_REVISION_CONFLICT` | — | `15e89bcfb`（`adoptHarnessCandidateOnLatestRevision` 一次 refresh 重试） |
| artifact-growth AC4 `:806` result_adjust | `RESULT_ADJUST_REVISION_CONFLICT`「The Result changed before this adjustment was submitted.」 | **79ms**（`prepare_mobile_publish_handoff` 200 → `result_adjust_prepare` 409） | `428cec896`（spec 先等交接写落地） |

真实商家同样会吃到：Result Center「采用」走的也是 expectedRevision CAS，撞上就显示 "Refresh and retry"（`mkfast-template-main/src/product/results/use-result-center-view.tsx:761-773`）。同形态陈旧 CAS 还在 `tests/e2e/specs/video-native-compiler.spec.ts:233`、`image-intent-service-journeys.spec.ts:284`（尚未红）。

## 链路（file:line）

- 触发：`mkfast-template-main/src/product/agent-workbench/publish-handoff/use-publish-handoff.ts:155`（`enabled && phase === 'delivered' && packageId && workId`）→ `:185` effect 自动跑 → `:239` `prepareCanonicalHandoff({ expectedRevision: matched.revision, … })` → `delivery/delivery-entry-adapter.ts:61` 发 `operations.prepare_mobile_publish_handoff`。
- Core：`apps/core/src/p1/operations/foundation-module.ts:553` → `operations/publish-handoff.ts:369` `prepareMobilePublishHandoff`；注释 `:373-374` 明写「Merchant-self prepare is not OCC against the caller's snapshot: adoption may bump revision while Result Center and workbench both prepare」——即它自己知道会与其他写者竞争，却仍作为写者参与。
- 抬 revision 的写点：`publish-handoff.ts:659` `ensureCopyDeliveryApproval` → `:724-725` 追加 `approvalReceipts` → `:712` 审计 `content_package.approval_recorded`（`content-package-delivery.ts:1236` 同审计）。receipt 追加走 package 的常规写路径，因此 revision +1。

## 产品判断

「准备交接材料」是系统替商家做的**预取**，不是商家对内容的决定；它不该改变商家看到的包版本。商家的决定（采用／调整／我已发布）才是 revision 的来源。现状等于系统在商家每次进入结果页时都替他「改了一版」，然后让他为此 Refresh and retry。

## 修法（二选一，倾向 A）

- **A（写者不抬版本）**：self_publish approval receipt 改为 package 的附属记录（独立表或 `delivery_identity` 侧），不经 package 常规写路径，revision 不变；审计 `approval_recorded` 照记。`use-result-center-view.tsx:761-773` 的重试与三处 spec 补丁可保留为防御，不再是必需。
- **B（CAS 对系统版本免疫）**：package 增加 `merchantRevision`（仅商家动作递增），adjust/adopt/manual-result 的 expectedRevision 改比 `merchantRevision`。改面更大（合同＋前端读法），只在 A 证明不可行时选。

## 验收

1. 单测：delivered 后自动 prepare 一次，`contentPackage.revision` 不变，approval receipt 可查、审计行存在（先红后绿）。
2. 反向：把 receipt 写回常规路径，上面测试必红。
3. e2e：`v31-artifact-growth-journey` AC4 去掉「先等交接写落地」那段 poll 后仍两轮绿（证明读者补丁不再承重）；T20 / p2 `:344` 不动、照绿。
4. V31-105 §6 标「已修：<commit>」。
