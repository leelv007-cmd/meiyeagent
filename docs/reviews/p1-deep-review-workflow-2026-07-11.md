# P1 深度复核 — Workflow 原始发现汇编 (2026-07-11)

> 方法：5 个 Opus 4.8 维度评审（架构/P0对齐/组件选型/AI原生趋势/代码现状）→ 每条 P0/P1 finding 经对抗性验证（P0 双 lens：可行性+必要性；P1 单 lens：可行性）。REFUTED=被验证者推翻，WEAKENED=方向成立但需修正，CONFIRMED=完全成立。

> 注意：F4 (Gate 0 owner) 的验证 agent 因 API 错误失败，其 WEAKENED 为默认值，实际未经验证。

## 一、五维度总体评价

### architecture

P1 的核心方向（Product Core Application Service 作为统一 seam + Ports/Adapters + fake-first/contract-test 双跑 + Postgres durable jobs + 证据门控升级）整体是成熟、克制、可落地的，路线本身没有方向性错误，也与"重业务事实自持、轻框架"的当前最佳实践一致。但在"如何拆、先建什么、买还是建"三个层面存在四类返工风险：模型供应半区选择了"先自建路由/逐模型 Adapter、最后才评估网关"的倒序，与 AI 原生生态已收敛的统一网关方案背道而驰；票 01 把 8 个 Port 一次建齐属于伪装成 tracer-bullet 的水平地基，违反 spec 自己的垂直切片原则；票 08/09/32 粒度过大且 08→09 形成串行漏斗扼杀并行；两条对照 PoC（Graphile、LiteLLM）在无瓶颈证据时前置，违背 spec 自己的证据门控原则。方法论（fake vs Postgres 双跑）成熟，仅需明确 Postgres-only 不变量必须强测。

### p0-alignment

P1 spec 对 P0 的"结构性锁定"继承得相当忠实：单 Node 服务 + 单托管 PG、AI SDK 起步 + Mastra 推迟 + Runtime Port、五层买建边界、L1+L3 发布、pg-boss durable jobs、BYOK 都被保留甚至加固，方向本身成熟且符合 AI 原生趋势。偏离集中在四处且多数缺 ADR 记录：一是 P0 定稿锁定的"先验证后建设/里程碑制"被在 n=0 真实商户证据下的 2-3 倍范围扩张悄悄推翻，且 P1 把"功能完成"明确与商户价值脱钩；二是 ADR-0005 三条护栏中的"顾客 PII/人脸不出海"与"国产模型第一天进评测保平移"被海外模型扩张架空，P1 spec 全文无数据驻留字样；三是 ADR-0008/P0 §7 锁定的视频成片多步流水线（AIDA 分镜确认→真素材首帧→N→1 择优→ffmpeg 薄合成）在 32 张票里无归属票，14-17 仅是供应商 adapter；四是 Gate 0 与法务终审被声明式推迟却无 owner/触发点，"功能完成"存在假绿风险。根因判断上：基础设施根因（单行 JSONB/无 durable job）诊断准确且被 01-08 有效解决，但 24 张功能/模型/连接票有重演用户已记录的"重写+堆功能替代验证"反模式之虞。

### components

整体选型偏成熟、克制，几处买建边界拍得很对：pg-boss（票05）对单 Node+托管 PG 是稳妥主选、Graphile Worker 做对照候选、Inngest/BullMQ 证据触发（spec §11），无需改；飞书走"官方远程 MCP + @ai-sdk/mcp"（spec §8）而非自写 SDK，是真正 AI 原生且优雅的接法；Secret 用"成熟 KMS + 不自写加密 + Nango 只做 OAuth PoC"（票18）方向正确。主要问题集中在模型执行的买建边界：票10-17 自写 7 个 adapter + 票20 只把网关降级为不载生产流量的隔离 PoC，对 6 个异步图像/视频模型（其难点=submit→poll/webhook→asset→cost 生命周期，票08/09 已在自建）几乎没有借用媒体网关；另有一处 web 外壳"双 AI SDK"未收敛的冲突，和票31 中文 FTS 在托管 PG 上的分词坑。

### ai-native-trends

P1 的大方向在 2026 AI-native 语境下是成熟且正确的：AI SDK 起步、Runtime Port/ProviderExecutionPort 隔离、durable jobs、对话式外壳+结构化内核的 agent 工作台，全部踩在主流趋势上。核心问题不是方向错，而是"低估了你已 pin 的 AI SDK v7"：媒体模型层（7 张 per-model adapter 票）和编排/持久层（自建 ~400 行 step-runner + 仅 pg-boss）都在重造 AI SDK v6/v7 已标准化的能力（generateImage/experimental_generateVideo provider spec、@ai-sdk/workflow 可恢复 agent）。其次，Bifrost 自托管网关 PoC 既错配旗舰媒体路径又违反你自己的证据门。MCP 与 UI 范式方向对，各差一层 2026 生产最佳实践（工具 schema vendoring、generative UI 内联）。建议开工前做 1-2 个 spike，把 buy/build 边界对着当前 AI SDK 重新校准，避免用多张票追模型 API 漂移。

### code-reality

P0 代码不是低质原型：它是一套严谨、测试充分（product-service.test.ts 977 行）的领域状态机，覆盖门店/素材/合规/文案/分镜/视频/发布/额度/审计约 45 条命令，广度可观，最高 seam（typed ProductCommand + execute）与 P1 §159 完全吻合，值得保留扩展。但它是一个 headless 后端 god-object，与 P1 假设存在三处实质性错配：(1) 生产文案路径 generate_copy 接的是 DeterministicCopyProvider 模板桩，真正的 AI（AiSdkDiagnosticRuntime，Vercel AI SDK）孤立在 /v1/diagnostics 原型里——P0 商户从未拿到真 AI 生成的文案，这是"效果不好"最可能的根因，而 32 张票里没有一张认领"文案生成质量"；(2) 整份 ProductState 以单行 JSONB 存取、每条命令复制进幂等表、且 copy 的 provider 调用发生在 advisory lock 事务内（违反 P1 自己的 US85），迁移票 01/02/03/06 把它写成"事实迁表"，低估了底座重写与查询投影的工作量；(3) usageEvents、视频 lease 状态机、CopyProvider/AiSdkDiagnosticRuntime 三处已是 P1 目标形态的正确种子，但票 04/08/10 读起来像 greenfield，有被饱和重写误删的风险。方向本身成立，主要风险是 ~14 张模型票在解决"选哪个模型"，而真正决定内容质量的 prompt/知识/grounding 杠杆无人认领。


## 二、经验证的 P0/P1 发现

### [REFUTED] ARCH-01 (P0, architecture) — 模型供应半区'先自建路由+逐模型 Adapter、网关最后评估'属倒序，与 AI 原生统一网关趋势相悖

**详情：** 整个模型/媒体半区（约 14 张票）采用了倒序：先在票 09 自建 RouteSnapshot 的 safe-only 重试/等价回退/跨模型 Auto 执行逻辑，再用票 11-17 逐个手写 GPT Image 2、Nano Banana 2/Pro、Seedream 5.0 Pro、Seedance 2.0、Kling、Grok、Veo 共 7 个模型 Adapter，最后才在票 20 评估 Bifrost/LiteLLM 这个本可替代它们的执行网关（票 20 Blocked by 09，且是票 32 的近末端 blocker）。这是把'可能被替换的东西放最后评估'——先造完 7 个 Adapter 和一层路由，再来看网关是否本该免费提供它们，一旦采用网关就是返工。而 AI 原生生态恰恰已把'统一目录+路由+回退+成本核算+BYOK 虚拟 Key'收敛进 LiteLLM/OpenRouter/AI SDK provider registry；spec 点名的模型多为未发布版本（Nano Banana 2、Seedance 2.0、Veo latest），月度级别的模型更替下，一模型一 Adapter 一张票是维护跑步机。注意：产品自持 CatalogModel + 不可变 RouteSnapshot + 双账 Ledger 用于计费审计是正当护城河，应保留；问题只在于把'执行级重试/回退/跨模型选择'也自建，反而制造了票 09 自己第 5 条所担忧的'多 retry owner'问题。

**原建议：** 在 docs/specs/beauty-content-agent-p1-spec.md §8 与 MAP：(1) 把网关决策 spike 前移到票 07 之前或并行，先定'网关拥有执行级路由/回退/重试，产品只拥有 RouteSnapshot 决策快照 + 成本 Ledger'；(2) 将票 11-17 从'7 个手写 Adapter'降级为'目录/config 条目 + recorded contract 测试'，模型执行统一走网关，新增模型=配置而非新票；(3) 重估票 20 的 Bifrost 主选：验证期若要自持，LiteLLM 在'目录+虚拟 Key BYOK+Postgres 花费账'上比 Go 系新秀 Bifrost 更成熟；若追求验证速度可直接用 OpenRouter 托管（国内落地期的域内路由问题按 ADR-0005 本就后置）。

**证据：** docs/specs/beauty-content-agent-p1-spec.md:261 (Bifrost 主/LiteLLM 对照 must-have)、:78-79 (逐个点名未发布模型)；issues/09 第5条'SDK、Gateway 和 Product 只有一个 retry owner'；issues/20 Blocked by 09 且 issues/32 Blocked by 20；issues/11-17 每票一模型 Adapter

**替代方案：** LiteLLM（自持，1000+ 模型/虚拟Key BYOK/预算/Postgres spend-ledger，最贴合本产品治理+计费需求）；OpenRouter（托管，验证期零运维即得多模型+BYOK+credits）；Vercel AI SDK provider registry（已在 ADR-0007 采用，可直接承担多 provider 归一，免手写 Adapter）。三者任一都能把 11-17 从'写代码'降为'配置'。

#### 验证意见 [REFUTED]

核实源文件后，finding 在多个承重论点上存在硬伤，其推荐的修复要么不可行、要么已经完成。

一、证据真实但关键处被误读。
- spec:261/:381「Bifrost 主、LiteLLM 对照的隔离 PoC 是 must-have」属实；:78-79 点名 7 个模型属实——但这是「进入完整目录」的 catalog-inclusion user story，不是「一模型一手写 live adapter」的实现指令。
- issues/11-17 确有 per-model 票，但被误读为「7 个手写 live adapter」。逐票核对：每张的验收都是 recorded contract + CatalogModel/capability/price/lifecycle revision + 未激活 Deployment 不可提交、真实 Key 只更新 activation evidence（如票 11「recorded 模式仍可完成产品验收」、票 14/17「真实 Key 和质量测试只更新 activation evidence」）。这正是 finding 建议 #2 想要的「目录/config + recorded contract 测试」形态——即建议 #2 基本上已是现设计。
- issues/09 第5条「SDK、Gateway 和 Product 只有一个 retry owner」被反读。它是「单一 retry owner」的护栏不变量，且显式把 Gateway 列为候选 owner，恰恰是解决多-owner 问题的设计，而非自建造成的问题。责任矩阵（asset 05 §7、asset 08 §0.1）把执行级 retry/fallback 明确划给 Gateway/Adapter，Product 只持 RouteSnapshot 决策 + 授权候选集，finding 误判了层边界。

二、「倒序/网关最后评估」是对依赖图的误读（结构硬伤）。
- 票 20 与票 11-17 同为票 09 的直接子节点（都 Blocked by 09），是可并行的同辈，而非位于 11-17 下游。MAP 规则按 Blocked-by 决定 frontier，票号 20>17 不代表执行顺序靠后。
- 更关键：网关/聚合的评估 spike 其实是最先做的。团队在 wayfinding 阶段（assets 05/05a/08，2026-07-10，早于 07-11 的 spec 和 tickets）已详尽评测 Vercel/Cloudflare/OpenRouter/fal/Replicate/Portkey/Bifrost/LiteLLM/New API 等。finding 建议 #1「把网关 spike 前移」因此是 moot——早已先做。

三、可行性硬伤（我的 lens）：finding 的核心修复不可行。
- 团队自己的证据直接证伪「三者任一都能把 11-17 从写代码降为配置」：asset 05 §0.2 明确「当前没有一个单项同时包办 LLM 路由、全部指定媒体型号、durable media job、产品目录和账本；单网关全解决不成立」。
- Seedream 5.0 Pro 在 OpenRouter/Vercel/Cloudflare 目录中缺失（只在 fal/Replicate），finding 点名的 OpenRouter 根本无法服务票 13。
- 视频四家（14-17）即便走 fal 也只是 Queue，不是产品可恢复 Job，仍需 Adapter 把上游 task 映射成 GenerationJob/ProviderTaskRef/Asset/双账——这正是 finding 自己要求保留的护城河，故无法纯 config。
- 建议 #3 的 AI SDK provider registry：asset 05 §4.1 实测本地 AI SDK video model「没有把 provider task 暴露成可恢复的产品 job，且 SDK retry 包围整个 doGenerate()」；ADR-0007 只把 AI SDK 用于 LLM 文本路由并置于 ContentWorkflowRunner Runtime Port 之后，它不替代媒体 ProviderExecutionPort。finding 混淆了两个不同的 Port。
- 建议 #3 的 OpenRouter 托管：美业处理顾客人脸素材，ADR-0005 pilot 数据卫生护栏明确「customer PII/face material never goes to overseas model APIs」，境外托管的 OpenRouter 验证期就不能承接人脸图像任务，与既定合规护栏冲突。

四、方向性：finding 攻击的是稻草人。团队实际推荐候选 C（托管聚合 OpenRouter+fal+直连逃生，评分 4.1>B 自托管 3.4），即「用聚合/网关、不自建执行」，Product Core 只持 catalog/RouteSnapshot/双账（finding 认可的护城河），全部 adapter 都在同一 ProviderExecutionPort 后可替换（设计目标即「替换执行面不改 caller/历史」，票 20 明写「证明自托管执行网关可被替换/升级/回滚而不接管 Product Core」）。因此「一旦采用网关就是返工」被设计本身否证——recorded contract 是 Port 级、gateway-agnostic 的。票 20 的 Bifrost 是「默认不承载生产流量」的隔离 PoC，非生产承诺。

五、唯一残余合理点不足以支撑 P0：Bifrost vs LiteLLM 成熟度。团队承认 LiteLLM 治理/spend 更成熟但运维更重，选 Bifrost-first 是基于部署重量/许可证（Go/Apache-2.0）的显式权衡，且 LiteLLM 是同一 PoC 的对照候选（票 20「两个候选使用同一测试集」），两者一起比。这是一个被充分对冲、非生产的 PoC 内部标注偏好，不是 P0 架构缺陷。

综上，finding 在「倒序」「网关最后评估」「任一网关可把 adapter 降为 config」「09 第5条=自建造成多-owner」四个承重论点上均有硬伤，故 REFUTED。

**修正后建议：** P0 应撤销。若保留一条极窄的低优先级备注（非架构级），可为：在 spec §8/§Further Notes 和票 20 中显式点名 asset 08 的候选 C（OpenRouter+fal 托管聚合）为验证期生产默认拓扑，并把「Bifrost 主、LiteLLM 对照」明确限定为「自托管逃生选项的隔离可逆性 PoC、默认不承载生产流量」，以消除 spec §8 措辞（Bifrost 主）与 topology 研究实际推荐（候选 C 托管聚合）之间读者可能感知的张力；同时在 ProviderExecutionPort 处加一行注释说明「gateway 与 direct adapter 实现同一 Port、recorded contract 为 Port 级、切换执行面不触及 11-17 的产品侧 Job/Asset/Ledger 映射」，以书面固化「采用网关非返工」这一既有设计事实。以上均为文档澄清，不涉及票的重排或降级。

#### 验证意见 [REFUTED]

这条 P0 architecture finding 的三个承重论点在实物档案面前都站不住，属硬伤级误读，而非"方向对但夸大"。

一、"倒序/网关最后评估"是事实错误。网关不是在票 20 才第一次被评估：`.scratch/model-supply-wayfinding/issues/05`（已 closed）在**决策阶段**就完成了直连 adapter vs 托管 Gateway vs 聚合 API vs 自托管网关的品类调研，`issues/18`（lock-p1-adoption-boundary）显式拍板"自托管执行网关隔离 PoC 升为 P1 must-have"，并写明"该决定修订'锁定拓扑'中的'触发后才 PoC'，但**不改变 Direct-first、分模态执行域或不串联多 Gateway 的拓扑**"。开源资产 05a §0 更列出三条候选 A(Bifrost)/B(LiteLLM)/C(直连 adapter)，Direct-first 是三选一的**刻意**结果。票 20 是对已定决策的落地 PoC，不是首次评估。

二、依赖图不支持"先造 7 adapter 再看网关"的顺序指控。票 20 `Blocked by 09`，与 11-17 同为票 09 的**下游兄弟、可并行**；20 并不 blocked by 11-17，二者都只 gate 在 09 上。票 32 是终局集成/Beta 证据票，其 blocker 是 06/10/14/15/16/17/19/20/22/23/26/28/30/31 全量 must-have，单挑 20 称"近末端 blocker"是误导。

三、"票 09 自建执行重试→制造多 retry owner"被读反了，且与 finding 自身论点矛盾。09 第 5 条原文是"SDK、Gateway 和 Product 只有**一个** retry owner，媒体或计费副作用默认关闭内层盲重试"——它是**消除**多 owner 的约束，票 20 第 2 条又显式"验证 retry owner"。开源资产 05a §0 第 3 点用证据证明这必须留在 Product："开源网关普遍只能统一供应方自己的异步任务 ID；上游接受任务后不能无条件跨供应方重投，否则可能双扣费、双产物"。而 finding 自己承认"RouteSnapshot+双账 Ledger 是正当护城河应保留"——但要在有媒体副作用的账本上做到计费安全，就**必须**拥有 acceptance-state 追踪与单 retry owner 边界，那正是票 09。finding 一边留护城河一边砍掉护城河的前置条件，且其建议"让网关拥有执行级重试/回退"会重新引入团队专门规避的双扣费风险。

四、"11-17 降为配置+recorded contract"不成立。13/14/17 全是统一异步 job + ProviderTaskRef 恢复 + 自有 Asset TTL + late-success 记账模式；05a 与票 05 均证实 LiteLLM/OpenRouter/AI SDK registry 对文本 LLM 归一强、对媒体（尤其可恢复视频 job）弱，"没有一个开源项目能直接替代所需模型供应系统"。票 18 已显式拒绝"只做目录占位"。且 AI SDK(ADR-0007/spec:258)已在 LLM runtime port 后承担文本归一（票 10），媒体正是它帮不上的地方。ProviderExecutionPort 这条 seam 让 adapter 与网关都在 port 之后、09 在 port 之上：若网关晋升，它成"一个可替换 Adapter 按受控范围"（票18 Conditional#3），直连 adapter 作为参照/回退并复用其 recorded contract 校验网关等价（票20第1条）——这是刻意的去风险，不是返工。

五、建议 3（Bifrost 主改 LiteLLM）优化错了轴。05a 用固定 commit 源码审计选 Bifrost 主，决定性理由是"图片/视频真实适配覆盖最好"；LiteLLM 的成熟点（目录/虚拟 Key BYOK/花费账）恰是团队**刻意留在 Product Core**、不委托给网关的部分，故对薄执行层是次要轴。且两者本就都在票 20 同 port 下实现并出对比报告，"主/对照"标签影响很小。OpenRouter/fal 也已是票 18 Conditional#2 的聚合通道。

necessity 结论：该改动不必要且净负。对验证期、媒体密集、以计费审计为护城河、且点名多为国内未发布媒体模型（ADR-0005 落地后置）的美业 SaaS，遵循原规划更好——它把媒体关键路径压在覆盖已知的直连 adapter 上、由 Product 拥有计费安全、同时用并行非阻塞的 must-have PoC 给网关去风险。finding 属"正确原则已实现、新增建议被团队自有证据否定"，是 REFUTED 而非 WEAKENED。

