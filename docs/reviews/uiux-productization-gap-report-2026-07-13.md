# 产品化与 UIUX 差异复核报告（2026-07-13）

> 状态：历史决策输入。Path B 方向与 token 级流式仍由 ADR-0010 约束（wayfinding「Job 级进度条、无 token 流式」口径已废；合并权威版 D-032 进一步把 token 流式会话层升为一等公民）；旧执行票已由 2026-07-15 提交行政关闭。当前产品决策以 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（合并权威版：产品设计 + 决策日志 D-001 起持续追加）与 `PRODUCT.md`、`CONTEXT.md` 为准（Wave 1 执行合同另有执行权威口径，见合并权威版头部与 D-026）。**阅读提示**：§2.2 所引 D4「3 选 1」候选政策已由 D-023 取代（默认一个主推荐、备选按需展开；单选采用/换一批/免费重试 ≤2 的采用机制不变，见 ADR-0010 第 3 条附注）；§2.2 建议的「模块多选构建器 / 提交前成套结构预览 / 继承字段默认勾选」等表单化改造路径已被 D-031（前台无槽位填表、结构化输入融入对话流）取代，不再照单执行；§2.1 最短路径中的 `generateObject` 在 ai@7 已 deprecated（D-035，按现行 API 书写）。

> **范围**：本报告做两件事——(1) 复核 ADR-0006/0007/0008 与《合集-v1.5-P0 决策定稿》里每一项拍板选型是否真正进入工程落地；(2) 把当前产品对照 CreatOK / KickArt（及即梦 / 可灵 / Higgsfield 登录态实测）逐项量出"不像成熟产品"的具体差距。目的是产出一份可供**升级改造决策**直接拍板的差距底账与路径菜单。所有结论均可回溯至代码行号与文档出处，不含推测性判断。

## 目录

- **一、执行摘要** —— 五种可复现的工程根因
- **二、点名问题直接回答** —— 流式输出 · CheckBox 模式
- **三、选型落实核对表** —— 逐条拍板项 ✅/⚠️/❌ 落实核对
- **四、差距清单（一）P0** —— 第一眼即损害"成熟产品感"或阻断核心价值（7 条）
- **五、差距清单（二）P1 / P2** —— 明显落后但有替代路径（12 + 5 条）
- **六、升级改造决策菜单** —— 三条改造路径（A/B/C）供拍板
- **七、附录：证据源与方法** —— 五路成功源 + 对抗验证方法

**收敛统计**：五路候选原始 **40 条** → 索引级去重合并 **24 条** → 对抗验证后存活 **24 条**（判定分布：confirmed 8 · partial 16 · refuted 0）。

---
## 一、执行摘要

两轮开发（P1 35 票 + UIUX cutover）后仍"不像成熟产品"，从 24 条差距的分布看，问题不在单点功能缺失，而在五种可复现的工程模式。选型本身大体正确（ADR-0006/0007/0008 有留痕、对标 CreatOK/KickArt/即梦有登录态实测），差距集中在"决策到落地"的传导链断裂。

**根因一：选型停在文档层，未落成工程约束（拍板≠进工程票）。** ADR-0007 钦定 Vercel AI SDK 承担 P0 全部 AI 面，实际后端 `apps/core` 声明 `ai ^7.0.19` 却全仓零 `from 'ai'` import，真实 LLM 是自写 `OpenAiCompatibleLlmExecutionPort` 单次 fetch；前端根本没装 AI SDK，装的是 `@tanstack/ai` 0.14.0 且仅营销 `/ai` 页在用（#10 confirmed）。prompt-kit/Streamdown/@streamdown-cjk/ai-elements 三个 AI 展示库全线未采购、全 src 零命中（#6）。选型有 ADR，却没有一张验收票把"装了要用、采购要接"钉成 Done 标准，于是"装了不用"的死依赖与现状长期背离。

**根因二：验收只验"功能存在"，不验"接进主路径 / 体验质感"。** 模型视觉卡、模板画廊（#9）、预设卡（#19）、检索台、全局 ⌘K（#15）大量组件在 `p1/index.ts` 桶导出、却零 JSX 消费者——核心路径 `routes/dashboard/index.tsx:39 → UnifiedCreationWorkbench` 一个都看不到；fixture/本地测模式下核心生成闭环整条跑不通、提交按钮永久禁用（#1）。验收在问"组件写了吗"，没问"接进核心路径了吗、第一眼达标吗"。

**根因三：前后端接线断层——后端能力就绪，前端未消费。** 视频成片工作流后端就绪、前端零接线，遗留同步 18 分钟阻塞旧轨（#8 confirmed）；durable job 后端有 pg-boss+tracer，前端却靠手点"核验原 Job 进度"按钮、无 `refetchInterval` 自动轮询（#7）；后端已定义 `streamRunEvents` Port 方法而前端未订阅。能力造好了，但没人负责接到界面。

**根因四：停在"模板贴功能"，未做产品化改造。** TanStarter 模板品牌全站残留、对外首页仍是脚手架 Demo（#3）；demo 页 `/ai` 加旁路 fal 通道绕过 ModelSupply 治理（#12）；模型卡暴露 `recorded-*-copy` 内部标识（#21）；产品层 71 文件零接 paraglide、中英混杂（#11）；空态文案"在 Agent 工作台采用候选后会出现在这里"暴露内部流程概念（材料E）。是在模板上加业务代码，而非把模板改造成美业产品。

**根因五：决策层内部未对齐，埋下重复返工。** UIUX wayfinding（07-11）反向收敛到"Job 级 progressbar、全文档无 token 流式承诺"，与 ADR-0007 + 合集定稿的 token 逐字流式钦定直接冲突（#2 upgradeHint）。上游两份决策文档就没对齐，下游实现自然分裂——这是升级改造前必须先解的前置项，否则改一版返一版。

（材料E 截图独立佐证：最新 dogfood 首屏已从"任务收件箱"改成"一句话开工"输入框，方向对了，但仍无任何真实成品视觉、残留"空工作区 E0/输入不会自动创建对象"工程黑话——印证"方向选对、传导未完成"。）

## 二、点名问题直接回答

### 2.1 流式输出

**当初怎么拍的。** ADR-0007:11-15 拍板副驾 chat 用 `streamText`+zod tools、流水线 LLM 步骤用 `generateObject` 出结构化内容卡；合集-v1.5-P0决策定稿.md:1346/1350 把"SSE 经 BFF 透传稳定性"列 Week-1 spike 第 1 题、"Streamdown+cjk 中文逐字流出无乱码"列第 5 题；00-合成-UI适配与组件选型.md:11 明文把"流式逐字浮现 + 分步白话叙事"定为非技术用户感知"AI 正在为我干活"的第一眼价值第一信号。即：token 级流式是选型里被反复钦定的核心承诺，非可选项。

**现状是什么（P0 confirmed）。** 前端全 src grep `useChat/useCompletion/streamText/useObject/EventSource/text-event-stream` 零命中（`ReadableStream` 仅 mail/storage 无关处）；后端 `ai ^7.0.19` 声明却零 import，真实 LLM 走 `OpenAiCompatibleLlmExecutionPort`，docstring 自证"intentionally performs exactly one HTTP request"、单次 fetch 无 `stream:true`、`await response.text()` 整块解析、一次性返 3 候选（adapters.ts:212-214/253-274/295/308）；`copy.generate` 以 `estimatedSeconds=12` 同步返回，商家盯着约 12 秒等待后结果一次性整块渲染。全链路无 token 流式。（诚实修正：库内确有一个 `text/event-stream` 端点 server.ts:945-957，但属已退役诊断回放——相邻 resume 返 410 RETIRED、dump 快照即 end、前端无 EventSource 消费，不构成 chat/copy 的 token 流式。）

**对标怎么做。** benchmark 六条硬结论之首 = 所有成熟产品皆异步渐进反馈：KickArt 提交后进入 Agent 分步对话、过程即可视化对话内容；火山 AgentKit 官方"执行过程可见整个 Agent 执行链路"，落到非技术用户译成"正在帮你想卖点…出了 3 版你挑一版"拟人化旁白；即梦首页默认 Agent 模式、教学式话术边聊边出。需诚实指出：CreatOK 的真实运行态 UI 无证据（01-creatok-core-journey-audit.md:125-131 判 UNKNOWN），它是"契约状态 9 枚 + task ID 恢复"而非 token 逐字流——所以 token 流式的正面样板是即梦/KickArt Agent 对话，不是 CreatOK。

**差距定性与最短修复路径。** 定性：P0、第一眼价值第一信号直接落空，是老板"差距很大"的最硬命中点。最短路径：①副驾 chat 按 ADR-0007 用 `streamText` 跑在 Workers 壳内（AI SDK Workers 兼容，直接消除 SSE 透传风险）；②文案生成走 `generateObject` 的 `useObject` 做部分对象流式（3 候选边生成边浮现）；③先 copy-in 接 prompt-kit `ResponseStream` + Streamdown-cjk 打通 spike 第 5 题的中文逐字渲染。**前置阻断项**：必须先对齐两决策层——UIUX wayfinding(07-11) 已偏到"只承诺 Job 级 progressbar、无 token 流式"，与 ADR-0007 直接冲突；不先裁决口径就动手，会重复返工。

### 2.2 CheckBox 模式

老板点名的"CheckBox 模式"有两种合理理解，分开回答。

