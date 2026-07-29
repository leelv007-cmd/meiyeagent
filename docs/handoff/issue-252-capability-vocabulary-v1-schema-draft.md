# Issue #252 能力词表 v1：零 rebase schema 草案

> 状态：`NON-AUTHORITATIVE / PREPARATION ONLY`
>
> 本文件只冻结候选数据形状、测试 seam 和开工检查项，不改变运行时行为，
> **不算 M1 已交付，也不解锁 #262**。权威仍是 Issue #252、D-165、
> D-169④、agent-substrate spec v4.1 和派发手册；冲突时按派发手册裁决。

## 1. 当前边界

- spec v4.1 把 #252 实施放在 C1
  （`docs/specs/agent-substrate-dev-spec-2026-07-29.md:594`）。
- A 批须等 #266 合入，B 批须等 #246/#247 合入（`:585-594`）。
- 前置未满足时只准设计、schema 草案和只读盘点（`:612`）。
- 类型/schema 应作为 #252 的首个独立小合入（`:607`）。
- #263 是批次边界删除窗口，不与 #252 mutating 实施并跑（`:610`）。

因此当前禁止修改 production TypeScript、测试或运行时接线。前置满足后先
rebase main，并按 spec `:611` 复跑上游关票断言，再把本草案校准为真实合同。

## 2. 已读现状与单一真相约束

- `SkillRevisionManifest.requiredModelCapabilities` 已存在：
  `apps/core/src/p1/skills/types.ts:40-58`。实施时应收窄/适配这个字段，
  不新增第二个 Skill 能力字段；该文件同时受 #246-A→#258 语义锁约束。
- 14 个 Langfuse 位点已有单一登记表：
  `apps/core/src/p1/harness/langfuse-prompts.ts:3-20`。#252 只定义词表和轴；
  位点绑定由下游 #262 消费，不在本票改 Harness。
- catalog `CapabilityRevision` 目前只有 operation：
  `apps/core/src/p1/model-supply/catalog.ts:79-84`。
- hot assembly 的 `RuntimeCapabilityEntry` 目前只是部署指纹，
  `AssembleCapabilityRequest` 也没有能力要求：
  `apps/core/src/p1/supply-registry/hot-assembly.ts:35-72,151-179`。
  不得把现有 fingerprint 匹配当成能力匹配已经具备。
- 路由的生产/模拟器共用纯函数是
  `planModelSupplyCandidates`
  （`apps/core/src/p1/model-supply/route-planning.ts:77-155`），
  它是后续能力 hard filter 的首选公共 seam。
- 价格存在两层合同：catalog `PriceRevision`
  （`apps/core/src/p1/model-supply/catalog.ts:86-93`）与生产冻结用
  `SupplierPriceRevision`
  （`packages/contracts/src/supply-registry.ts:175-184`）。
  通道轴不能只改一边形成双价格真相。

## 3. 候选词表数据形状

### 3.1 版本

- 候选常量：`model-capability-v1`
- 每份 deployment capability profile 和每个 requirement axis 都显式携带
  `vocabularyVersion`。
- 未识别版本必须返回可审计的不匹配结果，不得静默按最新版本解释。

### 3.2 Deployment capability profile

候选字段如下；这是数据草案，不是最终 TypeScript 名称，`example-*` 值也不是
规范词条：

```yaml
vocabularyVersion: model-capability-v1
protocolCapabilities:
  structured-output:
    value: true
    basis: inferred
    evidenceRef: catalog://capabilities/structured-output
modalities:
  - mime: text/plain
    supported: true
    basis: inferred
    evidenceRef: catalog://modalities/text
  - mime: image/*
    supported: true
    basis: explicit-override
    evidenceRef: operator://overrides/image-input
businessTags:
  - tag: example-only-open-string
    supported: true
    basis: inferred
    evidenceRef: catalog://business-tags/example
modalityCapabilities:
  - modality: image/*
    capability: cjk-text-render
    supported: true
    basis: explicit-override
    evidenceRef: conformance://image/cjk-text-render
    channelBound: true
```