**修正后建议：** P0 architecture 定级不成立，应撤销该 finding 的核心论点（倒序/返工/多 retry owner/adapter 降配置均与档案相反）。仅两点可作为非 P0 的备注保留：(1) 票 20 交付对比报告时，把"若媒体覆盖打平则 Bifrost 主、否则 LiteLLM 主"的判据显式写入验收，避免"主/对照"标签被误读为已锁死——但这只是既有 PoC 的一条验收细化，不改架构；(2) 在 spec §11 或 Admin 明确"P1 后新增模型 = Catalog 配置 + 一条 recorded fixture（复用 08/09 既有 Job/Attempt/Asset/acceptance 机制），非新建重票"，把 finding 担心的"维护跑步机"以文档形式钉死为已有意图。两点均为文字级澄清，不涉及前移网关决策、下沉 retry 到网关或把媒体 adapter 降为配置。

### [REFUTED] ARCH-02 (P1, architecture) — 票 01 把 8 个 Port 一次建齐，是伪装成 tracer-bullet 的水平地基，违反 spec 自己的垂直切片原则

**详情：** MAP 把票 01 列为唯一 frontier、无 blocker、7 张票直接依赖它；而票 01 的验收第 3 条要求'关系存储、Job、模型执行、Secret、Storage、Search、抖音和 MCP 均有明确 Port'——即在任何垂直切片交付前，一次性定义全部 8 个 Port。这恰是 spec 第 384 行明令禁止的'先建所有表、再建所有后端'的水平层切分，与 tracer-bullet（第一颗子弹应是一条能打穿到用户的最薄端到端切片）相矛盾。真正风险不是 seam 方向错（Application Service 统一 seam 是对的），而是 Secret/Storage/Search/抖音/MCP 这些 Port 的接口形状要到票 27/29/31 各自 Adapter 落地时才知道真实需求，此刻凭空定义必然被返工重塑；同时票 01 是在一个 2168 行单文件 + 单行 JSONB 的现状上做无用户可见产出的大爆炸重构，风险高而反馈慢。对验证期 SaaS 而言，一次建齐 8 Port 属过度抽象。

**原建议：** 把票 01 拆小：只落地'最薄 Application Service seam + 第一批切片真正需要的 Repository/Job/ModelExecution 三个 Port'，并交付一条现有旅程（如 generate_copy）端到端打穿作为真子弹。Secret/Storage/Search/抖音/MCP 的 Port 形状随票 18/02/31/27/29 各自切片'按用例涌现'再定义（ports emerge from use cases），避免提前冻结会变的接口。

**证据：** .scratch/p1-implementation/MAP.md:9 (01 无 blocker 立即开始)；issues/01 验收第3条(8 Port 一次建齐)；docs/specs/beauty-content-agent-p1-spec.md:384 (禁止水平层切分)；apps/core/src/product/product-service.ts 现为 2168 行单文件、postgres-repository.ts 仍单行 product_states JSONB + advisory lock

**替代方案：** none（这是拆票/排序修正，非换组件；参照 hexagonal 的'接口随用例涌现'实践即可）

#### 验证意见 [REFUTED]

证据本身准确（MAP:9、7 个直接依赖 02/03/04/05/07/18/24、issue01 第 3 条确列 8 Port、spec:384 引文无误、product-service.ts 2168 行、postgres-repository 单行 JSONB+advisory lock 均属实），但四条承重的解读逐条被 spec 自身架构章节击穿，核心论点"伪装成 tracer-bullet 的水平地基、违反垂直切片"不成立。

一、把"声明 Port 接口(seam)"错等于 spec:384 禁止的"先建所有后端"。384 禁的是把整系统按"所有表→所有后端→所有前端"横切实现分层。而票 01 不落地 Secret/Storage/Search/抖音/MCP 任何一个 Adapter——这些后端恰恰被拆进各自的垂直切片票：Secret→18、抖音→27、飞书MCP→29、Search→31、Job→05。也就是说"按用例涌现 Adapter"这件事计划里已经在做，finding 要求的垂直切片正是现状。票 01 只做"统一 seam + 保留现有旅程(验收第 1 条:外部行为无回退)"，是 walking-skeleton，不是横切后端。finding 把"接口声明"读成"建后端"，是对 384 适用范围的误读。

二、称 8 Port 是"凭空定义"，但 finding 漏引了 spec §157-162 架构章节:第 161 行明文"供应商、Secret Store、任务组件、对象存储、检索、通知、抖音和飞书位于 Ports/Adapters 外围,可用 fake/recorded/live Adapter 替换"——这 8 个 Port 是 spec 已锁定的六边形外围，票 01 第 3 条是忠实实现该架构，不是票作者越权臆造。

三、最核心的技术断言"Port 形状要到 27/29/31 各自 Adapter 落地才知道、此刻定义必然返工"，与 spec 设计直接矛盾:§256"pg-boss 是主实现、Graphile Worker 是同一 Job Port 后的对照候选"、§261"模型执行通过 ProviderExecutionPort;Bifrost 主、LiteLLM 对照"——同一个 Port 后面挂两个 Adapter 是 spec 明确的 must-have。能一 Port 多 Adapter，恰恰证明 Port 由领域用例驱动、对 Adapter 稳定(六边形 DIP 的定义),而非由 Adapter 反向决定。"必然返工重塑"因此是把依赖方向搞反了。

四、"无用户可见产出的大爆炸重构、反馈慢"被夸大:验收第 1 条要求现有门店/素材/内容/视频/发布包旅程端到端不回退(可验证的 E2E 回归护栏),第 5 条要求 contract tests 在 memory/fake 与 Postgres 间复用(fake 内存跑,反馈快)。而真正的大重构——JSONB→关系表迁移——被 spec §264-268 和票 02/03/06 显式承接;票 01 刻意不动存储模型。所以"2168 行+单行 JSONB"这条证据反而支持"先立稳定 seam 再让 02/03 迁移切片有稳定入口",不是反对票 01。

建议本身要么冗余(Adapter 已按切片涌现),要么反效果:若把 Secret/Storage/Search/抖音/MCP 的 Port seam 也推迟,则 18/27/29/31 每张票都要回头改核心 Application Service 加 Port,把"一个稳定业务入口"(§157-160,7+ 张票的地基)拆成五处核心手术,整合风险更高。

唯一站得住的残留:票 01 是唯一 frontier、依赖收敛的咽喉点,且范围非平凡(seam+8 Port 声明+全旅程保真+contract 复用),其"单上下文完成"的可行性值得盯。但这只是排期观察,救不了 finding 的架构定性,也不支撑"推迟 5 Port"这个修正。综合:承重论点有硬伤,判 REFUTED。

### [WEAKENED] ARCH-03 (P1, architecture) — 票 08/09/32 粒度超出'单上下文完成'，且 08→09 是扼杀并行的串行漏斗

**详情：** MAP 第 13 行规定'一张票必须在单个新上下文内完成并交付端到端行为'，但票 08 一票内要建 GenerationJob+ProviderAttempt+ProviderTaskRef+Asset+Provider Cost Ledger+重复/乱序 callback 恢复+双账结算——是 5 个持久实体加一套恢复语义；票 09 又叠加 RouteSnapshot 不可变+safe-only 两次重试+固定模型等价回退+跨模型 Auto+后台 route simulator。二者都远超单上下文可靠完成的体量。更关键的是依赖图上 08→09 形成硬漏斗：模型/媒体半区几乎所有票（10-20、26）都堵在 09 之后、09 又堵在 08 之后、08 又需 04+05+07，导致清掉 09 之前该半区零并行。票 32 则挂了 14 个 blocker（06/10/14-17/19/20/22/23/26/28/30/31），本质是发布里程碑而非一张可在单上下文完成的票。

**原建议：** 在 issues/ 下拆分：票 08 → '08a Job/Attempt/Asset 可恢复闭环' + '08b Provider Cost 双账 Ledger'；票 09 → '09a RouteSnapshot 冻结与不可变' + '09b safe-only 重试/固定模型等价/Auto 选择语义'。把票 32 改写为'P1 发布证据 checklist / 里程碑门'而非 ticket，其内容作为各切片的 Definition-of-Done 汇总，不作为一个需单上下文完成的工作单元。拆分后 08a/09a 可让下游 Adapter 票提前进入 frontier，缓解串行。

**证据：** .scratch/p1-implementation/MAP.md:13 (单上下文完成规则)；issues/08 与 issues/09 验收清单（各含 5-6 个跨子系统项）；依赖链 08 Blocked by 04+05+07 → 09 Blocked by 08 → 10-20/26 全部 Blocked by 09；issues/32 挂 14 个 blocker

**替代方案：** none（拆票修正）

#### 验证意见 [WEAKENED]

证据大体属实，但解读夸大、核心建议在技术上站不住，且部分违反项目自身明文规则。

一、证据核实。MAP.md:13 原文引用准确;票 08 确实堆了多个持久实体+恢复语义(finding 说 5 个，实为 6 个——它把 08 第 9 行已列出的 RouteSnapshot 漏掉了，反而低估了 08);票 09 六条验收全属实;09 直接 gate 住 9 张 adapter 票(10-17、20)属实;票 32 挂 14 个 blocker 属实。这些数字层面成立。

二、两处误读/夸大。(1)"10-20 都堵在 09 之后"不准:票 18(Secret Store/Connection Core)blocked by 01 而非 09，是独立并行轨，还牵出 18→19、18→27→28、18→29→30 一整条不经过 09 的并行链;finding 用"几乎"打了折但括号枚举失真。(2)"扼杀并行"在项目级为假:08→09 期间 02/03/04/05/07/18/24 均只依赖 01 可并跑，随后 21→22/23、24→25、27→28、29→30、31 全部推进，串行只局限在 adapter 子树。(3)"远超单上下文可靠完成的体量"是从 bullet 数推断的未证断言;08/09 是 fake/recorded-only tracer(spec:154)，确定性强、是自洽的单一垂直切片。

三、建议是硬伤所在。spec:384 明文规定"按 Application Service 用例和可验证垂直切片组织，不按先建所有表再建后端最后做前端的水平层切分"。finding 提的 08a/08b、09a/09b 恰恰是这种被禁止的水平切分:09a(只冻结 RouteSnapshot、无人消费)不交付任何端到端行为，直接违反 MAP:13"须交付可演示端到端行为";且 RouteSnapshot 本就在 08 创建，09 的职责是"副作用前冻结+路由/重试消费"，无法与路由语义分家。08a/08b 则会拆散双账不变式(退款不抹除供应成本，08:13/spec:348)——而这正是该切片要演示的核心行为。所谓"让 adapter 提前进 frontier"的收益是假的:adapter 必须等冻结快照+单一 retry owner 契约(09:13)稳定后才能安全铺开，否则每个 adapter 都要重新处理 retry 归属并返工。08→09 这个 gate 是"先把 Job/Attempt/Asset+RouteSnapshot/retry 契约钉死、再并行铺 8 个 adapter"的刻意且正确的设计(MAP:17、spec:384)。

四、仍有小内核。08/09/32 确是最重的票，票量风险值得关注;票 32 也确实把"整窗迁移执行"和"P1 出口证据汇总"混在一起。因此不判 REFUTED，但方向被夸大、建议需推翻重写，判 WEAKENED。

**修正后建议：** 不要横切 08/09。二者应保留为单一垂直切片:spec:384 明文禁止所提的水平层切分，09a(仅冻结快照、无消费)违反 MAP:13 的端到端可演示规则，08 的双账不变式(退款不抹除供应成本)正是该切片要演示的行为、拆开即失去可演示性。若真担心单上下文超载，正确缓解是把 08/09 严格限定为 fake/recorded-only(不接真实 provider)，把六条验收当作该单一切片的 DoD，而非拆票。

保留 08→09 这个 gate:它是"先钉死 Job/Attempt/Asset+RouteSnapshot/retry 契约，再并行铺 8 个 adapter"的刻意正确设计。adapter 子树的局部串行是稳定契约的必要代价;让 adapter 抢在契约冻结前开工只会返工。真正的并行度不靠拆脊柱获得，而靠把本就独立的多条轨道(18→19、21→22/23、24→25、27→28、29→30、31)与 08→09 并排调度。

票 32 的直觉有部分道理，但不应抹掉执行工作。把 32 拆成:(a)一张真实"cutover 执行"票——迁移 manifest/dry-run/差异报告/冻结/在途任务接管/备份恢复/入口回滚演练，这是货真价实的单上下文工程;(b)一个"P1 出口证据门"——汇总各上游票的 DoD(已激活真实旅程、租户隔离、双账、审计、指标基线、法务后审)。只把纯验证性的汇总项抽出来做里程碑门，保留 (a) 作为可单上下文完成的执行 ticket。

### [WEAKENED] F1 (P0, p0-alignment) — P0 锁定的"先验证后建设/里程碑制"被 n=0 证据下的范围扩张推翻，且缺 ADR 记录、成功标准与商户价值脱钩

**详情：** P0 定稿的核心楔子是"下一步不是全量 build，而是先跑 0-4 周真实付费验证，Go 门槛达成后再进 P0 build"（合集-v1.5 §0 第15行）与"里程碑制，不再承诺全量交付"（第40行），Go 门槛=≥3 家在 ≥399 档付定金。但 P1 在真实商户观测仍为"生活美容 n=0、医美探针 n=0"（.scratch/p1-wayfinding/map.md:22，Go 门槛实际未达）的前提下，直接授权 32 张票的全量 build——其中仅 01-08 共 8 张是修基础设施，09-31 共 24 张是新功能面（开放图文工作台+自建模板+AI 改图、抖音官方 Publish/Observe、飞书 MCP、8 个模型 adapter、BYOK、Bifrost/LiteLLM 网关 PoC），范围是 P0 保 8 的 2-3 倍。更关键的是 CONTEXT.md 把"P1 功能完成"定义为"every must-have implemented + release Gate passes"，并明写"Real merchant counts, retention, time savings, renewal, and margin are optional observations and do not block this state"（CONTEXT.md:20），即把 P0 立项时作为唯一理由的"商户是否得到价值"从完成标准里剔除。这不是修 bug 而是推翻一条锁定决策，却没有任何 ADR 记录该 reversal。若"P0 第一版效果不好"真实含义是商户不觉得有价值（而非只是基础设施烂），则这 24 张功能票不触及根因，正撞上您 MEMORY 已记录的闲鱼"测试循环陷阱：业务真实运行为 0，重写量+验证仪式双过载"与 creator-agent"ship-readiness 假绿"两处反模式。

**原建议：** 在 docs/adr/ 新增一条 ADR（如 0009-p1-build-before-validation）显式记录"为何在 n=0 证据下重开 validate-first 门"的理由与边界，而非默认继承。并把 .scratch/p1-implementation 的执行顺序改为分层门控：先只做 01-08 基础设施修复 + 一条最薄的"档案→文案/视频→L3"真实商户可跑通切片，拿到 ≥2 家真实使用/付费信号后，再逐族解锁 21-31 的功能扩张票（抖音/飞书/图文工作台/网关 PoC 都可延后）。同时修订 CONTEXT.md 的"P1 功能完成"定义，至少把"一条 must-have 旅程有真实商户跑通"设为发布 Gate 的一部分，避免功能全绿=可上线的假绿。

**证据：** 合集-v1.5-P0决策定稿.md:15 与:40（先验证后建设/里程碑制）；.scratch/p1-wayfinding/map.md:22（n=0，Go 门槛未达）；CONTEXT.md:20（功能完成与商户价值脱钩）；docs/specs/beauty-content-agent-p1-spec.md:21（自称"不是增加更多零散功能"但 §Modules 列了图文工作台/模板库/抖音/飞书/模型控制面 6 大新面）；票数：infra 01-08=8 张 vs 09-31=24 张

**替代方案：** 参照您自己已沉淀的范式：闲鱼 ADR-0013"复用优先 + done=staging 真跑通"与 creator-agent"ship-readiness 假绿"教训——把 done 反转为"真实商户端到端跑通"而非"票全绿"。这是流程范式修正，无需引入新组件。

#### 验证意见 [WEAKENED]

证据引用全部核对属实（合集:15/:40、CONTEXT:20、map:22 均逐字命中），n=0 也真实存在。但 finding 的严重度定级、意图刻画、反模式类比与核心建议存在多处夸大和硬伤，够不上 P0，也够不上 CONFIRMED，故判 WEAKENED。

一、事实层面被 finding 遗漏的关键上下文，直接削弱其"n=0 下从零全量 build"叙事：git 已有 `222f14a feat: complete P0 beauty content workflows`，`apps/core/src` 有 4485 行真实产品代码（product-service.ts 2168 行 + 完整测试），p1-spec Problem Statement 明写"商户已经可以生成单条文案…视频成片和人工发布包"。issue 02 澄清 n=0 的口径是"无现存 workspace/membership 的 E2E 清理残留"——即"尚无真实商户被 onboard"，而非"无产品"。所以这不是把未验证概念从零 build，而是在已建成的 P0 之上做运营工作面收敛 + 数据模型硬化（JSONB 单行→关系表、无持久队列→pg-boss、无租户隔离→隔离，这些是任何真实付费 Beta 的硬前置）+ 薄模型 adapter。finding 的"范围是 P0 保 8 的 2-3 倍""24 张新功能面"因此高估：ticket 32 本身就是付费 Beta 证据票，被误记为"功能面"。

二、"缺 ADR、推翻锁定决策却无记录"是最主要的硬伤。该 reversal 是 2026-07-10 反复出现的显式"用户裁决"（issue 03 约 20 条），并同步落到 CONTEXT.md、p1-wayfinding/map、p1-spec 三处。它不是"无记录的意外漂移"，只是没落进 docs/adr/ 的 ADR 文件格式。把一个被充分记录、由产品负责人明确知情拍板、且与其既有偏好（ADR-0005 阶段化 + MEMORY"拒绝 MVP""验证期用最快栈/约束绑定触发点"）一致的决策，描述成"撞上反模式的无记录反转"，是对意图的误刻画，也把严重度抬高了 2 个档位。

三、反模式类比用反了。闲鱼教训是"业务真实运行为 0 + 重写量+验证仪式双过载"，其修正恰是"done=staging 真跑通"且"用户拒绝残缺 MVP→只砍流程仪式不砍范围"。当前 P1 的 done 定义 = 通过"封闭合同制付费 Beta 安全发布 Gate + 每条 must-have 至少一条已激活真实路径"，这更接近闲鱼的"已修正态"而非"陷阱态"；而 finding 的"砍到 01-08+一薄片再逐族解锁"恰恰是闲鱼教训里被用户否决的那半——它只引用了对自己有利的一半。creator-agent"假绿"同理被弱化：CONTEXT.md 明确把"P1 商业验证完成/成效已证明"列入 _Avoid_，即产品自己在诚实声明"功能完成≠已验证"，finding 把这份诚实读成"把价值从标准剔除"。

四、核心建议在可行性上站不住：新增"分层 build 门控"直接违反 issue 03 约 20 条显式裁决（P1 不设功能实施 Gate、坚持完整范围、不因实现困难自动后置）与用户 MEMORY 里反复重申的反-MVP 立场；且其提议的"档案→文案/视频→L3 薄片"在 P0 已建成，而"拿到 2 家真实付费再解锁"所需的租户隔离/凭据/计费留痕/回滚恰恰是它想延后的 infra——建议部分循环、部分已被 ticket 32 满足。

