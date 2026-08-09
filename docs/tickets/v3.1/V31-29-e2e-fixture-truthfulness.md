# V31-29 — E2E 共享 fixture 诚实性（`ui-journey.ts` 三处假绿）

**Parent**: 审计来源 `docs/reviews/v31-spec-assertion-audit-2026-08-09.md` §1.1–§1.3；判据 V3.1 §37.4；纪律 D-150③ 假绿三禁（`docs/ops/agent-dispatch-runbook-2026-07-29.md:39`）
**批次**: Wave 3（**browser lane 第一个任务，先于任何 spec 重写与上游阻塞复诊**）
**Blocked by**: None — can start immediately（纯 fixture 改动，不依赖任何合并后 runtime）
**Status**: open — 2026-08-09 由 L-CI 开票，未开工

## What to build

共享 fixture `mkfast-template-main/tests/e2e/fixtures/ui-journey.ts` 里有三处断言把「产品没成立」判成通过。它不是某条旅程的局部问题：**这个 helper 正在被两个当前已 required 的 CI job 使用**，所以今天 main 上就存在「生成失败也能过必跑门」的洞。

### ① `chooseImageTextDirection` 接受失败终态（headline，`:377-387`）

```
const terminalFailure = page
  .getByTestId('composer-report-card')
  .or(page.locator('[data-testid="composer-terminal-outcome"][data-outcome="failed"]'));
await expect(
  resumedLine.or(executionConfirmation).or(terminalFailure).first(),
  'the direction must reach a monotonic downstream state after the merchant click'
).toBeVisible({ timeout: 60_000 });
```

商家点完图文方向后，三种终态任一出现即通过，**其中一种是 `data-outcome="failed"`**。
直白说：**一次彻底失败的生成，现在会让旅程判绿。**

`chooseImageTextDirection` 的 5 个 spec 调用方（`grep -rl` 实测）：

| Spec | 归属 | 是否已 required |
|---|---|---|
| `specs/v31-living-plan-journey.spec.ts` | §37.4-C | 否（V31 gate，待转绿） |
| `specs/v31-mid-run-steering-journey.spec.ts` | §37.4-G | 否（V31 gate，待转绿） |
| `specs/m04-browser-hard-gate.spec.ts` | M-04 浏览器硬门 | **是** — `production-main-journey` |
| `specs/p2-browser-closure.spec.ts` | P2 收口 | **是** — `p2-browser-acceptance` |
| `specs/w01-storefact-wiring.spec.ts` | W01 | 否 |

**排期理由（这是本票要先做的原因）**：handoff `docs/handoff/v3.1-full-remediation-handoff-2026-08-09.md:200` 记录 Campaign 卡在
`chooseImageTextDirection` / `awaiting_answer`，并因同 HEAD 的必跑
`xhs-image-text-main-journey.spec.ts` 在同点超时而判定为上游 Harness/renderer 问题；
`:51` 另记 Steering G 的 Playwright「被上游初始任务阻塞」。一个把 `failed` 当可接受
终态的 helper，正是让「上游坏了」看起来像「偶发 flake」的机制——同一个上游故障，命中
timeout 就红、命中 failed 终态就绿。**所以必须先修这三处，再去复诊那个上游阻塞**；
否则复诊拿到的是被 helper 污染过的信号。

（口径校正：handoff 对 J 的记载是 `:49` 的「WIP checkpoint；J 未绿」，**没有**把 J 归因到这个
同点超时。本票只声明 Campaign、`xhs-image-text-main-journey` 与 G 三处有记录，J 不并入。）

### ② `.or(merchantStatus)` 恒被满足，断言退化为 no-op（`:654-659`）

```
await expect(
  page.getByTestId('image-worksurface').or(merchantStatus),
  'image_text generating path must keep Result visible until ready'
).toBeVisible({ timeout: 120_000 });
```

`merchantStatus` 在 `:623-629` 已被 `toContainText(/生成中|可发布|已发布就绪/)` 断过，
到这一行必然已解析且有文本，因此 or 分支恒真，「generating 阶段 Result 保持可见」
从未被验证。这条断言所在的 `submitComposerJourney` 有 **19 个 spec 调用方**，其中
4 个已 required：`m04-browser-hard-gate`、`p2-browser-closure`、
`w12-identity-draft-assistant`、`xhs-image-text-main-journey`（另含 §37.4-K 的
`v31-publish-handoff-selfreport`）。

### ③ 「只问一个问题」这一步可被整段跳过（`:323-337`、`:359-369`）

`:323-337` 用 `expect(resumed || cardVisible)` 把两种世界并成一个可过条件，随后
`if (resumed) return`；`:359-369` 在点击失败时若 `resumedLine` 可见也 `return`。
结果：§37.4-C 承诺的「只问一个问题 → 商家回答」在「已 resumed」分支里根本不发生，
spec 仍绿。§37.4 把「每轮必要问题 ≤1」写成**产品行为**（§38 观测项同名），
一个可被跳过的断言不能为它背书。

## Acceptance criteria

