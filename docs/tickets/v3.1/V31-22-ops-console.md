# V31-22 — 运营控制面：Release 台 + Tool Policy + Kill Switch + 审计

**Parent**: spec-H（#8）`docs/specs/v3.1-spec-H-ops-console-pending-publish.md`；权威 V3.1 §30、§41、§42、U12
**批次**: 5（可与批次 4/6 并行开发，验收依赖 V31-21 数据面）
**Blocked by**: V31-21
**Status**: done (merged, 2026-08-08)

## What to build

只建 Langfuse 覆盖不了的自建面（管理后台现有骨架内，既有 admin RBAC）：Release 台（三态列表/可读 diff/pack 校验拒发/allowlist 圈定/candidate 试跑/人工放量 U12/一键 rollback 强制留痕）；Tool Policy 管理（编辑只产新 revision，经新 release 装配才生效，禁原地改生产 policy）；Kill Switch 面板（七开关状态+影响范围，随提供方票落地逐个接入）；所有写操作留痕（操作者/时间/理由）；发布前一次回滚演练留记录；指标/trace/eval 跳 Langfuse（releaseId tag）。

## Acceptance criteria

- [ ] 发布拒绝（缺 pin）/rollback 语义/越权拒绝（admin action 边界）
- [ ] Tool Policy 原地改生产被构造性阻止
- [ ] 开关状态变更留痕；未落地开关不进本票 e2e（逐提供方补跑）
- [ ] Playwright：发布→圈 canary→试跑→人工放量→回滚全流程
