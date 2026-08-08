# V3.1-C 确认与执行：ExecutionPlanSnapshot 冻结 + 确认请求/决定（确认前 reserve）+ Make Harness 消费冻结计划 + Interrupt 协议

> **已发布**：https://github.com/leelv008/meiyeagent/issues/3（label: ready-for-agent）；本文为票面本地快照。原 leelv007-cmd/meiyeweb-agent#431 因账号封禁废弃。
> 决策权威：V3.1 §5.4、§14、§22.3–22.4（前置迁移）、§23、§27.6；决策记录附录 B（U7/U8/U9）；硬约束附录 A（A2/A3/A4/A5/A6/A13）。
> 依赖：#1（事件地基）、#2（Plan Compiler 产出 CompiledExecutionPlan）。

## Problem Statement

现链在 Make 阶段重新理解 Intent、重新生成 Brief——商家确认的方案与实际执行方案可能漂移；确认、预扣、超时退款的时序没有统一合同；中断/恢复没有类型化协议，刷新或换设备后审批 UI 无法重建。

## Solution

Session 与 Make 之间以冻结的 ExecutionPlanSnapshot 为唯一交接物（含付费媒体=商家确认后冻结；纯 copy=policy_exempt_copy 同样冻结，免的是确认不免冻结）；确认拆为待决请求（创建事务内先 reserve）与不可变决定，hold 到期=取消+退分+白话告知（D-153）；Make Harness 只验证冻结计划仍有效并确定性执行；Interrupt 升级为类型化协议（稳定 id 回注 + CAS + resource 级重发现）。

## User Stories

1. As a 美业商家, I want 我确认的方案与系统实际执行的方案逐字段一致（fidelity=100%）, so that 不会「确认 A 做出 B」。
2. As a 美业商家, I want 含付费媒体的方案用紧凑确认条确认一次（积分/余额/授权/事实/退还状态可见；只读、只有拒绝/确认）, so that 付费知情且不被设置表单打断。
3. As a 美业商家, I want 确认卡等待期我的积分显示「已预留 N 分」，拒绝或超时全额退回并用白话告知（U8：确认前 reserve；D-153）, so that 钱的状态永远清楚。
4. As a 美业商家, I want 纯 copy 免确认路径同样按报价执行（exact plan/quote/release 冻结，U9）, so that 免确认不等于失控。
5. As a 美业商家, I want Campaign 确认只批准计划排期，每个含付费媒体的派生 Work 在其 exact quote/rights 冻结后单独确认（U7）, so that 几周后的扣费不会未知情发生。
6. As a 美业商家, I want 确认后、执行前关键事实/权利/费用变化时方案变 stale 并要求重新确认（显示 diff）, so that 不被静默换方案。
7. As a 美业商家, I want 执行中素材撤权立即安全停止且不重复扣费；已引用价格/日期变化时暂停提示, so that 内容不带失效授权与过期事实。
8. As a 美业商家, I want 关闭标签页/断网后回来任务还在跑或停在需要我处理的那一步（pending interrupt 刷新重连不丢）, so that 过程可离开。
9. As a 美业商家, I want 在首页/手机上看到当前 workspace 全部待处理确认项（不需要知道具体 thread）, so that 恢复入口不依赖上下文。
10. As a Core 服务, I want ExecutionConfirmationRequest 创建事务内完成 余额检查+reservation+FEFO 扣减（同事务+workspace 锁），决定落为不可变 PlanConfirmationDecision, so that 计费原子性与确认真相唯一属主成立。
11. As a Core 服务, I want Make Harness 新任务只消费 ExecutionPlanSnapshot：verification→context/rights fence→执行，不再重新调用 intent/brief LLM（旧节点降为 validator，mismatch fail closed）, so that 重复 LLM 调用关闭且漂移可检测。
12. As a Core 服务, I want 过渡期 shadow 对账只比确定性字段、抽样约 10%、连续 2–4 周 mismatch=0 即提前关闭, so that 对账不烧钱不留噪音。
13. As a Core 服务, I want Interrupt 协议携带 threadId/runId/workflowId/step/revision/schemaVersion，resume 按稳定 interruptId+revision CAS 回注（禁位置索引；expiresAt 仅业务期限出现）, so that 并行多待审与 stale resume 都安全。
14. As a Core 服务, I want duplicate resume/duplicate submit/重放全部幂等（不重复创建 Task、不重复扣费）, so that at-least-once 环境下账实一致。
15. As a 平台工程师, I want 确认门与 note 页级帧先从三 runner 迁出为独立模块（以 symbol 锚定），XHS §3.2 验收门保持全绿, so that 后续 runner 收敛（V3.1-I）不失锚。
16. As a 运维, I want execution_plan_snapshot_v1 / compiled_execution_plan_consume_v1 / force_manual_plan_confirmation / force_legacy_five_stage 四个开关随本 spec 引入, so that 新链可按 workspace 回退。

## Implementation Decisions

- ExecutionPlanSnapshot：中性交接物，approvalBasis: merchant_confirmed | policy_exempt_copy；merchant_confirmed 须带 confirmationDecisionRef；两路径都冻结 exact plan/quote（引用计费域 revision，不复制金额）/rights/fact/prompt/skill/bounds/releaseId + snapshotHash（V3.1 §14.2）。snapshotHash 只覆盖冻结执行内容、不含 confirmationDecisionRef：编译定稿先算 hash，确认请求持该 hash 作锚，决定落独立不可变对象，快照行在 task-admission 一次性写入（hash 不因决定回填而变化）。
- 确认对象拆分：待决请求（含 reservationIdempotencyKey、holdExpiresAt 1h–30d）+ 不可变决定；「已确认记录」不承载等待期 TTL（V3.1 §14.3，U8=A）。
- refund 回原扣批次、批次过期份额作废且流水可见；失败退还开关投影双态文案（附录 A4/A5）。
- Campaign 合同带 campaignPlanRef/workOrdinal/approvalScope: plan_only|single_work（U7）。
- Context Fence 分类表按 V3.1 §23.4；bounded execution 触顶=可续挂起非失败（A6）。
- Interrupt/resume 对齐 D-169① 三元组；listPendingInterrupts({resourceId, threadId?}) workspace 鉴权，禁凭可猜 threadId 读 payload。
- 无双写过渡期：legacy durable task 走独立 replay 分支，layout 不兼容 fail closed。
- `force_manual_plan_confirmation` 只把本来需确认的付费媒体路径强制为人工确认渲染，不扩大确认边界至纯 copy（A13/U1 口径不动）。

## Testing Decisions

- 主 seam：P1 action + 事件流边界（确认请求/决定/stale/重确认）+ DBOS durable 测试缝（现存：hold expiry=取消+退分、reservation release、resume 幂等、kill/restart 后副作用=0）。
- 计费并发测试：余额检查+reservation+FEFO 同事务+workspace 锁（附录 A3）。
- Playwright journey：视频付费执行（§37.4-D）、Plan stale（E）、素材撤权（F）、Interrupt resume（H）、Level 1 冻结断言（B）。
- 退出门（V3.1 §35 批次 3）全部纳入验收。

## Out of Scope

Artifact 原位生长与 Steering 执行（V3.1-D）；三 runner 收敛本体与旧分支删除（V3.1-I，本 spec 只做门与帧的前置迁移）；HarnessRelease 装配（V3.1-G）。

## Further Notes

现 workflow-core 的确认门与页级帧行号以 V3.1 §22.4 的 2026-08-08 快照为准、以 symbol 为锚；开票实施时先复核当前行号。
