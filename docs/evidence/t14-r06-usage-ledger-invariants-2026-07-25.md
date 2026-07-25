# T14 · R-06 usage 账本不变量证据

日期：2026-07-25

车道数据库：`meiye_be2`（PostgreSQL `127.0.0.1:54329`）

初始风险复现基线：`896089b7`

依赖：`git merge-base --is-ancestor 422fc00f HEAD` → exit 0

最终 rebase 基线：`09683313`（包含 T14 合入后的前向 revert、T41 与 T27；本分支用 rebase 重放，不做 revert-the-revert）

rebase 证明：`git merge-base --is-ancestor main HEAD` → exit 0

## 证实结论

基线真 PostgreSQL 复现确认 R-06 风险成立。一次 Coordinator task 已有 1 条 canonical ProductUsage，但 8 个 Structured Model job 又在旧 `p1_usage_events` 写出 8 条 reserve 与 8 条 commit；重启 worker 重放没有产生第 9 次 provider 调用，但双账本会形成第二组用户侧扣点事实。

**基线 8 个 job 额外产生 16 条旧 usage 事件。**

基线红测命令：

```bash
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/model-supply/usage-ledger-invariants.postgres.test.ts
```

基线观测摘要：

```text
canonicalCosts: count=0, task_count=0
canonicalUsage: 1
executorCalls: 8
legacyUsageEvents: 16
supplyCosts: 8
```

## 修复后的四条不变量

1. Coordinator 是 Harness task 的唯一 ProductUsage 创建者；Structured Model job 和媒体子 job 固定 `productUsageQuantity: 0`。
2. ModelJob/ProviderAttempt 不再写零值或重复的 `p1_usage_events`，但 Foundation 与 canonical provider-cost 两条供应证据仍按 attempt 保留。
3. Structured copy 与 media 子 job 都绑定冻结快照中的同一 `billingTaskId` 和 `billingQuoteRevision`；media 不再用可漂移的 workflow id 代替 task id。
4. 8 个子 job 只对应 1 条、数量为 1 的 canonical usage；8 个实际 provider attempts 各有 1 条 observed canonical cost，worker 重放后 provider 调用与成本行仍均为 8。

T18 的 policy retry 也服从同一不变量：`execution-selection.ts` 不再转发无效的 `productUsageQuantity: 1/0`；一次主候选被拦后只重试一次，两次 ModelJob 都由 runner 固定为 cost-only，账本仍只有 1 条、数量为 1 的 ProductUsage，同时留下 2 条 observed provider cost。

Grant-lot 已经成为用量权威的路径继续保留真实 consume/refund；移除的是旧 `p1_usage_events` 中的零值影子事件，不是供应成本或退款事实。

## 复出裁决：ProductUsage 1:N SupplyRequestFreeze

本票选择甲，修改旧的“一个 ProductUsage task 最多一条 supply freeze”不变量。理由是 ProductUsage 是 Task 级用户扣点，而 SupplyRequestFreeze 是每次供应请求的不可变 route/credential/price/attempt 事实；一次 Task 合法产生 N 个 ModelJob，就必须允许一笔 ProductUsage 关联 N 条 freeze，不能丢掉第 2～N 次供应证据。

具体边界：

- migration 删除 `(workspace_id, product_usage_task_id)` 唯一索引，改为同字段加 `frozen_at, freeze_id` 的普通查询索引；migration 在隔离真 PostgreSQL schema 连续执行两次。
- `freeze_id` 主键和按 `freeze_id` 比较不可变 facts 的幂等冲突规则不变。同一 freeze 精确重放返回原事实，改写同一 freeze 仍是 `IDEMPOTENCY_CONFLICT`。
- `listByProductUsageTask(...)` 返回 Task 下全部不可变供应事实；兼容的单条读取只返回最早一条，不再把单条读取误当成基数约束。
- `ordinal` 只表示单个 ModelJob 内的 attempt 序号，不用于跨 job 选“首个供应请求”。8 个子 job 各自 ordinal 1，均可合法关联同一 ProductUsage。

修复前真 PostgreSQL 红测在同一 ProductUsage 下提交第二条不同 freeze，准确得到：

```text
IDEMPOTENCY_CONFLICT:
ProductUsage task product-usage-task-1 already has another supply freeze.
```

第二条 freeze 与第一条的 `freeze_id`、`routeSnapshotRef`、deployment、supplier request 和 provider-cost attempt 均不同；修复后两条都落库，各自精确重放后仍只有 2 行。

8-job 测试也已补齐生产形状：真实装配 `PostgresSupplyFreezeStore`、ProductUsage bridge，并给 deployment 提供可冻结的 credential/pricing facts。它不再从 bridge 前短路，最终同一 Task 持久化 8 条 freeze、8 个不同 supplier request、8 个不同 provider-cost attempt；worker 重放仍保持 8 条。

