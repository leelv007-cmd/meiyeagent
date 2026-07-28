# 票 19 · Provider 凭据脱敏管理 + 测试连接
> 建设面: E7 管理后台 ｜ 决策: DEC-ADMIN-CONTROL-PLANE ｜ Blocked-by: 05

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "19",
  "decisionIds": [
    "DEC-ADMIN-CONTROL-PLANE"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-NO-CONFIG-PERSIST"
  ],
  "contractIds": [
    "X-VISUAL-CONFIG"
  ],
  "blockedBy": [
    "05"
  ],
  "closureEvidence": [],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **US23 / D11（已批准未落地）**：规格逐字拍板"As a 平台管理员, I want 在后台脱敏管理 Provider 凭据并测试连接, so that 我不用改代码接入或轮换 key"（spec:91），§6 把"管理脱敏凭据、测试连接"列为 Admin config commands（spec:164），§Testing 要求"凭据脱敏：查询只返回掩码、状态、范围、时间，不返回明文"（spec:236）；P1 spec §6 早已定义"Credential commands：write-only 保存、轮换、吊销…查询只返回掩码、状态、范围和时间"（`docs/specs/beauty-content-agent-p1-spec.md:244`）。当前产品内这一切在平台凭据域**零落点**。
- **三类平台 Provider 凭据 100% 是部署 env**：LLM direct `MODEL_DIRECT_API_KEY`（`apps/core/src/p1/model-supply/runtime-config.ts:429`）、Ark 媒体 `ARK_MEDIA_API_KEY`（`:454`）、抖音回调 `DOUYIN_CALLBACK_TOKEN`（`apps/core/src/main.ts:97-104`，缺失直接拒绝启动）。接入或轮换 = 改 env + 重启重部署，且 HTTP 与 job-worker 两进程各读一遍 env（`job-worker.ts:160-166`），一致性全靠部署纪律。管理面无任何凭据分区（`mkfast-template-main/src/p1/admin-control-plane.tsx:14-48` 仅四 Tab），backlog 判定"凭据保险箱 UI（脱敏）"缺失（`docs/reviews/stage-diagnosis-2026-07-14/06-backlog-admin-control-plane.md:50,71`）。
- **秘密底座已有但只服务商户侧连接**：`SecretStorePort` + FakeKms / AwsSecretsManager 双 adapter（`apps/core/src/p1/integrations/secret-store.ts:26,69`，AAD 绑 workspace/credentialId/version/provider）、装配开关 `INTEGRATION_SECRET_STORE_MODE`（`runtime-from-env.ts:11-31`）、掩码元数据 `CredentialMetadata`（`contracts.ts:34-43`，`mask: '••••••••'`）全部现成，但连接命令一律 `requireOwner`（`application-service.ts:196-204`）面向商户 owner——平台级 Ark/LLM 凭据完全没进这套体系。
- **测试连接只有飞书一例**：`verify_feishu_connection`（`foundation-module.ts:394-400` → `application-service.ts:2921-2940`，真 discover 调用后回写 credential status/lastUsedAt）。模型与媒体 provider 无任何"测连接"通路；激活证据仍是 env 哈希伪装（`runtime-config.ts:91-94,205-257`，票 20 的对象）。
- **轮换死锁（现状连"改 env 轮换"都不完整）**：direct 配置修订哈希包含 credentialVersion（`runtime-config.ts:265-274`）；换 `MODEL_DIRECT_CREDENTIAL_VERSION` 会使 env 激活三元组 revision 失配 → **boot 直接 throw**（`:246-249`）。管理员轮换一次 key 事实上要改 env、重算 sha256、再填回三元组——"不改代码接入或轮换"在现状下彻底不成立。
- **票界**：本票 = 平台管理员凭据保险箱（write-only 保存/轮换/吊销 + 测试连接命令 + 脱敏查询合同 + boot 接线使"轮换免改代码/env"用户可见成立）。执行模式切换 = 票 18；adapter 装配切换与模型激活真实探针 = 票 20——**测试连接 ≠ 激活证据**：本票只写连通状态（passed/unauthorized/network_failed/unknown/not_wired），不产生 live_verified、不改变用户可提交状态；商户 BYOK 真实通路 = 票 03（工作区 Owner 域，CONTEXT"模型凭据管理角色"两分口径）；抖音真实接入 pilot 前不做（D10）。本票不触 ContentPackage 成品事实，不动 ADR-0011 收敛对象。

