# 美业内容副驾 Context

This context defines the product language for the beauty local-business content copilot so planning, specs, and implementation use the same terms.

## Current authority and consistency rule (2026-07-22)

The latest user-confirmed decisions are authoritative. For P1, read `.scratch/p1-wayfinding/map.md`, `.scratch/model-supply-wayfinding/map.md`, `docs/specs/beauty-marketing-agent-p1-productization-spec-2026-07-22.md`（当前执行）与 `docs/specs/beauty-content-agent-p1-spec.md`（历史 Scope 基线）, the accepted ADR amendments, the stage-diagnosis decision log, and the current code/tests together. For the current ContentPackage implementation overlay, also read `docs/specs/contentpackage-productization-spec.md` and `.scratch/contentpackage-productization/MAP.md`; its `decision-ticket-map.json` is the machine truth for **ticket graph, dependencies, and closure workflow** — an open ticket never proves non-implementation, and **accepted evidence under `docs/evidence/contentpackage/` may advance the north-star count before ticket closure**. For current UI/UX implementation status, the code, tests, `docs/evidence/uiux-cutover/`, and the latest stage-diagnosis evidence override pre-implementation inventory or estimate language in older handoffs and reviews. **当前一致性入口**以 `docs/reviews/doc-consistency-review-2026-07-22.md` 为准；`docs/reviews/implementation-gap-ledger-2026-07-19.md` 是持续更新的实现状态总账。`docs/reviews/doc-consistency-review-2026-07-18.md`、`docs/reviews/agent-team-full-project-deep-review-2026-07-19.md` 及更早 consistency audit 均为固定提交上的历史快照，只保留原始发现与证据，不再承担当前状态判断。Pro Studio 领域合同继续以 `references/analysis/vozeb-方案合集-2026-07-16.md`、`docs/specs/vozeb-adoption-pro-studio-spec.md` rev2 与 ADR-0012 为准；当前 parity 实施、G01–G48 与 K1–K7 以 `docs/specs/pro-studio-parity-rework-spec-2026-07-22.md`、其 baseline 和当前证据为准。**2026-07-13 UIUX/productization gap decision** plus ADR-0010 remain authoritative for the upgrade direction — Path B (full alignment with CreatOK/KickArt paradigm) and token-level streaming remain unchanged; its D4 fixed 3-choose-1 policy is superseded by the 2026-07-17 marketing authority, which gives one directly usable main recommendation and expands alternatives only on demand. Where older wayfinding or acceptance-matrix wording conflicts with ADR-0010, ADR-0010 wins, except for this explicitly superseded candidate policy. The 2026-07-14 decisions D01–D18 remain the decision overlay with live measurements separated: **D01 hard gate (≥1 real provider merchant journey with evidence) is now satisfied (north-star count = 1 via `docs/evidence/contentpackage/real-run-0002/journey/`)**; **P1 功能完成 is still not claimed** because every locked must-have and the P1 release Gate must also pass; D05–D07 are recorded in ADR-0011; D11–D12 的管理员配置中心已经落地，生产激活与发布门仍按当前总账独立判断。**2026-07-16 Pro Studio overlay** is the approved parallel product lane: Composer owns P1 daily light editing, while Pro Studio is a separate workspace add-on for infinite canvas, precision editing, TTS/SFX, and online canvas Agent. The 2026-07-19 K01–K11 engineering handoff is a historical baseline; D-099 rev2 revokes the K03 parity-completion claim and the current K1–K7 rework is open. External sale still requires its N2, security, pricing, upsell-validation, and Audio/SFX commercial gates. The old UIUX Path B execution set and the 2026-07-18 full-feature worktree handoffs are administratively closed; their historical gaps and merge instructions remain useful evidence but are no longer active execution frontiers. `合集-v1.5-P0决策定稿.md` and `docs/specs/beauty-content-agent-p0-spec.md` remain historical P0 decision/evidence records; when their older P1, authoring-gate, watermark, AIGC, or navigation wording differs, this current Context, the ContentPackage overlay, ADR-0012, and the latest P1/UIUX decisions win. Creative authoring, draft creation, template editing, image generation/editing, and batch creative operations are open. Publication-stage platform review, explicit user publication confirmation, technical tenant/data safeguards, and narrowly defined unsafe/deceptive redlines remain separate boundaries; they must not be moved backward into ordinary authoring.

**2026-07-22 文档一致性覆盖**：当前一致性入口改为 `docs/reviews/doc-consistency-review-2026-07-22.md`；`docs/reviews/doc-consistency-review-2026-07-19.md` 与 `docs/reviews/implementation-gap-ledger-2026-07-19.md` 的旧判断保留为固定快照/历史增量。Pro Studio 的“K01–K11 engineering DoD 已完成”只表示 2026-07-19 原工程票据的历史证据，不能覆盖 D-099 rev2：K03 的上游 parity 完成结论已撤销，当前执行前沿为 K1–K7，G42 Agent 对话外壳延期独立处理；K02/K04–K11 的既有行为证据继续作为回归基线。旧评审、handoff、evidence 和票体不重写，当前状态以 D-099 rev2、P0/P1 当前 Spec、代码/测试和本报告为准。

**2026-07-17 宣发产品方向**以 `PRODUCT.md` 和 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（合并权威版：第一部分产品设计 + 第二部分决策日志 D-001 起持续追加，原独立决策日志文件已并入删除）为当前产品权威；Wave 1 验证执行合同见其 D-026，视频成片入首发合同见 D-027（ADR-0008 同日追加修订节），文案与成片两层独立交付、组合由入口意图决定见 D-028，Day-0 与 Day-N 同界面（示例冷态 + 流内资产积累）见 D-029，定位边界（行业特征 × 个人 IP 的高效宣发工具平台，非店务/经营管理系统）见 D-030，前台无槽位填表、结构化输入融入对话流（AG-UI 模式参考）见 D-031，Agent Workflow 编排总纲（三层架构/确定性主干+智能节点/三进三出前后端合同/建造优先级：流式会话层+生成式 UI 组件提前、视频管线薄壳后第一优先）见 D-032，Task 统一交互单元与编排层 Harness 五段式见 D-033，Harness 实现选型与工程约束见 D-034~D-038（证据在 `references/analysis/harness-research-2026-07-17/`）。后续拍板已追加至 **D-039~D-046**：D-039 合规义务层承载；D-040 功能完善优先、合规与运营执行置后；D-041 DBOS Transact 锁定；D-042 双主题与 UIUX 收口；D-043 主路径折叠；D-044 平台默认供给与试用套餐；D-045 额度流水、兑换码与支付接缝；D-046 result 阶段常驻自由文本“调整方向”并派生新 Work/revision，不新增消息真相层。主链是广义宣发曝光与到店引流，按宣发任务、流量机会、表达身份、平台机制、门店事实/素材和转化动作编排；首发不默认包含付费媒体投放，医疗美容不计入默认首发，第一次结果给一个主推荐、备选按需展开，外部能力按已验证/辅助完成/不可用诚实呈现。“技师采集 → 顾客授权 → 店长策展”等固定岗位链已废止，顾客授权和专业核验只作为按素材/事实触发的条件门。旧设计中已核验的 ContentPackage、异步恢复、唯一写入边界和发布安全结论仍是实现约束，但不得反向决定前台信息架构。

**2026-07-22 整改与产品化执行入口**：P0 使用 `docs/specs/beauty-marketing-agent-p0-remediation-spec-2026-07-22.md`，P1 使用 `docs/specs/beauty-marketing-agent-p1-productization-spec-2026-07-22.md`；两者取代历史 `beauty-content-agent-p0/p1-spec.md` 作为当前整改/产品化实施入口，但不抹除历史证据。Pro Studio 以 D-099、`docs/evidence/pro-studio/upstream-parity-gap-baseline-2026-07-22.md`（G01–G48）和 `docs/specs/pro-studio-parity-rework-spec-2026-07-22.md` rev2 为当前重做入口。Composer 营销 Task 使用 `CreationExecutionSnapshot + DBOS Harness`；Pro Studio 节点级生成使用 `AdvancedCanvasProjectRevision + GenerationCheckpoint`，共享 Product Core 底座，且只有显式 adoption 写 ContentPackage。若文档发生冲突，Pro Studio 专属范围由 ADR-0012/D-099 裁决，共享账本、对象存储、Capability、OwnedAsset 与 ContentPackage 写入不变量由 P0/P1 当前 Spec 裁决。

## Language

**P0 保 8**:
The locked P0 scope after the 2026-07-08 decision: store profile, real asset library, Xiaohongshu/Douyin copy generation, finished video generation, content library, thick L3 handoff package, compliance gate, and manual lead ledger. (Historical term: since 2026-07-17 the scope coordinate is the merged authority's five-entry launch contracts plus capability gates — see ADR-0008's 2026-07-17 amendment; note copy generation and finished video generation were already, and remain, two independent deliverable layers per D-028.)
_Avoid_: P0 MVP all features, full closed loop

**P1 功能实现**:
The next product phase after the P1 scope is locked. Implementation may start without waiting for real pilot or payment evidence; this authorization does not mean the product or business has been validated.
_Avoid_: Go 后功能, P1 已验证

**P1 功能完成**:
The delivery state reached when every must-have in the locked P1 scope is implemented, the P1 release Gate passes, **and at least one must-have merchant journey (store profile → topic → image-text or video → three-platform adaptation → confirm → library) has run end-to-end through a real provider (direct LLM + real media) with留证 evidence.** The D01 journey requirement is necessary but not sufficient: north-star count ≥ 1 does not by itself mean P1 功能完成 or public launch. Recorded/fixture green tests alone do not satisfy this state. Real merchant counts, retention, time savings, renewal, and margin remain optional observations and do not block this state.
_Avoid_: P1 商业验证完成, P1 成效已证明, recorded 全绿即完成, 无真实跑通证据宣称完成, 单条真实旅程即 P1 完成, 北极星≥1 即可面世

