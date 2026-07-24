Title: DeepSeek API 升级，支持续写、FIM、Function Calling、JSON Output | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/news/news0725

Markdown Content:
今天，DeepSeek API 迎来更新，装备了新的接口功能，来释放模型的更多潜力：

*   **更新接口 `/chat/completions`**
    *   JSON Output
    *   Function Calling
    *   对话前缀续写（Beta）
    *   8K 最长输出（Beta）

*   **新增接口 `/completions`**
    *   FIM 补全（Beta）

所有新功能，均可使用 `deepseek-chat` 和 `deepseek-coder` 模型调用。

* * *

### 一、更新接口 `/chat/completions`[​](https://api-docs.deepseek.com/zh-cn/news/news0725#%E4%B8%80%E6%9B%B4%E6%96%B0%E6%8E%A5%E5%8F%A3-chatcompletions "一更新接口-chatcompletions的直接链接")

#### 1. JSON Output，增强内容格式化[​](https://api-docs.deepseek.com/zh-cn/news/news0725#1-json-output%E5%A2%9E%E5%BC%BA%E5%86%85%E5%AE%B9%E6%A0%BC%E5%BC%8F%E5%8C%96 "1. JSON Output，增强内容格式化的直接链接")

DeepSeek API 新增 JSON Output 功能，兼容 OpenAI API，能够强制模型输出 JSON 格式的字符串。

在进行数据处理等任务时，该功能可以让模型按预定格式返回 JSON，方便后续对模型输出内容进行解析，提高程序流程的自动化能力。

要使用 JSON Output 功能，需要：

1.   设置 `response_format` 参数为 `{'type': 'json_object'}`
2.   用户需要在提示词中，指导模型输出 JSON 的格式，来确保输出格式符合预期
3.   合理设置 `max_tokens`，防止 JSON 字符串被中途截断

以下为一个 JSON Output 功能的使用样例。在这个样例中，用户给出一段文本，模型对文本中的问题&答案进行格式化输出。

