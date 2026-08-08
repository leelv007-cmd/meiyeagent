# V31-17 — Publish Handoff + 商家自报旅程 UI

**Parent**: spec-D（#4）；权威 V3.1 §6、附录 A19、D-155 白名单、U2
**批次**: 4
**Blocked by**: V31-15（**仅自报落库子交付**另等 V31-19 的 OutcomeEvidence 合同）
**Status**: done (merged, 2026-08-08)

## What to build

Delivered 后发布交接：标题/正文/话题/CTA 分块复制、图片按序命名确定性 ZIP、视频含字幕封面安全区；二维码=MobilePublishHandoff 商家自发（我方驱动发布 reject，A19）；capability 三态诚实呈现（assisted/unavailable 不伪装直发）；「我已发布」留痕绑定 exact ContentPackage version；次日一句话追问+一键 chips 补记（同 Work 只问一次、两次不理降频），写路径消费 OutcomeEvidence 合同（幂等键 contentPackageRef+signal+observedAt/sourceRef）。

## Acceptance criteria

- [ ] Delivered 后五分钟内可完成手机交接（Playwright 发布交接 journey）
- [ ] 系统绝不代发；扫码后我方驱动发布被 reject
- [ ] 未验证能力不显示为可直发
- [ ] 发布留痕绑定 exact version；自报幂等
- [ ] 自报旅程 §37.4-K 全绿（此项等 V31-19 合同就位）
