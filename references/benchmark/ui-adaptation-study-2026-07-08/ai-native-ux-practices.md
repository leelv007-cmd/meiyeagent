# AI 原生 UI/UX 最佳实践调研（2025–2026 当前共识）· 六主题

- 调研：ai-ux agent ｜ 2026-07-08 ｜ 全部论断附一手 URL，关键页 Jina 存档于 `sources/`（ux-*.md）
- 载重技术论断（RSC=experimental）已逐字核对官方页正文

**跨主题总纲**：2025–26 的 AI 原生共识已从"炫能力"收敛到三条铁律——① 官方主推 **AI SDK UI（useChat + parts）**，RSC/streamUI 已被官方判为实验性、退出生产；② AI 全程是**助手/学徒**，产出必须"人来改、人拍板、可撤销"；③ 面向新手，**降低输入摩擦 + 校准信任 + 失败给出路**，不留死胡同、不吓退。

---

## 主题 1｜Generative UI 现状：AI SDK UI 主推，RSC/streamUI 已边缘化

- **RSC/`streamUI`/`ai/rsc` = 实验性，官方明确不推荐生产**。RSC 页正文首句（存档 ux-genui-aisdk.md L271）："*AI SDK RSC is currently experimental. We recommend using AI SDK UI for production.*" 只有 RSC→UI 单向迁移指南。→ https://ai-sdk.dev/docs/ai-sdk-rsc
- **主推路线 = AI SDK UI**：`useChat`（v5 用 `sendMessage`）+ **消息=`message.parts` 数组**，UI 侧 `parts.map` 按 `part.type` 分发。→ https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces
- **Tool→组件 = typed tool parts**：v5 命名 `tool-${toolName}`，按 `part.state` 状态机：`input-available`（占位/loading）→ `output-available`（渲染真实组件）→ `output-error`。
- **结构化对象流式 = `useObject`**（experimental_useObject）+ 服务端 `Output.object({schema})`。→ https://ai-sdk.dev/docs/ai-sdk-ui/object-generation
- **自定义 data parts**：`createUIMessageStream` + `writer.write({type:'data-x', id, data})`，**同 id 复写=自动 reconciliation**（官方："loading states that transform into final results"）；`transient:true` 不进历史。→ https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data
- **官方 shadcn 落地层 = AI Elements**。→ https://elements.ai-sdk.dev/

**P0 映射**：内容卡流 = **tool parts + data parts 双轨，绝不碰 RSC**。每类美业内容卡定义为 typed tool（如 `tool-draft_xhs_post`），`part.state` 三态天然驱动"生成中占位卡→成品卡"；卡内边流边长的正文用同-id data part reconciliation 或 `useObject`。

## 主题 2｜流式呈现：占位→成品就地替换 + 中文用 Streamdown

- **partial object 全程可选链**：`useObject` 的 object 逐步到达，官方原话 "*The results are partial…*"，字段先 `undefined` 再填充。
- **官方取向 = 卡/组件级"占位→成品"就地替换**，不主张整屏骨架。
- **Markdown 边流边解析：用 Vercel Streamdown**（react-markdown drop-in，缓冲 token+修复未闭合语法，驱动 AI Elements Response）。→ https://github.com/vercel/streamdown
- **中文/CJK：Streamdown 有专门 `@streamdown/cjk` 插件**（plugins={{cjk}} + `isAnimating` 流式动画开关）——目前中文逐字流式/断行的官方一手方案。
- **防 CLS**：占位容器预留 min-height、媒体固定宽高比（https://web.dev/articles/cls ）。

**P0 映射**：内容正文渲染层**直接上 Streamdown + @streamdown/cjk，不自拼 react-markdown**——中文逐字流出时普通渲染会因未闭合 `**`/列表出现瞬时乱码闪烁；卡片统一 min-height+骨架占位，配合 tool part 三态做卡级就地替换。

## 主题 3｜异步长任务：提交即走 + 真实阶段叙事 + 退款分层

- **时间阈值**：Nielsen 0.1s/1s/10s，>10s 超注意力极限需 percent-done+可中断；LLM 生成普遍 10s–数分钟 → **必须任务卡化**。→ https://www.nngroup.com/articles/response-times-3-important-limits/
- **提交即刻反馈**（可见性启发式），否则用户重复点击。→ https://www.nngroup.com/articles/visibility-system-status/
- **进度叙事 > 百分比 > 纯转圈**：无法准确估时就用"步骤列表+当前步骤"（NN/g 原例）；假百分比会撒谎（卡 99%）。ChatGPT/Claude"思考中/正在检索"即此模式。→ https://www.nngroup.com/articles/progress-indicators/
- **可离开可恢复**：长任务后台运行；完成提示显著；"最近/继续上次"列表作回归入口。→ https://www.nngroup.com/articles/designing-for-waits-and-interruptions/
- **失败与退款（成熟产品共识）**：技术失败→**自动返还积分**（Meshy "credits are automatically refunded"；PixAI 3 天未完成全退+留痕）；**完成但不满意→不退、改免费重试**（Meshy）；反例 Google Flow 失败仍扣→信任崩塌。→ https://help.meshy.ai/en/articles/9991995

