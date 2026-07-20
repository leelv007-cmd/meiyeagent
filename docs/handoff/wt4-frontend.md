# WT-4 前端体验线 Handoff

> **状态：历史 handoff，实施已合入。** 保留作 #28/#29/#33/#36/#44 的属主与接缝证据；当前状态见 [`../reviews/implementation-gap-ledger-2026-07-19.md`](../reviews/implementation-gap-ledger-2026-07-19.md)，不要据此重新开工。

**使命**：用户看得见的一切。先修三喂料权利断线（#28）、候选呈现组件迁移（#29 组件部分）、通用进度 SSE 通道（#33），#35 落地后接 Composer 五类入口+单问卡（#36）与 Day-0 冷态（#44）。

**文件域**：`mkfast-template-main/src/`（product 组件、routes、lib/core-client、core-stream）、`apps/core/src/server.ts` 的 SSE 路由段、`packages/contracts` 的前端消费面（协议归 WT-2 的 #25，你只消费）。

## 认领序列

1. **#28 上传权利流内化**（无阻塞，立即开工）：修订节 P0——受限素材定义（`containsPerson` 或 before_after/customer_case）+持久授权证据引用/用途/平台/有效期，裸 boolean 不算；撤权到期后 grounding 拒绝。**复用 `CanonicalAssetGovernance`/`authorize_asset` 命令语义内嵌到上传项，不建第二套授权状态机**。锚点勘误：硬编码在 workbench:1696/1707。
2. **#29 候选呈现迁移——组件部分**（无阻塞可先行）：改为消费服务端 `recommendedAssetId`+DecisionTrace；**旧链没有推荐事实时只显示「候选」，不得把 A 改名主推荐**（修订节 P0）；主推荐说明补全七项。运行态验收挂 #35，组件先落。
3. **#33 通用进度 SSE 通道**（等 WT-2 的 #25；内部分批）：A=Core 双事件源+**归属校验（前置 404，不泄存在性）**+SSE/重连协议+BFF 透传（`Last-Event-ID` 要转发，现有 helper 不转）、B=`useWorkflowEventStream`+React Query+视频面板切 SSE（轮询留兜底）。修订节要点：游标用 #25 的稳定 eventId、禁连接局部计数器；ADR-0006 拓扑兜底（透传验证失败→前端直连 Node）。**你的 A 批是 WT-1 #35 的前置，优先于 B**。
4. （#35 后）**#36 Composer 五类入口+单问卡+答复即续**：修订节 P0——五类入口按 D-023 capability gate 逐项显示，未过完整合同保持隐藏；单问卡走 #35 B 批的决定接缝（不接前端 reducer）；不复用 field-patch 的「忽略」语义、不用 AlertDialog；与 #44 边界=你不碰首页三块布局。
5. （#35 后）**#44 Day-0 冷态+示例橱窗+今天值得发什么**（等 #29/#35/#36/#37）：修订节 P0——**复用现有 `ExampleStorePreview`+E0 旅程，禁止重建**；「今天值得发什么」按状态机合同（绑 workspaceId+factsRevision 的持久推荐，不得用静态 openingSuggestions 伪装个性化）。

## 上下游

- **等你的**：#33A 解锁 WT-1 #35 收口；#29 组件被 #35 C 批消费；#36 解锁 #38/#39/#40/#45/#47（扇出后其他线）；#28 解锁 WT-2 #37。
- **你等的**：#25（WT-2）→ #33 前置；#35（WT-1）→ #36/#44 前置；#37（WT-2）→ #44 前置。

## 必读与红线

- 票体修订节；r4 报告 `.scratch/ticket-code-inventory-codex-2026-07-18/r4-frontend-dod.md`（八项能力真通/断线/未建三档+已建勿重做清单——**动手前对照，别重建真通能力**）；r3 §2/§4（SSE 设计与单问卡雏形）；DESIGN.md+`.impeccable/design.json`（视觉令牌）。
- 红线：不动 assistant `useChat` 与 copy `useObject` 通道（三协议分离）；原型路由 `/prototype-marketing-home` 永不上线；示例数据零写入用户账本；结构化输入不得长成槽位表单（D-031）。
- Playwright e2e 是你线的主验收面：现有 specs 在 `mkfast-template-main/tests/e2e/specs/`，验收口径按 D-023（TEST-CATALOG 横幅）。
