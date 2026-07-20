# 上游渠道后台与注册用户分配模型

> 日期：2026-07-19
> 状态：产品架构建议；D-061～D-063 已确认上下游边界、用户选择粒度与分配机制。

## 1. 正确的问题模型

本产品不是 New API / Sub2API 的管理前端，也不应尝试进入上游供应商的管理面。正确链路是：

```text
模型厂商官方 API ─┐
                  ├─ 我方供应控制面 ─ 能力池/路由策略 ─ 套餐与权益 ─ 注册账号/工作区 ─ 生成任务
第三方上游供应商 ─┘
  └─ 其内部可能使用 New API、Sub2API 或其他系统
```

我方后台需要同时拥有两份彼此独立的真相：

- **供应侧真相**：向谁采购、用哪个账号/token、有哪些真实模型能力、价格/余额/限额、健康、来源与数据政策。
- **产品侧真相**：哪个注册账号拥有什么能力、额度、并发、优先级、质量档和使用记录。

两者通过版本化能力池与 RoutePolicy 关联，不让用户权益直接绑定某个上游 token，也不把上游余额当用户余额。

## 2. 后台一等对象

| 对象 | 回答的问题 | 核心字段 |
| --- | --- | --- |
| `ProviderProfile` | 真正向谁采购、谁负责服务与数据 | 运营/合同/开票主体、联系人、支持、SLA、数据处理方、来源证明、状态 |
| `SupplyContract` | 买到的是什么、什么价格与承诺 | 商品/模型范围、价格与币种、结算方式、退款、容量、SLA、数据条款、变更通知、有效期 |
| `CredentialAccount` | 我方在哪个上游账户消费 | account/token secret ref、余额/授信、充值与账单账号、RPM/TPM/并发、版本和生命周期 |
| `ExecutionChannel` | 实际请求发到哪里 | base URL、协议、区域、header/endpoint revision、框架指纹、opaque route、内部重试声明 |
| `Deployment` | 某内部模型能力如何落到该渠道 | CatalogModel、provider alias、operations、能力证据、价格 revision、数据策略、健康、生命周期 |
| `SupplyPool` | 哪些 Deployment 可共同兑现一种产品能力 | capability SKU、允许候选、官方/中转限制、质量/成本档、fallback 与预算边界、revision |
| `EntitlementPolicy` | 一个套餐默认给用户什么 | capability SKU、月/日额度、并发、队列优先级、质量档、允许的 SupplyPool、超额规则 |
| `AccountAllocation` | 某个注册账号最终获得什么 | 套餐来源、临时赠送/限制、用户级覆盖、有效期、原因、审批、effective revision |

`gatewayFingerprint = official_native | new_api | sub2api | other | unknown` 只属于 `ExecutionChannel` 的可变元数据。它用于选择探针和风险检查，不能作为 `ProviderProfile`，也不能成为给用户分配的 SKU。

## 3. 供应侧后台信息架构

### 3.1 供应总览

默认展示需要处理的供给风险，而不是供应商 Logo 墙：

- 可用/降级/隔离的 Deployment 数，受影响的产品能力与账号数；
- 余额不足、即将耗尽、限流逼近、账单异常和凭据过期；
- 模型别名/能力/价格/协议发生变化但尚未重新验证；
- 官方 canary 与第三方渠道的质量、错误、usage 或成本差异；
- 供应商集中度：某项能力是否只有单一交易方或单一故障域。

### 3.2 供应商详情

供应商页按真实运营商聚合：合同与支持信息、多个 CredentialAccount、多个 API 入口、模型报价、余额/充值、账单、SLA、数据政策、变更和事件。不能把两个使用同一 New API 框架的运营商合并成一个供应商。

### 3.3 渠道/账户详情

一个渠道需要可视化以下事实：

- endpoint、协议族、框架指纹及可见版本；
- 是否可能在内部跨模型/channel/账号池路由，能否返回真实 request ID、usage 与模型版本；
- 上游重试声明、接受态可见性、超时和错误映射；
- 余额、额度、RPM/TPM/并发、窗口与最近同步时间；
- credential 当前版本、测试/激活/排空状态，只显示 secret metadata；
- 该渠道承载的 Deployment、任务、供应成本和最近异常。

