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

## C. 运营供给项（数字＝运营参数，开发用种子样例值验收；D-123/D-128 口径）

| 项 | 用途（消费方） | 需你提供 | 开发期种子值 | 状态 |
|---|---|---|---|---|
| **C-1** 套餐三桶数字（文案/图/视频点 × 初级/中级/高级 三档） | 计费三桶票、运营手填后台；消费方＝`plan.allowances.{starter,growth,pro}` admin-config 键 → 授权发放 + 公开定价页 | **可后补**——上线前在后台填真值即可 | **D-143 种子＝D-123 原文**：初级 文案100/图40/视频3、中级 文案300/图100/视频6、高级 文案600/图180/视频9（视频 3/6/9＝用户拍板数，文案/图为 D-123 参考表）；档位命名＝初级/中级/高级 | ☐ 可后补（种子已落地 `entitlement-module.ts` DEFAULT_PLAN_OFFERS + `product/plans.ts`） |
| **C-2** 三类加油包定价 | 同上 | **可后补**同上 | 样例值（现行 copy-20/image-10/video-5；D-123 参考＝文案包100次/¥29、图片包50张/¥89、视频包3条/¥149，未落地待运营核算） | ☐ 可后补 |
| **C-1b** 档位月价（初级/中级/高级） | 公开定价页与 Landing（两页同源读 `VITE_GROWTH_*_AMOUNT_CENTS` 支付配置） | **可后补**——试点期线上支付未开放（D-124），价格为意向价 | D-123 中级 ¥399/月（`VITE_GROWTH_MONTHLY_AMOUNT_CENTS=39900`）；初级 D-123 参考 ¥199、高级 ¥699 当前按「按需开通」呈现 | ☐ 可后补 |
| **C-3** 试用额度默认值与开关初值 | 装配门 trial 档、示例任务真实扣点 | 一组你认可的试用额度（例：文案 X 条/图 Y 张/视频 Z 条） | 样例值 | ☑ 已定：文案 5／图 5／视频 1 |
| **C-4** 兑换码规则（位数/批次/有效期） | 试点注册承接票（D-045/D-124 R门①） | 一句话规则即可 | 样例规则 | ☑ 已定：手动申请（运营人工发码，无自动生成规则） |
| **C-5** 三行业示例店（行业选定＋示例素材/事实） | D-126 冷态首页票（platform_sample） | 三个行业名（建议：美发/美甲美睫/皮肤管理），有真实素材更好、没有则 AI 样例 | AI 生成样例素材 | ☑ 已定：护发／皮肤管理／生发 |
| **C-6** 行业先验配置（今日推荐 v1） | D-126 热态推荐票（确定性规则＋行业先验受控配置） | **可后补**——先验我按行业整理初版、你审定 | 规则＋样例先验 | ☐ 可后补 |
| **C-7** 产品对外名称 | R 门前专项（Landing 文案/发信名/命名） | R 门收口前定稿即可，不阻塞拆票 | 占位名（现状） | ☐ 可后补 |

## D. E 门/能力门触发时另批（现在不动）

支付真实闭环（Stripe/Creem 或国内通道）、手机号短信、平台代发账号（`publish:*` 能力门）、MinerU 自托管、部署中国化——全部挂 E 门/能力门触发点（D-124/D-128/D-129），届时单独一轮清单，不在本轮索取。

## 维护规则

- 本清单是唯一凭证/运营项登记处；票面「供给依赖」只写清单键号。
- live 核销（`live_verified`）状态由供给门票统一执行并回写本清单；各功能票 DoD 不含 live 门。
- 新增键先进本清单、再进 `.env.example`，两处同步。