## 现状代码入口（实核 file:line）

- `apps/core/src/p1/model-supply/runtime-config.ts:26-58`：`modelRuntimeAssemblyFromEnv` boot 一次性装配；`:404-450` directOptions（`:429` API_KEY、`:430` BASE_URL、`:432-435` CREDENTIAL_VERSION）；`:452-489` arkMediaOptions（`:454` API_KEY、`:456-459` CREDENTIAL_VERSION）；`:91-94` live_verified 判定、`:205-257` env 激活三元组、`:259-275` 修订哈希、`:246-249` 失配即 throw。brief 所引锚点未漂移。
- `apps/core/src/main.ts:97-104`（DOUYIN_CALLBACK_TOKEN 启动强制）、`:253-256`（P1_ADMIN_ACTOR_IDS）、`:323`（integrationSecretStoreFromEnv）、`:325-350`（IntegrationApplicationService 装配，`:334` RecordedDouyinAdapter、`:349` secrets 注入）、`:507`（`'__system__'` 哨兵 workspace 先例）、`:509-533`（operations 注册数组，`:514-516` IntegrationsFoundationModule + adminActorIds）。
- `apps/core/src/job-worker.ts:160-166`：第二进程独立 `modelRuntimeAssemblyFromEnv(process.env)`；`:202` 同款 secret store——凭据接线必须两处 boot 同步。
- `apps/core/src/p1/integrations/secret-store.ts:86-120`（put：CreateSecret→已存在转 PutSecretValue，ClientRequestToken 幂等）、`:122-162`（use：AAD envelope 校验）、`:164-178`（revoke：ForceDelete）；合同测试范式 `aws-secret-store.test.ts:16-60`。
- `apps/core/src/p1/integrations/contracts.ts:1`（IntegrationProvider 含 `'model' | 'douyin'`，无需扩类型）、`:20-32`（SecretContext/SecretStorePort）、`:34-43`（CredentialMetadata）、`:45-63`（credentialTransition 两阶段轮换/断开）、`:65-81`（IntegrationConnection）。
- `apps/core/src/p1/integrations/application-service.ts:297-425`：createConnection 两阶段（claim→secret_stored→completed），幂等 payload 把明文剥成 valueHash（`:306-310`）；`:579-604` rotateConnectionCredential（credentialTransition 分阶段，旧 secret 延迟 revoke）；`:206-214` requireAdmin 已有；`:563-567` listConnections 按 workspaceId 圈定（哨兵不泄漏进商户列表）。
- `apps/core/src/p1/integrations/foundation-module.ts:107-129`（credentialInput 校验）、`:230-239`（publicConnection 剥 secretRef/credentialTransition）、`:277-289`（adminContext：actor==='admin' 或 adminActorIds）、`:301-325`（create/rotate/disconnect action 分发）、`:452-462`（connection/connections 查询）。
- `packages/contracts/src/uiux.ts:373-398`：`requiredP1Capability` 对 integrations 模块 `admin_` 前缀 action（含查询）现成映射 `platform.manage`（`:389-391`）——新命令组零合同改动即 admin-only。
- `apps/core/src/p1/model-supply/ai-sdk-runner.ts:334-360`：三原生家族分发（anthropic/gemini/openai-compatible）已落地，probe 的按家族路由照此口径；`ark-media-adapter.ts:576`（Bearer 鉴权形态）、`:879`（错误消息 `[REDACTED]` 脱敏先例）。
- `apps/core/src/server.ts:781-857`（p1/commands，`:788-789` 强制 idempotency-key）、`:859-905`（p1/query）、`:807/:878` authorizeP1Request 前置授权——新 action 注册即通，HTTP 壳零新路由，不新增 seam。
- 前端：`mkfast-template-main/src/routes/admin/integrations.tsx`（稳定路由薄壳，现挂 AdminFeishuToolControl）；`admin-model-control.tsx:431-439`（queryP1 范式）、`:507-518`（commandMutation 范式）；BFF `core-client.ts:106`（platformRole admin → `x-core-actor: admin`）、`routes/api/core/p1/commands.ts` 通用转发零改动。
- 票 05 交付物（前置）：admin-config 模块 + `admin_config_revisions/heads` 两表 + key 注册表；其 secret 形值拒绝校验明文永不进配置表、"凭据只能走票 19 的 secret manager 引用"逐字指向本票。

