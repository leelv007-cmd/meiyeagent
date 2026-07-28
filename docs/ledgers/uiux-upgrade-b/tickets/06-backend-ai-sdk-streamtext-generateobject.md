# 票 06 · 后端 AI SDK 落地：streamText 副驾端点 + generateObject 文案
> 阶段: Phase 1 · 流式与生成反馈 ｜ 差距: P0-1、P1-1 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "06",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-AI-SDK-FIRST",
    "DEC-TOKEN-STREAMING"
  ],
  "guardrailDecisionIds": [
    "DEC-MASTRA"
  ],
  "gapIds": [
    "P0-1",
    "P1-1"
  ],
  "contractIds": [
    "I03"
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

- **P0-1（confirmed）**：副驾没有 token 级流式端点，文案生成仍是单次请求、整块解析、一次性返回 3 条；商家提交 `copy.generate` 后只能等待约 12 秒再看到完整结果，“AI 正在为我干活”的第一眼信号缺席。
- **P1-1（已核实）**：ADR-0007 已拍板 P0 AI 面使用 Vercel AI SDK（副驾 `streamText` + zod tools，流水线结构化文案），但 core 虽声明 `ai ^7.0.19`，业务代码仍零 `from 'ai'`、零 `streamText`、零 `generateObject`；生产创作台也没有 AI SDK UI 消费链。
- **根因**：差距报告 §一根因①⑤——选型停在文档层，且历史 wayfinding 的“只做 Job progressbar”与 ADR-0007 冲突。ADR-0010 已裁决恢复 token 级流式，本票不得再以 Job 轮询替代副驾/文案流式。
- **票界**：本票落后端 AI SDK runner、结构化文案 schema、真实流响应与 BFF 可透传合同；票 07 负责 `useChat/useObject` 消费，票 08 负责富渲染。后端交付只能解阻票 07，不能凭“端点存在”独立关票。
- **锁定边界**：D3 保持同一生成工作台里的对话式外壳、结构化 Work/Job/Asset/Content 内核，不新增独立 Chat clone/浮球；D4 仍是一次 3 条、3 选 1 单选；L-1 贴链接抓取不复活；模型必须显式固定，不做跨品牌 Auto 或静默回退。

## 现状代码入口（实核 file:line）

- `apps/core/package.json:22,25`：仅有 `@ai-sdk/mcp` 与 `ai ^7.0.19`；未声明 OpenAI-compatible AI SDK provider。报告所引 `package.json:25` 未漂移。
- `apps/core/src/p1/model-supply/adapters.ts:212-216`：真实 LLM port 明示 one-shot、exactly one HTTP request；`:253-274` 手写 `/chat/completions` fetch 且无 `stream:true`；`:295` 等完整 `response.text()`；`:305-315` 才一次性组装 3 候选与用量。报告行号未漂移。
- `apps/core/src/p1/model-supply/adapters.ts:1584-1588`：direct runtime 仍把生产 execution 接到上述 `OpenAiCompatibleLlmExecutionPort`，报告 `:1587` 未漂移，非死代码。
- `apps/core/src/p1/model-supply/adapters.test.ts:503-565,618-648`：现有合同只证明“一次请求后得到完整 3 候选”和失败分类；没有首 chunk、部分对象或中断后不重投的流式合同。
- `apps/core/src/p1/model-supply/runtime-config.ts:25-57,247-287`：当前 direct 模式集中解析固定 catalog model、base URL、密钥、模型名与单价；已禁止非 OpenAI-compatible copy model，适合作为唯一 provider 配置源，不能在 BFF 再复制一套选模规则。
- `apps/core/src/p1/model-supply/index.ts:1232-1242,1297-1317`：文案与质量探针最终都穿过同一个 `ProviderExecutionPort`，并在返回后保存 route snapshot、usage 与 provider cost；AI SDK 改造必须保住这条审计/结算链。
- `apps/core/src/p1/operations/model-supply-creation-adapter.ts:94-136`：正式工作台 `copy.generate` 使用显式 `catalogModelId`、固定选择并同步等待 ModelSupply 返回，最终才投影结果。
- `apps/core/src/server.ts:297-318,408-415`：core HTTP 壳已有依赖注入、service token 和 workspace 身份门禁，但没有副驾流式路由。
- `apps/core/src/server.ts:945-958,961-973`：唯一 `text/event-stream` 只是把已存诊断事件一次 dump 后 `end`，相邻 resume 返回 410；报告引用未漂移，不能复用或包装成新流式证据。
- `apps/core/src/main.ts:577-586`：`createCoreServer` 的生产装配尚未注入 AI SDK runner。
- `packages/contracts/src/p1.ts:3-21`：已有 P1 请求 schema 与 `GeneratedCopyCandidateContent` 类型，但没有副驾输入、tool/data parts 或“恰好 3 条候选”的可执行 schema。
- `mkfast-template-main/src/lib/core-client.ts:129-195`：BFF 已做会话、workspace、角色与 service-token 注入，并直接以 `upstream.body` 构造响应；需扩展到副驾资源并实测长连接不缓冲。
- `mkfast-template-main/src/routes/api/core/p1/commands.ts:1-10`：现有 P1 BFF 路由示范了同层代理写法；副驾应在该现有目录新增独立 API route，不把流协议塞进普通 JSON command。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:133-142,365-416`：文案报价硬编码约 12 秒，提交仍是 mutation → invalidate → 整包重取；`:1045-1076` 结果正文一次性裸文本出现。报告所引 `:135`、`:365-416`、`:1074` 均未漂移，分别由票 11、07、08继续收口。

## 改造方案（步骤级 + 涉及文件清单）

1. **先锁协议与 schema**：在 `packages/contracts/src/p1.ts` 增加副驾请求上下文、允许的结构化 tool/data part 与文案候选 zod schema；最终文案必须恰好 3 条，每条含 `title/body/conversionHook`，部分对象可缺字段但不得作为最终结果持久化。
2. **建立薄 AI SDK runner**：在 `apps/core/src/p1/model-supply/` 内把 AI SDK 限定在 runner/provider wrapper，业务层仍只依赖 port；复用 `runtime-config.ts` 的固定 catalog model、base URL、密钥和计价配置，不复制 provider registry，不引入 Mastra。
3. **替换文案结构化调用**：在 `adapters.ts` 用与 lockfile `ai` 7.x 匹配的官方 OpenAI-compatible provider + AI SDK 结构化对象能力取代手写 fetch/JSON parser；最终对象继续映射为现有 `ProviderExecutionResponse`，保留 route snapshot、实际模型、usage、cost、单次 provider side effect 与失败接受度分类。
4. **处理 AI SDK v7 API 语义**：`generateObject` 用于非流式结构化调用；面向票 07 `useObject` 的同 schema 部分对象流使用 v7 对应的对象流 primitive，并以同一次调用的最终 object 落库，禁止为满足两个 API 名称对同一用户请求调用模型两次。
5. **落副驾 `streamText` 端点**：在 `apps/core/src/server.ts` 增加 workspace-scoped POST 流式路由，由 `main.ts` 注入 runner；输入只允许当前创作记录与受控消息，zod tools 首批仅可读取当前结构化上下文、提出可检查字段 patch，不得绕过执行合同直接提交生成或静默改写用户输入。
6. **保持真实流协议**：用 AI SDK v7 的 UI message stream/Node response helper逐 chunk 写出 token、tool part、完成与错误事件；首个 token 后中断归类为 acceptance unknown，不自动重投，不把已退役 diagnostics SSE 当实现基础。
7. **接 BFF 透传合同**：扩展 `mkfast-template-main/src/lib/core-client.ts` 的 workspace resource，并在 `mkfast-template-main/src/routes/api/core/p1/` 下新增独立 TanStack Start API route；保持鉴权头，只透传 `upstream.body`、流 content-type、no-store 与 correlation id，不调用 `text()`/`json()` 聚合。新增 route 文件名须按实际 route 生成结果确定，本 brief 不把尚不存在的文件路径冒充现状。
8. **依赖与验证覆盖**：更新 `apps/core/package.json`、根 `pnpm-lock.yaml`；扩展 `adapters.test.ts`、`live-llm-provider.integration.test.ts` 与现有 HTTP 边界测试，覆盖首 chunk、中文跨 chunk、恰好 3 候选、部分对象→最终对象、取消/断流不重复计费、workspace 隔离及固定模型不静默切换。测试只作工程护栏，不作为 DoD。
9. **交付票 07 的消费合同**：固定 endpoint、AI SDK stream protocol、tool/data part 名称、错误/完成语义及一份慢流样例；票 07 接入真实 `/dashboard` 后，将用户可见证据回挂本票，才进入关票判断。

涉及文件：`apps/core/package.json`、`pnpm-lock.yaml`、`packages/contracts/src/p1.ts`、`apps/core/src/p1/model-supply/adapters.ts`、`apps/core/src/p1/model-supply/adapters.test.ts`、`apps/core/src/p1/model-supply/runtime-config.ts`、`apps/core/src/p1/model-supply/live-llm-provider.integration.test.ts`、`apps/core/src/server.ts`、`apps/core/src/main.ts`、`apps/core/src/product/http.test.ts`、`apps/core/src/p1/operations/http.test.ts`、`mkfast-template-main/src/lib/core-client.ts`，以及 `mkfast-template-main/src/routes/api/core/p1/` 下新增的独立 route。

**参考实现（ui-dojo @c034657，详见 references/benchmark/ui-dojo-analysis-2026-07-13.md）**：`src/mastra/index.ts` 的 chatRoute/workflowRoute 输出标准 AI SDK UI message stream——协议形状参考；`workflowRoute({includeTextStreamParts:true})` 证明长任务步骤内 agent token 可透传（ADR-0010 两口径结合点）。注意该仓用 ai@5，本票以 ai v7 文档为准。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家在真实 `/dashboard` 的同一 Agent 创作记录中提交一句需求后，在完整回复结束前即可连续看到中文内容逐步出现；页面不再静默等待约 12 秒后整段跳出，也不会跳到独立聊天页或浮动 Chat clone。
- 商家生成文案时可先看到候选字段逐步成形，完成后稳定得到恰好 3 条标题、正文与转化钩子均可读的候选；半截对象不会伪装成完成结果，刷新后只恢复通过最终 schema 的结果。
- 商家在流式过程中看到的 tool/字段建议落在同一 Work 时间线，并能接受、编辑或忽略；AI 不会静默覆盖已填字段，不会绕过可见模型、报价与执行合同自行提交。
- 商家选择的模型在本次副驾/文案生成全程可见且保持不变；失败时不会跨品牌 Auto、静默换模型或产生第二份重复候选。
- 商家在首 token 后遇到断网或上游失败时，界面明确显示本次流已中断及可恢复动作，不会突然补出一份来源不明的完整答案，也不会因后台自动重投出现重复扣费/重复结果。
- D4 可见行为不变：最终仍是 3 选 1 单选采用；本票不增加多选采用、换一批次数新规则或 L-1 贴链接抓取入口。
- **截图/录屏对照**：使用同一中文美业文案任务、同一桌面视口，保存当前产品改造前“提交—静默等待—整块结果”三帧，与改造后“首 token—部分候选—3 条完成”三帧，并与即梦/KickArt Agent 的对应生成中状态并排；CreatOK 运行态已被报告判 UNKNOWN，不得冒充 token 流式正面样板。
- 上述证据必须来自票 07 接入后的真实可操作 `/dashboard` 候选构建；仅展示 curl、Network 流、接口文档、单测或静态原型一律不得关票。

## Blocked-by / Blocks

- **Blocked-by**：无实施前置。但遵守 MAP 全局规则：**票 02 完成前，本票不得关票**。
- **Blocks**：工程交付依次解阻票 07（前端 `useChat/useObject` + BFF 透传）→票 08（AI 结果富渲染）。解阻不等于关票；本票须等票 07 回挂真实用户行为与截图证据后方可关闭。

## 风险与回退

- **`generateObject` 与部分对象流命名错位**：AI SDK 7.x 的部分对象流不是靠同步 `generateObject` 自然产生。控制：共享一份 schema，流式旅程只发起一次对象流调用并用其最终 object 落库；非流式内部场景才用 `generateObject`。不得双调用、不得前端伪造渐显。
- **BFF/平台缓冲**：代码层返回 `upstream.body` 不等于部署环境一定逐 chunk 到浏览器。控制：用带节奏的真实慢流做 Worker→浏览器验证；若平台仍缓冲，回退为把同一 runner 的流响应移到 Worker 壳，但 ModelSupply 固定路由、密钥归属、审计与结算必须保持单一真相源，不能复制第二套 provider 旁路。
- **流中断与账务不一致**：首 token 后盲重试可能重复花费。控制：沿用 core 的单次 side-effect/acceptance unknown 语义，记录已观察 usage/correlation id，恢复动作由用户显式触发。
- **部分对象污染持久层**：中间态天然可能缺字段。控制：中间态只进传输层；仅最终 schema 成功且 3 条具有实质差异时写入现有结果/成本链，失败保持可见错误。
- **D3 退化成聊天产品**：`useChat` 协议容易诱导线程/气泡克隆。回退只撤掉独立聊天外观，保留同一 Work 的流式时间线与结构化 patch，不撤回 token 流式。
- **路由治理漂移**：为省事在 Worker 直放 provider key 会绕过 ModelSupply。禁止该旁路；若 core 流端点未达标，先保持旧生成链可用并继续修复透传，不恢复 diagnostics 假 SSE、不启用跨品牌 Auto。
