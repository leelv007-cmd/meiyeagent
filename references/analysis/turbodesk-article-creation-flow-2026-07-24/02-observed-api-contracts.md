# 02｜实测 API、SSE 协议与数据合同

## 1. 证据和脱敏原则

本文件只记录以下内容：

- 页面实际发出的请求。
- 页面实际收到的响应和 SSE 标记。
- 刷新任务后能再次读取的持久化状态。
- 由这些观察直接支持的数据关系。

以下内容不记录：

- Cookie、Authorization、完整请求头。
- 登录账号、账号 ID、设备标识。
- `localIP` 的真实值。
- 可用于接管登录态的任何信息。

文中的 `[REDACTED]` 表示该字段在实测请求中存在，但值已主动删除。

## 2. 接口总表

| 方法 | 路径 | 作用 | 本次证据 |
| --- | --- | --- | --- |
| `POST` | `/api/agentHomepage/create` | 从首页创建文章任务 | 快速、深度各一次 |
| `GET` | `/api/agent/config?taskId=:id` | 读取任务配置快照 | 两任务均刷新验证 |
| `GET` | `/api/agent/persona` | 读取账号人设 | 页面初始化观察 |
| `GET` | `/api/agent/chat/page?page=1&size=10&taskId=:id` | 读取任务对话历史 | 两任务均刷新验证 |
| `POST` | `/api/agent/v2/chat` | 需求解析或正式生成，SSE 返回 | 快速失败与深度成功均观察 |
| `POST` | `/api/agent/v2/confirm/continue` | 确认生成参数并继续 | 倒计时自动调用 |
| `POST` | `/api/agent/v2/chat/retry` | 重试/刷新当前 Chat | 快速失败路径观察 |
| `POST` | `/api/agent/task/stop` | 停止当前任务 | 快速模式状态冲突后观察 |
| `GET` | `/api/editor/article/:taskId` | 读取右侧编辑器文档 | 两任务均为空 |
| `POST` | `/api/editor/article` | 保存右侧编辑器文档 | 页面合同观察 |
| `GET` | `/api/member/score` | 读取当前积分余额 | 多阶段前后观察 |
| `GET` | `/api/vip/score/point/consume` | 读取功能积分目录 | 完整响应已保存 |
| `GET` | `/api/publish/weixin/as/articles/v3` | 初始化微信发布资源 | 页面初始化观察 |
| `GET` | `/api/publish/toutiao/as/articles/v3` | 初始化头条发布资源 | 页面初始化观察 |
| `GET` | `/api/publish/baijiahao/as/articles/v3` | 初始化百家号发布资源 | 页面初始化观察 |
| `GET` | `/api/publish/xiaohongshu/as/articles/v3` | 初始化小红书发布资源 | 页面初始化观察 |

说明：

- 未执行最终发布，因此没有记录任何“创建平台草稿/正式发布”的写接口。
- 插图面板的搜索、AI 生图、本地上传和图片库入口可见，但没有逐项触发，不能臆造其请求路径。
- 上表只表示 2026-07-24 实测页面使用的合同，不能视为公开、稳定或受支持的第三方 API。

## 3. 首页任务创建

## 3.1 请求

```http
POST /api/agentHomepage/create
Content-Type: application/json
```

快速模式请求：

