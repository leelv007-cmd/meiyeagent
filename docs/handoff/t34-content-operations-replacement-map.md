# T34 内容页＋运营旧面换壳下线 — 「旧面 → 新面」替代对照表

票：T34 / issue #228（Spec #194；归桶矩阵 §3 old-ia-reshell 三行）
分支：`legacy-origin-a/t34-content-operations-reshell`
用途：**T38 条件删除批（1D）第三段清单的逐行核对依据**。本票只做路由下线＋入口收敛＋替代面收口，一行未删。

删除谓词（矩阵 §1 实现决定 1）：`1D ＝ 换壳票组全部合入 ＋ 旧页零路由引用`。
第二个条件从本票起是**机器可判**的：`node scripts/uiux/retired-ia-route-mount-guard.mjs`
从全部 107 个生产路由入口出发走真实 import 图（679 个可达文件），
断言六件旧 IA 模块一个都不可达；挂在根 `pnpm check` 第 7 门。

## 0. 接缝裁决（本票动工前的 decision_gate）

预研 §D 原案「新建 `src/product/content/` 内容面」**已作废**。实测：内容面若只读
`content_packages`，就是 T32 作品面（`content_packages` ＋ `canonical_history.canvasWorks`）
的严格子集，卡片／详情动作／投影函数全部同源＝第二个成品面，与 ADR-0011 唯一聚合冲突；
且 `/dashboard/works` 当时不在一级导航里（站内入口只有 `content-package-export-carrier.tsx:101`）。
协调者裁定 **A 案：唯一成品面**——一级导航「内容」改指 `/dashboard/works`，旧内容库两条路由
改为显式跳转，不新建内容面目录。作品面自此有导航家。

同批裁定：**不建第二收件箱、不迁移 RawTask 任务筛选面**（见 §3）。

## 1. 旧面 → 新面对照

| 旧面（归桶矩阵行） | 旧面职责 | 新面替代物 | 本票交付后的剩余引用 |
| --- | --- | --- | --- |
| `routes/dashboard/-content-library-surface.tsx`（986 行） | 一级导航「内容」实体页：ContentPackage 三态分组库＋旧 legacy contents 折叠区＋handoff 发布包区 | `src/product/works/works-list-page.tsx`（内容列表，四类输出统一呈现，T32 交付） | **生产路由零引用**（`retired-ia-route-mount-guard` 实证 unrouted）。仅 `routes/dashboard/content.test.tsx` 仍 import——删除时两文件同批走 |
| `routes/dashboard/-content-helpers.tsx`（62 行） | `LegacyContentBody` 展开/复制、`stableContentPackageSelection` | 无替代：legacy `ProductState.contents` 折叠区随旧库退场，新面只读 canonical ContentPackage 投影 | **生产路由零引用**。仅 `content.test.tsx` / `-content-detail-route.test.tsx` 仍 import |
| `routes/dashboard/content.tsx`（35 行→33 行） | 旧内容库路由 | **本票重写为跳转壳**：`?packageId=` → `/dashboard/works/{id}`；其余 → `/dashboard/works` | 保留运行。**不在 T38 删除清单**（除非 T38 判定旧地址无需兼容） |
| `routes/dashboard/content_/$contentId.tsx`（30 行→18 行） | 旧内容详情路由 | **本票重写为跳转壳**：`/dashboard/works/{contentId}`（路径参数一直是 ContentPackage id，`workDetail` 直接按 package id 解析＝零成本一一映射） | 保留运行 |
| `product/operations-task-page.tsx`（667 行） | 旧任务台账：RawTask 收件箱＋周批次＋周复盘＋任务事件流＋任务详情 | 待办与审批 → `product/pending-actions-inbox.tsx`（既有 KEEP，挂 `async-task-center` 侧栏抽屉）；周复盘 → `product/results/weekly-review-*`（挂 `result-center-page`）；**任务筛选面无替代物**（见 §3） | **生产路由零引用** |
| `p1/content-task-inbox.tsx`（503 行） | RawTask 列表＋`TaskInboxFilters` | 同上：收件箱职能归 pending-actions-inbox（两者读不同投影，数据面无重叠） | **生产路由零引用**（唯一 importer＝operations-task-page） |
| `p1/weekly-operations.tsx`（297 行） | `ThinWeeklyReview` / `WeeklyBatch` 旧周运营 | `product/results/weekly-review-model.ts` ＋ `weekly-review-panel`（**不是同一实现**，票面「已被取代、零引用」的说法本票证伪：本票之前经 `/dashboard/tasks?mode=week` 可达） | **生产路由零引用** |
| `p1/compact-week-strip.tsx`（105 行） | 旧周运营条 | 同上 | **生产路由零引用**（唯一 importer＝content-task-inbox） |
| `p1/retrieval-facets.tsx`（旧检索面） | 任务筛选枚举（状态/来源/关联对象） | **无替代物**（见 §3） | **生产路由零引用** |
| `p1/operations-route-model.ts`（138 行） | `taskQuery` / `currentWeekRange` / `weeklyReviewView` | 无替代物，随旧任务页退场 | **生产路由零引用** |
| `p1/operations-view-model.ts`（584 行） | 共享读模型（`taskView` / `weekPointView` / `RawTask`…） | **不替代、不下线** | **仍在路由中**：`product/creation-catalog-model.ts` → 全局命令面板；T32 的 `works-light-edit-page.tsx:23` 取 `RawTemplate`。票面把它列进「旧 IA 消费层」是误判，**建议 T38 移出删除清单** |
| `p1/template-catalog.tsx` | 旧模板浏览 | `product/composer/fullscreen-catalog-panel.tsx`（`/dashboard/catalog` → `CatalogLivePage`） | **生产路由零引用**（唯一 importer＝T07 属主的死面 `creation-shelf.tsx`）。归 T07 删 |

