# 美业内容2 Agent Team Ticket 修复收口报告

> 日期：2026-07-27
>
> 依据：`docs/reviews/agent-team-ticket-implementation-review-2026-07-27.md`
>
> 工作分支：`leelv007-cmd/review-closeout-2026-07-27`
>
> 工作树：`/Users/bin/orca/workspaces/美业内容2/review-closeout-2026-07-27`
>
> 基线：`d0700122d6d3bc3da2ce94c5ed4135a85cc5b271`
> 调度方式：Codex 本地 Agent Team；未使用 Orca 调度。

## 1. 最终结论

本轮已完成 review 中所有可在本地代码、测试、配置和文档范围内执行的修复，并对产品主线做了重新集成。原审查列出的 P1 产品缺口已逐项接线或关闭；P2 中可由仓库修复的过期测试、断链入口、计费、后台、作品面、可观测性和发布脚本问题也已处理。

仍不能宣称“生产发布完成”。以下事项依赖仓库外权限、真实资源或付费供应商，不在本地代码修改能够闭合的范围内：

1. GitHub `main` ruleset/branch protection 尚未应用和回读；
2. 当前 SHA 的 GitHub required jobs 未取得实际成功 run；
3. Wrangler 生产资源仍有 6 个占位配置；
4. N2 生产恢复演练仍缺真实 PITR、对象版本、KMS/SecretRef 与隔离恢复证据；
5. MinerU 及真实付费供应商 live probe 本轮未执行；
6. 目标 R2 的真实写、读、删核销需要授权资源和凭据。

这些项目没有用 fixture、静态检查或“代码存在”替代真实完成证据。

## 2. Agent Team 分工

本轮使用多个本地 Agent 并行处理互不重叠的修复面：

- 模型供应、HeroUI 来源钉扎与环境清单；
- Facts/Rights、签名提交、意图映射与 ImageIntent；
- timeout/unattended、DBOS 冻结输入与恢复；
- 三桶计费、视频结算和首页余额；
- Recipe Studio、Skills、后台入口与正式 seeds；
- Dashboard 推荐、示例任务、作品导出与四形态作品面；
- MinerU durable intake、媒体 provenance/freshness；
- 管理员代开审计、移动端、线索、英文界面和 knip；
- Langfuse dead-letter、协办交接和发布回报；
- release workflow、资源校验、smoke 和最终浏览器矩阵。

主 Agent 负责 worktree、冲突消解、跨组合同、全量测试、失败复现、最终核销和报告。

## 3. Ticket 落地状态

### 3.1 T01-T10

| Ticket | 本轮状态 | 修复与证据 |
|---|---|---|
| T01 DeepSeek | 本地完成 | `llm-openai` 改为 `manual_only`，不进入自动候选；显式 fixed 选择仍可用。自动路由与显式路由均有回归测试。 |
| T02 HeroUI Glass | 完成 | 同步脚本校验真实 Git HEAD，不再只抄配置 SHA；镜像 manifest、README 和来源测试同步。 |
| T03 SCA | 本地门完成，远端阻塞 | 本地 SCA/聚合门有效；GitHub required 状态需仓库管理员在远端应用。 |
| T04 装配门 | 本地完成 | 生产装配要求对 R2 bucket/Core S3 bucket 做精确一致性校验；冷租户 assembly 浏览器链通过。 |
| T05 live 核销 | 部分完成 | provisioning manifest 与生产环境合同补强；真实 MinerU、目标 R2 和付费供应商探测保留为外部核销项。 |
| T06 Core 1A 退役 | 完成 | 同步修正 ticket 文案漂移，退役边界与当前实现一致。 |
| T07 Web 1A 退役 | 完成 | 退役路由/入口保持不可达，Web 全量测试与浏览器主矩阵覆盖当前入口。 |
| T08 M-01 双字段 | 完成 | 新增结构化 destination mapper、Core 接口与 Web 预检；只返回 platform/target/status，不越权改写 signed intent/creationMode；映射后同一次提交自动继续。 |
| T09 M-02 事实槽 | 完成 | fact satisfaction 与 rights authorization 接入生产 Harness；无授权、过期、撤权或错误引用均 fail closed；问题补录继续链有真实测试。 |
| T10 M-03 身份 | 完成 | 移动端身份/素材入口与慢查询场景更新到当前路由；neutral、未选、错误和空态保持区分。 |

### 3.2 T11-T20

