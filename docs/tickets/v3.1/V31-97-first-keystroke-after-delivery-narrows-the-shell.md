# V31-97 — 交付后敲第一个字，外壳宽度从 1240 跳到 800

**Parent**: P1-01 / §8.2 workbench 宽度合同
**批次**: 产品观感（P2）
**Blocked by**: 无
**Related**: V31-96（同一条 `phase` 跨界触发；该票消除的是**重挂**，本票是**宽度**，
两者互不覆盖）

**Status**: open（2026-08-16）— 机制链已逐段引证核实；视觉损害程度未核（须真机），修法未定

**Implementation state**: open
**Verification state**: 机制已证，观感未核
**Evidence SHA**:
**Workflow Run**:

## 机制（四段，逐段引证）

商家在交付完成后敲下**第一个字符**，外壳最大宽度从 1240px 收到 800px：

| # | 位置 | 发生了什么 |
|---|---|---|
| 1 | `composer-home.tsx:2845-2857` | 文本变更处理器内，`session.phase === 'delivered'` 且一次性 ref 未置位时，调 `rebindComposerSession` |
| 2 | `composer-session.ts:247` | 该函数写死 `phase: 'idle'`（新的 run 容器，旧 run 的 handle 已交还） |
| 3 | `workbench-state.ts:49-51` → `workbench-shell.ts:111` | `isWorkbenchRunVisible('idle')` 为假 → `dualColumn` 为假 → `resolveWorkbenchWidthMode` 返回 `'conversation'` |
| 4 | `workbench-shell.ts:116` | `'conversation'` → `max-w-[800px]`（`'media'` 才是 `max-w-[1240px]`） |

即在同一个按键处理器里，`rebindComposerSession` 与 `updateUserText` 前后脚执行——
**重排落在这次击键中间**。

## 这不是 `rebindComposerSession` 的错

第 2 段写 `phase:'idle'` 是对的，不要往那里修。该函数的文档注释（`composer-session.ts:225-234`）
说清了语义：这是新的 run 容器，上一个 run 的 task handle 已经交还，此刻确实**没有在飞的 run**，
`idle` 是忠实描述。把它改成别的相位是拿状态撒谎去换视觉平稳。

两端的宽度也都合规：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md:544`
规定 ≥1240 时 Active/Delivered 可出双栏，Idle 用会话宽度。**Delivered 用 1240、Idle 用 800
各自都对**——错的是这两者之间的**过渡**，以及过渡的**触发点**（一次击键）。

## 与 V31-96 的分工（别混）

V31-96 修的是「`stream` 子树被换根重挂」，落地后 Composer 在这次跨界中**不再被销毁重建**。
但外壳的 `max-width` 仍然翻转——那是 `WorkbenchShellRoot` 上的 class，不是挂载问题。
所以 V31-96 全绿之后，本票现象**依然存在**，两票不能相互顶替。

## 已排除

`composer-home.tsx:2848` 的 `setSessionEpoch(current => current + 1)` 一度可疑，
但 `sessionEpoch` 全仓只有两处引用（`:677` 声明、`:1625` 作 `useMemo` 依赖），
**不做 React `key`**，不构成第二条重挂路径。

## 未核（须真机）

- 实际观感有多刺眼：440px 的收窄是一次还是伴随内部元素多次重排；
- 是否存在可见的中间态（宽度已收、内容还没重排完）。

CI 只跑 1440 宽，这两条门里看不见。归入 V31-96 欠的那次窄屏真机核对一并做。

## What to build（未定，先给方向）

不要动 `phase`。可选方向：

1. **宽度不跟 `phase` 走，跟「本会话是否已经产出过内容」走**——交付过的会话即使回到
   `idle` 也保持 1240，直到商家离开或显式开新会话；
2. 或保留翻转但**推迟到击键之外**（如提交时），让宽度变化不落在打字过程中；
3. 或加过渡动画——**最弱的一条**，它只是让跳变变得柔和，没有消除「打字时版面自己动」。

倾向 1：宽度反映的是「这个会话有没有交付物要陈列」，而不是「此刻有没有 run 在飞」。
但这是宽度合同的语义变更，须拍板。
