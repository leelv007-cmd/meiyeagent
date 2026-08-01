---
name: 美业内容副驾
description: 门店橱窗——内容永远是主角，界面是一层玻璃
colors:
  ink: "oklch(0.22 0 0)"
  ink-90: "oklch(0 0 0 / 0.9)"
  ink-60: "oklch(0 0 0 / 0.6)"
  ink-40: "oklch(0 0 0 / 0.4)"
  paper: "oklch(1 0 0)"
  canvas: "oklch(0.965 0 0)"
  glass-80: "oklch(1 0 0 / 0.8)"
  glass-50: "oklch(1 0 0 / 0.5)"
  glass-35: "oklch(1 0 0 / 0.35)"
  tint-active: "oklch(0.42 0 0 / 0.08)"
  tint-hover: "oklch(0.42 0 0 / 0.04)"
  hairline: "oklch(0 0 0 / 0.04)"
  rose-gold: "oklch(0.63 0.13 18)"
  rose-wash: "oklch(0.95 0.025 18)"
  rose-deep: "oklch(0.45 0.1 18)"
  mask-scrim: "oklch(0 0 0 / 0.4)"
  status-success: "oklch(0.53 0.14 150)"
  status-progress: "oklch(0.5 0.19 262)"
  status-warning: "oklch(0.55 0.13 85)"
  status-danger: "oklch(0.55 0.2 27)"
typography:
  display:
    fontFamily: "Inter, 'HarmonyOS Sans', MiSans, 'PingFang SC', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)"
    fontWeight: 200
    lineHeight: 1.2
  headline:
    fontFamily: "Inter, 'HarmonyOS Sans', MiSans, 'PingFang SC', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Inter, 'HarmonyOS Sans', MiSans, 'PingFang SC', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "Inter, 'HarmonyOS Sans', MiSans, 'PingFang SC', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, 'HarmonyOS Sans', MiSans, 'PingFang SC', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "oklch(0.32 0 0)"
  button-glass:
    backgroundColor: "{colors.glass-50}"
    textColor: "{colors.ink-90}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "38px"
  nav-item-active:
    backgroundColor: "{colors.tint-active}"
    textColor: "{colors.ink-90}"
    rounded: "{rounded.pill}"
    height: "44px"
  chip-scenario:
    backgroundColor: "{colors.glass-50}"
    textColor: "{colors.ink-90}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  badge-spark:
    backgroundColor: "{colors.rose-wash}"
    textColor: "{colors.rose-deep}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  composer:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.3xl}"
    padding: "12px"
  card-media:
    rounded: "{rounded.2xl}"
---

# Design System: 美业内容副驾

## 1. Overview: 门店橱窗

**Creative North Star: "门店橱窗（The Shop Window）"**

美业门店最好的作品摆在橱窗里，玻璃是透明的——路人隔着玻璃看见的是作品本身，不是玻璃。这套系统把同一个道理搬进产品：**内容是唯一的主角，一切控件都是浮在上面的玻璃或白瓷**。生成工作台首屏是全出血的氛围层，悬浮其上的是磨砂玻璃侧栏、玻璃胶囊、白瓷 Composer 大卡，和一句压在氛围上的超细问候语（「嗨，XX 店主，今天想发点什么？」）。界面永远不和作品抢色——控件是黑 alpha 墨色梯度的全中性系统，唯一的品牌色「玫瑰金」只在 AI 时刻做火花。

**氛围层的定位变更（2026-07-28）。** 氛围层原设定是**内容层**：全出血放商家自己的作品、门店影像或当季美业主题影像，橱窗里看得见具体的东西。现在它是**材质层**：一张磨砂渐变光晕（`/seed/ambient-gradient.webp`，`center 36% / cover`，高 `max(100svh, 720px)`，底端渐隐进 canvas），只提供空间深度和首屏的光感，不承载任何内容。

代价要说清楚：橱窗里暂时没摆东西了。「隔着玻璃看见作品」这句话现在只在媒体卡、内容库、素材墙这些实体内容面上成立，首屏兑现不了。换回来的是压字可控——人物照片的明暗分布是不可控的，问候语与页头无论压白字还是墨字，都会在某些照片上跌破 4.5:1；靠加深遮罩救回来，又把照片压成一团黑，等于既看不见作品也不好看。渐变底图的明暗是设计出来的，两档 scrim 一压就能把整条带锁进安全区（实测见 §7）。这是一次有代价的取舍，不是原设定换了实现方式。

