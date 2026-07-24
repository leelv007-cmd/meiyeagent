Title: 对话前缀续写（Beta） | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/guides/chat_prefix_completion

Markdown Content:
下面给出了对话前缀续写的完整 Python 代码样例。在这个例子中，我们设置 `assistant` 开头的消息为 `"```python\n"` 来强制模型输出 python 代码，并设置 `stop` 参数为 `['```']` 来避免模型的额外解释。

`from openai import OpenAIclient = OpenAI(    api_key="<your api key>",    base_url="https://api.deepseek.com/beta",)messages = [    {"role": "user", "content": "Please write quick sort code"},    {"role": "assistant", "content": "```python\n", "prefix": True}]response = client.chat.completions.create(    model="deepseek-v4-pro",    messages=messages,    stop=["```"],)print(response.choices[0].message.content)`
