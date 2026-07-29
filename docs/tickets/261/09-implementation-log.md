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
| L4 | `a36d4553` | 执行确认卡 ＋ 成本即时反馈 ＋ CNY 泄漏清账 |
| Step 6 | `4952c79e` | 评价条 ＋ 后续动作 chip（impl-step6 产出 ＋ 我补的端口与挂载测试） |
| Step 7 | `2798d237` | 评价事件适配层（impl-step7 产出 ＋ 我补的宿主接线） |
| J10 | `0665a6ff` | `ImageAdjustConfirmation` 退役收编（#264FE 合入后解锁） |

> commit 号为 rebase 到 `main@5e96f555` **之后**的值。

**Step 6/7 的头号发现**：两者交付时都是「建了但没挂」——`composer-delivery-card.tsx` 长出了 `onRate`／`onFollowUp` 两个端口，而全仓唯一渲染它的 `composer-conversation.tsx:299` 两个都不传，`emitDeliveryRatingEvent` 全仓零调用点。即评价条与 chip 在商家面**一次都不会出现**，评价事件**一条都不会发**。这正是 D-150「组件已建未挂载＝未完成」与 U04 删 `ComposerBriefChips` 的同一失效模式；组件级测试抓不到它，因为 props 是测试自己传的。已补：端口贯穿 `ComposerConversation`、宿主 `composer-home.tsx` 两个回调、以及**从容器出发**的 `composer-delivery-mount.interaction.test.tsx`（含宿主侧源码守卫，变异验证：宿主不传端口 → 红）。

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

### J8 · 渲染件与纯投影**不同名**

设计稿 `02 §1.2` 给的是 `execution-confirm-card.ts` ＋ `execution-confirm-card.tsx` 同名一对。同 basename 的 `.ts`/`.tsx` 解析有歧义，仓内既有先例是 `brief-surface.ts` ／ `brief-surface-panel.tsx`。故渲染件取 `execution-confirm-card-panel.tsx` 与 `execution-cost-feedback-line.tsx`，其余一字不改。

### J9 · G3「已过」不等于成功分支能做

门 G3 断的是 `settledUnits` **已在合同面**（`packages/contracts/src/product-quote.ts:211`）。实测：全仓除 `apps/core` 的账本写入端外**没有任何浏览器可读的投影**吐这个字段。因此 `02 §9.1` 的 **X1/X2 依旧成立**——成功路径「本次实际消耗」仍卡 #248。

处置：`projectExecutionCostFeedback` 的 `'settled'` 分支**写完并纯测通过**，但取不到数时**返回 null（什么都不说）**，绝不用预占数冒充结算数。#248 到位后只需在调用点喂一个 `settledUnits`，投影与测试一行不动。

### J10 · `ImageAdjustConfirmation` 的退役**本轮不做**，只清 CNY

`02 §5.4` 要求把它吸收进 `ExecutionConfirmCard` 并 `git rm` 两个文件。改造点在 `src/routes/dashboard/results_/$workId.tsx`——**这正是 #264FE 正在退役视频编辑面的那个文件**（门 G4 至今未过）。在属主未落地时改同一个文件是 runbook 明禁的抢面。

故本轮只做 D1 明写的「附带必修」：把 `${confirmedAmount} ${currency}` 换成桶单位句，并把其交互测试的 `'整组 2 张·4 CNY'` 断言改成 **正向断桶单位 ＋ 负向断全对话框无币种**（fixture 里 `confirmedAmount: 4` 与 `currency: 'CNY'` 两个字段**故意保留**，这样「不许泄漏」这条是真被守着，不是因为数据没了才过）。变异验证：把币种拼回去 → 该测试红。

**退役动作整条留给 #264FE 合入之后**，连同 `result-route-live-wiring.static.test.ts:47` 的 `/ImageAdjustConfirmation/` → `/ExecutionConfirmCard/`。

### J11 · 门检 G4 探针写错，把已开的门判成关的

原 G4 验 `apps/core/.../video-regeneration.ts` 的 `videoRegenScopes` 是否清空。但 #264 分**两半**：FE 半（商家侧编辑入口摘除）已于 `43238d5f` 合入并进台账，**core 半仍等 C2 明文开工**。拿 core 半当判据 → 永远为假。#261 的串行前序只是 FE 半（spec `:601` 语义锁锁的是「前台创作面」）。已改验 FE 半真正交付的面：`mkfast-template-main/src` 内无 `subtitle_text_edit|cover_select`。**门检现 6/7**，仅剩 G3b（#262）。

这是本票第四次同类探针错误（前三次：G3b 误匹配、G5 误计文档提交、G6 自锁）。共同教训：门的判据必须指向**该票真正交付的那个面**，指向邻近但不同属主的产物就会稳定说谎。

### J12 · 退役时把「它是个模态」一起弄没了，已回补

`ImageAdjustConfirmation` 是一个 `Dialog`：Escape 关闭、`finalFocus` 把焦点还给 `#result-adjust-input`。`ExecutionConfirmCard` 是一个 `<section>`。直接对换等于**静默去掉焦点归还与 Escape**，并让 `shell-visual-contract.test.ts:196` 的三条模态保证失去活的对象。

