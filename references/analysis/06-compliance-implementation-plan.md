> ⚠️ **2026-07-07 v1.5 覆盖批注**：仍为合规底稿，四处升级——①备案/登记确认为强制、绑定"落地触发点"（不预设，ADR-0005），L485"需进一步评估"已有结论；②义务主体三层重构与 17 条我方自身义务清单见 `plan-review-2026-07-07/03-合规与平台政策验证.md` 与合集 v1.5 第 09 章；③医美接入=资质准入制·轻量版（ADR-0004），线上 Preflight 纯提醒，行为红线硬停；④L2 浏览器辅助已移出 P0。

> ⚠️ **2026-07-18 链接审计批注**：本文所引本地研究基建 `references/INDEX.md`、`references/docs/official/`、`references/source-manifest.json`、`references/scripts/*.mjs` 及旧编号文件计划为 2026-07-06 旧工作区（美业内容/）历史口径，未随 00-16 系列迁入本工作区、现已不存在。当前调研入口以 `CONTEXT.md` 权威链与 `references/analysis/README.md` 为准；官方平台/合规规则需要时按现行流程联网核实。正文结论不受影响。

# Compliance Implementation Plan

审查日期：2026-07-06  
审查对象：美业到店 + 医美/医疗资质准入制商家创作副驾 P0  
结论性质：产品与工程实施口径，不替代法律意见；正式商业上线前仍需按公司主体、部署地区、模型提供方式做法务复核。

> 2026-07-07 覆盖更新：本文早期“非医美硬拒绝”口径已被 `docs/adr/0004-qualified-access-medical-content.md` 细化。P0 支持资质准入的医美/医疗正常内容创作；创作阶段不做一刀切拒绝，保存、导出、发布包交接或 L1 官方提交前展示 Publish Compliance Preflight；L2/browser prep 不进 P0。

## 结论

P0 必须把 `Compliance Gate` 做成 Core API/Postgres 的一等域能力，不能只依赖 Agent prompt、Mastra Guardrails 或平台发布审核。

安全实施口径：

1. 所有内容在保存、导出、发布包生成、平台提交前都必须经过合规检查。
2. AIGC 显式标识和隐式标识是默认能力；用户不得要求删除、伪造、隐藏标识。
3. 医美、医疗、注射、激光、手术、药械等内容进入 Regulated Content Mode：允许创作和发布包准备，但发布前必须核验提醒并留痕。
4. 广告风险检查不仅是敏感词过滤，还要核验价格、优惠、效果、素材授权和证据来源。
5. 所有生成、修改、导出、发布、核验提醒、硬停止、人工确认都要写审计记录。广告相关记录默认保存不少于 3 年；如未来支持无显式标识导出，相关日志至少保存 6 个月。

## 适用范围

P0 支持：

- 美甲、美睫、美发、SPA、生活美容的非创伤性、非侵入性内容。
- 医美、医疗、诊疗、注射、激光、手术、药品、医疗器械等受监管内容的草稿生成、改写、素材整理、拍摄清单和发布包准备。
- 门店真实照片、环境照片、价格表、好评截图、活动信息的整理和平台适配。
- 小红书、抖音、点评/美团、微信公众号发布包。
- 人工确认后的 L3 发布包，以及通过平台能力验证后的有限 L1 发布。

P0 不支持：

- 未经 Publish Compliance Preflight 的医疗美容、诊疗、治疗、注射、激光、手术、药物、医疗器械相关内容发布、导出、官方提交或 L2 备稿。
- 无人值守代运营、绕过平台验证、自动私信承诺价格/疗效/退款。
- 伪造顾客案例、伪造医生/专家/资质、虚构优惠、虚构低价、虚假评价。
- 删除、隐藏、篡改 AIGC 标识。

## 法规和官方依据

本地快照：

- `references/docs/official/compliance/cac-generative-ai-measures.md`
- `references/docs/official/compliance/cac-deep-synthesis.md`
- `references/docs/official/compliance/cac-ai-labeling-measures-notice.md`
- `references/docs/official/compliance/cac-ai-labeling-measures.md`
- `references/docs/official/compliance/gb-45438-2025.md`
- `references/docs/official/compliance/internet-advertising-measures.md`
- `references/docs/official/compliance/advertising-absolute-terms-guide.md`
- `references/docs/official/compliance/medical-beauty-service-measures.md`
- `references/docs/official/compliance/medical-advertising-supervision-guide.md`
- `references/docs/official/compliance/medical-advertising-identification-guide.md`
- `references/docs/official/compliance/personal-information-protection-law.md`

