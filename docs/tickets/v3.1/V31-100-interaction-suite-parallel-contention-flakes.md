# V31-100 — interaction 套件在全量并行下的抖动：四条红，第四条已定位并修（同步 `getByRole` 撞异步弹层）

**Parent**: 门稳定性（`required` / `root-quality`）
**批次**: 仪器缺陷（P1，占用 `required` 可用性）
**Blocked by**: 无
**Related**: V31-98（同为 `root-quality` 内的仪器红，但那条是墙钟精确断言、机制不同）

**Status**: open-observing（2026-08-16 晚）— 第四条红复发并抓到原文＋失败瞬间 DOM，根因＝`free-creation-panel.interaction.test.tsx:135` 的同步 `getByRole` 撞上异步开弹层，已修且变异证已过；**票面原先「假说 1 已证伪」被推翻**；余两条历史红仍无样本，故不关票

> Status 展开：19 轮全量 2 红，两次红是**同一条**测试——原判定「不重复」作废。
> 第四条红的根因是**它自己的**，不解释另外两条；更贴合证据的模型是
> 「一批各自带时序假设的测试，被全量并行这同一个放大器逐个照出来」，
> 因此本票很可能**没有单一根因**，正确收敛方式是逐条拿证据、逐条修。

**Implementation state**: 第四条红已修；其余两条未定位（无样本）
**Verification state**: 19 轮全量（2 红 17 绿），第四条红 **2 次**均为同一条测试；
修后变异证已过；观察债＝`root-quality` ≥3 轮
**Evidence SHA**: df127c765865c96ffa22be261f227c5a90b7db61

> Evidence SHA 说明：这是**产生第四条红的**树（`main`，工作区干净）。
> 本地全量 6 轮里第 1 轮红，完整日志（含失败瞬间 DOM 全量转储）已留存。

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

### 2026-08-16 晚补：上面这条纪律要加一个判别条件，否则会掉进另一个死循环

原纪律「别去修恰好红的那条」防的是**盲修**。但如果把它当成「凡是并行争用就一条都不许修」，
就掉进反向死循环：这一族永远不收敛，`required` 永远带着抖动。

**判别条件是「有没有拿到失败瞬间的状态」**：

| 有失败瞬间的证据？ | 该怎么做 |
|---|---|
| 没有 | **不许动**。改了也不知道改没改对，绿了也分不清是修好了还是本来就 12/13 绿 |
| 有 | **就该修那一条**——此时它不是「恰好红的那条」，是**被证实带缺陷的那条** |

第四条红走的正是右边这条路：拿到 DOM → 机制确认 → 一行修 → 变异证。
它**不是**「修一条红一条」，因为修的是被观测到的缺陷，不是被观测到的症状。

还有一个更根本的重定性：**本票很可能根本没有「一个」根因。**
第四条红的根因（同步 `getByRole` 撞上异步开弹层）是**它自己的**，
不解释另外三条。更贴合证据的模型是：
**一批各自带着时序假设的测试，被全量并行这同一个放大器逐个照出来。**
所以正确的收敛方式是**逐条拿证据、逐条修**，不是接着找那个并不存在的全局开关。

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

## ⚠️ 自我更正：假说 1 不成立的结论是错的，它才是真因

前一版票面把假说 1 列在「已证伪」里。**这个结论现在被 DOM 转储直接推翻**，
原文保留在下面，因为「错在哪」比结论本身更值得留给下一个人。

原证伪实验（本身没做错）：把 `free-creation-panel` 那条隔离出来，空载连跑 **6/6 绿**；
再开 12 个占满 CPU 的进程施压重跑，仍 **6/6 绿**。
当时的推论是：「若真是这个机制，施压那组应当出红。」

**推论过强在哪**：那组实验只证明了「**外部 CPU 施压**这一种负载模型不复现」，
而本机制要的是**worker 事件循环内部的相对次序**被打乱——
外部进程抢 CPU 会把整个进程连同它的定时器一起等比拖慢，相对次序反而容易保持；
真正打乱次序的是同 worker 内 112 个文件的模块加载与 GC 造成的事件循环积压。
**一个负载模型下的空结果，压不过对失败态的一次直接观测。**

