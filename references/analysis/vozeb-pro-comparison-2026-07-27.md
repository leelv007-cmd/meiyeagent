# VOZEB PRO v0.0.2 对比评估（2026-07-27）

- 对象：`/Users/bin/Desktop/开发/开发/vozeb商业版` = **VOZEB PRO v0.0.2**（github csyqlz/VOZEB-PRO，AGPL-3.0，2026-07-26 全新发布，24 commits 全部同日 squash）。**不是**我们 07-15/16 研究过的旧 vozeb v1.0.0——旧版无数据库、文件库单机；PRO 是 Next.js 16 + PostgreSQL 全栈重写，旧版反面清单里的多项（浏览器真源、文件库、请求级结算无幂等）已翻新。本报告以 PRO 最新源码为准，旧拆解只作背景。
- 我方基线：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（D-101~D-138）+ 46 票 run 后的 main（2026-07-27）。
- 调研方式：5 路并行侦察（PRO 的 harness / 渠道路由 / 画布 / 产品化全扫 + 我方三面现状映射），全部结论带 file:line 证据。
- **许可边界**：PRO 是 AGPL-3.0 且为 csyqlz 的**新代码库**。2026-07-16 的 A2/A3 授权覆盖的是旧仓 canvas/render/retouch core（basketikun+csyqlz），**不自动延伸到 PRO**。对 PRO 一律只做规格/范式借鉴，不复制代码。

## 一句话总裁决

**架构层不需要参考——三个焦点面（harness/渠道/画布）我们全部领先一代；真正值得抄的是它的商业化"钱路"细节**（CDK、支付验签/对账/退款、防爆破、媒体变体管线），恰好全部落在我们显式后置的 E 门票面上，可作规格级参考直接进票。

---

## 二、三焦点面对比

### 2.1 Agent Harness 编排 —— 裁决：不参考架构，收 3 个微观件 + 2 个反面教材

**PRO 的形态**：不是 agentic loop。LLM 只被调用一次产出 DAG 计划（`agent-run-executor.ts:78-92` 强制 tool_choice），之后是服务端确定性拓扑执行循环（`agent-run-execution.ts:355-408`），全部完成后一次多模态复盘（`reviewCreativeOutputs`，`reviewed` 门闩只触发一次）。"智能规划"=参数自动填充+模型选型，非 ReAct。工程韧性件扎实：executionId 乐观锁抢占（每次写入带 expectedExecutionId，被抢占即自杀）、childTask 级断点续传、积分预扣+五处路径退款、`(runId,taskId,ordinal)` 幂等资产表、schema+断言+白名单三层参数校验。硬短板：**无自动重试**（错误文案还谎称"正在自动重写"，`agent-run-execution.ts:559`）、无 token 流式、SSE 实为每秒轮询 DB、上下文压缩=字符串截断、AbortController 挂 globalThis 无法水平扩展。**"短剧生产线"不在这套 harness 内**——是前端 useEffect 驱动的状态机（`drama/[id]/page.tsx:232-330`），关浏览器即停、整包 JSON 防抖 PATCH、零测试。Skill=提示词包+关键词字符串匹配（非 LLM 选择）。

**我方形态**：DBOS durable workflow（五段状态机 `intent_naming→context_injection→brief_compilation→execution_selection→assembly_delivery`，contracts 冻结）+ pg-boss tracer 双引擎；队列层 6 态+业务真相层 7 态+acceptance 三态正交；payload sha256 指纹幂等、lease token CAS、**未知即 reconcile 绝不盲目重投**、死信可 redrive；HITL 全套（pending-actions 收件箱、DBOS setEvent/recv 阻塞问答、30s 确认超时放行、48h 持有超时取消退额、ApprovalReceipt 一次性批准 consume 必须带 externalEffectId）；三账本计费在链路中的位置精确（报价冻结→提交事务内 reserve→entitlement projection 附 job→workflow 终态 settle/refund→补偿调度）。

**对比结论**：PRO 的整套 harness ≈ 我们 recorded 档+无 durable 载体的子集。它的"复盘回炉"我们在 image_text_note 已有更强版本（五维一致性评估回炉，D-116）。它的前端驱动流水线正是我们 D-007（工作流负责重执行，前端只呈现用户事件）明令禁止的形态——反向验证了我们的决策。

