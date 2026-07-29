# #261 设计稿（下）· 评价事件适配层／记忆一级导航／correction 处置／阻塞清单

> 承接 `03-rating-memory-events.md`（§一 评价条、§二 动作 chip）。同一份设计稿的下半，**不重复其内容**。
> 基点 main@a595808b。零 rebase 面预备产出，不含任何源码改动。
> 同批：`00-blockers.md`（开工门与属主边界）、`DECISIONS.md`（D4 chip 生成方式 PENDING）、`01-ia-three-sections.md`、`02-confirm-card-and-cost.md`

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

| 票面「五字段」 | #248 三轴扁平键（`00-blockers.md:35`） | 映射 |
|---|---|---|
| `skillId` ＋ `skillVersion` | `skillRevision` | 合并。`apps/core/src/p1/skills/types.ts:244 skillRevisionRef(skillId, revision)` → `"<skillId>@<revision>"` |
| `promptName` ＋ `promptVersion` | `promptVersion` | 合并。同形 `"<name>@<version>"`（`langfuse-sender.ts:280-281` 现有嵌套 metadata 是同两值） |
| `catalogRevision` | `catalogRevision` | 一一对应。注意 `packages/contracts/src/uiux.ts:48` 的同名字段属 `creativeExecutionContractSchema`（**执行契约**），**不是事件字段**，键名撞名不等于同源 |
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
/** TODO(#248)：与 uiux.ts:48 的同名执行契约字段不是同一个东西。 */
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
| `promptVersion` | `BrowserRecipeProjection.promptRevisionRef`（`:177`）；`langfuse-sender.ts:280-281` 的嵌套 metadata | 同上，配方级不是执行级；langfuse 那份在 core 且是嵌套结构，不出前台 |
| `catalogRevision` | `uiux.ts:48` `creativeExecutionContractSchema.catalogRevision` | 是执行契约的输入字段，不在交付回包上（`ContentPackageRevisionDelivery` 无此字段） |

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
| 字符串支持 | ✅ `buildTelemetryEvent`（`:63`，字段循环 `:79-97`）保留 string，`:95` 截 120 字符 | ❌ `sanitizeEventMeta:106` 丢弃 | 部分 |
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

### 120 字符与截断

`buildTelemetryEvent:95` 对字符串 `.slice(0, 120)`。`"<skillId>@<revision>"` 一般远短于 120，但 `skillId` 若含租户前缀有溢出风险。**适配层不做预截断**（截断会产生看起来正常的错值）；改为：**投递前若任一轴长度 > 120 则拒发并计入 `deliver_failed`**，并在票下记一条给 #248：三轴键的长度上限须与遥测通道的 120 对齐。

## 3.6 「投递失败可观测、不静默」的最小改造

现状：`emitTelemetry:101-112` 无 try/catch，`analytics.gtag?.(...)`（`:109`）若抛会冒泡到 React `onClick`；`product-telemetry.test.ts` 无失败路径断言。

**规避 #251 冲突的关键：不改 `emitTelemetry` 本体。**

`00-blockers.md:98` 已标「`product-telemetry.ts` #251 埋点通道同踩」。规避方案：

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

# 四、记忆一级导航设计（D-164④）

## 4.1 属主划界（开工前先立，越界代价最高）

D-164④ 只裁定「记忆升为一级导航可见项」与「分四域」。**导航与页面是前台事，四域的数据生产不是。**

| 事项 | 本票（#261）做 | 等 **#251**（记忆与沉淀管道） | 等 **#259**（Skill 维护面／第八能力域） |
|---|---|---|---|
| `Routes.Memory` 常量与路由文件 | ✅ | | |
| `BUSINESS_NAVIGATION` 第 5 项 ＋ 图标 ＋ 移动底栏 | ✅ | | |
| 四域 tab 结构、空态、四态机、i18n | ✅ | | |
| 消费**已有**查询（`preference_view` 等） | ✅ 只读 | | |
| 新增后端命令／模块／契约 | ❌ | ✅ | |
| `correction` 立为一等 kind（`reuse-memory.ts:294`） | ❌ | ✅ | |
| 被动沉淀管道、四态拦截、候选证据链、入库红线 | ❌ | ✅ | |
| 「确认系统提议的沉淀」的**确认动作**（`propose_*→confirm_*` 前台面） | ❌ | ✅ 属主 | |
| Skill 目录查询（`skills` 模块无 query，`apps/core/src/p1/skills/foundation-module.ts` 仅命令） | ❌ | | ✅ 属主 |
| 「工作流」域的配方来源 | ✅ 复用**已有**配方投影（`recipe-cards.ts:107`） | | ❌ 不碰 `skills` 模块 |

> **一句话**：#261 建的是一间**有四个货架的空店**，货由 #251／#259 上。空店必须先建好，否则 D-164④ 的立论（「护城河必须商家一眼看得见」）在前台没有承载物。

## 4.2 路由与导航改动清单

### ① `src/lib/routes.ts`（Dashboard routes 段 `:27-38`；下面 diff 的三行上下文实际落在 `:35`／`:36`／`:37`）

```diff
   ContentLibrary: '/dashboard/works',
   StoreProfile: '/dashboard/store',
+  /** D-164④ 记忆升一级导航。四域＝门店主体偏好／项目／工作流／纠正。 */
+  Memory: '/dashboard/memory',
   ContentWorkspace: '/dashboard/workspace',
```

### ② `src/lib/uiux/navigation.ts:10-39` `BUSINESS_NAVIGATION`

