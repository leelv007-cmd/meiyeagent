# V31-92 — `run-service` 恢复写入成功后，fallback 证据没有被清理（间歇）

**Parent**: V31-64 门仪器（gate instrumentation）
**批次**: 门稳定性（P1，直接影响 required 可用性）
**Blocked by**: 无
**Related**: V31-91、V31-93（required 内另两条间歇红）、`docs/ops/ci-arbiter-gate-shrink-2026-08-14.md`

**Status**: open（2026-08-15）— 间歇已确证（CI 1 红 / 本地 7 绿）；**根因未定位**，可疑面已收窄到 fallback 清理路径；初稿的「墙钟排序」机制已撤回

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**:
**Workflow Run**: 31890594956（`123eec360`，红）、31891110630（`f1ba27b8a`，绿）

## 现象

`root-quality` 内 `mkfast-template-main` 单测第 28 条红：

```
not ok 28 - a later frame recovers evidence after burst retries are exhausted
  stack: run-service.test.ts:673:12
  AssertionError: Expected values to be strictly equal: true !== false
```

673 行断言的是「**不得**留下 `instrument-failure-fallback-` 记录」，实收 `true`。
注意此前的断言全部通过——**主记录已经成功落到修复后的目录里**（`dirname(failure.file)
=== instrumentDirectory` 那条绿）。所以失败状态是：

> 恢复写入成功了，但 fallback 证据还躺在那里没被清掉。

## 已确定的代码路径（读源码得出）

fallback **本来就会被写**，它不是异常产物：

1. 测试把 `instrument-failures` 建成一个**文件**（`run-service.test.ts:621`），
   于是所有 instrument 写入必然 ENOTDIR 失败；
2. 首帧被检测时挂上 `resolutionTimer`，`INSTRUMENT_RESOLUTION_DEADLINE_MS = 750`
   （`run-service.mjs:33`、`465-495`）；
3. **t≈750ms**：`resolveInstrument('fatal', 'embedded-workerd')` 触发。它先
   `flushInstrument()`，失败后走 `run-service.mjs:351` 的
   `writeInstrumentFallback()` —— **fallback 文件在这里被正常写出**；
4. 测试随后（等到 `entering recovery retries`，t≈1000ms）把目录修回来；
5. 稍后的一次写入成功时，`writeInstrumentFailure` 的成功分支
   （`run-service.mjs:283-291`）执行 `rmSync(fallbackRecordFile, { force: true })`，
   **把这份 fallback 清掉**。673 行断言的就是第 5 步发生过。

**所以红的含义是第 5 步没生效**，而不是第 3 步不该发生。

## 未定位（不要跳过这一节直接改代码）

为什么清理没生效，目前**没有证据**。可疑面（按可疑度排序，均未验证）：

1. 成功写入时 `fallbackRecordFile` 还是 `undefined`——即成功分支跑在
   `writeInstrumentFallback()` 把 `fallbackRecordFile = file` 赋上之前，
   于是 `if (fallbackRecordFile)` 落空，之后写出的 fallback 成了孤儿；
2. `rmSync` 真的抛了（清理块有 catch，会往 stderr 打
   `failed to remove superseded fallback evidence`）——**这条最好查**：
   失败轮的 wrapper stderr 被测试收进变量、没有外泄，所以现在看不到；
3. 写出了**第二份** fallback（`writeInstrumentFallback` 成功后会把自己从
   `instrumentFallbackWriters` 里删掉，理论上不该有第二次，需确认 shutdown
   结算路径 `run-service.mjs:134` 不会再触发）。

## 初稿的机制已撤回（2026-08-15 自我更正）

本票初稿写「burst 耗尽（20×50ms≈1000ms）必须早于子进程固定 1500ms 的第二帧，
CI 负载下排序反转」。**该机制不成立**：

- 真正把 `resolution` 推离 `pending` 的是 **750ms 的 resolutionTimer**，
  不是第二帧；fallback 也是在那时写的，不依赖第二帧；
- 本地取样 **7 轮全绿**（1 轮基线 + 6 轮并发施压），耗时紧密聚在
  1584–1649ms，与失败轮的 1684ms 几乎同档——**耗时没有拉开，
  说明 burst 根本不是瓶颈**，墙钟排序假说的前提不存在。

记在这里是因为它是本轮第四次「看着像因果、实际不是」。

## What to build（先取证，勿猜修）

1. **把 wrapper stderr 露出来**：该测试目前把 stderr 收进变量，失败时不打印。
   失败路径上应 dump（至少 `assert` 失败前把 stderr 附进消息）。这一步几乎零成本，
   且能直接判掉上面的可疑面 2；
2. 断言失败时**列出 `evidenceDirectory` 的实际内容**（几个 fallback、文件名／时间戳），
   用来判可疑面 1 与 3；
3. 拿到证据再改产品。**不要**给清理加重试、也不要放松 673 行的断言——
   这条断言正是「恢复成功后不留脏证据」的唯一守卫，放松它等于把 V31-93 那条
   「用重试掩盖缺陷」的老路再走一遍。

## Acceptance criteria

- [ ] 失败时能拿到 wrapper stderr 与 evidence 目录清单（仪器改进，可独立先落）
- [ ] 清理未生效的原因写进本票，**指明文件与行**，不是「疑似」
- [ ] 先红后绿证：构造该原因对应的确定性用例，未修时必红
- [ ] 673 行断言原样保留（不放松、不加重试）
- [ ] 同 SHA `root-quality` 连续 ≥3 轮绿

## 影响

`root-quality` 属 **required**，所以这条间歇红直接消耗合并门可用性。与 V31-91、
V31-93 合计，required 当前至少三条互不相同的间歇红——见
`docs/ops/master-handoff-required-green-2026-08-15.md` §5a。