**收编项**：
1. **规划费与持久化的原子性护栏**（`refundAcceptedPlan`：规划扣了费但计划没能落库/被抢占就退费，五处调用）——我们 settle 挂 workflow 终态，结构性免疫，但"扣费与其对应产物必须同事务或有补偿"这条口径值得写进计费票的验收模板。
2. **反面教材：谎称自动重写的错误文案**——违反我们 D-116 拟人化交付=诚实陈述合同，作为对客文案评审的反例登记。
3. **反面教材：SSE=轮询 DB + AbortController 挂 globalThis**——我们做 D-114 对话流 SSE 时的架构反例。

### 2.2 渠道管理 —— 裁决：架构不参考，产品化交互强参考（3 项进票）

**PRO 的形态**：渠道(表)→绑定→逻辑模型(JSONB) 三层；用户只见逻辑模型名、扣费锚定逻辑模型（failover 后用户价格不变，`resolveLogicalBillingModel`）；密钥 AES-256-GCM（随机 IV+GCM tag+版本化前缀+占位 key 拒收）永不出服务端，查看明文留审计；进程内熔断（3 连败指数退避 30s→5min，全熔断保底最高优先候选防误报"没配模型"）。硬伤：**weight 字段配了不参与流量分配**（只是排序 tiebreaker，UI 却做成流量分配样式——悬空契约）、**unitCost 配了零消费方**、**渠道维度用量/成本记账完全没有**（point_records 无 channelId 列）、failover 四处复制且语义已漂移、协议层是某聚合商硬编码 preset 表非可扩展 adapter、Anthropic 非一等公民、熔断态进程内存多实例失效。

**我方形态**：五档执行模式（disabled/recorded/fixture/gateway/direct，fixture 硬门锁 APP_ENV=e2e）；AI SDK 底座的 OpenAI 兼容 port + ark/tuzi/volcengine-tts 媒体 adapter + recorded 影子；24 模型 catalog 带 direct/managed 通道；路由 7 种排除原因+**数据分级门**（contains_face/pii/medical 仅 domestic）；failover attemptLimit=2 且只在 `rejected_before_accept` 切换（accepted/unknown 一律 recover_without_resubmit——计费安全语义）；conformance 三模态 suite+故障注入+live gate（成本上限、证据指纹、`single_channel` 诚实降级）；ProviderCost per-attempt 追加账本；KMS/AAD 绑定密钥店。

**对比结论**：证据门、供给成本账本、数据分级路由是它完全没有的；它的"渠道成本记不了账"正是我们三账本设计要防的。但它有三个**运营交互**比我们成熟：

**收编项（绑 D-107 模型装配后台 / 运营期触发）**：
1. **粘贴 cURL/文档 JSON 自动解析渠道配置**（`channel-example-parser.ts`，436 行，纯本地解析不打上游）——把"读文档手填十个字段"变成"粘贴示例→自动识别"。进 D-107 后台装配的体验票。
2. **管理端一键健康检测**（真打上游四模态，20s 冷却）——我们的 conformance/live 门在 CI，缺 admin 侧"现在测这条渠道"按钮；方舟→tuzi 容灾切换时是运营刚需。
3. **运行时熔断**（含全熔断保底候选的半开逻辑，注释可直接当规格）——绑"第二官方渠道接入/多渠道运营期"触发点，不提前建；建则必须持久化态，不抄它的进程内存版。
4. **反面教材：悬空契约字段**——"配了但不生效的字段比没有更危险"，进我们后台表单的评审 checklist（每个 admin 可配项必须有消费方或显式标注 audit-only）。

### 2.3 画布应用 —— 裁决：不参考，冻结决策被反向验证；收 1 个范式

**PRO 的形态**：完全自研（零画布库依赖），DOM 变换层+SVG 连线层；9 种节点，连线语义=单向"喂料给生成配置节点"非通用数据流；Agent Run=Agent 往画布写节点（brief/brand/task/output 硬编码列布局）；撤销=全量快照栈（50 条上限）；LWW 整包 JSON 持久化。完成度可上生产，但无分组、无对齐吸附、无协作、无版本历史；React.memo 被内联回调整体废掉、模块拆分是物理搬运（成片死导入）、核心交互零测试、agent 任务节点有状态徽章渲染空白的实 bug（写入 `"ready"` 不在联合类型里）。

