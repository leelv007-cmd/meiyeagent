# 供给清单（Provisioning Manifest）

> 依据 D-132（凭证与运营供给单门）。**凭证真值永不入库**：值填入本地 `.env`（gitignored）或运营后台；本清单只记录键名、用途、状态与消费方。票面以「供给依赖：A-1、C-3」方式引用清单键；实施中发现漏项→补本清单，不得另开索取通道。键名权威词表＝根 `.env.example`；标注「净新增」的键由对应票定义后回写本清单。

## 使用方式（需要你做的只有三件事）

1. 逐行看「需你提供」列：凭证值填进根目录 `.env` 对应变量；运营项按行内说明给结论即可。
2. 补完一项就把「状态」☐ 改 ☑（或直接回复我哪些已补、哪些暂缓，我来改）。
3. §D（E 门批）现在完全不用动。

## A. 模型与供给凭证

| 键 | 用途（消费方） | 需你提供 | 缺省 fixture 档 | 状态 |
|---|---|---|---|---|
| **A-1** `DEEPSEEK_API_KEY`（DeepSeek API key；沿 `MODEL_DIRECT_*` 装配机制消费） | 文案与全部文本判断位默认 LLM＝deepseek-v4-pro（装配门、M 门 LLM 判断位、四类编译器） | 在 DeepSeek 开放平台开通并充值的 API key | 既有 fixture 文本供应商，全链可跑 | ☑ `live_verified` 2026-07-25T17:50:30.619Z（v4-pro 真实文本；证据：`.scratch/provisioning-live-2026-07-25/remaining-provider-live-receipt.json`） |
| **A-2** `ARK_MEDIA_API_KEY` | 图 seedream-5-pro 系／视频 seedance-2 系／exactText 多模态 VLM（图片、图文、视频编译器票） | 火山方舟 API key（并确认账号已开通 seedream/seedance 对应模型） | recorded/fake provider 档 | ☑ `live_verified` 2026-07-25T17:48:01.223Z（Seedream 一图＋exactText 真实识别；证据：`.scratch/provisioning-live-2026-07-25/ark-live-receipt.json`） |
| **A-3** `ARK_SEEDREAM_MODEL`／`ARK_SEEDANCE_MODEL` | 上行 key 对应的具体 model ID | 方舟控制台里可用的 model ID 两个 | 同 A-2 | ☑ `live_verified` 2026-07-25T17:48:01.223Z（Seedream 一图＋Seedance 4 秒视频；证据：`.scratch/provisioning-live-2026-07-25/ark-live-receipt.json`） |
| **A-4** `TUZI_MEDIA_BASE_URL`/`TUZI_MEDIA_API_KEY` | 图/视频容灾通道（D-129：方舟直连主、tuzi 容灾） | tuzi relay key——**可暂缓**，缺席时按既有合同投影 single_channel/no_fallback，不阻塞任何票 | 单通道投影（既有） | ◐ 暂缺（用户 2026-07-26 拍板：方舟直连为主，容灾渠道暂缺；tuzi 模型命名与方舟不同，非 key 失效；`single_channel/no_fallback` 为接受态；历史探针证据：`.scratch/provisioning-live-2026-07-25/remaining-provider-live-receipt.json`） |
| **A-5** MinerU API token（键名净新增，由解析管线票定稿） | MinerU 官方精准 API 文档解析（录入/解析管线票） | mineru.net 申请的 API token | 预置解析结果 fixture | ◐ 未核销，fixture 先行（token 已收 2026-07-25，键名终稿与 live 核销待 #218） |

## B. 基础设施凭证

