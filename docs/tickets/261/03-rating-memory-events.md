# #261 设计稿 · 评价条／动作 chip／评价事件适配层／记忆一级导航

> 范围：**D-164④**（记忆升一级导航）＋ **D-164⑤**（评价条与动作 chip）＋ **D-160③**（评价事件合同）
> 基点：main@cc04918d（worktree `lane-261`）。**本文件是零 rebase 面预备产出，不含任何源码改动。**
> 权威：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md:3099-3111`（D-164④⑤）、`:2701-2739`（D-160③ 与其 07-29 补充）、`:3005-3033`（D-163②）、`:2120-2128`（D-126，一字不改）
> 同批：`00-blockers.md`（开工门与属主边界）、`DECISIONS.md`（D4＝chip 生成方式 PENDING）、`01-ia-three-sections.md`、`02-confirm-card-and-cost.md`

---

## 〇、票面事实性偏差（本 lane 新增两条，接 `00-blockers.md` 第二节）

| # | 盘点结论写法 | main 实际 | 影响 |
|---|---|---|---|
| 4 | 「最近亲实现：`src/product/results/image-role-feedback.tsx` ＝评价条最近亲」 | **该 `.tsx` 不存在**，只有 `src/product/results/image-role-feedback.interaction.test.tsx`；它测的是 `ImageWorksurface` 的**采用动作完成文案**（`src/product/results/image-role-action-matrix.ts:83-97` `IMAGE_ROLE_FEEDBACK`，D-087 要求逐字符匹配），**与赞/踩评价无关** | 「评价条最近亲」不成立。**全仓无任何评价条前例**，本票是第一实现。可借的只有它的**逐字符文案纪律**与测试写法 |
| 5 | 「移动底栏是 `grid-cols-4`（加第五项要改栅格）」 | 属实（`src/components/product/mobile-nav.tsx:55`），**但真正的硬门在测试**：`src/components/product/mobile-nav.static.test.ts:38-42` 硬断言 `['workbench','content','assets','store']` 四项，且用例名写死「**nav 四项合同**」 | 加第 5 项**必然红**这条测试。改它＝改「四项合同」，须在票下留痕；不是顺手改栅格 |

---

# 一、评价条设计（D-160③ ＋ D-164⑤ 前半）

## 1.1 落位：为什么必须新建组件而不是改 `ComposerDeliveryCard` 内联

`composer-delivery-card.tsx:71-104` 是**一个整卡 `<button>`**（`:76` `onClick` → `onOpen({action:'open'})`）。评价条要求「紧贴文案末尾」，而文案（`:82-92` statement、`:93-102` excerpt）**在这个 button 内部**。HTML 禁止按钮嵌套，React 也会把内层点击冒泡到外层整卡点击 → 点赞会连带打开结果中心。

**结论**：评价条渲染在 `</button>`（`:104`）之后、现有动作行（`:106`）之前，是**紧贴文案末尾在视觉上可达的最近位置**；实现为独立组件文件，`ComposerDeliveryCard` 只负责摆放。

## 1.2 组件契约

- 文件：`mkfast-template-main/src/product/composer/composer-delivery-rating-bar.tsx`
- 组件：`ComposerDeliveryRatingBar`

```ts
/** D-160③ 四动作，顺序即 Miora 实测顺序：复制／点赞／点踩／更多。 */
export type DeliveryRatingAction = 'copy' | 'up' | 'down' | 'more';

export const DELIVERY_RATING_ORDER: readonly DeliveryRatingAction[] = [
  'copy', 'up', 'down', 'more',
];