**我方形态**：Pro Studio 画布本就是 vendored 旧版 vozeb + 自研 kernel-host（授权复用），T38 已删 Polotno，整体处于 **D-127 FREEZE / entry-keep-running**；主链默认排版面是 Light Composer（模块排序/裁剪/替换/AIGC 标识+水印/四规格导出）。

**对比结论**：连原作者自己重写一遍仍没有版本历史/协作，且质量参差——**"通用画布已被开源商品化、不值得投弹药"的战略判断被 PRO 再次证实**，D-127 冻结正确。PRO 画布不构成解冻理由。

**收编项**：
1. **mention 编译器范式**（`@[node:id]` 按出现顺序编译成 `图1/视频1/文本1` 标签，同节点重复引用只编号一次，纯函数）——这不是画布专属，正对我们 **D-115 reference_transform"用几张图合成一张"与 D-121 引用上下文入口**：对话流里用户引用多个资产时的 prompt 编译，值得作为 ImageIntent/引用上下文的实现范式登记。
2. sessionEpoch+串行保存队列的前端异步竞态卫生——做 Composer 草稿自动保存时的参考模式（小件）。

---

## 三、超出三焦点的产品化金矿（全部 AGPL 规格级借鉴，不抄码）

这部分是本次对比的最大收获——PRO 的商业化完成度"介于能内测收钱与能规模化运营之间"，其钱路细节恰好覆盖我们 D-124 显式后置到 E 门的全部项。

### 3.1 CDK 兑换码（对我们最重要——D-124/D-128 试点期=兑换码+人工开通）

现成规格：字符集剔 I/O/0/1 防手抄歧义、`VZ-xxxxx-...` 格式；**hash（核销查找）+AES 密文（后台回显）+打码预览 三列并存**；`cdk_redemptions PRIMARY KEY (cdk_code_id, user_id)` DB 级"一人一码一次"；核销六道校验+幂等入账（`cdk:${id}:user:${userId}` 幂等键撞 DB 唯一索引，并发双击绝不重复到账）；防刷三层（IP+用户限流 10 次/15min 的 `INSERT ON CONFLICT` 原子计数器、DB 约束、成功失败双写审计）；输入归一化随意大小写空格横线；批量生成碰撞重试、导出 TXT、关键词搜索把关键词 hash 后按 code_hash 精确匹配。
**它的缺口=我们的增量**：CDK 只能发积分不能发套餐/试用期（表无 plan_id）；我们的兑换码要承接"套餐/试用开通"，规格必须超出它。
**动作**：作为 E 门支付批（或试点兑换承接票）的规格核对清单引用本节。

### 3.2 支付（E 门②⑥ 的现成参考实现）

- 渠道：Stripe / 支付宝电脑网站 / 微信 v3 Native / **PayPly 通用 HTTP 适配器**（下单/回调/退款的 URL、模板插值、返回与回调字段 JSONPath、成功状态白名单全后台可配——接易支付类聚合商的正确姿势）/ manual（正好对我们试点期人工开通）。
- 验签四种真实实现：Stripe HMAC+时间容差+timingSafeEqual；支付宝 RSA2 排序拼串；微信四头+证书序列号+AEAD 解密（强校验算法与 key 长度）；**验签失败也落库再抛 401**。
- 掉单补偿：`payment_provider_events` 唯一索引 (provider, event_id) + **claim/release 三段式**（抢占处理、失败释放让支付商重试）、无 event_id 用内容摘要当确定性 ID、**迟到回调可救回已超时订单**、超时关单=惰性触发+维护端点双轨。
- 对账：管理员粘 CSV，表头别名覆盖中英文（含"商户订单号/total_fee/payer_total"），四类异常码，异常列 GIN 索引。
- 退款：claim 两阶段（事务内抢占置 refunding→事务外调支付商→失败回滚 paid/pending 保持/成功回收积分防负+回落 plan），幂等键 `billing-order:${id}:refund`；自陈无部分退款。
**动作**：E 门②⑥ 开票时把本节作为票面规格与测试用例来源（尤其验签失败落库、迟到回调救单、claim/release 这三个反直觉正确细节）。

