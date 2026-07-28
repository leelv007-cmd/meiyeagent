# 票 04 · 抖音诚实标注为未接入
> 建设面: D10 诚实标注/真接 ｜ 决策: DEC-DOUYIN-HONEST ｜ Blocked-by: 无（可立即启动）

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "04",
  "decisionIds": [
    "DEC-DOUYIN-HONEST"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-HARDCODED-ADAPTER"
  ],
  "contractIds": [],
  "blockedBy": [],
  "closureEvidence": [
    "docs/evidence/contentpackage/ticket-04/README.md",
    "docs/evidence/contentpackage/ticket-04/status-evidence.json",
    "docs/evidence/contentpackage/ticket-04/continuous-douyin-honest-labeling.webm",
    "docs/evidence/contentpackage/ticket-04/01-admin-recorded-not-integrated.png",
    "docs/evidence/contentpackage/ticket-04/02-desktop-settings-not-integrated.png",
    "docs/evidence/contentpackage/ticket-04/03-mobile-settings-not-integrated.png",
    "docs/evidence/uiux-cutover/s4-mobile-publishing-settings-governance.md"
  ],
  "resolution": "completed",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **D10（已拍板，confirmed）**：抖音在 pilot 触发点前**只诚实标注、不真接**（`docs/reviews/stage-diagnosis-2026-07-14/07-decision-log.md:107`；spec User Story 21 + §7 交互决策"抖音诚实标注"）。拍板动作 = 把 `main.ts:334` 的 `RecordedDouyinAdapter` 及目录/文档里"只差 Key"式表述改为诚实标注「未接入（硬编码 recorded）」，与真能实现的能力区分开。
- **装配层事实（已核实未漂移）**：生产装配硬编码 recorded 壳——`apps/core/src/main.ts:334` `douyin: new RecordedDouyinAdapter()`（票面锚点，实核未漂移）；`apps/core/src/job-worker.ts:199` worker 装配同样硬编码（票面未列，实核补充）。该 adapter 默认返回 `recorded_not_configured`（`apps/core/src/p1/integrations/douyin.ts:22-26,32-37`）。**产品没有任何一处能查询到这个事实**：`foundation-module.ts:444-485` 的 integrations 查询分发没有 runtime/接入状态 action，前端想显示"未接入"只能写死——写死又是另一种不诚实。
- **商户目录冒充可用**：`/settings/connections` 外部连接目录把抖音卡与真能用的飞书/模型 BYOK 并排呈现（`mkfast-template-main/src/p1/integration-settings.tsx:115-142`），描述为"发布与数据观测能力独立授权、独立启停"（`project.inlang/messages/zh.json:1377`）+ "粘贴 OAuth 凭据 JSON"输入框（`zh.json:1479`）。商户贴真 OAuth、开能力开关、走完 confirm→submit 全流程后，才在提交结果里撞到 `rejected_before_accept` → 归一为"需要人工处理"（`application-service.ts:2108-2113`，`zh.json:1526`）+ 内部错误码 `recorded_not_configured`（`application-service.ts:2126`）——全程没有一处告诉商户"这个能力根本未接入"。
- **手机端是行为版"只差 Key"**：`mkfast-template-main/src/product/mobile-action-book.tsx:732-739` 的 `l1Eligible` 只查"连接可用 + 抖音 variant + artifact 齐备"，不知道装配是 recorded；说明文案明写"L1 仅在抖音视频版本、已保存视频素材和已验证发布连接都齐备时开放"（`zh.json:1617`）——**齐备 ≠ 可用**，齐备了也是 recorded 壳。
- **文档表述**：`docs/specs/beauty-content-agent-p1-spec.md:34` "抖音实现条件式 Publish/Observe 完整骨架，真实应用、Scope 和接口实证只控制生产激活"——暗示只差激活实证；`docs/reviews/historical-review-implementation-reconciliation-2026-07-14.md:219` 已裁定"没有正式 Adapter 的能力不得写成'只差 Key'"。
- **票界**：本票只做诚实状态标注（后台 evidence status + 商户侧「未接入」标识 + 目录/文档表述订正），**不接**真实 Publish/Observe（spec Out of Scope 明列，等 pilot 触发点）、不做 adapter 装配点选（票 20）、不动 L3 人工发布、不动抖音内容 variant（那是真实 LLM 能力）。本票不增加"真实跑通链路数"、不计产品进度——它是 D10 防 done 语义坍缩的诚实化动作。

