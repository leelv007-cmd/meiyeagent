# 票 18 · 模型/媒体执行模式可视化切换
> 建设面: E7 管理后台 ｜ 决策: DEC-ADMIN-CONTROL-PLANE ｜ Blocked-by: 05

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "18",
  "decisionIds": [
    "DEC-ADMIN-CONTROL-PLANE"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-NO-CONFIG-PERSIST"
  ],
  "contractIds": [
    "X-VISUAL-CONFIG"
  ],
  "blockedBy": [
    "05"
  ],
  "closureEvidence": [],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **US22 / X-VISUAL-CONFIG（已批准未落地）**：规格用户故事 22 拍板"平台管理员在后台可视化切换模型 / 媒体执行模式, so that 我不用改 env、重部署"，§6 Admin config commands 首条即"切换执行模式"。当前两个档位是纯 env 常量：`apps/core/src/p1/model-supply/runtime-config.ts:376` 读 `MODEL_EXECUTION_MODE`（disabled/recorded/fixture/gateway/direct 五档，默认 recorded）、`:368` 读 `MODEL_MEDIA_EXECUTION_MODE`（~~disabled/ark 两档~~ disabled/ark/tuzi/ark,tuzi 四档，默认 disabled）——题目锚点两处实核**均未漂移**。变更唯一通道 = 改部署环境变量 + 重启重部署，正是诊断病根"改代码才能配"在执行模式上的具体形态。

> 治理批注 2026-07-17：用户拍板，媒体执行模式由'两档'修订为四档（disabled/ark/tuzi/ark,tuzi），依据 batch-T6 分析；两档原文为过时口径。本批注同步修订差距锚点，并以 DoD-1 的四档口径为验收权威。
- **boot 一次装配、两进程各读各的**：`runtime-config.ts:26-203` `modelRuntimeAssemblyFromEnv` 在启动时把档位解析成进程内不可变装配（execution port、media port、deployment 激活集、catalog 投影、激活证据一次成型）；HTTP 进程在 `main.ts:134-139`、job-worker 进程在 `job-worker.ts:160-166` 各自独立读 env——两入口（ADR-0006 拓扑）之间没有共同的执行模式事实源，全靠部署环境恰好一致。
- **管理面零可见零可切**：管理模式现有四 Tab（`admin-control-plane.tsx:14-48`）没有任何执行模式展示；唯一 admin 查询 `admin_catalog_control`（`foundation-module.ts:753-764`）只返回 catalog 快照，不含当前档位；1876 行 `admin-model-control.tsx` 里也没有档位控件——管理员甚至无法在产品内**看到**现在是 recorded 还是 direct，更谈不上切。
- **票 05 交付后仍是"已记录（未接线）"**：票 05 已把 `model.execution.mode` / `model.media.execution.mode` 注册进配置 key 白名单并给出存储值 vs 生效值对照投影，但明确声明"本票期间 env 仍是运行时唯一权威，DB 值接管由票 18 按 key 逐个接线、把 wired 翻真"。本票就是这两个 key 的接线票：DB 档位真正驱动运行时行为，并显式声明规格 §5 要求的"热加载 vs 重启生效边界"。
- **票界**：本票只接线执行模式两个 key（档位可视切换 + 生效机制 + 生效可见）。Provider 凭据与测试连接是票 19、adapter 装配切换与激活真实探针是票 20、套餐可写是票 21；direct/ark 所需凭据本票仍从 env 读（票 19 前的现状），本票不碰凭据存储。锁定不变量不动：切换档位不改 D4（3 选 1 单选）、不引入跨品牌 Auto、不触发布闸。

## 现状代码入口（实核 file:line）

