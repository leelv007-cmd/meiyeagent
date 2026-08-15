# V31-81 — C8 steering 断裂：composer 任务运行中提交调整报「No admitted execution plan exists」英文裸错

**Parent**: 能力基线盘点第一轮（`docs/reviews/capability-baseline-audit-2026-08-13.md` §1 C8）
**批次**: C8 能力收敛 lane（清红队列后）
**Blocked by**: V31-82 先定性（同一 work 的 admission/执行链悬死可能是共同上游）
**Related**: V31-27（Wave-4 已证伪 AC1，同族）、V31-16（steering 后端）、V31-28（composer 计划面接线）

**Status**: open（2026-08-13）— 盘点取证，未派工

**Implementation state**: not-started
**Verification state**: reproduced（盘点四号图文单运行中实测）
**Evidence SHA**: 0487afd99e724d6ca9ac3e0fccdecf3a32126ca0
Evidence 注：走查代码树；错误原文=`No admitted execution plan exists for task composer-task:45a954bf… in this workspace. 关联 ID：corr-d04f8fe0…`
**Workflow Run**:
**Artifact Digest**:

## 症状

图文单运行中，「中途调整」框填「封面别写价格，第二页文字少一点」提交 →
alert 直出英文技术错误＋内部 task id。规格 §37.4-G（改两页其余不动/replan+requote）
在 composer 主旅程上不可达。

## 定性方向（修前先答）

1. steering 服务查 admitted plan 用的 task 键与 composer 提交链写入的键是否同一空间
   （`composer-task:<hash>` vs work/run id）？
2. 该 work 本身 admission 是否从未完成（联动 V31-82 的悬死 running）——若是，
   steering 是受害者而非病灶，本票降级为错误呈现修复＋依赖 V31-82。
3. 错误呈现：无论根因，商家面必须是中文可理解文案，不得裸 task id/英文堆栈。

## Acceptance criteria

- [ ] 根因定性落票（键空间 vs admission 悬死 vs 其他），修复对应侧
- [ ] composer 图文单运行中 steering 生效路径 e2e（改一页、其余页保持）
- [ ] steering 失败路径的商家文案（中文、无内部 ID）＋interaction 测试

## 留痕

- 开票：2026-08-13 盘点第一轮。V31-27 的「前置步骤红、被测行为未走到」与本票同景不同层：
  本轮是真人走到了 steering 入口、后端拒绝——比 Wave-4 更进一步的定性。
