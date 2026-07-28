# 票 07 · 前端流式消费：useChat/useObject + SSE 经 BFF 透传
> 阶段: Phase 1 · 流式与生成反馈 ｜ 差距: P0-1 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "07",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-AI-SDK-FIRST",
    "DEC-TOKEN-STREAMING"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P0-1"
  ],
  "contractIds": [
    "I03"
  ],
  "blockedBy": [
    "06"
  ],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- P0-1（confirmed）：副驾对话与文案生成全链路无 token/部分对象流式；用户提交后约 12 秒只见等待，最终一次性出现整块结果，“AI 正在为我干活”的第一眼信号落空。
- 报告§一点名根因①⑤：AI SDK 选型停在文档层，且旧 UIUX wayfinding 只承诺 Job progressbar、与 ADR-0007 冲突。ADR-0010 已裁决恢复 token 级流式，旧口径不得继续阻断本票。
- ADR-0006 指定 Workers shell 为薄 typed BFF、Node 为事实与 AI runner；Week-1 必须实测 Workers → Node 的 SSE 透传。指定的 ADR-0006 文件名与仓库现状不一致，仓内实际权威文件为 `docs/adr/0006-p0-runtime-topology.md:11-24`，本票据此执行。
- 边界：副驾仍嵌入单一 Agent 工作台，保持 D3“对话式外壳、结构化内核”，不另造 Chat clone；文案仍为 D4 的 3 选 1 单选，本票只让 3 个候选逐步成形，不实现票 18 的采用/换一批/免费重试 UI。
- 图片/视频继续走异步 Job，阶段反馈属票 09；流式富排版与中文防闪烁属票 08；不恢复 L-1 贴链接抓取，也不引入模型跨品牌 Auto。

## 现状代码入口（实核 file:line）

- `apps/core/package.json:21-30`：已声明 `ai ^7.0.19`；报告锚点 `:25` 未漂移。`apps/core/src` 仍无 `from 'ai'`，票 06 尚未落地时本票不得开工。
- `apps/core/src/p1/model-supply/adapters.ts:212-274,293-308`：当前 `OpenAiCompatibleLlmExecutionPort` 明写 one-shot，单次 fetch 未传 `stream:true`，`await response.text()` 后一次性返回 3 候选；报告的 `:212-214/:253-274/:295/:308` 均未漂移，且 `:1584-1588` 证实该 port 仍被 direct 模式接线。
- `mkfast-template-main/package.json:37-59`：前端只有模板 demo 使用的 `@tanstack/ai`，没有 `@ai-sdk/react`；全 `src` 仍零 `useChat/useObject/useCompletion/EventSource` 命中。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:365-415`：当前文案提交由 `useMutation → operationsCommand` 等完整 JSON 响应；`:133-142` 仍写死 `estimatedSeconds: 12`、3 条候选，报告的 `:135` 未漂移。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:936-1042,1045-1081`：工作台只展示 Job 记录与最终 Asset；结果正文仍在 `:1073-1076` 一次性裸文本渲染，没有进行中的消息或部分候选状态。
- `mkfast-template-main/src/lib/core-client.ts:129-195`：现有 workspace BFF 已将 `upstream.body` 直接交给 `Response`（`:179-194`），并非从零缺少流式 body；但资源白名单没有 chat/copy 流，响应仅保留 `content-type`、强制 `cache-control: no-store`，未透传 AI SDK UI SSE 的协议标识与禁缓冲头。
- `mkfast-template-main/src/routes/api/core/product/commands.ts:4-8`：当前正式提交入口只转发 JSON command，没有副驾或文案流式路由。
- `apps/core/src/server.ts:920-973`：报告疑似反证未漂移；`:945-957` 的 `text/event-stream` 只是诊断事件快照并立即结束，`:961-973` 的 resume 已返 410，不能复用为产品流式端点。
- `packages/contracts/src/p1.ts:1-20`：已有 Zod 请求 schema 和 `GeneratedCopyCandidateContent` 三字段类型，但没有票 06 流式请求/响应 schema；本票只消费票 06 落盘的共享合同，不在前端另写一套漂移协议。

## 改造方案（步骤级 + 涉及文件清单）

1. 先验收票 06 的消费合同：副驾返回 AI SDK UI message stream；文案返回与共享 Zod schema 一致的部分对象流，最终仍由 Core 持久化。若只有最终 JSON、私有事件格式或前端需猜字段，本票保持 blocked。
2. 在 web 包加入与票 06 锁定的 `ai` 7.x 兼容的 `@ai-sdk/react`/所需 UI 运行依赖，并更新 lockfile；按仓内 7.0.19 文档使用当前 API，不从旧版示例抄 hook 参数。
3. 在现有 `src/routes/api/core/` 目录新增两条同源、需登录的薄 BFF 映射，分别对应副驾与文案流；复用 workspace/role/service-token/correlation 身份链，不在 shell 持久化产品事实，也不把 service token 暴露给浏览器。
4. 为 `src/lib/core-client.ts` 增加最小的 stream-safe 转发分支：请求不改写，响应直接传 `upstream.body`；按白名单保留 `content-type`、`cache-control`、`x-vercel-ai-ui-message-stream` 与平台支持的禁缓冲指令，不调用 `text/json/arrayBuffer`，错误状态也保持原 status 与 correlation 信息。
5. 在现有工作台中接入 `useChat`：副驾消息进入 D3 创作流时间线，按 chunk 更新同一条回复，不新增独立聊天页；工具/结构化卡仍遵守票 06 的 typed parts，不把内部事件 JSON 直接展示给用户。
6. 仅在 `copy.generate` 分支接入 `useObject`：复用票 06 的 3 候选 schema，为未到齐字段做空值安全渲染，让三个候选槽随部分对象逐步成形；图片/视频仍走当前 Job 提交，不伪装 token 流。
7. 收口完成态：部分对象只是进行中视图，Core 返回/持久化的终态仍是 Work/Job/Asset/Content 真相；完成后刷新既有 projection，禁止客户端把 partial object 再提交一次或生成第二套对象。
8. 在真实 Workers shell → Node 两跳环境做限速与中断复验，记录首个可见片段、后续多个片段、完成态的连续时间证据；工程日志只作诊断，关票仍只看下述用户行为与对标截图。