官方链接：

- https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm
- https://www.cac.gov.cn/2022-12/11/c_1672221949354811.htm
- https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm
- https://std.samr.gov.cn/gb/search/gbDetailed?id=301E0388CB75788DE06397BE0A0AE1B4
- https://www.moj.gov.cn/pub/sfbgw/flfggz/flfggzbmgz/202306/t20230620_481045.html
- https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/ggjgs/art/2023/art_64279265c896452f8f638f2de12b8003.html
- https://www.nhc.gov.cn/wjw/c100221/202201/d7e8fa33a26b425da98d69fb04191699.shtml
- https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/ggjgs/art/2025/art_cd56662cf13b4ad59eabfe31cb1122e1.html
- https://www.samr.gov.cn/ggjgs/tzgg/art/2025/art_fe4ab107d0784ee7afd212d16e6345e8.html
- https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm

## 门禁状态

`Compliance Gate` 返回统一状态：

| 状态 | 含义 | 后续动作 |
|---|---|---|
| `pass` | 无阻断项，只有低风险提示 | 可保存、导出或进入发布确认 |
| `warn` | 有轻微风险，需要展示提示 | 用户确认后可继续，记录确认 |
| `needs_review` | 有不确定风险 | 必须人工复核，不允许自动发布 |
| `block` | 命中硬停止项 | 拒绝生成、导出或发布，并给安全替代表述 |

严重度：

- `P0_BLOCK`: 违法、虚假、伪造资质、未授权素材、删除标识、自动化绕过、保证疗效/安全性。
- `P1_REVIEW`: 受监管内容发布前核验、疗效边界、价格证据不足、健康/皮肤问题措辞、疑似顾客个人信息。
- `P2_WARN`: 广告感过强、平台标识提醒、口径不够清楚。
- `P3_INFO`: 风格建议和普通优化项。

## 检查时机

| 时机 | 必做检查 |
|---|---|
| 素材入库 | 来源、版权、顾客授权、肖像/身体部位、敏感个人信息、是否 AI 生成 |
| Content Core 生成前 | 用户意图、门店类型、服务项目是否触发 Regulated Content Mode |
| Platform Variant 生成后 | 平台文案、标题、脚本、价格、广告词、医疗/医美核验提醒 |
| 图片/视频导出前 | 显式 AIGC 标识、隐式元数据、素材授权、人物/案例真实性 |
| Publish Package 生成前 | 合规摘要、风险项、人工发布步骤、平台原生 AI 标识提醒 |
| L1/L2 提交前 | 用户最终确认、账号能力、合规状态未过期、平台限制 |
| 发布后 | 发布链接、状态、用户修改记录、平台拒审/下架原因 |

合规结果必须绑定 `content_version_id` 和 `asset_version_id`。用户改一个字、换一张图、改价格，都要重新检查。

## AIGC 标识

### 规则

2025-09-01 起施行的《人工智能生成合成内容标识办法》要求区分显式标识和隐式标识；文本、图片、音频、视频、虚拟场景都有显著提示要求；下载、复制、导出功能应确保文件包含符合要求的显式标识；文件元数据应添加生成合成内容属性信息、服务提供者名称或编码、内容编号等隐式标识。

P0 采用更保守口径：

- 只要文本、图片、视频脚本、封面、卡片、标题由 AI 生成或实质性改写，就标记 `is_ai_generated=true`。
- 只要 AI 对真实素材做了显著修图、替换、扩图、风格化、合成，就标记 `is_ai_synthesized=true`。
- 发布包内必须显示 AIGC 状态和平台侧操作提示。
- 文件导出必须保留显式标识和隐式元数据；不得提供“移除 AI 标识”功能。
- 如果用户上传第三方 AI 素材但不能证明标识状态，按 `suspected_ai_generated` 处理并要求补标。

### 文本

默认显式标识：

- UI 预览：展示 `AI 辅助生成` badge。
- 发布包：在合规说明中写明“本发布包含 AI 辅助生成内容，发布前请人工核对并按平台规则声明”。
- 文本文件导出：文件头部包含 `AIGC: AI-assisted`、生成时间、内容编号。
- 复制到剪贴板：复制内容附带隐藏不了的发布包说明；如果只复制正文，也在 UI 中提示用户需保留或使用平台原生 AI 标识。

