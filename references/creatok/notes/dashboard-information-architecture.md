# Creatok Dashboard Information Architecture

研究日期：2026-07-07  
入口：https://www.creatok.ai/app/dashboard  
浏览会话：opencli browser session `creatok-ia`，复用当前 Chrome profile `xhs` 登录态  
范围：只读观察、页面抽取和截图；未点击生成、发布、购买、授权、删除、提交等消耗或破坏性动作。

## 截图索引

截图目录：`references/creatok/screenshots/`

- `creatok-ia-dashboard-home.png`：Dashboard 首页
- `creatok-ia-workspace-menu.png`：工作区/计划/积分菜单
- `creatok-ia-account-menu.png`：账号菜单
- `creatok-ia-video-menu.png`：视频创作菜单
- `creatok-ia-image-menu.png`：图片创作菜单
- `creatok-ia-audio-menu.png`：音频菜单
- `creatok-ia-tools-menu.png`：工具菜单
- `creatok-ia-explore-no-dialog.png`：探索入口点击/悬停后未出现独立弹层的状态
- `creatok-ia-assets.png`：资产库
- `creatok-ia-ai-video-generator-history.png`：视频生成/历史页
- `creatok-ia-image-generator.png`：图片生成页
- `creatok-ia-agent.png`：Agent 页
- `creatok-ia-video-analysis-chat.png`：视频分析页
- `creatok-ia-flow.png`：画布/工作流页
- `creatok-ia-gallery.png`：灵感广场
- `creatok-ia-platform-tiktok.png`：TikTok 视频发布页
- `creatok-ia-account.png`：账户设置页
- `creatok-ia-billing.png`：计划和账单页
- `creatok-ia-credits.png`：积分流水页
- `creatok-ia-favorites.png`：我的收藏页
- `creatok-ia-referral.png`：我的邀请页
- `creatok-ia-pricing.png`：定价页
- `creatok-ia-workspace-settings-redirect-dashboard.png`：工作区基础设置直达后重定向首页
- `creatok-ia-api-keys-redirect-dashboard.png`：API Keys 直达后重定向首页

## 全局 App Shell

### 左侧导航

顶部区域：

- 工作区切换器：当前为个人空间，菜单内显示 Free 计划、积分、所有工作区、创建新团队入口。
- 一级入口：
  - 首页：`/app/dashboard`
  - Agent Beta：`/app/agent`
  - 视频分析：`/app/chat`
  - 探索：按钮入口；本次点击/悬停未展开独立菜单，首页和灵感广场承担探索内容。

创作：

- 视频：hover 弹出视频工具菜单。
- 图片：hover 弹出图片工具菜单。
- 音频：hover 弹出音频工具菜单。
- 画布：`/app/flow`
- 工具：hover 弹出工具菜单。

平台：

- 视频发布：`/app/platform/tiktok`，带“送积分”标记。

空间：

- 资产库：`/app/assets`

底部账号：

- 账号菜单包含：我的收藏、我的邀请、计划和账单、Skills/API Keys、账户、语言、主题、退出。

### 顶部栏

Dashboard 顶部常驻入口：

- Skills：`/agent-skills`
- 文档：飞书文档外链
- 反馈按钮
- 主题/显示按钮、客服/耳机图标
- 升级：`/pricing`
- 积分按钮：当前显示 4

## 菜单 IA

### 视频菜单

入口来自左侧“视频”。菜单项：

- 视频生成：`/app/ai-video-generator`
- 爆款复刻：`/app/viral-video-cloning`
- 链接生视频：`/app/link-to-video`
- 提示词反推：`/app/video-to-prompt`
- 去字幕：`/app/video-subtitle-remover`
- 去水印：`/app/video-watermark-remover`
- 画质提升：`/app/video-upscale`
- 视频对口型：`/app/video-lip-sync`
- 视频翻译：`/app/video-translate`
- 角色替换：`/app/video-character-swap`
- 动作控制：`/app/motion-control`

### 图片菜单

入口来自左侧“图片”。菜单项：

- 图片生成：`/app/image/generator`
- 商品套图：`/app/image/product-listing`
- A+内容：`/app/image/product-listing-aplus`
- 详情图：`/app/image/detail-page`
- 图片复刻：`/app/image/batch-image-clone`
- 分镜：`/app/image/storyboard`
- 多角度：`/app/image/multi-angle`
- AI 换装：`/app/image/virtual-try-on`
- 图片翻译：`/app/image/translate`
- 去除背景：`/app/image/remove-bg`
- 高清放大：`/app/image/upscale`

### 音频菜单

- 文字转语音（TTS）：`/app/audio/text-to-speech`
- 声音克隆：`/app/audio/voice-clone`

### 工具菜单

