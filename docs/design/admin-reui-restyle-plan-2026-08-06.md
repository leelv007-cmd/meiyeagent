# Admin 后台 ReUI 模板套用方案（2026-08-06）

目标：把 `references/管理后台模板/surge-commerce`（电商后台，数据网格/表单/设置模式）与 `tempo-tasks`（任务后台，监控/时间线/异常清单模式）套用到 `/admin` 全部页面，同批落地 D1/D2 IA 决议（见 `docs/reviews/admin-config-audit-2026-08-06.md` §六）。

前提事实：两模板与本项目完全同栈（TanStack Start + React 19 + Tailwind v4 + `@base-ui/react` + shadcn `base-nova` style），组件可直接搬运；本项目 `src/components/ui` 即 base-nova 产物、`styles.css` 已引 `shadcn/tailwind.css`、sidebar/success token 已在。**壳层选型变更：admin 面退役 HeroUI Pro 壳（D-130 在 admin 面由本决定覆盖），商家面 heroui-pro 一字不动。**

## 一、公共语言（先于一切页面）

| 契约 | 来源 | 说明 |
|---|---|---|
| `Frame`（+Panel/Header/Title/Footer，dense/stacked/spacing） | tempo `src/components/reui/frame.tsx`（surge 同文件有 3 行被切坏的 class，以 tempo 版为准，拷前 diff 两版） | 全部 admin 页面的块级容器语言，替代 Card/裸 div |
| `PageHeader({title,count,description,actions})` | surge `src/components/shared/page-header.tsx` | 所有页面统一标题行 |
| `Badge` 25 variant 语义体系 | 项目已有 `src/components/reui/badge.tsx` | 状态一律语义 variant（success/warning/info/destructive × light/outline），禁裸色值 |
| `useRouteSheet` | surge `src/components/shared/use-route-sheet.ts` | 路由驱动 Sheet 的进出场动画 |
| `RecordCrumb`（page-crumb.tsx）+ `nav-active.ts` | surge app-shell | 面包屑记录名双向接缝 + active 算法（连测试拷） |
| `DataGrid` 全家桶 | surge `src/components/reui/data-grid/*`（7 文件） | 需补装 `@dnd-kit/*` |
| `Filters` | surge `src/components/reui/filters.tsx` | DEFAULT_I18N 是英文，使用处必须传中文 i18n |
| `Timeline` | 两模板同文件 | 运行/审计时间线 |
| `RouteProgress` | tempo `src/components/route-progress.tsx`（带测试；注意 onBeforeLoad 而非 onBeforeNavigate 的坑） | 全局导航/长操作反馈 |

不采用：两模板的 Repository/数据层（admin 已有 P1 queryP1/commandP1 接线，只换表现层）；模板字体（项目自有，模板无 CJK）；next-themes（项目自有主题机制）。

## 二、壳层（surge 骨架 + tempo 部件）

结构取 surge：**Header 全宽在上（sticky, `--header-height:50px`）+ Sidebar 在下（collapsible=icon）+ SidebarInset(min-w-0)**，`--sidebar-width:260px`、侧栏底色 `[--sidebar:var(--color-background)]` + primary 5% color-mix accent。保留现壳的 auth 判定、窄屏 DesktopRelayPage、skip-link。

- **侧栏导航**：NAV_GROUPS 按 D2 六域分组（数据源仍在 `sidebar-config.ts` 单一真相，扩展成组结构）：
  1. 首页（异常收口）＝顶部 utility 项
  2. 账号与商业化：users / plans / redemptions
  3. AI 供应与生成：supply（D1 改名「供给运行控制台」）/ models（D1 改名「模型资产与定价」）
  4. 内容与资产：templates / skills / recipe-studio（暂留，待 D3 迁移票落地后摘除——本次是换壳不是删功能）
  5. 外部集成：integrations
  6. 运行与治理：capabilities / audit / cloudflare
  分组标题与 D1 改名进 paraglide（zh/en 双语），消灭现存 6 处硬编码中文。
