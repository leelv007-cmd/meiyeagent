# #320 P2-08 交底 —— 违禁词库、生成链检查条与运营 CRUD

- 分支：`leelv007-cmd/lane-320`（worktree `/Users/bin/orca/workspaces/美业内容2/lane-320`）；**未 push、未关票**，合入与 P1/P2 门禁由主控核验。
- 规格锚：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §4.6 / §6.3 / §8 P2-3 / §10.3-2。
- 语义锁属主：`sensitive_words` 词库 / 生成链检查 / 运营 CRUD。**不**含对象工作区扫词 UI（#327）、Composer/Tiptap。

## 〇、2026-08-02 合入审核补口

此前交付超时的直接原因不是冲突，而是证据与生产可达性不足：生成链检查条只有 DTO/函数和 Foundation query，生产红线门仍直接调用 scanner；PostgreSQL 只有实现、没有真库迁移/事务恢复/并发 seed 证据；运营端缺编辑入口和真实交互；结果交付页没有挂载只读检查条。这些缺口已在本 lane 收口，且仍严格保留 #327 的对象工作区内联替换边界。

- 生产 `CheckPrimitiveHandler` 经 `policy-gates` 调用 `runGenerationChainSensitiveCheck`，命中后保留完整 `sensitive-check-bar/v1`（word/snippet/replacements），并随 `HarnessSelectionError` 和终态 HTTP 投影传递；交付端调用次数保持 0。
- scanner 保留 NFKC 匹配，但 `index` / `length` / `textLength` 均明确映射到原始输入的 UTF-16 范围；组合字符与兼容连字回归证明 `text.slice(index, index + length)` 等于命中原文。命中采用 leftmost-longest 且全局不重叠，供 #327 安全消费。
- PostgreSQL baseline seed 改为单事务、显式表锁、失败回滚；真库用例覆盖重复 migrate、中途失败 0 残留、两个连接并发 seed、CRUD、过滤、停用、唯一约束和删除。
- `/admin/templates` 单条 CRUD 补齐编辑，交互测试覆盖新增→编辑→停用→删除；真实 Chromium 在隔离数据库完成同一闭环，最终恢复基线 18 条且控制台 0 error。
- 所有 Result delivery carrier 均挂载只读 `check_bar` consumer；扫描完整发布包的 canonical caption（含 topics），Copy 无发布包时回退当前文档，其他缺失投影直接 fail closed。首次检查、缓存后台重检、error、hits 均阻断；查询总 deadline 为 10 秒（覆盖 response body），超时/失败展示重试，只有合法 `clear` 响应允许交付。未实现对象工作区内联替换。

---

## 一、§10.3-2 定案：美业违禁词初版数据起草与人工校流程

### 1.1 数据原则

| 项 | 定案 |
| --- | --- |
| 结构 | `sensitive_words(word, category, replacements[], status)`；七分类 `extreme/medical/cosmetic/finance/legal/vulgar/other` |
| 数据来源 | **美业专项自建**；**不搬** xhswork seed 31 条（只借结构） |
| 基线 seed | `apps/core/src/p1/sensitive-words/beauty-fixture-lexicon.ts`（`beauty-sensitive-lexicon/v1`） |
| 空库行为 | Core 启动 `ensurePlatformBaseline()` 仅在表空时写入基线；有数据后不覆盖 |

### 1.2 起草 → 人工校流程（本票定案）

1. **起草人**（产品/合规）在飞书或 PR 草稿列出候选词：词条、分类、替换建议、适用场景、风险说明。
2. **对照红线**：与 harness 既有红线（事实来源/权益/身份等）分工——词库只做**字面违禁/极限表述**；不替代 `critical_fact_source` 等结构门。
3. **人工校**（运营负责人或合规）勾选：启用 / 改写 replacements / 驳回。驳回词不入库。
4. **入库**：运营在 `/admin/templates`「违禁词库」单条 CRUD；或后续脚本走 `sensitive-words` create（**无批量 UI**，见下）。
5. **回滚**：`status=disabled` 立即对生成链/红线门生效（listEnabled 热读）；物理 delete 仅用于明显误录。
6. **回归**：改词后至少跑  
   `pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 src/p1/sensitive-words/sensitive-words.test.ts`  
   与相关 redlines 子集。

### 1.3 批量导入 UI（实施时定 → 本票裁决）

| 项 | 裁决 |
| --- | --- |
| 批量导入 **UI** | **本票不做**（与 xhswork「Admin 有 API 无 UI」同构；控制台单条 CRUD 足够首版） |
| 批量 API | 本票**不**暴露 `batch` action；需要时另开票 |
| 理由 | 词库变更属高敏合规动作，首版强制单条审阅；避免 CSV 误刷全库 |

---

## 二、共库合流与生成链检查条

