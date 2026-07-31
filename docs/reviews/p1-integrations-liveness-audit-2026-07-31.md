# `p1/integrations` 逐文件活性核查表（#263 / D-155 修订）

- 日期：2026-07-31
- 锚点：main `b7a426cae21c16a8e164bd4b36eac3ae3e55ee4d`
- 判据：**生产调用链**——从 `apps/core/src/main.ts`、`job-worker.ts`、`server.ts` 的装配与路由逐层追 import，不是 grep 命中
- 归档位置：`references/frozen-publish-face-2026-07-31/`（取回 runbook：`docs/ops/frozen-publish-face-retrieval-runbook-2026-07-31.md`）

## 0. 结论先说：票面「整块归档」的前提不成立

票面与 D-155 修订都按「`apps/core/src/p1/integrations/` 是当前唯一一块整块无用且体量过万行的代码」立论，实测 **10,338 行生产代码的计量准确**（本核查逐文件复算，与 07-28 计量一字不差），但**「整块无用」不成立**：

| | 文件数 | 生产行数 | 占比 |
|---|---|---|---|
| 冻结面（代发，已归档删除） | — | **3,327 行** | 32% |
| 非发布活代码（留在主干） | 16 | **7,011 行** | 68% |

该目录是一个**混装单体**：抖音代发链路与「模型供应商凭据 / 密钥保险箱 / BYOK 模型执行 / 飞书 MCP 工具面 / 通用连接与凭据轮换」共用 `contracts.ts`、`repository.ts`、`postgres-repository.ts`、`application-service.ts`、`foundation-module.ts` 五个文件。因此本票执行的是**按语义切除代发面**，不是整目录搬迁；切除后目录内**只剩活代码，原地保留**（迁到新目录只会把 7,000 行活代码全部换址，风险远大于收益——留待主控裁决是否仍要改名，见 §5 存疑①）。

**最强的一条证据**：生产从来只装配 `RecordedDouyinAdapter`（`main.ts:1070`、`job-worker.ts:526`，`executionMode = 'recorded'`，默认返回 `recorded_not_configured`）。全仓**不存在**任何 live 抖音适配器。也就是说，代发链路即使被完整调用，也从未、也不可能真的发出任何内容——正是 D-155 描述的「做了却又实现不了」的中间态。

## 1. 逐文件判定

### 1.1 整体冻结（文件级删除，已归档）

| 文件 | 行数 | 判据 |
|---|---|---|
| `douyin.ts` | 121 | `RecordedDouyinAdapter`，代发适配器桩 |
| `douyin-oauth-lifecycle.ts` | 150 | 代发 OAuth 续期调度＋job handler |
| `douyin-publish-polling.ts` | 99 | 发布状态轮询调度 |
| `douyin-observe-sync.ts` | 98 | 抖音观测同步调度 |
| `apps/core/src/product/publish-content-snapshot.ts` | 113 | `ProductPublishContentSnapshotPort`；`handoff.platform !== 'douyin'` 直接 return（:31），产出 `platform: 'douyin'`（:84）；唯一消费者是代发的 `requireContentSnapshots` |

（各自的 `.test.ts` / `.postgres.test.ts` 一并归档，共 5 个测试文件。）

### 1.2 非发布活代码（留在主干，逐条给生产调用点）

| 文件 | 行数 | 判为「活」的生产调用点 | 服务的产品面 |
|---|---|---|---|
| `byok.ts` | 90 | `main.ts:664` `byokExecutionRuntimeFromEnv` → `IntegrationApplicationService.byok` | BYOK 模型执行（`createOpenAICompatible`＋`generateText`，是 LLM 调用，与代发无关） |
| `foundation-byok-ledger.ts` | 257 | `main.ts:1063` `FoundationStrictByokLedger` | BYOK 用量记账／额度结算 |
| `secret-store.ts` | 379 | `main.ts:540` `integrationSecretStoreFromEnv` → 凭据轮换收据、`ProviderCredentialAccountProvisioner`、`providerCredentialEnvFromVault`、`createProviderCredentialSecretBroker` | 密钥保险箱（全平台凭据共用） |
| `provider-credential-runtime.ts` | 534 | `main.ts:552/557/561/566`、`job-worker.ts` 同批 | **模型供应商**凭据装配（`model.direct`／`ark.media`），喂给 `adminProviderEvidence`／`adminSupplyControlPlane` |
| `provider-connectivity.ts` | 84 | `main.ts:843` → `ProductionAdminProviderEvidence.connectivity` | 模型供应商连通性探测 |
| `feishu.ts` | 332 | `main.ts:1059` `feishuMcpAdapterFromEnv` | 飞书 MCP 适配器 |
| `feishu-tool-lifecycle.ts` | 200 | `main.ts:1093` 调度＋`job-worker.ts:749` handler | 飞书工具目录生命周期 |
| `feishu-intent-reconciliation.ts` | 101 | `main.ts:1101` 调度＋`job-worker.ts:751` handler | 飞书意图对账 |
| `operations-confirmation-task-adapter.ts` | 103 | `main.ts:1432` → `attachConfirmationTaskPort`／`attachAnomalyTaskPort` | 高风险确认任务／异常任务（共用面） |
| `runtime-from-env.ts` | 153 | `main.ts` 经 `feishu`／`byok`／`secret-store` 三条 | 环境装配 |
| `index.ts` | 19 | `main.ts:128`／`job-worker.ts:45`／`server.ts:45`／`index.ts:18` | 桶文件 |