### 跨 execution snapshot / quote revision

同一 Task 的 ProductUsage 仍只能有一条，并永久绑定 Coordinator 已确认的原 `quoteId`。新的 execution snapshot 可以继续产生新的 per-request supply freeze 并关联这条 ProductUsage，但若它携带不同 quote revision，`beforeSubmit` 必须 fail closed，不能把新 revision 静默算到旧 Task 或另建第二笔 usage；要重新计价只能由 Coordinator 创建新 Task、确认新 Quote，再创建新 ProductUsage。本票真 PG 用例已断言同 Task 的 changed quote revision 返回 `INVALID_STATE`，原 usage 数量仍为 1。

## 写者集合门

静态合同扫描生产源码根 `apps/*/src`、`packages/*/src` 与 `mkfast-template-main/src`，排除 `*.test.ts(x)`，并对实际写者集合做全等断言：

- `p1_product_billing_usage` SQL 写者只有 `apps/core/src/p1/product-billing/postgres-repository.ts`。这是 canonical ProductUsage 的 PostgreSQL 存储适配器。
- `usage.reserve(...)` 调用者只有 `apps/core/src/p1/product-billing/quote-service.ts` 与 `apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts`。前者是 canonical billing 领域入口，后者是 Coordinator 提交事务中对该入口的适配调用。
- `model-supply` 与 `harness` 没有任何 `usage.reserve(...)` 调用者；新增第三个写者或调用者会直接使集合恒等断言变红。

无需 FREEZE 或 durable-service 例外 allowlist。

## 验收证据

聚焦静态、运行时与真 PostgreSQL：

```bash
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/entitlement-pools/postgres-repository.test.ts \
  src/p1/entitlement-pools/postgres-repository.postgres.test.ts \
  src/p1/harness/execution-selection.test.ts \
  src/p1/harness/unified-media-stage-ports.test.ts \
  src/p1/harness/structured-model-runtime.test.ts \
  src/p1/model-supply/foundation-ledger.test.ts \
  src/p1/model-supply/structured-node-runner.test.ts \
  src/p1/model-supply/usage-ledger-invariants.static.test.ts \
  src/p1/model-supply/foundation-ledger.postgres.test.ts \
  src/p1/model-supply/usage-ledger-invariants.postgres.test.ts
```

结果：50 tests，50 pass，0 fail，0 skip。

最终真 PostgreSQL 不变量观测：

```text
canonicalUsage: count=1, reserved_quantity=1
canonicalCosts: count=8, job_count=8, observed_count=8, task_count=1
executorCalls: 8
legacyUsageEvents: 0
supplyCosts: 8
supplyFreezes: count=8, supplier_request_count=8, provider_attempt_count=8
```

测试命令同时输出：

```text
8-job ledger: canonicalUsage=1 reservedQuantity=1 canonicalCosts=8 jobs=8 observed=8 tasks=1 executorCalls=8 legacyUsageEvents=0 supplyCosts=8 supplyFreezes=8 supplierRequests=8 providerAttempts=8
```

首次被 policy gate 拦截后重试的真 PostgreSQL 对照：

```text
winnerCandidateId: c01-retry
blockedCandidates: c01 / subject_asset_rights
canonicalUsage: count=1, reserved_quantity=1
canonicalCosts: count=2, observed_count=2
executorCalls: 2
legacyUsageEvents: 0
supplyFreezes: 2
```

浏览器商家旅程使用跨车道锁：

```bash
/Users/bin/Desktop/开发/内容无人区/美业内容2/.scratch/orca-run-2026-07-25/e2e-lock.sh \
  pnpm --filter @meiye/web e2e \
  tests/e2e/specs/assembly-gate-required-journey.spec.ts \
  tests/e2e/specs/intent-routing-http-sse.spec.ts
```

结果：3 passed（2.0m）。冷启租户第一条文案、定制入口通用模式与回答语义问题后同 Task 续跑均完成，不再出现 `ProductUsage task ... already has another supply freeze`。

受影响包类型检查：

```bash
pnpm --filter @meiye/core typecheck
```

结果：exit 0。

车道隔离的全量 Core 真 PostgreSQL 基线：

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @meiye/core test
```

运行前已验证 `DATABASE_URL` 与 `TEST_DATABASE_URL` 均指向车道隔离库 `meiye_be2`。结果：2137 tests，2127 pass，0 fail，10 skip；10 个 skip 均为需显式 opt-in 的 provider-live/MinIO 测试，不属于 T14 DoD。

差异卫生：

```bash
git diff --check
```

结果：exit 0。
