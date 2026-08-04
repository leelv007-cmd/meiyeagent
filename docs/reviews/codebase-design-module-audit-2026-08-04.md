# 主模块深度审计（codebase-design）— 2026-08-04

**方法**：6 路并行审计 agent 按语义分包（appservice / model-supply / harness / entry / contracts / web），统一使用 deep-module 尺子：接口盘点（调用方必须知道的全部事实：签名、不变量、顺序约束、错误模式、必需配置）、深浅裁决、seam 真伪（≥2 adapter 为真）、删除测试、"接口即测试面"检验、内聚断裂线。主控对六路报告共抽验 **23 条关键论断，全部坐实**（抽验记录见附录）。

**范围**：排除生成物（paraglide messages、routeTree.gen.ts）后按行数与中心度选出的主文件，约 4.9 万行核心源码；harness 目录全景（162 文件 / 9.6 万行）、contracts 全包（75 文件 / 1.9 万行）纳入结构统计。

---

## 总判决

这套代码的**领域实现是深的，接口纪律是塌的**。每一簇内部都存在真正深的模块（`ai-sdk-runner`、`dbos-workflow`、`CanvasTextGenerationOutboxWorker`、`server-shutdown`、web 侧的 `*-live.ts`/`*-model.ts` 惯用法），证明团队完全掌握深模块的做法；但主文件层面被三类系统性缺陷拖垮：**持久层拒签合同、单实现接口冒充 ports/adapters、死表面积无人清理**。后果最直观的量化指标：前端 **23+ 个测试文件在用正则匹配源码文本代替行为测试**，后端 postgres 测试 **61 处直捅数据库**——"接口即测试面"在前后端以两种镜像形态同时失效。

---

## 七大系统性病灶（跨簇交叉印证）

### ① 持久层拒签合同（最高杠杆缺陷）

- `PostgresModelSupplyRepository`（43 公有方法）**无任何 `implements` 子句**；39 成员的 `ModelSupplyControlPlaneRepository` 唯一实现者是内存版（foundation-module.ts:736）——**接口只被从不上生产的 adapter 测过，生产路径无合同约束**（model-supply/postgres-repository.ts:159）。
- `PostgresHarnessStore` 只 `implements` 4 个接口，其余 ~33 个公有方法被 **8 个从未具名的角色接口结构化消费**；main.ts 把同一个 store 塞进 15 个注入位（harness/postgres-store.ts:112）。
- 直接后果：无法对合同做双实现契约测试 → `postgres-store.postgres.test.ts` 61 处 `pool.query/client.query` 直断表状态，**事实测试面是 schema 不是接口**。

### ② 端口戏服：单实现接口冒充 ports/adapters

- harness `production-stage-ports.ts` 声明 10 个端口，**9 个全仓只有 1 个实现**（HarnessPrimitiveCheckPort、SensitiveLexiconReadPort 等全仓零 `implements`）——16 位置参数构造器给每个参数披了件接口外衣，不是端口架构。
- product-service 4 个端口（SearchProjection/PackageRightsPropagation/StorageEntitlement/UsageProjection）全部单 adapter，其一（UsageProjection）**零具名实现**、只有 main.ts 里一个字面量，且 job-worker 根本没接。
- integrations 的 SecretStorePort/FeishuMcpAdapterPort/ProviderConnectivityProbePort 全部 1 实现。
- 必需性靠运行时抛错兜底：harness 两个 stage-ports 文件合计 **49 处 "requires/unavailable/not configured" throw**——"哪些端口必须存在"没进类型系统。
- **化石证据**：`supply-registry/production-provider-evidence-wiring.test.ts:31` 用 `assert.match(source, /new IntegrationApplicationService\(\{…providerConnectivity,/)` **正则匹配构造函数源码文本**验证装配——缺 seam 时测试只能测拼写。

### ③ 死表面积

