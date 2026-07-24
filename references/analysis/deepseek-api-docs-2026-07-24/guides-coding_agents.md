Title: 接入 Agent 工具 | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/guides/coding_agents

Markdown Content:
本文介绍如何将 DeepSeek 模型接入到 Claude Code、OpenCode、OpenClaw 等主流 AI 工具中。

## 接入 Claude Code[​](https://api-docs.deepseek.com/zh-cn/guides/coding_agents#%E6%8E%A5%E5%85%A5-claude-code "接入 Claude Code的直接链接")

Claude Code 是一个运行在终端内的 AI 编程助手。

#### 1. 安装 Claude Code[​](https://api-docs.deepseek.com/zh-cn/guides/coding_agents#1-%E5%AE%89%E8%A3%85-claude-code "1. 安装 Claude Code的直接链接")

*   安装 [Node.js](https://nodejs.org/zh-cn/download/) 18+。
*   Windows 用户需安装 [Git for Windows](https://git-scm.com/download/win)。
*   在命令行界面，执行以下命令安装 Claude Code：

`npm install -g @anthropic-ai/claude-code`

*   安装结束后，执行以下命令，若显示版本号则安装成功：

`claude --version`

#### 2. 配置环境变量[​](https://api-docs.deepseek.com/zh-cn/guides/coding_agents#2-%E9%85%8D%E7%BD%AE%E7%8E%AF%E5%A2%83%E5%8F%98%E9%87%8F "2. 配置环境变量的直接链接")

Linux / Mac 用户执行以下命令配置 [DeepSeek Anthropic API](https://api.deepseek.com/anthropic) 环境变量，其中 API Key 在 [DeepSeek Platform](https://platform.deepseek.com/api_keys) 获取：

`export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropicexport ANTHROPIC_AUTH_TOKEN=<你的 DeepSeek API Key>export ANTHROPIC_MODEL=deepseek-v4-pro[1m]export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro[1m]export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro[1m]export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flashexport CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flashexport CLAUDE_CODE_EFFORT_LEVEL=max`

Windows 用户执行：

`$env:ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"$env:ANTHROPIC_AUTH_TOKEN="<你的 DeepSeek API Key>"$env:ANTHROPIC_MODEL="deepseek-v4-pro[1m]"$env:ANTHROPIC_DEFAULT_OPUS_MODEL="deepseek-v4-pro[1m]"$env:ANTHROPIC_DEFAULT_SONNET_MODEL="deepseek-v4-pro[1m]"$env:ANTHROPIC_DEFAULT_HAIKU_MODEL="deepseek-v4-flash"$env:CLAUDE_CODE_SUBAGENT_MODEL="deepseek-v4-flash"$env:CLAUDE_CODE_EFFORT_LEVEL="max"`

#### 3. 进入项目目录，执行 `claude` 命令，即可开始使用了。[​](https://api-docs.deepseek.com/zh-cn/guides/coding_agents#3-%E8%BF%9B%E5%85%A5%E9%A1%B9%E7%9B%AE%E7%9B%AE%E5%BD%95%E6%89%A7%E8%A1%8C-claude-%E5%91%BD%E4%BB%A4%E5%8D%B3%E5%8F%AF%E5%BC%80%E5%A7%8B%E4%BD%BF%E7%94%A8%E4%BA%86 "3-进入项目目录执行-claude-命令即可开始使用了的直接链接")

`cd /path/to/my-projectclaude`

![Image 1](https://cdn.deepseek.com/api-docs/cc_example.png)

* * *

## 接入 OpenCode[​](https://api-docs.deepseek.com/zh-cn/guides/coding_agents#%E6%8E%A5%E5%85%A5-opencode "接入 OpenCode的直接链接")

OpenCode 是一个开源 AI 编程助手，提供终端、网页等运行形式。

#### 1. 安装 OpenCode[​](https://api-docs.deepseek.com/zh-cn/guides/coding_agents#1-%E5%AE%89%E8%A3%85-opencode "1. 安装 OpenCode的直接链接")

前往官方下载页面安装或升级：[OpenCode 下载](https://opencode.ai/zh/download)

为避免兼容性问题，强烈建议您升级为 OpenCode 为最新版本，确保版本号 >= v1.14.24。

#### 2. 运行与配置[​](https://api-docs.deepseek.com/zh-cn/guides/coding_agents#2-%E8%BF%90%E8%A1%8C%E4%B8%8E%E9%85%8D%E7%BD%AE "2. 运行与配置的直接链接")

*   执行 `opencode` 命令

*   输入框中输入 `/connect`，然后输入 `deepseek` 并选择供应商

*   填入 [DeepSeek API Key](https://platform.deepseek.com/api_keys)

*   选择 DeepSeek-V4-Pro 模型

* * *

## 接入 OpenClaw[​](https://api-docs.deepseek.com/zh-cn/guides/coding_agents#%E6%8E%A5%E5%85%A5-openclaw "接入 OpenClaw的直接链接")

OpenClaw 是一个开源的个人 AI 助手，可以接入飞书、微信等常用聊天工具，可以通过 Skill 扩展能力。

#### 1. 安装 OpenClaw[​](https://api-docs.deepseek.com/zh-cn/guides/coding_agents#1-%E5%AE%89%E8%A3%85-openclaw "1. 安装 OpenClaw的直接链接")

Linux / Mac 用户执行以下命令，从 [OpenClaw 安装脚本](https://openclaw.ai/install.ps1) 安装：

`curl -fsSL https://openclaw.ai/install.sh | bash`

Windows 用户执行以下命令，从 [OpenClaw 安装脚本](https://openclaw.ai/install.ps1) 安装：

`iwr -useb https://openclaw.ai/install.ps1 | iex`

#### 2. 配置 OpenClaw 中的默认模型[​](https://api-docs.deepseek.com/zh-cn/guides/coding_agents#2-%E9%85%8D%E7%BD%AE-openclaw-%E4%B8%AD%E7%9A%84%E9%BB%98%E8%AE%A4%E6%A8%A1%E5%9E%8B "2. 配置 OpenClaw 中的默认模型的直接链接")

首次安装完成后，会自动进入 setup（配置）阶段；已经安装过 OpenClaw 的用户可以通过 `openclaw onboard --install-daemon` 命令进入配置阶段。

*   遇到提示：`I understand this is personal-by-default and shared/multi-user use requires lock-down. Continue?` 请选择 **Yes**。
*   遇到提示：`Setup mode` 推荐选择 **QuickStart**。
*   遇到提示：`Model/auth provider` 请选择 **DeepSeek**。
*   遇到提示：`Enter DeepSeek API key` 请填入你的 [DeepSeek API Key](https://platform.deepseek.com/api_keys)。
*   遇到提示：`Default model` 请将光标指向 **Enter model**，填写模型名称（`deepseek-v4-pro` 或 `deepseek-v4-flash`）。
*   后续的其余配置（消息频道、Skill 等）请根据需求配置，新手可以先选择 **Skip for now**。

#### 3. 开始使用[​](https://api-docs.deepseek.com/zh-cn/guides/coding_agents#3-%E5%BC%80%E5%A7%8B%E4%BD%BF%E7%94%A8 "3. 开始使用的直接链接")

打开 Web UI，在 Chat 页面进行交互：

`openclaw dashboard`

在终端中打开 TUI：

`openclaw tui`

在终端中与 Openclaw 对话：

`openclaw terminal`
