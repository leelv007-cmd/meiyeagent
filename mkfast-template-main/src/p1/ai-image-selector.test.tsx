import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { overwriteGetLocale } from '../locale/paraglide/runtime';
import { AiImageSelector } from './ai-image-selector';

test('image generation status uses merchant language without raw status or job id', () => {
  overwriteGetLocale(() => 'zh');
  const html = renderToStaticMarkup(
    <AiImageSelector
      job={{
        actualModelLabel: 'seedream-4-5',
        id: 'job-internal-42',
        status: 'running',
        statusLabel: '正在生成图片',
      }}
      mode="generate"
      models={[
        {
          available: true,
          capabilityLabel: '生成图片',
          estimatedUsageLabel: '约 1 次',
          id: 'seedream-4-5',
          label: 'Seedream 4.5',
          manufacturer: '字节跳动',
        },
      ]}
      onModeChange={() => undefined}
      onModelChange={() => undefined}
      onPromptChange={() => undefined}
      onSubmit={() => undefined}
      pending={false}
      prompt="暖光美业门店"
      selectedModelId="seedream-4-5"
    />
  );

  assert.match(html, /正在生成图片/u);
  assert.match(html, /Seedream 4\.5/u);
  assert.doesNotMatch(html, /job-internal-42/u);
  assert.doesNotMatch(html, />running</u);
});
