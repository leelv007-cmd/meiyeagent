# 后台能力指挥台 + 多渠道模型供应 开发规格（2026-07-20）

- 决策依据：D-048~D-071（后台管理平台可视化 D-048~D-057 + 多渠道模型供应 D-058~D-069 + 控制中心 D-070/D-071），**全部按 D-080 六项处置的修订口径执行**（C1 只读异常列表 / C2 自报+查找表 / C3 骨架与 MP 纵向同一增量、CF broker 不进首切 / C4 凭据三态主干+SupplyPool 一等实体 / C5 三核心官方主渠道真实连通为发布门，双渠道为非阻塞增强 / C6 熔断参数抄 LiteLLM/Envoy 默认）；继承 D-037/D-038/D-040/D-044/D-080、ADR-0011
- 复核链：`docs/reviews/admin-supply-decisions-xcheck-2026-07-20.md`（六路复核+D-080 处置）+ 上游对照 `docs/reviews/mkfast-mkimage-source-xref-2026-07-20.md` + 本 spec 双路 Codex 对抗复核 `.scratch/admin-supply-spec-review-2026-07-20/lane1-fidelity.md`（决策保真：0 P0/9 P1/5 P2）与 `lane2-reality.md`（代码现实与分包：6 P0/13 P1/5 P2）——**33 条全采纳并已回写本稿**
- 与在飞包的关系：**本 spec 是 D-080 证据边界预留的 AP/MP 拆票欠账补足**；#83 包（#84-#105）已占位的接缝本包只消费不重建——`product-quote` contracts 与 ProductUsage 预占/结算扩展属 WT-B（#92）、pending-actions/ActionableInboxItem 属 WT-B（#94）、VideoWorkflow 派生化属 WT-E（#102）、S1（#87）冻结清单对本包同样生效。**票号权威**：以上编号非 UI spec 原文，出处=已提交的 `docs/handoff/ui-journey-rebuild-handoff-2026-07-20.md` 与 `.scratch/ui-journey-tickets-2026-07-20/issue-numbers.json`（GitHub 已发布 issues）
- 实施状态：**终稿**——双路 Codex 复核 33 条 + 双路一致性复核（落地核验 38/38、全局一致性 P0=0/P1=4/P2=5）全部落地；跨包属主已在 `docs/handoff/ui-journey-rebuild-handoff-2026-07-20.md`「跨包接缝增补」节双向确认；进入拆票

## Problem Statement

平台运营者（当前=单人运营的受信管理员）今天面对的后台是七个互不相识的孤岛页：`/admin` 打开即跳模型页，没有"现在有什么需要我处理"的入口；能力是否可用要靠翻多个页面自行拼装；模型供应是"看得到但调用不到"的死配置——catalog 头虽已热生效，但凭据/adapter 运行时能力仍是启动期冻结 + 环境变量装配；凭据以裸 `env` 为主装配源无生命周期；同一模型无法在官方与第三方渠道间治理性切换；供应成本与产品用量虽有账本底座但没有从采购到分配的动态闭环；Cloudflare 侧证据与业务影响完全脱节。

## 现状基线（双路复核实锤，防双建/防误判空白）

拆票人必须按此基线区分「迁移演进」与「从零新建」；逐条 file:line 证据见 `lane2-reality.md`。

- **`model-supply/index.ts` = 4,828 行混合体**：供应基础合同 `:16-358`、ledger port/provider lifecycle `:527-788`、路由规划 `:821-950`、主应用服务 `:1189-`、**VideoWorkflow 段 `:3053-4780`（只归 #102 WT-E 抽取，本包任何票不得搬运）**、CopyProvider `:4788`。装配门面在 `runtime-assembly.ts`/`runtime-config.ts`，HTTP/Worker 实例化分别在 `main.ts:289-317`/`job-worker.ts:223-278`。
- **catalog 头已热生效**：`applyCatalogRevision` 只切换未来提交（`index.ts:1325-1351`），发布后控制面立即调用；真正的缺口=活动 Deployment 必须落在**进程启动时冻结的 runtime capability** 内、凭据/adapter 仍启动期组装。热装配票的目标是后者，不是重建 catalog 热读。
- **凭据基线**：`CredentialMetadata`/`SecretStorePort`/`IntegrationConnection` 已有（fake/file/AWS 三种 backend 入口）；三固定槽真实存在但 runtime vault binding 只覆盖 `model.direct`/`ark.media`，`douyin.platform` 探针显式 `not_wired`。CredentialAccount=从这套实体迁移特化，不新建第二 secret vault/repository。
- **RouteSnapshot 四形分化**（比"两形"更重）：foundation 规范形（`foundation/domain.ts:99-133`）、model-supply 富快照（`index.ts:294-356`）、StrictByok 公共形（`integrations/contracts.ts:182-190`）、两个手写 checkpoint 转换器（`model-supply/foundation-ledger.ts:66-93`、`integrations/foundation-byok-ledger.ts:48-96`）。规范化=独立跨域迁移票（S2b），G/H/I 只消费。
- **账本语义分离是既定事实**：`p1_usage_events` 是预占/结算状态机，GrantLot 只管额度来源+到期 FIFO（`grant-lot.ts:1-9` 注释明示）；ProviderCost 是独立 append-only 链（幂等 `appendProviderCost`）。**不存在"GrantLot 演进为 ProductUsageLedger"这回事**——三者各自演进，见 Implementation 6。
- **EntitlementPolicy 已有可执行合同**：`ProductEntitlementPolicy` 含 revision/tier/四模态 allowance/concurrencyLimit/queuePriority + composite resolver；任务提交时写入 scheduling。WT-H=扩展包裹，不新建平行 port。
- **RoutePolicy/DataPolicy 有薄基础**：`RouteRevision`（仅 id/model/operation/revision）、`Deployment.allowedDataClasses`、执行与模拟共用硬过滤（`planModelSupplyCandidates`）。演进而非首建；先加 characterization tests 再接新政策聚合。
- **健康 overlay 现状=三处进程内 cooldown map**（gateway PoC + recorded image/video adapters 各一，固定 30 秒），无 `circuit_open`、无持久化状态机。新 overlay 落地时必须迁移/删除三处本地 map，不写第四份。
- **Ark/Tuzi/TTS 基线远高于旧稿假设**：`MediaProviderLifecyclePort` 已要求并已实现 submit/recover/poll/download/cancel + observed usage/cost。WT-I 发布缺口=三模态官方主渠道真实生成；health/drain/**跨进程持久化 recover**/late-terminal 对账与双故障域 conformance 保留为非阻塞增强，**不是补 cancel/usage/recover**。
- **capability permission 已有集中骨架**：`productCapabilities`（含 `publication.handoff`，`uiux.ts:298-347`）+ `requiredP1Capability`（`:405-494`）+ `server.ts:353-376` 统一授权。缺口=key 太粗、未知 action 落宽泛默认，非显式注册+默认拒绝。WT-K=演进这条缝，不建新缝。
- **OperationalMetric 是 job-runtime 私有类型**（`job-runtime/operational-metrics.ts:10-36`），今天唯一 reporter=`PostgresOperationalMetricsCollector`，前端 audit 页自行复制 view 类型消费。S2 需把 known|unknown envelope 提升到 contracts，job-runtime 降为 reporter 之一。
- **pending-actions 服务存在但条件装配**：仅 `harnessRuntimeConfig` 存在时装配（`main.ts:1076-1087`），server 仅非空才注册路由。异常首页依赖它成为无条件平台服务（由 #94/Z2 解除条件装配）。
- **并发/优先级现状**：PgBoss 路径 per-workspace 并发门+plan queuePriority 已生产落地；Graphile 对照 adapter 只吃 priority、无 workspace gate。
- **测试先例**：发布聚合先例=**model-supply foundation-module 测试**（lifecycle/publish/rollback/CAS；admin-config 只有 apply/rollback CAS+审计，无 candidate→approve→publish）；真机测试命名=`live-*.integration.test.ts` + env 显式开闸（**仓库不存在 `*.live.test.ts`**）；CI `core-persistence` 是持久化门非供应商真机 job；前端现状=node:test 纯模型+SSR markup+memory-router，**无 RTL**（#86 落地后才有）。
- **前端事实**：admin 业务路由恰七页（`lib/routes.ts:49-57`），`p1.tsx` 是兼容 redirect 不算第八页；`/admin`→models redirect 存在。"两候选"=**最多两次 provider route attempt**（`slice(0,2)`+`attemptLimit:2`），与 live LLM 一次三份 copy 候选是不同维度，不得混写。