教训（与本轮 V31-102「把 `waitFor` 超时值当耗时读数」同类）：
**别拿「我构造的复现没出红」去否定一个机制，那只否定了我的复现手法。**
要否定机制，得拿到失败瞬间的状态并证明它与机制不符——这次拿到了，而它与机制**相符**。

## 已证伪的假说（别再走一遍）

1. **跨文件原型污染**（有四个文件长期改写 `Range.prototype` / `document.elementFromPoint`）。
   证伪：vitest 默认 `isolate` 每文件独立环境，跨文件泄漏不成立；
   且若成立，红应当固定在受污染的文件上，而不是每次换一条。

## ✅ 原文已抓到（2026-08-16 晚，第三批 6 轮的第 1 轮）

前一版票面写的是「报错原文没有抓到……下一个人不要在没有这段原文的情况下动手改它」。
第三批 6 轮（`df127c765`，工作区干净，逐轮留全量日志）第 1 轮就红了，**红的是同一条**：

```
FAIL  src/product/composer/free-creation-panel.interaction.test.tsx
  > D-103 creation mode surface > reports the model explicitly selected for the free run
TestingLibraryElementError: Unable to find an accessible element
  with the role "option" and name "DeepSeek V4 Pro"
 ❯ src/product/composer/free-creation-panel.interaction.test.tsx:135:29
```

轮次：1 红 / 2–6 绿（每轮 95–105s，112 文件 665 用例）。累计 **19 轮 2 红**，
且两次红是**同一条测试**——「不重复」这个判定到此为止，它复发了。

### 关键：报错文本里的 `accessible` 三个字就是答案

失败瞬间的 DOM 全量转储里，那个选项**在 DOM 里，而且长得完全正确**：

```html
<div class="isolate z-50" data-closed="" hidden=""      ← 祖先带 hidden
     style="... opacity: 0; pointer-events: none;">
  <div data-slot="select-content" data-closed="" role="presentation">
    <div role="listbox" id="base-ui-_r_6_-list">
      <div role="option" data-model-id="copy-model" aria-selected="false">
        <div>DeepSeek V4 Pro</div>                      ← 名字也对
```

`role="listbox"`、`role="option"`、文本全都在。缺的不是元素，是**可访问性**：
祖先上挂着 `hidden=""` ＋ `data-closed=""` ＋ `opacity: 0`，
Testing Library 的 `getByRole` 默认只查可访问性树（`hidden: false`），
按定义就查不到 `hidden` 祖先下的节点。所以它报的是 `accessible element`，不是 `element`。

**弹层的状态是「已挂载、尚未打开」**：`style` 里 `left: 0px; top: 0px` ＋ `data-anchor-hidden`
说明定位都还没算过。Base UI 的 Select 先把 positioner 挂上，再由**异步**定位把状态翻成
`data-open`；全量并行下这一翻落在了同步 `getByRole` 之后。

## 根因与修法（第四条红）

一行，且是**向本仓既有写法靠拢**——全仓 `findByRole('option', …)` **20 处**，
同步 `getByRole('option', …)` **1 处**，红的正是这唯一的 1 处：

```tsx
await user.click(screen.getByTestId('composer-free-model-select'));
await user.click(
  await screen.findByRole('option', { name: 'DeepSeek V4 Pro' })
);
```

`findByRole` 会等到该节点**真的进入可访问性树**为止，等的正是这条测试依赖的那件事。

**变异证已过**：把选项渲染掐掉（`availableModels.slice(0, 0)`），改后的测试**仍然红**
（`Unable to find role="option" …`，`tests 1.20s`＝等满 1s 超时才判），
证明这一改没有把「弹层真的打不开／选项真的不在」一起吞掉。
组件按 sha256 还原，前后一致（`e495b5dc…`）。

**没有加重试，没有放宽断言，没有调超时。**

### 顺带扫了同族的其他 role（只修看见的那个是不够的）

