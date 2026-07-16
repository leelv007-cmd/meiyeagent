# 面向零经验用户的 AI 内容生成引导形式（含 AI 预填可编辑字段）

- 调研：prefill-forms agent（CapCut/剪映·Higgsfield·Dreamina即梦·Midjourney·Shopify·Amazon·Jasper·Carbon·Content Credentials 官方文档一手；opencli + Jina）
- 编者注（合成时补）：
  - 本报告是**引导形式 + 字段级**视角；即梦/可灵/Higgsfield 登录态真实创作流由 jimeng-deep + kling-higgs 两路另出，回来合并。
  - 三条修正/强化主 agent 前一版口头框架：①**主入口不该是空白/预填字段表单，而应从"做同款/模板占位"起步**（门槛梯度最低层）；②**价格机制字段不 AI 预填**（红线/事实，用 Carbon 局部 presence 隔离）；③**采纳即担责确认留痕**（Amazon 范式）呼应医美准入制+红线。
  - 已删 ghost-text（Copilot/Gmail 纯开发者工具，按客群反馈移除）。

---

## 0. 核心框架：门槛梯度（从低到高）

**门槛：做同款/模板占位（最低）＜ 预设点选 ＜ 提示词扩写/AI帮写 ＜ 字段级直填（最高）。**
非技术美业客群应从**低门槛层起步**，深度定制才降级到字段表单——而非一上来给空白字段表单。

| 层 | 形式 | 用户要做的决策 | 代表产品（第一方） |
|---|---|---|---|
| **L0 做同款/模板占位** | 行业模板 + "点此替换"占位槽 | 只换料，零创作决策 | CapCut/剪映可替换素材片段 |
| **L1 预设点选** | 打包好的风格/格式画廊 | 选哪个格式 + 放什么 | Higgsfield viral-presets |
| **L2 提示词扩写/AI帮写** | 说口语粗想法 → AI 扩写重构 | 说人话即可 | Dreamina(即梦) AI Prompt Helper、Midjourney Describe |
| **L3 字段级直填** | AI 预填真实值可编辑 | 逐字段核对/改 | Shopify Magic、Amazon listing |

## 1. L0 做同款 / 可替换模板（门槛最低，最贴中文客群）

来源：https://www.capcut.com/help/how-to-set-replaceable-material-clips · https://www.capcut.com/help/use-template

- **机制**：可替换素材片段（editable/placeholder clips）让他人"swap your original media with their own"。使用者打开模板，在指定片段上看到 **"Click to Replace" 点此替换**覆盖层，逐槽换成自己的料，零创作决策。
- 占位槽可设类型/时长限制（gear 图标）——对我们即"**价格槽只收数字、医美卖点槽内置红线校验**"。
- 抖音/剪映/即梦最原生的"做同款"，完全零经验用户可用。

## 2. L1 预设点选

来源：https://higgsfield.ai/viral-presets

- "Every viral preset and trending format" 画廊 → **Pick a preset, add your content** → 生成。用户只做"选格式+放内容"两个决策，不碰参数。预设＝打包好的风格/运镜配方。

## 3. L2 提示词扩写 / AI 帮写（有想法不会写）

来源：https://dreamina.capcut.com/create/ai-prompt-helper · https://docs.midjourney.com/hc/en-us/articles/32497889043981-Describe

- **零经验洞察（Dreamina 原话，正中客群）**："Your creativity isn't the problem; **prompt writing is**. Many users can't translate ideas into effective AI instructions." → 障碍是"想法→有效指令"这一步。
- **Dreamina AI Prompt Helper**：输入**口语化粗略想法（像聊天）**→ AI "restructures your input, enhances clarity, add detail" 重构扩写成结构化提示词 → 生成多方向 → **对话式继续精修**。
- **Midjourney Describe**：图→**4 条候选提示词**，点"Use Prompt"填入 或"Run all"全试（多候选点选）。
- 即梦（Dreamina 为其国际同源版，字节/剪映出品）、可灵均内置"AI 扩写"按钮。

## 4. L3 字段级直填 + Carbon 通用范式

来源：https://carbondesignsystem.com/guidelines/carbon-for-ai/ · Shopify · Amazon（同下）

**Carbon revert-to-AI（通用原则，任何 AI 预填字段都适用）**：字段有 AI 预填真实值 → 编辑即从 AI 变体切默认变体（**编辑即接管**）→ 保留 **revert-to-AI button** 一键回 AI 版；**AI label 只做标注+解释入口，重生成用独立图标**；Form AI presence 分整表/局部——**价格等红线字段不上 AI 样式、隔离**。

