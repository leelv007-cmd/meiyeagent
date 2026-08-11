# V31-32 — Prompt-pin 静默替换类全量扫除（余 11 处）

**Parent**: Task 6（V3.1 全量修复 / HarnessRelease exact-pin 线）
**批次**: post-merge —— **必须在 Wave 3 合并完成之后开工**
**Blocked by**: Wave 3 合并；其中 note/cover/viral 三组还须等 L-T5（`美业内容2-v31-fix-05`）与 L-T8C（`美业内容2-v31-fix-08`）落地
**Status**: open

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**: 
**Workflow Run**: 
**Artifact Digest**: 

## What to build

把「缺失 prompt pin 时静默替换为硬编码 builtin」这一类失效模式在生产代码中彻底扫除。

这一类为什么是缺陷：运行时**无法区分**「跑在 release 冻结的 pin 上」与「跑在硬编码 builtin 上」。后果有两个，都在事后才发现：

1. **回滚失真** —— release 台账写着某个 promptVersion，实际那次运行用的是 builtin，回滚到该 release 并不能复现当时的输出。
2. **eval 归因失真** —— 评测把 builtin 的表现记在了某个 pin 名下。

`task-admission` 会为任务 pack 声明的每一个 prompt site 冻结 pin（`promptKeysForAdmission` + `HARNESS_PROMPT_PACKS`），所以**运行时缺 pin 意味着冻结逻辑错了，不是"需要一个默认值"**。正确行为一律是 fail closed 并报出 key 名。

## 全量清单（13 处生产点，2026-08-09 L-REL 全仓扫描）

已关 4 处，**余 11 处**为本票范围。

| # | 站点 | prompt key | 所属 pack | 可达条件 | 状态 |
|---|---|---|---|---|---|
| 1 | `apps/core/src/p1/harness/structured-nodes.ts:342` | intentNaming | agentControl | 全部 lens + legacy | **closed** `fe23943b7` |
| 2 | `apps/core/src/p1/harness/structured-nodes.ts:498` | briefCompilation / briefImage / briefVideo | copy / media / video | 按 unitKind | **closed** `fe23943b7` |
| 3 | `apps/core/src/p1/harness/fact-satisfaction.ts:124` | factSatisfaction | agentControl | 全部 lens + legacy | **closed**（Ruling 3） |
| 4 | `apps/core/src/p1/harness/fact-satisfaction.ts:212` | factCriticality | agentControl | 全部 lens + legacy | **closed**（Ruling 3） |
| 5 | `apps/core/src/p1/harness/execution-selection-internal.ts:400` | copyCandidate | copy | lens copy + legacy | open |
| 6 | `apps/core/src/p1/harness/execution-selection-internal.ts:508` | copyCandidate | copy | lens copy + legacy | open |
| 7 | `apps/core/src/p1/harness/note-plan-structured-port.ts:84` | notePlan | note | lens image_text_note | open |
| 8 | `apps/core/src/p1/harness/note-plan-structured-port.ts:138` | noteConsistency | note | lens image_text_note | open |
| 9 | `apps/core/src/p1/harness/note-plan-structured-port.ts:152` | noteTextBlock | note | lens image_text_note | open |
| 10 | `apps/core/src/p1/harness/note-plan-structured-port.ts:165` | xhsNoteGen | note | lens image_text_note | open |
| 11 | `apps/core/src/p1/harness/xhs-cover.ts:134` ← caller `unified-media-stage-ports.ts:303` | xhsCoverPrompt | cover | lens image / image_text_note | open |
| 12 | `apps/core/src/p1/harness/xhs-style-analysis.ts:144` ← caller `unified-media-stage-ports.ts:906` | xhsStyleAnalysis | cover | lens image / image_text_note | open |
| 13 | `apps/core/src/p1/harness/xhs-style-analysis.ts:153` ← caller `unified-media-stage-ports.ts:534` | xhsOutline | note | lens image_text_note | open |
| 14 | `apps/core/src/p1/harness/viral-adapt.ts:320` ← caller `note-plan-structured-port.ts:88` | xhsViralRewrite | viral | recipe.viral_adapt | open |
| 15 | `apps/core/src/p1/harness/viral-adapt.ts:348` | xhsViralImageVision | viral | recipe.viral_adapt（有授权素材时） | open |

