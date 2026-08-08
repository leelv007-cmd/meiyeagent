# V31-18 — Memory 扩列 + 双通道 + observation pipeline + 注入透明

**Parent**: spec-E（#5）`docs/specs/v3.1-agent-specs-2026-08-08/spec-E-432-memory-evidence.md`；权威 V3.1 §12、U4/U5
**Lane**: Memory 并行 lane（不阻塞批次 2-4 主线）｜ **语义锁**: 与 V31-19 同 lane 串行或双 worktree
**Blocked by**: V31-01（**working 切片内部另等 V31-06 的 checkpoint 单 writer**；preference/correction 切片可先行）
**Status**: done (merged f190a7cf, 2026-08-08)

## What to build

现有 preference 三表扩列（kind/authority/scope/decay/state）；五层认知分类；authority 双通道（Thread 内即时生效／跨 Thread 候选→商家确认，Extractor 经 onExtracted 落候选绝不直接生效）；working memory 抽取/投影策略经 V31-06 单 writer 落盘；检索只在合法 scope 最窄组合内排序（向量相似度永不决定 workspace/rights/fact/authority）；MemoryInjectionReceipt 注入清单可见可撤销；分离删除（A11 四类实体各自策略）；历史迁移只产 proposed。

## Acceptance criteria

- [ ] 跨店泄漏=0；Business Fact 被 Memory 覆盖=0（放行门）
- [ ] correction recurrence=0；false persistence=0
- [ ] 注入清单可见且撤销后不再注入（Playwright §37.4-B2）
- [ ] 删源对话→条目标「来源已删除」；删 memory→ApprovalReceipt 保留
- [ ] retrieval precision 有离线评测
