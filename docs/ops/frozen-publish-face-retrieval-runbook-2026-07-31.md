# 冻结面取回记录（抖音代发 / D-155）

> 取回演练按主控 2026-07-31 批复豁免（用户判断取回概率很小），本文按最简记录保留。

- **归档位置**：`references/frozen-publish-face-2026-07-31/`
  - `restore.patch` —— 「当前 → 锚点」反向补丁，覆盖 `apps/`、`packages/`、`mkfast-template-main/`（演练已证实打后与锚点逐字节一致）
  - `snapshot/` 59 个原件副本已按用户裁决删除（2026-07-31）——与 restore.patch＋git 历史（锚点 `b7a426ca`）双重冗余；原件仍可从锚点 `git checkout`/`git show` 取回
- **归档锚点 SHA**：`b7a426cae21c16a8e164bd4b36eac3ae3e55ee4d`
- **删除提交**：`30b8ea37`（core）、`f7a38e96`（web）
- **活性核查表**：`docs/reviews/p1-integrations-liveness-audit-2026-07-31.md`

## 取回路径

**代发面完整保存在 git 历史里，从锚点即可恢复**：

```bash
git checkout b7a426ca -- apps/core/src/p1/integrations apps/core/src/product/publish-content-snapshot.ts
# 或整体拉回三个路径：
git apply references/frozen-publish-face-2026-07-31/restore.patch
```

## 取回时会踩的三个坑（代码之外，补丁带不回来）

1. **五张代发表**不需要人工建——`migrate()` 会 `CREATE TABLE IF NOT EXISTS` 补齐；归档前的旧库仍留着原表与历史行（一行未删）。详见 `docs/ops/frozen-publish-face-table-disposition-2026-07-31.md`。
2. **`DOUYIN_CALLBACK_TOKEN` 必须重新配**：取回后 `main.ts` 会恢复它的强度校验与「须不同于 `CORE_SERVICE_TOKEN`」断言，缺失即启动失败。
3. **取回的是一个从未真正发出过内容的中间态**——生产只装配过 `RecordedDouyinAdapter`，全仓没有 live 适配器。解冻时更可能是拿它当参考设计重写，而不是原样接回。
