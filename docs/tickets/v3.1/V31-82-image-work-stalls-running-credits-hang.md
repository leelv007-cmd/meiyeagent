# V31-82 — C4 图文单悬死 `running`：20 分入 USAGE 无出口、无失败投影、worker 到位也不恢复

**Parent**: 能力基线盘点第一轮（`docs/reviews/capability-baseline-audit-2026-08-13.md` §0.3/§1 C4）
**批次**: 清红队列（钱无出口=硬门①③域）
**Blocked by**: 无（先在 e2e 原生栈复跑分辨环境特异性，再修）
**Related**: V31-41（失败终态/预留释放方法论）、V31-63（admission 链）、V31-64（进程/管线悬死无留痕仪器）、V31-81（同 work 上的 steering 拒绝）

**Status**: open（2026-08-13）— 盘点取证，未派工；环境特异性待分辨

**Implementation state**: not-started
**Verification state**: reproduced-once（盘点四号 work-cd980cd4，15 分钟+悬死；环境=手工盘点栈，见 caveat）
**Evidence SHA**: 0487afd99e724d6ca9ac3e0fccdecf3a32126ca0
Evidence 注：走查代码树；`p1_creative_works` 该行停 `running`@03:01:44，`p1_generation_jobs` 无任何 image 任务，USAGE 20 `credited=f`
**Workflow Run**:
**Artifact Digest**:

## 症状链

1. fallback 配方（项目/活动套图，报价 20 分）确认后：pill 99→79，USAGE 20 落账（uncredited）。
2. 时间线出现「成品已就绪·第 1 版」卡（语义流侧首版可见），但 `p1_creative_works`
   永停 `running`，此后 15 分钟零更新；**image 的 generation job 一条都没建**。
3. 右栏永远「创作进行中」；无失败投影（V31-75 修的 failed 投影因为根本没到 failed）。
4. 事后补配对 worker（同 env）也不恢复——悬死点在建 job 之前的执行链上。

## Caveat（诚实边界）

走查栈为手工拼装（audit Core=e2e/fixture@54329＋后补 worker；dev:worker 曾以 direct 档
混跑）。e2e 门自己的栈上该旅程有绿史。**修前第一步=在 e2e 原生栈复跑同编舞**：
若绿 ⇒ 本票聚焦「执行链对 worker/队列缺席的容错：超时终态＋退款＋失败投影」；
若红 ⇒ 产品缺陷直修。两种结局钱都必须有出口。

## Acceptance criteria

- [ ] 环境特异性定性（e2e 原生栈复跑记录在票）
- [ ] 任何原因导致执行链停滞 ⇒ 有界超时进入失败终态＋预留/用量退回＋右栏失败投影（复用 V31-75 的 failed 面）
- [ ] 「首版已交付但 work 非终态」的状态矛盾有一致性断言（语义流 vs canonical state）
- [ ] 盘点四号的 20 分在修复树上完成退回或结算（先红后绿取证）

## 留痕

- 开票：2026-08-13 盘点第一轮。§43 门①（billing 错误=0）与门⑦（partial 不写 canonical）
  的组合场景：首版可见+运行悬死+钱悬着，三者并存正是发布前绝对门要挡的形态。
