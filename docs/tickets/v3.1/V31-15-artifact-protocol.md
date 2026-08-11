# V31-15 — Artifact protocol（snapshot/delta）+ 原位生长 + registry 注册

**Parent**: spec-D（#4）`docs/specs/v3.1-agent-specs-2026-08-08/spec-D-433-delivery.md`；权威 V3.1 §5.5、§24.1、§27.5
**批次**: 4（frontend 部分可归 frontend lane）
**Blocked by**: V31-03, V31-04
**Status**: done (merged, 2026-08-08；V31-62 补证勾选 2026-08-11)

**Implementation state**: done
**Verification state**: verified
**Evidence SHA**: 233163aaa6195489d11b05e706558ca409294e29
**Workflow Run**: 
**Artifact Digest**: 

## What to build

右栏稳定 Artifact 原位生长（同一 artifactId reconciliation）：图文逐页（骨架→文案→配图状态）、视频逐场景（分镜/关键帧；字幕/封面已判无效不交付——2026-08-11 用户拍板 V31-37 A 路，场景状态面不含字幕/封面位）；ArtifactUpdate wire=discriminated union {mode:'snapshot',full}/{mode:'delta',baseRevision,patch}，patch schema 按 artifactType 受控；同 revision 重放幂等、跳 revision 退回取 snapshot；渲染组件全部注册 Controlled Surface Registry；已完成内容永不静默覆盖（修改产生派生版本）。

## Acceptance criteria

- [x] artifact stable id 断言：重复对象率=0
- [x] SSE round-trip：乱序/重复/跳 revision/断线重连全过（delta 失败回退 snapshot）
- [x] 移动端 Artifact 全屏 Sheet 可用
- [x] 版本回看可达（派生版本不覆盖）

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
| AC1 | `apps/core/src/p1/harness/artifact-progress-emitter.ts:108`（`buildNotePageArtifactUpdate` 稳定 artifactId 增量） | `packages/contracts/src/agent-domain.ts:1408`（`applyArtifactUpdate` 同 id 原位 reconcile）＋ `mkfast-template-main/src/product/agent-workbench/artifact/artifact-canvas.tsx:90-93`（`data-artifact-id` / `agent-artifact-card`） | `apps/core/src/p1/harness/artifact-progress-emitter.test.ts`；浏览器 `v31-artifact-growth-journey.spec.ts` AC1（稳定 id 正负配对） | **contracts 21/21** 含 stable-id rate=0；**emitter 9/9**；**reducer+client 31/31** 含 in-place growth（@ tip `d7c4ff50`，V31-62 重取） | `n/a`（稳定 id 合同在事件/浏览器轴；本 AC 不强制 PG 行数） | **4/4 batch 中 AC1 1/1 pass** clean solo e2e-lock PORT=3251 CORE=4251；45.1s；`/tmp/v31-62-artifact-final/pw-all.log` | `v31-browser-acceptance`（`run-v31-browser-acceptance.sh:37`） |
| AC2 | `apps/core/src/server.ts:1910-2032`（`e2eAgentFault=artifact-head-replay` / `artifact-gap-close` 生产故障注入）＋ `apps/core/src/p1/harness/artifact-progress-emitter.ts:108`（delta wire） | `packages/contracts/src/agent-domain.ts:1408`（skip→`needs_snapshot` / 同 revision 幂等）＋ `mkfast-template-main/src/product/agent-workbench/agent-event-reducer.ts:647-671`（`artifact_needs_snapshot`→resync）＋ `agent-event-client.ts:33-64`（唯一 reconnect） | `packages/contracts/src/agent-domain.test.ts`（skip/duplicate/cold）；`agent-event-reducer.test.ts`（乱序 batch / skip resync / reconnect hydrate）；浏览器 AC2 gap-close+head-replay | **contracts 21/21**；**reducer+client 31/31** 含 out-of-order / duplicate / skip→needs_snapshot / patch-fail resync（@ `d7c4ff50`） | `n/a`（SSE 乱序/重连合同不强制 PG 行数） | **4/4 batch 中 AC2 1/1 pass** clean solo PORT=3251 CORE=4251；27.4s；真实 `e2eAgentFault`（无 `route.fulfill` 伪造成功）；`/tmp/v31-62-artifact-final/pw-all.log` | `v31-browser-acceptance`（`run-v31-browser-acceptance.sh:37`） |
| AC3 | `mkfast-template-main/src/product/agent-workbench/artifact/artifact-mobile-sheet.tsx:21-64`（fullscreen sheet） | `mkfast-template-main/src/product/agent-workbench/agent-workstream.tsx:209-218`（mobile works → sheet）＋ `composer-home.tsx` viewportKind 接线 | `artifact.interaction.test.tsx` AC3 open/close/content；浏览器 AC3 mobile 390×844 | **interaction 9/9**（含 AC3 sheet open/close/content）；workstream interaction 8/8（@ `d7c4ff50`） | `n/a`（移动 Sheet 是 UI 轴） | **4/4 batch 中 AC3 1/1 pass** clean solo PORT=3251 CORE=4251；30.4s；`/tmp/v31-62-artifact-final/pw-all.log` | `v31-browser-acceptance`（`run-v31-browser-acceptance.sh:37`） |
| AC4 | `apps/core/src/p1/harness/note-page-execution-frame.ts:238-288`（ready 后 regen 带 `parentRevision`） | `packages/contracts/src/agent-domain.ts:1408`（silent_overwrite 拒绝 + versionHistory 归档）＋ `artifact-canvas.tsx:239-286`（version browser）＋ `agent-workbench.tsx:364-369`（`set_artifact_viewing_revision`） | `agent-domain.test.ts` derived history；`agent-event-reducer.test.ts` version 回看；`artifact.interaction.test.tsx` AC4 lookback；浏览器 AC4 page-regen → chips | **contracts 21/21** 含 ready never silent-overwrite + history；**reducer 含 version 回看**；**interaction 9/9** 含 lookback body（@ `d7c4ff50`） | `n/a`（版本回看合同在事件/UI 轴；package 行数非本 AC 门） | **4/4 batch 中 AC4 1/1 pass** clean solo PORT=3251 CORE=4251；34.6s；page regen + version chip lookback 同 id；`/tmp/v31-62-artifact-final/pw-all.log` | `v31-browser-acceptance`（`run-v31-browser-acceptance.sh:37`） |

