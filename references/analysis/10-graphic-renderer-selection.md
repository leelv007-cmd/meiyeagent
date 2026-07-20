> ⚠️ **2026-07-07 评审批注**：子决策修正——satori 第一天进主链路（satori→resvg-js→sharp），不再"先手写 SVG compiler、后置 satori"（手写=自己实现中文断行，加量不减量）。其余候选对比与选型论证仍有效。

> ⚠️ **2026-07-18 链接审计批注**：①本文所引 `references/repos/*` 本地镜像已从工作区移除（当前仅存 creatok-skills、vozeb、harness-2026-07-17，均 gitignore 不入库），需复核源码时按原仓库名重新 clone；②本文引用的原型产物 `references/prototypes/graphic-renderer/` 未迁入本工作区、现已不存在，原型跑分仅作历史证据，复跑需按文中脚本描述重建。结论不受影响。

# Graphic Renderer Selection

审查日期：2026-07-06  
审查对象：美业到店 + 医美/医疗内容商家 Regulated Content Mode 创作副驾 P0 图文卡片、封面、价目卡、长图导出  
结论性质：开发前技术选型和原型验证，不是最终生产实现。

## Question

P0 graphic cards should use Konva, server-rendered templates, browser screenshots, or another editor/rendering stack, given mobile preview, export quality, text layout, and template operations?

## 结论

P0 选择 **schema-driven SVG templates + server rasterization**，不要把 Konva 或 Fabric.js 作为 P0 主渲染路径。

推荐技术路线：

```text
Template Schema / Core API
  -> deterministic SVG template
  -> resvg-js rasterize to PNG
  -> sharp resize/composite/format/metadata
  -> R2 rendered artifact
  -> Postgres audit + compliance + usage ledger
```

前端预览可以直接展示同一份 SVG 或由同一份 schema 生成轻量 HTML/SVG preview。Playwright 用于 QA 截图、像素回归和少数复杂 HTML 模板兜底，不做主热路径。Konva 进入 P1，只有当内部运营或商家确实需要自由拖拽编辑器时再引入。Fabric.js 暂不进入 P0。

一句话判断：

- **P0 要的是可审计、可复现、稳定导出的营销卡片，不是 Canva。**
- **模板化 SVG 比自由画布编辑更符合合规、成本、移动预览和批量生成。**

## Local Sources Used

产品与前序决策：

- `合集-v1.2-含开源项目选型.md`
- `references/analysis/01-execution-path.md`
- `references/analysis/02-saas-shell-source-review.md`
- `references/analysis/06-compliance-implementation-plan.md`
- `references/analysis/07-domain-data-model.md`
- `references/analysis/09-model-provider-eval-plan.md`

官方文档快照：

- `references/docs/official/graphic-renderer/konva-docs.md`
- `references/docs/official/graphic-renderer/konva-stage-data-url.md`
- `references/docs/official/graphic-renderer/fabricjs-docs.md`
- `references/docs/official/graphic-renderer/satori-readme.md`
- `references/docs/official/graphic-renderer/resvg-js-readme.md`
- `references/docs/official/graphic-renderer/sharp-docs.md`
- `references/docs/official/graphic-renderer/playwright-screenshots.md`
- `references/docs/official/graphic-renderer/playwright-page-screenshot.md`

源码镜像：

- `references/repos/konva`
- `references/repos/fabricjs`
- `references/repos/satori`
- `references/repos/resvg-js`
- `references/repos/sharp`
- `references/repos/playwright`

原型产物：

- `references/prototypes/graphic-renderer/README.md`
- `references/prototypes/graphic-renderer/renderer-scorecard.mjs`
- `references/prototypes/graphic-renderer/out/renderer-scorecard.json`
- `references/prototypes/graphic-renderer/out/xiaohongshu-cover.svg`
- `references/prototypes/graphic-renderer/out/price-card.svg`

## Prototype Result

运行命令：

```bash
node references/prototypes/graphic-renderer/renderer-scorecard.mjs
```

输出摘要：

| Candidate | Score | Decision |
|---|---:|---|
| Schema SVG templates + resvg-js + sharp | 4.36 / 5 | P0 default |
| HTML/CSS templates + Playwright screenshot | 3.88 / 5 | P0 fallback / QA |
| Konva editor + Node skia/canvas export | 3.28 / 5 | P1 interactive editor |
| Fabric.js canvas editor/export | 3.04 / 5 | P1/P2 editor alternative |
| Client-only DOM to image | 2.60 / 5 | Reject for P0 exports |

当前仓库没有真实美业商家图片资产，所以样张使用 `merchant_uploaded_nail_photo_001` 这类明确占位符。生产前必须用 R2 中真实 `asset_version_id` 做一次复测。

## Candidate Review

### 1. SVG Templates + resvg-js + sharp

定位：P0 主路径。

优势：

