# 项目深度代码审查复核与裁定报告

> 修订日期：2026-07-22
> 原报告来源：Claude 深度 Review
> 复核基线：main / 50f33ebdfeab703bfcb0b674bf147eb288278fcd
> 复核分支：review/gptpro-0722-revalidation
> 复核方法：Agent Team 分轴静态审查、调用链追踪、最小复现、目标测试、本地质量门禁与 GitHub Actions 实时证据核验

## 1. 当前结论

**结论：当前不通过，阻断合并与生产发布。**

原因不是原报告所写的“3 个 P1、8 个 P2”这一机械计数，而是以下事实已经得到复核：

1. 与基线提交完全绑定的 GitHub Core quality run 29850363565 已失败，而不是“没有可见 CI 结果”。
2. Stripe Customer 归属与支付 Webhook claim 顺序存在两个条件性 P1。
3. 公网 Webhook、上传入口的传输层资源边界不足；Core、Canvas 还有认证后资源耗尽风险。
4. Web、Canvas 的本地快速门禁并非全绿，当前没有可复用的成功 CI 基线。
5. 多项原报告结论成立，但严重级别、攻击前提、影响范围或修复方案需要收窄。
6. 12 项产品、迁移和运行策略已于 2026-07-22 完成决策，实施不得再回退为开放选项。

本报告把“是否采纳”和“严重级别”分开。P1/P2/P3 表示风险；“采纳/不采纳/需决策”表示处置结论。

### 严重级别

| 级别 | 含义 |
| --- | --- |
| P0 | 已确认的立即性灾难风险，必须停止运行 |
| P1 | 可造成账户/支付边界破坏、事件静默丢失或当前发布基线失效 |
| P2 | 重要安全、可靠性、数据一致性或工程门禁缺陷 |
| P3 | 防御加固、治理或可维护性优化 |

## 2. 实时验证证据

### 2.1 GitHub Actions

基线 SHA 50f33eb 对应的 Core quality：

- Run：https://github.com/leelv007-cmd/meiyeweb-agent/actions/runs/29850363565
- 状态：failure
- core：@meiye/contracts typecheck 失败；后续 Core typecheck、Core test 被跳过
- core-persistence：1914 tests，1858 pass，47 fail，9 skip
- redline-evals：success
- e2e、live-redteam：按当前条件 skipped
- Provider live：当前仓库没有可见历史运行

上一条可见 Core quality run 29505878363 同样失败。因此当前没有成功 CI 基线。

### 2.2 本地复核

| 验证 | 结果 |
| --- | --- |
| pnpm install --frozen-lockfile | 通过 |
| ProviderSafeFetch 既有测试 | 7/7 通过 |
| IPv4-mapped IPv6 最小探针 | ::ffff:7f00:1 已进入 transport，确认绕过 |
| 支付目录、Creem identity、verified event、Core client 目标测试 | 10/10 通过，但未覆盖报告指出的缺陷 |
| Canvas/Core 存储目标测试 | 13/13 通过，但未覆盖双写补偿 |
| 支付 normalization / Pro Studio retry | 11 通过，1 个 PostgreSQL 条件测试跳过 |
| Web interaction tests | 17 files、91 tests 全部通过 |
| Canvas tests | 152 通过，1 跳过 |
| Web default tests（先执行 locale:compile） | 失败 1 项：navigation label 期望“能力目录”，实际“模型供应” |
| Web tsc --noEmit | 失败：content-collections 模块/类型缺失 |
| Web check | 失败：现有 Biome/格式问题 |
| Canvas check | 失败：119 errors、20 warnings |

说明：本轮没有执行四服务 E2E、真实供应商调用、生产部署验证或 SCA。不能把这些项目写成已通过。

## 3. 三分类总表

### 3.1 需要采纳