**真实跑通链路数**:
The count of must-have merchant journeys completed through a real LLM, real media, durable product facts, and redacted evidence. **Current counted value: 1** (accepted same-aggregate evidence: `docs/evidence/contentpackage/real-run-0002/journey/`, runId `real-run-0002-1784236289412`; real-run-0001 was rejected because its generated media did not enter the adopted ContentPackage). Recorded, fixture, isolated adapter tests, UI score improvements, and ticket-closure counts never increment this delivery-evidence count. Ticket 22 remaining open does not reduce the count. This metric proves a real technical/product journey, not that advertising exposure, content adoption or store-visit value has been validated; the 2026-07-17 marketing design adds separate publishable-package, asset-match, reuse and lead-signal measures. Naming note (2026-07-17): PRODUCT.md 的北极星「真实跑通宣发闭环数」是宣发权威下的扩展口径（终点延伸至发布/导出与咨询/预约/买券/核销/到店信号关联）；本条计数 1 属 P1 交付证据口径（终点=确认入库），不自动计入宣发闭环口径；宣发闭环口径的计数与最终命名以合并权威版 Success Criteria 与 D-026 Week 0 预登记为准。
_Avoid_: 绿测数量, 关闭票数量, UI 评分, recorded 全绿, 票 22 open 即计数为 0, 链路数 1 即宣发闭环数 1

**P1 成效观察**:
Optional real-merchant product and commercial evidence collected outside the required P1 delivery path. P1 has no mandatory outcome dashboard, and these observations do not block release or function completion.
_Avoid_: P1 发布前置指标, P1 必交付面板

**P1 Scope Lock**:
The final set of P1 must-have user capabilities and acceptance outcomes accepted through this wayfinding effort. Those outcomes cannot be removed, downgraded, or deferred without an explicit scope-reopen decision, while technical architecture, providers, and interaction paths may change if the outcomes and release safeguards remain intact.
_Avoid_: 候选功能清单, 可随开发缩水的范围

**P1 扩展方向**:
A bounded family of user capabilities admitted beyond the already-locked P1 operating model, with three admitted in the current scope. Capabilities inside one family do not consume extra direction slots, and a conditional branch is not a must-have.
_Avoid_: 单个 API 等于一个方向, 候选项, 条件分支等于已录取

**条件启用能力**:
A locked P1 must-have that is fully implemented and release-gated but activated for a merchant only after the required official platform authorization and account verification. Merchants without activation remain on the explicit L3 fallback; this is not a scope deferral.
_Avoid_: 权限未到所以不实现, 条件分支, 默认全商户开启

**抖音官方能力深化**:
The admitted P1 platform direction limited to user-confirmed official Publish and authorized read-only observation of the merchant's own content facts. It excludes automatic public publishing, Engage, and causal or transaction Attribution.
_Avoid_: 抖音全能力接入, 自动发抖音, 抖音互动闭环

**条件式 L3 输出档**:
A non-must-have platform output profile that reuses confirmed content facts, the open graphics workbench, and the L3 handoff without adding an official connector, credential scope, or platform-specific editing surface. If that reuse boundary does not hold, the profile remains post-P1.
_Avoid_: 第三个扩展方向, 平台连接器, 自动发布能力

**通用导出素材**:
A rendered image or video without a dedicated platform content variant, checklist, or official connector. A merchant may reuse it manually, but that reuse does not establish a platform capability.
_Avoid_: 微信能力, 平台适配已完成, 官方发布产物

**ContentPackage 唯一成品聚合**:
The sole user-facing content aggregate (ADR-0011) that binds an image-text or video deliverable with its source facts and assets, generated assets and child runs, editable versions, Xiaohongshu/Douyin/Video-Account variants, rights and compliance state, export receipts, and reuse lineage. The content library, editing, versioning, export, and reuse read and write only ContentPackage. Legacy Product ContentItem, P1 CreativeContent, and standalone finished video are migration sources and read-only history; new adoption never dual-writes them. Work, Job, Asset, model, and route objects are internal execution and audit records, not first-level merchant product objects.
_Avoid_: 三套结果事实并存, 投影拼接当收敛, 单 Asset 采用即成品, 旧库新库双写, Work/Job/Asset 统治首屏

**商家一级导航收束**:
The locked first-level merchant navigation of exactly 创作 / 内容 / 素材 / 门店 (ADR-0011, D07). Models, providers, quotes, RouteSnapshot, Work/Job/Asset identifiers, and technical logs live in second-level detail views only.
_Avoid_: 对象模型统治首屏, 任务/线索/交付包一级入口, 面向商家暴露模型控制

**开放图文工作台**:
The P1 Composer capability for daily light editing: template rendering, text/image/crop/order changes, custom template reuse, preview, save revision, export, and AI image generation or editing available during authoring. Infinite canvas, high-freedom precision editing, TTS/SFX, and online canvas Agent belong to the separate Pro Studio add-on. Product-brand watermark and AIGC-label controls are exposed as switches, with no legal/compliance check gating development or draft creation.
_Avoid_: 约束式 renderer, 有限编辑器, 用发布合规限制创作功能

**Composer 日常轻编辑**:
The mainline P1 editing surface inside 创作. It is intentionally bounded to fast, repeatable merchant operations and must not silently grow into an infinite canvas or professional post-production surface.
_Avoid_: P1 默认无限画布, 专业精修混入主线, 以工作台名称掩盖 Pro Studio 加购边界

**Pro Studio（升单线）**:
A separate workspace add-on and product surface for authorized in-workspace coaches and mid/high-activity merchants. It provides infinite canvas, precision editing, TTS/SFX, and online canvas Agent, shares stable Product Core contracts, and adopts deliverables back into ContentPackage. Engineering may proceed in parallel, but default navigation, external sale, and entitlement activation require the Pro Studio validation gates; it is not the P1 Composer capability or the meaning of 高用量 Pro.
_Avoid_: 直接替换 Composer, 把工程并行当成已公开销售, 页面级锁死 P1 草稿, Pro Studio 与 ContentPackage 双写

**法务后审**:
The governance sequence in which product capabilities are implemented before a dedicated legal team reviews production-release rules and switch defaults. It defers production legal-policy decisions and does not gate feature development.
_Avoid_: 开发准入法务 Gate, 代理提前代替法务裁决

**官方模板库**:
The Platform-Admin-governed collection of immutable graphic-template versions that the product team can plan, preview, evaluate, roll out, publish, and retire without a frontend release. It coexists with templates created and versioned by each workspace.
_Avoid_: 前端写死模板, Workspace Owner 发布官方模板, 只有系统模板, 模板代码常量

**快捷模板位**:
The user-selected set of official or workspace templates shown as fast creation entries. Platform or workspace recommendations may supply defaults, but each user controls which templates are pinned for quick display and may remove any recommendation from that personal set.
_Avoid_: 后台强制快捷位, Workspace Owner 覆盖个人快捷位, 全量模板列表, 固定首页卡片

**模板版本**:
An immutable published revision of an official template. New designs use the current revision by default, while existing designs and saved workspace templates remain pinned until the user explicitly upgrades or copies them. The default upgrade action creates a new revision under the current Work while preserving every older revision; creating an independent upgraded copy remains a secondary action.
_Avoid_: 原地覆盖模板, 自动迁移历史作品, 下架即破坏旧作品

**上下文创作货架**:
The default in-record discovery layer for user-pinned shortcuts and current-task recommendations across official templates, workspace templates, and creation tools. It expands inside the active creation context and never becomes a first-level navigation item or generic marketplace.
_Avoid_: 模板一级导航, 工具大全首页, 卡片瀑布市场, 后台强制个人快捷位

**添加到创作**:
The `⌘K` search-first projection of the same official catalog, personal shortcuts, history, references, and compatible tools used by the contextual creation shelf. Selection writes a reversible, versioned object into the shared draft rather than creating a second catalog or draft.
_Avoid_: 第二模板库, 隐式复制对象, 搜索无结果补无关工具, 跨类型黑盒插入

**参考解构台**:
The deep remix mode for images, videos, official examples, saved references, and historical works. Official and workspace scopes never mix; users visually inspect provenance and explicitly select transferable structure fields before returning to the same creation context.
_Avoid_: 默认创作首页, 通用社区 Gallery, 官方与个人内容混排, 一键复制全部内容

**结构继承清单**:
The explicit current-versus-source field diff used by templates and “以此结构创作”. A/B preselect content structure, layout slots, copy skeleton, and output specification; visual style remains optional, while the reference decomposition workbench starts with nothing selected. Store and publication facts retain current editable values unless the user explicitly chooses source values.
_Avoid_: 静默覆盖门店事实, 把默认值当校验门禁, 自动复制原文案或顾客信息, 不可编辑继承结果

**工具动作**:
An inspectable, versioned processing step with declared inputs and outputs. Adding it only inserts the action into the shared draft; explicit execution creates a Job, and asynchronous results append back to the same creation context without silently running or switching tools.
_Avoid_: 选中即执行, 工具套用模板继承字段, 静默替换停用工具, 结果跳到第二工作台

**首发模板族**:
The seven must-have starting families in the P1 official template library: Xiaohongshu/Douyin cover, Before/After, price card, group-buy package, customer review, store environment, and shooting checklist. They seed the library without limiting later official or workspace-created templates.
_Avoid_: 固定模板上限, 全部模板范围, 只允许七种设计

**授权导入**:
A merchant-authorized import from an official platform connection that creates a reviewable store or deal draft. A pasted public link may locate or preserve provenance, but never silently overwrites confirmed merchant facts.
_Avoid_: 公开网页抓取, 贴链接即可信, 自动覆盖门店档案

**多源门店导入**:
The single review-first entry that uses authorized official data where available and otherwise accepts provenance links, screenshots with OCR, pasted text, or tables to create a draft.
_Avoid_: universal link scraper, direct profile overwrite, platform-specific import page

