# V31-75 — Dashboard 创作面展示层收尾包：失败态投影、枚举/术语泄漏、叠压与空态九项

**Parent**: dashboard 首访旅程实测（2026-08-13 主控亲验）
**批次**: 待排（首访旅程，P1/P2 打包）
**Blocked by**: 无（与 V31-73/74 可并行；第 1、5 项与 V31-73 有触点，先动工者落地、后动工者复核）
**Related**: V31-73（P0 死路）、V31-74（文案债）

**Status**: implementation-complete / release-verification-pending（2026-08-13）— grok lane 实现＋主控亲验（静态 73/73、interaction 85/85、tsc/biome、映射变异反证、e2e：v31-day0-free-creation-journey 绿＋uiux-creation-loop 仅余 V31-76 已知红、dev 真浏览器九项走查），余 required CI

**Implementation state**: done（main@0fdf50bc）
**Verification state**: locally verified（见 Evidence 补记）
**Evidence SHA**: 0fdf50bc；缺陷取证基线 39ca4b399361a9226848c71009d3d6500612ce2c
**Workflow Run**:
**Artifact Digest**:

## 缺口（一句话）

首访旅程沿途九处展示层/状态投影小病相互叠加，把一次失败体验放大成「整个页面都不对」——单项皆小，打包收口。

## 清单（逐项：症状 → 已知锚点）

1. **右栏失败态不落地**：提交失败后右栏「进行中／正在提交」永久卡住。`use-composer-run.ts` `onError` 已调 `failComposerSession`，但上下文栏投影不消费失败态。
2. **失败 alert 不清场**：旧红字失败 alert 与新一轮提交的确认卡同屏共存；切换 定制/自由 tab 也不清。
3. **时间线叠压与重复**：提交后时间线「叙述」气泡被 composer 卡片盖住（z-index 层级）；同一句 prompt 在时间线渲染两条重复「叙述」气泡；空「经验／纠错怎么记」占位卡常驻。
4. **确认卡折叠线下**：「确认本次创作」渲染在视口外，无滚动引导/自动滚动，用户不知道流程在等自己。
5. **费用行溢出卡外**：「本次约消耗 15 分／失败将退回积分／本次用量已确认」渲染在 composer 卡片边界外（视觉断裂；互斥语义归 V31-74）。
6. **枚举与内部术语泄漏**：确认卡「目标成品: image」直出 Core 原始枚举；首屏勾选框「连续创建 2 个付费 Work（Campaign）」以内部记账对象名面对店主。
7. **空态三重复＋时序错乱**：「还没有基于本店事实的推荐」同时以禁用 chip、标题区块两形态出现；CTA「开始下一次创作」对从未创作过的新用户说「下一次」；「作品将在这里原位生长」占位条语义不明。
8. **导航面不一致**：内容页面包屑「工作台 > 内容」——导航中不存在「工作台」；dashboard 面包屑仅一枚禁用「创作」链接；顶栏积分 pill 在 dashboard 显示「可用 100 分」、内容页只剩「积分」二字无数值。
9. **自由创作原生 `<select>`**：模型选择用未包装的原生控件，与全站组件风格断裂；模型名直出（GPT Image 2 / Nano Banana 2…）对店主受众无锚（是否翻译/分层属产品判断，票内先只统一控件，命名报主控）。

## What to build

按清单逐项修；每项改动面小、语义独立，允许一 PR 多项，但 commit 按项拆。第 6/9 项涉及展示层翻译映射的，建立单点映射（enum→商家语言），禁止散落各组件手写。

## 边界与禁止修法

- 不动提交/计费/问店任何行为语义（行为面归 V31-73/74）。
- 空态与 CTA 重排不得删「示例门店”区块与推荐 chip 的「已挂上×一个字没动＋撤销」交互（实测体验良好，保留）。
- 面包屑修法若涉及信息架构命名（「工作台」是否该存在），停手报主控，不自行定名。

## Acceptance criteria

- [x] 提交失败后右栏进入失败终态（新 `workbench-state.ts` 单点命名 Idle/Active/Waiting/Delivered/Failed 五态分区，右栏 inspector 消费 failed；admission 早退路径同步置败；`workbench_inspector_failed_*` 文案）
- [x] 新一轮提交（`attemptSubmit` 首行 `createWork.reset()`）与切 tab 清场旧失败 alert
- [x] 时间线不被叠压＋叙述去重＋空「纠错怎么记」不常驻（narrative-line/agent-workstream/heroui-glass.css）
- [x] Brief 确认卡出现时 scrollIntoView
- [x] 费用行归位卡片边界内（不动 V31-74 的 `resolveComposerQuoteUsageLine` 决策）
- [x] 枚举/术语清零：`merchant-deliverable-label.ts` 单点映射（未知值原样透传；变异反证 2 红→还原 4/4）；勾选框改「连着做第二条（一次排两条）」
- [x] 空态单一来源；CTA 改「开始创作」（e2e/interaction 断言同步）；占位条改「成品会显示在这里」
- [x] 积分 pill 两页一致（共享 `use-shell-credits-summary`）；**面包屑「工作台」命名未动——信息架构决策留主控**
- [x] 自由创作模型选择换全站 Select（`v31-day0-free-creation-journey` 全栈绿，listbox 语义）
- [x] 测试同步不弱化：静态 73/73、interaction 85/85、tsc、biome 全绿

## Evidence 补记（2026-08-13 主控亲验，实现树 0fdf50bc）

- 执行过程：grok lane 三度在收尾前退出（本轮死在「跑测试看红」自述之后、commit 之前），但实测测试面已全绿——验证与 commit 主控亲落
- e2e：`v31-day0-free-creation-journey` 1/1 绿＋`uiux-creation-loop` 2 用例中 `:245` 绿、`:101` 红=V31-76 已知 remix 缺陷同签名（非本票引入）
- 面包屑命名与模型名分层两项按票面边界记录未做，归主控拍板

## 留痕

- 开票：2026-08-13 主控首访旅程亲验九项打包；P0/文案债已拆 V31-73/74，本票只收展示层与状态投影，避免收尾项散落无主（对齐 admin 整备波「一票一行台账」打包纪律）。
