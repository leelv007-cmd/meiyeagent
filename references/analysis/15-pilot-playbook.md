> ⚠️ **2026-07-07 评审批注**：仍为试点执行底稿，使用前增补四项——①纯自助对照组（operator 产出耗时设硬性天花板，Week 3-4 切 1-2 家到纯原型）；②真实价格点 Starter 199/Growth 499，Go 门槛=≥3 家在 ≥399 档付定金（"续跑"不算付费信号）；③≥2 家延至 8-12 周付费续跑；④招募按渠道记录 CAC。样本从 non-medical-only 改为增纳 1-2 家已认证医美机构探针（ADR-0004）。"5 分钟激活 70%"移出 WoZ 阶段指标（真产品阶段才可测）。

> ⚠️ **2026-07-18 链接审计批注**：本文引用的 `references/templates/merchant-validation/*` 模板与 `.scratch/beauty-content-agent-wayfinding/` 票据未迁入本工作区、现已不存在。试点进场与量表现行权威为 Wave 1 执行合同（权威文档 D-026）与 `references/analysis/beauty-marketing-validation-2026-07-17/VALIDATION-PLAYBOOK.md`。本文其余观察设计仍为有效历史输入。

# Pilot Playbook

审查日期：2026-07-06  
审查对象：美业到店 + 医美/医疗资质准入制商家创作副驾 P0 试点执行  
结论性质：商家招募、onboarding、4 周 Wizard-of-Oz 陪跑、周报、scorecard 和继续开发决策 SOP。

> 2026-07-07 覆盖更新：P0 pilot 从“非医美美业门店”扩展为“美业到店 + 1-2 家已认证医美/医疗探针”。医美、医疗、注射、激光、手术、药械相关内容不在创作阶段硬拒绝，但发布、导出、发布包交接或 L1 官方提交前必须展示 Publish Compliance Preflight。L2 浏览器辅助整体移出 P0。

## Question

What exact playbook should be used to onboard pilot beauty stores, collect assets, generate weekly content, record leads, measure adoption, and decide whether to continue development?

## 结论

P0 pilot 使用一套 **10-20 家访谈 -> 3-5 家 WOZ -> 4 周陪跑 -> Go/Pivot/No-Go** 的执行手册。

核心原则：

1. 首发只做美业到店，并纳入 1-2 家资质已认证的医美/医疗探针样本。
2. 每家 WOZ 门店连续 4 周，每周交付 3 条平台可用内容包。
3. 每周至少包含 1 张封面/图文卡，至少 1 条视频脚本、分镜或拍摄清单。
4. 所有平台默认 L3 发布包；商家自己确认和发布。
5. 每条内容必须记录采用状态、审阅耗时、发布链接、线索、拒绝原因和人工耗时。
6. 合规硬失败为 0 才能进入下一阶段。
7. 继续开发的判断以真实动作和数据为准，不以礼貌性好评、内部 demo 或平台 doc-only 能力为准。

Pilot 要验证的是：

- 商家是否能持续提供真实素材。
- 生成内容是否像这家店。
- 商家是否愿意确认并发布。
- 发布后是否愿意记录线索。
- 商家是否愿意为“自助工具 + 首月陪跑”付费。

## Agent Team Used

本轮启用三个只读 explorer：

- 招募、筛选、onboarding、素材收集 SOP explorer。
- 4 周 Wizard-of-Oz 内容陪跑运营 SOP explorer。
- 指标、scorecard、go/no-go、续费决策 SOP explorer。

三个 explorer 结论一致：pilot 不能变成代运营，也不能用自动发布承诺诱导成交；必须把素材授权、L3 发布包、线索台账、人工耗时和续费动作作为核心证据。

## Local Sources Used

- `合集-v1.2-含开源项目选型.md`
- `CONTEXT.md`
- `.scratch/beauty-content-agent-wayfinding/map.md`
- `references/analysis/05-platform-capability-matrix.md`
- `references/analysis/06-compliance-implementation-plan.md`
- `references/analysis/09-model-provider-eval-plan.md`
- `references/analysis/11-publish-route-poc.md`
- `references/analysis/12-merchant-validation-plan.md`
- `references/analysis/13-p0-architecture-decision.md`
- `references/analysis/14-p0-backlog-and-sprint-plan.md`
- `docs/adr/0003-regulated-content-mode.md`
- `references/templates/merchant-validation/interview-notes.md`
- `references/templates/merchant-validation/sample-intake-checklist.md`
- `references/templates/merchant-validation/woz-weekly-scorecard.csv`