- 带货脚本创意Agent：`/app/prompt-agent`
- 创意飞轮：`/app/inspiration-hub`
- TikTok 脚本提取：`/app/tiktok-transcript-generator`

## Dashboard 首页

主标题：分析、复刻或生成爆款带货视频。

首页核心是一个多模式创作入口：

- Tab：视频生成、图片生成、视频分析。
- 视频生成表单：
  - 输入扩展按钮
  - 参考、首尾帧、编辑模式
  - 参考图片上传、参考视频上传、Avatar/人物入口
  - Prompt 文本框：支持使用 `@` 指定参考图或参考视频
  - 模型选择：默认观察到 Seedance 2
  - 规格设置：720P、9:16、8s
  - 生成数量：生成 1 条
  - 预设、优化、向导
  - 字数计数：0/8000
  - 积分/消耗提示按钮
  - “我生成的视频”跳转到 `/app/ai-video-generator`

首页模块还包括：

- 大卡片：图片生成，展示 GPT Image 2、Nano Banana 2/Pro、Seedream 5。
- 快捷卡：爆款复刻、提示词反推、去字幕、商品套图、A+内容、换装试穿。
- 工具条：去水印、画质提升、文字转语音（TTS）、多角度、图片翻译、视频翻译。
- 灵感/模板区：模型、比例、参考图、首尾帧、商品分类、语言筛选，搜索提示词或关键词，More 跳转 `/app/gallery`。

## 核心页面

### 资产库 `/app/assets`

资产库按资产类型/来源分组：

- AI 生成
- 上传资产
- 数字人
- 商品库
- 回收站

页面能力：

- 存储额度展示：0 B / 1 GB
- 批量操作
- 生成图片、生成视频
- 类型筛选、日期范围、全部筛选、从新到旧排序
- 当前 AI 生成内容为空，提示开始创作后作品会展示在这里

### 视频生成/历史 `/app/ai-video-generator`

页面是“历史/示例 + 视频生成表单”的组合：

- Tab：历史、示例
- 历史菜单按钮
- 示例分类：产品展示、生活方式、穿搭分享、UGC种草、好物推荐、科技发布、美妆特写、值不值得买、好物日常、POV收包裹、前后对比、护肤日常、奢品广告、UGC参考风格、饮品广告、数码产品、故事带货、家具组装、桌面改造、晨间日常
- 生成表单与首页视频生成表单一致：参考/首尾帧/编辑、上传、Prompt、模型、规格、数量、预设、优化、向导、积分提示

未点击“生成 1 条”。

### 图片生成 `/app/image/generator`

结构与视频生成相似：

- Tab：历史、示例
- 示例分类：白底图、产品精修、一键场景图、模特图、试穿套装、模特参考、试穿-参考背景、一键产品主图、生活化场景、细节特写、一键卖点、一键A+详情、一键营销海报、一键买家秀、换模特、AI换背景、商品替换、产品渲染
- 输入：参考图上传、Prompt 文本框，支持 `@` 引用参考图
- 模型：观察到 Nano Banana 2
- 输出规格：2K、Auto
- 生成张数：1 张
- 预设、向导、积分提示

未点击生成。

### Agent `/app/agent`

打开 `/app/agent` 后自动进入一个新 Agent 对话 URL（带 `new=1` 参数），但未发送消息。

页面定位：内容电商 AI 运营团队。

主要入口：

- 历史（快捷键提示：⌘ K）
- 添加附件
- 技能
- 发送按钮（无输入时禁用）
- 快捷任务：一键创作带货视频、复刻爆款视频、拆解爆款视频、反推视频提示词
- 扩展入口：创作视频、创作图片

### 视频分析 `/app/chat`

页面定位：上传视频文件或粘贴 TikTok 链接后进行问答/分析。

主要模块：

- 主标题：分析、复刻或生成爆款带货视频
- 意图入口：分析脚本、复刻爆款、创作爆款
- 上传视频
- 添加链接
- 视频脚本工具：`/app/tiktok-transcript-generator`
- 会话历史：当前暂无会话历史

### 画布 `/app/flow`

页面定位：AI 工作流/模板/项目中心。

主要模块：

- 顶部输入：描述你的想法，AI 帮你实现
- 快捷建议：产品多角度图、UGC素材、品牌横幅、促销海报
- 项目区：新建工作流；最近、我的、团队；当前我的/团队为空
- 教程（视频）：基础功能、快捷键、工作助手、工作流模式、应用模式
- 社区模板：全部、电商、营销、创意、媒体
- 模板卡片动作：一键做同款、预览

未点击“新建工作流”或“一键做同款”。

### 灵感广场 `/app/gallery`

页面定位：探索他人创作，可播放、查看提示词或做同款。

主要模块：

