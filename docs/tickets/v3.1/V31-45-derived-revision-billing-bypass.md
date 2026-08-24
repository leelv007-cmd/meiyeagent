# V31-45 — derived_revision 直写路径不报价不计费，与商家文案承诺矛盾

**Parent**: V31-16（Make Steering）／计费一致性
**批次**: post-merge
**Blocked by**: None — 可独立开工（但见下「语义锁」）
**Status**: 已修待关

**Implementation state**: 已修待关（closeout：方向 2 已在 main，本票钉死测试 + D-179）
**Verification state**: local-verified（unit + static；Evidence SHA 见下）
**Evidence SHA**: 7d5901bf745238edfae7e8eb95548183f5eca018
**Workflow Run**:
**Artifact Digest**: 
**发现于**: L-T8C（Task 8）review-steering 二轮反驳复核留档，2026-08-09
**锚署树**: 全部 `file:line` 锚定 `codex/v31-fix-steering` @ `2c1913a18`（worktree `美业内容2-v31-fix-08`）。行号会随合并漂移，合并后请以符号名重新定位。

## 问题

`derived_revision` 分类有**两个**已接线的消费者，一个计费、一个不计费，而**不计费的那个优先级更高**。

`consumeDerivedRevision`（`apps/core/src/p1/agent-session/steering-service.ts:1091-1127`）按顺序选择：

```
:1096   if (authority && this.actionConsumers?.derivedRevision) { … return 'completed' }   ← 不计费
:1104   if (this.actionConsumers?.derivedWorkflow) { … }                                   ← 计费
```

- **`:1096` 直写路径**：走 `steeringDerivedRevisionActionConsumer`（`steering-service.ts:566-587`），它只把 authority 转交 ContentPackage revision sole writer（`SteeringDerivedRevisionWriteAdapter`），全程无 quote、无 reserve、无 settle，直接返回 `'completed'`。
- **`:1104` workflow 路径**：走 `SteeringDerivedWorkflowCoordinator`，其依赖里有 `quoteAuthority`（`steering-derived-workflow.ts:196`）与 `billing.buildQuote`（`:197`），并在 `:265` 真实 resolve 报价。

两个消费者在生产装配里**都**被绑上（`apps/core/src/assembly/api-runtime.ts:1107-1112`：`derivedRevision:` 与 `derivedWorkflow:` 同时 bind；`:1719` 第二次 bind 只加 `planChange`，因 `bindActionConsumers` 是浅合并故两者存活）。所以选择权完全落在 `authority` 是否存在上，而不落在任何计费策略上。

## 与商家文案的矛盾

`derived_revision` 在 `projectSteeringImpact` 里恒满足 `rebilled === true`（`steering-service.ts:399-405`，`classificationKind === 'derived_revision'` 直接置真），因此商家收到的 `feeNote` 是：

> 「{改动的页}会按你的改法重新生成**，按正常生成一样算积分**」
> —— `steering-service.ts:411`（`amount`）＋`:418`（feeNote 的 rebilled 分支）

同时 `settledNote`（`:429`）告诉她：

> 「之前已经生成的那次照常计费、不退回，原来那版也会留着。」

也就是说：**前台明确承诺这次改动会按正常生成计积分**，而 `:1096` 这条路径一分不收。文案与账不一致，方向是对商家少收——但它同样意味着一条不经过 quote 的生产写入路径，绕开了 D-061 的积分口径与配额扣减。

## 当前可达性（务必如实读）

**生产 HTTP 缝今天走不到 `:1096`**：`submitAuthoritative` 把 `derivedRevisionAuthority` 从入参 `Omit` 掉，只能由 `resolveAuthority` 提供；而生产 `resolveAuthority`（`apps/core/src/assembly/core-assembly.ts:893-899`）只返回 `workId / sourcePlanRevision / snapshotHash / sourceContentVersionIds / units`，**不返回 `derivedRevisionAuthority`**。因此 `authority` 恒 undefined，实际落到计费的 `:1104`。

所以这是**潜伏（latent）缺口，不是在产事故**：

- 没有任何 guard 阻止它被激活——`:1096` 的条件只看 authority 在不在，不看有没有报价过；
- 一旦任何装配（或未来某次 `resolveAuthority` 扩字段）开始提供 authority，直写不计费立即生效且静默；
- store 会持久化 `derivedRevisionAuthority`，而 replay 路径在 `steering-service.ts:763` 把 `existing.derivedRevisionAuthority` 原样传回 `consumeDerivedRevision`，因此**任何一行带 authority 的存量 command 在重放时也会走不计费路径**。

## 要做什么

先裁决语义，再改代码：