```diff
 import {
   product_navigation_assets,
   product_navigation_content,
+  product_navigation_memory,
   product_navigation_store,
   product_navigation_workbench,
 } from '@/locale/paraglide/messages';
@@
   {
     id: 'store',
     get label() { return product_navigation_store(); },
     href: Routes.StoreProfile,
   },
+  {
+    id: 'memory',
+    get label() { return product_navigation_memory(); },
+    href: Routes.Memory,
+  },
 ] as const;
```

**位次：放最后。** 前四项是「做事」（工作台→内容→素材→门店），记忆是「系统学到的」，语义上是这条链的产物。放中间会打断创作动线。

### ③ `src/config/sidebar-config.ts:50-58` `businessIcons`

```diff
 const businessIcons: Record<
   (typeof BUSINESS_NAVIGATION)[number]['id'],
   ShellIcon
 > = {
   workbench: IconSparkles,
   content: IconFileText,
   assets: IconFolders,
   store: IconBuildingStore,
+  memory: IconBookmarks,
 };
```

> **这里有一道天然护栏**：`businessIcons` 的键类型由 `BUSINESS_NAVIGATION` 推导，只加导航不加图标 **typecheck 直接红**。写下来是为了让人别以为是「顺手」。
>
> `IconBookmarks` 为首选（「记下来的」比脑图标 `IconBrain` 更贴门店橱窗语言，不拟机器）。**本 worktree 未装 `node_modules`，未能核实该导出名**；若不存在，退 `IconListDetails`（`sidebar-config.ts:29` 已 import，保证存在）。不要选 `IconHistory`（`:28` 已被 admin 审计占用，同壳两处同图不同义）。

### ④ `src/components/product/mobile-nav.tsx:55` 栅格

```diff
-      className="... grid h-[4.25rem] grid-cols-4 rounded-[28px] px-1.5 ..."
+      className="... grid h-[4.25rem] grid-cols-5 rounded-[28px] px-1.5 ..."
```

影响核算：375px 屏，`inset-x-3`（左右各 12px）＋ `px-1.5`（各 6px）→ 可用 ≈ 339px ÷ 5 ≈ **67.8px/列**。
- 命中：`itemClassName`（`:12`）已有 `min-h-11`，44px 高度不受列宽影响 ✅
- 文字：五个 label 全是 2 字（工作台是 3 字），`:78` 已有 `truncate` ✅ ——「工作台」在 67.8px 内按 12px 字号（`text-xs`）约需 36px，充裕
- 图标：`:77` `size-5`（20px）居中 ✅

**真正的红在测试，不在样式**：

### ⑤ `src/components/product/mobile-nav.static.test.ts`（必改，须留痕）

```diff
-test('the four business destinations are unchanged by the sync (nav 四项合同)', () => {
+test('the five business destinations are unchanged by the sync (nav 五项合同)', () => {
   assert.deepEqual(
     BUSINESS_SIDEBAR_ITEMS.map((item) => item.id),
-    ['workbench', 'content', 'assets', 'store']
+    ['workbench', 'content', 'assets', 'store', 'memory']
   );
```

`:39-42` 是 id 硬断言，用例名（`:34`）写死「nav 四项合同」；同一用例内 `:35-38` 还有一条 href `deepEqual`（比 `BUSINESS_SIDEBAR_ITEMS` 与 `BUSINESS_NAVIGATION`），**上面的 diff 只呈现了 id 那条，href 那条会随导航新增自动跟随、无需改**。**这是一条被有意固化的合同**，改它必须在票下评论引 D-164④ 原文留痕，不能当作顺手修红。
`:20-32` 那条独立用例的断言（不得出现 `Routes.ContentLibrary` 等第二份清单）**不受影响且必须保持通过** —— 新增项走 `BUSINESS_SIDEBAR_ITEMS.map`，本来就不会在此文件出现 `Routes.Memory`。

### ⑥ `scripts/check-locale-keys.ts`

```diff
 const REQUIRED_PRODUCT_KEYS = [
   ...
   'product_navigation_content',
+  'product_navigation_memory',
   'product_navigation_settings',
```

- `RETIRED_NAVIGATION_KEYS`（`:28-40`）**不动** —— `memory` 是新增不是复活。
- `PRODUCT_SHELL_SOURCES`（`:42-90`）已含 `src/lib/uiux/navigation.ts`（`:43`）与 `src/config/sidebar-config.ts`（`:49`），**无需追加**。
- ⚠️ 但 `sourceHasCjkOutsideComments`（`:97`）会对这两个文件做混轨校验：**label 必须走 paraglide 键，不得在源码写「记忆」二字**（注释里可以）。
- 新增的记忆页面文件（`src/routes/dashboard/memory.tsx` 等）**是否加入 `PRODUCT_SHELL_SOURCES`**：建议加，与既有产品面同纪律；这会把「页面内所有中文必须走 i18n」变成 CI 强制。

### ⑦ 现状确认

`project.inlang/messages/zh.json` 全文**无 `memory_*` 前缀键，「记忆」二字零命中**（「沉淀」一词出现两处，均指素材库：`workspace_assets_description:3953`、`workspace_sample_isolation_note:3963`）。全部为新增，无键名冲突。

## 4.3 四域页面结构与数据源

路由：`/dashboard/memory`，四域为**同页四 tab**（不是四路由）。理由：D-043 ≤2 击；且四域早期几乎全空，四个路由等于四个空页。

