# 当前真实主链、代码规模与退役面审计

> 审计日期：2026-07-24  
> 代码采样：2026-07-24 03:39 CST  
> 工作区：`/Users/bin/Desktop/开发/内容无人区/美业内容2`  
> 性质：只读代码审计；本报告不修改产品代码、不删除数据、不替后续决策票做最终产品决策。

## 1. 结论先行

当前代码已经形成一个明确的新入口和执行根：

```text
ComposerHome
  -> POST /api/core/p1/composer/submissions
  -> Core Composer admission gate
  -> immutable CreationExecutionSnapshot
  -> Work + Task + ContentPackage shell
  -> DBOS Harness
  -> ModelSupply / ContentPackage
  -> Result Center
```

但三种模态的实际闭环程度并不相同：

| 模态 | 当前代码可达终点 | 结论 |
| --- | --- | --- |
| 文案 | `ContentPackage` 新版本，状态 `review_ready`，Result Center 可读取 | **结构上闭环**；本次只做本地测试，没有用真实数据库、真实模型供应商做现场 E2E |
| 图片 | 能完成准入、快照、Harness 编译并把 `image.generate` 放入 durable media job | **未闭环**；初次提交得到非完成态后抛出 `MEDIA_RECONCILIATION_PENDING`，没有发现媒体任务完成后重新汇入 Harness 第 5 阶段的生产观察者 |
| 视频 | 与图片相同，能进入 `video.generate` durable media job | **未闭环**；另有一套 composed-video 工作流，但它不是 Composer 当前这条单成品主链的续接器 |

最重要的六项发现：

1. **入口已收敛，内部尚未真正收敛。** 首页明确挂载 `ComposerHome`，旧 direct Harness API 已返回 410；但 Core 仍同时装配 legacy/P1 `ProductService`、独立 copy stream、独立 composed-video、Pro Studio/Canvas 和大型供应控制面。
2. **媒体主链存在 P0 级代码闭环缺口。** durable media worker 能轮询供应商、下载并持久化资产，但没有发现把完成结果唤回原 Harness workflow、继续 `assembleMediaAndDeliver()` 的连接。
3. **状态事实源重复且会分叉。** Composer 创建时把 Work 固定为 `running`、Task 固定为 `in_progress`；交付只更新 `ContentPackage` 为 `review_ready`，不更新前两者。Result Center 又以“是否出现当前 Package 版本”覆盖进度，因此 UI 成功不等于所有持久化状态已经终态。
4. **两套文案流同时留在结果页。** 新 Harness SSE 与旧 `CreativeJob -> /p1/copy/stream` 结构化流并存；Composer submission 本身不创建 `CreativeJob`，所以后者不是新主链的可靠组成部分。
5. **未挂载实现与测试叙事已经漂移。** `CreationShelf`、`VideoWorkflowLauncher` 生产源码只有定义、没有入口引用，但 E2E 仍把 `CreationShelf` 写成“owning daily creation entry”。
6. **仓库“大”主要不是单一产品主链造成的。** 排除本轮研究产物后，生产运行源码约 33.94 万物理行；测试约 21.11 万行；reference 约 8.39 万行；证据、截图和历史输出约 42.27 万物理行且占 422.72 MiB。任何缩减目标都必须分层，不能用仓库总行数冒充运行时代码规模。

## 2. 审计边界与证据等级

### 2.1 当前工作区边界

审计在脏工作区上完成，没有 reset、stash 或覆盖用户改动。采样时至少有：

- 20 个 tracked 文件存在未提交修改，`git diff --stat -- . ':(exclude)pnpm-lock.yaml'` 为 656 insertions / 336 deletions；
- 新 Composer BFF/client、route resolver、Wayfinder 地图与其他 review 资产处于 untracked 状态；
- 本报告把这些“当前可见代码”视为审计对象，但不会把未提交状态误写成已经发布。

基线命令：

```bash
cd /Users/bin/Desktop/开发/内容无人区/美业内容2
git status --short --branch
git diff --stat -- . ':(exclude)pnpm-lock.yaml'
git ls-files --others --exclude-standard
```

### 2.2 证据等级

本报告用以下标签约束结论：

- **生产代码事实**：当前生产路径有明确调用或挂载；
- **测试事实**：测试证明合同或分支，但可能只用了 fake/stub；
- **代码推断**：由调用链和全仓搜索得出，尚未用真实运行环境复现；
- **候选决策**：只进入后续“保留/冻结/退役”讨论，不是本票最终决定。

没有把设计文档中的目标状态当成实现状态。设计地图要求的线性目的地见：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/.wayfinder/map-lightweight-personalized-generation-spine.md:10`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/.wayfinder/map-lightweight-personalized-generation-spine.md:16`