作品重新回到首屏仍是目标，但回来的前提是带一套可验证的压字方案（如逐图亮度采样选 scrim 档位），不是把这张渐变换掉就算数。

这套系统显式拒绝（引自 PRODUCT.md 反面参照）：CreatOK 像素级克隆与通用 AI 工具市场、聊天气泡 copilot、SaaS 待办卡片后台感、后台代码与技术术语暴露给商家。同时它不是小云雀的换皮——玫瑰金取代紫罗兰、美业影像取代梦幻风景、拟人化中文问候取代泛化 greeting，身份是独立美业品牌。

**Key Characteristics:**
- 氛围层是磨砂渐变材质，界面是玻璃和白瓷，内容在实体面上做主角
- 控件全中性（墨色 alpha 梯度），玫瑰金只做 AI 火花（一屏 ≤5%）
- 大圆角谱系（12→32px）+ 药丸导航，柔和无棱角
- 阴影近乎为零，深度靠磨砂玻璃层次表达
- 双主题正式（浅色 + 暗色均为正式主题，D-042）
- 动效克制：ease-out 位移淡入，全部提供 reduced-motion 替代

## 2. Colors: 玻璃与胭脂

全中性玻璃基底之上，唯一的胭脂色只为 AI 时刻点亮。

### Primary
- **玫瑰金 rose-gold** (oklch(0.63 0.13 18)): 品牌火花色。只出现在 AI 时刻——生成中微光、AI 建议火花图标、订阅/升级标记（指本产品付费订阅，非门店会员，D-030）、「新」徽标。绝不做按钮底色、绝不做正文色。
- **玫瑰晕 rose-wash** (oklch(0.95 0.025 18)): 火花的浅底，AI 徽标与提示条的背景。
- **玫瑰深 rose-deep** (oklch(0.45 0.1 18)): 玫瑰晕上的文字色，保证 ≥4.5:1。

### Neutral
- **墨 ink** (oklch(0.22 0 0)): 主按钮底色、实心图标。
- **墨-90 / 60 / 40** (oklch(0 0 0 / .9/.6/.4)): 三档文字梯度——正文与标题用 90，辅助说明用 60，占位与禁用用 40。60 是最低正文档位。
- **白瓷 paper** (oklch(1 0 0)): Composer、功能卡、实体面板的底。
- **画布 canvas** (oklch(0.965 0 0)): 无媒体氛围层时的页面底色。
- **玻璃三档 glass-80 / 50 / 35**: 白 alpha 磨砂底——80 给侧栏壳，50 给顶部胶囊与场景 chips，35 给最轻的悬浮痕迹。玻璃必须配 blur 与 1px 白描边，见 Elevation。
- **灰痕 tint-active / tint-hover** (oklch(0.42 0 0 / .08/.04)): 导航激活/悬停的中性药丸底。
- **发丝线 hairline** (oklch(0 0 0 / 0.04)): 分隔线唯一色。
- **压字遮罩 mask-scrim** (oklch(0 0 0 / 0.4)): 媒体卡底部渐变遮罩的起始色。

### Tertiary（语义状态，只在规范化状态标签内出现）
- **status-success / progress / warning / danger**: 中文语义标签 + 圆点 + 下一步动作的配色，浅色 wash 底 + 深色文字，沿用现有 ProductStatus 五 tone 体系。

### Named Rules
**橱窗法则（The Shop Window Rule）。** 内容永远是主角。任何界面元素只允许两种材质：玻璃（白 alpha + blur + 白描边）或白瓷（纯白实心）。禁止给控件上彩色底——颜色由商家的内容影像供给。

**一点胭脂法则（The Single Rouge Rule）。** 玫瑰金在任何一屏的覆盖面积 ≤5%，且只系于 AI 语义（生成、建议、升单）。如果一个元素不是 AI 时刻还想用玫瑰金，答案是不用。

