# 票 22 · 一条真实链路端到端跑通留证
> 建设面: E6 真实验收 ｜ 决策: DEC-NORTH-STAR ｜ Blocked-by: 06, 09, 11

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "22",
  "decisionIds": [
    "DEC-NORTH-STAR"
  ],
  "guardrailDecisionIds": [
    "DEC-D01-REAL-DONE"
  ],
  "gapIds": [],
  "contractIds": [
    "X-REAL-RUN-EVIDENCE"
  ],
  "blockedBy": [
    "06",
    "09",
    "11"
  ],
  "closureEvidence": [
    "docs/evidence/contentpackage/README.md",
    "docs/evidence/contentpackage/real-run-0002/README.md",
    "docs/evidence/contentpackage/real-run-0002/journey/run-manifest.json",
    "docs/evidence/contentpackage/real-run-0002/journey/package-evidence.json",
    "docs/evidence/contentpackage/real-run-0002/journey/ledger-evidence.json",
    "docs/evidence/contentpackage/real-run-0002/journey/continuous-journey.webm",
    "docs/evidence/contentpackage/real-run-0003/README.md",
    "docs/evidence/contentpackage/real-run-0003/journey/run-manifest.json",
    "docs/evidence/contentpackage/real-run-0003/journey/package-evidence.json",
    "docs/evidence/contentpackage/real-run-0003/journey/ledger-evidence.json",
    "docs/evidence/contentpackage/real-run-0003/journey/continuous-journey.webm",
    "docs/evidence/contentpackage/real-run-0003/journey/before-after-comparison.md",
    "docs/evidence/contentpackage/real-run-0003/journey/keyframes/kf9-result-card-model-usage.png",
    "docs/evidence/contentpackage/real-run-0003/activation/catalog-publication/evidence.json"
  ],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

> **2026-07-17 记账更新（grilling D）**：产品北极星计数已 **0→1**；`closureEvidence` 已挂 accepted journey。**status 仍 open**——gate 票 01 与 blockedBy 06/09/11 关票流程未走完；本票关闭 ≠ 可面世。
>
> **2026-07-17 纠偏跑更新**：`real-run-0003` 已用固定 Seedream 4.5 模型重跑，选择、冻结路由、实际目录模型与 provider model 一致，三平台文案均实质不同；改前/改后对照包与商户可见 Result Card 实际模型/费用证据也已附件。**status 仍 open**：gate 票 01 与 blockedBy 06/09/11 的正式关票流程尚未完成。

- **北极星测量已达成（count=1）**：连续商户旅程 evidence 见 `docs/evidence/contentpackage/real-run-0002/journey/`（runId `real-run-0002-1784236289412`）。四要件（真实 LLM、真实媒体、durable product facts、脱敏留证）与「生成图进入采用创建的同一 ContentPackage，三变体继承」均为 true。real-run-0001 因该聚合条件不成立已驳回且不计数。
- **关票仍阻塞（治理层）**：`decision-ticket-map` 全局 gate 票 01 仍 open；本票 `blockedBy: [06,09,11]` 仍 open。能力已在同一旅程中演示（采用 / 参考图 / 三平台），但依赖票正式关票与 gate 规则未放行。
- **双账补证已完成（2026-07-17）**：`real-run-0002/journey/ledger-evidence.json` 以同一浏览器 session 的 Product Core seam projection 为主证、保留真实 Postgres 的只读账本查询为交叉核对，补齐三笔 reserve→commit、三笔 observed Provider Cost 与 correlationId；证据不包含 provider task ref、签名 URL、凭据或完整生成正文。
- **环境备注**：旅程在 `vite --mode e2e` + e2e email helper + 本地 real provider 下完成；manifest 已标注。D01 字面口径允许本地真实 provider。
- **票界（不变）**：本票交付端到端行为与留证，不开发新产品能力；**本票关闭 ≠ 可面世**（ADR-0009 E1–E6+E7）。

## 现状代码入口（实核 file:line）