（表内 13 处生产点分 15 行：#2 一行覆盖三个 key，#5/#6 同一 key 两处调用。）

**每一处的 key 在能到达它的 lens 下都确实被 task-admission 冻结**（已逐 key 对 `promptKeysForAdmission` 与 `HARNESS_PROMPT_PACKS` 核过），所以每一处今天都真的可被静默替换，也都可以安全 fail closed。

## ⚠️ 审计陷阱：五处藏在 caller/callee 跨文件边界

上表 #11–#15 的洞**跨两个文件**：调用方写 `input.request.prompts?.xhsCoverPrompt?.content`（`?.` 让缺 pin 变成 `undefined`），被调方写 `input.template?.trim() || HARNESS_BUILTIN_PROMPTS.xhsCoverPrompt`。两个文件单看都像正常代码，**单文件 grep 恒显干净**。

真正能扫出全类的命令：

```bash
# 1) 被调方的 builtin 回落（含 ?? 与 || 两种写法）
grep -rn "HARNESS_BUILTIN_PROMPTS" --include='*.ts' apps/core/src \
  | grep -v '\.test\.ts' | grep -v '\.testing\.ts'

# 2) 调用方把可空 pin 交出去（?. 断链处）
grep -rn "prompts?\.[a-zA-Z]*?\.content" --include='*.ts' apps/core/src \
  | grep -v '\.test\.ts'
```

## 不要动的两处（合法，不属本类）

**这两处是有意设计，扫除时误"修"会造成回归。有标签 vs 静默，是本类的分界线。**

1. `apps/core/src/p1/harness/langfuse-prompt-push-cli.ts:42` —— 播种器：它的职责就是**把 builtin 推送到 Langfuse**。builtin 是它的输入，不是回落。
2. `apps/core/src/p1/harness/langfuse-prompts.ts:698` —— **有标签**的回落：`resolveOne` 会打上 `isFallback: true` + `fallbackReason`，strict policy 缺 pin 直接抛，且 `recordPromptFallback` / `collectPromptFallbackAuditSignals` 会把它写进审计。它在运行时**可区分**、可审计——这正是上表 13 处所不具备的性质。

## Acceptance criteria

与 Task 6 Work Item 2（`fe23943b7`）同一证据档位：

- [ ] 每一处缺 pin 时 fail closed，错误信息**报出 prompt key 名**
- [ ] **降级 try/catch 里的守卫不是守卫**：逐处确认 guard 不在会把异常降级成"模型失败"的 try 内。实证——Ruling 3 的 `factSatisfaction`／`factCriticality` 初版把 guard 放在 `runner.run(...)` 的 `instructions:` 实参位（正是旧 `?? HARNESS_BUILTIN_PROMPTS` 表达式所在位），那个 `try` 的 `catch` 返回 `conservativeGuidance(...)`，于是缺 pin 被当成模型失败吞掉、**整个 run 在完全没有 pin 的状态下继续跑**——同一个洞下移一层，比原洞更难发现。守卫必须上移到 try 之外，并留注释挡住"顺手 tidy 回迁"。余量 11 处里 note／cover／viral 路径带 fallback 处理的要逐一过这一条。
- [ ] **断拒绝不断结果**：测试必须 `assert.rejects` 断言"抛出"，不能只断行为结果。上述 fail-open 初版之所以被抓到，只因为测试断的是 rejection（`Missing expected rejection`）；当时全部行为断言都是绿的——**outcome 形态的测试会把 fail-open 验成 fail-closed**。
- [ ] **每一处**都有 mutation-RED 证据：把 guard 改回静默回落，对应测试必须转红（`Missing expected rejection` 一类）
- [ ] fixture 改成与生产同形，而不是把断言改弱 —— 生产恒有 resolver、`request.prompts` 恒被冻结，缺 pin 的测试替身在测一个生产到不了的状态
- [ ] 逐 key 对 `promptKeysForAdmission` 的可达性核查写进票面证据（证明不会把正确 admit 的任务打死）
- [ ] **不得把红转成 skip**：前后 skip 数必须一致并给出数字
- [ ] `apps/core` `tsc --noEmit` exit 0 —— **退出码不要经 `| tail` 取**（管道会吞掉真退出码，L-T5 曾据此带错发版）；重定向到文件再读 `$?`
- [ ] 关票前重跑一次全量 `apps/core` 测试，**PG 证据出自 `scripts/ci/provision-test-db.sh` 一次性库**（长活 lane 库的业务行积累会造假红）

