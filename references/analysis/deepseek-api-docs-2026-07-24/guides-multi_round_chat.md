Title: 多轮对话 | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/guides/multi_round_chat

Markdown Content:
DeepSeek `/chat/completions` API 是一个“无状态” API，即服务端不记录用户请求的上下文，用户在每次请求时，**需将之前所有对话历史拼接好后**，传递给对话 API。

`from openai import OpenAIclient = OpenAI(api_key="<DeepSeek API Key>", base_url="https://api.deepseek.com")# Round 1messages = [{"role": "user", "content": "What's the highest mountain in the world?"}]response = client.chat.completions.create(    model="deepseek-v4-pro",    messages=messages)messages.append(response.choices[0].message)print(f"Messages Round 1: {messages}")# Round 2messages.append({"role": "user", "content": "What is the second?"})response = client.chat.completions.create(    model="deepseek-v4-pro",    messages=messages)messages.append(response.choices[0].message)print(f"Messages Round 2: {messages}")`
