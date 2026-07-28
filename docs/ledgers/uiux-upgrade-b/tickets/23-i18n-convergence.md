# 票 23 · i18n 双轨收敛：baseLocale=zh + 产品层文案统一
> 阶段: Phase 5 · 一致性与视觉收尾 ｜ 差距: P1-11 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "23",
  "decisionIds": [
    "DEC-PATH-B"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P1-11"
  ],
  "contractIds": [
    "I12"
  ],
  "blockedBy": [],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- P1-11 已部分核实：模板营销、认证与 settings 外壳使用 Paraglide，中国产品核心却另走硬编码中文；干净首访又因 `baseLocale=en` 优先落到英文外壳，形成两套文案事实源。
- 报告 §一根因④命中“模板贴功能、未完成产品化”：当前不是主导航全英文，而是产品层不可译、模板周边与局部菜单按 locale 变化。报告已更正：`dashboard_sidebar_*` 是无调用方孤儿 key，不得拿它们冒充主导航接线证据。
- 当前静态扫描仍复现报告数字：`mkfast-template-main/src/product` + `src/p1` 共 71 个文件，54 个含简体中文，Paraglide import 为 0；其中包含测试与非展示逻辑，实施范围只抽取真实用户可见文案，不翻译测试数据、协议值或内部标识。
- 目标是单一 Paraglide 文案轨：无 locale/cookie 的中国商家默认看到完整中文；主动切换 English 后，同一产品旅程完整显示英文，不再出现“外壳会切、业务区永远中文”。
- 范围守卫：不改变 D3“对话式外壳、结构化内核”，不重开 D4 的 3 选 1 单选，不恢复已 de-scope 的 L-1 贴链接抓取，不新增图片/视频模型跨品牌 Auto。

## 现状代码入口（实核 file:line）

| 入口 | 当前事实 |
| --- | --- |
| 默认语言 | `mkfast-template-main/project.inlang/settings.json:1-4` 仍为 `baseLocale: en`、`locales: [en, zh]`。报告行号未漂移。 |
| locale 决策顺序 | `mkfast-template-main/paraglide.config.ts:3-7` 仍为 `strategy: ['url', 'cookie', 'baseLocale']`；干净首访无 URL locale/cookie 时必回落英文。报告将该配置合并写成 settings，实际分属两个文件。 |
| 现有消息目录 | `mkfast-template-main/project.inlang/messages/en.json` 与 `zh.json` 当前各 733 个同名 key；`package.json:16-19,23` 已提供 sort/check/compile，底座无需重建。 |
| 产品层双轨 | 当前实扫 `src/product` + `src/p1` 仍为 71 文件、54 文件含中文、0 个 Paraglide import。典型入口 `src/product/unified-creation-workbench.tsx:487-539,573-675` 把面包屑、标题、状态、按钮、aria-label 与说明全部硬编码中文。 |
| 桌面/移动业务面 | `src/product/mobile-action-book.tsx:97-180` 进入独立移动旅程；`src/p1/model-settings.tsx:49-80,112-155` 将分区、状态、空值和 aria-label 写死中文。只改桌面工作台不能关闭本票。 |
| 主导航事实 | `src/lib/uiux/navigation.ts:4-11` 与 `src/config/sidebar-config.ts:43-68,70-120` 的业务、设置、管理导航均硬编码中文；主导航并未消费报告点名的 `dashboard_sidebar_*` key。 |
| 用户菜单混杂 | `src/components/layout/sidebar-user.tsx:1,50-54,125-176,178-209` 同一菜单同时渲染 `m.common_*` / `m.auth_common_logout()` 与“账户与设置/进入管理模式”等硬编码中文；在默认英文下可直接出现双轨。报告原锚点已因近期中文化改动发生漂移。 |
| 切换行为 | `src/components/layout/locale-switcher.tsx:38-59,72-104` 已能保留当前 path/query/hash、写 locale 并跳转，不需另造切换器；本票要验证产品层跟随它切换。 |
| 现有验收盲点 | `scripts/check-locale-keys.ts:13-50` 只检查 en/zh key 对称与非空；`tests/e2e/specs/protected-pages.spec.ts:31-63` 只证明中英路由能渲染，不证明产品文案没有混杂。 |

## 改造方案（步骤级 + 涉及文件清单）

1. 将 `project.inlang/settings.json` 的 `baseLocale` 改为 `zh`；保留 `url → cookie → baseLocale` 和 `en/zh` 双语言，使无偏好首访为中文、显式 `/en` 或 English cookie 仍可覆盖。
2. 在 `project.inlang/messages/{zh,en}.json` 建立产品命名空间，按工作台、任务、资产/内容、门店、设置/模型、管理与移动旅程分组；每个新增 key 同批提供中文与英文，不建立第二份 TS 文案字典。
3. 先收敛共享外壳：把 `BUSINESS_NAVIGATION`、settings/admin sidebar 与 `SidebarUser` 的用户可见硬编码改为消息函数；删除或复用确认无消费者的 `dashboard_sidebar_*` 孤儿 key，不能保留第三套导航词汇。
4. 再按真实路由迁移 `src/product` 与 `src/p1` 的运行时文案：标题、说明、按钮、表单标签、placeholder、空/加载/失败态、toast、Dialog、Badge、aria-label。视图模型保留稳定枚举/状态码，在渲染边界翻译，不能把中文/英文显示值写回 API、遥测或持久化事实。
5. 明确保留不翻译项：用户内容、模型/供应商正式名称、文件名、ID、路由、命令、审计原文与协议枚举；内部 `recorded-*` 标识由票 24 处理，不用“翻译”掩盖。
6. 处理变量、复数、时间与计数时使用 Paraglide 参数而非字符串拼接；同一概念只保留一个 key，统一 Work/Job/Asset/Content 的产品称谓，不借 i18n 重开术语或权限决策。
7. 复用现有 locale 切换器验证未登录首页/认证、登录后桌面/移动、settings/admin：切换后保持当前路由、query/hash 与登录态；刷新和新开页继续使用已选语言。
8. 扩展现有 locale key 检查与 protected-page 浏览器矩阵，使中英消息保持等键非空，并在核心旅程断言默认中文、English 无残留中文、切回中文无残留英文；这些只作工程护栏，不能替代截图验收。
9. 用干净浏览器重拍首访基线，再以同一账号、数据、视口逐屏复验工作台 → 任务 → 资产/内容 → 模型设置 → 用户菜单；桌面和移动均留中/英两套证据。

