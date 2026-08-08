# T32 作品与对象页换壳 — 「旧页 → 新面」替代对照表

票：T32 / issue #226（Spec #194；归桶矩阵 §3 old-ia-reshell 两行）
分支：`legacy-origin-a/t32-works-reshell`
用途：**T38 条件删除批（1D）第三段清单的逐行核对依据**。本票只交付替代面，不删旧页。

删除谓词（矩阵 §1 实现决定 1）：`1D ＝ 换壳票组全部合入 ＋ 旧页零路由引用`。
下表第 4 列即「本票交付后该旧页还剩谁引用」，T38 逐行确认为空后才可 `git rm`。

## 1. 旧页 → 新面对照

| 旧页（归桶矩阵行） | 旧页职责 | 新面替代物 | 本票交付后的剩余引用 |
| --- | --- | --- | --- |
| `src/product/canonical-history-page.tsx` | 作品/最近/搜索/素材/会话/任务六模式聚合列表 | `src/product/works/works-list-page.tsx`（作品列表，四类输出统一呈现） | **仍被引用**：`routes/dashboard/{index,recent,search,assets,assets_/$assetId,sessions,jobs}` ＋ `product/canonical-object-route-page.tsx`（取 `CanvasImageJobDetailPage`）＋ `routes/dashboard/assets.test.tsx`。works 模式已零引用 |
| `src/product/canonical-object-route-page.tsx` | works/jobs 对象路由分派（canvas work vs creative work） | `src/product/works/works-detail-page.tsx`（按 canonical projection 分派 package / canvas / missing） | **仍被引用**：`routes/dashboard/jobs_/$jobId`（`CanonicalJobRoutePage`）。works 分支已零引用 |
| `src/product/creative-object-page.tsx` | Work/Job 对象详情（旧 shadcn ＋ named-legacy 文案键） | `works-detail-page.tsx` 的 package 分支（成品 revision／媒体画廊／生成依据／使用导购／动作） | **仍被引用**：`canonical-object-route-page.tsx` ＋ `routes/dashboard/sessions_/$sessionId.tsx` |
| `src/product/canonical-media-gallery.tsx` | 作品/对象媒体画廊 | `src/product/works/works-media-gallery.tsx` | **仍被引用**：`canonical-history-page.tsx`（随该文件一起退场） |
| `src/product/canonical-asset-actions.tsx` | 素材捕获与治理动作 | 本票**不替代**：素材面属 assets 路由，不在作品面职责内 | **仍被引用**：`canonical-history-page.tsx`。归属 T34／T38 收口 |
| `src/product/canvas-work-page.tsx` | 轻编辑页面壳（LightComposerCanvas 外层） | `src/product/works/works-light-edit-page.tsx`（同一批 canonical 命令，Glass 壳） | **仍被引用**：`canonical-object-route-page.tsx` ＋ `src/lib/product-surface-contract.test.ts`（断言 `canvasName(work.name)` 口径，删除时需把断言改指新壳） |
| `src/p1/canvas-name.ts`、`src/p1/canvas-product-assets.ts`、`src/p1/canvas-library.ts` | 轻编辑命名与素材库适配 | **不替代，继续使用**：`canvas-library.ts` 是 KEEP 能力核 `light-composer-canvas.tsx` 的类型依赖；另两个是纯逻辑助手，新壳照用 | 新面 ＋ 能力核。**建议 T38 把这三行移出删除清单** |
| `src/product/legacy-content-package-projection.ts` | 旧 ContentPackage 状态投影（named-legacy） | 新面零引用；作品状态直接读 `contentPackageStatusLabel` | **仍被引用**：`canonical-history-page.tsx`（随该文件一起退场） |

## 2. 路由切换结果

| 路由 | 换壳前 | 换壳后 |
| --- | --- | --- |
| `/dashboard/works` | `CanonicalHistoryPage mode="works"` | `WorksListPage` |
| `/dashboard/works/$workId` | `CanonicalWorkRoutePage` → `CanvasWorkPage` / `CreativeObjectPage` | `WorksDetailPage`（`?exportCarrier=` 直达 `WorksLightEditPage`） |

静态断言：`scripts/uiux/works-canonical-projection-guard.mjs`（挂在 root `pnpm check`）
断言两件事——新面零 named-legacy 投影引用、零 delete-after-reshell 模块 import；
以及 works 两条路由必须渲染 `@/product/works` 且 routeTree 保有两条 works 路径。

## 3. 交给 T38 的收口项（本票越界，未动）

1. **`/dashboard/?view=works`**：`routes/dashboard/index.tsx` 在桌面端仍以
   `search.view==='works'` 渲染 `CanonicalHistoryPage`。该文件属 T29 属主，
   coordinator 裁定留给 T38 删除批收口（决策见 msg_71121f4c33d1）。删除
   `canonical-history-page.tsx` 前必须先摘掉这个分支。
2. **`/dashboard/jobs_/$jobId`**：仍走 `CanonicalJobRoutePage` → `CreativeObjectPage`。
   Job 不是商家一级对象（ADR-0011 D07），换壳组内无票承接；T38 需决定是随批下线
   还是转由 Result Center 承接。
3. **assets／assets_/$assetId／recent／search／sessions／jobs 六条路由**：仍消费
   `CanonicalHistoryPage`（sessions_/$sessionId 消费 `CreativeObjectPage`），
   属 T33／T34 属主面，删除必须排在它们之后。
4. **`canonical-asset-actions.tsx`**：作品面不承接素材治理，删除依赖 assets 面换壳。

## 4. 本票没有做的删除

按票面「旧五页与 canvas-work 壳本票不删」，以上文件一行未删、一行未改。
新面为净新增目录 `src/product/works/`，旧页保持原样运行。
