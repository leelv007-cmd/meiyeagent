# 美业内容 Agent 项目全面开发 Review（交叉复核修订版）

> 日期：2026-07-24  
> 评审固定点：`main@f2b8c3aadb89c96d43f84381c2c34c18dec51ab0`  
> 当前候选：上述 HEAD + 20 个 tracked 修改（`+656/-336`）+ 5 个 untracked 条目  
> 主参考：[beauty-marketing-agent-product-design-2026-07-17.md](../design/beauty-marketing-agent-product-design-2026-07-17.md)  
> 结论口径：`implemented`、`contract verified`、`runtime verified`、`live verified`、`release verified`、`merchant validated` 六级严格分离。  
> 修订说明：已吸收同日 Agent Team Review 中可复核的架构、性能与维护性发现，并统一合入、试点/发布、发布工程和规模化四类门槛；不采纳“主链全部落地、综合 B+、无阻断”的总体结论。

## 1. 执行结论

项目不是“只有方案、没有产品”，也不是“已经可以生产发布”。更准确的判断是：

- **底层能力成熟度较高**：ContextBundle、ContentPackage、OCC、Result Center、DBOS Harness、模型供应、权益/账本、回执、审计与大量合同测试均有真实实现。
- **主产品旅程仍是部分完成**：当前生产首页已切到 Composer、三创作对口和六张快捷卡，但主动推荐、Day-0 示例、五类任务的完整发布包、跨三模态连续闭环仍未完成验收。
- **当前 Composer 统一主干候选不可合入**：8 个正式 Recipe 只有 2 个能通过新 admission；Context 事实与 Recipe 来源槽位断裂；Day-0 身份、Quote/Route/幂等和当前浏览器硬门尚未收口。
- **三模态“能执行”不等于“三模态产品闭环完成”**：文案主链相对完整；图片/视频已能生成并回写 Asset，但仍缺完整 MarketingPackage、采用和交付合同。若只验收底层 Harness，这是产品化缺口；若要宣称三模态首轮完成，则是试点/发布阻断。
- **生产发布明确阻塞**：部署 workflow 不生效，Cloudflare 生产单元未建立，`main` 无保护，readiness 未完整接线，Provider 证据不绑定当前 SHA，恢复演练和四单元 release manifest 缺失。
- **安全存在上线阻断项**：可见文案红线可绕过、敏感素材数据分类可降级、撤权/过期素材仍可能外发、依赖审计存在 11 个 high，另有内部错误泄漏与公开测试路由。
- **性能余量已进入预警区**：主包 gzip 约 329 KiB，接近 350 KiB 预算；若干全量 workspace 读写、N+1 查询、轮询与内存聚合路径在真实规模下会放大。

因此，本次总评为：

| 维度 | 结论 | 说明 |
|---|---|---|
| 功能实现 | **部分完成，底座强** | 当前 Composer 候选有确定性合入阻断，三模态产品合同未闭环 |
| 与规划匹配 | **部分匹配** | 新 IA 基本一致，经营循环和完整包未闭环 |
| 架构 | **方向正确，写路径与模块边界需收敛** | canonical 对象优秀，但仍有旁路和超大模块 |
| 性能 | **当前可运行，规模化风险高** | 主包、全量投影、轮询、内存聚合均需治理 |
| 安全 | **不可上线** | 内容真实性、素材政策、SCA 和错误边界存在阻断项 |
| 可维护性 | **中高风险** | 测试多，但 god modules、契约重复、文档/CI 漂移严重 |
| 产品完整度 | **“底座较完整、闭环部分完成”** | 不是完整的持续宣发经营 Agent |
| 发布就绪度 | **BLOCKED** | 不具备 staging-ready / release-ready / production-ready 证据 |

## 2. 评审边界与证据方法

### 2.1 当前状态必须分三层

1. **Committed HEAD**：`f2b8c3aa`，可引用现有 GitHub CI，但不能代表未提交变更。
2. **当前未提交候选**：正在切换 Composer 提交主干；包含关键 untracked BFF/client/route resolver 文件，尚不是可复现提交。
3. **外部发布状态**：Cloudflare、Provider、网络、恢复、保护环境和真实商家验证，不可由本地绿灯推导。

若把三层混成一个“完成度”，会同时产生两种错误：

- 把已经合入的 Pro Studio K1–K7 写成未实现；
- 把尚未重新验收的 Composer 工作树写成已完成或已发布。

### 2.2 当前权威链

本次没有把 7 月 17 日文档当作静态初稿。设计正文已追加到 D-100，评审同时使用：

- 当前产品设计正文，尤其 D-073～D-100；
- P0、P1、Pro Studio 当前 Spec；
- ADR-0010、ADR-0011、ADR-0012；
- 当前代码、测试、浏览器运行结果及 7 月 23 日 Pro Studio 证据。

其中 D-073～D-076 已把前台收敛为一个 Composer、三创作对口和六张快捷卡；“五类宣发入口”继续作为任务语义与完整包验收合同，不等于必须显示五个固定按钮。

### 2.3 门槛与严重度定义

旧版把合入、试点、生产发布和规模化问题都压成 `P0/P1/P2`，不利于排期，也容易被误解为同一类线上事故。修订后以以下门槛为主，历史 P0/P1 编号仅保留在证据索引中：

