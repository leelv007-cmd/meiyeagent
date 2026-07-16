# CreatOK 功能拆解报告

调研日期：2026-07-07

调研对象：
- 官网：`https://www.creatok.ai/`、`https://www.creatok.ai/zh`
- 登录态后台：`https://www.creatok.ai/app/dashboard`
- 官方公开 Skills 仓库：`https://github.com/EchoSell/creatok-skills`

调研边界：
- 使用本机登录态进入 dashboard，只做观察、截图和网络预览。
- 没有提交视频/图片生成任务，没有消耗积分。
- 网络结论只基于浏览器被动捕获的 endpoint 名称、状态码和响应 shape；没有抓取敏感响应体。
- 技术架构部分区分“实测事实”和“推断”。

本地证据索引：`references/creatok/notes/evidence-index.md`

## 1. 一句话结论

CreatOK 不是单点 AI 视频生成器，而是面向 TikTok Shop / 跨境电商卖家的“内容生产 + 爆款拆解 + 素材资产 + 工作流模板 + 官方发布 + Agent 外部调用”的垂类内容工作台。

它对我们最有价值的不是跨境电商场景本身，而是这套产品化方法：

1. 用垂类任务替代空白聊天框：爆款复刻、商品套图、A+ 内容、TikTok 发布都是结构化工作流。
2. 用资产库承接生成结果：AI 生成、上传资产、数字人、商品库、回收站统一管理。
3. 用历史任务和 task id 承接异步生成：生成是任务，不是一次性返回。
4. 用 credits 统一计费：套餐、积分、模型消耗、失败补偿、队列优先级和团队共享打通。
5. 用 Agent Skills 扩展入口：让 Codex / Claude Code / OpenClaw 等外部 agent 通过 API key 调用 CreatOK 能力。
6. 用官方平台接口包装分发能力：TikTok 发布强调官方授权 API，而不是浏览器脚本或逆向自动化。

对我们的“美业内容副驾”来说，应借鉴“垂类结构化工作流 + 资产库 + 任务历史 + 积分账本 + 场景包/Skills + 受控发布”的产品机制；不应照搬“TikTok 爆款复刻”和“真视频生成优先”的重心。

## 2. 产品定位

CreatOK 官网中文主标题是“发现、复刻和裂变 TikTok 电商爆款视频”，副标题表达为“TikTok 电商 AI 内容平台：用 AI 生产图文音视频带货素材，发现爆款、官方 API 直发”。

公开站点声称：
- 30 万+ TikTok 电商卖家/活跃用户。
- 500 万+ 视频生成。
- 20+ 国家覆盖。
- TikTok Official Certified Partner / 官方 API 相关合作口径。

核心对象是 TikTok 电商卖家、跨境电商品牌、广告素材团队、短视频运营团队。

与我方差异：

| 维度 | CreatOK | 我方美业内容副驾 |
| --- | --- | --- |
| 首发用户 | TikTok Shop / 跨境电商卖家 | 本地到店商家，优先美业/医美内容商家 |
| 核心转化 | 商品点击、带货视频、广告素材、TikTok 发布 | 咨询、加微、预约、团购券、到店 |
| 内容重心 | 视频和电商图片资产 | 平台原生文案、真实素材图文、视频脚本/轻视频发布包 |
| 平台重心 | TikTok Shop 官方 API | 小红书、抖音、大众点评、公众号等，P0 以 L3 发布包兜底 |
| 合规重心 | 版权/IP/肖像/平台政策 | 广告法、AIGC 标识、医美/医疗 Regulated Content Mode、价格/资质/素材授权 |

结论：CreatOK 的行业对象不能直接迁移，但它的“垂类工作流产品化”非常值得迁移。

## 3. 信息架构拆解

### 3.1 App Shell

登录态 dashboard 左侧导航分为四组：

