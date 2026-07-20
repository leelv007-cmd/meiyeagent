# 待开发功能 · 管理员后台可视化配置中心（Admin Control Plane）

> 登记日期：2026-07-14 ｜ 状态：**已批准/待开发**（阶段决策 D11–D12 已拍板；实现与持久层前置仍未完成）
> 来源：用户 2026-07-14 提出——"所有配置功能要能在前台简单清晰地设置，不用每次做代码级修改或模型配置"
> 当前决策：见 [`07-decision-log.md`](./07-decision-log.md) D11–D12；本文件保留实现范围与现状证据，不再作为待拍板问题。
> 关联：本条与阶段诊断 `05-synthesis.md` 的病根同源（大量"改代码才能配"的痛点 = 诊断里的硬编码装配 + in-memory 注册表 + env 驱动模式）。

> **2026-07-17 补注（D-037）**：非代码可变层承载已拍板 = 扩展存量 `apps/core/src/p1/admin-config/`（现已具备 global/workspace 双作用域、追加式修订、CAS apply/回滚、actor/reason 审计——本文 §2.4「无任何 DB 配置表 / 零配置写入端点 / 须先建配置持久层」为 2026-07-14 快照，已过时，不得再当现状）；提示词承载 = Langfuse prompt management 先行；不另建配置系统；React Flow 只读 DAG viewer 缓建。本文 §三「已批准范围」须按 D-037 重新裁量后执行，不再照单开工。

---

## 一、用户诉求（原话锚定）

> "还有一个缺失的功能，就是管理员的后台可视化设置页面。所有的配置功能要能够简单清晰地在前台进行设置，不用每一次进行代码级的修改，或者模型的配置。"

核心 = **配置从"改代码/改 env/重部署"迁移到"admin 后台可视化点选"**。

---

## 二、现状实证（2026-07-14 勘探，非空泛断言）

admin 后台**不是全空壳，而是"一半有肉一半空壳"**，且最关键的运行时配置项一个都没上前台。

### 2.1 已有实底的 admin 页（可复用，不推倒）

| 组件 | 行数 | 可写能力 | 后端命令 |
|---|---:|---|---|
| `p1/admin-model-control.tsx` | 1876 | 模型目录 草稿/发布/回滚/启用/退役 + 路由模拟器 + 质量评估 | `admin_catalog_control` / `catalog_create_draft` / `catalog_publish` / `catalog_rollback` / `catalog_enable` / `catalog_retire` |
| `p1/admin-template-control.tsx` | 697 | 模板 CRUD | 2× useMutation |
| `p1/admin-feishu-tool-control.tsx` | 277 | 飞书工具配置 | 2× useMutation |

→ 模型目录治理这一块**已有相当完整的可视化 CRUD**，是可复用的地基。

### 2.2 纯空壳/只读的 admin 页（需补可配能力）

| 组件 | 行数 | 缺陷 |
|---|---:|---|
| `p1/admin-audit-control.tsx` | 211 | 0 mutation，只读 |
| `p1/admin-operations-health.tsx` | 559 | 0 mutation，只读 |
| `p1/admin-plan-control.tsx` | 147 | 0 mutation，套餐/定价不可在前台改 |
| `p1/admin-control-plane.tsx` | 49 | 骨架 |
| `routes/admin/{models,p1,integrations,plans,users,audit,templates}.tsx` | 11-19 | 全是 `createFileRoute` 薄壳，仅挂载上面的组件 |

### 2.3 致命缺口——诊断锚定的"改代码才能配"项，admin 里一个都没有

这些正是让"每次都要代码级修改"的根源，当前**必须改代码/改 env/重部署**：

