# 来源登记与证据边界

- 登记日期：2026-07-17
- 目的：保存可复用的一手来源，并明确每份来源能支持什么、不能推导什么
- 检索方式：本地资料优先；Firecrawl/网页检索发现；OpenCLI 通过 Chrome 扩展读取关键动态页面；只将有效一手资料纳入本表

## 来源权威性等级

| 来源等级 | 含义 | 使用方式 |
| --- | --- | --- |
| A | 官方标准、指南、产品文档、平台规则或代码文档 | 可支持能力存在、规则内容或通用设计原则 |
| B | 同行评审/正式研究、官方系统卡 | 可支持人因、风险或评估方法；注意样本与任务边界 |
| C | 成熟产品行为 | 可支持一种交互/工作流模式已经被产品化；不能证明本项目用户同样需要 |
| D | 基于多份来源与本项目约束的设计推断 | 必须标注“待验证”，不能写成行业事实 |

本表的字母首先描述来源权威性。任何“是否适合本项目、是否应引入、应如何建模”的判断，即使依据 A 级官方文档，结论本身仍属于 D 级设计推断；只有本地代码已直接证明的现状不属于推断。官方产品文档描述产品行为时统一标 A，并在“边界”列说明外部有效性，不再使用未定义的组合等级。

## 本轮证据纠偏

Phorest 与 Fresha 的官方文档只能证明“预约照片如何授权”“员工怎样上传作品、门店怎样选择展示”这些局部能力存在。它们不能证明中国美业普遍采用“技师采集 → 顾客授权 → 店长策展”的内容生产组织，更不能据此定义本产品主链。

本项目关于美业产品主链的更强证据来自既有本地竞品实探、试点手册和产品设计：核心经营结果一直是咨询、加微、预约、团购券、核销和到店；高频候选场景一直包括项目/服务曝光、热点或同城借势、品牌/个人 IP、促销团购和日常宣传物料。顾客授权因此只在成品命中特定顾客案例、肖像、评价或服务记录时作为条件门。

## 本项目已有宣发产品证据

以下资料是本项目已完成的本地实探与综合分析，不冒充外部一手行业统计。它们用于恢复既有产品判断，并指导下一轮真实门店验证。

| 本地资料 | 已有证据 | 本轮使用方式 | 边界 |
| --- | --- | --- | --- |
| [`references/creatok/reports/creatok-productization-architecture-gap-analysis.md`](../../creatok/reports/creatok-productization-architecture-gap-analysis.md) | 美业到店链路、项目套图、线索台账、场景包 v1；结果信号包括私信、评论、加微、预约、团购券、核销和到店 | 定义“广告曝光 + 到店引流”主链与成套物料输出 | 属于竞品映射和项目设计，不证明各场景真实频率 |
| [`references/creatok/reports/creatok-function-breakdown.md`](../../creatok/reports/creatok-function-breakdown.md) | 趋势/灵感入口、参考结构 + 本店上下文 + 差异化改写、项目套图与本店爆款复用 | 支持“热点 × 本店资产”和“做同款”产品模式 | CreatOK 面向 TikTok 电商，行业对象和平台能力不能照搬 |
| [`references/analysis/15-pilot-playbook.md`](../15-pilot-playbook.md) | 从选题、素材、平台到发布，并记录私信、加微、预约、买券、核销、到店的 4 周试点方法 | 定义真实宣发任务日志、转化信号关联与验证指标 | 是待执行/持续验证的研究设计，不是已完成的因果证明 |
| [`references/benchmark/ui-adaptation-study-2026-07-08/`](../../benchmark/ui-adaptation-study-2026-07-08/) | 示例起步、业务目的分类、Auto 默认、最少素材、视觉预设、做同款和完整成品优先 | 定义 AI 原生前台的低门槛入口 | 证明竞品交互模式，不证明美业用户一定采用 |
| [`references/analysis/07-domain-data-model.md`](../07-domain-data-model.md) | 小红书、抖音、点评/美团、微信私域的平台变体与 Beauty Skill Pack | 约束后台平台适配和行业资产版本化 | 数据模型不能反向决定前台工作流 |
| [`references/analysis/10-graphic-renderer-selection.md`](../10-graphic-renderer-selection.md) | 封面、价格卡、长图等稳定营销物料及素材权利、价格来源门禁 | 支持“一次宣发任务，多种宣传物料” | 是技术选型研究，不证明具体物料频率 |
| [`references/analysis/vozeb-borrowing-report-2026-07-15.md`](../vozeb-borrowing-report-2026-07-15.md) | 热门结构仅作内部策展参考，发布内容必须授权或原创；优秀结果可晋升为商家资产 | 约束热点借势与做同款的版权、原创和资产化边界 | 不能把抓取到的内容直接当可发布模板 |

