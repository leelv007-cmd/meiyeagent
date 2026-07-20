# 可视化 LLM 编排平台深度调研：Dify 单家深调

> **交叉验证状态（Codex，2026-07-17）：未完成** — 三次尝试均因模型容量失败（gpt-5.6-sol at capacity，末次已核验 469k token 后中断），`xcheck/r08-xcheck.md` 不存在。本报告断言未经对抗验证，引用前需自行核对源码镜像（`references/repos/harness-2026-07-17/dify/`）。对决策无影响：Dify 在 D-037 中仅为战术搁置项。
>
> **Coze Studio 已被用户排除（2026-07-17，明显不符合要求），未调研。** 本报告为 Dify 一家的深度评估。Mastra Studio 由另一专项 agent 负责，不在本报告范围。
>
> 调研日期：2026-07-17　｜　调研员：候选组件深度调研 agent
> 项目：美业本地商家内容营销 Agent SaaS（TS 全栈：Next.js + Vercel AI SDK + PostgreSQL + 待选 durable 载体 DBOS/Inngest/Trigger.dev/CF Workflows）
> 评估目标：三种定位——(a) 当编排运行时　(b) 当「LLM 密集子工作流引擎」被 TS 代码主干经 API 调用　(c) 纯范式参考
>
> **证据标注约定**：
> - `【源码核实】` = 本地镜像源码直接读到（镜像 `references/repos/harness-2026-07-17/dify/`，`api/pyproject.toml` 版本 `1.16.0`）
> - `【官方核实】` = 官方文档 / marketplace / 官网现场读到
> - `【推断】` = 基于架构证据的合理推理，未直接证实

---

## 摘要（先看这一段）

**Dify v1.16.0 是一个成熟、可源码级核验的可视化 LLM 工作流平台，其 1.16 版本新增的暂停/恢复（HITL）子系统与我们五段式 Harness 的「挂起等用户输入 + revision fencing」需求高度吻合，且自托管下 workflow 版本 pin 免费可用。唯一但关键的顾虑是它的改版许可明文禁止多租户 SaaS 运营。**

| 维度 | 结论 |
|---|---|
| 版本 | `1.16.0`（源码核实） |
| 许可 | 改版 Apache 2.0，**禁止多租户运营（tenant=workspace）** + LOGO 条款（仅暴露前端时生效） |
| 后端 | Python；工作流引擎外置为 PyPI 包 `graphon==0.6.0`（DAG，源码不在仓内） |
| 自托管必需件 | api/worker/web/nginx + PostgreSQL + Redis + 一个向量库(默认 weaviate) + sandbox + plugin_daemon（源码核实 docker-compose） |
| durable / HITL | **强**：暂停即把完整 `GraphRuntimeState` 序列化落对象存储 + DB，凭 form_token 恢复，可挂到 form 过期(可配数天)；恢复锁版本=天然 fencing |
| 崩溃续跑 | **仅到暂停点**：工作流跑进程内线程(非 Celery)，进程崩溃丢失未暂停的在跑 run；另有异步调度器可 ~120s 粒度挂起耗时 run(协作式非崩溃触发) |
| 在跑实例遇改版 | **不受影响**：run 启动即绑定不可变版本快照(`Workflow.id`)，改画布发新版=新行，不动在途 run（源码核实） |
| 并发/限额 | `MAX_EXECUTION_STEPS=500`、`MAX_EXECUTION_TIME=1200s`、嵌套深度 5、每租户隔离队列并发默认 1（源码核实）；无内建幂等键去重 |
| Workflow-as-API | **成熟**：`POST /v1/workflows/run`(发布版) + `POST /v1/workflows/{id}/run`(**版本 pin**)，blocking/SSE 双模；**自托管版本 pin 免费**(403 门只在云版 BILLING+SANDBOX 触发) |
| 非代码人员 | **强**：草稿→发布→版本 pin 三态、变量系统、**加模型走控制台 UI** |
| 审计 | **强**：原生 OTel + 6 家 trace 供应商(Langfuse/LangSmith/Opik/Arize/Phoenix/Weave) + 节点级执行记录表 |
| 火山/豆包/视频 | 官方 **Volcengine Ark 插件**(UI 配 Key+Endpoint) + **Doubao 图/视频插件**(text-to-video/image-to-video，Seedance/Seedream 经火山接入)；视频是**插件 tool 节点**非核心原生节点 |

