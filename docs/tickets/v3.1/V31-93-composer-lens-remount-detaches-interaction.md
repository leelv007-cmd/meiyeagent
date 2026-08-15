# V31-93 — Composer 镜头胶囊 remount 中途甩掉交互；测试用重试掩盖，重试预算已被耗尽

**Parent**: V31-29 Composer journey helper 契约
**批次**: 门稳定性（P1，直接影响 required 可用性）＋ 产品诚实性
**Blocked by**: 无
**Related**: V31-91、V31-92（required 内另两条间歇红）、V31-58（另一条 helper 契约问题）

**Status**: open（2026-08-15）— 产品侧 remount 甩交互是**已被注释承认**的既有行为；测试侧两轮放松（先删断言、再包重试）已把它掩盖到超时边缘；本票要求修产品而非再抬预算

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**:
**Workflow Run**: 31890594956（`123eec360`，红）

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
- [ ] 商家侧行为有定论：restore 期间点镜头要么生效、要么可见地不可点，
      不得静默吞掉（属 D3 白名单「产品诚实性」）
- [ ] `memory-vault-governance` 连续 ≥3 轮 required 绿

## 影响

位于 **required** 的 `production-main-journey` 内。与 V31-91（同 job 的 409 竞态）、
V31-92（root-quality 的墙钟竞态）合计，required 当前至少有三条互不相同的间歇红——
详见 `docs/ops/master-handoff-required-green-2026-08-15.md` §5a 与
`docs/ops/current-project-status.md` §1。