**通用连接 MCP**:
The admitted P1 integration direction that exposes notifications, messaging, documents, calendars, tasks, and other collaboration objects through standard MCP tools. Its concrete systems, tool surface, consumers, and authorization model are locked separately rather than hidden inside Notification Bridge.
_Avoid_: Notification Bridge MCP 化, 只发通知的 MCP, 无边界工具平台

**模型供应控制面**:
The product-owned source of truth for the published model catalog, user selection, route snapshots, generation jobs, assets, credential ownership references, and product/provider ledgers, exposed consistently through Web, Admin, HTTP, and MCP.
_Avoid_: 第三方模型网关后台, 聚合商控制面, 无修饰的渠道管理

**模型供应 P1 闭环**:
The P1 must-have product outcome in which catalog, selection, administration, credential authorization, route snapshots, durable media work, owned assets, dual ledgers, and shared application interfaces operate as one Product Core. When individual live deployments remain conditionally inactive, the affected capability is 未完成/待激活, not 闭环完成; at least one real end-to-end run is required before claiming completion.
_Avoid_: 只做模型选择器, 只统一 Adapter, 用真实供应账号未就绪拆掉产品闭环, 真实账号未就绪也算闭环完成

**内容质量闭环**:
The P1 loop that ties immutable prompt/example revisions and fixed beauty-domain evaluations to observable adoption, edit distance, reroll, publication, model, template, and scenario facts. Real samples may remain unknown, but the instrumentation and attribution contract must exist.
_Avoid_: 凭感觉调 prompt, 只看模型跑通, 用点赞数冒充质量

**生成数据类别**:
The privacy and residency classification of generation material, including face, personal-information, and medical classes. It determines whether the material may leave a domestic boundary or must first become a separately traceable redacted input.
_Avoid_: 普通内容标签, provider 自行判断, 调用后再补数据驻留

**视频技术验收**:
The evidence that a video is playable and matches required codec, dimensions, duration, hash, and storage receipt. It does not imply aesthetic or commercial quality.
_Avoid_: 视频质量分, 美学评分, 可用内容证明

**视频质量评分**:
The human-calibrated assessment of media defects, source consistency, shot continuity, subtitle obstruction, and other content-quality dimensions used for N-to-1 selection. It is separate from technical validation.
_Avoid_: 分辨率通过即 80 分, ffprobe 质量分, 固定美学分

**外部动作意图信封**:
The immutable user-authorized tool, target object, field scope, and side-effect class for an external write. Untrusted text read from the external system may suggest parameters but cannot expand this envelope.
_Avoid_: 飞书正文即授权, 工具输出扩大权限, prompt 决定副作用

**模型供应整窗切换**:
The single controlled migration window that replaces all legacy model-call entry points after repeatable rehearsal, backup and restore proof, submission freeze, in-flight task handling, configuration migration, and legacy-identifier mapping, with an all-window rollback path and immutable legacy history.
_Avoid_: 长期双系统, 无预演直接切换, 为旧任务伪造新路由或成本证据

**旧模型引用**:
The immutable legacy provider or model string and its source, retained with an explicit mapping confidence for historical display and explanation while all post-cutover execution writes use a stable CatalogModelId.
_Avoid_: 旧字符串继续提交新任务, 把 unknown 强行映射成精确版本, 改写历史供应方字段

**旧任务恢复**:
The post-cutover, non-generative recovery path that retains an in-flight legacy task's original ProviderTaskRef and may only inspect, receive callbacks, download, persist assets, and reconcile actual cost and delivery state.
_Avoid_: 切换时重投生成, 取消即假定供应方无成本, 为旧任务创建新 RouteSnapshot

**模型供应入口回滚**:
The cutover rollback that freezes submissions and redirects only future work to the legacy entry point while every already-created new job, provider task, asset, and ledger fact remains owned and recovered by the system that created it.
_Avoid_: 有新写入仍恢复旧快照, 回滚删除新任务事实, 旧入口接管已接单的新任务

**模型执行面**:
The replaceable managed-aggregation, direct-provider, or self-hosted gateway adapters that execute an authorized model route and return task, usage, and cost evidence without owning product catalog, tenant permission, or balance truth.
_Avoid_: Product Core, 供应方后台即产品真相, 单一万能网关

**自托管执行网关验证**:
The mandatory P1 isolated comparison in which Bifrost is the primary candidate and LiteLLM the control, evaluated behind the same ProviderExecutionPort without becoming a production dependency or product source of truth.
_Avoid_: 不做 PoC 直接上生产, PoC 后台取代 Product Core, 所有模态强制经过网关

**混合模型接入拓扑**:
The locked P1 topology in which the model supply control plane stays product-owned, the LLM execution domain is original-provider Direct-first, the media domain may use managed aggregation with Direct escape, and no request chain stacks multiple gateways.
_Avoid_: 三模态全直连, 全托管, 多网关串联, 自托管网关默认主通道

**LLM 原厂直连池**:
The P1 LLM supply pool in which each admitted deployment calls the model maker's official API or official cloud entry directly, making the model maker and API counterparty the same commercial path; an aggregator is only a separately authorized conditional channel.
_Avoid_: OpenRouter 默认主通道, OpenAI-compatible 即原厂, 非官方中转

**LLM API 家族**:
One of the three native LLM protocol and capability contracts supported by P1—OpenAI, Anthropic, or Google Gemini—to which a model deployment declares compatibility; provider-specific adapters preserve capabilities that cannot be represented truthfully by the declared family.
_Avoid_: 全部都是 OpenAI-compatible, 模型名即协议, 兼容接口等于能力等价

**LLM 通用供应 Profile**:
An admin-defined LLM connection profile that declares API family, channel type, endpoint, region, credential scope, and capability/price evidence without hard-coding a provider roster; original, official-cloud, aggregator, and proxy channels remain explicitly distinguishable.
_Avoid_: 内置供应商常量, 任意兼容 URL 即原厂, Profile 自动发布全部模型

**LLM Auto Profile**:
A task-specific automatic selection intent for general copy, structured output and tools, long-context revision, or multimodal understanding that resolves against published capabilities and evidence while preserving the actual selected model in the result.
_Avoid_: 单一全局默认模型, Auto 伪装成固定模型, 不记录实际模型

**国内落地模型池**:
The dynamically published set of China-region original or official-cloud model deployments eligible for user traffic after the landing trigger; Auto defaults resolve within this set without hard-coding a permanent provider order.
_Avoid_: Qwen 永久写死为默认, 国内 endpoint 即自动合格, 落地时另建模型系统

**模型证据状态**:
The explicit confidence attached to a model profile, capability, quality claim, or runtime fact so documented-but-unverified candidates can be configured and published without being presented as live-verified or beauty-benchmarked.
_Avoid_: 未实测即禁止开发, 文档可用即实测可用, 不标证据直接宣称稳定

**模型部署激活**:
The deployment-level transition that makes an operation user-submittable only after its authentication, capability contract, recovery and asset path, usage and cost evidence, and authorized region path have been live-verified; recorded functionality may complete before this transition.
_Avoid_: 全部候选实测后才开发, 未验证候选伪装成可提交, 一个模型验证代表全部 operation

**模型供应发布证据包**:
The traceable P1 release proof combining recorded contracts and state machines, live evidence for every user-submittable operation, recovery and owned assets, strict credential and tenant boundaries, dual-ledger reconciliation, audit, migration rehearsal, backup restore, and entry rollback.
_Avoid_: 一次成功调用即验收, 只看自动测试不上真实路径, 未激活候选阻塞全部发布

**模型供应实施交接包**:
The post-wayfinding input to implementation planning that carries the locked domain contracts, scope classification, interfaces and adapters, operation matrix, migration and cutover rules, gateway comparison, activation evidence, tests, observability, release, and rollback expectations without waiting for every live provider proof.
_Avoid_: 等全部真实模型实测才写规格, 直接把研究票当 Sprint backlog, 交接不含迁移与激活矩阵

**模型版本迁移**:
The explicit transition from an immutable model deployment to a published successor: new work may adopt the successor through a new catalog or route revision, while fixed selections, templates, running tasks, and history are never silently rewritten.
_Avoid_: 原地覆盖模型别名, 自动改写历史模型, 下线即删除旧事实

**动态模型候选角色**:
The main, backup, or conditional routing role derived from phase, channel type, deployment status, capability, credential availability, and evidence rather than permanently assigned to a provider brand.
_Avoid_: 永久主供应商品牌, 全部 deployment 同级, 未实测自动主路由

**图片通用供应 Profile**:
An admin-defined image connection profile that declares channel type, endpoint, region, credential scope, model identity, and capability/price evidence while leaving Images, Gemini, Ark, queue, and batch protocol differences to operation-specific adapters.
_Avoid_: fal 写死为图片后端, 通用 Profile 即通用图片协议, 前端直接提交 provider slug

**图片 Operation Adapter**:
The execution adapter that preserves a specific image operation contract—generation, reference editing, mask editing, annotated editing, multi-output, or offline batch—without claiming unsupported equivalence across providers.
_Avoid_: prompt 加 image 即全部图片能力, 应用 fan-out 即供应方 Batch, 标注编辑等于 mask

**图片首发模型池**:
The four independently selectable P1 image CatalogModels—GPT Image 2, Nano Banana 2, Nano Banana Pro, and Seedream 5.0 Pro—published as distinct operation-capability choices rather than hidden quality levels of one model.
_Avoid_: 图片模型只留一个默认, Pro 是后台质量开关, 四模型价格阶梯

**图片模型显式默认链**:
The model selection precedence for image tasks—current selection, user default, template binding, then workspace default—using the first operation-compatible explicit choice and leaving the task awaiting selection when none exists.
_Avoid_: 平台自动推荐图片品牌, 后台静默升降档, 无模型时随机选择

