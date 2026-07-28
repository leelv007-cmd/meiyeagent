# 票 17 · 结果区/历史/资产库成品缩略图画廊 + lightbox
> 阶段: Phase 3 · 接线与成品感 ｜ 差距: P0-3 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "17",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-D3-WORKBENCH"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P0-3"
  ],
  "contractIds": [
    "I09"
  ],
  "blockedBy": [],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- P0-3 的用户损害是：视觉创作产品在结果区、历史与资产库只给标题、Asset ID、`objectKey`、SHA 或正文，商家看不到自己生成或上传的图片/视频成品。
- 报告 §一根因②/③同时命中：验收停在“能力存在”，且前后端接线无人收口；媒体对象键、受权读取端点和一个未挂载的图片预览均已存在，但 `/dashboard` 主路径仍是纯文字卡。
- 已锁 Result Card 合同要求首层承接预览/摘要与下一步，证据按需展开；同一持久媒体在结果卡、历史、资产库、Work/Content 引用中必须保持同一个稳定 Asset 身份，不得因画廊或 lightbox 新建第五种事实对象。
- 当前截图锚点：`.scratch/creatok-uiux-wayfinding/assets/current-product-screenshots/08-content-library-desktop-live.jpg`、`21-readonly-demo-content-desktop-live.jpg` 均是纯文字卡；对标 `.scratch/creatok-uiux-wayfinding/assets/screenshots/09-gallery-desktop-live.jpg` 为成品缩略图墙。
- 范围守卫：D3 仍是“对话式外壳 + 结构化内核”，不做 chat clone；D4 仍是 3 选 1 单选，点击缩略图只预览、不等于采用；不恢复 L-1 贴链接抓取；不引入模型跨品牌 Auto。

## 现状代码入口（实核 file:line）

| 入口 | 当前事实 |
| --- | --- |
| 主工作台结果区 | `mkfast-template-main/src/product/unified-creation-workbench.tsx:1045-1105` 仍将结果排成两列文字卡；`:1061-1081` 只显示标题、Asset ID/kind、正文或“已生成持久化 Asset”，无图片/视频。报告范围未漂移。 |
| 历史/资产库列表 | `mkfast-template-main/src/product/canonical-history-page.tsx:69-111` 的统一列表只渲染 badge、标题、日期、详情和深链；`canonical-history-model.ts:81-88` 的列表项没有媒体投影，`:148-167,181-204` 在映射 Asset/Content 时丢掉 `objectKey`/媒体类型。 |
| Asset 详情 | `canonical-history-page.tsx:216-288` 中 `:254-284` 只显示类型、Job、Owned Asset、对象键、SHA 与治理动作；媒体本体不可见。 |
| Content / Job 详情 | `canonical-history-page.tsx:290-370` 在 `:354-360` 显示正文和 Asset ID 串；`:372-420` 的 Job 详情在 `:414` 只显示输出 Asset ID，均未回解成品预览。报告点名的 `:359` 未漂移。 |
| canonical 媒体字段 | `packages/contracts/src/uiux.ts:75-88` 已给 `CreativeAssetProjection` 提供 `kind/objectKey/contentType/ownedAssetId`；不是缺少成品身份或媒体定位字段。 |
| 生成媒体读取链路 | `mkfast-template-main/src/routes/api/core/p1/assets.ts:4-8` → `src/lib/core-client.ts:197-253` → `apps/core/src/server.ts:418-469` 已形成登录态、workspace 隔离的同源读取链路；报告的 `server.ts:421-454` 仍命中路由与读取，但完整响应范围应记为 `:418-469`。 |
| 上传媒体读取链路 | `mkfast-template-main/src/routes/api/storage/file.ts:15-100` 已按文件记录与 workspace membership 受权，并允许图片与 `video/mp4` inline；`src/api/product-assets.ts:68-74` 已返回该同源 URL。Core BFF 的 `src/lib/core-client.ts:215-225` 只接受 `generated/composed` 的 png/mp4，不能拿它绕过上传素材权限模型。 |
| 已建未挂预览 | `mkfast-template-main/src/p1/ai-image-selector.tsx:254-260` 能渲染 `job.assetUrl` 图片，但该组件不在主路径；本票只借鉴媒体呈现，不整块挂入其重复 Job/提示词壳。 |

## 改造方案（步骤级 + 涉及文件清单）