不建议 P0 自动把“AI 辅助生成”塞进每条营销正文首句，因为平台展示规范不同；但发布包和导出文件必须含显式标识，平台提供原生 AI 声明时必须提醒用户勾选。

### 图片和卡片

默认显式标识：

- 画面角落添加可读标识，例如 `AI 辅助生成` 或 `AI 合成图`。
- 标识不得被默认裁剪区域遮挡，不得透明到不可见。
- 如图片只是排版卡片，真实照片未被合成改造，可标记为 `AI 辅助排版`，避免误导成真实场景。

默认隐式标识：

- 写入元数据字段：`aigc=true`、`aigc_type=image/card`、`service_provider`、`content_id`、`asset_id`、`generated_at`、`model_provider`、`model_name`。
- 保留原始素材和导出版本的 hash，用于证明没有替换真实案例。

### 视频和音频

视频默认要求：

- 起始画面和播放器周边/发布包添加显著标识。
- 可在视频末尾追加标识片尾。
- 若含 AI 配音、AI 人声或虚拟人，必须显式说明，不做真人身份混淆。

P0 暂不做：

- 人声克隆。
- 真人换脸。
- 以真实顾客身份生成口播。
- 让虚拟人冒充门店技师、医生、顾客。

### 无显式标识例外

《标识办法》允许在用户协议明确用户标识义务和使用责任后，提供不含显式标识的内容，并依法留存相关日志不少于 6 个月。P0 不开放该能力。原因是：

- 美业营销内容会面向公众传播。
- 早期产品缺少成熟的标识责任转移和平台联动能力。
- 去标识会形成错误产品心智。

## 深度合成

深度合成规定覆盖文本生成、图像生成/增强/修复、视频编辑、语音生成、人脸/人声/姿态操控等。P0 必须建立输入和输出审核，不仅做关键词检测。

硬阻断：

- 生成或替换真实顾客/技师/医生的人脸。
- 克隆真实人的声音。
- 将生活美容效果伪造成医疗/治疗效果。
- 生成“前后对比”但没有真实同一人、同一项目、同一授权。
- 修图到改变服务真实效果，例如把原图手部瑕疵、睫毛长度、发量、皮肤状态改造成不存在的效果。
- 用户要求“看起来像某位真人/网红/明星/顾客”。

人工复核：

- 图片增强、祛噪、调色、裁剪、拼图。
- 顾客脸部、身体局部、纹身、病灶样皮肤状态出现在素材中。
- 好评截图包含头像、昵称、手机号、微信号、订单号。

允许：

- 不改变服务事实的排版、裁剪、色彩轻微校正。
- 门店环境图加字卡。
- 使用授权素材生成封面布局。
- 使用无真人身份指向的插画/背景图。

## 广告语言

### 硬阻断词和表达

以下表达默认 `block` 或 `needs_review`，即使没有完全命中词，也要按语义判断：

| 类别 | 示例 | P0 处理 |
|---|---|---|
| 绝对化 | 国家级、最高级、最佳、第一、顶级、全网最低、全城最低、最安全、最有效 | `block`，除非是有证据的客观时空/销量事实且人工审核 |
| 保证性 | 保证、绝对、100%、永久、一次见效、一定满意、不满意退款但无规则 | `block/review` |
| 医疗疗效 | 治疗、治愈、根治、疗效、有效率、修复疾病、改善病症、无副作用 | `needs_review/block`，医疗广告发布前必须核验证据和审查要求；保证性结论硬停止 |
| 安全断言 | 零风险、无任何副作用、完全不伤、孕妇儿童都能做 | `block` |
| 虚假价格 | 原价虚构、仅剩 N 个名额、全网最低、限时但无截止时间 | `review/block` |
| 误导身份 | 医生推荐、专家认证、官方指定、平台认证但无凭证 | `review/block` |
| 焦虑营销 | 不做就老十岁、脸垮、丑、毁容式对比、容貌羞辱 | `block`，医美/医疗语境不得用容貌焦虑诱导 |

### 替代表述

| 风险表述 | 建议替换 |
|---|---|
| 永久定型 | 更持久的造型效果，具体维持时间因个人情况而异 |
| 全城最低 | 近期体验价，实际价格以门店确认为准 |
| 100% 不伤甲 | 更注重护理与操作细节 |
| 根治皮肤问题 | 帮助提升日常护理体验 |
| 一次见效 | 完成后可观察到造型变化 |
| 绝对安全 | 操作前会沟通注意事项 |
| 医生级护理 | 专注生活美容护理 |