| role | 同步 `getByRole` | `findByRole` |
|---|---|---|
| `option` | **1**（即本条） | 20 |
| `dialog` | 1 | 13 |
| `menuitem` / `listbox` / `menu` / `tooltip` | 0 | 0 / 0 / 2 / 0 |

`dialog` 那 1 处（`admin-supply-control.interaction.test.tsx:448`）**故意不动**：
它前面是 `await screen.findByTestId(...)`，断言的是「弹窗**仍在**」而非「等弹窗出现」，
改成 `findByRole` 反而会把它变弱。

## ⚠️ 票面原定的定位法在 1/13 下已经不成立

下面 What to build 第 2 条写的是「降并发看是否稳定」。
那是在发生率看起来像 3/3 时写的。现在是 1/13：
要把「降并发有效」和「本来就没红」区分开，每个臂需要几十轮全量
（单轮约 3–4 分钟），成本已经不成比例。

**建议改法**：不再追求本地复现，改为**在 CI 上挂观测**——
让 `root-quality` 红时保留 vitest 的完整输出，攒够 3 次同族红的原文再定位。
在那之前这条票的正确状态是 open-observing，不是 open-investigating。

> **这条建议兑现了。** 第三批 6 轮就是照它做的（不追复现，只保证红轮留全量日志），
> 第 1 轮即命中。要点不是「攒够 3 次」——**1 次带 DOM 转储的原文就够定位**，
> 因为 DOM 转储是失败瞬间的**状态**，而不是又一个「它红了」的计数。
> 下一条红照办即可：**保住失败轮的完整输出**，比再跑十轮绿有用得多。
>
> **CI 侧不需要任何改动，能力已经在了**（查过，别再造一遍）：
> `run-root-required-quality.sh:33` 把 `test:interaction` 全量输出 `tee` 进
> `${CI_EVIDENCE_DIR}/web-interaction-test.log`，`core-quality.yml:253-258` 以
> `if: always()` 上传 `root-required-quality-evidence`。所以 `root-quality` 一旦红，
> **失败轮的 vitest 全量输出（含 DOM 转储）已经在 artifact 里**，下载即可。
> 顺带核过该脚本 `:2` 有 `set -uo pipefail`——`if cmd | tee` 的退出码取的是 `cmd` 的，
> 门没有被管道吞掉（这个坑本轮在别处踩过，所以专门查了）。

## What to build（先定位，勿猜修）

1. ~~**量化**：连续跑 N 轮全量，记录每轮红的集合~~ —— 已做，19 轮，见上。
2. ~~**定位争用维度**：先试降低 `vitest` 并发~~ —— **作废，别再试**。
   1/13 的发生率下这个实验没有统计功效（见上节）；
   而且第四条红查下来根本不需要它：争用只是**放大器**，缺陷在用例自己的时序假设里。
   降并发即使「稳定」了，也只是把放大器关小，缺陷还在。
3. **不要给单条加重试或放宽断言**——那正是 V31-93 记录的死循环入口。**（本轮遵守）**
4. **（新）剩下两条历史红：拿到失败瞬间的输出之前不要动。**
   `composer-home-campaign` 与 `admin-creation-experience-control` 在 19 轮里一次没再出现，
   既不能算修好，也没有可动手的证据。做法照第四条红：红轮留全量日志，等它自己再出现。

## Acceptance criteria

- [x] ≥5 轮全量的红集合已记录，并给出「随机 vs 固定」的判定
      —— **19 轮 2 红**；判定更新为：低频，但**会复发**（两次同一条），不是「不重复」
- [x] 争用维度有据（并发度／内存／模块加载），结论写入本票
      —— 结论是**问错了问题**：争用是放大器不是根因，逐条定位才是路（见「自我更正」与重定性）
- [x] 修法不含「给单条加重试」或「放宽单条断言」
      —— 第四条红改的是**查询取法**（`getByRole`→`findByRole`），不是重试也不是放宽；
      变异证证明它仍会红
- [ ] `root-quality` 连续 ≥3 轮绿（同 SHA 或相邻 SHA）—— 观察债，随本次修复合入后开始计
- [ ] 剩余两条历史红各自拿到失败瞬间的输出 —— 无样本，等复发
