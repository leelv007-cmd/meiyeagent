# Ponytail 全仓清理优化收口报告 — 2026-08-12

> 执行基线：`e5b9d273`（Agent Runbook 落地提交）
> 最终验收对象：本文提交前的 `main`
> 执行方式：9 个并行 Agent lane + 主集成 lane，所有变更均为英文 Conventional Commit
> 口径：只计算 `e5b9d273..HEAD`，不把条件删除队列计入成果

## 1. 最终结果

| 指标 | 目标 | 实际 |
| --- | ---: | ---: |
| 删除行 | 至少 30,000 净减 | 约 39,900 删除 |
| 新增行 | — | 约 2,900（行为锚定、共享合同、CI contract、回归测试与本报告） |
| 净减 | 至少 30,000 | 约 37,000 LOC |
| 直接依赖 | 19 个候选 | 删除 18 个；1 个经验证必须保留 |
| 文件 | — | 约 475 个文件变更 |
| 提交 | 微提交 | 106 个可独立说明的提交（含本报告） |

目标 LOC 已超过约 24%。依赖目标少 1 个不是遗漏：删除
`@better-fetch/fetch` 后，Better Auth 同时解析 1.3.1 与 CLI 链的 1.1.21，导致
Web 认证角色类型丢失。将 1.3.1 保留为显式 peer anchor 后 Web typecheck 恢复，
因此该依赖不能按 Knip 的普通“unused”结论删除。

删除的 18 个直接依赖：

- Core：`@langfuse/client`、`graphile-worker`。
- Web：`@ai-sdk/react`、`@internationalized/number`、`@number-flow/react`、
  `ai`、`embla-carousel-react`、`html-react-parser`、`lenis`、`lucide-react`、
  `nanoid`、`rehype-autolink-headings`、`rehype-raw`、`rehype-slug`、
  `rehype-stringify`、`remark-parse`、`remark-rehype`、`unified`。

## 2. 任务卡收口

| 卡片 | 状态 | 收口摘要 |
| --- | --- | --- |
| W-V01 | COMPLETE | 通过 HeroUI inventory 配置与同步流程裁剪未使用 Pro 组件，保留 sidebar/markdown/chain-of-thought 真实闭包。 |
| W-V02 | COMPLETE | Users Table 只保留生产使用的 action bar、column header、faceted filter、pagination 与 view options。 |
| W-V03 | COMPLETE | 删除 14 个零引用 shadcn primitives，并移除 carousel 依赖。 |
| W-V04 | COMPLETE | 删除 `/heroui-spike` 路由及 spike-only vendor 组件；route tree 由构建重新生成。 |
| W-P01 | COMPLETE | 删除 composer/results 死 barrels、settings row、command adapter、store profile form 等不可达模块。 |
| W-P02 | COMPLETE | 压平 Controlled Surface 静态自校验 registries，保留 typed props 与固定 JSX。 |
| W-P03 | COMPLETE | 删除退役 Canvas Work 页面；真实 Works detail/light-edit route 保留。 |
| W-P04 | COMPLETE | 收缩 Agent Workbench facade、Share 降级模型、死 exports 与重复 viewport 状态。 |
| W-I01 | COMPLETE | 删除旧 payment/files read side，压平单实现 storage provider，合并 Core forwarding 重复段。 |
| W-I02 | COMPLETE | Markdown 改为现有原生/产品闭包；Promptfoo 统一到一个 runner；删除失去消费者的 UI leaves。 |
| C-R01 | COMPLETE | 删除 Graphile 对照实现，生产 ownership 锚定为 `PgBossJobPort`。 |
| C-R02 | COMPLETE | 删除 diagnostics repository/proxy/read side，保留 Core 最小 authenticated 410 tombstone。 |
| C-R03 | COMPLETE | 历史 Product command 统一进入 retired gate；保留 idempotent outcome lookup 与 legacy recovery。 |
| C-S01 | COMPLETE | 删除无生产入口的旧 Video Workflow vertical，保留 canonical Postgres run store。 |
| C-S02 | COMPLETE | 删除 fault-injection 影子执行栈；provider-live 改为测试真实 production supply path，并加 CI static contract。 |
| C-S03 | COMPLETE | 删除 test-only 内存 policy/control-plane、association views 与过宽 supply barrels。 |
| C-S04 | COMPLETE | 删除测试型 leaves、静态 comparison report，合并 conformance 重复 helper。 |
| C-O01 | COMPLETE | 删除 Operations 平行 ports/services 与无 reader runtime flags；真实 PostgreSQL receipt 路径保留。 |
| C-B01 | COMPLETE | 删除 retired Canvas quote adapter、内存 billing lifecycle、credential-free recipe samples，收缩 helper。 |
| C-H01 | COMPLETE | 删除不可达 intent resolver、无效 after-model policies、mutable registry/singleton；保留真实高风险策略。 |
| R-S01 | COMPLETE | 删除两份无 package/CI/runbook 入口的一次性 evidence runners。 |
| C-U01 | COMPLETE | `media-tools` 改用 `execFile`；assembly return surface 收到 consumer 精确集合。 |
| X-B01 | COMPLETE | 删除 admin-config、product-billing、ops-console、creation-experience internal barrels，改 leaf imports。 |
| X-C01 | COMPLETE | Composer destination 与 recipe patch preview 合同下沉 `@meiye/contracts`，Core/Web 共同消费。 |
| X-D01 | COMPLETE WITH RETENTION | 删除 18 个直接依赖；`@better-fetch/fetch` 经失败验证后保留。 |
| X-I01 | COMPLETE | route tree、provider-live workflow、Knip 配置、lockfile、全仓 gates 与浏览器验收已集成。 |

