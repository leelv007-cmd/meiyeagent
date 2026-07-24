Title: 接入 GitHub Copilot CLI | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/copilot_cli

Published Time: Mon, 13 Jul 2026 03:34:27 GMT

Markdown Content:
提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

通过 BYOK（自带密钥）模式配置 GitHub Copilot CLI 使用 DeepSeek V4 模型，基于 Anthropic 兼容端点接入。

> **重要提示：** 请使用 `anthropic` 作为 provider type。使用 `openai` 类型会触发 `400` 错误：`The reasoning_content in the thinking mode must be passed back to the API.` — DeepSeek 要求将模型输出的 `reasoning_content` 在下一次请求中原样回传，Copilot CLI 的 OpenAI 集成不支持此机制。改用 Anthropic Messages API 端点可以完全避免此问题。

#### 1. 安装 GitHub Copilot CLI[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/copilot_cli#1-%E5%AE%89%E8%A3%85-github-copilot-cli "1. 安装 GitHub Copilot CLI的直接链接")

`npm install -g @github/copilot`

需要 Node.js 22 或更高版本。详细说明参考[官方入门指南](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started)。

#### 2. 获取 DeepSeek API Key[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/copilot_cli#2-%E8%8E%B7%E5%8F%96-deepseek-api-key "2. 获取 DeepSeek API Key的直接链接")

*   前往 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 创建 API Key。
*   复制 Key（以 `sk-` 开头）。

#### 3. 配置环境变量[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/copilot_cli#3-%E9%85%8D%E7%BD%AE%E7%8E%AF%E5%A2%83%E5%8F%98%E9%87%8F "3. 配置环境变量的直接链接")

Linux / Mac：

```sh
export COPILOT_PROVIDER_TYPE=anthropic
export COPILOT_PROVIDER_BASE_URL=https://api.deepseek.com/anthropic
export COPILOT_PROVIDER_API_KEY=sk-your-deepseek-api-key
export COPILOT_MODEL=deepseek-v4-pro
```

Windows（PowerShell）：

```powershell
$env:COPILOT_PROVIDER_TYPE="anthropic"
$env:COPILOT_PROVIDER_BASE_URL="https://api.deepseek.com/anthropic"
$env:COPILOT_PROVIDER_API_KEY="sk-your-deepseek-api-key"
$env:COPILOT_MODEL="deepseek-v4-pro"
```

可选模型：`deepseek-v4-pro`、`deepseek-v4-flash`，修改 `COPILOT_MODEL` 即可切换。

#### 4. 启动 Copilot CLI[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/copilot_cli#4-%E5%90%AF%E5%8A%A8-copilot-cli "4. 启动 Copilot CLI的直接链接")

`copilot`

完整支持 Agent 模式、工具调用和 MCP — 全部由 DeepSeek 驱动。

#### 可选：配置 Token 限制[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/copilot_cli#%E5%8F%AF%E9%80%89%E9%85%8D%E7%BD%AE-token-%E9%99%90%E5%88%B6 "可选：配置 Token 限制的直接链接")

由于 `deepseek-v4-pro` 不在 Copilot CLI 的内置模型目录中，建议显式配置 token 限制：

Linux / Mac：

`export COPILOT_PROVIDER_MAX_PROMPT_TOKENS=840000export COPILOT_PROVIDER_MAX_OUTPUT_TOKENS=128000`

Windows（PowerShell）：

`$env:COPILOT_PROVIDER_MAX_PROMPT_TOKENS="840000"$env:COPILOT_PROVIDER_MAX_OUTPUT_TOKENS="128000"`

运行 `copilot help providers` 可查看所有可用环境变量。

#### 可选：离线模式[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/copilot_cli#%E5%8F%AF%E9%80%89%E7%A6%BB%E7%BA%BF%E6%A8%A1%E5%BC%8F "可选：离线模式的直接链接")

Linux / Mac：

`export COPILOT_OFFLINE=true`

Windows（PowerShell）：

`$env:COPILOT_OFFLINE="true"`

注意：提示词仍会发送到 `api.deepseek.com` — 离线模式仅阻止 GitHub 的 API 调用。

#### 相关资源[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/copilot_cli#%E7%9B%B8%E5%85%B3%E8%B5%84%E6%BA%90 "相关资源的直接链接")

*   [GitHub Copilot CLI BYOK 文档](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models)