| 域（tab） | tab id | D-164④ 对应 | 现有数据源 file:line | 判定 |
|---|---|---|---|---|
| **门店主体偏好** | `identity` | MarketingIdentity（D-142） | ① `marketing-identity` 模块已通电（`apps/core/src/main.ts:1623` 挂载 `MarketingIdentityFoundationModule`，`apps/core/src/p1/operations/marketing-identity.ts:1311`），模块名已在前台白名单 `packages/contracts/src/p1.ts:28`<br>② `preference_view`（`apps/core/src/p1/operations/asset-memory-foundation-module.ts:423` → `reuse-memory-service.ts:1003`，返回 `{signals, candidates, preferences}`），前端**零引用** | **有数据源**（两个）。#261 只读 |
| **项目**（一次营销活动） | `projects` | —— | **无**。全仓无 project/campaign 实体。最近亲＝`CreativeWork`（`CreativeWorkbenchProjection`，前端已消费于 `today-recommendation-card.tsx:204-213`），但那是「作品」不是「一次营销活动」 | **需上游，属主未定** → 阻塞项 B4，本轮**空态占位** |
| **工作流**（一条产线或配方） | `workflows` | 配方 | `BrowserSurfaceProjection.recipes`（`packages/contracts/src/creation-experience.ts:228`）→ 前端已有投影 `src/product/composer/recipe-cards.ts:107 listColdCardsFromRecipes` / 冷态种子 `:58 listColdCardsFromSeeds`（`launch-card-seeds.ts:86 LAUNCH_CARD_SEEDS`） | **有数据源**（复用配方卡投影）。**禁碰 `skills` 模块**（`00-blockers.md:100`，属 #259） |
| **纠正** | `corrections` | `correction`（D-163②） | **无**。`packages/contracts/src/reuse-memory.ts:294` kind 枚举 ＝ `['adopted','modified','rejected']` | **需 #251** → 见 §五，本轮**空态占位** |

**四域全部渲染，两域有货两域空。** 不因为空就藏 tab —— D-164④ 的产品意图是「让商家一眼看见系统在学什么」；藏掉一半等于只展示了一半的承诺，且商家会在 #251 合入后看到导航结构突变。

**「门店主体偏好」域为何双数据源**：D-164④ 明确写「对应 MarketingIdentity」，但 `preference_view` 的 `preferences`（`reuse-memory.ts:314 preferenceSchema`，含 `positiveExamples`/`negativeExamples`/`evidenceDecisionIds`）才是「经 `propose→confirm` 沉淀下来的门店偏好」——正是 D-159② 的策展产物。两者一个是「她是谁」（口吻/边界/禁语），一个是「她认可过什么」。同域两块，不合并渲染。

**每域条目卡的最小形态**（不做编辑、不做删除 —— 那是 D-160② 的「可编辑可删除」，属 #251/#259 的写路径）：
标题 ＋ 一句人话说明 ＋「从哪来的」来源行（`preferenceSchema`（`reuse-memory.ts:314`）的 `evidenceDecisionIds:327` 提供证据链；注意 `:306` 是 `preferenceCandidateSchema` 的同名字段，别引错，但 **id 不得上屏** —— 参照 `today-recommendation-card.tsx:94-115 recommendationFactLabels` 的做法：只出名字与条数，认不出的降级为计数）。

## 4.4 冷启动空态：与 D-126 同构的四态机

D-164 待验证原文：「记忆一级导航的**内容密度**：门店层沉淀在早期近乎为空，一级入口点进去是空页的冷启动问题未解（**与 D-126 冷态机制可能需要同构处理**）」。

**采纳同构。** 逐行照抄 `today-recommendation-card.tsx:66-86` 的形状：

```ts
/** 与 today-recommendation-card.tsx:66-70 TodayRecommendationView 同构。 */
export type MemoryDomainView =
  | { kind: 'cold' }
  | { kind: 'pending' }
  | { kind: 'stale' }
  | { kind: 'current'; entries: readonly MemoryEntryView[] };

/**
 * 与 today-recommendation-card.tsx:77-86 todayRecommendationView 同构。
 * W04 那条注释在记忆面同样成立，且更要紧：一个已经做过十条内容的门店，
 * 若因查询失败被告知「还没有沉淀」，她得到的结论是「这产品没在学」——
 * 而「越用越懂我」正是 D-164④ 立这个入口的全部理由。
 */
export function memoryDomainView(
  state: { entries?: readonly MemoryEntryView[]; stale?: boolean } | undefined,
  workspaceHasWork = false
): MemoryDomainView {
  if (!state?.entries?.length) {
    if (state?.stale) return { kind: 'stale' };
    return { kind: workspaceHasWork ? 'pending' : 'cold' };
  }
  return { kind: 'current', entries: state.entries };
}
```

**`workspaceHasWork` 复用同一个判据，不重写**：`today-recommendation-card.tsx:169 workbenchHasWork(workbench.data)`（`:174-178`＝assets/contents/已完成 works/有产出 jobs 四者之一）。两个面用两套「有没有做过事」的判据，迟早会出现推荐卡说 pending、记忆页说 cold 的自相矛盾。

**「降级不得伪装成冷启动」在记忆面如何成立**：

| 触发 | 态 | 判据落点 |
|---|---|---|
| `queryP1` 抛错 / `useQuery.isError` | `stale` | 由页面把 `{stale: true}` 传进 `memoryDomainView` |
| 查询成功、`entries` 空、工作区**有**产出 | `pending` | `workspaceHasWork === true` |
| 查询成功、`entries` 空、工作区**无**产出 | `cold` | `workspaceHasWork === false` |
| 上游未接（`corrections`/`projects` 域，#251 前） | `pending`（**不是 cold**） | 该域数据源缺失 ≠ 商家没沉淀过；见下 |

