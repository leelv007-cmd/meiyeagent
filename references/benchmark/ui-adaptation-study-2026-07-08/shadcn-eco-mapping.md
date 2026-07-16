# shadcn 生态组件映射：六核心界面 + 全局件（2026-07-08 修订版）

- 调研：shadcn-map agent（ui.shadcn.com 官方 + GitHub/unpkg + MDN + caniuse + npm/opencli 结构化核实；本版为修订版，已并入 Base UI 底座事实与"第一眼价值"定调）

## 关键前提（影响全表）

- 底座 = **shadcn 4.0 / Base UI primitive（`render={}` 非 `asChild`）/ Tailwind 4.1**。风险轴「Base UI 兼容」：凡依赖 `@radix-ui/*` 或"假设 Radix 的老 shadcn copy-in"= 引入第二套 primitive，标红；primitive-agnostic 库（react-dropzone/qrcode/vaul/sonner/cmdk/embla/motion 动效库）= 安全。
- 「模板已有」与「生态补充/新建」分列。**Drawer 结论（对上一版的修正）**：官方 registry 新版 Drawer 虽已迁 Base UI，但模板已装 vaul——**本项目 Drawer/bottom-sheet 走 vaul**（独立库、非 Radix、无冲突），不必切换。

## 修订映射表（列：界面/部件 · 第一眼价值 · 方案 · 来源 · Base UI 风险）

| 界面/部件 | 第一眼 | 方案 | 来源 | BaseUI风险 |
|---|---|---|---|---|
| **①技能卡墙** | **高** | Card+grid+Badge；点睛见下 | 模板primitives | 无 |
| ①字段表单弹层 | 中 | 桌面 Dialog／移动 **vaul Drawer**；Form=rhf+zod4 | 模板已有 | 无 |
| ①生成中状态 | **高** | progress/skeleton→可升级 Magic UI 微光 | 模板+补充 | 无 |
| ①结果内容卡流(整段级按钮) | **高** | Card+Button+DropdownMenu；复制反馈=sonner；**卡流布局自建** | primitives有/布局新建 | 无 |
| **②内容库**网格+两态+筛排 | 中 | Card grid+Tabs+Badge+**cmdk**/Select；内容卡自建 | 模板primitives+cmdk | 无 |
| **③门店档案**多分区表单 | 低 | Form(rhf+zod4)+Card/Separator | 模板已有 | 无 |
| ③价目表(增删行) | 低 | **手写 rhf `useFieldArray`** | 模板rhf | 无 |
| ③资质上传 | 低 | react-dropzone+**janglad/shadcn-dropzone** | 补充 | **无(已核实 registryDeps 仅 react-dropzone+本地 button)** |
| **④素材库**网格+标签+授权角标 | 中 | 自建 CSS grid/columns+Badge 角标；embla 可做预览轮播 | 新建+模板embla | 无 |
| ④移动上传(相机/拖拽/批量) | 中 | 原生`<input capture>`拍照钮 + react-dropzone + janglad；**模板上传管线仅单文件无拖拽无capture→需扩** | 补充+扩建 | 无 |
| **⑤L3发布包** 二维码 | 中高 | **qrcode.react `QRCodeCanvas`**(ISC,PNG导出) | 补充 | 无 |
| ⑤分段一键复制 | 中高 | Button+Clipboard+**sonner** | 模板+新建 | 无 |
| ⑤图片存相册 | 中高 | Web Share `share({files})`优先+iOS真实`<img>`长按兜底 | 新建 | 无 |
| ⑤发布checklist | 中 | Checkbox+Card 列表 | 模板primitives | 无 |
| **⑥线索台账**可编辑表 | 低 | **模板企业级 data-table**(faceted/date/range+nuqs)直接用；行内编辑自接 Input | 模板已有 | 无 |
| ⑥快速录入 | 低 | Form + vaul Drawer(移动) | 模板已有 | 无 |
| **全局**拟人化提醒条 | 中 | 自建单行 Alert/Banner(dismissible)+拟人文案 | 新建 | 无 |
| 用量余额 quota meter | 低中 | 自建 Progress+Card+chart(recharts) | 新建+模板chart | 无 |
| 移动导航 bottom nav | 中 | **P0 新建**：固定底部 5 槽 tab bar(≥48px 触区)，`⊕` 聚焦 Agent 工作台意图框；模板 Sheet 侧栏留作溢出/次级导航 | **新建**(模板无) | 无 |
| Toast | 低 | **sonner** | 模板已有 | 无 |
| 骨架屏 | 低 | Skeleton；高价值区可升级 shimmer | 模板+补充 | 无 |

## 视觉档次点睛候选（回应"第一眼=核心价值"定调）

