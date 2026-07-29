# #261 反向复核 · 设计稿 → 现状（取反驳立场）

> 复核对象：`01-ia-three-sections.md` / `02-confirm-card-and-cost.md` / `03-rating-memory-events.md` / `04-events-memory-nav.md`
> 复核基准：**`main@7f60a4e7`**（四稿自述基点均为 `main@cc04918d`，其后 main 前进 34 个提交，含 #266 与 #248）
> 立场：默认判设计稿错，由复核方证伪。只读，未改任何源码与既有 md。
> 方法：每个 `file:line` 用 `git show main:<path>` 逐行取原文比对；负向断言用 `git grep` 全仓穷举。

---

## 一、锚点证伪结果

**去重后共提取 `file:line` 锚点约 160 个，逐个上 `main` 验证 153 个（另 7 个未能验，见 §四），发现有问题 44 个。**
其中 **9 个**是 main 前进造成的漂移（A 组），**35 个**在基点 `cc04918d` 上就已经错（B 组）。

### A 组 · main 前进造成的漂移（写作时对，现在错）

| # | 设计稿位置 | 声称 | main 实际 | 判定 |
|---|---|---|---|---|
| A1 | 04 §3.2 | `apps/core/src/p1/skills/types.ts:184` ＝ `skillRevisionRef(skillId, revision)` | 该函数在 **`:244`**；`:184` ＝ `settlementStatus: 'settled' \| 'over_budget'`。`cc04918d` 上确在 `:184` | **行号漂**（函数与语义仍在，仅位置变）。验证：`git show main:apps/core/src/p1/skills/types.ts \| grep -n skillRevisionRef` |
| A2 | 04 §3.2、§3.4 | `langfuse-sender.ts:278-279` ＝ `promptName`/`promptVersion` 嵌套 metadata | 该两行现在 **`:280-281`**；`:278-279` ＝ `if (!prompt \|\| !metrics) return [];` / `const common = {`。`cc04918d` 上确在 `:278-279` | **行号漂**（+2） |
| A3 | 04 §3.2 / §3.3 注释 / §3.4 / §7.2，共 **4 处** | `packages/contracts/src/uiux.ts:44` ＝ `creativeExecutionContractSchema.catalogRevision` | 现在 **`:48`**；`:44-47` 是 #248 新插入的 4 行注释（「This is not the observability event-attribution field with the same key」）。`cc04918d` 上确在 `:44` | **行号漂**（+4）。语义反而被上游加注强化，04 的告警成立 |
| A4 | 04 §4.3 | `apps/core/src/main.ts:1604` 挂载 `MarketingIdentityFoundationModule` | 现在 **`:1622`**；`:1604` ＝ `providerCredentialOperator`（属 `IntegrationsFoundationModule`）。`cc04918d` 上确在 `:1604` | **行号漂**（+18） |
| A5 | 01 头部 | 决策文档 `:3138-3145` ＝ D-164「影响」段 | 「### 影响」现在在 **`:3145`**，该段 `:3145-3152` | **行号漂 +7**（见 §三 O1：`:3138-3144` 现在是新插入的用户拍板裁定） |
| A6 | 01 §4.1 | `:3142` ＝「D-139 配方卡目录的前台排布形态按本条②参照 pill」 | 该句现在 **`:3149`**；`:3142` 现在是新裁定的「证据前提限定」行 | **行号漂 +7**（引文内容仍逐字成立） |
| A7 | 01 §8③ | `:3152` ＝「本条①②④⑤ 为产品裁定，无实现证据」 | 该句现在 **`:3159`**；`:3152` 现在是「实施：Dashboard 挂载归 D-127 NEW 桶」 | **行号漂 +7** |
| A8 | 01 §2.3、§8③ | `:3158` ＝「三段结构在移动端的信息密度与滚动体验」未验 | 该句现在 **`:3165`**；`:3158` 现在是「领域轴对本项目是空轴…未经真实商家验证」 | **行号漂 +7** |
| A9 | 01 头部 | `:3153-3154` ＝ 证据边界段 | 「### 证据边界」现在在 **`:3154`**（`:3153` 为空行），段落 `:3154-3165` | **边缘命中**，范围已不覆盖该段 |

