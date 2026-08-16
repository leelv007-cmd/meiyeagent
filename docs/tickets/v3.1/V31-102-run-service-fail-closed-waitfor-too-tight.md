# V31-102 — `run-service` 在 CI 上根本没有 fail-closed（原判「5s 太紧」已证伪）

**Parent**: 门稳定性
**批次**: 门稳定性（P2 —— 频率 1/18，排在 V31-99／V31-100 之后）
**Blocked by**: 无
**Related**: V31-98（把真实耗时钉死在 25ms）、V31-101（用一次固定 flush 等真异步）——**同一族**：
测试把一个负载相关的时长当成常量

**Status**: open（2026-08-16 改判）— **不是预算太紧，是 CI 上 wrapper 压根不退出**；把预算从 5000 抬到 11450 后第三次红落在 11721ms，即「耗时恒等于当轮预算＋~250ms」；抬预算的改动已 revert（`b3f3708d5`），**未修**

**Implementation state**: open（原修复 `8c969bb43` 已 revert，理由见「改判」一节）
**Verification state**: 3 红 / 三次都是超时而非慢完成；本机单跑 3/3 绿（~1235ms）
**Evidence SHA**: b3f3708d5dff880aa15ae43795d0c946149ed97c
**Workflow Run**: 31919765594（job 95097616109）；31925884434（job 95113257493）；31927292490（job 95116731903，PR #17）

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

---

## ⚠️ 改判（2026-08-16 晚）：上面整段推理是错的

按上面的结论把预算从 5000 抬到「由配置算出的」11450ms，第三次红出现在
**11721ms**（PR #17，run 31927292490 / job 95116731903）。

把三次红各自和**当轮的预算**并排看：

| 预算 | 实际 `duration_ms` | 差 |
|---|---|---|
| 5000 | 5237.4 | +237 |
| 5000 | 5319.5 | +319 |
| **11450** | **11721.0** | **+271** |

**耗时恒等于预算＋250~300ms。** 这不可能是别的：`waitFor`（`:81-90`）
轮询到 deadline 才 `assert.fail`，所以它失败时的 `duration_ms`
**按构造就等于超时值**。我把一个常量当成了测量值。

那两个「相差 82ms、说明真实耗时就压在界线上」的样本，
其实是**同一个常量的两次采样**——证据力为零，而我当时把它当成了最硬的证据。

### 真实结论

**CI 上 wrapper 根本不退出。这是挂死，不是慢。** 任何预算都够不着它。

本机 ~1235ms 的实测是真的，但**不相关**：它量的是「在能跑通的平台上、能跑通的那条路」。
macOS 上 1.2 秒 fail-closed 的东西，在 Linux runner 上 11.4 秒还没结束，
差的不是速度。

### 还没查清的（下一个人从这里接）

已排除：**不是定时器把事件循环吊住的**——
`retryTimer`／`resolutionTimer`／`healthMonitorTimer` 全部 `unref()` 过
（`run-service.mjs:236,417,430,444,486,495`）。

两条待查，都指向「child 没死 → 没有 exit 事件 → wrapper 不退出」：

1. **`if (failure) { resolveInstrument(...); return; }`**（`:419-422`）——
   这条分支**既不置 `healthFailureFatal`，也不发 SIGTERM**，而它上面刚
   `stopHealthMonitor()`。一旦走到这里，健康监控已停、child 还活着、
   没有任何东西会再触发退出。需要确认 CI 上 `failure` 是否被检测器置上了。
2. **进程组信号在容器里的行为**——`signalChildGroup` 走的是负 pid
   （`spawn` 时 `detached: process.platform !== 'win32'`）。
   若 `kill(-pid)` 在 runner 上打不中，SIGTERM 和 250ms 后的 SIGKILL 都会落空，
   同样是 child 不死、wrapper 不退。

取证建议：这条测试目前把 wrapper stderr `.resume()` 丢掉了
（`:1020`），所以 CI 日志里看不到 `[run-service] restarting …` 有没有打印出来。
**先把 stderr 收下来附到失败输出里**，一轮红就能把上面两条分开——
有 restarting 行＝重启发生过，问题在第二个窗；没有＝第一次 SIGTERM 就没打中。

## What to build

1. **别直接把 5000 改大**——那是拿放宽掩盖，且下一次负载更高时照样红。
   预算应当**由配置推导**：`2 × FAILURE_WINDOW + INTERVAL + spawn 余量`，
   并在测试里写明这个式子，让读的人知道为什么是这个数。
2. 若要更稳，考虑把「是否 fail-closed」与「多久 fail-closed」拆开断言：
   前者是产品合同（必须成立），后者是性能观察（不该卡门）。
3. **不要加重试**：这条测试验的就是 fail-closed，重试会把真正的挂死也吞掉。

## Acceptance criteria（已按改判重写）

原来的三条是围绕「预算」写的，现在证明预算不是病灶，故作废。留档说明作废理由：

- ~~新预算由配置推导~~ —— 做过了（`8c969bb43`），**没有用**，已 revert。
  推导本身是对的，但推的是一个与故障无关的量。
- ~~变异证~~ —— 做过了：破坏 fail-closed 逻辑后该测试在 11584ms 红。
  **这条变异证仍然成立且仍然有价值**——它证明该测试确实在验 fail-closed。
  但它同时说明：本机上「fail-closed 坏掉」和「fail-closed 正常」都能被测出来，
  所以 CI 上的红对应的是**真的没有 fail-closed**，而不是测试写歪了。
- ~~≥3 轮不再复现~~ —— 前提不成立。

新的验收条件：

- [ ] CI 失败输出里带上 wrapper 的 stderr，用一轮红分辨「重启发生过 / 第一次 SIGTERM 就没打中」
- [ ] 上面两条待查（`if (failure)` 早返回 ／ 容器内进程组信号）给出结论，写入本票
- [ ] 修复后，该测试在 CI 上以**接近本机的耗时**（~1.2s 量级）通过，
      而不是「换个更大的预算通过」——耗时接近预算就说明还在挂
- [ ] 变异证保留：破坏 fail-closed 逻辑，该测试仍必须红

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
