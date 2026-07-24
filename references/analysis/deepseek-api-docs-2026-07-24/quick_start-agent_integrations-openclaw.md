Title: 接入 OpenClaw | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/openclaw

Markdown Content:
提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

OpenClaw 是一个开源的个人 AI 助手，可以接入飞书、微信等常用聊天工具，可以通过 Skill 扩展能力。

## 从现有安装中迁移到 DeepSeek[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/openclaw#%E4%BB%8E%E7%8E%B0%E6%9C%89%E5%AE%89%E8%A3%85%E4%B8%AD%E8%BF%81%E7%A7%BB%E5%88%B0-deepseek "从现有安装中迁移到 DeepSeek的直接链接")

如果你已经安装了 OpenClaw，运行以下命令重新进入配置阶段，切换到 DeepSeek 提供商：

`openclaw onboard --install-daemon`

然后按照提示操作：

*   遇到提示：`I understand this is personal-by-default and shared/multi-user use requires lock-down. Continue?` 请选择 **Yes**。
*   遇到提示：`Setup mode` 推荐选择 **QuickStart**。
*   遇到提示：`Model/auth provider` 请选择 **DeepSeek**。
*   遇到提示：`Enter DeepSeek API key` 请填入你的 [DeepSeek API Key](https://platform.deepseek.com/api_keys)。
*   遇到提示：`Default model` 请将光标指向 **Enter model**，填写模型名称（`deepseek-v4-pro` 或 `deepseek-v4-flash`）。
*   后续的其余配置（消息频道、Skill 等）请根据需求配置，新手可以先选择 **Skip for now**。

## 从零安装 OpenClaw[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/openclaw#%E4%BB%8E%E9%9B%B6%E5%AE%89%E8%A3%85-openclaw "从零安装 OpenClaw的直接链接")

#### 1. 安装 OpenClaw[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/openclaw#1-%E5%AE%89%E8%A3%85-openclaw "1. 安装 OpenClaw的直接链接")

Linux / Mac 用户执行以下命令，从 [OpenClaw 安装脚本](https://openclaw.ai/install.ps1) 安装：

`curl -fsSL https://openclaw.ai/install.sh | bash`

Windows 用户执行以下命令，从 [OpenClaw 安装脚本](https://openclaw.ai/install.ps1) 安装：

`iwr -useb https://openclaw.ai/install.ps1 | iex`

#### 2. 配置 OpenClaw 中的默认模型[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/openclaw#2-%E9%85%8D%E7%BD%AE-openclaw-%E4%B8%AD%E7%9A%84%E9%BB%98%E8%AE%A4%E6%A8%A1%E5%9E%8B "2. 配置 OpenClaw 中的默认模型的直接链接")

首次安装完成后，会自动进入 setup（配置）阶段；已经安装过 OpenClaw 的用户可以通过 `openclaw onboard --install-daemon` 命令进入配置阶段。

*   遇到提示：`I understand this is personal-by-default and shared/multi-user use requires lock-down. Continue?` 请选择 **Yes**。
*   遇到提示：`Setup mode` 推荐选择 **QuickStart**。
*   遇到提示：`Model/auth provider` 请选择 **DeepSeek**。
*   遇到提示：`Enter DeepSeek API key` 请填入你的 [DeepSeek API Key](https://platform.deepseek.com/api_keys)。
*   遇到提示：`Default model` 请将光标指向 **Enter model**，填写模型名称（`deepseek-v4-pro` 或 `deepseek-v4-flash`）。
*   后续的其余配置（消息频道、Skill 等）请根据需求配置，新手可以先选择 **Skip for now**。

#### 3. 开始使用[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/openclaw#3-%E5%BC%80%E5%A7%8B%E4%BD%BF%E7%94%A8 "3. 开始使用的直接链接")

打开 Web UI，在 Chat 页面进行交互：

`openclaw dashboard`

在终端中打开 TUI：

`openclaw tui`

在终端中与 Openclaw 对话：

`openclaw terminal`