**国内落地图片池**:
The dynamically published set of China-region original or official-cloud image deployments visible to user traffic after the landing trigger, while overseas image deployments become internal-only without permanently hard-coding Seedream as the sole future model.
_Avoid_: 海外代理冒充国内模型, Seedream 永久唯一, 落地后仍默认海外用户流量

**图片同模型通道主备**:
The routing relationship in which main and backup deployments must execute the same image CatalogModel with an equivalent operation contract; a different image model is never a transparent backup for a user's fixed selection.
_Avoid_: 不同图片模型互为备机, 聚合目录存在即独立容灾, 失败时静默换模型

**视频通用供应 Profile**:
An admin-defined video connection profile that declares channel type, endpoint, region, credential scope, model identity, and capability/price evidence while leaving task, callback, cancel, batch, and asset protocols to provider-specific video adapters.
_Avoid_: fal 写死为视频后端, 通用 Profile 即统一视频协议, 前端直接轮询供应方

**视频 Operation Adapter**:
The execution adapter that preserves a video deployment's submit, inspect, cancel, result, temporary-asset, usage, and operation-specific capability contract behind the product-owned durable job.
_Avoid_: 停止轮询即取消, SDK 轮询即产品任务, provider URL 即永久 Asset

**视频首发模型池**:
The four independently selectable P1 video families—Seedance 2.0, Kling 3.0 latest, Grok latest video, and Veo 3.1 latest—whose internal tiers remain capability deployments rather than independent redundancy.
_Avoid_: Seedance 唯一视频模型, Fast/Lite/Turbo 即独立备机, 继续增加旧视频模型

**视频模型显式默认链**:
The model selection precedence for video tasks—current selection, user default, workflow or template binding, then workspace default—using the first operation-compatible choice and leaving the task awaiting selection when none exists.
_Avoid_: Seedance 写死默认, 平台自动推荐视频品牌, 无模型时随机生成

**国内落地视频池**:
The dynamically published set of China-region original or official-cloud video deployments visible to user traffic after the landing trigger, initially including eligible Seedance and Kling channels while overseas Grok and Veo deployments become internal-only.
_Avoid_: Seedance 永久唯一, 海外代理冒充国内视频通道, 落地后仍默认海外用户流量

**视频同模型通道主备**:
The routing relationship in which main and backup deployments must execute the same video CatalogModel with an equivalent operation and task contract; another video family is never a transparent backup for an accepted or fixed selection.
_Avoid_: Seedance 与 Kling 自动互投, 超时即跨模型重做, 聚合目录存在即独立容灾

**视频取消意图**:
A user's request for the product to ask an accepted provider task to stop; it becomes confirmed cancellation only when provider evidence proves the task stopped, and it does not itself determine product refund or erase provider cost.
_Avoid_: 停止轮询即取消, 点击即全退, 取消后供应成本归零

**视频条件候选**:
A video deployment that may be configured or explicitly published while its evidence shows high cost, commercial activation, unavailable credentials, unverified runtime, aggregator/proxy routing, or stage-limited use; the condition is visible and does not become a development gate.
_Avoid_: 未开通即禁止实现, 高成本模型静默隐藏, 条件候选即已实测可用

**LLM Auto 排序**:
The soft ordering applied only after route hard filters, prioritizing quality evidence, then runtime reliability and capacity, then estimated cost, then latency without inventing a quality score for unknown evidence.
_Avoid_: 成本越界选择, 营销定位即质量分, Auto 忽略地区或凭据

**生成重试 Owner**:
The Product Core responsibility that exclusively decides cross-channel retry or fallback from the immutable route snapshot and provider acceptance evidence; lower SDK, gateway, and HTTP layers do not independently replay side-effecting generation requests.
_Avoid_: 多层嵌套重试, Gateway 隐式跨模型, timeout 即重新生成

**Safe-only 接单策略**:
The P1 retry posture in which automatic replay is allowed only after evidence proves the provider rejected the request before acceptance; unknown or accepted outcomes are recovered, looked up, or reconciled without creating a duplicate generation.
_Avoid_: POST 超时即换通道, acceptance unknown 当失败, 可用性优先重复生成

**容量等待策略**:
The P1 behavior in which a fixed model waits in the product queue for its scoped execution capacity, while LLM Auto may choose another eligible candidate before acceptance and expired reservations are released for requoting.
_Avoid_: 无并发即静默换固定模型, HTTP QPS 即视频并发, 排队即供应方已接单

**模型区域硬边界**:
The route constraint that permits execution only in regions explicitly authorized by the workspace or request and never allows health, price, capacity, retry, or fallback to silently cross that boundary.
_Avoid_: 故障自动跨区, 国内 endpoint 即任意数据落地, region 仅展示不执行

**生成路由快照**:
The immutable pre-dispatch record of catalog, route policy, price, requested and allowed candidates, credential mode and version, region, and fallback consent, tied by one idempotency key to the job, attempts, assets, callbacks, and ledger events.
_Avoid_: 每次重试使用最新配置, 只记最终通道, 后台改价影响运行任务

**产品用量账**:
The product-facing ledger that reserves quoted usage before dispatch and idempotently commits, refunds, expires, or adjusts it according to whether a usable result or owned Asset was delivered.
_Avoid_: 供应商账单即用户扣费, 浮点余额直接改写, 失败删除历史扣费事件

**供应成本账**:
The append-only ledger of estimated, observed, reconciled, and adjusted external model costs per provider attempt, preserving original currency and evidence even when product usage is refunded or billed externally through BYOK.
_Avoid_: 用户退款即供应成本归零, Gateway 估算即最终发票, BYOK 不记 usage

**交付式产品结算**:
The product usage rule that fully releases or refunds reserved usage when no usable result or owned Asset is delivered and commits it when a usable result is persisted and delivered, regardless of separate provider cost.
_Avoid_: 供应方接单即用户扣费, 点击取消立即假退款, 用户退款删除供应成本

**质量重做额度**:
A plan- and modality-configured allowance consumed only when a user explicitly creates a new job because a technically successful result is unsatisfactory; when unavailable, the redo requires a new quote.
_Avoid_: 技术成功自动重做, 路由写死两次免费, 重做复用旧 ProviderTaskRef

**生成失败说明**:
The user-facing projection of a normalized generation failure category, current delivery and billing state, next available action, and correlation ID without exposing raw provider payloads or secrets.
_Avoid_: 直接展示供应商错误, 统一只写生成失败, 用内容合规解释技术路由失败

**自动尝试上限**:
The P1 limit of two automatic ProviderAttempts per GenerationJob—the initial attempt plus one authorized safe retry or candidate—after which further execution requires a user-created job.
_Avoid_: 无限遍历候选, acceptance unknown 继续尝试, 重试次数由 SDK 隐式决定

**模型供应后台**:
The Platform-Admin-only authority for provider profiles, channels, deployments, catalog entries, capabilities, dual prices, route policies, platform credential references, health projections, evaluation, visibility, audit, and lifecycle, with third-party consoles retained only as replaceable execution projections and evidence.
_Avoid_: Gateway 后台即产品后台, Workspace Owner 选择物理 Channel, 三模态三套管理台, 运维配置即用户目录

**模型供应发布流**:
The revisioned administrative lifecycle that separates saving a draft, enabling it for execution or simulation, and publishing it to the user catalog; verification is optional evidence and rollback publishes a new revision rather than mutating history.
_Avoid_: 保存即上线, 验证必经门禁, 回滚原地改历史

**执行停止开关**:
The administrative control that immediately blocks new ProviderAttempts for a channel or deployment while preserving inspect, callback, download, Asset persistence, and reconciliation for already accepted tasks unless cancellation is separately requested.
_Avoid_: 禁用即丢弃运行任务, 下线即批量取消, 只隐藏目录仍继续提交

**模型目录可见性**:
The published-catalog projection that makes every eligible model visible by default after phase, region, credential, and entitlement checks, while allowing new deployments to roll out by workspace allowlist or percentage without content-based gating.
_Avoid_: 合格模型仍隐藏在高级模式, 按创作内容隐藏模型, 新通道直接全量无灰度

**兼容优先目录**:
The full-catalog view that defaults to models compatible with the current operation and inputs while keeping incompatible or unavailable published models discoverable, disabled for submission, and annotated with a normalized reason.
_Avoid_: 不兼容模型彻底消失, 所有模型保持可提交到最后报错, 查看全部变成高级权限

**双层模型入口**:
The user-facing selection structure in which a compact layer exposes the current selection, pinned models, recent models, and any Auto mode already authorized for that execution domain while an always-available full catalog exposes every eligible published model without an advanced-mode or role gate.
_Avoid_: 快捷层硬编码另一份模型表, 完整目录只对高级用户开放, 在创作入口暴露物理通道或密钥

**模型制造方展示**:
The catalog projection that identifies a selectable model by its manufacturer brand, product name, and explicit version while keeping procurement providers, channels, accounts, credentials, and deployments out of the creative interface.
_Avoid_: 隐去真实产品版本, 把聚合商当模型制造方, 在模型卡展示物理通道

**模型选择优先级**:
The compatible-catalog precedence for a new task: explicit task override, user operation-scoped default, template or workflow binding, then workspace default; LLM may finally resolve its authorized Auto mode, while image and video enter awaiting selection instead of using platform Auto.
_Avoid_: 最近使用自动改默认, 工作区默认覆盖个人明确默认, 图片或视频引入平台 Auto

**个人模型快捷偏好**:
The cross-device, operation-scoped user preference containing explicitly pinned models and a separately derived, deduplicated recent-model history; shortcut display capacity does not limit the full pinned set.
_Avoid_: 收藏与最近使用共用状态, 工作区成员共享最近记录, 只存当前浏览器