- `apps/core/src/p1/model-supply/runtime-config.ts:375-392` `parseMode`（`:376` env 读点 + 五档枚举校验 + `:388-390` fixture 限 `APP_ENV=e2e`）；`:367-373` `parseMediaMode`（`:368` env 读点）；`:404-450` `directOptions`（direct 档要求 9 项 env 齐全否则 throw）；`:452-489` `arkMediaOptions`（ark 档要求 Ark env 齐全）——本票的档位合法性与可装配性校验必须复用这套规则，不得在管理面重抄第二份。
- `apps/core/src/p1/model-supply/adapters.ts:1462-1512` `createModelExecutionRuntime`：五档→runtime 的纯装配分发（disabled→`DisabledModelExecutionPort`（`:1440-1455`，rejected_before_accept + 零成本）、recorded/fixture→`RecordedAdapterRouter`、gateway→PoC、direct→`OpenAiCompatibleLlmExecutionPort`）；`:1373` `withArkMedia` 挂媒体 port。本票只换"档位从哪来"，不改这台装配机。
- `apps/core/src/p1/model-supply/index.ts:524-530` `ProviderExecutionPort` 是 ModelSupplyApplicationService 唯一执行 seam；`:934-979` 构造期把 execution/deployments/runtimeCapabilities 存为私有字段（**构造期快照**，这决定了整档热切会撕裂装配一致性）；`:1266/:1432/:1645` 执行时 `this.execution.execute`。
- `apps/core/src/main.ts:134-139` HTTP 进程装配解构；`:140-145` `aiStreamingRunner` 按 mode 装配（fixture→Fixture runner、direct+live_verified→AI SDK runner）；`:164-185` 两个 ModelSupplyApplicationService 注入 `modelRuntime.execution`；`:296-304` `modelRuntime.media` 注入 DurableMediaGenerationApplicationService。**实核发现：`main.ts:282-294` `migratePostgresSchema` 在装配（`:134`）之后**——boot 读 DB 档位必须先于装配单独迁移并预读配置表（advisory lock 幂等迁移使重复执行安全，见 `postgres-schema-migration.ts:11-29`）。
- `apps/core/src/job-worker.ts:149-159` migrate → `:160-166` 装配（顺序正好）；`:205-211/:234-239` media 消费。
- `apps/core/src/p1/model-supply/foundation-module.ts:1886-1915` `ModelSupplyFoundationModule` admin 门禁范式（actor==='admin' 或 adminActorIds 命中）；`main.ts:509-533` operations 注册数组；`server.ts:781-857` `/p1/commands` + `:859-905` `/p1/query` 通用分发——票 05 的 `admin-config` 模块（`config_apply`/`config_get`/`config_list`/`config_history`）已挂在同一 seam，本票命令查询全部经它走，**零新路由、零新 seam**。
- 前端：`mkfast-template-main/src/p1/admin-control-plane.tsx:14-48` 四 Tab 薄壳 + 票 05 新增的"运行时配置"Tab；`admin-model-control.tsx:413-518` query/mutation 调用范式（`:507-518` commandMutation + invalidate）是 1876 行地基，本票在其上扩只读生效徽章。
- 票 05 产物（本票直接消费）：`apps/core/src/p1/admin-config/` 模块、`admin_config_revisions`/`admin_config_heads` 表、key 注册表 zod 契约、RuntimeConfigSnapshot 对照投影（storedValue/effectiveValue/wired）。

## 改造方案（步骤级）