- 输出 deterministic，适合合规审计和重复导出。
- 模板 schema 可以版本化，能绑定 `content_version_id`、`asset_version_id`、`compliance_check_id`。
- resvg-js 官方 README 显示它用于 SVG 到 PNG，支持自定义字体、缩放、背景色和 WASM/Node 后端。
- sharp 适合 resize、composite、format conversion、输出 buffer/file，并能处理 EXIF/XMP/ICC 等元数据控制。
- 不需要在浏览器里拖拽，也不受用户设备、浏览器缩放、CORS 状态影响。

风险：

- 中文字体、行高、换行、emoji、特殊标点必须自己建测试集。
- 如果使用 Satori 生成 SVG，它只支持 HTML/CSS 子集，不是完整浏览器 CSS；WOFF2 不支持，必须准备 TTF/OTF/WOFF。
- 图片元数据可能被平台二次处理剥离，不能只依赖文件内 metadata，必须同时写 Postgres 审计记录。

使用方式：

- P0 可以先手写 SVG template compiler，不急着把 Satori 放进主链路。
- 如果团队希望用 JSX 写模板，再引入 Satori，把它限定在静态可见元素、flex layout、已知字体、无外链资源的范围内。
- rasterize 用 resvg-js；图片预处理、合成、压缩、metadata sidecar 用 sharp。

### 2. Playwright Screenshot

定位：P0 QA / fallback，不做主路径。

优势：

- 浏览器级 CSS fidelity 最强，复杂 HTML/CSS 能直接截图。
- Playwright screenshot API 支持 `fullPage`、element screenshot、`clip`、`animations: "disabled"`、`scale`、临时 `style` 注入等，适合做回归截图。
- 可以用同一套 dashboard preview 组件做少量截图导出 spike。

问题：

- Browser runtime 重，不适合高频批量出图热路径。
- 字体、浏览器版本、viewport、动画、外部资源加载都会影响稳定性。
- 服务端部署要放 Worker Pool / container，不适合 Cloudflare Workers app-shell。

推荐：

- 用于 golden screenshot regression。
- 用于复杂富文本/长图模板兜底。
- 不作为 P0 默认导出服务。

### 3. Konva

定位：P1 交互编辑器候选。

优势：

- Konva 是 HTML5 Canvas 框架，适合交互式图形、编辑器、节点拖拽、移动端事件。
- 官方和源码显示支持 Stage/Layer/Shape 对象模型、`toDataURL()` 导出、`pixelRatio` 高分辨率输出。
- Node 环境可通过 `canvas-backend` 或 `skia-backend` 跑同一 API。

问题：

- Canvas 对中文排版、复杂富文本、自动换行、模板级安全区管理不如 HTML/SVG 直观。
- Konva 官方文档提醒跨域图片会导致 canvas export 安全错误；R2 签名图、外部图片和平台截图都要严格代理/同源化。
- 一旦引入自由编辑器，就会增加图层锁定、撤销重做、素材授权、合规标识不可删除、模板迁移等产品复杂度。

推荐：

- P0 不做商家自由画布编辑。
- P1 可以做内部运营版 Konva editor，只允许编辑安全区内的文本、图片槽位、颜色，不允许删除 AIGC 标识和合规提示层。

### 4. Fabric.js

定位：P1/P2 编辑器替代，不进 P0。

优势：

- README 显示 Fabric.js 提供 canvas object model，支持 scale/move/rotate/group、filters、JSON/SVG/PNG/JPG IO。
- Node.js 支持 `StaticCanvas`，可导出 PNG stream。
- 文本编辑对象比 Konva 更偏设计编辑器。

问题：

- Node 依赖 node-canvas 和 jsdom，README 明确提示会遇到 node-canvas 限制和 bug。
- 对 P0 固定模板导出来说过重。
- 自由编辑器同样带来合规标识不可删、图层锁定和模板迁移复杂度。

推荐：

- 除非 P1 明确要做近似 Canva 的编辑器，否则不引入。

### 5. Client-only DOM-to-image

定位：P0 拒绝。

原因：

- 导出受用户浏览器、字体、DPR、CORS、资源加载状态影响。
- 难以写入稳定 metadata 和服务端审计。
- 用户端导出失败时难以复现。

可以保留的用途：

- 临时预览截图。
- 内部 demo，不进入生产导出链路。

## P0 Renderer Architecture

### Renderer Service Boundary

放在 `worker-pool` 或独立 Node service，不放 Cloudflare Workers app-shell。

原因：

- resvg-js / sharp / Playwright 都不是轻 Worker hot path。
- 图片处理需要 CPU、内存、字体文件、本地/对象存储 IO。
- 导出任务需要 queue、retry、timeout、artifact upload 和 usage ledger。

### Render Job

建议最小输入：

```ts
type RenderJob = {
  workspaceId: string;
  storeId: string;
  contentVersionId: string;
  platformVariantId?: string;
  templateVersionId: string;
  outputPreset: "xhs_cover_1080x1440" | "xhs_card_1080x1350" | "dianping_card_1080x1440" | "wechat_long_image";
  assetRefs: Array<{
    assetVersionId: string;
    slot: string;
    usage: "background" | "main_photo" | "logo" | "qr" | "review_screenshot";
  }>;
  textLayers: Array<{
    key: string;
    value: string;
    sourceRef?: string;
    complianceLock?: boolean;
  }>;
  aigc: {
    visibleLabel: string;
    synthesized: boolean;
    provider?: string;
    model?: string;
  };
  idempotencyKey: string;
};
```

