# T39 · R 门收口联调核销报告（issue #233）

日期：2026-07-27
分支：`leelv007-cmd/t39-r-gate-closeout`（worktree `/Users/bin/orca/workspaces/美业内容2/t39-r-gate-closeout`）
起始基线：`13562b5380dc9872eccd5937576e5b2edc9aa4a6`（T37 合入后的 main）
车道：fe1 — `TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye_fe1`
模型档：fixture（`MODEL_EXECUTION_MODE=fixture`，`runtime-profile.mjs:31,50` 硬编码 `APP_ENV=e2e`，
`runtime-config.ts:602` 结构性锁死）。live 面貌不在本票重跑，引用 T05 证据
`docs/evidence/provider-live-local-acceptance-2026-07-23.md`。

本票 = **验证与核销**，不建门、不改功能代码。发现的缺陷只记清单，回属主票修复。

---

## 0. 本轮改动面（票面 §E 允许清单内）

| 文件 | 性质 |
|---|---|
| `mkfast-template-main/tests/e2e/specs/t39-r-gate-journey-matrix.spec.ts` | 新增：全旅程矩阵 spec（**不进 PR required 集**） |
| `mkfast-template-main/tests/e2e/specs/p0-golden-journey.spec.ts` | OI-78 P2-2：`:72` 裸 goto 补断言 + 更正一句过度声明的注释 |
| `mkfast-template-main/tests/e2e/specs/uiux-day0-contract.spec.ts` | OI-78 P2-5：加 `M-04 DEMOTED` 头部标记 |
| `mkfast-template-main/src/lib/e2e-hard-gate-contract.test.ts` | OI-78 P2-5：登记表 `SPECS_WITH_DEMOTED_CASES` 入册（与上一行双向钉死） |
| `docs/evidence/t39-r-gate-closeout-2026-07-27.md` | 本报告 |

未动：`scripts/ci/run-pr-production-journey.sh`、`scripts/ci/quality-gates.test.mjs`、
promptfoo 配置与 eval cases、`docs/ops/production-dependency-audit-waivers.json`、
任何 `apps/` 或 `packages/` 源码。

---

## 1. 全旅程矩阵 spec

`tests/e2e/specs/t39-r-gate-journey-matrix.spec.ts`

四条腿 = 四类输出 × 主题 × 视口，主题/视口用 **spec 内循环**（样板
`p1-f2-acceptance.spec.ts:472/515/607`；仓内只有一个 chromium project @1440x900，
`workers:1, fullyParallel:false`，做成 project 会把跑全套的 job 墙钟时间乘以腿数）：

| 腿 | 输出 | 交付目标 | 主题 | 视口 |
|---|---|---|---|---|
| 1 | 文案 | wechat_moments | light | 1440x900 |
| 2 | 图文全包（ImageTextNote） | xiaohongshu | dark | 1440x900 |
| 3 | 视频 | douyin | light | 375x812 |
| 4 | 视频 | video_account | dark | 375x812 |

每腿走：**注册**（真 `/auth/register` 表单 → 真 `/api/auth/sign-up/email` → 轮询 `get-session`）
→ **Day-0 冷态**（三行业只读示例店，浏览/换行业/刷新零写入）
→ **首次出活**（Composer 提交 → 流式 → 成品预览卡 → Result Center）
→ **采用** → **三路交付** → **计费对账** → **发布确认** → **刷新恢复**。

复用 T37 落地的 `fixtures/ui-journey.ts` 帮手：`submitComposerJourney` / `waitForResultJourney` /
`adoptResult` / `openDeliveryPanel` / `downloadFullPackage` / `assertJourneyRestored` /
`assertThreeModalDiscovery`。

**D-133 遵守**：video 腿不触碰编辑/再生成面（`adjustResult` 的 video 分支带 D-133 skip，本 spec 根本不调用它），
只走 采用 → 交付 → 恢复。

**门覆盖申报（§4b④）**：本 spec **不进** PR required 集。required 浏览器位由 T37 的
`m04-browser-hard-gate.spec.ts` 承担（`run-pr-production-journey.sh:11` 的
`required_hard_gate_spec`）。本 spec 的运行者 = ① 车道亲跑（本报告 §1.1）② label 门
`e2e` job 的 RC 全量路径（`run-release-candidate-quality.sh` 跑整套 `pnpm --filter @meiye/web e2e`）。

### 1.1 车道实跑证据

跑法（`.scratch/orca-run-2026-07-25/reports/t39-run-e2e.sh`）：先 DROP `meiye_fe1` /
`meiye_fe1_dbos` 双库并 `provision-test-db.sh` 重建（RUNBOOK 10.17／10.23 —— provision 只
ENSURE 不清库，冷租户断言在残留态上不可信），再经 `e2e-lock.sh` 跨车道互斥锁调用一次
playwright，逐 spec 点名、`--reporter=list`、不带 `--`（RUNBOOK 10.22）。端口用默认
3000/4100/4200，跑前实测三口空闲（`lsof -nP -iTCP:<port> -sTCP:LISTEN` 无输出），
避免 `reuseExistingServer` 静默收编外来服务器（RUNBOOK 10.18）。

