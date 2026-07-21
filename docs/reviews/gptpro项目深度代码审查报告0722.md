# 项目深度代码审查复核、裁定与修复验收报告

> 修订日期：2026-07-22
> 原报告来源：Claude 深度 Review
> 复核基线：`main` / `50f33ebdfeab703bfcb0b674bf147eb288278fcd`
> 修复分支：`review/gptpro-0722-revalidation`
> 工作树：`/Users/bin/Desktop/开发/内容无人区/美业内容2-review-0722`

## 1. 当前结论

**代码层修复已完成并在本地独立环境验证，可作为合并候选；生产发布仍不放行。**

这不是把原报告的风险“降级为文档问题”。原报告中 21 个应采纳项均已落实为代码、迁移、测试或 CI 合同；审阅过程中新增发现的支付崩溃窗口、滚动迁移兼容、旧头像断链、Canvas 孤儿对象、生产 S3 回退和 C-12 证据错绑，也已在本分支修复。

生产发布仍被以下仓库外证据阻断：GitHub required checks/保护环境尚未配置，真实 Provider Live 与生产私网/WAF/Ingress 证据未提供，生产 Stripe 存量审计与历史头像异常账户处置尚未执行。它们不能被本地测试伪装为“已通过”。

| 层级 | 当前状态 | 含义 |
| --- | --- | --- |
| 代码与迁移 | 通过 | 所有已采纳修复均有本地回归、空库/真实 PostgreSQL 或构建证据。 |
| 普通 PR 门禁代码 | 通过 | 已定义 Web + Canvas 全量快速门禁和仓库守卫，无 path filter。 |
| 发布候选代码 | 通过 | 已定义构建、四服务 E2E、SCA、C-12 SHA 绑定契约。 |
| 生产部署/发布 | 阻断 | 需由仓库管理员与运维完成外部配置、数据处置和真实环境证据。 |

### 严重级别

| 级别 | 含义 |
| --- | --- |
| P1 | 可导致支付/账户边界破坏、事件静默丢失或发布基线失效。 |
| P2 | 重要安全、可靠性、数据一致性或工程门禁缺陷。 |
| P3 | 防御加固、治理或可维护性优化。 |

## 2. 三分类裁定

### 2.1 需要采纳：已完成

| ID | 最终处置 | 本次闭环证据 |
| --- | --- | --- |
| A-01 | 采纳并修复 CI 基线 | Contracts/Core/Web/Canvas 门禁全部可执行；Core 真实双库全量 0 fail。 |
| A-02 | 采纳 C-01/C-02 Stripe 退役 | 阻止新增 Stripe Customer、checkout、Portal；保留历史生命周期 Webhook 与只读退役审计。 |
| A-03 | 采纳 C-03 webhook outbox | 验签后原子 inbox/outbox、lease/token fencing、checkpoint/retry；补真实 PG 崩溃重领测试。 |
| A-04 | 采纳公网 body 上限 | Webhook 512 KiB、JSON 1 MiB、上传约 11 MiB 均在读取阶段限制。 |
| A-05 | 采纳 JSON/Canvas 复杂度边界 | 深度、节点数和媒体预算改为非递归边界检查。 |
| A-06 | 采纳 mapped IPv6 SSRF 修复 | 二进制归一化后拒绝私网/metadata 映射地址，并保留公网 mapped 地址。 |
| A-07 | 采纳调用 deadline | session 约 2.5 秒、普通内部调用 10 秒、流式 connect/idle 边界均接入 caller signal。 |
| A-08 | 采纳支付目录校验 | 服务端 canonical catalog 在 DB/provider 前拒绝未知、错配、禁用和不可售价格。 |
| A-09 | 采纳受控公开上传 | 仅 server-owned avatar 可公开；私有文件保留 DB/workspace 授权。 |
| A-10 | 采纳存储补偿 | Web tombstone/outbox；Canvas metadata+delete 双失败会持久化 orphan compensation。 |
| A-11 | 采纳日志脱敏 | Auth、Newsletter、Stripe、Creem Webhook 仅输出安全码/名称/阶段，不写 payload、signature、token、邮箱或原始 cause。 |
| A-12 | 采纳凭据传输限制 | 携带 Authorization 的 safe fetch 只允许 HTTPS；降级跳转在 transport 前拒绝。 |
| A-13 | 采纳模型 outbox 续租 | provider effect 的 lease heartbeat、fencing、已开始/已完成持久状态和恢复合同已补齐。 |
| A-14 | 采纳支付开关拆分 | paid launch 不再关闭存量 Stripe webhook 生命周期处理。 |
| A-15 | 采纳生产共享对象存储 | Main/Worker 共用 S3/R2 adapter；production/staging 缺明确 HTTPS public base URL 即 fail-closed。 |
| A-16 | 采纳 Web/Canvas PR 门禁 | 每个 PR 运行 Web/Canvas 快速门禁；RC 执行 build、E2E、SCA。 |
| A-17 | 采纳 header 信任边界 | 非法显式 idempotency key 返回 400；不安全 correlation ID 重新生成。 |
| A-18 | 采纳 response disposal | redirect、非 2xx、MIME/大小拒绝及流失败均取消未消费 response body。 |
| A-19 | 采纳 ffprobe timeout | 设定 timeout、Abort/SIGKILL 与稳定错误路径。 |
| A-20 | 采纳 Stripe API version 治理 | 历史 Provider 显式锁定 SDK 兼容 API version，并有合同测试。 |
| A-21 | 采纳 canonical payment URL | 浏览器不再提交完整 return URL；服务端生成 success/cancel/return canonical 地址。 |

