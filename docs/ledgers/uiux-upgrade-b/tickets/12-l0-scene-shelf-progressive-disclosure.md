# 票 12 · L0 场景货架/预设卡默认态 + 渐进展开外壳（折叠技术表单）
> 阶段: Phase 2 · 参数形态与 CheckBox ｜ 差距: P0-4 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "12",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-D3-WORKBENCH"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P0-4"
  ],
  "contractIds": [
    "I06"
  ],
  "blockedBy": [],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- 差距报告 `P0-4`（`docs/reviews/uiux-productization-gap-report-2026-07-13.md:125-133`）当前定性为 `partial`：首屏已有“一句话开工”，但建立 Work 后的 Composer 仍一次性平铺完整技术表单；真正缺的是 L0 默认态与“专业参数默认收起”的渐进外壳。
- 报告§一根因②④（`:24-28`）命中本票：既有验收重“功能存在”轻主路径体验，且 Composer 仍是模板式技术表单。ADR-0010:7,11 与 MAP:10-15 要求以用户可见行为和逐屏对标截图验收，不能以折叠控件存在或源码完成关票。
- 对标研究 `01-合成-生成式平台降门槛与主入口调和.md:7,45-50,54-82` 已锁定边界：D3 是 Agent 工作台里的“对话式外壳 + 结构化内核”，不是恢复全屏卡墙或复制 chat；L0 是伴随意图框的少量场景入口，深度控制才展开。
- 本票只交付外壳与默认态：票 13 承接“选中命名预设即隐藏提示词框 + 该传什么图”，票 14 承接成套多选与 A/B 默认勾选，票 15 承接模型/模板缩略图富卡。不得在本票提前重开 D4；候选仍是 3 选 1 单选。
- 明确不进入范围：L-1 贴链接抓取已 de-scope（对标研究 `:54,88-98`）；不新增跨品牌模型 Auto，不以“智能”名义静默换供应商。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/product/unified-creation-workbench.tsx:66-90`：只有文案/图片/视频三个 operation 按钮定义，可作为首批少量、真实可兑现的快速预设来源；当前没有独立 L0 场景预设模型。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:211-217`：operation、模型、合规开关与画幅状态已有默认值；报告引用的 `:211,215-217` 未漂移。铁律里的 Auto 是字段预填，不等于允许模型跨品牌 Auto。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:266-298`：operation 变化会刷新目录并选择首个可用模型，模型/operation/画幅变化会撤销报价确认；渐进外壳必须复用这份状态，不能维护第二套隐藏表单值。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:365-408`：提交只消费 operation、明确 model id、画幅、报价与合规设置；现有“内容场景”下拉不进入提交数据。首批预设只能承诺这些真实字段，不能让装饰性场景选择看似会影响生成。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:743-750` + `mkfast-template-main/src/product/creation-shelf.tsx:280-453`：现有 `CreationShelf` 是模板/工具/引用的目录与复用货架，不是 P0-4 要求的 L0 场景默认态；不得仅改名后冒充完成。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:752-932`：报告引用区间仍准确、无行号漂移。当前依次平铺 operation 卡、模型/画幅或内容场景原生 select、不可用警告、报价、水印/AIGC、确认 checkbox 与提交按钮。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:830-838`：不可用模型警告和“系统不会静默切换供应商”仍在原行；折叠后该阻断原因不能藏到用户找不到的位置。
- `mkfast-template-main/src/components/ui/collapsible.tsx:1-19`：已有 Base UI `Collapsible/Trigger/Content` 可复用，无需新增折叠依赖或自造可访问性状态。
- `packages/contracts/src/uiux.ts:17-33`：执行合同无独立 scene/preset 字段；本票以现有可提交字段组成视图层预设，不修改合同语义。

## 改造方案（步骤级 + 涉及文件清单）

1. **把默认态改为少量可执行预设卡**：在现有 Composer 内将文案/图片/视频收敛为 3 张 L0 快速起步卡；卡面用已有 icon、成品类型与一句大白话结果预期，选中态清晰。每卡只映射现有 operation 与已有画幅默认，不虚构使用量、成品缩略图或未接线的业务场景数据。
2. **保持 D3 容器不变**：预设卡属于建立 Work 后的结构化创作流，不另建首页卡墙、不移动“一句话开工”、不引入聊天线程或独立副驾浮层。
3. **建立单一状态映射**：点卡直接更新现有 `operation/aspectRatio`，继续由现有目录选中明确 model id；切换卡后撤销旧报价确认并在界面说明需重新确认。不得复制状态，也不得在提交时悄悄换成另一品牌模型。
4. **增加默认收起的“调整专业参数”**：用现有 `Collapsible` 包住模型、画幅、合规开关及完整技术控制；触发器展示展开/收起状态，键盘和读屏可操作，刷新或切换预设后的默认态保持收起。
5. **把必要决策留在折叠外**：折叠外持续显示所选预设、明确模型名、画幅/产出、时长、报价与合规摘要，以及报价确认和主提交动作；小白无需展开即可理解并完成提交，专家展开后仍能逐项接管。
6. **处理隐藏阻断**：模型不可用、报价缺失或提交被禁用时，在折叠外显示大白话原因和“调整专业参数”入口；不能让用户面对无解释的灰按钮。展开修改后，折叠外摘要须即时同步。
7. **诚实处置现有“内容场景”下拉**：因其当前不进入提交数据，本票不得把它包装成会改变生成的 L0 卡；保留时只能放在专业参数区并避免功能承诺，若要成为真实场景语义须另行映射决策，不在本票偷偷扩合同。
8. **适配桌面与窄屏**：桌面卡片一屏可扫完，移动端单列或横向可读；折叠开关、确认与提交不因卡片高度或展开内容被推离可发现区域。
9. **按同一 Work 留证**：记录升级前平铺态、升级后 L0 默认态、升级后专业参数展开态；使用同一视口、同一预设和同一模型，与指定对标截图逐项标注默认信息密度和渐进层级差异。

涉及文件清单：

- 修改：`mkfast-template-main/src/product/unified-creation-workbench.tsx`。
- 复用但不修改：`mkfast-template-main/src/components/ui/collapsible.tsx`、`mkfast-template-main/src/product/creation-shelf.tsx`、`packages/contracts/src/uiux.ts`。
- 不新增后端接口、合同字段或第二套 Composer；若实现中确需提取纯展示子件，路径须按现有 product 目录约定在实施时确认，不在 brief 中虚构文件。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家建立 Work 后，Composer 第一眼只看到 3 张少量快速起步卡、当前选中卡和一份可读摘要，不再先面对模型/画幅/开关/checkbox 全量平铺。
- 商家点选文案、图片或视频预设后，选中态、模型名、画幅/产出、时长与报价在同一区域立即更新；切换预设后旧确认明确失效，不会带着旧报价直接提交。
- 商家不展开专业参数，也能看懂“将生成什么、用哪个明确模型、预计多久/多少钱、合规标识状态”，完成确认并提交；界面不出现跨品牌“Auto”或静默换模。
- 商家点击“调整专业参数”后，能看到并修改原有模型、画幅和合规设置；再次收起时修改值不丢失，摘要与下一次提交所见一致。
- 当模型不可用或报价缺失时，商家在折叠外直接看到阻断原因与可采取动作，不会只看到无解释的禁用提交按钮，也无需猜测隐藏字段哪里出错。
- 键盘用户可聚焦、选择预设并展开/收起专业参数；读屏能获知当前选中预设与展开状态。桌面和移动窄屏均无横向溢出，主确认/提交动作可发现。
- 截图对照：同一桌面视口并排标注当前产品 `.scratch/creatok-uiux-wayfinding/assets/current-product-screenshots/05-video-models-desktop-live.jpg` 的竖排技术表单、升级后“L0 默认收起/专业参数展开”两态，以及对标 `.scratch/creatok-uiux-wayfinding/assets/screenshots/03-video-generator-desktop-live.jpg` 的低密度起步态；另以 `18-model-selector-desktop-live.jpg` 只作后续富模型卡参照，不把票 15 范围冒充本票完成。

## Blocked-by / Blocks

- Blocked-by：无票级依赖。
- 全局流程闸：Phase 0 未完成前本票不得进入 frontier；即使实现与截图完成，票 02 的体验合同 required 条目未验绿前也不得关票。
- Blocks：票 13；按 MAP 的 `12 → 13 → 14` 递进链，间接 blocks 票 14。票 15 无本票直接 blocked-by 关系。

## 风险与回退

- **卡片看似有语义、实际只换皮**：现有 scene 下拉不进提交数据。控制：卡片只映射真实 operation/画幅/明确 model id，截图验收包含切卡后的摘要变化；不承诺未进入执行的数据。
- **把关键阻断藏进折叠**：默认收起可能让灰按钮更难理解。控制：不可用、缺报价、需重新确认等原因始终在折叠外；必要时只引导展开对应字段，不自动替用户改值。
- **隐藏值与摘要漂移**：两套状态会导致“看到 A、提交 B”。控制：预设、专业参数、摘要和提交共用现有状态；回退时将专业参数默认展开，也不保留第二套旧 Composer。
- **跨票扩张**：补缩略图、传图引导、Hook、多选套组、候选择优或跨品牌 Auto 会踩票 13-15/18。控制：本票只交付 L0 外壳、真实默认映射与渐进展开；未有真实素材时用现有 icon 与文字，不造假成品图或使用量。
- **移动端折叠后动作失焦**：展开长表单可能把摘要和提交推远。控制：优先保证单列阅读顺序与清晰的收起入口；若窄屏体验回归，临时回退为专业参数默认展开，但保留同一状态和 L0 预设，不恢复双实现。
