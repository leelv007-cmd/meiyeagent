# Higgsfield 登录态深拆（Marketing Studio + Cinema Studio）

- 调研：higgsfield-deep agent（opencli browser 复用登录态 + DOM 提取，全程只读未点 Generate）
- 留档：sources/ 下 genai-higgsfield-deep-{marketing-studio,cinema-studio,motion-video}.md
- 定位：补 kling-higgs 二轮未细讲的两块（Marketing Studio 分步流、Apps），并带回对主入口方案的多处修正

## 一、Marketing Studio（最相关，商家做营销内容）

- 入口 `/marketing-studio/product`，H2 "TURN ANY PRODUCT INTO A VIDEO AD"，Product/App 双 tab。
- composer = **一个自由 prompt（占位 "Describe what happens in the ad..."，可留空）+ 三个语义槽位**，非大表单也非纯空白 prompt。
- **三槽位 = 把"一条广告"拆成三个可点维度（关键设计）**：
  - **Style**（默认已填 "UGC"）→ modal「PICK THE STYLE THAT HITS」，25+ 预设，每个=名称+大白话描述（UGC=Realistic social media videos / Gadget Saved Me / Unboxing ASMR / Before & After / Wild Card 自定义兜底）。分类 tab: All/TikTok/UGC/Commercial。
  - **Hook**（开场3秒）→「HOOKS THAT STOP THE SCROLL」"The first 3 seconds decide if your ad gets watched or skipped"。每个 hook=命名+**完整分镜脚本**（Product Hit="Object flies into frame, hits subject. Brief reaction → pivot to product" / Spicy / Interview / Epic Fail）=**爆款开场脚本库**。
  - **Setting**（场景）→ 命名+情绪描述（Bedroom / Gym / Airplane Wing / Volcano Rim）。
- 产出：整条视频广告；主按钮 "GENERATE 48 40"（划线价/实付积分）。
- **极低门槛入口**：侧栏 `Url to Ad`（贴商品链接出广告）+ `Ad Reference`（参考已有广告反推）。
- **预设选中后预填**：槽位选中→标签直接变选中值（Setting→"Bedroom"），所见即所选。

## 二、最强发现：Cinema Studio「Auto 默认无处不在」

`/generate` 点 Style → modal「Cinematic settings」：顶层 Genre/Style/Camera 默认 General/Auto/Auto；Manual Style 默认 Off；展开后**每一项第一个选项都是 Auto**（COLOR PALETTE: Auto/... · LIGHTING: Auto/... · CAMERA MOVESET: Auto/...）。
→ 非技术用户全留 Auto 直接生成、从不碰专业参数；专业用户逐层钻进。**同一界面服务两类人靠"字段不留空、默认=Auto=AI帮你定"，而非空值逼选。** prompt 支持 `@` 提及可复用角色/地点。

## 三、Motion Control：门槛最低的做同款

`/ai/video/motion`「RECREATE ANY MOTION WITH YOUR IMAGE」，Motion library=纯视觉预设网格（38+ 编号视频缩略，无文字参数）。流程=传一张图+挑运镜片段→出片，零 prompt 零打字。

## 四、修正 kling-higgs 二轮的两处理解

- **Apps 市场（重要修正）**：`/supercomputer/apps` 实为**全栈 App builder**（frontend/backend/database，Publish live to a real URL）——是"造 App"而非"填槽成品"。与我们"打包成品填槽"范式**关联度弱，别照抄**。
- **做同款/成片复用（修正）**：模板 `Try`/成片 `Recreate` **不是一键静默填满表单**，而是**引导式向导**——预置槽位后逐个弹 picker 让用户确认/替换；composer 草稿服务端持久化、跨刷新恢复。

## 五、对「四层门槛调和方案」的验证/修正

**L0 做同款——成立，但修正"占位"理解**：
- ✅ 强验证"非空表单"哲学（进来即有默认值、prompt 可空、零输入可跑）。
- ⚠️ 修正：Higgsfield 做同款是**引导式向导**（预置后逐槽弹 picker 确认），非"静默塞满整表点此替换"。建议取两者之长：**默认值可见可跑，但关键槽位保留一次"确认/替换"轻交互**——纯静默填满会让老板娘"不敢动"、对陌生默认值没掌控感。
- 💡 新增 **L-1 零表单入口**：`Url to Ad`（贴链接即出稿）比做同款更低门槛。美业="贴大众点评/团购链接→出探店文案"。

**L1 预设点选——强成立，三条形态升级**：
- 💡 **不要一个大预设墙，拆成"少数几个语义槽位"**：Higgsfield 把广告拆 Style/Hook/Setting 三维、Cinema 拆 Genre/Style/Camera。美业应拆成对老板娘有意义的维度：**【内容类型】(探店/项目种草/客户案例/节日活动) ×【钩子/开场】×【场景/风格】**，每维一个可视化 picker。比"一屏几十张卡"认知负荷低得多。
- 💡 **每预设配"大白话描述+客群语言分类"**（Higgsfield 每预设一句人话+TikTok/UGC 分类）。我们给"抖音/小红书/朋友圈"这类客群分类。
- 💡 **能视觉预览就别用文字**（Motion library 纯看缩略图挑）。

**贯穿铁律（建议写进设计规范）**：
1. **字段永不留空、默认=Auto/智能预填**（服务非技术用户核心，对标 L4）。
2. **渐进式展开**（专业参数默认收起 Advanced/Manual Off，想深控才点开）。
3. **Hook/钩子独立成槽**——把爆款开场做成可点选预写脚本库，是美业引流内容最缺、老板娘最写不出、最该产品化的一层。
