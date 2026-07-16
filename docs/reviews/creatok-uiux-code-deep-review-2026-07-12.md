# CreatOK UI/UX 代码深度审查报告

**审查日期**：2026-07-12
**审查方法**：Workflow 多 agent 并行审查（9 agent，55.7 万 token，332 次工具调用，7 分钟）
**审查范围**：`mkfast-template-main/src/` 全部 422 个源文件、19 个 E2E 规格、28 个单元测试文件、全套交接文档与验收矩阵
**基线文档**：
- UI/UX 实施交接规格: `.scratch/creatok-uiux-wayfinding/assets/13-uiux-implementation-handoff.md`
- 总验收矩阵: `.scratch/creatok-uiux-wayfinding/assets/13-uiux-acceptance-matrix.md`
- 六阶段实施票包: `.scratch/creatok-uiux-wayfinding/assets/13-uiux-six-ticket-pack.md`
- 六阶段 tracker: `.scratch/creatok-uiux-implementation/map.md`
- S0-S5 票: `.scratch/creatok-uiux-implementation/issues/`

---

## 一、当前代码基线评估

### 1.1 整体健康状况

| 指标 | 数值 |
|------|------|
| 非测试 TSX/TS 源文件数 | 422 |
| 非测试代码总行数 | 53,413 |
| 测试代码行数（28 个文件） | 2,816 |
| Web 单元测试数 | 74（全部通过） |
| Core 单元测试数 | 347（全部通过） |
| E2E 规格文件数 | 19 |
| 最大单文件 | `integration-settings.tsx`（1,958 行） |
| TypeCheck | 通过，零错误 |
| Production Build | 通过（12.68s） |

### 1.2 交接文档中关于代码基线的声明——事实核查

交接文档声称当前 Web 存在 **"约 10,450 行 P1 TSX 被塞在本地 Tabs 与双工作台中"**。逐项核验如下：

**"约10,450行 P1 TSX"——部分准确，计量偏低。**
P1 模块实际为 11,929 行（37 个文件），而非 ~10,450。更关键的偏差在于：这 11,929 行并非全是被塞在问题架构中的垃圾代码。其中大量是架构质量较好的 view-model 分离代码（如 `settings-view-model.ts` 842 行、`admin-view-model.ts` 685 行、`operations-view-model.ts` 等），类型严谨、Port/Adapter 接缝干净。

**"被塞在本地 Tabs"——不准确。**
当前代码中不存在通过 `useState('activeTab')` 或 hash fragment 切换的"本地 Tab"模式。唯一使用 `<Tabs>` 组件的地方是：
- `mobile-action-book.tsx`：移动端展示 action/progress/handoff 三个阶段的正常 Tabs 模式
- `data-table.tsx`：演示仪表板的 demo Tab，属于 MkSaaS 模板残留
- `integration-settings.tsx`：连接类型 Tab 切换（功能合理）

`UnifiedCreationWorkbench` 使用 `useState<'agent' | 'direct'>` 做模式 toggle，这是 Composer 内部状态，不是本地导航 Tab。

**"双工作台中"——存在但表述过重。**
当前确实存在单体化问题：`UnifiedCreationWorkbench`（1,147 行）在一个组件内处理创作输入、模型选择、报价、Job 提交、结果渲染等全部逻辑。但它并不是"两个工作台"，而是一个未拆分的单体工作台 + 独立的路由化子页面（tasks、assets、content、leads、store）。真正的问题是**架构做对了路由分离，但主创作面未拆解**。

**"operations-workbench.tsx（约2009行）"——根本不存在。**
交接文档组件复用表中引用了一个不存在的文件。当前不存在名为 `operations-workbench.tsx` 的文件。最近似的是 `operations-task-page.tsx`（427 行）+ `operations-rail.tsx`（108 行）。

### 1.3 做得好的部分——值得复用

| 资产 | 文件 | 质量判断 |
|------|------|----------|
| Shell 模式基础设施 | `sidebar-layout.tsx`、`sidebar-main.tsx`、`dashboard-sidebar.tsx` | **A 级**。ProductShell/SettingsShell/AdminShell 三种组合模式已正确实现，skip-link、响应式侧栏、移动 Nav 全部就位 |
| 六项业务导航 | `lib/uiux/navigation.ts` + `config/sidebar-config.ts` | **A 级**。六项导航定义清晰，图标映射完整，旧路由重定向表已建立 |
| 路由常量表 | `lib/routes.ts` | **A 级**。所有 canonical 路由集中定义，类型安全 |
| 状态投影组件 | `components/uiux/state-panel.tsx`、`product-status.tsx`、`object-evidence.tsx` | **A 级**。loading/empty/error/unknown/permission-denied 五态标准化，ARIA 属性正确 |
| 规范化状态投影 | `lib/uiux/status.ts`、`lib/uiux/navigation.ts` | **A 级**。返回锚点解析、旧路由重定向、可信来源验证——都已实现并有测试 |
| 稳定提交保障 | `lib/stable-submission-attempt.ts` | **A 级**。幂等提交保障机制 + 测试 |
| 产品遥测 | `lib/product-telemetry.ts` | **B+ 级**。redirect/skip/event 三层埋点已就位 |
| 数据表组件套件 | `components/data-table/` | **B+ 级**。15 个文件的成熟 data-table 系统（TanStack Table + shadcn），可复用 |
| Polotno 画布集成 | `p1/polotno-canvas-runtime.tsx` | **B+ 级**。317 行，懒加载、许可证门禁、导出标签已实现 |
| Base UI/shadcn 组件 | `components/ui/` 54 个文件 | **B 级**。成熟组件库，但大量 MkSaaS 通用组件对美业内容簿是多余的 |

