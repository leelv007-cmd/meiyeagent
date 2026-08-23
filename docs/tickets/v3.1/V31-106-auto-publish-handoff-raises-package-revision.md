# V31-106 — 自动准备手机发布交接背着商家抬 ContentPackage revision：改写者，不再逐个读者打补丁

**Parent**: V31-105（观察债 ⑥）
**批次**: 产品缺陷（写者侧一次修净）
**Blocked by**: 无
**Related**: V31-105 §6/§7/§15、T20（`c6c8bc60b`）、p2 `:344`（`15e89bcfb`）、artifact-growth AC4（`428cec896`）、V31-104

**Status**: open（2026-08-23）— 按方案 A 修净：self_publish receipt 改走附属写路径，不再抬商家可见 revision；本地单测/契约/整文件 e2e 两轮全绿，待推分支跑 CI 后转 fixed

**Implementation state**: implemented locally（`33f0b5869` fix，`34a4dc9ee` 撤 AC4 读者补丁）
**Verification state**: unverified（本地全绿；CI 未跑，opt-in 持久化收据待主控在终态重录）
**Evidence SHA**: 34a4dc9eefaebb28a5eda8be6a4a40a2612410c9
**Workflow Run**: pending（分支 `claude/v31-106-impl` 未推）

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

## 落地（2026-08-23）

**改法（方案 A）**：`publish-handoff.ts:659` `ensureCopyDeliveryApproval` 的写点由 `saveContentPackageRevision` 换成新增的 `saveContentPackageAuxiliaryRecord`（`operations-hot-path.ts` 新增 `ContentPackageAuxiliarySave` 与 `ContentPackageHotPath.saveContentPackageAuxiliaryRecord`；实现在 `repository.ts`（Memory）与 `postgres-repository.ts` / `postgres-content-package-write-adapter.ts`）。receipt 照旧追加进 `approvalReceipts`、审计照旧记 `content_package.approval_recorded`，**只是 revision 不动**。

**receipt 依赖面（按票面要求先查再动，结论＝不删投影）**：Result Center（`use-result-center-view.tsx`）、manual result、合同 `contentPackageSchema.approvalReceipts`（`packages/contracts/src/content-package.ts:665`）都从 package 视图读 receipt。因此 receipt **保留在 package 行上**，改的只是「这次写不抬版本」，读者一个都不用改。

**为什么不是同版本随便写**：不抬 revision ≠ 不校验 revision。附属写仍以 revision 作 CAS token（商家在此期间的写照样赢），并由 `validateContentPackageAuxiliaryWrite`（`content-package-semantic-mutation-policy.ts`）逐条限定：只准追加自己那条 approval receipt 和 `updatedAt`，既有 receipt 必须原样按序返回，聚合其余字段一律不得变——否则同版本写就是乐观并发的一个洞。

**验收对照票面四条**：
1. 单测 `V31-106: auto prepare records the self-publish approval without moving the merchant-visible revision`（`publish-handoff.test.ts`）：先红（`2 !== 1`）后绿；receipt 可查、`content_package.approval_recorded` 审计行存在。整文件 26/26。
2. 反向对照：写点改回 `saveContentPackageRevision` 后，整文件唯一红就是上面这条（`/tmp/v106-reverse-control.log`），确认是该写点在抬版本。
3. e2e：`428cec896` 加的「先等交接写落地」poll 已在 `34a4dc9ee` 单独一条撤掉，`v31-artifact-growth-journey` 整文件两轮绿（日志见下）。T20 / p2 `:344` 一字未动。
4. 契约面：`operations-hot-path.contract.ts` 新增附属写用例，Memory 与 Postgres 两个适配器同跑（含三条拒绝：陈旧 revision、改动聚合其余字段、抹掉既有 receipt）。

**第二写点同修（2026-08-23，用户裁决当轮补做）**：`publish-handoff.ts:741` `ensureCanonicalAssistedDelivery`（导出／canonical 路径）是同一缺陷的另一半——它记的同样是系统预取（self_publish receipt ＋ 指向它的 `assisted_handoff_prepared` 事件），却同样抬 revision。已按同一改法切到 `saveContentPackageAuxiliaryRecord`。因该路径要追加 `deliveryEvents`，附属写策略相应扩为「`approvalReceipts` 与 `deliveryEvents` 两个数组都只准追加、既有元素必须原样按序返回」，聚合其余字段仍一律不得变。对称单测 `V31-106: canonical prepare records the assisted handoff without moving the merchant-visible revision` 先红后绿（反向对照见 `/tmp/v106b-reverse-control.log`，写回常规路径后整文件唯一红即该测），整文件 27/27。此路径此前无人撞过 CAS，是趁手关掉，免得下一个读者用 T20／p2 `:344`／artifact-growth AC4 的方式再发现一次。

`content-package-delivery.ts:403` 的写点属商家「我已发布」动作，抬版本是对的，不在此列。
