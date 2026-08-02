# #313–#328 实现 vs Spec 差距修复方案（Gap Remediation Plan）

| Field | Value |
| --- | --- |
| Date | 2026-08-02 |
| 主控 | Claude（Fable 5 会话，负责裁决、派发、rebase、合入、终验） |
| 执行 | Grok CLI lanes（worktree 隔离，不 push、不关票、不动 main） |
| 复核来源 | 四路只读复核（形态 / 九功能可达性 / 运行时与部署 / 测试背书），2026-08-02 |
| 权威链 | `docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §2/§4/§8 ＞ 本方案裁决 ＞ 票面历史表述 |
| 纪律 | `docs/ops/agent-dispatch-runbook-2026-07-29.md` 全部适用；每 lane 独立 worktree；本方案即留痕载体，合入记 `docs/ops/merge-ledger.md` |

---

## §0 差距根因（四路复核归因，五层）

1. **运行环境掩盖（体感最大）**：`scripts/dev/runtime-profile.mjs:30/:46` 先展开 `.env` 再用硬编码覆盖 → `pnpm dev` 恒 `MODEL_EXECUTION_MODE=fixture` + `APP_ENV=e2e`；`apps/core/src/p1/model-supply/runtime-config.ts:128` 令媒体供给（tuzi/ark）整体不装配。UI 全真、生成产物全假。`.env` 本身已配齐（direct + tuzi + 22 Langfuse pins，remote 实测可达）。
2. **部署断层**：`deploy.yml` 史上 0 次 success（release-manifest job 不响应 push；CF secrets 全空）。线上不存在任何版本。
3. **形态只做骨架**：布局/状态机层（四态/双栏/粘底/800/1240/交付去重）真实消费；但 Composer 底栏胶囊化未做（七层堆叠，首屏元素≈原型 2 倍）、文档时间线只有「非气泡流」否定面、AgentFrame 六族 `data-agent-frame` 全仓 CSS 零命中、玫瑰金生成态组件写完未接线。
4. **功能链缺口**：#319 时间线只在 delivered 后挂载（顺序与 spec 相反）、配图状态死路径、「逐页重生」实为整篇重生且计费不匹配；深度思考 providerOptions 硬编码 `deepseek` 键；风格分析在 poster 路径静默失效；OpenCLI 链接轨缺生产注入方。
5. **验收体系盲区**：required CI 只跑 4 个 P1 前老 e2e；P2 九票 CI 内 e2e 零覆盖（全量 e2e 因 `needs: release-manifest` 在 push 上结构性 skip）；全仓 0 视觉断言；工作台形态验收=源码字符串正则。**可被机器断言的合同全做了，只能看出来/只在真环境暴露的东西系统性无门。**

---

## §1 主控裁决记录（本方案生效，用户可否决）

| # | 裁决 | 理由 |
| --- | --- | --- |
| R-1 | **首屏顺序按 spec §2.4**：问候 → 分段器 → Composer → 建议行 → Activity Shelf。D-164①「提议在创作之上」在此点被 supersede | spec 是 2026-08-01 wayfinder 九票闭合的最新权威，且经原型验证；D-164① 的「冷启动空面板」顾虑已由建议行+Shelf 常驻解决。`dashboard-home-contract.test.ts` 顺序断言随之改写 |
| R-2 | XHS 笔记 thinkingLevel=standard 映射改为 `{mode:'auto', profile:'quality'}`，与全局默认对齐；深度思考仍映射 balanced/quality 之上叠加 thinking 选项 | 现状把所有 XHS 笔记（含定制模式）从 quality 静默降到 balanced，无决策依据 |
| R-3 | 风格分析 poster 路径：**优先真支持**（media harness 接 `analyzeStyleReferences` + 注入 image brief）；若架构阻断则退 UI 诚实（非 note lens 隐藏风格参考控件与「分析中」文案），二选一必须落一个，禁止维持「假进度」现状 | 「前台显示分析中、后端静默忽略」是四失效模式之一 |
| R-4 | #319「大纲先可编辑再出图」本轮做到：**running 期挂载只读时间线 + 真配图状态**；confirm 卡展示大纲。完整的 pre-confirm 编辑（plan 阶段 OCC 编辑）另开票 | 挂载时机与状态死路径先修；plan 阶段可编辑涉及 store 前 OCC 语义，超本轮半径 |
| R-5 | 空违禁词库静默放行维持现状 | `ensurePlatformBaseline` 保证 18 条基线；空库只能来自运营显式清空，属运营意图 |
| R-6 | #325 纠错分流（producerReady:false）维持诚实空态，不本轮实现 | 需要独立分类 producer，是新功能非差距修复 |
| R-7 | OpenCLI 链接轨、CF 部署 secrets = **供给项**（§5），不阻塞本轮 | companion 交付物与云凭证均在仓外，按单一供给门原则一次清单化 |
| R-8 | 视觉截图基线在 L1–L4 合入后由主控在验收阶段建立（Linux CI 生成基线），避免对着旧形态拍照 | 基线必须拍新形态 |

---

## §2 修复批次（四条 lane，worktree 隔离，语义分包）

### L1 — `fix/319-note-loop`：一键图文闭环（core+web，#319/#326 语义面）

| 项 | 内容 | 关键位置 | 验收判据 |
| --- | --- | --- | --- |
| L1-1 | **逐页重生改真单页**：result_adjust confirm 后不得整篇重跑。接通 `regenerateNotePlanPage`（现为零生产调用的孤儿），派生 submission 只执行目标页；usage 记账=1 页 | `apps/core/src/p1/execution-spine/submission-coordinator.ts:325-338,425-429`；`apps/core/src/p1/harness/note-plan-compiler.ts:543`；`apps/core/src/p1/harness/unified-media-stage-ports.ts:735-738` | 新 PG 测试：3 页 note 重生第 2 页 → 仅 1 次 image 执行、usage=1、其余页 body/asset 不变；旧整篇路径测试同步改写 |
| L1-2 | **note 链发页级执行帧**：note 路径逐页发 `execution_selection` running→success（现只在成功时发一次），使 `note-plan-timeline.ts:133-140` 的 generating 判定可达 | `apps/core/src/p1/harness/workflow-core.ts:1667-2011`（:1955 附近） | interaction/unit：时间线页状态出现 generating→ready 迁移；e2e fixture 流内可断言 |
| L1-3 | **running 期挂载时间线**：去掉 `phase==='delivered'` 硬门，note_plan 一到即挂只读时间线（编辑仍限 delivered 后）；配图状态吃 L1-2 的帧 | `mkfast-template-main/src/product/composer/composer-home.tsx:1879-1920`；`composer-session.ts:333,359` | interaction：running 相位下时间线可见、状态随帧更新；delivered 后可编辑不回归 |
| L1-4 | **execution_confirm 卡展示大纲摘要**：note 付费确认卡带页数+每页标题（只读） | #317 confirm 卡组件 + core interrupt payload | interaction 断言确认卡含大纲行 |

### L2 — `fix/gen-params-style`：生成参数与风格分析（core 为主）

| 项 | 内容 | 关键位置 | 验收判据 |
| --- | --- | --- | --- |
| L2-1 | **深度思考 provider 键修复**：`providerOptions` 按实际 provider name 落键，非 DeepSeek 模型正确传 reasoning/thinking 或显式记「该 provider 不支持」 | `apps/core/src/p1/model-supply/ai-sdk-runner.ts:967-975,1011-1024`（:1023 硬编码） | unit：deepseek 与非 deepseek 两分支的 providerOptions 键各自正确 |
| L2-2 | **R-2 落地**：standard → `{mode:'auto', profile:'quality'}` | `apps/core/src/p1/harness/unified-media-stage-ports.ts:1014-1041`；contracts `composer-generation-params.ts:94-108` | unit：standard 档 profile=quality；deep 档不回退 |
| L2-3 | **R-3 落地**：poster/image_set 路径风格分析（优先真支持；退路=UI 诚实隐藏） | `apps/core/src/p1/harness/unified-media-stage-ports.ts:797-828`（analyzeStyleReferences 仅 compileNoteBrief 调用）、`workflow-core.ts:2057+`、`xhs-style-analysis.ts:123`（applyStyleAnalysisToImageSetPlan 孤儿）；退路=`composer-style-reference-control.tsx` + `composer-home.tsx:4147-4174` lens 门 | 真支持：PG 测试 poster 提交带 style ref → image brief 含 styleAnalysisBlock；退路：非 note lens 下控件与进度文案不出现 |
| L2-4 | **AI 封面 style 参数不落地补齐**：`compileAiCoverImageParameters` 算出的 style 进 provider 参数或明确移除该死代码；preset 枚举进 prompt 时用中文描述而非英文枚举名 | `apps/core/src/p1/harness/unified-media-stage-ports.ts:1085-1108`（:1102-1105 丢弃）、`xhs-cover.ts:92-133` | unit：五 preset 各自 prompt 片段断言 |
| L2-5 | **aiCover 静默丢弃改可见提示**：签名失配（比例/配方变更）时 toast/inline 提示「封面参数已失效」，不再无声退化 | `mkfast-template-main/src/product/composer/composer-home.tsx:1272-1285,2561-2605` | interaction：改比例后提交 → 提示可见 |

### L3 — `fix/workbench-form`：工作台形态（web only，spec §2 视觉合同）

| 项 | 内容 | 关键位置 | 验收判据 |
| --- | --- | --- | --- |
| L3-1 | **R-1 首屏顺序重排**：问候 → 分段器（移出 Composer 卡，置问候下）→ Composer → 建议行 → Shelf；改写 `dashboard-home-contract.test.ts:110-143` 顺序断言并在测试注释记 R-1 supersede D-164① | `composer-home.tsx:3556-3600`、`composer-conversation.tsx:868` | 合同测试新顺序绿；旧顺序断言删除 |
| L3-2 | **Composer 底栏胶囊化**（最大件）：lens 选择、配方、发到哪、额度收进底栏图标胶囊（＋素材 / 输出类型▾ / 配方▾ / @ / 额度 / 圆形发送），点开 popover 展开现有控件；保留 a11y（fieldset/legend 语义迁入 popover）；口吻卡与工具条收纳进底栏或 @ 菜单 | `composer-conversation.tsx:827-1077`（ComposerPromptBar 七层堆叠）；原型 `references/analysis/xhswork-integration-2026-08-01/04-workbench-prototype.html:286-294` | 首屏 Composer 区域高度显著下降；interaction 全量改写后绿；键盘/读屏可达性保持 |
| L3-3 | **文档时间线视觉**：左侧竖轴 + 每 turn 节点圆点 + stage label；AgentFrame 六族视觉分族（`data-agent-frame` 选择器落 CSS，六族至少有区分度：narrative/decision/plan/result/task/memory） | `composer-conversation.tsx:169-180`（AgentFrameHost）；原型 04:126-134；`heroui-glass.css` / `styles.css` | 六族选择器 CSS 命中非零；静态测试锁竖轴类名；肉眼可辨 |
| L3-4 | **玫瑰金生成态接线**：running 相位挂 `GenerationAccent`/`.meiye-rose-glow`（组件已存在，styles.css:486-505），respect prefers-reduced-motion | `composer-home.tsx` running 分支；`components/uiux/generation-accent*.tsx` | interaction：running 时 accent 元素在 DOM；reduced-motion 降级保持 |
| L3-5 | **Inspector 右栏充实**：交付后右栏显示成品摘要卡 + 依据（经验 basis chips 复用）+ 对象工作区入口；Idle 空态文案保持 | `workbench-shell-layout.tsx:224-278` | interaction：delivered 相位右栏含摘要+入口 |

### L4 — `fix/dev-env-ci`：环境与验收门（scripts/CI/test）

| 项 | 内容 | 关键位置 | 验收判据 |
| --- | --- | --- | --- |
| L4-1 | **dev 档尊重 `.env`**：`createDevelopmentRuntimeProfile` 改为「默认值仅在未显式设置时生效」；显式 `MODEL_EXECUTION_MODE`/`APP_ENV` 等不再被覆盖；e2e/test 栈继续显式传 fixture（调用点显式传参，不靠覆盖） | `scripts/dev/runtime-profile.mjs:11-46`；核对 `scripts/dev/start-stack*` 与 playwright 栈调用点 | `pnpm dev` 下 Core 进程 env=direct+development（实测）；e2e 栈仍 fixture；smoke 全绿 |
| L4-2 | **dev:smoke 探针修复**：读实际运行栈的 DB（runtime 库）而非 `.env` DATABASE_URL 死值 | `scripts/dev/smoke-stack.mjs:13` | dev:smoke 对当前栈返回绿 |
| L4-3 | **P2 五文件 Chromium 进 CI**：`image-text-note-compiler`、`viral-adapt-opencli-gate`、`p2-browser-closure`、`admin-sensitive-words`、`composer-card-family` 建独立 CI job（fixture 档、fresh 双库），纳入 required | `.github/workflows/core-quality.yml`；`scripts/ci/` 新脚本 | CI 上该 job 绿一次；required 聚合含新 job |
| L4-4 | **journey 门补 XHS 主链**：`run-pr-production-journey.sh` 四 spec 扩为五，新增一键图文 e2e（提交→confirm→delivered→对象工作区） | `scripts/ci/run-pr-production-journey.sh:22-27`；新 spec 或复用 image-text-note-compiler 精简版 | journey 门本地跑 5/5 绿 |
| L4-5 | **台账诚实补记**：merge-ledger 补一行记录 #322 Chromium 欠账曾被静默转正的事实与本轮补验 | `docs/ops/merge-ledger.md:136` 关联 | 台账行落盘 |

### 验收阶段（主控，L1–L4 合入后）

| 项 | 内容 |
| --- | --- |
| A-1 | 逐 lane 行为审查 + focused suites + rebase 合入（顺序：L4 → L2 → L1 → L3，冲突面最大的最后） |
| A-2 | fresh PG 双库 Core 全量 + Web interaction 全量 + 双端 typecheck + biome |
| A-3 | journey 门（含 L4-4 新 spec）本地 CI 同构 env 跑一次 |
| A-4 | **真环境人验路径**：`pnpm dev:all` 起栈（direct + tuzi/ark + Langfuse remote），跑一条真实一键图文（真模型出文案+出图），核对 §0-1 掩盖已解除 |
| A-5 | R-8 截图基线：新形态 Idle/Active/Delivered 三态 `toHaveScreenshot` 基线建立（可 CI artifact 生成） |
| A-6 | merge-ledger 记账 + 本方案回填终态；push 待用户发话 |

---

## §3 明确不做（本轮外，防止范围爬行）

- pre-confirm 大纲编辑（R-4 后半，另开票）
- #325 纠错分流 producer（R-6）
- Waiting 独立阶段卡深化（spec 原文即「实施时定」）
- 定制模式显露 tone/role（现状为合同有意行为，contracts:127-141）
- Cloudflare 实际部署（等 §5 供给）
- 300+ Postgres 测试残留库清理（运维动作，可随手做但不算本方案项）

## §4 已排除项（复核证实健康，勿重复排查）

- Langfuse prompt 面：remote 22 pins 实测可达；builtin 即美业改写完整版（双写）
- DB provision：migration + 违禁词 baseline 全自动幂等，旧库升级不缺数据
- 交底诚实度：#325/#328 票面自陈准确

## §5 供给清单（用户侧，一次补齐，不阻塞 L1–L4）

| 项 | 用途 | 去处 |
| --- | --- | --- |
| CLOUDFLARE_ACCOUNT_ID / API_TOKEN / DATABASE_ID / DATABASE_URL | 打通 deploy.yml | GitHub Actions secrets |
| LANGFUSE_* + LANGFUSE_PROMPT_VERSIONS | 部署态 prompt pin（本机已有） | GitHub Actions secrets/variables |
| OpenCLI companion 部署（注入 `window.__MEIYE_OPENCLI_BRIDGE__`） | 爆款复刻链接轨转正 | 桌面侧交付物，仓外 |
| release-manifest 触发策略裁决（push 是否产 manifest / e2e 是否上 push 门） | 全量 e2e 可达性 | 用户拍板 CI 成本 |