### 价格和优惠

生成价格、套餐、优惠时必须读取结构化价目表，不能从历史文案或模型记忆里猜。

必填字段：

- `price_source`: 价目表、活动表、人工输入。
- `valid_from` / `valid_until`: 活动有效期。
- `included_items`: 套餐包含项。
- `excluded_items`: 不包含项。
- `reservation_required`: 是否预约。
- `store_scope`: 适用门店。
- `inventory_or_quota`: 名额/库存证据，没有证据不得写“仅剩”。

没有结构化证据时，只允许写“可咨询门店确认价格/档期”。

### 广告可识别性

互联网广告管理规则要求广告具有可识别性；体验分享、知识介绍、测评等形式推销商品或服务并附加购买方式时，应显著标明广告。

P0 落地：

- 商家自有账号发布的营销内容默认标记为 `commercial_intent=true`。
- 如果文案写成“测评/体验/科普/避坑”，同时包含预约、购买、团购、加微、优惠链接，合规提示必须提醒“可能需要广告标识”。
- 不生成伪顾客口吻的虚假种草，不伪装第三方测评。

## Regulated Content Mode

国家卫健委《医疗美容服务管理办法》将医疗美容定义为使用手术、药物、医疗器械以及其他创伤性或侵入性医学技术方法，对人的容貌和人体各部位形态进行修复与再塑。P0 不再排除这类正常内容创作需求，而是把它们纳入 Regulated Content Mode。

### 触发项目

命中以下任一类，P0 进入 Regulated Content Mode：

- 手术、开刀、缝合、麻醉、植入、抽脂。
- 注射、水光针、玻尿酸、肉毒、胶原针、美白针、溶脂针。
- 线雕、埋线、热玛吉、超声刀、射频紧肤等强医疗美容语境。
- 激光、光子嫩肤、强脉冲光、激光脱毛、去纹身、祛疤、祛痣、微针。
- 医疗器械、药品、处方、诊疗、医生、医师、护士、病历、适应症、禁忌症。
- 治疗痤疮、治疗皮炎、修复疾病、祛斑治斑、抗炎、治疗脱发。
- 医疗美容广告、医疗科普引流、医疗机构推介、医生案例。

### 处理方式

- 允许草稿生成、改写、素材整理、拍摄清单和 L3 发布包准备。
- 保存、导出、发布包交接、L2 备稿、L1 官方提交前必须执行 Publish Compliance Preflight。
- Publish Compliance Preflight 必须提醒商家核验医疗机构执业许可、诊疗科目/项目范围、医疗广告审查证明、平台规则、AIGC 标识、顾客素材授权和人工确认。
- 系统不替商家判断最终法律合规，不输出“已合法/可放心发布”等保证性结论。
- 对伪造资质、未授权顾客案例、移除 AIGC 标识、绕过平台审核、疗效/安全性保证、治愈率/有效率承诺等请求硬停止。

### 人工复核词

以下词可能在生活美容中有非医疗用法，但必须复核语境：

- 修复、抗衰、祛斑、祛痘、敏感肌、屏障、炎症、毛囊、头皮问题。
- 中医、经络、排毒、淋巴、理疗、康复。
- 仪器、能量、导入、焕肤、刷酸。
- 前后对比、案例、效果图。

### 生活美容低风险范围

允许的表述应保持生活美容定位：

- 皮肤清洁、基础护理、保湿、放松、舒缓体验。
- 美甲、美睫、修眉、化妆、发型设计、头皮清洁体验。
- SPA 放松、身体护理体验、门店环境、服务流程、预约说明。

生活美容内容不要写诊疗、治疗、医学功效，也不要暗示替代医疗服务；真实医美/医疗商家则必须进入 Regulated Content Mode。

## 素材授权和个人信息

Real Asset Library 入库必须记录：

- `source_type`: merchant_upload / customer_provided / staff_shot / platform_screenshot / generated。
- `rights_owner`: 门店、员工、顾客、第三方。
- `consent_status`: unknown / pending / granted / revoked / not_required。
- `consent_scope`: internal_reference / publish_package / public_marketing / paid_ads。
- `contains_person`: none / hand_only / face / body / voice。
- `contains_sensitive_personal_info`: true/false。
- `minor_involved`: true/false。
- `redaction_status`: none / required / completed。