五、仍有一处站得住的可行性内核（故非 REFUTED）：ticket 32（付费 Beta）当前 Blocked by 14-17/20/26/28/30——视频多 adapter、Bifrost/LiteLLM 网关 PoC、抖音 Observe、飞书完整 MCP 全在通往真实商户信号的关键路径上，而这些对一个"最小安全付费 Beta"并非必需。把它们后移到首个付费 cohort 上线后作为"条件启用能力"，能更早拿到商户证据——且这落在 issue 03 自己允许的范围内（"Scope Lock 不锁死交互实现/供应商"、日期随复杂度浮动），无需重开锁定范围或加 build 门。这是 finding 直觉的可行、且不与用户裁决冲突的版本。

**修正后建议：** 保留降级后的可执行内核，剔除与已定用户裁决冲突的部分：

1. 不重开、不加 build 门。build-full-scope + 并行采证 + 仅发布 Gate 是 2026-07-10 约 20 条显式用户裁决，且与用户既有反-MVP 偏好一致；提议"分层门控/先 2 家再解锁"等于要求逆转已闭合的产品负责人决策，不采纳。

2. 承认"假绿"风险已大部分被现有 Gate 缓释：发布 Gate 要求真实封闭合同制付费 Beta，ticket 32 已要求"每条 must-have 至少一条已激活真实路径"。唯一被刻意并行化的是"可度量成效"（留存/省时/续费/边际），这是用户知情选择的观察项而非门槛，无需改动"P1 功能完成"定义。

3. （低成本、可选）在 docs/adr/ 补一条 ADR-0009，把"先验证后建设 → 建成后经封闭付费 Beta 验证"的顺序变更作为用户决策记录在案，引用 issue 03，使该 reversal 在 ADR 规范位置可追溯——定位为补文档而非重开决策。

4. （唯一实质可行性微调，落在 issue 03 允许的浮动范围内、不砍范围不加门）重排实施顺序，让 ticket 32 的封闭付费 Beta 能用"Beta 关键 must-have"先行到达：先做 01-08 基础设施 + 凭据/BYOK 精简 + 任务收件箱/周批次 + 核心文案/视频/L3；把当前 gating ticket 32 的外围扩张族——抖音官方 Publish/Observe(27/28)、飞书完整 MCP(29/30)、完整 7-adapter 集、Bifrost/LiteLLM 网关 PoC(20)——作为"条件启用能力"，在首个付费 cohort 上线后再激活。这样更早拿到真实商户信号，同时不违反任何已锁决策。

#### 验证意见 [WEAKENED]

从 necessity 视角，finding 的 P0 定性与主行动建议（重排 build、加商户信号门控）站不住，但保留一个轻量文档 kernel，故判 WEAKENED 而非 CONFIRMED，也不到 REFUTED 的"全无是处"。

硬伤逐条：
(1) "没有任何 ADR 记录该 reversal / 缺记录"严重误导。.scratch/p1-wayfinding/issues/03-set-p1-stage-gates.md:15-34 是约 20 条 2026-07-10 用户裁决，逐条记录了"P1 准入优先功能实现、真实 pilot/付费证据改为并行采集不阻塞开发/发布"的理由、边界、六项不可豁免发布 Gate、Scope Reopen 机制；CONTEXT.md:16 明写"this authorization does not mean the product or business has been validated";合集 line 7 与 CONTEXT line 5-7 有显式 supersession 头。这是全库记录最密集的决策之一。"没有 ADR 文件"不等于"未记录/暗中推翻"。

(2) 事实错误："里程碑制被推翻"。issue 03:25/46 明确保留里程碑制。finding 把一条被保留的决策列为"被推翻的核心楔子",高估了 reversal 的范围。

(3) 误characterize："商户价值脱钩"。发布路径是封闭合同制付费 Beta（合同/转账凭证收款 + 逐店审批），ticket 32:10-11 要求"每条 must-have 旅程至少一条已激活真实路径"+ 迁移/回滚演练。真正移出阻塞的只有 retention/续费/margin 这类滞后结果指标——发布前物理上无法测得,设为前置会造成 chicken-and-egg 死锁。所以"唯一理由被剔除"不成立;被剔除的只是无法前置测量的那部分。

(4) 反模式被反向引用。P1 计划已内建两条闲鱼/creator-agent 教训的 fix:reuse-first(MAP.md:17"无失败证据不从零重写队列/OAuth/Secret Store/画布/编辑器")+ done=真跑通(ticket 32 已激活真实路径 + 真实付费 Beta,不是"票全绿")。finding 追加的"≥2 家真实信号才解锁功能族"恰是闲鱼"测试循环陷阱=验证仪式过载"警告的东西,方向搞反了。

(5) 建议违背已锁用户裁决。分层门控/只做 01-08+薄切片/后置图文·抖音·飞书,直接违背 issue 03 的多条显式裁决(pilot/付费不阻塞功能实现、坚持完整范围、不因困难自动后置)与 MEMORY 记录的用户一贯"拒绝 MVP 式残缺上线、饱和开发=完整功能落地"偏好;且未经 issue 03 要求的 Scope Reopen 就重开 Scope Lock,越权。

(6) "范围 2-3 倍"夸大。24 张功能票里 11-17 是模型 adapter(P0 保 8 的文案/视频已在用的供给侧管线)、01-08/18/31 是把 P0 原型 JSONB blob 迁成关系表(p1-spec:19 明述技术债)、20 是隔离 PoC;真正新用户面只有 issue 07 界定的 3 个扩展族(图文/抖音/飞书)。按票数把 adapter/迁移/PoC 都算"新功能面"制造了膨胀观感。且已存在 34 个 .ts 真实实现(apps/core),P1 不是从零 build,而是重构+扩展既有原型,finding"直接授权 32 张票全量 build"受古老 P0 Go 门约束的框定是稻草人。

存活 kernel:唯一站得住的是——把"验证顺序 先验证后建设→并行"这条 reversal 沉淀成 docs/adr/ 同级 ADR 确有轻量 traceability 价值(只读 ADR 序列的人找不到它,它现在只活在 .scratch grilling 票+CONTEXT ubiquitous language);"建设先于验证"客观上也是一笔真实商业赌注,不是纯虚构。但这是 P3 级文档卫生 + 用户已知情自担的战略选择,远不足以支撑 P0 severity,更推不出"重排 build/重设门控/把商户获取重新耦合进发布 Gate"。necessity 结论:主建议非必要且部分有害(重开已决问题、加回用户否决的仪式),属"为改而改";只有轻量 ADR 沉淀这一小项值得采纳。

**修正后建议：** 降级为 P3 文档卫生项,只做一件低成本、不重开决策的事:在 docs/adr/ 增一条简短 ADR-0009(如"validate-in-parallel-single-release-gate"),把 2026-07-10 已在 .scratch/p1-wayfinding/issues/03 与 CONTEXT.md 拍板的"P1 不设开发准入 Gate、真实 pilot/付费证据并行采集、以单一封闭付费 Beta 安全发布 Gate 为完成"这条顺序性决策,提升到与合集 P0-定稿同级的记录位置,Status=Accepted,并在正文指回 issue 03 与 CONTEXT 作为权威出处。目的是 traceability(让只读 docs/adr/ 的人也能看到这条对 合集§0"先验证后建设"的显式 supersession),不是重开它。

明确不采纳 finding 的三项主建议:
1) 不重排 p1-implementation 为分层门控、不以"≥2 家真实商户信号"作为解锁 21-31 功能族的前置——这违背 issue 03 的多条显式用户裁决与用户一贯"拒绝 MVP 残缺上线"偏好,且会重新引入闲鱼教训警告的"验证仪式过载",需 Scope Reopen 才有资格提出。
2) 不把"真实商户端到端跑通"新增为发布 Gate——因为 ticket 32:10-11 已要求"每条 must-have 旅程至少一条已激活真实路径"+ 真实付费 Beta,done≠票全绿这一点已落地,假绿风险已在 Gate 层被覆盖;再叠加"真实商户获取"会把用户已显式解耦的滞后指标重新前置。
3) 承认"建设先于验证"是用户知情自担的战略赌注(CONTEXT.md:16 已自陈"不代表产品/商业已验证"),ADR-0009 可在 Consequences 里如实记一句该赌注的风险敞口即可,无需据此改变 build 顺序或范围。

### [WEAKENED] F2 (P0, p0-alignment) — ADR-0005 的"顾客 PII/人脸不出海"+"国产模型第一天进评测保平移"两条护栏在 P1 被海外模型扩张架空，且 P1 spec 全文无数据驻留字样

**详情：** ADR-0005 明确"验证期 CF-first + 混用模型"之所以可接受，是靠三条轻护栏，其中第 2 条="customer PII/face material never goes to overseas model APIs（domestic models or redaction）"（0005:13），第 4 条="Domestic models enter the eval benchmark immediately as migration-parity targets（avoids a quality cliff on migration day）"（0005:16）。P0 spec 把它落成硬约束（§16:284"顾客 PII 和人脸只路由国产模型或先脱敏"）并有独立验收旅程（§Testing:340"Data hygiene journey：验证顾客 PII、人脸和医疗健康素材不会发送到海外 provider"）。但 P1 spec 全文 grep 无 PII/人脸/海外/overseas/区域/residency/出境 任何一条（仅 194/326 是审计与 secret 脱敏，与此无关），而 P1 恰恰把海量海外图像/视频模型放进用户可自由选的完整目录：图片 GPT Image 2（OpenAI）、Nano Banana 2/Pro（Google），视频 Grok（xAI）、Veo（Google），且 User Story 23（spec:64）明写"在图文工作台直接使用 AI 生图和改图"——改图输入的正是门店真实照片/before-after/人脸（P0 spec §5:174 定义为双敏个人信息）。这意味着"改 before-after 图 → Nano Banana（Google）"这条被 ADR-0005 明令禁止的出境路径在 P1 是默认可用且无任何护栏的。同时 model-supply map issue 12（map:40）把国产池降级为"未实测不强制校验"，第 4 条平移护栏也被推迟。ticket 09 的 RouteSnapshot 虽存"区域"字段，但那是"模型在哪个 region 可用"，不是"含人脸内容禁止路由海外"的数据分级硬过滤——两者不同。这是对锁定 ADR 的未声明偏离，且正在被建进 in-flight 的路由层，晚改=返工。

**原建议：** 在 docs/specs/beauty-content-agent-p1-spec.md §Core data model 与 §5 State machines 补回 data-residency 约束，并在 .scratch/p1-implementation/issues/07（模型目录）与 09（RouteSnapshot）里增加 data_class 能力维度：素材/任务标注 contains_face/pii/medical 时，硬过滤只允许路由到国产已备案 Deployment 或先脱敏，禁止落到 GPT Image/Nano Banana/Veo/Grok 等海外 Deployment。把 P0 的"Data hygiene journey"作为 P1 must-have 验收旅程复用进来。国产模型评测集需在 07/10 票里恢复"第一天进 benchmark"，否则落地日切换会撞质量悬崖，ADR-0005 承诺的"迁移便宜"不成立。

**证据：** docs/adr/0005-phase-gated-deployment-and-models.md:13（PII/人脸不出海）与:16（国产模型即时进评测保平移）；docs/specs/beauty-content-agent-p0-spec.md:284 与:340（P0 硬约束+验收旅程）；docs/specs/beauty-content-agent-p1-spec.md 全文 grep 无 PII/人脸/海外/区域/residency（仅 194/326 是无关的审计脱敏）；spec:64（US23 改图=真实照片入海外模型）；.scratch/model-supply-wayfinding/map.md:40（国产池"未实测不强制校验"）；ticket 09 RouteSnapshot"区域"=可用性非数据驻留

**替代方案：** 数据驻留硬过滤必须落在 Product Core 的 RouteSnapshot/RoutePolicy（ticket 09），而不是网关——增加一个 data_class 维度即可，成本远低于事后给每个 adapter 的 capability 声明 + 资产绑定回填。CF AI Gateway / Bifrost 虽都支持 tag/region 路由，但只能做执行期兜底，权威过滤仍须在领域层。

#### 验证意见 [WEAKENED]

核心事实成立，故不能 REFUTED：ADR-0005:13/:15、P0 spec:284(硬约束)/:340(Data hygiene journey)/§5:173-174(人脸=敏感个人信息)全部经源文件核实无误(唯一瑕疵：ADR §15 被误标为 :16)。P1 spec 全文 grep 确实零命中 PII/人脸/海外/区域/residency/数据路径/data-class/domestic(仅 179"检索评测"、277"可用路径"无关)；ticket 09 RouteSnapshot 只存"目录/价格/区域/凭据/候选/consent/策略 revision"确无 data_class；P1 的 E2E journeys(346-353)确实丢掉了 P0 的 Data hygiene 验收旅程——而 P1(US23/ticket 26)恰是 AI 改真实门店照/人脸落地处。所以"P1 把已锁定的 PII/人脸→国产/脱敏 数据分级约束+对应验收旅程在具体规格与票据层丢失，且正建进 in-flight 的 ticket 09 路由层"这一核心 gap 是真实、有据、值得在路由层固化前修的。

但 finding 有两处夸大/误读，故不能 CONFIRMED、须修正：(1)"第 4 条平移护栏也被推迟"是明确误读——issue 12 decision 1(:16)与 resolution(:70)两处逐字保留"国内候选从验证期同步进入目录与评测，不等到国内落地阶段才首次接入"，即 ADR-0005 §15/P0:284 的"国产模型第一天进评测"在 source-of-truth 地图里被完整保留，并未推迟；finding 把它与 decision 6"未实测不强制校验"(对所有模型通用的证据分级=不必先付费实测即可配置发布，非国产池降级、非 benchmark 推迟)混为一谈。(2)"无任何护栏""RouteSnapshot 区域≠数据分级硬过滤——两者不同"夸大——issue 15 decision 6(:21)与 resolution(:71)已把"数据路径/data path"与 region、credential 并列为领域层硬过滤维度，即数据驻留硬过滤的架构槽位在锁定路由决策中已预留，只是 ticket 09 清单未承接、未被具体绑定到 PII/人脸内容分级。正确定性是"已锁定的'数据路径'硬边界未被具体填充+验收旅程未平移"的规格→票据翻译丢失，而非"整条被架空、零护栏"。可行性上，建议方向成立且比其自述更省成本：P0 §5 资产事实已有"是否含人物或敏感个人信息""脱敏状态"作信号源，把 data_class 灌进 ticket 09 的 RouteSnapshot/RoutePolicy 只是填 issue 15 已预留的"数据路径"轴，与 issue 15"创作合规不参与路由过滤"不冲突(数据驻留≠创作合规)。但建议第 3 点"在 07/10 票恢复第一天进 benchmark"建立在被推翻的误读上，应删改。综合：方向对、核心真实但夸大+一条建议需修正——判 WEAKENED。

**修正后建议：** 保留并落地 finding 的有效核心，但按事实修正三处：

1)【仍须做，且是填已预留的槽位而非新增维度】在 P1 spec §4 Core data model 与 §6/§7 补回具体的数据驻留规则：素材/任务按 P0 §5 已存在的资产事实(contains_person/敏感个人信息、脱敏状态)派生 data_class(contains_face/pii/medical)；含双敏内容硬过滤只允许路由到国产已备案/registered Deployment 或先脱敏，禁止落到 GPT Image 2/Nano Banana/Veo/Grok 等海外 Deployment。把这条灌进 ticket 09 的 RouteSnapshot/RoutePolicy 硬过滤——这是正确的领域层，且 issue 15 decision 6 已把"数据路径"列为硬边界，属于填补已锁定但未被 ticket 09 承接的槽位，不是从零加维度。措辞上应说明"数据路径硬过滤≠创作合规过滤"，与 issue 15"创作合规不参与路由"一致，避免被当作被禁止的合规塞路由。

2)【仍须做】把 P0 的 Data hygiene journey(P0:340)作为 P1 must-have E2E 验收旅程复用进 P1 §End-to-end journeys，重点绑定 ticket 26(工作台 AI 改图)——因为 P1 才是改真实 before/after/人脸照片的实际落地点，验收缺口是真实回归。

3)【删改此点】不要写成"国产模型评测集需在 07/10 票里恢复第一天进 benchmark，否则撞质量悬崖"——该护栏并未被推迟：issue 12 decision 1 与 resolution 已逐字保留"国内候选从验证期同步进入目录与评测"。正确动作是把该已锁定决策在 P1 spec 与 ticket 07/10 里**复述一遍**，防止 map→spec 翻译时丢失该意图，而非"恢复被推迟的护栏"。

定性也应从"对锁定 ADR 的未声明偏离、零护栏"下调为"规格与票据层未承接已锁定的'数据路径'硬边界+验收旅程平移丢失"——因为被消费的地图(issue 15 数据路径硬边界 + issue 12 国产即时进评测)其实部分保留了两条护栏，缺的是把它们在 in-flight 的 ticket 09/26 与 P1 spec 里具体化落地。

#### 验证意见 [WEAKENED]

核心事实核对后成立，但 finding 的定性与次要论点明显夸大，故 WEAKENED 而非 CONFIRMED，也远够不上 REFUTED。

【成立的部分（不能反驳）】
1. ADR-0005:13/:16 引文准确，且第 2 条(PII/人脸不出海)是**验证期**就生效的护栏——ADR 明写它是"CF-first + 混用模型"这个赌注的三条"cheap"代价之一，不是落地期才管的事。necessity 视角救不了这条：把顾客(第三方消费者)的人脸/生物特征交给海外第三方 AI 提供方(OpenAI/Google)是真实的 PIPL 敏感个人信息+出境风险，B2B 试点合同的 consent 条款(0005:9,13)覆盖不干净。
2. P0 §16:284(硬约束)+Testing:340(Data hygiene journey 验收旅程)确实存在且被 P1 丢弃：我读完 P1 全部 E2E 旅程(346-353)，没有任何一条数据卫生/驻留旅程。
3. P1 spec 全文 grep 无驻留/人脸/出境语句(194/278/326 均为无关的 secret 脱敏，271 是 Catalog/Route 阶段切换)——finding 的 grep 断言字面为真。
4. 被禁路径确实默认可用：US23(改图)+US33/34(用户自由选海外图片模型)+Graphics Workbench 素材引用(P0 §5 素材含 before/after/人脸/顾客案例)。
5. 关键技术判断正确：锁定的路由票 issue 15 决策 6 硬过滤是 region/credential/data-path/phase，锚在"workspace/request 已授权 region",**不是**按单条内容 contains_face/pii/medical 的数据分级过滤；票 07/09 的 RouteSnapshot"区域"是可用性/授权维,无 data_class。且 Model Supply Control Plane 是 P1 **新建**模块,路由硬过滤正在 07/09 里现建,现在补 data_class 维确实比事后回填便宜——"晚改=返工"逻辑成立。

【夸大、需修正的部分（导致降级）】
A. "对锁定 ADR 的未声明偏离"不准确。数据驻留边界并非被静默丢弃:map.md:14 明确把"数据驻留"列为**必须研究**的技术/安全边界(只是不得伪装成创作门禁);更关键的是研究资产 .work-08/direct-first.md:199 **逐字**写明 ADR-0005 的 PII/人脸规则"是 Route Planner 的硬过滤,不是创作功能门禁"。也就是说团队在研究层**已识别**此要求,但从研究→lock 票(11-18/15)→P1 spec/impl 票的传递中把 data_class 维**弄丢了**。这是"已承认但未落线"的执行/可追溯性缺口,不是"偷偷推翻护栏"的决策偏离——这个区别影响团队该如何响应(补齐一个已承认的硬过滤 vs 逆转一个擅自偏离)。
B. "无任何护栏"夸大。其一,存在粗粒度的 region/data-path/phase 硬过滤(issue 15 决策 6);其二,P0 §5:173 已建素材敏感度事实(是否含人物/敏感个人信息、脱敏状态),P1 经迁移继承。真正缺的是把**已有的**素材敏感度标记接进路由硬过滤,是增量接线,不是"从零建分级+护栏"。
C. 第 4 条(国产模型第一天进 benchmark)论点夸大。map 对**所有**模型(海外+国产)都把真实 Key 校验与质量评测后置为非阻塞,这是用户拍板的 AI-native"先快速验证"范式下的统一决策,不是针对国产平移护栏的定向删除。它确实软化了 0005:16 的"迁移日不撞质量悬崖"意图,所以此点**部分**有效,但"第 4 条平移护栏被推迟"的表述过强。