export type ComposerDeliveryRatingBarProps = {
  /** 被评价的产物 —— 与 ComposerDeliveryCard 同一个 revision（:42），不另取。 */
  revision: ContentPackageRevisionDelivery;
  /** 已表达过的态度；同一版只保留一个，再点同一个＝撤回（见 §1.6）。 */
  verdict: 'up' | 'down' | null;
  /**
   * 唯一出口。复制的剪贴板写入、更多的菜单展开都在这里之上做，
   * 本组件不持有任何副作用 —— 与 composer-delivery-card.tsx:6-9 同纪律。
   */
  onRate: (action: DeliveryRatingAction) => void;
  className?: string;
};
```

**不进 props 的东西（属主边界）**：三轴版本值、事件名、遥测函数。评价条只报告「谁点了哪个」，事件组装全在 §三 的适配层。理由：评价条是纯展示件，让它知道 `skillRevision` 就等于让 UI 组件成为事件合同的第二个知情方，#248 改键名时要改两处。

## 1.3 四个图标的来源

| 动作 | 图标 | 来源 | 依据 |
|---|---|---|---|
| 复制 | `IconCopy` | `@tabler/icons-react`（`package.json:62` `^3.36.1`），仓内已用：`src/product/results/delivery-panel.tsx:47`、`src/product/results/canonical-handoff-page.tsx:222` | 同一语义仓内已有定名图标，不另选 |
| 点赞 | `IconThumbUp` | `@tabler/icons-react`，**仓内零引用，开工时须核实导出名** | 见下 |
| 点踩 | `IconThumbDown` | 同上 | 见下 |
| 更多 | `IconDots` | `@tabler/icons-react`，仓内已用：`src/components/ui/breadcrumb.tsx:114`、`src/components/ui/pagination.tsx:123` | 同上 |

**明确不用 `src/components/heroui-pro/vendor/components/icons.tsx:290 ThumbsDown` / `:301 ThumbsUp`。** 理由不是风格偏好：

1. `mkfast-template-main/CLAUDE.md` 的 Conventions 段把 **Icons ＝ `@tabler/icons-react`** 写成仓级约定。
2. 该 vendor 文件在 `heroui-pro/vendor/` 下，是**上游镜像**（D-130 的「重拉镜像锁版本」路径），改上游镜像等于把本地修改暴露在下次重拉时被覆盖。
3. 最实际的一条：**同一行里 `IconCopy` 是 Tabler、赞踩是 HeroUI vendor**，两套图标的 viewBox（Tabler 24、vendor 16）、描边风格（Tabler 线性、vendor 实心 `fill: currentColor`）不同，四个图标并排会明显不齐。这不是可以靠 `size-*` 拉平的差异。

**若 `IconThumbUp`/`IconThumbDown` 的实际导出名不同**（本 worktree 未装 `node_modules`，未能核实）：改成正确的 Tabler 名，**不要退回 vendor**。

## 1.4 「纯图标、无文字标签、轻到可忽略」的实现口径

这条与 `DESIGN.md:191`「触屏最小命中 44px」和 `src/product/results/outcome-chips-panel.tsx:129` 已落地的 `min-h-11 min-w-11` **表面冲突**。解法是把**墨量**与**命中区**分开——不是把按钮做小。

| 维度 | 取值 | 依据 |
|---|---|---|
| 图标尺寸 | `size-3.5`（14px） | 比卡内正文 `text-sm` 的字面还小一档；`delivery-panel.tsx:47` 的 `size-4` 是「明确动作」的档，评价条要更低一档 |
| 按钮命中区 | `size-11`（44×44），`inline-flex items-center justify-center` | `DESIGN.md:191` 硬约束，不可为「轻」牺牲 |
| 行整体收拢 | 容器 `-mx-2.5 -mt-0.5 flex`，按钮之间 `gap-0` | 44px 方框内 14px 图标自带 15px 留白，不负边距会让这一行读起来比正文块还宽。负边距把**光学左缘**对齐到正文左缘 |
| 静息色 | `text-muted-foreground/60` | `DESIGN.md:145` 的灰痕体系；`/60` 让它低于 `:100` 的「点开看完整成品」提示行 |
| hover | `hover:text-foreground hover:bg-[--tint-hover]`，`rounded-full` | `DESIGN.md:195` Ghost ＝「透明底 + tint-hover 悬停痕，行内三级动作」——评价条正是三级动作 |
| 已表达态 | 该图标 `text-foreground`，另一个保持 `/60`；**不加底色、不加计数** | D-160③「行业通用惯例，不做发散」 |
| focus | 继承壳级 `focus-visible:ring-2 focus-visible:ring-ring/50`（`mobile-nav.tsx:12` 同款） | `DESIGN.md:196` 全壳一档 |
| 动效 | 仅 `transition-colors duration-150` | `DESIGN.md:227`「只动 transform/opacity」——颜色过渡不触发布局，且 150ms 在其区间下限 |
| 上边距 | `mt-1` | 「紧贴文案末尾」；对比现有动作行 `:108` 的 `mt-3` |

**不做的**：不加分隔线、不加容器边框、不加「觉得怎么样？」引导语。任何一条都会把它从「轻到可忽略」变成一个求评价的卡片区块，与 D-164⑤「服务系统质量信号，不打扰商家」相悖。

## 1.5 无障碍

纯图标按钮必须有可读名。四个 `aria-label` 全部走 paraglide（`check-locale-keys.ts:97 sourceHasCjkOutsideComments` 会拒绝源码内 CJK 明文，若该文件被加入 `PRODUCT_SHELL_SOURCES`）：

| i18n key | zh | en | 用处 |
|---|---|---|---|
| `delivery_rating_copy_aria` | 复制文案 | Copy text | 复制按钮 aria-label |
| `delivery_rating_up_aria` | 这一版好用 | This one works | 点赞 aria-label |
| `delivery_rating_down_aria` | 这一版不好用 | This one does not work | 点踩 aria-label |
| `delivery_rating_more_aria` | 更多操作 | More actions | 更多 aria-label |
| `delivery_rating_group_aria` | 对这一版的评价 | Feedback on this version | 外层 `<div role="group">` 的 aria-label |
| `delivery_rating_up_done` | 已记下：好用 | Noted: works | `aria-live="polite"` 播报（见下） |
| `delivery_rating_down_done` | 已记下：不好用 | Noted: does not work | 同上 |

- 外层用 `role="group"` ＋ `aria-label`，**不用 `<fieldset><legend class="sr-only">`**（`outcome-chips-panel.tsx:115-119` 的写法）：那里是一组表单式记账动作，这里是四个独立按钮，`fieldset` 语义过重。
- 赞/踩按钮带 `aria-pressed={verdict === 'up'}` —— 切换态按钮的标准表达，比换 label 更稳。
- 点击后的确认：一个 `sr-only` 的 `aria-live="polite"` 区域播报 `delivery_rating_*_done`。**视觉上不出现任何 toast** —— 视觉反馈只有图标变色（§1.4）。
- `data-testid`：`composer-delivery-rating`（组）、`composer-delivery-rating-${action}`（各项），与 `:114` `composer-delivery-action-${action}` 同构不同名，测试选择器不会互相误伤。

## 1.6 去重、撤回、重复评价（D-160③ 待验证项，须自定）

D-160③ 补充段明写：「评价事件的**去重、撤回与重复评价**口径未定……**无外部参照可抄，须自定**」。

**建议口径（最小、可测、不建状态机）**：

| 情形 | UI | 事件 |
|---|---|---|
| 首次点赞 | 赞图标转 `text-foreground` | 发一条 `verdict:'up'` |
| 点赞后点踩 | 赞复位、踩点亮 | 发一条 `verdict:'down'`（**不发撤回事件**） |
| 点赞后再点赞 | 赞复位为 `/60` | 发一条 `verdict:'up_cleared'` |
| 同一版反复切换 | 同上 | **每次都发** |

理由：**归纳侧要的是时序证据（D-160⓪），不是当前态。** 前端做去重＝在信号进入之前就丢掉了「商家改了主意」这一条最强的信号；而「哪一条是最终态」后端按 `(packageId, versionId, actorId)` 取最后一条即可，是查询问题不是写入问题。前端只保证**一次点击一条事件**，不保证幂等。

⚠️ `up_cleared` 这个**值**属 #248（它定 verdict 枚举）。此处只提出**需要一个表达撤回的值**，不占键名。若 #248 只给 `up|down`，退化方案＝撤回不发事件、UI 仍复位，并在票下留痕说明信号有损。

## 1.7 与现有三动作（`:31-37` adopt/adjust/export）的位置关系

**现有三动作一个不动，标签不改，`ACTION_ORDER` 不改，`onOpen` 契约不改。** 它们是 ADR-0014 的「卡即门」——全部只开结果中心（`:6-9` R-05 唯一写路径）。评价条与后续动作 chip 都**不得**复用 `onOpen`。

卡内自上而下四段：

```
┌ ComposerDeliveryCard (composer-delivery-card.tsx:64 <section>)
│ ① 整卡 button（:71-104）  标题 / 任务总结 / 摘录 /「点开看完整成品」
│ ② 评价条                  mt-1，纯图标 ×4，text-muted-foreground/60   ← 新增
│ ③ 后续动作 chip 组         mt-3，ghost 药丸 ×2-3，动词短句            ← 新增
│ ④ 现有三动作              mt-3（:108），meiye-glass-piece 药丸 ×3     ← 原样
└
```

**为什么②在①之后而不是卡最底部**：D-164⑤「紧贴文案末尾」。放到④之后就隔了两组按钮，不再是「文案末尾」。

**③④两组药丸如何不被读成一组**（这是本节唯一真实设计风险）：

| | ③ 后续动作 chip | ④ 现有三动作 |
|---|---|---|
| 语义 | 对**下一版**做什么 | 对**这一版**做什么 |
| 落点 | 预填 Composer（不执行） | 打开结果中心 |
| 视觉 | Ghost：透明底 ＋ 1px 发丝线描边 ＋ `text-muted-foreground`（`DESIGN.md:195`） | Glass：`meiye-glass-piece`（`DESIGN.md:194` 次级动作），原样 |
| 文案形态 | 祈使动词短句：「换成深色背景」 | 判定短语：「采用这一版」 |
| 无障碍 | `role="group"` ＋ `aria-label` ＝ `delivery_followup_group_aria`「接下来还能做的」 | 无（原样） |

**不加可见小标题**。加「接下来：」一行会让卡从三段变四段，且 D-116 要求人话——一行冒号标题恰恰是 SaaS 说明书骨架。可见的区分交给**动词 vs 判定语**与**ghost vs glass**两层；语义区分交给 `aria-label`。

> 若走查后仍发现商家读混：**优先方案是把④收进「更多」菜单**（评价条的第四个图标），而不是给③加标题。这条留作备选，本轮不做。

---

# 二、动作 chip 设计（D-164⑤ 后半）

## 2.1 生成方式：取「配方声明的固定集合」（`DECISIONS.md` D4，建议 → 待拍板）

D-164 待验证原文：「动作 chip 的**生成方式未定**（由模型即时生成，还是配方声明的固定集合）」。

**建议：固定集合。四条理由，前两条是硬的。**

1. **成本（硬）**：D-164⑥ 决定 C 已裁「凡经由 agent 规划完成的动作，规划本身即成本」，并以 Miora 实测「点拒绝仍扣 79.65」为据。让模型在每次交付后再生成一次 chip 文案，等于**每条成品额外产生一次商家没有请求、也看不见的规划消耗**——直接撞⑥C，且是⑥C 点名要消灭的那类不可见消耗。
2. **可测（硬）**：仓内已有的完成文案纪律是 `src/product/results/image-role-action-matrix.ts:83`「Exact completion feedback (D-087). Must match character-for-character in RTL」，其测试 `image-role-feedback.interaction.test.tsx` 逐字符断言。模型即时生成的 chip **无法写任何文案断言**，只能断言「有 2-3 个按钮」——那等于验收不覆盖内容。
3. **延迟**：chip 必须与交付卡同帧出现（它在评价条正下方，评价条紧贴文案末尾）。二次模型往返会让卡先渲染再抖出两个按钮。
4. **红线**：模型生成的可点文案仍是面向商家的输出，须过 D-162④ 七门 check；固定集合在编译期就过了。

## 2.2 数据源：现有可用面盘点

| 候选源 | file:line | 有什么 | 判定 |
|---|---|---|---|
| `BrowserRecipeProjection` | `packages/contracts/src/creation-experience.ts:158` | `presentation`（`:165`→`RecipePresentation` `:45-51`：title/summary/actionLabel/previewAssetRef）、`delivery`（`:166`→`RecipeDeliveryDefaults` `:53-60`：platform/deliverableKind/quantity/**aspectRatio**）、`lensId`（`:163`） | **无 followUp/chips 字段**。加字段＝改 recipe 契约，属 creation-experience 属主面，#261 不得动 |
| 前端静态种子 `LAUNCH_CARD_SEEDS` | `src/product/composer/launch-card-seeds.ts:101`（类型 `:84 LaunchCardSeedSpec`） | 已是「core launch-seeds 的浏览器侧镜像」，文件头 `:1-7` 明写「browser must not import core」「later Surface revisions may override presentation at runtime」 | **推荐**。零契约改动，且**镜像＋运行时可覆盖**这个模式是仓内既有先例 |
| 镜像先例 `COMPOSER_LENS_LABELS` | `src/product/composer/lens-labels.ts:7`（文件头 `:1-4`「Mirror of core static seeds — no publish lifecycle」） | 三 lens 中文标签 | 同上模式的最小实例，直接照抄结构 |
| 已投影的配方卡 | `src/product/composer/recipe-cards.ts:104 listColdCardsFromRecipes` / `:57 listColdCardsFromSeeds` | `RecipeCardView`（`:34-51`）含 `lensId`/`recipe`/`actionLabel` | 取 `lensId` 与已套用配方 id 用 |

**结论**：chip 集合按 **`CreationLensId` 分档**（`lens-labels.ts:7`：`copy` / `image_text` / `video`），必要时按 `delivery.aspectRatio`（`creation-experience.ts:60`）与 `delivery.contentPackagePlatform`（`:56`）做**剔除**（例如已是横版就不出「再出一版横版的」）。**不新增任何后端字段，不碰 `skills` 模块**（`00-blockers.md:65`）。

## 2.3 声明形态（新文件，草案）

文件：`mkfast-template-main/src/product/composer/delivery-followup-seeds.ts`

```ts
/**
 * 交付后续动作 chip 的静态种子。
 * 与 lens-labels.ts:1-4 / launch-card-seeds.ts:1-7 同模式：浏览器侧镜像，
 * 将来 Surface/Recipe 投影若给出 presentation.followUps，运行时覆盖本表。
 * 文案为 D-164⑤ 三个示例的 D-116 人话渲染，语义不变。
 */