1. **Schema（扩票 05 的 admin-config 模块，不建新模块）**：给 `model.execution.mode` / `model.media.execution.mode` 两个 key 挂**档位专属 validator**——枚举合法性 + fixture 限 `APP_ENV=e2e` + 可装配性探查（direct 档用 try `directOptions(env)`、ark 档用 try `arkMediaOptions(env)`，捕获错误转为"缺失项清单"拒绝原因；探查回调由 `main.ts` 装配时注入，模块本身不 import process.env）。为 `parseMode`/`parseMediaMode`/`directOptions`/`arkMediaOptions` 加 export（`runtime-config.ts` 内部函数提为可复用，单一规则源）。新增一张小表 `admin_config_effective_snapshots`（process_kind 'http'|'job-worker' 每进程一行 upsert：生效 mode、mediaMode、生效来源 db_revision|env_fallback + 回退原因、boot 时间），migrator 挂 `main.ts:282-294` 与 `job-worker.ts:149-159` 两处清单。
2. **生效机制（规格 §5 边界在此显式拍板）**：新装配入口 `modelRuntimeAssemblyFromSources(configReader, env)`——先读两 key 的 DB head，有值且可装配→用 DB 档位（其余 direct/ark 细项仍取 env，票 19 前现状）；无值→env 兜底；DB 值不可装配（如凭据事后被撤）→**回退 env 档位装配**并把回退原因写进生效快照，不让配置面把进程打死。两处 boot 接入：`job-worker.ts` 在 `:160` 直接替换；`main.ts` 因 migrate 在装配后，于 `:134` 前先单独 `AdminConfigPostgresRepository.migrate()` + 预读（幂等迁移安全，避免重排 400 行构造链）。装配成功后各进程 upsert 生效快照。**拍板：常规档位切换 = 重启生效**——mode 牵动 execution port、deployment 激活集、catalog 投影、aiStreamingRunner、media runtime 的构造期快照（`index.ts:934-979`），进程内热切会造成半新半旧的装配撕裂；重启生效保证一次装配一个真相，切换的诚实性由"待生效/已生效"可视状态承担。
3. **唯一例外：停用止血立即生效**：在 `main.ts`/`job-worker.ts` 装配处给 execution port 与 media port 的 submit 包一层 `ModeGateExecutionPort`（Ports/Adapters 外围 wrapper，非新 seam）：每次执行前读对应 key 的 DB head（5 秒 TTL 缓存），**仅当 DB 档位为 disabled 而本进程装配档不是 disabled 时**拒绝执行（沿用 `DisabledModelExecutionPort` 语义：rejected_before_accept、零 provider cost、明确中文提示"模型执行已停用"）；其余不一致放行本进程装配档（等重启）；head 读失败 fail-open 沿用装配档并记诊断——配置库故障不放大为全产品停摆。media 只拦 submit 不拦 poll/ingest，已提交任务的收尾不掐断（对齐状态契约"保留成功子任务"）。
4. **命令接线（同一 seam）**：`config_apply` 对这两个 key 走步骤 1 validator 后写 applied revision（幂等/CAS/审计全部复用票 05，本票零新机制）；`config_get`/`config_list` 的 effectiveValue 改从生效快照表读（HTTP 与 job-worker 两进程分别展示），storedValue==两进程 effectiveValue 时 `wired: true`，不一致时返回"已保存待生效"标记与产生时间。
5. **前端/adapter**：BFF 零改动（通用转发已覆盖）。"运行时配置"Tab 内把这两个 key 从通用 JSON 表单升级为**专用档位切换控件**：单选组（模型五档/媒体~~两档~~四档）+ 每档中文说明（停用/演示录制/E2E 固定样本/网关 PoC/真实直连；媒体：disabled=紧急止血档，沿用步骤 3 的 ModeGate 止血机制；ark=火山 Ark；tuzi=Tuzi；ark,tuzi=双供应商并存档，按 deployment channel 路由，见 `apps/core/src/p1/model-supply/adapters.ts:1936-1945` 与并存行为测试 `adapters.test.ts:472-551`）+ 「当前生效」徽章（分进程）+ 「已保存，重启后生效」徽章 + 不可装配档置灰并列缺失项；点选走票 05 的分级变更确认（diff + 影响范围 + 原因必填）。`admin-model-control.tsx` 模型目录 Tab 顶部加只读"当前执行模式"徽章 + 跳转"运行时配置"（管理员看模型证据时第一眼知道现在哪个档在跑）；写入口只在配置 Tab 一处，防两处漂移。

   > 治理批注 2026-07-17：用户拍板，媒体执行模式由'两档'修订为四档（disabled/ark/tuzi/ark,tuzi），依据 batch-T6 分析；两档原文为过时口径。本项同步对齐 DoD-1；四档不是新增范围，而是承认 HEAD `289d93e7` 已实现的真实运维口径。