**生成前任务报价**:
The user-facing quote calculated after task inputs and specifications are known, expressing exact or estimated product usage, an expected duration range, confidence, price revision, and validity without exposing provider procurement cost.
_Avoid_: 模型卡直接倾倒供应商原价, 把历史平均耗时写成保证, 规格未定仍显示伪精确扣费

**固定模型恢复选择**:
The user decision offered when a fixed CatalogModel is temporarily unavailable: preserve the requested model and explicitly choose to queue, retry later, or select another compatible model under a new quote.
_Avoid_: 临时不可用静默跨模型, 自动改写固定选择, 换模型沿用旧报价

**模型凭据管理角色**:
The P1 ownership split in which platform administrators manage platform-funded credentials and the single workspace owner manages and uses workspace BYOK without reading secret material back. Personal BYOK and other workspace member roles are post-P1.
_Avoid_: 所有 BYOK 由平台代管, Operator 或 Reviewer 管理 BYOK, 供应方 Team 成员即产品权限

**模型偏好面**:
The user-facing settings surface for current, personal, and workspace model preferences plus workspace-owner BYOK, projecting model identity, capability, availability, and normalized reasons without exposing physical channels, deployments, provider costs, credentials, or route internals.
_Avoid_: 万能模型管理页, 用户选择物理 Channel, 设置页展示供应商原价, BYOK 混入外部连接

**受控端点 Profile**:
The platform-published BYOK connection profile that fixes an API family, permitted domains, capability boundary, and publishable models so a workspace administrator supplies only a write-only key and model authorization rather than an arbitrary Base URL.
_Avoid_: 任意兼容 URL 直接可用, workspace 管理员定义物理协议, discovery 自动发布全部模型

**通道供给草稿**:
The untrusted draft and diff produced from provider or gateway discovery for model aliases, versions, capabilities, prices, and lifecycle, requiring an administrator to publish a new immutable product revision before it affects users or routing.
_Avoid_: /models 自动上架, 供应方价格覆盖产品价格, 滚动 alias 当不可变版本

**模型双价目**:
The independently revisioned provider cost price and user-facing product price, which may be linked by pricing rules but require separate publication so supplier changes never silently alter a confirmed product quote.
_Avoid_: 供应价自动覆盖用户价, 只记产品积分不记供应成本, 运行任务跟随最新价

**模型运行投影**:
The normalized Product Core view of channel health, capacity, latency, failures, cost evidence, and reconciliation state, with provider, gateway, and observability consoles retained as evidence deep links rather than authoritative product state.
_Avoid_: 只看第三方后台, 复制全部外部观测系统, 无真实 probe 即无健康状态

**模型供应管理 MCP**:
The RBAC-protected read-write MCP surface that invokes the same Product Core application service as Admin UI and HTTP for catalog, profile, channel, deployment, price, route, health, and credential lifecycle actions without exposing raw secrets or third-party admin APIs.
_Avoid_: Gateway MCP 即产品 MCP, MCP 单独实现业务规则, MCP 返回明文 Key

**模型供应审计**:
The append-only record of every Admin UI, HTTP, or MCP model-supply change with actor, scope, object, action, before and after revision, reason, time, and correlation ID while secret material is represented only by safe version or fingerprint metadata.
_Avoid_: 只审计最终发布, 基础设施日志代替产品审计, 审计记录明文 Key

**历史模型事实**:
The immutable model, deployment, route, credential-version reference, price revision, provenance, and delivery evidence attached to a running or completed generation, unaffected by later catalog publication, disablement, retirement, or rollback.
_Avoid_: 后台更新改写历史作品, 下线迁移运行任务, 回滚删除旧快照

**模型退役迁移**:
The explicit user or administrator decision that moves future defaults, pinned choices, or template bindings from a retiring CatalogModel to a published successor while preserving every historical selection and execution fact.
_Avoid_: successor 自动改写显式偏好, 退役删除历史模型, 不提示影响范围直接下线

**分模态执行域**:
The P1 execution boundary where LLM and media share one product contract and control plane but use separate managed adapters, health state, capacity, and failure domains; image and video share durable media-task semantics without requiring one physical provider.
_Avoid_: 全模态单一网关, 三套独立产品控制面, 图片视频必须同供应方

**模型凭据绑定**:
The product-owned authorization that binds a workspace or environment to a provider deployment, region, credential owner and immutable version, and fallback consent while the raw secret remains write-only in the credential vault.
_Avoid_: 原始 API Key, Gateway virtual key 即授权真相, 供应方 Team 即产品租户

**严格 BYOK**:
The credential mode in which every attempt uses only credentials authorized by the same owner and never falls back to a platform-funded key when that credential or route is unavailable.
_Avoid_: BYOK 失败自动平台兜底, 自带 Key 即免费, 静默更换付费主体

**阶段化模型路由**:
The validation-to-landing transition that keeps one model supply control plane and changes published deployments and route-policy revisions: mixed domestic/foreign candidates during validation, then domestic-original defaults for user traffic while foreign models remain internal-only after the landing trigger.
_Avoid_: 国内外两套模型系统, 落地时重做控制面, 现在提前收缩全部模型

**模型执行故障域**:
The isolation unit for health, capacity, cooldown, and circuit state, scoped by modality, API counterparty or original provider, credential owner, deployment region, and environment so one failure does not disable unrelated models or workspaces.
_Avoid_: 全局模型健康开关, 同模态共享一个熔断器, 平台 Key 与 BYOK 共用额度状态

**Scope Reopen**:
The explicit user decision required when a locked capability still cannot pass the release Gate after documented alternatives have been exhausted. The evidence is brought back for a replace, defer, or terminate decision; implementation never shrinks the scope silently.
_Avoid_: 自动降级, 开发现场删需求

**P1 里程碑**:
The progress model of Scope Lock, per-capability completion, and release-Gate passage. P1 has no fixed 10–22 week promise; locked capability outcomes and release quality stay fixed while dates follow actual complexity.
_Avoid_: P1 固定工期, 用删范围守日期

**P1 发布 Gate**:
The safety-delivery acceptance boundary before P1 enters a closed paid Beta or is later offered publicly. Core paid journeys, publication-stage safeguards, tenant/data safeguards, idempotent billing/audit, backup/restore or rollback, and monitoring must pass; development, authoring, and draft creation have no entry gate and prior outcome evidence is not required.
_Avoid_: P1 开发准入, P1 功能开工 Gate

**封闭付费 Beta**:
The first P1 release mode: paying single-store merchants enter through per-merchant invitation or contract approval, with no fixed workspace-count ceiling. It excludes public registration, self-serve purchase, and open-scale acquisition.
_Avoid_: 免费试用, 公开付费发布

**封闭 Beta 收款**:
Payment through a contract or order plus a reviewed transfer receipt, followed by an idempotent manual entitlement grant with period, refund, evidence, and operator audit. It is not a public checkout or self-serve payment flow.
_Avoid_: 口头续跑, 手工开通无凭证, 公开支付页

**Beta 准入审批**:
The per-merchant manual decision that controls entry into the closed paid Beta. There is no numeric workspace ceiling or automatic pause trigger; operational incidents, support load, and merchant value are decision inputs for the responsible owner.
_Avoid_: 公开注册, 自动扩容准入, 固定商户上限

**P1 Owner**:
The single named Product Owner with final authority over release approval, peripheral-defect waivers, and per-merchant Beta admission. Technical and compliance checks supply evidence for non-waivable gates but do not replace this accountability.
_Avoid_: 多头最终负责, 无具名放行

**发布豁免**:
Internal development, testing, and demos have no release Gate and may proceed with incomplete items using non-production data. For a closed paid Beta, only peripheral minor defects may be accepted by a named owner; statutory/data redlines and the core delivery capabilities named by the P1 release Gate cannot be waived.
_Avoid_: 内部豁免等于生产豁免, 全项可豁免上线

**外围缺陷豁免**:
A written P1 Owner acceptance for a defect that affects neither a locked must-have outcome nor a Sev0/Sev1 boundary. It records impact, affected merchants, workaround, and owner, and expires before the next release milestone unless fixed or re-approved.
_Avoid_: 永久风险接受, 口头放行

**运行时硬停止**:
Immediate isolation of an affected capability or workspace when a non-waivable safety, compliance, or core-delivery gate fails in the live Beta. Data and audit evidence are preserved, and service resumes only after repair and re-validation; the capability is not silently removed from scope.
_Avoid_: 带病继续服务, 自动删减 P1 范围

**Sev0**:
A defect or incident involving cross-tenant or unauthorized data exposure, irreversible data loss/corruption, bypass of a statutory content/AIGC/authorization redline, or systemic unauthorized charging/entitlement. Any open Sev0 blocks release and triggers runtime isolation.
_Avoid_: 可签字放行的严重问题

**Sev1**:
A defect or incident that leaves a locked paid-core journey without a safe workaround, causes recoverable billing/entitlement inconsistency, or disables required backup/restore, rollback, or critical monitoring. Any open Sev1 blocks release; peripheral defects belong below this level.
_Avoid_: 所有普通功能缺陷

**资质准入制商家**:
A medical-beauty or medical-content merchant admitted only after offline qualification and platform-certification screening. Creative authoring and draft creation stay open. Publication-stage preflight is reminder plus audit log by default; only clearly unsafe, deceptive, unauthorized, or platform-bypass behavior remains a hard stop.
_Avoid_: regulated merchant, medical merchant generic

**L3 发布包**:
The human publishing execution object under one accepted Content version's publication stage: QR transfer to mobile, segmented one-click copy, save/download referenced Assets, and a publishing checklist. It binds its own immutable snapshot instance under the shared publication-snapshot contract and is never an Asset; an unchanged snapshot may rotate an expired token on the same package, while any bound snapshot field change invalidates the prior confirmation and follows the locked new-package or reschedule rule.
_Avoid_: auto publish, browser assist, 发布包即 Asset, token 过期复制内容, 静默跟随最新 Content, 改绑定字段沿用旧确认

