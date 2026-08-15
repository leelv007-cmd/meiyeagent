# V31-93 — Composer 镜头胶囊 remount 中途甩掉交互；测试用重试掩盖，重试预算已被耗尽

**Parent**: V31-29 Composer journey helper 契约
**批次**: 门稳定性（P1，直接影响 required 可用性）＋ 产品诚实性
**Blocked by**: 无
**Related**: V31-91、V31-92（required 内另两条间歇红）、V31-58（另一条 helper 契约问题）

**Status**: open（2026-08-15）— **门抖动主源，优先级最高**：同一 remount 缺陷已出现三种表现、跨三个文件被三处注释独立承认，重试预算 20s→45s→120s 一路加码仍红；`openComposerCapsule` 32 个调用点中 29 个裸奔。修产品一次解决全部，逐点包重试是 29 次掩盖

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**:
**Workflow Run**: 31890594956（`123eec360`，红）、31894747957（`7708b69d3`，红，第二种表现）

## 现象

`production-main-journey`（**required 成员**）红：

```
[chromium] memory-vault-governance.spec.ts:107
  › Composer proposes a governed memory that the next ContextBundle consumes
Error: Timeout 20000ms exceeded while waiting on the predicate
  at selectComposerLens (tests/e2e/fixtures/ui-journey.ts:219:6)
  at submitComposerJourney (tests/e2e/fixtures/ui-journey.ts:523:9)
  at memory-vault-governance.spec.ts:179:34
```

同一 shard 内 `campaign-paid-work-confirmation` 与 `v31-thread-root-workbench`
全绿（1 failed / 6 passed），所以不是 shard 级仪器故障。

## 真正的缺陷（产品侧，且已被自己的注释承认）

`ui-journey.ts:197-199` 原文：

```ts
// Same remount as destination: session restore / replay detaches the radio
// mid-click. Retry the open+click instead of waiting out the test budget.
```

即：**session restore / replay 会在用户点击过程中 remount，把 radio 从文档里摘掉，
这一次点击就此丢失**。这不是测试环境特有现象——商家在真实会话恢复/重放时点镜头，
同样会遇到「点了没反应」，而且没有任何反馈告诉他这次点击被吞了。

## 第二种表现：同一缺陷，没有重试包着的那条路直接硬红（2026-08-15 新增，关键证据）

run 31894747957 上另一条 spec 红了，位置不同但**是同一个缺陷**：

```
[chromium] assembly-gate-required-journey.spec.ts:151
  › registers a cold tenant and delivers its first copy with zero configuration
Error: expect(locator).toBeVisible() failed
  Locator: getByTestId('composer-capsule-lens-panel')  — element(s) not found
  at openComposerCapsule (ui-journey.ts:173:23)
  at assertThreeModalDiscovery (ui-journey.ts:244:21)
```

即：**点了胶囊，面板没出来**（`ui-journey.ts:172` 的 click 成功返回，
`173` 等面板 5s 等不到）。这正是「点击被静默吞掉」的直接形态。

**代码里自带一组对照实验**——同一个 `openComposerCapsule`，两个调用方，
唯一差别是有没有被重试包着：

| 调用方 | 是否包重试 | 缺陷发作时的表现 |
|---|---|---|
| `selectComposerLens`（`ui-journey.ts:200-219`） | **有**，整段包在 `toPass({ timeout: 20_000 })` 里 | 大多数轮被重试救回；预算耗尽才红＝**间歇** |
| `assertThreeModalDiscovery`（`ui-journey.ts:244`） | **无**，直接调 | 一次吞点击就**硬红** |

这组对照同时证明两件事：

1. 缺陷是真的、在产品侧，不是某条 spec 的写法问题——两条不同 spec、两个不同调用方；
2. **重试确实在掩盖它**。有重试的那条把缺陷降级成「偶尔红」，没重试的那条如实报红。
   所以「把 `assertThreeModalDiscovery` 也包上重试」是**错误修法**——那只是把最后一个
   还在如实报警的探头也关掉。

## 第三种表现＋规模：这是全套 e2e 抖动的主源，不是一条 spec 的问题

run 31895491610 又红一条，位置又不同、缺陷还是同一个：

```
[chromium] v31-memory-injection-b2-journey.spec.ts:189
  › revoking one of two confirmed memories stops only that one from injecting
Error: Timeout 45000ms exceeded while waiting on the predicate
  at selectDestination (v31-memory-injection-b2-journey.spec.ts:65:6)
```

该 helper 同样调 `openComposerCapsule`，注释同样写着病因
（`v31-memory-injection-b2-journey.spec.ts:50`）：

> `restore / replay. A bare click waits for stability, then the node detaches.`