| 键 | 用途（消费方） | 需你提供 | 缺省 fixture 档 | 状态 |
|---|---|---|---|---|
| **B-1** `RESEND_API_KEY` ＋发信域名 | 注册邮件与通知（装配门、注册承接票） | Resend API key＋一个能改 DNS 的发信域名（域名验证步骤我可以给） | 邮件落日志不真发（既有） | ☑ `live_verified` 2026-07-25T18:44:36.721Z（`tqai.uk` SPF/DKIM Verified；注册邮件真发至 Resend `delivered` 测试地址并获脱敏回执；DMARC 未配置，不设门；证据：`.scratch/provisioning-live-2026-07-25/resend-live-receipt.json`） |
| **B-2** `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_R2_BUCKET_NAME` | R2 对象存储（媒体产物持久化，D-038 大产物对象存储）；生产/预发的 `P1_ASSET_S3_BUCKET` 必须与 `CLOUDFLARE_R2_BUCKET_NAME` 完全一致 | CF 账号已有：需建一个 R2 bucket＋签发 token（步骤我可以给） | 本地文件存储档（既有） | ☑ `live_verified` 2026-07-25T17:52:27Z（token 查询唯一 ACCOUNT_ID；目标 bucket 已存在；远端上传/下载哈希一致并删除后不可读；本地两处 env 已回填；证据：`.scratch/provisioning-live-2026-07-25/r2-live-receipt.json`） |
| **B-3** `LANGFUSE_BASE_URL`/`LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_PROMPT_LABEL`/`LANGFUSE_PROMPT_VERSIONS`/`LANGFUSE_REQUEST_TIMEOUT_MS` | 提示词版本化/评测（Skills、评估门） | **无需动作**——本地钉扎 compose 自生成 key；生产部署挂 E 门 | 本地 compose（既有） | ☑ 无需 live 核销（本地 compose 自供给；生产挂 E 门） |
| **B-3a** `LANGFUSE_OUTBOX_MAX_ATTEMPTS`/`LANGFUSE_OUTBOX_RETRY_DELAY_MS`/`HARNESS_COMPENSATION_POLL_MS`/`P1_OUTBOX_CRITICAL_MAX_BACKLOG` | Langfuse outbox 重试、dead-letter 与 readiness 阈值 | **无需动作**——使用 `.env.example` 默认值；生产按告警容量调整 | 本地业务 PostgreSQL | ☑ 配置键与 `.env.example` 对齐；毒消息不自动无限重试 |
| **B-4** `BETTER_AUTH_SECRET`/`DATABASE_URL`/`HARNESS_DBOS_*` | 认证/持久层/编排 | **无需动作**——本地生成、本地真机 PG（CI 真机 job 既有） | 本地真机 PG | ☑ 无需 live 核销（本地生成＋本车道真机 PG） |

## C. 运营供给项（数字＝运营参数，开发用种子样例值验收；**D-172 积分制现行**，D-123 三桶计量 superseded）

