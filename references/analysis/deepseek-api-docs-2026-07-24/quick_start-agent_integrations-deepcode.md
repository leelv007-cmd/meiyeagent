Title: 集成 Deep Code | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/deepcode

Markdown Content:
提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

Deep Code 是一款开源的终端 AI 编程助手，专为 DeepSeek-V4 系列模型适配，支持深度思考、推理强度控制以及 Agent Skills。

*   **GitHub：**[https://github.com/lessweb/deepcode-cli](https://github.com/lessweb/deepcode-cli)

#### 1. 安装 Deep Code[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/deepcode#1-%E5%AE%89%E8%A3%85-deep-code "1. 安装 Deep Code的直接链接")

*   安装 [Node.js](https://nodejs.org/en/download/) 18+ 版本。
*   在终端中运行以下命令：

`npm install -g @vegamo/deepcode-cli`

*   验证安装是否成功：

`deepcode --version`

#### 2. 配置 Deep Code[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/deepcode#2-%E9%85%8D%E7%BD%AE-deep-code "2. 配置 Deep Code的直接链接")

创建 `~/.deepcode/settings.json` 文件，填入你的 DeepSeek API Key 和模型配置：

`{  "env": {    "MODEL": "deepseek-v4-pro",    "BASE_URL": "https://api.deepseek.com",    "API_KEY": "sk-..."  },  "thinkingEnabled": true,  "reasoningEffort": "max"}`

从 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 获取你的 API Key。

> **注意：** 此配置文件与 [Deep Code VSCode 扩展](https://github.com/lessweb/deepcode) 共享。

**配置选项：**

| 选项 | 说明 |
| --- | --- |
| `MODEL` | 模型名称，例如 `deepseek-v4-pro` 或 `deepseek-v4-flash` |
| `BASE_URL` | API 地址，默认为 `https://api.deepseek.com` |
| `thinkingEnabled` | 启用深度思考模式（deepseek-v4 模型默认开启） |
| `reasoningEffort` | `"max"` 或 `"high"` — 控制模型的推理强度 |
| `notify` | 模型回答完成后执行的脚本路径 |
| `webSearchTool` | 启用联网搜索功能 |

#### 3. 进入项目目录并启动 Deep Code[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/deepcode#3-%E8%BF%9B%E5%85%A5%E9%A1%B9%E7%9B%AE%E7%9B%AE%E5%BD%95%E5%B9%B6%E5%90%AF%E5%8A%A8-deep-code "3. 进入项目目录并启动 Deep Code的直接链接")

`cd /path/to/my-projectdeepcode`

#### 快捷键[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/deepcode#%E5%BF%AB%E6%8D%B7%E9%94%AE "快捷键的直接链接")

| 按键 | 功能 |
| --- | --- |
| `Enter` | 发送消息 |
| `Shift+Enter` | 换行（也支持 `Ctrl+J`） |
| `Ctrl+V` | 从剪贴板粘贴图片 |
| `Esc` | 中断当前模型回复 |
| `/` | 打开技能/命令菜单 |
| `/new` | 开始新的对话 |
| `/resume` | 选择之前的对话继续 |
| `/exit` | 退出 Deep Code |

#### 使用 Agent Skills[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/deepcode#%E4%BD%BF%E7%94%A8-agent-skills "使用 Agent Skills的直接链接")

Agent Skills 从以下位置自动发现：

*   **用户级别：**`~/.agents/skills/<name>/SKILL.md`
*   **项目级别：**`./.deepcode/skills/<name>/SKILL.md`

按 `/` 键打开技能选择器，或直接输入技能名称（例如 `/skill-writer`）。