- `docs/evidence/p0-release-evidence.md:17`：`| Core + Postgres + media | … | 31 pass, 1 live-provider smoke skipped |`——提示锚点未漂移，本票要取代的就是这条 skipped 口径；`:40-44` Release Blocks 第 1 条为改前自认证据。
- `apps/core/src/p1/model-supply/live-llm-provider.integration.test.ts:9-27`：opt-in live 冒烟的门槛——8 个 `MODEL_DIRECT_*` env + `RUN_LIVE_MODEL_PROVIDER_TEST=1`；`:48` 走 `executeCopyQualityProbe`（真实三候选 + grounding 事实 + usage/cost 断言）；`:99-101` 成功后 stdout 打印 `MODEL_DIRECT_ACTIVATION_CONFIGURATION_REVISION` 指纹——这是现行"真实探针 → 激活指纹"的既有产出通道。
- `apps/core/src/p1/model-supply/runtime-config.ts:375-392`：`parseMode` 默认 `recorded`，fixture 硬门禁 e2e；`:367-373` 媒体模式仅 `disabled|ark`；`:404-450` `directOptions` 三原生家族校验（tuzi.env 的 catalog model id 在此选择家族模板）；`:205-257` `directActivationEvidence` 三元组校验与 `live_verified` 判定；`:259-275` sha256 配置指纹（必须与当次 direct 配置一致，防指纹挪用）。
- `apps/core/src/main.ts:134-145`：生产装配——`modelRuntimeAssemblyFromEnv(process.env)` + `aiStreamingRunner` 仅在 `live_verified && direct` 时创建。真实运行的装配开关全在这里，本票零代码、只配 env。
- `apps/core/src/server.ts:548-604`：`POST /workspaces/:id/p1/copy/stream`——旅程"真实模型流式文案"环节的 seam 入口，`:584` `operationsService.startCreativeCopyStream`；runner 缺席时 `:554-560` 503。BFF 透传 `mkfast-template-main/src/routes/api/core/p1/copy/stream.ts:4-8`；前端消费 `mkfast-template-main/src/product/unified-creation-workbench.tsx:753`（`useCopyCandidateStream`）、流式候选渲染 `:2072-2075`、3 选 1 采用按钮 `:2346-2369`（票 06 改写为写 ContentPackage）。
- `apps/core/src/product/product-service.ts:1798,1815`：`save_store_draft` / `confirm_store`——旅程第一步"真实门店档案"的既有命令；grounding 事实经 `ProductCreativeGroundingResolver`（`main.ts:473`、`job-worker.ts:284`）进入文案 prompt 与媒体授权门禁（`apps/core/src/product/p1-model-policy.ts:110-125`）。
- `apps/core/src/p1/model-supply/ark-media-adapter.ts:448-454`：`image.edit` 硬拒真实素材（票 09 锚点 449-455 同址）——票 09/10 交付后此处应接受 provider-readable 参考图；本票旅程执行时在此环节验收"真照片进画面"。
- `mkfast-template-main/playwright.config.ts:34-35`（及 48-49/81-82/99-100）：E2E 全线 fixture 钉死——改前对照证据的来源，本票不改此配置（fixture E2E 保留为工程护栏）。
- `package.json:11-14`：`pnpm dev` 以 `.env.example`（fixture 默认）+ `.env`（覆盖）启动 web + core + worker 三进程——真实运行 = `.env` 覆盖 `APP_ENV`（非 e2e）+ `MODEL_EXECUTION_MODE=direct` + 媒体模式 + 激活三元组；`:10` `pnpm check` 含 secret-scan（证据落盘的防泄密闸）。
- `docs/_private/tuzi.env`：实核 8 变量（`MODEL_DIRECT_API_KEY/BASE_URL/MODEL/CATALOG_MODEL_ID/CREDENTIAL_VERSION/ENDPOINT_REVISION/INPUT_COST_PER_MILLION/OUTPUT_COST_PER_MILLION`）——LLM 侧凭据齐备、激活三元组与媒体变量缺席，与差距锚点判断一致；目录受 `.gitignore` + secret-scan 范围外保护（`docs/_private/README.md`）。
- `docs/evidence/contentpackage/`：不存在（`ls` 确认）——本票新建。

