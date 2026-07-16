# CreatOK 内置浏览器完整走测报告

| 字段 | 值 |
|---|---|
| 日期 | 2026-07-13 |
| 应用地址 | `http://127.0.0.1:3000` |
| 会话 | `meiye-browser-dogfood-2026-07-13` |
| 范围 | 公开页、认证、核心创作、运营/资产、设置/管理、移动端与控制台错误 |

## 汇总

| 严重度 | 数量 |
|---|---:|
| Critical | 0 |
| High | 1 |
| Medium | 0 |
| Low | 1 |
| **总计** | **2** |

## 问题

### ISSUE-001：产品壳的语言状态不一致

- 严重度：Low
- 状态：修复中
- 范围：账户设置、用户菜单、侧栏辅助文本、历史投影入口
- 复现：默认英文 locale 打开 `/dashboard` 与 `/settings/account`。核心业务区仍为中文，账户卡片与用户菜单为英文；切换 `/zh/...` 后，侧栏按钮辅助文本仍显示 `Toggle Sidebar`，Logo 辅助文本仍显示 `TanStarter Demo logo`。
- 影响：locale 不能覆盖完整产品壳，读屏和英文路径会呈现混合语言。
- 证据：`screenshots/issue-001-mixed-language-settings.png`
- 预期：中文路径使用完整中文文案与 CreatOK 品牌辅助文本；默认产品路径不出现中英混杂。

### ISSUE-002：E2E fixture 模式下全部模型仍被判定为不可用

- 严重度：High
- 状态：修复中
- 范围：模型目录、统一输入台、Generation Job 主链路
- 复现：以 `APP_ENV=e2e MODEL_EXECUTION_MODE=fixture` 启动 Core/Worker，打开 `/zh/settings/models`；所有 fixture deployment 均显示“暂不可用 / 尚未完成可用性验证”，工作台的 `提交 Generation Job` 永久禁用。
- 影响：仓库声明的本地 fixture 走测模式无法运行 Job → Asset → Content 主链路，浏览器回归和现有 E2E 合同相互矛盾。
- 证据：`screenshots/issue-002-fixture-models-unavailable.png`
- 预期：fixture 仅在 `APP_ENV=e2e` 下可提交，并明确标识为本地测试可用；不得伪装为生产 `live_verified`。

走测仍在进行；新增问题会继续补充证据、修复状态和回归结果。