**遮罩托字法则（The Mask Rule）。** 文字压在媒体上必须垫渐变遮罩（linear-gradient(0deg, mask-scrim, transparent 30%)）；压在氛围层上则走氛围段那一套——两档 scrim 把底纹推到与字反向的明度（明色白纱提亮、暗色黑纱压暗），字色跟 `--ambient-text` 走，再配一层同向托字投影。两条路都要实测对比度 ≥4.5:1 才准上线。

## 3. Typography

**Display Font:** Inter + HarmonyOS Sans / MiSans / PingFang SC（同一栈，超细 200 号）
**Body Font:** 同一家族，400/500/600 三档
**Label/Mono Font:** 无独立 mono；技术标识不面向商家展示

**Character:** 单家族多字重。中文界面的personality全靠字重反差——问候语用 200 超细大字营造轻盈亲切，正文 400 保证可读，操作 500 干脆利落。绝不引入第二家族。

### Hierarchy
- **Display** (200, clamp(1.75rem, 3.5vw, 2.75rem), 1.2): 工作台问候语专用，压在氛围层上，字色不自带、跟 `--ambient-text` 走（明色墨字、暗色浅字，见 §7）。一屏最多一处。
- **Headline** (600, 1.5rem, 1.25): 页面标题、面板主标题。
- **Title** (500, 1rem, 1.4): 卡片标题、区块标题。
- **Body** (400, 0.875rem, 1.55): 正文，墨-90；行长 ≤72ch。
- **Label** (500, 0.75rem, 1.4): chips、徽标、状态标签。中文标签禁用 letter-spacing 拉宽与全大写英文 eyebrow。

### Named Rules
**问候语法则（The Greeting Rule）。** Display 层只承载拟人化问候（PRODUCT.md：「拟人化一句话提醒 > SaaS 待办卡片」），格式是「称呼 + 一句话行动邀请」。禁止用 Display 层放指标数字或功能标题。

## 4. Elevation: 玻璃的三档 blur

本系统**不用阴影表达层级，用磨砂玻璃的透明度×模糊度表达**。浮在氛围层上的元素分三档：壳级玻璃（glass-80 + blur(64px)，侧栏）、件级玻璃（glass-50 + blur(24px)，胶囊/chips/浮动条）、痕级玻璃（glass-35 + blur(20px)，最轻的悬浮标记）。每片玻璃必须带 1px 白描边（rgba(255,255,255,1) 或 0.5）勾出边缘。白瓷件（Composer、功能卡）落在玻璃之上，是最高实体层。

### Shadow Vocabulary
- **环境影 ambient** (`box-shadow: 0 2px 20px oklch(0 0 0 / 0.03)`): 白瓷卡与画布之间的唯一常规影，几乎不可见。
- **悬浮影 overlay** (`box-shadow: 0 4px 20px oklch(0 0 0 / 0.12)`): 仅 popover、dropdown、dialog 三类真悬浮层。
- **玫瑰辉光 rose-glow** (`box-shadow: 0 6px 16px oklch(0.63 0.13 18 / 0.24)`): 仅生成中状态的呼吸微光，且随 prefers-reduced-motion 退化为静态 1px 玫瑰描边。

### Named Rules
**玻璃有边法则（The Edged Glass Rule）。** 没有 blur、没有描边的半透明白不是玻璃，是没上完色，禁止出现。玻璃只用于浮在氛围层/媒体上的悬浮元素；实体内容区（表格、表单、正文面板）一律白瓷，禁止装饰性 glassmorphism。

## 5. Components

### Buttons
- **Shape:** 药丸（999px），高度 44px（主）/38px（玻璃）/36px（紧凑），触屏最小命中 44px
- **Primary（墨丸）:** 墨黑底 + 白字（ink / paper），一屏可见状态内只允许一个；hover 提亮至 oklch(0.32 0 0)
- **Glass（玻璃丸）:** glass-50 + blur(24px) + 1px 白描边 + 墨-90 文字，次级动作
- **Ghost:** 透明底 + tint-hover 悬停痕，行内三级动作
- **Destructive:** status-danger 10% wash 底 + danger 文字，沿用现有 shadcn destructive 语法
- **Focus:** 2px `--product-focus` outline + 2px offset，全壳一档（明色墨 oklch(0.22 0 0)，暗色带玫瑰微调 oklch(0.85 0.08 18)，见 §7）；氛围层上不另开白 outline——明色氛围带本身就是浅的，白 outline 等于没有

