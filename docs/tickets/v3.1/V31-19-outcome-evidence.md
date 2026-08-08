# V31-19 — OutcomeEvidence 统一（含 no_activity）+ D-168② 删除语义

**Parent**: spec-E（#5）；权威 V3.1 §26.1、U2
**Lane**: Memory 并行 lane
**Blocked by**: V31-01
**Status**: done (2026-08-08, lane merged)

## What to build

OutcomeEvidence 三层（verified/merchant_reported/inferred，inferred 只表达时间相关性禁因果）统一唯一 canonical write contract（现有 manual outcome contract 扩展；result ledger 与 observability 只投影）；signal 枚举显式扩列 no_activity 承载「没动静」chip（禁借 feedback 塞值）；幂等键=contentPackageRef+signal+observedAt/sourceRef；修正/撤回绑定 exact ContentPackage revision；频控参数供 V31-17 消费。

## Acceptance criteria

- [ ] evidence 唯一 writer 构造性检查（result ledger 只投影）
- [ ] 幂等与修正/撤回断言（P1 action 边界）
- [ ] no_activity 全链可用（chip→合同→投影）
- [ ] 40% 首窗只观测（U2），不作硬门
