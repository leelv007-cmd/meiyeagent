# Issue #248 合同草案（开工前预备）

> 状态：零 rebase 面 schema/design 草案；不是已裁定合同，也不是实现证据。  
> 范围：只为 #248 开工后首个“契约先行”小切片定义最小候选形状与 TDD seam。  
> 依据：Issue #248、D-169②、spec 决策 18、既有
> `issue-248-observability-signal-destination-matrix-2026-07-29.md` 和当前代码地图。

## 标记约定

- **【票面锁定】**：Issue、D-169② 或 spec 已明确，不在实现中改写语义。
- **【建议】**：为减少接线歧义提出的最小工程形状，开工时仍须以最新 main
  和上游合同复核。
- **【未裁定】**：当前权威材料没有答案；不得靠类型名、fixture 或 SDK 假设
  静默补齐。

## 当前代码地图

- `apps/core/src/p1/harness/postgres-store.ts`
  - `decision_traces`、`audit_events` 已是 PostgreSQL 事实表。
  - `writeAuditAndOutbox()` 会同时写 `langfuse_outbox`，因此不能作为
    `ObservabilityDropEvent` 的写入口；否则故障信号仍依赖被故障通道。
  - `claimLangfuseBatch()` 当前会在投递时按 workflow/stage 回查 trace。
    三轴合同不得沿用这种导出阶段补齐方式。
- `apps/core/src/p1/harness/outbox-worker.ts`
  - `HarnessLangfuseOutboxStore` 是现成的 claim/成功/失败/dead-letter seam；
    尚无独立 drop writer、last-success、queue-age 或对账接口。
- `apps/core/src/p1/harness/langfuse-sender.ts`
  - 当前为直接 HTTP ingestion，不是带 `serializationOptions` 的 SDK。
  - 当前导出 `skillRevisionRefs` 数组与嵌套 `prompt.version`，且缺
    `catalogRevision`，不满足三轴单值扁平合同。
- `apps/core/src/p1/model-supply/ledger-contracts.ts` 与
  `packages/contracts/src/product-quote.ts`
  - 已分别存在 provider cost/usage 和产品 usage 事实；两者不可直接拼成
    浏览器响应。
- `mkfast-template-main/src/product/account-usage.ts`
  - 当前是账户累计投影，不是“本次动作实际消耗”的同步数据源。
- `mkfast-template-main/src/lib/product-telemetry.ts`
  - 当前浏览器 telemetry 是可选分析 SDK 分发，不是 PostgreSQL 审计或本次
    usage 真相源。

## 1. `ObservabilityAxes`

**【票面锁定】** 三轴必须是事件与 trace 的三个扁平顶层键；执行入口写一次，
声明式抽取；子 span 显式携带。禁止嵌套 `version` 对象，禁止在导出阶段回查
补齐。

**【建议】** 首个共享合同切片采用严格、必填、非空的单值 schema；入口与子
span 使用同一个类型，避免 root/child 两套可选字段：

```ts
import { z } from 'zod';

export const observabilityAxesSchema = z
  .object({
    skillRevision: z.string().min(1),
    promptVersion: z.string().min(1),
    catalogRevision: z.string().min(1),
  })
  .strict();

export type ObservabilityAxes = z.infer<typeof observabilityAxesSchema>;

export const captureObservabilityAxes = (
  input: ObservabilityAxes,
): ObservabilityAxes => observabilityAxesSchema.parse(input);

export const inheritObservabilityAxes = (
  parent: ObservabilityAxes,
): ObservabilityAxes => ({ ...parent });
```

`captureObservabilityAxes()` 是入口的唯一 parse seam；`inheritObservabilityAxes()`
只复制已钉扎快照，不接收 child override，也不查数据库、Skill registry、
prompt provider 或 catalog。

**【未裁定】**

- 一次执行含多个 Skill 时，单数 `skillRevision` 代表主 Skill、组合快照 ID，
  还是需要另立 execution-level revision，当前未裁定。
- 一次执行含多个 prompt 位点/版本时，单数 `promptVersion` 的归一规则未裁定。
- 因此本草案有意不加入数组、拼接字符串或“任选第一个”的兼容逻辑；在裁定
  前，多 Skill/多 prompt fixture 只能作为待决失败用例，不能固化答案。

## 2. `ObservabilityDropEvent`

