# V31-56 — Living Plan 免费调整阶段：`/revise` 与 `/start` 两个请求各自以不同方式卡死

**Parent**: V31-10（Living Plan）；旅程见 §37.4-C
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-55（同一批终验轮踢出的独立故障——admission 层 `HARNESS_TASK_NOT_FOUND`/404 家族已排除，见下）
**Status**: fixed（2026-08-11）— `/revise` 保留 prepared task + body drain；`/start` body drain；delivery card after explicit start 已合入；Chromium `v31-living-plan-journey` **2/2 PASS** @ INT tip `1955a278e`

## 为什么单独开票

V31-55 的终验轮把 `v31-living-plan-journey` 和另外 6 个旅程一起复跑。另外 6 个此前统一表现为一种签名（admission 层对「裸 merchant taskId」查不到 prepared attempt，`HARNESS_TASK_NOT_FOUND`/404），V31-55 已经把那条根因修完并验证转绿。`v31-living-plan-journey` 复跑仍红，但**排查后确认不是同一根因**——它的两个失败断在完全不同的端点、不同的阶段，日志里没有 `HARNESS_TASK_NOT_FOUND` 或任何 404 出现过（`grep -c` 命中数为 0）。不能把它塞进 V31-55 的收口范围一起结案，所以单独立案，只记症状与证据，根因留白。

## 症状（两条，同一个 spec 文件的两个 test case，各自独立复现）

**症状 A**：`检索 → 一问 → Living Plan → 调整（前半段）`（test case，spec 行 232）——商家在免费调整阶段点「返回修改」→ 填写调整指令 → 点发送后，前端等待 `POST /api/core/p1/composer/tasks/{taskId}/revise` 这个请求本身，等了 120 秒（Playwright `page.waitForResponse` 超时）都没等到任何匹配的响应。这一步发生在**付费确认/Make 之前**，商家还没进入需要花钱的阶段。

**症状 B**：`提交不启动 Make，显式开始才启动（commit strip start）`（test case，spec 行 327，同一 spec 文件的第二个 case）——商家点「开始生成」按钮后，`POST /api/core/p1/composer/tasks/{taskId}/start` 这次**响应头确实回来了**（`await startPromise` 那一步没有单独报错），但紧接着读响应体 `await startResponse.text()` 卡住，直到 360 秒的整测试超时才被判失败。跟症状 A 不一样——不是「请求没发出/没等到响应」，而是「响应对象已经拿到了，但读它的 body 读不完」。

## 证据

| # | 证据 | 落点 |
|---|---|---|
| 1 | 症状 A 的超时断言 | `mkfast-template-main/tests/e2e/specs/v31-living-plan-journey.spec.ts:256`（`const revisePromise = page.waitForResponse(...)`），报错栈见 `/private/tmp/claude-501/-Users-bin/e60a9977-7692-47f9-aec3-5bc1d12fbd16/scratchpad/w4d/w4-final/round-per-spec/v31-living-plan-journey.log:158-168`（`TimeoutError: page.waitForResponse: Timeout 120000ms exceeded`） |
| 2 | 症状 B 的超时断言 | `v31-living-plan-journey.spec.ts:353-355`（`await page.getByTestId('agent-commit-strip-start').click()` → `const startResponse = await startPromise` → `const startText = await startResponse.text()`），报错栈见同日志 `:181-186`（`Test timeout of 360000ms exceeded` 在读 `.text()` 那一行） |
| 3 | 排除 V31-55 家族的判据 | 同一份日志文件 `grep -c "HARNESS_TASK_NOT_FOUND\|404"` 命中数 = 0（对照：另外 6 个受影响旅程的日志/trace 里，这两个字样各出现数十到上百次） |
| 4 | Playwright trace（含完整网络轨迹，尚未拆） | `mkfast-template-main/test-results/v31-living-plan-journey-V3-e018b--一问-→-Living-Plan-→-调整（前半段）-chromium/`（症状 A）与对应的 commit-strip-start test case 目录（症状 B），均含 `test-failed-1.png` + `error-context.md`；两个 case 是否跑了 `--trace on` 需要复跑一次单独确认（当轮跑的是常规 round-per-spec，未强制开 trace） |

## 已知但未坐实的猜测（写明是猜测，不是结论，避免下一个接手的人误当根因）

- 症状 A：`/revise` 请求「完全没发出去」还是「发出去了但服务端一直不回」，当轮证据不足以区分——需要专门跑一次 `--trace on` 才能看网络轨迹里这条请求到底存不存在。
- 症状 B：响应头已到、body 读不完，形状更像服务端在流式返回或连接没正常关闭，而不是路由查不到资源（如果是查不到资源，应该是快速返回的 4xx，不会卡到整测试超时）。这跟 V31-55 的「查询语义错配导致 404」是不同的失效模式，值得留意但不能当结论。
- 两个症状是不是同一个根因的两种表现（比如某个 harness 内部等待/轮询没有超时保护），还是两个互相独立的缺陷，当轮证据不够，留给接手人判断。