6. **测试（打 Application Service 与装配函数外部行为）**：`config_apply` 合法档→新 revision、direct 缺凭据→拒绝并列缺失 env 项、fixture 非 e2e→拒绝、非 admin→FORBIDDEN、replay/conflict 复用票 05 断言；装配函数 DB=direct（env 凭据在场）→ assembly.mode=direct、DB 空→env 兜底、DB 不可装配→env 回退且快照含回退原因；对照投影 apply 后 stored≠effective（待生效）→ 重建装配+新快照后 effective 跟进、wired 翻真（学 `postgres-repository.test.ts:345-370` restartedRepository 重启范式）；ModeGate：装配档 direct + head 切 disabled → execute 返回 rejected_before_accept 零成本，head 读失败→放行；HTTP 边界经 `/p1/commands`+`/p1/query` 全链。测试是护栏，不作关票依据。
7. **留证（D01 口径）**：真实两进程运行 + 真实凭据（`docs/_private/tuzi.env` 已备）连续录屏：recorded 档商户提交得 recorded 结果 → 管理员点选 direct（零 env 改动、零部署）→ 界面显示待生效 → 重启两进程 → 界面显示已生效 → 商户工作台提交 `copy.generate` 得真实模型流式文案；再演示切"停用"不重启，商户下一次提交立即得明确停用失败。证据落 `docs/evidence/contentpackage/`。

## DoD（全部必须是用户可见行为）

- 平台管理员在管理模式"运行时配置"分区看到模型执行模式（五档）与媒体执行模式（~~两档~~四档：disabled / ark / tuzi / ark,tuzi）的档位切换控件：每档带中文说明，当前生效档带「当前生效」徽章且分别展示 HTTP 与 job-worker 两进程的生效状态，不可装配的档位置灰并列出缺失项。disabled 是紧急止血档，对应既有 ModeGate 止血机制；ark,tuzi 是双供应商并存档，按 channel 路由到 Ark 或 Tuzi。**对照证据（当前 vs 改造后）**：当前执行模式在产品内任何界面不可见不可改（`admin-control-plane.tsx:14-48` 四 Tab 无档位；`foundation-module.ts:753-764` admin 查询不含 mode），唯一变更方式 = 改 `MODEL_EXECUTION_MODE`/`MODEL_MEDIA_EXECUTION_MODE` 部署环境变量 + 重启重部署（`runtime-config.ts:376/:368`）；改造后管理员全程点选完成，零 env 修改、零代码发布。

> 治理批注 2026-07-17：用户拍板，媒体执行模式由'两档'修订为四档（disabled/ark/tuzi/ark,tuzi），依据 batch-T6 分析；两档原文为过时口径。本批注明确修订 DoD-1，后续按四档验收，不得再以两档要求判定实现冲突。
- 管理员点选新档并通过分级变更确认后，立即看到「已保存，重启后生效」状态、版本 +1、操作者 = 本人；重启两进程后同一界面自动变为「当前生效」，存储值与两进程生效值一致。生效边界（常规切换重启生效 / 停用立即生效）在界面上有明示文案，不冒充秒级热切。
- 档位切换对商户真实生效：recorded 档下商户提交文案生成得到演示结果；管理员切到 direct 并重启后，同一商户在工作台提交 `copy.generate` 得到真实模型流式文案（用真实凭据留证，对齐 D01）；切回 recorded 后恢复演示结果——同一操作在不同档位下的可见差异即"生效机制测试"的用户可见面。
- 紧急止血立即可见：管理员把模型执行切到「停用」后**不重启进程**，商户下一次提交生成立即收到明确的"模型执行已停用"失败（进入需处理，不产生任何新供应商开销）；媒体执行同理，已在途的媒体任务收尾不被掐断。
- 危险值进不去：在 direct 凭据缺失的环境点选 direct、或在非 e2e 环境点选 fixture，保存被拒绝并明确列出原因——管理员不可能保存一个会让下次重启起不来的档位；DB 档位事后失效（如凭据被撤）时进程仍能以 env 档位启动，界面把该 key 标为「需处理」并显示回退原因，不静默装死。
- 权限边界不变：商户角色（owner/operator/reviewer）看不到任何执行模式入口，直调命令收 FORBIDDEN；商户一级导航仍是创作 / 内容 / 素材 / 门店，无任何配置项漏出。
- **关票前置**：步骤 7 的连续录屏/截图 + 生效快照 SQL 输出落 `docs/evidence/contentpackage/`；仅 validator 单测绿、curl 出 JSON、fixture 全绿一律不得关票；且遵守 MAP 全局规则——票 01 聚合合同冻结前本票不得关闭。

