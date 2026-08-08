/**
 * Real QR render for MobilePublishHandoff (V31-17).
 * Uses qrcode@1.5.4 already in the web package.
 */

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export type MobilePublishHandoffQrProps = {
  /** Frozen handoff URL (may be app-relative). Kept on data-handoff-url. */
  handoffUrl: string;
  sizePx?: number;
  className?: string;
};

/**
 * Prefer absolute URL for phone cameras when the frozen path is relative.
 */
export function resolveQrPayload(handoffUrl: string, origin?: string): string {
  const trimmed = handoffUrl.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//iu.test(trimmed)) return trimmed;
  const base =
    origin ??
    (typeof window !== 'undefined' ? window.location.origin : undefined);
  if (!base) return trimmed;
  try {
    return new URL(trimmed, base).href;
  } catch {
    return trimmed;
  }
}

export function MobilePublishHandoffQr({
  handoffUrl,
  sizePx = 112,
  className,
}: MobilePublishHandoffQrProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const payload = resolveQrPayload(handoffUrl);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void QRCode.toDataURL(payload, {
      width: sizePx,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setDataUrl(null);
          setError('二维码生成失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [payload, sizePx]);

  return (
    <div
      className={className}
      data-handoff-url={handoffUrl}
      data-qr-payload={payload}
      data-testid="mobile-publish-handoff-qr"
    >
      {dataUrl ? (
        <img
          alt="手机交接二维码"
          className="size-28 rounded-md border bg-white"
          data-testid="mobile-publish-handoff-qr-image"
          height={sizePx}
          src={dataUrl}
          width={sizePx}
        />
      ) : (
        <div
          aria-hidden="true"
          className="bg-muted/40 text-muted flex size-28 items-center justify-center rounded-md border text-[10px]"
          data-testid="mobile-publish-handoff-qr-pending"
        >
          {error ?? '…'}
        </div>
      )}
    </div>
  );
}
