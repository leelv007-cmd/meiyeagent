# V31-33 — Harness start 恢复扫描无 tenant 作用域

**Parent**: spec-E（#5）；权威 V3.1 §23 执行脊 / 提交恢复
**Lane**: spine/confirmation 域（L-S0 territory，**不是 memory lane**）
**Blocked by**: —
**Related**: V31-41（prepare 失败无死信，同摸 `recoverPendingStarts` 与扫描选取路径）/ V31-39（`:r:` 与 startPrepared，同属确认链入口）——**三票成三角，禁并行开工**（语义锁见「关联」节）
**Status**: open

## What to build

> **锚署树**：本节行号出自**集成树** `codex/v31-integration` @ `98949870a`（Wave 4 重锚）。开票时的 T4 树锚见文末「锚点对照」——两套都成立，差的只是署树。

`listRecoverableHarnessStarts`（`apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:1281-1312`，SQL 谓词体 `:1286-1308`）的 WHERE 只有 `harness_state` / `updated_at` / lease 三类谓词，**没有 `workspace_id`**（集成树实测：该方法体内 `workspace_id` 出现次数＝0，而同文件另有 11 处查询按 workspace 收窄，故遗漏是显眼而非风格）。它由 `recoverPendingStarts()` 消费（`submission-coordinator.ts:1190` 方法、`:1193` 消费点），在 API 进程 boot（`api-runtime.ts:1829`）与定时 sweep（`:1837`）各跑一次——即一个多租户恢复扫描对租户完全无感知，`LIMIT 100` 之下先到先得，任一 workspace 的积压可以挤占其他 workspace 的恢复额度。

要做的是给恢复扫描一个明确的租户语义并落断言：要么按 workspace 分片/轮转取，要么显式声明「全局扫描 + 每 workspace 配额」并测出该配额。顺带把 `LIMIT 100` 与退避窗口的关系写清楚（当前 `LEAST(300, 2^attempts)` 秒退避在全局排序下会让老 workspace 长期领先）。

## 发现路径（证据的开场展品）

L-T4 在 V31-18/19 修复轮遇到一次间歇性 PG 红：`postgres-creation-submission-store.postgres.test.ts:987`（集成树锚；T4 树为 `:928`）断言 `attempted: 1`，某次返回 `attempted: 2`。按主控新协议在 `provision-test-db.sh` 一次性新库复现 → 全绿；长活 lane 库当时留有 15 行 / 14 个 distinct workspace_id，新库 0 行。

**独立旁证（review-memory 二轮复核，2026-08-09）**：另一条 lane（`美业内容2-v31-fix-03` 树）在其长活库上把同类断言打成 `actual {attempted: 4, failed: 0, started: 4}` vs `expected {attempted: 1, failed: 0, started: 1}`。**同一条断言在不同库上给出 2 与 4 两个不同的错值，而断言本身没变**——这正是「红的数字随行数缩放而非随断言缩放」这条启发式的直接实证，也说明该断言对「库里恰好有别的可恢复行」的敏感度是产品级的全局扫描造成的，不是测试写法问题。

**结论分两半，两半都要记**：
- 那条测试红是**环境性**的（长活库业务行积累），不是产品缺陷 —— 符合「红的数字随行数缩放而非随断言缩放」启发式。
- 但它暴露的**缺少租户作用域是真的**：正因为查询全局，该断言才会对「库里恰好有别的可恢复行」敏感。测试的脆弱性与产品的租户盲区是同一个根因。

## 附带项（同域，一并裁决）

`apps/core/src/assembly/core-assembly.ts:751-752`：`experience.retrieveForInjection` 在 late-bound 的 `sessionRetrievalExperiencePort.current` 未绑定时**静默返回 `[]`** —— 与 V31-18 P0-2 同形状的静默缺席，只是下沉了一层（无 receipt、无面板、无错误）。今天在 API 角色上不可达（`api-runtime.ts:432` 无条件绑定，且是直线代码不在任何 `if` 内、位置早于 plan session 装配；`worker-runtime.ts` 不做 planning——实测该文件对 `ComposerPlanSessionCoordinator`/`assembleProductionComposerPlanSession` 命中数＝0），但这个 seam 本身无守卫，任何一次重构都能把它变成活洞。要么绑定失败即抛，要么显式声明「未绑定＝合法空」并测出来。

