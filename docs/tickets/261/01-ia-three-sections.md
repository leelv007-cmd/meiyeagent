# #261 前端设计稿 ①：Dashboard 单路由三段 + 第二层 Skill pill

> 范围：D-164① ＋ D-164②。决策原文 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md:3073-3086`（①②）、`:3138-3145`（影响）、`:3153-3154`（证据边界）。
> 基点：`lane-261` worktree，main@cc04918d。本稿为**零 rebase 面预备**（`docs/ops/agent-dispatch-runbook-2026-07-29.md:8`），不改任何现有文件。
> 不在本稿范围：D-164③（执行确认卡）、④（记忆升一级导航）、⑤（动作 chip）、⑥（成本即时反馈）。**④ 明确不做**——`src/lib/uiux/navigation.ts:10` 的四项与 `src/components/product/mobile-nav.tsx:55` 的 `grid-cols-4` 本票一律不动。

## 0. 盘点复核结论（与派发说明的三处出入）

| 派发说明 | 复核结果 | 依据 |
|---|---|---|
| `today-recommendation-card.tsx:66` 四态机 | `:66-70` 是 `TodayRecommendationView` 类型；四态判定函数 `todayRecommendationView` 在 `:77`；组件 `TodayRecommendationCard` 在 `:189` | 已读全文 |
| `launch-seeds.ts` 有 **9 条** recipe | 实为 **8 条**（5 单 lens ＋ 3 个 reuse 变体），文件头注释也写 "eight Recipe variants" | `apps/core/src/p1/creation-experience/launch-seeds.ts:101-390`、`:4` |
| `foundation-module.ts:52` skills 模块 | 类在 `:51`，`readonly name = 'skills'` 在 `:52`；**结论成立**：`execute()` 只有 5 条命令（`skill_define/accept/bind/rollback/deployment`，`:64/102/108/127/134`），全仓 `apps/core/src/p1/skills/` 无任何 `P1QueryModule` 实现 | 已 grep 确认 |

另有两条本稿新查出、影响验收的事实：

- `?view=recent|works` **无任何应用内链接产出**，唯一引用是 e2e `tests/e2e/specs/uiux-shell-routes.spec.ts:121-122`。
- 该 e2e 的 `['/dashboard?view=works', '作品历史']` 断言**当前不可能通过**：`CanonicalHistoryPage` 对 `mode='works'` 渲染的 h1 取 `product_navigation_content` ＝「内容」（`src/product/canonical-history-page.tsx:167-171`、`:525`），而「作品历史」这个词在 `project.inlang/messages/zh.json` 与 `src/` 中**不存在**。即该行是既有假绿/未跑项，不构成 `?view=` 的保留理由。

## 1. 现状 → 目标 diff

| 段 | 现有零件 | 缺什么 | 要改哪个文件的哪一段 |
|---|---|---|---|
| **段① 提议位** | `src/product/dashboard-home-surface.tsx:110` `DashboardHomeSurface`（内含 `today-recommendation-card.tsx:189` 四态 cold/pending/stale/current ＋ `example-store-showcase.tsx:19`） | 零件齐、**位置错**：现挂在 `composer-home.tsx:2773`，即整个 Composer 集群**之后**（`:2764-2771` 注释明写这是刻意的）。移动端无紧凑态 | `src/product/composer/composer-home.tsx` `ComposerHome` return（`:2310`）——把 `:2773-2791` 整块上移到 `:2330` 之后；`dashboard-home-surface.tsx:110` 加 `compact?: boolean` 形参 |
| **段② 创作面** | 输出类型轴 `composer/lens-radiogroup.tsx:34`（挂在 `composer-home.tsx:2506`，经 `ComposerPromptBar` 的 `lensSlot` 渲染于 `composer-conversation.tsx:514`）；大输入框 `composer-conversation.tsx:552`；执行模式开关 `composer-conversation.tsx:487`；配方卡 `composer/recipe-cards-panel.tsx:71` ＋ `recipe-card-grid.tsx:34`（挂在 `composer-home.tsx:2696`） | **配方卡不是 pill、无宣发任务分组**，且物理上在 PromptBar **之外**、与 lens 轴隔着报价行/额度卡（`composer-home.tsx:2592-2693`），读不出「lens → 第二层快捷入口」的层级 | 新建 `composer/recipe-pill-row.tsx` ＋ `composer/recipe-marketing-groups.ts`；`composer-conversation.tsx` 的 `ComposerPromptBarProps`（`:391`）/`ComposerPromptBar`（`:442`）/`{lensSlot}` 渲染点（`:514`）加 `recipePillSlot`；`composer-home.tsx:2696-2731` 的 `RecipeCardsPanel` 换成 pill 行并移进 PromptBar |
| **段③ 继续上次工作** | **前台无此段**。数据侧零件在：未完成任务 `src/product/harness-client.ts:76` `readActiveHarnessTasks`（`composer-home.tsx:1176-1183` 已在用，queryKey `['harness','active-tasks']`）；最近会话 `operations.canonical_history` 投影（`canonical-history-page.tsx:448-452`，`canonical-history-model.ts:110-115` 的 `sessions[]`，投影函数 `:336/:344-355`） | 整段缺；「项目列表下沉的那一条」无载体 | 新建 `src/product/dashboard-continue-work.tsx`；在 `composer-home.tsx` return 末尾挂载 |
| **路由分叉** | `src/routes/dashboard/index.tsx:35` 单路由已四态：`:102-104` workId→null、`:106-108` 桌面 `?view=` → `CanonicalHistoryPage`、`:110-112` relay→null、`:114-121` `ComposerHome` | `?view=` 分叉是**第二个工作台**，与「登录后只有一个 Dashboard 路由」直接冲突 | `index.tsx` 的 `DashboardSearch`（`:20`，删 `view` 字段 `:30`）、`validateSearch`（`:62-64`）、`DashboardHome`（`:106-108`），并把 `CanonicalHistoryPage` import（`:2`）一并删（改动造成的孤儿） |

## 2. 单路由三段的渲染方案

### 2.1 分叉收敛

`routes/dashboard/index.tsx` 现有五个出口（`:102/:106/:110/:114` ＋ `:78`/`:93` 两个副作用 effect）。收敛后只剩**一个**渲染出口，两个 `beforeLoad` 级重定向：

| 现状 | 处置 | 改在哪 |
|---|---|---|
| `:78-86` `?workId=` → `/dashboard/results/$workId`（effect + `:102` 返回 null） | **不动**。它是「一次性地址翻译」，不是第二个工作台 | —— |
| `:93-100` 桌面 relay `?packageId=` → `/dashboard/works/$workId`（effect + `:110` 返回 null） | **不动**，同上 | —— |
| `:106-108` 桌面 `?view=recent\|works` → 整页换成 `CanonicalHistoryPage` | **移除**，改为 `beforeLoad` 重定向到已存在的 `/dashboard/recent`（`routes/dashboard/recent.tsx:4`）与 `/dashboard/works`（`routes/dashboard/works.tsx:15`） | `DashboardSearch:30`、`validateSearch:62-64`、`DashboardHome:106-108`、import `:2` |
| `:114-121` `<ComposerHome/>` | **保留为唯一出口**，三段在其内部纵向排布 | —— |

`?view=` 选「重定向」而非「保留」或「硬删」的理由：

- **保留**＝桌面上仍有第二个整页工作台，直接违反 D-164①「登录后只有一个 Dashboard 路由」（`:3075`）。
- **硬删**（不认这两个参数）会让既有外部链接落到裸工作台，且无迁移痕迹。
- **重定向**两个目标路由**已经存在**，语义一一对应（`recent` → 最近活动、`works` → 作品列表），零新建、地址不丢，且顺带修掉 §0 那条不可能通过的 e2e 断言。

移动端本来就没走过这条分叉（`:106` 的 `!isMobile` 前置），所以移动端行为零变化。

### 2.2 三段的具体渲染

`ComposerHome`（`composer-home.tsx:395`）的 return（`:2310`）改为：

```
<div data-testid="composer-home">                       ← 容器不动，class 不动
  <DashboardHomeGreeting/>                              ← 段外：DESIGN.md §3 问候语法则，:2330 原位
  <section aria-labelledby="dashboard-section-propose">  ← 段① 由 :2773-2791 整块上移
    <DashboardHomeSurface compact={viewportKind==='mobile'} .../>
  </section>
  <section aria-labelledby="dashboard-section-compose">  ← 段②：:2332-2748 现有 Composer 集群整体包进来
    …ProgressiveFactCard / ComposerConversation / ComposerPromptBar(含 lens + pill) / 报价行 / QuotaBlockingCard / ComposerToolsStrip…
  </section>
  <section aria-labelledby="dashboard-section-continue">  ← 段③ 新增
    <ContinueWorkSection/>
  </section>
  {briefView ? <BriefSurface/> : null}                   ← 覆盖层，不属任何一段，保持在末尾