```json
{
  "type": "input",
  "query": "<p>创作一篇7月份头皮护理小红书图文</p>",
  "quick": true,
  "search": false,
  "styleId": -1,
  "attachment": [],
  "writingModelConfig": [
    {
      "label": "绘文 V4.1",
      "key": "gpt-5.2",
      "type": "个性化",
      "value": 0,
      "selected": true,
      "tip": "创作要求响应更精准",
      "picture": null
    },
    {
      "label": "绘文 V4",
      "key": "MaaS_o4_mini",
      "type": "个性化",
      "value": 1,
      "selected": false,
      "tip": "账号人设效果更优，创作要求理解更佳",
      "picture": null
    },
    {
      "label": "DeepSeek V3",
      "key": "DeepSeek V3",
      "type": "通用",
      "value": 1,
      "selected": true,
      "tip": "公众号/小红书内容、创意故事",
      "picture": null
    },
    {
      "label": "Qwen 3",
      "key": "qwen-max",
      "type": "严谨",
      "value": 0,
      "selected": false,
      "tip": "准确语义把控与结构化内容输出",
      "picture": null
    },
    {
      "label": "Kimi K2",
      "key": "k2",
      "type": "灵动",
      "value": 0,
      "selected": false,
      "tip": "激发新颖灵感与巧思",
      "picture": null
    },
    {
      "label": "Doubao Pro",
      "key": "doubao-seed-2.0-pro",
      "type": "口语化",
      "value": 0,
      "selected": false,
      "tip": "文风亲切，打造自然对话",
      "picture": null
    },
    {
      "label": "Doubao Pro 2.1",
      "key": "doubao-seed-2-1-pro",
      "type": "口语化",
      "value": 0,
      "selected": false,
      "tip": "文风亲切，打造自然对话",
      "picture": null
    }
  ],
  "file": null
}
```

深度模式使用相同提示词和模型配置，关键变化是：

```json
{
  "quick": false
}
```

## 3.2 响应

快速任务：

```json
{
  "code": 0,
  "data": 18210804,
  "msg": "成功"
}
```

深度任务：

```json
{
  "code": 0,
  "data": 18210820,
  "msg": "成功"
}
```

## 3.3 合同含义

- `data` 是新建任务 ID，而不是文章内容。
- `query` 允许 HTML。
- `writingModelConfig` 把前端展示信息和执行配置混在同一数组中。
- `selected` 表示候选模型是否启用；`value` 更接近生成数量。
- `styleId=-1` 表示未指定自定义风格。
- `attachment=[]` 与 `file=null` 并存，说明可能兼容不同附件协议。

## 3.4 复刻建议

不要让浏览器传入模型的展示文案、图标和提示说明。推荐只传：

```json
{
  "input": {
    "format": "html",
    "content": "<p>...</p>"
  },
  "mode": "deep",
  "styleId": null,
  "models": [
    { "modelId": "writing-v4.1", "count": 1 },
    { "modelId": "deepseek-v3", "count": 1 }
  ],
  "attachments": []
}
```

服务端再根据 `modelId` 读取受信配置，避免客户端伪造模型 key、价格或能力。

## 4. 任务配置读取

## 4.1 请求

```http
GET /api/agent/config?taskId=18210820
```

## 4.2 成功任务关键响应

```json
{
  "code": 0,
  "data": {
    "id": 84301,
    "userId": "[REDACTED]",
    "role": "",
    "style": "",
    "styleId": -1,
    "xhsStyle": null,
    "quick": false,
    "search": false,
    "writingModelConfig": [
      {
        "label": "绘文 V4.1",
        "key": "gpt-5.2",
        "value": 0,
        "selected": true
      },
      {
        "label": "DeepSeek V3",
        "key": "DeepSeek V3",
        "value": 1,
        "selected": true
      }
    ],
    "editModelConfig": null
  },
  "msg": "成功"
}
```

数组中还包含其他未选模型，完整脱敏快照见 `observed-contracts.json`。

## 4.3 数据关系

- 两个任务返回同一个配置实体 `id`，但 `quick` 会随任务变化。
- **[推断]** 该接口可能返回“用户 Agent 配置 + 任务覆盖值”的合成视图，而不一定是一任务一行配置。
- 复刻时应把“用户默认设置”和“任务创建时快照”分开，历史任务不能因用户后来修改默认模型而改变。

## 5. 首次 Chat：需求解析

## 5.1 请求

```http
POST /api/agent/v2/chat
Accept: text/event-stream
Content-Type: application/json
```

实测请求：

```json
{
  "cite": {
    "type": "others",
    "title": "",
    "content": "",
    "source": ""
  },
  "content": "<p>创作一篇7月份头皮护理小红书图文</p>",
  "attachment": [],
  "taskId": "18210804",
  "quick": true,
  "styleId": -1,
  "file": null,
  "autoImg": false,
  "demo": false,
  "localIP": "[REDACTED]",
  "version": 2
}
```

深度任务的差异是 `taskId` 和 `quick=false`。

## 5.2 字段解释

