# D-088 视频重生成计费合同

- 日期：2026-07-20
- 状态：accepted
- 对应主决策：D-088

## 1. 用户动作与计费语义

| 用户动作 | 新生成任务 | 新上游请求 | 独立报价/计费 | 原版本处理 |
|---|---:|---:|---:|---|
| 重新生成此镜头 | 是 | 是 | 是 | 保留，结果作为候选镜头 |
| 重新合成整段 | 是 | 是 | 是 | 保留，结果作为候选成片 |
| 恢复/核验同一 supplier task | 否 | 否 | 否 | 继续原任务 |
| 轮询、下载或采用已有结果 | 否 | 否 | 否 | 不变 |
| 纯确定性镜头排序、独立字幕资产文本修改 | 否 | 否 | 否 | 创建普通 derived revision，不产生生成费 |

“一次生成”表示一次用户明确确认并提交的新任务，不表示所有模型统一按一次固定价格收费。复用旧分镜、素材、首帧、字幕、prompt 或参数只影响输入和生成范围，不免除新请求费用。

## 2. 计价规则解析

报价必须在所选 CatalogModel 解析到可执行 Deployment 后完成，并冻结对应 price/QuotePolicy revision。首轮支持：

| billingBasis | 计费数量 | 前台必须说明 |
|---|---|---|
| `per_request` | 每个新请求为 1 | `本次按请求计费` |
| `per_output_second` | 按上游规则得到的生成成片计费秒数 | `本次按生成成片 N 秒计费` |

按秒规则不得假设所有供应商都按原始目标时长直接相乘。价格 revision 必须冻结上游规定的最小时长、步进/取整方式和计费秒数口径。单镜按本次镜头的目标/实际计费秒数，整段按本次完整成片的目标/实际计费秒数。模型、时长、范围或报价所依据的 Deployment 改变时必须重新报价。

任务内 fallback 只有在冻结候选集合内且不改变用户已确认产品报价/上限时才可自动执行，供应成本差额分别进入各 ProviderAttempt 的成本事件；若替代路径超出确认范围，任务必须停在需要重新报价的状态，不能先生成再补告知。

## 3. 报价确认

提交前确认区至少展示：

- `重新生成此镜头`或`重新合成整段`；
- 所选产品模型，不暴露 Provider、Deployment、Credential 或 fallback 顺序；
- 目标输出时长；
- 按请求或按生成成片秒数计费；
- 预计产品额度/金额；
- 预计完成时间；
- “提交后会创建新的生成任务并单独计费”。

用户确认后冻结 task-level ProductQuoteSnapshot 与 RouteSnapshot。ProductQuoteSnapshot 至少包含 CatalogModel、产品 QuotePolicy revision、billingBasis、产品单价/额度公式、requestedDuration、estimatedBillableDuration、最低消费/取整规则、confirmedProductCharge 与 maximumAuthorizedCharge。前台显示产品报价，供应商身份和采购价格只进入授权后台与账本。

每个 ProviderAttempt 另行冻结 ProviderCostSnapshot，包含实际 Deployment、supplier price revision、supplier billingBasis、单价/币种、usage 规则和预计供应成本。产品报价只结算一次，供应成本则按 attempt 分别结算；不能用一个“最终 Deployment”快照同时承担两层事实。

按成片秒数计费首轮采用“上限预授权、按可信实际计费秒数结算”：报价先按目标时长叠加 supplier 最小时长/取整规则形成最高产品授权；完成后实际计费秒数更少则自动退回差额，超过已确认上限不得静默补扣，供应商超产差额由平台承担。用户主动增加目标时长必须重新报价；缺少可信 usage/成片时长证据时保持 estimated/unknown，不能标成 reconciled。

## 4. 任务、尝试与双账本

```text
one user-confirmed regeneration
  -> one derived Task / GenerationJob
  -> one idempotent ProductUsage reservation and settlement
  -> one frozen ProductQuoteSnapshot + RouteSnapshot
  -> one or more governed ProviderAttempts
  -> one ProviderCostSnapshot + ProviderCostEvent stream per attempt
```

- 用户再次确认重生成时，创建新 task/job、稳定幂等键、报价与独立产品计费。
- 相同提交因网络丢响应而重放，必须返回同一 task/job 与同一预占，不能重复扣费。
- 同一任务内部仅在 D-059 接受态允许时执行 fallback；每个 ProviderAttempt 分别记录供应成本，但不能静默把一个用户任务扣成多次产品生成。
- fallback 不改变已确认产品报价；无法保持报价时停止并要求用户重新确认，不能静默切换计费基础。
- 产品额度与供应成本分别进入 ProductUsageLedger 与 ProviderCostLedger；两者不能用同一数字互相覆盖。

