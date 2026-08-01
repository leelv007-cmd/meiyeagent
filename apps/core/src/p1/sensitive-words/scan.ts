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

type OriginalRange = {
  end: number;
  start: number;
};

/** Normalize by grapheme while retaining UTF-16 ranges in the exact input. */
function normalizeWithOriginalRanges(text: string): {
  ranges: OriginalRange[];
  text: string;
} {
  const normalizedParts: string[] = [];
  const ranges: OriginalRange[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const item of segmenter.segment(text)) {
    const normalizedSegment = item.segment.normalize('NFKC');
    normalizedParts.push(normalizedSegment);
    for (let offset = 0; offset < normalizedSegment.length; offset += 1) {
      ranges.push({
        start: item.index,
        end: item.index + item.segment.length,
      });
    }
  }
  return { text: normalizedParts.join(''), ranges };
}

/**
 * Scan text against an enabled lexicon (xhswork check pattern: per-word global
 * regex, longer words first to prefer more specific hits). Matching uses NFKC,
 * while every returned range addresses the original input in UTF-16 units.
 */
export function scanSensitiveText(
  text: string,
  lexicon: readonly SensitiveWordRecord[],
): SensitiveScanResult {
  const normalized = normalizeWithOriginalRanges(text);
  const enabled = lexicon
    .filter((row) => row.status === 'enabled' && row.word.trim().length > 0)
    .slice()
    .sort(
      (a, b) =>
        b.word.normalize('NFKC').length - a.word.normalize('NFKC').length,
    );

  const hits: SensitiveWordHit[] = [];
  for (const entry of enabled) {
    const normalizedWord = entry.word.normalize('NFKC');
    if (normalizedWord.length === 0) continue;
    const pattern = new RegExp(escapeRegExp(normalizedWord), 'giu');
    const seenOriginalRanges = new Set<string>();
    for (const match of normalized.text.matchAll(pattern)) {
      const normalizedIndex = match.index ?? 0;
      const matched = match[0] ?? entry.word;
      const first = normalized.ranges[normalizedIndex];
      const last = normalized.ranges[normalizedIndex + matched.length - 1];
      if (!first || !last) {
        throw new Error('Sensitive-word normalization produced no input range.');
      }
      const index = first.start;
      const end = last.end;
      const rangeKey = `${index}:${end}`;
      if (seenOriginalRanges.has(rangeKey)) continue;
      seenOriginalRanges.add(rangeKey);
      hits.push({
        wordId: entry.id,
        word: text.slice(index, end),
        category: entry.category,
        replacements: [...entry.replacements],
        index,
        length: end - index,
      });
    }
  }

  hits.sort((a, b) => a.index - b.index || b.length - a.length);
  const nonOverlappingHits: SensitiveWordHit[] = [];
  let coveredUntil = 0;
  for (const hit of hits) {
    if (hit.index < coveredUntil) continue;
    nonOverlappingHits.push(hit);
    coveredUntil = hit.index + hit.length;
  }

  return sensitiveScanResultSchema.parse({
    schemaVersion: 'sensitive-scan/v1',
    textLength: text.length,
    hitCount: nonOverlappingHits.length,
    hits: nonOverlappingHits,
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
