# V31-63 — 浏览器必跑门收口：S0 successor 半成品死锁 + rights 冻结/校验基线不同源（付费运行 admission 恒死）

**Parent**: 承接 08-09 整改波 checkpoint（`e637e563`）的未收尾状态；旅程锚 §37.4-E
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-55（compile/verify 收窄一致教义）、V31-56（Living Plan 显式 start 预确认线）、V31-14（context fence 旅程）、V31-49（必跑门外 spec audit）
**Status**: open（2026-08-12）— root-caused with file:line anchors; fix not started

**Implementation state**: not started
**Verification state**: n/a
**Evidence SHA**: 8327f03079a7be4f33c6638bdc65134602f921b1
**Workflow Run**:
**Artifact Digest**:

## 为什么开票

`v31-browser-acceptance` / `p2-browser-acceptance` / `production-main-journey` 三门在净化仓（meiyeagent）上**从未绿过**：远端 main `cffc41f6` 自己的 08-11 CI 就红，wave 前基线 probe PR #2（`8c543599`）与 arch wave 后 PR #1 失败集合一致——与 2026-08-12 arch wave 无关。主簇根因已定性到行，是 checkpoint `e637e563`（「checkpoint repair worktree before main merge」，08-09 九 lane 整改波的中途落库）留下的半成品架构。本票为收口任务书。

## 死亡链（主簇：一切带素材的付费运行）

1. 付费 Living Plan 提交时 `preparePendingConfirmation`（`apps/core/src/p1/execution-spine/submission-coordinator.ts:1052`）预建确认请求；开始制作＝前端 strip 写 `living-plan-commit:<requestId>` 预确认决策（`mkfast-template-main/src/product/composer/use-living-plan-controller.ts:60-70`）→ start → 门内 `confirmPaidGenerationExecution` 走 pre-confirmed 分支直达 admission（`apps/core/src/p1/harness/paid-generation-confirmation.ts:267` 起）。
2. **缺陷 A（rights 基线不同源，违反 V31-55 教义）**：冻结侧 rights 指纹基于 proposal 的 `assetIntentions`（e2e 会话内核 fixture 硬编码 `[]`：`apps/core/src/assembly/core-assembly.ts:711`；live LLM proposal 同样不保真），校验侧用提交快照素材 `request.intent.assetReferences`（`apps/core/src/p1/harness/execution-plan-live-facts.ts:103`）。带素材的付费运行 admission 恒判 SNAPSHOT_STALE（rights 轴）。实测 diff：frozen `rights:ws_…:1f5611…`（空基线可精确复算）vs live `rights:ws_…:261c07…`（含 `asset-8115…`）。
3. **缺陷 B（S0 successor 结构死锁）**：stale → `createRepricedPaidExecutionSuccessor`（`apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:1087`）前置要求前驱 `harness_state='reserved'`（:1179，「one not-started primary predecessor attempt」），但其**唯一运行时调用点**在门内 admission（`paid-generation-confirmation.ts:415`），彼时前驱恒 `'started'`（`completeHarnessStart` 在 `harness.start` 返回后即写，`submission-coordinator.ts:1817`）→ P1DomainError INVALID_STATE → workflow 死亡退款 → 商家见「这次没有做成」，任何确认卡都不渲染 → spec 等 `execution-confirmation-interaction-card` 超时。
4. 配套缺口：`PaidExecutionRepricedSuccessorCreatedError` / `PaidExecutionRequiresSuccessorAdmissionError` 在生产码**无 catcher**（仅 `confirmation-gate-merge.test.ts` 引用）；staleness 无任何派发前（decide/start 时、前驱仍 `reserved` 窗口）评估点。

## 设计约束（不许走的回头路）

