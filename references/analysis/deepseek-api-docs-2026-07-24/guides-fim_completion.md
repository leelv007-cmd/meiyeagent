Title: FIM 补全（Beta） | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/guides/fim_completion

Markdown Content:
在 [FIM (Fill In the Middle) 补全](https://api-docs.deepseek.com/zh-cn/api/create-completion)中，用户可以提供前缀和后缀（可选），模型来补全中间的内容。FIM 常用于内容续写、代码补全等场景。

## 注意事项[​](https://api-docs.deepseek.com/zh-cn/guides/fim_completion#%E6%B3%A8%E6%84%8F%E4%BA%8B%E9%A1%B9 "注意事项的直接链接")

1.   模型的最大补全长度为 4K。
2.   用户需要设置 `base_url="https://api.deepseek.com/beta"` 来开启 Beta 功能。

## 样例代码[​](https://api-docs.deepseek.com/zh-cn/guides/fim_completion#%E6%A0%B7%E4%BE%8B%E4%BB%A3%E7%A0%81 "样例代码的直接链接")

下面给出了 FIM 补全的完整 Python 代码样例。在这个例子中，我们给出了计算斐波那契数列函数的开头和结尾，来让模型补全中间的内容。

`from openai import OpenAIclient = OpenAI(    api_key="<your api key>",    base_url="https://api.deepseek.com/beta",)response = client.completions.create(    model="deepseek-v4-pro",    prompt="def fib(a):",    suffix="    return fib(a-1) + fib(a-2)",    max_tokens=128)print(response.choices[0].text)`

## 配置 Continue 代码补全插件[​](https://api-docs.deepseek.com/zh-cn/guides/fim_completion#%E9%85%8D%E7%BD%AE-continue-%E4%BB%A3%E7%A0%81%E8%A1%A5%E5%85%A8%E6%8F%92%E4%BB%B6 "配置 Continue 代码补全插件的直接链接")

[Continue](https://continue.dev/) 是一款支持代码补全的 VSCode 插件，您可以参考[这篇文档](https://github.com/deepseek-ai/awesome-deepseek-integration/blob/main/docs/continue/README_cn.md)来配置 Continue 以使用代码补全功能。