> **票面点名的四个「未必全属代发面」的文件，全部判活**：`feishu-*`、`byok.ts`、`secret-store.ts`、`provider-credential-runtime.ts`。票面的担心是对的——这四类合计约 2,130 行，若按「整块归档」执行会连同模型供应链凭据与飞书工具面一起删掉。

### 1.3 混装文件（按语义切除代发部分，其余留下）

| 文件 | 原行数 | 现行数 | 切除的代发部分 | 保留的活代码 |
|---|---|---|---|---|
| `application-service.ts` | 4,200 | 2,538 | 28 个 `*Douyin*` 方法＋4 个仅代发调用的私有助手＋轮询常量＋授权事件信封；4 处「活方法里的代发分支」（`listConnections` 的 reauth 提醒、`testProviderConnection` 的 `douyin.platform` 槽、`rotateConnectionCredential` 的 OAuth 互斥门、`disconnectConnection` 的观测快照清理） | 通用连接创建／凭据轮换三段式状态机／断连／审计／幂等／strict BYOK／飞书全部 |
| `contracts.ts` | 652 | 432 | `DouyinCapability`、`DouyinPublishAnchor`，及 268–475 整块（发布确认、发布作业、观测、OAuth 续期、适配器端口，含名字通用但只服务抖音的 `PublishableContentSnapshot`／`PublishContentSnapshotPort`） | 连接／凭据／密钥／BYOK／飞书全部契约 |
| `repository.ts` | 781 | 423 | 51 个接口方法中的 24 个＋对应内存实现＋ 4 个仅代发的字段 | 连接 CAS／审计／幂等／创建操作／飞书／`claimExternalEvent` |
| `postgres-repository.ts` | 1,253 | 781 | 5 张代发表的 DDL、24 个方法、`oauthRefreshPhaseRank` | 通用连接三表／审计／幂等／外部事件／飞书四表 |
| `foundation-module.ts` | 732 | 613 | 7 个命令 case＋5 个查询 case＋`douyin.platform` 凭据槽＋`douyin` provider 枚举项＋三个仅代发的校验器/投影 | 凭据管理四命令／通用连接三命令／BYOK／飞书全部 |

### 1.4 目录外的连带切除（同属冻结面）

| 文件 | 切除内容 |
|---|---|
| `main.ts` | 三条 `registerDouyin*Schedule`、`RecordedDouyinAdapter`、`contentSnapshots` 依赖、`DOUYIN_CALLBACK_TOKEN` 三行校验、`douyin.adapter.assembly` 种子与白名单（共 41 行） |
| `server.ts` | `/integrations/douyin/authorization-events` 与 `/publish-events` 两条免鉴权回调路由、`trustedCallbackToken`、`douyinCallbackToken` 参数（共 116 行） |
| `job-worker.ts` | 三个代发 job handler 注册与其 batch runner（共 31 行） |
| `p1/foundation/application-service.ts` | 幂等命令白名单三项 |
| `p1/foundation/ports.ts` | `DouyinPort`（**全仓零消费者的孤儿接口**，代发端口声明，随冻结面一并删除） |
| `p1/supply-registry/credential-slots.ts`、`env-fallback-monitor.ts` | `douyin.platform` 固定凭据槽（属 D-155「平台账号绑定」）；基线从 3 槽/2 runtime-bound/1 not_wired 改为 2/2/0 |
| `p1/admin-config/foundation-module.ts`、`runtime-wiring.ts` | `douyin.adapter.assembly` 配置键定义、`douyinMode`（**生产零消费者**，仅自测引用） |
| `packages/contracts/src/capability-permission.ts` | 11 条代发命令/查询的权限登记 |
| 前端 | `/settings/connections` 的抖音面板全链（provider 卡片、能力开关、发布确认/提交/刷新、观测快照）、admin 的 `douyin.platform` 槽与 `douyin.adapter.assembly` 控件、74 条 i18n 文案键 |