</div>
```

要动的文件与函数，逐条：

| 文件 | 函数 / 位置 | 动作 |
|---|---|---|
| `src/routes/dashboard/index.tsx` | `DashboardSearch`（`:20`，`view` 字段 `:30`） | 删 `view` |
| 同上 | `validateSearch`（`:36`，view 分支 `:62-64`） | 删该分支 |
| 同上 | `Route`（`:35`） | 新增 `beforeLoad`：读原始 search 的 `view`，`'recent'` → `redirect({to:'/dashboard/recent'})`、`'works'` → `redirect({to:'/dashboard/works'})` |
| 同上 | `DashboardHome`（`:72`）`:106-108` ＋ import `:2` | 删分叉与孤儿 import |
| `src/product/composer/composer-home.tsx` | `ComposerHome` return（`:2310`） | 三段包 `<section>`；`:2773-2791` 上移到 `:2330` 之后；末尾挂 `<ContinueWorkSection/>` |
| 同上 | `:2696-2731` `<RecipeCardsPanel>` 挂载点 | 改挂 `<RecipePillRow>` 到 PromptBar 的新 `recipePillSlot`（见 §4.4） |
| `src/product/dashboard-home-surface.tsx` | `DashboardHomeSurface`（`:110`） | 加 `compact?: boolean`；`compact` 时 `TodayRecommendationCard` 走摘要态、`ExampleStoreShowcase` 折叠为一个「查看示例」按钮（复用已有 `example_store_show` 文案与 `:170-187` 的 opt_in 分支形态） |
| `src/product/today-recommendation-card.tsx` | `TodayRecommendationCard`（`:189`） | 加 `compact?: boolean`；compact 只渲染标题 ＋「用这条」按钮，三格分区（`:322-361`）折叠。**四态机 `:77` 与 D-126 内容合同一字不改** |
| 新建 `src/product/dashboard-continue-work.tsx` | `ContinueWorkSection` | 见 §3 |

**为什么三段的组合留在 `ComposerHome` 内、而不是提到 `routes/dashboard/index.tsx`**：段① 的「用这条」要预填段② 的草稿，现走进程内回调 `composer-home.tsx:2775-2787`（`setLensState(updateUserText(selectLens(current,'copy'), intent))` ＋ `focusComposerIntentInput()`）。提到路由层就必须新建一条跨组件预填通道（`creation-entry-model.ts:67` 的 `writeCreationDraftIntent` 是 sessionStorage 写入，但 `readCreationDraftIntent`（`:60`）**在生产代码里没有任何消费方**，只有单测用它——它是一条死通道，不能当现成桥）。为一次纵向重排新建总线不划算，且违反「不造轮子」。代价：`ComposerHome` 这个名字此后指的是整张 Dashboard；改名会波及 e2e/测试定位器，列为**可选后续**，不在本票。

### 2.3 桌面 / 移动的段落顺序与折叠

**DOM 顺序两端一致**（①②③），不做视口级顺序反转——顺序反转会让读屏与视觉朗读顺序在两端不同，且 D-164① 的「自上而下三段」是产品语义不是布局技巧。差异只落在**密度**：

| | 段① | 段② | 段③ |
|---|---|---|---|
| **桌面**（`viewportKind==='desktop'`，判定见 `composer-home.tsx:543`） | 完整推荐卡（三格分区 ＋ 机会卡）／冷态三家示例店 | 完整：模式开关 → lens 轴 → pill 行 → 大输入框 → 附件 → 报价行 | 完整：在跑任务列 ＋ 最近会话一条 ＋「全部创作记录」 |
| **移动**（`isMobile \|\| singleColumn`） | `compact`：一行标题 ＋「用这条」；冷态收成一个「查看示例」按钮 | 完整（pill 行横向可滚，不换行堆高） | `compact`：只出「还有 N 条在生成中」＋ 最近一条，其余进「全部创作记录」 |

理由：D-164 待验证明写「三段结构在移动端的信息密度与滚动体验」未验（`:3158`）。段① 在手机上若是完整卡，Composer 输入框会被挤出首屏——这正是 `composer-home.tsx:2764-2771` 当初把它压到最底下的动机。压缩密度而不是改顺序，既守住 D-164① 的段序，也守住 PRODUCT.md:37「Composer 永远是唯一主轴，任何面板不与它竞争视觉重心」。

**PRODUCT.md:37 与本改动的关系（不是冲突）**：该条前半句是「商家打开工作台第一眼看到的是『今天值得发什么』」——与 D-164① 段① 前置**同向**；后半句「不与它竞争视觉重心」约束的是**视觉权重**不是**纵向位置**。`composer-home.tsx:2766-2771` 的注释把两者当成同一件事，本改动把它们分开：位置按 D-164①，权重靠段① 的轻量化（无实底大卡、无指标、冷态可折叠）保证。该注释须随改动一并重写，不能留着与新排布互相打脸。

## 3. 「项目列表下沉为第 3 段一条」的具体形态

### 3.1 先澄清「项目」是哪个项目

仓里有两个同名不同物的「项目」，**不能混**：

| | 指什么 | 载体 | 与 D-164① 的关系 |
|---|---|---|---|
| 门店服务项目 | 光子嫩肤 ¥999 这类**服务条目** | `ProductState.store.projects`，前台只是门店档案的一个字段组（`src/routes/dashboard/store.tsx:304-310`） | **无关**。它不是「项目列表」，不下沉 |
| 营销项目 | 一次营销活动／一段并行工作 | **无实体**。D-164④ 把它列为记忆四域之一「项目（一次营销活动）」（`:3103`），但契约层没有 campaign/project 实体（`packages/contracts/src/` 全仓无 campaign 类型） | **这才是** Miora「项目列表」的对位物 |

结论：D-164① 说的「项目列表下沉为一条」，在本仓的现实对位物是**创作会话（session）**——`canonical-history-model.ts:110-115` 的 `sessions[]`（`id / workIds / createdAt / updatedAt`），一个 session 聚合一批 works，正是「一段并行工作」的既有形态。**本票不新建 campaign 实体**（无决策授权，且 D-164④ 的记忆域归 #259 一侧）。

### 3.2 「这一条」长什么样

段③ 是**两行 ＋ 一个出口**，不是一个列表面：

```
接着上次继续
├─ [行 1｜仅当有在跑任务] 还有 2 条在生成中 · 「帮我写一条光子嫩肤的朋友圈」   [回到这条]
├─ [行 2｜仅当有历史会话] 上次做的：3 条成品的创作          2 小时前     [打开]
└─ 全部创作记录 →   （链到 /dashboard/recent）
```

- 行 1 每条 = 一个在跑任务，标题取 `merchantText`（商家自己写的那句话，`composer-home.tsx:1210` 已用同一字段）；「回到这条」＝ `navigate({to:'/dashboard', search:{taskId}})`，落回段②的时间桥（`index.tsx:29` `taskId` 已在 search 合同里、`composer-home.tsx:1186-1211` 已实现按 taskId 复位）。**零新增后端。**
- 行 2 = 最近一条 session，文案与详情走既有 `canonical_history_session_title/detail`（`canonical-history-model.ts:344-352`），点击 → `/dashboard/sessions/{id}`（同处 `:349` 已有 href）。
- 出口链到 `/dashboard/recent`（`routes/dashboard/recent.tsx:4`，已存在），这也是 §2.1 里 `?view=recent` 的重定向落点——两处指同一个地方，不产生第二套「查看全部」。

### 3.3 数据来源（候选与选定）

| 候选 | 位置 | 给什么 | 选用 |
|---|---|---|---|
| `readActiveHarnessTasks` | `src/product/harness-client.ts:76`（`GET /api/core/p1/harness/tasks`），已被 `composer-home.tsx:1176-1183` 以 queryKey `['harness','active-tasks']` 消费 | 在跑任务 `taskId` ＋ `merchantText` | ✅ **行 1**。同一 queryClient 内复用同一 key，**不新增一次请求** |
| `operations.canonical_history` | `canonical-history-page.tsx:448-452`（queryKey `p1QueryKeys.request('operations','canonical_history')`）；投影 `canonical-history-model.ts:336`、sessions 分支 `:344-355` | `sessions[]` ＋ works/jobs/assets | ✅ **行 2**。只取 `sessions` 最新一条 |
| `operations.creative_workbench` | `today-recommendation-card.tsx:204-213` | 计数型工作台投影 | ❌ 只有计数，出不了「上次做的是哪条」 |
| `operations.content_packages` | `canonical-history-page.tsx:453-462` | 成品包列表 | ❌ 那是「成品」不是「上次工作」，且 `/dashboard/works` 已有专页 |

**取数纪律**：段③ 用 `useQuery` 复用上面两个 key（TanStack Query 同 key 去重），不新开 endpoint、不新开 p1 action。这条同时是 D-150 消费者证明门的正面材料——两个既有查询在首页多了一个真实消费点。

### 3.4 Day-0 空态

**冷态（无在跑任务且无 session）：段③ 整段不渲染。**

依据是 D-126 原文口径，D-164① 引用时也一字未改：「首页构成＝热态轻推荐卡＋继续上次工作／**冷态示例店预览**」（`:3080`）——冷态的位置是给示例店的，不是给一个空的「继续上次工作」。`composer-home.tsx:2764-2771` 的既有注释把同一件事说得更直白：「an empty panel above the axis was the worst of both readings」。

因此三段结构的完整口径是：

| 工作区状态 | 段① | 段② | 段③ |
|---|---|---|---|
| 冷（Day-0） | 示例店预览（`example-store-showcase.tsx:19`） | 完整 | **不渲染** |
| 有历史、今日推荐未出 | 推荐卡 pending/stale 态（`today-recommendation-card.tsx:77`） | 完整 | 渲染 |
| 热态 | 推荐卡 current 态 | 完整 | 渲染 |

这直接影响验收写法：「三段结构上屏」必须在**已 seed 一条 session 或一条在跑任务**的状态下断言；Day-0 的断言是「两段 ＋ 段③ 不存在」。两条都要写，见 §7。

## 4. 第二层 Skill pill 的排布方案

### 4.1 两个方案与取舍

| | **(A) pill 直接复用现有配方卡目录** | **(B) 等 #259「Skill 维护面」建查询后再接** |
|---|---|---|
| 数据源 | `surface_browser` 查询（`composer/composer-live.ts:61-70`，surfaceId `surface.home.launch`）→ `BrowserSurfaceProjection` → `recipe-cards.ts:233` `listVisibleRecipeCards`；断网/未就绪兜底 `launch-card-seeds.ts:86` `LAUNCH_CARD_SEEDS` | 待 #259 在 `apps/core/src/p1/skills/` 新建 `skill_list` 类查询 |
| 现在能不能做 | **能**。查询、投影、冷态兜底、apply 状态机（`recipe-apply.ts`）全部在位 | **不能**。`SkillFoundationModule.execute`（`foundation-module.ts:51-168`）只有 5 条命令，前端读不到任何 skill 列表 |
| 依赖 | 零。不碰 `apps/core`、不碰 `packages/contracts` | 硬依赖 #259，且 #259 在 spec 里属 B 批、控制台模块归 `#259→#254` 语义锁 |
| 风险 | pill 只承载 title，`RecipePresentation.summary`（`packages/contracts/src/creation-experience.ts:45-51`）在 pill 上无处安放 → 与 D-083/D-084 的可见性合同有张力（见 §4.5） | 前端 lane 被外部票阻塞；#261 在编排里排在 `#264FE → #261 → #253FE` 串行链上（spec `:596`），一卡卡三张 |