## Solution

在现有 TanStack/shadcn 管理壳与 Product Core 之上，按 D-051/D-054 建"能力指挥台"骨架并与 D-068 供应纵向作为**同一增量**交付（D-080 C3）：

1. **能力骨架**：capability registry（合同类型先定，字段承载 D-051 六问全项——用途/可用状态、配置 revision 与生效范围、依赖、运行事实、最近变更与审计证据、安全操作）+ 各域自报状态（OperationalMetric known|unknown 诚实合同提升到 contracts）+ 能力↔依赖静态查找表 + **版本化 capability inventory**（D-051 决定③清单逐项登记，音频=`not_instrumented/not_in_scope_for_supply_v1` 存根）；已插桩域（模型供应/任务队列/权益额度）做深，其余静态 manifest 存根；`/admin` 默认首页=只读异常列表（root-cause key 去重、严重度排序、受影响能力、新鲜度、下钻与技术移交链接），由 pending-actions 投影（阻塞 #94 ActionableInboxItem 合同）与 OperationalMetric 组合生长，无 ack/assign。
2. **供应控制面**：四层实体（CatalogModel→ProviderProfile→ExecutionChannel→Deployment）+ SupplyContract + CredentialAccount（三态主干）动态 registry 与版本化热装配（缺口=凭据/adapter capability 动态化，catalog 热读已有）；**RouteSnapshot 规范化为独立迁移票先行**；RoutePolicy 发布 + 运行时健康 overlay（LiteLLM/Envoy 默认参数带出处落地）；DataPolicyRevision 数据等级硬过滤；质量门禁→健康护栏→成本优化三层排序；EntitlementPolicy+AccountAllocation 套餐默认+有期限覆盖；SupplyPool 共享默认+DedicatedSupplyPool 一等例外；账本各自演进（GrantLot 保名保义=额度来源/FIFO；ProductUsage 预占/结算合同属 #92；ProviderCost 演进 `appendProviderCost` 链），双侧桥接归唯一接线票。
3. **控制中心与安全动作**：D-070 模型供应与网关控制中心作为一级能力模块（总览/关系/运行表/任务下钻 + 受治理快捷操作：探针/路由模拟/发布回滚/隔离排空恢复/轮换）；D-057 能力权限合同先行（演进既有 server.ts 集中授权缝：显式注册+默认拒绝+审计）；Cloudflare v1 只读三件套=deep-link + 自有探针 + **只读 REST 部署/版本/资源盘点**（D-053 已拍板保留；仅 GraphQL analytics trend broker 延期，D-080 C3；写操作全禁）。
4. **验收强度**（D-069/D-080 C5 不打折）：文本/图片/视频三核心 operation 各两条独立故障域的 `live_verified` Deployment + 真实故障注入；次级 operation 至少一条真实 live_verified，单通道明确标示 no-fallback。

## User Stories

### A. 能力骨架与异常首页（D-048/D-051/D-054/D-055/D-056，按 C1/C2/C3）

