Title: 查询余额 | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/api/get-user-balance

Published Time: Mon, 13 Jul 2026 03:34:38 GMT

Markdown Content:
## 查询余额

GET 
## https://api.deepseek.com/user/balance

查询账号余额

## Responses[​](https://api-docs.deepseek.com/zh-cn/api/get-user-balance#responses "Responses的直接链接")

*   200

OK, 返回用户余额详情

*   application/json

*   Schema
*   Example (from schema)
*   Example

**Schema**

**is_available** boolean

当前账户是否有余额可供 API 调用

**balance_infos**
object[]

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

`curl -L -X GET 'https://api.deepseek.com/user/balance' \-H 'Accept: application/json' \-H 'Authorization: Bearer <TOKEN>'`

Request Collapse all

Base URL

https://api.deepseek.com

Auth

Bearer Token

Response Clear

Click the `Send API Request` button above and see the response here!