### 1.4 问题部分——必须替换

| 问题 | 文件 | 严重程度 | 说明 |
|------|------|----------|------|
| 超大连接设置页 | `p1/integration-settings.tsx` | **P0** | 1,958 行单体组件。包含 BYOK、连接管理、飞书工具控制、通知设置等互不相关的领域。交接文档要求拆分为 models/connections/account 三块——拆分不可避免 |
| 超大管理模型控制 | `p1/admin-model-control.tsx` | **P0** | 1,650 行，包含目录管理、deployment 激活、模型治理的全部逻辑。需保留业务控件但重构呈现 |
| 单体创作工作台 | `product/unified-creation-workbench.tsx` | **P0** | 1,147 行包含冷启动、Agent/Direct 模式、模型选择、报价、Job 提交、结果渲染——全部在一个组件内。S2 要将其解构为 Composer + Session routing + Job detail views |
| 超大行动手册 | `product/mobile-action-book.tsx` | **P1** | 975 行移动端页面，需按 S4 的掌心行动簿设计分解 |
| Stripe/Creem 支付代码 | `payment/provider/stripe.ts`（1,209 行）、`creem.ts`（921 行） | **P2** | MkSaaS 通用模板代码。需保留支付动作但替换为产出量语言 |
| MkSaaS 营销页面残留 | `routes/(pages)/`、`components/blocks/`、`routes/(legals)/` | **P2** | about/ai/pricing/contact/waitlist/blog/changelog/roadmap 等页面对美业工作台是多余的，但可保留作为公开营销壳 |
| 旧 AI 示例页 | `components/ai/` 8 个文件 | **P2** | Fal/CF image/tagline/tts 等 demo 卡，不应成为产品切换面 |
| `settings-view-model.ts` | `p1/settings-view-model.ts` | **P1** | 842 行，需复核 `recorded/configured` 是否映射为用户"可用"——当前规范要求未激活 Deployment 不得提交 |

### 1.5 架构债务清单

| 债务 | 说明 | 影响阶段 |
|------|------|----------|
| **路由表已分离但一致性未验证** | `lib/routes.ts` 定义了所有 canonical 路由，但部分路由的 owning 页面仍是占位符（如 `dashboard/jobs.tsx` 仅 10 行） | S1 |
| **旧 settings 路由碎片化** | 13 个 settings 子路由（profile/security/billing/credits/files/apikeys 等），交接要求合并为 3 个（account/models/connections） | S4 |
| **admin 路由通过 `admin-control-plane.tsx` 历史入口** | 旧 `/admin/p1` 重定向已处理，但 admin 子路由的组件仍是占位符 | S4 |
| **MkSaaS 模板影响分析** | ~30-40% 的文件（营销页、支付、邮件、newsletter、AI demo 等）与 CreatOK 工作台无关，增加构建体积和认知负担 | S5 |
| **Polotno 未生产授权** | 画布组件就位但公开生产须付费授权 | S3 |
| **无 tree-shaking 证据** | 构建输出中 `polotno-canvas-runtime` 4.45MB、`routes` 2.83MB——需验证真正路由级懒加载生效 | S0/S5 |

---

## 二、S0 基线冻结就绪度

### 2.1 总体判断：**部分就绪，需 3-5 天补全**

当前代码库对于 S0 冻结**并非从零开始**——大量 S0 的前提条件已经以某种形式存在，但缺乏系统性的基线证据。

### 2.2 已具备的部分

| S0 要求 | 状态 | 证据 |
|---------|------|------|
| git commit 标识 | 就绪 | 当前代码在版本控制中 |
| Web 构建可部署 | **就绪** | `pnpm build` 通过，12.68s |
| Web 测试 script 存在 | **就绪** | `"test": "tsx --test 'src/**/*.test.ts'"` 已声明且可运行，74 个测试通过 |
| TypeCheck 通过 | **就绪** | 零错误 |
| E2E 基础设施 | 就绪 | 19 个 spec 文件 + Playwright 配置 |
| 迁移骨架概念 | 就绪 | Core 已有 `postgres-schema-migration.ts` + additive schema 实践 |
| 旧路由重定向表 | **就绪** | `lib/uiux/navigation.ts` 的 `legacyRedirects` Map 已定义 16 条旧→新映射 |