| 分组 | 入口 | 功能含义 |
| --- | --- | --- |
| 主入口 | 首页、Agent、视频分析、探索 | 统一起始页、agent 对话、视频分析/复刻、灵感/趋势入口 |
| 创作 | 视频、图片、音频、画布、工具 | 多模态生成与专项工具集合 |
| 平台 | 视频发布 | TikTok 账号绑定、官方发布、发布奖励 |
| 空间 | 资产库 | 生成结果、上传素材、数字人、商品库、回收站 |

顶部常驻入口：
- Skills。
- 飞书文档外链。
- 反馈。
- 主题/显示按钮。
- 升级。
- 积分按钮，当前账号显示 4。

底部账号菜单：
- 我的收藏。
- 我的邀请。
- 计划和账单。
- Skills/API Keys。
- 账户。
- 语言。
- 主题。
- 退出。

当前 Free 个人空间下，parallel IA agent 观察到 `/app/workspace/settings` 和 `/app/workspace/api-keys` 会重定向回首页，说明部分团队/API Key 能力可能受套餐、组织或权限限制。

### 3.2 菜单规模

视频菜单 11 个入口：
- 视频生成、爆款复刻、链接生视频、提示词反推、去字幕、去水印、画质提升、视频对口型、视频翻译、角色替换、动作控制。

图片菜单 11 个入口：
- 图片生成、商品套图、A+ 内容、详情图、图片复刻、分镜、多角度、AI 换装、图片翻译、去除背景、高清放大。

音频菜单 2 个入口：
- TTS、声音克隆。

工具菜单 3 个入口：
- 带货脚本创意 Agent、创意飞轮、TikTok 脚本提取。

产品判断：
- CreatOK 把“工具大全”藏在 hover 菜单中，首屏只暴露高频任务。
- 对我方 P0，导航必须更克制；美业老板不适合一开始看到 20+ 工具入口。

### 3.3 首页 dashboard

首页标题是“分析、复刻或生成爆款带货视频”。首屏放一个视频生成输入框，支持：
- 上传参考图片。
- 上传参考视频。
- 添加 avatar。
- 文字描述，最多 8000 字。
- 模型选择，默认显示 Seedance 2。
- 参数按钮：720P、9:16、8s。
- 生成数量。
- 预设、优化、向导。
- 积分估算按钮，当前显示 44。

首页还放了一组工具卡：
- 图片生成。
- 爆款复刻。
- 提示词反推。
- 去字幕。
- 商品套图。
- A+ 内容。
- 换装试穿。
- 去水印。
- 画质提升。
- TTS。
- 多角度。
- 图片翻译。
- 视频翻译。

产品启发：
- 首屏不要是“欢迎使用”，而应直接提供主工作流。
- 工具卡不是简单导航，要有场景化命名和示例图。
- 默认模型、比例、时长、数量、预设、优化、向导、成本估算这些控制项，应在输入框附近完成闭环。

## 4. 核心功能模块

### 4.1 Agent：内容电商 AI 运营团队

Agent 页文案：
- “带货内容，一句话就有”
- “你的内容电商 AI 运营团队”

功能形态：
- 对话输入框。
- 文件附件上传，支持图片、视频、PDF、Office、文本、CSV、JSON、XML、YAML、压缩包等。
- 技能按钮。
- 历史入口。
- 快捷动作：一键创作带货视频、复刻爆款视频、拆解爆款视频、反推视频提示词。

关键判断：
- CreatOK 的 Agent 不是泛聊天机器人，而是绑定垂类任务的“调度入口”。
- 快捷动作直接连接后台工具，而不是让用户自己写 prompt。
- 附件能力暗示 agent 能读取产品资料、素材、文档、表格等上下文。

对我方启发：
- 我们的“创作副驾”应该有快捷动作：生成本周内容、从案例图写小红书、生成抖音口播、生成点评项目介绍、生成拍摄清单、生成发布包。
- 附件上传可以服务门店档案冷启动：价目表、历史帖子截图、项目介绍、顾客好评、活动海报。
- “技能”应该映射为美业场景包，而不是工程概念。

### 4.2 视频分析