**理解一：生成参数的"多选勾选构建"形态（核心命中 #18，P1 confirmed）。**
- 当初怎么拍：promises 04 矩阵（04-creatok-adaptation-matrix.md:69）承诺"把 CreatOK A+ 式模块构建器改造为美业内容套组，提交前先看成套结构"；三铁律含"Hook 独立成槽"（合集:121）；08-tool-template-remix-prototype-record.md:69-76 承诺继承字段"A/B 快速带入默认勾选 4 项（内容结构/版式槽位/文案骨架/输出规格）、C 从 0"。
- 现状：grep `套组/成套/模块组合/moduleCombination` 于 product+p1 前后端零命中；主 Composer 的 operation 是大按钮单选（文案/图片/视频，setOperation 整体替换），无"提交前勾选组合成套结构"的多选构建器。关键反差——产品里确实有 checkbox，但用错了位置：码内 checkbox 只承担执行合同确认门（unified-creation-workbench.tsx:897 `quoteAccepted`）、解构台继承字段、任务批量选、asset/admin，加上品牌水印/AIGC 双 Switch，全是设置型开关（材料E对照组3 实测"竖排传统表单：下拉+textarea+3 checkbox"），不是内容模块的成套勾选。继承字段还只落地了"C 从 0"（selectedFields=[]），承诺的 A/B 默认勾 4 项缺失。
- 对标：CreatOK A+ 内容页 LIVE = 16 个可选模块、默认已选 5/16，提交前展示模块组合与 6 张示例角色，商品套图页另有 0/16 素材入口 + "智能匹配/自定义配置"两种结构（01-creatok-core-journey-audit.md:245-247）；Higgsfield 把广告拆成 Style/Hook/Setting 三语义槽位而非预设大墙。
- 关联缺口 #19（P1 confirmed）：与"勾选构建"配套的"选中命名预设→提示词框整个消失"机制（可灵/Higgsfield 双登录态实测直证，合集:339 落定"意图框不是提示词框"）未进主创作路径，预设卡组件 `AiImageSelector`/`TemplateCatalog` 建好但零 JSX 消费者、未接线。
- 定性与最短路径：成套模块多选构建器"完全缺失"（confirmed），非退化。最短路径：为"内容套组"引入模块多选构建器（核心几项默认勾选 + 提交前成套结构预览），把"大按钮单发"升级为"成套结构"；同步接线预设卡、实现"选中预设即隐藏提示词框、只留传图/生成"；继承字段补齐 A/B 默认勾 4 项。

**理解二：候选内容的"勾选采用"交互（决策口径问题，非纯实现缺口）。**
- 当初怎么拍：D4 候选策略拍板"文案/创意一次 3 条 + 换一批（消耗按 1 次计）、视频分镜确认后成片单发 + 免费重试"（docs/adr/0008:52；合集:327-333）——即文案是"3 选 1 单选"范式，本就不是勾选多选采用。
- 现状：后端 `copy.generate` 确已返回 3 候选（adapters.ts:308 整块），产品也存在"采用候选"动作（材料E对照组4 空态文案"在 Agent 工作台采用候选后会出现在这里"佐证有此流），但材料未详证采用 UI 的具体形态（勾选多选 or 单选），此点不臆断。
- 定性与建议：若老板预期的"CheckBox 模式"指"生成后勾选采用多个候选"，这与 D4 已拍板的"文案 3 选 1 单选、视频单发"是决策口径分歧，而非实现遗漏——应先确认预期是否要改 D4，再决定是否引入多选采用，不宜直接当 bug 补。
## 三、选型落实核对表

以下逐条核对材料 A（ADR/合集-v1.5-P0决策定稿）里的每一项拍板选型，对照材料 B（前端 mkfast-template-main）、材料 C（后端 apps/core）证据及本人复核（grep/Read）判定落实状态。图例：✅ 落实 · ⚠️ 部分落实或偏离 · ❌ 未落实或与决策相悖。

| 选型决策 | 出处 | 落实状态 | 现状证据 |
|---|---|---|---|
| Agent Runtime = Vercel AI SDK 承担 P0 全部 AI 面（副驾 chat=streamText+zod tools、流水线=generateObject）；Mastra 推迟不否决 | ADR-0007:11-15 | ❌ | `apps/core` 装 `ai ^7.0.19` 却全 src 零 import；`streamText/generateObject`/`from 'ai'` 0 命中；真实 LLM=自写 `OpenAiCompatibleLlmExecutionPort` 单次 fetch、无 `stream:true`（adapters.ts:212-274）；无副驾 chat。Mastra 未引入=符合"推迟" |
| Runtime Port 铁律：业务只依赖 `ContentWorkflowRunner` 接口，6 方法（generateWeeklyContent/rewriteContent/createPublishPackage/cancelRun/approveRun/streamRunEvents） | 合集:1317-1326;ADR-0007:14 | ⚠️ | 存在 `class ContentWorkflowRunner`(index.ts:2618)+`PersistentContentWorkflowRunner`(postgres-repository.ts:935)，main/worker 依赖之；但为具体类非接口 Port，方法为 `runVideoWorkflow` 等，决策所列 6 方法 0 命中、`streamRunEvents` 不存在（与无流式一致）；"不 import runtime"因 AI SDK 全未接入属空满足 |
| 编排层 = Postgres durable_jobs + 自研薄 step-runner + promptfoo 接 CI；成片流水线抄 ad_video_gen 三件套 | ADR-0007:12-13,19;合集:1315 | ⚠️ | durable 底座扎实落实：pg-boss+Postgres tracer 表+独立 worker 9 类 handler+7 态状态机、可恢复对账（main.ts:257-266;job-worker.ts:307-353）；但 promptfoo/Langfuse 观测未见交付证据，成片流水线（composed-video）后端就绪、前端 0 消费（下文行 17） |
| UI 底座 = mkfast（TanStack Start+React 19+Tailwind 4.1+Base UI 版 shadcn，禁 Radix asChild） | 合集:1250;mkfast-ui-baseline.md:7,52 | ✅ | components.json `style=base-nova`，底层原语 `@base-ui/react ^1.5.0`（Radix 仅剩 react-slot）；53 个 ui 组件按 Base UI 组合 API。底座事实成立；模板"零 streaming/chat"亦属实 |
| AI 展示组件库 = prompt-kit copy-in 主力 + Streamdown + @streamdown/cjk + AI Elements 单件 | 合集:1251,1254;ai-ui-libs-review.md:44,98-107 | ❌ | package.json 与全 src 三库 0 命中；AI 结果层裸 `whitespace-pre-wrap` 纯文本（unified-creation-workbench.tsx:1074）。注：项目另有可用的自建静态 Markdown 栈（unified+remark+rehype+prose，已用于 blog/changelog）但未接入 AI 结果层，且【流式】富排版能力仍缺（材料 D，verify=partial） |
| 生成式 UI 路线 = AI SDK UI（useChat+tool parts 三态+data parts reconciliation+useObject）；RSC/streamUI 禁入生产 | 合集:1252;00-合成:13,71 | ❌ | `useChat/useCompletion/useObject` 0 命中，无 tool parts 状态机；生成链路=命令-失效-重取（useMutation→invalidateQueries→useQuery 整包重取，结果一次性整块渲染，unified-creation-workbench.tsx:365-416,332-336）。RSC 未用=符合禁令 |
| 组件库避坑：不引 assistant-ui/CopilotKit/AutoForm/Origin UI/LlamaIndex chat-ui 等；Tremor 放缓改 Recharts | 合集:1258;ai-ui-libs-review.md:10-11,100-105 | ✅ | 依赖审计"无 assistant-ui/ai-elements/@ai-sdk"，被否决库均未引入。Tremor→Recharts 本次未复核 |
| 流式输出：SSE 经 BFF 透传（spike 第 1 题，fallback 直连 Node）；逐字浮现+分步白话叙事=第一眼价值第一信号 | ADR-0006:11,24;合集:1346,1350 | ❌【老板点名】 | 全站无流式（无 useChat/EventSource/streamText）；后端唯一 `text/event-stream` 端点 GET /v1/diagnostics/:id/events 是回放式假流、且功能已 410 退休（server.ts:945-958,472-484），前端代理路由为死代码；逐字浮现与副驾对话完全不存在 |
| 异步任务四态卡（排队/生成中白话叙事·禁假百分比/完成/失败）+ 退款分层 | 00-合成:72;合集:120③,1290 | ⚠️ | 有统一 StatePanel 五态+Skeleton+Progress；但 content-task-inbox.tsx:272-274 直接渲染 `{task.progress}%` 百分比、ai-image-selector.tsx:248-249 同——与"禁假百分比、改白话阶段叙事"相悖；"生成中阶段叙事"无流式/无自动刷新支撑，靠手动"核验原 Job 进度"按钮；退款分层未见证据 |
| D3 分页骨架：1 Agent 工作台 + 3 轻资产页；对话式外壳、结构化内核；不设独立副驾浮层——工作台即副驾 | 合集:122,311,676;ADR-0008:18,52 | ⚠️ | 确有单一"生成工作台"为桌面主入口 + sidebar（但为 6 项业务导航，非"3 轻资产页"）；结构化内核扎实（甚至过度）；但"对话式外壳"未落地——工作台是"对象记录流"，agent/direct 仅参数切换、无对话 UI，"工作台即副驾"因无对话 agent 而落空。老板所指"传统 SaaS/卡片痕迹"正指此 |
| Agent 工作台三段：①拟人化问候+今日建议 chips ②中央意图框"说说你想发什么"三喂料+场景 chips ③创作流对话式时间线+右下异步浮标 | 合集:313-316,667-669,1263 | ❌ | 空态=静态标题"把一句想法变成可恢复的内容对象"+"一句话开工"卡（Textarea+复用来源 chips+本机文件/链接+agent/direct 切换，Read :491-640）；无拟人化问候、"今日建议"0 命中、无场景 chips 横滑（引流/种草/促销/复购）；建立 Work 后为纵向 RecordSection（Intent/References/Reuse/Composer/Job/Results/Next）非对话式时间线；右栏 300px OperationsRail 非右下浮标 |
| 选项交互 = 降门槛（L0-L4 梯度；三铁律=字段永不留空默认 Auto/渐进展开/Hook 独立成槽；选中预设即隐藏提示词框） | 01-合成:54-83;合集:121-122 | ❌【老板点名 CheckBox】 | Composer 是"显式合同确认式表单"：operation 大按钮卡+原生 `<select>`（模型/规格，:782/803/821）+Switch（水印/AIGC）+原生 `<input type=checkbox>`（执行合同确认，未勾禁止提交，:897）；无 L1 语义槽位/Hook 独立成槽/选中隐藏提示词框机制；字段无"默认 Auto"预填 |
| AI 预填可编辑字段（可编辑真实默认值+一键 revert-to-AI+价格红线字段隔离） | 00-合成:16,82;合集:120① | ❌ | Composer 字段为空表单/原生控件，未见 AI 预填默认值、AI 字段标记或 revert-to-AI；无生成式 UI 支撑（未见落实证据） |
| 对标即梦/可灵/Higgsfield：选中命名预设→提示词框消失；预设卡自带"该传什么图"引导；保结构化骨架四层软化 | 01-合成:37-50,86;合集:339 | ⚠️ | "结构化骨架"保住（甚至过度）✅；但"选中预设隐藏提示词框""预设卡引导传图"依赖预设/模板机制，而 TemplateCatalog、AiImageSelector（RadioGroup 模型卡）已建但无路由消费者、未接线（p1/index.ts）；抄的降门槛机制未落地 |
| 对标 KickArt（范式参考+视频第三候选、不订阅套壳）/ CreatOK（轻框架+单体部署佐证；冷启动预置"示例美甲店"） | ADR-0008:40;ADR-0007:7;合集:122,290,1381 | ⚠️ | 策略层符合：未见 KickArt API 依赖=不套壳；单 Node core 服务单体部署+不引重 agent 框架=符合 ADR-0006/0007（材料 C）。但 KickArt"Agent 工作台范式"落地不足（外壳未 AI 原生）；"预置示例美甲店"未见证据 |
| 视频成片链路（AIDA 四段分镜→首帧→片段→ffmpeg 薄壳合成→R2）+ 动态模型目录、显式解析不静默切换 | ADR-0008:10,14,44-45;合集:791,1381 | ⚠️ | 后端 composed-video 全链路命令/查询就绪（video_workflow_create_draft/confirm/select_candidate）但前端 `video_workflow` 0 命中、整条闲置；P0 旧轨 video-jobs/:id/render 为同步长 HTTP、Ark provider 进程内轮询默认 18 分钟超时、浏览器一 fetch 挂到出片（server.ts:731-918;ark-provider.ts:218-246）—异步/同步范式未收敛。显式模型"不静默切换"=ai-image-selector 明示（:117-142）✅ |
| Week-1 证伪 spike 六题（流式透传/generateObject 中文/暂停恢复/PWA-Serwist/Streamdown-cjk/视频 POC） | 合集:1344-1351 | ⚠️ | 对应能力多未落地：流式（①⑤）全站无、generateObject（②）后端未接入、视频 POC（⑥）后端链路在但前端未接；暂停/恢复（③）有 durable jobs 支撑。未见 spike 交付物/结论文档 |
| 移动端与可达性：bottom nav 5 槽新建 / vaul Drawer / 大字号触区 / 系统字体栈 / react-dropzone+shadcn-dropzone 上传 | 合集:676,1253,1256-1257;shadcn-eco-mapping.md:32,58-61 | ⚠️ | 有专门移动分流 MobileActionBook（三阶段，mobile-action-book.tsx:97）但非决策所述"5 槽 bottom nav"；vaul `^1.1.2` 已装 ✅；react-dropzone/shadcn-dropzone 未装（0 命中），上传未用指定库；大字号触区/系统字体本次未逐一复核 |
| 视觉点睛（Magic UI/Aceternity 限 1-2 处懒加载）+ 额度话术（产出量口径，禁积分/credit/token） | 合集:1255,1517,1271;shadcn-eco-mapping.md:43-45 | ⚠️ | Magic UI/Aceternity/BorderBeam/Confetti/AnimatedShinyText 全 0 命中—点睛动效未引入（低优先项）；额度话术口径本次未复核 |
| 前端其余选型+拓扑：TanStack Query+Zustand / TipTap+Novel / satori→resvg→sharp 导出 / qrcode.react；Workers 壳+单 Node+单托管 PG+R2 适配器 | 合集:1240-1244,1253;ADR-0006:11-20 | ⚠️ | 拓扑=Workers 壳(BFF)+单 Node core+Postgres+R2 落实 ✅（材料 C）；TanStack Query ✅；但 Zustand/TipTap/Novel/satori/resvg/sharp 未装（0 命中），qrcode 已装但为 `qrcode` 非 `qrcode.react`。satori 导出链属"Go 后主链路"、P0 有意后置=部分符合决策 |

