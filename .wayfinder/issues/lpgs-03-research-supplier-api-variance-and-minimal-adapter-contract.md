---
title: "调研供应商 API 差异与最小适配合同"
parent: "../map-lightweight-personalized-generation-spine.md"
labels:
  - wayfinder:research
status: closed
closed_at: 2026-07-24
blocked_by:
  - "锁定轻量主干目的地与收缩权限"
assets:
  - "../../references/analysis/lightweight-generation-spine-research-2026-07-24/03-supplier-api-adapter-contract-research.md"
---

## Question

结合当前已接供应商和首发候选的官方 API，文案、图片和视频调用在输入、参考资源、结构化输出、异步任务、回调/轮询、错误、用量、费用和结果资产上有哪些真实差异？产品层最小稳定合同应收敛哪些共同语义，哪些能力必须由 capability 明示而不能伪统一？

## Done when

- 优先使用供应商官方文档、官方 SDK 与当前 adapter 代码；
- 区分同步 LLM、异步媒体、参考图/首尾帧、编辑、取消和结果时效；
- 提出一个小型候选合同与 capability 列表，并说明无法统一的部分；
- 对现有 Catalog/Route/ProviderAttempt/双账结构给出保留、下沉或简化证据；
- 不选定具体供应商，不使用“万能 OpenAI-compatible”作为结论。

## Resolution

已完成研究并产出 `references/analysis/lightweight-generation-spine-research-2026-07-24/03-supplier-api-adapter-contract-research.md`：

- 以 Open CLI 检索和实读首发已有/候选供应商官方 API、SDK 文档，并记录火山方舟部分页面的 Browser Bridge 降级边界；
- 对照当前 Ark、Tuzi、AI SDK runner、Catalog、RouteSnapshot、ProviderAttempt、OwnedAsset 和双账本代码，区分代码现状、官方事实与推断；
- 给出同步/异步双端口、接单三态、素材语义角色、原生证据、资产托管门槛和版本化 capability 的最小候选合同；
- 明确结构化输出、参考素材组合、进度、取消、计费维度、错误和结果时效等不可伪统一项；
- 未选择具体供应商，未把 OpenAI-compatible 当作能力继承机制，未修改产品代码。
