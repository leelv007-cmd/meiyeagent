# 供应控制面权限与策略组件比选

> 日期：2026-07-19
> 状态：选型研究；不构成已接受架构决定
> 范围：D-057 后台能力权限、D-063 套餐/账号覆盖、D-064 数据等级、D-059 RoutePolicy 硬约束
> 研究方法：网络检索先使用 OpenCLI；结论只采用项目官方文档、官方仓库、许可证和源代码。OpenCLI 无法命中的细节再直接核验官方仓库。未保存原始网页转储，只保留本文件中的可复用结论。

## 1. 结论先行

**P0 不新增独立策略/授权运行服务，也不把任一候选设为 Product Core 的新真相源。** 首轮同时要完成文本、图片、视频三模态的供应控制闭环；此时引入 OpenFGA/OPA 独立服务会增加一条同步发布、网络可用性、外部数据一致性和审计对账链，收益不足以覆盖新增故障面。

P0 采用以下边界：

1. D-057 继续使用 Core 内的稳定 capability permission、默认拒绝和服务端集中校验；角色只是权限集合，不同期建设通用策略编辑器。
2. D-063 的套餐权益、账号覆盖、额度、并发和有效期继续由类型化 `EntitlementPolicy + AccountAllocation + Usage Ledger` 计算。授权引擎只能回答“可否使用”，不能成为余额、预留、结算或覆盖来源的真相。
3. D-064 与 RoutePolicy 硬过滤继续由 Core 内版本化、可测试的纯函数执行，输入和输出采用显式结构；健康、容量、成本排序与 accepted/unknown 状态机不得下沉到通用授权引擎。
4. 为后续替换保留一个很薄的 `PolicyDecisionPort`，但 P0 实现仍是本地 TypeScript。决策记录至少包含 `policyRevision`、规范化 input 摘要、allow/deny、命中/排除原因和 correlation id。

四个候选不是一个总冠军，而是适用面不同：

| 项目问题 | 最匹配候选 | 当前处理 |
| --- | --- | --- |
| D-057 后台 capability RBAC | **Casbin** 的轻量嵌入式模型最接近；Cedar 次之 | P0 仅借鉴，不引入；现有权限域太小，直接类型化实现更清楚 |
| 工作区、团队、资源继承、委派管理等关系授权 | **OpenFGA** | 延期；当关系图和共享资源确实增长后做独立 PoC |
| D-064 数据等级、区域、来源信任、合同资格等属性硬约束 | **OPA**；Cedar 是更强类型、更易解释的次选 | P0 借鉴 OPA 的结构化 decision/decision log 合同，仍由 Core 执行 |
| D-059 RoutePolicy 合规候选硬过滤 | **OPA** | 仅适合硬过滤；运行健康、容量、成本排序和任务接受态必须留在 Core |
| D-063 套餐/账号覆盖 | **不交给通用授权引擎** | Core 的权益合并与账本是真相；可将最终 eligibility 投影给 OPA/Cedar，但不能反向托管额度 |

## 2. 项目约束如何映射到策略问题

### 2.1 D-057 不是完整 IAM 项目

首轮只要求服务端执行稳定 capability permission，覆盖查看、事件处置、任务恢复、配置发布/回滚、商业化治理、凭据治理和审计查看/导出。高影响命令还必须保留原因、影响预览、CAS/幂等、回滚和不可变审计。这个范围用权限枚举与集中 evaluator 就能完整表达；引入关系数据库或策略语言不会替代命令合同。

### 2.2 D-063 同时包含授权和计量

`EntitlementPolicy`、限时 `AccountAllocation`、额度调整事件、并发和工作区隔离既有 eligibility，也有状态、金额/用量和时间演进。Casbin/OpenFGA/OPA/Cedar 都不是 usage ledger。候选组件至多参与“当前请求是否满足权益硬条件”，不能修改余额、预留或历史用量。

### 2.3 D-064 与 RoutePolicy 是属性策略，但不只有属性策略

数据等级、来源类别、区域、供应商合同、模型 operation conformance 和账号资格适合抽象为策略输入；而实时健康、余额/容量、成本事实、排序、accepted/unknown 防重提属于执行编排。若未来引入 OPA/Cedar，边界应为：

```text
Core 收集并冻结可核验证据
  -> policy engine 只返回 hard eligibility + reason codes
  -> Core 叠加 health/capacity overlay
  -> Core 排序并冻结 RouteSnapshot
  -> Core 持有 accepted/unknown 与重试状态机
```