## 3. 可复算代码规模

### 3.1 口径

- 输入集合：`git ls-files -co --exclude-standard`，即 tracked 加未忽略 untracked 文件；
- 行数：文本文件换行数，等价于逐文件 `wc -l`；二进制文件只计文件数和字节数；
- 优先级：reference → vendored → evidence/history → generated → migrations → tests → docs/planning → production → scripts/config → runtime assets → other；
- 为避免“报告把自己算进去”，排除 `.wayfinder/**` 与 `references/analysis/lightweight-generation-spine-research-2026-07-24/**`；
- `production-code` 只含 Core、Web、Canvas、contracts 的运行源码，不含测试、vendor、generated、migration 和构建脚本。

### 3.2 采样结果

| 分类 | 文件数 | 文本物理行 | 体积 | 二进制文件 | 说明 |
| --- | ---: | ---: | ---: | ---: | --- |
| production-code | 1,215 | 339,354 | 10.21 MiB | 0 | Core/Web/Canvas/contracts 运行源码 |
| tests | 792 | 211,101 | 6.42 MiB | 0 | unit/integration/static/e2e |
| generated | 4 | 15,955 | 0.57 MiB | 0 | route tree、auth schema、worker typings、next-env |
| vendored | 40 | 5,575 | 0.24 MiB | 0 | `apps/canvas/src/vendor/vozeb/**` |
| reference | 598 | 83,867 | 62.08 MiB | 123 | 外部参考源码、研究材料、原型 |
| docs-planning | 161 | 28,999 | 2.83 MiB | 7 | 文档与规划；不含本轮 Wayfinder 产物 |
| migrations | 18 | 4,682 | 0.13 MiB | 0 | migration/drizzle |
| evidence-history | 1,745 | 253,582 | 422.72 MiB | 508 | `.scratch`、截图、测试结果、证据 |
| scripts-config-lock | 90 | 31,443 | 1.03 MiB | 0 | 脚本、CI、配置、lock |
| runtime-assets-content | 75 | 9,229 | 4.40 MiB | 49 | public/content/locale/runtime JSON |
| other | 16 | 542 | 0.03 MiB | 0 | 未落入上述边界的少量元数据 |
| **合计** | **4,754** | **984,329** | — | **687** | 排除本轮 Wayfinder 自身产物 |

由此可复算：

- 生产运行源码只占文本物理行的约 **34.5%**；
- 测试物理行约为生产运行源码的 **62.2%**；
- evidence/history 单项体积远大于运行源码；
- “删 reference、截图或 generated”可以缩仓库，但不会自动降低运行时架构复杂度。

生产运行源码内部：

| 边界 | 文件数 | 物理行 |
| --- | ---: | ---: |
| Core | 413 | 179,570 |
| Web | 700 | 129,507 |
| Canvas | 76 | 22,592 |
| Contracts | 26 | 7,685 |

测试内部：

| 边界 | 文件数 | 物理行 |
| --- | ---: | ---: |
| Core | 353 | 135,353 |
| Web | 355 | 59,370 |
| Canvas | 53 | 10,321 |
| Contracts | 15 | 1,962 |
| 根级/脚本测试 | 16 | 4,095 |

### 3.3 复杂度集中点

最大的生产文件不是 Composer 主链本身，而是 Operations、ModelSupply、Integrations、旧 Product 和管理控制面：

| 文件 | 物理行 |
| --- | ---: |
| `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/operations/application-service.ts` | 10,078 |
| `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts` | 6,371 |
| `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts` | 5,647 |
| `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/application-service.ts` | 4,200 |
| `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/product/product-service.ts` | 3,601 |
| `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/integration-settings.tsx` | 2,424 |
| `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/server.ts` | 2,373 |
| `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/canvas/src/client/canvas-shell.tsx` | 2,236 |
| `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/admin-model-control.tsx` | 2,086 |
| `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/supply-registry/postgres-admin-supply-runtime.ts` | 2,071 |

这说明轻量化不能只压缩 Composer 组件；更大的决策在于首发运行时是否仍必须装配整个 Product cutover、供应治理、集成和专业画布。

### 3.4 可复算脚本

在 `/Users/bin/Desktop/开发/内容无人区/美业内容2` 执行：

