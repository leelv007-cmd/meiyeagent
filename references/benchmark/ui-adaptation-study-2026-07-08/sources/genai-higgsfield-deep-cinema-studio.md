URL: https://higgsfield.ai/generate  （Cinema Studio 专业创作台）
日期: 2026-07-08
登录态: 是。采集方式: opencli browser + DOM 提取（只读，未点 Generate）

# Cinema Studio —— "Auto 默认 + 渐进式展开"的教科书样本

## prompt 条（compact composer）
- H1: "CREATE YOUR FIRST PROJECT. GENERATE THE IMPOSSIBLE."
- 模式 tab: Image / Video
- prompt 输入框 data-placeholder = **"Describe your scene - use @ to add characters & locations"**
  （**@ 提及**机制：把已保存的角色/地点作为可复用元素插入 prompt——对应"复用资产"）
- **语义槽位 chip（全部默认 Auto/General）**:
  - **Genre: General**
  - **Style: Auto**
  - **Camera: Auto**
- 参数 chip 条: **Cinema Studio 3.5**（模型）· Auto · **1080p** · **8s**（时长，带 Decrement/Increment 步进）· "On" 开关（图标态，疑似 prompt 增强/AI Director 开关，默认 On）
- 主按钮: **"GENERATE 96 80"**（96 划线 / 80 实付积分）
- 另有 compact 输入 "Describe the scene you imagine..." + aria=[Generate] 快捷生成按钮

## 点开「Style: Auto」chip → modal「Cinematic settings」——关键发现
顶部三段: Genre: General / Style: Auto / Camera: Auto
下方 "Style Settings" 面板，总开关 **"Manual Style · Off"**（手动模式默认关，即默认全交给 AI）。
展开后是电影级细分参数，**每一项第一个选项都是 "Auto"**：
- **COLOR PALETTE**: **Auto**(默认) / Naturalistic Clean / Bleached Warm / Hyper Neon / Teal Orange Epic / Sodium Decay / Cold Steel / Bleach Bypass / Classic Bw
- **LIGHTING**: **Auto**(默认) / Soft Cross / Contre Jour / Overhead Fall / Window / Practicals / Silhouette
- **CAMERA MOVESET STYLE**: **Auto**(默认) / Classic Static / Silent Machine / One Take / Epic Scale / Intimate Observer / Impossible Camera / Documentary Snap / Raw Chaos / Dreamy Flow

## 交互范式小结（对我们最重要的一条）
**"Auto 默认无处不在 + 渐进式展开"**：
- 非技术用户：三个槽位全留 Auto、Manual Style Off、prompt 随便写 → 直接生成，从不接触任何专业参数。
- 进阶/专业用户：可逐层钻进 color/lighting/camera moveset 做电影级控制。
- 同一界面同时服务两类人，靠的是**默认值即"AI 帮你定"，而非空值逼用户选**。
这正是"字段级 AI 预填可编辑（L4）"的成熟形态：字段不留空、默认=Auto=智能预填、用户想改才点开。
