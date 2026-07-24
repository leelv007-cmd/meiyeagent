Title: 接入 Claude Code | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code

Published Time: Mon, 13 Jul 2026 03:34:34 GMT

Markdown Content:
提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

Claude Code 是一个运行在终端内的 AI 编程助手。

## 从现有安装中迁移到 DeepSeek[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code#%E4%BB%8E%E7%8E%B0%E6%9C%89%E5%AE%89%E8%A3%85%E4%B8%AD%E8%BF%81%E7%A7%BB%E5%88%B0-deepseek "从现有安装中迁移到 DeepSeek的直接链接")

如果你已经安装了 Claude Code，只需修改以下环境变量，其中 API Key 在 [DeepSeek Platform](https://platform.deepseek.com/api_keys) 获取。

Linux / Mac 用户，直接在终端中执行：

`export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropicexport ANTHROPIC_AUTH_TOKEN=<你的 DeepSeek API Key>export ANTHROPIC_MODEL=deepseek-v4-pro[1m]export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro[1m]export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro[1m]export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flashexport CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flashexport CLAUDE_CODE_EFFORT_LEVEL=max`

Windows 用户，在 Powershell 中执行：

`$env:ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"$env:ANTHROPIC_AUTH_TOKEN="<你的 DeepSeek API Key>"$env:ANTHROPIC_MODEL="deepseek-v4-pro[1m]"$env:ANTHROPIC_DEFAULT_OPUS_MODEL="deepseek-v4-pro[1m]"$env:ANTHROPIC_DEFAULT_SONNET_MODEL="deepseek-v4-pro[1m]"$env:ANTHROPIC_DEFAULT_HAIKU_MODEL="deepseek-v4-flash"$env:CLAUDE_CODE_SUBAGENT_MODEL="deepseek-v4-flash"$env:CLAUDE_CODE_EFFORT_LEVEL="max"`

配置完成后，执行（其中 `/path/to/my-project` 替换为你的项目路径）：

`cd /path/to/my-projectclaude`

## 从零安装 Claude Code[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code#%E4%BB%8E%E9%9B%B6%E5%AE%89%E8%A3%85-claude-code "从零安装 Claude Code的直接链接")

#### 1. 安装 Claude Code[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code#1-%E5%AE%89%E8%A3%85-claude-code "1. 安装 Claude Code的直接链接")

*   安装 [Node.js](https://nodejs.org/zh-cn/download/) 18+。
*   Windows 用户需安装 [Git for Windows](https://git-scm.com/download/win)。
*   在命令行界面，执行以下命令安装 Claude Code：

`npm install -g @anthropic-ai/claude-code`

*   安装结束后，执行以下命令，若显示版本号则安装成功：

`claude --version`

#### 2. 配置环境变量[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code#2-%E9%85%8D%E7%BD%AE%E7%8E%AF%E5%A2%83%E5%8F%98%E9%87%8F "2. 配置环境变量的直接链接")

Linux / Mac 用户执行以下命令配置 [DeepSeek Anthropic API](https://api.deepseek.com/anthropic) 环境变量，其中 API Key 在 [DeepSeek Platform](https://platform.deepseek.com/api_keys) 获取：

`export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropicexport ANTHROPIC_AUTH_TOKEN=<你的 DeepSeek API Key>export ANTHROPIC_MODEL=deepseek-v4-pro[1m]export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro[1m]export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro[1m]export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flashexport CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flashexport CLAUDE_CODE_EFFORT_LEVEL=max`

Windows 用户执行：

`$env:ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"$env:ANTHROPIC_AUTH_TOKEN="<你的 DeepSeek API Key>"$env:ANTHROPIC_MODEL="deepseek-v4-pro[1m]"$env:ANTHROPIC_DEFAULT_OPUS_MODEL="deepseek-v4-pro[1m]"$env:ANTHROPIC_DEFAULT_SONNET_MODEL="deepseek-v4-pro[1m]"$env:ANTHROPIC_DEFAULT_HAIKU_MODEL="deepseek-v4-flash"$env:CLAUDE_CODE_SUBAGENT_MODEL="deepseek-v4-flash"$env:CLAUDE_CODE_EFFORT_LEVEL="max"`

#### 3. 进入项目目录，执行 `claude` 命令，即可开始使用了。[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code#3-%E8%BF%9B%E5%85%A5%E9%A1%B9%E7%9B%AE%E7%9B%AE%E5%BD%95%E6%89%A7%E8%A1%8C-claude-%E5%91%BD%E4%BB%A4%E5%8D%B3%E5%8F%AF%E5%BC%80%E5%A7%8B%E4%BD%BF%E7%94%A8%E4%BA%86 "3-进入项目目录执行-claude-命令即可开始使用了的直接链接")

`cd /path/to/my-projectclaude`

![Image 1](https://cdn.deepseek.com/api-docs/cc_example.png)

* * *

## 使用 Claude Code 的 Web Search 功能[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code#%E4%BD%BF%E7%94%A8-claude-code-%E7%9A%84-web-search-%E5%8A%9F%E8%83%BD "使用 Claude Code 的 Web Search 功能的直接链接")

DeepSeek API 原生支持 Claude Code 中的 Web Search 功能。在使用 Claude Code 的过程中，如果模型判断您的问题需要通过搜索功能才能满足，模型会调用 Web Search 工具，并通过 DeepSeek 提供的 API 进行搜索。因为调用 Web Search 工具会产生额外的大模型 API 请求来对获取到的搜索内容进行总结，因此会产生额外的模型 Token 费用。

下图展示了在 Claude Code 中触发 Web Search 功能的示例，用户的提问（Help me to search for best Rust tutorials）触发了 Web Search 工具的调用：

![Image 2](https://api-docs.deepseek.com/zh-cn/img/cc_web_search_example.png)

* * *

## 使用 Claude Code 或者 Claude Desktop APP 时的模型映射[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code#%E4%BD%BF%E7%94%A8-claude-code-%E6%88%96%E8%80%85-claude-desktop-app-%E6%97%B6%E7%9A%84%E6%A8%A1%E5%9E%8B%E6%98%A0%E5%B0%84 "使用 Claude Code 或者 Claude Desktop APP 时的模型映射的直接链接")

您在使用 Claude Code 或者 Claude Desktop APP 时，我们会对您传入的 claude 模型名进行映射：

*   claude-opus 开头的模型，会映射到 deepseek-v4-pro
*   claude-haiku、claude-sonnet 开头的模型，会映射到 deepseek-v4-flash

通过这样的映射，您在使用新版 Claude Desktop APP 的 developer 模式时，可以绕过 APP 对模型名的限制，只需改动 base_url 和 api_key，即可在其中接入 DeepSeek 模型。
