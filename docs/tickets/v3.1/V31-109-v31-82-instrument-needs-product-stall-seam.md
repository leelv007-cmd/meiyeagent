# V31-109 — v31-82 悬死 instrument 需要产品侧 stall seam 才能诚实变绿

**Parent**: V31-105 §18（08-24 慢性红归因，lane 双取证）
**批次**: 测试基建（Core 测试 seam + spec 收尾，半天）
**Blocked by**: 无（止血两 commit 已随 V31-105 §5 批次合入）
**Related**: V31-82、V31-105 §18

**Status**: open（2026-08-24）— `v31-82-stalled-image-work-timeout.spec.ts` 自 08-14 起在 CI 轮轮红：spec 建于 08-13，`storeFactsPending` 门 08-14 落地（84d3d0911）而 spec 从不 seed 门店，提交键恒为「先核对信息」（只揭示事实卡、设计上不产生 run）；补 seed 后落回 spec 自声明的 KNOWN RED——fixture 只能推时钟、造不出 stall，fixture 模式下这条 image_text run 会端到端跑完。要诚实变绿需产品侧 seam：把一条 run 按在 running 且无 generation job

## 归因（两层，均有失败瞬间证据）

**层1（已修，随 §5 批次）**：spec 只 `seedComposerInlineAuthorize`，从不 seed 已确认门店。`composer-home.tsx:2820` `storeFactsPending = creationMode==='customized' && showProgressiveFact && !product.state?.store`（`progressive-fact.ts:875` `!hasStore ⇒ true`）时提交键是「先核对信息」，按下只揭示门店事实卡、绝不产生 run（`use-composer-run.ts:189-192` 注释明言）。所以失败页快照是「按钮还在、积分未动、Core 零业务日志」——产品行为正确，journey 被 day-0 门挡在门口。修＝`seedConfirmedStore`，红点后移，**不宣称绿**。

**层2（本票范围，08-24 轮2 失败瞬间双取证后修正）**：补 seed 后红落在 KNOWN RED 层，但机制与 08-13 声明的「fixture 造不出 stall」不同——fixture **确实**把目标 work 终结成了 `failed/timeout`（库证：`payload->>'status'='failed'`、`failureReason=timeout`、`updated_at` 为被推快的时钟）。真相两条：① 该 image_text run 的媒体生成**不落 `p1_generation_jobs` 行**，时钟一推，一条正在出图的健康 run 就落进 `work_running_no_job` 窗口（`postgres-creation-submission-store.ts:2447`）被判悬死——它在 stall 判据眼里本来就长得像 stall；② `terminateRunningWork` 把 work 写成 failed 之后，**在途生成不停、浏览器会话收不到终态**：同一时刻 DOM 仍是「进行中／正在生成第 1 页配图」，`workbench-inspector-failed` 永不渲染，instrument 后半段断言无从满足。另修掉一个假绿隐患：`apps/core/src/assembly/api-runtime.ts:2280-2310` 的 expiry fixture 原判据是**全局** sweeper 计数（`terminated>=1 || alreadyTerminal>=1`）、从不检查目标 work——已收敛为「目标 work 自身必须 `failed`」（`completed` 也不接受，那正是 KNOWN RED 警告的假绿形态）。

## 方案（待实施）

> **Seam 需求**：新增 e2e-only 产品 seam，能把一条 image_text run 稳定按在 `p1_creative_works.status='running'` 且 `creation_submissions.harness_state∈(reserved,starting,started)`、无对应 `p1_generation_jobs` 行的状态上，并在 run 移动前就能取到 workId（当前客户端要等图文方向答完才写 sessionStorage 句柄）。
> **判据**：expiry fixture 的成功判据已收敛到「目标 work 变 `failed`」（止血批次），seam 落地后不得再放宽。
> **未闭合的第二半**：`terminateRunningWork` 把 work 写成 failed/timeout 之后，在途生成不停、浏览器会话收不到终态，`workbench-inspector-failed` 永不渲染（08-24 轮2 失败瞬间：库 failed/timeout vs DOM「正在生成第 1 页配图」）。seam 必须连这条终态通知通路一起补，否则 instrument 仍然只能红在 `:116`。
> **附带疑问（产品）**：图文媒体生成不落 `p1_generation_jobs`，`work_running_no_job` 窗口在生产 15 分钟门下是否会误杀在途长图文 run——需单独回答。
> **验收**：instrument 两轮 `--retries=0` 绿，断言覆盖「短超时 → 失败终态 + 退款 + Composer 解锁」全链，删掉 spec 里 08-13 的 KNOWN RED 段，无断言削弱。

**Implementation state**: not started
**Verification state**: n/a
**Evidence SHA**:
**Workflow Run**:
