Title: 接入 Reasonix | DeepSeek API Docs

URL Source: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/reasonix

Markdown Content:
提示

本工具完全由第三方提供，仅供开发者参考，我们无法保证其有效性和安全性，不对其承担责任。

Reasonix 是一款以 DeepSeek 为原生后端的终端编程 Agent。设计围绕 DeepSeek API 展开 —— Cache-First 循环、Flash 优先的成本控制、工具调用自动修复 —— 直接对接 `api.deepseek.com`，不需要协议转换层。

#### 1. 安装 Node.js[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/reasonix#1-%E5%AE%89%E8%A3%85-nodejs "1. 安装 Node.js的直接链接")

*   安装 [Node.js](https://nodejs.org/en/download/) 20.10 及以上版本。
*   Windows 用户请安装 [Git for Windows](https://git-scm.com/download/win)。

#### 2. 获取 DeepSeek API Key[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/reasonix#2-%E8%8E%B7%E5%8F%96-deepseek-api-key "2. 获取 DeepSeek API Key的直接链接")

在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 获取 API Key。Reasonix 首次启动会有内置向导询问 Key 并持久化到 `~/.reasonix/config.json` —— 无需配置环境变量。

#### 3. 进入项目目录，执行 `npx reasonix code` 即可开始使用。[​](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/reasonix#3-%E8%BF%9B%E5%85%A5%E9%A1%B9%E7%9B%AE%E7%9B%AE%E5%BD%95%E6%89%A7%E8%A1%8C-npx-reasonix-code-%E5%8D%B3%E5%8F%AF%E5%BC%80%E5%A7%8B%E4%BD%BF%E7%94%A8 "3-进入项目目录执行-npx-reasonix-code-即可开始使用的直接链接")

`cd /path/to/my-projectnpx reasonix code`

无需全局安装。Reasonix 默认使用 **DeepSeek-V4-Flash** 跑日常迭代以控制成本。在 TUI 中输入 `/pro` 可在下一轮切换到 **DeepSeek-V4-Pro**，`/preset max` 则整个 session 都走 Pro。输入 `/help` 查看完整 slash 命令参考。

![Image 1](https://raw.githubusercontent.com/esengine/reasonix/main/docs/logo.svg)
