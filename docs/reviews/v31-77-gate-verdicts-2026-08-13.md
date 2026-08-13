# V3.1 浏览器门判决书留档 — 2026-08-13（V31-77 落地同轮）

门跑产物写在 `output/` 下，而 `output/` 被 `.gitignore:29` 排除，随时会被下一轮 playwright
清掉。本文把**判决书原文**搬进仓，让它跟着 SHA 走。分析与修法在票面
`docs/tickets/v3.1/V31-77-day0-journey-release-gate.md`，本文只放证据。

- 代码 SHA：`d97c9b09fb0a9210f6d82acb8590d00c276cb9a7`（门升格＋静态契约＋四条 spec 修复＋store.tsx 产品修复）
- 门脚本：`scripts/ci/run-v31-browser-acceptance.sh`
- 本地未 push（用户冻结）

---

## 一、门的第一次真跑（未升格版本，`RELEASE_COMMIT_SHA=167adafd…`）

跑法（**注意**：`playwright.config.ts` 的 `TEST_DATABASE_URL` 默认值指向 54329 活体
`meiye` 库，必须显式覆盖到 provision 出来的独立库，端口也要错开）：

```
TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54330/meiye_v3177_gate
TEST_DBOS_SYSTEM_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54330/meiye_v3177_gate_dbos
PORT=3020 PLAYWRIGHT_CORE_PORT=4120
CI_EVIDENCE_DIR=output/ci/v31-gate-0813-2015
./scripts/ci/run-v31-browser-acceptance.sh
```

结果：**42 tests → 8 passed / 5 failed / 1 interrupted / 28 did not run（7.4m，exit 130）**

### 1.1 实际执行顺序（按文件路径序，不是命令行顺序）

这是「首位必须独立先跑」的实证：目录里第一条写的是 `v31-day0-free-creation-journey`，
实际第一个跑的是 `v31-82`。

```
✘   1 v31-82-stalled-image-work-timeout.spec.ts:29:3        (42.7s)
✓   2 v31-83-composer-session-cross-account.spec.ts:25:1    (11.0s)
✓   3 v31-83-composer-session-cross-account.spec.ts:36:1     (9.0s)
✘   4 v31-84-store-onboarding-capture-confirm.spec.ts:76:3   (1.1m)
✓   5 v31-85-video-fallback-recipe-dead-end.spec.ts:23:3     (8.1s)
✘   6 v31-86-store-onboarding-archive-card.spec.ts:58:3     (12.1s)
✘   7 v31-87-same-content-reupload.spec.ts:33:3             (37.0s)
✘   8 v31-88-asset-library-composer-source-attach.spec.ts:40:3 (36.6s)
✓   9 v31-89-spoken-sentence-llm-extract.spec.ts:58:3        (7.4s)
✓  10 v31-artifact-growth-journey.spec.ts:405:3  AC1        (23.8s)
✓  11 v31-artifact-growth-journey.spec.ts:516:3  AC2        (25.8s)
✓  12 v31-artifact-growth-journey.spec.ts:634:3  AC3        (24.0s)
✓  13 v31-artifact-growth-journey.spec.ts:746:3  AC4        (31.8s)
✘  14 v31-context-fence-journey.spec.ts:201:3    (interrupted, 53.3s)
```

### 1.2 仪器判决书（V31-64 形制）

```
GATE INSTRUMENT FAILURE: web (pid 83347) emitted Vite workerd disconnect signature
"Internal server error: terminated" — remaining specs NOT evaluated;
instrument evidence: output/ci/v31-gate-0813-2015/instrument-failures/web-83347-1786623386998-vite-workerd-disconnected.json
```

仪器记录（去掉 tail 的启动噪音）：

```json
{
  "detectedAt": "2026-08-13T12:23:13.332Z",
  "incarnationId": "web:83347:1786623386998",
  "kind": "vite-workerd-disconnected",
  "message": "Internal server error: terminated",
  "pid": 83347,
  "resolution": "fatal",
  "resolutionReason": "embedded-workerd",
  "resolvedAt": "2026-08-13T12:23:14.084Z",
  "service": "web",
  "shutdownRequested": false,
  "startedAt": "2026-08-13T12:16:26.998Z",
  "stream": "stderr"
}
```

### 1.3 三服务存活（判「级联假红」还是「真红」的关键）

| service | pid | started | exited | uptime | signal / exit | shutdownRequested |
| --- | --- | --- | --- | --- | --- | --- |
| core | 83008 | 12:16:02 | 12:23:23 | 441s | SIGKILL | true |
| p1-worker | 83194 | 12:16:07 | 12:23:15 | 428s | exit 0 | true |
| web | 83347 | 12:16:26 | 12:23:15 | 408s | SIGTERM | true |

三者在 **12:23:13 之前全程健康**，全部是收到停机请求后正常退出。因此：

- **28 未跑 ＋ context-fence 中断 ＝ 仪器债**（12:23:13 workerd 断连后整轮被终止）
- **5 条红发生在仪器死亡之前 ＝ 真红**，不是 08-12 那种「进程先死、fixture 级联」的假红

### 1.4 五条红的原始报错（摘）