两个动效库均一手核实、primitive-agnostic（视觉/动效件不包 Radix）、copy-in 继承 Tailwind 4.1 token → **安全**：

- **Magic UI**：`magicui-cli` MIT、作者 dillionverma、2026-07 活跃；motion+Tailwind、copy-in。
- **Aceternity UI**：`aceternity-ui` CLI MIT、官方发布、~2119 周下载、2026-07 活跃。

**建议只在 1-2 处第一眼高价值点用**：① 技能卡墙 → Magic UI `Magic Card`/`Border Beam`（卡片聚光/描边流光）；② 生成中状态 → `AnimatedShinyText`/文字微光替代平骨架（把等待变"高级 AI"时刻）；③（可选）L3 发布包完成 → `NumberTicker`/`Confetti` 轻奖励。

**纪律**：motion 重、移动端性能+包体成本 → 懒加载、限量、只做点睛；**全站铺动效 = AI slop + 掉帧，反伤第一眼**。定位是"点睛"，绝不做 primitive 层。个别"交互型"件的 registryDeps 落地时逐个核对（机制=解析到本地 ui/，风险低）。

## Origin UI 澄清

现状 = 并入 Cal.com「coss ui」、**已转 Base UI-native**（与我们底座一致），但**主仓 AGPL-3.0（传染风险）**，仅旧 MIT 目录安全，且 file-upload/dropzone 迁移中/404。结论：**不作上传方案**；若借视觉组件只 copy 旧 MIT 目录单件、逐件确认 license。视觉点睛优先 Magic UI/Aceternity（MIT 干净）。

## 外部候选 Base UI 兼容判定（一句话）

- **安全**：react-dropzone(headless)、janglad/shadcn-dropzone、qrcode.react、Magic UI、Aceternity、vaul、sonner、cmdk、embla。
- **避免**：diragb/shadcn-dropzone（npm、React18 peer、2024 停更、老 shadcn 假设→用 janglad 版）、@autoform/shadcn（Radix 期适配+无 license 双风险）、Tremor 交互件（Radix；模板已有 chart，冗余）。

## PWA / 移动能力 / 大字号触区（沿用首版结论）

- **PWA（唯一真风险）**：TanStack Start 经 Nitro 给客户端构建也设 `build.ssr=true` → vite-plugin-pwa 与 Serwist 的 SW 生成判断全部失效，**生产构建 SW 不生成（dev 看似正常）**。Serwist 维护者已定位根因并给出不牺牲 SSR 的 custom plugin 方案（`@serwist/build` injectManifest）→ **Week-1 POC 必做**，两家均无官方 TanStack Start 背书。
- **相机 capture**：规范 SHOULD 非 MUST；Android 近乎直达；**iOS 先弹「拍照/图库/浏览」选择层** → 文案写"请选择拍照"，勿承诺一步开相机；实机确认。
- **存相册**：`share({files})` 前提 = HTTPS+用户手势+`canShare` 探测；Android 直落相册；iOS 双保险（Web Share 优先 + 真实 `<img>` 长按兜底）；iOS 当前版本状态须实机。
- **大字号/触区两层**：主干 = `html{font-size:18–20px}` + Tailwind 4 `@theme` 覆盖 `--spacing`/字号 token；补触区 = 集中改 Button/Input/Select 默认 size 变体（h-9→h-12≈48px）。控件高度是硬编码 utility 非变量——纯变量放不大控件。均为**新建**工作量。

## License/成熟度硬核实（沿用首版）

shadcn/ui+Blocks（MIT，free forever，Base UI 2026-07 成新默认）｜@tanstack/react-table 8.21.3 MIT｜sonner 2.0.7 MIT｜vaul 1.1.2 MIT（放缓，存量可用）｜react-dropzone 15.0.0 MIT｜janglad/shadcn-dropzone MIT copy-in｜qrcode.react 4.2.0 ISC｜serwist 9.5.11 MIT｜⚠️@autoform/react license=null 弃｜⚠️Origin UI AGPL｜⚠️Tremor 放缓｜shadcnblocks 付费、多租户授权未确认。

## 明确不确定/需实测

1. Magic UI/Aceternity 个别交互件 registryDeps 落地逐个核对（风险低）。
2. PWA-Serwist POC；iOS 相机/存相册实机；AutoForm 无 license。
3. bottom nav 与大触区为新建工作量，模板未提供。

## 留档（sources/，共 7 篇，均含 URL+日期头）

comp-shadcn-datatable-ui.shadcn.com.md、comp-shadcn-drawer-baseui-ui.shadcn.com.md、comp-input-capture-mdn.md、comp-web-share-mdn.md、comp-autoform-github.md、comp-magicui-github.md、comp-aceternity-ui.aceternity.com.md
