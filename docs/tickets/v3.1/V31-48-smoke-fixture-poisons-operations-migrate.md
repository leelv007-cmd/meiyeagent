# V31-48 — dbos-registration.smoke 手写 fixture 毒化 operations migrate，级联假红

**Parent**: 无 spec 条目对应——这是**测试仪器**缺陷，不是产品缺陷；产出于 V3.1 全量修复波的假红归因（review-runner2 双树核证）
**批次**: 测试基建（与 memory / spine / confirmation 三域均不共享谓词，可独立开工，无语义锁）
**Blocked by**: None
**Related**: V31-33（同属「PG 假红」家族，但**成因不同**：V31-33 是库内残留业务行让全局扫描断言飘，本票是 schema 被毒化。两者的判别法不通用，见文末「与 V31-33 的区别」）
**Status**: open

## 为什么会有这张票

一次跑里 `dbos-registration.smoke.test.ts` 会在共享的 `TEST_DATABASE_URL` 上留下一张**两列**的 `p1_content_packages`，此后任何调用 `PostgresOperationsRepository.migrate()` 的 PG 测试都会连带失败——而失败的表现是 `p1_content_tasks` 不存在之类的**下游**症状，跟真正的根因隔着一整个 migrate 批次。已经有 lane 把这类红当成产品缺陷去查过。

> **锚署树**：本票所有行号出自**集成树** `codex/v31-integration` @ `98949870a`（w4c 树 `codex/v31-w4-tickets` 与其同基座，逐句核证在该树完成）。review-runner2 报本缺陷时同时核过 base 与集成树，**两树同构**——即这不是某次合入引入的，是既有形态。

## 机制（逐句钉死，六步）

| # | 位置 | 发生了什么 |
|---|---|---|
| 1 | `apps/core/src/p1/harness/dbos-registration.smoke.test.ts:1334-1339` | 用例 `durable r2 reask resumes the original production DBOS question exactly once`（`:1323-1324`）手写 `create table if not exists p1_content_packages (workspace_id text not null, payload jsonb not null)` —— **只有两列**。该文件既不调用 operations migrate，也**不清理**这张表（全文 `drop table` 命中数＝0），所以它活到整次跑结束 |
| 2 | `apps/core/src/p1/operations/postgres-repository.ts:363-370` | 生产 migrate 的建表语句是 `CREATE TABLE IF NOT EXISTS p1_content_packages (workspace_id, id, payload, revision, updated_at, PRIMARY KEY (workspace_id, id))` —— 表已存在 ⇒ **整句跳过**，永远不会把两列补成五列 |
| 3 | `:371-372` | 唯一的补列语句是 `ALTER TABLE p1_content_packages ADD COLUMN IF NOT EXISTS revision bigint` —— 只补 `revision`。`id` 与 `updated_at` **无人补** |
| 4 | `:376` 的 `UPDATE p1_content_packages AS package …`，在 `:399` | 引用 `package.id` ⇒ **首个失败语句**，`column package.id does not exist`（SQLSTATE `42703`） |
| 5 | `:147-536` | 这 390 行是**一个** `await database.query(\`…\`)` 调用（多语句 simple query，node-postgres 下走隐式单事务）。任一语句失败 ⇒ **整批回滚** |
| 6 | `:148`（批次开头） | 于是 `CREATE TABLE IF NOT EXISTS p1_content_tasks` 也被一起回滚，`p1_content_tasks` **永远不存在** —— 这才是下游看到的症状 |

**为什么症状离根因这么远**：第 6 步回滚掉的是**批次开头**的建表，而第 4 步的失败在批次第 230 行左右。下游拿到的红是「`relation "p1_content_tasks" does not exist`」以及一切依赖 `updated_at` 列的查询（`:454-455` 的索引、`:621` / `:724` / `:745` 的 `FROM p1_content_packages`），没有任何一条指向那张两列 fixture。

## 判定：仪器毒化，不是产品缺陷

生产链上**没有任何路径**会先建一张两列的 `p1_content_packages` 再跑 migrate——`core-assembly.ts:352` 只构造 `PostgresOperationsRepository`，建表一律走 migrate 自己的 `:363-370`。那张两列表只存在于这一个 smoke 用例里。所以：

- **不要**去改 `postgres-repository.ts` 的批次（把它拆成逐句、或给 `id` 加 `ADD COLUMN IF NOT EXISTS`）来「修」这条红。那是为了迁就一个不存在于生产的形态而弱化生产迁移。
- 要改的是 smoke 自己的 fixture。

## 受害面（18 个文件，全部共享同一 `TEST_DATABASE_URL`）

`grep -rln "new PostgresOperationsRepository(pool)" --include='*.test.ts' apps/core/src` @ `98949870a`：

