# V31-103 — `signalWrapperAfterMs` 用 200ms 定时器冒充「签名已被看见」，负载下先关后写

**Parent**: 门稳定性
**批次**: 门稳定性（P2）
**Blocked by**: 无
**Related**: V31-98（把真实耗时钉死在 25ms）、V31-101（用一次固定 flush 等真异步）、
V31-102（把 5s 当 fail-closed 上界）——**同一族的第四例**：
用一个固定毫秒数代替「等某件事真的发生」

**Status**: 已关票（2026-08-16，`95114455d` 经 PR #17）— 四个调用点已逐个查过，只有一个真依赖先后顺序；该点改为等「签名已被观测到」（`signalWrapperAfterSignature`），另三个原样不动；变异证已过（10281ms 红）；**观察债已结清：合入后 7 轮 `root-quality` 该条 7 绿 0 红，且样本取自并跑负载（同批里门本身红过一轮，说明门在判）**

**Implementation state**: done
**Verification state**: 本机 40/40 绿；变异证已过；**CI 观察债已结清 7/7 绿**（见「观察债结清」）
**Evidence SHA**: cea34f1213f63137f84693b8fb22e6db2c698994
**Workflow Run**: 31925884434（job 95113257493）

> Evidence SHA 说明：红出现在 PR #16 的 head 上，但 PR #16 没碰过
> `scripts/e2e/run-service.test.ts`——该文件在 PR #16 head 与本 SHA 上**逐字节相同**
> （`git diff --stat cea34f121 fix/v31-91-plan-revision-identity -- <该文件>` 为空）。
> 所以这里钉的是产生该红的代码，不是碰巧路过的分支。**这条红与 V31-91 无关**。

## 现象

`root-quality` → `mkfast-template-main test` →
`scripts/e2e/run-service.test.ts:1796`（源码 `:1813` 起的那条）：

```
not ok 49 - a real signature before teardown remains a gate verdict
  error: |-
    Expected values to be strictly equal:
    + actual - expected

    + undefined
    - 'fatal'
  duration_ms: 231.249136
```

断言是 `assert.equal(failure?.record.resolution, 'fatal')`，
`+ undefined` 说明 `readInstrumentFailureRecords(...)` **返回了空数组**——
盘上根本没有 instrument 记录，不是记录内容错了。

同一轮里 `[check]` 十门全 PASS——**红的是测试，不是门**。

## 机制（读源码得出）

测试体（`:1813-1841`）：child 往 stderr 写一行 vite 签名，然后

```ts
{ signalWrapperAfterMs: 200 }
```

而 `runWrappedService`（`:131-137`）把它实现成一个**瞎等的定时器**：

```ts
setTimeout(() => child.kill('SIGTERM'), options.signalWrapperAfterMs).unref();
```

这 200ms 从 **spawn 的那一刻**起算，它不关心：

1. wrapper 有没有起来；
2. wrapper 的 child 有没有把那行 stderr 写出去；
3. detector 有没有**看见**那行、有没有建出 `currentInstrument`。

而这条测试的题面恰恰是「签名在 teardown **之前**到达」——
200ms 就是用来保证这个先后顺序的，可它保证不了。

负载下 1–3 任一步慢过 200ms，SIGTERM 就先到：
`shutdown()` 走 `currentInstrument?.resolve('fatal', 'shutdown-requested')`
（`run-service.mjs:160`），此时 `currentInstrument` 是 undefined，可选链直接吞掉，
没有任何东西被 resolve，也就没有记录落盘，
后面的 `INSTRUMENT_SHUTDOWN_SETTLE_MS`（250ms）settle 循环也无事可 flush。
于是 `failure` 是 undefined。

`duration_ms: 231` 也对得上：整条测试只活了 231ms，
说明 wrapper 在签名链路走完之前就被关掉了。

## What to build

1. **把「等 200ms」换成「等签名真的被看见」**——
   在发 SIGTERM 之前轮询 `readInstrumentFailureRecords(...)` 直到非空
   （或等一个明确的 stderr 标记），让先后关系是**因果的**，不是**计时的**。
   这正是这条测试要证的东西，所以等待条件应当就是它。
2. `signalWrapperAfterMs` 目前有多个调用点，**先查清每个调用点等的到底是什么**
   再决定是加一个 `signalWrapperAfterSignatureSeen` 之类的新选项，
   还是把现有选项整体改成条件式。**不要**因为这一条红就把所有调用点的数字统一调大。
