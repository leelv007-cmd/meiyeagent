> ⚠️ **2026-07-07 评审批注**：本文 L106"医美项目直接排除"已被 ADR-0004 修正为"资质准入制·轻量版"，试点反向纳入 1-2 家已认证医美机构探针。pilot 增补四项修补（纯自助对照组/真实价格点 199/499+定金门槛/≥2 家延至 8-12 周/招募即记 CAC），见 `plan-review-2026-07-07/02-客户GTM与商业模型验证.md` §9。

# Merchant Validation Plan

审查日期：2026-07-06  
审查对象：美业到店 + 医美/医疗资质准入制商家创作副驾 P0 的需求验证  
结论性质：开发前商家验证方案；用于决定是否进入 P0 build-out，不替代正式销售、法务或财务测算。

## Question

What interview script, sample collection process, Wizard-of-Oz workflow, and success metrics should be used to validate beauty and regulated medical-content merchant demand before P0 build-out?

## 结论

P0 build-out 前不要先写完整产品。先跑一个 **4 周商家验证系统**：

1. 访谈 `10-20` 家美业到店和医美/医疗内容商家，验证真实痛点、素材供给、发布习惯、线索记录习惯和付费意愿。
2. 从其中筛选 `3-5` 家进入 Wizard-of-Oz 内容陪跑，用人工和现有原型模拟“创作副驾”。
3. 每家连续 `4` 周，每周交付 `3` 条可发布内容包，并要求商家真实发布或明确拒绝。
4. 全程记录：内容采用、发布时间节省、发布包使用、线索台账使用、素材缺口、医美/医疗资质准入轻量版 Preflight、定金/付费动作。
5. 只有当商家愿意为“自助工具 + 首月陪跑”付费，且不依赖全自动发布或代运营承诺时，才进入完整 P0 开发。

一句话判断：

**要验证的是“商家是否会持续用真实素材生成并发布内容，还愿意记录线索和付费”，不是验证“AI 能不能写一段文案”。**

## Local Sources Used

产品基线：

- `合集-v1.2-含开源项目选型.md`
- `CONTEXT.md`

前序决策：

- `references/analysis/01-execution-path.md`
- `references/analysis/05-platform-capability-matrix.md`
- `references/analysis/06-compliance-implementation-plan.md`
- `references/analysis/07-domain-data-model.md`
- `references/analysis/10-graphic-renderer-selection.md`
- `references/analysis/11-publish-route-poc.md`
- `docs/adr/0003-regulated-content-mode.md`

执行模板：

- `references/templates/merchant-validation/interview-notes.md`
- `references/templates/merchant-validation/sample-intake-checklist.md`
- `references/templates/merchant-validation/woz-weekly-scorecard.csv`

## Live Sources Used

无。本轮目标是把已有本地方案转成可执行验证系统，不做新的市场规模或竞品实时检索。进入正式招募前可再补充本地城市渠道和竞品价格的实时核验。

## Assumptions

- 首发对象是美业到店：美甲、美发、美睫、SPA、生活美容，并纳入 1-2 家资质已认证的医美/医疗探针。
- P0 是 Creation Copilot，不是代运营、群控、无人值守发布或完整 CRM。
- 发布承诺以 L3 Publish Package 为下限；L1/L2 能力不作为早期销售核心卖点。
- Lead Ledger 是轻量内容台账，不宣称严格 ROI 因果归因。
- 商家操作者通常是老板、前台或店员，不是专业运营。

## Validation Shape

### Stage 1: Screening Interviews

目标：确认是否值得做，不卖方案。

样本：

- `10-20` 家门店。
- 至少覆盖 `5` 家美甲/美睫、`3` 家美发、`2` 家 SPA/生活美容。
- 每家访谈 `30-45` 分钟。
- 至少 `60%` 访谈对象必须是老板或能决定付费的人。

输出：

