# 能力基线盘点（第一轮，2026-08-13）——只定性不修

> 历史证据快照。走查代码树 `0487afd9`（文档 commit 除外），环境=本机 dev（web:3000 vite、
> Core:4100 盘点专用 fixture 实例、PG 54329）。账本回写见
> `docs/ops/capability-ledger-2026-08-13.md`；整改票 V31-78–V31-82。
> 结论按「可用/降级可用/不可用/未走查」四态；fixture 档结论均带「行为面为准、
> 生成内容不作数」限定。

## 0. 最重要的三条结论

1. **环境本身是第一颗雷**：4100 端口被一个 launchd 常驻守护（`com.meiye.core-test.plist`，
   KeepAlive）的 e2e fixture Core 占据多日，其业务库指向 **54330**，而 web 与注册数据在
   **54329**——所有人以为在「dev 真栈」上的走查（含 08-13 早的三票走查）实际对着一个
   错库假 Core。「积分 100→0 泄漏」疑云就此撤案：**DB 权威账本一分未动，是读到了另一个库**。
2. **新商家注册可被整号砖死（P0，V31-78）**：model-default provisioning 步骤失败一次
   （本例=平台默认模型未配置），module command 悬死 pending → 该 workspace **所有**
   Core 请求恒 500（含积分 pill、works 页），outbox 以每次页面加载数十次的频率热重试
   （90 秒 354 次），无退避、无终态、无任何 UI 呈现。确定性复现 2/2（盘点二号、三号）。
3. **付费图文链在真栈上悬死（V31-82）**：C4 fallback 配方提交后 20 分入 USAGE、
   首版可见，但 work 永停 `running`（15 分钟+），无失败投影、钱无出口；
   mid-run steering 提交直接报英文裸错 `No admitted execution plan exists for
   task composer-task:…`（V31-81，C8 不可用）。

## 1. 逐能力结论（本轮走到的）

| 能力 | 本轮结论 | 关键证据 |
|---|---|---|
| C1 首访 | **修复中→行为面确认**：图文选中即前置提示「点发送会先告诉你怎么补，不会开始生成」、引导卡双出口＋「没开始的创作不扣积分」、fallback 保留已输入 prompt；「接着上次」continue 项在真账号上有渲染（V31-76 红 2 更像 testid 契约而非渲染缺失）。**但注册链引入更前置的死路（V31-78）** | 盘点四号全程；V31-73 修复行为逐项复核 |
| C2 免费创作 | 维持**降级可用**（fixture）；本轮未单走（C3 路径覆盖其大半） | — |
| C3 Level 1 copy | **降级可用，带两条违约**：链路通到交付/工作区/自报入口，报价 chip 常显、1 分 USAGE 正确落账；但 ① **出了确认卡**（规格 §37.4-B 承诺免确认直达，§43 门 5「简单任务不因升级变复杂」疑违约）；② 时间线「结果」行直出内部指令（「不得偏离 ExecutionPlanSnapshot」等） | 盘点四号 copy 单；lot 流水 USAGE 1 |
| C4 定制图文 | **不可用（fixture 档，带环境限定）**：确认→扣 20 分→首版卡可见后 work 悬死 running，无终态、无失败投影、无退款；配对 worker 补上后也不恢复 | work-cd980cd4 悬死；`p1_generation_jobs` 无 image 任务生成 |
| C6 计费可信 | **定性反转＋新洞**：「泄漏」撤案（读路径错库）；正确链上 grant/usage 记账均正确、pill 正确；但 ① credits 页在断链账号上显示空表无兜底；② C4 悬死单的 20 分无出口（V31-41 域）；③ 明细 UI 在健康账号上的行渲染本轮未来得及复核 | lots/transactions DB 对账；三账号对照 |
| C8 steering | **不可用**：运行中提交调整报 `No admitted execution plan exists…` 英文裸错＋内部 task id 直出（Wave-4 证伪 AC1 在当前 main 的复现） | 盘点四号 image 单 steering 实测 |
| C12 发布交接/自报 | 入口实存（结果页「发布记录」区：人工补记＋发出去了/没发成功/不太确定＋账号/时间/链接）；完整旅程未走完 | 结果页快照 |
| C16 原位生长 | 工作区可开、可编辑、选区 AI/快捷微调/平台预览在位；fixture 档成品标题=内部指令拼接长文（fixture 保真度问题，live 档待验） | work-3095 工作区 |
| 其余（C5/C7/C9/C10/C11/C13/C14/C15/C17） | **未走查**（本轮时间耗在环境定性与 P0 取证上） | — |

