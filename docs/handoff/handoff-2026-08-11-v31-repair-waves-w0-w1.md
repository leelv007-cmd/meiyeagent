# Handoff — V3.1 Repair Waves W0/W1 中途交接（2026-08-11 晚）

> 依据：`docs/reviews/meiyeagent-v3.1-agent-repair-backlog-current-2026-08-11.yaml` + `docs/reviews/meiyeagent-v3.1-current-implementation-deep-review-2026-08-11.md`
> 分支：`repair/v31-current-review`（基于 `main@cffc41f6`，当前 HEAD = `00106b87`）
> 全部证据必须同 SHA；`done` 必须记录 commit_sha / workflow_run_id / artifact_digest。

---

## 1. 已完成并提交（3 个 commit，同一分支）

| commit | 任务 | 内容 | 验证状态 |
|---|---|---|---|
| `84112a37` | **R-P0-00**（Wave 0） | main 分支保护已启用（gh api，required=`Core quality / required` + strict + enforce_admins + 1 review）；62 张票面回填 `Implementation state / Verification state / Evidence SHA / Workflow Run / Artifact Digest` 字段（backfill 脚本 `scripts/ci/backfill-v31-evidence.mjs`，SHA 均人工核对为 HEAD 祖先）；`assert-v31-ticket-index.mjs` 扩展 3 条 fail-closed：no-push 声明但 SHA 可达、done 无 Evidence SHA、Evidence SHA 非祖先；README 状态表同步 | 16/16 mutation tests 绿；index check OK（仅 warnings） |
| `5431c6b5` | **R-P0-01 / R-P0-02 / R-P0-04 / R-P0-07**（Wave 1 Lane A/B/C） | Core 编译恢复（StoreProfile 单一 adapter、executionPlans fixture、campaign quote 去 operation、branded ID constructor）；视频 canonical contract 删 subtitles/cover + export adapter fail-closed legacy 门 + `hasValidComposedVideoProvenance` 重写；依赖安全（nanoid 5.1.16 / undici 7.29.0 / js-yaml 4.3.1 / nanoid 3.3.18 via postcss 8.5.26，**0 waiver**）；prompt 11 点 guard + recipe/source/catalog/skill 真权威 + release constructive coverage gate（`assert-harness-release-coverage.mts`） | contracts/core typecheck 0；core 3749 pass / 0 fail（无 DB）；视频 PG 14/14、model-supply PG 21/21；`assert-production-audit` exit 0（high=0 critical=0） |
| `00106b87` | **R-P0-03**（Wave 1，部分） | root-quality 结构修复：core `test` 排除 DB-only `dbos-registration.smoke`（persistence 脚本保留全量 glob + `assert-core-persistence-ran` 断言）；web typecheck 4 处（vite socket plugin 重载、onclose arity）；artifact-SSE journey fixture 补 `retrieveConfirmedExperience`；Biome 7 文件；recipe lifecycle interaction 超时 30s（负载 flaky） | root typecheck 0、build 0、Biome 0、interaction 全绿；**root-quality 脚本整体未跑完**（bundle-budget/secret-scan/journeys 需单独验证） |

## 2. 已做但**未提交**（R-P0-05 半成品，已 stash）

**卡点说明**：R-P0-05（canonical BillingIdentity）agent 改到一半被取消，改动**不是可编译状态**，未达 exit criteria，因此不入 commit。已用两个 stash 完整保留，**不要丢**：

- `stash@{1}`：`WIP R-P0-05 billing-identity half-done (typecheck RED) - resume from handoff` —— 已跟踪文件改动：
  - `execution-spine/content-package-revision-port.ts` + `.test.ts`
  - `harness/billing-compensation.ts` + `.test.ts`
  - `harness/postgres-billing-compensation-store.ts` + `.postgres.test.ts`
  - `harness/product-billing-settlement.ts` + `.test.ts`
  - `harness/task-admission.ts` + `.test.ts`
  - `harness/postgres-store.ts`、`harness/dbos-workflow.ts` + `.test.ts`、`harness/reservation-sweeper.*`、`harness/canonical-observability-emitters.postgres.test.ts`、`harness/user-selected-skill-admission.test.ts`、`harness/dbos-registration.smoke.test.ts`、`agent-session/postgres-execution-confirmation.postgres.test.ts`、`credit-billing/postgres-credit-ledger.postgres.test.ts`
- `stash@{0}`：`WIP R-P0-05 new untracked billing files` —— 新增文件：
  - `execution-spine/billing-identity.ts`（canonical BillingIdentity 类型/构造）
  - `execution-spine/billing-identity.test.ts`
  - `execution-spine/derived-revision-billing.test.ts`

恢复方式：`git stash pop stash@{0} && git stash pop stash@{1}`（顺序先弹新文件再弹改动，若冲突按文件逐个处理）。