### 2.3 缺失项

| S0 要求 | 状态 | 缺口 |
|---------|------|------|
| `pnpm check`（Biome lint）基线 | **缺失** | 未运行或未记录结果。需执行并分类既有 warning vs 新引入 |
| `pnpm e2e` 实际通过基线 | **缺失** | E2E 需真实运行环境（local D1 + dev server）。未确认全部 19 个 spec 可通过 |
| Web Vitals 基线（LCP/INP/CLS） | **缺失** | 无 lab 数据，无 RUM 配置。`web-vitals-reporter.tsx` 存在但未经校准 |
| axe 无障碍扫描基线 | **缺失** | `@axe-core/playwright` 已安装但无自动化扫描脚本或证据 |
| 键盘导航旅程证据 | **缺失** | 无键盘 E2E 测试或手动走查记录 |
| 200% 缩放验证 | **缺失** | 交接文档将其列为 QG-03 必修项，零证据 |
| Bundle 分析报告 | **缺失** | 构建输出已知（polotno 4.45MB 等），但无正式预算对比报告 |
| 秘密/PII 扫描 | **缺失** | 无自动化密钥/用户内容扫描 |
| 迁移 dry-run 骨架 | **缺失** | S0 要求实现迁移 dry-run+对账报告骨架，当前无对应代码 |
| Pre-cutover 构建部署验证 | **缺失** | 需在真实 Cloudflare 环境验证构建可部署 |
| 阶段记录模板 | **缺失** | 无标准化的阶段证据模板 |
| 回滚 runbook 骨架 | **缺失** | S0 要求切换/回滚/观察 runbook 骨架 |

### 2.4 具体阻塞项

1. **E2E 基线必须真实运行**：19 个 spec 中有 `uiux-precutover-baseline.spec.ts`——这个文件本身应成为 S0 的基线证据，但必须先验证它真实通过。
2. **Web Vitals 基线缺失意味着 G04 验收无法开始**：没有基线就无法设置性能预算，也无法在 S5 验收时证明并未劣化。
3. **axe 扫描缺失意味着 G02 无障碍验收从 S0 起就无基础**：每阶段都应对比 axe 回归，但连基线都没有。
4. **文档一致性审查报告指出 `package.json` 未声明 test script——此事实已过时**。test script 存在且可运行。但该错误信息出现在多份评审文档中，应由 S0 显式纠正并归档。

---

## 三、逐阶段差距分析（S1-S5）

### S1 · 重建产品壳、稳定路由与共享状态合同

**当前状态 vs 要求状态**：当前代码库在 S1 方面是**最成熟的**。大量基础设施已经就位：
- 六项业务导航（`BUSINESS_NAVIGATION`）已定义，与交接要求完全一致
- `SidebarLayout` + 三种 Shell 模式（ProductShell/SettingsShell/AdminShell）已实现
- 路由常量表集中定义在 `lib/routes.ts`
- 旧路由重定向表已建立（`legacyRedirects` Map）
- Skip-link 已实现
- 角色概念存在（`use-auth.ts`、`auth-middleware.ts`）

**差距**：

| 交付物 | 状态 | 需创建/修改的文件 |
|--------|------|-------------------|
| Canonical 路由完全稳定 | 需修改 | `routes/dashboard/jobs.tsx`（10行占位符→完整实现）、`routes/dashboard/sessions.tsx`（10行占位符→新增） |
| 设计 token 独立美业品牌 | 需创建 | 新 `src/config/theme.ts`（颜色、字体、圆角、动效、reduced-motion） |
| 200% 缩放修复 | 需修改 | `sidebar-layout.tsx`、`sidebar.tsx` 的 CSS 变量确保 body 不裁切 |
| 对比度修复 | 需修改 | 工具/模板面的 muted 文本颜色 |
| 角色能力矩阵前后端一致 | 需创建 | 新 `src/lib/auth/role-matrix.ts` + 对应服务端守卫 |
| 旧双工作台入口停用 | 需验证 | `dashboard/index.tsx` 已不渲染双工作台，需确认无隐藏入口 |
| Tabler icon wrapper | **已就绪** | `product-icon.tsx` 已实现 |
| 规范化状态投影 | **已就绪** | `state-panel.tsx`、`product-status.tsx` 已实现 |

**可复用代码**：Shell 基础设施（sidebar-layout/sidebar-main/dashboard-sidebar）几乎可直接使用。sidebar-config 已正确定义三种模式的导航项。

**风险**：S1 依赖最少，风险最低。主要风险是设计 token 迁移可能影响现有组件样式——但当前样式本就是要被替换的。

---

### S2 · 交付冷启动与统一核心创作闭环