## Live Sources Used

无。本轮只使用本地调研体系和模板。正式招募前可补充本地城市渠道、竞品价格和平台政策的实时核验，但 pilot 执行不依赖实时检索。

## Scope

### In Scope

- 美业到店：美甲、美睫、美发、SPA、生活美容。
- 医美/医疗、诊疗、注射、激光、手术、药械相关商家的正常内容创作、素材整理、拍摄清单和发布包准备。
- 门店档案、价目表、真实素材、历史内容、平台主页收集。
- L3 Publish Package。
- 手工线索台账。
- 每周周报和下一轮内容建议。
- 首月轻陪跑。
- 真实付费、定金、续跑和转介绍信号记录。

### Out Of Scope

- 未经 Publish Compliance Preflight 的医美、医疗、诊疗、注射、激光、手术、药械相关内容发布、导出、发布包交接或 L1 官方提交。
- 全托管代运营。
- GMV、播放量、涨粉、到店量保证。
- 多平台一键全自动发布。
- 自动回复、完整 CRM/SCRM、POS、会员系统。
- 绕过验证码、cookie 抽取、hidden API。
- 未授权顾客素材公开使用。
- 未脱敏好评截图公开使用。
- 无来源价格、绝对化广告话术。
- 严格 ROI 因果归因。

正确销售口径：

> 给门店配一个懂项目、懂素材、懂平台的内容副驾。每周准备能直接发的图文、文案和视频脚本，商家确认后发布，再用线索台账复盘哪类内容带来咨询、加微、预约或核销。

## Pilot Roles

| Role | Responsibility |
|---|---|
| Research Lead | 招募、访谈、准入评分、每周复盘、最终决策证据整理 |
| Content Operator | 人工模拟 Creation Copilot，生成内容内核、平台变体、图文卡、视频脚本、拍摄清单 |
| Compliance Reviewer | 检查医美/医疗资质准入轻量版、广告绝对化、价格来源、素材授权、PII 脱敏、AIGC 标识 |
| Merchant Operator | 门店侧提供素材、确认内容、发布或拒绝、记录线索、参与周报复盘 |

一个人可以兼任前三个内部角色，但必须分别记录耗时，否则无法判断未来产品应该自动化哪一段。

## Timeline

| Stage | Duration | Goal | Exit criteria |
|---|---:|---|---|
| Recruiting | 1-2 weeks | 访谈 10-20 家 | 至少 10 家有付费或准付费试跑意愿 |
| Week 0 Setup | 2-5 days | 完成 intake、素材收集、首条内容测试 | 3-5 家门店通过评分并确认 4 周节奏 |
| Week 1 | 1 week | 建立基线和首批可发内容 | 每店交付 3 条内容包并完成第一次周报 |
| Week 2 | 1 week | 验证平台变体和审阅耗时 | 采用率、发布包使用、审阅耗时可量化 |
| Week 3 | 1 week | 稳定发布和线索记录 | 每店每周 3 条内容准备或发布，线索记录开始形成习惯 |
| Week 4 | 1 week | 续跑/付费判断 | 完成 final review，做 Go/Pivot/No-Go |

## Recruiting And Screening SOP

### Target Sample

- 访谈 `10-20` 家门店。
- 美甲/美睫至少 `5` 家。
- 美发至少 `3` 家。
- SPA/生活美容至少 `2` 家。
- 至少 `60%` 访谈对象是老板或付费决策人。
- 筛选 `3-5` 家进入 WOZ。

### Channel Hypotheses

这些只是待验证渠道，不当成已证明获客路径：

- 美业 SaaS/工具社群。
- 本地商家培训课。
- 小红书/抖音同城运营课程合作。
- 美业品牌/供应链合作。
- 本地服务商/代运营合作。
- 线下商圈试点。

### Qualification

通过条件：

- 美业到店或已认证医美/医疗探针，并接受资质准入轻量版。
- 过去 4 周发过内容，或明确被时间、素材、文案卡住。
- 能提供平台主页、真实素材、价目表。
- 接受“发布包 + 人工确认发布”。
- 愿意连续 4 周提供素材、发布或明确拒绝、记录线索。
- 有付费、定金、排期、拉决策人、提交素材等真实动作。

