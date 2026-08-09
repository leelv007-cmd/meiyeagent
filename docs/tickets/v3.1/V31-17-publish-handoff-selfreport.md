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
> **三个结果列各守一轴，不得跨轴填**：`unit/eval result` 只收单测与离线评测结果，
> `PG result` 只收真实 Postgres 套件结果，`Playwright result` 只收浏览器旅程结果。
> 把 `biome` / `tsc` / 单测结果写进 `Playwright result` 属跨轴，须改回本轴。
> 三个结果列的空值分三种，必须区分：`—`＝该格未填（脚手架初始态）；`n/a`＝该 AC 在该轴上
> **没有**证据要求（须在表下用一句话说明为何没有）；`未跑`＝该轴有要求但本轮未执行（须写出
> 未执行的原因）。writer / consumer / failure-recovery test / required CI job 四列的空值
> 仍统一写 `—`。
> **勾选规则**：writer / consumer / failure-recovery test / required CI job 四列非空，**且**
> 三个结果列每一格都是真实结果或 `n/a` ⇒ 方可勾选。任一结果格为 `—` 或 `未跑` ⇒ 不得勾选。
> （原规则是「一行未填满，对应 AC 不得勾选」。在只有 PG / Playwright 两个结果列时，它把
> 「本来就不该有 PG 证据的 AC」也判成未验收——列集扩展史见 V31-29「Evidence」节末。）

| AC | production writer | production consumer | failure-recovery test | unit/eval result | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — | — |
