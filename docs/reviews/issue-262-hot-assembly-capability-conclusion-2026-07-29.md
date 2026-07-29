# Issue #262 hot-assembly 能力声明可承载性结论

日期：2026-07-29
范围：`apps/core/src/p1/supply-registry/hot-assembly.ts`、Harness 14 个 prompt 位点、Skill manifest 能力需求

## 结论

原有 hot-assembly **不能直接承载 D-165 的能力需求匹配**。它能按 capability revision 对 deployment 的 endpoint、credential、adapter、生命周期等运行时指纹做一致性校验，也能把不在有效 revision 内的 deployment 降为不可用；但输入只有 deployment 运行事实，没有 #252 的版本化能力 profile、位点需求轴、显式覆写和 unknown 决策结果。因此，原实现只能回答“这个 deployment 是否属于该运行时 revision”，不能回答“它是否满足本次 Skill／prompt 位点声明的能力组合”。

本票采用 KEEP + EXTEND，不建第二套 matcher：

- `ModelDeployment`、published capability entry、runtime assembly 贯通同一份 `capabilityProfile`。
- `matchRuntimeCapabilityRequirement` 消费 #252 的 `ModelCapabilityRequirementAxis`，输出 `eligible`、`ineligible` 或 `conservative_fallback`，并保留 `reasons` 与 `evidenceRefs`。
- 显式 capability override 优先于 profile 推断；显式 false 直接拒绝。
- 缺失 profile 或词表版本未知时不视为满足，返回 `capability_unknown`／`vocabulary_version_unknown`；调用方只可通过既有 platform-default resolver 进入 live-verified 的保守分支。
- Harness 14 个位点的 prompt 名称、operation 与 capability requirement 由 `HARNESS_PROMPT_SITES` 单一注册表派生；Skill manifest 的 `requiredModelCapabilities` 转为同一 requirement axis 后一并匹配。
- 匹配结果、保守回退事实和 capability revision 随 server-owned RouteSnapshot 冻结，执行相位只消费冻结值。

## 边界

- 不实现通用能力代数；位点所需组合仍是一个完整 axis。
- 不写死保守模型 ID；保守分支只消费 `platform-defaults.ts` 公共 resolver。
- 不把媒体 brief 位点误映射为媒体生成 operation；这些位点仍是 structured `text.respond`。
- 不建立第二套位点配置表，也不新建装配模块。

## 已实跑的聚焦证据

```text
pnpm --filter @meiye/core exec tsx --test \
  src/p1/supply-registry/hot-assembly.test.ts \
  src/p1/harness/langfuse-prompts.test.ts

25 pass / 0 fail / 0 skip
exit 0
```

覆盖：显式覆写、unknown 保守决策、动态 revision 指纹、14 位点注册表唯一性，以及 OCR 对 `textResponse` 的按需图像模态扩展。