## 5. 重试、失败、取消与结算

- “恢复/核验”继续同一个已受理 supplier task，不创建新请求、不重新计费。
- 任何从界面创建新用户生成任务的“重试”必须重新报价并再次确认。
- 中间 ProviderAttempt 的 `rejected_before_accept` 只关闭该 attempt 并记录其供应成本状态；如果冻结路由仍允许安全 fallback，用户任务和产品预占继续存在。
- 只有整个用户任务在所有获准 attempt 结束后以最终未受理/失败状态关闭时，才按既有补偿合同释放或退回一次产品预占。
- `accepted`、`acceptance_unknown`、失败或取消后的供应成本，以冻结价格 revision 和 supplier usage/账单证据对账；未知成本保持 unknown，不伪装为零。
- 产品是否退款遵循已发布产品退款政策，与供应成本是否已经发生分开记录；供应侧额外 attempt 不得直接变成用户侧额外扣费。按秒成功任务低于确认上限时按本合同自动退回差额。
- 按秒结算优先使用可信上游 usage/账单证据；缺少证据时只能保持 estimated/unknown，不能把估算冒充 reconciled。

## 6. Result Workspace 状态

- 当前成片和历史 revision 在重生成期间保持可播放、可下载、可采用。
- 单镜结果完成后成为镜头 Asset/候选；“使用此镜头”把选择写回明确的 Task/Job/Asset 镜头状态，VideoWorkflow 仅作派生读模型，不把未合成镜头写成完整 ContentPackage 成片。若需要新成片，用户还要明确提交并支付“重新合成整段”。
- 整段结果完成后作为完整视频候选出现；只有“使用此成片”才写入新的 ContentPackage revision。
- 运行中显示本次范围、模型、目标时长、预计费用、任务状态和取消影响。
- 失败反馈分别说明结果、产品额度处理和供应成本是否仍待对账，不使用笼统“生成失败”。

## 7. 后台可视化管理

后台 QuotePolicy/Deployment 管理至少支持：

- `per_request | per_output_second` 计费基础；
- 单价、币种、最小时长、步进/取整、usage 证据来源和生效 revision；
- 用模型、Deployment、价格 revision、任务或 supplier task id 反查报价、尝试和双账本；
- 预览同一模型在单镜与整段、不同时长下的预计产品费用与供应成本；
- 价格 revision 发布、回滚和受影响任务预览；历史任务继续引用旧 revision。

## 8. 当前实现缺口与验收

当前 `RouteCandidate` 已有 `priceRevision/unitPriceMicros/unit`，Foundation 已有 RouteSnapshot、ProviderAttempt、ProviderCostEvent 和产品用量预占/补偿基础，但尚不能据此声称本合同已实现。首轮验收至少证明：

1. 单镜与整段每次确认都创建新的任务和独立计费记录，旧成片不被覆盖。
2. 按次模型显示一次请求报价；按秒模型显示生成成片秒数、取整/最低消费规则和报价。
3. 切换模型、范围或时长会刷新报价，提交后冻结对应 revision。
4. 同一幂等提交重放不重复扣费；用户再次主动提交才产生新费用。
5. fallback attempts 分别记录供应成本，但一个用户任务只结算一次产品用量。
6. ProductQuoteSnapshot 与每个 attempt 的 ProviderCostSnapshot 可独立回放；超出报价范围的 fallback 会暂停重新报价。
7. 按秒任务低于确认上限自动退回差额，高于上限不静默补扣，缺 usage 证据不伪装最终结算。
8. 单镜采用只更新镜头选择；只有完整成片采用写 ContentPackage revision。
9. 轮询、恢复、下载、采用和无需媒体重渲染的纯确定性编辑不产生生成费；烧录字幕或上游重合成必须重新报价。
10. 中间 attempt 拒绝不提前退产品预占；任务终态、取消和未知接受态分别呈现产品额度与供应成本状态。

仍待以真实上游合同确认每个模型的 usage 证据、取整、最低消费及取消/失败退款规则。估算与最终计费秒数不一致的首轮产品侧规则已经锁定为低于上限自动退回、高于上限不静默补扣。
