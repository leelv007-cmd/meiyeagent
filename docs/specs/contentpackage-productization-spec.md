---
title: ContentPackage 唯一成品化实施规格
status: ready-for-agent
triage: ready-for-agent
date: 2026-07-15
source_of_truth:
  - 阶段诊断决策日志：`docs/reviews/stage-diagnosis-2026-07-14/07-decision-log.md`（D01–D18）
  - ADR-0011 ContentPackage 唯一成品聚合
  - 阶段诊断合成：`docs/reviews/stage-diagnosis-2026-07-14/05-synthesis.md`
  - 管理后台待开发：`docs/reviews/stage-diagnosis-2026-07-14/06-backlog-admin-control-plane.md`
  - CONTEXT.md（ContentPackage 唯一成品聚合 / 真实跑通链路数 / 商家一级导航收束术语）
  - 2026-07-16 Pro Studio overlay：`references/analysis/vozeb-方案合集-2026-07-16.md`、`docs/specs/vozeb-adoption-pro-studio-spec.md`、ADR-0012
  - 现行 ADR-0001 / 0005 / 0006 / 0007 / 0008 / 0009
---

# ContentPackage 唯一成品化实施规格

> 本规格是 2026-07-14 阶段诊断后用户逐条拍板（D01–D18 + ADR-0011）的工程落地口径。它不重开 P1 Scope Lock，不改 ADR-0006 拓扑 / ADR-0007 AI-SDK-first / ADR-0009 单发布闸，是这些既有决策在"唯一成品事实源"方向上的传导落地。P1 实施规格仍是 Scope 基线；本规格在其之上收敛成品事实。

> 两线叠加：Pro Studio 是 2026-07-16 批准的独立加购产品面，工程可与 ContentPackage 并行，但其 `AdvancedCanvasProject`/revision 只能通过明确 adoption 回写本聚合；它不创建第二套内容事实，也不改变 P1 Composer 日常轻编辑或本规格的 N1/N2 发布闸。

## Problem Statement

付费单店商户当前"看起来"有一个能生成图文与视频的内容产品，但真实价值链没有接通，产品站在 L1 顶端、向 L2 的门槛前止步——**真实商家用真实模型端到端跑通一次的数字至今为 0**。从商户视角，断裂具体表现为：

- 商户在工作台"采用"一条文案后，打开内容库看到"0 条内容"——采用写进的是一套事实，内容库读的是另一套，两套靠投影拼接、动作与生命周期断裂。
- 商户无法把"一条文案 + 多张图"组成一个图文成品——采用一次只把单个素材变成单个内容。
- 商户上传的真实门店照片进不了图片生成——真实素材当前只是授权/事实门禁，不是画面输入，"真照片 + AI 文案 = 图文成品"这条核心价值被掐断。
- 商户在桌面采用的结果不能可靠进入手机的编辑与后续——桌面与手机是两套产品，同一成品在两端不是同一对象。
- 视频成片完成后进不了同一成品、内容库与版本体系——它是独立的第三套结果事实。

根因不是"后端没做完"，而是**成品事实没有统一**：产品同时存在三套结果事实（旧 Product ContentItem / P1 CreativeContent / 独立 DurableVideoWorkflow），靠投影拼接成"看起来像一个内容库"。竞品闭环对标"落不到自己产品上"的根因就在这里——竞品的价值是真实闭环，我方做成了 fixture 下三套投影拼接的壳。

同时，产品的运行时配置（执行模式、Provider 凭据、adapter 装配、模型激活证据）当前必须改代码 / 改 env / 重部署才能变更，没有任何可视化配置面与配置持久层，"每次都要代码级修改"是诊断病根"改代码才能配"的直接表现。

## Solution

引入一个用户可见的唯一聚合 `ContentPackage`，作为唯一用户成品与输出事实源，收束图文（copy + 有序视觉）、视频（脚本 + 分镜 + 成片）、三平台 variants（小红书 / 抖音 / 视频号）、可编辑版本、权利合规态、导出回执与复用血缘。内容库、编辑、版本、导出、复用全部只读写 ContentPackage。旧三套（Product ContentItem / P1 CreativeContent / 独立完成视频）降为迁移来源 + 只读历史，新采用只写 ContentPackage、不再双写。

