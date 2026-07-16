# P1 代码质量深审修复记录

> 历史基线：本记录中的 `pnpm check` PASS 仅属于 2026-07-12 固定提交；当前 HEAD 仍需以 Biome/TypeScript/secret scan 实测为准，不得作为今日全量绿灯。

**修复日期**：2026-07-12

**输入报告**：`docs/reviews/p1-code-quality-deep-review-2026-07-12.md`

**修复基线**：`bc8f937`

**当前口径**：`CONTEXT.md` → `docs/specs/beauty-content-agent-p1-spec.md` → P1 修订方案与审查报告

## 1. 结论

Cloud 报告有两类有效发现：一类是真实缺口，包括未校准视频候选的自动择优、评测集规模、真实模型激活证据、媒体 Port 合同覆盖和 recorded 技术证据标识；另一类是旧快照或语义误判，包括“生产 compose 仍为字符串桩”“P0/P1 视频仍双轨开放”“`isSameVideoWorkflow()` 不存在”以及“recorded Adapter 必须全部当作未完成”。

本次已完成所有不依赖外部商务密钥的代码修复。真实 provider、抖音和飞书 UAT 仍需对应密钥、Scope 或正式账号才能生成 live evidence；它们仅控制生产 activation，不阻塞 recorded/fake 功能完成，也未被伪造为已验证。

## 2. 逐项处置

| 发现 | 复核结论 | 处置 | 最终状态 |
|---|---|---|---|
| P0-1 真模型链路未接通 | OpenAI-compatible 真实 `ProviderExecutionPort` 已在当前基线存在；缺口是可执行的 live probe 和可审计激活证据 | 新增付费开关保护的 live LLM 集成测试；差异判定收紧到正文级；未验证 direct/recorded 部署在服务端保持 inactive；激活证据必须带非密引用、规范 UTC 时间和配置指纹；直连入口在实现原生协议前仅接受 OpenAI-compatible 目录模型 | 代码完成；live evidence 条件式待执行 |
| P0-2 composed-video 为伪 mp4 | 报告检查了保留的 recorded contract，漏掉生产装配已默认 `FfmpegVideoCompositionPort` | 保留 recorded port 作为快速合同测试；新增 `recorded_synthetic`/`measured` 技术证据标记和回归测试 | 完成；真 ffmpeg/ffprobe 集成测试通过 |
| P0-3 未校准候选无区分度 | 真实缺口；但用分辨率/码率充当美学评分违反“技术验证与人工校准质量分离”的现行合同 | 修复宽泛 task-prefix 伪校准，只允许精确资产指纹匹配；多候选无校准或同分时进入 `awaiting_quality_review`；提供指定候选、原 job 恢复与 Foundation 命令入口 | 完成；不伪造启发式美学分 |
| P1-1 fal/Replicate 未通过统一 Port | 真实缺口是合同测试；报告将 LLM gateway 和媒体生命周期混为同一物理网关 | fal/Replicate 现均通过同一 `submit/poll/download/cancel` 持久媒体生命周期合同；`RecordedGatewayPocPort` 收紧为 Bifrost/LiteLLM LLM 对照 | 完成 |
| P1-2 P0/P1 视频双轨 | 当前 main/worker 已使用 `legacyVideoPath: 'disabled'`；cutover 已区分 P1 新任务与旧 task-ref 非生成恢复 | 保留现有整窗切换和在途任务决策，不再新建转发层 | 报告过时；已有回归证据 |
| P1-3 离线评测仅 3 例 | 真实缺口 | 新增 `beauty-copy-eval-v2`：15 城市/场景种子 × 2 平台 = 30 条正向 probe，另有 10 条价格造假、保证/治愈/永久/最便宜、事实缺失、机器语气、正文重复、品牌与平台语境否定用例；历史 V1 持久记录读取时自动补齐新字段 | 完成；30/30 正向与 10/10 否定结果可持久化 |
| P1-4 真实 deployment 激活未验证 | 需真实密钥与付费调用，不能用本地 fixture 冒充 | 未提供证据时保持 `configured_unverified`；仅有 `live_verified` 部署进入服务端 runtime capability；RouteSnapshot 冻结真实 provider model、endpoint/credential/lifecycle revision，运行时目录的物理事实必须完全一致 | 代码完成；当前环境正确保持未激活 |
| 录制桩评测冒充真实质量 | 二次 Spec 复核发现的证据语义缺口 | 评测 Run 与每个 Case 冻结 `recorded_contract` / `live_provider` evidence kind、activation evidence 与部署修订；历史 V1 记录显式归为 `historical_unknown`/部署未知；Admin UI 分别展示“契约检查”“实测”和“历史未知” | 完成；recorded pass rate 不再被解读为 live quality |
| 人工 N→1 选择缺审计事实 | 二次 Spec 复核发现的业务事实缺口 | 持久化 selector、correlation ID、时间与 `human_quality_review` 来源，Foundation 直接传递当前审阅者语境 | 完成；PostgreSQL 重启恢复测试通过 |
| P2-1 文案候选类型重复 | 真实卫生问题 | 在 `@meiye/contracts` 增加共享基础内容类型，Product 仅扩展 `topics/assetOrder` | 完成 |
| P2-2 recorded 技术数据伪装实测 | 真实语义问题 | `OwnedAsset.technicalValidation.evidenceKind` 显式区分 `recorded_synthetic` 与 `measured` | 完成 |
| P2-3 评分器双分支缺合同测试 | 真实测试缺口 | 回归测试同时覆盖精确人工校准指纹和未知指纹进入人工复核 | 完成 |
| P2-4 PostgreSQL CI | 报告只指出需要 CI；本次全仓验证还实际捕获了并行 DDL 与写入的偶发 `40P01` 死锁 | 新增 PostgreSQL 16 + ffmpeg CI；新增 `test:postgres` 以确定性文件顺序运行共享 schema 迁移测试 | 完成；死锁复现后已被消除 |
| P2-5 `isSameVideoWorkflow()` 未定义 | 函数一直存在且类型检查、全量测试均会覆盖调用 | 无代码修改 | 报告误报 |

