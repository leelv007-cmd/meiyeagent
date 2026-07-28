# 票 05 · 配置持久层（DB 配置表 + 配置服务）
> 建设面: E7 管理后台前置 ｜ 决策: DEC-ADMIN-CONTROL-PLANE ｜ Blocked-by: 无（可立即启动）

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "05",
  "decisionIds": [
    "DEC-ADMIN-CONTROL-PLANE"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-NO-CONFIG-PERSIST"
  ],
  "contractIds": [],
  "blockedBy": [],
  "closureEvidence": [
    "docs/evidence/contentpackage/ticket-05/README.md",
    "docs/evidence/contentpackage/ticket-05/manifest.json",
    "docs/evidence/contentpackage/ticket-05/continuous-config-restart-rollback.webm",
    "docs/evidence/contentpackage/ticket-05/03-recorded-both-processes.png",
    "docs/evidence/contentpackage/ticket-05/05-rollback-direct-both-processes.png",
    "docs/evidence/contentpackage/ticket-05/config-version-chain.sql.txt"
  ],
  "resolution": "completed",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **US26 / D11–D12（已批准未落地）**：规格拍板"配置写入持久层并带版本与审计，so that 我点选的值重启不丢、可追溯"，且 §11 逐字锚定"**配置持久层是 Admin Control Plane 的硬前置；未落持久层不做可视化配置面**"。当前产品内没有任何 DB 配置表、配置服务与配置写入端点——运行时配置的唯一变更通道是改 env / 改代码 + 重启重部署，这正是诊断病根"改代码才能配"的持久化底座缺失。
- **执行配置 100% 是 env 常量**：`apps/core/src/p1/model-supply/runtime-config.ts:26-203` `modelRuntimeAssemblyFromEnv` 在 boot 时一次性解析 `MODEL_EXECUTION_MODE`（`:375-392` 五档）、`MODEL_MEDIA_EXECUTION_MODE`（`:367-373`）、direct 供应配置 9 项 env（`:404-450`，含 apiKey/baseUrl/模型名/双价）、Ark 媒体 11 项 env（`:452-489`），装配成进程内不可变常量（`main.ts:134-139` 解构注入各服务）。job-worker 是第二个进程，在 `apps/core/src/job-worker.ts:160-166` **独立再读一遍 env**——HTTP 与 worker 两入口（ADR-0006 拓扑）之间没有共同配置事实源，全靠部署环境变量恰好一致。
- **激活证据 = 环境变量哈希伪装**：`runtime-config.ts:205-257` 用 `MODEL_DIRECT_ACTIVATION_*` 三元组 env + `:259-275` sha256(env 配置) 对拍即得 `live_verified`（`:91-94`）。规格要求换成"配置 + 真实探针 smoke + 落激活证据"（票 20），而"落证据"的前提是先有一张能存证据与版本的配置表。
- **装配硬编码 + 套餐只读**：`main.ts:326/334` `new RecordedByokExecutionAdapter()` / `new RecordedDouyinAdapter()` 硬编码装配；`main.ts:133` 套餐走 `productPlanConfigFromEnv`（`apps/core/src/product/plans.ts:18-49` 代码常量 + `:79` env 覆盖），前端 `admin-plan-control.tsx:35` 仅一个只读 catalog 查询、0 mutation——US27"套餐/定价/额度在后台可写"无落点。
- **零配置表、零配置路由（已实核）**：全仓各模块 migrator 的 `CREATE TABLE` 中不存在任何 config/settings 系统配置表；唯一含 config 字样的 `p1_trigger_configs`（`apps/core/src/p1/operations/postgres-repository.ts:118`）是运营触发器业务对象，不是系统配置。`server.ts` 只有 p1/commands 通用分发（`:781-857`），未注册任何配置模块，等价于后端零配置写入端点。
- **锚点漂移注明（两处，以本票实核为准）**：(a) brief 所引"src/db/ 下 grep 零命中"——`apps/core` 并无 `src/db/` 目录，schema 分散在各模块 `postgres-repository.ts` migrator、由 `postgres-schema-migration.ts:11-29` 统一加 advisory lock 执行；"零命中"结论成立，位置口径修正。(b) brief 所引"`catalog.ts:110` new Map、`catalog.ts:449` ModelPreferenceRegistry 进程重启即失"——类声明实际在 `:448`（四个 Map 在 `:449-452`）；且**模型目录 revision 与模型偏好在生产装配已有 Postgres 持久化**：`main.ts:115` 装配 `PostgresModelSupplyRepository`（`model_catalog_revisions` / `model_workspace_preferences` / `model_user_preferences`，见 `p1/model-supply/postgres-repository.ts:54-83`），`foundation-module.ts:1378-1382` 每次调用从 PG 重建 CatalogRevisionRegistry，in-memory 版只剩测试用 `MemoryModelSupplyControlPlaneRepository`（`foundation-module.ts:141-148`）。本票**不重做**模型偏好持久化；"重启即丢"的真实主体是上述运行时配置整体——它们甚至谈不上"重启丢"，因为产品内根本没有可写入口。本票交付后须把这一漂移认知回写规格勘误。
- **票界**：本票只落配置持久层（DB 配置表 + 配置服务）+ 最小管理面读写留证。执行模式真实切换（票 18）、凭据脱敏与测试连接（票 19）、adapter 装配切换 + 激活真实探针（票 20）、套餐可写生效（票 21）都建在本票之上，本票不冒充它们完成；凭据明文永不进本票配置表。

