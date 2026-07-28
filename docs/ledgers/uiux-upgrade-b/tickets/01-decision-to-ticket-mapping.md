# 票 01 · 拍板→工程票映射审计与防断链机制
> 阶段: Phase 0 · 共同前置 ｜ 差距: 根因①⑤（报告§一） ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "01",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-RUNTIME-TOPOLOGY"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [],
  "contractIds": [],
  "blockedBy": [],
  "closureEvidence": [
    "scripts/uiux/decision-ticket-guard.test.mjs",
    ".scratch/uiux-upgrade-b/decision-ticket-map.json"
  ],
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- 根因①：差距报告 `docs/reviews/uiux-productization-gap-report-2026-07-13.md:22` 指出，ADR-0007 已钦定 AI SDK，但工程票与验收未强制承接，形成“装了不用、选了不接”；报告 `:245` 要求每条拍板映射到工程票和验收条目，推迟项必须回写决策，禁止静默遗漏。
- 根因⑤：同报告 `:30,38-44` 指出，2026-07-11 UIUX wayfinding 的 Job progressbar 口径与 ADR-0007 的 token 级流式冲突。ADR-0010 `:7-11` 已裁决：路径 B、token 流式、D4 单选策略均不得再重开。
- 当前 `MAP.md:23-72` 已为 7 个 P0、12 个 P1、5 个 P2 差距分配票号，但仍缺“决策状态→用户可见合同→差距→票→截图证据”的机器可校验双向关系；仅有表格不能阻止后续票漏写、改写或关错。
- 本票只建立传导和阻断机制，不代替票 02 的体验合同矩阵，也不实现票 06-25 的产品行为。
- 路径漂移说明：任务给出的 ADR-0006/0008 文件名在仓库中不存在；实核现存文件为 `docs/adr/0006-p0-runtime-topology.md` 与 `docs/adr/0008-video-in-p0-and-layered-buy-build.md`，后续引用以这两个实际路径为准。

## 现状代码入口（实核 file:line）

- `apps/core/package.json:21-25`：后端已声明 `ai ^7.0.19`；实核 `apps/core/src/**` 无 `from "ai"`、`streamText`、`generateObject` 业务命中（负证据，无可引用行号）。
- `apps/core/src/p1/model-supply/adapters.ts:212-216`：真实 LLM 端口明确是 one-shot；`:251-274` 只发一次 `/chat/completions` 请求且未传 `stream:true`；`:293-308` 等待完整 `response.text()` 后一次返回候选。报告中的短路径与行号已漂移，本处为当前锚点。
- `mkfast-template-main/package.json:51-52`：前端依赖是 `@tanstack/ai` 与 `@tanstack/ai-fal`，没有 AI SDK UI。
- `mkfast-template-main/src/api/ai.ts:1-2,16-29`：TanStack AI/fal 被定义为 AI demo 通道；`mkfast-template-main/src/routes/(pages)/ai.tsx:15-21,37-60` 证明其消费面是营销 `/ai` 页面，不是主创作路径。
- `docs/adr/0006-p0-runtime-topology.md:11-16,24`：Workers shell、单 Node、单 Postgres/R2 边界及 SSE spike 仍有效；映射机制不得借 UIUX 升级偷改部署拓扑。
- `docs/adr/0007-agent-runtime-ai-sdk-first.md:11-15`：`streamText`、`generateObject`、Runtime Port 与 Mastra 延后是生效决策。
- `docs/adr/0008-video-in-p0-and-layered-buy-build.md:10-14,50-59`：媒体显式选模、D3 对话式外壳/结构化内核、D4 分媒介候选策略及商品链接抓取不采纳仍有效。
- `.scratch/creatok-uiux-wayfinding/assets/10-desktop-visual-system-prototype-record.md:128-135`：历史原型只锁定带数值 Job progressbar；该口径只保留为历史证据，流式冲突由 ADR-0010 覆盖。
- `.scratch/creatok-uiux-wayfinding/assets/13-uiux-acceptance-matrix.md:1-5,96-100`：现有矩阵能阻止 required 失败时切换，但没有 Path B 的 token 流式和逐屏对标合同；补矩阵归票 02。
- `.scratch/uiux-upgrade-b/MAP.md:10-15,76-83`：已有差距映射原则、02 全局关票闸与 Exit milestone，但尚无自动校验入口。

## 改造方案（步骤级 + 涉及文件清单）

1. 建立单一映射清单：逐条登记 ADR-0006/0007/0008/0010 中与 Path B 有关的生效决策，以及报告 24 个差距；每项固定 `decisionId/sourceAnchor/status/userVisibleContract/gapIds/ticketIds/evidencePair`。`status` 只允许 `active/deferred/de_scoped/superseded`；`active` 必须有票，其余状态必须有决策锚点且不得伪装成待实现功能。
2. 首次审计并回填双向映射：P0-1…P0-7、P1-1…P1-12、P2-1…P2-5 全覆盖；票 01-25 均反向声明决策/差距。无差距编号的新范围必须先回 ADR，不可直接塞入票。
3. 把四条锁定不变量写入清单并分配守护票：
   - token 流式由 06→07→08 承接，图片/视频 Job 反馈由 09 承接，不得再用 Job progressbar 替代文本逐字流式；
   - D3 由 12-22 的主工作台行为共同承接，保持“对话式外壳、结构化内核”，禁止新增独立 Chat clone；
   - D4 只由 18 实现“3 选 1 单选 + 换一批 + 免费重试≤2”，禁止改成多选采用；
   - L-1 贴链接抓取固定为 `de_scoped` 且不得复活，22 只清理死占位并实现拍照/拖放/粘贴；15/16 的图片与视频始终显式选模，禁止跨品牌 Auto 或静默换模。