- 每家一份访谈记录。
- 当前内容生产流程图。
- 最近 4 周内容发布数据。
- 当前工具/代运营/员工时间成本。
- 是否可进入样本收集和 WOZ 陪跑。

通过信号：

- 商家过去 4 周至少发过内容，或明确想发但被时间/素材/文案卡住。
- 能提供真实素材和价目表。
- 痛点不是“帮我全托管运营并保证 GMV”。
- 愿意试跑 4 周，并接受人工确认发布和线索手工记录。

### Stage 2: Sample Intake

目标：验证产品最关键的输入是否可得。

每家至少收集：

- 平台主页链接：小红书、抖音、点评/美团、公众号中至少 1 个。
- 最近 `5-10` 条历史内容。
- 真实素材 `20-50` 个：案例图、环境图、价目表、好评截图、手法视频。
- 项目/价目表：项目名、价格、时长、适合人群、注意事项。
- 预约方式和私信/加微引导口径。
- 禁忌：不能写的项目、不能用的图片、不能承诺的话术。
- 素材授权状态：顾客图、好评截图、脸部/身体/声音、未成年人、第三方素材。

硬规则：

- 未授权顾客素材不得进入公开发布包。
- 好评截图默认脱敏头像、昵称、手机号、订单号。
- 医美/医疗项目只接资质已认证探针：线下先核验执业许可与平台认证，线上 Preflight 纯提醒，行为红线硬停。
- 价格必须来自结构化价目表或商家确认，不能从历史文案猜。

### Stage 3: Five-Minute First Content Test

目标：验证冷启动价值感。

流程：

1. 用商家已确认的门店档案和 3-5 个素材生成第一条内容。
2. 内容必须包含标题、正文、话题、封面文案或图文建议、发布步骤、合规提示。
3. 让商家现场判断：直接发、小改后发、大改、不会发。
4. 记录从开始到“可评价内容”的时间。

通过标准：

- `70%` 商家能在 `5-10` 分钟内看到第一条“可评价的内容”。
- `60%` 输出达到“直接发或小改后发”。
- 若低于 `40%`，先改定位/模板/素材流程，不进入开发。

### Stage 4: Wizard-of-Oz Trial

目标：用人工模拟 P0 闭环，验证持续使用和付费。

样本：

- 从访谈中选 `3-5` 家。
- 每家连续 `4` 周。
- 优先选择愿意付费或付定金的门店；免费试用只能作为补充样本。

每周交付：

- `3` 条平台可用内容包。
- 至少 `1` 张封面或图文卡片。
- 至少 `1` 条短视频脚本/分镜/拍摄清单。
- 每条都包含 L3 Publish Package：文案、素材顺序、封面文案、话题、发布步骤、合规提示、线索记录字段。
- 一份周报：本周采用/发布/线索记录/素材缺口/下周建议。

人工模拟原则：

- 允许人工整理素材、改稿和制作发布包，但必须记录人工耗时。
- 不能替商家做无人值守发布。
- 不能承诺阅读/播放/到店结果。
- 商家必须自己确认内容，自己发布或明确拒绝发布。
- 所有拒绝原因要记录：不真实、不像本店、太广告、素材不够、平台不适合、担心违规、没时间发。

## Interview Script

### 0. 开场

目的说明：

> 我们在验证一个给本地美业门店用的内容创作副驾。今天不是销售，希望先了解你现在怎么做内容、哪里最耗时间、什么样的工具你真的会用。不会要求你分享敏感顾客信息；如果看历史素材，可以先打码。

确认：

- 是否触发医美/医疗资质准入轻量版，是否接受发布前核验提醒。
- 是否本人负责或参与内容运营。
- 是否可以记录匿名访谈结果。

### 1. 门店和角色

1. 你们店现在主要项目是什么？哪些项目最想推？
2. 谁负责发小红书、抖音、点评/美团、公众号？
3. 你本人能决定买工具或服务吗？如果不能，谁决定？
4. 目前有几个人参与拍照、写文案、发布、回复咨询？

