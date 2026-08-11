# V31-37 — 字幕/封面 assisted fallback：§37.4 承认 #264 退役，或等 V31-15 落 producer（决策票）

**Parent**: V31-14（§37.4-D 旅程）/ V31-15（artifact protocol）
**批次**: 收尾
**Blocked by**: ~~需产品决策~~ **已拍板（2026-08-11）**
**Status**: open（决策已落盘，实施收尾中）

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**: 
**Workflow Run**: 
**Artifact Digest**: 

## 决策记录（2026-08-11）

**用户拍板：采 A 路，且封面同判**——原文：「视频字幕和封面都是无效功能，不需要交付」「这会导致后续测试一直无法验收」。即：

- 视频字幕与视频封面为无效功能，移出交付与交接范围；字幕由发布平台承担（承认 #264 退役口径）；
- §37.4-D「字幕封面 assisted fallback」要求废止，旅程改断「不承诺字幕轨/封面面板」；
- B 路（等 V31-15 落 producer）废弃，`video-artifact.tsx` 场景字幕/封面状态位（无 producer 假状态面）随同清理。

决策已落盘：权威规划 §6.2 与 §37.4-D、`spec-D-433-delivery.md` 故事 2/9、V31-15/V31-17 票面同步修订。

## 需要决策什么

§37.4-D 要求「字幕/封面 assisted fallback」——自动生成不成时退回到辅助（商家手改/手传）而不是整条失败。这条腿现在**卡在规格与已落地退役之间**，二选一必须先拍板，实施才有方向：

- **A 路（§37.4 承认 #264）**：#264 已经退役了产品自有字幕轨——`mkfast-template-main/src/product/results/video/video-worksurface.tsx:117` 的注释写明「#264 retires the product-owned subtitle track; publishing platforms own captions」，其 interaction 测试把 `video-subtitle-panel` / `video-cover-panel` 钉成**不存在**（即"面板缺席"是当前被测试背书的正确行为）。若采纳 A，则 §37.4-D 这条腿应改写为「字幕由发布平台承担」，旅程改断「不承诺字幕轨」，本票转为一次 spec 修订。
- **B 路（等 V31-15 落 producer）**：残存的按场景字幕/封面状态面活在 `mkfast-template-main/src/product/agent-workbench/artifact/video-artifact.tsx:111-115`（`agent-artifact-scene-subtitle` 显示「已写入 / 待生成」、`agent-artifact-scene-cover` 显示封面状态）。**但 2026-08-09 深审列该 artifact 面为「无生产 producer」**——状态位有 UI、没有真实生产者写它。若采纳 B，则需要 V31-15 先落 producer，再由本票补 assisted fallback 语义（自动失败→落到「待生成」并给商家一个可操作入口），旅程那条腿随之可断。

两路互斥：A 路下 B 路的 UI 应清理，B 路下 #264 的退役范围需要收窄为「不做字幕轨渲染但仍做字幕文本」。**不要两头都建。**

## 需要谁拍板

产品决策（主控转呈用户）。技术侧本票只提供事实：#264 已退役的确切范围、artifact 面的确切现状、以及两路各自的连带改动面。

## Acceptance criteria

- [x] 决策落盘：结论写入 `docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md` §6.2/§37.4-D（2026-08-11，见上方决策记录）
- [x] `tests/e2e/specs/v31-video-paid-execution-journey.spec.ts`：V31-37 fixme 删除，「不承诺字幕轨/封面面板」真断言并入主旅程测试（delivered 后断 `video-subtitle-panel`/`video-cover-panel`/`agent-artifact-scene-subtitle`/`agent-artifact-scene-cover` 均 count 0）；**旅程真跑归合并轮（spec 头注纪律）**
- [x] 采纳 A：#264 退役范围已在 §37.4-D 显式记载；`video-artifact.tsx` 字幕/封面状态位（原 :111-118）已清理，场景面只余分镜/关键帧
- [x] ~~采纳 B~~（废弃）
- [x] 无 UI 孤儿状态位。注：contracts `videoSceneStateSchema` 的 `subtitle`/`coverStatus` optional 字段保留为 wire 容忍（reducer merge 行为不变、`agent-event-reducer.test.ts` 既有断言不动），仅 UI 与交付承诺移除——收窄 contract 属后续独立决策，不在本票强拆

## Blocked by

- 产品决策未定；B 路另阻塞于 V31-15 producer

## 证据表

| 门 | 命令 | 库 | 计数 | exit | 备注 |
| --- | --- | --- | --- | --- | --- |
| lint | `npx biome check video-artifact.tsx v31-video-paid-execution-journey.spec.ts` | — | 2 files | 0 | No fixes applied |
| 类型 | `npx tsc --noEmit`（只读，dev 并存安全，绕 locale:compile） | — | 6 error | 2 | 6 个全为 main tip 既有错（vite-disconnected-socket-plugin ×3、composer-home ×2、store-intake ×1），零命中本票改动文件 |
| e2e 旅程 D | 未跑 | — | — | — | spec 头注纪律：真浏览器跑归合并轮；断言已并入主旅程测试 |

> 开工后填；退出码一律从重定向文件取，PG 证据一律出自 `scripts/ci/provision-test-db.sh` 一次性库。表格形制以 V31-29/V31-30 落地后为准。若最终采纳 A 路（纯 spec 修订），本表只需记 spec 落盘与旅程改写两行。

## 背景记录

- 2026-08-09 L-T3（Task 3 §37.4-D 旅程）开票：写 D 旅程时发现这条腿不是"没实现"也不是"实现了没测"，而是**规格与已合入的退役决定互相矛盾**——照 §37.4 断言会与 #264 的现行测试背书直接对撞。按主控裁决保留 `test.fixme` 挂 blocker，债转本票并显式标记为决策票而非实施票。
- 深审引证：`agent-workbench/artifact/video-artifact.tsx:111-115` 场景字幕/封面状态面被 2026-08-09 复核列为无生产 producer。