## 现状代码入口（实核 file:line）

- `apps/core/src/p1/model-supply/runtime-config.ts:26-203`：env→运行时装配全量入口；`:375-392` parseMode、`:367-373` parseMediaMode、`:404-450` directOptions、`:452-489` arkMediaOptions、`:205-257`+`:259-275`+`:91-94` 激活证据 env 哈希链。本票不改其行为，只为其生效值建立对照投影。
- `apps/core/src/main.ts:133`（套餐 env）、`:134-139`（boot 解构）、`:253-256`（admin actor ids env）、`:326/334`（adapter 硬编码）、`:338-340`（BYOK endpoint env）：全部"改 env/代码才能变"的清单证据；`:191-203` fallbackCatalog 也是代码常量投影。
- `apps/core/src/main.ts:282-294` 与 `apps/core/src/job-worker.ts:149-160`：两个进程各自的 `migratePostgresSchema` migrator 列表——新配置表 migrator 必须两处都挂；`postgres-schema-migration.ts:11-29` 的 advisory lock 事务（`:18-20`）保证两进程并发迁移安全，无需新机制。
- `apps/core/src/p1/foundation/ports.ts:95-108`：`P1OperationModule` 接口（name + execute/query）——本票新模块的形态合同。
- `apps/core/src/p1/foundation/application-service.ts:282-382`：`executeModule` 幂等全套现成（claim/replay/in_progress/heartbeat/complete，`:291` payloadHash 同 key 不同 payload 冲突）；`:384` 起 `queryModule`。本票命令查询全程复用，不自建幂等。
- `apps/core/src/server.ts:781-857`：`/workspaces/:id/p1/commands` 通用分发（`:788-789` 强制 `idempotency-key` 头，`:813` 进 executeModule）；`:859-905` `/p1/query`（`:884` queryModule）。**新模块注册即通，HTTP 壳零新路由**——这就是"不新增 seam"的物理形态。
- `apps/core/src/p1/model-supply/foundation-module.ts:1886` `ModelSupplyFoundationModule`；`:1667` adminActions 白名单、`:1909-1915` admin 门禁（actor==='admin' 或 adminActorIds 命中，否则 FORBIDDEN）——本票模块照抄该门禁范式；`main.ts:509-533` operations 注册数组是接入点。
- `apps/core/src/p1/model-supply/postgres-repository.ts:186-231`：catalog head CAS（expectedHeadRevisionId 不符→`IDEMPOTENCY_CONFLICT`）——配置 head 乐观并发沿用同款；`:54-83` 现有表 DDL 风格（workspace_id 复合主键 + jsonb + timestamptz）。
- `apps/core/src/p1/model-supply/postgres-repository.test.ts:31-45`：`TEST_DATABASE_URL` skip 模式 + 随机 workspace 隔离；`:345-370` **restartedRepository 范式**——新建 repository 实例断言事实仍在，本票"重启后仍在"测试直接学它。
- 前端挂点：`mkfast-template-main/src/p1/admin-control-plane.tsx:14-48` 现有四 Tab（Templates/Models/Operations/Feishu）薄壳结构；`admin-model-control.tsx:423-499`（query 调用范式）、`:658-773`（command 调用范式）是 1876 行地基；BFF `mkfast-template-main/src/routes/api/core/p1/commands.ts:1-10` 通用转发，本票零改动。

