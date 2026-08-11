# V31-46 — 跨边界重投的裸 `Error` 会被 artifact emitter 当瞬时失败吞掉（＋发散重试卡死形态无测试）

**Parent**: V31-15（artifact.revised producer）/ V31-03（semantic event store）
**批次**: post-merge
**Blocked by**: None — 但**须在 T5 分支（`codex/v31-fix-artifacts`）合入 main 之后开工**，否则改的是不存在的分类逻辑
**Status**: open

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**: 
**Workflow Run**: 
**Artifact Digest**: 
**优先级**: P2（低可达，但第①项与现有分类论证自相矛盾，属真缺陷而非纯洁癖）
**发现来源**: review-artifacts 二代复核（F6 家族），L-T5 落票

## 背景：F6 引入的错误分类，以及它的一个漏洞

`nonBlockingArtifactEmitter`（`apps/core/src/p1/harness/artifact-progress-emitter.ts:36-60`，树签 `codex/v31-fix-artifacts` @ `038acd3c1`）按类型分流投影失败：

- `AgentSemanticEventStoreError` 且 `code === 'AGENT_SEMANTIC_EVENT_CONFLICT'` → **重抛**（内容分歧不是瞬时失败，吞掉就等于恢复了守卫要终结的静默拼接）；
- 其余 → 交给 `onDropped` 记录后放行（此刻页图已生成、商家已计费，一次写失败降级成客户端 gap 重拉快照，不能把整条已付费的运行掀掉）。

这套分流的立论是"分歧类必须响亮、瞬时类可降级"。

## ① 缺陷：`already projected under another boundary` 是裸 `new Error`，被分到了错误的那一侧

- `apps/core/src/p1/agent-semantic-events/memory-semantic-event-store.ts:37-39`
- `apps/core/src/p1/agent-semantic-events/postgres-semantic-event-store.ts:84-86`

（两处树签均为 `codex/v31-fix-artifacts` @ `038acd3c1`；此二处**不在** T5 分支的改动面内，是 base 既有代码。）

```ts
throw new Error(
  `Semantic event ${candidate.eventId} already projected under another boundary.`,
);
```

同一个 eventId 已在**另一个 thread 或另一个 resource（租户）**下投影过——这是比内容分歧更严重的边界冲突：它意味着 eventId 撞进了别的边界。但因为它是裸 `Error`、不是 `AgentSemanticEventStoreError`，`nonBlockingArtifactEmitter` 会把它当瞬时写失败**吞掉**，只记一行日志然后让运行继续，商家侧表现为一次静默的 revision gap。

**这与紧邻的分类论证直接矛盾**：分歧要响亮，而"撞进别人边界"反而被降级。

**修法**：升格为 typed error，走已有的冲突码：

```ts
throw new AgentSemanticEventStoreError(
  'AGENT_SEMANTIC_EVENT_CONFLICT',
  `Semantic event ${candidate.eventId} already projected under another boundary.`,
  { eventId: candidate.eventId, threadId: candidate.threadId },
);
```

`AGENT_SEMANTIC_EVENT_CONFLICT` 已映射 HTTP 409（`semantic-event-store.ts:58-62`），语义吻合。**注意** `AGENT_SEMANTIC_EVENT_THREAD_ISOLATION` 映射的是 404、语义是"该 resource 看不见这条流"，与本例（写入撞边界）不同，不要挑那个码。

**可达性**：低。生产 eventId 形如 `artifact.revised:<workflowId>:<artifactId>:r<n>`（`artifact-progress-emitter.ts:191`），workflowId 已含租户上下文，跨边界撞号需要 workflowId 复用或人工构造。**但可达性低不是分类错误的理由**——这条分支存在的唯一目的就是在那种情况下说话。

## ② 缺口：发散重抛之后的卡死形态没有任何测试

F6 之后，分歧会一路抛回 DBOS。若重执行**仍以另一种页序**发射（`note-page-execution-frame.ts` 的按页 memo 会为已发布的页重放、为其余页分配新号），那么每次重试都会撞上同一个 `AGENT_SEMANTIC_EVENT_CONFLICT`，形成**重试→同一冲突→重试**的循环，直到 DBOS 退避耗尽。

现状：无测试描述这个形态，也**没有裁决过期望行为**。三种候选，票内不预设答案：

1. 撞同一 eventId 冲突达 N 次即转终态失败＋死信（与 start 侧 `terminal_rejection` 对等物同姿态）；
2. 冲突时不重试整条 workflow，只把该 artifact 标为需要客户端全量重拉（gap 语义的强化版）；
3. 判定"页序在重执行间不稳定"本身是上游缺陷，在此处 fail-closed 并要求上游确定化。

**注意**：本形态的前提是"重执行页序不稳定"。当前生产链上页序来自 durable 的 brief 与冻结计划，重执行确定，所以这条循环**目前不可达**——与第①项一样属"契约级正确性"而非在线事故。若判定为不值得实现，正确处置是**在票里记录裁决与理由并关票**，不要留一张永不开工的开口票。

## Acceptance criteria

- [ ] 两处 `already projected under another boundary` 升格为 `AgentSemanticEventStoreError('AGENT_SEMANTIC_EVENT_CONFLICT')`，memory 与 postgres 两 store 行为一致；
- [ ] 一条先红测试证明 `nonBlockingArtifactEmitter` **重抛**该错误而非吞掉（升格前该测试必须红在"Missing expected rejection"，与现有 CONFLICT 重抛测试同形）；
- [ ] `onDropped` 仍然只接真瞬时写失败——原有"failed artifact projection does not abort"测试保持绿，用来证明这次升格没有把降级路径一起收紧；
- [ ] 第②项：或落一条描述所选语义的测试，或在票内写下裁决与理由后关票。二者皆可销票，**不接受留空**。

**禁止**：不得靠在 `nonBlockingArtifactEmitter` 里按错误**消息文本**匹配来分流——那会把一句人类可读的话钉成契约，也正是升格 typed error 要消除的东西。