**当前状态 vs 要求状态**：这是**差距最大的阶段**。当前 `UnifiedCreationWorkbench` 是一个 1,147 行的单体组件，需要被重建为：
- 冷启动流程（一句话开工 + skip）
- Agent 创作记录（非气泡式连续记录）
- 统一 Composer（Agent/Direct 双模式共享草稿和 Job）
- 显式模型选择/规格/报价

**差距**：

| 交付物 | 当前 | 需创建/修改 |
|--------|------|-------------|
| 冷启动 | 有基本骨架（`showOnboarding` state + `onboardingDismissed`），但不完整 | 重写 `UnifiedCreationWorkbench` 的冷启动部分，增加 skip 逻辑和分层事件 |
| Agent 创作记录 | **不存在** | 全新 `src/product/agent-composer.tsx`，需实现非气泡式记录、引用嵌入、执行合同 |
| 统一 Composer | `UnifiedCreationWorkbench` 的 `mode` toggle 过于简陋 | 需拆分为 Composer shell + Session context + inline direct mode |
| 多模态输入 | 仅支持文本 textarea | 需增加图片/视频/链接粘贴、Uppy 上传、引用选择 |
| Work/Job/Asset/Content 生命周期 | 部分存在（`product/` 下各 model） | 需在 S2 验证 E0/E1 完整链路，补充 recoverable/unknown/failed 分支 UI |
| 模型不可用/报价变化 | `quoteFor()` 函数有基本逻辑 | 需完善 UI 分支：不可用禁止提交、报价变化需确认 |
| `/dashboard/sessions/:sessionId` 路由 | 占位符（10 行） | 完整实现 |
| `/dashboard/works/:workId` 路由 | 占位符（10 行） | 完整实现 |
| `/dashboard/jobs/:jobId` 路由 | 占位符（10 行） | 完整实现 |

**可复用代码**：
- `quoteFor()` 和 `formatQuote()` 报价逻辑可复用
- `createWorkbenchProjection` 的 Query Key 和 API 调用模式可复用
- `ModelOption` 和 `CatalogModelView` 的模型渲染逻辑可复用
- `StableSubmissionAttempt` 幂等提交机制可直接使用
- `state-panel.tsx` 五态投影可幅射到所有异步流程

**风险**：S2 是整个重构的核心。Agent 创作记录没有参考实现，原型只是静态 HTML。Composer 的交互复杂度可能超出预期。建议在 S2 中先完成 Composer 核心交互的最小骨架再叠加功能。

---

### S3 · 交付运营、模板工具与资产历史闭环

**当前状态 vs 要求状态**：此阶段有大量**可复用代码**，主要工作是重组而非重建。

**差距**：

| 交付物 | 当前 | 需创建/修改 |
|--------|------|-------------|
| 右栏运营上下文 | `operations-rail.tsx`（108 行）有基本结构 | 扩展为下一行动 + 五点周条 + 异常摘要 |
| 任务收件箱 | `content-task-inbox.tsx`（430 行）功能较完整 | 主要修路由化和状态正确性 |
| 五点周条 | `compact-week-strip.tsx`（82 行）存在 | 修 `weekly_review undefined` 和七日漂移问题 |
| 周运营回顾 | `weekly-operations.tsx`（270 行）存在 | 修复既有问题 |
| 模板目录 | `template-catalog.tsx`（551 行）存在 | 新增 ⌘K 同一目录、参考解构台局部模式 |
| 上下文创作货架 | `creation-shelf.tsx`（586 行）存在 | 适配为 Agent 内货架模式 |
| Polotno 画布 | `polotno-canvas*.tsx` 就位 | 路由懒加载 + 生产许可证门禁验证 |
| Asset/Content 历史 | `canonical-history-page.tsx`（420 行）、`canonical-history-model.ts` | 需增加 Recent 聚合和深链 |
| 搜索 | `retrieval-search.tsx` 存在 | 需适配新投影 |

**可复用代码**：S3 是整个项目中复用率最高的阶段。`content-task-inbox`、`compact-week-strip`、`weekly-operations`、`template-catalog`、`creation-shelf`、`polotno-canvas*` 均可直接复用核心逻辑，只需要修改路由绑定和 UI 壳层。

**风险**：
- 既有 bug（weekly_review undefined）的修复需做回归测试
- ⌘K 目录与参考解构是新的交互模式，无现有代码可借鉴
- Polotno 生产许可未满足时需隐藏功能——门禁逻辑需正确

---

### S4 · 交付移动发布、设置管理与套餐壳层

**当前状态 vs 要求状态**：

**差距**：