【结论】方向对、缺口真实且现在修便宜,但定性("未声明偏离""无任何护栏")与次要论点(第4条)夸大,建议也需右尺化——符合"方向对但夸大或建议需修正=WEAKENED",并遵循"不确定时倾向 WEAKENED"。

**修正后建议：** 把该项从"P0 未声明偏离锁定 ADR"重新定性为"**已承认的数据驻留硬边界在从研究→锁定→P1 落地过程中未接线为按内容分级的路由硬过滤,且 P0 的 Data hygiene 验收旅程未平移**"——严重度仍保持"须在路由层定型前修复"的高优先(因为是新建的 Model Supply Control Plane,越晚接线越贵),但表述为完整性/合规完备性缺口,而非静默违反 ADR。

具体修正后的动作:
1. 路由层(权威过滤留在 Product Core,不放网关——finding 的替代方案这点正确):在 issue 15 已锁的 region/credential/data-path 硬过滤上**新增 data_class 维**(contains_face/pii/medical),复用 P0 §5:173 已有的素材敏感度标记而非新建分级;票 09 RouteSnapshot、票 07 目录能力声明相应补 data_class。命中敏感类的任务/素材只允许路由到国产已备案 Deployment 或先脱敏,禁止落到 GPT Image/Nano Banana/Veo/Grok。
2. 把 P0 的"Data hygiene journey"作为 P1 must-have E2E 复用进 P1 spec §Testing;P1 spec §4/§5 补一句指向 ADR-0005 的数据驻留硬边界(它已是 P1 named source_of_truth,只是 prose 缺失)。
3. 第 4 条(国产模型 benchmark)与驻留门**拆开处理**:承认"真实 Key/质量评测后置为非阻塞"是对所有模型的统一既定决策,不强行绑进本项;仅建议在 07/10 票恢复"国产候选第一天进入同一评测集(可用 recorded/fake 先占位,不需真实 Key 阻塞)",以保留 0005:16 的迁移日不撞质量悬崖意图,而不是把它写成一条被架空的护栏。
4. 不必按 finding 措辞给"每个 adapter 补 capability 声明+资产回填"设为主成本口径——由于敏感度标记 P0 已存在、硬过滤 09 正在现建,主成本是在领域层加一个过滤维,成本低。

### [CONFIRMED] F3 (P1, p0-alignment) — ADR-0008/P0 §7 锁定的视频多步合成流水线在 P1 无归属票，14-17 仅供应商 adapter，旗舰功能面临退化为单次直出或临时补票

**详情：** ADR-0008 D5（0008:42）与 2026-07-11 修订（0008:10 明写"ffmpeg composition boundaries remain accepted"）把视频成片锁定为多步流水线：AIDA 分镜（流内可确认）→ 真素材首帧 → 逐镜片段 → N→1 择优 → ffmpeg 薄合成（拼接/字幕/BGM/标识烧录）→ 存储；P0 spec §7（190-201）同口径，且这条链在 P0 代码里真实存在——apps/core/src/video/product-renderer.ts 的 renderProductVideo 就是"逐 shot 调 provider.generateClip 或本地 ffmpeg → ffmpeg 合成 → proof/labels/evidence"的同步实现。问题是 P1 的 §Modules"Generation Runtime"（spec:173）把媒体建成"单 GenerationJob = 单 ProviderAttempt = 单 Asset"的单次异步直出模型，ticket 14-17 全是"选 Seedance/Kling/Grok/Veo 直出一条 clip"的供应商 adapter（14 checklist 仅 operation/异步/取消/asset/cost），ticket 03 只是把分镜/任务/产物迁成关系事实（数据迁移，非流水线重接）。全 32 票 grep 无 AIDA/storyboard/分镜编排/ffmpeg/首帧/compose 任何编排票。后果：现有同步 in-process 合成链必须被拆成 pg-boss durable 多步 + 逐镜 ProviderAttempt 才能满足 P1 的可恢复/双账要求（票 05/08），但没有票 own 这个拆解；实现者要么把视频退化成"单模型直出一条"（丢掉分镜确认这个"对黑盒零确认的差异化补位"、丢掉真素材首帧接地、丢掉 ffmpeg 标识烧录），要么在 build 中途临时插一张计划外的重流水线票。这与 ADR-0007:5"视频流水线是穿过 Runtime Port 的第一条重工作流"的定位直接矛盾。

**原建议：** 在 .scratch/p1-implementation/issues/ 增补一张显式的"视频合成流水线穿 durable step-runner"票（挂在 05/08 之后、14-17 之前），明确：视频 job 是多步 workflow，每镜首帧/片段是一个 ProviderAttempt，ffmpeg 薄合成是终态步产出单个 Asset，AIDA 分镜确认是流内 gate。直接复用现有 product-renderer.ts + composer.ts 作为"薄合成壳"（勿重写），只把它的同步执行改造为 durable 分步。同步修订 P1 spec §3 Modules"Generation Runtime"，说明它承载的是多步 composed video 而非单次直出，否则 GenerationJob/Attempt 的数据形状对不上旗舰功能。

**证据：** docs/adr/0008-video-in-p0-and-layered-buy-build.md:42（D5 五步流水线）与:10（ffmpeg 合成边界仍 accepted）；docs/specs/beauty-content-agent-p0-spec.md:190-201（§7 同口径）；apps/core/src/video/product-renderer.ts:179-348（P0 真实合成链）；.scratch/p1-implementation/issues/14-seedance-2-adapter.md（仅供应商 adapter）；issues/03（仅数据迁移）；32 票 grep 无编排票；docs/specs/beauty-content-agent-p1-spec.md:173（Generation Runtime=单 job/attempt/asset）

**替代方案：** 复用而非重建：product-renderer.ts/composer.ts 已是 ADR-0008 要的"ffmpeg 薄合成壳"，只需把同步 renderProductVideo 拆成 step-runner 的有序步（首帧步→逐镜片段步→N→1 择优步→合成步），落进 pg-boss durable job；黑板态可抄 ad_video_gen 的 session.state 范式（ADR-0008 已留档）。不要为此引入 Mastra——ADR-0007 已把它列为触发式后置，单条多步流水线尚不构成"多分支/子流程"触发条件。

#### 验证意见 [CONFIRMED]

我尽力反驳但反驳失败，逐条核实后 finding 的证据与推理都成立。

一、证据全部真实且被正确解读（逐条对账）：
- ADR-0008:42（D5）确为五步流水线「AIDA storyboard → first frames → clips → thin compose shell(ffmpeg concat+BGM/subtitles+label) → TOS/R2 → publish」；:10（2026-07-11 修订）确写「ffmpeg composition boundaries remain accepted」。
- P0 spec §7:190-201 同口径，明写「AIDA 分镜确认 → 首帧候选 → 视频片段 → N→1 质量评估 → ffmpeg 薄合成 → …」。
- apps/core/src/video/product-renderer.ts:179-348 的 renderProductVideo 确是同步 in-process 链：for 循环逐 shot 调 provider.generateClip 或本地 ffmpeg，再 runVideoProof 做 compose+labels+evidence。且经查它由 server.ts/main.ts 直接同步调用，非 job worker。
- P1 spec:173 Generation Runtime 模块＝GenerationJob/ProviderAttempt/ProviderTaskRef/Asset/回调轮询/取消/恢复；line 348/92/79 反复把视频描述为「选择固定视频模型→报价→reserve→异步生成→Asset 落盘→双账」的单次直出，全程无 storyboard/首帧/多镜/compose。
- tickets 14-17 确均为单 clip 供应商 adapter；03 确为数据迁移票。

二、最关键的"无归属"断言经 grep 全库证实：32 票中 首帧/ffmpeg/compose/合成/AIDA/N→1择优 命中数为零；分镜仅出现在 03（且 03 acceptance 明确是「迁移+旅程可查询/恢复」，非把 renderProductVideo 重接成 durable 分步）。MAP.md 与 p1-wayfinding 确认就是 32 张 tracer 票、无隐藏的视频编排 workstream；wayfinding 的 out-of-scope 只覆盖"重视频编辑/专业剪辑器/数字人"，不覆盖核心合成流水线。

三、技术硬核（我原想用来反驳，结果反而坐实）：我检验了"复用现有 renderer(spec:358)+ticket 01 视频旅程无回退"能否消解此 gap——不能。因为 P0 无任何 durable 基础设施（step-runner/pg-boss grep 全空），renderProductVideo 是从 HTTP server 同步调用；而 composer.ts 的 VideoProvider.generateClip 契约是单次 `Promise<GeneratedVideoClip>` await，与 P1 ticket 14「异步提交/状态恢复/取消/跨 worker 重启恢复（15s 视频端到端~18min）」的可恢复 Attempt 模型根本不兼容。逐镜同步 await 一个 18 分钟可恢复任务会长期占用 job，违反 08「终态恢复不重新生成」与 spec:316。故把同步 provider-loop 重构成"逐镜 durable ProviderAttempt + 终态 compose 步"是真实且非平凡的工作，而 01（seam/无回退）、03（数据迁移）、08（单 fake attempt）无一 own 它。这与 ADR-0007:5「视频流水线是穿过 Runtime Port 的第一条重工作流」直接矛盾。finding 成立。

四、建议技术上站得住且符合 2026-07 生态：复用 product-renderer.ts+composer.ts（二者真实存在，且 composer 已含 firstFrameUrl 首帧参数）作薄合成壳、把同步执行改造为 pg-boss(05) 之上的有序 durable 步、黑板态抄 ad_video_gen session.state、明确不引入 Mastra（与 ADR-0007 的 Mastra 后置一致，单条多步线性流水线尚不构成"多分支/子流程"触发条件）——均正确。

存在三处轻微措辞瑕疵，但均不动摇结论：(1)"grep 无 storyboard/分镜"不严谨（03 含分镜），但 finding 已自我限定 03 为数据迁移；(2)"单 Job=单 Attempt=单 Asset"略欠准，spec:191/207 支持一 Job 多 Attempt(重试)，但模型仍是单-clip 中心而非多镜-compose 中心，论点不变；(3)"退化为单次直出"只是两个失败面之一，01 无回退+358 复用 renderer 使"直接删除"不太可能，更可能落到 finding 已列的"临时补计划外票"那一面。这些是框架措辞问题，非硬伤，不影响"存在未归属的 durable 视频合成编排 gap+应补一张显式票"的核心结论与推荐动作。

**修正后建议：** 维持 finding 的核心与建议（增补一张"视频合成流水线穿 durable step-runner"票，复用 product-renderer.ts+composer.ts 作薄壳、勿重写，同步修订 P1 spec §3 Generation Runtime 模块说明其承载多步 composed video、不引入 Mastra），仅做三点收紧：

1. 把最硬的论据前置为票的动机：真正的不兼容点是 composer.ts 的 `VideoProvider.generateClip(): Promise<GeneratedVideoClip>` 单次同步 await 契约 vs. ticket 14-17 的异步可恢复 Attempt（提交→轮询/webhook→跨 worker 重启恢复，~18min/镜）。票的验收应显式写「逐镜＝一个可恢复 ProviderAttempt(带 ProviderTaskRef/late-success 隔离)，compose 为终态步产单一 Asset，storyboard 为流内 gate，worker 重启后已完成镜不重生成」，直接对齐 08/spec:316。

2. 措辞纠偏，避免被下游当硬事实引用：删"grep 无 storyboard"（03 含分镜，应表述为"仅 03 以数据迁移口径提及，无任何编排票"）；"单 Job=单 Attempt=单 Asset"改为"Generation Runtime 建模为单-clip 供应任务中心（Job→N Attempt 仅为重试），缺多镜 compose 的一对多结构"。

3. 依赖排序补一句：该票挂 08 之后可用 fake 媒体 adapter 验证 compose 骨架，再由 14-17 换真 provider；但 N→1 择优会使每镜 Attempt 数×候选数，需在票内标注成本/时延采集口径（呼应 ADR-0008 D5 spike 的 per-clip cost/latency 验收）。

### [WEAKENED] F4 (P1, p0-alignment) — Gate 0 与法务终审被声明式推迟却无 owner/触发点，"功能完成"可能达成一个功能全绿却因合规未终审/未数据落地而无法"公开收费上线"的假绿态

**详情：** P0 定稿把合规做成护城河（合集 §5 第7条 17 条义务重构；您 MEMORY 亦记"做对=真护城河/只提醒=负债"），并锁定"公开收费上线前完成 Gate 0：算法备案 + 生成式 AI 服务登记 + 页面公示"（P0 spec §16:287）。2026-07-11 用户重决把创作放开、AIGC 改开关、法务后审——这是已声明的 reversal（ADR-0003/0004 已批注，一致性 review 已覆盖措辞，我不重复报措辞冲突）。但一个继承层面的新风险未被任何文档 own：P1 spec 把法务定为"功能完整后终审"（spec:279、:383）、创作阶段"不新增法务合规开发门禁"（spec:251），而 ADR-0005:17 又把"落地触发点"设为"not preset"。于是两个最有法律牙齿的门——数据驻留迁移（Gate 0 前置）与 AIGC/合规默认值的法务终审——都既无 owner 也无触发日期。叠加 F1 的"功能完成与商户价值脱钩"，P1 完全可能走到 release Gate 全绿、CONTEXT 判定"功能完成"，但此时既没做 Gate 0 也没过法务终审，根本不能"公开收费上线"（P0 spec §Out of Scope:375 明列"公开注册与公开收费上线，直到 Gate 0 完成"为砍项）。这正是把 P0 定为护城河的东西，在 P1 被推迟成一个无人负责的尾款。

**原建议：** 在 docs/specs/beauty-content-agent-p1-spec.md §10 Activation and release evidence 里给"法务终审"和"Gate 0（备案/登记/公示 + 数据出境合同）"各指定一个显式 owner 和触发点（例如绑定"封闭付费 Beta 转公开收费"这一商业事件，而非"功能完整后"这种无日期措辞），并在发布 Gate 清单里加一条"公开收费上线前 Gate 0 必须为 done"的硬 gate。同时明确"功能完成"≠"可公开收费"，避免 F1 的 release Gate 假绿被误读为可商用。

**证据：** docs/specs/beauty-content-agent-p0-spec.md:287（Gate 0 前置）与:375（未过 Gate 0 不得公开收费）；docs/specs/beauty-content-agent-p1-spec.md:279 与:383（法务"功能完整后终审"无触发点）与:251（创作阶段无法务门禁）；docs/adr/0005-phase-gated-deployment-and-models.md:17（落地触发点 not preset）；合集-v1.5-P0决策定稿.md §5 第7条（合规=护城河）；CONTEXT.md:20（功能完成不含合规/上线前置）

**替代方案：** none（这是治理/责任归属缺口，不是可用组件替换——需要的是把"无日期触发"换成"绑定商业里程碑的显式 gate + owner"）。

### [WEAKENED] F1-model-execution-gateway (P1, components) — 模型执行买建边界画歪：6 个异步媒体 adapter 自写，而票20 只评测 LLM 类网关，媒体网关（fal/Replicate）被漏在生产之外

**详情：** 票10-17 把 3 个 LLM + GPT-Image + Nano Banana 2/Pro + Seedream + Seedance + Kling + Grok-video + Veo 全部作为自写 recorded adapter 直调。对 LLM（票10 OpenAI/Anthropic/Gemini）这没问题——Vercel AI SDK v7 的 provider 生态本就完整覆盖。但截至锁定的 `ai` 7.x，AI SDK 没有一等的视频模态原语（只有 generateImage），Veo/Grok-video/Kling/Seedance 这类异步视频根本不在 AI SDK 覆盖内，其真正难点是 submit→排队→poll/webhook→取回临时 URL→落盘 Asset→取成本 的整套异步生命周期——而这套东西票08/09 已经在 Product Core 里通用地自建了一遍（GenerationJob/Attempt/ProviderTaskRef/Asset/RouteSnapshot）。现状是：这套异步机械被按 provider 重复实现 6 次。证据表明你们已经手写过一次：apps/core/src/video/ark-provider.ts 就是一个带 pollIntervalMs/timeoutMs/status 机的火山方舟直连 adapter，票14-17 等于把它再抄 4 遍。而票20 唯一列入 PoC 的网关是 Bifrost/LiteLLM——两者本质是 LLM 网关，对异步视频 job 生命周期几乎不抽象，所以它无法削减最重的 6 个媒体 adapter 的维护量。真正能把 submit/webhook/asset 统一成一个契约的媒体原生网关（fal.ai、Replicate，覆盖 Kling/Veo/Nano Banana/Flux 等）不在 PoC 里，其中 fal 还已经随模板躺在仓库里（@tanstack/ai-fal, mkfast package.json:51），P0 定稿 line 2984-2986 也早已识别它但只当'内部研发'。注意 mainland 约束：line 2986 说 fal 面向境内不可用——这指客户端 Workers AI 与落地期直服境内，不否定'验证期服务端调用外域模型'这一用法（ADR-0005 本就把外域模型限定在验证期、落地期在 Port 后替换）。

**原建议：** 改 spec §8 与票20：把 ProviderExecutionPort 的 PoC 拆成两轨——(1) LLM 轨 = Bifrost 主/LiteLLM 对照（服务票10）；(2) 媒体轨 = 对 Veo/Grok/Kling/Nano Banana 等外域异步模型评测 fal.ai 或 Replicate 的 prediction+webhook API（仅验证期、服务端、落地期按 ADR-0005 在 Port 后替换），对 Seedream/Seedance 等国内模型保留直连火山方舟并复用现有 ark-provider.ts。据此把票12/15/16/17 从'逐个自写 recorded adapter'降级为'一个媒体网关 adapter + per-model 能力/价格 revision'，只有网关未覆盖的（如 Grok-video）才直连。这样 6 个媒体 adapter 里 3-4 个坍缩为共享网关，异步机械只维护一份。

**证据：** 票14 `.scratch/p1-implementation/issues/14-seedance-2-adapter.md`、票17 `17-veo-latest-adapter.md`（均'recorded contract'自写）；票20 `20-bifrost-litellm-isolated-poc.md` + spec line 261「Bifrost 主、LiteLLM 对照的隔离 PoC...生产晋升是 conditional」；已存在的自写异步 adapter apps/core/src/video/ark-provider.ts（interface ArkTask + pollIntervalMs/timeoutMs）；mkfast package.json:51 `@tanstack/ai-fal`；P0 定稿 line 2984-2986

**替代方案：** fal.ai / Replicate（媒体原生网关，统一 async webhook/poll + 资产托管，覆盖 Kling/Veo/Nano Banana/Flux）用于外域图像视频；国内 Seedream/Seedance 直连火山方舟（现有 ark-provider）；LLM 侧 Bifrost（Go 单二进制，契合单 Node 拓扑）优于 LiteLLM（Python 需额外运行时），或 Portkey 作托管替代

#### 验证意见 [WEAKENED]

方向对但框架/严重度夸大、建议需修正，属典型 WEAKENED。