| ID | 原报告章节/新增项 | 严重级别 | 置信度 | 裁定 |
| --- | --- | --- | --- | --- |
| A-01 | 新增：当前 CI 基线失败 | P1 | 高 | 采纳，当前发布阻断 |
| A-02 | 3.2 Stripe Customer 归属 | P1（Stripe 启用时） | 高 | 采纳 |
| A-03 | 3.3 Webhook 验签前 claim | P1 | 高 | 采纳，范围扩至 Stripe 与 Creem |
| A-04 | 3.4 公网 Webhook/上传无传输层上限 | P1 可用性 | 高 | 采纳 |
| A-05 | 3.4 Core/Canvas JSON 与复杂度边界 | P2 | 高 | 采纳 |
| A-06 | 3.1 IPv4-mapped IPv6 SSRF 绕过 | P2 | 高 | 采纳，原 P1 下调 |
| A-07 | 3.5 跨服务缺应用级 deadline | P2 | 高 | 采纳并补齐调用链 |
| A-08 | 3.7 Creem/支付 API 服务端目录校验 | P2 | 高 | 采纳 |
| A-09 | 3.8 公开上传策略 | P2 | 高 | 核心缺陷采纳 |
| A-10 | 3.9 存储与元数据双写 | P2 | 高 | 采纳并扩大路径 |
| A-11 | 3.11 Newsletter/Auth 日志脱敏 | P2（部分条件性） | 高 | 采纳并收窄现状描述 |
| A-12 | 3.12 Safe fetch 携带凭据可走 HTTP | P2 | 高 | 采纳 |
| A-13 | 3.12 模型 outbox 60 秒租约无续租 | P2 | 高 | 采纳 |
| A-14 | 3.12 payment.enable=false 丢弃 Webhook | P2 | 高 | 采纳，拆分开关语义 |
| A-15 | 3.12 生产本地资产存储偏离 ADR | P2 | 高 | 采纳 |
| A-16 | 3.10 PR 自动 CI 缺少 Web/Canvas 快速门禁 | P2 | 高 | 缺口采纳，具体策略需决策 |
| A-17 | 第 4 节 Header 信任边界 | P3 | 高 | 采纳并改写 |
| A-18 | 第 4 节提前退出未释放响应体 | P3 | 高 | 采纳并扩大范围 |
| A-19 | 第 4 节 ffprobe 无 timeout | P3 | 高 | 采纳 |
| A-20 | 第 4 节 Stripe API version 治理 | P3 | 中 | 作为升级治理采纳，不作为当前安全漏洞 |
| A-21 | 3.6 客户端可定制支付返回 URL | P3（付费上线前 P2） | 高 | 采纳，按 C-11-B 删除完整 URL 输入 |

### 3.2 不需要采纳或必须删除的原结论

| ID | 原结论 | 裁定与原因 |
| --- | --- | --- |
| B-01 | 当前 HEAD 无可见 CI 结果 | 不采纳。实时 run 已精确绑定 50f33eb 且失败 |
| B-02 | IPv4-mapped 绕过当前为 P1，可直接读取常见 HTTP 云元数据 | 不采纳该级别和影响扩张。当前 Ark/Tuzi 强制 HTTPS，且保留原 hostname 做 SNI/TLS 校验 |
| B-03 | //attacker.example 可通过当前 URL schema | 不采纳。Zod 实测拒绝 protocol-relative URL |
| B-04 | 外域返回地址会新增泄露 Stripe session ID | 不采纳该确定性表述。调用者已获得 session ID；主要风险是托管支付域后的社会工程跳转 |
| B-05 | R2 bucket 本身公开 | 不采纳。仓库证据只确认应用同源代理公开，不证明 R2 public bucket |
| B-06 | 当前公开上传可直接形成存储型 XSS | 不采纳。nosniff 与非安全 MIME attachment 已形成缓解；真实问题是公开托管授权、审计、内容治理和成本滥用 |
| B-07 | 当前上传存在路径穿越/覆盖 | 不采纳。sanitize、root 校验与 UUID 文件名已缓解 |
| B-08 | 当前 Newsletter 一定向生产日志写完整邮箱 | 不采纳。当前 newsletter.enable=false；应改成“启用后必然触发的潜伏缺陷” |
| B-09 | Better Auth error 自动包含请求头、Authorization 或 token | 不采纳。error 与 request context 分开传入；原始 cause 可能敏感，但未实证 |
| B-10 | Canvas 双写失败会留下 graph/metadata 指向缺失对象 | 不采纳。当前顺序会留下孤儿 bytes，但 repository insert 未成功，不会写出对应 metadata |
| B-11 | Provider live 已受 protected environment 保护 | 不采纳。workflow 引用了 environment 名称，但仓库实时 environments 数量为 0 |
| B-12 | Provider live runner hash 固定 | 不采纳。固定的是自定义 conformance hook SHA256，不是所有 Actions/runner |
| B-13 | 当前 job 是 required check | 不采纳。私有 Free 仓库的 branch protection/rulesets API 返回 upgrade-required |
| B-14 | Stripe API version 会随账户设置随机漂移 | 不采纳。lockfile 固定 Stripe 17.7.0，SDK 自带固定 API version；真实风险是以后升级 SDK 时语义变化 |
| B-15 | 所有 P2 都必须阻塞每个普通 PR | 不采纳。PR 门禁、发布门禁和部署门禁必须拆开 |
| B-16 | 原报告 IPv6 正则示例可直接粘贴 | 不采纳。示例不能覆盖全部合法 IPv6 展开/压缩表示，应使用完整 IPv6 解析或 BlockList/CIDR 归一化 |