## 2. 路由切换结果

| 路由 | 换壳前 | 换壳后 |
| --- | --- | --- |
| 一级导航「内容」 | `Routes.ContentLibrary = /dashboard/content` | `Routes.ContentLibrary = /dashboard/works`（标签仍是「内容」） |
| `/dashboard/content` | `ContentLibrarySurface` | `redirect → /dashboard/works`（`?packageId=X` → `/dashboard/works/X`） |
| `/dashboard/content/$contentId` | `ContentLibrarySurface`（整页） | `redirect → /dashboard/works/$contentId` |
| `/dashboard/tasks` | `OperationsTaskPage` | `redirect → /dashboard`（待办在工作台的收件箱抽屉） |
| `/dashboard/tasks/$taskId` | `OperationsTaskDetailPage` | `redirect → /dashboard`（单任务无独立页，id 丢弃） |
| `/dashboard/works`、`/dashboard/works/$workId` | T32 交付，无导航入口 | 不变；自此是一级导航「内容」的落点 |

两条跳转都经 `lib/uiux/navigation.ts` 的 `legacyRedirects` 冻结表（与既有 settings 跳转同一机制，带 `emitTelemetry('redirect')` 留痕）。

## 3. 收件箱＝IA 归并，不是组件复用（预研 §C 结论 + 协调者批准）

`pending-actions-inbox` 渲染 `PendingAction`（question / approval 两 kind，读 pending_actions 投影）；
`content-task-inbox` 渲染 `RawTask` 列表（读 operations inbox 投影）。**两者数据面无重叠**。

- **不建第二收件箱、不迁移任务筛选面**（状态／来源／风险／关联对象／周批次／任务事件流）：
  这些是收件箱装不下的职能，票面明定「任务页职能由收件箱＋对话内任务卡取代，路由下线」，
  按 D-127 接受中间态。**登记为「无替代物，随本批下线」**。
- **收件箱不开独立路由**：挂载点仍是 `async-task-center` 侧栏抽屉
  （`dashboard-sidebar.tsx` → `sidebar-layout.tsx`），全站任意页可达，
  符合「待办只出现在一处」。旧抽屉里的「查看全部」原本硬编码指向 `/dashboard/content`，本票改指 `Routes.ContentLibrary`。
- 若运营侧将来要任务筛选控制台，**另开票，不回流本票**（协调者裁定）。

## 4. 入口收敛清单（逐处交付状态）