```bash
node <<'NODE'
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const files = [...new Set(
  execFileSync(
    'git',
    ['ls-files', '-co', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  ).split('\0').filter(Boolean),
)]
  .filter((path) =>
    !path.startsWith('.wayfinder/') &&
    !path.startsWith(
      'references/analysis/lightweight-generation-spine-research-2026-07-24/',
    ),
  )
  .sort();
const codeExt = /\.(?:[cm]?[jt]sx?|css)$/;
const isTest = (path) =>
  /(^|\/)(?:tests?|__tests__|e2e)(\/|$)/.test(path) ||
  /\.(?:test|spec)\.[^.]+$/.test(path);
function category(path) {
  const base = path.split('/').at(-1) ?? path;
  if (path.startsWith('references/')) return 'reference';
  if (/(^|\/)vendor\//.test(path)) return 'vendored';
  if (
    /(^|\/)(?:\.scratch|\.playwright-cli|output|test-results)(\/|$)/.test(path) ||
    /(^|\/)docs\/evidence\//.test(path)
  ) return 'evidence-history';
  if (
    /\.gen\.[^.]+$/.test(base) ||
    path === 'mkfast-template-main/src/db/auth.schema.ts' ||
    path === 'mkfast-template-main/worker-configuration.d.ts' ||
    base === 'next-env.d.ts'
  ) return 'generated';
  if (/(^|\/)(?:migrations?|drizzle)(\/|$)/.test(path)) return 'migrations';
  if (isTest(path)) return 'tests';
  if (/(^|\/)docs\//.test(path) || /\.md$/i.test(path)) return 'docs-planning';
  if (
    codeExt.test(path) &&
    (
      path.startsWith('apps/core/src/') ||
      path.startsWith('apps/canvas/src/') ||
      path.startsWith('apps/canvas/app/') ||
      path.startsWith('apps/canvas/lib/') ||
      path.startsWith('apps/canvas/stores/') ||
      path.startsWith('packages/contracts/src/') ||
      path.startsWith('mkfast-template-main/src/')
    )
  ) return 'production-code';
  if (
    /(^|\/)(?:scripts|\.github|ops)(\/|$)/.test(path) ||
    /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|compose\.yaml|Dockerfile|\.env\.example|\.gitignore|components\.json|skills-lock\.json|[^/]*\.config\.[^.]+|tsconfig[^/]*\.json|biome\.json|wrangler[^/]*\.jsonc|promptfoo[^/]*\.ya?ml)$/.test(path)
  ) return 'scripts-config-lock';
  if (
    /(^|\/)(?:public|assets|content|locales?|project\.inlang\/messages)(\/|$)/.test(path) ||
    /(^|\/)src\/.*\.json$/.test(path)
  ) return 'runtime-assets-content';
  return 'other';
}
const totals = new Map();
for (const path of files) {
  const bytes = fs.readFileSync(path);
  const stat = fs.statSync(path);
  const binary = bytes.includes(0);
  const lines = binary
    ? 0
    : (bytes.toString('utf8').match(/\n/g) || []).length;
  const key = category(path);
  const row = totals.get(key) || { files: 0, lines: 0, bytes: 0, binary: 0 };
  row.files += 1;
  row.lines += lines;
  row.bytes += stat.size;
  row.binary += binary ? 1 : 0;
  totals.set(key, row);
}
console.log(JSON.stringify({
  totalFiles: files.length,
  categories: Object.fromEntries([...totals.entries()].sort()),
}, null, 2));
NODE
```

## 4. 共用入口与执行根

### 4.1 用户入口

生产首页直接挂载 `ComposerHome`：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/index.tsx:1`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/index.tsx:98`

Composer 的三模态到模型操作映射是：

- `copy -> copy.generate`
- `image_text -> image.generate`
- `video -> video.generate`

证据：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-live.ts:37`

界面先读取 Surface、Identity、usage、catalog、Recipe、model 和 quote；核心选择逻辑位于：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-home.tsx:257`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-home.tsx:305`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-home.tsx:373`

提交前会重新请求/校验 Brief，确认 ProductQuote，收集带 revision 的素材，然后提交：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-home.tsx:636`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-home.tsx:649`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-home.tsx:665`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-home.tsx:684`

成功后跳转到 Result Center，并把 `taskId` 放入 search：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-home.tsx:722`

### 4.2 Web BFF 与 Core 入口

Web client POST 到 `/api/core/p1/composer/submissions`：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-submission-client.ts:77`

BFF 只负责转发：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/api/core/p1/composer/submissions.ts:5`

Core 执行身份解析、授权、Core schema parse，调用 Coordinator，返回 202：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/server.ts:1187`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/server.ts:1204`

### 4.3 服务器重新绑定事实

浏览器只传 ID/revision。`ComposerSubmissionAdmissionGate` 会重新解析：

- 已发布 Recipe 与其 lens/delivery/model policy；
- Surface 是否仍公开该 Recipe；
- 已确认或已预留、且绑定 Task 的 ProductQuote；
- fixed route snapshot；
- 当前 workspace 的 MarketingIdentity、素材 rights、Brief confirmation 和 source package。

关键证据：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/composer-submission-gate.ts:113`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/composer-submission-gate.ts:129`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/composer-submission-gate.ts:185`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/composer-submission-gate.ts:204`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/main.ts:1564`