1. **裁决**：`derived_revision` 是否应当计费？若是（文案与 D-061 都指向「是」），则直写路径必须先报价再写；若否，则前台文案必须改口，不能承诺按正常生成计积分。**两者必须同时成立，不允许一边承诺一边不收。**
2. 若裁「应当计费」：把 `:1096` 分支收进与 `:1104` 同一条报价缝——或者更简单，删掉 `:1096` 这条捷径，让 authority 也走 `SteeringDerivedWorkflowCoordinator`（它已经有 quote+billing 依赖，且已是生产实际路径）。
3. 加 fail-closed 守卫：无 quote 证据的 derived revision 写入应当被拒绝，而不是静默 `'completed'`。
4. 若裁「不计费」：改 `projectSteeringImpact` 的 `rebilled` 判定，让 `derived_revision` 不再落 rebilled 分支，并同步 `settledNote`。

## Acceptance criteria

- [x] 裁决记入决策权威文档（计费 or 改文案），票下留原文 → **D-179 accepted**：`derived_revision` SHALL 计费；方向 2（删捷径、统一走 workflow）
- [x] 负向测试：无 quoted consumer → 503；无 `workId` → 409（旧静默 `'completed'` 断言先红后绿），不再返回 `'completed'`
- [x] 若裁计费：`derived-revision-billing.test.ts` 证明 `launchDerivedRevision` 产生 ProductQuote（`quoteAuthority.resolve` → `billing.buildQuote`）并把该 quoteId 交给 adjust 预留；`projectSteeringImpact` `rebilled===true`，feeNote 只讲积分
- [x] replay 路径同受约束：`derivedRevisionAuthority` 生产零引用（静态钉）；`consumeDerivedRevision` 只有 `launchDerivedRevision`，replay 同样 503/409
- [x] 消费者证明：文案与 ledger 同源（quote 只写一次；impact 不另算积分；本棒 feeNote 仍为「按正常生成一样算积分」，数字由 V31-107 接 quote.creditCost）
- [x] 无上游成本／token／USD 泄漏（D-061）

## 实施记录（非 GitHub；handoff §1 收口）

**Status → 已修待关**

主控 handoff `docs/ops/master-handoff-bug-batch-2026-08-25.md` §1 对 main `3b88fd265` 核实：票面「问题」节锚的是 `codex/v31-fix-steering@2c1913a18` 旧树，核心缺陷在当前 main 已被修掉。本票剩余价值＝钉死该状态，不是重修。

- 裁决：`derived_revision` **应当计费**。写入 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md` **D-179**（accepted）。与 D-061、现行商家文案、现行实现三方一致。方向 2（删捷径统一走 workflow）已由 Task 8 血统实现于 main；本票把它钉死。
- `consumeDerivedRevision`（`apps/core/src/p1/agent-session/steering-service.ts` ~891-911）**只剩 quoted workflow 一条路径**：无 `derivedWorkflow` 消费者 → `QUEUE_NOT_READY` 503；无 `workId` → 409。不得静默返回 `'completed'`。
- `derivedRevisionAuthority` 生产零引用；replay-with-authority 旁路已消失。
- 真实报价：`apps/core/src/p1/agent-session/steering-derived-workflow.ts` ~321-322（`billing.buildQuote` + `quoteAuthority.resolve`）。
- 商家文案（本棒**未改** `projectSteeringImpact` / `steeringUnitLabel`，留给 V31-107）：`derived_revision` 恒 `rebilled=true`，feeNote「按正常生成一样算积分」。
- D-061 复查：本路径 `feeNote` / `settledNote` / `merchantMessage` 无 成本／上游／token／USD／$。
- 钉死测试：`steering-service.test.ts` 503 + 新增 409（旧静默成功先红）；`derived-revision-billing.test.ts` quote 同源；`steering-derived-revision-quote.static.test.ts` 禁捷径回潮。
- **Evidence SHA**：`7d5901bf745238edfae7e8eb95548183f5eca018`（本 worktree 验证轮；实现 commit，含 D-179 与钉死测试）。

## 语义锁

本票会改 `consumeDerivedRevision` 与 `steeringDerivedRevisionActionConsumer`，与任何仍在动 V31-16 steering 消费者面的工作互斥。开工前确认 Task 8 血统已合入，避免与 `codex/v31-fix-steering` 的 `354d5f3ff..2c1913a18` 段冲突。

## 背景记录

- 2026-08-09 review-steering 复核 L-T8C 交付物时留档；不属 Task 8 派工范围（Task 8 的 derived_revision 项只要求「有真实 producer」，producer 确实存在且 WIRED），故按令单独开票而非在 lane 内顺手改。
- 相关但不同的一票：`settlePartialDelivery`（`steering-service.ts:231`）无生产调用方，Wave 4 复查后另行处置。