### 3.3 积分/额度机制里值得记的三件

1. **每日额度懒生成钱包**：`(user_id,date)` 主键懒建+懒结算，无 cron；当日套餐变更保留已消费量重算；扣费先日额度后永久（保护付费资产）；跨日退款差额记 `dailyExpired` 计损且流水文案显式标注。若我们上"试用日额度"（D-128 试用开关延伸），照这个模式。
2. **幂等与"一笔消费最多退一次"下沉为 DB 部分唯一索引**（`point_records_idempotency_idx` + `refund_source_idx WHERE type='refund'`），应用层再撞 409——与我们三账本口径一致，可作 E 门账务票的验收措辞。
3. 余额不足=可行动错误（前端 pattern 归类+独立状态+生成前同套倍率预估）——对客体验细节，进 D-123 缺额提醒的文案票参考。

### 3.4 其他值得核对/借鉴的散件

- **引用保护删除**：删素材前一条 CTE 跨 5 张业务表全文计数引用，被引用的跳过并回报 blocked 清单；S3 删主对象连带清 WebP 变体。→ 对照我们 OwnedAsset 生命周期是否有等价"删除前引用核查"不变量（值得专门核对一次）。
- **脱敏备份**：导出剔 passwordHash/email/SMTP 密码/全部渠道 apiKey/CDK 全块；导入**防锁死后台校验**（无可用管理员即取消）+导入前自动 safety backup 只留 3 份；**用户自助导出**40+字段黑名单并自动剔除 data:/blob: 内联媒体与带签名参数的 URL（防导出件夹带可访问私有对象的链接）。→ E 门③删除/匿名化票的字段黑名单直接参考。
- **邮箱验证码防爆破**：code_hash 存储、attempts>5 自动作废，且 **EmailCodeAttemptError 特殊化——校验失败仍提交事务只为持久化爆破计数**（回滚会清零计数，很细的正确性）。→ R 门①注册邮件链路核对。
- **WebP 变体管线**：内容协商（sec-fetch-dest+accept）出 WebP、宽度收敛有限档位（防缓存投毒）、单飞转码缓存、ETag/304/Vary、`?download=original` 拿原件、S3 预签名 TTL 分级（预览 120s/原件 600s/流 3600s）、变体随主对象删。→ 结果中心/素材库性能打磨票参考。
- **生成运维台**：每任务展开 per-attempt `{attemptNo, channelId, model, status, pointsCost, error}` + 渠道运行时健康并列——"扣了钱没出图"的客服证据链。→ 我们 task_audit/explainPlanDecision 已有底子，试点期补 admin 聚合视图时参考。
- **安装向导**：显式初始化门（空库连上不自动建表，必须 `/api/install/initialize` 触发）与我们 provision 只 ENSURE 不 wipe 同哲学；schema 管理=幂等全量 DDL 无 migration runner，**不学**（我们有真迁移体系）。
- **部署矩阵**：5 个 compose 变体（含 512MB lowmem、宝塔 host-network+trusted proxy hops）、compose 变量校验器带中文报错、healthcheck 用 node fetch 不装 curl——开源分发工程做得好，与我们 SaaS 主线无关，仅记档。

### 3.5 反面教材清单（进架构评审 checklist）

| 坑 | 教训 |
|---|---|
| auth 域写操作=全表 DELETE+逐行 INSERT（建用户/CDK/公告都重写整域） | 流水表增长即拖慢无关写路径；热路径必须增量写 |
| 上游 2xx 结算后的下游失败不退费，CHANGELOG 显示逐个补洞 | 结算必须挂业务终态（我们已是），不挂传输成功 |
| weight/unitCost 配置字段无消费方 | admin 可配项必须有消费方或显式标 audit-only |
| 审计/生成日志无保留期（PG 模式） | 我们的合规留痕要配保留策略 |
| SSE=每秒轮询 DB；熔断/中止态挂进程内存 | 水平扩展前提下状态必须外置 |
| 前端 useEffect 驱动多步流水线 | D-007 反向验证：重执行必须在服务端 durable 载体 |
| 错误文案谎称"正在自动重写" | 对客文案=诚实陈述（D-116） |