`CreationExecutionSnapshot` 冻结 Task/Work/Package、intent、Recipe、lens、platform、deliverables、sources、rights、identity、model、quote、route 和 Brief：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/creation-execution-snapshot.ts:67`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/creation-execution-snapshot.ts:75`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/creation-execution-snapshot.ts:140`

这是当前主链最值得保留的执行根：它把浏览器可变选择收敛为服务器确认后的不可变事实。

### 4.4 持久化与 Harness 准入

Coordinator 先准入，再分配 Work/ContentPackage ID，创建 snapshot，以 idempotency claim 持久化，最后启动 Harness：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/submission-coordinator.ts:115`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/submission-coordinator.ts:128`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/submission-coordinator.ts:145`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/submission-coordinator.ts:183`

Postgres persistence 在一个准入事务内写：

- `p1_creative_works`：初始 `running`；
- `p1_content_tasks`：初始 `in_progress`；
- `p1_content_packages`：revision 0 shell；
- usage reservation；
- `execution_spine.creation_submissions`：保存幂等根和 Harness start lease。

证据：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:116`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:162`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:187`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:248`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:379`

`CreationStagePort` 保持 Coordinator Task ID 作为 Harness workflow ID：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/creation-stage-port.ts:21`

Harness admission 以 Task ID 和请求 fingerprint 去重，DBOS starter 异步启动 workflow：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/task-admission.ts:100`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/dbos-workflow.ts:140`

## 5. 文案真实路径

```text
Composer copy
  -> admission + CreationExecutionSnapshot(lens=copy)
  -> Harness intent_naming
  -> context_injection / ContextBundle
  -> brief_compilation / ExecutionBrief
  -> execution_selection / copy candidates
  -> context fence; changed facts trigger recompile
  -> assembly_delivery
  -> ContentPackage revision + recommended candidate
  -> workflow SSE + Result Center
```

### 5.1 五阶段执行

Harness 显式定义五个语义阶段：

- `intent_naming`
- `context_injection`
- `brief_compilation`
- `execution_selection`
- `assembly_delivery`

证据：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/workflow-core.ts:143`

文案分支依次执行 intent、context、Brief、selection；Context fence 发现事实变化后会重新编译和选择，最后写交付：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/workflow-core.ts:233`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/workflow-core.ts:260`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/workflow-core.ts:281`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/workflow-core.ts:309`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/workflow-core.ts:331`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/workflow-core.ts:416`

生产 stage ports 会：

- 编译并冻结 Context；
- 编译绑定 snapshot 的 copy Brief；
- 校验 Identity 与素材引用；
- 调用 structured runner 生成、校验和评分候选；
- 把所有候选版本及 winner 写入同一个 `ContentPackage`。

证据：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/production-stage-ports.ts:165`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/production-stage-ports.ts:213`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/production-stage-ports.ts:221`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/production-stage-ports.ts:258`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/production-stage-ports.ts:351`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/production-stage-ports.ts:453`

`ContentPackageRevisionWritePort` 使用 revision/OCC/idempotency，写入 current version、generated lineage 和 `review_ready`：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/content-package-revision-port.ts:163`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/content-package-revision-port.ts:221`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/content-package-revision-port.ts:261`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/content-package-revision-port.ts:265`

### 5.2 结果读取

Result Center 同时订阅 Harness workflow events、读取 creative workbench 和 ContentPackages：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/results_/$workId.tsx:120`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/results_/$workId.tsx:130`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/results_/$workId.tsx:154`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/results_/$workId.tsx:200`

一旦出现 `currentPackageVersion`，页面直接投影为 success，并以该版本构造 copy/image worksurface：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/results_/$workId.tsx:350`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/results_/$workId.tsx:452`

交付层已经支持复制、单文件下载、朋友圈 caption、完整包导出和 assisted handoff：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/results_/$workId.tsx:1377`

### 5.3 结论

**生产代码事实：** 文案新主链从 Composer 到 `ContentPackage` 的结构是闭合的。  
**限制：** 本票没有真实 provider credential、Postgres 和 worker 现场运行证据，不能把“结构闭合”升级为“生产环境已完成 E2E”。

## 6. 图片真实路径

```text
Composer image_text
  -> CreationExecutionSnapshot(lens=image)
  -> same intent/context/Brief semantics
  -> mediaSubmission(operation=image.generate)
  -> ModelSupply durable media runtime
  -> tracer job queued
  -> provider submit/poll/download
  -> owned asset persisted
  -X-> original Harness resumes assembly_delivery
  -X-> ContentPackage receives terminal image version
