import { Skeleton } from '@/components/ui/skeleton';
import { getPathWithLocale } from '@/lib/urls';
import { handoff_qr_alt } from '@/locale/paraglide/messages';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export function HandoffQr({ token }: { token: string }) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    const url = new URL(
      getPathWithLocale(`/dashboard/handoff/${token}`),
      window.location.origin
    ).toString();
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
      color: { dark: '#171717', light: '#ffffff' },
    }).then(setSrc);
  }, [token]);

  if (!src) return <Skeleton className="aspect-square w-full" />;
  return (
    <img
      src={src}
      alt={handoff_qr_alt()}
      className="aspect-square w-full bg-white object-contain p-2"
    />
  );
}