| Ticket | 本轮状态 | 修复与证据 |
|---|---|---|
| T11 意图路由 | 完成 | `intent`、`creationMode` 纳入签名提交合同；Day-0 trace 不再伪称使用了不存在的事实。 |
| T12 Quote/Task | 保持完成 | 不可改绑、replay-first 和幂等主体通过全量回归。 |
| T13 唯一写路径 | 完成 | Facts/Rights 生产消费路径收口并补 fail-closed 回归；未增加旁路写入。 |
| T14 Usage 账本 | 保持完成 | Coordinator 继续作为 ProductUsage 唯一属主；供应商成本与产品扣费分离。 |
| T15 Rights dispatch | 保持完成 | dataClass、撤权、跨 workspace 与二次复核合同通过回归。 |
| T16 Auth/email | 保持完成 | recent-auth、cookie 与安全日志未被本轮改动破坏。 |
| T17 Pro Studio entitlement | 保持完成 | unknown/locked/active 唯一真值通过回归。 |
| T18 Copy compiler | 完成 | Promptfoo 本地和 CI 入口对齐；新增正控、负控和 wrapper 测试，避免“测试命令存在但不可运行”。 |
| T19 ImageIntent | 完成 | Profile 接入生产；三入口显式提交操作；typed refs、slot/native 约束和 `exactText` 冲突门闭合；签名包含 imageOperation。 |
| T20 NotePlan | 完成 | 图文 NotePlan 使用 `image.generate` 冻结操作；timeout/unattended 统一由服务端投影驱动，恢复不再重新解析可变输入。 |

### 3.3 T21-T30

| Ticket | 本轮状态 | 修复与证据 |
|---|---|---|
| T21 原生视频 | 完成 | 新视频商品按条/请求结算；供应商内部成本仍可按秒，不再污染产品扣费单位。 |
| T22 可见红线 | 完成 | 媒体 closeout 接入 rights、identity、freshness 和正向 provenance；缺失权威输入时 fail closed。 |
| T23 FFmpeg 退役 | 完成 | whole-film compose 的 UI、运行时和可计费领域模型一并退役；保留镜头级重生成。 |
| T24 MinerU intake | 本地完成 | durable parse carrier 增加恢复、fencing 与批次状态；queued-before-submit 不再形成永久悬挂窗口。真实 MinerU live 仍需外部核销。 |
| T25 注册兑换 | 完成 | 管理员代开账户新增不可变 audit；受保护 attribution 在通用 `/admin/` 写入前剥离，只允许服务端创建路径写入。 |
| T26 三桶计费 | 完成 | 统一 copy/image/video 三桶余额接口和首页卡片；图文预检/结算为 copy 1 + image pages；移除公开硬编码余量。 |
| T27 Recipe Studio | 完成 | 后台 Recipe Studio UI、正式校验链和 8 个 launch seeds 使用同一发布/校验路径。 |
| T28 Skills | 完成 | planner/user refs、stage skill resolution 与 durable frozen refs 接线；重放只物化冻结 revision，不重新读取 active binding。 |
| T29 Dashboard 首页 | 完成 | 三桶余额、可导出示例任务、真实热态推荐完成；推荐读取器在同 stage 多 trace 时只选择含 frozen `sourceRevisions` 的权威 trace。 |
| T30 Composer 换壳 | 保持完成 | 流式、恢复、签名预览和退役入口通过当前浏览器链。 |

### 3.4 T31-T40

| Ticket | 本轮状态 | 修复与证据 |
|---|---|---|
| T31 卡片家族 | 完成 | Web 消费 `QuestionCard.unattended` 和服务端 timeout；答复与自动继续均绑定权威 revision。 |
| T32 作品面 | 完成 | 文案、图片、图文、视频四类 canonical fixture 进入真实浏览器；详情、revision、媒体、复制、采用和导出链覆盖。 |
| T33 资产/身份/线索 | 完成 | 跨页 identity cache 与真实 Lead 链补齐；必填 project 关系和路由测试更新。 |
| T34 内容/运营 IA | 完成 | 英文 works 文案、当前导航和退役 guard 收口。 |
| T35 后台换壳 | 完成 | Recipe/Skills 管理路由、全后台 shell 和 knip 基线修复。 |
| T36 Landing | 保持完成 | 诚实文案、注册链接和死链合同通过回归。 |
| T37 M-04 硬门 | 本地完成，远端阻塞 | copy/image_text/video 三腿在锁内真实浏览器通过；GitHub merge control 仍需远端权限。 |
| T38 条件删除 | 保持完成 | 达谓词项维持删除，未达谓词 legacy 仍诚实保留。 |
| T39 R 门收口 | 本地完成 | Langfuse outbox 增加 dead-letter；canonical one-shot handoff 覆盖 receipt、token、系统分享、四段交接页、发布回报和 consumed 状态。 |
| T40 E-01 | 本地脚本完成，发布阻塞 | release workflow 合同、manifest 校验和 bounded smoke 已补；ruleset、真实 CI run、Wrangler 资源和生产恢复仍是外部阻塞。 |

### 3.5 T41-T46

| Ticket | 本轮状态 | 修复与证据 |
|---|---|---|
| T41 语义续跑 | 保持完成 | 后继快照、身份连续、幂等和旧快照护栏通过回归。 |
| T42 文案资产 | 保持完成 | Work 文本资产、ContentPackage revision 和采用事务保持一致。 |
| T43 Fixture facts | 保持完成并加强 | 浏览器热态推荐先走公开 Asset Intake → StoreFact 确认链；没有 factRefs 时不会把 ContextBundle revision 冒充事实引用。 |
| T44 Day-0 不阻塞 | 完成 | 冷租户真实 assembly、示例任务和 current Composer 路径均通过浏览器验证。 |
| T45 确认卡 timeout | 完成 | Core/Web/DBOS 使用同一 timeout/unattended 投影；晚答复、恢复和自动继续有回归。 |
| T46 对比度 | 完成 | 共享 token 与作品面回归覆盖 light/dark、desktop/mobile；实际对比度输出均高于门槛。 |

