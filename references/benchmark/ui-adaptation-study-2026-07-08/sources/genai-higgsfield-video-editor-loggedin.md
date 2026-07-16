# Higgsfield 视频生成主编辑器 /ai/video（登录态深入）

- 来源 URL: https://higgsfield.ai/ai/video
- 抓取日期: 2026-07-08
- 抓取方式: opencli browser（本机 Chrome 登录态深入，DOM 提取；账号显示 "All credits used" 未触发任何生成）

## 头图核心文案（招牌降门槛主张）
- H1: **"Make videos in one click"**
- 副文案原文: **"250+ presets for camera control, framing, and high-quality VFX - or use the general preset for manual control."**
- 三步引导（article 卡，各带示范视频）: **"Add image"**（Upload or generate an image to start your animation）→ **"Choose preset"**（Pick a preset to control your image movement）→ **"Get video"**（Click generate to create your final animated video!）

## ① 预设/运镜/特效库（250+，视觉卡墙）
- **预设总数 = 250+**（官方文案），分三大用途: **camera control / framing / high-quality VFX**。
- 预设选择器入口 = 左侧表单顶部 figure，显示**当前预设名 + 模型 + 两个按钮 "Mix" / "Change"**。默认预设 = **"General"**（手动控制档）。
- 点 "Change" → URL 变 `?select=preset&for=motion&model=seedance_2_0`，打开**内联预设选择器**（非弹窗）：
  - 顶部 **Search 搜索框**（placeholder "Search"）+ 精选预设 + **"Show all" / "Load more"** 分页。
  - 预设卡 = `<figure>` 内一个**全覆盖 `<button>`，button 文字即预设名**，底图为视频缩略预览（hover 播放）。
  - 预设名样本（大写电影感命名）: **FREE FALL / CGI BREAKDOWN / NIGHT VISION / FINAL SERVE / ANDROID ASSEMBLE**。
- **点预设=零输入预填全套（已实测）**：点 "FREE FALL" 后 → 顶部标签变 "FREE FALL"；**Generate 成本从 96 变 54**（预设改了时长/参数）；**提示词框整个消失**（`hasPromptBox:false`）。即预设自带提示词+运镜+参数，用户无需写一个字。

## ②「预设模式 vs General 模式」的关键对照（降门槛机制本质）
- **General（手动）模式**：有 contenteditable 提示词框，placeholder **"Describe your scene in detail. Use @ to reference assets"**（`@` 引用素材）；旁有 "Elements" 按钮 + 一个 "On" 开关。
- **命名预设模式（FREE FALL 等）**：**提示词框被移除**，表单只剩「上传图 + 宽高比 + 模型 + Generate」。
- 结论：Higgsfield 用"选预设即隐藏文字输入"把创作从"写提示词"降为"传一张图 + 点一个卡"。本页无独立 "AI Director/帮写" 按钮（该能力在 Cinema Studio 与 flow 页）。

## ③ 做同款 / 模板继承
- **"Mix"** 按钮 = 混合/叠加多个预设（把两种运镜/风格组合）。
- **"Change"** = 换预设。预设本身即可继承的模板。

## ④ 参数形态 = 全视觉点选（无表单）
- 宽高比 chips: **16:9 / 1:1 / 9:16**（点选按钮）。
- 时长/画质: **8s / Auto / 1080p / 720p**，**Bitrate: High**。
- **模型选择器 = 聚合 20+ 主流视频模型**（点选下拉），实测列出:
  Kling 3.0 / Kling 3.0 Turbo / Kling 3.0 Omni / Kling 2.5 / 2.6 / Kling O1 / Seedance 2.0 / Seedance 2.0 Fast / Seedance 2.0 Mini(Exclusive) / Seedance Pro / Seedance 1.5 Pro / **Higgsfield DoP** / HappyHorse / **Sora 2** / **Google Veo 3.1 / Veo 3.1 Lite / Veo 3** / **Grok / Grok 1.5** / Minimax Hailuo / **Wan 2.2/2.5/2.6/2.7**。
  → Higgsfield 定位 = **多模型聚合器 + 预设/运镜层**，模型是可换的后端，护城河在预设与运镜编排。
- Generate 按钮内嵌积分成本（如 "Generate 54"、General 档 72，划线原价 96）。

## ⑤ 生成结果整段级操作
- 右栏 Tab: **History / How it works**。已生成作品的 extend/variation 等操作在 History 内（为规避积分红线未深入点开）。
- 顶部有 "Edit Video" / "Motion Control" 平级 Tab（`Create Video / Edit Video / Motion Control`），即"生成→再编辑"闭环入口。

## 其它
- 全站顶部导航暴露的产品矩阵（都是"打包场景"）: Explore / Image / Video / Audio / Supercomputer(New) / MCP & CLI(New) / Cinema Studio / Plugins(New) / Marketing Studio / Shorts Studio / Explainer(New) / Originals / Canvas / AI Influencer / Apps。
- 打开即弹 onboarding modal "Organize. Share. Create together"（推 Cinema Studio 项目组织）。
