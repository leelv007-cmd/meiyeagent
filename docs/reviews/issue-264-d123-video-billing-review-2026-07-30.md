# Issue #264：D-123 视频计费口径复核

日期：2026-07-30
结论：**D-123 三桶、三类加油包与视频 3/6/9 档位均不调整。**

## 本票退役的计费点

#264 退役的是视频工作面中的单镜重生成（shot regeneration）及其 quote、confirm、retry、recover、free action、runtime、foundation 和 PostgreSQL repository。它是视频编辑概念的残留，不是套餐中的“初次生成一条成片”。

新合同同时封死两条旁路：

- `video-regeneration` 不再是合法 P1 module，也不再注册 capability、Foundation module、side-effect 或 schema migrator。
- `video.generate` 结果不支持 adjustment；prepare 阶段直接返回 `RESULT_ADJUST_OPERATION_UNSUPPORTED`，不产生报价意图、派生 Work 或 Composer submission。

## 保留的商品口径

- 三桶仍是 `copy` / `image` / `video`，三类加油包不变。
- 视频档位仍是初级 3 条/月、中级 6 条/月、高级 9 条/月；本票不改价格、套餐、阈值或后台运营参数。
- 商家侧视频单位仍是**初次成功成片 1 条 = video 1 unit**。时长只作为供应侧成本与技术证据，不作为商家额度倍数。
- 初次生成失败或取消继续遵守既有预占/退回合同；terminal settlement 的 replay 不得重复结算。
- `poll`、`recover`、`download_supplier_task`、`play_control`、`adopt_candidate`、`select_shot_candidate`、`deterministic_sort` 是接收、观看或选择行为，不产生额外视频扣费。

## 历史数据与数据库生命周期

- 新进程不再装配 regeneration repository/migrator，因此新环境不会由产品代码创建或写入 `model_video_regeneration_*` 表。
- 已部署环境中的旧表、quote、usage、audit 与 composition evidence 默认作为历史证据 dormant 保留；本票没有物理 `DROP` 或清除历史行的授权。
- 旧 `delivery.cover` 与 `subtitleText` schema/data 仍可解析；新视频 ZIP 不再读取 cover object，也不再写入 cover 文件或 manifest role。
- 若未来需要物理删除旧表，必须另行确认留存、审计和回滚边界。

## 代码与行为证据

- 商家额度单位与生产提交触发点：`apps/core/src/p1/execution-spine/submission-coordinator.ts:212-220` 将提交快照写入 usage reservation；同文件 `:530-552` 对视频固定返回 `{ resource: "video", quantity: 1 }`。
- 服务端报价：`apps/core/src/p1/product-billing/server-quote-authority.ts:103-129` 将 `video.generate` / `video_package` 映射到 video bucket。
- 档位种子：`packages/contracts/src/billing-balance.ts:33-61` 定义公开三档合同，`apps/core/src/product/plans.ts:26-66` 固定 starter/growth/pro 的视频 3/6/9。
- 初次视频生产成功结算：同步 provider 成功结果在 `apps/core/src/p1/model-supply/index.ts:3347-3395` 进入统一结算接缝，`:2412-2430` 调用运行时 ledger；HTTP 与 worker 分别在 `apps/core/src/main.ts:753-767`、`apps/core/src/job-worker.ts:474-488` 装配 `FoundationModelSupplyLedger` 与 `billingLifecycle`；ledger 在 `apps/core/src/p1/model-supply/foundation-ledger.ts:631-647` 以成功状态调用 `settleTask`，最终由 `apps/core/src/p1/product-billing/lifecycle-port.ts:197-225` 幂等提交 ProductUsage。
- 成功与重放回归：`apps/core/src/p1/model-supply/foundation-ledger.test.ts:118-270` 覆盖上述生产 ledger 的成功结算与 fresh application replay；`apps/core/src/p1/model-supply/video-initial-generation-job-settlement.test.ts:12-83` 保留失败前退回合同。
- 编辑计费负向：`apps/core/src/p1/model-supply/retired-video-editing-contract.test.ts` 与 `apps/core/src/p1/result-delivery/operations-result-command-port.test.ts` 覆盖退役 module / subtitle edit 拒绝及 video adjustment 零副作用。

`createInitialVideoTerminalObserver` 当前是独立失败退回合同接缝，不作为生产成功结算证据；生产成功结算以本节列出的 `ModelSupplyApplicationService → FoundationModelSupplyLedger → ProductBillingLifecycle` 装配与调用链为准。

## 仍待 D-123 验证

真实视频成本随时长/规格的分档、低额度提醒阈值、视频加油包需求与“额度用尽→代运营”转化位仍待运营实测。本票不建设成本守门、自动核价或新计费机制。