### 核对结论

- **整体落实（对内/工程/合规层）**：后端 durable 任务编排底座（pg-boss+Postgres tracer+7 态状态机）、运行时拓扑（Workers 壳+单 Node+单 Postgres+R2）、UI 底座（Base UI 版 shadcn）、组件库避坑（被否决库无一引入）、可追溯治理（polotno 导出证据链、模型显式解析不静默切换）——这些选型基本按 ADR 落地，工程质量高。
- **系统性缺失（流式/生成式 UI 层）**：整条链路全线未落地——Vercel AI SDK 装了却零 import，`streamText/generateObject/useChat/useObject` 全 0，逐字浮现与副驾对话完全不存在，唯一 SSE 端点是已 410 退休的回放假流。**此即老板点名的"流式输出"。**
- **系统性缺失（AI 原生外壳层）**：D3 拍板的"对话式外壳/工作台三段（问候+今日建议 chips+对话式时间线）"落成了"对象记录流+显式合同确认表单"，Composer 仍用原生 `select`/`Switch`/`checkbox`（勾选执行合同才可提交）——**即老板点名的"CheckBox 模式"**；L0-L4 降门槛梯度（选中预设隐藏提示词框/AI 预填）基本未实现，配套 AiImageSelector、TemplateCatalog 已建却未接线。
- **部分落实/偏离**：Runtime Port 有 runner 类但非决策所述接口 Port 且方法面不符；四态卡"禁假百分比"被 `{task.progress}%` 违背；视频成片链路后端就绪却前端整条闲置，且与 P0 同步长请求（最长 18 分钟一 fetch）未收敛。
- **一句话**：越靠近"后端/工程/合规"越贴合 ADR，越靠近"用户第一眼的 AI 原生体验（流式、对话、降门槛）"越系统性缺位——差距集中在**体验层而非底座层**。
## 四、差距清单（一）P0 —— 第一眼即损害"成熟产品感"或阻断核心价值

本节 7 条 P0 均经代码/文档/截图逐条复核。验证状态标注：`confirmed`＝结论完全成立；`partial`＝核心成立但原始表述有失准，已在"现状/验证状态"中据实修正，不改其 P0 定级。唯 **P0-7 经复核建议从 P0 降级**，理由随条列出。排序按验证可靠度与老板点名议题（流式）的相关度，非原始录入序。

### P0-1 副驾对话与文案生成缺 token 级流式，"第一眼价值第一信号"落空

已合并：①流式架构完全缺失＝12 秒白屏；②实时进度反馈缺失＝文案 12 秒白屏、Job 靠手点核验。

- **期望**：ADR-0007 拍板副驾 chat 用 `streamText`、pipeline 用 `generateObject`（`docs/adr/0007-agent-runtime-ai-sdk-first.md:11-15`）；`合集-v1.5-P0决策定稿.md:1346,1350` 与 `00-合成-UI适配与组件选型.md:11` 把"流式逐字浮现+分步白话叙事"定为非技术用户感知"AI 正在为我干活"的第一眼价值第一信号；`prompt-kit ResponseStream` + `Streamdown/@streamdown/cjk` 已选型待采购（Week-1 spike 题5 专验中文逐字流出）。
- **现状**：前端全 src grep `useChat/useCompletion/streamText/useObject/EventSource/text-event-stream` 零命中（`ReadableStream` 仅 mail/storage 无关）；后端 `package.json:25` 声明 `ai ^7.0.19` 却 `from 'ai'` 零 import，真实 LLM 调用走自写 `OpenAiCompatibleLlmExecutionPort`，注释明写"intentionally performs exactly one HTTP request"（`apps/core/src/p1/model-supply/adapters.ts:212-214`），单次 fetch 无 `stream:true`（253-274）、`await response.text()` 整块解析（295）、一次性返 3 候选（308）；工作台 `estimatedSeconds:12`（`unified-creation-workbench.tsx:135`），用户盯约 12 秒后结果一次性整块渲染。
- **对标参照**：benchmark 六条硬结论之首＝所有产品皆异步渐进反馈；KickArt Agent 分步对话可视化 / AgentKit 拟人化旁白 / 即梦 Agent 默认逐字。
- **验证状态**：`confirmed`。逐条核到底站得住：前端无任何 token 流式 API 及 prompt-kit/streamdown 引用；后端 port 已接线非死代码（`adapters.ts:1587`）。唯一疑似反证 `server.ts:948` 的 `text/event-stream` 实为已退役诊断回放（950-957 dump 后 end，961-973 返 410 retired），前端零 `EventSource` 消费，不构成 chat/copy 的 token 流式。微瑕不影响结论：`@ai-sdk/mcp` 确有 import（用于飞书、非 ai 包非流式），"12 秒白屏"措辞略重。
- **升级方向**：副驾 chat 端点按 ADR-0007 用 `streamText` 跑在 Workers 壳内消除 SSE 透传风险；文案走 `generateObject` 的 `useObject` 做部分对象流式；先接 `prompt-kit ResponseStream + Streamdown-cjk` 打通 spike 题5。⚠️须先对齐两决策层：UIUX wayfinding(07-11) 已反向偏到"Job 级 progressbar、全文档无 token 流式承诺"，与 ADR-0007 直接冲突，不对齐会重复返工。

### P0-2 TanStarter 模板品牌全站残留，对外首页第一眼是脚手架 Demo

