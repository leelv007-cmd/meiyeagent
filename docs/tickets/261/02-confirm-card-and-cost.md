# #261 · D-164③ 执行确认卡 + D-164⑥ 成本即时反馈 —— 设计稿与 schema 草案

> 范围：仅 D-164③（执行确认卡）与 D-164⑥（就地纠偏两分 + 本次动作成本即时反馈）。
> 路由三段、记忆一级导航、评价条/动作 chip 不在本文。
> 基点 `main@a595808b`。本文只读源码，不改任何现有文件。
> 姊妹文件：`00-blockers.md`（开工门）、`DECISIONS.md`（D1–D5 裁定登记，**五项均 DECIDED 2026-07-29**）、`08-reconciliation.md`（裁定台账，冲突以其为准）。

---

## 1. 组件命名裁定

### 1.1 事实：票面写的组件不存在

`UserDebitPreview` 全仓零实现，只作为设计名出现在决策文档里。票面「UserDebitPreview 扩容」的真实性质是**净新建**，不是重命名或改造某个已有组件。

D-109 原文用词是「面向用户的 `CreativeQuote` **收敛为** `UserDebitPreview`」——它是一个**口径名**（商家只看得到额度消耗，不看得到技术报价），不是一个组件名。代码里兑现这个口径的是 `quota-blocking-card.tsx:84-96` 那一行被动文案，不是一张卡。

### 1.2 裁定

| 项 | 裁定 |
|---|---|
| 组件名 | `ExecutionConfirmCard`（渲染层）＋ `execution-confirm-card.ts`（纯投影/状态机） |
| 文件位置 | `mkfast-template-main/src/product/composer/execution-confirm-card.tsx` ＋ `.ts` |
| 反馈组件名 | `ExecutionCostFeedback`（同目录 `execution-cost-feedback.tsx`），**独立组件，不内嵌在卡里** |
| 导出 | 经 `src/product/composer/index.ts`（该文件已是 composer 模块的统一 barrel，392 行全是 re-export；追加一段 `export {…} from './execution-confirm-card'` 即可） |

**为什么放 `composer/` 而不是 `results/`**：D-164⑥ 决定 A 要求「生成型改版走 D-164③ 的执行确认卡，**与首次生成同一形态**」。首次生成在 composer，就地纠偏在 results。同一形态只能有一个实现，放在被依赖方（composer）由 results 反向 import，与现状 `results/$workId.tsx:57` 已从 `@/product/results/` 跨目录 import 同构。

### 1.3 与三个最近亲的关系

| 既有物 | 关系 | 依据 |
|---|---|---|
| `quota-blocking-card.tsx:57` `QuotaBlockingCard` | **并存 + 复用其投影** | 两者职责不同：被动行（`:84-96`）是提交**前**的常驻说明，`:48-52` 注释明写「gates nothing — the merchant's tap on 生成 is the confirmation」（D-043 决定②）；阻塞态（`:128-222`）是 D-123「超额报停」。执行确认卡是提交**那一刻**的确认面。**不合并**，但成本行必须复用 `quota-blocking.ts:278` `projectQuotaPassiveView`，否则「本次用 X 条」会出现两套措辞 |
| `brief-surface-panel.tsx:200-218` `BriefSurface` | **并存 + 吸收其 footer 形态与状态机骨架** | Brief 是 D-094 的**安全触发**卡（七类 trigger code，`brief-surface.ts:56-67`），触发条件是「这次跑有风险要素」，内容是证据抽屉/事实冲突；执行确认卡触发条件是「这次跑要花额度」，内容是参数＋消耗。两卡语义正交。**复用**：footer 双按钮布局（`:200-219`）、`phase` 状态机形状（`brief-surface.ts:85`）、`ComposerInputSnapshot` 快照-恢复模式（`:91-102`）。**不复用**：`视频计费只读区`（`:154-188`）应由执行确认卡接管，见 §4.4 |
| `composer-signed-preview.ts` | **复用两行 + 另建扩展投影，不改原文件** | 原模块只回显「发到哪 / 交付物」两行，`:76-86` 注释明写模型行「已被删除」，`:14` 明写 no cost figures。执行确认卡需要模型/比例/数量/时长/成本——**不得**去改 `projectComposerSignedPreview`（它服务的是主轴常驻回显，那里删模型行的判断依然成立）。新建 `projectExecutionParams()` 独立投影 |
| `results/image-adjust-confirmation.tsx:25` `ImageAdjustConfirmation` | **被吸收，退役** | 它就是「就地纠偏 → 生成型改版」的确认卡，已在 `results_/$workId.tsx:1207` 生产挂载。D-164⑥ 决定 A 要求它与首次生成**同一形态**，保留两个组件即两套形态。改造路径见 §5.4。注意它 `:32-35` 显示 `${confirmedAmount} ${currency}`，其交互测试 `image-adjust-confirmation.interaction.test.tsx:34` 断言字面量 `'整组 2 张·4 CNY'`（fixture 源头 `:13 confirmedAmount: 4`、`:14 currency: 'CNY'`）——**CNY 已在商家面泄漏**，见 §4 |

### 1.4 一条硬约束：不得触发既有退役静态测试

`reuse-panel-retirement.static.test.ts:104-113` 逐字读 `composer-home.tsx` 源文件并断言：

```
assert.doesNotMatch(home, /composer-settings-row/);
assert.doesNotMatch(home, /composer-setting-input-/);
assert.doesNotMatch(home, /buildDynamicSettingsRow/);
```

含义：`composer-home.tsx` 内**不得出现** `buildDynamicSettingsRow` 字样。执行确认卡要复用 `settings-row.ts` 的字段选择逻辑（见 §3），**必须在 `execution-confirm-card.ts` 内部 import**，由卡自己投影，`composer-home.tsx` 只传原始值。这不是绕过测试——该测试守的是「主轴不得回退成槽位表单」，确认卡是只读投影，正是它守护的反面。

---

## 2. props / state 契约草案

### 2.1 设计原则：只读是**类型层**保证，不是约定

卡内不可配置的防线共四道，从强到弱：

1. **props 里根本不存在写回通道**——没有 `onChange` / `onValueChange` / `setX` / `value+setter` 对；只有 `onReject` / `onConfirm`。
2. **参数以「已格式化的展示字符串」入场**，不是「枚举值 + 可选项列表」。卡拿不到 `options`，就无法渲染选择器。
3. **全字段 `readonly`**，数组 `readonly T[]`。
4. **编译期断言类型**：任何人未来往 props 上加控制类键名，`tsc` 直接红。

### 2.2 类型草案

