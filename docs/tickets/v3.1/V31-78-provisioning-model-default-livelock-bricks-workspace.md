# V31-78 — P0：model-default provisioning 失败一次即砖死整个 workspace（全请求 500 热循环，无终态无呈现）

**Parent**: 能力基线盘点第一轮（`docs/reviews/capability-baseline-audit-2026-08-13.md` §0.2）
**批次**: 清红队列（P0，优先于一切）
**Blocked by**: 无
**Related**: V31-79（触发因之一=平台默认模型未配置）、V31-50（同族：单点故障放大成整站不可用）、V31-41（失败终态与钱出口方法论）

**Status**: implementation-complete / release-verification-pending（2026-08-13）— grok lane 实现＋主控亲验（postgres 终态测试 1/1 含变异反证、Core 35/35、web 27/27、tsc/biome/locale 净、两砖号活库自愈实证），余 required CI 与注册故障注入 e2e

**Implementation state**: done（main@737d4603）
**Verification state**: locally verified（见 Evidence 补记）
**Evidence SHA**: 737d4603dfbbbad2295e73383c030f9e2e6395ac
Evidence 注：走查代码树；取证 workspace=ws_NpjyQ6QiDpD8LvE8h1LkZ4h5mZQoTz1Z（二号）、ws_M9XTBGerREfNygCMOfmEnQZ0ZZgVTifD（三号），保留在 54329 勿删
**Workflow Run**:
**Artifact Digest**:

## 缺陷链（全链取证在案）

1. 注册后 web 侧 `consumeWorkspaceProvisioning` 执行 `workspace-provision:model-default:v1`
   module command；Core `provisionModelDefaults`（workspace-provision.ts:190）在平台默认
   模型未配置时抛 `INVALID_STATE`。
2. 失败后 `p1_module_commands` 行**悬死 `pending`**（claim 后未终态化），5 分钟 lease 内
   一切后续尝试得 `The same module command is still in progress.`（application-service.ts:417）；
   lease 到期被重新 claim 又续 5 分钟，循环不出。
3. `ensureVerifiedWorkspaceProvisioned` 挂在**每一次** Core 转发前（core-client.ts:69）⇒
   该 workspace 的所有 P1 查询/命令恒 500（`unhandled:true`），含积分 pill、works 页、
   一切产品面。
4. outbox 热重试无退避：90 秒内 attempt_count 1→354（一次页面加载 +72）。
5. 商家侧零呈现：pill 显示「积分」空文案，页面静默残废。

## What to build（按层修，全要）

1. **终态化**：module command 执行失败必须落终态（abandoned/failed）而不是悬 pending；
   复核 abandonModuleCommand 的调用覆盖（操作抛错路径）。
2. **爆炸半径隔离**：model_default 步骤失败不得阻塞与模型无关的请求转发（provisioning
   门只挡真正依赖它的动作，或失败若干次后降级放行＋运营告警）。
3. **退避**：outbox retry 加指数退避与 attempt 上限，超限落 dead-letter＋告警（对齐 V31-41 方法论）。
4. **呈现**：provisioning 卡住时商家可见一条可理解状态（而非 500/空 pill）。
5. **自愈验证**：病因修复后（如补上平台默认模型）存量砖号必须在下一次尝试自愈——用二号/三号
   取证账号验证（先红后绿）。

## Acceptance criteria

- [x] 复现脚本/测试：模拟 model-default 失败 ⇒ 断言不出现全站 500、command 落终态、retry 有退避上限（core postgres 终态测试＋web 退避/降级门/dead_letter 单测；撤改动变异红/绿）
- [x] 二号/三号账号在修复树上自愈（三号 attempt 1→2、二号极端态 attempt 374→456，登录即 completed、「可用 100 分」正常；活库已按 0025 扩约束）
- [ ] 注册旅程 e2e 增加「provisioning 单步失败」故障注入用例（fail-closed 不等于整站死）
- [x] 平台默认模型缺失时的运营告警/日志可定位（dead-letter 结构化 warn 含 workspace/attempt；触发因供给归 V31-79 已落）

## 留痕

- 开票：2026-08-13 能力盘点第一轮。发现顺序：credits 全零 → DB 对账矛盾 → 假 Core 定性 →
  正确 Core 上注册即砖 → 机理逐层取证。**注意：本缺陷在 e2e 门全绿下不可见**（e2e 栈总带
  E2E_PLATFORM_DEFAULT_MODEL_* 四件套），是「验收面≠使用面」的又一实例。

## Evidence 补记（2026-08-13 主控收口，实现树 737d4603）

- 四层实现全落：Core `safeToRelease` 扩为一切 P1DomainError（Prewrite 类为其子类，语义收编）；
  web 转发门 `ensureVerifiedWorkspaceProvisionedForCoreForward` trial-completed 即降级放行；
  outbox 指数退避（1s→15min cap）＋20 次上限入 `dead_letter`（available_at 后仍可 claim=保留自愈）＋0025 迁移；
  shell 降级提示 banner（paraglide zh/en）。
- 自愈路径注：本次砖号复活由「病因修复（平台默认模型就位）＋下一次 claim」达成；新代码的贡献是
  终态化（不再永锁 pending）、降级转发（坏期不再全站 500）与退避（不再热循环），由测试+变异背书。
- 残项：注册旅程 provisioning 单步故障注入 e2e（AC 第 3 条）归 C1 收敛 lane；required CI 待补。