硬拒绝：

- 伪造医疗机构、医生、专家、资质、顾客案例或评价。
- 要求移除 AIGC 标识、绕过平台审核、保证疗效/安全性、承诺治愈率/有效率。
- 只能接受全托管代运营、GMV 保证或全自动发布。
- 无法持续提供真实素材。
- 素材授权不清且不愿补授权或脱敏。
- 只愿意为“AI 写文案”付 `<=99/月`。
- 不愿记录咨询、加微、预约、核销或到店线索。

## 30-45 Minute Onboarding Interview

### 0-3 Minutes: Frame

- 说明这不是销售。
- 确认是否触发医美/医疗资质准入轻量版。
- 确认是否同意匿名记录。
- 确认受访者角色和付费决策权。

### 3-8 Minutes: Store Basics

- 主营项目。
- 最想推的项目。
- 谁负责拍摄、写文案、发布、回复咨询。
- 谁能决定买工具或服务。

### 8-16 Minutes: Current Content Workflow

- 过去 4 周各平台发布数。
- 单条内容从选题到发布耗时。
- 当前工具、代运营、员工时间成本。
- 最大卡点。
- 历史有效内容如何判断。

### 16-23 Minutes: Asset Supply

- 案例图、视频、环境图、门头图、价目表、活动表、好评截图。
- 素材存放位置。
- 顾客授权状态。
- 是否愿意按拍摄清单补拍。

### 23-29 Minutes: Platform And Conversion

- 核心平台。
- 希望用户私信、加微、预约、买券、核销还是到店。
- 当前是否能把线索关联到内容。

### 29-38 Minutes: First Content Test

- 基于已确认档案和 3-5 个素材展示或生成样例。
- 记录：直接发、小改、大改、不会发。
- 问哪里不像本店、哪句要删、哪个平台适合。

### 38-43 Minutes: Trial Commitment

- 是否愿意每周拿 3-5 条内容包后自己发布。
- 是否接受 4 周试跑。
- 是否愿意付费或付定金。
- 确认每周 review 时间和 Merchant Operator。

### 43-45 Minutes: Close

- 是否进入样本收集。
- 缺哪些素材。
- 首条内容交付时间。
- 下次回访时间。

## Sample Intake SOP

每店必收：

- 平台主页链接至少 1 个：小红书、抖音、点评/美团、公众号。
- 历史内容 `5-10` 条。
- 真实案例/环境照片 `20-50` 个。
- 短视频 `3-5` 条，如有。
- 价目表或服务菜单。
- 当前活动。
- 脱敏好评截图。
- 门头和室内图。
- 预约方式、加微/私信口径、团购/预约链接。
- 禁忌话术和不能用的图片。

推荐归档结构：

```text
merchant-validation/
  ST001-store-name/
    00-intake.md
    01-store-profile.md
    02-price-sheet/
    03-assets/
    04-history-posts/
    05-generated-packages/
    06-lead-ledger/
    07-weekly-reports/
```

命名规则：

```text
ST001_YYYYMMDD_type_service_seq_rights.ext
```

示例：

```text
ST001_20260706_case_lash_001_granted.jpg
ST001_20260706_review_lash_003_redacted.png
ST001_20260706_price_menu_001_confirmed.pdf
```

每个素材必须有 `asset_id`，例如 `A-ST001-0001`。

## Asset Rights Gate

每个素材记录：

| Field | Allowed values |
|---|---|
| `source_type` | merchant_upload / customer_provided / staff_shot / platform_screenshot / generated |
| `rights_owner` | store / staff / customer / third_party / unknown |
| `consent_status` | unknown / pending / granted / revoked / not_required |
| `consent_scope` | internal_reference / publish_package / public_marketing / paid_ads |
| `contains_person` | none / hand_only / face / body / voice |
| `contains_sensitive_personal_info` | true / false |
| `minor_involved` | true / false |
| `redaction_status` | none / required / completed |
| `public_package_allowed` | yes / no |

公开发布包允许条件：

- `consent_status = granted` 或 `not_required`。
- `consent_scope` 至少包含 `publish_package`；公开营销要包含 `public_marketing`。
- 敏感截图已脱敏。
- 无未成年人素材。
- 价格来自价目表、活动表或商家确认。