| 配置项 | 当前配置方式 | 代码锚点 | 应迁移到 admin |
|---|---|---|---|
| 模型执行模式（recorded/fixture/gateway/direct） | 改 `MODEL_EXECUTION_MODE` env | `runtime-config.ts:376` | ✅ 可视化档位切换 |
| 媒体执行模式（disabled/ark） | 改 `MODEL_MEDIA_EXECUTION_MODE` env | `runtime-config.ts:368` | ✅ |
| Provider 凭据（Ark/LLM/抖音 API key） | 改 `ARK_*` / `MODEL_DIRECT_*` env | `runtime-config.ts` + AWS Secrets | ✅ 凭据保险箱 UI（脱敏） |
| 抖音/BYOK adapter 装配 | **硬编码 `new RecordedDouyinAdapter()`** | `main.ts:326,334` | ✅ 装配方式选择（recorded/real） |
| 模型激活证据（live_verified 门禁） | 填 3 个 `MODEL_*_ACTIVATION_*` env | `runtime-config.ts:91-94,205-333` | ✅ 激活流程 UI（+真实探针，见诊断动作 A） |
| 套餐/定价/额度 | 见 `admin-plan-control` 只读 | `admin-plan-control.tsx`（0 mutation） | ✅ 可写 |

### 2.4 持久化缺口（比 UI 更底层的问题）

- **无任何 DB 配置表**：`src/db/` 下 grep `settings/config/systemConfig` 零命中。
- **模型目录仍是 in-memory**：`catalog.ts:110` `new Map`，`ModelPreferenceRegistry`（`catalog.ts:449`）进程重启即失（诊断 Lane 3 P2-1 已记）。
- **后端零配置写入端点**：`server.ts` 无 admin config 写入路由。

→ 意味着：**做可视化后台前，得先有"配置持久层"**（DB 配置表 / 配置服务），否则前台点选的值重启就丢。这是本功能的隐藏前置。

---

## 三、已批准范围（待开发实现）

### 3.1 必须可视化的配置域（按诊断优先级排）

1. **模型与执行配置**（最高，直接解诊断病根）
   - 执行模式档位切换（recorded/fixture/gateway/direct + 媒体 disabled/ark）
   - Provider 凭据管理（脱敏输入、测试连接、AWS Secrets 桥接）
   - 模型激活流程（配 + 触发真实探针 smoke + 落激活证据，替代当前哈希伪装）
   - 模型目录治理（**已有 `admin-model-control` 1876 行地基，扩激活/凭据部分即可**）

2. **集成与连接器配置**
   - 抖音/BYOK adapter 装配方式（recorded ↔ real 前台切换，替代 `main.ts:326,334` 硬编码）
   - 飞书/企微通知连接器（**已有 `admin-feishu-tool-control` 地基**）

3. **套餐/定价/额度**（`admin-plan-control` 补可写）

4. **合规与开关**（水印/AIGC 标识/Regulated Mode 默认值——呼应诊断 Lane 3 P1-4）

5. **审计/运维健康**（`admin-audit-control`/`admin-operations-health` 已有只读，按需补操作）

### 3.2 隐藏前置（必须先做，否则前台配置重启即丢）

- **配置持久层**：DB 配置表 + 配置服务（读写、版本、审计、workspace 作用域）
- **配置生效机制**：热加载 vs 重启生效的边界（provider 装配能否运行时切换）

### 3.3 明确边界

- 面向**平台管理员**（不是门店商家）——与 ContentPackage 那条"商家一级导航只留创作/内容/素材/门店"不冲突，这是**二级/管理面**。
- 标准 SaaS 管理后台 UI 形态（用户后续另有"标准 SaaS 管理员后台 UI"诉求，与本条合并考量）。
- 买 vs 建：mkfast 模板原生 admin + 已有 1876 行 model-control 是地基，**优先扩现有、不新造框架**（符合成熟组件优先原则）。

---

## 四、与阶段诊断的关系

- 本功能**不是新范围膨胀**，而是诊断病根"改代码才能配"的**根治**：诊断动作 E（抖音/BYOK 停止"只差 Key"表述、须换装配）、动作 C/A（激活证据从哈希升级为真实探针）——这些如果做成 admin 可视化配置，就从"每次改代码"变成"一次建好、长期点选"。
- **依赖关系**：配置持久层（§3.2）应在 ContentPackage 架构拍板（动作 0）后、与真实链路打通（动作 C）**并行或稍后**推进——因为"跑通一条真实链路"本身就需要能配 provider 凭据，可视化配置是它的自然延伸。
- **当前排序**：已按 D11–D12 列入待开发，与 ContentPackage 六工作流一起推进（可作为 E3/E6 的配套管理面，或独立 E7）。
