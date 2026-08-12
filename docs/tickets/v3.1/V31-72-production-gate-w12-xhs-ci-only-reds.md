# V31-72 — production 门仅存两条 CI 真红：w12 360s 超时＋xhs SSE 断流注入未确认（本地恒绿，CI 2/2 复现）

**Parent**: 浏览器门收口（V31-70 治愈实证后 production 门的残余真红）
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-70（治愈让这两条第一次可见）、V31-62（AC4 同形态 transport 观察）、V31-28（dev 传输悬案 follow-up）

**Status**: open（2026-08-12）— 两条各有连续两轮 CI 数据点（runs 31587057598 / 31589105737），本地恒绿；根因未定，待 CI 形态复现路径

**Implementation state**: not-started
**Verification state**: not-started
**Evidence SHA**:
**Workflow Run**:
**Artifact Digest**:

## 为什么开票

V31-70 的 supervisor 治愈让 production 门连续两轮（f171b41d / 093b1421）18 specs 全部拿到判决——此前 workerd 一死整门「did not run」，这两条红根本不可见。现在它们是该门仅存的真红，且**两轮同位复现**：

| spec | run 31587057598 | run 31589105737 | 形态 |
|---|---|---|---|
| `w12-identity-draft-assistant.spec.ts:104` | failed（retry 耗尽） | failed | `Test timeout of 360000ms exceeded`（整案超时，非断言红） |
| `xhs-image-text-main-journey.spec.ts:63` | failed @:144 | failed @:144 | 交付本身走通（note ready、artifact 卡断言全过），红在自带断流注入编舞：`expect.poll(() => streamFaultApplied)` 5s 不为真——首个 `/agent-threads/*/events` 请求带 `e2eAgentFault=artifact-gap-close` 参数，但响应未见 `x-meiye-e2e-agent-fault-applied` 回执头 |

两者本地全绿（xhs 34.6s、w12 常绿；见 V31-62/V31-28 留档）。上上轮（dca572a3，16 passed）w12 曾绿，xhs 未评估——xhs 的 CI 数据点只有这两轮，w12 为 2/3。

## 线索与边界

- 形态族：与 V31-28 lane 定界的「dev 传输悬案」（Core 已响应、页面 fetch 恒不归）及 V31-62 AC4 风暴前红（`result_adjust_prepare` waitForResponse 60s 不归）同族——**都是 CI 负载下页面侧请求/回执丢失**，后端留痕健康。
- xhs 断言链位置说明 fault 注入依赖「交付后 workbench host 首开 agent-threads SSE」的时序；CI 慢机上若首开发生在交付之前/之后的不同窗口，`eventCalls===1` 拦到的可能不是 Core 会应用 fault 的那次调用。先验证时序假设再改产品或改 spec。
- 与 V31-28 六腿改的 `workflow-events`（`/p1/workflows/*/events`）是**不同端点族**（agent-threads SSE），回归嫌疑已排除。

## 工作路径

1. 拉两轮 trace/artifact（error-context + har）核 xhs 首个 events 调用的时序与响应头，判「Core 未应用」vs「应用了但页面没收到」。
2. w12：拉 trace 定位 360s 卡点（哪一步不前进），与 CDP CPU 节流本地复现对照。
3. 按定性分流：spec 合同问题→改编舞；产品 SSE/传输问题→并入 V31-28 follow-up 或独立修。

## 验收

- [ ] 两条红各有定性（时序证据在案）
- [ ] 修复后 production 门连续两轮全绿（或仅剩 workerd 治愈警告）