```text
$ .scratch/orca-run-2026-07-25/reports/t39-run-e2e.sh \
    tests/e2e/specs/t39-r-gate-journey-matrix.spec.ts

> playwright test tests/e2e/specs/t39-r-gate-journey-matrix.spec.ts --reporter=list

Running 4 tests using 1 worker

  ✓  1 [chromium] › t39-r-gate-journey-matrix.spec.ts:621:5 › T39 R-gate journey matrix ›
       文案 · 亮色 · 桌面: 注册 → Day-0 冷态 → 首次出活 → 采用 → 三路交付 → 计费对账 → 刷新恢复 (15.3s)
  ✓  2 [chromium] › t39-r-gate-journey-matrix.spec.ts:621:5 › T39 R-gate journey matrix ›
       图文全包 · 暗色 · 桌面: 注册 → Day-0 冷态 → 首次出活 → 采用 → 三路交付 → 计费对账 → 刷新恢复 (1.0m)
  ✓  3 [chromium] › t39-r-gate-journey-matrix.spec.ts:621:5 › T39 R-gate journey matrix ›
       视频 · 亮色 · 移动端: 注册 → Day-0 冷态 → 首次出活 → 采用 → 三路交付 → 计费对账 → 刷新恢复 (18.9s)
  ✓  4 [chromium] › t39-r-gate-journey-matrix.spec.ts:621:5 › T39 R-gate journey matrix ›
       视频 · 暗色 · 移动端: 注册 → Day-0 冷态 → 首次出活 → 采用 → 三路交付 → 计费对账 → 刷新恢复 (19.7s)

  4 passed (2.7m)
```

锁审计行（`/tmp/meiye-e2e.log`，绿轮）：

```text
2026-07-27T00:57:27+0800 acquire pid=66790 waited=0s cwd=/Users/bin/orca/workspaces/美业内容2/t39-r-gate-closeout cmd=pnpm --filter
2026-07-27T01:00:09+0800 release pid=66790 cwd=/Users/bin/orca/workspaces/美业内容2/t39-r-gate-closeout
```

**红轮时间线（五红，每一红都是一条真结论，不是调参）**——本票认为这段比绿轮本身更有信息量，
逐条留档：

| 轮 | 红在哪 | 实测 | 结论 |
|---|---|---|---|
| 1 | 文案腿 `settlementStatus` | 期望 `reconciled`，实得 `estimated` | 断言写错了：`reconciled` 需可信用量证据。→ G-9 |
| 2 | 图文腿 `settlementStatus` | 期望 `estimated`，实得 `reconciled` | 结算态**按模态分叉**，不是统一值。→ G-9 定稿 |
| 3 | 图文腿 `settledUnits` | 期望 `['image']`，实得 `['copy','image']` | 图文笔记一单**跨两桶**扣减（文字＋配图），「三桶各自扣减」的正确形态是「回执与额度投影逐桶一致」，不是「一模态一桶」。→ G-10 |
| 4 | 图文腿刷新恢复后的语言走查 | 三行泄漏，泄漏物是**本 spec 自己**塞进 intent 的 UUID | 反向断言是活的：作品名与发布记录行会原样回显商家自己的输入。改用 8 位短后缀，不放宽断言 |
| 5 | 视频腿 `billingMode` | 期望 `per_request`（W1 口径），实得 `per_output_second` | W1 的「按条」在**额度单位**上成立（实扣 1 条），但**价格公式**仍是按秒。→ G-11 |

第 6 轮 4/4 全绿，即上方输出。红 1/2/3/5 全部改的是断言口径以对齐产品真实合同，
红 4 改的是测试数据；**没有一处放宽了旅程本身**。

---

## 2. R-01 ~ R-08 逐项核销

### R-01 · ImageTextNote 全包 ＋ 全媒体完整回装

| 项 | 内容 |
|---|---|
| 证据命令 | `pnpm --filter @meiye/core exec tsx --test src/p1/harness/output-compiler.test.ts`（并入 §5 core 全量 0 fail） |
| 测试文件锚点 | `apps/core/src/p1/harness/output-compiler.test.ts:19`（四槽共享五段装配合同）、`:145/:178` video accept+reject、`:222/:255` image accept+reject、`:317/:347` copy accept+reject、`:412` image-text note accept |
| 浏览器锚点 | `tests/e2e/specs/image-text-note-compiler.spec.ts:374`（Composer 确认 → 双风格 → 选页 → 完整 revision 与 manifest）；本票矩阵第 2 腿走 `完整发布包（小红书）` 真下载并逐条校验 manifest/caption/checklist/每个声明文件的字节（`ui-journey.ts:661` `assertZipDownload`） |
| 结论 | 达标（accept 面），**带缺口**：见 G-1 |

### R-02 · promptfoo 七红线 ＋ 可见文案位 ＋ 对抗集

```text
$ pnpm eval:redlines
✔ promptfoo dataset gateIds exactly match the canonical production gateIds
✔ every canonical gate has a must-block case and an adversarial variant
✔ seven visible-copy adversarial cases are causal and ignore reported claims
✔ live red-team is blocking and runs more than one generated test
✔ promptfoo scorer rubric fixture stays aligned with the production N-to-1 rubric
✔ recorded redline cases are blocked by the canonical production validator
✔ redline eval turns red when the production gate is mutated to allow a breach
✔ promptfoo provider reports a provider error for an unstable gate result
✔ recorded redline evaluation matches the versioned EvalRun baseline
✔ Skill eval artifact pins a canonical Skill revision on every case
✔ Skill acceptance eval turns red when the exact-revision gate is mutated open
ℹ tests 11  pass 11  fail 0  skipped 0
EXIT=0
```

