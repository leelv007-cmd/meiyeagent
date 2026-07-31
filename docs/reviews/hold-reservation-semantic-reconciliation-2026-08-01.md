# Hold / Reservation 语义对账（2026-08-01）

> 背景：C1/C2 历史上对 hold 做出过互斥语义（超时取消 vs 额度租约），仅读文件面容易混。本文件固定 **现行 main 合入面**（含 C2 reservation sweeper 收编）的裁决，供实施/评审/关票使用。

## 1. 两轴分立（不可互换）

| 轴 | 名称 | 默认 | 配置键 | 权威结果 | 问题卡状态 |
|---|---|---|---|---|---|
| A | **卡片 hold 超时**（workflow / 交互） | **48h** | `harness.confirmation_card.hold_timeout_seconds`（`DEFAULT_CONFIRMATION_CARD_HOLD_TIMEOUT_SECONDS`） | `resolutionSource=core_hold_expired`；额度经既有 hold-expired 结算退回；工作流取消 | pending → **resolved**（core_hold_expired） |
| B | **额度 reservation 租约**（billing lease） | **7d** | `harness.reservation_sweep.ttl_seconds`（`DEFAULT_HOLD_RESERVATION_TTL_SECONDS`） | sweeper 走幂等 billing refund；写 `reservation_sweeps=completed` + audit/outbox `product_usage_reservation_released` | **保持 pending**；读模型 `reservationReleased=true` |

**硬裁决**：

1. **B 不是问题超时**。evidence 与 sweeper 注释写明：7d 是 *reservation lease*，不是 question timeout；**不得**用 B 代替 A 的 `core_hold_expired`。
2. **A 不是租约清扫**。A 取消任务并解析问题卡；B 只退额度、不 resolve 问题卡。
3. 两轴数值 **故意不同**（48h vs 7d）。现代带 `usageReservation` 的 hold 通常先走 A（48h）；B 兜底：历史无界 hold、A 未装上 holdTimeout 的旧布局、以及 refund/结算半失败后的残余 reserved 行。

## 2. 现行控制流（商家视角）

```text
提交带 usageReservation 的创作
  └─ 问题卡 unattended=hold（默认）
        │
        ├─ [A] holdTimeoutSeconds 有值（现行装配）
        │     商家在 48h 内作答 → decision 续跑
        │     超时 → core_hold_expired（取消 + 退额度 + 问题 resolved）
        │
        ├─ [A 缺失] holdTimeoutSeconds == null（C1 前无界布局）
        │     wait 无超时；额度只能靠 [B] 或商家迟到作答
        │
        └─ [B] sweeper 周期扫描
              候选：pending ∧ unattended=hold ∧ usage+quote reserved ∧ 无 completed sweep
              命中租约 → refund → reservationReleased=true，问题仍 pending
              商家此后作答 → late_answer：新 quote/successor + abandon 旧挂起工作流
              resume / reconciler 发送边界：若 reservationReleased 则拒绝直接 resume 旧工作流
```

## 3. 与 C1/C2 前科的关系

| 历史风险 | 现行防护 |
|---|---|
| 把「额度到期」当成「问题超时」一起 resolve | B 明确 **不** 调 `submitCoreHoldExpired`；pending 保留 |
| 退额度后旧工作流仍被 resume 继续烧钱 | `resumeHarnessDbosWorkflow` / interaction / compensator 查 `reservationReleased`；late_answer 走 successor + `abandonReleasedHarnessReservation` |
| hold 超时与租约清扫双退额度 | A 成功后 usage 非 `reserved` 且问题非 pending → B 的 `claimBatch` 条件不命中 |
| 前端仍承诺「额度还在」 | 读模型独立字段 `reservationReleased`；composer 卡文案改为额度已放回、再答会重排队 |

## 4. 代码锚点（合入面）

- 租约默认 / 扫描：`apps/core/src/p1/harness/reservation-sweeper.ts`、`postgres-store.claimBatch`
- 卡片 hold 超时：`dbos-workflow.ts` `DEFAULT_CONFIRMATION_CARD_HOLD_TIMEOUT_SECONDS` + `awaitDecision` hold 分支
- 迟到作答：`decision-service.ts`（`reservationReleased \|\| core_*` → `late_answer`）
- 发送边界：`dbos-workflow.ts` `reservationReleased?` on `HarnessRuntimeIdResolver`
- 对账补偿：`resume-reconciler.ts` late_answer + `abandonReleasedReservation`
- 证据：`docs/evidence/c2-reservation-sweeper-repair-2026-07-28.md`

## 5. 合入后仍禁止的写法

- 新增第三条「hold 语义」而不声明属于 A 或 B
- 在 sweeper 完成时把问题卡标 resolved / 发 `core_hold_expired`
- 把 7d 租约写进商家可见「请在 N 小时内回答」文案
- 跳过 `reservationReleased` 边界直接 `DBOS.send` 旧 workflow

## 6. 验证口径（本批）

- 单元：`reservation-sweeper.test.ts` / `decision-service` late-answer-after-release / `resume-reconciler`（本机 23/23 绿）
- 类型：`@meiye/core` `tsc --noEmit` 绿
- **e2e / 七作业亲验**：按 `docs/ops/local-e2e-host-degradation-runbook-2026-08-01.md` 走 **draft PR CI**，不依赖本机 e2e 宿主