### B 组 · 在基点上就已经错

| # | 设计稿位置 | 声称 | main 实际 | 判定 |
|---|---|---|---|---|
| B1 | 03 §1.4、§2.6；04 §6.3 N2，共 **4 处** | `DESIGN.md:191` ＝「触屏最小命中 44px」 | `:191` ＝ `### Buttons`（小节标题）。44px 那句在 **`:192`** | **行号错**（-1）。事实成立，锚点错，且被四处复用 |
| B2 | 03 §1.4 | `DESIGN.md:196` ＝ focus ring「全壳一档」 | `:196` ＝ **Destructive 按钮**条目。`git grep 'focus-visible\|ring-ring' main -- DESIGN.md` **零命中** | **语义不符 + 无此依据**。DESIGN.md 全文没有 focus ring 条款；03 该行的 `mobile-nav.tsx:12` 部分才是真依据 |
| B3 | 02 §1.3、§4.1、§4.5，共 **3 处** | `image-adjust-confirmation.interaction.test.tsx:37` 断言字面量 `'整组 2 张·4 CNY'` | 该断言在 **`:34`**；`:37` ＝ `fireEvent.click(getByRole('button',{name:'确认并生成'}))` | **行号错**。CNY 泄漏事实**成立**（`:13 confirmedAmount:4`、`:14 currency:'CNY'`），只是锚点错 |
| B4 | 02 §5.4 | `image-adjust-confirmation.tsx` 与其**两个**测试文件退役 | `src/product/results/` 下只有 **一个** 相关测试：`image-adjust-confirmation.interaction.test.tsx` | **数目错**。按稿执行会去删一个不存在的文件 |
| B5 | 01 §4.4 | `BrowserRecipeProjection.familyId` 在 `recipe-cards.ts:97` | `:97` ＝ `return (`。`familyId` 真身在 **`packages/contracts/src/creation-experience.ts:164`** | **文件与行号都错**。结论（有 familyId 可做静态映射）成立 |
| B6 | 03 §2.2；04 §4.3 | `recipe-cards.ts:57 listColdCardsFromSeeds` | 函数在 **`:58`**；`:57` ＝ 空行 | 行号错（-1） |
| B7 | 03 §2.2；04 §4.3、§附 | `recipe-cards.ts:104 listColdCardsFromRecipes` | 函数在 **`:107`**；`:104` ＝ 注释「Collapse eight published recipes into six cold cards.」 | 行号错（-3） |
| B8 | 03 §2.2；04 §4.3 | `launch-card-seeds.ts:101` ＝ `LAUNCH_CARD_SEEDS` | 常量在 **`:86`**；`:101` ＝ 某条 seed 内部的 `notePageBound: 3,` | **语义不符**。01 §4.1/§4.4 同一常量写的是 `:86`（对） |
| B9 | 03 §2.2 | `launch-card-seeds.ts:84` ＝ `LaunchCardSeedSpec` 类型 | 类型在 **`:70`**；`:84` ＝ `};` | **语义不符**，且与 01 §4.4 的 `:70`（对）**稿内互相矛盾** |
| B10 | 03 §2.2 | `RecipeCardView`（`recipe-cards.ts:34-51`） | 起始在 **`:33`** | 行号错（-1） |
| B11 | 02 §2.2、§3.2 | `quote-wiring.ts:46` ＝ `billingNote` | 字段在 **`:49`**（`:48` 是其注释）；生成「按生成成片 N 秒计费」的代码在 `:149-152` | 行号错（-3） |
| B12 | 02 §3.2 | `video-confirm-zone.ts:63-65` ＝ 已有的「按生成成片 N 秒计费」 | 该模板串在 **`:59-61`**；`:63-65` ＝ `return { visible: true,` | 行号错 |
| B13 | 02 §7.2 | `evaluateSubmitGate`（`video-confirm-zone.ts:105-118`） | 函数声明在 **`:82`**；`:105-118` 在函数体内 | **范围起点错**（结论成立） |
| B14 | 02 §4.3 | `product-quote.ts:120` ＝ `settledAmount` | 字段在 **`:121`**；`:120` 是其注释 | 行号错（-1） |
| B15 | 03 §2.5 | `composer-home.tsx:2779-2781` ＝ `setLensState(updateUserText(selectLens(...)))`；`:2779` 把 lens 硬编码为 `'copy'` | 该表达式在 **`:2780-2782`**；`'copy'` 字面量在 **`:2781`**；`:2779` ＝ 注释行 | 行号错（-1 / -2）。结论（推荐卡硬编码 copy、chip 必须传自身 lens）**成立** |
| B16 | 01 §5 | `canonical-history-model.ts:350` ＝ `canonical_history_session_title()` | 该调用在 **`:352`**；`:350` ＝ `id: session.id` | 行号错（-2） |
| B17 | 01 §7.1 | `data-recommendation-state`「既有属性，`:224`」 | 该属性在 **`:223`**；`:224` ＝ `data-testid="today-recommendation"` | 行号错（-1）。两个属性都存在，断言可用 |
| B18 | 04 §3.5、§7.4 | `product-telemetry.ts:94` 对字符串 `.slice(0, 120)` | `.slice(0, 120)` 在 **`:95`** | 行号错（-1） |
| B19 | 04 §3.5 小节标题 | 「### **128** 字符与截断」 | 通道实际截断为 **120**（正文写对，标题写错） | **稿内自相矛盾**，须改标题 |
| B20 | 04 §4.3 | `preferenceSchema` 的 `evidenceDecisionIds:319` | 在 **`:327`**；`:319` ＝ `candidateId: idSchema`。`:306` 是 `preferenceCandidateSchema` 的同名字段（另一个 schema） | 行号错（-8），且相邻处存在同名字段易误引 |
| B21 | 04 §5.3 | `preferenceSignalSchema` 带 `.strict()`（`reuse-memory.ts:296`） | `.strict()` 在 **`:297`**；`:296` ＝ `})` | 行号错（-1）。`:294` kind 枚举 `['adopted','modified','rejected']` **逐字正确** |
| B22 | 04 §4.3 | `BrowserSurfaceProjection.recipes`（`creation-experience.ts:227`） | `recipes` 在 **`:228`**；`:227` ＝ `contentHash: string;` | 行号错（-1） |
| B23 | 04 §4.2① | `src/lib/routes.ts`「Dashboard routes 段，`:28-33` 附近」 | 该段实为 **`:27-38`**；稿中 diff 的插入位（`ContentLibrary`/`StoreProfile`/`ContentWorkspace`）在 **`:35/:36/:37`**，不在 `:28-33` 内 | **范围错**（diff 本身形状正确） |
| B24 | 04 §4.2⑤；03 §〇#5 | `mobile-nav.static.test.ts:38-42` ＝ id 硬断言 | id 断言在 **`:39-42`**；`:38` ＝ 上一条 `deepEqual` 的 `);`；用例名行在 **`:34`**。该 test 内其实有 **两条** `deepEqual`，稿中 diff 只呈现了一条 | **范围错 + 漏一条断言**。「四项合同」是硬门这一结论**成立** |
| B25 | 04 §7.2 | `import type { ObservabilityAxes } from '@contracts/observability'` | 全仓无 `@contracts` 别名（`mkfast-template-main/tsconfig.json:23-26` 只有 `@/*` 与 `content-collections`）；包名是 **`@meiye/contracts`**，且其 `exports` 只有 `"."`（`packages/contracts/package.json`），无子路径导出 | **不存在的模块说明符**，照抄即编译失败。04 §3.3 自己写的 `from '@meiye/contracts'` 才对——**同稿两处互相矛盾** |
| B26 | 04 §7.1 | 「逐字」引用 `packages/contracts/src/observability.ts` | 非逐字：实际把 `signal` 抽成了独立导出 `observabilitySignalSchema`（`:24-30`）再引用，稿中写成内联 `z.enum([...])`；且漏掉 `export type ObservabilityDropEvent`（`:41-43`） | **「逐字」不成立**（语义等价）。43 行契约全文我已比对 |
| B27 | 04 §4.2⑦ | 「仅 `workspace_assets_description:3953` 出现『沉淀』一词」 | zh.json 有 **两处**：`:3953` 与 `:3963`（`workspace_sample_isolation_note`） | 事实错（不影响结论：`memory_*` 与「记忆」二字确为零命中，已验） |
| B28 | 02 §1.2 | `src/product/composer/index.ts`「该文件 `:89` 已是 composer 模块的统一出口」 | `:89` ＝ `} from './settings-row';`，是 barrel 中间一行，不代表任何「出口」语义 | **锚点无意义**（文件确是 barrel，结论无碍） |
| B29 | 01 §7 | 「runbook `:17`」＝ locale:compile 不与 dev 并跑 | `docs/ops/agent-dispatch-runbook-2026-07-29.md:17` 在 main 与 `cc04918d` 上**都是空行**；该纪律实际在仓根 `CLAUDE.md` 三条铁律第二条 | **锚点错** |
| B30 | 04 §3.2 | `00-blockers.md:29` ＝ #248 三轴扁平键 | `:29` ＝ **空行**；相关内容在 `:14`（G2）与 `:35`（票面偏差 #2） | 锚点错 |
| B31 | 04 §3.6 | `00-blockers.md:63` ＝「`product-telemetry.ts` #251 埋点通道同踩」 | `:63` ＝ `### 拍板项 2 · 执行确认卡触发条件` | **语义不符** |
| B32 | 03 §2.2；04 §4.3、§5.2 | `00-blockers.md:64` / `:65` ＝「禁碰 skills 模块」「自建 correction kind 撞枚举」 | `:64` ＝ 空行；`:65` ＝「D-164『待验证』明确未定；票面要求…」 | **语义不符**（3 处） |
| B33 | 04 §6.1 B7 | `00-blockers.md:16` ＝ G4「`videoRegenScopes = ['shot']` 已摘」 | `:16` ＝ **G3b**（Task 快照三轴）；G4 在 `:17` | **门号错位**。B7 的等待对象因此也被写反（`:16` 等 #262，`:17` 才是 #264FE 面） |
| B34 | 02 §6.3、§9.3 | `quote-blocking.ts:226` | 文件名应为 **`quota-blocking.ts`**（`quote-blocking.ts` 全仓不存在）；`:226 composerQuotaRequirements` 本身正确 | **文件名错**（02 其余处写对，属笔误） |
| B35 | 01 §5.1 | 「这 **6** 个 `creation_entry_marketing_*` 目前在 `src/` 零引用」 | zh.json 有 **7** 个该前缀键（多一个 `creation_entry_marketing_secondary:1339`「继续细化场景」，稿中未处置） | 计数错。「零引用」**成立**（`git grep creation_entry_marketing main -- src tests` 零命中） |