## 改造方案（步骤级）

垂直切片 = 一条真实旅程纵穿全部层：运行时装配（env 契约）→ Application Service 全链命令（唯一 seam，核对无旁路）→ 前端真实操作与可见行为 → 证据核对与落盘。每层都被真实穿过，任何一层用桩即整票不成立。

1. **前置核验（契约层）**：确认票 01/06/09/11 已交付且冻结合同未漂移——`adopt_into_content_package`（文案+多图成一品）、参考素材解析端口、`generate_package_variants` 在同一真实服务可用；走查旅程涉及的全部命令均经 Product Core Application Service（copy stream 经 `startCreativeCopyStream`、采用/variants 经 p1 commands 通道、媒体经 `controlPlane.submitGeneration`），确认无任何直连 provider 的旁路。**不新增 seam、不为跑通开后门**。
2. **LLM 真实装配（adapter/env 层）**：`.env` 落 `tuzi.env` 8 变量 + `MODEL_EXECUTION_MODE=direct` + `APP_ENV` 非 e2e；以 `RUN_LIVE_MODEL_PROVIDER_TEST=1` 跑 opt-in live 冒烟（`live-llm-provider.integration.test.ts`），真实通过后从 stdout 抄录配置指纹填入激活三元组——部署转 active、`aiStreamingRunner` 装配。指纹**必须来自当次真实 smoke 输出**，禁止手算哈希伪造激活（这是 spec §10"激活证据来自真实探针"在现行 env 机制下的执行方式；DB 化探针证据归票 20，本票不等它、也不与它冲突）。冒烟通过记录（命令、时间、usage/cost 数字、指纹）即为取代 `p0-release-evidence.md:17` skipped 口径的第一份证据。
3. **媒体真实装配（adapter/env 层，二选一）**：(a) Ark 直连凭据若备——`MODEL_MEDIA_EXECUTION_MODE=ark` + `ARK_*` 全套 + Seedream/Seedance 各自激活三元组（同样真实探针产指纹）；(b) Ark 未备则以票 10 TuziMediaAdapter（tu-zi `/v1/images/edits` reference_image 通道）为真实媒体通道。以实际就绪者为准；两者皆不可用则本票如实 blocked（见风险），**不得用 recorded 媒体充数**。
4. **旅程执行（前端层，真实商户操作，单次连续）**：以真实美业门店样本（名称/项目/价格/实拍照片均为真实商家事实）在真实运行环境（web + core + worker 三进程 + 真实 Postgres）连续完成：注册登录 → 门店档案录入并确认（`confirm_store`）→ 素材页上传真实门店照片 + 权利授权 → 工作台选主题 + 显式固定模型 → 文案逐 token 流式出现 → 3 选 1 单选采用 → 文案 + 多张有序图成一个 ContentPackage → 真实照片作为参考图进入图片生成、真图入自有存储（走视频链路则为分镜确认 → 真实成片，D01 二选一，最小 0→1 以图文为准）→ 成品详情「生成三平台版本」→ 小红书/抖音/视频号三版本就绪 → 内容库看到该成品且状态「可使用」。全程录屏不剪 + 每步 correlationId 抄录。本地真实 provider 跑通满足 D01 字面口径（"真实 provider 端到端"），公网部署不在本票。
5. **证据核对（Application Service 外部行为层）**：旅程完成后经 seam 查询回读核对——`content_package` 详情含首版本、有序资产、三平台 variants、childRuns 与实际模型；RouteSnapshot 实际模型与录屏所见一致（无静默换模）；Product Usage reserved→committed 与 Provider Cost observed 双账数字逐笔抄录；生成 Asset 有自有存储 receipt（非供应商临时 URL）。核对一律走既有查询命令，DB 直查只作旁证、不作证据主体。
6. **留证落盘 + 北极星翻牌（文档层）**：新建 `docs/evidence/contentpackage/`——`README.md`（真实跑通链路数唯一计数登记处，本次置 1 + 计入四要件自检）+ `real-run-0002/`（run manifest：时间、环境、模式、实际模型、correlationId 链、双账数字、packageId、成本合计、参与者与商户样本授权；录屏/关键帧截图索引；脱敏声明）。`p0-release-evidence.md` 追加一行 supersede 注记指向新证据（历史快照正文不改写，符合既有 Historical evidence note 先例）；`CONTEXT.md` 权威段与 spec 的"当前 = 0"括注同步更新为 1。全部证据文件过 `pnpm check`（含 secret-scan）后提交。
7. **缺陷回路（测试/熔断层）**：旅程任何一环跑断，缺陷开回责任票（06/09/10/11 或更早）修复，然后**从头完整重跑**——证据必须来自单次连续旅程，禁止多次半程拼接；评审两轮熔断（D04）适用于本票验收本身。fixture E2E 与既有全量测试保持全绿（工程护栏，不作关票依据）。

