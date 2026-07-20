哥，以下为对 [02-inngest.md](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/analysis/harness-research-2026-07-17/02-inngest.md:1) 的对抗性交叉验证结果。核验日期为 2026-07-17；未修改报告或源码。结果共 20 条：✅ 13 条、❌ 3 条、⚠️ 4 条、❓ 0 条。

## 判定汇总表

| # | 可证伪断言 | 判定 | 核心结果 |
|---:|---|:---:|---|
| 1 | 服务端最新版本是 v1.37.0，发布日期 2026-07-14 | ✅ | 本地 CHANGELOG 与 GitHub Latest Release 一致 |
| 2 | `inngest` TS SDK 最新版为 4.13.0 | ✅ | 本地 package.json 与 npm `/latest` 一致 |
| 3 | `@inngest/realtime` 最新版为 0.4.7，仍是 0.x | ✅ | 字面版本准确 |
| 4 | 因 `@inngest/realtime` 为 0.x，所以当前 Realtime API 尚未定稿，应继续使用该包 | ❌ | 该包已被正式标记 deprecated；当前入口是 `inngest/realtime`，属于主 SDK 4.x |
| 5 | 服务端/CLI 使用 SSPL v1.0，三周年后追加 Apache 2.0；SDK 为 Apache-2.0 | ✅ | 准确；“转 Apache”应理解为追加一份未来 Apache 授权，并非 SSPL 消失 |
| 6 | SSPL §13 要求向所有人免费提供完整 Service Source Code | ✅ | 条款内容与报告概述基本一致 |
| 7 | “一旦 fork 就由 §5 自动要求整体公开；不 fork 可规避 §13” | ❌ | §5 针对传递修改版；私有 fork 本身不触发公开。§13 同时覆盖原版与修改版 |
| 8 | “自用编排 + 不 fork + 不透出 Dashboard”即可确认 §13 不构成实质障碍 | ⚠️ | 低风险推断有依据，但不是许可证文本直接结论，也没有 Inngest 官方解释或法务意见 |
| 9 | self-host 二进制包含并接线 Connect | ✅ | 目录、启动参数、gateway 构造与执行 driver 均存在 |
| 10 | self-host 二进制包含并接线 Realtime | ✅ | Redis broadcaster、发布器、JWT 与 API 路由均接入 `start` 路径 |
| 11 | self-host 二进制包含 AI Gateway/`step.ai.infer` 代理 | ✅ | Opcode 实际进入 HTTP 代理执行，不只是解析/UI 代码 |
| 12 | Signals 位于 OSS 服务端，`waitForSignal` 标为 EXPERIMENTAL | ✅ | Opcode、等待/恢复实现和 SDK 警告均存在 |
| 13 | state≤32MB、step 输出≤4MB、≤1000 steps 都是硬上限 | ⚠️ | 数值是公开默认/产品限制；但源码中 32MB、1000 是可覆盖默认值，steps 的绝对实现上限为 10000 |
| 14 | `waitForEvent` 可挂数天，超时返回 `null` | ✅ | SDK 类型、注释、官方示例及服务端 pause 实现一致 |
| 15 | `waitForEvent` 源码没有硬上限，self-host 只受 state 保留策略限制 | ❌ | 服务端明确限制最长 366 天，367 天会报错；self-host 同样执行该代码 |
| 16 | sleep 上限为一年；self-host 可突破该上限 | ⚠️ | 一年正确，实际实现为 366 天；self-host 也不能突破 |
| 17 | Inngest 没有 Temporal `GetVersion` 式显式版本 API | ✅ | 官方明确采用 step ID memoization、无需显式版本标记 |
| 18 | Connect 是 worker 主动建立的 WebSocket，worker 无需提供公网入站地址 | ✅ | 官方文档与协议规范一致；但 gateway 必须由 worker 可达 |
| 19 | Postgres 后端自 CLI v1.4.0 起可用 | ✅ | 2025-01-20 发布；最初标为 experimental，当前自托管文档已正式支持 |
| 20 | “self-host 与云功能几乎零落差” | ⚠️ | 核心执行原语接近；若扩大到完整产品、隔离、安全、可观测性、可靠性与支持，则结论不成立 |

