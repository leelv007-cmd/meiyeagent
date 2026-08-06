# Spec G｜IA 拆页与治理清理批（P2 杂项）

> 来源：admin-config-audit-2026-08-06.md §2.9/§2.10/§2.11/§2.4、§4.2、§五 P2、§六报备①。低风险清理与 IA 收敛。
>
> 状态：已批准并开票（2026-08-06）。实施票：#388 拆页 · #389 审计筛选导出 · #390 死字段与副本收敛 · #391 兑换码定时过期 · #392 deep-link 与文档。

## Problem Statement

审计留下一批不紧急但会持续制造混乱与债务的问题：审计页里塞着带写操作的退款复核（只读语义页承载写流程）、模板页是「模板+笔记风格+敏感词+创作体验」四合一容器（敏感词属合规治理与模板无关）；审计页完全没有筛选与导出能力；模型 Catalog 的 capabilities/routes 两个字段仅落库不消费却各带一个统计 chip，误导运营以为改它们能变路由；能力目录只覆盖 8 页下钻、漏了 supply/cloudflare/capabilities/index；兑换码过期是惰性触发（管理员打开列表才批量执行且会让他人页面的作废按钮报冲突）；积分套餐配置键有三份手抄副本、shell 那份漏了一个键；Cloudflare 技术台 deep-link 是死的（渲染成 span、Core 有生成器却无人调用）；两份过时的 WIRING-DIFF.md 会误导后续审计；`harness.woz.recipe` 的实际定位（只当版本触发器、值无人读）未文档化。

## Solution

按低风险优先原则收敛这批：把带写操作或不相关的模块从语义错位的页面里拆出，补齐审计页的筛选与导出，清理误导性的死字段与统计 chip，补齐能力目录覆盖，把兑换码惰性过期改为定时任务，收敛配置键副本，接上或撤掉 Cloudflare deep-link，删除过时文档并把 woz.recipe 的定位写清。

## User Stories

1. As a 运营, I want 退款复核从只读的审计页拆出到一个带写语义的位置, so that 页面语义与其承载的操作一致。
2. As a 运营, I want 敏感词治理从模板页拆到合规治理位置, so that 我按业务域找得到它。
3. As a 运营, I want 在审计页按时间/操作者/动作筛选记录, so that 我能快速定位一条审计。
4. As a 运营, I want 导出审计记录, so that 我能离线留存或提交合规。
5. As a 运营, I want Catalog 里不再出现改了也没用的 capabilities/routes 字段与其统计, so that 我不会误以为改它们能改路由。
6. As a 运营, I want 能力目录覆盖 supply/cloudflare/capabilities/首页, so that 每个管理页都有明确的域归属与下钻。
7. As a 运营, I want 过期兑换码由后台定时清理, so that 我刷新列表不会让别人的作废操作报冲突。
8. As a 平台负责人, I want 积分套餐配置键只有一份权威定义, so that 三处副本不会漂移、参考数字键不会漏出运行时配置表。
9. As a 运营, I want Cloudflare 技术台 deep-link 要么真能跳要么不出现, so that 我不会点一个死链接。
10. As a 后续审计者, I want 过时的 WIRING-DIFF 文档被删除、woz.recipe 的定位被写清, so that 我不会被陈旧线索误导。

## Implementation Decisions

- **IA 拆页**：退款复核从 /admin/audit 拆到带写语义的位置（归属见实施票，倾向单独的复核工作台或计费域）；敏感词治理从 /admin/templates 拆到合规治理域。拆的是挂载位置与导航归属，控件逻辑不动。
- **审计筛选/导出**：审计页新增时间/操作者/动作筛选与导出（CSV）。这是新增能力（当前完全不存在），落在既有审计查询之上。
- **死字段清理**：移除 Catalog 编辑器里 capabilities/routes 两个字段的编辑入口与统计 chip（真实路由来自 RoutePolicy），或明确标注「仅存储、不驱动路由」。倾向移除。
- **能力目录补齐**：ADMIN_DRILLDOWN_PAGES 补 supply/cloudflare/capabilities/index，使六域覆盖完整、CapabilityDrilldownBanner 全页出现。
- **兑换码定时过期**：把惰性 expireDue 改为后台定时任务驱动，列表读取不再触发 revision 抖动。
- **配置键副本收敛**：CREDIT_PLAN_CONFIG_KEYS 收敛为单一权威来源，消除三份手抄、补回 shell 侧漏掉的 reference_numbers 键。
- **Cloudflare deep-link**：接上 Core 已有的 dashboardUrl 生成器（渲染为真链接），或撤掉该区块。倾向接上。
- **文档清理**：删除两份过时 WIRING-DIFF.md；把 `harness.woz.recipe` 的定位（只消费 revision 作版本触发器、JSON 值无读取方）写入配置键说明（报备①）。

## Testing Decisions

- 好测试断言拆页后归属正确、新能力可用、死字段消失、副本收敛。
- **拆页**：路由/导航测试断言退款复核与敏感词治理出现在新位置、不在旧页。
- **筛选导出**：交互测试断言筛选缩小结果集、导出产出文件。
- **死字段**：断言 Catalog 编辑器不再暴露 capabilities/routes 编辑与 chip。
- **配置键副本**：单元测试断言 CREDIT_PLAN_CONFIG_KEYS 单一来源、reference_numbers 出现在运行时配置表。
- **兑换码**：断言列表读取不再触发 revision 递增（先写「现状刷新即 +1」的红）。
- 每个子项可独立红绿，便于拆票并行。

## Out of Scope

- 全后台 IA 的大改（本 spec 只拆两处语义错位页；六域收敛的其余部分已在换装波）。
- 审计的高级分析/可视化（只做基础筛选与导出）。

## Further Notes

本批低风险、可并行、可拆多个小票。建议按「拆页 / 审计筛选导出 / 死字段与副本清理 / 兑换码定时 / deep-link 与文档」拆五个子票，或整批交给一个清理 lane。
