# DeepSeek 官方 API 文档全站镜像（zh-cn）

- 源站：https://api-docs.deepseek.com/zh-cn/（全站页面枚举：sitemap 无 zh-cn 条目，故由首页+二级页 href 爬取收敛）
- 拉取日期：2026-07-24；工具：Jina Reader（r.jina.ai）逐页转 Markdown，每文件头部自带 `Title:` 与 `URL Source:` 行（逐页引用凭据）
- 工具备注：用户指令 OpenCLI 优先——实探 opencli 的 `deepseek` 适配器为 chat.deepseek.com UI 自动化、无 api-docs 站点适配器与通用网页读取命令，按 web-access 工具选择表退 Jina（文档页最优通道），如实记录
- 存在依据：D-129（文案生成与内部编排判断位默认 LLM＝DeepSeek，默认型号＝deepseek-v4-pro；实施票引用接入细节一律指向本镜像，不凭模型记忆）

## 关键事实速览（源＝quick_start-pricing.md，2026-07-24 抓取）

- 现役模型两名：**deepseek-v4-flash / deepseek-v4-pro**（训练语料中的 deepseek-chat / deepseek-reasoner 命名已过时，勿再使用）
- **默认型号拍板＝deepseek-v4-pro**（D-129；v4-flash＝轻档备选，supply-registry catalog 运营可换）
- 1M 上下文、最大输出 384K；两型号均默认思考模式（切换见 guides-thinking_mode.md）
- 双格式端点：OpenAI 格式 `https://api.deepseek.com`；Anthropic 格式 `https://api.deepseek.com/anthropic`（见 guides-anthropic_api.md）
- JSON Output / Tool Calls / 对话前缀续写（Beta）/ FIM（Beta，仅非思考模式）均支持；上下文硬盘缓存自动生效（guides-kv_cache.md）
- 价格与并发限制以 quick_start-pricing.md 为准（本索引不复写数字，防陈旧）

## 页面对照表（本地文件 → 源 URL）

### 首页与总览

| 本地文件 | 页面标题 | 源 URL |
|---|---|---|
| `home.md` | 首次调用 API | https://api-docs.deepseek.com/zh-cn/ |
| `updates.md` | 更新日志 | https://api-docs.deepseek.com/zh-cn/updates |

### API Reference

| 本地文件 | 页面标题 | 源 URL |
|---|---|---|
| `api-deepseek-api.md` | Deepseek API | https://api-docs.deepseek.com/zh-cn/api/deepseek-api |
| `api-create-chat-completion.md` | 对话补全 | https://api-docs.deepseek.com/zh-cn/api/create-chat-completion |
| `api-create-completion.md` | FIM 补全（Beta） | https://api-docs.deepseek.com/zh-cn/api/create-completion |
| `api-list-models.md` | 列出模型 | https://api-docs.deepseek.com/zh-cn/api/list-models |
| `api-get-user-balance.md` | 查询余额 | https://api-docs.deepseek.com/zh-cn/api/get-user-balance |

### Quick Start

| 本地文件 | 页面标题 | 源 URL |
|---|---|---|
| `quick_start-pricing.md` | 模型 & 价格 | https://api-docs.deepseek.com/zh-cn/quick_start/pricing |
| `quick_start-error_codes.md` | 错误码 | https://api-docs.deepseek.com/zh-cn/quick_start/error_codes |
| `quick_start-rate_limit.md` | 限速与隔离 | https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit |
| `quick_start-token_usage.md` | Token 用量计算 | https://api-docs.deepseek.com/zh-cn/quick_start/token_usage |

### Guides

| 本地文件 | 页面标题 | 源 URL |
|---|---|---|
| `guides-thinking_mode.md` | 思考模式 | https://api-docs.deepseek.com/zh-cn/guides/thinking_mode |
| `guides-multi_round_chat.md` | 多轮对话 | https://api-docs.deepseek.com/zh-cn/guides/multi_round_chat |
| `guides-chat_prefix_completion.md` | 对话前缀续写（Beta） | https://api-docs.deepseek.com/zh-cn/guides/chat_prefix_completion |
| `guides-fim_completion.md` | FIM 补全（Beta） | https://api-docs.deepseek.com/zh-cn/guides/fim_completion |
| `guides-json_mode.md` | JSON Output | https://api-docs.deepseek.com/zh-cn/guides/json_mode |
| `guides-tool_calls.md` | Tool Calls | https://api-docs.deepseek.com/zh-cn/guides/tool_calls |
| `guides-kv_cache.md` | 上下文硬盘缓存 | https://api-docs.deepseek.com/zh-cn/guides/kv_cache |
| `guides-anthropic_api.md` | Anthropic API | https://api-docs.deepseek.com/zh-cn/guides/anthropic_api |
| `guides-coding_agents.md` | 接入 Agent 工具 | https://api-docs.deepseek.com/zh-cn/guides/coding_agents |

