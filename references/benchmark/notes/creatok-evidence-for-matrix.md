# CreatOK 对标矩阵证据映射

日期：2026-07-07

主要来源：
- `references/creatok/reports/creatok-function-breakdown.md`
- `references/creatok/notes/evidence-index.md`
- `references/creatok/notes/public-site-and-pricing.md`
- `references/creatok/notes/dashboard-information-architecture.md`
- `references/creatok/notes/technical-surface.md`
- `references/repos/creatok-skills/`

## 1. 可确认的强项

### 1.1 垂类工作流

CreatOK 明确面向 TikTok Shop / 跨境电商卖家，把“发现、复刻、生成、发布”包装成电商内容生产链路。dashboard 入口不是泛聊天，而是视频生成、爆款复刻、商品套图、A+ 内容、视频分析、TikTok 发布等结构化任务。

证据：
- 官网定位和 pricing：`references/creatok/notes/public-site-and-pricing.md`
- dashboard IA：`references/creatok/notes/dashboard-information-architecture.md`
- 功能拆解报告第 2-4 章：`references/creatok/reports/creatok-function-breakdown.md`

置信度：confirmed

### 1.2 多模态生成和任务历史

CreatOK 覆盖视频、图片、音频、画布和工具类能力。前端可见 AI task endpoint、任务状态、历史 tab、示例 tab、模型选择、积分估算和成功率请求。

证据：
- `references/creatok/notes/technical-surface.md`
- `references/creatok/raw/app-ai-video-generator.opencli.md`
- `references/creatok/raw/app-image-generator.opencli.md`
- `references/creatok/network/*`

置信度：confirmed

### 1.3 素材资产和对象存储链路

资产库包含 AI 生成、上传资产、数字人、商品库、回收站；支持存储额度、批量操作、筛选和排序。技术侧可见 presigned upload、asset records、storage quota 等链路。

证据：
- `references/creatok/screenshots/app-assets.png`
- `references/creatok/raw/app-assets.opencli.md`
- `references/creatok/notes/technical-surface.md`

置信度：confirmed

### 1.4 官方发布和账号能力包装

TikTok 发布页有账号列表、新增账号、支持国家、教程、FAQ、官方授权 API 口径和发布奖励。这一点与我方“官方能力优先、受控发布、不承诺隐形全自动”的原则一致。

证据：
- `references/creatok/raw/app-platform-tiktok.opencli.md`
- `references/creatok/screenshots/app-platform-tiktok.png`
- `references/creatok/reports/creatok-function-breakdown.md`

置信度：confirmed

### 1.5 积分、套餐、团队和失败补偿

CreatOK pricing 将 credits、模型消耗、任务失败补偿、保留期、队列优先级、团队席位、共享积分/资产串起来。前端技术线索也显示 plan code、credit ledger、quota error codes。

证据：
- `references/creatok/notes/public-site-and-pricing.md`
- `references/creatok/notes/technical-surface.md`
- `references/creatok/reports/creatok-function-breakdown.md`

置信度：confirmed

### 1.6 Agent Skills 外部化

CreatOK 将视频分析、视频复刻、视频生成、图片生成包装成 public skills，供 Codex / Claude Code / OpenClaw 等 agent 调用。skill 是 thin client，远程 API 管模型、任务和积分。

证据：
- `references/creatok/raw/agent-skills.opencli.md`
- `references/repos/creatok-skills/README.md`
- `references/repos/creatok-skills/skills/*/SKILL.md`

置信度：confirmed

## 2. 对我方 P0 的缺口

### 2.1 门店知识和本地服务对象不足

CreatOK 有商品信息、商品链接、目标市场、目标平台、文案语言、商品库等电商对象，但没有看到对应美业门店的项目价目、老师人设、资质、预约规则、禁用表达、平台账号人设等对象。

判断：对“懂这家店”帮助有限，只能借鉴结构化 onboarding 和资料上传形式。

置信度：confirmed + inferred

### 2.2 真实素材权利和敏感素材状态不足

CreatOK 有资产库和素材上传，但美业需要顾客授权、真实案例/AI 辅助、before/after 敏感、是否已用于内容、Regulated Content Mode 状态等字段。CreatOK 公开界面没有看到这类美业合规 metadata。

判断：资产机制可借鉴，素材权利模型必须自研。

置信度：confirmed + inferred

### 2.3 线索台账缺失

CreatOK 的核心价值链是电商视频和 TikTok Shop 发布，没有看到咨询、加微、预约、团购券核销、人工标注、内容到线索周报等本地商家闭环。