- `OperationsApplicationService`：97 公有方法中 **35 个零生产调用方**（仅测试消费）、55 个单调用方；团队早已诊断（product-billing/foundation-module.ts:4 的 S1 freeze 注释 + `retired-e-command-surface.test.ts` 枚举 40 退役命令/15 退役查询），但**退役命令对应的方法全部还活着**，约 1500 行整块退役区。
- contracts：901 个导出符号中 **295 个（32.7%）无任何消费方 import**；仅 197 个（21.9%）被两侧同时消费（真 seam）。39 个 `export *` + 仅 1 个 subpath export，发布一个符号的成本是一个关键字。
- model-supply：`recorded-media-adapters.ts` 16 个导出类中 **12 个是 4 行零行为命名壳**；index.ts 35 个本地导出中 20 个零外部调用方。
- migration 穿透块（operations/application-service.ts:9843-9931）：9 个方法逐一 8 行委托给形状完全相同的依赖接口。

### ④ 组合根泄漏域逻辑 + 双装配漂移（含行为缺陷）

- main.ts 藏了 ~350 行域规则：`validateDefault` 平台默认模型准入 6 重条件（:1723-1771）、marketing-identity 不变量、裸 SQL `writeOwnershipReader`（:1865）、readiness 探针——**全部因组合根零导出而不可测试**。
- main.ts 与 job-worker.ts：172 vs 90 个顶层 const，**50 段逐字节复制 + 21 段漂移**。已确证的行为级漂移：
  - **worker 的 Pool 无 `max` 上限**（job-worker.ts:209 裸构造 vs main.ts 带 businessPoolMax）；
  - worker 的两个 `ProductService` 以 `undefined, undefined` 缺装 copyProviders/qualitySink，缺 contentWriteOwnership 和 usageProjection。
- server.ts 的 `createCoreServer` 是 1744 行单闭包：38 个 catch 块重复错误→HTTP 映射（613 行，22% 篇幅）、SSE 生命周期一份抽了一份没抽、`/public/plan-catalog` 路由内算计费、资产租户规则靠 `objectKey.split('/')[0]` 字符串手术。

### ⑤ "接口即测试面"双镜像失效

- **后端形态**：无合同 → 只能直捅 DB（病灶①）。
- **前端形态**：四大文件 mount 测试为零 → **23 个测试文件 `readFileSync` composer-home.tsx 后正则断言源码**。`composer-delivery-mount.interaction.test.tsx:113` 自白原文："rendering it here would mean standing up the whole workbench. Read as source instead"。`result-center-route.test.ts:12` 因无法 import 路由的 `validateSearch` 而**镜像重实现了一份**当覆盖——两份可静默漂移。已知本仓 e2e 昂贵脆弱（见 ops runbook），模块形态把 e2e 逼成唯一行为测试面。
- 测试体量代偿：unified-media-stage-ports 测试 5717 行（1.47× 实现）、production-stage-ports 测试 38 次手工构造 16 参构造器、content-package.test.ts 4367 行——**接口不收窄，测试就得按组合爆炸买单**。

### ⑥ 引擎复制与双合同

- workflow-core.ts 同一套五阶段骨架跑三遍（`runHarnessWorkflow`:1004 / `runNoteHarnessWorkflow`:1638 / `runMediaHarnessWorkflow`:2142，共 1732 行）；UnifiedHarnessStagePorts 的 copy 半区 10 个方法纯一行委托 + runtime throw，是 `extends` 继承链的直接副产品。
- **`ProviderExecutionPort` 双定义**（model-supply/provider-lifecycle.ts:157 与 foundation/ports.ts:144），~20 个 adapter 分挂两份竞争合同下——这是全仓最强真 seam，却有两个户口。

### ⑦ contracts：真 seam 与"上楼的私有类型"混居

- 身份层零 branded type：`z.string().trim().min(1)` 在 ≥14 处复制；`content-package.ts:405` 的 **`failureCode: contentPackageIdSchema`** 是类型系统为范畴错误背书的实锤。
- `ApiFailure.code: string` 不约束——core 实际发 17 种错误码无一枚举，web 无法穷尽 switch（而 marketing-package.ts:493 证明团队会做对，只是不成规矩）。
- 行为泄漏：723 行鉴权决策树 `requiredP1Capability`（capability-permission.ts:313，测试全在 core 侧 7 个文件）、计费数学 `computeProductAmount`、中文 UI 标签表、UI 状态机——全在"类型包"里。
- web 侧 43% 是 `import type`、仅 81 处 parse vs core 647 处：**superRefine 不变量事实上是服务端单边担保，客户端在裸信**。
- `actionable-inbox.ts` 不在 index.ts，靠 pending-action.ts:127 意外转发发布。

