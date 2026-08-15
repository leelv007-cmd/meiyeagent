# V31-85 — 视频线「换不需要案例图的写法」假出口：切自由创作后确认仍被 case_image 前置打回

**Parent**: 能力基线盘点第二轮（`docs/reviews/capability-baseline-audit-r2-2026-08-13.md` §0.3）
**批次**: 清红队列（V31-73 同构复发）
**Blocked by**: 无（与 V31-84 并行；彻底解锁需两票皆修）
**Related**: V31-73（图文线修复原型：`findSlotFreeFallbackRecipe`）、V31-38（配方权威口）

**Status**: implementation-complete（2026-08-13）— 定性=目录里**根本没有视频 slot-free fallback 配方**，假出口改为诚实引导

**Implementation state**: implemented
**Verification state**: unit/interaction-verified（28 单测＋11 interaction；引导卡 data-can-switch=false、slot 400 不再渲染为 failed run；变异双证见 V31-88 同 commit）。活体视频线未复走（图文线活体已通）
**Evidence SHA**: 97f534d0c76a4c2b6f92222f70e831e21fb4dbfb
Evidence 注：合入 commit；原取证树=1baf2074。定性结论：`findSlotFreeFallbackRecipe` 在 video launch 集返回 null——V31-73 的修复对视频线无目标可切
**Workflow Run**:
**Artifact Digest**:

## 症状

零素材账号选视频 → 引导卡「换不需要案例图的写法」→ UI 切自由创作面（手选模型、
确认卡合规）→ 确认后 alert 仍报「这个配方需要一张案例图」，右栏「未完成…改一改再发就好」
劝再发=循环死路。V31-73 的 fallback 修复只覆盖图文，视频线的自由创作路径在 Core 侧仍
落在带 `case_image` 前置的配方上（或 fallback 选型未生效）。

## What to build

1. 定性：前端 fallback 后提交的 recipe 选择 vs Core 自由创作视频的配方解析，断在哪层。
2. 修法对齐 V31-73：视频存在 slot-free fallback 则切换生效；不存在则引导卡不得展示假出口
   （只留「去传素材」并说明原因）。
3. 失败呈现：被 slot 打回时复用 V31-73 的引导卡而非泛化「改一改再发」。

## Acceptance criteria

- [x] 零素材视频线走**诚实**分支（无假出口）；e2e spec 落盘，全栈跑归旅程门轮
- [x] 「改一改再发」不再出现在确定性 slot 失败上（inspector phase 断言）
- [x] 带素材路径回归不破（既有断言绿＋case_media 同构新增）
