# V31-08 — Progressive Level 0–3 判定 + 计费 UX 三规则 + Quick Checks CI

**Parent**: spec-B（#2）；权威 V3.1 §3、附录 A5/A13、§31.1b
**批次**: 2 ｜ **语义锁**: 同 06
**Blocked by**: V31-06, V31-07
**Status**: done (merged, 2026-08-08)

## What to build

任务分级：Level 0 确定性轻修改不进 LLM 循环；Level 1 纯 copy 免确认直达结果（永久口径 U1）+ 报价 chip 常显/余额阻断双出口/退还双态文案；Level 2 进 Living Plan；Level 3 Campaign（确认粒度合同在 V31-11）。**Quick Checks assertion API + Session 侧行为门进 CI**（toolOrder 六原语序列/didNotCall/maxToolCalls，零 LLM 微秒级）——V31-23 只扩共享 registry 不重写。

## Acceptance criteria

- [ ] Level 0 零 LLM 调用（trace 断言）；Level 1 从 interpreting 直达 handing_off
- [ ] 免确认硬边界=纯 copy（A13 判定权威），kill switch 不扩大确认边界
- [ ] 计费 UX 三规则在免确认路径全过（A5 验收项）
- [ ] Quick Checks 进 CI 且为 required
- [ ] 简单任务不因新链变慢（对照 V31-05 基线）

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
| AC1 | — | — | — | — | — | — | — |
| AC2 | `apps/core/src/p1/agent-session/composer-plan-session.ts:956`（`approvalBasisForSubmission` → pure copy = `policy_exempt_copy`） | `apps/core/src/p1/harness/task-admission.ts:579`（`policy_exempt_copy` 立即 admit，无 merchant decision） | `apps/core/src/p1/agent-session/composer-plan-session.test.ts:1041`（copy → `policy_exempt_copy`）；`execution-plan-admission.test.ts:138`（exempt 仍冻结） | — | — | **2/2 pass**（`v31-level1-copy-journey.spec.ts` policy-exempt + insufficient-balance；INT `a9095ad40` clean short DBs PORT=3180 `/tmp/v31-final-verify/browser-short/runner.log`；lane focused 同绿） | `v31-browser-acceptance`（`run-v31-browser-acceptance.sh:26`） |
| AC3 | `mkfast-template-main/src/product/composer/composer-home.tsx:4285`（`composer-quote-line` 常显）＋ `:3993`/`:4375` shortfall | `mkfast-template-main/src/product/composer/workbench-credit-purchase-actions.tsx:15-26`（booster / upgrade 双出口） | `quota-blocking-card.interaction.test.tsx:240`；level1 spec 真重放不双扣（`:267` case） | — | — | **同 AC2：2/2 pass**（quote chip 持续、余额不足双出口、freeze+replay 幂等均在同一 spec） | `v31-browser-acceptance` |
| AC4 | — | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — | — |

### Wave-4 resume 说明（2026-08-11）— **不勾 AC**

- §37.4-B 真实 UI spec 已落地：`mkfast-template-main/tests/e2e/specs/v31-level1-copy-journey.spec.ts`（merge `cea994b3d` / format `a9095ad40`）。
- Playwright 轴对 AC2／AC3 **有真绿**（上表）。unit/eval 与 PG 轴本轮未在 tip 定向回填数字 ⇒ 结果格仍有 `—` ⇒ **按填表规则不得勾选** AC2／AC3。
- AC1（Level 0 零 LLM / Level 1 状态机）与 AC4／AC5 本轮无新证据，保持脚手架空表。
