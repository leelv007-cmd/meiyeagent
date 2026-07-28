# 票 20 · adapter 装配切换 + 模型激活真实探针
> 建设面: E7 管理后台 ｜ 决策: DEC-ADMIN-CONTROL-PLANE ｜ Blocked-by: 05, 19

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "20",
  "decisionIds": [
    "DEC-ADMIN-CONTROL-PLANE"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-HARDCODED-ADAPTER",
    "G-HASH-ACTIVATION"
  ],
  "contractIds": [
    "X-VISUAL-CONFIG"
  ],
  "blockedBy": [
    "05",
    "19"
  ],
  "closureEvidence": [
    "docs/evidence/contentpackage/real-run-0003/activation/activation-evidence.json",
    "docs/evidence/contentpackage/real-run-0003/activation/catalog-publication/evidence.json",
    "docs/evidence/contentpackage/real-run-0003/activation/catalog-publication/admin-publication.webm",
    "docs/evidence/contentpackage/real-run-0003/activation/catalog-publication/published-catalog.png"
  ],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

> **2026-07-17 实现更新**：OpenAI 三个语言操作与 Seedream 4.5 两个图像操作已在同一管理员 workspace 通过真实探针，目录已经完成 `draft → enabled → published`，当前 head 为 `f68b2980-636e-4186-ba76-500ce26aae0a`。证据见 `docs/evidence/contentpackage/real-run-0003/activation/catalog-publication/`。**status 仍为 open**：尚缺同一连续录屏中的“配置改动→stale→重启→重探针→商户同入口真实生成”全链验收，不用单测或分段证据关票。

- **US24 / US25（已拍板未落地）**：规格拍板"在后台切换抖音 / BYOK 的 adapter 装配方式，so that 装配从硬编码变为点选"与"模型激活走'配置 + 真实探针 smoke + 落激活证据'，so that 激活证据是真调通、不是环境变量哈希伪装"（spec:92-93）；§5 状态机逐字锚定"**模型激活走 configure → probe → evidence_recorded；未通过真实探针不得进入用户可提交状态**"（spec:157），§10 锚定"模型激活证据来自真实探针 smoke，替代 live_verified 的环境变量哈希伪装"（spec:202）。管理后台待开发清单把两项列为同一批病根：`06-backlog-admin-control-plane.md:51-52`。
- **装配硬编码（票面锚点，实核未漂移）**：`apps/core/src/main.ts:326` `byok: new RecordedByokExecutionAdapter()`、`:334` `douyin: new RecordedDouyinAdapter()`——两个执行 adapter 是 `new` 死的，连 env 分支都没有（同文件 `:323` secret store、`:324` 飞书 MCP 都有 recorded/live 装配开关）；worker 第二进程 `apps/core/src/job-worker.ts:199` 同样硬编码 douyin recorded（票面未列，实核补充）。变更装配的唯一方式 = 改代码 + 重建 + 重部署。
- **激活证据 = 环境变量哈希伪装（票面锚点，实核未漂移）**：`apps/core/src/p1/model-supply/runtime-config.ts:91-94` 只要 directEvidence / arkImageEvidence / arkVideoEvidence 任一存在就把 runtime 整体点成 `activation: 'live_verified'`；而所谓 evidence 来自运维手填的 3 个 env 三元组（direct `:205-257`、Ark `:285-333`：`*_ACTIVATION_EVIDENCE_REF` 自由字符串 + `*_ACTIVATION_VERIFIED_AT` + `*_ACTIVATION_CONFIGURATION_REVISION`），唯一"校验"是 sha256(当前配置) 与手填哈希对拍（`:259-275`、`:335-359`）——**只证明"配置自声称验证后没变过"，从未证明真的调通过一次**。票面行号 91-94 是点亮处，完整伪装链横跨 205-359，以实核为准。
- **第二条自证通道（票面未列，实核补充）**：目录安全草稿允许管理员徒手把模型编辑成 live_verified——`foundation-module.ts:1613-1641` `validateSafeCatalogEdit` 只做格式校验（evidenceRef 非空即可），前端 `admin-model-control.tsx:654-668` 更是自由 JSON 草稿。只堵 env 一条路，伪装会平移到这条路。
- **伪证据解锁的是真金白银的商户提交**：`model-supply-creation-adapter.ts:243-256` 商户创作合同只放行 `live_verified`（否则 `MODEL_NOT_LIVE_VERIFIED` 409）；`main.ts:140-145` 流式 runner 同样以 `activation === 'live_verified'` 为闸。也就是说"可提交状态"这道产品闸门当前由一串没人调通过的 env 哈希把守。
- **探针机械已有先例但没接激活**：`index.ts:1380-1453` `executeCopyQualityProbe` 已经能走与生产完全同一条 ProviderExecutionPort 真实调用、不耗商户 Product Usage、留不可变 Run 记录（质量评测 `foundation-module.ts:1235` 在用）；但没有任何路径把一次真实调通铸成 ActivationEvidence。
- **票界**：配置持久层是票 05、凭据脱敏与测试连接是票 19、Live BYOK adapter 是票 03、抖音诚实标注与 `executionMode` 契约是票 04、执行模式（recorded/direct/ark）可视化切换是票 18——本票全部消费不重做。抖音真实 Publish/Observe 仍在 Out of Scope（pilot 触发点前，D10）：本票落的是抖音装配的**点选机制**，pilot 前 live 选项禁选并标「未接入」，不冒充可用。本票不触 ContentPackage 聚合本体（ADR-0011 成品事实不受影响），不重开 D4（探针用单条最小 fixture，与 3 选 1 候选策略无涉）。