### 3.4 模型能力与发布

不能把上游 `/models` 返回值直接发布给用户。接入流程应为：

1. 拉取或录入上游 model alias，标记为 `discovered`；
2. 人工映射到内部 `CatalogModel`，声明 operation/capability；
3. 运行协议、能力、usage、错误和媒体生命周期 conformance；
4. 绑定价格 revision、数据政策、限额和供应合同；
5. 与官方 API 或已知基准做 canary/eval；
6. `candidate → tested → approved → active` 发布；失败时可隔离、排空和回滚。

上游把 `gpt-*`、`claude-*` 或其他官方名字暴露出来，只是声明，不构成真实性证据。

## 4. 注册用户的分配模型

### 4.1 不直接分配渠道

普通用户不应看到或持有：上游运营商、base URL、API token、账号余额、New API/Sub2API 框架名、内部成本和 fallback 顺序。直接绑定会导致：

- 上游故障时必须逐用户改配置；
- 供应价格、来源和故障域泄漏为产品承诺；
- 上游余额、用户额度和退款责任混在一起；
- 无法在不改变用户体验的前提下切换更可靠的渠道。

用户获得的应是稳定的产品能力，例如：

- `copy.standard` / `copy.quality`
- `image.fast` / `image.quality` / `image.edit`
- `video.short.standard` / `video.short.quality`
- `audio.speech`

能力 SKU 再绑定一个版本化 SupplyPool。用户可选择“任务/质量档”或在高级模式选择内部 `CatalogModel`；实际运营商与 ExecutionChannel 默认由平台选择。

### 4.2 分配层级

按以下优先级计算 `EffectiveEntitlement`：

```text
平台安全与合规硬限制
  > 套餐 EntitlementPolicy
  > 工作区/账号级批准覆盖
  > 活动赠送或临时额度
  > 请求级合法偏好
```

- 硬限制不可被用户级覆盖，例如含人脸素材不得路由到未经批准的第三方渠道。
- 套餐定义可用能力、额度、并发、排队优先级和质量档，不固定单个上游。
- 用户级覆盖只处理客服补偿、灰度、企业合同、风险限制或内部测试，必须有原因、有效期和审计。
- 额度扣减、供应成本和支付金额分账：`ProductUsageLedger`、`ProviderCostLedger`、`PaymentLedger` 不互相替代。

### 4.3 用户详情页

管理员从注册账号详情应能看到并安全操作：

- 账号状态、所属工作区/成员关系、套餐和生效时间；
- 各 capability SKU 的总额、已用、预留、退款与剩余；
- 并发、队列优先级、速率限制和当前 effective policy；
- 允许的质量/模型档及用户级覆盖，附来源、原因、有效期；
- 最近任务、冻结的 RouteSnapshot、失败原因和产品侧退款结果；
- 供应渠道只在授权的支持/审计下钻中显示，secret 永不显示；
- “预览变更影响 → 发布 → 可回滚”，禁止直接改数据库或无审计改余额。

## 5. 每次请求的分配与路由

```text
注册账号/工作区
  → 校验账号状态与 EffectiveEntitlement
  → 预留产品额度和并发
  → 解析 capability SKU / operation / data class
  → SupplyPool 硬过滤
       capability + lifecycle + data policy + plan permission
       health + circuit + balance/quota + max cost
  → RoutePolicy 排序
  → 冻结 RouteSnapshot、credential/price/policy revision
  → 调用上游
  → 分别结算产品用量和供应成本
```

重要边界：

- 上游明确在接单前拒绝时，才可按已发布策略切换下一 Deployment。
- 已接单或接受状态未知时进入查询、对账或人工恢复，不跨渠道盲目重提。
- 某一供应商降级只更新短期健康 overlay，不改用户套餐；新请求可切到同一 SupplyPool 内的其他获准渠道。
- 不允许默认跨越数据信任等级 fallback；从官方 API 切到第三方中转必须已被策略和数据政策授权。

## 6. 对 New API / Sub2API 上游的差异化检查

