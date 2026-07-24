Title: Anthropic API | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/guides/anthropic_api

Published Time: Mon, 13 Jul 2026 03:34:38 GMT

Markdown Content:
为了满足大家对 Anthropic API 生态的使用需求，我们的 API 新增了对 Anthropic API 格式的支持，其 `base_url` 为 `https://api.deepseek.com/anthropic`。

`import anthropicclient = anthropic.Anthropic()message = client.messages.create(    model="deepseek-v4-pro",    max_tokens=1000,    system="You are a helpful assistant.",    messages=[        {            "role": "user",            "content": [                {                    "type": "text",                    "text": "Hi, how are you?"                }            ]        }    ])print(message.content)`

通过这样的映射，您在使用新版 Claude Desktop APP 的 developer 模式时，可以绕过 APP 对模型名的限制，只需改动 base_url 和 api_key，即可在其中接入 DeepSeek 模型。

Field Variant Sub-Field Support Status
content string Fully Supported
array, type="text"text Fully Supported
cache_control Ignored
citations Ignored
array, type="image"Not Supported
array, type = "document"Not Supported
array, type = "search_result"Not Supported
array, type = "thinking"Supported
array, type="redacted_thinking"Not Supported
array, type = "tool_use"id Fully Supported
input Fully Supported
name Fully Supported
cache_control Ignored
array, type = "tool_result"tool_use_id Fully Supported
content Fully Supported
cache_control Ignored
is_error Ignored
array, type = "server_tool_use"Supported
array, type = "web_search_tool_result"Supported
array, type = "code_execution_tool_result"Not Supported
array, type = "mcp_tool_use"Not Supported
array, type = "mcp_tool_result"Not Supported
array, type = "container_upload"Not Supported
