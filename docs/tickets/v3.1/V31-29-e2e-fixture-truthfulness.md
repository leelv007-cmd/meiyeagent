# V31-29 — E2E 共享 fixture 诚实性（`ui-journey.ts` 三处假绿）

**Parent**: 审计来源 `docs/reviews/v31-spec-assertion-audit-2026-08-09.md` §1.1–§1.3；判据 V3.1 §37.4；纪律 D-150③ 假绿三禁（`docs/ops/agent-dispatch-runbook-2026-07-29.md:39`）
**批次**: Wave 3（**browser lane 第一个任务，先于任何 spec 重写与上游阻塞复诊**）
**Blocked by**: None — can start immediately（纯 fixture 改动，不依赖任何合并后 runtime）
**Status**: in-progress — 2026-08-09 由 L-CI 开票并实施；三处改动已落 `6f6379565`，assertion 级先红后绿实测完成（hermetic A/B `10/10`）。**AC6 未完成**：两个 required job 本机跑不起来（load average 74，Web webServer 连续两轮 120s 超时），需在健康宿主或 CI 上补。**不由 L-CI 关票。**

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

`chooseImageTextDirection` 的调用方（**口径已更正，见下**）：

| 调用点 | 类别 | 归属 | 是否已 required |
|---|---|---|---|
| `specs/v31-living-plan-journey.spec.ts:80` | 直接调用 | §37.4-C | 否（V31 gate，待转绿） |
| `specs/v31-mid-run-steering-journey.spec.ts:114`、`:172` | 直接调用（2 处） | §37.4-G | 否（V31 gate，待转绿） |
| `specs/p2-browser-closure.spec.ts:264` | 直接调用 | P2 收口 | **是** — `p2-browser-acceptance` |
| `fixtures/ui-journey.ts:543`（`submitComposerJourney` 内部） | **间接：全部 image_text 旅程** | 共享 fixture | **是**（经 `submitComposerJourney`） |

> **口径更正（L-CI 自陈，恢复班次实测）**：本票初稿写「5 个 spec 调用方」并把
> `m04-browser-hard-gate.spec.ts`、`w01-storefact-wiring.spec.ts` 列为调用方。
> **`grep -rl` 数的是「文件里出现过这个名字」，不是「调用」**——那两个文件只在注释里
> 提到它（`m04-browser-hard-gate.spec.ts:277` 写的正是「which the shared fixture runs
> before this hook」）。真实直接调用方是 3 个 spec 文件、4 个调用点。
>
> 但**结论方向没变，反而更强**：真正的放大器是 `ui-journey.ts:543`——
> `submitComposerJourney` 自己在 image_text 分支里调它，所以每一条 image_text 旅程
> 都经过这个 helper。实测 `submitComposerJourney` 有 **18 个 spec 文件 / 30 个调用点**
> （初稿写 19，多算了一个），其中 **9 个 spec 走 image_text**：
> `m04-browser-hard-gate`、`note-page-regeneration-journey`、`p1-f2-acceptance`、
> `p2-browser-closure`、`ui-journey-three-modal`、`v31-publish-handoff-selfreport`、
> `t39-r-gate-journey-matrix`、`xhs-image-text-main-journey`、`w01-storefact-wiring`。
> 两个已 required 的 job 命中这条间接路径，所以票面对「main 上今天就有洞」的判断成立。

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
从未被验证。这条断言所在的 `submitComposerJourney` 有 **19 个 spec 调用方**（实测应为 18，见上文口径更正），其中
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

## 实施记录（L-CI，2026-08-09）

改动全部落在 `mkfast-template-main/tests/e2e/fixtures/ui-journey.ts`，**未碰任何 `*.spec.ts`**。

### 三处改法

1. **失败终态不再是终态**：`terminalFailure` 不再进可接受集合。改为在商家作答**之前**先数一次
   失败卡数量，作答后**竞速**「resumed/execution_confirmation」与「失败卡数量变化」；命中失败
   即抛出，并把该失败卡文本打进错误信息。
2. **`.or(merchantStatus)` 删除**：generating 阶段直接断 `image-worksurface`。
3. **「只问一个问题」确定化**：删掉 `resumed || cardVisible` 与两处 early return。方向卡**必须**
   出现；到达时**必须尚未结算**（点击前后各读一次 settlement 属性）；点击失败不再有回退分支。

### 一处口径更正：不存在「frozen route 预答问题」