export type DeliveryFollowUpSeed = {
  /** 稳定 key，进 data-testid 与事件，不随文案变。 */
  id: string;
  /** chip 上的字（商家语言，祈使动词开头）。 */
  label: string;
  /** 点击后填进 Composer 的整句（不是 label，label 是省略主语的）。 */
  intent: string;
  /**
   * 出现条件：留空＝该 lens 恒出。
   * ratioNot：交付物已是该比例时不出（避免「再出一版横版」出现在横版上）。
   */
  ratioNot?: string;
};

export const DELIVERY_FOLLOWUP_SEEDS: Readonly<
  Record<CreationLensId, readonly DeliveryFollowUpSeed[]>
>;
```

## 2.4 chip 实际文案（商家语言，D-116）

D-164⑤ 给的三个示例是「换背景为深色版」「加上开业日期」「生成横版尺寸」。第三个带工程味（「尺寸」是参数词），按 D-116 与 `[feedback-brand-voice-over-spec-sheet]` 改写；语义一一对应，不新增也不减少。

**图文（`image_text`）** —— D-164⑤ 三例的直接落位：

| id | label | intent（填进 Composer 的整句） |
|---|---|---|
| `dark_background` | 换成深色背景 | 这版底色换成深色的，其他都不动 |
| `add_open_date` | 加上开业日期 | 图上把开业日期加进去 |
| `landscape_variant` | 再出一版横版的 | 同样内容再出一版横着的，发朋友圈封面用 |

`landscape_variant` 带 `ratioNot: '16:9'`。

**文案（`copy`）**：

| id | label | intent |
|---|---|---|
| `shorter` | 说得再短一点 | 这段再短一点，能一眼看完 |
| `warmer_tone` | 换个更热闹的语气 | 语气换得再热闹一点，像门店活动那样 |
| `add_offer` | 加一句到店福利 | 结尾加一句到店福利，别写具体折扣数字 |

**视频（`video`）**：

| id | label | intent |
|---|---|---|
| `new_hook` | 换个开头钩子 | 开头三秒换一个更抓人的说法 |
| `add_address` | 配上门店地址 | 片尾把门店地址加上 |
| `portrait_variant` | 出一版竖屏的 | 同样内容再出一版竖屏的 |

**每 lens 恰 3 条，剔除后最少 2 条** —— D-164⑤ 原文「2–3 个」。剔除后不足 2 条时**整组不渲染**（宁可没有，也不出一个孤零零的 chip 让它看起来像唯一正解）。

## 2.5 点击链路：必须走现有 prefill 链，禁止自动执行

D-164⑤ ＋ D-126 ＋ Miora 实证三方同向：**点击只填输入框，不发送。**

现有链路（全部已存在，**不新造**）：

```
① ComposerDeliveryRatingBar 同级的 chip 组
   onFollowUp(seed)                                   ← 新增 prop（组件不做副作用）
      ↓
