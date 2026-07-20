# AP/MP 补足包逐票完成度审计（2026-07-20）

审计基线：`9908c6dd7775e01419e35d6617683ef6096f3eb4`。权威顺序按
`docs/handoff/admin-supply-handoff-2026-07-20.md`：设计 D-048~D-071 与
D-080 > spec #106 > #107~#128 票面。票有提交、recorded/fixture 测试为绿，
均不自动等于票面完成。

状态定义：

- `proved`：当前代码和与验收范围相称的测试直接证明票面完成。
- `partial`：已有实质实现，但仍有本分支可闭环或跨包交付缺口。
- `external_blocked`：代码门禁已具备，但必须由受保护账号/预算/故障注入器产生的 live 证据尚未取得。

## 逐票矩阵

| 票 | 状态 | 当前直接证据 | 未闭环项 |
|---|---|---|---|
| #107 S2a | proved | 版本化 capability inventory、抽取合同与兼容测试；Contracts 52/52 | 无 |
| #108 S2b | partial | 字段规范 + 四形双向 adapter、回放/冻结合同；CanonicalRouteSnapshot 为证据视图，**并非唯一持久化类型**（foundation checkpoint / model-supply rich / strict BYOK 仍多形落库） | multi-shape adapters 并存；Canonical 不 sole 落库（F-S2-04 / F-S2-03 round-trip 已补 top-level dataPolicy/sourceKind） |
| #109 G1 | proved | PostgreSQL 关系化 registry、迁移、双读/CAS/重启测试 3/3 | 无 |
| #110 G2 | proved | PostgreSQL CredentialAccount 是 HTTP/Worker/request-time broker 唯一运行真相；轮换后 pending，专用 probe 按 exact version CAS 验证并激活；一次性 receipt issuer 可达 | F-G-01 已修：`pending`/`draining` 下 `frozenVersion` 命中 `versionHistory` 时允许装配历史版本（head-only 仍硬拒）；in-flight frozen assembly 单测已补 |
| #111 G3 | proved | HTTP/Worker 共读 effective revision；新库默认 pool 使用真实账号 ID；隔离/停新/排空真实阻断 provider I/O；LLM/Ark/Tuzi/TTS 使用热发布 adapter config 与请求期凭据 | 无 |
| #112 G4 | proved | RoutePolicy 候选/发布/回滚历史与 HealthOverlay 均持久化；首次并发计数不丢失 | 无 |
| #113 G5 | proved | 同步、异步媒体与 Canvas 均在冻结前消费 RoutePolicy/DataPolicy/HealthOverlay/三层排序；生产媒体仅在 rejected-before-accept 时按冻结候选安全 fallback，实际分支进入同一解释投影 | 无 |
| #114 H1 | proved | EntitlementPolicy/AccountAllocation PostgreSQL head+CAS；每次 attempt 重读 EffectiveEntitlement | 无 |
| #115 H2 | partial | SupplyPool/三层 capacity、跨进程公平队列、ProviderAttempt 级媒体 lease、幂等 SupplyFreeze 已持久化并接入 provider effect；真实 PG 验收 7/7 | ProductUsage 持久化预占/结算的唯一属主是 #92 WT-B；当前工作树只有内存合同，本包不得重建第二真相 |
| #116 I1 | external_blocked | 真实 Ark/reseller 文本 probe adapter、账号/endpoint 故障域绑定与 cost-cap 门禁已实现 | 尚无同一 CatalogModel 的受保护双渠道证据 |
| #117 I2 | external_blocked | 图片真实 adapter 可 submit/recover/poll/download；live 证据严格白名单解析 | 需真实 transport injector 与同 CatalogModel 双渠道证据 |
| #118 I3 | external_blocked | 视频 canonical lifecycle/hook 合同已实现；未授权/价格错误保持红门 | Tuzi 模型权限/定价与双渠道真机尚缺 |
| #119 I4 | external_blocked | 四组/5 canonical scenario 外部证据接口、hook、liveMatrixReports 与 fail-closed 门禁；生产媒体 safe fallback 已接入；57 项 conformance 0 失败 | 未配置真实 fault-injector hook，因此未生成 liveMatrixReports |
| #120 K1 | proved | capability permission 显式注册、HTTP 默认拒绝、Cloudflare 写操作硬拒绝 | 无 |
| #121 J1 | proved | capability registry 消费 Core OperationalMetric、Supply、EntitlementPolicy 与 AccountAllocation 真实投影；失败诚实显示 unknown/stale | 无 |
| #122 J2 | proved | 真实 pending-actions/Core metrics；异常首页到 supply 的 Playwright 闭环 | 无 |
| #123 J3 | proved | 两层 IA、路由/下钻与 D-048 无技术编辑器浏览器验收 | 无 |
| #124 J4 | proved | `/admin/supply` 真实 BFF snapshot、真实 endedAt/latency、服务端过滤/排序/分页及可操作控件、运行下钻/关联/权益面，生产无 fixture fallback | 无 |
| #125 J5 | proved | 14 个动作全部走 Core preview→reason/CAS/idempotency→execute→immutable audit；副作用前 recovery context 使 result 落库失败可只读调和且不重放副作用 | 无 |
| #126 J6 | proved | Cloudflare 只读 inventory/probe 接 BFF，未验证 mapping 显示 unknown，写动作不存在 | 无 |
| #127 Z2-WIRING | partial | supply/planning/entitlement/admin migrations 在 HTTP/Worker 注册；真实 planner、hot adapter/credential/lifecycle、fair queue、capacity/freeze 均已接线 | 受 #92 ProductUsage 持久化合同未出现于当前工作树阻塞 |
| #128 Z2-ACCEPT | external_blocked | Core 1741 tests：1670 pass / 71 env-gated skip / 0 fail；Contracts 52/52；管理面 Playwright 3/3；票据相关真实 PG 52/52 | #92 跨包依赖 + 三模态同 CatalogModel 双渠道/live fault-injection 外部证据未满足，严禁发布或宣称整包完成 |

