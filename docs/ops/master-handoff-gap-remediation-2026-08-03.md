# 主控交接 Handoff — #313–#328 差距修复批（终态 2026-08-03）

| Field | Value |
| --- | --- |
| 交接原因 | 主控会话交接 → 继任主控收口完成 |
| 终态时刻 | 2026-08-03；local main tip **`310c71e6`**（未 push；origin/main 仍 `9b39e8ad`） |
| 权威链 | `docs/ops/gap-remediation-plan-xhs-313-328-2026-08-02.md` ＞ 本 handoff ＞ lane 报告 |
| 通用纪律 | `docs/ops/agent-dispatch-runbook-2026-07-29.md`；**push 一律待用户发话** |
| 本文件 | 入库（终态台账 commit） |

---

## 0. 一句话终态

四路复核 → 修复方案 → 五条 lane：**L1–L5 已合入 main（ff `6a93369d..310c71e6`）**；P2 五文件 **18/18**；台账已回填；A-5 截图基线记「待 CI」；**push 仍待用户发话**。

## 1. 集成链（已落 main）

`6a93369d`（方案）→ L4 → L2 → L1 → L3 → 主控 2c → L3b `3cef0ee9` → L5（`e01ca1bb`…`310c71e6`）

| Lane | 分支 tip | 内容 |
| --- | --- | --- |
| L4 | `4a55c3f3` | runtime-profile 尊重 .env；smoke 读 stack-state；P2 CI required；journey +XHS 主链 |
| L2 | `2f18f0d7` | thinking provider 键；standard→quality；poster 风格分析；AI 封面中文；aiCover 提示 |
| L1 | `ec185aa0` | 真单页重生；页级帧；running 时间线；确认卡大纲 |
| L3/L3b | `3cef0ee9` | R-1 顺序；底栏胶囊；六族 CSS；玫瑰金；Inspector；e2e 适配 |
| L5 | `310c71e6` | 四红：free+deep quote、credit settle、quota-passive 对齐、released-hold；attach 关面板 |

## 2. L5 四红定性（台账）

1. free+deep quote 合同不全 → **真产品缝**（`e01ca1bb`）
2. note 交付 credit 停 reserved → **真产品缝**（`06f9617c` settle）
3. quota-passive 静默 → **产品有意行为**，断言时代对齐
4. released-hold → **e2e mock 缺口** + product wire（`3c9b9d78` + snapshot mock）

附带：attach 胶囊 portal 拦截 viral「继续确认」→ `seedComposerInlineAuthorize` Escape 关面板（`310c71e6`）

## 3. 验收证据

| 门 | 结果 |
| --- | --- |
| Web interaction @ L3b | 410/410 |
| journey 5spec @ 集成链 | 9 passed |
| L1 单页重生 PG | 1/1 |
| product-billing unit | 49/49 |
| credit-billing unit（含 PG） | 49/49 |
| quote-service（含 settle） | 16/16 |
| **P2 五文件 Chromium** | **18/18（7.3m）** `/tmp/l5-main-full18b.log` |

## 4. 待完成项状态

| # | 项 | 状态 |
| --- | --- | --- |
| 1 | 收 L5 + 18/18 | ✅ |
| 2 | 集成 L5 | ✅ base 已是 `3cef0ee9`；ff 入链 |
| 3 | 合入 main + 台账 | ✅ `310c71e6`；ledger 回填 |
| 4 | A-4 真环境人验 | ✅ profile：`.env` → `MODEL_EXECUTION_MODE=direct` + `APP_ENV=development`（`createDevelopmentRuntimeProfile` 实测 + unit 10/10）；媒体供给应按 direct 装配（非 fixture 恒关）。未起 `dev:all` 真模型出图（预算/时长，不阻塞合入） |
| 5 | A-5 截图基线 | **待 CI 基线**（不阻塞合入） |
| 6 | push | **待用户发话** |

## 5. 明确不在本批

- CF deploy secrets / OpenCLI companion / release-manifest push 策略（方案 §5）
- pre-confirm 大纲编辑、#325 producer、Waiting 深化

## 6. 用户口径

- 主控验收；grok 执行 lane
- push 待发话
- 交互「哥」+ 中文；代码/commit 英文
