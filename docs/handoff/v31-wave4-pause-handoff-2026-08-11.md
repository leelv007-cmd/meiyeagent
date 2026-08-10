# V3.1 Wave-4 暂停交接（2026-08-11）

> 状态：用户要求暂停。本文是恢复 Wave-4 的唯一增量入口；先读
> `docs/handoff/v31-wave4-closeout-handoff-2026-08-10.md`、
> `docs/handoff/v3.1-full-remediation-handoff-2026-08-09.md` 与
> `docs/superpowers/plans/2026-08-09-v31-full-remediation.md`，再按本文的
> 当前 HEAD 和未完成证据继续。不得把已定向通过的测试等同于 Wave-4 完成。

## 1. 停止点与安全边界

- 集成 worktree：`/Users/bin/Desktop/开发/内容无人区/美业内容2-v31-integration`
- 分支：`codex/v31-integration`
- 当前 HEAD：`cebad27847e5b5245be573c936b42183cc9a7cab`
  (`merge: bind legacy inventory to admitted plan authority`)
- 集成树在暂停时 clean；所有提交均未 push。
- 本地 `main`、`codex/v31-integration` 与远端 `meiyeagent/main` 历史不连续。
  **禁止**推送 `integration:main`。最终仅在全部验收后由主控执行：
  `git -C /Users/bin/Desktop/开发/内容无人区/美业内容2-v31-integration push -u meiyeagent codex/v31-integration`。
- 不杀占用 3001 的既有 DBOS admin 进程。浏览器验收必须经 `e2e-lock.sh`，使用独立端口及独立 business/DBOS 数据库；不要打印连接串或 trace 内的认证信息。
- Node 22、pnpm 10.30.3 是验收环境。PG 被 skip、`--list`、直接 API/DB 探针或有条件 `isVisible` 都不构成旅程验收。

## 2. 暂停前已进入集成树的提交

| 集成 merge | 候选提交 | 当前结论 | 已有证据 / 仍缺 |
|---|---|---|---|
| `6463cf73e` | `453c501f7` | B2 memory provenance 合入 | 集成树重跑 Core 定向 `ai-sdk-runner` + `memory-foundation-module` 为 34/34；lane 已跑 contracts、web interaction、quality gates、包级 typecheck/check。仍缺最终 HEAD 的真实 B2 Chromium + PG/DBOS 证据。 |
| `cebad2784` | `58fc83e00` | legacy inventory authority 合入 | lane fresh PG 三套 20/20、Core typecheck 通过，独立复审接受。仍缺最终集成 HEAD 的持久层与发布门复验。 |
| `fffee7ee4` | `43a2b9bd7` | persisted agent run authority 合入 | 48/48 focused、Core typecheck；复审确认 exact run/thread pair、legacy fallback 与 replay fingerprint 兼容。Composer session 后续动作仍会重算 runId，另列待办，不能把它误称为完全收口。 |
| `458fa8ffd` | `1bb110e08` | snapshot seal authority 合入 | fresh PG 5/5，跨 task/workspace 均 fail-closed。 |
| `3d6d442d7` | `63ceff341` | DBOS canonical workflow authority 合入 | 入口与后段都用 canonical plan workflow ID，不能按 hash 反查后自证。 |
| `1d24ab24d` | `b2056e253` | rights revision 第二臂合入 | 真实 resolver compile→verify current，32/32 focused + Core typecheck；仍需 B2/Ops 真实浏览器复验和 V31-55 浏览器变异反证。 |
| `08a50f95f` | `18969cc32` | Living Plan `/revise` 合入 | 修改计划时保留既有 prepared task；仍需最终 Chromium 重验。 |

### B2 的具体边界

`453c501f7` 只修正 fixture 分类与 receipt 的 query-time 来源投影：两条长期偏好不再被误分到同一 semantic key；存储 put-once identity、冲突判定和 `ReuseMemoryService` 去重均未改变。receipt/vault 的来源包括受限 preview、observedAt 与 deleted 投影；历史无来源安全回退。不要为了让 B2 绿而删除 selector 去重。