商户一级导航收束到**创作 / 内容 / 素材 / 门店**四项；Work / Job / Asset / 模型 / 供应商 / 报价 / RouteSnapshot / canonical ID / 技术日志降为二级详情与内部执行审计对象，不再是用户一级产品对象。

真实价值链一次性打通并留证：真实门店档案 → 真实模型流式文案 → 真实素材进媒体生成的真图/真片 → 落进 ContentPackage → 三平台可编辑 variants。真实素材通过 provider-readable 参考图/视频 URL 喂进媒体生成，"真照片 + AI 文案"成立。桌面与手机围绕同一 ContentPackage + 同一状态机，设备只改布局、不改对象与状态。三家兼容 LLM 供应商（OpenAI / Anthropic / Gemini）以各自原生格式为固定模板，外加一个自定义模式作为第四备选；中转站在原生模板之上手动适配。

抖音在 pilot 触发点前只做诚实标注（未接入、硬编码 recorded），不以"只差 Key"表述冒充可用；BYOK 不绑平台审核，现在接真实执行通路。

运行时配置迁移到面向平台管理员的可视化配置中心，配置从"改代码 / 改 env / 重部署"变为"一次建好、长期点选"；其隐藏前置是配置持久层（DB 配置表 + 配置服务），否则前台点选的值重启即丢。

发布口径遵守 ADR-0009 单发布闸 + D01 硬 Gate：ContentPackage 六建设面一起通过才发布，不发半产品；至少一条 must-have 商户旅程用真实 provider 端到端跑通并留证，才算功能完成。北极星换成"真实跑通链路数（当前 = 0）"，0→1 之前任何 UIUX / 评审 / recorded 完备性都不计入产品进度。

## User Stories

### 唯一成品与内容库

1. As a 单店商户, I want 采用一条文案后立刻在内容库看到这条成品, so that 我不会"采用了却看到 0 条内容"。
2. As a 单店商户, I want 把一条文案和多张有序图片组成一个图文成品, so that 我得到的是一篇可发布的图文而不是散落的单素材。
3. As a 单店商户, I want 视频成片完成后和图文成品在同一个内容库里, so that 我的所有成品在一个地方管理、不分裂成多套。
4. As a 单店商户, I want 内容库、编辑、版本、导出、复用都指向同一个成品对象, so that 我在任何一处的动作都作用在同一份真相上。
5. As a 单店商户, I want 每个成品清楚显示它处于创作中 / 可使用 / 需处理哪种状态, so that 我一眼知道它能不能用。
6. As a 单店商户, I want 成品保留它从哪些真实素材和哪次生成而来, so that 我能追溯和复用来源。

### 真实价值链端到端

7. As a 单店商户, I want 用我真实的门店档案生成文案, so that 内容贴合我的店而不是通用模板。
8. As a 单店商户, I want 我上传的真实门店照片能作为参考图进入图片生成, so that 产出的是"我的店 + AI 加工"而不是凭空生成。
9. As a 单店商户, I want 文案在生成时逐字流式出现, so that 我第一眼就看到"AI 正在为我干活"。
10. As a 单店商户, I want 一条真实链路（档案→文案→图/片→入库→三平台版本）真的跑通一次并留证, so that 我确信这个产品真能用、不是演示壳。
11. As a 平台运营者, I want 用"真实跑通链路数"衡量产品进度, so that 我不被评分、绿测数、票关闭数这些内部指标误导。

### 三平台 variants 与编辑

12. As a 单店商户, I want 一个成品自动适配出小红书 / 抖音 / 视频号三个平台版本, so that 我不用为每个平台重做。
13. As a 单店商户, I want 编辑某个平台版本并保留版本历史, so that 我能改稿、回滚、对比。
14. As a 单店商户, I want 导出成品并拿到导出回执, so that 我知道导出成功且可复查。
15. As a 单店商户, I want 复用一个历史成品作为新创作的起点, so that 我不用从零开始且能看到复用血缘。

### 桌面 / 手机同一产品

