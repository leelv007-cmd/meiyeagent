# V3.1 Playwright spec assertion audit — ban patterns and rewrite worklist

- 审计对象：`mkfast-template-main/tests/e2e/specs/v31-*.spec.ts` 现存 9 个文件（2401 行）
- 审计 HEAD：`9ab20aff5`（lane `codex/v31-ci-gates`）
- 审计口径：**静态阅读 + grep**。本轮**没有跑任何 Playwright**（本 lane 无 PG／浏览器额度），
  因此下文所有结论都是「代码写成这样就一定不成立」的静态判定，不含任何实跑观测。
- 判据来源：`docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md`
  §37.4（1763 行起）的旅程定义。每条 finding 的「必须改成什么」都回指该节原文，
  不使用审计者个人偏好。
- **本文档没有修改任何 spec 文件**。重写归 Wave 3 browser lane，且必须对着合并后的
  runtime 做（很多断言现在写不出来，是因为下游产品面还没落地）。

## 0. 禁用形状清单（legend）

| 代号 | 禁用形状 | 为什么是假绿 |
|---|---|---|
| B1 | `if (await x.isVisible())` 包住真正的断言 | 元素不在＝整段断言被跳过，测试仍绿 |
| B2 | `.or()` 链／正则 `\|` 交替，且分支落在不同产品状态上 | 任一弱状态出现即绿，覆盖不到被承诺的那个状态 |
| B3 | `.or()` 的某个分支恒真（或已在上文断过） | 断言退化为 no-op |
| B4 | `.or()` 的某个分支是**失败终态** | 运行失败也算通过 |
| B5 | API-only 顶替 UI 步骤 | 票面承诺的是商家可见旅程，不是 P1 能被 curl 通 |
| B6 | 只断页面文案，票面要的是产品／账目状态 | 文案可以写对而账目错，反之亦然 |
| B7 | 测试自己喂关键判定输入（时钟、gate config、revision） | 证明的是「参数传进去会怎样」，不是产品真实状态 |
| B8 | `toBeAttached` 顶替「渲染出内容」 | 挂载 ≠ 商家看得见 |
| B9 | `void x` / 取值不断言 | 变量存在，契约没被验证 |
| B10 | `catch { return }` 把关键步骤降级为可选 | 网关没出现＝旅程没走到，却当成「本次不需要」 |

`route.fulfill` / route interception：**9 个 v31 spec 内一个都没有**（已 grep 确认）。
主旅程 mock 这一项目前是干净的，Wave 3 不要引入。

## 1. 跨文件问题（一处修，多条旅程受益 —— 建议 Wave 3 先修这两条）

### 1.1 共享 fixture 把「运行失败」当成可接受终态 —— B4，最严重

`mkfast-template-main/tests/e2e/fixtures/ui-journey.ts:377-387`

```
const terminalFailure = page
  .getByTestId('composer-report-card')
  .or(page.locator('[data-testid="composer-terminal-outcome"][data-outcome="failed"]'));
await expect(
  resumedLine.or(executionConfirmation).or(terminalFailure).first(),
  'the direction must reach a monotonic downstream state after the merchant click'
).toBeVisible({ timeout: 60_000 });
```

`chooseImageTextDirection()` 在商家点完图文方向后，接受三种终态之一，**其中一种是
`data-outcome="failed"`**。凡调用该 fixture 的 spec（C＝`v31-living-plan-journey`、
G＝`v31-mid-run-steering-journey`）都可以在生成彻底失败的情况下走绿。

必须改成：只接受 `resumedLine` 或 `executionConfirmation`（两者都是「继续前进」）；
失败终态出现时应当 fail 并把 report card 文本打进错误信息。若确有需要区分「fixture
模型边界返回失败」的场景，那要单独一条 negative test，不能挂在主旅程的 or 链上。

### 1.2 共享 fixture 的 image_text 断言恒真 —— B3

`mkfast-template-main/tests/e2e/fixtures/ui-journey.ts:654-659`

