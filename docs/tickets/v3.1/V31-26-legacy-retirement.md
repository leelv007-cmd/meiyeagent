# V31-26 — Legacy 退役清单 + replay 归档条件门（U14）

**Parent**: spec-I（#9）；权威 V3.1 §35 批次 6 退役门、§34.3、U14
**批次**: 6（全系最后一张）
**Blocked by**: V31-22, V31-24, V31-25 ＋ **退役前置条件全满足**（含真实商家试点优于旧流程——试点执行归发布 owner，本票只消费结论）
**Status**: 26a done (merged a4ddf1609, 2026-08-09)；**26b 五段 runner 部分已执行（2026-08-12，用户拍板「直接清理」，见下）**；26b 余项＝R1/R2/R6/R7（仍有消费者）＋U14 归档 fail-closed 执行（部署后按条件门）＋全量 journey 收官

**Implementation state**: partial
**Verification state**: evidence-debt
**Evidence SHA**: 
**Workflow Run**: 
**Artifact Digest**: 

## 拆分决定（2026-08-09，用户批准）

- **V31-26a（本地可做，现在执行）**：零消费者证明矩阵（grep 级+运行时引用计数）、replay 归档条件门监控接线、feature flag 逐个翻转/回退机制与演练记录、可安全删除项（构造性证明通过者）逐项删除。`force_legacy_five_stage` **不删**。
- **V31-26b（试点依赖，挂起等真实商家数据）**：依赖「真实商家试点优于旧流程」结论的最终退役收官（force_legacy_five_stage 删除、U14 归档 fail-closed 执行、全量 journey 全绿收官）。触发点=试点结论出具。
- **26b 追加项（2026-08-09 用户确认无存量）**：legacy 身份迁移恢复路径（`postgres-store.postgres.test.ts`「resumes migrated legacy runtime identities」，wave 前即红=REQUEST_FINGERPRINT_CONFLICT）随 26b 一并处理——修指纹兼容或连路径带测试一起删；测试已标 skip 留因，26b 收口时去除 skip。

## 26b 五段 runner 执行记录（2026-08-12，用户拍板）

用户决策：**不等真实商家试点结论，五段旧 runner 直接清理**；验收依据改押 compiled
executor 自身证据（runner-convergence 前收敛基线套件逐 fixture 字段级对齐 + DBOS
durable 冒烟真库全绿），前提=无部署、无存量 legacy in-flight（2026-08-09 已确认）。

已执行（分支 `refactor/arch-review-wave-2026-08-12`，两个 commit）：

- `frozen-legacy-five-stage.ts` 整删（该模块经 P1-D 实测本就非忠实冻结，三 carrier 全部漂移）；`force_legacy_five_stage` kill switch 从 ops 目录、flag 清单、api-runtime 接线、DBOS workflow option 全链摘除；`runHarnessWorkflow` 单入口=compiled executor；taxonomy `executorPath` 收窄为 `'compiled_plan_executor'`。
- 退役证明矩阵静态测试反转：X1 各符号生产源引用数钉死为 **0**（防回潮）。
- 追加项按「连路径带测试一起删」执行：`postgres-store` 两处 pre-factScope 指纹回退删除，skip 测试随路径删除。
- 回退方式变更：kill switch 翻转 → **application version pin**（无部署，无实际回退面）。

**26b 仍开**：R1（Thread=Work 胶水）/R2+R7（旧卡片流对话面）/R6（interaction v1 重放投影）仍有生产消费者；U14 归档 fail-closed 执行与全量 journey 全绿收官待部署后收口。

## What to build

逐项删除：Thread=Work 假设胶水、旧 result conversation glue、重复 planning DTO、第二份 Prompt pack 映射、手工硬编码 Tool allowlist、已无消费者的旧 Harness surface、重复 UI（旧卡片流）；每项先过「消费者为零」构造性证明再删；feature flag 逐个翻转可回退，force_legacy_five_stage 最后删；legacy durable replay 按 U14 条件门归档 fail closed（零 active/pending+最长 hold 30d 走完+审计导出与回滚证明+ops policy 缓冲）。

## Acceptance criteria

- [ ] 每个删除项附零消费者证明（grep 级或运行时引用计数）
- [ ] 商家体验零变化（退役只删死代码）
- [ ] replay 归档条件门监控在位；归档后审计只读入口可用
- [ ] 全量 journey 全绿收官

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
