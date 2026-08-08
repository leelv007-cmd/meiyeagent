# 积分制计费规格（Credit Billing Spec）

- 日期：2026-08-01
- 状态：终稿（wayfinder 图 [#289](https://github.com/legacy-origin-a/legacy-web-repo/issues/289) 终点交付物；经 Codex CLI 对抗复核一轮，11 条 findings（3 BLOCKER/8 MAJOR）全数吸收，复核记录在票 #295）。2026-08-01 增补 §11 开发纪律与提交合并规范（Codex 实施轮治理）。
- 决策来源：图 #289 的 12 条开图决策 + 五张子票资解（#290 Waffo 接入调研、#291 条数额度全触点盘点、#292 降级退订语义、#293 初始数值口径、#294 价格页原型）。票面资解是各决策的唯一详情出处，本规格只收束不复述论证。
- 实施方式：本规格锁死全部产品决策，实施另行集中开票（见 §10）。

## §0 范围与口径钉子

### 0.1 一句话

套餐从「分类型条数额度（文案/图片/视频/成品包各计条数）」整体切换为**积分制**：订阅周期积分 + 可购加油包，运营按模型定积分价，用户按积分消费，价格页按积分售卖。

### 0.2 被 supersede 的既有决策口径

以下文档中「条数/三桶」商家计费口径自本规格起 superseded（2026-08-01 已完成权威回写：设计日志 **D-172** ＋各文 supersede banner ＋ CONTEXT/PRODUCT/DESIGN/双 AGENTS 同步，旧正文不逐段改写）：

- `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`：D-044（试用条数）、D-045（grant-lot 条数制）、D-123（三桶+三类加油包条数）中的**计量单位口径**（机制骨架保留，见 §2）
- `docs/specs/bucket-disposition-matrix-2026-07-25.md`（D-123 三桶 KEEP 行）
- `docs/design/landing-copy-2026-07-21.md`（「按条数」卖点与 FAQ）
- `docs/ops/provisioning-manifest.md` C-1（套餐三桶数字供给）

**不变的铁律**：D-061 双真相——积分是产品侧概念，任何面永不暴露上游 token/余额/美元成本；供应侧用量账（token/秒/元）与商家积分账永久双轨，禁止合并（#291 §四.4 风险 5）。

### 0.3 明确范围外

透支/后付费账期；存储折积分；条数/积分双轨兼容期；本规格的实施执行本身。

## §1 记账模型

### 1.1 两类积分批次

| 批次来源 | 发放 | 效期 | 交易类型（复用 grant-lot 枚举） |
|---|---|---|---|
| 套餐周期积分 | 每月发放当月全额 | 当月周期末清零 | `SUBSCRIPTION_RENEWAL` |
| 加油包 | 购买即到账 | 购买时按 SKU 配置效期（种子统一 7 天，运营可改） | `PURCHASE_PACKAGE` |

- **付费周期三档与积分发放解耦**（#294）：单月购买 / 连续包月 / 包年付费只影响价格折扣；**任何周期档积分一律按月发放、月度清零**。包年 = 一次支付 12 个月费用，不是一次发 12 个月积分。
- 兑换码（`REDEMPTION_CODE`）、活动礼包（`REGISTER_GIFT`）同样发积分批次，机制不变只换单位。
- **trial 发放**：trial 积分为 workspace 首次开通时一次性发放（幂等键 `grant:trial:<workspaceId>`，每 workspace 终身一次防重复领取），不按月刷新、不经支付通道。

### 1.1a 发分来源：内部周期发分调度器（单一真相）

**发分与支付事件解耦**：支付事件（checkout/续费 webhook）只改订阅状态，**所有周期积分批次统一由内部「周期发分调度器」发放**（跑在现有 job-worker/pg-boss 基建上）：

- **账期锚点** = 订阅起订绝对时间戳（升级重开即换新锚点）；每个发放周期 = 锚点 + N 个整月（绝对时间戳滚动，无时区歧义；存储一律 UTC）。
- 调度器扫描 active（含 past_due 宽限内不发，见 1.3a）订阅：当前 cycle 到期且下一 cycle 已支付覆盖 → 发放下一 cycle 批次。单月购买 = 仅 1 个 cycle；连续包月 = 每成功续费覆盖 1 个 cycle；包年 = 一次支付覆盖 12 个 cycle。
- **幂等键** = `grant:sub:<subscriptionId>:<cycleIndex>`；调度器崩溃/停机后按锚点重算缺失 cycle 补发，幂等键防重放。
- **对账与告警**：日对账任务断言「每个已支付覆盖且已到期的 cycle 都存在对应 grant」；发现「已扣款未发分」→ 运营告警（复用通知桥）。重复 webhook 靠幂等键吸收，漏 webhook 靠调度器兜底。

### 1.2 扣费顺序：FEFO

所有消耗从**最先过期的批次**扣起（`expirationDate ASC NULLS LAST`，grant-lot 现成排序），周期积分与加油包批次统一排序，不分池。

### 1.3 套餐变更语义（#292/#293 全锁）

| 场景 | 语义 |
|---|---|
| 升级（含 trial→付费） | 原套餐周期积分**清零**；升级当日按新档全价重新起订、发新档全额积分、周期重开。**加油包批次不清零**，按自身效期跨越升级。全系统仅此一条升级规则，无特例 |
| 降级 | **下周期生效**：当期高档积分与权益用到周期末，下周期起按低档发放计费。零折算零没收 |
| 退订/到期不续费 | 周期积分随周期末自然清零；**未过期加油包在效期内照常可用**（单独付费批次永不没收）；其余权益（并发/存储/队列优先级）回落默认用户态 |

好记口径：**升级=当日重开（加钱立享），降级=下周期生效（付过的用完）**。

### 1.3a 周期档切换与续费失败（Codex 复核补锁）

- **同档换周期档**（单月↔连续包月↔包年）：一律**下周期生效**——当前已付周期走完，下周期起按新周期档计费。不立即切换、不补差价、不动积分（发分与周期档解耦，1.1a）。与降级同一条「付过的用完」原则。换档同时升降套餐档的，按套餐档规则定生效时点（升档=当日重开并可同时改周期档；降档=一并下周期生效）。
- **续费扣款失败**（连续包月/包年）：进入 `past_due` **宽限 7 天**——已发批次照常可用、不发新 cycle 批次；宽限内补款成功 → 调度器补发当期批次（幂等键防重）；宽限期满未付 → 视同退订（§1.3 退订行语义）。
- 实施面注记：`PlanInterval` 现仅 `month|year`，需扩展为可区分单月购买/连续包月/包年的三值枚举（命名实施定）。

### 1.4 积分不足

阻断提交 + 双出口引导（买加油包 / 升级套餐），不透支。加油包即为「周期中途不够」的承接出口。

## §2 账本设计：复用三件套，消灭条数桶

#291 盘点结论 + Codex 复核校准：**账本模式不重写，但改造是 schema 级收敛而非改名**。生产写入权属主一句话钉死：**积分账的唯一生产写入者 = P1（GrantLot + ProductUsageLedger）；P0 `product-service` 四桶 entitlement 整体退役为 cutover/legacy 只读，不承担积分制任何写入**——「预扣状态机」的生产实现即 P1 ProductUsageLedger 既有的 reserve/settle/refund，P0 只是同一模式的退役先例，实施 lane 不得再向 P0 写账。

| 现有资产 | 复用 | 改造（实际深度） |
|---|---|---|
| `p1/foundation/grant-lot.ts` + `postgres-grant-lot.ts` 批次账本 | FEFO 算法、交易类型枚举、`grant:`/`consume:` 幂等骨架 | **schema 级**：resource 已进入实体/交易/投影/DB 约束/索引/**锁键**/周期 cohort（postgres-grant-lot.ts:90,501,1206），全面收敛为单资源 credits（新表或列收敛由实施定，迁移含数据面） |
| `p1/product-billing/product-usage-ledger.ts` 任务预扣 | 一任务一幂等 reserve/settle、与 GrantLot 任务链/批次链分离 | `ProductUsageUnit[]`→积分 quantity **连带**：product-quote 合同（product-quote.ts:223）、SQL 聚合（product-billing/postgres-repository.ts:197）、quote-service/server-quote-authority、submission-coordinator 扣批次键、harness 退款关联（product-billing-settlement.ts:56） |
| `product/product-service.ts` 预扣状态机 | 仅作模式参照（终态互斥幂等、amount 抽象整数） | **整体退役只读**，四桶 entitlement 与 `resource` 联合类型随 P0 退役；402 语义由 P1 报价/预扣路径给出「积分不足」 |

配套收敛（均出自 #291 清单，文件级明细见票内三分类表）：

- **生产真相只留 P1 积分账本**；P0 `product-service` 四桶 entitlement 仅作 cutover/legacy 只读。
- **消灭三套桶词汇**（P0 `content/package` / P1 `copy/audio` / 公开 `copy/image/video`），不再新增第四套；供应侧 freeze 的 resource 维度保留（成本归因用），与商家积分严格隔离。
- 套餐配置收敛**单源**：`plan.allowances.*`（admin-config）与 `plans.ts` env 双源退役，新键 `plan.credits.*` 只走 admin-config 治理链（草稿/发布/回滚沿用 EntitlementPolicy revision 机制）。
- 五层解算（platform > plan > account > campaign > request）保留：`PlatformHardLimits.maxAllowance` 改总积分上限；`AccountAllocationTarget` 的 allowance target 改积分。
- **新增：作业报价表**（现行「每类 1 单位」定价函数 `productUsageUnits` 退役）——报价 = 该次作业命中的 CatalogModel×操作积分价 × 产出数量（多张按张数乘、视频按时长档取价）。报价服务（quote-service/server-quote-authority）输出「预计消耗 N 积分」。

## §3 运营定价面（后台）

### 3.1 模型积分定价

- 粒度：**CatalogModel × 操作**，8 种操作全覆盖（copy.generate/adapt、image.generate/edit/reference_transform、video.generate、audio.speech/sfx）。
- 视频按 **15/30/60 秒三档显式各设一价**；多张图按张数乘单价。
- 定价字段挂在现有模型目录治理面（admin-model-control 的草稿/发布/回滚流），定价变更走 revision 留痕。
- **失败退还开关（模型级）**：每个 CatalogModel×操作一个布尔配置「失败是否退还积分」，随上游供应商是否支持失败退费而设。开关状态必须投影到前台报价提示（§6.2）。
- 积分价为产品侧概念（D-061）：定价界面可展示运营参考信息，但**永不把上游成本字段写入产品侧合同**。

### 3.2 套餐与周期折扣

- 四档结构保留（trial/starter/growth/pro），每档配置：月积分数、基准月价、（非积分权益：并发/存储/队列优先级/支持等级照旧）。
- **付费周期三档折扣系数**：单月购买（基准 1.00）/ 连续包月（种子 0.90）/ 包年付费（种子 0.75），系数后台可改，改动即时作用于价格页与下单价。

### 3.3 加油包 SKU 管理

SKU 三要素全可配：积分数 / 售价 / 效期。开业种子三档见 §7。原则性约束（写入运营面提示，不做硬校验）：加油包每分单价应高于所有套餐档，保护订阅。

### 3.4 价格页参考数字面板（#294 轮廓采纳）

- 「约可生成」数字 = 建议值（自动换算列）+ 已发布值（可编辑列）+ 状态列（一致/偏离 N%）。
- 建议值 = 套餐月积分 ÷ 参考模型单价；参考模型每类别一个，运营指定（文案/图片/视频，视频固定用 15 秒档口径）。
- 模型定价变动 → 偏离提示自动亮起；「全部采用建议值」+「确认发布」两动作；**前台永远只读已发布列**。

## §4 扣费与退还流

```
报价（quote：模型价×数量，含「失败退回/不退回」标注）
  → 余额检查（Σ 未过期批次 remaining − 冻结中 ≥ 报价？否 → 阻断+双出口）
  → 预扣（reserve：FEFO 锁定批次份额，写 reservation，幂等）
  → 生成执行
      ├─ 成功 → commit（终态，不二次扣账）
      ├─ 失败 → 按该模型「失败退还」开关：
      │     开 → refund（份额回原批次；若批次已过期按原批次效期处理：过期批次份额不复活，直接损耗记账，见 4.1）
      │     关 → commit（积分照扣，前台已在报价时明示）
      └─ 超时/系统异常 → expire 语义 = refund（系统责任一律退，沿用 reservation TTL sweeper）
```

### 4.1 退还与批次过期的边界

refund 回到**原扣批次**；若退还发生时原批次已过效期，退还份额随批次作废（不跨批次复活）。此边界必须写进积分明细页的流水行（「已退回 N 分（批次已过期，未入账）」），防客诉无据。

### 4.2 原子性硬约束（Codex 复核补锁）

**余额检查 + ProductUsage reservation + GrantLot FEFO 扣减必须在同一数据库事务内完成**，并持有 **workspace 级积分锁**（现锁按 `(workspaceId, resource)` 隔离——postgres-grant-lot.ts:501，积分制下收敛为 workspace 单一 credits 锁），否则并发请求可同时通过余额检查后超扣。现有 `postgres-creation-submission-store.ts:64` 已把 ProductUsage 与 `consumeWithClient` 放同一事务，该模式为强制基线沿用。

### 4.3 幂等与对账

- grant/consume 幂等键命名空间分离纪律沿用（supply-ledger-fields 既有断言）。
- 商家积分账与供应侧成本账**双账并行**：每笔 commit 关联供应侧 freeze 引用，用于运营毛利对账，永不投影给商家。

## §5 支付通道：Waffo Pancake 切换与 Creem 退役

依据 #290 调研（详情与文件级清单见票内资解）：

### 5.1 产品建模

- 套餐 = Waffo **订阅产品**（**三个付费档** starter/growth/pro × 三周期档，按 Waffo 产品组组织）；加油包 = Waffo **一次性商品**（三 SKU 各建独立 Product）。**trial 不建 Waffo 产品**——免费档不经支付通道，积分由 §1.1 trial 一次性发放规则供给。
- `priceSnapshot` 动态定价**不启用**（离散积分档位即离散 Product；未来若做自定义积分数量购买再评估）。
- 测试环境产品须 `.publish()` 后方可上生产。

### 5.2 集成面

- SDK：`@waffo/pancake-ts`；必需凭据 `WAFFO_MERCHANT_ID` + `WAFFO_PRIVATE_KEY`。
- **验签换血（最大实现改动点）**：Waffo webhook = RSA-SHA256 + `X-Waffo-Signature` 头 + 平台级公钥（Test/Production 各一），与现有 Creem/Stripe 的共享密钥 HMAC 完全不同。`verified-webhook-event` 合同扩展一种验签方式，新增 `provider/waffo.ts`。
- **provider 扩展全清单**（Codex 复核补）：不止新增 provider 文件——provider 类型联合（`types/index.d.ts:93` 现仅 `stripe|creem`）、注册表分派（`payment/index.ts:32`）、webhook verifier 分派（`webhook-settlement.ts:142` 现硬编码两家）、env/凭据装配、payment 持久化 provider 字段，全在改造面。
- 事件映射：`order.completed` 等映射到现有 settlement lifecycle；**加油包结算路径独立于 `plan-checkout-bindings` 套餐 lifecycle 状态机**——`PaymentScene` 新增场景（现仅 `subscription | lifetime`，新增积分增量场景，语义=入账一个 `PURCHASE_PACKAGE` 积分批次）。
- **续费对账合同**：订阅续费成功事件的确切事件名与 billing-period 标识随 §5.4 实测钉死后写入实施票；结算侧只负责「记账已支付覆盖的 cycle 区间」，发分/补发/漏发修复一律走 §1.1a 调度器与日对账（重复事件幂等吸收、漏事件调度器兜底、「已扣款未发分」告警）。
- **退款落账合同**（本轮只落账+告警，人工处置；自动化退款账本与已消费积分追回另立后续专项）：新增退款事件表（现 payment 表无退款字段、事件联合无退款成员——app.schema.ts:136、payment/types.ts:190），字段=providerEventId（幂等唯一键，重放不重复落账）/orderId/scene/金额/事件状态（succeeded|failed）/rawPayload/receivedAt/处置状态（pending_review→resolved）+处置人与处置备注；落账即触发运营告警（通知桥）；处置动作留审计，不自动改积分批次。

### 5.3 Creem 退役

沿用 Stripe 退役审计模式（`stripe-retirement-audit`）：`provider/creem.ts`、webhook 路由、env、配置、文档、测试等 20+ 文件清单见 #290 资解；退役完成判据 = 审计测试断言仓内无 Creem 活代码引用。

### 5.4 人工前置（实施前用户/运营完成）

#290 标记 4 项 + 复核补 1 项，待 Waffo Dashboard/测试环境实测：客户门户是否存在、商户开通流程、webhook 是否有 API 注册方式、一次性/订阅 checkout 事件是否互斥、**订阅续费成功事件的确切事件名与 billing-period 字段**。实施票开工前核销。

## §6 前台四面改法

### 6.1 价格页（#294 方向 A「积分卡阵」胜出）

- 结构：顶部**付费周期切换条**（单月购买/连续包月/包年付费，切换即时重算价签：折后价+划线原价）→ 四档套餐卡横排 → 卡底虚线小账。
- 套餐卡：积分大数字为主角（「500 积分 / 月」），价格次之；卡底小账 =「约 X 条文案 / 约 Y 张图 / 约 Z 条视频（15 秒）」+「按默认模型估算，仅供参考」。
- **加油包入口 = 价格页底部横条**（三 SKU：积分/售价/「买后 7 天内有效」），文案主打「月中不够、随买随用、先到期先扣」。
- 落选方向留作迭代候选（不进本轮）：B 的「每 1 积分折合 ↓更划算」行、C 的「差一点补加油包」推荐计算器。

### 6.2 工作台三露脸位（#294 共享轮廓）

1. 顶栏余额徽章：总余额 + 最近到期批次提示（「其中 X 分 N 天后到期」）。
2. 生成前报价 chip：「本次约消耗 N 分」+ 该模型退还开关双态（「失败自动退回」/「该模型失败不退回」）。换模型报价即时刷新。
3. 积分不足拦截：「还差 N 分」+ 买加油包 / 升级套餐双出口（§1.4）。

### 6.3 积分明细页（新增，决策 11）

批次视图（每批：来源/余额/效期/状态）+ 流水视图（每笔：作业、预扣、结算/退回/过期、关联批次）。失败退回与「批次已过期未入账」行必须可见（§4.1）。这是失败退还开关与效期规则对用户可信的唯一凭证。

### 6.4 设置账单卡与 admin

- `settings/billing` 卡改积分口径：当前套餐/周期档、本月积分、续费与升级入口。
- admin 面板改造清单（plan 编辑四拨号盘→积分、admin-config schema、目录定价字段、价格页参考数字面板、周期系数表、加油包 SKU 面板）与 i18n 词条（27 键：`workbench_quote_usage_*`/`account_usage_*`/`pricing_output_*`/`admin_plan_*`）明细见 #291 资解 §2.3/§2.4。产出规格文言（`creative_output_*` 条/张描述）保留——**产出规格 ≠ 计费单位**。

## §7 数值种子附录（#293，全部为后台可改种子）

**操作基准价**（细刻度，文案 1 分=全系统底线，运营对照上游报价校准）：

| 操作 | 积分 |
|---|---|
| 文案（generate/adapt） | 1 分/条 |
| 音频（speech/sfx） | 2 分/次 |
| 图片（generate/edit/reference_transform） | 5 分/张 |
| 视频 15s / 30s / 60s | 50 / 90 / 160 分/条 |

**套餐**（月积分；每分单价严格递减）：

| 档 | 积分/月 | 单月基准价 | 每分单价 |
|---|---|---|---|
| trial | 100 | 免费 | — |
| starter | 500 | ¥199 | ¥0.398 |
| growth | 1300 | ¥499 | ¥0.384 |
| pro | 2800 | ¥899 | ¥0.321 |

**周期折扣系数**：单月 1.00 / 连续包月 0.90 / 包年 0.75。

**加油包**（效期统一 7 天种子，运营可改；每分单价恒高于套餐、包内递减）：100 分 ¥49 / 300 分 ¥139 / 1000 分 ¥429。

**价格页参考换算**：文案 1、图片 5、视频按 15 秒档 50；示例 starter＝约 500 条文案 或 100 张图 或 10 条 15 秒视频。

## §8 退役与迁移

- **一刀切**（决策 7）：无真实付费存量，无双轨。条数体系退役/改造/保留三分类**文件级权威清单 = #291 资解**（退役 18 项/改造 30+ 项/保留 11 项，含测试与 e2e 清单），实施票直接按票内表格领活。
- `progressive-rights*` 为素材授权非计费，**明确不动**（防误伤，#291 特别标注）。

## §9 验收门（行为为证）

1. **FEFO**：构造周期批次+两个不同效期加油包，连续消耗断言扣序=效期升序。
2. **预扣闭环**：成功 commit 不二次扣；失败且开关开 → 退回原批次；失败且开关关 → 照扣且报价时已明示；超时 → sweeper 退回。
3. **升级清零**：升级当日周期积分清零、加油包存活、新周期起点=当日；降级当期不变下周期生效；退订后加油包效期内可消费。
4. **价格页发布流**：改模型价 → 偏离提示亮 → 采用建议值 → 确认发布 → 前台数字更新且带「仅供参考」标注；周期切换条三档价签换算正确。
5. **Waffo 真跑**：测试环境订阅+加油包各完成一次 checkout→webhook 验签→结算入账（积分批次到账），测试卡 4576750000000110；Creem 退役审计断言通过。
6. **明细页自证**：上述 1-3 每笔在明细页可见对应流水行。
7. **并发不超扣**：N 个并发提交争抢同一份余额，断言只有余额覆盖内的请求通过（同事务 + workspace 积分锁，§4.2）。
8. **发分调度**：包年订阅模拟 12 个 cycle 逐月发放；调度器停机跨 cycle 后重启，断言缺失 cycle 补发且幂等键防重；构造「已扣款未发分」断言日对账告警触发。
9. **续费失败宽限**：past_due 期内已发批次可用、不发新批次；宽限内补款 → 补发当期；宽限期满 → 走退订语义（加油包存活、权益回落）。
10. **退款落账幂等**：同一 providerEventId 重放不产生第二条退款记录；落账触发运营告警。
11. **trial 防重**：同一 workspace 重复开通路径不产生第二个 trial 批次。

## §10 实施开票建议切分

按依赖序五个 lane（批次内可并行，语义锁纪律沿用 agent-substrate 规范）：

| lane | 内容 | 硬依赖 |
|---|---|---|
| L1 账本与合同 | grant-lot/product-service/usage-ledger 积分化、contracts 重写、配置单源化、报价表 | 无（起点） |
| L2 运营定价面 | 模型定价+退还开关、套餐/周期系数/加油包 SKU、参考数字面板 | L1 合同 |
| L3 Waffo 通道 | provider/waffo + RSA 验签、加油包结算场景、Creem 退役 | L1 合同；§5.4 人工前置 |
| L4 前台四面 | 价格页 A 结构、工作台三位、明细页、账单卡、i18n | L1 合同、L2 面板合同 |
| L5 退役清扫与验收 | #291 退役清单收尾、文档 supersede 对照、§9 验收门全绿 | L1-L4 |

**细粒度拆票（2026-08-01 增补）**：L1（#298）整票执行不拆；L2–L5 按开发序拆为十张子票（sub-issue 挂各 lane 票下，blocked-by 边为机器判据），领票/交底/交验/合入以子票为单位，lane 票转跟踪父票：CB-01 运营定价后台 #303（←#298）、CB-02 Waffo 订阅主链 #304（←#298）、CB-03 工作台三露脸位 #305（←#298）、CB-04 积分明细页与账单卡 #306（←#298）、CB-05 参考数字面板 #307（←CB-01）、CB-06 加油包结算与续费退款 #308（←#298、CB-02）、CB-07 Creem 退役 #309（←CB-02、CB-06）、CB-08 价格页方向 A #310（←CB-05、CB-02、CB-06）、CB-09 条数退役清扫 #311（←#298、CB-03、CB-04、CB-08）、CB-10 全门回归验收 #312（←全部）。§11.4 的 lane×验收门映射按子票承接细分（门 4 后台半边=CB-05、前台半边=CB-08；门 5=CB-02/CB-06；门 6=CB-04；门 10=CB-06；L5 两票=清扫与全门回归）。

## §11 开发纪律与提交合并规范（Codex 实施轮）

实施票 = [#298](https://github.com/legacy-origin-a/legacy-web-repo/issues/298)（L1）/ [#299](https://github.com/legacy-origin-a/legacy-web-repo/issues/299)（L2）/ [#300](https://github.com/legacy-origin-a/legacy-web-repo/issues/300)（L3）/ [#301](https://github.com/legacy-origin-a/legacy-web-repo/issues/301)（L4）/ [#302](https://github.com/legacy-origin-a/legacy-web-repo/issues/302)（L5）。通用纪律全文以 `docs/ops/agent-dispatch-runbook-2026-07-29.md` 为准（环境铁律／关票纪律／受阻轮询协议全部适用），本节只列本效力面的增量与收束，冲突时以手册为底、本节为特化。

### 11.1 角色与主权

- **开发 = Codex lane agent**：按 §10 领票，一票一 lane 一 worktree 一分支。票面即任务书，票下「主控裁决／依赖更新／主控合同增补」前缀评论覆盖票面原文。
- **总控 = 主控会话**：验收、合入 main、关票、修订本 spec 的唯一主权方。lane **不 push、不关票、绝不移动 main**、绝不以「主控」前缀发评论；「已合入」唯一有效凭证 = `docs/ops/merge-ledger.md` 出现对应 sha 行。
- **决策冲突序**：本 spec 终稿 > 各票资解（#290–#295）> 票面文字。发现冲突落票下评论并停下问主控，不得自行扩边界。

### 11.2 开工与依赖

- 开工顺序 = §10 硬依赖列，且以票上**原生 blocked-by 边**为机器判据：被阻塞票未解锁（阻塞票未关）不得开工，只准做零 rebase 面预备（schema 草案／只读盘点／设计稿）。
- L1（#298）为唯一起点；L2/L3 于 L1 合入台账记账后解锁；L4 需 L1+L2；L5 需 L1–L4。
- **凭据纪律**：Waffo 测试凭据只住 `docs/_private/waffo.env`（gitignored）。代码与测试一律经 env 注入读取；明文**永不**进代码、票面评论、commit、日志或任何脚本 argv（手册「秘密不进 argv」条适用）。

### 11.3 分支与提交

- worktree：`git worktree add ../lane-<票号> main`，分支名 `lane-<票号>`；主 checkout 只留主控复核合入。
- commit message 英文、祈使句、小步提交，subject 引用票号，例：`feat(credit): converge grant-lot to single credits resource (#298)`。
- 每日 rebase main、不回灌 merge；上游 lane 合入后的首次 rebase 附跑上游关票验收断言（rebase 六条照旧）。

### 11.4 交验标准与 lane×验收门映射

交验 = 票下评论逐条对应票面验收，附运行证据（file:line／命令输出／`git ls-files` 结果），且手册四门齐备：消费者证明（D-150）、可达性证明、出口证明（含未授权入边负向）、反向复核（D-157 双向）。

主控亲验按下表对 §9 验收门验收；「半边」指该门跨 lane，先合入方交付自己半边的行为证据，后合入方补全门：

| lane | 必绿门（§9 编号） |
|---|---|
| L1 #298 | 1 FEFO、2 预扣闭环、3 变更语义、7 并发不超扣、8 发分调度、11 trial 防重；9 的宽限语义账本半边 |
| L2 #299 | 4 的后台半边（改价→偏离提示→采用建议值→确认发布） |
| L3 #300 | 5 Waffo 真跑、10 退款落账幂等；9 的 past_due 事件半边 |
| L4 #301 | 6 明细页自证；4 的前台半边（已发布数字更新＋仅供参考标注＋周期切换条换算） |
| L5 #302 | §9 全 11 门回归全绿 + Creem 退役审计断言（`git ls-files` 空输出口径） |

### 11.5 合入流程（主控亲验六步）

1. lane 交验评论到位 → 主控在主 checkout diff `lane-<票号>` 分支，逐行溯票面范围，越界改动打回。
2. 复跑该 lane 必绿门 + `typecheck` + 受影响测试面（locale:compile 冲突纪律照旧，不与在跑 dev 并发）。
3. 反向复核双向跑：承诺→实现、实现→生产可达各一遍。
4. 主控亲手 merge 入 main，`docs/ops/merge-ledger.md` 记 sha 行（该文件只由主控提交）。
5. 主控前缀评论关票。
6. 依赖它的后续 lane 以台账 sha 为解锁信号，首次 rebase 附跑上游验收断言。

### 11.6 票下交底纪律（不落评论＝不存在）

会话上下文、worktree、终端输出都是易失面；**票下评论是本效力面唯一持久信息载体**。凡未落票下评论的信息，主控验收时一律视为不存在。lane 在四个时点必须交底：

1. **开工交底**：领票即发——对票面范围的理解、实施切步计划、语义锁自查结果、预计触碰的文件面。
2. **过程交底**：票面未预见的中间决定（实现取舍、接口命名、迁移策略）、与 spec／票面的偏离或冲突、影响其他 lane 的接缝变化——**发生即落评，不攒到交验**。
3. **受阻交底**：按手册 §五——同一障碍只撞一次，第一次受阻即发交底评论（卡在哪／等什么／解锁判据），随后待命不空转。
4. **交验交底**：§11.4 证据包（逐条验收＋file:line＋命令输出）。

主控侧对等适用：裁决、合同增补、合入记录只走票下评论与 merge-ledger 台账，不走会话内口头；spec 修订必附 main commit sha。