| 交付物 | 当前 | 需创建/修改 |
|--------|------|-------------|
| 掌心行动簿（移动端） | `mobile-action-book.tsx`（975 行）功能较完整 | 重构为"掌心行动簿"交互模式，拆解为更小的可组合模块 |
| 可恢复上传 | `mobile-upload-session.ts` + `pwa/camera-capture-proof.tsx` 存在 | 验证端到端中断续传 |
| L1/L3 发布 | `routes/dashboard/handoff/$token.tsx`（383 行）存在 | 收紧认证/来源/状态语言 |
| 设置合并 | 13 个子路由 → 3 个（account/models/connections） | 大规模路由删减 + 重定向 |
| BYOK 归模型设置 | `integration-settings.tsx` 的 BYOK 部分 | 拆分 integration-settings.tsx（1,958 行） |
| 套餐页重构 | `product/account-usage*` + `pricing/` 组件 | 积分/credit/token → 产出量语言 |
| 管理模式 | `admin/model-control.tsx`（1,650 行）+ `admin/template-control.tsx`（653 行） | 保留业务控件，替换 `window.confirm`，增加 diff/范围/原因 |
| 四层权限矩阵 | 部分存在（auth-middleware） | 显式实现 Platform Admin/Workspace Owner/Operator/Reviewer |

**风险**：
- `integration-settings.tsx` 拆分是最大单体手术（1,958 行拆为 3-4 个模块）
- 设置路由从 13 合并到 3 影响范围大，重定向表必须完整
- 移动端双端接力需要真实设备验证

---

### S5 · 执行总验收、一次性切换与加强观察

**当前状态**：全部待定。S5 是纯流程和验证阶段，不新增产品能力。但它的成功完全取决于 S0-S4 的完成质量。

**差距**：所有 34 项 required 验收 + 回滚演练 + 切换 runbook + 24 小时观察方案均待 S0-S4 完成后才可执行。

---

## 四、关键问题清单

### P0 级别（阻塞 S0 启动或影响架构正确性）

| 编号 | 阶段 | 描述 | 文件 | 修复方案 | 预估工时 |
|------|------|------|------|----------|----------|
| **P0-1** | S0 | 交接文档声称 `operations-workbench.tsx (~2009行)` 存在但代码库中无此文件。组件复用表和路由改动表的多项引用基于该不存在的文件。 | 不存在 | 更新交接文档组件复用表，以实际存在的文件（`operations-task-page.tsx` 427行、`operations-rail.tsx` 108行）为基准重写阶段规划 | 4h（文档修正） |
| **P0-2** | S0 | 文档一致性审查报告声称 `package.json` 无 test script——事实错误。`"test": "tsx --test 'src/**/*.test.ts'"` 已存在且可运行。该错误信息出现在 `doc-consistency-audit-2026-07-12.md` 和 `p1-document-consistency-review-2026-07-11.md` 中 | `package.json` | 更新文档记录，在 S0 中运行并归档 test 基线 | 2h |
| **P0-3** | S0 | E2E 基线从未被验证可全部通过。19 个 spec 中有 `uiux-precutover-baseline.spec.ts` 专项但无通过记录 | `tests/e2e/specs/` | 在本地环境运行全部 E2E，修复失败项，归档基线计数 | 8h |
| **P0-4** | S0 | Web Vitals/axe/键盘/缩放基线全部缺失。无基线则 S5 验收无法对比劣化 | 新建 `scripts/` + E2E 补充 | 增加 axe 自动化扫描到 Playwright、实现 lab Web Vitals 采集、增加键盘旅程测试 | 12h |
| **P0-5** | S2 | 当前 `UnifiedCreationWorkbench`（1,147行）被标记为 Agent 模式但无真实 Agent 创作记录结构。仅靠 `mode` state toggle 切换 Agent/Direct 两种模式，交互未差异化 | `product/unified-creation-workbench.tsx` | S2 重写为真正的 Composer + Session 路由化架构 | 包含在 S2 整体工时中 |
| **P0-6** | S4 | `integration-settings.tsx`（1,958行）单体组件无法直接拆分。BYOK、MCP连接、飞书工具、通知设置混合在一起 | `p1/integration-settings.tsx` | 按 owning context 拆分为：BYOK→models module、连接管理→connections module、通知→移除或归入设置 | 16h |

### P1 级别（影响用户体验或阶段依赖）