### Chips
- **参数 chips（Composer 内）:** ghost 底 + 图标 + 12px/500 文字 + 下拉箭头，激活态 tint-active 药丸
- **场景 chips（Composer 下）:** 玻璃丸样式，点击即切换 Composer 场景上下文——推荐词与工具集合整体切换，不弹表单、不跳页（D-029/D-031）

### Cards / Containers
- **功能卡:** 白瓷底、圆角 20px、环境影、缩略图 + Title + 墨-60 描述一行
- **媒体卡（内容库/精选作品）:** 圆角 24px，媒体全出血，底部 mask-scrim 渐变遮罩托白字标题与状态标签；hover 时遮罩加深 + 操作浮现
- **禁止嵌套卡片，禁止同尺寸 icon+标题+描述卡无限重复的瀑布**

### Inputs / Fields
- **Composer（签名组件）:** 白瓷大卡、圆角 32px、内衬 12px、blur(24px) 承接氛围层边缘、1px 白描边；上半是多行输入（占位文案用拟人化口吻：「说说想发什么，可以 @ 引用门店素材」，墨-60 保证对比），下半是参数 chips 行 + 右侧圆形墨丸发送钮。它是工作台唯一主轴，宽度 ~780px 居中。
- **普通表单:** 白瓷底、圆角 12px、1px 发丝线描边、focus 换 2px 墨色 outline；错误态 danger 描边 + 中文语义错误说明

### Navigation
- **侧栏壳:** 壳级玻璃悬浮板（圆角 24px、距屏缘 12px 悬浮、glass-80 + blur(64px)），内含 logo、一级导航（创作/内容/素材/门店，药丸项，激活 = tint-active + 墨-90/500）、近期记录列表、底部设置工具区
- **顶部右侧:** 玻璃胶囊组（帮助、通知、账户），订阅/升级入口带玫瑰金火花图标（指本产品付费订阅，非门店会员，D-030）
- **移动端:** 侧栏收为底部任务面导航，遵循移动任务面边界，不镜像桌面四目的地

### 规范化状态标签（签名组件）
中文语义标签 + tone 圆点 + 可选说明与下一步动作，五 tone（neutral/progress/success/warning/danger）浅 wash 底。这是全站唯一的状态表达组件——原始状态码永不直出。

### 生成中微光（签名组件）
Generation Job 运行时，Result Card 边缘出现玫瑰辉光呼吸（4s ease-in-out 循环）+ 墨-60 拟人化进度文案（「正在为你排版第 2 张图…」）。reduced-motion 下退化为静态玫瑰描边 + 文案。

## 6. Do's and Don'ts

### Do:
- **Do** 让氛围层只做材质：工作台首屏是一张磨砂渐变光晕，负责空间深度而不承载内容；商家的作品出现在媒体卡、内容库、素材墙这些实体内容面上（定位变更与代价见 §1）。
- **Do** 全部动效用 ease-out（cubic-bezier(0.22, 1, 0.36, 1)），150–600ms，只动 transform/opacity，且每个动效写 prefers-reduced-motion 替代。
- **Do** 用字重反差（200 问候 vs 500 操作）制造气质，玫瑰金只做火花。
- **Do** 状态一律走规范化状态标签；失败说明翻译成商家的下一步动作。
- **Do** 玻璃三要素齐全：白 alpha 底 + blur + 1px 白描边，且只用于悬浮层。

