# Admin ReUI 换装完整性复核（2026-08-07）

复核对象：`/admin` 全部页面是否完整应用 ReUI Blocks（#386/#387，spec-h）与两个指定模板（`references/管理后台模板/surge-commerce`、`tempo-tasks`），承诺基准 = `docs/design/admin-reui-restyle-plan-2026-08-06.md`（下称「方案」）+ `docs/specs/admin-backlog-2026-08-06/spec-h-restyle-residuals.md`。

方法：三路独立复核 agent（批次 A tempo 页面 / 批次 B surge 页面 / 批次 C+blocks+壳层）反驳立场逐页对照模板源码，双向跑（承诺→实现、实现→承诺）；主控亲验壳层结构、改约台账，并在 dev:3000 浏览器登录逐页走查（13 页截图 + ⌘K/待办/通知/?exceptions= 交互实测）；最重六条引证已主控原文抽查坐实。数据区因走查时 Core 未启显示诚实失败态，属环境因素，不计入差距。

## 总判定：部分应用，非「完整」

- **ReUI Blocks（#386/#387）：达成**。ops 图表（ChartContainer/recharts + reui Timeline + metric-card）、⌘K 命令面板（交互测试真跳转）、通知中心、运营待办 Popover（退款计数同源有真证据）全部在浏览器实测工作；「blocks 只作形态参照未挂运行时」在 #386 台账有正式记录，不算降级。admin 面 heroui 清零（零豁免扫描门 + spike 标注隔离 + PROD notFound）、原生 `<select>` 清零。
- **壳层（surge 骨架）：达成**。骨架 tokens 与 surge 逐字一致（sticky header 50px / icon 侧栏 260px/62px / SidebarInset min-w-0 / color-mix accent），六域 NAV 单一真相 + paraglide 双语 + D1 改名、skip-link、DesktopRelayPage、主题切换在侧栏 Footer 均在。
- **两模板的页面模式：参差，多项承诺静默降级**。方案 §一「公共语言」9 项资产只落地 3 项（Frame/Badge/Timeline；PageHeader/useRouteSheet/RecordCrumb/nav-active 拷入但部分空转），**DataGrid 全家桶、Filters、RouteProgress、IconStack 从未拷入**（`src/components/reui/` 只有 badge/frame/timeline 三件，`@dnd-kit/*` 未装，RouteProgress 全仓零命中）。方案「落地状态」段自称「批次 A/B/C 全部落地并通过终验」与实态不符。

逐页判定（三 agent 一致口径）：audit 最忠实（tempo activity-timeline 全形态）；index/supply/tasks/views/redemptions/models/plans/templates/integrations/capabilities/refund-review/sensitive-words = 部分应用；**users 形态承诺未应用**（详情非路由驱动 Sheet）；**skills 三条核心承诺全空**；cloudflare 达成。

## BLOCK 级差距（全部主控或 agent 给出 file:line 证据）

1. **DataGrid/Filters 缺席的连锁**：所有「surge data-grid」承诺（users/redemptions/models/skills/supply 运行表/config-form）退化为裸 `<Table>` 或手写 facets。supply 运行表把 URL 驱动筛选与服务端分页两条硬语义保住了（`StateLink` 甚至强于模板），缺的是列头排序/列显隐/页大小等表格交互能力——「形态降级、语义无损」。但 `admin-config-form.tsx:465` 给普通 Table 手贴 `data-slot="data-grid"` 假槽位名，且 `admin-config-form.test.tsx:53` 的或运算断言（`data-grid|table`）结构上测不出这次替换，属形态注水。
2. **Sheet 下钻承诺全线落空，`useRouteSheet` 是死代码**（全仓唯一命中 = 定义自身 `use-route-sheet.ts:16`）：users 详情是组件内非受控 Sheet（`user-detail-viewer.tsx:415`，不可深链/后退键关不掉），无 `_list` pathless layout 无 `users.$userId` 路由；supply Reference→Sheet 三段式实为整页跳转（`supply-run-table.tsx:475`）；tasks 页无右栏/Sheet；skills 无 Sheet。
3. **skills 页三条核心承诺（DataGrid/治理 Timeline/Sheet）全部落空**且无任何测试或文档记录（`admin-skills-control.tsx:1044-1103` 裸表、全文无 timeline import）。
4. **plans 退役键仍可编辑**：`admin-plan-control.tsx:38-39` 仍含 `plan.trial.enabled`/`plan.addons`（即 admin-config-audit §2.9 点名的两行），Core 侧 `readOnlyKeys` 必拒 ⇒ 运营保存必遭 `INVALID_STATE`；且 `config_list` 投影无 `readOnly` 标志，现渲染成「未接线」= 换向错标而非承诺的只读呈现。「14 键行式化」实为 6 列裸表 + 下拉选择器（`isInlineConfigKey` 对 14 键无一命中，SettingField 恒 2 行）。
5. **refund-review 面板整块硬编码英文**与中文页头同屏混排（`admin-payment-refund-review.tsx:70-73` 及表头/空态/toast），面板标题即页头标题英译（#387 同类）。
6. **sensitive-words 删除仍走 `window.confirm`**（`admin-sensitive-words-control.tsx:363-371`）未走 ImpactReviewDialog——方案遗留⑤自认过，但 #388 拆页后它已是新页主删除路径，风险升级。
7. **`supply.views.$viewId` 缺 `useRecordCrumb`**（tasks 页有），深链时面包屑把上级「供给运行控制台」错标 `aria-current="page"` 且无回列表链接——正是 page-crumb 机制被造出来要消灭的 bug；整个面包屑机制零测试。
8. **结构性根因：模板形态承诺零测试背书**。「typecheck 0 错 / 1842 绿 / 逐页走查」护不住形态承诺（Table 与 DataGrid 在 typecheck 眼里都合法）；资产清单无门（9 项该搬的搬没搬没有任何断言知道）。本仓已知「测试背书假绿」模式复现。

