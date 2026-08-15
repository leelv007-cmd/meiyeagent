# V31-91 — 显式 start 间歇性 409 `COMPOSER_PLAN_START_FAILED`：确认落库与 /start 之间存在竞态

**Parent**: V31-16 P1 action boundary ／ Campaign paid Work（U7）
**批次**: 门稳定性（P1，直接影响 required 可用性）
**Blocked by**: 无
**Related**: V31-90（本票从其被撤回的因果指控中拆出）、`docs/ops/ci-arbiter-gate-shrink-2026-08-14.md`

**Status**: open（2026-08-15）— 已在两棵不同代码树上复现同一失败模式，判为间歇性竞态而非回归；根因未定位

**Implementation state**: open
**Verification state**: unverified —— 但失败模式已固化（见下）
**Evidence SHA**:
**Workflow Run**: 31879784097（`1c45089f6`）、31891110630（`f1ba27b8a`）

## 现象

`tests/e2e/specs/campaign-paid-work-confirmation.spec.ts:190`（辅助函数
`admitPromotionPosterMake`）断言显式 start 必须 202，实收 **409**：

```
{"error":{"code":"COMPOSER_PLAN_START_FAILED",
          "message":"Composer plan could not be started."}}
```

商家侧对应文案：`开始制作失败，请重试。`（`src/p1/merchant-p1-error.ts:12`）

## 为什么判为竞态而非回归

| Run | SHA | steering 线程作用域 | 该 spec |
|---|---|---|---|
| 31879784097 | `1c45089f6` | **已被删除** | 红（409，line 190） |
| 31891110630 | `f1ba27b8a` | **完好（回滚后）** | 红（409，line 190，同一行同一码） |
| 31877687189 / 31881895088 / 31884361098 / 31885101663 | 多个 | 完好 | 绿 |

同一失败模式在「有该改动」与「没有该改动」的树上都复现，且多轮绿——
**与 steering 改动无关，是间歇性的**。V31-90 初稿曾把它当作跨 Work 串绑的证据，
已在该票撤回。

## 已知的 409 语义（从产品代码读出，非猜测）

`/start` 在两种状态下返回 `COMPOSER_PLAN_START_FAILED` 409：

1. 任务**已在 mid-run**（`v31-artifact-growth-journey.spec.ts:791` 注释记录了这一条：
   对已在跑的任务点「开始制作」必得 409）；
2. **确认权威未决**就调用 start（`composer-home.tsx:859` 注释：parked paid Work
   会扣住 Make 并交回一个必须先由 Living Plan commit strip 决策的确认权威；
   漏掉它就会「start without a decision → 409」）。

所以竞态窗口在「确认决策落库」与「spec 发起 start」之间。

## What to build（先定位，勿猜修）

1. **判别是哪一支**：在 409 的响应里区分「已 mid-run」与「确认未决」两种原因
   （现在两者共用一个错误码，日志里也分不出来）。这本身就是可交付的可观测性改进，
   并且商家侧「请重试」的建议只对其中一支成立。
2. **定位竞态方**：若是 spec 抢跑，则 `admitPromotionPosterMake` 应在 start 前
   等待确认权威进入 decided 态（等状态，不是 sleep）；若是产品侧决策提交后存在
   可见性窗口（写入已提交但读路径尚未可见），则属产品缺陷，须在 Core 侧收口。
3. **不要用重试掩盖**：给 start 加盲目重试会把「已 mid-run」那一支也一起吞掉，
   反而让真实死锁变成静默成功。

## Acceptance criteria

- [ ] 409 能区分两种原因（错误码或 detail 字段），并有测试钉住
- [ ] 竞态方定位有据（trace／Core 日志），结论写入本票
- [ ] `campaign-paid-work-confirmation` 连续 **≥3 轮** required 绿（单轮绿不算，
      本票就是被单轮结论误判过的）
- [ ] 若判为产品缺陷：先红后绿证；若判为 spec 抢跑：改等待条件，不加 sleep

## 影响

该 spec 在 `production-main-journey` 内，属 **required** 的一部分——所以这条竞态
直接降低合并门的可用性（一次随机红＝一轮重跑）。与 `memory-vault-governance` 的
`selectComposerLens` 20s 超时（另一种间歇红）合并考虑：**required 的浏览器 job
当前不是「零抖动」**，这是 2026-08-15 的实测更正。
