Title: 接入 WorkBuddy/CodeBuddy | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy

Markdown Content:
[跳到主要内容](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#__docusaurus_skipToContent_fallback)

[![Image 1: DeepSeek API 文档 Logo](https://cdn.deepseek.com/platform/favicon.png) **DeepSeek API 文档**](https://api-docs.deepseek.com/zh-cn/)

[中文（中国）](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#)
*   [English](https://api-docs.deepseek.com/quick_start/agent_integrations/workbuddy)
*   [中文（中国）](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy)

[DeepSeek Platform](https://platform.deepseek.com/)

*   [快速开始](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#) 
    *   [首次调用 API](https://api-docs.deepseek.com/zh-cn/)
    *   [模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
    *   [Token 用量计算](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage)
    *   [限速与隔离](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit)
    *   [错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes)
    *   [接入 Agent 工具](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#) 
        *   [Claude Code](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code)
        *   [GitHub Copilot](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/github_copilot)
        *   [GitHub Copilot CLI](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/copilot_cli)
        *   [Kilo Code](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/kilo_code)
        *   [WorkBuddy/CodeBuddy](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy)
        *   [OpenCode](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/opencode)
        *   [Oh My Pi](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/oh_my_pi)
        *   [OpenClaw](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/openclaw)
        *   [AstrBot](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/astrbot)
        *   [Deep Code](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/deepcode)
        *   [Hermes](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/hermes)
        *   [nanobot](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/nanobot)
        *   [Crush](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush)
        *   [Pi](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/pi_mono)
        *   [Reasonix](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/reasonix)
        *   [Langcli](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/langcli)
        *   [贡献你的 Agent 接入](https://github.com/deepseek-ai/awesome-deepseek-agent/tree/main)

*   [API 指南](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#) 
    *   [思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)
    *   [多轮对话](https://api-docs.deepseek.com/zh-cn/guides/multi_round_chat)
    *   [对话前缀续写（Beta）](https://api-docs.deepseek.com/zh-cn/guides/chat_prefix_completion)
    *   [FIM 补全（Beta）](https://api-docs.deepseek.com/zh-cn/guides/fim_completion)
    *   [JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode)
    *   [Tool Calls](https://api-docs.deepseek.com/zh-cn/guides/tool_calls)
    *   [上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache)
    *   [Anthropic API](https://api-docs.deepseek.com/zh-cn/guides/anthropic_api)

*   [API 文档](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#) 
*   [新闻](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#) 
*   [其它资源](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#) 
*   [常见问题](https://static.deepseek.com/faq/index.html?lang=zh#/category/4)
*   [更新日志](https://api-docs.deepseek.com/zh-cn/updates)

*   [](https://api-docs.deepseek.com/zh-cn/)
*   快速开始
*   接入 Agent 工具
*   WorkBuddy/CodeBuddy

本页总览

# 接入 WorkBuddy/CodeBuddy

提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

WorkBuddy/CodeBuddy 是 AI Agent 与编程助手工具。它支持通过本地模型配置文件添加自定义模型，可以使用 OpenAI 兼容的 Chat Completions API 接入 DeepSeek V4。

#### 1. 安装 WorkBuddy/CodeBuddy[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#1-%E5%AE%89%E8%A3%85-workbuddycodebuddy "1. 安装 WorkBuddy/CodeBuddy的直接链接")

*   安装并登录 WorkBuddy/CodeBuddy。
*   至少打开一次项目目录，让应用创建本地配置目录。
*   前往 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 获取 API Key。

#### 2. 配置本地模型[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#2-%E9%85%8D%E7%BD%AE%E6%9C%AC%E5%9C%B0%E6%A8%A1%E5%9E%8B "2. 配置本地模型的直接链接")

创建或编辑用户级配置文件：

`C:\Users\<你的用户名>\.codebuddy\models.json`

如果只想让配置对某个项目生效，也可以创建项目级配置文件：

`<你的项目>\.codebuddy\models.json`

先将 DeepSeek API Key 设置为环境变量：

`setx DEEPSEEK_API_KEY "<your DeepSeek API Key>"`

然后写入以下配置：

`{  "models": [    {      "id": "deepseek-v4-pro",      "name": "DeepSeek V4 Pro",      "vendor": "DeepSeek",      "url": "https://api.deepseek.com/v1/chat/completions",      "apiKey": "${DEEPSEEK_API_KEY}",      "maxInputTokens": 128000,      "maxOutputTokens": 8192,      "supportsToolCall": true,      "supportsImages": false,      "relatedModels": {        "lite": "deepseek-v4-flash",        "reasoning": "deepseek-v4-pro"      }    },    {      "id": "deepseek-v4-flash",      "name": "DeepSeek V4 Flash",      "vendor": "DeepSeek",      "url": "https://api.deepseek.com/v1/chat/completions",      "apiKey": "${DEEPSEEK_API_KEY}",      "maxInputTokens": 128000,      "maxOutputTokens": 8192,      "supportsToolCall": true,      "supportsImages": false    }  ],  "availableModels": [    "deepseek-v4-pro",    "deepseek-v4-flash"  ]}`

请将 `models.json` 保存为 UTF-8 无 BOM。部分桌面版本在读取带 UTF-8 BOM 文件头的 JSON 时，可能会读取本地模型配置失败。

#### 3. 重启并选择模型[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#3-%E9%87%8D%E5%90%AF%E5%B9%B6%E9%80%89%E6%8B%A9%E6%A8%A1%E5%9E%8B "3. 重启并选择模型的直接链接")

完全退出 WorkBuddy/CodeBuddy 后重新打开。

在模型选择器中选择：

`DeepSeek V4 ProDeepSeek V4 Flash`

#### 4. 可选：验证 API Key[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#4-%E5%8F%AF%E9%80%89%E9%AA%8C%E8%AF%81-api-key "4. 可选：验证 API Key的直接链接")

Windows 用户可以在 PowerShell 中验证 API Key：

`$env:DEEPSEEK_API_KEY="<your DeepSeek API Key>"curl https://api.deepseek.com/v1/chat/completions `  -H "Content-Type: application/json" `  -H "Authorization: Bearer $env:DEEPSEEK_API_KEY" `  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"hi"}],"stream":false}'`

如果请求成功，说明 API Key 和模型名都可用。

#### 常见问题[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy#%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98 "常见问题的直接链接")

*   `Authentication Fails` 或 `401`：检查 `apiKey` 是否为真实 DeepSeek API Key。不要把接口 URL 填到 API Key 字段。
*   `未找到模型` 或 `404`：检查模型 id 是否严格写成 `deepseek-v4-pro` 或 `deepseek-v4-flash`。
*   `读取本地模型配置失败`：检查 `models.json` 是否是合法 JSON，并保存为 UTF-8 无 BOM。
*   模型选择器中不显示：完全重启 WorkBuddy/CodeBuddy，并确认文件放在 `.codebuddy\models.json`。
*   UI 中直接显示 `${DEEPSEEK_API_KEY}`：请从已设置 `DEEPSEEK_API_KEY` 的终端中重启 WorkBuddy/CodeBuddy。如果桌面端仍不展开环境变量，可以在 UI 或本地 `models.json` 中填入真实 API Key。

[上一页 Kilo Code](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/kilo_code)[下一页 OpenCode](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/opencode)

微信公众号

*   ![Image 2: WeChat QRcode](https://cdn.deepseek.com/official_account.jpg)

社区

*   [邮箱](mailto:api-service@deepseek.com)
*   [Discord](https://discord.gg/Tc7c45Zzu5)
*   [Twitter](https://twitter.com/deepseek_ai)

更多

*   [GitHub](https://github.com/deepseek-ai)

Copyright © 2026 DeepSeek, Inc.
