# 美业内容2 — 四群 40 票开发编排 Handoff（Agent 执行版）

**日期**：2026-07-22　**范围**：P0 整改(#129) + P1 产品化(#130) + Pro Studio 重做(#162) + AP/MP 供应剩余(#106)
**模式**：本地开发（orca 多 worktree 编排已回收，见 [`local-dev-baseline-2026-07-22.md`](./local-dev-baseline-2026-07-22.md)）
**权威依赖来源**：四个 spec 的「建议实施包 / 跨包属主与合并序 / 依赖边」章节；本文件是执行编排的本地权威，冲突时以各 spec 正文为准。

---

## 0. 给 Agent 的读法

1. 认领一个 **worktree**（一条串行依赖链）。一个 worktree 内的票**按内部序顺序做**，不并行。
2. 开 worktree 前先核对第 3 节的**开启条件**（前置票是否已 merged）。条件不满足 → 不开。
3. 每票开工先读对应 spec 的 User Story + Implementation Decision + Testing Decision + DoD，再动代码。
4. 只改本 worktree 属主 glob 内的文件（第 4 节）。碰到冻结文件（尤其 `apps/core/src/main.ts`）**只交 wiring diff 给整合属主，不自行合入**。
5. 完成 = spec 的 **Definition of Done**（真机/连续旅程/公共 seam），**不是本地 build 绿或单测 8/8**。

---

## 1. 核心规则：worktree 的「时机」与「条件」

- **开启条件**（可机器判定）= 该 worktree 承载的**首票的全部前置票已 merged 进 `main`**。
- **开启时机** = 条件满足即可开；一律基于**最新 `origin/main`** 创建，起点自动包含全部已合并前置。

```bash
# 开一个 worktree 的标准动作（条件满足后执行）
git -C <主仓> fetch origin
git -C <主仓> worktree add -b <branch> /Users/bin/orca/workspaces/美业内容2/<name> origin/main
# 完成并合并后回收：
git -C <主仓> worktree remove /Users/bin/orca/workspaces/美业内容2/<name>
```

- **分支命名**：`p0-spine` / `p0-ci` / `canvas` / `p1-result` …（groupless kebab）。
- **worktree 落点**：`/Users/bin/orca/workspaces/美业内容2/<name>`（转本地后复用该空目录）。
- **合并即 rebase**：worktree 分支落后 `origin/main` 时先 `git rebase origin/main` 再推，保证起点始终含最新前置。

---

## 2. 冻结点（里程碑）— 解锁下游 worktree 的关键票

| 冻结点 | 票 | 含义 | 解锁 |
|---|---|---|---|
| **G-Green** | #131 merged | clean-install 绿基线 | 所有 lane 的 PR 才能过 CI |
| **G-Gate** | #132+#133 merged | Biome/secret/bundle + 根级 required gate | 合并门就位 |
| **G-Snap** | #137 merged | CreationExecutionSnapshot + 统一提交入口 | P1-A 起步 |
| **G-DTO** | **#141 merged** | 单一 ContentPackage 写口 + 退役旧路径（**公共投影冻结**）| P0-E、P1-Result、P1-Govern、Canvas-K6 |
| **G-Store** | #142 merged | R2/S3 OwnedAsset 存储就绪 | Canvas-K3、Canvas-K6 |
| **G-Deploy** | #143 merged | 不可变构建 + Readiness + Capability | Canvas-K7、P0-Release |
| **G-Live** | #119 真机绿 | 双渠道 provider live 证据 | P0-F(#146) 的 Capability 判断 |

---

## 3. Worktree 编排总表（核心）

| # | worktree | 承载票（内部序） | 开启条件（前置 merged） | 阶段 |
|---|---|---|---|---|
| 1 | **wt-p0-ci** | #131→#132→#133 | 无（立即） | ① |
| 2 | **wt-p0-sec** | #134 ∥ #135 ∥ #136 | 无（立即） | ① |
| 3 | **wt-p0-spine** | #137→#138→(#139∥#140)→#141 | 无（立即） | ① |
| 4 | **wt-p0-store** | #142→#143 | 无（立即） | ① |
| 5 | **wt-canvas** | #163→#164→(#165∥#166∥#167∥#168)→#169 | 无（立即起 K1） | ① |
| 6 | **wt-p0-ui** | #144 ∥ #145 | **#141**（G-DTO） | ② |
| 7 | **wt-live** | #119（+联动 #146） | 真机环境 + 双渠道供应商凭据 | ② |
| 8 | **wt-p0-release** | #146→#147 | #131–#145 全 merged + **#119 绿** | ②/④ |
| 9 | **wt-p1-onboard** | #148 ∥ #149 | **#137**（G-Snap） | ③ |
| 10 | **wt-p1-result** | #150→(#151∥#152∥#153) | **#141 + #144** | ③ |
| 11 | **wt-p1-govern** | #154 ∥ #155 | **#141** | ③ |
| 12 | **wt-p1-closeloop** | (#156∥#157)→(#158∥#159) | **#150 + #151**（canonical revision 就绪） | ③ |
| 13 | **wt-p1-mobile** | #160→#161 | P1 其余(#148–#159)全 merged | ③/④ |

> 同时活跃 worktree 峰值 ≈ 5–6（阶段① 五条并行；阶段③ P0 已回收后 P1 铺开）。

---

## 4. 属主 glob（独占边界）与接缝

| worktree | 独占 glob | 消费（只读，不改） | 冻结/让渡 |
|---|---|---|---|
| wt-p0-ci | `.github/workflows/**`、根 `turbo.json`/`biome.json`/`package.json`/CI 脚本、secret-scan/bundle 配置 | — | — |
| wt-p0-sec | `mkfast-template-main/src/payment/**`、safe-fetch/SSRF 模块 | — | — |
| wt-p0-spine | `apps/core/src/p1/execution-spine/**`、submission-coordinator、ContentPackage revision port、Harness StagePort | — | **main.ts 交 diff** |
| wt-p0-store | `apps/core/src/**` storage port + S3 adapter、`mkfast-template-main/**` R2 binding、health/readiness 端点 | — | **main.ts 交 diff** |
| wt-canvas | `apps/canvas/**`、`apps/core/src/pro-studio/**` | P0 共享 provider/ledger/storage/capability/audit 端口；#141 revision port；#142 storage | **main.ts 冻结**（Canvas wiring diff 交整合属主） |
| wt-p0-ui | `@meiye/web` Result 前端 DTO 投影、移动进度、模态/主题 primitive | #141 公共投影 | — |
| wt-p0-release | capability 三态、release manifest、provider live gate 装配 | #119 证据 | — |
| wt-p1-onboard | Landing 承接 + Composer onboarding 前端 + 权利单问 | #137 snapshot | — |
| wt-p1-result | `@meiye/web` Result Center + 文案/图文/视频三工作面 | #141 投影、#144 清洗后 DTO | 与 govern 共享组件走 contracts |
| wt-p1-govern | Content 库页 + Assets 治理页 | #141 投影 | — |
| wt-p1-closeloop | Delivery/publication receipt + outcome ledger + 周复盘 | #150/#151 canonical revision | — |
| wt-p1-mobile | 响应式层 + axe/无障碍 + 连续旅程 E2E | 全部 | 贯穿，最终总验收 |

**冲突热点**：
- `apps/core/src/main.ts` = 全局 wiring 单一属主。spine/store/canvas 都注册到它 → 各自**只交 wiring diff**，由**一个整合属主**串行合入（沿用 Z2-WIRING 模式）。
- `@meiye/web` 前端：**wt-p0-ui（P0-E 清洗）必须早于 wt-p1-result**，否则撞车。P1-result / govern / mobile 按**页面/路由**分 glob，共享组件下沉到 contracts。

---

## 5. 分阶段时间线

**阶段① P0 地基 + Canvas 起步（5 worktree 并行）**
- 立即开：wt-p0-ci、wt-p0-sec、wt-p0-spine、wt-p0-store、wt-canvas(K1)。
- **合并纪律**：#131 最先合（G-Green），随后 #132/#133 建门（G-Gate）；其余 lane 的 PR 必须过门才能合。
- 里程碑产出：G-Snap(#137) → 解锁 P1-onboard；G-DTO(#141) → 解锁 P0-ui/P1-result/govern/Canvas-K6；G-Store(#142)/G-Deploy(#143) → 解锁 Canvas-K3/K7。

**阶段② P0 收尾 + 真机（P0 lane 陆续回收）**
- #141 合并 → 开 wt-p0-ui。
- 真机环境+凭据就绪 → 开 wt-live 跑 #119（其 live 证据喂给 #146）。
- Canvas 进入 K2 → K3∥K4∥K5∥K6（K3/K6 等 G-Store，K6 等 G-DTO）。

**阶段③ P1 全面（P0 大部分已回收）**
- #137 合并 → wt-p1-onboard。
- #141+#144 合并 → wt-p1-result、wt-p1-govern。
- #150/#151 合并 → wt-p1-closeloop。
- P1 其余合并 → wt-p1-mobile。

**阶段④ 各群总验收（各自群收尾，不必独立 worktree）**
- 顺序：**#147（P0 RC）→ #169（K7 对标验收）→ #161（P1 总验收）→ #128（admin 同一增量验收）**。
- #119 + #128 需真实环境 + 双渠道供应商凭据（admin-supply 剩余 2 门）。

---

## 6. Agent 工作纪律（各群通用，摘自 spec）

- **测试主接缝**：P0 = 认证后 Composer 提交 HTTP + SSE + 公共 ContentPackage 投影；P1 = production-build Web 完整登录旅程；Canvas = Playwright 内核旅程 + BackendPort 合同。**durable 载体永不被测试 import**。
- **诚实纪律**：无价门；`verified/assisted/unavailable` 三态；recorded ≠ live_verified；缺数据显 `not_instrumented/unknown`，不伪装零/绿。
- **不新增框架**：不引第二聚合、第二编排路径、第二控制台；不以 Mastra/Inngest/Redis 替代 DBOS 主干。
- **完成口径**：DoD 为准（真机/连续旅程/公共 seam）；"组件存在/单测通过/fixture 截图"不能关闭未挂载旅程。

---

## 7. 依赖已机器可读（GitHub 原生 `Blocked by`）

2026-07-22 全部依赖已以 GitHub 原生 `Blocked by` 关系落到远端（orca 发布这批 issue 时已建**传递闭包式**依赖，本次核对补齐 8 条缺失直接边并全量校验）。Agent 直接查：

```bash
gh issue view <n>   # 底部 "Blocked by" 区列出前置；全部 closed 才 unblock
gh api repos/leelv007-cmd/meiyeweb-agent/issues/<n>/dependencies/blocked_by --jq '[.[].number]'
```

**根节点（`blocked_by=[]` = 立即可开）**：#131 #134 #135 #136 #137 #142（P0 六起点）· #163（Canvas K1）· #119（真机门）——即第 3 节阶段① 的全部 worktree 起点。

依赖图为**传递闭包式**（每票列出全部直接+间接前置，如 #147 列 9 个、#161 列 14 个）。Agent 只需判断某票 `Blocked by` 是否**全部 closed** 即可决定开工，无需递归推导。跨群关键边：#152←#139、#153←#140（工作面←对应媒介 Harness）；#168←#141+#142、#169←#143（Canvas←P0 冻结点）；#161←#147（P1 总验收←P0 RC）。
