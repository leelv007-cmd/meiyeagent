# V31-41 — prepare 失败无计数、无死信、钱无出口：规划侧终态与预留释放

**Parent**: 无（V3.1 全量修复主控轮，review-memory 复核 T4 时发现的 spine 域缺口，2026-08-09）
**批次**: 收尾
**Blocked by**: None — can start immediately
**Status**: open
**域**: execution-spine / confirmation chain（与 V31-33 同域，见「关联」）

## 决策锚

- **D-122**（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md:2067`，HITL 编排容错原则：三允许、流程恒前进）：允许工具微错、人介入是修正点而非审批墙、**流程恒前进**。本票缺口正是这条的反面——恒定失败的 payload 既不前进也不终止，且没有任何介入点被暴露给运营。
- **D-150**（同文件 `:2426`，消费者证明关票门）：只写不读的终态＝未完成。本票第 3 件明确要求终态被 submit 读取，就是这条。
- **D-172**（同文件 `:3534`，积分制计费）：商家计费单位是积分。预留（reserved）是已扣费状态，永久悬挂＝商家的钱被扣住且无出口。

## 缺口（一句话）

**prepare 侧失败没有计数器、没有死信终态、预留没有释放出口。** start 侧有完整的死信对等物，prepare 侧一条都没有。恒定失败的 payload 让已扣费预留永久停在 `harness_state='reserved'`，被补偿扫描以约 1 Hz 无限重入，退避永停在 `2^0=1s`；运营侧只拿到一个计数，拿不到失败原因，也拿不到是哪一笔提交。

活性（liveness）是成立的——系统不 brick、不崩。缺的是**钱的出口**和**运营可见性**。

## 证据（行号为 `codex/v31-s0-live` @ `319ea3922` 亲验态）

> 派件时给的行号与本分支不符，已逐条核实更正；结论与机制**完全成立**，仅锚点位移。更正对照表见文末「引证更正」。

### ① 计数器只在 start 侧自增，prepare 失败走不到

- `apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:743`：`harness_start_attempts = harness_start_attempts + 1`，**唯一自增点**，位于 `claimHarnessStart`（方法起 `:690`）。
- 补偿扫描的调用顺序是 `prepareAgentPlan` **先**、`startHarness` **后**（`submission-coordinator.ts:734-735`）。`prepareAgentPlan` 抛出 → `startHarness` 永不执行 → `claimHarnessStart` 永不调用 → **attempts 永远是 0**。

### ② attempts 恒 0 ⇒ 退避恒 1s，扫描恒约 1 Hz 重入

- `postgres-creation-submission-store.ts:962-977`（`listRecoverableHarnessStarts`）选取条件：
  `harness_state = 'reserved' AND updated_at <= clock_timestamp() - make_interval(secs => LEAST(300, power(2, LEAST(GREATEST(harness_start_attempts - 1, 0), 8))))`
  attempts=0 → `GREATEST(-1,0)=0` → `2^0 = 1` 秒。指数退避与 300s 上限**从不生效**，因为指数的输入永不增长。
- `submission-coordinator.ts:727` `recoverPendingStarts` → `:734` `await this.prepareAgentPlan(candidate.submission)`。
- `apps/core/src/assembly/api-runtime.ts:1738-1741`：`setInterval(..., Number(env.HARNESS_COMPENSATION_POLL_MS ?? 1_000))`，即默认约 1 Hz。

### ③ 失败原因被吞，运营信号只有一个计数

- `submission-coordinator.ts:736-738`：**裸 catch** —— `} catch { failed += 1; }`，error 对象直接丢弃，本文件全域无 `console.*`（已 grep 确认）。
- `api-runtime.ts:1722-1728`：poller 侧有唯一信号 `if (result.failed > 0) console.error('Harness pending-start recovery failed.', result)`。`result` = `{ attempted, failed, started }`——**只有计数，没有 submissionId、没有 workspaceId、没有失败原因**。运营看到「failed: 3」而无从知道是哪三笔、为什么、是否同一笔在重复。

### ④ start 侧的死信对等物（prepare 侧应对齐的目标形状）

- 分类：`submission-coordinator.ts:793` `await this.harness.classifyStartFailure?.(startSubmission, error) ?? 'retry'`；谓词实现在 `creation-stage-port.ts:53-64`。
- 终态：`submission-coordinator.ts:797-801`，`disposition === 'terminal_rejection'` → `store.failHarnessStart(leasedStart)`，失败则回退 `releaseHarnessStart`。
- 落库：`postgres-creation-submission-store.ts:939-948`，`SET harness_state = 'failed'` 并清租约。
- 被读取：`submission-coordinator.ts:775-777`，`claimHarnessStart` 返回 `kind === 'failed'` → 抛 `Harness start permanently failed.`，商家侧 submit 得到「永久失败」而非无限等待。

**prepare 侧以上四段一段都没有。**

## What to build（四件，缺一不可）

1. **prepare 侧失败分类**：为规划失败引入与 `classifyStartFailure` 对等的分类接缝，区分「暂时性（值得重试）」与「恒定性（应终止）」。
2. **prepare 侧尝试计数**：让规划失败也自增一个计数器（复用 `harness_start_attempts` 还是新列由实施 lane 定），使退避真正生效、不再恒 1s。
3. **终态死信**：恒定性失败落一个终态，语义与 start 侧 `terminal_rejection → harness_state='failed'` 对齐，并且**必须被下游读取**——商家 submit 要能得到「永久失败」，不能只写不读（对齐 D-150 消费者证明门）。
4. **预留释放出口**：终态时释放已扣费预留，钱要么回到商家账户要么进入明确的对账态。**这是本票的头号目的**——前三件是机制，第四件是商家实际损失。

附带要求（不单独成件）：运营信号要带得动排障——至少携带 submissionId / workspaceId 与失败原因，而不是只报计数。

## 边界（明确不做 / 留给实施 lane）

- **分类谓词怎么划「暂时性 vs 恒定性」由实施 lane 设计**，票面只锚需求与证据行号，不预设判据。理由：这条线要区分 provider 抖动、配额、payload 恒定非法、上游合同变更等多种形态，票面若钉死判据会把设计空间提前关掉。
- **不要靠加日志或加告警结案。** 观测性是附带要求，本票的验收在钱的出口和终态被读取上。只把 `console.error` 补详细＝未完成。
- **不要在计数器方案上顺手改 start 侧退避语义**。start 侧当前行为是可信基线；若复用 `harness_start_attempts` 必须证明 start 侧退避序列不变（回归断言背书）。
- 不扩到补偿扫描的 tenant scoping —— 那是 V31-33 的面，两票同域但不同缺口，见下。

## 关联

- **V31-33**（recovery sweep tenant scoping，同为 execution-spine / confirmation 域，L-T4 复核产出）：与本票**共同触及 `recoverPendingStarts` 与补偿扫描选取路径**，实施时须互引并串行——两票都改扫描侧，语义锁纪律要求不并发开工。
  > 注：V31-33 票面文件在本 worktree 尚未落地（L-T4 域，待其提交）。本条为前置声明；V31-33 落地后由主控在两票间补双向引用，本票不再改动。
- V31-31（退役额度词汇）同为「钱的口径」类缺口但不同机制，无实施依赖。

## Acceptance criteria（行为为证）

- [ ] 恒定失败的 prepare payload 在有限次尝试后进入终态，不再被扫描无限重入——以行为断言背书（构造恒败 payload，断言重入次数有上限且退避序列真的增长）。
- [ ] 该终态被下游读取：商家 submit 对已终态提交返回「永久失败」语义，而非继续等待。给出 D-150 消费者证明三段 `file:line`。
- [ ] 终态时已扣费预留有明确出口：断言预留不再停留在 `reserved`，且账目上钱的去向是确定的（退回或进入对账态）——数字与实际释放一致，不是只改状态位。
- [ ] 计数器在 prepare 失败路径上真的自增：以变异验证背书（去掉自增，退避恒 1s 的旧行为复现，测试转红）。
- [ ] start 侧退避序列未被改动（若复用 `harness_start_attempts`）：回归断言背书。
- [ ] 运营信号携带 submissionId / workspaceId 与失败原因，不只计数。
- [ ] Core 受影响套件绿；PG 证据出自 `provision-test-db.sh` 一次性库（长活 lane 库的业务行积累会造假红）。

## 验收证据

> 空表待实施 lane 填写。只填**已实证**的行，不预填预期值。表形制若与 V31-29/V31-30 落地后的约定不一致，以后者为准。

| 项 | 命令 | 结果 | 证据（file:line / commit） |
|---|---|---|---|
| 恒败 payload 进终态（重入有上限） | | | |
| 退避序列真的增长（变异背书） | | | |
| 终态被 submit 读取（消费者证明三段） | | | |
| 预留释放出口＋账目数字一致 | | | |
| start 侧退避序列未变（回归） | | | |
| 运营信号带 submissionId/原因 | | | |
| Core 受影响套件（一次性 PG 库） | | | |

## 引证更正（派件锚点 → 本分支实测锚点）

派件所给行号均不匹配本分支；机制与结论逐条成立，仅锚点位移。实施时以符号定位为准，勿信行号。

| 派件锚点 | 本分支实测 |
|---|---|
| `postgres-creation-submission-store.ts:642-651`（attempts 自增） | `:743`；方法 `claimHarnessStart` 起 `:690`。`:642-651` 落在 `claimSemanticDecisionResumption`（起 `:592`），与本缺口无关 |
| `api-runtime.ts:1662-1666`（补偿扫描 / `HARNESS_COMPENSATION_POLL_MS ?? 1000`） | 文件为 `apps/core/src/assembly/api-runtime.ts`；poll 常量在 `:1061`、`:1740`、`:1817`；poller 体 `:1718-1741` |
| `submission-coordinator.ts:659-679`（`prepareAgentPlan` 重入） | `recoverPendingStarts` 起 `:727`，重入在 `:734`，裸 catch 在 `:736-738` |
| `:759-765`（`classifyStartFailure→terminal_rejection→harness_state='failed'`） | 协调器 `:789-802`（分类 `:793`、判定 `:797`、`failHarnessStart` `:799`）；落库在 store `:939-948`；被读取在协调器 `:775-777` |
| 「除 `console.error` 无运营信号」 | 成立，但位置在 `api-runtime.ts:1726`（gate `result.failed > 0`）。`submission-coordinator.ts` 全域无 `console.*`——失败**原因**被 `:736-738` 的裸 catch 丢弃，只有计数出得去。缺口比派件描述略重 |

## 留痕

- 发现链：review-memory 二轮复核 L-T4（`codex/v31-fix-memory-outcome`）时发现，主控判为 spine 域缺口，派 L-S0（确认链/spine domain owner）开票不实施，2026-08-09。
- 本票只开票，未做任何实施改动；`apps/core` 与 `mkfast-template-main` 在本 commit 中零改动。