原 docblock 用「frozen route 可能预先作答，所以卡片可以从不出现」为可跳过分支背书。
**逐环追到 Core，该说法不成立**：`workflow-core.ts` 只在 `activeRequest.decisionReferences`
已带 `note_style` 时跳过 `noteStyleQuestion`，而写入它的只有两条路——派生提交
（`submission-coordinator.ts`，条件 `source.lens === 'image_text_note' && input.sourceNoteStyleId`）
与重放商家决策的 resumption（`task-admission.ts` 的 `snapshotWorkflowInput`，来源
`snapshot.semanticDecision`）。**两条都由商家决策派生，`MODEL_EXECUTION_MODE` 无关**；
且 `unattended: 'hold'` 无默认值、hold 超时 48h（`DEFAULT_CONFIRMATION_CARD_HOLD_TIMEOUT_SECONDS`），
除商家作答外无物释放。全部现有调用点都紧跟一次全新 Composer 提交，**问题恒被提出**。

### 两处由实测（而非设想）改出来的设计

- **竞速而非「等满再看」**：初版写成「等 60s 下游状态，超时后再去读失败卡」。实测发现商家自己的
  `test.setTimeout` 短于 60s 时，Playwright 先杀测试，**富化后的失败信息完全拿不到**——
  失败的运行仍然报成「什么都没出现」。改为竞速后失败即报（实测 < 30s 断言已加进对照）。
- **只认新增失败卡**：`composer-report-card` 是会话 turn，故意先失败再重试的旅程屏幕上本来就有
  一张。若无条件认它，那类旅程会被误判红。故改为「作答前计数、只认增量」。

### 回归面（实测调用路径，非估计）

`submitComposerJourney` 的 18 个 spec 文件里 **9 个走 image_text**，加 3 个直接调用方，
共 12 条路径经过 `chooseImageTextDirection`。**逐个核过：当前没有任何调用点处于「问题已被预答」
分支**——最像的 `note-page-regeneration-journey.spec.ts` 只调用 `submitComposerJourney` 一次
（全新提交），之后的逐页重生成走 `note-plan-page-regenerate` 按钮，不再进本 helper。
因此「方向卡必须出现」对现存全部调用点都成立，无需给 helper 加参数。

### 先红后绿证据（hermetic A/B）

用一份临时 Playwright harness 做 A/B：把**修复前**的 fixture 原样取出为独立模块，与修复后的
同时导入，对同一份合成 DOM 各跑一遍。不起 Core／Worker／Web，不碰任何数据库，全部由
`route.fulfill` 供页。**10/10 pass**（5.2 分钟，含两条被断言自身超时拉长的用例）：

| 缺陷 | 修复前 | 修复后 |
|---|---|---|
| ① 失败终态 | `data-outcome="failed"` 出现即**判绿** | **判红**，错误信息含失败卡原文；健康 resumed 仍绿；上一轮遗留的失败卡不误判 |
| ② generating 断言 | worksurface 从不渲染时该断言**照过**，红在更靠后的最终 surface 断言上（诊断指错地方） | **该断言本身判红**，信息即 `image_text generating path must keep Result visible until ready`；worksurface 渲染时仍绿 |
| ③ 一问可跳过 | 只有 resumed 行、没有方向卡时**判绿** | **判红**（缺卡）；卡片到达时已结算也**判红**（而非放过） |

该 harness **未提交**：它必须同时载入一份修复前 fixture 的 1064 行副本，作为长期资产会腐烂；
把它做成常驻的 fixture 契约 spec 需要单独决定落点与「缺卡用例耗时 5 分钟」的取舍，
属另一张票。复现方式已完整写在本节，判据是上表三行。

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
> **三个结果列各守一轴，不得跨轴填**：`unit/eval result` 只收单测与离线评测结果，
> `PG result` 只收真实 Postgres 套件结果，`Playwright result` 只收浏览器旅程结果。
> 把 `biome` / `tsc` / 单测结果写进 `Playwright result` 属跨轴，须改回本轴。
> 三个结果列的空值分三种，必须区分：`—`＝该格未填（脚手架初始态）；`n/a`＝该 AC 在该轴上
> **没有**证据要求（须在表下用一句话说明为何没有）；`未跑`＝该轴有要求但本轮未执行（须写出
> 未执行的原因）。writer / consumer / failure-recovery test / required CI job 四列的空值
> 仍统一写 `—`。
> **勾选规则**：writer / consumer / failure-recovery test / required CI job 四列非空，**且**
> 三个结果列每一格都是真实结果或 `n/a` ⇒ 方可勾选。任一结果格为 `—` 或 `未跑` ⇒ 不得勾选。
> （原规则是「一行未填满，对应 AC 不得勾选」。在只有 PG / Playwright 两个结果列时，它把
> 「本来就不该有 PG 证据的 AC」也判成未验收——列集扩展史见 V31-29「Evidence」节末。）