| 项 | 用途（消费方） | 需你提供 | 开发期种子值 | 状态 |
|---|---|---|---|---|
| **C-1** 套餐周期积分与价格（trial/starter/growth/pro） | 运营后台 AdminPlanControl；消费方＝admin-config **`plan.credits.{trial,starter,growth,pro}`** → 公开 `/public/plan-catalog` + 价格页积分卡阵 + 订阅发分 | 运营期可在后台 CAS 改真值；缺省用种子验收 | credit spec §7 / `packages/contracts` `CREDIT_PLAN_CONFIG_DEFAULTS`：trial **100**、starter **500**、growth **1300**、pro **2800** 分/月（及 HKD `monthlyPriceMicros`、并发/优先级等非计量字段） | ☑ 种子已落地；#303/#310/#311 已接线。**禁止**再写 `plan.allowances.*` |
| **C-1a** 周期系数 + 参考数字 | 价格页三档周期折算；「约可生成」只读已发布参考 | 运营可改系数与参考模型 | `plan.credits.cycle_coefficients`；`plan.credits.reference_numbers`（含 published 参考 copy/image/video 与模型选择） | ☑ #303/#307 已落地 |
| **C-2** 积分加油包 SKU（三档） | 价格页 `#credit-boosters` + Waffo 一次性 checkout + 发分 | 运营可改 credits/价/效期 | `plan.credits.addons` 种子：100 / 300 / 1000 分，效期 7 天（HKD） | ☑ #303/#308/#310 已落地（**非** copy/image/video 三类条数包） |
| **C-1b** 支付通道与计费价治理 | 真实收款：订阅 + 加油包经 **Waffo Pancake**；SKU/价进 admin-config 同一 CAS 链（`plan.credits.*` / payment-mapping） | 测试凭据已在 `docs/_private/waffo.env`；**生产** Waffo 开通另批 | — | ☑ Test 路径 #304/#308/#312 已验收；☐ 生产开通仍挂运营。Creem **已退役**。公开展示价与扣款 SKU 均不得再走 `plan.allowances.*` |
| **C-3** 试用积分与开关 | 装配门 trial 档、register_gift / grantTrial | 试用积分与 `plan.credits.trial.enabled` / `plan.trial.enabled` | 种子 trial **100** 分；开关默认开 | ☑ 已定（条数「文案5/图5/视频1」仅为 cutover 脚手架，**非**计费真相） |
| **C-4** 兑换码规则（位数/批次/有效期） | 试点注册承接票（D-045/D-124 R门①） | 一句话规则即可 | 样例规则 | ☑ 已定：手动申请（运营人工发码，无自动生成规则） |
| **C-5** 三行业示例店（行业选定＋示例素材/事实） | D-126 冷态首页票（platform_sample） | 三个行业名（建议：美发/美甲美睫/皮肤管理），有真实素材更好、没有则 AI 样例 | AI 生成样例素材 | ☑ 已定：护发／皮肤管理／生发 |
| **C-6** 行业先验配置（今日推荐 v1） | D-126 热态推荐票（确定性规则＋行业先验受控配置） | 已提供开发默认配置（美发/美甲/皮肤管理及三平台规则）；运营终审可继续调整 | `harness.today_recommendation` admin-config fixture | ☑ 开发默认已供给；运营终审待定 |
| **C-7** 产品对外名称 | R 门前专项（Landing 文案/发信名/命名） | R 门收口前定稿即可，不阻塞拆票 | 占位名（现状） | ☐ 可后补 |

## C-R. 发布线 GitHub Actions 仓库变量（2026-08-15 新增，**当前全缺**）

> 消费方＝`Core quality` 的 `release-manifest` job（`scripts/ci/build-release-manifest.mjs`）。
> 这些**不是凭证**，是发布治理参数，值可公开、直接填进仓库的 Actions Variables
> （`gh variable set <名> --repo leelv009/meiyeagent`），不入 `.env`。
>
> **现状**：`leelv009/meiyeagent` 的 Actions variables `total_count=0`——六个必填项一个都没有，
> 所以 `release-manifest` **必红**（2026-08-15 两轮 dispatch 均红在同一步
> `Mint the staging release manifest`，run 31892646103／31892656795）。这是供给缺口，
> 不是代码缺陷：生成器按设计 fail closed，「missing … 指名变量」正是它该有的行为，
> 目的是让 RC manifest 永远不能被脚本自己编出来。
>
> **不阻塞合并**：`release-manifest` 只在 `workflow_dispatch` 或带 `release-candidate`
> 标签的 PR 上跑，且不在 `required` 依赖里。它挡的是 **RC／发布**，不是日常 PR。