⚠️ **未接上游的两域用 `pending` 而非 `cold`**：`cold` 的文案会说「还没有沉淀」——对一个已经用了一个月的门店，这是**假话**（真相是我们还没建管道）。`pending` 的语义是「这里暂时还没出来」，对两种原因都诚实。这条与 W04 注释「a degraded projection must not disguise itself as a cold start」是同一条纪律的延伸。

## 4.5 各域各态文案（商家语言，D-116；参照 D-126 拟人化口径）

| 域 | 态 | 标题 | 说明 |
|---|---|---|---|
| 门店主体偏好 | cold | 还没记下你的口吻 | 做上几条内容，或者去门店档案里说说你想给客人什么感觉，这里就会长出来。 |
| | pending | 这次没取到 | 你的口吻是有的，只是这会儿没读出来。待会儿再看一眼。 |
| | stale | 刚才没连上 | 记下来的东西都还在，是这次没读到。刷新一下试试。 |
| | current | —— | （直接列条目） |
| 项目 | cold | 还没有做过的活动 | 一次营销活动做完，这里就会留一条，下次照着来会快很多。 |
| | pending | 这里还在攒 | 你做过的内容我记着，按活动归拢还要一点时间。 |
| | stale | 刚才没连上 | 同上 |
| 工作流 | cold | 还没有自己的做法 | 你常用的那套流程，用顺手了我会替你记下来，下次一键就能再来一遍。 |
| | pending | 这里还在攒 | 再做几条，我就能看出你固定的做法了。 |
| | stale | 刚才没连上 | 同上 |
| 纠正 | cold | 还没有改过我 | 我写得不对的地方，你改一次我记一次——改过的地方比夸奖更管用。 |
| | pending | 这里还在攒 | 你改过的地方我在收，还没整理好。 |
| | stale | 刚才没连上 | 同上 |

**三条文案纪律**：① 全部第一人称「我」，与 D-116 拟人化交付合同同口径（D-126「周五晚是美甲预约高峰」同款）；② 零工程词（无「数据」「同步」「加载」「服务」）；③ cold 态一律给**下一步动作**而不只是描述空 —— 空页配空话是 D-164④ 待验证项点名的失效形态。

## 4.6 i18n 新增键清单

| key | zh | en | 用处 |
|---|---|---|---|
| `product_navigation_memory` | 记忆 | Memory | 一级导航项（`navigation.ts` ＋ `check-locale-keys.ts` REQUIRED） |
| `memory_page_title` | 记忆 | Memory | 页面标题 |
| `memory_page_description` | 这里是我从你这儿学到的东西，用得越久越准。 | What I have learned from you. | 页面副标题（D-164④「一眼看得见」） |
| `memory_tab_identity` | 门店口吻 | Store voice | tab 1 |
| `memory_tab_projects` | 做过的活动 | Campaigns | tab 2 |
| `memory_tab_workflows` | 你的做法 | Your workflow | tab 3 |
| `memory_tab_corrections` | 你改过的 | Your corrections | tab 4 |
| `memory_identity_cold_title` | 还没记下你的口吻 | No voice recorded yet | 见 §4.5 |
| `memory_identity_cold_description` | （§4.5） | （§4.5） | |
| `memory_identity_pending_title` | 这次没取到 | Not loaded this time | |
| `memory_identity_pending_description` | （§4.5） | | |
| `memory_projects_cold_title` | 还没有做过的活动 | No campaigns yet | |
| `memory_projects_cold_description` | （§4.5） | | |
| `memory_projects_pending_title` | 这里还在攒 | Still gathering | |
| `memory_projects_pending_description` | （§4.5） | | |
| `memory_workflows_cold_title` | 还没有自己的做法 | No workflow yet | |
| `memory_workflows_cold_description` | （§4.5） | | |
| `memory_workflows_pending_title` | 这里还在攒 | Still gathering | |
| `memory_workflows_pending_description` | （§4.5） | | |
| `memory_corrections_cold_title` | 还没有改过我 | No corrections yet | |
| `memory_corrections_cold_description` | （§4.5） | | |
| `memory_corrections_pending_title` | 这里还在攒 | Still gathering | |
| `memory_corrections_pending_description` | （§4.5） | | |
| `memory_stale_title` | 刚才没连上 | Could not load | 四域共用 |
| `memory_stale_description` | 记下来的东西都还在，是这次没读到。刷新一下试试。 | Nothing was lost — it just did not load. Try again. | 四域共用 |
| `memory_stale_retry` | 再试一次 | Try again | stale 态按钮 |
| `memory_identity_preferences_heading` | 你认可过的 | What you confirmed | 门店口吻域第二块（`preference_view`） |
| `memory_entry_source` | 从哪来的 | Where this came from | 条目来源行 |
| `memory_entry_evidence_count` | 有 {count} 条依据 | {count} pieces of evidence | 证据条数（id 不上屏） |
| `memory_tabs_aria` | 记忆分类 | Memory categories | tab 容器 aria-label |

共 **31 键**（zh/en 各一份）。全部为新增，`RETIRED_NAVIGATION_KEYS` 无冲突。

---

# 五、`correction` 一等 kind 的处置

## 5.1 现状

`packages/contracts/src/reuse-memory.ts:294`（在 `preferenceSignalSchema` `:285-297` 内，schema 带 `.strict()`）：

```ts
kind: z.enum(['adopted', 'modified', 'rejected']),
```

D-163② 裁定 B 要求增设 `correction`，且「其权重高于普通偏好」。D-164④ 把它列为记忆四域之一。

## 5.2 判断：**由 #251 改，不是 #261**