## Boundary

- **一票一次扫完，单一 owner**，不要拆给多 lane —— 本类的教训之一就是分散审计会漏掉跨文件的那五处。
- **post-merge**：Wave 3 合并之后开工。
- #7–#15 的 fixture 修复会落在 `unified-media-stage-ports.test.ts` 与 `note-page-regeneration.postgres.test.ts`，这两个文件在 L-T5 / L-T8C 落地**之前不要碰**（跨 lane 同文件编辑＝本批刻意规避的冲突类）。
- 只做 fail-closed + fixture 同形，**不顺手重构** prompt 解析链。

## 规模预警

Work Item 2 的实测：改 2 行生产代码 → 57 条测试转红（intentNaming 25 / briefCompilation 11 / copy.generate 21 / text.respond 6），fixture 修好后回到 0。本票 11 处的 fixture 面**大于**那一次，排期要按「fixture 工作量 ≫ 生产代码工作量」估。

另有一条实测教训：blast radius 必须用**全量**测试测，不能只跑几个「看起来相关」的文件——Work Item 2 首轮只跑了 6 个猜中的文件，漏掉了 `entitlement-pools/model-supply-admission.test.ts`（它在 `:188` 构造无 resolver 的 `ModelSupplyApplicationService` 并跑 `copy.generate`），该漏项是在事后全量跑才暴露的。

## 背景记录

- 2026-08-09 L-REL：Task 6 送回项要求修 `model-supply/index.ts:2308` 的 unpinned fallback 与 `structured-nodes.ts:342,498` 的 builtin 静默替换（表 #1/#2），合入 `fe23943b7`。
- 同日主控 Ruling 3 追加 `fact-satisfaction.ts:124,212`（表 #3/#4），并要求全仓扫描以判定该类是否灭绝。
- 扫描结论：**减员未灭绝** —— 13 处生产点，关 4 余 11。主控裁决 11 处不在本波做（fixture 成本 + 跨 lane 文件冲突），落为本票。
- 决策锚：`docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md`（V3.1 §29.2–29.3 selective freeze / exact pin）＋ ADR-0020。

## 证据表（关票时填，空表不得关票）

| 站点 | fail-closed 提交 | mutation-RED 输出 | fixture 修复 | 可达性核查 |
|---|---|---|---|---|
| #5 execution-selection-internal:400 | | | | |
| #6 execution-selection-internal:508 | | | | |
| #7 note-plan-structured-port:84 | | | | |
| #8 note-plan-structured-port:138 | | | | |
| #9 note-plan-structured-port:152 | | | | |
| #10 note-plan-structured-port:165 | | | | |
| #11 xhs-cover:134 | | | | |
| #12 xhs-style-analysis:144 | | | | |
| #13 xhs-style-analysis:153 | | | | |
| #14 viral-adapt:320 | | | | |
| #15 viral-adapt:348 | | | | |