### 3.3 已确认决策（2026-07-22）

| ID | 最终选择 | 已冻结的实施边界 |
| --- | --- | --- |
| C-01 | B：退役 Stripe | 停止把 Stripe 作为正式发布 Provider；完成存量义务核查后硬禁用新 checkout、Customer 创建和 Portal |
| C-02 | 退役专用方案 | 不新建 app-scoped Customer；只读审计活跃订阅、退款、发票、账单与权益义务，清零或交割后退役 |
| C-03 | B：verified event + settlement outbox | Webhook 先验签并持久化 verified event/outbox，Worker 异步结算；Provider 重试与 Core/Canvas 故障解耦 |
| C-04 | A：先采用保守限制 | Webhook 512 KiB、普通 JSON 1 MiB、上传 transport 约 11 MiB；session 2–3 秒、普通内部调用 5–10 秒，流式接口使用 connect/idle timeout |
| C-05 | A：仅受控 avatar 公开 | 通用文件默认私有，不保留 generic public_file；未来若有公开分享需求，必须通过独立受控发布能力重新立项 |
| C-06 | A：deletion outbox + tombstone | 删除意图事务落库、业务侧立即隐藏、Worker 幂等删除、成功后清理；上传仍实施即时补偿 |
| C-07 | A：所有 PR 跑快速门禁 | 暂不使用 path filter；Web/Canvas 快速矩阵对所有 PR 自动执行，收集时长后另行评估过滤 |
| C-08 | B：分层验证 | PR 跑快速门禁；RC 跑 build/四服务 E2E；Provider live 用于相关发布、手动或周检 |
| C-09 | B：主产品无一级 workspace switcher | 主产品保留单工作区体验；内部/管理员下钻显式传递并鉴权 workspaceId |
| C-10 | B：route-level step-up | 支付 Portal、API Key、账号删除和关键管理员写操作采用 10–15 分钟近期认证窗口 |
| C-11 | B：服务端 canonical URL | 删除客户端完整 success/cancel/return URL 输入，由服务端生成固定 canonical 地址 |
| C-12 | A：私网/service binding | Core/Canvas 不允许无保护公网直连；WAF/Ingress 另设 body、rate、connect/read timeout |

以上 12 项已关闭决策，不再作为实施过程中的自由选择。任何变更必须新增 ADR 或决策记录。

## 4. 需要采纳问题的详细复核

### A-01 [P1] 当前 CI 基线失败

证据：

- .github/workflows/core-quality.yml:91-155 定义 Core 与 persistence 门禁。
- Run 29850363565 精确绑定 50f33eb。
- Contracts typecheck 失败包含缺少 Node 类型以及多个真实 narrowing/type 错误。
- Core persistence 47 项失败。