一、引用证据基本真实且大体解读正确。ark-provider.ts 确是自写直连异步 adapter（ArkTask + pollIntervalMs/timeoutMs + waitForTask 轮询循环，约330行）；mkfast package.json:51 确有 @tanstack/ai-fal；票20 确实只列 Bifrost/LiteLLM；P0 line 2984-2986 确实把 fal 只当内部研发。且 finding 的技术内核有项目自身调研背书：asset 08 line 140 明写"Bifrost OSS 视频没有网关自有 durable queue"，asset 05 §5.2 确认 fal 有持久 Queue（submit/status/result/cancel/webhook）——所以"PoC 里的 LLM 类网关削不动 6 个媒体 adapter 的异步机械、而 fal 的 Queue 才能把 submit/poll/webhook 收敛成一份"这一核心判断在技术上成立，且与项目自己的拓扑推荐（asset 08 §6.1 候选 C：fal.ai 作主 Managed Media Adapter）方向一致。因此不能 REFUTED。

二、但 finding 的定性与严重度明显夸大，核心措辞与已锁定决策相矛盾：
1)"媒体网关被漏在生产之外""买建边界画歪"暗示这是疏漏/错误。实际锁定11（拓扑）的 ProviderExecutionPort 图 line 36-38 显式含"Managed Media Adapter"；锁定14（视频）决策1 显式点名"fal Queue"为 operation adapter 之一并把 channel_type 设为可配 original/official_cloud/aggregator/proxy；锁定18 conditional #2 显式把 fal.ai 列为 conditional 聚合通道。即 fal 是被有意识地放为"conditional 通道 + 直连优先做录取合同"的深思决定，不是"漏"，边界也不是"画歪"。
2) finding 把票12/15/16/17 读成"强制自写 6 个直连 adapter"，但锁定架构把每模型票当作 Port 级录取合同（channel 可配 aggregator，含 fal），recorded contract 本身是 channel 无关的。所以"降级这些票"的建议一定程度在打稻草人——架构本就允许 fal 通道。

三、建议需修正之处：
1) LLM 轨（Bifrost 主/LiteLLM 对照）正是票20 已锁定范围，这半条属重复、无新增。
2)"3-4 个坍缩为共享网关、异步机械只维护一份"的收益被高估：锁定14 决策4 + ADR-0005 规定落地期用户目录只留 CN region 的 original/official_cloud，fal（aggregator）非 landing-eligible；能留存到落地的 Seedance 走直连(ark-provider)、Kling 落地也需 original/官云直连 adapter——对 Kling 用 fal 反而=验证期 fal + 落地期直连两套。fal 真正净省直连工的只有不留存为面向用户的外域模型（Grok/Veo/Nano-Banana），实际约 2-3 个而非 3-4 个。
3) finding 举"Grok-video 需直连"为网关未覆盖例，但 asset 05 §3.2 显示 fal 覆盖 Grok 通用+1.5，此例略失准。
4) 未提 ADR-0005 三轻护栏"顾客 PII/人脸不进海外 API"——美业客户前后对比人脸类媒体本就被 Product Core 区域/凭据路由挡在 fal 之外，这是与买建正交但必须遵守的约束。
5)"Bifrost/LiteLLM 对异步视频 job 生命周期几乎不抽象"略夸大（asset 05 §6 记 Bifrost 有图片/视频 adapter、LiteLLM 媒体有真实实现），但"无网关自有 durable queue"（asset 08 line140）确证其内核。

四、真正存活的有效内核（故不可 REFUTED）：票20 的 PoC 确为纯 LLM 网关口径，而项目自己的拓扑调研（asset 08 §6.1）推荐 fal.ai 作主 Managed Media Adapter，且 docs/specs/beauty-content-agent-p1-spec.md 通篇未surface 媒体网关/Managed Media Adapter，§11 未来升级清单也未追踪它——存在从 wayfinding 推荐到 P1 实施 PoC/spec 的真实可追溯性缺口，值得补：把媒体原生网关（fal/Replicate）纳入票20 评测，并在验证期把外域异步媒体经一条共享 fal Queue adapter 执行以把 submit/poll/webhook 机械只写一份。综上，方向成立但夸大且建议需修正 → WEAKENED。

**修正后建议：** 重新定性：不是"买建边界画歪/媒体网关被漏在生产之外"（拓扑锁定11 已显式含 Managed Media Adapter、锁定14 已点名 fal Queue、锁定18 已把 fal.ai 列为 conditional 聚合通道——是有意的 conditional 决定，非疏漏），而是"已在拓扑锁定为 conditional 的媒体网关(fal)未被前移进 P1 实施 PoC 与 spec，导致验证期异步媒体机械有被逐 provider 重写 N 次的风险"。据此修正建议：

1) 票20 补一条媒体轨（不改 LLM 轨）：现票20 只评 Bifrost/LiteLLM，而项目自身调研（asset 08 §6.1、asset 05 §5.2）已认定 fal.ai 是唯一覆盖四图四视频家族且有持久 Queue 的媒体聚合，Bifrost 则"视频无网关自有 durable queue"(asset 08 line140)。故把 fal/Replicate 的 prediction+Queue+webhook 作为独立媒体轨纳入 PoC 评测（仅验证期、服务端）。LLM 轨维持 Bifrost 主/LiteLLM 对照即可（本就是票20 现状，无需改）。

2) 验证期把外域异步媒体经一条共享 fal Queue adapter 执行，让 submit/poll/webhook/cancel/cost 机械只写一份，落在同一 ProviderExecutionPort 后、复用票08/09 的 GenerationJob/ProviderTaskRef/Asset/双账。但明确收益边界（修正原"3-4坍缩"的高估）：因锁定14 决策4 + ADR-0005 规定落地期只留 CN region original/official_cloud，Seedance 保持直连 ark-provider、Kling 落地仍需直连/官云 adapter；fal 真正净省直连工的只有 Grok/Veo/Nano-Banana 等不留存为面向用户的外域模型（约 2-3 个），对 Kling 不要用 fal 替代直连（否则=两套）。

3) 保留每模型 recorded contract 为 must-have（这是 Port 级合同，channel 无关），只把"实现通道"从默认直连改为验证期优先 fal aggregator——即激活架构本已允许的 conditional 通道，而非"降级/删除"这些票。

4) 强制遵守 ADR-0005 三轻护栏"顾客 PII/人脸不进海外 API"：凡涉及客户人脸的媒体 operation 由 Product Core 按 region/credential 路由硬过滤出 fal，无论直连还是网关；此约束与买建正交，激活 fal 时须一并落实。

5) 在 spec §8 与 §11 显式登记"Managed Media Adapter(fal) = 验证期可激活的 conditional 媒体执行通道、落地期按 ADR-0005 在 Port 后替换为 CN 原厂/官云"，闭合 wayfinding 推荐→spec 的可追溯性缺口。

### [WEAKENED] F2-web-shell-dual-ai-sdk (P1, components) — Web 外壳'双 AI SDK'冲突未收敛（TanStack AI vs Vercel AI SDK），且澄清：不存在 Next.js 口径冲突

**详情：** 先澄清任务里的疑问：P0 定稿并未定 Next.js。合集 line 1239「Web 框架 | mkfast-template fork，保留 TanStack Start / React App Shell」——web 基座就是 mkfast=TanStack Start on Workers，Next.js 只是 CreatOK 竞品佐证，二者不冲突。真正的组件冲突在于：mkfast 模板自带 @tanstack/ai 0.14.0 / @tanstack/ai-react 0.8.0 / @tanstack/ai-fal（package.json:50-52），这是与 ADR-0007 强制、且 apps/core 实际在用的 Vercel AI SDK（`ai` ^7.0.19）不同的另一套 AI SDK 家族。ADR-0007 明确『Vercel AI SDK powers all P0 AI surfaces... copilot chat may run in the Workers shell（streamText + zod tools）』；MEMORY 记的分页骨架是'对话式外壳'，即 shell 要有 chat UI。但 core 的 runner 用 Vercel AI SDK 的 streamText 数据流协议，模板的 chat UI 却是 TanStack AI 的协议——两者消息/流协议不同，直接对接会产生桥接摩擦。32 张票没有一张处理 web 外壳或收敛这个选择，等 P1 做对话工作台 UI 时必然返工。

**原建议：** P1 开工前补一张 web-shell 票，按 ADR-0007 统一为 Vercel AI SDK：shell 引入 @ai-sdk/react 的 useChat 对接 core 的 streamText，删掉模板里的 @tanstack/ai / @tanstack/ai-react / @tanstack/ai-fal；若确要保留 TanStack AI，则必须回改 ADR-0007 并写清与 core `ai` 7.x runner 的流协议桥接方案。同时在评审结论里把'Next.js 口径冲突'标注为不成立（合集 line 1239）。

**证据：** mkfast-template-main/package.json:50-52（@tanstack/ai / ai-react / ai-fal）；apps/core/package.json:19 `"ai": "^7.0.19"`；docs/adr/0007-agent-runtime-ai-sdk-first.md「Vercel AI SDK powers all P0 AI surfaces...copilot chat may run in the Workers shell」；合集-v1.5-P0决策定稿.md:1239

**替代方案：** 统一到 Vercel AI SDK：shell 用 @ai-sdk/react（useChat/useObject）对接 core streamText，最省桥接且与 ADR-0007/现有 core 一致；@tanstack/ai 端到端方案会让 core 的 `ai` 7.x runner 与 shell 割裂，不建议

#### 验证意见 [WEAKENED]

证据的表层事实成立，但 finding 的承重论点建立在两个被源码证伪的前提上，属于误诊+夸大，故 WEAKENED。

已核实为真的部分：mkfast package.json:50-52 确有 @tanstack/ai 0.14.0 / @tanstack/ai-fal ^0.7.0 / @tanstack/ai-react 0.8.0；apps/core package.json:19 确为 `ai` ^7.0.19；ADR-0007 引文准确；line 1239 确证 web 基座=TanStack Start（Next.js 澄清正确）。"仓内并存两套 AI SDK 家族"这一客观事实成立。

被证伪的承重前提（硬伤所在）：
1) finding 称"模板的 chat UI 却是 TanStack AI 的协议…直接对接产生桥接摩擦"。实测：@tanstack/ai / @tanstack/ai-fal 在整个模板中只被 src/api/ai.ts 一处 import，用途是 fal.ai 图片生成（generateImage/falImage），根本不是 chat；而 chat hooks 包 @tanstack/ai-react 全仓零 import（grep exit=1，是死依赖）。对整套 src grep `useChat|streamText|@ai-sdk` 无任何命中。也就是说"TanStack AI 的 chat UI"在代码里不存在，与 core streamText 的"协议对接摩擦"是虚构的——没有东西可对接。ai.ts 里唯一的"chat"调用（generateTaglines）走的是 Cloudflare Workers AI REST，不经 @tanstack/ai。
2) finding 称"P1 做对话工作台 UI 时必然返工"。实测 P1 spec（docs/specs/beauty-content-agent-p1-spec.md）grep `流式|streaming|copilot|聊天|对话式|会话` 零命中；工作台主面明确是"任务收件箱"（line 246）+ 图文画布/模板，P1 根本不建 chat/copilot 流式界面。既无现存 chat UI，也不新建 chat UI，"必然返工"无依据。

"收敛未做/无票处理"也不准确：spec line 258「AI SDK 位于 ContentWorkflowRunner Runtime Port 后；业务模块不 import AI SDK」+ line 259「MCP client 优先复用 @ai-sdk/mcp」已在规格层把方向收敛到 Vercel AI SDK 生态；图片生成的收敛由票 11-13（GPT Image 2 / Nano Banana / Seedream 的 core Adapter）+ 票 26（图文工作台经统一 GenerationJob/Asset 接入生图改图）承接，将取代模板 @tanstack/ai-fal 的 demo 路径。shell↔core 现有集成是 forwardWorkspaceCoreRequest 纯 HTTP 代理（state/commands/video/process），并非流式协议耦合。

建议也需修正：finding 让"删掉 @tanstack/ai / @tanstack/ai-react / @tanstack/ai-fal"，但 @tanstack/ai/@tanstack/ai-fal 是当前可用的图片生成路径（正由 core adapter 取代），一刀删掉会误伤图片能力；真正现在可无损删除的只有死依赖 @tanstack/ai-react。加 useChat 只有在真造 chat 面时才需要，而 P1 不在范围内。

综上：方向上"仓内有第二套 AI SDK 遗留、需与 ADR-0007 的 Vercel 方向对齐"这一低级别卫生问题是真的，Next.js 澄清也对；但核心机制（既存 TanStack AI chat UI ↔ streamText 协议冲突）被源码证伪，严重度（P1、必然返工）被夸大，建议方向部分误伤——故判 WEAKENED 而非 CONFIRMED，也非 REFUTED（并非全无价值）。

**修正后建议：** 把该 finding 从"P1 级组件冲突/必然返工"降级为"P3/Nit 级依赖卫生 + 前瞻护栏"，并在结论里修正事实口径：

1) 事实更正（务必写进评审结论）：模板的 @tanstack/ai / @tanstack/ai-fal 仅在 src/api/ai.ts 用于 fal.ai 图片生成，不是 chat；@tanstack/ai-react（chat hooks 包）全仓未 import，是死依赖；模板内无任何 useChat/streamText/@ai-sdk 使用，故当前不存在"TanStack AI chat UI 与 core streamText 的协议冲突"。同时 P1 spec 不建 chat/copilot 流式界面（工作台=任务收件箱+图文画布，line 246），"P1 做对话工作台必然返工"不成立。Next.js 口径冲突不成立（line 1239）——这部分保留。

2) 真正该做的小清理（低优先）：现在即可删除未使用的 @tanstack/ai-react（knip 本就会标出）；待票 26 + 票 11-13 落地、图片生成迁到 core adapter 后，再从 web 包移除 @tanstack/ai / @tanstack/ai-fal（不要现在删，否则误伤在用的图片路径）。

3) 前瞻护栏（一行即可，不必单开票）：在 web-shell/spec 补一句——未来若新增 copilot/chat 面，统一用 @ai-sdk/react（useChat/useObject）对接 core streamText，遵循 ADR-0007 与 spec line 258-259（AI SDK 置于 Runtime Port 后、MCP 复用 @ai-sdk/mcp），禁止在 @tanstack/ai-react 上另起 chat 栈。这样 chat（Vercel AI SDK）与图片（现走 core adapter）分层清晰，不构成"双 SDK 冲突"。

### [WEAKENED] F1-media-provider-spec (P1, ai-native-trends) — 图片/视频走自建 ProviderExecutionPort + 7 个 per-model adapter，重复了 AI SDK v6/v7 已标准化的媒体 provider 能力

**详情：** spec §8 把媒体执行放在自建 ProviderExecutionPort 后、业务层"不 import provider SDK"，AI SDK 只服务文本对话；tickets 11-17、26 为 GPT Image 2 / Nano Banana / Seedream 5.0 Pro / Seedance 2.0 / Kling / Grok / Veo 各写一条 recorded-contract adapter。但你已 pin `ai` 7.x（ADR-0007），而 AI SDK v6 起 generateImage（含参考图编辑）已转正、v7 experimental_generateVideo 官方 provider 覆盖 fal/Google/Vertex/Replicate，Vercel AI Gateway 更把这批模型作为一等模型 ID 暴露（bytedance/seedance-2.0 与 -fast、klingai/kling-v2.6-t2v、google/veo-3.1-generate-001、bytedance/seedance-v1.5-pro、Wan、Grok），统一 t2v/i2v/r2v/motion-control/编辑/续接 能力与 duration/aspectRatio/resolution/generateAudio 参数，Seedance 2.0 零加价。也就是说你正手写并要长期维护的"每模型请求/响应/能力归一化"，正是 AI SDK provider spec 与官方 provider 包已在做、且随模型漂移持续更新的东西——你会用 7 张票追模型 API 变更。需承认的边界：experimental_generateVideo 是进程内长轮询（ADR-0008 实测 ~18 分钟），不给"提交后离开、重启可恢复"的 ProviderTaskRef，所以你确实要自建异步外壳。问题不在"要不要自建"，而在边界画错：把 provider 归一化（应复用）与 durable 外壳（应自建）捆进了同一个 Port + 7 adapter。

**原建议：** 把 tickets 10-17、26 的 adapter 接口从自定义 ProviderExecutionPort 改为对齐 AI SDK provider spec（ImageModelV4 / 视频模型接口）：(1) 模型调用层复用 @ai-sdk/fal / @ai-sdk/google / @ai-sdk/replicate / @ai-sdk/xai，或验证期用 Vercel AI Gateway 模型 ID，拿到请求/响应/能力归一化与目录，不再逐模型手写 HTTP；(2) 自建代码收缩到 durable 外壳（submit→存 ProviderTaskRef→poll/webhook→Asset 落盘→双账→恢复），即 AI SDK 真正没覆盖的部分；(3) 国内落地期（ADR-0005）不依赖 US 的 AI Gateway，用 AI SDK customProvider + provider registry 为豆包/即梦写符合 spec 的薄 provider，路由指示留在 registry。把 spec §8 第 258-261 行"业务不 import provider SDK / 模型执行走 ProviderExecutionPort"改成"模型执行对齐 AI SDK provider spec，durable 外壳自建"。

**证据：** /Users/bin/Desktop/开发/内容无人区/美业内容2/docs/specs/beauty-content-agent-p1-spec.md:258-261（AI SDK 仅在 Runtime Port 后、模型执行走 ProviderExecutionPort/Bifrost）; tickets 14-17、26（每模型 recorded-contract adapter）; https://vercel.com/docs/ai-gateway/modalities/video-generation （experimental_generateVideo 需 AI SDK 6+；bytedance/seedance-v1.5-pro、klingai/kling-v2.6-t2v、google/veo-3.1-generate-001 一等模型 ID；统一参数）; https://vercel.com/blog/ai-sdk-7 （v7 experimental_generateVideo provider: fal/Google/Vertex/Replicate）; https://vercel.com/ai-gateway/models/seedance-2.0 （Seedance 2.0 在 AI Gateway，零加价）

**替代方案：** AI SDK provider spec + 官方 provider 包（@ai-sdk/fal / @ai-sdk/google / @ai-sdk/replicate / @ai-sdk/xai）作为 adapter 接口标准；Vercel AI Gateway（验证期，Seedance 2.0 零加价）或 customProvider+provider registry（国内落地、自托管无地域约束）作路由层。理由：这是社区事实标准的媒体 adapter 接口，模型漂移由生态维护，你只留必须自建的 durable 外壳。

#### 验证意见 [WEAKENED]

证据真实但被误读，核心诊断建立在对 Port/Adapter 边界的误解上，headline 建议技术上有害；仅剩一个狭窄有效点，故 WEAKENED。

一、证据核实（真实存在）：spec §8 258-261 行确如所引（AI SDK 在 Runtime Port 后 / 业务模块不 import provider SDK / 模型执行走 ProviderExecutionPort、Bifrost 主 LiteLLM 对照）；tickets 10-17、26 确实存在于 `.scratch/p1-implementation/issues/`，且是每模型一条带 recorded contract；ADR-0007 确实 pin `ai` 7.x，ADR-0008 确实记 15s 视频 ~18 分钟与 buy-build 五层边界。