- **M — Merge blocker**：当前 Composer 工作树合入前必须关闭；否则正式配置、Day-0、账本或当前主 seam 会确定性失败。
- **R — Pilot/Release blocker**：封闭试点或生产发布前必须关闭；否则成品真实性、素材外发、完整营销包、唯一事实链或依赖安全不可信。
- **E — Release-engineering blocker**：必须由同一 SHA 的部署、readiness、Provider、网络、恢复和保护环境证据关闭。
- **S — Scale debt**：当前小数据量可能可用，但真实试点扩大前必须有压测基线、容量预算和治理计划。
- **P — Product-completeness debt**：不一定阻断底层运行，但会使产品停留在“能生成”而不是可持续经营闭环。

任何发现都必须注明它属于当前未提交候选、已提交代码还是外部运行状态，不能把 WIP 风险写成已经发生的生产事故。

## 3. 产品规划—实现矩阵

| 能力 | 当前实现事实 | 判断 |
|---|---|---|
| 单一 Composer + 三创作对口 + 六快捷卡 | 生产首页已挂载；六卡与 D-075/D-082 基本一致 | **已实现 UI 骨架** |
| 五类宣发任务 | 语义已进入 Recipe/Harness，但没有五类逐条完整旅程证据 | **部分实现** |
| 今日推荐 / 热点机会 / Recent | 后端与组件存在，生产首页未挂载；目前更像最近交付回放，不是主动机会发现 | **产品面未上线** |
| Day-0 与 Day-N 同屏 | Composer 同屏成立；渐进事实卡存在；示例门店未挂载；营销身份反而会阻断新用户 | **部分实现，有合入阻断** |
| ContextBundle | 优先级、能力过滤、确定性 hash、revision 冻结和生产读取已实现 | **底座已实现** |
| 素材与身份治理 | 权利/来源/身份模型较全，资产页可用；丰富筛选、反向引用、替换影响未完整接 UI | **部分实现** |
| 统一执行主干 | Snapshot、原子 shell/usage、持久幂等存储、Harness lease 均已实现 | **后台已实现，前台切换在途** |
| ContentPackage 唯一聚合 | OCC、不可变 revision、回执与公共投影较扎实 | **聚合底座已实现，完整包部分** |
| 文案完整 MarketingPackage | 有平台变体、结果工作区和流式能力 | **大部分实现，但默认候选策略/红线有问题** |
| 图片/视频完整 MarketingPackage | 能生成 Asset，但当前统一主干只写通用标题、空正文和单 Asset | **未达到完整包合同** |
| Result Center | 三媒介工作区、SSE、命令和历史已挂载 | **大部分实现，采用/返回/对象查询有断点** |
| 拿到文件 / assisted 交付 | ZIP、导出、handoff、assisted receipt 底座存在 | **部分实现，依赖平台 variant** |
| 自动平台发布 | 能力投影诚实为 0 个 `automatic_verified` | **未实现，当前不应承诺“一键发布”** |
| 结果信号与周复盘 | 手工信号和下一步动作已接；revision lineage 与服务端 PII 约束不足 | **部分实现** |
| Pro Studio D-099 | K1–K7 已有大量本地候选实现；39 项直接/单测证据，另有 waiver/B0/defer | **本地 parity 候选完成，发布阻塞** |
| Provider D-100 | 旧 SHA 曾有官方三模态本地连通 | **当前 SHA 无有效 live/release 证据** |
| 真实门店验证 | 设计仍要求 8–12 家门店任务回放和真实采用/结果验证 | **未完成** |

## 4. 合入、试点与发布阻断 Findings

### M-01：新 Composer admission 与正式 Recipe 合同不兼容

**证据**

- 新 Snapshot/admission 只接受 `xiaohongshu | douyin | video_account`。
- 8 个正式 Recipe 中，朋友圈使用 `wechat_moments`，套图、海报和三种旧内容复用没有 canonical platform。
- 逐项核验只有 **2/8** 可以进入新主干。
- 用户在 UI 中修改的平台没有进入提交 Body，服务端仍使用 Recipe 默认值。

**影响**

- 六张快捷卡看似可点，实际 6 个正式 Recipe 会被服务端拒绝。
- 用户显式选择可能被静默覆盖，报价、执行和交付目标不一致。

**必须修复**

- 拆分 `contentPackagePlatform` 与更广的 `distributionTarget`；
- 用户确认的平台、交付物、模型设置进入服务端签名 preview/quote，并在 admission 中冻结；
- 用同一个 Recipe validator 覆盖发布时、提交时和全部正式 seed；
- 在合入前建立 8/8 seed 合同测试和三模态 HTTP/SSE/Result 旅程。

### M-02：Context 事实不能满足 Recipe 的结构化来源要求

**证据**

- `project_facts`、`campaign_facts`、`promotion_facts` 被建模成 MIME `text` 来源槽。
- admission 只从上传资产或 ContentPackage 匹配来源，不能用 ContextBundle 中已确认的门店/项目事实满足。
- 当前测试使用自造 Recipe，避开了正式 seed 的语义。

**影响**

用户即使已补齐门店资料，仍可能被要求上传“文本文件”；这破坏流内建档、最少输入和 ContextBundle 复用。

**必须修复**

把这些槽位改成明确的 structured fact requirement，由 ContextBundle revision 满足，并加入正式 Recipe × ContextBundle 的集成测试。

### R-01：图片/视频结果不是完整 MarketingPackage