## 4. 关键架构收口

### 4.1 单一提交与恢复真相

Composer 是新任务唯一入口。直接 Harness task admission 保持退役，浏览器验收也迁移到 Composer 202 响应，不为测试恢复 legacy API。服务端签名冻结 intent、creationMode、destination、imageOperation、timeout 和 stage skill revisions；DBOS 重放只消费冻结输出。

### 4.2 Facts、Rights 与推荐

推荐与编译不把“存在门店资料”当作“已引用事实”。热态推荐要求真实 StoreFact、正向 factRefs、当前 facts revision 和授权状态。ContextBundle revision 只证明上下文编译发生，不能替代 fact reference。读取同一 task 的多条 `context_injection` trace 时，只有含 `sourceRevisions` 的冻结 trace 能作为推荐依据。

### 4.3 产品计费与供应商成本

公开余额固定为 copy/image/video 三桶；产品单位由 Coordinator 结算。供应商内部的秒、token 或成本 receipt 不作为用户可见扣费单位。图文一次请求同时预检并结算 1 个 copy 与实际 image pages；视频产品按条结算。

### 4.4 交付与发布回报

作品详情进入 canonical delivery panel；纯文案 Composer revision 走真实 copy-only delivery package，输出 caption、checklist、rights 和 manifest，不虚构图片资产。协办交付生成一次性 URL 和 ApprovalReceipt，系统分享使用产品生成链接，交接页回报最终发布结果后 receipt 变为 `consumed`，ContentPackage 追加 `manual_publish_result/published`。

## 5. 验证结果

所有命令均在本报告所列 worktree 执行。浏览器和数据库测试使用绝对共享锁：

`/Users/bin/Desktop/开发/内容无人区/美业内容2/.scratch/orca-run-2026-07-25/e2e-lock.sh`

| 验证 | 结果 |
|---|---|
| Root `pnpm typecheck` | exit 0 |
| Contracts | 83 pass / 0 fail / 0 skip |
| Web | 1294 pass / 0 fail / 4 skip |
| Core（内存/默认） | 2079 pass / 0 fail / 109 skip |
| Canvas | 277 pass / 0 fail / 1 skip |
| Root scripts | 143 pass / 0 fail / 1 skip |
| Root `pnpm check` | exit 0；7/7 gates |
| Secret scan | 4642 files；0 finding |
| D-123 scan | 2270 files；0 finding |
| Release workflow tests | 13/13 pass |
| 真 PostgreSQL Core | 2274 total；2264 pass / 0 fail / 10 skip |
| DBOS targeted regression | 6/6 pass |
| Promptfoo merchant-language 正控 | 7 pass / 0 fail / 0 error |
| Promptfoo assertion 负控 | 预期 exit 100；0 pass / 1 fail / 0 error |
| Dashboard hot recommendation 单链 | 1/1 pass |
| 最终浏览器矩阵 | 31 pass / 0 fail / 0 skip；7.5 min |

说明：

- Core 真 PostgreSQL 输出明确包含：`Core persistence gate passed: 10 skipped tests and DBOS smoke executed.`
- skip 均保留原测试声明，没有为变绿删除或放宽验收。
- 浏览器矩阵使用独立 business/DBOS 数据库、独立端口和串行 worker。
- 首轮浏览器矩阵发现的过期入口、默认 timeout 和 direct Harness admission 均作为真实失败修复，不计入最终通过。

## 6. 诚实保留的外部失败

### 6.1 N2 生产恢复

N2 recovery command 仍为 exit 1。原因是缺少真实生产资源和恢复回执，不是单元测试失败。报告不把本地 schema、fixture 或静态脚本当作 PITR/RPO/RTO 证据。

### 6.2 Wrangler 资源门

真实资源校验仍为 exit 1，共 6 个 placeholder。需要在授权环境中创建并回读实际资源标识后才能关闭。

### 6.3 GitHub 控制面

本轮没有修改远端 ruleset、branch protection、required contexts 或仓库权限，也没有伪造成功 CI run。需要仓库管理员恢复 Actions 计费/额度并应用规则，再对当前最终 SHA 重跑 required workflow。

### 6.4 Live 供应商

未请求、打印、保存或提交任何 secret。MinerU、真实 R2 和付费模型 probe 未在缺少授权预算/凭据时执行；fixture 通过与 live 通过保持分开记录。

## 7. 工作区状态与交付建议

- 所有修改均在新 worktree 和专用分支中开发、验证，再按用户指令合并到本地 `main`；
- 原始工作目录中用户已有的未提交和未跟踪文件未被移动、覆盖或纳入本轮实现提交；
- 后续建议：由管理员补 GitHub/资源配置 → 在合并后的最终 SHA 上重跑远端 CI、release manifest、N2 与 live 核销。

在远端规则、生产资源和 live 证据闭合前，准确状态是：

> 本地可执行产品修复和仓库级验收已完成并合并到 `main`；生产发布控制面尚未完成。
