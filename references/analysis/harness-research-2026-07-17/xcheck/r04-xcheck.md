哥，已完成对抗性交叉验证。共提取 18 条可证伪断言：**10 条属实、4 条有误、3 条不完整或误导、1 条线上未核实**。未修改任何已有文件。

## 判定汇总表

| # | 报告断言 | 判定 | 核验结论 |
|---:|---|---|---|
| 1 | Workflows 于 2025-04-07 GA | ✅属实 | 官方 Changelog 日期及 GA 状态一致 |
| 2 | Workflows V2 于 2026-05 发布，并引入确定性/replay-safe step | ❌有误 | V2 官方发布日期是 2026-04-15；核心是控制面扩容，耐久 step 语义早于 V2 |
| 3 | V2 将并发实例上限提高至 50K | ✅属实 | 付费账号上限 10K→50K |
| 4 | `waitForEvent` 默认 24h、最长 365 天 | ✅属实 | 默认、最短、最长均有官方明确值 |
| 5 | `sleep` 最长 365 天 | ✅属实 | 官方 Limits 表明确 |
| 6 | sleeping/waiting 实例不占并发额度 | ✅属实 | sleep、retry、waitForEvent 等等待状态不计 running concurrency |
| 7 | `NonRetryableError` 一定硬停 Workflow | ⚠️不完整或误导 | 未捕获时硬停；如果业务代码捕获异常，Workflow 仍可继续 |
| 8 | REST API 与 Workers binding 均能管理实例完整生命周期 | ✅属实 | 两者均覆盖 pause/resume/terminate/restart/sendEvent |
| 9 | 已完成 step 返回缓存，不会重复执行 | ✅属实 | step name 是缓存键，重启/恢复可复用成功结果 |
| 10 | 不做版本 pinning；未来 step 必跑当前部署；等待实例不受部署影响 | ❓线上未核实 | 仅“已完成 step 缓存”有官方依据；其余生产部署语义没有找到官方契约原文 |
| 11 | Hyperdrive 连接须在单个 step 内创建和使用 | ✅属实 | 官方明确禁止跨 step 复用连接 |
| 12 | Workflows 无 self-host，开源代码完全不含引擎 | ⚠️不完整或误导 | 没找到生产自托管方案，但 workers-sdk 存在开源本地模拟引擎 |
| 13 | Agents SDK 可采用 Agent DO 对话壳 ⇄ Workflow 耐久核 | ✅属实 | 与官方 AgentWorkflow 架构及双向通信模型一致 |
| 14 | `extendStep()` 使 progress/broadcast 自动成为耐久 checkpoint | ❌有误 | `reportProgress()`、`broadcastToClients()` 明确是非耐久调用 |
| 15 | AI Gateway 原生中国 provider 只有 DeepSeek | ✅属实 | 当前 Native Provider 列表未见火山、通义、文心 |
| 16 | AI Gateway 无任意 base URL/custom provider，其他中国模型基本无法接入 | ❌有误 | 官方已有 Custom Providers，可连接任意 HTTPS API 和自定义 `base_url` |
| 17 | Workflows“语义完全适配但无逃逸路径，迁中国云须整体换框架” | ⚠️不完整或误导 | 运行时锁定较高，但可通过可移植业务内核和适配层避免“整体重写” |
| 18 | AI Gateway 不可作为长期能力层 | ❌有误 | 支撑该结论的关键前提已失效；是否长期采用应由网络、合规和可用性实测决定 |

## 逐条展开

### 1. Workflows GA 日期

**判定：✅属实**

