# V31-82 — C4 图文单悬死 `running`：20 分入 USAGE 无出口、无失败投影、worker 到位也不恢复

**Parent**: 能力基线盘点第一轮（`docs/reviews/capability-baseline-audit-2026-08-13.md` §0.3/§1 C4）
**批次**: 清红队列（钱无出口=硬门①③域）
**Blocked by**: 无（先在 e2e 原生栈复跑分辨环境特异性，再修）
**Related**: V31-41（失败终态/预留释放方法论）、V31-63（admission 链）、V31-64（进程/管线悬死无留痕仪器）、V31-81（同 work 上的 steering 拒绝）

**Status**: implementation-complete（2026-08-13）— 有界超时终态＋同事务退款＋失败投影＋解锁全落地；主控活体端到端证毕（含一处 lane 未覆盖的恢复态死锁，主控直修）

**Implementation state**: implemented
**Verification state**: live-verified（单一真相栈端到端：新号提交→work running 且 **0 generation job**→补活 worker 5 分钟仍不恢复（确证停滞在建 job 之前，非 worker 缺席可解）→90s 注入超时后 sweeper 自动置 failed/WORK_EXECUTION_STALLED→用量 refunded、余额 100 复原→前台解锁。变异：退款幂等键失效红、恢复态对账 no-op 红）
**Evidence SHA**: 97f534d0c76a4c2b6f92222f70e831e21fb4dbfb
Evidence 注：走查号 journey-v3186-185351@example.test（ws_wBFDHprmCTdLlwkYdBjMeCaiTeQ4Z70t）；盘点四号 work-cd980cd4 仍保留为历史取证体未动
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

- [x] 环境特异性定性：**非环境特异**——单一真相栈复现，且补活 worker 5 分钟不恢复；停滞点在建 job 之前。按票面双结局要求，走「执行链容错」修法
- [x] 有界超时失败终态＋退款＋失败投影（两窗口：running 无 job／job 无进展；阈值 env 可注入，默认 15 分钟；跑在既有补偿环）
- [x] 语义流 vs canonical 一致性对账（`canonical-work-state.ts`，与 V31-85 的 slot 抑制合流）
- [x] 钱有出口（走查号 15 分实退：usage=refunded、余额 100）。盘点四号 20 分未动——该号是历史取证体，按需可由同 sweeper 自动清算

## 留痕

- 开票：2026-08-13 盘点第一轮。§43 门①（billing 错误=0）与门⑦（partial 不写 canonical）
  的组合场景：首版可见+运行悬死+钱悬着，三者并存正是发布前绝对门要挡的形态。

## R2 补记（2026-08-13 晚，第二轮盘点）

- 悬死 work 跨天仍「正在生成…」；composer textbox disabled、无任何取消/停止出口——
  爆炸半径从「一单悬死+钱悬着」升级为「该账号创作功能整体锁死」。单一真相栈上复核，
  半径结论与第一轮手拼环境无关。修复时「有界超时终态」须连带解锁 composer 与退款。

## 收口补记（2026-08-13 主控）

- **停滞点定性**：Core 端 work 建了、`p1_generation_jobs` 一条没有；事后补活 worker（同
  profile）观察 5 分钟仍零 job、状态不动。**补 worker 不恢复**，与第一轮手拼环境的结论一致，
  故本票按「执行链容错」收——任何停滞都必须有界终态。
  副带发现：dev 档 worker 会打印 `HARNESS_DBOS_SYSTEM_DATABASE_URL is not configured;
  DBOS terminal signaling for model.media-generation jobs is disabled`——媒体任务在 dev
  档本就无法走完，属仪器债，与本票的容错要求不冲突。
- **lane 未覆盖、主控直修**：sweeper 修好了服务端，但 **sessionStorage 恢复出来的会话仍停在
  running**——商家刷新页面依旧被锁在输入框外，只有清浏览器存储才解开。新增
  `reconcileRestoredSessionPhase`（任务已不在 active 列表 ⇒ 有交付则 delivered，否则回到可创作），
  单测先红后绿＋活体证毕（种一个陈旧 running 会话→刷新→句子还原、锁自动解开、键不再残留）。
- **e2e**：`v31-82-stalled-image-work-timeout.spec.ts` 落盘 --list 可解析，全栈跑归旅程门轮。
