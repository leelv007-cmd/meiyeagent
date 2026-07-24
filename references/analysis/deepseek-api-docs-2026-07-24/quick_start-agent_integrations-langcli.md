Title: 接入 Langcli | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/langcli

Published Time: Mon, 13 Jul 2026 03:34:27 GMT

Markdown Content:
提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

[Langcli](https://langcli.com/) 是一个 AI 编程助手，支持 CLI 和 Zed ACP Agent。

#### 1. 安装[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/langcli#1-%E5%AE%89%E8%A3%85 "1. 安装的直接链接")

##### 快速安装 (推荐)[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/langcli#%E5%BF%AB%E9%80%9F%E5%AE%89%E8%A3%85-%E6%8E%A8%E8%8D%90 "快速安装 (推荐)的直接链接")

macOS、Linux 和 WSL 用户执行以下命令安装 Langcli：

`bash -c "$(curl -fsSL https://assets.langcli.com/installation/install-langcli.sh)"`

Windows 用户执行以下命令安装(请以Administrator身份运行Power shell)：

`cmd /c "curl -fsSL -o %TEMP%\install-langcli.bat https://assets.langcli.com/installation/install-langcli.bat && %TEMP%\install-langcli.bat"`

> **注意：建议安装后重启终端，以确保环境变量生效。

##### 手动安装[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/langcli#%E6%89%8B%E5%8A%A8%E5%AE%89%E8%A3%85 "手动安装的直接链接")

请确保你已安装 Node.js 20 或更高版本。如果还没安装，请到[nodejs.org](https://nodejs.org/en/download)下载和安装.

`npm i -g langcli-com`

#### 2. 快速开始[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/langcli#2-%E5%BF%AB%E9%80%9F%E5%BC%80%E5%A7%8B "2. 快速开始的直接链接")

##### API Key 准备[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/langcli#api-key-%E5%87%86%E5%A4%87 "API Key 准备的直接链接")

打开[LangRouter官网](https://langrouter.ai/)，注册一个账号，保存api-key。备注：可免费体验的。

##### 运行[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/langcli#%E8%BF%90%E8%A1%8C "运行的直接链接")

`# 启动Langclilangcli# 之后在回话中输入:hi`
