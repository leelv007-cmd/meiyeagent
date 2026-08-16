# V31-102 — `run-service` 的 fail-closed 断言把 5s 当作上界，负载下会红

**Parent**: 门稳定性
**批次**: 门稳定性（P2 —— 频率 1/18，排在 V31-99／V31-100 之后）
**Blocked by**: 无
**Related**: V31-98（把真实耗时钉死在 25ms）、V31-101（用一次固定 flush 等真异步）——**同一族**：
测试把一个负载相关的时长当成常量

**Status**: 已修复待验（2026-08-16）— 预算改为由配置计算（1450ms 确定性上界＋10s 挂死判定）；实测未加载 ~1235ms、CI 两次观测 5237/5319ms；变异证已过；剩 ≥3 轮 `root-quality` 观察

**Implementation state**: done（`8c969bb43`）
**Verification state**: 2 红 / 17 绿（近 19 轮 `root-quality` 统计）— 第二次红在 PR #16
**Evidence SHA**: 8c969bb43ed8524789272c01e31f99bca88d95fa
**Workflow Run**: 31919765594（job 95097616109）；第二次 31925884434（job 95113257493）

## 现象

`root-quality` → `mkfast-template-main test` →
`scripts/e2e/run-service.test.ts:1029`：

```
not ok 36 - a replacement candidate that never becomes ready fails closed
  error: 'the replacement candidate remained unready without failing closed'
  duration_ms: 5237.418957
  stack: waitFor (scripts/e2e/run-service.test.ts:89:10)
```

同一轮里 `[check]` 十门全 PASS——**红的是测试，不是门**。

## 判为抖动（不是回归）

同一份未改动的文件，在同期三条分支的 `root-quality` 上都是绿的
（`6d9c4f461`、`ba242495c`、`7ed19a182`），只有 main 那一轮红。
近 18 轮统计＝**1 红 17 绿**。

**2026-08-16 补：第二次红**（PR #16，run 31925884434 / job 95113257493），
`duration_ms: 5319.5`。加上第一次的 `5237.4`，两次落点相差 **82ms**。

这个聚集才是关键证据。原票把它当成「负载偶尔把一个宽裕的预算顶过去」，
两个样本挤在界线正上方 100ms 内，说的是**另一件事**：预算本来就压在
runner 的正常耗时区间里，红是常态而非坏运气。所以「1/18＝低频」这个判断
是被采样掩盖的，不是真的低频——同一轮里 `apps/core test:` 与
`mkfast-template-main test:` 在日志中交替输出，两套件在 runner 上是并跑的，
负载高低取决于两边当时各跑到哪，这才是 17 绿 2 红的来源。

## 机制（读源码得出）

测试（`:982-1035`）给 wrapper 的配置是：

| env | 值 |
|---|---|
| `E2E_SERVICE_HEALTH_FAILURE_WINDOW_MS` | 500 |
| `E2E_SERVICE_HEALTH_INTERVAL_MS` | 100 |
| `E2E_SERVICE_HEALTH_TIMEOUT_MS` | 100 |
| `E2E_SERVICE_MAX_RESTARTS` | 1 |

关服后到 wrapper 退出，真实下界是
**500ms 失败窗 ＋ 一次重启的 node 进程 spawn ＋ 再一个 500ms 失败窗**。
而断言给的预算是 `waitFor(..., 5_000)`（`:1029`）。

`waitFor` 的默认超时是 2000ms（`:81`），这里写了 5000——**5000 不是推导出来的，是拍的**。
CI runner 高负载下单次 node 冷启动就能吃掉数秒，两个窗加一次 spawn 逼近甚至越过 5s
完全正常（实测该轮用了 5237ms 才判失败，说明它当时**就差一点**）。

### ⚠️ 上面这段机制有一处错，修的时候查实了

「一个失败窗 ＋ spawn ＋ 再一个失败窗」是**加法**——错。
`run-service.mjs:213`：

```js
let healthFailureStartedAt = restartsUsed > 0 ? startedAt : undefined;
```

一旦用掉重启额度，第二个失败窗的计时起点是**替补 child 自己的 `startedAt`**，
也就是说这个窗**与 child 启动重叠**，不排在 spawn 之后。
所以确定性代价是「两个窗」，不是「两个窗＋一次 spawn」。

同时 `PRODUCTION_CANDIDATE_KILL_GRACE_MS`（250ms）**不在实测路径上**：
本测试的 child 装了 `process.on('SIGTERM', () => process.exit(7))`，
SIGKILL 定时器被 `unref()` 后根本不会触发。它只在「SIGTERM 被无视」时才计入，
所以留在上界公式里，但不能算进典型耗时。

### 实测（本机，2026-08-16）

单跑该条三次：**1234.9 / 1231.8 / 1254.6 ms**。

于是比例是硬的，不再是推测：CI 上同样的工作要 5237／5319ms，
即 **~4.3 倍**。而 5000 只是未加载耗时的 ~4 倍——它从来没有余量，
两次红是必然结果。

## What to build

1. **别直接把 5000 改大**——那是拿放宽掩盖，且下一次负载更高时照样红。
   预算应当**由配置推导**：`2 × FAILURE_WINDOW + INTERVAL + spawn 余量`，
   并在测试里写明这个式子，让读的人知道为什么是这个数。
2. 若要更稳，考虑把「是否 fail-closed」与「多久 fail-closed」拆开断言：
   前者是产品合同（必须成立），后者是性能观察（不该卡门）。
3. **不要加重试**：这条测试验的就是 fail-closed，重试会把真正的挂死也吞掉。

## Acceptance criteria

- [x] 新预算由配置推导且在测试内写明推导式，不是换一个更大的魔数
      —— `FAIL_CLOSED_DETERMINISTIC_MS` 由该测试自己下发的四个 env 值算出
      （`(MAX_RESTARTS+1) × (窗+间隔) + kill grace` ＝ 1450ms），
      env 与公式共用同一批常量，改窗或改重启数预算自动跟着走。
- [x] 变异证：把 wrapper 的 fail-closed 逻辑破坏掉，该测试仍必须红
      —— 把 `healthFailureFatal = true; signalChildGroup('SIGTERM')` 换成提前
      `return`，该条在 **11584ms** 红在 fail-closed 断言上（`✖ pass 0 / fail 1`）；
      随后按 sha256 校验还原（`308031a1…c262dd` 前后一致，无 MUTANT 残留）。
      全文件复跑 **40/40 绿**。
- [ ] 后续 ≥3 轮 `root-quality` 未再出现该条红 —— **0/3**，观察债

## 没做什么（明确记下，免得下一个人以为漏了）

- **没有加重试**。这条测试验的就是 fail-closed，重试会把真正的挂死一起吞掉。
- **没有动那个 4_000**（`:1023` 等首次 health 探针）。它是另一个量纲
  （只等第一次探针到达，4000 已是 40 倍间隔），票面也没点它；按外科手术原则不顺手改。
- **没有把 `PRODUCTION_CANDIDATE_KILL_GRACE_MS` 导出来复用**。它在
  `run-service.mjs` 里是模块私有；测试侧镜像了一份并写明出处。
  这里放弃的是「常量漂移时自动同步」——但公式是上界不是等式，
  那个常量变大只会让本测试更松、不会误红，所以镜像的代价是可接受的。

## 为什么排 P2

频率 1/18，且不在关键路径上。V31-99（拖拽地板单位错用，商家可实际触达）与
V31-100（interaction 套件并行争用，影响面更大）都更靠前。
记在这里是为了**别让下一个人重新查一遍**——尤其别把它误判成产品的 fail-closed 真坏了。