## 现状代码入口（实核 file:line）

- `apps/core/src/main.ts:326,334`：两处硬编码装配，本票替换目标；`:335-346` BYOK 受控 endpoint profile（env 直读）；`:134-139` boot 一次性解构 `modelRuntimeAssemblyFromEnv(process.env)`；`:191-203` fallbackCatalog 用 boot 时的 deployments 快照拼装（运行期铸出的新证据不经重启/发布进不了它）；`:282-294` migrator 列表（新探针表两处都要挂，worker 侧 `job-worker.ts:149-160`）。
- `apps/core/src/job-worker.ts:166,199`：第二进程独立再跑一遍 env 装配 + douyin recorded 硬编码；worker 的 IntegrationApplicationService 未注入 byok（HTTP 进程独有），装配改造须两处一致。
- `apps/core/src/p1/model-supply/runtime-config.ts:26-203`：装配函数全量入口；`:91-94` 点亮处、`:205-257`+`:259-275` direct 三元组与哈希、`:285-333`+`:335-359` Ark 同构——哈希函数（配置版本指纹）是**好零件保留复用**，operator 自证的 evidence 来源是**坏零件替换**；`:404-450` directOptions 九项 env。
- `apps/core/src/p1/model-supply/adapters.ts:1344-1357`：`ModelExecutionRuntime.activation` 联合类型已含 `configured_unverified`——"配置了但没真调通"的诚实中间态**类型早已存在**，本票让它成为探针前的真实状态而非摆设。
- `apps/core/src/p1/model-supply/catalog.ts:11-16`：`ActivationEvidence`（status/verifiedAt/evidenceRef/configurationRevision）结构不动；`:346-435` `createDefaultDeployments` 证据盖章（`:384-396` 仅格式校验）。
- `apps/core/src/p1/model-supply/foundation-module.ts:465-470,495-510`：`deploymentRank`→`availability` 映射（live_verified=3 才 available）；`:702-751` getCatalog；`:1613-1641` 徒手 live_verified 的校验缺口；`:1667-1678` adminActions 白名单 + `:1909-1915` admin 门禁（新命令照抄）；`:1984-1993` `quality_evaluation_run` 命令先例；`:2033-2090` catalog draft/safe_draft/enable/publish 既有发布链（证据应用到商户目录走它，不新造）。
- `apps/core/src/p1/model-supply/index.ts:1380-1453`：`executeCopyQualityProbe`——真实调用、`jobId = quality-probe-*` 幂等、providerCost observed、不写生成 Job 不耗 Product Usage，激活探针的形态母版；`:1029-1046` `constrainRuntimeDeployments`、`:1065-1087` `applyCatalogRevision`（发布后即刻生效于商户目录的既有机制）。
- `apps/core/src/p1/operations/model-supply-creation-adapter.ts:243-256`：`MODEL_NOT_LIVE_VERIFIED` 商户可提交闸门——本票合同测试的断言点，代码本身不改。
- 前端：`mkfast-template-main/src/p1/admin-model-control.tsx:323-339` 已展示 activationEvidence 裸字段；`:654-668` 自由 JSON 草稿；`:671-824` enable/publish 的分级变更确认弹窗；`:695-707` 质量评测触发范式；挂载 `routes/admin/models.tsx:16`。商户侧对照面：`unified-creation-workbench.tsx:1822-1843` 模型不可用态已有渲染。
- 消费的兄弟票交付物（实施时以其落地形态为准）：票 05 `admin-config` 模块 + `admin_config_revisions`/`admin_config_heads` + 预注册 key `byok.adapter.assembly`/`douyin.adapter.assembly` + 存储值/生效值对照 + `'__global__'` 哨兵；票 03 `LiveByokExecutionAdapter` + `byokExecutionRuntimeFromEnv`（`BYOK_EXECUTION_MODE`）+ `strict_byok_options.executionMode`；票 04 `DouyinAdapterPort.executionMode` + `douyin_integration_status` 查询。