## 验证结果

- Core 全量：1741 tests，1670 pass / 71 env-gated skip / 0 fail；Core typecheck 通过。
- 票据相关真实 PostgreSQL 组：52/52，覆盖 credential broker/activation、fresh bootstrap、registry、hot adapter/lifecycle/CAS、planning、job timing/pagination、admin action/reconciliation、entitlement/pool/fair-queue/capacity/freeze。
- Contracts：52/52；typecheck 通过。
- Web 目标域：Node 109/109，Vitest interaction 15/15。
- 四服务 Playwright：3/3，含真实 action preview/execute/audit reason。
- Provider conformance：57 tests，54 pass / 3 付费 live skip / 0 fail。
- 启用全部 `TEST_DATABASE_URL` 的 Core 扩展门仍有 1 项继承的 Harness PostgreSQL 断言失败（`10 !== 3`）；该测试不属于本票据范围，票据相关 PostgreSQL 组为 52/52。
- Web 全量 typecheck 仍被本分支基线的 Composer/Result/Workbench 非 admin-supply 错误阻塞；目标文件无新诊断。
- 全仓 secret scan 与基线相比 0 个新增命中；扫描器仍因 10 个既有负向测试伪密钥样例返回非零，未发现真实凭据。

## 不得误报的红门

1. 未取得三模态“同 CatalogModel + official_direct + upstream_reseller + 独立账号/endpoint”的真机证据。
2. 未配置真实 `PROVIDER_LIVE_CONFORMANCE_HOOK_COMMAND` / transport fault injector。
3. 当前账号实测中，Tuzi 视频权限/定价仍拒绝；不能用不同 CatalogModel 的 accepted 探针拼成 C5。
4. #92 WT-B 的 ProductUsage 持久化预占/结算合同未在当前工作树出现；按属主红线，本包只能消费，不能自建替代账本。

因此，当前分支可以作为“内部代码修复与外部验收门禁”提交，但不得发布或宣称 #128 整包完成。