| 字段 | 观察到的作用 | 注意点 |
| --- | --- | --- |
| `cite` | 当前引用上下文 | 空引用仍传完整对象 |
| `content` | 用户消息 HTML | 需做服务端 HTML 清洗 |
| `attachment` | 附件列表 | 与 `file` 存在重叠 |
| `taskId` | 任务归属 | 服务端必须校验资源所有权 |
| `quick` | 快速/深度模式 | 是本次成功与失败的主要变量 |
| `styleId` | 写作风格 | `-1` 表示默认 |
| `autoImg` | 此轮是否自动配图 | 首次澄清为 `false` |
| `demo` | 演示模式 | 本次 `false` |
| `localIP` | 客户端上送的 IP | 不应作为可信安全信号 |
| `version` | 协议版本 | 本次为 `2` |

### 安全建议

浏览器上送的 `localIP` 可以被伪造，不应参与授权、计费、风控的最终判定。若确有诊断价值，应由服务端记录连接信息，并最小化保存。

## 6. 确认继续

## 6.1 请求

```http
POST /api/agent/v2/confirm/continue
Content-Type: application/json
```

实测字段：

```json
{
  "taskId": "18210820",
  "chatId": 1748050,
  "writingModelConfig": [
    {
      "label": "绘文 V4.1",
      "key": "gpt-5.2",
      "value": 1,
      "selected": true
    },
    {
      "label": "DeepSeek V3",
      "key": "DeepSeek V3",
      "value": 1,
      "selected": true
    }
  ],
  "wordNum": "500",
  "platform": "小红书",
  "content": "",
  "autoImg": true,
  "showType": "writeConfirm"
}
```

未列出的模型仍可出现在实际数组中，但数量为 0、未选中。

## 6.2 响应与后续

确认成功后，前端紧接着发起第二次 Chat SSE。

这表明确认接口本身不执行完整生成，更像：

1. 更新确认卡/Chat 状态。
2. 固化用户选择。
3. 允许下一条正式生成消息开始。

## 7. 正式生成 Chat

## 7.1 请求

```json
{
  "content": "创作类型：小红书，篇幅：500。无其他补充，请开始创作。",
  "genArticle": true,
  "autoImg": true,
  "noSearch": true,
  "taskId": "18210820",
  "quick": false,
  "styleId": -1,
  "file": null,
  "demo": false,
  "localIP": "[REDACTED]",
  "version": 2
}
```

## 7.2 关键观察

- `content` 已从用户原始语言转成标准化指令。
- `genArticle=true` 标记此轮是正式文章生成。
- `autoImg=true` 触发配图阶段。
- `noSearch=true` 与实际出现 3 个深度检索任务并存。
- `version=2` 与首次 Chat 相同。

`noSearch` 的确切内部语义无法从外部证明。复刻时不要使用含混的双重否定字段，推荐明确写：

```json
{
  "researchPolicy": "deep",
  "allowExternalSearch": true,
  "useUserMaterialsOnly": false
}
```

## 8. SSE 传输协议

## 8.1 Content-Type

```http
Content-Type: text/event-stream
```

## 8.2 控制标记

本次观察到的控制标记：

| 标记 | 推定含义 |
| --- | --- |
| `[TASK_STEP_START]` | 开始一个大阶段 |
| `[TASK_ITEM_START]` | 开始阶段中的子任务 |
| `[THINKING_START]` | 开始思考/处理展示 |
| `[REQUIREMENT_START]` | 开始需求确认区 |
| `[REQUIREMENT_END]` | 结束需求确认区 |
| `[THINKING_END]` | 结束思考展示 |
| `[TASK_ITEM_END]` | 结束子任务 |
| `[CHAT_ID]` | 返回/更新 Chat 标识 |
| `[CHAT_RETRY]` | 附加重试上下文 |
| `[TASK_STEP_END]` | 结束大阶段 |
| `[EV_END]` | 结束当前事件流 |
| `[GPT_ERROR]` | 模型/编排错误消息 |

## 8.3 JSON 对象类型

成功任务最终响应中解析到 12 个 JSON code block：

