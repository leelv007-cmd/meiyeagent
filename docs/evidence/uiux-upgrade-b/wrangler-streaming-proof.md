# Wrangler 流式传输证明

- 日期：2026-07-13（Asia/Shanghai）
- 范围：本地 Wrangler 生产候选、TanStack Start BFF、Node Core paced fixture、Chromium Fetch body
- 对应票据：06、07

## 结论

生产候选构建中的文案流能够从 Node Core 经 Wrangler/TanStack BFF 以多个网络 chunk 到达浏览器。浏览器探针要求 `chunkCount > 1` 且最后一个 chunk 与第一个 chunk 的到达间隔大于 100ms，测试通过。

根因回归锁定在流响应头：文本流显式返回 `Content-Encoding: identity`，避免边缘层把小型增量文本自动编码后聚合；同时保留原始 `text/plain` 对象流协议、`Cache-Control: no-store` 与 `X-Accel-Buffering: no`。没有把完整结果在客户端切字，也没有把非 SSE 负载伪装成 `text/event-stream`。

## 可重复命令

```bash
PLAYWRIGHT_PRODUCTION_CANDIDATE=true \
PLAYWRIGHT_AUTH_BASE_URL=http://localhost:3000 \
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/uiux-upgrade-b-results.spec.ts \
  --grep "production candidate preserves"
```

结果：`1 passed`。测试附件 `copy-stream-transport-probe` 记录浏览器观察到的 chunk 数量及首尾到达时间。

## 证据边界

此证明只覆盖本地生产候选的传输行为。输入仍是 `MODEL_EXECUTION_MODE=fixture`，因此它不证明真实模型供应商首 token、真实供应商中断语义、Cloudflare 线上部署可用性、生产耗时或真实用户体验；这些仍按验收报告保持 pending。
