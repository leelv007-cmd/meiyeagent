# 票 18 · 候选择优 UI：3 选 1 对比 + 换一批 + 免费重试入口（D4 维持单选）
> 阶段: Phase 3 · 接线与成品感 ｜ 差距: D4 实现缺口（报告§二 2.2 理解二） ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "18",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-D3-WORKBENCH",
    "DEC-D4-SINGLE-SELECTION"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [],
  "contractIds": [
    "I08"
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

- 差距报告 `docs/reviews/uiux-productization-gap-report-2026-07-13.md:57-60` 只确认“后端一次返回 3 候选、产品存在采用动作”，当时没有足够材料判断采用 UI 形态；本次实核已补足：正式桌面工作台把 3 条文本 Asset 当普通结果卡逐张放置，每张都有独立“接受为 Content”，没有单选组、统一确认、换一批或免费重试入口。
- 报告 §一根因②（`:24`）与路径 B（`:259-263`）要求把能力接进主路径并以体验截图验收；本票不能以“已经返回 3 条”或“已有接受命令”关票。
- `docs/adr/0010-uiux-upgrade-path-b-and-streaming-verdict.md:9,11` 与 `.scratch/uiux-upgrade-b/MAP.md:10,14,55` 已作最新裁决：D4 不重开，文案维持一次 3 条、3 选 1 单选、换一批、免费重试 ≤2；禁止改成多选采用。
- ADR-0008 的真实文件为 `docs/adr/0008-video-in-p0-and-layered-buy-build.md`，用户给出的旧文件名当前不存在；其 `:34,50-57` 锁定体验层自建、文案 3 选 1 + reroll、失败退款与质量重试分层。以 ADR-0010 对本票的最新传导为准。
- 费用语义必须分开：技术失败沿现有失败重试/退款语义；“换一批”是成功结果后的新批次并正常消耗 1 次；“免费重试”是成功但不满意的质量重试，额外消耗为 0，同一根批次最多 2 次。任何入口都不得静默转成另一种动作。
- 范围守卫：D3 仍为“对话式外壳、结构化内核”，候选卡嵌在同一创作流而非另造 chat clone；L-1 贴链接抓取不复活；模型沿用本次明确选择，禁止跨品牌 Auto 或换批时静默换模。

## 现状代码入口（实核 file:line）

- `apps/core/src/p1/model-supply/adapters.ts:212-274,293-308`：当前 LLM 一次请求明确要求 exactly three candidates，并以 `copyCandidates` 整批返回；报告的 `:308` 仍准确。
- `apps/core/src/p1/operations/model-supply-creation-adapter.ts:179-185`：接入 Operations 时只保留候选 `title/body`，上游已有的 `conversionHook` 被丢弃，导致对比信息不完整。
- `apps/core/src/p1/operations/application-service.ts:4352-4377`：3 候选被持久化为同一 Job 下 3 个 text Asset；`:4622-4683` 的 `acceptCreativeAsset` 只防同一 Asset 重复接受，没有阻止同一 Job 的第二、第三个候选继续建立 Content。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:133-142,252-262`：报价已声明 3 条候选，工作台也能按当前 Job 取出 3 个 Asset；能力不缺，缺候选择优状态与动作编排。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:1045-1105`：当前结果区为 `md:grid-cols-2` 普通卡片，每张独立调用 `accept_creative_asset`；用户可连续接受多张，和 D4 单选不变量冲突。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:1022-1039` 与 `apps/core/src/p1/operations/application-service.ts:4599-4619`：现有 `retry_creative_job` 仅允许 terminal failed Job；不能复用为成功后的“换一批”或“免费重试”。
- `packages/contracts/src/uiux.ts:57-100`、`apps/core/src/p1/operations/types.ts:489-555`：Job/Asset/Content 投影没有候选序号、换批根链、质量重试次数或保留的 conversion hook；当前 UI 无法诚实显示“第几版/还剩几次”。
- `apps/core/src/p1/model-supply/index.ts:2085-2096` 与 `apps/core/src/p1/model-supply/foundation-module.ts:1902-1906`：质量事件已支持 `rerolled` 并有记录入口，可复用来闭合换批漏斗，不必新造第二套质量事件。
- `mkfast-template-main/src/routes/dashboard/index.tsx:30-40`、`mkfast-template-main/src/product/mobile-action-book.tsx:118-144,634-661`：移动首页分流到 `MobileActionBook`；它虽已查询 P1 creative projection，却仍从 legacy Product state 只取最后一条候选并“采用这条 Content”，没有展示同批 3 候选，形成桌面/移动双真相。
- `apps/core/src/product/product-service.ts:2541-2595`：legacy 视频已有“成功后质量重试、前 2 次 0 消耗”的参考实现；只借其计数/账本语义，禁止把 P1 文案倒接回 legacy 视频命令。

## 改造方案（步骤级 + 涉及文件清单）

1. **保留完整候选投影**：在既有 Creative Asset 投影中保留稳定候选顺序与 `conversionHook`，由同一 Job 的 3 个 text Asset 形成一个候选批次；不复制 Content、不新建平行候选事实源。
2. **桌面改为真正单选**：仅对已完成的 `copy.generate` Job，把普通结果卡改为编号 A/B/C 的对比组；卡片首层展示标题、转化钩子和正文摘要，整卡/单选控件只改变本地选中项，底部唯一“采用所选文案”才提交一次接受命令。
3. **服务端钉死 D4**：`accept_creative_asset` 校验目标必须属于当前 workspace 的 text candidate，并保证同一 copy Job 最多一个 `outputContentId`；重复提交同一候选幂等返回，提交另一候选得到可理解冲突，不能靠绕过 UI 多选采用。
4. **新增成功后换批动作**：为 completed `copy.generate` Job 增加显式 reroll 命令，沿用原 Work、明确模型、contract 与来源，创建关联的新 Job/批次并正常消耗 1 次；保留旧批次事实，界面切到新批次并显示“第 N 批”。双击由稳定幂等键收敛为一个新批次。
5. **新增免费质量重试动作**：同一根批次成功后允许最多 2 次 0 额外消耗的质量重试，持久化根链与已用次数；provider cost 仍按事实记录，Product Usage 显示 0 额外消耗。用完后明确显示“免费机会已用完”，不得静默变成付费换批。
6. **把三种动作写成人话**：候选区同时说明“采用只选 1 条”“换一批将消耗 1 次”“不满意可免费重试，剩余 X/2”；技术失败继续显示次数已返还/重试，不占质量重试次数，也不混用成功换批命令。
7. **接回质量漏斗**：采用记录 adopted、换批/免费重试记录 rerolled，并带当前模型、场景与版本事实；记录失败不能让已成功的采用或换批被重复执行。
8. **移动端同源**：`MobileActionBook` 改读 P1 creative 当前 copy Job 的同一批 text Asset，以纵向 A/B/C 单选卡和固定底部采用动作完成 3 选 1；换批、免费剩余次数与桌面一致，不再从 legacy `product.state.contents.at(-1)` 伪装本批候选。
9. **可见状态收口**：生成中显示候选逐步到齐/不可采用，恰好 3 条后开放单选；0 条、少于 3 条、动作失败均原位说明并保留重试入口，不渲染空白卡，也不自动挑第一条。
10. **浏览器验收**：用同一 Work 走通“得到 3 条→切换单选→采用 1 条→刷新仍只采用 1 条”“换一批扣 1 次”“连续两次免费重试显示 2→1→0、第三次不静默扣费”，并在桌面与移动核对同一 Job/批次状态。

涉及文件（均为当前已存在路径）：

- 主要修改：`mkfast-template-main/src/product/unified-creation-workbench.tsx`、`mkfast-template-main/src/product/mobile-action-book.tsx`。
- 合同与服务端不变量：`packages/contracts/src/uiux.ts`、`apps/core/src/p1/operations/types.ts`、`apps/core/src/p1/operations/application-service.ts`、`apps/core/src/p1/operations/foundation-module.ts`、`apps/core/src/p1/operations/model-supply-creation-adapter.ts`。
- 账本/质量事件按现有边界最小复用：`apps/core/src/p1/model-supply/index.ts`、`apps/core/src/p1/model-supply/foundation-ledger.ts`、`apps/core/src/p1/model-supply/foundation-module.ts`；不得新增绕过 Usage Ledger 的旁路计数。
- 工程回归旁证：`apps/core/src/p1/operations/creative-work.test.ts`；测试结果不能替代下述用户可见验收。
- 若为可读性提取候选视图组件，必须留在现有 product 责任边界、由同一 projection 驱动；本票不预造不存在的组件路径。

**参考实现（ui-dojo @c034657，详见 references/benchmark/ui-dojo-analysis-2026-07-13.md）**：`src/pages/ai-sdk/workflow-suspend-resume.tsx` + `src/mastra/workflows/approval-workflow.ts`——suspend(suspendPayload=3 候选)→前端决策卡→resume({runId, resumeData:{chosenIndex}}) 合同；换一批=resume({regenerate})、免费重试 ≤2 在服务端守卫，把 D4 升格为工作流一等公民。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家在正式桌面工作台得到文案结果后，同屏看见编号 A/B/C 的 3 条可比较候选；每条都有标题、转化钩子和正文，界面没有 3 个彼此独立的“接受”按钮。
- 商家可在 3 条间来回切换，但任一时刻只有 1 条处于选中态；未选择时不能采用，点一次“采用所选文案”后只有该条成为已采用 Content，刷新后仍保持唯一采用。
- 商家点击“换一批”前能看见“消耗 1 次”，确认后只生成一个新批次并切到新的 3 条；模型名保持原明确选择，旧批次可追溯且不会与新批次一起被多选采用。
- 商家在成功但不满意时看见“免费重试，剩余 2/2”，两次使用后依次看到 1/2、0/2；第 3 次不会自动扣费，而是明确引导选择付费“换一批”或返回修改条件。
- 技术失败时商家看到次数已返还与失败重试入口；该动作不会减少免费质量重试次数，也不会生成重复批次或重复消费。
- 候选未满 3 条、网络中断或动作失败时，商家看到原位可理解状态并可继续恢复；系统不会自动采用第一条、暴露 JSON/内部 ID，或把失败伪装成成功空卡。
- 商家在移动端能完整浏览同一批 A/B/C、明确单选并采用，换批与免费次数和桌面一致；触区、固定动作区与正文滚动互不遮挡。
- 截图对照：先在验收环境用同一测试数据截取当前产品“3 张普通卡 + 各自接受按钮”状态，再与对标 `.scratch/creatok-uiux-wayfinding/assets/screenshots/02-agent-desktop-live.jpg` 及升级后“同一 Agent 流内 A/B/C 单选 + 单一采用 + 换批/免费次数”同视口并排；只以对标图验证流内层级、低技术感和主次动作，不虚称 CreatOK 截图本身展示了 3 选 1。
- 另附升级后移动截图，必须同时看见 3 个候选的可达入口、唯一选中态、底部采用动作与免费剩余次数；不能只截静态卡或 toast。

## Blocked-by / Blocks

- Blocked-by：无。
- 全局关票闸：Phase 0 未完成前本票不得进入 frontier；无论开发是否完成，票 02 的体验合同 required 条目与本票对标截图未验绿前都不得关票。
- Blocks：无 MAP 明示硬阻塞。票 17 的结果卡/历史画廊不得把“预览”当“采用”；票 23 可复用本票新增文案，但均不改变本票依赖关系。

## 风险与回退

- **UI 单选、服务端仍可多选**：重复请求或旧客户端可建立多个 Content。控制：服务端以 copy Job 为原子边界强制最多一个采用；回退时可暂时禁用采用入口，不能只撤掉前端 radio 后恢复多按钮。
- **换批、免费重试、技术重试混账**：可能重复扣费、免费次数误减或质量漏斗失真。控制：三种显式命令/原因、同一根链计数、幂等键与账本终态分别校验；回退为隐藏成功后的换批/免费入口，保留已发生账本事实，不改写历史。
- **桌面/移动继续双真相**：移动仍采用 legacy Content，桌面采用 P1 Asset。控制：两端只读同一 CreativeWorkbenchProjection 和同一接受命令；回退移动端为只读候选并引导桌面完成，禁止双写两套状态。
- **候选批次排序漂移**：刷新后 A/B/C 对调或旧新批混在一起。控制：持久化稳定候选序号与根批次关系；回退按服务端序号只读展示，不用客户端数组位置猜顺序。
- **免费重试被滥用或并发超限**：双端同时点击可越过 2 次上限。控制：workspace 事务内按根链计数并幂等创建；回退为服务端拒绝新免费重试并原位刷新剩余次数，绝不静默转付费。
- **过度“智能择优”重开 D4**：自动推荐/自动采用会夺走轻确认点。控制：系统只帮助对比，不替商家选择；回退移除推荐标记，保留人工 3 选 1，禁止改成多选或跨品牌 Auto。