```
1) v31-82  Locator: getByTestId('workbench-credit-balance') → element(s) not found (30s)
           readCreditPill (v31-82-…spec.ts:101)

2) v31-84  expect(received).toBeGreaterThan(0) → Received: 0
           Timeout 60000ms exceeded while waiting on the predicate（素材库资产数恒 0）
           v31-84-…spec.ts:152

3) v31-86  getByRole('listitem').filter({ has: [data-i18n-pass-through="store-fact"] })
           Expected: 4  Received: 0（14 × locator resolved to 0 elements）
           v31-86-…spec.ts:137

4) v31-87  Locator: getByRole('link', { name: '确认这张素材能否用于宣传' }) → not found (30s)
           authorizeLatestLibraryAssetAsCustomerCase (fixtures/library-source.ts:9)

5) v31-88  同 4，同一 fixture 同一行

6) v31-context-fence（interrupted）
           getByTestId('execution-confirmation-interaction-card'):not([data-request-id=…])
           → element(s) not found（120s）；随后 cleanupE2EUsers 收到 500
```

失败瞬间的页面快照（`test-results/**/error-context.md`）钉死了 4/5/2 三条的共同上游：
素材页停在 `region "把第一份门店素材放进来吧"`——**素材库是空的，上传根本没发出请求**。

---

## 二、Day-0 fail-fast 变异反证（升格后，`CI_EVIDENCE_DIR=output/ci/v31-day0-mutation`）

变异：把 `v31-zero-source-image-text-first-visit.spec.ts:53` 的
`await expect(page.getByText('本次用量已确认')).toHaveCount(0)` 临时改成 `(1)`。

day-0 段如期红：

```
Error: expect(locator).toHaveCount(expected) failed
Expected: 1
Received: 0
> 53 |     await expect(page.getByText('本次用量已确认')).toHaveCount(1);
1 failed
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1:
  playwright test tests/e2e/specs/v31-zero-source-image-text-first-visit.spec.ts
```

门 `exit 1`，证据目录里**只有** `playwright-v31-day0-release-gate.log` 与
`day0-gate-not-evaluated.log`——`playwright-v31-browser-acceptance.log` **根本没有生成**，
即第二段从未发起。判决书全文：

```
DAY-0 RELEASE GATE RED: tests/e2e/specs/v31-zero-source-image-text-first-visit.spec.ts failed — remaining 23 specs NOT evaluated;
day-0 evidence: output/ci/v31-day0-mutation/playwright-v31-day0-release-gate.log
- tests/e2e/specs/v31-day0-free-creation-journey.spec.ts
- tests/e2e/specs/v31-level1-copy-journey.spec.ts
- tests/e2e/specs/v31-memory-injection-b2-journey.spec.ts
- tests/e2e/specs/v31-living-plan-journey.spec.ts
- tests/e2e/specs/v31-video-paid-execution-journey.spec.ts
- tests/e2e/specs/v31-context-fence-journey.spec.ts
- tests/e2e/specs/v31-rights-revocation-journey.spec.ts
- tests/e2e/specs/v31-mid-run-steering-journey.spec.ts
- tests/e2e/specs/v31-interrupt-resume-journey.spec.ts
- tests/e2e/specs/v31-thread-root-workbench.spec.ts
- tests/e2e/specs/v31-ops-console-release-journey.spec.ts
- tests/e2e/specs/v31-publish-handoff-selfreport.spec.ts
- tests/e2e/specs/v31-artifact-growth-journey.spec.ts
- tests/e2e/specs/v31-goal-proactive-idle.spec.ts
- tests/e2e/specs/v31-partial-resume-assisted-journey.spec.ts
- tests/e2e/specs/v31-82-stalled-image-work-timeout.spec.ts
- tests/e2e/specs/v31-83-composer-session-cross-account.spec.ts
- tests/e2e/specs/v31-84-store-onboarding-capture-confirm.spec.ts
- tests/e2e/specs/v31-86-store-onboarding-archive-card.spec.ts
- tests/e2e/specs/v31-85-video-fallback-recipe-dead-end.spec.ts
- tests/e2e/specs/v31-87-same-content-reupload.spec.ts
- tests/e2e/specs/v31-88-asset-library-composer-source-attach.spec.ts
- tests/e2e/specs/v31-89-spoken-sentence-llm-extract.spec.ts
```

还原断言后 day-0 单跑 **1 passed（49.3s）**。

---

## 三、修复后的复跑

同一独立库 `meiye_v3187_repro`（`scripts/ci/provision-test-db.sh` 建，含平台默认模型 seed）、
同一组端口（3020 / 4120）：

| 轮次 | 范围 | 结果 |
| --- | --- | --- |
| r1 | 82/84/86/87/88 | 5 failed（原始态） |
| r2 | 同上（修上传门＋积分 testid） | 4 failed / 1 passed——五条全部推进到更深处 |
| r3 | 同上（修 capsule 竞态＋确认封口） | 2 failed / 3 passed |
| r4 | 82/86（修事实 `at` 钉死＋断言范围） | 1 failed / 1 passed |
| **r5** | **day-0 ＋ 84/86/87/88** | **5 passed（1.6m）** |

r4 的 82 快照证明了「为什么它必须留红」：那条 run **正常跑完了**——右栏
`本次成品 · 第 1 版已经准备好`、完整发布包 zip、handoff 二维码、积分停在 85（扣 15 未退）。
fixture 档下没有悬死可供 expiry fixture 推进，加轮询只会从 `alreadyTerminal`（跑成功）拿到假绿。