## Blocked-by / Blocks

- **Blocked-by**：**票 05（配置持久层）**——本票的写入命令、版本审计、对照投影、key 注册表全部建在其配置服务与两张配置表上；规格 §11 原文"配置持久层是 Admin Control Plane 的硬前置，未落持久层不做可视化配置面"。全局约束：票 01 完成前不得关票（guard 强制）。
- **Blocks**：机器清单中无直接下游（票 20 的前置是 05+19）。但本票产出三样被后续管理面票直接复用的范式资产：key 专属 validator + 环境可装配性探查、boot"DB 优先 env 兜底 + 回退可见"读取、进程生效快照与 wired 翻真——票 19/20/21 各自接线照此模板；票 22（真实链路 0→1）操作时靠本票在界面点选 direct+ark，免改 env 重部署。本票完成不计入北极星：真实跑通链路数仍由 06/09/11→22 主线承载。

## 风险与回退

- **DB 档位把进程打死（最大风险）**：boot 读到不可装配的 DB 值若直接 throw，两进程都起不来，配置面反杀产品。控制：双层防御——apply 时可装配性校验挡住绝大多数 + boot 装配失败自动回退 env 档并把回退原因写进生效快照与界面「需处理」；env 档本身不可装配时保持现状 throw（与今天行为一致，不为想象场景造机制）。
- **两进程生效不一致窗口**：一个进程重启了另一个没有。控制：生效快照逐进程展示，窗口期界面如实显示两进程各自档位，不冒充已生效；disabled 单向拦截保证止血场景不受窗口影响。
- **fixture 漏进生产**：validator 与 boot 双重执行 `APP_ENV=e2e` 限制（同一规则源 `parseMode`），两道门都实测断言。
- **ModeGate 给执行热路径加 DB 读**：仅止血判断需要，5 秒 TTL 缓存 + fail-open（读失败沿用装配档，配置库故障不停摆执行），且模型/媒体执行本身是低频重操作，一行 head 索引读可忽略；诚实声明 fail-open 意味着配置库故障期间"停用"最长延迟到故障恢复后 5 秒内生效。
- **双真相源漂移复发**：本票后 env 仍承载 direct/ark 细项（票 19 前）。控制：档位两 key 的 wired 已翻真且对照投影常显；其余细项维持票 05 的「已记录（未接线）」标注，接管进度永远可见。
- **回退**：本票增量 = 一张快照表、两个 key 的 validator/接线、一层 wrapper、一个档位控件。出缺陷时把两处 boot 换回 `modelRuntimeAssemblyFromEnv`、摘除 ModeGate wrapper、档位控件降回票 05 通用表单（标回未接线）即回到票 05 状态；已写入的配置版本与审计作为事实保留，不删除。
- **范围失守**：不做凭据管理与测试连接（票 19）、不做 adapter 装配切换与激活真实探针（票 20）、不做套餐生效（票 21）、不做进程内整档热重载与"重启按钮"（进程管理属部署面）、不新增 seam、不把任何配置入口暴露给商户。