**L3 发布结果**:
The user's report after a human handoff, remaining pending after copy or download until the user marks published, deferred, or failed; a public link or proof is optional evidence. An expired handoff link means regenerate the link, not publication failure, and no transfer action itself proves publication.
_Avoid_: 下载即发布, 强制上传凭证, 链接过期等于发布失败, 自动推断平台结果

**P1 L1/L3 发布边界**:
The locked P1 distribution boundary in which official L1 integrations and human L3 handoff are the only publishing routes, with no browser-assisted L2 platform or conditional branch admitted.
_Avoid_: L2 pilot, browser extension fallback, cloud browser publishing

**发布准备**:
The downstream stage attached to one accepted Content version where the user explicitly selects official L1 or human L3 and sees each route's availability, snapshot, action, and status. A route failure never silently switches the selection, and publication preparation is never part of creative authoring or connection settings.
_Avoid_: 自动 L1 转 L3, 两套内容快照, 设置页发布, 创作阶段发布门禁

**发布快照**:
The immutable action-snapshot contract shared by L1 and L3. Each route/account action owns its own snapshot instance while sharing one accepted Content version and exact Asset source facts; the instance binds route, Asset identities and hashes, optional source Work revision, platform, account, immediate or scheduled time, optional publication anchors, operator, and confirmation time. Tokens and transfer receipts are transport facts rather than Assets; any bound-field change requires a new confirmation and follows the locked new-execution-object or pre-dispatch reschedule rule, while L1 callbacks and L3 user reports both project their real state back into the owning Content publication stage.
_Avoid_: 两条路线共用一个可变 snapshot, 动态读取最新内容, ZIP 或二维码成为 Asset, L1 与 L3 分叉两套 Content 状态, 平台已发布但内容库不回写, 改期或改锚点沿用旧确认

**发布确认**:
The single action-time confirmation in a flow-local side sheet that binds the selected account, accepted Content version and media, immediate or scheduled time, and optional anchors. Hints and preflight do not count as confirmation, and any bound-field change invalidates the prior confirmation.
_Avoid_: 创作阶段确认, 每一步重复确认, 全局阻断模态框, 绑定内容变化后沿用旧确认

**安排发布**:
A durable Publish Job in scheduled state that may be cancelled or rescheduled before dispatch; rescheduling invalidates the prior confirmation and requires confirmation of the new time. At the scheduled time the immutable snapshot is dispatched idempotently once, after which the Job follows real platform submission states rather than schedule-edit semantics.
_Avoid_: 浏览器定时器, 静默改期, 到点重复提交, submitted 后伪装取消排期

**发布状态卡**:
The persistent projection of an L1 Publish Job in the selected Content version's publication stage, covering submitted, reviewing, published, failed, and awaiting-platform-verification with their valid recovery actions. Reviewing or unknown never silently changes route or causes resubmission, while a definite pre-submission failure may offer an explicit L3 choice.
_Avoid_: 只用 toast, 只显示成功失败, unknown 自动重发, reviewing 自动转 L3, 设置页发布状态

**视频成片**:
The finished-video workflow (per merged-authority D-027 a required deliverable of the Douyin / WeChat-Channels variants, produced by video-model APIs plus the compose pipeline): AIDA storyboard confirmation, first frame, clips, thin ffmpeg composition, optional product-brand watermark and product-visible AIGC-label switches, provider/platform provenance recording, storage, and handoff through the L3 package. A publication platform may apply its own label or gate later. Per D-028, voiceover scripts and video scripts are copy-layer deliverables produced by the LLM: from a copy-intent entry they are full-value deliverables in their own right, and they enter this workflow only as inputs when the user's intent is a finished video.
_Avoid_: 用户要成片时只交视频脚本 (video script only), lightweight video later, 把口播稿/视频脚本说成成片能力的降级形态

**Agent 模式**:
The default interaction mode inside the generation workbench. It uses a document-like creation record to turn intent, references, field-level AI suggestions, editable drafts, an explicit execution contract, Generation Jobs, and results into resumable work objects. Direct composition remains a visible secondary mode over the same draft, references, model selection, quote, and Job; Agent is never a separate top-level workbench or a floating/background-only capability.
_Avoid_: Agent 工作台, 独立 Agent 首页, chat bubble clone, floating copilot, 无可见入口的后台 Agent, 与直接编排分裂的第二份草稿

**Agent 创作记录**:
The selected default structure of the unified multimodal composer. It is a continuous, non-chat timeline of intent, proposed field patches, editable draft artifacts, source provenance, the user-inspectable execution contract, stable Job state, and results. Every AI proposal can be accepted, edited, or ignored without silently overwriting user input, and long-running work resumes against its original immutable submission snapshot.
_Avoid_: 普通聊天记录, 隐藏模型或报价, AI 静默覆盖, 每轮重新上传, 刷新后重投任务

**统一多模态输入台**:
The single composer surface shared by Agent and direct-composition modes for text, images, video, links, pasted text, templates, presets, explicit media-model selection, specifications, quote and duration estimates, optimization, advanced parameters, and user-controlled watermark/AIGC switches. Creative authoring stays open; model activation is the only submission-time execution availability guard, and publication review remains downstream.
_Avoid_: 按媒介复制表单, Agent 与自由创作两套提交合同, 跨品牌静默回退, 创作阶段发布或法务门禁

**CreatOK 式生成工作台重构**:
The UI/UX upgrade that adopts a creation-first shell, dense navigation, unified multimodal composer, guided tool entry, and asset-result loops while preserving the independent beauty brand and integrating the P1 task inbox, weekly operations, templates, and publication confirmation into the same work surface. Desktop is primary; mobile covers capture, confirmation, progress, and publishing handoff rather than full parity.
_Avoid_: CreatOK clone, generic AI tools marketplace, replacing the P1 operating model, full mobile parity

**生成工作台**:
The single default desktop home surface whose Composer is the primary visual and action axis, with the content task inbox and compact week strip embedded as operating context rather than competing dashboards.
_Avoid_: 任务列表首页, 第二工作台, 两个 H1, 以上次访问位置替代默认主面

**创作上下文**:
The resumable state carried inside the single generation-workbench shell, including its source object, interaction mode, working inputs, references, and current stable session, work, or job. Media type is a Composer choice rather than a separate top-level page.
_Avoid_: 本地 Tab 状态, 按图文视频复制工作台, 依赖浏览器返回恢复来源, 无地址临时会话

**来源上下文**:
The explicit originating object and return anchor carried when creation starts from a Task, Asset, Content, Work, or history projection, showing the direct source first with full provenance available on demand. Completion keeps the result or receipt visible and offers an explicit return action; the anchor survives refresh and mode changes, with canonical-home fallback only when the source is unavailable.
_Avoid_: 只依赖浏览器返回, 完成后自动跳页, 一律返回工作台首页, 任意 return URL, 复制来源对象保存上下文

**稳定对象地址**:
The canonical address under the authenticated dashboard tree for each primary business object and resumable session, task, work, job, asset, or content record. Hashes, in-memory tabs, and legacy query parameters may redirect to it but never remain a second navigation contract.
_Avoid_: hash 作为对象地址, 本地 activeTab, 同一对象多个 canonical URL, 为重命名路由做无收益迁移

**受信返回锚**:
The typed internal source-object and action position carried when a user leaves a Work or Content flow to resolve model, connection, or entitlement settings, allowing completion to return to the same canonical object and owning action. Generic settings fabricate no source, and administration may return only to a recent safe authenticated product URL.
_Avoid_: 任意 return URL, 只依赖浏览器返回, 设置完成一律回首页, 复制来源对象, 后台返回外部地址

**运营上下文栏**:
The collapsible secondary region of the generation workbench, compactly expanded by default on desktop with the highest-priority action, five-point week context, and recoverable-exception counts. It links to the full task inbox but never becomes a second dashboard or replaces the Composer as the primary surface.
_Avoid_: 完整任务列表压在 Composer 上方, 第二 Dashboard, 只用 toast 表达异常, 在移动端照搬桌面栏

**下一行动**:
The single highest-priority actionable projection in the operations rail, ordered by user pin, action-required publication or recovery, deadline, asset gap, review, ordinary creation, then weekly recap, with stable time-based tie-breaking. It links to one canonical Content Task or recovery object and owns no duplicate state.
_Avoid_: 随机推荐, 只按截止时间, 完全手动排序, 多张同级主卡, 右栏第二任务列表

**可恢复异常**:
An execution, publication, or connection state that requires user action or a recovery choice, including failure, prolonged stall, unknown outcome, failed recovery, or invalid authorization. Normal queued, running, and completed states remain aggregate status plus source-record facts and do not enter the exception list.
_Avoid_: 所有 Job 进度, 仅最终失败, toast-only error, 把普通运行中当异常

**移动任务面**:
The mobile-specific surface for capture/upload, task confirmation, generation progress, result preview or light correction, and publication handoff. It follows source context and deep links but does not mirror the four desktop business destinations or provide full workbench parity.
_Avoid_: 桌面侧栏缩窄版, 完整 Polotno, 移动后台, 只靠通知无移动落点, 假装全功能同等

**一级业务导航**:
The flat merchant-facing sequence of creation, content, assets, and store. Tasks, leads, publication, models, routes, jobs, and connections remain inside their owning context or management mode; settings remain a separate utility area.
_Avoid_: Work/Job/Asset object menu, task-and-lead object sprawl, tools as top-level navigation, settings or publication disguised as business objects

**设置工具区**:
The bottom utility area that keeps the four global business destinations visible while a content-local secondary navigation separates account and billing, model preferences and BYOK, and external connections. It owns durable configuration rather than current creation choices and is not a fifth business object.
_Avoid_: 设置接管全局侧栏, 只靠顶部标签承载长设置页, 套餐模型连接混在一页, 通用 Files, 普通用户机构 API Keys, 把后台混入用户设置