**定位建议（详见第九节）**：**(b)+(c)**。
- **(b) 技术可行、须法务前提**：作单实例/单 workspace 内部「LLM 密集子工作流引擎」，由 TS 主干经版本 pin API 调用，不暴露其前端 → 技术契合度高；**须法务确认「我们的 SaaS 客户不构成 Dify 的 tenant」使多租户禁令不适用**。
- **(c) 强推**：暂停/恢复契约、版本 pin fencing、Layer 架构、草稿-发布流是我们自建后台的最佳范式来源。
- **不当 (a) 运行时**：Python 常驻双语言、多租户许可禁令、崩溃续跑只到暂停点，与我们「TS 确定性主干 + 三进三出合同 + 自建 durable 载体」冲突。

---

## 一、版本与许可原文

**版本**：`api/pyproject.toml` = `version = "1.16.0"`；依赖 `graphon==0.6.0`（图引擎已外置为独立 PyPI 包）。`【源码核实】`

**许可（`dify/LICENSE` 原文，决定性）** `【源码核实】`：

> Dify is licensed under a **modified version of the Apache License 2.0**, with the following additional conditions:
>
> 1a. **Multi-tenant service**: Unless explicitly authorized by Dify in writing, **you may not use the Dify source code to operate a multi-tenant environment.**
>   - Tenant Definition: Within the context of Dify, **one tenant corresponds to one workspace.** The workspace provides a separated area for each tenant's data and configurations.
>
> 1b. **LOGO and copyright information**: In the process of using Dify's frontend, you may not remove or modify the LOGO or copyright information in the Dify console or applications. **This restriction is inapplicable to uses of Dify that do not involve its frontend.**
>   - Frontend Definition: ... the "frontend" of Dify includes all components located in the `web/` directory ... or the "web" image when running Dify with Docker.
>
> 2. As a contributor ... The producer can adjust the open-source agreement to be more strict or relaxed as deemed necessary.
>
> Apart from the specific conditions mentioned above, all other rights and restrictions follow the Apache License 2.0.

**对我们三种定位的许可结论**：
- **(a) 直接当多租户 SaaS 编排运行时 → 违反 1a**（我们客户 = 多个 workspace/tenant）。**排除。**
- **(b) 单实例/单 workspace 内部子引擎 → 1a 不覆盖（`【推断】`）**：若我们只起一个 workspace 的 Dify 内部实例、客户永不直接使用 Dify、由主干调其 API，属单租户用法。**但这是法律灰区，须法务确认「我们的终端客户不构成 Dify 定义下的 tenant」这一论断成立**，并留意条款 2「producer 可单方调紧协议」的长期风险。
- **LOGO 条款 1b 仅在暴露 Dify 前端时生效**。(b) 下我们不暴露 console/webapp → 不触发。
- **(c) 纯范式参考 → 完全无许可障碍**（看源码学设计不构成「使用其源码运营」）。

---

## 二、自托管组件栈与资源脚印（源码核实 docker-compose）

`docker/docker-compose.yaml` 定义的服务 `【源码核实】`：

**必需（核心）**：`api`、`api_websocket`、`worker`、`worker_beat`（Celery beat）、`web`、`nginx`、`init_permissions`。
**必需（数据）**：`db_postgres`（默认主库）、`redis`。
**必需（隔离/插件）**：`sandbox` / `local_sandbox`（代码节点执行隔离）、`plugin_daemon`（插件运行时，端口 5002）、`ssrf_proxy`（出网防 SSRF）、`agent_backend`。
**向量库（多选一）**：`weaviate`（默认）、`qdrant`、`pgvector`、`pgvecto-rs`、`chroma`、`milvus-standalone`(+`etcd`+`minio`)、`opensearch`、`elasticsearch`、`oceanbase`、`couchbase-server`、`oracle`、`iris` 等十余种。
**可选**：`db_mysql`、`certbot`。

**脚印结论**：**最小可用 = api+worker+web+nginx + PostgreSQL + Redis + 一个轻量向量库(weaviate/qdrant) + sandbox + plugin_daemon**。Milvus/etcd/minio 只在选 Milvus 时才需要——**默认栈明显比「必须一整套中间件」的方案轻**。纯 Docker Compose，依赖都是中国云有托管服务的主流件（PG/Redis/对象存储）。

