# MkFast / MkImage 源码对照：后台可视化与多渠道供应两大决策块（2026-07-20）

**问题**：D-048~D-057（后端管理平台可视化）与 D-058~D-071（多渠道模型供应商管理）修订定稿后，上游 MkFast / MkImage 源码有没有对应解决方案？有的话是否值得参考？

**方法**：两路 Opus 只读代码对照 agent（admin 面 / 供应与权益面）+ 主会话对 7 处关键 file:line 引用抽查实证（全部属实）。承接 2026-07-10 旧审计《mkfast-app 模型接入与管理实现审计》（`.scratch/model-supply-wayfinding/assets/01a-mkfast-app-model-access-audit.md`），本报告为其在新决策块坐标下的增量对照。

**源码底细**：
- **MkImage** = `references/repos/mkfast-app/`（目录名误导，实为 Fox 的 AI 图像生成 SaaS）。本地镜像 commit `6f4d191`（2026-07-10，深度=1 浅克隆，无法本地 diff 旧审计的 0b82f31）；与旧审计相比唯一可见新增是 `src/cache/`（prompt caching），与供应控制面正交，**旧审计五条核心结论在 6f4d191 全部继续成立**。
- **MkFast 原始模板** = `/Users/bin/Desktop/开发/内容无人区/美业内容/references/repos/mkfast-template/`（旧工作区镜像）。注意本项目根下的 `mkfast-template-main/` 是我们自己改过的工作副本（7 个 admin 页是我们建的），不作上游证据。
- 许可证约束沿用旧审计：MkImage License 非宽松开源，复制代码前须确认 Licensee 有效性；本报告所有「抄」均指语义/结构参考。

## 1. 总结论

**两大决策块的控制面主体，上游全部空白——零对应，全部印证需自建；上游的价值在「叶子层」：单页交互零件与积分账本三件套，可直接移植。** 没有任何一条已定决策被上游证据挑战或存在更优雅的现成替代；反向校验只产出一条落地细节改进（GrantLot 消费顺序，见 §5）。

## 2. 块①后台管理平台（D-048~D-057、D-070）对照

### 上游现状全景

- MkImage admin = 对象型运营后台四页（users/tasks/prompts/redemptions，`src/config/sidebar-config.ts:32-60`），`/admin` 首页直接 redirect 到用户页（`src/routes/admin/index.tsx:5-7`），**无总览/仪表盘/异常概念**。
- MkFast 模板 admin 更简：只有 users 一页，同款二元门。
- 权限 = 纯二元 admin 门：`role==='admin'` 双中间件（路由态 throw redirect / API 态 401-403，`src/middlewares/admin-middleware.ts:41-64`），ban/role/impersonation 复用 Better Auth `admin()` 插件（`src/auth/auth.ts:116-122`）。**零能力级/操作级权限键**。
- **后台零可改配置**（全部编译期 `website.ts`+env）、**零 admin 操作审计**（只有业务台账）、**零 Cloudflare 投影/深链**（workflowInstanceId 仅文本展示）。

### 逐条裁定

| 决策 | 上游对应 | 裁定 |
|---|---|---|
| D-055 异常优先首页 | 无（首页=redirect；仅任务页 4 张计数卡） | **零对应，自建**；StatCard 组件可给「全绿摘要」区块 |
| D-054 能力一级/依赖二级 IA | 无（对象型扁平导航） | **零对应，自建**；上游对象页正是我们的下钻叶子 |
| D-057 能力权限合同 | 二元门（精确印证决策里「现状=二元 admin 门」表述） | 合同**自建**；中间件双态范式+Better Auth ban/role/impersonation 原语**可复用** |
| D-048 admin-config 修订链（CAS/回滚/审计） | 无（唯一可编辑=Prompt 内容 CRUD，无版本） | **零对应，自建** |
| D-048/D-057 命令审计 p1_command_audits | 无（force-fail/ban 均不写审计，`src/api/admin-tasks.ts:660-673`） | **零对应，自建** |
| D-052/D-053 Cloudflare 只读投影+深链 | 无；但任务详情「从时间戳重建时间线」手法（`admin-tasks.ts:382-530`）与 D-052 证据翻译精神一致 | CF 层**零对应，自建**；时间线重建手法**可借鉴** |
| D-057 权限域动作覆盖 | 仅 4 类写动作；force-fail 带 AlertDialog 确认+状态前置守卫+幂等退款（`admin-tasks.ts:587-674`） | 统一动作合同**自建**；单动作安全范式**可参考** |
| D-070 供应网关控制中心 | 无「多渠道」概念（单层 provider 枚举） | **零对应，自建** |