**推荐 (A)**，四条理由：

1. **决策原文已经指定了挂载点**。设计文档 `:2945`：「商家可见入口须挂在 D-139 已改约的输出类型轴上（文案／图文／视频 lens ＋ **配方卡目录**）——**配方卡目录即 Skill 的前台挂载点**。」D-164② 说「采纳 pill 形态」，D-164 影响段说「**D-139 配方卡目录的前台排布形态**按本条② 参照 pill」（`:3142`）。也就是说 (A) 不是「用配方卡代替 skill」，(A) **就是决策原文写的那件事**；(B) 反而是把决策没要求的东西提前引进来。
2. **不违反语义锁**。spec `:601` 的锁清单里，与本票相关的三条是：控制台模块（`#259→#254`）、事件合同（`#248` 唯一属主）、前台创作面（D lane 内 `#264FE→#261→#253FE` 串行，且与 `#260` 的前台入口段互斥）。方案 (A) 只改 `mkfast-template-main/src/product/composer/**` 与 `src/routes/dashboard/index.tsx`——**不新增任何后端命令/查询/契约字段**，不写入 #248 的事件键，不碰 #259 的控制台模块。它落在 D lane 自己的锁内，靠 lane 内串行本身满足。
3. **不触发 D-150 的失效模式**。(B) 会先建一个「查询已建、前台不接」的中间态；(A) 从头到尾只增加消费点。
4. **可平移**。pill 的数据接口只依赖 `RecipeCardView`（`recipe-cards.ts:33-52`）。#259 之后若要让 pill 显示门店层 Skill，只需在 `listVisibleRecipeCards` 上游多喂一路投影，pill 组件与分组逻辑不动。