| `type` | 数量 | 用途 |
| --- | ---: | --- |
| `TASK_TITLE` | 5 | 更新当前阶段/任务标题 |
| `SEARCH_TASK` | 1 | 三个搜索子任务及状态 |
| `SEARCH_RESULT` | 1 | 汇总参考内容 |
| `SEARCH_ANALYSIS` | 1 | 对参考内容的结构化分析 |
| `WRITING_ARTICLES` | 1 | 两个模型的初稿 |
| `CORRECT_ARTICLES` | 1 | 质检和优化后的文章 |
| `IMAGE_ARTICLES` | 1 | 配图阶段文章对象 |
| `RESULT` | 1 | 最终可选择候选稿 |

澄清响应另有：

- `REQUIREMENT`
- `REQUIREMENT_BUTTON`

错误/重试响应还出现：

- `VERSION_INFO`
- `[GPT_ERROR]...`

## 8.4 当前协议的优点

- 普通文字与结构化卡片可以在一个流中交错。
- 同一消息内容可以持久化，刷新后重新渲染。
- 前端能逐步展示搜索、写作、审查和配图。

## 8.5 当前协议的风险

- 控制标记和 JSON 混在一条文本流，截断或模型误输出标记时容易破坏解析。
- 缺少显式 `eventId`、`seq`、`runId`。
- `[EV_END]` 只表示流结束，不足以证明业务成功。
- `RESULT.articleList=null` 没有被明确映射为失败。
- 大消息达到 147,574 字符，重复保存全文和中间稿可能造成明显存储与传输浪费。

## 8.6 推荐解析器逻辑

```ts
type StreamState = {
  runId: string;
  seq: number;
  currentStepId?: string;
  currentItemId?: string;
  terminal?: "succeeded" | "partial" | "failed" | "cancelled";
};

function reduceEvent(state: StreamState, event: RunEvent): StreamState {
  if (event.seq <= state.seq) return state; // 去重

  switch (event.type) {
    case "step.started":
    case "step.progressed":
    case "step.completed":
    case "requirement.ready":
    case "candidate.generated":
    case "candidate.reviewed":
    case "asset.generated":
      return applyProgress(state, event);
    case "run.succeeded":
      return { ...state, seq: event.seq, terminal: "succeeded" };
    case "run.partially_succeeded":
      return { ...state, seq: event.seq, terminal: "partial" };
    case "run.failed":
      return { ...state, seq: event.seq, terminal: "failed" };
    default:
      return { ...state, seq: event.seq };
  }
}
```

连接关闭时：

```ts
if (!state.terminal) {
  const run = await api.getRun(runId);
  reconcileFromServer(run);
}
```

## 9. 搜索对象合同

## 9.1 搜索任务

可观察的任务字段：

```text
taskTitle
name
keyword
searchStatus
searchStatusName
iconType
searchResultVoList
```

本次 `keyword` 分别为：

```json
[
  "头皮护理 夏季出油原因 科学原理",
  "头皮护理 控油成分 产品推荐",
  "头皮护理 夏季控油技巧 用户心得"
]
```

## 9.2 单条搜索结果

```ts
type ObservedSearchResult = {
  avatar?: string;
  nickname?: string;
  cover?: string;
  title: string;
  url: string;
  content: string;
  platform?: string;
  publishTime?: string;
  noteId?: string;
  xsecToken?: string;
  like?: number | string;
  collect?: number | string;
  tags?: string[];
  pictures?: unknown[];
  index?: number;
};
```

## 9.3 缺少但复刻时必须增加

```ts
type TrustedSourceRecord = ObservedSearchResult & {
  sourceId: string;
  canonicalUrl: string;
  fetchedAt: string;
  authorType: "official" | "professional" | "media" | "brand" | "ugc" | "unknown";
  trustScore: number;
  extractionQuality: number;
  isAccessible: boolean;
  contentHash: string;
  claims: Array<{
    claim: string;
    evidenceQuote: string;
    supported: boolean;
  }>;
};
```

## 10. 文章候选合同

从写作、校正、配图到结果阶段，文章对象使用同一组字段：