视频分析页让用户先选择意图：
- 分析脚本。
- 复刻爆款。
- 创作爆款。

输入方式：
- 上传视频。
- 上传图片。
- 添加 TikTok 视频链接。
- 文案提示：“上传视频文件或粘贴 TikTok 视频链接，然后问我任何问题...”
- 会话历史。
- 引导批量提取脚本去“视频脚本工具”。

产品启发：
- “分析 / 复刻 / 创作”是对用户意图的清晰分流。
- 对我们可映射为“拆解本店历史爆款 / 改写成新平台稿 / 生成新内容”。
- 视频分析不只是工具，而是后续复刻和生成的上游。

### 4.3 视频生成

视频生成页包含：
- 历史 / 示例 tab。
- 示例分类：产品展示、生活方式、穿搭分享、UGC 种草、好物推荐、科技发布、值不值得买、POV 收包裹、前后对比、护肤日常、奢品广告、UGC 参考风格、饮品广告、数码产品、故事带货、家具组装、桌面改造、晨间日常等。
- 参考图/视频上传。
- 首尾帧。
- 编辑。
- avatar。
- prompt 文本，最多 8000 字。
- 模型，默认 Seedance 2。
- 参数：720P、9:16、8s。
- 生成条数。
- 预设、优化、向导。
- 积分估算。

产品启发：
- “示例分类”就是可运营的垂类模板入口。
- 我方不应 P0 承诺真视频生成，但可以照搬这个结构做“视频脚本/拍摄清单/轻视频发布包”的生成入口。
- 美业分类可替换为：案例展示、项目前后对比、店员口播、环境探店、优惠活动、顾客好评、护理流程、节日款式、同城探店。

### 4.4 图片生成

图片生成页包含：
- 历史 / 示例 tab。
- 精选模板：白底图、产品精修、一键场景图、模特图、试穿套装、模特参考、试穿参考背景、一键产品主图、生活化场景、细节特写、一键卖点、一键 A+ 详情、产品渲染等。
- 参考图上传。
- prompt，最多 2000 字。
- 模型，默认 Nano Banana 2。
- 参数：2K、Auto。
- 生成张数。
- 预设、向导。
- 积分估算。

产品启发：
- 图片生成要围绕业务任务包装，而不是只展示模型。
- 我方图片/图文 P0 应优先提供“真实素材增强、封面文案、项目价格卡、before/after 卡、好评卡、门店环境图文卡”。
- 模型名称可以出现，但用户主要选择的是用途和模板。

### 4.5 爆款复刻

输入结构：
- 原视频素材：必填。
- 视频链接：支持 TikTok，其他平台暂未开放。
- 上传视频文件。
- 从资产库选择视频。
- 商品信息：补充商品信息可提升分镜匹配度。
- 商品链接：TikTok Shop 商品链接，可识别。
- 手动填写商品信息。

页面承诺：
- 基于爆款做复刻改编。
- 不照搬。
- 裂变增强。
- 一键生成视频。

产品启发：
- 这不是“复制视频”，而是“参考结构 + 商品上下文 + 差异化改写 + 生成”。
- 我方可以做“本店爆款复用”：选择历史内容或竞品案例，提取结构，替换为本店项目/素材/优惠，再生成平台变体。
- 必须加入合规边界：医美/医疗效果、前后对比、价格承诺、顾客案例授权不能简单复刻。

### 4.6 商品套图

商品套图页是强结构化工作流：
- 上传图片，0/16，支持 JPG/JPEG/PNG/WEBP，单张不超过 10MB。
- 从资产库选择。
- 目标平台：默认 TikTok Shop。
- 目标市场：默认美国。
- 文案语言：默认英语。
- 产品信息 textarea：产品名、核心卖点、适用人群、期望场景、尺寸参数。
- AI 推荐风格 / 参考或自定义风格。
- AI 推荐风格分析。
- 套图结构配置：智能匹配或自定义配置，至少 7 张。