② ComposerDeliveryCard props 新增 onFollowUp
   composer-delivery-card.tsx:39-49 props 区
      ↓
③ ComposerConversation 透传
   composer-conversation.tsx:199 props 区（与 :207 onOpenDelivery 并列）
   渲染点 composer-conversation.tsx:299 <ComposerDeliveryCard>
      ↓
④ composer-home.tsx 落点 —— 复用 :2775-2789 那一段的三步，一步不改：
   a. writeCreationDraftIntent(sessionStorage, intent)
        src/product/creation-entry-model.ts:67（键 :46 CREATION_DRAFT_INTENT_STORAGE_KEY）
        —— 与 dashboard-home-surface.tsx:145-150 的 prefill 完全同两步
   b. setLensState((cur) => updateUserText(selectLens(cur, lens), intent))
        composer-home.tsx:2779-2781
   c. focusComposerIntentInput()
        composer-conversation.tsx:60-67（按 testid 取焦，:57 COMPOSER_INTENT_INPUT_TESTID）
        —— 注释 :2782-2784 明写为何不能用 ref
```

**一处必须与推荐卡不同**：`composer-home.tsx:2779` 把 lens 硬编码成 `'copy'`（推荐卡永远出文案意图，合理）。**后续动作 chip 必须传交付物自己的 lens** —— 对一张图点「换成深色背景」却把创作类型切成「文案」，商家下一步会得到一段文字。lens 来源＝该 delivery turn 所属 session 的当前 lens。

**禁止**：`onFollowUp` 里任何形式的 `createWork` / `submit` / `commandP1`。`composer-home.tsx:2765-2772` 的注释「Both CTAs prefill this same draft — never submit」是这条纪律的既有成文形态，新增第三个调用方后应把注释里的 "Both" 一并更新（这是本票**唯一**允许修改的既有注释）。

## 2.6 chip 视觉

`rounded-full border border-border/60 bg-transparent px-3 py-1 text-xs text-muted-foreground hover:bg-[--tint-hover] hover:text-foreground`，容器 `mt-3 flex flex-wrap gap-2`，`min-h-11`? —— **不加 `min-h-11`**：chip 是文字药丸，`px-3 py-1 text-xs` 下高约 26px，低于 44px 命中要求。按 `DESIGN.md:191` 触屏最小命中 44px，实现取 `py-1` 视觉高度 ＋ `after:absolute after:inset-x-0 after:-inset-y-2.5` 的伪元素扩张命中区（或直接 `py-2.5` 让整行高 44px）。**建议后者**：`gap-2` 下两行 chip 的间距已足，44px 实高不会显得笨重，且不引入伪元素调试成本。现有 `:113` 三动作是 `px-3 py-1`，同样不足 44px —— **这是既有问题，本票不顺手改**（`00-blockers.md` 属主纪律：只清自己的），仅在票下记一条。

`data-testid="composer-delivery-followup-${seed.id}"`。

---

# 三、评价事件的消费适配层设计（本文件重点）

## 3.1 属主边界：一句话与一张表

> **#248 是事件合同的唯一属主（`docs/specs/agent-substrate-dev-spec-2026-07-29.md:580`「事件合同唯一属主＝#248，下游只消费」、`:601` 语义锁列同项）。#261 在自己这侧只建一个薄适配层与调用点，不产生任何字段语义。**

| #261 **可以**做 | #261 **绝对不能**做 |
|---|---|
| 新建 `delivery-rating-event.ts`（本票独占文件） | 定义 `skillRevision`/`promptVersion`/`catalogRevision` 的**键名、字符串格式、语义** |
| 决定**在哪几个 UI 点**调用（评价条四按钮） | 定义 verdict 枚举值集合（`up`/`down`/`up_cleared` 只是**诉求**，值由 #248 定，见 §1.6 ⚠️） |
| 把已在前台手里的产物标识（`packageId`/`versionId`/`revision`，`composer-delivery-card.tsx:28,42`）塞进 payload | 给 `meta` 定字段、定清洗规则 |
| 决定「缺轴时不发」与失败计数（**投递可靠性**，非合同） | 新建 `/api/*` ingest 路由（观测侧，属 #248） |
| 在 `product-telemetry.ts:3-18` allowlist 加**一行**事件名 | 改 `emitTelemetry`（`:101`）本体（#251 同踩，见 §3.5） |
| 写两条验收 interaction test | 改 `packages/contracts/src/*.ts` 任一文件 |

## 3.2 五字段 ↔ 三轴：一处必须由 #248 澄清的歧义

| 票面「五字段」 | #248 三轴扁平键（`00-blockers.md:29`） | 映射 |
|---|---|---|
| `skillId` ＋ `skillVersion` | `skillRevision` | 合并。`apps/core/src/p1/skills/types.ts:184 skillRevisionRef(skillId, revision)` → `"<skillId>@<revision>"` |
| `promptName` ＋ `promptVersion` | `promptVersion` | 合并。同形 `"<name>@<version>"`（`langfuse-sender.ts:278-279` 现有嵌套 metadata 是同两值） |
| `catalogRevision` | `catalogRevision` | 一一对应。注意 `packages/contracts/src/uiux.ts:44` 的同名字段属 `creativeExecutionContractSchema`（**执行契约**），**不是事件字段**，键名撞名不等于同源 |
| **`场景`** | **无对应轴** | ⚠️ **悬空**。D-160③ 原文要求「skillId ＋ skillVersion ＋ **场景标识**」，场景＝objective 或配方卡分组（D-139）。三轴里没有它 |

**必须向 #248 提的一条**：场景是三轴之外的**第四个顶层键**，还是收进某一轴？在 #248 答复前，适配层里给它一个 `scene` 的**占位名并标注 TODO(#248)**，不做任何格式约定。

## 3.3 适配层接口草案

文件：`mkfast-template-main/src/product/composer/delivery-rating-event.ts`（**本票独占，#248/#251 不踩**）

```ts
/**
 * 评价事件的消费适配层（#261）。
 *
 * 事件合同的唯一属主是 #248（spec:580/:601）。本文件不定义任何字段语义 ——
 * 它只做三件事：把前台已有的值装进 #248 给的形状、交给唯一出口、在出口失败
 * 时留下可观测的计数。#248 合入后，本文件顶部的占位类型整段删除、换成 import，
 * 调用点（composer-delivery-card.tsx）一行不动。
 */

