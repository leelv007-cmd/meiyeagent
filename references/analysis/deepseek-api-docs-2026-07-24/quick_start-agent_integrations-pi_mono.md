Title: 接入 Pi | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/pi_mono

Published Time: Mon, 13 Jul 2026 03:34:27 GMT

Markdown Content:
提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

Pi（pi-mono）是一个极简且高度可扩展的终端编码框架。它通过 TypeScript 扩展、技能、提示模板和主题来适配你的工作流，支持树状会话结构和 15+ 内置供应商。

`{  "providers": {    "deepseek": {      "baseUrl": "https://api.deepseek.com",      "api": "openai-completions",      "apiKey": "$DEEPSEEK_API_KEY",      "models": [        {          "id": "deepseek-v4-pro",          "name": "DeepSeek V4 Pro",          "contextWindow": 1000000,          "maxTokens": 384000,          "input": ["text"],          "reasoning": true,          "cost": {            "input": 1.74,            "output": 3.48,            "cacheRead": 0.145,            "cacheWrite": 0          },          "compat": {            "requiresReasoningContentOnAssistantMessages": true,            "thinkingFormat": "deepseek",            "reasoningEffortMap": {              "minimal": "high",              "low": "high",              "medium": "high",              "high": "high",              "xhigh": "max"            }          }        },        {          "id": "deepseek-v4-flash",          "name": "DeepSeek V4 Flash",          "contextWindow": 1000000,          "maxTokens": 384000,          "input": ["text"],          "reasoning": true,          "cost": {            "input": 0.14,            "output": 0.28,            "cacheRead": 0.028,            "cacheWrite": 0          },          "compat": {            "requiresReasoningContentOnAssistantMessages": true,            "thinkingFormat": "deepseek",            "reasoningEffortMap": {              "minimal": "high",              "low": "high",              "medium": "high",              "high": "high",              "xhigh": "max"            }          }        }      ]    }  }}`