Cloudflare 官方 Changelog 明确记录 Workflows 于 **2025 年 4 月 7 日 General Availability**。[Cloudflare Workflows GA](https://developers.cloudflare.com/changelog/post/2025-04-07-workflows-ga/)

报告日期和状态均准确。

### 2. Workflows V2 的日期与性质

**判定：❌有误**

官方 V2 公告发表于 **2026 年 4 月 15 日**，不是 2026 年 5 月。5 月可能是二手媒体报道日期，不能替代产品发布日期。[Cloudflare Workflows V2](https://blog.cloudflare.com/workflows-v2/)；[Workflows limits raised](https://developers.cloudflare.com/changelog/post/2026-04-15-workflows-limits-raised/)

更重要的是，官方对 V2 的说明集中于新控制面、水平扩展和额度提升。耐久 step、重试、缓存及恢复语义在 GA 阶段已经存在。将“确定性/replay-safe step execution”说成 V2 新增能力，属于时间线和因果归属错误。

正确表述应为：

> Workflows V2 于 2026-04-15 发布，主要重构并扩展控制面容量；耐久 step 执行模型并非 V2 才引入。

### 3. 并发、创建速率与队列额度

**判定：✅属实**

付费账号同时运行实例上限由 10,000 提升至 **50,000**；账号级创建速率提高至 **300 instances/s**；排队实例上限提高至 **2,000,000**。[Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)；[额度提升公告](https://developers.cloudflare.com/changelog/post/2026-04-15-workflows-limits-raised/)

报告中“4,500→50,000”的旧基线没有在当前官方额度公告中得到一致支持；官方变更公告采用的上一档值是 **10,000**。因此 50K 结论正确，但历史基线最好改成官方值。

### 4. `waitForEvent` 超时

**判定：✅属实**

官方事件文档明确规定：

- 默认 timeout：24 小时
- 最短：1 秒
- 最长：365 天
- 超时会令 step 失败，除非由代码捕获处理

证据见 [Waiting for events](https://developers.cloudflare.com/workflows/build/events-and-parameters/)。

### 5. `sleep` 最长 365 天

**判定：✅属实**

官方 Limits 表将单次 sleep duration 上限列为 **365 days**。[Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)

### 6. 等待实例是否占并发额度

**判定：✅属实**

官方说明只有处于 running 状态的实例计入并发额度。由 `sleep`、retry backoff、`waitForEvent` 等产生的等待状态不计入 running concurrency。[Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)

注意“不占并发”不等于“不占任何资源或实例存储额度”。

### 7. `NonRetryableError` 是否无条件硬停

**判定：⚠️不完整或误导**

在 step 中抛出且未捕获时，`NonRetryableError` 会：

- 跳过重试；
- 令实例失败；
- 阻止后续正常 step 执行；
- 仍可触发 rollback。

但官方示例也展示了捕获此类异常后继续执行 Workflow 的用法。[Errors and retries](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)

因此准确表述应为：

> **未捕获的** `NonRetryableError` 是不可重试的终止信号；它不是无法被业务代码捕获的进程级硬停。

如果将其用于合规闸门，必须确保错误不会被外层宽泛 `catch` 吞掉。

### 8. REST API 与 Workers binding 双通道生命周期管理

**判定：✅属实**

Workers binding 提供 `create`、`get`、`pause`、`resume`、`terminate`、`restart`、`sendEvent` 等实例操作。[Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)

REST API 同样提供实例状态变更及事件发送端点：

- [修改 Workflow 实例状态](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/subresources/status/methods/edit/)
- [发送 Workflow event](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/subresources/events/)

“pause/resume/terminate/restart/sendEvent 双通道可管理”成立。部分边界行为，例如对非 paused 实例执行 resume，官方不同页面的描述并不完全一致，调用方仍应按幂等性不足处理。

### 9. 已完成 step 的缓存语义

**判定：✅属实**

官方规则明确说明 step name 充当缓存键。已成功完成的同名 step 在恢复或 replay 时返回缓存结果，不重新执行。[Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)

这也意味着 step 名称不是普通日志标签，而是持久化执行协议的一部分。重命名、复用或动态生成不稳定名称都可能改变恢复行为。

### 10. 部署期间“不做版本 pinning”的关键断言

**判定：❓线上未核实**

报告最关键的说法由四部分组成：

1. in-flight 实例不绑定启动时版本；
2. 已完成 step 返回缓存；
3. 未执行 step 自动运行当前最新部署代码；
4. sleeping/waiting 实例完全不受部署扰动。

其中只有第 2 点获得官方文档明确支持。

Cloudflare Agents 官方仓库中有一条接近的源码注释：origin payload 会持久化，因此旧 SDK 启动的 Workflow 可以在较新代码下恢复，反之亦然。[Agents `workflows.ts`](https://github.com/cloudflare/agents/blob/e906760381bef1458b758260ac41dc0f7bd921e3/packages/agents/src/workflows.ts#L215-L218)

但它存在三个限制：

- 这是 Agents SDK 集成层的源码注释；
- 它不是 Workflows 生产部署兼容性的正式契约；
- 它没有明确保证“所有未来 step 必定跑最新部署代码”。

同时，Cloudflare API 还暴露 Workflow versions 以及实例的 `version_id` 信息。[Workflow versions API](https://developers.cloudflare.com/api/resources/workflows/subresources/versions/)；[Workflow instances API](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/list/)。这不能反向证明版本 pinning，但说明生产系统内部确实存在版本身份，不能从 step 缓存语义直接推出“完全不 pin”。

**裁定：报告不得把该结论标成“官方已核实”。** 应降级为待验证假设，并至少设计以下生产实验：

1. V1 启动实例并完成 step A；
2. 在 `waitForEvent` 或长 sleep 中部署 V2；
3. V2 修改 step B 的可观测输出；
4. 唤醒旧实例，确认 step B 实际运行哪个版本；
5. 同时测试部署发生在 running step 中途时的行为；
6. 检查实例 `version_id` 是否随恢复发生变化。

在拿到该实验或 Cloudflare 官方书面确认前，“未执行 step 跑当前代码、等待实例不受部署影响”都应标记为 **❓线上未核实**。

### 11. Hyperdrive 的 step 内连接约束

**判定：✅属实**

Cloudflare 明确要求，在 Workflow 中使用 Hyperdrive 时：

- 在每个 `step.do()` 内创建新连接；
- 查询也必须在同一 step 内完成；
- 不得跨 step 复用 Hyperdrive-backed connection。

证据见 [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)。

报告的工程建议准确。可复用的是连接配置或连接工厂，不是活跃连接对象。

### 12. Self-host 与开源引擎

**判定：⚠️不完整或误导**

没有找到 Cloudflare 官方支持的生产级 Workflows self-host 部署方式。官方本地开发文档明确称 Wrangler 使用的是与 Cloudflare 全球运行版本相对的 **emulated version**。[Local development](https://developers.cloudflare.com/workflows/build/local-development/)

`workerd` 本身包含 `WorkflowEntrypoint` 类型和由外部 Workflows engine 动态调度 entrypoint 的接口痕迹，但没有发现托管版 Workflows 的完整生产控制面/调度引擎。[workerd `worker.h`](https://github.com/cloudflare/workerd/blob/dbc16042dfd07d527be58fc37cd99ba0f8279fa7/src/workerd/io/worker.h#L779-L790)

不过，“开源代码完全没有 Workflows 引擎实现”过于绝对：`workers-sdk` 中公开存在服务于 Wrangler 本地开发的模拟引擎。[workflows-shared README](https://github.com/cloudflare/workers-sdk/blob/main/packages/workflows-shared/README.md)；[本地模拟引擎源码](https://github.com/cloudflare/workers-sdk/blob/main/packages/workflows-shared/src/engine.ts)

正确表述应为：

> 存在开源本地模拟引擎，但没有找到官方支持、与 Cloudflare 托管版等价的生产自托管方案；仅靠 workerd 无法自托管完整 Workflows 服务。

“生产引擎闭源”则属于合理推断，不是找到的官方原文。

### 13. Agent DO 对话壳 ⇄ Workflow 耐久核

**判定：✅属实**

官方将 Agent 描述为 Durable Object 上的状态化实时实体，而 Workflows 用于长时间、耐久、可恢复的后台任务；`AgentWorkflow` 支持 Agent 与 Workflow 双向通信。[Agents and Workflows](https://developers.cloudflare.com/agents/concepts/workflows/)；[Agent lifecycle](https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/)

因此以下分层是有依据的架构模式：

```text
Agent / Durable Object
实时会话、WebSocket、用户状态
             ⇅
AgentWorkflow
耐久步骤、重试、等待外部事件
```

但这是一种推荐组合，不是 Cloudflare 强制的唯一架构。

### 14. progress/broadcast 是否自动耐久化

**判定：❌有误**

报告将 `extendStep()`、progress、broadcast 与耐久 checkpoint 混为一谈。

官方文档和源码都明确区分：

- `this.reportProgress()`：非耐久；
- `this.broadcastToClients()`：非耐久，Workflow 重试时可能重复；
- 直接 Agent RPC：非耐久；
- `step.reportComplete()`、`step.reportError()`、`step.sendEvent()`、`step.updateAgentState()`、`step.mergeAgentState()`：通过耐久 step 包装。

证据见 [Agents Workflows 文档](https://developers.cloudflare.com/agents/concepts/workflows/) 和 [`workflows.ts` step wrapper](https://github.com/cloudflare/agents/blob/e906760381bef1458b758260ac41dc0f7bd921e3/packages/agents/src/workflows.ts#L333-L405)、[非耐久 progress/broadcast 实现](https://github.com/cloudflare/agents/blob/e906760381bef1458b758260ac41dc0f7bd921e3/packages/agents/src/workflows.ts#L507-L524)。

这不是措辞问题，而是会造成重复通知、UI 状态回退或错误审计记录的实现风险。

### 15. AI Gateway 原生中国 provider

**判定：✅属实**

当前 Native Providers 列表包含 DeepSeek，但未列出：

- 火山引擎/豆包；
- 阿里云百炼/通义；
- 百度智能云/文心。

证据见 [AI Gateway Providers](https://developers.cloudflare.com/ai-gateway/usage/providers/)。

因此“原生一等 provider 中只有 DeepSeek”成立。这里必须保留“原生”限定，不能扩展成“只有 DeepSeek 能接”。

### 16. Custom Provider 与任意 base URL

**判定：❌有误**

Cloudflare 已提供正式的 **Custom Providers** 能力，可连接未被原生支持的 provider、内部服务、区域性服务和自定义模型端点。官方支持：

- 任意 HTTPS API endpoint；
- 自定义 `base_url`；
- OpenAI-compatible custom provider；
- provider-specific API structure。

证据见 [AI Gateway Custom Providers](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)。

因此“无任意 base URL 通用 provider”“火山/通义/文心基本无法接入”已被官方文档直接推翻。

更准确的结论是：

> 火山、通义、文心没有原生 adapter，但可以通过 Custom Provider 接入；具体鉴权头、请求结构、流式响应和中国大陆网络可达性仍需逐家实测。

### 17. “语义完全适配但无逃逸路径，迁中国云须整体换框架”

**判定：⚠️不完整或误导**

这句话混合了三个不同层次：

- **语义适配度：** Workflows 对耐久 step、长等待、事件唤醒、重试和人工审批确实高度适配。
- **运行时锁定：** 没有生产自托管方案，因此直接迁离 Cloudflare 时必须更换耐久编排运行时。
- **应用是否整体重写：** 不必然。若业务逻辑保持为纯函数/普通模块，Cloudflare API 只位于薄适配层，迁移主要发生在 orchestration adapter，而不是所有产品、模型调用和领域逻辑。

此外，“语义完全适配”也说得过满：关键部署版本语义尚未核实，Agent progress/broadcast 又不是自动耐久的。在这两个问题澄清前，只能说“高度适配”。

建议改写为：

> Workflows 与目标耐久任务语义高度匹配，但托管运行时锁定较高。迁离 Cloudflare 时需要替换耐久编排运行时及适配层；如果预先隔离业务内核，不必整体重写应用框架。

### 18. “AI Gateway 不可作为长期能力层”

**判定：❌有误**

报告用来支撑这一结论的主要前提是“不能接入非原生中国 provider”，而该前提已被 Custom Providers 推翻。

现有证据最多能证明：

- 部分中国 provider 没有原生 adapter；
- Custom Provider 需要自行维护映射和鉴权；
- Cloudflare 在中国大陆的网络表现、数据跨境、日志留存和服务可用性需要独立评估。

这些因素可能影响最终选型，但报告没有完成相关实测或合规核查。因此不能据此断言 AI Gateway “不可作长期能力层”。

更稳妥的结论应为：

> AI Gateway 可以作为统一接入、观测和策略层候选；是否适合中国业务长期使用，取决于 Custom Provider 实测、网络可达性、延迟、数据驻留与合规要求。

## 总裁定

# **动摇**

报告不是全面失实：Workflows GA、50K 并发、事件等待、365 天 sleep、等待不占并发、生命周期 API、step 缓存和 Hyperdrive 连接约束等基础事实多数准确。

但以下错误直接击中了报告的架构结论层：

1. **V2 的发布日期和能力归属错误**：控制面扩容被描述成新执行语义。
2. **部署版本语义没有官方证据**：报告却把“未来 step 跑最新代码、等待实例不受部署影响”当作确定契约。
3. **Agents 的 progress/broadcast 耐久性判断错误**：可能直接造成重复副作用。
4. **AI Gateway 无 Custom Provider 的断言已被官方文档推翻**：由此推导出的中国 provider 不可接、不可作为长期层均不成立。
5. **“迁中国云必须整体换框架”过度扩大了运行时迁移的影响范围**：需更换耐久编排运行时，不等于必须整体重写产品。

因此，这份报告可以保留基础事实章节，但在修订上述四个关键技术点并重写两项战略结论之前，**不应直接作为架构决策定稿使用**。