含个人信息的原始素材不要放普通仓库；只记录脱敏索引、授权状态和受控存储位置。

## WOZ Admission Scorecard

先做硬门禁，不计分。任一失败，剔除样本或 No-Go：

| Hard gate | Rule |
|---|---|
| 垂类 | 美业到店或已认证医美/医疗探针；接受资质准入轻量版 |
| 发布承诺 | 接受“发布包 + 人工确认发布”，不以全自动发布为购买前提 |
| 结果承诺 | 不要求 GMV、播放量、涨粉或到店结果保证 |
| 素材权利 | 未授权顾客素材、未脱敏好评截图、无来源价格不得进入公开发布包 |
| 合规 | 受监管内容发布前核验提醒覆盖率 100%；未授权素材公开导出、价格无来源生成、伪造资质/案例等硬失败必须为 0 |

准入评分：

| Dimension | Points | Passing signal |
|---|---:|---|
| 痛点强度 | 15 | 每周持续要发内容，当前流程明显耗时 |
| 素材供给 | 15 | 可提供 20+ 个真实素材，并能说明授权状态 |
| 平台匹配 | 10 | 至少一个核心平台依赖内容获客或决策 |
| 操作者匹配 | 10 | 老板/店员愿意自己确认和发布 |
| 线索闭环 | 15 | 愿意记录咨询、加微、预约、核销或到店 |
| 内容采用 | 15 | 首条样例达到直接发或小改后发 |
| 付费信号 | 15 | 付费、定金、排期、拉决策人、提交素材 |
| 合规适配 | 5 | 接受资质准入轻量版、授权、AIGC、价格限制 |

阈值：

- `>=70`: 进入 WOZ。
- `60-69`: 候补或补资料后复评。
- `<60`: 不进入陪跑。

## Weekly WOZ Operating SOP

### Weekly Cadence

| Day | Action | Owner | Output |
|---|---|---|---|
| Monday | 收本周主推项目、活动、真实素材、价格/优惠来源；检查素材授权和缺口 | Research Lead + Merchant Operator | 本周选题表、素材清单、拍摄补充清单 |
| Tuesday | 人工模拟 Copilot 生成 3 条内容内核，并做平台变体、图文卡、视频脚本 | Content Operator | 3 条内容卡、封面/图文卡、脚本/分镜/拍摄清单 |
| Wednesday | 商家逐条标记直接采用、小改、大改、拒绝；记录审阅耗时和拒绝原因 | Merchant Operator + Content Operator | 确认版内容、修改记录、采用状态 |
| Thursday | 合规复核后生成 L3 发布包；商家按包人工发布或明确不发 | Compliance Reviewer + Merchant Operator | L3 发布包、发布时间、链接、失败原因 |
| Friday | 记录私信、评论、加微、预约、团购券、核销、到店；输出周报和下周建议 | Research Lead + Merchant Operator | 线索台账、周报、下周重点 |

周重点：

- Week 1：建立基线和首批可发内容。
- Week 2：验证平台变体和审阅耗时。
- Week 3：稳定发布和线索记录。
- Week 4：续跑、付费和继续开发判断。

### Content Package Definition

每条内容包必须包含：

- `content_id`
- platform
- topic
- `asset_ids`
- title
- body copy
- hashtags
- cover text
- image or graphic suggestion
- video script, storyboard, or shot list
- conversion hook
- price or promotion source
- compliance status
- AIGC label note
- publishing steps
- asset order
- location/coupon/booking link hint
- lead ledger fields

运营记录必须包含：

- generated_at
- operator_minutes
- merchant_review_minutes
- adoption_status: adopted / minor_edit / major_edit / rejected
- published: true / false
- publish_url
- lead_count
- rejection_reason

### L3 Publish Package

所有平台默认交付 L3 包。每个包包含：

- 平台变体文案。
- 素材顺序。
- 封面文案和导出图。
- 话题标签。
- 发布步骤。
- 合规摘要。
- AIGC 标识说明。
- 线索记录字段。

L1/L2 只能在账号能力 verified 后验证；失败必须降级到 L3，不影响商家拿到可人工发布内容。

### Lead Ledger Fields

每条线索记录：

- lead_date
- content_id
- campaign_id
- platform
- manual_url
- lead_type: DM / comment / WeChat / booking / coupon / redemption / visit
- service
- amount_or_coupon
- followup_status
- notes