| 编号 | 阶段 | 描述 | 文件 | 修复方案 | 预估工时 |
|------|------|------|------|----------|----------|
| **P1-1** | S1 | 设计 token 未落实美业独立品牌。当前使用 MkSaaS 默认样式（Bricolage Grotesque 字体、通用暗色主题） | `styles.css`、`custom.css` | 创建独立美业 token 集（配色、字体、圆角、密度、动效） | 8h |
| **P1-2** | S3 | `compact-week-strip.tsx` 的 `weekly_review undefined` bug 及七日漂移问题 | `p1/compact-week-strip.tsx`、`p1/weekly-operations.tsx` | 修复 + 回归测试 | 6h |
| **P1-3** | S3 | Polotno 生产许可证未满足时须隐藏功能 | `p1/polotno-license.ts` + `p1/polotno-canvas-runtime.tsx` | 实现公开启用门槛检查 | 4h |
| **P1-4** | S4 | `settings-view-model.ts` 的 `recorded/configured` 到"可用"的映射需复核。未激活 Deployment 不得提交 | `p1/settings-view-model.ts` | 增加 deployment `active + live_verified` 检查 | 4h |
| **P1-5** | S4 | `admin-model-control.tsx`（1,650行）和 `admin-template-control.tsx`（653行）中的 `window.confirm` 需替换 | `p1/admin-model-control.tsx`、`p1/admin-template-control.tsx` | 替换为 shadcn AlertDialog + impact-review-dialog | 8h |
| **P1-6** | S4 | 设置路由从 13 合并到 3，需完整重定向链 | `lib/routes.ts`、`lib/uiux/navigation.ts` | 扩展 legacyRedirects，增加路由级 beforeLoad 重定向 | 6h |

### P2 级别（优化和改进）

| 编号 | 阶段 | 描述 | 文件 | 修复方案 | 预估工时 |
|------|------|------|------|----------|----------|
| **P2-1** | S5 | MkSaaS 模板残留文件（营销页、AI demo、changelog 等）增加构建体积和认知负担 | `routes/(pages)/`、`components/ai/`、`components/blocks/` | S5 切换后评估是否清理。暂不阻塞开发 | 8h |
| **P2-2** | S4 | Stripe/Creem 支付代码中的积分/token/credit 术语需替换为产出量 | `payment/provider/stripe.ts`、`creem.ts` | 文案替换 + 定价组件重构 | 4h |
| **P2-3** | S1 | 点击目标基线（桌面 24px、移动 44px）需修复 | 多个 UI 组件 | CSS 修复 + axe target-size 验证 | 4h |
| **P2-4** | S0 | 无秘密/PII 扫描集成 | 新建 | 集成 truffleHog 或 git-secrets 到 pre-commit/CI | 4h |
| **P2-5** | S5 | 构建输出中 Polotno 4.45MB 需验证 tree-shaking 和路由级懒加载 | `vite.config.ts` | 确认 `lazy()` 路由分割生效 | 2h |

---

## 五、实施可行性评估

### 5.1 方案能否按设计执行

**可以，但有重要前提。**

核心判断：六阶段计划的设计本身是严谨的。串行依赖关系合理，每阶段门前验收门槛明确。但以下现实问题需要承认：

1. **S1 的实际工作量被低估了**。交接文档认为 S1 是从零建壳，但事实上壳层基础设施已经就位（三种 Shell 模式、skip-link、六项导航、路由常量表、旧路由重定向）。S1 的主要工作是：创建设计 token 系统、200% 缩放修复、对比度修复、角色能力矩阵、验证路由完整性——这大约是一周的工作，而非需要从零搭建的大工程。

2. **S2 的实际工作量被低估了**。Agent 创作记录和统一 Composer 是这个项目最复杂的交互，原型是静态 HTML。从静态原型到生产级交互的差距可能很大——消息流、引用嵌入、流式响应、错误恢复等都需要扎实的工程投入。

3. **S3 是复用率最高的阶段**——大量 P1 组件可直接迁移。这是有利因素。

4. **S4 的 `integration-settings.tsx` 拆分是隐藏的大工程**。1,958 行的单体组件拆分为 3-4 个独立模块需要仔细规划。

### 5.2 时间线估算

| 阶段 | 乐观估算 | 务实估算 | 依据 |
|------|----------|----------|------|
| S0 | 3 天 | 5 天 | E2E 基线修复 + Web Vitals/axe 管道搭建是主要变量 |
| S1 | 3 天 | 5 天 | 设计 token + 缩放/对比度修复工作量适中 |
| S2 | 7 天 | 12 天 | 最大不确定性：Agent Composer 交互复杂度 |
| S3 | 5 天 | 7 天 | 高复用率，主要工作是集成和路由化 |
| S4 | 6 天 | 10 天 | integration-settings 拆分 + 设置路由合并是最大变量 |
| S5 | 3 天 | 5 天 | 全量回归 + 回滚演练 + 观察期 |
| **总计** | **27 天** | **44 天（~9 周）** | |

### 5.3 依赖与资源风险

1. **串行阻塞风险**：虽然决策 15 选择了严格串行，但 S3 的大部分工作（模板/任务/资产迁移）不依赖于 S2 的 Composer 细节。可以考虑在 S2 进行到 Composer shell 稳定后，提前启动 S3 的独立模块工作。前提是不违反"不修改 owning production files"规则。

2. **Core API 依赖风险**：UI/UX 重构假设 Core API 是稳定的。但当前 Core 的 Model Supply 和 Composed Video 仍使用 `Recorded*` adapter（假实现）。在真实模型接通的 UI 工作可能与 fake adapter 假设不匹配。

3. **单人开发风险**：六阶段串行意味着大部分时间是单线程推进。如果开发资源只有一人，44 天务实估算隐含了零并行度。

