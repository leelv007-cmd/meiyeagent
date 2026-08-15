# V31-96 — `WorkbenchCreateLayout` 换根元素类型，`session.phase` 每次跨界就重挂整个 Composer

**Parent**: P1-01 / §8.2 workbench 双栏布局合同
**批次**: 门稳定性（**必需**——V31-93 的残余路径只有本票能解）
**Blocked by**: 无。**V31-93 在本票落地前不得关票**
**Related**: V31-93（其残余「点击在 handler 之前丢失」由本票承接）

**Status**: 已实现待验（2026-08-16）— 布局改净，本地全绿（先红后绿＋跨提交变异证）；浏览器验收条款首轮达成（mainline 批 8/8 且 `--retries=0`，run 31910900711），按条款仍需连续轮次，**未关票**

**Implementation state**: 已实现（分支 `fix/v31-96-composer-reparenting`：`907dd2962` 先红探针 → `c5e6f713d` 布局单返回 → `ea83496ec` 单栏摘掉 pan-y）
**Verification state**: 本地已证（jsdom＋静态门）；浏览器验收条款首轮达成（run 31910900711 / job 95075656603，mainline 批 8/8，`--retries=0`）
**Evidence SHA**:
**Workflow Run**: 31910900711（`78963893a`，`production-main-journey` mainline 批 8/8；同 job 唯一红=V31-95）

## 事实（读源码得出，逐行核实过；以下为**修复前**的形态，留作病历）

`workbench-shell-layout.tsx:174-185` 两个分支返回**不同类型的根元素**：

```jsx
if (!dualColumn) {
  return <div data-testid="workbench-stream-cluster">{stream}</div>;
}
return <WorkbenchDualColumn inspector={inspector} stream={stream} />;
```

React 在同一位置遇到不同 type 就卸载整棵子树重建，而 `stream` 里装着
`WorkbenchStickyComposerHost` → `ComposerPromptBar`，即整个 Composer。

触发条件：`dualColumn = isWorkbenchRunVisible(phase) && width >= 1240`
（`workbench-shell.ts:71-79`，阈值 `:26`）。e2e 视口 1440（`playwright.config.ts:261`），
**恒过阈值，所以纯由 `session.phase` 决定**；`isWorkbenchRunVisible`
（`workbench-state.ts:49-51`）只在 `idle` / `cancelled` 为假。

### phase 跨界有多频繁

- **恢复**：`composer-home.tsx:2020` 的 restore effect 门是
  `if (!store || !workspaceId) return;`（`:1968`），而 `workspaceId` 来自 product state
  的 fetch（`:1958`）——**恢复在第一次网络往返之后才跑**，此时页面早已可交互；
- **每次提交**：时间桥 effect 依赖 `activeTasksQuery.dataUpdatedAt`（`:2202-2207`），
  而 `use-composer-run.ts:437` 在每次 createWork 成功后 invalidate `active-tasks`；
- **SSE 重连**：`use-composer-interactions.ts:140`，重连节奏 3 秒；
- **打字**：`composer-home.tsx:2846` 交付后敲第一个字 → `rebindComposerSession`
  → `composer-session.ts:247` 写死 `phase:'idle'` → 跨界。

## 为什么是「必需」（2026-08-15 晚更正，初稿判为可选）

初稿的理由是「V31-93 已把交互状态提到边界之上，重挂不再吞点击」。**该判断不成立**：

带 V31-93 修复的树上，`m04-browser-hard-gate.spec.ts:533` 仍以同一形态复现
（run 31904089871；该 spec 在修复后的树上 2 绿 1 红）。V31-93 的契约测试②已证明
受控状态扛得住重挂，所以**若点击登记成功，面板必然出现**；它没出现，
说明**点击在到达 handler 之前就丢了**——重挂在 mousedown 与 click 之间提交，
浏览器把 click 派到最近共同祖先，React 沿新树分发，trigger 的 onClick 走不到。

**这一支没有状态可以保存，所以提升状态救不了它。唯一的解是让重挂不发生。**

除此之外仍有：

1. **无谓开销**：整棵 Composer 子树在恢复、每次提交、每次 SSE 重连时重建；
2. **`moreExpanded` 仍随重挂清零**（`composer-conversation.tsx:1103` 局部 state）——
   商家展开的「更多」会自己收回去，属界面自变。若本票短期做不了，
   可先单独把 `moreExpanded` 提上去（成本极小），但那**不解决点击丢失**。

失败路径的具体锚（来自撤回轮）：红在 `assertThreeModalDiscovery` → `openComposerCapsule`（`ui-journey.ts:173`），即**点了胶囊、面板没出来**。

V31-93 修的是「面板开了之后被密度折叠／重挂销毁」——受控化让已开的面板活下来。
它治不了另一半：**点击落在一个正在 detach 的节点上，这一次点击整个丢失**，
从来没有 open 事件发生过，没有任何状态可以「活下来」。这一半只有停掉重挂才治得了。

