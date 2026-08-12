# V31-62 — V31-15 AC2/3/4 定向浏览器绿证补齐（原位生长核心合同只有单测背书）

**Parent**: V31-15（artifact protocol，status done 但证据表 3/4 行空）
**批次**: 收尾
**Blocked by**: None — 浏览器验收 lane；与 V31-60/V31-61 无文件交集
**Status**: evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending

**Implementation state**: done
**Verification state**: evidence-debt
**Evidence SHA**: 3bec455d728be43e2d5bfeca8ee1a355cdedb281
**Workflow Run**: 
**Artifact Digest**: 

> 锚点署树工作 tip `d7c4ff50`（证据跑在本 tip 工作树；Playwright/unit 日志见下）。

## What to build

V31-15 于 2026-08-08 合入并标 done，但其 Evidence 表只有 AC1（稳定 artifact id）拿到 Playwright 真绿（且 unit/eval 未在 tip 重取、按填表规则不得勾选）。§5.5「原位生长」的三条核心合同**没有任何浏览器旅程绿证**：

- **AC2**：SSE 乱序/重复/跳 revision/断线重连全过，delta 失败回退 snapshot；
- **AC3**：移动端 Artifact 全屏 Sheet 可用；
- **AC4**：版本回看可达、派生版本不覆盖已完成内容。

本票=按 V31-15「Evidence」节的填表规则（三结果列各守一轴、`—`/`n/a`/`未跑` 三态、四列非空且结果真实方可勾选）补齐 AC2/3/4 三行定向旅程证据，并在 tip 重取 AC1 的 unit/eval 数字。

## Acceptance criteria

- [x] AC2 定向旅程：乱序/重复/跳 revision/断线重连四个扰动至少各一条正断言 + delta→snapshot 回退一条（可扩展 `v31-artifact-growth-journey.spec.ts` 或新 spec，进必跑门）
- [x] AC3 移动 viewport 旅程：Artifact 全屏 Sheet 打开/关闭/内容一致
- [x] AC4 旅程：完成内容修改产生派生版本、旧 revision 可回看、原内容不变
- [x] AC1 unit/eval 在 tip 重取数字回填
- [x] V31-15 Evidence 表按填表规则回填并按勾选规则勾选；跑法遵守 e2e-lock + lane 专属端口纪律，证据出自 clean solo 运行

## 证据表

| 门 | 命令 | 库 | 计数 | exit | 备注 |
| --- | --- | --- | --- | --- | --- |
| unit contracts | `pnpm --filter @meiye/contracts exec node --import tsx --test src/agent-domain.test.ts` | n/a | **21/21 pass** | 0 | 含 ArtifactUpdate wire / in-place / skip→needs_snapshot / silent_overwrite / stable-id rate=0 |
| unit reducer+client | `pnpm exec tsx --test src/product/agent-workbench/agent-event-reducer.test.ts src/product/agent-workbench/agent-event-client.test.ts`（cwd=mkfast-template-main） | n/a | **31/31 pass** | 0 | 乱序 batch、duplicate、skip resync、reconnect hydrate、version 回看 |
| unit interaction | `pnpm exec vitest run src/product/agent-workbench/artifact/artifact.interaction.test.tsx` | n/a | **9/9 pass** | 0 | AC3 sheet open/close/content；AC4 lookback body 不覆盖 live head |
| unit emitter | `pnpm --filter @meiye/core exec tsx --test src/p1/harness/artifact-progress-emitter.test.ts` | n/a | **9/9 pass** | 0 | skeleton→copy→image 稳定 id |
| Playwright AC1–4 | e2e-lock + `PORT=3251 PLAYWRIGHT_CORE_PORT=4251 PLAYWRIGHT_CANVAS_PORT=5251 MODEL_EXECUTION_MODE=fixture pnpm --filter @meiye/web exec playwright test tests/e2e/specs/v31-artifact-growth-journey.spec.ts --reporter=list` | default stack DB | **4/4 pass** / 3.1m | 0 | clean solo；log `/tmp/v31-62-artifact-final/pw-all.log`；AC1 45.1s / AC2 27.4s / AC3 30.4s / AC4 34.6s |

> 退出码从重定向文件取；本轮无新增 PG 门（AC 均标 n/a）。

## Residual

- **无阻断 residual**：AC1–4 在 clean solo 下 4/4 浏览器绿；unit 轴 tip 重取全绿。
- AC2 浏览器轴用生产 `e2eAgentFault`（gap-close + head-replay）证明重连与 delta 缺口恢复；**乱序/重复/跳 revision 的逐条正断言在 unit 轴**（`agent-domain` + `agent-event-reducer`），与票面「可 Core unit + browser」一致。
- AC4 曾卡在派生 run 的多张 `execution-confirmation-interaction-card` 残留；旅程改为 newest-first 清卡，不点 Living Plan 开始制作（会 409 `COMPOSER_PLAN_START_FAILED`）。
- 未 push。

## 背景记录

- 2026-08-11 纠偏轮开票：用户问询 §5.5/V31-15 约定时主控复核证据表，发现 done 票下 AC2/3/4 零浏览器证据（Wave-4 resume 说明也明确「AC2/3/4 本轮无定向浏览器绿证，保持空」），属「测试背书缺位」型债，转本票补齐。
- 2026-08-11 收口：扩展 `v31-artifact-growth-journey.spec.ts` + interaction 加强；V31-15 Evidence 四行勾选。

## 2026-08-12 CI 观察：AC4 风暴前单例红（transport 停摆形态，一个数据点，先记不修）

run 31587057598（v31 门，f171b41d）AC4 于 10:30:34 红——`page.waitForResponse(result_adjust_prepare)` 60s 超时（spec:779）。时间在 workerd 风暴（10:36:34 起）**之前**，不是级联；形态与 V31-28 lane 记录的 dev 传输悬案同款（后端正常、页面侧 fetch 响应不归）。本地此前 4/4 pass（AC4 34.6s）。单数据点先记账观察，复发升级为独立票；与 V31-64 仪器票邻域的 transport 停摆线索合并追踪。
