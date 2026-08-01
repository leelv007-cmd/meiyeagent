import {
  sensitiveScanResultSchema,
  type SensitiveScanResult,
  type SensitiveWordHit,
  type SensitiveWordRecord,
} from '@meiye/contracts';

/** Escape a plain word for use inside a global RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scan text against an enabled lexicon (xhswork check pattern: per-word global
 * regex, longer words first to prefer more specific hits).
 */
export function scanSensitiveText(
  text: string,
  lexicon: readonly SensitiveWordRecord[],
): SensitiveScanResult {
  const normalized = text.normalize('NFKC');
  const enabled = lexicon
    .filter((row) => row.status === 'enabled' && row.word.trim().length > 0)
    .slice()
    .sort((a, b) => b.word.length - a.word.length);

  const hits: SensitiveWordHit[] = [];
  for (const entry of enabled) {
    const pattern = new RegExp(escapeRegExp(entry.word.normalize('NFKC')), 'giu');
    for (const match of normalized.matchAll(pattern)) {
      const index = match.index ?? 0;
      const matched = match[0] ?? entry.word;
      hits.push({
        wordId: entry.id,
        word: matched,
        category: entry.category,
        replacements: [...entry.replacements],
        index,
        length: matched.length,
      });
    }
  }

  hits.sort((a, b) => a.index - b.index || b.length - a.length);

  return sensitiveScanResultSchema.parse({
    schemaVersion: 'sensitive-scan/v1',
    textLength: normalized.length,
    hitCount: hits.length,
    hits,
  });
}

/** Collect candidate-facing text surfaces for generation-chain / redline use. */
export function collectCandidateScanText(input: {
  visibleText?: ReadonlyArray<{ field: string; text: string }>;
  factClaims?: ReadonlyArray<{ value: string }>;
}): string {
  const parts: string[] = [];
  for (const row of input.visibleText ?? []) {
    if (row.text.trim()) parts.push(row.text);
  }
  for (const claim of input.factClaims ?? []) {
    if (claim.value.trim()) parts.push(claim.value);
  }
  return parts.join('\n');
}