**P0 映射**：内容生成 = **提交即走的异步任务卡+历史列表，四态固定**：排队中（位次）→ 生成中（真实阶段白话叙事："正在读你的门店信息/正在写初稿/正在配标题…"，禁用假百分比）→ 完成（显著通知/角标）→ 失败（一键重试）；**积分只对技术失败自动返还并留痕，"成功但不满意"不退、送免费重试**。

## 主题 4｜AI 表单/输入辅助：AI 预填可编辑 + 技能卡=use-case 卡片 + 占位符别消失

- **AI 预填而非手打，字段保持可编辑可核对**（NN/g EAS："prefill or suggest inputs… allow users to verify or update"）；移动端优先相机/语音/GPS 减打字。→ https://www.nngroup.com/articles/eas-framework-simplify-forms/
- **建议 chips 须插入可编辑内容**；**专门化任务用"卡片"而非 pill**——直接对应我们的场景技能卡。→ https://www.nngroup.com/articles/designing-use-case-prompt-suggestions/
- **结构化输出就地编辑 + AI 标记 + 一键回退**：IBM Carbon for AI——用户改写后组件从 AI 变体切默认变体，"*revert to AI button*"；AI 内容带 AI label。→ https://carbondesignsystem.com/guidelines/carbon-for-ai/
- **⚠️ 会消失的 placeholder 有害**："*can be mistaken for prefilled values, causing users to overlook or accidentally skip fields*"——NN/g 长期立场。→ https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/

**P0 映射（对已拍板决策的升级建议）**：把"placeholder=真实示例"**升级为"AI 预填的可编辑真实默认值 + 标签下常驻说明"**（非会消失的占位符）：① 技能卡=use-case 卡片，点击即把真实示例填成可编辑默认值；② AI 字段打标记+一键"回到 AI 版本"；③ 手机端点选优于打字（项目/风格/时长做 chips/单选，复杂字段留开放框）；④ 内容卡就地表单化编辑+常驻"AI 生成，请核对"。净效果：用户全程"改一版已写好的东西"，无空白框恐惧。

## 主题 5｜HITL 确认与可撤销：默认 undo + 合规拦截给"建议替换"不吓退

- **生成→审阅→采用**：PAIR "provide editability"；NN/g AI= "*supporting collaborator… never as a replacement*"；HAX G8/G9 易驳回/易纠正。→ https://pair.withgoogle.com/chapter/feedback-controls/
- **AI 身份透明**：PAIR "make it extremely clear that the product is not a human"；HAX G1/G2 初期标明能力/出错率。
- **Undo vs 确认框**：确认框只用于"*serious consequences… cannot be undone*"，routine 用会 cry wolf；核心倾向 undo（如 Gmail 撤回 30s）。→ https://www.nngroup.com/articles/confirmation-dialog/
- **合规拦截非恐吓**：PAIR《Errors+Graceful Failure》"provide paths forward from failure"、"return control to the user"；NN/g 错误信息——不指责（避免 invalid/illegal）、7-8 年级可读、给建设性出路（Etsy 建议替换范式）。→ https://pair.withgoogle.com/chapter/errors-failing/

**P0 映射**：合规响应 = **两档 + 统一四段式文案**：红线=硬停但绝不只报错——「陈述限制（不指责）→ 一句原因 → 给 1 条可直接采用的合规替换 → 『改用这句』按钮归还控制权」；非红线=内联 warn 可继续。采用/发布默认 **undo**（N 秒可撤回），仅"不可逆+高监管后果"才用事前确认框且复述具体后果。

## 主题 6｜低技术素养用户 AI 原则：钉死"学徒"心智 + 收益语言 + 失败给出路

- **校准信任**：PAIR "calibrate their trust correctly"、"the best explanation is likely a partial one"。→ https://pair.withgoogle.com/chapter/explainability-trust/
- **心理模型**：首次交互即"be up-front about what your product can and can't do"，勿塑造超人能力。→ https://pair.withgoogle.com/chapter/mental-models/
- **错误恢复（新手）**：给"a low-risk or reversible action they can try right away"。
- **术语层次**：7-8 年级可读、无实现黑话，但**可用行业词**；PAIR "Explain the benefit, not the technology"。
- **AI=apprentice/copilot 非 autopilot**：NN/g "treated these tools like coworkers"，产出须人 refine/validate。→ https://www.nngroup.com/articles/ai-roles-ux/

