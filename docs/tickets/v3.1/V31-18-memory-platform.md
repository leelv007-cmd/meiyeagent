# V31-18 — Memory 扩列 + 双通道 + observation pipeline + 注入透明

**Parent**: spec-E（#5）`docs/specs/v3.1-agent-specs-2026-08-08/spec-E-432-memory-evidence.md`；权威 V3.1 §12、U4/U5
**Lane**: Memory 并行 lane（不阻塞批次 2-4 主线）｜ **语义锁**: 与 V31-19 同 lane 串行或双 worktree
**Blocked by**: V31-01（**working 切片内部另等 V31-06 的 checkpoint 单 writer**；preference/correction 切片可先行）
**Status**: done (merged f190a7cf, 2026-08-08)

## What to build

现有 preference 三表扩列（kind/authority/scope/decay/state）；五层认知分类；authority 双通道（Thread 内即时生效／跨 Thread 候选→商家确认，Extractor 经 onExtracted 落候选绝不直接生效）；working memory 抽取/投影策略经 V31-06 单 writer 落盘；检索只在合法 scope 最窄组合内排序（向量相似度永不决定 workspace/rights/fact/authority）；MemoryInjectionReceipt 注入清单可见可撤销；分离删除（A11 四类实体各自策略）；历史迁移只产 proposed。

## Acceptance criteria

- [ ] 跨店泄漏=0；Business Fact 被 Memory 覆盖=0（放行门）
- [ ] correction recurrence=0；false persistence=0
- [ ] 注入清单可见且撤销后不再注入（Playwright §37.4-B2）
- [ ] 删源对话→条目标「来源已删除」；删 memory→ApprovalReceipt 保留
- [ ] retrieval precision 有离线评测

## 裁决 — 风格约束落地为 soft candidate preference（2026-08-09，主控 Ruling 1）

**背景**：反驳复核判 B2「风格约束生效」是 fixture 同义反复——fixture 自读 prompt 正则 `正文不超过 32 字`（`apps/core/src/p1/model-supply/ai-sdk-runner.ts:1657`）后返回硬编码合规文案，而 `maxBodyChars`/`maxSentenceChars`/`forbiddenPhrases` 在全仓**没有任何地方对真实输出做过比较**。L-T4 补了真实执行原语但**刻意未接线**，理由是候选校验器唯一的拒绝词汇是 `HarnessGateId`，而该枚举是封闭契约（新增成员会打破 `apps/core/src/evals/redlines/parity.test.ts` 的红线对齐与 `action-registry` 的不可变指纹）。

**裁决**：按 D-117/D-122（生成自由+发布收口，硬门只留忠实性+红线）——商家风格偏好既非忠实性也非红线，**禁止**成为 `HarnessGateId` 成员。落地形态＝**soft candidate preference**：
- 选择阶段优先取合规候选；
- 违规只作 advisory annotation，**永不拒绝**（不得 brick 已扣费的提交）；
- 另加一处 delivery-time advisory。

**时点**：与 V31-18 P1-8 的绑定时刻相同——即 `merchant_confirmed` 真正拿到 ExecutionPlanSnapshot 之时（当前 `apps/core/src/p1/harness/task-admission.ts:427` 只放行 `policy_exempt_copy`，所以 note/media 走 legacy，两者都还没生效面）。**故现在不接线**，由 integration 波按本节作为已定规格消费，避免变成孤儿。

**原语位置（integration 直接取用）**：
- `assessMemoryStyleCompliance(candidate, style)` — `apps/core/src/p1/harness/make-snapshot-consume.ts:283`，纯函数、CJK 感知，返回 `{passed, violations}`，`MemoryStyleViolation` 覆盖 max_title_chars / max_body_chars / max_sentence_chars / forbidden_phrase。
- `describeMemoryStyleViolations(violations)` — 同文件，商家可读文案（advisory annotation 直接用）。
- 单测 `V31-18 P1-5: real output is measured against the confirmed style, not the prompt` — 对违规与合规真实输出双向断言，含「无注入记忆不得凭空造约束」。

**同一次变更内必须一起做**：删除 `ai-sdk-runner.ts:1657` 的 fixture 自读 prompt 作弊，改为让 fixture 产出**真正合规**的输出（而非被正则触发的硬编码）。否则接线后门会因为错误的理由变绿。

**附带记录（P2-9，契约即天花板）**：`planMemoryContextSchema`（`packages/contracts/src/agent-domain.ts:480-509`）是 `.strict()`，`tones` 是封闭二值枚举上限 2，`entries` 只带 `{memoryId, revision}`，唯一能承载自由文本的字段是 `forbiddenPhrases`（20×100 字符）且被硬编码 `['绝对','保证','必然']` 占满。两条正则对 join 后的 statements 取值，无论确认了 1 条还是 8 条偏好都只有 4 个可达状态；**未命中任何正则的条目仍会进 `entries`**，于是 receipt 声称已注入、下游零影响——与 P1-8 同类的透明度谎报。承载任意偏好需改上述 schema + `make-snapshot-consume.ts` 的读取端，**与本节接线同一时点执行**。

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
