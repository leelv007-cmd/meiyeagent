# V31-85 — 视频线「换不需要案例图的写法」假出口：切自由创作后确认仍被 case_image 前置打回

**Parent**: 能力基线盘点第二轮（`docs/reviews/capability-baseline-audit-r2-2026-08-13.md` §0.3）
**批次**: 清红队列（V31-73 同构复发）
**Blocked by**: 无（与 V31-84 并行；彻底解锁需两票皆修）
**Related**: V31-73（图文线修复原型：`findSlotFreeFallbackRecipe`）、V31-38（配方权威口）

**Status**: open（2026-08-13）— 盘点取证，未派工

**Implementation state**: not-started
**Verification state**: reproduced（二号账号，零素材视频提交一轮）
**Evidence SHA**: 1baf207461e57fd4fafbdce250a4582ddef03bcb
Evidence 注：确认卡合规出全（视频映射/时长/费用原因）后被打回；DB 零 work 零扣分（钱面干净）
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

- [ ] 零素材视频线：或走通（fallback 生效）或诚实（无假出口），e2e 背书
- [ ] 「改一改再发」不再出现在确定性 slot 失败上
- [ ] 带素材路径回归不破（V31-84 修后补测）
