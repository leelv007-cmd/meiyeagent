# V31-13 — shadow 对账（确定性字段、抽样 10%、时间盒）

**Parent**: spec-C（#3）；权威 V3.1 §23.2
**批次**: 3（观测票，不占开发 lane）
**Blocked by**: V31-14
**Status**: done (merged, 2026-08-08)

## What to build

过渡期 shadow 对账：新链消费 snapshot 的产物与旧链只比确定性字段，抽样约 10%，连续 2–4 周 mismatch=0 即提前关闭（关停 owner=本票，不留常驻机器）。

## Acceptance criteria

- [ ] 只比确定性字段（不烧 LLM）
- [ ] 抽样率与窗口可配置且有观测面
- [ ] mismatch 告警可定位到字段级 diff
- [ ] 关闭动作有留痕（时间盒到期或提前达标）