---

## 各簇一页结论

| 簇 | 判决 | 最重一条 |
|---|---|---|
| operations app-service（9954 行） | god-module，1/3 接口已死 | 97 方法：35 零调用/55 单调用/7 多调用；真 seam 在下游 `P1OperationModule.execute`（3 参数），本类是骑在窄 seam 上的第二张宽接口 |
| integrations app-service（2537 行） | 浅但成比例，无死面 | 26 方法近 1:1 映射 27 命令分发器；Feishu 半区（50% 篇幅）与凭据半区被 5 个共享 guard/codec 助手缝死，拆分前须先抽内核 |
| model-supply（1.9 万行主文件） | 戴 barrel 帽的 god-module + 全仓最好与最差并存 | `ModelSupplyApplicationService` 4349 行/79 方法/19 字段构造器，仅 1 个外部调用方；`ai-sdk-runner` 是教科书深模块（5 成员接口罩 4 家 provider，2+ adapter 真 seam） |
| harness（9.6 万行目录） | 引擎三胞胎 + 端口戏服 + god-store | 唯一双 adapter 真 seam 是 `ImageExactTextVerifier`（live/fixture 生产开关）；`dbos-workflow.ts` 是真深模块（DBOS 耦合 100% 封死，workflow-core 零框架依赖）；issue-255 证据收集器 1.2 万行常驻生产源码树 |
| entry + product-service | 组合根泄漏 + 双装配漂移；product-service 深而模式旗标超载 | `apply` 1519 行 37-case switch 深得其所（删除测试通过，3 仓储 adapter 真 seam 回本）；但 5 个正交模式维度（acceptedWriteOwner 等）+ 58 个无类型错误码把接口撑宽 |
| web 四大文件 | 抽取惯用法之上的"接线残渣" | composer-home 4843 行 = 22 个关注点 + 33/24/27 个 useState/useRef/useEffect；`composer-live.ts` 的传输注入 seam 就在下一层，**四大文件全都骑在 seam 上方却不用它** |

## 亮点（证明修复模式已在仓内验证）

- `createCoreServer`：24 个测试文件 vs 1 个生产调用方，22 字段依赖包 2 必填 20 可选、缺则降级 503——**入口层最佳设计**，也是 main.ts 可治的证据。
- `product-service` 的仓储 seam：同一套 2879 行测试跑 Memory/Postgres/Relational 三个 adapter——seam 回本的现役范例。
- `dbos-workflow.ts` / `ai-sdk-runner.ts` / `CanvasTextGenerationOutboxWorker`（1647 行 5 方法）/ `server-shutdown.ts`——四个现役深模块样板。
- web 的 `*-live.ts`（传输注入双 adapter）+ `*-model.ts`（纯投影 node:test）惯用法：composer 目录 84 个测试文件的底盘。**所有前端建议都是把已验证模式再用一次，无一需要新范式。**

---

## 修复路线图（按杠杆/风险排序）

### P0 — 纯减法，零设计风险
1. **删 operations 的 35 个零调用方方法 + 9 方法 migration 穿透块**（~1600 行，无调用方需要改，退役清单测试已在护航）。
2. **合并 `ProviderExecutionPort` 双定义**为单一权威（全仓最强 seam 不能有两个户口）。
3. **补 `recorded-media-adapters.ts` 测试**（默认生产执行模式，当前零测试引用）；12 个 4 行命名壳换 `RECORDED_MEDIA_ADAPTER_CONTRACTS` 表驱动工厂。
4. web 一行修：`result-center-search.ts` 已导出 `parseResultCenterSearch`，路由改 import，删镜像重实现。

