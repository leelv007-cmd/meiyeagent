import {
  sensitiveCheckBarSchema,
  type SensitiveCheckBar,
  type SensitiveScanResult,
  type SensitiveWordHit,
} from '@meiye/contracts';

function snippetAround(text: string, hit: SensitiveWordHit, radius = 12): string {
  const start = Math.max(0, hit.index - radius);
  const end = Math.min(text.length, hit.index + hit.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

/**
 * Build the delivery / generation-chain check-bar from a scan result.
 * Object-workspace inline replace UI is #327 — this ticket only ships the bar DTO.
 */
export function buildSensitiveCheckBar(input: {
  text: string;
  scan: SensitiveScanResult;
}): SensitiveCheckBar {
  if (input.scan.hitCount === 0) {
    return sensitiveCheckBarSchema.parse({
      schemaVersion: 'sensitive-check-bar/v1',
      status: 'clear',
      summary: '未检出违禁词。',
      items: [],
    });
  }

  const seen = new Set<string>();
  const items = [];
  for (const hit of input.scan.hits) {
    const key = `${hit.wordId}:${hit.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      wordId: hit.wordId,
      word: hit.word,
      category: hit.category,
      snippet: snippetAround(input.text, hit),
      replacements: [...hit.replacements],
    });
  }

  return sensitiveCheckBarSchema.parse({
    schemaVersion: 'sensitive-check-bar/v1',
    status: 'hits',
    summary: `检出 ${items.length} 处违禁词，请按建议替换后再交付。`,
    items,
  });
}