```ts
type ObservedArticleCandidate = {
  taskTitle?: string;
  name?: string;
  modelName: string;
  llm: string;
  writingStatus?: number | string;
  writingStatusName?: string;
  iconType?: string;
  title: string;
  content: string;
  tags: string;
  correctedContent?: string;
  articleType: "xiaohongshu" | string;
  pictures: Array<{
    url: string;
    desc: string;
  }>;
  query?: string;
  withImg: boolean;
  styleId: number;
};
```

### 最终结果关键值

```json
{
  "articleType": "xiaohongshu",
  "withImg": true,
  "styleId": -1,
  "articleCount": 2,
  "picturesPerArticle": 4
}
```

### 合同缺口

- 没有可见的稳定 `candidateId`。
- `tags` 是一个空格分隔字符串，不是数组。
- 图片没有 `assetId`、宽高、模型、生成 Prompt、位置锚点、审核状态。
- 文章没有来源映射、事实声明和风险状态。
- 状态字段类型不清晰，可能同时存在数值码和中文名。

## 11. Chat 历史持久化

## 11.1 成功任务 `18210820`

```http
GET /api/agent/chat/page?page=1&size=10&taskId=18210820
```

刷新后的关键结果：

```json
{
  "total": 4,
  "size": 10,
  "current": 1,
  "completed": true,
  "records": [
    {
      "id": 1748048,
      "type": "req",
      "status": 0,
      "contentLength": 23,
      "refresh": false
    },
    {
      "id": 1748050,
      "type": "res",
      "status": 0,
      "contentLength": 1730,
      "refresh": false
    },
    {
      "id": 1748055,
      "type": "req",
      "status": 0,
      "contentLength": 28,
      "refresh": false
    },
    {
      "id": 1748068,
      "type": "res",
      "status": 0,
      "contentLength": 147574,
      "refresh": true
    }
  ]
}
```

对应关系：

1. 原始用户需求。
2. 需求解析和确认卡。
3. 确认后的标准化生成指令。
4. 搜索、写作、质检、配图和最终 `RESULT` 的完整响应。

## 11.2 快速失败任务 `18210804`

重试与停止之后，历史为：

```json
{
  "total": 6,
  "records": [
    { "id": 1748003, "type": "req", "status": 0, "contentLength": 23 },
    { "id": 1748021, "type": "req", "status": 0, "contentLength": 23 },
    { "id": 1748025, "type": "res", "status": 0, "contentLength": 1741 },
    { "id": 1748026, "type": "req", "status": 0, "contentLength": 28 },
    { "id": 1748027, "type": "res", "status": 0, "contentLength": 2738 },
    { "id": 1748029, "type": "req", "status": 6, "contentLength": 28 }
  ]
}
```

`status=6` 的具体枚举名称未从外部接口获得，因此只记录数值，不武断命名。

## 12. Article 编辑器持久化

## 12.1 读取合同

```http
GET /api/editor/article/18210820
```

成功任务在最终结果返回后的真实响应：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "fileId": "18210820",
    "title": "",
    "version": 0,
    "content": "",
    "chatId": 0,
    "contentType": "text/markdown"
  }
}
```

快速失败任务的 Article 也是：

```json
{
  "fileId": "18210804",
  "title": "",
  "version": 0,
  "content": "",
  "chatId": 0,
  "contentType": "text/markdown"
}
```

## 12.2 保存合同

页面暴露的自动保存请求为：

```http
POST /api/editor/article
Content-Type: application/json
```

核心载荷：

```json
{
  "fileId": "18210820",
  "title": "文章标题",
  "content": "编辑器正文"
}
```

## 12.3 数据模型结论

```text
Task
 ├─ AgentConfig snapshot
 ├─ ChatMessage[]
 │   └─ RESULT → CandidateArticle[]
 └─ ArticleDocument (0 or 1)
