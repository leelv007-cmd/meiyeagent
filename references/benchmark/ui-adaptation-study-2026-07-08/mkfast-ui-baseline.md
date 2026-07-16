# mkfast-template UI 基线盘点

- 日期：2026-07-08（mkfast-audit agent 只读盘点）
- 盘点路径：`美业内容2/mkfast-template-main/`
- 用途：为"沿用模板已有 UI primitives"（v1.5 05 §3）提供事实基线；UI 适配研究四路调研之本地一路

**一句话结论**：生产级、高完成度 SaaS 模板（TanStack Start + React 19 + Cloudflare Workers）。UI primitives 54 个、布局/表单/表格/主题/文件上传/AI 调用全部现成，强支持"沿用不自建"。**两个关键非显性事实**：① primitive 底座是 **Base UI（`@base-ui/react`）不是经典 Radix**（shadcn 4.0 新发行版），组合 API 用 `render={}`/`nativeButton` 而非 Radix `asChild`；② **有 AI 调用管线但零 streaming/chat**，`@tanstack/ai-react` 是装了没用的死依赖。

## 1. 依赖盘点

- **Primitive 底座**：`@base-ui/react` ^1.5.0（主力）+ `@radix-ui/react-slot` ^1.2.4（仅 slot）+ `shadcn` ^4.0.0（`@import "shadcn/tailwind.css"`）
- **Tailwind**：^4.1.18 + `@tailwindcss/vite` + `/typography` + `tw-animate-css`
- **表单栈**：`react-hook-form` ^7.71.1 + `@hookform/resolvers` ^5.2.2 + `zod` ^4.3.6
- **表格**：`@tanstack/react-table` ^8.21.2
- **Drawer/Sheet/Dialog**：`vaul` ^1.1.2（drawer）+ base-ui（sheet/dialog）+ `cmdk` ^1.1.1（命令面板）
- **Toast**：`sonner` ^2.0.7 ｜ **Icons**：`@tabler/icons-react` ^3.36.1（唯一）｜ **图表**：`recharts` 3.8.0 ｜ **动画/轮播**：`tw-animate-css` + `embla-carousel-react`
- **AI**：`@tanstack/ai` 0.14.0 + `@tanstack/ai-fal` ^0.7.0 + `@tanstack/ai-react` 0.8.0（**代码零引用，死依赖**）
- **TanStack 系**：start/router ^1.132、query ^5.66、table ^8.21、ssr-query
- **其他**：`nuqs`（URL 状态）、`date-fns`、`react-day-picker`、`react-resizable-panels`、cva+clsx+tailwind-merge、markdown 栈（unified/remark/rehype）

## 2. UI primitives（`components/ui/`，54 个）

accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, button-group, calendar, card, carousel, chart, checkbox, collapsible, combobox, command, context-menu, dialog, direction, drawer, dropdown-menu, empty, field, form, hover-card, input, input-group, item, kbd, label, menubar, native-select, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, spinner, switch, table, tabs, textarea, toggle, toggle-group, tooltip。

近乎 shadcn 全集，额外含 `empty`（空状态）、`chart`、完整 `sidebar`。

## 3. 布局系统

**两套 shell**：① App shell = `layout/sidebar-layout.tsx`（SidebarProvider + DashboardSidebar variant="inset" + SidebarInset，**内建 auth guard 自动跳登录**），dashboard/settings/admin 共用；② Marketing shell = `navbar.tsx`+`navbar-mobile.tsx`。

导航配置驱动（`config/sidebar-config.ts`，支持 `authorizeOnly` 角色过滤）。

**移动端 = 侧栏抽屉（Sheet 左滑），不是 bottom nav**；marketing 页是汉堡→全屏 overlay。断点 `MOBILE_BREAKPOINT=768`。大量用 **container queries**（`@container/main`、`@[250px]/card`）。**若产品要底部 tab 栏需新建。**

## 4. 页面骨架（可复用度）

- **Auth**（login/register/forgot/reset/error）高
- **Dashboard**（section-cards+chart+data-table 三段式）高
- **Settings**（profile/billing/security/files/apikeys/notifications/payment 共 7 页）极高
- **Admin**（index+users）高
- **Marketing**（about/ai/changelog/contact/pricing/roadmap/waitlist）中
- **Legals/Blog** 中高；**API/webhooks/sitemap** 高

## 5. 表单/上传/表格实例

