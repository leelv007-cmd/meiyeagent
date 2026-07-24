Title: 列出模型 | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/api/list-models

Markdown Content:
*   [](https://api-docs.deepseek.com/zh-cn/)
*   API 文档
*   模型（Model）
*   列出模型

## 列出模型

GET 
## https://api.deepseek.com/models

列出可用的模型列表，并提供相关模型的基本信息。请前往[模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)查看当前支持的模型列表

OK, 返回模型列表

*   application/json

*   Schema
*   Example (from schema)
*   Example

**Schema**

**object** string required

**Possible values:** [`list`]

**data**
Model[]

required

*   curl
*   python
*   go
*   nodejs
*   ruby
*   csharp
*   php
*   java
*   powershell

*   CURL

`curl -L -X GET 'https://api.deepseek.com/models' \-H 'Accept: application/json' \-H 'Authorization: Bearer <TOKEN>'`

Request Collapse all

Base URL

https://api.deepseek.com

Auth

Bearer Token

Response Clear

Click the `Send API Request` button above and see the response here!