1. 作为运营者，打开 `/admin` 我想第一屏看到"现在有什么需要我处理"的只读异常列表（blocked/degraded/attention/not_verified/长时间 stale），按严重度×范围×持续时间×最近变化排序、同根因去重为一条主事件并列受影响能力，以便不用翻页找问题。
2. 作为运营者，每条异常我想直接看到受影响能力与范围、开始/最近变化时间、证据来源与新鲜度、最近相关变更、下一步动作或技术台移交链接（含脱敏上下文），以便判断自己处理还是移交；首版没有负责人/确认/指派工作流（D-080 C1，出现第二运营角色再引入）。
3. 作为运营者，无异常时我想看到"当前无待处理异常"+ 全景摘要区块（StatCard 轻量件参照上游；**"三到五个"为初始设计假设，数量待可用性验证，不作固定验收数**，D-055 待验证段）与能力目录入口，不要装饰性红绿大屏。
4. 作为运营者，我想要一张按能力域组织的两层目录（一级=账号与商业化/AI 供应与生成/任务编排/内容与资产/外部集成/运行与治理；二级=技术依赖与证据下钻），现有七个后台路由页按能力域重新编组为下钻页，不再是孤岛，以便从"哪项功能有问题"到"哪个组件导致"。
5. 作为实施者，能力状态由各域模块自报（OperationalMetric known|unknown 诚实合同，envelope 提升到 contracts、job-runtime 现有 collector 降为 reporter 之一），能力↔依赖为静态查找表仅用于详情 join 与反查，不建图级严重度传播/合成引擎（D-080 C2）；缺数据显示 `not_instrumented`+接入任务，禁止零值/静态绿/模拟数据伪装健康。
6. 作为实施者，首个增量=能力合同类型先定→已插桩域（模型供应/任务队列/权益额度）完整做深→其余静态 manifest 存根→异常首页由真实上报域组合生长；该骨架与 MP 供应纵向是**同一增量**，MP 产出直接回填同一 capability registry（D-080 C3）。**capability 合同必须逐能力承载 D-051 六问**：①用途与可用状态；②当前配置 revision 与生效范围；③依赖引用；④调用量/成功失败/延迟/额度/成本运行事实摘要；⑤最近变更/告警/审计证据引用与下一步；⑥符合 D-048 边界的安全操作（allowedSafeActions/技术移交 envelope）。静态存根的最低字段=名称/用途、`not_instrumented`/`not_verified` 显式状态、证据时间、关键依赖、owner、有效下钻（D-056），`not_instrumented` 只能替代运行事实项，不能替代其余五问。
7. 作为实施者，S2 落盘**版本化 capability inventory**（D-051 决定③清单逐项：账号与认证/套餐权益支付兑换码/模型供应商与路由质量/文案图片视频音频生成/Harness 任务队列/ContentPackage 模板素材画布/渠道与工具集成/数据与存储/配置密钥/观测告警审计），每项标 instrumented|stub、owner、下钻；音频=`not_instrumented/not_in_scope_for_supply_v1` 存根，不从能力地图消失。
8. 作为运营者，界面语言=能力/功能/用户影响；`workspaceId` 等底层隔离键不进一级信息架构，只在技术证据或受控诊断详情按需显示（D-051）。**D-048 交互禁令入验收**：日常运营路径不得要求编辑代码、SQL、环境变量、原始 JSON 或命令行；复杂代码级修复生成可移交的脱敏上下文与证据，不在运营界面伪装成一键修复。

### B. 能力权限合同（D-057）

9. 作为平台，后台所有读取与操作在 `admin/user` 外层门之后再按 capability permission 校验：首批权限域=系统/能力查看、任务恢复动作、渠道/部署生命周期动作（隔离/排空/恢复）、运行/模型/模板配置发布与回滚、账号与商业化治理、供应商凭据治理、审计查看/导出（「事件确认与指派」延后）；服务端集中解析、默认拒绝未知权限，前端只按授权呈现入口，不作权限真相。**实现=演进既有缝**：`productCapabilities`/`requiredP1Capability` 经 S2 无行为迁出到 `packages/contracts/src/capability-permission.ts`（从冻结的 `uiux.ts` 兼容 re-export），未知 module/action 返回未注册由 server 默认拒绝；WT-K 只改 `server.ts` 集中授权点与新 key/审计投影，不碰 operations 五件套、不向各 FoundationModule 塞权限声明；若需覆盖非 HTTP 内部调用，在 `P1ApplicationService` 注入统一 authorizer port 并由接线票装配。
10. 作为平台，高影响动作在权限之外必须带目标与影响预览、原因、CAS/幂等或回滚合同与不可变审计（actor/permission/target/reason/before-after/correlation/时间）；隐藏按钮不算保护；Cloudflare 写操作不因新增权限键而获得授权（D-053）。
11. 作为运营者，首期受信管理员获得完整能力权限维持单一管理路径；未来多人分工时由既有权限组合成角色，不重写命令与审计合同。实现沿用中间件双态（路由 throw redirect / API 401-403 共享判定源）+ Better Auth admin() 原语复用（impersonation 未拍板不启用，D-049 支持会话合同另行决策）。

### C. 供应实体与凭据（D-058/D-060/D-061，按 C4）

12. 作为运营者，我想按四层管理供应：CatalogModel（制造商模型身份/模态/能力）→ ProviderProfile（真实签约运营方，New API/Sub2API 只是 `gatewayFingerprint` 元数据）→ ExecutionChannel（官方直连/中转/区域/协议/账号归属）→ Deployment（模型×渠道绑定，承载 endpoint revision/生命周期/数据策略/价格/限流/激活证据/运行状态），管理表格可扁平呈现但编辑/审计/API 保留规范实体与引用，禁止复制模型行造多份真相。**实现=从既有 CatalogRevision payload（ProviderProfileRevision/ExecutionChannelRevision/PublishedDeployment 薄记录）expand/migrate**，保留 revision ID 与历史读取；若拆独立聚合须带回填/双读校验/切换回滚，不建平行 catalog。
13. 作为运营者，同一 CatalogModel 我想维护多条 Deployment 并从模型反查所有渠道、从故障渠道反查受影响模型/能力/任务（模型/交易方渠道/部署/凭据/路由五个关联视图）。
14. 作为运营者，凭据独立为 CredentialAccount（账号标签/ProviderProfile/项目区域/类型/scope/secret reference/版本/状态/来源/验证时间/有效期/可公开限额），密钥值只写 KMS/Secret Manager，产品 API 永不回显；生命周期=三态主干 `pending→active→retired`，`tested` 为激活前置门（激活命令校验最近连通/能力探针证据），`draining` 仅作承载异步媒体任务的渠道/凭据子状态（D-080 C4）；轮换不追改历史快照、运行中任务不静默换凭据。**实现=以 IntegrationConnection/CredentialMetadata/SecretStorePort 为迁移源做 provider-account 特化+请求期 broker**，不新建第二 secret vault/repository。
15. 作为平台，平台凭据与用户 strict BYOK 严格隔离为不同 scope、互不回退（以既存 `FoundationStrictByokLedger` 基线扩展，不从零重建；BYOK 失败不回退平台凭据、平台任务不读用户凭据）；现状裸 `env` 装配源迁移为受监控的 `env_fallback` 并持续显示风险与迁移入口；三固定槽（model.direct/ark.media/douyin.platform，**现状=3 槽元数据/2 个 runtime binding/douyin not_wired，迁移验收分别覆盖元数据与真实装配**）迁为动态 registry+binding，Provider runtime 经服务端 secret broker 按冻结版本装配。**Cloudflare Worker Secrets 只管理 Worker 自身运行密钥，不替代 Node Core 的 CredentialAccount 注册表真相（D-060）**；迁移合同含 D-044 兼容测试：verified-workspace provisioning outbox 写入的平台默认模型 preference 在新 registry 下继续成立且引用平台全局激活证据。
16. 作为运营者，凭据管理用 D-057 独立高敏权限：查看元数据/写入轮换/测试/激活/排空/撤销分别审计；连接测试返回规范化结果与证据，不把上游响应、Authorization、完整 endpoint query 写日志。

### D. 路由、数据政策与排序（D-059/D-064/D-065，按 C6）