3. **不要加重试**，也不要把断言放宽成 `failure?.record.resolution !== undefined`——
   那会把「签名在关机前没被看见」这个真实缺陷一起吞掉。

## 四个调用点的逐点结论（票面要求先查清再动）

`signalWrapperAfterMs` 有四个调用点，全部写着 200。**它们等的不是同一件事**：

| 调用点 | 签名写在哪 | 那 200ms 实际的含义 |
|---|---|---|
| `:1169` | SIGTERM handler 内 | 「让 wrapper 先跑起来」 |
| `:1764` | 无签名（`a requested shutdown…`） | 同上 |
| `:1782` | SIGTERM handler 内 | 同上 |
| **`:1815`** | **启动时，早于 teardown** | **必须保证先后顺序** |

前三个的签名**按构造只可能在 teardown 之后**（就写在 SIGTERM 处理函数里），
所以那 200ms 只是「进程起来了」，慢一点不会改变任何断言的真假。
只有第四个的题面是「签名在 teardown **之前**到达」，那 200ms 是在替
「wrapper 已经看见它」站岗——而它站不住。

**所以只改了第四个。** 票面点名不要「因为这一条红就把所有调用点的数字统一调大」，
逐点看下来，统一调大不仅没必要，还会把三条无关的测试各拖慢一截。

## 修法

新增 `signalWrapperAfterSignature`：轮询 `readInstrumentFailureRecords` 直到非空再发
SIGTERM。instrument 记录正是 detector 命中时写的，**它的存在就等于「wrapper 已经看见签名」**，
于是先后关系从**计时的**变成**因果的**。

`SIGNATURE_OBSERVED_TIMEOUT_MS = 10_000` 是**挂死判定，不是耗时预算**：
检测只是一次 stderr 读＋一次文件写，10 秒比真实成本高好几个数量级；
超时后仍然发 SIGTERM，让测试红在它自己的断言上，而不是把测试挂住。
（这条口径是从 V31-102 学来的——那边我把 `waitFor` 失败时的 `duration_ms`
误当成测量值，实际它按构造恒等于超时值。这里的 10s 同样不该被当作耗时读数。）

**没有加重试**，**没有把断言放宽成 `!== undefined`**——那会把「签名在关机前没被看见」
这个真实缺陷一起吞掉。

## Acceptance criteria

- [x] SIGTERM 的时机由「签名已被观测到」触发，不再由固定毫秒数触发
- [x] 变异证：把 detector 写记录的路径破坏掉，该测试仍必须红
      —— `writeInstrumentFailure()` 顶部提前 `return true` 后，该条在 **10281ms** 红
      （即等满挂死判定后仍无记录）；按 sha256 还原（`308031a1…` 前后一致）
- [x] 该测试在**加载条件下**（与其他套件并跑）连续 ≥5 轮绿
      —— **7/7 达成**，见下「观察债结清」
- [x] 后续 ≥3 轮 `root-quality` 未再出现该条红 —— 同上，7 轮 0 红

## 观察债结清（2026-08-16）

合入后每一轮 `root-quality` 里 `a real signature before teardown remains a gate verdict`
（`run-service.test.ts:1849`）的判决，逐轮点名：

| run | 判决 |
| --- | --- |
| `31933812189` | `ok 49` |
| `31935196137` | `ok 49` |
| `31936621559` | `ok 49` |
| `31938096567` | `ok 49` |
| `31939952353` | `ok 49` |
| `31942297338` | `ok 49` |
| `31943961075` | `ok 49` |

**7 轮 7 绿，0 红。**

「加载条件」这一条是**自动满足**的，不需要另造场景：`root-quality` 一轮里
`apps/core test:` 与 `mkfast-template-main test:` 在日志中交替输出，
两套件在同一个 runner 上并跑——这正是 V31-102 查出来的负载来源
（也正是那张票的红只在 CI 复现的原因）。所以上面 7 轮全部是加载条件下的样本。

**为什么这批样本可信**：同一批 run 里 `root-quality` 并非从不红——
`31939952353` 那轮它就是红的（红在 V31-102 那条 `not ok 36`）。
也就是说这 7 个 `ok 49` 不是「门根本没在判」，而是**门在判、且这一条每次都过**。

## 为什么排 P2

本机单跑 40/40 绿、该条 211ms 通过，CI 上 1 次红。
不在关键路径上，且与 V31-102 是同一轮里一起出现的两条中较轻的一条。
记在这里是为了**别让下一个人重新查一遍**——尤其别把它误判成 instrument
证据链真的写不出来了。