## 现状代码入口（实核 file:line）

- `apps/core/src/main.ts:334`：HTTP 壳生产装配 `douyin: new RecordedDouyinAdapter()`。票面锚点未漂移。
- `apps/core/src/job-worker.ts:198-203`：worker 侧 `IntegrationApplicationService` 装配，`:199` 同样硬编码 RecordedDouyinAdapter。
- `apps/core/src/p1/integrations/douyin.ts:11-120`：RecordedDouyinAdapter 本体；`:22-26` publish 默认 `rejected_before_accept`/`recorded_not_configured`，`:32-37` refreshOAuth 默认 `reauthorization_required`。测试钩子（setNextPublishResult 等）被 recorded 合同测试广泛使用，不得破坏。
- `apps/core/src/p1/integrations/contracts.ts:433-461`：`DouyinAdapterPort` 契约，当前**无执行模式声明**——service 无法区分 recorded/live。
- `apps/core/src/p1/integrations/application-service.ts:65-79`：依赖注入，`:73` `douyin?: DouyinAdapterPort`；`:2087-2139` submit 对 recorded 结果的归一（manual_required + `l3_handoff` fallback）——**该行为本票保持不变**。
- `apps/core/src/p1/integrations/foundation-module.ts:230-239`：`publicConnection` 投影（只滤 secretRef）；`:444-485` query 分发（connections / douyin_projection / douyin_operations_snapshot / strict_byok_options 先例），诚实状态查询的挂点。
- 查询链路：`mkfast-template-main/src/p1/client.ts:40` `queryP1` → `mkfast-template-main/src/routes/api/core/p1/query.ts:7` BFF 转发 → `apps/core/src/server.ts:859` `p1/query` 路由 → 同一 Application Service。`server.ts:145,152` 抖音回调通道保持不动。
- `mkfast-template-main/src/p1/integration-settings.tsx:98-159`：PROVIDERS 目录（`:115-142` 抖音卡）；`:161-192` STATUS_LABELS 全是连接生命周期状态，**无「未接入」概念**；`:391-529` 连接卡；`:612-900` 抖音发布表单区（锚 `:695` `integration_douyin_publish_title`）；`:1407-1536` IntegrationSettings 与创建连接表单。
- `mkfast-template-main/src/p1/settings-view-model.ts:48-71`：`IntegrationConnectionView` 无接入状态字段；`:453` `normalizeConnections`。`use-integration-settings.ts:130-195` 查询装配。
- `mkfast-template-main/src/product/mobile-action-book.tsx:401-406,732-739,1500-1531,633-711`：douyinConnection 筛选、l1Eligible、L1/L3 按钮与不可用说明、confirm/submit L1 流。
- `mkfast-template-main/src/routes/admin/integrations.tsx:1-7`：管理面 integrations 页现仅挂 AdminFeishuToolControl——后台 evidence status 的落点。词汇先例：`mkfast-template-main/src/p1/admin-model-control.tsx:205-218` + `zh.json:2011-2013`（"Recorded 结果只证明契约与回归链路"）。
- i18n：`project.inlang/messages/zh.json:1377,1479,1526,1614,1617`（en.json 对应键同步）。
- 文档：`docs/specs/beauty-content-agent-p1-spec.md:34`。

## 改造方案（步骤级）