16. As a 单店商户, I want 桌面采用的成品在手机上是同一个对象和同一个状态, so that 我换设备继续时不丢上下文。
17. As a 单店商户, I want 在手机上完成轻编辑和结果决策, so that 我在外也能推进，精确版式留到桌面做。

### 模型供应模板

18. As a 平台管理员, I want OpenAI / Anthropic / Gemini 三家以各自原生格式作为固定模板, so that 每家都按官方最佳实践路由、不被单一兼容层拉平。
19. As a 平台管理员, I want 一个自定义模式作为第四备选, so that 我能接入模板之外的供应商。
20. As a 单店商户, I want BYOK 现在就能用真实 key 直接调用, so that 我自带的模型能力立即可用、不等平台审核。

### 诚实标注

21. As a 单店商户, I want 抖音这类尚未接入的能力被诚实标注为"未接入", so that 我不会误以为它只差一个 Key 就能用。

### 管理员可视化配置

22. As a 平台管理员, I want 在后台可视化切换模型 / 媒体执行模式, so that 我不用改 env、重部署。
23. As a 平台管理员, I want 在后台脱敏管理 Provider 凭据并测试连接, so that 我不用改代码接入或轮换 key。
24. As a 平台管理员, I want 在后台切换抖音 / BYOK 的 adapter 装配方式, so that 装配从硬编码变为点选。
25. As a 平台管理员, I want 模型激活走"配置 + 真实探针 smoke + 落激活证据", so that 激活证据是真调通、不是环境变量哈希伪装。
26. As a 平台管理员, I want 配置写入持久层并带版本与审计, so that 我点选的值重启不丢、可追溯。
27. As a 平台管理员, I want 套餐 / 定价 / 额度在后台可写, so that 商业参数调整不经代码发布。

### 合规落到输出

28. As a 单店商户, I want 水印 / AIGC 标识真正烧录进导出文件, so that 合规标识不是只做骨架的开关。
29. As a 单店商户, I want 撤权能阻止一个成品被继续导出, so that 权利状态真正约束成品而不只约束旧 Product 内容。

## Implementation Decisions

### 1. Scope and source of truth

- 本规格消费 2026-07-14 阶段诊断决策日志（D01–D18）与 ADR-0011，不重新解释或扩大范围；不重开 P1 Scope Lock。
- ContentPackage 是唯一用户成品与输出事实源。内容库、编辑、版本、导出、复用只读写 ContentPackage。旧三套只迁移只读、不再双写。
- Product Store / Project / Asset 是唯一输入事实源；ADR-0001 数据归属不变，ContentPackage 是其上的成品聚合层，不改数据归属与授权 / 审计要求。
- 真实商户样本、模型 Key、平台账号与功能开发并行；它们控制 activation 与排序，但 D01 硬 Gate 要求至少一条真实端到端跑通留证才算功能完成，recorded/fixture 全绿不满足。

### 2. Highest testing and integration seam

- 复用现有唯一最高 seam：Product Core Application Service。Web、Admin、HTTP、MCP、job-worker 都调用同一组命令与查询；**不新增 seam**。
- ContentPackage 的采用、编辑、版本、导出、复用、撤权全部作为该 seam 上的命令 / 查询；测试打 Application Service 外部行为，不断言 pg-boss / AI SDK / 供应商 SDK 内部调用顺序。
- 媒体执行、LLM 执行、导出、凭据、配置持久层位于 Ports/Adapters 外围，可用 fake / recorded / live Adapter 替换。

### 3. Modules

