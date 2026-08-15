# V31-100 — `root-quality` 的 interaction 套件有并行争用型抖动：三轮三条不同的红，全部单跑绿

**Parent**: 门稳定性（`required` / `root-quality`）
**批次**: 仪器缺陷（P1，占用 `required` 可用性）
**Blocked by**: 无
**Related**: V31-98（同为 `root-quality` 内的仪器红，但那条是墙钟精确断言、机制不同）

**Status**: open（2026-08-16）— 已用 main 对照实证：不是任何一条 spec 的问题，是全量并行下的争用；单条修法一律无效，未定修法

**Implementation state**: open
**Verification state**: 现象已实证（含 main 对照＋隔离对照），根因未定位
**Evidence SHA**:
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

## What to build（先定位，勿猜修）

1. **量化**：连续跑 N 轮全量，记录每轮红的集合，确认「红的集合随机、并集远大于任一轮」。
   本票只有 3 个样本，不足以定分布。
2. **定位争用维度**：先试降低 `vitest` 并发（如 `--pool=forks --poolOptions.forks.maxForks`），
   若降并发即稳定，则确认是争用而非用例缺陷，再谈是调并发还是修用例的时序假设。
3. **不要给单条加重试或放宽断言**——那正是 V31-93 记录的死循环入口。

## Acceptance criteria

- [ ] ≥5 轮全量的红集合已记录，并给出「随机 vs 固定」的判定
- [ ] 争用维度有据（并发度／内存／模块加载），结论写入本票
- [ ] 修法不含「给单条加重试」或「放宽单条断言」
- [ ] `root-quality` 连续 ≥3 轮绿（同 SHA 或相邻 SHA）