**R-P0-05 残留问题（恢复后 typecheck 红，需继续修）**：
1. `billing-identity.test.ts:40,156,165` —— 构造参数含 `units` 但 `BillingIdentity` 类型只收 `id/creditUsageOperationId`：类型或 fixture 二选一对齐。
2. `derived-revision-billing.test.ts:97` —— `clock: () => Date` 与 `{ usageLedger?, providerCostStore?, clock?: (() => Date) | undefined }` 形状冲突，看构造签名。
3. `postgres-execution-confirmation.postgres.test.ts:498` —— fixture 缺 `actorId/packageId/expectedRevision/workflowRevision` 等 `HarnessWorkflowInput` 必填字段。
4. 恢复后跑 `pnpm --filter @meiye/core typecheck` 直到 0，再跑 billing 域测试 + 对应 PG 套件。

**R-P0-05 任务原文**（backlog yaml）：admission 产生不可变 BillingIdentity（冻结 workspace/task/work/workflow/plan/snapshot/quote/reservation/carrier unit）；settle/refund/expiry/replay/provider attempt 只接受该 identity，禁止 fallback 猜测；derived_revision 必须创建修改对象并走 quote/reserve/settle（V31-45，删直写捷径）；Campaign 每个付费 child Work 单独 exact quote/rights/confirmation；per-carrier settlement 独立幂等键。exit：duplicate debit=0、wrong refund/silent miss=0、UI 计费文案与账本一致。禁止 `workflowId ?? sourceTaskId`、禁止盲重提、禁止 derived revision 免费。

## 3. 未开始（Wave 1 剩余，依赖链）

- **R-P0-06**（恢复链路终止性，depends R-P0-05）：decision null→失败而非空 waiting；systemOnlyBlock 可操作阻塞面；ask_merchant 跨设备恢复；prepare transient/terminal 分类 + dead-letter/refund；submit/read model 消费 terminal state；三处 confirmed silent-empty fail closed。exit：当前 7 个 DBOS persistence 失败归零（**注意：这些失败此刻仍在**，见下节）。
- **R-P0-08**（Plan outbox，depends R-P0-06）：workspaceId 必填（禁 threadId fallback）；outbox payload 唯一 canonical；attempts/nextAttemptAt/lastError/dead-letter/age；ON CONFLICT 后验 exact eventId/payload/revision；typed conflict。
- **R-P0-03 收尾**：opt-in evidence 91 条 stale（73 已有记录 + 22 新套件无记录）**未更新**——guard 要求真实 fresh-DB 运行后按结果回填 `verifiedAt`，禁止批量伪造；bundle-budget/secret-scan/journeys 三个 root gate 未验证。
- **W2 全部**（R-P1-01 A–K browser、R-P1-02 shadow observation、R-P1-03 Memory、R-P1-04 SSR、R-P1-05 杂票）与 **W3**（blocked）。

## 4. 当前已知红（基线现状，勿误判为回归）

用 `TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54445/meiye_p0r03_fresh` + `TEST_DBOS_SYSTEM_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54445/meiye_p0r03_dbos` 跑 `scripts/ci/run-core-persistence.sh`（fresh DB 已 provision 好，全量 4186 tests）：

```
✖ confirmation timeout exits DBOS pending state and delivers the generic route
✖ typed confirmation timeout persists system_default and resumes the production DBOS topic
✖ an unacknowledged renderer expires and refunds after DBOS cold recovery
✖ a pre-be bounded hold input exits its old unbounded branch after cold recovery
✖ a pre-T45 pending function-ID layout replays without branching or failure
✖ a pre-C1 held function-ID layout replays without branching or failure
✖ a run without a usage reservation never arms core auto-continuation
✖ production image media assembly durably joins admission to ContentPackage delivery
```

这 8 个是 review 已记录的 DBOS timeout/replay 家族（R-P0-06 范围，前 7 个）+ `legacy_shadow_observation` durable stage 裁决（R-P1-02，第 8 个）。**属于待修任务而非新回归**。R-P0-05/06 完成后必须重跑确认归零。

## 5. 环境备忘

- gh 已登录 leelv009（admin）；main 分支保护已开，**只能走 PR 合入**（本分支最终 push + PR）。
- Docker PG 容器：`meiye-v31-task3-pg24`（5432 映射到 54445）；fresh 库 `meiye_p0r03_fresh` / `meiye_p0r03_dbos` 已 provision（schema + DBOS system storage）。
- 常用命令：`pnpm --filter @meiye/contracts typecheck` / `pnpm --filter @meiye/core typecheck` / `pnpm typecheck` / `pnpm build` / `pnpm --filter @meiye/web check`（Biome）/ `pnpm --filter @meiye/web test:interaction`。
- 本分支当前未 push。合入纪律：票据状态 + 证据字段 + CI 同 SHA 绿后才能改票面 done。

## 6. 下一步建议顺序

1. `git stash pop stash@{0}` + `stash@{1}` 恢复 R-P0-05，修 3 个 typecheck 残留 → 全绿 → 补 mutation/重放测试 → commit。
2. R-P0-06（DBOS 恢复，必须等 R-P0-05 绿）→ 8 个 persistence 失败归零 → R-P0-08（outbox）。
3. R-P0-03 收尾：root-quality 全 gate 单独验证 + fresh-DB 全量跑完回填 opt-in evidence。
4. W2（R-P1-01..05）→ W3（需真实商家试点，属阻塞项）。