- **ContentPackage Aggregate**：唯一成品聚合。`kind: image_text | video`、source facts/assets、generated assets + child runs、editable versions、三平台 variants、rights/compliance state、export receipts、reuse lineage。
- **Content Library**：只读写 ContentPackage 的成品库投影；替代当前 `creativeContents` vs `contents` 双源投影。
- **Adoption / Editing / Versioning**：采用支持"文案 + 多图"成一个成品；编辑与版本只作用于 ContentPackage；采用后进入 Package 版本体系（与 ADR-0008 D4"3 选 1 单选采用"一致，采用后进版本）。
- **Platform Variants**：小红书 / 抖音 / 视频号 variant 的生成、编辑、回滚、导出、复用。
- **Media Generation with Real Assets**：把 `referenceAssetIds` 解析成 provider-readable URL 喂进图片 edit/generate 与视频 reference；真实素材成为画面输入而非仅授权门禁。
- **Native LLM Templates**：OpenAI / Anthropic / Gemini 三家原生格式固定模板 + 自定义第四模式；已落地三原生 runner 分发（openai→chatModel / anthropic→原生 messages / gemini→原生 generateContent）。
- **Cross-device Product Journey**：桌面 / 手机共享同一 ContentPackage + 状态机，设备只改布局。
- **Legacy Migration**：旧 ContentItem / CreativeContent / 完成视频迁移为只读来源；单向迁移、不双写。
- **Admin Control Plane**：面向平台管理员的可视化配置中心（模型执行配置 / 集成连接器 / 套餐定价额度 / 合规开关 / 审计运维健康），扩现有 `admin-model-control` 地基。
- **Config Persistence**：DB 配置表 + 配置服务（读写、版本、审计、workspace 作用域），替代 in-memory `new Map`。

### 4. Core data model

- ContentPackage 是用户可见聚合，绑定 source facts/assets、generated assets 与 child runs、可编辑版本、三平台 variants、权利合规态、导出回执、复用血缘。
- 采用不再写死单元素数组；一个 ContentPackage 可含一条 copy + 多张有序视觉。
- CreativeWork / CreativeJob / DurableVideoWorkflow 降为内部执行、恢复与审计对象，保留稳定 ID、correlation 与审计，但不是用户一级对象。
- 旧三套保存 legacy source 与映射置信度；未知 provider/model/route/cost 保持 unknown，不补造事实。
- 配置事实进 DB 配置表：配置项、值、版本、作用域（workspace / 全局）、操作者、审计；模型激活证据保存真实探针结果而非环境变量哈希。
- 权利 / 合规态是 ContentPackage 的一等字段；撤权作用于 ContentPackage，阻止新导出。

### 5. State machines

#### ContentPackage（十条状态契约、12 个状态字面量，源自 ADR-0011）

- 覆盖 12 个状态字面量：draft/needs_input → generating/verifying → partial → review_ready → accepted → needs_replacement → cancelling/cancelled → save_unknown → export_failed；供应商 URL 过期走 owned archive 规则，不新增状态。
- 用户可见状态用语统一映射为**创作中 / 可使用 / 需处理**（D14）；映射不得成为另一套状态机。
- 每条状态带"必须行为"：不创建付费任务补齐缺项、使用原幂等键只查询、保留成功子任务只重试失败、幂等查询不重复版本、撤权阻止新导出。
- 桌面与手机共享同一状态机；设备切换不改变对象与状态。

#### Media Generation with Real Assets

- 参考素材必须解析为 provider-readable URL 才进入生成；解析失败进入明确的 needs_input / 需处理，不静默丢弃。
- 成功 Asset 进入自有存储后才满足媒体交付条件；临时 URL 不视为完成（沿用 P1 Attempt 语义）。

#### Config revision

- 配置变更走 draft / applied / rolled_back，产生不可变 revision 与审计；provider 装配的热加载 vs 重启生效边界显式声明。
- 模型激活走 configure → probe → evidence_recorded；未通过真实探针不得进入用户可提交状态。

### 6. Application interfaces

- **ContentPackage queries**：内容库列表、成品详情、版本历史、三平台 variant、复用血缘、权利合规态。
- **ContentPackage commands**：采用（文案 + 多图成一个成品）、编辑版本、回滚、生成 / 编辑平台 variant、导出（返回回执）、复用、撤权。
- **Media commands**：以 provider-readable 参考素材提交图片 edit/generate 与视频生成；沿用 Job/Attempt/Asset 双账。
- **LLM template config**：按 apiFamily 选择 openai/anthropic/gemini 原生模板或自定义模式。
- **Admin config commands**：切换执行模式、管理脱敏凭据、测试连接、切换 adapter 装配、触发模型激活探针、写套餐 / 定价、写合规开关。
- **Admin config queries**：读配置项与版本、激活证据状态、审计投影。
- **Migration commands**：旧三套 inspect / backfill / 差异校验 / 冻结 / 切换。
- 所有写命令要求 workspace-scoped idempotency key 与 canonical payload hash；同 key 不同 payload 返回 conflict。

