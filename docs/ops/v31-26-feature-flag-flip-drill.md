# V31-26a — V3.1 Feature Flag 翻转演练记录

**日期**: 2026-08-09  
**机器证明**: `apps/core/src/p1/ops-console/v31-feature-flags.test.ts`  
**清单权威**: `apps/core/src/p1/ops-console/v31-feature-flags.ts`（`V31_FEATURE_FLAG_CATALOG`）

## 清单摘要

| key | kind | landed | flip path |
|---|---|---|---|
| agent_semantic_event_adapter_v1 | flag | yes | admin_config |
| make_steering_v1 | flag | yes | admin_config |
| agent_memory_read_v1 | flag | yes | admin_config |
| agent_memory_candidate_write_v1 | flag | yes | admin_config |
| marketing_goal_v1 | flag | yes | admin_config |
| proactive_opportunity_v1 | flag | yes | admin_config (workspace) |
| ~~force_legacy_five_stage~~ | kill | — | **已删（2026-08-12，26b 用户拍板；连 legacy runner 一并退役）** |
| disable_make_steering | kill | yes | ops_console **+ admin_config mirror** |
| disable_memory_write / read | kill | yes | ops_console **+ admin_config mirror** |
| disable_proactive_agent | kill | yes | ops_console **+ admin_config mirror** |
| agent_thread_v1 / agent_run_v1 / progressive_plan_v1 / agent_kernel_v1 / compiled_execution_plan_* / execution_plan_snapshot_v1 | flag | **no** | 计划名未登记热读；本半只清单化 |
| disable_agent_planning / force_manual_plan_confirmation | kill | **no** | 面板可见但不可 enable |

## 本半补齐

1. **memory kill switches** 在 ops 面板 `landed: true`（V31-18 已接线 runtime）。  
2. **dual-write**：`set_kill_switch` 对 `disable_make_steering` / `disable_memory_*` / `disable_proactive_agent` 同步写 admin-config，使 ops 面板翻转触达 runtime 热读。  
3. **production 装配**：`api-runtime` 注入 `killSwitchAdminConfigMirror` → `adminConfigRepository.apply`。

## 演练结果（单测）

| 演练 | 测试名 | 翻转 | 回退 | 结果 |
|---|---|---|---|---|
| make_steering flag | `drill: make_steering_v1 flag flip off then rollback restores enabled` | off → disabled | on → enabled | pass |
| disable_make_steering | `drill: disable_make_steering kill switch flip + rollback via admin-config mirror` | on → kill_switch | off → enabled | pass |
| disable_memory_write | `drill: disable_memory_write flip + rollback affects resolveAgentMemoryKillSwitch` | on → write disabled | off → write allowed | pass |
| disable_proactive_agent | `drill: disable_proactive_agent flip + rollback` | on → disabled | off → enabled | pass |
| semantic event adapter | `drill: agent_semantic_event_adapter_v1 flip on then rollback off` | on → true | off → false | pass |
| force_legacy_five_stage | `drill: force_legacy_five_stage flip + rollback via ops kill-switch store only` | on → store true | off → store false | pass（历史记录；**开关与演练测试已随 26b 删除，2026-08-12**） |

## 回退纪律

- 商家面永不暴露上游成本（D-061）。  
- ~~`force_legacy_five_stage` 可翻转可回退，但**删除**归 V31-26b~~ —— 已执行（2026-08-12）；legacy 路径回退面改为 application version pin。  
- admin-config 写路径保留 `config_rollback`；ops kill switch 回退 = `enabled: false` 再写一次（双写镜像同步）。