## 3. 块②多渠道模型供应（D-058~D-071）对照

### 逐条裁定

| 决策 | 上游对应 | 裁定 |
|---|---|---|
| D-058 四层域模型+RouteSnapshot | 扁平 provider 枚举 `'fal'\|'apimart'\|'kie'`；业务 id↔provider model 映射与能力矩阵（`src/ai/models.ts:199-209`、`workflows/image-generation/types.ts:55-77`）是编译期静态 | 四层/快照**零对应**；CatalogModel 字段形状**可搬**（加 revision+Deployment 绑定） |
| D-059 版本化路由+健康覆盖层 | `resolveProvider` 五级静态序（`src/api/generate.ts:334-369`）；重试仅 Workflow 步级 limit 2-3；无失败率/冷却/熔断/跨商切换 | **零对应，自建**（含 C6 采纳的 LiteLLM/Envoy 冷却默认） |
| D-060 CredentialAccount 三态+密钥版本 | 仅 env 三把 key（`src/env/server.ts:42-51`）；Better Auth `apikey` 表是**入站**用户密钥，方向相反勿误判 | **零对应，自建** |
| D-062 模型可选、渠道治理性隐藏 | `VITE_SHOW_IMAGE_PROVIDER` 是**装饰性 UI 开关**，provider 可被 client preference 选中且明文入库、requested/resolved 不分离（`generate.ts:358`） | 表面相似、语义不同：**印证我们的治理性隐藏+快照可审计是真增量** |
| D-063 EntitlementPolicy+AccountAllocation | 套餐=扁平积分数 `{amount,price,expireDays}`（`config/website.ts:214-340`），无模型/质量/并发/池维度 | **我方已超越**；无可参考 |
| D-064 数据等级显式授权 | 无 | **零对应，自建** |
| D-065 质量门禁→健康→成本排序 | 无（单选 provider，无排序） | **零对应，自建** |
| D-066 SupplyPool+双账本 | 多账号池/专属池/BYOK 全仓零命中；成本侧只有产品积分 `creditsUsed`，**无上游货币成本字段** | **零对应，自建**（ProviderCostLedger 尤其） |
| D-068/D-069 接受态+双渠道验收 | 无 workflow 终止/取消（force-fail 竞态缺口在 6f4d191 仍在）；测试仅 4 个页面 smoke，零 provider 契约/故障注入 | **零对应，自建**（印证 C5 维持验收强度的必要性） |
| D-071 自有控制面 | 上游本身就是「无网关、自写直连」形态 | 与决策同向，无新证据 |

### 积分/权益栈深挖（旧审计薄弱区，本次新增）

- **GrantLot 式批次账本：有。** 每笔授予行带 `remainingAmount`+`expirationDate`（`src/db/app.schema.ts:143-147`），消费按非过期批次顺序扣减（`src/credits/credits.ts:115-162`）。是 GrantLot 的现成骨架。
- **消费顺序缺陷：FIFO by `createdAt asc`（credits.ts:128 orderBy），不是先到期先扣**——后创建但更早到期的批次会被跳过白白过期。**我们 GrantLot 落地应反着做：先到期先扣。**
- **退款幂等：产品级。** `unique(relatedTransactionId, type)` 唯一索引（`app.schema.ts:157-159`）+ 已存在退款 no-op 检查（`credits.ts:202-216`）。最值得直接抄的一条。
- **授予幂等：弱。** `addCredits` 自身无幂等键，去重全靠支付 webhook 层——正好印证我们评审已识别的「先发布后核销并发重复」P1：双账本**授予路径也要独立幂等键**。
- **订阅续费积分轮转：死代码。** `processSubscriptionRenewal`（先过期旧批次再授新批次）零调用方，出货形态是纯一次性积分包。参考其语义、不可当作已验证实现。
- **兑换码：近乎可直接移植（对应 D-045）。** 原子 CAS `lt(redemptionsCount,maxRedemptions)` 自增（`src/credits/redemption.ts:140-154`）+ perUserLimit + boundUserId + creditExpiresAt 覆盖 + soft-disable。已知 cosmetic bug：`redemption_record.creditTransactionId` 未真正链到交易行（redemption.ts 生成的 id 与 addCredits 实际 id 不一致）。

## 4. 值得抄清单（两块合并，按价值排序）