涉及文件（均为当前已存在路径）：

- locale 配置与词条：`mkfast-template-main/project.inlang/settings.json`、`project.inlang/messages/en.json`、`project.inlang/messages/zh.json`；`paraglide.config.ts` 保持策略不变，仅作行为核对。
- 共享外壳：`mkfast-template-main/src/lib/uiux/navigation.ts`、`src/config/sidebar-config.ts`、`src/components/layout/sidebar-user.tsx`、`src/components/layout/locale-switcher.tsx`（仅在现有切换行为无法保持路由状态时最小修改）。
- 产品运行面：`mkfast-template-main/src/product/`、`mkfast-template-main/src/p1/` 中实际渲染用户文案的现有 `.tsx/.ts` 文件；不得机械改写测试夹具、协议值或整目录格式。
- 工程护栏：`mkfast-template-main/scripts/check-locale-keys.ts`、`tests/e2e/specs/protected-pages.spec.ts`、`tests/e2e/specs/auth.spec.ts`；生成目录 `src/locale/paraglide` 只由现有 compile 脚本产生，不手改。
- 边界协同：票 04 负责品牌残留、`/ai` 与 starter 页去留；本票只统一仍保留页面的语言轨，不复活已裁撤页面或 demo。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 新用户在无 locale URL、无语言 cookie 的干净浏览器打开产品，首页/登录与进入后的工作台默认完整显示中文；不会先看到 English 壳、`Log out/Theme/language` 或英文默认错误再切中文。
- 中文默认态下，商家走通工作台、任务、资产库、内容库、门店、模型设置和用户菜单时，标题、导航、按钮、状态、空态、错误、toast 与弹窗均为统一中文；用户内容、模型名等专名不被误译。
- 商家从用户菜单切到 English 后停留在同一路由与同一业务对象，query/hash 和登录态不丢失；上述核心页面的业务区、外壳、用户菜单及反馈全部变为英文，不残留硬编码中文。
- 商家刷新 English 页面或新开同产品链接时继续看到英文；切回中文后同样保持当前上下文并持续中文，不发生语言来回闪烁或局部回退。
- 桌面与移动端显示同一 locale：移动行动簿、上传/发布入口、错误与恢复动作不会因独立组件树仍固定中文；窄屏切换后不出现截断到不可操作的主按钮。
- 在加载失败、无数据、无权限、生成失败和表单校验场景中，用户只看到当前语言的可理解产品文案；不会看到另一语言、原始状态码/JSON 或因缺 key 暴露消息 key 名。
- 截图对照：以同一桌面视口提交三联图——干净首访的升级前当前产品、升级后当前产品中文默认态、对标 `.scratch/creatok-uiux-wayfinding/assets/screenshots/01-dashboard-desktop-live.jpg`；图中标注导航、主标题、筛选/动作与用户菜单，升级后须达到对标产品的单一语言一致性，不再出现旧基线中的 `all` 等局部英文。
- 另附升级后用户菜单展开态的中文/English 同路由对照，以及同一路由移动中文截图；证据必须来自真实运行页面，静态词条表或测试报告不能关票。

## Blocked-by / Blocks

- Blocked-by：无。
- 全局关票闸：票 02 完成前本票不得关票；票 02 完成后，仍须将 P1-11 对应体验合同 required 条目与本票逐屏证据验绿。
- Blocks：无 MAP 明示下游阻断票。票 25 的中文字体栈与本票可并行收尾，但不能用字体修复冒充语言收敛。

## 风险与回退

- 风险：54 个含中文文件被机械全改，误伤测试数据、API 枚举、模型名或持久化事实。控制：只在渲染边界翻译，保留稳定 code/value；按路由小批迁移。回退按路由撤销消息接线，不改写用户数据。
- 风险：`baseLocale` 从 en 改 zh 会改变无前缀 URL、canonical/hreflang 与旧书签含义。控制：实测 `/`、`/en`、locale cookie、sitemap 与登录回跳；显式英文 URL 必须继续可达。异常时先保留显式 `/en`，不得恢复英文首访和混杂默认态。
- 风险：消息函数在模块初始化时求值，切换后静态导航不更新。控制：传 message accessor/semantic id，在渲染时取值；现有切换会导航重载，但不能依赖偶然缓存。回退为局部渲染适配，不复制 TS 文案表。
- 风险：前序票仍在修改工作台/结果/输入台，造成漏抽新文案或合并冲突。控制：Phase 5 收尾时按最终运行路由重新盘点，而非依赖 71/54 旧清单；漏项不以“绝大多数已迁移”关票。
- 风险：英文翻译生硬或改变 D3/D4 等已锁语义。控制：以中文产品术语为主事实逐项对译，专名不翻译；若英文覆盖未达标，临时回退为隐藏 English 入口并保持全中文单轨，禁止回退成可切换但业务区混杂。