```
apps/core/src/p1/creation-experience/brief-operations-atomicity.postgres.test.ts
apps/core/src/p1/execution-spine/postgres-creation-submission-store.postgres.test.ts
apps/core/src/p1/harness/delivery.postgres.test.ts
apps/core/src/p1/harness/note-page-regeneration.postgres.test.ts
apps/core/src/p1/harness/postgres-store.postgres.test.ts
apps/core/src/p1/harness/production-media-assembly.postgres.test.ts
apps/core/src/p1/model-supply/postgres-repository.test.ts
apps/core/src/p1/model-supply/video-workflow-canonical-postgres.test.ts
apps/core/src/p1/operations/composer-conversation-deletion.postgres.test.ts
apps/core/src/p1/operations/content-package-migration-cli.postgres.test.ts
apps/core/src/p1/operations/content-package-write-ownership.test.ts
apps/core/src/p1/operations/harness-copy-work-asset.postgres.test.ts
apps/core/src/p1/operations/postgres-content-package-write-adapter.postgres.test.ts
apps/core/src/p1/operations/postgres-repository.test.ts
apps/core/src/p1/operations/result-signal-revision-migration.postgres.test.ts
apps/core/src/p1/pending-actions-invariant.postgres.test.ts
apps/core/src/p1/result-delivery/assisted-canonical-repository.postgres.test.ts
apps/core/src/postgres-schema-migration.test.ts
```

**顺序依赖（关键，决定你能不能复现）**：只有在 smoke **之后**才调 migrate 的文件受害；在它之前跑完的不受影响。所以**单文件隔离跑永远看不到这条红**，必须整 glob 跑或至少让 smoke 先跑。这也解释了为什么它会被误判成产品缺陷——隔离复现失败，看起来像「只在某些环境出现」。

**`postgres-schema-migration.test.ts:158` 是特例**：它走 `migrate(client)` 分支（`postgres-repository.ts:127-137` 的 savepoint 路径），失败会打断**外层**事务，症状与其余 17 个不同。

## 修复方向（二选一，实施 lane 定；推荐 A）

**A（推荐）**：smoke 删掉手写 fixture，改成 `await new PostgresOperationsRepository(pool).migrate()`。理由——那张手写表的唯一作用是让某个 insert 有张表可写，而真实 migrate 建的表是它的**超集**；换过去顺带让 smoke 与生产 schema 同源，以后 schema 变更不会再漏这一处。

**B**：给 smoke 单独一个库。能隔离，但要么多跑一次 provision（拖慢 `core-persistence`），要么再引入一个 env，且没解决「fixture 与生产 schema 不同源」这个真问题。

## Acceptance criteria

- [ ] 在一次性新库（`scripts/ci/provision-test-db.sh`）上，`dbos-registration.smoke.test.ts` 与上列 18 个文件**同一次跑**（`--test-concurrency=1`，smoke 在前）全绿
- [ ] 该库上 `p1_content_packages` 的列集与 `postgres-repository.ts:363-370` 声明一致（至少含 `id` / `revision` / `updated_at`）
- [ ] **变异反证**：把 smoke 的 fixture 改回两列 ⇒ 上列 18 个中至少一个**必须变红**，且红是 `p1_content_tasks`/`42703` 家族。改后立即还原，终态 `git status --porcelain` 空。（这条是为了证明本票的门有鉴别力，而不是被别的改动顺手治好）
- [ ] 该 smoke 在**无 `TEST_DATABASE_URL`** 的门上的行为被裁决（见下节「顺带发现」）——不是可选项，因为它决定了上面三条该在哪个 required job 上被证明

## 顺带发现（需主控裁决，不要在本票里悄悄改）

`dbos-registration.smoke.test.ts:59-72` 在**模块顶层**调 `requireSmokeDatabaseUrl`，缺 env 即抛。文件自己的注释（`:52-58`）说这是刻意的：「It used to gate every case on `{ skip: !systemDatabaseUrl }`, which turned a missing env into `# SKIP` — a silent pass… A missing URL now throws at module load and fails the whole file.」——这个设计本身是对的（拒绝静默 SKIP）。

但它与 CI 的组合有个对不上的地方，**本轮只报不改**：

| job | 命令 | 有 `TEST_DATABASE_URL` 吗 | 代码强迫的推论 |
|---|---|---|---|
| `core`（`core-quality.yml:144`，`required` 依赖项） | `pnpm --filter @meiye/core test` ＝ `tsx --test --test-concurrency=1 'src/**/*.test.ts'`（`apps/core/package.json:41`） | **没有**（`:162-163` 只设 `NODE_OPTIONS`） | 该 glob 匹配 `.smoke.test.ts`，模块顶层抛 ⇒ 该文件在 `core` 上应当是红的 |
| `core-persistence`（`:254`，`required` 依赖项） | `scripts/ci/run-core-persistence.sh:14` 同一 glob | **有**（job 级 env `:270-272`，且 `:286-290` 与脚本 `:10` 双重 provision） | 这里才是 smoke 真正能跑的门 |

我**没有**运行 CI，所以不断言「`core` 门现在是红的」。可能的解释至少三种，需要有 CI 读权限的人核一次：(a) `core` 确实红着；(b) 有我没找到的 env 注入；(c) 运行器对模块顶层抛的处理与我推断的不同。这条与「required 门可被失败生成通过」是**不同**的问题，别合并处理。