### 4.2 分组：五类宣发任务 → 实际配方

分组键是 D-139 的五类宣发任务（`:2346`「五类宣发任务（项目曝光/热点/IP/活动团购/物料）保留为需求分类语言与**配方卡命名/分组维度**」）。**文案已经在 i18n 里躺着且当前无任何代码引用**（本稿 grep 确认 `creation_entry_marketing_*` 在 `src/` 与 `tests/` 零命中）——本票把它们接上，不新增 key：

| 组（i18n key） | zh | en | 含哪几条配方（`launch-seeds.ts` 实际内容） |
|---|---|---|---|
| `creation_entry_marketing_project_exposure` | 项目 / 服务曝光 | Project / service exposure | `recipe.case_to_xhs_note`「从案例图写小红书」image_text（`:102-140`）／`recipe.project_intro`「朋友圈项目介绍」copy（`:141-170`）／`recipe.douyin_project_video`「抖音项目成片」video（`:239-276`） |
| `creation_entry_marketing_promotion_conversion` | 促销团购转化 | Promotion and conversion | `recipe.campaign_visual_set`「项目/活动套图」image_text（`:171-203`；`factTypes` 含 `group_buy`，`:188`） |
| `creation_entry_marketing_promotional_material` | 宣传物料 | Promotional materials | `recipe.promotion_poster`「促销海报」image_text（`:204-238`；`contentPackagePlatform:'offline_material'` `:217`，且编译期 `intentTypes:['promotional_material']` `:509-513`——全仓唯一一条被显式打上物料意图的配方） |
| `creation_entry_marketing_hot_topic` | 热点借势 | Timely opportunities | **零条** |
| `creation_entry_marketing_brand_ip` | 品牌与个人 IP | Brand and personal IP | **零条** |

未入组的第 6 张卡：**`reuse_content`「旧内容换平台」**（`launch-card-seeds.ts:190-208` 的 collection 卡，后端对应 3 个 lens 变体 `launch-seeds.ts:278-389`）。它**不进 pill 行**——它不是一类宣发任务，而是一个复用动作，且交互语义不同：其他卡点击＝直接套用，它点击＝ `onReuseRequested` 交回对话（`recipe-cards-panel.tsx:122-128`）。塞进 pill 行会出现「点了不套用」的 pill。它留在段②对话区的既有复用 chips（`composer-home.tsx:231-247` `COMPOSER_REUSE_CHIPS`，渲染于 `composer-conversation.tsx:645-660`），那里本来就是它的家。

**空组处置**：热点借势 / 品牌与个人 IP **不渲染**（不出灰 pill、不出「即将开放」）。渲染一个点了没东西的分组是 PRODUCT.md「警惕无载体的想象功能」直接禁止的形态。结果是首版 pill 行实际出 **3 组 / 5 条 pill**。这两组是真实产品缺口，列入 §8 待拍板。

### 4.3 lens 联动

pill 行跟随 `lensId` 变化，复用 `listVisibleRecipeCards`（`recipe-cards.ts:233`）的既有语义，不另写筛选：

| lens 状态 | `listVisibleRecipeCards` 返回 | pill 行显示 |
|---|---|---|
| 未选（cold，`lensId===null`） | 冷态六卡（`:243-247`） | 3 组 / 5 条 pill（剔除 reuse collection） |
| `copy` | 该 lens 的 P0 卡，上限 4（`launch-card-seeds.ts:60-64`） | 项目 / 服务曝光（朋友圈项目介绍）＋ reuse 变体被剔除 |
| `image_text` | 上限 4 | 项目 / 服务曝光（从案例图写小红书）／促销团购转化（项目、活动套图）／宣传物料（促销海报） |
| `video` | 上限 3 | 项目 / 服务曝光（抖音项目成片） |

剔除规则只有一条：`card.kind === 'reuse_collection'`（`recipe-cards.ts:31`）。P0 上限（D-084）由上游函数保证，pill 行**不再自设上限**——两处设限会打架。