## 3. 关键行为保持

以下边界经过代码审查、focused tests 或真实 persistence gate 证明仍在：

- issue-255 production collector、budget/receipt/cleanup 与固定 adapter 路径。
- DBOS 冷恢复、SIGKILL 后 exactly-once delivery、旧 function-ID replay、
  `force_legacy_five_stage`、shadow evidence 与 durable step order。
- Product legacy cutover、历史 `generate_copy` pending reclaim、inflight decision 与
  idempotent terminal outcome lookup。
- Supply dual-read 与 credential-slot 迁移脚手架。
- `artifact-update/v1` 之前的 legacy artifact coercion。
- Stripe 历史 webhook、identity 与 retirement audit。
- Cloudflare Mail 与 Feishu Notification 备用 provider。
- `@meiye/contracts` TypeScript 消费和 `@heroui/styles` CSS 消费。
- Core diagnostics 的 authenticated 410 tombstone；Web 的无消费者 proxy 已删除并返回 404。
- provider-live workflow、publish gate、live evidence/report contract 与真实 production fault tests。

## 4. 验证证据

### 4.1 静态、构建与包级门禁

- `pnpm install --frozen-lockfile`：PASS；lockfile 无漂移，安装实际移除 49 个传递包实例。
- `pnpm typecheck`：PASS；包含 contracts、Core、Web production build、Web typecheck、journey typecheck。
- Contracts：217/217 PASS，typecheck PASS。
- Core full test：3727 tests，3670 PASS，57 explicit environment/live skips，0 FAIL。
- Web full test：2088 tests，2075 PASS，13 explicit skips，0 FAIL。
- Web `check`：1398 files，PASS。
- Web production build：client + SSR PASS。保留的 warning 为既有 route-test discovery、
  generated vendor CSS selector 与 chunk-size/dynamic-import 提示。
- Web `knip:production`：PASS，0 个生产不可达文件。
- Provider production fault/publish/workflow contract：14/14 PASS。
- Root journey：1/1 PASS；journey typecheck PASS。
- Light Composer carrier focused regression：3/3 PASS；Web typecheck PASS。
- Polotno/Light Composer retirement static gate：3/3 PASS。

完整 Knip 仍报告 395 个 unused exports、682 个 unused exported types、3 个 duplicate
exports。这些包含测试 API、公共类型面与 vendor barrels，不能仅凭 Knip 批量删除。
依赖项中：`@better-fetch/fetch` 是 Better Auth peer anchor；`@heroui/styles` 由 CSS 引用；
`@meiye/contracts` 有大量真实 TypeScript import，三者均为已解释误报/必要保留。

### 4.2 真实 PostgreSQL / DBOS

使用两个显式新建、互相隔离的本地 PostgreSQL 数据库执行
`scripts/ci/run-core-persistence.sh`，结束后删除数据库：

- owner manifest：`core-persistence-dbos=2`、`core-persistence-pg=82`、`core-unit=480`。
- persistence suite：359 tests，355 PASS，4 明确历史/环境 skip，0 FAIL。
- gate 结论：DBOS smoke 实际执行，production media assembly join 实际执行。
- 覆盖 DBOS cold recovery、worker SIGKILL、legacy/shadow、确认超时、退款、
  renderer expiry、reask、old function-ID replay、media admission、Skill governance。
- 另有 canonical video/repository/foundation ledger PostgreSQL focused：43/43 PASS。
- Operations lane PostgreSQL：91/91 PASS。
- Billing PostgreSQL：billing 24/24、creation/admin 12/12 PASS。

测试数据库与临时日志未提交，最终均已清除。