// ─────────────────────────────────────────────────────────────
// ① 占位段 —— #248 合入后整段删除，替换为：
//    import type { SubstrateEventAxes, SubstrateEventPayload }
//      from '@meiye/contracts';
//    预期落点：packages/contracts/src/（具体文件名由 #248 定）
// ─────────────────────────────────────────────────────────────

/** TODO(#248)：形如 "<skillId>@<revision>"，格式由 #248 定，此处不校验。 */
type SkillRevisionRef = string;
/** TODO(#248)：形如 "<promptName>@<version>"。 */
type PromptVersionRef = string;
/** TODO(#248)：与 uiux.ts:44 的同名执行契约字段不是同一个东西。 */
type CatalogRevisionRef = string;

/** TODO(#248)：三轴扁平顶层键，键名以 #248 为准。 */
type SubstrateEventAxes = {
  skillRevision: SkillRevisionRef;
  promptVersion: PromptVersionRef;
  catalogRevision: CatalogRevisionRef;
};

/** TODO(#248)：verdict 值集合由 #248 定；'up_cleared' 是 #261 的诉求（§1.6）。 */
type RatingVerdict = 'up' | 'down' | 'up_cleared' | 'down_cleared';

// ─────────────────────────────────────────────────────────────
// ② #261 自己的入参形状（前台已有的值，不涉及合同）
// ─────────────────────────────────────────────────────────────