```ts
// src/product/composer/execution-confirm-card.ts
// —— 纯投影 + 状态机，无 React。

import type { ComposerQuotaResource } from './quota-blocking';

/* ── 1. 参数只读投影 ───────────────────────────────────────────── */

/**
 * 一行参数。注意这里**没有** value/options/onChange —— 卡收到的是终态文案，
 * 不是可枚举的选项集合。想在卡内做配置，类型上就拿不到原料。
 */
export type ExecutionParamRow = {
  /** 稳定测试/遥测句柄，永不展示给商家（沿用 composer-signed-preview.ts:52-56 的口径）。 */
  readonly key:
    | 'model'          // 模型档位
    | 'aspectRatio'    // 比例
    | 'quantity'       // 数量
    | 'durationSeconds'// 时长（video）
    | 'destination'    // 发到哪 / 用在哪
    | 'deliverable';   // 交付物
  /** 商家语言标签，如「画面比例」。 */
  readonly label: string;
  /** 商家语言取值，如「3:4 竖版」。 */
  readonly value: string;
  /**
   * D-164③「用商家语言解释技术参数」的落点：一句「适合朋友圈/展架双用」。
   * 无稳定映射时为 null —— 宁可不解释，不得编造（D-024 不静默降级同精神）。
   */
  readonly hint: string | null;
};

/* ── 2. 成本投影 ──────────────────────────────────────────────── */

/** 一个桶的本次消耗，单位＝该桶自己的单位（条/张/条），复用 quota-blocking.ts:202-206。 */
export type ExecutionCostUnit = {
  readonly resource: ComposerQuotaResource;
  readonly cost: number;
};

export type ExecutionCostView = {
  /** 「本次用 1 条文案额度和 3 张图片额度 · 文案还剩 5 条」——直接取 projectQuotaPassiveView。 */
  readonly notice: string;
  readonly units: readonly ExecutionCostUnit[];
  /**
   * 视频按成片秒计费的补充说明（quote-wiring.ts:49 billingNote；文案生成在 :149-152）。
   * 非视频恒为 null。这是「条数」说不了的唯一一件事，composer-home.tsx:2601-2609
   * 注释已把这条边界写死。
   */
  readonly billingNote: string | null;
  /** 这一跑会不会超额（D-123 缺额提醒）。true 时确认键禁用。 */
  readonly short: boolean;
  readonly shortNotice: string | null;
};

/* ── 3. 卡的 props ────────────────────────────────────────────── */

export type ExecutionConfirmCardProps = {
  readonly visible: boolean;
  readonly title: string;
  readonly params: readonly ExecutionParamRow[];
  readonly cost: ExecutionCostView;
  /** 「拒绝」——D-164⑥ 决定 C：点它也已经发生成本，宿主必须接反馈。 */
  readonly onReject: () => void;
  /** 「确认」——唯一放行口。 */
  readonly onConfirm: () => void;
  readonly rejectLabel: string;
  readonly confirmLabel: string;
  /** 提交在途时两键同时禁用（沿用 brief-surface-panel.tsx:14-20 的 disabled 口径）。 */
  readonly busy?: boolean;
  /** 报价已过期，卡留在屏上但不可确认（沿用 brief-surface.ts:539-542 的 #240 修复）。 */
  readonly staleNotice?: string | null;
  readonly className?: string;
};

/* ── 4. 编译期只读断言 ─────────────────────────────────────────── */

/** 任何写回通道的键名形状。往 props 加这类键 → 下面的类型别名立刻报错。 */
type EditableControlKey =
  | `on${string}Change`
  | `set${string}`
  | 'value'
  | 'defaultValue'
  | 'options'
  | 'choices'
  | 'editable'
  | 'onEdit'
  | 'onParamChange';

type AssertNoEditableControls<T> =
  Extract<keyof T, EditableControlKey> extends never
    ? T
    : ['ExecutionConfirmCard 不得含可编辑控件（D-164③ / D-159③）', never];

/**
 * 这一行是断言本体：props 一旦长出控制键，别名解析为元组类型，
 * 下方 `satisfies` 立即 tsc 红。不是注释纪律，是编译门。
 */
export type ExecutionConfirmCardPropsReadOnly =
  AssertNoEditableControls<ExecutionConfirmCardProps>;

const _readOnlyGuard = null as unknown as ExecutionConfirmCardPropsReadOnly;
void (_readOnlyGuard satisfies ExecutionConfirmCardProps);
```

### 2.3 状态机草案

```ts
/**
 * 独立枚举，**不改** brief-surface.ts:85 的 BriefSurfacePhase。
 * 理由见 §5.5：那条枚举是 D-094 安全触发卡的，'cancelled' 语义是
 * 「放弃这次尝试、恢复输入快照」，与「拒绝并接受已发生成本」不同事。
 */
export type ExecutionConfirmPhase =
  | 'idle'      // 未触发
  | 'open'      // 卡在屏上，等商家
  | 'confirmed' // 已确认，执行在途
  | 'rejected'; // 已拒绝

export type ExecutionConfirmState = {
  readonly phase: ExecutionConfirmPhase;
  readonly params: readonly ExecutionParamRow[];
  readonly cost: ExecutionCostView | null;
  /** 拒绝时恢复输入用，形状沿用 brief-surface.ts:91-102。 */
  readonly composerSnapshot: ComposerInputSnapshot | null;
};

export function createExecutionConfirmState(): ExecutionConfirmState;
export function openExecutionConfirm(
  state: ExecutionConfirmState,
  input: {
    params: readonly ExecutionParamRow[];
    cost: ExecutionCostView;
    composerSnapshot: ComposerInputSnapshot;
  }
): ExecutionConfirmState;
export function confirmExecution(state: ExecutionConfirmState): ExecutionConfirmState;
export function rejectExecution(state: ExecutionConfirmState): {
  state: ExecutionConfirmState;
  restored: ComposerInputSnapshot | null;
};
export function projectExecutionConfirmCard(
  state: ExecutionConfirmState,
  options?: { busy?: boolean; quoteStale?: boolean }
): ExecutionConfirmCardProps;
```

**关键：反馈状态不在这个状态机里。** 卡在拒绝那一刻就该消失，而反馈必须活到商家看见为止。两者同生命周期就会出现「卡没了、反馈也没了」。反馈是 §5 的独立状态。

---

## 3. 商家语言参数映射表

### 3.1 系统里真实存在的参数（全部核过）

| 参数 | 契约来源 | 真实值域 |
|---|---|---|
| 模型 | `settings-view-model.ts:36-56` `CatalogModelView`（`displayName` / `qualityRank` / `capabilityLabels`） | 自由字符串，运营在 catalog 配 |
| 比例 | `composer-submission.ts:62` `aspectRatio` | `'1:1' \| '3:4' \| '9:16'`（**三值封闭枚举**） |
| 数量 | `composer-submission.ts:61` `quantity` | 整数 1–20 |
| 时长 | `composer-submission.ts:63` `durationSeconds` | 整数 1–3600（实际按 D-113「≤15 秒」） |
| 页数 | `composer-submission.ts:64-70` `notePageBound` | 图文笔记的绑定页数 |
| 平台 | `composer-signed-preview.ts:24-31` `PLATFORM_LABELS` | 已有商家语言映射，六值 |
| 交付物 | `composer-signed-preview.ts:33-40` `DELIVERABLE_LABELS` | 已有商家语言映射，六值 |
| 分辨率 | **不存在** | 全仓无分辨率字段（`2K` 等只出现在 Miora 拆解文档里）。票面/决策提到的「分辨率」在本系统由「比例 + 模型档位」隐含 |

### 3.2 映射表（`execution-confirm-card.ts` 内常量）

**比例**——三值封闭，可以全部写死，商家语言解释直接抄 D-164③ 原文范式：

| 值 | label | value | hint |
|---|---|---|---|
| `3:4` | 画面比例 | 3:4 竖版 | 适合朋友圈、小红书，也够印展架 |
| `9:16` | 画面比例 | 9:16 全屏竖版 | 抖音、视频号满屏不留黑边 |
| `1:1` | 画面比例 | 1:1 方图 | 适合头像位、九宫格拼图 |

**数量**：

| 条件 | value | hint |
|---|---|---|
| `quantity === 1` | 1 份 | `null`（一份不需要解释） |
| `quantity > 1`，copy lens | N 条文案候选 | 从里面挑一条用，其余留着换着发 |
| `quantity > 1`，image lens | N 张图 | — |
| 图文笔记（`notePageBound`） | 1 篇笔记 · N 页 | 正文一篇，配图 N 张 |

服务端已有等价物：`server-quote-authority.ts:155-162` 的 `outputLabel`（`「${quantity} 条内容候选」`／`「${quantity} 张 ${aspectRatio} 图片」`）。**优先直取服务端 `outputLabel`**（`product-quote.ts:88` 已把它定义为「Server-owned merchant-facing deliverable label bound to outputCount」），前端映射表只做兜底。

**时长**：