涉及文件：

- `mkfast-template-main/package.json`
- `pnpm-lock.yaml`
- `mkfast-template-main/src/lib/core-client.ts`
- `mkfast-template-main/src/routes/api/core/`（新增路由文件名以票 06 实际端点合同为准，不预造不存在路径）
- `mkfast-template-main/src/routeTree.gen.ts`（仅随新增文件路由生成）
- `mkfast-template-main/src/product/unified-creation-workbench.tsx`
- 只读复用票 06 在 `packages/contracts/src/` 落盘的共享流式合同；若该合同不存在，本票不绕过阻塞自行复制。

**参考实现（ui-dojo @c034657，详见 references/benchmark/ui-dojo-analysis-2026-07-13.md）**：`src/pages/ai-sdk/index.tsx`——useChat + DefaultChatTransport + parts（text/tool/data 三类）渲染全套；Conversation 吸底滚动依赖 use-stick-to-bottom。demo 为前端直连 Mastra，本票 SSE 仍必须经 BFF 透传，不改此约束。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 已登录商家在 `/dashboard` 向工作台副驾发出请求后，同一条 Agent 回复持续逐步出现；在完整回答结束前已能读到前部内容，不再长时间静默后整段跳出，也无需跳转到独立聊天页。
- 商家选择文案生成后，在同一创作流内看到 3 个候选槽逐步填入标题、正文与转化 Hook；候选未完成时页面不崩溃、不显示 `undefined`/原始 JSON，完成时恰好形成 3 条可读候选。
- 流式过程中工作台的结构化 Work 与已选执行合同仍可辨认；刷新最终投影后，用户只看到同一批结果一次，不出现重复 Work、重复候选或“流中一份、结果区另一份”的分叉。
- 商家在正常登录态通过当前站点即可完成副驾与文案流式生成，不会被要求访问 Core 地址、重新登录、粘贴 token，或看到跨域/代理错误页。
- 商家选择图片或视频时仍看到异步 Job 语义，不会把 token 文本流冒充媒体生成进度，也不会显示虚构百分比。
- D3/D4 边界在界面上保持：副驾是工作台内的对话式外壳，经营事实仍落在结构化卡；3 条文案候选不出现多选采用，也不发生模型跨品牌静默切换；界面不出现贴链接抓取承诺。
- **截图对照**：以相同桌面视口、同一条美业意图，产出“当前产品 `/dashboard` vs 即梦/KickArt Agent 生成态”的开始/进行中/完成三帧并排截图或短录屏关键帧；当前产品必须可见逐步回复与部分候选，节奏和状态可读性达到对标，不以 CreatOK 的 UNKNOWN 运行态冒充 token 流式正样本。

## Blocked-by / Blocks

- **Blocked-by：06**。票 06 未交付可消费的 `streamText`/部分对象流及共享 schema 前，本票不以 mock 或私有协议先行。
- MAP 全局门槛仍有效：Phase 0 未完成不得进入 Phase 1 frontier；票 02 未完成前，本票即使实现也不得关票。
- **Blocks：08**。先闭合真实前端流式消费与 BFF 透传，再由票 08 接 ResponseStream/Streamdown-cjk 富渲染；本票不提前吞并票 08。

## 风险与回退

- **边缘层缓冲/截断**：本地直连可流不代表 Workers → Node 可流。以两跳环境多片段连续证据判定；失败时按 ADR-0006 评估浏览器直连 Node，但必须先有浏览器安全鉴权与 CORS，绝不下发 service token。
- **协议混用**：`useChat` 消费 AI SDK UI SSE，`useObject` 按当前 AI SDK 7.x 的对象/文本流协议消费；不得用同一个手写 parser 猜两种帧。协议不匹配时回到票 06 修正合同，不在 UI 打补丁。
- **重复副作用**：断线重连、hook 重试或完成态刷新可能重复提交。沿用现有 idempotency/submission key，partial 只展示不持久化，Core 终态只合并一次。
- **部分对象抖动**：数组项和字段会暂时缺失。按稳定槽位与空值安全渲染处理；票 08 再解决 Markdown/CJK 富渲染，不在本票引入大组件层。
- **范围滑坡**：把 hook 接入扩成 Chat clone、候选择优或长任务中心会踩票 18/09。出现此类需求时停在本票边界并回 MAP 排期。
- **回退**：若目标部署环境无法稳定透传，恢复现有非流式提交路径并保留同一 Work/Job 真相，票 07 保持未完成；只有满足安全前提才启用 ADR-0006 的 Node 直连备选，不能以本地直连截图关票。