### 4.4 挂载位置与新建件

D-164① 段② 的四件套顺序是「输出类型轴三 lens ＋ 大输入框 ＋ 执行模式开关 ＋ 配方卡 pill」。现状这四件里前三件在 `ComposerPromptBar` 内、配方卡在 `composer-home.tsx:2696` 的 PromptBar **之外**，中间还隔着报价行（`:2592-2617`）、grounding 提示（`:2619-2660`）、额度卡（`:2665-2693`）——读不出「lens 的第二层」。所以 pill 必须进 PromptBar，**紧贴 lens 轴之下**：

| 文件 | 位置 | 动作 |
|---|---|---|
| `src/product/composer/composer-conversation.tsx` | `ComposerPromptBarProps`（`:391`，`lensSlot` 在 `:408`） | 新增 `recipePillSlot?: React.ReactNode` |
| 同上 | `ComposerPromptBar` 形参（`:442`，`lensSlot` 在 `:451`） | 解构新 prop |
| 同上 | `{lensSlot}` 渲染点（`:514`） | 其后紧接 `{recipePillSlot}` |
| 新建 `src/product/composer/recipe-marketing-groups.ts` | `MARKETING_TASK_GROUPS`、`groupRecipeCardsByMarketingTask(cards)` | familyId → 五类映射表 ＋ 分组投影（纯函数，可单测） |
| 新建 `src/product/composer/recipe-pill-row.tsx` | `RecipePillRow` | 消费 `RecipeCardView[]`，按组渲染 `role="group"` ＋ pill `<button>` |
| `src/product/composer/launch-card-seeds.ts` | `LaunchCardSeedSpec`（`:70`）、`LAUNCH_CARD_SEEDS`（`:86`） | 每条 seed 加 `marketingTask` 字段，供冷态兜底路径分组 |
| `src/product/composer/composer-home.tsx` | `:2695-2731` | `RecipeCardsPanel` 挂载点改为把 `RecipePillRow` 传进 PromptBar 的 `recipePillSlot`；apply/patch-preview/undo 三条既有链路（`recipe-apply.ts` 的 `requestApplyRecipe/confirmApply/undoApply`）**原样复用**，只换渲染件 |

**分组键放在前端而不是契约里**：`RecipePresentation`（`packages/contracts/src/creation-experience.ts:45-51`）没有分组字段，加字段要改契约、动 `apps/core` 的 seeds 与 studio 编译（`launch-seeds.ts:481-575`），跨 lane 且撞契约锁。前端按 `familyId`（`RecipeCardView` 没直接带，但 `RecipeCardTarget.familyId` 有，`launch-card-seeds.ts:222`；`BrowserRecipeProjection.familyId` 也有，`recipe-cards.ts:97`）做静态映射，与 `launch-card-seeds.ts:1-7` 文件头已声明的「Mirror of core launch-seeds field labels — browser must not import core」是同一个既有先例。**未映射的 familyId 一律落到「项目 / 服务曝光」并在 dev 下 console.warn**，绝不静默丢卡。

### 4.5 pill 形态与 D-083/D-084 的关系（须守住的部分）

D-164 只改了**排布形态**，没有改 D-083/D-084。逐条对照，pill 必须继承：

| D-083/D-084 条款 | 现状实现 | pill 上怎么守 |
|---|---|---|
| 每张卡是单个 `<button>`，无嵌套可交互控件 | `recipe-card-grid.tsx:11-17` 注释 ＋ `RecipeCardButton` | pill 就是一个 `<button>`，天然满足 |
| **动作标签常驻可见**（非 hover） | 卡面渲染 `actionLabel`（如「选择图文并套用」） | pill 视觉上只放 title。**动作语义落在可访问名**：`aria-label={`${title}，${actionLabel}`}`。这是本设计对 D-083 唯一的形变，见 §8 待拍板 ③ |
| 触控目标 ≥48×48 | `min-h-12 min-w-12` 一类（lens 轴 `lens-radiogroup.tsx:68` 是同样写法） | pill 直接沿用 lens 轴那套 class（同一行视觉族，本来就该一致） |
| 窄栏（<280px / 200% 缩放）不截断 | `mobile-layout.ts:70-72` `COMPOSER_CARD_TEXT_CLASS`（`whitespace-normal break-words`） | pill 行沿用同一个常量；窄栏下 pill 换行堆叠而非横向截断 |
| 冷态六卡两列三行 / 选 lens 后 P0 上限 | `mobile-layout.ts:44-59` `resolveComposerCardGridLayout` | 该函数服务网格，pill 行不再走它；**上限仍由 `listVisibleRecipeCards` 保证**（§4.3） |

`summary`（如「用案例图生成笔记与封面」）在 pill 上无处放：走 pill 的 `title` 原生属性作 tooltip，完整目录仍在 `/dashboard/catalog`（`routes/dashboard/catalog.tsx:13`，已有全屏创作目录，选完 `navigate` 回 `/dashboard`，`:44-51`），由 `ComposerToolsStrip` 的「查看全部」出口进入（`composer-home.tsx:2745-2747`、`composer-tools-strip.tsx:66-73`）。**目录本身不删、不降级**，只是首页不再平铺它。

## 5. i18n 新增 key 清单

规则：源文件 `mkfast-template-main/project.inlang/messages/{zh,en}.json`（扁平、按 key 字典序），用法 `import { key } from '@/locale/paraglide/messages'` 后 `key()`。zh 为 baseLocale（`scripts/check-locale-keys.ts:149`），两边必须同时有值（`:133-138`）。文案守 D-116：不出现 route / lens / recipe / skill / session / task 这类词。

### 5.1 复用既有 key（**不新增**）

| key | zh | 用在哪 |
|---|---|---|
| `creation_entry_marketing_legend` | 选择宣发任务 | `RecipePillRow` 整行的 `aria-label` |
| `creation_entry_marketing_project_exposure` | 项目 / 服务曝光 | pill 组标题 |
| `creation_entry_marketing_promotion_conversion` | 促销团购转化 | pill 组标题 |
| `creation_entry_marketing_promotional_material` | 宣传物料 | pill 组标题 |
| `creation_entry_marketing_hot_topic` | 热点借势 | 组标题（本版无配方，不渲染） |
| `creation_entry_marketing_brand_ip` | 品牌与个人 IP | 组标题（本版无配方，不渲染） |
| `example_store_show` | 查看示例 | 段① 移动端 compact 折叠按钮（`dashboard-home-surface.tsx:181` 已在用） |