## 正式改约 vs 静默降级

有台账记录（合规）：blocks 只作形态参照（#386）；config-form 换「shadcn 表格惯例+表单控件」（#387）；敏感词迁出 templates（#388）；recipe-studio 删除（#375）。
无任何记录（静默）：DataGrid/Filters/RouteProgress/IconStack 缺席；Sheet 全线落空；users `_list` 路由形态；models 整页编辑器（无 per-model 路由，`PageHeader` 未在编辑器消费）；plans 行式化。

## MINOR 汇总（择要）

- #387「同文重复」只修了 views 一处，同类还剩 4 处：`audit.tsx:76` vs `admin-audit-control.tsx:571`（同 message key）、`supply.tasks.$taskId.tsx:27-28` vs `supply-task-drilldown.tsx:112-115`、`refund-review.tsx:21-22` vs 面板英译、`sensitive-words.tsx:22-23` vs「违禁词库」。
- 硬编码文案远超遗留②声明的「/admin/skills 一处」：批次 A 组件层数百行中文（governed-actions 65 / supply-run-table 30 / sensitive-words 32 / overview 25 / exception-home 22）、批次 B 大量英文（admin-model-control 十余处）、`supply.views.$viewId.tsx:31-32` 页头中文模板串；CJK 门 `check-locale-keys.ts` 白名单不覆盖批次 C 新文件（新文件默认不设防）。
- 7 个 admin 路由靠 `[&_h2]` 后代选择器给裸标题补样式（Frame 语言只吃到容器层），capabilities/cloudflare 两处会穿透嵌套 FrameTitle。
- heroui 扫描门三处覆盖洞：`src/routes/admin.tsx` 兄弟文件不在扫描面；p1 非 `admin-` 前缀但被 admin 消费的模块不扫；`@heroui/theme` 子包不认。
- 通知中心 `unread` 恒真无已读机制；⌘K「recordable 实体」是导航项复制品（同目的地出现两行）；pending-actions 计数在目的页无对应显示（同源承诺对该行不成立）；侧栏收起态用户区裸 button 未处理（surge nav-user 的收起态没搬）。
- 同批次两套表格语汇并存：`data-table/*` 只有 users 用，其余全裸 Table。
- 方案 §二 六域成员列表已过期（refund-review/sensitive-words 加入、recipe-studio 退役），应回写文档而非改代码。
- 正面确认：无硬编码色值/裸调色板类；Frame 拷贝修掉了 surge 源里被切坏的 class（方案「拷前 diff」做到了）；users 服务端排序与角色升降、redemptions 幂等键重放测试属超承诺交付（但突破「只换表现层」自述，纪律上应单独记账）。

## 处置建议（2026-08-07 已拍板：采纳「改约」；决议全文与票号见方案 §五，票 #422–#428 已开）

1. **一个真决策**：DataGrid+Filters 补装（users/redemptions/models/skills/supply 一起收）vs 正式改约（把方案 §一/§三 的 data-grid 字样改成「data-table 语汇」）。RouteProgress/IconStack 同题。
2. **必开票**（不依赖上述决策）：plans 退役键只读（需 Core `config_list` 补 readOnly 投影 + 壳层禁编辑）；users 路由驱动详情 Sheet（或删 useRouteSheet 死代码并改约）；refund-review 面板 i18n；sensitive-words 删除改 ImpactReviewDialog；`supply.views.$viewId` 补 `useRecordCrumb`；「#387 同类同文」4 处合一票。
3. **文档更正**：方案「落地状态」（全部落地并通过终验 ≠ 实态）、遗留②（低报）④（已修过期）、§二 六域成员。
4. **护栏**：资产清单门（文件存在 + ≥1 消费者）；config-form 断言去或运算；heroui 扫描补三洞；CJK 门白名单机制改默认纳新。

——三路 agent 原始报告要点已合并于此；走查截图在会话 scratchpad `admin-walk/`（未入库）。