| 项 | 用途（消费方） | 需你提供 | 缺省 | 状态 |
|---|---|---|---|---|
| **R-1** `RELEASE_CONFIG_REVISION` | 本次发布所用部署配置的版本号，写进 manifest 供 RC 门核对 | 一个你认可的配置版本标识（可用日期或递增号，如 `2026-08-15.1`）；也可按单元覆盖 `RELEASE_UNIT_CONFIG_REVISION_<UNIT>` | 无（必填，缺则 fail closed） | ☐ **待你给一个标识**（本节唯一需要你动的一项） |
| **R-2** `RELEASE_READINESS_EVIDENCE_REF` | 指向「就绪性已验证」的证据引用 | **暂不需要**——见下「为什么现在不填」 | 无（必填） | ⛔ 挂 **V31-94** ＋证据产出 |
| **R-3** `RELEASE_RECOVERY_EVIDENCE_REF` | 指向「故障恢复已验证」的证据引用 | **暂不需要** | 无（必填） | ⛔ 挂 **V31-94** ＋证据产出（§3 第 3 条：XHS gap-close／replay-head 未证明） |
| **R-4** `RELEASE_JOURNEY_EVIDENCE_REF_COPY` | 文案旅程验证证据引用 | **暂不需要** | 无（必填） | ⛔ 挂 **V31-94** ＋证据产出 |
| **R-5** `RELEASE_JOURNEY_EVIDENCE_REF_IMAGE` | 图片旅程验证证据引用 | **暂不需要** | 无（必填） | ⛔ 挂 **V31-94** ＋证据产出 |
| **R-6** `RELEASE_JOURNEY_EVIDENCE_REF_VIDEO` | 视频旅程验证证据引用 | **暂不需要** | 无（必填） | ⛔ 挂 **V31-94** ＋证据产出 |

`RELEASE_COMMIT_SHA` / `RELEASE_WORKFLOW_RUN` / `RELEASE_STARTED_AT` 由 workflow 自己注入，
**不需要你提供**。

### 为什么 R-2～R-6 现在不填（2026-08-15 拍板）

两条理由，任一条都足以否掉「先填个值让它绿」：

1. **载体错了**（→ **V31-94**）：这五项被接成仓库级**常量** `vars.*`，一个常量表达不了
   「这一次发布的证据」。填一次任意非空串，fail-closed 就永远不会再红，而此后每份
   manifest 都会引用一份与本次发布无关的证据——**比留空更糟，因为它看起来是审过的**。
   正确载体是按轮注入（同 job 的 `RELEASE_WORKFLOW_RUN` 就是正确样板）或 dispatch 输入。
2. **证据还不存在**：`docs/ops/current-project-status.md` §3 第 2、3 条明载，21 个 fixture
   consumer tests 未在最终 SHA 串行跑完、XHS 两个 fault 未证明形成 terminal receipt 与
   recovery。此时填任何字符串＝**给一次没发生过的验证造审计痕迹**。

**顺序**：先产证据 → V31-94 改好载体 → 由证据决定引用。不得颠倒。

### 引用口径（定稿，供将来填写时照用）

凡需人工提供的证据引用，一律用**仓库相对路径 + commit 锚点**，与生产代码里既有写法一致
（`apps/core/src/p1/admin-config/bounded-execution-limits.ts:153`）：

```
docs/ops/merge-ledger.md#561ab568
```

- **不用 run URL**：Actions 日志与 artifact 会过期，引用指向会消失的东西是最差组合；
- **不抄测试 fixture** 的 `staging:readiness:1` 形态——不透明计数器，审计时等于没有。

> 补充：下游三处消费方（`build-release-manifest.mjs`、`assert-release-candidate-evidence.mjs`、
> 产品侧 `runtime-truth/release-identity.ts`）**只校验非空**，从不解析或解引用。
> 所以这些字段唯一重要的属性就是「指得准不准」，全靠约定与纪律保证。

## D. E 门/能力门触发时另批（现在不动）

Waffo **生产**环境开通与对账、手机号短信、平台代发账号（`publish:*` 能力门）、MinerU 自托管、部署中国化——全部挂 E 门/能力门触发点（D-124/D-128/D-129），届时单独一轮清单。**禁止**把已退役的 Creem 或 `plan.allowances.*` 写回本清单主行。

## 维护规则

- 本清单是唯一凭证/运营项登记处；票面「供给依赖」只写清单键号。
- live 核销（`live_verified`）状态由供给门票统一执行并回写本清单；各功能票 DoD 不含 live 门。
- 新增键先进本清单、再进 `.env.example`，两处同步。