示例输出结构：
1. 白底主图。
2. 品牌主视觉海报。
3. 核心卖点海报。
4. 材质与结构说明图。
5. 工艺细节图。
6. 规格与品质信任图。
7. 真实使用场景图。
8. 收官价值视觉图。

产品启发：
- 这是“垂类图文模板 + 生成流程 + 输出结构”的完整样板。
- 我方可以做“项目套图”：封面种草图、案例图、项目卖点卡、适合人群卡、流程说明卡、价格/优惠卡、注意事项卡、预约引导卡。
- “智能匹配 / 自定义配置”可以用于让商家选择一键生成或手动指定卡片数量。

### 4.7 A+ 内容

A+ 内容页面向 Amazon / TikTok Shop 等平台的详情图。

输入：
- 上传商品素材 0/16。
- 电商平台，默认 Amazon。
- 目标市场，默认美国。
- 文案语种，默认英语。
- 产品信息：产品名称、核心卖点、适用人群、期望场景、具体参数。
- 爆款风格 / 参考或自定义风格。
- 爆款风格分析。

模块选择：
- 首屏主视觉。
- 核心卖点图。
- 使用场景图。
- 多角度图。
- 场景氛围图。
- 商品细节图。
- 品牌故事图。
- 尺寸/容量/尺码图。
- 效果对比图。
- 详细规格/参数表。
- 工艺制作图。
- 配件/赠品图。
- 系列展示图。
- 商品成分图。
- 售后保障图。
- 使用建议图。

产品启发：
- “模块选择器”是可迁移价值很高的交互。
- 我方可做“图文长图模块”：项目简介、适合人群、真实案例、服务流程、老师资历、环境信任、注意事项、价格说明、活动说明、预约方式、合规提示。
- 医美/医疗场景必须把“效果对比图”放入 Regulated Content Mode，不应默认鼓励效果承诺。

### 4.8 Flow 画布

Flow 页面形态：
- 自然语言输入：“描述你的想法，AI 帮你实现”。
- 上传图片。
- 技能按钮。
- 快捷 chips：产品多角度图、UGC 素材、品牌横幅、促销海报。
- 项目区：最近、我的、团队。
- 新建工作流。
- 教程视频：基础功能、快捷键、工作助手、工作流模式、应用模式。
- 社区模板：全部、电商、营销、创意、媒体；支持搜索。
- 社区模板卡展示公开/示例工作流。

网络线索：
- `/app/api/flow/communitys?limit=20&offset=0`
- `/app/api/flow/flows?limit=20&offset=0`
- `/app/api/flow/flows?scope=team&limit=20&offset=0`
- `/app/api/flow/generate-preview-url`

产品启发：
- Flow 是面向高阶用户/团队的可视化工作流，不适合我方 P0 首屏。
- 但“社区模板 + 团队工作流 + 自然语言创建工作流”可以作为 P1/P2 的运营模板中心。
- P0 可以先做不可视化的固定工作流，后续再把高频链路沉淀为可复制模板。

### 4.9 资产库

资产库 tab：
- AI 生成。
- 上传资产。
- 数字人。
- 商品库。
- 回收站。

其他能力：
- 存储额度：当前账号显示 0 B / 1 GB。
- 批量操作。
- 生成图片。
- 生成视频。
- 类型筛选。
- 日期筛选。
- 成员/范围筛选。
- 排序：从新到旧。
- 文件上传：图片和视频。

网络线索：
- `/app/api/storage-quota`
- `/app/api/asset-groups?type=avatar&limit=10`
- `/app/api/assets?pageSize=20&source=ai_tasks%2Csora_generations&sortOrder=desc&memberId=all`

产品启发：
- 我方素材库不能只是“上传图片”，应至少有：真实素材、AI 生成、发布包导出、门店资料、回收站。
- 美业场景还需要“顾客授权/待确认”“真实案例/AI 辅助”“已用于内容”“敏感素材”等标签。
- CreatOK 把数字人、商品库单独成 tab；我方可对应“账号人设/老师人设”“项目库/服务库”。

