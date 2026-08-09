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

## Evidence

> 空表由 L-CI 脚手架落盘，**Wave 4 对着真实证据填**。填表规则（机器可判优先）：
> `AC<n>` 对应「Acceptance criteria」小节里第 n 个 checkbox 条目，顺序固定；id 列只写
> `AC<n>`，不加任何修饰。writer / consumer 写 `path/to/file.ts:line`。PG result 与
> Playwright result 写真实结果（如 `12/12 pass`）；没跑就留 `—`，不写「应该通过」之类
> 的推测。required CI job 写 `.github/workflows/core-quality.yml` 里的 job 名。
> 单元格内的 `|` 必须转义成 `\|`。空值统一写 `—`。
> **一行未填满，对应 AC 不得勾选。**

| AC | production writer | production consumer | failure-recovery test | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — |
