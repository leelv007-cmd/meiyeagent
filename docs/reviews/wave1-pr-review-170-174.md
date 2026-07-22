# Wave-1 PR review — #170–#174

评审日期：2026-07-22。范围是 PR 的提交差异、相关调用链、迁移、测试和 GitHub Checks；本报告不代表任何 live provider、live S3 或生产验收已经通过。

## 共同证据与判定口径

- 五个 PR 均以 `main@50f33eb` 为基线。`core` 和 `core-persistence` 在 `main` 自身的 run `29850363565` 已因 `P1ApplicationService.authorizeModuleAction` 失败；PR #171 的 run `29877589685` 显示同一失败。因此本文将这两项标为 **A1 基线未绿**，除非某个差异另有可归因的失败，不把它误记为该 PR 的回归。
- 当前各 PR 的 `redline-evals` 通过；`live-redteam`、`e2e` 均跳过。它们不能替代 root CI、持久化、真实浏览器流程或 live provider/S3 的验收。
- A1 基线恢复绿色是所有合并及 issue close 的前置条件。A2/特殊测试还须随相应 PR 通过；不得把跳过的 live gate 写成通过。

---

<a id="pr-170-l1-ci-secret-bundle-gates"></a>

## PR #170 — L1 CI：secret / bundle gates

报告锚点：`#pr-170-l1-ci-secret-bundle-gates`

### 摘要

PR #170 增加 root-quality gate 的运行说明、UI/UX bundle 检查与 secret fixture 检查，并为关键脚本增加测试。它的目标与 #131/#132 一致，但目前有一个会把失败写成成功的 shell 管道问题，不能把此 PR 当作可靠的 CI 证据合并。

### 优点

- Secret 检查使用两个精确 fixture literal，而非把测试目录整体排除，覆盖方向正确。
- bundle gate 在 `dist` 缺失时输出结构化 `status: not-run` 并以非零退出，避免把未构建当作通过。
- 新增测试覆盖脚本的主要 failure path，变更集中在 CI gate 范围内。

### 阻断问题

- **[B170-1] `docs/ci/root-quality-gate.md:26` 的 core 命令没有 `set -o pipefail` 或等价的 `PIPESTATUS` 检查：**
  
  ```sh
  pnpm --filter @meiye/core test 2>&1 | tee core-persistence-test.log
  ```
  
  若 Core test 失败、但后续 DBOS/skip 文本断言命中，`tee` 的 0 状态会让 gate 报告成功。这会把实际失败伪装为通过，直接违背 #131 对 failure/skip 证据的要求。应在写入或宣称该 gate 可用前加入 `pipefail`，并增加“Core 失败但日志命中”的回归测试。

### 非阻断建议

- 将 runbook 中每个输出的成功、失败和 skip 语义写成表格，避免人工执行者把 `not-run`、skip 与 pass 混为一谈。

### 测试缺口

- 现有 bundle 测试覆盖“整个 `dist` 不存在”，未覆盖 `dist` 存在但主资产或 CSS 资产缺失的 partial-build 情形。
- 必须新增上述 pipefail 反例，证明 DBOS/skip 断言不能吞掉 Core 的非零状态。

### 安全 / 隐私风险

- false-green gate 会让 secret/bundle/持久化失败被记录为已验证，属于供应链与发布保证风险；本身未见新增 secret 输出。

### 合并顺序风险

- #170 是 root CI owner，须在 A1 绿色后、且 B170-1 修复并在真实 root workflow 验证后最先合并。当前 `core` / `core-persistence` 红色为 main 的 A1 基线，不能归因于本 diff，但同样阻止其作为 close 证据。

---

<a id="pr-171-l2-security-ssrf-stripe-webhook"></a>

## PR #171 — L2 security：SSRF / Stripe / Webhook

报告锚点：`#pr-171-l2-security-ssrf-stripe-webhook`

### 摘要

PR #171 加强私网/IPv6 SSRF 拦截、Stripe customer/user 绑定，并实现带 lease 的 webhook ingress/pipeline 与数据库迁移。SSRF 部分很扎实；但 webhook 路径仍会丢弃已签名事件，且“先结算、后标记”不能证明 effects exactly-once，因此不能作为 #135/#136 的完成实现合并。

### 优点

- `reference-asset-delivery.ts:277-301,349-415` 对 IPv4-mapped IPv6 归一化，并在发起 transport 前拒绝任何非公开 DNS 结果；测试明确断言拦截时 transport 为零调用。
- `stripe-customer-binding.ts:40-77` 和 `stripe.ts:115-136` 将 customer 绑定到 user-scoped idempotency/metadata 校验；迁移 `0007` 在建 partial unique index 前审计重复及 null duplicate，迁移安全性较好。
- `webhook-request.ts` 先执行 body size 上限和签名校验，`webhook-pipeline.ts:90-105` 再 claim lease，基本 ingress 顺序正确。

### 阻断问题

- **[B171-1] 已签名、但不在新 normalizer 白名单中的业务事件会被静默确认并丢弃。** `webhook-pipeline.ts:90-95` 在 `verifyWebhookEvent()` 返回 `null` 时直接成功返回且不调用 legacy handler。`verified-webhook-event.ts:119-193` 仅映射部分 Stripe event，`:203-257` 仅映射部分 Creem event；而既有 `stripe.ts:371-405` 与 `creem.ts:265-323` 仍处理更多订阅状态/事件。结果是之前可处理的、已验签事件变成 HTTP 2xx 的 no-op。应只对显式安全忽略的 event 2xx，其余经已验签的 fallback 路由处理，或扩全映射，并加入 provider × event 的完整回归矩阵。
- **[B171-2] webhook effect 没有跨租约/标记失败的 exactly-once 保证。** `webhook-pipeline.ts:115-146` 先执行 provider handler 与 settlement，再 `markProcessed`；若 lease 到期或最后标记失败，记录会作为 failed/reclaimable 再次被执行，`index.ts:143-171` 支持该 reclaim。`webhook-pipeline.test.ts:183-200` 只有干净成功路径，不能证明这一失败边界。需要事务性 outbox/幂等 settlement，或以真实 store 的故障注入证明任一外部 effect 至多一次。

### 非阻断建议

- `src/db/auth.schema.ts` 被直接改动；该文件在仓库约定中是 Better Auth 自动生成物。应提供再生成/漂移验证，确保 schema generation 不会删除应用代码 index。
- `webhook-pipeline.ts:35-53` 的 status string 应收敛为闭合集合；`payment/index.ts:102-223` 同时承担 provider、DB、settlement facade，后续可以在不改变本 PR 范围的前提下拆分边界。

### 测试缺口

- #135 的 helper test 只覆盖 binding helper，未覆盖真实 Stripe portal 与 subscription update/delete webhook 路径；尤其 `stripe.ts:782-858` 的更新/删除路径需证明远端 customer ↔ user 反向校验始终执行。
- 需有 `markProcessed` 失败、lease expiry、worker crash/reclaim、provider retry 的持久化集成测试，而非仅 in-memory 成功路径。
- 需要已签名但未 normalizer 化的 Stripe/Creem 事件不会被静默丢失的端到端测试。

### 安全 / 隐私风险

- B171-1 会造成付费、订阅或 entitlement 事件无告警丢失；B171-2 可重复扣款、重复授予或重复副作用。
- 绑定设计本身降低跨 user billing 风险，但若实际 subscription 路径没有 remote ownership check，攻击者仍可能借伪造/错绑 customer 影响其他账户；不应把 helper 级覆盖当作端到端授权证明。

### 合并顺序风险

- 安全层应早于 L3/L5 的业务路径，但必须先消除 B171-1/B171-2 和通过 #135/#136 特殊测试。A1 的共享红检查仍是基线阻塞，不是本 PR 已证明引入的 regression。

---

<a id="pr-172-l4-s3-ownedasset-storage"></a>

## PR #172 — L4 S3 OwnedAsset storage

报告锚点：`#pr-172-l4-s3-ownedasset-storage`

### 摘要

PR #172 增加 S3 `OwnedAsset` adapter、immutable receipt、环境选择和 orphan-cleaner primitive，并令现有 runtime composition 能依据环境使用 S3。对象写入与读取完整性设计不错，但成功写 object 后数据库/结果持久化失败时没有生产级的可审计 cleanup 闭环，且 cleaner 存在引用检查—删除竞态，故 #142 不能以此关闭。

### 优点

- `s3-asset-storage.ts:157-176` 用 `IfNoneMatch: '*'` 做 immutable conditional put；`:484-530` 存 receipt metadata 和读回验证，并有跨 process in-memory 行为测试。
- `fileSystemAssetStorageFromEnv` 的兼容 export（约 `filesystem-asset-storage.ts:61-84`）会在 `s3` 配置下返回 S3 adapter，因此当前 `main.ts:278` 与 `job-worker.ts:180` 无需改动就可实际走 S3。此 PR 没有触碰 `main.ts`，不构成 freeze 违规；后续获授权的 owner 可再重命名该兼容 API。
- 生产/staging 的 filesystem mode 在 `filesystem-asset-storage.ts:60-74` fail closed，并有相应测试。

### 阻断问题

- **[B172-1] orphan cleanup 未接到真实写入失败链路。** `model-supply/index.ts:2629-2639` 先写 object，随后 `:2667-2673` 保存结果，`foundation/application-service.ts:932-960` 才注册 `OwnedAsset`。中间 DB/result sink 失败会留下对象；`s3-asset-storage.ts:187-255` 只是未被 production assembly 调用的 abstract cleaner primitive，既无 durable audit/outbox，也无 retry/告警闭环。需把 object-success/DB-failure 写入可审计 cleanup 记录并由 worker 执行，才符合 #142 的 ownership/cleanup contract。
- **[B172-2] cleaner 的 check-then-delete 会删除并发新引用的对象。** `clean()` 先 `references.isReferenced` 后删除，没有 DB lease/transaction 或 object version precondition；另一事务可在检查后、删除前写入引用。当前测试只使用静态 Memory double。应使用 reservation/lease、版本条件删除或删除前可串行化复核，并加并发竞态测试。

### 非阻断建议

- `s3AssetStorageFromEnv:698-727` 在无 endpoint 时使用 `region: 'auto'`，不适合标准 AWS S3；部署模式也允许任意 `http` endpoint。生产/staging 应要求 AWS region 且只接受 HTTPS（明确的本地开发例外除外）。
- `safeSegment` 的 contract 允许 `.` / `..`；filesystem path 另行拒绝，S3 key path 却未统一。即使 S3 无目录遍历语义，也应统一 reject 以免 future backend 或日志/cleanup path 出现歧义。
- 800 行 adapter 与 “fileSystem…可返回 S3” 的遗留命名增大理解成本；改名可留给获授权的 composition owner，避免在本波引入额外文件冲突。

### 测试缺口

- 需以真实 S3-compatible endpoint 或严格协议 fake 覆盖条件写入冲突（目前仅处理 412，409 未明确）、分页、网络 retry、receipt mismatch 和删除条件。
- 需有 object write 成功而 DB/result/OwnedAsset registration 失败时生成 cleanup audit、重试并最终可追溯的集成测试。
- 需有 API → S3 → job worker/restart 的 runtime 路径测试。决策 D 允许 close path 跳过 live S3 field evidence，但不免除这些自动化 contract tests，也不得写成 live 已通过。

### 安全 / 隐私风险

- B172-1 会遗留含商家内容/媒体的孤儿对象；B172-2 可能删除已被新业务引用的资产。
- 非 HTTPS endpoint 可能暴露 S3 credentials 或媒体内容；key validation 不一致会使 asset identity/audit 变得不可靠。

### 合并顺序风险

- 存储 owner 应在 L3 的 durable spine 与 L5 UI 消费之前稳定下来。无直接文本冲突，但不得由 #173 或后续 `main.ts` wiring 复制/绕过其 `OwnedAsset` owner；B172-1/B172-2 修复及特殊测试是合并/关闭 #142 的前置。

---

<a id="pr-173-l3-copy-submission-spine"></a>

## PR #173 — L3 Copy submission spine (#137 area)

报告锚点：`#pr-173-l3-copy-submission-spine`

### 摘要

PR #173 建立 `CreationExecutionSnapshot`、submission coordinator、required-source gate contract、HTTP route 和 Harness 传递，并诚实标明尚未完成 durable/main wiring。它没有改 `main.ts` 或直接写 `ContentPackage`，因此没有当前 freeze 违规；但 source schema/actual intent 脱节会造成拒绝不一致与授权绕过，不能作为生产 spine 或 #137/#138 完成实现。

### 优点

- `coordinator.ts:70-163,502-581` 对 snapshot、canonical hash 和 idempotency 输入做了清晰的不可变/验证建模。
- `required-source-gate.ts:132-168` 具备 workspace、rights、expiry、revocation 的 server-side resolver 形状；`server.ts:723-773` 的 route 有认证并返回 202。
- structured target platform 被传到 Harness；handoff 文档明确说明 durable store、`main.ts` wiring、ContentPackage projection 等尚未完成，未虚假宣称生产 ready。

### 阻断问题

- **[B173-1] 同一合法请求会因 `summary` 字段被不同层不一致地接受/拒绝。** `creationSourceObjectSchema`（`coordinator.ts:34-47`）接受 optional `summary`；coordinator 将整个对象交给 gate（`:315-321`）；真正的 `ServerRequiredSourceGate.validate`（`required-source-gate.ts:145-150`）strict-parse 的 `requiredSourceReferenceSchema` 没有该字段。结果是 API schema 可接受的请求落入 generic `INVALID_CREATION_SUBMISSION` 400，而非稳定的 source 422。应在交给 gate 前映射为 bare reference，或统一 schema/error contract，并添加带 `summary` 的 HTTP 测试。
- **[B173-2] gate 验证的 source 与 Harness 实际使用的 source 未绑定。** gate 验 `request.sourceObjects`，但 Harness 获得客户端独立提供的 `request.intent.assetReferences`（`coordinator.ts:530-555`）；生产 context 又用 `input.request.intent.assetReferences` 做 rights/asset context（`production-context-port.ts:138,200-214,278-345`）。调用者可送合规的 `sourceObjects` 通过 gate，再在 intent 塞另一组 asset refs。必须由服务端从已验证 refs 派生/绑定 Harness input，或对两组做 exact set correspondence 断言，并添加不匹配攻击用例。
- **[B173-3] `requiredSources` 在 constructor 仍是 optional，缺失时回退为 `fallbacks: []`（`coordinator.ts:283-289,315-322`）。** 目前 route 因未注入 production coordinator 返回 503，故不是已部署绕过；但后续 wiring 若遗漏该依赖就会 fail open。生产组合完成前必须使 gate 必传、配置错误 fail closed，并有 assembly test。

### 非阻断建议

- `coordinator.ts` 约 582 行，混合 schema、ports、adapter 和 memory store；可以后续拆分以减少 ownership 混淆。platform enum/映射也有重复来源。
- `startAndProject` 在非 starter claim 时返回同一 acceptance（`:343-377`），Memory store 将 `starting` 直接映射 `started`（`:466-480`）；首个 Harness start 之后失败时，并发 replay 的语义不清。定义 pending/wait/retry 状态并覆盖并发失败。

### 测试缺口

- 缺少 B173-1 的 HTTP 级 `summary` 测试、B173-2 的 gate/input mismatch 安全测试及 B173-3 的 production assembly fail-closed 测试。
- fallback 只被存入 trace/snapshot（coordinator 约 409、Harness input 约 548；`workflow-core.ts:412-421`），尚未应用到 compile context/prompt/delivery；#138 仍需效果级测试。
- 尚缺 durable store、Work/Task/ContentPackage shell 的原子 reservation、SSE completion/current package projection、cost replay、legacy call cutover 和 old-content-to-platform 完成路径的集成测试。

### 安全 / 隐私风险

- B173-2 是 source authorization boundary 绕过：经验证的来源可以被未验证 asset reference 替换，潜在跨 workspace/商家内容读取风险。
- B173-3 会使未来组合遗漏 source gate 时静默放行；须在真实 `main.ts` assembly 中 fail closed。

### 合并顺序风险

- 可作为 contract-only groundwork 合并的前提是 B173-1/B173-2 修复且 B173-3 对将来 assembly fail closed；不能据此关闭 #137/#138 或声称 end-to-end submission 已上线。
- `main.ts` 的暂时 freeze 已解除、后续 C 获授权，但应只有指定 spine/composition owner 接线。接线时须协调 #172 的 `OwnedAsset` owner 和 #141/C3 的 `ContentPackage` write owner，避免 legacy copy stream 与新 spine 双写。

---

<a id="pr-174-l5-merchant-result-mobile-truth"></a>

## PR #174 — L5 merchant Result / mobile truth

报告锚点：`#pr-174-l5-merchant-result-mobile-truth`

### 摘要

PR #174 提供 merchant-safe Result 状态映射、移动端导航/Progress 深链和若干 sheet→Dialog 改造，方向符合 #144/#145。可是 task center 的 canonical summary 把 copy work 排除，且没有可恢复的来源状态；在“有在途 Work”这个核心路径上不能保证精确 Result deep link 和原位返回，不能以 #145 完成合并。

### 优点

- Result 页面面向 merchant 显示 ProductStatus 与一个主操作，并避免直接显示 Work ID/错误 stack，降低内部实现和敏感错误细节外泄。
- mobile nav 包含 safe-area、Dialog focus return 和主题处理；测试覆盖基础 fixture 以及静态 wiring。
- 变更主要在 UI 消费层，不写 `ContentPackage`，也不干扰 S3/CI owner。

### 阻断问题

- **[B174-1] `canonicalAsyncTaskSummaries` 漏掉 copy work。** `async-task-center-model.ts:138-169` 只保留 image/video jobs；当 `copy.generate` 正在运行时，`tasks` 为空，`mobileProgressTarget` 回退到 task center 而不是该 Work 的 Result URL。现有 `mobile-progress-target.test.ts:9-46` 只造 image fixture。应纳入 Copy 与所有可呈现的 in-flight task type，并添加 running copy Work 的 component/route test。
- **[B174-2] Result URL 和返回逻辑没有保存/恢复来源。** `results_/$workId.tsx:60-105` 只接受 `contentId/versionId/panel/focusKey`，Progress link (`mobile-nav.tsx:85-88`) 没带它们，`onBack` 仅 `history.back`，否则 dashboard（route 约 `784-790`）。它无法保证来源的 filter/scroll/focus/面板恢复。应定义 typed return state，在深链和 Result route 全链传递并以浏览器测试验证。
- **[B174-3] 查询加载前存在错误导航窗口。** `ProductMobileNav` 默认 `tasks=[]`（`mobile-nav.tsx:43-60`），history/video query 尚未返回时渲染 task-center fallback（`:94-110`）；用户可在当前 Work 尚未加载时点击。应在 loading 时禁用/解析点击，或让 click handler 重新 resolve，配合延迟数据测试。

### 非阻断建议

- modal 改造只覆盖一个 product sheet；仍应检查 command palette（例如快捷键）是否能在 Dialog 上方再次打开，并建立全局 modal arbitration/inert policy。
- summary logic 在多个 UI 层重复，静态 source-regex test 对重构很脆弱；后续可收敛到可运行的 shared model test。

### 测试缺口

- 没有真实浏览器测试覆盖“running copy Work → mobile Progress → exact Result → 保留 filter/scroll/focus 返回”。现有路由 wiring 多为 source/fixture 断言。
- 需覆盖慢查询期间点击、深链接直接进入、Dialog 与 command palette/背景 inert、键盘焦点恢复及商家 error sanitization 的实际渲染。
- 当前 e2e job 跳过；即使 A1 修复，也须补开并通过本 PR 的特殊浏览器流程。

### 安全 / 隐私风险

- 现有 Result 映射降低暴露内部 Work/stack 的风险，但没有完整交互级覆盖，错误或 errorCode 变化仍可能在未测试状态下泄漏内部细节。
- 错指向 task center 或错误返回状态会使商家在共享设备/会话中看到不相关任务上下文；应保持 user/workspace-scoped lookup 与来源状态最小化。

### 合并顺序风险

- L5 依赖 L3 真正产出可查询、授权的 Work/Result truth，故应放在 spine/runtime 验证之后。没有文本冲突，但若 UI 自行派生另一份 task/result truth，会与后续 #173 projection 产生语义分叉；B174-1 至 B174-3 和浏览器测试应先完成。

---

## 跨 PR：ownership、冲突与冻结分析