> **对我们部署阶段的意义**：验证期跑 Cloudflare 时，Dify 不能塞进 CF Workers（要常驻容器 + 有状态中间件），须单独一台容器主机 / 中国云 ECS。若走 (b)，这是「主干在 CF + Dify 在旁边一台机」的旁挂形态，不是同栈。中国云迁移触发点后，Dify 的组件在火山/阿里云都有托管对应，落地顺滑。

---

## 三、工作流引擎 durable 语义（对照五段硬性质，诚实评估）

我们的硬性质：① crash 断点续跑；② 挂起数小时至数天等用户输入(恢复需 revision fencing)；③ 白话进度流；④ DecisionTrace 审计；⑤ 视频分钟级轮询。

### 3.1 暂停/恢复子系统（Dify 1.16 的核心亮点，源码充分）

- **图引擎外置** `graphon==0.6.0`；集成层在 `api/core/workflow/`。`【源码核实】`
- **暂停即全量落盘**：`api/core/app/layers/pause_state_persist_layer.py` 的 `PauseStatePersistenceLayer` 监听 `GraphRunPausedEvent`，把整个 `GraphRuntimeState.dumps()`（变量池 + 执行位点）+ generate entity + response-stream filter state 打包成版本化 `WorkflowResumptionContext(version="1")`，调 `repo.create_workflow_pause(...)` 持久化。`【源码核实】`
- **落盘位置 = 对象存储**：`WorkflowPause` 模型（`api/models/workflow.py:2083`）的 `state_object_key` 存序列化态的对象存储 key，DB 仅存指针 + 元数据；`workflow_run_id` 唯一约束保证一 run 对一暂停；`resumed_at` 软标记恢复。`【源码核实】`
- **revision fencing 天然满足**：`WorkflowPause` 显式存 `workflow_id`（某个具体版本 ID），模型注释原文「an application can have multiple versions of a workflow ... `app_id` alone is insufficient to determine which workflow version should be loaded when resuming」——**恢复时用暂停那一刻的版本画布，运营改画布不影响在途暂停的 run**。这正是我们要的 fencing。`【源码核实】`
- **挂起时长**：HITL form 带 `expiration_time`（`human_input_policy.py` / `pause_reason.py`）；暂停态在 DB/对象存储中持续到「被恢复」或「过期」。**挂几小时到几天完全支持**，上限由 form 过期时间配置。`【源码核实】`
- **HITL 面完整**：`human_input` 节点 + `agent_v2/ask_human_hitl.py` / `ask_human_resume.py`；恢复凭 `form_token`；`human_input_policy.py` 按 surface（SERVICE_API/CONSOLE/OPENAPI）分级可操作 recipient（token 调用者只能操作终端用户 web 表单，不能碰内部 console 流）。恢复入口在 `controllers/service_api/app/human_input_form.py`、`workflow_events.py`、`console/app/workflow_run.py`。`【源码核实】`

### 3.2 崩溃续跑的诚实评估（关键短板）

- 工作流**跑在 API 进程内的 `threading.Thread`**（`api/core/app/apps/workflow/app_generator.py` 的 `_generate_worker` + `threading.Thread(...).start()`），**不是 Celery 分发的可重投任务**。`【源码核实】`
- 持久化**只在暂停事件触发，没有节点级连续 checkpoint**。`【源码核实】`
- **另有异步调度器**：`AsyncWorkflowConfig.ASYNC_WORKFLOW_SCHEDULER_GRANULARITY`（默认 120s）——「few users could block the queue due to time-consuming tasks ... the checker will check the workflow queue and **suspend the workflow**」。即异步模式下，一个 ~120s 粒度的检查器可**挂起**耗时工作流让出队列（`【推断】`复用暂停持久化落盘/恢复）。这是**协作式挂起，不是崩溃触发**，但意味着长任务确有周期性 suspend/resume 杠杆。`【源码核实(配置) + 推断(机制复用)】`
- **结论**：Dify 的 durable = 「人工挂起可跨天恢复」+「异步长任务可协作挂起」，**不等于「任意崩溃点自动续跑」**。进程在两个 suspend/pause 点之间崩溃 → 该 run 在途状态丢失，需业务侧幂等重跑。

### 3.3 在跑实例遇画布改版的行为（源码核实，正面）