### 2.2 不需要采纳或必须改写的原表述

下表是对原报告“结论表达”的裁定，不是否认相关防御工作。

| ID | 裁定 | 原因 |
| --- | --- | --- |
| B-01 | 不采纳 | 基线存在精确绑定的失败 CI run；不是“没有可见 CI 结果”。 |
| B-02 | 不采纳原 P1 定级 | mapped IPv6 绕过成立，但 HTTPS、SNI/TLS 与 host 绑定缩小了原先声称的直接 metadata 影响。 |
| B-03 | 不采纳 | Zod 拒绝 protocol-relative URL，`//attacker.example` 不能按原说法进入。 |
| B-04 | 不采纳确定性泄露说法 | 调用者本已获得 session ID；真实风险是托管支付后的社会工程跳转。 |
| B-05 | 不采纳 | 没有仓库证据证明 R2 bucket 本身公开。 |
| B-06 | 不采纳“已形成存储型 XSS” | `nosniff`/attachment 已缓解；真实问题是公开授权、审计、治理和成本滥用。 |
| B-07 | 不采纳 | 既有 sanitize、root containment、UUID 文件名已缓解路径穿越与覆盖。 |
| B-08 | 不采纳“当前必然泄露邮箱” | newsletter 当前关闭；应表述为启用后的潜伏日志缺陷，现已脱敏。 |
| B-09 | 不采纳 | 未实证 Better Auth 会自动记录 Authorization/header；原始 cause 风险另行按日志脱敏处理。 |
| B-10 | 不采纳原双写方向 | Canvas 原路径主要留下孤儿 bytes，而非已提交 metadata 指向缺失对象；两类失败现均闭环。 |
| B-11 | 不采纳 | workflow 引用 environment 不等于 GitHub 实际受保护环境。 |
| B-12 | 不采纳 | 固定的是自定义 conformance hook SHA，不是 Actions runner 全部固定。 |
| B-13 | 不采纳 | 不能从仓库源码推出某 job 已被 GitHub 设为 required check。 |
| B-14 | 不采纳“账户版本随机漂移” | lockfile 固定 SDK；真实治理风险是未来 SDK 升级时默认 API version 变化。 |
| B-15 | 不采纳 | 普通 PR、RC、部署后的门禁应分层，不应让全部 P2 阻塞每个 PR。 |
| B-16 | 不采纳 | 原 IPv6 正则不覆盖完整压缩/展开形式，必须做地址归一化。 |

### 2.3 已冻结的 C-01 至 C-12 决策

