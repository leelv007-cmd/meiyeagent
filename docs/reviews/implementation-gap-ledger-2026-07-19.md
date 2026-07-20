# 实现差距总账（Implementation Gap Ledger）— 2026-07-19

> **初始对账基线**：HEAD `9788f20`（docs: align living authority with D-041/D-042 and record remediation）
> **当前复核基线**：HEAD `e3032b0`（D-046 自由追问口 + Day-0 默认供给按正额度模态放行）；后续增量以本页 §7 持续更新节为准。
> **对账方法**：两路独立文档提取（权威文档承诺面 / 六份评审报告未完项）+ 主会话代码逐条核实。
> **权威文档侧**：PRODUCT.md、CONTEXT.md、DESIGN.md、`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（D-001~D-046）、`docs/specs/beauty-marketing-agent-full-feature-dev-spec.md`（67 stories + 18 实现决策）。
> **评审报告侧**：codex-full-feature-implementation-review-2026-07-18、product-walkthrough-gap-review-2026-07-18、doc-consistency-review-2026-07-18、ticket-pack-codex-review-2026-07-18、uiux-productization-gap-report-2026-07-13、`.impeccable/critique/2026-07-18T15-57-52Z__mkfast-template-main-src-product.md`。
>
> **总判**：主链承诺（D-026~D-042 + 25 票）基本全部落地，未发现「文档声称已做、代码未做」的欺骗性差距。剩余差距分四类，性质不同，处置策略不同。

---

## 0. 快照后增量（记忆基线 `2a9d56d` → `9788f20`，11 commits）

D-042 修复批已全部执行完毕（此前记录为「修复待执行」）：

| commit | 内容 | 对应 critique 条目 |
|---|---|---|
| `33772ea` + `cab0952` | /pricing 重皮为门店橱窗品牌（Inter+中文字体栈、瓷/暗壳、诚实 CTA、单排价格卡）+ 新增 pricing.contract.test.ts | P1-1 pricing 整页模板皮（hue38+Bricolage） |
| `f7e1e03` | 瓷质标题带、氛围页头、身份状态标签、隐藏 Work/Job/Session 导航、报价改产品用量口径 | P1-2 内页页头对比度硬失败 + P1-3 内容卡白字压浅渐变 + 商家语言泄漏 |
| `b5502fb` + `bf61889` | 内容套组清单收进对话流（D-031/D-042）+ i18n 键 | P2-1 套组槽位表单回潮 |
| `1d40720` | 流式文案状态诚实化 + 个性化问候 | P2-2 「正在起草」误导态 |
| `6c633b9` `1656da7` `ee30ef8` | Composer CTA/焦点环/Cmd+Enter/字号下限；工作台单主轴 UX；**token / 暗色壳实装**（`.dark .meiye-product-shell`、walk-f-visual / sole-axis 谱系，`1656da7` 主承载） | critique 附带项 + D-042 暗色实装 |
| `1a74917` | 生产/预发拒绝弱密钥（新增安全修复） | — |
| `9788f20` | **文档权威对齐**：D-041/D-042 入账、待验证 16/18 状态更新；DESIGN.md §7 暗色条款与活文档口径同步（**非**暗色 token/壳代码落地 commit） | 文档对齐 |

---

## 1. 八个「声称已完成」疑点的代码裁决

由权威文档提取路标记「值得代码核实」，主会话逐条核实：

| # | 疑点 | 裁决 | 证据 |
|---|---|---|---|
| 1 | 视频管线是否真接通 | **代码闭**：生产接线为 ModelSupply `ArkMediaExecutionPort` + composed-video runtime；旧 `apps/core/src/video/ark-provider.ts` 已 deprecated 且无生产引用。走查真机验过入口与重载恢复；六题运营数据仍属环境差距（见 §4） | `apps/core/src/p1/model-supply/ark-media-adapter.ts` / composed-video runtime |
| 2 | 生产五段 Harness 是否真用 DBOS（非仅 PoC） | **✓ 闭**：main.ts 条件装配 + DBOS.launch + registerHarnessDbosWorkflow；PoC 目录 `harness-poc/` 已删（T08 已执行） | `apps/core/src/main.ts:909-1017` |
| 3 | D-042 全量 P1+P2 是否真修 | **✓ 闭**：见 §0，五条全部对上修复 commit。critique 快照（07-18T15:57Z）在前、拍板 `2a9d56d` 与修复批在后，评审侧「时序矛盾」就此解决 | git log |
| 4 | DESIGN.md 暗色条款自相矛盾 | **✓ 闭**：暗色 token/壳由 `1656da7`（及 walk-f-visual / sole-axis 谱系）落地，`.dark .meiye-product-shell` 在 styles.css 实存；`9788f20` 仅做文档权威对齐（§7 暗玻璃三档/墨色翻白/玫瑰金暗档入 DESIGN） | DESIGN.md §7 / styles.css |
| 5 | 审计双写是否接线到五段实执行 | **✓ 闭**：recordTrace→PG store（同步权威）+ HarnessLangfuseOutboxWorker（异步观测），符合 D-036「自建 PG 审计表为准」 | `dbos-workflow.ts` / `outbox-worker.ts` |
| 6 | ContentPackage 派生 revision（做同款/快捷修改） | **✓ 闭**：reuse-task-harness-adapter + operations 域 + reuseSeed 全链 | `apps/core/src/p1/operations/` |
| 7 | 三进三出 HTTP+SSE 合同测试 | **✓ 闭**：packages/contracts 七组测试证明 schema/领域合同；真实 HTTP+SSE 边界由 Core `harness/http.test.ts` 与 `workflow-events-http.test.ts` 证明 | `packages/contracts/src/*.test.ts` / `apps/core/src/p1/harness/*http.test.ts` |
| 8 | 素材同意标记为素材属性（非每条内容关卡） | **✓ 闭**：model-supply reference-asset-resolver + foundation 实现；走查中素材授权真实阻塞过生成 | `apps/core/src/p1/model-supply/` |

---

## 2. 第一类：有拍板背书的有意置后（不欠账，须认账）

全部挂明确触发点，**不应在当前阶段动工**：

| 项 | 拍板依据 | 触发点 |
|---|---|---|
| Week 0 合规预登记文档落盘（09 章 17 条义务承载） | D-039 + D-040 | 全量功能完成、重启验证 |
| 门店两波进场（4-7→8-12 家）+ 回放窗 | D-026 + D-040 | 同上 |
| WOZ 拦截操作台 + intervention_log（操作台/日志零实现；已有 free-form `harness.woz.recipe`，与 D-040 一致） | D-033 建造顺序条暂停 | 同上 |
| eval 集运营采集（BAML 阈值标定依赖） | D-035 / 待验证 17 | 运营期 |
| 「已验证」证据合同预登记锁定仪式 | D-024 / spec 决策 13 | 运营重启补办 |
| Stage 2 偏好学习放行（候选链+确认卡已建成，学习不影响输出） | spec 决策 10 | BeautyPreferenceMemoryEval 过关 + 回放数据 |
| admin-config 强类型 Harness artifact schema + 四态发布门（当前配方 free-form） | D-037 / 待验证 19 | 回放校准出真实字段 |
| BAML 迁移 / Mastra 四 spike gate / Dify 子流引擎 / CF AI Gateway 火山 spike | D-035 / D-037 / 待验证 20 | 各自触发式 |
| React Flow 只读 DAG viewer / n8n 内嵌 | D-037 | 运营可视化成硬需求 |
| 医疗美容品类 | D-025 | 五门全过后按商家条件启用 |
| 平台自动发布（点评/美团只输入、朋友圈只导出）+ 付费投放 | spec Out of Scope | 账号级链路验证 |
| 待验证 1-15（频次/机会/素材槽/作用域/记忆阈值/归因实证项） | 权威文档 Open Questions | 运营回放采集，指标定义不动 |

---

## 3. 第二类：真实功能残差（本轮已裁决）

### 3.1 重点条目

| 条目 | 本轮裁决 | 处置 / 证据 |
|---|---|---|
| **源内容导入 Canvas** | `verified_closed` | `1283df2`：Web 传递 ContentPackage/version，Core 核验精确版本、权限与状态，播种非空标题、正文、CTA 和已授权视觉，并保存 lineage/audit；历史弱 carrier fail-closed，不再生成空白画布。 |
| **身份管理商家面表单形态** | `verified_closed` | `1283df2`：改为单问卡、答案 chips、编辑与资产预览确认，保留原注册命令和生命周期。焦点随问题/预览移动，支持 `aria-live`。 |
| **机会卡未上工作台 hero** | `verified_closed` | `1283df2`：TodayRecommendation 增加 opportunity 投影，只显示 active、未过期、非 fallback 且有 matches 的紧凑机会卡。 |
| **无价门外币/异体字/长距离绕过** | `verified_closed` | `7854abc`：覆盖 Unicode 货币符号、USD/CNY/yuan、繁简价格单位和同分句长间隔，并补误报排除；定向 **60/60**。 |
| **交付完整性与补偿门** | `verified_closed` + `trigger_deferred` | `1283df2`：receipt 绑定、assisted 授权、原子消费/写 event、TOCTOU audit 已闭。`automatic_verified` 继续由 `publishRecoveryVerified` 强阻断；真适配器启用前必须补 durable recovery 故障注入证据。 |
| **失效 producer 五残点** | `verified_closed` | `1283df2`：业务 PG 同事务 outbox + 幂等 backfill + `SKIP LOCKED` lease/token fencing + retry/dead-letter/superseded + revision-aware event，worker 移出 Harness 条件块。PostgreSQL 定向 **10/10**。 |

### 3.2 其余登记项

**实施评审 §10.3 / §11.4**：`921d6f6` 已闭 #48 attempt/span 身份与自由文本 PII 脱敏，已闭 #49 promptfoo 显式断言与失败控制组。importer/sender transport helper 物理共享是 P3 可维护性建议，无行为缺口；Stage-2 abstention 在抽取器启用前保持 `trigger_deferred`。#47 双阻塞 409 经写侧与 PostgreSQL 不变量测试确认为不可达防御分支，保留 fail-closed。

**走查 §7.5**：`2c3ffa8` + `1283df2` 已处理 raw status/Job ID、模板 slug、商家面英文技术词、zh admin Work、hero 层级 token、移动端重复标题、热点边界、revision 语言、查询同步、locale 键、Canvas 对象词与滚动节流。portal 经裁决为非模态 popover，不应强加 focus trap；Sonner 已使用 `--layer-toast`，无残差。

---

## 4. 第三类：环境性差距（代码闭、运行态开）

| 项 | 现状 | 需要什么 |
|---|---|---|
| 本地 dev 默认 harness 不激活 | 根 `.env` 无 `HARNESS_DBOS_SYSTEM_DATABASE_URL`；`.env.example` + DEV-START.md 已文档化 | 开发者按文档配独立 DBOS system DB |
| 模型 key 未配置 | `.env.example` 当前相关 key 为空；目标 worktree 无根 `.env`。不得读取或复制其他工作区私有密钥 | 配置经授权的真实 key 后复核视频/文案真实模型 |
| /pricing 推荐档 CTA「不可用」 | 当前支付 provider 为空且公开付费发布关闭，UI 是诚实不可用态，不是“Stripe 假 key” | 真实支付环境复核（D-042 遗留待验证） |
| 托管环境 Last-Event-ID 断线续传 | 本地真实 LLM 增量流已由 `docs/evidence/contentpackage/real-run-0002` 证明；仍缺托管代理主动断线、携带 Last-Event-ID 重连续播 | 上托管环境验证无丢帧/重复并与最终权威结果对账 |
| 视频六题验收数据留存（单片成本/时延/质量率/开关/来源） | 管线代码在，数据须真实运营产生 | 运营期采集（挂 D-024 预登记补办） |

注：CI job **配置已闭**（core-quality.yml：postgres 16 service + `TEST_DBOS_SYSTEM_DATABASE_URL` 分库 + 执行断言；E2E 为 opt-in）。但 `origin/main` 尚未包含当前配置，现有远端运行属于旧版本失败记录；**当前版本远端成功证据待推送后补齐**。

---

## 5. 第四类：账本自身对齐（本轮已裁决）

| # | 项 | 裁决 | 证据 / 后续规则 |
|---|---|---|---|
| 1 | **空态示例** | `verified_closed` | D-029 为现行决策；桌面端已有 opt-in「查看示例」/做同款/零写入证据，`1283df2` 补移动端本地 opt-in/隐藏和 E2E 口径。不再要求用户重复拍板。 |
| 2 | UIUX 24 条差距映射 | `verified_closed` | `8176808` 已在报告补 24/24 历史处置附录，并明确禁止伪造为 #25–#49 一对一映射。 |
| 3 | D-031 边界 | `verified_closed` | `8176808` 按权威 D-031 与 PRODUCT 原则裁决为「所有商家侧结构化输入」；`1283df2` 已按该边界修复身份面。 |
| 4 | 待验证 20 条去向 | `verified_closed` | `8176808` 已补 20 项规范化状态、证据与触发点，决策票守卫 **10/10**。 |
| 5 | UIUX 降级/de-scope 建议 | `verified_closed` / `accepted_scope` | 零配置示例按 D-029 处置；URL 抓取与额外触区不属现行硬承诺；中文字体栈与 pricing 已有合理 fallback。无新的代码欠账。 |

---

## 6. 收口原则

1. 只继续 `trigger_deferred` 或 `environment_open`；它们必须等明确触发点或外部环境到位，不得伪写为代码已完成。
2. `verified_closed` 不得重新立项，除非出现新反证、回归或新的权威决策。
3. 任何触发式能力开启前，先将对应强制门、故障注入或真实运营证据回填本账本。

---

## 7. 2026-07-19 Agent Teams 复核与处置状态（持续更新）

> **历史工作分支**：`fix/implementation-gap-ledger-2026-07-19`（已合入）；当前活状态在 `main`，不得从该分支名推断仍待合并。
>
> **状态口径**：`verified_closed` 已由当前代码与测试证明；`accepted_scope` 经权威边界复核后确认不是欠账；`trigger_deferred` 当前生产能力不可达或权威触发点未到，须在触发前完成所列门；`environment_open` 需要外部环境证据。
>
> **防重复规则**：后续复核从本节未闭状态继续；不得重新打开 `verified_closed`，除非有新的反证、回归或权威决定。

| ID | 台账条目 | 当前裁决 | 处置 / 证据状态 |
|---|---|---|---|
| GL-01 | §1 八个“声称已完成”疑点 | `verified_closed` | 已校正视频生产接线为 ModelSupply + composed-video，HTTP+SSE 证据指向 Core HTTP 测试，并修正提交号 `1d40720`。Contracts **38/38**，相关 Core HTTP 定向 **26/26**。 |
| GL-02 | §2 有意置后项 | `trigger_deferred` / `accepted_scope` | 逐项有 accepted 决策、明确触发点或 Out of Scope 依据；未发现被伪装成已完成的当期代码承诺。 |
| GL-03 | 源内容导入 Canvas | `verified_closed` | `1283df2`：精确 package/version 核验与非空内容播种，存储 lineage/audit，弱历史 carrier fail-closed。 |
| GL-04 | 身份管理面仍为表单 | `verified_closed` | `1283df2`：单问卡 + 答案 chips + 资产预览确认，保留身份库、编辑和生命周期动作；新增组件与 E2E 合同。 |
| GL-05 | 机会卡未上工作台 hero | `verified_closed` | `1283df2`：TodayRecommendation 合同与投影已接通，只展示 active/未过期/非 fallback/有 matches 的机会。 |
| GL-06 | 无价门外币/异体字/距离绕过 | `verified_closed` | `7854abc`：公共执行入口新增边界与误报矩阵，定向 **60/60**。 |
| GL-07 | 交付补偿、publisher 幂等、TOCTOU 审计、receipt 精确匹配 | `verified_closed` + `trigger_deferred` | publisher/consume 共用 receipt 派生 attempt/idempotency identity，锁内冲突在锁外写 canonical audit；assisted 必须先按完整 binding authorize，并在同一 workspace transaction 内原子消费 receipt 与写 handoff event，保存失败两者一并回滚。新 native event 使用 `approval_receipt_v1` 强身份；补偿自身失败则以 `publishRecoveryVerified` 阻断 `automatic_verified`，真适配器启用前必须补 durable recovery 故障注入证据。 |
| GL-08 | 失效 producer 五残点 | `verified_closed` | `StoreFact` append 在业务 PG 同事务写 expiration outbox，migration 幂等 backfill 存量；worker 以 `SKIP LOCKED` + lease/token fencing 跨副本 claim，支持指数退避 retry、dead-letter、过期 claim 重领与 superseded 终态，并按 fact revision 定位 bundle、生成含 revision 的确定性 eventId。worker 已移出 Harness 条件块；旧内存水位/listExpired 路径已删除。单元 **3/3**、PostgreSQL 定向 **10/10**、Core 全量持久层套件 exit 0、Core typecheck 通过；未配置 Harness 的独立 Core 启动与 `/health` 200 已验证。 |
| GL-09 | #48/#49 技术残差 | `verified_closed` + `trigger_deferred` + `accepted_scope` | `921d6f6`：attempt/span 身份、PII 脱敏、promptfoo 显式断言已闭；生产组 **14/14**，故意失败控制组 **0/1** 且 **0 errors**。transport helper 共享是 P3 结构建议；Stage-2 abstention 等抽取器触发。 |
| GL-10 | #47 双阻塞 409 | `verified_closed`（有意 fail-fast） | D-032 下的防御性不变量；写侧与 PostgreSQL 双向测试证明合法状态不可达。保留 fail-closed，不静默择一。 |
| GL-11 | `completedDelivery` 未绑定 receipt | `verified_closed` | 新 native delivery event 以 `deliveryIdentity.schema=approval_receipt_v1` 同时绑定 approvalReceiptId 与派生 deliveryAttemptId；Web 只结算该强合同下的 exact receipt+attempt。历史无身份事件仍可解析和展示，但不会结算新 receipt，旧 platform+variant 同型事件不再误命中。 |
| GL-12 | 空态示例三方冲突 | `verified_closed` | D-029 已定案；桌面保持 opt-in「查看示例」/做同款/零写入，`1283df2` 补移动端本地 opt-in/隐藏和新 E2E 口径。 |
| GL-13 | UIUX 24 条映射 | `verified_closed`（文档卫生） | `uiux-productization-gap-report-2026-07-13.md` 已补 24/24 历史处置附录，列明旧票行政状态、现行承载与真实残差，并明确禁止伪造到 #25–#49 的一对一关系。 |
| GL-14 | 待验证 20 条状态 | `verified_closed`（文档卫生） | 合并权威设计已补 20 项规范化状态、证据与触发点，并修正待验证 19 被正式五段实现穿越的时序文字；决策票守卫 10/10 通过。 |
| GL-15 | D-031 边界 | `verified_closed`（无需再拍板） | 权威 D-031 721–726 与 PRODUCT 原则 2 已明确覆盖所有商家侧结构化输入；普通设置/admin 表单不在该禁令内。 |
| GL-16 | §4 环境性差距 | `environment_open` | 本地真实 LLM 增量流已有 `real-run-0002`；仍缺托管代理 Last-Event-ID 主动断线续传、真实支付 CTA、真实视频运营六题、当前版本远程 CI 成功等外部证据；未推送前不伪写已完成。 |
| GL-17 | §3.2 界面细节 | `verified_closed` + `accepted_scope` | `2c3ffa8` + `1283df2`：商家语言、raw status/ID、模板 slug、中英文术语、层级 token、移动标题、热点边界、查询同步、locale、Canvas 对象词与滚动节流已闭。portal 为非模态 popover；Sonner 已走 `--layer-toast`。 |

### 7.1 本轮已执行的验证

- 无价门收口：`production-stage-ports.test.ts` 公共执行入口新旧矩阵 **60/60 pass**。
- source package / Canvas / opportunity：Contracts **15/15**、Core 定向 **67/67**、Web 定向 **29/29**；新 Canvas 文档非空并带完整 lineage。
- 交付完整性定向回归：Core delivery service **14/14 pass**、Web pending inbox **9/9 pass**、Contracts delivery identity **2/2 pass**。覆盖 receipt 派生 publisher identity、锁内 revision race 审计、assisted 缺失/伪造/跨 binding/stale receipt 拒绝、消费与 event 原子失败回滚、历史 event 兼容但不参与新 receipt 结算，以及 `publishRecoveryVerified=false` 自动能力降级。
- 失效收口验证：worker 单元 **3/3 pass**；PostgreSQL **10/10 pass**，覆盖 late append（含 `expiresAt == claim time`）、双 worker 原子 claim、lease 重领/旧 claimant fencing、migration backfill、superseded、失败续跑与 dead-letter；Core 全量持久层套件 exit 0、Core typecheck 通过，Harness 未配置的独立 Core `/health` 返回 200。
- 身份流程、商家语言与其余 UI：identity manager tests **6/6**（`marketing-identity-form.test.ts`）；Web 全量 **513 pass / 1 skipped / 0 fail**；新增身份 E2E 与创作闭环契约。
- 全量回归：Core **1128 pass / 58 skipped / 0 fail**；Contracts **38/38**；root guards **67/67**；全 workspace `pnpm typecheck` 通过；全 workspace `pnpm build` 通过。
- i18n / 格式：`locale:check` **3647 keys**；受影响 Web 文件 Biome **26/26**；`git diff --check` 通过。全库 `pnpm check` 仍会命中本分支修改范围外的既有 Biome 存量问题，本轮未扩张改写边界。
- promptfoo 红线：生产配置 **14/14 pass / 0 errors**；故意失败控制组 **0 pass / 1 fail / 0 errors**（exit 100），证明断言门不是假绿。

### 7.2 合并与运行态收口

- 修复分支已以 merge commit `28a0543` 合并到 `main`；合并后工作树干净。
- 已从合并后 `main` 重新拉起 Web/Core/Canvas/worker：3000/4100/4200 均在监听，Core `/health` 返回 200；Web/Canvas 未登录 curl 分别返回预期的 307 登录/入口跳转。
- 合并后全 workspace `pnpm typecheck` 再次通过。内置浏览器使用现有登录态打开 `/dashboard/assets`，实际看到「表达身份」单问卡与「品牌 / 个人 IP」选项，控制台 **0 errors**。

### 7.3 下一次继续入口

1. 先读取本节与 §7.4 / §7.6；当前没有 `confirmed_fixing` 或 `reviewing`，不得重复开启本轮已闭项。
2. 只在触发点到达时继续 `trigger_deferred`：自动交付 durable recovery、Stage-2 abstention、运营期/外部能力项。
3. 只在环境可用时继续 GL-16：托管 Last-Event-ID、真支付、真视频六题、当前版本远程 CI。
4. critique 残差与 cosmetic 开项见 §7.4 / §7.5；本批在 `fix/critique-open-gaps-2026-07-19` 处置中，**未闭不得伪写 closed**。
5. 每次继续时只回填新证据、运行结果与提交号；没有新反证或权威决策时，不改动 `verified_closed`。

### 7.4 Critique residual open → this branch

> **分支**：`fix/critique-open-gaps-2026-07-19`  
> **状态**：`verified_closed` on branch `fix/critique-open-gaps-2026-07-19`（定向测 55/55；合入 main 后本行保持 closed）  
> **来源**：D-042 / 走查后 critique 残余 + 次级面 polish 漏项

| 优先级 | 条目 | 状态 | 说明 |
|---|---|---|---|
| **P1** | DashboardLayout 共享页头缺 `meiye-ambient-copy` | `verified_closed` | `fix/critique-open-gaps-2026-07-19`：`dashboard-layout.tsx` 标题区套 `meiye-ambient-copy`；shell-visual-contract 断言 |
| **P2** | 13 个 quick-edit chips 未收敛 | `verified_closed` | 改稿 6 chips 常显 + 导出 6 chips 默认折叠；NL 仅走 textarea；detail 测试通过 |
| **P2** | 首页 pricing 仍为模板皮 | `verified_closed` | 共享 `PricingShell` 包 homepage + /pricing；诚实 CTA；contract test 覆盖 |
| Minor | nested auth card | `verified_closed` | 外层 auth 壳去瓷面，仅 AuthCard 单层 |
| Minor | mobile nav mirror | `verified_closed` | 底栏 4 列：创作/进度/内容/门店；去素材与中心 FAB |
| Minor | uppercase eyebrow | `verified_closed` | mobile-action-book / harness-question-card 去掉 uppercase mono |
| Minor | AI badge spark | `verified_closed` | ai_generated 版本徽标 spark-wash/deep |
| Minor | h1→h3 skip | `verified_closed` | ContentPackageDetail 主标题 h2，section 保持 h3 |
| Minor | identity wording | `verified_closed` | 边界/授权问句店主口语化（zh/en） |

### 7.5 开项 · cosmetic P3

| 优先级 | 条目 | 状态 | 说明 |
|---|---|---|---|
| **P3 cosmetic** | hydration state 仍含 internal ids | `open` / cosmetic | 展示层已过滤内部 id；hydration / 序列化状态里仍残留 internal ids。不挡主链，属展示边界洁癖；未修不得标 closed |

### 7.6 历史规划包对账 · 受信返回锚与双端接力（2026-07-19）

> **来源**：`.scratch/creatok-uiux-wayfinding`（15 决策票）+ `.scratch/creatok-uiux-implementation`（S0–S5，均已 2026-07-14 行政关闭）重点交付项逐条代码对账。结论：绝大多数经后续波次换载体落地；真缺失三项处置如下。
> **实现规格**：`.scratch/codex-uiux-fix-2026-07-19/BRIEF.md`；实现 `659690b`（另一执行会话）+ 复核回归修复 `8058be2`（主会话）。

| ID | 台账条目 | 当前裁决 | 处置 / 证据状态 |
|---|---|---|---|
| GL-18 | 受信返回锚（S1 承诺，对账时缺失） | `verified_closed` | `mkfast-template-main/src/product/trusted-return.tsx`：枚举白名单 + `parseTrustedReturn` 拒绝 URL/路径/未知值（无 open redirect 面），锚 href 只从枚举表生成、原始输入永不进渲染；内容/素材详情 validateSearch 收编 `from`，非法静默回退；工作台/内容库/素材库三处以上播种。`trusted-return.test.ts` 拒绝+通过矩阵、详情页组件断言。 |
| GL-19 | 双端接力合同（S4/wayfinding 票11，对账时仅单向深链） | `verified_closed` | `device-relay.ts` 接力合同与 `/dashboard/` validateSearch 严格一致（round-trip 测试）；移动→桌面深链改走 builder；桌面→手机 QR 弹层挂工作台与内容详情（`device-relay-popover.tsx`，qrcode 白底暗色可读、`--layer-popover`、复制链接），与发布 handoff（`/dashboard/handoff/$token`）完全隔离。复核揪出并修复（`8058be2`）：桌面端 package 接力经 `desktopRelayLanding` 落内容详情（客户端 effect 导航，SSR 不误伤手机扫码）；弹层 `--glass-edge` token、copied 2s 复位、clipboard 非安全上下文容错。 |
| GL-20 | S5 类总验收 + 真实用户验证（历史包第三缺失项） | `trigger_deferred` | 「一次性切换 + 排空观察」策略已由 D-040（功能完善优先、运营执行置后）取代，总验收仪式与真实单店 Owner 测试当前无任何现行票承载；在此登记防伪闭，重启验证期须重新立项。 |

验证（`8058be2` 后复跑）：`locale:check` **3655 keys**；Web typecheck 通过；Web 全量 **532 pass / 1 skipped / 0 fail**（较对账前净增 19 用例）；改动文件 Biome 0 违规。历史包其余项对账明细（落地/换形/正当作废逐条）见本轮会话报告，其中换形要点：四目的地取代六项导航（D07/ADR-0011）、Polotno 整体退役改自研 canvas-shell、四层角色第四层为 `reviewer` 非 `platform`、「闭店内容簿」视觉被 07-16「门店橱窗」取代。

### 7.7 两组票包（#50-#60 UX 折叠+供给 / #61-#72 Pro Studio K01-K11）完成后三路符合性审计与处置（2026-07-19 晚）

> **来源**：三路 Opus 独立审计（UX 折叠包逐票 / 供给包逐票含分批 / 产品化完整度盘点）。审计基线 HEAD `a4a418c`。真机数字：Web vitest 604/607 pass 0 fail；Core 真机（compose PG 54329 两 URL）1310/1318 pass，2 fail 均在票包范围外（见下）。逐票判定：UX 包 T1/T2/T3/T5/T6/V1 达标（视频 D-012 显式确认、CTA 竞态、点场景清 preset 三处既有缺陷实锤修复）；供给包 Ta/Tb/Tc(三批)/Td(四批) 全达标（periodEndsAt 缺陷已修、acceptance_unknown 与视频外层失败结算补口已修、legacy apply_plan 退役、兑换码规避 mkfast-app 三 bug）；Pro Studio K01-K11 全闭（商业发售门仍 open，见 STATUS.md Honest residual）。

| ID | 条目 | 裁决 | 处置 / 状态 |
|---|---|---|---|
| GL-21 | **D-046 result 阶段自由文本「调整方向」输入漏做**（T4 范围6，拍板后实施会话未覆盖） | `fixed` | 本轮修复：core `derive_creative_work` 补 T1 同款 `autoConfirmBrief`+`briefDrafts` 透传（application-service / foundation-module）；workbench result 段新增常驻 Textarea+提交（`workbench-revise-direction`/`workbench-revise-submit`），提交=派生 Work（`workbench_revise_intent` 组合方向意图，继承源 Brief，`sourceWorkId` 血缘）→ 自动直发 Harness；零消息持久化实体。测试：fold 断言 D-046、core `creative-work.test.ts` 派生自动确认用例、workspace-provision 真机全绿 |
| GL-22 | **Day-0 开通四模态硬要求地雷**：`provisionModelDefaults` 强制 copy/image/video/audio 四默认全配，缺 audio（全档 allowance=0）即 INVALID_STATE → outbox 永久重试 → 整个 Day-0 直通被阻断 | `fixed` | 本轮修复：必配集合 = trial 档 allowance>0 的模态；零额度模态配了则校验+落偏好、未配则跳过。新增两用例（audio 缺配不阻断 / 有额度模态缺配仍硬失败），memory+postgres 全绿。注意 e2e env 辅助（`e2e-platform-model-defaults.ts`）仍要求四键同配，属 e2e 环境自身约束，未动 |
| GL-23 | 空额度阻塞卡无就地「输入兑换码」入口（RedemptionCard 仅挂设置页；票面「或」合规） | `open` / P2 UX | 额度用尽时商家须导航至设置页兑换，闭环缺一环；后续波次补 composer 阻塞卡内嵌入口 |
| GL-24 | Harness 主路径不提供中止（direct 模式为 stop 逃生口） | `accepted_decision` | 实施方决断：幂等可重放事务链不做「UI 已停、服务端仍交付」的虚假承诺；与 ADR-0007（token 流式）不冲突，相对 T4 原文为能力收窄，产品侧已知悉 |
| GL-25 | 票包外测试红①：`delivery.postgres.test.ts:319` reuse delivery lineage 断言失败（#47 harness 交付域） | `open` / P2 | 与两票包无关的存量红；须单独归因修复，CI 真机 job 上线前必清 |
| GL-26 | 票包外测试红②：`provision-test-db.sh` 未灌 canvas 迁移，`advanced_canvas_projects` 缺表致 pro-studio-runtime postgres 测试红 | `open` / P2 | CI 真机持久层 job 需补 canvas schema，否则该 job 恒红 |
| GL-27 | TS `ensurePersonalWorkspace`/workspace-bootstrap 生产零调用（实际入队=PG trigger 0005） | `open` / P3 清理候选 | 死代码登记，不动语义；顺带记录消费模型=trigger 入队+请求期 lease 消费，无后台 drain worker（崩溃恢复靠 lease 过期重 claim，已测） |

修复轮验证（GL-21/22 落地后主会话复跑）：Web vitest **605/608 pass 0 fail 3 skipped**；Core 全量（既有 meiye_test 库、单 TEST_DATABASE_URL）**1314/1321 pass 0 fail 7 skipped**；web+core typecheck 0 错。注：GL-25/26 两处红出现在审计路的 fresh provision 库+双 URL 环境，本轮既有库下未复现——进一步支持 GL-26 归因（provision 脚本缺 canvas 迁移），GL-25 须在 fresh 库环境下归因。

产品化欠缺总览（详见三路报告，本台账不重复展开）：试点前真欠账四项 = e2e 升 release-required + CI 真机持久层 job（含 GL-25/26）、生产密钥 hardening、trial 额度量/expireDays 定价数值、Langfuse 生产口径二选一；两道商用硬门 = ADR-0008 视频六题 spike 验收与 GL-20 真实单店 Owner 验证（均按 D-040 锁触发点）；Pro Studio 商业门五项照旧 open。当前不可宣称「可试点/可面世/宣发闭环≥1」。

---
