# Tailwind Plus UI Blocks 选用清单（对照路径 B 第一轮产物）

> 日期: 2026-07-13 ｜ 来源: https://tailwindui.starxg.com/plus（Tailwind Plus 镜像站）
> 方法: opencli 无此站适配器 → 直抓 30 个分类页静态 HTML 解析（iframe 数=示例数）
> 前提: 25 票第一轮开发已完成（commit `daa9081`），本清单服务**第二轮视觉打磨与对标截图验收**，不开新功能（B 冻结期纪律不变）
>
> **许可注意**: 镜像站仅用于选型浏览。Tailwind Plus 是付费产品——若逐字搬代码须购买官方 license（个人版 ~$299 一次性）；不购买则只取**设计模式**用自有 Base UI shadcn 原语重写。其 React 版交互件基于 Headless UI，搬运时须换成本仓已有的 Base UI 等价件（Dialog/Combobox/RadioGroup 等）；HTML 版是纯 TW 标记，适配成本最低。

## A. 生成与任务反馈（打磨票 09/10/16）

| # | 分类 | 具体示例 | 用在哪 |
|---|---|---|---|
| 1 | Progress Bars | **Panels with border** / **Bullets and text** / **Circles with text** | 票 16 视频五步链步骤指示、票 09 阶段叙事——全是"步骤态"形态，天然符合禁假百分比 |
| 2 | Notifications | **With actions below**（双动作）/ **Condensed** | 票 10 任务完成通知：查看结果+关闭双按钮=一键回源 |
| 3 | Feeds | **Simple with icons** / **With multiple item types** | Work 详情页事件时间线（阶段叙事的历史沉淀，D3 对话式外壳） |
| 4 | Badges | **Flat with dot** 系列 | Job/Work 状态徽章统一视觉（running 绿点/failed 红点） |

## B. 参数形态与 CheckBox（打磨票 12/13/14/15/18）

| # | 分类 | 具体示例 | 用在哪 |
|---|---|---|---|
| 5 | Checkboxes | **List with description** / **List with checkbox on right** | 票 14 成套模块多选构建器——带描述的勾选列表正是"成套模块"形态 |
| 6 | Radio Groups | **Stacked cards** / **Small cards** | 票 18 D4 三选一：卡片即单选项，radio 语义天然锁死单选 |
| 7 | Comboboxes | **With image** / **With status indicator** | 票 15 模型/模板选择器带缩略图与可用态 |
| 8 | Category Previews (ecom) | **With image backgrounds** | 票 12 L0 场景货架卡——场景=分类，图底卡就是"第一眼质感" |
| 9 | Product Lists (ecom) | **With color swatches and horizontal scrolling** / **With tall images** | 票 12 移动端横滑货架；3:4 竖图卡贴美业实拍与小红书封面比例 |
| 10 | Drawers | **Create project form example** | 票 12 渐进展开：高级参数收进侧拉抽屉而非平铺 |

## C. 资产与结果呈现（打磨票 17）

| # | 分类 | 具体示例 | 用在哪 |
|---|---|---|---|
| 11 | Grid Lists | **Images with details** | 资产库/结果画廊卡 |
| 12 | Product Quickviews (ecom) | 任一 | 资产快速预览（lightbox 的加强形态：预览+元数据+动作） |
| 13 | Stacked Lists | **Narrow with badges** / **With badges, button, and actions menu** | /dashboard/jobs 任务列表、生成历史列表 |
| 14 | Description Lists | **Left-aligned in card** | Work/Job/Asset 结构化详情（D3"内层可检查的结构化内核"） |
| 15 | Drawers | **File details example** | 资产详情侧拉（不离开画廊上下文） |

## D. 开场、导航与输入（打磨票 19/20/21/22）

| # | 分类 | 具体示例 | 用在哪 |
|---|---|---|---|
| 16 | Empty States | **With starting points** / **With templates** / **With recommendations grid** | 票 21 示例美甲店空态 + 票 19 开场"从这里开始"；recommendations grid 即今日建议 chips 的卡片化 |
| 17 | Command Palettes | **With groups** / **With icons** | 票 20 ⌘K——With groups 正是"导航/添加到创作"双组的现成形态 |
| 18 | Input Groups | **Input with keyboard shortcut** / **Input with leading icon and trailing button** | ⌘K 提示徽标；票 22 统一输入台细节 |
| 19 | Action Panels | **With toggle** / **With button on right** | 设置页/BYOK 面板行 |

## E. 数据面板（打磨 weekly-operations 既有页）

| # | 分类 | 具体示例 | 用在哪 |
|---|---|---|---|
| 20 | Stats | **Simple in cards** / **With trending** | 周运营数据卡（发布数/生成数/趋势箭头） |

## F. B 之后再用（官网/定价，现在冻结不做）

- Pricing **Three tiers with toggle**（Growth 399-599 定价页）
- Heroes **With phone mockup** / **Split with screenshot**（官网首屏）
- Bento Grids / Testimonials / FAQ **Centered accordion** / Stats sections（官网次级区块）
- Calendars **Small with meetings**（内容排期在"缓"名单，随排期功能一起启用）

## 不采与理由

| 分类 | 理由 |
|---|---|
| Reviews / Incentives / Order 系列 / Shopping carts / Checkout | 电商交易语义，本产品无购物车/订单流 |
| Progress bar（百分比条那一款） | 违反 ADR-0010 禁假百分比——只用步骤态示例 |
| Sign-in forms | Better Auth 链路已定，不动 |
| Tables | 无重表格场景，列表用 Stacked Lists/卡片 |
| Application Shells | 壳层已定型（sidebar-layout），换壳=范围爆炸 |

## 落地方式（第二轮打磨的执行纪律）

1. 每项先对照第一轮已实现组件（`mkfast-template-main/src/product/`、`src/p1/`、`src/components/uiux/`），**只替换视觉标记，不动数据流与状态机**；
2. 交互原语一律沿用仓内 Base UI shadcn 件，Tailwind Plus 只贡献布局/间距/层次的 TW 类组合；
3. 每处替换仍以对应票的 DoD 截图对照收口（矩阵 I 区条目不变）。