```text
$ pnpm eval:redlines:promptfoo
Results:
  ✓ 21 passed (100%)
  0 failed (0%)
  0 errors (0%)
Duration: 2s (concurrency: 1)
Writing output to output/evals/promptfoo-redlines.json
EXIT=0
```

- 可见文案位七个 case：`apps/core/src/evals/redlines/cases.ts:225/233/241/249/257/265/273`，
  经由 `:41-56` `visibleEmptyClaimsCase` 把 `input.candidate.visibleText` 灌进去；
  断言 `:34` 要求 `result.passed === true && result.gateId === expectedGateId`。
- 负控制在 CI：`core-quality.yml:51-60` 跑 `promptfooconfig.redlines.assertion-control.yaml`
  并在它**通过**时让 job 失败——本票未改配置，也未重跑负控制（属 CI job 面）。
- **口径修正**：票面预研写「基线 9/9」，实测 **11/11**。差额来自 `apps/core/package.json`
  的 `eval:redlines` 脚本在 T22 之后追加了 `src/evals/skills/skill-eval.test.ts`（+2）。
  不是回归，是基线长大；后续引用请以 11/11 为准。
- **封顶声明（T22 两条 deferred，原样转载）**：
  1. **P2-2** `apps/core/src/p1/harness/unified-media-stage-ports.ts` 以 `assetRefs: []`
     且无表达身份引用调用共享可见交付校验器 → 媒体收口这条输入**无法**触发
     `subject_asset_rights` / `expression_identity`。
  2. **P2-4** `apps/core/src/p1/operations/content-package-delivery.ts` 与
     `apps/core/src/p1/harness/production-context-port.ts` 把冻结事实来源投影成
     `status: 'current'` → `price_benefit_freshness` 单看这两个投影**看不到**过期/撤回来源。

  这两条都不是本票要修的，但它们**封顶了 R-02 绿门的证明力**：红线门在这两条输入路径上
  没有可观测面，绿不等于覆盖。

| 项 | 内容 |
|---|---|
| 结论 | 达标（11/11 + 21/21），**证明力受 T22 两条 deferred 封顶** |

### R-03 · dispatch 前重验 ＋ 撤权竞态 ＋ 跨 workspace 真存储

真 PG 腿，**证明真跑未静默 skip**：

```text
$ set -a; source lane.env; set +a
$ pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
    src/p1/model-supply/reference-asset-dispatch.postgres.test.ts \
    src/p1/model-supply/usage-ledger-invariants.postgres.test.ts \
    src/p1/model-supply/usage-ledger-invariants.static.test.ts
✔ Postgres dispatch rechecks revocation and rejects expired, cross-workspace, and sensitive routes (44.3ms)
✔ Postgres union rechecks generation input lineage before exporting a real p1_owned_assets row (32.5ms)
✔ Postgres routing keeps unclassified local imports domestic while a public product asset retains overseas candidates (27.1ms)
✔ one Coordinator usage owns eight structured jobs through a worker replay (325.7ms)
✔ ProductUsage SQL writes stay in the canonical billing repository
✔ ProductUsage reserve calls stay in the Coordinator billing chain
✔ GrantLot writes and consume calls stay in the guarded billing chains
✔ Harness media child jobs cannot consume ProductUsage or GrantLot twice
ℹ tests 9  pass 9  fail 0  skipped 0
```

负控制（证明 `skipped 0` 有意义，而不是这些用例本来就不带 skip 守卫）：

```text
$ env -u TEST_DATABASE_URL pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
    src/p1/model-supply/reference-asset-dispatch.postgres.test.ts \
    src/p1/model-supply/usage-ledger-invariants.postgres.test.ts
﹣ Postgres dispatch rechecks revocation and rejects expired, cross-workspace, and sensitive routes # TEST_DATABASE_URL is not configured
﹣ Postgres union rechecks generation input lineage before exporting a real p1_owned_assets row # TEST_DATABASE_URL is not configured
﹣ Postgres routing keeps unclassified local imports domestic while a public product asset retains overseas candidates # TEST_DATABASE_URL is not configured
﹣ one Coordinator usage owns eight structured jobs through a worker replay # TEST_DATABASE_URL is not configured
ℹ tests 4  pass 0  fail 0  skipped 4
```

| 项 | 内容 |
|---|---|
| 测试文件锚点 | `apps/core/src/p1/model-supply/reference-asset-dispatch.postgres.test.ts:30`（dispatch 重验＋撤权＋跨 workspace 一测三雕）、`:232`、`:440`；竞态形状另见 `postgres-hot-assembly.postgres.test.ts:318/338/406` |
| 门归属 | `core-persistence` job（`core-quality.yml:178-227`），真跑守卫 `scripts/ci/assert-core-persistence-ran.mjs` |
| 结论 | 达标，真 PG 实跑 skip=0 |

### R-04 · 生产 SCA required gate（承接 T03）

```text
$ pnpm audit --prod --json > output/security/pnpm-audit.json
$ node scripts/ci/assert-production-audit.mjs \
    output/security/pnpm-audit.json docs/ops/production-dependency-audit-waivers.json
Production dependency audit passed: critical=0 high=0 moderate=3 low=2 waived=0 unwaived=0
ASSERT_EXIT=0
```