- Tab：视频、图片
- 筛选：模型、比例、参考图、首尾帧、商品分类、语言
- 搜索：搜索提示词或关键词
- 内容卡动作：做同款

未点击播放、查看提示词或做同款。

### TikTok 视频发布 `/app/platform/tiktok`

页面定位：TikTok 带货 & 普通视频发布。

主要模块：

- 账号列表
- 常见问题外链
- 新增账号
- 使用教程外链
- 限时活动：每发布 1 条带货视频送 1 积分
- 授权说明：官方授权接口、操作提效、创作者主导流程
- 支持国家/地区列表：美国、墨西哥、巴西、英国、爱尔兰、西班牙、德国、意大利、法国、日本

当前暂无授权账号。未点击新增账号或进入授权流程。

## 账号、计费、设置

### 工作区菜单

工作区菜单展示：

- 当前个人空间
- Free 计划
- 积分入口
- 所有工作区
- 当前个人空间标记为 Free
- 创建新团队入口，指向付费/升级相关页面

### 账号菜单

账号菜单展示：

- 我的收藏：`/app/user/favorites`
- 我的邀请：`/app/user/referral`
- 计划和账单：`/app/user/billing`
- Skills / API Keys：`/app/workspace/api-keys`
- 账户：`/app/user/account`
- 语言
- 主题
- 退出

### 账户设置 `/app/user/account`

页面含工作区/账户设置侧栏：

- 基础设置：`/app/workspace/settings`
- 成员管理：`/app/workspace/members`
- API Keys：`/app/workspace/api-keys`
- 账户：`/app/user/account`

账户页内容：

- 用户名：可编辑，保存按钮无变更时禁用
- 邮箱：展示绑定邮箱
- 登录方式：Google 为主要登录方式，解绑按钮当前禁用
- 设置密码：发送验证码
- 设备管理：在线状态、设备信息、当前设备、移除全部设备按钮当前禁用
- 删除账户：危险操作入口

### 工作区设置/API Keys

直接访问以下路径会重定向回 Dashboard 首页：

- `/app/workspace/settings`
- `/app/workspace/api-keys`

推断：当前个人 Free 空间或当前权限下，工作区基础设置和 API Keys 入口存在于导航/账号菜单中，但页面不可直接只读访问。

### 计划和账单 `/app/user/billing`

页面内容：

- 订单记录：暂无订单记录
- 订阅管理：管理订阅与付款方式
- 管理/退订按钮：当前禁用

### 积分 `/app/user/credits`

页面是积分流水表：

- 列：时间、功能、说明、变动、积分余额
- 当前观察到余额为 4
- 流水中包含初始积分分配和视频消耗记录

### 我的收藏 `/app/user/favorites`

页面结构：

- Tab：视频、图片
- 当前提示：暂无收藏的视频

### 我的邀请 `/app/user/referral`

页面内容：

- 邀请好友注册，双方各可获得 10 积分奖励
- 邀请奖励仅对付费用户开放
- 升级会员计划入口

### 定价 `/pricing`

访问 `/pricing` 会进入中文定价页 `/zh/pricing`。

主要结构：

- Tab：加量包、月付订阅
- 币种选择：人民币（CNY）
- 套餐：
  - 免费版：6 积分/月，测试模型效果
  - 基础版：150 积分/月，个人轻量创作
  - 专业版：1,000 积分/月，小团队批量产出
  - 旗舰版：5,000 积分/月，团队高频生产
- FAQ：积分消耗、生成失败是否扣积分、积分用完、订阅积分顺延、取消计划、退款

未点击购买/立即开始。

## 重要观察

- Creatok 的核心 IA 以“创作工具 + 资产/历史 + 灵感/模板 + 平台发布 + 账号计费”为主。
- 首页不是单纯概览页，而是主要创作入口和工具分发页；视频生成是默认主任务。
- 历史记录不是全局一级导航，而是嵌在具体工具页（如视频生成、图片生成）内；全局资产沉淀在资产库。
- 左侧菜单大量使用 hover 弹层暴露工具矩阵；工具入口本身基本都是独立 URL。
- 账号/计费/积分/邀请/收藏均藏在底部账号菜单内；工作区设置侧栏只在账户页可见。
- 当前个人 Free 空间下，工作区设置/API Keys 的直达 URL 会重定向首页。
- TikTok 发布是平台能力，但需要先授权账号；当前无授权账号。
- Agent 页打开即创建/进入一个新对话 URL，但未发送消息或触发生成。
- “探索”左侧按钮本次未展开独立弹层；可观察的探索功能主要来自首页灵感区和 `/app/gallery`。

## 未执行动作

- 未点击任何“生成”“做同款”“一键做同款”“发布”“新增账号授权”“购买/立即开始”“删除账户”“退出”等动作。
- 未上传文件、未粘贴链接、未提交表单。