```

Harness 按 snapshot lens 分流到 media workflow：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/workflow-core.ts:189`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/workflow-core.ts:454`

图片/视频共享的 adapter 会把 image Brief 转成固定模型 `image.generate` submission：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/unified-media-stage-ports.ts:161`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/unified-media-stage-ports.ts:244`

`DurableMediaGenerationApplicationService.submit()` 创建 durable job 后立即读取当前 job view 并返回：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/media-generation-workflow.ts:53`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/media-generation-workflow.ts:64`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/media-generation-workflow.ts:85`

Postgres tracer submit 初始状态是 `queued`，worker 由 `MODEL_MEDIA_GENERATION_JOB_KIND` 注册：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/job-runtime/tracer-worker.ts:756`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/job-runtime/tracer-worker.ts:770`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/job-worker.ts:496`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/job-worker.ts:669`

worker effect 本身能轮询、下载、持久化 owned asset 并写 completed result：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/media-generation-workflow.ts:218`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/media-generation-workflow.ts:268`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/media-generation-workflow.ts:331`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/media-generation-workflow.ts:362`

但是 Harness media adapter 收到任何非 `completed + asset` 的首次返回时会抛：

- `code = MEDIA_RECONCILIATION_PENDING`
- `status = 202`

证据：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/unified-media-stage-ports.ts:172`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/unified-media-stage-ports.ts:190`

DBOS workflow 对任意异常都会记录 terminal failure 后重新抛出，而 Coordinator 在 `DBOS.startWorkflow()` 返回后就把 Harness start lease 标记成 started：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/dbos-workflow.ts:118`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/dbos-workflow.ts:150`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/submission-coordinator.ts:188`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/submission-coordinator.ts:193`

全仓生产代码搜索只发现 `MEDIA_RECONCILIATION_PENDING` 的抛出点，没有发现 observer/join/resume 消费者：

```bash
cd /Users/bin/Desktop/开发/内容无人区/美业内容2
rg -n --glob '!**/*.test.*' \
  'MEDIA_RECONCILIATION_PENDING|mediaGeneration\.get\(|MODEL_MEDIA_GENERATION_JOB_KIND' \
  apps/core/src mkfast-template-main/src
```

**代码推断：** 当前图片提交能准入和排队，也可能由 worker 成功生成/存储资产，但原 Harness 会先失败，worker 完成后没有生产代码把该资产续接到 `assembleMediaAndDeliver()`。因此图片主链不能被认定为端到端完成。

## 7. 视频真实路径

视频 Composer 路径与图片共用第 1 至第 4 阶段和同一个 durable media adapter，只是 submission 改为：

- `operation = video.generate`
- input 带 `durationSeconds`、ratio、reference assets；
- prompt 由 first-frame prompt 与 storyboard 拼接。

证据：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/unified-media-stage-ports.ts:244`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/unified-media-stage-ports.ts:265`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/unified-media-stage-ports.ts:276`

如果 selection 已经带 completed asset，共享交付端可以把视频 owned asset 写入 `ContentPackage`：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/unified-media-stage-ports.ts:117`

但真实 durable submit 的首次返回仍是非完成态，因此视频有与图片相同的 join 缺口。

仓库另有 `PersistentContentWorkflowRunner` 和 `DurableComposedVideoApplicationService`：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/main.ts:761`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/main.ts:783`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/job-worker.ts:460`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/job-worker.ts:482`

它负责更重的分镜/合成/质量评分工作流。当前 Composer media adapter 直接调用 `video.generate`，没有调用这个 runner；`VideoWorkflowLauncher` 也没有生产入口引用。因此 composed-video 是一条独立能力，不是当前缺失 join 的实现。

**代码推断：** 视频主链目前与图片一样，只能确认“准入并排队”，不能确认“成片进入统一 ContentPackage 并在 Result Center 完成”。

## 8. 状态机与事实源审计

| 对象/状态机 | 创建/更新点 | 当前用途 | 问题 |
| --- | --- | --- | --- |
| `execution_spine.creation_submissions.harness_state` | submission store | dispatch 幂等与 start lease | 只表示已发起 DBOS，不表示生成完成 |
| DBOS Harness workflow state/progress | Harness DBOS | 5 阶段进度、token、failure | media pending 被当 terminal failure |
| `model.media-generation` tracer job | job runtime/worker | provider submit/poll/download | 与原 Harness 没有 join |
| Work `status` | Composer reserve | workbench/history | 创建为 `running`，交付未更新 |
| Task `status` | Composer reserve | async task center | 创建为 `in_progress`，交付未更新 |
| ContentPackage revision/status | sole write port | 成品、lineage、Result Center | 成为事实成功源 |
| CreativeJob | Operations/旧 Product 流 | copy stream、部分 workbench 投影 | Composer reserve 不创建 |

