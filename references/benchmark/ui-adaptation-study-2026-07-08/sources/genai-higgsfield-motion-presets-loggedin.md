# Higgsfield Motion Control 运镜/动作预设库（登录态深入）

- 来源 URL: https://higgsfield.ai/ai/video/motion
- 抓取日期: 2026-07-08
- 抓取方式: opencli browser（本机 Chrome 登录态深入，DOM 提取）

## 页面定性
标题原文: "Motion Control — Precise Character Animation"。
这是 **motion transfer（动作/运镜迁移）** 流：从一段参考视频复制运镜与动作，套到用户上传的角色图上。招牌卖点原文：
- "Recreate any Motion with Your Image"
- "Copy motion from any video and place your character into the same movement"
- 引导首句: "Start by copying motion from library"

## ① 预设库怎么组织（核心）
- **形态 = 纯视觉视频缩略卡墙（masonry 瀑布流）**，无文字标签。每张卡结构:
  `<aside index="0" width="160" class="relative rounded-xl overflow-hidden cursor-pointer group border border-transparent mb-2 break-inside-avoid">`
  内含 `<figure>` + `<img>`（webp 占位帧）+ `<video>`（hover 自动播放的预览片）。
- **卡片数 = 约 36–38 张**（video/figure/aside 计数 36–38），懒加载可能更多。
- 预设视频源: `https://cdn.higgsfield.ai/kling_motion_control_preset/{uuid}.mp4`（示例）:
  - 7c764ec1-9343-48dd-a300-8fb7b2be09a5.mp4
  - 55f89edc-767d-49ca-aad3-6ce882b6ee72.mp4
  - c6295691-22c7-47ae-9a52-0922358ca984.mp4
- **无文字分类 Tab / 无分类 chip**：库只有两个顶层 Tab —— "History" 与 "Motion library"（`role=tablist`）。预设本身靠视频画面自解释，不靠文字命名。
- **交互 = 点卡即选**：卡 class 带 `cursor-pointer` + `border-transparent`（选中态加高亮 border），点击把该段运镜设为 motion reference，不是跳详情页（`aside` 非 `<a>`，无 href）。

## ② 提示词框 / AI 帮写
- 本页 **无提示词文本框**，也无 AI Director。因为它是"复制运镜"而非"写提示词"——运镜由参考视频/预设承载，用户不需要描述运镜。
- 唯一文本负担被消除：用户只需 (a) 点一个 motion 预设 (b) 传一张角色图。

## ③ 做同款 / 模板继承
- **整页就是"做同款运镜"**：Motion library 每张卡 = 一个可继承的运镜模板。点选=继承该运镜曲线，替换主体为自己的角色图。这是最纯粹的"模板继承"降门槛范式。

## ④ 参数形态（视觉点选 vs 表单）
左侧创作面板控件（`#video-form-input`）:
- "Add your character" / "Image with visible face and body"（上传角色图，视觉拖拽框）
- "Model" = **Kling 3.0 Motion Control**（模型选择器，下拉）
- "Quality" = **720p**（点选）
- "Scene control mode" —— "Choose where the background should come from: the character image or the motion video"（Video / Image 二选一切换，视觉开关）
- "Advanced settings"（可折叠 `aria-expanded=false`，进阶参数收纳，默认收起 = 降门槛）
- **零输入即可出片**：点一个预设 + 传一张图 → 其余全默认。参数区以点选/开关/折叠为主，非长表单。

## ⑤ 生成结果整段级操作
- 生成按钮原文 = **"Generate 7"**（7 = 消耗积分数；未点，红线）。
- 结果操作入口在 "History" Tab（本次未深入，避免误触）。

## 其它文案证据
- 顶部促销卡: "go Unlimited" / "61% OFF" / "Unlimited Kling 3.0" / "Available on Premium plans"。
- 上传提示: "Add motion to copy" / "Video duration: 3–30 seconds"。
- 有 "Plugins New" 按钮（新功能）与 "How it works" 引导。
- 打开页面即弹 onboarding modal: "Organize. Share. Create together / We've rebuilt how you structure your work — so finding, sharing, and reusing what you create is effortless / Generate images and video in the same place / Nest projects to keep everything tidy"（主推 Cinema Studio 的项目组织能力）。

## 降门槛结论（本页）
Higgsfield 运镜降门槛 = **把"运镜"这件最难描述的事，做成可视频预览的卡片，点一下即继承，用户零文字输入**。文字提示词框被彻底移除，替换为"选一段动作 + 传一张脸"。这是"视觉模板继承 > 文字描述"范式的极致样本。