1. **契约层先声明执行模式**：`contracts.ts` 给 `DouyinAdapterPort` 增加必填 `readonly executionMode: 'recorded' | 'live'`；`douyin.ts` RecordedDouyinAdapter 声明 `executionMode = 'recorded'`。全仓仅此一个 implements（已核实），测试 doubles 全部 `extends RecordedDouyinAdapter`（`integration.test.ts:1490,1760,1826,1907`）自动继承；未来任何真实 adapter 必须显式声明 `'live'`，编译期防"配了 Key 仍是 recorded 壳"再次冒充。
2. **Application Service 只读查询**：`application-service.ts` 新增查询 `getDouyinIntegrationStatus()`——从注入 adapter 读 executionMode，返回结构化事实（形如 `{ provider: 'douyin', integrated: false, executionMode: 'recorded' }`；adapter 缺席同样 `integrated: false`）。`integrated` 只有 `executionMode === 'live'` 时为真。**不改任何命令行为**：createConnection / confirm / submit / observe / refresh 的合同（含 manual_required + l3_handoff 归一、幂等、审计）原样保留。
3. **模块分发暴露**：`foundation-module.ts` query switch 新增 `case 'douyin_integration_status'`（命名从实现时该 module 现有风格，参照 `strict_byok_options` 先例），owner 与 admin 上下文均可读。不新增 seam——仍是同一 Product Core Application Service 经同一 P1 模块暴露，属 spec §6 "Admin config queries：激活证据状态" 的既定接口面。
4. **商户侧「未接入」标识**：`use-integration-settings.ts` 增加该查询；`settings-view-model.ts` 增加 normalize 与 view 类型；`integration-settings.tsx` 在抖音目录卡、每张抖音连接卡、抖音发布表单区，当 `integrated: false` 时渲染「未接入」Badge + 人话说明（官方发布与数据观测尚未接入；试点开始前配置凭据也不会真实发布；可使用 L3 人工发布）。标注先于凭据输入出现；连接表单保持可用（recorded 合同与 e2e 依赖）。商户侧只说「未接入」，**不裸露 recorded 术语**（规范化状态标签：raw code 归后台）。
5. **手机端订正**：`mobile-action-book.tsx` 的 `l1Eligible` 纳入接入状态（未接入 ⇒ L1 提交按钮禁用 + 「未接入」说明 + 引导 L3）；L1 入口保持可见不隐藏（「发布准备」术语：路线不可用要明示，不静默降级切换）；L3 创建交接包行为与文案不变。
6. **后台 evidence status**：`routes/admin/integrations.tsx` 增加抖音连接器只读状态区，显示「未接入（硬编码 recorded 装配）」+ 装配来源说明 + "pilot 触发点前不接入"口径，词汇与 admin models 页 evidence 家族一致。只读投影，无任何配置写入（配置持久层与装配点选分别是票 05/20 的事，本票不碰）。
7. **i18n 双语订正**：`zh.json`/`en.json` 修改 `integration_douyin_description`（不再是"独立授权、独立启停"的可用式口吻）、`mobile_action_l1_unavailable_description`（废"齐备即开放"话术），新增未接入 badge/alert/后台状态键。
8. **文档表述订正**：`docs/specs/beauty-content-agent-p1-spec.md:34` 该句后补 D10 现状括注（生产装配为硬编码 recorded，pilot 前对商户诚实标注「未接入」，不得以"只差 Key/只差激活"表述冒充可用）；复查现行文档（specs/CONTEXT/evidence 目录性文件）无残余同类表述；评审与历史留证文档不改写。
9. **测试（打 Application Service 外部行为）**：core 侧 `integration.test.ts`/`foundation-module.test.ts` 断言装配 RecordedDouyinAdapter 时查询返回 `integrated: false` + `executionMode: 'recorded'`，且 submit 行为回归（仍 manual_required + l3_handoff，不因标注改变）；`http.test.ts` 经 HTTP 边界查同一事实；前端 `settings-view-model.test.ts` 覆盖 normalize；e2e 扩 `tests/e2e/specs/p1-integrations-journey.spec.ts`（连接页可见「未接入」）。测试只作工程护栏，不作为 DoD。

涉及文件：`apps/core/src/p1/integrations/contracts.ts`、`douyin.ts`、`application-service.ts`、`foundation-module.ts`、`integration.test.ts`、`foundation-module.test.ts`、`http.test.ts`；`mkfast-template-main/src/p1/{use-integration-settings.ts,settings-view-model.ts,settings-view-model.test.ts,integration-settings.tsx}`、`src/product/mobile-action-book.tsx`、`src/routes/admin/integrations.tsx`、`project.inlang/messages/{zh,en}.json`、`tests/e2e/specs/p1-integrations-journey.spec.ts`；`docs/specs/beauty-content-agent-p1-spec.md`。

## DoD（全部必须是用户可见行为）

