# V31-98 — `unified-media-stage-ports.test.ts:539` 把真实耗时钉死在 25ms，负载下必红

**Parent**: 门稳定性（`required` / `root-quality`）
**批次**: 仪器缺陷（P1，直接占用 `required` 可用性）
**Blocked by**: 无
**Related**: V31-92（另一条 `root-quality` 间歇红；**不是同一条**——V31-92 的墙钟机制我已撤回，
那票是 fallback 证据清理，本票才是真墙钟）

**Status**: 已修复待验（2026-08-16）— 机制读源码得出，负载下 6/8 复现，改后同负载 8/8 绿，变异证非恒真；`required` 同 SHA 绿未跑

**Implementation state**: 已实现（分支 `fix/v31-98-wallclock-exact-assertion`）
**Verification state**: 本地已证（含复现＋对照＋变异）；CI 待跑
**Evidence SHA**:
**Workflow Run**: 31908610673（PR #8 的 `root-quality` 红，`26 !== 25`）

## 现象

`Core quality / root-quality`（**required 成员**）红在一条与被测改动完全无关的 core 测试上：

```
not ok 1693 - top-level bounded media execution turns Model Supply fallback
              exhaustion into a resumable checkpoint
  location: apps/core/src/p1/harness/unified-media-stage-ports.test.ts:1:9843
  error: Expected values to be strictly equal:  26 !== 25
  expected: 25   actual: 26
  stack: TestContext.<anonymous> (…unified-media-stage-ports.test.ts:539:9)
```

发现它的那个 PR（#8）只改了一个 Playwright spec，**碰不到 `apps/core`**；
同期 main 的 `root-quality` 是 success。所以不是 main 红，也不是该 PR 引入。

## 机制（读源码得出，不靠采样）

`apps/core/src/p1/harness/execution-selection.ts:365,373`：

```ts
const elapsed = Math.max(0, Math.ceil(nowMs() - activeStartedAt));
wallClockMs: activeWallClockBase + elapsed,
```

`activeWallClockBase` 是 durable 记录里的生命周期基线 25（同一测试 `:515` 已单独断言
`providerRoute.lifecycleBaselineMs === 25`），`elapsed` 是**真实经过时间**再 `Math.ceil`。

所以 `wallClockMs === 25` 要求 `nowMs() - activeStartedAt <= 0`，
即**整段 bounded execution 落在同一个毫秒刻度内**。`Math.ceil` 让它达到最脆：
0.001ms 也进位成 1 → 26。空载机器上通常成立，CI 负载下必然偶尔不成立。

### 同文件自带对照

| 位置 | 断言 |
|---|---|
| `:214` | `assert.ok((… .wallClockMs ?? -1) >= 25)` |
| `:670` | `assert.ok((… .wallClockMs ?? -1) >= …)` |
| **`:539`** | **`assert.equal(… .wallClockMs, 25)`** ← 唯一钉死的 |

**同一个量，同一个文件，三处断言，只有一处用等于。** 作者自己的口径是下界。

## 复现与证据（本机）

| 条件 | 结果 |
|---|---|
| 空载 ×12 | **12/12 绿**（值恰为 25） |
| 24 个占核进程 ×8 | **6/8 红**，实测 29 / 29 / 41 / 44 / 51 / 58 |
| 改后，同样 24 进程负载 ×8 | **8/8 绿** |

红的六次**全部大于 25，从来不小于**——正是 `基线 25 + Math.ceil(真实耗时)` 的签名。
换言之产品合同（消耗的墙钟不低于生命周期基线）**六次全部成立**，
失败的只有「恰好等于」。

**变异证**：把新断言改成 `>= 26` 后空载即红（空载值恰为 25），
证明它读的是真实测量值、能失败，不是恒真式。

## 修法与它放弃了什么（必须写明，否则与「删断言换绿」无法区分）

改为 `assert.ok(first.snapshot.consumption.wallClockMs >= 25)`，与 `:214`／`:670` 同口径。

**这不是放松仪器**，判据是：

1. 被放松掉的量是**机器调度开销**，不是产品行为。`Math.ceil(nowMs() - activeStartedAt)`
   按定义就是「active 开始以来的真实时间」，负载下变大是正确计量而非计量错误。
2. **产品控制的那部分精确性没有丢**：基线是否恰好为 25，已由 `:515` 单独钉死。
3. 原断言并不能捕获任何产品缺陷——它只能捕获「机器不够快」。

**放弃的是**：将来若有人让 harness 在这条路径上多睡一段，`>= 25` 抓不到。
若要连这条也守住，正解不是恢复 `equal`，而是**注入确定性时钟**：
`execution-selection.ts:115,342` 已支持 `ports.nowMs`，但
`ModelSupplyHarnessMediaExecutionPort`（`unified-media-stage-ports.ts`）不透传它——
补这条测试缝要动 apps/core 生产类型，代价与收益不成比例，故未做，记在此处备查。

## Acceptance criteria

- [x] 机制在票内写明（文件 + 行 + 触发条件），不是「疑似」
- [x] 复现：同一条测试在负载下必现，空载不现
- [x] 对照：改前改后同负载
- [x] 变异证：新断言能红
- [ ] `required` 同 SHA 绿
- [ ] 后续 ≥3 轮 `root-quality` 未再出现该条红
