# Higgsfield 其它创作入口：Cinema Studio / Flow / Image / Apps（登录态深入）

- 抓取日期: 2026-07-08 ｜ 方式: opencli browser 本机 Chrome 登录态 DOM 提取
- 覆盖 URL: /generate（Cinema Studio）、/flow/video/prompt、/ai/image、/supercomputer/apps

## A. Cinema Studio 3.5 —— "Your AI Director"（/generate）
- 页面标题原文: **"Cinema Studio 3.5 — Your AI Director"**。落地 H1: "Create Your First Project. Generate the Impossible."
- 这是**项目制多镜头影棚**（左栏: Home / My generations / My elements / My favorites / Community / **New project**）。
- 创作 composer 参数（chips）:
  - 提示词 placeholder: **"Describe the scene you imagine..."**
  - **"Style: Auto"** —— 风格由 AI Director 自动决定（可点开覆盖）。
  - **"Camera: Auto"** —— **运镜由 AI Director 自动决定**（可点开覆盖）。
  - 模型 "Cinema Studio 3.5" / 1080p / 8s / "On" 开关 / **GENERATE**（96→80 积分）。
- **② AI 帮写的本质**：Cinema Studio 不给你一个"帮写按钮"，而是把 **Style 和 Camera 默认设为 "Auto"（AI 自动导演）**——用户只写一句场景描述，风格与运镜由 AI 补全。这就是"AI Director"降门槛范式：**让 AI 决定专业参数，用户只表达意图**。

## B. Flow 引导式创作（/flow/video/prompt）—— 最清晰的"线性向导"
- 标题 "Video Generation"；顶部 step 标题 "**Choose a Motion**"。
- **线性步骤流（原文顺序）**: **Choose a Motion（换预设）→ Start Frame（Required）→ End Frame（Optional）→ Prompt（+ Enhance）→ Model（Higgsfield Lite）→ Generate**。
- **② 直接证据**：Prompt 字段旁有 **"Enhance"** 控件（AI 扩写/优化提示词）。提示词 placeholder "Type your prompt here..."。
- "Choose a Motion" 复用 /ai/video 的**同一套预设库**（实测显示已选 "FREE FALL"），即 flow 页把预设墙塞进"第一步"，做成强引导的填空式向导。
- 对比 /ai/video（自由编辑器）：flow 页是**首尾帧 + 运镜 + 提示词的分步骤引导版**，适合新手；两者共享预设与模型后端。

## C. 图片生成（/ai/image）
- 默认模型 = **Nano Banana Pro**（`?model=nano-banana-pro`，Google Nano Banana/Gemini 图像）。
- 参数 chips: 宽高比 **3:4**、分辨率 **1K**、批量 **1/4**（一次出 1-4 张）、**Generate 2** 积分。
- **③ 做同款入口 = "Recreate" 按钮**：从社区/历史图一键复刻其提示词+参数（图片侧的"做同款"）。
- 图片页**无预设 Change 墙**（`hasChange:false`），更偏"提示词 + Recreate 复刻 + Community 灵感流"，与视频页的"预设墙"形态不同。
- 顶部 Tab: History / Community；同样弹 "Organize. Share. Create together" onboarding。

## D. Supercomputer Apps —— 把流程打包成品 App（/supercomputer/apps）
- 标题 "Apps | Supercomputer | Higgsfield"。两大区块: **"Create your first app"** + **"Explore apps by community"**。
- 动作: **"Create an app"** / **"Create in Claude"**（用 Claude 造 app）/ "My apps"。
- 定性 = **App Builder + 社区 App 市场**：用户把一条创作流程（传图→套预设→出片）**打包成可复用的 mini-app**，并可在社区浏览/复用他人 App。这是"打包成品 App 复用"范式（比单次预设更高一层的封装：整条 pipeline 成品化）。
- 注：本次社区 App 卡片为 JS 懒加载，未逐卡展开（避免密集操作触发风控）；概念与入口已确证。

## 跨页降门槛范式总结（给美业内容副驾的迁移启示）
1. **预设墙 > 文字**：把最难描述的专业变量（运镜/风格/VFX）做成可视频预览的卡，点一下即继承，选中后**隐藏文字输入框**。
2. **AI 自动导演**：专业参数默认 "Auto"（Style/Camera），用户只写意图，AI 补全 → 可点开覆盖（渐进式，不剥夺控制）。
3. **Enhance 扩写**：提示词旁一键 AI 扩写，兜住"不会写提示词"的用户。
4. **做同款/Recreate/Mix**：从已有成品复刻配方（Recreate）或混合多预设（Mix），复用他人成果。
5. **成品 App 封装**：整条 pipeline 打包成 mini-app，社区可复用（最高层封装）。
6. **模型即后端**：聚合 20+ 模型，降门槛价值不在模型而在**预设/运镜/导演编排层**——这层才是护城河。