规则：

- 顾客脸、身体特征、声音、昵称、头像、手机号、微信号、订单号默认需要授权或脱敏。
- 未成年人素材不进入 P0 公开营销。
- 好评截图必须遮挡头像、昵称、手机号、订单号，除非有明确授权。
- 撤回授权后，禁止继续用于新内容；已发布内容进入下架/替换提醒队列。

## 拒绝规则

硬停止时，产品必须给安全替代方案，而不是只说“不行”。

| 用户请求 | 拒绝原因 | 替代方案 |
|---|---|---|
| 帮我写水光针/热玛吉/玻尿酸促销 | 受监管内容，发布前需核验资质、广告审查、平台规则和素材授权 | 生成草稿并附 Publish Compliance Preflight；如果商家无法提供核验材料，改写为生活美容补水护理体验内容 |
| 把顾客照片修得像术后效果 | 伪造效果，可能涉及深度合成和虚假宣传 | 做真实前后拍摄规范和排版 |
| 去掉 AI 标识 | 标识合规风险 | 保留标识或使用平台原生 AI 声明 |
| 写“全城最低/100% 不伤甲/永久定型” | 绝对化和保证性广告风险 | 写“近期体验价/更注重护理/更持久造型” |
| 用医生口吻推荐项目 | 医疗身份和广告风险 | 改为门店服务说明或技师护理建议，避免医疗身份 |
| 生成顾客好评截图 | 伪造评价 | 生成邀评话术或好评整理模板 |
| 自动帮我发小红书并过验证码 | 平台自动化和账号风险 | 生成发布包并打开人工发布 checklist |

## 数据模型

### `compliance_rule_sets`

| 字段 | 含义 |
|---|---|
| `id` | 规则集 ID |
| `version` | 规则版本，如 `beauty-compliance-2026-07-06` |
| `jurisdiction` | `CN` |
| `scope` | `aigc_labeling` / `deep_synthesis` / `ad_language` / `regulated_content` / `asset_rights` |
| `source_links` | 本地快照和官方链接 |
| `effective_from` | 生效日期 |
| `status` | draft / active / retired |

### `compliance_checks`

| 字段 | 含义 |
|---|---|
| `id` | 检查 ID |
| `workspace_id` | 租户 |
| `target_type` | asset / content_core / platform_variant / publish_package / publish_job |
| `target_id` | 被检查对象 |
| `target_version_id` | 被检查版本 |
| `rule_set_version` | 使用的规则版本 |
| `status` | pass / warn / needs_review / block |
| `checked_at` | 检查时间 |
| `checked_by` | system / user / reviewer |
| `model_provider` | 如使用 LLM 辅助检查 |
| `model_trace_id` | 模型调用追踪 |
| `input_hash` | 检查输入 hash |
| `output_hash` | 检查输出 hash |

### `compliance_findings`

| 字段 | 含义 |
|---|---|
| `id` | 风险项 ID |
| `check_id` | 对应检查 |
| `category` | aigc_label / deep_synthesis / ad_language / regulated_content / asset_rights / privacy |
| `severity` | P0_BLOCK / P1_REVIEW / P2_WARN / P3_INFO |
| `matched_text` | 命中文本，必要时脱敏 |
| `evidence` | 命中原因、规则、来源 |
| `suggestion` | 替代表述或处理建议 |
| `decision` | unresolved / accepted / fixed / rejected / overridden |
| `resolved_by` | 用户或审核人 |
| `resolved_at` | 处理时间 |

### `aigc_label_records`

| 字段 | 含义 |
|---|---|
| `id` | 标识记录 |
| `artifact_type` | text / image / video / audio / package |
| `artifact_id` | 内容或文件 |
| `is_ai_generated` | 是否 AI 生成 |
| `is_ai_synthesized` | 是否 AI 合成 |
| `explicit_label_status` | inserted / user_declared_platform_native / missing / not_applicable |
| `implicit_label_status` | inserted / unsupported_format / missing |
| `label_text` | 显式标识内容 |
| `metadata_fields` | 写入的元数据 |
| `file_hash_before` | 写入前 hash |
| `file_hash_after` | 写入后 hash |
| `created_at` | 时间 |

### `asset_rights`