### Don't:
- **Don't** 做 CreatOK/小云雀像素级克隆或通用 AI 工具市场首页（PRODUCT.md 反面参照原文）。
- **Don't** 做聊天气泡 copilot / floating copilot——Agent 是文档式创作记录（PRODUCT.md 反面参照原文）。
- **Don't** 做 SaaS 待办卡片后台感——运营上下文是拟人化提醒与紧凑周条（PRODUCT.md 反面参照原文）。
- **Don't** 把 recorded/trialing 等状态码、Work/Job/Asset 术语、模型路由细节暴露给商家（PRODUCT.md 反面参照原文）。
- **Don't** 给控件上彩色底、用玫瑰金做按钮/链接/正文——违反一点胭脂法则。
- **Don't** 用渐变文字（background-clip: text）、侧边彩条（border-left >1px 强调）、大写字距 eyebrow、hero 大数字指标卡、同构卡片无限网格。
- **Don't** 在实体内容区（表格/表单/正文）用玻璃材质；没有 blur 和描边的半透明白禁止出现。
- **Don't** 文字直接压媒体不垫遮罩；墨-40 当正文色；玻璃上放低于 4.5:1 的灰字。
## 7. 暗色主题（Dark Theme）

暗色是主应用的正式主题（D-042 决策一），不是模板暗色继承——同一套「门店橱窗」范式换材质在暗色下重演：氛围层仍是同一张渐变底图（换纱不换图），白瓷与玻璃只是把明度反过来。本节codify已落地的暗色对应物（`.dark .meiye-product-shell`）。（历史 Pro Studio 独立深色影棚已随 D-170 退役，不再作为设计例外。）

### 材质对应物（实测值）
- **暗白瓷 paper**（`oklch(0.21 0 0)`）：Composer、功能卡、实体面板的底；画布 canvas 更深一档 `oklch(0.17 0 0)`。实体内容区仍是白瓷（此处即暗白瓷），不装饰性上玻璃。surface-1 = `oklch(0.21 0 0)`、surface-2 = `oklch(0.25 0 0)` 承接分层密度。
- **暗玻璃三档**：壳级 `oklch(0.19 0 0 / 0.85)` + blur(64px)、件级 `oklch(1 0 0 / 0.08)` + blur(24px)、痕级 `oklch(1 0 0 / 0.05)` + blur(20px)。blur 半径与浅色同值，暗色只换底色 alpha。
- **玻璃描边**：`glass-edge = oklch(1 0 0 / 0.18)`（比浅色的 0.55 更亮更薄）。玻璃有边法则在暗色下同样强制——小开关等浮动控件补 1px `glass-edge`，没有描边的半透明底禁止出现。

### 文字梯度（墨→白 alpha）
墨色梯度在暗色下翻为白 alpha：ink `oklch(0.94 0 0)`、ink-90 `oklch(1 0 0 / 0.92)`、ink-60 `oklch(1 0 0 / 0.66)`、ink-40 `oklch(1 0 0 / 0.4)`。60 仍是正文最低档，40 仍只做占位/禁用。正文对比度 ≥4.5:1 的硬要求在暗色下同样成立。

### 氛围层与遮罩
- **同一张底图，两态纱色反向**：`ambient-image` 两套主题都是 `/seed/ambient-gradient.webp`（浅色渐变光晕），换的是纱不是图。浅色压白纱把它再提亮：`ambient-scrim-top = oklch(1 0 0 / 0.34)`、`ambient-scrim-mid = oklch(1 0 0 / 0.3)`；暗色压黑纱把它降到暗背景该有的亮度：`ambient-scrim-top = oklch(0 0 0 / 0.74)`、`ambient-scrim-mid = oklch(0 0 0 / 0.6)`。两档 scrim 分别落在渐变带的 0% 与 46%，第三档是不透明 canvas。**「压暗遮罩」这个旧说法只在暗色成立**：浅色下遮罩是提亮的。
- **46% 是整条带的最坏点**，任何 scrim 改动都以该点复测为准——从这里往下遮罩越来越实、对比度回升，往上则底图本身够亮/够暗。当前值下浅色最坏 4.53:1（图像最暗像素托墨-60）、暗色最坏 4.94:1（图像最亮像素托压字色），逐像素解全图 2000×1125、在 gamma sRGB 空间合成。
- **压字色跟 `--ink` 走，两态各自反转**：`ambient-text = var(--ink)`——浅色是墨字 `oklch(0.22 0 0)`，暗色是浅字 `oklch(0.94 0 0)`；各配一层同向托字投影 `ambient-text-shadow`（浅色白投影 `0 1px 2px oklch(1 0 0 / 0.55)`、暗色黑投影 `0 1px 2px oklch(0 0 0 / 0.45)`）。问候语（Display）与所有浮在氛围顶带上的页头标题、副标题（`.meiye-ambient-copy` 容器：门店/内容库/素材/会话等内页页头、移动工作台页头）共用这一档，Display 自己只声明字阶不声明 color，压字色统一由氛围段给，同一字阶不留第二个答案。落在实底白瓷区（如 bg-surface-0 内容区）的页头仍用墨色梯度，不套 ambient-copy。
- **压字遮罩 mask-scrim** 加深到 `oklch(0 0 0 / 0.55)`（浅色 0.4）。媒体卡白字标题走强化底部渐变（底端 ~0.82 黑），实测 ≥4.5:1；无媒体的成品卡改走暗白瓷题带 + 白 alpha 深字，不把白字压在浅占位上。