三条理由，第一条是制度性的，后两条是技术性的：

1. **属主明写**。`docs/specs/agent-substrate-dev-spec-2026-07-29.md:601` 语义锁把「记忆管道」锁给 #251；`:515` 的票包表把「（v2）沉淀管道 —— 四态拦截／候选证据链／入库红线」记在 #251 名下。`00-blockers.md:99` 已把「自建 `correction` kind → 撞 `reuse-memory.ts:294` 枚举属主」列为越界后果。
2. **它是写入侧的枚举，不是展示侧的**。`kind` 挂在 `preferenceSignalSchema` 上 —— 那是 `record_preference_signal`（`asset-memory-foundation-module.ts:325`）的入参形状，属**信号写入**。#261 是消费面，改写入侧枚举等于从展示端反向定义生产端。
3. **它带一条纯后端语义**。「权重高于普通偏好」是归纳阶段的加权规则，落在 `ReuseMemoryService`（`reuse-memory-service.ts:515`）里；只加枚举值不加权重，等于加了一个没有行为差异的字面量 —— 把 D-163② 的裁定做成半条。

## 5.3 若前端先行会撞什么（三条，均可复现）

| # | 撞点 | 表现 |
|---|---|---|
| 1 | `preferenceSignalSchema` 带 `.strict()`（`reuse-memory.ts:297`），`z.enum` 闭集 | 前端发 `kind:'correction'` → `asset-memory-foundation-module.ts:88 parse()` 抛 `P1DomainError('INVALID_STATE','Invalid asset-memory payload.')`。**运行时才炸，typecheck 不拦** |
| 2 | 写路径全在 core（`record_preference_signal` `:325` → `reuse.recordPreferenceSignal`） | 前端无论如何改不了落库的 kind；只能改自己怎么渲染 |
| 3 | 语义分叉 | 若前端自建一个「UI 层的 correction 概念」（如按 `modified` 过滤后改标签叫「纠正」），#251 合入真 kind 后会有两套 correction 定义，且前者是错的（`modified` ≠ 纠正）。**这正是 `[feedback-partition-by-semantics-not-files]` 记录的失效模式**：文件面不冲突、语义面互斥，合入才暴露 |

## 5.4 规避方案（#261 本轮怎么做）

1. **「纠正」域渲染成 `pending` 空态**（§4.4 已定：未接上游用 pending 不用 cold），页面结构、卡片形态、四态机与其余三域**完全一致**。#251 合入后只需把数据源接上，**零结构改动**。
2. **不在前端落 `'correction'` 这个字符串字面量。** 域 id 用复数 `corrections`，且在代码注释里写明：

```ts
/**
 * UI tab id，不是 reuse-memory 的信号 kind。
 * D-163② 的 `correction` kind 属 #251（reuse-memory.ts:294 枚举）；
 * 本文件不得出现该字面量，避免成为第二真相源。
 */
const MEMORY_TAB_CORRECTIONS = 'corrections';
```

3. **不做 `modified` → 「纠正」的映射**。`modified` 是「商家改了这一版」，`correction` 是「商家纠正了系统的先验」——D-163② 说它「信噪比最高」正因为它区别于普通修改。拿 `modified` 充数会污染 D-160⓪ 的归纳输入。
4. **反向依赖登记**：#261 需要 #251 在建 `correction` 时**同时给出一条读取查询**（现有 `preference_view` `:423` 返回 `{signals, candidates, preferences}`，若 correction 信号混在 `signals` 里则前台需自行过滤 —— 那就又要求前台知道 kind 字面量，回到问题 1）。**建议向 #251 提：correction 需要独立的查询出口或在 `preference_view` 上分组返回。** 这条写进 §六 阻塞。

---

# 六、阻塞项清单

## 6.1 硬阻塞（不合入就根本做不了）

| # | 阻塞项 | 卡住本文件哪一段 | 等谁 | 判据（可脚本化） |
|---|---|---|---|---|
| **B1** | 三轴扁平顶层键的**键名与格式** | §3.3 适配层的占位类型、§3.5 allowlist 字段名、§3.7 验收 1 的 `toMatchObject` | **#248** | `packages/contracts/src/*.ts` 中 `skillRevision`/`promptVersion`/`catalogRevision` 三键同现（`00-blockers.md:14` G2；现 `skillVersion`/`skillRevision` **全仓 0 处**） |
| **B2** | 事件的**落库端**（ingest 路由或 sender） | §3.5 的 A′ 只保证 payload 正确；spec `:507`「信号落库并进入『已验证』层」**#261 单独不可兑现** | **#248** | 存在一个非 no-op 的投递目的地；现 `product-telemetry.ts:107` 的 `meiye:telemetry` 全仓零监听、gtag/plausible/umami 仅 PROD |
| **B3** | 「**场景**」字段的归属（三轴之外的第四键？） | §3.2 表末行、§3.3 的 `scene` 占位 | **#248** | #248 契约中出现场景键，或书面裁定它并入某轴 |
| **B4** | 三轴的**数据来源**（Task 快照钉扎） | §3.4 —— main 上三轴取不到，生产路径一条都发不出 | **#262**（D-165②） | 交付回包／session 快照上能读到三轴 |
| **B5** | `correction` 一等 kind ＋ 其**读取出口** | §4.3「纠正」域、§5 全节 | **#251** | `reuse-memory.ts:294` 枚举含 `correction`，且有分组/独立查询（§5.4 第 4 条） |
| **B6** | 「**项目**（一次营销活动）」的实体与查询 | §4.3「项目」域 | **属主未定** ⚠️ | 全仓无 project/campaign 实体；**这一条没有已知属主票**，须主控裁定归 #251 还是另开 |
| **B7** | 前序 lane 票 `#264FE` 合入 | 全部前台改动（D lane 串行 `#264FE→#261→#253FE`，spec `:596/:601`） | **#264FE** | `00-blockers.md:17` G4：`videoRegenScopes = ['shot']` 已摘（`:16` 是 G3b／#262，勿混） |
| **B8** | `locale:compile` 互斥锁 | 任何跑 `test:interaction` 的动作 | **#266** | `00-blockers.md:13` G1 |

