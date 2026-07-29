# #261 施工记录：实施期新出现的判断与待裁项

> 本文只记 **设计稿里没有、施工时才冒出来** 的判断。设计依据仍以 `01`–`04` ＋ 裁定 `08` 为准。
> 分支 `issue-261`，基点 `main@89da942c`。**不 push、不关票。**

---

## 一、已落地的步骤

| 步 | commit | 内容 |
|---|---|---|
| Step 1 | `7e3597e6` | D-137 历史/Job 只读文案（两条 i18n 键 ＋ 3 条交互测试） |
| Step 5 | `0910bfdc` | 记忆一级导航（第 5 个导航项 ＋ `/dashboard/memory` ＋ 四域骨架） |
| Step 2 | `fd43c3e5` | `?view=` 收敛为重定向，`/dashboard` 不再是第二落点 |
| Step 3 | `622921bc` | 单路由三段 提议 → 创作 → 继续（段③ 新建） |
| Step 4 | `212e1efd` | 第二层 Skill pill 行（五类宣发任务分组） |

Step 6（评价条 ＋ 动作 chip）与 Step 7（评价事件适配层）由并行 agent 在**同一 worktree** 内产出，尚未提交——见 §四。

---

## 二、施工期作出的判断（设计稿未裁）

### J1 · `recipe-card-grid.tsx` 删除，二阶孤儿只报不删

pill 行替换网格后 `RecipeCardGrid` 无任何产品消费者。按 CLAUDE.md 「自己改动造成的孤儿要清」删除该件与其 barrel 导出，D-083/D-084 的活条款迁到 pill 行重新断言（`recipe-pill-row.static.test.ts` ＋ `mobile-catalog.interaction.test.tsx`）。

**但删除会往下级联**：`ItemCard`/`ItemCardGroup` 随之只剩 `routes/heroui-spike/`（vendor spike，非产品面）一个引用，`heroui-glass.css` 的 `.meiye-item-card-stack` 段随之无调用者。这两件是 **U04 的资产**，退役与否是 U04 的裁量，不是本票的。**已在 `recipe-pill-row.static.test.ts` 的文件头写明「本票不删、留给 U04」**，请主控决定是否另开票。

### J2 · pill 的 testid 沿用 `composer-recipe-card-{cardKey}`

testid 命名的是**配方入口**而非它的画法，且五条 e2e 旅程（`image-text-note-compiler` / `image-intent-service-journeys` / `s3-money-journey` / `video-native-compiler` / `works-reshell`）都靠它点进配方。改名等于借换壳之名改契约。row 另给 `composer-recipe-pill-row`，分组给 `composer-recipe-pill-group-{taskId}`。

### J3 · 不新增「看全部做法」出口

`01 §4.5` 要求「实现时先核对 `composer-tools-strip` 现文案，重复则复用不新增」。核过：现有出口文案是「查看全部创作工具」，目的地同为 `/dashboard/catalog`。**同屏两条链指向同一页即是该条要防的重复**，故不新增，`composer_recipe_pill_view_all` 键也不建。本票不改工具条文案（属 rule 3 的邻域，不动）。

### J4 · 分组键不写进 seed，直接按 familyId 静态映射

`01 §4.4` 原方案要给 `LaunchCardSeedSpec` 加 `marketingTask` 字段供冷态兜底。核过：冷态 seed 与浏览器投影**两条路径都带 `familyId`**（`seedToRecipeTarget` / `browserRecipeToTarget`），一张 familyId→任务表即可覆盖，加字段是多余的第二真相。未命中的 familyId **落「项目 / 服务曝光」并 dev 下 warn，绝不静默丢卡**。

### J5 · 分组容器用 `fieldset/legend`，不是 `div role="group"`

Biome 的 `a11y/useSemanticElements` 直接拒绝后者。原生一对同时给出分组语义与可见标题，`aria-label` 仍按 `01 §4.5` 覆盖为整句「{组}相关的做法」。

### J6 · `RecipeCardsPanel` 的 `onReuseRequested` 一并删除