涉及文件：`.env`（本地，gitignore）、`docs/evidence/contentpackage/README.md` 与 `real-run-0002/*`（新建）、`docs/evidence/p0-release-evidence.md`（追加注记一行）、`CONTEXT.md`、`docs/specs/contentpackage-productization-spec.md`（计数口径）。预期产品代码 diff = 0；任何代码修复的 diff 归属责任票。

## DoD（全部必须是用户可见行为）

- **主留证（北极星 0→1 的实体）**：一位真实美业门店商户样本，在 direct LLM + 真实媒体 + 真实 Postgres 的运行环境里，一次连续完成"门店档案 → 主题 → 流式文案 → 3 选 1 采用 → 真照片进画面的真图（或真片）→ 单个 ContentPackage → 三平台版本 → 内容库可使用"，未剪辑录屏 + 8 个关键时刻截图（档案确认/照片授权/首 token/3 候选齐/采用成包/真图可辨识来自店照/三版本就绪/内容库「可使用」）落 `docs/evidence/contentpackage/real-run-0002/`。
- **对照证据（当前 vs 改造后）**：改前三件套——`p0-release-evidence.md:17` "1 live-provider smoke skipped" 截图、`playwright.config.ts:34-35` fixture 钉死截图、`doc-consistency-audit-2026-07-15.md:21` "真实跑通链路数仍为 0" 摘录——与改后"live 冒烟真实通过记录 + 同一旅程真实 provider 录屏 + 计数=1"并排归档。这是"演示壳 vs 真产品"的直接对照（竞品闭环对标的根因回应，spec Problem Statement）。
- **过程行为逐项可见**：文案在完整回复前逐字出现（非等待后整块跳出，ADR-0007/0010 口径）；商户选定的固定模型全程可见且与 RouteSnapshot 实际模型一致，无静默换模；生成图画面可辨识来自商户上传的那张店照（并排对照图入证据包）；三平台版本为三份实质不同的完整中文文案；全程状态用语只出现「创作中 / 可使用 / 需处理」。
- **账实一致可核**：成品详情/Result Card 展示实际模型与费用状态；manifest 抄录的 Product Usage（reserved→committed）与 Provider Cost（observed）数字同旅程 correlationId 对得上——商户看到的"扣了多少"与平台看到的"花了多少"都是真数。
- **北极星翻牌（US11，平台运营者可见）**：`docs/evidence/contentpackage/README.md` 计数登记 0→1 并附四要件自检（真实 LLM / 真实媒体 / durable facts / 脱敏留证）；`p0-release-evidence.md:17` 的 skipped 口径被真实通过记录取代（注记指向）；CONTEXT/spec 的"当前 = 0"同步更新。
- **既有行为零回退**：D4 仍为 3 选 1 单选；L-1 贴链接抓取不复活；无跨品牌 Auto；抖音版本页面无"发布/只差账号"暗示（D10）；fixture E2E 与全量测试保持全绿。
- **关票边界（禁止项）**：仅 curl/单测/接口日志/静态原型/fixture E2E/多段拼接录屏，一律不得关票；证据四要件缺一即不关。**本票关闭 ≠ 可面世**：ADR-0009 单发布闸仍要求 E1–E6 建设面一起通过 + E7 配套，证据包首页须写明本票只把北极星翻到 1，对外不得据此宣称"已上线能力"（ADR-0011 Consequences）。

