Title: 首次调用 API | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/

Published Time: Mon, 13 Jul 2026 03:34:33 GMT

Markdown Content:
DeepSeek API 使用与 OpenAI/Anthropic 兼容的 API 格式，通过修改配置，您可以使用 OpenAI/Anthropic SDK 来访问 DeepSeek API，或使用与 OpenAI/Anthropic API 兼容的软件。

| PARAM | VALUE |
| --- | --- |
| base_url (OpenAI) | `https://api.deepseek.com` |
| base_url (Anthropic) | `https://api.deepseek.com/anthropic` |
| api_key | apply for an [API key](https://platform.deepseek.com/api_keys) |
| model* | `deepseek-v4-flash` `deepseek-v4-pro` `deepseek-chat` (将于 2026/07/24 弃用) `deepseek-reasoner` (将于 2026/07/24 弃用) |

* deepseek-chat 与 deepseek-reasoner 两个模型名将于北京时间 2026/07/24 23:59 弃用。出于兼容考虑，二者分别对应 deepseek-v4-flash 的非思考与思考模式。

## 接入 Agent 工具[​](https://api-docs.deepseek.com/zh-cn/#%E6%8E%A5%E5%85%A5-agent-%E5%B7%A5%E5%85%B7 "接入 Agent 工具的直接链接")

DeepSeek API 已接入多种主流 AI Agent 与编程助手工具。如果你使用 Claude Code、GitHub Copilot、OpenCode 等工具，可以直接将 DeepSeek 作为后端模型，无需编写代码即可开始使用。

详见 [Agent 工具接入指南](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code)。

## 调用对话 API[​](https://api-docs.deepseek.com/zh-cn/#%E8%B0%83%E7%94%A8%E5%AF%B9%E8%AF%9D-api "调用对话 API的直接链接")

在创建 API key 之后，你可以使用以下样例脚本，通过 OpenAI API 格式来访问 DeepSeek 模型。样例为非流式输出，您可以将 stream 设置为 true 来使用流式输出。

Anthropic API 格式的访问样例，请参考[Anthropic API](https://api-docs.deepseek.com/zh-cn/guides/anthropic_api)。

*   curl
*   python
*   nodejs

`curl https://api.deepseek.com/chat/completions \  -H "Content-Type: application/json" \  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \  -d '{        "model": "deepseek-v4-pro",        "messages": [          {"role": "system", "content": "You are a helpful assistant."},          {"role": "user", "content": "Hello!"}        ],        "thinking": {"type": "enabled"},        "reasoning_effort": "high",        "stream": false      }'`