### 4.10 TikTok 视频发布

TikTok 发布页包含：
- 账号列表。
- 新增账号。
- 搜索账号。
- 使用教程和 FAQ 链接。
- 限时活动：每成功发布 1 条带货视频送 1 积分。
- 标题：TikTok 带货 & 普通视频发布。
- 已支持国家：美国、墨西哥、巴西、英国、爱尔兰、西班牙、德国、意大利、法国、日本。
- 官方授权接口：使用 TikTok 官方授权与发布 API。
- 操作提效：可先准备内容、选择收件箱草稿或直接发布，并在 TikTok 允许时定时。
- 创作者主导流程：发布流程绑定创作者账号，并遵循 TikTok 最新隐私、披露和发布设置。

网络线索：
- `/app/api/platform/tiktok/content-posting/accounts`
- `/app/api/platform/tiktok/accounts`

产品启发：
- 分发能力要被产品化成“账号列表 + 授权状态 + 教程 + 支持地区/平台能力 + 发布奖励/反馈”。
- CreatOK 强调官方 API，不强调浏览器自动化。这与我方“不承诺隐形全自动发布”的原则一致。
- 对小红书/抖音/点评等平台，我方 P0 应保持 L3 发布包兜底；L1 只在官方能力和账号级验收后启用；L2 只做 no-submit 灰度。

## 5. 定价、积分和团队

中文版 pricing：

| 套餐 | 价格 | 积分 | 关键权益 |
| --- | --- | --- | --- |
| 免费版 | ¥0 | 6 积分/月 | 爆款拆解体验、基础生成、3 次/天视频分析、公开视频、短期保留、邮件支持 |
| 基础版 | 早鸟 ¥69，原价 ¥99/月 | 150 积分/月 | 顶级视频/图像模型、高清短视频、无水印、无限分析、私有视频、1 个月保留、标准队列、社群支持 |
| 专业版 | 早鸟 ¥249，原价 ¥599/月 | 1000 积分/月 | 广告级视频、5 个角色一致性、3 个月保留、回收站、更快队列、2 人团队、共享积分与资产、优先支持 |
| 旗舰版 | 早鸟 ¥1199，原价 ¥1699/月 | 5000 积分/月 | 25 个角色一致性、6 个月保留、最高优先队列、10 人团队、专属支持 |

FAQ 机制：
- 不同模型、时长、清晰度和生成方式消耗不同积分。
- 高阶模型和高清长视频消耗更多。
- 失败任务会进行积分补偿。
- 积分用完可买加量包或升级。
- 加量包需要有效订阅使用。
- 订阅积分按时续费可顺延；暂停期间冻结；加量包积分永久有效。
- 月付计划不支持退款。

产品启发：
- 积分不是简单充值，而是连接模型成本、任务失败、保留期、队列优先级、团队协作、资产共享的商业化系统。
- 我方要尽早设计 Usage Ledger：reserve / commit / refund，而不是把额度扣减散落在工具里。
- 对美业 P0，可以先按内容条数、图文导出、视频脚本/轻视频、账号包、L2 次数做额度，不必按 token。

## 6. Agent Skills 和外部 API

公开 Agent Skills 页面和 GitHub 仓库显示，CreatOK 把核心能力包装成可安装到 Codex / Claude Code / OpenClaw 等 agent 的 skills。

仓库包含 4 个 skill：
- `creatok-analyze-video`
- `creatok-recreate-video`
- `creatok-generate-video`
- `creatok-generate-image`

共同机制：
- 使用 `CREATOK_API_KEY`。
- 远程调用 CreatOK Open Skills API。
- 本地 skill 是 thin client，不直接集成底层模型 provider。
- 生成图片/视频前必须请求用户确认。
- 生成任务提交后立即保存 `task_id`，支持中断后恢复。
- 通过 status endpoint 轮询任务完成。
- 模型列表、默认值、硬限制和价格估算从 capabilities endpoint 读取，避免本地硬编码。