![Image 1](https://cdn.deepseek.com/api-docs/json_mode.jpg)

详细使用方法，请参考 [JSON Output 指南](https://api-docs.deepseek.com/zh-cn/guides/json_mode)。

#### 2. Function，连接物理世界[​](https://api-docs.deepseek.com/zh-cn/news/news0725#2-function%E8%BF%9E%E6%8E%A5%E7%89%A9%E7%90%86%E4%B8%96%E7%95%8C "2. Function，连接物理世界的直接链接")

DeepSeek API 新增 Function Calling 功能，兼容 OpenAI API，通过调用外部工具，来增强模型与物理世界交互的能力。

Function Calling 功能支持传入多个 Function（最多 128 个），支持并行 Function 调用。

下图展示了将 `deepseek-coder` 整合到开源大模型前端 [LobeChat](https://github.com/lobehub/lobe-chat) 的效果。在这个例子中，我们开启了“网站爬虫”插件，来实现对网站的爬取和总结。

![Image 2](https://cdn.deepseek.com/api-docs/fc_demo.gif)

下图展示了使用 Function Calling 功能的交互过程：

![Image 3](https://cdn.deepseek.com/api-docs/fc_demo_2.jpeg)

详细使用方法，请参考 [Function Calling 指南](https://api-docs.deepseek.com/zh-cn/guides/tool_calls)。

#### 3. 对话前缀续写（Beta），更灵活的输出控制[​](https://api-docs.deepseek.com/zh-cn/news/news0725#3-%E5%AF%B9%E8%AF%9D%E5%89%8D%E7%BC%80%E7%BB%AD%E5%86%99beta%E6%9B%B4%E7%81%B5%E6%B4%BB%E7%9A%84%E8%BE%93%E5%87%BA%E6%8E%A7%E5%88%B6 "3. 对话前缀续写（Beta），更灵活的输出控制的直接链接")

对话前缀续写沿用了[对话补全](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion)的 API 格式，允许用户指定最后一条 `assistant` 消息的前缀，来让模型按照该前缀进行补全。该功能也可用于输出长度达到 `max_tokens` 被截断后，将被截断的消息进行拼接，重新发送请求对被截断内容进行续写。

要使用对话前缀续写功能，需要：

1.   设置 `base_url` 为 `https://api.deepseek.com/beta` 来开启 Beta 功能
2.   确保 messages 列表里最后一条消息的 `role` 为 `assistant`，并设置最后一条消息的 `prefix` 参数为 `True`，如：`{"role": "assistant": "content": "在很久很久以前，", "prefix": True}`

以下为对话前缀续写功能的使用样例。在这个例子里，设置了 assistant 消息开头为`'```python\n'`，以强制其以代码块开始，并设置 stop 参数为 `'```'`，让模型不输出多余的内容。

![Image 4](https://cdn.deepseek.com/api-docs/chat_prefix_completion.jpeg)

详细使用方法，请参考 [对话前缀续写指南](https://api-docs.deepseek.com/zh-cn/guides/chat_prefix_completion)。

#### 4. 8K 最长输出（Beta），释放更长可能[​](https://api-docs.deepseek.com/zh-cn/news/news0725#4-8k-%E6%9C%80%E9%95%BF%E8%BE%93%E5%87%BAbeta%E9%87%8A%E6%94%BE%E6%9B%B4%E9%95%BF%E5%8F%AF%E8%83%BD "4. 8K 最长输出（Beta），释放更长可能的直接链接")

为了满足更长文本输出的场景，我们在 Beta 版 API 中，将 `max_tokens` 参数的上限调整为 8K。

要提高到 8K 最长输出，需要：

1.   设置 `base_url` 为 `https://api.deepseek.com/beta` 来开启 Beta 功能
2.   `max_tokens` 默认为 4096。开启 Beta 功能后，`max_tokens` 最大可设置为 8192

* * *

### 二、新增接口 `/completions`[​](https://api-docs.deepseek.com/zh-cn/news/news0725#%E4%BA%8C%E6%96%B0%E5%A2%9E%E6%8E%A5%E5%8F%A3-completions "二新增接口-completions的直接链接")

#### 1. FIM 补全（Beta），使能续写场景[​](https://api-docs.deepseek.com/zh-cn/news/news0725#1-fim-%E8%A1%A5%E5%85%A8beta%E4%BD%BF%E8%83%BD%E7%BB%AD%E5%86%99%E5%9C%BA%E6%99%AF "1. FIM 补全（Beta），使能续写场景的直接链接")

DeepSeek API 新增 FIM (Fill-In-the-Middle) 补全接口，兼容 OpenAI 的 FIM 补全 API，允许用户提供自定义的前缀/后缀（可选），让模型进行内容补全。该功能常用于故事续写、代码补全等场景。FIM 补全接口收费与对话补全相同。

要使用 FIM 补全接口，需要设置 `base_url` 为 `https://api.deepseek.com/beta` 来开启 Beta 功能。

以下为 FIM 补全接口的使用样例。在这个例子中，用户提供斐波那契数列函数的开头和结尾，模型对中间内容进行补全。

![Image 5](https://cdn.deepseek.com/api-docs/fim_completion.jpeg)

详细使用方法，请参考 [FIM 补全指南](https://api-docs.deepseek.com/zh-cn/guides/fim_completion)。

* * *

### 更新说明[​](https://api-docs.deepseek.com/zh-cn/news/news0725#%E6%9B%B4%E6%96%B0%E8%AF%B4%E6%98%8E "更新说明的直接链接")

Beta 接口已开放给所有用户使用，用户需要设置 `base_url` 为 `https://api.deepseek.com/beta` 来开启 Beta 功能。

Beta 接口属于不稳定接口，后续测试、发布计划会灵活变动，敬请谅解。

相关模型版本，在功能稳定后会发布到开源社区，敬请期待。
