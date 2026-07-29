# #261 开工清单：门开即执行的有序计划

> 前置：本清单**必须先与 `05-xcheck-forward.md`／`06-xcheck-reverse.md` 的结论对齐**再执行；两份复核可能推翻下列任一步的设计依据。
> 基点 main@7f60a4e7，门状态 3/7（`./docs/tickets/261/gate.sh`）。
> 纪律：runbook「小步频合、短命分支」——**每一步（Step）单独 commit**，不憋大分支；每步跑该步的验证，不跑全量门。

---

## 一、按门分层：哪一步被哪道门卡住

**关键事实：G4（#264FE）卡住的是全部前台源码改动**（D lane 串行 `#264FE→#261→#253FE`，spec `:601` 前台创作面语义锁）。所以下表的「可开工层」全部以 G4 已过为共同前提，其余门只额外卡住各自那一层。

| 层 | 内容 | 额外卡在 | G4 过后能否立即做 |
|---|---|---|---|
| **L0** | 路由三段收敛、pill 行、旧入口收敛、D-137 历史文案 | —— | ✅ **能**，不依赖任何上游数据 |
| **L1** | 记忆一级导航（导航项、四域页面骨架、四态空态） | —— | ✅ **能**（四域全走空态占位，接数据源在 L4） |
| **L2** | 评价条 UI ＋ 动作 chip ＋ prefill 接线 | —— | ✅ **能**（UI 与交互不依赖事件落库） |
| **L3** | 评价事件适配层（payload 组装 + 投递 + drop 事件） | G3（落库端目的地未裁） | ⚠️ **半能**：payload 与 schema 校验可写死（#248 契约已在 main），**投递目的地待定**，先落可替换出口 |
| **L4** | 执行确认卡 ＋ 成本即时反馈 | **G3**（被拒消耗供给）＋ **G6/D5**（规划成本口径） | ❌ **不能**：没有数据源也没有口径 |
| **L5** | 三轴真值接入评价事件 | **G3b**（#262 钉扎） | ❌ **不能**：取不到值 |
| **L6** | 「纠正」域接真数据 | #251（`correction` kind ＋ 读取出口） | ❌ 本轮不做，空态占位到位即可 |
| **L7** | 「项目」域接真数据 | **属主未定**（`00-blockers.md 四·补`） | ❌ 本轮不做，等主控裁定 |

### 可能的提前开工窗口（**须主控裁定，我没有自行放行**）

spec `:601` 的语义锁原文锁的是「**前台创作面**」，D lane 串行的理由是「先删（#264 缩小工作面）→ 再重构」。核过 #264FE 的实际改动面：`videoRegenScopes`／`subtitle_text_edit`／`cover_select`／shot regen ＋ `src/product/results/video/*` 的商家侧入口摘除。

据此，本清单里有两步**与 #264FE 改动面零交集**：

| 步 | 改动面 | 与 #264FE 交集 |
|---|---|---|
| **Step 1** D-137 历史文案 | `routes/dashboard/jobs_/$jobId.tsx` ＋ canonical 历史页 job 段 ＋ 两条 i18n 键 | 无。历史页不是创作面，#264FE 不碰 |
| **Step 5 前半** 导航壳 | `lib/uiux/navigation.ts` ／ `config/sidebar-config.ts` ／ `mobile-nav.tsx` ＋ 其 static test | 无。导航壳不是创作面 |

**但我不自行放行**：串行纪律是主控定的编排，「改动面零交集」是我的判断不是裁定，且 lane 槽位口径归主控。**请裁定这两步是否可在 G4 之前先做**——若可，本票现在就能交付两个 commit 而不必干等。

---

**推论**：即使 G4 明天就过，本票也**只能交付 L0-L2 ＋ 半个 L3**。L4 是票面的核心之一（执行确认卡），它卡在 G3 与你的 D5 拍板上。**这一点必须在关票时如实说明，不得把 L0-L3 当成整票交付。**

---

## 二、有序步骤（每步 = 一个 commit）

### Step 1 · D-137 历史定位文案（最小、零依赖、先热身）
- 改：`mkfast-template-main/src/routes/dashboard/jobs_/$jobId.tsx`（11 行薄壳）＋ canonical 历史页 job 详情段
- **注意**：i18n 前缀是 `legacy_projection_`（`zh.json:2256-2264`），**不是**票面评论写的 `canonical_canvas_job_*`（那 12 条已是孤儿键，源码零引用）
- 新增两条 zh/en 键，商家语言（D-116），例：「这是早期版本的生成记录，仅供查看」
- 边界：**不新增交互、不投资改版**（D-137 原文「不再投资」）
- 验证：`pnpm test:interaction` 该页用例断言文案可见；`git diff` 确认零行为改动

### Step 2 · 旧双路由入口收敛
- 按 `01-ia-three-sections.md §6` 的清单逐个处置（多数已是 redirect 壳，实际要动的很少）
- **`src/routes/dashboard/catalog.tsx` 保留**——它是 pill 行的「看全部」目的地，不是竞争性工作台
- 验证：删除类以 `git ls-files` 空输出为证（runbook `:21`，#245 教训）；e2e 断言旧路径落到新位置