## 2. 环境与仪器发现（全部记 V31-79，除已注明）

1. `~/Library/LaunchAgents/com.meiye.core-test.plist`：e2e Core 常驻守护，已 `launchctl bootout`
   卸载（**plist 文件保留未删**，等用户确认来源后处置）。它 KeepAlive 复活过两次（40 秒节流）。
2. **当前 main 的 `pnpm dev` Core API 起不来**：`.env` 是 `APP_ENV=development` +
   `MODEL_EXECUTION_MODE=direct`，boot 时 `Harness production runtime requires a live
   direct structured model`（activation 无 live 探针核销）——即 dev 档在本机断裂多日，
   被 launchd 假 Core 掩盖。
3. **平台默认模型在 54329 从未配置**：Day-0 provisioning 硬依赖它（V31-78 的触发因）；
   e2e 靠 `E2E_PLATFORM_DEFAULT_MODEL_*` 四件套 env 兜底（值见 playwright.config.ts）。
4. **孤儿进程动物园**：已删 worktree `美业内容2-v31-fix-03` 的 Core 跑了 3 天 14 小时；
   凌晨 4:22 的 Playwright headless 残浏览器仍存活（未清，等用户确认）。
5. web dev 栈两度倒在 undici `fetch failed` SSR overlay（已知病，本轮盘点被它中断一次、
   收尾被它挡住一次）。
6. 盘点用 Core 配方（可复用）：`APP_ENV=e2e MODEL_EXECUTION_MODE=fixture
   INTEGRATION_SECRET_STORE_MODE=recorded BYOK_MODEL_BINDINGS=e2e-placeholder=e2e-placeholder
   HARNESS_DBOS_SYSTEM_DATABASE_URL=…54329/meiye_dbos E2E_PLATFORM_DEFAULT_MODEL_*=四件套
   node --env-file-if-exists=../../.env --import tsx --eval "await import('./src/runtime-entry.ts');"`
   （worker 同 env 加 `worker` 角色；`--env-file` 在后、shell env 优先）。

## 3. 展示层新发现（记 V31-80，V31-75 家族二波）

1. 时间线「结果」行与成品标题直出内部指令文本（含 `ExecutionPlanSnapshot`）。
2. 右栏上下文把 `work-<uuid>` 裸串给商家看。
3. 方案卡在执行后仍显示活跃「返回修改/开始制作」（§39 六态「已经确认/已经执行」未投影）。
4. 多 Work 场景下同一句 prompt 双叙述气泡复发（V31-75 第 3 项修的是单 Work 场景）。
5. 「本次约消耗 20 分」与「本次用量已确认」两句同屏并存（V31-74 收敛在确认卡路径疑似失效）。
6. 方案卡「已绑定 2 项事实用法」vs 工作区「暂无关联事实」互相矛盾（零事实账号）。

## 4. 本轮未决与下一轮

- 病因修复后被砖账号能否自愈（lease 到期重试理论上应愈）：被 web 栈倒掉挡住，**未测成**。
- C5/C7/C9/C10/C11/C13/C14/C15/C17 待第二轮走查（环境配方已固化，下轮成本低得多）。
- C4 悬死是否环境特有（e2e 门自己的栈上该旅程有绿史）：待在 e2e 原生栈复跑分辨。
- 测试账号：盘点四号（capability-audit-d-0813@example.test / AuditPass123!，99→79 分）
  为当前唯一健康走查号；二号/三号为砖号取证样本，**勿修复勿删除**（V31-78 复现体）。
