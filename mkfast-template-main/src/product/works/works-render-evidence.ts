/**
 * Canvas raster evidence marker — carried over verbatim from the old
 * canvas-work shell (T32 / #226). `export_work` validates this marker
 * server-side, so the reshelled shell must produce byte-identical evidence:
 * the sha256 of the rasterised export plus the document facts the promotional
 * material receipt is checked against.
 */

export async function canvasRenderEvidenceMarker(
  dataUrl: string,
  document: Record<string, unknown>
) {
  const encoded = dataUrl.split(',', 2)[1];
  if (!encoded) throw new Error('这次导出没有拿到图像数据。');
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const rasterSha256 = [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  ]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  const elements = Array.isArray(document.pages)
    ? document.pages.flatMap((page) => {
        if (!page || typeof page !== 'object') return [];
        const value = (page as { elements?: unknown }).elements;
        return Array.isArray(value) ? value : [];
      })
    : [];
  const imageElementIds = new Set<string>();
  const fontFamilies = new Set<string>();
  const cjkLineBreakElementIds = new Set<string>();
  for (const value of elements) {
    if (!value || typeof value !== 'object') continue;
    const element = value as Record<string, unknown>;
    if (element.kind === 'image' && typeof element.id === 'string') {
      imageElementIds.add(element.id);
    }
    if (element.kind !== 'text') continue;
    if (typeof element.fontFamily === 'string' && element.fontFamily.trim()) {
      fontFamilies.add(element.fontFamily.trim());
    }
    if (
      typeof element.id === 'string' &&
      typeof element.text === 'string' &&
      /\p{Script=Han}/u.test(element.text) &&
      /\r?\n/u.test(element.text)
    ) {
      cjkLineBreakElementIds.add(element.id);
    }
  }
  return {
    cjkLineBreakElementIds: [...cjkLineBreakElementIds].sort(),
    fontFamilies: [...fontFamilies].sort(),
    imageElementIds: [...imageElementIds].sort(),
    rasterSha256,
    version: 'canvas-raster-v1' as const,
  };
}