### Step 3 · 单路由三段结构上屏
- 主改 `src/routes/dashboard/index.tsx`（收敛 `:78/:93/:102/:106/:110` 的分叉）＋ `src/product/composer/composer-home.tsx`（段落顺序）
- **推荐位上移**，并**重写 `composer-home.tsx:2764-2771` 的注释**——那段记录的是与 D-164① 相反的产品判断，留着会互相打脸（`00-blockers.md 三·补`）
- 冷态：段① 走示例店、段③ 不渲染（原注释担心的空面板因此不会出现）
- 验证：interaction test 断言三段按序上屏；冷/热两态各一条

### Step 4 · 第二层 Skill pill
- 数据源取**现有配方卡目录**（`launch-seeds.ts:101` → `recipe-cards.ts:233`），**不碰 `skills` 模块**（那是 #259 属主，且它只有命令无查询）
- **只出 3 组**：热点借势、品牌与个人 IP 两类零配方，**不渲染空组**（`PRODUCT.md`「警惕无载体的想象功能」）
- 一级 tab 输出类型轴**不改**（D-164②）
- 验证：interaction test 断言 pill 分组与 lens 联动；负向断言无空组渲染

### Step 5 · 记忆一级导航（骨架 + 四域空态）
- `src/lib/uiux/navigation.ts:10` 加第 5 项、`src/config/sidebar-config.ts:50` 补图标、`src/components/product/mobile-nav.tsx:55` 栅格 4→5
- **必改 `src/components/product/mobile-nav.static.test.ts:34-43`**——用例名写死「nav 四项合同」，硬断言四项。改它要在票下引 D-164④ 原文留痕，**不是顺手改栅格**
- 四域空态复用 D-126 四态机形状（`today-recommendation-card.tsx:66-83`）；「降级不得伪装成冷启动」同样成立
- **不在前端出现 `'correction'` 字面量**（那是 `reuse-memory.ts:294` 的枚举，属 #251），tab id 用 `corrections` 并注释说明
- 验证：interaction test 四域各一条空态；导航项可达

### Step 6 · 评价条 ＋ 动作 chip（UI 层）
- 评价条：纯图标、无文字标签、紧贴文案末尾、轻到可忽略（D-164⑤）；**纯图标必须有 aria-label**
- chip：在评价条**下方独立成组**；点击走**现有 prefill 链路**（`creation-entry-model.ts:67` → `composer-home.tsx:2775-2789`），**禁止自动执行**；顺手把 `:2765` 注释里的 "Both CTAs" 改成三个调用方
- chip 内容取配方声明的固定集合（D4 建议，待拍板）
- **不动 `composer-delivery-card.tsx:6-9` 的 R-05 纪律**（所有动作只开 Result Center，不在这里写）
- 验证：interaction test 断言点击 chip 只填充不提交；评价条 a11y 断言

### Step 7 · 评价事件适配层（半步，出口留活）
- 类型直接 `import type { ObservabilityAxes } from '@contracts/observability'`（#248 已合入 main）
- 组装后**先过 `observabilityAxesSchema` 再投递**（正则 `^[^@\s]+@[^@\s]+$` 比设想严）
- `catalogRevision` **不得**从 `uiux.ts:44` 的执行契约字段搬（上游注释已划清两者不同源）
- 失败可观测：发 `observabilityDropEventSchema`，**不自造计数器**
- 投递出口做成可一行替换（`setSubstrateEventDeliverer`），目的地待 G3 的矩阵裁定
- 验证：interaction test 断言 payload 满四键且过 schema；断投递后可见 drop 事件

### Step 8+（**门未开，不排期**）
执行确认卡与成本反馈（L4）、三轴真值（L5）—— 等 G3／G3b／G6。

---

## 三、每步的共同纪律

- **locale 纪律**：`typecheck`／`test`／`test:interaction`／`e2e` 都重写共享 paraglide 产物。#266 已合入（write-if-changed ＋ 互斥锁 ＋ dev 心跳快速失败），机制是**兜底不是替代**——同 worktree 内仍不与 dev 并跑。
- **判红**：先查 `git diff` 是否命中报错文件 ＋ 单文件隔离重跑，再谈产品缺陷。
- **上游合入后的第一次 rebase**：必须附跑上游票的关票验收断言（rebase 六条第 5 条），专抓「文本 rebase 干净但语义漂了」。
- **不 push、不关票**：完成＝票面验收逐条有运行证据，票下评论附证据（file:line／命令输出／`git ls-files` 结果），合入由主控亲验。
- **关票时如实报范围**：本票在当前门状态下**交付不了 L4/L5/L6/L7**，不得以 L0-L3 充作整票完成（D-150 消费者证明门：组件已建未挂载／管线已建无入口＝未完成）。