公开 endpoint：
- `POST /api/open/skills/tasks`
- `GET /api/open/skills/tasks/status?task_id=...`
- `POST /api/open/skills/image-generation`
- `GET /api/open/skills/tasks/status?task_id=...&task_type=image_generation`

产品启发：
- 我方可以把“生成本周内容、改写平台变体、生成发布包、生成周报”包装为内部 tools，后续再开放为外部 agent skills。
- 高成本或高风险动作必须有 confirmation gate。
- 长任务必须持久化 task id，支持恢复，不要依赖前端连接不断。
- 模型能力和价格要走 provider registry/capabilities，不要写死在前端。

## 7. 技术表面拆解

### 7.1 实测事实

前端和部署：
- Next.js App Router / React 应用，证据包括 `/_next/static/chunks/*`、`self.__next_f.push`、RSC flight payload。
- 有 Turbopack 痕迹：`turbopack-*.js`、`globalThis.TURBOPACK`。
- 页面带 Vercel 风格部署标记和 `/_vercel/insights/view`。
- 样式和组件形态接近 Tailwind + Radix UI + Lucide。
- 多语言 route 包括 `/zh`、`/zh-TW`、`/ja`、`/id`、`/es`。

认证和组织：
- `/api/auth/get-session`
- `/api/auth/organization/list`
- `/app/api/organizations/plans`

计划/计费：
- `/app/api/plan`
- `/app/api/organizations/plans`
- plan code：`free`、`basic`、`pro`、`ultra`
- monthly credit 常量：Free 6、Basic 150、Pro 1000、Ultra 5000
- error code 覆盖 credits exceeded、free credit limit exceeded、model limited、subscription expired、storage quota exceeded、credit limit exceeded 等。

任务和资产：
- `/app/api/creation?page=1&pageSize=20`
- `/app/api/ai-tasks?taskType=image_generation&limit=20&offset=0`
- `/app/api/ai-tasks/viral-video-cloning?limit=6&offset=0`
- `/app/api/ai-tasks?taskType=image_product_set&limit=10&offset=0`
- `/app/api/ai-tasks?taskType=image_product_set_aplus&limit=10&offset=0`
- `/app/api/assets?...`
- `/app/api/storage-quota`
- `/app/api/asset-groups?type=avatar&limit=10`

发布：
- `/app/api/platform/tiktok/content-posting/accounts`
- `/app/api/platform/tiktok/accounts`

Flow：
- `/app/api/flow/communitys`
- `/app/api/flow/flows`
- `/app/api/flow/generate-preview-url`

第三方服务：
- Vercel Analytics。
- Meta Pixel。
- Google Analytics / Ads。
- Baidu analytics。
- Google Identity。
- Cloudflare Turnstile。
- 静态媒体 CDN：`static.echotik.live`。
- 媒体存储链接：`creatok.tos-accelerate.volces.com`。

### 7.2 API wrapper 和任务提交线索

技术 agent 从前端静态资源中确认：
- app API wrapper 以 `/app/api` 为 base prefix。
- app API 预期返回 `{ code, msg, data }`，成功 code 是 `0`。
- wrapper 会给 JSON body 自动补 `Content-Type: application/json`。
- 前端可见 submit endpoint 包括：
  - `/app/api/ai-tasks/image-generation/submit`
  - `/app/api/ai-tasks/image-generation/resume`
  - `/app/api/ai-tasks/video-generation/submit`
  - `/app/api/ai-tasks/batch`
- 任务状态包括 `draft`、`pending`、`queued`、`processing`、`running`、`downloading`、`completed`、`failed`、`cancelled`。
- `/app/api/ai-video-generator/success-rate` 会获取模型成功率。

上传链路：
- 请求 presigned URL。
- 浏览器 `PUT` 到 `presignedUploadUrl`。
- 通过 `/assets` 创建资产记录。
- presigned 请求字段包括 `fileName`、`fileType`、`fileSize`、`tosClientType`、`compression`、`prefix`、可选 `objectKey`。
- response 字段包括 `presignedUploadUrl`、`presignedAccessUrl`、`objectKey`。
- `tosClientType:"accelerate"` 和 TOS 相关痕迹说明对象存储大概率使用 Volcengine TOS，但 bucket/provider 仍是推断。