**证据**

当前媒体 Harness 写入单 Asset、空正文和通用标题，没有 marketing evidence、CTA 或目标平台 variant；Result Center 的完整发布包又要求目标平台 variant。

**影响**

“生成成功”可能止步于单媒体文件，无法兑现平台成品、完整 ZIP、CTA、事实/权利状态和发布/交付合同。

**必须修复**

媒体回装必须生成完整 ContentPackage revision：营销证据、CTA、平台主版本、素材/权利引用和 manifest 一次写入；不满足时只能标为媒体草稿，不能标为完整 MarketingPackage。

**严重度边界**

- 若当前只验收“媒体 Harness 能生成并登记 Asset”，本项属于产品化 P1。
- 若要关闭统一三模态主链、公开六张 Recipe 卡或宣称首轮三模态完成，本项属于试点/发布阻断。

### R-02：可见文案可以绕过七条硬红线

**证据**

当前 validator 读取模型自报的 `factClaims`、`assetRefs`、`expressionIdentityRef`，不检查最终可见的 title/body/CTA。已复现：

```text
title = 国家认证五星机构，团购价398元
body = 到店即送全年护理
factClaims = []
assetRefs = []
=> passed: true
```

**影响**

模型只需漏报 claim，就能让虚假资质、价格、赠送承诺等进入可见成品；现有 recorded 7/7 绿灯不能证明内容真实性闭环。

**必须修复**

- 红线门必须解析并校验最终可见字段，不能信任模型自报 claim；
- claim extraction 使用独立、可审计的 deterministic/second-pass 结果；
- 建立“可见文本恶意、claims 为空”的对抗集；
- live red-team 不再 `continue-on-error`，`numTests` 不得为 1。

### R-03：敏感素材数据政策可被降级或绕过

**证据**

- 新 Composer route/media submission 把 `dataClass` 归一为 `public` 或留空。
- Canvas OwnedAsset resolver 未检查 `revokedAt`、`expiresAt`、`exportAllowed`、`privateRetrievalAllowed`。
- 因此含人脸、顾客案例或 PII 的素材可能绕过 fail-closed 路由政策，撤权/过期素材仍可能被 base64 后发给外部模型。

**影响**

跨境/第三方模型外发、撤权失效和素材权限边界不可信，属于隐私与合规上线阻断。

**必须修复**

- `dataClass` 由服务端根据素材事实推导，不接受客户端降级；
- dispatch 前重新校验当前权利 revision、过期/撤权和出口策略；
- resolver 默认返回 metadata/hash，不返回 bytes；只有已选 Provider dispatch 读取一次；
- 加入撤权竞态、过期、跨 workspace、敏感素材不合格路由的真存储测试。

### M-03：Day-0 被营销身份阻断，且恢复路径不完整

**证据**

- Composer 无身份时阻止提交，却展示错误的“请选择创作类型”提示。
- 多身份静默取按 `identity_id` 排序的第一条。
- 身份管理只在“素材”页；移动底栏却以“进度”替换素材入口。
- 这与“无身份回退门店官方中性表达”和 Day-0 零资产可用冲突。

**影响**

新用户无法完成首次创作，多身份用户可能用错品牌/IP，移动用户难以恢复。

**必须修复**

不要把身份简单改成模糊的可选字段，也不要伪造一条普通品牌身份。应冻结显式的中性表达语义，例如服务端权威中性身份 revision，或带 policy revision 的 `neutral | registered` 判别联合；多身份显式选择并记忆默认；区分查询失败/为空/未选择；恢复移动端可发现的素材/身份入口。

### M-04：当前浏览器硬门未覆盖新主线，部分 fixture 仍监听退役链路

**证据**

- 当前 Composer 已走 `/api/core/p1/composer/submissions`。
- 严格的 `uiux-day0-contract.spec.ts` 确实存在，并覆盖 isTrusted 点击计数、零前置表单和首 token；但普通 required PR journey 并不运行它。
- Z1 共享 fixture 仍等待已退役的 `create_creative_work` 与 `submit_creative_work`。
- 多个活跃旧 UI spec 仍断言已删除的首页、移动页和场景 chips。

**影响**

“严格测试文件存在”不等于“当前 required hard gate 已成立”。大量单测和旧旅程通过仍不能证明当前 Composer → Result Center → 采用 → 交付 → 刷新恢复主旅程。

**必须修复**

把现有 Day-0 严格断言迁入当前新 seam，并升级为 required browser gate：绑定新端点、新 schema、中性身份 fixture 和三模态；旧 UI specs 删除、归档或明确降级，不得继续充当硬门。

### E-01：生产部署、发布、恢复和分支保护均未闭环

**证据**

- Web deploy workflow 位于子目录 `.github/workflows`，GitHub 不会发现；命令 working directory 也不正确。
- Wrangler 仍是模板名、演示域名和全零 Hyperdrive。
- Cloudflare 实时核验无目标 Worker、无 Hyperdrive。
- `main` 未保护，rulesets 为空。
- protected readiness 要求九类 probe，主装配只显式接 Provider，生产将返回 503。
- RC E2E 要求 release manifest，但 workflow 不生成/下载它。
- 恢复 CLI 只验证 manifest，从不执行 restore；现有恢复证据为 partial。

**影响**