所以两票是同一根因的两半，V31-93 关票前必须等本票落地。

## 已实现（2026-08-16）

`WorkbenchCreateLayout` 改成**单一 return ＋ 定长静态 JSX**：`stream` 在两种模式下
都位于面板组的第 0 位，祖先链完全一致；只有 handle 与 inspector 面板以
`{cond ? <X/> : null}` 进出——静态 JSX 按下标对账，兄弟下标不移动。
`WorkbenchDualColumn` 内联后删除（无第二个调用方）。

### 三条实测结论（在 jsdom 里让库自己算，不靠推理）

| 问题 | 实测 |
|---|---|
| 单面板会不会留 38% 空白（`defaultSize={62}`） | **不会**。单面板 `flex: 100 1 0px`，库忽略 defaultSize 归一化到 100 |
| `defaultSize` 是不是 mount-only | **不是**。面板数 1→2 时 `100→50`、2→1 时 `50→100`，库自己重算 |
| 群组 inline style 单双栏差异 | **完全一致**，含 `overflow:hidden` 与 `touch-action:pan-y` |

**前两条的 jsdom 数字不可外推，但结论成立——理由换成代码路径**：库解析
`defaultSize` 走 `ie({groupSize, panelElement, styleProp})` 再 `c / n * 100`，
jsdom 里 `groupSize` 恒 0，所以 50/100 这组数字本身是环境产物（真浏览器下双栏是 62/38）。
真正保证结论的是布局校验函数 `K`（dist 偏移 21339 附近）：

```js
const i = o.reduce((a, r) => a + r, 0);   // 各面板尺寸求和
if (!k(i, 100) && o.length > 0)           // 和 ≠ 100 → 等比缩放到 100
  for (…) o[a] = 100 / i * r;
```

单面板时和 = 62，`100 / 62 × 62 = 100`——**任何环境下单面板都被归一化到 100%**，
不留空白。同一函数也是「面板数变化即重算」的出处，故 `defaultSize` 非 mount-only。

`minSize={40}` 在单面板下同样安全，但**理由不是「100 不低于 40」**——那个说法把 40 当成了
百分比，是错的（见下）。正确理由：钳位函数 `Z`（偏移 16416 附近）先
`size < minSize → size = minSize`，再 `Math.min(maxSize, size)`；单面板经 `K` 归一化后
size = 100，而 minSize 换算成百分比后只有约 3.2%，**离咬合更远**，两步都不动它。

### 数字尺寸属性的单位是像素，不是百分比（先存缺陷，不属本票）

```js
// react-resizable-panels@4.12.2/dist/react-resizable-panels.js:18-21
case "number": return [e, "px"];                    // 数字 = 像素
case "string": … e.endsWith("%") ? [t,"%"] : … : [t,"%"];  // 裸字符串才是百分比
```

`d.ts:293`（defaultSize）与 `:343`（minSize）散文一致：
「Numbers are interpreted as pixels」「Strings without explicit units are
interpreted as percentage」。

推论，**两条都是本票之前就存在的，不由本票引入**：

1. **`minSize={40}` / `{24}` 实际是 40px / 24px**。在 1240px 群组里约等于 3.2% / 1.9%，
   不是 40% / 24%——**双栏的拖拽地板形同虚设**，stream 能被拖到只剩 40px。这是真缺陷，
   另开票，**不并进本票**：把地板从 3.2% 抬到 40% 是可感知的行为变更，须单独验。
2. **`defaultSize={62}` / `{38}` 是 62px / 38px，碰巧无害**：`K` 把各面板和归一化到 100，
   62:38 的比例被保住，所以真浏览器下仍落在 62/38。**但这是巧合不是设计**——
   将来若有人把其中一个改成 `"62%"` 而另一个留数字，比例会静默崩掉。

第三条逼出两个真坑，两个都已处理：

1. **`overflow:hidden` 会成为 sticky containing block**，打断单栏下的 sticky Composer
   （今天单栏没有 group，所以不存在）。`style={{overflow:'visible'}}` 改为**无条件**下发。
2. **`touch-action:pan-y` 覆盖不掉**。库构造群组 style 的顺序是
   `{height, width, overflow, ...userStyle, display, flexDirection, flexWrap, touchAction}`
   ——用户样式夹在中间，所以 `overflow` 压得住、`touchAction` 压不住
   （`react-resizable-panels@4.12.2/dist/react-resizable-panels.js` 偏移 45300 附近）。
   单栏没有 handle，这条 pan-y 什么也不守，只会**禁掉 stream 内的横向触摸手势**——
   而 1240 以下今天根本没有 group，等于凭空新增一条移动端损失。
   故单栏群组挂 `meiye-workbench-stream-only-group`，由 `heroui-glass.css` 以
   `!important` 摘掉，与同文件既有的 `overflow:visible !important` 同一手法。