> **B30–B33 的共同根因**：`00-blockers.md` 在 03/04 定稿后被 `3f70df54`、`2d767b09` 两次重写并改标基点为 `main@7f60a4e7`，四稿引用的仍是旧版行号。

### 全对且我逐行确证过的关键锚点（抽样，不逐条列）

`composer-home.tsx` 全部 18 个（`:395/543/674-683/1176-1183/1210/2310/2330/2506/2696/2745-2747/2764-2772/2773-2791/2754-2758` 及 4 处 `invalidateQueries :1262/1643/2676/2679`）；`routes/dashboard/index.tsx` 全部 13 个；`composer-conversation.tsx` 全部 14 个；`composer-delivery-card.tsx` 全部 11 个；`brief-surface.ts` 7 个（含 `:85` 四态枚举、`:63` 七码、`:295-308`、`:421`、`:539-542` 逐字命中）；`reuse-panel-retirement.static.test.ts:104-113` 与 `result-route-live-wiring.static.test.ts:47` **逐字命中**；`provider-cost-snapshot.ts:16-32` 无 stage 字段、`product-usage-ledger.ts:4-5`、`server-quote-authority.ts:155-162`、`product-quote.ts:61/76/88`、`harness.ts:53` 四值枚举、`reuse-memory.ts:294` 三值枚举、`observability.ts` 全 43 行、`creation-experience-events.ts:58/95-101/106`、`creationExperienceEventKinds` 七类、`CREATION_EVENT_ACTION_IDS` 八值、`skills/foundation-module.ts` 五条命令（`:64/102/108/127/134`）——全部与稿一致。