## 6.2 软阻塞（可先做、但结论可能翻）

| # | 项 | 影响 | 等谁 |
|---|---|---|---|
| **S1** | `DECISIONS.md` **D4 动作 chip 生成方式** 仍 PENDING | §二 全节按「固定集合」写；若拍板改「模型即时生成」，§2.2-2.4 作废 | 用户 |
| **S2** | verdict 值集合（是否支持撤回，§1.6 ⚠️） | §1.6 的 `up_cleared`；若 #248 只给 `up|down`，撤回信号有损 | #248 |
| **S3** | `IconThumbUp`/`IconThumbDown`/`IconBookmarks` 的实际导出名 | §1.3、§4.2③ —— 本 worktree 无 `node_modules` 未能核实 | 装依赖后自查 |
| **S4** | 记忆页面是否进 `check-locale-keys.ts` 的 `PRODUCT_SHELL_SOURCES` | §4.2⑥ —— 进则页面内中文全部强制走 i18n | 主控口径 |

## 6.3 本票发现、但**不属本票**的三条（只登记，不修）

| # | 发现 | file:line | 建议归属 |
|---|---|---|---|
| **N1** | **契约与运行时背离**：`CreationExperienceEvent.meta` 类型声明允许 `string`，运行时清洗把字符串全丢 | 声明 `packages/contracts/src/creation-experience.ts:599`；清洗 `apps/core/src/p1/creation-experience/creation-experience-events.ts:95-101,106` | #248 或单开票（typecheck 通过、运行时静默丢字段，属最难查一类） |
| **N2** | 成品卡现有三动作命中区不足 44px（`px-3 py-1` ≈26px，低于 `DESIGN.md:192`） | `composer-delivery-card.tsx:113` | 既有问题，不顺手改（属主纪律）；建议并入前台 a11y 批 |
| **N3** | `mobile-nav.static.test.ts` 的「nav 四项合同」是被有意固化的合同 | `src/components/product/mobile-nav.static.test.ts:34`（用例名）、`:39-42`（id 硬断言） | 本票必须改（§4.2⑤），须在票下引 D-164④ 原文留痕 |

---

## 附：本文件新增/改动文件总览

**新建（5）**
- `mkfast-template-main/src/product/composer/composer-delivery-rating-bar.tsx`
- `mkfast-template-main/src/product/composer/delivery-rating-event.ts`（#261 独占，含失败计数）
- `mkfast-template-main/src/product/composer/delivery-followup-seeds.ts`
- `mkfast-template-main/src/product/composer/composer-delivery-rating.interaction.test.tsx`
- `mkfast-template-main/src/routes/dashboard/memory.tsx`（＋其 model/view 拆分与 interaction test）

**改动（8）**
| 文件 | 改什么 | 属主风险 |
|---|---|---|
| `src/product/composer/composer-delivery-card.tsx` | 加 2 段渲染 ＋ 2 个 prop；`:31-37` 三动作**不动** | 低（本 lane 独占） |
| `src/product/composer/composer-conversation.tsx:199,299` | 透传 `onFollowUp`/`onRate` | 低 |
| `src/product/composer/composer-home.tsx:2765-2789` | 新增 follow-up 落点（复用同三步，lens 取交付物自身）；注释 "Both CTAs" → "三处 CTA" | 中（与 #253FE 同文件，lane 内串行） |
| `src/lib/product-telemetry.ts:3-18` | allowlist **追加一条**，不动 `:101` 本体 | 中（#251 同踩；仅数据行，可自动合） |
| `src/lib/routes.ts` | 加 `Memory` | 低 |
| `src/lib/uiux/navigation.ts:10-39` | 加第 5 项 | 低 |
| `src/config/sidebar-config.ts:50-58` | 加图标（不加则 typecheck 红） | 低 |
| `src/components/product/mobile-nav.tsx:55` ＋ `mobile-nav.static.test.ts:34,39-42` | `grid-cols-4→5`；改「四项合同」用例名与 id 断言 | **需留痕** |
| `scripts/check-locale-keys.ts:6` | REQUIRED 加 1 键 | 低 |
| `project.inlang/messages/{zh,en}.json` | 新增 31 键 ×2 | 低 |

**不碰**：`packages/contracts/src/**`、`apps/core/**`、`skills` 模块、`reuse-memory.ts:294`、`emitTelemetry` 本体、D-126 推荐卡合同（`today-recommendation-card.tsx` 仅**读取**其 `todayRecommendationView`/`workbenchHasWork` 作同构参照，不改）。

---

# 七、上游回填：#248 合同已落 main（2026-07-29，main@7f60a4e7）

本文件 §3.2–§3.5 写作时三轴合同尚未合入，故用了占位类型与 `TODO(#248)`。**该合同现已合入**，落点 `packages/contracts/src/observability.ts`。以下三处按实际契约回填，**§3.2 的悬空问题与 §3.5 的通道疑点均已被上游答掉**。

## 7.1 实际契约（逐字）

