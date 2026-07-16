URL: https://higgsfield.ai/marketing-studio/product
日期: 2026-07-08
登录态: 是（右上 Account menu + 头像 + /asset/all Assets 可见；GENERATE 显示积分成本）
采集方式: opencli browser 复用本机 Chrome 登录态，DOM 提取（只读，未点 Generate）

# Marketing Studio「Product」——最贴近"商家做营销内容"的第一方样本

## 顶部 composer（一屏出广告的核心表单）
- 标题(H2): "TURN ANY PRODUCT INTO A VIDEO AD"
- 顶部双 tab(role=tab): **Product** / **App**（营销对象二选一）
- prompt 输入框(role=textbox)，aria-placeholder = **"Describe what happens in the ad..."**（自由文本，可留空）
- 三个"语义槽位"按钮（默认已填值，点开=可视化画廊 modal）：
  1. **Style**（默认显示 "UGC"）
  2. **Hook**
  3. **Setting**
- 主按钮: **"GENERATE 48 40"**（48=划线原价 / 40=实付积分）
- 侧栏低门槛入口: **"Url to Ad"**（贴商品链接出广告）、**"Ad Reference"**（参考已有广告）、Projects / New project / New folder

关键手感: **非空表单**。用户进来时三个槽位已有默认值（Style=UGC），prompt 可空。即"零输入也能点 Generate"，填得越多越可控。

## 槽位1 Style —— 点开弹出 modal「PICK THE STYLE THAT HITS」
副标题原文: "From unboxing to UGC - choose the type of video that fits your product and audience."
分类 tab: All / TikTok(NEW) / UGC / Commercial
每个预设 = 名称 + 一句大白话描述（部分标注底层模型 Symphony/Higgsfield）。全量清单：
- UGC — Realistic social media videos
- Gadget Saved Me — Turn product features into a creator-led recommendation
- Giant Figure — Oversized, scroll-stopping product moments
- Unboxing Try On — Unbox and try on in one take
- Unboxing ASMR — Satisfying ASMR unboxing experiences
- Try On Sneakers — Virtual sneaker try-on videos
- Couple Sharing — A couple sharing the product at home
- Selfie Testimonial — Authentic selfie-style testimonials
- Direct to Camera — Creator speaking straight to camera
- Secret Hack Reveal / Crush Test / Hyper Motion / Camera POV / Classic Meets Modern
- Mess to Fresh / Mystery Box / Reboxing / TV Spot / Addiction / Before & After
- Tutorial / Unboxing / UGC Virtual Try On / Pro Virtual Try On
- Wild Card — A unique and creative video mode for custom...（自定义兜底）

## 槽位2 Hook —— modal「HOOKS THAT STOP THE SCROLL」
副标题原文: "The first 3 seconds decide if your ad gets watched or skipped. Pick a proven opener."
分类: All / Stunt / Subtle。每个 hook = 命名 + 完整分镜脚本，例如：
- Product Hit — "Object flies into frame, hits subject. Brief reaction → pivot to product."
- Spicy / Interview / Random Object Mic / Product Crash / Blizzard / Camera Bump / Product Dodge / Epic Fail …
即"爆款开场脚本库"，用户零编剧即可选一个已验证开场。

## 槽位3 Setting —— modal「SETTINGS THAT SET THE SCENE」
副标题原文: "Choose where the story unfolds. Pick a setting that frames your ad with the right mood."
分类: All / Realistic / Unrealistic。每个 = 命名 + 场景/情绪描述：
- Bedroom / Airplane Wing / Nature / Roofing / Gym / Volcano Rim / Bathroom …
（如 Bedroom: "On bed or propped against pillows, soft window light. Unmade bed, cozy textures. Relaxed morning..."）

## 模板墙（Try / Recreate = 做同款）
composer 下方成片画廊，分类 tab: All / TikTok(NEW) / UGC / Commercial
每张卡 = 预览视频（Unmute preview）+ 名称(h3) + 描述 + **"Try"** 按钮；每个具体成片有 **"Recreate"** 按钮。
- **"Try"（模板级做同款）实测行为**: 不是一键填满静默表单，而是触发**引导式向导**——预置该模板的槽位（实测 Setting 槽位从默认"Setting"变为"Bedroom"，标签直接显示选中值），并逐个弹出 picker 让用户确认/替换。
- **草稿持久化**: composer 的槽位选择/向导进度**跨页面刷新保留**（服务端草稿态），刷新后回到上次向导步骤。

## 交互范式小结（对非技术用户降门槛）
把"做一条广告"拆成 **3 个可点语义维度（类型 / 开场 / 场景）**，而非一张大表单或一个空白 prompt。每维度：①有合理默认值 → 零输入可跑；②点开=可视化画廊（看预览挑，不靠想象）；③每项配大白话描述 + 已验证脚本。prompt 自由文本只是"叠加微调"，非必填。
