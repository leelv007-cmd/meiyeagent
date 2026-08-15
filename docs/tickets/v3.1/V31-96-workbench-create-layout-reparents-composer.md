# V31-96 — `WorkbenchCreateLayout` 换根元素类型，`session.phase` 每次跨界就重挂整个 Composer

**Parent**: P1-01 / §8.2 workbench 双栏布局合同
**批次**: 门稳定性（**必需**——V31-93 的残余路径只有本票能解）
**Blocked by**: 无。**V31-93 在本票落地前不得关票**
**Related**: V31-93（其残余「点击在 handler 之前丢失」由本票承接）

**Status**: open（2026-08-15）— 根因已定位且已核实。**由「可选清理」升为必需**（2026-08-15 晚更正）：V31-93 修完「面板被销毁」那一支后，带修复的树上仍复现同一形态，判定为**点击在到达 handler 之前丢失**——提升状态救不了，只有停掉重挂能解。动的是布局合同，须先拍板再实施

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**:
**Workflow Run**:

## 事实（读源码得出，逐行核实过）

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

## What to build（先拍板再动）

让 `stream` 在两种模式下的**祖先链一致**，重挂便不再发生。可选方向：

1. 始终渲染同一结构，用 CSS / props 表达单栏与双栏差异（inspector 列折叠而非条件渲染）；
2. 或将 `stream` 提升为两分支共享的稳定位置，只切换其兄弟。

**约束**：动的是 P1-01 / §8.2「≥1240 双栏」的布局合同与 `ResizablePanelGroup` 结构，
影响面远大于 V31-93，**不得以「顺手做掉」的方式混进别的修复**。

## Acceptance criteria

- [ ] 方向已拍板并写入本票
- [ ] 先红后绿证：加一条钉住「`dualColumn` 翻转不产生重挂」的测试
      （可用 mount 计数探针），未修时必须红
- [ ] `moreExpanded` 不再随 phase 变化自行清零
- [ ] 布局合同若有变更，须记录新合同原文与拍板人
- [ ] `required` 绿（同 SHA），且 V31-93 的两条契约测试保持绿