模型线索：
- Sora 2 / Sora 2 Pro。
- Veo 3.1 系列。
- Kling 3 / Kling 3 Omni。
- Seedance 1.5 Pro / Seedance 2 / Seedance 2 Fast / Seedance 2 Mini。
- Gemini Omni Flash。
- HappyHorse。
- Nano Banana 系列。
- GPT Image 2。
- Doubao / Seedream。
- Wan / Grok Video 在前端配置中出现，但可能是灰度或未启用，不能当成已上线能力。

### 7.3 推断

以下是合理推断，不等同源码确认：
- 前端部署或分发链路使用 Vercel。
- Auth 形态接近 Better Auth 或类似 auth/session + organization plugin 的结构。
- 核心生成任务使用异步任务模型，前端读取历史任务列表并展示状态。
- AI 任务按 `taskType` 区分，不同垂类工作流复用同一任务基础设施。
- 资产库把 AI task 产物、上传素材、avatar/product 等资源聚合。
- Flow 有社区模板、个人工作流和团队工作流三个作用域。
- 公开 Agent Skills 表明后端有一层 Open Skills API 代理，隔离底层模型 provider。

## 8. 对我方 P0 的映射建议

### 8.1 直接借鉴

| CreatOK 机制 | 我方映射 |
| --- | --- |
| 首页即主工作流 | 创作台首屏直接生成“本周内容”或“从素材生成一条内容” |
| 工具卡矩阵 | 文案、图文、视频脚本、发布包、线索周报、拍摄清单 |
| 历史 / 示例 tab | 内容任务历史 / 美业模板示例 |
| 预设 / 优化 / 向导 | 平台风格、语气、合规改写、素材不足向导 |
| 资产库五分类 | 真实素材、AI 生成、发布包、门店资料、回收站 |
| 商品套图结构化生成 | 美业项目套图、价格卡、案例卡、服务流程卡 |
| A+ 模块选择器 | 美业图文长图模块选择器 |
| Flow 社区模板 | P1/P2 美业场景包模板市场或内部运营模板库 |
| 官方 TikTok 发布页 | 账号能力矩阵、授权状态、发布层级说明、教程 |
| Credits + 失败补偿 | Usage Ledger reserve / commit / refund |
| Agent Skills | 后续对外 agent integration；P0 先内部 tools 化 |

### 8.2 不应照搬

| CreatOK 做法 | 不照搬原因 | 我方替代 |
| --- | --- | --- |
| TikTok 爆款复刻作为核心卖点 | 本地美业更重真实素材、门店口碑和合规表达 | 历史内容复用和平台变体生成 |
| 真视频生成首屏承重 | 我方 P0 成本和交付风险高 | 先做视频脚本、分镜、拍摄清单、轻视频发布包 |
| 商品链接识别 TikTok Shop | 美业项目不是标准 SKU 商品页 | 读取门店项目价目、活动、案例素材 |
| 电商 A+ 详情图模块 | 本地生活内容不以电商详情页成交 | 改成小红书/点评/抖音图文卡和项目介绍 |
| 官方 TikTok API 发布口径 | 国内平台官方能力和规则不同 | L3 发布包兜底，L1 verified 后启用 |
| 通用商用授权口径 | 医美/医疗素材、顾客肖像、疗效表达更敏感 | 合规 gate + 人工确认 + 审计留痕 |

## 9. 建议进入我方产品设计的具体页面

### 9.1 创作台

首屏结构：
- 左侧/中部：主生成框，默认“生成本周 3-5 条内容”。
- 支持上传案例图、好评截图、价目表、活动海报。
- 可选择平台：小红书、抖音、大众点评、公众号。
- 可选择场景：案例种草、项目介绍、优惠活动、店员口播、顾客好评、同城探店。
- 显示预估额度。
- 输出内容卡片流。