这 6 个 `creation_entry_marketing_*` 目前在 `src/` 零引用——本票让它们**第一次有生产消费方**，同时消除一处「文案已建无人用」的存量。

### 5.2 新增 key

| key | zh | en | 用在哪个组件 |
|---|---|---|---|
| `dashboard_section_propose_title` | 今天值得发点什么 | Worth posting today | 段① `<section>` 的标题（`composer-home.tsx` 三段包裹） |
| `dashboard_section_compose_title` | 现在就做一条 | Make one now | 段② `<section>` 标题 |
| `dashboard_section_continue_title` | 接着上次继续 | Pick up where you left off | 段③ `<section>` 标题 |
| `dashboard_continue_running` | 还有 {count} 条在做 | {count} still in progress | `ContinueWorkSection` 行 1 表头 |
| `dashboard_continue_resume` | 回到这条 | Go back to it | `ContinueWorkSection` 行 1 按钮 |
| `dashboard_continue_last` | 上次做的：{title} | Last time: {title} | `ContinueWorkSection` 行 2 |
| `dashboard_continue_open` | 打开 | Open | `ContinueWorkSection` 行 2 按钮 |
| `dashboard_continue_view_all` | 看全部做过的 | See everything you've made | `ContinueWorkSection` 出口链接 |
| `composer_recipe_pill_action_aria` | {title}，{action} | {title} — {action} | `RecipePillRow` 每个 pill 的 `aria-label`（`{action}` 喂 `card.actionLabel`，即既有「选择图文并套用」） |
| `composer_recipe_pill_group_aria` | {group}相关的做法 | Ways to do {group} | `RecipePillRow` 每个 `role="group"` 的 `aria-label` |
| `composer_recipe_pill_view_all` | 看全部做法 | See all approaches | pill 行末尾通往 `/dashboard/catalog` 的出口（若与 `composer-tools-strip.tsx:66` 现有出口重复则不新增，改复用——**实现时先核对该处现文案** |

文案自检（D-116）：上表 zh 列无「路由 / 视图 / 会话 / 任务 / 配方 / 技能 / 模板 / lens」等技术词；「做法」代替「配方」、「做过的」代替「历史记录」、「在做」代替「运行中/进行中的任务」。段③ 行 2 的 `{title}` 取 `canonical_history_session_title()`（既有文案，`canonical-history-model.ts:350`），不自造。

## 6. 旧双路由入口收敛清单

票面验收「旧双路由入口收敛（移除或重定向）」逐个落到具体文件：

| # | 文件 | 现状 | 处置 | 验收怎么证 |
|---|---|---|---|---|
| 1 | `src/routes/dashboard/index.tsx:106-108` `?view=recent\|works` 分叉 | 桌面上整页换成 `CanonicalHistoryPage`，是事实上的第二个工作台 | **移除分叉 ＋ `beforeLoad` 重定向**到 `/dashboard/recent`、`/dashboard/works` | e2e：`goto('/dashboard?view=recent')` 后 `expect(page).toHaveURL(/\/dashboard\/recent$/)`；interaction：`router.state.location.pathname === '/dashboard/recent'` |
| 2 | 同上 import `:2` `CanonicalHistoryPage` | 只服务 #1 的分叉 | **删**（本次改动造成的孤儿，属「清理自己的烂摊子」范围） | `pnpm knip` 无新增 unused；typecheck 绿 |
| 3 | `src/routes/dashboard/content.tsx:20` | 已是纯 redirect 壳（`beforeLoad` throw redirect，`:25-34`） | **无需动** | e2e：`goto('/dashboard/content')` → URL 落 `/dashboard/works` |
| 4 | `src/routes/dashboard/content_/$contentId.tsx:11` | 已是纯 redirect 壳（`:12-17`，一对一转 `/dashboard/works/$workId`） | **无需动** | e2e：`goto('/dashboard/content/x')` → `/dashboard/works/x` |
| 5 | `src/routes/dashboard/tasks.tsx:64` | 已是 redirect 壳（`:65-67`），但仍导出 `validateTaskInboxSearch`（`:44-62`）与 `TaskInboxRouteSearch`（`:21-30`） | **无需动**（`validateSearch` 仍被路由自身引用，`:68`；删它属 #264FE 的删除面，不是本票） | e2e：`goto('/dashboard/tasks')` → `/dashboard` |
| 6 | `src/routes/dashboard/tasks_/$taskId.tsx:13` | 已是纯 redirect 壳（`:14-16`） | **无需动** | e2e：`goto('/dashboard/tasks/x')` → `/dashboard` |
| 7 | `src/routes/dashboard/catalog.tsx:13` | 全屏创作目录，选完 `navigate({to:'/dashboard'})`（`:44-51`） | **保留**。它是 pill 行的「看全部」目的地（§4.5），不是竞争性工作台——它没有推荐位、没有继续上次工作，进去只能选一条再回来 | e2e：从工作台点「看全部做法」→ 落 `/dashboard/catalog`，选一条 → 回 `/dashboard` 且草稿已套用 |
| 8 | `src/routes/dashboard/recent.tsx:4` / `sessions.tsx:4` / `jobs.tsx:4` / `search.tsx:4` | 四条独立路由各渲染一个 `CanonicalHistoryPage` mode | **保留**。它们是段③ 的「查看全部」下游，不是第二个工作台 | 段③ 的出口链接指向 `/dashboard/recent`，e2e 断言点击后落地 |
| 9 | `tests/e2e/specs/uiux-shell-routes.spec.ts:121-122` | 断言 `?view=` 两个地址各出一个 h1（其中 `:122` 的「作品历史」在全仓不存在，见 §0） | **同批改**为断言重定向落点 | 改后该 spec 首次真正可通过；须在票下评论留痕「改了别人写的 e2e 断言及理由」 |

**「移除」与「重定向」的分界**：产生**第二个可长期停留的工作台**的入口一律移除或重定向（只有 #1 属此类）；单一职责的下游页（目录 / 历史 / 详情）一律保留。#3-#6 四个 redirect 壳是上一轮 T34/#228 的产物，本票**不重复劳动**，只在验收里把它们的行为断一遍，作为「旧双路由入口已收敛」的完整证据。

**删除类验收的形式**：本票没有整文件删除，所以 `git ls-files` 空输出这条不适用。等价证据是——`?view=` 的行为证明（重定向 e2e）＋ `pnpm knip` 无新增未用导出 ＋ typecheck 绿（孤儿 import 若没删会红）。

## 7. 验收断言草案（行为为证）