| 位置 | 换壳前 | 换壳后 |
| --- | --- | --- |
| `lib/routes.ts:31` | `ContentLibrary: '/dashboard/content'` | `'/dashboard/works'` |
| `lib/routes.ts:29` | `TaskInbox: '/dashboard/tasks'` | **已删除**（无人再指向退役路由；跳转壳用字面量） |
| `lib/uiux/navigation.ts` BUSINESS_NAVIGATION | `href: Routes.ContentLibrary` | 不变（跟随常量改指） |
| `lib/uiux/navigation.ts` `returnObjectPaths.content` | `/dashboard/content` | `/dashboard/works` |
| `lib/uiux/navigation.ts` `returnObjectPaths.task` | `/dashboard/tasks` | **已删除**（任务无对象页，anchor 解析为 undefined） |
| `lib/uiux/navigation.ts` `legacyRedirects` | — | 新增 `/dashboard/content → /dashboard/works`、`/dashboard/tasks → /dashboard` |
| `product/trusted-return.tsx` | `TRUSTED_RETURN_IDS` 含 `'tasks'` | 移除 `'tasks'`；`content` 目标跟随 `Routes.ContentLibrary` |
| `product/async-task-center.tsx:483` | 硬编码 `href='/dashboard/content'` | `getPathWithLocale(Routes.ContentLibrary)` |
| `components/product/mobile-nav.tsx:58` | `to={Routes.ContentLibrary}` | 不变（跟随常量改指） |
| `config/sidebar-config.ts` / `sidebar-main.tsx` | 由 `BUSINESS_NAVIGATION` 派生 | 不变（跟随；侧栏高亮按 href 前缀匹配，落在 `/dashboard/works` 正确） |
| `product/global-command-model.ts` | 由 `BUSINESS_NAVIGATION` 派生 | 不变（跟随） |
| `routes/dashboard/index.tsx:88-95` | desktop relay → `/dashboard/content/$contentId` | → `/dashboard/works/$workId`（relay 载荷本就是 packageId） |
| `routes/dashboard/results_/$workId.tsx:1125` | close-loop 回跳 `/dashboard/tasks` | 回跳工作台 |
| `product/results/result-return-navigation.ts:144-168` | `task-inbox` 返回态还原筛选/滚动/焦点 | `resultReturnDestination` 收敛为工作台单一落点；解析/序列化保留（旧链接不能抛错），随 T38 与旧页同批清 |
| `product/operations-rail.tsx:73,111` | `/dashboard/tasks` 硬链接 | **不动**：T07 独占删除的死面，链接随文件死（跨票互斥，预研 §E） |
| `product/content-library-model.ts:384` | `/dashboard/content?packageId=` | **不动**：随旧库壳处置（本票后生产路由零引用，与 `-content-library-surface` 同批走） |
| `p1/source-object-navigation.ts:12,15` | `/dashboard/content?contentId=`／`?handoffId=` | **不动**：唯一生产消费者 `operations-view-model.ts:388` 落在本批下线的旧任务面上；目标地址仍是跳转壳，退化为「跳列表」＝协调者对无映射 id 批准的行为 |
| `apps/canvas/src/client/runtime-panel.tsx:1115` | 采纳回跳 `/dashboard/content` | **不动**：跨包（canvas app），经跳转壳一跳到达新详情页；e2e `pro-studio-kernel-ui` 已按最终 URL 断言 |

## 5. 商家语言统一为「内容」（协调者对 T32 交付文案的窄授权）

产品词根是「内容」（ContentPackage／内容副驾／D-118 内容编译器），一级导航也叫「内容」，
所以作品面**商家可见**的自称一并对齐。只动可见字符串，**路由名／目录名／组件名／testid 全部保持 `works`**。

| 文件 | 换壳前 → 换壳后 |
| --- | --- |
| `works-queries.ts` | `WORKS_TITLE = '作品'` → `'内容'`（页题＋两页面包屑跟随） |
| `works-list-page.tsx` | `作品类型`→`内容类型`；`搜索作品`→`搜索内容`；`搜作品标题或正文`→`搜内容标题或正文`；`正在整理你的作品…`→`…你的内容…`；`作品暂时没能取回来`→`内容暂时没能取回来`；`还没有作品`→`还没有内容` |
| `works-detail-page.tsx` | `怎么用这份作品`→`怎么用这份内容`；`回到作品列表`→`回到内容列表`；`正在打开这份作品…`／`这份作品暂时没能取回来`／`没找到这份作品`／`这份作品还没有可导出的成品版本。` 同批改「内容」 |
| `works-light-edit-page.tsx` | `没找到这份作品`／`可以把这份作品换到新版式…` 同批改「内容」 |
| `works-projection.ts` | 使用导购三句（授权已撤回／还在流程里／得先换掉素材）＋画廊默认标题 `'作品'`＋轻编辑摘要 `在轻编辑里做的图文作品` 同批改「内容」 |