17. 作为运营者，我按能力/operation 发布 RoutePolicy revision（硬约束/候选 Deployment/顺序档位/最大尝试/成本边界/回退授权），走 candidate→simulate→approve→publish→rollback（发布聚合先例=model-supply catalog registry；admin-config 仅提供 CAS/审计/回滚小先例）；质量评测与运行指标只能生成策略候选/告警，未经发布门不永久改路由。**实现=演进既有薄 `RouteRevision` 与 `planModelSupplyCandidates`：先加 characterization tests 冻结现行为，再接新政策聚合；禁止新旧两套生效头并存**。
18. 作为平台，硬约束先于排序（能力参数兼容/激活证据/数据类与区域/凭据归属状态/生命周期/套餐额度/禁用项）；未过硬约束的 Deployment 永不因价格或健康分被选中；recorded 占位价格不作生产排序输入；**任一关键证据缺失/过期/低于样本阈值时排除或仅保留 canary 档（D-065 决定②）**。
19. 作为平台，运行时健康 overlay=`healthy/degraded/cooldown/circuit_open/unavailable` 短期状态（有原因/来源/起止/审计，只影响新任务不改 revision）；**初始参数直接采用 LiteLLM router `cooldown_time`/`allowed_fails` 与 Envoy outlier detection 成熟默认，以带出处的配置常量落地，真实流量后按发布门校准，不自行标定**（D-080 C6）。自动回退仅限 `rejected_before_accept` 且下一候选满足全部硬约束；accepted/acceptance_unknown 进入查询/对账/人工恢复，不跨渠道盲目重提。**实现=S2 抽 HealthOverlayPort/状态合同，G 拥有持久化 overlay，I 只报告失败事实；现存三处进程内 cooldown map 迁移或删除，不留第四份**。
20. 作为平台，每个任务规划期定 `dataClass`，每个 Deployment 绑 DataPolicyRevision（来源信任等级/处理区域/留存训练子处理者合同/允许数据类）；低敏数据可在获准官方/第三方间切换，`contains_face/pii/medical-health` 只进合同与技术证据双批准的 Deployment；内容安全拒绝不得换供应商绕过；无合规候选失败关闭，不静默降级数据保护（D-064）。**`medical/health` 指内容数据敏感度分类，不等同 D-025 医美品类边界，首轮不因该数据类承接医美内容**；提供分类人工纠错入口（重分类留审计）；前台可展示"数据处理等级/受保护通道"说明但不泄露供应商身份。
21. 作为平台，候选排序=质量/可靠性门禁（conformance/映射可信度/激活证据/版本化质量基线/成功率/p95/接受态完整性）→健康容量护栏（circuit/限流/余额配额/并发/容量 headroom）→可对账成本优化（**规范化供应成本+失败成本+延迟+集中度**；成本证据优先级=账单>observed usage>网关估算，仅 estimate 的渠道保留风险折扣与流量上限）；每 operation/质量档独立 RoutePolicy revision，无全局权重（D-065）。
22. 作为运营者，路由模拟器展示硬过滤、排序、实时排除、最大成本与接受态分支、未选原因、**证据新鲜度与成本证据来源**（D-065 决定④）；模拟器与任务审计共用同一解释投影。**RouteSnapshot 规范类型统一为 S2b 独立迁移票**（四形分化收敛为单一权威类型+兼容适配器），规范字段=模型/交易方/渠道/部署/凭据版本/策略版本/价格版本/endpoint 版本/数据政策 revision/全部允许候选及排序/实际 Deployment/运行时排除原因/回退链/来源种类（D-058 决定③+D-059 决定④+D-064 决定④），并有字段级序列化+回放合同测试。

### E. 权益分配与供应池（D-061/D-062/D-063/D-066）

23. 作为平台，**产品侧与供应侧是两套不可互换的真相（D-061）**：注册用户不直接分配上游 token/上游账号/网关余额，只分配我方 `Entitlement + UsageAllowance + ConcurrencyPolicy + RoutePolicy`；上游余额/RPM/TPM/并发/故障属供应侧约束，用户套餐额度与权益属产品侧真相，分别记账、经分配策略关联。
24. 作为平台，用户只见 CatalogModel 不见渠道（前台序列化边界已由 #83 包 #95 落地，本包补供应侧）：渠道切换不改变用户模型选择与产品额度；**用户选固定 CatalogModel 时策略只能选 Deployment，选 Auto/质量档时才允许同时选 CatalogModel 与 Deployment（D-062 决定②）**；无合规候选时明确"模型暂不可用"，不静默换模型；治理性隐藏=requested/resolved 分离+RouteSnapshot 可审计（上游装饰性隐藏为反面参照）。
25. 作为运营者，套餐绑定版本化 EntitlementPolicy（允许的 CatalogModel/质量档、四模态额度、并发速率、队列优先级、可用 SupplyPool、超额规则、有效期），发布后批量生效不逐户复制；AccountAllocation 只表达显式例外（grant/restrict，带目标/增量或上限/来源/原因/创建者/起止/审计/回退），到期自动回落套餐默认。**实现=扩展既有 `ProductEntitlementPolicy` port 与 resolver（迁移 `product/p1-model-policy.ts`/`foundation/entitlement-service.ts`），不建平行 port**。
26. 作为平台，有效权益=平台硬限制 > 套餐 EntitlementPolicy > 账号级批准覆盖 > 活动临时额度 > 请求级合法偏好，带变更前后预览；管理员不直接改余额/历史用量，只发布权益 revision 或追加不可变调整事件；登录身份属多工作区时在账号详情→分配管理下钻流内显式选目标工作区（受限例外，不进一级 IA）。
27. 作为平台，上游账户默认共享 `CredentialAccount+SupplyPool` 服务多账号；企业合同/指定区域/受限数据/专属账单/保底容量走一等 `DedicatedSupplyPool`（代运营/陪跑高价值客户核心交付服务，D-080 C4），绑定专用 CredentialAccount/Deployment 由 AccountAllocation 或合同权益授权；专属/共享互不回退，除非合同与数据政策显式授权。
28. 作为平台，共享池防 noisy-neighbor：供应账户级容量隔离与公平排队为本包新增（产品账号侧 per-workspace 并发门与套餐 queuePriority 在 **PgBoss 生产装配**已落地不重建；若 job runtime 可切 Graphile 须补 transport conformance 子票——Graphile adapter 现只吃 priority）；**容量三层建模=供应账户级/产品账号级/系统总容量（D-066 决定④），并有"多产品账号不能绕过上游共享限额"的负向测试**；上游只给账户总余额时未归因差异保留为 supplier-level variance 不强摊用户。
29. 作为平台，账本演进边界：每请求冻结 workspace/RouteSnapshot/CredentialAccount version/supplier request-task ID/usage/供应侧价格 revision；**GrantLot 保名保义（额度来源+到期 FIFO：`expirationDate ASC NULLS LAST`+授予/核销独立幂等键，上游两教训为硬要求）；ProductUsage 预占/结算合同与 schema 演进属 #92（WT-B），本包只消费并补供应侧外键/快照字段；ProviderCost 演进既有 `appendProviderCost` append-only 链不另建**；`model-supply/foundation-ledger.ts` 双侧桥接归唯一接线票（Z2-WIRING），WT-H 与 #92 不得同改账本文件。