```
await expect(
  page.getByTestId('image-worksurface').or(merchantStatus),
  'image_text generating path must keep Result visible until ready'
).toBeVisible({ timeout: 120_000 });
```

`merchantStatus` 在 `:623-629` 已被 `toContainText(/生成中|可发布|已发布就绪/)` 断过，
到这一行它必然已解析且有文本，所以 `or` 分支恒被满足，
「generating 阶段 Result 保持可见」实际未被验证。必须去掉 `or(merchantStatus)`，
直接断 `image-worksurface`。

### 1.3 `chooseImageTextDirection` 允许整段跳过 —— B1 + B2

`fixtures/ui-journey.ts:323-337`（`expect(resumed || cardVisible)` 后 `if (resumed) return`）
与 `:359-369`（点击失败时若 `resumedLine` 可见就 `return`）。

结果：§37.4-C 承诺的「只问一个问题→商家回答」这一步在「已经 resumed」的分支里
完全不发生，spec 仍绿。必须改成：先确定本轮是否应当提问（由 Core 的 question budget
决定），再分别走「必须提问并回答」或「必须不提问」两条**确定**路径，不要用
`resumed || cardVisible` 把两种世界并成一个可过条件。

### 1.4 P1 route mock 缺 `meta.correlationId` 会呈现为「产品 bug」—— 给 Wave 3 的避坑

`packages/contracts/src/api-envelope.ts:101-103` 的 `apiSuccessSchema` 是 `.strict()`
且 `meta.correlationId` 为必填（`apiMetaSchema`，`:84-86`）；`mkfast-template-main/src/p1/client.ts:90-98`
的 `readP1Envelope` 在 parse 失败时抛 `P1RequestError`。因此任何
`route.fulfill({ json: { data: … } })` 形状的 P1 mock 都不会「返回数据」，而是让调用面
拿到异常并渲染空态（taskId 恒 null、计数恒 0），读起来像产品缺陷。

v31 spec 内没有这类 mock。但仓库里 **18 处** P1 route mock 属于此形状，Wave 3 若从邻近
spec 复制模式会直接踩中。已确认的样本（`/api/core/p1/query`，确定走 `readP1Envelope`）：

- `specs/composer-conversation-deletion.spec.ts:54,58,62-64,68`（success 分支缺 meta）
- `specs/composer-conversation-deletion.spec.ts:81-89`（**failure 分支也缺 meta**，
  于是 `CAPABILITY_DENIED` 永远传不到 UI，只会得到「envelope was invalid」）
- `specs/admin-dashboard-shell.spec.ts:141-160,178,223,301`
- `specs/uiux-creation-loop.spec.ts:255-267`
- `specs/w02-five-step-intake.spec.ts:293`

其余命中（`composer-card-family.spec.ts:501,521`、`marketing-composer-harness.spec.ts:139,153,215,368,387,401,470,484,588`）
走的是 harness/workflows 端点，是否经 `readP1Envelope` 需逐条确认，我没有确认，不下结论。
**这不属于本轮 v31 审计范围内的 finding，只作为 Wave 3 的施工须知。**

## 2. 逐 spec findings

### 2.1 `v31-day0-free-creation-journey.spec.ts` —— §37.4-A（整体最扎实）

真 Core 会话、真提交 202、真 ContentPackage 回查、排他断言。以下是缺口：

| 位置 | 形状 | §37.4-A 要求的改法 |
|---|---|---|
| 全文（止于 `:216`） | 旅程缺尾段 | §37.4-A 原文＝「…生成不带虚构事实的通用文案、**进入发布交接**」。当前止于 `data-delivered=true`，从未进入 publish handoff。必须续到 `publish-handoff-panel` 锚定（K 的入口，但 A 自己必须走到） |
| `:32` `NEVER_SEEDED_STORE_FACTS` | B6 弱化 | 「不虚构事实」用 3 个固定字符串排他。应改为：从 productState 取本 workspace **实际未确认**的事实集合动态生成排除项，并对 fact refs 做反向校验（§40「事实 refs 反向验证」），而不是硬编码三个词 |
| `:124-126` | B1（可接受） | `if (aria-pressed !== 'true') click()` 是幂等前置操作，不是被跳过的断言。**保留**，不要为形状统一去改 |

