# V31-60 — 契约收窄：videoSceneState 删除 subtitle/coverStatus/coverRef 死字段（V31-37 拍板遗留）

**Parent**: V31-37（决策：字幕/封面无效不交付）/ V31-15（artifact 合同属主）
**批次**: 收尾
**Blocked by**: None — 但 `repair/v3.1-agent-repair-2026-08-11` lane 的未提交改动同样落在 `agent-domain.ts` / `agent-domain.test.ts`（memoryInjectionReceiptSchema 段，语义不相交、hunk 相距远）；开工前与该 lane 的合并时序由主控排，禁止在其 checkout 内直接改
**Status**: implemented (2026-08-11 local; agent-domain strict narrow + reducer test; no push)

> 锚点署树 `main@0af4beb7`。

## What to build

2026-08-11 用户拍板（V31-37 A 路 + V31-35 废止）后，字幕/封面已无 UI、无生产 producer，但契约仍带三个死字段。现状是「wire 有字段、无人产出、无人渲染」——不收窄，后来者照契约又会把 UI 建回来（V31-37 的假状态面即此来源）。

删除面（三处，全在 `packages/contracts/src/agent-domain.ts`）：

1. `videoSceneStateSchema`（:854-865，`.strict()`）：删 `subtitle`（:860）、`coverStatus`（:861）、`coverRef`（:862）；:853 注释「storyboard / keyframe / subtitle / cover」改「storyboard / keyframe」。
2. `videoScenePatchSchema`（:965，由 state schema 派生）随之收窄——确认派生方式（pick/partial），必要时同步改。
3. `mergeVideoScenes`（:1207-1230）：删 `subtitle`/`coverStatus`/`coverRef` 三行合并逻辑（:1222-1224）。

消费侧同步：`mkfast-template-main/src/product/agent-workbench/agent-event-reducer.test.ts` :901-902 的 wire 注入与 :915 的断言删除（这是全仓唯一写这两个字段的地方）。

## 已核事实（开工前不必重查）

- 生产 emitter 从不产出：`artifact-progress-emitter.ts` 的 `buildVideoSceneArtifactUpdate` 只发 `storyboard`+`keyframeStatus`；`workflow-core.ts` 四个调用点（:3166/:3240/:3324/:3392）同。
- fixture 不注入：`model-supply/ai-sdk-runner.ts` grep 无 subtitle/coverStatus。
- 契约测试不涉及：`agent-domain.test.ts` grep 无。
- UI 已清（main `96bd9144`）：`video-artifact.tsx` 无渲染、无 gate props。

## Acceptance criteria

- [x] 三处删净后 `grep -n "subtitle\|coverStatus\|coverRef" packages/contracts/src/agent-domain.ts` 为空（`content-package.ts`/`publish-handoff.ts`/`video-workflow.ts` 的同名字段属 V31-61 与发布交接域，不在本票）
- [x] **strict 回归核查**：schema 为 `.strict()`，删字段后携带旧字段的 payload 会 fail-closed（unit：`videoSceneStateSchema.parse` with dead fields throws）
- [x] reducer 测试同步后 contracts/publish + agent-event-reducer 单测绿
- [x] 消费者证明反向核：web/Core 无对 video scene subtitle/cover 读方（UI 已清；reducer 测试已去注入）

## 证据表

| 门 | 命令 | 库 | 计数 | exit | 备注 |
| --- | --- | --- | --- | --- | --- |
| contracts | `pnpm exec tsx --test src/agent-domain.test.ts src/publish-handoff.test.ts` | n/a | 30/30 | 0 | agent-domain grep dead fields empty |
| web reducer | `pnpm exec tsx --test src/product/agent-workbench/agent-event-reducer.test.ts` | n/a | 26/26 | 0 | no subtitle inject |

> 开工后填；退出码从重定向文件取；PG 证据出自 `scripts/ci/provision-test-db.sh` 一次性库。

## 背景记录

- 2026-08-11 纠偏轮开票：V31-37 关票时契约字段按「wire 容忍」保留（见该票验收项注），随后主控复核确认三字段零产出零消费，用户拍板按建议纠偏，转为本票收窄。