- [ ] 失败终态不再是可接受终态：`chooseImageTextDirection` 去掉 `terminalFailure` 分支，只接受 `resumedLine` / `executionConfirmation`；命中 `composer-report-card` 或 `data-outcome="failed"` 时**必须 fail**，并把 report card 文本打进错误信息
- [ ] 行为为证（先红后绿）：构造一条 outcome=failed 的运行，证明修复前该 helper 判绿、修复后判红；再对健康运行证明判绿。三处各自都要有这组对照，不能只跑健康路径
- [ ] `:654-659` 去掉 `or(merchantStatus)`，直接断 `image-worksurface`；证明当 worksurface 不渲染时该断言会红（修复前不会）
- [ ] 「一问」路径确定化：由 Core 的 question budget 决定本轮是否应提问，然后走「必须提问并回答」或「必须不提问」两条确定分支；删除 `resumed || cardVisible` 与两处 early return。证明「应提问但未提问」会红
- [ ] 假绿三禁（D-150③）：三处的测试名／断言消息与实际断言内容一致；不得用「monotonic downstream state」这类可涵盖失败的措辞
- [ ] 回归面：`chooseImageTextDirection` 的 5 个调用方与 `submitComposerJourney` 的 19 个调用方在修复后逐一说明受影响与实跑结论；两个已 required 的 job（`production-main-journey`、`p2-browser-acceptance`）必须实跑并给出真实计数

## Blocked by

- None。本票只改 fixture，不需要合并后 runtime，也不需要任何 spec 先落地。

## 边界与协调

- **本票只拥有 `mkfast-template-main/tests/e2e/fixtures/ui-journey.ts`。** 不改任何 `*.spec.ts`。
- spec 重写归各旅程属主（E/F/H 归 Task 3 线，J 归 Task 6 线，K 与 I 归各自票，待建 5 个 spec 见
  `mkfast-template-main/tests/e2e/TEST-CATALOG.md` 的 §37.4 登记表）。本票修好后它们才有可信的地基。
- 修 fixture 会让此前「绿」的 spec 变红——**那是本票的产出，不是回归**。变红清单要交给对应属主，不得为了让别人的票保持绿而放宽 fixture。
- 严禁反向操作：不要通过改弱 spec 断言来吸收 fixture 变严带来的红。
- 上游 Harness/renderer 阻塞的复诊**排在本票之后**，理由见上文排期理由。
- P1 route mock 的 `{ data }` 信封问题是**另一个类别**，不在本票范围：见
  `docs/reviews/v31-p1-route-mock-envelope-note-2026-08-09.md`（需主控决定是否单独开票）。

## 背景记录

- 2026-08-09 L-CI 静态审计（无 PG／浏览器额度，全部为静态判定，未跑 Playwright）产出
  `docs/reviews/v31-spec-assertion-audit-2026-08-09.md`；本票是该审计 §1「跨文件问题」的三条。
- 同次审计确认：9 个 `v31-*.spec.ts` 内**零 route interception**，V31 spec 面在这一项上是干净的。
- 调用方清单与 required 交集由 `grep -rl` ＋ 比对 `scripts/ci/run-pr-production-journey.sh`、
  `scripts/ci/run-p2-browser-acceptance.sh` 实测得出，非估计。

## 附带观察（**不在本票范围**，记录待主控决定，勿在本票内动手）

**本仓的 lint 有配置、但没有任何 CI 步骤执行它。**

- 仓根 `biome.json` 存在，且 `files.includes` 就是 `["**"]`——配置层面它**声称**覆盖仓根
  `scripts/`；`scripts/ci/quality-gates.test.mjs:276-282` 还有一条测试在断言这份配置的内容。
- 但 `grep -rn 'lint' .github/` **零命中**：三个 workflow（`core-quality.yml`／`deploy.yml`／
  `provider-live.yml`）没有任何一步跑 lint。全仓唯一的 `lint` 脚本是
  `mkfast-template-main/package.json:15` 的 `biome check --write .`，在该子目录内执行、
  用该子目录自己的 `biome.json`，因此即便有人手工跑它也到不了仓根 `scripts/`。
- 结论：`scripts/ci/`、`scripts/uiux/`、`scripts/ops/`、`scripts/recovery/`、`scripts/dev/`
  下的全部门禁脚本实际处于**未 lint 状态**——不是因为缺配置，而是因为**没有任何调用方**
  （2026-08-09 L-CI 实测）。

> **口径更正（L-CI 自陈）**：本节初稿写的是「仓根没有 `biome.json`／ESLint 配置」，
> **该判断是错的**——根 `biome.json` 存在且有测试断言它。恢复班次复核时实测更正为上述
> 「有配置、无调用」。两者的处置建议相同，但性质不同：前者是遗漏，后者是**配置声称覆盖
> 而无人执行**，也就是一条自身不被验证的覆盖声明，比单纯缺配置更值得拍板。

不建议在任何 V3.1 票里顺手修：给 CI 加一条 lint 步骤会一次性暴露仓根 `scripts/` 下的全部
既有告警，爆炸半径是仓库级，属于需要单独立项与单独排期的事。**列在这里是为了让它被「决定」
而不是被「发现」**——「保管所有 CI 门的目录自己不受门管」这件事值得有人明确拍一次板，
哪怕结论是「就这样，接受」。

## Evidence

> 空表由 L-CI 脚手架落盘，**Wave 4 对着真实证据填**。填表规则（机器可判优先）：
> `AC<n>` 对应「Acceptance criteria」小节里第 n 个 checkbox 条目，顺序固定；id 列只写
> `AC<n>`，不加任何修饰。writer / consumer 写 `path/to/file.ts:line`。PG result 与
> Playwright result 写真实结果（如 `12/12 pass`）；没跑就留 `—`，不写「应该通过」之类
> 的推测。required CI job 写 `.github/workflows/core-quality.yml` 里的 job 名。
> 单元格内的 `|` 必须转义成 `\|`。空值统一写 `—`。
> **一行未填满，对应 AC 不得勾选。**

| AC | production writer | production consumer | failure-recovery test | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — |
| AC6 | — | — | — | — | — | — |