```

`CandidateArticle[]` 不等于 `ArticleDocument`。这条边界是复刻时最值得保留的设计之一。

## 13. 重试和停止

## 13.1 重试

```http
POST /api/agent/v2/chat/retry
Accept: text/event-stream
```

快速失败样本中返回：

```text
[GPT_ERROR]当前对话正在处理中，请稍后重试
```

## 13.2 停止

错误之后页面调用：

```http
POST /api/agent/task/stop
```

## 13.3 问题

- 客户端认为需要刷新/重试。
- 服务端认为仍在处理中。
- 随后客户端又停止任务。
- 用户未获得“当前 Run 的唯一权威状态”。

## 13.4 推荐合同

```http
POST /api/runs/:runId/retry
Idempotency-Key: retry_<uuid>
```

```json
{
  "strategy": "from_failed_step",
  "expectedStatus": "FAILED"
}
```

状态冲突应返回：

```http
409 Conflict
```

```json
{
  "code": "RUN_STATUS_CONFLICT",
  "runId": "run_...",
  "currentStatus": "RUNNING",
  "lastHeartbeatAt": "2026-07-24T06:30:24.000Z",
  "allowedActions": ["wait", "cancel"]
}
```

而不是在 SSE 中嵌入一条不可机器决策的中文错误文本。

## 14. 积分目录与本次消耗观察

## 14.1 功能积分目录

```http
GET /api/vip/score/point/consume
```

实测数据：

| point | 描述 | 积分 |
| --- | --- | ---: |
| `writing-style` | 体裁创作 | 6 |
| `custom-writing` | 自由创作 | 6 |
| `imitation` | 仿写风格 | 6 |
| `rewrite` | 改写内容 | 6 |
| `gen-title` | 起标题 | 1 |
| `article-ai-img` | AI 配图 | 0 |
| `ai-img` | AI 配图 | 1 |
| `old-kolors` | 绘图 1.0 | 4 |
| `kolors` | 绘图 1.0 | 1 |
| `jimeng` | 绘图 2.0 | 10 |
| `light-img-page-gen` | 套图生成（`${page}` 页） | 2 |
| `light-img-ai-img` | AI 配图 | 4 |

## 14.2 余额观察

- 测试开始观察到：2998。
- 快速模式故障、重试和停止之后：2954。
- 深度模式成功完成之后：2948。
- 成功深度任务期间可直接观察的下降：6。

### 不能得出的结论

- 不能把全程减少的 50 分全部归因于一次文章生成，因为期间执行了失败任务、多次重试和诊断。
- 不能仅凭目录断言内部每个搜索、模型、质检和配图节点的收费公式。
- `article-ai-img=0` 不表示所有图片生成永远免费；目录中还有多种图像 point。

## 14.3 复刻计费建议

```text
quote → reserve → execute → settle/release
```

1. 确认卡先展示预计费用。
2. 用户/超时确认后预占额度。
3. 每个子任务写可审计 usage。
4. 成功结算；未执行节点释放预占。
5. 重试复用 `billingReservationId`，防止重复扣费。
6. 部分成功按完成的候选和资产清晰结算。

## 15. 发布资源初始化

任务页会提前请求各平台文章资源列表：

```text
/api/publish/weixin/as/articles/v3
/api/publish/toutiao/as/articles/v3
/api/publish/baijiahao/as/articles/v3
/api/publish/xiaohongshu/as/articles/v3
```

这说明发布能力与编辑器同处一个工作区，页面会在用户点击发布前预加载平台账号/文章信息。

复刻时建议延迟加载，只有用户进入发布面板时才请求第三方账号资源，以减少首屏请求和权限暴露。

## 16. 推荐的复刻 API 边界

以下是推荐设计，不是讯飞绘文现有接口：

```text
POST   /v1/content-tasks
GET    /v1/content-tasks/:taskId
POST   /v1/content-tasks/:taskId/requirements
POST   /v1/content-tasks/:taskId/runs
GET    /v1/runs/:runId
GET    /v1/runs/:runId/events
POST   /v1/runs/:runId/retry
POST   /v1/runs/:runId/cancel
GET    /v1/tasks/:taskId/candidates
POST   /v1/tasks/:taskId/candidates/:candidateId/adopt
GET    /v1/documents/:documentId
PATCH  /v1/documents/:documentId
POST   /v1/documents/:documentId/export
POST   /v1/documents/:documentId/publish-intents
POST   /v1/publish-intents/:id/confirm
```

核心原则：

- Task、Run、Candidate、Document、PublishIntent 独立建模。
- 流式事件只负责增量通知；数据库状态是唯一真相。
- 所有有费用或外部副作用的写操作支持幂等。
- 采纳候选和发布都必须是显式命令。

