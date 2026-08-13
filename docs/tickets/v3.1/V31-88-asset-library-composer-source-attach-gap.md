# V31-88 — 素材库已授权资产无法挂入 composer 配方槽：只有「上传新图」没有「从素材库挑选」

**Parent**: V31-84 收口走查新发现
**批次**: 清红队列（P1，素材复用/配方链）
**Blocked by**: 无
**Related**: V31-73/V31-85（slot readiness 镜像只看 `lensState.draft.sources`）、V31-87、
C16 素材复用能力

**Status**: open（2026-08-13）— 主控活体取证，未派工

**Implementation state**: not-started
**Verification state**: reproduced（product_states 有 authorized customer_case 资产，composer 仍「现在还没有可用的案例图」）
**Evidence SHA**: b991400001bebbb978c25609549b167f61dc5ad7
Evidence 注：asset-0a411f19（customer_case/authorized/权利人=盘点美发工作室）在 Core state 在案；composer 添加素材面板只有拍照/选择图片两个上传入口
**Workflow Run**:
**Artifact Digest**:

## 定性

- slot readiness（V31-73 镜像）按 `draft.sources` 判定，语义正确；缺的是**把既有已授权
  资产放进 draft.sources 的 UI 通路**——「添加素材」面板只提供新上传（camera/gallery
  input），没有工作区资产挑选器。
- 后果：素材页与 composer 双面各自为政；商家被迫重传同图（撞 V31-87 的 409 砖）；
  grok 的 v31-84 spec 只能靠 `seedComposerInlineAuthorize` 静态种子绕过（掩码了缺口）。

## Acceptance criteria

- [ ] composer「添加素材」提供已授权资产挑选（按配方槽过滤：案例图槽只列 customer_case/
  前后对比等 eligible 类别＋authorized 状态）
- [ ] 挑选后 slot readiness 立即满足、报价卡照常；e2e 覆盖「素材页传图授权→composer
  挑选→图文配方提交<400」
- [ ] V31-84 spec 的 seed 挂源替换为真实挑选路径（同步解 V31-84 residual）