- **Header**：SidebarTrigger + 品牌 + 面包屑（nav-active trail + RecordCrumb 记录名，供 supply/tasks/$taskId 等深链定位）+ 右侧「运营待办」聚合 Popover（抄 surge StoreStatus 模式，计数复用页面自己的 query：pending-actions / 待复核退款 / 异常数，与页面数字永不打架）。
- **tempo 部件择用**：RouteProgress（全局）；⌘K 命令面板与通知中心列入批次 C 可选项，不阻塞主线。
- 主题切换沿用现 AdminShellUser（挪进新侧栏 Footer 用户区）。

## 三、页面映射（14 页）

| admin 页 | 模板模式 | 要点 |
|---|---|---|
| index 异常首页 | tempo ai-ops dashboard | 顶部指标卡（provider-metric-cards 形态，接现有 observability 数据；「未接线」项保持诚实 unknown）+ 异常清单抄 order-table 的 URL 驱动筛选（`?exceptions=` 可分享）+ Empty/IconStack 空态 |
| supply 供给运行控制台 | tempo routing-rule-grid + failover-timeline | 运行表换 DataGrid+Filters（**保留服务端分页语义**，manualPagination，现有 runQuery 接线不动；顺手补 q/模型/任务筛选的 UI 缺口）；14 个受治理动作区用 Frame 分区；Reference→Sheet 下钻三段式 |
| supply/tasks/$taskId | tempo 右栏/Sheet 下钻 + Timeline | 任务执行时间线用 Timeline（active=Spinner）；RecordCrumb 报任务号 |
| audit | tempo activity-timeline | 五张审计表换活动流形态（时间桶分组+可折叠+复制引用号）；退款复核区保持现有写逻辑 |
| users | surge orders 列表页全套 | `_list` pathless layout + 详情 Sheet 路由叠加；批量条/行操作菜单 disabled 接权限谓词 |
| plans | surge settings（SettingField 行 + FrameFooter 统一保存） | 运行时配置表 14 键行式化；D8 合规三键文案按「按设计」口径；退役键（plan.addons 等）只读呈现（修反向错标） |
| redemptions | surge data-grid + form sheet | 生成表单 Sheet 化（受控/非受控双模签名） |
| models | surge products 编辑器 + data-grid | 目录网格 + 整页编辑器（PageHeader+主副两栏）；装配层 7 参数用 SettingField 行 |
| templates | surge settings 子分区 + form sheet | 四合一控制台先 Frame 分区规整（拆页属 P2 IA 票不在本波） |
| skills | surge data-grid + sheet | 绑定/治理表格化；治理运行用 Timeline |
| integrations | surge payments 设置（Item/IconTile 行 + 即时 mutate） | 凭据槽位卡片化 |
| capabilities | surge panel 式（locations/suppliers 模式） | 目录树/详情卡换 Frame 语言 |
| cloudflare | Frame + 只读徽章 | 纯视觉规整 |
| recipe-studio | 不动 | 待 D3 下线票处理 |

## 落地状态（2026-08-06 当日完成，未提交）

> ⚠️ 2026-08-07 复核更正：本段「全部落地并通过终验」与代码实态不符——§一 公共语言 9 项资产仅落地 3 项（DataGrid/Filters/RouteProgress/IconStack 未拷入、useRouteSheet 零消费）、Sheet 下钻承诺全线未做。差距全录见 `docs/reviews/admin-reui-restyle-review-2026-08-07.md`，拍板处置见本文 §五。

壳层 + 批次 A/B/C 全部落地并通过终验：`pnpm typecheck` 0 错、`pnpm test` 1842/1854（0 败，12 条预存在 skip）、`pnpm test:interaction` 491/491、14 页浏览器逐页走查通过。**D-130（admin 面 HeroUI Pro 壳）自本日起由本方案取代；heroui-pro 目录与商家面壳完全未动。** 终验期间修复：sidebar-config 注释含中文触发 product-surface 契约测试、navigation.test 与 merchant-language-audit 的 D1 改名/blocks 删除同步、skills 目录表说明列溢出截断、孤儿键 admin_shell_navigation_group 删除。

