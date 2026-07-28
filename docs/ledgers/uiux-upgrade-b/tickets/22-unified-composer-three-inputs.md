# 票 22 · 统一输入台三喂料：拍照传图一等化 + 拖放/粘贴 + 清死占位
> 阶段: Phase 4 · 开场与骨架 ｜ 差距: P2-1 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "22",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-D3-WORKBENCH"
  ],
  "guardrailDecisionIds": [
    "DEC-L1-LINK-CAPTURE"
  ],
  "gapIds": [
    "P2-1"
  ],
  "contractIds": [
    "I11"
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

- P2-1 `[部分核实]` 的准确口径：统一输入台已经用同一 Textarea 承载打字与粘贴文本；欠交付的是图片重入口、图片拖放/粘贴、移动端拍照 `capture`，以及真实上传后成为本次创作引用。
- 当前“本机文件”只选择文件并显示“未上传，不是 Asset”，不是可用于创作的喂料；旁边“链接”按钮也只生成本页临时文字，属于无功能死占位。
- 本票只补“文字 + 图片上传/拖放/粘贴 + 拍照”同框体验。L-1 贴链接抓取已 de-scope；粘贴纯文本或 URL 都只按普通文本进入意图框，不发起抓取。
- ADR-0010 与 MAP 的验收纪律：只有主路径中的用户可见行为和当前产品/对标产品截图可以关票，代码存在、上传端点存在或自动化检查通过均不能单独作为完成证据。
- 锁定边界：D3 维持“对话式外壳、结构化内核”，不增加 chat clone；D4 维持候选 3 选 1 单选；模型仍须显式选择，禁止跨品牌 Auto 或静默换供应商。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/product/unified-creation-workbench.tsx:206-223`：工作台用 `localReferences: string[]` 保存临时展示文字，没有文件、上传状态或 Asset identity。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:238-285`：页面已读取产品 assets 并投影为可选 `asset` 来源，可作为上传成功后的真实引用入口。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:338-354`：建立 Work 时，`sourceReferences` 只来自 `sourceOptions + selectedSourceKeys`；本机文件字符串不会进入创作记录。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:573-624`：报告所引范围未漂移。Textarea 已支持浏览器默认文本粘贴；隐藏 file input 接受图片/视频，但 `:600-609` 只追加“未上传，不是 Asset”文字；`:611-624` 的“链接”按钮只追加临时占位。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:639-644`：本机文件与链接结果仅渲染为无状态文字列表，没有缩略图、进度、失败反馈或引用关系。
- `mkfast-template-main/src/api/product-assets.ts:38-107`：已有鉴权、工作区隔离、内容哈希与 R2 持久化的 `uploadProductAsset`，本票复用，不另造上传通道。
- `mkfast-template-main/src/product/canonical-asset-actions.tsx:35-65,85-100,140-152`：已有“上传文件 → `add_asset` → 真实 Asset”的接线样例，并已有 `capture="environment"`；可复用行为，不整块搬入治理表单。
- `mkfast-template-main/src/product/client.ts:35-109`：`useProductState` 已提供产品状态刷新与 `ProductCommand` 执行，可让新 Asset 进入现有资产事实和来源选择。
- `packages/contracts/src/uiux.ts:12-15,43-50`：Work 来源已支持 `{ kind: 'asset', id }`，无需扩张合同。
- `mkfast-template-main/tests/e2e/specs/uiux-creation-loop.spec.ts:71-77,142-207`：已有“建立 Work + 来源写入”的浏览器旅程，可扩展图片选择、粘贴与拖放路径。
- 行号复核结论：差距报告的 `573-624` 仍准确；报告省略了仓库内前缀，实际文件路径如上。补充实核证明问题不仅是入口轻，还包括文件没有上传、没有成为 Work 引用。

## 改造方案（步骤级 + 涉及文件清单）

1. 把意图框与图片入口合为一个可聚焦的统一输入区：Textarea 保持唯一文字输入；输入区内常显同等级的“拍照”和“上传图片”动作，并给出“可拖入或粘贴图片”的简短提示，移除回形针式“本机文件”弱入口。
2. 保留两个隐藏图片 input：桌面/相册入口使用 `accept="image/*"`，拍照入口另加 `capture="environment"`。不把视频上传顺手纳入本票；视频生成能力与图片参考喂料是不同职责。
3. 收敛一个 `ingestImages(files)` 流程，供文件选择、drop 与 clipboard image 共用。只接收图片；拖入非图片或混合内容时，在输入区就地说明未接收项，不静默失败。
4. 为输入区处理 `dragenter/dragover/dragleave/drop` 并阻止浏览器打开文件；拖入图片时显示明确高亮。Textarea 粘贴含图片文件时走图片流程；仅含文字或 URL 时保持浏览器默认粘贴，不做 URL 识别与抓取。
5. 每张图片经既有 `uploadProductAsset` 持久化，再执行既有 `add_asset`，形成真实 Asset；上传状态以缩略图卡显示“上传中 / 已加入 / 失败可重试”。不得继续用文件名字符串冒充引用。
6. 上传成功后把 Asset id 显式加入本次创建的 `sourceReferences`，不依赖 assets 列表前六项或自动预选时机；用户从本次输入移除图片时，只移除本次引用，并明确素材仍保留在素材库。
7. 建立 Work 前若仍有图片上传中，主 CTA 显示等待并不可误提交；若上传失败，失败卡可重试或移除，其余已成功图片与已输入文字不丢失。
8. 删除“链接”按钮、`IconLink` 与“链接草稿（提交前仅在本页）”分支；不新增 URL 输入框、网页解析服务或链接预览。
9. 扩展现有浏览器旅程，分别走文件选择、剪贴板图片、拖放图片、移动端拍照 input 以及纯文本粘贴；最终从用户可见的 Work「引用来源」确认图片已带入。

涉及文件清单：

- `mkfast-template-main/src/product/unified-creation-workbench.tsx`：统一输入区、三种图片进入方式、上传状态、真实 Asset 引用和死占位清理。
- `mkfast-template-main/src/api/product-assets.ts`：复用现有持久化入口；只有发现现有图片校验无法支持同一用户旅程时才做最小修正，不新建平行 API。
- `mkfast-template-main/src/product/client.ts`：复用 `useProductState/execute` 完成 `add_asset` 与状态刷新；原则上不改公共合同。
- `mkfast-template-main/tests/e2e/specs/uiux-creation-loop.spec.ts`：扩展现有统一创作闭环的浏览器旅程。

**参考实现（ui-dojo @c034657，详见 references/benchmark/ui-dojo-analysis-2026-07-13.md）**：`src/components/ai-elements/prompt-input.tsx`（1406 行）——attachments 一等公民（添加/预览/移除/action menu）完整参考；经 Vercel AI Elements 官方 CLI 拉取后按三喂料裁剪。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家进入 `/dashboard` 开场时，在同一输入台直接看到意图输入、“拍照”“上传图片”和“拖入或粘贴图片”提示；不再看到“本机文件”弱按钮或“链接”死占位。
- 商家在桌面把图片拖入输入区时，输入区立即高亮；松手后出现图片缩略图与上传状态，浏览器不会跳转打开原图。
- 商家复制图片后聚焦意图框粘贴，图片进入同一缩略图队列；复制普通文字或 URL 粘贴时，文字原样进入意图框，页面不会声称或尝试抓取链接内容。
- 商家在手机点击“拍照”时可直接调用后置摄像头，在“上传图片”时可选相册；选完仍停留在当前输入台并看到缩略图与状态。
- 图片成功后显示“已加入本次创作”；商家点击“建立创作记录”后，在可见的「引用来源」中能看到对应 Asset，刷新页面后该引用仍在，而不是“未上传，不是 Asset”的临时文字。
- 图片上传中不能误建 Work；失败时图片卡明确说明失败并提供重试/移除，已输入文字和其他成功图片保持不变。
- 商家可从本次创作移除某张图片，界面明确说明它仍保留在素材库；随后建立的 Work 不再引用该图片。
- 键盘用户可依次聚焦意图、拍照、上传、图片卡操作与建立 Work；拖放高亮、上传成功和失败均有文字状态，不只依赖颜色。
- 截图对照：并列现有当前产品 `.scratch/creatok-uiux-wayfinding/assets/current-product-screenshots/25-mobile-new-content-live.jpg`、升级后相同移动视口的统一输入台、对标 `.scratch/creatok-uiux-wayfinding/assets/screenshots/12-agent-mobile-live.jpg`；标注当前产品从“纯文字输入”升级为同框可见的文字、拍照/传图与粘贴能力，且输入核心的层级与触达不弱于对标。
- 补一组桌面用户旅程截图：拖入前、拖入高亮、缩略图“已加入”、Work「引用来源」四帧须使用同一图片，肉眼可确认喂料真实贯通而非只画上传壳。

## Blocked-by / Blocks

- Blocked-by：无票级实现前置。
- 全局流程闸：Phase 0 未完成前本票不得进入 frontier；无论实现与截图是否完成，票 02 完成且体验合同 required 条目验绿前，本票不得关票。
- Blocks：MAP 未登记下游阻断票。
- 边界协同：票 19 负责问候/建议/场景预填，票 13 负责预设选中后隐藏提示词与传图引导；本票只负责统一输入台的真实图片喂料与死占位清理。

## 风险与回退

- **上传成功但 Work 未建立**：用户可能中途离开。控制：图片作为真实 Asset 保留在素材库，输入区明确其状态；本票不创建无法治理的临时对象。回退可撤下本次引用，不删除用户素材。
- **多入口产生三套行为**：文件选择、粘贴、拖放若各自处理会出现校验与状态漂移。控制：三者只汇入同一 `ingestImages` 与上传状态模型；发现分叉时先回退拖放/粘贴增强，保留拍照/上传主路径。
- **粘贴图片误伤文字输入**：错误拦截会吞掉商家文案或 URL。控制：只有 clipboard 中存在图片文件才接管；其余交还 Textarea 默认行为，绝不启用 URL 抓取。
- **重复上传或重复引用**：连续粘贴/拖放同一图片可能产生多卡。控制：在本次队列按内容哈希/Asset id 去重并给出可见提示；后端现有哈希校验继续作为持久化保护。
- **对象写入顺序断裂**：R2 文件成功而 `add_asset` 失败时不可显示“已加入”。控制：卡片保持失败/可重试，只有真实 Asset 与来源引用都成立才显示成功。
- **范围外溢**：不得借机恢复链接抓取、视频附件、独立聊天、候选多选或跨品牌 Auto。若实现需要这些能力，停止并回 ADR 裁决，不在本票隐式扩张。