策略引擎不得自行查询供应商、读取秘密、扣减额度或发起模型调用。

## 3. 候选总表

评分含义：`5` 为非常匹配，`1` 为明显不匹配。分数是针对本项目当前范围的工程判断，不是项目的通用排名。

| 维度 | OpenFGA | Casbin / node-Casbin | OPA | Cedar |
| --- | ---: | ---: | ---: | ---: |
| D-057 capability RBAC | 4 | **5** | 4 | 4 |
| 工作区/团队/资源 ReBAC | **5** | 2 | 2 | 3 |
| D-063 权益 eligibility | 2 | 3 | **4** | 4 |
| D-064 数据/区域/来源策略 | 3 | 3 | **5** | 4 |
| RoutePolicy 硬过滤 | 2 | 3 | **5** | 4 |
| 策略版本与决策审计底座 | 3 | 2 | **5** | 3 |
| Node/TypeScript 直接适配 | 4 | **5** | 4 | 4 |
| Cloudflare Worker 适配 | 3（HTTP） | 2（需 PoC） | **4（Wasm）** | 4（Wasm，需 PoC） |
| 面向运营的可解释性 | 2 | 3 | 3 | **4** |
| P0 引入复杂度 | 高 | 中低 | 高 | 中 |
| P0 是否采用 | 否 | 否 | 否 | 否 |

共同事实：四个项目核验时均为 Apache-2.0，并在 2026 年 6～7 月仍有官方仓库提交或发布；活跃并不等于适合首轮范围。