- run 启动时按 `Workflow.id == application_generate_entity.app_config.workflow_id` 解析出一条**不可变版本快照**（`app_generator.py:629`）。`【源码核实】`
- 发布新版 = 新建一条 `Workflow` 行（`version` 字段：`"draft"` 唯一草稿 | 版本号快照）。**在跑实例持有自己的版本，改画布/发新版不动在途 run。** `【源码核实】`

### 3.4 并发与幂等（源码核实）

- `WORKFLOW_MAX_EXECUTION_STEPS=500`（单 run 节点步数上限）、`WORKFLOW_MAX_EXECUTION_TIME=1200s`（单 run 墙钟上限，**默认 20 分钟**）、`WORKFLOW_CALL_MAX_DEPTH=5`（嵌套工作流调用深度）。`【源码核实】`
- `TENANT_ISOLATED_TASK_CONCURRENCY=1`（每租户隔离队列默认单并发）+ 队列监控任务。`【源码核实】`
- **无内建幂等键去重机制**（`【推断】`未见）——重复提交去重须我们主干自理。

### 3.5 对照五段的净结论

| 硬性质 | Dify 支持度 |
|---|---|
| ② 挂起等用户输入 + revision fencing | **完全对齐，且是现成实现**（1.16 新亮点，可直接用或抄） |
| ① crash 断点续跑 | **只到 pause/suspend 点，不到任意节点**；进程内线程崩溃丢在途 run |
| ③ 白话进度流 | SSE streaming 逐事件流可中继到前端（见第四节） |
| ④ DecisionTrace 审计 | 节点级执行记录 + OTel/Langfuse（见第六节），强 |
| ⑤ 视频分钟级轮询 | 单 run 默认 20 分钟上限，轮询建议建模为「发起→暂停等回调→恢复」以免撞限/崩溃丢失 |

---

## 四、Workflow-as-API（混合路线 (b) 的关键，源码核实）

**端点**（`controllers/service_api/app/workflow.py`）`【源码核实】`：
- `POST /v1/workflows/run` —— 跑**当前发布版**，需已发布工作流。
- `POST /v1/workflows/{workflow_id}/run` —— 跑**指定版本**（版本 pin），`workflow_id` = 某已发布版本 ID。
- `GET /v1/workflows/run/{workflow_run_id}` —— 查 run 详情。
- `POST /v1/workflows/tasks/{task_id}/stop` —— 停止（仅 streaming 模式）。
- 鉴权：per-app Service API Key（`Authorization: Bearer app-...`）。
- **响应模式** `response_mode`：`blocking`（同步 JSON）| `streaming`（**SSE** text/event-stream 逐事件流）；省略默认 blocking。

**版本 pin 的收费门（利好，源码核实）**：`POST /v1/workflows/{id}/run` 内——
```python
if dify_config.BILLING_ENABLED:
    billing_info = BillingService.get_info(app_model.tenant_id, exclude_vector_space=True)
    if billing_info["enabled"] and billing_info["subscription"]["plan"] == CloudPlan.SANDBOX:
        raise WorkflowVersionExecutionNotAllowedError()   # 403
```
即 **403「version execution not allowed」只在 `BILLING_ENABLED`（=Dify 云版）且 SANDBOX 计划时触发。自托管 CE 默认 `BILLING_ENABLED=false`，版本 pin 完全免费可用**。→ 我们「主干调 v12 版画布，防运营改挂线上」的需求，**在自托管 Dify 上原生做得到**：批准时记下该版本的 `workflow_id`，主干永远调 `/v1/workflows/{那个id}/run`。

**输入/输出 schema**：`inputs` = 发布工作流定义的变量键值对；blocking 返回 `data.status`（`succeeded`/`failed`）+ `data.outputs`（结构化结果）+ `data.error`。`【源码核实/推断】`

