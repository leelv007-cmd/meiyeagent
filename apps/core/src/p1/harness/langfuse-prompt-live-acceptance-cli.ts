import { randomUUID } from 'node:crypto';

import {
  assertLangfuseLongPromptLiveConfig,
  runLangfuseLongPromptAcceptance,
} from './langfuse-prompt-live-acceptance.js';

const config = assertLangfuseLongPromptLiveConfig();
const prompt =
  '你正在验证 Langfuse 中文长提示词的完整持久化能力。请逐字保存以下规则，不得截断、压缩、改写或省略。' +
  '每一段都必须保持原始中文字符、标点与顺序，读取指定版本后应与写入内容完全一致。'.repeat(
    80,
  );
const result = await runLangfuseLongPromptAcceptance({
  ...config,
  name: `harness/acceptance/long-cn-${Date.now()}-${randomUUID()}`,
  prompt,
});

console.log(JSON.stringify(result));