1. **退款/补偿幂等模式**（D-066 双账本）— 唯一索引+no-op 检查，直接回应「并发重复付费」P1。
2. **Credit lot 批次账本骨架**（D-063/D-066 GrantLot）— 授予批次+余量+过期；消费顺序改为先到期先扣。
3. **兑换码 CAS 生命周期**（D-045）— 近乎直接移植，注意修复断链 bug。
4. **任务详情页版式**（D-052/D-070 下钻详情模板）— 摘要卡+延迟四格+时间戳重建时间线+错误徽章+产物预览（`components/admin/tasks/task-detail-page.tsx`）。
5. **高密度运行表骨架**（D-070 三模态运行表）— faceted 多维筛选+服务端分页+nuqs URL 状态同步（`tasks-table.tsx:580-616`、`admin-tasks-content.tsx:18-33`）。
6. **受治理快捷动作范式**（D-057）— AlertDialog 确认+服务端状态前置守卫+幂等补偿（ForceFail 三件套），补权限键+审计写入即为我们的动作合同雏形。
7. **中间件双态范式**（D-057）— 路由态 redirect / API 态 401-403 共享同一判定；Better Auth admin 插件 ban/role/impersonation 原语直接复用。
8. **CatalogModel 字段形状**（D-058）— 业务 id/providers[]/preferredProvider/能力收窄矩阵，加版本化后可用。
9. **submit/poll Provider port**（D-058/D-068）— 两方法异步 port+内联/异步二选一返回；需补 cancel/usage/health 切面。
10. **Workflow 补偿编排思路**（DBOS step 切分参照）— 积分先扣为首个 durable step、R2 non-fatal、失败删行退款、ErrorCategory 分类；**其 step 是 impure（步内 DB 写），与 D-038 纯函数内核冲突——切分思路抄、impure 模型不抄**。
11. **StatCard/治理抽屉/Tabs 分区**（D-055 摘要区块、账号治理下钻、配置+审计同域）— 轻量 UI 零件。

## 5. 对我们决策的反向校验结果

- **无任何决策需要修改**：上游没有更优雅的替代实现；两块决策的核心增量（异常首页、能力 IA、权限合同、配置修订链、命令审计、CF 投影、四层供应模型、版本化路由、健康覆盖、凭据实体、权益栈、双账本、SupplyPool、接受态、双渠道验收）在两套上游全部为空白。
- **一条落地细节注记**（非决策变更）：GrantLot 消费顺序采用**先到期先扣**（earliest-expiry-first），显式规避 MkImage FIFO-by-createdAt 的批次白白过期缺陷；同时**授予路径设独立幂等键**（MkImage 只有退款幂等、授予幂等缺失的教训）。建议在 D-066 实施票中体现。
- D-062 的对照特别有价值：MkImage 的「provider 隐藏」是装饰性前端开关+可被用户偏好穿透+入库明文不分 requested/resolved——反衬我们「治理性隐藏+RouteSnapshot 可审计」不是过度设计，而是上游缺口的直接修补。
- D-069（C5 维持双渠道+故障注入验收强度）获得反面印证：上游 adapter 层零测试、无契约测试、force-fail 竞态缺口存在半年未修，正是「不验证可行性则交付有问题」的实例。

## 6. 处置记录（2026-07-20）

用户指令「把可以参考的内容回写到对应的部分」已执行：本报告 §4/§5 的可参考项以统一格式「上游对照（2026-07-20）」回写至权威设计文档 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md` 共 **10 条决策**（各条 Supersedes 前一行）：

| 决策 | 回写内容 |
|---|---|
| D-045 | 退款幂等唯一索引 + 兑换 CAS + grant-lot 骨架；授予路径须设独立幂等键（反面教训） |
| D-052 | 时间戳重建阶段时间线 = 证据翻译参照件；Workflow id 不联动 = 深链缺口反证 |
| D-055 | 上游首页纯 redirect 反证异常首页真增量；StatCard 复用给全绿摘要 |
| D-057 | 中间件双态 + Better Auth admin 原语复用；force-fail 三件套 = 快捷动作雏形 |
| D-058 | ModelConfig 字段形状 = CatalogModel 起点；submit/poll port 切面参照 |
| D-062 | 装饰性隐藏 vs 治理性隐藏反衬证据 |
| D-066 | 批次账本印证 GrantLot；先到期先扣 + 授予幂等键两条实施要求入双账本票 |
| D-068 | Workflow 步骤切分/补偿思路参照，impure step 不抄（守 D-038）；竞态缺口反证 cancel 合同 |
| D-069 | 上游零契约测试/故障注入 = D-080 C5 维持验收强度的反面佐证 |
| D-070 | 任务详情版式 + 高密度运行表两件交互零件作下钻页参照 |

回写为证据性补注，不改变任何已拍板决策内容；无新增决策编号。