| ID | 最终决策 | 已落实的边界 |
| --- | --- | --- |
| C-01 | B：退役 Stripe | 不作为正式新 Provider；历史义务清零前只保留受控生命周期处理。 |
| C-02 | 退役专用审计 | 不新建 Customer/checkout/Portal；本地提供只读历史义务审计。 |
| C-03 | B：verified event + settlement outbox | 验签、原子持久化、异步结算、lease/fencing/重试。 |
| C-04 | A：保守限额 | 512 KiB webhook、1 MiB JSON、约 11 MiB upload，deadline 分层。 |
| C-05 | A：仅 controlled avatar 公开 | 无 generic public file；新 avatar 必须 DB metadata + image 验证。 |
| C-06 | A：tombstone + deletion outbox | 业务先隐藏、worker 幂等删除；上传失败同时有即时与持久补偿。 |
| C-07 | A：所有 PR 快速门禁 | 无 path filter，Web/Canvas/repo guards 均执行。 |
| C-08 | B：分层验证 | PR 快速门；RC build/四服务 E2E/SCA；Provider Live release/manual/weekly。 |
| C-09 | B：无一级 workspace switcher | 主产品用兼容默认 workspace；内部/管理入口显式 workspaceId 并鉴权。 |
| C-10 | B：route-level step-up | Portal、API key、账号删除、关键 admin 写操作的近期认证窗口为 15 分钟。 |
| C-11 | B：服务端 canonical URL | 删除浏览器完整 URL 输入。 |
| C-12 | A：私网/service binding | Core/Canvas 仅 service binding；边缘/WAF/Ingress 证据独立验收。 |

## 3. 修复要点与新增集成复核

### 3.1 支付、Webhook 与 Stripe 退役

- `payment_webhook_events` 与 settlement outbox 在验签后同一事务入库；busy 返回 `503 + Retry-After`，不再误确认。
- Worker 对已应用 Provider 结果做 checkpoint，租约失效后的重领不会重复结算。额外的 `payment.session_id` 与 `subscription_id` 唯一业务键覆盖 `invoice_id = NULL` 的一次性 Stripe 支付。
- 0010 迁移先检测重复的非空业务键；发现历史脏数据即失败，**不会**静默删除或合并账单。
- outbox 外键使用 `ON DELETE RESTRICT`。旧应用在滚动期间若试图删除父 event 会失败并重试，不会 cascade 掉新版 durable outbox。
- Webhook 数据库错误日志改为固定 provider/stage 与安全错误字段；签名、payload、消息和 cause 均不输出。
- Stripe 入口保留历史 lifecycle webhook，但 Customer、checkout、Portal 新业务能力被硬禁用；`payment:audit-stripe-retirement` 仅做只读审计。

### 3.2 请求边界、SSRF、调用时限与权限

- Webhook、上传、Core JSON、Canvas action 与内部 form 都在解析前执行声明大小和流式大小限制；JSON 深度/节点计数为迭代实现。
- Safe fetch 对每一跳 DNS/host/protocol 重验；私网 IPv4-mapped IPv6 拒绝，公开 mapped 地址仍可正常访问；未消费 body 均显式 cancel。
- session、普通 API、stream connect/idle 均使用可取消 deadline，不替代 caller abort signal。
- API key 插件已升级到 Better Auth 1.6 兼容的独立包，并通过 `config_id` 前向迁移保留既有 `user_id` 归属。
- `config_get` 已被登记到 capability registry；测试 fake module 使用局部严格 seam，未给生产权限添加 allow-all。

### 3.3 上传、历史头像、对象存储与 Canvas

- 新上传只接受 server-controlled purpose；只有严格 JPEG/PNG/WebP avatar 在魔数、尺寸、归属 metadata 均通过后可公开。
- 普通删除使用 tombstone + `storage_object_outbox`；Canvas 元数据落库和首次对象删除同时失败时，`pro_studio_asset_deletion_outbox` 写入 `orphan_compensation`，Worker 可 claim/fence/complete。
- 0011 对唯一、严格旧 UUID 单段图片 key 建立 immutable legacy avatar claim。匿名读取还要匹配当前 owner image 与实际 MIME/扩展；不会恢复泛 `avatars/*` 公开。历史清洗器产生的下划线开头文件名也在严格字符集内兼容。
- Core Main/Worker 使用同一个 S3/R2 SigV4 adapter。production/staging 必须提供非 localhost、无 credential/fragment 的 HTTPS public base URL，否则启动失败。

### 3.4 CI、SCA 与 C-12

- 所有 PR 的 workflow 增加 Web/Canvas check、typecheck、unit、interaction 与 repo guards；RC 标签/手动路径先 build，再跑四服务 E2E 与 production audit artifact。
- C-12 gate 强制 deployment evidence 的 `commitSha` 与 `RELEASE_COMMIT_SHA`/`github.sha` 完整相等。没有外部 evidence 时只能输出 `contract-valid`，不能写成生产网络通过。
- 生产依赖审计已从 `1 critical / 29 high / 49 moderate / 12 low` 降到 `0 / 0 / 3 / 2`。剩余项涉及 TanStack Start、旧 Drizzle CLI/esbuild、MCP/Hono major、Vite/Wrangler Windows dev 链；未以跨 major override 冒险掩盖风险。