- **期望**：dogfood 已发现 TanStarter Demo logo（评审焦点）；成熟产品对外页面须品牌一致，标题/logo/social/邮箱应全部替换为美业内容品牌。
- **现状**：营销 i18n 文案仍为『认识 TanStarter』『完整的 TanStack Start SaaS 模板』，`site_name` 字面即『TanStarter Demo』（`zh.json:406-407,410,724`）；`footer.tsx:103` 全站渲染 `<BuiltWithButton />`，输出 `/tanstarter.png`+硬编码『TanStarter』（`built-with-button.tsx:16-17`，非走 `m.built_with_brand()`，该 i18n key 属并存死残留）；`public/tanstarter.png` 在册。截图：dogfood `initial-dashboard.png` 已改品牌名"美业内容簿"+灯塔 logo，但底部 footer 与 i18n 仍残留。
- **对标参照**：无专项 benchmark；基准＝成熟产品品牌一致性。
- **验证状态**：`partial`。三处引用逐行精确命中，主结论铁证成立。唯一失准：actual 摘要句"social/邮箱全 tanstarter.dev"不严谨——邮箱确为 `support@tanstarter.dev`、twitter/youtube 确为 TanStarter 账号但域名是 `x.com/youtube.com`；而 `github=github.com/MkFastHQ`、`discord=mksaas.link` 实为 MkFast/mksaas 另两个第三方模板品牌（`website.ts:58-77`）。该误差反而说明残留品牌不止一家、污染范围更广。
- **升级方向**：全量替换 i18n 文案/logo/social/邮箱为美业内容品牌，删除 built-with 按钮与 public demo 资产，并连 MkFast/mksaas 残留一并清除。

### P0-3 结果区与历史区不渲染成品缩略图，视觉创作产品看不到自己做的图/视频

- **期望**：Result Card 首层须承接预览/摘要（`09-asset-result-history-decision-record.md:122-146`）；对标 CreatOK 全局资产库画廊、即梦作品缩略图墙（`01-creatok-core-journey-audit.md:139-146`）。
- **现状**：核心创作页 `unified-creation-workbench.tsx:1045-1105` 结果区、历史页 `canonical-history-page.tsx` 及 Asset/Content/Job 详情页均零 `<img>`：图片/视频 asset 仅渲染标题 + `Asset {id}·{kind}` 或 `Asset：{assetIds.join(', ')}`（history:359）ID 串 + `whitespace-pre-wrap` 正文；Asset 详情页只显 `objectKey`+SHA-256、从不渲染图本身（最强证据）。截图：current `08-content-library` 全文字卡零缩略图、`21-readonly-demo-content` 的 4 素材+3 内容卡仍纯文本，对标 benchmark `09-gallery` 缩略图墙。数据侧 `Asset.objectKey` 与后端 `/v1/assets/{objectKey}`（`server.ts:421-454`）均已存在，故为纯前端渲染缺失。
- **对标参照**：CreatOK 资产库画廊 / 即梦作品缩略图墙 / KickArt 灵感视频墙。
- **验证状态**：`partial`。核心（结果/历史零成品缩略图）成立并被加固（后端有服务端点＝纯前端缺失而非数据缺失，成色更足）。事实错误：actual 称"product/ 仅 4 处 `<img>`"不成立——product/ 实为 0 处（与其自身 grep 自相矛盾）；那 4 处在 p1/（`ai-image-selector` 等），经 barrel 导出但无 route 引用＝未挂载死代码；讽刺的是 `AiImageSelector:254` 本会用 `<img src={job.assetUrl}>` 渲染成品缩略图却从未接入。
- **升级方向**：结果卡与资产库按 `asset.kind` 渲染媒体缩略图，接 `GET /api/core/p1/assets` 代理，图片/视频走画廊网格 + lightbox。

### P0-4 Composer 一次性平铺完整技术表单，违反自定「渐进展开」铁律

已合并：主 Composer 的模型/画面规格退化为原生 `<select>`，与 chip 点选/默认 Auto 的选型共识背离。

- **期望**：L0-L4 降门槛梯度＋三铁律（字段永不留空默认 Auto/渐进式展开/Hook 独立成槽）（`合集-v1.5-P0决策定稿.md:121-122`；`references/benchmark/ui-adaptation-study-2026-07-08/01-合成-生成式平台降门槛与主入口调和.md:54-83`）；对标 Higgsfield「传图→选预设→出片」三步、可灵选预设即隐藏提示词框、字段默认 Auto。
- **现状**：建立 Work 后 Composer 段（`unified-creation-workbench.tsx:752-932`）一次性平铺 operation 按钮卡 + 模型原生 select（782-798）+ 画面规格/场景 select + 品牌水印/AIGC 双 Switch + 执行合同 checkbox + 提交，无 L0 场景货架/折叠/选预设隐藏字段的渐进展开外壳。截图：current `05-video-models` 为光秃原生 select"Seedance 2.0"零辅助信息，对标 CreatOK 富卡片（图标/标签/积分/匹配度%）。
- **对标参照**：Higgsfield/可灵（选预设隐藏提示词、字段默认 Auto）；CreatOK 16 选项模型过载＝负面基线。
- **验证状态**：`partial`。核心"渐进展开缺失、无降门槛外壳"成立（违反铁律②，专业参数默认收起未实现），两轮 remediation（bc8f937/3ad57b5）未触及此处、未过时，属真实 P0。但"违反默认 Auto"半个论点有实质误差：①参数字段多数有默认值（aspectRatio `3:4`、AIGC 开、operation `copy.generate`；215-217/211）非留空逼选；②把"模型无 Auto/不使用跨品牌 Auto"当违反证据系混淆两层 Auto——铁律的 Auto＝字段智能预填（分析文档 80 行明证），模型跨供应商 Auto 被合规明确禁止（`workbench:830-838`"系统不会静默切换供应商"），属被豁免的刻意设计。另：首屏实为"一句话开工"intent 框，技术表单在建 Work 后才现。
- **升级方向**：引入 L0 场景货架/预设卡作默认态并折叠高级字段与提示词框，字段级 Auto 做默认值，展开后才呈现完整显式合同——保留可追溯性但把首屏认知负担降到"选一张预设+传图"。

### P0-5 AI 展示组件库全线未采购，AI 结果层用裸文本渲染

已合并：prompt-kit/Streamdown 零采购，AI UI 只有 8 张营销 demo 卡。

- **期望**：AI 展示层定稿＝`prompt-kit` copy-in 主力（Markdown/Response/Loader/Steps/ChainOfThought）+ `Streamdown+@streamdown/cjk` 中文渲染 + AI Elements 按需单件（`合集-v1.5-P0决策定稿.md:1251,1254`；`references/benchmark/ui-adaptation-study-2026-07-08/ai-ui-libs-review.md:44,96-108`）。
- **现状**：三库（prompt-kit/streamdown/@streamdown/cjk/ai-elements）全 src 0 命中、零采购；AI 结果展示层（asset.body 等）全部走裸 `whitespace-pre-wrap` 纯文本（`unified-creation-workbench.tsx:1074`；`components/ai/` 的 summarization/translation/caption-card）。
- **对标参照**：无专项 benchmark；基准＝项目自定组件选型定稿。
- **验证状态**：`partial`。三库未采购、AI 结果层裸文本，属实。但"无 Markdown 富排版能力"是误导性归纳：项目已内置完整可用自建 Markdown 栈——`lib/markdown.ts`（unified+remark-gfm+rehype 全套 GFM）+ `components/markdown/markdown.tsx`（`<Markdown>` 组件）+ `@tailwindcss/typography` prose，且已用于 blog/changelog/法律页；标题/列表/强调"全丢"仅因 AI 结果层未接这套现成组件，非项目缺能力。要拿静态 Markdown 富排版无需采购 prompt-kit/streamdown——把 `<p whitespace-pre-wrap>{asset.body}</p>` 换成 `<Markdown content=… />` 即可，成本极低。真正仍缺的是**流式**富排版（ResponseStream 逐字/Streamdown-cjk 未闭合防闪烁），与 P0-1 同源。故 P0 的"零能力"色彩与修复成本被高估。
- **升级方向**：先一行换 `<Markdown>` 拿到静态富排版；再按定稿 copy-in 移植 prompt-kit Response 与 Streamdown-cjk 补**流式**富渲染（与 P0-1 合并推进）。

### P0-6 长任务是"提交—等待—手动点按钮刷新"，无自动轮询也无浏览器推送

已合并：①durable job 后端就绪、前端靠手点按钮刷新且整包 refetch；②分步白话进度旁白未落地、无事件源；③提交到结果间无占位卡、无乐观 UI，命令成功即整包 invalidate。

- **期望**：benchmark 异步任务范式＝提交后产物自动回收（KickArt 右下悬浮任务中心 `kickart-findings.md:18-19,38`；CreatOK 凭 task ID 断点续查 `01-creatok-local-research-supplement.md:89,97-98`）；项目自家原型承诺 running 态 62% 数值 progressbar+可离页（`10-desktop-visual-system-prototype-record.md:119,134`）。
- **现状**：前端全 src 零 `refetchInterval`（唯一 setInterval 是 `pricing-table.tsx:19` 的 useState setter 非定时器）；运行中 Job 靠用户手点"核验原 Job 进度"按钮（`workbench:1005-1020`）触发 `resume_creative_job`，onSuccess 走 `refreshProjection()` 整包 invalidate（332-336,447-465）；后端 Job 状态外发仅 pull 查询 + `WebhookProductNotifier` 飞书/企微 IM 文本推送（`notifier.ts:22-49`，`msg_type:text`，推商家 IM 不推浏览器），无 WebSocket/LISTEN-NOTIFY 到前端；视频侧 `while(true)+sleep` 轮询 Ark，默认超时 18 分钟（`main.ts:561 ?? 1_080_000`）。
- **对标参照**：KickArt 右下任务中心自动回收 / CreatOK task ID 恢复。
- **验证状态**：`partial`。核心成立且属真实 P0，两轮 remediation 未加轮询、未过时。三处证据需修正：①18min 真实出处＝`main.ts:561`，原挂 `ark-provider.ts:218-246` 错位（该处仅轮询循环无字面量）；②按钮文案实为"核验原 Job 进度/只核验不重投"，"刷新状态"在 `ai-image-selector.tsx:270` 另一组件；③库内有一 `text/event-stream`（`server.ts:945-957`）但属已退役 diagnostics（相邻 resume 返 410）、快照即 end 非常驻流、前端无 EventSource 消费，故"无浏览器推送"应限定为 creative 流程。另：全局 `refetchOnWindowFocus` 默认生效，切走再切回会附带刷新，"须反复手动刷"略偏，但非定时轮询非推送，gap 核心不受影响。
- **升级方向**：对 running 态 Job 加 `refetchInterval` 或订阅后端已定义的 `streamRunEvents`(Port 方法)，右下异步任务浮标自动回收产物；后端已有 pg-boss+tracer，补一条状态推送/前端轮询即可，别让 progressbar 只在手动刷新时跳变。