**未改，需 T38／文案批次决定**：`p1/canvas-name.ts` 经 Paraglide 消息返回 `空白图文作品`
（`creation_shelf_blank_canvas_name`），与旧 canvas 作品页共用，属消息目录级决定而非本面文案，
按协调者「深度织入就停下只做最小对齐并回报」的口径未动。轻编辑画布作品的卡片标题因此仍显示「作品」。

## 6. 静态门（本票新增／扩容）

| 门 | 内容 |
| --- | --- |
| `scripts/uiux/works-canonical-projection-guard.mjs`（扩容） | 扫描范围并入两条 content 跳转壳（`legacy_projection_*` 零引用 ＋ 不得 bind delete-after-reshell 模块 ＋ operationsQuery 白名单）。白名单未放宽 |
| `scripts/uiux/retired-ia-route-mount-guard.mjs`（新增，进 `pnpm check` 第 7 门） | 从 107 个生产路由入口走真实 import 图，断言六件旧 IA 模块零可达。`-` 前缀文件与 `.test.` 文件不算路由入口（TanStack 不把 `-` 前缀纳入路由树）。**`operations-view-model` 刻意不在清单内**（见 §1 末行） |

## 6b. `legacy_projection_*` 字面量基数：本票为何没能把 `-content-library-surface` 的 6 处归零

票面预研 §D 写「本票归零点＝`-content-library-surface` 的 6 处」，那是按**新建内容面、旧面随之作废**
的原案算的。A 案裁决后旧面整壳留给 T38 删，而本票**不许在 RETIRE 桶打补丁**（D-127），
所以那 6 处只能随文件走，不能就地摘掉。

实测当前基数（`rg -c legacy_projection_`，排除 node_modules 与 locale 产物）：

| 文件 | 命中 | 归属 |
| --- | --- | --- |
| `product/creative-object-page.tsx` | 49 | T38 退役面（票面预期残基） |
| `product/canonical-history-page.tsx` | 48 | T38 退役面（票面预期残基） |
| `product/legacy-content-package-projection.ts` | 14 | 定义文件（票面预期残基） |
| `routes/dashboard/-content-library-surface.tsx` | 6 | **本票已使其生产路由零引用**，字面量随文件在 T38 归零 |
| `components/layout/shell-visual-contract.test.ts` | 2 | 非代码面（票面预期残基） |
| `project.inlang/messages/{zh,en}.json` | 52 / 52 | 消息目录，随上述文件删除后清理 |

本票真正做到并被静态门锁住的是票面的**语义**目标：**新内容面零 `legacy_projection_*` 引用**
（`works-canonical-projection-guard` 扫 `product/works` 全目录 ＋ 两条 works 路由 ＋ 两条 content 跳转壳，零命中；
`works-projection.ts:7` 的唯一字面量出现在文档注释里，不是 `from '…'` 绑定，守卫按设计不判违规）。

## 7. e2e 处置（Testing decision 8：随删除批清理**或显式降级**）