**P0 映射**：产品钉死"学徒/助手"心智：① 首用 onboarding 一句话讲清能做/不能做/会犯错要你把关，用收益语言（"帮你把这条更好卖出去"）；② 每次产出走"低风险可试→你改→采用"，店主始终拍板；③ 任何拦截/失败都给下一步、不留死胡同。

---

## 存档来源（sources/，含 URL+日期头）

ux-genui-aisdk.md（RSC=experimental 逐字）/ ux-async-task-nng.md / ux-ai-forms-nng-use-case-prompt-suggestions.md / ux-hitl-pair-errors.md

**唯一证据缺口**：AI 生成标签"措辞的定量效果"只有次级研究（arxiv 2506.16202 等）；一手规范侧只到"须披露非人类"原则。如需可补 C2PA/平台官方标签规范一手页。

---

# 【补充】首屏第一眼 = 价值锚定（2026-07-08 二轮，三条一手硬证据）

## 新增一手权威证据

1. **第一印象 17–50ms 决定去留**（Google Research 官方）：逐字 "*In less than 50 milliseconds, users build an initial 'gut feeling' that helps them decide whether they'll stay or leave*"；美学判断发生在 **17–50ms**。两个可控杠杆 = **Visual complexity（越复杂越丑）+ Prototypicality（越不像同类越丑）**——"*users strongly prefer designs that look both simple and familiar*"；违背预期 → "*downward spiral*"。→ https://research.google/blog/users-love-simple-and-familiar-designs-why-websites-need-to-make-a-great-first-impression/
2. **美学-可用性效应**（NN/g）："*People tend to believe that things that look better will work better — even if they aren't actually more effective*"；正向视觉情绪 → 对小瑕疵更宽容（**边界：不救大问题**）。源 = Kurosu & Kashimura 1995 Hitachi ATM 实验。→ https://www.nngroup.com/articles/aesthetic-usability-effect/
3. **可信度：design quality 是首要判据**（NN/g 承接 Stanford/BJ Fogg）：Nielsen 四要素 = design quality / up-front disclosure / comprehensive-current content / connection；"*The first step to garnering trust is to make your site appear legitimate and professional*"；配色决定 "*perceived value… corporate, budget, or luxury*"；错别字/断链即刻掉信任；**该研究实证判据在西方与亚洲用户一致（对中国美业用户成立）**。Fogg 2003："design look" 为最高频信任判据（约占评论 46%）。→ https://www.nngroup.com/articles/trustworthy-design/ ｜ https://credibility.stanford.edu/

## 贯穿命题

**非技术美业用户无法评估功能深度，只能凭"表面信号"在 50ms 内判断"专不专业/值不值"——首屏视觉档次 + 示例内容质量 = 价值锚，且经美学-可用性效应外溢成对整体好用度与可信度的判断。这不是装饰，是护城河的对外面（架构对内、体验对外）。**

## 老板娘"第一眼判断很专业/很值"的五杠杆（按影响力排序）

1. **示例内容质量（第一杠杆）**：用户用"样例文案好不好"给整个产品定性——预置/预填样例必须读起来像头部美业操盘手写的（真实门店口吻、能直接发）。**这条比任何视觉都重要，因为文案就是产品本体。**（美学-可用性效应的内容侧外溢 + Fogg content quality）
2. **视觉档次**：留白充足、图片高质、零错别字、配色贴"美/专业"语义（暖、向往感，非企业蓝）；廉价感即刻掉信任。
3. **拟人化温度**：第一人称、口语暖语气建立关系性信任（PAIR "be human, not machine" + 收益语言）。
4. **简单+熟悉**（Google 17–50ms 两杠杆）：首屏只给一个清晰动作；复用商家熟悉的心智原型（小红书/美团/微信的卡片与交互），**别做密集 dashboard**。
5. **10 秒即得价值**：预置示例工作区让她在投入任何输入前先摸到一条成品，把 gut feeling 锁在"有用/值"一侧，避免空状态触发 downward spiral。

## 六主题的"第一眼"叠加

Gen UI：首个内容必须是成品级卡片（非裸聊天气泡），`output-available` 态一次到位不残缺｜流式：杜绝乱码闪烁（Streamdown+CJK），断裂 markdown 会被反向解读为"这产品糙"｜异步：首次进入直接见高质量成品，非空队列｜表单：AI 预填的真实高质量示例 = 第一眼证明"它懂美业"；形态像微信/美团/小红书而非冷企业 SaaS｜HITL/合规：拦截有分寸保专业感；坦诚披露（AI 标识）= Fogg up-front disclosure → **增信而非减分**。

## 新增存档（sources/）

ux-first-impression-google-research.md / ux-first-impression-nng-aesthetic-usability.md / ux-trust-nng-credibility.md（本研究 UX 侧共 7 份一手源）