## 改造方案（步骤级）

1. **Schema（新模块目录 `apps/core/src/p1/admin-config/`）**：`AdminConfigPostgresRepository.migrate()` 建两张表，migrator 挂进 `main.ts:282-294` 与 `job-worker.ts:149-160` 两个列表。
   - `admin_config_revisions`（append-only）：`scope`（'global'|'workspace'）、`workspace_id`（global 用哨兵 `'__global__'`，形态对齐 `main.ts:507` 的 `'__system__'` 先例）、`config_key`、`value` jsonb、`revision`（每 (scope,workspace_id,config_key) 单调递增）、`status`（'applied'|'rolled_back'，为票 18+ 的 draft 预留枚举位，对齐规格 §5 Config revision 状态机）、`rolled_back_to_revision`、`actor_id`、`reason`、`correlation_id`、`created_at`。回滚 = 写新行指向历史，永不 UPDATE 历史行。
   - `admin_config_heads`：(scope,workspace_id,config_key)→当前 revision + updated_at，CAS 写（expectedRevision 不符→`IDEMPOTENCY_CONFLICT`，照抄 `postgres-repository.ts:186-231`）。
   - **key 注册表（代码内 zod 契约）**：每个 key 声明值 schema、作用域、说明。首批注册 `model.execution.mode`、`model.media.execution.mode`、`douyin.adapter.assembly`、`byok.adapter.assembly`、`plan.allowances.{starter,growth,pro}`、`compliance.watermark.default`、`compliance.aigc_label.default`——为票 18/19/20/21 备好装载位；**secret 形值（API key/token 特征）在校验层直接拒绝**，凭据只能走票 19 的 secret manager 引用，本表物理上不存明文。