项目没有可重复的 staging/release/promotion 路径；任何“已生产就绪”声明都不成立。真实账号、密钥、Cloudflare 资源和 Provider 证据属于外部状态，但 workflow 路径、working directory、Wrangler 模板、probe 装配、manifest 编排和 restore tooling 属于明确的仓库实现缺口，不能整体排除为“外部门”。

### R-04：生产依赖审计报告 11 个 high

当前 `pnpm audit --prod --json`：

| 严重度 | 数量 |
|---|---:|
| critical | 0 |
| high | 11 |
| moderate | 13 |
| low | 2 |

高风险集中在：

- `sharp 0.34.5` / libvips：处理不可信图片受影响，需升级到 `>=0.35.0`；
- `next 16.2.10`：多项 App Router / Server Actions / SSRF / DoS / middleware bypass，需升级到 `>=16.2.11`；
- `postcss 8.5.10`：恶意 sourceMappingURL 任意文件读取/信息泄漏，需升级到 `>=8.5.12`；
- `fast-uri 3.1.3`：URL host confusion，需升级到 `>=3.1.4`。

**影响与边界**

“11 个 high”是依赖审计结果，不等于 11 个都已证明可利用。需要按 direct/transitive、reachable/unreachable、运行环境和输入边界逐项分析；其中 `sharp` 直接处理用户上传、Canvas 使用 Next.js，不能只以“transitive dependency”整体降级。High/Critical 未清零或没有正式豁免证据前，不进入 release。

**必须修复**

先升级 direct parents 并重跑全量合同/图片/Canvas 测试；将 `pnpm audit --prod` 或等价 SCA 加入 required PR gate，而不是只放在可选 RC job。

### R-05：canonical 写路径仍有旁路

**证据**

- Pro Studio adoption 直接锁表并更新/插入 ContentPackage，绕过统一 revision port 的 OCC、rights、audit、outbox 和 idempotency 语义。
- Harness 结果页可仅凭 `currentVersionId` 判定“已采用”，没有调用 `adopt_harness_candidate`；新包 variants 为空时仍可进入 Deliver。

**影响**

同一产品对象存在不同写入语义，可能出现错 revision、漏审计、漏回执和“看似已采用、实际无 adopted variant”。

**必须修复**

所有 adoption/adjust/delivery 统一经过同一个 ContentPackage semantic mutation policy；允许唯一受控 adapter 或存储过程执行 SQL，但不允许页面、Canvas、Pro Studio 或 delivery service 自建不同的 OCC、rights、audit、outbox 和 idempotency 语义。数据库角色应禁止其他业务模块直接写聚合表。

## 5. 其他合入阻断、产品完整度与规模化 Findings

### M-05：Quote 可改绑 Task，Coordinator replay 顺序也不正确

- 同一 confirmed Quote 可二次确认到另一个 Task，revision 不变；已动态复现。
- 当前前端还在 Coordinator 前单独确认 Quote，存在确认—预占窗口。
- Coordinator 在读取幂等 receipt 前执行 mutable admission；任务运行后 quote 会变为 dispatched/settled，同 key replay 反而被拒。

建议：Quote 对不同 Task 返回 `IDEMPOTENCY_CONFLICT`；Coordinator 先按 workspace/key/raw request fingerprint 读取 receipt，再对首次请求做 mutable admission；增加内存和真 PostgreSQL 并发/replay 测试。

### R-06（待真 PG 证实）：一次文案任务可能形成双 usage 账本

文案执行可产生最多 8 个 Structured Model job，每个默认 `productUsageQuantity=1` 且无 `billingTaskId`；Coordinator 又保留 1 个 canonical ProductUsage。

这是高可信静态风险，不是已经证实的重复扣费事故。需要先用真 PostgreSQL、故障重放和多候选执行证明是否产生第二个用户侧 ProductUsage；若证实，则为试点/发布阻断。无论结果如何，都应明确：

- Product 计费对象只由 Coordinator 创建；
- ProviderAttempt/ModelJob 只记录供应成本，不再创建 ProductUsage；
- 所有子 job 绑定同一 billing task/quote lineage；
- 用故障重放和 N 候选执行验证“用户只扣一次，供应成本按实记账”。

### P-01：主页仍不是“主动经营 Agent”

当前首页是必选创作对口、文本、上传、开始按钮、六卡与工具；`TodayRecommendationCard`、`ExampleStorePreview`、Recent/机会层未生产挂载。

这不意味着要恢复旧版五按钮或大机会流，而是缺少已确认的轻推荐：

- 为什么今天适合发；
- 使用了本店什么；
- 希望顾客做什么；
- 一个主推荐；
- 继续上次工作或诚实 Day-0 示例。

### P-02：默认生成三个文案候选并串行评分，违背“一个主推荐”

当前 copy 固定生成 3 候选，再逐个评分 3 次；与 D-023 “默认一个主推荐、备选按需展开”冲突，也额外引入多次 Provider round-trip。

建议默认执行 1 个主候选；只有用户展开备选或低置信/明显主观分歧时再触发差异化候选，评分并行化并设成本预算。

### P-03：Result Center 采用、返回、错误和对象查询不完整

- 来源只支持 dashboard/task-inbox；内容、Recent、通知、relay 丢 return state。
- GET 查询 `retry:false`，错误面无重试动作。
- 对象页读取完整 workspace Work/ContentPackage/assisted 集合，再在浏览器查找目标；每次 mutation 又全量失效。
- outcome signal 缺精确 package revision/publication id/recordedAt/supersede，前端可能把历史信号投影到当前 revision。

