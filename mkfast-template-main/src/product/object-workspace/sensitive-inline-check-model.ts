import type { SensitiveScanResult, SensitiveWordHit } from '@meiye/contracts';

export function canApplySensitiveScan(input: {
  currentText: string;
  requestText: string;
  scan: SensitiveScanResult;
}): boolean {
  if (input.currentText !== input.requestText) return false;
  if (input.scan.complete !== true) return false;
  if (input.scan.textLength !== input.requestText.length) return false;
  if (input.scan.hitCount !== input.scan.hits.length) return false;

  return input.scan.hits.every((hit) => {
    if (!Number.isInteger(hit.index) || !Number.isInteger(hit.length)) {
      return false;
    }
    if (hit.index < 0 || hit.length <= 0) return false;
    const end = hit.index + hit.length;
    if (end > input.requestText.length) return false;
    return input.requestText.slice(hit.index, end) === hit.word;
  });
}

export function canReplaceSensitiveHit(input: {
  currentText: string;
  requestText: string;
  hit: SensitiveWordHit;
  replacement: string;
}): boolean {
  if (input.currentText !== input.requestText) return false;
  if (input.replacement.trim().length === 0) return false;
  if (
    !Number.isInteger(input.hit.index) ||
    !Number.isInteger(input.hit.length)
  ) {
    return false;
  }
  if (input.hit.index < 0 || input.hit.length <= 0) return false;
  const end = input.hit.index + input.hit.length;
  if (end > input.currentText.length) return false;
  return input.currentText.slice(input.hit.index, end) === input.hit.word;
}