## 3. 关键实现约束

1. **不用技术指标伪造美学评分**：分辨率、可播放性、时长和哈希验证仍属于 technical validation；无人工校准证据时转为显式候选选择。
2. **不伪造 provider activation**：只有可回溯且绑定当前配置指纹的 live probe 证据才能写入 `live_verified`；单纯配置 Key 仍是 `configured_unverified`，E2E fixture 也只标记 `recorded`。
3. **不删除 recorded/fake 合同**：它们是 P1 规格指定的开发与状态机验收层，可经 admin quality probe 执行，但不进入用户可提交路由。
4. **不重建已有视频切换层**：新任务已经归 P1，旧在途任务保留原 `ProviderTaskRef` 做 inspect/callback/download/对账，禁止再生成。

## 4. 验证证据

| 验证 | 结果 |
|---|---|
| 候选人工选择公开 seam | 14/14 通过，包含 Foundation 命令、越界索引拒绝、原 job 恢复、无重复生成 |
| 真实 PostgreSQL Core 全量 | 378 tests：376 pass，0 fail，2 付费 live probe 显式 skip |
| 类型检查 | `pnpm typecheck` 通过 |
| 全库静态检查 | `pnpm check` 通过，Web Biome 422 files 无问题 |
| 生产构建 | `pnpm build` 通过，Core/Contracts/Web client+SSR 均完成 |
| diff 卫生 | `git diff --check` 通过 |

不带数据库的开发回归为 Core 358 tests（338 pass / 20 显式 skip）、Web 74/74、UIUX 脚本 9/9。

PostgreSQL 全量的标准命令为：

```bash
TEST_DATABASE_URL=postgres://... pnpm --filter @meiye/core test:postgres
```

`test:postgres` 串行的是共享迁移 schema 的测试文件，业务代码内的并发、租约、fencing 和丢失响应恢复测试仍然保留并发执行语义。

## 5. 待外部证据（非本地代码阻塞）

| 证据 | 当前状态 | 执行方式 |
|---|---|---|
| 真实 LLM 文案主链 | 当前 shell 无 provider Key，测试正确 skip | 配置 `MODEL_DIRECT_*`（包含非密的 credential/endpoint revision）与 `RUN_LIVE_MODEL_PROVIDER_TEST=1`；通过后保留 evidence ref/时间，并回填测试输出的 activation configuration revision |
| Ark/Seedance 真实视频 | 当前 shell 无 Ark Key，测试正确 skip | 使用已有 `RUN_LIVE_VIDEO_PROVIDER_TEST=1` live test |
| GPT Image 2 / Nano Banana 2 / Nano Banana Pro / Seedream 5.0 Pro | 各 Deployment 保持条件候选 | 按 operation 逐一完成认证、资产入库、成本和恢复证据后再激活 |
| Seedance 2.0 / Kling latest / Grok latest / Veo latest | 各 Deployment 保持条件候选 | 按直连或管理媒体通道逐一完成 live activation，不因单一候选未就绪阻塞 P1 功能 |
| 抖音 Publish/Observe、飞书 MCP UAT | 代码骨架、恢复和权限合同已有；正式账号证据未在当前环境提供 | 由具备官方账号/Scope 的 staging 环境补齐，仅控制对应 capability activation |

## 6. 修复后评估

- Cloud 报告的 P0-2、P1-2、P2-5 不再是当前缺口。
- P0-3、P1-1、P1-3、P2-1〜P2-4 的可本地修复项已完成并有回归证据。
- P0-1/P1-4 的运行时、激活合同和可执行 live test 已完成；真实凭据调用依照项目已锁定的“功能实现与真实采集并行”原则保持条件式未激活。
- recorded/fake Adapter 不再被当作 live 证据，但也不会因外部 Key 或商务开通延误开发。