**同族共三处，一并裁决（review-memory 二轮复核补全，锚署集成树 `98949870a`）**：票面原只记了第一处，实际这条 retrieval 链上有三个各自独立的「静默空」返回点，任一处被重构成活洞都会让确认过的记忆无声消失：

| # | 位置 | 形态 | 今天是否可达 |
|---|---|---|---|
| 1 | `core-assembly.ts:751-752` | `if (!sessionRetrievalExperiencePort.current) return [];` | 不可达（`api-runtime.ts:432` 无条件绑定） |
| 2 | `core-assembly.ts:790` → `:803` | `sessionRetrievalPorts.listConfirmedExperience?.({…}) ?? []` —— 可选调用＋空兜底双保险 | 不可达（`context-retrieval.ts:726` 是对象字面量成员，恒存在，故 `?.` 当下纯属防御噪声） |
| 3 | `context-retrieval.ts:733` | `if (!deps.experience) return [];` | 不可达（`core-assembly.ts:751` 恒传 `experience`） |

三处都是「潜伏」而非「在产活洞」，但也都**没有任何断言钉住其不可达性**——即没有红灯会在某次重构把它们变成活洞时亮起。裁决时三处口径应一致：要么统一 fail-closed，要么统一显式声明「未绑定＝合法空」并各自测出来，不要只修一处留两处。

## Acceptance criteria

- [ ] 恢复扫描的租户语义被显式选定并断言（分片/配额二选一，不留默认全局先到先得）
- [ ] 一个 workspace 的积压不能耗尽其他 workspace 的恢复额度（多 workspace 并发恢复测试）
- [ ] `postgres-creation-submission-store.postgres.test.ts:987` 类断言不再依赖库内无其他可恢复行（断言按 workspace 收敛）
- [ ] `core-assembly.ts:751-752` 的未绑定路径被裁决：fail-closed 或显式合法空 + 断言；**同族三处口径一致**（见「附带项」表，不得只修一处）

## 关联（语义锁：三票同摸扫描侧，禁并行开工）

- **V31-41**（`V31-41-prepare-failure-dead-letter.md`，prepare 失败无计数无死信钱无出口）：与本票**共同触及 `recoverPendingStarts`（集成树 `submission-coordinator.ts:1190`）与 `listRecoverableHarnessStarts` 的选取谓词**。本票改 WHERE 的租户维度，V31-41 改 `harness_start_attempts` 的自增时机与终态——**同一条 SQL 谓词的两个不同维度**（租户 vs 退避），并发改必冲突。双向引用已在 V31-41「关联」节建立。
- **V31-39**（`V31-39-fixture-kernel-composer-decision.md`，`:r:` 与 `startPrepared` 终裁）：同属确认链入口面，改的是 `startPrepared` 的 id 解析（集成树 `submission-coordinator.ts:382`），与本票不共享谓词，但**同文件**，合并顺序需主控排。
- 三票的共同底座是「补偿扫描是多租户共享资源」这一事实：V31-33 管公平性、V31-41 管终止性、V31-39 管入口正确性。任一票单独修完都不足以让扫描侧行为完整。

**W4 裁决约束（2026-08-10，主控裁决，全文在 V31-18「裁决 — 恢复路径 P0-1 的满足机制变了」）**：恢复路径的**双臂语义已定**——持久臂（有 `agentBinding` ＋ 有 `executionPlanFreeze`）在 `submission-coordinator.ts:777`（@ `98949870a`）／**`:785`（@ 合入后 `bb6fe34be`，实施 lane 认这个）** 短路，不重跑 prepare；可达臂（pre-durable 遗留行）才真跑。**实施本票时不得回退该短路**——它是防确认后计划漂移的守卫，回退会违反 V31-39 的付费确认语义。本票改的是 `listRecoverableHarnessStarts` 的 WHERE 租户维度，与该短路不在同一层，但两者都在 `recoverPendingStarts`（`:1190`）这条路径上，改动时容易顺手「整理」到它。

