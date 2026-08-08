# V31-21 — HarnessRelease 三对象 + controlLimits 绑定 + canary + rollback

**Parent**: spec-G（#7）；权威 V3.1 §29、U10/U11
**批次**: 5
**Blocked by**: V31-01, V31-20（**集成验收**另需 V31-06 消费 release pin、V31-14 执行链记 releaseId）
**Status**: ready-for-agent

## What to build

HarnessRelease=不可变 Artifact（prompt/schema/skill/tool/model/fact/rights/budget/eval bindings+planSchemaRevision+middlewareBindings+**controlLimits 全量标定值**+manifestHash）/Lifecycle/Rollout 三对象；任一 limit unset→发布失败；per-run 试跑只能选完整 immutable candidate releaseId（禁字段级覆写，U10）；首发灰度=workspace allowlist+candidate 试跑；回滚=新任务切回旧 release、在途保持冻结；任务/Plan/Trace 全记 releaseId。

## Acceptance criteria

- [ ] releaseId 恒指唯一 manifest（immutability+manifestHash 断言）
- [ ] 任一运行能还原 exact release；rollback 不改任务内 prompt
- [ ] unset limit 拒发布；resolver 返回非空 controlLimits
- [ ] Playwright §37.4-J：canary 命中候选/非 canary production/rollback 语义
- [ ] release diff 可读