### 7. Interaction decisions

- **一级导航收束**（D07）：商户一级导航只留创作 / 内容 / 素材 / 门店；Work/Job/Asset/模型/路由降二级详情。
- **默认主题**（D13）：亮色优先、中性偏暖，暗色可选。
- **状态用语**（D14）：统一创作中 / 可使用 / 需处理。
- **费用显示**（D15）：生成前只显示简单用量 / 费用提示，明细放二级。
- **首次示例**（D16）：独立"查看示例"入口，不混入个人内容库。
- **手机编辑边界**（D17）：手机完成轻编辑 + 结果决策，精确版式编辑留桌面。
- **抖音诚实标注**（D10）：抖音在 pilot 前标注"未接入（硬编码 recorded）"，不以"只差 Key"表述冒充可用；BYOK 现在接真实。
- **管理面定位**：Admin Control Plane 面向平台管理员，是二级 / 管理面，不与商户一级导航冲突。
- **创作阶段合规**：水印 / AIGC 标识是开关但必须真正落到输出文件；发布阶段最终规则在功能完整后由法务审核接入。

### 8. Runtime and component reuse

- 保持单仓、单服务边界与单 Postgres；HTTP 与 job-worker 两个入口共同部署（ADR-0006 不变）。
- AI SDK 位于 Runtime Port 后；业务模块不 import AI SDK / provider SDK。Adapter 内部优先复用官方 `@ai-sdk/*`（anthropic / google 原生 provider 已装），不裸写重复 fetch。
- 媒体真实素材通道：中转站在三原生模板之上手动适配（tu-zi 图片 `/v1/images/edits`、视频 `/v1/videos` 的 reference_image/reference_video 角色），与 Ark 原生 adapter 在同一 Port 后并存。
- Admin Control Plane 优先扩现有 `admin-model-control`（1876 行地基）与 mkfast 模板原生 admin，不新造框架（成熟组件优先）。
- 配置持久层用关系表 + 配置服务，替代 `catalog.ts` 的 in-memory `new Map` 与 `ModelPreferenceRegistry`。
- Mastra、Redis/Inngest、服务拆分、pgvector 只有真实瓶颈 + 对照 PoC 改善 + 可回滚三项同时成立才重开。

### 9. Migration and rollback

- 迁移采用 expand、可重复 backfill、差异校验、冻结新命令、切换；不长期双写。
- 校验至少覆盖对象数、稳定 ID、状态、内容版本、Asset receipt、三平台 variant、复用血缘。
- 旧三套只读保留为 legacy evidence，设明确移除条件（D18 遗留清理随手 / 攒批，优先级最低）。
- 回滚仅切换后续采用入口；新系统已产生的 ContentPackage、版本、导出继续由新 Owner 恢复，不用旧快照覆盖新事实。

### 10. Activation and release evidence

- D01 硬 Gate：至少一条 must-have 商户旅程（门店档案 → 主题 → 图文或视频 → 三平台适配 → 确认 → 内容库）用真实 provider（direct LLM + 真实媒体）端到端跑通并留证；recorded/fixture 全绿不满足。
- 北极星 = 真实跑通链路数（当前 = 0）；0→1 之前 UIUX / 评审 / recorded 完备性不计产品进度。
- ADR-0009 单发布闸：ContentPackage 六建设面（E1–E6）一起通过才发布，不发半产品；E7 管理后台作为配套。
- 模型激活证据来自真实探针 smoke，替代 `live_verified` 的环境变量哈希伪装。
- 评审两轮熔断（D04）：review→remediation→re-review 最多两轮，第三轮强制"要么真跑验证、要么标 open 冻结"。

### 11. Evidence-gated future upgrades

- ContentPackage 聚合合同（E1）冻结后，E2–E5 才进入实现；未冻结不得大规模页面 / 后端扩建（Codex 明确警告）。
- 配置持久层是 Admin Control Plane 的硬前置；未落持久层不做可视化配置面。
- 中转站媒体适配（TuziMediaAdapter）在三原生模板落地后手动补齐；reference_image 角色解 C+ 缺口。

