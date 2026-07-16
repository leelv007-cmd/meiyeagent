# AIGC 标注（AI 生成内容标记）的 UI 形式 —— Content Credentials / C2PA + Carbon AI label（一手存档）

- 来源: https://contentcredentials.org/ ；https://contentcredentials.org/introducing-official-content-credentials-icon/ ；https://carbondesignsystem.com/guidelines/carbon-for-ai/#ai-label ；EU AI Content Labels (2026-06-10, 参考 c2paviewer.com/articles/eu-ai-content-labels-c2pa)
- 抓取日期: 2026-07-08

## 两条主流控件形态

### 1) 设计系统内的 AI label（就地、字段级/内容级）—— IBM Carbon
- 一枚小 AI 图标 + "AI" 文字缩写，放在被标注内容旁（输入框右侧居中、容器右上、单元格内联等）。
- **不减分反增信的关键**：它同时是 explainability 的入口——点开 popover 解释"这条为何这样生成"，把"AI 生成"从减分项转成"透明可查"的加分项。呼应可信度研究（透明>隐藏）。
- 用"光效"样式让 AI 内容"发光"凸显，而非用警告色/负面语气。

### 2) Content Credentials「CR pin」（内容级、跨平台溯源）—— C2PA 标准
- 官方图标：**一枚极简 pin，内含 "CR" 两个字母**（Content Credentials）。可嵌入图片/视频本体。
- "The Content Credentials **pin** signals that the content contains information about its **provenance**. This visual representation previews an **interactive component that reveals key information**." —— pin 是入口，点开可看创建方式 + 编辑历史（含是否 AI 生成）。
- 标准由 C2PA 托管，成员含 Microsoft、Adobe、Intel、BBC、Sony、**OpenAI、Google、Meta、Amazon** 等 —— 事实标准。
- EU 2026-06-10 发布官方 AI 内容标注图标，与 C2PA Content Credentials 对接。

## 设计共识（不减分反增信）
1. **标注=透明+可解释入口**，不是免责声明；给"点开看为什么/看溯源"的路径（Carbon popover / CR pin 交互层）。
2. 视觉上**中性偏正面**（光效/pin），避免警告色暗示"劣质/危险"。
3. **就地、贴着内容**（字段旁 inline label + 内容级 pin 两层），粒度匹配 AI 参与范围（Carbon 的整表/局部 presence 同理）。
4. 采纳即担责的确认（见 Amazon 问责条款）可与标注绑定，形成"标注+留痕"合规闭环。

## 对我们美业的映射
- 字段级：AI 预填字段右侧放 inline "AI" 小标（Carbon 式），点开可解释/可 revert。
- 内容级：成品文案/图若外发，可考虑 C2PA Content Credentials 溯源（中国监管 + 平台 AIGC 标注要求下的合规资产）。