建议新增 object-scoped `result_workspace(workId,target)`；typed return allowlist；安全 GET 有界重试；signal 强绑定 revision/publication 和服务端记录时间。

### S-01：高风险内存与 I/O 放大

- Composer 最多 50 个素材；校验 hash 时调用 bytes resolver。按每项 10 MiB 计算，原始 bytes 约 500 MiB，base64 约 667 MiB，尚未计复制与对象开销。
- 视频下载单项可达 250 MiB，默认并发 4，先聚合 chunks 再 concat，静态峰值超过 1 GiB，复制时可能接近 2 GiB。
- Canvas 50 MiB 资产经 base64 JSON、多次 decode/copy、`zipSync`、整包 Response/Blob，阻塞事件循环并多倍占用内存。

这些数字是根据代码路径和上限推导出的静态峰值，不是已经实测的生产回归。建议先建立 1/10/50 个素材与 250 MiB 视频的 RSS、event-loop lag、吞吐和 backpressure 基线；随后以 metadata/hash inspect 代替 admission 读取 bytes，设置请求总字节预算，媒体下载和 ZIP 流式化，并限制并发。

### S-02：全量 workspace 状态与轮询架构不可扩展

- Operations 每个读请求串行加载约 22 张 workspace 表；写请求在 advisory lock 下全量 load/save。
- AsyncTaskCenter 在所有产品页后台拉 canonical history + video list；video list 存在 1+3N SQL，活跃时 5 秒轮询。
- 单视频 SSE 每订阅者每秒多次查询，并重复 parse/clone 全快照。
- 公平容量队列每 25ms claim，最长 30s，过载时单请求可触发约 1200 轮数据库竞争。

Operations 的根因不是文件太长，而是持久化把整个 workspace 当作单一聚合：写操作在 advisory lock 下全量 load/save，append-only 历史也参与反复物化。应先剥离 audit/task/creation 等 append-only 集合，再建立对象级 read/write port、aggregate-level OCC 和事件驱动失效；视频列表批量 join；SSE 共享 fan-out；容量队列改 notification/backoff，不允许高频空转。拆 service 必须晚于或伴随持久化边界拆分，否则只是搬文件。

### M-06：开发启动与 Harness 激活口径漂移

- 根 `pnpm dev` 宣称加载 `.env.example/.env` 后启动全部服务，实际子进程未收到完整必需环境；Core、Worker、Web/Hyperdrive、Canvas 无法按文档一键启动。
- `.env.example` 把 `HARNESS_DBOS_SYSTEM_DATABASE_URL` 描述为可选，但未配置时 Composer 路由不会装配，fresh clone 可能得到通用 404/失败提示。

建议新增单一 dev runtime profile 和四服务启动 smoke；开发默认拉起 DBOS system database；Web 对 capability 缺失给出明确不可用状态，而不是把主链缺失伪装为普通生成失败。

### R-07：认证 cookie、敏感管理操作与邮件日志仍需收口

- Web 运行时持续提示 `tanstackStartCookies()` 应为 Better Auth plugins 最后一项；当前顺序存在 Set-Cookie 丢失风险。
- 高影响管理命令应使用 recent authentication，角色/封禁/撤权判断不能依赖一小时 cookie cache。
- 两个邮件 Provider 在缺字段告警路径记录收件人、subject 和完整 HTML；认证邮件 HTML 可能包含一次性 token URL。

建议把 cookie plugin 移到最后并建立登录/刷新/登出响应头集成测试；对凭据、平台配置和商业化命令实施 step-up/MFA；邮件日志只记录缺失字段名，禁止记录 `to/subject/html`。

### R-08：Pro Studio entitlement 与发布口径不可信

Composer 未读取 entitlement 时静态 seed 默认显示 active；用户可能先看到“进入专业工作区”，再被 gate 拒绝。应使用 `unknown | locked | active` 三态并复用 canonical entitlement projection。

同时，K1–K7 已实现不等于发布完成：39 项直接/单测证据之外仍有 6 个分层项、2 个 B0、1 个 defer 和 9 个外部门。

### S-03：额度投影全历史重放与四次串行查询

`projectionFromStore` 每次读取 workspace 全部 entitlement 事件，再按资源顺序执行多次 `listUsageEvents`，且没有计费周期窗口或 snapshot。它位于额度展示和提交预检等热路径，随账号生命周期线性增长。

短期可把独立查询并行化，但 `Promise.all` 只减少串行 RTT，也会增加并发连接占用，不是治本。终态应优先采用一次 set-based SQL、当前计费周期窗口和月度 rollup/snapshot，并用 1k/10k/100k 事件的 `EXPLAIN (ANALYZE, BUFFERS)`、SQL 数和 p95/p99 验收。

### S-04：当前主包接近预算上限

当前 production build 主 client bundle 约 `1,046.17 kB`，gzip `329.18 kB`，距离 350 KiB 预算只剩约 6%。Vite 已发出 `>500 kB` chunk 警告。

建议对 Pro Studio、admin、Result 媒介面板和 Markdown/编辑器依赖做 route-level lazy loading；预算改为按入口和 route chunk 校验，避免单个总包掩盖首屏依赖。

## 6. 维护性与演进 Findings

### 6.1 超大模块与边界漂移