豁免台账逐条审计：

```json
{
  "schemaVersion": 1,
  "waivers": []
}
```

- 台账**空**，所以不存在过期条目；spec `:157` 的「11 项 high 清零或逐项豁免留痕」在今日
  的实现形态是**清零**（`high=0`，`waived=0`），不是逐项豁免。
- 裁决来自 assert 脚本而非 pnpm 退出码（`core-quality.yml:136` 刻意吞掉 pnpm 的退出码）。
- required 集成员资格：`core-quality.yml:300`（needs）与 `:310`
  （`REQUIRED_PRODUCTION_DEPENDENCY_AUDIT_RESULT`），由 `scripts/ci/assert-required-jobs.mjs:7-10` 强制。

| 项 | 内容 |
|---|---|
| 结论 | 达标（结构性已完成，本票只做审计） |

### R-05 · 唯一正规写路径：旁路静扫 ＋ OCC / outbox / 幂等

- **旁路静扫（测试 9）** `apps/core/src/p1/operations/canonical-write-boundary.contract.test.ts`
  - `:50` ContentPackage SQL 写只在正规适配器 ＋ 固定 FREEZE 旁路
  - `:63` StoreFact SQL 与语义 append 单一受控路径
  - `:76` Harness Result 采用发正规命令，不从 `currentVersionId` 反推采用
  - **FREEZE 允许清单没有长大**：源码内 `FROZEN_CONTENT_PACKAGE_WRITE_BYPASSES` 被
    `assert.deepEqual(...)` 钉成恰好一项 `apps/core/src/pro-studio-runtime/postgres-adoption-service.ts`；
    清单一旦增删，该断言即红。
- **OCC / 幂等** `apps/core/src/p1/operations/content-package-occ.test.ts:54`（同 `expectedRevision`
  只放行一次变更并记恰好一条冲突审计）、`:131`（回执重放返回已提交结果且不再递增 revision＝幂等）、
  `:164`（仓储层 CAS 兜底返回 409 并持久化一条冲突审计）。
- 证据命令：并入 §5 core 全量（0 fail）。

| 项 | 内容 |
|---|---|
| 结论 | 达标，**带缺口**：见 G-2（outbox 面偏薄） |

### R-06 · 真 PG 账本不变量 ＋ 一次扣点

真 PG 实跑输出（与 R-03 同一次调用，见上）：

```text
✔ one Coordinator usage owns eight structured jobs through a worker replay (325.7ms)
ℹ 8-job ledger: canonicalUsage=1 reservedQuantity=1 canonicalCosts=8 jobs=8 observed=8
  tasks=1 executorCalls=8 legacyUsageEvents=0 supplyCosts=8 supplyFreezes=8
  supplierRequests=8 providerAttempts=8
✔ a blocked primary and its retry still own one ProductUsage (35.4ms)
ℹ blocked retry ledger: canonicalUsage=1 reservedQuantity=1 canonicalCosts=2 observed=2
  executorCalls=2 legacyUsageEvents=0 supplyFreezes=2
```

对照 T14 回执 `docs/evidence/t14-r06-usage-ledger-invariants-2026-07-25.md`：基线红态是
「8 个 job 额外产生 16 条旧 usage 事件」，本次复跑 `legacyUsageEvents=0`、`canonicalUsage=1`
——一次扣点成立，worker 重放不重记。

- 静态伴侣四条：`usage-ledger-invariants.static.test.ts:65/74/81/94`，全绿（见上）。
- **三桶「预估=回执」** 由本票矩阵在浏览器层实测（§1.1）：每腿读 `product-billing.get_usage`
  与 `get_quote_by_task`，断言 `settledUnits === reservedUnits`、`settledQuantity ===
  reservedQuantity`，并对 `entitlements.projection` 的四个桶做**逐桶**差分——每个桶的移动量
  必须恰好等于回执里该桶的单位数（回执没提到的桶差分为 0），且该桶 `available` 同步下降。
  `audio` 桶四条腿一律零移动。
  实测发现「一模态一桶」不成立（见 G-10）：图文一单同时扣 `copy` 与 `image`，所以断言取的是
  **回执与额度投影逐桶一致**这个更强也更真的形态。
- **结算状态按模态分叉（本票新发现，见 G-9）**：fixture 档下 `settlementStatus` **不是**统一值。
  文案腿实测 `estimated`，图文腿实测 `reconciled`。原因在
  `apps/core/src/p1/product-billing/quote-service.ts` 的 settle 分支：`reconciled` 只在拿到
  可信用量证据（`trustedUsageEvidenceKinds` = provider_usage／provider_bill／media_duration，
  或直接的 product_units）时置位，否则明写「keep estimated/unknown; do not invent
  billedSeconds」。媒体腿的 fixture 会带可信单位，文案腿不带。
  矩阵因此把断言定在**合同本身**：`settlementStatus ∈ {estimated, reconciled}`，
  `unknown` 出现即红（`unknown` 意味着证据到了却用不了，那时「回执=预估」只是巧合）。
  「预估=回执」在本票的可证形态是**单位级恒等**（`settledUnits === reservedUnits`），
  它对四条腿一律成立。
