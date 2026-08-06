# ReUI block sources for #386

Installed via `npx shadcn@latest add @reui/{chart-6,solution-ai-ops-1,app-shell-3,app-shell-7}`
(registry + REUI_LICENSE_KEY). Full raw demos were extracted then adapted into
production admin shell/ops components; demos are not typechecked in-tree.

Morph sources used:
- chart-6 + solution-ai-ops-1 → ChartContainer/recharts + ReUI Timeline in admin-operations-panels
- app-shell-7 system-stats → admin-operations-todo-popover
- app-shell-3 search-form + notifications-popover → admin-command-palette + admin-notifications-popover