2. **Application Service 命令/查询（同一 seam，不新增）**：新 `AdminConfigFoundationModule implements P1OperationModule`（name=`admin-config`），注册进 `main.ts:509-533` operations 数组。命令：`config_apply`（key 已注册 + 值过 schema + expectedRevision CAS→新 applied revision；同值 apply 短路不产生新版本）、`config_rollback`（指向历史 revision→写新行）。查询：`config_get`（存储值+revision+操作者+时间+运行时生效值对照）、`config_history`（版本链含 actor/reason/correlationId）、`config_list`。门禁照抄 `foundation-module.ts:1909-1915`：本票首批 key 全部 global 作用域，写读均要求 admin actor（adminActorIds 从 `main.ts:253` 注入）；workspace 作用域按现有 workspace member 授权，用测试证明隔离。幂等复用 `executeModule`（`application-service.ts:282-382`）的 claim/replay/payloadHash 冲突，全程不自建。
3. **运行时对照投影（诚实标注，防"写了没生效"被冒充）**：`main.ts` 把 boot 装配结果收成只读 `RuntimeConfigSnapshot`（执行模式、媒体模式、激活证据状态、套餐数值）注入本模块；`config_get`/`config_list` 对每个 key 同时返回 `storedValue`（DB）与 `effectiveValue`（当前进程真实生效）+ `wired: false`。**本票期间 env 仍是运行时唯一权威**；DB 值接管运行时行为由票 18/19/20/21 按 key 逐个接线、把 wired 翻真、并按规格 §5 显式声明该 key 热加载 vs 重启生效。本票禁止顺手切任何 env 读点——那是后续票的验收对象。
4. **前端/adapter 最小接线**：BFF 零改动（`commands.ts:1-10` 通用转发已覆盖新模块）。管理模式 `admin-control-plane.tsx` 新增"运行时配置"Tab（学现有四 Tab 薄壳 + `admin-model-control.tsx:658-773` 的 command 调用范式）：配置列表（key/存储值/生效值/版本/操作者/时间 +「已记录（未接线）」诚实标签，措辞对齐 D10 口径）、写入表单（按 key schema 校验）、版本历史与回滚（走「分级变更确认」：diff + 影响范围 + 原因）。状态展示用规范化中文标签，不裸露 applied/rolled_back 英文码。
5. **测试（打 Application Service 外部行为 + PG 真实事务）**：
   - PG 持久化（`TEST_DATABASE_URL` 模式，学 `postgres-repository.test.ts:31-45`）：写入→`new AdminConfigPostgresRepository(pool)` 重建实例（模拟进程重启，学 `:345-370` restartedRepository 范式）→读回值/版本/操作者完整——规格 Testing"配置写入持久层后重启仍在（防回 in-memory 丢配置）"逐字落地；版本链 append-only；回滚产生新版本且历史原样；陈旧 expectedRevision→`IDEMPOTENCY_CONFLICT`。
   - workspace 作用域隔离：workspace A 写入的 workspace 作用域 key 对 B 不可见；global key 全局可见；owner/operator/reviewer 写 global→FORBIDDEN。
   - seam 幂等：同 idempotency-key 同 payload replay 同结果且不加版本；同 key 不同 payload→conflict。
   - 契约拒绝：未注册 key、schema 不合值、secret 形值均被拒。
   - HTTP 边界：经 `/workspaces/:id/p1/commands` 与 `/p1/query` 全链跑通（学现有 http.test 形态）。测试是工程护栏，不作为关票依据。
6. **留证（D01 口径）**：在真实运行的管理模式界面完成"写入→读回（版本+1、操作者=本人）→重启 core 进程→再读值仍在"连续录屏/截图，加 `admin_config_revisions` 版本链 SQL 输出，落 `docs/evidence/contentpackage/`。

## DoD（全部必须是用户可见行为）

- 平台管理员在管理模式"运行时配置"分区看到首批配置项的**存储值与当前运行时生效值对照**、版本号、最后操作者与时间；所有未接线项带明确「已记录（未接线）」标注，不冒充已生效。**对照证据（当前 vs 改造后）**：当前这些配置事实只存在于部署环境变量与代码常量中，产品内任何界面不可见（`admin-control-plane.tsx:14-48` 四个 Tab 无配置分区；`admin-plan-control.tsx:35` 只读 0 mutation）；改造后产品内首次出现带版本与审计的配置事实源。
- 管理员修改一项配置并确认后，立即读回新值、版本 +1、操作者 = 自己；**重启 core（HTTP 与 job-worker 两进程）后再查询，值、版本、历史全部仍在**——"前台点选重启不丢"的直接验收。对照当前：唯一变更方式 = 改 env + 重启（`runtime-config.ts:26` boot 一次解析），且不留操作者/时间/原因任何痕迹。
- 管理员回滚一项配置到历史版本：产生一条**新**版本记录并显示回滚来源，历史版本原样可查、审计（操作者/原因/correlationId）完整——不出现原地改写历史。
- 作用域隔离对用户可见：workspace 作用域配置只在本 workspace 查得到；商户角色（owner/operator/reviewer）读写平台 global 配置时收到与现有权限口径一致的拒绝，商户一级导航与创作界面不出现任何配置入口（Admin Control Plane 是平台管理员二级管理面）。
- 重复提交防护可见：同 idempotency-key 同 payload 重复确认只回放同一结果、版本不重复增长；同 key 不同 payload 得到冲突提示——版本链不被双击/重试污染。
- **关票前置**：上述"写→重启→读"的连续留证（录屏/截图 + 版本链 SQL）落 `docs/evidence/contentpackage/`。仅 migration 跑通、repository 单测绿、curl 出 JSON、fixture 全绿，一律不得关票；且遵守 MAP 全局规则——票 01 聚合合同冻结前本票不得关闭。

