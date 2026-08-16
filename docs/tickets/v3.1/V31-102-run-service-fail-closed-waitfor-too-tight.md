# V31-102 — `run-service` 在 CI 上根本没有 fail-closed（原判「5s 太紧」已证伪）

**Parent**: 门稳定性
**批次**: 门稳定性（P2 —— 频率 1/18，排在 V31-99／V31-100 之后）
**Blocked by**: 无
**Related**: V31-98（把真实耗时钉死在 25ms）、V31-101（用一次固定 flush 等真异步）——**同一族**：
测试把一个负载相关的时长当成常量

**Status**: 已关票（2026-08-16，`5c5f2e1ed` 经 PR #21 进 main `cf33894c3`）— 真因＝**测试前置条件写错**：`healthRequests > 0` 在请求「到达」时就放行，而 `healthConfirmed` 要整轮探测成功才置位；配上 100ms 的健康超时，CI 负载下第一次探测被掐死，`run-service.mjs:403` 便按设计让首个化身**无限等待**（不 SIGTERM／不重启／不退出）。诊断器捕获的 wrapper stderr 全空（从未宣告重启）是决定性证据，同时把此前两个候选（`:420` 早返回、进程组信号）双双排除。修法＝健康超时 100→2000ms ＋ 前置条件改 `>= 2`，**`waitFor` 的 5000ms 预算一字未动**；本机已确定性先红后绿（5186ms 红 ↔ CI 5216ms），整文件 40/40 绿

**Implementation state**: 已修（原修复 `8c969bb43` 已 revert，理由见「改判」一节；本次修的是别处）
**Verification state**: 本机确定性复现红→修后绿（同条件 1435ms）；单条 3/3、整文件 40/40 绿；**CI 侧待验**
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

取证：**已做**（本轮）。这条测试原先把 wrapper stderr `.resume()` 丢掉，
所以三次 CI 红都看不到 `[run-service] restarting …` 有没有打印出来。
现在 stderr 被收下来折进断言失败文案（`waitFor` 的 message 参数加了 thunk 形态——
node:test 的失败输出是 CI 唯一会打印的东西，不在里面的等于没有）。

本机用变异（把 `healthFailureFatal = true; signalChildGroup('SIGTERM')` 换成提前
`return`）验过这条仪器确实会带出内容：

```
the replacement candidate remained unready without failing closed; wrapper stderr was
"[run-service] production-candidate exited with exit code 7; evidence: …
 [run-service] restarting production-candidate after unexpected exit code 7 (1/1)"
```

**判据**：下一次 CI 红里——
- 有 `restarting … (1/1)` ＝ 第一次 SIGTERM 打中了、child 也退了、重启发生过，
  挂在**第二个窗**（嫌疑指向 `if (failure)` 早返回，或第二次 `signalChildGroup`）；
- stderr 为空（文案会写 `(empty — no restart was ever announced)`）
  ＝ **第一次信号就没送到**，嫌疑指向容器内的进程组信号。

这一步只是取证，**不是修复**；本票仍为 open。

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

- [x] CI 失败输出里带上 wrapper 的 stderr，用一轮红分辨「重启发生过 / 第一次 SIGTERM 就没打中」
      —— **诊断器命中，见下节**：run `31939952353`（job `95147577355`，PR #20）
- [x] 上面两条待查（`if (failure)` 早返回 ／ 容器内进程组信号）给出结论，写入本票
      —— **两条都不是**，wrapper 根本没走到那里；真因见下节
- [x] 修复后，该测试在 CI 上以**接近本机的耗时**（~1.2s 量级）通过，
      而不是「换个更大的预算通过」——耗时接近预算就说明还在挂
      —— **达成**：run `31942297338`（job `95153119603`）
      `ok 36 - a replacement candidate that never becomes ready fails closed`，
      **`duration_ms: 1375.901291`**。对照修前那轮是 `5216.023529`（＝预算本身）。
      本机同条件 ~1.2–1.4s，**CI 已与本机同量级 ⇒ 是真过，不是挂在更大的盒子里**