**字段级 6 形式（深度定制层细节）**：B 预填真实值+AI标记+编辑即接管（Carbon/Shopify）· C diff accept-reject（Notion/Grammarly，需原值基线，不适合首次预填）· D streaming 逐字填充 · E per-field regenerate 换一个（Notion "Try again"/Amazon A+）· F 多候选点选（Midjourney/Copy.ai）·〔A ghost text 已按客群移除〕。

## 5. 电商/内容 listing 生成器（面向非技术商家，最贴）

来源：https://help.shopify.com/en/manual/products/details/product-descriptions/shopify-magic · https://sell.amazon.com/blog/amazon-listing-ai · https://help.jasper.ai/hc/en-us/articles/18618693085339-Brand-Voice · https://www.copy.ai/workflows/facebook-ad-copy-variations

- **Shopify Magic**：字段工具栏 Generate text→prompt→**生成文本直接落入字段**→就地编辑→Save。
- **Amazon AI listing**：几字/图/网址→生成 title+bullets+description；**review-edit-approve 闭环**；A+ 字段级选择性生成（选中字段→Generate，"AI Ready"徽章）；**问责条款**"采用即视为已审阅且合规"——责任转商家（医美红线：采纳节点确认留痕）。
- **Jasper Brand Voice（对信任极关键）**：上传商家几条自己的文字→学出**品牌音/门店口吻**；生成时**给"带品牌音 vs 不带"两版对照**让用户确认"这是我的调性"，解决"AI 味重、不像我"。→ 与我们门店档案/人设字段天然契合。
- **Copy.ai**：一次出 N 个变体供挑选/A-B。

## 6. AIGC 标注（不减分反增信，中国监管下是合规资产）

来源：Carbon AI label · https://contentcredentials.org/

- 字段级：小 AI 标同时是 explainability 入口（点开解释）；视觉中性偏正面（光效），忌警告色。
- 内容级溯源：C2PA「CR pin」（含"CR"字母，点开露创建方式+编辑历史），成员含 OpenAI/Google/Adobe/Meta/Amazon。

## 7. 对我们美业主入口的映射（门槛梯度 + 字段类型）

**主入口策略（关键改动）**：不要一上来给空白/预填字段表单，而是**先给"行业模板做同款"**——美业行业模板（探店/项目介绍/优惠海报），字段做成 **"点此替换"占位槽**，商家只填不写。想深度定制的再降级到"AI 帮写字段"。

| 美业字段 | 首选形式 | 兜底/进阶 |
|---|---|---|
| **整体入口** | 做同款：行业模板+占位槽（CapCut 式） | 空模板+AI帮写 |
| **项目名** | 占位槽预填真实值 + 多候选点选 | per-field 换一个 |
| **价格机制** | **用户填数**，该字段**不上 AI、不扩写**（Carbon 局部隔离；占位槽限数字） | — |
| **正文/描述** | 占位槽预填 + 字段旁 **"AI 帮写/扩写"**（Dreamina 式：说口语→扩写填入）+ 对话精修 | 二次 diff 合规润色 |
| **标题** | 预填 + 多候选点选 | per-field 换一个 |
| **标签** | 多候选点选 | — |
| **调性统一** | Jasper 式品牌音：学商家几条旧文→全字段带其口吻；给"带/不带"对照建信任 | — |

**统一骨架**：模板占位"点此替换"为主入口 → 深度字段用"AI 帮写(口语→扩写)+多候选" → 全程带品牌音 → 每个 AI 字段有 inline AI 标(可解释)+编辑即接管+revert → 价格/红线字段隔离不参与 AI → 采纳节点确认留痕(医美强制)。

## 存档（6 篇，均 URL+日期 2026-07-08 开头）

prefill-template-samestyle-capcut-higgsfield.md（做同款/预设，最贴客群）· prefill-prompt-expansion-dreamina-midjourney.md（扩写/AI帮写）· prefill-jasper-brandvoice-copyai.md（品牌音）· prefill-ecommerce-shopify-amazon.md · prefill-carbon-for-ai.md（revert-to-AI）· prefill-aigc-label-content-credentials.md

一手性说明：CapCut/Shopify/Amazon/Jasper/Copy.ai/Midjourney/Content Credentials/Dreamina 均厂商官方（Dreamina=即梦同源国际版，作即梦一手代理）；可灵 AI 扩写在登录态应用内，由 kling-higgs 登录态实探补。