处理：

1. 先修复 Contracts typecheck，使 Core typecheck/test 真正执行。
2. 对 47 个 persistence failures 按共同根因聚类，不以重跑掩盖。
3. 建立至少一条同 SHA 的成功 Core quality 基线后，才允许进入发布候选。

验收：

- Core quality 全部适用 job 绿色。
- 跳过项有明确原因，并绑定 SHA 与 run URL。

### A-02 [P1，条件性] Stripe Customer 归属错误

证据：

- mkfast-template-main/src/payment/provider/stripe.ts:72-108 使用 customers.list({ email, limit: 1 }) 并复用第一条。
- 同文件 123-137 按 email 回写本地 customerId。
- mkfast-template-main/src/payment/types.ts:118-127 的 CreateCheckoutParams 没有不可变 userId。
- mkfast-template-main/src/db/auth.schema.ts:11-30 的 customerId 无唯一约束。
- mkfast-template-main/src/api/payment.ts:129-149 的 Portal 完全信任本地 customerId。

准确影响：

- Stripe 启用且存在同邮箱、邮箱复用、共享 Stripe 账户或并发首次结账时，可能把账单主体绑定给错误本地用户。
- 续费路径会通过 customerId 回查 userId，错误会向后传播。

已确认处置（C-01-B、C-02 退役专用方案）：

1. 立即阻止新的 Stripe checkout、Customer 创建和 Portal 会话。
2. 不为未绑定用户创建新的 app-scoped Customer。
3. 只读导出本地 customerId、Stripe metadata、活跃订阅、退款、发票、账单和权益映射。
4. 对仍有存量义务的账户保留受控 Webhook 生命周期处理，不能通过 payment.enable=false 直接丢弃。
5. 所有活跃义务完成迁移、退款、取消或明确交割后，硬禁用并最终移除 Stripe Provider。
6. 保存退役审计结果、异常项负责人和完成证据。

### A-03 [P1] Webhook 验签前 claim，busy 被 200

证据：

- mkfast-template-main/src/payment/index.ts:79-137 先解析未验证 id/type，再查询/插入 paymentWebhookEvents。
- processing 或 insert conflict 直接 return。
- Stripe route 26-34 与 Creem route 27-37 把 return 映射为 HTTP 200。
- app.schema.ts:312-330 没有 lease、claim token、attempt、availableAt、lastError。
- 真正验签与支付写入耦合在 Provider handleWebhookEvent 内。

原报告需修正：

- 问题同时影响 Stripe 和 Creem。
- 不应把“猜中低熵 event ID”作为主要前提；真实并发重投、ID 泄露或可观察事件即可触发风险。
- Pro Studio 已有持久 claim、退避和 cron 重试；真正缺 durable outbox 的重点是 plan entitlement 到 Core。

根据 C-03-B，实施必须包含：

1. 先验签和规范化，再用 canonical provider event ID claim。
2. 在本地事务中持久化 verified event 与 settlement outbox。
3. 持久化成功后快速响应；结算由 Worker 使用 lease、fencing token、重试状态处理。
4. busy/暂态失败必须保持可重试，不能被错误确认成已完成。
5. payment session/subscription 业务键做真正幂等并在建唯一约束前审计。

### A-04/A-05 [P1/P2] 请求体与 JSON 复杂度边界

公网高优先级入口：

- Stripe webhook route:17 与 Creem webhook route:18 在验签前 request.text()。
- TanStack server-function dispatcher 会先 request.formData()；user-files.ts:97 又 arrayBuffer()，而 10MB 检查直到 r2.ts:215 才发生。

认证后入口：

- apps/core/src/server.ts:181-225 的 readBody/readJson 无界。
- apps/canvas/src/server/backend-port.ts:871-889 request.text() 后递归扫描。
- Web → Core proxy 会产生重复缓冲。
- 20,000 层 JSON 最小复现可使同构递归扫描抛出 RangeError。

修复边界：