**负向断言全部证实**（我用 `git grep` 全仓穷举复跑）：`planCost/planningCost/planning_cost` 0 命中；`meiye:telemetry` 仅 `product-telemetry.ts:107` 的 dispatch 自身、零监听方；`src/routes/api/` 无遥测 ingest 端点；`packages/contracts/` 无 campaign/project 实体；`apps/core/src/p1/skills/` 无 `P1QueryModule`；`readCreationDraftIntent` 生产零消费方（仅定义 + 单测）；`src/product/results/image-role-feedback.tsx` **确不存在**（03 §〇#4 成立）；zh.json 无 `memory_*`、「记忆」零命中；`作品历史` 只在那条 e2e 断言与 ledger 文档里，zh.json/src 均无（01 §0 的「既有假绿」成立）。

---

## 二、跨稿语义冲突

**查过的交叉点（8 个）与结论**：

| # | 冲突面 | 哪两份 | 各自主张 | 真互斥？ | 建议裁定 |
|---|---|---|---|---|---|
| **C1** | `src/lib/uiux/navigation.ts:10`＋`mobile-nav.tsx:55`＋`sidebar-config.ts:50-58`——**D-164④ 在不在 #261 范围内** | **01 vs 03/04** | 01 头部：「**④ 明确不做**——`navigation.ts:10` 的四项与 `mobile-nav.tsx:55` 的 `grid-cols-4` **本票一律不动**」，01:463 再确认「本票不动这三处，只作交接备忘」／04 §4.2 逐文件给出五处 diff（含改「nav 四项合同」断言），03 §〇#5 把它列为必踩硬门 | **是，硬互斥**。同一票、同三个文件、一方明令不动一方全改 | **判 01 错**。三条反证：①`00-blockers.md §二#5` 把 mobile-nav 四项合同列为 #261 待处置的票面偏差；②03 的「范围」行明写含 D-164④；③决策文档 `:3161`「Miora 当前 v2 一级导航实测为『创作／灵感／技能／记忆』…**本条④的方向获同向佐证**」。→ 删掉 01 头部那句，把 01:463 从「交接备忘」升格为「同批，见 04 §4.2」 |
| **C2** | `composer-home.tsx:2764-2772` 那 **8 行注释** | **01 vs 03（＋04）** | 01 §2.3/§8③：段① 上移后「**该注释须随改动一并重写**，不能留着与新排布互相打脸」／03 §2.5：把 "Both CTAs" 改成三处，并声明「**这是本票唯一允许修改的既有注释**」／04 §附 重复 03 的改法 | **是**。「唯一允许修改」与「必须重写」不能同时为真；且两种改法落在同一个 git hunk | 03 的「唯一」一句删除。注释属主给 01（它做布局重排、注释的产品判断被它推翻）；03/04 只在 01 重写后的文本里追加「三处 CTA」措辞。票下需留一条记「谁改这段注释」 |
| **C3** | **`getAllByRole('region')` 计数** —— 01 的两条核心验收 | **01 vs main（＋02 加剧）** | 01 §7.1 `expect(sections.map(...)).toEqual([三段名])`、§7.2 `await expect(sections).toHaveCount(3)` | **是，已被 main 直接证伪** | main 上 composer-home 子树里**已有两个带可访问名的 `<section>`＝role=region**：`example-store-showcase.tsx:38-39 <section aria-labelledby="example-store-showcase-title">`（冷态渲染，而 01 §3.4 自己规定冷态段① 走示例店 → 第 4 个 region）与 `brief-surface-panel.tsx:32,38 <section aria-label={view.title}>`（02 §7.2 让执行确认卡与 Brief 并列出现 → 第 5 个）。**01 §7.1 的冷态用例按自己的设计就会红。** 改法：三段加专用 testid，用 `getAllByTestId` 断 DOM 顺序，或 `getAllByRole('region', {name: /今天\|现在\|接着/})`，不用全局计数。<br>（澄清：`composer-delivery-card.tsx:64` 的 `<section>` **无**可访问名，不映射 region，03 不背此锅；`composer-conversation.tsx:139`、`composer-tools-strip.tsx:56` 同理） |
| **C4** | **冷态 vs pending 的判据与处置** | **01 §3.4 vs 04 §4.4** | 01：段③ 冷态（无在跑任务且无 session）→ **整段不渲染**／04：`cold` 判据＝`workbenchHasWork()`（`today-recommendation-card.tsx:169`，`:174-178` 四选一），且「未接上游用 **pending** 不用 cold」「**不因为空就藏 tab**」 | **半互斥**：两个面（段③／记忆 tab）不同，但①判据不同（内容有无 vs 工作区有无产出）②处置相反（空即藏 vs 空必须显） | **判 01 错**，用 04 自己写的原则反驳 01：「两个面用两套『有没有做过事』的判据，迟早会出现推荐卡说 pending、记忆页说 cold 的自相矛盾」。段③ 应同样走 `workbenchHasWork()`：有产出但无 session ＝ **pending 文案**（不是消失），真 Day-0 才不渲染。01 §7.1 第 4 条断言须同步改 |
| **C5** | **`/dashboard/memory` 的 identity 域 vs 已存在的 `/dashboard/identity`** | **04 vs 01 的立论** | 04 §4.3 把「门店主体偏好（对应 MarketingIdentity）」做成 memory 第一个 tab，**全文零次提及** main 上已存在的整页 `src/routes/dashboard/identity.tsx`（渲染 `MarketingIdentityPage`，`Routes.MarketingIdentity:'/dashboard/identity'`，i18n `product_navigation_identity` 已在库） | **是**。同一份 MarketingIdentity 会有两个可长期停留的前台落点，正撞 01 §6「产生第二个可长期停留的工作台的入口一律移除或重定向」 | 二选一并写进票下：(a) memory 的 identity tab 只出只读摘要 + 链到 `/dashboard/identity`；(b) 按 01 §6 的分界把 `/dashboard/identity` 收敛为 redirect 壳。**不允许两处并存而不表态** |
| **C6** | **配方目录的第三个前台落点** | **01 §4.4/§4.5 vs 04 §4.3** | 01：pill 行（段②）＋ 全量目录只在 `/dashboard/catalog`，「首页不再平铺它」／04：「工作流」域再复用 `listColdCardsFromRecipes` 渲染同一份配方 | **软冲突**（不阻塞，但口径不一致） | memory「工作流」域不重渲配方卡；只出「你常用的做法」计数/名称 + 链到 `/dashboard/catalog`。否则同一份列表三处露面，与 01 的收敛论调打架 |
| **C7** | **`src/lib/product-telemetry.ts`** | **04 vs 02** | 04 §3.5：allowlist（`:3-18`）追加一条事件／02：全文检索 —— **无 `emitTelemetry`、无事件键、无遥测段** | **无冲突**（已确证） | 02 的成本反馈走服务端返回值 + `composer-home` 本地 `useState`，不碰埋点面。**但 04 有个未提的实现障碍**：`emitTelemetry(event: TelemetryEventName, ...)`（`:101-102`，`TelemetryEventName = keyof typeof fieldAllowlist`，`:20`）不接受 04 §3.3 `SubstrateEventDeliverer` 的 `eventName: string`，默认 deliverer 必须收窄类型或断言——04 未处理 |
| **C8** | **拒绝反馈落点在三段布局里的位置** | **02 §5.3 vs 01 §2.2** | 02：反馈渲染在确认卡「刚才占据的那个挂载点」，论据是「商家的眼睛刚才就在这个位置，不需要视线转移」／01 §2.2：`{briefView ? <BriefSurface/> : null}` 作为覆盖层**保持在 return 末尾**，而 01 新插入的段③ 位于它与段②（提交按钮所在）之间 | **不互斥，但 02 的「就地」论据被削弱** | 落点确实存在（不是 01 §5 那类「位置不存在」问题），但改后确认卡与提交动作之间多隔整个段③。二选一：把覆盖层挂点移进段② 尾部，或 02 把确认卡渲染进段②。**两稿须在票下确认同一个挂点**，否则实现时各写各的 |

