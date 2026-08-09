# V31-21 — HarnessRelease 三对象 + controlLimits 绑定 + canary + rollback

**Parent**: spec-G（#7）；权威 V3.1 §29、U10/U11
**批次**: 5
**Blocked by**: V31-01, V31-20（**集成验收**另需 V31-06 消费 release pin、V31-14 执行链记 releaseId）
**Status**: done (2026-08-08, lane merged)

## What to build

HarnessRelease=不可变 Artifact（prompt/schema/skill/tool/model/fact/rights/budget/eval bindings+planSchemaRevision+middlewareBindings+**controlLimits 全量标定值**+manifestHash）/Lifecycle/Rollout 三对象；任一 limit unset→发布失败；per-run 试跑只能选完整 immutable candidate releaseId（禁字段级覆写，U10）；首发灰度=workspace allowlist+candidate 试跑；回滚=新任务切回旧 release、在途保持冻结；任务/Plan/Trace 全记 releaseId。

## Acceptance criteria

- [ ] releaseId 恒指唯一 manifest（immutability+manifestHash 断言）
- [ ] 任一运行能还原 exact release；rollback 不改任务内 prompt
- [ ] unset limit 拒发布；resolver 返回非空 controlLimits
- [ ] Playwright §37.4-J：canary 命中候选/非 canary production/rollback 语义
- [ ] release diff 可读

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
