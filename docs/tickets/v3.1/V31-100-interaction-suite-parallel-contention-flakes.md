# V31-100 — `root-quality` 的 interaction 套件有并行争用型抖动：三轮三条不同的红，全部单跑绿

**Parent**: 门稳定性（`required` / `root-quality`）
**批次**: 仪器缺陷（P1，占用 `required` 可用性）
**Blocked by**: 无
**Related**: V31-98（同为 `root-quality` 内的仪器红，但那条是墙钟精确断言、机制不同）

**Status**: open（2026-08-16）— 样本已扩到 13 轮：**发生率从 3/3 掉到 1/13**，红集合不再重叠；两个假说已证伪；根因仍未定位，且票面原定的验证法在新发生率下已失效（见下）

**Implementation state**: open
**Verification state**: 13 轮全量已记录（1 红 12 绿），另有两轮隔离对照（各 6/6 绿）；根因未定位
**Evidence SHA**: 6f252b0d0eace99bc8c10ff408a96efbf6dcb943
**Workflow Run**: 31910900711（`root-quality` 红在 `sensitive-inline-check`）

## 现象：三轮三条不同的红，互不重叠

| 轮次 | 树 | 结果 | 红的是 |
|---|---|---|---|
| CI run 31910900711 | `fix/v31-96-composer-reparenting` | 1 failed / 662 passed | `sensitive-inline-check.interaction.test.tsx:256` |
| 本机全量 | 同一分支 | 2 failed / 661 passed | `admin-creation-experience-control`（#376）＋ `composer-home-campaign` |
| **本机全量（main 对照）** | **main 代码** | **1 failed / 658 passed** | **`composer-home-campaign`** |

用例总数 663 vs 659 差 4，等于该分支新增的 4 条见证测试，两侧口径一致。

## 三条判据，合起来排除「某条 spec 写错了」

1. **红会换位置**。确定性的代码改动不可能每轮产生**不同**的随机红。
2. **main 对照复现其中一条**。`composer-home-campaign` 在 main 的代码上同样红
   （同机器、同依赖、同命令），所以与分支改动无关。
3. **全部单跑即绿**。`composer-home-campaign` 在 main 树上隔离连跑 **3/3 绿**；
   `sensitive-inline-check` 在分支树上隔离 **14/14 绿**。
   → 缺陷不在用例里，在**全量并行的争用**上。

`npx vitest run` 一次并行 112 个文件；本机 `import 2380s / transform 220s`，
说明瓶颈在模块加载与 CPU 争用，不在断言本身。

## 为什么这条必须单独记（死循环预防）

**不写下来，下一个人会去修恰好红的那条 spec。** 而按上表，
下一轮红的多半是另一条——于是变成「修一条、红一条」，仪器越修越松，
和 V31-93 里「删断言→加重试」是同一条死路的不同入口。

已观察到的三条本身没有共同点（object-workspace 选区、admin 发布面板、campaign 刷新），
唯一的共同点是**都在全量并行里红、都在隔离下绿**。

## 已排除

- **不是本轮分支改动引入**：main 对照复现（判据 2）。
- **不是某条 spec 的断言写错**：隔离全绿（判据 3）。
- **不是 V31-98 那条墙钟机制**：那条钉的是 `assert.equal(wallClockMs, 25)`，
  在 `apps/core`；本票三条都在 `mkfast-template-main` 的 vitest interaction 套件里。

## 2026-08-16 扩样：13 轮，1 红——发生率塌了一个量级

上表三轮是在 **V31-95／V31-96／V31-101 修复合入之前**的树上跑的。
在含这三条修复的树（`main` + V31-99 + V31-102）上重跑：

| 批次 | 轮数 | 红 | 红的是 |
|---|---|---|---|
| 第一批 | 5 | 1 | `free-creation-panel.interaction.test.tsx > D-103 creation mode surface > reports the model explicitly selected for the free run` |
| 第二批（8 轮连跑） | 8 | 0 | —— |
| 合计 | **13** | **1** | 一条，且是上表三条之外的**第四条** |

**判定：随机、低频、不重复。** 与原表「3/3 红且每轮换位置」相比降了一个量级。

其中 `sensitive-inline-check` 那条已由 **V31-101** 直接解释（那正是它修的文件）。
另两条（`composer-home-campaign`、`admin-creation-experience-control`）
在这 13 轮里**一次都没再出现**——没有证据说它们被谁修好了，
只能记为「未再复现」，不能记为已解决。

第二批的第 5–6 轮期间本机还并发跑了 `run-service` 的 node 测试（V31-102 的实测与变异证），
即那两轮的负载**高于**基线，仍然全绿。

## 已证伪的两个假说（别再走一遍）

1. **「await 之后跟同步查询，负载下先查后到」**（与 V31-101 同族）。
   证伪：把 `free-creation-panel` 那条隔离出来，空载连跑 **6/6 绿**；
   再开 12 个占满 CPU 的进程施压重跑，仍 **6/6 绿**。
   若真是这个机制，施压那组应当出红。
2. **跨文件原型污染**（有四个文件长期改写 `Range.prototype` / `document.elementFromPoint`）。
   证伪：vitest 默认 `isolate` 每文件独立环境，跨文件泄漏不成立；
   且若成立，红应当固定在受污染的文件上，而不是每次换一条。

## ⚠️ 那次红的报错原文没有抓到

第二批 8 轮就是为抓它设计的（红轮保存完整日志），**结果 8 轮全绿，什么也没抓到**。
所以目前对第四条红的了解仅限于「FAIL 行」——没有断言差异、没有堆栈。
**下一个人不要在没有这段原文的情况下动手改它。**

## ⚠️ 票面原定的定位法在 1/13 下已经不成立

下面 What to build 第 2 条写的是「降并发看是否稳定」。
那是在发生率看起来像 3/3 时写的。现在是 1/13：
要把「降并发有效」和「本来就没红」区分开，每个臂需要几十轮全量
（单轮约 3–4 分钟），成本已经不成比例。

**建议改法**：不再追求本地复现，改为**在 CI 上挂观测**——
让 `root-quality` 红时保留 vitest 的完整输出，攒够 3 次同族红的原文再定位。
在那之前这条票的正确状态是 open-observing，不是 open-investigating。

## What to build（先定位，勿猜修）

1. **量化**：连续跑 N 轮全量，记录每轮红的集合，确认「红的集合随机、并集远大于任一轮」。
   本票只有 3 个样本，不足以定分布。
2. **定位争用维度**：先试降低 `vitest` 并发（如 `--pool=forks --poolOptions.forks.maxForks`），
   若降并发即稳定，则确认是争用而非用例缺陷，再谈是调并发还是修用例的时序假设。
3. **不要给单条加重试或放宽断言**——那正是 V31-93 记录的死循环入口。

## Acceptance criteria

- [x] ≥5 轮全量的红集合已记录，并给出「随机 vs 固定」的判定
      —— 13 轮（5＋8），红集合＝{`free-creation-panel` D-103} 一次；判定为**随机、低频、不重复**
- [ ] 争用维度有据（并发度／内存／模块加载），结论写入本票
      —— **未做，且原方法已失效**：1/13 的发生率下「降并发」实验没有统计功效，见上节
- [x] 修法不含「给单条加重试」或「放宽单条断言」—— 本轮**未做任何修改**，只扩样与证伪
- [ ] `root-quality` 连续 ≥3 轮绿（同 SHA 或相邻 SHA）—— 观察债
