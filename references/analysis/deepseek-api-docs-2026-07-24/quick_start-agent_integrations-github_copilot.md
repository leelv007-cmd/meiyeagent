Title: 接入 GitHub Copilot | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/github_copilot

Markdown Content:
提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

**DeepSeek V4 for Copilot Chat** 是一个 VS Code 插件，将 DeepSeek V4 Pro 和 Flash 直接添加到 GitHub Copilot 的模型选择器中。你仍可使用 Copilot 的 Agent 模式、工具调用、Skills 和 MCP — 全部由 DeepSeek 驱动。

#### 1. 安装插件[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/github_copilot#1-%E5%AE%89%E8%A3%85%E6%8F%92%E4%BB%B6 "1. 安装插件的直接链接")

*   安装 [VS Code](https://code.visualstudio.com/) 1.116 或更高版本。
*   确保已有 GitHub Copilot 订阅（Free / Pro / Enterprise 均可，免费版即可使用）。
*   从 [Github repo](https://github.com/Vizards/deepseek-v4-for-copilot) 安装插件。

#### 2. 获取 DeepSeek API Key[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/github_copilot#2-%E8%8E%B7%E5%8F%96-deepseek-api-key "2. 获取 DeepSeek API Key的直接链接")

*   前往 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 创建 API Key。
*   复制 Key（以 `sk-` 开头）。

#### 3. 在 VS Code 中配置 API Key[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/github_copilot#3-%E5%9C%A8-vs-code-%E4%B8%AD%E9%85%8D%E7%BD%AE-api-key "3. 在 VS Code 中配置 API Key的直接链接")

*   打开命令面板（`Cmd+Shift+P` / `Ctrl+Shift+P`）。
*   执行 **DeepSeek: Set API Key** 并粘贴你的 Key。
*   Key 会安全存储在操作系统密钥链中，不会写入磁盘。

#### 4. 选择模型并开始对话[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/github_copilot#4-%E9%80%89%E6%8B%A9%E6%A8%A1%E5%9E%8B%E5%B9%B6%E5%BC%80%E5%A7%8B%E5%AF%B9%E8%AF%9D "4. 选择模型并开始对话的直接链接")

*   打开 Copilot Chat（`Cmd+Shift+I` / `Ctrl+Shift+I`）。
*   点击聊天面板右上角的模型选择器。
*   选择 **DeepSeek V4 Pro** 或 **DeepSeek V4 Flash**。
*   即可开始对话 — Agent 模式、工具调用及所有 Copilot 功能均可直接使用。

#### 可选：配置思考深度[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/github_copilot#%E5%8F%AF%E9%80%89%E9%85%8D%E7%BD%AE%E6%80%9D%E8%80%83%E6%B7%B1%E5%BA%A6 "可选：配置思考深度的直接链接")

在模型选择器中，点击 DeepSeek 模型旁的齿轮图标可选择思考深度：

*   **None** — 最快，不启用推理。
*   **High** — 平衡模式（默认）。
*   **Max** — 深度推理，适合复杂任务。

#### 可选：视觉支持[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/github_copilot#%E5%8F%AF%E9%80%89%E8%A7%86%E8%A7%89%E6%94%AF%E6%8C%81 "可选：视觉支持的直接链接")

DeepSeek V4 为纯文本模型，但插件会自动处理图片。将截图拖入对话后，插件会通过其他已安装的 Copilot 模型（如 Claude、GPT-4o）描述图片内容，再发送给 DeepSeek。执行 **DeepSeek: Set Vision Proxy Model** 可选择用于图片描述的模型。

![Image 1](https://raw.githubusercontent.com/Vizards/deepseek-v4-for-copilot/main/resources/screenshots/01-picker.png)