| 候选 | 许可证 | 活跃度快照（官方仓库） |
| --- | --- | --- |
| OpenFGA | [Apache-2.0](https://github.com/openfga/openfga/blob/main/LICENSE) | [2026-07-15 commit `1e464a7`](https://github.com/openfga/openfga/commit/1e464a742e8cfd9887ef55f5a36d271f5d1eeb40)；2026-06-29 发布 v1.18.1 |
| node-Casbin | [Apache-2.0](https://github.com/apache/casbin-node-casbin/blob/master/LICENSE) | [2026-06-25 commit `2d90c7d`](https://github.com/apache/casbin-node-casbin/commit/2d90c7d8c3b522415605cf22fdd8f213e73381e)；同日发布 v5.51.1 |
| OPA | [Apache-2.0](https://github.com/open-policy-agent/opa/blob/main/LICENSE) | [2026-07-17 commit `4cefcaf`](https://github.com/open-policy-agent/opa/commit/4cefcaff216b864a9b416eb45d037309fff56c92)；2026-07-02 发布 v1.18.2 |
| Cedar | [Apache-2.0](https://github.com/cedar-policy/cedar/blob/main/LICENSE) | [2026-07-17 commit `b72eb73`](https://github.com/cedar-policy/cedar/commit/b72eb7332219090150d90260d439c7ed89de2d44)；2026-06-22 发布 v4.11.2 |

许可证结论只说明代码许可证核验结果，不替代依赖清单、NOTICE 或正式法律审查。

## 4. OpenFGA

### 能力与优势

OpenFGA 是受 Zanzibar 启发的关系授权服务。它用 authorization model 定义类型和关系，用 relationship tuples 表达用户、团队、工作区和资源之间的直接/推导关系，并提供 `Check`、`ListObjects`、`ListUsers` 等查询。[官方概念文档](https://openfga.dev/docs/concepts)明确以关系、对象、用户和元组为核心。

它最适合本项目未来可能出现的：

- 一个登录用户属于多个工作区；
- workspace owner 委派 operator/reviewer；
- 资源继承工作区或团队权限；
- 需要回答“某人能看到哪些工作区/资源”而不只是单点布尔校验；
- 权限关系由大量、频繁变化的 membership tuple 驱动。

OpenFGA 也支持以 CEL 表达的 [conditions](https://openfga.dev/docs/modeling/conditions)，可覆盖部分 ABAC，但它仍以“某关系是否成立”为中心；把供应商成本、数据处理合同、套餐额度和动态 RoutePolicy 全部塞进 tuple/condition 会使模型偏离其强项。

### 版本、审计和解释

[Authorization Model 不可变](https://openfga.dev/docs/getting-started/immutable-models)：每次写入生成新版本，生产检查可显式固定 `authorization_model_id`，也支持 shadow/渐进切换。这一点与本项目 revision/publish/rollback 合同契合。

但 model version 不等于完整管理审计。[ReadChanges](https://github.com/openfga/openfga/blob/main/pkg/server/read_changes.go)、访问日志和 telemetry 不能自动补齐 D-057 要求的 actor、reason、before/after、影响范围与业务 correlation；这些仍需由 Core 命令层记录。OpenFGA 的普通 Check 主要返回 allow/deny；其官方 AuthZEN 适配说明也明确当前不返回 decision reasons，因此运营页仍要维护自己的 reason code 与权限来源解释。[官方实现说明](https://github.com/openfga/openfga/blob/main/docs/authzen/README.md)

### 部署、延迟与本项目适配

OpenFGA 是额外服务而不是 TypeScript 内嵌库。官方 [Docker 部署文档](https://openfga.dev/docs/getting-started/setup-openfga/docker)提供 HTTP/gRPC 服务及 PostgreSQL、MySQL、SQLite 适配；生产使用意味着新增服务、数据库迁移、备份、扩缩容和监控。

Node Core 可使用官方 [`@openfga/sdk`](https://github.com/openfga/js-sdk)，但当前 SDK 明确要求 Node `>=20.19.0`、使用 Axios，官方资料没有承诺 Cloudflare Workers 运行时兼容。Worker 可直接调用 OpenFGA HTTP API，但会增加网络依赖；应以超时、失败关闭、缓存一致性和真实 p95/p99 PoC 验证，不能引用“高性能”宣传代替本项目延迟证据。

### 裁决

- **P0：不采用。** 当前 D-057 是能力权限合同，不是大规模资源共享关系图。
- **延期采用条件：** 多工作区继承、委派管理、资源共享和 `ListObjects/ListUsers` 成为真实需求，且手写关系查询开始复杂或出现一致性风险。
- **PoC 边界：** 只验证 workspace/team/resource ReBAC；不得同时接管 D-063 额度、D-064 数据政策或 RoutePolicy。

## 5. Casbin / node-Casbin

### 能力与优势

Casbin 是嵌入式授权库，model 定义 request、policy、effect、matcher，可表达 ACL、RBAC、带 domain 的 RBAC、角色层级与 ABAC。[官方总览](https://casbin.org/docs/overview)列出 Node.js 对 enforcement、RBAC、ABAC、adapter、management API、batch API 和 watcher 的支持；[model syntax](https://casbin.org/docs/syntax-for-models)支持 allow/deny effect 与 matcher。

它对 D-057 的贴合度最高：`subject + capability + scope` 可以直接映射，node-Casbin 与现有 TypeScript Core 同进程运行，不增加一次网络调用；`enforceEx` 还可以返回命中的 policy row，便于做基础解释。[node-Casbin 官方仓库](https://github.com/apache/casbin-node-casbin)

### 局限

Casbin 的 adapters 保存策略，watchers 让多个 enforcer 重新加载或增量同步策略；[watcher 官方文档](https://casbin.org/docs/watchers)本身也说明具体实现位于独立包，语言支持存在差异。这些机制解决“当前策略如何加载/同步”，没有原生提供本项目要求的 candidate→simulate→approve→publish→rollback、不可变 revision、影响预览和业务审计。因此采用后仍要自建策略发布控制面。

[ABAC 文档](https://casbin.org/docs/abac)允许 matcher 读取请求对象属性，但 policy element 不能直接存储对象；复杂 RoutePolicy 会逐渐变成难以治理的 matcher/eval 表达式。它也不是 Zanzibar 风格的关系查询服务，不擅长回答大规模跨工作区 `ListObjects`。

### 部署、延迟与本项目适配

node-Casbin 提供 ESM/CJS，官方 README 也给出 browser import；Node Core 适配直接。嵌入式执行避免网络跳转，但性能取决于 matcher 顺序、policy 数量、role manager 和 adapter；[官方 model syntax](https://casbin.org/docs/syntax-for-models#expression-order-in-matchers)展示了错误表达式顺序可能造成数量级延迟差异，因此必须用本项目 permission matrix 做 benchmark。

官方没有给出 Cloudflare Workers 支持承诺。包内虽提供 ESM、Buffer polyfill 和可替换 filesystem 接口，但生产 adapter、watcher、冷启动与 bundle 兼容仍需 PoC，不能因“browser 可导入”推导为 Worker 已验证。

### 裁决

- **P0：不采用。** 当前 capability 列表和单一受信管理员路径，用枚举 + 集中纯函数比引入 model/policy/adapter 更少真相。
- **可借鉴：** subject/object/action、deny override、`enforceEx` 命中规则输出。
- **重新评估条件：** 角色组合和 scope 数量明显增长，但仍不需要关系图；此时 Casbin 是最低成本的外部候选。
- **不适用：** 不承载 D-063 账本，不负责 D-064 供应商数据资格，不成为 RoutePolicy 排序器。

## 6. Open Policy Agent（OPA）

### 能力与优势

OPA 是通用策略引擎，Rego 对任意结构化 JSON input 求值，并可返回布尔值、对象、集合等结构化结果；[官方文档](https://www.openpolicyagent.org/docs)明确它把 policy decision 与 enforcement 解耦。这使它最适合 D-064 与 RoutePolicy 硬过滤：一次决策可以返回允许候选、按候选的排除原因、命中的数据/区域/合同规则和证据缺口，而不是只返回一个布尔值。

OPA 可以表达 RBAC/ABAC，但关系图不是它的专用存储模型。官方 [External Data](https://www.openpolicyagent.org/docs/external-data)文档明确：OPA 保存策略和数据的缓存/副本，不是二者的 source of truth；大数据集、更新频率和一致性要求决定应把数据放进 input、bundle、push 或按需拉取。将所有工作区关系复制到 OPA 会重新引入同步和内存问题。

### 版本、审计和解释

OPA 在四个候选中最接近本项目的策略发布/决策审计需求：

- [Bundles](https://www.openpolicyagent.org/docs/management-bundles)的 manifest 可带 `revision`，可同时交付 policy 与静态 data；
- [Decision Logs](https://www.openpolicyagent.org/docs/management-decision-logs)可记录 query、input、result、bundle metadata 和 decision id，并支持敏感字段掩码；
- [REST API](https://www.openpolicyagent.org/docs/rest-api)可返回 correlation 用的 `decision_id`、metrics，也能输出 explain trace。

但 explain trace 和 Rego 源码不等于运营解释。若采用，policy output 仍应主动返回稳定的中文可映射 reason code（例如 `data_class_denied`、`region_not_approved`、`plan_pool_denied`），后台展示结构化原因而不是原始 Rego trace。Decision Log 也不能替代 Core 的命令审计和 RouteSnapshot。

### 部署、延迟与本项目适配

OPA 可作为独立 daemon/sidecar，也可编译为 Wasm 嵌入 JavaScript。官方 [Wasm 文档](https://www.openpolicyagent.org/docs/wasm)说明核心语言可编译，部分 built-in 不支持；官方 [`@open-policy-agent/opa-wasm`](https://github.com/open-policy-agent/npm-opa-wasm)README 直接列出 Cloudflare Workers 加载 Wasm binary 的方式。Cloudflare 官方也确认 Workers 支持 `WebAssembly.instantiate()`，但线程不可用且 Wasm 包体会影响启动时间。[Cloudflare Wasm 文档](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)

官方 [Policy Performance](https://www.openpolicyagent.org/docs/policy-performance)讨论约 1ms 决策预算和规则索引，但不是对任意 Rego 的 SLA。独立 OPA 增加网络和服务可用性；Wasm 避免网络跳转，却需要编译、bundle 分发、内存/冷启动和 unsupported built-ins 验证。两种方式都必须用三模态 RoutePolicy 的最大候选数和真实 input 做 benchmark。

### 裁决

- **P0：不引入 OPA server，也不引入 OPA Wasm 作为生产依赖。** 首轮先验证策略合同和三模态闭环，避免同时建设 Rego 工具链。
- **P0 借鉴：** versioned bundle/revision、结构化 decision、decision id、reason codes、input/result 脱敏和 decision log。
- **P1 首选场景：** D-064/区域/合同/来源规则由独立安全角色维护，规则频繁变化，并需要在 Node Core、Worker 或更多 enforcement points 一致执行。
- **若进入 PoC：** 先测 Wasm 嵌入，不先加独立服务；只处理确定性硬过滤，禁止联网 built-in、秘密读取、健康排序、扣额与供应商调用。

## 7. Cedar

### 能力与优势

Cedar 是面向应用授权的策略语言与引擎。每个请求固定为 principal、action、resource、context（PARC）；[官方授权算法](https://docs.cedarpolicy.com/auth/authorization.html)采用 default deny、`forbid` 覆盖 `permit`，并返回 determining policies 与错误诊断。相比原始 Rego trace，这种输出更容易映射成后台“为什么允许/拒绝”。

Cedar 官方 [design patterns](https://docs.cedarpolicy.com/overview/patterns.html)同时描述 RBAC、ABAC 和 ReBAC，可借 entity groups/hierarchies 表达角色、工作区和资源继承；[schema validation](https://docs.cedarpolicy.com/policies/validation.html)能检查实体、action、属性和类型，适合防止数据等级字段或 capability 名称拼写漂移。

它适合“一个主体是否可以对一个资源执行动作”的类型化判断，也可逐 Deployment 检查 D-064 条件；但它不是全局关系数据库。官方术语文档要求应用向引擎提供相关 policies 和 entity data，包括组和文件夹层级；因此大规模 `ListObjects`、关系更新和全图查询仍不如 OpenFGA。[官方术语与实体说明](https://docs.cedarpolicy.com/overview/terminology.html)

### 版本、审计和解释

Cedar 引擎提供 policy parsing、schema validation、authorization diagnostics 和分析能力，但开源核心不是带分布式 policy store、不可变 revision、发布审批和 decision log 上传的完整控制面。若采用，本项目仍须保存 policy set revision、schema revision、发布/回滚记录和脱敏 decision event。

其 determining policies 很适合开发/运营下钻，但“不存在任何 permit”造成的默认拒绝只会得到空 determining list；产品仍需补充缺失权益、未知 capability、证据过期等业务 reason code。

### 部署、延迟与本项目适配

官方 [`cedar-wasm`](https://github.com/cedar-policy/cedar/tree/main/cedar-wasm)提供 JavaScript/TypeScript 的 ESM、Node 和 web 包，可在现有 Node Core 内嵌；Cloudflare Workers 支持通用 Wasm，但 Cedar 官方没有声明 Worker 生产兼容，必须验证 bundling、包体、冷启动、单线程和策略/entity slice 大小。

内嵌执行避免网络跳转；延迟主要受 policy set、entity 数据和请求切片影响。官方授权文档也提醒，若无法提供全部 policy/entity，应由应用筛选相关切片；切片正确性会成为新的安全责任。因此仍需 fail-closed、schema validation 和真实 benchmark。

### 裁决

- **P0：不采用。** 为当前 capability 列表引入新语言、schema 与 Wasm 工具链仍属过早。
- **最值得借鉴：** default deny、forbid override、schema validation、determining policies 与 error diagnostics。
- **P1 次选：** 如果希望一个嵌入式、强类型、比 Rego 更聚焦授权的引擎统一 capability、数据等级和资源条件，Cedar 比 Casbin 更适合复杂属性策略，也比 OPA 更易限制表达边界。
- **不替代 OpenFGA：** 当核心问题变成大规模关系图查询和资源列表授权时，仍应选 OpenFGA。

## 8. P0 推荐实现合同

### 8.1 三个相互独立的 evaluator

不要为了“统一策略”把权限、权益和供应路由揉成一份 DSL。P0 保持三类纯函数及独立 revision：

```ts
authorizeCapability(actor, permission, targetContext)
  -> { allowed, reasonCode, permissionSource }

resolveEffectiveEntitlement(planRevision, accountAllocations, now)
  -> { effectiveEntitlement, sources, exclusions }

filterEligibleDeployments(routePolicyRevision, dataPolicyRevision, request, deployments)
  -> { allowedDeploymentIds, exclusionsByDeployment, evidenceRefs }
```

随后由 Core 的 routing planner 读取第三个结果，叠加 health/capacity overlay、排序并冻结 RouteSnapshot。以上函数对文本、图片、视频使用同一合同，但各 operation 的 capability、成本单位、异步接受态和 lifecycle conformance 分开配置。

### 8.2 决策事件最小字段

```text
decisionId
decisionType                  capability | entitlement | route_hard_filter
policyRevisionIds
actor/workspace/account refs
normalizedInputDigest
allowed / denied / partial
reasonCodes[]
candidateExclusions[]
evidenceRefs[] + evidenceAsOf
correlationId
decidedAt
engine                        core-v1 (future: opa-wasm / cedar / openfga / casbin)
```

敏感 input 不直接写日志；只记录分级、摘要和安全引用。凭据 secret、原始人脸/PII/health 内容、完整供应商响应不得进入决策日志。

### 8.3 为后续引擎预留的端口，而非提前抽象整个平台

`PolicyDecisionPort` 只需要接收规范化输入并返回上述稳定结果；P0 不实现通用 policy CRUD、DSL 编辑器或多引擎热切换。未来选型迁移时，用同一组黄金案例做 shadow evaluation，比对 allow/deny、reason codes 和候选集合，再经已有 candidate→simulate/eval→approve→publish→rollback 发布。

## 9. 何时重新启动选型

满足下列触发项之一再做 PoC：

1. 工作区、团队、资源共享关系超过简单 membership/owner，或需要高效 `ListObjects/ListUsers`：优先 OpenFGA。
2. D-064/区域/合同规则由安全或合规角色独立维护，并要跨 Core/Worker/更多服务一致发布：优先 OPA Wasm，Cedar 次选。
3. 角色和 scope 数量增长，但仍是单体 Node 应用和传统 RBAC/ABAC：优先 node-Casbin。
4. 需要 schema-safe、default-deny、forbid guardrail 和 determining-policy 解释，同时希望内嵌运行：优先 Cedar。
5. 任一候选进入 PoC，必须通过：功能等价、默认拒绝、revision pin、shadow diff、回滚、故障关闭、决策日志脱敏、Node/Worker 兼容、冷启动、p95/p99、策略更新一致性和三模态真实 RoutePolicy 最大输入测试。

## 10. 最终 Go / No-Go

| 候选 | P0 | 后续定位 |
| --- | --- | --- |
| OpenFGA | **No-Go** | 工作区/团队/资源 ReBAC 的专用候选 |
| Casbin | **No-Go** | 传统后台 RBAC 复杂度上升时的最低成本候选 |
| OPA | **No-Go（生产依赖）/ Go（借鉴 decision contract）** | D-064 与 RoutePolicy 硬过滤的首选策略引擎候选 |
| Cedar | **No-Go（生产依赖）/ Go（借鉴语义）** | schema-safe 嵌入式应用授权的次选 |

**最终建议：P0 不新增运行服务。** 把首轮工程预算用于三模态真实渠道、凭据、数据门禁、权益分配、RouteSnapshot、双账本与端到端故障证据；同时按本文件的 decision contract 留出可替换接缝。这样既不锁死后续采用成熟组件，也不让选型提前制造第二套产品真相。

## 11. 官方来源索引

### OpenFGA

- [Concepts](https://openfga.dev/docs/concepts)
- [Conditions](https://openfga.dev/docs/modeling/conditions)
- [Immutable Authorization Models](https://openfga.dev/docs/getting-started/immutable-models)
- [Docker and datastore deployment](https://openfga.dev/docs/getting-started/setup-openfga/docker)
- [JavaScript/Node SDK](https://github.com/openfga/js-sdk)
- [AuthZEN adapter limitations](https://github.com/openfga/openfga/blob/main/docs/authzen/README.md)

### Casbin

- [Overview and language feature matrix](https://casbin.org/docs/overview)
- [Model syntax and matcher performance example](https://casbin.org/docs/syntax-for-models)
- [ABAC](https://casbin.org/docs/abac)
- [Adapters](https://casbin.org/docs/adapters)
- [Watchers](https://casbin.org/docs/watchers)
- [node-Casbin](https://github.com/apache/casbin-node-casbin)

### OPA

- [OPA overview and Rego](https://www.openpolicyagent.org/docs)
- [Bundles](https://www.openpolicyagent.org/docs/management-bundles)
- [Decision Logs](https://www.openpolicyagent.org/docs/management-decision-logs)
- [REST API](https://www.openpolicyagent.org/docs/rest-api)
- [External Data](https://www.openpolicyagent.org/docs/external-data)
- [Policy Performance](https://www.openpolicyagent.org/docs/policy-performance)
- [Wasm](https://www.openpolicyagent.org/docs/wasm)
- [`@open-policy-agent/opa-wasm`](https://github.com/open-policy-agent/npm-opa-wasm)

### Cedar 与 Cloudflare

- [Authorization algorithm and diagnostics](https://docs.cedarpolicy.com/auth/authorization.html)
- [RBAC/ABAC/ReBAC design patterns](https://docs.cedarpolicy.com/overview/patterns.html)
- [Schema validation](https://docs.cedarpolicy.com/policies/validation.html)
- [Entities, groups and hierarchies](https://docs.cedarpolicy.com/overview/terminology.html)
- [`cedar-wasm`](https://github.com/cedar-policy/cedar/tree/main/cedar-wasm)
- [Cloudflare Workers WebAssembly runtime](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)
