# #320 P2-08 交底 —— 违禁词库、生成链检查条与运营 CRUD

- 分支：`leelv007-cmd/lane-320`（worktree `/Users/bin/orca/workspaces/美业内容2/lane-320`）；**未 push、未关票**，合入与 P1/P2 门禁由主控核验。
- 规格锚：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §4.6 / §6.3 / §8 P2-3 / §10.3-2。
- 语义锁属主：`sensitive_words` 词库 / 生成链检查 / 运营 CRUD。**不**含对象工作区扫词 UI（#327）、Composer/Tiptap。

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
| 红线门 | `HARNESS_GATE_IDS` 增 `sensitive_words`；`policy-gates` 复用同一 `scanSensitiveText`；**无 lexicon 时 no-op**（兼容历史 redline 单失败断言） |
| 生成链步骤 | `runGenerationChainSensitiveCheck` → scan + `sensitive-check-bar/v1` |
| 交付检查条 DTO | `buildSensitiveCheckBar` / query `check_bar` |
| 生产 check 路径 | `main.ts` `harnessCheckTargetWithSensitiveLexicon` 在 resolve 时注入 `listEnabled()` |
| 运营 CRUD | module `sensitive-words`：create/update/delete + list/get/scan/check_bar/generation_chain_check |
| 管理 UI | `/admin/templates` → `AdminSensitiveWordsControl` |

### 共库证明（测试）

`sensitive-words.test.ts`：同一 `BEAUTY_FIXTURE_SENSITIVE_LEXICON` 下 generation-chain 与 `validateHarnessPolicy` 同源命中。

---

## 三、关键文件

| 路径 | 角色 |
| --- | --- |
| `packages/contracts/src/sensitive-words.ts` | 契约 |
| `apps/core/src/p1/sensitive-words/*` | 词库 / 扫描 / 检查条 / CRUD / PG |
| `apps/core/src/p1/harness/policy-gates.ts` | `sensitive_words` 门 + re-export scanner |
| `apps/core/src/main.ts` | migrate / seed / module / check 注入 |
| `mkfast-template-main/src/p1/admin-sensitive-words-*.ts(x)` | 运营 CRUD UI |
| `mkfast-template-main/src/routes/admin/templates.tsx` | 挂载 |

---

## 四、验收映射

| 票面验收 | 证据 |
| --- | --- |
| 样本文案可检出 + replacements | `sensitive-words.test.ts` fixture 样本文案 |
| 生成链与红线门共库 | 同上 + redline cases `sensitive-words-*` |
| CRUD 行为测试绿 | Memory repository + foundation module CRUD 用例 |
| 批量导入 UI | 本交底 §1.3 明确不做 |

---

## 五、边界与后续

- #327：对象工作区扫词/内联替换 UI（消费本票 DTO / scan API）。
- 合入闸：主控 P1 验收门齐验后再合 P2；lane 不 push / 不关票。
