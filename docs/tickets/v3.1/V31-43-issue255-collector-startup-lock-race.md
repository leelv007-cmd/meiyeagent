# V31-43 —— issue 255 live collector 启动锁竞态（required 套件内的已知 flaky）

- Status: open
- Owner: 未指派
- Blocked-by: 无（可与 Wave 3 并行；docs-only 开票，实施 post-merge）
- 发现者: L-REL（2026-08-09，Task 6 收官认证期间）
- 归属裁决: 主控裁「既存 flaky、非 L-REL 所致、非 L-REL 所修」

## 一句话

`apps/core` required 套件里有一条**不稳定**的测试：同一 tip、同一库、同一 env 连跑会给出红/绿/绿。它不是负载假红，也不是脏库假红——两条都被实证推翻——是测试自身的启动锁竞态。

## 形态

`apps/core/src/p1/harness/issue-255-live-collector.postgres.test.ts:83`

```ts
assert.deepEqual(
  [firstStartupExecutorCalls, secondStartupExecutorCalls].sort(),
  [0, 1],
);
```

测试起两个**互相竞争**的 collector：各自一个 `Pool`（`max: 4`）、各自一份 `PostgresFoundationRepository` / `PostgresIssue255LiveReceiptRepository`，用 `Promise.allSettled` 并发调 `collectIssue255LiveAnchors`，然后断言「恰好一个执行器被调用」——即一个抢到启动锁干活、另一个被碰撞守卫挡住。

红的时候实得 `[0, 0]`：**两个都没干活**，两边都被挡。

## 证据表（全部同一 tip `53793a505`，同库 `meiye_v31_rel_verify`，同 env）

| 跑法 | 结果 | 耗时 | 日志 |
| --- | --- | --- | --- |
| 全量认证（并发受污染） | 红 `[0,0]` | 230ms | `cert.log:1609` |
| 单文件净跑 | **红** `[0,0]` | 165ms | `r2-collector.log` |
| 单文件净跑 复跑 1 | 绿 | — | `r2-coll-1.log` |
| 单文件净跑 复跑 2 | 绿 | — | `r2-coll-2.log` |
| 全量认证（净库 `meiye_v31_rel_cert2`） | 绿 | — | `cert2.log` |
| 基线（修复前） | 绿 | 865ms | `core-clean.log:1603` |

绿的时候 865ms、红的时候 165–230ms——**红是早退不是超时**，符合"两个都在启动阶段被挡住就立刻返回"。

## 三条已排除的假设（都是提出者自己推翻的，别再重走）

1. **不是负载假红。** 最初判「负载下碰撞时序翻转」。推翻依据：单文件净跑、无任何并发全量、PG 连接 12/100（`max_connections=100`）、load average 7.78，照样红。
2. **不是脏库/残留假红**（即 lane-DB 累积那条协议）。推翻依据：`issue255_live_generation_receipts`、`issue255_live_generation_authorizations`、`issue255_live_run_owners` 三表在红的那一刻都是 **0 行**。测试名里的 "cleans durable residue" 是它自己会清，清干净了。
3. **不是同批测试互相干扰。** `apps/core` 的 `test` 脚本是 `tsx --test --test-concurrency=1`，文件串行，没有兄弟文件同库并发。

## 不在 L-REL 修复面上的可达性证据

`issue-255-live-collector.postgres.test.ts` 与生产模块 `issue-255-live-collector.ts` 的 import 全集只有：`node:crypto` / `node:fs/promises` / `node:path` / `pg` / `zod` / `foundation/ports.js` / `model-supply/adapters.js` / `model-supply/tuzi-media-adapter.js` / `issue-255-calibration-guard.js` / `issue-255-provider-attempt-fence.js` / `issue-255-postgres-live-receipt.js`。

**不含** `ModelSupplyApplicationService`、`structured-nodes`、`fact-satisfaction`——L-REL 五个 commit 的三处 fail-closed 守卫在调用图上到不了它。另：`git log 445f5d235..HEAD --name-only` 对 `issue-255*` / `adapters.ts` / `calibration*` 全无命中。

## 修复方向（留给实施 lane，不预设结论）

不预判是产品缺陷还是测试缺陷——这一步要先答清楚：

- 若**启动锁本身**允许"两个竞争者都被挡住"这个终态，那是产品语义问题（谁来兜底干活？），断言 `[0,1]` 是对的，要修的是锁；
- 若那是测试给的窗口太窄（两个 collector 几乎同时进入、都还没写下 owner 行就都读到"有人在跑"），那是测试缺陷，要修的是测试的同步方式，**但不许改成 `[0,0]` 也算过**——那等于把"没人干活"验成合法态，是本波反复申明的禁令同形。

先判归属再动手。判据建议：直接看 `issue255_live_run_owners` 的写入与读取时序（是否存在两个竞争者都读到未提交/已提交 owner 的窗口）。

## 复现

```bash
cd apps/core
TEST_DATABASE_URL='postgres://…/<一次性库>' \
TEST_DBOS_SYSTEM_DATABASE_URL='postgres://…/<一次性库>_dbos' \
npx tsx --test src/p1/harness/issue-255-live-collector.postgres.test.ts
```

不稳定，需连跑数次才复现；实测 4 次里 1 红。库用 `scripts/ci/provision-test-db.sh` 建一次性库。

## Acceptance criteria

- [ ] 先给归属判定（产品语义 vs 测试同步），并写明判据
- [ ] 连跑 ≥ 20 次全绿才算修好（单次绿不构成证据——本票的红就是 4 次里 1 次）
- [ ] 不得把 `[0,0]` 纳入合法期望
- [ ] 若判为产品语义问题，另附"两竞争者都被挡"时谁兜底的设计说明