### F. 三模态供应闭环与验收（D-067/D-068/D-069，按 C5）

30. 作为平台，首轮端到端主链贯通：结构化 ProviderProfile/SupplyContract → CredentialAccount secret 写入/测试 → ExecutionChannel/endpoint revision → provider alias 映射 CatalogModel → conformance/数据政策/价格证据 → Deployment 审批发布 → SupplyPool/RoutePolicy revision → 套餐默认与测试账号覆盖 → 用户真实任务 → RouteSnapshot 与双侧账本分账 → 后台审计下钻；发布后 HTTP 与 Worker 读同一 effective revision，渠道增删隔离排空**不依赖进程重启**。
31. 作为平台，首轮同时覆盖文本/图片/视频三模态（音频后续独立，能力目录仍留存根）：三类任务全部经统一供应链实体与账本，媒体不再走环境变量/固定 provider mode/recorded 目录旁路；MP-04 拆 MP-04T/MP-04I/MP-04V，热装配/路由发布/用户分配/双侧账本/故障注入同时覆盖三模态（D-068）。
32. 作为平台，图片与视频首轮验收原生异步副作用合同至少覆盖 submit/provider task ID/recover-query/poll/download/自有资产持久化/幂等/成本结算；accepted 或 unknown 禁止跨渠道盲目重提（D-038 纯函数内核约束）。**基线校正：Ark 已实现这些稳定 adapter 方法；本轮发布只要求官方主渠道真实执行成功，双渠道 health/drain/late-terminal 与故障域矩阵后续增强**。
33. 作为平台，验收强度（C5 修订）：三核心 operation 各≥一条 `official_direct` 的真实 `live_verified` Deployment；无第二条合格 Deployment 时在用户选择页与后台明确标 `single_channel / no_fallback`。两条独立故障域、`upstream_reseller` 与真实故障注入矩阵只在声称 `multi-channel ready` 或自动回退前强制，不阻塞本轮单渠道发布。
34. 作为运营者，主渠道真实连通、双渠道覆盖、独立故障域、数据等级覆盖与 fallback readiness 在能力页按 operation/CatalogModel 可视；每个核心 operation 至少一个官方 `live_verified` Deployment 即可发布，但少于两条合格 Deployment 时必须标记 `single_channel / no_fallback`，且不得标记 multi-channel ready。

### G. 供应控制中心与 Cloudflare（D-070/D-071/D-052/D-053）

35. 作为运营者，"模型供应与网关控制中心"是能力指挥台的一级核心模块：总览可视化三模态 operation readiness、核心模型双渠道覆盖、六实体关系、Pool/RoutePolicy 生效 revision、数据等级、健康容量余额限额成本、同步 attempt 与异步媒体生命周期、受影响账号任务、最近变更与统一审计；外部网关 Console 只作技术证据深链。
36. 作为运营者，首轮受治理快捷操作：连通与 conformance 探针、候选配置验证、路由模拟、发布/回滚、渠道隔离/恢复、停止接收新任务、排空、凭据轮换与撤销前影响检查、健康余额刷新——全部走 Product Core 类型化命令+capability permission+影响预览+原因+CAS/幂等+可逆排空语义+不可变审计；不暴露密钥原值、不直写库、不绕发布门、不对 accepted/unknown 媒体任务盲目重试。
37. 作为运营者，任务下钻详情与运行表**以上游版式为首选实现参考**（摘要卡+延迟分段+持久化时间戳时间线+错误徽章折叠+产物预览；faceted 筛选+服务端分页排序+URL 状态同步），满足同等信息完整性与状态保持合同即可，具体组件形态非拍板边界（D-070 上游对照为"可参照"非强制）。
38. 作为平台，控制面组合锁定 D-071 **逐组件矩阵**：自有 Product Core 唯一真相 + TanStack/shadcn 原生承载；Bifrost=隔离 PoC（固定 Deployment/零跨 Deployment retry/**关闭内容日志**/可删除）；Higress=**条件性 PoC，前提=项目另行明确接受外部 Kubernetes 运行面**，且须同时覆盖三模态；LiteLLM=仅 Provider 适配与价格目录对照；APISIX/Envoy AI Gateway/Kong/Portkey/Helicone=维持研究包 Reference/Deferred/Reject 边界；New API/Sub2API=仅技术指纹与交互参考，不部署不二开；Refine/React-admin/Directus/Appsmith/ToolJet=不替代管理壳；OpenMeter/OpenFGA/OpenBao/Infisical=触发条件成立再评估，**Casbin 同此档**；**OPA/Cedar 的结构化 decision/reason-code 合同已作 P0 设计借鉴，仅独立运行时依赖延期**；**P0 保留现有双侧账本、类型化权限/策略与 SecretStore/AWS Secrets Manager**。任何 PoC 不缩减三模态范围、不接管路由/接受态/媒体恢复/账本。
39. 作为运营者，Cloudflare v1=服务端最小权限只读 token，**三层真相边界（D-052）**：原生深诊断留 Cloudflare Dashboard/Wrangler（logs/traces 深链下钻）；产品后台只投影只读状态——**保留 D-053 已拍板的只读 REST：Workers 部署/版本与已启用资源盘点**（adapter 带 query/normalize/cache/freshness/unknown 合同与最小权限清单测试），仅 GraphQL analytics 趋势 broker 延期（D-080 C3）；deep-link 携带脱敏时间范围/script-deployment/correlation/能力上下文；自有健康探针补功能状态。读取失败/采样/保留期/限流显式显示未知/过期不伪装实时；现有 100% 采样与 Hyperdrive 占位 ID 以"配置风险/未就绪"呈现；不展示虚构 Cloudflare Queue；**不复制 raw Dashboard 指标，翻译成业务影响**；写权限零持有（发布/回滚/DNS/WAF/Secret/R2 策略/账单全不做）。

## Implementation Decisions

