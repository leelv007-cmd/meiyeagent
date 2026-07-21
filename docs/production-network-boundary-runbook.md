# C-12 生产网络边界与发布验收手册

## 结论

Core 和 Canvas 的源站不得公网直连。Core 只能经 Cloudflare Service
Binding 或部署平台私网调用；Canvas 的浏览器入口可以公开，但必须经受保护
的边缘路由，Canvas 源站仍只对 Service Binding/私网开放。

`CORE_SERVICE_TOKEN` 和 `CANVAS_SERVICE_TOKEN` 是应用层身份校验，不是网络边界，
不得替代 Ingress/WAF、请求体限制、限流、TLS 或超时。

机器可读权威是
[`production-network-boundary-contract.json`](./production-network-boundary-contract.json)。
本文解释如何实施和产生外部证据。

## 当前代码事实与缺口

- ADR-0006 已决定“Workers Shell + 单 Node 服务 + 托管 Postgres + R2”；
  不支持把 Core 作为新的公网 API。
- Web 通过 `CORE_SERVICE_URL` 和 `CANVAS_SERVICE_URL` 调用后端，并通过
  `CANVAS_ORIGIN` 向浏览器提供 Canvas 入口。生产中后两者必须分离：
  `CANVAS_SERVICE_URL` 是私网/service-binding 地址，`CANVAS_ORIGIN` 是受保护的
  公开边缘域名。
- Web 在 staging/production 启动时要求显式设置
  `INTERNAL_SERVICE_TRANSPORT=service-binding|private-network`；production 的
  `CANVAS_ORIGIN` 必须是 HTTPS。该配置只声明预期拓扑，不根据 hostname 猜测
  私网，也不证明 Service Binding 或源站 ACL 已部署。
- Core 已有 `GET /health`，仅返回服务名和状态。
- Canvas 当前没有专用的私网健康端点。关闭 C-12 前需新增
  `GET /api/internal/health`，仅返回服务名和状态，不返回环境变量、上游 URL、
  版本明细或凭据；该端点只在私网监控面可达。
- 当前仓库没有可证明生产 Ingress/WAF 和源站 ACL 的配置，因此本契约不能
  自行宣称 C-12 已通过。

## 强制拓扑

```text
Internet
   |
   v
Cloudflare edge / approved ingress
   |-- Web Worker (public)
   |-- Canvas browser route (public edge route only)
   |
   +-- service binding or private network --> Core origin
   +-- service binding or private network --> Canvas origin

Public probe ----------------------------X--> Core origin
Public probe ----------------------------X--> Canvas origin
```

合格的“拒绝直连”证据是连接不可达、私网 DNS 不可解析，或由 Zero Trust/
Ingress 在到达应用前返回 403。仅因缺少应用 service token 而返回 401 不算
网络边界证据。

## 默认边界值

| 类型 | 默认限制 |
| --- | ---: |
| Webhook body | 512 KiB |
| 普通 JSON body | 1 MiB |
| 上传 transport body | 11 MiB |
| 登录/注册 | 20 次/分钟/IP |
| Webhook | 120 次/分钟/端点 |
| 上传 | 30 次/分钟/已认证主体 |
| 昂贵生成动作 | 20 次/分钟/工作区 |
| Ingress connect/header | 3 s / 5 s |
| 普通请求 read | 30 s |
| 内部调用 connect/total | 3 s / 10 s |
| SSE connect/idle | 5 s / 45 s（不设普通短 total timeout） |
| 上传 read | 60 s |

可以更严。放宽任一上限时，必须在同一变更中记录理由、负责人、到期日、
监控阈值和回滚方案，并更新机器契约及其 SHA-256。

## 发布验收

1. 部署候选提交，记录完整 40 位 commit SHA 和 deployment ID。
2. 从公网外部探针验证 Web/Canvas 边缘入口；对 Core/Canvas 源站验证不可直连。
3. 从私网监控面请求 Core 和 Canvas 健康端点，必须在超时内返回最小响应。
4. 对每类 body 发送“上限”与“上限 + 1 byte”请求；后者必须在业务处理前 413。
5. 使用专用测试身份执行限流探针；超阈值后得到 429，且不执行业务副作用。
6. 使用可控慢上游验证 connect/read/idle timeout，确认超时时间和错误分类。
7. 生成红线后证据 JSON，其 `contractSha256` 必须等于当前契约文件哈希；
   不得包含 URL 凭据、Authorization/Cookie header、service token、数据库连接串或请求体。
8. 运行 gate：

```sh
# 只验证仓库契约；不代表生产通过
node scripts/production-network-boundary-gate.mjs

# 验证外部产生的、已脱敏的生产证据
node scripts/production-network-boundary-gate.mjs \
  --expected-commit-sha "$RELEASE_COMMIT_SHA" \
  --evidence /absolute/path/to/redacted-production-boundary-evidence.json
```

无证据时命令只返回 `contract-valid`，不代表生产部署已验收。只有第二条命令在证据的
commit SHA 与显式传入的发布候选 SHA 完全一致时才返回 `deployment-valid`；
仅该状态可用于关闭 C-12。

## 证据形状（示例仅含占位值）

```json
{
  "schemaVersion": 1,
  "decisionId": "C-12",
  "environment": "production",
  "deploymentId": "production-example-001",
  "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "contractSha256": "<sha256-of-contract-file>",
  "observedAt": "2026-07-22T00:00:00.000Z",
  "probes": {
    "web-edge-entry-healthy": {
      "status": "passed",
      "evidenceRef": "redacted-evidence/web-edge-entry.json"
    }
  }
}
```

`probes` 必须包含契约中的全部 `requiredEvidence`。`evidenceRef` 是脱敏证据索引，
不是凭据或原始请求存档。

## 回滚

- 发现源站公网可达：立即从边缘路由摘除候选版本，关闭公网 listener/
  security group，轮换可能暴露的 service token，保留脱敏访问日志。
- body/rate/timeout 限制失效：回滚 Ingress/WAF 规则到上一个已验证版本，并停止新版流量。
- 健康检查失败：不将实例加入 upstream pool；已加入的实例立即摘除。
