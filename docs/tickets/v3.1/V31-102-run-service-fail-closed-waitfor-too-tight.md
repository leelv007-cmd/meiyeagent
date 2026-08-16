# V31-102 — `run-service` 的 fail-closed 断言把 5s 当作上界，负载下会红

**Parent**: 门稳定性
**批次**: 门稳定性（P2 —— 频率 1/18，排在 V31-99／V31-100 之后）
**Blocked by**: 无
**Related**: V31-98（把真实耗时钉死在 25ms）、V31-101（用一次固定 flush 等真异步）——**同一族**：
测试把一个负载相关的时长当成常量

**Status**: open（2026-08-16）— 已在 main 上实证一次（`f735731aa`，required 因此红）；机制读源码得出，**未修**

**Implementation state**: open
**Verification state**: 1 红 / 17 绿（近 18 轮 `root-quality` 统计）
**Evidence SHA**: f735731aa9178e319e9f70f0079761ac98e5f52e
**Workflow Run**: 31919765594（job 95097616109）

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

## What to build

1. **别直接把 5000 改大**——那是拿放宽掩盖，且下一次负载更高时照样红。
   预算应当**由配置推导**：`2 × FAILURE_WINDOW + INTERVAL + spawn 余量`，
   并在测试里写明这个式子，让读的人知道为什么是这个数。
2. 若要更稳，考虑把「是否 fail-closed」与「多久 fail-closed」拆开断言：
   前者是产品合同（必须成立），后者是性能观察（不该卡门）。
3. **不要加重试**：这条测试验的就是 fail-closed，重试会把真正的挂死也吞掉。

## Acceptance criteria

- [ ] 新预算由配置推导且在测试内写明推导式，不是换一个更大的魔数
- [ ] 变异证：把 wrapper 的 fail-closed 逻辑破坏掉，该测试仍必须红
- [ ] 后续 ≥3 轮 `root-quality` 未再出现该条红

## 为什么排 P2

频率 1/18，且不在关键路径上。V31-99（拖拽地板单位错用，商家可实际触达）与
V31-100（interaction 套件并行争用，影响面更大）都更靠前。
记在这里是为了**别让下一个人重新查一遍**——尤其别把它误判成产品的 fail-closed 真坏了。