周报只能说相关性和观察，不宣称严格 ROI 因果归因。

## Compliance SOP

必须检查：

- 素材入库。
- 平台变体生成后。
- 图片/视频导出前。
- 发布包生成前。
- 用户改字、换图、改价格后。

合规状态：

| Status | Action |
|---|---|
| pass | 可保存、导出、进入发布确认 |
| warn | 展示提示，用户确认后继续，记录确认 |
| needs_review | 必须人工复核，不自动发布 |
| block | 禁止导出、发布包交接和官方提交 |

硬规则：

- 医美/医疗项目触发资质准入轻量版 Preflight；发布、导出、发布包交接和官方提交前必须展示 Publish Compliance Preflight 并记录提醒留痕。
- 伪造资质、未授权案例、去 AIGC 标识、绕平台审核、疗效/安全性保证、治愈率/有效率承诺直接 block。
- 未授权顾客素材要求授权、脱敏或替换。
- 价格/优惠无来源时，不写具体价格和名额，只写“可咨询门店确认价格/档期”。
- AIGC 标识默认保留，不能移除、隐藏、伪造。

## Failure Branches

| Situation | Handling |
|---|---|
| 商家拒绝内容 | 记录原因：不真实、不像本店、太广告、素材不够、平台不适合、担心违规、没时间发；可小改、重写、换平台，仍拒绝计入 rejected |
| 素材不足 | 不伪造案例或 before/after；输出拍摄清单；优先用环境图、价目表、好评截图、门头定位图；必要时减少内容类型 |
| 合规 block | 停止导出和发布包；给安全替代表述 |
| 价格/优惠无来源 | 不写具体价格和名额，只写确认口径 |
| L1/L2 失败 | 保存状态和失败码，解释原因，降级 L3 |
| 商家没时间发布 | 保留 L3 包，记录未发布原因；不替商家无人值守发布 |
| 没有线索 | 记录 0；周报分析内容、平台、转化钩子，下周调整 |
| 连续低采用 | 若 4 周采用率 `<40%` 或审阅耗时 `>30 min/条`，暂停 build-out，先修门店事实、素材流程和模板 |

## Weekly Review

使用模板：

- `references/templates/merchant-validation/pilot-weekly-review.md`
- `references/templates/merchant-validation/woz-weekly-scorecard.csv`

每周必须记录：

- store_code, week, review date。
- 本周主推项目、目标平台、素材数、素材缺口。
- 价目/活动是否有来源。
- 准备内容数、图文卡数、视频脚本数、L3 发布包数。
- 直接采用、小改、大改、拒绝。
- 实际发布、发布链接、未发布原因。
- 商家平均审阅分钟/条。
- 我方人工耗时。
- 私信、评论问价、加微、预约、团购券、核销、到店备注。
- block/warn 数和原因。
- 下周是否继续、是否愿意付费/定金、是否拉决策人、是否转介绍。

周五复盘问题：

1. 哪条内容最像你们店？为什么？
2. 哪条内容你不敢发？为什么？
3. 这周发内容总共节省了多少时间？
4. 有没有咨询、加微、预约、核销或到店？
5. 线索记录是否麻烦？缺什么字段？
6. 下周还愿意继续吗？愿意付费继续吗？

## Four-Week Final Review

使用模板：

- `references/templates/merchant-validation/pilot-final-review.md`

### Cohort Metrics

| Metric | Proceed | Pivot / Caution | Stop |
|---|---:|---:|---:|
| 内容采用率，直接采用+小改 / 准备数 | `>=60%` | `40-59%` | `<40%` |
| 每店每周准备或发布内容 | `>=3` | `1-2` | `<1` |
| 商家审阅到可发布耗时 | `<=15 min/条` | `16-30 min/条` | `>30 min/条` |
| L3 发布包使用率 | `>=60%` | `40-59%` | `<40%` |
| 线索台账参与 | `>=60%` 门店每周记录至少 1 条内容关联线索 | 部分记录 | 几乎无人记录 |
| 续跑/付费意愿 | `>=3/5` 明确愿意续费、续跑或付定金 | `1-2/5` | `0/5` |
| 合规硬失败 | 0 | 0 | `>0` |

