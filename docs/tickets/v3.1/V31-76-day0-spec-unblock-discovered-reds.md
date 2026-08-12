# V31-76 — day-0 spec 死线解封后的两条既有红：示例店 remix 重定向失效（疑真缺陷）＋ continue-item 缺失

**Parent**: V31-74 收口连带（test-contract 修正 `2bfa196e` 解封 `uiux-creation-loop` 后暴露）
**批次**: 待排（首访旅程）
**Blocked by**: 无
**Related**: V31-74（解封 commit）、V31-54（「门后新红是发现不是回归」归类规则来源）、V31-58（test-contract mismatch 同形态先例）

**Status**: open（2026-08-13）— 主控复跑取证，未派工

**Implementation state**: not-started
**Verification state**: reproduced（红 1 两轮同签名；红 2 一轮）
**Evidence SHA**: 2bfa196e（复跑树）；死线成因树 dc03d3e1（2026-08-08 空态标题刻意降为 h2，spec 仍断 h3，此后全档死在首断言）
**Workflow Run**:
**Artifact Digest**:

## 背景（为什么现在才红）

`uiux-creation-loop.spec.ts` 自 dc03d3e1（08-08）起死在 119 行（空态标题 h3≠产品 h2），其后所有断言 5 天从未执行；该 spec 不在 v31 必跑门列表里，无人发现。V31-74 收口修正 contract（h3→h2 ×6、「开始下一次任务」→「开始下一次创作」）后，死线后面的断言首次运行，暴露以下两条。按 V31-54 规则：**发现≠回归**。

## 红 1（疑真产品缺陷）：切行业后 remix 不重定向

- 用例：`uiux-creation-loop.spec.ts:101`「E0 example is opt-in and can be remixed…」，死点 `:205`
- 编舞：首店（护发/头皮护理）点「复用这条结构」→ 草稿正确带头皮内容；切「生发」行业 → 选第三家店内容 preview → 再点「复用这条结构」
- 期望：草稿变为生发店内容（「做一条抖音美业内容，主题是养发护理…」）
- 实测：**草稿仍是第一家店的头皮内容**（「做一条小红书美业内容，主题是头皮护理…」）——第二次 remix 未生效
- 两轮复现（库 `meiye_lane74_v3174b` / `v3174c`，lane 端口 3074/4174），确定性
- 产品含义：商家切了行业、选了新店、点了复用，拿到的却是旧草稿——若为真缺陷属示例店 remix 链（sessionStorage `meiye.creation-draft-intent.v1` 写入/覆盖逻辑）；未排除 spec 对 store 索引/preview 选择的假设过期，**修前先判这一层**
- 连带：`:212` 的「先核对信息」accessible-name 断言在此死点之后，e2e 轴证据被挡（V31-74 票面已注 residual）

## 红 2（既有红，与解封无关）：continue-item 缺失

- 用例：`dashboard-home-mount.spec.ts:656`「a workspace with real work is never told it produced nothing」
- 死点：`getByTestId('continue-item').first()` 5s 不可见；死点在本次 contract 修正行**之前**，即修正前该用例同样红
- 一轮取证（库 `v3174b`）；需先复跑一轮定性 testid 改名 vs 渲染缺失

## What to build

1. 红 1：先只读核对 spec 对 `sampleStores` 索引与 contentPreviews 的假设是否仍匹配种子；仍匹配 ⇒ 追 remix 第二次点击的草稿覆盖链（读 `suggestion-capsules` / example store remix handler / sessionStorage 写入），修产品侧；假设过期 ⇒ 修 spec 并在票下写明。
2. 红 2：复跑定性后同法分流（testid 改名=改 spec；渲染缺失=产品修）。
3. 两条全绿后在票下回答：`uiux-creation-loop` 全档是否首次整档绿（day-0 旅程重新有 e2e 背书），并把 `:212`「先核对信息」断言的首次执行结果记回 V31-74。

## 边界

- 不放宽断言、不 skip/fixme 了事（V31-54 同款边界）。
- 该 spec 是否应进必跑门属门治理决策，报主控，不在本票自行加门。

## Acceptance criteria

- [ ] 红 1 定性（spec 假设 vs 产品缺陷，证据在案）并修复对应侧
- [ ] 红 2 定性并修复对应侧
- [ ] `uiux-creation-loop.spec.ts` 整档本地绿；`dashboard-home-mount.spec.ts` 整档本地绿
- [ ] `:212` 首次执行结果回写 V31-74

## 留痕

- 开票：2026-08-13 V31-74 主控收口轮，contract 解封三轮复跑取证（e2e 日志 /tmp/lane74-e2e{,2,3}.log，会话临时，过期以本票记录为准）。
