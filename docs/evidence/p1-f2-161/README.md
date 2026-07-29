# P1-F2 / #161 连续旅程验收证据

> **Issue**: [#161](https://github.com/leelv007-cmd/meiyeweb-agent/issues/161) — `[P1-F2] P1 生产构建视觉、无障碍与连续旅程总验收`  
> **规格**: `docs/specs/beauty-marketing-agent-p1-productization-spec-2026-07-22.md`  
> **Harness**: `mkfast-template-main/tests/e2e/specs/p1-f2-acceptance.spec.ts`  
> **Catalog**: `mkfast-template-main/tests/e2e/TEST-CATALOG.md` §35

## 主验收 seam（诚实口径）

| 项 | 口径 |
|---|---|
| 浏览器 | Playwright Chromium，登录用户 |
| 传输 | 公共 App Shell BFF → Core **HTTP + SSE**（`/api/core/p1/commands`、query、copy stream） |
| 模型边界 | `MODEL_EXECUTION_MODE=fixture`（recorded / 确定性 adapter） |
| **不是** | 前端 fixture short-circuit、组件树单测截图、mock store 作为完成证据 |
| **也不是** | live Provider、真实平台发布、#147 P0 staging RC |

`MODEL_EXECUTION_MODE=fixture` 仍走真实 Web → Core → Worker 路径；它证明 **recorded 功能合同**，不证明 live 模型或门店经营结果。

## 运行命令

在仓库根目录先保证本地 Postgres（`compose.yaml` → `127.0.0.1:54329`）可用，然后：

```bash
# 默认：Vite e2e mode + Core + Worker + Canvas（recorded MODEL）
cd mkfast-template-main
pnpm e2e -- tests/e2e/specs/p1-f2-acceptance.spec.ts

# 生产构建候选（Wrangler quality + build），更贴近 #161 production-build 口径
PLAYWRIGHT_PRODUCTION_CANDIDATE=true \
  pnpm e2e -- tests/e2e/specs/p1-f2-acceptance.spec.ts
```

相关对照回归（已有，不重复发明）：

```bash
pnpm e2e -- tests/e2e/specs/ui-journey-three-modal.spec.ts
pnpm e2e -- tests/e2e/specs/uiux-day0-contract.spec.ts
pnpm e2e -- tests/e2e/specs/uiux-precutover-baseline.spec.ts
```

## 七条旅程覆盖矩阵

| # | 规格旅程 | Harness 覆盖 | 说明 |
|---|---|---|---|
| 1 | Day-0 Landing→恢复→提交→首结果 | **部分** | Landing intent 捕获 → 登录后 `landing-handoff-restore` 确认、**不自动提交**；完整「最小事实单问→首 token」仍由 `uiux-day0-contract` 硬门 |
| 2 | 文案 close-loop | **是** | copy Result → adopt → canonical ContentPackage 手工编辑 → 完整发布包下载 → 人工发布记录 → 结果 chip → 周复盘下一轮 |
| 3 | 图文 | **是（到交付）** | image_text Result → adopt → 小红书 ZIP；套图 working selection 细项仍由 P1-B3 专项 |
| 4 | 视频 | **是（到交付）** | video Result → adopt → 抖音 ZIP；单镜重生成细项仍由 three-modal / P1-B4 |
| 5 | 历史 legacy 按需 anchor | **残余** | 无稳定 seed 的 legacy Content 浏览器路径；Content 列表 merchant-language + axe 已覆盖 |
| 6 | 撤权→待替换→安全替换 | **残余** | 模型/单测有 governance 投影；库内未见完整「撤回→受影响→替换→新交付」浏览器旅程 |
| 7 | 结果复盘 / 周复盘 | **是（挂在 copy close-loop）** | `publication-record-panel` + `outcome-chips-panel` + `weekly-review-panel` |

## 无障碍 / 响应式 / 动效

| 门 | 状态 |
|---|---|
| axe serious/critical = 0 | Composer / Result / Content / Assets / Delivery / Tasks(Weekly shell)；light + dark（及 mobile dark Result） |
| 320 / 375 / 768 / 1440 | Result 横向溢出 ≤1px；主 CTA 不整块掉出视口 |
| 200% zoom | Result 在 720×450 + `zoom:2` 下无横向阻断 |
| prefers-reduced-motion | Result + Delivery 可用；不依赖动效单独表达状态 |
| Save-Data / 低功耗 | **残余**：产品面无 `data-save-data` / Save-Data 业务钩子 |
| 键盘 Tab / focus trap | 沿用 `uiux-keyboard-governance` + 各 panel 既有合同；本 harness 不重复整套键盘矩阵 |
| VoiceOver 人工 | **残余**：见下方清单 |

### VoiceOver 人工清单（残余，需真机）

1. Composer Lens radiogroup 与 Recipe 卡片角色/状态  
2. 流式文案：节流播报 + 完成一次礼貌播报  
3. 图文媒体角色（主图/封面）与视频播放器  
4. Result ProductStatus 状态变化  
5. 系统分享不可用时的降级说明  
6. 结果 chips 与阶梯「未知」语义  

## 商家语言诚实

Result / Content / Assets 等本 harness 断言的表面拒绝：

- UUID  
- raw enum（`running` / `ready` / `internal_only` 等）  
- provider / model slug（`seedance-2`、`gpt-image`、`llm-openai` 等）  
- `workId=` / `assetId=` 等工程泄漏  

## 已知限制 / 阻塞

1. **#147 P0 RC staging**：未伪造；本 harness 不宣称 staging RC 通过。  
2. **live Provider**：不在本 suite；需独立 protected gate。  
3. **legacy / 撤权** 两条浏览器旅程未闭环（见上表）。  
4. **Save-Data** 无产品钩子。  
5. **VoiceOver** 需人工。  
6. 默认 `pnpm e2e` 使用 Vite e2e mode；完整 production-build 请加 `PLAYWRIGHT_PRODUCTION_CANDIDATE=true`（更慢，依赖 wrangler quality 配置）。  

## 绑定字段

| 字段 | 值 |
|---|---|
| commit | 见本工作区 `git rev-parse HEAD`（落地 PR 时绑定） |
| 构建 | Vite e2e mode（`pnpm e2e`）；production-candidate 可选 |
| 浏览器 | Playwright Chromium |
| viewport / 主题 | 见各 test 名称（含 320/375/768/1440、200% zoom、light/dark） |
| 种子 | `seedConfirmedStore` + E2E 用户 `e2e-*@example.test` |
| 模型 | `MODEL_EXECUTION_MODE=fixture` + recorded integrations（公共 HTTP+SSE） |
| 最近跑通 | **2026-07-23 · 8 passed (2.4m)** · 主会话接管 Agent B 后复跑全绿 · `pnpm exec playwright test p1-f2-acceptance.spec.ts` |

### 本轮跑通摘要

```
✓ Day-0 Landing intent handoff restores into Composer without auto-submit
✓ Copy continuous close-loop: Result → adopt → delivery → publication → outcome → weekly next
✓ Image-text continuous: Result → adopt → delivery package
✓ Video continuous: Result → adopt → delivery package
✓ Content + Assets surfaces stay merchant-safe and axe-clean in light and dark
✓ Responsive smoke: 320/375/768/1440 and 200% zoom on Result
✓ prefers-reduced-motion keeps Result and Delivery usable
✓ Mobile dark Result stays free of horizontal overflow and dead primary CTA
8 passed (2.5m)
```

### 本 harness 顺带修复的产品问题（非 short-circuit）

1. **Result close-loop `variantVersionId`**：原先绑定 variant 实体 id，人工发布 `CONTENT_PACKAGE_VARIANT_NOT_FOUND`；改为 `variant.currentVersionId`。
2. **人工发布 Idempotency-Key**：过长/含非法字符触发 `INVALID_IDEMPOTENCY_KEY`；改为 `pub.<platform>.<rev>.<fingerprint>.<uuid>`（header-safe，不嵌入 URL/中文）。
3. **Sonner success toast 对比度**：richColors 成功态约 4.25:1 → 加深文字以满足 WCAG AA 4.5:1。
4. **ui-journey lens 断言**：原生 radio 使用 `toBeChecked()` + `data-state`，不再误依赖 `aria-checked` 属性。