- `operations/application-service.ts`：约 10,078 行；
- `model-supply/foundation-module.ts`：约 6,371 行；
- `model-supply/index.ts`：约 5,647 行；
- `composer-home.tsx`：约 1,445 行；
- Result route/view、内容库也接近或超过 1,000 行。

应保留现有 facade/port，按用例逐个提取，禁止大爆炸重写。Operations 必须先拆持久化写边界；其他 god 文件也应以可验证用例为单位迁移，而不是一次性机械搬移全仓。

### 6.2 Composer DTO 在 Core 与 Web 重复

新请求/响应 schema 在 Core 与 Web 各定义一份，而仓库已有 `@meiye/contracts`。这会使跨端改动形成 shotgun surgery。应把 schema 移入 contracts，Core 只保留服务端 snapshot factory。

### 6.3 质量门文档与实际脚本不一致

- 文档称各包执行 Biome，但 Core `check` 只有 `tsc --noEmit`。
- Web Biome 全局关闭 hooks、unused、any、dangerous HTML 与多项 a11y 规则。
- Web route 目录中的 `.test` 文件被 TanStack route generator 当作 route，开发和构建持续产生警告。
- 当前 Knip 误报较多，不能直接作为 required gate。

Core Biome/Knip 是维护性领域的高 ROI，不是当前全项目最高优先级。Biome 先约束新增/修改文件；Knip 先建立已知误报基线并要求“新增不得增长”；不要在当前 Composer WIP 上制造一次性 179k 行格式化 diff。

### 6.4 文档状态漂移

7 月 22 日一致性报告仍称 K1–K7 无实现证据，但 7 月 23 日已合入大量实现。P0/P1/Pro Studio Spec frontmatter 仍是 `ready-for-agent`，无法表达：

- implemented；
- runtime verified；
- external blocked；
- deferred。

建议建立机器可读 authority/status manifest，并由 CI 校验文档状态与 evidence commit。

### 6.5 仓库体积与证据存储

Git pack 约 432 MiB；HEAD 至少 29 个文件大于 5 MiB，总计约 219 MiB。大体积视频应迁到 LFS、对象存储或 Release Artifact，Git 只保留 hash、manifest 和精选截图。

### 6.6 国际化与无障碍收尾

- Composer、Result Center、Pro Studio 仍有大量中文硬编码；Pro Studio 强制 `zh-CN + dark`。
- 高风险 Brief 检测依赖中文 regex。
- 200% 缩放只在纯函数测试成立，真实页面没有可靠监听同一 mobile breakpoint 内尺寸变化。
- 未选择创作对口时尝试 focus 不可聚焦的 radiogroup 容器。

### 6.7 RouteSnapshot 与 shared contracts 需要收敛

同名或近似 RouteSnapshot、Composer DTO 和跨端 schema 并存，依赖双向归一化器维持一致。目标不是再加一层 gateway，而是明确一个 canonical schema、给领域视图使用有语义的不同名称，并只保留从 canonical 向领域投影的单向 adapter。

### 6.8 Canvas/Core 与 legacy cutover 需要明确触发点

Canvas 当前同时承担 UI/BFF、数据库访问、迁移和部分领域运行时，Core 又拥有相邻业务事实。推荐 Canvas 收敛为 UI/BFF、Core 保持领域写属主、migration 由 release job 执行；若继续共享数据库，必须声明互斥表权限和唯一 migration owner。

Legacy ProductService 不必现在重写或删除，但必须登记退役判据，例如所有活跃 workspace 已迁移、legacy in-flight decision 归零并稳定 N 天。没有触发点的双路径会永久扩大测试面。

### 6.9 不为消除重复而一次改造全部事务与列表

通用 `withPgTransaction` 只适用于 transaction 语义真正一致的 repository；特殊 isolation、savepoint、retry 应继续显式表达。长列表先做 object-scoped query、cursor 和服务端过滤，再根据 DOM、INP 和真实数据量决定是否虚拟化，不能把虚拟化当作默认框架。

## 7. 浏览器产品审查

本次用真实本地 Core、Worker、Web、Canvas 运行了桌面与移动关键页面。以下是当前生产挂载，不是静态组件推断。

### 7.1 Landing：承诺超过当前交付能力

![Landing 当前页面](evidence/deep-review-2026-07-24/01-landing-page.png)

页面强调“一键发布”和发布后私信结果，但当前 `automatic_verified` 平台数为 0。应改为：

- 已验证能力：复制、下载、完整发布包、assisted 交接；
- 未验证能力：明确“暂不支持自动发布”；
- 只有逐平台 live gate 通过后再显示一键发布。

### 7.2 Composer：可用骨架成立，主动推荐与 Day-0 仍缺

![当前 Composer](evidence/deep-review-2026-07-24/02-dashboard-composer.png)

健康项：

- 单一 Composer、三创作对口、上传、六张快捷卡和 Pro Studio 入口已真实挂载；
- 没有把模型、额度和复杂参数全部前置给商家。

问题：

- 必选创作对口 + 身份缺失会阻断 Day-0；
- 没有 Today Recommendation、Recent 和示例层；
- 现有六卡还没有 8/8 admission 兼容证明。

### 7.3 Content / Assets / Store

![内容空态](evidence/deep-review-2026-07-24/03-content-empty-state.png)

![素材与身份](evidence/deep-review-2026-07-24/04-assets-and-identity.png)