| 范围 | 单一 owner / 当前状态 | 风险与要求 |
| --- | --- | --- |
| Root CI / secret / bundle gate | #170 | 只有 #170 应定义 root gate 语义。B170-1 未修前，任何下游都不能引用该输出作为 green evidence。 |
| Payment webhook / billing mutation | #171 | webhook pipeline、settlement 与 handler 的 effect ownership 必须统一；normalizer 与 legacy handler 并存时不能出现 2xx drop 或双执行。 |
| `OwnedAsset` / S3 object lifecycle | #172 | #172 是 storage owner。#173 的 future composition 与任何 job writer 必须调用该 owner，不得另建 object/delete 旁路；DB failure 必须留下同一可审计 cleanup 记录。 |
| `ContentPackage` 写入 | #141/C3（后续 spine owner），而非本波 UI/storage PR | #173 当前没有写入，这是正确的 freeze 状态。后续 main wiring 必须定义哪一个 durable workflow 创建 shell/current projection，legacy copy stream 不可与它并行双写。 |
| `main.ts` | 暂时 freeze 已解除；C 已授权后续 spine wiring | 本波无 PR 改 `main.ts`。获授权不等于多 owner：只让 nominated composition/spine owner 增加接线，并以 assembly test 证明 gate、store、storage 都齐全。 |
| merchant Result / mobile view | #174 | 只消费服务端权威的 Work/Result projection，不应从 legacy history、new spine 与 UI fixture 各自推导一套状态。 |

### 文本冲突与语义双写

- 当前五个 diff 没有显著的直接文件冲突；风险是语义而非 Git conflict。
- #172 的 object-first/DB-later 链路和 #173 未来 Work/ContentPackage persistence 是最危险的交界：没有 transaction/outbox/reservation 时，一个 workflow 可重复写 object、另一个又写 package/result，造成 orphan 或重复 assets。
- #171 的 normalizer + legacy provider handler 是另一个双路径边界：必须有明确 event ownership（normalized dispatch 或 verified fallback），不能同时执行，更不能 no-op ack。
- #174 必须以 #173 的最终权威投影为来源；在 L3 未完成 durable projection 前，用 history/video-only selector 做“truth”会漏掉 Copy work。

### Freeze 与 close 纪律

- #170 root CI owner、#172 storage owner、#141/C3 `ContentPackage` write owner 均应保持单一责任。此次没有发现 #172/#173/#174 直接违反这些边界。
- `main.ts` 之后可以由 C 接线，但这是后续工作授权，不能回填为 #173 已完成的 production claim。
- #172 的 close path 可不提交 live S3 field evidence（决策 D），但自动化 storage/cleanup tests 仍是必需；所有 issue 仅在 A1、对应特殊测试和明确 blocker 清零后关闭（决策 E）。

## A1 绿色后的推荐合并顺序

1. **先恢复 A1（不属于这五个 PR 的替代品）**：修复 main 的 `core` / `core-persistence` 基线，再确认 root、special test、required check 的实际状态。不要将 shared red 归咎于任一 PR，也不要在 shared red 下 close issue。
2. **#170（L1）**：先修 B170-1，补 pipefail 反例及 partial-build coverage，在真实 root workflow 证明失败不可被吞掉后合并。它建立后续 CI 证据的可信边界。
3. **#171（L2）**：修复 signed-event drop 与 exactly-once failure boundary，并完成 Stripe 实际路径测试后合并；支付安全应早于新的业务写路径。
4. **#172（L4）**：将 orphan cleanup 接入真实 object→DB failure 链路，消除引用删除竞态并完成 S3/cleanup integration tests 后合并。它提供唯一 storage lifecycle owner。
5. **#173（L3）**：先修 source schema/binding/fail-closed gate，再由单一 owner 设计 durable/main wiring 与 `ContentPackage` write reservation；若只合并 contracts，必须保留“不代表 E2E/issue close”的显著说明。完成真实 spine 后，才能宣称 #137/#138 acceptance。
6. **#174（L5）**：最后基于权威 Work/Result projection 修复 Copy-in-flight deep link、loading race、typed return restoration，并通过真实浏览器/mobile/a11y 流程后合并。

这个顺序允许 #172 与 contract-only #173 并行准备，但不允许它们在没有明确 lifecycle/write owner 的情况下互相接线或绕过；#174 应始终排在可验证的 L3 truth 之后。
