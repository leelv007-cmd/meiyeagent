# V31-73 — 新用户 image_text 首访旅程确定性死路：默认配方 `case_image` 硬前置无引导、400 落兜底文案劝重试

**Parent**: dashboard 首访旅程实测（2026-08-13 主控亲验）；产品面承接 V31-54 边界节点明留的产品决策（「若认为 `case_image` 对该旅程不该是必需，那是产品决策，停手报主控」——本票即该决策的落地面）
**批次**: 待排（首访旅程）
**Blocked by**: 无
**Related**: V31-54（同一个门，fixture 侧已用种子绕过——正因如此本缺口在 e2e 全绿下不可见）、V31-28（问店分权裁决，见 V31-74）、V31-74（文案债）、V31-75（展示层收尾包）

**Status**: open（2026-08-13）— 主控浏览器亲验实锤，未派工

**Implementation state**: not-started
**Verification state**: reproduced（确定性，两轮同签名）
**Evidence SHA**: 39ca4b399361a9226848c71009d3d6500612ce2c（main HEAD，本地 dev 栈 web:3000 / core:4100 / meiye@54329）
**Workflow Run**:
**Artifact Digest**:

## 缺口（一句话）

零素材的新账号在 dashboard 选「图文」输入一句话提交，被静默绑定的默认配方 `recipe.case_to_xhs_note` 的 `case_image` required 槽确定性 400 拒收，而 UI 全程不引导、不前置校验、失败后用「可以直接再发一次」劝用户做无用重试——首访核心闭环 0% 可走通。

## 证据（2026-08-13 主控亲验，全新注册账号 `journey-review-0813@example.test`）

| # | 证据 | 落点 |
|---|---|---|
| 1 | 旅程复现：注册→选图文→填「帮我写一条美甲新客团购的种草笔记」→发送→Brief 高危确认→「确认并开始」→红字失败；重试同签名 | 浏览器实测两轮＋全量抓包一轮，确定性 |
| 2 | 拒绝原文 | `POST /api/core/p1/composer/submissions` → 400 `{"error":{"code":"INVALID_STATE","message":"Required source slot case_image is not satisfied by the current workspace sources."}}`（前四步 quote / brief_context_sync×2 / brief_confirm 全部 200） |
| 3 | 默认配方与槽声明 | `apps/core/src/p1/creation-experience/launch-seeds.ts:106`（`recipe.case_to_xhs_note`，`featured` + `cardOrder 0`，选图文即自动绑定）；`:124-130`（`slot: 'case_image', required: true`） |
| 4 | 抛出点（产品合同门，不许放宽） | `apps/core/src/p1/execution-spine/composer-submission-gate.ts:836`（锚出自 V31-54，本轮未重核行号） |
| 5 | 前端吞错点 | `mkfast-template-main/src/product/composer/use-composer-run.ts:432-461` `onError` 只特判 `CREATIVE_GROUNDING_INCOMPLETE` 与 `INSUFFICIENT_ENTITLEMENT`/`ENTITLEMENT_INSUFFICIENT` 两族；`INVALID_STATE` 落进兜底 |
| 6 | 误导文案 | `project.inlang/messages/zh.json` key `workbench_work_create_failed`＝「这次没能开始创作，可以直接再发一次。没跑起来的创作不扣积分。」——对确定性失败劝重试；渲染点 `composer-home.tsx:4580` |
| 7 | 为何 e2e 看不见 | V31-54 AC1：spec 在 submit 前调 `seedComposerInlineAuthorize` 种案例图。种子让门后旅程可验，但也让「零素材新用户」这条真实路径永远不在门内——测试背书假绿＋前台不接的复合形态 |
| 8 | 连带症状 | 报价阶段照常算出「本次约消耗 15 分／本次用量已确认」（quote 成功但提交必败＝状态谎报）；失败后右栏「进行中／正在提交」永久卡住（归 V31-75） |

## What to build

1. **产品决策落地（本票存在的理由）**：零素材用户在图文 lens 下的出路。建议方向（主控倾向，拍板后实施）：提交前把「缺 `case_image`」变成前置引导卡——「这个配方需要一张案例图」＋两个出口（「去传素材」／「换不需要案例图的写法」即降级到无 required slot 的配方或自由创作）。**不放宽 Core 门**。
2. **前置校验**：composer 在配方绑定/报价阶段即比对 `sourceRequirements` 与当前 workspace sources，缺 required slot 时发送键直接进引导态，不让用户走到「确认并开始→400」。
3. **错误翻译兜底**：`INVALID_STATE`（缺 slot 族）翻成商家语言并给出行动出口；兜底文案不得再对确定性失败说「可以直接再发一次」。
4. **防回归**：新增/改造 e2e 用**不种 `case_image`** 的零素材账号钉死本旅程（防止再被种子盖掉）。V31-54 的种子对它自己的 K 旅程合法，保持不动。

## 边界与禁止修法

- **禁止**放宽或绕过 `composer-submission-gate.ts:836` 的 slot 检查（V31-54 同款边界：那个门是产品合同）。
- **禁止**只改 `workbench_work_create_failed` 文案止血了事——文案是第 3 项的一部分，第 1/2 项才是主体。
- 不动 `launch-seeds.ts` 里 `case_to_xhs_note` 自身的 slot 声明；若最终裁决是「换默认配方」，以新配方/排序落地，不是删旧配方的 requirement。

## Acceptance criteria

- [ ] 零素材新账号：选图文＋任意 prompt，**走不到**「确认并开始→失败」死路（前置引导或降级出路二选一按拍板落地）
- [ ] 有素材账号：原路径行为不变（V31-54 K 旅程、xhs 主旅程回归绿）
- [ ] `INVALID_STATE` 缺 slot 族不再渲染「可以直接再发一次」；渲染商家语言＋行动出口
- [ ] 新 e2e：零素材账号首访旅程（不调 `seedComposerInlineAuthorize`）钉住上述行为
- [ ] 报价/确认卡阶段缺 required slot 时不再展示「本次用量已确认」类确定语（与 V31-75 费用行项衔接，归属以先动工的票为准）

## 留痕

- 开票：2026-08-13 主控 dashboard 首访旅程亲验（全新注册账号、全量 API 抓包）实锤确定性 400；根因链＝默认配方硬前置 × 前端零引导 × 错误码兜底吞。V31-54 已在票面明留该产品决策待主控，本票即其落地面。