### P0-7 默认开箱缺零配置生成体验（原"闭环整条跑不通"经复核建议降级）

- **期望**：成熟产品克隆即可体验生成（CreatOK 打开即出图 `.scratch/creatok-uiux-wayfinding/assets/01-creatok-core-journey-audit.md:179`）；仓库自身声明的 fixture 走测模式应在 `APP_ENV=e2e` 下跑通 Job→Asset→Content 主链路并明确标"本地可用"（`docs/evidence/browser-dogfood-2026-07-13/report.md:37-40`）。
- **现状**：默认 `.env.example:12 MODEL_EXECUTION_MODE=recorded` 下，模型 `available=false`、工作台提交按钮禁用（`workbench:830-836,921 !selectedModel?.available`），新克隆者零配置开箱体验不到生成闭环——对标 CreatOK/Higgsfield 落差真实。但显式设 `APP_ENV=e2e MODEL_EXECUTION_MODE=fixture` 后，commit `29a0534`（2026-07-13 01:13）已端到端修复：`adapters.ts:1559` fixture→`activation='local_fixture_verified'`→`main.ts:182`/`job-worker.ts:182` `allowRecordedExecution=true`→`foundation-module.ts:471` rank≥2 `available:true`→前端门禁与后端执行守卫双双放行，Job→Asset→Content 可跑通，单测 `foundation-module.test.ts:195` 断言 fixture 下 every `available===true`。
- **对标参照**：CreatOK 打开即创作 / Higgsfield 三步出片。
- **验证状态**：`partial`，**且建议从 P0 降级**。方向对但"永久禁用/整条跑不通"已被最新 commit 推翻，故半真半假。【仍成立】默认 recorded 下开箱无生成体验（一行环境变量即可绕过）；upgradeHint 的"无凭据 seed 通道"与"显式标本地测试可用"文案均未落地；dogfood ISSUE-002 状态仍"修复中"、代码已改但浏览器闭环未重新验证。【已推翻】fixture 模式同样永久禁用/整条跑不通不实。【证据自相矛盾】原 evidenceActual 引 `foundation-module.ts:471` 支撑"禁用"，但该行正是引入 `available:true` 的修复代码；`report.md` ISSUE-002 与修复同一 commit，截图为修复前状态。
- **升级方向**：让 fixture 模式产出的 `available` 布尔与 availability 视图口径对齐并显式标"本地测试可用"；再给一条无凭据可跑的 seed/mock 生成通道让新克隆者体验闭环，同时保住 `live_verified` 生产门禁。
## 五、差距清单（二）P1 / P2

P1 = 明显落后于对标但有替代路径，不阻断上线；P2 = 打磨项。凡标 `[部分核实]` 者，原始条目经代码复核发现有夸大或错指，本段已按更正后的准确口径收窄，不沿用夸大表述。老板点名两项的落点：**流式输出**根因见 P1-1（AI SDK 未落地、无 `streamText`/`useChat`）+ P1-2/3/4（视频同步阻塞、估时失真、无异步回收）；**CheckBox 模式**核心承接见 P1-7（成套模块多选构建器缺失）+ P1-8（预设卡未接线）。

### P1（12 条）

**P1-1 Vercel AI SDK 栈选型落空：后端零 import、前端另装 @tanstack/ai** `[已核实]`
- 期望：ADR-0007 拍板 AI SDK 承担 P0 全部 AI 面（chat=`streamText`+zod tools、流水线=`generateObject`、provider registry 混合路由）+ AI SDK UI（`useChat`/tool parts 三态/`useObject`）。
- 现状：后端 `apps/core` 声明 `ai ^7.0.19` 但全 src 零 import（`streamText`/`generateObject` 我自行 grep=0），真实 LLM 是自写 `OpenAiCompatibleLlmExecutionPort` 单次 fetch（`adapters.ts:212-216`，docstring 自证 one HTTP request），唯一在用 `@ai-sdk/mcp`；前端未装 AI SDK，装 `@tanstack/ai 0.14.0`+`ai-fal` 且仅营销 `/ai` 页用，生产创作台是 react-query 命令-失效-重取，零 `useChat`/tool parts/`useObject`——这是"流式输出"缺位的直接根因。
- 升级：二选一并落文档（正式落地 AI SDK 承接 P0 AI 面 / 或改 ADR-0007 承认自写 port 为准则），清掉"装了不用"的死依赖，止住选型与现状长期背离。

**P1-2 视频成片后端就绪、前端零接线；旧轨仍是同步 18 分钟阻塞** `[已核实]`
- 期望：ADR-0008 视频入 P0 主打，AIDA 四段分镜→合成的 durable 异步链路，15s 视频实测≈18min→"提交即走+任务中心+通知桥"定为生存需求。
- 现状：后端 composed-video 全链路就绪（`video_workflow_create_draft/confirm/select_candidate/cancel` + `DurableComposedVideoApplicationService` + `job-worker` 注册），但前端 `grep video_workflow`=0 完全未接线（我已复现）；唯一出片走旧轨 `POST video-jobs/:id/render` 同步长 HTTP，BFF `await fetch→arrayBuffer` 端到端阻塞，Ark provider 进程内 10s 轮询、默认 18min 超时（`server.ts:731-918`/`ark-provider.ts:218-245`/`main.ts:559-561`）。
- 升级：前端接 `video_workflow_*` 命令/查询 + 异步任务浮标；退役同步 render，视频统一收敛到 durable "提交即走"。

**P1-3 提交前估时是硬编码常量，视频"90 秒"承诺与真实 18 分钟差一个数量级** `[部分核实]`
- 期望：decisions 异步四态卡"禁假百分比"、"不伪造进度"，预期管理须贴近真实（反例 Google Flow 因预期落空致信任崩塌）。
- 现状：前端 `quoteFor` 硬编码 12s/45s/90s 并以"约 90 秒"无条件展示给商家（`unified-creation-workbench.tsx:135/146/153`、`858-859`），后端 `model-supply-creation-adapter.ts:56-61` 同样写死 12/90/45 且强校验前端须传该常量——前后端双硬编码、全链无动态估时源；真实端到端约 18 分钟（项目实测 + 生产超时默认 `main.ts:561 ?? 1_080_000`），90s vs ~1080s≈12×，与"禁假"承诺自相矛盾。**更正**：`timeoutMs` 常量在 `main.ts:561` 而非原引的 `ark-provider.ts:218-246`；结论不变。
- 升级：估时改由后端按模型/媒介真实分布回传，或给区间+阶段白话；视频尤不能标 90s。

**P1-4 无全局异步任务中心/浮标，长任务离页后不可主动回收** `[部分核实]`
- 期望：工作台配"右下异步任务浮标"异步回收产物（对标 KickArt 右下悬浮任务中心；CreatOK 无全局收件箱被判负面基线）。
- 现状：承诺的悬浮任务中心 src 中确无，07-12 两轮 remediation 未新增；运行中 Job 仅在当前 Work 的 Job 段靠手点"核验进度"推进（无 `refetchInterval` 自动轮询）。**更正**：并非零全局入口——存在 `/dashboard/jobs`（`CanonicalHistoryPage mode=jobs`）跨 Work 聚合 jobs+imageJobs 显示 status 且深链可核验，只是未进主导航（`BUSINESS_NAVIGATION` 无此项）、pull-based、无浮标/角标/推送。缺的是"浮标式主动收口+角标+提交即走"而非全局 Job 视图。
- 升级：增全局异步任务中心浮标，跨 Work/会话聚合在跑与新完成 Job + 未读角标 + 一键回源。

**P1-5 主入口缺 Agent 开场引导层：无问候、无今日建议 chips、无场景 chips** `[已核实]`
- 期望：D3 工作台①Agent 拟人化问候+今日建议 chips（2-3 条点选即预填开跑）②中央意图框旁场景 chips 横滑（引流/种草/促销/复购，"全部场景▾"才展开），对标 KickArt 意图框+5 chips+灵感墙。
- 现状：空态首屏为静态标题「把一句想法变成可恢复的内容对象」+ Textarea + 复用来源 chips（仅有史时）+ 文件/链接按钮 + agent/direct 切换（`unified-creation-workbench.tsx:496/573-637`）；无拟人化问候、无今日建议 chips、无场景 chips；"内容场景"是建 Work 后的 select 下拉（`820-826`），非一点即跑。第一眼退回"一个 prompt 框等你写"，正是 D3 要摆脱的传统范式。
- 升级：补 Agent 拟人化开场 + 2-3 条真实运营态势驱动的今日建议 chips + 业务目标场景 chips（点选即预填开跑），把"人写 prompt"变"agent 主动递建议"。

**P1-6 ⌘K 非全局且缺「导航」组，退化为工作台内局部「添加到创作」面板** `[已核实]`
- 期望：全局 ⌘K palette 分「导航（Task/Session/Job/一级页只导航）」与「添加到创作（Asset/Work/模板/工具带入）」两组，货架/⌘K/解构台共享同一目录。
- 现状：⌘K keydown 写在 `CreationShelf` 组件内 useEffect（`creation-shelf.tsx:175-184`），而 CreationShelf 仅在建 Work 后的 Reuse 段渲染（`unified-creation-workbench.tsx:744`，空态/跳过态/非工作台页均不挂）→按 ⌘K 无反应，并非全局；CommandDialog 仅单一「添加到创作」组（templates+tools+references 全为带入语义），无「导航」组，无法 ⌘K 跳转 Task/Session/Job 或一级页。
- 升级：把 ⌘K 提升到外壳全局挂载，palette 分「导航+添加到创作」两组，导航走路由、带入校验执行合同兼容性。