**【票面锁定】** 最小字段与 reason 枚举如下；事件必须走与被丢信号不同的
通道。既有矩阵已裁定目的地为 PostgreSQL 独立投递健康通道。

```ts
export const observabilitySignalSchema = z.enum([
  'trace',
  'log',
  'metric',
  'score',
  'feedback',
]);

export const observabilityDropEventSchema = z
  .object({
    signal: observabilitySignalSchema,
    reason: z.enum(['permanent-config', 'transient']),
    count: z.number().int().positive(),
    source: z.string().min(1),
  })
  .strict();

export type ObservabilityDropEvent = z.infer<
  typeof observabilityDropEventSchema
>;
```

**【建议】**

- `count` 表示本条事件确认已丢弃的数量，只允许正整数；零丢弃不造事件。
- event ID、发生时间与写入时间由独立 PG envelope/表列承载，不扩大票面锁定
  的 payload。
- `source` 先保持非空字符串，不预造 sender/provider 枚举；真实生产来源盘点
  完成后再决定是否收紧。

**【未裁定】** 聚合窗口、事件 ID 算法、保留期与告警阈值均未裁定。

## 3. `ActionUsage`

**【票面锁定】**

- “本次消耗”只从本次执行返回值同步取得，被门禁拒绝但已经发生的规划/模型
  消耗也必须返回。
- PostgreSQL ledger/projection 只提供累计视图；预算门不得依赖 Langfuse
  或累计视图。
- planning usage 与 product usage 必须分离，不得把 provider 内部成本字段
  直接暴露给浏览器。

**【建议】** 先锁 envelope 和两桶分离，不在 #248 中发明商家计量单位。用
schema factory 强迫调用方显式提供已裁定的商家侧 planning/product schema：

```ts
export const actionUsageSchema = <
  PlanningUsage extends z.ZodTypeAny,
  ProductUsage extends z.ZodTypeAny,
>(
  planningUsageSchema: PlanningUsage,
  productUsageSchema: ProductUsage,
) =>
  z
    .object({
      actionId: z.string().min(1),
      outcome: z.enum(['completed', 'rejected']),
      planning: planningUsageSchema.nullable(),
      product: productUsageSchema.nullable(),
    })
    .strict();

export type ActionUsage<PlanningUsage, ProductUsage> = {
  actionId: string;
  outcome: 'completed' | 'rejected';
  planning: PlanningUsage | null;
  product: ProductUsage | null;
};
```

浏览器合同必须由显式 allowlist schema 生成；至少禁止
`providerCost`、`currency`、`inputTokens`、`outputTokens`、`mediaUnits`、
provider/channel/credential 标识穿透。内部事实可用于服务端换算，但不能把
内部对象 `spread` 到响应。

**【未裁定】**

- planning 的商家可见量纲、单位、取整和文案未裁定。
- product 桶应复用哪一个既有产品 usage 投影、一次动作含多资源时的展示粒度
  未裁定。
- “被拒”发生在不同阶段时哪些已发生消耗可展示、零消耗是否显示，未裁定。
- 在这些口径裁定前，不写死 cents、token、次数、点数或币种，也不伪造换算。

## 4. PostgreSQL 投递健康与对账 seam

**【票面锁定】** 必须覆盖 drop event、last-success、queue-age 和业务事件↔
trace 定期对账；drop event 只证明已知丢弃，不能替代完整性对账。

**【建议】** 用独立 writer 隔离故障通道，并将读取/计算 seam 与调度周期
解耦：

```ts
export interface ObservabilityDropEventWriter {
  appendDrop(event: ObservabilityDropEvent): Promise<void>;
}

export interface ObservabilityDeliveryHealthStore {
  markDeliverySuccess(input: {
    destination: 'langfuse';
    occurredAt: Date;
  }): Promise<void>;
  readDeliveryHealth(input: {
    destination: 'langfuse';
    now: Date;
  }): Promise<{
    lastSuccessAt: Date | null;
    oldestQueuedAt: Date | null;
    queueAgeMs: number | null;
  }>;
}

export interface ObservabilityReconciliationStore {
  reconcileBusinessEventsToTraces(input: {
    windowStart: Date;
    windowEnd: Date;
  }): Promise<{
    businessEventCount: number;
    traceCount: number;
    matchedCount: number;
    missingTraceCount: number;
    orphanTraceCount: number;
  }>;
}
```