约束：

1. 每个原子 claim 都携带 `basis` 和 `evidenceRef`；同一 deployment 可以混合
   inferred 与 explicit override。
2. 协议能力的 `value` 只用 boolean；键缺失表示 `unknown`，不把 unknown
   伪装为 false。
3. 模态使用 MIME 或 MIME pattern，并以 `supported: boolean` 区分显式否定；
   完全无 claim 才是 unknown。
4. 业务标签是开放字符串 claim；不在代码中建立封闭美业标签枚举。
5. 模态限定子能力以 `(modality, capability)` 成对表达；v1 首个标准值为
   `image/* + cjk-text-render`。
6. 同一原子 claim 的 explicit override 覆盖 inferred claim；覆盖前后都保留
   来源和证据引用。
7. `channelBound` 标明该保证是否只能由当前执行通道兑现，供后续 failover
   拒绝或等价替代判断使用。

### 3.3 位点 requirement axis

不提供 AND/OR/NOT 表达式树，也不提供可组合“能力代数”。每个位点直接登记一份
扁平要求：

```yaml
axisId: briefImage
vocabularyVersion: model-capability-v1
requiredProtocolCapabilities: []
requiredModalities:
  - image/*
requiredBusinessTags: []
requiredModalityCapabilities:
  - modality: image/*
    capability: cjk-text-render
unknownPolicy: conservative-always-available
```

登记键应复用现有 14 位点的稳定键，不在 #252 再建一份提示词清单。#262 负责把
这些轴接到执行六步时序。

## 4. 匹配决策表

| 场景 | 预期决定 | 必须留痕 |
|---|---|---|
| deployment 显式支持全部要求 | eligible | axis、词表版本、deployment |
| 推断支持，但显式 override=false | ineligible | `explicit_override_denied` |
| 推断不支持，但显式 override=true 且有证据 | eligible | override evidence |
| 任一必需能力 unknown | 不把它当满足；转最保守恒可用分支 | `capability_unknown` |
| `image/* + cjk-text-render` 无匹配 | 最保守分支，不静默选普通图片模型 | 缺失能力和候选排除原因 |
| 词表版本未知 | 最保守分支 | `vocabulary_version_unknown` |

“最保守恒可用分支”需要在实现阶段从当前产品路径中选定真实部署/行为；不得在 schema
里拍脑袋写死模型 ID。

## 5. 后续实现合同

### 5.1 Price 与计费

- `PriceRevision` 唯一性必须至少包含 `ExecutionChannel` 轴和价格档。
- v1 价格档覆盖：缓存命中、批量、长上下文、包量。
- catalog 价格必须映射到真实 `SupplierPriceRevision`/`SupplyRequestFreeze`，
  后者的生产校验和 ProviderCostEvent 在
  `apps/core/src/p1/entitlement-pools/supply-ledger-fields.ts:124-211`。
- 同模型换通道必须重新冻结实际通道价格，并产生 availability + billing 事件。

### 5.2 Failover

结果应区分：

1. `same-model-channel-switch`：模型能力不变，但价格/通道证据变化；
2. `model-switch`：事件必须带声明的 degradation surfaces；
3. `cross-provider-rejected`：使用通道绑定能力且无等价替代；
4. `equivalent-substitute`：替代 deployment 明确满足同一绑定能力。

不得静默把 `cjk-text-render` 保证降级掉。

### 5.3 Catalog governance

- discovery 只产出 draft；
- production selectable 只读 published/frozen revision；
- discovery 永不自动 publish；
- `modelCatalogTenantAllowlist` 空值表示不限制；
- default 配错时丢弃违规 default、告警、服务继续启动；
- 不复用 #249 `toolExecutionAllowlist` 的 fail-closed 默认。

### 5.4 Role slots