| 条件 | value | hint |
|---|---|---|
| `durationSeconds` 存在 | N 秒 | 按最后生成出来的成片秒数计费 |

hint 文案直接对齐 `video-confirm-zone.ts:59-61` 已有的 `「按生成成片 N 秒计费」`。

**平台 / 交付物**：直接调用 `projectComposerSignedPreview`（`composer-signed-preview.ts:87`），不重写映射。

**模型档位**——**这一格待 #252**：

| 现状 | 问题 |
|---|---|
| `CatalogModelView.displayName`（`settings-view-model.ts:38`） | 是运营填的自由字符串，已经是商家语言，可直接展示 |
| `CatalogModelView.capabilityLabels: string[]`（`:44`） | 自由字符串数组，唯一消费点 `p1/model-settings.tsx:215` 是 `.join(' · ')` 直接打印。**无稳定枚举，无法做「档位 → 商家语言」映射** |
| `qualityRank: number`（`:40`） | 纯排序数，无语义锚点 |

**裁定：模型行 v1 只展示 `displayName`，`hint = null`。** 「高清档 / 标准档 → 商家语言」的稳定映射标注**待 #252 能力词表 v1**（D-169④：A2A 三分骨架 + 模态限定子能力 + 词表带版本号）。在词表落地前编造档位文案，就是 D-024「不静默降级」禁的那类事。

**注意**：`settings-row.ts:74-79` 已有 `label: '模型'`、`:81-85` `label: '比例'`、`:86-90` `label: '数量'`——这些是**工程标签不是商家语言**（「比例」比「画面比例」抽象，且完全没有 hint）。执行确认卡**复用其 `LENS_FIELD_KEYS`（`:55-69`）决定该显示哪几行**，但**不复用 `FIELD_DEFS` 的 label**，另建商家语言表。这一点必须在代码注释里写清楚，否则下一个人会以为是重复定义而去合并。

---

## 4. 金额 vs 条数口径分析（**已裁定：条数 —— `DECISIONS.md` D1，DECIDED 2026-07-29**）

> 裁定与本节 §4.3 的推荐口径**完全一致**：商家面一律桶单位条数，金额仅设置页明细可见；`image-adjust-confirmation.tsx` 的 CNY 泄漏由本票一并修正（用户已授权，非本票自行扩张）。下文的两侧证据与兜底方案**保留为裁定依据留档**，不再是待选项。

### 4.1 冲突两端的原始证据

**主张「条数」的一侧：**

| 来源 | 原文 |
|---|---|
| `composer-home.tsx:2601-2609` | 「`预计消耗 0.06` used to print here: a bare float in an invisible unit … two pricing systems on one screen, and **the merchant unit is 条数, never money** (D-109 / D-123)」——这行金额是**被明确删掉的** |
| `composer-signed-preview.ts:14` | 「no cost figures (D-123 内部成本基准永不进前台)」 |
| D-109 决定段 | 「首版用户侧只保留：套餐等级、本周期图片额度/视频额度、已购加油包、活动赠送额度与到期日，以及**本次使用多少、完成后预计剩多少**」 |
| D-109 决定段 | 「前台**不展示** Token、供应商单价、平台毛利、上游按请求/秒数/Token 的公式、最低消费/取整…或**技术式成本 Quote**」 |
| D-123 决定段 | 「前台感知只有『付了对应款项→得到对应**次数/额度**』；租户管理面＝每次消耗扣减对应**次数/额度**」 |
| D-109 影响段 | 「面向用户的 `CreativeQuote` **收敛为** `UserDebitPreview`；D-043 的视频大额技术报价、D-087 的预计费用/时长…**不再适用**」 |

**主张「金额」的一侧：**

| 来源 | 原文 | 分量评估 |
|---|---|---|
| #261 票面验收 | 「点『拒绝』后，就地出现本次规划消耗反馈，**金额＝真实消耗**（Miora 反面教训：拒绝仍扣 79.65 且无提示）」 | 括号自己交代了「金额」一词的出处是 **Miora 的计价单位**，不是本产品的 |
| D-164⑥ 决定 B 原文 | 「必须就地、即时反馈**本次实际消耗**」 | **未出现「金额」二字** |
| D-164⑥ 原因段表格 | 「已扣 `79.65`」「`797.47 → 709.00`，扣 `88.47`」 | 全部是 **Miora 顶栏余额的观测值**，是证据不是规格 |
| `image-adjust-confirmation.tsx:32-35` | `${props.quote.confirmedAmount} ${props.quote.formula.currency ?? '额度'}` | **现役代码正在把 `CNY` 打给商家看**（测试 `:34` 断言 `'整组 2 张·4 CNY'`）。这是既有违规，不是先例 |
| `brief-surface-panel.tsx:170-176` + `zh.json:983` | 「预计额度：{amount}」 | 用「额度」不用货币符号，是**弱形态**：数字来自 `quote.amount`（钱），但标签装成了额度 |

### 4.2 冲突性质

按 runbook「票面与决策冲突以决策原文为准」，这里其实**不构成冲突**：D-164⑥ 原文说的是「实际消耗」，票面把它写成了「金额」。票面这句是**转述 Miora 证据时的措辞滑移**，不是新决策。

真正需要回答的是：**「真实消耗」在本产品可验证的表达形态是什么。**

### 4.3 推荐口径

**商家面一律用桶单位条数，金额一格都不出现。**

1. **反馈数字＝服务端结算的 `settledUnits`**（`product-usage-ledger.ts:132-195` settle 写入，`ProductUsageRecord.settledUnits`）。这是「真实消耗」在本产品**唯一可对账的量**：预占 `reservedUnits` → 结算 `settledUnits` → 差额 `refundedUnits`，三者恒等。金额 `settledAmount`（`product-quote.ts:121`）是内部核算量，D-123 明写「内部成本基准…永不进前台」。
2. **措辞单一来源**：复用 `quota-blocking.ts:278` `projectQuotaPassiveView`，让「本次用 1 条文案额度和 3 张图片额度」这句在提交前（被动行）、确认卡内、结束反馈三处**逐字一致**。三处不一致会被商家读成三件事。
3. **视频例外照旧**：`billingNote`（「按生成成片 N 秒计费」）保留，因为它是条数说不了的事——`composer-home.tsx:2604-2608` 注释已经把这条边界写死了，照抄即可。
4. **验收口径改写建议**：把票面的「金额＝真实消耗」执行为「**反馈数字逐桶等于服务端 settle 返回的 `settledUnits`**」。这比「金额相等」**更强**——它锁的是数据源同一性，而金额相等只锁了一个可以被前端算出来的数。

### 4.4 兜底方案（**未采纳**，留档：若将来改判要金额）

| 层 | 处置 |
|---|---|
| 商家主面（Composer / 确认卡 / 就地反馈） | 仍只显条数。这一层 D-109/D-123 是硬合同，改它要开新决策 |
| 设置页明细 | `account-usage-panel.tsx:137` `AccountUsagePanel` 内新增明细行，可显金额。该页已是「我还剩多少」的唯一落点（`dashboard-header.tsx:113-124` 注释） |
| 单位标签 | 用「额度」不用 `CNY`（沿用 `zh.json:983` 的口径） |

### 4.5 顺带清账（本票范围内必修）

`image-adjust-confirmation.tsx:32-35` 现在会把 `CNY` 打到商家面。它正是 D-164⑥ 决定 A 所指的「就地纠偏 → 生成型改版」确认卡，本票要吸收它（§1.3），吸收时这行必须换成条数口径，其交互测试 `:34` 的字面量断言同步改。**这不是顺手改邻居代码，是本票要吸收的组件本身。**

---

## 5. 拒绝路径的即时反馈方案

### 5.1 现状：拒绝是本票最大的结构缺口

两条拒绝路径，各自都断：

