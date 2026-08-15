# V31-92 — `run-service` 恢复重试测试用墙钟排序，CI 负载下顺序反转产生假红

**Parent**: V31-64 门仪器（gate instrumentation）
**批次**: 门稳定性（P1，直接影响 required 可用性）
**Blocked by**: 无
**Related**: V31-91（required 内另一条间歇红）、`docs/ops/ci-arbiter-gate-shrink-2026-08-14.md`

**Status**: open（2026-08-15）— 机制已定位到测试侧墙钟假设，属仪器缺陷非产品缺陷；修法方向已定（改用触发文件），未实施

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**:
**Workflow Run**: 31890594956（`123eec360`，红）、31891110630（`f1ba27b8a`，绿）

## 现象

`root-quality` 内 `mkfast-template-main` 单测第 28 条红：

```
not ok 28 - a later frame recovers evidence after burst retries are exhausted
  location: mkfast-template-main/scripts/e2e/run-service.test.ts:4:6922
  stack:    run-service.test.ts:673:12
  AssertionError: Expected values to be strictly equal: true !== false
```

673 行断言的是「**不得**留下 `instrument-failure-fallback-` 记录」，实收 `true`
——即 fallback 证据被写出来了。

## 机制（读源码得出，非猜测）

测试构造（`run-service.test.ts:616-643`）：

1. 把 `instrument-failures` **建成一个文件**（`writeFileSync(…, 'not a directory')`），
   于是每次 instrument 写入必然 ENOTDIR 失败；
2. 子进程立刻吐第一帧 `[vite] Internal server error: fetch failed`；
3. 子进程在**固定 1500ms** 后吐第二帧 `… terminated`。

包装器侧（`run-service.mjs`）：

- 首帧写失败进入 burst 重试：`MAX_INSTRUMENT_WRITE_ATTEMPTS=20` ×
  `INSTRUMENT_WRITE_RETRY_MS=50` ≈ **1000ms** 才打印 `entering recovery retries`；
- `writeInstrumentFallback` 有守卫 `if (resolution === 'pending') return false`
  ——**只有第二帧把 resolution 推成 `fatal` 之后，fallback 才可能被写出**。

测试拿到 `entering recovery retries` 后才做 `rmSync` + `mkdirSync` 把目录修回来。
所以它依赖这个墙钟排序：

```
burst 耗尽(≈1000ms) → 测试修目录(3 次同步 fs 调用) → 第二帧(1500ms)
```

**留给测试的余量只有 ≈500ms**。CI runner 负载下，20 轮「setTimeout + 失败的 fs 写
+ 跨进程 stderr 跳转」轻易涨到 1500ms 以上，排序就反转成：

```
第二帧(1500ms) → resolution=fatal → fallback 写出 → burst 耗尽 → 测试修目录
```

于是 673 行看到 fallback 文件。失败轮的 `duration_ms: 1684.5`（>1500ms 名义值）
与该解释一致。

## 判为间歇而非回归

| Run | SHA | 树差异 | 该测试 |
|---|---|---|---|
| 31890594956 | `123eec360` | main | **红** |
| 31891110630 | `f1ba27b8a` | main + 仅文档 | 绿 |
| 31884361098 / 31885101663 | `a5212ad42` / `a69ea7740` | — | 绿（root-quality 全绿） |

产品代码零差异的两棵树一红一绿——**间歇**。

## What to build

把第二帧的时机从**墙钟**改成**因果触发**，与本文件既有的房内写法一致
（`run-service.test.ts:602` 的 `exitTrigger` 就是这个模式）：

1. 子进程不再 `setTimeout(1500)`，改为轮询一个触发文件，测试在
   `rmSync` + `mkdirSync` **完成之后**才写该文件；
2. 这样「目录已修好」先于「第二帧」成为因果保证，不再有余量可耗尽。

**不要**用「把 1500ms 调大」或「加 retry」来修：前者只是把同一个竞态推到更重的
负载下再犯，后者会把真实的 fallback 回归一并吞掉——而这条测试存在的目的正是钉住
「恢复成功时不留 fallback」。

## Acceptance criteria

- [ ] 第二帧由触发文件驱动，测试内不再有「burst 耗尽必须早于第二帧」的墙钟假设
- [ ] 先红后绿证：在**未修**的包装器上人为延迟目录修复，该测试仍应红
      （证明它还在钉真东西，不是被改松）
- [ ] 同 SHA `root-quality` 连续 ≥3 轮绿
- [ ] 不改动 `run-service.mjs` 的 fallback 语义（本票是仪器票，不碰产品行为）

## 影响

`root-quality` 属 **required**，所以这条假红直接消耗合并门可用性（一次随机红＝
一轮重跑）。与 V31-91（`campaign-paid-work-confirmation` 的 409 竞态）、
`memory-vault-governance` 的 `selectComposerLens` 20s 超时合并考虑：
**required 当前不是零抖动**，这是 2026-08-15 的实测更正，写入
`docs/ops/master-handoff-required-green-2026-08-15.md` §5a。