![门店事实](evidence/deep-review-2026-07-24/06-store-facts.png)

内容、素材、身份和门店事实已经形成可用基础面，但仍是“多页面录入 + 局部闭环”；设计要求的任务内渐进补足、反向引用和替换影响尚未完全体现在用户旅程中。

### 7.4 Pro Studio

![Pro Studio 当前页面](evidence/deep-review-2026-07-24/05-pro-studio.png)

Web → Canvas 启动真实可用，且能力状态诚实显示“未激活”。这证明 K1–K7 不是空方案，但也清楚显示 Provider、价格、live evidence 与 Canvas Agent 等外部门仍未满足。

### 7.5 移动端

![移动 Composer](evidence/deep-review-2026-07-24/07-mobile-dashboard.png)

移动布局可用，但主表单较长，底栏缺少素材恢复入口，上传刷新恢复没有生产接线；需以真实 320/390/横屏/200% 缩放 browser gate 重新验收。

## 8. 测试、构建与验证结果

| 验证 | 当前结果 | 证据边界 |
|---|---|---|
| `pnpm check` | **通过** | Biome 覆盖 Web/Canvas；Core 实际仅 TypeScript |
| secret scan | **通过，0 findings** | 不代替 SCA、历史泄密扫描或运行时 secret 检查 |
| `pnpm typecheck` | **通过** | 同时完成 Web production build |
| Web production build | **通过，有警告** | 主包 gzip 329.18 KiB；route test 识别警告；chunk 超限 |
| `pnpm test` | **通过** | contracts、Web、Core、Canvas 与根级脚本全量完成；依赖真 PostgreSQL、真实 Provider 或付费凭据的 opt-in 用例按配置跳过 |
| 当前 Composer 定向测试 | **Core 26/26、Web 13/13 通过** | 主要是 unit/mock/memory，不是当前 browser hard gate |
| 当前 CI 脚本定向测试 | **36/36 通过** | 不证明外部发布 |
| `pnpm audit --prod` | **失败** | 11 high / 13 moderate / 2 low |
| 当前 HEAD GitHub CI | **通过** | 只绑定 HEAD，不覆盖未提交候选 |
| Provider live | **旧 SHA 曾通过** | 不绑定当前 HEAD/工作树，不是 protected release evidence |
| 当前 production E2E | **严格 Day-0 spec 存在，但未形成 required 新主线硬门** | 普通 PR 不运行该 spec；共享 fixture 仍监听退役链路 |
| staging / release / production | **BLOCKED** | 部署、readiness、manifest、恢复、网络、分支保护缺失 |

## 9. 值得保留的工程资产

以下不应在优化中被推倒重来：

- `@meiye/contracts` 的 Zod 契约基础；
- ContentPackage OCC、不可变 revision 与公共投影；
- DBOS durable Harness、恢复和审计设计；
- Coordinator 的原子 shell/usage/store 基础；
- Provider route、凭据版本、成本与 honest capability 模型；
- Result Center 的独立对象工作区方向；
- 较厚的 unit/contract/interaction 测试资产；
- secret scan、decision ticket guard、retirement gate；
- Pro Studio 对未验证能力的诚实降级。

优化的核心不是新建另一套系统，而是让所有入口都走这些已存在的 canonical 边界。

## 10. 最终判断

项目已跨过“原型”阶段，属于**功能底座较成熟、核心产品闭环和生产工程仍在收敛的开发候选**。如果按当前状态直接对外：

- 六张卡中多数可能在新主干被拒；
- 媒体生成不等于完整营销包；
- 红线与素材权利存在真实旁路；
- 自动发布与生产就绪声明缺乏证据；
- 当前 browser gate 不能证明新链路。

推荐按门槛推进：

1. **合入门**：M-01～M-06——8/8 Recipe、Context、Day-0 中性身份、Quote/Route/幂等、账本验证和当前三模态 browser seam。
2. **试点/发布产品门**：R-01～R-08——完整媒体包、可见文本红线、dataClass/Rights、SCA、唯一 ContentPackage mutation、认证/日志和 Pro Studio entitlement。
3. **发布工程门**：E-01——同一 SHA 的四单元 manifest、readiness、Provider、网络、恢复和保护环境。
4. **产品与规模化门**：P/S findings——Recent/示例、一个主推荐、Result/Outcome、Operations、额度投影、流式媒体和容量预算。

完成前三类门槛后，状态才可从“开发候选”提升为“release candidate”。真实门店的采用率、修改率、发布成功率和结果信号闭环完成后，才可称为“merchant validated”。

## 11. Agent Team 交叉复核处置摘要

### 直接采纳

- Operations 的根因是单 workspace 聚合、单 advisory lock 和历史集合全量 load/save；先拆持久化边界，再拆 service。
- 额度投影存在全历史重放与多次串行查询；加入周期窗口、set-based SQL 和 snapshot 路线。
- 邮件 Provider 缺字段日志可能泄露邮箱、正文和认证 token；列为低成本安全止血。
- Recent 投影已存在但 Web 未消费；在正确性和发布门之后接入生产首页。
- Harness 被“可选”环境变量门控且缺诚实降级；进入合入与开发体验门。
- RouteSnapshot 多形态、Canvas/Core 边界、legacy 无退役触发点和 worker 空轮询均纳入演进路线。

### 条件采纳