`packages/contracts/src/observability.ts` 全文 43 行，逐字如下（行号即 main 上的行号）：

```ts
 1  import { z } from 'zod';
 2
 3  const compositeRevisionSchema = z
 4    .string()
 5    .trim()
 6    .regex(/^[^@\s]+@[^@\s]+$/u);
 7
 8  export const observabilityAxesSchema = z
 9    .object({
10      skillRevision: compositeRevisionSchema,
11      promptVersion: compositeRevisionSchema,
12      /**
13       * Event-attribution revision. This is distinct from
14       * CreativeExecutionContract.catalogRevision, which pins the accepted
15       * execution catalog contract.
16       */
17      catalogRevision: z.string().trim().min(1),
18      scene: z.string().trim().min(1),
19    })
20    .strict();
21
22  export type ObservabilityAxes = z.infer<typeof observabilityAxesSchema>;
23
24  export const observabilitySignalSchema = z.enum([
25    'trace',
26    'log',
27    'metric',
28    'score',
29    'feedback',
30  ]);
31
32  export const observabilityDropEventSchema = z
33    .object({
34      signal: observabilitySignalSchema,
35      reason: z.enum(['permanent-config', 'transient']),
36      count: z.number().int().positive(),
37      source: z.string().trim().min(1),
38    })
39    .strict();
40
41  export type ObservabilityDropEvent = z.infer<
42    typeof observabilityDropEventSchema
43  >;
```

两处易被漏掉：`signal` 的五值枚举是**独立导出** `observabilitySignalSchema`（`:24-30`），不是内联 `z.enum`；`ObservabilityDropEvent` 类型也已导出（`:41-43`）。

## 7.2 §3.2 的三个悬空问题，逐条结清

| 本票提出的问题 | 上游答复 | 对设计稿的影响 |
|---|---|---|
| 「场景」是三轴之外的第四个顶层键，还是收进某一轴？ | **是第四个顶层键**：`scene: z.string().trim().min(1)` | §3.3 的 `scene` 占位名**猜对了**，`TODO(#248)` 可摘。类型直接 `import type { ObservabilityAxes } from '@meiye/contracts'`——全仓无 `@contracts/*` 路径别名（`mkfast-template-main/tsconfig.json:23-26` 只有 `@/*` 与 `content-collections`），且 `@meiye/contracts` 的 `exports` 只有 `"."`，**没有子路径导出**，不能写 `@meiye/contracts/observability` |
| 五字段 → 三轴怎么合并？ | `compositeRevisionSchema` 正则 `^[^@\s]+@[^@\s]+$` **强制**恰好一个 `@`、两侧非空且无空白 | §3.2 映射表**成立**：`skillId@revision` / `promptName@version`。但正则比设想更严——**skillId 或 promptName 自身含 `@` 或空格会被拒**，适配层组装后须先过 schema 再投递 |
| `catalogRevision` 与 `uiux.ts:48` 的同名字段撞名 | **上游已在契约注释里显式划清**：「distinct from `CreativeExecutionContract.catalogRevision`, which pins the accepted execution catalog contract」 | §3.2 末行的告警成立且已被上游确认。适配层**不得**把执行契约的 `catalogRevision` 直接搬过来当事件轴，两者是不同的 revision |

## 7.3 §3.6「投递失败可观测」有官方合同了，不再自造计数器

§3.6 原方案是在适配层自建失败计数器。**上游已给出丢弃事件一等合同** `observabilityDropEventSchema`，本票应**消费它而不是自造**：

| 原设计 | 回填后 |
|---|---|
| 自建 `deliver_failed` 计数 | 发一条 `ObservabilityDropEvent`：`{signal:'feedback', reason, count, source}` |
| 失败原因自定义字符串 | 用闭集 `'permanent-config' \| 'transient'`。映射：sink 缺失/被广告拦截器屏蔽＝`permanent-config`；网络抖动/超时＝`transient` |
| `source` 未定义 | 取本票适配层的稳定标识（如 `'dashboard.rating-bar'`），值须与 #248 的对账口径对齐 |

⚠️ 仍**未**解决的一条：`observabilityDropEventSchema` 只定了**事件形状**，没定**投递目的地**。#248 票面写「目的地=Postgres 为工作假设，最终以本票『信号 × 目的地』矩阵裁定为准」——**该矩阵尚未落库**。故 `00-blockers.md` 的 **G3/B2「落库端」仍然阻塞**，本节只是把 payload 形状从自造改成了消费上游合同。

## 7.4 §3.5「120 字符截断」的复核结论

`observabilityAxesSchema` **没有**长度上限，而遥测通道 `mkfast-template-main/src/lib/product-telemetry.ts:95` 对字符串 `.slice(0, 120)`。两者未对齐这一条**依然成立**，§3.5 末尾给 #248 的那条建议**不撤**：三轴键的长度上限须与遥测通道的 120 对齐，否则长 `skillId` 会被静默截成看起来正常的错值。适配层维持「超长拒发并计入 drop 事件」的口径。

---

## 锚点校准（2026-07-29，基点 main@a595808b）

本轮只改 `file:line` 锚点、基点标注与两处被引文本的转录，**未改任何结论、判断或设计取舍**（§3.5 A′ 通道选择、§4.4 四态机、§5 correction 归属、§6 阻塞清单的等谁一列一字未动）。依据 `06-xcheck-reverse.md §一`，并逐条在 `main@a595808b` 上复验。

**本稿改动 33 处锚点 ＋ 1 处基点标注**：