原则：断言只读**渲染出来的可访问树与真实导航结果**，不读源码、不 grep 字符串、不断言 props。三段的顺序用 `getAllByRole` 的文档顺序证明（RTL / Playwright 均按 DOM 顺序返回），不用 testid 位置硬编码。

### 7.1 「三段结构上屏」

新建 `mkfast-template-main/src/routes/dashboard/dashboard-three-sections.interaction.test.tsx`
（样板：`src/routes/dashboard/store-qualification.interaction.test.tsx:1-45` 的 memoryHistory ＋ RouterProvider ＋ `vi.mock('@/product/client')` / `vi.mock('@/p1/client')`；另需 mock `@/product/harness-client` 的 `readActiveHarnessTasks`）

```ts
it('热态：三段自上而下 = 提议位 → 创作面 → 继续上次工作', async () => {
  seedActiveTasks([{ taskId: 't-1', merchantText: '帮我写一条光子嫩肤的朋友圈' }]);
  seedCanonicalHistory({ sessions: [{ id: 's-1', workIds: ['w-1'], updatedAt: NOW }] });
  render(routerAt('/dashboard'));

  const sections = await screen.findAllByRole('region');
  expect(sections.map((s) => s.getAttribute('aria-label') ?? within(s).getByRole('heading').textContent))
    .toEqual(['今天值得发点什么', '现在就做一条', '接着上次继续']);   // 文档顺序即段序
});

it('段① 的「用这条」把话填进段② 的输入框，且不提交', async () => {
  seedRecommendation({ kind: 'current' });
  render(routerAt('/dashboard'));
  await userEvent.click(await screen.findByTestId('today-recommendation-use'));

  expect(screen.getByTestId('composer-intent-input')).toHaveValue(
    expect.stringContaining('光子嫩肤')                                // D-126：预填不自动执行
  );
  expect(submitHarnessTask).not.toHaveBeenCalled();
});

it('段③「回到这条」带着这条任务回到创作面，而不是打开第二个页面', async () => {
  seedActiveTasks([{ taskId: 't-1', merchantText: '写一条开业海报文案' }]);
  render(routerAt('/dashboard'));
  await userEvent.click(await screen.findByRole('button', { name: '回到这条' }));

  expect(router.state.location.pathname).toBe('/dashboard');           // 没离开单路由
  expect(router.state.location.search).toMatchObject({ taskId: 't-1' });
  expect(screen.getByTestId('composer-intent-input')).toHaveValue('写一条开业海报文案');
});

it('冷态（Day-0）只上两段，第三段不存在', async () => {
  seedActiveTasks([]); seedCanonicalHistory({ sessions: [] });
  render(routerAt('/dashboard'));

  expect(await screen.findByTestId('today-recommendation'))
    .toHaveAttribute('data-recommendation-state', 'cold');             // 既有属性，:224
  expect(screen.queryByRole('region', { name: '接着上次继续' })).toBeNull();
  expect(screen.getByTestId('composer-intent-input')).toBeVisible();    // 段② 仍在
});

it('移动端段序不变，只是段① 收成紧凑态', async () => {
  mockIsMobile(true);
  render(routerAt('/dashboard'));
  const sections = await screen.findAllByRole('region');
  expect(sections[0]).toHaveAttribute('aria-label', '今天值得发点什么');   // 顺序两端一致
  expect(within(sections[0]!).queryByText('用了本店什么')).toBeNull();     // 三格分区已折叠
});
```

新建 `mkfast-template-main/src/product/composer/recipe-pill-row.interaction.test.tsx`
（样板：`src/product/composer/recipe-cards.interaction.test.tsx:22-42` 的受控 harness）

```ts
it('冷态按宣发任务分组，只出有做法的组', () => {
  render(<PillHarness surface={launchSurfaceFixture} />);
  expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label')))
    .toEqual(['项目 / 服务曝光相关的做法', '促销团购转化相关的做法', '宣传物料相关的做法']);
  expect(screen.queryByRole('group', { name: /热点借势/ })).toBeNull();   // 空组不渲染
});

it('项目 / 服务曝光组含三条，且顺序稳定', () => {
  const group = screen.getByRole('group', { name: /项目 \/ 服务曝光/ });
  expect(within(group).getAllByRole('button').map((b) => b.textContent))
    .toEqual(['从案例图写小红书', '朋友圈项目介绍', '抖音项目成片']);
});

it('pill 的可访问名带住 D-083 的动作语义', () => {
  expect(screen.getByRole('button', { name: '从案例图写小红书，选择图文并套用' })).toBeInTheDocument();
});

it('选「视频」后只剩含视频做法的组', async () => {
  await userEvent.click(screen.getByTestId('composer-lens-option-video'));
  expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label')))
    .toEqual(['项目 / 服务曝光相关的做法']);
});

it('点 pill 直接套用：lens 切过去，草稿带上这条做法', async () => {
  await userEvent.click(screen.getByRole('button', { name: /从案例图写小红书/ }));
  expect(onLensStateChange).toHaveBeenCalledWith(
    expect.objectContaining({ lensId: 'image_text' })
  );
});

it('旧内容换平台不在 pill 行里', () => {
  expect(screen.queryByRole('button', { name: /旧内容换平台/ })).toBeNull();
  // 它仍在对话区的复用 chips 里
  expect(screen.getByTestId('composer-reuse-chip-xiaohongshu')).toBeInTheDocument();
});

it('窄栏不截断、触控目标够大（D-084 承接）', () => {
  render(<PillHarness viewportWidth={260} />);
  for (const pill of screen.getAllByRole('button')) {
    expect(pill.className).not.toMatch(/line-clamp|truncate/);
    expect(pill.className).toMatch(/min-h-12/);
  }
});
```

纯函数单测 `src/product/composer/recipe-marketing-groups.test.ts`：`groupRecipeCardsByMarketingTask` 对未知 familyId 落「项目 / 服务曝光」且不丢卡（输入 n 条 → 输出各组之和 = n − reuse_collection 条数）。

### 7.2 「旧双路由入口收敛」

新建 `mkfast-template-main/tests/e2e/specs/dashboard-three-sections.spec.ts`
（登录/建店样板：`tests/e2e/specs/dashboard-home-mount.spec.ts:5-15` 的 `registerE2EUser` / `loginByForm` / `seedConfirmedStore`）

