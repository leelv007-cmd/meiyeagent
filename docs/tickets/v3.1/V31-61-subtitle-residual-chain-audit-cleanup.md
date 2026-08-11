# V31-61 — 字幕/封面残链清理：先斩 model-supply 时长推导依赖，再核 handoff/content-package 残余

**Parent**: V31-37（决策：字幕/封面无效不交付）
**批次**: 收尾
**Blocked by**: None — 归 model-supply / 发布交接属主 lane；与 V31-60（agent-domain 契约收窄）不同文件、可并行
**Status**: open（2026-08-11）

> 锚点署树 `main@0af4beb7`。

## What to build

2026-08-11 拍板后，字幕/封面退出交付与交接范围，但仓内还有三段残链。**注意：第 1 段不是纯死码，有隐性依赖，删前必须先斩断**：

1. **model-supply 时长推导依赖（本票核心，先做）**：`apps/core/src/p1/model-supply/index.ts:5764` 用字幕时间轴末尾时间推视频时长（`input.subtitles?.at(-1)?.endSeconds ?? input.clips.length * 15`）。纠偏顺序：先把时长推导改为不依赖 subtitles（clips 口径优先，须与 Plan「预计时长」及计费口径对账，D-061 语言不受影响），再清 `TimedSubtitle`（:5729/:5761）。**禁止先删字段后补时长**——那会静默改变已交付视频的时长口径。
2. **video-workflow 持久链**：`video-workflow-projection.ts:47/:134-135/:199-200/:263-264` 与 `packages/contracts/src/video-workflow.ts:53` 的 `subtitleText`；`video-workflow-canonical{,-postgres}.ts` 是否有持久列须核。无消费者则删链；有持久列须 migration 说明；若判定保留为 internal-only（提示词生成环节副产物）须在契约注释显式标注「非交付物」。
3. **发布交接/包契约残余**：`packages/contracts/src/publish-handoff.ts:293`（video checklist 的 safety-zone/cover/subtitle expectations）与 `content-package.ts:123`（`subtitles` 对象）。§6.2 已修订为「视频和平台安全区」，checklist 合同应随之去掉 cover/subtitle 期望位（safety-zone 保留）；content-package 的 subtitles 若被 checklist 之外消费须列明后再裁。

## Acceptance criteria

- [ ] 时长口径先行：subtitles 依赖斩断后，视频时长的来源与数值有回归证据（同一 fixture 前后时长一致，或差异有显式裁决记录）
- [ ] 消费者证明：每段删除前列出全部读方（grep 记录进证据表）；有读方而不能删的，契约处标注 internal-only + 理由
- [ ] 持久层：`video-workflow-canonical-postgres` 若有 subtitle 列，migration 说明齐备；无则记「无持久列」
- [ ] publish-handoff checklist 合同与 §6.2 修订面一致（cover/subtitle 期望位移除、safety-zone 保留），消费 UI 同步
- [ ] typecheck + 相关单测/PG 套件绿

## 证据表

| 门 | 命令 | 库 | 计数 | exit | 备注 |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

> 开工后填；退出码从重定向文件取；PG 证据出自 `scripts/ci/provision-test-db.sh` 一次性库。

## 背景记录

- 2026-08-11 纠偏轮开票：主控核出 `index.ts:5764` 的「字幕时间轴推时长」隐性依赖，故本票明确排序为先斩依赖再清链，不允许直接删。
- #264 当年退役的是「产品自有字幕轨渲染」；本票在 V31-37 A 路口径下把「字幕文本」残链一并清算（A 路下 #264 退役范围不再收窄）。