### 2. 当前内容流程

1. 过去 4 周每个平台大概发了几条？
2. 最近一条内容从选题到发布花了多久？
3. 哪一步最卡：不知道发什么、不会写、图片不好选、排版、平台发布、发完没反馈？
4. 你们现在用什么工具：剪映、即创、豆包、Kimi、平台后台、代运营、Excel、备忘录？
5. 有历史爆款或明显有效的内容吗？你怎么判断它有效？

### 3. 素材供给

1. 你们每天/每周会拍多少案例图或视频？
2. 素材现在放在哪里？手机相册、微信、网盘、员工手机、平台后台？
3. 哪些素材可以公开发？哪些需要顾客授权？
4. 有没有价目表、活动表、好评截图、门店环境图？
5. 如果工具给拍摄清单，店员是否愿意照着补拍？

### 4. 平台和转化

1. 你现在最重视哪个平台？为什么？
2. 发内容后通常希望用户做什么：私信、加微信、预约、买团购券、到店？
3. 你现在会记录哪条内容带来咨询或到店吗？怎么记？
4. 点评/美团、抖音团购、微信私域在你店里的作用分别是什么？
5. 如果只能先支持“发布包 + 人工发布”，不做全自动发布，你还会用吗？为什么？

### 5. 展示样例并观察反应

拿一条基于该店素材生成的样例，逐项问：

1. 这条像不像你们店？
2. 哪一句你会删？哪一句你会保留？
3. 这张封面/图文卡你会不会发？
4. 哪个平台最适合发？
5. 你愿意花几分钟改完并发布吗？

记录商家真实改稿行为，不只记录口头喜欢。

### 6. 付费和承诺

1. 如果每周给你准备 3-5 条可发内容包，你愿意自己发布吗？
2. 你更愿意买工具、买陪跑，还是只想要代运营？
3. 你现在每月为内容、工具、代运营或员工时间花多少钱？
4. 如果试用 4 周，你愿意付多少钱或付定金吗？
5. 你愿意连续 4 周提供素材、发布内容并记录线索吗？

不要只问“愿不愿意付费”。优先获取真实动作：

- 立即预约试跑时间。
- 提供素材包。
- 拉老板/员工进试跑群。
- 支付小额定金。
- 确认 4 周日程。

### 7. 结束

确认下一步：

- 是否进入样本收集。
- 需要哪些素材。
- 首条内容交付时间。
- 下次回访时间。

## Sample Collection Process

### Store Folder Shape

建议每家门店使用统一编号：

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

如果素材包含顾客个人信息，不要直接放入普通仓库；只记录脱敏索引、授权状态和存储位置。

### Intake Fields

必须结构化记录：

- `store_code`
- `store_name`
- `city`
- `district`
- `store_type`
- `decision_maker`
- `operator`
- `platform_links`
- `primary_goal`
- `main_services`
- `price_source`
- `asset_count`
- `asset_rights_status`
- `posting_baseline`
- `lead_tracking_baseline`
- `trial_commitment`
- `payment_signal`

### Asset Rights Gate

入库前给每个素材标记：

| 字段 | 可选值 |
|---|---|
| `source_type` | merchant_upload / customer_provided / staff_shot / platform_screenshot / generated |
| `rights_owner` | store / staff / customer / third_party / unknown |
| `consent_status` | unknown / pending / granted / revoked / not_required |
| `consent_scope` | internal_reference / publish_package / public_marketing / paid_ads |
| `contains_person` | none / hand_only / face / body / voice |
| `contains_sensitive_personal_info` | true / false |
| `minor_involved` | true / false |
| `redaction_status` | none / required / completed |

用于公开发布包的素材必须满足：

- `consent_status = granted` 或 `not_required`。
- `consent_scope` 至少包含 `publish_package`，公开发布需包含 `public_marketing`。
- 好评截图已脱敏。
- 没有未成年人素材。

