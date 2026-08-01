# #325 P2-13 经验化收官 — 交底

**分支**：`leelv007-cmd/lane-325`

**开工基线**：`69cf06e1a6e18734fcefef8122a833e8a4b8e3a7`

**规格**：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §8.3 / P2-1 / D5 / D7
**边界**：导航「经验」文案 + 任务内三处记忆露出 + candidate→delivery morph。不重做 #316 三层页 IA、不扩一级导航项。不 push / 不关票 / 不移动 main。

---

## 1. 实施摘要

### 1.1 一级导航改名「经验」

| 面 | 改动 |
| --- | --- |
| Locale 真源 | `product_navigation_memory` zh=`经验` / en=`Experience`；`memory_page_title` 同步 |
| 路由 | 仍 `/dashboard/memory`（id 仍 `memory`） |
| §9.1 同步 | `navigation.ts` 注释、`navigation.test.ts` 产品文案合同、sidebar（经 `BUSINESS_NAVIGATION`）、mobile-nav（同源列表）、命令面板（同源 label）、e2e 标签常量 |
| 页描述 | `memory_page_description` 只陈述「你确认过、之后创作可参考」；移除「用得越久，它越懂你」的无证据承诺 |

### 1.2 任务内三处露出

| 槽 | 时机 | Producer | 无 producer / 空数据 |
| --- | --- | --- | --- |
| 执行前依据 `experience-basis-surface` | `submitting` / `running` / `awaiting_answer` | frozen ContextBundle 中 precedence resolution 后仍为 `confirmed_preference` 的值；同一纯投影随 `context_injection` progress 和 terminal state 双 carrier 传递 | context producer 尚未到达时 loading；已到达但零偏好时诚实空态；不投影 workspace 全局经验或可变 identity selector |
| 交付后沉淀 `experience-sediment-surface` | `delivered` | `memory.entries_page` 中 `source.conversationId === ${workId}:${taskId}` 的 `pending` 条目 | 无当前任务 source 绑定或只有其他任务条目时诚实空态；confirm/reject 命令再校验 entryId 必须属于当前投影 |
| 纠错分流 `experience-correction-surface` | 非 `idle` | **未就绪**（`producerReady:false` 写死） | 诚实空态：说明尚不能自动区分「门店事实」vs「仅本次」 |

实现：

- 纯模型：`mkfast-template-main/src/product/composer/task-experience.ts`
- 呈现：`task-experience-surfaces.tsx`（`data-agent-frame="memory"`）
- 挂载：`composer-conversation.tsx` 时间线插槽
- 生产装配：Core 从 frozen ContextBundle 生成稳定 `sourceRef/label/value` 投影；运行中由 progress 展示、终态由 state 恢复；`composer-home.tsx` 的 workspace `memory.entries_page` 只服务沉淀面

### 1.3 candidate → delivery morph

- `domMax` + shared `layoutId=composer-result-morph-{taskId}`：完整 candidate 持有 layoutId；交付卡接管；capsule 不持 layoutId
- `prefers-reduced-motion: reduce` → 不设 layoutId / layout，瞬时切换（`data-motion=off`）
- 测点：`composer-delivery-morph` / `composer-candidate-morph` / `composer-candidate-morph-capsule`

---

## 2. 「实施时定」落点

| 项 | 定案 | 落点 |
| --- | --- | --- |
| 纠错分类 producer | 本票**不伪造**分类；`producerReady=false` 固定诚实空态 | 票下评论 + 本文 §1.2；后续承接需独立 producer 票 |
| 沉淀动作语义 | 「以后这样」= confirm 候选；「仅这次」= reject（理由「仅本次任务…」）— 与方案二「以后这样 / 仅这次」对齐，不写长期 preference 新命令 | `composer-home.tsx` sediment handlers |
| 依据 chips 上限 | 默认 5；只接受当前 workflow/task 对齐的 carrier；只投影 frozen bundle 已解析的 `confirmed_preference`，不读 identity selector | `projectHarnessExperienceBasis` + `harnessExperienceBasisFromProgress/State` + `projectExperienceBasis` |
| 沉淀任务绑定 | Core 与 Web 共同调用 `memoryTaskSourceConversationId(workId, taskId)`，锁定 `${workId}:${taskId}`，Web 不再自造字符串 | `production-memory-sedimentation.ts` + `composer-home.tsx` |
| morph 与 reduced-motion | 非缩短动画，而是零 layout 动画 | `composer-conversation.tsx` `morphEnabled` |

---

## 3. 验收对照（行为为证）

| 票面断言 | 证据 |
| --- | --- |
| 一级导航商家可见文案为「经验」 | `navigation.test.ts` P2-13 合同：zh=`经验` en=`Experience`；locale keys |
| 三处露出有 producer 呈现 / 无 producer 诚实空态 | contracts 锁定 frozen projection 与 progress carrier；Core 锁定 progress/result 同投影和 terminal snapshot；Web unit 覆盖运行中、terminal restore、旧序列、旧任务、bundle/task 不一致；interaction 覆盖 ready/empty 与跨任务 pending 不可操作 |
| morph 具 reduced-motion 替代 | conversation interaction：motion on 时 delivery morph 面存在；reduce 时 `data-motion=off` 且卡面仍可达 |

---

## 4. 验证命令摘要（lane 内）

```text
@meiye/contracts full test
  → 148/148 pass
tsx --test workflow-core + dbos-workflow-events + production-memory-sedimentation
  → 72/72 pass
tsx --test navigation + task-experience + workflow-event-stream + composer-run-scope
  → 32/32 pass
vitest run task-experience.interaction + composer-conversation.interaction
  → 41/41 pass
pnpm typecheck  → contracts/core typecheck + Web client/SSR production build + Web typecheck, exit 0
pnpm check  → Biome 1114 files, locale 3992 keys, all root gates PASS
```

e2e 全量留给主控。

---

## 5. 消费者 / 可达 / 出口 / 反向

| 门 | 结论 |
| --- | --- |
| 消费者证明 | 导航：sidebar/mobile/cmd palette 经 `BUSINESS_NAVIGATION`；依据面：frozen ContextBundle → Core progress/result → SSE state/progress → current-workflow hook → `ComposerConversation`；沉淀面：current-task source；morph：candidate/delivery 渲染 |
| 可达性 | 依据/沉淀/纠错 phase gate 与 session.phase 绑定；context progress 在 execution 前可见，terminal state 可恢复同一投影；无 canonical carrier 时不读取 workspace 条目补值；纠错 producer 不可达已诚实标明 |
| 出口（含负向） | 沉淀「仅这次」走 reject，不写 confirmed；其他任务 entry 无按钮且命令 guard 再拒绝；纠错无 producer 时无分类动作；reduced-motion 不挡交付卡点击 |
| 反向复核 | 实现面均可从前台 trace 回生产入口；无新增一级导航；未改 #316 三层页结构 |

---

## 6. 非本票

- 不 push / 不关票 / 不合入 main
- 不新增 agent runtime / 不把 Tiptap 塞进 Composer
- e2e 全量 / P1 齐验门 由主控
