# V31-58 — 素材撤权后商家终态文案不出现

**Parent**: V31-14 AC3（素材撤权 fail closed）；旅程见 §37.4-F
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-29（已核对无实施交集）；V31-49（本 browser spec 的建票来源）；V31-55（旧 admission 签名已清零，本红为换形后的独立症状）
**Status**: open（症状+证据落票，终态产出/传输/投影根因未查）

## 症状

`v31-rights-revocation-journey.spec.ts` 在 Plan 形成后撤权，再点击 Make 开始。旅程直接等待 `composer-terminal-outcome` 包含「授权已撤销」，180 秒后该元素仍不存在，因而未能继续验证退回预留、换素材恢复与只扣一次。

当前证据只能证明**商家可见的 terminal outcome 未出现**，不能从「元素不存在」反推 Core 没有 fail closed、没有 refund，也不能先入为主判定只是文案字面不匹配。

## 与 V31-29 的交集核对

本红**不归 V31-29**：

- 该 spec 从 `ui-journey.ts` 只导入 `selectComposerLens`，没有调用 V31-29 所有的 `submitComposerJourney` / `chooseImageTextDirection`，因此不经过那三处「失败终态可当成成功」的共享 helper。
- 失败断言在本 spec `:189-190`，直接定位 `composer-terminal-outcome` 并断「授权已撤销」，没有 `.or(success)`、early return 或接受任意终态的假绿分支。本次红灯本身是诚实的。
- V31-29 的修改面仅是 `tests/e2e/fixtures/ui-journey.ts`；本票要追的是 rights safe-stop 到 Composer terminal turn 的生产链。把两者合并会让「fixture 不再假绿」被误当成「撤权终态已对商家出面」。

## 证据

- 锚树：集成树 `d3e29ee0f`。
- 旅程直接断言：`mkfast-template-main/tests/e2e/specs/v31-rights-revocation-journey.spec.ts:179-190`。
- 终审 v2 日志：`scratchpad/w4d/w4-final-v2/round-per-spec/v31-rights-revocation-journey.log:143-170`；结果 `1 failed`，`composer-terminal-outcome` 元素 180s 未找到。
- Core 已有的局部证据：`apps/core/src/p1/harness/context-fence.ts:140-141`产生「素材授权已撤销，已安全停止且不会重复扣费」；`dbos-workflow.test.ts:1818` 覆盖 safe-stop refund 且不 commit。这些只证明内核有能力，不证明真浏览器的 terminal turn 产生并投影成功。
- Web 渲染点：`mkfast-template-main/src/product/composer/composer-conversation.tsx:786-800` 仅在 session 已有 `terminal` turn 时渲染 `composer-terminal-outcome`。故实施时需要区分「Core 未写 terminal」、「terminal 未经 replay/SSE 到 Web」、「Web session 投影丢 turn」三段，不应直接改文案或改弱断言。

## Acceptance criteria

- [ ] 用一次可诊断复现区分 terminal 的生产、持久/传输、Web 投影三段，落明根因与 file:line
- [ ] 撤权后 Make 必须 fail closed，真浏览器显示商家可读的撤权/计划已变终态，不以技术错误或永久等待结束
- [ ] 同一旅程证明被拦的 Work 全额 refund、零 settlement，换成已授权素材后可恢复交付，整段只扣一次
- [ ] 针对根因有先红后绿回归，`v31-rights-revocation-journey.spec.ts` 真实 Playwright 转绿

## 本票不做什么

- 不改弱「授权已撤销」的商家语义，不用任意 failed card 替代。
- 不把 Core 单测绿当成 Composer 产品链已验收，也不在未查清前猜测是前端还是后端。