**注意它的重试预算是 45 秒——`selectComposerLens` 的两倍多——照样耗尽。**

### 重试预算的攀升阶梯（同一个缺陷，四处独立加码）

| 位置 | 预算 | 注释里承认的病因 |
|---|---|---|
| `ui-journey.ts`（`selectComposerLens`） | 20s | session restore / replay 把 radio 中途摘掉 |
| `library-source.ts:142` | 45s | Recovery remounts the attach capsule，单次 open 会落在空 picker 上 |
| `v31-memory-injection-b2-journey.spec.ts:50` | 45s | restore / replay，裸 click 等到稳定后节点就 detach |
| `works-reshell.spec.ts` | **120s** | — |

**三个不同文件、三处独立写下的注释描述的是同一个产品行为。**
没有人修它，每个人各自加了一层重试，预算从 20 秒一路加到 120 秒。

### 规模：32 个调用点，29 个裸奔

`openComposerCapsule` 在 e2e 套件里共 **32 处**调用，其中只有 **3 处**在重试包裹内
（`ui-journey.ts:201`、`library-source.ts:145`、`v31-memory-injection-b2-journey.spec.ts:53`），
**其余 29 处全部裸调**——每一处都是一次潜在的随机红。

**这决定了修法**：把 29 处逐个包上重试是 29 次改动、掩盖 29 次，而且预算还会继续涨；
**修好 remount 一次性解决全部 32 处**。这也解释了为什么门的抖动一直压不下去——
真正的源头只有一个，但它有 32 个出口。

## 掩盖是分两步长出来的（死循环样本，必读）

| 提交 | 对 `selectComposerLens` 做了什么 |
|---|---|
| `2e23d4821` | 删掉 `await expect(lens).toBeChecked()` 与 `toHaveAttribute('data-state','checked')` 两条硬断言，改成「能扛住胶囊折叠」 |
| `84942e27a` | 把整段 open+click 包进 `expect(async () => {…}).toPass({ timeout: 20_000 })`，注释写「hardern remount clicks」 |

两步都没有动产品：**第一步降低了断言强度，第二步用重试吸收了不稳定**。
于是缺陷从「测试红」变成「测试偶尔红」——更难定位，且占着 required 的可用性。
现在 20s 预算本身也不够了（内层两处各 5s 超时，CI 负载下一轮尝试就吃掉大半预算，
20s 内跑不完几次重试）。

**这正是「反复撞墙」的机制标本**：仪器被逐步放松以换取绿，缺陷留在原地，
最终以间歇红的形式把成本还回来，且还回来的时候已经看不出源头。

## What to build

**方向是修 remount，不是抬预算。** 抬到 30s/40s 只会把同一次点击丢失推到更重的
负载下再犯，并继续隐藏商家侧的「点了没反应」。

1. **定位 remount 源**：`session restore / replay` 路径上是什么导致 Composer 胶囊
   子树重建（key 变化 / 条件渲染 / store 重挂）。先拿到答案再谈修法。
2. **让交互跨 remount 存活**（择一，实施前在票下定稿）：
   - 镜头选择提交到 store 后再渲染，radio 不持有权威状态；或
   - remount 时保留 pending 交互并重放；或
   - restore 期间禁用该控件并给出可见态，**宁可显式不可点，也不要静默吞点击**。
3. **恢复被删掉的断言**：修好之后把 `toBeChecked` / `data-state=checked` 加回去，
   并把 `toPass` 重试**去掉**——重试还在，就说明缺陷还在。

## Acceptance criteria

- [ ] remount 源在票内写明（文件 + 触发条件），不是「疑似」
- [ ] 先红后绿证：构造 restore/replay 期间点击的用例，**未修产品时必须红**
- [ ] `selectComposerLens` 去掉 `toPass` 重试后仍绿；硬断言恢复
- [ ] `assertThreeModalDiscovery` 路径（`assembly-gate-required-journey`）保持**不加重试**并绿
      ——它是本缺陷现在唯一如实报警的探头，不得为求绿把它也包起来
- [ ] 商家侧行为有定论：restore 期间点镜头要么生效、要么可见地不可点，
      不得静默吞掉（属 D3 白名单「产品诚实性」）
- [ ] `memory-vault-governance` 连续 ≥3 轮 required 绿

## 影响

位于 **required** 的 `production-main-journey` 内。与 V31-91（同 job 的 409 竞态）、
V31-92（root-quality 的墙钟竞态）合计，required 当前至少有三条互不相同的间歇红——
详见 `docs/ops/master-handoff-required-green-2026-08-15.md` §5a 与
`docs/ops/current-project-status.md` §1。