## 改造方案（步骤级）

1. **Schema / 契约**：(a) `apps/core/src/p1/model-supply/postgres-repository.ts` 新增不可变探针表 `model_activation_probe_runs`：id、deployment_id、catalog_model_id、operation、outcome（passed|failed + 失败分类）、configuration_revision（复用 `directModelConfigurationRevision`/`arkMediaConfigurationRevisions` 既有指纹函数）、latency_ms、usage/provider_cost（observed）、output_digest（sha256，不存全文）、correlation_id、actor_id、created_at；migrator 挂 `main.ts:282-294` 与 `job-worker.ts:149-160` 两列表。(b) 票 05 的 key 注册表新增 `model.activation.evidence.<deploymentId>`（global 作用域，值 = ActivationEvidence 形状，zod 强制 `evidenceRef` 必须是 probe run id 格式）；装配 key 用 05 已预注册的两枚，`douyin.adapter.assembly` 的 zod 枚举**由装配注册表驱动**——pilot 前注册表里 douyin 只有 `recorded`，`live` 值在 `config_apply` 写入时即被拒（伪状态存都存不进去）。
2. **Application Service 命令 / 查询（model-supply 模块内，不新增 seam）**：新命令 `activation_probe_run`（入 `adminActions`，门禁照抄 `:1909-1915`；分级变更确认——video 探针花真钱须弹费用确认）：输入 `{ deploymentId }`，按 deployment 的 operation 家族发**一次真实最小 smoke**——llm 走 `executeCopyQualityProbe` 同款单 fixture 固定路由；image/video 经同一 media 执行 Port 发最小参数生成（最小尺寸/最短时长），**与生产同 Port 同凭据（经票 19 供给），无探针旁路**。结果写不可变 probe run；**通过才**经票 05 配置服务把 `{status:'live_verified', evidenceRef:probeRunId, verifiedAt, configurationRevision}` 写进 evidence key（版本化+审计）；失败只留失败记录，证据不动。新查询 `activation_status`（逐 deployment：配置就绪与否、当前证据、最新探针、**staleness**=证据 configurationRevision ≠ 当前配置指纹）与 `activation_probe_runs`（历史）。幂等复用 executeModule 全套。
3. **铸币口收紧（两条伪装通道一起堵）**：(a) `modelRuntimeAssemblyFromEnv` 改为 `modelRuntimeAssembly(env, activationEvidence)`——boot 时（两进程）从配置服务读全局 evidence key 注入，指纹吻合才点亮 live_verified，配置了没证据 = `configured_unverified`（既有类型）；`MODEL_*_ACTIVATION_*` env 三元组路径删除，boot 检测到残留 env 打大声弃用警告并忽略。(b) `createSafeCatalogDraft`/`createCatalogDraft`（control plane 层）对声称 live_verified 的编辑增加实核：evidenceRef 必须解析到一条 **passed** 且 configurationRevision 与当前配置吻合的 probe run，否则 `INVALID_STATE`——徒手草稿路同步封死。
4. **adapter 装配点选接线**：`apps/core/src/p1/integrations/` 新增 `integrationAdapterAssemblyFromConfig(configService)`：boot 读 `byok.adapter.assembly` / `douyin.adapter.assembly`（无值时回落票 03 的 env、再回落 recorded；优先级 DB > env > 默认，一次性声明并写进 05 的 wired 对照），据此构造 Recorded/Live adapter 替换 `main.ts:326,334` 与 `job-worker.ts:199` 三处硬编码。**生效边界显式声明（spec:156）：装配 = 重启生效**（adapter 是 boot 注入的端口实现，不做热插拔新机制）；配置中心以存储值/生效值对照 + 「重启后生效」徽标呈现，永不冒充已生效。两枚 key 的 wired 翻真。
5. **前端（管理模式，扩 1876 行地基不新造）**：`admin-model-control.tsx` 每个模型/部署加"激活"区——证据状态规范化中文标签（已实测激活 / 仅录制回归 / 仅文档，raw code 不裸露）、最新探针结果（时间/时延/用量/观测费用/correlationId）、「运行真实探针」按钮、staleness 显示「配置已变更，需重新探针」、探针通过后「将证据写入目录草稿」预填并走既有 safe_draft→enable→publish 发布链（`:671-824` 分级变更确认原样复用）。票 05 配置中心 Tab 的两枚装配 key 行升级为点选控件：BYOK recorded↔live、douyin 仅 recorded 可选 + live 禁用「未接入（pilot 触发点前）」（口径与票 04 一致）。BFF 零改动（P1 通用转发已覆盖）。
6. **测试（打 Application Service 外部行为 + PG 真实事务）**：(a) 规格 Testing 逐字合同——配置就绪但未探针 / 探针失败：商户创作合同 inspect/submit → `MODEL_NOT_LIVE_VERIFIED`，模型不得进可提交状态；探针通过 + 目录发布 → 同一提交放行。(b) 防回归——env 三元组齐全也不再点亮 live_verified；徒手 safe draft 填 live_verified（evidenceRef 悬空 / 指向 failed run / 指纹不符）→ 拒绝。(c) staleness——改供应商配置后 `activation_status` 报 stale、重启后退回 configured_unverified、重新探针恢复。(d) 探针账务——probe run 带 observed provider cost、不消耗任何工作区 Product Usage、同幂等键 replay 同一 run 不二次调用。(e) 装配——config 写 live/recorded 后按 restartedRepository 范式重建装配，`strict_byok_options.executionMode` 与 `douyin_integration_status` 如实翻转；douyin `live` 写入被拒；重启后装配值仍在。(f) 显式隔离 live 探针测试（`docs/_private/tuzi.env`，默认不进 CI）真实跑通一次 llm + image 探针。测试是护栏，不作为关票依据。