合集原验收给过 L3 发布包使用率 `>=50%` 的下限；pilot 继续开发建议用 `>=60%` 作为更稳妥的 proceed 线。

### Strong Signal Ranking

从强到弱：

1. 4 周后真实续费付款，或签下下一周期。
2. 试点前或试点中完成正式付费。
3. 支付定金，并确认 4 周排期和提交素材。
4. 明确预算、采购人、付款流程和预计付款时间。
5. 连续 4 周按时提交素材、发布内容、记录线索。
6. 拉老板、员工或财务进试跑群，并固定 weekly review。
7. 使用后转介绍另一个同类门店决策人。
8. 口头说“有用”、点赞样例、愿意看看，但不提交素材、不排期、不付费。

## Go / Pivot / No-Go

### Go

全部满足才进入 P0 build-out 或 paid pilot 扩张：

- `10-20` 家访谈完成，至少 `10` 家愿意进入付费或准付费试跑。
- `3-5` 家完成 4 周 WOZ。
- 至少 `3` 家愿意继续付费、续跑或付定金。
- 内容采用率 `>=60%`。
- 每店每周至少准备或发布 `3` 条。
- `>=60%` 门店记录至少 1 条内容关联线索。
- 合规硬失败为 0。
- P0 不依赖 L1/L2 自动发布也能交付价值。

### Pivot

出现以下情况先调整，不扩开发范围：

- 内容采用率 `40-59%`：修门店档案、素材 intake、模板和 prompt。
- 采用高但线索弱：重做 Lead Ledger 入口和周报，不宣称 ROI。
- 使用强但付费弱：调整套餐、陪跑、定价，不把“喜欢用”当商业通过。
- 素材弱：加强拍摄清单和 onboarding；仍弱则换细分门店。
- 商家只要自动发布：不改 P0 主线，记录为平台能力验证线索。

### No-Go

任一成立就暂停 P0 build-out：

- 商家只愿意为“AI 写文案”付 `<=99/月`。
- 多数门店无法持续提供真实素材。
- 内容采用率 `<40%`。
- 线索台账没人记录。
- 必须承诺 GMV、全托管代运营或全自动发布才付费。
- 人工陪跑耗时无法推导出合理毛利。
- 受监管内容核验提醒、未授权素材、无来源价格、伪造资质/案例等硬失败不可控。

## Merchant Interview Findings

后续真实执行必须新增 `Merchant Interview Findings`，记录事实而不是计划。

应该写入：

- 过去 4 周真实发布数、每条耗时、当前工具/代运营/员工成本。
- 决策人身份、预算 owner、是否能付费。
- 素材数量、素材类型、授权状态、价目表来源。
- 首条内容测试结果：直接发、小改、大改、拒绝，以及具体拒绝原因。
- 每周真实采用、发布链接、线索记录、人工耗时、合规 block。
- 付款、定金、续费、排期、拉同事、转介绍等真实动作。
- 商家要求全托管、GMV 保证、自动发布、绕过资质准入/Preflight、伪造资质/案例、去标识等不适配信号。

不能拿来做产品决策：

- 没有动作支撑的“我愿意付费”“这个挺好”。
- 免费试用中的礼貌性好评。
- 非决策人的预算判断。
- 单条爆款、播放量、点赞量，除非能和内容、时间窗、线索记录清楚关联。
- 模型 eval 分数、provider benchmark、内部 demo 效果。
- `doc-only` 平台能力。
- WOZ 中未记录人工耗时的过度人工打磨结果。

## Required Artifacts

Pilot 每家门店结束后至少要有：

- `00-intake.md`
- `01-store-profile.md`
- `02-price-sheet/`
- `03-assets/` with rights index
- `04-history-posts/`
- `05-generated-packages/`
- `06-lead-ledger/`
- `07-weekly-reports/`
- weekly scorecard rows
- final review

## Decision

Adopt this pilot playbook before committing to full P0 build-out:

```text
10-20 merchant interviews
  -> 3-5 qualified non-medical beauty stores
  -> Week 0 intake and first content test
  -> 4 weekly WOZ loops
  -> weekly scorecards
  -> final review
  -> Go / Pivot / No-Go
```

The decision to continue development must be based on sustained merchant behavior: real assets submitted, content adopted, L3 packages used, leads recorded, compliance hard failures avoided, and at least 3 of 5 pilot stores willing to pay, renew, or continue.