右侧：
- 副驾对话。
- 素材缺口提醒。
- 合规提醒。
- 快捷改稿按钮。

### 9.2 图文套图生成

借鉴商品套图/A+ 内容，设计美业模块：
- 封面种草图。
- 真实案例图。
- 项目卖点卡。
- 适合人群卡。
- 服务流程卡。
- 价格/优惠说明卡。
- 注意事项卡。
- 环境/老师信任卡。
- 预约引导卡。
- 合规提示卡。

### 9.3 资产库

P0 最小 tab：
- 真实素材。
- AI 生成。
- 发布包。
- 门店资料。
- 回收站。

必要筛选：
- 项目。
- 用途。
- 平台。
- 授权状态。
- 合规状态。
- 是否已用于内容。

### 9.4 发布中心

P0 不承诺全自动发布，但可以借鉴发布页的信息结构：
- 平台账号列表。
- 账号状态。
- 平台能力：可发、可读、可互动、可归因。
- 发布层级：L1 官方、L2 浏览器辅助、L3 发布包。
- 使用教程。
- 发布任务状态。
- 合规预检。

### 9.5 Agent Skills / 内部 tools

P0 内部先定义：
- `store.profile.read`
- `asset.search`
- `topic.suggest`
- `copy.compose`
- `copy.platformAdapt`
- `graphic.compose`
- `video.script`
- `compliance.check`
- `content.saveDraft`
- `publish.createPackage`
- `usage.reserve/commit/refund`

P1 再开放外部 skills：
- `beauty-analyze-post`
- `beauty-create-weekly-content`
- `beauty-generate-xhs-note`
- `beauty-create-publish-package`

## 10. 风险和注意事项

1. CreatOK 的“爆款复刻”在跨境电商素材生产中成立，但美业如果直接复刻竞品内容，会遇到平台风控、版权、肖像和医疗广告风险。
2. CreatOK 视频优先，可能给用户强烈“自动生成成片”的预期；我方 P0 应避免承诺真视频能力。
3. CreatOK 的 TikTok 官方 API 发布不能直接推导到小红书/抖音/大众点评。
4. CreatOK 的 credits 体系对高频生成合理，但本地商家可能更理解“每月内容条数/账号数/陪跑服务”，需要做本地化包装。
5. Agent Skills 是很好的增长/开发者入口，但 P0 如果过早开放，会增加支持成本；应先内部稳定。
6. Flow 画布适合高阶用户，不适合低运营水平的美业老板作为首屏。

## 11. 建议优先落地的 8 个产品决策

1. P0 创作台采用“主生成框 + 场景模板 + 内容卡片流”，不要做纯聊天首页。
2. 建立美业“场景包”体系，对应 CreatOK 的示例分类和 Agent Skills。
3. 把“项目套图/图文长图”作为图文生产核心，不要先做自由画布。
4. 资产库从 P0 开始做 metadata、授权、合规、使用记录，不只是 R2 文件列表。
5. 用任务历史承接所有生成和导出，任务必须可恢复、可重试、可 refund。
6. 发布能力按 L3 发布包兜底设计页面，同时展示平台能力矩阵。
7. 用量账本按 reserve / commit / refund 实现，失败补偿从 P0 纳入。
8. 外部 Agent Skills 暂列 P1，P0 先把相同能力做成内部 tool schema。

## 12. 结论

CreatOK 的核心参考价值是：它把 AI 多模态生成从“模型 playground”做成了“垂类内容生产系统”。它没有把用户扔进一个空 prompt，而是用行业任务、模板模块、历史任务、资产库、官方发布和积分体系把生产链路闭合。

我方应该沿着这个方向深化，但要把行业对象从 TikTok 电商 SKU 改成本地门店项目，把“爆款复刻/真视频生成”降级为“历史结构复用/视频脚本与发布包”，把发布能力改成官方优先、L3 兜底、合规内建的受控闭环。