## DoD（全部必须是用户可见行为）

- 平台管理员在管理模式模型页对一个已配置的模型点「运行真实探针」，看到本次**真实供应商调用**的结果（通过/失败、时延、用量与观测费用、correlationId）；通过后该模型激活状态变为「已实测激活」，证据引用点开即这条探针记录。**对照证据（当前 vs 改造后）**：当前 live_verified 的唯一来源是部署时手填 3 个 `MODEL_*_ACTIVATION_*` env（`runtime-config.ts:205-257`，evidenceRef 为自由字符串，从未证明调通）或徒手目录草稿（`admin-model-control.tsx:654-668`），产品内没有任何探针入口（模型页只有质量评测按钮）；改造后同一状态只能由一次真调通铸成，env 三元组与徒手草稿双双失效——两组界面截图并排存档。
- 「未通过真实探针不得进可提交状态」是商户可见行为：探针未跑或失败时，商户在创作工作台看到该模型不可用、提交被拒（`MODEL_NOT_LIVE_VERIFIED` 既有口径）；管理员探针通过并发布目录后，同一商户同一入口该模型变为可选，且能真实提交一次生成。
- 管理员改动供应商配置（如换 base URL）后，模型页立即显示「配置已变更，需重新探针」，重启后该模型退回未激活——证据与配置版本绑定，吃不了老本；重新探针通过后恢复。
- 管理员在配置中心**点选** BYOK 装配 recorded↔live：立即看到存储值/生效值对照与「重启后生效」徽标；重启后生效值翻转，商户 `/settings/models` BYOK 面板的"演示执行"标注随装配如实出现/消失（消费票 03 的诚实标注，全程无一处冒充）。**对照证据（当前 vs 改造后）**：当前切装配 = 改 `main.ts:326,334` 源码 + 重建重部署，产品内零入口。
- 抖音装配行诚实呈现：仅 recorded 可选，live 选项禁用并标「未接入（pilot 触发点前）」，与票 04 商户侧标注同源同口径；后台不出现任何冒充可用的开关。
- 探针不动商户的账：运行探针不消耗任何工作区额度，费用作为平台观测成本记在探针记录上、管理员可查——商户账单不为平台自检买单。
- **关票前置**：一条"配置→真实探针调通→证据落库→目录发布→商户可提交并真实生成"的连续留证（录屏/截图 + probe run 与配置版本链 SQL）落 `docs/evidence/contentpackage/`。仅单测绿、fixture 探针通过、curl 出 JSON，一律不得关票；遵守 MAP 全局规则——票 01 聚合合同冻结前本票不得关闭。本票不冒充北极星进度：真实跑通链路数仍由 06/09/11→22 主线承载，本票是让 0→1 的"真"字有据可查。

