# Spec H｜换装遗留与 UI 缺项（heroui 残件替换 + ops 图表件 + 命令面板/通知/待办 Popover）

> 来源：admin-reui-restyle-plan-2026-08-06.md「落地状态」7 项遗留 + 方案 §二未落地的可选部件。UI 层，尽量复用 ReUI 现成 block，不自研。
>
> 状态：已批准并开票（2026-08-06）。实施票：#386 UI 缺项补齐 · #387 heroui 残件替换。

## Problem Statement

ReUI 换装波把 14 个管理页拉齐到了同一套设计系统，但留下几处 heroui 残件与未做的 UI 缺项。admin 面还剩两处 heroui 依赖：运营面板的图表件（BarChart/PieChart/Timeline——当时 reui 侧无图表方案）与受控配置表单的整套单元格编辑器（DataGrid/NumberStepper/CellSelect/CellSlider/CellSwitch/ListBox，换装成本畸高被推迟）。方案原本设计的 header 右侧「运营待办」聚合 Popover（计数复用页面 query，与页面数字永不打架）实施时被推迟。tempo 模板里可直接搬的两个部件——⌘K 命令面板、通知中心——被列为可选未做。此外还有几处小尾巴：/admin/skills 路由标题/描述硬编码中文缺消息键、supply.views.$viewId 面板标题与页头同文、原生 select 多处残留、heroui-spike 路由仍在消费 heroui ListView。

## Solution

用 ReUI 现成 block 覆盖 ops 图表与命令面板/通知/待办 Popover 这些 UI 缺项（不自研），把受控配置表单的 heroui 单元格编辑器整套替换为 ReUI 数据网格与表单控件，并清掉标题硬编码、同文重复、原生 select 等尾巴。全部为表现层，不动任何数据接线。

## User Stories

1. As a 管理员, I want 运营面板的图表用与全站一致的设计系统渲染, so that 后台不再有一块视觉突兀的 heroui 残留。
2. As a 管理员, I want 受控配置表单的单元格编辑器与全站风格一致, so that 配置页不再是另一套控件语言。
3. As a 管理员, I want header 右侧有一个「运营待办」聚合入口显示待处理项计数, so that 我一进后台就看到待办总量并能一键跳转。
4. As a 管理员, I want 待办计数复用各页自己的查询, so that header 的数字永远和它跳转过去的页面一致。
5. As a 管理员, I want ⌘K 全局命令面板快速跳转管理页, so that 我不必每次用鼠标找侧栏。
6. As a 管理员, I want 一个通知中心查看运营告警流, so that 异常与待办有一个集中入口。
7. As a 运营, I want /admin/skills 的标题与描述像其他页一样支持中英双语, so that 语言切换时它不掉队。
8. As a 运营, I want supply 关联视图页不再出现与页头同文的重复标题, so that 界面不啰嗦。
9. As a 运营, I want 配置挑选器不再是原生下拉, so that 控件风格统一、可访问性一致。
10. As a 平台负责人, I want heroui 依赖在 admin 面清零, so that 后台只依赖一套设计系统、维护面收窄。

## Implementation Decisions

- **ops 图表件**：用 ReUI 的 AI-Ops 方案块覆盖运营面板的图表与时间线。候选 block（付费，已有 REUI_LICENSE_KEY）：
  - `solution-ai-ops-1`（metric cards + failover timeline + token activity chart + routing grid，与现有 supply/exception 监控形态高度吻合）— 预览：https://reui.io/preview/base/solution-ai-ops-1
  - KPI 条可用 `chart-6`（可切换指标的折线卡）https://reui.io/preview/base/chart-6 或 `chart-8`（径向 gauge KPI 行）https://reui.io/preview/base/chart-8
  以块为形态参照，接现有 observability 数据；诚实 unknown 标注保留。
- **命令面板 + 通知 + 待办 Popover**：用 ReUI app-shell 块的对应部件覆盖：
  - `app-shell-3`（inset sidebar + command 搜索 + notifications popover + usage meter，surface=frame，与换装后的壳结构一致）— 预览：https://reui.io/preview/base/app-shell-3
  - header「运营待办」聚合 Popover 参照 `app-shell-7` 的 system monitor popover 形态 https://reui.io/preview/base/app-shell-7，但计数复用各页既有 query（pending-actions / 待复核退款 / 异常数），不新建数据源——与页面数字同源，永不打架。
  - 命令面板搜索源 = 六域导航 + 各页 recordable 实体。
- **受控配置单元格编辑器**：`admin-config-form.tsx` 的 heroui DataGrid/NumberStepper/CellSelect/CellSlider/CellSwitch/ListBox 整套换成 ReUI DataGrid + shadcn 表单控件（input/select/switch/slider）。这是本 spec 工作量最大项，可单独成票。
- **小尾巴**：/admin/skills 路由标题/描述补 `admin_skills_title`/`_description` 消息键；supply.views.$viewId 面板去掉与页头同文的重复标题；原生 `<select>` 换 base-nova Select（注意多处绑 react-hook-form，属交互层小改）；heroui-spike 路由的 ListView 消费——该路由为 spike 性质，评估直接删除该 spike 路由或标注隔离。
- 全部只换表现层；图表/表单/待办的数据来源、查询、命令调用不动。

## Testing Decisions

- 好测试断言「渲染出来、跳转对、计数与目标页一致」这些外部事实，不断言图表内部。
- **待办 Popover**：交互测试断言 header 计数与对应页面查询同源（同一 mock 驱动两处断言一致）。
- **命令面板**：交互测试断言 ⌘K 打开、搜索命中、回车跳转。
- **配置表单换装**：既有 admin-config-form 的交互测试（单元格编辑、提交）在换控件后仍全绿——这是「只换表现层」的验收锚。
- **小尾巴**：skills 标题 i18n 用 product-surface/navigation 型断言；同文重复用路由测试断言标题不重复。
- ReUI block 安装后按 MCP 工作流 validate_usage + get_audit_checklist 收口。

## Out of Scope

- 图表方案的自研（明确用 ReUI block，不自己写 chart 封装）。
- heroui-spike 之外的商家面 heroui 使用（本 spec 只清 admin 面）。
- 命令面板的模糊搜索/历史/快捷动作扩展（先做基础跳转）。

## Further Notes

- 全部候选 block 为 ReUI Pro，安装用 `npx shadcn@latest add @reui/<name>`，registry 与 `REUI_LICENSE_KEY` 已配置（见 components.json）。安装前先在 previewUrl 看实样、按 MCP 的 get_component 读真实 API 再写 props，不手搓不臆造。
- 本 spec 建议拆两票：①UI 缺项补齐（ops 图表 + 命令面板/通知/待办 Popover，纯新增，风险低）；②heroui 残件替换（配置表单单元格编辑器 + 小尾巴，改存量，需回归护航）。
