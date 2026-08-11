# V31-42 — shadow reader 的 threadId 槽位落 workspace id（经实测＝不可达分支，非隐患）

**Parent**: V31-03（agent semantic events shadow dual-write）
**批次**: 收尾
**Blocked by**: None — 但**实施前须先做 V31-03 shadow 命名空间晋升决策**（见「为什么现在不该动手」）
**Status**: open — 建议裁为「记录在案，随 V31-03 晋升决策一并处理」，不建议单独派工

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**: 
**Workflow Run**: 
**Artifact Digest**: 
**发现来源**: L-T5（codex/v31-fix-artifacts）复核 `shadow-workflow:` 兜底同形态时的旁支发现；**发现者随后自行推翻其危害性判断**，本票如实记录推翻过程

## 代码位置（署树锚）

`apps/core/src/p1/agent-semantic-events/shadow-workflow-event-reader.ts:82-84`

树签：`main` @ `501c14971` 与 `codex/v31-fix-artifacts` @ `f07f29d22` 两棵树该文件**逐字相同**（`diff` 返 0），故行号对合并目标同样成立。

```ts
const threadId = shadowThreadIdForWorkflow(
  'workflowId' in raw ? raw.workflowId : workspaceId,
);
```

## 形态

`threadId` 在两次 `safeParse` **之前**由未校验的 `raw` 算出。当信封没有 `workflowId` 时，回退把 **workspace id** 放进一个别处一律承载 **workflow id** 的槽位，得到 `shadow-workflow:<workspaceId>`——语义上是"该 workspace 的所有帧塌进同一条以 workspace 命名的 shadow thread"。

同一方法的持久化那一路（`:97`）另行用 `progress.data.workflowId` 重算 threadId，**不经过这个回退**；所以回退值只可能流向 `emitWorkflowToken`（ephemeral，零 store 写）。

## 为什么它其实不可达（初判被推翻的原因）

`packages/contracts/src/harness.ts`（树签 `f07f29d22`，与 main 同）：

- `workflowProgressEnvelopeSchema` :170-173 —— `workflowId: harnessIdSchema`，**必填**，`.strict()`
- `workflowTokenEnvelopeSchema` :230-233 —— `workflowId: harnessIdSchema`，**必填**，`.strict()`

两个 union 成员都强制 `workflowId`，所以：

1. 对声明的入参类型 `WorkflowProgressEnvelope | WorkflowTokenEnvelope`，`else` 分支**静态不可达**；
2. 即便运行期塞进一个脱约定对象（threadId 确实会算成 workspace 形），该对象会被**两个** `safeParse` 同时拒绝（`workflowId` 两边都必填），方法在任何 emit 之前 `return`。

**实测**（只读探针，kill-switch 开、adapter enabled，喂入一条合法 progress 帧 ＋ 两条无 `workflowId` 的脱约定帧）：

```
EMISSIONS [{"call":"projectWorkflowProgress","threadId":"shadow-workflow:wf-1"}]
ANY_WORKSPACE_DERIVED_THREAD false
```

即 workspace 派生的 threadId **从未到达任何一次 emission**；两条脱约定帧被静默丢弃，只有合法帧以正确的 workflow 派生 thread 落地。

结论：这是**防御性死分支**，不是潜在隐患。发现者最初报给主控的说法（"shadow 命名空间晋升之日即真"）**不成立**——可达性由 schema 阻断，与 kill-switch 无关，晋升也不会使其可达，除非同时放宽 envelope 契约。

## 为什么现在不该动手

- 现状零危害，改动收益≈0，而它触碰的是 V31-03 shadow 双写路径——该路径正等 `agent_semantic_event_adapter_v1` 晋升/退役决策，此刻改形只会给那次决策增加 diff 噪音。
- 若将来 envelope 契约放宽 `workflowId` 为可选（那才是唯一使此分支复活的前提），正确修法不是补兜底而是**让缺 workflowId 的帧不进 shadow 投影**（fail-closed，与 :94 `if (!progress.success) return;` 同姿态），并把 threadId 的计算移到校验**之后**。

## Acceptance criteria

本票不含实施。销票只需满足其一：

- [ ] 主控/域 owner 裁为「记录在案」，随 V31-03 晋升决策合并处理 → 关票并在 V31-03 决策文档留一行反向引用；
- [ ] 或（若仍决定清理）：threadId 计算移至 `safeParse` 之后、删除 `?? workspaceId` 回退，并补一条断言"无 `workflowId` 的帧不产生任何 shadow 投影"的测试；该测试须先红（把计算移回校验前即红）。

**禁止**：不得为这个分支补一个"合成 workspace thread 也算合法"的兜底测试——那会把一个不可达分支钉成契约。