## Blocked-by / Blocks

- **Blocked-by**：**票 05**（配置持久层——evidence key 与装配 key 的落点，spec:208 硬前置"未落持久层不做可视化配置面"）；**票 19**（凭据脱敏管理 + 测试连接——探针用的供应商凭据经其供给，"测试连接"是轻探活，本票探针是深冒烟，层级衔接不重叠）；**票 03**（Live BYOK adapter——装配切换得有真实对象可切）；**票 04**（`executionMode` 契约与接入状态查询——装配点选后如实回显的事实底座）。与**票 18**（执行模式可视化切换）为 05 之上的平行兄弟票：探针只读"当前生效配置"，不关心它来自 env 还是 18 的接线，无实施依赖，仅共用 05 配置服务。
- **Blocks**：**票 22**（一条真实链路端到端留证）——验收链路上的模型激活证据必须由本票的真实探针产生，否则留证材料自带哈希伪装污点；E7 管理后台整面的完成度以本票收尾装配与激活两格；pilot 触发点后抖音真实 adapter 落地时，经本票装配注册表即插即用、零重构。

## 风险与回退

- **探针花真钱且 video 不便宜**：控制——最小参数（llm 单 fixture / image 最小尺寸 / video 最短时长）、admin 门禁 + 分级变更确认（video 探针弹费用与影响审阅）、同幂等键 replay 不二次调用、费用作为 observed 成本全程可查；探针频度是管理动作天然低频，不建限流新机制。
- **探针是时点证明不是永续健康**：真调通一次不担保次日不挂。控制——证据带 verifiedAt + configurationRevision，配置一变即 stale 强制重探；生产期故障仍由既有 Job 失败分类与告警承载，本票不把探针冒充监控。
- **铸币口漏堵**：env 路与徒手草稿路只堵其一，伪装平移。控制——步骤 3 两路同票收紧 + 测试 (b) 双防回归断言；code review 检查全仓再无第三处 `status: 'live_verified'` 字面量铸币。
- **升级即全网未激活**：删除 env 三元组路径后，已部署环境的假 live_verified 一夜归零，商户暂失可提交模型。这是**有意的诚实重置**（旧证据本就是伪装），发布说明明示：升级后管理员须对每个真用的 deployment 跑一次探针（一次性动作，证据持久化后重启不丢）；上线窗口选择低峰并提前跑好探针即可无感。
- **装配重启生效被误解为已生效**：控制——存储值/生效值对照 + 「重启后生效」徽标（票 05 既有范式），漂移永远可见；不做 adapter 热插拔（boot 注入端口换热插拔 = 新机制新风险，收益仅省一次重启，明确不做并写入生效边界声明）。
- **回退**：本票 expand-only——新探针表、新命令/查询、装配读点替换三处 `new`。出缺陷时：装配 key 清回 `recorded`（或删除 DB 值回落 env/默认）即回到当前行为；探针命令从 adminActions 摘除、前端隐藏"激活"区即停用；已铸的真实证据与探针记录作为事实保留不删除。最坏情况 git revert 铸币口改造，恢复 env 三元组路径——但那是恢复伪装，仅作为阻断生产的最后手段并须记 ADR 说明。
- **范围失守**：不做抖音真实 Publish/Observe（Out of Scope，pilot 前）；不做执行模式切换（票 18）、凭据管理（票 19）、配置表本体（票 05）；不新增 seam（命令查询全走 model-supply/admin-config 既有模块分发）；不触 ContentPackage 聚合与商户一级导航（创作 / 内容 / 素材 / 门店不变）；商户侧永远看不到装配与探针入口（Admin Control Plane 是平台管理员管理面）。