### 2.2 `v31-living-plan-journey.spec.ts` —— §37.4-C 前半

| 位置 | 形状 | 要求的改法 |
|---|---|---|
| `:121-128` | **B1** | 「旧 revision 可浏览」整段被 `if (await rev1.isVisible())` 包住。§37.4-C 要求调整后「旧确认／旧版本可追溯」，必须无条件：调整产生 revision 2 后，revision-1 chip **必须存在**并可点回，且回到 `data-revision=1` 时展示的是**旧内容**（当前连内容都不比） |
| `:70-75` | B2 | `agent-activity-line \| agent-narrative-line \| composer-stage-line \| composer-progress-card` 四选一当「检索可见」。§37.4-C 的「先检索」应断到检索**结果**进入 Plan 的 `facts_assets` 段，而不是任一进度行出现 |
| `:101-104` | B2 | `agent-commit-strip \| agent-compact-plan` 二选一。报价／确认呈现是 §5.6 的确定面，应固定一个 |
| `:112-116` | B2（轻） | `data-revision` 正则 `/[2-9]\|\d{2,}/` 接受任意 ≥2。一次调整就该是精确 `'2'` |
| `:80` → fixture | 见 1.1／1.3 | 一问一答可被整段跳过，且失败终态可过 |

### 2.3 `v31-context-fence-journey.spec.ts` —— §37.4-E（F 已按主控裁决拆走）

这是 9 个文件里最弱的一个，spec 自己在 `:79-81` 写明「Without live drift injection
fixtures, this assertion is soft」。

| 位置 | 形状 | 要求的改法 |
|---|---|---|
| `:75-90` | **B2，无效断言** | `planOrInterrupt.or(staleSurface)` ＝「living plan／commit strip／ask-merchant／question card／stale 文案」五选一。**只要 Plan 正常渲染就绿**，与 stale 无关。§37.4-E 要求：确认前令 price/date revision 真的变化 → 必须出现 `agent-plan-diff` 且 diff 内含变化项 → **旧确认提交必须被拒**（拿到明确错误码）→ 重新确认后才 execute。三段都要断，且 drift 必须由 fixture 真的注入（Task 3 的 live-facts fence 落地后才写得出来） |
| `:65-67` | B7 | 用 intent 文本「稍后我会改价格事实」暗示 drift，实际什么都没改。必须改成对事实 head 的真实写入 |
| `:41-49` | B10 | `confirmCreationGateIfPresent` 用 `catch { return }` 把 D-043 事实确认门降级为可选。E 旅程的前提就是「有一次确认」，必须确定性地要求该门出现（若本 intent 不该触发，就换一个必然触发的 intent） |
| `:93-121`（F 段） | 迁移 | 本段应整体搬进新建 `v31-rights-revocation-journey.spec.ts` 并重写，见 2.10 |

### 2.4 `v31-interrupt-resume-journey.spec.ts` —— §37.4-H