## Blocked-by / Blocks

- **Blocked-by（MAP 最小真实链路）**：票 01（聚合合同冻结，且 MAP 全局规则：01 关闭前任何票不得关）、票 06（采用写 ContentPackage——没有成品对象就没有链路终点）、票 09（真实素材进媒体——"真照片进画面"环节的供给）、票 11（三平台 variants——旅程"三平台适配"环节的供给）。
- **运行前提（非新增票依赖，如实登记）**：① 真实媒体通道二选一——Ark 直连凭据到位，或票 10 TuziMediaAdapter 落地（tuzi.env 现只有 LLM 凭据，媒体两者皆无则本票事实上被票 10 阻塞）；② 真实商户样本数据与照片授权；③ LLM 凭据已备（`docs/_private/tuzi.env`，探针已通过）。④ 票 07 非硬前置（07 票文明示"不阻塞票 22"），但其先行完成可让旅程终点"内容库"的留证一次落在商户可见的内容库页上——建议实操排在 07 之后；若 07 未合入，内容库环节以成品详情 + seam `content_packages` 查询承载并在 manifest 中如实注明。
- **Blocks**：ADR-0009 单发布闸的 E6 建设面由本票交付——不留证则永不面世；D03 北极星口径下"产品进度"从本票起才开始计数（0→1 之前一切 UIUX/评审/recorded 完备性不计）。本票不解阻任何具体开发票（12–17 并行推进，不依赖本票），解阻的是"面世"这件事本身。

## 风险与回退

- **媒体真实通道不备（最大风险）**：图文最小链路也必须有真实图片生成。若 Ark 凭据与票 10 皆未就绪，本票如实标 blocked/open，北极星保持 0——不得用 recorded 图充数、不得剪掉媒体环节宣称"部分跑通"、不得把"LLM 单环节真实"包装成链路完成（那正是被 D01 封死的口径）。
- **激活指纹挪用**：现行机制里指纹是 env 哈希（`runtime-config.ts:259-275`），存在"不跑探针手算指纹"的造假空间。控制：指纹必须抄自当次 live 冒烟 stdout（`live-llm-provider.integration.test.ts:99-101`），冒烟记录连同指纹一起进证据包互为印证；配置变更（换模型/换 base URL）后指纹失配即拒绝启动（`:246-250`），天然防陈旧证据。与票 20 的探针证据 DB 化改造衔接、不冲突。
- **证据泄密**：`docs/evidence/` 进 git。控制：manifest 只记非密字段（模型名/数字/correlationId），key 与 Authorization 头绝不入档；录屏/截图逐帧人工复核（终端画面尤其危险）；`pnpm check` secret-scan 兜底但不作唯一防线；商户真实照片入证据包须样本授权记录（rightsEvidence 本就是链路一环）。
- **拼接造假**：多次半程拼成"一次跑通"是本票最危险的失败形态。控制：DoD 钉死单次连续录屏；correlationId 链跨环节一致性核对；重跑策略 = 修复后从头完整重跑（自动尝试上限与 Safe-only 接单语义不变，不为跑通放开盲重试）。
- **成本与配额**：live 冒烟 + 完整旅程消耗真实配额。控制：单次成本本就是 manifest 必录字段（顺手回答"一条链路多少钱"的单位经济问题）；失败重跑前先修因，不无限烧配额。
- **"跑通一次"被误读**：翻牌后最容易发生"可以发布了/可以宣传了"的口径漂移。控制：证据包首页与关票记录都写明 ADR-0009 单发布闸未动——E1–E6 全过 + E7 才面世，公开收费另有 Gate 0（算法备案）前置（spec Further Notes）。
- **回退**：本票零产品代码 diff，无技术回退负担。若旅程揭示 06/09/11 交付的合同级缺口，回责任票修复——禁止在本票内绕过 seam 打临时补丁"凑一次跑通"；`.env` 恢复 fixture 默认即可回到日常开发态，已产生的真实成品与双账事实按既有 Owner 语义保留、不删改。