## Testing Decisions

### Test philosophy

- 测试外部可观察行为、领域事实与不变量，不测组件内部实现。
- 最高 seam 是 Application Service；一个 seam 覆盖 Web/Admin/HTTP/Worker 的共同用例。
- 每个外部 Adapter 提供 fake/recorded fixture；live test 显式、隔离、默认不在普通 CI。
- 故障测试同时断言产品结果、Product Usage 与 Provider Cost。

### ContentPackage contract tests

- 采用一条文案 + 多张图，断言产出单个 ContentPackage 且内容库立即可见（复现并防回"采用了看到 0 条"）。
- 视频成片进入同一 ContentPackage 与版本体系。
- 十条状态契约逐条断言"必须行为"：不重复计费、保留成功子任务、幂等查询不重复版本、撤权阻止新导出。
- 编辑 / 版本 / 回滚 / 导出回执 / 复用血缘的外部行为。

### Media-with-real-assets tests

- 真实参考素材解析为 provider-readable URL 后进入图片 edit/generate 与视频生成；解析失败进入需处理而非静默丢弃。
- 已有三原生 LLM 家族路由断言（anthropic→原生 messages、gemini→原生 generateContent）保留并扩展到媒体。

### Admin config tests

- 配置写入持久层后重启仍在（防回 in-memory 丢配置）。
- 模型激活探针未通过时模型不得进入用户可提交状态。
- 凭据脱敏：查询只返回掩码、状态、范围、时间，不返回明文。

### Migration tests

- 旧三套迁移 dry-run、差异校验、冻结、切换、回滚不覆盖新事实。

### Prior art

- 复用现有 Core HTTP/ProductService 授权、幂等、状态转换测试形态，断言提升到 ContentPackage 命令与投影。
- 复用现有 `ai-sdk-runner.test.ts` 家族路由断言与 `runtime-config.test.ts` native family 断言形态。
- 复用现有 Postgres repository test 的真实事务与 workspace 隔离，扩展到 ContentPackage 与配置表。
- 前端 E2E 复用现有单 Worker Playwright 配置，按 must-have 商户旅程建稳定种子。

## Out of Scope

- 多门店、Agency、可配置席位、自定义 ACL、多级法务流程。
- 抖音真实 Publish/Observe 接入（pilot 触发点前只诚实标注；D10）。
- 小红书、点评、微信生态新增官方 Publish/Observe/Engage/Attribution。
- 专业视频时间线、重视频编辑、TTS 口播（P2）。
- 商户侧编辑 provider Key / Base URL / 物理 Channel（Admin Control Plane 面向平台管理员，不下放到商户创作界面）。
- 最终套餐额度数值、加量包价格、Pro 定价、真实供应商合同的确定。
- Mastra、Redis/Inngest、服务拆分、pgvector，除非新触发证据通过 Scope Reopen。
- 在功能完整前执行法务终审，或用法务待审反向限制创作开发。

## Further Notes

- 本规格是"一套产品的建设面"，不是分期发布；E1–E7 依赖序见 ADR-0011。E1 冻结合同是全部后续的地基。
- 真实 provider 端到端冒烟凭据已备（`docs/_private/tuzi.env`，gitignore + secret-scan 范围外）；LLM 探针已实测通过，媒体端到端与中转站适配是后续待办。
- 配置持久层勘误：生产装配中的模型目录 revision 与 workspace/user 模型偏好已经由 `PostgresModelSupplyRepository` 持久化；本规格所指的缺口是执行模式、媒体模式、adapter 装配、套餐与合规默认值等运行时配置整体，而不是重做模型目录或偏好存储。Ticket 05 只为这些运行时配置建立版本化事实源与诚实的生效值对照。
- D18 遗留小项（场景货架动态排序、social_cover 退出精选、raw PNG 归档、孤儿 i18n key 清理）优先级最低，随手 / 攒批。
- 完成不等于可公开收费：封闭付费 Beta 通过 P1 发布 Gate + D01 硬 Gate；公开收费另有 Gate 0（算法备案 / 生成式 AI 服务登记）未完成不得开放。