1. Webhook 在读取前检查 Content-Length，并对实际流累计计数。
2. 上传不能只在 File.size 后补救；应在 dispatcher/WAF 前设 transport limit，或使用自有上传 Route 做流式限制。
3. 普通 JSON、Canvas graph、base64 媒体、Webhook、multipart 分别设预算。
4. JSON 复杂度检查改为迭代式，限制深度和节点数。
5. 字节超限返回 413；结构复杂度超限使用稳定 400/422。

推荐初始值：

- Webhook：512 KiB
- 普通 JSON：1 MiB
- 用户上传 transport：约 11 MiB
- Canvas 35M base64 路由：按实际 payload 单独定，不套 1 MiB

### A-06 [P2] IPv4-mapped IPv6 绕过

证据：

- reference-asset-delivery.ts:341-381 只识别点分形式 ::ffff:127.0.0.1。
- ::ffff:7f00:1、::ffff:0a00:1、::ffff:a9fe:a9fe 均进入 transport。
- 既有 7 个测试不覆盖 mapped IPv6。

下调 P1 的原因：

- 当前 Ark/Tuzi 在下载前强制 HTTPS。
- pinned transport 保留原供应商 hostname 做 Host/SNI/TLS 校验。
- Authorization 仅在目标 hostname 与 authorization.host 精确相同时发送。
- 当前生产外部模型激活证据仍为 inactive/recorded。

修复：

- 使用完整 IPv6 二进制归一化、Node BlockList 或可靠 CIDR 判断，不使用原报告的不完整正则。
- 测试覆盖压缩、展开、mixed dotted、mapped 私网与 mapped 公网，并断言 transport 不执行。

### A-07 [P2] 跨服务调用缺应用级 deadline

确认缺口：

- Canvas → Main session validate
- Web → Core diagnostics
- Web → Core asset stream
- 支付 → Core
- 支付 → Canvas
- Main → Canvas entry/launch
- Canvas → Core command/query 与 asset put/read
- Workspace provisioning → Core

原报告错误：

- 普通 workspace proxy 已传 request.signal，不能写成“完全无 AbortSignal”；真实缺口是没有总 deadline。

策略：

- session validate：2–3 秒
- 普通 JSON：5–10 秒总 deadline
- 支付 Worker 内部调用：5–10 秒 deadline，超时后保持 settlement outbox 可重试
- SSE/媒体：connect/header timeout + idle timeout，不使用普通短总超时
- 合并 caller signal 与 timeout signal

### A-08 [P2] 支付目录校验缺失

证据：

- payment.ts:76-88 未拒绝 unknown price、plan/price mismatch、plan.disabled、price.disabled，且在 Provider 前创建 binding。
- unknown price 默认当 subscription。
- creem.ts:159-187 对普通套餐直接把 priceId 作为 productId。
- Stripe Provider 虽拒绝 unknown/mismatch，仍没有统一 disabled 规则；API 层已经留下 failed binding 垃圾。

修复：

1. binding 前解析 canonical plan + price。
2. 拒绝 unknown、mismatch、plan.disabled、price.disabled、不可售 free plan、非法 cadence。
3. 使用 canonical price.type/interval 写 binding。
4. 无效输入必须 DB 0 insert、Provider 0 call。
5. Creem Provider 再做 defense-in-depth，不创建第二份目录。

### A-09 [P2] 公开上传策略失控

证据：

- user-files.ts:66-89 接受客户端 folder 与 isPublic。
- folder=avatars 或子目录即可清空 userId、跳过 user_files 元数据。
- storage/file.ts:43-59、104-116 允许匿名同源读取并设置长期 public cache。
- 未知 MIME 与任意扩展仍可通过；没有头像魔数/尺寸校验。

需保留的准确边界：

- 不是 R2 bucket 公网化。
- 没有证据支持路径穿越、覆盖或直接存储型 XSS。
- isPublic 并非触发 avatars 公开路径的必要条件。

最小修复：