## 改造方案（步骤级）

1. **Schema/契约（凭据对象复用 integrations，绑定引用落票 05 配置表）**：定义三个平台凭据槽 `model.direct` / `ark.media` / `douyin.platform`。凭据对象复用 `IntegrationConnection` + `CredentialMetadata` 与 integrations 既有 Postgres 持久化，存放在平台哨兵 workspace（对齐票 05 落地的 global 哨兵口径；先例 `main.ts:507` `'__system__'`），SecretContext AAD 绑哨兵 + 槽位 credentialId + version，provider 用现有 `'model'`/`'douyin'` 联合（`contracts.ts:1`）。CredentialMetadata 扩最近测试元数据（testedAt / testStatus / testErrorCode，分类 passed/unauthorized/network_failed/unknown/not_wired）。**槽 → 运行时绑定**（哪个槽接管哪组 env 键 + 期望 credentialVersion）注册为票 05 配置 key（如 `credential.binding.model_direct`），值 schema 只允许"连接 id 引用 + 版本 + 生效声明"形态——版本/审计/CAS 全部继承票 05，明文物理进不了配置表；这正是 CONTEXT"集成凭据库 / 模型凭据绑定"的合同：Product Core 只持引用与授权元数据，成熟 secret manager 持值，raw secret 在保险箱内 write-only。
2. **Application Service 命令/查询（同一 seam，不新增）**：`IntegrationsFoundationModule` 新增 `admin_` 前缀 action 组（`uiux.ts:389-391` 现成映射 platform.manage）：`admin_store_provider_credential`（首存：照抄 `:297-425` 两阶段 create + `:306-310` valueHash 幂等范式，内部 `requireAdmin` + 哨兵 workspace 定址，审计记录操作者真实身份与 correlationId）、`admin_rotate_provider_credential`（复用 credentialTransition 分阶段：version+1 新 secret → 元数据落定 → 旧 secret 延迟 revoke，中断可重入）、`admin_revoke_provider_credential`（吊销 + 状态 revoked）、`admin_test_provider_connection`（见步骤 3）；查询 `admin_provider_credentials`（照 `publicConnection :230-239` 剥 secretRef，只回掩码/状态/范围/版本/时间/最近测试结果——脱敏查询合同）。商户 owner/operator/reviewer 一律 FORBIDDEN。
3. **测试连接 Port（Ports/Adapters 外围）**：新 `ProviderConnectivityProbePort`。live adapter 按 apiFamily 走各家最低成本、无副作用的鉴权端点（openai `GET /models`、anthropic `GET /v1/models`、gemini `GET /v1beta/models`、Ark 同域鉴权 GET），家族分发口径对齐 `ai-sdk-runner.ts:334-360`，鉴权头形态照 `ark-media-adapter.ts:576`；probe 结果只写凭据的最近测试元数据 + 审计，**不建 Job、不写用量/成本账、不产生激活证据、不改用户可提交状态**（与票 20 探针的硬边界）。错误消息全链路照 `:879` `[REDACTED]` 先例脱敏。`douyin.platform` 槽无真实通路（D10，`main.ts:334` recorded 装配）→ probe 返回 not_wired，界面诚实标注"未接入（recorded 装配），不可真实测试"，与票 04 口径一致。fake probe adapter 供合同测试。
4. **Boot 接线（"轮换不改代码/env"成立的物理层）**：新共享 helper（两进程复用）：读票 05 配置绑定 → `secrets.use` 解出明文 → 在 `modelRuntimeAssemblyFromEnv` 之前以 env 覆盖层注入 `MODEL_DIRECT_API_KEY/CREDENTIAL_VERSION` 与 `ARK_MEDIA_API_KEY/CREDENTIAL_VERSION`（`runtime-config.ts` 本体几乎不动），`main.ts` 与 `job-worker.ts:160-166` 两处 boot 同步挂接。绑定不存在时行为与现状逐位一致（env 回退）。保险箱来源生效时**跳过 env 激活三元组对拍**（避免 `:246-249` boot throw），激活证据落 recorded 并在管理面标注"轮换后需重新激活验证（票 20 真实探针）"——不产生假 live_verified。生效边界 = 重启生效，按规格 §5（spec:155）显式声明并在 UI 呈现。`DOUYIN_CALLBACK_TOKEN` 是我方入站回调门禁而非出站 provider 凭据，保持 env，UI 不冒充其已接线。
5. **前端/adapter**：管理模式稳定路由新增"Provider 凭据"分区（优先扩 `routes/admin/integrations.tsx` 薄壳；遵守 CONTEXT"管理模式"avoid 口径，不做 /admin/p1 单页大 Tabs）。三槽卡片：掩码 `••••••••` + 版本 + 状态 + 范围 + 最近轮换/测试时间与分类结果 + **当前生效来源（env / 保险箱）** + "重启后生效"提示；write-only 输入框（保存即清空、任何界面永不回显）；「测试连接」按钮出分类中文结果与可执行下一步。查询/命令照 `admin-model-control.tsx:431-439` / `:507-518` 范式；BFF 零改动。
6. **测试（打 Application Service 外部行为）**：脱敏合同——store 后 `admin_provider_credentials` 与既有 connection 查询、HTTP 响应逐字段断言不含明文串与 secretRef（spec:236 逐字落地）；write-only 幂等——同 idempotency-key 重放不重复写 secret、同 key 不同 payload conflict；轮换——version+1、旧版 revoke、两阶段中断后重入收敛；probe——五分类各断言 + unauthorized 不改激活状态不触发用户可提交变化 + 零用量/成本事件；boot 覆盖层——fake secret store 下解析成功接管、绑定缺失回退 env 逐位一致、AAD 失配拒绝启动接管；权限——商户三角色全 FORBIDDEN、哨兵 workspace 凭据不出现在任何商户 `connections` 列表（`:563-567`）；live probe 显式隔离（学 `live-llm-provider.integration.test.ts` 形态），默认不进普通 CI。测试是工程护栏，不作关票依据。