**这条是测试抓出来的**：inline 写了 `touchAction:'auto'`，测试读回来还是 `pan-y`。

### 本地证据

- **先红**：`907dd2962` 两条见证测试红，且**翻转前的断言全过**（点击跑了、state 到了 1/2），
  翻转后读到 `0`＝全新挂载的组件。既有 12 条 testid 断言两侧都绿——**它们看不见这个缺陷**，
  因为节点带着同样的 testid 被重建了。局部 state 是唯一的见证者。
- **后绿**：`c5e6f713d` 起 16/16；composer 全套 274/274；`workbench-p1` 静态门 6/6；
  `tsc --noEmit` 与 biome 干净。
- **变异证**：先红与后绿分属两个提交，撤掉 `c5e6f713d` 即回红。

### 浏览器层证据：验收条款已达成（run 31910900711，job 95075656603）

`production-main-journey` 由 `scripts/ci/run-pr-production-journey.sh` 分两批跑，
**且 `--retries=0`**（`:67`）：

| 批次 | 内容 | 结果 |
|---|---|---|
| `mainline` | **`assembly-gate-required-journey` ＋ `m04-browser-hard-gate`** ＋ `marketing-identity-flow` | **8 tests, 8 passed (6.4m)** |
| `composer` | `w12-identity-draft-assistant` ＋ … | 1 failed / 2 passed (5.3m) |

**本票的验收条款——`assertThreeModalDiscovery` 路径在不加重试的前提下绿——由
`mainline` 批达成。** 那正是本缺陷唯一还在如实报警的探头
（V31-93 票面 `:98-101` 记录了它是全套里唯一没被 `toPass` 包起来的调用方）。

该 job 唯一的红是 **V31-95**，与本票无关：
`w12-identity-draft-assistant.spec.ts:180`，
`response.json: Protocol error (Network.getResponseBody): No resource with given identifier found`。
PR #10 基于 main，尚未带上 PR #8 的 V31-95 修复。

**仍需按验收条款凑够连续轮次**——单轮绿不构成关票依据。

### 仍未验（须浏览器）

`height:100%` 已由读代码定论——父容器（`WorkbenchShellRoot` 的 `flex flex-col … py-6`）
是 auto 高度，百分比高度对 auto 父容器解析为 auto，且这条链今天在双栏下已在跑，
改动没有加深度。

**`touch-action` 的实际生效值，任何自动化都没验过**（须写明，别当已验项）。
两条 interaction 测试断言的是 `group.style.touchAction === 'pan-y'`（即库写的 inline 值）
＋类名存在；静态门断言的是 CSS 源文本。**jsdom 不套用那个 CSS 文件**，
所以「单栏下 computed `touch-action` 真的是 `auto`」只被验到了两头对得上，
中间那一跳没验。真机核对时这条是**待验**。

**其余是整体观感**：1000px 窄桌面与 ~390px 移动端，CI 只跑 1440。

**另一条未排除的崩溃面**：`K`（偏移 21339 附近）开头有
`if (o.length !== t.length) throw Error(…)`——面板数 1↔2 切换时若 layout 与 constraints
两个数组在某个 commit 上被观察到不同步，这里是 throw 不是静默降级。
本地 jsdom 的 1↔2 与 2↔1 翻转各跑过且未抛，且 resize 驱动与 phase 驱动
走的是同一条 React 重渲染路径（`use-workbench-viewport-width.ts` 更新 state），
差别只在触发频率；但**快速反复穿越 1240 这一压力条件没试过**，真机核时一并拖窗口验。

## Acceptance criteria

- [x] 方向已拍板并写入本票（单一 return ＋ 定长静态 JSX，`stream` 钉在第 0 位）
- [x] 先红后绿证：局部 state 见证测试，未修时必须红（`907dd2962` 红 → `c5e6f713d` 绿）
- [x] `moreExpanded` 不再随 phase 变化自行清零（重挂消除即消除，该 state 无其它清零路径——
      `composer-conversation.tsx:1127` 为纯局部 `useState`，`setMoreExpanded(false)` 全文件 0 次）
- [x] 布局合同未变更：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md:544` 管的是
      「≥1240 可出现双栏／Inspector 分栏（resizable 允许）」这一**呈现**约定，
      未规定单栏时不得存在面板组；`:550` 的验收轴是「样式合同或 snapshot」。
      改的是结构不是呈现，故不构成合同变更，无需拍板人
- [x] `assertThreeModalDiscovery` 路径（`m04-browser-hard-gate` / `assembly-gate-required-journey`）
      在**不加重试**的前提下绿 —— 这是本票的真验收，它是该缺陷唯一如实报警的探头。
      首轮达成：run 31910900711 的 `mainline` 批 8/8，`--retries=0`
- [ ] `required` 绿（同 SHA），且 V31-93 的两条契约测试保持绿
- [ ] 1000px 与 ~390px 真机观感核对（CI 只跑 1440）