1. 删除原始 folder 输入，改为服务端 purpose。
2. avatar 固定 prefix、大小、JPEG/PNG/WebP、MIME + magic + dimensions。
3. 无论 public/private 都写 owner、workspace、object metadata。
4. 读取授权以 DB isPublic 为准，路径前缀只做旧对象兼容。
5. 按 C-05-A，不保留 generic public_file；公开分享能力必须以后独立立项。

### A-10 [P2] 存储与元数据双写

确认路径：

- user-files.ts:104-126：R2 put 后 DB insert，无补偿。
- user-files.ts:62-63：先删对象再删 DB。
- product-assets.ts:80-100：同类上传双写，原报告漏列。
- canvas-asset-facade.ts:216-218：storage.put 后 repository.insert。
- audio-asset-pipeline 也存在同类顺序，需纳入实施盘点。

准确影响：

- 上传/insert 失败会留下孤儿 bytes。
- 删除第二步失败会留下 DB 指向缺失对象。
- Canvas insert 失败不会留下对应 metadata，但会留下孤儿 bytes。
- Canvas 当前默认是 Core 本地文件系统，不应把所有路径统称为 R2 对象存储。

最小修复：

- 上传：insert 失败 best-effort delete；补偿失败记录稳定 orphan 告警。
- Canvas storage 增加幂等 delete。
- 删除：按 C-06-A 实施 transactional deletion outbox + tombstone。

### A-11 [P2，条件性] 日志脱敏

证据：

- auth.ts:150-155 直接 console.error 原始 auth error。
- auth.ts:179-182 在 Newsletter 启用时输出完整邮箱。
- 当前 websiteConfig.newsletter.enable=false，所以邮箱路径目前不可达。
- Wrangler 配置启用了日志/观测持久化；但 retention、访问范围和第三方转发未验证。

修复：

- 只记录 userId、事件码、error name/code、correlationId。
- 不直接序列化 SDK/auth raw error。
- 同步盘点 Resend 与 Beehiiv Provider 的 email/raw error 日志。
- 日志 retention、访问控制与自动 PII 扫描作为运维证据项。

### A-12 至 A-15 [P2] 原 3.12 中应直接采纳的事项

1. Safe fetch 凭据与 HTTP
   reference-asset-delivery.ts:202-205、304-319 允许携带 Authorization 的同 hostname 请求走 HTTP。携带凭据必须强制 HTTPS；生产 Provider URL 建议全部 HTTPS。

2. 模型 outbox 租约
   foundation-module.ts:3166-3217 默认 60 秒租约、同步等待 Provider、无 heartbeat/renew；postgres-repository.ts 允许过期重领。增加 renewLease/heartbeat，并把 Provider effect idempotency 做成持久合同。

3. payment.enable=false
   Stripe webhook 在关闭支付时直接 200 丢弃。公开付费入口开关不应同时关闭存量订阅生命周期同步。拆分 paidLaunchEnabled 与 webhookProcessingEnabled/providerConfigured。

4. 生产资产存储
   Core Main 与 Worker 默认装配本地文件系统，而 ADR-0006 要求二进制存 R2。生产装配切换共享对象存储；本地 filesystem 只留 dev/test/recorded。

### A-16 [P2] PR 自动 CI 缺少 Web/Canvas 快速门禁

事实成立：

- 普通 PR 自动 workflow 只覆盖 Contracts/Core 与 Core persistence。
- E2E 仅 workflow_dispatch 或 run-e2e label。
- Web test 默认排除 17 个 interaction files；必须另跑 test:interaction。
- Canvas check 已包含 tsc，不需要重复 typecheck。

建议 PR 快速矩阵：

- Web：check、typecheck、test、test:interaction
- Canvas：check（含 tsc）、test
- 保留 repo-level secret/decision guards

按 C-08-B：PR 不强制完整 build/E2E/live；RC 执行 build 与四服务 E2E，Provider live 用于相关发布、手动或周检。

### A-17 至 A-21 [P3] 可选治理

