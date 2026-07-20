# WT-3 视频线 Handoff

> **状态：历史 handoff，实施已合入。** 保留作 #27/#42/#46 的属主与接缝证据；当前状态见 [`../reviews/implementation-gap-ledger-2026-07-19.md`](../reviews/implementation-gap-ledger-2026-07-19.md)，不要据此重新开工。

**使命**：长跑自包含线。先补全视频成片闭环（#27，五批），扇出后接外发批准与台账统一（#42，三批）、承接结果面（#46）。你的线全程不等 #35，是唯一从头到尾不受关键路径牵制的线。

**文件域**：`apps/core/src/p1/model-supply/` 视频段（composed-video-workflow、media-generation-workflow、ffmpeg-composition-port、ark-media-adapter、runtime-config）、`apps/core/src/video/`、mkfast 的 video-workflow-panel/model；后期 `p1/operations/` 发布导出段与 handoff/content 路由。

## 认领序列

1. **#27 视频闭环补全**（无阻塞，立即开工；内部分批 A-E 按序各落 PR）：
   - **A 时长/画幅贯通**：从冻结的 `CreativeExecutionContract.durationSeconds/aspectRatio` 贯通 draft→shot schema→`models.submit.input`；每 shot 时长显式分配、总和=合同时长。修订节 P0：**Provider 成本按真实时长估算/结算，用户报价按冻结 quote 走，两者不得强等**。
   - **B AIGC+provenance**：修订节 P0——验收按开关分支（`aigcLabelEnabled=false` 不得因缺可选标识判失败）；provenance 汇聚进 ContentPackage（route/费用/合成证据/验证结论）。
   - **C 字幕合同+评分器**：字幕真传或删 `subtitleEvidenceHash` 二选一；评分器输出版本化五维分+scorer revision，未评分进 `unscored_requires_human_review`。
   - **D 旧 ark-provider 退役**：迁 live test→标 `@deprecated`→仓内生产引用清零；删除 export 另开清债票。
   - **E 整链集成测试+五模式矩阵**：结构性防重复断言（外层不 import planner/Ledger、每 workflow 冻结一次路由、重放零新增费用）。
2. （扇出后）**#42 外发批准+发布导出+台账统一**（等 #35；内部分批）：A=ApprovalReceipt+失效传播+未批准外发门（**调 WT-1 #34 的 validator，不复制规则**）、B=发布导出桥（修订节 P0：抖音现为 RecordedAdapter+快照读 legacy，不得称已验证；三态门+provider 调用数为 0 的降级断言）、C=ContentPackage 原生台账+legacy 只读投影（修订节 P0：**adapter 造 handoff 的选项已作废**，违 ADR-0011）。
3. **#46 承接结果面**（等你自己的 #42C）：消费边界——只读 #42 台账，不建第二套发布地址/状态命令；两数据源+三级视觉；不算运营期指标。

## 上下游

- **等你的**：#46 等 #42C；#45（扇出后别的线）等 #42；#39 等 #42；#47 等 #42。你 #42 的 A 批越早合入，扇出侧解锁越快。
- **你等的**：#42 等 #35（WT-1）；#42A 的失效传播消费 #32C（WT-2）的过期事件。#27 全程无外部依赖。

## 必读与红线

- 票体修订节；r1 报告 `.scratch/ticket-code-inventory-codex-2026-07-18/r1-video-wiring.md`（全部改造锚点；注意其 `runtime-config.ts:206` 是错锚，正确锚点在 #27 修订节第 7 条）；r4 §(h)（台账断点）。
- **头号红线**：主链已通（冻结路由→逐 shot→台账→ffmpeg，79/79 基线）——在 `DurableComposedVideoApplicationService` 再调 planner/Ledger = 双重选路+双重记账，修订节第 4 条的结构性断言就是防你这个。
- 与 WT-1 共享 `model-supply/index.ts`：你动视频段（约 3000-4200 行区间），harness 段归 WT-1；改前看对方在途 PR。后期 #42 动 `application-service.ts` 时与 WT-2 的 #37/#43 错峰。