| 处 | 原 | 现 | 来源 |
|---|---|---|---|
| 头部 · 基点 | `main@cc04918d` | `main@a595808b` | 06 O7 |
| §3.2 三轴扁平键出处 | `00-blockers.md:29`（空行） | `:35`（票面偏差 #2，逐项列 `observabilityAxesSchema` 四键） | 06 B30 |
| §3.2 `skillRevisionRef` | `skills/types.ts:184` | `:244`（`:184` 现在是 `settlementStatus`） | 06 A1 |
| §3.2／§3.4 langfuse 嵌套 metadata | `langfuse-sender.ts:278-279` | `:280-281` | 06 A2（2 处） |
| §3.2／§3.3 注释／§3.4／§7.2 撞名字段 | `uiux.ts:44` | `:48`（`:44-47` 是 #248 新插入的 4 行注释） | 06 A3（4 处） |
| §3.5 表／§3.5 正文／§7.4 截断点 | `product-telemetry.ts:94` | `:95`；表内另补 `buildTelemetryEvent` 声明在 `:63` | 06 B18（3 处） |
| §3.5／§7.4 小节标题 | 「128 字符…」 | 「120 字符…」（通道实际截断为 120，正文一直写对） | 06 B19（2 处） |
| §3.6 #251 同踩标注 | `00-blockers.md:63` | `:98`（属主边界表内 `product-telemetry.ts` 行） | 06 B31 |
| §4.2① routes.ts 段界 | 「`:28-33` 附近」 | 「Dashboard routes 段 `:27-38`；diff 三行上下文实际在 `:35/:36/:37`」 | 06 B23 |
| §4.2⑤／§6.3 N3／附表 nav 合同 | `mobile-nav.static.test.ts:38-42` | `:39-42`（id 硬断言）＋ `:34`（用例名）；并补记同用例 `:35-38` 的 href `deepEqual`（上面 diff 未呈现、无需改） | 06 B24（3 处） |
| §4.2⑤ 另一条用例范围 | `:22-32` | `:20-32` | **本轮新发现** |
| §4.2⑦ 「沉淀」命中数 | 仅 `:3953` 一处 | 两处：`:3953` ＋ `workspace_sample_isolation_note:3963` | 06 B27 |
| §4.3 marketing-identity 挂载点 | `apps/core/src/main.ts:1604` | `:1623`（**二次漂移**，见下） | 06 A4 |
| §4.3 `BrowserSurfaceProjection.recipes` | `creation-experience.ts:227` | `:228`（`:227` 是 `contentHash`） | 06 B22 |
| §4.1 表／§4.3 配方投影 | `recipe-cards.ts:104` / `:57` | `:107` / `:58` | 06 B7／B6（3 处） |
| §4.3 冷态种子 | `launch-card-seeds.ts:101` | `:86 LAUNCH_CARD_SEEDS`（`:101` 是某条 seed 内部的 `notePageBound`） | 06 B8 |
| §4.3 不碰 skills | `00-blockers.md:65` | `:100` | 06 B32 |
| §4.3 证据链字段 | `evidenceDecisionIds:319` | `:327`（并注明 `preferenceSchema` 在 `:314`、`:306` 是 `preferenceCandidateSchema` 的同名字段） | 06 B20 |
| §5.2 correction 越界后果 | `00-blockers.md:64` | `:99` | 06 B32 |
| §5.3 `.strict()` | `reuse-memory.ts:296` | `:297`（`:296` 是 `})`） | 06 B21 |
| §6.1 B7 判据 | `00-blockers.md:16` | `:17`（G4；`:16` 是 G3b／#262） | 06 B33 |
| §6.3 N2 命中区依据 | `DESIGN.md:191` | `:192` | 06 B1 |
| §7.1 「逐字」契约 | 内联 `z.enum`、漏 `ObservabilityDropEvent` 类型 | 换成 `observability.ts` 真正的 43 行逐字转录 ＋ 行号 | 06 B26 |
| §7.2 类型 import | `from '@contracts/observability'` | `from '@meiye/contracts'`（全仓无 `@contracts/*` 别名；该包 `exports` 只有 `"."`，无子路径导出） | 06 B25 |

**其中 2 条与 06 不同 / 06 未报**：

1. **§4.3 `main.ts` 挂载点（二次漂移）**：06 给的正确值是 `:1622`（写作基点 `main@7f60a4e7`）。`7f60a4e7..a595808b` 之间 #247 改了 `apps/core/src/main.ts`，`new MarketingIdentityFoundationModule(` 现在在 **`:1623`**。取实测值。
2. **§4.2⑤ `:22-32`**：06 未报；实测该独立用例（「the phone reads the same navigation list as the sidebar (U07)」）是 `:20-32`。

**未能验的**：
1. `@tabler/icons-react@^3.36.1` 的 `IconBookmarks` 实际导出名（本 worktree 未装 `node_modules`）——§4.2③ 已自标，仍为 S3。只能确认 `IconListDetails`（`sidebar-config.ts:29`）与 `IconHistory`（`:28`）确已 import。
2. 未跑任何测试命令（`locale:compile` 互斥纪律），§3.7 四条验收断言草案的可满足性未验。
3. `00-blockers.md` 是本 worktree 的未提交文件（不在 main 上），其行号以当前工作副本为准；该文件若再被改写，`:35/:98/:99/:100/:17` 会再漂——这正是 06 B30–B33 的原始成因。
4. 未读任何 GitHub 票面（#248/#251/#259/#262 等），§3.1 属主表只核到 spec 与决策文档一侧。
5. `en.json` 未逐键比对，§4.6 的 31 键只在 `zh.json` 侧确认了无重名。