| 路径 | 代码 | 拒绝后发生什么 | 缺什么 |
|---|---|---|---|
| Composer 提交前 Brief | `composer-home.tsx:2754-2758` → `brief-surface.ts:421-450` | `phase → 'cancelled'`、恢复输入快照、**`setSession(createComposerSession(sessionIdRef.current))` 整条 transcript 清空**（注释：「Cancelling abandons this attempt」） | 无成本反馈、无余额刷新、无事件上报、无 query invalidate |
| 结果页就地纠偏 | `results_/$workId.tsx:1211-1214` | `setPendingImageAdjust(null)` ＋ `setAdjustError(undefined)`，两行，没了 | 同上。而且**卡弹出前已经跑过 `result_adjust_prepare`**（`:1349-1369`，一次真实的服务端 intent 执行 + 已创建 `prepared.work.id`），这正是 D-164⑥ 决定 C 说的「规划阶段已产生真实成本」在本仓的实例 |

`composer-home.tsx` 全文只有四处 `invalidateQueries`（`:1262 / :1643 / :2676 / :2679`），后两处都在兑换码成功回调里（`:2669-2691`）——**没有任何一处挂在拒绝或执行结束上**。

### 5.2 「就地」的落点选择

关键约束：**拒绝会清空 transcript**（`composer-home.tsx:2756-2757`）。任何挂在消息流里的反馈都会被同一次 `setSession` 抹掉。

| 候选 | 能否承载拒绝 | 持久性 | 改形态成本 | 判断 |
|---|---|---|---|---|
| 成品卡角标 | **不能** —— 拒绝时没有成品卡 | 高 | 中 | **结构性淘汰**：D-164⑥ 决定 B 明写「含被拒绝的情形」，一个覆盖不了拒绝的形态不能作为主形态 |
| Toast（`sonner@^2.0.7` 已在 `package.json:112`） | 能 | **低**（自动消失） | 低 | 「即时」满足，「就地」不满足——它是全局浮层，且商家移开视线就没了。D-164⑥ 原因段的失效模式恰恰是「商家不知道扣了钱」，一个会消失的提示是同类风险 |
| **消息尾行（推荐）** | 能 | 高 | **最低** | 见下 |

### 5.3 推荐：消息尾行，挂在卡的原位

**形态**：确认卡消失后，在**它刚才占据的那个挂载点**渲染一行 `<p data-testid="execution-cost-feedback">`。

**那个挂载点具体在哪：段②（创作面）的尾部 `execution-confirm-slot`**（裁定 `08-reconciliation.md` C8）。`01 §2.2` 已把这个 slot 画进三段渲染方案，两稿同一个挂点：

```
<section data-testid="dashboard-section-create">      ← 段②：创作面
  … ComposerPromptBar / 报价行 / QuotaBlockingCard / ComposerToolsStrip …
  <div data-testid="execution-confirm-slot">          ← 确认卡与其反馈尾行都在这里
    {phase === 'open' ? <ExecutionConfirmCard/> : null}
    {costFeedback ? <p data-testid="execution-cost-feedback">…</p> : null}
  </div>
</section>
```

**不留在 `ComposerHome` return 末尾的覆盖层**：那里是 `{briefView ? <BriefSurface/> : null}` 的位置，而 `01` 的段③（继续上次工作）在它之前。确认卡若挂到末尾，它与商家刚点的提交按钮之间就隔了整个段③——下面第 2 条「商家的眼睛刚才就在这个位置」直接不成立。`BriefSurface` 留在末尾不变（它是 D-094 安全触发卡，语义与确认卡正交，见 §1.3）。

为什么它最小：

1. **一个 `<p>`**，无新容器、无浮层、无动画、无生命周期管理。
2. **就地字面成立**——商家的眼睛刚才就在这个位置看确认卡，反馈出现在同一坐标，不需要视线转移。
3. **同时覆盖三种结束**（确认后成功 / 确认后失败 / 拒绝），一套渲染。
4. **不受 transcript 清空影响**——它挂在 composer-home 的组件树上（段② 内的 slot），不进 `session.transcript`。
5. **改形态成本最低**：文案由 `projectExecutionCostFeedback()` 一个纯函数产出（返回 `{ tone, text, testId }`），换成角标或 Toast 时**只换渲染的那 5 行**，投影、数据源、状态机、测试全部不动。这是「形态争议交用户拍板」在工程上的正确姿势——把争议隔离在渲染层。

**文案草案**（商家语言，D-116；最终表述归 D-124 R 门⑤统一出）：

| 场景 | 文案 |
|---|---|
| 拒绝，且规划未扣商家额度（**本产品默认，见 §6.2**） | 已取消，本次没有消耗额度 |
| 拒绝，且规划确有扣额（须 §6 后端字段到位才可能出现） | 已取消，本次准备阶段用了 X 条文案额度 |
| 确认后成功 | 本次用了 1 条文案额度和 3 张图片额度 · 文案还剩 5 条 |
| 确认后失败/未受理 | 本次没有成功，额度已退回 |

最后一条不是新增功能：D-109 原文「最终未受理/失败全额退回」已是既有合同，`product-usage-ledger.ts:186-195`（`status: 'refunded'`）已实现，前台只是把它说出来。

### 5.4 就地纠偏两分的落地（D-164⑥ 决定 A）

| 类别 | 判据 | 处置 | 现有落点 |
|---|---|---|---|
| **确定性编辑** | 不调模型 | **零阻塞、零提示**，一行代码都不加 | 直接编辑文本、`rollback_content_package_version`（`$workId.tsx:1188-1198`）、排序 / 采用 / 下载。D-109 原文已定「采用、下载、排序、复制和无需模型的确定性编辑不扣生成额度」 |
| **生成型改版** | 再次调模型 | 走 `ExecutionConfirmCard`，与首次生成同一形态 | `$workId.tsx:1341-1394` `onAdjust`（当前用 `ImageAdjustConfirmation`）、后续动作 chip 触发的重出图 |

**改造动作**：`$workId.tsx:1206-1218` 的 `<ImageAdjustConfirmation>` 换成 `<ExecutionConfirmCard>`，参数投影从 `prepared.quoteIntent`（`:1348-1355` 已带 `aspectRatio` / `quantity` / `catalogModelId`）＋ `quote.debitUnits` 组装；`onCancel`（`:1211-1214`）改为 `onReject`，加一句反馈。`image-adjust-confirmation.tsx` 与其**唯一**的测试文件 `image-adjust-confirmation.interaction.test.tsx` 退役（`git rm` 两个文件，按 D-127「真删默认」；`src/product/results/` 下与它相关的测试只此一个）。

**注意 `result-route-live-wiring.static.test.ts:47`** 断言 `assert.match(route, /ImageAdjustConfirmation/)` ——退役时这条断言要同步改成 `/ExecutionConfirmCard/`，否则静态测试会挡住。

### 5.5 状态机改动裁定

**`brief-surface.ts:85` `BriefSurfacePhase` 不加态、不改一个字。**

理由：
- 它是 D-094 安全触发卡的状态机，`'cancelled'` 的语义由 `cancelBriefSurface`（`:421-450`）定义为「放弃这次尝试 + 恢复输入快照」。执行确认的「拒绝」语义多一层「已发生成本须明示」，塞进同一个 `'cancelled'` 会让两卡的取消行为耦合。
- D-164③ 明写「D-013 七类 HITL 节点全部维持原义，一类不动」。Brief 是七类里的安全确认位，改它的状态机是改七类。

新增独立枚举 `ExecutionConfirmPhase`（§2.3），四态 `idle | open | confirmed | rejected`。

**唯一必须改动 `composer-home.tsx:2754-2758` 的地方**：`setSession(createComposerSession(...))` 之前先调一次反馈投影。改动形状：