## 逐条展开

1. 服务端版本 — ✅

本地 [CHANGELOG.md](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/CHANGELOG.md:5) 首条为 `v1.37.0 - 2026-07-14`。GitHub Latest Release 同样是 [v1.37.0](https://github.com/inngest/inngest/releases/tag/v1.37.0)，发布时间为 `2026-07-14T21:06:57Z`。报告准确。

2. TS SDK 4.13.0 — ✅

本地 [package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest-js/packages/inngest/package.json:2) 为 `4.13.0`；[npm latest](https://registry.npmjs.org/inngest/latest) 返回相同版本及 Apache-2.0。

3. `@inngest/realtime` 0.4.7 — ✅

本地 [package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest-js/packages/realtime/package.json:2) 与 [npm latest](https://registry.npmjs.org/@inngest/realtime/latest) 都是 `0.4.7`。字面断言属实。

4. Realtime “仍未定稿”的推断 — ❌

同一 package.json 已明确写明 [deprecated](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest-js/packages/realtime/package.json:4)：Realtime 已并入 `inngest` 主包。主 SDK 已导出 [`./realtime`](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest-js/packages/inngest/package.json:245)。

因此报告第 309 行继续使用 `@inngest/realtime`，并用旧包 0.x 推导“当前 Realtime API 未定稿”，已经过时。正确评估对象应是 `inngest@4.13.0` 中的 `inngest/realtime`；旧包不一定立即失效，但不应作为新接线方案。

5. 许可证结构 — ✅

服务端 [LICENSE.md](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/LICENSE.md:1) 是 SSPL v1.0；[Future License](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/LICENSE.md:561) 在软件发布三周年时追加 Apache 2.0 授权。v1.37.0 因而约在 2029-07-14 获得额外 Apache 授权。

TS 主 SDK 的 [Apache 声明](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest-js/packages/inngest/LICENSE.md:1) 和 npm 元数据一致。需要修正的只是措辞：“追加/可改用 Apache”比“SSPL 自动消失并转成 Apache”准确。

6. SSPL §13 内容 — ✅

[§13 原文](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/LICENSE.md:480) 同时覆盖：

- 将原版或修改版功能作为服务提供给第三方；
- 允许第三方通过网络远程交互；
- 服务价值主要来自该程序；
- 服务为用户完成程序的主要目的。

触发后，Service Source Code 的范围确实包含管理软件、UI、API、自动化、监控、备份、存储和托管软件。报告对此概述准确。

7. fork 与触发条件 — ❌

报告把“修改”和“公开义务”绑定得过紧：

- [§2](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/LICENSE.md:91) 允许制作、运行不向外传递的 covered work，前提仍受 §13 约束。
- [§5](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/LICENSE.md:143) 标题就是“Conveying Modified Source Versions”，整体按 SSPL 授权的条件发生在传递修改版时。
- §13 明写“Program or a modified version”，所以即使完全不 fork，只要服务形态触发 §13，义务仍可能发生。

“不 fork”有助于减少维护、分发和衍生作品风险，但不是 §13 的豁免条件。

8. “自用边界内无实质障碍” — ⚠️

支持该推断的证据是：MongoDB 的 [SSPL FAQ](https://www.mongodb.com/legal/licensing/server-side-public-license/faq) 明确认为，普通 SaaS 应用仅把 MongoDB 当数据库时不触发 §13；真正针对的是向第三方提供 MongoDB 功能本身。美业产品出售的是内容创作结果，而非工作流平台，确有相似性。

但报告仍跳过了三个关键环节：

- 商家客户是第三方，不等同于 MongoDB FAQ 所说的员工或子公司“internal-only”。
- §13 判断核心是是否向第三方提供了程序功能或程序的主要目的，不是有没有展示 Dashboard。
- 没有发现 Inngest 自己针对“使用 Inngest 编排面向客户的 SaaS”给出的官方许可解释。

因此可把它写成“低风险工作假设，需法务确认”，不能写成“合规成本≈0”或已确认无障碍。尤其“不 fork”不是决定性边界。

9. Connect 在 self-host 中 — ✅

`start` 实际导入 Connect 配置，[构造 gateway](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/pkg/devserver/devserver.go:696)，并允许连接。官方 [self-host 文档](https://www.inngest.com/docs/self-hosting) 也明确单二进制启动后，Connect gateway 位于 8289。不是只存在一个未引用目录。

10. Realtime 在 self-host 中 — ✅

`start` 路径创建 [Redis broadcaster](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/pkg/devserver/devserver.go:312)，注入 [Realtime publisher](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/pkg/devserver/devserver.go:502)，并向 API 提供 JWT 与 broadcaster。服务端功能存在且已接线。

这与第 4 条不冲突：服务端 Realtime 属实；错误在于报告继续把已经废弃的独立 JS 包当作当前成熟度基准。

11. AI Gateway 在 self-host 中 — ✅

[OpcodeAIGateway](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/pkg/enums/opcode.go:14) 被 executor 分发到实际处理器；处理器将请求转为 HTTP 请求并调用 [`HTTPClient().DoRequest`](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/pkg/execution/executor/executor.go:4751)。报告给出的 `pkg/util/aigateway/` 路径真实，且不是只有 UI/trace 解析代码。

12. Signals 与 EXPERIMENTAL — ✅

服务端同时存在 WaitForSignal opcode 和真正的等待/恢复路径；SDK 在 [`waitForSignal`](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest-js/packages/inngest/src/components/InngestStepTools.ts:514) 上明确警告“可能在不升 major 的情况下变化”。报告准确。

13. 32MB / 4MB / 1000 的“硬上限” — ⚠️

官方 [Usage Limits](https://www.inngest.com/docs/usage-limits/inngest) 确实列出 32MiB、4MiB、1000，因此作为受支持产品契约，这三个值正确。

但源码区分了：

- [`DefaultMaxStepLimit = 1000`](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/pkg/consts/consts.go:19)
- [`AbsoluteMaxStepLimit = 10000`](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/pkg/consts/consts.go:22)
- `DefaultMaxStateSizeLimit = 32MiB`
- `MaxStepOutputSize = 4MiB`

self-host 内部还存在每函数 [step/state override](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/pkg/devserver/api.go:765)，但注释表明主要供测试使用，并非正式 CLI 配置。

正确表述应为：“公开支持且默认执行的限制为 32MiB/4MiB/1000；1000 并非执行器绝对硬上限，32MiB 也存在内部覆盖路径。”

14. `waitForEvent` 数天与 `null` — ✅

SDK 注释明确说明超时返回 `null`，[官方文档](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event) 也给出 3d、7d、30d 示例。服务端会持久化 pause 与 timeout queue item。项目要求的数小时到数天完全覆盖。

15. `waitForEvent` self-host 无限等待 — ❌

这是报告最明确的源码错误之一。服务端定义：

- [`MaxWaitForEventTimeout = 366 days`](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/pkg/consts/consts.go:88)
- 超出时由 [`Expires()`](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/pkg/execution/state/opcode.go:586) 返回 `ErrTimeoutTooLong`
- 测试明确接受 366d、拒绝 367d

定向运行相关 Go 测试已通过。由于 `inngest start` 走同一实现，self-host 也不是只受 Redis/PG 保留策略约束。

16. sleep 上限 — ⚠️

[官方 Sleep 文档](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/sleeps) 和源码都确认最大一年；实现取 366 天以覆盖闰日，并拒绝 367 天。

所以“sleep 上限一年”正确；“self-host 只受 state 保留策略、可更长”错误。保留策略只能让有效 sleep 提前失效，不能绕过服务端的一年输入校验。

17. 无显式版本 API — ✅

Inngest [Versioning 文档](https://www.inngest.com/docs/learn/versioning) 明确称不使用 explicit version markers，而以 step ID 和 memoization 决定新旧运行行为。

Temporal Go SDK 则确实提供 [`GetVersion`](https://github.com/temporalio/sdk-go/blob/master/workflow/workflow.go#L493-L563)，把选择写入 workflow history。报告对这一范式差异的描述成立；应用层 revision CAS 仍需项目自己实现。

18. Connect 出站 WebSocket — ✅

本地协议规范明确为 worker initiated：先请求 `/v0/connect/start`，再建立 WebSocket 并完成握手。官方 [Connect 文档](https://www.inngest.com/docs/setup/connect) 也称其为 outbound persistent connection，无需为 worker 配置负载均衡或入站公网地址。

必要限定是：self-host gateway 的 8289 端口必须能被 worker 访问；“worker 无需公网入站”不等于“完全没有网络可达性要求”。

19. Postgres v1.4.0+ — ✅

官方 [Postgres 发布说明](https://www.inngest.com/changelog/2025-01-20-postgres-self-hosting) 明确写明 2025-01-20 随 CLI v1.4.0 和 `--postgres-uri` 提供。最初状态为 experimental；当前 [self-host 文档](https://www.inngest.com/docs/self-hosting) 已将外部 Postgres 列为正式配置。报告的版本和日期正确，但若讨论历史成熟度，应保留“最初 experimental”这一限定。

20. “self-host 与云几乎零落差” — ⚠️

能成立的窄版本是：

> self-host 单二进制已包含报告关心的 Connect、Realtime、AI Gateway、Signals、wait/sleep 和 flow-control 核心执行路径。

不能成立的广义版本是“完整产品或生产能力几乎零落差”，因为：

- self-host 使用固定的 account/env 身份，[实质为单租户](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/pkg/devserver/service.go:676)。
- 源码明确提示 self-host Dashboard [不应对外暴露](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/pkg/run/cel_sql.go:19)。
- 官方不保证直接支持，且 Postgres 旧数据不会自动清理。
- 仓库规范本身存在 [`cloud:` 专用变更](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/inngest/docs/PULL_REQUEST_GUIDELINES.md:21)，说明“同一仓库有代码”不能推出云/self-host 全等。
- 官方 [Pricing FAQ](https://www.inngest.com/pricing) 的准确表述是：self-host 拥有 core engine，而云端额外提供托管基础设施、可观测性、可靠性，以及企业级 SAML/RBAC/audit 等。

## 总裁定

**总裁定：成立但需修正。**

报告对版本、许可证原文、核心源码路径、Connect、Realtime 服务端、AI Gateway、Signals、等待语义、显式版本 API 缺口和 Postgres 引入版本的事实核验总体扎实。但有四类实质问题，导致它还不能按原文直接作为技术选型定稿：

1. **明确事实错误**：self-host `waitForEvent` 不是无限期，硬限制为 366 天。
2. **限制术语错误**：32MB/1000 是默认及公开支持限制，不全是实现层绝对硬上限。
3. **Realtime 结论过时**：`@inngest/realtime@0.4.7` 已废弃，不能再用其 0.x 推导当前 Realtime 成熟度；示例应迁至 `inngest/realtime`。
4. **许可证推断过度确定**：不 fork 不是 §13 豁免条件；“内容 SaaS 只是把 Inngest 当内部引擎”是合理低风险类比，但不足以证明“合规成本≈0”。

两条重点结论建议改写为：

- **Self-host**：核心编排原语与云端接近，但完整生产产品在租户隔离、管理面安全、可观测性、数据保留、可靠性和官方支持上存在明显落差。
- **SSPL**：在不向客户提供工作流定义、管理 API、Dashboard 或编排平台能力，且产品价值主要来自内容营销功能的前提下，§13 触发风险看起来较低；但该结论仍须法务确认，“不 fork”只能算降低衍生/分发风险，不能作为法律豁免依据。