### 5.4 交接文档做得对的地方

- 六阶段依赖顺序逻辑清晰
- 不可缩减用户结果列表准确
- Canonical 路由改动表详尽
- 数据与服务依赖表务实（明确了缺失时的处理方式）
- 验收矩阵（34 项 required + waivable）覆盖全面
- 原型质量必修清单（8 项）明确

### 5.5 交接文档遗漏的地方

- `operations-workbench.tsx` 引用了一个不存在的文件——组件复用表需要重写
- 对当前代码基线的评估（10,450 行 P1 TSX 被塞在本地 Tabs 中）不完全符合实际
- 没有提到 MkSaaS 模板代码中有多少是可以直接删除的（~30-40% 的文件与 CreatOK 工作台无关）
- 没有提到 P1 代码的实际质量水平——大量代码是架构良好的 view-model 分离模式
- 没有提供 S2 Agent Composer 的详细交互规格（当前仅依赖静态原型）
- 没有评估 200% 缩放修复和对比度修复的实际代码改动量

---

## 六、优化建议

### 6.1 架构改进（启动前）

1. **在 S0 中增加一次代码库分组盘点**：将 422 个源文件分为四类：
   - **保留复用**（Shell、导航、状态投影、数据表、Polotno、路由定义、稳定提交）——约 30%
   - **保留但重构**（UnifiedCreationWorkbench、IntegrationSettings、AdminControl 等单体组件）——约 25%
   - **保留作为营销壳**（营销页、blog、legal、pricing 公开页）——约 20%
   - **可删除/退役**（旧 AI demo 页、MkSaaS 残留组件、未使用的 UI 组件）——约 25%

2. **在 S1 前建立 Component Storybook 或目录**：为所有可复用组件建立索引，使 S2-S4 能快速定位和复用。

3. **将设计 token 提取为独立模块**：在 S1 创建 `src/config/theme.ts` 作为唯一真值来源，所有颜色/字体/密度/动效从该文件引用。

### 6.2 代码重组建议

1. **`p1/` 目录过载**：37 个文件包含 view-model、service、UI 组件、类型定义杂糅。建议按领域进一步分层：
   - `p1/models/` —— model-supply 相关
   - `p1/operations/` —— task/inbox/weekly 相关
   - `p1/templates/` —— 模板相关
   - `p1/admin/` —— 管理相关
   - `p1/settings/` —— 设置相关

2. **`product/` 目录应严格只放产品级组合组件**：当前 `product/` 下的 `creation-shelf.tsx`（586 行）和 `unified-creation-workbench.tsx`（1,147 行）混合了业务逻辑和 UI。将业务逻辑提取到 `p1/`，`product/` 只做路由级组合和布局。

3. **将 `integration-settings.tsx` 拆分提前到 S0 规划**：不需要在 S0 执行拆分，但应该在 S0 确定拆分边界和 owning 模块。

### 6.3 测试基础设施优先级

1. **S0 必须完成**：
   - `pnpm test` 覆盖所有 Web 测试（已完成，需验证）
   - `pnpm e2e` 全部通过（需验证/修复）
   - axe-core 扫描集成到 Playwright（新工具已安装，只需脚本）
   - Web Vitals lab 采集脚本（可使用 Lighthouse CI 或手动 Playwright tracing）

2. **S1-S4 每阶段增加**：
   - 新路由的 deep-link + 刷新测试
   - 新组件的单元测试
   - 键盘导航 E2E（至少主旅程）
   - axe 回归扫描（对比 S0 基线）

3. **真实设备测试不要求**：交接文档已明确取消真实用户测试。但移动端双端接力至少需在 Playwright 的移动 viewport 下验证。

### 6.4 性能/无障碍快速改进

1. **立即见效**：
   - 删除 `components/ui/` 中未使用的 shadcn 组件（减少 tree-shaking 负担）
   - 添加 `aria-live` 区域到异步状态变更点
   - 运行一次 axe 扫描并修复所有 critical/serious 问题

2. **S1 阶段**：
   - 确认路由级 lazy loading 生效（Polotno 4.45MB 不应在主 bundle 中）
   - 设置 `<meta name="theme-color">` 为美业品牌色（当前为 `#09090b` 通用暗色）

3. **S5 阶段**：
   - 重跑 Web Vitals 与 S0 基线对比
   - 移除未使用的 npm 依赖

---

## 七、测试深度评估

### 7.1 当前测试覆盖差距