```tsx
onCancel={() => {
  const { state } = cancelBriefSurface(briefState);
  setBriefState(state);
  // D-164⑥ 决定 B/C：拒绝也已发生动作，成本必须就地明示。
  // 反馈存在 session 之外，否则下一行的 transcript 清空会把它一起抹掉。
  setCostFeedback(projectExecutionCostFeedback({ outcome: 'rejected', /* … */ }));
  setSession(createComposerSession(sessionIdRef.current));
}}
```

`costFeedback` 是 `composer-home` 的一个 `useState`，与 `session` 平行、不嵌套。这是本方案唯一动到既有文件的地方，三行。

---

## 6. 规划成本的实现边界裁定

### 6.1 现状盘点（全部核过）

| 事实 | 证据 |
|---|---|
| 规划成本全仓零实现 | `planCost` / `planningCost` / `planning_cost` 三个词在 `apps` + `mkfast-template-main/src` + `packages` 全仓 **0 命中** |
| 产品账本是「一任务一预占」 | `product-usage-ledger.ts:4-5` 模块头「One task → one idempotent reserve/settle」；`:92-104` 同 taskId 二次 reserve 抛 `IDEMPOTENCY_CONFLICT` |
| 供应成本按 attempt 记，**无 stage/phase 维度** | `provider-cost-snapshot.ts:16-32` `BuildProviderCostSnapshotInput` 字段为 `attemptId / taskId / deploymentId / …`，无任何阶段字段。规划 attempt 与执行 attempt 在这张表上不可区分 |
| 报价快照无规划位 | `product-quote.ts:61-135` `ProductQuoteSnapshot` 有 `debitUnits`（预览）、`settledAmount` / `settlementStatus`（结算），**无规划阶段记录** |
| 结果页的规划确实真跑了 | `$workId.tsx:1345-1369` `executeIntent(..., 'result_adjust_prepare', …)` 在卡弹出前执行，并已创建 `prepared.work.id` |
| 前端拿不到任何消耗回执 | `commandP1`（`client.ts:153`）返回业务体；`entitlements.projection`（`composer-home.tsx:674-683`）是**累计余额**不是本次消耗，且 `staleTime: 30_000` |

### 6.2 **D-164⑥ 决定 C 与 D-109 的正面冲突（已由用户裁定，2026-07-29）**