## Evidence

> 填表规则同 V31-18：只填**已实证**的行，没跑写 `—`，不写推测。行号一律署树。

| # | 证据 | 落点 | 结论 |
|---|---|---|---|
| 1 | 集成树谓词体仍无租户维度：`listRecoverableHarnessStarts` 方法体（`:1281-1312`）内 `workspace_id` 命中数＝0 | `postgres-creation-submission-store.ts:1286-1308` @ `98949870a` | 产品缺陷在集成树上**仍然成立**（非已被别的 lane 顺手修掉） |
| 2 | 一次性新库复跑同文件全绿：`postgres-creation-submission-store.postgres.test.ts` **14/14 pass, fail 0, skip 0**（`meiye_v31_t7_review`，`--test-concurrency=1`） | review-memory 二轮复核 @ `98949870a` 的前身 T7 树 | 该断言在**零残留库**上稳定，坐实「间歇红＝环境性」这一半 |
| 3 | 同一断言在长活库上给出两个不同错值：T4 树 `attempted: 2`、fix-03 树 `actual {attempted: 4, started: 4}` vs `expected {attempted: 1, started: 1}` | 见「发现路径」节 | 错值随库内可恢复行数缩放 ⇒ 敏感性来自**全局扫描**，即产品缺陷那一半 |
| 4 | 同族静默空三处的可达性判定 | `core-assembly.ts:751-752` / `:790→:803` / `context-retrieval.ts:733` @ `98949870a` | 三处均**潜伏不可达**，但零断言钉住不可达性 |
| 5 | 多 workspace 并发恢复的配额行为 | — | **未实证**（本票要建的正是这条；AC2 未满足前不得勾选） |
| 6 | 租户语义裁决后的分片/配额断言 | — | **未实证**（待实施 lane） |

## 锚点对照（三树，非错号）

本票开票时锚出自 **T4 树** `codex/v31-fix-memory-outcome`；V31-41 的锚出自 **S0 树** `codex/v31-s0-live` @ `319ea3922`；**Wave 4 已把本票正文重锚到集成树** `codex/v31-integration` @ `98949870a`。三套行号都成立，差的只是署树——集成树合入量大，同一符号最大漂了约 500 行。

| 符号 | T4 树（开票时） | 集成树 `98949870a`（本票现行） |
|---|---|---|
| `listRecoverableHarnessStarts` | `postgres-creation-submission-store.ts:783-801` | `:1281-1312`（SQL 谓词体 `:1286-1308`） |
| `recoverPendingStarts` 消费点 | `submission-coordinator.ts:663` | `:1190`（方法）/ `:1193`（消费） |
| API boot 调用 | `api-runtime.ts:1640` | `:1829` |
| 定时 sweep 调用 | `api-runtime.ts:1648` | `:1837` |
| 静默空 ①（附带项） | `core-assembly.ts:718-719` | `:751-752` |
| memory 平台无条件绑定 | `api-runtime.ts:403` | `:432` |
| 环境红断言行 | `…postgres.test.ts:928` | `:987` |

**协议（2026-08-09 立，V31-41 首述）**：跨 lane 传递的任何 `file:line` 锚必须署树（worktree 名或 commit SHA）。实施 lane 认本票面锚＝认集成树 `98949870a`；换树先重新定位符号，勿信裸行号。**开工前先 `git -C <树> log -1 --format=%H` 取真 HEAD**，若已前进则以当时 HEAD 重新定位（本票的漂移量本身就是这条协议的实证）。

## 留痕

- 开票：review-memory 二轮复核 L-T4 时发现，主控判为 spine 域缺口（2026-08-09）。
- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`）：正文重锚至集成树 `98949870a`；补三角互引与语义锁；附带项由一处补全为同族三处；Evidence 表填入四条已实证行、两条明确标未实证。本 commit 对 `apps/core` 与 `mkfast-template-main` 零改动。
- Wave 4 追加（同日）：并入主控对 T4/T7 崩溃恢复语义碰撞的裁决——「关联」节末补「不得回退 `submission-coordinator.ts:777` 短路」的实施红线，裁决全文在 V31-18。
