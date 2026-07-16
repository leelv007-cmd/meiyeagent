# UIUX 升级路径 B 待完成票行政收口

日期：2026-07-14

## 决定

按用户指示，旧 UIUX 升级路径 B 中仍处于待完成状态的票统一关闭，由新的产品调整接管后续规划。

本次关闭的范围：

- 机器治理票 04–25。
- 审计 frontier 票 27–33。
- 核心产品化票 35。

票 01–03、26、34 在本次决定前已经关闭，状态不变。

## 状态语义

本次关票统一使用 `status: closed` 与 `resolution: superseded`。它只表示旧执行集不再继续，不表示对应 Acceptance、真实供应商、竞品对标、真机或用户验收已经通过。

- 已交付代码、测试、截图和各票 Progress 记录全部保留，不做回滚。
- 尚未满足的验收项继续作为历史事实保留，不转写为完成。
- I01–I12 仍保持原有 pending/non-green 事实，不能因行政关票改写为全绿。
- 新调整必须建立新的决策或票据入口，并明确选择哪些旧成果继续沿用；不得静默重开旧票。

## 权威覆盖

从本决定起，以下文件中“04–25 仍 open”“27–33/35 为当前 frontier”的状态描述只代表本决定之前的审计快照：

- `.scratch/uiux-upgrade-b/MAP.md`
- `docs/evidence/uiux-upgrade-b/acceptance-report.md`
- `docs/reviews/historical-review-implementation-reconciliation-2026-07-14.md`
- `docs/reviews/references-docs-uiux-unfinished-upgrade-reconciliation-2026-07-14.md`

当前关票真相以 `.scratch/uiux-upgrade-b/decision-ticket-map.json`、各 ticket 元数据和本决定共同为准。