已知遗留（后续开票）：① admin 面还剩两处 heroui 依赖——admin-operations-panels 的图表件（reui 无图表件）与 admin-config-form 的整套单元格编辑器（换装成本畸高）；② /admin/skills 路由标题/描述硬编码中文（无 admin_skills_title 键）；③ supply.views.$viewId 面板标题与页头同文；④ 原生 `<select>` 残留多处（绑 react-hook-form，属交互层改造）；⑤ 敏感词删除仍走 window.confirm 未走 ImpactReviewDialog（逻辑门，审计报告已记）；⑥ heroui-spike 路由仍消费 heroui ListView（spike 性质，未动）；⑦ recipe-studio 未换装仅机械替换容器（待 D3 下线票）。

## 四、批次与验证

- 壳层（本方案 §二）→ 批次 A（index/supply/tasks/audit，tempo 模式）∥ 批次 B（users/plans/redemptions/models/templates，surge 模式）→ 批次 C（skills/integrations/capabilities/cloudflare + ⌘K/通知可选件 + blog-3 测试块删除 + i18n 清理）。
- 全程只换表现层：**任何 use-admin-* / p1 hooks / commandP1/queryP1 调用签名不动**；动作的确认流（ImpactReviewDialog、reason≥8 字）原样保留。
- 验证：dev:3000 浏览器逐页走查；批次完成后停 dev 跑 typecheck/test:interaction（locale:compile 冲突纪律）；admin 相关 route 测试（-supply.route.test 等）必须绿。
- 风险纪律：不覆盖任何既有 `src/components/ui/*`（历史事故 703f79df）；模板文件拷入一律走 `src/components/reui/`、`src/components/shared/` 新增路径。

## 五、改约与更正（2026-08-07 拍板）

依据 `docs/reviews/admin-reui-restyle-review-2026-08-07.md`（三路反驳立场复核 + 浏览器走查 + 引证抽查），用户拍板如下：

**改约（正式不采用，§一/§三 相关字样按本节口径读）：**
- **DataGrid 全家桶、Filters 不补装**。理由：现实现已保住 URL 驱动筛选与服务端分页两条硬语义（supply 运行表的 StateLink 无 JS 可用，强于模板原版），补装收益主要是列头排序/列显隐等交互能力，成本横跨 users/redemptions/models/skills/supply 五页。表格语汇统一口径：优先仓内 `data-table/*`（users 现行），轻表用裸 `<Table>`；§一 表中「DataGrid 全家桶」行与 §三 各行「data-grid」字样均改读「data-table 语汇」。`@dnd-kit/*` 不装。
- **RouteProgress、IconStack 不采用**。§一「RouteProgress（全局）」与 §三 index 行「Empty/IconStack 空态」撤销；现行加载/空态语言（Frame + Alert + 诚实 unknown）为准。
- **Sheet 下钻收窄**：仅 users 详情按 #423 补路由驱动 Sheet（`useRouteSheet` 唯一指定消费点）；supply Reference 三段式、tasks 右栏、skills sheet 的承诺撤销，整页跳转形态为准。
- **假槽位名纠正**：`data-slot="data-grid"`/`"number-stepper"` 贴牌与配套或运算断言由 #427 改为如实命名+真判据。

**遗留清单更正：**
- ②「/admin/skills 硬编码中文」严重低报——实态为组件层数百行（中英皆有），扩容为 #428 收口。
- ④「原生 `<select>` 残留多处」已由 #387 清零，条目过期作废。
- ⑤ 敏感词 `window.confirm`：#388 拆页后已成新页主删除路径，升级为 #425。
- 新增：#387 同文修复只修 views 一处，同类还剩 audit / tasks / sensitive-words 三处（#426）+ refund 面板英译一处（#424）；`supply.views.$viewId` 缺 `useRecordCrumb` 致深链面包屑错标（#426）。

**§二 六域成员现状更正**（代码为准，`-ia-split.route.test.tsx` 已锁）：账号与商业化 + refund-review（#388 拆入）；运行与治理 + sensitive-words（#388 拆入）；内容与资产 − recipe-studio（#375 路由已删）。

**整改票**：#422 plans 退役键只读（Core readOnly 投影+壳层）｜#423 users 路由驱动详情 Sheet+权限谓词行操作｜#424 refund-review 面板 i18n｜#425 敏感词删除走 ImpactReviewDialog｜#426 同文三处+views RecordCrumb｜#427 四道护栏门（资产清单/断言真判据/heroui 扫描三洞/CJK 门默认纳新）｜#428 硬编码文案入 paraglide。
