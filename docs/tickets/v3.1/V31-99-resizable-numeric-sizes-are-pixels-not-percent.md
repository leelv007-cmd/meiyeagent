# V31-99 — 双栏拖拽地板写成了 40px/24px 而非 40%/24%，形同虚设

**Parent**: P1-01 / §8.2 workbench 双栏布局合同
**批次**: 产品行为（P2）
**Blocked by**: 无
**Related**: V31-96（在核该票的 `minSize` 时发现；**先于该票存在，不由它引入**）

**Status**: 已修复待验（2026-08-16）— 四处改为显式 `%`；两个待答问题都已查实（数字无规格出处；**从未部署过，不存在已习惯窄栏的商家**），故抬地板不构成对现有用户的行为回退；真机拖拽极限仍欠

**Implementation state**: 已实现（分支 `fix/v31-99-panel-size-units`）
**Verification state**: 单位已由静态门钉住（先红后绿＋变异证）；**真机拖拽极限未验**
**Evidence SHA**:
**Workflow Run**:

## 事实

`react-resizable-panels@4.12.2` 的数字尺寸属性单位是**像素**，不是百分比：

```js
// dist/react-resizable-panels.js:18-21
function xt(e) {
  switch (typeof e) {
    case "number": return [e, "px"];                             // 数字 = 像素
    case "string": { const t = parseFloat(e);
      return e.endsWith("%") ? [t, "%"] : … : [t, "%"]; }         // 裸字符串才是百分比
```

`d.ts:293` / `:343` 散文一致：
「Numbers are interpreted as pixels (e.g. `minSize={200}` is 200 pixels)」
「Strings without explicit units are interpreted as percentage」。

而 `workbench-shell-layout.tsx` 四处全用裸数字：

| 属性 | 写的 | 实际含义 | 本意 |
|---|---|---|---|
| stream `minSize={40}` | 40 | **40 像素** | 40% |
| inspector `minSize={24}` | 24 | **24 像素** | 24% |
| stream `defaultSize={62}` | 62 | 62 像素 | 62% |
| inspector `defaultSize={38}` | 38 | 38 像素 | 38% |

## 后果

**`minSize` 是真缺陷**：在 1240px 宽的群组里，40px ≈ **3.2%**、24px ≈ **1.9%**。
所谓「stream 不得少于 40%」的拖拽地板实际只有 3.2%——**商家可以把 stream 拖到只剩 40 像素**，
Inspector 同理只剩 24 像素。两侧都能被拖成一条缝。

**`defaultSize` 碰巧无害**：布局校验 `K`（偏移 21339 附近）在各面板尺寸之和不等于 100 时
按 `100 / sum * size` 等比缩放。62px 与 38px 的**比例**是 62:38，缩放后仍是 62/38，
所以初始分栏比例是对的。

**但这是巧合不是设计**：一旦有人把其中一个改成 `"62%"` 而另一个留数字，
两者不再同量纲，比例会**静默崩掉**——没有报错，只有版面变形。

## 两个待答问题的答案（2026-08-16 查实）

**问题 1：40 / 24 是怎么定的？** —— **没有出处**。规格里查不到这组数字
（`xhs-vertical-integration-spec-2026-08-01.md` 只在 `:544` 规定
「≥1240 可出现双栏或 Inspector 分栏（resizable 允许）」，未给比例或地板），
`git log -S "minSize={40}"` 只有一个来源：实现提交
`90635c8b2 feat(web): P1-01 workbench shell, dual column, sticky composer, AgentFrame registry`。

所以它是实现时拍的数。**但作者写下 `minSize={40}` 的意图显然是 40%**——
把它改成 `"40%"` 是**实现作者本意的落地**，不是一个新的产品决策。

**问题 2：现网有没有商家已习惯窄栏？** —— **没有现网**。
`deploy.yml` 的全部历史运行都是 `skipped`（查至 2026-08-16），**从未真正部署过**。
既然没有线上，就不存在被这次改动夺走既有习惯的商家；
「抬地板＝可感知行为回退」这条顾虑对当前阶段不成立。

两问都清，故按最小改动做全量修复，不再拆先后。

## 已做（2026-08-16）

四处全部改为显式百分比字符串：

| 属性 | 改前 | 改后 |
|---|---|---|
| stream `defaultSize` | `{62}` | `"62%"` |
| stream `minSize` | `{40}` | `"40%"` |
| inspector `defaultSize` | `{38}` | `"38%"` |
| inspector `minSize` | `{24}` | `"24%"` |

守卫落在既有静态门 `workbench-p1.static.test.ts`：先剥块注释再匹配 JSX 属性
（**docblock 里正引用着 `minSize={40}` 作为反面例子，不剥就会被自己的例子判红**——
这一条是写测试时真踩到的），要求四处都形如 `"<数字>%"`，并逐个钉住 40/24/62/38。
先红后绿：改前该测试红在 `minSize={40} must be an explicit percentage string`；
变异证：任一处改回裸数字 → 7/7 变 6 pass / 1 fail。

`workbench-shell.interaction.test.tsx` 16/16 未受影响；composer 全套四轮里三轮 274/274
（一轮 1 红未复现，形态属 V31-100，已记为该票新样本）。

## 仍欠

**真机拖拽两端极限未验**。jsdom 里 `groupSize === 0`，面板尺寸退化，
拖拽地板在 jsdom 中不可观测——静态门只能钉住单位，钉不住「拖不动到地板以下」这个行为。
这一趟可与 V31-96 欠的 ~1000px / ~390px 观感核对合并做。

## Acceptance criteria

- [x] 四处单位统一为显式 `%`
- [x] `minSize` 地板取值已确认（沿用 40/24 或另定），并记录依据 —— 沿用，依据见上「两个待答问题的答案」
- [x] 先红后绿证 —— **但只覆盖单位那一层**：静态门钉的是「四处必须是 `%`」，
      未修时确实红；「拖拽压不到地板以下」这个**行为**仍未被任何自动化覆盖（见「仍欠」）
- [ ] 真机核对双栏拖拽两端极限