- Core Biome/Knip 只约束新增/修改并建立误报基线，不进行一次性全仓格式化。
- 查询并行化可以作为短期缓解，但不能替代 set-based SQL、周期窗口和 snapshot。
- 通用事务 helper 只迁移语义一致的路径；god module 只在持久化/所有权边界明确后按用例拆分。
- 长列表先做 cursor/object-scoped query，再根据真实 DOM、INP 和数据量决定是否虚拟化。

### 不采纳

- 不采纳“综合 B+、主链全部落地、安全 A、无阻断”的总判。
- 不采纳把 workflow、readiness、manifest 和 restore tooling 全部排除为仓库外问题。
- 不采用全局 grep 检查“每个后端 action 必须有前端字符串消费方”；产品可见能力使用 capability manifest + browser contract。
- 不在首轮提前建设自动平台发布框架；先兑现完整文件包、系统分享、assisted handoff 和诚实 capability。

## 12. 关键代码证据索引

| Finding | 主要证据 |
|---|---|
| Composer 正式 Recipe 仅 2/8 | `apps/core/src/p1/execution-spine/composer-submission-gate.ts:425`、`creation-execution-snapshot.ts:4`、`apps/core/src/p1/creation-experience/launch-seeds.ts:128,158,258` |
| 用户平台未进入提交合同 | `mkfast-template-main/src/product/composer/composer-home.tsx:1287`、`composer-submission-client.ts:16` |
| Context fact/source 断裂 | `composer-submission-gate.ts:538`、`launch-seeds.ts:143` |
| 媒体包不完整 | `apps/core/src/p1/harness/unified-media-stage-ports.ts:117`、`mkfast-template-main/src/routes/dashboard/results_/$workId.tsx:627` |
| 可见红线绕过 | `apps/core/src/p1/harness/policy-gates.ts:147`、`execution-selection.ts:8,127`、`apps/core/src/evals/redlines/cases.ts:40` |
| dataClass 降级 | `composer-route-resolver.ts:20`、`unified-media-stage-ports.ts:244`、`apps/core/src/p1/supply-registry/data-policy.ts:148` |
| Canvas rights 旁路 | `apps/core/src/pro-studio/canvas-asset-facade.ts:48`、`reference-asset-resolver.ts:115`、`media-generation-workflow.ts:845` |
| Day-0 身份阻断 | `composer-home.tsx:263,780,843`、`marketing-identity.ts:250`、`mobile-nav.tsx:90` |
| E2E 监听退役命令 | `mkfast-template-main/tests/e2e/fixtures/ui-journey.ts:118`、`z1-cutover-retirement.static.test.ts:93` |
| 唯一 ContentPackage 写口不成立 | `content-package-revision-port.ts:76`、`apps/core/src/pro-studio-runtime/postgres-adoption-service.ts:123`、`sole-write-port.contract.test.ts:119` |
| Quote/Route 不同冻 | `server-quote-authority.ts:52`、`composer-submission-gate.ts:185`、`composer-route-resolver.ts:44` |
| 幂等在 mutable admission 后 | `submission-coordinator.ts:115`、`composer-submission-gate.ts:185`、`foundation-ledger.ts:389,493` |
| Result task lineage | `result-center-search.ts:10`、`result-target-wiring.ts:238`、`use-workflow-event-stream.ts:190` |
| 一任务多 usage 风险 | `submission-coordinator.ts:107`、`structured-nodes.ts:190`、`execution-selection.ts:103`、`foundation-ledger.ts:109` |
| Operations 全量快照 | `apps/core/src/p1/operations/postgres-repository.ts:494,525,552`、`application-service.ts:1238,5185,8898` |
| 额度投影全历史重放 | `apps/core/src/p1/foundation/entitlement-service.ts:705,707`、`postgres-repository.ts:650,868` |
| 邮件日志泄露 | `mkfast-template-main/src/mail/provider/resend.ts:49`、`cloudflare.ts:57` |
| RouteSnapshot 多形态 | `apps/core/src/p1/execution-spine/composer-route-resolver.ts:3`、`apps/core/src/p1/route-snapshot-normalize.ts:1` |
| Harness 激活口径 | `apps/core/src/main.ts:287`、`.env.example:41` |
| 视频内存峰值 | `ark-media-adapter.ts:28`、`reference-asset-delivery.ts:120,253`、`s3-asset-storage.ts:272` |
| 容量队列空转 | `apps/core/src/p1/entitlement-pools/postgres-repository.ts:965,1255` |
| Canvas outbox 重入 | `apps/core/src/job-worker.ts:692`、`model-supply/foundation-module.ts:4229,4281` |
| 依赖安全 | `apps/core/package.json:50`、`apps/canvas/package.json:25`、`mkfast-template-main/package.json:66` |
| 网络 evidence 可缺失 | `scripts/production-network-boundary-gate.mjs:247`、`scripts/ci/run-release-candidate-quality.sh:10`、`.github/workflows/core-quality.yml:327` |
| Web CSRF 边界 | `mkfast-template-main/src/lib/core-client.ts:126,175`、`core-request.ts:37`、`apps/core/src/server.ts:297` |
| Cookie plugin 顺序 | `mkfast-template-main/src/auth/auth.ts:133-156` |
| god modules | `operations/application-service.ts`、`model-supply/foundation-module.ts`、`model-supply/index.ts`、`composer-home.tsx` |