1. **真相与承载**：Product Core 为供应链全部实体/路由/账本/审计唯一真相（D-071）；管理面由现有 TanStack/shadcn 壳原生承载，不建第二控制台/第二管理运行时（D-048）；现有七路由页复用为下钻（健康=audit 页内区块口径；`p1.tsx` 为兼容 redirect 非第八页）。
2. **capability registry 合同**（新缝①）：类型化 capability id/分组/**用途**/owner/状态语义/**配置 revision 与生效范围**/证据新鲜度/**运行事实摘要**/受影响范围/依赖引用/**最近变更与审计证据引用**/**allowedSafeActions 与技术移交 envelope**/下钻入口（D-051 六问全承载）；状态自报（OperationalMetric known|unknown envelope 提升到 contracts），依赖=静态查找表；**命名消歧**：与既有模型 operation 级 `CapabilityRevision`（供应 catalog）和授权用 `productCapabilities` 是三个不同概念，用不同类型名+显式引用，禁止复制；异常投影=root-cause key 去重+严重度排序，组合 pending-actions 投影（#94 ActionableInboxItem 为消费源，**异常首页阻塞该合同落地**，且 pending-actions 须解除 harness runtime 条件装配成为无条件平台服务——由 #94/Z2-WIRING 承担）+各域 OperationalMetric；无 incident 持久化实体。
3. **供应 registry 与热装配**（新缝②）：ProviderProfile/SupplyContract/CredentialAccount 元数据/ExecutionChannel/Deployment 为版本化 registry（**从既有 CatalogRevision payload expand/migrate**，保留 revision ID 与历史读取）；服务端 secret broker 按冻结版本装配凭据；HTTP/Worker 共读 effective revision（**缺口=凭据/adapter runtime capability 动态化；catalog 头热读已有，验收分别测两者**）；**RouteSnapshot 规范化=S2b 独立迁移票**（独占 `foundation/domain.ts`、两个 ledger bridge、`integrations/contracts.ts` 及 persistence tests，先冻结规范 schema+兼容适配器，G/H/I 只消费）。
4. **能力权限合同**（演进既有缝③）：S2 把 `productCapabilities`/`requiredP1Capability` 无行为迁出到 `packages/contracts/src/capability-permission.ts`（冻结的 `uiux.ts` 兼容 re-export）；WT-K 扩展 key 注册表+默认拒绝+审计投影，**唯一 enforcement 修改点=`apps/core/src/server.ts` 集中授权**；不碰 operations 五件套、不向各 FoundationModule 塞声明；内部调用强制走 `P1ApplicationService` 统一 authorizer port（Z2-WIRING 装配）；本合同跨包共用（#83 的 `publication.handoff` 为同一注册表消费者，注册方=本包、消费方=#83，两包 contracts 各写一句）。
5. **健康 overlay 参数**：以带出处的配置常量落地（LiteLLM `cooldown_time`/`allowed_fails`、Envoy outlier detection 默认）；**常量文件注明来源 URL 与所抄默认值对应的上游版本＝implementation convention（工程加码，非 D-080 原文），不引入 LiteLLM/Envoy runtime 依赖**；校准走发布门流程；S2 抽 HealthOverlayPort，三处既有 cooldown map 迁移/删除。
6. **账本与计费接缝（属主终局）**：**GrantLot 保名**=额度来源/FIFO 子系统（到期优先+独立幂等键硬要求）；**ProductUsage（预占/结算）类型与 schema 演进唯一属主=#92 WT-B**，本包 WT-H 只消费合同并新增 CredentialAccountVersion/supplier task id/RouteSnapshot 引用等供应侧字段；**ProviderCost 演进既有 `appendProviderCost` append-only 链**；供应侧价格对象命名 `SupplierPriceRevision/PricingEvidence`（不用 QuotePolicy——该词属产品报价域，ProductQuoteSnapshot/产品 QuotePolicy 唯一属主=`product-quote` contracts/#92）；`model-supply/foundation-ledger.ts` 双侧桥接=Z2-WIRING 独占。
7. **媒体异步合同**：MP-04I/MP-04V 的 lifecycle conformance 以现有 Ark/Tuzi/TTS 适配器为基础（**已有 submit/recover/poll/download/cancel+usage/cost，只补 health/drain/跨进程持久化 recover/late-terminal 对账**）；**VideoWorkflow 降级为派生只读模型是 #102（WT-E）显式立项的实质重构（真相迁往 canonical 对象、保留崩溃恢复幂等），本包视频切片只消费派生化后的 canonical 形态，MP-04V 排 E1 之后**。
8. **与 S1 冻结协同 + 接线属主**：S1（#87）共享冻结清单对本包生效；本包新增模块目录不触碰 operations 五件套与两大前端容器；`model-supply/index.ts` 按 **S2a 无行为抽取**处理（`supply-contracts.ts`/`route-contracts.ts`/`provider-lifecycle.ts`/`ledger-contracts.ts`/`route-planning.ts`，旧 import 经 re-export 兼容；**`:3053-4780` 视频段与 `composed-video-workflow*` 只归 WT-E**）；**核心进程接线（`main.ts`/`job-worker.ts`/`runtime-assembly.ts`/`runtime-config.ts`/模块注册/DB migration 注册）=Z2-WIRING 唯一属主，G/H/I 只交付 domain+ports 不接线**；前端共享接线面（`lib/routes.ts`/sidebar 配置与布局/locale messages/`routeTree.gen.ts` 仅生成）已增补进 #83 handoff 共享冻结清单（跨包双向确认见该文档「跨包接缝增补」节），归 Z2-WIRING（前端批）经**跨包同一整合属主**合入，J 各票只交付业务文件+接线 diff 说明；对 S1 冻结文件（`uiux.ts`/`index.ts`）的兼容迁出仅由该同一整合属主在 S2a 执行。**`model-supply/foundation-ledger.ts` 分阶段唯一属主**：S2b 期间独占其快照转换段，S2b 合入后属主移交 Z2-WIRING（双侧账本桥接段），两票不并行改同文件。
9. **Cloudflare adapter v1**：只读 token 服务端持有；三件套=deep-link 构造器+自有探针+**只读 REST 部署/版本/资源盘点**（query/normalize/cache/freshness/unknown 合同+最小权限清单测试）；GraphQL analytics broker 延期；无写、无 Queue 虚构；未来任何写动作逐项独立决策不由本 spec 授权。
10. **诚实纪律**：缺数据=not_instrumented/not_verified+接入任务；recorded≠生产事实；估算成本带风险折扣与流量上限；stale 显式；单通道标 no-fallback；unknown 成本不伪装零。
11. **MP-01~MP-08 → 本包分包映射**（D-067 稳定模块划分继续有效，防止误读 superseded）：