## Wizard-of-Oz Workflow

### Roles

| Role | 责任 |
|---|---|
| Research Lead | 访谈、判定样本是否合格、每周复盘 |
| Content Operator | 人工模拟 Creation Copilot，生成内容包 |
| Compliance Reviewer | 检查医美/医疗资质准入轻量版、广告、价格、素材授权、AIGC 标识 |
| Merchant Operator | 门店侧确认、发布、记录线索 |

一个人可以兼任前三个角色，但必须分别记录耗时，否则无法判断未来产品要自动化哪部分。

### Week 0: Setup

1. 完成访谈和样本入库。
2. 建门店档案。
3. 选定主推项目和平台。
4. 定义基线：过去 4 周发布数、每条耗时、内容来源、线索记录方式。
5. 生成第一条样例，完成 5-10 分钟首条内容测试。
6. 确认 4 周节奏和每周交付日。

### Week 1-4: Weekly Loop

每周固定流程：

```text
商家提交本周主推项目/素材
  -> 人工生成 3 条内容内核
  -> 平台变体和图文卡片
  -> 合规检查和改写
  -> L3 发布包交付
  -> 商家确认/修改/发布
  -> 记录发布时间、修改时间、发布链接
  -> 商家记录线索
  -> 周报复盘
```

每条内容记录：

- `content_id`
- `platform`
- `topic`
- `asset_ids`
- `generated_at`
- `operator_minutes`
- `merchant_review_minutes`
- `adoption_status`: adopted / minor_edit / major_edit / rejected
- `published`: true / false
- `publish_url`
- `lead_count`
- `rejection_reason`

### Weekly Review Questions

1. 哪条内容最像你们店？为什么？
2. 哪条内容你不敢发？为什么？
3. 这周发内容总共节省了多少时间？
4. 有没有咨询、加微、预约、核销或到店？
5. 线索记录是否麻烦？缺什么字段？
6. 下周你还愿意继续吗？愿意付费继续吗？

## Success Metrics

### Interview-Level Score

每家门店按 100 分评分：

| 维度 | 分值 | 通过信号 |
|---|---:|---|
| 痛点强度 | 15 | 每周持续要发内容，且当前流程明显耗时 |
| 素材供给 | 15 | 可提供 20+ 个真实素材，并能说明授权状态 |
| 平台匹配 | 10 | 至少一个核心平台依赖内容获客或决策 |
| 操作者匹配 | 10 | 老板/店员愿意自己确认内容和发布 |
| 线索闭环 | 15 | 愿意记录咨询、加微、预约、核销或到店 |
| 内容采用 | 15 | 样例达到直接发或小改后发 |
| 付费信号 | 15 | 愿意付费、定金、排期或引入决策人 |
| 合规适配 | 5 | 接受资质准入轻量版、素材授权、AIGC、价格限制 |

进入 WOZ 的门店建议 `>=70` 分；低于 `60` 分不进入陪跑。

### Wizard-of-Oz Gate

4 周后按以下标准判定：

| 指标 | Proceed | Caution | Stop |
|---|---:|---:|---:|
| 内容采用率 | `>=60%` | `40-59%` | `<40%` |
| 每店每周发布/准备内容 | `>=3` | `1-2` | `<1` |
| 商家审阅到可发布耗时 | `<=15 min/条` | `16-30 min/条` | `>30 min/条` |
| 发布包使用率 | `>=60%` | `40-59%` | `<40%` |
| 线索台账参与 | `>=60%` 门店每周记录 | 部分记录 | 几乎无人记录 |
| 续跑/付费意愿 | `>=3/5` 门店明确愿意 | `1-2/5` | `0/5` |
| 合规硬失败 | 0 | 0 | `>0` |

### Proceed Criteria

进入 P0 build-out 的最低条件：