| AC | production writer | production consumer | failure-recovery test | unit/eval result | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|---|
| AC1 | `tests/e2e/fixtures/ui-journey.ts:404-431` | `tests/e2e/fixtures/ui-journey.ts:543` | hermetic A/B「失败终态」对照（修复前绿／修复后红＋含报告原文，且遗留失败卡不误判） | — | — | `10/10 pass`（hermetic A/B 全套，5.2 min） | `production-main-journey`、`p2-browser-acceptance`（**本轮未实跑，见 AC6**） |
| AC2 | 同 AC1／AC3／AC4 | 同 AC1／AC3／AC4 | 三处各一组对照，全部实跑 | — | — | `10/10 pass` | — |
| AC3 | `tests/e2e/fixtures/ui-journey.ts:700-708` | `tests/e2e/fixtures/ui-journey.ts:718` | hermetic A/B「worksurface 从不渲染」对照（修复前该断言照过、红在更靠后处；修复后该断言自身红） | — | — | `10/10 pass` | 同 AC1 |
| AC4 | `tests/e2e/fixtures/ui-journey.ts:338-341`、`:375-393` | `tests/e2e/fixtures/ui-journey.ts:543` | hermetic A/B「无卡片」与「卡片到达时已结算」两条对照，均由绿转红 | — | — | `10/10 pass` | 同 AC1 |
| AC5 | `tests/e2e/fixtures/ui-journey.ts:340`、`:386`、`:422`、`:705` | 断言消息即判据本身 | 「monotonic downstream state」措辞已删；新消息逐条对应实际断言 | `biome check` 通过；单文件 `tsc --noEmit --strict` 退出 0 | `n/a` | `n/a`（该 AC 是断言文案口径，无浏览器可断言之物） | — |
| AC6 | — | — | — | — | `n/a` | `未跑`（原写「未取得」，同义，按新规则统一措辞） | — |

**AC6 未跑的原因（原在 `required CI job` 格内，按新规则移出，原文逐字保留）**：「**未实跑**：本机 load average 74（其他 lane 重型 test 饱和），Web webServer 连续两轮 120s 起不来；无 push 权限故无法走 CI 复核」。

### 列集扩展史（2026-08-10，review-memory 在 Wave 4，主控裁决 2）

**改了什么**：Evidence scaffold 由 7 列扩为 8 列，在 `failure-recovery test` 与 `PG result` 之间插入 **`unit/eval result`**，并改写填表规则（三个结果列各守一轴、`—`/`n/a`/`未跑` 三态区分、勾选规则由「整行填满」改为「四列非空 ＋ 三个结果格全为真实结果或 `n/a`」）。**30 张带该 scaffold 的 v3.1 票全部同批改**（脚本改写，改后逐票校验所有 markdown 表列数一致）。

**为什么改**：旧列集只有 `PG result` / `Playwright result` 两个结果列，而不少 AC 的证据轴是单测或离线评测。旧勾选规则「一行未填满，对应 AC 不得勾选」于是把**本来就不该有 PG 证据的 AC** 也判成未验收——一个永远填不满的格子等于一个永远不能勾的框。V31-18 回填时五条 AC 里有三条撞上这个（详见该票「表下说明 ②」）。

**本票就是最硬的旁证，而且比 V31-18 的论证更强**：本票 AC5 的**真实结果原本被填在 `Playwright result` 格里**（内容是 `biome check` 通过 ＋ 单文件 `tsc --noEmit --strict` 退出 0）——那既不是 Playwright 结果，也不是 PG 结果。也就是说列集不够用时，填表人不会留空，**会把结果塞进最近的那一格**，于是表面看起来填满了、机器读到的却是错的轴。本轮把它移进 `unit/eval result` 并把 `Playwright result` 标为 `n/a`（AC5 是断言文案口径，浏览器上无可断言之物）；AC6 的「未取得」统一为 `未跑`，其原因文字从 `required CI job` 格移到表下（原文逐字保留，未删一字）。

**前置核实（裁决 2 的条件）**：改列前已确认**无机器读表方**——`grep -rn "docs/tickets" scripts/ .github/workflows/` 命中 0；`grep -rniE "production writer|production consumer|failure-recovery|required CI job|PG result|Playwright result" scripts/ .github/` 命中 0；`scripts/ci/quality-gates.test.mjs` 只钉 spec 名单、不碰票面；全仓唯一解析 markdown 表格列的脚本 `scripts/ops/check-issue-262-readiness.mjs` 读的是 `docs/ops/merge-ledger.md`（`:11`），不是票面。代码里对 `docs/tickets` 的引用全是文档注释（如 `recipe-pill-row.tsx:11`、`postgres-store.postgres.test.ts:1442`），无解析。**故无需同批更新任何解析器。**

**还原方式**：删除 `unit/eval result` 列、把本票 AC5 的 unit/eval 内容移回 `Playwright result`、AC6 原因文字移回 `required CI job`、并把规则块恢复为单行 `> **一行未填满，对应 AC 不得勾选。**` 即回到改前状态。改动只涉及 `docs/tickets/v3.1/*.md`，无代码。
