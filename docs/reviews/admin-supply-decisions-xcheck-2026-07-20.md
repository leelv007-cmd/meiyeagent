# 后台可视化 + 多渠道模型供应决策交叉复核报告（2026-07-20）

- 对象：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md` D-047~D-071（后端管理平台可视化 D-048~D-057/D-070；多渠道模型供应 D-058~D-069/D-071）
- 方法：6 路 Opus 子 agent 并行——4 路事实核验（后台代码实证 / 供应链代码实证 / 首轮增量+研究包引用核验 / 文档一致性与决策冲突）+ 2 路最佳实践评审（后台方案形态 / 供应领域模型与路由凭据设计），主会话交叉裁决。
- 复核基线：HEAD `c124df6`；后台前端实际位于 `mkfast-template-main/`（TanStack Start，pnpm workspace 三成员之一），`apps/canvas` 为画布子应用、无 admin 路由。

## §1 总裁决

**事实层过硬：零 P0。** 24 条决策引用的实体、页面、机制、研究包结论全部实锤存在且转述忠实；"尚未实现"类表述与代码 0 命中一致，无一条决策建立在错误事实上。需要回改的是 7 处 P1 口径/血缘问题（会误导拆票）+ 约 11 处 P2。

**最佳实践层：方向全部站得住，问题集中在"首轮铺得偏大"。** 工具边界（Cloudflare 只读、权限合同先行、原生壳不引第二运行时、四层供应模型、版本化路由、权益栈、自建控制面拒绝网关）均判最佳实践；建议收敛的是 5 个点：D-055 assign/ack、D-054 状态合成引擎、D-056 全能力骨架先行、D-060/D-066 凭据六态+SupplyPool 实体化、D-069 媒体双渠道故障注入强度。

## §2 事实核验 P1（建议回改文档，均为口径修正、不动决策本体）

| # | 决策 | 问题 | 证据 | 修正 |
|---|---|---|---|---|
| F1 | D-048/D-051 | "七类页面"与枚举 8 个名字自相矛盾；健康非独立页，是审计页内区块 | 仅 7 个路由 `mkfast-template-main/src/routes/admin/{models,templates,integrations,plans,redemptions,users,audit}.tsx`；健康=`audit.tsx:72` `AdminOperationsHealth` | 统一为"7 个路由页，健康作为审计页内区块"，防止误开"健康页迁移"票 |
| F2 | D-057 | 措辞低估权限缺口：读起来像"部分能力权限未全覆盖"，实际是纯二元 admin 门、能力级权限零存在 | `admin-middleware.ts` `ADMIN_ROLE='admin'`；`admin-config/foundation-module.ts:739`、`model-supply/foundation-module.ts:3575` `actor==='admin'||adminActorIds.has(userId)` | 证据边界改为"现有仅二元 admin 门，能力权限合同需从零建设" |
| F3 | D-060 | strict BYOK 无回退隔离已有现成实现，文档未指认迁移基线，拆票可能从零重建 | `foundation-byok-ledger.ts`：`byok_strict`+`byok-strict-no-fallback-v1`+`providerRetryDisabled:true` | 补"现有 FoundationStrictByokLedger 为迁移到 CredentialAccount scope 的既有基线，扩展非重建" |
| F4 | D-066 | `ProductUsageLedger`/`ProviderCostLedger` 是不存在的名字，按名搜索 0 命中会诱发重名重复建账本 | 实际=GrantLot 账本（`p1/foundation/grant-lot.ts`、PostgresGrantLotLedger）+ `FoundationModelSupplyLedger.appendProviderCost`（`foundation-ledger.ts:340`） | 括注实际实现名，声明复用其 schema |
| F5 | D-063 vs D-050/D-051 | 分配流"必须明确选择目标工作区"与"workspaceId 不作为运营选择项"边界互撞且未声明 Supersedes（有一致解读：选择只出现在账号详情下钻层） | doc 行 960/975/1136 | D-063 补"workspace 选择仅在账号详情→分配管理下钻流出现，不进一级导航"，并标注对 D-050 边界的受限例外 |
| F6 | D-056 vs D-067/D-068 | 两个"首个开发增量"（AP 骨架 vs MP 端到端）先后/依赖未写死，MP 票不知能否假定 capability registry 已存在 | doc 行 1039/1189/1203/1239 | 与 §4-C3 合并处置（见下），二选一：写明依赖 或 合并为同一增量 |
| F7 | D-058/D-059/D-062 | 系统性错引 D-029 为模型目录/Auto 路由母决策；本文档 D-029 实为"Day-0 同界面"，真正母决策是 D-044（+P1 模型供应规格） | doc 行 691/891/1072/1086/1127 | 三处"D-029"改为"D-044（及 P1 模型供应规格）" |

## §3 事实核验 P2（低危，随手改）

1. D-060：当前主装配源是裸 `'env'`（`foundation-module.ts:329`），非"迁移期 env_fallback"；口径改"env 目前是主源，迁移期收敛为受监控 env_fallback"。
2. D-066：产品侧 per-workspace 并发（`generation-runtime.ts:504`）与 per-plan queuePriority（`plans.ts` 0/1/5/10）已存在，本决策新增的是供应账户级容量隔离与公平队列，明示以防重复建产品侧限流。
3. D-058：RouteSnapshot 概念广泛存在但无单一权威类型定义（含 StrictByokRouteSnapshot、checkpoint 内嵌形态），迁移前需先统一规范类型。
4. D-070：凭据/探针/发布回滚/路由模拟/质量/健康实为分布在 models/integrations/audit 三个路由页内的区块，非独立"页面"。
5. D-048：审计能力落点在 Foundation 层 `p1_command_audits`（`foundation/postgres-repository.ts:50`），非 admin-config 模块；CAS/回滚才在 admin-config。
6. D-067：superseded 徽章应加限定"仅首增量范围被 D-068 取代，MP 端到端结构继续有效"，防止整套 MP-01~MP-08 被读作作废。
7. D-047：补前向指针"（2026-07-20 D-072 将④提前到③之前）"。
8. D-064：补"medical/health 指内容数据敏感度，不等同 D-025 医美品类；首轮不因存在该数据类而承接医美内容"。
9. 文末"当前待验证"章节：加范围说明"本表仅为 Wave 1/Harness 遗留集；D-047 起以各决策 inline 待验证为权威"；"当前无待拍板项"改为"2026-07-17 合并评审批已清空；下轮 UI（D-072+）待拍板见各条"。
10. D-057：权限域清单补"渠道/部署生命周期动作（隔离/排空/恢复）"或在 D-070 明示动作→权限域映射。
11. D-071：组件枚举补 Casbin（policy-rbac.md 实评 4 候选）；可注明 OPA/Cedar 的 decision/reason-code 合同已作 P0 设计借鉴、仅运行时依赖延期。

## §4 研究包引用核验：全部忠实

- D-053 的 Cloudflare A/B/C 矩阵、"Observability Query API 需 Write 权限故首版排除"——`cloudflare-admin-boundary-2026-07-19/README.md:47-95,178-185` 逐字支撑。
- D-056 的 AP-01/AP-02/AP-03——`admin-platform-research-2026-07-19/README.md:134-141` 定义一致。
- D-071 的全部组件裁决（Bifrost 隔离 PoC/Higress 条件 PoC/LiteLLM 仅参照/APISIX·Envoy·Kong·Portkey·Helicone 分档/admin 框架不替壳/OpenMeter·OpenFGA·OpenBao 挂触发条件/SecretStore+AWS Secrets Manager 为现行 P0）——六份研究包文件逐条对上，`runtime-from-env.ts:40-71` 证实 AwsSecretsManagerSecretStore 已装配。
- D-061 New API/Sub2API=仅技术指纹——与 `gateway-components.md:184-192` 完全一致。

## §5 最佳实践评审

### A. 判最佳实践、建议保持原判

- D-048 原生壳/不建第二管理运行时；D-052/D-053 Cloudflare 只读+签名 handoff（全集最强项，Vercel/Netlify 式标准做法）；D-057 服务端能力权限合同+默认拒绝+RBAC UI 延期（二元 flag 与 OpenFGA/Cedar 之间的正确中点）。
- D-058 四层供应模型（CatalogModel/ProviderProfile/ExecutionChannel/Deployment 对应 LiteLLM model_name/litellm_params、Portkey virtual key/config 的分层逻辑，且是第三方中转+双账本+数据等级三个真实约束逼出来的）；ProviderProfile↔ExecutionChannel 不合并、CredentialAccount 不并入 Deployment，均正确。
- D-059/D-065 版本化发布+拒绝在线自学习改权（规避网关自动 fallback 隐藏尝试链）；"质量门→健康容量→成本优化"分层=业界共识（Envoy 先 health-check 再 LB）。
- D-063 权益栈全条（EntitlementPolicy+有期限 AccountAllocation+五层合成+append-only 事件，对照 Stripe entitlements/Lago 为正解，Core 已有 UsageEvent reserve/commit/refund/compensate 支撑）。
- D-071 自有核心+分层复用：**"文本走成熟网关库"混合形态被证伪**——LiteLLM=Python、Bifrost=Go，TS 栈无进程内等价物，引入即 sidecar=第二常驻服务+第二数据栈；且文本是三模态最简单一块（AI SDK 已覆盖），外包最简单、自建最难是最差切法。TS 侧缺的 cooldown/circuit/加权内核在已有 candidate planning 上增量自建更省力。

### B. 判合理但可收敛（需拍板的决策修订建议）

| # | 决策 | 建议 | 理由 |
|---|---|---|---|
| C1 | D-055/D-057 | 首版删 owner/assign/ack 工作流，只留只读异常列表（root-cause 去重+严重度排序+下钻+新鲜度）；D-057 同步删/延期"事件确认与指派"权限键 | D-057 首期是单一受信管理员，无第二人可指派；ack/assign 是值班概念，与 D-040 运营延后同向；现有 pending-actions 投影+OperationalMetric 已够组异常列表 |
| C2 | D-054 | 明确"依赖映射=展示/反查查找表，非自动严重度传播图"；能力状态由各域自报，去重只在 incident 源级 | 依赖图严重度传播引擎是难测新代码与错状态 bug 经典来源；展示 join 可达成同样的"一故障映射多能力" |
| C3 | D-056（并处置 F6） | "全能力横向骨架先行"改为：详情合同类型先定（~1天）→ 供应/队列/权益等已插桩域做深（=D-068 MP 纵向落点）→ 其余域静态 manifest 存根（`not_instrumented`+owner+下钻现有页）→ 异常首页由真实上报域组合；骨架与供应纵向合并为同一增量，CF API broker（CF-02/03）不进首切，先 deep-link+自有探针 | 10 域存根手维 registry 会漂移成装饰索引；两个"首个增量"抢跑的排序问题就地消解 |
| C4 | D-060/D-066/D-058 | 凭据生命周期收敛为 `pending→active→retired` 三态主干 + tested 作激活前置门 + draining 仅异步媒体子状态；SupplyPool 推迟实体化，首轮以 `CredentialAccount.poolScope` 字段表达共享/专属（RoutePolicy 保留不降级） | 六态+排空对首轮 2-3 家供应商偏重；D-066 自述专属池是"显式例外"，等企业专属池真实出现再升实体 |
| C5 | D-069 | 双渠道+真实故障注入首轮只要求文本 operation 达成（故障注入最廉价，足以证明路由/隔离/切换机器）；图片/视频首轮各一条 live_verified 单渠道打通完整异步 lifecycle 合同，其第二渠道+故障注入进入紧邻下一增量 | 三模态×双渠道×故障注入×双来源是笛卡尔积，热装配/凭据 broker/双账本全是新地基，同时上三链 bug 难归因。**注意：此条收窄用户已纠偏拍板的 D-069 验收强度（三模态闭环本身保留），必须用户重新拍板** |
| C6 | D-059（轻） | cooldown/circuit/半开探针参数直接采用 LiteLLM router（`cooldown_time/allowed_fails`）/Envoy outlier detection 成熟默认，不自行标定 | 待验证项省一轮标定 |

## §6 建议处置顺序

1. **机械回改**（不改决策本体，仅口径/血缘/枚举）：§2 的 F1~F5、F7 + §3 全部——可一次编辑落盘。
2. **需拍板**：§5-B 的 C1~C6（其中 C3 同时闭合 F6；C5 触及用户已明确纠偏的 D-069，为最需慎重的一条）。拍板后按项目惯例即时写回决策文档（修订/Supersedes 条目）。
3. 拆票前置提醒：MP/AP 票引用实体名以回改后文档为准（尤其 F3/F4 的既有实现指认，避免重复建设）。

## §7 处置结果（2026-07-20 用户拍板，已全部落盘）

- **C1 采纳**：D-055 首版=只读异常列表，ack/assign 延后；D-057 移除对应权限键。用户确认核心前提「后台只有一套管理员角色权限」。
- **C2 采纳**：D-054 状态各域自报+依赖查找表，不建传播引擎。
- **C3 采纳**：D-056 首增量改形态，与 D-068 供应纵向合并为同一增量（F6 就地闭合）；CF API broker 不进首切。
- **C4 部分采纳**：凭据三态主干采纳；**SupplyPool 维持一等实体**——用户拍板：企业专属池是代运营/陪跑高价值客户的核心交付服务，属产品服务本体而非边缘例外。
- **C5 否决**：D-069 维持三核心 operation 各双渠道 live_verified+真实故障注入——三模态是主力生产功能，供应可行性未经验证则交付本身存疑。
- **C6 采纳**：熔断参数采用 LiteLLM/Envoy 成熟默认。

落盘位置：处置决策=设计文档 **D-080**（受影响决策 D-054/D-055/D-056/D-057/D-059/D-060/D-066/D-069 状态行均已加指针）；机械回改批（F1~F5、F7 + P2 全部 11 项）已同批写入原文。注：并发 Composer 讨论会话占用了 D-079 编号后改号 D-081，D-079 现为空号。