| 位置 | 形状 | 要求的改法 |
|---|---|---|
| `:89-110` | **B1，且是 review §四 点名项** | `if (await resume.isVisible().catch(() => false))` 包住 resume 点击**和**其后的全部断言。按钮不在＝整个 resume 契约不验证。必须无条件 resume |
| `:92-109` | B2 | poll 返回 `!still \|\| progress`：「interrupt 消失」或「有进度行」任一为真即绿。§37.4-H 要求 resume 后 run **继续**，应断 run 进入下一确定状态（同 runId 的下一个 stage／artifact），不是「宿主消失了」 |
| `:65-70` | B2 | 五选一 interrupt 宿主（含 `agent-commit-strip`，那并不是 typed interrupt）。应固定为 typed interrupt 的产品渲染面 |
| `:74-82` | B6 | 刷新前后只比 `innerText().length > 0`。§37.4-H 明确要求**同 interruptId + 同 revision**：必须读 DOM 上的 interruptId／revision 属性，刷新前后精确相等 |
| 缺失 | — | §37.4-H 还要求：pending interrupt 存在时**普通新输入被阻止**、**duplicate resume 幂等**、**expired resume 被拒（hold 到期＝取消＋退分）**、**payload schema 不匹配有可见错误**。四条一条都没有 |
| `:113-136` | **B9 + B3** | 第二个 test 断的是 `dashboard-home \| main` 可见（`main` 恒存在＝恒真），然后 `void inbox`（`:135`）。这条 test 目前证明「dashboard 能打开」。要么改成真的验 workspace-scoped pending 列表（造两个 workspace 的 interrupt，断只看到自己的），要么删掉 |

### 2.5 `v31-mid-run-steering-journey.spec.ts` —— §37.4-G（断言质量中上，旅程时点错）

费用面断得很好（`:136-139` 断 `data-rebilled=false` + 文案 + `settled` 计数 0；
`:186-188` 断重算且不出现「成本」）。问题在时点与范围：

| 位置 | 形状 | 要求的改法 |
|---|---|---|
| `:113-120` | **旅程时点错（review §四 点名）** | `confirmCreationGateIfPresent` → `chooseImageTextDirection` → 立刻 steering。此刻还停在 execution confirm 前，**不是 mid-Make**。§37.4-G 要求「mid-run」：必须先让 Make 真的开始（至少一个 unit 完成、artifact 出现），再提交 steering |
| `:131` | B8/B6 | 「其他页保持」只断 `steering-impact-preserved` **可见**。§37.4-G 要求「只有封面与第二页变化，其他页保持」：必须比较 steering 前后的**产物范围**——记录前置 note 各页内容摘要，steering 后逐页比对，未受影响页字节级不变 |
| `:102-108`、`:164-169` | B2（轻） | 四选一 progressHost 只作等待，不承载断言。可保留，但应在其后加一个确定状态断言 |
| `:49-57` | B10 | 同 2.3 的 `catch { return }` 降级 |

### 2.6 `v31-thread-root-workbench.spec.ts` —— §37.4-I

| 位置 | 形状 | 要求的改法 |
|---|---|---|
| `:228-274` | **B5，标题与内容不符** | test 名为「one Thread can host multiple Works」，实际创建的是**两个 Thread**（`:236-255`），再断 `list_threads.length >= 2`。§37.4-I 要求的是「**Delivered 后继续同一 Thread 产生新 Work**」：必须真交付一次，然后在同一 threadId 下发起第二个 Work，断两个 Work 挂同一 Thread、且第一个 Work 的产物不被覆盖 |
| `:247-248` | 自述缺口 | 注释写明「Business write path remains Composer/Task (not rewritten here)」——即承认没走产品写路径 |
| `:273` | **B8** | `agent-workstream-process` 用 `toBeAttached`，注释自述「Container renders empty until semantic replay wiring lands」。V31-04 语义投影落地后必须改为断真实内容（至少一条 process 行文本） |
| `:109-117`、`:152-160`、`:191-215`、`:284-292` | B5 | Thread 全部由 `p1Command('agent-session','create_thread')` 造。刷新／换设备恢复的**载体**可以这样造（那是在验 workbench 解析），但 §37.4-I 的主命题必须由真实交付旅程产生 Thread |
| `:143-181` | 命名 | 「device switch」＝新 browser context 冷导航。这是诚实的近似，**保留**，但报告里不要写成真实换设备 |

### 2.7 `v31-goal-proactive-idle.spec.ts` —— Goal ＋ Proactive Idle（非 A–K 字母，票 V31-24）