1. 在 `canonical-history-model.ts` 为现有 `CanonicalHistoryItem` 补可选媒体投影（稳定 Asset ID、image/video、`objectKey`、来源链路），从 `history.assets` 与 Product Asset 合并时保留媒体字段；Content/Job 只按已有 Asset ID 关联同一投影，不复制媒体或状态。
2. 固化单一媒体 URL 解析规则：`generated/composed` 使用 `/api/core/p1/assets?objectKey=...`，Product 上传素材使用 `/api/storage/file?key=...`；两者都必须 `encodeURIComponent`，禁止浏览器直连 Core、供应商临时 URL或把 `objectKey` 当公开地址。
3. 在 `canonical-history-page.tsx` 把有媒体的历史/资产条目改为 media-first 响应式网格：图片用真实缩略图，视频用可辨认的视频预览/封面与类型标记；标题、来源、时间和 canonical 深链仍保留，技术证据退到详情层。
4. 在同一文件落一套可复用的媒体预览与 lightbox 行为，并由 `unified-creation-workbench.tsx` 的结果卡复用：缩略图点击或键盘激活后打开；图片适配视口，视频显示原生播放控制；`Esc`/关闭按钮可退出并把焦点还给触发卡。
5. Asset 详情首屏先展示大图/视频；Content 与 Job 详情按关联 Asset 回解为小画廊，同时保留原 canonical 深链。文本 Asset 继续显示文本摘要，不制造伪缩略图。
6. 媒体加载失败时在原卡位显示“成品暂时无法载入”与“重试/打开详情”，不显示破图图标，不把对象键、SHA、原始响应或跨 workspace 内容暴露成兜底。
7. 用相同账号、测试数据和视口跑通结果区 → 历史/资产库 → lightbox → Asset 详情；逐屏取证并核对同一 Asset ID 在各入口未被复制或改写。

涉及文件（均为当前已存在路径）：

- 主要修改：`mkfast-template-main/src/product/canonical-history-model.ts`、`canonical-history-page.tsx`、`unified-creation-workbench.tsx`。
- 回归覆盖：`mkfast-template-main/src/product/canonical-history-model.test.ts`（工程旁证，不作为关票证据）。
- 复用而默认不改：`mkfast-template-main/src/components/ui/dialog.tsx`、`src/routes/api/core/p1/assets.ts`、`src/lib/core-client.ts`、`src/routes/api/storage/file.ts`。
- 只有现有代理无法按上述权限合同读取真实成品时，才最小修改对应既有代理文件；不改 `apps/core` 资产事实模型，不新增平行媒体端点。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家生成图片或视频后，结果区首层直接出现真实成品缩略图/视频预览、标题与状态；无需凭 Asset ID、对象键或 SHA 猜测产物。
- 商家进入“最近活动 / 执行历史 / 作品历史 / 资产库”时，关联图片或视频以成品优先的响应式画廊展示；纯文本结果保持可读摘要，不出现空白伪封面。
- 商家从 Content 或 Job 详情能看见其关联的真实成品并打开同一个 canonical Asset；从任一入口打开 Asset 详情，首屏可见媒体本体，来源/证据仍可继续核验。
- 商家点击缩略图或用键盘激活后可在 lightbox 看大图或播放视频；可用关闭按钮或 `Esc` 返回原卡，预览动作不会自动采用、删除、归档、创建 Content 或新 Asset。
- 商家在桌面和移动视口都能完整浏览画廊与 lightbox；图片不拉伸，视频控制可触达，弹层不把关闭按钮或主媒体裁出视口。
- 当媒体失效、无权或读取失败时，商家看到原位的可理解提示和重试/详情入口；不会看到破图、原始错误、对象键、供应商 URL 或其他 workspace 的媒体。
- 截图对照：同尺寸并排提交当前产品 `.scratch/creatok-uiux-wayfinding/assets/current-product-screenshots/08-content-library-desktop-live.jpg`、对标产品 `.scratch/creatok-uiux-wayfinding/assets/screenshots/09-gallery-desktop-live.jpg` 与升级后同路由截图；肉眼必须可见“纯文字卡 → 真实成品缩略图画廊”，并另附一张升级后 lightbox 打开态。

## Blocked-by / Blocks

- Blocked-by：无。
- 全局关票闸：票 02 完成前，本票不得关票；票 02 完成后，本票仍须将其映射的体验合同 required 条目验绿。
- Blocks：无。票 16 后续回流的 composed video 沿用本票同一 Asset 预览合同，但两票互不设前置依赖。

## 风险与回退

- 风险：生成素材与上传素材误用同一代理，造成 404 或权限回退。控制：按 `objectKey` 来源选择既有同源链路并保留 workspace 校验；回退时只隐藏失败预览、保留 canonical 深链，绝不放宽校验或直出 Core URL。
- 风险：画廊一次加载大量原图/视频拖慢历史页。控制：缩略图懒加载，视频默认只取元数据且不自动播放；回退为首屏限量媒体卡，不能回退成仅 ID 的文字墙。
- 风险：lightbox 焦点丢失、移动端溢出或视频继续后台播放。控制：复用现有 Dialog 的焦点管理，关闭时暂停视频并返回触发点；异常时回退为同页大预览，不回退为新窗口直链。
- 风险：为方便展示复制 Asset 数据，形成结果卡/历史卡的第五种事实。控制：所有画廊项只持有 canonical Asset 引用；回退媒体呈现不迁移、不删除、不改写任何 Asset、Content 或 Job 事实。
- 风险：视频无法稳定取得首帧。控制：用可播放的受权视频预览与明确视频标记作为最低可见成品；若后续需要独立 poster，必须另行映射已有差距并回 ADR，不在本票静默扩张媒体处理范围。
