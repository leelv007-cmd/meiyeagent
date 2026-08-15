# V31-99 — 双栏拖拽地板写成了 40px/24px 而非 40%/24%，形同虚设

**Parent**: P1-01 / §8.2 workbench 双栏布局合同
**批次**: 产品行为（P2）
**Blocked by**: 无
**Related**: V31-96（在核该票的 `minSize` 时发现；**先于该票存在，不由它引入**）

**Status**: open（2026-08-16）— 单位错用已引证核实；实际观感与修法未定，抬地板是可感知行为变更须单独验

**Implementation state**: open
**Verification state**: 机制已证，影响未核
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

## What to build（未定）

最小改动是四处都写成显式百分比字符串：`"62%"` / `"38%"` / `"40%"` / `"24%"`。

**但 `minSize` 那两处不是纯修辞**：地板从 3.2% 抬到 40%，
会让今天做得到的拖拽动作明天做不到。需要先答：

1. 40% / 24% 这组数字当初是怎么定的，是否仍是想要的地板？
2. 现网有没有商家已经习惯把某一栏拖得很窄？

`defaultSize` 那两处改成 `%` 是纯加固（行为不变、去掉静默崩塌的引信），
可以先行；`minSize` 两处随上面的答案走。

## Acceptance criteria

- [ ] 四处单位统一为显式 `%`
- [ ] `minSize` 地板取值已确认（沿用 40/24 或另定），并记录依据
- [ ] 先红后绿证：钉住「拖拽不能把任一栏压到地板以下」的测试，未修时必须红
- [ ] 真机核对双栏拖拽两端极限