```ts
test('一个地址一张工作台：三段在同一屏，旧入口都不产生第二张', async ({ page, request }) => {
  const user = await registerE2EUser(request); await loginByForm(page, user);
  await seedConfirmedStore(page);
  await seedOneFinishedRun(page);                       // 让段③ 有内容

  await page.goto('/dashboard');
  const sections = page.getByRole('region');
  await expect(sections).toHaveCount(3);
  await expect(sections.nth(0)).toContainText('今天');
  await expect(sections.nth(1).getByTestId('composer-intent-input')).toBeVisible();
  await expect(sections.nth(2)).toContainText('接着上次继续');

  // 旧双入口：每一个都必须落回单一目的地，且落地页不含 Composer 输入框
  for (const [from, to] of [
    ['/dashboard?view=recent', /\/dashboard\/recent$/],
    ['/dashboard?view=works',  /\/dashboard\/works$/],
    ['/dashboard/content',     /\/dashboard\/works$/],
    ['/dashboard/tasks',       /\/dashboard$/],
    ['/dashboard/tasks/t-x',   /\/dashboard$/],
  ] as const) {
    await page.goto(from);
    await expect(page).toHaveURL(to);
  }
  // 反向证明：/dashboard/recent 不是第二张工作台
  await page.goto('/dashboard/recent');
  await expect(page.getByTestId('composer-intent-input')).toHaveCount(0);
  await expect(page.getByTestId('today-recommendation')).toHaveCount(0);
});

test('pill 的「看全部做法」进目录、选一条再回到同一张工作台', async ({ page, request }) => {
  const user = await registerE2EUser(request); await loginByForm(page, user);
  await page.goto('/dashboard');
  await page.getByRole('link', { name: '看全部做法' }).click();
  await expect(page).toHaveURL(/\/dashboard\/catalog/);
  await page.getByTestId('dashboard-catalog-page').getByRole('button').first().click();
  await expect(page).toHaveURL(/\/dashboard\?/);
  await expect(page.getByRole('region')).toHaveCount(3);     // 回来的还是那三段
});
```

**同批要改的既有断言**：`tests/e2e/specs/uiux-shell-routes.spec.ts:121-122` 两行从「`?view=` 各出一个 h1」改为「`?view=` 各自重定向到 `/dashboard/recent`、`/dashboard/works`」。理由与 §0 的既有假绿一并写进票下评论。

**跑法纪律**：`typecheck` / `test` / `test:interaction` / `e2e` 四条都会重写 `src/locale/paraglide/`，同 worktree 内不与 `pnpm dev` 并跑（runbook `:17`）。新增 i18n key 后**先跑一次 `test:interaction` 让 paraglide 产物落盘**，再跑 e2e。

## 8. 风险与待用户拍板项

只列真正需要拍板的四条，其余（段序、`?view=` 处置、分组映射位置、pill 与卡的关系）本稿已按决策原文自行判定，不占用户时间。

| # | 事项 | 背景 | 我的推荐 |
|---|---|---|---|
| ① | **两类宣发任务没有配方**：热点借势、品牌与个人 IP 在 `launch-seeds.ts` 里零条（§4.2）。首版 pill 行只出 3 组 5 条 | D-139 把五类定为分组维度，但配方种子从来只覆盖三类。「热点」在别处有零件——推荐卡里已有 `HotTopicOpportunityCardView`（`today-recommendation-card.tsx:362-365`）——只是没有对应的**可套用配方** | **本票只出 3 组，不补配方**。补配方要动 `apps/core` 的 seeds ＋ studio 编译链（`launch-seeds.ts:481-575`），属后端面、跨 lane，不该塞进前端 lane 的串行链。建议单开一张「补齐热点/IP 两类配方种子」的票，排在 #261 之后 |
| ② | **D-083「动作标签常驻可见」在 pill 上变成可访问名**（§4.5）。视觉上 pill 只有标题，「选择图文并套用」退到 `aria-label` | D-164② 采纳 pill 形态但没提 D-083；D-083 的原意是反 hover-only（信息只在悬停时出现，触屏上永不可达）。pill 的动作不是「隐藏」而是「合并进 pill 本身」——点 pill 就是套用，不存在第二个动作 | **按本稿实现**（aria-label 承载 D-083 文案），并在票下评论显式记录「D-083 视觉常驻在 pill 形态下改为可访问名常驻」这一形变。若用户认为 D-083 不可形变，退路是 pill 双行（标题 ＋ 小字动作），密度回升约 40%，与 D-164② 的「轻」相悖 |
| ③ | **段① 上移与 `composer-home.tsx:2764-2771` 既有注释的立场相反**。该注释是上一轮实现刻意写下的产品判断（空推荐位压在主轴上方是最差读法） | D-164①（2026-07-29）晚于该注释，且逐字规定了段序；PRODUCT.md:37 前半句也要求「第一眼看到今天值得发什么」。冷态问题由「冷态段① 走示例店、段③ 不渲染」化解（§3.4） | **按 D-164① 上移**，同时重写该段注释（不能留着与新排布互相打脸）。**风险坦白**：D-164① 自己的证据边界写着「本条①②④⑤ 为产品裁定，无实现证据」（`:3152`），且移动端信息密度是公开的未验项（`:3158`）。建议上线后用真实商家观察首屏行为再决定是否回退 |
| ④ | **改了别的 lane 写的 e2e 断言**：`uiux-shell-routes.spec.ts:121-122`（§7.2） | 该断言锚的是 `?view=` 分叉的存在，而本票依 D-164① 移除它；且 `:122` 那行当前不可能通过（§0） | **改，不删**——改成断言重定向落点，覆盖面不减。改前在票下评论说明，并 @ 该 spec 的属主票号确认。若主控要求不动别人的 spec，退路是新建一条独立 spec 断言重定向、把 `:121-122` 标 `test.fixme` 并注明原因 |

### 遗留观察（不需拍板，供后续票参考）

- `readCreationDraftIntent`（`creation-entry-model.ts:60`）在生产代码里零消费方，只有 `creation-entry-model.test.ts:205` 用它 —— 一条写进 sessionStorage 但没人读的死通道。属既有存量，本票不删（不是本票改动造成的孤儿）。
- `ComposerHome` 在本票后实际是整张 Dashboard 的容器，名字已经不准；改名会波及 e2e/测试定位器，建议与 #253FE 的流式改造同批处理。
- D-164④「记忆升一级导航」会把 `BUSINESS_NAVIGATION`（`src/lib/uiux/navigation.ts:10`）从四项变五项，届时 `src/components/product/mobile-nav.tsx:55` 的 `grid-cols-4` 必须同批改成 5 栏，`src/config/sidebar-config.ts:50` 的 `businessIcons` 也要补一项，`scripts/check-locale-keys.ts:6` 的 `REQUIRED_PRODUCT_KEYS` 要加新导航 key。**本票不动这三处**，此处只作交接备忘。
