# 冻结面取回 runbook（抖音代发 / D-155）

- 归档日期：2026-07-31（#263）
- 归档位置：`references/frozen-publish-face-2026-07-31/`
- 归档锚点：main `b7a426cae21c16a8e164bd4b36eac3ae3e55ee4d`
- 删除提交：`30b8ea37`（core）、`f7a38e96`（web）
- 活性核查表：`docs/reviews/p1-integrations-liveness-audit-2026-07-31.md`

**归档 ≠ 丢弃。** 本文写明如何把代发面完整取回，并诚实列出取回后仍需自己补的偏移。

## 归档物是什么

```
references/frozen-publish-face-2026-07-31/
├── restore.patch          # 反向补丁：打上去即回到锚点状态（唯一可执行的取回件）
└── snapshot/              # 59 个被改/被删文件在锚点时的完整原件（按仓内相对路径存放）
    ├── apps/core/src/p1/integrations/…（40 个）
    ├── apps/core/src/{main,server,job-worker}.ts
    ├── apps/core/src/product/publish-content-snapshot{,.test}.ts
    ├── apps/core/src/p1/foundation/application-service.ts
    ├── packages/contracts/src/capability-permission.ts
    └── mkfast-template-main/…（前端 12 件＋ zh/en 文案）
```

两条独立取回路径：**补丁**（推荐，能合并后续演进）与**快照**（补丁冲突时的逐文件底稿）。`references/` 在 `.gitignore` 内，这些文件是 `git add -f` 强制入仓的——`git ls-files references/frozen-publish-face-2026-07-31/` 应返回 60 个路径，返回空说明归档没进版本库，停下来找主控。

## 路径 A：打补丁（首选）

```bash
git switch -c restore/publish-face
git apply --check references/frozen-publish-face-2026-07-31/restore.patch   # 先干跑
git apply         references/frozen-publish-face-2026-07-31/restore.patch
pnpm install
pnpm --filter @meiye/core typecheck && pnpm --filter @meiye/core test
pnpm --filter @meiye/web  typecheck && pnpm --filter @meiye/web  test
```

`--check` 报冲突说明主干已在这些文件上前进（大概率是 `application-service.ts`／`main.ts`／`contracts.ts` 这几个混装面）。此时改用三路合并，把冲突留在工作区自己解：

```bash
git apply --3way references/frozen-publish-face-2026-07-31/restore.patch
```

**注意补丁的方向**：`restore.patch` 是「当前 → 锚点」的差分，只覆盖 `apps/`、`packages/`、`mkfast-template-main/` 三个路径，不含 `references/` 自身，所以打上去不会把归档删掉。它会把这些路径整体拉回锚点状态——**若主干在锚点之后对同一批文件做过与代发无关的改进（例如飞书面、凭据面的修复），直接打补丁会把那些改进一起回退。** 取回时务必先看：

```bash
git log --oneline b7a426cae21c16a8e164bd4b36eac3ae3e55ee4d..HEAD -- \
  apps/core/src/p1/integrations apps/core/src/main.ts apps/core/src/server.ts
```

有输出就走 `--3way`，逐个冲突判断保留哪边。

## 路径 B：逐文件取快照

补丁彻底打不动时（例如目录已重命名），从 `snapshot/` 取原件：

```bash
cp -R references/frozen-publish-face-2026-07-31/snapshot/apps/core/src/p1/integrations/. \
      apps/core/src/p1/integrations/
```

快照是**锚点时的整份文件**，不是代发片段——因为代发代码与活代码在同一批文件里交织，单独抽出来不可编译。所以路径 B 等于「用旧版整文件覆盖新版」，覆盖前必须先 diff：

```bash
diff -u apps/core/src/p1/integrations/application-service.ts \
        references/frozen-publish-face-2026-07-31/snapshot/apps/core/src/p1/integrations/application-service.ts
```

## 取回后必须自己补的偏移（已知，不会由补丁带回）

1. **数据库表**。归档只停止建表，没有删表也没有迁移。取回后：
   - 锚点之后新建的库**没有**这五张表（`douyin_publish_jobs`／`douyin_publish_confirmations`／`douyin_observe_snapshots`／`douyin_observe_states`／`douyin_oauth_refresh_operations`）。取回代码后 `PostgresIntegrationRepository.migrate()` 会重新 `CREATE TABLE IF NOT EXISTS` 建齐，无需人工建表。
   - 归档前就存在的旧库**仍有**这五张表和其中的历史行，会被直接复用。
   - `deleteWorkspaceFacts` 现在用 `to_regclass` 守卫这五张表；取回后可以还原成无守卫的直接删除，也可以留着（留着不影响正确性）。
2. **环境变量**。`DOUYIN_CALLBACK_TOKEN` 的强度校验与「必须不同于 `CORE_SERVICE_TOKEN`」的断言随冻结面删除。取回后这三行会回来，**部署环境必须重新提供该密钥**，否则 `main.ts` 启动即抛错。另有六个调度用变量（`DOUYIN_{OAUTH_LIFECYCLE,OBSERVE_SYNC,PUBLISH_POLLING}_{CRON,TIMEZONE}`）为可选。
3. **凭据槽基线**。`FIXED_CREDENTIAL_SLOTS` 已从 3 槽收到 2 槽，`assertFixedSlotMigrationBaseline` 的期望值改为 2 metadata / 2 runtime-bound / 0 not_wired。取回补丁会把基线改回 3/2/1；若主干此后又动过 supply-registry，这里是最可能冲突的点。
4. **权限登记**。`packages/contracts/src/capability-permission.ts` 的 11 条代发命令/查询登记随补丁回来。但两条测试断言（`authorizer.test.ts`、`access-control.test.ts`）已改用 `execute_feishu_intent` 举例 `publication.handoff`——取回后可改回 `submit_douyin_publish`，也可不改（两者都成立）。
5. **前端 i18n**。74 条 `integration_douyin_*` 等文案键已从 `zh.json`／`en.json` 删除，补丁会带回。若期间有人整理过文案文件，这里会冲突；快照里有锚点时的完整两份 JSON 可对照。
6. **`publish:*` distributionTarget 枚举**。它**没有**被删（见活性核查表 §5 存疑④），只是商家可见文案改成了「由你发布」、运营选择器去掉了三个选项。取回代发能力时需要把这两处文案/选项改回来——补丁会做，但如果届时已另有票删除了枚举本身，需先恢复枚举。

## 依赖版本（锚点时）

- Node ≥ 22，pnpm 10.30.3
- 代发链路自身不引第三方 SDK：抖音适配器是 `RecordedDouyinAdapter` 桩，走仓内 `contracts.ts` 定义的端口；`douyin-*.ts` 只依赖 `p1/job-runtime` 的调度原语与 `pg`
- 因此**取回不需要恢复任何外部依赖**——真正接入官方能力时要新写 live 适配器，归档里没有

## 解冻时应先做的一件事

D-155 原文要求：解冻时先做一次代发面存量盘点，判断哪些中间态可续用、哪些应先退役再重建。取回前请先读活性核查表的 §0 与 §5——归档物是一份**从未真正发出过任何内容的中间态**（生产只装配过 recorded 桩），直接复活它得到的仍是一个不能用的骨架。更可能正确的路线是：取回作参考设计，重写 live 适配器与授权链，而不是把 3,340 行原样接回主干。

## 演练记录

见本文档同批提交的票下交底与 `docs/ops/frozen-publish-face-table-disposition-2026-07-31.md`；取回演练在临时分支 `restore-drill/publish-face` 上实跑过一次，演练输出记录在票下评论。