| 测试类型 | 当前状态 | 缺口 |
|----------|----------|------|
| Web 单元测试 | 74 个通过，28 个文件 | 覆盖偏向 lib 和 p1 view-model。UI 组件和路由级集成测试缺失 |
| Core 单元测试 | 347 个通过 | 结构良好但全是 `Recorded*` fake adapter。零真实 AI 模型集成测试 |
| E2E (Playwright) | 19 个 spec | 未确认全部通过。`uiux-precutover-baseline.spec.ts` 是关键 |
| 键盘导航测试 | 不存在 | `uiux-keyboard-governance.spec.ts` 文件名存在但需核实实际内容 |
| 无障碍扫描 | 不存在自动化 | `@axe-core/playwright` 已安装但未集成 |
| 性能测试 | 不存在 | 无 lab 数据，无 RUM 配置 |
| 视觉回归测试 | 不存在 | 无 Percy/Chromatic 等价物 |
| 200% 缩放测试 | 不存在 | G03 必修项，零证据 |
| 秘密/PII 扫描 | 不存在 | B06 必修项 |
| 真实 AI 模型测试 | 不存在 | P1 代码质量审查已确认全部 `Recorded*` adapter 是 fake |
| 真实抖音/飞书集成测试 | 不存在 | 同上 |

### 7.2 S0 必须在 S1 之前修复的问题

1. **验证 `pnpm e2e` 全部通过**：运行全部 19 个 spec，修复失败项，记录基线计数
2. **增加 axe 自动化扫描**：在每个 E2E spec 的 `afterEach` 中注入 axe 扫描
3. **创建 Web Vitals lab 采集**：至少对关键页面做 LCP/CLS/INP 的初始测量
4. **增加键盘旅程测试**：至少验证登录→Dashboard→核心操作的 Tab 键可达性
5. **运行秘密/PII 扫描**：确保当前代码基线无泄露
6. **实现迁移 dry-run 骨架**：S0 要求之一，为 A02/A03 验收做准备

### 7.3 E2E 旅程缺口

当前 19 个 E2E spec 覆盖了：
- 认证（auth.spec.ts）
- 公开页面（public-pages.spec.ts）
- 受保护页面（protected-pages.spec.ts）
- 设置（settings-profile.spec.ts）
- P0 黄金旅程（p0-golden-journey.spec.ts）
- P1 recorded 旅程（p1-recorded-journey.spec.ts）
- P1 集成旅程（p1-integrations-journey.spec.ts）
- 移动端（mobile-product-shell.spec.ts）
- UIUX 创建循环（uiux-creation-loop.spec.ts）
- UIUX 键盘治理（uiux-keyboard-governance.spec.ts）
- UIUX 移动次级页面（uiux-mobile-secondary.spec.ts）
- UIUX 运营复用（uiux-operations-reuse.spec.ts）
- UIUX 切换前基线（uiux-precutover-baseline.spec.ts）
- UIUX 壳层路由（uiux-shell-routes.spec.ts）
- PWA 媒体原语（pwa-media-primitives.spec.ts）
- 运行时追踪（runtime-tracer.spec.ts）
- 资产上传（product-asset-upload.spec.ts）
- 任务源导航（task-source-navigation.spec.ts）

**缺失的 E2E 旅程**：
- 冷启动（E0）完整流程——S2 必须新增
- 恢复与失败语义（C06）——S2 必须新增
- 模板版本升级保留历史——S3 必须新增
- 移动端上传中断续传——S4 必须新增
- L1/L3 发布闭环——S4 必须新增
- 回滚演练——S5 必须新增
- 管理审计完整矩阵——S4 必须新增

### 7.4 无障碍测试就绪度

**当前评分：2/10**

- `@axe-core/playwright` 已安装但未配置
- `state-panel.tsx` 有正确的 `aria-busy`、`aria-live` 属性——良好示范
- `sidebar-layout.tsx` 有 skip-link——良好示范
- 但：无自动化扫描、无键盘旅程测试、无色彩对比度验证、无缩放测试
- G01-G03 共计 3 项 required + 多项隐含要求，当前满足率很低

---

## 总结

当前代码库的**真实状态远好于交接文档描述的情况**。交接文档将现状描述为"10,450 行 P1 TSX 被塞在本地 Tabs 与双工作台中"，但实际核查发现：

1. **不存在本地 Tab 反模式**
2. **Shell 基础设施已经就位**（六项导航、三种 Shell 模式、skip-link、路由常量表、旧路由重定向）
3. **74 个 Web 测试 + 347 个 Core 测试已全部通过**
4. **test script 已存在且可运行**（文档错误地声称缺失）
5. **但确实存在 3 个超大单体组件**需要拆解：`integration-settings.tsx`（1,958 行）、`admin-model-control.tsx`（1,650 行）、`unified-creation-workbench.tsx`（1,147 行）
6. **S0 基线冻结缺少关键证据**：Web Vitals、axe、键盘、缩放基线全部空白
7. **S2 的 Agent Composer 是最大未知因素**——无现有实现可参考，静态原型到生产交互的距离难以预估

务实评估：在单人全职开发、修复已知 S0 缺口的前提下，六阶段计划可在 **7-9 周**内完成，前提是 S2 Agent Composer 的复杂度不超出预期。
