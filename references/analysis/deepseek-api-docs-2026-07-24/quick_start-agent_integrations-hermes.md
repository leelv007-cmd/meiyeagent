Title: 接入 Hermes | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/hermes

Published Time: Mon, 13 Jul 2026 03:34:31 GMT

Markdown Content:
提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

Hermes 是 Nous Research 打造的开源自我进化 AI Agent。它内置学习闭环：能够从经验中生成技能，在使用过程中持续优化，沉淀知识，并在跨会话中逐步构建你偏好的动态模型。

#### 1. 安装 Hermes[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/hermes#1-%E5%AE%89%E8%A3%85-hermes "1. 安装 Hermes的直接链接")

##### 快速安装[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/hermes#%E5%BF%AB%E9%80%9F%E5%AE%89%E8%A3%85 "快速安装的直接链接")

通过一行安装命令，你可以在两分钟内快速启动 Hermes Agent。

###### Linux / macOS / WSL2[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/hermes#linux--macos--wsl2 "Linux / macOS / WSL2的直接链接")

`curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash`

唯一前置依赖是 Git，其余内容安装脚本会自动处理。

更多安装说明请参考 [Hermes 安装文档](https://hermes-agent.nousresearch.com/docs/getting-started/installation)。

#### 2. 运行并配置[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/hermes#2-%E8%BF%90%E8%A1%8C%E5%B9%B6%E9%85%8D%E7%BD%AE "2. 运行并配置的直接链接")

重新加载 shell 后，开始配置 Hermes：

*   执行 `hermes setup` 命令
*   选择 Quick Setup
*   当提示选择模型提供商时，选择 **DeepSeek**
*   输入你的 [DeepSeek API Key](https://platform.deepseek.com/api_keys)
*   Base URL 填写 `https://api.deepseek.com`
*   选择 `deepseek-v4-pro` 模型
*   继续完成其余配置选项