**P1-7 CreatOK A+ 式「成套结构模块组合」多选构建器完全缺失，Composer 只能大按钮单选单发** `[已核实]`
- 期望：promises 04 矩阵承诺"CreatOK A+ 式模块构建器改造为美业内容套组、提交前先看成套结构"（CreatOK A+ 16 模块默认选 5、提交前展示模块组合与示例角色可勾选）。
- 现状：`grep 套组/成套/模块组合/moduleCombination` 于 product+p1 零命中（我已复现，英文别名 bundle/suite/combo 亦 0 业务命中），主 Composer 只用大按钮单选 operation（文案/图片/视频，`752-776`），无"提交前勾选组合成套结构"的 checkbox 多选构建器；码内 checkbox 仅用于解构台继承字段/任务批量选/执行合同确认门/asset/admin，均非套组构建。这是 CheckBox 模式的核心缺口。
- 升级：为"内容套组"引入模块多选构建器（核心几项默认勾选 + 提交前成套结构预览），把"单发"升级为"成套结构"；可与 ticket 07 批量 UI 一并裁决。

**P1-8 「选中命名预设即隐藏提示词框」机制未进主创作路径，预设卡组件建好未接线** `[已核实]`
- 期望：decisions 钦定"选中命名预设→提示词框整个消失"（可灵特效库/Higgsfield 双登录态实测直证），"意图框不是提示词框、不设编辑提示词入口"，预设卡自带"该传什么图"引导。
- 现状：工作台 Composer 是意图 Textarea + 参数表单常驻（`573-581`/`752-934`），无"选中预设即隐藏提示词框"逻辑；`AiImageSelector`（RadioGroup 模型卡）、`TemplateCatalog` 已建但 routes/product 层零消费者（仅 `p1/index.ts` 桶导出），预设卡范式尚未进入主创作路径。
- 升级：接线预设卡并实现"选中命名预设→隐藏提示词框、只留传图/生成"，brief 编译对用户隐形，预设卡带"该传什么图"引导前置卡点。

**P1-9 带缩略图/画廊的模型卡与模板目录已建未接线，核心路径缺视觉化选择** `[部分核实]`
- 期望：模型视觉卡 + 模板画廊是降门槛主入口（对标即梦带预览缩略图视觉卡、CreatOK 模块组合+示例角色画廊）。
- 现状：核心路径（`/dashboard`→`UnifiedCreationWorkbench`）模型选择是纯 `<select>` 下拉（`782-793`）、模板走 CreationShelf 图标+文字卡/命令搜索（`744`），缺带缩略图/画廊的视觉化呈现；`TemplateCatalog`（含缩略图 img `218/385`）、`RetrievalSearch` 已建但零 JSX 消费者。**更正**：`AiImageSelector` 的模型卡是纯文字（厂商/能力/额度，`150-185`）、无缩略图，即便接线也非即梦式预览卡；模板选择功能核心路径已在（缺的是视觉化呈现，非"缺模型/模板选择"）。
- 升级：把模板画廊/视觉卡接线进工作台 Composer，激活已有 UI，并补齐真正的带缩略图模型预览卡。

**P1-10 模板 demo 页 /ai 与旁路生成通道残留，绕过 ModelSupply 目录/配额/审计治理** `[部分核实]`
- 期望：单一受治理生成通道（catalog/配额/审计/live_verified 门禁），不残留模板营销 demo 与平行 AI 花费入口。
- 现状：`/(pages)/ai.tsx` 8 张 demo 卡全注册进 routeTree、路由无鉴权、`sitemap.xml:29` 公开可达，绕过 core ModelSupply（配额/审计/门禁全无）；about/changelog/roadmap/waitlist starter 页仍在。**更正**：旁路是两条而非仅 fal——2 张经 `@tanstack/ai-fal` 直调 fal.ai（`api/ai.ts:327-361/369-398`），6 张经 `runWorkersAi` 直调 CF Workers AI REST（`api/ai.ts:178-188`），旁路面反被低估；三文件自 07-07 Initial snapshot 起未被 07-12 remediation 触及。
- 升级：下线/删除 `/ai` 旁路与无关 starter 页，所有 AI 调用统一走 ModelSupply；确需保留的营销页去 TanStarter 化。

**P1-11 i18n 中英混杂：产品层 71 文件零接 paraglide，baseLocale=en 致首访英文残留** `[部分核实]`
- 期望：采用模板既有 paraglide 统一 i18n；产品面向中国美业商家，中文界面为 P0。
- 现状：paraglide（733 key，en/zh）只覆盖模板营销/认证/settings 外壳；产品核心 src/product+src/p1 共 71 文件零 import、54 文件硬编码简体中文；`settings.json baseLocale=en`+`strategy=[url,cookie,baseLocale]`（无 zh 兜底），首访英文残留、产品层反向不可译（切 en 产品区仍全中文）。**更正**："英文外壳导航与中文业务同屏"被夸大且错指——产品主导航实为硬编码中文（`sidebar-config.ts BUSINESS_NAVIGATION`），被举证的 `dashboard_sidebar_*` 是无调用方的孤儿 key；真英文残留仅限 `sidebar-user` 用户下拉与模板营销/认证页（属产品周边）。
- 升级：baseLocale 切 zh 或 strategy 首选 zh；产品层文案抽入 paraglide（或明确单语中文，外壳统一中文），消除双轨。

**P1-12 移动端 48px 触区与 18-20px 字号承诺未落地（建议降 P2）** `[部分核实]`
- 期望：集中改 Button/Input/Select `h-9→h-12`（≈48px AAA）+ `html{font-size:18-20px}`（承诺<10 文件），面向非技术客群大字号触区。
- 现状：button/input/select 默认变体仍 `h-8`（32px）、无 18-20px 根字号 token（`button.tsx:23-27`），承诺的"改默认变体+根字号"集中方式未落地。**更正**：移动端并非无补偿——`mobile-action-book`/`desktop-relay-page` 对交互控件逐个加 `min-h-11`（44px，全项目 19 处，我已复现），主 CTA 达 WCAG AA、不低于 CreatOK 负面基线，"32px 易误触/比对标更激进"不成立。真实差距=未用集中方式（一致性差易漏）+ 44px 未达承诺 48px AAA + 大字号根字号确未落地；严重性宜 P1→P2。
- 升级：落地控件 `h-12` + 根字号 18-20px 集中改造，按 `@theme` token 统一放大触区。

### P2（5 条）

| 标题 | 现状要点 | 升级方向 |
| --- | --- | --- |
| 统一输入台「三喂料同框」落地不全 `[部分核实]` | 空态意图框「打字+粘贴文本」已由 Textarea 同框承载；欠交付的是「拍照传图做重入口」（本机文件仅 file-pick 不上传、无拖放/粘贴/capture），另有一枚 doc 未要求的「链接」死占位（`unified-creation-workbench.tsx:573-624`）。**更正**：「粘贴 URL 自动抓取」是定稿明确 de-scope 项（降为待研究、URL 抓取列入"剥离不抄"），不作差距。 | 拍照传图一等化 + 图片拖放/粘贴 + 移动端 capture；清掉非功能「链接」占位。 |
| 面向店主的模型卡暴露 recorded-*-copy 内部标识 `[部分核实]` | 设置>模型>文案 LLM 页四张 LLM 卡副标题泄漏内部占位 id「OpenAI · recorded-openai-copy · recorded-v1」（`catalog.ts:218-221` 种子经 `settings-view-model.ts:378-381` 透传、`model-settings.tsx:134-140` 渲染；displayName 已净化、副标题未净化），店主可见。**更正**：图片"硬编码四款"实为 ADR-0008:14 锁定的当前 catalog（非违背动态目录），且 `AiImageSelector` 当前零消费者、未渲染给店主。 | 生产视图净化副标题的 stableModelName/version，内部 id 不外露。 |
| 空态放弃"预置示例美甲店终态"，spec 验收项未回收 `[部分核实]` | 后端 `product-service.ts:113` `exampleStore`「弥鹿美甲示例店」（readOnly、完整档案+4 素材+3 内容卡+1 发布包、hide_example+audit+三处测试）已实现，但前端 `grep exampleStore`=0 完全不消费（我已复现），空态渲染 E0"没有示例 Task/Work/Asset/Content"；wayfinding 07-12 三票又主动"E0 不注入示例"，与后端实现+spec:161/323 三方冲突。 | 前端渲染示例终态 / 给"看示例·做同款"次动作 + 决策与 spec 对齐；成本仅前端渲染+文档对齐，非从零建模型。 |
| 点睛动效层零落地，生成中/发布完成缺情绪锚点 `[已核实]` | package.json/lock 无 magicui/aceternity/confetti/motion；`border-beam/MagicCard/Confetti/AnimatedShinyText` 全 src 0 命中；生成中仅 `animate-spin` 普通 spinner+状态文案，发布完成仅 `toast.success` 无庆祝，state-panel 无 success 态。（合并的"160-220ms 动效 token"是评审建议非定稿承诺，确无 duration 体系。） | 按定稿在生成中(AnimatedShinyText)/发布完成(Confetti)/技能卡墙 1-2 处懒加载点睛，避免全站铺动效掉帧。 |
| 中文字体栈不完整（建议降 P3）`[部分核实]` | 产品外壳字体栈 `styles.css:209-211`（`Inter/PingFang SC/Microsoft YaHei/...`）缺决策点名的 HarmonyOS Sans、MiSans 两档，安卓/鸿蒙/小米走 sans-serif 回退。**更正**："外壳加载装饰字体、未兑现零加载"不成立——product-shell 已覆盖为系统栈不含 Bricolage；Bricolage 为纯西文（无 CJK）、中文永远回退系统字体，"中文界面零加载"实际已兑现。 | 仅补齐 HarmonyOS/MiSans 两档 fallback（建议 P3）。 |
## 六、升级改造决策菜单（供拍板，只给框架不做详设）