## Blocked-by / Blocks

- **Blocked-by**：无实施前置（波次 0 独立线）。不依赖 E1 ContentPackage 聚合合同——本票在管理面/配置域，不读写成品事实，不触 ADR-0011 收敛对象；不依赖真实供应凭据（配置服务本身用 PG 即可验证）。唯一全局约束：票 01 完成前不得关票（guard 强制）。
- **Blocks**：**票 18**（模型/媒体执行模式可视化切换）、**票 19**（Provider 凭据脱敏管理 + 测试连接）、**票 21**（套餐/定价/额度可写 + 合规开关）直接建在本票配置服务与配置表上；**票 20**（adapter 装配切换 + 模型激活真实探针）经 05+19 双前置——真实探针产生的激活证据要落进本票的版本化配置事实里，才能替换 `runtime-config.ts:205-275` 的 env 哈希伪装。规格 §11 原文锚定："配置持久层是 Admin Control Plane 的硬前置；未落持久层不做可视化配置面。"本票完成不改变北极星口径：真实跑通链路数仍由 06/09/11→22 主线承载，本票是管理面地基，不冒充链路进度。

## 风险与回退

- **双真相源漂移（最大风险）**：本票后 env 与 DB 配置并存，管理员可能误以为改了 DB 就已生效。控制：本票不切任何运行时读点（env 仍唯一权威）；每个 key 强制展示存储值 vs 生效值对照 + 「未接线」标注（对齐 D10 诚实标注原则），漂移永远可见不可冒充；接管由票 18-21 按 key 逐个切换并声明热加载 vs 重启生效边界。
- **凭据入表**：管理员可能把 API key 当普通配置值写入。控制：key 注册表白名单 + secret 形值拒绝校验 + 表内物理不存明文 + 查询永不回显敏感串；测试显式断言拒绝路径。凭据统一等票 19 的 secret manager 引用方案。
- **两进程迁移/启动竞态**：HTTP 与 worker 同时 boot 同时迁移。控制：migrator 挂 `postgres-schema-migration.ts:18-20` 既有 advisory lock 事务，与现有全部 migrator 同一机制，无新竞态面；本票不做 boot 写入（对照投影是只读注入），天然无跨进程写竞争。
- **版本链膨胀**：append-only 无界增长。控制：管理操作天然低频 + 同值 apply 短路不产生新版本；归档/清理不在本票造机制，挂 D18 遗留清理（优先级最低，攒批）。
- **回退**：本票 expand-only——两张新表、一个新模块注册、一个新 Tab，不动任何现有表与任何 env 读点。出缺陷时隐藏"运行时配置"Tab、从 `main.ts:509-533` 摘除模块注册即回到现状，零迁移成本；已写入的配置版本与审计作为事实保留，不回滚删除。
- **范围失守**：不做执行模式真实切换（票 18）、不碰凭据明文与测试连接（票 19）、不做探针与装配切换（票 20）、不做套餐生效（票 21）；不新增 seam（新模块走 P1ApplicationService 同一分发）；不把配置面暴露给商户（一级导航创作/内容/素材/门店不变）；不重做已持久化的模型偏好/目录层。