判断：我方 P0 不能只学 CreatOK 的内容生产，还必须补上线索台账，否则难以证明商家价值。

置信度：confirmed

### 2.4 国内平台发布边界不同

CreatOK 的发布参考价值来自“官方 TikTok API”。我方平台包括小红书、抖音、大众点评、公众号等，官方能力和规则差异很大。P0 必须以 L3 发布包兜底，L1 只在 account-level verified 后启用，L2 只做 no-submit 灰度。

判断：借鉴账号能力矩阵和官方发布页，不复制 TikTok 发布路径。

置信度：confirmed + inferred

### 2.5 美业/医美合规缺口

CreatOK 有版权/IP/肖像/平台政策和 regulated content 相关 pricing FAQ 口径，但没有看到广告法、AIGC 标识、医美/医疗 Regulated Content Mode、资质、价格优惠、疗效承诺、顾客案例授权的发布前核验机制。

判断：对普通内容安全有启发，但不能覆盖我方 P0 红线。

置信度：confirmed + inferred

## 3. CreatOK 样例评分

| 维度 | 权重 | 评分 | 加权分 | 判断 |
| --- | ---: | ---: | ---: | --- |
| 垂类 ICP 与 JTBD 匹配 | 8 | 4.0 | 6.4 | 是垂类商家内容工作台，但行业是 TikTok Shop/跨境电商，不是本地美业 |
| 门店/业务知识与 onboarding | 10 | 2.0 | 4.0 | 有商品信息和上传资料，但缺门店档案、项目价目、老师/账号人设 |
| 真实素材库与素材权利 | 10 | 3.5 | 7.0 | 资产库强，素材上传和商品库成熟；缺美业授权/敏感素材状态 |
| 内容生成覆盖与质量 | 12 | 4.5 | 10.8 | 视频、图片、商品套图、A+、分析、复刻等成熟；不直接覆盖本地文案/线索 |
| 平台原生变体与内容库 | 10 | 3.0 | 6.0 | 有历史、示例、资产和发布入口；内容母体/平台变体模型不明确 |
| 发布/账号能力与人在环 | 10 | 3.5 | 7.0 | TikTok 官方 API 强；国内多平台和 L3 发布包不可直接复用 |
| 线索台账与反馈闭环 | 10 | 1.0 | 2.0 | 没看到本地咨询/预约/核销闭环 |
| 合规、安全与审计 | 12 | 2.5 | 6.0 | 有 credits、权限、官方 API、版权提示；缺美业/医美发布前核验 |
| 用量账本与商业化 | 8 | 4.0 | 6.4 | credits、套餐、团队、队列、失败补偿成熟 |
| 技术架构与可扩展性 | 10 | 4.0 | 8.0 | Next.js、异步任务、presigned upload、资产、skills API 线索清晰；后端未确认 |
| **合计** | **100** |  | **63.6** | 高产品化参考，低直接 P0 迁移度 |

## 4. 对我方产品化的借鉴优先级

> 2026-07-08 覆盖批注：本节按最新 D3/D5 口径阅读。P0 必借鉴重点已从“创作台 + 右侧副驾”迁到 Agent 工作台、创作流、异步任务和视频成片；图文渲染仍缓做。

| 优先级 | 可借鉴机制 | 我方落地方式 |
| --- | --- | --- |
| P0 必借鉴 | 首页即主工作流 | Agent 工作台首屏用今日建议 chips / 三喂料意图框发起创作流 |
| P0 必借鉴 | 结构化工具卡 | 文案、图文建议、视频成片、发布包、线索人工洞察、拍摄清单 |
| P0 必借鉴 | 资产库承接生成结果 | 真实素材、AI 生成、发布包、门店资料、回收站 |
| P0 必借鉴 | task id + history | 生成任务可恢复、可重试、可审计、可计费 |
| P0 必借鉴 | credits + refund | Usage Ledger reserve / commit / refund |
| P0 必借鉴 | 官方发布页机制 | 账号能力矩阵、授权状态、支持平台、教程、发布层级 |
| P1/P2 借鉴 | Flow / 社区模板 | 美业场景包模板中心 |
| P1/P2 借鉴 | Agent Skills | 对外开放美业内容能力包 |
| 不照搬 | TikTok 爆款复刻中心化 | 改为本店历史内容复用和平台变体生成 |
| 不照搬 | 电商视频首屏和专业编辑承重 | P0 做美业视频成片薄链路，不照搬电商爆款复刻和逐镜专业剪辑 |
| 不照搬 | 商品 SKU / A+ 电商详情图 | 改为项目套图、案例卡、流程卡、注意事项卡、预约引导卡 |