### 4.3 Chromium 真实路径

使用独立 fixture Core 端口、独立 business/DBOS 数据库和临时管理员账号，通过
`agent-browser` 实际完成：

- 首页加载、FAQ 展开交互、Terms/Privacy 页面与 Markdown heading anchors。
- `/heroui-spike` 显示产品 404 页面。
- 邮箱登录到 `/dashboard`，Composer shell、积分、创作类型与推荐入口可见。
- 桌面 `/admin/users` 的 Users Table 工具栏、过滤、列与分页 shell 可达。
- `/admin/audit` 加载真实 seeded audit Timeline/records 与过滤/导出操作。
- 390px viewport 下 admin 不挤压宽表，显示明确的桌面接力页且无横向 overflow。
- Works 缺失对象显示诚实 not-found；带合法 `exportCarrier` 的 route 进入轻编辑加载路径。
- diagnostics 三个旧 Web proxy 地址均为 404。

浏览器验收发现并修复 `exportCarrier` 的对象预解析问题：TanStack Router 将 JSON
查询值先解析为对象，而 parser 旧实现只接受字符串。现在同时接受字符串和已解析对象，
并有 focused regression。临时账号、浏览器 session、stack 与数据库已删除。

开发模式下 Admin Users 数据请求曾触发 Miniflare request-context I/O 限制，并伴随本地
PostgreSQL `53300` 连接上限提示；该环境现象没有出现在 Web full tests、production build、
typecheck 或 admin route focused tests 中，因此未在本轮扩大为运行时重构。

## 5. 唯一已知基线红项

Root script suite 当前 281 tests 中 280 PASS、1 FAIL：
`strictly validates both tracked decision ledgers`。失败原因是决策账本引用的 24 个截图/
WebM evidence 文件在工作树和执行基线 `e5b9d273` 中都不存在，例如：

- `.scratch/creatok-uiux-wayfinding/assets/current-product-screenshots/01-dashboard-desktop-live.jpg`
- `docs/evidence/contentpackage/ticket-01/continuous-seam-journey.webm`

这些文件不是本轮删除，也无法从 Git 基线恢复。门禁保持 fail-closed，没有删除引用、伪造
证据或放宽校验。除这一基线 evidence 债务外，root script suite 的 cleanup 新回归均已修复。

## 6. 主要提交组

- Web vendor/admin：HeroUI inventory、Data Table、shadcn、spike、Timeline 收缩。
- Web product：dead modules、controlled surfaces、Canvas Work、Workbench facade、Share/viewport。
- Web infra：payment/files/storage、markdown、native landing、Core forwarding、diagnostics proxy。
- Core runtime：PgBoss ownership、diagnostics tombstone、retired Product commands、assembly surface。
- Core supply：canonical video、production supply faults、policy/control plane、conformance helpers。
- Core domain：billing、operations、session/harness registries 与 helpers。
- Integration：shared contracts、leaf imports、Promptfoo runner、dependencies/lockfile、route tree。
- 最终集成回归：`73b133f4`、`7d1403fc`、`62d83a35`、`93ee34f7`。

完整提交可用：

```bash
git log --oneline e5b9d273..HEAD
git diff --stat e5b9d273..HEAD
```

## 7. 条件删除队列（未执行）

以下项目继续保持原状，只有取得外部证据后才能另开清理批次：

1. 数据库证明所有 Product write ownership 已切 P1 且 inflight 清空后，才删除 legacy
   repository、`CutoverProductService` 与双实例装配。
2. 证明没有历史 pending `generate_copy` outcomes 后，才删除旧 copy execution/recovery。
3. 审计存量 Supply dual-read/credential migration 后，才删除对应脚手架。
4. 审计生产 replay 全部升级到 `artifact-update/v1` 后，才删除 legacy artifact coercion。
5. 产品明确不再把 Web 作为通用模板后，才评估 Cloudflare Mail/Feishu alternate providers。
6. 补齐账本引用的真实 evidence 资产后，重新运行 root script suite；不得用空文件或改账本
   绕过 fail-closed 校验。

## 8. Agent 后续执行建议

- 新清理批次以本报告 final SHA 为基线，不要重复删除已收口模块。
- 先运行 production Knip；完整 Knip 的 exports/types 只能逐一证明生产与外部消费者均不存在。
- 修改 Works/Router 查询合同必须同时测试字符串 URLSearchParams 与 Router 已解析对象。
- 涉及 persistence、DBOS 或 cutover 的候选必须继续使用两套独立真实 PostgreSQL 数据库。
- 保留 `@better-fetch/fetch`，除非 Better Auth/CLI 版本统一后重新证明 peer anchor 不再需要。
