# V31-38 — PlanCompiler 的 recipe / source / catalog / skill 端口换成真权威

**Parent**: V31-09（Plan Compiler）/ Task 7（Real Session Intent）
**批次**: 收尾（**post-merge**）
**Blocked by**: V31-25 合入（语义锁：同触 plan-compiler 面，禁与 runner 收敛票并行）
**Status**: open

## 为什么现在不做

Task 7 已把 quote / rights / models 三个端口换成真权威并有测试背书，剩下的 recipe / source / catalog / skill 四处仍是合成值。裁决（主控 R2，2026-08-09）：**option 2 = post-merge 再做**，理由是这四处都落在 `plan-compiler-production-ports.ts` 同一段，而 V31-25（runner 收敛）正在改同一文件面，先做必然撞车。本票只留证据与验收合同，不在本轮实施。

## 现状（锚署树：worktree `美业内容2-v31-fix-07`，`apps/core/src/p1/agent-session/plan-compiler-production-ports.ts:189-218`）

四处合成值，按危害排序：

1. **`skillRevisionRef` 是伪造收据**：`` `${PLATFORM_BEAUTY_COPYWRITING_SKILL_ID}@plan_compile` `` 拼出一个不存在的 revision，`contentHash` 取 `fingerprintValue({...}).slice(0, 32)` 现算。计划因此声称自己钉住了一个技能版本，而那个版本号从未被任何技能权威签发过——下游若据此判「同技能同版本可复用」，会复用一个不存在的东西。
2. **`catalogRevisionId` 静默兜底成字面量** `'creation-experience-catalog'`：真 catalog revision 缺失时不报错，计划带着一个假 revision 通过。
3. **`recipeRevisionIds: []`**：配方来源在计划上不可见，"这版计划依据哪个配方" 无法回答。
4. **`sourceRevisionIds: []`**：同上，素材/来源 revision 不进计划。

2、3、4 是缺失（fail-open），1 是**主动编造**，实施时先修 1。

## 实施范围

- recipe / source / catalog：从已有的 CreationExperience 仓储与 submission snapshot 的真 revision 引用取值，缺失即 `INVALID_STATE` 抛错，不兜底。
- skill：接技能权威（platform skill manifest）的真 revision 与真 contentHash；权威无此技能时 fail closed，禁止现算 hash 冒充收据。
- 一并删掉 `fingerprintValue(...).slice(0, 32)` 这条现算路径，避免下一个人照抄。

## Acceptance criteria

- [ ] 四个端口零合成值：`grep` 不到 `@plan_compile`、不到字面量 `'creation-experience-catalog'`、不到空数组直接返回
- [ ] 每个端口都有一条 RED→GREEN：权威缺失时 compile 抛错（不是产出一个带假 ref 的计划）
- [ ] 一条测试证明 `skillRevisionRef` 的 revision 与 contentHash 来自权威返回值（改权威返回值，断言随之变）
- [ ] 计划 revision 上能读出真 recipeRevisionIds / sourceRevisionIds（非空且等于 submission 的真引用）
- [ ] 与 V31-25 合入后的 `plan-compiler-production-ports.ts` 无冲突（本票开工前先 rebase）