checkpoint 是**刻意**退役旧「流内重确认环」的：`confirmation-gate-merge.test.ts:294`（post-confirm live quote drift）钉死「old workflow must not refresh a successor plan」——只有新 admission 事务可持久化替代 authority/hold/task request（账务完整性）。**修复不得恢复 `1b492138` 的旧环**（旧环参照可看 `git show 1b492138:apps/core/src/p1/harness/paid-generation-confirmation.ts`，其 context-fence 本地 1/1 PASS 台账在 `git show 1b492138:docs/handoff/v31-w4-context-fence-plan-diff-2026-08-11.md`），正路是把 S0 successor 机制收尾。

## 修复方向（按依赖顺序）

1. **successor 前置放宽 + 语义校正**：`postgres-creation-submission-store.ts:1179` 的 `'reserved'` 检查改为接受门内现实（`'started'`，crash-replay 时 `'starting'`），拒绝 `'failed'`；「not-started」语义改为「未产生可计费执行产物的主尝试」，与同事务内 `failAndRefund`（reason `confirmed_price_drift_successor`）的退款语义对齐，并验证旧 workflow 死亡路径不会二次退款。
2. **门内错误优雅收口**：给 `PaidExecutionRepricedSuccessorCreatedError` 加 catcher（workflow-core 层），旧 workflow 以「已由继任者接管」的非失败终态收口（商家可见文案不得是「这次没有做成」），并 reportProgress 指向新确认。
3. **successor 确认卡同线程投影**：successor 是新 task/work/contentPackage，其 `confirmationDispatch.state='pending'` 必须在原会话线程渲染为 `execution-confirmation-interaction-card`（§37.4-E leg 1/3 依赖同页出现 fresh card、旧 requestId decide 409）。
4. **缺陷 A 对齐（时机警告）**：composer 编译采 kernel proposal 时用快照 `sources.assets` 覆盖 `assetIntentions`（`composer-plan-session.ts:385-388`；`proposalFromSubmission` 在 :1349 本就如此）。⚠️ 此修会把「start 后必出重确认卡」翻成「干净 admission 直通执行」——`1b492138` 绿点时代 context-fence 的首卡实际靠 rights 假漂移触发（隐性承重墙）。**必须与 1–3 同波落地并整轮跑三门验收**，单独落会引发新一轮 spec 翻车。
5. 收尾时逐一核对 §37.4-E 四腿：首卡（successor pending）、diff 节（facts_assets/cost_duration）、旧 authority 409、fresh 确认后执行。

## 尾部（非本票根因，须另行定性）

三门失败集合 ~25 spec；主簇之外 `v31-thread-root-workbench`（5 败最大簇）、`v31-ops-console-release-journey`、`v31-memory-injection-b2-journey`、`v31-publish-handoff-selfreport`、`v31-level1-copy-journey`（copy 免确认路径，非本链）、`marketing-identity-flow`、`memory-vault-governance`、`viral-adapt-opencli-gate`、`m04-browser-hard-gate` 各有 lane 级成因，对应 08-09 整改波各未完 lane。主簇修复转绿后按残余矩阵逐簇立案。

## 证据

| # | 证据 | 落点 |
|---|---|---|
| 1 | admission staleness 实测 diff（仅 rights 轴） | 本地复跑 context-fence，TEMP-DIAG 输出：frozen `1f5611…` vs live `261c07…`（含 `asset-81151778a3ab542ff347731344a9e6ae`） |
| 2 | 空基线可精确复算 | `fingerprintValue({assets:[],platform:'xiaohongshu',requestedAssetIds:[],workspaceId})` 前 16 hex == frozen hash |
| 3 | 预确认决策实存（5 次尝试全有） | 取证库 `meiye_local_fence_probe`@54329 `p1_plan_confirmation_decisions`：`living-plan-commit:confirmation:*` decided 5 行 |
| 4 | successor 唯一调用点＋前置矛盾 | `paid-generation-confirmation.ts:415` ↔ `postgres-creation-submission-store.ts:1179` |
| 5 | 与 arch wave 无关 | probe PR #2（wave 前 `8c543599`）与 PR #1 同败；远端 main `cffc41f6` 的 08-11 run 同败 |
| 6 | 三门逐 spec 失败清单 | `gh run view 31554310069 --repo <publish remote> --log-failed`（~25 spec） |