### 8.1 Work/Task/Package 分叉

创建初态：

- Work `running`：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:154`
- Task `in_progress`：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:178`

交付只更新 `p1_content_packages`：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/content-package-revision-port.ts:227`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/content-package-revision-port.ts:261`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/content-package-revision-port.ts:265`

在 execution-spine delivery 与 Harness 生产代码中搜索不到对 `p1_creative_works` / `p1_content_tasks` 的终态更新：

```bash
cd /Users/bin/Desktop/开发/内容无人区/美业内容2
rg -n 'p1_creative_works|p1_content_tasks' \
  apps/core/src/p1/execution-spine/content-package-revision-port.ts \
  apps/core/src/p1/harness \
  --glob '!**/*.test.*'
```

Result Center 又以 `currentPackageVersion` 强制成功：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/results_/$workId.tsx:350`

这会造成：

- Result Center 已成功，历史 Work 仍可能 running；
- AsyncTaskCenter 仍可能显示 in_progress；
- 监控、重试和用户界面可能对同一执行得出不同结论。

### 8.2 建议的收缩原则

后续结果合同票应选一个 canonical execution state：

1. durable generation task/job 是执行真相；
2. `ContentPackage` 是成品真相；
3. Work/Task 只做投影，由同一 terminal observer 更新；
4. UI 不再用“出现 Package 版本”隐式覆盖未收敛的执行状态。

本票不决定具体表结构或迁移方式。

## 9. 重复路径、重复合同与未进入主链的框架

### 9.1 Harness SSE 与 copy stream 双流

Result Center 总是准备 Harness stream，同时在 `selected.job` 存在且是 copy job 时启动独立 `/p1/copy/stream`：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/results_/$workId.tsx:130`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/results_/$workId.tsx:165`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/copy-stream.tsx:59`

Core copy stream 又调用 Operations `startCreativeCopyStream()`：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/server.ts:1807`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/server.ts:1843`

Composer store 只创建 Work、Task、ContentPackage，没有创建 `p1_creative_jobs`。因此：

- 对新 Composer Work，结构化 copy stream 没有稳定的 CreativeJob 根；
- Harness token stream 已经能携带 copy token；
- 两套流增加状态合并、测试和恢复复杂度。

**候选决策：** 新主链保留一个 token/progress 通道；旧 CreativeJob copy stream 在消费者迁移完成后冻结或退役。

### 9.2 Web/Core 重复 Composer schema

Web 本地重新定义 Composer request/result Zod schema：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-submission-client.ts:7`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-submission-client.ts:16`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/composer/composer-submission-client.ts:49`

Core 又有自己的 request/body/snapshot schema：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/creation-execution-snapshot.ts:4`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/creation-execution-snapshot.ts:106`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/creation-execution-snapshot.ts:123`

仓库已有共享 contracts：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/packages/contracts/src/index.ts:1`

**候选决策：** 共享 transport DTO/schema；Core 保留 server-only snapshot schema。不要让 Web 复制 server 事实绑定逻辑。

### 9.3 legacy 与 P1 ProductService 双装配

主进程同时初始化 legacy/P1 ModelSupply control plane 和两个 `ProductService`，再由 `CutoverProductService` 路由：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/main.ts:649`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/main.ts:660`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/main.ts:682`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/main.ts:939`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/main.ts:952`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/main.ts:982`

旧 `/state`、`/commands` 产品 API 仍由该 service 提供：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/server.ts:2074`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/server.ts:2104`

这是实际运行中的兼容路径，不能直接删除。它应进入消费者清单和迁移计数，而不是永久留作“保险”。

### 9.4 已返回 410 的兼容面

以下入口已经是明确退役语义：

- direct Harness task admission：
  `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/server.ts:1478`
- content-generation diagnostics POST：
  `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/server.ts:2060`
- diagnostics resume：
  `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/server.ts:2351`

**候选决策：** 保留一个版本窗口的 410/遥测后，删除 handler、route parser 和专属测试；否则“已退役 API”仍长期占用维护面。

### 9.5 未挂载 UI

生产源码全仓引用显示：

- `CreationShelf` 只有定义：
  `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/creation-shelf.tsx:274`
- `VideoWorkflowLauncher` 只有定义：
  `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/product/video-workflow-launcher.tsx:98`
- 当前首页挂载 `ComposerHome`：
  `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/index.tsx:98`

复算：

```bash
cd /Users/bin/Desktop/开发/内容无人区/美业内容2
rg -n --glob '!**/*.test.*' --glob '!**/routeTree.gen.ts' \
  'CreationShelf|VideoWorkflowLauncher' \
  mkfast-template-main/src
```