### P0 — 签合同（病灶①）
5. **`PostgresModelSupplyRepository` 加 `implements`**：先把 39 成员接口收窄到双实现共需子集，让编译器报差异；随后 Memory/Postgres 双实现跑同一套契约测试。
6. **`PostgresHarnessStore` 按现存 8 个角色接口拆分**（interaction 块 885-1913 与 Langfuse/observability 块 3098-3600 先行），61 处直捅 DB 的断言随之改为方法级。

### P1 — 结构性（各簇报告一致指向）
7. **抽 `CoreAssembly`**：`assembleCore(env, {role:'api'|'worker'})`，收敛 50 复制 + 21 漂移段，顺带修 worker Pool 无上限、ProductService 缺装两个行为缺陷；main.ts 的 ~350 行域规则（validateDefault 等）随之可测。
8. **server.ts**：`toHttpError` 错误翻译表（-570 行）+ 声明式路由表（auth 顺序变数据）+ SSE 生命周期合一。
9. **workflow-core 三胞胎收敛**为 lens→stage-descriptor 表驱动单 runner；UnifiedHarnessStagePorts 的 10 个穿透方法随 `{copy, media, note}` 三协作者签名自然消失；stage-ports 构造器改具名必填分组，49 处 runtime throw 变类型错误。
10. **contracts 三连**：branded id + 17 错误码判别联合（修 `failureCode` 误用）；`/wire`、`/vocabulary` subpath 拆分 + 显式导出清单（295 个死导出浮出并可 CI 化"wire 必须双侧消费"）；行为迁回测试所在地（鉴权树→core、计费数学→core、标签表→web），web 入站响应统一 `.parse` 关闭单边担保。
11. **web 三钩子**：`useComposerRun`（~700 行，attemptSubmit 225 行门梯变 node:test 靶子）、`useComposerInteractions`（SSE+HITL）、`useResultCenterView`（47 props 变类型化返回值）；integration-settings 一行加 `settings?` prop 把现成 facade 从假 seam 转正。23 个正则测源码的测试随抽取逐批退役。

### 明确不做（各审计路独立得出的克制结论）
- **不拆** 4349 行 `ModelSupplyApplicationService`：单外部调用方，拆分是重组成本不是杠杆；先做 P0-3/P0-5。
- **不投资**九个单实现 harness 端口和四个单实现 product-service 端口的"完善"——删除测试判定纯穿透，应内联或删除，**等第二个 adapter 出现那天再立 seam**。
- **不动** integrations 的 Feishu/凭据拆分，除非先抽出共享 guard/codec 内核（5 助手 × 11 调用位，先拆必然复制）。
- `byokExecutionMode` 旗标是否升级为 adapter：先数分支位，一两处就留旗标。

---

## 附录：主控抽验记录（复核取反驳立场，23/23 坐实）

| # | 论断 | 验证 |
|---|---|---|
| 1 | ProviderExecutionPort 双定义 | grep 实锤两处 `export interface` |
| 2 | Postgres repo 无 implements / 内存版独占合同 | :159 类声明无子句；:736 唯一 implements |
| 3 | recorded-media-adapters 零测试引用 | 全仓 grep 空 |
| 4 | ModelSupplyApplicationService 单外部调用方 | 仅 operations/model-supply-image-adapter.ts |
| 5-9 | 三 runner 行号 / store implements 4 接口 / 假端口零 implements / 61 处直捅 DB / copy 穿透原文 | 逐条 sed/grep 坐实 |
| 10-14 | failureCode 误用 / 零 branded / 鉴权树 723 行测试在 core / 39 export* / 中文标签 | 逐条坐实 |
| 15-18 | S1 freeze 注释 / 退役清单 / migration 穿透 / 正则测装配源码 | 原文照录 |
| 19-22 | Pool 上限漂移 / worker undefined 装配 / validateDefault 在 main / 37-case switch | 原文照录 + 计数吻合 |
| 23 | mount 自白 + 23 文件正则耦合 + validateSearch 镜像 + composer-live 注入默认值 | 原文照录 + 计数吻合 |