**③ Brief 编译调用骨架（TypeScript，从主干调自托管 Dify）**：
```typescript
// Stage ③ "Brief compilation" delegated to a version-pinned Dify workflow.
// Self-hosted Dify CE: BILLING_ENABLED=false, so version-pinned execution is free.
const DIFY_BASE = process.env.DIFY_BASE_URL;   // e.g. http://dify-internal:5001
const DIFY_APP_KEY = process.env.DIFY_APP_KEY; // per-app service key "app-..."

// Pin the exact published version by its workflow_id, captured at approval time,
// so an operator editing the canvas cannot change what production runs.
const PINNED_WORKFLOW_ID = "b1f2...-v12";      // stored in our DB next to the app

async function compileBrief(input: BriefInput): Promise<BriefResult> {
  const res = await fetch(`${DIFY_BASE}/v1/workflows/${PINNED_WORKFLOW_ID}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DIFY_APP_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: {
        intent: input.intent,
        shop_profile: input.shopProfile,
        content_type: input.contentType,
      },
      response_mode: "blocking",   // "streaming" -> SSE token stream to relay to our UI
      user: input.tenantUserId,    // our end-user id (Dify-side trace/isolation)
    }),
  });
  if (!res.ok) {
    // 403 => workflow_version_execution_not_allowed (only on billed cloud SANDBOX)
    throw new DifyWorkflowError(res.status, await res.text());
  }
  const body = await res.json();
  if (body.data.status !== "succeeded") {
    throw new DifyWorkflowError(500, body.data.error);
  }
  return body.data.outputs as BriefResult;
}
```

**时延开销** `【推断】`：blocking 下一次 run = 内部各 LLM/工具节点串行耗时之和 + 一次 HTTP 往返；本地内网多一跳可忽略，换来「运营可视化改 prompt/节点」。**注意单 run 默认 20 分钟墙钟上限**（`WORKFLOW_MAX_EXECUTION_TIME`），Brief 编译这种秒级任务无碍，但含视频轮询的长流须走 async/暂停范式。

**错误传播**：HTTP 状态码 + `data.error` 文本 + 少量业务错误码（如 `workflow_version_execution_not_allowed`）；**无细粒度结构化错误码分层**，须我们主干包一层错误归一化。

---

## 五、非代码人员体验（本次选型核心轴：常变的是 prompt / 模型择优参数 / ④段策略顺序，由后台非技术人员调）

- **草稿/发布/版本三态（源码核实）**：`models/workflow.py` 的 `version` 字段——`"draft"`（每 app 唯一草稿）| 版本号（发布快照）；`graph` = 画布 JSON，`features` = dict。发布即生成新版本行 → **「改草稿 → 发布 → 按版本 pin 调用」是现成闭环**，运营改草稿不影响主干调的已发布版本，天然「改而不炸线上」。
- **回滚**：每次发布留版本快照，可回滚到历史版本（`【推断】`基于版本行不可变）。
- **变量系统（源码核实）**：变量池 + 环境变量节点 + 会话变量（`workflow_conversation_variables` 表）+ 草稿变量（`workflow_draft_variables` 表）+ HITL 表单变量（`FormInputConfig`/`SelectInputConfig`，支持变量回填 select 选项）。
- **加模型 = 控制台 UI 操作** `【官方核实】`：Settings → Model Provider → 选供应商（如 Volcengine Ark）→ 填 API Key + Endpoint。**非技术人员可自助加模型商/换 key/切模型，无需改配置文件重启**——这对「后台非代码人员调整模型/参数」是实打实的加分。
- **prompt 编辑**：在画布 LLM 节点里所见即所得编辑，变量用 `{{}}` 插值；节点级单步/整流试跑（Dify 通用调试面板，`【推断】`前端能力）。
- **测试运行/防错**：草稿态独立于发布态，运营在草稿里试跑不影响线上；发布是显式动作。→ **「改错了也炸不到线上」的护栏由「草稿/发布分离 + 主干版本 pin」双重保证。**

> **本轴净结论**：Dify 在「非技术运营后台可视化调 prompt/模型/参数、且改错不炸线上」这条核心轴上**产品化成熟**，是我们后台可直接抄的范式，也是 (b) 路线相对「主干里硬编码 prompt」的最大增益点。

---

## 六、审计与观测

- **6 家 trace 供应商（源码核实）**：`api/core/ops/entities/config_entity.py` 内建枚举 `ARIZE / PHOENIX / LANGFUSE / LANGSMITH / OPIK / WEAVE`。→ **与我们并行评估的 Langfuse 原生直连**（见同目录 `05-langfuse.md`），DecisionTrace 审计有现成通路。
- **原生 OpenTelemetry**：`api/extensions/otel/`（`instrumentation.py` + celery sqlcommenter），可接外部 OTel collector。`【源码核实】`
- **运行日志/导出**：节点级 `workflow_node_executions` 表（每节点 status/输入/输出/耗时）+ `workflow_app_logs` + `workflow_run_archive_bundles`（归档）+ `execution_extra_content` offload（大字段外置）。`【源码核实】`
- **对我们 DecisionTrace 的意义**：Dify 的节点级执行记录 + Langfuse 打通，足以覆盖我们「全程 DecisionTrace 审计」中「④执行择优段」的细粒度 trace；主干侧再补①②③⑤段的编排级 trace 即成完整链路。

---

## 七、模型接入（火山方舟 / 豆包 / 视频）

- **模型商全插件化** `【官方核实】`：Dify 把模型商做成 marketplace 插件，由 `plugin_daemon` 运行时加载。
- **Volcengine Ark 官方插件**（`langgenius/volcengine`）`【官方核实】`：支持基础 + 多模态模型调用；配置 = Volcengine 控制台建 Ark API Key → Dify Settings → Model Provider → Volcengine Ark → 填 Key + Endpoint。**UI 配置，非技术人员可自助。**
- **豆包图/视频插件**（`allenwriter/doubao_image`，Doubao Image and Video Generator）`【官方核实】`：text-to-image、**text-to-video、image-to-video**，走火山豆包 API；**Seedream/Seedance** 经 Volcengine 集成暴露。
- **自定义 OpenAI 兼容端点**：原生支持。`【官方核实】`
- **视频节点性质**：**Dify 核心没有内建「视频生成节点」**，视频能力以 **marketplace tool 插件**形式提供（豆包图/视频插件），或用 **HTTP 请求节点**自接火山/即梦 API。→ 我们④段「Seedance/即梦直调 + ffmpeg 薄壳 + 分钟级轮询 + 标识烧录」若放进 Dify，须以插件/HTTP 节点 + 暂停轮询范式实现，**并不比我们主干直调更省事**，且撞 20 分钟单 run 上限的风险要用暂停范式规避。

> **净结论**：文本/图这类「LLM 密集」子任务，Dify 的火山方舟插件 UI 化接入对非技术运营很友好；但**视频成片这条不构成选 Dify 的理由**——无论走谁都要自接火山/即梦视频 API，我们既定的「主干直调 + ffmpeg 薄壳」方案更直接。

---

## 八、值得抄进自建后台的范式清单（(c)，均源码级看过）

1. **暂停/恢复的持久化契约**：`WorkflowResumptionContext(version="1")` + 对象存储存 state + DB 存指针 + `resumed_at` 软标记 —— 直接是我们「挂起数天等用户输入 + revision fencing」的实现蓝本。
2. **恢复时锁版本**：`WorkflowPause.workflow_id` 存暂停时的具体版本，恢复用同版本 —— revision fencing 的标准做法。
3. **surface 分级的 HITL token 权限**：`human_input_policy.py` 按 SERVICE_API/CONSOLE/OPENAPI 各自允许的 recipient 类型 + token 优先级 —— 多入口下「谁能恢复这个暂停」的干净权限模型。
4. **草稿→发布→版本 pin 三态**：`version="draft"` 唯一 + 发布快照 + 按 workflow_id 调用 —— 非技术运营「改而不炸线上」的产品化闭环。
5. **可插拔 Layer 架构**：`GraphEngineLayer`（观测层/持久化层/限额层/会话变量层各自 `on_event`）—— 把持久化/审计/配额从主执行逻辑解耦，正好对齐我们「确定性主干 + 横切关注点分层」。
6. **异步调度器的协作式挂起**：`ASYNC_WORKFLOW_SCHEDULER_GRANULARITY` ~120s 检查器挂起耗时任务让出队列 —— 多租户公平性的参考机制。
7. **workflow-as-API 的 blocking/streaming 双模 + `tasks/{id}/stop` + 版本化 run**：对外契约设计参考。
8. **模型商 UI 化接入**（Settings → Model Provider 填 Key/Endpoint）：非技术人员自助换模型的交互范式。
9. **节点级执行记录 + 大字段 offload**（`workflow_node_executions` + `execution_extra_content`）：DecisionTrace 审计存储的落地参考。

---

## 九、三选一定位结论

### 定位建议：**(b) + (c)**（不当 (a)）

**(c) 纯范式参考 —— 强推、无条件采纳**
Dify 1.16 的暂停/恢复契约、版本 pin fencing、Layer 架构、草稿-发布流、模型商 UI 接入、节点级审计存储，是我们自建 TS 后台**最直接、最成熟的范式来源**，源码可逐条核验。无论最终是否用 (b)，(c) 都应落地——把上述九条范式吸收进我们的编排总纲与后台设计。

**(b) 当内部 LLM 密集子工作流引擎 —— 技术可行、须法务前提、择时启用**
- **技术契合度高**：`POST /v1/workflows/{id}/run` 自托管版本 pin 免费、blocking/SSE 双模、HITL 落库跨天恢复、Langfuse/OTel 审计、加模型 UI 化——恰好补齐「让非技术运营可视化维护 LLM 子流程」这块我们主干不擅长的部分。
- **适用边界**：适合「③Brief 编译」「①意图正名」这类**纯 LLM、秒级、无外部长轮询**的子任务下放给 Dify 画布，让运营调 prompt/模型；**不适合**把含视频轮询、跨天 HITL 的主干编排整体搬进去（那是我们主干 + 自建 durable 载体的职责）。
- **两个硬前提**：① **法务确认多租户禁令 1a 对「单实例内部调用」不适用**；② 接受「旁挂一台容器主机跑 Dify」的部署形态（非 CF 同栈）。
- **建议节奏**：验证期先不引入（保持主干最快栈）；当「非技术运营要频繁独立维护多个 LLM 子流程」成为真实痛点、且中国云迁移触发点临近时，再把选定的 LLM 密集子流程迁进 Dify 画布。

**(a) 当编排运行时 —— 排除**
理由三条：① **许可禁止多租户运营**（我们客户 = 多 workspace）；② **Python 常驻服务与 TS 主干双语言**，运维与心智双负担；③ **崩溃续跑只到暂停点**，且要把「确定性主干 + 三进三出合同 + revision fencing + 视频分钟级轮询」硬塞进它的画布范式，与既定架构正面冲突。我们的五段式 Harness 仍应是「TS 确定性主干 + 自建 durable 载体（DBOS/Inngest/Trigger.dev/CF Workflows 择一）」，把 Dify 当「怎么把可变 prompt/画布产品化给非技术运营」的现成答案来抄，而非当地基。

---

## 来源 URL

**本地源码镜像（`【源码核实】`基础，Dify v1.16.0）**：
- `references/repos/harness-2026-07-17/dify/LICENSE`
- `references/repos/harness-2026-07-17/dify/api/pyproject.toml`（`version = "1.16.0"`、`graphon==0.6.0`）
- `.../dify/api/core/app/layers/pause_state_persist_layer.py`
- `.../dify/api/core/workflow/human_input_policy.py`
- `.../dify/api/core/workflow/workflow_entry.py`
- `.../dify/api/core/app/apps/workflow/app_generator.py`（`_generate_worker` 线程模型、`Workflow.id==workflow_id` 版本绑定）
- `.../dify/api/models/workflow.py`（`WorkflowPause` / `WorkflowRun` / `version`/`draft` / 节点执行表）
- `.../dify/api/controllers/service_api/app/workflow.py`（run 端点 + 版本 pin 收费门）
- `.../dify/api/core/ops/entities/config_entity.py`（6 家 trace 供应商枚举）
- `.../dify/api/extensions/otel/`（原生 OTel）
- `.../dify/api/configs/feature/__init__.py`（`AsyncWorkflowConfig` / `WORKFLOW_MAX_EXECUTION_*` / `TENANT_ISOLATED_TASK_CONCURRENCY`）
- `.../dify/docker/docker-compose.yaml`（自托管服务清单）

**Dify 官方 / marketplace**：
- https://github.com/langgenius/dify
- https://docs.dify.ai
- https://dify.ai/pricing
- https://marketplace.dify.ai/plugin/langgenius/volcengine （Volcengine Ark 官方插件）
- https://marketplace.dify.ai/plugin/allenwriter/doubao_image （Doubao Image and Video Generator）

**火山方舟 / 豆包（模型侧）**：
- https://www.volcengine.com/product/doubao
- https://www.volcengine.com/docs/82379/2123228 （豆包大模型）
- https://www.volcengine.com/docs/82379/1494384 （方舟 Chat API）

> 备注：agent-reach MCP 本次不可用（`python_missing` bootstrap 失败，与项目记忆 `agent-reach-mcp-local-fix` 记录一致，需 python3.10 shim + 重启 Claude Code），联网调研走 WebSearch/WebFetch。**Coze Studio 本地镜像本次未落地，且已被用户排除，未纳入本报告。**