| 位置 | 形状 | 要求的改法 |
|---|---|---|
| `:143-158`、`:162-188`、`:251-271` | **B7，最关键** | gate 的判定输入 `config: { disableProactiveAgent, proactiveFeatureOn, workspaceAllowlisted, coverageThreshold }` 由**测试从客户端传入**。于是「阈值未设＝不出建议」「kill switch 关闭建议」证明的只是纯函数分支，不是产品在真实配置下的行为。必须改为：由 admin 配置面／服务端配置写入这些开关，再从商家侧观察 Idle 投影 |
| `:177-188`、`:261-270` | B7 | signals 也是测试注入的（且 `resourceId: 'ignored-client-placeholder'`）。why-now 证据应来自真实信号写入路径 |
| `:277-296` | **B8** | 唯一的 UI test 只断 `data-workbench-root=idle` ＋ `idle-goal-proactive` **toBeAttached**。票面承诺是「Idle 首屏显示主目标 ＋ 带 why-now 的主动建议」：必须断出目标语句文本、建议条目、why-now 证据在页面上可读，以及 dismiss 后刷新仍被记住（票面第 4 条，当前完全没有对应断言） |
| `:238-240` | B6/掩盖 | `expect(goalsNav?.status() ?? 404).not.toBe(200)`：`?? 404` 把 null 响应也算通过。应断确定的 404（或 not-found 渲染） |
| `:193-235` | 保留 | accept ＋ 幂等 replay ＋ `paidSideEffect=false` 是真契约断言，**保留** |

### 2.8 `v31-ops-console-release-journey.spec.ts` —— §37.4-J

审计判定：**整条 test（`:214-476`）零 UI 交互**，唯一的页面动作是 `:221` 打开
`/dashboard` 取 workspaceId。lifecycle／audit 的字段级断言写得很细（`:433-475` 逐 action
断 operator/reason/evidence，质量高），但它证明的是 P1 模块，不是 Ops Console 旅程。

| 位置 | 形状 | 要求的改法 |
|---|---|---|
| 全文 | **B5（review §四 点名）** | 票 V31-22 AC4 与 §37.4-J 要求的是控制台旅程：发布 → 圈 canary → 试跑 → 放量 → 回滚 → 审计留痕，**每一步都要有操作员在真实 admin 界面上完成**并能看到结果。必须改为在 ops-console 页面上点，P1 断言作为交叉验证保留 |
| `:391-399` | **推断顶替断言** | 注释「production 指针即新任务的解析结果」＝用推理代替验证。§37.4-J 明确要求「**canary 命中候选、非 canary 用 production、rollback 后新任务回旧 release、在途任务保留冻结 release**」四条。必须：canary allowlist 内的 workspace 发起新任务 → 解析到候选；allowlist 外 workspace → 解析到 production；rollback 后新任务 → 旧 release；rollback 前已在途的任务 → 仍持有原冻结 release（这条需要 Task 6 的 exact resolver 落地） |
| `:242` | B2（轻） | `toMatch(/U11\|unset/iu)` 交替。错误面应断 `code` 精确值（`:241` 已断 `INVALID_STATE`），message 的正则可以去掉 |

### 2.9 `v31-publish-handoff-selfreport.spec.ts` —— §37.4-K（前半强、后半 API-only）

`:241-306` 是 9 个文件里最好的一段真 UI 断言：panel 无条件锚定、`data-show-direct-publish=false`、
copy blocks ≥3、ZIP 名非空、mobile handoff 的 actor 属性、`data-binding-revision` 与
`content_packages.revision` **精确相等**、同日不渲染自报 strip。这些**全部保留**。

| 位置 | 形状 | 要求的改法 |
|---|---|---|
| `:331-511` | **B5 + B7（review §四 点名）** | 「次日追问」整段走 P1，且**次日是测试传进去的**：`publishHandoffCompletedAt: yesterday`（`:364,391,462,506`）。§37.4-K 要求「交付次日追问**可达**、一键 chips 落 OutcomeEvidence、频控生效」。必须由产品时钟／可控时间源推进到次日，在**真实 UI** 上看到自报 strip 与六个 chip，点击一个 chip，再回查 OutcomeEvidence 落库与 revision 绑定 |
| `:395` | 保留 | `chips` 全集精确相等，是好断言 |
| `:469-497` | B7（轻） | two-ignore backoff 用两个凭空 workId（`w-ignore-…`）＋同一个 packageId。频控是店级策略，用不存在的 work 造它会让「store_backoff」与真实交付序列脱钩。应由两次真实交付＋两次真实忽略产生 |
| `:282-287` | 低 | `click({ force: true })` 绕过 actionability。A19 拒绝面应当在正常可点状态下触发；若按钮本就 disabled，那要断 disabled，而不是 force 点它 |