## DoD（全部必须是用户可见行为）

- 平台管理员在管理模式"Provider 凭据"分区看到三个凭据槽（LLM 直连 / Ark 媒体 / 抖音平台）的掩码、版本、状态、范围、最近轮换与测试时间、当前生效来源——**任何界面与接口永远看不到明文**，保存后输入框立即清空。**对照证据（当前 vs 改造后）**：当前这三把 key 只存在于部署环境变量（`runtime-config.ts:429/:454`、`main.ts:97`），产品内零可见、零输入口、零测试口（`admin-control-plane.tsx:14-48` 无凭据分区）；改造后产品内首次出现带版本与审计的平台凭据管理面。
- 管理员粘贴新 key 保存（write-only）后点「测试连接」，数秒内看到对真实 provider 的分类结果（连接成功 / 鉴权失败 / 网络失败 / 未知），失败带可执行下一步；界面明确区分"连接测试通过"与"模型已激活"，测试通过不显示为已激活、不改变商户可提交状态。
- 管理员执行轮换：版本 +1、旧版本吊销、审计（操作者/时间/correlationId）可查；按界面"重启后生效"提示重启后，商户发起一次真实生成，其 route snapshot / 审计中的 credentialVersion 即新版本——**接入与轮换全程未改一行代码、未碰一个 env**，US23 逐字兑现。
- 抖音槽诚实标注"未接入（recorded 装配）"，测试连接返回"未接入，不可真实测试"而非伪造成功；不出现"只差一个 Key"式表述（D10 / 票 04 口径）。
- 商户角色（owner/operator/reviewer）调用凭据命令与查询收到 FORBIDDEN；商户一级导航（创作/内容/素材/门店）与创作界面不出现任何平台凭据入口；商户 BYOK 仍走 Settings 工作区域，不混入本分区。
- **关票前置留证（D01 口径）**：在真实运行的管理模式界面完成"保存 → 掩码显示 → 真实测试连接（用 `docs/_private/tuzi.env` 已备凭据）→ 轮换 → 重启两进程 → 新版本被真实生成使用"的连续录屏/截图 + 审计与 route snapshot 佐证，落 `docs/evidence/contentpackage/`。仅单测绿、curl 出 JSON、fixture 通过一律不得关票；且遵守 MAP 全局规则——票 01 聚合合同冻结前本票不得关闭。