`AssembledCapabilityBinding` 只预留 `primary` / `structuring` 角色化绑定类型，
本票不实现双模型执行、并发调度或第二套路由器。

## 6. 预先约定的公共 TDD seams

按垂直切片逐条 red→green：

1. `planModelSupplyCandidates`：中文精确渲染只命中具备
   `image/* + cjk-text-render` 的 deployment；unknown 转保守分支并留痕；
   explicit override 胜 inference。
2. 位点轴注册表：键集合与 `HARNESS_LANGFUSE_PROMPT_NAMES` 的 14 个既有键
   完全相等，防止只接一个位点或另建第二份提示词清单。
3. `CapabilityHotAssemblyPort.assembleForRequest`：消费同一 requirement axis，
   返回冻结词表/能力证据与角色位；不能只测 fingerprint。
4. `AssembledCapabilityBinding` 合同：编译断言接受 `primary` /
   `structuring` 角色位，同时运行时仍只有一个实际 binding。
5. catalog publish/select 公共接口：draft 不进生产可选集；allowlist 配错告警但
   不拒启。
6. `SupplyRequestFreeze` / ProviderCostEvent：同模型不同
   ExecutionChannel 分开记账，切通道产生计费事实。
7. route failover 公共结果：同模型换通道、换模型+降级面、拒绝跨 provider、
   等价替代四条行为分支。

禁止用 production 源码正则测试代替这些行为断言。

## 7. Issue 验收 → 证据映射

| Issue 行为门 | 所需强证据 |
|---|---|
| 14 位点组合轴直接注册 | 轴注册表键与 `HARNESS_LANGFUSE_PROMPT_NAMES` 14 键完全相等的合同测试 |
| 中文精确渲染命中；无匹配保守留痕 | route planning + hot assembly 行为测试，断言真实 decision/audit result |
| 同模型两通道分账；切换计费事件 | price uniqueness + supply freeze + ProviderCostEvent 测试 |
| 换模型带降级面；绑定能力禁跨 provider 或等价替代 | failover discriminated-result 测试 |
| draft 不进生产；allowlist 错不拒启但告警 | catalog lifecycle/boot 行为测试 |
| binding 留 primary/structuring 角色位但不实装双模型 | compile contract + 单实际 binding 的运行时断言 |
| Core 全绿 | focused tests、`pnpm --filter @meiye/core typecheck`、`pnpm --filter @meiye/core test` 的真实退出码与 pass/fail/skip |

D-150 生产消费者候选：

- route planning：`apps/core/src/p1/model-supply/route-planning.ts:82-155`；
- provider request assembly：
  `apps/core/src/p1/supply-registry/hot-assembly.ts:151-179` 及其生产调用方；
- supply cost freeze/event：
  `apps/core/src/p1/entitlement-pools/supply-ledger-fields.ts:124-211`。

关票前必须把候选更新为已接线的准确 `file:line`，并完成
“承诺→实现”和“实现→前台/生产可达”的双向复核。

## 8. Readiness / rebase checklist

- [ ] #266 已真实合入 main，三项机制及票面行为证据齐全。
- [ ] A 批 #246/#247/#242-L1 已真实合入 main。
- [ ] B 批 #248/#249/#255 已真实合入 main。
- [ ] #263 删除窗口未与 #252 mutating 实施并跑。
- [ ] `lane-252` rebase 最新 main，不 merge main 进分支。
- [ ] 首次语义 rebase 已复跑上游关票断言。
- [ ] 重新读取 Issue #252 全部评论、D-165、D-169④ 和 spec 当前版本。
- [ ] 重查 `skills/types.ts` 与价格合同 owner，避免覆盖上游新契约。
- [ ] 每个垂直切片先红后绿；定期跑 focused test 与 Core typecheck。
- [ ] 结束跑 Core 全量测试并进行 Standards / Spec 双轴 review。
- [ ] 英文小步 commit；票下附真实证据；不 push、不关票。