- **W1 视频按条**：video 腿断言额度实扣恰好 **1 条**（`spentByBucket.get('video') === 1`）。
  这是 W1 裁决落在商家余额上的形态，也是 per-second settle 分支一旦从秒重算单位时唯一会红的断言。
  `billingMode` 本身实测仍是 `per_output_second`（见 G-11），本 spec 记录而不钉死——
  钉 `per_request` 是断言一个产品今天没有的形态，钉 `per_output_second` 则是把 W1 想离开的东西冻起来。
  任何按秒**定价**的断言本 spec 一律不含。

| 项 | 内容 |
|---|---|
| 结论 | 达标（真 PG ＋ 浏览器双面） |

### R-07 · 认证顺序 ／ recent-auth+step-up ／ 邮件日志

| 项 | 内容 |
|---|---|
| 证据命令 | `pnpm --filter @meiye/web test` → tests 1268 / pass 1264 / fail 0 / skipped 4（见 §5） |
| 认证顺序 ＋ step-up | `mkfast-template-main/src/auth/recent-authentication.test.ts:15`（15 分钟窗口内接受、边界拒绝）、`:38`（刷新会话时间戳不算新认证）、`:52`（只守 API key 写／注销账号／关键管理写）、`:82`（高影响治理命令与发布动作）、`:160`（稳定 403 合同）、**`:170`（陈旧高风险请求走 Better Auth before hook＝顺序断言）**、`:226`、`:254` |
| 邮件日志「键名可记、值与 token 内容不可记」 | `mkfast-template-main/src/mail/provider/safe-log.test.ts:21`（两家 provider 只记缺失字段名不记字段值）、`:59`（发送失败日志脱敏字段值） |
| 门归属 | 这两组都在 **root-quality**（`pnpm test` / `pnpm --filter @meiye/web test:interaction`，`run-root-required-quality.sh:27-28`），**不在 core job** |
| 承接 | T16 回执 `docs/evidence/t16-r07-auth-email-hardening-2026-07-26.md` |
| 结论 | 达标 |

### R-08 · Pro Studio entitlement 三态一致性

| 项 | 内容 |
|---|---|
| 测试文件锚点 | `apps/core/src/pro-studio-runtime/entitlement.test.ts:49`（未购买 → 有用的引导而非死链）、**`:65`（冷投影拒入——门绝不把缺失读成 active）**、`:79`、`:95`、`:113`（浏览器给的支付 id 无可信账单证据不得解锁）、`:133`（购买重放幂等；换支付的重用 key 冲突）、`:156`（加购门不波及既有 Composer 动作） |
| 证据命令 | 并入 §5 core 全量（0 fail） |
| 浏览器面 | `tests/e2e/specs/pro-studio-entitlement.spec.ts`（本票未跑——票面只许跑本票 spec，RUNBOOK 10.22） |
| 交叉锚（**两个不同投影，分开记**） | required 集今日的 entitlement 断言是 **trial 投影**：`assembly-gate-required-journey.spec.ts:151-160`（`plan.tier==='trial'`，额度 copy 5 / image 5 / video 1）。本票矩阵每腿也在 Day-0 断言 `plan.tier==='trial'`。这与 Pro Studio 的 `unknown\|locked\|active` 三态是两套投影，不可互证 |
| 结论 | 达标（核侧三态；浏览器面沿用既有 spec，未重跑） |

---

## 3. 8/8 seed 复核

```text
$ pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
    src/p1/creation-experience/launch-seeds.test.ts
✔ defines eight Recipe variants mapping to six cold cards
✔ uses structured factTypes instead of text upload slots
✔ locks presentation copy to D-083 wording
✔ locks delivery defaults to D-082 first-ship table
✔ models 旧内容换平台 as familyId three variants with cold no default lens
✔ ships only capability-verified Pro Studio in the launch Surface
✔ publishes eight recipes + launch surface via CatalogService
✔ marks seeds as first published revision defaults (adjustable via new revision)
ℹ tests 8  pass 8  fail 0  skipped 0
```

单一实现 `apps/core/src/p1/creation-experience/recipe-validator.ts:21`
`validateRecipeForComposer(...)`，三个调用点：

| # | 场景 | 锚点 |
|---|---|---|
| 1 | 提交 | `apps/core/src/p1/execution-spine/composer-submission-gate.ts:161` |
| 2 | 发布/目录 | `apps/core/src/p1/creation-experience/catalog-service.ts:665`（`validateRecipeRecord`，自 `validateRecipe:342` 到达） |
| 3 | seed | `apps/core/src/p1/creation-experience/launch-seeds.test.ts:229` → `service.validateRecipe(...)` 遍历全部 seed |

8/8 = `launch-seeds.test.ts:24`（八个 Recipe 变体映射六张冷卡）＋ `:223`（经 CatalogService 发布八条 recipe ＋ launch surface）。结论：**8/8 全过**。

---

## 4. 商家语言走查（D-116 / D-123）

**机器门**：`pnpm check` 七门全 PASS（§5），其中 D-123 成本边界扫描 2269 个文件、findings 0。

**浏览器反向断言**（本票矩阵内置，每腿多点取样）：Day-0 冷态工作台 / Result（生成后）/
交付面板 / 刷新恢复后的 Result，逐行比对以下模式，命中即红——