**另查过、结论无冲突的点**：i18n 新增键无碰撞（01 的 11 键 / 03 的 7+1 键 / 04 的 31 键，前缀 `dashboard_*`、`composer_recipe_pill_*`、`delivery_rating_*`、`memory_*` 两两不交，且已比对 zh.json 现有键无重名）；`composer-delivery-card.tsx` 的三动作（`:31-37`）三稿一致「不动」；lens 状态写入方（01 的 pill 行 / 03 的 chip）都走 `setLensState`，语义不互斥。
**一处小遗漏**：03 §1.7 表格用了 `delivery_followup_group_aria`，但 03 §1.5 的 i18n 清单与 04 §4.6 都没登记该键。

---

## 三、已过时判断清单（main 前进导致失效）

| # | 失效项 | 位置 | main 上的事实 |
|---|---|---|---|
| **O1** | 「D-164⑥C 与 D-109 冲突**须用户裁定**」「建议新增到 `DECISIONS.md` D5」 | 02 §6.2 末、§9.2 D5 行 | **用户已拍板并写进 main**：`e9d1dbb4 docs(design): D-164-6C vs D-109 conflict resolution (user-ratified)`，落 `设计文档:3138-3144`「补充裁定（2026-07-29，用户拍板）」。裁定方向与 02 §6.2 建议**完全一致**（D-109 不动／拒绝就地显示「本次未消耗额度」／落点 #261）。且 `DECISIONS.md:51-63` 早已有 D5 且状态 **DECIDED** |
| **O2** | D1/D2/D3 标 **PENDING**、「须用户拍板」「若用户仍拍板『全拦』」 | 02 §4 标题、§7、§7.2 末、§9.2 三行 | `DECISIONS.md:11/21/34` 三项均 **DECIDED（2026-07-29）**，裁定＝条数／零新增拦截点／消息尾行，与 02 建议一致。措辞过时，结论不过时。连带：§7.3 常量里的 `'all_generative'`/`'cost_threshold'` 现在是**留痕开关**而非待选项 |
| **O3** | 「D4 chip 生成方式仍 **PENDING**」 | 03 头部第 6 行、03 §2.1 标题；04 头部第 5 行、04 §6.2 **S1** | `DECISIONS.md:44-45` **DECIDED**：配方声明的固定集合（＝03 的建议）。S1「若拍板改模型即时生成则 §2.2-2.4 作废」已无风险 |
| **O4** | 04 §七 的回填**不完整** | 04 §3.2 / §3.3 / §3.5 / §3.7 | §七 只在文末追加，正文一处未动：§3.3 代码块里 **5 个 `TODO(#248)`**、自造的 `SubstrateEventAxes`/`SkillRevisionRef`/`PromptVersionRef`/`CatalogRevisionRef` 占位类型、§3.7 验收 1 的「键名以 #248 为准」注释全部保留。照 §3.3 实现的人会直接抄占位类型 |
| **O5** | 04 §3.3 的 `RatingVerdict = 'up'\|'down'\|'up_cleared'\|'down_cleared'` 被 §七 默认「已结清」 | 04 §3.3、§七 | **未结清**：`observability.ts` 全文 43 行只定了 `observabilityAxesSchema`（四键）与 `observabilityDropEventSchema`，**没有任何 verdict 枚举**。故 03 §1.6 的 ⚠️ 与 04 §6.2 **S2 依然有效**，但 §七 未点明——读者会误以为 verdict 也被上游答掉了 |
| **O6** | 04 §6.1 **B1** 判据括号「现 `skillVersion`/`skillRevision` **全仓 0 处**」 | 04 §6.1 | 已被 main 证伪：`packages/contracts/src/observability.ts:10` 就是 `skillRevision`。B1 本身也已由 `00-blockers.md:14` 判 **G2 已过** |
| **O7** | 四稿全部自述**基点 `main@cc04918d`** | 01/02/03/04 头部 | main 已到 `7f60a4e7`（+34 提交）。同批的 `00-blockers.md:3` 已改标 `main@7f60a4e7`，四稿未跟。这是 A 组 9 条漂移与 B30–B33 的总根因 |
| **O8** | `00-blockers.md` 与 `DECISIONS.md` 对 **G6 状态互相打架**（不属四稿，但 04 §6 以前者为阻塞权威） | `00-blockers.md:3`「NO-GO（4/7 未过）」、`:19`「G6 未拍板\|用户」 vs `DECISIONS.md:3-4`「全文不含 PENDING 时 G6 通过／**G6 已过**」 | 我实测 `DECISIONS.md` 全文 `PENDING` **只出现 1 次**，且就在 `:3` 那条规则句自身 → 按其自身判据 **G6 应为已过**，`00-blockers.md:3/:19` 过时（未过项应为 3 而非 4） |
| **O9** | 01 §8③ 只引了「本条①②④⑤为产品裁定」，**漏引紧邻的削弱条** | 01 §8③ | 决策文档 `:3160` 新位置上写着「**⚠️ 本条①的立论前提已被补测削弱**：`[静态]` 当前 `/workbench` 与 `/v2/workbench` 渲染**同一个组件**」——这是直接削弱 01 全稿立论（「Miora 双路由所以我们要收敛」）的一条证据边界，01 未引。同段 `:3161` 又是 C1 的反证 |

