# 代发已入库表的处置记录（#263 任务 4 / D-155 修订）

- 日期：2026-07-31
- 决策依据：D-155 修订「归档 ≠ 丢弃……`douyin_publish_jobs` 等已入库表的处置随归档票单独判断（**表与代码的生命周期不同**）」
- 相关：`docs/reviews/p1-integrations-liveness-audit-2026-07-31.md`、`docs/ops/frozen-publish-face-retrieval-runbook-2026-07-31.md`

## 结论

**五张代发表一律不动：不 DROP、不改结构、不迁移、不清历史数据。** 代码停止创建它们，仅此而已。

## 表清单

| 表名 | 原 DDL 位置（锚点） | 内容 | 处置 |
|---|---|---|---|
| `douyin_publish_jobs` | `postgres-repository.ts:131-143` | 代发作业（状态／轮询／验收） | 保留 |
| `douyin_publish_confirmations` | `:122-129` | 发布前的人工确认记录 | 保留 |
| `douyin_observe_snapshots` | `:144-151` | 抖音观测数据快照 | 保留 |
| `douyin_observe_states` | `:152-158` | 每连接的观测同步状态 | 保留 |
| `douyin_oauth_refresh_operations` | `:107-120` | OAuth 续期三段式操作 | 保留 |

这五张表的 DDL 在锚点时是 `migrate()` 里连续的一段（107–158 行，中间无其他表），已整段移出。

## 三个行为后果，逐条说清

### 1. 新库不再有这五张表

`migrate()` 不再 `CREATE TABLE IF NOT EXISTS` 它们。归档之后新建的任何数据库（含 CI／e2e 冷库）都不会出现这五张表。**这是预期行为**，也是「主干删除」的应有之义。

### 2. 旧库原样保留，一行数据都不动

归档前已 provision 的库仍持有这五张表及其全部历史行。本轮**没有**写任何 `DROP TABLE`、`DELETE`、迁移脚本或数据导出。理由：D-155 明文把表的生命周期与代码分开；解冻时这些行可能是唯一的历史依据，删了不可逆。

### 3. 工作区注销仍然清得干净（本轮唯一的行为增补）

`PostgresIntegrationRepository.deleteWorkspaceFacts()` 原本把这五张表硬编码在清理列表里。若照原样删掉表名，**旧库的工作区注销会漏清代发历史行**（个人信息残留）；若照原样保留表名，**新库的工作区注销会因 `relation does not exist` 直接抛错**。

两个都不可接受，故改为守卫式清理：共用表照旧无条件清，五张退役表先 `SELECT to_regclass($1)` 探在不在，在才清。

```
apps/core/src/p1/integrations/postgres-repository.ts  （deleteWorkspaceFacts）
```

- 旧库：五张表存在 → 照常清理，**注销行为与归档前完全一致**
- 新库：五张表不存在 → 跳过，不抛错

这是本轮对表相关行为的**唯一**改动，方向是「保持既有正确性」，不是新增能力。

## 运维备注

- 若某套环境确定不再需要这些历史行（例如合规要求彻底清除），DROP 由运维单独执行并单独留痕，**不要**把它写进 `migrate()`——`migrate()` 会对所有环境生效，包含还需要留档的那些。
- 取回代发代码时，`migrate()` 会自动把五张表在新库补建齐（`IF NOT EXISTS`），旧库直接复用既有表。取回步骤见取回 runbook「取回后必须自己补的偏移」第 1 条。
- 四张共用表（`integration_connections`／`integration_credential_bindings`／`integration_credential_versions`／`integration_external_events`）中存有 `provider = 'douyin'` 的历史行。表结构与数据均未改动；`IntegrationProvider` 类型也特意保留了 `'douyin'` 枚举项，使这些行仍能被正常读出（活性核查表 §5 存疑②）。已无任何代码路径能**新建**抖音连接。
