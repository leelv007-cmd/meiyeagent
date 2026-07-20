# AgentKit 应用广场 (Application Plaza) — 模板全清单

- URL: https://console.volcengine.com/agentkit/region:agentkit+cn-beijing/application
- 抓取时间: 2026-07-08
- 页面副标题:「提供 Agent 快速入门到场景化最佳实践的模版」
- 卡片布局: 每张卡 = 缩略图(homepage.png) + 名称 + 来源标签(火山/入门模板) + 一句话描述

## 场景化最佳实践模板 (来源=火山官方)
| 模板 | 一句话定位 |
|---|---|
| **电商营销视频生成** | 串联 营销策划→分镜脚本→图片生成→质量评估→视频生成→合成发布 全环节，制作单品宣传/活动促销等商品展示类短视频物料 |
| 内容安全审核助手 | 基于 AgentKit 的内容安全审核，保障内容安全前提下解决数据分析问题 |
| 餐厅智能点餐助手 | 功能完善的点餐助手，展示 VeADK 多项高级能力 |
| 股票智能分析助手 | 股票走势分析及投资建议 |
| 智能运维助手 | 对话式云资源巡检与故障诊断 |
| 智能代码生成助手 | 编程辅助，解决各类编程问题 |
| 客户服务智能体助手 | 智能客服，处理客户咨询和商品售后 |
| 智能问数助手 | 自然语言查数据/看指标/做分析，无需懂 SQL |
| **绘影故事视频精灵** | 绘本插画师：儿童故事→卡通风格绘本插画+分镜视频（5-15岁读者）|
| 智能旅行助理 | 用户提供基本信息→自动生成完整旅行行程 |
| 门店巡检助手 | 零售门店巡检，计算机视觉+AI 自动化巡检设施状态 |

## 入门模板 (来源=入门模板 / beginners，展示 VeADK 单点能力)
| 模板 | 能力点 |
|---|---|
| Agent Callback 能力 | 智能体生命周期各阶段 callbacks 示例 |
| Agent Skills | Skills Sandbox 完成特定能力 |
| Agent 与 Viking 知识库 | VeADK+VikingDB 的 RAG（检索增强生成）示例 |
| **Agent 与火山内置生图生视频工具** | 根据文本生成图片或视频的 Agent |
| Agent 与 Viking 记忆库 | 短期记忆(同会话)+长期记忆(跨会话) |
| A2A Agent 协作 | Agent-to-Agent 协议：本地客户端 × 远程 agent |
| Hello World Agent | 最简单的聊天 Agent |
| 多 Agents 协作 | VeADK 构建多个专业 Agent 组成的协作系统 |

## 关键观察
- **内容生成类模板**（对美业最相关）: 电商营销视频生成 / 绘影故事视频精灵 / Agent 与火山内置生图生视频工具。共性 = "多阶段 pipeline + 中间产物评估择优 + 合成发布"。
- **底层框架 = VeADK** (Volcengine Agent Development Kit)。入门模板逐一展示 VeADK 原语: callbacks / skills / RAG(VikingDB) / 记忆(短+长) / A2A / 多 agent 协作。这与我们评审里"AI SDK 起步、Mastra 推迟"的原语选型是同一层抽象。
- 应用广场 = **模板货架**（不是空白创建），把"场景化最佳实践"作为主入口，用户从"选一个像我的场景"开始，而非"从零搭 agent"。