| MP 模块 | 承载票域 | 说明 |
|---|---|---|
| MP-01 动态供应实体/迁移 | S2a+S2b+G1 | 实体合同抽取、RouteSnapshot 规范化、registry expand/migrate |
| MP-02 通用凭据与 secret broker | G2 | CredentialAccount 特化+请求期 broker |
| MP-03 HTTP/Worker 版本化热装配 | G3+Z2-WIRING | domain 归 G，进程接线归 Z2-WIRING |
| MP-04 adapter conformance | I1/I2/I3（T/I/V） | MP-04V 阻塞 #102 E1 |
| MP-05 SupplyPool/RoutePolicy 发布 | G4+H2 | RoutePolicy/overlay 归 G，Pool 归 H |
| MP-06 套餐与 AccountAllocation | H1 | 扩展既有 ProductEntitlementPolicy |
| MP-07 任务审计与双侧账本 | H2+Z2-WIRING（桥接）+J4（呈现） | ProductUsage 属 #92，本包只消费 |
| MP-08 端到端/故障注入验收 | I4+Z2-ACCEPT | C5 三模态官方主渠道真实连通门；双渠道矩阵为非阻塞增强 |

> 注：本表只映射 D-067 的 MP-01~08 供应模块。G5（数据政策/排序，D-064/D-065）、K1（能力权限，D-057）与 J1-J6（AP 管理台，D-048~D-056）属 AP 域与其他决策，不在 MP 编号内，归属见分包节。

## Testing Decisions

- **好测试定义**：同 #83 包——只测外部行为与合同，durable 载体不被测试 import（D-038）。
- **接缝（全部沿既有形态，先例已按代码现实校正）**：
  1. **HTTP 命令+合同测试**（先例 `operations/http.test.ts`）：供应实体 CRUD/发布/隔离/排空/恢复/轮换命令的权限、影响预览、CAS/幂等、审计字段断言；默认拒绝未知权限的负向断言。
  2. **发布聚合合同测试**（先例=**model-supply `foundation-module.test.ts`** 的 lifecycle/publish/rollback/CAS；admin-config 仅作 CAS/审计/回滚小先例）：RoutePolicy/Deployment/EntitlementPolicy 的 candidate→approve→publish→rollback、并发冲突、影响预览。
  3. **纯投影单测 + characterization**：capability status projection（known|unknown/去重/排序）、**D-051 六问逐能力 completeness 测试（inventory fixture）**、异常列表投影、EffectiveEntitlement 计算与优先级、路由硬过滤+排序分层（**先对 `planModelSupplyCandidates` 加 characterization tests 再改**）、健康 overlay 状态机、**RouteSnapshot 字段级序列化+回放**、**多产品账号绕限额负向测试**。
  4. **官方主渠道真机连通**（形态=`live-*.integration.test.ts` + env 显式开闸，**仓库无 `*.live.test.ts` 命名**）：文案、图片、视频各执行一次真实官方 Adapter 调用；文本取得有效输出，媒体完成 submit/recover/poll/download 并保存结果 hash、任务、费用和 run nonce。双渠道故障注入矩阵继续保留，但不阻塞本轮发布。**CI：`core-persistence` 是持久化门不承担供应商真机；供应商 live gate 另建受保护、手动/定时、带 secret 与成本上限的独立 workflow**。
  5. **前端**：admin console 页面沿现状 node:test 纯模型+SSR markup+memory-router（**当前无 RTL**）；#86 落地后补 RTL 交互；运行表/时间线组件模型单测；Playwright e2e 走真实四服务覆盖异常首页→下钻→快捷动作→审计闭环。**D-048 交互禁令入 e2e 验收：运营主路径零 code/SQL/env/raw JSON/CLI**。
- **迁移兼容测试**：D-044 verified-workspace provisioning 默认供给在新 registry 下成立；三固定槽迁移分别断言元数据与 runtime binding（douyin 现状 not_wired 显式）。
- **验收口径**：能力骨架完成=capability inventory 所列能力全部有真实状态或显式缺口+六问合同完整+有下钻+异常可聚合（D-056）；供应首轮完成=三模态主链共同通过+三核心官方主渠道各有一个当前 `live_verified` 真实生成证据（D-068/D-069 修订）；两者为同一增量整体验收（D-080 C3）。

## Out of Scope（本 spec 明确不做）

- incident 持久化实体、负责人/确认/指派工作流、通知渠道/SLA/值班（D-080 C1；触发=第二运营角色或 D-040 运营重启）。
- 图级严重度传播/合成引擎、可编辑依赖画布（D-080 C2；React Flow 只在表格诊断失效时触发只读 spike）。
- Cloudflare GraphQL analytics broker（CF-02/03）与一切 Cloudflare 写操作（D-080 C3/D-053；**只读 REST 盘点保留在 scope 内**）。
- 凭据六态完整机（D-080 C4 收窄）；自定义角色编辑器/RBAC UI/审批流/双人复核（D-057 延期）。
- 自动充值、全供应商账单适配、在线自学习调权、自建或托管 New API/Sub2API（D-067）；音频模态供应闭环（D-068 后续独立；**能力目录存根保留**）。
- Bifrost/Higress 生产依赖（仅按 D-071 story 38 逐组件矩阵边界 PoC）；触发式候选组件的提前引入。
- impersonation/支持会话（D-049 合同未拍板）；门店/工作区管理与工作区一级导航（D-050/D-051）。
- ProductUsage 预占/结算合同与 ProductQuoteSnapshot/产品 QuotePolicy（#92 属主）、ActionableInboxItem 收件箱（#94 属主）、VideoWorkflow 派生化实质重构（#102 属主）——本包消费不重建。
- 具体套餐价格/额度数值（商业配置）；运营指标看板（D-040）。

## 分包与 Worktree 划分（拆票打包形式）

沿 #83 包模式；S1（#87）冻结清单继续生效，跨包接口一律 contracts。**属主文件清单权威=`.scratch/admin-supply-spec-review-2026-07-20/lane2-reality.md` §属主文件清单建议（handoff 逐字收编）**。