> **裁定结果**：`DECISIONS.md` D5 **DECIDED**，裁定全文已写入设计文档 D-164⑥「补充裁定（2026-07-29，用户拍板）」小节（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md:3138-3144`，commit `e9d1dbb4`）：**D-109 不动**；规划成本计入 ProviderCost 台账、永不进商家额度桶；商家侧明示＝拒绝后就地显示「本次未消耗额度」。**方向与本节推导完全一致**，下文保留为裁定依据留档。据此，拒绝分支零后端依赖、可先行落地（§6.5 降级三）。

D-164⑥ 决定 C 说「规划阶段的消耗必须计入并反馈…不得让商家以为『拒绝＝没花钱』」。它的证据是 Miora——**Miora 的规划成本直接扣商家余额**（709.00 → 629.35）。

但本产品 D-109 原文已经定死：

> 「一个用户主动任务只产生**一笔**产品权益预占。内部 **Planner**、LLM、图片/视频调用、评估、质量淘汰、fallback、系统重试和同 supplier task 恢复分别进入 **ProviderCost Ledger**，**不重复扣用户**」

也就是说：**在本产品，规划成本按合同就不进商家额度桶，它是我方成本。** 商家点拒绝，商家侧的真实消耗**确实是 0**。

由此推出三条：

1. **Miora 的失效模式在本产品结构上不成立**。它的病根是「规划扣用户余额却不告知」，本产品规划根本不扣用户余额。
2. **D-164⑥ 决定 C 在本产品的诚实兑现，是「明示本次未消耗额度」**，而不是显示一个扣费数字。「不让商家以为拒绝＝没花钱」的对偶同样成立且更危险：**不得凭空造一个不存在的扣费**——那会让商家以为额度被吃掉了，直接违反 D-109「不重复扣用户」的可信度基础。
3. 若产品决定把规划成本计入商家桶，那是**改 D-109**，须开新决策，不是本票能做的事。

**因此本票的实现口径**：拒绝反馈文案 = 「已取消，本次没有消耗额度」，并在代码注释里写明依据 D-109 + D-164⑥C 的这次裁定。**该口径已获用户拍板**（`DECISIONS.md` D5 DECIDED，2026-07-29；裁定原文见本节开头引用的设计文档小节）。

### 6.3 前端 lane 能做 / 必须后端做

| 能力 | 谁做 | 说明 |
|---|---|---|
| 参数只读投影、商家语言映射、卡渲染、两动作 | **前端（本票）** | 数据全部已在手（`ComposerSubmissionSignedFields` + `CatalogModelView` + `ProductQuoteSnapshot.debitUnits`） |
| 确认前的「本次要用多少」 | **前端（本票）** | `quota-blocking.ts:226` `composerQuotaRequirements` 已是服务端 `debitUnitsFor` 的前端镜像（`:216-225` 注释注明权威在 `server-quote-authority.ts`） |
| 拒绝时「未消耗额度」文案 | **前端（本票）** | 按 §6.2，这是产品口径不是数据，零后端依赖 |
| **结束后「本次实际用了多少」** | **后端 → #248** | 必须从执行返回值直取，见下 |
| **规划阶段成本的 stage 归属** | **后端 → #248**（若 §6.2 裁定改口径才需要） | `provider-cost-snapshot.ts:16-32` 需加 `stage: 'planning' \| 'execution'` |

### 6.4 需要后端提供的字段/接口清单

| # | 需求 | 落点 | 属主 | 依据 |
|---|---|---|---|---|
| B1 | 执行命令的返回体带 `settledUnits: ProductUsageUnit[]`（本次实际结算，逐桶） | `commandP1` 执行类响应体 | **#248** | #248 票面任务清单原文：「**消耗两数据源分离：本次消耗从执行返回值直取（被拒情形当场反馈，D-164⑥）**；观测存储只做累计视图」——本票逐字对应 |
| B2 | 被拒/取消命令也返回一个消耗回执（哪怕全零），带 `reason` | 同上 | **#248** | #248 验收门 3：「一次被拒绝的操作 → 消耗当场反馈到前台（**不等异步指标**）」 |
| B3 | `ProviderCostSnapshot` 加 `stage` 维度 | `provider-cost-snapshot.ts:16-32` | **#248**（观测合同侧）；若牵涉 attempt 循环则与 **#247**（有界执行）联合 | 当前 `attemptId/taskId/deploymentId` 三键无法区分规划 attempt 与执行 attempt |
| B4 | 拒绝态进 HITL 决策枚举 | `harness.ts:53` `assistantPatchDecisionSchema` 现为 `['pending','accepted','editing','ignored']`，**无 `rejected`** | **#250** | D-169① 拒绝三态：`approved / rejected+feedback / rejected 无 feedback` |
| B5 | 条件性确认（金额超阈值时挂起）的服务端判定 | 「执行体内按运行时条件挂起」承载位 | **#250** | D-169①「新增条件性确认承载位…**条件判断不交模型**」 |
| B6 | 阈值数值与下发 | admin-config | **#255** | D-167② 四上限标定 |
| B7 | 模型档位 → 商家语言的稳定词表 | 能力词表 v1 | **#252** | D-169④ |

**不属于 #261 的**：B1–B7 一条都不能在本票里造。造了就是在 #248/#250 的属主面上建第二套事实，正是 `[feedback-partition-by-semantics-not-files]` 记的那类事故。

### 6.5 若后端字段永远不来：前端降级形态

按可接受度排序：

**降级一（推荐兜底）——投影 diff：**
执行结束/拒绝后 `invalidateQueries(p1QueryKeys.request('entitlements','projection'))`，取刷新前后 `usage[bucket].available` 的差值作为「本次消耗」。
- 优点：零后端改动，数据来自服务端权威投影（`account-usage.ts:3-17`）。
- 缺点：**异步**（#248 明写「不等异步指标」，此法正是它要避免的）；并发任务会污染差值；`staleTime: 30_000`（`composer-home.tsx:683`）要为此路径显式绕过。
- 定位：**明确标注为降级，不是首选**，代码注释须写明「B1 到位后立即换回执行返回值直取」。

**降级二——前端镜像值：**
成功时直接展示 `composerQuotaRequirements` 算出的预期消耗（`quota-blocking.ts:226`）。
- 优点：零延迟、零依赖，与确认卡上的数字天然一致。
- 缺点：**它是「预期」不是「真实」**。部分交付/失败退回（`product-usage-ledger.ts:186-195` 的 `partially_refunded` / `refunded`）时会说谎。
- 定位：只可用于**确认卡内的预览**（那本来就是预览），**不可用于结束后的反馈**——用了就直接违反票面「＝真实消耗」。

**降级三（拒绝路径专用，无损）：**
按 §6.2，拒绝时「本次没有消耗额度」是**产品口径推出的结论**，不依赖任何后端字段。
- **拒绝路径因此可以先行落地、零阻塞。** 这是本票在 #248 未到位前唯一能完整交付的验收项。

---

## 7. 触发条件的最小形态（`DECISIONS.md` D2，**DECIDED 2026-07-29：零新增拦截点**）

> 裁定与 §7.2 的推荐一致：只在既有三处拦截位出现，商家点击数不增加；切「全拦」保留**单个常量开关**（§7.3①）。同时结项 D-164 待验证的「触发条件」一项。

### 7.1 对主控初判「先全拦」的一处修正（该初判已被推翻并写进裁定）

`DECISIONS.md` D2 建议「先全拦生成型动作」。核过代码后，**「全拦」不是最小形态，它是更大的改动**：

| 事实 | 证据 |
|---|---|
| 现在文案 lens 无触发时是**直接提交**，一次点击 | `brief-surface.ts:295-308` `decideSubmitPath` → `direct_submit` |
| 「点生成」本身就被设计为确认动作 | `quota-blocking-card.tsx:48-52` 注释：「it states what this run will use and what is left and **gates nothing — the merchant's tap on 生成 is the confirmation**」（D-043 决定②/③） |
| 全拦 = 给现在 1 击的路径加 1 击 | 与 D-043「≤2 击」正面顶 |
| **成本阈值机制不是新建，是既有的** | `brief-surface.ts:63` 七个 D-094 trigger code 里已有 `quote_policy_threshold`；`product-quote.ts:76` `extraConfirmThreshold` 注释「Server-resolved extra-confirm threshold frozen from quotePolicyRevision」 |

也就是说：**「成本阈值」在本仓已经建好了触发通道，「全拦」才是要新写逻辑的那个。**

### 7.2 推荐的最小形态：零新增拦截点

**执行确认卡只出现在今天已经会拦的位置，一个新拦截点都不加。** 三处：

| 位置 | 今天的触发条件 | 明天 |
|---|---|---|
| Composer 提交 | `decideSubmitPath` 返回 `open_brief`（D-094 七码，含 `quote_policy_threshold` / `any_video`） | Brief 照旧；执行确认卡**并列**在 Brief 之后出现（安全确认 → 花费确认，两卡不合并，D-164③「不新增卡类型」指的是不新增 HITL 类别，不是不能有两张卡先后出现） |
| 视频 lens | `evaluateSubmitGate`（`video-confirm-zone.ts:82`，恒拦分支在函数体 `:105-118`）恒拦 | 视频计费区（`brief-surface-panel.tsx:154-188`）迁入执行确认卡，Brief 里那段删掉 |
| 结果页就地纠偏 | `$workId.tsx:1341` `onAdjust` 恒拦 | 换成 `ExecutionConfirmCard`（§5.4） |

净效果：**商家点击数不增加一次**，卡的内容变丰富（多了参数只读 + 消耗），并且拒绝路径第一次有了反馈。这符合「按最小形态实现，不自行扩展」。

**已裁定取此形态**（D2 DECIDED 2026-07-29）。若将来改判「全拦」，实现是同一段代码里把一个常量从 `'existing_gates'` 改成 `'all_generative'`，见 §7.3——该常量是**留痕开关**，不是待选项。

### 7.3 留痕方案（三处，缺一不可）

**① 常量集中定义**——`execution-confirm-card.ts` 顶部单点：

```ts
/**
 * 执行确认卡触发口径。D-164「待验证」明确未定：
 *   「执行层二次确认的触发条件未定（是否所有生成都拦，还是仅超过成本阈值时拦）。
 *     须与报价模型一并定，与 D-162③ 循环预算上限合并处理」
 *
 * v1 取 'existing_gates'：只在今天已经会拦的位置出现，零新增拦截点、零新增点击。
 * 该口径已于 2026-07-29 由用户拍板（DECISIONS.md D2 DECIDED）；下面另外两个值
 * 是**留痕开关**，不是待选项 —— 改它们等于改已裁定的口径，须先改 D2。
 * 理由与取舍见 docs/tickets/261/02-confirm-card-and-cost.md §7。
 *
 * 改口径 = 改这一个常量：
 *   'all_generative' → 全拦（注意与 D-043 ≤2 击的张力）
 *   'cost_threshold' → 走服务端 ProductQuoteSnapshot.extraConfirmThreshold
 *                      （product-quote.ts:76，阈值数值属 #255）
 * 前端不得自行定义阈值数字 —— 那是服务端 quotePolicyRevision 冻结的量。
 */
export const EXECUTION_CONFIRM_TRIGGER_MODE:
  | 'existing_gates'
  | 'all_generative'
  | 'cost_threshold' = 'existing_gates';
```

**② 判定函数单一入口**：`shouldOpenExecutionConfirm(input): boolean`，全仓唯一判定处，禁止在调用点写 `if`。三种模式在这个函数里分支，切换口径时测试只改这一个函数的用例。

**③ 票下评论**：合入前在 #261 下留一条，记「v1 取哪个口径、依据哪段决策原文、切换点是哪个常量、**由谁于何时拍板**（用户，2026-07-29，D2 DECIDED）」，与 `DECISIONS.md` D2 互相引用。

---

## 8. 验收断言草案（行为为证）

三个文件，全部 `vitest` + `@testing-library/react`（`pnpm test:interaction`）。

> 纪律：**不许出现 `readFileSync` + 正则**。现有 `reuse-panel-retirement.static.test.ts` / `result-route-live-wiring.static.test.ts` 是源码正则型，本票的验收断言一条都不走那条路——负向断言「无可编辑控件」要证的是渲染出来的 DOM 里没有，不是源码里没写。

### 8.1 `src/product/composer/execution-confirm-card.interaction.test.tsx`

**断言 A ——「卡内无任何可编辑参数控件」（票面负向断言）：**

```
it('渲染出的卡里没有任何可编辑控件', () => {
  const { container } = render(<ExecutionConfirmCard {...fullyPopulatedProps} />);

  // 穷举所有能改值的 DOM 形态，包括 ARIA 伪控件。
  const editable = container.querySelectorAll(
    'input, textarea, select, [contenteditable="true"], ' +
    '[role="textbox"], [role="combobox"], [role="listbox"], [role="spinbutton"], ' +
    '[role="slider"], [role="radio"], [role="checkbox"], [role="switch"], [role="menuitemradio"]'
  );
  expect(editable).toHaveLength(0);

  // 按钮恰好两个，且就是拒绝/确认。第三个按钮 = 第三个动作 = 破 D-164③。
  const buttons = screen.getAllByRole('button');
  expect(buttons.map((b) => b.textContent?.trim())).toEqual(['拒绝', '确认']);
});