- 商户打开 `/settings/connections`，抖音卡第一眼可见「未接入」标注与说明（官方发布/观测尚未接入、试点前配置凭据也不会真实发布、L3 人工发布可用），且该状态来自后端查询而非前端写死。**对照证据（当前 vs 改造后）**：改造前同一页面为"发布与数据观测能力独立授权、独立启停"+ OAuth 粘贴框、无任何未接入提示（`zh.json:1377` 现状），与改造后截图并排存档。
- 已建抖音连接的商户在连接卡与"抖音发布与同步快照"表单区同样看到「未接入」；发布提交路径行为不变（仍归一为"需要人工处理"+ L3 回退），但商户在贴凭据/提交**之前**即被告知未接入，不再是撞墙后对着"需要人工处理"猜原因。
- 商户在手机 action book 发布段看到 L1 抖音入口带「未接入」状态、提交按钮禁用，说明不再是"齐备即开放"（`zh.json:1617` 现状对照）；L3 人工发布一键照常可用。
- 平台管理员在管理模式 `/admin/integrations` 看到抖音连接器状态「未接入（硬编码 recorded 装配）」与证据口径说明，用语与 admin models 页 evidence 家族一致；页面无任何伪装成可配置的写入口。
- **防过度标注**：内容库/创作里的抖音 variant（三平台版本文案、`create_douyin_variant`）不受影响、无未接入标注——variant 是真实能力，未接入的只是抖音官方连接。
- 全仓商户可见文案无"只差 Key/配好凭据即可用"式抖音表述；`docs/specs/beauty-content-agent-p1-spec.md:34` 带 D10 现状括注。
- 证据以真实 dev 环境页面走查产出（桌面 settings、手机发布段、admin 页改前/改后截图，落 `docs/evidence/`）；仅后端查询存在、单测绿或 fixture 渲染截图一律不得关票（D01 口径）。

## Blocked-by / Blocks

- **Blocked-by**：无实施前置。不依赖票 01（E1 聚合合同）——本票不触 ContentPackage 聚合本体，只动连接/发布路线的状态标注与文档。与票 03（BYOK 接真实）同属 D10 双动作，可并行，互不共享 adapter。
- **Blocks**：**票 20**（adapter 装配切换 + 模型激活真实探针）——本票的 `executionMode` 契约声明与接入状态查询是票 20 "装配点选后状态如实回显"的事实底座；pilot 后换真实 adapter 时同一查询自动翻转，前端标注无需二次改造。**票 22**（一条真实链路留证）——验收演示界面必须不存在冒充可用的抖音入口，否则留证材料自带不诚实。票 11（三平台 variants）不被阻塞，但"variant 可用 vs 官方连接未接入"的区分口径以本票为准。

## 风险与回退

- **过度标注砍掉真实能力**：把抖音 variant/文案误标为未接入等于自断 E4。控制：标注只挂 `provider === 'douyin'` 的外部连接与 L1 发布路线；内容 variant 面不读该状态；DoD 设防回归条款。
- **契约必填字段波及**：`DouyinAdapterPort` 加必填 `executionMode` 影响所有实现。已核实全仓仅一个 implements、测试 doubles 全部 extends；漏网者编译期即暴露——这正是该字段的目的。
- **前端写死"未接入"的诱惑**：跳过后端查询直接改文案最快，但那是用一个新谎替旧谎（装配换真后标注不会翻转）。控制：标注必须由 `executionMode` 运行时事实驱动，code review 检查无硬编码状态。
- **静默降级/下架**：把 L1 按钮藏掉违背「发布准备」术语（路线失败不得静默切换选择）与 D10 本意（诚实标注 ≠ 下架，条件启用能力仍在 P1 范围）。口径：入口可见 + 明示未接入 + L3 显式可选。
- **recorded 合同测试破坏**：RecordedDouyinAdapter 的 setNext* 测试钩子与 recorded publish/observe 合同被大量测试依赖。控制：只加字段与查询，不改任何既有方法行为；核心回归 = submit 归一行为逐条重跑。
- **回退**：本票是纯加法（契约字段 + 只读查询 + 前端标注 + 文案），回退 = 撤前端标注与查询 action，不影响任何命令路径与已存数据；文档括注保留（陈述的是装配事实，与回退无关）。