E2E 仍写着 “CreationShelf is the owning daily creation entry”：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/tests/e2e/specs/pro-studio-engineering-tickets.spec.ts:434`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/tests/e2e/specs/pro-studio-engineering-tickets.spec.ts:456`

这是明确的代码/测试叙事漂移。未挂载实现应冻结，E2E 应改测真实 Composer 路由，或明确移入历史套件。

### 9.6 已挂载、可复用的支持能力

不是所有“非生成代码”都应退役。当前仍挂载：

- `CanonicalHistoryPage`：assets/jobs/recent/home view 等路由；
- `AsyncTaskCenter`：桌面 sidebar 和移动 shell。

证据：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/assets.tsx:1`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/jobs.tsx:1`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/dashboard/recent.tsx:1`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/components/layout/sidebar-layout.tsx:12`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/components/layout/sidebar-layout.tsx:107`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/components/layout/dashboard-sidebar.tsx:25`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/components/layout/dashboard-sidebar.tsx:93`

这些是轻量产品仍需要的“结果可找回、任务可观察”能力，但应建立在单一任务/成品状态合同上。

## 10. 测试覆盖与证明边界

### 10.1 本票实际执行

```bash
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/execution-spine/composer-http.test.ts \
  src/p1/execution-spine/composer-submission-gate.test.ts \
  src/p1/execution-spine/creation-stage-port.test.ts \
  src/p1/execution-spine/sole-write-port.contract.test.ts \
  src/p1/harness/unified-media-stage-ports.test.ts

pnpm --filter @meiye/core typecheck
pnpm --filter @meiye/web check
```

结果：

- targeted Core：21/21 pass；
- Core typecheck：pass；
- Web check：Biome 检查 1,007 files，pass。

### 10.2 这些测试没有证明什么

Composer transport 测试对 copy/image/video 都返回 202，但使用的是 `RecordingHarnessStarter` 和 fixture reader；它验证准入、幂等、SSE/projection 合同，没有真正执行 Harness 和 provider：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/composer-http.test.ts:240`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/composer-http.test.ts:331`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/composer-http.test.ts:352`

media adapter 测试中的 `submit()` 直接返回 `completedResult()`，所以能写 Package；另一个测试只证明未知结果会抛 `MEDIA_RECONCILIATION_PENDING`：

- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/unified-media-stage-ports.test.ts:22`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/unified-media-stage-ports.test.ts:25`
- `/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/unified-media-stage-ports.test.ts:162`

因此现有绿色测试不能作为“真实图片/视频从 Composer 到 Package 已闭环”的证据。

### 10.3 缺少的关键合同测试

后续实现前至少需要：

1. real Postgres + job runtime 的媒体 join 测试：queued → running → completed → Harness 继续 → Package review_ready；
2. failure/cancel/unknown 的单一终态投影测试；
3. Work/Task/Package terminal state 一致性测试；
4. Composer 新入口不得创建第二条 CreativeJob 文案流的静态/合同测试；
5. 当前 dashboard 路由级 E2E，替换旧 CreationShelf 入口叙事；
6. fixture 与真实 provider 模式分别声明，不用 fixture success 代替 live proof。

## 11. 初步保留、收缩、插件化、冻结与退役矩阵

> 这是研究结论，不是最终产品决定。真正删除、迁移或改变数据合同必须由后续独立决策票确认。