4. 为每张票增加机器可读的映射块和状态字段；关闭动作必须同时满足：映射存在、Blocked-by 已完成、票 02 的体验合同存在、用户可见 DoD 有同一候选构建的截图对照。纯代码/接口/测试证据不能把状态改为 closed。
5. 增加最小 guard：校验来源文件与锚点存在、24 个差距无遗漏、active 决策有票、deferred/de_scoped/superseded 无误接、票与清单双向一致、blocked-by 无环，并硬阻断“票 02 未完成但任一票 closed”。
6. 先写失败用例覆盖“删掉 P0-1 映射、把 D4 改多选、复活 L-1、媒体声明跨品牌 Auto、02 未完成先关票、引用不存在来源”六类断链，再实现最小校验器；接入根 `check`，让断链在日常检查阶段直接失败。
7. 在 MAP 增加清单与 guard 入口，只展示摘要和依赖图，不复制第二份可编辑真相；ADR 发生变更时由 source anchor 变化触发人工重审，而非静默沿用旧映射。

涉及文件：

- 修改：`.scratch/uiux-upgrade-b/MAP.md`（入口、权威顺序、状态/关票规则摘要）
- 修改：`.scratch/uiux-upgrade-b/tickets/*.md`（统一映射块、状态、双向引用；以实施时已存在票为准）
- 新增：`.scratch/uiux-upgrade-b/decision-ticket-map.json`（唯一机器可读映射清单）
- 新增：`scripts/uiux/decision-ticket-guard.mjs`（只读校验器）
- 新增：`scripts/uiux/decision-ticket-guard.test.mjs`（六类断链回归）
- 修改：`package.json`（把 guard 接入现有 `check`，不新增依赖）

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家在主工作台提交文案后，能看到文字逐字出现、结构化候选逐步成形；映射明确由 06/07/08 承接，任何只展示 Job 百分比的实现都不能关闭这些票。
- 商家提交图片/视频长任务后，能看到自动更新的白话阶段、离页后回收入口与真实结果回流；映射明确由 09/10/11 承接，不接受“手点刷新后才变化”。
- 商家始终在一个 Agent 工作台内以对话承接意图、以 brief/候选/产物卡确认结构化事实；页面不出现第二工作台或独立 Chat clone，相关行为均能追到 12-22 的 owning ticket。
- 商家面对文案候选只能 3 选 1 单选采用，并可换一批、免费重试≤2；不得出现多选采用。图片/视频模型必须显式可见且由用户选择，不出现跨品牌 Auto 或失败后静默换模。
- 商家在统一输入台可打字、拍照/传图、拖放或粘贴素材；界面不承诺“贴链接自动抓取”，也不保留不可用的链接入口。
- 截图对照项：同一桌面视口、同一“提交文案”时刻并排保存“当前产品一次性整块返回”与“即梦/KickArt 逐字/分步反馈”截图，标明产品、构建、路由、视口和时间点；映射中该差距必须指向 06/07/08，缺任一侧截图不得关闭对应体验合同。
- Exit 前，24 个差距各自对应至少一个商家可观察行为和一组当前产品 vs 对标产品证据；从任一差距都能定位 owning ticket，从任一票都能反查决策来源，且没有额外功能承诺。

## Blocked-by / Blocks

- Blocked-by：无。
- 全局关票闸：即使本票实现完成，票 02 完成前仍不得关闭本票或任何其他票。
- Blocks：06-25 进入 frontier；01-05 全部完成前，Phase 1-5 不得开工。票 02 使用本票的 `decisionId/gapId/userVisibleContract` 建体验合同，不复制决策文本。

## 风险与回退

- 风险：从自然语言猜语义会误报。控制：guard 只校验显式结构化字段与稳定 source anchor，不扫描关键词替人做决策。
- 风险：映射清单与 MAP/票形成多份真相。控制：JSON 是唯一机器真相，MAP 只链接和摘要，票只保存反向 ID；双向不一致即失败。
- 风险：历史 wayfinding、旧定稿或旧文件名重新盖过 ADR-0010。控制：权威顺序固定为 ADR-0010 → 当前有效 ADR-0006/0007/0008 → 历史证据；冲突必须标 `superseded`。
- 风险：guard 变成“检查全绿、体验仍缺席”的新形式主义。控制：guard 只能阻止断链，关票仍由票 02 的用户可见行为与同构截图决定。
- 回退：移除根 `check` 中的 guard 调用并撤销新增清单/校验器，恢复 MAP 摘要；该机制不改运行时代码、数据或用户内容，无数据迁移与线上回滚风险。