| 检查项 | New API 型上游 | Sub2API 型上游 |
| --- | --- | --- |
| 隐藏路由 | 询问 channel priority/weight、model mapping、auto-disable | 询问账号池选择、粘性会话、账号类型与跨账号切换 |
| 隐藏重试 | 核验全局/分组 retry 配置与错误触发条件 | 核验账号切换是否构成重新提交及接受态判定 |
| usage/成本 | 区分网关估算、内部倍率和可对账账单 | 区分 token 估算、账号窗口配额和实际供应账单 |
| 身份/来源 | 模型别名不能证明官方来源 | 账号池更难证明实际官方账号和稳定模型身份 |
| 会话 | 验证协议转换、stream/tool/schema | 验证 `session_id` 透传、粘性及不可混用上下文 |
| 媒体 | 按 operation 测 submit/poll/cancel/download | 不因框架名放行；Sora 等以真实可用性为准 |

框架指纹只能决定“多问什么、怎么测试”，不能决定“给哪个用户分配”。

## 7. 首轮开发切片

### P0 — 渠道可登记、可验证、可分配

1. `ProviderProfile + SupplyContract + CredentialAccount + ExecutionChannel + Deployment` 结构化注册表。
2. secret 写入、轮换、测试和排空；不再依赖固定环境变量槽位。
3. model discovery 只进入候选区；通过 operation conformance 后才能发布 Deployment。
4. `SupplyPool + EntitlementPolicy + AccountAllocation` 的 effective policy 计算与预览。
5. 注册账号详情展示套餐、额度、并发、可用能力池、覆盖与审计。
6. HTTP/Worker 读取同一发布 revision，新增/停用渠道无需重启。

首轮模态与渠道强度以后续 D-068/D-069 为准：文本、图片、视频同时进入本闭环；文本生成、图片生成、视频生成各至少两条独立 `live_verified` 渠道，文本改写/适配和图片编辑等次级 operation 至少一条真实渠道。图片/视频同时验收 submit/recover/poll/cancel/download、资产 TTL 与接受态，不能留到下一轮补做。

验收主链：新增真实官方与第三方上游 → 保存 token → 同步/录入模型 → 映射并按三模态探针 → 发布到 SupplyPool → 给测试账号分配套餐 → 分别完成文本、图片、视频任务 → RouteSnapshot 命中对应渠道并持久化媒体资产 → 产品用量与供应成本分别入账 → 隔离一条核心渠道后新任务按接受态和数据政策安全切换。

### P1 — 供给运营与风险控制

1. 余额/账单/限额同步 adapter，标注 `observed | reported | estimated | stale`。
2. Deployment 级持久化 health/circuit、手工隔离、半开探针和自动恢复。
3. 供应成本、单位交付成本、失败成本、集中度与毛利视图。
4. 官方 canary 与第三方渠道的版本化差分测试。
5. 用户级覆盖的审批、到期恢复和批量影响预览。

### P2 — 灰度与商业治理

1. 按账号 cohort / 百分比 canary 发布新的供应渠道。
2. 套餐级质量、最大供应成本与 official-only 等策略产品化。
3. 多角色权限：Supply Viewer、Operator、Credential Admin、Release Manager、Support。
4. 供应账单、RouteSnapshot、产品用量和支付的周期对账。

## 8. 已确认的用户分配结论

用户选择粒度已由 D-062 确认：

- **采用：模型可选、渠道隐藏。** 用户可以选择 CatalogModel，平台仍选择官方或第三方 Deployment；兼顾模型偏好与供应弹性。
- 不采用“模型和渠道都可选”作为普通用户能力；具体供应商只在后台支持与审计中下钻。

账号分配机制已由 D-063 确认：

- **采用：套餐默认 + 用户/工作区覆盖。** 套餐批量定义模型池、额度、并发和优先级；少量例外用有期限、有原因、可撤销的 AccountAllocation 表达。
- 不逐用户复制完整静态配置，也不允许管理员直接编辑数据库余额或历史用量。

在该方案下，上游凭据、余额和具体账号都只属于平台供应侧，不下发给注册用户。