二、硬伤（导致核心诊断不成立）：
1) "业务不 import provider SDK ⇒ 不能复用 AI SDK provider" 是误读。258 行约束的是"业务模块"（Product Core 领域层），而 §2 161 行明确"供应商位于 Ports/Adapters 外围"；ADR-0007 明说 AI SDK 出现在 runner/tool wrapper 内，08-doc §2.2 LLM 路径明写"Runtime Port/AI SDK 或原生 Adapter"，并把 Vercel/Cloudflare Adapter 作为同一 ProviderExecutionPort 上的可替换 Adapter。即：在 Port 后用 @ai-sdk/fal 或 Vercel AI Gateway 做 adapter 实现，架构本就允许甚至已列候选——finding 想拆的墙不存在。
2) "7 张票 = 逐模型手写 HTTP 归一化、追 API 变更" 误读了 ticket。读 11-17、26，核心交付是 recorded contract（operation/capability/请求响应/错误/usage-cost/asset）+ durable 任务（ProviderTaskRef、恢复、cancel-vs-late-success、下载重试）+ 双账 + activation 门禁 + 固定模型不跨品牌。这些是 catalog 能力/定价公式/取消语义/资产 TTL/可恢复任务的事实捕获，AI SDK provider spec 不提供；recorded contract 是合同+测试 fixture，不等于手写 HTTP client，底层用 @ai-sdk/* 还是 raw fetch 属 adapter 内实现，ticket 未规定。
3) finding 自己承认的边界吃掉其大部分价值：视频（14-17 占 4/7 张）experimental_generateVideo 是进程内长轮询、无 durable TaskRef，团队在 04-doc §8 已逐条评估并写明"SDK 内部轮询不能替代业务 durable job/task resume/资产/usage/成本/路由快照""API 明确仍是 experimental"。故视频 4 张票 90% 是 durable 外壳（finding 也说该自建），AI SDK 复用贡献极小。
4) headline 建议（把 adapter 接口 / spec 258-261 改成"对齐 AI SDK provider spec（ImageModelV4/视频模型接口）"）技术上站不住：AI SDK 图像接口是同步 request/response、视频是 experimental 内部轮询，都无法表达 submit→ProviderTaskRef→poll/webhook→cancel-intent→late-success→persistAsset→双账 这套 durable 合同（04-doc §8.1 明列）。把业务依赖的 Port 对齐到同步/experimental 的 spec，等于把承载营收的 P1 must-have 媒体路径耦合到一个不能表达可恢复任务、供应商随时可改的 experimental API——可行性倒退。
5) 对覆盖度的陈述被夸大/与已锁决策冲突：即便采信 AI Gateway 2026-07 一等暴露 seedance/kling/veo/grok，团队 08-doc §4.2 已记录 Vercel AI Gateway"缺 Seedream 5.0 Pro、多个媒体型号单 endpoint 无 fallback、BYOK 默认可能回落 system credential"；拓扑已锁定 Direct-first（issue 18 line 19），聚合商/AI Gateway 为 conditional 逃生/补缺（issue 18 Conditional #2）；国内落地（ADR-0005）不能用 US AI Gateway。故"验证期用 Vercel AI Gateway 模型 ID"作主路径与已锁决策相悖。"Seedance 2.0 零加价"也不消除双账：Seedance 按像素×秒×token、Kling 按积分/秒、Veo 按 USD/秒，账本须存原币/原公式/价目版本（04-doc line 16/196）。
6) "统一 t2v/i2v/duration/aspectRatio/generateAudio 参数 = 免费归一化" 把泄漏抽象当真归一化。04-doc §3/§4/line 71 记录四家能力/取消/音频/分辨率合同差异极大（Grok1.5 仅 I2V、Veo Lite 无参考/延长、Seedance running 不可取消而 Kling/Grok 实时无 cancel、Kling Turbo 与 3.0/Omni 两套 task schema、资产 TTL 24h/30d/1h/2d），"15秒/4K/有声/多镜头不能做成供应方级全局开关""不能用统一 audio=true/false 假装能力等价"——这些正是退款/双账/cancel 状态机正确性的输入，必须逐模型捕获。

三、有效残余（因此 WEAKENED 而非 REFUTED）：在 Direct-first 拓扑下，对 OpenAI/Google/xAI/fal 覆盖到的模型，adapter 内层复用官方 @ai-sdk/*（或 fal/OpenRouter SDK）做请求/响应/HTTP plumbing，确实比裸 fetch 省事且随生态更新——真实但有限的效率点；且 spec 258 行措辞虽只约束业务层，却易被实施 agent 误读为"adapter 也不许用"，值得澄清。finding 也正确指出 durable 外壳必须自建、experimental_generateVideo 不给可恢复 TaskRef，与计划一致。

综上：核心诊断（"边界画错，把归一化与 durable 外壳捆进同一 Port+7 adapter"）建立在误读之上，headline 建议有害，方向被夸大——但有一个狭窄可执行的正确点，判 WEAKENED。

**修正后建议：** 不要重塑 ProviderExecutionPort 去"对齐 AI SDK provider spec（ImageModelV4/experimental_generateVideo）"：这两者是同步/experimental 抽象，无法表达可恢复媒体任务合同（submit→ProviderTaskRef→poll/webhook→cancel-intent→persistAsset→双账，见 04-doc §8.1），把营收级 P1 must-have 耦合到 experimental API 是可行性倒退。同样保留 tickets 10-17、26 的 per-model recorded contract——它们捕获 catalog 能力、定价公式、取消语义、资产 TTL 等 AI SDK 统一参数刻意抹平、而双账/退款/cancel 状态机依赖的事实。

真正可采纳的狭窄收缩（把 finding 降级为一条实现层备注）：
1) 在 spec §8 明确"业务模块不 import provider SDK"仅约束业务层；adapter 层可、且对 OpenAI/Google/xAI/fal 覆盖到的模型优先复用官方 @ai-sdk/*（或 fal/OpenRouter SDK）作为 adapter 内的请求/响应/HTTP 归一化实现，避免裸写 fetch。这是 ProviderExecutionPort 后的实现选择，不改变 Port 契约。
2) 把 Vercel AI Gateway / experimental_generateVideo 继续保留为 ProviderExecutionPort 后的 conditional/replaceable adapter（与 issue 18、08-doc 一致），不升为验证期主路径，也不用于国内落地（ADR-0005 禁 US AI Gateway；且 08-doc 已记 AI Gateway 缺 Seedream 5.0 Pro、媒体单 endpoint、BYOK 可能回落）。
3) 由 ticket 09（RouteSnapshot/路由）在锁定供应组合时，顺带记录每个 Direct/Managed Adapter 的"内层调用手段"（@ai-sdk/* vs fal SDK vs raw HTTP），作为实现指引而非 Port 变更。
如此既拿到"复用生态 plumbing"的收益，又不牺牲 durable 边界、Direct-first 拓扑与国内落地约束。

### [REFUTED] F2-durable-execution-runner (P1, ai-native-trends) — 自建 ~400 行 step-runner + 仅 pg-boss，将为"生成任务多步状态机"重造半个 durable execution 引擎——AI SDK 7 已内置

**详情：** ADR-0007（2026-07-07）决定自写 ~300-500 行 step-runner、durability 交 Postgres durable_jobs，理由是"framework 从没承担难的部分"——但此判断写于 AI SDK 7 发布前。AI SDK 7（你已 pin 的同一依赖）内置 @ai-sdk/workflow + WorkflowAgent：durable、可恢复、跨进程重启/部署/中断/延迟审批存活，支持跨 step 的 provider 模型序列化。同时 2026 durable execution 已跨入主流（Vercel Workflow DevKit、Cloudflare Workflows GA、AWS Durable Functions、Inngest/Temporal/DBOS），业界共识是"它就是生产级 AI agent 缺的那一层"。你的 GenerationJob→ProviderAttempt→ProviderTaskRef→poll/webhook→Asset→双账→recover（ticket 08）恰是一个"有记忆的多步工作流"。社区对 pg-boss/Graphile 这类纯队列的一致评价是：单单元任务很好，但一旦任务有记忆，纯队列就把复杂度泄漏进应用代码——你会自加状态表、重试表、webhook 关联、"这步跑过没"判断，最后手搓半个 durable execution 引擎。ticket 05 只上 pg-boss，就是在给这条最重的媒体链手搓那半个引擎。注意：这不是你在 §11/Out-of-Scope 已合理推迟的"Mastra/Inngest 新基建"问题（那是引入新进程），而是"更充分使用你已装进来的 AI SDK 7"。

**原建议：** 在 ADR-0007 的 Mastra re-entry 分析里新增一等候选：AI SDK 7 原生 @ai-sdk/workflow / WorkflowAgent 作为 ContentWorkflowRunner 实现（零新基建、同一 SDK）。开工前用 1 个 spike（就用 ticket 08 的视频 submit→poll→recover 真实流）对比自建 step-runner vs @ai-sdk/workflow，验收看重启恢复、webhook 幂等、延迟审批。若覆盖，则 tickets 05/08 的自建编排收缩为"pg-boss 只做认领/调度 + WorkflowAgent 管步态"，避免把状态机/webhook 关联/幂等重造一遍。不改你"durability in Postgres、单 Node 服务"的大方向。

**证据：** /Users/bin/Desktop/开发/内容无人区/美业内容2/docs/adr/0007-agent-runtime-ai-sdk-first.md:12（自建 ~300-500 行 step-runner）、:7（"durability was already assigned to Postgres durable_jobs, so the framework was never carrying the hard part"）; ticket 08（Job/Attempt/ProviderTaskRef/poll/webhook/Asset/双账/recover 全自建）; https://vercel.com/blog/ai-sdk-7 （@ai-sdk/workflow+WorkflowAgent：durable, resumable, survives process restarts/deploys/interruptions/delayed approvals）; https://www.inngest.com/blog/durable-execution-key-to-harnessing-ai-agents （纯队列在有状态工作流下泄漏复杂度 / durable execution 是 2026 生产 AI agent 缺的那层）

**替代方案：** AI SDK 7 @ai-sdk/workflow / WorkflowAgent（同 SDK、零新基建，首选评估）；若需独立引擎再看 Inngest/Temporal/DBOS/Restate（那才是 §11 证据门后的新基建）。理由：durability 已是你所选 SDK 的一等能力，自建 step-runner 是在重造它。

#### 验证意见 [REFUTED]

按 feasibility 视角逐条核实后，finding 的承重前提被仓库地面事实证伪，其 P1 定级与"这不是新基建、而是更充分用你已装的 AI SDK 7"这一关键差异化立论随之坍塌。

一、引用文字属实但只是外壳。ADR-0007:12（~300-500 行自建 step-runner）、:7（"framework was never carrying the hard part"，因 durability 已交 Postgres durable_jobs）、ticket 08 流程（spec:173/178/191/204 的 GenerationJob/ProviderAttempt/ProviderTaskRef/回调轮询/Asset/双账/recover）均如所述，这部分无误。

二、核心技术前提为假（决定性硬伤）。我直接检查项目 pin 的 ai@7.0.19（node_modules/.pnpm/ai@7.0.19_zod@4.3.6/.../dist/index.d.ts:8954 的完整导出）：不存在 WorkflowAgent、不存在 @ai-sdk/workflow 包、没有任何 durable/checkpoint/resume/WorkflowAgent 原语。AI SDK 7 的 agent 原语是 ToolLoopAgent（内存态工具调用循环，别名 Experimental_Agent），其 ToolApproval*（24 处）是 in-band 的 UIMessage 工具审批，并非跨进程/跨部署可恢复的持久任务引擎。因此"你已 pin 的同一依赖内置 @ai-sdk/workflow + WorkflowAgent：durable、可恢复、跨进程重启存活"与实际安装物直接冲突。

三、该能力实际归属独立框架=新基建，且 finding 自相矛盾。仓库里唯一的 @workflow 是 @workflow/serde@4.1.0，它是 @ai-sdk/gateway 的传递性叶子依赖（package.json 自述仅"Workflow SDK 自定义类序列化符号"，repository=github.com/vercel/workflow.git），即 Vercel Workflow DevKit——一个需要编译指令(use workflow)+运行时的独立框架。这恰恰是 finding 自己在"§11 证据门后的新基建"里与 Cloudflare Workflows/Temporal/DBOS/Inngest 并列点名的那个 Vercel Workflow DevKit。finding 一边把它归入待推迟的新基建，一边又声称同一 durable 能力"已装进你的 AI SDK 7、零新基建"，两处说法互斥。采用它=引入新框架+新运行时=正是 spec Out-of-Scope(372/288) 已用"真实瓶颈+对照 PoC+可回滚"证据门推迟的东西。

四、"写于 AI SDK 7 发布前"的框定也不实。ADR-0007:19 明确写"implementation version pinning follows the repository lockfile (currently ai 7.x) without changing the Runtime Port decision"——该 ADR 的 consequences 段是在已知 7.x 的前提下更新的，并显式声明 7.x 不改变 Runtime Port 决策。

五、建议实质已被现规划覆盖，非 P1 缺口。ADR-0007:15 已定 re-entry trigger（多分支/子工作流/human-in-the-loop）并给出 Runtime Port ContentWorkflowRunner，换实现"days, not weeks"；spec:145 故事 89 专门建可观测性来判断"是否需要 Mastra 或独立 Agent Service"；ADR-0008:54 已把视频流水线定为"ADR-0007 Mastra 触发条件的首次真实检验"。finding 的"新增一等候选+开工前 spike"在结构上已由 Runtime Port + 证据门 re-entry 触发器涵盖。

六、"手搓半个 durable 引擎"被夸大。spec:256/332 明确 pg-boss 复用于通用持久部分（认领/续租/退避/延迟/cron/DLQ/redrive/进程重启恢复，且"禁止先自研 polling、cron、retry、DLQ、dashboard"）；spec:257 明确"队列只负责可靠调度；Product Core 拥有业务 Job、Attempt、幂等、结算、撤权和审计"。也就是说：通用可恢复部分已复用 pg-boss（非手搓）；而 Job/Attempt/ProviderTaskRef/双账/webhook 关联/recover 是绑定具体供应商 API 的领域状态机——任何 durable 引擎（Workflow DevKit/Temporal/@ai-sdk/workflow）都不会替你免费生成这段，采用它们你仍要手写同样的领域步骤。finding 关于"durable 引擎能吸收状态表/重试/webhook 关联/幂等"的收益判断因此高估。

综上：finding 的决定性技术证据（@ai-sdk/workflow + WorkflowAgent 内置于所 pin 的 AI SDK 7、零新基建）经对实际 lockfile 与类型声明核实为假；其自我差异化（区别于已推迟的新基建）自相矛盾；残余的"durable execution 值得作为 re-entry 候选"直觉合理但已被现有 Runtime Port + 证据门覆盖。属证据未被正确解读的硬伤，给 REFUTED。

**修正后建议：** 不设 P1、不要求开工前 spike、不重塑 ticket 05/08。若要吸收其唯一合理残余，仅需一处文档级微调：在 ADR-0007:15 现有 Mastra re-entry 候选清单里，把 Vercel Workflow DevKit（以及 Temporal/DBOS）与 Mastra/Inngest 并列登记为同一 Runtime Port 之后的可选 durable-execution 实现，并同时更正 finding 的事实错误——durable 工作流不在所 pin 的 ai@7.0.19 内（该版仅有 ToolLoopAgent + in-band ToolApproval，无 WorkflowAgent/@ai-sdk/workflow），它属于独立框架、须走 spec Out-of-Scope(372/288) 既有的"真实瓶颈+对照 PoC+可回滚"证据门，而非"零新基建、同一 SDK"。触发条件仍沿用现有：视频流水线真正暴露多分支/子工作流/延迟审批复杂度时（ADR-0008:54 已指定其为首个检验点）再做对照 PoC。不改"durability in Postgres、单 Node 服务、pg-boss 主实现"的大方向。

### [REFUTED] F3-gateway-premature-mismatch (P1, ai-native-trends) — Bifrost 主 / LiteLLM 对照的自托管执行网关 PoC（ticket 20）既错配旗舰媒体路径，又违反你自己的 §11 证据门

**详情：** ticket 20 把 Bifrost 定为 ProviderExecutionPort 后的"主"执行网关、P1 must-have。两个问题：(1) 能力错配——2026 评测里 Bifrost 是面向性能/治理/agent 的文本 LLM + MCP + agents 网关，目录窄（15-23 家 vs LiteLLM 140+），检索"未发现其图片/视频生成能力"；而你的旗舰恰是视频/图片（Seedance/Kling/Veo/Seedream，ADR-0008 保 8）。真正需要这个 Port 的媒体链根本走不了 Bifrost，它只能覆盖文本副驾这条次要路径。(2) 时机与自洽——你在 §11 立了"无真实瓶颈+对照 PoC 改善+可回滚三条同时成立才重开基建"的证据门，却把一个自托管网关 PoC 设成 P1 must-have。多 provider 路由（文本+媒体）在 2026 已被更成熟方案零运维解决：Vercel AI Gateway（Seedance 2.0 零加价、原生覆盖 Kling/Veo/Grok/Wan）、OpenRouter（341 文本/32 图/14 视频、BYOK 前百万请求免费后 5%）、或 AI SDK 自带 customProvider+provider registry（自托管、无地域约束）。另外 LiteLLM 2026-03 出过供应链投毒（v1.82.7/1.82.8 PyPI 被污染），自托管它要额外权衡。

**原建议：** (1) 把 ticket 20 从 P1 must-have 降为 §11 证据门后的候选，写明触发点（如自托管毛利/合规要求真实出现时）；(2) 若 P1 现在就需多 provider 路由，用 AI SDK provider registry / customProvider 承担（国内落地期为豆包/即梦写薄 provider），验证期叠加 Vercel AI Gateway 作托管便利，不引入自托管网关进程；(3) 若坚持保留网关 PoC，在 ticket 20 写明"仅覆盖文本 LLM 路径，媒体走 direct/媒体能力网关"，并把 LiteLLM 固定在投毒后干净版（≥1.83.0）。

**证据：** /Users/bin/Desktop/开发/内容无人区/美业内容2/.scratch/p1-implementation/issues/20-bifrost-litellm-isolated-poc.md（Bifrost 主、LiteLLM 对照、P1 must-have）; /Users/bin/Desktop/开发/内容无人区/美业内容2/docs/specs/beauty-content-agent-p1-spec.md:288（§11 证据门三条件）、:261（Bifrost 主 must-have / 生产 conditional）; https://www.getmaxim.ai/articles/openrouter-vs-litellm-vs-bifrost-ai-gateway-comparison/ （Bifrost 目录窄、无媒体；OpenRouter 多模态领先）; https://techsy.io/en/blog/best-llm-gateway-tools （LiteLLM 2026-03 供应链投毒 v1.82.7/1.82.8、干净版 1.83.0）; https://vercel.com/ai-gateway/models/seedance-2.0 （AI Gateway 覆盖 Seedance 2.0 零加价）

**替代方案：** Vercel AI Gateway（托管、媒体零加价，验证期）/ OpenRouter（托管、多模态最全）/ AI SDK customProvider+provider registry（自托管、地域中立）。理由：文本+媒体的多 provider 路由是已解决问题，自托管 Bifrost 在 pre-PMF 阶段是纯运维负担且不支持你的旗舰媒体。

#### 验证意见 [REFUTED]

证据的"存在性"为真，但"解读"在两处核心命题上都是硬伤，且主建议在本项目的落地约束下不可行。

一、命题(1)"能力错配"含事实错误 + 架构误读。
- 事实错误：finding 断言 Bifrost"未发现其图片/视频生成能力""文本 LLM 网关"。但 Bifrost 官方 provider 文档明确列出统一的 Image Generation(/v1/images/generations)、Image Edit、Image Variation API；GitHub 标注"1000+ models support"。finding 引的是二手对比文（getmaxim 比较文的 agent/文本视角），却与一手 provider 文档冲突。图片这半条旗舰链（GPT Image 2 / Nano Banana / Seedream，OpenAI 兼容口径）本就能过 Bifrost；只有 video 供应确实未核实到。"目录窄 15-23 家"混淆了 provider 数与 model 数（provider 少于 LiteLLM 属实，但据此推出"纯文本无媒体"是错的）。
- 架构误读（更关键）：ticket 20 line 3 与 spec 261 的"Bifrost 主、LiteLLM 对照"修饰的是"隔离 PoC"——指 PoC bake-off 里的首选候选 vs 对照候选，不是"生产主执行网关"。生产执行走 direct adapters（ticket 10-17），媒体旗舰（视频 14-17、图片 11-13）走各自 direct adapter，根本不依赖 Bifrost；ticket 20 line 13 明写"PoC 默认不承载生产流量"。finding 整个"旗舰媒体走不了 Bifrost 所以错配"的论证，建立在把"主候选"读成"主生产路径"之上，spec 从未这么说。而"媒体支持"本就是 ticket 20 line 12 列出的对照维度之一——即便 Bifrost 缺视频，也是 PoC 要产出的结论，不是盲区。

二、命题(2)"违反 §11"是误读。§11(line 288)的证据门只约束一个枚举清单：Mastra / Redis-BullMQ-Inngest / 独立 Agent-Worker 服务 / 分库 / pgvector——不含网关。且网关的"生产晋升"本身就是 conditional（spec 261/381、ticket 20 line 13），即已被证据门约束；P1 must-have 的只是 fixture 化的 PoC/端口验证。finding 把"must-have PoC"等同于"must-have 生产基建"，属类目混淆。恰恰相反，这个对照 PoC 正是 §11 所要求的"对照 PoC 明显改善"证据的生成机制，是证据门方法论的落实而非违反。

三、主建议在 2026-07 生态 + 本项目落地约束下不可行——这是最重的 feasibility 硬伤。
- ADR-0005 落地期硬约束：迁到国内云、默认路由切已备案国产模型、境外模型仅内部研发、且客户 PII/人脸素材永不出境到境外模型 API。finding 力推的 Vercel AI Gateway / OpenRouter 都是美国托管代理：检索证实 OpenRouter"对中国大陆访问未优化，需代理、缺微信/支付宝/RMB"，其在华用途恰是反向穿透访问被限的境外模型——与合规的境内生产完全相反；Vercel AI Gateway 虽已覆盖 Seedance 2.0/Kling/字节等，但仍是境外托管面，落地期境内云生产不能把流量绕美。检索还点出业界通行做法：境内直连火山引擎（低延迟）+ 托管网关只接境外研发模型——正是本项目"direct adapter + 可选网关"已做的事。
- 自托管网关恰是落地期刚需：Bifrost 官方定位"面向受监管行业，支持 air-gapped / VPC / on-prem，自有云内部署、无第三方代理、按 list 价直付、零加价"——正对齐国内云内统一路由/治理/成本/毛利。finding 把自托管一律贬为"pre-PMF 纯运维负担"，无视落地期（1-3 月备案前置期）需要在验证期就用 portability discipline 把迁移做便宜（ADR-0005 line 12），即用户自己"护栏须服务平移便宜/信号干净"的既定哲学。把 PoC 推迟到 trigger 反而废掉这条护栏。
- 栈错配：finding 荐 Vercel AI Gateway，但项目是 Cloudflare Workers 壳且 ADR-0005/0007 已选 CF AI Gateway 作可选托管层。
- 类目错误：finding 说"多 provider 路由已被 AI SDK provider registry 解决"——registry 确已在项目内（ticket 10 + ADR-0007），但它是进程内路由逻辑，不等于带虚拟密钥/RBAC/预算/统一脱敏/可换可回滚执行面的自托管执行网关。PoC 验的是后者，二者不同层。
- 自我拆台：finding 举的 LiteLLM 2026-03 投毒证据，反而支持项目把 Go 单二进制的 Bifrost 定为"主"、把 Python 依赖面更大的 LiteLLM 定为"对照"。

综合：两条核心命题分别含事实错误与误读，主建议对 China-landing 生产不可行，故 REFUTED。仅两处外围小 kernel 成立（见 revised_recommendation），但不足以救回 finding 的论点。

**修正后建议：** 保留 ticket 20 的 Bifrost 主 / LiteLLM 对照 PoC 与其 P1 must-have 定位不变（它是 ProviderExecutionPort 边界验证 + 落地期自托管网关的证据生成器，生产晋升已 conditional，且 fixture 化成本有界）。只吸收 finding 的两处外围合理点：(1) 在 ticket 20 显式写明覆盖范围——文本 LLM 与图片可经网关评估，视频（Seedance/Kling/Grok/Veo）在 Bifrost 侧供应未核实，视频默认走 direct adapter（14-17），把"video 经网关"标为 PoC 的开放结论而非前提；(2) 若 LiteLLM 2026-03 投毒（v1.82.7/1.82.8）属实，在对照候选处固定干净版 ≥1.83.0 并记依赖来源，作为常规供应链卫生。不采纳"降为 §11 门后候选"或"改用 Vercel AI Gateway/OpenRouter 承担"的主建议：前者与落地期 portability discipline 冲突；后者是境外托管代理，无法满足 ADR-0005 的境内云 + 备案国产模型 + PII 不出境约束，且与项目已选的 CF 栈错配。验证期的托管便利仍用项目既定的 CF AI Gateway，而非 Vercel。

### [WEAKENED] code-reality-1 (P1, code-reality) — 生产文案路径是模板桩，真 AI 孤立在 diagnostics 原型；无票认领"文案生成质量"，模型目录票解决不了"效果不好"

**详情：** 生产 generate_copy 用的是 DeterministicCopyProvider——把 hook 拼上固定后缀（'真实门店版/熟客推荐版/同城到店版'）加 mad-libs 变量替换，产出三条几乎一样的模板文案（copy-provider.ts:49-58）。main.ts:70 构造 ProductService 只传三个参数，copyProviders 落到默认桩（product-service.ts:498-499），全仓没有任何 AI 版 CopyProvider。唯一的真 AI 是 AiSdkDiagnosticRuntime（Vercel AI SDK generateText+Output.object，runtime.ts:75-112），却只挂在 /v1/diagnostics 这个 SSE 原型端点上，产出单个 {title,hook,body}，与产品真正的三候选 ContentItem 模型完全脱节（server.ts:487-518）。也就是说 P0 商户从未收到真 AI 生成的门店文案——这是"效果不好"最可能的代码级根因。而 P1 的 32 张票里，模型相关的 07/10-20 全在做"目录/选型/路由/双账/BYOK"，即让用户在 GPT/Claude/Gemini/Seedream/Kling/Veo 之间选；没有任何一张票认领 generate_copy 的"生成质量"（prompt 工程、few-shot、brandVoice/门店事实 grounding、美业口语话术）。若团队默认"给用户更多模型可选=内容变好"，那 ~14 张模型票的巨大投入会打偏，P1 极可能带着同样的模板质感上线并返工——这就是错配的 P0 级风险，只是路径上补一张票即可化解，故记 P1。

**原建议：** 在 MAP.md/issues 新增一张与 07/10 并列但独立的 ContentWorkflowRunner 质量票：把 copy-provider.ts 的 CopyProvider 端口接到 runtime.ts 的 AiSdkDiagnosticRuntime 同类实现（二者已是同一"AI SDK 置于 Runtime Port 后"范式，正好对齐 spec §258），并在 main.ts:70 注入真 provider 替换默认桩。在 spec §8 component-reuse 明确 generate_copy 的质量交付物是 prompt/few-shot/brandVoice-grounding，而非"模型选择"；把 /v1/diagnostics 原型正式收编或删除，避免两套内容栈长期并存。

**证据：** copy-provider.ts:49-58（模板桩 generate）；product-service.ts:498-499（默认 copyProviders）；main.ts:70-74（生产未注入真 provider）；runtime.ts:75-112（真 AI 仅在 diagnostics）；server.ts:487-518（diagnostics 原型路径）

**替代方案：** 复用现成的 AiSdkDiagnosticRuntime + AI SDK Output.object/generateObject 结构化输出，把 generate_copy 接到同一 ContentWorkflowRunner；质量靠 prompt 模板库+few-shot+门店事实注入（P1 已把 pgvector 推迟，故先做话术模板与 brandVoice grounding，不引 RAG）。

#### 验证意见 [WEAKENED]

证据全部属实且解读准确，我无法反驳其事实内核，但 finding 存在一处夸大和一处建议硬伤，按评审规则应判 WEAKENED（方向对、建议需修正）。

一、事实内核已逐条核实为真（甚至比 finding 说得更强）：
- copy-provider.ts:49-58 确为模板桩，且三候选的 body/topics/conversionHook/assetOrder 完全相同，仅 title 后缀不同——"几乎一样"是保守说法。
- main.ts:70-74 只传三参、product-service.ts:498-499 落默认桩；全仓只有 DeterministicCopyProvider 实现 CopyProvider 端口，无任何 AI 版。
- 真 AI（AiSdkDiagnosticRuntime, runtime.ts:75-112）只挂 /v1/diagnostics，产出单个 {title,hook,body}（contracts:26-30），与三候选 ContentItem 脱节；git commit "prove runtime and AI execution path" + P0 spike 清单佐证它就是原型。
- 32 张票里 grep prompt/few-shot/grounding/话术/brandVoice/门店事实=0；CopyProvider/generate_copy/ContentWorkflowRunner 在任何票中均不出现；ticket 02 只把既有（桩）文案旅程迁到关系表，ticket 08 的 Generation Runtime 明确是"媒体"闭环。所以"P1 无票认领 generate_copy 真实化+质量"成立。
- 额外佐证 finding：copy 连 diagnostics 那种 deterministic/gateway 环境开关都没有（无 copyProviderFromEnv），桩是唯一实现，比 finding 描述的还更死。

二、夸大之处（需下调）："若团队默认更多模型=内容变好，那~14张模型票的巨大投入会打偏"。这是 either/or 误框。模型供应面（目录/适配器/路由/用量·成本双账/BYOK/RouteSnapshot）本就是 P0 主打的图片/视频成片（p0-spec:192 明确视频成片是主打）、计费和透明度的必需基建，且"换更好的模型"对同一 prompt 的文案质量确有正向作用。它对文案质量是"不充分"而非"打偏/浪费"——正确关系是 both/and。把它描述成投入方向错误，可能误导把模型票降级，反而有害。

三、建议硬伤（需修正）：finding 的落地建议"把 CopyProvider 端口接到 AiSdkDiagnosticRuntime 同类实现、在 main.ts:70 注入、与 07/10 并列"，字面执行会制造第三条直连 AI SDK 的路径（桩CopyProvider→AiSdkCopyProvider），绕开 P1 正在建的 ProviderExecutionPort/模型目录/RouteSnapshot/双账（spec §261、ticket 07-10），使文案拿不到模型选择、用量成本、BYOK、审计——恰恰重演它自己警告的"两套内容栈"。且 generate_copy 是同步返三候选，而 P1 执行面是围绕异步 GenerationJob（submit→poll→Asset）搭的，直接克隆 diagnostics runtime 掩盖了这块真实的集成设计。正确做法是让文案消费同一 P1 模型面，新票只专属"质量层"，并按依赖排在 07/10 之后而非并列。

技术可行性上建议本身没问题：AI SDK Output.object/generateObject 出三候选结构化中文输出，P0 已通过 generateObject spike + diagnostics 证明可行，推迟 RAG/pgvector 也与 spec §342/§372 一致。故不构成 REFUTED，但因"夸大+建议需修正"，判 WEAKENED。

**修正后建议：** 保留 finding 的核心结论（生产文案=桩、真 AI 孤立于 diagnostics、P1 无票认领 generate_copy 的真实化与质量），但按两点修正：

1) 纠正框架，不贬低模型票：模型供应票（07/10-20）是图片/视频成片（P0 主打）、双账计费、BYOK、模型透明度的必需基建，也是文案变"真"的载体，属"必要但不充分"，不是"打偏"。文案质量与模型供应是 both/and。

2) 拆成"接线"与"质量"两层，并纠正架构与排序：
   - 接线不要克隆 AiSdkDiagnosticRuntime 成独立 CopyProvider 直挂 main.ts（那会绕过 P1 模型目录/ProviderExecutionPort/RouteSnapshot/双账，制造第三条 AI 路径、重演"两套内容栈"）。应让 generate_copy 走与媒体同一套 ProviderExecutionPort/模型目录，复用其模型选择、RouteSnapshot、Product Usage/Provider Cost 双账与审计；同步返三候选的形态需要一次真实集成设计（同步命令如何消费为异步 GenerationJob 设计的执行面），这块工作量要显式认领。此票 Blocked by 07（目录+执行）与 10（真 LLM 适配器），排在其后而非"与 07/10 并列"。
   - 质量层才是真正无主、要新开的交付物：prompt 模板库 + few-shot + brandVoice/门店事实 grounding + 美业口语话术 + 三候选差异化（现桩三条 body 完全相同，须保证候选间实质差异）。P1 已推迟 pgvector，先做话术模板与门店事实注入、不引 RAG（与 spec §342/§372 一致）。
   - 顺带收编或删除 /v1/diagnostics 原型，避免长期两套内容栈；并给 copy 补上 diagnostics 已有的 deterministic/gateway 环境开关（当前 copy 无 copyProviderFromEnv，桩为唯一实现），使真 provider 可配置切换、fake 合同测试可保留。

### [WEAKENED] code-reality-2 (P1, code-reality) — 整份 ProductState god-object 底座（单行 JSONB + 每命令复制进幂等表 + provider 调用在 advisory lock 内 + 只有一个整份查询）被迁移票低估

**详情：** 这是对基线一致性复核 item 4（已知 JSONB 缺口）的加深，指出三处票里没写、会在迁移期返工的具体债务。(a) 每条命令把整份 state 通过 saveIdempotent 复制进 product_command_results（execute 里 result={state,output}→success→saveIdempotent，product-service.ts:602-611；postgres JSON.stringify 进 jsonb，postgres-repository.ts:116-127）：做过 500 条命令的 workspace 就有 500 份不断增大的整份状态副本，写放大+无界膨胀，关系化后根本无法把整个关系世界塞进每命令一份 jsonb。(b) 幂等只按 (workspace_id, idempotency_key) 命中（loadIdempotent 无 payload hash，execute:560 直接 return existing），同 key 不同 payload 会静默返回旧结果——违反 spec §242"canonical payload hash，同 key 不同 payload 返回 conflict"，是正确性缺口。(c) copy 的 provider.generate 发生在 withWorkspaceLock 的 BEGIN...COMMIT + pg_advisory_xact_lock 事务内（execute:559→apply:573→generate_copy:876），直接违反 P1 US85/§257"外部调用在短事务之外"；讽刺的是视频路径已经做对了——重活 render 在 server.ts:322-355 的短事务之间编排。(d) 读侧只有 bootstrap 返回整份 state（server.ts:222-227 的 GET /state），而 spec §232 定义了约 10 个 granular 查询、ticket 31 明确"不把完整 workspace state 拉到前端过滤"。票 01"扩展现有 seam"对命令接口是准确的，但对底座是误导：01/02/03/06 只说"迁事实到关系表"，没有一条验收项点名命令结果存储、payload-hash 幂等、查询投影或 lock-holds-provider 这条自相矛盾。

**原建议：** 在 ticket 06（cut-over）或新增子票的验收项补四条：product_command_results 增 canonical payload_hash 列且只存 output 不存整份 state（对齐 §242）；把 generate_copy 的 provider.generate 移出 withWorkspaceLock，以 pg-boss job（票 05 已选型）异步执行、回写走短事务，范本就是 server.ts 视频渲染路径；读侧按 §232 建 granular projection 查询替换 GET /state 整份返回；ticket 01 的措辞从"扩展现有"改为"保留命令 seam、替换持久底座"，避免团队以为能把 6 个新模块 bolt 到 blob 上。

**证据：** product-service.ts:602-611 + postgres-repository.ts:116-127（整份 state 进幂等表）；execute:559-561 无 payload hash；product-service.ts:876（provider 在 lock 内）vs server.ts:322-355（视频 render 在锁外，正确范本）；server.ts:222-227（唯一整份查询）；spec §242 / US85 / §232

**替代方案：** 幂等按请求指纹（payload hash）+只存 output 是标准做法（Stripe 式 idempotency）；provider 异步化直接复用票 05 的 pg-boss；读侧 CQRS-lite（关系表+定向查询），无需引入新框架。

#### 验证意见 [WEAKENED]

代码证据全部属实、引用精确，这是 finding 的坚实骨架，不能 REFUTED：(a) product-service.ts:603 `result={state,output}` → :605-610 `saveIdempotent(success)` → postgres-repository.ts:125 `JSON.stringify` 把整份 state 写进 product_command_results.result（jsonb），且 `INSERT…ON CONFLICT DO NOTHING`、无 TTL/清理，确属写放大+无界膨胀（product_states 还经 save 再存一份全量）；(b) loadIdempotent 仅按 (workspace_id, key)、execute:560-561 直接 return existing，无 payload hash，属实；(c) execute:559 withWorkspaceLock 在 postgres-repository.ts:43-44 做 BEGIN+pg_advisory_xact_lock，apply:573→generate_copy:876 的 provider.generate 确在锁内，而视频路径 server.ts:348 renderer 在短事务之间、锁外，两半都对；(d) server.ts:222-227 GET /state 整份返回且是唯一读端点（实际上每个 POST /commands 也经 execute 返回整份 state，比 finding 说的更严重）。spec 引用核对：§242=line242 精确、US85=line141 精确、ticket31:11 精确、§232=line232 约十个接口组大体成立、§257 略偏（line257 讲队列组件，实质在 US85+test line334）。

判 WEAKENED 而非 CONFIRMED 的原因：finding 的复合论断"01/02/03/06 没有一条验收项点名这四条债务"被夸大——只有 (a) 命令结果整份 state 副本在任何票/spec 章节都真正无人认领，是干净且最有价值的一击；但 (c) lock-holds-provider 已被 ticket 05:12「外部调用和长任务不持有 workspace 数据库事务或 advisory lock」+ 测试 §334 明确点名（finding 自己还把 05 当修复载体）；(d) 服务端 granular 查询已被 ticket 31:11、21:10 与接口 §232 点名（finding 自己引用了 31）；(b) payload-hash+conflict 已在 spec §242 与测试决策 §302 强制。即四条里三条在 finding 自己引用或忽略的地方已被覆盖，把"1 处干净缺口"渲染成"四处全无人写"属稀释式夸大。建议侧也需修正：#2「以 pg-boss 异步」比最小修复重——照搬视频路径的短事务编排（短锁内 reserve/读输入 → 锁外 provider.generate → 短锁内 commit/refund，ticket 04 的 append-only reserve/commit/refund 账本正好支撑）即满足 US85/§334，且 US45 的持久任务要求只针对图片/视频而非文案，不必把文案生成改成客户端异步；#4「改写 01 措辞」基本冗余，因为 01 本就是命令 seam（正确保留），02/03/06 已是底座替换，恰是 finding 自己主张的"保留 seam、替换底座"分工。可行性上四项修复在 2026-07 都是标准且低成本，无生态阻碍。综合：方向对、代码债真实（尤其 (a)），但覆盖面论断夸大、两条建议需修正，符合 WEAKENED。

**修正后建议：** 保留 finding 的代码事实与总方向，但按下述修正采纳：(1) 把 (a) 作为唯一真正无人认领的头号缺口——在 ticket 06（cut-over）或新增子票加一条验收项：关系化后 product_command_results 只存小体量 `output` + 一列 canonical payload_hash，显式重定义幂等结果契约（不再快照整份 state）；这是 spec 与所有票都未覆盖的点，值得单列。(2) (b) 不要说成"未规范"——spec §242 + 测试 §302 已强制 payload-hash 与 conflict；真正的动作是把 ticket 01:4 里泛化的"幂等"收紧为显式引用 §242，确保按 §302 落地"同 key 不同 payload 返回 conflict"的 contract test，属较低严重度的对齐项。(3) (c) 应承认 ticket 05:12 与测试 §334 已点名"外部调用/长任务不持有 advisory lock"；残留的合法缺口更窄——没有任何票把"现存同步 generate_copy 的 provider.generate 从锁内迁出"显式纳入范围，建议在 05 或 generate_copy 迁移范围里点名此现存路径，并注明最小修复=照搬 server.ts 视频路径的短事务编排（短锁内 reserve/读 → 锁外 provider.generate → 短锁内 commit/refund），不强制改成 pg-boss 客户端异步任务（US45 持久任务针对图片/视频，文案可保持同步返回）。(4) 撤下"改写 01 措辞"这条：01 合理地聚焦命令 seam（正确保留），02/03/06 已承担底座替换，与"保留 seam、替换底座"一致；真正要补的是 (a) 的缺失验收项，而非 01 的标题。(5) 顺带修正 (d) 的精度：不仅 GET /state 整份返回，execute 让每个 POST /commands 也回传整份 state；未被任何票认领的是"显式退休/替换 GET /state 全量返回、并在 granular 查询就位后把命令响应裁剪为 output"，可挂在 ticket 31/21 的验收项下。


## 三、P2 改进建议（未经对抗验证）

### ARCH-04 (architecture) — 两条对照 PoC（票 05 Graphile、票 20 LiteLLM）在无瓶颈证据时前置，违背 spec 自己的证据门控原则

**详情：** spec §11（第 288 行）明确'Mastra/Redis/拆服务/pgvector 只有在持续真实瓶颈+对照 PoC 明显改善+可回滚三项同时成立才能重开'，即升级要证据先行。但计划却在毫无负载/瓶颈证据的开工期就前置了两条对照轨：票 05 最后一条要求'Graphile Worker 用同一 JobPort 完成对照 PoC'，票 20 整票是 Bifrost 主/LiteLLM 对照 PoC。在验证期同时维护两套 Job Adapter 和两套 Gateway Adapter，属于计划对自己证据门控原则的自相矛盾，白白增加开工期工作量与维护面，且没有任何 queue-depth/claim-latency 基线来判断 pg-boss 是否真不够用。

**建议：** 把'对照 PoC'从开工期票里移除，改为证据触发项：票 05 只交付 pg-boss 单实现 + 采集 queue depth/oldest runnable age/claim latency 指标（spec §11 已要求这些指标），Graphile 对照留待指标显示 pg-boss 瓶颈时再开 Scope Reopen；票 20 同理，先用一个网关（LiteLLM 或 OpenRouter）跑通，第二候选对照留到成本/性能证据出现。这样与 ARCH-01 的'网关前移'一致，也让计划真正落实自己的证据门控。

**证据：** docs/specs/beauty-content-agent-p1-spec.md:288 (证据门控三条件)；issues/05 末条'Graphile Worker 用同一 JobPort 完成对照 PoC'；issues/20 全票为 Bifrost/LiteLLM 双候选对照

**替代方案：** pg-boss 单选即可（成熟、事务内入队/cron/DLQ/redrive 齐备，验证期够用）；网关单选见 ARCH-01。对照候选转为证据触发的 backlog 项。

### ARCH-05 (architecture) — 图文工作台画布切片（票 25）未点名成熟组件，建议直接锚定 Polotno 以整片去风险

**详情：** 票 25 要求'优先评估并复用成熟画布/编辑组件，记录采用/二次开发/放弃理由，不从零实现基础交互引擎'——方向正确但未点名任何候选，把一个整片（自由画布+图层增删移缩排+真实素材库+模板固定 revision+导出尺寸/字体/中文换行可验证）的选型风险留给实现期临场决策。而本产品要的正是'小红书/抖音封面、价格卡、Before/After、好评卡'这类模板化营销图编辑——市面上有专门为此打造的 SDK，提前锚定可省掉一轮选型试错，也让票 25/26（AI 生图插入画布）的接口更早稳定。

**建议：** 在 issues/25 的第一条验收里补入具名候选与推荐顺序：首选 Polotno（专为社媒/营销图模板编辑打造的 canvas SDK，自带模板、图层、导出、JSON 文档持久化，天然贴合 TemplateVersion 固定与作品 revision）；备选 tldraw（自由画布+可持久化文档）、Fabric.js/Konva（更底层，二次开发量大）。把'选型结论 + 理由'作为票 25 的首个可验证产出。

**证据：** issues/25 第1条'优先评估并复用成熟画布/编辑组件…不从零实现基础交互引擎'（未点名任何组件）；issues/26 Blocked by 25（AI 图插入画布依赖画布文档模型先稳定）

**替代方案：** Polotno（营销图模板编辑 SDK，最贴合封面/价格卡/Before-After 场景，自带导出与 JSON 文档）；tldraw（自由画布+持久化）；Fabric.js / Konva（底层 canvas，灵活但工作量大）。

### F3-chinese-fts-managed-pg (components) — 票31 中文全文检索押在托管 PG 的 FTS，但标准 to_tsvector 不分中文词、且托管 PG 常禁装分词扩展

**详情：** 票31 用『Postgres FTS/trigram』做任务/素材/内容/模板的中文检索，并用固定中文 query set 测 Recall@K 来判断是否需要向量。方向（先 FTS、pgvector 证据触发）是对的、AI 原生也克制。但有个具体坑：Postgres 默认 to_tsvector 对中文不做分词，几乎无法用；要能用得装 zhparser 或 pg_jieba 扩展，而这类 C 扩展在多数托管 PG（RDS/Cloud SQL/Neon/Supabase 视套餐）上装不了；只剩 pg_trgm 做模糊匹配（非语义、召回差）。风险后果是：Recall@K 评测可能因'没分词'而失败，被误判成'需要向量检索'从而过早引入 pgvector——而真正的短板是分词器不是向量。spec §11 的 pgvector 证据门想保持诚实，就必须先排除分词这个混淆变量。

**建议：** 票31 开工前先确认所选托管 PG 能否装 zhparser/pg_jieba：能装就装，FTS 配 CJK parser 再测 Recall@K；不能装则把 Retrieval Port 的后端换成 Meilisearch 或 Typesense（原生中文分词、可自托管、契约稳定），pgvector 仍按 spec §11 证据触发。在票31 验收项里补一条'已确认中文分词后端'，避免用未分词的 FTS 结果去论证向量必要性。

**证据：** 票31 `.scratch/p1-implementation/issues/31-postgres-search-and-retrieval-evaluation.md`「使用 Postgres FTS/trigram 与结构化标签」+「固定中文 query set 覆盖...错别字」；spec line 342/288 pgvector 证据门

**替代方案：** zhparser / pg_jieba（若托管 PG 允许扩展）；否则 Meilisearch 或 Typesense（原生 CJK 分词、轻量自托管、放在现有 Retrieval Port 后即可）；pgvector/RAG 保持证据触发，不因分词问题提前引入

### F4-secret-store-and-nango (components) — Secret Store 方向对但机制未落地；Nango 会成为第二套凭据库，需与主 Secret Store 统一

**详情：** 票18『Secret value 通过成熟 Secret Manager/KMS write-only 保存』『Nango 仅可作为 OAuth PoC Adapter』——不自写加密、用成熟件、AAD 绑 workspace（spec §4），这些都对。两点可再收紧：(1)『成熟 Secret Manager/KMS』没落到具体机制，若直接理解成自建/自运维 Vault 或 Infisical，对一个 pre-PMF 单店产品是过重的运维负担；更简洁的是信封加密——云 KMS 托管主密钥 + pgcrypto/libsodium 把密文存进已有的 Postgres，AAD 绑 workspace，零额外常驻服务。(2) Nango 持有抖音（票27/28）和飞书（票29/30）的 OAuth token 与 refresh 逻辑，实质是第二套凭据存储；如果它与主 Secret Store 各管一摊，就有两套凭据系统的生命周期/脱敏/吊销漂移风险（断连即删、脱敏审计等合同要在两处都成立）。

**建议：** 票18 把'成熟 KMS'明确为信封加密（云 KMS 主密钥 + pgcrypto/libsodium 密文入 PG，AAD=workspace），不为 pre-PMF 自建 Vault/Infisical；并在票18/27/29 里明确 Nango（选自托管 vs 云版）产出的 OAuth token 也回落进同一 Secret Store 生命周期（同一套 write-only/轮换/断连即删/脱敏审计），避免两套凭据系统。把'凭据只有一个事实源'写进票18 验收项。

**证据：** 票18 `.scratch/p1-implementation/issues/18-integration-secret-store-and-connection-core.md`「通过成熟 Secret Manager/KMS write-only 保存」「Nango 仅可作为 OAuth PoC Adapter」；spec line 260「Credential value 使用成熟 Secret Manager/KMS；Nango 只作为可替换 OAuth connection PoC」；spec §4 line 188 加密上下文绑 workspace

**替代方案：** 信封加密：云 KMS（AWS KMS / GCP KMS / CF）主密钥 + pgcrypto/libsodium 密文入现有 PG，AAD=workspace——比自运维 Vault/Infisical 简洁；OAuth：Nango（自托管统一抖音+飞书 token 刷新）可用，但须与主 Secret Store 同一生命周期，别让它成为独立凭据源

### F4-mcp-vendoring-apps (ai-native-trends) — 飞书 MCP 接入设计扎实，但缺 2026 生产最佳实践：vendoring 工具 schema 防漂移/注入，及 MCP Apps/Tasks 新标准

**详情：** tickets 29-30 的飞书 MCP 设计在 2026 语境下大方向正确（官方 remote Streamable HTTP、UAT 身份、allowed-tools、单工具 403 局部降级、写操作不盲重投、断开即删凭据）。两个可加固点：(1) Schema 漂移与提示注入——MCP 工具的名称/描述/参数 schema 会进入 agent 的 prompt 且可能无预警变化，这既是你 Further Notes 里担心的"飞书工具 schema 可能变化"，也是注入风险面。Vercel 生产最佳实践是 vendoring：用 mcp-to-ai-sdk 把工具定义下载、生成进你仓库并版本化，运行时仍调用原 MCP server，但 schema/描述在 repo 里评审可控。这比你现在"后台自动发现→兼容性检查→统一发布"更强：多一层"进 codebase 才生效"的护栏，正好服务 ticket 30 的"新目录 revision 不打乱现有快捷项"。(2) 新标准——MCP 2026-07-28 RC 是发布以来最大改版，带 MCP Apps（server 端渲染 UI）与 Tasks（长任务）扩展，AI SDK 7 已给 experimental_MCPAppRenderer；这与你的 generative UI 方向和飞书长任务相关，值得在 MCP Adapter 里预留 revision 隔离位。

**建议：** 在 ticket 29/30 的"后台同步工具 ID/schema revision"环节落一条 vendoring 步骤（@ai-sdk/mcp + Vercel mcp-to-ai-sdk）：飞书工具 schema 下载→生成进 repo→人评审→发布 revision，运行时仍打原 remote MCP。并在 MCP Adapter 数据模型里为 MCP Apps/Tasks 扩展预留 capability 位（对齐 2026-07-28 RC）。写工具 retries 保持 disabled（你已符合）。

**证据：** /Users/bin/Desktop/开发/内容无人区/美业内容2/.scratch/p1-implementation/issues/29-feishu-uat-mcp-read-tracer.md 与 30-feishu-full-tools-shortcuts-activity.md; spec Further Notes:383（飞书远程 MCP 工具 schema 可能变化）; https://vercel.com/blog/generate-static-ai-sdk-tools-from-mcp-servers-with-mcp-to-ai-sdk （vendoring 工具定义防漂移/注入）; https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/ （MCP Apps + Tasks 扩展、stateless core）; https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools （@ai-sdk/mcp，写操作默认不重试）

**替代方案：** Vercel mcp-to-ai-sdk（工具 schema vendoring）。理由：把"外部 MCP schema 变化"从运行时风险变成 repo 里可评审的 diff，天然契合你已有的目录 revision + 脱敏账本设计。

### F5-generative-ui-paradigm (ai-native-trends) — "1 Agent工作台+3资产页"方向对，但只读周条+资产页有回退 dashboard-first 之虞；缺 generative UI / AG-UI 内联渲染路径

**详情：** 用户明确问"1 Agent工作台+3资产页是否仍最优范式"。2026 AI-native SaaS UX 共识与你方向一致：intent-over-dashboards（有报告称意图式界面首周留存比传统 dashboard 高 27%）、agent-first（"UI 是你不认同 agent 时才去的地方"）、canvas-workbench 混合（对话一栏 + 动态 canvas 一栏，agent 生成的 UI 在其中演化）；你的"对话式外壳+结构化内核、L0-L4 换容器保内核"（ADR-0008 D3）正踩在这条线上。但两点值得收紧：(1) 你的主面是"任务收件箱 + 只读紧凑周条"，这偏静态列表/看板，与"generative UI 在对话里内联生成可交互结构卡"的范式有距离——内容卡、候选、preflight 更适合作为 agent 在 thread 内渲染的 generative UI 组件，而非跳去独立资产页。(2) 你没明确 generative UI 的实现路径。AI SDK 已有 generative UI（tool-call 结果绑定 React 组件）与 @ai-sdk/react hooks；Vercel AI Elements 提供成套对话/工件组件；CopilotKit 的 AG-UI 是 agent↔UI 标准协议——正是把"结构化内核"低成本内联进对话外壳的成熟件。

**建议：** 在 P1 spec §7 Interaction（第 244-251 行）增补 generative UI 实现口径：内容卡/候选/preflight/周批次以 AI SDK generative UI（tool→React 组件）在 agent thread 内联渲染，3 资产页退为"持久检索/管理视图"而非主创作面；组件层采用 AI Elements + @ai-sdk/react，agent↔UI 交互对齐 AG-UI（CopilotKit）。同时验证"只读周条"别把主面拉回 dashboard-first——让它是 agent 可操作的 intent 入口而非静态看板。

**证据：** /Users/bin/Desktop/开发/内容无人区/美业内容2/docs/adr/0008-video-in-p0-and-layered-buy-build.md:50（D3 单 agent 工作台 + 3 轻资产页 / 对话外壳结构内核）; /Users/bin/Desktop/开发/内容无人区/美业内容2/docs/specs/beauty-content-agent-p1-spec.md:246（主面任务收件箱 + 只读周条，不建拖拽日历）; https://www.technology.org/2026/04/28/the-new-ux-of-ai-native-saas-and-erp-six-design-patterns-were-shipping-in-2026/ （intent-over-dashboards、agent-first、六模式）; https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces （AI SDK generative UI：tool 结果绑定 React 组件）; https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026 （AG-UI 协议、生成式 UI 2026 实践）

**替代方案：** AI Elements（Vercel 对话/工件组件）+ AI SDK generative UI hooks + AG-UI（CopilotKit）。理由：把"结构化内核内联进对话外壳"从自研 UI 变成装配成熟件，直接支撑你 D3 的 L0-L4 换容器。

### code-reality-3 (code-reality) — 三处 P0 资产已是 P1 目标的正确种子（账本事件/视频 Job 状态机/AI Runtime Port），但票 04/08/10 写成 greenfield，有被饱和重写误删的风险

**详情：** 按你的"更简洁优雅的组件可参考"焦点与用户"拒绝饱和重写误删"的既有反馈，明确标注不该推翻的东西。(1) usageEvents 的 reserve/commit/refund/expire + terminal 互斥（product-service.ts:204-329）已经是 append-only 账本事件流，正是 ticket 04 Product Usage Ledger 的种子；唯一要改的是把可变的 entitlement.remaining 余额（reserve 里 bucket.remaining-=amount）改成从事件投影（对齐 §192"余额由事件投影，不直接作为财务真相"）——即"事件已对、余额算法待换"，不是从零建账本。(2) 视频 claim_video/heartbeat_video/transition_video/record_video_render/complete_video/retry_video（product-service.ts:1298-1705）已实现 lease+续租、terminal 单调、ARTIFACT_REQUIRED"必须有验证过的 render+storage 才能完成"、committedSteps 幂等步进、质量重试计费——这正是 ticket 08/09 GenerationJob/ProviderAttempt 的 acceptance+safe-retry 语义种子。(3) CopyProvider 端口 + AiSdkDiagnosticRuntime 已是"provider SDK 置于 Port 后"，正是 ticket 10 ProviderExecutionPort / §258 ContentWorkflowRunner 的种子。三张票的 What-to-build 都没引用这些现有实现，读起来像全新造轮子。

**建议：** 在 issues 04/08/09/10 的"What to build"里显式写明复用基线与差量：04 复用 usageEvents 事件流、只把可变 remaining 换成投影；08/09 以 product-service.ts:1298-1705 的视频状态机为 GenerationJob/Attempt 蓝本抽象出媒体无关的 Job Port；10 以 CopyProvider+AiSdkDiagnosticRuntime 为 ProviderExecutionPort 种子。这样避免把已经通过测试的不变量重写一遍。

**证据：** product-service.ts:204-329（append-only 用量事件+terminal 互斥）；product-service.ts:1298-1705（视频 lease/evidence/idempotent-complete 状态机）；copy-provider.ts:22-32 + runtime.ts:75-112（SDK 置于 Port 后）；对照 spec §192、tickets 04/08/09/10

### code-reality-4 (code-reality) — 合规引擎是 substring includes + 破坏性 replaceAll：'第一次'被误伤成'更适合次'，连自带示例数据都会被自身规则损坏

**详情：** 这是独立于基线复核 item 1/2（那两条讲 checkSafety 不该在创作阶段拦截）的另一根轴——引擎本身的匹配与改写是错的。warningTerms=['最便宜','第一','绝对']（product-service.ts:467）用 text.includes(term) 子串匹配（checkSafety:2125），'第一'会命中美业极高频的'第一次做美甲/第一次做猫眼'。更糟的是 generate_copy 的 warning 分支对命中项做 value.replaceAll('第一','更适合')（product-service.ts:918-928），把'第一次做猫眼'改成'更适合次做猫眼'——直接产出病句；而产品自带的 seed 示例内容第三条标题恰恰就是'第一次做猫眼怎么选'（product-service.ts:69），即引擎会损坏自己的示范数据。这既是可复现的质量 bug，也会强化"效果不好"的观感。同时子串扫描对真实红线又极易绕过（改个字/加空格）。P1 把法务终审推迟到功能完整后（合理），但把这套朴素引擎原样留在了运行时合规层。

**建议：** 把 hardStopTerms/warningTerms（product-service.ts:456-467）+ checkSafety（2064-2167）+ generate_copy 的 replaceAll（918-928）抽到独立 CompliancePort：短期至少改为分词/词边界匹配并让规则只输出命中 span 交给上层处理，不再对正文做 destructive replaceAll（先修 '第一' 误伤 '第一次'）；中期在 Port 后接 AI 分类器/审核模型。顺手把 seed 示例 line 69 与规则的自损冲突记入该票。

**证据：** product-service.ts:467（warningTerms 含 '第一'）；product-service.ts:918-928（replaceAll('第一','更适合') 破坏性改写）；product-service.ts:2079/2125（includes 子串匹配）；product-service.ts:69（seed 示例 '第一次做猫眼怎么选' 会被自身规则损坏）

**替代方案：** 用 LLM/内容审核模型或分词匹配（如 nodejieba）替代 substring includes；合规规则输出结构化 span 而非 replaceAll——两者都比现有裸字符串扫描更 AI 原生、更少误伤。
