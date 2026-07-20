# WT-1 Harness 主干线 Handoff

> **状态：历史 handoff，实施已合入。** 保留作 #26/#31/#34/#35 的属主与接缝证据；当前状态见 [`../reviews/implementation-gap-ledger-2026-07-19.md`](../reviews/implementation-gap-ledger-2026-07-19.md)，不要据此重新开工。

**使命**：全图关键路径。你交付五段式 Harness 的 LLM 节点、执行择优与七门、以及最终的主 tracer（#35）——13 张下游票直接或间接等你。进度优先级最高，卡住即全局卡住。

**文件域**：`apps/core/src/p1/model-supply/`（runner/结构化节点）、harness 新目录（生产 workflow 模块）、`apps/core/src/p1/harness-poc/`（只读参照，最后由你删除）。

## 认领序列

1. **#26 ai@7 清债**（无阻塞，热身票）：3 处 `generateObject` 迁 `generateText+Output.object`；修订节补了 `respondText:147`/`startCopyStream:246` 两处 `result.response` 弃用别名，门槛=rg 零命中。
2. **#31 ①意图正名+③Brief 编译**（等 WT-2 的 #25 合入，约首日即可）：runtime-independent 非流式边界 + `StructuredNodeRunner` 窄口（在 model-supply 内新增，复用模型构造/目录/计费链）。修订节 P0：runner 调用必须带稳定 `effectIdempotencyKey`，同 key 同 payload 重放不得二次提交/计费；repair 未实现显式记 `unsupported`。
3. **#34 ④执行择优+七门**（等 #31 + WT-2 的 #32）：内部分批 A=执行/台账/择优、B=七门 canonical validator。修订节 P0：validator 输入含 `actionContext?/approvalReceipt?/currentRevision?`，第 6/7 门由 #35/#42 调你同一个 validator——**你是七门唯一实现者**，别的票只许调用。退款矩阵按 acceptance 三态（unknown 只 reconcile，不退款不终结）。
4. **#35 主 tracer**（等 #29 组件/#30B/#31/#32/#33A/#34 汇合）：内部分批 A=DBOS 注册/唯一路由/效果键+request fingerprint（同 ID 不同 payload→409）、B=DecisionTrace/审计/outbox+⑤段 OCC+**决定接缝**（taskId/questionId/workflowRevision/幂等键/409 语义——WT-4 的 #36 和后续 #47 等这个）、C=接 #33/#29 的合同 e2e+删 PoC。修订节 P0：交付物收窄为**文案层** revision，不是完整入口。

## 上下游

- **等你的**：#35 A 批解锁不了任何人，**B 批**解锁 #36/#47（决定接缝）+ #41/#42/#48/#43A/#37（依赖 #35 整体，以你 C 批合入为准）；#34 的 validator 被 #42/#49 直接调用。
- **你等的**：#25（WT-2，contracts 类型）→ #31 前置；#32（WT-2）→ #34 前置；#30B（WT-2）+ #33A（WT-4）+ #29 组件（WT-4）→ #35 前置。哪个先到先做哪段。

## 必读

- 票体修订节（每张）；D-032/D-033/D-035/D-038/D-041（权威文档）；PoC 报告 `.scratch/dbos-poc-2026-07-18/REPORT.md`（随迁事项 1-6 直接进你的实现）；r2 复用清单 `.scratch/ticket-code-inventory-codex-2026-07-18/r2-durable-occ.md` §五（「勿重造」四条是红线）。

## 红线

- 禁止为 exactly-once 引入 knex/drizzle datasource（D-041）；禁止在 pg-boss 上手写第二套编排器；禁止建第二套媒体生命周期状态机（④段视频单元将来经统一接口接 #27 成果）。
- 效果键格式 `wf:{workflowId}:s{n}:{unit}:{candidate}`；system DB 独立分库；workflowID=Task ID。
- OCC 冲突审计口径：无业务残留 + 恰一条 `revision_conflict` 权威审计（与 #30 统一）。
- 与 WT-3 共享 `model-supply/`：你动 runner/harness 段，视频段归 WT-3；改 `index.ts` 前看一眼对方在途 PR。
