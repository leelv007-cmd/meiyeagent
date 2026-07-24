---
title: "锁定首发产品范围与退役清单"
parent: "../map-lightweight-personalized-generation-spine.md"
labels:
  - wayfinder:grilling
status: closed
closed_at: 2026-07-24
blocked_by:
  - "综合主干偏差、可复用资产与候选方案"
---

## Question

轻量主干首发必须保留哪些用户能力，哪些移为可选模块，哪些冻结不再投入，哪些在完成数据迁移与验证后退役？

答案必须分别覆盖创作、素材/身份、成品、供应管理、CRM/线索、发布/交接、Pro Studio、治理/恢复和后台，并说明不会丢失的用户数据与能力。

## Resolution

用户在收到完整推荐范围后回复“继续”，确认以“复用优先、边界受限”作为首发范围基线：

| 产品面 | 首发决定 | 数据与能力边界 |
| --- | --- | --- |
| 创作 | **保留**一个 Composer，支持一句话、示例或素材发起文案、图片、视频任务；展示可检查的业务 Brief；首次只交一个主推荐；支持基于结果继续调整 | 不保留第二创作入口、旧 copy stream 或把模型/Provider/工作流暴露给普通用户 |
| 素材与身份 | **保留**身份、品牌/门店事实、已授权素材、来源、版本、期限和撤权；每次任务冻结实际使用的 revision | 现有身份、门店资料、事实和素材不得因收缩丢失；重复真相在后续领域票中迁移为唯一 owner 与只读投影 |
| 成品 | **保留**一个用户可见成品真相、版本、历史、找回、下载/导出、基于此再创作和反馈 | 以现有 `ContentPackage` 为迁移基线；是否改名或进一步收缩留给成品合同票 |
| 供应管理 | 首发每模态只使用少量已验证 binding 和小 adapter；保留接单三态、ProviderAttempt、资产托管以及 ProductUsage/ProviderCost 两种事实 | 动态多供应路由、BYOK、供应池、复杂 Catalog/Admin 与自动 fallback 移出首发主干 |
| CRM/线索 | **移出首发**；不建设客户表、自动线索、经营台账或复杂归因 | 已有线索/经营信号数据先保持只读或提供导出，完成消费者与数据迁移前不删除 |
| 发布/交接 | 首发只保留下载、导出和必要的人工交接记录 | 自动发布、广告投放、账号运营和复杂发布治理作为独立可选能力，不阻塞成品生成 |
| Pro Studio | **插件化**，只通过成品/资产合同接入 | 必须退出首发主进程的 import、boot、迁移、权限和故障域；仅隐藏菜单不算插件化 |
| 治理与恢复 | **保留最小必要语义**：租户隔离、服务端重绑、权利/dataClass、幂等、未知接单恢复、长任务找回、删除不复活、费用事实 | 通用治理平台、重复 durable 机制、长期双写和多套恢复控制面不进入首发 |
| 后台 | 只保留首发 Prompt/Recipe、provider binding、价格和故障诊断所需的最小配置 | 大型供应、集成、发布、CRM 和通用 Agent 管理后台冻结或独立部署 |
| 长期偏好 | 反馈事件可以记录，但自动长期偏好激活 **deferred** | 明确确认、撤销、作用域、删除不复活和评测门完成前，不让偏好自动影响下一任务 |

冻结新增：

- legacy ProductService、旧 CreativeJob copy stream、未挂载 CreationShelf/VideoWorkflowLauncher；
- 新 Provider、通用 Recipe/Capability DSL、Agent/graph runtime、向量记忆、知识图谱；
- CRM、自动发布、Pro Studio 和复杂供应控制面在首发主进程中的新依赖。

退役候选：

- 重复 Web/Core 提交合同、旧结果 stream、旧入口 E2E、已返回 410 的兼容 handler；
- Work/Task/CreativeJob/Package 的重复执行状态 owner；
- legacy/P1 双 ProductService 与已经完成迁移的兼容代码；
- 仍被主进程装配的 CRM、发布、集成、Pro Studio 和供应控制 wiring。

所有退役必须先完成真实消费者遥测、在途任务盘点、用户数据迁移/只读窗口、替代门禁和可回滚验证。本决议不授权删除产品代码、数据库记录或用户资产。