### Render Flow

```text
Core API validates workspace and asset authorization
  -> Usage Ledger reserve
  -> Compliance Gate verifies content + asset + AIGC label
  -> Renderer fetches R2 assets by signed internal URL
  -> Sharp normalizes orientation, crop, color profile, dimensions
  -> Template compiler emits SVG
  -> resvg-js rasterizes to PNG
  -> Sharp compresses and writes metadata where feasible
  -> R2 stores rendered artifact
  -> Core API writes rendered_artifacts + asset_usages + audit_events
  -> Usage Ledger commit or refund
```

### Template Schema

P0 模板只开放槽位，不开放自由画布：

| Template part | P0 rule |
|---|---|
| `canvas` | 固定平台尺寸、安全区、背景 |
| `asset_slot` | 绑定真实素材或 AI 背景，记录 `asset_version_id` |
| `text_slot` | 有最大字符数、最大行数、最小字号 |
| `compliance_label` | 锁定，不允许删除或移出安全区 |
| `price_badge` | 必须绑定 `price_source` |
| `export_metadata` | 写入 artifact sidecar 和文件 metadata |

## Required QA Gates

每个模板版本必须跑：

1. `font_available`: 所有指定字体在 renderer service 中可加载。
2. `text_overflow`: 中文长标题、价格、门店名、活动期不能溢出安全区。
3. `aigc_label_visible`: 显式标识在导出图可见，且不被裁剪。
4. `asset_auth_bound`: 每个图片槽必须绑定授权状态。
5. `price_source_bound`: 价格层必须有来源。
6. `deterministic_export`: 同一输入两次导出 hash 一致，或差异在可解释 metadata 内。
7. `golden_snapshot`: 关键模板做像素/结构回归。
8. `platform_crop_safe`: 小红书/点评/微信预览裁剪区域不遮挡主信息。

Playwright 可以在 QA 中负责页面预览截图；主导出仍由 SVG/resvg/sharp 完成。

## Data Model Additions

在 Core API/Postgres 增加或预留：

| 表 | 作用 |
|---|---|
| `graphic_templates` | 模板族，平台、用途、默认尺寸 |
| `graphic_template_versions` | 版本化模板 schema、renderer version、状态 |
| `render_jobs` | 导出任务、状态、幂等键、错误 |
| `rendered_artifacts` | 输出文件、尺寸、格式、R2 key、hash、AIGC 状态 |
| `render_asset_refs` | artifact 使用了哪些 `asset_version_id` |
| `font_assets` | 字体文件、license、语言覆盖、hash |

这些表仍属于 Core API/Postgres。R2 只存二进制输出和字体文件，不当事实来源。

## P0 Implementation Path

1. 做 `graphic_template_versions` schema v0，只支持 3 个模板：小红书封面、价格卡、发布包长图。
2. 实现 SVG compiler：输入 template schema + asset refs + text layers，输出 SVG string。
3. 接入 resvg-js，把 SVG 输出为 PNG buffer。
4. 接入 sharp：素材裁剪、尺寸归一、PNG/JPEG/WebP 输出、metadata/sidecar。
5. 接入 Core API：render job、usage ledger、compliance gate、artifact audit。
6. App-shell 只做预览和选择模板，不在浏览器里执行最终导出。
7. 用 Playwright 建 5 个 golden screenshot 回归：封面、价格卡、超长标题、无授权素材拒绝、AIGC 标识裁剪检查。
8. 在 P1 再评估 Konva editor：先给内部运营，不直接给商家自由编辑。

## Decision

P0 采用：

```text
Primary: schema SVG templates -> resvg-js -> sharp
Preview: same SVG schema in dashboard
QA/fallback: Playwright screenshot
P1 editor: Konva
Rejected for P0: Fabric as primary, client-only DOM-to-image
```

这条路线最少代码就能满足 P0 的关键约束：移动端预览、稳定导出、中文文本可控、模板化运营、AIGC 标识、素材授权、价格证据、审计和用量计费。

## Open Risks

- 当前仓库没有真实美业素材，样张只能证明模板结构，不能证明真实图片裁剪质量。
- Satori 对 CSS 的支持是子集，若使用 JSX 模板必须建立可用 CSS 白名单。
- CJK 字体授权、体积和加载策略要单独确认。
- 文件 metadata 可能被平台处理剥离，必须保留 Postgres audit 和 R2 sidecar。
- 如果商家强烈要求手动拖拽编辑，P1 需要 Konva editor spike。

## Follow-up

- 用真实门店图片和价目表截图替换 prototype 占位素材，跑一次 rasterize 到 PNG 的 smoke test。
- 制定 `graphic_template_versions` JSON schema。
- 准备 CJK font pack 和字体 license 记录。
- 把 `image_render` 接入 Usage Ledger。
- 在发布包生成流程里锁定 `AI 辅助排版` / `AI 合成图` 标识层。