| 能力/模块 | 当前代码事实 | 初步分类 | 前置条件 |
| --- | --- | --- | --- |
| `ComposerHome` + 单一 submission API | 当前生产入口 | **保留，主链必需** | 去掉 client/Core DTO 漂移 |
| server admission gate + `CreationExecutionSnapshot` | 服务器重验事实、冻结执行根 | **保留，主链必需** | 继续保持 provider 字段不污染领域快照 |
| ContextBundle / Identity / rights / source revision | 生成前的个性化与合规事实 | **保留，可复用基础** | 由上下文专项票进一步去重 |
| `ContentPackageRevisionWritePort` | OCC、幂等、lineage、sole write | **保留，主链必需** | 与任务终态建立单一 observer |
| owned asset/storage receipt | 媒体成品标准化基础 | **保留，主链必需** | 补 media join |
| Result Center / history / async task observer | 已挂载，用户找回结果所需 | **保留但收缩** | 统一 task/package 状态和 stream |
| 五阶段 Harness 语义 | 文案链已用；media 也复用 | **保留语义、收缩实现候选** | lpgs-10 决定保留 DBOS 五阶段还是编译器 + durable job |
| ModelSupply 核心执行 | provider route、usage、asset receipt | **保留但收缩** | 抽出最小 adapter/task contract |
| supply planning/hot assembly/admin control plane | 主进程整体装配，体量大 | **冻结或独立控制面候选** | 证明首发主链实际需要的最小子集 |
| legacy/P1 `ProductService` cutover | 仍服务 `/state`、`/commands` | **冻结新增、迁移后退役候选** | 列出实际调用方、数据和 in-flight decision |
| CreativeJob copy stream | 结果页仍支持，但 Composer 不创建 job | **冻结/退役候选** | Harness token stream 成为唯一通道 |
| composed-video workflow | 可独立运行，但不是当前 Composer join | **独立插件候选** | 首发是否需要多镜头合成由范围票决定 |
| Pro Studio / Canvas | 专业编辑能力，生产代码独立且有 vendor | **独立插件候选** | 保留 Package/asset handoff，避免主进程强依赖 |
| integrations / 自动发布 / CRM 类能力 | 体量大，偏离轻量生成主干 | **独立插件或移出首发候选** | 数据所有权与回调消费者迁移 |
| `CreationShelf` | 未挂载 | **冻结候选** | 确认无深链/实验入口后删除 |
| `VideoWorkflowLauncher` | 未挂载 | **冻结候选** | composed-video 若插件化则迁入插件 |
| direct Harness 410 handler | 明确退役语义 | **退役候选** | 版本窗口、调用遥测归零 |
| diagnostics POST/resume 410 handler | 明确退役语义 | **退役候选** | 版本窗口、调用遥测归零 |
| Web 重复 Composer Zod schema | 与 Core DTO 并行维护 | **合并/退役候选** | shared contracts 发布 |
| historical references / `.scratch` / evidence | 不进入运行时 | **只读历史** | 归档/外置，不与生产删码混报 |
| migrations/cutover 代码 | 部分仍是运行依赖 | **先冻结，完成迁移后只读历史** | 迁移账、消费者和回滚窗口闭合 |

## 12. 建议的收缩顺序

### 第一阶段：先修主链真相，不先做大删码

1. 补齐 image/video durable job → Harness/Package 的 terminal join；
2. 选定一个 canonical execution state，统一 Work/Task/Package 投影；
3. 让新 Composer 只保留一套 progress/token 通道；
4. 建立真实数据库 + worker 合同测试。

### 第二阶段：切断并行入口

1. 盘点 `/state`、`/commands` 和 CreativeJob copy stream 的真实消费者；
2. 对未挂载 `CreationShelf`、`VideoWorkflowLauncher` 停止新增；
3. 修订或隔离仍宣称旧入口为主入口的 E2E；
4. 给 legacy/P1 cutover 设退出条件，不长期双装配。

### 第三阶段：插件化重能力

1. Pro Studio/Canvas 通过 Package/asset contract 独立；
2. composed-video 作为高级视频插件，不充当基础 `video.generate` 的隐式依赖；
3. integrations/publishing/CRM 与生成 spine 通过明确事件/合同连接；
4. supply admin/control plane 与在线生成 data plane 分进程或分部署。

### 第四阶段：最后删除兼容和历史面

1. 410 入口遥测归零后删 handler/parser/test；
2. legacy 数据与 in-flight job 清零后删双 Service；
3. 归档 `.scratch`、大体积 evidence/reference；
4. 删除 completed cutover/migration runtime code，但保留不可变迁移记录。

## 13. 后续决策票必须回答的问题

1. 媒体 job 完成后，谁拥有推进 `ContentPackage` 和 execution terminal state 的唯一权力？
2. 五阶段 Harness 是必须保留的 durable product semantics，还是可收缩为 `PromptCompiler + GenerationTask + ResultAssembler`？
3. 文案、图片、视频共享的是完整内部阶段，还是只共享 input/task/result contracts？
4. Work、Task、CreativeJob、DBOS workflow、ModelSupply job 中哪些是领域对象，哪些只是实现投影？
5. legacy `/state`、`/commands`、copy stream、composed video、Canvas 和 integrations 各自还有哪些真实消费者？
6. 首发是否只需要 fixed model + 小型 provider adapter；复杂供应治理是否移到独立 control plane？
7. 哪些 E2E 是当前产品门禁，哪些只是历史工程票证据？

## 14. 最终判断

当前项目不是“没有主链”，而是**已经有了一个正确方向的新主链入口和执行快照，但它被旧产品服务、双流、多个任务/结果状态机和重型独立能力包围；同时 media 异步结果还没有真正汇回统一成品合同**。

最优先工作不是立即按目录删代码，而是：

1. 先让文案/图片/视频都真实闭合到同一 `ContentPackage`；
2. 再收敛单一任务状态与单一 progress/result 通道；
3. 最后按真实消费者证据拆除 legacy、未挂载和重能力旁路。

这样才能把“轻量化”变成可验证的运行拓扑收缩，而不是只缩小仓库或 UI。