### 玫瑰金火花（暗色档）
一点胭脂法则在暗色下不变，只换档：`spark = oklch(0.72 0.11 18)`、`spark-wash = oklch(0.3 0.045 18)`、`spark-deep = oklch(0.88 0.05 18)`。AI 徽标（如版本历史「AI 生成」）用 spark-wash 底 + spark-deep 字，暗色下实测 ≥4.5:1。焦点环在暗色下带玫瑰微调 `product-focus = oklch(0.85 0.08 18)`。

## 组件供给（D-130，2026-07-24）

前端组件优先取自 **HeroUI Pro V3**（用户专属授权，本地镜像 `references/repos/herouipro-v3/`，不入 git）。本文件仍是**唯一视觉权威**：HeroUI 组件（主题拍板＝Glass，作磨砂玻璃语言的底座；Brutalism/Mouve 不启用）一律经上述 token 适配后接入——玻璃有边法则、墨色梯度、一点胭脂法则、对比度硬要求对组件库产物同样强制，不得原样拖入。适用面＝换壳（REBUILD）与净新建（NEW）；存量组件不为换库专项迁移（触碰时换）。
Landing 页例外：保持现状仅改文案与前后链接，不套用组件基准（专项优化随 D-125 阶段二）。

## 工作台形态与 UI 基线（D-171，2026-08-01）

四态工作台（Idle/Active/Waiting/Delivered）与创作入口 IA 的形态权威＝`docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §2。本节只记视觉相关合同：对话区＝文档时间线（商家轻气泡靠右、Agent 阶段全宽带 rail），不做全套聊天气泡；宽度合同＝对话 800／媒体展开 1240，告别全程 max-w-3xl；Idle 层级＝大标题问候 → 定制/自由分段器 → 单一大 Composer（控件收进底栏图标胶囊）→ 轻胶囊建议行 → Activity Shelf 横排卡，图标＋胶囊分主次、大留白呼吸感；UI 组件基线＝HeroUI Pro AI showcase 模板族＋assistant-ui 示例（抄模式与拷贝片段，不引入其 runtime）；Tiptap 富文本只进对象工作区。「门店橱窗」（玻璃壳＋白瓷内容＋玫瑰金克制）仍为唯一视觉权威，本节不改色彩与材质合同。

## 价格页与计费 UI 口径（D-172，2026-08-01）

计费 UI 形态权威＝`docs/specs/credit-billing-spec-2026-08-01.md` §6。要点：价格页＝方向 A「积分卡阵」——顶部付费周期切换条（单月/连续包月/包年，切换即时重算折后价+划线原价）→ 四档套餐卡横排（**积分大数字为主角、价格次之**）→ 卡底虚线小账「约 X 条文案/Y 张图/Z 条视频（15 秒）」恒带「仅供参考」→ 底部加油包横条（三 SKU）；工作台三露脸位＝顶栏余额徽章（含最近到期批次提示）、生成前报价 chip（「本次约消耗 N 分」＋失败退回双态标注）、积分不足拦截（「还差 N 分」＋买加油包/升级双出口）；积分明细页＝批次视图＋流水视图。文案纪律：对客只出现「积分」与「约可生成」，任何面不出现上游模型成本与 token（D-061）。视觉仍循「门店橱窗」，组件循 D-130 HeroUI Pro 基准。