| 字段 | 含义 |
|---|---|
| `asset_id` | 素材 |
| `rights_owner` | 权利人 |
| `consent_status` | unknown / pending / granted / revoked |
| `consent_scope` | 使用范围 |
| `consent_evidence_asset_id` | 授权截图/合同/录音 |
| `expires_at` | 授权到期 |
| `revoked_at` | 撤回时间 |
| `notes` | 备注 |

### `user_confirmations`

| 字段 | 含义 |
|---|---|
| `id` | 确认记录 |
| `workspace_id` | 租户 |
| `action_type` | export / publish_package / platform_submit / override_warning |
| `target_id` | 对象 |
| `risk_summary` | 用户看到的风险摘要 |
| `confirmed_by` | 用户 |
| `confirmed_at` | 时间 |
| `ip_address_hash` | 脱敏 IP |
| `user_agent_hash` | 脱敏 UA |

## Agent 和 Core API 分工

Agent Service 可以做：

- 生成替代表述。
- 解释风险。
- 给出平台风格改写。
- 调用 `compliance.check` 工具。

Agent Service 不能做：

- 自己判定最终合规通过。
- 跳过合规门禁保存或发布。
- 修改合规记录。
- 删除或隐藏 AIGC 标识。
- 从记忆里猜价格、优惠、资质。

Core API 必须做：

- 规则版本管理。
- 确定性规则扫描。
- LLM 辅助分类的结果落库。
- 审计记录。
- 发布前状态机检查。
- 用户确认和人工复核。

## 验收集

P0 上线前至少建立 120 条合规评测样本：

| 类别 | 数量 | 要求 |
|---|---:|---|
| 正常生活美容 | 20 | 不误杀常见美甲、美发、美睫、SPA |
| 广告绝对化 | 20 | `最/第一/100%/永久/保证` 等必须命中 |
| Regulated Content Mode | 25 | 水光针、热玛吉、线雕、注射、激光、微针等必须触发发布前核验提醒；伪造资质、未授权案例、去标识、绕审、疗效保证必须硬停止 |
| 价格优惠 | 15 | 无价目表时不得生成具体价格/名额 |
| AIGC 标识 | 15 | 文本/图片/视频/发布包标识注入率 100% |
| 素材授权 | 15 | 顾客图、好评截图、未成年人、撤回授权 |
| 平台发布 | 10 | L3 包、微信草稿、抖音包、点评包均保留合规摘要 |

硬性验收：

- AIGC 标识注入率：100%。
- 受监管内容发布前核验提醒覆盖率：100%。
- 未授权顾客素材公开导出：0。
- 合规检查审计记录覆盖率：100%。
- 广告价格无来源生成：0。
- 所有 `P0_BLOCK` 不能被普通用户 override。

## P0 实施顺序

1. 建 `compliance_rule_sets`、`compliance_checks`、`compliance_findings`、`aigc_label_records`、`asset_rights`、`user_confirmations`。
2. 实现规则包 `beauty-compliance-2026-07-06`，覆盖 AIGC、Regulated Content Mode、广告、价格、素材授权。
3. 接入 Content Core 和 Platform Variant 保存前检查。
4. 接入图片/卡片导出标识和 metadata 写入。
5. 接入 Publish Package 合规摘要和人工确认。
6. 建 120 条验收集并纳入 CI 或发布前手工回归。
7. 再做 L1/L2 发布路线 POC，不能先绕过合规。

## 对外产品口径

可以说：

- “内置 AI 标识、广告风险、Regulated Content Mode 和素材授权检查。”
- “发布前展示风险和替代表述，用户确认后再导出发布包。”
- “医美/医疗等受监管内容可以创作，但发布前会提示核验资质、广告审查、平台规则、素材授权和 AIGC 标识。”

不能说：

- “自动保证合规。”
- “规避平台 AI 标识。”
- “自动发布医疗美容广告。”
- “自动生成真实顾客案例/好评。”
- “一键去水印/去标识/过审。”

## 后续风险

- 若产品向中国境内公众直接提供生成式 AI 服务，需要进一步评估算法备案、安全评估、模型提供者合规和应用商店上架材料。
- 医美/医疗客户必须始终走 Regulated Content Mode；医疗机构资质、诊疗科目、广告审查证明、医疗广告认定和平台规则核验提醒不能被普通用户关闭。
- GB 45438-2025 已现行，但本地快照只能看到标准元信息；具体文件格式元数据写入需要按标准全文和 TC260 后续实践指南做工程复核。
