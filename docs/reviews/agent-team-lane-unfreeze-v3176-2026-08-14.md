# EXEC-00c / V31-76 — remix overwrite + continue-item

- Date: 2026-08-14
- Ticket: `docs/tickets/v3.1/V31-76-day0-spec-unblock-discovered-reds.md`
- Review: `docs/reviews/v31-agent-team-product-deep-review-2026-08-13.md` EXEC-00c
- Committed HEAD: `0a6934089a160a0f0cc3ffc084d42466d47140e2`（工作树脏，本票只动 remix / continue 缝）

## Diagnosis

### Red 1 — 二次 remix 草稿不覆盖：**产品缺陷**（spec 索引没过期）

`sampleStores[0]` = 护发 / 头皮护理，`[2]` = 生发 / 养发护理，`contentPreviews[1]` = 抖音「养护要做多久才看得出来」。种子与 spec 一致。

根因是 D-C1「空填入、脏不碰」被套在示例店 remix 上。第一次「复用这条结构」把草稿写满后，第二次 `onPrefill` 走 `applyRecommendationHandoff`，看见已有 `userText` 就原样留下（头皮护理）。同页 `sessionStorage` 不会发 `storage` 事件，单靠 setItem 也通知不到 Composer。

这不是商家手打的句子，是又一次显式复用。芯片继续 D-C1；remix 必须 `replaceText`。

Playwright 第一次跑过了原死点 `:205`：切生发再 remix 后，输入框已是「做一条抖音美业内容，主题是养发护理…」。

### Red 2 — `continue-item` 不可见：**spec 过期**（产品已对）

`dashboard-continue-section.tsx` 仍有 `data-testid="continue-item"`。有真实 work 时 `dashboard-section-continue` 会挂上，但 Idle 默认是一行提醒（`activity-shelf-expand`），卡片和 continue-item 在展开后才渲染。P1-3 / D6 就是这个脸。spec 造了真实 copy work，断言了 section，却没点展开。testid 没改名，也不是空态隐藏整段。

### `:212` 「先核对信息」（V31-74 residual）

原死点 `:205` 解开后第一次执行到提交钮。产品是 D-081：remix **不**默认选镜头，钮是禁用的「选择创作类型后继续」。选「文案」后 accessible name 变成「先核对信息」（本机第三次跑已看到该 name）。spec 已改成：先断言禁用镜头门，再 `selectComposerLens('copy')`，再断言「先核对信息」。

## Files changed

Product

- `mkfast-template-main/src/product/recommendation-handoff.ts` — `replaceText`、`replaceComposerDraftText`
- `mkfast-template-main/src/product/dashboard-home-surface.tsx` — remix `prefill({ intent, replaceText: true })`
- `mkfast-template-main/src/product/creation-entry-model.ts` — 同页 `meiye:creation-draft-intent` CustomEvent
- `mkfast-template-main/src/product/composer/composer-home.tsx` — listener 走 `replaceComposerDraftText`；undo 文案认 `replaceText`

Spec

- `mkfast-template-main/tests/e2e/specs/uiux-creation-loop.spec.ts` — 二次 remix 后先过镜头门；`test.setTimeout(180_000)`
- `mkfast-template-main/tests/e2e/specs/dashboard-home-mount.spec.ts` — 先点 `activity-shelf-expand` 再找 `continue-item`

Locks

- `recommendation-handoff.test.ts` / `creation-entry-model.test.ts` / `dashboard-home-contract.test.ts`
- `creation-draft-intent.interaction.test.ts`（同页二次 write → event → replace）
- `dashboard-continue-section.interaction.test.tsx`（收起无 continue-item，展开才有）

未动 Goal CRUD / EXEC-07b / EXEC-03b。

## Tests run

绿

- `tsx --test` recommendation-handoff / creation-entry-model / dashboard-home-contract / dashboard-home-surface / activity-shelf — 61 pass
- `vitest run` `creation-draft-intent.interaction.test.ts` + `dashboard-continue-section.interaction.test.tsx` — 9 pass

Playwright（`PLAYWRIGHT_PROVIDER_FREE=true`，栈能拉起）

| 用例 | 结果 |
|---|---|
| `uiux-creation-loop`「today recommendation follows…」 | 绿 |
| `uiux-creation-loop`「E0 example is opt-in…」 | 二次 remix 覆盖已绿（过 `:205`）。后续：镜头门 / 「先核对信息」name 已走到；整档被本机 Postgres `53300 too many clients already` 打断，submit enabled / 隐藏示例未稳定绿 |
| `dashboard-home-mount`「never told it produced nothing」 | 未到 continue-item。死在 `submitPrefilledCopy`：`Harness prompt resolver did not return the pinned Skill prompt`（Langfuse unconfigured + Skill pin）。不是货架契约 |

未跑 42-spec 门，也未宣称两份 spec 整档绿。

## Remaining blockers

1. **本机 e2e Postgres 连接耗尽**（`53300`）。Web/Core 500，submit 会在「先核对信息」上保持 disabled。不是 remix 覆盖逻辑。
2. **Skill pin / Langfuse unconfigured**。有真实生成的 mount 腿过不了 `submitPrefilledCopy`，continue-item 的浏览器断言被挡住。货架契约已用 interaction 锁住。
3. **整档绿未核销。** 产品/契约侧该修的已修；`:212` 回写 V31-74：name 已首次执行且为「先核对信息」；enabled+点发送+事实卡仍欠一次干净栈。

主控：V31-76 产品判定已闭合（红 1 修产品，红 2 改契约）。门绿仍欠仪器，不把本票重新派成 Goal / 07b / 03b。