## OpenCLI 一手页面快照

下列页面由 OpenCLI v1.8.6 通过已连接的 Chrome 扩展在 2026-07-17 读取。快照便于后续离线复查；原站仍是最终权威。

| 来源 | 本地快照 | 等级 | 支持的结论 | 边界 |
| --- | --- | --- | --- | --- |
| [Google PAIR：Feedback + Control](https://pair.withgoogle.com/guidebook-v2/chapter/feedback-controls/) | [`raw/google-pair-feedback-controls/article.opencli.md`](./raw/google-pair-feedback-controls/article.opencli.md) | A | 隐式/显式反馈分开；单次行为可能是临时好奇；说明反馈改变什么和何时改变；平衡自动化与控制 | 通用 AI UX 指南，不是美业专项实验 |
| [assistant-ui：Tool UI](https://www.assistant-ui.com/docs/tools/tool-ui) | [`raw/assistant-ui-tool-ui/article.opencli.md`](./raw/assistant-ui-tool-ui/article.opencli.md) | A | Tool UI、`human()/resume()`、AI SDK v7 approval、approval options；持久化完全由 host 拥有 | 证明组件能力，不证明整体接入适合本项目 |
| [Cloudflare Workflows：waitForEvent HITL](https://developers.cloudflare.com/workflows/examples/wait-for-event/) | [`raw/cloudflare-workflows-wait-for-event/article.opencli.md`](./raw/cloudflare-workflows-wait-for-event/article.opencli.md) | A | CF Workflows 可以持久等待外部事件并设置 timeout | 示例不解决业务授权、版本绑定、数据库双写和运行时迁移成本 |
| [Phorest：预约照片与分享权限](https://support.phorest.com/hc/en-us/articles/360018118860-How-do-I-add-photos-to-a-client-s-appointment-PhorestGo-Portfolio) | [`raw/phorest-appointment-photo-permission/article.opencli.md`](./raw/phorest-appointment-photo-permission/article.opencli.md) | A | 使用顾客案例素材时，权限可绑定单次预约；不同预约可不同；未授权时隐藏分享能力 | 仅支持条件式素材权利门；不是中国法律结论，也不能定义通用宣发流程 |
| [Fresha：团队专业档案](https://www.fresha.com/help-center/knowledge-base/team/611-put-your-team-in-the-spotlight-with-enriched-profiles) | [`raw/fresha-team-profiles/article.opencli.md`](./raw/fresha-team-profiles/article.opencli.md) | A | 特定团队作品可由员工上传、门店选择公开展示，员工 IP 与门店展示存在权属边界 | 仅支持特定员工素材管理；不能证明中国门店普遍由技师采集、逐级策展或愿意承担该工作 |

## Human-AI 交互与反馈治理

| 来源 | 等级 | 使用结论 |
| --- | --- | --- |
| [Microsoft HAX：Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/) | A | 适应、纠错、反馈、解释和全局控制应分别设计 |
| [HAX：Support efficient correction](https://www.microsoft.com/en-us/haxtoolkit/guideline/support-efficient-correction/) | A | 用户发现错误后应能快速纠正 |
| [HAX：Support efficient dismissal](https://www.microsoft.com/en-us/haxtoolkit/guideline/support-efficient-dismissal/) | A | AI 不需要的输出应能轻量忽略或关闭 |
| [HAX：Scope services when in doubt](https://www.microsoft.com/en-us/haxtoolkit/guideline/scope-services-when-in-doubt/) | A | 不确定用户目标时缩小作用域或消歧，不宽泛猜测 |
| [HAX：Learn from user behavior](https://www.microsoft.com/en-us/haxtoolkit/guideline/learn-from-user-behavior/) | A | 可从行为改善体验，但需与控制、透明度共同设计 |
| [HAX：Encourage granular feedback](https://www.microsoft.com/en-us/haxtoolkit/guideline/encourage-granular-feedback/) | A | 对当前输出提供细粒度反馈入口 |
| [HAX：Update and adapt cautiously](https://www.microsoft.com/en-us/haxtoolkit/guideline/update-and-adapt-cautiously/) | A | 长期适应必须谨慎，避免一次行为导致大范围变化 |
| [HAX：Provide global controls](https://www.microsoft.com/en-us/haxtoolkit/guideline/provide-global-controls/) | A | 用户可查看、调整或关闭系统级行为 |
| [HAX：Make clear why the system did what it did](https://www.microsoft.com/en-us/haxtoolkit/guideline/make-clear-why-the-system-did-what-it-did/) | A | 允许解释当前结果受哪些事实与规则影响 |
| [Google PAIR：Mental Models](https://pair.withgoogle.com/guidebook-v2/chapter/mental-models/) | A | 让用户理解系统会收集、推断和保留什么 |
| [Google PAIR：Explainability + Trust](https://pair.withgoogle.com/guidebook-v2/chapter/explainability-trust/) | A | 解释应帮助用户判断与行动，而不是只展示技术信息 |
| [Google PAIR：Design Patterns](https://pair.withgoogle.com/guidebook-v2/patterns) | A | 具体交互模式参考 |
| [Apple HIG：Machine Learning](https://developer.apple.com/design/human-interface-guidelines/machine-learning) | A | 用可理解选项弥合预测和真实意图，避免不必要的置信度展示 |
| [Apple HIG：Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai) | A | 生成内容附近提供编辑、撤销、重试、调整；事实任务使用已验证信息 |
| [Stanford HAI：Humans in the Loop](https://hai.stanford.edu/news/humans-loop-design-interactive-ai-systems) | B | selective inclusion、agency、控制粒度的人因参考 |
| [Buçinca 等：To Trust or to Think](https://arxiv.org/abs/2102.09692) | B | 认知强制可降低对错误 AI 的过度依赖，但会牺牲部分易用性；只用于高风险节点 |

## 治理、权利、可追溯与批准

| 来源 | 等级 | 使用结论 |
| --- | --- | --- |
| [NIST AI Risk Management Framework](https://airc.nist.gov/) | A | 角色、监督、测评和风险治理基线 |
| [NIST Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) | A | 来源、时间戳、修改、权利、反馈和 TEVV 证据要求 |
| [OpenAI Practical Guide to Building Agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/) | A | 按权限、可逆性和财务影响划分人工介入 |
| [OpenAI Agents SDK JS：HITL](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/) | A | `needsApproval`、interruptions、approve/reject、序列化 RunState 和稍后恢复 |
| [OpenAI ChatGPT Agent：User Confirmations](https://deploymentsafety.openai.com/chatgpt-agent/user-confirmations) | A | confirmation recall 可作为安全评估指标 |
| [Anthropic：Building and deploying trustworthy agents](https://www.anthropic.com/research/trustworthy-agents) | A/B | 逐动作确认可能造成疲劳，计划级审阅与按需中断有价值 |
| [Anthropic：Measuring agent autonomy](https://www.anthropic.com/research/measuring-agent-autonomy) | B | 熟练用户的监督方式会变化，必须同时提供进度、暂停与审计 |
| [Auth0：Asynchronous Authorization](https://auth0.com/ai/docs/intro/asynchronous-authorization) | A | 异步同意、外部身份与 deterministic authorization 层 |
| [Auth0：Secure HITL interactions](https://auth0.com/blog/secure-human-in-the-loop-interactions-for-ai-agents/) | A | 人工批准仍需认证、授权和精确上下文，不由 LLM 决定权限 |
| [OWASP Agentic Applications Top 10 2026](https://genai.owasp.org/download/52117/?tmstv=1765059207) | A | 最小权限、过度代理、确认与平台级策略防护 |

## 前端与协议组件

| 来源 | 等级 | 使用结论与边界 |
| --- | --- | --- |
| [AI SDK UI](https://ai-sdk.dev/docs/ai-sdk-ui) | A | 项目现有主通信层；支持 typed message、tool/data part 和流式 UI |
| [AI SDK：Generative User Interfaces](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces) | A | 领域卡片可直接由现有 AI SDK 驱动 |
| [AI SDK：useChat](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat) | A | 客户端工具输出、审批响应与消息状态 API |
| [AI SDK：Resume Streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams) | A | 字节流恢复需要额外存储，不能代替业务工作流恢复 |
| [assistant-ui：Tools](https://www.assistant-ui.com/docs/tools) | A | Tool renderer、human tools 和 backend tools 的模式参考 |
| [assistant-ui：Tool UI](https://www.assistant-ui.com/docs/tools/tool-ui) | A | 审批和 human/resume 组件能力；持久化由 host 管理 |
| [assistant-ui：Generative UI](https://www.assistant-ui.com/docs/tools/generative-ui) | A | Tool UI 与 Data UI 的边界；最终业务卡更适合后端 data event |
| [assistant-ui：Architecture](https://www.assistant-ui.com/docs/architecture) | A | 整体接入会带来新的线程/消息状态，应谨慎 |
| [assistant-ui GitHub](https://github.com/assistant-ui/assistant-ui) | A | 维护和 MIT 许可核验入口 |
| [AG-UI：Introduction](https://docs.ag-ui.com/introduction) | A | 未来多 runtime/多客户端协议参考 |
| [AG-UI：Interrupts](https://docs.ag-ui.com/concepts/interrupts) | A | 跨 run interrupt、response schema、expiry、approve-with-edits |
| [CopilotKit：useHumanInTheLoop](https://docs.copilotkit.ai/reference/v2/hooks/useHumanInTheLoop) | A | 完整 HITL Hook 存在，但会引入整套 runtime |
| [OpenAI ChatKit JS](https://openai.github.io/chatkit-js/) | A | 可证明其提供完整聊天壳、线程和 Widget；“不适合本项目成品优先工作台”是 D 级适配判断 |

## 工作流组件

| 来源 | 等级 | 使用结论与边界 |
| --- | --- | --- |
| [Temporal TS：Message Passing](https://docs.temporal.io/develop/typescript/workflows/message-passing) | A | Signal/Update、validator 与 durable workflow 的成熟参考 |
| [Temporal TypeScript SDK](https://github.com/temporalio/sdk-typescript) | A | MIT；TS Worker runtime 要求是未来引入门槛 |
| [Inngest：waitForEvent](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event) | A | 等待、timeout 和事件关联；仍需 outbox 与业务 Receipt |
| [Inngest：Idempotency](https://www.inngest.com/docs/guides/handling-idempotency) | A | 去重窗口和限制需单独考虑 |
| [Inngest：Self-hosting](https://www.inngest.com/docs/self-hosting) | A | 自托管依赖与 Cloud 能力边界 |
| [Trigger.dev：Wait for token](https://trigger.dev/docs/wait-for-token) | A | waitpoint token 与浏览器完成模式；token 不等于用户授权 |
| [Trigger.dev：Idempotency](https://trigger.dev/docs/idempotency) | A | 任务幂等模式参考 |
| [Cloudflare Workflows：Overview](https://developers.cloudflare.com/workflows/) | A | Cloudflare 托管耐久执行能力 |
| [Cloudflare Workflows：Events and parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/) | A | event wait、timeout 和实例定向 |
| [LangGraph JS：Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) | A | interrupt 恢复会重跑节点，副作用必须幂等 |
| [LangGraph JS：Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) | A | checkpoint/time travel 适合推理图，不替代业务版本 |
| [Mastra：Workflow snapshots](https://mastra.ai/en/reference/workflows/snapshots) | A | 可证明 suspend/resume 与 snapshot 能力；“会与现有层重复”是 D 级适配判断 |

## 记忆、检索和评测组件

| 来源 | 等级 | 使用结论与边界 |
| --- | --- | --- |
| [LangMem：Conceptual guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/) | A | semantic/episodic/procedural memory、profile/collection、后台抽取；应用特定治理仍必须自建 |
| [LangMem GitHub](https://github.com/langchain-ai/langmem) | A | MIT；偏 Python，适合作为候选抽取 spike |
| [Mem0：Controlling memory ingestion](https://docs.mem0.ai/cookbooks/essentials/controlling-memory-ingestion) | A | 自动摄入会把推测压缩成事实，必须过滤和控制 |
| [Mem0：Memory decay](https://docs.mem0.ai/platform/features/memory-decay) | A | “检索即强化”不适合直接驱动本产品偏好 |
| [Mem0：Memory evaluation](https://docs.mem0.ai/core-concepts/memory-evaluation) | A | 通用 benchmark 不能替代领域 false-memory 测试 |
| [Mem0 OSS License](https://github.com/mem0ai/mem0/blob/main/LICENSE) | A | Apache-2.0 OSS；Platform 专有能力另计 |
| [Graphiti GitHub](https://github.com/getzep/graphiti) | A | Apache-2.0 时序图和 provenance；抽取边不等于真实事实 |
| [Zep FAQ](https://help.getzep.com/faq) | A | 当前 Zep 是 Cloud/BYOC，旧 CE 已弃用 |
| [Letta memory blocks](https://docs.letta.com/guides/core-concepts/memory/memory-blocks) | A | Agent 可写、并发 last-write-wins，不适合作为共享事实权威 |
| [Letta Evals](https://docs.letta.com/guides/evals/concepts/overview) | A | 可以直接评估内部 memory state，而非只看最终回答 |
| [OpenTelemetry：Handling sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/) | A | 最小化、过滤、hash、redaction；OTel 不是业务账本 |
| [Langfuse：Observability](https://langfuse.com/docs/observability/overview) | A | Trace 与可视化 |
| [Langfuse：Scores](https://langfuse.com/docs/evaluation/scores/overview) | A | 代码、人工和模型评分 |
| [Langfuse：Experiments](https://langfuse.com/docs/evaluation/experiments/data-model) | A | Dataset/Experiment/expected output 的回归体系 |
| [Langfuse Core License](https://github.com/langfuse/langfuse/blob/main/LICENSE) | A | MIT Core；企业目录商业许可，生产采用需区分 |
| [Emmett GitHub](https://github.com/event-driven-io/emmett#why-theres-no-license) | A | 官方明确当前没有许可证，因此不得进入产品依赖候选 |

## 美业、平台与协作产品

| 来源 | 等级 | 使用结论与边界 |
| --- | --- | --- |
| [Phorest：预约照片与授权](https://support.phorest.com/hc/en-us/articles/360018118860-How-do-I-add-photos-to-a-client-s-appointment-PhorestGo-Portfolio) | A | 顾客案例素材命中后的 per-appointment permission 与未授权时能力移除；不能外推为默认宣发流程 |
| [Fresha：团队专业档案](https://www.fresha.com/help-center/knowledge-base/team/611-put-your-team-in-the-spotlight-with-enriched-profiles) | A | 特定员工作品的上传、门店展示与权属边界；不能外推为中国门店普遍分工或产品主链 |
| [抖音生活服务：丽人商家经营指导](https://lifexue.com/knowledge/detail/133415) | A | 职人轮流出镜、单镜头模板和门店操作障碍的官方案例；旧材料不能作为 2026 合规依据 |
| [抖音生活服务：职人账号协议](https://lf3-cdn-tos.draftstatic.com/obj/ies-hotsoon-draft/local_bussiness/126d8262-0a60-43ff-9a7d-de945c13e942.html) | A | 个人职人号与商家职人号的权属和解绑差异 |
| [小红书：企业员工账号说明](https://school.xiaohongshu.com/helper/detail/2051) | A | 企业员工账号与个人授权账号的解绑/运营人边界 |
| [美团：服务零售履约规则](https://rules-center.meituan.com/m/detail/guize/102?commonType=3) | A | 交易快照、价格、套餐、预约、时长和适用范围是经营事实 |
| [Buffer：Notification Publishing](https://support.buffer.com/article/658-using-notification-publishing) | A | 手机通知交接和原生平台最后发布；是否适配国内平台需另验 |
| [Planable：Approve a post](https://help.planable.io/hc/en-us/articles/21715469772188-Approve-a-post) | A | 指定审批人、批准记录、可选多级审批；不证明本项目需要多级审批 |
| [TikTok Business Center：Security best practices](https://ads.tiktok.com/help/article/best-practices-for-securing-your-business-center) | A | 最小权限、成员清理和非授权变更监控 |
| [工作社交媒体身份管理研究](https://journals.sagepub.com/doi/pdf/10.1177/20563051241277313) | B | “我是谁、谁在看、发哪里、如何理解、希望带来什么”五个身份判断轴；不是中国美业比例证据 |

## 本项目代码与文档证据

以下是本次组件适配结论依赖的当前本地事实，未来代码变化后应重新核验：

| 路径 | 证据 |
| --- | --- |
| `apps/core/package.json` | AI SDK、pg-boss、PostgreSQL、Zod 等现有依赖 |
| `mkfast-template-main/package.json` | React 19、AI SDK 7、Base UI、Sonner、TanStack 等前端栈 |
| `apps/core/src/p1/model-supply/ai-sdk-runner.ts` | 结构化提案、3 个候选、只提议不自动应用 |
| `apps/core/src/p1/model-supply/composed-video-workflow.ts` | 持久 draft/confirm/job、人工选择和恢复 |
| `apps/core/src/p1/job-runtime/runtime-comparison.ts` | pg-boss 作为主 durable queue 的既有比较 |
| `apps/core/src/p1/integrations/application-service.ts` | 抖音 snapshot revision/hash 批准与字段变化失效、飞书意图确认 |
| `apps/core/src/p1/integrations/operations-confirmation-task-adapter.ts` | 持久高风险确认任务和 immutable intent |
| `packages/contracts/src/content-package.ts` | ContentPackage version、rollback、derived/reverted 引用 |
| `mkfast-template-main/src/product/copy-candidate-selector.tsx` | 候选比较、单选采用、付费重做确认 |
| `mkfast-template-main/src/product/creation-assistant.tsx` | 现有领域卡片形式；接受动作仍 local-only 的断点 |
| `mkfast-template-main/src/product/async-task-center-model.ts` | 当前人工等待与 recoverable 混用，需拆 `needs_decision` |
| `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（第二部分：决策日志） | D-001 起的产品、上下文、资产与 HITL 决策（原独立决策日志已并入） |

## 需要定期复核的来源

以下信息具有高漂移风险，正式采用或上线前必须重查：

- 抖音、小红书、美团的账号、内容、履约与合规规则。
- AI SDK、assistant-ui、AG-UI、CopilotKit 等快速更新包的 API 与版本兼容。
- Langfuse、Mem0、Zep、Inngest、Trigger.dev 的 Cloud/OSS 能力和商业许可。
- Cloudflare Workflows、Temporal 和 Agent runtime 的运行时支持范围。
- 中国顾客肖像、个人信息、医疗美容宣传与素材授权要求。