### Agent 集成（quick_start/agent_integrations）

| 本地文件 | 页面标题 | 源 URL |
|---|---|---|
| `quick_start-agent_integrations-astrbot.md` | 接入 AstrBot | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/astrbot |
| `quick_start-agent_integrations-claude_code.md` | 接入 Claude Code | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code |
| `quick_start-agent_integrations-copilot_cli.md` | 接入 GitHub Copilot CLI | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/copilot_cli |
| `quick_start-agent_integrations-crush.md` | 接入 Crush | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush |
| `quick_start-agent_integrations-deepcode.md` | 集成 Deep Code | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/deepcode |
| `quick_start-agent_integrations-github_copilot.md` | 接入 GitHub Copilot | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/github_copilot |
| `quick_start-agent_integrations-hermes.md` | 接入 Hermes | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/hermes |
| `quick_start-agent_integrations-kilo_code.md` | 接入 Kilo Code | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/kilo_code |
| `quick_start-agent_integrations-langcli.md` | 接入 Langcli | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/langcli |
| `quick_start-agent_integrations-nanobot.md` | 接入 nanobot | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/nanobot |
| `quick_start-agent_integrations-oh_my_pi.md` | 在 Oh My Pi 中使用 DeepSeek | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/oh_my_pi |
| `quick_start-agent_integrations-openclaw.md` | 接入 OpenClaw | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/openclaw |
| `quick_start-agent_integrations-opencode.md` | 接入 OpenCode | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/opencode |
| `quick_start-agent_integrations-pi_mono.md` | 接入 Pi | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/pi_mono |
| `quick_start-agent_integrations-reasonix.md` | 接入 Reasonix | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/reasonix |
| `quick_start-agent_integrations-workbuddy.md` | 接入 WorkBuddy/CodeBuddy | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy |

### News（发布公告，倒序）

| 本地文件 | 页面标题 | 源 URL |
|---|---|---|
| `news-news260424.md` | DeepSeek-V4 预览版：迈入百万上下文普惠时代 | https://api-docs.deepseek.com/zh-cn/news/news260424 |
| `news-news251201.md` | DeepSeek V3.2 正式版：强化 Agent 能力，融入思考推理 | https://api-docs.deepseek.com/zh-cn/news/news251201 |
| `news-news250929.md` | DeepSeek-V3.2-Exp 发布，训练推理提效，API 同步降价 | https://api-docs.deepseek.com/zh-cn/news/news250929 |
| `news-news250922.md` | DeepSeek-V3.1 版本更新 | https://api-docs.deepseek.com/zh-cn/news/news250922 |
| `news-news250821.md` | DeepSeek-V3.1 发布 | https://api-docs.deepseek.com/zh-cn/news/news250821 |
| `news-news250528.md` | DeepSeek-R1 更新，思考更深，推理更强 | https://api-docs.deepseek.com/zh-cn/news/news250528 |
| `news-news250325.md` | DeepSeek-V3 模型更新，各项能力全面进阶 | https://api-docs.deepseek.com/zh-cn/news/news250325 |
| `news-news250120.md` | DeepSeek API Docs | https://api-docs.deepseek.com/zh-cn/news/news250120 |
| `news-news250115.md` | DeepSeek APP | https://api-docs.deepseek.com/zh-cn/news/news250115 |
| `news-news1226.md` | DeepSeek-V3 正式发布 | https://api-docs.deepseek.com/zh-cn/news/news1226 |
| `news-news1210.md` | DeepSeek V2 系列收官，联网搜索上线官网 | https://api-docs.deepseek.com/zh-cn/news/news1210 |
| `news-news1120.md` | DeepSeek推理模型预览版上线，解密o1推理过程 | https://api-docs.deepseek.com/zh-cn/news/news1120 |
| `news-news0905.md` | DeepSeek-V2.5：融合通用与代码能力的全新开源模型 | https://api-docs.deepseek.com/zh-cn/news/news0905 |
| `news-news0802.md` | DeepSeek API 创新采用硬盘缓存，价格再降一个数量级 | https://api-docs.deepseek.com/zh-cn/news/news0802 |
| `news-news0725.md` | DeepSeek API 升级，支持续写、FIM、Function Calling、JSON Output | https://api-docs.deepseek.com/zh-cn/news/news0725 |

共 51 页。

> 陈旧性提醒：本镜像为 2026-07-24 快照；型号/价格/限流以源站最新为准，重大接入决策前建议重拉对应页面。
