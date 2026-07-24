Title: 接入 OpenCode | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/opencode

Markdown Content:
提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

OpenCode 是一个开源 AI 编程助手，提供终端、网页等运行形式。

## 从现有安装中迁移到 DeepSeek[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/opencode#%E4%BB%8E%E7%8E%B0%E6%9C%89%E5%AE%89%E8%A3%85%E4%B8%AD%E8%BF%81%E7%A7%BB%E5%88%B0-deepseek "从现有安装中迁移到 DeepSeek的直接链接")

1.   执行 `opencode upgrade` 命令，将 opencode 升级至最新版本（>=v1.14.24）
2.   执行 `opencode` 命令，启动 OpenCode
3.   输入框中输入 `/connect`，然后输入 `deepseek` 并选择供应商

![Image 1](https://api-docs.deepseek.com/zh-cn/img/opencode_1.png)

![Image 2](https://api-docs.deepseek.com/zh-cn/img/opencode_2.png)

1.   填入 [DeepSeek API Key](https://platform.deepseek.com/api_keys)

![Image 3](https://api-docs.deepseek.com/zh-cn/img/opencode_3.png)

1.   选择 DeepSeek-V4-Pro 模型

![Image 4](https://api-docs.deepseek.com/zh-cn/img/opencode_4.png)

* * *

## 从零安装 OpenCode[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/opencode#%E4%BB%8E%E9%9B%B6%E5%AE%89%E8%A3%85-opencode "从零安装 OpenCode的直接链接")

#### 1. 安装 OpenCode[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/opencode#1-%E5%AE%89%E8%A3%85-opencode "1. 安装 OpenCode的直接链接")

前往官方下载页面安装或升级：[OpenCode 下载](https://opencode.ai/zh/download)

为避免兼容性问题，强烈建议您将 OpenCode 升级到最新版本，确保版本号 >= v1.14.24。

#### 2. 运行与配置[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/opencode#2-%E8%BF%90%E8%A1%8C%E4%B8%8E%E9%85%8D%E7%BD%AE "2. 运行与配置的直接链接")

*   执行 `opencode` 命令
*   输入框中输入 `/connect`，然后输入 `deepseek` 并选择供应商
*   填入 [DeepSeek API Key](https://platform.deepseek.com/api_keys)
*   选择 DeepSeek-V4-Pro 模型