- UUID（`p1-f2-acceptance.spec.ts:472` 同源）
- 裸生命周期枚举：`running|ready|delivered|candidate_ready|needs_input|automatic_verified|assisted|unavailable|internal_only|public_marketing|reserved|committed|reconciled`
- provider / 模型 slug 与内部 id：`provider`、`workId=`、`workspaceId=`、`taskId=`、`packageId=`、`assetId=`、`catalogModelId`、`store_fact:`、`seedance-2`、`seedream-5-pro`、`deepseek-v4-pro`
- 成本用语：`成本价`、`毛利`、`供应商单价`

相对 `p1-f2-acceptance.spec.ts:472` 的样板，本票新增了 `taskId=`／`packageId=`／`store_fact:`／
三个模型 slug／三个成本词，以及 `reserved|committed|reconciled` 三个计费态——因为本票是第一条
把计费查询拉进浏览器旅程的 spec，这三个词恰恰是最容易顺着新面漏出来的。

走查记录：见 §1.1 逐条腿的实跑结果；矩阵每腿的语言断言与旅程断言同生共死，任一条泄漏该腿即红。

**断言是活的（实证）**：§1.1 红轮 4 里，图文腿刷新恢复后的走查真的红了，泄漏物是**本 spec 自己**
写进 intent 的 UUID —— 作品名与发布记录行会原样回显商家输入。修法是把测试数据换成 8 位短后缀，
**没有放宽断言**。这条红同时说明：商家自己输入什么，产品就原样显示什么，这个面不会替他脱敏。

TEST-CATALOG `:493` 口径（Result 面在调整/采用/交付/刷新恢复前后都不得出现 Work/Asset ID、
裸执行态、provider 文案、模型 slug）由 `ui-journey.ts:329-336` 在 `waitForResultJourney` 内
逐腿执行，本票矩阵四腿全部经过。

**走查中的一条观察（未纳入断言，交语言属主判定，见 G-12）**：图文腿刷新恢复后的发布记录行
渲染为 `… · xiaohongshu · 07/26 · 人工补记 · r4 · CTA …` —— 平台键以裸英文 `xiaohongshu`
出现（而非「小红书」），版本以 `r4` 出现。两者都不在现有反向断言的模式表里，本票也未加断言
（加了会红一条本票无权修的产品面）。

---

## 5. 全量门复跑

| 命令 | 结果 |
|---|---|
| `pnpm --filter @meiye/web test` | tests **1268** / pass **1264** / fail **0** / skipped **4** — EXIT=0 |
| `pnpm --filter @meiye/core test`（带 lane.env） | tests **2234** / pass **2224** / fail **0** / skipped **10** — EXIT=0（与申报基线 skip=10 一致） |
| `pnpm typecheck` | EXIT=0 |
| `pnpm check` | 七门 Overall: **PASS**（workspace checks / secret scan / D-123 cost boundary / decision ticket guard / HeroUI mirror guard / works canonical projection guard / retired old-IA route mount guard） |
| `pnpm eval:redlines` | 11/11 — EXIT=0 |
| `pnpm eval:redlines:promptfoo` | 21/21 — EXIT=0 |
| `pnpm audit --prod` ＋ `assert-production-audit.mjs` | critical=0 high=0 moderate=3 low=2 waived=0 unwaived=0 — EXIT=0 |

新增测试的门覆盖申报（§4b④）：

| 新增/改动 | 跑它的门 | 核实 |
|---|---|---|
| `tests/e2e/specs/t39-r-gate-journey-matrix.spec.ts` | **不在** PR required；RC label 门 `e2e` 全量路径 ＋ 车道亲跑 | §1.1 |
| `src/lib/e2e-hard-gate-contract.test.ts`（登记表 +1） | root-quality → `pnpm --filter @meiye/web test`（glob 排除 `*.interaction.test.*`，本文件不带该后缀，被收集） | 单文件实跑 5/5 见下 |
| `tests/e2e/specs/uiux-day0-contract.spec.ts`（DEMOTED 标记） | 同上（被登记表读取校验），spec 本身不在任何 required 门 | 同上 |
| `tests/e2e/specs/p0-golden-journey.spec.ts`（一处断言） | 无 required 门（长期红，见 G-3） | — |

```text
$ npx tsx --test src/lib/e2e-hard-gate-contract.test.ts
✔ the M-04 mainline journey is in the required PR spec set
✔ no browser test or fixture listens for the retired creative-work commands
✔ every demoted old UI spec is marked in place and stays out of the required set
✔ no browser test writes into the tracked evidence tree
✔ the demotion register is the only place a spec claims to be demoted
ℹ tests 5  pass 5  fail 0
```

注：TypeScript 类型不由 `tsx --test` 检查（类型擦除），新 spec 的类型由
`pnpm typecheck` 覆盖——`mkfast-template-main/tsconfig.json:2` 的 `include` 是
`["**/*.ts","**/*.tsx"]`，含 `tests/e2e/specs/`。

---

## 6. OI-78 三项吸收

### P2-1 · video-player 可见性观察点 → **不迁移，记缺口（G-4）**

先查历史再决定，结论是**没绿过**：

- 全仓 `video-player` 的浏览器断言只有一处：`uiux-day0-contract.spec.ts:132`（在
  `assertVideoFirstUsableResult` 内）。
- 该断言所在的 video 腿在 fixture 档是**红**的：`docs/evidence/e2e-baseline-2026-07-25.md:64-66`
  ——「video path（`:332`）— `composer-delivery-card` never arrives inside the test's own 180s
  budget」。`composer-delivery-card` 在 `video-player` 之前，所以这条断言从未被执行到。
