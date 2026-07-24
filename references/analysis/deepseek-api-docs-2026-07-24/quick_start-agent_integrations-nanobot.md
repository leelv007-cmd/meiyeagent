Title: 接入 nanobot | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/nanobot

Markdown Content:
提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

nanobot 是一个轻量级AI智能体，支持接入常用聊天工具。

#### 1. 安装 nanobot[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/nanobot#1-%E5%AE%89%E8%A3%85-nanobot "1. 安装 nanobot的直接链接")

*   安装 [uv](https://github.com/astral-sh/uv)
*   执行下面的命令安装 nanobot:

`uv tool install nanobot-ai`

*   注意：在 Windows 操作系统下，请将用户根目录下的 `.local/bin` 目录添加到环境变量中：

`$env:PATH = "$env:USERPROFILE\.local\bin;$env:PATH"`

*   或者通过 `uv` 更新终端：

`uv tool update-shell`

*   完成安装后，执行下面的命令，如果显示版本号则安装成功:

`nanobot --version`

#### 2. 配置 nanobot 的配置文件[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/nanobot#2-%E9%85%8D%E7%BD%AE-nanobot-%E7%9A%84%E9%85%8D%E7%BD%AE%E6%96%87%E4%BB%B6 "2. 配置 nanobot 的配置文件的直接链接")

运行下面的命令初始化 nanobot 配置文件：

`nanobot onboard`

不同操作系统生成的配置文件路径如下：

*   **Windows**: `$env:USERPROFILE\.nanobot\config.json`
*   **Linux / MacOS**: `~/.nanobot/config.json`

编辑配置文件 `config.json`，修改下面的配置项:

`{    "agents": {        "defaults": {            "model": "deepseek-v4-pro",            "provider": "deepseek",        }    },    "providers": {        "deepseek": {            "apiKey": "<你的 DeepSeek API Key>",            "apiBase": "https://api.deepseek.com/v1",        },    },}`

#### 3. 开始使用[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/nanobot#3-%E5%BC%80%E5%A7%8B%E4%BD%BF%E7%94%A8 "3. 开始使用的直接链接")

在终端中运行：

`nanobot agent`
