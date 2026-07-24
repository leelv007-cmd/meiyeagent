Title: 接入 Crush | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush

Markdown Content:
[跳到主要内容](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush#__docusaurus_skipToContent_fallback)

[![Image 1: DeepSeek API 文档 Logo](https://cdn.deepseek.com/platform/favicon.png) **DeepSeek API 文档**](https://api-docs.deepseek.com/zh-cn/)

[中文（中国）](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush#)
*   [English](https://api-docs.deepseek.com/quick_start/agent_integrations/crush)
*   [中文（中国）](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush)

[DeepSeek Platform](https://platform.deepseek.com/)

*   [快速开始](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush#) 
    *   [首次调用 API](https://api-docs.deepseek.com/zh-cn/)
    *   [模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
    *   [Token 用量计算](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage)
    *   [限速与隔离](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit)
    *   [错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes)
    *   [接入 Agent 工具](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush#) 
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

*   [API 指南](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush#) 
    *   [思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)
    *   [多轮对话](https://api-docs.deepseek.com/zh-cn/guides/multi_round_chat)
    *   [对话前缀续写（Beta）](https://api-docs.deepseek.com/zh-cn/guides/chat_prefix_completion)
    *   [FIM 补全（Beta）](https://api-docs.deepseek.com/zh-cn/guides/fim_completion)
    *   [JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode)
    *   [Tool Calls](https://api-docs.deepseek.com/zh-cn/guides/tool_calls)
    *   [上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache)
    *   [Anthropic API](https://api-docs.deepseek.com/zh-cn/guides/anthropic_api)

*   [API 文档](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush#) 
*   [新闻](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush#) 
*   [其它资源](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush#) 
*   [常见问题](https://static.deepseek.com/faq/index.html?lang=zh#/category/4)
*   [更新日志](https://api-docs.deepseek.com/zh-cn/updates)

*   [](https://api-docs.deepseek.com/zh-cn/)
*   快速开始
*   接入 Agent 工具
*   Crush

本页总览

# 接入 Crush

提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

Crush 是由 Charm 开发的华丽开源 AI 编程 Agent，运行在终端中。支持多模型切换、LSP 集成、MCP 服务器和代理式编码工作流。

#### 1. 安装 Crush[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush#1-%E5%AE%89%E8%A3%85-crush "1. 安装 Crush的直接链接")

*   安装 [Node.js](https://nodejs.org/zh-cn/download/)。
*   在命令行界面，执行以下命令安装 Crush：

`npm install -g @charmland/crush`

*   安装结束后，执行以下命令，若显示版本号则安装成功：

`crush --version`

> **注意：** macOS 用户也可以通过 Homebrew 安装：`brew install charmbracelet/tap/crush`。

#### 2. 配置 DeepSeek 供应商[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush#2-%E9%85%8D%E7%BD%AE-deepseek-%E4%BE%9B%E5%BA%94%E5%95%86 "2. 配置 DeepSeek 供应商的直接链接")

Crush 支持通过 OpenAI 兼容 API 添加自定义供应商。在配置文件中添加 DeepSeek：

*   **Linux / macOS**：`~/.config/crush/crush.json`
*   **Windows**：`%USERPROFILE%\.config\crush\crush.json`

`{  "$schema": "https://charm.land/crush.json",  "providers": {    "deepseek": {      "type": "openai-compat",      "base_url": "https://api.deepseek.com",      "api_key": "$DEEPSEEK_API_KEY",      "models": [        {          "id": "deepseek-v4-pro",          "name": "DeepSeek-V4-Pro",          "context_window": 1048576,          "default_max_tokens": 32768,          "can_reason": true        },        {          "id": "deepseek-v4-flash",          "name": "DeepSeek-V4-Flash",          "context_window": 1048576,          "default_max_tokens": 32768,          "can_reason": true        }      ]    }  }}`

其中 API Key 在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 获取。

设置环境变量：

Linux / Mac 用户：

`export DEEPSEEK_API_KEY="<你的 DeepSeek API Key>"`

Windows 用户：

`$env:DEEPSEEK_API_KEY="<你的 DeepSeek API Key>"`

#### 3. 运行并选择模型[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/crush#3-%E8%BF%90%E8%A1%8C%E5%B9%B6%E9%80%89%E6%8B%A9%E6%A8%A1%E5%9E%8B "3. 运行并选择模型的直接链接")

*   进入项目目录并执行 `crush` 命令：

`cd /path/to/my-projectcrush`

*   按 `Ctrl+L`（或输入 `/model`）打开模型切换器。
*   选择 **DeepSeek** 供应商，然后选择 `DeepSeek-V4-Pro` 或 `DeepSeek-V4-Flash`。

[上一页 nanobot](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/nanobot)[下一页 Pi](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/pi_mono)

微信公众号

*   ![Image 2: WeChat QRcode](https://cdn.deepseek.com/official_account.jpg)

社区

*   [邮箱](mailto:api-service@deepseek.com)
*   [Discord](https://discord.gg/Tc7c45Zzu5)
*   [Twitter](https://twitter.com/deepseek_ai)

更多

*   [GitHub](https://github.com/deepseek-ai)

Copyright © 2026 DeepSeek, Inc.