**分层同源壳**:
The shared product identity, visual tokens, control semantics, and status language applied across secondary surfaces while preserving three navigation contexts: settings inside the authenticated product shell, role-isolated administration with its own management navigation, and public pricing inside the marketing shell with signed-in plan and usage management inside settings.
_Avoid_: 所有页面强塞四项业务侧栏, 后台伪装成生成工作台, 登录后账户用量留在营销页, 三套互不相干的视觉系统

**同基元不同密度**:
The secondary-surface visual rule that shares product brand, typography, color and focus tokens, icons, control primitives, and semantic status components while allowing settings forms, administrative data tables, and plan comparison to use density appropriate to their task.
_Avoid_: 所有页面复制 Composer, 后台复制运营上下文栏, 套餐页使用管理表格密度, 只共享 Logo 的三套主题

**规范化状态标签**:
The shared presentation of a product status as a Chinese semantic label, icon, explanation, and next action without relying on color alone; raw codes, revisions, timestamps, and correlation evidence appear only as secondary administrative detail.
_Avoid_: 用户页直接显示 recorded 或 trialing, 三色灯压平 unknown/reviewing/retired, 颜色即唯一状态, 后台代码冒充用户文案

**分级变更确认**:
The change-interaction rule in which reversible personal preferences apply immediately, workspace configuration uses an explicit save, and only credential deletion or high-impact platform publication, retirement, rollback, and price changes require a diff, affected scope, reason, and confirmation.
_Avoid_: 所有点击都弹确认, 普通偏好强制填写原因, 全局发布无确认, 浏览器原生 confirm 代替影响审阅

**管理模式**:
The role-gated administration context entered from the authorized user's account menu, with stable routes for overview, model supply, official templates, integration tools, plans and entitlements, and users and audit plus a persistent return to the authenticated workbench. It shares the product design system but never appears as a seventh business destination.
_Avoid_: 产品侧栏管理分组, /admin/p1 单页大 Tabs, 普通用户可见的空后台入口, 仅靠猜测 /admin 地址, 后台复用生成工作台信息架构

**管理员配置中心**:
The visual management surface for platform execution modes, provider credentials, activation evidence, connectors, plans, compliance switches, and operational settings, backed by durable configuration and audit rather than code or environment edits.
_Avoid_: 改代码配模型, 改 env 才生效, 商家设置代替平台管理, 无持久层后台

**平台管理员**:
The global product role that manages platform model channels and credentials, official template releases, platform plan definitions, operations, users, and audit through Management Mode. It is not a workspace membership and does not replace the P1 Product Owner's release authority.
_Avoid_: 工作区 Admin, 门店 Owner, P1 Owner, 任意工作区成员继承平台权限

**工作区 Owner**:
The merchant-scoped role that manages its workspace billing, BYOK credentials, external connections, membership, and workspace defaults without access to platform channels, official-template release, or global plan controls.
_Avoid_: 平台管理员, P1 Owner, 可修改全局模型目录的门店管理员

**工作区 Operator**:
The merchant-scoped role that performs daily creation and operations and manages only personal preferences and shortcuts; it cannot change workspace billing, credentials, connections, membership, or defaults.
_Avoid_: 普通成员可改工作区密钥, 操作员可改账单, Operator 等于 Owner

**工作区 Reviewer**:
The merchant-scoped review role that can inspect assigned content and provide review decisions without mutating configuration, credentials, billing, connections, or model defaults.
_Avoid_: 只读平台管理员, 可发布官方模板的审核员, Reviewer 继承 Operator 设置权

**外部连接**:
A product-managed authorization to an external system, classified as a publication-platform connection or a collaboration/MCP connection. Model execution channels and BYOK belong to model authorization, not this connection category.
_Avoid_: 把模型 Channel 当第三方连接, 发布与 MCP 混成同一状态, 粘贴凭据冒充完整 OAuth

**外部运营提醒**:
A secondary deep-link notification sent through an enabled collaboration connection only when an operation requires user action or reaches a success or failure terminal state. In-product durable state remains authoritative; routine progress and notification delivery never create, complete, or delete the underlying task or result.
_Avoid_: 每次进度都通知, 外部通知即事实源, 通知失败删除任务, 只依赖网页轮询

**内容任务**:
A user-action obligation that stays todo when merely opened, becomes in progress after its first durable action, and becomes done only after explicit user confirmation. A successful Generation Job or external command may satisfy part of the task but never completes the operating obligation by itself.
_Avoid_: Generation Job, 打开即开始, Job 成功即任务完成, 只靠系统自动推进

**内容任务收件箱**:
The P1 operating surface that gathers cross-content work by actionable state and routes each primary action to its owning context: Agent creation record, Asset gap handling, Content review, publication stage, or exception recovery. It is not a generic detail-page gate, customer-message inbox, or Generation Job list. This is the same surface the 2026-07-17 merged authority names 异步收件箱 (D-032 corollary 1): it aggregates per-task pending items across independent workflows and the presentation layer pins exactly one current item at a time; the two names refer to one surface, not two inboxes.
_Avoid_: unified message inbox, P0 async task indicator, 所有任务先开详情, 所有任务都进入 Agent

**内容**:
A user-facing semantic alias for the merchant-owned ContentPackage outcome, carrying draft/version, acceptance, publication state, and attribution. Only an accepted saved version may enter publication preparation. Adopting new text, changing media, or editing an accepted or published Content always creates a new draft version and never mutates the accepted version or its publication snapshot. New canonical writes target ContentPackage only; `ContentItem`, `CreativeContent`, and standalone finished-video records are migration/read-only compatibility sources and do not receive new parallel writes.
_Avoid_: Asset, 画布文档, Generation Job, 临时生成结果, 原地修改已接受或已发布版本

**ContentPackage（内容成品包）**:
The single merchant-owned outcome that groups accepted copy, media, platform variants, revisions, exports, reuse, and withdrawal relationships without creating a second content or asset fact source.
_Avoid_: 结果包临时对象, Content 与 Asset 松散拼接, 多套成品事实, 原地覆盖历史版本

**MarketingPackage（宣发成品包）**:
The marketing-context product name for the same sole ContentPackage aggregate (merged authority 2026-07-17, ADR-0011 unchanged): one directly adoptable main recommendation, selected-platform deliverables, necessary visual/voiceover/shooting guidance, explicit CTA, fact and rights state, quick edits, save/export, async recovery, and make-same. It is a naming alias, never a second aggregate or write target.
_Avoid_: 第二成品聚合, MarketingPackage 与 ContentPackage 双写, 宣发包独立发布状态

**迁移只读来源**:
A legacy product object retained for historical display, audit, and controlled migration into ContentPackage. It is not a new write target and cannot be maintained through parallel writes after the cutover.
_Avoid_: 兼容双写, 旧对象继续主写, 迁移后事实源

**Asset**:
An owned reusable media object with source, provenance, and lifecycle. Uploaded media and generated image or video output become Assets once their bytes are durably persisted and verified; a Work export becomes an Asset only after the exported binary is durably persisted. The same stable Asset identity is projected into the library, search, Job result, Work, and Content references. Adopting a result only creates a relation to that Asset, while not adopting it never deletes or rewrites the delivered Asset.
_Avoid_: 通用 Files 第二事实源, 临时 URL, 导出 receipt, 把内容记录当媒体, 再点一次保存才成为 Asset, Asset 目录与存储回执使用不同身份

**Asset 生命周期**:
The archive-first lifecycle of a durable Asset. Ordinary removal archives the same stable Asset into a recycle-bin scope, hiding it from default discovery and new selection while retained Works, Content, Jobs, and publication snapshots keep resolving it. Permanent binary deletion is an explicit irreversible action after active media dependencies are removed; retained source records keep only a non-reusable provenance tombstone and never cascade-delete.
_Avoid_: 未采用即删除, 归档即断链, withdraw 冒充删除, 永久删除级联抹除 Job 或版本, provider TTL 冒充 Asset 生命周期

**画布作品**:
An editable page-based Composer design document pinned to its template version and referencing Assets. Inserting a generated Asset creates a new Work revision; exporting creates an Asset only after the exported binary is durably persisted. A Work is neither the exported media nor the publishable ContentPackage. Pro Studio's `AdvancedCanvasProject` is a separate server-canonical graph/revision aggregate and must not be renamed to `画布作品` or `WorkRevision`; only an explicit adoption creates a ContentPackage relation.
_Avoid_: 模板本身, 导出图片, Content, 原地跟随模板升级, receipt 冒充导出 Asset

**作品编辑上下文**:
The direct source Work and revision, or standalone source Asset, that determines where an edit may be persisted. Entering from a standalone Asset creates only an edit context; its first durable checkpoint creates a Work. Every shareable or revertible checkpoint freezes a new immutable revision, while transient autosave may update only the current uncommitted edit draft. AI edits create a new Generation Job and output Asset, and only explicit insertion creates the next Work revision. Recent browser state never selects a write target.
_Avoid_: 打开即建 Work 或 revision, 最近 Work 自动接收结果, 原地覆盖 revision, autosave 改写已提交 revision, 改图覆盖源 Asset, sessionStorage 作为写入合同

**Generation Job**:
The persistent execution object that owns a fixed generation request, progress, recovery, and delivery outcome. Its state and result append to the originating Agent creation record without forcing navigation; it may deliver Assets but is never a Content Task, notification, or history fact.
_Avoid_: 内容任务, toast 进度, 历史卡片即事实, 完成后自动跳页, 失败后静默换模型

**Job 恢复与重做**:
The split between continuing the same immutable execution fact and starting a new attempt at the user's goal. Queued, running, stalled, unknown, and cancel-requested states reconcile the original Job; a narrowly safe pre-acceptance provider retry may add an Attempt under that Job without changing its contract. A definite terminal retry, user-requested regeneration, or any input/model/specification/source change creates a newly quoted Job linked by `retryOf` or `derivedFrom`. Partial success retains delivered Assets and retries only failed items.
_Avoid_: unknown 盲目重投, 刷新创建新 Job, 改参数重开旧 Job, 不满意改写成 failed, 部分失败回滚成功 Asset

