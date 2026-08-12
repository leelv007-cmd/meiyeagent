# V31-65 — admin 敏感词「分类」控件换 shadcn Select 后 e2e 仍按原生 `<select>` 断言

**Parent**: admin 换装复核波（2026-08-07，#425/#426/#428）遗留
**批次**: 收尾
**Blocked by**: V31-64（先修门仪器，否则本票验收跑会被级联污染）
**Related**: V31-58（test-contract mismatch 家族先例）
**Status**: open（2026-08-12）— test-contract mismatch confirmed by code read; fix not started

**Implementation state**: not started
**Verification state**: n/a
**Evidence SHA**: 20179316214f3ea10e3fe3ddf4d236045f874709
**Workflow Run**: 31554310069
**Artifact Digest**:

## 症状

`admin-sensitive-words.spec.ts:18`（p2 门）在 spec:39 `panel.getByLabel('分类').selectOption('medical')` 报
`locator.selectOption: Error: Element is not a <select> element`——resolve 到的是 `<button role="combobox" id="sw-category" …>`。三次尝试同签名，发生于 `01:42:23`（全门最早，服务完全健康），非级联。

## 根因（已读码确认）

`mkfast-template-main/src/p1/admin-sensitive-words-control.tsx:286-311` 渲染 shadcn `Select`/`SelectTrigger`（Radix combobox，trigger 带 `data-testid="admin-sensitive-words-category"`），原生 `selectOption` 不适用。控件形态来自 2026-08-07 admin 换装波（`58953be3` #428 / `a073be43` #426 / `55b876b3` #425），spec 未随改。

## 修法

只改测试合同，不动产品：点开 `admin-sensitive-words-category` trigger 后按 option 文案/值选取。

**⚠️ 施工要求**：spec:45-59 还有 `panel.getByRole('row')` 行断言，换装波同时改过表格形态——修完 :39 后**必须把整条 case 跑到底**再关票，防止连环 test-contract 红被分次发现。

## 验收

- [ ] `admin-sensitive-words.spec.ts:18` 整 case 本地绿（服务存活的干净跑）