---

## 四、我们明显做得更好的七点

1. **Durable 编排**：DBOS 五段状态机+lease CAS+unknown→reconcile+死信 redrive vs 它 fire-and-forget、无自动重试、短剧线靠浏览器活着。
2. **钱的架构**：三账本分离（usage reserve/settle、GrantLot FIFO、ProviderCost per-attempt）+报价冻结+终态结算+exactly-once 不变量测试 vs 单积分表、代理层请求级结算、渠道成本零记账。
3. **HITL 是产品合同**：ApprovalReceipt 一次性批准绑定精确成品/账号/成本、consume 带 externalEffectId、超时放行/持有超时取消退额 vs 它只有画布 op 确认弹窗和短剧人工审核档位。
4. **能力=证据**：fixture/live 门、provider-live CI 成本上限+证据指纹、`single_channel` 诚实降级、readiness 九探针 vs 它健康检测纯手动且不喂运行时。
5. **发布与合规面**：平台变体+assisted 交接回执状态机（"已交接≠已发布"硬不变量）+AIGC 标识+权利门 vs 它完全没有发布/合规故事（纯工具）。
6. **垂直领域层**：ContextBundle 六维编译+fence 语义、事实忠实门、exactText 校验 vs 它零领域层。
7. **质量过程**：3500+ 测试、e2e 硬门、conformance/故障注入 vs 它核心交互与短剧线零测试、死导入成片。

## 五、它诚实领先我们的四点

1. **今天就能收钱**：套餐/订单/四渠道支付/退款/对账/CDK/公告全链在跑——我们是刻意后置（D-124），但它把 E 门的参考实现替我们踩完了。
2. **渠道运营交互**（cURL 解析器、一键健康检测）比我们的手填配置成熟。
3. **自部署分发工程**（安装向导三步、五档 compose、防锁死后台）——非我们赛道，但完成度高。
4. **媒体服务细节**（WebP 协商变体、签名 TTL 分级、Range 完整支持）比我们当前媒体面精细。

## 六、借鉴清单（按门/触发点归位）

| 优先 | 项 | 落点 |
|---|---|---|
| P1 | 支付验签四实现+事件 claim/release+CSV 对账+退款两阶段 | E 门②⑥ 票面规格与测试用例 |
| P1 | CDK 规格核对清单（+我们要扩套餐/试用型兑换） | 试点兑换承接 / E 门支付批 |
| P1 | 自助导出字段黑名单+签名 URL 剔除 | E 门③删除/匿名化 |
| P2 | 渠道 cURL 粘贴解析器 + admin 一键健康检测 | D-107 模型装配后台体验票 |
| P2 | 邮箱验证码 attempts 持久化(回滚不清零)+防爆破分层 | R 门①注册链路核对 |
| P2 | 生成运维台 per-attempt 证据链聚合视图 | 试点期客服排障票 |
| P2 | OwnedAsset"删除前引用核查"不变量核对 | 主线核对（一次性） |
| P3 | WebP 变体管线（协商+档位收敛+单飞+TTL 分级） | 结果中心/素材库打磨 |
| P3 | 每日额度懒钱包+dailyExpired 计损 | 若上试用日额度时 |
| P3 | 运行时熔断（持久化版） | 第二官方渠道接入时 |
| P3 | mention 编译器范式（图1/视频1 引用编译） | D-115 多图合成 / D-121 引用上下文 |

## 七、材料索引

- 本轮五路侦察结论已内嵌 file:line 于正文；PRO 源码在 `/Users/bin/Desktop/开发/开发/vozeb商业版`。
- 旧版分析（背景用）：`vozeb-borrowing-report-2026-07-15.md`(+xcheck)、`vozeb-方案合集-2026-07-16.md`。
- 我方现状锚点：DBOS workflow `apps/core/src/p1/harness/dbos-workflow.ts`、三账本 `apps/core/src/p1/product-billing/`、五档执行模式 `apps/core/src/p1/model-supply/runtime-config.ts:587-606`、assisted 交接 `apps/core/src/p1/result-delivery/assisted-receipt.ts`、Pro Studio 冻结 `mkfast-template-main/src/routes/pro-studio.tsx:1-4`。