三条路径共用同一份差距底账（第四章 24 条），区别只在"一次改多少、验收到哪"。选择本质是三选一的投入—感知曲线，不是方向之争——方向（AI SDK 起步 + Base UI 底座 + copy-in 采购 + Agent 工作台单页骨架）在 ADR-0006/0007/0008 与定稿里已锁死，本轮差距几乎全是"决策已拍、后端多已备、只差呈现与接线"，**升级方向以"接线/补皮"为主、"新建"为辅**。

### 共同前置（无论选哪条都建议先做）

否则任何路径都会重演本轮"矩阵全绿、体验缺席"的结果：

1. **修复"拍板→票"断链**：每条 ADR/定稿拍板项映射到工程票 + 验收条目；无映射的拍板项显式标注"推迟"并回写决策文档，禁止静默遗漏（对应 #12 旁路残留、ISSUE-002 类断链的根因）。
2. **验收矩阵增设"体验合同"required 条目**：流式呈现、生成中阶段叙事、占位卡、chips 点选进入 required——"功能存在≠体验达标"是本轮最贵教训（41 条矩阵全绿仍拦不住流式缺席）。
3. **接线 owner 清点已建未挂能力**：`video_workflow`（成片链路后端就绪前端零引用）、`AiImageSelector`、`TemplateCatalog`、单 Job 查询接口、`RetrievalSearch`——每项要么接线要么裁撤，不留长期悬空（#8/#9/#13/#19）。
4. **模板品牌残留一次性清扫**：TanStarter 全站残留 + `built-with` / footer / `website.config` 脚手架痕迹、`/ai` demo 页与 fal 旁路通道、模型卡 `recorded-*-copy` 内部标识（#3/#12/#21）。
5. **报错兜底与可用性闸**：默认/本地测模式下核心闭环跑不通、提交按钮永久禁用（#1），首屏甩红色 `data is undefined`+JSON（截图实证）——先让核心生成闭环在默认模式可跑通、可截图验收，是后续一切改造的前提。

### 路径 A · 交互层专项改造（流式 + 生成反馈 + 参数形态）

- **范围**（覆盖全部 P0 + 约半数 P1）：① 流式——`streamText` 端点 + prompt-kit `ResponseStream`/Streamdown-cjk copy-in，文案链路先行；后端补 AI SDK import、前端从 `@tanstack/ai` 迁到 `useChat`（#2/#6/#10）；② 生成反馈——占位卡 + 轻量轮询（复用闲置单 Job 查询）+ 阶段字段贯通白话叙事（禁假百分比）+ 右下任务浮标 + 真实估时替换硬编码常量（#7/#13/#17）；③ 参数形态——预设卡"选中即隐藏提示词框"接入主创作路径 + A+ 式成套结构多选构建器骨架 + `AiImageSelector` 富卡替换原生 select（#18/#19/#9）；④ 接线与假实现清理——视频成片分镜动线消费 `video_workflow`、收敛旧同步 18 分钟阻塞轨、结果区画廊缩略图（#8/#4）。
- **粗粒度量级**：以周计的专项冲刺，杠杆率高（多数改造决策与后端能力均就绪）。
- **风险**：低。不碰验收矩阵结构与页面骨架。
- **点名问题覆盖度**：流式 ✅ 全覆盖；CheckBox ⬆️ 覆盖"看得见的多选构建 + 预设卡隐藏提示词"，但"分层默认勾选 4 项 + 继承字段进数据流 + 套组提交前结构预览"这套机制留待 B。
- **遗留**：chips 开场引导、今日建议、货架卡成品预览、AI 预填 revert、候选 3 选 1、视觉/字体/移动可达性、i18n、onboarding 仍缺——与 CreatOK/KickArt 的"点选感 + 成品感"差距约收窄一半。

### 路径 B · 视觉 + 交互全面对齐 CreatOK/KickArt 范式

- **范围**：路径 A 全部，另加——开场引导层（拟人化问候 + 今日建议 chips + 场景 chips 一点即预填，#14）；降门槛层（货架卡成品预览 + 传图引导、AI 预填 + revert-to-AI，#5/#22）；候选层（文案 3 选 1 + 换一批 + 免费重试≤2，#8）；骨架层（⌘K 全局化 + 导航组、异步任务中心收口，#15/#13）；CheckBox 完整层（分层默认勾 4 项真实现 + 继承字段进数据流 + 套组结构预览，#18/#19 补齐）；视觉/可达性层（结果画廊成品感、点睛动效情绪锚点、系统字体栈、移动 48px 触区/大字号，#4/#16/#23/#24）；一致性/合规展示层（i18n paraglide 接入、模型卡标识清理，#11/#21）；统一输入台三喂料真抓取/拍照优先（#20）。
- **粗粒度量级**：相当于第二轮 UIUX cutover，须同步重开验收矩阵补体验维度条目。
- **风险**：中高。范围≈重做交互层，**最大风险是重蹈"票关了体验没到"**——建议以"对标产品逐屏截图验收"替代纯功能验收，期间冻结新功能范围。
- **点名问题覆盖度**：流式 ✅ 全覆盖；CheckBox ✅ 全覆盖（含数据流机制）。

### 路径 C · 渐进打磨（P0 → P1 → P2 三批次，每批可独立叫停）

- **范围**：总范围同 B，拆为三个独立验收批次——第一批 = 7 条 P0（流式、生成反馈、假实现清理、视频接线、结果画廊、主入口平铺收敛；品牌清扫与报错兜底见共同前置）；第二批 = 12 条 P1（含 CheckBox #18/#19、chips、候选、⌘K、移动可达性）；第三批 = 5 条 P2 + 一致性收尾。
- **粗粒度量级**：总量同 B，现金流分摊；每批结束可重估是否继续。
- **风险**：执行风险低、**感知风险高**——第一批交付前产品与今天几乎一样；且本团队历史模式（根因"已建未接线"）说明"渐进"易停在能力层。硬约束：每批验收以**用户可见行为**为唯一标准，禁止以"后端就绪/组件完成"关票。
- **点名问题覆盖度**：流式在第一批即覆盖；CheckBox 落在第二批——若中途叫停，CheckBox 可能不达（这是 C 相对 A 在点名问题上的时序劣势）。

**评审人建议**（供讨论，非替代决策）：A 先行、以 A 的实际耗时与成色校准对 B 的信心，是风险最可控的组合——A 的四个包全部是"决策已拍、后端已备、只差呈现与接线"的高杠杆项；A 如期兑现后再以 B 收尾降门槛层与骨架层。老板两处点名（流式、CheckBox）中，流式在 A、B、C 均首批覆盖；CheckBox 的"可见多选"在 A 即到、"数据流机制"在 A/B 完整、在 C 落第二批。

---

## 七、附录：证据源与方法

### 证据源清单

**五路成功源（五维并行分析，journal 存档见 `archive-evidence-5-sources.md`）**

1. **成熟产品基准（benchmark）**：七份文档覆盖 CreatOK（2026-07-11 登录态 LIVE 审计 + 旧证据复核）、KickArt/AgentKit（火山系 console 只读）、可灵/即梦/Higgsfield（登录态实测），收敛出生成中反馈/参数交互/模型选择器/结果闭环/主入口/移动端六条硬结论——`references/benchmark/ui-adaptation-study-2026-07-08/`、`references/benchmark/ai-native-journey-study-2026-07-08/`。
2. **选型落实（expected）**：ADR-0006/0007/0008 + `合集-v1.5-P0决策定稿.md`（3799 行）+ `docs/specs/beauty-content-agent-p0-spec.md`，四大支柱留痕。
3. **UIUX wayfinding 承诺（expected）**：2026-07-11~12 逐票关闭的实施承诺 + 41 条验收矩阵——`.scratch/creatok-uiux-wayfinding/assets/`（含 IA、统一输入台、结果历史、桌面视觉、冷启动、验收矩阵各原型记录）；**关键旁证**：该批文档无任何 token 级流式（streaming/SSE）承诺，进度仅定为 Job 级数值 progressbar——即流式缺失部分源于承诺侧本就未立项，非纯实现遗漏。
4. **后端代码（actual，`apps/core/`）**：核心发现"后端根本没有流式，双方都停在拉取式"——`ai` v7 零业务 import、唯一 `text/event-stream` 端点是回放即 end 的假流且功能已退休、Job 体系仅 webhook 推商家 IM 不推浏览器、`composed-video` 成片链路后端就绪前端零引用、P0 旧轨同步长请求端到端阻塞 18 分钟。
5. **前端代码（actual，`mkfast-template-main/`，TanStack Start + React）**：交互模式审计——`useQuery` 无 `refetchInterval`、运行中任务须手点按钮刷新、`@tanstack/ai`+fal 平行 demo 通道绕过 ModelSupply 治理。

**截图对比（第六路，补跑）**：原截图证据 agent 因 Fable 5 安全护栏误报中断，由 Opus 模型单独补跑，产出 `.scratch/uiux-gap-screenshot-supplement-2026-07-13.md`；五组逐对观察坐实四点差距——创作入口缺失（首屏为"任务收件箱"而非大 prompt 框）、零成品视觉（灰线框占位 vs 满屏真实成品）、参数形态落后（原生 select/textarea/checkbox vs chip 药丸 + 富卡）、暴露技术脏话（`data is undefined`/"路由信息(可选)"/满配额条 vs 全程零报错留白）。截图三源：`current-product-screenshots/`、CreatOK `screenshots/`、最新 `browser-dogfood-2026-07-13/`。