pill 行不渲染 reuse collection 卡，该回调在本仓再无触发路径。复用入口活在 PromptBar 的复用 chips（`composer-conversation.tsx` ＋ `COMPOSER_REUSE_CHIPS`），既有交互测试与 e2e 均已覆盖，入口未丢。

### J7 · `dashboard-home-contract.test.ts` 的段序断言改写而非删除

原断言 `Composer < DashboardHomeSurface`，理由挂 PRODUCT.md 原则 1。**D-164① 明写三段自上而下，正面推翻该序**。改写为断四段锚点顺序（问候 → 提议 → 创作 → 继续）并额外断「每段真的装着它冠名的面」，避免三个空 `<section>` 也能过。原则 1 的存续形态按 `01 §3` 的裁定＝**移动端压密度而非改顺序**，那半条在移动端 e2e 上守，不在源码序上守。

---

## 三、待主控裁定

| # | 事项 | 我的处置 | 为什么要你裁 |
|---|---|---|---|
| **R1** | **D-083 形变**：pill 只显示 title，「动作标签常驻可见」移入 `aria-label` | 已按 `01 §4.5` 实施，并在组件头与静态测试里写明这是唯一形变 | 这是对**已拍板决策**的偏离，不该由施工方自行放行 |
| **R2** | U04 二阶孤儿（`ItemCard` 单元 ＋ `.meiye-item-card-stack`） | 保留不删，写明理由 | 跨票资产，退役是 U04 的裁量 |
| **R3** | 热点借势 / 品牌与个人 IP 两组零配方 | 不渲染空组 | 真实产品缺口，需要排配方而不是排 UI |
| **R4** | 段③「继续上次工作」的数据面 | 复用 `creative_workbench` 投影同一 query key，零新增后端面 | 若主控希望它读别的投影，现在改成本最低 |

---

## 四、并发与环境事实（关票时须如实带上）

1. **impl-step6 / impl-step7 两个 agent 与我共用 `lane-261` 这一个 worktree**，违反 runbook「每 lane 独立 worktree」。其产出（`composer-delivery-*`、`delivery-*`、`product-telemetry.ts`、7 条 `delivery_*` i18n 键）**目前仍未提交**，我提交前逐次把它们从暂存区剔出，我的 5 个 commit 不含其代码。合入前需要主控确认这批改动的归属与提交方式。
2. **`pnpm test` 目前有一条红，与本票无关**：`e2e-hard-gate-contract` 要求 `specs/uiux-creation-loop.spec.ts` 带 `M-04 DEMOTED` 头。核过——**main 已在 `c433ee7f` 之前把该 spec 从 `SPECS_WITH_DEMOTED_CASES` 移除**，本 lane 基点 `89da942c` 落后 10+ 个 commit 才留着这条。**rebase 到 main 头即消失**，不是本票引入的缺陷。rebase 尚未做，因为 worktree 里有另外两个 agent 未提交的改动。
3. **Step 1 的 i18n 键当时插错了字节序**（`legacy_projection_history_jobs_readonly_notice` 排到了 `..._navigation_aria` 之后）。已在 Step 4 的 locale 改动里顺手纠正，`pnpm locale:check` 现为 rc=0。

---

## 五、当前验证状态（截至 Step 4 提交）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | rc=0 |
| `pnpm check`（Biome 只读） | rc=0 |
| `pnpm test:interaction` | 42 files / 252 tests 全绿 |
| `pnpm test` | 1 红 ＝ §四.2 的落后基点，其余全绿 |
| `pnpm locale:check` | rc=0（3995 键） |
| `pnpm e2e` | **未跑**。三段顺序、`?view=` 重定向、复用 chip 三处证据都落在 e2e 里，须在 rebase 后由主控或本 lane 补跑 |

变异验证（每条新断言都实证过能红）：段序 testid 对调 → `dashboard-home-contract` 红；`isError` 分支短路 → 段③ 错误态测试红；未完成优先排序反转 → 段③ 排序测试红；空组不再剔除 → 分组测试 ＋ 交互测试各红；分组键改回 cardKey → 分组测试红；`aria-label` 去掉动作标签 → 两个交互测试红。