- [x] 变异证保留：破坏 fail-closed 逻辑，该测试仍必须红

## ✅ 定性与修复（2026-08-16，由那一轮红直接读出）

### 诊断器给了什么

PR #17 加的 stderr 捕获在 PR #20 的 `root-quality` 上第一次真报出来：

```
duration_ms: 5216.023529
error: 'the replacement candidate remained unready without failing closed;
        wrapper stderr was (empty — no restart was ever announced)'
```

**「stderr 全空、一次重启都没宣告过」是决定性的一句。**
重启宣告在 `run-service.mjs:577-580`。既然没打印，wrapper 就从没走到
第一次 SIGTERM——于是此前挂着的两个候选（`:420 if (failure)` 早返回、
容器内进程组信号打不中）**同时出局**，它们都在重启之后才可能发生。

### 真因

`run-service.mjs:403`：

```js
if (!healthConfirmed && restartsUsed === 0) return;
```

这是**有意为之**（注释在 `:399-402`：首个化身要负责生产冷构建，可以无限等第一个 pong）。
后果是：只要 `healthConfirmed` 一直是 false 且还没重启过，健康监视器**永远直接 return**，
不 SIGTERM、不重启、不退出。

而 `healthConfirmed = true` 在 `:392`，要走完 `fetch` → `response.ok` →
`await response.json()` → `payload.message === 'pong'` 全程才置位。

测试这边的前置条件写错了：

```ts
await waitFor(() => healthRequests > 0, ...)   // ← 请求「到达」就算数
await closeHealthServer(server)
```

`healthRequests += 1` 发生在**服务器收到请求的瞬间**，早于响应写出、更早于 wrapper 解析完 JSON。
而该测试原本把 `E2E_SERVICE_HEALTH_TIMEOUT_MS` 设成 **100ms**——CI 负载下第一次探测很容易超时。
一旦第一次探测没成功完成，`healthConfirmed` 就始终是 false，随后服务器又被关掉、
再也不可能变健康，于是 `:403` 无限 return，测试耗尽预算。

**这解释了全部已观测事实**：stderr 为空（没重启）、耗时恒等于预算（`waitFor` 走满）、
只在 CI 复现（负载相关）、以及**为什么抬预算完全无效**（它根本不会退出，给多久都一样）。

### 本机确定性复现（先红）

把第一次响应延迟到超过 100ms 超时（只改这一处，其余不动）：

```
✖ a replacement candidate that never becomes ready fails closed (5186.707084ms)
  AssertionError: the replacement candidate remained unready without failing closed;
                  wrapper stderr was (empty — no restart was ever announced)
```

**与 CI 那条逐字相同，耗时 5186ms vs CI 5216ms。**

### 修法（两处，缺一不可）

1. `E2E_SERVICE_HEALTH_TIMEOUT_MS`：`100` → `2000`。
   这个预算**只约束对着活服务器的成功探测**；服务器一关，fetch 是立刻 connection refused，
   所以放宽它**完全不会拖慢失败检测**，只是不再让第一次探测被负载掐死。
2. 前置条件：`healthRequests > 0` → `healthRequests >= 2`。
   `checkProductionCandidateHealth` 用 `healthCheckInFlight` 互斥、并在 `finally` 里复位
   （`:376,382,431-433`），所以**第二个请求只可能在第一轮完整结束之后发出**。
   注意单靠 `>= 2` 不够：它只证明第一轮「结束」，不证明「成功」——
   必须与第 1 条同时改，第 1 条才是让那一轮真的成功的那个。

### 验证

- 在**触发红的那个条件下**（复现延迟仍在）跑：绿，1435ms。
- 撤掉复现延迟后单条 3/3 绿；`run-service.test.ts` 整文件 **40/40 绿**。
- 关键在于**不是靠放宽预算过的**：`waitFor` 的 5000ms 预算一个字没动。

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