## 4. 本地验收证据

所有命令均在本报告的 review worktree 执行，未修改用户主工作树。

| 验证 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过。 |
| `pnpm typecheck` | 通过（Contracts、Core、Web、Canvas）。 |
| `pnpm --filter @meiye/web test` | 1,102 pass、0 fail、4 skip。 |
| `pnpm --filter @meiye/web test:interaction` | 21 files、97 pass、0 fail。 |
| `pnpm --filter @meiye/web check` | 0 error；4 warning、3 info。 |
| `pnpm --filter @meiye/web build` | 通过；仅既有 route-test/chunk-size warning。 |
| `pnpm --filter @meiye/canvas check` | 0 error；16 non-blocking warning。 |
| `pnpm --filter @meiye/canvas test` | 163 pass、0 fail、1 skip。 |
| `TEST_DATABASE_URL=… TEST_DBOS_SYSTEM_DATABASE_URL=… pnpm --filter @meiye/core test` | 1,928 pass、0 fail、9 skip；9 项均为显式外部 Provider/配额 opt-in。 |
| `pnpm --filter @meiye/core exec tsc --noEmit` | 通过。 |
| 空 PostgreSQL `pnpm --dir mkfast-template-main db:migrate` | 0000–0011 共 12 条迁移全部通过；确认 payment 业务键索引、outbox `RESTRICT`、legacy avatar claim。 |
| 支付真实 PostgreSQL回归 | crash/reclaim、stale fence、RESTRICT 父 event、NULL invoice 一次性支付均通过。 |
| Canvas 真实 PostgreSQL回归 | metadata insert + immediate delete 双失败后 durable recovery、claim/complete、对象删除均通过。 |
| `node --test scripts/ci/*.test.mjs scripts/production-network-boundary-gate.test.mjs` | 20/20 通过。 |
| `pnpm security:production-boundary -- --json` | `contract-valid`，无生产 evidence 时未错误声称 deployment-valid。 |
| `pnpm audit --prod --json` | critical 0、high 0、moderate 3、low 2。 |
| `git diff --check` | 通过。 |

## 5. 仍需在生产前完成的外部动作

这些项目不是可在本分支“补一段代码”解决的事项，缺任一项都不应把本报告当作生产 Go 信号。

1. **GitHub 强制门禁**：为目标分支配置 required checks/规则集；当前实测仓库没有启用 required checks。CI YAML 的存在不等于合并被拦截。
2. **Provider Live 环境**：配置 protected environment、审批与 secrets，取得和发布候选 SHA 关联的成功 live run。现有 release/manual/weekly workflow 不能替代真实环境保护。
3. **C-12 真实网络证据**：保存 Cloudflare/WAF/Ingress 的 body/rate/connect/read 设置、Core/Canvas 直连拒绝、服务绑定、健康探针与部署身份证据；必须与候选 SHA 完整匹配。
4. **生产迁移顺序**：先执行 0007–0011，再发布 Web/Worker；CI deploy 必须配置 `DATABASE_URL`，缺失时应有意失败而非跳过迁移。0010 若发现重复 payment business key，先人工审计清理，再继续。
5. **Stripe 退役审计**：在生产只读执行 `payment:audit-stripe-retirement`，处理活跃订阅、退款、发票、权益与异常映射，确认全部义务完成后才能最终移除历史 Provider。
6. **历史头像异常账户**：0011 只自动兼容唯一引用、严格旧 key、受控 URL、对象存在且图片策略通过的记录。重复引用、非标准 URL、缺失对象或不合规图片保持 404；产品/数据负责人需决定人工重传或受控 backfill，不能为了兼容而恢复目录公开。
7. **真实对象存储与外部 Provider**：配置生产 S3/R2 endpoint、bucket、credential、HTTPS public base URL 与 provider credentials，运行 RC E2E/Provider Live；本地未花费真实 Provider 配额。

## 6. 最终裁定

- 原 Claude 报告的核心风险识别大多成立，但部分严重级别、影响前提和修复方式已按代码事实修正。
- 应采纳项：21 项，均已完成代码级闭环；审阅期间新增的 7 个集成代码阻断也已关闭。
- 不采纳或改写项：16 项，原因见第 2.2 节。
- 产品/架构决策：C-01 至 C-12 均已冻结并已按边界实现。
- 当前状态：**本地代码验收通过，允许进入合并审查；生产发布保持阻断，直至第 5 节外部证据和数据处置完成。**