### V31-62 补证说明（2026-08-11）

- V31-62 在 tip 工作树扩展 `v31-artifact-growth-journey.spec.ts` 为 AC1–4 四案；必跑门仍只登记该文件（`run-v31-browser-acceptance.sh:37`）。
- Clean solo 全绿：**4/4 pass / 3.1m**，e2e-lock，PORT=3251 / CORE=4251，`MODEL_EXECUTION_MODE=fixture`，日志 `/tmp/v31-62-artifact-final/pw-all.log`。
- unit/eval 于 tip `d7c4ff50` 重取：contracts 21/21、reducer+client 31/31、artifact interaction 9/9、emitter 9/9。
- AC2 浏览器轴覆盖 gap-close + head-replay 重连与单卡恢复；乱序/重复/跳 revision 的纯 reconcile 由 unit 轴正断言（ticket 允许 Core unit + browser 混合）。
- 勾选依据：四列 writer/consumer/failure-recovery/required-CI 非空，三结果列均为真实结果或 `n/a`。

### Wave-4 resume 说明（2026-08-11，历史）

- §5.5 真实 UI growth journey 已落地并合入：`00db9ef85` / `c59e81036` / `3aa312387` → merge `a4a049900`。断言覆盖：稳定 Artifact id、原位生长、左右角色、无 candidate/result/delivery 三重卡；**刻意止于 ready rail，不依赖 delivery card**（`3aa312387`）。
- 当时 AC1 Playwright 轴真绿但 unit/eval 未重取、AC2/3/4 无定向浏览器绿证——由 V31-62 补齐并按勾选规则勾选。
