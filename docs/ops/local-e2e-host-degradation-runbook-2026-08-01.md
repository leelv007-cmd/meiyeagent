# 本机 e2e 假红排障手册：宿主机劣化篇（2026-08-01）

本机（macOS）长时间不重启后，后台维护积压足以把本地 e2e 栈整批压死，产生**与代码无关的成批红**。本手册记录 2026-07-25 ~ 08-01 期间实证的失败签名、定位步骤与处置路径，供以后同类报错对照。

## 一、失败签名对照表（全部实证过）

| 签名 | 日志特征 | 已实证根因 |
| --- | --- | --- |
| journey 连锁假红 | `ECONNRESET` → `ERR_CONNECTION_REFUSED`，多 spec 连锁 | 高负载压死 workerd（vite build 残留 159% CPU；`yes` 压测孤儿 100% 吃核） |
| 水合整批超时 | 所有 spec 死在同一处：`form[data-auth-login-hydrated="true"]` 30s 不可见 | CPU 被抢占，vite dev 按需编译供不上（lane-268 残留 next-server 吃 2.6 核） |
| dev server 起栈即死 | `error when starting dev server: Error: Network connection lost`（workerd module runner） | workerd 控制通道被压死，比超时更早断 |
| 生产候选栈 build 死 | `Process from config.webServer was not able to start. Exit code: 254`，无具体报错 | 同上，资源不足致 build/boot 被掐 |
| Core boot 即抛 `IDEMPOTENCY_CONFLICT` | `Platform Skill … is already provisioned with different facts` | **非环境问题**：旧库数据撞 #282 指纹冲突门（设计行为），换冷库即解 |

判别要点：**整批、整齐划一的红（同一处断言、同一超时值）→ 先怀疑环境；单点、形态各异的红 → 才是代码嫌疑。**

## 二、定位步骤（跑 e2e 前/红了之后都按此查）

```bash
uptime                          # load 长期 > 核数即危险；本机 load 10+ 时 e2e 必不稳
ps aux | sort -rk3 | head -8    # 找 CPU 大户
ps aux | grep -E "lane-[0-9]"   # 扫 lane 残留（dev server / build / 压测孤儿）
lsof -p <pid> | awk '$4=="cwd"' # 定位可疑进程来路（cwd 指向哪个 lane/项目）
lsof -nP -iTCP:3000 -iTCP:3010 -iTCP:4100 -sTCP:LISTEN   # 端口占用
```

孤儿进程分类处置：
- **lane 残留**（workerd / vite / next-server / `yes` 压测）：确认 cwd 属已停用 lane 后直接 kill。
- **macOS 系统守护高 CPU**（`fseventsd` ≈100%、`appstoreagent`、`dasd`）：**杀不动也不该杀**——fseventsd 被强杀会触发全盘重扫更糟，appstoreagent 会被 dasd 重新调度。这是维护积压的症状，唯一解是**重启 Mac**（不是重启 Docker：抢占发生在宿主层，容器侧 Postgres 一直正常）。缓解：系统设置 → App Store 关自动更新。

## 三、处置路径

1. **可清的孤儿** → kill 后重克隆冷库重跑（`CREATE DATABASE xxx TEMPLATE meiye_golden`，0.1s）。
2. **旧库撞 #282 冲突门** → 换 `meiye_golden` 冷克隆库，给 playwright 传 `TEST_DATABASE_URL` / `TEST_DBOS_SYSTEM_DATABASE_URL`。
3. **系统维护积压、无孤儿可清** → 本机验证短期不可靠，**改走 draft PR 让 GitHub CI 亲验**：
   - push lane 分支 → `gh pr create --draft`（core-quality.yml 有 `pull_request` 触发器，跑与 main 同套七作业含 production-main-journey）；
   - CI 全绿 = 在准确 SHA 上完成主控亲验，本地 ff 合入后 GitHub 自动标记 PR merged；
   - 实证：2026-08-01 PR #283，本机三跑三败的 journey 在 CI 上 8m29s 一把绿，坐实环境假红。
4. 事后**重启 Mac**，恢复本地验证链路。

## 四、纪律回写

- 终验/e2e 前必查 `uptime`＋孤儿扫描（原有纪律），本手册补充：**load 高但找不到孤儿时，查系统守护，别硬重跑**——三跑三败每次失败形态还不同，就是环境劣化的证据。
- 机器 uptime 超过一周且 fseventsd 持续高 CPU，主动建议重启，别等假红。