| spec | 处置 |
| --- | --- |
| `uiux-shell-routes.spec.ts` | 路由表 `/dashboard/tasks 内容任务` → `/dashboard/works 内容`；跳转表新增两行断言 |
| `protected-pages.spec.ts` | `/dashboard/tasks` → `/dashboard/works` |
| `uiux-upgrade-b-i18n-motion.spec.ts` | 删 `/en/dashboard/tasks`（路由退役）；`/en/dashboard/content` → `/en/dashboard/works`。**此行预期红**，见 §8 |
| `p1-f2-acceptance.spec.ts` | 内容屏改测 `/dashboard/works`；任务屏改测工作台本体（旧周运营条无替代面） |
| `uiux-creation-loop.spec.ts` / `uiux-upgrade-b-video.spec.ts` / `pending-actions-inbox.spec.ts` | 地址改指 `/dashboard/works/{packageId}`。**后续断言预期红**，见 §8 |
| `p0-golden-journey.spec.ts` | 旧库的「L3 发布包」卡片只为打开交接页而存在；改为直达 `/dashboard/handoff/{token}`，旅程其余部分保留 |
| `pro-studio-cross-service-smoke.spec.ts` / `pro-studio-kernel-ui.spec.ts` | 保留旧地址（刻意走一次跳转），断言改为新详情面 `works-detail-surface` ＋ `data-package-id` |
| `pro-studio-node-generation.spec.ts` / `uiux-day0-contract.spec.ts` | 预热导航／fixture 锚点地址改指 `/dashboard/works` |
| `task-source-navigation.spec.ts` | **显式降级 `test.skip`**：整条测试的链接都起于旧任务收件箱，无替代面；跨工作区保证要重新落到 pending-actions 需要旅程决定。随 T38 处置 |
| `mobile-product-shell.spec.ts` | 两处 `goto('/dashboard/tasks?...')` 改指工作台（旧路由只是宿主页）。注：该 spec 的 `mobile-progress-entry` 用例**换壳前即红**——全库无组件渲染该 testid（`mobileProgressTarget` 亦仅被自身测试消费），非本票引入 |
| `mkfast-template-main/scripts/evidence/*.mjs`、`scripts/evidence/*.mjs` | **未动**：历史取证脚本，非 CI 门；仍走旧地址，经跳转壳可达 |

## 8. 交给后续票的收口项（本票越界或需旅程决定，未做）

1. **英文语言面回退**：换壳后的内容面（T32 `product/works/*`）文案全部内联中文、不走 Paraglide，
   而 `/en/dashboard/content` 原本在 `CORE_ENGLISH_ROUTES` 英文契约里。本票把该行改指
   `/en/dashboard/works` 并**保留**（不放宽断言），因此 `uiux-upgrade-b-i18n-motion` 该行预期红。
   这是换壳批的共性问题（reshell 面普遍内联中文），需一次批级决定：把 reshell 面接入消息目录，
   或按 D-116 拟人化文案确认商家面 zh-only 并同步收窄英文契约。**不是本票能单独裁的**。
2. **旧内容详情能力缺口**：以下断言仍指向旧 `ContentPackageDetail` 独有能力，新详情面不提供，
   预期红——`uiux-creation-loop`（`视觉顺序：N 张`、`海报`／`去做宣传海报`）、
   `uiux-upgrade-b-video`（`视频成片工作流`／`成片已完成`）、
   `pending-actions-inbox`（`生成三平台版本`）。对应能力在 Result Center
   （采用／导出／生成变体／视频工作流）可达，把这些旅程重新落到 Result Center 需要旅程决定。
3. **OI-63（T38 谓词裁决：整行保留）**：canonical 五页壳仍被生产路由直接消费：
   `dashboard/index.tsx`、`assets.tsx`、`jobs.tsx`、`sessions.tsx`、`search.tsx`、
   `recent.tsx`，以及 `assets_/$assetId.tsx`、`jobs_/$jobId.tsx`、
   `sessions_/$sessionId.tsx` 三条详情路由。T32 works 结果面没有接管这些入口；
   删除前必须先完成 IA 归属判定，T38 不把它们擅自改指 works/Result Center。
4. **`p1/operations-view-model.ts` 建议移出 1D 删除清单**（2 个路由挂载消费者，以 §1 末行为准）。
5. **`p1/canvas-name.ts` 的「作品」词**（§5 末段）。
6. **发现的既有死代码（本票未删，按纪律只报告）**：
   `components/product/mobile-progress-target.ts` 的 `mobileProgressTarget` 全库仅被自身测试消费，
   无任何组件渲染 `data-testid="mobile-progress-entry"`——移动端进度入口链在本票之前即已断。

## 9. 本票没有做的删除

按票面「本票只做换壳与消费面收敛，真删归 T38」，以上文件**一行未删**。
本票的改动是：四条路由壳重写为跳转、入口常量与锚点改指、商家文案对齐、两道静态门、e2e 迁址与显式降级。