- **表单范式** → `settings/profile/update-name-card.tsx`（useForm+zodResolver+Form primitives+sonner），全库统一，门店档案表单照抄即可
- **文件上传** → `settings/files/files-table.tsx`（Dialog+原生 `<input type=file>` **单文件、无拖拽**+Switch 控 public）+ `hooks/use-user-files`（TanStack Query mutation）→R2；另 `ai/ai-caption-card.tsx` 有 base64 图片上传+预览+1MB 上限雏形
- **表格三档**：① 企业级 `components/data-table/`（13 文件：advanced-toolbar、faceted/date/range/slider 过滤、sort-list、action-bar、URL 状态走 nuqs）→ 线索台账首选；② 轻量 `files-table`/`admin/users-table`（直接 useReactTable）；③ dashboard 拖拽 demo

## 6. chat/AI/streaming

**无 chat UI、无 streaming/SSE**（grep streamText/useChat/EventSource/toDataStreamResponse 在 app 代码零命中）。有请求-响应式 AI：`components/ai/` 8 张 demo 卡（summarization/tagline/translation/caption 图生文/tts/image-fal/cf-image/image-edit），全部 `await 服务端函数→setState` **非流式**；`api/ai.ts` 用 createServerFn 调 Cloudflare Workers AI REST + fal.ai，模型在 `config/ai-models.ts`。

**含义：AI 服务端函数+卡片交互模式可抄，流式输出/对话 UI 需从零搭**（"边生成边显示文案"是主要缺口）。

## 7. 主题系统 & 字号/触区成本

- **Dark mode**：class-based（`.dark`），**自研 `theme-provider.tsx`（非 next-themes）**，light/dark/system，localStorage `theme`，ScriptOnce 内联脚本防 FOUC
- **Tokens**：`styles.css` 用 **OKLCH** 变量，完整 shadcn token 集 + `@theme inline` 映射，**主色橙色**，radius 0.625rem 阶梯
- **字体**：单一品牌字体 Bricolage Grotesque，自托管 woff2，font-display:optional（**中文字体需另配**）
- **字号/触区改动成本**：**无全局字号 token**，body 只设 font-family（继承 16px），字号全是逐组件 Tailwind 类。→ **调大字号最省力 = `custom.css` 加 `html{font-size:18px}`（1 文件，rem 等比放大全站，便宜但钝）**；**触区无统一控件高度 token**，要放大 = 逐个改 primitive 的 cva size 变体（中等，约 5-8 文件，ui/ 已排除 lint 改无副作用）。均无架构阻碍。

## 判断表（6 核心界面 + 全局件）

| 界面 | 档位 | 依据 |
|---|---|---|
| 创作台 技能卡+表单 | 🟡 部分 | ai/*-card 就是技能卡雏形 + Card + Form/RHF；栅格布局+流式输出需新建 |
| 内容库 卡片流 | 🟡 部分 | Card + blog-grid/blog-card 现成；无瀑布流/masonry、无内容专用卡 |
| 门店档案 表单 | 🟢 已覆盖 | update-name-card 即范式，input/select/switch/calendar 齐全 |
| 素材库 上传网格 | 🟡 部分 | 上传管线(files+use-user-files→R2)+base64 预览现成；**无拖拽、无网格**需自建 |
| L3 发布包 | 🔴 缺口 | 无"发布/多平台"概念；仅 Card+Tabs+Dialog+image-edit 作零件，基本全新 |
| 线索台账 表格 | 🟢 已覆盖 | data-table/ 企业级(过滤/排序/分页/URL 状态)+users-table 实例，近开箱 |
| 提醒条(合规/拟人化) | 🟡 部分 | 有 ui/alert，无常驻 sticky banner，需组合 |
| 用量显示 | 🟡 部分 | section-cards 统计卡+ui/progress，无专用 quota meter，需组合 |
| 移动导航 | 🟢 已覆盖 | Sheet 侧栏+navbar-mobile 汉堡；**注意无 bottom nav**（若要则 🔴） |
| toast | 🟢 已覆盖 | sonner + shared/toaster.tsx |
| 骨架屏 | 🟢 已覆盖 | ui/skeleton + data-table-skeleton + files-table 内置行骨架 + spinner |

**净判断**：🟢5 / 🟡5 / 🔴1（L3 发布包）。增量工作集中在：内容/素材的卡片流与拖拽网格、流式 AI 输出 UI、L3 多平台发布包、提醒条/用量表等组合件——全是"用现成 primitives 拼装"，无需替换底座。

**决策提示**：新写组件须遵循模板既有 Base UI 组合 API（`render={<Link/>}`/`nativeButton={false}`，见 sidebar-main.tsx / dashboard-header.tsx），别按老 Radix `asChild` 写，否则与现有 primitives 不一致。