**前端可达性实证**（不是推断）：抖音代发面板挂在 `/settings/connections`（`routes/settings/connections.tsx:10-12,24`），**无 flag、无 admin 门**，商家登录即可见；`tests/e2e/specs/uiux-mobile-secondary.spec.ts:179` 原本正是断言「抖音连接」tab 可见。这是本轮删除中唯一真正商家可达的代发入口，已连同后端一并撤下，该 e2e 断言改为 `toHaveCount(0)`。

## 2. 「不在冻结面」清单的行为复核

D-155＋D-161④ 明列不受冻结约束的四项，逐条确认未受影响：

| 面 | 状态 | 证据 |
|---|---|---|
| 交付与导出（交付包／确定性 ZIP／平台核对清单） | 未触碰 | `p1/result-delivery/` 零改动；`delivery-package.ts` 的抖音核对清单文案原样保留 |
| `assisted_handoff` / `manual_copy` / `export` | 未触碰 | `composer-signed-preview.ts:43-45` 三行原文保留；`composer-destination-mapper.ts` 的澄清选项未动 |
| 商家自报发布结果记账（D-161④） | 未触碰 | `record_content_package_manual_result` 及其生产调用点 `$workId.tsx` 未改；`publication-record-model.ts` 护栏文案保留 |
| `publication.handoff` 能力 | 仍注册且有活产者 | 该能力由 `assisted_*` 命令产出（`capability-permission.ts:443-448`）；原先用 `submit_douyin_publish` 举例的两条断言已改指 `execute_feishu_intent`，能力本身未被摘除 |

## 3. 已入库表的处置

见 `docs/ops/frozen-publish-face-table-disposition-2026-07-31.md`。摘要：**五张代发表一律不 DROP、不迁移、不清数据**；只停止在新库创建，并在 `deleteWorkspaceFacts` 中以 `to_regclass` 守卫保留清理，使旧库的工作区注销仍能清干净。

## 4. 判「活」时用到的反向证据（防止误删）

以下几处**看起来像代发、实际是共用面**，本轮特意保留：

1. `claimExternalEvent`（`repository.ts`／`postgres-repository.ts`）——`provider` 是自由字符串，代发只是它的两个调用方之一，飞书仍在用。保留。
2. `IntegrationError`、`requireOwner`、`requireUsableCredential`、`saveConnection`、`executeConnectionCredentialRotation`、`disconnectConnection`、`hash`／`canonicalize`——代发方法大量调用它们，但它们各自都有独立的连接/凭据/飞书调用方。保留。
3. `integration_external_events`、`integration_connections`／`_credential_bindings`／`_credential_versions` 四张共用表——存有 `provider='douyin'` 的历史行，表结构不动。保留。
4. `sync_publish_feishu_tools`／`publish_feishu_tool`——名字里有 `publish`，但发布的是**飞书工具目录版本**，与平台代发无关。保留。
5. `p1/admin-config/foundation-module.ts:275` 的 `douyin: '今天适合用短内容…'`、`delivery-package.ts:81` 的 `douyin: '抖音'`、各处 `'xiaohongshu' | 'douyin' | 'video_account'` 平台枚举——都是**内容平台名**，不是代发能力。保留。

## 5. 存疑清单（保守处理，留主控裁决）

