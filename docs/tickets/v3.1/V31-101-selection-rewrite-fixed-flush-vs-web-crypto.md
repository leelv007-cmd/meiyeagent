# V31-101 — 选区改写测试用「固定一次 flush」等一个真异步 Web Crypto，负载下必红

**Parent**: 门稳定性（`required` / `root-quality`）
**批次**: 仪器缺陷（P1，两轮占用 `required`）
**Blocked by**: 无
**Related**: V31-98（同为「用固定量代替等条件」的仪器缺陷，机制同族、位置不同）、
V31-100（本票是该票三条观察中唯一被定位到机制的那条，已在该票更正）

**Status**: 已关票（2026-08-16 晚，`70c39e680` 经 PR #14 进 main `d95aef263`）— `required` 同 SHA 绿且 `root-quality` 专项绿；CI 史实证该条是近 18 轮 `root-quality` 三次红的成因；**观察债已结清：合入后 9 轮 `root-quality` 该条 0 红，且套件每轮跑满**

**Implementation state**: 已实现并合入 main
**Verification state**: 本地已证（含复现＋对照＋变异）；**CI 已证：9 轮 0 红**
**Evidence SHA**: 70c39e680a9b9a9b40694397ddb47eeed62db712
**Workflow Run**: 31910900711、31912xxxxx（PR #10 连续两轮 `root-quality` 红在同一条）

## 现象

`root-quality`（**required 成员**）红：

```
FAIL src/product/object-workspace/sensitive-inline-check.interaction.test.tsx
  > maps a second-paragraph emoji-prefixed Tiptap selection to the exact #322 anchor
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
  at …:256:22
```

**连续两轮红在同一条**，而同期其他分支（含 main）四轮 CI 从未红过这一条。

## 机制（读源码得出）

测试第 251-253 行的断言**是过的**（「已选中 2 个字」），即选区已登记；
失败在其后的点击没产生调用。点击路径：

```ts
// copy-image-text-worksurface.tsx:255
const scope = await buildTextSelectionAdjustScope({ … });
return props.onAdjust?.( … , scope);          // :265
```

```ts
// copy-image-text-worksurface-model.ts:218
const digest = await globalThis.crypto.subtle.digest( … );
```

即 `onAdjust` 之前隔着一个**真异步的 Web Crypto 摘要**，不是微任务。
而测试只做**一次固定 flush**：

```ts
fireEvent.click(screen.getByTestId('selection-ai-rewrite'));
await act(async () => {});          // ← 一轮，够不够看机器
expect(onAdjust).toHaveBeenCalledTimes(1);
```

空载够，负载下不够。

## 复现与证据（本机）

| 条件 | 结果 |
|---|---|
| 空载 | **14/14 绿** |
| 24 个占核进程（12 核） | **1/3 红**，错误与 CI 逐字相同 |
| 改后，同样负载 ×6 | **6/6 绿** |

**变异证**：把期望次数改成 2 → 红在 `to be called 2 times, but got 1 times`，
说明断言读的是真实调用数、能失败，不是恒真式。

## 修法与一条被证伪的捷径

**先走错了一条，记下来免得下一个人再走**：

最初打算改成 `await waitFor(() => expect(onAdjust).toHaveBeenCalledTimes(1))`，
理由是「同族的 `object-workspace.interaction.test.tsx:122,189` 就是这么写的」。
**这个类比是错的**——该文件在 `beforeEach` 里 `vi.useFakeTimers()`（`:78`），
`waitFor` 的轮询靠定时器推进，假时钟下**永远不前进**。实测：改成 `waitFor` 后
空载即挂死，负载下 6/6 全红（每次 5007ms＝整条用例超时，不是断言失败）。
用 `waitFor` 的那个兄弟文件**没有假时钟**，两者不可比。

正解是用该文件自己的惯用法（`act` ＋ `advanceTimersByTimeAsync`）做**等条件**：