## Blocked-by / Blocks

- **Blocked-by**：**票 05（配置持久层）**——槽→运行时绑定 key 的持久落点、版本/审计/CAS、"存储值 vs 生效值"对照投影全部建在票 05 配置服务上；票 05 的 secret 形值拒绝校验也把凭据明文显式指到本票的 secret manager 引用方案。不依赖 E1 聚合合同（本票在管理面/集成域，不触成品事实）；不依赖票 18/20（本票先行，它们消费本票产物）。真实测试连接凭据已备（`docs/_private/tuzi.env`，LLM 探针已实测通过）。
- **Blocks**：**票 20**（adapter 装配切换 + 模型激活真实探针，MAP 明示 05+19 双前置）——真实探针必须用保险箱里的凭据发起，其激活证据接续本票"轮换后激活降级为 recorded"的语义闭环；同时解阻**票 22**（一条真实链路端到端跑通）的凭据接入不再依赖手工 env 与部署纪律。本票完成不改变北极星口径：真实跑通链路数仍由 06/09/11→22 主线承载，本票是管理面配套，不冒充链路进度。

## 风险与回退

- **明文泄漏面（最大风险）**：明文只允许在 store/rotate/test 命令的内存生命周期内存在；禁止进日志、审计 details、幂等 payload（valueHash 替代，照 `:306-310`）、票 05 配置表、任何查询响应与错误消息（probe 错误照 `:879` `[REDACTED]` 脱敏）；测试逐链路断言无明文。审计中秘密只以版本/指纹元数据出现（CONTEXT 模型供应审计口径）。
- **轮换半程失败**：put 新版成功但元数据未落定 → 复用 credentialTransition 分阶段 + 幂等键重入续跑；旧 secret revoke 严格排在元数据落定之后（`old_secret_revoke_pending` 语义），不出现"新旧都不可用"窗口。
- **测试连接产生费用/副作用**：只选 models 列表类无副作用端点，绝不 fallback 到生成调用；probe 不写业务 Job/用量/成本账，与 ModelSupply 双账物理隔离；对 429/限流按失败分类呈现，不重试轰炸。
- **双真相源（env vs 保险箱）**：boot 解析优先保险箱、回退 env，同一槽一次 boot 只有一个来源且在 UI 永远可见；不静默混用。绑定未建立时行为与现状逐位一致，防"上线即变行为"。
- **激活证据失效连锁**：保险箱轮换使 env 激活三元组失配——本票显式跳过对拍并降级 recorded + 诚实标注，不 boot throw、不伪装 live_verified；真实激活恢复由票 20 探针完成，本票不越界补造证据。
- **AWS 依赖**：recorded 模式（FakeKmsSecretStore）下全流程可开发可测；aws 模式复用 `runtime-from-env.ts:11-31` 既有开关与 `AWS_SECRETS_*` 配置，不新增基建组件（成熟组件优先）。
- **回退**：本票 expand-only——新 action 组、新 probe Port、boot 覆盖层、一个管理分区。出缺陷时移除绑定配置（boot 即回 env 直读，与现状逐位一致）+ 隐藏凭据分区即回滚；已入 secret store 的凭据与审计作为事实保留，不删除；`runtime-config.ts` 解析逻辑未被重写，零迁移成本。
- **范围失守**：不做执行模式切换（票 18）、不做装配切换与激活探针（票 20）、不碰商户 BYOK 通路（票 03）、不接抖音真实 API（D10）；不新增 seam（新 action 走 IntegrationsFoundationModule 既有分发）；凭据槽不暴露给商户任何角色；不把测试连接结果冒充激活证据。
