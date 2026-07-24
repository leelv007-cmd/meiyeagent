Title: 接入 Kilo Code | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/kilo_code

Markdown Content:
提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

Kilo Code 是一个 AI 编程助手，支持 CLI 和编辑器扩展。

#### 1. 安装 Kilo Code CLI[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/kilo_code#1-%E5%AE%89%E8%A3%85-kilo-code-cli "1. 安装 Kilo Code CLI的直接链接")

*   安装 [Node.js](https://nodejs.org/zh-cn/download/)。
*   在命令行界面，执行以下命令安装 Kilo Code CLI：

`npm install -g @kilocode/cli`

*   安装结束后，执行以下命令，若显示版本号则安装成功：

`kilo --version`

#### 2. 运行 Kilo Code[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/kilo_code#2-%E8%BF%90%E8%A1%8C-kilo-code "2. 运行 Kilo Code的直接链接")

进入项目目录并执行 `kilo`：

`cd /path/to/my-projectkilo`

#### 3. 连接 DeepSeek 供应商[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/kilo_code#3-%E8%BF%9E%E6%8E%A5-deepseek-%E4%BE%9B%E5%BA%94%E5%95%86 "3. 连接 DeepSeek 供应商的直接链接")

*   在命令栏输入 `/connect`，打开 **Connect Provider** 面板。
*   搜索 `deepseek`，选择 **DeepSeek**，然后填入你的 [DeepSeek API Key](https://platform.deepseek.com/api_keys)。

#### 4. 选择 DeepSeek 模型[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/kilo_code#4-%E9%80%89%E6%8B%A9-deepseek-%E6%A8%A1%E5%9E%8B "4. 选择 DeepSeek 模型的直接链接")

*   输入 `/models` 打开模型选择器。
*   选择一个可用的 DeepSeek 模型：
    *   DeepSeek Chat
    *   DeepSeek Reasoner
    *   DeepSeek V4 Flash
    *   DeepSeek V4 Pro