当前根 `pnpm typecheck` 的已知基线阻断是未改文件
`tests/v31-artifact-composer-sse-workbench.journey.test.ts:78` 中 fake
`ComposerPlanCompilerPort` 缺 `retrieveConfirmedExperience`。恢复时先复核该事实，
再最小修复 fake 或按接口 owner 归票；不要把它归因于 B2。

## 3. 已提交、未合入候选：Living Plan `/start`

- worktree：`/Users/bin/Desktop/开发/内容无人区/美业内容2-v31-w4-start-trace`
- 分支：`codex/v31-w4-start-trace`
- 候选：`fcd042758` (`fix(web): drain living plan start response`)，worktree clean，未 push。
- 改动仅两文件：`use-living-plan-controller.ts` 与 interaction test。客户端原先只检查
  `/start` 的 `response.ok`，没有消费 202 body；现在通过既有 `readP1Envelope` 消费并解析 envelope，失败才 toast。

已证实的行为链：等价 direct Core probe 在真实 confirmation 后 202 body 正常结束；旧 public
请求只有 headers、没有 EOF；消费 response 后 focused probe 得到 `202`、`817 bytes`、
`requestfinished`。证据在：

- `/private/tmp/v31-w4-start-trace/e2e-client-eof.log`
- `/private/tmp/v31-w4-start-trace/e2e-final.log`

原无 debug 单 case 已不再卡在原 `response.text()` 断言（原 line 355）；它继续推进到
delivery card 180s 不出现（line 379），因此该 commit 只解决 `/start` body completion，
**不**解决 delivery 投影。恢复后先做独立 review，确认错误 envelope 不会被吞掉、不会重复
start；再跑 controller interaction、Web typecheck/check 和原单 case。只有 review 与定向验收
均通过才可 merge。delivery card 缺失须单独诊断/归票，不扩大该 commit。

## 4. 最高风险未提交 WIP：V31-57 expiry / billing identity

- worktree：`/Users/bin/Desktop/开发/内容无人区/美业内容2-v31-w4-expiry`
- 分支：`codex/v31-w4-expiry`
- 起点提交 `1d62a2c70` **已被独立审查拒绝，绝对不得合入**。
- 暂停时有 11 个已修改、未提交文件，约 `+1157/-56`，`git diff --check` 通过：
  `billing-compensation*`、`dbos-workflow*`、`postgres-store.ts`、
  `product-billing-settlement*`、`reservation-sweeper*`。
  保留该 worktree，不要 `reset`、`clean`、整体 cherry-pick 或把 WIP 当作已验收修复。

根因是 prepared workflow ID 与账务 source task ID 已分裂：sweeper/DBOS fence、root
observability 必须使用 workflow identity，而 quote、ProductUsage、credit settlement/refund
必须使用经 reservation/quote 绑定的 billing identity。旧 `1d62a2c70` 的三条阻断：

1. 把 source ID 交给真实 settlement executor，退款落账后 root axes 查不到，processing 会永久 stale retry。
2. stale reclaim 先认领再通过最终 `INNER JOIN task_requests` 丢弃 orphan 行，导致静默续租。
3. `sourceTaskId` 未和 usageReservation/quote 绑定，同 workspace 可错误退款另一笔账。

暂停时的 WIP 目标是：新增显式 `billingTaskId`（workflow `taskId` 仍供 observability）、
在 `reservation_sweeps` 持久化 billing identity、严格绑定 request/source/reservation/quote、
stale reclaim 不再依赖最终 inner join、为 compensation queue 持久化 billing identity 并按
workspace+billing identity 做 fence/recovery。先恢复完整审查，再按以下公共 seam 重跑 RED→GREEN：

1. 真实 `HarnessProductBillingSettlementExecutor` 的 split-ID refund。
2. refund 后、expire/markCompleted 前 crash，强制 stale lease 后重启：只退款一次、余额恢复、
   workflow axes 正确、sweep completed。
3. 缺 request/orphan、伪造 source/usageReservation/quote 绑定、跨 workspace、旧同-ID 回退均 fail-closed 或明确 dead-letter，绝不能静默循环。
4. compensation 中同 billing identity 的相反 action 不能因不同 plan workflow 绕过 fence。

所有上述 fresh PG/DBOS 验收完成、diff 审查通过、独立 review 接受后，才可新建 commit；之后才跑
V31-57 的单个 Chromium expiry case。若 DBOS 普通 settlement 仍把 prepared workflow 当 billing
task，开 V31-59（不要在没有证据前勾关闭）。