1. `10-20` 家访谈完成，至少 `10` 家愿意进入付费或准付费试跑。
2. `3-5` 家完成 4 周 WOZ，至少 `3` 家愿意继续付费或续跑。
3. WOZ 内容采用率 `>=60%`。
4. 每店每周至少准备或发布 `3` 条内容。
5. `>=60%` 门店能记录至少 1 条内容到线索的关联。
6. 商家不要求全自动发布或 GMV 保证才愿意付费。
7. 受监管内容发布前核验提醒覆盖率 100%；未授权素材公开导出、价格无来源生成、伪造资质/案例等硬失败为 0。

### Do Not Proceed Criteria

出现任一情况，应暂停 P0 build-out：

- 商家只愿意为“AI 写文案”付 `<=99/月`，不认可工作台和线索台账价值。
- 多数门店无法持续提供真实素材。
- 内容采用率低于 `40%`。
- 线索台账没人愿意记录。
- 必须承诺代运营、全自动发布或 GMV 才愿意付费。
- 受监管内容核验提醒不可控，样本频繁要求绕过资质准入/Preflight、伪造资质/案例、去标识或承诺疗效。
- 人工陪跑耗时过高，无法推导出可接受的产品毛利。

## Pricing Test

访谈不要先抛价格。顺序应是：

1. 先量化当前成本：老板时间、员工时间、代运营费用、工具费用。
2. 做样例，让商家判断是否能发。
3. 问 4 周陪跑试用是否愿意付费。
4. 给两个选项测试：
   - `Starter`: 单店基础内容包、L3 发布包、手工线索台账、首月轻陪跑。
   - `Growth`: 每周 3-5 条内容、图文卡、视频脚本、周报、更多平台变体。
5. 看真实动作：定金、转账、排期、拉同事、提供素材。

有效付费信号优先级：

1. 付款或定金。
2. 明确预算和采购人。
3. 确认 4 周试跑排期并提交素材。
4. 口头说“有用”但不愿提交素材，不能算强信号。

## Risks And Controls

| 风险 | 控制 |
|---|---|
| 访谈被礼貌性认可污染 | 先问过去行为，再展示方案；以提交素材/付费/排期为准 |
| WOZ 变成代运营 | 每条内容都要求商家确认和发布，记录人工耗时，不承诺结果 |
| 只验证文案，不验证闭环 | 每周必须记录发布包使用和线索台账 |
| 素材授权不清 | 入库前做 rights gate，未授权素材只作内部参考 |
| 受监管内容核验失效 | 允许医美/医疗内容样本，但必须触发 Publish Compliance Preflight；绕过核验、伪造资质/案例、去标识或疗效保证直接记录为不适配 |
| 平台自动发布诱导销售 | 所有样本都按 L3 包默认交付，不以自动发布作为购买理由 |
| 价格意愿虚高 | 要定金、排期和连续 4 周使用，不只听报价 |

## Decision

P0 开发前的验证路线应是：

```text
10-20 merchant interviews
  -> 3-5 qualified stores
  -> sample intake and first-content test
  -> 4-week Wizard-of-Oz content trial
  -> adoption/time-saved/lead-ledger/payment gate
  -> proceed, iterate, or stop
```

最先验证的产品价值不是 L1 发布、不是自动运营，也不是复杂架构，而是：

- 真实素材能否持续进入系统。
- 生成内容是否像这家店。
- 商家是否愿意发布。
- 发布后是否愿意记录线索。
- 商家是否愿意为这个闭环付费。

## Follow-Up Tickets

- `Pilot Playbook` 需要基于本报告扩展成门店 onboarding、每周陪跑、周报和续费决策 SOP。
- `P0 Architecture Decision` 应保留 Merchant Validation 的数据入口：Store Profile、Real Asset Library、Publish Package、Lead Ledger、Weekly Report。
- 后续应新增 `Merchant Interview Findings`，记录真实访谈和 WOZ 结果，不要只保留计划。
