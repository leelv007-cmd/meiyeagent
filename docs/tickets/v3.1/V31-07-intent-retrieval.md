# V31-07 — Intent interpreter + ambiguity policy + 检索 tools

**Parent**: spec-B（#2）；权威 V3.1 §17–§20
**批次**: 2 ｜ **语义锁**: 同 06
**Blocked by**: V31-06
**Status**: done (merged, 2026-08-08)

## What to build

模糊目标→检索门店事实/素材/身份/历史（turn 内 tools，工作流化合并非端点化，检索类带 response_format）→可见假设→高影响歧义每轮最多一问（问题预算 Intent/Plan 各 1）；模糊适配由「影响类别×可逆性×权威来源」决定；Day-0 自由创作事实分层（free 不被 confirmed_store/project 阻断，D-175 沿用）；主动度设置（稳妥/平衡/主动）。工具注册表 sideEffect/riskClass/approval/allowedPhases/maxCalls/timeout。

## Acceptance criteria

- [ ] 已有信息不重复询问；每轮最多一个问题（批次 2 退出门）
- [ ] 假设可见且低风险默认可逆
- [ ] Day-0 零门店商家可达安全通用结果（Playwright §37.4-A）
- [ ] 权利与事实高风险不被 LLM 默认
- [ ] 工具面治理字段齐备并有拒绝理由投影