处置：**保留 Dialog 外壳、只换卡体**——「一个决定一张卡」说的是卡的内容与形状，不是要把模态改成内联。`shell-visual-contract` 的三条断言改读 `$workId.tsx`（外壳搬到哪就跟到哪），不是随旧文件一起删掉。

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
| **R5** | 确认卡插在 **Brief 之后**（安全确认 → 花费确认，两卡先后出现） | 已按 `02 §7.2` 实施 | 商家在一次提交里会连看两张卡。点击数没增加（两处都是既有拦截位），但**观感上是两跳**；若主控认为该合并，那是改 D-164③「不新增卡类型」的边界，须先裁 |
| **R6** | ~~`ImageAdjustConfirmation` 退役排期~~ | **已办**：#264FE 合入（`43238d5f`）解锁，`0665a6ff` 完成收编，`git ls-files` 空 | 台账那行明写「#261 J10 退役残项就此解锁」，无需再裁 |

---

## 四、并发与环境事实（关票时须如实带上）

1. **impl-step6 / impl-step7 两个 agent 与我共用 `lane-261` 这一个 worktree**，违反 runbook「每 lane 独立 worktree」。其产出（`composer-delivery-*`、`delivery-*`、`product-telemetry.ts`、7 条 `delivery_*` i18n 键）**目前仍未提交**，我提交前逐次把它们从暂存区剔出，我的 5 个 commit 不含其代码。合入前需要主控确认这批改动的归属与提交方式。
2. **`pnpm test` 目前有一条红，与本票无关**：`e2e-hard-gate-contract` 要求 `specs/uiux-creation-loop.spec.ts` 带 `M-04 DEMOTED` 头。核过——**main 已在 `c433ee7f` 之前把该 spec 从 `SPECS_WITH_DEMOTED_CASES` 移除**，本 lane 基点 `89da942c` 落后 10+ 个 commit 才留着这条。**rebase 到 main 头即消失**，不是本票引入的缺陷。rebase 尚未做，因为 worktree 里有另外两个 agent 未提交的改动。
3. **Step 1 的 i18n 键当时插错了字节序**（`legacy_projection_history_jobs_readonly_notice` 排到了 `..._navigation_aria` 之后）。已在 Step 4 的 locale 改动里顺手纠正，`pnpm locale:check` 现为 rc=0。

---

## 五、当前验证状态（rebase 到 `main@5e96f555` 之后，全部重跑）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | rc=0 |
| `pnpm check`（Biome 只读） | rc=0 |
| `pnpm test:interaction` | 43 files / 259 tests 全绿 |
| `pnpm test` | **rc=0 全绿**（此前那条红确系落后基点，rebase 后消失） |
| `pnpm locale:check` | rc=0 |
| 门检 `./docs/tickets/261/gate.sh` | **6/7**，仅剩 G3b（#262 三轴钉扎） |
| `pnpm e2e` | **未跑**。三段顺序、`?view=` 重定向、复用 chip、pill 行四处证据落在 e2e，须由主控或本 lane 补跑 |

变异验证（每条新断言都实证过能红）：段序 testid 对调 → `dashboard-home-contract` 红；段③ `isError` 短路 → 错误态测试红；未完成优先排序反转 → 排序测试红；空组不再剔除 → 分组＋交互测试各红；分组键改回 cardKey → 分组测试红；pill `aria-label` 去掉动作标签 → 两交互测试红；确认卡 props 加 `onParamChange` → **tsc 直接红**（只读是编译门不是纪律）；纠偏卡把币种拼回去 → 泄漏测试红；宿主不传评价端口 → 挂载守卫红。

### J13 · `uiux-shell-routes.spec.ts` 在 main 上就有两条红，与本票无关

跑 e2e 证据时撞上，两条都能**静态证伪**、且 `git diff --name-only main...HEAD` 均未命中相关文件：

| 断言 | 期望 | 实际 | 静态证据 |
|---|---|---|---|
| `:42` 产品品牌 token | `oklch(0.78 0.14 166)` 等四值 | `oklch(0.63 0.13 18)` 等 | `src/styles.css:179` 的 `--product-brand` **就是**收到的那个值；全文只有这一处定义。测试期望的是陈旧值 |
| `:151` `/dashboard/assets` 的 h1 | `资产库` | 找不到 | `资产库` 在 `src` 与 `zh.json` 里**零命中**，应用从不渲染这个字符串 |

两条都不属本票属主面（主题 token／素材页标题），**不擅自改**，报主控另行处置。

**对本票的影响**：`?view=` 重定向的证据原本挂在 `:112` 那条二十条路由的循环里，而循环在 `/dashboard/assets` 就断了，走不到我的两行。已把该证据**摘出来独立成测**（`a legacy ?view= link lands on the route that owns the view`），顺带断「重定向后 URL 真的换了」与「工作台不再同屏渲染」——原来的写法只断目的地标题，换句话说旧写法即使不重定向、只要页面上碰巧有那个标题也能过。

顺带确认：**导航断言（含新增的「记忆」）已实跑通过**——红发生在其后的 `:42`，说明 `:27` 的 `businessNavigation` 五项比对是绿的。

## 六、本票**未**交付的部分（关票时必须如实列出）

1. **L5 三轴真值**：卡 G3b／#262。评价事件当前**每次都发不出去**，但每次都留一条 `ObservabilityDropEvent` 作负向证据——不是静默失败。
2. **成功路径「本次实际消耗」**：卡 #248。`settledUnits` 只在 core 账本，无浏览器投影；`projectExecutionCostFeedback` 的 `settled` 分支取不到数时**返回 null 什么都不说**，绝不拿预占数冒充结算数。
3. **记忆页四域里的三域**（纠正／项目／工作流）：只出「这项还在建」占位。纠正等 #251；**项目域全仓无实体、属主未定**（`00-blockers.md 四·补`）。
4. **模型档位的商家语言 hint**：等 #252 能力词表，v1 只显示 `displayName`、hint 为 null。
5. **e2e 未跑**（见上）。
