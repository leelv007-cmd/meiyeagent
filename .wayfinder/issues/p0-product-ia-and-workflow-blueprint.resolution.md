# Resolution: 我方 P0 产品页面蓝图与工作流规格

日期：2026-07-07

## 结论

已把 CreatOK 功能拆解、P0 对标矩阵和产品化/架构差距分析收敛成我方 P0 页面级 PRD 与低保真原型。

核心决策：
- P0 一级导航为创作台、内容库、线索台账、门店档案、用量/套餐。
- 账号中心 P0 收在门店档案和发布包流程中，P1 再独立。
- 创作台首页必须是主工作流，不做欢迎页或纯聊天页。
- 内容库按 Content Item -> Platform Variant -> Version -> Asset Link -> Compliance Result -> Publish Task -> Lead Link 组织。
- 线索台账 P0 以人工登记为主，不做复杂因果归因。
- 发布默认 L3 发布包兜底，L1 只按 account-level verified 平台启用，L2 仅 no-submit 灰度。
- 高成本任务必须走 Usage Ledger 的 reserve / commit / refund。

## 产物

- `../../references/product/reports/p0-product-ia-workflow-blueprint.md`
- `../../references/prototypes/p0-product-blueprint/index.html`
- `../../references/prototypes/p0-product-blueprint/README.md`

## 原型运行

```bash
open /Users/bin/Desktop/开发/内容无人区/美业内容2/references/prototypes/p0-product-blueprint/index.html
```

## 后续

建议下一步把页面蓝图转为数据模型与 API 合同规格，明确 content item、platform variant、asset、publish task、lead、usage ledger、compliance result 的字段和接口。