| # | 事项 | 本轮处理 | 为何不自行决定 |
|---|---|---|---|
| ① | 目录是否改名 | **不改**，切除后 `p1/integrations/` 原地保留 20 个活代码文件 | 票面任务 2 写的是「非发布活代码迁出该目录」，其前提是目录以冻结面为主；实测反了（68% 是活代码）。把 7,000 行活代码换址属于纯 churn，且会与在飞 lane 抢 `main.ts` 等装配面。若主控仍要改名（例如 `p1/provider-integrations/`），是独立一次机械改名，随时可做。 |
| ② | `IntegrationProvider` 仍保留 `'douyin'` 枚举项（`contracts.ts:1`） | **保留** | 库里存量连接行的 `provider` 列仍写着 `'douyin'`，删掉枚举会让历史行读出来即类型不合。已无任何代码能**新建**抖音连接（`createConnectionInput` 的 provider 枚举已收窄为 `feishu`/`model`）。 |
| ③ | `CapabilityActivationEvidence` 的 `endpoint`/`fields`/`frequency`/`qualified` 四个可选字段 | **保留** | 只被抖音观测消费，现已无读方；但它们是共用类型上的可选字段，且对应 jsonb 存量数据。删除收益为零、风险非零。 |
| ④ | `publish:*` 三个 `distributionTarget` 枚举值（`packages/contracts/src/composer-submission.ts:29-31`） | **保留枚举，只撤回文案** | D-155 冻结面确实包含这三个目标，但它们贯穿 composer／execution-spine／harness（7 个 core 测试文件引用），属 D-155 的**另一半**（Composer 侧），不在 #263 的 `p1/integrations` 票面内。本轮已做的：撤回商家可见承诺（`composer-signed-preview` 三句改为「由你发布」）＋ 关掉运营新配置入口（admin 三个 `<option>` 删除）。**建议另开票删除枚举本身。** |
| ⑤ | `admin_provider_credential_test` 的 `not_wired` 状态分支 | **删除** | `douyin.platform` 是唯一可能产出该状态的槽；删除后若 core 仍对 model 槽发 `not_wired`，前台落到 `test_pending()` 兜底，不会崩。已确认 `provider-connectivity.ts` 中该返回值的唯一产者就是被删的抖音分支。 |
| ⑥ | 三条 e2e 规格中的 `uiux-upgrade-b-*` 格式化欠债、`src/lib/pages.ts` 的 `content-collections` 未生成 | **不动** | 本分支未触碰这些文件，属既有欠债；`content-collections` 需 build 生成，非本轮引入。 |

## 6. 验证跑数

| 项 | 结果 |
|---|---|
| `git ls-files 'apps/core/src/p1/integrations/*'` | 32 个文件，**零个 douyin 文件**；剩余的 douyin 字样只在 §5 已记录的保守残留处（`contracts.ts:1` 枚举项、退役表清理名单、测试夹具的历史 provider 值） |
| core typecheck | 绿 |
| core test（全量 `src/**/*.test.ts`） | 绿 |
| web typecheck | 绿（仅剩 2 条既有报错：`src/lib/pages.ts` 的 `content-collections` 未生成、`uiux-upgrade-b-results.spec.ts` 未用 `expect`；两文件本分支未触碰） |
| web test | 绿 |
| web test:interaction | 47 文件 / 288 用例全绿 |
| biome check | 本轮改动文件全绿（`uiux-upgrade-b-*` 三条既有格式化欠债未动） |
| 取回演练 | `restore.patch` 在临时分支 `restore-drill/publish-face` 干跑＋实打，恢复后 `git diff --cached b7a426ca -- apps packages mkfast-template-main` **输出为空**（与锚点逐字节一致），core typecheck 绿；演练后分支已删除，工作树复原 |

### e2e 复核集（冷库 `meiye_263_gate`，走 e2e-lock）

- `pending-actions-inbox`、`p0-golden-journey`：**多轮全绿**（冻结边界未受影响的直接行为证据）
- `p1-integrations-journey`：**判定为既有 flake，非本轮回归**。取证过程：

| 跑法 | 锚点 `b7a426ca` | 本分支 |
|---|---|---|
| 单独跑该 spec | 通过 | 通过 ×2 |
| 三 spec 一起跑 | 通过 ×1，**失败 ×1** | 失败 ×2 |
| 把该断言超时放到 45s | — | 通过 |

失败点恒为 `p1-integrations-journey.spec.ts:33` 的 `expect(getByText('连接已创建，待完成授权验证')).toBeVisible()`，默认 5s 超时，失败耗时恒为 8.1s。**锚点在同样的三 spec 负载下同样失败**（第二次采样，同一 locator、同一耗时），故不是 #263 引入。

判红纪律逐条走过：①`git diff` 未命中该代码路径——`createConnection`（`integration-settings.tsx:1167`）与 `execute`（:1122）不在本分支任一 diff hunk 内，`application-service.ts` 的 `createConnection`（原 316–445 行）未被切割；②单文件隔离重跑通过；③锚点对照跑同样失败。该 spec 于 `38f2bb7c` 刚迁移，5s 的 toast 断言在三 spec 负载下本就临界。

**该 spec 的归属**：它测的是 **BYOK 模型密钥连接创建**，属活代码面，**不在归档面内**，因此留在原处、内容未改（诊断时临时加长的超时已还原，`git diff` 为空）。建议由 spec 属主放宽该断言超时，本票不擅自改他人 spec。