## 本票不做什么

- 不猜根因，不派实施。上面「已知但未坐实的猜测」明确标注为猜测，接手人第一步应该是补一次 `--trace on` 的单 spec 复现，把症状 A 到底有没有发出请求这件事先钉死，而不是直接开始改代码。
- 不并入 V31-55 的收口范围——V31-55 的两门回归测试与本票症状无关，V31-55 关票不受本票影响。

## Acceptance criteria

- [x] 根因结论（症状 A：请求未发出 vs 发出未响应；症状 B：卡在哪一层）
- [x] 两个症状是否同因，写明依据
- [x] `v31-living-plan-journey` 两个 test case 均转绿
- [x] 回归测试：至少覆盖修复后的具体机制，先红后绿

## 根因结论（AC1–AC2）

| 症状 | 层 | 结论 |
|---|---|---|
| A（调整 `/revise`） | Web controller + Playwright body read | 请求会发出且响应头可达；`submitPlanCommand` 对 `/revise` 只查 `response.ok`、不消费 body → Playwright `response.text()` 等 EOF 挂死（与已修 `/start` 同形）。另有 `revising` 时清掉 prepared task 的前端臂（`18969cc32`）。 |
| B（commit-strip `/start` + delivery） | 双因 | **Body 臂**：同 A，`/start` 曾不 drain（`fcd042758` 已修）。**Delivery 臂（独立产品 bug）**：`confirmPaidGenerationExecution` 在 decide→start 已确认后再次挂起；`ContentPackage` revision 写路径 `taskId===workflowId` fail-closed 拒绝 prepared attempt id（`${taskId}:plan-rN`）→ 无 revision/delivery card（`271adf397`）。 |

**是否同因**：body-EOF 两症状 **同属**「controller 不 drain envelope」一类；delivery 缺失 **不同因**，是 confirm 二次挂起 + package binding 过严。

## 留痕

- 开票：2026-08-10，W4-B 在 V31-55 终验轮复跑 7 个旅程时发现 `v31-living-plan-journey` 独立于 admission 层根因仍红，按主控裁决单独立案，只记症状与证据。
- Wave-4 resume（2026-08-11，集成树 `codex/v31-integration` @ `a9095ad40`）：
  - **症状 A 侧（revise 卡死）代码臂**：`18969cc32` / merge `08a50f95f` — `composer-home.tsx` 在 `livingPlanController.revising` 时不再清掉 prepared task（interaction：`living-plan-revise-entry.interaction.test.tsx`）。**不**等于 Playwright 旅程转绿。
  - **症状 B 侧（/start body）代码臂**：`fcd042758` + failure toast `950d29bab` / merge `df0a7641c` — `use-living-plan-controller.ts` 经 `readP1Envelope` 消费 `/start` 至 EOF；失败 envelope 走 `toast.error('开始制作失败，请重试')` 且不自动重发。Web interaction 5/5 + typecheck/check 在 INT 复验通过。**明确不覆盖 delivery card 投影**。
  - **最终 HEAD 浏览器反证**（`/tmp/v31-final-verify`，short batch PORT=3180）：
    1. 调整 case：`reviseResponse` 已拿到，但 `await reviseResponse.text()` 300s 超时（`v31-living-plan-journey.spec.ts:286`）——形状从「等不到 /revise 响应」漂移为「响应对象在、body 读不完」，与旧症状 B 同形；`submitPlanCommand` 的 `/revise` 路径仍只查 `response.ok`、不 drain body（`use-living-plan-controller.ts:117-131`）。
    2. commit-strip start case：`composer-delivery-card[data-work-id=…]` 180s 不可见（spec `:379`）——`/start` drain 后 Make/交付投影仍缺，独立于 body-EOF 修复。
  - **AC 勾选**：四条仍空（当时）。旅程未全绿；delivery 缺失另诊断，不扩 `/start` drain 范围。
- Residual fixes + reverify（2026-08-11，INT tip `1955a278e`）：
  - `/revise` drain：`935ba1fa8` — `readP1Envelope` mirror `/start`；interaction **9/9**。
  - Delivery：`271adf397` — skip re-suspend when already confirmed；accept prepared-attempt workflow ids on ContentPackage revision；core unit **15/15**（confirm gate + revision port）。
  - Chromium reverify e2e-lock PORT=3205 CORE=4205：`v31-living-plan-journey` **2/2 PASS**（调整 17.1s；commit-strip start 23.7s；含 `composer-delivery-card`）。log `/tmp/v31-residual-reverify/pw-living-plan.log`；handoff `docs/handoff/v31-wave4-residual-reds-report-2026-08-11.md`。
  - **AC 勾选**：根因+同因依据+双 case 绿+先红后绿回归均满足 ⇒ **勾选**。
