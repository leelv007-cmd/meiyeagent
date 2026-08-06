# Admin 待办 spec 批（2026-08-06）

把 `docs/reviews/admin-config-audit-2026-08-06.md`（§六 D1–D9 决议 + §五 P0/P1/P2）与 `docs/design/admin-reui-restyle-plan-2026-08-06.md`（落地状态 7 项遗留）里的全部开放待办，整理成 8 份实施 spec；对抗式复核又派生出第 9 份（I）。**已批准并开票（2026-08-06）**：9 份 spec 拆成 39 张实施票 `#359–#397`，全部已打 `ready-for-agent`。

已在换装波完成、不再入 spec：D1 改名、D2 第一步六域侧栏、运行表 q/模型/任务筛选 UI、D8 合规键判定。

## 清单

| Spec | 主题 | 覆盖来源 | 优先级 | 实施票 |
|---|---|---|---|---|
| A | 管理面权限收口 | §2.8 封禁窗口、D7、报备②（§4.5 fail-open 已证伪，降为 P2 纵深） | P1 | #363 #364 #365 #366 |
| B | 静默数据丢失三处 | §2.7 toolEntryRefs、§2.7 Recipe 草稿、§2.5 Skill 白名单 | **P0** | #359 #360 #361 #362 |
| C | 供给闭环修复 | §2.2 轮换/测试连接、§2.4 模式键、§3.2 错标、D6 | P1 | #367 #368 #369 #370 #371 |
| D | 配方治理收敛 | §2.6 recipe-studio、§4.3 双入口、D3、D5 | 中 | #372 #373 #374 #375 #376 |
| E | 商家选用技能旅程 | §2.5 user_selected、D4 | 中 | #377 #378 #379 #380 #381 #382 |
| F | 异常首页真实化+入口 | §2.12、§4.1/4.4、D2 第二步、D9 | 中 | #383 #384 #385 |
| G | IA 拆页与治理清理 | §2.9/10/11、§4.2、P2、报备① | 低 | #388 #389 #390 #391 #392 |
| H | 换装遗留与 UI 缺项 | 换装方案 7 项遗留 + 可选部件 | 低 | #386 #387 |
| I | Recipe 评测证据服务签发 | 复核对 D 的裁决派生（非原始文档待办） | 中 | #393 #394 #395 #396 #397 |

39 张票中 24 张无阻塞可立即开工，15 张有依赖边。跨 spec 的硬依赖原有两条，**2026-08-06 wayfinder #398 终局后剩一条**：#382（商家旅程 e2e）等 #362（Skill 治理白名单）。原 #376←#359 边（工具引用透传）随工具链剔除（#418→#419）解除；#359 收窄为 Recipe 侧三态合并。同 spec 内的顺序边多为「同一文件/同一分派点」的语义防撞，例如 #366 等 #365（共用 auth catch-all 的 pathname 分派层）、#361 等 #359（共用三态合并语义的唯一定义处）。

## 依赖关系

- ~~B 的 `toolEntryRefs` 透传是 D5 的硬前置~~（随工具链剔除 #419 解除）；B 的 Skill 白名单修复是 E 的前置（否则 user_selected 绑定仍落空）。
- D 的 recipe-studio 下线消化审计 §2.6 与换装遗留第 7 项。
- **I 是 D 的解锁条件**：D 把评测/内测门置为禁用，而 `switchProduction` 硬要求 `internal_tested`，所以 D 单独落地会使治理链停在 `validated`、生产切换不可达。二者同批交付，或在 D 的交付说明中显式记录该阶段生产切换不可用。
- F 的入口改跳与首页数据修复是硬绑定，不可拆开单上。
- H 的 UI 缺项优先用 ReUI Pro block（钥匙已配），不自研。

## 建议实施顺序

B（唯一 P0，#359–362）先行 → A/C（#363–371）并行 → F 异常首页（#383–385）→ **D+I 同批**（#372–376 + #393–397）→ E（#377–382）→ G/H（#386–392）清理与补齐并行。

D 与 I 必须同批的原因见「依赖关系」：#374 把评测门置为禁用后，走治理链的 Recipe 无法执行生产切换，该窗口由 I 关闭。G/H 与任何批次都无冲突，缺人手时随时可插。

## 复核记录

8 份初稿经 codex CLI 多路并发对抗式复核：7 份 BLOCK + 1 份 PASS-WITH-FIXES，findings 已一次性修净并由主控直核。三条经主控亲验的全局更正贯穿全批：

1. **审计头号 P0「商家可读全部平台配置」是误报。** BFF 经 `normalizeProductRole` 从 session 推导角色（`mkfast-template-main/src/lib/core-client.ts:155-165`），Core 的 config_get/list/history 要求 `config.publish`（`packages/contracts/src/capability-permission.ts:485-500`），而该能力只出现在管理员能力集（同文件 `:49-82`），owner 被 `capability_denied` 已由测试钉死（`apps/core/src/p1/capability-permission/authorizer.test.ts:271-297`）。真实剩余项是 shell 层缺独立管理员门，属 P2 纵深防御，已转交 Spec A。
2. **Skill 白名单的静默不发生在 bind。** `skill_bind` 接受任意非空 `workflowRevisionRef`；静默发生在运行时 `selectStageRevisions` 按 `governance.workflowRevisionRefs` 筛选时不命中即 `continue`（`apps/core/src/p1/skills/service.ts:1338-1354`）。
3. **`presentationPolicy` 已在绑定期被消费**，不是"仅落库不消费"——`user_selected` 绑定后台专用 Skill 会立即失败（`apps/core/src/p1/skills/service.ts:1113-1118`）。

这三条已同步回填到 `docs/reviews/admin-config-audit-2026-08-06.md`。