export type DeliveryRatingEventInput = {
  verdict: RatingVerdict;
  /** 三者全部来自 composer-delivery-card.tsx:28,42 的 revision，不另取。 */
  packageId: string;
  versionId: string;
  revision: number;
  /** TODO(#248)：D-160③ 的「场景」，归属未定（§3.2）。 */
  scene: string;
  /**
   * 三轴。**允许为 undefined** —— 因为 main 上根本取不到（§3.4）。
   * 取不到时本层拒发并计数，绝不补空串（D-160③「补录不可能」）。
   */
  axes: Partial<SubstrateEventAxes> | undefined;
};

// ─────────────────────────────────────────────────────────────
// ③ 唯一出口 —— #248 合入后把实现换成它的 sender，签名不变
// ─────────────────────────────────────────────────────────────

/** 投递一条事件。抛异常＝投递失败，由 emitDeliveryRatingEvent 接住并计数。 */
export type SubstrateEventDeliverer = (
  eventName: string,
  payload: Record<string, string | number | boolean>
) => void;

/** 测试注入点；生产默认实现见 §3.5。 */
export function setSubstrateEventDeliverer(next: SubstrateEventDeliverer): void;

// ─────────────────────────────────────────────────────────────
// ④ 调用点唯一 API
// ─────────────────────────────────────────────────────────────

/**
 * 组装并投递。**永不抛** —— 评价按钮不该因为埋点失败而报错给商家。
 * 返回是否真的投出去了，供测试与调用点判断（调用点当前忽略返回值）。
 */
export function emitDeliveryRatingEvent(
  input: DeliveryRatingEventInput
): boolean;