## Evidence

| # | 证据 | 落点（署树 `98949870a`） | 结论 |
|---|---|---|---|
| 1 | smoke 手写两列 fixture，且全文无 `drop table` | `dbos-registration.smoke.test.ts:1334-1339` | 毒化源确认，且不自清理 |
| 2 | 生产建表被 `IF NOT EXISTS` 跳过，补列只补 `revision` | `postgres-repository.ts:363-370` / `:371-372` | 两列表永远不会被补全 |
| 3 | 首个失败语句引用不存在的列 | `postgres-repository.ts:399`（`package.id`），语句起于 `:376` | `42703`，静态可判，无需跑库 |
| 4 | 390 行为**一个** query 调用 ⇒ 整批回滚 | `postgres-repository.ts:147-536` | `:148` 的 `p1_content_tasks` 建表被连带回滚 |
| 5 | 受害文件 18 个 | 上节清单 | 级联面确认 |
| 6 | 生产侧无两列形态 | `core-assembly.ts:352`（只构造，不建表） | 判为仪器毒化而非产品缺陷 |
| 7 | base 与集成树同构 | review-runner2 双树核证 | 非某次合入引入 |
| 8 | 「21 条级联红」的具体清单与计数 | — | **未由本票作者复现**：该数字来自 review-runner2 报给主控的复核，本票只落机制与静态受害面（18 文件）。实施 lane 若数字对不上，先按 AC1 在一次性新库上重测，不要改本票的 18 文件清单去凑 21 |

## 独立旁证：另一条 lane 在一次性新库上量到稳定的 12 pass / 7 fail（2026-08-10）

W4-B 4A 的 commit `d83bbdbca` 在做无关修复的回归时，**顺手给本票提供了一组比开票时更硬的数字**（其 commit message 自带）：`dbos-registration.smoke.test.ts` 在**一次性新库**上，**带与不带 4A 修复各跑一次**，两次都是 **12 pass / 7 fail**，且按用例名排序后的 pass/fail 清单 **diff 为空**。该 message 自己把这 7 个失败称作 **base-level `dbos-registration.smoke` defect**，并指出 T9 的 merge commit message 里已经提过。

**这组数字为本票加了三件事**：

1. **失败数是确定的 7，不是浮动的**——两次独立运行、逐用例名比对完全一致。这排除了「负载性抖动」这一类解释。
2. **它与 4A 域的改动完全解耦**——带与不带修复结果相同，所以任何 lane 若在自己的改动后看到这 7 个，不要当成自己引入的回归。
3. **它是在一次性新库上量到的**，说明本票的毒化在**新库上照样发生**——这与本票「一次性新库不能治」的判据（见下节对照表）互为印证：smoke 在同一次跑里当场把新库毒了。

**对派件里「21 条级联红」的口径**：本票 Evidence 第 8 行已标注那个数字未由本票作者复现；现在多了一个**同样未由本票作者复现但来自另一条 lane 的 7**。两个数字统计的范围不同（7＝smoke 文件自身的失败用例数；21＝派件描述的级联面），**不要相减也不要相互替换**。实施时按 AC1 在一次性新库上实测，以实测为准。

## 与 V31-33 的区别（别把两种假红的判别法混用）

| | V31-33（库内残留行） | V31-48（schema 毒化） |
|---|---|---|
| 症状 | 断言的**数字**不对（`attempted: 4` vs `1`） | `relation … does not exist` / `42703` |
| 随什么缩放 | 库内业务行数 | 不缩放——要么中毒要么不中毒 |
| 一次性新库能否治 | **能**（这是 V31-33 的判据） | **不能**——smoke 在同一次跑里当场把新库毒了 |
| 单文件隔离能否复现 | 通常不能（新库即绿） | 也不能，但原因相反：隔离时 smoke 没跑 |
| 归因 | 产品缺陷（全局扫描无租户作用域）＋测试脆弱 | 纯仪器缺陷 |

**给后续 lane 的判别口径**：拿到 PG 红先看**红的形态**再看库。数字型 → 查残留行（V31-33）；`does not exist` / `42703` 型 → 查是否整 glob 跑过 smoke（本票）。「换一次性新库就好了」这条启发式**只对前者成立**。

## 留痕

- 开票：review-runner2 在 V3.1 全量修复波双树核证中定位（base 与集成树同构），主控判为仪器毒化并派 review-memory 落票（2026-08-10）。
- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`，基座 `98949870a`）：把机制从「fixture 导致 migrate 回滚」钉到语句级——首个失败语句＝`postgres-repository.ts:376` 的 UPDATE 在 `:399` 引用 `package.id`，批次边界＝`:147-536` 单 query 390 行；静态列出 18 个受害文件；标注顺序依赖（隔离跑不可复现）；报出 `core` 门与模块顶层抛的组合疑点（只报不改）；明确「21 条」未由本票作者复现。本 commit 对 `apps/core`、`mkfast-template-main`、`packages`、`scripts`、`.github` 零改动。