- Header：correlation ID 不合法可重新生成；显式 idempotency key 不合法必须 400，不能静默替换。
- Response disposal：不仅 redirect，所有 status/size/MIME 等提前退出分支都要 cancel/drain。
- ffprobe：增加 timeout、kill signal 与稳定错误分类测试。
- Stripe API version：显式版本用于让未来 SDK 升级可审计；不是修复当前账户版本随机漂移。
- Payment return URL：按 C-11-B 删除客户端完整 URL 输入，由服务端生成 canonical success/cancel/return 地址。

## 5. 需要用户确认的其他发布证据

以下不是代码漏洞，但没有证据就不能发布：

- Cloudflare/WAF/Ingress 的 body limit、rate limit、connect/read timeout 与直连可达性。
- Core/Worker/Canvas 实际副本数、共享资产存储和网络边界。
- 依赖漏洞扫描：pnpm audit/OSV/Dependabot alerts。
- Provider live 最近成功 run，且 SHA 与发布候选一致。
- 数据库迁移在空库、存量库、异常重复数据上的演练。
- Stripe Customer、payment session/subscription、checkout binding 的存量审计。
- 发布后支付/权益对账脚本或查询。

## 6. 经复核可保留的正向实践

1. Core 启动密钥约束成立：强制 CORE_SERVICE_TOKEN、DOUYIN_CALLBACK_TOKEN 且不得相同。
2. PostgreSQL migration 使用 advisory transaction lock，具备多进程保护。
3. Canvas generation outbox 使用 SKIP LOCKED、租约、claim token 与 fenced conditional update；不应再称“文本生成 outbox”或“事务内写终态结果”。
4. ProviderSafeFetch 已有精确 host allowlist、逐跳重验、DNS 全结果检查、pinned transport、流式大小/MIME/magic 限制。
5. 已核查的私有文件读取与 Canvas 资产路径具备 workspace/service token 鉴权、nosniff 与 Range 支持。
6. 文件系统路径净化与 root containment 检查合理。
7. Core quality、persistence、redline、可选 E2E、Provider live workflow 结构具备价值，但不能掩盖当前失败、未运行和非 required 的事实。

## 7. 修订后的门禁

### 7.1 普通 PR 合并门禁

- [ ] 变更范围对应的 check/typecheck/test 全绿
- [ ] Web interaction tests 单独执行
- [ ] Bug 修复有最小回归测试
- [ ] 新迁移可前后兼容
- [ ] 无新增 P1
- [ ] 采纳项若延期，有 owner、期限与风险接受记录

### 7.2 发布候选门禁

- [ ] Core quality 同 SHA 全绿
- [ ] Web、Canvas 快速矩阵全绿
- [ ] 四服务 E2E 在发布候选 SHA 上执行
- [ ] Provider live 或明确的受控不执行理由
- [ ] SCA 结果留存
- [ ] 网关限制、内部 deadline、共享存储拓扑留存
- [ ] 支付、Webhook、存储补偿与重试测试通过
- [ ] 数据迁移与回滚/前向修复演练完成

### 7.3 部署与发布后门禁

- [ ] Schema → 应用 → Worker 的兼容部署顺序确认
- [ ] 新旧版本并存时 Webhook inbox/payment schema 兼容
- [ ] Webhook retry、orphan object、SSRF reject、internal timeout 有指标与告警
- [ ] 支付/权益对账可执行
- [ ] 回滚不会关闭存量订阅 Webhook

## 8. 最终裁定

原报告识别了多数真实风险，但不能原样作为实施清单：

- 需要采纳：21 项，其中当前明确 P1 发布阻断 4 项。
- 不需要采纳或必须删除/改写：16 项原表述。
- 已确认决策：12 项，未决 0 项。

最先执行的顺序：

1. 修复当前 CI 红线并建立成功基线。
2. 执行 Stripe 存量只读审计、停止新增并完成退役；同时实施 Webhook verified event + settlement outbox。
3. 给公网 Webhook、上传入口增加传输层资源边界。
4. 完成支付目录、上传策略、存储补偿与跨服务 deadline。
5. 按已冻结的 C-01 至 C-12 决策完成验收，不得在实施中重新开放范围。

在上述 P1 与适用发布门禁完成前，状态保持：**不通过，不建议合并或发布。**