it('往卡里打字改不动任何参数展示值', async () => {
  const user = userEvent.setup();
  render(<ExecutionConfirmCard {...propsWith({ aspectRatio: '3:4 竖版' })} />);
  const before = screen.getByTestId('execution-confirm-param-aspectRatio').textContent;

  await user.click(screen.getByTestId('execution-confirm-param-aspectRatio'));
  await user.keyboard('9:16');

  expect(screen.getByTestId('execution-confirm-param-aspectRatio').textContent).toBe(before);
});
```

第二条比第一条弱但不可省：它证的是**行为**（点了、打了字、值没变），第一条证的是**结构**。只有结构断言，将来有人用 `div + onKeyDown` 手搓一个编辑器就能绕过。

**断言 B —— 参数用商家语言，不泄工程词：**

```
it('参数行说商家语言，不出现比例代号以外的工程词', () => {
  render(<ExecutionConfirmCard {...imageProps} />);
  const card = screen.getByTestId('execution-confirm-card');

  expect(card).toHaveTextContent('3:4 竖版');
  expect(card).toHaveTextContent('适合朋友圈');          // D-164③ 商家语言解释
  expect(card).not.toHaveTextContent(/aspect ratio/i);
  // D-116 / composer-signed-preview.ts:14 的既有边界，逐条守住。
  for (const term of ['provider', 'deployment', 'credential', 'fallback', 'CNY', 'token']) {
    expect(card.textContent?.toLowerCase()).not.toContain(term.toLowerCase());
  }
});
```

**断言 C —— 两个动作各自只发生一次、且互斥：**

```
it('拒绝与确认互不触发对方', async () => { … expect(onConfirm).not.toHaveBeenCalled(); … });
```

### 8.2 `src/product/composer/execution-cost-feedback.interaction.test.tsx`

**断言 D ——「点拒绝后就地出现本次消耗反馈」（票面正向断言）：**

```
it('点拒绝后，卡消失、同一位置出现本次消耗反馈', async () => {
  const user = userEvent.setup();
  render(<Host />);   // Host = 最小宿主，内含卡 + 反馈两个槽

  const slot = screen.getByTestId('execution-confirm-slot');
  expect(within(slot).getByTestId('execution-confirm-card')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '拒绝' }));

  expect(within(slot).queryByTestId('execution-confirm-card')).toBeNull();
  // 「就地」的可验证形态：反馈出现在卡刚才那个容器里，不是页面别处。
  expect(within(slot).getByTestId('execution-cost-feedback')).toBeInTheDocument();
});
```

**断言 E ——「数字＝真实消耗」（数据源同一性，非字面量比对）：**

```
it('反馈数字来自注入的结算回执，不是组件里算出来的', async () => {
  const user = userEvent.setup();
  // 故意给一个与预览值不同的结算值：预览 3 张，实际结算 2 张（部分交付）。
  const settle = vi.fn().mockResolvedValue({
    settledUnits: [{ resource: 'image', quantity: 2 }],
  });
  render(<Host previewUnits={[{ resource: 'image', cost: 3 }]} onSettle={settle} />);

  await user.click(screen.getByRole('button', { name: '确认' }));
  const feedback = await screen.findByTestId('execution-cost-feedback');

  expect(feedback).toHaveTextContent('2 张');       // 跟回执走
  expect(feedback).not.toHaveTextContent('3 张');   // 不跟预览走
});
```

**这条是整票最关键的断言。** 它证的不是「显示了一个数字」，而是**数字的数据源是执行返回值**（#248 的 B1）。把预览值与结算值故意做成不同，才能把「其实是前端算的」这种假绿钉死。

**断言 F —— 拒绝时不得凭空造扣费（§6.2 裁定的负向守卫）：**

```
it('拒绝反馈明说没消耗，不显示任何非零消耗', async () => {
  … await user.click(screen.getByRole('button', { name: '拒绝' }));
  const feedback = await screen.findByTestId('execution-cost-feedback');
  expect(feedback).toHaveTextContent('没有消耗额度');
  expect(feedback.textContent).not.toMatch(/[1-9]\d*\s*(条|张)/);
});
```

**断言 G —— 确定性编辑零阻塞（D-164⑥ 决定 A 负向）：**

```
it('确定性编辑不弹确认卡、不出成本反馈', async () => {
  … await user.click(screen.getByRole('button', { name: '恢复上一版' }));
  expect(screen.queryByTestId('execution-confirm-card')).toBeNull();
  expect(screen.queryByTestId('execution-cost-feedback')).toBeNull();
});
```

### 8.3 `src/product/composer/execution-confirm-trigger.test.ts`（纯函数，`pnpm test`）

`shouldOpenExecutionConfirm` 的三模式用例：`existing_gates` 下文案无触发 → `false`（**证明没加新拦截点**）、视频 → `true`、`quote_policy_threshold` 命中 → `true`；`all_generative` 下文案 → `true`。

### 8.4 需要新增的 testid 清单

`execution-confirm-card` / `execution-confirm-slot` / `execution-confirm-param-<key>` / `execution-confirm-cost` / `execution-confirm-reject` / `execution-confirm-confirm` / `execution-cost-feedback`。

---

## 9. 阻塞项清单

### 9.1 上游合入前**根本无法实现**的

| # | 项 | 卡在哪 | 等谁 | 现状证据 |
|---|---|---|---|---|
| **X1** | 结束后「本次实际消耗」反馈（成功路径） | 无任何回执字段可读 | **#248**（票面明写属主） | 执行返回体无 `settledUnits`；`entitlements.projection` 是累计余额且 `staleTime: 30_000`（`composer-home.tsx:683`） |
| **X2** | 票面验收「数字＝真实消耗」中的**成功**分支 | 同 X1 | **#248** | 断言 E 无法在 B1 到位前变绿 |
| **X3** | 规划成本的 stage 归属（若 §6.2 裁定要改口径） | `provider-cost-snapshot.ts:16-32` 无阶段维度 | **#248** ＋ **#247** | 规划 attempt 与执行 attempt 在账本上不可区分 |
| **X4** | 拒绝态进 HITL 契约、拒绝三态留痕 | `harness.ts:53` 枚举无 `rejected` | **#250** | 只能先在前端本地态里表达，不入契约 |
| **X5** | 触发条件走「成本阈值」模式 | 阈值数值未标定 | **#255**；判定逻辑 **#250**（条件性确认承载位） | `product-quote.ts:76` `extraConfirmThreshold` 字段在，数值来源不在 |
| **X6** | 模型档位的商家语言 hint | 能力词表未定 | **#252** | `capabilityLabels: string[]`（`settings-view-model.ts:44`）是自由字符串，唯一消费点 `p1/model-settings.tsx:215` 直接 `.join(' · ')` |
| **X7** | 反馈文案的最终措辞 | 商家语言表述归 D-124 R 门⑤统一出 | 用户 / R 门批次 | D-164「待验证」原文 |

### 9.2 曾须用户拍板的四项 —— **全部已裁定（2026-07-29），本节不再阻塞动工**

| # | 项 | 裁定 | 登记位 |
|---|---|---|---|
| **D1** | 金额 vs 条数（本文 §4） | **条数**（与本文建议一致）；金额仅设置页明细可见；`image-adjust-confirmation.tsx` 的 CNY 泄漏一并修正（用户已授权） | `DECISIONS.md` D1，**DECIDED** |
| **D2** | 触发条件（本文 §7） | **零新增拦截点**（本文 §7.1 推翻「先全拦」的初判被采纳）；`'all_generative'` / `'cost_threshold'` 降级为留痕开关 | `DECISIONS.md` D2，**DECIDED** |
| **D3** | 反馈形态（本文 §5） | **消息尾行**，挂确认卡原位（＝段② 尾部 `execution-confirm-slot`，见 §5.3 与 `01 §2.2`）；形态隔离在渲染层 | `DECISIONS.md` D3，**DECIDED** |
| **D5** | 规划成本口径：D-164⑥C 与 D-109 冲突（本文 §6.2） | **D-109 不动**；规划成本留 ProviderCost 台账、永不进商家桶；拒绝时明示「本次未消耗额度」。裁定全文已写入设计文档 D-164⑥ 补充裁定小节（`e9d1dbb4`） | `DECISIONS.md` D5，**DECIDED** |

> 措辞更新依据 `08-reconciliation.md` O1／O2（裁定方向与本稿建议**完全一致**，故只改措辞、不改结论）。**仍在阻塞的是 §9.1 的 X1-X7（等 #248/#250/#252/#255），与本节无关。**

### 9.3 **不阻塞、可先行落地**的（本票在 #248 到位前能完整交付的部分）

1. `ExecutionConfirmCard` 组件本体 + 参数只读投影 + 商家语言映射（除模型档位 hint = X6）。
2. `AssertNoEditableControls` 编译期只读门 + 断言 A/B/C（负向验收「卡内无可编辑控件」**今天就能全绿**）。
3. `ImageAdjustConfirmation` 吸收退役（§5.4），顺带清掉 `CNY` 泄漏（§4.5）。
4. `shouldOpenExecutionConfirm` 单点判定 + 三模式用例（§8.3）。
5. **拒绝路径的反馈**——按 §6.5 降级三，「本次没有消耗额度」是产品口径推出的结论，零后端依赖，断言 D/F **今天就能全绿**。
6. 确定性编辑零阻塞的负向断言 G。

即：**票面三条验收里，两条负向（无可编辑控件、确定性编辑零阻塞）与拒绝路径正向，均可在 #248 前交付；只有「成功路径数字＝真实消耗」硬等 #248。**

### 9.4 属主越界红线（本票一步都不许迈过）

- 不得在前端定义任何计费/结算字段名 —— 归 #248。
- 不得在前端写阈值数字 —— 归 #255。
- 不得给 `harness.ts` 的 HITL 枚举加值 —— 归 #250。
- 不得改 `server-quote-authority.ts` / `product-usage-ledger.ts` / `provider-cost-snapshot.ts` —— core 侧账本不在前端 lane。
- 不得改 `composer-signed-preview.ts` 的 `projectComposerSignedPreview` —— 它服务主轴常驻回显，另建投影（§1.3）。
- 不得改 `brief-surface.ts:85` 的 `BriefSurfacePhase` —— D-013 七类一类不动（§5.5）。


---

## 锚点校准（2026-07-29，基点 main@a595808b）

本轮只改 `file:line` 锚点与基点标注，**未改任何结论、判断或设计取舍**（§4 金额 vs 条数、§6.2 D-164⑥C 裁定、§7 触发口径一字未动）。依据 `06-xcheck-reverse.md §一`，并逐条在 `main@a595808b` 上复验。

**本稿改动 10 处锚点 ＋ 1 处基点标注**：

| 处 | 原 | 现 | 来源 |
|---|---|---|---|
| 头部 · 基点 | `main@cc04918d` | `main@a595808b` | 06 O7 |
| §1.2 导出行 | `index.ts` 的 `:89`「统一出口」 | 删掉该无意义行号（`:89` 只是 barrel 中间一行 `} from './settings-row';`），改述为「392 行全是 re-export」 | 06 B28 |
| §1.3／§4.1／§4.5 CNY 断言 | `image-adjust-confirmation.interaction.test.tsx:37` | `:34`（`:37` 是 `fireEvent.click`）；§1.3 补 fixture 源头 `:13/:14` | 06 B3（3 处） |
| §2.2 `billingNote` 注释 | `quote-wiring.ts:46` | `:49`（`:48` 是其注释）；补文案生成点 `:149-152` | 06 B11 |
| §3.2 时长 hint 对齐 | `video-confirm-zone.ts:63-65` | `:59-61`（`:63-65` 是 `return { visible: true,`） | 06 B12 |
| §4.3 `settledAmount` | `product-quote.ts:120` | `:121`（`:120` 是其注释） | 06 B14 |
| §5.4 退役文件数 | 「与其**两个**测试文件退役」 | 「与其**唯一**的测试文件 `image-adjust-confirmation.interaction.test.tsx` 退役（`git rm` 两个文件）」 | 06 B4 |
| §6.3 前端镜像 | `quote-blocking.ts:226` | `quota-blocking.ts:226`（`quote-blocking.ts` 全仓不存在；行号本身正确） | 06 B34 |
| §7.2 `evaluateSubmitGate` | `video-confirm-zone.ts:105-118` | `:82`（函数声明）＋注明 `:105-118` 在函数体内 | 06 B13 |

**二次漂移：0**。06 给的正确值在 `main@a595808b` 上逐条复验全部仍成立（本稿引用的文件均不在 `7f60a4e7..a595808b` 的 diff 内）。

**未能验的**：
1. 未跑 `typecheck`／`test`／`test:interaction`／`e2e`（`locale:compile` 互斥纪律），§8 全部断言草案的可满足性仍是静态推断。
2. §4.1 引的「#261 票面验收原文」、§6.4 引的「#248 票面任务清单原文／验收门 3」**未读 GitHub 票面**，只核到 spec 与决策文档一侧。
3. §3.1 表末「分辨率全仓不存在」一行未复跑全仓穷举（其余 7 行已验）。

---

## 裁定落地（08-reconciliation，2026-07-29）

本轮**改结论 1 条 ＋ 措辞 2 组**，依据 `08-reconciliation.md` §五 Step 0：

| 裁定 | 落在本稿哪一节 | 改了什么 |
|---|---|---|
| **C8** | §5.3（新增「那个挂载点具体在哪」段与结构示意） | 确认卡与其成本反馈尾行**一并渲染进段②（创作面）尾部的 `execution-confirm-slot`**，与 `01 §2.2` 同一个挂点；**不留在 `ComposerHome` return 末尾的覆盖层**——挂末尾会让确认卡与提交按钮之间隔着整个段③，§5.3 第 2 条「商家的眼睛刚才就在这个位置」不再成立。`BriefSurface` 是 D-094 安全触发卡，语义正交，仍留末尾（§1.3） |
| **O1**（措辞） | §6.2 标题与末段、§9.2 D5 行 | 「须用户裁定」「建议新增到 `DECISIONS.md`」→ **D5 已 DECIDED（2026-07-29，用户拍板）**，裁定全文已入设计文档 D-164⑥ 补充裁定小节（`e9d1dbb4`）。**裁定方向与本节推导完全一致，结论一字未动** |
| **O2**（措辞） | §4 标题、§4.4 标题、§7 标题、§7.1 标题、§7.2 末、§7.3① 常量注释与 ③ 票下评论、§9.2 整表、头部第 6 行 | D1/D2/D3 的「须用户拍板／PENDING／若用户仍拍板『全拦』」→ **DECIDED（2026-07-29）＝条数／零新增拦截点／消息尾行**，均与本稿建议一致。§7.3 常量里的 `'all_generative'`／`'cost_threshold'` 明确降级为**留痕开关**而非待选项；§4.4 兜底方案标注「未采纳，留档」 |

**仍然阻塞的没动**：§9.1 X1-X7（等 #248／#250／#252／#255）与 §9.4 属主越界红线，裁定台账未点名，一字未动。

**本轮引用的锚点已复核**：`DECISIONS.md` D1/D2/D3/D5 状态行、设计文档 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md:3138-3144`「补充裁定（2026-07-29，用户拍板）」。