### 2.10 待建的 5 个文件（Wave 3 必须用这些确切路径）

gate 已按名索取，缺文件即 fail closed（`scripts/ci/run-v31-browser-acceptance.sh`）。

| §37.4 | 文件 | 必须成立的断言（照 §37.4 原文） |
|---|---|---|
| B | `v31-level1-copy-journey.spec.ts` | 免确认直达结果；报价 chip 常显；余额不足**双出口**阻断；`approvalBasis=policy_exempt_copy` 的 admission；**exact plan/quote/release 仍冻结**；重放与扣费幂等（BLOCK-01） |
| B2 | `v31-memory-injection-journey.spec.ts` | 任务详情 → 注入清单 → 经验来源 → 撤销 → **后续任务不再注入**（MAJOR-12），四步都在 UI 上 |
| D | `v31-video-paid-execution-journey.spec.ts` | Plan 显示时长／分镜／积分；Interrupt；**关标签页**；恢复；部分失败；字幕封面 assisted fallback |
| F | `v31-rights-revocation-journey.spec.ts` | Plan 形成后撤权 → Make admission **fail closed** → 可换素材 → **不重复扣费（验 ProductUsageLedger 行数／金额，不是页面没有「重复扣费」字样）** |
| — | `v31-artifact-growth-journey.spec.ts` | branded threadId 一致；snapshot/delta/ready/derived 事件；跳号 revision 冷启动重放可恢复；已完成内容不被覆盖 |

F 的现存前身 `v31-context-fence-journey.spec.ts:93-121` 是 B6 的教科书样本：
`:120` `await expect(page.getByText(/再次扣费|重复扣费/)).toHaveCount(0)` —— 页面上没有
「重复扣费」四个字，与「没有发生第二次扣费」是两件毫不相干的事。搬过去时必须换成账目断言。

## 3. 建议的修复顺序（给 Wave 3）

1. **先修 1.1／1.2／1.3 三处共享 fixture**——失败终态可过是全局性假绿，且一处修好，C/G/K 同时受益。
2. 修四处 B1 硬跳过：`v31-interrupt-resume-journey.spec.ts:89-110`、`v31-living-plan-journey.spec.ts:121-128`，以及两处 `confirmCreationGateIfPresent` 的 `catch { return }`。
3. 把 E 从「五选一恒绿」重写为真 drift 三段断言（依赖 Task 3 落地）。
4. 把 J 从纯 API 改为控制台旅程 ＋ 四条 release 解析断言（依赖 Task 6 落地）。
5. 把 K 后半与 goal-proactive 的 gate 输入从「测试注入」改为「真实配置／真实时钟」。
6. 新建 5 个待建 spec（B／B2／D／F／artifact），gate 转绿的最后一步。
7. I 的「Delivered 后同 Thread 新 Work」需要真交付两次，放在 Campaign U7 那条一起做最省。

## 4. 本轮明确没做的事

- 没有修改任何 `v31-*.spec.ts` 或 fixture 文件（重写归 Wave 3，且须对合并后 runtime 做）。
- 没有跑 Playwright、没有起 dev server、没有占 PG。所有 finding 都是静态判定。
- `marketing-composer-harness.spec.ts` 等 11 处 harness/workflows route mock 是否真的经
  `readP1Envelope`，我没有逐条确认，只作为施工须知列出，不作为 finding。
- 没有勾任何票面 checkbox，没有改任何 `Status:` 行。
