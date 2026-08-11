# V31-20 — Prompt packs + strict 校验迁移到 release 发布点

**Parent**: spec-G（#7）`docs/specs/v3.1-agent-specs-2026-08-08/spec-G-435-release-eval.md`；权威 V3.1 §29.2–29.3、附录 A14
**批次**: 5
**Blocked by**: V31-01
**Status**: evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending

**Implementation state**: done
**Verification state**: evidence-debt
**Evidence SHA**: e3c3f4e98609c5bd61dbb8c651ce8768f1a17853
**Workflow Run**: 
**Artifact Digest**: 

## What to build

按任务解析并冻结 Prompt Pack 子集（copy 任务不依赖 viral key）：pack 归属 agentControl/copy/note(xhsNoteGen)/media(briefImage)/cover/viral/video 全覆盖注册表 22 键；strict 校验从 boot 挪到 release 发布（boot 只校验当前 production release 可解析）；未覆盖 key 使发布失败不回 builtin 假绿；isFallback 降级信号仍经审计管道落库；D-165 三轴保持扁平顶层键。

## Acceptance criteria

- [ ] 22 键 pack 覆盖构造性测试（含 briefImage/xhsNoteGen）
- [ ] 缺 pin 拒绝发布并指明缺哪个 key
- [ ] 纯文案任务不被无关 prompt 供给故障阻塞（退出门）
- [ ] 降级留痕全链可查

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