**中间产物（可回溯）**：`archive-raw-gaps-58.json`（五路原始候选）、`archive-dedup-and-later.json`（合并 + 逐条判定）、`archive-report-v1-single-agent.md`（首轮单 agent 报告，本多 agent 版据其结构重写）。

### 24 条历史差距处置附录（2026-07-19 对账）

本表把本报告的 24 条差距与旧 Path B 承接票、现行代码/决策和仍需保留的残余放在同一处，供离线复核。旧票反查以 `.scratch/uiux-upgrade-b/tickets/INDEX.md` 为准；票 04–25 已按 `docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md` 统一记为 `closed / superseded`。这个状态只表示旧执行集行政收口，**不表示旧 Acceptance、真实供应商、竞品、真机或用户验收自动通过**。

后续 #25–#49 是按 2026-07-17 合并权威设计重新切分的完整功能票，边界与旧 UIUX 缺口不同。除非新票正文明确引用旧差距，**不得为了凑覆盖率虚构“一个旧差距对应一张 #25–#49 新票”的映射**。本表的“现行承载/残余”只提供可在当前仓库离线打开的证据，不替代新票自己的验收结论。

| 历史差距 | 旧主承接票 | 旧票行政状态 | 现行承载或可核验证据 | 当前处置 / 仍保留的残余 |
| --- | --- | --- | --- | --- |
| P0-1 token 级流式缺失 | 06、07 | `closed / superseded` | `apps/core/src/p1/model-supply/ai-sdk-runner.ts`、`mkfast-template-main/src/product/copy-stream.tsx`、`creation-assistant.tsx` | 旧“全链无流式”结论已被后续实现推翻；真实供应商增量输出仍按环境证据单独验，不由旧票关单代替。 |
| P0-2 模板品牌残留 | 04 | `closed / superseded` | 当前 `mkfast-template-main/src/routes/` 已无旧 `/ai` demo 路由；现行品牌与表面约束见 `DESIGN.md` 及 D-042 | 旧产品层模板污染已由后续品牌批次接管；营销页或新表面若再出现残留，按现行设计回归处理，不重开旧票。 |
| P0-3 结果/历史零成品缩略图 | 17 | `closed / superseded` | `mkfast-template-main/src/product/canonical-media-gallery.tsx` 及其在 workbench/history/object page 的消费者 | 已有真实媒体画廊、预览和兜底；旧结论已失效。 |
| P0-4 Composer 平铺技术表单 | 12 | `closed / superseded` | D-031、D-042；`mkfast-template-main/src/product/creation-entry.tsx` 与 `unified-creation-workbench.tsx` 的渐进区块 | 原修法被“结构化输入融入对话流”取代；现行验收应防槽位表单回潮，而不是恢复旧表单清单。 |
| P0-5 AI 结果裸文本 | 08 | `closed / superseded` | `mkfast-template-main/src/components/markdown/ai-markdown.tsx`、`copy-stream.tsx` | 流式 Markdown/CJK 展示已进入主路径；真实流质量仍随 P0-1 的运行环境证据判断。 |
| P0-6 长任务手刷、无主动回收 | 09 | `closed / superseded` | `mkfast-template-main/src/product/creative-job-observer.ts`、`async-task-center.tsx`；Core SSE 通道 | 自动轮询、SSE 和全局任务中心已有现行载体；跨端待处理决定的完整收件箱属于后续独立能力，不等同于本旧差距。 |
| P0-7 默认开箱闭环缺口 | 05 | `closed / superseded` | ModelSupply fixture/activation 测试与 `mkfast-template-main` E2E fixture | 本地 fixture 闭环可测；`fixture` 不是生产供应商证明，`live_verified` 仍须凭真实环境证据。 |
| P1-1 AI SDK 选型落空 | 06 | `closed / superseded` | `apps/core/src/p1/model-supply/ai-sdk-runner.ts`、`apps/core/src/p1/harness/structured-model-runtime.ts` | AI SDK 已进入受治理运行时；旧“装而未用”结论已失效。 |
| P1-2 视频后端就绪、前端未接 | 16 | `closed / superseded` | `mkfast-template-main/src/product/video-workflow-panel.tsx`、`video-workflow-launcher.tsx`、`mobile-action-book.tsx` | durable 视频工作流已被前端消费；真实供应商/时长/成本仍按视频链自己的验收证据判断。 |
| P1-3 硬编码估时 | 11 | `closed / superseded` | `apps/core/src/p1/model-supply/duration-estimate.ts`、`packages/contracts/src/p1.ts`、前端 `durationEstimateView` | 估时已由样本/状态合同承载；无样本时必须诚实降级，不能把旧 90 秒常量恢复为承诺。 |
| P1-4 无全局任务浮标 | 10 | `closed / superseded` | `mkfast-template-main/src/product/async-task-center.tsx` 在 dashboard shell 全局挂载 | 浮标与跨 Work 聚合已落地；更广的 pending-actions 语义另行验收。 |
| P1-5 无 Agent 开场引导 | 19 | `closed / superseded` | `mkfast-template-main/src/product/today-recommendation-card.tsx`、workbench greeting、`creation-entry.tsx` | 问候、今日建议和场景入口已进入 Day-0；推荐是否“适合现在”仍必须由服务端事实 revision 支撑。 |
| P1-6 ⌘K 非全局 | 20 | `closed / superseded` | `mkfast-template-main/src/product/global-command-palette.tsx` 在 `sidebar-layout.tsx` 全局挂载 | 已转为全局导航/带入命令面；旧局部面板结论已失效。 |
| P1-7 成套模块多选构建器缺失 | 14 | `closed / superseded` | D-031、D-042；`creation-entry.tsx` 的 chips 与 `harness-question-card.tsx` 的单问确认 | **旧拟议解法已废止**：不再建设前台多 checkbox 槽位表；现行目标是套组进入对话流、隐藏不可用模块。 |
| P1-8 选预设不隐藏提示词框 | 13 | `closed / superseded` | `mkfast-template-main/src/product/creation-entry.tsx` 的 `selectedPreset` 分支 | 选中命名预设后隐藏意图文本区并显示素材引导，已落地。 |
| P1-9 模型/模板视觉卡未接线 | 15 | `closed / superseded` | `mkfast-template-main/src/product/model-card-picker.tsx` 已由 workbench 消费；`creation-shelf.tsx`/creation catalog 承载模板 | 视觉模型卡和模板货架已接主路径；可用性、报价和缩略图缺证时须显示诚实降级。 |
| P1-10 `/ai` 旁路绕治理 | 04 | `closed / superseded` | 当前 routes 无 `/(pages)/ai.tsx`、无旧 `api/ai.ts`；生成统一经 Core/ModelSupply 接口 | 旧公开旁路已移除；以后新增生成入口仍须经过目录、配额、审计和 activation 门。 |
| P1-11 i18n 零接线 | 23 | `closed / superseded` | `mkfast-template-main/project.inlang/settings.json` 的 `baseLocale=zh`；产品组件使用 Paraglide messages | 产品层已收敛到 Paraglide；新增硬编码文案按现行本地化守卫处理。 |
| P1-12 48px 触区/大字号承诺未落地 | 25 | `closed / superseded` | `mkfast-template-main/src/styles.css` 的 `--spacing-touch-target: 48px`；移动端 E2E catalog | 48px 集中合同与多视口验收已有载体；仍存在的 44px 例外须按当前可达性合同逐项判断，不能用旧票状态掩盖。 |
| P2-1 三喂料输入不完整 | 22 | `closed / superseded` | `mkfast-template-main/src/product/composer-image-input.tsx`（拖放/粘贴/拍照）与 `assisted-asset-intake.tsx` | 文字、素材与辅助导入已进入统一入口；URL 自动抓取仍是明确 de-scope，不得倒写成未完成验收。 |
| P2-2 `recorded-*` 标识泄漏 | 24 | `closed / superseded` | `mkfast-template-main/src/p1/settings-view-model.ts` 的 public identifier 清洗与相关测试 | 面向店主的 catalog 标识已净化；内部 fixture id 可保留在运行时/测试证据，不得穿透到产品 UI。 |
| P2-3 示例美甲店零消费 | 21 | `closed / superseded` | `mkfast-template-main/src/product/example-store-preview.tsx` 及 workbench/mobile consumers | 示例终态已真实消费，并受示例/真实账本隔离测试约束。 |
| P2-4 点睛动效零落地 | 24 | `closed / superseded` | `mkfast-template-main/src/styles.css` 的 `meiye-rose-glow`、媒体 hover 与 `prefers-reduced-motion` 降级 | 旧“零动效”已失效；Confetti 等具体库从未成为现行硬门，继续以克制动效和减弱动效可访问性为准。 |
| P2-5 中文字体栈缺失 | 25 | `closed / superseded` | `mkfast-template-main/src/styles.css` 的 Inter/HarmonyOS Sans/MiSans/PingFang SC/Microsoft YaHei 系统栈 | 已补齐中文系统回退栈；旧差距关闭。 |

### 方法说明

- **流程**：五维并行分析（五路 agent 各自独立产出差距候选）→ 主编索引级合并去重 → 逐条对抗验证（逐行读码 + 反向 grep 排除"实现在别处" + remediation 时效核查 + expected 出处逐字回溯）。
- **数量收敛**：五路候选合并后约 40 条 → 索引级去重合并为 **24 条** → 对抗验证后 **24 条全部存活**（判定分布：confirmed 8 条、partial 16 条、refuted 0 条）。`refuted` 条目已剔除；`partial` 条目（呈现层已建但未接线/覆盖不全类）按核查结论修正措辞后收录，修正点在各条注记可查。
- **重构说明**：首轮 Dedup/Synthesize 单 agent 产出超 16k token 输出上限，遂重构为"索引决策 + 分段撰写"——主编先定 6 分段索引，再并行撰写后拼接，本文件为第 5 分段（§六 决策菜单 + §七 附录）。
- **边界**：本报告不含推测性结论，未复核项明示不下结论；结论均可回溯至上列证据源与行号出处。