| 面 | 落点 |
| --- | --- |
| 扫描纯函数 | `scanSensitiveText`（`apps/core/src/p1/sensitive-words/scan.ts`） |
| 红线门 | `HARNESS_GATE_IDS` 增 `sensitive_words`；`policy-gates` 经 `runGenerationChainSensitiveCheck` 复用同一 scanner；**无 lexicon 时 no-op**（兼容历史 redline 单失败断言） |
| 生成链步骤 | `runGenerationChainSensitiveCheck` → scan + `sensitive-check-bar/v1` |
| 交付检查条 | `buildSensitiveCheckBar` / query `check_bar`；所有 Result delivery carrier 真实挂载，扫描 canonical caption（含 topics），只读展示命中与 replacements |
| 生产 check 路径 | `main.ts` `harnessCheckTargetWithSensitiveLexicon` 在 resolve 时注入 `listEnabled()` |
| 运营 CRUD | module `sensitive-words`：create/update/delete + list/get/scan/check_bar/generation_chain_check |
| 管理 UI | `/admin/templates` → `AdminSensitiveWordsControl` |

### 共库证明（测试）

`sensitive-words.test.ts` 与 `check-handler.test.ts`：同一 `BEAUTY_FIXTURE_SENSITIVE_LEXICON` 下 generation-chain、`validateHarnessPolicy` 和生产 primitive check 同源命中，并保留结构化检查条。

---

## 三、关键文件

| 路径 | 角色 |
| --- | --- |
| `packages/contracts/src/sensitive-words.ts` | 契约 |
| `apps/core/src/p1/sensitive-words/*` | 词库 / 扫描 / 检查条 / CRUD / PG |
| `apps/core/src/p1/harness/policy-gates.ts` | `sensitive_words` 门 + re-export scanner |
| `apps/core/src/p1/harness/production-stage-ports.ts` / `terminal-failure.ts` | 结构化命中证据跨选择失败与终态投影保真 |
| `apps/core/src/main.ts` | migrate / seed / module / check 注入 |
| `mkfast-template-main/src/p1/admin-sensitive-words-*.ts(x)` | 运营 CRUD UI |
| `mkfast-template-main/src/routes/admin/templates.tsx` | 挂载 |
| `mkfast-template-main/src/product/results/sensitive-words-delivery-check.tsx` | Result delivery 的真实只读 query consumer 与 fail-closed guard |
| `mkfast-template-main/src/p1/client.ts` | 可复用的有界 P1 query seam（总 deadline + timeout code） |

---

## 四、验收映射

| 票面验收 | 证据 |
| --- | --- |
| 样本文案可检出 + replacements | `sensitive-words.test.ts` fixture 样本文案 |
| 生成链与红线门共库 | 同上 + production check + redline cases `sensitive-words-*` |
| 命中阻断交付且证据不丢 | `production-stage-ports.test.ts` + `terminal-failure.test.ts` |
| PostgreSQL 行为 | `postgres-repository.postgres.test.ts` 真库 migrate/rollback/concurrent seed/CRUD |
| CRUD 行为测试绿 | Memory repository + Foundation + Web interaction + 真实 Chromium CRUD |
| Result 交付检查条 | `sensitive-words-delivery-check.interaction.test.tsx` 验证 Copy / image carrier、canonical topics、命中阻断、clear 放行、query error 与缓存重检 fail closed、手工重试；`client.test.ts` 验证无响应与 body stall 都在 deadline 内失败 |
| 批量导入 UI | 本交底 §1.3 明确不做 |

### 2026-08-02 重跑结果

| 门 | 结果 |
| --- | --- |
| Core 聚焦生产链/红线回归 | 119 pass / 0 fail / 0 skip |
| PostgreSQL 真库 | 1 pass / 0 fail / 0 skip |
| Contracts | 4 pass / 0 fail / 0 skip |
| Web model | 3 pass / 0 fail / 0 skip |
| Web interaction | 9 pass / 0 fail / 0 skip（3 files） |
| Web bounded P1 transport | 10 pass / 0 fail / 0 skip |
| Core / Contracts / Web typecheck | 三组 exit 0 |
| Web production build | exit 0 |
| Web 定向 Biome | 14 files，exit 0 |
| 真实 Chromium | 新增→编辑→停用→删除；回到 18 条；console 0 error；本地证据 `output/playwright/issue-320-admin-crud-disabled.png` |
| 锁内 Playwright（隔离双库） | `admin-sensitive-words.spec.ts` + `p0-golden-journey.spec.ts`，2 pass / 0 fail，exit 0；覆盖真栈 CRUD，并在浏览器边界暂停真实 Core 检查请求，证明 checking 时所有交付动作禁用、同一请求 clear 后才放行 |

锁内首轮若复用共享业务库，Core 会因其他 lane 已 provision 的 Skill facts 不同而以 `IDEMPOTENCY_CONFLICT` 拒绝启动；未清共享库。最终结果来自新建隔离业务库 + DBOS 库，两库已在验收后删除。

---

## 五、边界与后续

- #327：对象工作区扫词/内联替换 UI（消费本票 DTO / scan API）。
- 合入闸：主控 P1 验收门齐验后再合 P2；lane 不 push / 不关票。