- spec 自己的注释也承认（`:378-380`）：「Video may still be red on the current surface … keep the
  hard wait (no fake-green)」。

据票面裁决「绿过才迁，没绿过记缺口」，**不迁**。矩阵 video 腿的可见性由
`ui-journey.ts` 的 `video-worksurface` ＋ `video-result-status` ＋ 真 ZIP 里 `video.mp4`
的真实字节承担（`assertZipDownload:737-756`）。

### P2-2 · p0-golden 协办交接链后半跳 → **就地补断言，但今日不可验证（G-3）**

先 grep 交付面板的分享数据流，确定真实字段链：

```
delivery-panel-model.ts:40  sharePayload: SharePayload
delivery-share-degrade.ts:17  SharePayload.oneShotLinkUrl
routes/dashboard/results_/$workId.tsx:716-718
    existingOneShotUrl = assistedStored?.receipt.handoffLink?.token
      ? `/dashboard/handoff/${encodeURIComponent(token)}` : undefined
    ← assistedStored ← assistedReceiptsQuery (p1 `result-delivery` / `assisted_list`)
```

**真实结论与预研假设不同**：交付面板的分享载荷**结构上不可能**与 p0-golden 的 handoff token 同源。

- 面板的一次性链接来自 **canonical AssistedReceipt**（`result-delivery` 模块）。
- `p0-golden-journey.spec.ts:37-46` 造的是 **legacy 产品库 HandoffPackage**
  （`apps/core/src/product/product-service.ts:2996`，写入 `route: 'L3_HANDOFF_PACKAGE'`）。
- `/dashboard/handoff/$token` 只解析 canonical（`$token.tsx:32` → `loadCanonicalHandoff` →
  `assisted_consume_handoff`），而 `delivery-handoff-canonical.ts:249-260`
  `assertNotLegacyHandoffSource` **明文拒绝** `L3_HANDOFF_PACKAGE`。

因此本票在 `:72` 做的是能做的那一半：把「token 来自命令回执的局部变量」换成
「从服务端持久化状态按 packageId 反查再走」，并在注释里把两套 store 的分叉写死、
指向本缺口；同时更正了 T37 留下的那句过度声明（原注释称面板的分享载荷携带该路径）。
两套 store 的绑定是**产品改动**，不是测试改动。

### P2-3（票面 P2-5）· uiux-day0-contract 处置 → **DEMOTED 标记 ＋ 登记表入册**

双向钉死，两边都动：

- `tests/e2e/specs/uiux-day0-contract.spec.ts` 头部加 `M-04 DEMOTED` 段，写清 4/7 红的逐条来源
  （引 `docs/evidence/e2e-baseline-2026-07-25.md`）与「值得留的断言已迁进
  `m04-browser-hard-gate.spec.ts`」。
- `src/lib/e2e-hard-gate-contract.test.ts:69` `SPECS_WITH_DEMOTED_CASES` 新增
  `'specs/uiux-day0-contract.spec.ts'`。

该文件的两条测试互为反向锁：`:133` 要求登记表里每个 spec 都带标记且不在 required 集；
`:167` 要求带标记的 spec 必须在登记表里。单边改动必红。实跑 5/5 见 §5。

---

## 7. 缺口清单（**只记不修**，回属主票）