/** 丢弃计数：轴缺失 ＋ 投递抛异常，两类合一。见 §3.5。 */
export function ratingEventDropCount(): number;
/** 分类计数，负向用例用它区分「缺轴丢」与「投递挂」。 */
export function ratingEventDropCountByReason(): {
  missing_axes: number;
  deliver_failed: number;
};
/** 仅测试用：afterEach 复位。 */
export function resetRatingEventCounters(): void;
```

**关键设计：`axes` 允许缺失但缺失即拒发。** D-160③ 的原话是「事件合同若不在第一版就带全字段，拿到的是无法归纳的废数据，且**补录不可能**」。把缺失轴补成 `''` 或 `'unknown'` 会产生**看起来带全五字段、实际是废数据**的记录——正是该决策要消灭的东西。宁可 0 条，也不要 N 条假的。

## 3.4 三轴在 main 上取不到（这是硬阻塞，不是实现细节）

| 轴 | main 上最接近的东西 | 为什么不能用 |
|---|---|---|
| `skillRevision` | `BrowserRecipeProjection.skillRevisionRefs?: string[]`（`packages/contracts/src/creation-experience.ts:178`） | 是**配方目录**上的引用数组，不是**这次执行实际用了哪个**；且是可选数组，不是单值 |
| `promptVersion` | `BrowserRecipeProjection.promptRevisionRef`（`:177`）；`langfuse-sender.ts:278-279` 的嵌套 metadata | 同上，配方级不是执行级；langfuse 那份在 core 且是嵌套结构，不出前台 |
| `catalogRevision` | `uiux.ts:44` `creativeExecutionContractSchema.catalogRevision` | 是执行契约的输入字段，不在交付回包上（`ContentPackageRevisionDelivery` 无此字段） |

**真正的来源是 #262**（D-165②「三轴钉扎进 Task 快照，绑 DBOS workflowID」）。故：

> **#261 能兑现「事件带满五字段」的组装与拒发逻辑，但在 #248（键名）与 #262（快照产出）合入前，生产路径上一条都发不出去。** 这必须写进票下评论，不能在验收时含糊过去。

适配层对此的处理：`axes` 来自 delivery turn 的 revision 快照；main 上该处无字段 → 传 `undefined` → 全部计入 `missing_axes`。**这本身就是一条可观测的负向证据**，比静默强。

## 3.5 通道选择：三条候选路径与推荐

### 硬约束：`creation-experience-events.ts:106 sanitizeEventMeta` 丢弃全部字符串

```
:95-101  isScalarMetaValue → 仅 number | boolean | null
:106-126 sanitizeEventMeta → 非 scalar 一律 continue（字符串被丢）
```

五个字段**全是字符串**（`"<skillId>@<revision>"` 等）。走后端 `meta` ＝ 五个字段全部消失，事件落库但内容为空。

⚠️ **顺带发现的契约/实现背离**：`packages/contracts/src/creation-experience.ts:599` 声明 `meta?: Record<string, string | number | boolean | null>` —— **类型允许 string，运行时清洗丢 string**。类型上编译通过、运行时静默丢字段，是最难查的一类。**这条属 creation-experience 属主面，#261 只记录不修**，建议转给 #248 或单开票。

### 候选路径对照

| | **A 前端遥测通道** | **B 后端 event_append** | **C 双写** |
|---|---|---|---|
| 入口 | `src/lib/product-telemetry.ts:101 emitTelemetry` | `apps/core/src/p1/creation-experience/foundation-module.ts:747 'event_append'` | A ＋ B |
| 字符串支持 | ✅ `buildTelemetryEvent` `:79-97` 保留 string，`:94` 截 120 字符 | ❌ `sanitizeEventMeta:106` 丢弃 | 部分 |
| 需改的属主面 | allowlist 一行（`:3-18`），**#261 自己加** | **四处闭集全属他人**：`kind` 七类（`contracts:556`）无 rating／`actionId` 八值（`events:58 CREATION_EVENT_ACTION_IDS`）无 rating／`meta` 清洗（`events:106`）／`lensId` 必填硬校验（`foundation-module.ts:750-756`，非三 lens 直接 `INVALID_STATE`） | 全部 |
| 落库 | ❌ **无 ingest 路由**（`src/routes/api/` 下无 telemetry 端点）；`:107` `dispatchEvent('meiye:telemetry')` **全仓零监听方**（grep 仅命中 dispatch 自身）；gtag/plausible/umami 仅 PROD 加载 → **dev 下纯 no-op** | ✅ 落库（`eventAudit.append`） | ✅ |
| 与 D-160③ 的关系 | 通道可用，落库缺 | 落库可用，字段全丢 | **正是 Miora 的失效模式**：D-160③ 点名「三套遥测互不关联」 |

### 推荐：**A′ ——「通道走 A，合同不由 A 定，落库端等 #248」**

具体：

1. 适配层的默认 deliverer ＝ 调 `emitTelemetry(<#248 给的事件名>, payload)`；在 `product-telemetry.ts:3-18` 的 `fieldAllowlist` 加**一个条目**，字段名清单**照抄 #248 的键名**。这是对属主面**最小**的侵入：allowlist 是纯数据 const，不是逻辑。
2. #248 若提供了自己的 sender / ingest 端点，`setSubstrateEventDeliverer` 一行切换，**调用点与 payload 组装零改动**。
3. **不选 B**：要动四处闭集，每一处都属别人（`kind`/`actionId` 属 creation-experience，`meta` 清洗同，`lensId` 校验同）。放宽 `meta` 明确是 #248/#251 的活。
4. **不选 C**：D-160③ 用整段篇幅论证双通道不可关联的危害，选 C 等于自愿复现被点名的反例。

⚠️ **诚实标注**：spec `:507` 的验收「评价按钮 → 信号落库并进入『已验证』层」，**#261 单独无法兑现**。A′ 能保证 payload 正确、可观测、可替换出口；**落库端属 #248**。这必须在票下写明，不得在验收时以「已埋点」充数。

### 128 字符与截断

`buildTelemetryEvent:94` 对字符串 `.slice(0, 120)`。`"<skillId>@<revision>"` 一般远短于 120，但 `skillId` 若含租户前缀有溢出风险。**适配层不做预截断**（截断会产生看起来正常的错值）；改为：**投递前若任一轴长度 > 120 则拒发并计入 `deliver_failed`**，并在票下记一条给 #248：三轴键的长度上限须与遥测通道的 120 对齐。

## 3.6 「投递失败可观测、不静默」的最小改造

现状：`emitTelemetry:101-112` 无 try/catch，`analytics.gtag?.(...)`（`:109`）若抛会冒泡到 React `onClick`；`product-telemetry.test.ts` 无失败路径断言。

**规避 #251 冲突的关键：不改 `emitTelemetry` 本体。**

`00-blockers.md:63` 已标「`product-telemetry.ts` #251 埋点通道同踩」。规避方案：

| 改动 | 落点 | 冲突面 |
|---|---|---|
| try/catch ＋ 计数器 ＋ 缺轴拒发 | **`delivery-rating-event.ts`（#261 新建独占文件）** | 零 |
| allowlist 新增一条事件 | `product-telemetry.ts:3-18` `fieldAllowlist` | **纯数据行追加**，与 #251 若也追加则是两条相邻新增行，git 自动合并；语义不重叠 |
| `emitTelemetry` 本体（try/catch、sendBeacon、失败计数） | **不动** | —— |

计数器形态：

- `let dropped = { missing_axes: 0, deliver_failed: 0 }` —— **module scope，不挂 `window`**。理由：jsdom 测试直接 import 读取即可；挂 window 会污染全局且在 SSR 下需守卫。
- 不做上报（上报失败的失败无处可去）、不做重试（评价是即时表达，重试会让「反复切换」的时序信号错乱，见 §1.6）。
- **不进商家界面**。D-160③ 只要求「可观测其投递成功率」，不要求商家看见；给商家看一个「埋点没送到」是 D-116 明令的工程语言外泄。

**要不要 sendBeacon：不要。** 三条理由：
1. `navigator.sendBeacon(url, data)` **需要 URL**，而当前无 ingest 端点（§3.5）。
2. beacon 返回值仅表示**入队**成功，投递结果不可观测 —— 与本票「失败可观测」的目标直接相反。
3. beacon 的价值在 unload 竞态；评价发生在卡片停留时，无此竞态。
→ 传输方式（beacon / fetch keepalive / 批量）由 #248 随 ingest 端点一并定。

## 3.7 验收断言草案

文件：`mkfast-template-main/src/product/composer/composer-delivery-rating.interaction.test.tsx`
（样板：`src/routes/dashboard/store-qualification.interaction.test.tsx:15-38` 的 `vi.hoisted` ＋ `vi.mock` 写法；文案逐字符断言纪律见 `src/product/results/image-role-feedback.interaction.test.tsx:1-3`）

```ts
// 验收 1 —— 事件带满五字段（票面第一条）
it('点赞发出的事件带满三轴 ＋ 场景 ＋ 产物标识，无一为空', async () => {
  const deliver = vi.fn();
  setSubstrateEventDeliverer(deliver);
  render(<ComposerDeliveryCard {...propsWithAxes()} />);   // axes 由 fixture 给全
  await userEvent.click(screen.getByTestId('composer-delivery-rating-up'));

  expect(deliver).toHaveBeenCalledTimes(1);
  const [, payload] = deliver.mock.calls[0];
  // 三轴 ＋ 场景：键名以 #248 为准，此处对着 import 的类型断言
  expect(payload).toMatchObject({
    skillRevision:   expect.stringMatching(/@\d+$/u),
    promptVersion:   expect.stringMatching(/@\d+$/u),
    catalogRevision: expect.any(String),
    scene:           expect.any(String),
    verdict:         'up',
  });
  // 「带满」＝没有空串占位（D-160③：补录不可能，宁可不发也不发假的）
  for (const value of Object.values(payload)) {
    expect(value).not.toBe('');
  }
  // 评价不得连带打开结果中心（§1.1 嵌套按钮回归）
  expect(onOpen).not.toHaveBeenCalled();
});

// 验收 2 —— 断投递后可见失败计数（票面第二条，负向）
it('投递抛异常时计数可见、UI 不报错、按钮态仍翻转', async () => {
  setSubstrateEventDeliverer(() => { throw new Error('offline'); });
  resetRatingEventCounters();
  render(<ComposerDeliveryCard {...propsWithAxes()} />);

  await userEvent.click(screen.getByTestId('composer-delivery-rating-down'));

  expect(ratingEventDropCountByReason().deliver_failed).toBe(1);
  expect(ratingEventDropCount()).toBe(1);
  // 埋点挂掉不该让商家看见异常，也不该吞掉她的表达
  expect(screen.getByTestId('composer-delivery-rating-down'))
    .toHaveAttribute('aria-pressed', 'true');
});

// 验收 3 —— 缺轴拒发（防「看起来带全、其实是废数据」）
it('三轴缺任一时不发事件，只计数', async () => {
  const deliver = vi.fn();
  setSubstrateEventDeliverer(deliver);
  resetRatingEventCounters();
  render(<ComposerDeliveryCard {...propsWithoutAxes()} />);  // main 现状

  await userEvent.click(screen.getByTestId('composer-delivery-rating-up'));

  expect(deliver).not.toHaveBeenCalled();
  expect(ratingEventDropCountByReason().missing_axes).toBe(1);
});

// 验收 4 —— chip 只预填不提交（D-164⑤ / D-126）
it('点动作 chip 只写草稿并取焦，不提交、不开结果中心', async () => {
  render(<ComposerDeliveryCard {...propsWithAxes()} />);
  await userEvent.click(
    screen.getByTestId('composer-delivery-followup-dark_background')
  );
  expect(onFollowUp).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'dark_background' })
  );
  expect(onOpen).not.toHaveBeenCalled();
  expect(createWork).not.toHaveBeenCalled();
});
```

⚠️ **运行纪律**：`test:interaction` 以 `locale:compile` 开头，会重写共享 paraglide 产物，**不得与本 worktree 的 `pnpm dev` 并跑**（仓根 `CLAUDE.md` 三条铁律第二条）。

---

*（下接 §四 记忆一级导航、§五 correction 处置、§六 阻塞清单）*