- **S2a 合同抽取（前置，整合属主执行）**：contracts 新建 `capability-registry.ts`/`supply-registry.ts`/`capability-permission.ts`（后者=从冻结 `uiux.ts` 无行为迁出+兼容 re-export）；`model-supply/index.ts` 无行为抽出 `supply-contracts`/`route-contracts`/`provider-lifecycle`/`ledger-contracts`/`route-planning`（re-export 兼容，**不搬视频段**）；OperationalMetric envelope 提升；HealthOverlayPort 抽出；capability inventory 落盘。阻塞：#87。
- **S2b RouteSnapshot 规范化迁移**：四形收敛为单一权威类型+兼容适配器；独占 `foundation/domain.ts`、`model-supply/foundation-ledger.ts`（仅快照转换段，合入后该文件属主移交 Z2-WIRING）、`integrations/contracts.ts`、`integrations/foundation-byok-ledger.ts` 及对应 tests。阻塞：S2a。
- **WT-G 供应核心（core 新模块 `p1/supply-registry/**` + S2 合入后独占 `catalog.ts` 等）**：G1 registry expand/migrate（含三固定槽→CredentialAccount 迁移+D-044 兼容）；G2 CredentialAccount 特化+secret broker；G3 凭据/adapter capability 热装配（domain+ports，接线归 Z2-WIRING）；G4 RoutePolicy 发布+持久化健康 overlay（C6 常量+三处 cooldown map 迁移）；G5 DataPolicyRevision 硬过滤+三层排序（characterization 先行）。不碰 `main.ts`/`job-worker.ts`/`runtime-assembly.ts`/`runtime-config.ts`/视频文件。
- **WT-H 权益与池（core 新模块 `p1/entitlement-pools/**` + 独占扩展既有 entitlement 文件）**：H1 EntitlementPolicy 扩展+AccountAllocation+EffectiveEntitlement 预览；H2 SupplyPool shared/dedicated+供应侧公平排队+三层容量+供应侧账本字段（消费 #92 合同；GrantLot 窄扩展；桥接归 Z2-WIRING；Graphile transport conformance 子票条件触发）。
- **WT-I 三模态 conformance（adapters 域独占：ark/tuzi/volcengine 系列+activation-probe+live-* tests+新 `provider-conformance/**`）**：I1 MP-04T；I2 MP-04I；I3 MP-04V；I4 先以三模态官方主渠道真实连通形成 release gate，MP-08 双渠道故障注入矩阵保留为非阻塞增强。`adapters.ts` 先按 provider 抽小文件再改。
- **WT-K 权限合同（core 新模块 `p1/capability-permission/**`；本线仅 K1 一票，编号为跨线统一风格非多子票暗示）**：key 注册表+默认拒绝+审计投影；enforcement 只改 `server.ts` 集中授权点与其 contract tests；authorizer port 内部强制由 Z2-WIRING 装配。
- **WT-J 管理台前端（admin 域，业务 glob 与 #83 WT-C/WT-D 零交集；共享接线面归唯一前端整合属主）**：J1 capability registry 骨架+状态投影+manifest 存根；J2 `/admin` 异常首页（**阻塞 #94** ActionableInboxItem+pending-actions 无条件化）；J3 能力目录+七页编组+运营语言；J4 供应控制中心（总览/运行表/任务下钻）；J5 凭据 UI+路由模拟器+受治理快捷动作；J6 Cloudflare 只读呈现（deep-link+探针+只读 REST 盘点）。
- **Z2-WIRING 接线（唯一整合属主，内部分批各落独立 PR）**：**批A core**=`main.ts`/`job-worker.ts`/`runtime-assembly.ts`/`runtime-config.ts`/模块与 migration 注册/HTTP-Worker effective revision 一致性测试/`foundation-ledger.ts` 双侧桥接（S2b 合入后接管该文件）/pending-actions 无条件装配/authorizer port 装配；**批B 前端**=`lib/routes.ts`/sidebar/locales/routeTree 生成（跨包冻结增补见 #83 handoff「跨包接缝增补」节，经跨包同一整合属主合入）。
- **Z2-ACCEPT 同一增量验收**：能力骨架完成合同（inventory 全覆盖+六问 completeness）+三模态官方主渠道真实连通门+发布门阻止不足两渠道标 multi-channel ready+single-channel/no-fallback 标示检查。

依赖边（按代码现实修订）：

```
#87/S1 → S2a → S2b ∥ K1 ∥ H1
S2a+S2b → G1 → G2/G4 → G3/G5
S2a → I1/I2 合同侧先行；I 运行时接入等 G3+Z2-WIRING
H2 ← H1+G1；H2 结算字段 ← #92(B2)+S2b
J1 ← S2a+K1；J2 ← J1+#94；J3 ← J1；J4 ← J1+G1+G4+H1；J5 ← J4+G2+G3+K1；J6 ← J1
I3 ← I2+#102(E1)；I4 ← I1+I2+I3+G4+Z2-WIRING(批A，运行时装配就绪)
Z2-WIRING ← G3/H2/K1 domain 就绪；Z2-ACCEPT ← 全部
```

合并顺序：S2a → S2b/K1/H1 → G1→G2/G4→G3/G5 ∥ J1-J3 ∥ I1/I2(合同) → Z2-WIRING → J4-J6/I3 → I4 → Z2-ACCEPT。共 22 票（含 2 张 S2、2 张 Z2）。每线 handoff 并入 `docs/handoff/`；与 #83 包并行开发时冻结清单与唯一整合属主共用。

## Further Notes

- **同一增量纪律**：AP 骨架与 MP 纵向合并验收（D-080 C3），拆票虽分线，宣称完成必须两者同过——能力骨架完成合同 + 三模态官方主渠道真实连通门缺一不可。双渠道矩阵不再阻塞本轮完成声明。
- **第二真相高危点**：异常首页 vs pending-actions 收件箱（组合消费不复制）；`SupplierPriceRevision` vs #92 产品报价（分侧属主，名字都不共用）；capability status vs 各域已有健康区块（registry 引用不复制）；GrantLot vs ProductUsage vs ProviderCost（三条账本链各自语义与写路径，永不合并、不共改文件）；三个"capability"概念（运维能力状态/授权 permission/模型 operation revision）类型名互斥；外部网关 Console vs 控制中心（深链不镜像）。
- **"看似配置实为重构"坑位（显式立项票）**：三固定凭据槽→动态 registry（触运行时装配链）、RouteSnapshot 四形规范化（S2b 独立迁移）、`model-supply/index.ts` 无行为抽取（S2a，4828 行巨型文件）、pending-actions 无条件化（Z2-WIRING）。
- **上游对照可抄件**（详见 xref 报告）：任务详情版式/faceted 运行表/StatCard/中间件双态/Better Auth 原语/ModelConfig 字段形状起点/submit+poll port 骨架——均为**首选实现参考非强制合同**；反面教训（FIFO 过期浪费/授予无独立幂等键/装饰性隐藏/零契约测试）已写入对应票硬要求。