| # | 缺口 | 证据锚点 | 影响 | 建议属主 |
|---|---|---|---|---|
| **G-1** | `image_text_note` 只有 accept 测试，缺「逐缺件拒收」 | `apps/core/src/p1/harness/output-compiler.test.ts:412` 为 accept；copy/image/video 均为 accept+reject 成对（`:317/:347`、`:222/:255`、`:145/:178`） | R-01 的「全媒体完整回装」在图文这一档只证明了「完整能装」，没证明「缺件会拒」 | 编译器票（T20 属主） |
| **G-2** | outbox 验收面只有 1 条测试 | `apps/core/src/p1/harness/outbox-worker.test.ts:9` 全文件唯一一条 | R-05 的验收面点名 outbox，1 条测试撑不住「补偿队列」这个语义（无重投、无顺序、无毒消息路径） | R-05 属主票 |
| **G-3** | `p0-golden-journey.spec.ts` 长期红，且后半段绑在已退役页面 | 红根因＝OI-58（`seedAcceptedProductContent` → `generate_copy` 对新租户抛 `LEGACY_CONTENT_READ_ONLY`，`fixtures/product.ts:298`）；**本票新发现**：即使种子修好，`:72` 之后的 `小红书发布包` 标题、`复制`、`暂未发布/已发布` 全部属于已退役的 legacy handoff 页，canonical 页（`canonical-handoff-page.tsx`）不渲染它们 | T37 为它补的「内容详情 →协办交接→ 交付面板」点击链（`:53-70`）**从未被执行过**；这条旅程今天零证明力 | e2e 基建 / OI-58 属主 |
| **G-4** | `video-player` 可见性全仓无人守 | 唯一断言 `uiux-day0-contract.spec.ts:132` 位于从未跑到的红腿之后（`e2e-baseline-2026-07-25.md:64-66`） | 「成片能播」这件事没有任何真跑断言；ZIP 里的 `video.mp4` 字节只证明文件在，不证明播放器挂载 | 视频结果面属主票 |
| **G-5** | 协办交接（assisted handoff）整条链零浏览器覆盖 | `delivery-action-assisted` 需 `hasExternalSendApproval`（`delivery-capability-groups.ts:161-190`），而 `activeDeliveryApproval` 来自 `contentPackage.approvalReceipts`（`$workId.tsx:704`）；全仓 e2e 无任何 spec 制造过 ApprovalReceipt | 三路交付里的「协办」只被断言到「按钮存在且诚实置灰」，真交接（一次性链接生成→消费→回报）无端到端证明；G-3 的缺口也堵在这里 | 交付面属主票 |
| **G-6** | T22 两条 deferred 封顶 R-01/R-02 绿门 | `docs/evidence/t22-deferred-policy-findings-2026-07-26.md:16-20`（`assetRefs: []`）与 `:22-26`（冻结事实源恒 `status:'current'`） | 媒体收口路径触不到 `subject_asset_rights`/`expression_identity`；`price_benefit_freshness` 看不到过期源。**红线门绿 ≠ 这两个面被覆盖** | T22 指定的后续属主 |
| **G-7** | `eval:redlines` 基线口径漂移未同步 | `apps/core/package.json` 的 `eval:redlines` 在 T22 之后追加 `src/evals/skills/skill-eval.test.ts`，实测 11/11；T22 回执与本轮票面预研仍写 9/9 | 引用旧口径的票会把 11/11 误判成异常 | 文档口径（本报告已更正） |
| **G-8** | 焦点复跑会被同树 playwright 的 `locale:compile:e2e` 打死 | `canonical-write-boundary.contract.test.ts:65` 读 `mkfast-template-main/src/locale/paraglide/messages.d.ts`；浏览器栈启动时该目录在重写，实测 `ENOENT` 假红。同一组文件在浏览器栈停机后复跑 **23/23 全绿** | 与 RUNBOOK 10.19 同族但触发面不同（10.19 讲的是两个 pnpm 脚本互踩，这里是 **core 单测踩 playwright webServer**）；判红顺序应先查同树是否有 playwright 在跑 | RUNBOOK 观察项 |
| **G-9** | `settlementStatus` 按模态分叉，仓内无任何测试守住这条分叉 | `apps/core/src/p1/product-billing/quote-service.ts` settle 分支：`reconciled` 需 `trustedUnits` 或 `trustedSeconds`；否则 `estimated`/`unknown`。本票实测 fixture 档下 **文案=`estimated`、图文=`reconciled`**（§1.1 红轮 1／2）。`quote-service.test.ts:134/222/360` 都是自己喂 trustedUsage 才断言 `reconciled`，没有一条测试记录「哪种模态在真链路上应当落哪个态」 | R-06 的「预估=回执」终态在浏览器层只能证到单位级恒等；`reconciled` 与 `estimated` 的模态归属是**无人守的隐性合同**，改动 fixture 或供给侧证据面不会有任何门变红 | R-06 属主票 ／ 计费三桶票（T26） |
| **G-10** | 图文一单跨 `copy`＋`image` 两桶扣减，此口径仓内无测试 | 本票实测（§1.1 红轮 3）：图文腿 `settledUnits = [{copy,1},{image,N}]`。全仓 grep 无任何测试断言「图文笔记应当扣哪些桶」 | 「三桶各自扣减」的产品真实形态是**一单可跨桶**；任何按「一模态一桶」写的下游逻辑或报表都会算错。矩阵已按「回执与额度投影逐桶一致」守住总量，但**哪些桶该动**仍无人守 | 计费三桶票（T26） |
| **G-11** | 视频 `billingMode` 仍为 `per_output_second`，与 W1「权威单位=条」口径分叉 | 本票实测（§1.1 红轮 5）：视频腿 quote 的 `billingMode='per_output_second'`，同一腿额度实扣 **1 条**。`quote-service.ts` 的 per-second settle 分支会用 `min(reservedQuantity, ceil(billableSeconds))` **从秒重算视频单位**——一旦 live 档送来可信秒数，同一条成片就可能扣出 >1 条 | 「按条」今天只在**没有可信秒数**时成立（fixture 档），live 档的按条口径**无证据**。这是 W1 裁决与实现之间的真实缺口，不是测试口径问题 | 计费三桶票（T26）／ R-06 属主票 |
| **G-12** | 发布记录行出现裸平台键与版本简写 | 图文腿刷新恢复后实测可见文本：`… · xiaohongshu · 07/26 · 人工补记 · r4 · CTA …` | 平台以英文键而非「小红书」示人、版本以 `r4` 示人，是否越过 D-116 拟人化交付语言的线需要语言属主判定。本票**未加断言**（加了会红一条本票无权修的产品面），只留观察 | 商家语言／内容运营面属主票 |

---

## 8. 边界声明

- 零产品功能代码改动。`apps/`、`packages/` 全无改动。
- 未动 required 双钉文件（`scripts/ci/run-pr-production-journey.sh`、
  `scripts/ci/quality-gates.test.mjs`）。
- 未动 promptfoo 配置、eval cases、SCA waiver 文件。
- 本报告与新增代码内零成本基线数字（D-123；`pnpm check` 的 D-123 门实扫 2269 文件 findings 0）。
- 浏览器一律经 `.scratch/orca-run-2026-07-25/e2e-lock.sh`，只跑本票 spec（RUNBOOK 10.22）。
