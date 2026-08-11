# V31-22 — 运营控制面：Release 台 + Tool Policy + Kill Switch + 审计

**Parent**: spec-H（#8）`docs/specs/v3.1-spec-H-ops-console-pending-publish.md`；权威 V3.1 §30、§41、§42、U12
**批次**: 5（可与批次 4/6 并行开发，验收依赖 V31-21 数据面）
**Blocked by**: V31-21
**Status**: evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending

**Implementation state**: done
**Verification state**: evidence-debt
**Evidence SHA**: aa25760403838e39420514dfca02f02fd6b6f770
**Workflow Run**: 
**Artifact Digest**: 

## What to build

只建 Langfuse 覆盖不了的自建面（管理后台现有骨架内，既有 admin RBAC）：Release 台（三态列表/可读 diff/pack 校验拒发/allowlist 圈定/candidate 试跑/人工放量 U12/一键 rollback 强制留痕）；Tool Policy 管理（编辑只产新 revision，经新 release 装配才生效，禁原地改生产 policy）；Kill Switch 面板（七开关状态+影响范围，随提供方票落地逐个接入）；所有写操作留痕（操作者/时间/理由）；发布前一次回滚演练留记录；指标/trace/eval 跳 Langfuse（releaseId tag）。

## Acceptance criteria

- [ ] 发布拒绝（缺 pin）/rollback 语义/越权拒绝（admin action 边界）
- [ ] Tool Policy 原地改生产被构造性阻止
- [ ] 开关状态变更留痕；未落地开关不进本票 e2e（逐提供方补跑）
- [ ] Playwright：发布→圈 canary→试跑→人工放量→回滚全流程

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