---

## 四、复核方自身的诚实标注（我**没能**验到的）

1. **`node_modules` 未安装**，故 `IconThumbUp` / `IconThumbDown`（03 §1.3）与 `IconBookmarks`（04 §4.2③）在 `@tabler/icons-react@^3.36.1` 里的实际导出名 **我一个都没验**。两稿已自标为 S3，我只能确认 `package.json:62` 的版本号、以及 `IconListDetails`(`sidebar-config.ts:29`)/`IconHistory`(`:28`) 确已 import。
2. **一条命令都没跑**：`typecheck` / `test` / `test:interaction` / `e2e` 全未执行（只读授权 + `locale:compile` 互斥纪律）。所有「改后会不会红」都是**静态推断**。尤其 **C3 的 region 计数是我按 ARIA 规则推的**（无可访问名的 `<section>` 不映射 `region`），**未实跑 RTL/Playwright 验证**——若 testing-library 的 role 计算与我的推断不同，C3 的严重度需下调（但两个带可访问名的 section 客观存在这一点是确证的）。
3. **未读任何 GitHub 票面**：#261/#248/#250/#251/#252/#255/#259/#262 的 issue body 与评论一条没读。因此 02 §4.1 引的「#261 票面验收原文」、02 §6.4 引的「#248 票面任务清单原文」「#248 验收门 3」、04 §3.1 的属主表，我只核到了 spec 与设计文档一侧，**票面一侧完全未验**。若票面与我核到的 spec 冲突，我的判定可能反向。
4. **运行时行为未验**：`sanitizeEventMeta` 丢弃字符串是我读类型签名（`creation-experience-events.ts:108` 返回 `Record<string, number|boolean|null>`）与 `isScalarMetaValue`（`:95-101`）推出的，**没跑过**。`meiye:telemetry` 零监听是 `git grep` 结论，**动态注册的监听器 grep 不到**。
5. **en.json 未逐键比对**：只查了 zh.json 的键存在性与「记忆／沉淀」命中；en 侧我信了 `check-locale-keys.ts:133-138` 的双边校验逻辑，**没自己比对**。
6. **02 §3.1「分辨率全仓不存在」未复跑**：我只验了该表其余 7 行（全对），这一行的全仓穷举没做。
7. **未验四稿的验收断言草案能否真的通过**（除 C3 外）：所有 `it(...)` 都是草案，我只做了「它依赖的现有零件是否存在」的检查，没有构造 fixture 验证断言可满足性。

---

## 五、给主控的三条处置建议（不占篇幅展开）

1. **C1（④ 在不在范围）必须先裁**，它决定 01 是否要改头部与 §6；在裁定前 04 §4.2 的五处改动不能开工。
2. **C3 是唯一一条「按现稿写就会红」的验收缺陷**，且 01 的两条主验收都靠它，优先修。
3. **A 组 9 条 + O7**：四稿统一改标基点为 `main@7f60a4e7` 并重跑一遍设计文档锚点（全部 +7），比逐条改更省事。
