# Agent Team 全项目深度 Review（2026-07-19）

> **状态：固定提交快照，已被后续实现取代。** 本报告对 `1656da7` 的评分、D-042“未合 main”和开放问题判断只描述当时状态；后续修复、UX/供给票包、Pro Studio K01–K11 与 D-046 已合入。当前判断请读 [`doc-consistency-review-2026-07-19.md`](./doc-consistency-review-2026-07-19.md) 与持续更新的 [`implementation-gap-ledger-2026-07-19.md`](./implementation-gap-ledger-2026-07-19.md)。正文保留为原始评审证据，不回写成今日结论。

**HEAD**: `1656da7` (`main`，相对 `origin/main` ahead ~200)  
**方法**: 5 路并行 Agent Team（产品决策 / 架构 Harness / UIUX / 完整度·安全·证据 / 文档权威）+ 主会话对抗核验关键路径与分支状态  
**权威链**: `PRODUCT.md` → `CONTEXT.md` → `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（D-001~D-042）→ `DESIGN.md` → ADR → specs/handoff → `.scratch` 决策与证据  
**不作为完成证据**: GitHub issue 开闭状态、默认 `pnpm test` 全绿、fixture 走查 alone

---

## 0. 一句话裁决

**工程主链与结构性护栏已站稳（架构 ~8.2/10；25 票代码层基本闭环；07-18 Codex 确认的 2P0+15P1 在 HEAD 已清）——但产品体验完成度与决策执行仍有断层：D-042 已拍板且修复分支已写完，却未合入 `main`；P1 功能完成 / 可试点 / 宣发闭环数均不可宣称。**

| 维度 | 分 | 一句话 |
|---|---:|---|
| 产品决策对齐 | **7.5** | 定位/IA/Day-0/双交付层站得住；D-042 执行未关；ContentPackage 最后一公里未收死 |
| 架构 / Harness | **8.2** | DBOS 姿态、五段纯核、OCC、七门、token 流、核销顺序健康 |
| UI / 设计系统 | **6.8** | 工作台橱窗材质可信；次级面与 D-042 债未清 |
| 票实现完整度 | **8.5** | 25 票代码层基本 complete；激活/证据/e2e 门仍 partial |
| 安全 / 租户 | **7.5** | 主链护栏扎实；service-token 全权模型 + 默认密钥是试点前 P1 |
| 文档权威卫生 | **6.0** | 最高权威清晰；活文档 D 上限与旧票图「3 选 1 / PoC」仍抢麦克风 |
| **综合** | **~7.4** | 可内测 dogfood；不可宣称功能完成或可试点 |

---

## 1. 权威与阶段（读这个再读代码）

### 1.1 谁赢

1. **最新用户拍板**: `docs/design/beauty-marketing-agent-product-design-2026-07-17.md` **D-001~D-042**
2. **产品面**: `PRODUCT.md`
3. **术语与双北极星拆分**: `CONTEXT.md`
4. **工程合同**: full-feature-spec + handoff + 票体「复审修订」节
5. **架构 ADR**（含修订横幅）
6. **交付证据计数**: `docs/evidence/contentpackage/`（链路数 = **1**）
7. **ContentPackage 票图机器真相**: `.scratch/contentpackage-productization/decision-ticket-map.json`（关票/依赖；**不是**现行产品政策权威）

### 1.2 阶段（D-040）

- 当前 = **功能完善的产品开发阶段**
- 合规/运营执行（Week 0 预登记、WOZ、门店回放）**整体置后**
- **结构性护栏**（七门 / 权利门 / 审计双写 / provenance / 能力三态）**随功能同建** — 不得置后

### 1.3 北极星硬拆分（禁止粘连）

| 口径 | 当前值 | 终点 |
|---|---|---|
| **真实跑通链路数**（P1 交付证据） | **1**（`real-run-0002`） | 确认入库 |
| **真实跑通宣发闭环数**（PRODUCT 北极星） | **未起计** | 发布/导出 → 信号关联 |
| **P1 功能完成** | **未宣称** | must-have + release Gate + real-provider 旅程 |
| **可面世 / 可试点** | **未宣称** | 密钥卫生 + e2e 门 + 运营/合规签字等 |

fixture 走查闭环、票关闭、默认绿测 **永不** 单独推进上述计数或状态。

### 1.4 关键近期决策

| 决策 | 内容 | HEAD 状态 |
|---|---|---|
| D-041 | DBOS Transact 锁定 | ✅ 生产路径成立 |
| D-040 | 功能优先；护栏同建；运营置后 | ✅ 阶段理解正确 |
| D-042 | 暗色转正；套组收对话流；全量 P1+P2 一次清 | ⚠️ **文档 accepted，修复分支未合 main** |

---

## 2. Agent Team 分路结论

### Agent A · 产品决策对齐

**Verdict**: 宣发副驾身份与一级 IA 站稳；「决策已关 = 体验已到」在 D-042 上不成立。

| 决策 | 状态 | 证据要点 |
|---|---|---|
| D-030 非店务/CRM | **pass** | 无预约/收银/库存/CRM 面；线索=信号台账 |
| 导航 创作/内容/素材/门店 | **pass** | 桌面+移动四目的地 |
| ContentPackage 唯一聚合 | **partial** | 主读主写是；legacy contents / works·jobs·sessions 深链残留 |
| D-027 视频入首发 | **partial** | UI 可达；无视频 real-provider 同聚合 NS |
| D-028 两层交付 | **pass** | 图文/视频操作轴分离 |
| D-029 Day-0=Day-N | **pass** | 冷热同壳，零建档墙 |
| D-031 无槽位填表 | **partial** | brand_ip 入口合规；套组清单仍 checkbox 编号（main） |
| D-032/033 Harness 意图 | **pass（结构）** | 五段 + 三进三出 + Task 单元 |
| ADR-0012 Pro Studio 两线 | **pass** | 不进一级导航；adoption 回 ContentPackage |
| D-042 | **fail（执行）** | 见 §3 |

### Agent B · 架构 / Harness

**Score: 8.2/10**

**结构性做对**:
- 五段 kernel 纯函数 / DBOS 仅外壳（D-038）
- system DB 强制隔离、效果键、CAS + advisory、审计先行 + Langfuse outbox
- 七门唯一实现；视频 **成本≠售价** 结构性 `productUsageQuantity ∈ {0,1}`
- SSE token + progress 双帧、Last-Event-ID、反缓冲
- 交付 **先 consume 后 publish**；失效 sink 已接线
- `main.ts` 补偿循环：outbox + resume reconciler + expiredFacts

**07-18 Codex §5 的 2P0+15P1**: 主会话复核 **全部 FIXED**（outbox、invalidation、无价门、机会卡 UI、export_use、物料 receipt、brand_ip 迁出 Composer 等）。

**残留结构债（P2）**:
- 失效 producer 内存游标 / 多副本 claim 弱
- 补偿绑 HTTP 进程 `setInterval`
- ContentPackage Operations vs Harness **双写路径**
- 本地默认 test 仍 env-skip 持久层（CI `core-persistence` 已补）

### Agent C · UI / DESIGN

**Score: 6.8/10**

**强**:
- 工作台：壳级玻璃、全出血氛围、白瓷 Composer、一点胭脂
- sole-axis 结构（1656da7）：结果重力 vs Composer 主轴分离
- 视频入口桌面+移动+包内派生已接通
- 暗色 token + DESIGN §7 已写

**弱（D-042 债，main）**:
1. `/pricing` 仍模板皮（无 `meiye-pricing-shell`；hue38 橙）
2. 门店/素材页头对比度（深墨压暗氛围，缺 ambient-copy / 实底）
3. 无媒体内容卡白字压 `bg-muted`（`content-package-card.tsx`）
4. 套组仍编号 Checkbox 清单（非 chips）
5. 流式文案硬编码「正在为你起草文案…」
6. 报价 `formatQuote` 可能直出 provider 货币（US$ 风险）
7. 移动底栏镜像四目的地 + uppercase mono eyebrow

### Agent D · 完整度 / 安全 / 证据

**票面**: 25 票代码层 **~22–23 complete**；原 #47/#48/#49 已交付（不再 missing）；T25 Langfuse 激活 partial；T26 live red-team 仅手触。

**证据诚实**:
- NS=1 质量高（real-run-0002）；0001 诚实驳回；0003 不增计数
- NS=1 = ContentPackage 图文主链，**不是** Harness 五段 + 视频 + 收件箱的 real-provider 全量门
- e2e 仍 opt-in（label / workflow_dispatch）

**安全**:
- P0 无开放：抖音 auto-publish 硬 throw；核销顺序已修
- P1：service-token 全权 + BFF 盖头模型；zod 默认 secret / `change-me` / 全零 vault key

**不可宣称**: P1 功能完成、可试点（可内测 dogfood）

### Agent E · 文档权威

**活冲突**:
1. 多文档 D 上限停在 D-038~D-041，缺 D-042
2. ContentPackage MAP 仍写「D4 3 选 1」— 已被「主推荐 + 备选按需」废
3. full-feature-spec 仍写 DBOS PoC 条件态 — D-041 已锁定
4. DESIGN §1「浅色优先」vs D-042 双主题正式
5. 一致性入口 07-17 / 07-18 双活
6. 合集正文仍像现行法（顶栏退役正确）

**故意缺失（D-040 正确）**: Week 0 预登记文档 — 运营重启时再落盘。

---

## 3. 本轮主会话对抗核验（关键事实）

### 3.1 07-18 工程缺陷 → HEAD 已修（抽样）

| 原缺陷 | HEAD 证据 |
|---|---|
| outbox 未常驻 | `apps/core/src/main.ts:985-1017` 实例化 + setInterval |
| 失效未接线 | `main.ts:794-799` sinks + expiredFacts 进补偿循环 |
| 先发布后核销 | `content-package-delivery.ts` consume → publish |
| brand_ip Composer 槽位 | 表单在 `assets` → `MarketingIdentityManager`；入口仅 chips |
| 机会卡无 UI | `hot-topic-opportunity-card.tsx` + detail 接线 |
| export_use / 物料 receipt | 生产消费者与 hash 输出路径存在 |

### 3.2 D-042：**文档已拍板，修复未合 main**（P0 执行断层）

| 分支 | 关键提交 | 相对 main |
|---|---|---|
| `fix/uiux-pricing` | `33772ea` 橱窗蒙皮 + 诚实 CTA | **未合入** |
| `fix/uiux-composer` | `b5502fb` 套组→chips；`1d40720` 真状态文案；`6c633b9` CTA/焦点 | **未合入** |
| `fix/uiux-surfaces` | 停在 docs `2a9d56d` | 无额外代码 |

**main 上实锤**:
- `content-module-builder.tsx` 仍 `{index + 1}.` + `Checkbox` 清单
- `pricing.tsx` 仍通用 `Container` + 模板定价表，无 `meiye-pricing-shell`
- `content-package-card.tsx` 无媒体路径仍 `text-white` 压 `bg-muted`
- `workbench_harness_copy_streaming` 硬编码流式文案

→ **D-042 关闭判定 = 否**。最高杠杆动作 = **合并三支 fix/uiux-\* 并解 sole-axis 冲突后回归**，不是重写。

### 3.3 CI / 测试信号

| 信号 | 诚实度 |
|---|---|
| 默认 core test 全绿 | 可 skip 持久层 |
| `core-persistence` job | 真 PG + DBOS + assert 防静默 skip ✅ |
| `redline-evals` | PR 默认 recorded 门 ✅ |
| Playwright e2e | **opt-in only** |

---

## 4. 确认开放问题（按严重度）

### P0（决策执行 / 主路径体验）

| ID | 问题 | 处置建议 |
|---|---|---|
| **R-P0-1** | **D-042 修复分支未合 main**（定价蒙皮、套组 chips、真状态文案等已写在旁支） | 合并 `fix/uiux-pricing` + `fix/uiux-composer`；与 `1656da7` sole-axis 做冲突消解与 e2e 回归 |
| **R-P0-2** | main 上套组仍编号 Checkbox 嵌 Composer 主轴（违 D-031/D-042） | 合入后验证 chips 路径；禁止 sole-axis 再回退 |

### P1

| ID | 问题 |
|---|---|
| R-P1-1 | 无媒体内容卡白字不可读（`content-package-card.tsx`）— 可能需 surfaces 车道补丁 |
| R-P1-2 | 门店/素材页头对比度（缺 ambient-copy / 实底） |
| R-P1-3 | 工作台报价可能 US$ 直出（`formatQuote` + provider currency） |
| R-P1-4 | ContentPackage 未完全收死：legacy contents、works/jobs/sessions 商家深链 |
| R-P1-5 | 无 Harness 主链 + 视频 real-provider 旅程留证（NS 仍仅图文 1） |
| R-P1-6 | service-token 全权 + 默认/示例弱密钥（试点前 hardening） |
| R-P1-7 | e2e 非 release required；TEST-CATALOG 仍有 MISSING SPEC |
| R-P1-8 | 文档 D 上限 / MAP「3 选 1」/ spec「DBOS PoC」与 D-023/D-041/D-042 冲突 |

### P2（结构债 / polish）

- 失效 producer 多副本 claim；补偿进程边界
- ContentPackage 双写属主收敛设计
- 移动导航不镜像四格；删 uppercase eyebrow
- 身份 status 中文语义标签；机会卡上工作台 hero
- Langfuse 生产激活 checklist / 观测可选书面口径
- Pro Studio 安全矩阵 partial（试点若不含可书面排除）

---

## 5. 真正强的地方（不要回退）

1. **定位与 IA**: 宣发副驾，非店务；一级导航四词干净  
2. **Day-0 同界面 + 诚实冷态**: 无建档墙；「还没有基于本店事实的推荐」  
3. **Harness 骨架**: 五段纯核、DBOS 锁定、SSE token、单问卡、今天值得发什么状态机  
4. **护栏**: 七门、无价门、权利门、抖音永不自动发、核销顺序、审计双写  
5. **视频工程闭环**: ffmpeg/AIGC/成本≠售价结构性锁定；UI 入口已接通  
6. **修复执行力**: 07-18 评审缺陷与 walkthrough 主链债大量已合 main  
7. **证据纪律**: NS=1 口径严谨；假绿路径有 CI 与文档约束  

---

## 6. 假信心陷阱（docs 说 X，HEAD 是 Y）

| 假信心 | 真相 |
|---|---|
| 「D-042 accepted = 已修完」 | 文档 accepted；**修复在旁支未合** |
| 「walkthrough 全部差距处置完毕」 | 指 07-18 走查清单；**不含** 次日 D-042 |
| 「t01-t20 全 complete = 功能完成」 | 合同实现覆盖 ≠ CONTEXT 的 P1 功能完成 |
| 「07-18 Codex 2P0 仍开」 | **已过时** — HEAD 已修，用旧 review 会高估缺口 |
| 「pnpm test 全绿 = 持久层绿」 | 默认可 skip；看 `core-persistence` |
| 「链路数 1 = 宣发闭环 / 可面世」 | CONTEXT 硬否 |
| 「套组已 filter 不可用 = D-042 完成」 | main 仍编号 checklist，非 chips |

---

## 7. 建议路径（按杠杆排序）

### 立即（1–2 天）

1. **合入 D-042 三支 fix 分支**  
   - `fix/uiux-pricing`  
   - `fix/uiux-composer`  
   - 补 surfaces：无媒体卡可读性 + 页头对比度（若仍缺）  
   - 与 `1656da7` sole-axis 冲突消解 + 单测/e2e 回归  
2. **报价展示改额度口径**，禁 provider USD 直出  
3. **CONTEXT / handoff / full-feature-spec 头部对齐 D-042 + D-041 锁定句**

### 短期（本周）

4. ContentPackage 收死：legacy 折叠区与 works/jobs/sessions 对商家隐藏或只读映射  
5. 补 **1 条 Harness 主链 real-provider 旅程** 留证（是否增 NS 或单列宣发闭环数由产品定）  
6. 视频 real-run 同聚合留证（若 D-027 仍 must-have）  
7. 根目录 DEV-START：compose → migrate → fixture → harness 双库 → live 配方  
8. MAP.md 轻退役横幅：票图≠产品政策；废 3 选 1 锁定语

### 试点前

9. 生产密钥 hardening（拒 `change-me` / 默认 secret / 全零 vault）  
10. Playwright 关键路径升 release required（创建闭环 / 收件箱 / 视频入口 / 导出）  
11. Langfuse 激活或书面「审计=PG、观测可选」  
12. 重启运营时再落 Week 0 预登记（D-039/D-040）— **现在不要假建**

---

## 8. 可宣称 / 不可宣称

| 陈述 | 可否 |
|---|---|
| 全量功能票代码层基本落地，可继续迭代 | ✅ |
| 架构选型（DBOS / ContentPackage / 七门 / 两层交付）经对抗成立 | ✅ |
| 内测 / dogfood / 录屏演示（fixture 或受控 live） | ✅ |
| 07-18 Codex 确认缺陷已在 main 清零 | ✅（本轮复核） |
| **D-042 已关闭** | ❌ |
| **P1 功能完成** | ❌ |
| **可试点 / 可面世** | ❌ |
| **宣发闭环数 ≥ 1** | ❌ |
| 用默认绿测代替持久层验收 | ❌ |

---

## 9. Agent Team 元数据

| Agent | 焦点 | 主要产出 |
|---|---|---|
| A | 产品决策对齐 | 决策矩阵；D-042 未关；假信心表 |
| B | 架构 Harness | 8.2 分；07-18 缺陷 FIXED 复核；结构债 |
| C | UIUX DESIGN | 6.8 分；橱窗达标 vs 次级面债 |
| D | 完整度·安全·证据 | 25 票 scorecard；NS 诚实；安全 P1 |
| E | 文档权威 | 冲突 C1–C8；卫生 8 条 |
| 主会话 | 对抗核验 | D-042 分支未合；outbox/invalidation 已接线；套组/pricing 实锤 |

**证据边界**: 本报告基于 2026-07-19 HEAD `1656da7` 静态代码与 git 图；未本轮重跑全量 `pnpm test` / Playwright / 真机浏览器。需要真机复验时，优先合 D-042 分支后再走查。

---

## 10. 后续记录

若合入 D-042 分支并回归通过，应追加：

```text
## 处置记录（日期）
- 合并: fix/uiux-pricing, fix/uiux-composer, [surfaces]
- 冲突消解: vs 1656da7 sole-axis
- 回归: contracts/web/core[-persistence]/关键 e2e
- D-042 关闭判定: ①②③ 分项勾选
```

## 处置记录（2026-07-19 · Agent Team 全量修复）

- 状态：**代码修复已落地 main**（待你确认后 push）
- **D-042 合入**
  - `fix/uiux-pricing` → main（橱窗蒙皮 + 诚实 CTA + contract test）
  - `fix/uiux-composer` → main（套组 chips、真状态文案、CTA/焦点；与 `1656da7` sole-axis 消冲突）
  - surfaces 本轮补：无媒体内容卡瓷题带+墨字；store/assets/leads 页头 `meiye-ambient-copy`；身份 status 中文语义
- **商家语言**：报价改额度口径，禁 provider USD 直出
- **IA**：商家历史投影隐藏 works/jobs/sessions 导航；异步中心「查看全部」→ 内容库
- **密钥 hardening**：production/staging 拒弱占位符；本地/e2e/test 仍可用 fixture
- **DevEx**：根目录 `DEV-START.md`
- **文档卫生**：CONTEXT / handoff / MAP / DESIGN / full-feature-spec 对齐 D-041/D-042
- **回归（本轮）**：web 目标测 35/35 pass；core secret 11/11 pass；locale compile + zh/en key 对齐
- **D-042 关闭判定**
  - ① 暗色转正：token + DESIGN 正式范围 ✅（次级面持续 polish）
  - ② 套组收对话流：chips + locked details ✅
  - ③ 次级面 polish：pricing / 页头 / 内容卡 / 真状态文案 ✅
- **刻意未做（需证据/运营，非本轮代码能关）**
  - Harness/视频 real-provider 旅程留证（NS 仍=1）
  - e2e 升为默认 CI required（仍 opt-in label）
  - Langfuse 生产激活 / Week 0 预登记（D-040 置后）

### Residual batch pointer（2026-07-19）

D-042 主批合入后仍有 critique 次级面残差，另开分支 `fix/critique-open-gaps-2026-07-19` 处置。开项与状态以 [`implementation-gap-ledger-2026-07-19.md`](./implementation-gap-ledger-2026-07-19.md) **§7.4 / §7.5** 为准（共享 header ambient-copy、quick-edit chips、首页 pricing 模板皮、若干 minor、hydration internal ids cosmetic）；**未闭不得伪写 closed**。
