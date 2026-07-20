哥，核验完成。共抽取 20 条断言：**15 条属实、2 条有误、3 条不完整或误导、0 条无法核实**。

## 判定汇总表

| # | 可证伪断言 | 判定 | 核验结论 |
|---:|---|:---:|---|
| 1 | 主仓最新版为 v3.221.0 | ✅ | 本地 `package.json`、git tag、GitHub release 一致。 |
| 2 | 核心代码 MIT，三个 EE 目录例外 | ✅ | 根许可证明确划定 `ee/`、`web/src/ee/`、`worker/src/ee/`。 |
| 3 | EE 只锁 project RBAC、审计、保留、服务端脱敏、UI、SCIM | ❌ | 短清单不完整；还包括 protected prompt labels、organization creators、Org/Instance Management API；仓库还有非 OSS 的 in-app-agent 等云端代码。 |
| 4 | Tracing 在 OSS 自托管免费且无限 | ✅ | 无 entitlement gate；官方定价标为 unlimited。 |
| 5 | LLM-as-judge 在 OSS 免费且无限 | ✅ | OSS evaluator 数量限制为 `false`，即无软件配额；模型调用费仍由用户承担。 |
| 6 | Datasets 在 OSS 免费且无限 | ✅ | 位于 MIT 区域，无数量 entitlement。 |
| 7 | Experiments（UI/SDK）在 OSS 免费且无限 | ✅ | 官方定价同时列出 SDK/UI experiments，代码不在 EE。 |
| 8 | Prompt management 免费无限，且每次 `prompt.update` 创建新版本 | ⚠️ | 免费无限成立；但 JS `prompt.update()` 只修改现有版本的 labels，新内容应再次调用 `prompt.create()` 创建版本。 |
| 9 | 多模态在 OSS 免费且无限 | ✅ | 图片、音频、视频、附件可用；“无限”仅指无软件配额，仍消耗自有对象存储。 |
| 10 | v3 强制四类持久化组件 | ✅ | PostgreSQL、ClickHouse、Redis/Valkey、S3/Blob Storage 均为必需角色。 |
| 11 | PostgreSQL 必须 17+ | ❌ | 正确要求是 **PostgreSQL 12+**；17 只是 compose 默认值。 |
| 12 | v3 起 ClickHouse 不能去掉 | ✅ | 启动脚本、环境校验及官方 v3 架构均要求 ClickHouse。 |
| 13 | TS SDK 模块化 OTEL 包当前为 5.9.1 | ✅ | `core/tracing/otel/client/vercel-ai-sdk` 均为 5.9.1。 |
| 14 | 整套 SDK 都是 Node 20+，不能进 Workers | ⚠️ | `tracing/otel` 是 Node 20+；`client` 是 Universal JS；AI SDK 7 adapter 实际要求 Node 22+。Workers 结论只能限定为 Node OTEL 链路不受支持。 |
| 15 | `@langfuse/vercel-ai-sdk` 面向 ai@7，ai latest=7.0.31 | ✅ | peer dependency 为 `ai >=7 <8`；现场 npm latest 是 7.0.31。 |
| 16 | ai@6 及以下统一走 `experimental_telemetry` | ⚠️ | 官方当前明确验证的是 **AI SDK v6**；“及以下所有版本”属于过度外推。 |
| 17 | 存在 `LangfuseGuardrail`、`LangfuseEvaluator` 原语 | ✅ | 两者均为真实导出 class，并有 `asType: "guardrail"/"evaluator"` overload。不是幻觉。 |
| 18 | Experiment runner 支持 task、evaluators、runEvaluators | ✅ | npm 5.9.1 类型与官方 SDK 文档一致。 |
| 19 | 约 31.3k stars；2026-01 被 ClickHouse 收购 | ✅ | 核验时为 31,334 stars；2026-01-16 官方宣布收购。 |
| 20 | OSS 可用 `TELEMETRY_ENABLED=false` 彻底关闭产品遥测，无 license phone-home | ✅ | **仅在无 EE key 的 OSS 模式成立**；Enterprise 合规遥测不可关闭。 |