- `appendDrop()` 必须直接写独立 PostgreSQL 表/事务，禁止调用
  `writeAuditAndOutbox()`、`HarnessLangfuseSender` 或 Langfuse outbox。
- `queueAgeMs` 由权威队列最老未终态记录与传入 `now` 计算；无积压为 `null`，
  不以 `0` 混淆“空队列”和“刚排队”。
- 对账方法只返回窗口事实，不内嵌 cron、阈值或告警策略；调度与处置另接现有
  job runtime。

**【未裁定】** 周期、窗口重叠策略、迟到容忍、阈值、告警目的地、业务事件
集合与 trace 匹配键尚未裁定。上述计数字段是最小候选，须以真实 PG 查询
模型校正。

## 5. 公共 TDD seam 与开工顺序

**【建议】** 前置满足并首次 rebase main 后，按下列小切片推进：

1. `packages/contracts` 新增三轴、drop、ActionUsage envelope 的 Zod/TS 合同。
   - 红测：嵌套版本对象、缺任一轴、空轴、额外字段、非法 reason、零/负 count。
   - 待决红测：多 Skill/多 prompt 输入明确失败或标 `todo`，不得猜归一规则。
2. core 新增入口 capture/extractor 与 child inheritance seam。
   - 红测：入口只 capture 一次；child 三轴与 root 完全相等；禁止 child
     override；禁止 sender 阶段 repository lookup。
3. core 新增独立 PG drop/health/reconciliation repository。
   - 红测：断 Langfuse 后 drop 仍能写；drop 写不产生 Langfuse outbox；
     成功后 last-success 前进；queue-age 使用最老未终态项；对账能识别
     missing 与 orphan。
4. sender/outbox 适配三轴顶层投影和健康写入。
   - 红测：trace 与每个 child span 都有三个顶层键；重试稳定 ID；失败、
     dead-letter、恢复路径行为一致。
5. 同步动作响应接 `ActionUsage` allowlist；累计账户投影保持独立。
   - 红测：completed/rejected 均返回本次 usage；累计读失败不抹掉本次值；
     响应 JSON 不含 provider 内部字段。

这五个 seam 共用同一份 contract fixture builder；接缝两端各有消费断言，
不得用源码正则或仅 schema parse 冒充生产调用证明。

## 6. 证据门

| 要求 | 最低证据 | 不能证明 |
|---|---|---|
| 三轴 schema/继承 | contract 单测 + core 真实入口行为测试 | Langfuse 可过滤 |
| 异通道 drop/健康 | 本地真实 PostgreSQL；断 Langfuse、恢复、查询 PG | fixture 内存 store |
| 定期对账 | 本地真实 PG 制造 matched/missing/orphan 三组事实并运行任务 | 仅看 outbox 无报错 |
| 被拒即时消耗 | core 被拒路径 + 浏览器真实动作与网络响应断言 | 累计 usage 页面刷新 |
| provider 字段不泄漏 | browser contract allowlist + 响应 JSON 负向断言 | TypeScript 类型单独通过 |
| 三轴过滤与长中文 | 自托管/真实 Langfuse 实投；按三轴逐一查询；>1024 中文 API 回读全文或 hash | mock HTTP、fixture、虚构 SDK 配置 |
| core 全绿 | 前置满足后按仓库 locale 锁纪律串行运行票面确认的 core gate，记录命令和 exit code | “应该能过”或历史绿 |

真实 Langfuse 证据开始前必须先确认当前发送链：若仍是
`LangfuseHttpSender` 直接 HTTP ingestion，就验证真实 HTTP payload 与回读，
不写不存在的 `serializationOptions`；只有实际引入某 SDK/序列化层后，才按
该版本官方字段显式配置并取证。

## 7. 开码前必须回到主控的裁定

1. 单值 `skillRevision` 如何代表 multi-skill 执行。
2. 单值 `promptVersion` 如何代表 multi-prompt/多位点执行。
3. planning/product 两桶各自的商家可见单位与拒绝阶段计量边界。
4. 对账匹配键、周期、阈值和失败处置。

未得到裁定时仍可先落不依赖这些答案的严格 envelope 与负向用例，但不得用
数组兼容、首项降级、字符串拼接或 provider 单位直出绕过裁定。