## 5. 尚未开始的 required browser specs

两条 lane 已被暂停且 clean，均基于 `fffee7ee4`，没有可合并代码：

| worktree / branch | 必须实现的真实 UI 旅程 |
|---|---|
| `/Users/bin/Desktop/开发/内容无人区/美业内容2-v31-level1-copy-journey` / `codex/v31-level1-copy-journey` | `v31-level1-copy-journey.spec.ts`：policy-exempt copy 不确认、quote chip 持续、余额不足的两个出口、冻结 plan/quote/release 与真实 replay 不重复扣费。 |
| `/Users/bin/Desktop/开发/内容无人区/美业内容2-v31-w4-artifact-growth` / `codex/v31-w4-artifact-growth` | `v31-artifact-growth-journey.spec.ts`：stable Artifact ID、内容更新不长新 node、左右角色区分、无 candidate/result/delivery 三重卡。 |

B2 merge 已把 canonical B2 指向现有 `v31-memory-injection-b2-journey.spec.ts`。恢复时先执行
`bash scripts/ci/run-v31-browser-acceptance.sh` 复核缺项；预期这两条缺失 spec 会使脚本 fail before browser。
两个 spec 都必须从真实 UI 开始，不允许 API-only 替代、条件空转或 route fulfill。

## 6. 未关闭票据与最终验收清单

- V31-55：rights revision 代码臂已合入，但 B2/Ops 真实旅程及浏览器 mutation 反证尚未完成。
- V31-18：AC3 等 B2 真旅程，AC4 等 production-main-journey。
- V31-28：context-fence、typed interrupt/partial resume 的可见 UI 证据仍欠；不得因定向 unit 绿而勾 AC。
- V31-56：`/revise` 已修；`/start` pending 本文 §3 候选，delivery card 是独立症状。
- V31-57：本文 §4，未完成。
- V31-58 是 rights-revocation test-contract mismatch，已 resolved；不要重开 production bug。
- 建议待 expiry 结论后决定是否新开 V31-59（prepared workflow ordinary settlement billing ID）与
  V31-60（Composer session 后续操作重算 persisted agent run ID）。先检查 README 编号和现有票，避免冲突。

W4-E 深评、逐 AC evidence 回填、full required gate、发布和 Wave-4 盖章全都**未完成**。
S3/S4 仍有 eval synthetic proxy gates、legacy rollback drift、弱浏览器契约与外部 pilot 26b 等更大范围债；
除 26b 外不得以“已暂停”或“已有 ticket”伪装完整。

## 7. 恢复顺序（不得跳步）

1. 在每个 worktree 先读 `AGENTS.md`、`CONTEXT.md`、本文和对应 V31 ticket；确认分支、
   HEAD、`git status`，保存 WIP patch 前不做 rebase/cleanup。
2. 独立审查 `fcd042758`，通过后 merge；delivery failure 另起诊断。
3. 完成并独立审查 expiry WIP，不合入被拒的 `1d62a2c70`。
4. 写完并验收 Level-1 copy 与 Artifact growth 两条真实 UI spec，再更新 gate/catalog。
5. 所有候选合入后，在 **最终 integration HEAD** 执行：Core/Web/contract typecheck 与 check、
   `node --test scripts/ci/*.test.mjs`、fresh business+DBOS PG suites、B2/Ops/Living/expiry/rights/
   Level-1/Artifact Chromium specs，最后完整 `run-v31-browser-acceptance.sh`。
6. 回填每张票的 writer/consumer/failure-recovery/unit/PG/Playwright/required-job 证据；重新跑
   W4-E 深评，确认除明确 external-blocked V31-26b 外没有 actionable red，再考虑 push 新远端分支。

## 8. 暂停时的最小复核记录

在 `cebad2784` 上已实际运行：

```text
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/model-supply/ai-sdk-runner.test.ts \
  src/p1/operations/memory-foundation-module.test.ts
# 34 pass, 0 fail
```

这是 B2 的 focused 回归，不是最终门。恢复时以新的最终 HEAD、独立数据库和真实浏览器结果覆盖此记录。