```ts
for (let attempt = 0; attempt < 20; attempt += 1) {
  if (onAdjust.mock.calls.length > 0) break;
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
}
expect(onAdjust).toHaveBeenCalledTimes(1);
```

**断言强度未变**（次数仍是精确 1，后续 `mock.calls[0]` 的内容断言原样保留），
变的只是「等多久」——从写死一次改成等到条件成立或耗尽预算。

## 同时修了没发作的那一处（关键：不要只修红的那条）

`copy-image-text-worksurface.interaction.test.tsx:190` 是**同一缺陷的孪生**：
`await user.click(...)` 之后立即断言 `onAdjust`，同样隔着那个 Web Crypto 摘要。
它**尚未发作**，但只修发作的那条正是 V31-100 里警告的「修恰好红的那条」——
下一轮红会换到它头上。该文件跑真实时钟，故用 `waitFor` 即可。

## Acceptance criteria

- [x] 机制在票内写明（文件 + 行 + 触发条件），不是「疑似」
- [x] 复现：负载下必现，空载不现
- [x] 对照：改前改后同负载
- [x] 变异证：新写法能红
- [x] 孪生点位一并修，不留「下一条红」
- [x] `required` 同 SHA 绿 —— `cbf6a9b31`，八门全绿，`root-quality` 在内
- [x] 后续 ≥3 轮 `root-quality` 未再出现该条红 —— **9/3 达成**，见下

## 观察债结清（2026-08-16 晚）

合入点＝`d95aef263`（PR #14）。此后 main 上每一轮 `root-quality` 里
`sensitive-inline-check.interaction.test.tsx` 的 `FAIL` 计数，以及同轮 vitest 收尾：

| run | head | 该文件 `FAIL` | interaction 收尾 |
|---|---|---|---|
| 31924282532 | `d95aef263` | 0 | `Tests 663 passed (663)` |
| 31925652674 | `cea34f121` | 0 | `Tests 663 passed (663)` |
| 31934698698 | `d5bda86a1` | 0 | `Tests 663 passed (663)` |
| 31936549050 | `6a4f733ae` | 0 | `Tests 665 passed (665)` |
| 31937870991 | `eceb32fb6` | 0 | `Tests 665 passed (665)` |
| 31939192749 | `c4e3f3aa9` | 0 | `Tests 665 passed (665)` |
| 31943455809 | `cf33894c3` | 0 | `Tests 665 passed (665)` |
| 31945068170 | `a0b546f20` | 0 | `Tests 665 passed (665)` |
| 31946656644 | `394ba1f96` | 0 | `Tests 665 passed (665)` |

**9 轮 0 红。** 663→665 的跳变发生在 `6a4f733ae`（PR #17 新增两条测试），
属预期增量，不是套件被裁剪。

**非空洞判据**：合入**前**的那一轮（run 31915694186 / `53515c900`）
该文件 `FAIL=1`，且 `root-quality` 正是红在 `web-interaction-test.log` 上——
说明这套仪器确实会因这条测试而红，上表的 0 是判过之后的 0。

> 提取口径：CI 日志带 ANSI 转义，`Tests  665 passed` 之间夹着颜色码，
> 直接 `grep "Tests +[0-9]"` **匹配不到**会得出「没跑」的错误结论。
> 须先 `sed 's/\x1b\[[0-9;]*m//g'` 去色再取。

## CI 史给出的真实频率（2026-08-16 落地后回查）

近 18 轮 `root-quality` 里有 9 轮红，归因：**本票 3 轮**（`53515c900`（main）、
`b5428e0dc`、`78963893a`）、opt-in 证据守卫 5 轮（V31-91 分支，改动触了被监视目录）、
`scripts/e2e/run-service.test.ts:1029` 1 轮（另开 V31-102）。

三次红**全部**落在 `sensitive-inline-check.interaction.test.tsx:256` 的
`expect(onAdjust).toHaveBeenCalledTimes(1)`，与本票所修位点逐字一致——即本票不是
「顺手修的一条抖动」，而是**该门近期最大的单一红因**。
