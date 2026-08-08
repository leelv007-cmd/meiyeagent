# V31-26a — Legacy 退役零消费者证明矩阵

**票**: V31-26a（本地半；V31-26b 试点依赖部分不碰）  
**权威**: V3.1 §35 批次 6、§34.3、U14；`docs/specs/v3.1-spec-I-legacy-retirement-pending-publish.md`  
**机器锁**: `apps/core/src/p1/ops-console/retirement-proof-matrix.static.test.ts`  
**日期**: 2026-08-09  

## 方法

每项构造性证明 = **grep 级引用清单**（生产源，默认排除 `*.test.ts(x)`）+ **运行时/装配消费者**（assembly 接线或热读 gate）。  
结论三态：

| 结论 | 含义 |
|---|---|
| **可删** | 生产零消费者；本半可执行删除 |
| **尚有消费者** | 仍有生产调用；本半只登记，不删 |
| **试点后再判** | 依赖真实商家试点 / V31-26b 前置 |

**硬红线**：`force_legacy_five_stage` 与 legacy five-stage 执行路径本半**绝对不删**（V31-26b）。

---

## 矩阵

| ID | 候选退役项 | 关键符号 / 路径 | 生产引用摘要 | 结论 | 本半动作 |
|---|---|---|---|---|---|
| R1 | Thread=Work 假设胶水 | `openLegacyWorkThread`；`agent-session/*`；web `v31-thread-root-workbench` lazy open | 生产 store/module 仍实现并对外暴露；历史作品懒打开旅程依赖 | **尚有消费者** | 不删；试点后再判是否收敛为 pure Thread API |
| R2 | 旧 result conversation glue | `ComposerConversation`；`composer-conversation.tsx`；result-center 并行面 | Composer 主宿主仍挂载卡片对话流；Workbench 未完全替代 | **尚有消费者** | 不删 |
| R3 | 重复 planning DTO | `PlanProposal`（`turn-contracts`）vs `MarketingPlanRevision`（contracts） | 两者职责不同：LLM 提案 vs 持久 revision；非死代码双份 | **尚有消费者** | 不删（非重复死 DTO） |
| R4 | 第二份 Prompt pack 映射 | `MODEL_SUPPLY_PROMPT_KEY_BY_OPERATION` 私有字面量表 vs `LANGUAGE_MODEL_PROMPT_KEY_BY_OPERATION` | 两表语义相同；harness 侧私有字面量是第二份拷贝 | **可删**（私有字面量） | **已删**：harness 改为 import 唯一权威表 |
| R5 | 手工硬编码 Tool allowlist | `approvedToolNames` ∩ `tool-registry.toKernelTools`；ops `tool-policy` | 服务端 allowlist 是权威安全面，非死代码；与 Tool Policy revision 并存 | **尚有消费者** | 不删；后续若 Tool Policy 全量 pin 再收敛 |
| R6 | 无消费者旧 Harness surface | `legacyHarnessInteractionPendingProjectionSchema`（interaction v1→v2） | 仍接受历史 pending 投影重放；删则 in-flight/历史 interaction 读失败 | **尚有消费者** | 不删；等 U14 归档后评估 |
| R7 | 重复 UI（旧卡片流） | `ComposerProgressCard` / `ComposerDeliveryCard` / `ComposerReportCard` via `composer-conversation` | 生产 Composer 对话流仍渲染 | **尚有消费者** | 不删；Workstream 全量替换后归 V31-26b/试点后 |
| X1 | `force_legacy_five_stage` + legacy five-stage 路径 | `make-snapshot-consume` / `compiled-carrier-executor` / ops kill switch | 回退开关 + 执行分支仍为生产路径 | **试点后再判**（V31-26b） | **禁止删除** |

---

## R4 删除证据（本半唯一代码删除）

- **删除对象**：`apps/core/src/p1/harness/langfuse-prompts.ts` 内私有字面量  
  `MODEL_SUPPLY_PROMPT_KEY_BY_OPERATION = { 'copy.generate': ... }`  
- **替代**：`import { LANGUAGE_MODEL_PROMPT_KEY_BY_OPERATION } from '../model-supply/route-contracts.js'`  
- **消费者**：`modelSupplyPromptResolverFromHarness` 仍在；只去重映射表  
- **验证**：`retirement-proof-matrix.static.test.ts` 断言私有字面量不回潮

---

## U14 / flag 本半交付（非删除项）

| 交付 | 接线证明 |
|---|---|
| replay 归档条件门监控 | `legacy_replay_archive_gate` query；`PostgresLegacyReplayInventory` 装配于 `api-runtime` OpsConsoleService |
| 审计只读导出 | `export_legacy_replay_audit` query |
| flag 清单 + 翻转 | `list_v31_feature_flags`；`set_kill_switch` 对 admin-config 热读开关 dual-write |
| 翻转演练 | `v31-feature-flags.test.ts` + `docs/ops/v31-26-feature-flag-flip-drill.md` |

---

## 汇总

| 结论 | 项 |
|---|---|
| 可删（已执行） | R4 私有 prompt 映射字面量 |
| 尚有消费者 | R1, R2, R3, R5, R6, R7 |
| 试点后再判 / 26b | X1 `force_legacy_five_stage` 与 legacy five-stage 路径 |

商家体验：本半无删除 live 商家路径；仅去重内部映射表 + 增加只读 ops 监控。