**生成结果候选**:
A non-canonical selection view inside the originating Generation Job and Agent creation record. Persisted image and video candidates already reference canonical Assets; text and script candidates remain immutable Job snapshots until adoption creates a Content draft or new version. Mixed results group candidate text, Assets, and an optional source Work without creating a result-package object. Adopting establishes references, while rejecting or skipping a candidate does not rewrite the Job or delete delivered Assets.
_Avoid_: 第五种结果对象, 未采用即删除 Asset, 文案候选自动污染内容库, 结果包拥有独立发布状态

**Result Card**:
A reusable projection of one Generation Job and its delivered candidates inside the originating Agent record, Recent view, Job detail, or mobile preview. Its compact layer shows the result, true status, direct source, actual model, completion time, final cost state, and valid next action; requested-to-actual model differences and actionable exceptions stay visible. Full immutable inputs, specifications, user-redacted RouteSnapshot and Attempt evidence, settlement, errors, Assets, and Work/Content relations expand on demand, while physical channels, credentials, and raw provider responses remain admin-only.
_Avoid_: 第五种结果事实, 只给预览不讲模型和费用, 首层塞满后台审计, 各页面复制一套状态机, 暴露物理渠道或密钥

**历史视图**:
A read-only projection across creation sessions, Generation Jobs, Works, Assets, and Content, with its unified “Recent” entry inside the generation workbench. Recent groups one Agent creation activity or explicit source chain into a readable card whose object links resolve to canonical records; it owns no independent state. Asset and Content views link back to sources instead of absorbing history or Works, and all filters are URL-recoverable.
_Avoid_: 独立一级历史页, 历史表成为事实源, 每个工具一套孤立历史, 把作品并入资产类型, Job Asset Work Content 无条件重复四条

**Canonical 对象搜索**:
A rebuildable discovery projection that returns navigable Task, Asset, Work, Content, Session, Job, template, or tool records and always deep-links to their canonical owners. Object pages search their own domains; the global command palette separates navigation from “添加到创作”: Task, Session, and Job are navigation-only, while only compatible Asset, Work, Content, template, or tool results may enter the shared draft. Attempts, receipts, audit rows, provider temporaries, Recent groups, fixtures, and recorded-only results are never promoted into searchable business objects.
_Avoid_: 搜索索引即事实源, Recent 行成为对象, Task 或 Job 黑盒插入草稿, fixture 混入用户结果, 工具各建历史搜索, 无结果补无关内容

**紧凑周条**:
The read-only weekly context made of up to five dated content slots from the current week's 3–5 content set, including weekend or multiple same-day slots where present. Selecting a slot filters its task summary in the operations rail and links to the owning flow, but never schedules, edits, or silently creates work.
_Avoid_: content calendar, calendar editor

**风险感知批量待确认**:
Compatibility wording retained from the earlier P1 prototype. The current decision is that creative authoring, template/image operations, draft creation, and their batch handling are open; price, customer-authorization, medical-beauty, and compliance signals do not create an authoring gate. Only public publishing and backend-autonomous external side effects use action-level confirmation, and this phrase never authorizes public publishing or replies.
_Avoid_: one-click approve all, auto publish

**周内容批次**:
A P1 Agent orchestration record for the store's weekly 3–5 content tasks; it may coordinate planning and bulk creative submission while every item retains its own Content Task, draft, execution contract, Generation Job, failure, and completion confirmation. Missing execution prerequisites exclude only the affected item, and public publication never enters the batch.
_Avoid_: batch production, mass content spraying, 100-variant generation

**批次执行合同**:
The user-inspectable rollup of each weekly-batch item's model, specification, quote, eligibility, and the batch total. One confirmation submits only eligible items; exceptions remain in the same batch record for correction without blocking or rerunning successful items.
_Avoid_: 黑盒批量提交, 任一异常整批停止, 每项重复确认, 总价掩盖逐项报价

**周运营回顾**:
A once-per-week factual recap created as a deduplicated review-confirmation task by the built-in weekend trigger, covering system-known content states, asset gaps, and manually recorded lead activity. Missing evidence stays explicit, and next-week candidates create no task until the user confirms them.
_Avoid_: automatic weekly report, attribution report, business-performance proof

**人工线索**:
A merchant-entered lead fact created and maintained only in the independent lead ledger, with an optional relation to published Content. Publication never creates a lead, the publication flow contains no inline lead form, and absent ledger facts remain unknown in weekly review. Per merged-authority D-030 and the 承接与结果产品面 contract, the current capture surface is one optional row of signal chips (私信/加微/预约/买券/核销/到店；数量、时间、备注均可选) with three source tiers (已验证/门店记录/推断相关性); the ledger never grows into a CRM table, and 金额/联系方式-class fields undergo privacy-and-necessity review at Week 0 preregistration.
_Avoid_: customer message, 自动线索, 发布等于获客, 发布完成卡内录入, 未记录即零, CRM 表格化台账

**内置运营触发器**:
A fixed P1 set of time- and state-based rules that creates deduplicated content tasks and recalls the merchant through the existing connection bridge. Merchants may enable or disable built-ins, but cannot define arbitrary actions, public publishing, or replies.
_Avoid_: reminder hook, custom automation builder, autonomous operation

**账号基础记录**:
The P0 account information stored inside the store profile, including platform, display name, profile URL, certification status, and manual notes.
_Avoid_: account center, account capability matrix

**账号能力页**:
A conditional P1 surface for distinguishing multiple operating accounts or showing an official connection's verified capabilities and health. It exists only when multi-account scope or an official platform connection is locked, and does not imply cloud credential custody.
_Avoid_: account center, credential vault, basic account record

**单店工作区**:
The P1 commercial tenant containing one store and a fixed four-role membership boundary: Workspace Owner, Workspace Operator, and Workspace Reviewer on the merchant side, with Platform Admin kept in the separate global management context. It still allows multiple platform accounts and integration connections, but does not add multi-store, Agency, custom ACL, or feature-based seat tiers.
_Avoid_: team workspace, arbitrary seat plan, multi-store workspace, custom ACL

**运营平台账号**:
A store-owned identity or publishing target on a content platform whose capabilities and health appear on the account capability page. Group webhooks, MCP connections, and BYOK connections are different objects and never count as platform accounts.
_Avoid_: account pack, integration count, workspace member

**高用量 Pro**:
The P1 high-activity single-store plan with the same Composer creative, template, model-choice, and connection capabilities as Growth, differentiated only by larger output allowances, execution priority, and workday priority support. Pro Studio is a separate workspace add-on and is not implied by this plan name.
_Avoid_: team Pro, feature-gated Pro, unlimited support

**产出量额度**:
The merchant-facing usage allowance stated as copy tasks, image outputs, and video outputs or duration: public plans explain representative content outcomes, while the signed-in account projection separates available, reserved, settled, and expiring quantities. Weighted model cost and original provider units remain internal to product and provider ledgers.
_Avoid_: product credits, token balance, 积分余额, 用户页展示 provider cost, 把预留写成已扣除

**动作级权益边界**:
The entitlement check attached only to an action that consumes a priced execution or requests a formally entitled delivery; drafting, templates, editing, user switches, and existing objects stay open, and an insufficient allowance preserves all work while offering an inline plan-management path.
_Avoid_: 页面级付费墙, 套餐不足锁工作台, 禁用水印或 AIGC 开关, 弹窗销毁草稿, 把套餐提示写成合规门禁

**集成凭据库**:
The P1 workspace-scoped secret boundary for OAuth tokens, webhook secrets, MCP credentials, and BYOK keys, with Product Core holding authorization metadata and references while a mature secret manager holds values.
_Avoid_: Browser Profile Vault, plaintext connection settings, third-party authorization truth

**工单临时客服访问**:
A time- and action-bounded support access grant attached to a specific merchant ticket, visible to the owner and fully audited without making support a workspace member or exposing secret values.
_Avoid_: Support Admin, permanent impersonation, shared merchant login

**动作级风险权限**:
The fixed P1 authority boundary assigned per operation and external side effect, not a merchant-selected global autonomy mode. Creative authoring and editing remain open; unknown or sensitive autonomous external actions default to individual confirmation or denial, and public publishing and replies are never automatic.
_Avoid_: three permission modes, Execute mode, global autonomy switch

**AI 预填可编辑默认值**:
Form fields filled with realistic AI-generated defaults that the user edits in place, with persistent helper text and a revert-to-AI action.
_Avoid_: placeholder examples, empty form

**连接桥**:
The recall and integration bridge to tools merchants already use: Feishu or WeCom webhooks in P0, extended by the P1 general connection MCP direction.
_Avoid_: in-app inbox, personal WeChat automation

**人工洞察**:
The P0 lead-loop summary produced by the merchant or pilot operator from manual lead records and content outcomes.
_Avoid_: automatic weekly report, attribution report

**流内自由追问口**:
The persistent free-text input shown at the result stage for long-tail steering such as “改得更活泼一点”. Submitting it derives a new Work/revision with source lineage and inherited confirmed brief, then launches the existing Harness; it does not create a chat thread or a second message-based source of truth.
_Avoid_: thread-as-primary, message log as workflow truth, 原地覆盖结果, 无血缘重写

**Day-0 平台默认供给**:
The platform-owned model bindings provisioned for a verified workspace so its positive trial allowances are immediately usable without BYOK. Every modality whose trial allowance is greater than zero requires a validated platform default; a zero-allowance modality may remain unbound, while a configured default is still validated and stored.
_Avoid_: 四模态一律硬要求, 缺零额度 Audio 阻断开通, 租户凭据充当平台默认, 未验证即标可用