## 逐条展开

### 1–3. 版本与许可证边界

1. **v3.221.0 属实。**本地 [package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langfuse/package.json:3) 为 `3.221.0`，`git describe` 为 `v3.221.0`，[GitHub release](https://github.com/langfuse/langfuse/releases/tag/v3.221.0) 发布时间为 2026-07-17 14:42 UTC。v3.219.0、v3.220.0、v3.221.0 同日发布也属实。

   但报告称其为“calver 式”不准确。Langfuse 官方明确采用 [Semantic Versioning](https://langfuse.com/self-hosting/upgrade/versioning)，只是 minor 号增长很快，并不是日期编码。

2. **MIT 边界属实。**根 [LICENSE](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langfuse/LICENSE:3) 明确规定：三个 EE 目录采用 Enterprise License，其他自有代码为 MIT Expat，第三方组件沿用原许可证。

3. **“EE 只锁短清单”不成立。**官方完整自托管付费清单还包括：

   - Protected Prompt Labels
   - Organization Creators
   - Org Management API 与 SCIM
   - Instance Management API

   详见官方 [Enterprise License Key](https://langfuse.com/self-hosting/license-key) 和本地 [entitlements.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langfuse/web/src/features/entitlements/constants/entitlements.ts:6)。

   报告正文其实已经列出了其中多数项目，比题目中的重点摘要更完整；但“整个 EE 只有企业管理功能”仍太绝对。本地 `web/src/ee/` 还包含 `in-app-agent`、billing、multi-tenant-sso、verified-domains 等非 OSS/云端代码，其中部分并不是可通过自托管 EE key 获得的功能。

### 4–9. “目标功能全部在 OSS”复核

这部分是报告最核心结论，**限定到所列目标能力时成立**。

官方 [Self-hosted Pricing](https://langfuse.com/pricing-self-host) 明确把 tracing、multimodal、prompt management、datasets、SDK/UI experiments、LLM-as-judge、human annotation 列在 Open Source 侧，并称核心功能无使用限制。本地 OSS entitlement 又确认：

- `model-based-evaluations-count-evaluators: false`
- `prompt-management-count-prompts: false`
- `annotation-queue-count: false`

见 [entitlements.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langfuse/web/src/features/entitlements/constants/entitlements.ts:140)。

逐项结论：

- **Tracing：✅**
- **LLM-as-judge：✅**，但需自配 LLM Connection，并承担 judge 模型调用成本。[官方说明](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge)
- **Datasets：✅**
- **Experiments via SDK/UI：✅**
- **Prompt management：✅**，但 protected labels 是 EE。
- **Multimodal：✅**，自托管需配置 media object-storage bucket；官方还要求该 bucket 的主机名可被 SDK/浏览器解析。[多模态文档](https://langfuse.com/docs/observability/features/multi-modality)

因此：

> “我们所需的六类核心能力都在 OSS”成立；“Langfuse 全部产品功能都在 OSS”不成立。“无限”表示无 Langfuse 软件配额，不表示 LLM、存储和计算成本无限免费。

Prompt API 还有一处具体错误：官方 [Prompt Version Control](https://langfuse.com/docs/prompt-management/features/prompt-version-control) 显示，`prompt.create()` 在同名 prompt 上创建新版本，`prompt.update()` 只重分配 labels。报告“每次 update 产生新 version”应改写。

### 10–12. 自托管依赖

本地 [docker-compose.yml](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langfuse/docker-compose.yml:10) 确实让 web/worker 同时等待 PostgreSQL、MinIO、Redis、ClickHouse 健康；event-upload bucket 在 [shared env schema](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langfuse/packages/shared/src/env.ts:249) 中也是必填项。

准确表述应为：

> PostgreSQL 12+、ClickHouse、Redis/Valkey、S3/Azure Blob/OCI 等对象存储四类角色必需。

其中：

- **PG17+ 是硬错。**官方明确支持 [PostgreSQL >=12](https://langfuse.com/self-hosting/deployment/infrastructure/postgres)，本仓 CI 也直接测试 PG12 与 PG15，见 [pipeline.yml](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langfuse/.github/workflows/pipeline.yml:468)。
- **ClickHouse v3 硬依赖成立。**[web entrypoint](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langfuse/web/entrypoint.sh:78) 缺少 `CLICKHOUSE_URL` 会退出；官方 [v2→v3 架构文档](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v2-to-v3) 也将其列为必需存储组件。
- “S3”不是唯一实现，可换 Azure Blob、OCI 或其他 S3-compatible 服务。
- 报告称官方没有给 PG/Redis/CH 最小资源值也已过时或漏查。当前 [Sizing & Scaling](https://langfuse.com/self-hosting/configuration/scaling) 给出了 PG 2C/4GiB、Redis 1C/1.5GiB、CH 2C/8GiB 等最低值。

### 13–18. SDK、AI SDK 与五段式映射

npm 现场结果：

- [`@langfuse/tracing/latest`](https://registry.npmjs.org/@langfuse/tracing/latest)：5.9.1，Node `>=20`
- [`@langfuse/otel/latest`](https://registry.npmjs.org/@langfuse/otel/latest)：5.9.1，Node `>=20`
- [`@langfuse/client/latest`](https://registry.npmjs.org/@langfuse/client/latest)：5.9.1，Universal JS
- [`@langfuse/vercel-ai-sdk/latest`](https://registry.npmjs.org/@langfuse/vercel-ai-sdk/latest)：5.9.1，Node `>=22`，peer `ai >=7 <8`
- [`ai/latest`](https://registry.npmjs.org/ai/latest)：7.0.31，Node `>=22`

所以报告的 Node 环境表述需要改成分包矩阵，不能笼统说“SDK 都是 Node20+”。官方 [Vercel AI SDK integration](https://langfuse.com/integrations/frameworks/vercel-ai-sdk) 同样明确：

- AI SDK 7：`@langfuse/vercel-ai-sdk`，Node 22+
- AI SDK 6：`experimental_telemetry`
- 更早版本：当前文档没有提供统一支持承诺，不能直接写成“v6 及以下全部如此”。

**Guardrail/Evaluator 核心结论确认成立。**我直接解包检查了 tracing 5.9.1 的 `dist/index.d.ts` 与运行时 exports：

- `LangfuseEvaluator extends LangfuseBaseObservation`
- `LangfuseGuardrail extends LangfuseBaseObservation`
- `startObservation(..., { asType: "evaluator" })`
- `startObservation(..., { asType: "guardrail" })`
- `startActiveObservation` 也有对应 overload

因此五段式 observation 映射不会因为“原语幻觉”而动摇。但二者只是**语义化观测包装器**，不会替应用执行红线检查或评价逻辑；实际 `checkRedlines`、`rankCandidates` 仍需业务实现。

Experiment runner 也确认真实存在，官方 [Experiments via SDK](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk) 与 5.9.1 类型都支持：

```ts
langfuse.experiment.run({
  data,
  task,
  evaluators,
  runEvaluators,
});
```

不过报告代码骨架有一个会直接导致失败的问题：

```ts
langfuse.score.create({ name: "...", value: ... });
```

这些调用没有提供任何 score subject。服务端 [score validation](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langfuse/packages/shared/src/utils/scores.ts:3) 要求恰好提供 `traceId`、`sessionId` 或 `datasetRunId` 之一，observation score 还需要 `traceId`。在 active callback 内应使用：

```ts
langfuse.score.activeObservation({ name, value });
// 或
langfuse.score.activeTrace({ name, value });
```

这不动摇映射方案，但当前示例不能原样投入实现。

### 19–20. 采用信号与遥测

- GitHub API 核验时为 **31,334 stars**；报告的 31,333 只是检查时点相差 1，不构成错误。[GitHub API](https://api.github.com/repos/langfuse/langfuse)
- ClickHouse 于 **2026-01-16** 正式宣布收购 Langfuse，属实。[ClickHouse 官方公告](https://clickhouse.com/blog/clickhouse-acquires-langfuse-open-source-llm-observability)

遥测结论需要严格限定为 OSS：

- 本地 [telemetry/index.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langfuse/web/src/features/telemetry/index.ts:20) 在 `TELEMETRY_ENABLED=false` 且无 EE key 时直接返回。
- license 判定只是本地检查 key 前缀，见 [licenseCheck/index.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langfuse/packages/shared/src/server/ee/licenseCheck/index.ts:11)，没有发现远程 license-validation 请求。
- 但官方 [Telemetry 文档](https://langfuse.com/self-hosting/security/telemetry) 明确说 Enterprise 自托管合规遥测不可关闭，并会上报 license key 和聚合用量。因此不能把“无 phone-home”推广到 EE。

## 特别裁定：能否当合规 system of record

**⚠️ 报告的架构建议方向成立，但“因为 ClickHouse+TTL，所以不能合规”不是被证实的事实。**

成立的部分：

- v3 ingestion 是 Web → S3 → Redis queue → Worker → ClickHouse 的异步链路。
- 它无法与业务任务完成、红线门禁结果形成同一个数据库事务。
- OSS 没有 Langfuse 操作 audit logs、受控 retention policy、server-side masking。
- 对必须强一致、永久留存、按业务事务证明“当时确实拦截/放行”的字段，另存业务 PG 是更稳妥的设计。

需要修正的部分：

- ClickHouse 本身并不天然“不合规”，可以做副本、备份、权限隔离和持久留存。
- TTL 是可选配置，不是 Langfuse 数据必然自动过期的属性。
- 官方甚至提供 zero-data-loss backup 指引和事件 S3 恢复链路。
- “迁移可能丢历史”在报告中没有直接证据。

更准确的结论应是：

> Langfuse 不应作为本系统唯一的合规 system of record，主要原因是它属于异步观测链路，不能与业务决策事务原子提交，且 OSS 缺少部分合规治理能力；不是因为 ClickHouse 或 TTL 天然不具备合规性。

另一个需要立即改正的建议是：报告推荐给 media bucket 配通用 S3 lifecycle/TTL，但官方 [Scaling 文档](https://langfuse.com/self-hosting/configuration/scaling) 明确不建议直接删除 media bucket 对象，否则会造成 trace 引用失效，且基于哈希记录的未来重复上传可能失败。官方建议使用 Langfuse data-retention 功能，而该功能属于 EE。

## 总裁定

**成立但需修正。**

没有被动摇的核心：

- 所需 tracing、LLM-as-judge、datasets、experiments、prompt management、多模态确实都能在 OSS 使用。
- `LangfuseGuardrail` 与 `LangfuseEvaluator` 确实存在，五段式语义映射可成立。
- v3 确实需要 ClickHouse 重栈，运维成本判断合理。

必须修正后才能作为决策依据的内容：

1. `PG17+` 改为 `PG12+`。
2. “全功能 OSS”改成“本项目所需核心能力全部 OSS”。
3. 补全并区分 self-host EE、cloud-only 与源码 EE 边界。
4. AI SDK 7 路径注明 Node 22+；“v6及以下”收窄为官方验证的 v6。
5. 修正 prompt `create/update` 语义。
6. 将无 subject 的 `score.create` 改为 active score API。
7. 删除对 media bucket 直接配置 lifecycle TTL 的建议。
8. 将 system-of-record 理由改为“异步、非业务事务原子、OSS 治理能力不足”，不要归因于“CH+TTL 天然不合规”。

本次为只读核验，未修改任何已有文件。